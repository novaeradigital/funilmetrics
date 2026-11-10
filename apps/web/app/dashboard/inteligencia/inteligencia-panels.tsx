"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type {
  CampaignRow,
  CreativeRow,
  FormatRow,
  HookRow,
} from "../../../lib/intelligence-data";
import {
  DEFAULT_THRESHOLDS,
  type IntelligenceThresholds,
  type VerdictKind,
} from "../../../lib/intelligence-rules";
import { saveIntelligenceSettings, setIntelligenceCardState } from "./actions";

const VERDICT_LABEL: Record<VerdictKind, string> = {
  escalar: "Escalar",
  duplicar: "Duplicar",
  outra_conta: "Outra conta",
  novo_gancho: "Novo gancho",
  mesmo_gancho: "Mesmo gancho outro corpo",
  aposentar: "Aposentar",
};

const BOARD_ORDER: VerdictKind[] = [
  "escalar",
  "duplicar",
  "outra_conta",
  "novo_gancho",
  "mesmo_gancho",
  "aposentar",
];

const THRESHOLD_FIELDS: { key: keyof IntelligenceThresholds; label: string; step: string }[] = [
  { key: "roasGoal", label: "Meta de ROAS do projeto", step: "0.1" },
  { key: "cpaTarget", label: "CPA alvo do projeto (R$)", step: "1" },
  { key: "minSales", label: "Vendas mínimas para provar um criativo", step: "1" },
  { key: "fatigueFreq", label: "Frequência que marca fadiga", step: "0.1" },
  { key: "ctrDropPct", label: "Queda de CTR entre metades (%)", step: "1" },
  { key: "hookWeakPct", label: "Hook rate fraco, abaixo de (%)", step: "1" },
  { key: "hookStrongPct", label: "Hook rate forte, a partir de (%)", step: "1" },
  { key: "thruWeakPct", label: "ThruPlay fraco, abaixo de (%)", step: "1" },
  { key: "minViews", label: "Views de 3s mínimas para julgar o gancho", step: "10" },
  { key: "minClicks", label: "Cliques mínimos para julgar o pós-clique", step: "1" },
  { key: "retireMultiple", label: "Múltiplo do CPA alvo sem venda que aposenta", step: "0.5" },
];

type Props = {
  currency: string;
  businessId: string | null;
  thresholds: IntelligenceThresholds;
  campaigns: CampaignRow[];
  creatives: CreativeRow[];
  formats: FormatRow[];
  hooks: HookRow[];
  board: Record<VerdictKind, CreativeRow[]>;
};

function fmtMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function fmtNum(value: number | null, digits = 2, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "sem dados";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function verdictRule(creative: CreativeRow, kind: VerdictKind): string {
  return creative.verdicts.find((v) => v.kind === kind)?.rule ?? "";
}

function BoardCard({
  creative,
  kind,
  currency,
  businessId,
}: {
  creative: CreativeRow;
  kind: VerdictKind;
  currency: string;
  businessId: string | null;
}) {
  const [gone, setGone] = useState(false);
  const [pending, startTransition] = useTransition();
  if (gone) return null;
  const act = (state: "dismissed" | "snoozed") => {
    startTransition(async () => {
      await setIntelligenceCardState({
        creativeId: creative.creativeId,
        verdict: kind,
        businessId,
        state,
      });
      setGone(true);
    });
  };
  return (
    <article
      className="dashboard-card"
      style={{ display: "grid", gap: 8, padding: 12, opacity: pending ? 0.5 : 1 }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {creative.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creative.thumbnailUrl}
            alt=""
            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }}
          />
        ) : (
          <div
            style={{
              width: 44, height: 44, borderRadius: 8, display: "grid",
              placeItems: "center", background: "#26292f", color: "#f5f5f4",
              fontWeight: 700,
            }}
          >
            {creative.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <strong>{creative.name}</strong>
          <div className="panel-label">{creative.format ?? "sem classificação"}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
        <span>Investimento {fmtMoney(creative.spend, currency)}</span>
        <span>Vendas {creative.sales}</span>
        <span>Receita {fmtMoney(creative.revenue, currency)}</span>
        <span>ROAS {fmtNum(creative.roas)}</span>
        <span>CPA {creative.cpa === null ? "sem dados" : fmtMoney(creative.cpa, currency)}</span>
        <span>CTR {fmtNum(creative.ctr, 1, "%")}</span>
        <span>Frequência {fmtNum(creative.frequency, 1)}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13 }}>
        <strong>Regra:</strong> {verdictRule(creative, kind)}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/dashboard/campanhas/subir" className="button-secondary">
          Abrir subir campanha
        </Link>
        <button type="button" disabled={pending} onClick={() => act("dismissed")}>
          Dispensar
        </button>
        <button type="button" disabled={pending} onClick={() => act("snoozed")}>
          Adiar
        </button>
      </div>
    </article>
  );
}

function SettingsGear({
  thresholds,
  businessId,
}: {
  thresholds: IntelligenceThresholds;
  businessId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      THRESHOLD_FIELDS.map((f) => [f.key, String(thresholds[f.key] ?? DEFAULT_THRESHOLDS[f.key])]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Configurar limiares das regras">
        ⚙ Limiares das regras
      </button>
    );
  }
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60,
        display: "grid", placeItems: "center", padding: 16,
      }}
    >
      <div className="dashboard-card" style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <header className="card-header">
          <div>
            <p className="panel-label">Motor de regras</p>
            <h2>Limiares {businessId ? "deste projeto" : "gerais"}</h2>
          </div>
        </header>
        <div style={{ display: "grid", gap: 10 }}>
          {THRESHOLD_FIELDS.map((field) => (
            <label key={field.key} style={{ display: "grid", gap: 4 }}>
              <span>{field.label}</span>
              <input
                type="number"
                step={field.step}
                min="0"
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <p className="metric-footnote">
          Os vereditos são calculados por estas regras, nunca pela IA. Salvar recalcula o
          quadro com os números atuais.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="button-primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const parsed: Record<string, number> = {};
                for (const [key, value] of Object.entries(values)) {
                  const num = Number(value);
                  if (Number.isFinite(num) && num > 0) parsed[key] = num;
                }
                await saveIntelligenceSettings({ businessId, thresholds: parsed });
                setSaved(true);
              })
            }
          >
            Salvar limiares
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            {saved ? "Fechar (recarregue para ver o quadro novo)" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InteligenciaPanels(props: Props) {
  const [tab, setTab] = useState<"campanhas" | "criativos">("campanhas");
  const { currency, businessId } = props;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="dashboard-card">
        <header className="card-header">
          <div>
            <p className="panel-label">Rankings</p>
            <h2>{tab === "campanhas" ? "Campanhas" : "Criativos"}</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className={tab === "campanhas" ? "button-primary" : "button-secondary"}
              onClick={() => setTab("campanhas")}
            >
              Campanhas
            </button>
            <button
              type="button"
              className={tab === "criativos" ? "button-primary" : "button-secondary"}
              onClick={() => setTab("criativos")}
            >
              Criativos
            </button>
            <SettingsGear thresholds={props.thresholds} businessId={businessId} />
          </div>
        </header>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{tab === "campanhas" ? "Campanha" : "Criativo"}</th>
                <th>Investimento</th>
                <th>Vendas</th>
                <th>Receita</th>
                <th>ROAS</th>
                <th>CPA</th>
                <th>CTR</th>
                <th>Frequência</th>
                <th>Dias ativo</th>
                <th>ThruPlay</th>
                <th>p50</th>
                {tab === "criativos" ? <th>Formato</th> : null}
                <th>Veredito</th>
              </tr>
            </thead>
            <tbody>
              {tab === "campanhas"
                ? props.campaigns.map((c) => (
                    <tr key={c.campaignId}>
                      <td>{c.name}</td>
                      <td>{fmtMoney(c.spend, currency)}</td>
                      <td>{c.sales}</td>
                      <td>{fmtMoney(c.revenue, currency)}</td>
                      <td>{fmtNum(c.roas)}</td>
                      <td>{c.cpa === null ? "sem dados" : fmtMoney(c.cpa, currency)}</td>
                      <td>{fmtNum(c.ctr, 1, "%")}</td>
                      <td>{fmtNum(c.frequency, 1)}</td>
                      <td>{c.daysActive}</td>
                      <td>{fmtNum(c.thruRate, 1, "%")}</td>
                      <td>{fmtNum(c.p50Rate, 1, "%")}</td>
                      <td>
                        {c.verdicts.length
                          ? c.verdicts.map((v) => VERDICT_LABEL[v]).join(", ")
                          : "nenhum"}
                      </td>
                    </tr>
                  ))
                : props.creatives.map((c) => (
                    <tr key={c.creativeId}>
                      <td>{c.name}</td>
                      <td>{fmtMoney(c.spend, currency)}</td>
                      <td>{c.sales}</td>
                      <td>{fmtMoney(c.revenue, currency)}</td>
                      <td>{fmtNum(c.roas)}</td>
                      <td>{c.cpa === null ? "sem dados" : fmtMoney(c.cpa, currency)}</td>
                      <td>{fmtNum(c.ctr, 1, "%")}</td>
                      <td>{fmtNum(c.frequency, 1)}</td>
                      <td>{c.daysActive}</td>
                      <td>{fmtNum(c.thruRate, 1, "%")}</td>
                      <td>{fmtNum(c.p50Rate, 1, "%")}</td>
                      <td>{c.format ?? "sem classificação"}</td>
                      <td>
                        {c.verdicts.length
                          ? c.verdicts.map((v) => VERDICT_LABEL[v.kind]).join(", ")
                          : "nenhum"}
                      </td>
                    </tr>
                  ))}
              {(tab === "campanhas" ? props.campaigns : props.creatives).length === 0 ? (
                <tr>
                  <td colSpan={13}>Sem dados no período e nos filtros atuais.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="metric-footnote">
          Receita no estágio bruto, a mesma base do Dashboard: vendas em produção atribuídas
          pelo ID do anúncio no utm_content. Retenção do feed vem dos insights da Meta
          (ThruPlay e p50 sobre as visualizações de 3 segundos).
        </p>
      </section>

      <section>
        <header className="card-header">
          <div>
            <p className="panel-label">Quadro de decisões</p>
            <h2>O que fazer agora</h2>
          </div>
        </header>
        <div style={{ display: "grid", gap: 14 }}>
          {BOARD_ORDER.map((kind) => (
            <div key={kind}>
              <h3 style={{ margin: "6px 0" }}>
                {VERDICT_LABEL[kind]} ({props.board[kind].length})
              </h3>
              {props.board[kind].length === 0 ? (
                <p className="metric-footnote">Nenhum criativo nesta ação no período.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  }}
                >
                  {props.board[kind].map((creative) => (
                    <BoardCard
                      key={`${kind}:${creative.creativeId}`}
                      creative={creative}
                      kind={kind}
                      currency={currency}
                      businessId={businessId}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="metric-footnote">
          Os botões abrem o fluxo de subir campanha já existente; nesta fase nada executa na
          Meta a partir daqui. Dispensar some e fica registrado; Adiar esconde por 7 dias.
        </p>
      </section>

      <section className="dashboard-card">
        <header className="card-header">
          <div>
            <p className="panel-label">Formatos</p>
            <h2>Retorno por formato do criativo</h2>
          </div>
        </header>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Formato</th>
                <th>Criativos</th>
                <th>Investimento</th>
                <th>Vendas</th>
                <th>Receita</th>
                <th>ROAS</th>
                <th>Participação</th>
              </tr>
            </thead>
            <tbody>
              {props.formats.map((f) => (
                <tr key={f.format}>
                  <td>{f.format}</td>
                  <td>{f.creatives}</td>
                  <td>{fmtMoney(f.spend, currency)}</td>
                  <td>{f.sales}</td>
                  <td>{fmtMoney(f.revenue, currency)}</td>
                  <td>{fmtNum(f.roas)}</td>
                  <td>{fmtNum(f.share, 1, "%")}</td>
                </tr>
              ))}
              {props.formats.length === 0 ? (
                <tr>
                  <td colSpan={7}>Sem criativos com dados no período.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-card">
        <header className="card-header">
          <div>
            <p className="panel-label">Ganchos</p>
            <h2>Ganchos que mais vendem</h2>
          </div>
        </header>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Gancho (da análise)</th>
                <th>Corpos</th>
                <th>Investimento</th>
                <th>Vendas</th>
                <th>CTR</th>
                <th>Hook rate</th>
                <th>ThruPlay</th>
              </tr>
            </thead>
            <tbody>
              {props.hooks.map((h) => (
                <tr key={h.hook}>
                  <td style={{ maxWidth: 420 }}>{h.hook}</td>
                  <td>{h.bodies}</td>
                  <td>{fmtMoney(h.spend, currency)}</td>
                  <td>{h.sales}</td>
                  <td>{fmtNum(h.ctr, 1, "%")}</td>
                  <td>{fmtNum(h.hookRate, 1, "%")}</td>
                  <td>{fmtNum(h.thruRate, 1, "%")}</td>
                </tr>
              ))}
              {props.hooks.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    Sem ganchos analisados com dados no período. Os ganchos vêm da análise dos
                    criativos da biblioteca.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
