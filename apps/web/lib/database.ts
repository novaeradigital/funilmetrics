import "server-only";
import { createDatabase } from "@funil-metrics/database";

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada no servidor web.");
  }
  database ??= createDatabase(process.env.DATABASE_URL, {
    sslRejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
        ? false
        : undefined,
  });
  return database;
}
