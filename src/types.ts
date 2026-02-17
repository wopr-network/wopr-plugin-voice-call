/**
 * Type definitions for WOPR Voice Call plugin.
 */

// Re-export shared types from plugin-types
export type {
  ChannelAdapter,
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ChannelRef,
  ConfigField,
  ConfigSchema,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// ============================================================================
// Call State Machine
// ============================================================================

export type CallState = "ringing" | "answering" | "connected" | "hold" | "ending" | "ended" | "failed";

export type CallDirection = "inbound" | "outbound";

export interface CallRecord {
  id: string; // Internal call ID (UUID)
  telnyxCallControlId: string; // Telnyx call_control_id
  telnyxCallLegId: string; // Telnyx call_leg_id
  direction: CallDirection;
  from: string; // E.164 phone number
  to: string; // E.164 phone number
  tenantId: string;
  sessionId: string; // WOPR session ID this call is bound to
  state: CallState;
  startedAt: number; // Epoch ms
  connectedAt?: number; // When call was answered
  endedAt?: number;
  endReason?: string; // "hangup", "timeout", "error", etc.
  recording: boolean; // Whether call recording is enabled
  durationMs?: number; // Computed on end
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Telnyx API Types
// ============================================================================

export interface TelnyxConfig {
  /** Telnyx API key (V2 key starting with KEY...) */
  apiKey: string;
  /** Telnyx API base URL */
  baseUrl?: string;
  /** Telnyx Connection ID (SIP connection or TeXML) */
  connectionId?: string;
  /** Default outbound caller ID (E.164) */
  defaultCallerId?: string;
  /** Webhook URL base for inbound calls (e.g., https://yourserver.com) */
  webhookBaseUrl?: string;
  /** Webhook port to listen on locally (default: 0 = use daemon routes) */
  webhookPort?: number;
}

export interface TelnyxWebhookEvent {
  data: {
    event_type: string;
    id: string;
    occurred_at: string;
    payload: {
      call_control_id: string;
      call_leg_id: string;
      call_session_id: string;
      connection_id: string;
      from: string;
      to: string;
      direction: string;
      state: string;
      client_state?: string;
      media_url?: string; // WebSocket URL for media stream
      stream_id?: string;
      [key: string]: unknown;
    };
    record_type: string;
  };
  meta: {
    attempt: number;
    delivered_to: string;
  };
}

export interface TelnyxMediaMessage {
  event: "media" | "start" | "stop" | "mark";
  sequence_number?: number;
  media?: {
    track: "inbound" | "outbound";
    chunk: string; // Base64-encoded audio
    timestamp: string;
    payload_type: number; // RTP payload type
  };
  start?: {
    stream_id: string;
    call_control_id: string;
    media_format: {
      encoding: string; // "audio/x-mulaw" for Telnyx
      sample_rate: number; // 8000
      channels: number; // 1
    };
  };
  stop?: {
    stream_id: string;
  };
  mark?: {
    name: string;
  };
}

// ============================================================================
// Phone Number Management
// ============================================================================

export interface PhoneNumber {
  id: string; // Internal ID
  tenantId: string;
  phoneNumber: string; // E.164 format
  telnyxPhoneNumberId: string; // Telnyx resource ID
  displayName?: string;
  active: boolean;
  provisionedAt: number;
  releasedAt?: number;
}

// ============================================================================
// Audio Bridge Types
// ============================================================================

export interface AudioBridgeConfig {
  /** Audio format from Telnyx (default: mulaw 8kHz) */
  telnyxFormat: "mulaw" | "alaw";
  telnyxSampleRate: number; // 8000
  /** Buffer size in ms before flushing to STT */
  sttBufferMs: number; // 100ms default
  /** Silence detection threshold in ms */
  silenceThresholdMs: number; // 500ms
  /** Max silence before ending STT session */
  maxSilenceMs: number; // 2000ms
}

// ============================================================================
// Plugin Config (user-facing)
// ============================================================================

export interface VoiceCallPluginConfig {
  /** Telnyx API key */
  apiKey?: string;
  /** Telnyx Connection ID */
  connectionId?: string;
  /** Default outbound caller ID (E.164) */
  defaultCallerId?: string;
  /** Webhook base URL for inbound calls */
  webhookBaseUrl?: string;
  /**
   * Telnyx webhook signing secret (from the Telnyx portal → Webhooks → Signing Secret).
   * Used to verify HMAC-SHA256 signatures on incoming webhook requests.
   * When set, requests without a valid signature are rejected with 401.
   */
  webhookSigningSecret?: string;
  /** Default greeting message for inbound calls */
  greeting?: string;
  /** Default voice for TTS (provider-specific voice ID) */
  defaultVoice?: string;
  /** Enable call recording by default */
  recordByDefault?: boolean;
  /** Max concurrent calls per instance */
  maxConcurrentCalls?: number;
  /** BYOK: Twilio API credentials (alternative provider) */
  twilioAccountSid?: string;
  twilioAuthToken?: string;
}
