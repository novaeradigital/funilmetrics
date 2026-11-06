import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

type DatabaseOptions = {
  sslCa?: string;
  sslRejectUnauthorized?: boolean;
};

export function createDatabase(
  connectionString: string,
  options: DatabaseOptions = {},
) {
  const pool = new Pool({
    connectionString,
    ssl: options.sslCa
      ? {
          ca: options.sslCa,
          rejectUnauthorized: options.sslRejectUnauthorized ?? true,
        }
      : options.sslRejectUnauthorized === undefined
        ? undefined
        : { rejectUnauthorized: options.sslRejectUnauthorized },
    max: Math.max(1, Math.min(10, Number(process.env.DATABASE_POOL_MAX ?? 10) || 10)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
