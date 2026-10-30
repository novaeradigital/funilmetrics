"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type HubCard = {
  id: string;
  name: string;
  href: string;
  status: string;
  active: boolean;
  detail: string;
  cta: string;
};

export type HubGroup = {
  id: string;
  title: string;
  description: string;
  cards: HubCard[];
};

function PlatformLogo({ id }: { id: string }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  } as const;
  switch (id) {
    case "lastlink":
      return (
        <svg {...stroke}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "configcheckout":
      return (
        <svg {...stroke}>
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
      );
    case "meta":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <defs>
            <linearGradient id="fm-meta-grad" x1="3" y1="19" x2="21" y2="5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#00C6FF" />
              <stop offset="1" stopColor="#0064E0" />
            </linearGradient>
          </defs>
          <path
            fill="url(#fm-meta-grad)"
            d="M21.4 12.1c0-3.9-2.2-6.6-5.3-6.6-2 0-3.4 1.1-4.4 2.7l-.8 1.3-.8-1.3C9.2 6.6 7.7 5.5 5.8 5.5c-1.9 0-3.2 1.5-3.2 3.6 0 3.4 2.5 7.4 4.7 7.4 1 0 1.8-.5 2.4-1.5l1.2-2 1.2 2c.6 1 1.4 1.5 2.4 1.5 2.9 0 6.9-1.9 6.9-4.4Zm-6.9 2.6c-.5 0-.9-.3-1.3-.9l-1.3-2.1 1-1.6c.7-1.2 1.6-1.8 2.7-1.8 1.9 0 3.1 1.6 3.1 3.8 0 1.5-2.3 2.6-4.2 2.6ZM7.4 14.7c-1.3 0-3-2.6-3-5 0-1.2.7-2 1.7-2 1 0 1.9.7 2.6 1.9l1 1.6-1 1.7c-.4.6-.8 1.8-1.3 1.8Z"
          />
        </svg>
      );
    case "google_drive":
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
          <path d="M12.8 4.2 5 17.8" stroke="#34A853" />
          <path d="M12.8 4.2 19.4 15.6" stroke="#FBBC04" />
          <path d="M4.4 17.8h15.2" stroke="#4285F4" />
          <path d="M9.2 11.2h9.4" stroke="#FBBC04" strokeWidth={2} />
          <path d="M9.2 11.2 5 17.8" stroke="#34A853" strokeWidth={2} />
          <path d="M13.9 11.2l2.8 6.6" stroke="#4285F4" strokeWidth={2} />
        </svg>
      );
    case "openai":
      return (
        <svg {...stroke}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      );
    case "cloudflare_r2":
      return (
        <svg {...stroke}>
          <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
          <path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13" />
          <path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8" />
        </svg>
      );
    case "clamav":
      return (
        <svg {...stroke}>
          <path d="M12 3l7 2.8v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8L12 3Z" />
          <path d="m9 11.5 2.2 2.2L15.5 9.4" />
        </svg>
      );
    case "railway":
      return (
        <svg {...stroke}>
          <path d="M7 4 4.5 20M17 4l2.5 16M6.2 8h11.6M5.6 12h12.8M5 16h14" />
        </svg>
      );
    case "cloudflare":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M19.6 17.9a4.1 4.1 0 0 0 .8-8.1 6.8 6.8 0 0 0-13.3-1A4.9 4.9 0 0 0 7.4 18h12.2v-.1Z" />
        </svg>
      );
    default:
      return (
        <svg {...stroke}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      );
  }
}

function normalize(text: string) {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function IntegrationsHub({ groups }: { groups: HubGroup[] }) {
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("todas");
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return groups
      .filter((group) => groupId === "todas" || group.id === groupId)
      .map((group) => ({
        ...group,
        cards: group.cards.filter((card) => !q || normalize(card.name).includes(q)),
      }))
      .filter((group) => group.cards.length > 0);
  }, [groups, query, groupId]);
  const total = groups.reduce((sum, group) => sum + group.cards.length, 0);

  return (
    <div>
      <div className="integration-hub-tools">
        <label className="integration-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar integrações..."
            type="search"
            value={query}
          />
        </label>
        <div className="integration-chips" role="tablist" aria-label="Categorias">
          <button
            className={groupId === "todas" ? "integration-chip is-active" : "integration-chip"}
            onClick={() => setGroupId("todas")}
            type="button"
          >
            Todas ({total})
          </button>
          {groups.map((group) => (
            <button
              className={groupId === group.id ? "integration-chip is-active" : "integration-chip"}
              key={group.id}
              onClick={() => setGroupId(group.id)}
              type="button"
            >
              {group.title}
            </button>
          ))}
        </div>
      </div>
      {visible.length ? visible.map((group) => (
        <section className="integration-group" key={group.id}>
          <header className="integration-group-head">
            <h2>{group.title}</h2>
            <p>{group.description}</p>
          </header>
          <div className="integration-hub-grid">
            {group.cards.map((card) => (
              <Link className="integration-hub-card" href={card.href} key={card.id}>
                <div className="integration-hub-head">
                  <span className={`integration-logo integration-logo-${card.id}`}>
                    <PlatformLogo id={card.id} />
                  </span>
                  <span className={card.active ? "status-dot" : "status-dot is-muted"} />
                </div>
                <strong className="integration-hub-name">{card.name}</strong>
                <p className="integration-hub-status">{card.status}</p>
                <small>{card.detail}</small>
                <span className="integration-hub-cta">{card.cta} →</span>
              </Link>
            ))}
          </div>
        </section>
      )) : (
        <div className="empty-state">
          <strong>Nenhuma integração encontrada</strong>
          <p>Ajuste a busca ou escolha outra categoria.</p>
        </div>
      )}
    </div>
  );
}
