import WebSocket from "ws";
import { logger } from "./logger.js";
import type { AudioBridgeConfig, TelnyxMediaMessage } from "./types.js";

// mulaw decode table (standard ITU-T G.711)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMulawTable() {
  for (let i = 0; i < 256; i++) {
    const mulaw = ~i & 0xff;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    let mantissa = mulaw & 0x0f;
    mantissa = (mantissa << 1) | 0x21;
    mantissa <<= exponent;
    mantissa -= 0x21;
    MULAW_DECODE_TABLE[i] = sign ? -mantissa : mantissa;
  }
})();

// mulaw encode (inverse of decode)
function encodeMulaw(sample: number): number {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  let sign = 0;
  let s = sample;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  s = Math.min(s, MULAW_MAX);
  s += MULAW_BIAS;
  let exponent = 7;
  const expMask = 0x4000;
  for (; exponent > 0; exponent--) {
    if (s & expMask) break;
    s <<= 1;
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Convert mulaw Buffer to PCM Int16 Buffer */
export function mulawToPcm(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(MULAW_DECODE_TABLE[mulaw[i] as number] as number, i * 2);
  }
  return pcm;
}

/** Convert PCM Int16 Buffer to mulaw Buffer */
export function pcmToMulaw(pcm: Buffer): Buffer {
  const mulaw = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    mulaw[i] = encodeMulaw(pcm.readInt16LE(i * 2));
  }
  return mulaw;
}

/** Simple linear resampler (e.g., 8kHz -> 16kHz or 24kHz -> 8kHz) */
export function resample(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor(inputSamples * ratio);
  const output = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i++) {
    const srcIdx = Math.min(Math.floor(i / ratio), inputSamples - 1);
    output.writeInt16LE(input.readInt16LE(srcIdx * 2), i * 2);
  }
  return output;
}

interface STTSession {
  sendAudio: (buf: Buffer) => void;
  endAudio: () => void;
  onPartial?: (cb: (c: { text: string; isFinal: boolean }) => void) => void;
  close: () => Promise<void>;
}

/**
 * AudioBridge manages the bidirectional audio flow for a single call.
 *
 * Lifecycle:
 * 1. Telnyx sends "start" event -> bridge initializes STT session
 * 2. Telnyx sends "media" events -> bridge decodes mulaw, resamples, feeds STT
 * 3. STT emits partial/final transcript -> on final, bridge calls onTranscript callback
 * 4. Callback returns LLM response text -> bridge synthesizes via TTS
 * 5. TTS audio -> resample to 8kHz -> encode mulaw -> send back over Telnyx WS
 * 6. Telnyx sends "stop" or call ends -> bridge cleans up
 */
export class AudioBridge {
  private ws: WebSocket | null = null;
  private streamId: string | null = null;
  private sttSession: STTSession | null = null;
  private playing = false; // True while TTS audio is being sent
  private interrupted = false; // True if barge-in detected while playing
  private closed = false;
  private callEndFired = false; // Idempotence guard for onCallEnd()
  private readonly config: AudioBridgeConfig;

  private onTranscript: (text: string) => Promise<string>; // Returns LLM response
  private onCallEnd: () => void;
  private getSTT: () => unknown; // ctx.getSTT()
  private getTTS: () => unknown; // ctx.getTTS()

  constructor(opts: {
    config?: Partial<AudioBridgeConfig>;
    onTranscript: (text: string) => Promise<string>;
    onCallEnd: () => void;
    getSTT: () => unknown;
    getTTS: () => unknown;
  }) {
    this.config = {
      telnyxFormat: "mulaw",
      telnyxSampleRate: 8000,
      sttBufferMs: 100,
      silenceThresholdMs: 500,
      maxSilenceMs: 2000,
      ...opts.config,
    };
    this.onTranscript = opts.onTranscript;
    this.onCallEnd = opts.onCallEnd;
    this.getSTT = opts.getSTT;
    this.getTTS = opts.getTTS;
  }

  /** Handle a Telnyx media WebSocket message */
  async handleMediaMessage(msg: TelnyxMediaMessage): Promise<void> {
    if (this.closed) return;

    switch (msg.event) {
      case "start":
        this.streamId = msg.start?.stream_id || null;
        await this.startSTTSession();
        break;

      case "media":
        if (msg.media?.track === "inbound" && msg.media.chunk) {
          // Barge-in detection: if caller speaks while TTS is playing, interrupt
          if (this.playing) {
            this.interrupted = true;
            this.playing = false;
          }
          const mulaw = Buffer.from(msg.media.chunk, "base64");
          const pcm = mulawToPcm(mulaw);
          // Resample from 8kHz to STT expected rate (usually 16kHz)
          const resampled = resample(pcm, this.config.telnyxSampleRate, 16000);
          this.sttSession?.sendAudio(resampled);
        }
        break;

      case "stop":
        await this.cleanup();
        if (!this.callEndFired) {
          this.callEndFired = true;
          this.onCallEnd();
        }
        break;

      default:
        break;
    }
  }

  /** Start a new STT session for capturing caller speech */
  private async startSTTSession(): Promise<void> {
    const stt = this.getSTT() as { createSession: (opts: unknown) => Promise<STTSession> } | null;
    if (!stt) {
      logger.error("No STT provider available");
      return;
    }
    this.sttSession = await stt.createSession({
      language: "en",
      sampleRate: 16000,
      vadEnabled: true,
    });
    // Listen for final transcripts
    this.sttSession?.onPartial?.((chunk: { text: string; isFinal: boolean }) => {
      if (chunk.isFinal && chunk.text.trim()) {
        void this.handleFinalTranscript(chunk.text.trim());
      }
    });
  }

  /** Handle a final transcript from STT */
  private async handleFinalTranscript(text: string): Promise<void> {
    if (this.closed) return;
    logger.info({ msg: "Transcript received", text });

    try {
      // Get LLM response
      const response = await this.onTranscript(text);
      if (this.closed || !response) return;

      // Synthesize TTS audio
      await this.playTTSResponse(response);

      // Restart STT session for next utterance — close the existing one first to avoid leaks
      if (this.sttSession) {
        this.sttSession.endAudio();
        await this.sttSession.close();
        this.sttSession = null;
      }
      await this.startSTTSession();
    } catch (err) {
      logger.error({ msg: "Transcript handling failed", error: String(err) });
    }
  }

  /** Synthesize and play TTS response back to caller */
  private async playTTSResponse(text: string): Promise<void> {
    const tts = this.getTTS() as {
      synthesize: (t: string, o?: unknown) => Promise<{ audio: Buffer; sampleRate: number }>;
    } | null;
    if (!tts) {
      logger.error("No TTS provider available");
      return;
    }

    this.playing = true;
    this.interrupted = false;

    const result = await tts.synthesize(text, { format: "pcm_s16le" });
    if (this.interrupted || this.closed) return;

    // Resample from TTS sample rate to 8kHz
    const resampled = resample(result.audio, result.sampleRate, this.config.telnyxSampleRate);
    // Encode to mulaw
    const mulaw = pcmToMulaw(resampled);

    // Send in chunks (~20ms frames = 160 bytes at 8kHz mulaw)
    const FRAME_SIZE = 160;
    for (let i = 0; i < mulaw.length; i += FRAME_SIZE) {
      if (this.interrupted || this.closed) break;
      const chunk = mulaw.subarray(i, Math.min(i + FRAME_SIZE, mulaw.length));
      this.sendAudioChunk(chunk);
      // Pace sending to approximately real-time (20ms per frame)
      await new Promise((r) => setTimeout(r, 20));
    }

    this.playing = false;
  }

  /** Send a mulaw audio chunk back to Telnyx via WebSocket */
  private sendAudioChunk(mulaw: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      event: "media",
      stream_id: this.streamId,
      media: {
        track: "outbound",
        chunk: mulaw.toString("base64"),
        payload_type: 0,
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Set the Telnyx WebSocket connection for this bridge */
  setWebSocket(ws: WebSocket): void {
    this.ws = ws;
    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as TelnyxMediaMessage;
        void this.handleMediaMessage(msg);
      } catch (err) {
        logger.error({ msg: "Failed to parse Telnyx media message", error: String(err) });
      }
    });
    ws.on("close", () => {
      void this.cleanup().then(() => {
        if (!this.callEndFired) {
          this.callEndFired = true;
          this.onCallEnd();
        }
      });
    });
    ws.on("error", (err) => {
      logger.error({ msg: "Telnyx WS error", error: String(err) });
    });
  }

  /** Clean up all resources */
  async cleanup(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.playing = false;
    if (this.sttSession) {
      this.sttSession.endAudio();
      await this.sttSession.close();
      this.sttSession = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }
}
