import "server-only";

/**
 * Read a server environment variable at request time.
 *
 * Next.js replaces `process.env.SOME_NAME` with a build-time literal. On Vercel
 * that means KINGSHOT_API_KEY from the project dashboard is ignored if it was
 * empty (or unset) during `next build`. Computed property access keeps the
 * lookup dynamic so serverless functions read the live value.
 */
export function readServerEnv(name: string): string {
  const env = globalThis.process?.env as Record<string, string | undefined> | undefined;
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Kingshot Stats API key. Prefers the server-only name. Also accepts the
 * NEXT_PUBLIC_ variant because that is a common Vercel dashboard mistake —
 * prefer KINGSHOT_API_KEY so the key never ships to the browser.
 */
export function getKingshotApiKey(): string {
  return readServerEnv("KINGSHOT_API_KEY") || readServerEnv("NEXT_PUBLIC_KINGSHOT_API_KEY");
}

export function getKingshotApiBaseUrl(): string {
  return (readServerEnv("KINGSHOT_API_BASE_URL") || "https://api.mightpulse.com/v1").replace(
    /\/+$/,
    "",
  );
}

export function isKingshotApiConfigured(): boolean {
  return Boolean(getKingshotApiKey());
}

export function kingshotEnvStatus() {
  const serverKey = Boolean(readServerEnv("KINGSHOT_API_KEY"));
  const publicKeyFallback = !serverKey && Boolean(readServerEnv("NEXT_PUBLIC_KINGSHOT_API_KEY"));
  return {
    kingshotApiKey: serverKey || publicKeyFallback,
    usedPublicKeyFallback: publicKeyFallback,
    kingshotBaseUrl: getKingshotApiBaseUrl(),
  };
}

export function getSupabaseUrl(): string {
  return readServerEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return readServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey(): string {
  return readServerEnv("SUPABASE_SERVICE_ROLE_KEY");
}
