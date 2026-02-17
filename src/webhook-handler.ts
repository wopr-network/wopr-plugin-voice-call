import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import type { CallManager } from "./call-manager.js";
import { logger } from "./logger.js";
import type { TelnyxClient } from "./telnyx-client.js";
import type { TelnyxWebhookEvent, VoiceCallPluginConfig, WOPRPluginContext } from "./types.js";

export class WebhookHandler {
  private telnyxClient: TelnyxClient;
  private callManager: CallManager;
  private ctx: WOPRPluginContext;
  private config: VoiceCallPluginConfig;
  private mediaWsServer: WebSocketServer | null = null;

  constructor(opts: {
    telnyxClient: TelnyxClient;
    callManager: CallManager;
    ctx: WOPRPluginContext;
    config: VoiceCallPluginConfig;
  }) {
    this.telnyxClient = opts.telnyxClient;
    this.callManager = opts.callManager;
    this.ctx = opts.ctx;
    this.config = opts.config;
  }

  /** Handle a Telnyx webhook POST body */
  async handleWebhook(event: TelnyxWebhookEvent): Promise<{ status: number; body?: unknown }> {
    const eventType = event.data.event_type;
    const payload = event.data.payload;
    const callControlId = payload.call_control_id;

    logger.info({ msg: "Webhook received", eventType, callControlId });

    switch (eventType) {
      case "call.initiated":
        return this.handleCallInitiated(payload);

      case "call.answered":
        return this.handleCallAnswered(callControlId, payload);

      case "streaming.started":
        return this.handleStreamingStarted(callControlId);

      case "call.hangup":
        return this.handleCallHangup(callControlId);

      case "streaming.stopped":
        // No-op, cleanup handled by hangup
        return { status: 200 };

      default:
        logger.debug({ msg: "Unhandled webhook event", eventType });
        return { status: 200 };
    }
  }

  /** Handle call.initiated — new inbound call */
  private async handleCallInitiated(
    payload: TelnyxWebhookEvent["data"]["payload"],
  ): Promise<{ status: number; body?: unknown }> {
    if (payload.direction !== "incoming") {
      // Outbound calls are initiated by us, just track state
      return { status: 200 };
    }

    const callControlId = payload.call_control_id;
    const from = payload.from;
    const to = payload.to;

    // Resolve tenantId from phone number lookup
    const tenantId = await this.resolveTenantId(to);

    // Register and answer
    const call = await this.callManager.registerInboundCall(callControlId, payload.call_leg_id, from, to, tenantId);

    if (!call) {
      // At capacity, reject
      await this.telnyxClient.hangup(callControlId);
      return { status: 200, body: { rejected: true, reason: "capacity" } };
    }

    // Answer the call
    this.callManager.transitionCall(callControlId, "answering");
    await this.telnyxClient.answerCall(callControlId);

    return { status: 200 };
  }

  /** Resolve tenantId from the destination phone number */
  private async resolveTenantId(_to: string): Promise<string> {
    // TODO: look up phone_numbers table to find which tenant owns this number
    // For now, use "default"
    return "default";
  }

  /** Handle call.answered — call connected, start media streaming */
  private async handleCallAnswered(
    callControlId: string,
    payload: TelnyxWebhookEvent["data"]["payload"],
  ): Promise<{ status: number }> {
    void payload; // payload available for future use
    this.callManager.transitionCall(callControlId, "connected");

    const call = this.callManager.getCall(callControlId);
    if (!call) return { status: 200 };

    // Start recording if configured
    if (call.record.recording) {
      await this.telnyxClient
        .startRecording(callControlId)
        .catch((err) => logger.error({ msg: "Failed to start recording", error: String(err) }));
    }

    // Start media streaming - Telnyx will connect a WebSocket to our media endpoint
    const baseUrl = this.config.webhookBaseUrl || "";
    const streamUrl = `${baseUrl.replace("https://", "wss://").replace("http://", "ws://")}/plugins/voice-call/media-stream`;
    await this.telnyxClient.startMediaStream(callControlId, streamUrl);

    // Store greeting to play after stream starts
    const greeting = this.config.greeting || "Hello, how can I help you today?";
    (call as unknown as { pendingGreeting?: string }).pendingGreeting = greeting;

    return { status: 200 };
  }

  /** Handle streaming.started — media WebSocket is ready */
  private async handleStreamingStarted(callControlId: string): Promise<{ status: number }> {
    const call = this.callManager.getCall(callControlId);
    if (!call) return { status: 200 };

    // Play pending greeting — handled via bridge once WS is connected
    const pending = (call as unknown as { pendingGreeting?: string }).pendingGreeting;
    if (pending) {
      delete (call as unknown as { pendingGreeting?: string }).pendingGreeting;
      logger.info({ msg: "Streaming started, greeting will play once WS bridge connects", callControlId });
    }

    return { status: 200 };
  }

  /** Handle call.hangup */
  private async handleCallHangup(callControlId: string): Promise<{ status: number }> {
    await this.callManager.endCall(callControlId, "hangup");
    return { status: 200 };
  }

  /** Create a WebSocket server for Telnyx media streams */
  startMediaWsServer(port: number): void {
    this.mediaWsServer = new WebSocketServer({ port });
    this.mediaWsServer.on("connection", (ws: WebSocket, req: { url?: string }) => {
      logger.info({ msg: "Media WS connected", url: req.url });
      // Telnyx sends the call_control_id in the first "start" message
      ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as { event: string; start?: { call_control_id?: string } };
          if (msg.event === "start" && msg.start?.call_control_id) {
            const call = this.callManager.getCall(msg.start.call_control_id);
            if (call) {
              call.bridge.setWebSocket(ws);
            }
          }
        } catch {
          // Non-JSON or parse error — ignore
        }
      });
    });
    logger.info({ msg: "Media WebSocket server started", port });
  }

  /** Shut down the media WS server */
  async shutdown(): Promise<void> {
    if (this.mediaWsServer) {
      await new Promise<void>((resolve) => {
        this.mediaWsServer?.close(() => resolve());
      });
      this.mediaWsServer = null;
    }
  }

  /** Expose ctx for potential extension use */
  getCtx(): WOPRPluginContext {
    return this.ctx;
  }
}
