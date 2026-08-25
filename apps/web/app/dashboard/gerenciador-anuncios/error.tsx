"use client";

export default function ErrorState({reset}:{reset:()=>void}) {
  return (
    <main className="centered-state">
      <section className="state-card" role="alert">
        <span className="state-icon">!</span>
        <p className="eyebrow">Falha ao carregar</p>
        <h1>Não conseguimos abrir o gerenciador</h1>
        <p>Os dados sincronizados continuam preservados. Tente refazer a consulta.</p>
        <button type="button" onClick={reset}>Tentar novamente</button>
      </section>
    </main>
  );
}
