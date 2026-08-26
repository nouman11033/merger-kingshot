"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";

import { AllianceRoster } from "@/components/AllianceRoster";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { FilterBar } from "@/components/FilterBar";
import { KingdomLadder } from "@/components/KingdomLadder";
import { OfficerSelect } from "@/components/OfficerSelect";
import { PrimeRoster } from "@/components/PrimeRoster";
import { SearchBar } from "@/components/SearchBar";
import { StatsBar } from "@/components/StatsBar";
import { SyncButton } from "@/components/SyncButton";
import { useToast } from "@/components/Toaster";
import { Alert, Badge, Button, Card, SectionTitle } from "@/components/ui";
import { mapAlliance, mapPlayer } from "@/lib/mappers";
import {
  EMPTY_FILTERS,
  buildPrimeRoster,
  computeStats,
  hasActiveFilters,
  matchesFilters,
  officerPlayers,
  playersByAlliance,
  primeToClipboardText,
  primeToCsv,
  slugify,
} from "@/lib/roster";
import { getSupabaseBrowserClient, getSupabaseConfig } from "@/lib/supabase";
import { useMergeRealtime, type RealtimeBatch } from "@/hooks/useMergeRealtime";
import { SELECTIONS_TABLE } from "@/types/database";
import type {
  Alliance,
  KingdomAllianceRank,
  MergeSnapshot,
  Player,
  RosterFilters,
  SyncReport,
  SyncStatus,
} from "@/types/roster";

interface MergePlannerProps {
  snapshot: MergeSnapshot;
  apiConfigured: boolean;
  initialRanking?: KingdomAllianceRank[];
  rankingRetrievedAt?: string | null;
}

const PRIME_FULL_MESSAGE = (count: number, limit: number) =>
  `Prime roster is full (${count}/${limit}). Uncheck a player before selecting another.`;

export function MergePlanner({
  snapshot,
  apiConfigured,
  initialRanking = [],
  rankingRetrievedAt = null,
}: MergePlannerProps) {
  const { notify } = useToast();
  const { session } = snapshot;

  // playersRef mirrors state synchronously so rapid clicks and realtime events
  // always read the latest roster instead of a stale render closure.
  const playersRef = useRef<Player[]>(snapshot.players);
  const [players, setPlayers] = useState<Player[]>(snapshot.players);
  const alliancesRef = useRef<Alliance[]>(snapshot.alliances);
  const [alliances, setAlliances] = useState<Alliance[]>(snapshot.alliances);

  const realtimeReady = useMemo(() => getSupabaseConfig() !== null, []);
  const [filters, setFilters] = useState<RosterFilters>(EMPTY_FILTERS);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncReports, setSyncReports] = useState<SyncReport[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [rosterDetails, setRosterDetails] = useState(false);
  const [officerBusy, setOfficerBusy] = useState(false);
  const officerBusyRef = useRef(false);
  const [ranking, setRanking] = useState<KingdomAllianceRank[]>(initialRanking);
  const [rankingAt, setRankingAt] = useState<string | null>(rankingRetrievedAt);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [rankingRefreshing, setRankingRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /**
   * Selections this client has written but not yet had confirmed. While a
   * player id is pending, incoming Realtime rows for it are ignored: they are
   * either our own echo or a value the server is about to overwrite. This is
   * what keeps rapid clicking from flickering.
   */
  const pendingWritesRef = useRef<Map<string, boolean>>(new Map());
  /** Last applied selection timestamp per player, to drop out-of-order events. */
  const selectionClockRef = useRef<Map<string, number>>(new Map());

  const applyPlayers = useCallback((updater: (current: Player[]) => Player[]) => {
    const next = updater(playersRef.current);
    if (next === playersRef.current) return;
    playersRef.current = next;
    setPlayers(next);
  }, []);

  const applySnapshot = useCallback((next: MergeSnapshot) => {
    // Any selection this client is still writing wins over the snapshot, so a
    // resync mid-click cannot roll the checkbox back under the user.
    const pending = pendingWritesRef.current;
    const players = pending.size
      ? next.players.map((player) =>
          pending.has(player.id) ? { ...player, selected: pending.get(player.id)! } : player,
        )
      : next.players;

    playersRef.current = players;
    alliancesRef.current = next.alliances;
    setPlayers(players);
    setAlliances(next.alliances);
  }, []);

  // "X minutes ago" labels stay honest without polling the database.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /** ----------------------------------------------------------------
   *  Derived state — Prime is always computed, never stored.
   *  ---------------------------------------------------------------- */
  const prime = useMemo(() => buildPrimeRoster(players), [players]);
  const stats = useMemo(
    () => computeStats(players, alliances, prime, session.primeLimit),
    [players, alliances, prime, session.primeLimit],
  );
  const primeRanks = useMemo(() => {
    const ranks = new Map<string, number>();
    for (const entry of prime) ranks.set(entry.player.id, entry.primeRank);
    return ranks;
  }, [prime]);

  const filtersActive = useMemo(() => hasActiveFilters(filters), [filters]);
  const grouped = useMemo(() => playersByAlliance(players), [players]);

  const filteredByAlliance = useMemo(() => {
    const result = new Map<string, Player[]>();
    for (const alliance of alliances) {
      const roster = grouped.get(alliance.id) ?? [];
      result.set(
        alliance.id,
        filtersActive ? roster.filter((player) => matchesFilters(player, filters)) : roster,
      );
    }
    return result;
  }, [alliances, grouped, filters, filtersActive]);

  const visiblePrime = useMemo(
    () => (filtersActive ? prime.filter((entry) => matchesFilters(entry.player, filters)) : prime),
    [prime, filters, filtersActive],
  );

  const searchMatches = useMemo(() => {
    if (!filters.search.trim()) return 0;
    return players.filter((player) => player.active && matchesFilters(player, filters)).length;
  }, [players, filters]);

  const lastRosterSync = useMemo(() => {
    const timestamps = alliances
      .map((alliance) => alliance.lastSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : null;
  }, [alliances]);

  const oldestApiCache = useMemo(() => {
    const timestamps = alliances
      .map((alliance) => alliance.apiCachedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    return timestamps.length ? timestamps[0] : null;
  }, [alliances]);

  /** Nothing to sync when every alliance came from a CSV file. */
  const hasApiAlliance = useMemo(
    () => alliances.some((alliance) => alliance.source !== "csv"),
    [alliances],
  );

  const officerStats = useMemo(() => {
    const all = officerPlayers(players);
    const byAlliance = new Map<string, { total: number; selected: number }>();
    for (const alliance of alliances) {
      const officers = officerPlayers(players, alliance.id);
      byAlliance.set(alliance.id, {
        total: officers.length,
        selected: officers.filter((player) => player.selected).length,
      });
    }
    return {
      total: all.length,
      selected: all.filter((player) => player.selected).length,
      byAlliance,
    };
  }, [alliances, players]);

  /** ----------------------------------------------------------------
   *  Optimistic selection, persisted to Supabase
   *  ---------------------------------------------------------------- */
  const toggleSelection = useCallback(
    async (playerId: string, next: boolean) => {
      const current = playersRef.current.find((player) => player.id === playerId);
      if (!current || current.selected === next) return;

      if (next) {
        const selectedCount = playersRef.current.filter(
          (player) => player.selected && player.active,
        ).length;
        if (selectedCount >= session.primeLimit) {
          notify(PRIME_FULL_MESSAGE(selectedCount, session.primeLimit), "warning");
          return;
        }
      }

      // 1. Optimistic: the checkbox and Prime update on this click.
      pendingWritesRef.current.set(playerId, next);
      applyPlayers((list) =>
        list.map((player) => (player.id === playerId ? { ...player, selected: next } : player)),
      );

      // 2. Persist. Supabase remains the source of truth and fans the change
      //    out to every other connected planner over Realtime.
      const writtenAt = new Date().toISOString();
      const { error } = await getSupabaseBrowserClient()
        .from(SELECTIONS_TABLE)
        .upsert(
          {
            merge_session_id: session.id,
            player_id: playerId,
            selected: next,
            updated_at: writtenAt,
          },
          { onConflict: "merge_session_id,player_id" },
        );

      // A newer click on the same player superseded this write; leave it alone.
      if (pendingWritesRef.current.get(playerId) !== next) return;
      pendingWritesRef.current.delete(playerId);

      if (error) {
        // 3. On failure, revert the checkbox and Prime, then explain why.
        applyPlayers((list) =>
          list.map((player) =>
            player.id === playerId ? { ...player, selected: current.selected } : player,
          ),
        );
        const full = error.message.includes("prime_roster_full");
        notify(
          full
            ? PRIME_FULL_MESSAGE(session.primeLimit, session.primeLimit)
            : `Could not save the selection for ${current.name}: ${error.message}`,
          full ? "warning" : "error",
        );
        return;
      }

      selectionClockRef.current.set(playerId, Date.parse(writtenAt));
    },
    [applyPlayers, notify, session.id, session.primeLimit],
  );

  /** One checkbox: select (or unselect) every R4 and R5 in scope, capped at 100. */
  const applyOfficerSelection = useCallback(
    async (next: boolean, allianceId?: string) => {
      if (officerBusyRef.current) return;

      const officers = officerPlayers(playersRef.current, allianceId);
      if (officers.length === 0) {
        notify(
          "No R4 or R5 roles found yet. Sync rosters from the Kingshot API so alliance ranks load, then try again.",
          "warning",
        );
        return;
      }

      let targets: Player[];
      let truncated = false;
      if (next) {
        const selectedCount = playersRef.current.filter(
          (player) => player.selected && player.active,
        ).length;
        const remaining = session.primeLimit - selectedCount;
        if (remaining <= 0) {
          notify(PRIME_FULL_MESSAGE(selectedCount, session.primeLimit), "warning");
          return;
        }
        const unselected = officers
          .filter((player) => !player.selected)
          .sort((a, b) => b.power - a.power);
        if (unselected.length === 0) return;
        truncated = unselected.length > remaining;
        targets = unselected.slice(0, remaining);
      } else {
        targets = officers.filter((player) => player.selected);
        if (targets.length === 0) return;
      }

      const ids = new Set(targets.map((player) => player.id));
      const previous = new Map(targets.map((player) => [player.id, player.selected]));
      const writtenAt = new Date().toISOString();

      officerBusyRef.current = true;
      setOfficerBusy(true);
      for (const player of targets) pendingWritesRef.current.set(player.id, next);
      applyPlayers((list) =>
        list.map((player) => (ids.has(player.id) ? { ...player, selected: next } : player)),
      );

      try {
        const { error } = await getSupabaseBrowserClient()
          .from(SELECTIONS_TABLE)
          .upsert(
            targets.map((player) => ({
              merge_session_id: session.id,
              player_id: player.id,
              selected: next,
              updated_at: writtenAt,
            })),
            { onConflict: "merge_session_id,player_id" },
          );

        for (const player of targets) {
          if (pendingWritesRef.current.get(player.id) === next) {
            pendingWritesRef.current.delete(player.id);
          }
        }

        if (error) {
          applyPlayers((list) =>
            list.map((player) =>
              previous.has(player.id) ? { ...player, selected: previous.get(player.id)! } : player,
            ),
          );
          const full = error.message.includes("prime_roster_full");
          notify(
            full
              ? PRIME_FULL_MESSAGE(session.primeLimit, session.primeLimit)
              : `Could not update R4/R5 selections: ${error.message}`,
            full ? "warning" : "error",
          );
          return;
        }

        const stamp = Date.parse(writtenAt);
        for (const player of targets) selectionClockRef.current.set(player.id, stamp);

        if (truncated) {
          notify(
            `Selected ${targets.length} R4/R5 officers. Prime is full — remaining officers were skipped.`,
            "warning",
          );
        } else {
          notify(
            next
              ? `Selected ${targets.length} R4/R5 officer${targets.length === 1 ? "" : "s"}.`
              : `Unselected ${targets.length} R4/R5 officer${targets.length === 1 ? "" : "s"}.`,
            "success",
          );
        }
      } catch (error) {
        for (const player of targets) {
          if (pendingWritesRef.current.get(player.id) === next) {
            pendingWritesRef.current.delete(player.id);
          }
        }
        applyPlayers((list) =>
          list.map((player) =>
            previous.has(player.id) ? { ...player, selected: previous.get(player.id)! } : player,
          ),
        );
        notify(
          error instanceof Error ? error.message : "Could not update R4/R5 selections.",
          "error",
        );
      } finally {
        officerBusyRef.current = false;
        setOfficerBusy(false);
      }
    },
    [applyPlayers, notify, session.id, session.primeLimit],
  );

  /** Uncheck every selected player in one alliance. Other alliances are untouched. */
  const clearAllianceSelections = useCallback(
    async (allianceId: string) => {
      if (officerBusyRef.current) return;

      const targets = playersRef.current.filter(
        (player) => player.allianceId === allianceId && player.selected,
      );
      if (targets.length === 0) return;

      const alliance = alliancesRef.current.find((item) => item.id === allianceId);
      const tag = alliance?.allianceTag ? `[${alliance.allianceTag}]` : "this alliance";
      const ids = new Set(targets.map((player) => player.id));
      const previous = new Map(targets.map((player) => [player.id, player.selected]));
      const writtenAt = new Date().toISOString();

      officerBusyRef.current = true;
      setOfficerBusy(true);
      for (const player of targets) pendingWritesRef.current.set(player.id, false);
      applyPlayers((list) =>
        list.map((player) => (ids.has(player.id) ? { ...player, selected: false } : player)),
      );

      try {
        const { error } = await getSupabaseBrowserClient()
          .from(SELECTIONS_TABLE)
          .upsert(
            targets.map((player) => ({
              merge_session_id: session.id,
              player_id: player.id,
              selected: false,
              updated_at: writtenAt,
            })),
            { onConflict: "merge_session_id,player_id" },
          );

        for (const player of targets) {
          if (pendingWritesRef.current.get(player.id) === false) {
            pendingWritesRef.current.delete(player.id);
          }
        }

        if (error) {
          applyPlayers((list) =>
            list.map((player) =>
              previous.has(player.id) ? { ...player, selected: previous.get(player.id)! } : player,
            ),
          );
          notify(`Could not clear ${tag}: ${error.message}`, "error");
          return;
        }

        const stamp = Date.parse(writtenAt);
        for (const player of targets) selectionClockRef.current.set(player.id, stamp);
        notify(
          `Unselected ${targets.length} player${targets.length === 1 ? "" : "s"} in ${tag}.`,
          "success",
        );
      } catch (error) {
        for (const player of targets) {
          if (pendingWritesRef.current.get(player.id) === false) {
            pendingWritesRef.current.delete(player.id);
          }
        }
        applyPlayers((list) =>
          list.map((player) =>
            previous.has(player.id) ? { ...player, selected: previous.get(player.id)! } : player,
          ),
        );
        notify(error instanceof Error ? error.message : `Could not clear ${tag}.`, "error");
      } finally {
        officerBusyRef.current = false;
        setOfficerBusy(false);
      }
    },
    [applyPlayers, notify, session.id],
  );

  const refreshRanking = useCallback(async () => {
    if (!apiConfigured) return;
    setRankingRefreshing(true);
    try {
      const response = await fetch("/api/kingshot/alliances", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            alliances?: KingdomAllianceRank[];
            retrievedAt?: string;
          }
        | null;
      if (!response.ok || !payload?.ok || !payload.alliances) {
        throw new Error(payload?.error ?? "Could not load the kingdom ranking.");
      }
      setRanking(payload.alliances);
      setRankingAt(payload.retrievedAt ?? new Date().toISOString());
      setRankingError(null);
    } catch (error) {
      setRankingError(
        error instanceof Error ? error.message : "Could not load the kingdom ranking.",
      );
    } finally {
      setRankingRefreshing(false);
    }
  }, [apiConfigured]);

  useEffect(() => {
    if (!apiConfigured) return;
    const kick = window.setTimeout(() => void refreshRanking(), 0);
    const timer = window.setInterval(() => void refreshRanking(), 60_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [apiConfigured, refreshRanking]);

  /** Re-reads the authoritative state (first subscribe, reconnect, manual sync). */
  const reloadSnapshot = useCallback(async () => {
    const response = await fetch(`/api/sessions/${session.id}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | ({ ok: boolean; error?: string } & MergeSnapshot)
      | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? "Could not reload the merge session.");
    }
    applySnapshot({
      session: payload.session,
      alliances: payload.alliances,
      players: payload.players,
    });
  }, [applySnapshot, session.id]);

  /** ----------------------------------------------------------------
   *  Realtime collaboration — one batched state update per flush
   *  ---------------------------------------------------------------- */
  const applyRealtimeBatch = useCallback(
    (batch: RealtimeBatch) => {
      if (batch.alliances.length > 0) {
        let alliancesChanged = false;
        for (const row of batch.alliances) {
          const mapped = mapAlliance(row);
          const exists = alliancesRef.current.some((item) => item.id === mapped.id);
          alliancesRef.current = exists
            ? alliancesRef.current.map((item) => (item.id === mapped.id ? mapped : item))
            : [...alliancesRef.current, mapped].sort((a, b) => a.slotNumber - b.slotNumber);
          alliancesChanged = true;
        }
        if (alliancesChanged) setAlliances(alliancesRef.current);
      }

      applyPlayers((list) => {
        let next = list;
        let changed = false;

        const replace = (index: number, player: Player) => {
          if (!changed) {
            next = [...next];
            changed = true;
          }
          next[index] = player;
        };

        // Roster changes (sync, CSV import, departures) arrive as player rows.
        for (const mutation of batch.players) {
          if (mutation.kind === "remove") {
            const index = next.findIndex((player) => player.id === mutation.id);
            if (index === -1) continue;
            if (!changed) {
              next = [...next];
              changed = true;
            }
            next.splice(index, 1);
            continue;
          }

          const row = mutation.row;
          const index = next.findIndex((player) => player.id === row.id);

          if (!row.active) {
            if (index === -1) continue;
            if (!changed) {
              next = [...next];
              changed = true;
            }
            next.splice(index, 1);
            continue;
          }

          const alliance = alliancesRef.current.find((item) => item.id === row.alliance_id);
          const selected = index === -1 ? false : next[index].selected;
          const mapped = mapPlayer(row, alliance, selected);
          if (index === -1) {
            if (!changed) {
              next = [...next];
              changed = true;
            }
            next.push(mapped);
          } else {
            replace(index, mapped);
          }
        }

        // Selection changes from every collaborator.
        for (const change of batch.selections) {
          // Our own in-flight write is authoritative until it settles.
          if (pendingWritesRef.current.has(change.playerId)) continue;

          const stamp = change.updatedAt ? Date.parse(change.updatedAt) : Date.now();
          const lastStamp = selectionClockRef.current.get(change.playerId);
          if (lastStamp !== undefined && stamp < lastStamp) continue;
          selectionClockRef.current.set(change.playerId, stamp);

          const index = next.findIndex((player) => player.id === change.playerId);
          if (index === -1 || next[index].selected === change.selected) continue;
          replace(index, { ...next[index], selected: change.selected });
        }

        // Alliance metadata is denormalized onto players for display.
        for (const row of batch.alliances) {
          const mapped = mapAlliance(row);
          next.forEach((player, index) => {
            if (
              player.allianceId !== mapped.id ||
              (player.allianceName === mapped.allianceName &&
                player.allianceTag === mapped.allianceTag &&
                player.allianceSlot === mapped.slotNumber)
            ) {
              return;
            }
            replace(index, {
              ...player,
              allianceName: mapped.allianceName,
              allianceTag: mapped.allianceTag,
              allianceSlot: mapped.slotNumber,
            });
          });
        }

        return changed ? next : list;
      });
    },
    [applyPlayers],
  );

  const { status: realtime } = useMergeRealtime({
    sessionId: session.id,
    enabled: realtimeReady,
    onBatch: applyRealtimeBatch,
    onResync: reloadSnapshot,
  });

  /** ----------------------------------------------------------------
   *  Roster sync / clear
   *  ---------------------------------------------------------------- */
  const runSync = useCallback(async () => {
    setSyncStatus("syncing");
    setSyncError(null);
    try {
      const response = await fetch(`/api/sessions/${session.id}/sync`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | ({ ok: boolean; error?: string; reports: SyncReport[] } & MergeSnapshot)
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Sync failed (${response.status}).`);
      }

      applySnapshot({
        session: payload.session,
        alliances: payload.alliances,
        players: payload.players,
      });
      setSyncReports(payload.reports);
      setSyncStatus("idle");
      setNow(Date.now());

      const added = payload.reports.reduce((sum, report) => sum + report.added, 0);
      const departed = payload.reports.reduce((sum, report) => sum + report.deactivated, 0);
      notify(
        `Rosters synced — ${payload.players.length} players, ${added} new, ${departed} departed.`,
        "success",
      );
      void refreshRanking();
    } catch (error) {
      setSyncStatus("error");
      const message = error instanceof Error ? error.message : "Roster sync failed.";
      setSyncError(message);
      notify(message, "error");
    }
  }, [applySnapshot, notify, refreshRanking, session.id]);

  const runClear = useCallback(async () => {
    setClearing(true);
    const previous = playersRef.current;
    // Optimistic locally; the server broadcast clears every other client.
    applyPlayers((list) =>
      list.map((player) => (player.selected ? { ...player, selected: false } : player)),
    );

    try {
      const response = await fetch(`/api/sessions/${session.id}/clear`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: string; cleared?: number }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Reset failed (${response.status}).`);
      }
      notify(`Cleared ${payload.cleared ?? 0} selections for everyone in this session.`, "success");
    } catch (error) {
      playersRef.current = previous;
      setPlayers(previous);
      notify(error instanceof Error ? error.message : "Could not clear Prime.", "error");
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }, [applyPlayers, notify, session.id]);

  /** ----------------------------------------------------------------
   *  Export
   *  ---------------------------------------------------------------- */
  const exportCsv = useCallback(() => {
    const blob = new Blob([primeToCsv(prime)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prime-${slugify(session.name)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Exported ${prime.length} Prime players to CSV.`, "success");
  }, [notify, prime, session.name]);

  const copyPrime = useCallback(async () => {
    const text = primeToClipboardText(prime);
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied ${prime.length} Prime players to the clipboard.`, "success");
    } catch {
      notify("Clipboard access was blocked by the browser. Use Export Prime CSV instead.", "error");
    }
  }, [notify, prime]);

  const updateFilters = useCallback((patch: Partial<RosterFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const columnClass =
    session.mergeSize === 3 ? "xl:grid-cols-3 lg:grid-cols-2" : "lg:grid-cols-2";

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="rounded-md text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                ← All sessions
              </Link>
              <Badge>{session.mergeSize} alliance merge</Badge>
            </div>
            <h1 className="font-heading mt-1 truncate text-xl font-black tracking-[0.1em] text-foreground uppercase sm:text-2xl">
              Kingshot Merge Planner
            </h1>
            <p className="truncate text-sm text-muted-foreground" title={session.name}>
              {session.name}
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <ConnectionStatus
              realtime={realtime}
              syncStatus={syncStatus}
              lastRosterSync={lastRosterSync}
              apiCachedAt={oldestApiCache}
              now={now}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SyncButton
                status={syncStatus}
                disabled={!apiConfigured || !hasApiAlliance}
                disabledReason={
                  apiConfigured
                    ? "Every alliance here was imported from CSV, so there is nothing to sync from the Kingshot API."
                    : "KINGSHOT_API_KEY is not configured on the server."
                }
                onSync={() => void runSync()}
              />
            </div>
          </div>
        </div>

        {!apiConfigured ? (
          <Alert tone="warning" title="Roster sync unavailable">
            The server has no <code className="font-mono">KINGSHOT_API_KEY</code>, so
            <span className="font-semibold"> Sync Rosters</span> is disabled. Realtime collaboration
            still works.
          </Alert>
        ) : null}

        {syncError ? (
          <Alert tone="error" title="Roster sync failed">
            {syncError}
          </Alert>
        ) : null}

        {syncReports?.some((report) => report.warnings.length > 0) ? (
          <Alert tone="warning" title="Roster normalization notes">
            <ul className="list-inside list-disc space-y-0.5">
              {syncReports
                .flatMap((report) =>
                  report.warnings.map((warning) => `[${report.allianceTag}] ${warning}`),
                )
                .slice(0, 5)
                .map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
            </ul>
          </Alert>
        ) : null}
      </header>

      <KingdomLadder
        ranking={ranking}
        ourAlliances={alliances}
        primePower={stats.totalPower}
        primeCount={stats.primeCount}
        retrievedAt={rankingAt}
        now={now}
        refreshing={rankingRefreshing}
        error={rankingError}
        onRefresh={() => void refreshRanking()}
      />

      <StatsBar stats={stats} />

      <PrimeRoster
        prime={prime}
        visiblePrime={visiblePrime}
        stats={stats}
        filtersActive={filtersActive}
        expanded={rosterDetails}
        now={now}
        onToggle={toggleSelection}
        onExportCsv={exportCsv}
        onCopy={() => void copyPrime()}
        onClear={() => setConfirmClear(true)}
        onToggleDetails={() => setRosterDetails((value) => !value)}
      />

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBar
            value={filters.search}
            matchCount={searchMatches}
            onChange={(value) => updateFilters({ search: value })}
          />
          <OfficerSelect
            id="select-all-officers"
            total={officerStats.total}
            selected={officerStats.selected}
            busy={officerBusy}
            onChange={(next) => void applyOfficerSelection(next)}
          />
        </div>
        <FilterBar
          filters={filters}
          mergeSize={session.mergeSize}
          filtersActive={filtersActive}
          onChange={updateFilters}
          onReset={resetFilters}
        />
      </Card>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Alliance rosters · sorted by alliance rank</SectionTitle>
          <Button
            size="sm"
            variant={rosterDetails ? "primary" : "secondary"}
            aria-pressed={rosterDetails}
            onClick={() => setRosterDetails((value) => !value)}
          >
            {rosterDetails ? "Hide details" : "Show details"}
          </Button>
        </div>
        <div className={clsx("grid gap-3", columnClass)}>
          {alliances.map((alliance) => {
            const allianceStat = stats.allianceStats.find(
              (stat) => stat.slotNumber === alliance.slotNumber,
            );
            return (
              <div
                key={alliance.id}
                className="min-h-[18rem] max-h-[36rem] max-lg:h-[min(36rem,70dvh)] max-lg:overflow-hidden"
              >
                <AllianceRoster
                  alliance={alliance}
                  players={filteredByAlliance.get(alliance.id) ?? []}
                  totalPlayers={allianceStat?.totalPlayers ?? 0}
                  selectedCount={allianceStat?.selectedCount ?? 0}
                  officerTotal={officerStats.byAlliance.get(alliance.id)?.total ?? 0}
                  officerSelected={officerStats.byAlliance.get(alliance.id)?.selected ?? 0}
                  officerBusy={officerBusy}
                  primeRanks={primeRanks}
                  primeFull={stats.isFull}
                  now={now}
                  expanded={rosterDetails}
                  onToggle={toggleSelection}
                  onToggleOfficers={(next) => void applyOfficerSelection(next, alliance.id)}
                  onClear={() => void clearAllianceSelections(alliance.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear Prime selection?"
        description={`This deselects all ${stats.primeCount} player(s) in "${session.name}" for every connected user. Other merge sessions are not affected.`}
        confirmLabel={clearing ? "Clearing…" : "Clear Prime"}
        busy={clearing}
        onConfirm={() => void runClear()}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
