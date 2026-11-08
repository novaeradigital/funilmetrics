"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Counts = { contas: number; conexoesNomes: string[]; produtosNomes: string[]; criativos: number };
type Action = (data: FormData) => Promise<void>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ProjectCard({ id, name, counts, canManage, renameAction, deleteAction }: {
  id: string;
  name: string;
  counts: Counts;
  canManage: boolean;
  renameAction: Action;
  deleteAction: Action;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const href = `/dashboard/projetos/${id}`;
  const open = () => router.push(href);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <article
      className="integration-config-card"
      onClick={open}
      style={{ cursor: "pointer", position: "relative" }}
      title={`Abrir ${name}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <p className="panel-label" style={{ fontSize: 15 }}>{name}</p>
        {canManage ? (
          <div onClick={stop} style={{ position: "relative" }}>
            <button
              type="button"
              aria-label={`Opções de ${name}`}
              onClick={() => setMenuOpen((value) => !value)}
              style={{ background: "transparent", border: 0, lineHeight: 1, padding: "2px 4px", cursor: "pointer", color: "var(--fm-purple-light)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
            {menuOpen ? (
              <div
                style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 168,
                  background: "var(--panel, #fff)", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10,
                  boxShadow: "0 10px 28px rgba(0,0,0,0.18)", padding: 6, display: "grid", gap: 2,
                }}
              >
                <button type="button" onClick={() => { setMenuOpen(false); setRenaming(true); }} style={{ textAlign: "left", background: "transparent", border: 0, padding: "7px 9px", borderRadius: 7, cursor: "pointer" }}>Renomear</button>
                <button type="button" onClick={() => { setMenuOpen(false); open(); }} style={{ textAlign: "left", background: "transparent", border: 0, padding: "7px 9px", borderRadius: 7, cursor: "pointer" }}>Editar</button>
                <form action={deleteAction} onSubmit={(event) => { if (!window.confirm(`Excluir o projeto ${name}? As associações caem; contas, produtos e criativos não são apagados.`)) event.preventDefault(); }}>
                  <input name="business_id" type="hidden" value={id} />
                  <button type="submit" style={{ textAlign: "left", width: "100%", background: "transparent", border: 0, padding: "7px 9px", borderRadius: 7, cursor: "pointer", color: "#b3261e" }}>Excluir projeto</button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {renaming ? (
        <form action={renameAction} onClick={stop} className="inline-filter-form" style={{ marginTop: 8 }}>
          <input name="business_id" type="hidden" value={id} />
          <label>Renomear<input defaultValue={name} name="name" required autoFocus /></label>
          <button type="submit">Salvar nome</button>
          <button type="button" className="secondary-button" onClick={() => setRenaming(false)}>Cancelar</button>
        </form>
      ) : (
        <ul style={{ listStyle: "none", margin: "8px 0 2px", padding: 0, display: "grid", gap: 1, lineHeight: 1.5, fontSize: "0.85rem", color: "var(--fm-text-soft)" }}>
          <li style={{ border: 0, background: "transparent", padding: 0, margin: 0 }}>{plural(counts.contas, "conta", "contas")}</li>
          {counts.conexoesNomes.length > 0
            ? counts.conexoesNomes.map((nome) => <li key={nome} style={{ border: 0, background: "transparent", padding: 0, margin: 0, fontSize: "0.78rem" }}>Conexão: {nome}</li>)
            : <li style={{ border: 0, background: "transparent", padding: 0, margin: 0, fontSize: "0.78rem" }}>0 conexões</li>}
          {counts.produtosNomes.length > 0
            ? counts.produtosNomes.map((nome) => <li key={nome} style={{ border: 0, background: "transparent", padding: 0, margin: 0 }}>{nome}</li>)
            : <li style={{ border: 0, background: "transparent", padding: 0, margin: 0 }}>0 produtos</li>}
          <li style={{ border: 0, background: "transparent", padding: 0, margin: 0 }}>{plural(counts.criativos, "criativo", "criativos")}</li>
        </ul>
      )}
    </article>
  );
}
