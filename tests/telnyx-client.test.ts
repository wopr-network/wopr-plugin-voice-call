import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelnyxClient } from "../src/telnyx-client.js";

const BASE_URL = "https://api.telnyx.com/v2";

function makeFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe("TelnyxClient", () => {
  let client: TelnyxClient;

  beforeEach(() => {
    client = new TelnyxClient({
      apiKey: "KEY_test_abc123",
      connectionId: "conn-001",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("answerCall", () => {
    it("sends POST to /calls/{id}/actions/answer", async () => {
      const mockFetch = makeFetchMock(200, { data: {} });
      vi.stubGlobal("fetch", mockFetch);

      await client.answerCall("call-control-001");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/calls/call-control-001/actions/answer`);
      expect(opts.method).toBe("POST");
      expect(opts.headers).toMatchObject({ Authorization: "Bearer KEY_test_abc123" });
    });

    it("passes client_state as base64 when provided", async () => {
      const mockFetch = makeFetchMock(200, { data: {} });
      vi.stubGlobal("fetch", mockFetch);

      await client.answerCall("call-001", "session-123");

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as { client_state: string };
      expect(body.client_state).toBe(Buffer.from("session-123").toString("base64"));
    });
  });

  describe("createCall", () => {
    it("sends POST to /calls with correct params", async () => {
      const mockFetch = makeFetchMock(200, {
        data: {
          call_control_id: "cc-001",
          call_leg_id: "leg-001",
          call_session_id: "sess-001",
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.createCall("+15559991234", "+15550000001", "https://webhook.example.com");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/calls`);
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body.to).toBe("+15559991234");
      expect(body.from).toBe("+15550000001");
      expect(body.connection_id).toBe("conn-001");

      expect(result.callControlId).toBe("cc-001");
      expect(result.callLegId).toBe("leg-001");
      expect(result.callSessionId).toBe("sess-001");
    });
  });

  describe("hangup", () => {
    it("sends POST to /calls/{id}/actions/hangup", async () => {
      const mockFetch = makeFetchMock(200, { data: {} });
      vi.stubGlobal("fetch", mockFetch);

      await client.hangup("call-control-001");

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/calls/call-control-001/actions/hangup`);
      expect(opts.method).toBe("POST");
    });
  });

  describe("searchNumbers", () => {
    it("sends GET with country filter", async () => {
      const mockFetch = makeFetchMock(200, {
        data: [
          { phone_number: "+15551234567", features: [{ name: "voice" }, { name: "sms" }] },
        ],
      });
      vi.stubGlobal("fetch", mockFetch);

      const results = await client.searchNumbers({ country: "US", areaCode: "555", limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0]!.phoneNumber).toBe("+15551234567");
      expect(results[0]!.features).toContain("voice");

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain("filter%5Bcountry_code%5D=US");
      expect(url).toContain("filter%5Bnational_destination_code%5D=555");
      expect(url).toContain("filter%5Blimit%5D=5");
    });
  });

  describe("orderNumber", () => {
    it("sends POST to /number_orders", async () => {
      const mockFetch = makeFetchMock(200, {
        data: {
          id: "order-001",
          phone_numbers: [{ phone_number: "+15551234567", id: "pn-001" }],
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.orderNumber("+15551234567");

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/number_orders`);
      expect(opts.method).toBe("POST");
      expect(result.phoneNumber).toBe("+15551234567");
      expect(result.id).toBe("pn-001");
    });
  });

  describe("healthCheck", () => {
    it("returns true when API responds with 200", async () => {
      const mockFetch = makeFetchMock(200, { data: [] });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false when API responds with error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });

    it("returns false when API responds with 401", async () => {
      const mockFetch = makeFetchMock(401, { errors: [{ detail: "Unauthorized" }] });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws with status and body on non-2xx response", async () => {
      const mockFetch = makeFetchMock(422, { errors: [{ detail: "Invalid number" }] });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.hangup("bad-id")).rejects.toThrow(/422/);
    });
  });
});
