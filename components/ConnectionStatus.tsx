"use client";

import { memo } from "react";
import clsx from "clsx";

import { formatRelativeTime } from "@/lib/roster";
import type { RealtimeStatus, SyncStatus } from "@/types/roster";

interface ConnectionStatusProps {
  realtime: RealtimeStatus;
  syncStatus: SyncStatus;
  /** When this app last pulled rosters from the Kingshot API. */
  lastRosterSync: string | null;
  /** When the Kingshot API itself generated that data (can be up to 60m old). */
  apiCachedAt: string | null;
  now: number;
}

const REALTIME_STATE: Record<
  RealtimeStatus,
  { label: string; dot: string; className: string; sr: string }
> = {
  live: {
    label: "LIVE",
    dot: "bg-emerald-400",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    sr: "Collaboration connected. Selections are shared instantly with everyone in this session.",
  },
  reconnecting: {
    label: "RECONNECTING",
    dot: "bg-amber-400",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    sr: "Reconnecting to the collaboration server. Your changes are still saved, but other people's changes may be delayed.",
  },
  offline: {
    label: "OFFLINE",
    dot: "bg-red-400",
    className: "border-red-500/40 bg-red-500/10 text-red-200",
    sr: "Collaboration is offline. Reload once your connection returns to see other people's changes.",
  },
};

function absolute(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

/**
 * Two independent signals, deliberately never conflated:
 *   1. Realtime collaboration link — selections really are live.
 *   2. Kingshot roster sync — API data can be up to 60 minutes old, so it is
 *      labelled with when it was fetched and when the API generated it.
 */
function ConnectionStatusComponent({
  realtime,
  syncStatus,
  lastRosterSync,
  apiCachedAt,
  now,
}: ConnectionStatusProps) {
  const state = REALTIME_STATE[realtime];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span
        className={clsx(
          "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]",
          state.className,
        )}
        role="status"
        aria-live="polite"
      >
        <span
          className={clsx("size-2 rounded-full", state.dot, realtime === "live" && "animate-pulse-dot")}
          aria-hidden="true"
        />
        {state.label}
        <span className="sr-only"> — {state.sr}</span>
      </span>

      {syncStatus === "syncing" ? (
        <span
          className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200"
          role="status"
          aria-live="polite"
        >
          <span className="size-2 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
          Syncing rosters
        </span>
      ) : null}

      <span className="text-[11px] text-muted-foreground">
        Last roster sync:{" "}
        <span className="font-semibold text-foreground" title={absolute(lastRosterSync)}>
          {formatRelativeTime(lastRosterSync, now)}
        </span>
        {apiCachedAt ? (
          <span className="text-muted-foreground/80" title={absolute(apiCachedAt)}>
            {" "}
            ·Data generated {formatRelativeTime(apiCachedAt, now)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export const ConnectionStatus = memo(ConnectionStatusComponent);
