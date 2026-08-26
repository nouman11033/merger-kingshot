import type { AllianceRow, MergeSessionRow, PlayerRow } from "@/types/database";
import type {
  Alliance,
  AllianceSlot,
  MergeSession,
  MergeSize,
  Player,
  RosterSource,
} from "@/types/roster";

/**
 * Row -> internal model mapping. Isomorphic on purpose: the server uses it for
 * the initial snapshot and the browser uses it to patch Realtime payloads,
 * so both paths produce identical objects.
 */

function toNumeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSlot(value: number): AllianceSlot {
  return (value === 2 ? 2 : value === 3 ? 3 : 1) as AllianceSlot;
}

function readAllianceRankLabel(
  metadata: Record<string, unknown> | null | undefined,
  positionalRank: number | null,
): string | null {
  const raw = metadata?.alliance_rank_label;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const source = metadata?.source_alliance_rank;
  if (typeof source === "number" && source >= 1 && source <= 5 && source !== positionalRank) {
    return `R${source}`;
  }
  return null;
}

export function mapSession(row: MergeSessionRow): MergeSession {
  return {
    id: row.id,
    name: row.name,
    mergeSize: (row.merge_size === 3 ? 3 : 2) as MergeSize,
    primeLimit: row.prime_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAlliance(row: AllianceRow): Alliance {
  return {
    id: row.id,
    mergeSessionId: row.merge_session_id,
    slotNumber: toSlot(row.slot_number),
    kingdomId: row.kingdom_id,
    allianceTag: row.alliance_tag,
    allianceName: row.alliance_name || row.alliance_tag,
    source: (row.source === "csv" ? "csv" : "api") as RosterSource,
    externalAllianceId: row.external_alliance_id,
    power: toNumeric(row.power),
    memberCount: row.member_count,
    leaderName: row.leader_name,
    flagUrl: row.flag_url,
    apiCachedAt: row.api_cached_at,
    lastSyncedAt: row.last_synced_at,
  };
}

export function mapPlayer(
  row: PlayerRow,
  alliance: Pick<Alliance, "allianceName" | "allianceTag" | "slotNumber"> | undefined,
  selected: boolean,
): Player {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    power: toNumeric(row.power) ?? 0,
    allianceId: row.alliance_id,
    allianceName: alliance?.allianceName ?? "",
    allianceTag: alliance?.allianceTag ?? "",
    allianceRank: row.alliance_rank,
    allianceRankLabel: readAllianceRankLabel(row.metadata, row.alliance_rank),
    allianceSlot: alliance?.slotNumber ?? 1,
    kingdomId: row.kingdom_id ?? "",
    selected,
    active: row.active,
    lastSyncedAt: row.last_synced_at,
    townCenterLevel: row.town_center_level,
    kills: toNumeric(row.kills),
    online: row.online,
    lastActiveAt: row.last_active_at,
    avatarUrl: row.avatar_url,
    metadata: row.metadata ?? {},
  };
}
