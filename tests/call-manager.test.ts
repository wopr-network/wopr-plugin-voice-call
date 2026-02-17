import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallManager } from "../src/call-manager.js";
import { createMockContext } from "./mocks/wopr-context.js";

describe("CallManager", () => {
  let manager: CallManager;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    manager = new CallManager(ctx, { maxConcurrentCalls: 3 });
  });

  describe("canAcceptCall", () => {
    it("returns true when no active calls", () => {
      expect(manager.canAcceptCall()).toBe(true);
    });

    it("returns false when at max capacity", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+15551111111", "+15550000001", "t1");
      await manager.registerInboundCall("cc-002", "leg-002", "+15552222222", "+15550000001", "t1");
      await manager.registerInboundCall("cc-003", "leg-003", "+15553333333", "+15550000001", "t1");
      expect(manager.canAcceptCall()).toBe(false);
    });
  });

  describe("registerInboundCall", () => {
    it("creates call record with correct state", async () => {
      const call = await manager.registerInboundCall(
        "cc-001",
        "leg-001",
        "+15551234567",
        "+15559876543",
        "tenant-001",
      );
      expect(call).not.toBeNull();
      expect(call!.record.state).toBe("ringing");
      expect(call!.record.direction).toBe("inbound");
      expect(call!.record.from).toBe("+15551234567");
      expect(call!.record.to).toBe("+15559876543");
      expect(call!.record.tenantId).toBe("tenant-001");
      expect(call!.record.telnyxCallControlId).toBe("cc-001");
    });

    it("increments activeCallCount", async () => {
      expect(manager.activeCallCount).toBe(0);
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      expect(manager.activeCallCount).toBe(1);
    });

    it("returns null when at capacity", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      await manager.registerInboundCall("cc-002", "leg-002", "+3", "+2", "t1");
      await manager.registerInboundCall("cc-003", "leg-003", "+5", "+2", "t1");

      const result = await manager.registerInboundCall("cc-004", "leg-004", "+7", "+2", "t1");
      expect(result).toBeNull();
    });

    it("emits voice-call:started event", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      expect(ctx.events.emitCustom).toHaveBeenCalledWith("voice-call:started", expect.objectContaining({
        direction: "inbound",
      }));
    });

    it("inserts record into storage", async () => {
      const mockRepo = ctx.storage.getRepository("voice_call", "calls");
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      expect(mockRepo.insert).toHaveBeenCalledOnce();
    });
  });

  describe("endCall", () => {
    it("transitions to ended and decrements activeCallCount", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      expect(manager.activeCallCount).toBe(1);

      await manager.endCall("cc-001", "hangup");
      expect(manager.activeCallCount).toBe(0);
    });

    it("computes durationMs for connected calls", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      manager.transitionCall("cc-001", "answering");
      manager.transitionCall("cc-001", "connected");

      await new Promise((r) => setTimeout(r, 10)); // small delay
      await manager.endCall("cc-001", "hangup");

      // Duration should be > 0 since connectedAt was set
      const mockRepo = ctx.storage.getRepository("voice_call", "calls");
      const updateCall = (mockRepo.update as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).durationMs !== undefined,
      );
      expect(updateCall).toBeDefined();
      const durationMs = (updateCall![1] as Record<string, unknown>).durationMs as number;
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it("emits voice-call:ended event", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      await manager.endCall("cc-001", "hangup");
      expect(ctx.events.emitCustom).toHaveBeenCalledWith("voice-call:ended", expect.objectContaining({
        reason: "hangup",
      }));
    });

    it("is idempotent for unknown call IDs", async () => {
      // Should not throw
      await expect(manager.endCall("nonexistent", "hangup")).resolves.toBeUndefined();
    });
  });

  describe("shutdownAll", () => {
    it("ends all active calls", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      await manager.registerInboundCall("cc-002", "leg-002", "+3", "+2", "t1");
      expect(manager.activeCallCount).toBe(2);

      await manager.shutdownAll();
      expect(manager.activeCallCount).toBe(0);
    });
  });

  describe("transitionCall", () => {
    it("updates call state via FSM", async () => {
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      manager.transitionCall("cc-001", "answering");
      const call = manager.getCall("cc-001");
      expect(call?.record.state).toBe("answering");
    });

    it("sets connectedAt when transitioning to connected", async () => {
      const before = Date.now();
      await manager.registerInboundCall("cc-001", "leg-001", "+1", "+2", "t1");
      manager.transitionCall("cc-001", "answering");
      manager.transitionCall("cc-001", "connected");
      const after = Date.now();

      const call = manager.getCall("cc-001");
      expect(call?.record.connectedAt).toBeGreaterThanOrEqual(before);
      expect(call?.record.connectedAt).toBeLessThanOrEqual(after);
    });

    it("is a no-op for unknown callControlId", () => {
      // Should not throw
      expect(() => manager.transitionCall("nonexistent", "answering")).not.toThrow();
    });
  });
});
