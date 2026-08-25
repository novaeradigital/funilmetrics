import type { ReactNode } from "react";
import { signOut } from "./actions";

type DashboardTopbarProps = {
  returnTo: string;
  statusLabel?: string;
  statusTone?: "default" | "attention";
  children?: ReactNode;
  showSignOut?: boolean;
};

export function DashboardTopbar({
  returnTo,
  statusLabel = "Produção",
  statusTone = "default",
  children,
  showSignOut = true,
}: DashboardTopbarProps) {
  return (
    <header className="app-topbar dashboard-topbar">
      <span className="topbar-route-context" aria-label="Contexto da página">
        {returnTo === "/dashboard" ? "Visão geral" : returnTo.split("/").filter(Boolean).slice(1).join(" / ")}
      </span>
      <div className="topbar-actions">
        <span className={`data-status ${statusTone === "attention" ? "data-attention" : ""}`} title="Estado do contexto atual">
          <i />
          {statusLabel}
        </span>
        {children}
        {showSignOut ? (
          <form action={signOut}>
            <button className="icon-button topbar-signout" type="submit" title="Encerrar sessão">
              Sair
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
