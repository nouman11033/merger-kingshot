import "server-only";

import { getAllianceRoster, invalidateRosterCache } from "@/lib/kingshot";
import { mapAlliance, mapPlayer, mapSession } from "@/lib/mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ALLIANCES_TABLE,
  PLAYERS_TABLE,
  SELECTIONS_TABLE,
  SESSIONS_TABLE,
  type AllianceRow,
  type MergeSessionRow,
  type PlayerRow,
  type SelectionRow,
} from "@/types/database";
import type {
  Alliance,
  AllianceInput,
  AllianceSlot,
  CsvImportPayload,
  MergeSession,
  MergeSessionSummary,
  MergeSize,
  MergeSnapshot,
  NormalizedMember,
  NormalizedRoster,
  SyncReport,
} from "@/types/roster";
import { PRIME_LIMIT } from "@/types/roster";

/** Server-side persistence for merge sessions, rosters and selections. */

export class AppError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

function fail(context: string, error: { message: string } | null): never {
  throw new AppError(`${context}: ${error?.message ?? "unknown database error"}`, 500);
}

export function validateAllianceInputs(mergeSize: MergeSize, inputs: AllianceInput[]): AllianceInput[] {
  if (inputs.length !== mergeSize) {
    throw new AppError(`A ${mergeSize}-alliance merge needs exactly ${mergeSize} alliances.`);
  }

  const seen = new Set<string>();
  const cleaned = inputs.map((input, index) => {
    const kingdomId = String(input.kingdomId ?? "").trim();
    const allianceTag = String(input.allianceTag ?? "").trim();
    const slotNumber = (input.slotNumber ?? index + 1) as AllianceSlot;

    if (!kingdomId) throw new AppError(`Alliance ${slotNumber}: kingdom ID is required.`);
    if (!/^\d+$/.test(kingdomId)) {
      throw new AppError(`Alliance ${slotNumber}: kingdom ID must be numeric (for example 1234).`);
    }
    if (!allianceTag) throw new AppError(`Alliance ${slotNumber}: alliance tag is required.`);

    // Tags are case-sensitive in the API, so only exact pairs are duplicates.
    const key = `${kingdomId}::${allianceTag}`;
    if (seen.has(key)) {
      throw new AppError(`Alliance [${allianceTag}] in kingdom ${kingdomId} was entered twice.`);
    }
    seen.add(key);

    return { slotNumber, kingdomId, allianceTag };
  });

  return cleaned.sort((a, b) => a.slotNumber - b.slotNumber);
}

export async function listSessions(): Promise<MergeSessionSummary[]> {
  const supabase = getSupabaseAdmin();

  const { data: sessionRows, error: sessionError } = await supabase
    .from(SESSIONS_TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (sessionError) fail("Could not load merge sessions", sessionError);

  const sessions = (sessionRows ?? []) as MergeSessionRow[];
  if (sessions.length === 0) return [];

  const ids = sessions.map((session) => session.id);

  const [alliancesResult, playersResult, selectionsResult] = await Promise.all([
    supabase
      .from(ALLIANCES_TABLE)
      .select("id, merge_session_id, slot_number, kingdom_id, alliance_tag, alliance_name")
      .in("merge_session_id", ids),
    supabase.from(PLAYERS_TABLE).select("id, merge_session_id").in("merge_session_id", ids).eq("active", true),
    supabase.from(SELECTIONS_TABLE).select("merge_session_id, player_id").in("merge_session_id", ids).eq("selected", true),
  ]);

  if (alliancesResult.error) fail("Could not load alliances", alliancesResult.error);
  if (playersResult.error) fail("Could not load players", playersResult.error);
  if (selectionsResult.error) fail("Could not load selections", selectionsResult.error);

  const activePlayerIds = new Set((playersResult.data ?? []).map((row) => row.id as string));

  return sessions.map((row) => {
    const session = mapSession(row);
    return {
      ...session,
      alliances: (alliancesResult.data ?? [])
        .filter((alliance) => alliance.merge_session_id === row.id)
        .sort((a, b) => (a.slot_number as number) - (b.slot_number as number))
        .map((alliance) => ({
          slotNumber: alliance.slot_number as AllianceSlot,
          allianceTag: alliance.alliance_tag as string,
          kingdomId: alliance.kingdom_id as string,
          allianceName: (alliance.alliance_name as string) || (alliance.alliance_tag as string),
        })),
      playerCount: (playersResult.data ?? []).filter((player) => player.merge_session_id === row.id).length,
      selectedCount: (selectionsResult.data ?? []).filter(
        (selection) =>
          selection.merge_session_id === row.id && activePlayerIds.has(selection.player_id as string),
      ).length,
    };
  });
}

export async function getSession(sessionId: string): Promise<MergeSession | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(SESSIONS_TABLE).select("*").eq("id", sessionId).maybeSingle();
  if (error) fail("Could not load the merge session", error);
  return data ? mapSession(data as MergeSessionRow) : null;
}

export async function getSnapshot(sessionId: string): Promise<MergeSnapshot | null> {
  const supabase = getSupabaseAdmin();

  const session = await getSession(sessionId);
  if (!session) return null;

  const [alliancesResult, playersResult, selectionsResult] = await Promise.all([
    supabase.from(ALLIANCES_TABLE).select("*").eq("merge_session_id", sessionId).order("slot_number"),
    supabase
      .from(PLAYERS_TABLE)
      .select("*")
      .eq("merge_session_id", sessionId)
      .eq("active", true)
      .order("alliance_rank", { ascending: true, nullsFirst: false }),
    supabase.from(SELECTIONS_TABLE).select("*").eq("merge_session_id", sessionId).eq("selected", true),
  ]);

  if (alliancesResult.error) fail("Could not load alliances", alliancesResult.error);
  if (playersResult.error) fail("Could not load players", playersResult.error);
  if (selectionsResult.error) fail("Could not load selections", selectionsResult.error);

  const alliances = ((alliancesResult.data ?? []) as AllianceRow[]).map(mapAlliance);
  const allianceById = new Map<string, Alliance>(alliances.map((alliance) => [alliance.id, alliance]));
  const selectedIds = new Set(((selectionsResult.data ?? []) as SelectionRow[]).map((row) => row.player_id));

  const players = ((playersResult.data ?? []) as PlayerRow[]).map((row) =>
    mapPlayer(row, allianceById.get(row.alliance_id), selectedIds.has(row.id)),
  );

  return { session, alliances, players };
}

export async function createSession(input: {
  name?: string;
  mergeSize: MergeSize;
  alliances: AllianceInput[];
  source?: "api" | "csv";
}): Promise<{ session: MergeSession; reports: SyncReport[] }> {
  const supabase = getSupabaseAdmin();
  const source = input.source ?? "api";
  const alliances = validateAllianceInputs(input.mergeSize, input.alliances);

  const fallbackName = `Kingdom ${alliances[0].kingdomId} Merge (${alliances
    .map((alliance) => alliance.allianceTag)
    .join(" + ")})`;
  const name = (input.name ?? "").trim() || fallbackName;

  const { data: sessionRow, error: sessionError } = await supabase
    .from(SESSIONS_TABLE)
    .insert({ name: name.slice(0, 120), merge_size: input.mergeSize, prime_limit: PRIME_LIMIT })
    .select("*")
    .single();
  if (sessionError || !sessionRow) fail("Could not create the merge session", sessionError);

  const session = mapSession(sessionRow as MergeSessionRow);

  const { error: allianceError } = await supabase.from(ALLIANCES_TABLE).insert(
    alliances.map((alliance) => ({
      merge_session_id: session.id,
      slot_number: alliance.slotNumber,
      kingdom_id: alliance.kingdomId,
      alliance_tag: alliance.allianceTag,
      alliance_name: alliance.allianceTag,
      source,
    })),
  );
  if (allianceError) {
    await supabase.from(SESSIONS_TABLE).delete().eq("id", session.id);
    fail("Could not create the alliance slots", allianceError);
  }

  if (source === "csv") {
    return { session, reports: [] };
  }

  try {
    const reports = await syncSession(session.id);
    return { session, reports };
  } catch (error) {
    // Never leave a half-created session behind.
    await supabase.from(SESSIONS_TABLE).delete().eq("id", session.id);
    throw error;
  }
}

async function loadAlliances(sessionId: string): Promise<AllianceRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(ALLIANCES_TABLE)
    .select("*")
    .eq("merge_session_id", sessionId)
    .order("slot_number");
  if (error) fail("Could not load alliances", error);
  return (data ?? []) as AllianceRow[];
}

/**
 * Writes one alliance roster into the database:
 *   - upserts players on (alliance_id, external_id) so ids — and therefore
 *     Prime selections — survive renames, power changes and rank changes
 *   - deactivates players who are no longer on the roster; a database trigger
 *     releases their Prime slot so a returning player never silently re-enters
 *     Prime (and can never push it past the limit)
 *   - never selects new or returning players automatically
 */
async function persistRoster(
  alliance: AllianceRow,
  members: NormalizedMember[],
): Promise<{ added: number; updated: number; deactivated: number; reactivated: number }> {
  const supabase = getSupabaseAdmin();
  const syncedAt = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from(PLAYERS_TABLE)
    .select("id, external_id, active")
    .eq("alliance_id", alliance.id);
  if (existingError) fail("Could not read the existing roster", existingError);

  const existing = new Map(
    (existingRows ?? []).map((row) => [row.external_id as string, row as { id: string; external_id: string; active: boolean }]),
  );

  const incomingIds = new Set(members.map((member) => member.externalId));
  let added = 0;
  let updated = 0;
  let reactivated = 0;

  const rows = members.map((member) => {
    const previous = existing.get(member.externalId);
    if (!previous) added += 1;
    else {
      updated += 1;
      if (!previous.active) reactivated += 1;
    }

    return {
      merge_session_id: alliance.merge_session_id,
      alliance_id: alliance.id,
      external_id: member.externalId,
      name: member.name,
      power: member.power,
      alliance_rank: member.allianceRank,
      kingdom_id: member.kingdomId ?? alliance.kingdom_id,
      town_center_level: member.townCenterLevel,
      kills: member.kills,
      online: member.online,
      last_active_at: member.lastActiveAt,
      avatar_url: member.avatarUrl,
      metadata: member.metadata,
      active: true,
      last_synced_at: syncedAt,
    };
  });

  for (const chunk of chunked(rows, 500)) {
    const { error } = await supabase
      .from(PLAYERS_TABLE)
      .upsert(chunk, { onConflict: "alliance_id,external_id" });
    if (error) fail("Could not save roster players", error);
  }

  const departedIds = [...existing.values()]
    .filter((row) => row.active && !incomingIds.has(row.external_id))
    .map((row) => row.id);

  if (departedIds.length > 0) {
    const { error } = await supabase
      .from(PLAYERS_TABLE)
      .update({ active: false, last_synced_at: syncedAt })
      .in("id", departedIds);
    if (error) fail("Could not deactivate departed players", error);
  }

  return { added, updated, deactivated: departedIds.length, reactivated };
}

async function updateAllianceMeta(
  alliance: AllianceRow,
  roster: NormalizedRoster | null,
  memberCount: number,
  source: "api" | "csv",
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(ALLIANCES_TABLE)
    .update({
      alliance_name: roster?.info.name || alliance.alliance_name || alliance.alliance_tag,
      external_alliance_id: roster?.info.externalAllianceId ?? alliance.external_alliance_id,
      power: roster?.info.power ?? null,
      member_count: roster?.info.memberCount ?? memberCount,
      leader_name: roster?.info.leaderName ?? null,
      flag_url: roster?.info.flagUrl ?? null,
      api_cached_at: roster?.cachedAt ?? null,
      last_synced_at: new Date().toISOString(),
      source,
    })
    .eq("id", alliance.id);
  if (error) fail("Could not update alliance information", error);
}

/** SYNC ROSTERS: re-fetches every API-backed alliance in the session. */
export async function syncSession(sessionId: string): Promise<SyncReport[]> {
  const alliances = await loadAlliances(sessionId);
  if (alliances.length === 0) throw new AppError("This merge session has no alliances configured.", 404);

  const apiAlliances = alliances.filter((alliance) => alliance.source !== "csv");
  if (apiAlliances.length === 0) {
    throw new AppError(
      "Every alliance in this session was imported from CSV. Re-import the CSV files to refresh them.",
      400,
    );
  }

  const reports: SyncReport[] = [];

  // A manual sync must get the freshest data the API allows, so the server-side
  // cache is dropped for these alliances first.
  invalidateRosterCache(
    apiAlliances.map((alliance) => ({
      kingdomId: alliance.kingdom_id,
      allianceTag: alliance.alliance_tag,
    })),
  );

  // Sequential on purpose: the API allows 60 requests/minute and we stay polite.
  for (const alliance of apiAlliances) {
    const roster = await getAllianceRoster(alliance.kingdom_id, alliance.alliance_tag, {
      force: true,
    });
    const counts = await persistRoster(alliance, roster.members);
    await updateAllianceMeta(alliance, roster, roster.members.length, "api");

    reports.push({
      slotNumber: alliance.slot_number as AllianceSlot,
      allianceTag: alliance.alliance_tag,
      kingdomId: alliance.kingdom_id,
      allianceName: roster.info.name,
      total: roster.members.length,
      fresh: roster.fresh,
      cachedAt: roster.cachedAt,
      ageSeconds: roster.ageSeconds,
      retrievedAt: roster.retrievedAt,
      warnings: roster.warnings,
      ...counts,
    });
  }

  return reports;
}

/** CSV fallback: writes an uploaded roster into the same tables as the API path. */
export async function importCsvRoster(
  sessionId: string,
  payload: CsvImportPayload,
): Promise<SyncReport> {
  const supabase = getSupabaseAdmin();

  if (!payload.members?.length) throw new AppError("The CSV import contained no players.");

  const session = await getSession(sessionId);
  if (!session) throw new AppError("Merge session not found.", 404);
  if (payload.slotNumber > session.mergeSize) {
    throw new AppError(
      `Alliance ${payload.slotNumber} does not exist in this ${session.mergeSize}-alliance merge.`,
    );
  }

  const alliances = await loadAlliances(sessionId);
  const alliance = alliances.find((row) => row.slot_number === payload.slotNumber);
  if (!alliance) throw new AppError(`Alliance slot ${payload.slotNumber} is not configured.`, 404);

  const kingdomId = payload.kingdomId?.trim() || alliance.kingdom_id;
  const allianceTag = payload.allianceTag?.trim() || alliance.alliance_tag;
  const allianceName = payload.allianceName?.trim() || allianceTag;

  const { error: metaError } = await supabase
    .from(ALLIANCES_TABLE)
    .update({
      kingdom_id: kingdomId,
      alliance_tag: allianceTag,
      alliance_name: allianceName,
      source: "csv",
    })
    .eq("id", alliance.id);
  if (metaError) fail("Could not update the alliance", metaError);

  // updateAllianceMeta below re-reads its name from this row, so it must carry
  // the imported name — otherwise the name the user typed is written straight
  // back to the old value.
  const target: AllianceRow = {
    ...alliance,
    kingdom_id: kingdomId,
    alliance_tag: allianceTag,
    alliance_name: allianceName,
    source: "csv",
  };

  const counts = await persistRoster(target, payload.members);
  await updateAllianceMeta(target, null, payload.members.length, "csv");

  return {
    slotNumber: payload.slotNumber,
    allianceTag,
    kingdomId,
    allianceName,
    total: payload.members.length,
    fresh: null,
    cachedAt: null,
    ageSeconds: null,
    retrievedAt: new Date().toISOString(),
    warnings: [],
    ...counts,
  };
}

/** Clears Prime for exactly one session. Other sessions are untouched. */
export async function clearSelections(sessionId: string): Promise<number> {
  const supabase = getSupabaseAdmin();

  const session = await getSession(sessionId);
  if (!session) throw new AppError("Merge session not found.", 404);

  const { data, error } = await supabase
    .from(SELECTIONS_TABLE)
    .update({ selected: false, updated_at: new Date().toISOString() })
    .eq("merge_session_id", sessionId)
    .eq("selected", true)
    .select("player_id");
  if (error) fail("Could not clear the Prime selection", error);

  return (data ?? []).length;
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
