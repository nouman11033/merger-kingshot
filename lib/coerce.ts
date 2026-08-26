/** Shape-agnostic value readers. Shared by the API normalizer and CSV importer. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the first present key from a record, ignoring case and separators. */
export function pick(source: Record<string, unknown>, keys: string[]): unknown {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    normalized.set(normalizeKey(key), value);
  }
  for (const key of keys) {
    const value = normalized.get(normalizeKey(key));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parses a power-like value. Accepts numbers, "1,234,567", "31.4M", "2.4b",
 * "950k" and returns a whole number of power points.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  const match = /^([+-]?[\d.,\s]+)\s*([kmbt])?$/i.exec(raw);
  if (!match) return null;

  const digits = match[1].replace(/[,\s]/g, "");
  const parsed = Number.parseFloat(digits);
  if (!Number.isFinite(parsed)) return null;

  const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix ? multipliers[suffix] : 1;
  return Math.round(parsed * multiplier);
}

export function toPositiveInt(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

export function toNonNegativeInt(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed === null || parsed < 0) return 0;
  return Math.round(parsed);
}

export function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

export function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "online"].includes(raw)) return true;
    if (["false", "0", "no", "n", "offline"].includes(raw)) return false;
  }
  return null;
}

/** Normalizes epoch seconds / epoch millis / ISO strings to an ISO timestamp. */
export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" || (typeof value === "string" && /^\d{9,14}$/.test(value.trim()))) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
