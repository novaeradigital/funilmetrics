import { BRAZIL_MAP_VIEWBOX, UF_NAMES, UF_PATHS } from "./brazil-map-data";

export type RegionDatum = { sales: number; revenue: number };

/**
 * Mapa coroplético do Brasil por UF. A intensidade acompanha a participação
 * do estado nas vendas do período. Estados sem venda ficam apagados.
 * Os dados de região são estimados pelo DDD do telefone do comprador
 * (ver lib/dashboard-inteligente.ts).
 */
export function BrazilMap({
  data,
  money,
}: {
  data: Record<string, RegionDatum>;
  money: Intl.NumberFormat;
}) {
  const totalSales = Object.values(data).reduce((sum, row) => sum + row.sales, 0);

  return (
    <svg
      className="di-map"
      viewBox={BRAZIL_MAP_VIEWBOX}
      role="img"
      aria-label="Mapa de vendas por estado"
    >
      {Object.entries(UF_PATHS).map(([uf, path]) => {
        const datum = data[uf];
        const share = datum && totalSales > 0 ? datum.sales / totalSales : 0;
        return (
          <path
            key={uf}
            d={path}
            className={datum ? "di-map-state has-sales" : "di-map-state"}
            style={datum ? { fillOpacity: 0.18 + share * 0.82 } : undefined}
          >
            <title>
              {datum
                ? `${UF_NAMES[uf] ?? uf}: ${datum.sales} venda(s) · ${money.format(datum.revenue)}`
                : `${UF_NAMES[uf] ?? uf}: sem vendas no período`}
            </title>
          </path>
        );
      })}
    </svg>
  );
}
