import "server-only";

import {
  isRecord,
  pick,
  toBooleanOrNull,
  toIsoOrNull,
  toNonNegativeInt,
  toNumber,
  toPositiveInt,
  toStringOrNull,
} from "@/lib/coerce";
import type {
  KingdomAllianceRank,
  KingdomAllianceRanking,
  NormalizedAllianceInfo,
  NormalizedMember,
  NormalizedRoster,
} from "@/types/roster";
import { HOME_KINGDOM_ID, TOP_ALLIANCE_LIMIT } from "@/types/roster";

/**
 * Server-only client for the Kingshot Stats API.
 *
 * Documented contract (https://api.kingshotstats.com):
 *   GET /v1/alliances/{kid}/{tag}?include=info,roster
 *   Auth: `Authorization: Bearer kss_…` or `X-Api-Key`
 *   Alliance: aid, name, abbr, kid, power, count, leader_name, leader_uid,
 *             leader_governor_id, flag_url, power_rank
 *   Members:  uid, governor_id, fid, nick_name, power, town_center_level, kills,
 *             alliance_rank, alliance_rank_label, kid, avatar_url,
 *             last_active_at, online
 *   Wrapper:  ok, include, fresh, cached_at, age_seconds
 *   Errors:   401 invalid key, 404 unknown alliance, 429 rate limited
 *
 * Responses may be up to 60 minutes old, so freshness metadata is surfaced to
 * the UI rather than presented as live game state. Every field is read
 * defensively: unexpected containers and alternative key spellings are handled
 * instead of assumed.
 */

const DEFAULT_BASE_URL = "https://api.kingshotstats.com/v1";
/** The API waits up to 90s for a fresh section before returning stored data. */
const REQUEST_TIMEOUT_MS = 100_000;
const MAX_ATTEMPTS = 3;

/**
 * Documented limits: 60 requests/minute and 5,000/day per key. Responses may be
 * up to 60 minutes old, so a short server-side cache costs no freshness while
 * protecting the per-minute budget. SYNC ROSTERS always bypasses it.
 */
const CACHE_TTL_MS = 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 55; // headroom under the documented 60/minute

export type KingshotErrorCode =
  | "missing_server_api_key"
  | "missing_kingdom"
  | "missing_tag"
  | "unauthorized"
  | "alliance_not_found"
  | "rate_limited"
  | "local_rate_limit"
  | "api_unavailable"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "empty_roster"
  | "kingdom_not_found"
  | "bad_request"
  | "unknown";

export class KingshotApiError extends Error {
  readonly status: number;
  readonly code: KingshotErrorCode;
  readonly retryAfterSeconds: number | null;
  /** Raw upstream error string, useful for logs and the health route. */
  readonly upstreamError: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      code: KingshotErrorCode;
      retryAfterSeconds?: number | null;
      upstreamError?: string | null;
    },
  ) {
    super(message);
    this.name = "KingshotApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.upstreamError = options.upstreamError ?? null;
  }
}

/** Sliding-window counter so we fail fast instead of burning the API quota. */
const requestTimestamps: number[] = [];

function reserveRateSlot(): void {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_MAX_REQUESTS) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - requestTimestamps[0])) / 1000);
    throw new KingshotApiError(
      `Too many Kingshot API requests from this server in the last minute (limit is 60/minute). Try again in ${retryAfter}s.`,
      { status: 429, code: "local_rate_limit", retryAfterSeconds: retryAfter },
    );
  }
  requestTimestamps.push(now);
}

function getApiKey(): string {
  const key = process.env.KINGSHOT_API_KEY?.trim();
  if (!key) {
    throw new KingshotApiError(
      "KINGSHOT_API_KEY is not configured on the server. Add it to .env.local, or import rosters from CSV instead.",
      { status: 500, code: "missing_server_api_key" },
    );
  }
  return key;
}

function getBaseUrl(): string {
  const base = process.env.KINGSHOT_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function isKingshotApiConfigured(): boolean {
  return Boolean(process.env.KINGSHOT_API_KEY?.trim());
}

function describeStatus(
  status: number,
  apiError: string | null,
  retryAfterSeconds: number | null,
): { message: string; code: KingshotErrorCode } {
  switch (status) {
    case 400:
      return {
        message: apiError
          ? `The Kingshot API rejected the request: ${apiError}`
          : "The Kingshot API rejected the request as invalid. Check the kingdom ID and alliance tag.",
        code: "bad_request",
      };
    case 401:
    case 403:
      return {
        message:
          "The Kingshot API rejected the API key. Check that KINGSHOT_API_KEY on the server is a valid, active key (it should start with kss_).",
        code: "unauthorized",
      };
    case 404:
      return {
        message:
          "Alliance not found. Check the kingdom ID and the alliance tag — tags are case-sensitive, and the same tag can exist in several kingdoms.",
        code: "alliance_not_found",
      };
    case 429:
      return {
        message: `Kingshot API rate limit reached (60 requests/minute, 5,000/day).${
          retryAfterSeconds ? ` Try again in ${retryAfterSeconds}s.` : " Try again shortly."
        }`,
        code: "rate_limited",
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        message: `The Kingshot API is temporarily unavailable (${status}). Roster data is unchanged — try syncing again in a few minutes.`,
        code: "api_unavailable",
      };
    default:
      return {
        message: apiError
          ? `Kingshot API error (${status}): ${apiError}`
          : `Unexpected Kingshot API error (${status}).`,
        code: "unknown",
      };
  }
}

async function requestJson(path: string, search: Record<string, string>): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(`${getBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);

  let lastError: KingshotApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    reserveRateSlot();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Api-Key": apiKey,
          Accept: "application/json",
          // Cloudflare challenges bare undici requests; a named UA is accepted.
          "User-Agent": "KingshotMergePlanner/1.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      lastError = new KingshotApiError(
        timedOut
          ? "The Kingshot API did not respond in time. It waits up to 90 seconds for fresh data — try again shortly."
          : "Could not reach the Kingshot API. Check the server's network connection.",
        { status: 504, code: timedOut ? "timeout" : "network_error" },
      );
      if (attempt < MAX_ATTEMPTS) {
        await delay(400 * attempt);
        continue;
      }
      throw lastError;
    }

    const text = await response.text();
    const payload = safeJsonParse(text);

    if (response.ok) {
      // The API signals failures in-band with { ok: false, error: "…" }.
      if (isRecord(payload) && payload.ok === false) {
        const apiError = toStringOrNull(payload.error);
        if (apiError === "missing_api_key" || apiError === "invalid_api_key") {
          throw new KingshotApiError(describeStatus(401, apiError, null).message, {
            status: 401,
            code: "unauthorized",
            upstreamError: apiError,
          });
        }
        throw new KingshotApiError(
          apiError
            ? `The Kingshot API reported a failure: ${apiError}`
            : "The Kingshot API reported a failure.",
          { status: 502, code: "api_unavailable", upstreamError: apiError },
        );
      }
      if (!isRecord(payload)) {
        throw new KingshotApiError(
          "The Kingshot API returned a response that was not a JSON object. The API may be down or behind a captive portal.",
          { status: 502, code: "malformed_response" },
        );
      }
      return payload;
    }

    const apiError = isRecord(payload) ? toStringOrNull(payload.error ?? payload.message) : null;
    const retryAfter = toPositiveInt(response.headers.get("retry-after"));
    // Cloudflare bot pages come back as HTML 403; that is not an invalid API key.
    if ((response.status === 401 || response.status === 403) && typeof payload === "string" && /just a moment|cloudflare/i.test(payload)) {
      throw new KingshotApiError(
        "The Kingshot API is behind a bot check that blocked this server. Try again in a moment.",
        { status: 503, code: "api_unavailable" },
      );
    }
    const described = describeStatus(response.status, apiError, retryAfter);
    const error = new KingshotApiError(described.message, {
      status: response.status,
      code: described.code,
      retryAfterSeconds: retryAfter,
      upstreamError: apiError,
    });

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw error;

    lastError = error;
    await delay(Math.min(retryAfter ? retryAfter * 1000 : 800 * attempt, 5_000));
  }

  throw lastError ?? new KingshotApiError("Kingshot API request failed.", {
    status: 502,
    code: "unknown",
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** ------------------------------------------------------------------
 *  Response shape discovery
 *  ------------------------------------------------------------------ */

const MEMBER_CONTAINER_PATHS = [
  ["members"],
  ["roster"],
  ["data", "members"],
  ["data", "roster"],
  ["alliance", "members"],
  ["alliance", "roster"],
  ["result", "members"],
  ["result", "roster"],
  ["roster", "members"],
  ["members", "items"],
  ["roster", "items"],
  ["data", "items"],
  ["data"],
];

const ALLIANCE_CONTAINER_PATHS = [
  ["alliance"],
  ["info"],
  ["data", "alliance"],
  ["data", "info"],
  ["result", "alliance"],
  ["alliance", "info"],
  ["data"],
];

function readPath(payload: unknown, path: string[]): unknown {
  let cursor: unknown = payload;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function looksLikeMember(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasName = pick(value, ["nick_name", "nickname", "name", "player_name", "username"]) !== undefined;
  const hasIdentity =
    pick(value, ["uid", "governor_id", "fid", "player_id", "id"]) !== undefined;
  const hasStat = pick(value, ["power", "alliance_rank", "rank", "kills"]) !== undefined;
  return (hasName || hasIdentity) && hasStat;
}

function findMemberArray(payload: unknown): unknown[] | null {
  for (const path of MEMBER_CONTAINER_PATHS) {
    const candidate = readPath(payload, path);
    if (Array.isArray(candidate) && (candidate.length === 0 || looksLikeMember(candidate[0]))) {
      return candidate;
    }
  }
  // Last resort: breadth-first scan for any array of member-looking records.
  const queue: unknown[] = [payload];
  let guard = 0;
  while (queue.length && guard < 200) {
    guard += 1;
    const current = queue.shift();
    if (Array.isArray(current)) {
      if (current.length > 0 && looksLikeMember(current[0])) return current;
      continue;
    }
    if (isRecord(current)) queue.push(...Object.values(current));
  }
  return null;
}

function findAllianceRecord(payload: unknown): Record<string, unknown> | null {
  for (const path of ALLIANCE_CONTAINER_PATHS) {
    const candidate = readPath(payload, path);
    if (isRecord(candidate) && pick(candidate, ["abbr", "tag", "aid", "name"]) !== undefined) {
      return candidate;
    }
  }
  if (isRecord(payload) && pick(payload, ["abbr", "tag", "aid"]) !== undefined) return payload;
  return null;
}

const KNOWN_MEMBER_KEYS = new Set([
  "uid",
  "governor_id",
  "fid",
  "nick_name",
  "name",
  "power",
  "town_center_level",
  "kills",
  "alliance_rank",
  "kid",
  "avatar_url",
  "last_active_at",
  "online",
]);

function extractMetadata(member: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(member)) {
    if (KNOWN_MEMBER_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (isRecord(value) || Array.isArray(value)) continue; // keep metadata flat and small
    metadata[key] = value;
  }
  return metadata;
}

/**
 * Builds a stable, namespaced player identity. `uid` and `governor_id` overlap
 * numerically per the API docs, so the namespace prevents cross-ID collisions.
 */
function resolveExternalId(member: Record<string, unknown>): string | null {
  const uid = toStringOrNull(pick(member, ["uid"]));
  if (uid) return `uid:${uid}`;

  const governorId = toStringOrNull(pick(member, ["governor_id", "governorId", "gov_id"]));
  if (governorId) return `gov:${governorId}`;

  const fid = toStringOrNull(pick(member, ["fid"]));
  if (fid) return `fid:${fid}`;

  const genericId = toStringOrNull(pick(member, ["player_id", "id"]));
  if (genericId) return `id:${genericId}`;

  return null;
}

export function normalizeMember(
  raw: unknown,
  fallbackKingdomId: string,
): { member: NormalizedMember | null; warning: string | null } {
  if (!isRecord(raw)) return { member: null, warning: "Skipped a roster entry that was not an object." };

  const name = toStringOrNull(pick(raw, ["nick_name", "nickname", "name", "player_name", "username"]));
  const externalId = resolveExternalId(raw);

  if (!externalId) {
    return {
      member: null,
      warning: `Skipped "${name ?? "unknown player"}": the API returned no stable player id.`,
    };
  }

  const metadata = extractMetadata(raw);
  const rawRank = toPositiveInt(pick(raw, ["alliance_rank", "rank", "position"]));
  if (rawRank !== null) metadata.source_alliance_rank = rawRank;
  const rankLabel = toStringOrNull(pick(raw, ["alliance_rank_label", "rank_label", "role"]));
  if (rankLabel) metadata.alliance_rank_label = rankLabel;

  return {
    member: {
      externalId,
      name: name ?? `Unknown ${externalId}`,
      power: toNonNegativeInt(pick(raw, ["power", "player_power", "total_power"])),
      allianceRank: rawRank,
      allianceRankLabel: rankLabel,
      kingdomId: toStringOrNull(pick(raw, ["kid", "kingdom_id", "kingdom"])) ?? fallbackKingdomId,
      townCenterLevel: toPositiveInt(pick(raw, ["town_center_level", "tc_level", "tc"])),
      kills: toNumber(pick(raw, ["kills"])),
      online: toBooleanOrNull(pick(raw, ["online"])),
      lastActiveAt: toIsoOrNull(pick(raw, ["last_active_at", "last_active", "last_login"])),
      avatarUrl: toStringOrNull(pick(raw, ["avatar_url", "avatar"])),
      metadata,
    },
    warning: name ? null : `Player ${externalId} has no name in the API response.`,
  };
}

/**
 * The roster must render as positions #1..#N. Some Kingshot payloads return
 * `alliance_rank` as an in-alliance role (R1–R5) rather than a position, which
 * would collapse the ordering, so positional ranks are detected and otherwise
 * derived from power (descending) with ties broken by name.
 */
function applyPositionalRanks(members: NormalizedMember[], warnings: string[]): void {
  if (members.length === 0) return;

  const ranks = members
    .map((member) => member.allianceRank)
    .filter((rank): rank is number => rank !== null);

  const distinct = new Set(ranks);
  const isPositional =
    ranks.length === members.length &&
    distinct.size === members.length &&
    Math.max(...ranks) <= members.length * 2;

  if (isPositional) return;

  if (ranks.length > 0) {
    for (const member of members) {
      const role = member.allianceRank;
      if (role !== null && role >= 1 && role <= 5) {
        const label =
          member.allianceRankLabel && /^R[1-5]$/i.test(member.allianceRankLabel)
            ? member.allianceRankLabel.toUpperCase()
            : `R${role}`;
        member.allianceRankLabel = label;
        member.metadata.alliance_rank_label = label;
      }
    }
    warnings.push(
      "The API's alliance_rank values are not unique positions (they look like alliance roles), so roster positions were derived from power. The original value is kept in player metadata.",
    );
  }

  const ordered = [...members].sort(
    (a, b) => b.power - a.power || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  ordered.forEach((member, index) => {
    member.allianceRank = index + 1;
  });
}

function normalizeAllianceInfo(
  payload: unknown,
  kingdomId: string,
  allianceTag: string,
): NormalizedAllianceInfo {
  const record = findAllianceRecord(payload) ?? {};
  return {
    externalAllianceId: toStringOrNull(pick(record, ["aid", "alliance_id", "id"])),
    name: toStringOrNull(pick(record, ["name", "alliance_name"])) ?? allianceTag,
    tag: toStringOrNull(pick(record, ["abbr", "tag", "alliance_tag"])) ?? allianceTag,
    kingdomId: toStringOrNull(pick(record, ["kid", "kingdom_id"])) ?? kingdomId,
    power: toNumber(pick(record, ["power", "alliance_power", "total_power"])),
    memberCount: toPositiveInt(pick(record, ["count", "member_count", "members_count"])),
    leaderName: toStringOrNull(pick(record, ["leader_name", "leader"])),
    flagUrl: toStringOrNull(pick(record, ["flag_url", "flag"])),
    powerRank: toPositiveInt(pick(record, ["power_rank", "rank"])),
  };
}

function normalizeRoster(
  payload: unknown,
  kingdomId: string,
  allianceTag: string,
): NormalizedRoster {
  const warnings: string[] = [];
  const info = normalizeAllianceInfo(payload, kingdomId, allianceTag);

  const rawMembers = findMemberArray(payload);
  if (rawMembers === null) {
    warnings.push(
      "Could not find a roster array in the Kingshot API response. Verify the response shape with `npm run kingshot:inspect`.",
    );
  }
  if (isRecord(payload) && !("alliance" in payload) && !("info" in payload)) {
    warnings.push(
      "The response contained no alliance info block; alliance name and power fall back to the requested tag.",
    );
  }

  const members: NormalizedMember[] = [];
  const seen = new Set<string>();

  for (const raw of rawMembers ?? []) {
    const { member, warning } = normalizeMember(raw, info.kingdomId);
    if (warning) warnings.push(warning);
    if (!member) continue;
    if (seen.has(member.externalId)) {
      warnings.push(`Duplicate player id ${member.externalId} in the API response; kept the first.`);
      continue;
    }
    seen.add(member.externalId);
    members.push(member);
  }

  applyPositionalRanks(members, warnings);

  const wrapper = isRecord(payload) ? payload : {};
  const cachedAt = toIsoOrNull(pick(wrapper, ["cached_at", "cachedAt", "updated_at"]));
  const ageSeconds = toNumber(pick(wrapper, ["age_seconds", "ageSeconds"]));

  if (ageSeconds !== null && ageSeconds > 3600) {
    warnings.push(
      `The Kingshot API served data that is ${Math.round(ageSeconds / 60)} minutes old (its documented ceiling is 60 minutes).`,
    );
  }

  return {
    info,
    members,
    fresh: toBooleanOrNull(pick(wrapper, ["fresh"])),
    cachedAt,
    ageSeconds,
    retrievedAt: new Date().toISOString(),
    fromCache: false,
    memberArrayFound: rawMembers !== null,
    warnings,
  };
}

/** ------------------------------------------------------------------
 *  Fetching (short-lived cache + single-flight)
 *  ------------------------------------------------------------------ */

const rosterCache = new Map<string, { roster: NormalizedRoster; fetchedAt: number }>();
const inFlight = new Map<string, Promise<NormalizedRoster>>();

function cacheKey(kingdomId: string, allianceTag: string): string {
  // Tags are case-sensitive upstream, so the key must be too.
  return `${kingdomId}/${allianceTag}`;
}

export interface RosterFetchOptions {
  /**
   * Skip this server's cache and ask the API for the freshest data it allows.
   * SYNC ROSTERS uses this; passive previews do not.
   */
  force?: boolean;
}

/**
 * Fetches and normalizes one alliance roster. Server-side only.
 *
 * Throws KingshotApiError for invalid kingdom/tag, unauthorized keys, rate
 * limits, upstream outages, malformed payloads and empty rosters.
 */
export async function getAllianceRoster(
  kingdomId: string,
  allianceTag: string,
  options: RosterFetchOptions = {},
): Promise<NormalizedRoster> {
  const kingdom = kingdomId.trim();
  const tag = allianceTag.trim();

  if (!kingdom) {
    throw new KingshotApiError("Kingdom ID is required.", { status: 400, code: "missing_kingdom" });
  }
  if (!/^\d+$/.test(kingdom)) {
    throw new KingshotApiError(
      `"${kingdom}" is not a valid kingdom ID. Kingdom IDs are numeric, for example 1234.`,
      { status: 400, code: "missing_kingdom" },
    );
  }
  if (!tag) {
    throw new KingshotApiError("Alliance tag is required.", { status: 400, code: "missing_tag" });
  }

  const key = cacheKey(kingdom, tag);

  if (!options.force) {
    const cached = rosterCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.roster, fromCache: true };
    }
    // Coalesce concurrent requests for the same alliance, as the API itself does.
    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const payload = await requestJson(
      `/alliances/${encodeURIComponent(kingdom)}/${encodeURIComponent(tag)}`,
      { include: "info,roster" },
    );

    const roster = normalizeRoster(payload, kingdom, tag);

    if (!roster.memberArrayFound) {
      throw new KingshotApiError(
        `The Kingshot API response for [${tag}] contained no roster array. The API shape may have changed — run "npm run kingshot:inspect ${kingdom} ${tag}" to inspect it.`,
        { status: 502, code: "malformed_response" },
      );
    }

    if (roster.members.length === 0) {
      throw new KingshotApiError(
        `The Kingshot API returned an empty roster for [${tag}] in kingdom ${kingdom}. Check the tag (they are case-sensitive) or try again once the API has data for this alliance.`,
        { status: 404, code: "empty_roster" },
      );
    }

    rosterCache.set(key, { roster, fetchedAt: Date.now() });
    return roster;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops cached rosters (used before a forced sync of a whole session). */
export function invalidateRosterCache(entries?: { kingdomId: string; allianceTag: string }[]): void {
  if (!entries) {
    rosterCache.clear();
    return;
  }
  for (const entry of entries) {
    rosterCache.delete(cacheKey(entry.kingdomId.trim(), entry.allianceTag.trim()));
  }
}

const ranksCache = new Map<string, { ranking: KingdomAllianceRanking; fetchedAt: number }>();
const ranksInFlight = new Map<string, Promise<KingdomAllianceRanking>>();

function looksLikeAllianceRank(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasTag = pick(value, ["abbr", "tag", "alliance_tag"]) !== undefined;
  const hasName = pick(value, ["name", "alliance_name"]) !== undefined;
  const hasScore = pick(value, ["score", "power", "alliance_power"]) !== undefined;
  return hasTag || (hasName && hasScore);
}

function findAllianceRankRows(payload: unknown): unknown[] | null {
  if (!isRecord(payload)) return null;

  const board = isRecord(payload.board) ? payload.board : null;
  if (board && Array.isArray(board.rows) && (board.rows.length === 0 || looksLikeAllianceRank(board.rows[0]))) {
    return board.rows;
  }

  const boards = Array.isArray(payload.boards) ? payload.boards : [];
  const powerBoard = boards.find(
    (item) =>
      isRecord(item) &&
      Array.isArray(item.rows) &&
      (toStringOrNull(item.key) === "alliance_power" || toStringOrNull(item.board) === "alliance_power"),
  );
  if (isRecord(powerBoard) && Array.isArray(powerBoard.rows)) return powerBoard.rows;

  for (const candidate of [payload.rows, payload.ranks, payload.entries, payload.items, payload.data]) {
    if (Array.isArray(candidate) && (candidate.length === 0 || looksLikeAllianceRank(candidate[0]))) {
      return candidate;
    }
  }
  return null;
}

function normalizeAllianceRank(raw: unknown, fallbackKingdomId: string, index: number): KingdomAllianceRank | null {
  if (!isRecord(raw)) return null;
  const tag = toStringOrNull(pick(raw, ["abbr", "tag", "alliance_tag"]));
  const name = toStringOrNull(pick(raw, ["name", "alliance_name"])) ?? tag;
  const power = toNumber(pick(raw, ["score", "power", "alliance_power"]));
  if (!tag || power === null) return null;

  const rank = toPositiveInt(pick(raw, ["rank", "power_rank", "position"])) ?? index + 1;
  const kingdomId =
    toStringOrNull(pick(raw, ["kid", "kingdom_id", "kingdom"])) ?? fallbackKingdomId;

  return {
    rank,
    tag,
    name: name ?? tag,
    power,
    memberCount: toNonNegativeInt(pick(raw, ["member_count", "count", "members"])),
    leaderName: toStringOrNull(pick(raw, ["leader_name", "leader"])),
    flagUrl: toStringOrNull(pick(raw, ["flag_url", "flag"])),
    externalAllianceId: toStringOrNull(pick(raw, ["aid", "alliance_id", "id"])),
    kingdomId,
  };
}

export interface RankFetchOptions {
  force?: boolean;
  limit?: number;
}

/**
 * Top alliances in a kingdom by alliance power.
 *
 * Documented contract:
 *   GET /v1/kingdoms/{kid}/ranks?board=alliance_power&limit=10
 *   Alliance rows: aid, abbr, name, score, plus rank, kid, leader_name, member_count, flag_url
 */
export async function getKingdomAllianceRanks(
  kingdomId: string = HOME_KINGDOM_ID,
  options: RankFetchOptions = {},
): Promise<KingdomAllianceRanking> {
  const kingdom = kingdomId.trim() || HOME_KINGDOM_ID;
  const limit = Math.min(Math.max(options.limit ?? TOP_ALLIANCE_LIMIT, 1), 100);
  const key = `${kingdom}/alliance_power/${limit}`;

  if (!options.force) {
    const cached = ranksCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.ranking, fromCache: true };
    }
    const pending = ranksInFlight.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    let payload: unknown;
    try {
      payload = await requestJson(`/kingdoms/${encodeURIComponent(kingdom)}/ranks`, {
        board: "alliance_power",
        limit: String(limit),
      });
    } catch (error) {
      if (error instanceof KingshotApiError && error.code === "alliance_not_found") {
        throw new KingshotApiError(
          `Kingdom ${kingdom} was not found on the Kingshot Stats API.`,
          { status: 404, code: "kingdom_not_found" },
        );
      }
      throw error;
    }

    const rows = findAllianceRankRows(payload);
    if (!rows) {
      throw new KingshotApiError(
        `The Kingshot API response for kingdom ${kingdom} contained no alliance ranking rows.`,
        { status: 502, code: "malformed_response" },
      );
    }

    const alliances = rows
      .map((row, index) => normalizeAllianceRank(row, kingdom, index))
      .filter((row): row is KingdomAllianceRank => row !== null)
      .sort((a, b) => a.rank - b.rank || b.power - a.power)
      .slice(0, limit)
      .map((row, index) => ({ ...row, rank: row.rank || index + 1 }));

    if (alliances.length === 0) {
      throw new KingshotApiError(
        `The Kingshot API returned no alliances for kingdom ${kingdom}.`,
        { status: 404, code: "empty_roster" },
      );
    }

    const board = isRecord(payload) && isRecord(payload.board) ? payload.board : null;
    const capturedRaw = board ? pick(board, ["captured_at", "cached_at"]) : null;
    const capturedAt =
      typeof capturedRaw === "number"
        ? new Date(capturedRaw * (capturedRaw < 10_000_000_000 ? 1000 : 1)).toISOString()
        : toIsoOrNull(capturedRaw);

    const ranking: KingdomAllianceRanking = {
      kingdomId: kingdom,
      alliances,
      retrievedAt: new Date().toISOString(),
      fromCache: false,
      capturedAt,
    };
    ranksCache.set(key, { ranking, fetchedAt: Date.now() });
    return ranking;
  })();

  ranksInFlight.set(key, request);
  try {
    return await request;
  } finally {
    ranksInFlight.delete(key);
  }
}

/**
 * Structural report used by /api/kingshot/health so the live response shape can
 * be verified without ever echoing the API key or full player data.
 */
export async function inspectAllianceResponse(kingdomId: string, allianceTag: string) {
  const payload = await requestJson(
    `/alliances/${encodeURIComponent(kingdomId.trim())}/${encodeURIComponent(allianceTag.trim())}`,
    { include: "info,roster" },
  );

  const memberArray = findMemberArray(payload);
  const allianceRecord = findAllianceRecord(payload);
  const normalized = normalizeRoster(payload, kingdomId.trim(), allianceTag.trim());

  return {
    topLevelKeys: isRecord(payload) ? Object.keys(payload) : [],
    allianceKeys: allianceRecord ? Object.keys(allianceRecord) : [],
    memberArrayFound: memberArray !== null,
    memberCount: memberArray?.length ?? 0,
    memberKeys: memberArray && isRecord(memberArray[0]) ? Object.keys(memberArray[0]) : [],
    freshness: {
      fresh: normalized.fresh,
      cachedAt: normalized.cachedAt,
      ageSeconds: normalized.ageSeconds,
      retrievedAt: normalized.retrievedAt,
    },
    normalizedSample: normalized.members.slice(0, 3),
    warnings: normalized.warnings,
  };
}
