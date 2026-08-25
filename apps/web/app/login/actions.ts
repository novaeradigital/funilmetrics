"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { activateUser } from "../../lib/activate-user";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function loginUrl(kind: "error" | "message", value: string) {
  return `/login?${kind}=${encodeURIComponent(value)}`;
}

async function bootstrapUser() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_first_user");

  if (error && !error.message.includes("invitation_required")) {
    throw error;
  }

  return error;
}

export async function signIn(formData: FormData) {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");

  if (!email || password.length < 8) {
    redirect(loginUrl("error", "Informe e-mail e senha válidos."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(loginUrl("error", "Não foi possível entrar com esses dados."));
  }

  const bootstrapError = await bootstrapUser();

  if (bootstrapError) {
    await supabase.auth.signOut();
    redirect(
      loginUrl(
        "error",
        "Sua conta ainda não possui convite para esta organização.",
      ),
    );
  }
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) await activateUser(authData.user.id);

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const displayName = field(formData, "display_name");
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");

  if (!displayName || !email || password.length < 8) {
    redirect(
      loginUrl(
        "error",
        "Preencha o nome, um e-mail válido e uma senha com ao menos 8 caracteres.",
      ),
    );
  }

  const requestHeaders = await headers();
  const origin = process.env.APP_URL ?? requestHeaders.get("origin");

  if (!origin) {
    throw new Error("APP_URL não configurada.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    if (
      error.code === "user_already_exists" ||
      error.code === "email_exists"
    ) {
      redirect(
        loginUrl(
          "message",
          "A conta já foi criada. Confira seu e-mail para confirmar o acesso ou tente entrar.",
        ),
      );
    }

    redirect(loginUrl("error", "Não foi possível criar a conta."));
  }

  if (data.session) {
    const bootstrapError = await bootstrapUser();

    if (bootstrapError) {
      await supabase.auth.signOut();
      redirect(
        loginUrl(
          "error",
          "O ambiente já possui proprietário. Solicite um convite.",
        ),
      );
    }

    redirect("/dashboard");
  }

  redirect(
    loginUrl(
      "message",
      "Confira seu e-mail para confirmar a conta antes de entrar.",
    ),
  );
}
