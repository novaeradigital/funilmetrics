"use client";

import { useMemo, useState } from "react";
import {
  retentionDiagnosis,
  retentionLevel,
  stageRate,
} from "../../../lib/melhores-anuncios";

export type BestAdViewRow = {
  adId: string;
  name: string;
  campaign: string;
  accountName: string;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  pageViews: number;
  checkouts: number;
  sales: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  profit: number;
  ticket: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  hook: number | null;
  body: number | null;
  p75Rate: number | null;
};

export type FunnelTotals = {
  impressions: number;
  linkClicks: number;
  pageViews: number;
  checkouts: number;
  sales: number;
};

type Props = {
  rows: BestAdViewRow[];
  totalAds: number;
  funnel: FunnelTotals;
  currency: string;
};

function pctText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function RetentionBar({ label, rate }: { label: string; rate: number | null }) {
  const level = retentionLevel(rate);
  return (
    <div className="ma-retention">
      <span className="ma-retention-label">{label}</span>
      <span className="ma-retention-track" aria-hidden="true">
        <span
          className={`ma-retention-fill${level ? ` is-${level}` : ""}`}
          style={{ width: `${rate === null ? 0 : Math.min(rate, 100)}%` }}
        />
        <span className="ma-retention-tick" />
      </span>
      <strong className={level ? `ma-level-${level}` : undefined}>{pctText(rate)}</strong>
    </div>
  );
}

function Thumb({ url, name, large = false }: { url: string | null; name: string; large?: boolean }) {
  return (
    <span className={`ma-thumb${large ? " ma-thumb-large" : ""}`} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : null}
      <span className="ma-thumb-play" />
      <span className="ma-thumb-name">{name.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

function FunnelSteps({
  steps,
  number,
  compact = false,
}: {
  steps: { label: string; value: number }[];
  number: Intl.NumberFormat;
  compact?: boolean;
}) {
  const first = steps[0]?.value ?? 0;
  return (
    <div className={`ma-funnel${compact ? " ma-funnel-compact" : ""}`}>
      {steps.map((step, index) => {
        const width = first > 0 ? Math.max((step.value / first) * 100, 12) : 12;
        const rate = index > 0 ? stageRate(step.value, steps[index - 1]?.value ?? 0) : null;
        return (
          <div className="ma-funnel-step" key={step.label}>
            {index > 0 ? (
              <span className="ma-funnel-rate">{rate === null ? "—" : `${rate.toFixed(1).replace(".", ",")}% passam`}</span>
            ) : (
              <span className="ma-funnel-rate ma-funnel-rate-empty">base</span>
            )}
            <div className="ma-funnel-bar" style={{ width: `${width}%` }}>
              <span>{step.label}</span>
              <strong>{number.format(step.value)}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MelhoresAnunciosClient({ rows, totalAds, funnel, currency }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const money = useMemo(
    () => new Intl.NumberFormat("pt-BR", { style: "currency", currency }),
    [currency],
  );
  const number = useMemo(() => new Intl.NumberFormat("pt-BR"), []);

  const sorted = rows;
  const podium = sorted.slice(0, 3);
  const expandedId = expanded ?? sorted[0]?.adId ?? null;

  const funnelSteps = [
    { label: "Impressões", value: funnel.impressions },
    { label: "Cliques no link", value: funnel.linkClicks },
    { label: "Visualizações da página", value: funnel.pageViews },
    { label: "Checkouts iniciados", value: funnel.checkouts },
    { label: "Vendas", value: funnel.sales },
  ];

  return (
    <>
      <section className="dashboard-card">
        <header className="card-header">
          <div>
            <p className="panel-label">Funil invertido do período</p>
            <h2>Da impressão à venda</h2>
          </div>
          <span className="ma-note">Etapas da Meta; a última é a venda real atribuída</span>
        </header>
        <FunnelSteps steps={funnelSteps} number={number} />
      </section>

      {podium.length > 0 ? (
        <section className="ma-podium" aria-label="Três melhores anúncios">
          {podium.map((row, index) => (
            <article className={`ma-podium-card${index === 0 ? " is-first" : ""}`} key={row.adId}>
              <div className="ma-podium-media">
                <Thumb url={row.thumbnailUrl} name={row.name} large />
                <span className="ma-rank">{index + 1}º</span>
              </div>
              <strong className="ma-podium-name">{row.name}</strong>
              <small>{row.campaign}</small>
              <div className="ma-podium-metrics">
                <div>
                  <span>Vendas</span>
                  <strong>{number.format(row.sales)}</strong>
                </div>
                <div>
                  <span>Receita</span>
                  <strong>{money.format(row.revenue)}</strong>
                </div>
                <div>
                  <span>ROAS</span>
                  <strong>{row.roas === null ? "—" : `${row.roas.toFixed(2).replace(".", ",")}x`}</strong>
                </div>
              </div>
              <RetentionBar label="Hook" rate={row.hook} />
              <RetentionBar label="Body" rate={row.body} />
            </article>
          ))}
        </section>
      ) : null}

      <section className="dashboard-card">
        <header className="card-header">
          <div>
            <p className="panel-label">Ranking do período</p>
            <h2>Todos os anúncios</h2>
          </div>
          <span className="ma-note">
            {sorted.length} de {totalAds} anúncios · clique num anúncio para abrir o funil dele
          </span>
        </header>
        {sorted.length === 0 ? (
          <p className="ma-empty">
            Nenhum anúncio passa no investimento mínimo atual. Abaixe o valor na barra de filtros
            e clique em Aplicar para ver o ranking completo.
          </p>
        ) : (
          <div className="ma-list">
            {sorted.map((row, index) => {
              const isOpen = expandedId === row.adId;
              const diagnosis = retentionDiagnosis(row.hook, row.body);
              return (
                <article className={`ma-row${isOpen ? " is-open" : ""}`} key={row.adId}>
                  <button
                    className="ma-row-head"
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? "" : row.adId)}
                  >
                    <span className="ma-row-rank">{index + 1}º</span>
                    <Thumb url={row.thumbnailUrl} name={row.name} />
                    <span className="ma-row-id">
                      <strong>{row.name}</strong>
                      <small>
                        {row.campaign} · {row.accountName}
                      </small>
                    </span>
                    <span className="ma-row-money">
                      <span>
                        <small>Investimento</small>
                        <strong>{money.format(row.spend)}</strong>
                      </span>
                      <span>
                        <small>Vendas</small>
                        <strong>{number.format(row.sales)}</strong>
                      </span>
                      <span>
                        <small>Receita</small>
                        <strong>{money.format(row.revenue)}</strong>
                      </span>
                      <span>
                        <small>CPA</small>
                        <strong>{row.cpa === null ? "—" : money.format(row.cpa)}</strong>
                      </span>
                      <span>
                        <small>ROAS</small>
                        <strong>{row.roas === null ? "—" : `${row.roas.toFixed(2).replace(".", ",")}x`}</strong>
                      </span>
                      <span>
                        <small>Lucro</small>
                        <strong className={row.profit >= 0 ? "ma-pos" : "ma-neg"}>
                          {money.format(row.profit)}
                        </strong>
                      </span>
                    </span>
                    <span className="ma-row-behavior">
                      <span className="ma-ctr">
                        CTR <strong>{pctText(row.ctr)}</strong>
                      </span>
                      <RetentionBar label="Hook" rate={row.hook} />
                      <RetentionBar label="Body" rate={row.body} />
                      <span className="ma-freq">
                        Frequência{" "}
                        <strong>
                          {row.frequency === null ? "—" : row.frequency.toFixed(1).replace(".", ",")}
                        </strong>
                      </span>
                    </span>
                    <span className="ma-row-chevron" aria-hidden="true">
                      {isOpen ? "⌃" : "⌄"}
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="ma-row-detail">
                      <FunnelSteps
                        compact
                        number={number}
                        steps={[
                          { label: "Impressões", value: row.impressions },
                          { label: "Cliques no link", value: row.linkClicks },
                          { label: "Página", value: row.pageViews },
                          { label: "Checkouts", value: row.checkouts },
                          { label: "Vendas", value: row.sales },
                        ]}
                      />
                      <div className="ma-detail-side">
                        {diagnosis ? <p className="ma-diagnosis">{diagnosis}</p> : null}
                        <dl className="ma-detail-stats">
                          <div>
                            <dt>CPM</dt>
                            <dd>{row.cpm === null ? "—" : money.format(row.cpm)}</dd>
                          </div>
                          <div>
                            <dt>CPC (link)</dt>
                            <dd>{row.cpc === null ? "—" : money.format(row.cpc)}</dd>
                          </div>
                          <div>
                            <dt>Ticket médio</dt>
                            <dd>{row.ticket === null ? "—" : money.format(row.ticket)}</dd>
                          </div>
                          <div>
                            <dt>Segurou até 75%</dt>
                            <dd>{pctText(row.p75Rate)}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
