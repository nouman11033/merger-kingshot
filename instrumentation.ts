/**
 * Prefer IPv4 from Vercel serverless. Undici's default IPv6-first lookup
 * often fails to reach Supabase with `TypeError: fetch failed`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { setDefaultResultOrder } = await import("node:dns");
  setDefaultResultOrder("ipv4first");
}
