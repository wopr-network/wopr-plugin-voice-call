import { logger } from "./logger.js";
import type { TelnyxConfig } from "./types.js";

export class TelnyxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly connectionId: string;

  constructor(config: TelnyxConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.telnyx.com/v2").replace(/\/+$/, "");
    this.connectionId = config.connectionId || "";
  }

  // ---- Private helpers ----

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Telnyx API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  // ---- Call Control ----

  /** Answer an inbound call */
  async answerCall(callControlId: string, clientState?: string): Promise<void> {
    await this.request("POST", `/calls/${callControlId}/actions/answer`, {
      client_state: clientState ? Buffer.from(clientState).toString("base64") : undefined,
    });
  }

  /** Initiate an outbound call */
  async createCall(
    to: string,
    from: string,
    webhookUrl: string,
    clientState?: string,
  ): Promise<{ callControlId: string; callLegId: string; callSessionId: string }> {
    const result = (await this.request("POST", "/calls", {
      connection_id: this.connectionId,
      to,
      from,
      webhook_url: webhookUrl,
      webhook_url_method: "POST",
      client_state: clientState ? Buffer.from(clientState).toString("base64") : undefined,
    })) as { data: { call_control_id: string; call_leg_id: string; call_session_id: string } };
    return {
      callControlId: result.data.call_control_id,
      callLegId: result.data.call_leg_id,
      callSessionId: result.data.call_session_id,
    };
  }

  /** Start streaming media via WebSocket */
  async startMediaStream(callControlId: string, streamUrl: string): Promise<void> {
    await this.request("POST", `/calls/${callControlId}/actions/streaming_start`, {
      stream_url: streamUrl,
      stream_track: "both_tracks",
      enable_dialogflow: false,
    });
  }

  /** Hang up a call */
  async hangup(callControlId: string): Promise<void> {
    await this.request("POST", `/calls/${callControlId}/actions/hangup`, {});
  }

  /** Start call recording */
  async startRecording(callControlId: string, channels: "single" | "dual" = "single"): Promise<void> {
    await this.request("POST", `/calls/${callControlId}/actions/record_start`, {
      format: "mp3",
      channels,
    });
  }

  /** Stop call recording */
  async stopRecording(callControlId: string): Promise<void> {
    await this.request("POST", `/calls/${callControlId}/actions/record_stop`, {});
  }

  // ---- Phone Number Management ----

  /** Search available phone numbers */
  async searchNumbers(filters: {
    country?: string;
    areaCode?: string;
    limit?: number;
  }): Promise<Array<{ phoneNumber: string; features: string[] }>> {
    const params = new URLSearchParams();
    params.set("filter[country_code]", filters.country || "US");
    if (filters.areaCode) params.set("filter[national_destination_code]", filters.areaCode);
    params.set("filter[limit]", String(filters.limit || 10));
    const result = (await this.request("GET", `/available_phone_numbers?${params}`)) as {
      data: Array<{ phone_number: string; features: Array<{ name: string }> }>;
    };
    return result.data.map((n) => ({
      phoneNumber: n.phone_number,
      features: n.features.map((f) => f.name),
    }));
  }

  /** Order (provision) a phone number */
  async orderNumber(phoneNumber: string, connectionId?: string): Promise<{ id: string; phoneNumber: string }> {
    const result = (await this.request("POST", "/number_orders", {
      phone_numbers: [{ phone_number: phoneNumber }],
      connection_id: connectionId || this.connectionId,
    })) as { data: { id: string; phone_numbers: Array<{ phone_number: string; id: string }> } };
    return {
      id: result.data.phone_numbers[0]?.id || result.data.id,
      phoneNumber,
    };
  }

  /** Release (delete) a phone number */
  async releaseNumber(telnyxPhoneNumberId: string): Promise<void> {
    await this.request("DELETE", `/phone_numbers/${telnyxPhoneNumberId}`);
  }

  /** Health check: list connections to verify API key */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request("GET", "/connections?page[size]=1");
      return true;
    } catch (err) {
      logger.error({ msg: "Telnyx health check failed", error: String(err) });
      return false;
    }
  }
}
