"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

import { CsvImporter } from "@/components/CsvImporter";
import { useToast } from "@/components/Toaster";
import { Alert, Badge, Button, Card, Field, Input, SLOT_THEME, SectionTitle, Spinner } from "@/components/ui";
import { formatPower, formatRelativeTime } from "@/lib/roster";
import {
  HOME_KINGDOM_ID,
  type AllianceSlot,
  type CsvImportPayload,
  type KingdomAllianceRank,
  type MergeSize,
} from "@/types/roster";

interface RosterPreview {
  slotNumber: AllianceSlot;
  kingdomId: string;
  allianceTag: string;
  allianceName: string;
  leaderName: string | null;
  alliancePower: number | null;
  memberCount: number;
  reportedMemberCount: number | null;
  totalPower: number;
  fresh: boolean | null;
  cachedAt: string | null;
  ageSeconds: number | null;
  retrievedAt: string | null;
  servedFromServerCache: boolean;
  warnings: string[];
  topMembers: { name: string; power: number; rank: number | null }[];
}

interface RequestFailure {
  message: string;
  code: string | null;
  retryAfterSeconds: number | null;
}

const ERROR_TITLES: Record<string, string> = {
  unauthorized: "Kingshot API key rejected",
  alliance_not_found: "Alliance not found",
  kingdom_not_found: "Kingdom not found",
  empty_roster: "Alliance roster is empty",
  rate_limited: "Kingshot API rate limit reached",
  local_rate_limit: "Too many requests from this server",
  api_unavailable: "Kingshot API unavailable",
  timeout: "Kingshot API timed out",
  network_error: "Cannot reach the Kingshot API",
  malformed_response: "Unexpected Kingshot API response",
  missing_server_api_key: "Kingshot API key not configured",
  missing_kingdom: "Invalid kingdom ID",
  missing_tag: "Invalid alliance tag",
  bad_request: "Request rejected by the Kingshot API",
};

class ApiRequestError extends Error {
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, code: string | null, retryAfterSeconds: number | null) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string; code?: string; retryAfterSeconds?: number | null })
    | null;

  if (!response.ok || !payload || payload.ok === false) {
    throw new ApiRequestError(
      payload?.error ?? `Request failed (${response.status}).`,
      payload?.code ?? null,
      payload?.retryAfterSeconds ?? null,
    );
  }
  return payload;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<T>(response);
}

function toFailure(cause: unknown, fallback: string): RequestFailure {
  if (cause instanceof ApiRequestError) {
    return { message: cause.message, code: cause.code, retryAfterSeconds: cause.retryAfterSeconds };
  }
  return {
    message: cause instanceof Error ? cause.message : fallback,
    code: null,
    retryAfterSeconds: null,
  };
}

interface MergeSetupProps {
  apiConfigured: boolean;
  initialRanking: KingdomAllianceRank[];
  initialRankingError: RequestFailure | null;
  rankingRetrievedAt: string | null;
}

export function MergeSetup({
  apiConfigured,
  initialRanking,
  initialRankingError,
  rankingRetrievedAt,
}: MergeSetupProps) {
  const router = useRouter();
  const { notify } = useToast();

  const [csvMergeSize, setCsvMergeSize] = useState<MergeSize>(2);
  const [csvTags, setCsvTags] = useState(["", "", ""]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sessionName, setSessionName] = useState("");
  const mode: "api" | "csv" = apiConfigured ? "api" : "csv";

  const [ranking, setRanking] = useState<KingdomAllianceRank[]>(initialRanking);
  const [rankingAt, setRankingAt] = useState<string | null>(rankingRetrievedAt);
  const [rankingError, setRankingError] = useState<RequestFailure | null>(initialRankingError);
  const [refreshing, setRefreshing] = useState(false);

  const [fetching, setFetching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<RequestFailure | null>(null);
  const [previews, setPreviews] = useState<RosterPreview[] | null>(null);

  const mergeSize: MergeSize = mode === "api" ? ((selectedTags.length === 3 ? 3 : 2) as MergeSize) : csvMergeSize;

  const slots = useMemo(() => {
    if (mode === "api") {
      return selectedTags.map((allianceTag, index) => ({
        slotNumber: (index + 1) as AllianceSlot,
        kingdomId: HOME_KINGDOM_ID,
        allianceTag,
      }));
    }
    return Array.from({ length: csvMergeSize }, (_, index) => ({
      slotNumber: (index + 1) as AllianceSlot,
      kingdomId: HOME_KINGDOM_ID,
      allianceTag: csvTags[index].trim(),
    }));
  }, [mode, selectedTags, csvMergeSize, csvTags]);

  const complete =
    mode === "api"
      ? selectedTags.length === 2 || selectedTags.length === 3
      : slots.every((slot) => slot.allianceTag.length > 0);

  const toggleAlliance = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((item) => item !== tag));
      setPreviews(null);
      setError(null);
      return;
    }
    if (selectedTags.length >= 3) {
      notify("Pick 2 or 3 alliances — uncheck one before adding another.", "warning");
      return;
    }
    setSelectedTags([...selectedTags, tag]);
    setPreviews(null);
    setError(null);
  };

  const refreshRanking = async () => {
    setRefreshing(true);
    setRankingError(null);
    try {
      const response = await fetch("/api/kingshot/alliances?force=1");
      const result = await readJson<{ alliances: KingdomAllianceRank[]; retrievedAt: string }>(response);
      setRanking(result.alliances);
      setRankingAt(result.retrievedAt);
      notify(`Loaded top ${result.alliances.length} alliances in kingdom ${HOME_KINGDOM_ID}.`, "success");
    } catch (cause) {
      setRankingError(toFailure(cause, "Could not load the kingdom ranking."));
    } finally {
      setRefreshing(false);
    }
  };

  const fetchRosters = async () => {
    if (selectedTags.length !== 2 && selectedTags.length !== 3) {
      notify("Select 2 or 3 alliances from the list first.", "warning");
      return;
    }
    setFetching(true);
    setError(null);
    setPreviews(null);
    try {
      const result = await postJson<{ alliances: RosterPreview[] }>("/api/kingshot/roster", {
        alliances: slots.map((slot) => ({
          slotNumber: slot.slotNumber,
          kingdomId: HOME_KINGDOM_ID,
          allianceTag: slot.allianceTag,
        })),
      });
      setPreviews(result.alliances);
      notify(
        `Fetched ${result.alliances.reduce((sum, alliance) => sum + alliance.memberCount, 0)} players from ${result.alliances.length} alliances.`,
        "success",
      );
    } catch (cause) {
      setError(toFailure(cause, "Could not fetch the rosters."));
    } finally {
      setFetching(false);
    }
  };

  const createApiSession = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await postJson<{ session: { id: string } }>("/api/sessions", {
        name: sessionName.trim() || undefined,
        mergeSize,
        source: "api",
        alliances: slots,
      });
      router.push(`/merge/${result.session.id}`);
    } catch (cause) {
      setError(toFailure(cause, "Could not create the merge session."));
      setCreating(false);
    }
  };

  const createCsvSession = async (payloads: CsvImportPayload[]) => {
    setCreating(true);
    setError(null);
    try {
      const result = await postJson<{ session: { id: string } }>("/api/sessions", {
        name: sessionName.trim() || undefined,
        mergeSize,
        source: "csv",
        alliances: slots.map((slot) => ({
          slotNumber: slot.slotNumber,
          kingdomId: HOME_KINGDOM_ID,
          allianceTag: slot.allianceTag,
        })),
      });
      await postJson(`/api/sessions/${result.session.id}/import`, { imports: payloads });
      router.push(`/merge/${result.session.id}`);
    } catch (cause) {
      setError(toFailure(cause, "Could not import the CSV rosters."));
      setCreating(false);
    }
  };

  const displayError = error ?? (mode === "api" ? rankingError : null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>Kingdom {HOME_KINGDOM_ID}</SectionTitle>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pick 2 or 3 alliances from the current top 10 by power
          </p>
        </div>
        <Badge className="border-primary/40 bg-primary/10 text-primary">
          Kingdom {HOME_KINGDOM_ID}
        </Badge>
      </div>

      {mode === "api" ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Top 10 alliances
              </span>
              <Badge>
                {selectedTags.length}/3 selected
              </Badge>
              {rankingAt ? (
                <span suppressHydrationWarning className="text-[11px] text-muted-foreground">
                  Updated {formatRelativeTime(rankingAt)}
                </span>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" onClick={() => void refreshRanking()} disabled={refreshing || !apiConfigured}>
              {refreshing ? <Spinner /> : null}
              {refreshing ? "Refreshing…" : "Refresh ranking"}
            </Button>
          </div>

          {selectedTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
              {selectedTags.map((tag, index) => {
                const theme = SLOT_THEME[(index + 1) as AllianceSlot];
                const row = ranking.find((alliance) => alliance.tag === tag);
                return (
                  <span
                    key={tag}
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold",
                      theme.border,
                      theme.bg,
                      theme.text,
                    )}
                  >
                    {theme.label}: [{tag}] {row?.name ?? tag}
                  </span>
                );
              })}
            </div>
          ) : null}

          {ranking.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {rankingError ? "Could not load the ranking." : "No alliances returned for this kingdom."}
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {ranking.map((alliance) => {
                const selectedIndex = selectedTags.indexOf(alliance.tag);
                const selected = selectedIndex >= 0;
                const slot = selected ? ((selectedIndex + 1) as AllianceSlot) : null;
                const theme = slot ? SLOT_THEME[slot] : null;
                return (
                  <li key={alliance.tag}>
                    <button
                      type="button"
                      onClick={() => toggleAlliance(alliance.tag)}
                      aria-pressed={selected}
                      className={clsx(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                        selected ? "bg-accent" : null,
                      )}
                    >
                      <span className="tabular w-6 shrink-0 text-xs font-bold text-muted-foreground">
                        #{alliance.rank}
                      </span>
                      <span
                        className={clsx(
                          "grid size-5 shrink-0 place-items-center rounded-md border",
                          selected ? "border-primary bg-primary" : "border-input",
                        )}
                        aria-hidden="true"
                      >
                        {selected ? (
                          <svg viewBox="0 0 12 12" className="size-3 text-primary-foreground" fill="none">
                            <path
                              d="m2.5 6.2 2.2 2.2 4.8-4.8"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          [{alliance.tag}] {alliance.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {alliance.leaderName ? `Leader ${alliance.leaderName}` : "Kingdom 2362"}
                          {alliance.memberCount ? ` · ${alliance.memberCount} members` : ""}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-foreground">
                        {formatPower(alliance.power)}
                      </span>
                      {theme ? (
                        <Badge className={clsx(theme.border, theme.bg, theme.text)}>{theme.label}</Badge>
                      ) : (
                        <span className="w-[88px] shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {([2, 3] as MergeSize[]).map((size) => {
            const selected = csvMergeSize === size;
            return (
              <Card
                key={size}
                className={clsx(
                  "overflow-hidden transition-colors",
                  selected ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCsvMergeSize(size);
                    setPreviews(null);
                    setError(null);
                  }}
                  aria-pressed={selected}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className={clsx("block text-sm font-black uppercase tracking-[0.16em]", selected ? "text-primary" : "text-muted-foreground")}>
                      {size} Alliance Merge
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      CSV labels for kingdom {HOME_KINGDOM_ID}.
                    </span>
                  </span>
                </button>
                {selected ? (
                  <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
                    {Array.from({ length: size }, (_, index) => {
                      const theme = SLOT_THEME[(index + 1) as AllianceSlot];
                      return (
                        <Field key={index} label={`${theme.label} tag`} htmlFor={`csv-tag-${size}-${index}`}>
                          <Input
                            id={`csv-tag-${size}-${index}`}
                            value={csvTags[index]}
                            onChange={(event) => {
                              const value = event.target.value;
                              setCsvTags((current) => current.map((tag, tagIndex) => (tagIndex === index ? value : tag)));
                              setPreviews(null);
                            }}
                            placeholder={["RCB", "HEA", "TOP"][index]}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </Field>
                      );
                    })}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="p-4">
        <Field
          label="Merge session name"
          htmlFor="session-name"
          hint={`Optional. Defaults to something like “Kingdom ${HOME_KINGDOM_ID} Merge (RCB + HEA)”.`}
        >
          <Input
            id="session-name"
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
            placeholder={`Kingdom ${HOME_KINGDOM_ID} Merge`}
            maxLength={120}
          />
        </Field>

        {displayError ? (
          <div className="mt-3">
            <Alert
              tone={
                displayError.code === "rate_limited" || displayError.code === "local_rate_limit"
                  ? "warning"
                  : "error"
              }
              title={(displayError.code && ERROR_TITLES[displayError.code]) || "Something went wrong"}
            >
              {displayError.message}
              {displayError.retryAfterSeconds ? (
                <span className="mt-1 block text-muted-foreground">
                  Retry after about {displayError.retryAfterSeconds}s.
                </span>
              ) : null}
            </Alert>
          </div>
        ) : null}

        {mode === "api" ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={previews ? "secondary" : "primary"}
                onClick={() => void fetchRosters()}
                disabled={!complete || fetching || creating || !apiConfigured}
                aria-busy={fetching}
              >
                {fetching ? <Spinner /> : null}
                {fetching ? "Fetching rosters…" : "Fetch Rosters"}
              </Button>

              {previews ? (
                <Button variant="primary" onClick={() => void createApiSession()} disabled={creating} aria-busy={creating}>
                  {creating ? <Spinner /> : null}
                  {creating ? "Creating session…" : "Enter Merge Planner"}
                </Button>
              ) : null}

              {!complete ? (
                <p className="text-xs text-muted-foreground">Select 2 or 3 alliances from the ranking above.</p>
              ) : null}
            </div>

            {previews ? (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {previews.map((preview) => {
                  const theme = SLOT_THEME[preview.slotNumber];
                  return (
                    <Card key={preview.slotNumber} className={clsx("p-3", theme.border)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx("text-xs font-bold uppercase tracking-wide", theme.text)}>
                          {theme.label}
                        </span>
                        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                          {preview.memberCount} players
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        [{preview.allianceTag}] {preview.allianceName}
                      </p>
                      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <dt className="text-muted-foreground">Kingdom</dt>
                        <dd className="tabular text-right">{preview.kingdomId}</dd>
                        <dt className="text-muted-foreground">Roster power</dt>
                        <dd className="tabular text-right">{formatPower(preview.totalPower)}</dd>
                        {preview.leaderName ? (
                          <>
                            <dt className="text-muted-foreground">Leader</dt>
                            <dd className="truncate text-right">{preview.leaderName}</dd>
                          </>
                        ) : null}
                      </dl>
                    </Card>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Upload one CSV per alliance. Kingdom {HOME_KINGDOM_ID} is applied automatically. A player
              name and a power column are required.
            </p>
            <CsvImporter
              slots={slots}
              requireAll
              busy={creating}
              submitLabel="Create session from CSV"
              onImport={createCsvSession}
            />
            {!complete ? (
              <p className="text-xs text-amber-300">
                Enter an alliance tag for all {csvMergeSize} alliances before importing.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
