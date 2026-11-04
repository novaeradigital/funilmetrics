/**
 * Projetos de negócio (D-174): camada de agrupamento dentro do projeto do
 * sistema. Cada negócio reúne contas de anúncio, conexões de pagamento,
 * produtos e criativos para que Dashboard e Melhores Anúncios filtrem por
 * operação sem separar dados, integrações ou sincronizações.
 *
 * Regras de leitura:
 * - Conta e conexão guardam o projeto direto na linha.
 * - Produto vale o projeto próprio; sem ele, herda o da conexão.
 * - O que está sem projeto aparece em "Todos os projetos" e em nenhum
 *   projeto específico.
 */

type Pool = {
  query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type BusinessProjectOption = { id: string; name: string };

export type BusinessScope = {
  accountIds: string[];
  connectionIds: string[];
  productIds: string[];
};

export async function loadBusinessProjects(
  pool: Pool,
  projectId: string,
): Promise<BusinessProjectOption[]> {
  const result = await pool.query<BusinessProjectOption>(
    `select id, name from public.business_projects
      where project_id = $1 order by name`,
    [projectId],
  );
  return result.rows;
}

/** Resolve o escopo de leitura de um projeto de negócio. */
export async function loadBusinessScope(
  pool: Pool,
  projectId: string,
  businessProjectId: string,
): Promise<BusinessScope> {
  const [accounts, connections, products] = await Promise.all([
    pool.query<{ id: string }>(
      `select id from public.meta_ad_accounts
        where project_id = $1 and business_project_id = $2`,
      [projectId, businessProjectId],
    ),
    pool.query<{ id: string }>(
      `select id from public.connections
        where project_id = $1 and business_project_id = $2`,
      [projectId, businessProjectId],
    ),
    pool.query<{ id: string }>(
      `select product.id
         from public.commerce_products product
         join public.connections connection on connection.id = product.connection_id
        where product.project_id = $1 and product.data_scope = 'production'
          and coalesce(product.business_project_id, connection.business_project_id) = $2`,
      [projectId, businessProjectId],
    ),
  ]);
  return {
    accountIds: accounts.rows.map((row) => row.id),
    connectionIds: connections.rows.map((row) => row.id),
    productIds: products.rows.map((row) => row.id),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valida o parâmetro de projeto de negócio contra a lista carregada. */
export function resolveBusinessProjectId(
  raw: string | string[] | undefined,
  options: BusinessProjectOption[],
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !UUID_PATTERN.test(value)) return null;
  return options.some((option) => option.id === value) ? value : null;
}

/** Interseção de uma seleção do usuário com o escopo do negócio. */
export function intersectScope(selected: string[], scopeIds: string[]): string[] {
  if (!selected.length) return [...scopeIds];
  const scope = new Set(scopeIds);
  return selected.filter((id) => scope.has(id));
}
