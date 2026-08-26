import type {
  Alliance,
  AllianceStat,
  KingdomAllianceRank,
  Player,
  PrimeEntry,
  PrimeStats,
  RosterFilters,
} from "@/types/roster";

/** Pure derivation helpers. Prime is always computed, never stored. */

export const EMPTY_FILTERS: RosterFilters = {
  search: "",
  alliance: "all",
  selection: "all",
  minPower: null,
  maxPower: null,
};

function compareByName(a: Player, b: Player): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function rankValue(player: Player): number {
  return player.allianceRank ?? Number.MAX_SAFE_INTEGER;
}

const ROLE_PATTERN = /^r\s*([1-5])$/i;

/** In-alliance role (R5 leader … R1 member). Null when the source had no role. */
export function formatAllianceRole(player: Player): string | null {
  const candidates = [player.allianceRankLabel, player.metadata.alliance_rank_label];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const match = ROLE_PATTERN.exec(value.trim());
    if (match) return `R${match[1]}`;
  }
  const source = player.metadata.source_alliance_rank;
  if (typeof source === "number" && source >= 1 && source <= 5 && source !== player.allianceRank) {
    return `R${source}`;
  }
  return null;
}

export function formatAllianceRankDisplay(player: Player): string {
  return formatAllianceRole(player) ?? (player.allianceRank !== null ? `#${player.allianceRank}` : "—");
}

/** R5 leaders and R4 officers — the bulk-select target on the planner. */
export function isOfficerRole(player: Player): boolean {
  const role = formatAllianceRole(player);
  return role === "R4" || role === "R5";
}

export function officerPlayers(players: Player[], allianceId?: string): Player[] {
  return players.filter(
    (player) =>
      player.active &&
      isOfficerRole(player) &&
      (allianceId === undefined || player.allianceId === allianceId),
  );
}

/**
 * Kingdom alliances ranked strictly above the strongest alliance in this merge.
 * Falls back to every ranked alliance that is not ours when our tags are missing
 * from the board (CSV sessions, or a tag outside the fetched top 10).
 */
export function alliancesRankedAbove(
  ranking: KingdomAllianceRank[],
  ours: Pick<Alliance, "allianceTag">[],
): {
  above: KingdomAllianceRank[];
  ours: KingdomAllianceRank[];
  ourBest: KingdomAllianceRank | null;
} {
  const tags = new Set(ours.map((alliance) => alliance.allianceTag.trim().toUpperCase()));
  const oursOnBoard = ranking.filter((row) => tags.has(row.tag.trim().toUpperCase()));
  const ourBest = oursOnBoard.reduce<KingdomAllianceRank | null>(
    (best, row) => (best === null || row.rank < best.rank ? row : best),
    null,
  );
  const above = ourBest
    ? ranking.filter((row) => row.rank < ourBest.rank)
    : ranking.filter((row) => !tags.has(row.tag.trim().toUpperCase()));
  return { above, ours: oursOnBoard, ourBest };
}

/** Where Prime would sit if it were an alliance on this kingdom board. */
export function primeWouldRank(ranking: KingdomAllianceRank[], primePower: number): number {
  return ranking.filter((row) => row.power > primePower).length + 1;
}

/** Alliance rosters are always Alliance Rank ascending. */
export function sortByAllianceRank(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => rankValue(a) - rankValue(b) || b.power - a.power || compareByName(a, b),
  );
}

/** Prime is Power desc, then Alliance Rank asc, then Player Name asc. */
export function sortForPrime(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => b.power - a.power || rankValue(a) - rankValue(b) || compareByName(a, b),
  );
}

export function buildPrimeRoster(players: Player[]): PrimeEntry[] {
  const selected = players.filter((player) => player.selected && player.active);
  return sortForPrime(selected).map((player, index) => ({ primeRank: index + 1, player }));
}

export function computeStats(
  players: Player[],
  alliances: Alliance[],
  prime: PrimeEntry[],
  primeLimit: number,
): PrimeStats {
  const totalPower = prime.reduce((sum, entry) => sum + entry.player.power, 0);
  const primeCount = prime.length;

  const allianceStats: AllianceStat[] = alliances
    .slice()
    .sort((a, b) => a.slotNumber - b.slotNumber)
    .map((alliance) => {
      const members = players.filter((player) => player.allianceId === alliance.id && player.active);
      return {
        slotNumber: alliance.slotNumber,
        allianceTag: alliance.allianceTag,
        allianceName: alliance.allianceName,
        totalPlayers: members.length,
        selectedCount: members.filter((player) => player.selected).length,
      };
    });

  return {
    primeCount,
    primeLimit,
    remainingSlots: Math.max(primeLimit - primeCount, 0),
    totalPower,
    averagePower: primeCount > 0 ? Math.round(totalPower / primeCount) : 0,
    isFull: primeCount >= primeLimit,
    allianceStats,
  };
}

export function playersByAlliance(players: Player[]): Map<string, Player[]> {
  const grouped = new Map<string, Player[]>();
  for (const player of players) {
    if (!player.active) continue;
    const bucket = grouped.get(player.allianceId);
    if (bucket) bucket.push(player);
    else grouped.set(player.allianceId, [player]);
  }
  for (const [allianceId, bucket] of grouped) {
    grouped.set(allianceId, sortByAllianceRank(bucket));
  }
  return grouped;
}

export function matchesFilters(player: Player, filters: RosterFilters): boolean {
  if (filters.alliance !== "all" && player.allianceSlot !== filters.alliance) return false;
  if (filters.selection === "selected" && !player.selected) return false;
  if (filters.selection === "unselected" && player.selected) return false;
  if (filters.minPower !== null && player.power < filters.minPower) return false;
  if (filters.maxPower !== null && player.power > filters.maxPower) return false;

  const search = filters.search.trim().toLowerCase();
  if (search && !player.name.toLowerCase().includes(search)) return false;

  return true;
}

export function hasActiveFilters(filters: RosterFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.alliance !== "all" ||
    filters.selection !== "all" ||
    filters.minPower !== null ||
    filters.maxPower !== null
  );
}

/** ------------------------------------------------------------------
 *  Formatting
 *  ------------------------------------------------------------------ */

export function formatPower(power: number): string {
  if (!Number.isFinite(power)) return "0";
  const abs = Math.abs(power);
  if (abs >= 1e12) return `${trim(power / 1e12)}T`;
  if (abs >= 1e9) return `${trim(power / 1e9)}B`;
  if (abs >= 1e6) return `${trim(power / 1e6)}M`;
  if (abs >= 1e3) return `${trim(power / 1e3)}K`;
  return String(Math.round(power));
}

function trim(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatExactPower(power: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(power));
}

export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "unknown";

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Short last-active label for dense roster columns. */
export function formatCompactAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(hours / 24);
  return `${days}d`;
}

/** ------------------------------------------------------------------
 *  Export
 *  ------------------------------------------------------------------ */

const CSV_HEADERS = [
  "Prime Rank",
  "Player Name",
  "Power",
  "Original Alliance",
  "Original Alliance Tag",
  "Original Alliance Rank",
] as const;

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function primeToCsv(prime: PrimeEntry[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const { primeRank, player } of prime) {
    lines.push(
      [
        primeRank,
        csvCell(player.name),
        player.power,
        csvCell(player.allianceName || player.allianceTag),
        csvCell(player.allianceTag),
        formatAllianceRankDisplay(player),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

export function primeToClipboardText(prime: PrimeEntry[]): string {
  const lines = [CSV_HEADERS.join("\t")];
  for (const { primeRank, player } of prime) {
    lines.push(
      [
        `#${primeRank}`,
        player.name,
        formatExactPower(player.power),
        player.allianceName || player.allianceTag,
        player.allianceTag,
        formatAllianceRankDisplay(player),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "merge"
  );
}
