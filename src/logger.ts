import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { plugin: "voice-call" },
  transports: [new transports.Console({ format: format.simple() })],
});
