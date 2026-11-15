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
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="currentColor"
              focusable="false"
            >
              <path d="M4 5.25A.75.75 0 0 1 4.75 4.5h14.5a.75.75 0 0 1 .57 1.28L14 12.1v5.65a.75.75 0 0 1-1.1.66l-2.4-1.35a.75.75 0 0 1-.37-.65v-4.3L4.18 5.78A.75.75 0 0 1 4 5.25Z" />
            </svg>
          </span>
          <Link className="login-brand-name" href="/">
            Funil Metrics
          </Link>
        </div>

        <p className="login-eyebrow">Acesso seguro</p>
        <h1 className="login-title">Entre na sua operação</h1>
        <p className="login-summary">
          A sessão é protegida pelo Supabase Auth e o acesso aos dados respeita
          organização, projeto e papel.
        </p>

        {error ? (
          <p className="notice notice-error login-notice">{error}</p>
        ) : null}
        {message ? (
          <p className="notice notice-success login-notice">{message}</p>
        ) : null}

        <form action={signIn} className="login-form">
          <div className="login-fields">
            <label className="login-field">
              <span>E-mail</span>
              <input
                autoComplete="email"
                name="email"
                required
                type="email"
              />
            </label>
            <label className="login-field">
              <span>Senha</span>
              <input
                autoComplete="current-password"
                minLength={8}
                name="password"
                required
                type="password"
              />
            </label>
          </div>
          <button className="login-submit" type="submit">
            Entrar
          </button>
        </form>

        <div className="login-divider">
          <span>Primeiro acesso</span>
        </div>

        <form action={signUp} className="login-form login-form-secondary">
          <div className="login-fields">
            <label className="login-field">
              <span>Nome</span>
              <input
                autoComplete="name"
                name="display_name"
                required
                type="text"
              />
            </label>
            <label className="login-field">
              <span>E-mail</span>
              <input
                autoComplete="email"
                name="email"
                required
                type="email"
              />
            </label>
            <label className="login-field">
              <span>Senha</span>
              <input
                autoComplete="new-password"
                minLength={8}
                name="password"
                required
                type="password"
              />
            </label>
          </div>
          <button className="secondary-button login-secondary-submit" type="submit">
            Criar conta inicial
          </button>
        </form>
      </section>
    </main>
  );
}
