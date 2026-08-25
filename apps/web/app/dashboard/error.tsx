"use client";

export default function DashboardError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <main className="dashboard-state">
      <div className="state-card">
        <span className="state-icon" aria-hidden="true">!</span>
        <p className="eyebrow">Falha ao carregar</p>
        <h1>Não conseguimos abrir o painel</h1>
        <p>Seus dados continuam preservados. Tente novamente para refazer a consulta.</p>
        <button type="button" onClick={reset}>Tentar novamente</button>
      </div>
    </main>
  );
}
