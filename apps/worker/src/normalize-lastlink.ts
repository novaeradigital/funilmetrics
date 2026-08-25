import { readFileSync } from "node:fs";
import { createDatabase } from "@funil-metrics/database";
import { processLastlinkBatch } from "./lastlink-processor.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const database = createDatabase(process.env.DATABASE_URL, {
  sslCa: process.env.DATABASE_SSL_CA_FILE
    ? readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8")
    : undefined,
  sslRejectUnauthorized:
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
      ? false
      : undefined,
});

try {
  const result = await processLastlinkBatch(database.pool);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await database.close();
}
