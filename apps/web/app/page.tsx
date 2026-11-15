import { PRODUCT_NAME } from "@funil-metrics/domain";
import Link from "next/link";

const foundations = [
  "Jornada única por pessoa",
  "Eventos brutos preservados",
  "Integrações idempotentes",
  "Métricas reproduzíveis",
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-hero">
        <span className="home-mark" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="currentColor"
            focusable="false"
          >
            <path d="M4 5.25A.75.75 0 0 1 4.75 4.5h14.5a.75.75 0 0 1 .57 1.28L14 12.1v5.65a.75.75 0 0 1-1.1.66l-2.4-1.35a.75.75 0 0 1-.37-.65v-4.3L4.18 5.78A.75.75 0 0 1 4 5.25Z" />
          </svg>
        </span>
        <p className="home-eyebrow">Fundação técnica</p>
        <h1 className="home-title">{PRODUCT_NAME}</h1>
        <p className="home-summary">
          A base do produto está pronta para receber dados, consolidar jornadas e
          evoluir com segurança para a Central de Criativos.
        </p>
        <ul className="home-foundations">
          {foundations.map((foundation) => (
            <li key={foundation} className="home-foundation">
              <span className="home-foundation-dot" aria-hidden="true" />
              {foundation}
            </li>
          ))}
        </ul>
        <Link className="home-cta" href="/login">
          Acessar o ambiente
        </Link>
      </section>
    </main>
  );
}
