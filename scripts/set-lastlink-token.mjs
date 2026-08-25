import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const outputPath = ".env.lastlink.local";

if (!process.env.DATABASE_URL || !process.env.LASTLINK_CONNECTION_PUBLIC_ID) {
  throw new Error(
    "DATABASE_URL ou LASTLINK_CONNECTION_PUBLIC_ID não configurado.",
  );
}

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const token = Buffer.concat(chunks).toString("utf8").trim();

if (token.length < 16) {
  throw new Error("O token informado é curto demais.");
}

const salt = randomBytes(16);
const derivedKey = await scrypt(token, salt, 32);
const tokenHash = [
  "scrypt-v1",
  salt.toString("base64url"),
  derivedKey.toString("base64url"),
].join("$");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const client = await pool.connect();

try {
  await client.query("begin");

  const updated = await client.query(
    `update public.webhook_endpoints endpoint
        set previous_token_hash = endpoint.token_hash,
            previous_token_valid_until = now() + interval '24 hours',
            token_hash = $2,
            updated_at = now()
       from public.connections connection
      where endpoint.connection_id = connection.id
        and connection.public_id = $1
        and connection.provider = 'lastlink'
      returning
        connection.id as connection_id,
        connection.organization_id,
        connection.project_id`,
    [process.env.LASTLINK_CONNECTION_PUBLIC_ID, tokenHash],
  );

  if (updated.rowCount !== 1) {
    throw new Error("Conexão Lastlink não encontrada ou ambígua.");
  }

  const connection = updated.rows[0];
  const owner = await client.query(
    `select user_id
       from public.memberships
      where organization_id = $1
        and role = 'owner'
      order by created_at
      limit 1`,
    [connection.organization_id],
  );

  await client.query(
    `insert into public.audit_logs (
       organization_id,
       project_id,
       actor_user_id,
       action,
       target_type,
       target_id,
       after,
       request_id
     )
     values ($1, $2, $3, $4, 'connection', $5, $6, $7)`,
    [
      connection.organization_id,
      connection.project_id,
      owner.rows[0]?.user_id ?? null,
      "integration.lastlink_token_synchronized",
      connection.connection_id,
      JSON.stringify({
        provider: "lastlink",
        tokenStoredAsHash: true,
        previousTokenWindowHours: 24,
      }),
      randomUUID(),
    ],
  );

  await writeFile(
    outputPath,
    [
      `LASTLINK_CONNECTION_PUBLIC_ID=${process.env.LASTLINK_CONNECTION_PUBLIC_ID}`,
      `LASTLINK_WEBHOOK_TOKEN=${token}`,
      `LASTLINK_WEBHOOK_PATH=/webhooks/lastlink/${process.env.LASTLINK_CONNECTION_PUBLIC_ID}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  await client.query("commit");
  process.stdout.write(
    "Token da Lastlink atualizado com segurança. Esta janela pode ser fechada.\n",
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
