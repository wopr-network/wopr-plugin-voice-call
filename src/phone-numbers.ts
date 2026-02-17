import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import type { TelnyxClient } from "./telnyx-client.js";
import type { PhoneNumber, WOPRPluginContext } from "./types.js";

export class PhoneNumberManager {
  private telnyxClient: TelnyxClient;
  private ctx: WOPRPluginContext;

  constructor(telnyxClient: TelnyxClient, ctx: WOPRPluginContext) {
    this.telnyxClient = telnyxClient;
    this.ctx = ctx;
  }

  private get repo() {
    return this.ctx.storage.getRepository<Record<string, unknown>>("voice_call", "phone_numbers");
  }

  /** Search available numbers */
  async searchAvailable(opts: {
    country?: string;
    areaCode?: string;
    limit?: number;
  }): Promise<Array<{ phoneNumber: string; features: string[] }>> {
    return this.telnyxClient.searchNumbers(opts);
  }

  /** Provision a phone number for a tenant */
  async provision(phoneNumber: string, tenantId: string, displayName?: string): Promise<PhoneNumber> {
    const result = await this.telnyxClient.orderNumber(phoneNumber);
    const record: PhoneNumber = {
      id: randomUUID(),
      tenantId,
      phoneNumber,
      telnyxPhoneNumberId: result.id,
      displayName,
      active: true,
      provisionedAt: Date.now(),
    };
    try {
      await this.repo.insert(record as unknown as Record<string, unknown>);
    } catch (err) {
      // The number was ordered from Telnyx but we failed to persist it locally.
      // Log the ordered number details so it can be recovered manually.
      logger.error({
        msg: "Phone number ordered from Telnyx but DB insert failed — manual recovery needed",
        phoneNumber,
        telnyxPhoneNumberId: result.id,
        tenantId,
        error: String(err),
      });
      throw err;
    }
    logger.info({ msg: "Phone number provisioned", phoneNumber, tenantId });
    return record;
  }

  /** Release a phone number */
  async release(phoneNumber: string, tenantId: string): Promise<void> {
    const record = (await this.repo.findFirst({ phoneNumber, tenantId, active: true })) as PhoneNumber | null;
    if (!record) throw new Error(`Phone number ${phoneNumber} not found for tenant`);
    await this.telnyxClient.releaseNumber(record.telnyxPhoneNumberId);
    await this.repo.update(record.id, { active: false, releasedAt: Date.now() });
    logger.info({ msg: "Phone number released", phoneNumber, tenantId });
  }

  /** List phone numbers for a tenant */
  async listForTenant(tenantId: string): Promise<PhoneNumber[]> {
    const results = await this.repo.findMany({ tenantId, active: true });
    return results as unknown as PhoneNumber[];
  }

  /** Get a phone number record by number */
  async getByNumber(phoneNumber: string): Promise<PhoneNumber | null> {
    const result = await this.repo.findFirst({ phoneNumber, active: true });
    return result as PhoneNumber | null;
  }
}
