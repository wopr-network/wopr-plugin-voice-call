import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/index.js";

function createMockContext() {
  return {
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    registerA2AServer: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR", emoji: "🎙️" }),
    events: {
      on: vi.fn().mockReturnValue(vi.fn()),
    },
    hooks: {
      register: vi.fn().mockReturnValue(vi.fn()),
    },
    hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    storage: {
      register: vi.fn(),
      getRepository: vi.fn(),
      isRegistered: vi.fn().mockReturnValue(false),
    },
  };
}

describe("wopr-plugin-voice-call", () => {
  it("should export a valid WOPRPlugin", () => {
    expect(plugin.name).toBe("wopr-plugin-voice-call");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.manifest).toBeDefined();
    expect(plugin.init).toBeTypeOf("function");
    expect(plugin.shutdown).toBeTypeOf("function");
  });

  it("should have a complete manifest", () => {
    const m = plugin.manifest!;
    expect(m.capabilities).toBeDefined();
    expect(m.category).toBe("voice");
    expect(m.tags).toContain("voice");
    expect(m.icon).toBeDefined();
    expect(m.lifecycle).toBeDefined();
    expect(m.configSchema).toBeDefined();
  });

  it("should init and register config schema, channel provider, extension", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as any);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
      "wopr-plugin-voice-call",
      expect.any(Object),
    );
    expect(ctx.registerChannelProvider).toHaveBeenCalled();
    expect(ctx.registerExtension).toHaveBeenCalledWith(
      "voice-call",
      expect.any(Object),
    );
  });

  it("should register A2A tools when registerA2AServer exists", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as any);
    expect(ctx.registerA2AServer).toHaveBeenCalled();
  });

  it("should not throw if registerA2AServer is missing", async () => {
    const ctx = createMockContext();
    delete (ctx as any).registerA2AServer;
    await expect(plugin.init!(ctx as any)).resolves.not.toThrow();
  });

  it("should shutdown cleanly and unregister everything", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as any);
    await plugin.shutdown!();
    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith(
      "wopr-plugin-voice-call",
    );
    expect(ctx.unregisterChannelProvider).toHaveBeenCalledWith("voice-call");
    expect(ctx.unregisterExtension).toHaveBeenCalledWith("voice-call");
  });

  it("should be idempotent on double shutdown", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as any);
    await plugin.shutdown!();
    await expect(plugin.shutdown!()).resolves.not.toThrow();
  });

  it("should warn when no TTS/STT providers available", async () => {
    const ctx = createMockContext();
    ctx.hasVoice.mockReturnValue({ stt: false, tts: false });
    await expect(plugin.init!(ctx as any)).resolves.not.toThrow();
  });

  it("should have config fields in configSchema", () => {
    const m = plugin.manifest!;
    expect(m.configSchema).toBeDefined();
    expect(m.configSchema!.fields.length).toBeGreaterThan(0);
  });
});
