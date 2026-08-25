const requiredPublicEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export function getPublicSupabaseEnvironment() {
  for (const name of requiredPublicEnvironment) {
    if (!process.env[name]) {
      throw new Error(`Variável obrigatória ausente: ${name}`);
    }
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    publishableKey: process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  };
}
