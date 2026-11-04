"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shiftCalendarDate } from "../../../lib/calendar-date";
import {
  formatRangeLabel,
  type BestAdSort,
  type PeriodPreset,
} from "../../../lib/melhores-anuncios";

export type FiltersInitial = {
  from: string | null;
  to: string | null;
  preset: PeriodPreset;
  sort: BestAdSort;
  minSpend: number;
  accountIds: string[];
  businessId: string | null;
};

type AccountOption = { id: string; name: string; businessId: string | null };
type BusinessOption = { id: string; name: string };
type Props = {
  accounts: AccountOption[];
  businessProjects: BusinessOption[];
  initial: FiltersInitial;
};

const sortOptions: { key: BestAdSort; label: string }[] = [
  { key: "sales", label: "Vendas" },
  { key: "revenue", label: "Receita" },
  { key: "roas", label: "ROAS" },
  { key: "profit", label: "Lucro" },
  { key: "quick", label: "Leitura rápida" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC (menor primeiro)" },
  { key: "initiate", label: "Initiate Checkout" },
  { key: "cost_per_initiate", label: "Custo por Initiate" },
  { key: "clicks", label: "Cliques no link" },
];

const presetOptions: { key: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "month", label: "Este mês" },
  { key: "all", label: "Todo o histórico" },
];

const presetLabels: Record<PeriodPreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  month: "Este mês",
  all: "Todo o histórico",
  custom: "",
};

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function presetRange(key: Exclude<PeriodPreset, "custom">, today: string): { from: string | null; to: string | null } {
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = shiftCalendarDate(today, -1);
      return { from: day, to: day };
    }
    case "7d":
      return { from: shiftCalendarDate(today, -6), to: today };
    case "90d":
      return { from: shiftCalendarDate(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "all":
      return { from: null, to: null };
    default:
      return { from: shiftCalendarDate(today, -29), to: today };
  }
}

function monthCells(monthKey: string): (string | null)[] {
  const [year, month] = monthKey.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year!, month! - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthTitle(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const name = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, 1)),
  );
  return `${name.charAt(0).toUpperCase() + name.slice(1)} ${year}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function FunnelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16l-6.2 7.2V19l-3.6-2v-4.8L4 5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MelhoresAnunciosFilters({ accounts, businessProjects, initial }: Props) {
  const router = useRouter();
  const barRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<"filters" | "date" | null>(null);
  const [sort, setSort] = useState<BestAdSort>(initial.sort);
  const [minSpend, setMinSpend] = useState(String(initial.minSpend));
  const [accountIds, setAccountIds] = useState<string[]>(initial.accountIds);
  const [businessId, setBusinessId] = useState<string>(initial.businessId ?? "");
  const accountBusiness = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.businessId])),
    [accounts],
  );
  const visibleAccounts = businessId
    ? accounts.filter((account) => account.businessId === businessId)
    : accounts;

  function chooseBusiness(next: string) {
    setBusinessId(next);
    if (next) {
      setAccountIds((current) => current.filter((id) => accountBusiness.get(id) === next));
    }
  }
  const [preset, setPreset] = useState<PeriodPreset>(initial.preset);
  const [from, setFrom] = useState<string | null>(initial.from);
  const [to, setTo] = useState<string | null>(initial.to);
  const [pickingEnd, setPickingEnd] = useState(false);
  const today = useMemo(localToday, []);
  const [viewMonth, setViewMonth] = useState((initial.from ?? today).slice(0, 7));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpen(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  const dateLabel =
    preset === "custom" && from && to ? formatRangeLabel(from, to) : presetLabels[preset];

  function choosePreset(key: Exclude<PeriodPreset, "custom">) {
    const range = presetRange(key, today);
    setPreset(key);
    setFrom(range.from);
    setTo(range.to);
    setPickingEnd(false);
    setOpen(null);
  }

  function chooseDay(day: string) {
    if (!from || (from && to) || !pickingEnd) {
      setFrom(day);
      setTo(null);
      setPreset("custom");
      setPickingEnd(true);
      return;
    }
    if (day >= from) {
      setTo(day);
      setPickingEnd(false);
      setOpen(null);
    } else {
      setFrom(day);
    }
  }

  function toggleAccount(id: string) {
    setAccountIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function apply() {
    const params = new URLSearchParams();
    if (preset === "all") {
      params.set("period", "all");
    } else if (preset !== "custom") {
      params.set("period", preset);
    } else if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    if (sort !== "sales") params.set("sort", sort);
    const min = Number(minSpend.replace(",", "."));
    if (Number.isFinite(min) && min >= 0 && min !== 50) params.set("min", String(min));
    if (accountIds.length) params.set("account", accountIds.join(","));
    if (businessId) params.set("projeto", businessId);
    const query = params.toString();
    router.push(query ? `/dashboard/melhores-anuncios?${query}` : "/dashboard/melhores-anuncios", {
      scroll: false,
    });
    setOpen(null);
  }

  function renderMonth(monthKey: string) {
    const cells = monthCells(monthKey);
    return (
      <div className="ma-cal-month" key={monthKey}>
        <strong>{monthTitle(monthKey)}</strong>
        <div className="ma-cal-week">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="ma-cal-grid">
          {cells.map((day, index) => {
            if (!day) return <span key={`empty-${index}`} />;
            const disabled = day > today;
            const inRange = from && to && day > from && day < to;
            const classes = [
              "ma-cal-day",
              day === from ? "is-start" : "",
              day === to ? "is-end" : "",
              inRange ? "is-range" : "",
              day === today ? "is-today" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={day}
                type="button"
                className={classes}
                disabled={disabled}
                onClick={() => chooseDay(day)}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="ma-filterbar" ref={barRef}>
      <label className="ma-pill ma-pill-field">
        <span>Projeto</span>
        <select
          value={businessId}
          onChange={(event) => chooseBusiness(event.target.value)}
          aria-label="Projeto de negócio"
        >
          <option value="">Todos os projetos</option>
          {businessProjects.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ma-pill ma-pill-field">
        <span>Ordenar por</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as BestAdSort)}>
          {sortOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ma-pill ma-pill-field">
        <span>Investimento mínimo</span>
        <span className="ma-pill-money">
          R$
          <input
            inputMode="decimal"
            value={minSpend}
            onChange={(event) => setMinSpend(event.target.value)}
            aria-label="Investimento mínimo em reais"
          />
        </span>
      </label>

      <div className="ma-pop-wrap">
        <button
          type="button"
          className={`ma-pill${open === "filters" ? " is-open" : ""}`}
          aria-expanded={open === "filters"}
          onClick={() => setOpen(open === "filters" ? null : "filters")}
        >
          <FunnelIcon />
          Filtros
          {accountIds.length ? <span className="ma-pill-badge">{accountIds.length}</span> : null}
          <span aria-hidden="true">▾</span>
        </button>
        {open === "filters" ? (
          <div className="ma-pop ma-pop-accounts">
            <strong>Contas de anúncios</strong>
            {visibleAccounts.map((account) => (
              <label key={account.id}>
                <input
                  type="checkbox"
                  checked={accountIds.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                />
                {account.name}
              </label>
            ))}
            <small>
              {businessId
                ? "Mostrando só as contas do projeto selecionado."
                : "Nenhuma marcada mostra todas as contas."}
            </small>
          </div>
        ) : null}
      </div>

      <div className="ma-pop-wrap">
        <button
          type="button"
          className={`ma-pill${open === "date" ? " is-open" : ""}`}
          aria-expanded={open === "date"}
          onClick={() => {
            setViewMonth((from ?? today).slice(0, 7));
            setOpen(open === "date" ? null : "date");
          }}
        >
          <CalendarIcon />
          {dateLabel}
          <span aria-hidden="true">▾</span>
        </button>
        {open === "date" ? (
          <div className="ma-pop ma-pop-date">
            <div className="ma-cal-presets">
              {presetOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={preset === option.key ? "is-active" : undefined}
                  onClick={() => choosePreset(option.key)}
                >
                  {option.label}
                </button>
              ))}
              <small>ou escolha os dias no calendário</small>
            </div>
            <div className="ma-cal-body">
              <div className="ma-cal-nav">
                <button type="button" aria-label="Mês anterior" onClick={() => setViewMonth(shiftMonth(viewMonth, -1))}>
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Próximo mês"
                  disabled={viewMonth >= today.slice(0, 7)}
                  onClick={() => setViewMonth(shiftMonth(viewMonth, 1))}
                >
                  ›
                </button>
              </div>
              <div className="ma-cal-months">
                {renderMonth(viewMonth)}
                {renderMonth(shiftMonth(viewMonth, 1))}
              </div>
              <div className="ma-cal-footer">
                <span>
                  {from && to
                    ? formatRangeLabel(from, to)
                    : from
                      ? `${formatRangeLabel(from, from)} → escolha o dia final`
                      : "Escolha o dia inicial"}
                </span>
                <span className="ma-cal-tz">(GMT-03:00) America/Sao_Paulo</span>
                <button
                  type="button"
                  className="ma-cal-cancel"
                  onClick={() => {
                    setPreset(initial.preset);
                    setFrom(initial.from);
                    setTo(initial.to);
                    setOpen(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <button type="button" className="ma-apply" onClick={apply}>
        Aplicar
      </button>
    </div>
  );
}
