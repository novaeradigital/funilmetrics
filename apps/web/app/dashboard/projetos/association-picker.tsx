"use client";

import { useState } from "react";

export type PickerItem = { id: string; name: string; detail?: string };
export type PickerGroup = { title: string; items: PickerItem[] };
type Action = (data: FormData) => Promise<void>;

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8,
};
const rowStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
  padding: "6px 2px", borderBottom: "1px solid var(--fm-border)",
};
const addButtonStyle: React.CSSProperties = { whiteSpace: "nowrap" };

export function AssociationPicker({ target, businessProjectId, returnTo, groups, action, bulkAction, multi }: {
  target: string;
  businessProjectId: string;
  returnTo: string;
  groups: PickerGroup[];
  action: Action;
  bulkAction?: Action;
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !q || item.name.toLowerCase().includes(q)) }))
    .filter((group) => group.items.length > 0);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
        {open ? "Fechar" : "Adicionar"}
      </button>
      {open ? (
        <div style={{ marginTop: 10, border: "1px solid var(--fm-border)", borderRadius: 10, padding: 12, background: "var(--fm-surface)" }}>
          <input
            type="search"
            placeholder="Buscar pelo nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={inputStyle}
          />
          {total === 0 ? <p className="dashboard-context">Nada disponível para adicionar.</p> : null}
          {total > 0 && visible.length === 0 ? <p className="dashboard-context">Nenhum item bate com a busca.</p> : null}
          {multi && bulkAction ? (
            <form action={bulkAction}>
              <input name="business_project_id" type="hidden" value={businessProjectId} />
              <input name="return_to" type="hidden" value={returnTo} />
              {visible.map((group) => (
                <div key={group.title}>
                  <p className="panel-label" style={{ marginTop: 10 }}>{group.title}</p>
                  {group.items.map((item) => (
                    <label key={item.id} style={rowStyle}>
                      <span><input type="checkbox" name="creative_id" value={item.id} /> <strong>{item.name}</strong>{item.detail ? <span> · {item.detail}</span> : null}</span>
                    </label>
                  ))}
                </div>
              ))}
              {visible.length > 0 ? <button type="submit" style={{ marginTop: 10 }}>Adicionar selecionados</button> : null}
            </form>
          ) : (
            visible.map((group) => (
              <div key={group.title}>
                <p className="panel-label" style={{ marginTop: 10 }}>{group.title}</p>
                {group.items.map((item) => (
                  <form key={item.id} action={action} style={rowStyle}>
                    <input name="target" type="hidden" value={target} />
                    <input name="target_id" type="hidden" value={item.id} />
                    <input name="business_project_id" type="hidden" value={businessProjectId} />
                    <input name="return_to" type="hidden" value={returnTo} />
                    <span><strong>{item.name}</strong>{item.detail ? <span> · {item.detail}</span> : null}</span>
                    <button type="submit" style={addButtonStyle}>Adicionar</button>
                  </form>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
