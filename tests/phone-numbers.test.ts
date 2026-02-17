import { describe, it, expect, vi, beforeEach } from "vitest";
import { PhoneNumberManager } from "../src/phone-numbers.js";
import { createMockContext, createMockRepository } from "./mocks/wopr-context.js";
import type { TelnyxClient } from "../src/telnyx-client.js";

function createMockTelnyxClient(): TelnyxClient {
  return {
    searchNumbers: vi.fn().mockResolvedValue([
      { phoneNumber: "+15551234567", features: ["voice", "sms"] },
    ]),
    orderNumber: vi.fn().mockResolvedValue({ id: "pn-telnyx-001", phoneNumber: "+15551234567" }),
    releaseNumber: vi.fn().mockResolvedValue(undefined),
    answerCall: vi.fn(),
    createCall: vi.fn(),
    startMediaStream: vi.fn(),
    hangup: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as TelnyxClient;
}

describe("PhoneNumberManager", () => {
  let manager: PhoneNumberManager;
  let mockTelnyx: TelnyxClient;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockTelnyx = createMockTelnyxClient();
    mockRepo = createMockRepository();
    const ctx = createMockContext({
      storage: {
        driver: "sqlite",
        register: vi.fn(async () => {}),
        getRepository: vi.fn().mockReturnValue(mockRepo),
        isRegistered: vi.fn().mockReturnValue(false),
        getVersion: vi.fn().mockResolvedValue(1),
        raw: vi.fn(async () => []),
        transaction: vi.fn(async (fn: (s: unknown) => Promise<unknown>) => fn({})),
      },
    });
    manager = new PhoneNumberManager(mockTelnyx, ctx);
  });

  describe("searchAvailable", () => {
    it("delegates to TelnyxClient.searchNumbers", async () => {
      const results = await manager.searchAvailable({ country: "US", areaCode: "555" });
      expect(mockTelnyx.searchNumbers).toHaveBeenCalledWith({ country: "US", areaCode: "555" });
      expect(results).toHaveLength(1);
      expect(results[0]!.phoneNumber).toBe("+15551234567");
    });
  });

  describe("provision", () => {
    it("orders number and inserts record", async () => {
      const record = await manager.provision("+15551234567", "tenant-001", "Main Line");
      expect(mockTelnyx.orderNumber).toHaveBeenCalledWith("+15551234567");
      expect(mockRepo.insert).toHaveBeenCalledOnce();
      expect(record.phoneNumber).toBe("+15551234567");
      expect(record.tenantId).toBe("tenant-001");
      expect(record.displayName).toBe("Main Line");
      expect(record.active).toBe(true);
      expect(record.telnyxPhoneNumberId).toBe("pn-telnyx-001");
    });

    it("generates a UUID for the record id", async () => {
      const record = await manager.provision("+15551234567", "tenant-001");
      expect(record.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe("release", () => {
    it("releases number and marks as inactive", async () => {
      // First provision it
      const provisioned = await manager.provision("+15551234567", "tenant-001");

      // Mock findFirst to return the provisioned record
      mockRepo.findFirst = vi.fn().mockResolvedValue(provisioned);

      await manager.release("+15551234567", "tenant-001");

      expect(mockTelnyx.releaseNumber).toHaveBeenCalledWith("pn-telnyx-001");
      expect(mockRepo.update).toHaveBeenCalledWith(
        provisioned.id,
        expect.objectContaining({ active: false }),
      );
    });

    it("throws if phone number not found for tenant", async () => {
      mockRepo.findFirst = vi.fn().mockResolvedValue(null);
      await expect(manager.release("+15551234567", "unknown-tenant")).rejects.toThrow(
        /not found for tenant/,
      );
    });
  });

  describe("listForTenant", () => {
    it("returns active numbers for tenant", async () => {
      const record = {
        id: "rec-001",
        tenantId: "tenant-001",
        phoneNumber: "+15551234567",
        telnyxPhoneNumberId: "pn-001",
        active: true,
        provisionedAt: Date.now(),
      };
      mockRepo.findMany = vi.fn().mockResolvedValue([record]);

      const results = await manager.listForTenant("tenant-001");
      expect(mockRepo.findMany).toHaveBeenCalledWith({ tenantId: "tenant-001", active: true });
      expect(results).toHaveLength(1);
    });
  });
});
