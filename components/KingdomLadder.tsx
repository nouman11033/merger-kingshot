"use client";

import { memo } from "react";
import clsx from "clsx";

import { Badge, Button, Card, SectionTitle, Spinner } from "@/components/ui";
import {
  alliancesRankedAbove,
  formatExactPower,
  formatPower,
  formatRelativeTime,
  primeWouldRank,
} from "@/lib/roster";
import { HOME_KINGDOM_ID } from "@/types/roster";
import type { Alliance, KingdomAllianceRank } from "@/types/roster";

interface KingdomLadderProps {
  ranking: KingdomAllianceRank[];
  ourAlliances: Alliance[];
  primePower: number;
  primeCount: number;
  retrievedAt: string | null;
  now: number;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}

function gapLabel(alliancePower: number, primePower: number): { text: string; className: string } {
  const delta = alliancePower - primePower;
  if (delta === 0) {
    return { text: "Tied with Prime", className: "text-muted-foreground" };
  }
  if (delta > 0) {
    return { text: `${formatPower(delta)} above Prime`, className: "text-amber-200" };
  }
  return { text: `Prime ahead by ${formatPower(-delta)}`, className: "text-emerald-300" };
}

function KingdomLadderComponent({
  ranking,
  ourAlliances,
  primePower,
  primeCount,
  retrievedAt,
  now,
  refreshing,
  error,
  onRefresh,
}: KingdomLadderProps) {
  const { above, ours, ourBest } = alliancesRankedAbove(ranking, ourAlliances);
  const liveRank = ranking.length > 0 ? primeWouldRank(ranking, primePower) : null;

  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <SectionTitle>Kingdom {HOME_KINGDOM_ID} · alliances above you</SectionTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {ourBest
              ? `Your strongest alliance here is #${ourBest.rank} [${ourBest.tag}]. Only alliances ranked higher are listed, with live Prime power next to their totals.`
              : ours.length === 0
                ? "Your merge tags are not on this board yet — showing the current kingdom leaders for comparison."
                : "No alliances are ranked above yours in this kingdom."}
          </p>
          {ours.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Your alliances:{" "}
              {ours
                .slice()
                .sort((a, b) => a.rank - b.rank)
                .map((row) => `#${row.rank} [${row.tag}] ${formatPower(row.power)}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveRank !== null ? (
            <Badge className="border-primary/40 bg-primary/10 text-primary">
              Prime would rank #{liveRank}
            </Badge>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Spinner /> : null}
            {refreshing ? "Refreshing…" : "Refresh ranking"}
          </Button>
        </div>
      </header>

      {error ? (
        <p className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-900 dark:text-amber-100">
          {error}
        </p>
      ) : null}

      {above.length === 0 && ranking.length > 0 ? (
        <p className="px-4 py-6 text-center text-sm text-emerald-200">
          Nobody in this ranking sits above your alliances. Keep building Prime to stay there.
        </p>
      ) : above.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Kingdom ranking is unavailable. Sync or refresh once the Kingshot API is reachable.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {above.map((row) => {
            const gap = gapLabel(row.power, primePower);
            return (
              <li
                key={`${row.rank}-${row.tag}`}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
              >
                <span className="tabular text-sm font-black text-muted-foreground">#{row.rank}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    [{row.tag}] {row.name}
                  </p>
                  <p className={clsx("text-[11px] font-semibold", gap.className)}>{gap.text}</p>
                </div>
                <p
                  className="tabular text-right text-sm font-black text-foreground"
                  title={formatExactPower(row.power)}
                >
                  {formatPower(row.power)}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/25 bg-primary/10 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
            Your Prime
          </p>
          <p className="text-[11px] text-muted-foreground">
            {primeCount} selected · updates live as boxes are checked
          </p>
        </div>
        <p className="tabular text-lg font-black text-primary" title={formatExactPower(primePower)}>
          {formatPower(primePower)}
        </p>
      </div>

      {retrievedAt ? (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          Ranking updated {formatRelativeTime(retrievedAt, now)}. Alliance totals come from the
          Kingshot board and can lag the game by up to 60 minutes; Prime power is live.
        </p>
      ) : null}
    </Card>
  );
}

export const KingdomLadder = memo(KingdomLadderComponent);
