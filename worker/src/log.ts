import pino from "pino";
// Message text, phone numbers, codes, passwords and sessions must never be passed to the logger.
export const log = pino({ level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["*.text", "*.body", "*.phone", "*.code", "*.password", "*.session", "*.api_hash"], censor: "[redacted]" } });
