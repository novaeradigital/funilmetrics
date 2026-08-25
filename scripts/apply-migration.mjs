import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import pg from "pg";

const migrationName = process.argv[2];
if (!migrationName || !/^\d{14}_[a-z0-9_]+\.sql$/.test(migrationName)) {
  throw new Error("Informe o nome exato de uma migração versionada.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const version = migrationName.slice(0, 14);
const name = basename(migrationName, ".sql").slice(15);
const migrationPath = join("supabase", "migrations", migrationName);
const statement = await readFile(migrationPath, "utf8");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const existing = await client.query(
    `select 1 from supabase_migrations.schema_migrations where version = $1`,
    [version],
  );
  if (existing.rowCount) {
    process.stdout.write(`${JSON.stringify({ event: "migration_already_applied", version })}\n`);
  } else {
    await client.query("begin");
    await client.query(statement);
    await client.query(
      `insert into supabase_migrations.schema_migrations (
         version, name, statements
       ) values ($1, $2, $3::text[])`,
      [version, name, [statement]],
    );
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ event: "migration_applied", version, name })}\n`);
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
