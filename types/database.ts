/** Row shapes as they exist in PostgreSQL / arrive over Supabase Realtime. */

export interface MergeSessionRow {
  id: string;
  name: string;
  merge_size: number;
  prime_limit: number;
  created_at: string;
  updated_at: string;
}

export interface AllianceRow {
  id: string;
  merge_session_id: string;
  slot_number: number;
  kingdom_id: string;
  alliance_tag: string;
  alliance_name: string;
  source: string;
  external_alliance_id: string | null;
  power: number | string | null;
  member_count: number | null;
  leader_name: string | null;
  flag_url: string | null;
  api_cached_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerRow {
  id: string;
  merge_session_id: string;
  alliance_id: string;
  external_id: string;
  name: string;
  power: number | string;
  alliance_rank: number | null;
  kingdom_id: string | null;
  town_center_level: number | null;
  kills: number | string | null;
  online: boolean | null;
  last_active_at: string | null;
  avatar_url: string | null;
  metadata: Record<string, unknown> | null;
  active: boolean;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface SelectionRow {
  merge_session_id: string;
  player_id: string;
  selected: boolean;
  updated_at: string;
}

export const SELECTIONS_TABLE = "merge_player_selections";
export const PLAYERS_TABLE = "players";
export const ALLIANCES_TABLE = "alliances";
export const SESSIONS_TABLE = "merge_sessions";
