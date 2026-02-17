import type { PluginSchema } from "@wopr-network/plugin-types";
import { z } from "zod";

export const callRecordSchema = z.object({
  id: z.string(),
  telnyxCallControlId: z.string(),
  telnyxCallLegId: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  from: z.string(),
  to: z.string(),
  tenantId: z.string(),
  sessionId: z.string(),
  state: z.enum(["ringing", "answering", "connected", "hold", "ending", "ended", "failed"]),
  startedAt: z.number(),
  connectedAt: z.number().optional(),
  endedAt: z.number().optional(),
  endReason: z.string().optional(),
  recording: z.boolean().default(false),
  durationMs: z.number().optional(),
  metadata: z.string().optional(), // JSON-serialized
});

export const phoneNumberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  phoneNumber: z.string(),
  telnyxPhoneNumberId: z.string(),
  displayName: z.string().optional(),
  active: z.boolean().default(true),
  provisionedAt: z.number(),
  releasedAt: z.number().optional(),
});

export const voiceCallStorageSchema: PluginSchema = {
  namespace: "voice_call",
  version: 1,
  tables: {
    calls: {
      schema: callRecordSchema,
      primaryKey: "id",
      indexes: [
        { fields: ["tenantId"] },
        { fields: ["state"] },
        { fields: ["telnyxCallControlId"], unique: true },
        { fields: ["sessionId"] },
      ],
    },
    phone_numbers: {
      schema: phoneNumberSchema,
      primaryKey: "id",
      indexes: [{ fields: ["tenantId"] }, { fields: ["phoneNumber"], unique: true }, { fields: ["active"] }],
    },
  },
};
