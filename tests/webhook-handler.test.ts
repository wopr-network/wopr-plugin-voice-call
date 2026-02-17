import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookHandler } from "../src/webhook-handler.js";
import { CallManager } from "../src/call-manager.js";
import { createMockContext } from "./mocks/wopr-context.js";
import type { TelnyxClient } from "../src/telnyx-client.js";
import type { TelnyxWebhookEvent } from "../src/types.js";

function createMockTelnyxClient(): TelnyxClient {
  return {
    answerCall: vi.fn().mockResolvedValue(undefined),
    hangup: vi.fn().mockResolvedValue(undefined),
    startMediaStream: vi.fn().mockResolvedValue(undefined),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    createCall: vi.fn(),
    searchNumbers: vi.fn(),
    orderNumber: vi.fn(),
    releaseNumber: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as TelnyxClient;
}

function makeWebhookEvent(eventType: string, overrides: Partial<TelnyxWebhookEvent["data"]["payload"]> = {}): TelnyxWebhookEvent {
  return {
    data: {
      event_type: eventType,
      id: "event-001",
      occurred_at: new Date().toISOString(),
      payload: {
        call_control_id: "cc-001",
        call_leg_id: "leg-001",
        call_session_id: "sess-001",
        connection_id: "conn-001",
        from: "+15551234567",
        to: "+15559876543",
        direction: "incoming",
        state: "parked",
        ...overrides,
      },
      record_type: "event",
    },
    meta: {
      attempt: 1,
      delivered_to: "https://webhook.example.com",
    },
  };
}

describe("WebhookHandler", () => {
  let handler: WebhookHandler;
  let mockTelnyx: TelnyxClient;
  let callManager: CallManager;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mockTelnyx = createMockTelnyxClient();
    ctx = createMockContext();
    callManager = new CallManager(ctx, { maxConcurrentCalls: 2 });

    handler = new WebhookHandler({
      telnyxClient: mockTelnyx,
      callManager,
      ctx,
      config: {
        webhookBaseUrl: "https://webhook.example.com",
        greeting: "Hello there!",
      },
    });
  });

  describe("call.initiated (inbound)", () => {
    it("registers call and answers when capacity available", async () => {
      const event = makeWebhookEvent("call.initiated");
      const result = await handler.handleWebhook(event);

      expect(result.status).toBe(200);
      expect(mockTelnyx.answerCall).toHaveBeenCalledWith("cc-001");
      expect(callManager.activeCallCount).toBe(1);
    });

    it("rejects call with hangup when at max capacity", async () => {
      // Fill up capacity (max = 2)
      const event1 = makeWebhookEvent("call.initiated", { call_control_id: "cc-001", call_leg_id: "leg-001" });
      const event2 = makeWebhookEvent("call.initiated", { call_control_id: "cc-002", call_leg_id: "leg-002" });
      await handler.handleWebhook(event1);
      await handler.handleWebhook(event2);

      // Third call should be rejected
      const event3 = makeWebhookEvent("call.initiated", { call_control_id: "cc-003", call_leg_id: "leg-003" });
      const result = await handler.handleWebhook(event3);

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ rejected: true, reason: "capacity" });
      expect(mockTelnyx.hangup).toHaveBeenCalledWith("cc-003");
    });

    it("does not register outbound calls via call.initiated", async () => {
      const event = makeWebhookEvent("call.initiated", { direction: "outgoing" });
      const result = await handler.handleWebhook(event);

      expect(result.status).toBe(200);
      expect(callManager.activeCallCount).toBe(0);
      expect(mockTelnyx.answerCall).not.toHaveBeenCalled();
    });
  });

  describe("call.answered", () => {
    it("transitions call to connected and starts media stream", async () => {
      // First register a call
      await handler.handleWebhook(makeWebhookEvent("call.initiated"));

      // Then answer
      const result = await handler.handleWebhook(makeWebhookEvent("call.answered"));
      expect(result.status).toBe(200);
      expect(mockTelnyx.startMediaStream).toHaveBeenCalledWith(
        "cc-001",
        expect.stringContaining("/plugins/voice-call/media-stream"),
      );

      const call = callManager.getCall("cc-001");
      expect(call?.record.state).toBe("connected");
    });

    it("starts recording when configured", async () => {
      const recCallManager = new CallManager(ctx, { maxConcurrentCalls: 2, recordByDefault: true });
      const recHandler = new WebhookHandler({
        telnyxClient: mockTelnyx,
        callManager: recCallManager,
        ctx,
        config: {
          webhookBaseUrl: "https://webhook.example.com",
          recordByDefault: true,
        },
      });

      await recHandler.handleWebhook(makeWebhookEvent("call.initiated"));
      await recHandler.handleWebhook(makeWebhookEvent("call.answered"));

      expect(mockTelnyx.startRecording).toHaveBeenCalledWith("cc-001");
    });
  });

  describe("call.hangup", () => {
    it("ends the call on hangup", async () => {
      await handler.handleWebhook(makeWebhookEvent("call.initiated"));
      expect(callManager.activeCallCount).toBe(1);

      const result = await handler.handleWebhook(makeWebhookEvent("call.hangup"));
      expect(result.status).toBe(200);
      expect(callManager.activeCallCount).toBe(0);
    });
  });

  describe("unknown events", () => {
    it("returns 200 for unhandled event types without crashing", async () => {
      const event = makeWebhookEvent("some.unknown.event");
      const result = await handler.handleWebhook(event);
      expect(result.status).toBe(200);
    });

    it("handles streaming.stopped gracefully", async () => {
      const event = makeWebhookEvent("streaming.stopped");
      const result = await handler.handleWebhook(event);
      expect(result.status).toBe(200);
    });
  });
});
