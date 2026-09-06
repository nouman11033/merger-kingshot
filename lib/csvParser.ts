import Papa from "papaparse";

import { normalizeKey, toNonNegativeInt, toNumber, toPositiveInt, toStringOrNull } from "@/lib/coerce";
import type { CsvColumnMapping, CsvParseResult, NormalizedMember } from "@/types/roster";

/**
 * CSV fallback importer. Column names are detected rather than hardcoded, and
 * the output is the same NormalizedMember shape the API client produces, so
 * both paths write identical rows to the database.
 */

const NAME_CANDIDATES = [
  "name",
  "player name",
  "player",
  "username",
  "nick name",
  "nickname",
  "nick_name",
  "governor",
  "governor name",
  "lord",
  "lord name",
  "ign",
];

const POWER_CANDIDATES = [
  "power",
  "player power",
  "total power",
  "combat power",
  "might",
  "score",
  "cp",
];

const RANK_CANDIDATES = [
  "rank",
  "alliance rank",
  "position",
  "no",
  "#",
  "index",
];

const ID_CANDIDATES = [
  "id",
  "player id",
  "uid",
  "governor id",
  "governor_id",
  "fid",
  "lord id",
];

const HQ_CANDIDATES = [
  "hq",
  "hq level",
  "tc",
  "tc level",
  "town center",
  "town center level",
  "furnace",
  "furnace level",
];

const KILLS_CANDIDATES = ["kills", "kill count", "killpoints", "kill points", "kp"];

function detectColumn(headers: string[], candidates: string[]): string | null {
  const normalizedHeaders = headers.map((header) => ({ header, key: normalizeKey(header) }));

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const exact = normalizedHeaders.find((entry) => entry.key === target);
    if (exact) return exact.header;
  }
  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    if (target.length < 3) continue;
    const partial = normalizedHeaders.find(
      (entry) => entry.key.includes(target) || target.includes(entry.key),
    );
    if (partial) return partial.header;
  }
  return null;
}

export function detectMapping(headers: string[]): CsvColumnMapping {
  return {
    name: detectColumn(headers, NAME_CANDIDATES),
    power: detectColumn(headers, POWER_CANDIDATES),
    rank: detectColumn(headers, RANK_CANDIDATES),
    id: detectColumn(headers, ID_CANDIDATES),
    hq: detectColumn(headers, HQ_CANDIDATES),
    kills: detectColumn(headers, KILLS_CANDIDATES),
  };
}

function stableIdFor(name: string, index: number, explicitId: string | null): string {
  if (explicitId) {
    if (/^(uid|gov|fid|csv|id):/i.test(explicitId)) return explicitId;
    // Numeric game IDs match the Kingshot Stats identity namespace, so a later
    // API sync can keep Prime ticks instead of treating everyone as new.
    if (/^\d+$/.test(explicitId)) return `uid:${explicitId}`;
    return `csv:${explicitId}`;
  }
  // Without a source id, identity falls back to a name slug. Re-importing after
  // a rename creates a new player row.
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `csv:${slug || "row"}-${index + 1}`;
}

export function rowsToMembers(
  rows: Record<string, unknown>[],
  mapping: CsvColumnMapping,
  kingdomId: string,
): { members: NormalizedMember[]; skipped: number } {
  const members: NormalizedMember[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  rows.forEach((row, index) => {
    const name = mapping.name ? toStringOrNull(row[mapping.name]) : null;
    if (!name) {
      skipped += 1;
      return;
    }

    const explicitId = mapping.id ? toStringOrNull(row[mapping.id]) : null;
    let externalId = stableIdFor(name, index, explicitId);
    if (seen.has(externalId)) externalId = `${externalId}-${index + 1}`;
    seen.add(externalId);

    const mappedHeaders = new Set(
      [mapping.name, mapping.power, mapping.rank, mapping.id, mapping.hq, mapping.kills].filter(
        (header): header is string => Boolean(header),
      ),
    );
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (mappedHeaders.has(key)) continue;
      const text = toStringOrNull(value);
      if (text) metadata[key] = text;
    }

    members.push({
      externalId,
      name,
      power: mapping.power ? toNonNegativeInt(row[mapping.power]) : 0,
      allianceRank: mapping.rank ? toPositiveInt(row[mapping.rank]) : null,
      allianceRankLabel: null,
      kingdomId,
      townCenterLevel: mapping.hq ? toPositiveInt(row[mapping.hq]) : null,
      kills: mapping.kills ? toNumber(row[mapping.kills]) : null,
      online: null,
      lastActiveAt: null,
      avatarUrl: null,
      metadata,
    });
  });

  // Guarantee unique ascending positions so the roster renders #1..#N.
  const ranks = members.map((member) => member.allianceRank);
  const provided = ranks.filter((rank): rank is number => rank !== null);
  const usable = provided.length === members.length && new Set(provided).size === members.length;

  if (!usable) {
    [...members]
      .sort(
        (a, b) => b.power - a.power || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      )
      .forEach((member, index) => {
        member.allianceRank = index + 1;
      });
  }

  return { members, skipped };
}

export function parseCsvFile(file: File, kingdomId: string): Promise<CsvParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        const headers = (results.meta.fields ?? []).filter(Boolean);
        const mapping = detectMapping(headers);
        const errors: string[] = [];

        if (headers.length === 0) errors.push("No header row was found in this file.");
        if (!mapping.name) {
          errors.push(
            "No player-name column detected. Expected a header like Name, Player Name, Player or Username.",
          );
        }
        if (!mapping.power) {
          errors.push(
            "No power column detected. Expected a header like Power, Player Power or Total Power.",
          );
        }
        for (const error of results.errors.slice(0, 3)) {
          errors.push(`Row ${error.row ?? "?"}: ${error.message}`);
        }

        const { members, skipped } = rowsToMembers(results.data ?? [], mapping, kingdomId);
        if (members.length === 0 && !errors.length) errors.push("No usable rows were found.");

        resolve({
          fileName: file.name,
          headers,
          mapping,
          rows: members,
          previewRows: members.slice(0, 8),
          skippedRows: skipped,
          errors,
        });
      },
      error: (error) => {
        resolve({
          fileName: file.name,
          headers: [],
          mapping: { name: null, power: null, rank: null, id: null, hq: null, kills: null },
          rows: [],
          previewRows: [],
          skippedRows: 0,
          errors: [error.message],
        });
      },
    });
  });
}
