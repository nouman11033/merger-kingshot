export type MergeSize = 2 | 3;
export type AllianceSlot = 1 | 2 | 3;
export type RosterSource = "api" | "csv";

export const PRIME_LIMIT = 100;

/** This planner is for a single kingdom. Kingdom ID is never entered in the UI. */
export const HOME_KINGDOM_ID = "2362";
export const TOP_ALLIANCE_LIMIT = 10;

/**
 * Alliance tags that changed in this kingdom. Old tags still work in stored
 * sessions and CSV input; API calls and ranking matches use the current tag.
 */
export const ALLIANCE_TAG_RENAMES: Record<string, string> = {
  RCB: "SUN",
};

export const RENAMED_RCB_TAG = "SUN";
export const RENAMED_RCB_NAME = "SuperUnitedNexus";

export const ALLIANCE_NAME_OVERRIDES: Record<string, string> = {
  SUN: RENAMED_RCB_NAME,
};

export const EXAMPLE_ALLIANCE_TAGS = ["SUN", "HEA", "TOP"] as const;

/** Current Kingshot tag for a stored or typed value (`RCB` → `SUN`). */
export function canonicalAllianceTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return trimmed;
  return ALLIANCE_TAG_RENAMES[trimmed] ?? ALLIANCE_TAG_RENAMES[trimmed.toUpperCase()] ?? trimmed;
}

export function allianceTagKey(tag: string): string {
  return canonicalAllianceTag(tag).toUpperCase();
}

export function allianceTagsMatch(left: string, right: string): boolean {
  return allianceTagKey(left) === allianceTagKey(right);
}

/** Tag plus full name after the RCB → SUN SuperUnitedNexus rename. */
export function applyKnownAllianceIdentity(
  tag: string,
  name?: string | null,
): { tag: string; name: string } {
  const givenName = name?.trim() ?? "";
  const isRenamedRcb =
    allianceTagsMatch(tag, "RCB") ||
    allianceTagsMatch(tag, "SUN") ||
    /^super\s*united\s*nexus$/i.test(givenName);

  if (isRenamedRcb) {
    return { tag: RENAMED_RCB_TAG, name: RENAMED_RCB_NAME };
  }

  const resolvedTag = canonicalAllianceTag(tag);
  return { tag: resolvedTag, name: givenName || resolvedTag };
}

export function canonicalAllianceName(tag: string, fallback?: string | null): string {
  return applyKnownAllianceIdentity(tag, fallback).name;
}

/** Tags to try against the Kingshot API, current name first, then the old one. */
export function allianceTagLookupCandidates(tag: string): string[] {
  const trimmed = tag.trim();
  if (!trimmed) return [];

  const canonical = canonicalAllianceTag(trimmed);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [canonical, trimmed]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }

  for (const [oldTag, currentTag] of Object.entries(ALLIANCE_TAG_RENAMES)) {
    if (currentTag.toUpperCase() !== canonical.toUpperCase() || seen.has(oldTag)) continue;
    seen.add(oldTag);
    candidates.push(oldTag);
  }

  return candidates;
}

/** The single internal player shape. Both the API and CSV importers produce this. */
export interface Player {
  id: string;
  /** Stable, namespaced identity from the source (never the player name). */
  externalId: string;
  name: string;
  power: number;
  allianceId: string;
  allianceName: string;
  allianceTag: string;
  allianceRank: number | null;
  /** In-alliance role from Kingshot, e.g. R5 / R4 / R3. Independent of list position. */
  allianceRankLabel: string | null;
  allianceSlot: AllianceSlot;
  kingdomId: string;
  selected: boolean;
  active: boolean;
  lastSyncedAt: string;
  townCenterLevel: number | null;
  kills: number | null;
  online: boolean | null;
  lastActiveAt: string | null;
  avatarUrl: string | null;
  /** Extra source fields, preserved but never required by the UI. */
  metadata: Record<string, unknown>;
}

export interface Alliance {
  id: string;
  mergeSessionId: string;
  slotNumber: AllianceSlot;
  kingdomId: string;
  allianceTag: string;
  allianceName: string;
  source: RosterSource;
  externalAllianceId: string | null;
  power: number | null;
  memberCount: number | null;
  leaderName: string | null;
  flagUrl: string | null;
  /** When the Kingshot API generated the data we stored. */
  apiCachedAt: string | null;
  /** When we last pulled this alliance into our database. */
  lastSyncedAt: string | null;
}

export interface MergeSession {
  id: string;
  name: string;
  mergeSize: MergeSize;
  primeLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface MergeSessionSummary extends MergeSession {
  alliances: Pick<Alliance, "slotNumber" | "allianceTag" | "kingdomId" | "allianceName">[];
  playerCount: number;
  selectedCount: number;
}

/** Everything a planner page needs for its first paint. */
export interface MergeSnapshot {
  session: MergeSession;
  alliances: Alliance[];
  players: Player[];
}

export interface PrimeEntry {
  primeRank: number;
  player: Player;
}

export interface AllianceStat {
  slotNumber: AllianceSlot;
  allianceTag: string;
  allianceName: string;
  totalPlayers: number;
  selectedCount: number;
  unselectedPower: number;
}

export interface PrimeStats {
  primeCount: number;
  primeLimit: number;
  remainingSlots: number;
  totalPower: number;
  unselectedPower: number;
  averagePower: number;
  isFull: boolean;
  allianceStats: AllianceStat[];
}

/** ------------------------------------------------------------------
 *  Kingshot Stats API — normalized results (produced by lib/kingshot.ts)
 *  ------------------------------------------------------------------ */

export interface NormalizedAllianceInfo {
  externalAllianceId: string | null;
  name: string;
  tag: string;
  kingdomId: string;
  power: number | null;
  memberCount: number | null;
  leaderName: string | null;
  flagUrl: string | null;
  powerRank: number | null;
}

export interface NormalizedMember {
  externalId: string;
  name: string;
  power: number;
  allianceRank: number | null;
  allianceRankLabel: string | null;
  kingdomId: string | null;
  townCenterLevel: number | null;
  kills: number | null;
  online: boolean | null;
  lastActiveAt: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface NormalizedRoster {
  info: NormalizedAllianceInfo;
  members: NormalizedMember[];
  /** API-reported freshness. Kingshot data can be up to 60 minutes old. */
  fresh: boolean | null;
  cachedAt: string | null;
  ageSeconds: number | null;
  /** When this server actually called the Kingshot API. */
  retrievedAt: string;
  /** True when served from this server's short-lived cache instead of a new call. */
  fromCache: boolean;
  /** False when no roster array could be located in the response. */
  memberArrayFound: boolean;
  /** Non-fatal issues found while normalizing (unexpected shapes, missing ids). */
  warnings: string[];
}

export interface AllianceInput {
  slotNumber: AllianceSlot;
  kingdomId: string;
  allianceTag: string;
}

/** One row from GET /v1/kingdoms/{kid}/ranks?board=alliance_power. */
export interface KingdomAllianceRank {
  rank: number;
  tag: string;
  name: string;
  power: number;
  memberCount: number | null;
  leaderName: string | null;
  flagUrl: string | null;
  externalAllianceId: string | null;
  kingdomId: string;
}

export interface KingdomAllianceRanking {
  kingdomId: string;
  alliances: KingdomAllianceRank[];
  retrievedAt: string;
  fromCache: boolean;
  capturedAt: string | null;
}

/** ------------------------------------------------------------------
 *  CSV import
 *  ------------------------------------------------------------------ */

export interface CsvColumnMapping {
  name: string | null;
  power: string | null;
  rank: string | null;
  id: string | null;
  hq: string | null;
  kills: string | null;
}

export interface CsvParseResult {
  fileName: string;
  headers: string[];
  mapping: CsvColumnMapping;
  rows: NormalizedMember[];
  previewRows: NormalizedMember[];
  skippedRows: number;
  errors: string[];
}

/** Payload accepted by the CSV import route (same model as API data). */
export interface CsvImportPayload {
  slotNumber: AllianceSlot;
  kingdomId: string;
  allianceTag: string;
  allianceName?: string;
  members: NormalizedMember[];
}

/** ------------------------------------------------------------------
 *  UI state
 *  ------------------------------------------------------------------ */

export type RealtimeStatus = "live" | "reconnecting" | "offline";
export type SyncStatus = "idle" | "syncing" | "error";

export type AllianceFilter = "all" | 1 | 2 | 3;
export type SelectionFilter = "all" | "selected" | "unselected";

export interface RosterFilters {
  search: string;
  alliance: AllianceFilter;
  selection: SelectionFilter;
  minPower: number | null;
  maxPower: number | null;
}

export interface SyncReport {
  slotNumber: AllianceSlot;
  allianceTag: string;
  kingdomId: string;
  allianceName: string;
  added: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  total: number;
  fresh: boolean | null;
  /** When the Kingshot API generated the data. */
  cachedAt: string | null;
  ageSeconds: number | null;
  /** When this server retrieved it. */
  retrievedAt: string | null;
  warnings: string[];
}
