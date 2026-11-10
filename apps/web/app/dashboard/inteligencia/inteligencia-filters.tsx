"use client";

import { useState } from "react";

type AccountOption = { id: string; name: string; businessId: string | null };
type BusinessOption = { id: string; name: string };

type Props = {
  accounts: AccountOption[];
  businessProjects: BusinessOption[];
  initial: {
    from: string | null;
    to: string | null;
    preset: string;
    businessId: string | null;
    accountIds: string[];
  };
};

const PRESETS: { value: string; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o histórico" },
  { value: "custom", label: "Personalizado" },
];

export function InteligenciaFilters({ accounts, businessProjects, initial }: Props) {
  const [preset, setPreset] = useState(initial.preset);
  const [businessId, setBusinessId] = useState(initial.businessId ?? "");
  const visibleAccounts = businessId
    ? accounts.filter((a) => a.businessId === businessId || a.businessId === null)
    : accounts;

  return (
    <form
      method="get"
      action="/dashboard/inteligencia"
      className="dashboard-card"
      style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginBottom: 16 }}
    >
      <label style={{ display: "grid", gap: 4 }}>
        <span className="panel-label">Período</span>
        <select name="period" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" ? (
        <>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="panel-label">De</span>
            <input type="date" name="from" defaultValue={initial.from ?? ""} required />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="panel-label">Até</span>
            <input type="date" name="to" defaultValue={initial.to ?? ""} required />
          </label>
        </>
      ) : null}
      <label style={{ display: "grid", gap: 4 }}>
        <span className="panel-label">Projeto</span>
        <select
          name="projeto"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
        >
          <option value="">Todos os projetos</option>
          {businessProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        <legend className="panel-label">Contas</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {visibleAccounts.map((account) => (
            <label key={account.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                name="account"
                value={account.id}
                defaultChecked={initial.accountIds.includes(account.id)}
              />
              {account.name}
            </label>
          ))}
          {visibleAccounts.length === 0 ? <span>Sem contas</span> : null}
        </div>
      </fieldset>
      <button type="submit" className="button-primary">
        Aplicar
      </button>
    </form>
  );
}
