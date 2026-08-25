import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const requested = process.argv[2];
if (!requested || !/^\d{14}_[a-z0-9_]+\.sql$/.test(requested)) {
  throw new Error("Informe o nome exato de uma migração versionada.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const migrationsDirectory = path.resolve("supabase", "migrations");
const migrationPath = path.resolve(migrationsDirectory, requested);
if (path.dirname(migrationPath) !== migrationsDirectory) {
  throw new Error("A migração precisa estar em supabase/migrations.");
}

const [version, ...nameParts] = path.basename(requested, ".sql").split("_");
const name = nameParts.join("_");
const sql = await readFile(migrationPath, "utf8");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const client = await pool.connect();

try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(73462901)");
  const recorded = await client.query(
    `select version
       from supabase_migrations.schema_migrations
      where version = $1`,
    [version],
  );
  if (recorded.rowCount) {
    await client.query("rollback");
    process.stdout.write(`${JSON.stringify({ version, status: "already_applied" })}\n`);
  } else {
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations
         (version, statements, name)
       values ($1, $2::text[], $3)`,
      [version, [sql], name],
    );
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ version, status: "applied" })}\n`);
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
