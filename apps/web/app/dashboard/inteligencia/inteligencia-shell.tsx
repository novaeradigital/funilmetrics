"use client";

import { useState, type ReactNode } from "react";

type Props = {
  panels: ReactNode;
  chat: ReactNode;
};

/** Desktop: chat fixo a direita. Celular: abas Painel e Chat. */
export function InteligenciaShell({ panels, chat }: Props) {
  const [tab, setTab] = useState<"painel" | "chat">("painel");
  return (
    <div>
      <style>{`
        .intel-shell { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
        .intel-chat-col { position: sticky; top: 16px; height: calc(100vh - 140px); }
        .intel-mobile-tabs { display: none; }
        @media (max-width: 1023px) {
          .intel-shell { display: block; }
          .intel-chat-col { position: static; height: auto; }
          .intel-mobile-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
          .intel-hide-mobile { display: none; }
        }
      `}</style>
      <div className="intel-mobile-tabs">
        <button
          type="button"
          className={tab === "painel" ? "button-primary" : "button-secondary"}
          onClick={() => setTab("painel")}
        >
          Painel
        </button>
        <button
          type="button"
          className={tab === "chat" ? "button-primary" : "button-secondary"}
          onClick={() => setTab("chat")}
        >
          Chat
        </button>
      </div>
      <div className="intel-shell">
        <div className={tab === "chat" ? "intel-hide-mobile" : undefined}>{panels}</div>
        <div
          className={`intel-chat-col${tab === "painel" ? " intel-hide-mobile" : ""}`}
        >
          {chat}
        </div>
      </div>
    </div>
  );
}
