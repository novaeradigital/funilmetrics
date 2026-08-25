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
const rotationHours = 24;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

async function hashToken(token) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(token, salt, 32);

  return [
    "scrypt-v1",
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const client = await pool.connect();

try {
  await client.query("begin");

  const projectResult = process.env.LASTLINK_PROJECT_ID
    ? await client.query(
        `select id, organization_id
           from public.projects
          where id = $1`,
        [process.env.LASTLINK_PROJECT_ID],
      )
    : await client.query(
        `select id, organization_id
           from public.projects
          order by created_at
          limit 2`,
      );

  if (projectResult.rowCount !== 1) {
    throw new Error(
      "Informe LASTLINK_PROJECT_ID quando houver zero ou mais de um projeto.",
    );
  }

  const project = projectResult.rows[0];
  const token = randomBytes(32).toString("base64url");
  const tokenHash = await hashToken(token);

  const connectionResult = await client.query(
    `select id, public_id
       from public.connections
      where organization_id = $1
        and project_id = $2
        and provider = 'lastlink'
      order by created_at
      limit 1
      for update`,
    [project.organization_id, project.id],
  );

  let connection;
  let action;

  if (connectionResult.rowCount === 0) {
    const inserted = await client.query(
      `insert into public.connections (
         organization_id,
         project_id,
         provider,
         name,
         status,
         configuration
       )
       values ($1, $2, 'lastlink', 'Lastlink principal', 'active', $3)
       returning id, public_id`,
      [
        project.organization_id,
        project.id,
        JSON.stringify({ tokenHeader: "x-lastlink-token" }),
      ],
    );
    connection = inserted.rows[0];
    action = "integration.lastlink_connection_created";

    await client.query(
      `insert into public.webhook_endpoints (
         connection_id,
         token_hash
       )
       values ($1, $2)`,
      [connection.id, tokenHash],
    );
  } else {
    connection = connectionResult.rows[0];
    action = "integration.lastlink_token_rotated";

    await client.query(
      `update public.connections
          set status = 'active',
              updated_at = now()
        where id = $1`,
      [connection.id],
    );

    const updatedEndpoint = await client.query(
      `update public.webhook_endpoints
          set previous_token_hash = token_hash,
              previous_token_valid_until =
                now() + ($2::text || ' hours')::interval,
              token_hash = $3,
              updated_at = now()
        where connection_id = $1
        returning id`,
      [connection.id, rotationHours, tokenHash],
    );

    if (updatedEndpoint.rowCount === 0) {
      await client.query(
        `insert into public.webhook_endpoints (
           connection_id,
           token_hash
         )
         values ($1, $2)`,
        [connection.id, tokenHash],
      );
    }
  }

  const ownerResult = await client.query(
    `select m.user_id
       from public.memberships m
      where m.organization_id = $1
        and m.role = 'owner'
      order by m.created_at
      limit 1`,
    [project.organization_id],
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
      project.organization_id,
      project.id,
      ownerResult.rows[0]?.user_id ?? null,
      action,
      connection.id,
      JSON.stringify({
        provider: "lastlink",
        connectionPublicId: connection.public_id,
        tokenStoredAsHash: true,
      }),
      randomUUID(),
    ],
  );

  await writeFile(
    outputPath,
    [
      `LASTLINK_CONNECTION_PUBLIC_ID=${connection.public_id}`,
      `LASTLINK_WEBHOOK_TOKEN=${token}`,
      `LASTLINK_WEBHOOK_PATH=/webhooks/lastlink/${connection.public_id}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  await client.query("commit");
  process.stdout.write(
    `Conexão pronta. Segredo salvo somente em ${outputPath}.\n`,
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
