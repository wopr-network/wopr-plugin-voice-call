/**
 * Mock Telnyx WebSocket for testing AudioBridge.
 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";

export class MockTelnyxWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockTelnyxWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockTelnyxWebSocket.CLOSED;
    this.emit("close");
  });

  /** Simulate Telnyx sending a "start" event */
  simulateStart(callControlId: string, streamId = "stream-001"): void {
    const msg = JSON.stringify({
      event: "start",
      start: {
        stream_id: streamId,
        call_control_id: callControlId,
        media_format: {
          encoding: "audio/x-mulaw",
          sample_rate: 8000,
          channels: 1,
        },
      },
    });
    this.emit("message", msg);
  }

  /** Simulate Telnyx sending a "media" event with mulaw audio */
  simulateMedia(chunk: Buffer, track: "inbound" | "outbound" = "inbound"): void {
    const msg = JSON.stringify({
      event: "media",
      media: {
        track,
        chunk: chunk.toString("base64"),
        timestamp: Date.now().toString(),
        payload_type: 0,
      },
    });
    this.emit("message", msg);
  }

  /** Simulate Telnyx sending a "stop" event */
  simulateStop(streamId = "stream-001"): void {
    const msg = JSON.stringify({
      event: "stop",
      stop: { stream_id: streamId },
    });
    this.emit("message", msg);
  }
}
