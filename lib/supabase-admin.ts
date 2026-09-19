import "server-only";

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

let adminClient: SupabaseClient | null = null;

export function hasServiceRoleKey(): boolean {
  return Boolean(getSupabaseServiceRoleKey());
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey() || getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY (recommended) or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "kingshot-merge-planner" } },
    });
  }
  return adminClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && (getSupabaseServiceRoleKey() || getSupabaseAnonKey()));
}
