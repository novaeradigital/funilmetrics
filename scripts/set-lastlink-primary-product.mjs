import pg from "pg";

const [connectionName, primaryProductName] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
if (!connectionName || !primaryProductName) {
  throw new Error("Informe o rótulo da conexão e o produto principal.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const client = await pool.connect();

try {
  await client.query("begin");
  const connection = await client.query(
    `select c.id, c.organization_id, c.project_id, c.configuration
       from public.connections c
      where c.provider = 'lastlink'
        and c.name = $1
        and exists (
          select 1
            from public.commerce_products product
           where product.connection_id = c.id
             and product.data_scope = 'production'
             and product.name = $2
        )
      for update`,
    [connectionName, primaryProductName],
  );
  if (connection.rowCount !== 1) {
    throw new Error("Conexão ou produto principal não encontrado de forma única.");
  }

  const current = connection.rows[0];
  const nextConfiguration = {
    ...(current.configuration ?? {}),
    productName: primaryProductName,
    productClassificationSource: "human_confirmation",
  };
  await client.query(
    `update public.connections
        set configuration = $2::jsonb, updated_at = now()
      where id = $1`,
    [current.id, JSON.stringify(nextConfiguration)],
  );
  await client.query(
    `insert into public.audit_logs (
       organization_id, project_id, actor_user_id, action,
       target_type, target_id, before, after, reason
     )
     select $1, $2, membership.user_id,
            'lastlink_primary_product_confirmed',
            'connection', $3, $4::jsonb, $5::jsonb,
            'Classificação confirmada pelo proprietário da operação.'
       from public.memberships membership
      where membership.organization_id = $1
        and membership.role = 'owner'
      order by membership.created_at
      limit 1`,
    [
      current.organization_id,
      current.project_id,
      current.id,
      JSON.stringify(current.configuration ?? {}),
      JSON.stringify(nextConfiguration),
    ],
  );
  await client.query("commit");
  process.stdout.write(
    `${JSON.stringify({ updated: true, connection: connectionName, primaryProduct: primaryProductName })}\n`,
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
