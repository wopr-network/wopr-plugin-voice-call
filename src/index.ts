import { CallManager } from "./call-manager.js";
import { voiceCallChannelProvider } from "./channel-provider.js";
import { voiceCallConfigSchema } from "./config.js";
import { logger } from "./logger.js";
import { PhoneNumberManager } from "./phone-numbers.js";
import { voiceCallStorageSchema } from "./schema.js";
import { TelnyxClient } from "./telnyx-client.js";
import type { VoiceCallPluginConfig, WOPRPlugin, WOPRPluginContext } from "./types.js";
import { WebhookHandler } from "./webhook-handler.js";

let ctx: WOPRPluginContext | null = null;
let callManager: CallManager | null = null;
let webhookHandler: WebhookHandler | null = null;
let phoneNumberManager: PhoneNumberManager | null = null;

const plugin: WOPRPlugin = {
  name: "wopr-plugin-voice-call",
  version: "0.1.0",
  description: "PSTN voice call channel via Telnyx",

  manifest: {
    name: "@wopr-network/wopr-plugin-voice-call",
    version: "0.1.0",
    description: "PSTN voice call channel via Telnyx — inbound/outbound phone calls through STT/LLM/TTS pipeline",
    author: "WOPR",
    license: "MIT",
    capabilities: ["voice-call", "telephony", "pstn"],
    category: "channel",
    requires: {
      env: ["TELNYX_API_KEY"],
      network: { outbound: true, inbound: true },
    },
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 30000,
    },
  },

  async init(context: WOPRPluginContext) {
    ctx = context;

    // 1. Register config schema
    ctx.registerConfigSchema("wopr-plugin-voice-call", voiceCallConfigSchema);

    // 2. Register storage schema
    await ctx.storage.register(voiceCallStorageSchema);

    // 3. Load config
    const config = ctx.getConfig<VoiceCallPluginConfig>();
    const apiKey = config?.apiKey || process.env.TELNYX_API_KEY;

    if (!apiKey) {
      logger.warn("Telnyx API key not configured — voice call plugin inactive");
      return;
    }

    // 4. Create Telnyx client
    const telnyxClient = new TelnyxClient({
      apiKey,
      connectionId: config?.connectionId,
      defaultCallerId: config?.defaultCallerId,
      webhookBaseUrl: config?.webhookBaseUrl,
    });

    // 5. Health check
    const healthy = await telnyxClient.healthCheck();
    if (!healthy) {
      logger.error("Telnyx API health check failed — check API key");
      return;
    }

    // 6. Create managers
    callManager = new CallManager(ctx, config || {}, telnyxClient);
    phoneNumberManager = new PhoneNumberManager(telnyxClient, ctx);
    webhookHandler = new WebhookHandler({
      telnyxClient,
      callManager,
      ctx,
      config: config || {},
    });

    // 7. Register channel provider
    ctx.registerChannelProvider(voiceCallChannelProvider);
    logger.info("Registered voice-call channel provider");

    // 8. Register extension (for other plugins to initiate outbound calls)
    ctx.registerExtension("voice-call", {
      initiateCall: async (to: string, from?: string) => {
        if (!callManager || !telnyxClient) throw new Error("Voice call plugin not initialized");
        const callerId = from || config?.defaultCallerId;
        if (!callerId) throw new Error("No caller ID configured");
        const webhookUrl = `${config?.webhookBaseUrl}/plugins/voice-call/webhook`;
        const result = await telnyxClient.createCall(to, callerId, webhookUrl);
        return callManager.initiateOutboundCall(to, callerId, "default", result);
      },
      getActiveCallCount: () => callManager?.activeCallCount || 0,
      getPhoneNumbers: (tenantId: string) => phoneNumberManager?.listForTenant(tenantId) || [],
      provisionNumber: (number: string, tenantId: string) => phoneNumberManager?.provision(number, tenantId),
      releaseNumber: (number: string, tenantId: string) => phoneNumberManager?.release(number, tenantId),
      searchNumbers: (opts: { country?: string; areaCode?: string }) => phoneNumberManager?.searchAvailable(opts),
      handleWebhookRequest: (rawBody: string, headers: Record<string, string | string[] | undefined>) =>
        webhookHandler?.handleWebhookRequest(rawBody, headers),
    });
    logger.info("Registered voice-call extension");

    // 9. Register capability provider
    if (ctx.registerProvider) {
      ctx.registerProvider({
        id: "telnyx-voice-call",
        name: "Telnyx Voice Call",
        type: "voice-call",
        configSchema: voiceCallConfigSchema,
      });
    }

    logger.info("Voice call plugin initialized");
  },

  async shutdown() {
    if (callManager) {
      await callManager.shutdownAll();
      callManager = null;
    }
    if (webhookHandler) {
      await webhookHandler.shutdown();
      webhookHandler = null;
    }
    if (ctx) {
      ctx.unregisterChannelProvider("voice-call");
      ctx.unregisterExtension("voice-call");
    }
    ctx = null;
    phoneNumberManager = null;
    logger.info("Voice call plugin shut down");
  },
};

export default plugin;
