/**
 * Mock WOPRPluginContext for testing wopr-plugin-voice-call.
 */
import { vi } from "vitest";
import type { WOPREventBus, WOPRPluginContext } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock Event Bus
// ---------------------------------------------------------------------------
export function createMockEventBus(overrides: Partial<WOPREventBus> = {}): WOPREventBus {
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!handlers.has(event)) handlers.set(event, []);
      const wrapper = (...args: unknown[]) => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(wrapper);
          if (idx >= 0) list.splice(idx, 1);
        }
        return handler(...args);
      };
      handlers.get(event)!.push(wrapper);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      const list = handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    emit: vi.fn(async (event: string, payload: unknown) => {
      const list = handlers.get(event) || [];
      for (const h of list) await h(payload, { type: event, payload, timestamp: Date.now() });
    }),
    emitCustom: vi.fn(async (event: string, payload: unknown) => {
      const list = handlers.get(event) || [];
      for (const h of list) await h(payload, { type: event, payload, timestamp: Date.now() });
    }),
    listenerCount: vi.fn((event: string) => (handlers.get(event) || []).length),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Repository
// ---------------------------------------------------------------------------
export function createMockRepository() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    insert: vi.fn(async (data: Record<string, unknown>) => {
      store.set(data.id as string, { ...data });
      return data;
    }),
    insertMany: vi.fn(async (data: Record<string, unknown>[]) => {
      for (const d of data) store.set(d.id as string, { ...d });
      return data;
    }),
    findById: vi.fn(async (id: string) => store.get(id) || null),
    findFirst: vi.fn(async (filter: Record<string, unknown>) => {
      for (const [, v] of store) {
        if (Object.entries(filter).every(([k, val]) => v[k] === val)) return v;
      }
      return null;
    }),
    findMany: vi.fn(async (filter?: Record<string, unknown>) => {
      if (!filter) return Array.from(store.values());
      return Array.from(store.values()).filter((v) =>
        Object.entries(filter).every(([k, val]) => v[k] === val),
      );
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Not found: ${id}`);
      const updated = { ...existing, ...data };
      store.set(id, updated);
      return updated;
    }),
    updateMany: vi.fn(async () => 0),
    delete: vi.fn(async (id: string) => store.delete(id)),
    deleteMany: vi.fn(async () => 0),
    count: vi.fn(async () => store.size),
    exists: vi.fn(async (id: string) => store.has(id)),
    query: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: vi.fn(async () => []),
    })),
    raw: vi.fn(async () => []),
    transaction: vi.fn(async (fn: (repo: unknown) => Promise<unknown>) => fn({})),
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Mock STT Provider
// ---------------------------------------------------------------------------
export function createMockSTT() {
  return {
    metadata: { name: "mock-stt", type: "stt" as const },
    createSession: vi.fn(async () => ({
      sendAudio: vi.fn(),
      endAudio: vi.fn(),
      onPartial: vi.fn(),
      close: vi.fn(async () => {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock TTS Provider
// ---------------------------------------------------------------------------
export function createMockTTS() {
  return {
    metadata: { name: "mock-tts", type: "tts" as const },
    synthesize: vi.fn(async (_text: string) => ({
      audio: Buffer.alloc(160), // 20ms of silence at 8kHz mulaw
      sampleRate: 8000,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock WOPRPluginContext
// ---------------------------------------------------------------------------
export function createMockContext(overrides: Partial<WOPRPluginContext> = {}): WOPRPluginContext {
  const mockRepo = createMockRepository();
  const mockSTT = createMockSTT();
  const mockTTS = createMockTTS();

  return {
    inject: vi.fn().mockResolvedValue("Mock response"),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn().mockResolvedValue({
      name: "TestAgent",
      creature: "owl",
      vibe: "chill",
      emoji: "🦉",
    }),
    getUserProfile: vi.fn().mockResolvedValue({
      name: "Test User",
      preferredAddress: "test@example.com",
    }),
    getSessions: vi.fn().mockReturnValue([]),
    cancelInject: vi.fn().mockReturnValue(false),
    events: createMockEventBus(),
    hooks: {
      register: vi.fn(),
      unregister: vi.fn(),
      emit: vi.fn(),
    } as unknown as WOPRPluginContext["hooks"],
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn().mockReturnValue(undefined),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn().mockReturnValue(undefined),
    getChannels: vi.fn().mockReturnValue([]),
    getChannelsForSession: vi.fn().mockReturnValue([]),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn().mockReturnValue([]),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({}),
    saveConfig: vi.fn(async () => {}),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(undefined),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn().mockReturnValue(undefined),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn().mockReturnValue(undefined),
    listExtensions: vi.fn().mockReturnValue([]),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn().mockReturnValue(mockSTT),
    getTTS: vi.fn().mockReturnValue(mockTTS),
    hasVoice: vi.fn().mockReturnValue({ stt: true, tts: true }),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn().mockReturnValue(undefined),
    getChannelProviders: vi.fn().mockReturnValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    storage: {
      driver: "sqlite" as const,
      register: vi.fn(async () => {}),
      getRepository: vi.fn().mockReturnValue(mockRepo),
      isRegistered: vi.fn().mockReturnValue(false),
      getVersion: vi.fn().mockResolvedValue(1),
      raw: vi.fn(async () => []),
      transaction: vi.fn(async (fn: (storage: unknown) => Promise<unknown>) => fn({})),
    },
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-test/plugins/voice-call"),
    ...overrides,
  };
}
