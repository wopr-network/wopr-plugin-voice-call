/**
 * WOPR Voice Call Plugin
 *
 * Orchestrates TTS + STT capability providers for full voice conversations.
 * Does NOT implement audio directly — requires at least one tts and one stt
 * capability provider to be installed.
 */

import { logger } from "./logger.js";
import type {
  ChannelCommand,
  ChannelMessageParser,
  ChannelProvider,
  ConfigSchema,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";
import { endAllVoiceSessions, endVoiceSession, getAllVoiceSessions } from "./voice-session.js";

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

// ============================================================================
// Config Schema
// ============================================================================

const configSchema: ConfigSchema = {
  title: "Voice Call",
  description: "Configure voice call orchestration",
  fields: [
    {
      name: "enabled",
      type: "checkbox",
      label: "Enabled",
      default: true,
      setupFlow: "none",
    },
    {
      name: "defaultLanguage",
      type: "text",
      label: "Default Language",
      placeholder: "en",
      default: "en",
      description: "Default language for speech recognition",
      setupFlow: "none",
    },
    {
      name: "maxSessionDurationMs",
      type: "number",
      label: "Max Session Duration (ms)",
      placeholder: "1800000",
      default: 1800000,
      description: "Maximum voice session duration (default: 30 minutes)",
      setupFlow: "none",
    },
    {
      name: "silenceTimeoutMs",
      type: "number",
      label: "Silence Timeout (ms)",
      placeholder: "30000",
      default: 30000,
      description: "End session after this much silence (default: 30 seconds)",
      setupFlow: "none",
    },
    {
      name: "autoAnswer",
      type: "checkbox",
      label: "Auto-Answer",
      default: false,
      description: "Automatically answer incoming voice requests",
      setupFlow: "none",
    },
  ],
};

// ============================================================================
// Channel Provider
// ============================================================================

const registeredCommands = new Map<string, ChannelCommand>();
const registeredParsers = new Map<string, ChannelMessageParser>();

const voiceCallChannelProvider: ChannelProvider = {
  id: "voice-call",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
    logger.info(`Channel command registered: ${cmd.name}`);
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
    logger.info(`Message parser registered: ${parser.id}`);
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channelId: string, content: string): Promise<void> {
    if (!ctx) throw new Error("Voice call plugin not initialized");
    logger.info(`Voice send (TTS): channelId=${channelId} contentLength=${content.length}`);
    throw new Error("send() not supported: voice-call uses TTS only");
  },

  getBotUsername(): string {
    return "voice-call";
  },
};

// ============================================================================
// Extension API
// ============================================================================

const voiceCallExtension = {
  getSessions: () => getAllVoiceSessions(),
  getSessionCount: () => getAllVoiceSessions().length,
  isActive: () => getAllVoiceSessions().length > 0,
};

// ============================================================================
// Manifest
// ============================================================================

const manifest = {
  name: "@wopr-network/wopr-plugin-voice-call",
  version: "1.0.0",
  description: "Voice call orchestration — coordinates TTS + STT for full voice conversations",
  author: "TSavo",
  license: "MIT",
  capabilities: ["voice-call", "channel"],
  category: "voice",
  tags: ["voice", "tts", "stt", "voice-call", "channel"],
  icon: "🎙️",
  requires: {
    network: { outbound: true },
  },
  lifecycle: {
    hotReload: false,
    shutdownBehavior: "graceful" as const,
    shutdownTimeoutMs: 10000,
  },
  configSchema,
  dependencies: [],
};

// ============================================================================
// Plugin
// ============================================================================

const plugin: WOPRPlugin = {
  name: "wopr-plugin-voice-call",
  version: "1.0.0",
  description: "Voice call orchestration — coordinates TTS + STT for full voice conversations",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // Register config schema
    ctx.registerConfigSchema("wopr-plugin-voice-call", configSchema);

    // Register channel provider
    ctx.registerChannelProvider(voiceCallChannelProvider);
    logger.info("Registered voice-call channel provider");

    // Register extension
    ctx.registerExtension("voice-call", voiceCallExtension);
    logger.info("Registered voice-call extension");

    // Register A2A tools (guarded)
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer({
        name: "voice-call",
        version: "1.0.0",
        tools: [
          {
            name: "voice-call.status",
            description: "Get the status of active voice sessions",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
              const sessions = getAllVoiceSessions();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      activeSessions: sessions.length,
                      sessions: sessions.map((s) => ({
                        id: s.id,
                        sessionId: s.sessionId,
                        state: s.state,
                        channelId: s.channelId,
                      })),
                    }),
                  },
                ],
              };
            },
          },
          {
            name: "voice-call.end-all",
            description: "End all active voice sessions",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
              const count = getAllVoiceSessions().length;
              endAllVoiceSessions();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Ended ${count} voice session(s)`,
                  },
                ],
              };
            },
          },
        ],
      });
      logger.info("Registered voice-call A2A tools");
    }

    // Check for TTS/STT availability
    const voice = ctx.hasVoice();
    if (!voice.tts || !voice.stt) {
      logger.warn(
        `Voice capabilities incomplete — voice-call requires both TTS and STT providers (hasTTS=${voice.tts}, hasSTT=${voice.stt})`,
      );
    }

    // Subscribe to events
    if (ctx.events?.on) {
      const unsubSessionEnd = ctx.events.on("session:destroy", (payload) => {
        endVoiceSession(payload.session);
      });
      if (typeof unsubSessionEnd === "function") {
        cleanups.push(unsubSessionEnd);
      }
    }
  },

  async shutdown() {
    // End all voice sessions
    endAllVoiceSessions();

    // Run all cleanup functions
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error: unknown) {
        logger.error(`Cleanup error: ${String(error)}`);
      }
    }
    cleanups.length = 0;

    // Unregister everything
    if (ctx) {
      ctx.unregisterConfigSchema("wopr-plugin-voice-call");
      ctx.unregisterChannelProvider("voice-call");
      ctx.unregisterExtension("voice-call");
    }

    // Clear module state
    registeredCommands.clear();
    registeredParsers.clear();
    ctx = null;

    logger.info("Voice call plugin stopped");
  },
};

export default plugin;
