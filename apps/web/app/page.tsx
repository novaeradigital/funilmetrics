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
    <main>
      <section className="hero">
        <p className="eyebrow">Fundação técnica</p>
        <h1>{PRODUCT_NAME}</h1>
        <p className="summary">
          A base do produto está pronta para receber dados, consolidar jornadas e
          evoluir com segurança para a Central de Criativos.
        </p>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
        <Link className="primary-link" href="/login">
          Acessar o ambiente
        </Link>
      </section>
    </main>
  );
}
