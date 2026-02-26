/**
 * Type definitions for WOPR Voice Call Plugin
 *
 * Shared types are re-exported from @wopr-network/plugin-types.
 * Plugin-specific types are defined locally below.
 */

export type {
  A2AServerConfig,
  A2AToolDefinition,
  A2AToolResult,
  AgentIdentity,
  ChannelCommand,
  ChannelMessageParser,
  ChannelProvider,
  ConfigField,
  ConfigSchema,
  SetupFlowType,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// ---------------------------------------------------------------------------
// Plugin-specific types
// ---------------------------------------------------------------------------

export type VoiceSessionState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceSession {
  id: string;
  sessionId: string;
  channelId: string;
  state: VoiceSessionState;
  startedAt: number;
  lastActivityAt: number;
}

export interface VoiceCallConfig {
  enabled?: boolean;
  defaultLanguage?: string;
  maxSessionDurationMs?: number;
  silenceTimeoutMs?: number;
  autoAnswer?: boolean;
}
