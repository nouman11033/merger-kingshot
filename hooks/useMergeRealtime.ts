"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  ALLIANCES_TABLE,
  PLAYERS_TABLE,
  SELECTIONS_TABLE,
  type AllianceRow,
  type PlayerRow,
  type SelectionRow,
} from "@/types/database";
import type { RealtimeStatus } from "@/types/roster";

/**
 * Supabase Realtime subscription for one merge session.
 *
 * Design notes:
 *  - Events are buffered and flushed on a short timer so a roster sync (which
 *    writes hundreds of rows) results in one React update instead of hundreds.
 *  - No polling anywhere: the only network traffic is the websocket, plus a
 *    single authoritative re-read each time the channel (re)subscribes, which
 *    closes the gap for events missed while disconnected.
 *  - Connection state is reported as live / reconnecting / offline.
 */

export type PlayerMutation = { kind: "upsert"; row: PlayerRow } | { kind: "remove"; id: string };

export interface RealtimeBatch {
  selections: { playerId: string; selected: boolean; updatedAt: string | null }[];
  players: PlayerMutation[];
  alliances: AllianceRow[];
}

interface UseMergeRealtimeOptions {
  sessionId: string;
  enabled: boolean;
  onBatch: (batch: RealtimeBatch) => void;
  /** Called after every successful (re)subscribe to reconcile missed events. */
  onResync: () => void | Promise<void>;
}

const FLUSH_INTERVAL_MS = 40;
const MAX_BACKOFF_MS = 15_000;
/** Consecutive failed attempts before the indicator escalates to OFFLINE. */
const OFFLINE_AFTER_ATTEMPTS = 3;

const emptyBatch = (): RealtimeBatch => ({ selections: [], players: [], alliances: [] });

export function useMergeRealtime({
  sessionId,
  enabled,
  onBatch,
  onResync,
}: UseMergeRealtimeOptions): { status: RealtimeStatus } {
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "reconnecting" : "offline");

  // Callback identity must not force a resubscribe, so the latest versions are
  // kept in refs and only read from socket callbacks and timers.
  const onBatchRef = useRef(onBatch);
  const onResyncRef = useRef(onResync);

  useEffect(() => {
    onBatchRef.current = onBatch;
    onResyncRef.current = onResync;
  }, [onBatch, onResync]);

  const bufferRef = useRef<RealtimeBatch>(emptyBatch());
  const flushTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const batch = bufferRef.current;
    if (batch.selections.length === 0 && batch.players.length === 0 && batch.alliances.length === 0) {
      return;
    }
    bufferRef.current = emptyBatch();
    onBatchRef.current(batch);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = getSupabaseBrowserClient();
    const filter = `merge_session_id=eq.${sessionId}`;

    let channel: RealtimeChannel | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;
    let disposed = false;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const teardown = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) return;
      const delay = Math.min(1000 * 2 ** Math.min(attempts, 4), MAX_BACKOFF_MS);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        teardown();
        connect();
      }, delay);
    };

    const handleDisconnect = () => {
      if (disposed) return;
      attempts += 1;
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false
          ? true
          : attempts >= OFFLINE_AFTER_ATTEMPTS;
      setStatus(offline ? "offline" : "reconnecting");
      scheduleRetry();
    };

    function connect() {
      if (disposed) return;

      channel = supabase
        .channel(`merge-session:${sessionId}`)
        .on<SelectionRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: SELECTIONS_TABLE, filter },
          (payload) => {
            const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as
              | Partial<SelectionRow>
              | undefined;
            if (!row?.player_id) return;
            bufferRef.current.selections.push({
              playerId: row.player_id,
              selected: payload.eventType === "DELETE" ? false : row.selected === true,
              updatedAt: row.updated_at ?? null,
            });
            scheduleFlush();
          },
        )
        .on<PlayerRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: PLAYERS_TABLE, filter },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const removed = payload.old as Partial<PlayerRow> | undefined;
              if (removed?.id) bufferRef.current.players.push({ kind: "remove", id: removed.id });
            } else {
              const row = payload.new as PlayerRow | undefined;
              if (row?.id) bufferRef.current.players.push({ kind: "upsert", row });
            }
            scheduleFlush();
          },
        )
        .on<AllianceRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: ALLIANCES_TABLE, filter },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            const row = payload.new as AllianceRow | undefined;
            if (row?.id) bufferRef.current.alliances.push(row);
            scheduleFlush();
          },
        )
        .subscribe((state) => {
          if (disposed) return;
          if (state === "SUBSCRIBED") {
            attempts = 0;
            clearRetry();
            setStatus("live");
            void Promise.resolve(onResyncRef.current()).catch(() => handleDisconnect());
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            handleDisconnect();
          }
        });
    }

    const handleOffline = () => {
      if (disposed) return;
      setStatus("offline");
    };

    const handleOnline = () => {
      if (disposed) return;
      attempts = 0;
      setStatus("reconnecting");
      clearRetry();
      teardown();
      connect();
    };

    const handleVisibility = () => {
      // A sleeping tab can miss the socket close entirely, so re-check on wake.
      if (disposed || document.visibilityState !== "visible") return;
      if (channel?.state !== "joined") handleOnline();
      else void Promise.resolve(onResyncRef.current()).catch(() => handleDisconnect());
    };

    connect();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      clearRetry();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      bufferRef.current = emptyBatch();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      teardown();
    };
  }, [enabled, scheduleFlush, sessionId]);

  return { status };
}
