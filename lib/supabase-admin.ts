import "server-only";

import { setDefaultResultOrder } from "node:dns";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/env";

/**
 * Server-only Supabase client.
 *
 * Uses the service-role key when available (needed to write rosters and to
 * clear selections atomically) and falls back to the anon key so the app still
 * works with read/selection-only credentials. Neither key is ever sent to the
 * browser: this module is server-only.
 */

try {
  setDefaultResultOrder("ipv4first");
} catch {
  // Older runtimes without the API still proceed.
}

let adminClient: SupabaseClient | null = null;

export function hasServiceRoleKey(): boolean {
  return Boolean(getSupabaseServiceRoleKey());
}

function normalizeSupabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not a valid URL. Use the Project URL from Supabase Settings → API, for example https://xxxx.supabase.co.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must start with https://");
  }
  return parsed.origin;
}

function describeNetworkFailure(error: unknown): string {
  if (!(error instanceof Error)) return "fetch failed";
  const cause = "cause" in error ? error.cause : undefined;
  if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
  if (cause && typeof cause === "object" && "code" in cause) {
    return `${error.message} (${String((cause as { code: unknown }).code)})`;
  }
  return error.message;
}

const supabaseFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, { ...init, cache: "no-store" });
  } catch (error) {
    throw new Error(
      `Could not reach Supabase at ${getSupabaseUrl() || "(missing URL)"}: ${describeNetworkFailure(error)}. Confirm the project is not paused and NEXT_PUBLIC_SUPABASE_URL is the API Project URL.`,
    );
  }
};

export function getSupabaseAdmin(): SupabaseClient {
  const rawUrl = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey() || getSupabaseAnonKey();

  if (!rawUrl || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY (recommended) or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const url = normalizeSupabaseUrl(rawUrl);

  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: supabaseFetch,
        headers: { "X-Client-Info": "kingshot-merge-planner" },
      },
    });
  }
  return adminClient;
}

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  if (!url || !(getSupabaseServiceRoleKey() || getSupabaseAnonKey())) return false;
  try {
    normalizeSupabaseUrl(url);
    return true;
  } catch {
    return false;
  }
}

/** Tries a cheap read so health can report live connectivity, not just env presence. */
export async function pingSupabase(): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase environment variables are not set." };
  }
  try {
    const { error } = await getSupabaseAdmin().from("merge_sessions").select("id").limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeNetworkFailure(error) };
  }
}
