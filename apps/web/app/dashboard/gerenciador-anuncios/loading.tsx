export default function Loading() {
  return (
    <main className="centered-state">
      <section className="state-card" aria-live="polite">
        <span className="state-icon">…</span>
        <p className="eyebrow">Meta Ads</p>
        <h1>Carregando o gerenciador</h1>
        <p>Consultando a estrutura e as métricas sincronizadas deste projeto.</p>
      </section>
    </main>
  );
}
