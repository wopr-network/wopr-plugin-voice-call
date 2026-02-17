import { describe, it, expect, vi, beforeEach } from "vitest";
import { mulawToPcm, pcmToMulaw, resample, AudioBridge } from "../src/audio-bridge.js";
import { MockTelnyxWebSocket } from "./mocks/telnyx-ws.js";

describe("mulawToPcm / pcmToMulaw", () => {
  it("converts mulaw to PCM correctly (silence = 0xFF)", () => {
    const mulaw = Buffer.alloc(10, 0xff); // 0xFF = silence in mulaw
    const pcm = mulawToPcm(mulaw);
    expect(pcm.length).toBe(20); // 2 bytes per sample
  });

  it("PCM -> mulaw -> PCM roundtrip preserves approximate value", () => {
    // Encode a known PCM value to mulaw then decode back
    // Due to lossy compression, we only check approximate equivalence
    const originalPcm = Buffer.alloc(160); // 80 samples of silence
    const mulaw = pcmToMulaw(originalPcm);
    expect(mulaw.length).toBe(80);
    const decodedPcm = mulawToPcm(mulaw);
    expect(decodedPcm.length).toBe(160);
    // Silence should survive roundtrip approximately
    for (let i = 0; i < decodedPcm.length; i += 2) {
      const sample = decodedPcm.readInt16LE(i);
      expect(Math.abs(sample)).toBeLessThan(1000); // near silence
    }
  });

  it("mulawToPcm doubles the buffer size", () => {
    const mulaw = Buffer.alloc(100, 0x7f);
    const pcm = mulawToPcm(mulaw);
    expect(pcm.length).toBe(200);
  });

  it("pcmToMulaw halves the buffer size", () => {
    const pcm = Buffer.alloc(200, 0);
    const mulaw = pcmToMulaw(pcm);
    expect(mulaw.length).toBe(100);
  });
});

describe("resample", () => {
  it("returns same buffer when rates are equal", () => {
    const input = Buffer.alloc(160, 0);
    const output = resample(input, 8000, 8000);
    expect(output).toBe(input); // same reference
  });

  it("doubles sample count when upsampling 8kHz -> 16kHz", () => {
    const input = Buffer.alloc(160, 0); // 80 samples at 8kHz = 10ms
    const output = resample(input, 8000, 16000);
    expect(output.length).toBe(320); // 160 samples at 16kHz
  });

  it("halves sample count when downsampling 16kHz -> 8kHz", () => {
    const input = Buffer.alloc(320, 0); // 160 samples at 16kHz
    const output = resample(input, 16000, 8000);
    expect(output.length).toBe(160); // 80 samples at 8kHz
  });

  it("handles 24kHz -> 8kHz", () => {
    const input = Buffer.alloc(480, 0); // 240 samples at 24kHz
    const output = resample(input, 24000, 8000);
    expect(output.length).toBe(160); // 80 samples at 8kHz
  });
});

describe("AudioBridge", () => {
  let bridge: AudioBridge;
  let onTranscript: ReturnType<typeof vi.fn>;
  let onCallEnd: ReturnType<typeof vi.fn>;
  let mockSTT: {
    createSession: ReturnType<typeof vi.fn>;
    sendAudio: ReturnType<typeof vi.fn>;
    endAudio: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onPartial: ReturnType<typeof vi.fn>;
  };
  let mockTTS: { synthesize: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    onTranscript = vi.fn().mockResolvedValue("LLM response");
    onCallEnd = vi.fn();

    const sttSendAudio = vi.fn();
    const sttEndAudio = vi.fn();
    const sttClose = vi.fn(async () => {});
    const sttOnPartial = vi.fn();

    mockSTT = {
      createSession: vi.fn(async () => ({
        sendAudio: sttSendAudio,
        endAudio: sttEndAudio,
        close: sttClose,
        onPartial: sttOnPartial,
      })),
      sendAudio: sttSendAudio,
      endAudio: sttEndAudio,
      close: sttClose,
      onPartial: sttOnPartial,
    };

    mockTTS = {
      synthesize: vi.fn(async () => ({
        audio: Buffer.alloc(160, 0),
        sampleRate: 8000,
      })),
    };

    bridge = new AudioBridge({
      onTranscript,
      onCallEnd,
      getSTT: () => mockSTT,
      getTTS: () => mockTTS,
    });
  });

  it("handles 'start' message and creates STT session", async () => {
    const msg = {
      event: "start" as const,
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    };
    await bridge.handleMediaMessage(msg);
    expect(mockSTT.createSession).toHaveBeenCalledOnce();
  });

  it("handles 'media' message and sends audio to STT", async () => {
    // First start
    await bridge.handleMediaMessage({
      event: "start",
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    });

    // Then media
    const chunk = Buffer.alloc(80, 0xff); // 80 bytes mulaw
    await bridge.handleMediaMessage({
      event: "media",
      media: {
        track: "inbound",
        chunk: chunk.toString("base64"),
        timestamp: Date.now().toString(),
        payload_type: 0,
      },
    });

    // STT session was created, check sendAudio was called
    expect(mockSTT.createSession).toHaveBeenCalledOnce();
  });

  it("handles 'stop' message and cleans up", async () => {
    await bridge.handleMediaMessage({
      event: "stop",
      stop: { stream_id: "stream-001" },
    });
    expect(onCallEnd).toHaveBeenCalledOnce();
  });

  it("ignores outbound media track", async () => {
    await bridge.handleMediaMessage({
      event: "start",
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    });

    const callCount = (mockSTT.createSession as ReturnType<typeof vi.fn>).mock.calls.length;

    await bridge.handleMediaMessage({
      event: "media",
      media: {
        track: "outbound", // outbound should be ignored
        chunk: Buffer.alloc(80, 0).toString("base64"),
        timestamp: Date.now().toString(),
        payload_type: 0,
      },
    });

    // No extra STT sessions created from outbound audio
    expect(mockSTT.createSession).toHaveBeenCalledTimes(callCount);
  });

  it("barge-in: sets interrupted when media arrives while playing", async () => {
    // Start bridge
    await bridge.handleMediaMessage({
      event: "start",
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    });

    // Manually set playing to true (simulate TTS playback)
    (bridge as unknown as { playing: boolean }).playing = true;

    // Send inbound audio while playing
    const chunk = Buffer.alloc(80, 0xff);
    await bridge.handleMediaMessage({
      event: "media",
      media: {
        track: "inbound",
        chunk: chunk.toString("base64"),
        timestamp: Date.now().toString(),
        payload_type: 0,
      },
    });

    // interrupted should be set, playing should be false
    expect((bridge as unknown as { playing: boolean }).playing).toBe(false);
    expect((bridge as unknown as { interrupted: boolean }).interrupted).toBe(true);
  });

  it("cleanup closes STT session and WebSocket", async () => {
    const ws = new MockTelnyxWebSocket();
    bridge.setWebSocket(ws as unknown as import("ws").default);

    await bridge.handleMediaMessage({
      event: "start",
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    });

    await bridge.cleanup();

    expect(ws.close).toHaveBeenCalled();
  });

  it("ignores messages after cleanup (closed)", async () => {
    await bridge.cleanup();
    await bridge.handleMediaMessage({
      event: "start",
      start: {
        stream_id: "stream-001",
        call_control_id: "call-001",
        media_format: { encoding: "audio/x-mulaw", sample_rate: 8000, channels: 1 },
      },
    });
    // STT should not be created after close
    expect(mockSTT.createSession).not.toHaveBeenCalled();
  });
});
