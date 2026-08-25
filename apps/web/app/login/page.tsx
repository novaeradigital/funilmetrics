import Link from "next/link";
import { signIn, signUp } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand-link" href="/">
          Funil Metrics
        </Link>
        <p className="eyebrow">Acesso seguro</p>
        <h1>Entre na sua operação</h1>
        <p className="summary">
          A sessão é protegida pelo Supabase Auth e o acesso aos dados respeita
          organização, projeto e papel.
        </p>

        {error ? <p className="notice notice-error">{error}</p> : null}
        {message ? <p className="notice notice-success">{message}</p> : null}

        <div className="auth-grid">
          <form action={signIn}>
            <h2>Entrar</h2>
            <label>
              E-mail
              <input
                autoComplete="email"
                name="email"
                required
                type="email"
              />
            </label>
            <label>
              Senha
              <input
                autoComplete="current-password"
                minLength={8}
                name="password"
                required
                type="password"
              />
            </label>
            <button type="submit">Entrar</button>
          </form>

          <form action={signUp}>
            <h2>Primeiro acesso</h2>
            <label>
              Nome
              <input
                autoComplete="name"
                name="display_name"
                required
                type="text"
              />
            </label>
            <label>
              E-mail
              <input
                autoComplete="email"
                name="email"
                required
                type="email"
              />
            </label>
            <label>
              Senha
              <input
                autoComplete="new-password"
                minLength={8}
                name="password"
                required
                type="password"
              />
            </label>
            <button className="secondary-button" type="submit">
              Criar conta inicial
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
