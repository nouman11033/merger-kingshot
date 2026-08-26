"use client";

import { memo } from "react";
import clsx from "clsx";

import { Card, SLOT_THEME } from "@/components/ui";
import { formatExactPower, formatPower } from "@/lib/roster";
import type { PrimeStats } from "@/types/roster";

function Stat({
  label,
  value,
  sub,
  title,
  accent,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
  accent?: string;
  dot?: string;
}) {
  return (
    <Card className="w-[calc(50%-0.3125rem)] min-w-[9.5rem] max-w-[13rem] flex-none items-center px-3.5 py-2.5 text-center sm:w-[11.5rem]">
      <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {dot ? <span className={clsx("size-1.5 rounded-full", dot)} aria-hidden="true" /> : null}
        {label}
      </p>
      <p
        className={clsx("tabular mt-0.5 text-xl font-black leading-tight", accent ?? "text-foreground")}
        title={title}
      >
        {value}
      </p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

/** Prime totals plus per-alliance selected counts (only for configured slots). */
function StatsBarComponent({ stats }: { stats: PrimeStats }) {
  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      <Stat
        label="Prime"
        value={`${stats.primeCount} / ${stats.primeLimit}`}
        sub={stats.isFull ? "Roster full" : `${stats.remainingSlots} slots remaining`}
        accent="text-primary"
      />
      <Stat
        label="Total Power"
        value={formatPower(stats.totalPower)}
        sub="Selected players"
        title={formatExactPower(stats.totalPower)}
      />
      <Stat
        label="Not selected"
        value={formatPower(stats.unselectedPower)}
        sub="Players outside Prime"
        title={formatExactPower(stats.unselectedPower)}
      />
      <Stat
        label="Average Power"
        value={formatPower(stats.averagePower)}
        sub="Per Prime member"
        title={formatExactPower(stats.averagePower)}
      />
      {stats.allianceStats.map((alliance) => {
        const theme = SLOT_THEME[alliance.slotNumber];
        return (
          <Stat
            key={alliance.slotNumber}
            label={`${theme.label} · ${alliance.allianceTag}`}
            value={`${alliance.selectedCount} selected`}
            sub={`${formatPower(alliance.unselectedPower)} not selected`}
            title={`${alliance.selectedCount} of ${alliance.totalPlayers} members · ${formatExactPower(alliance.unselectedPower)} outside Prime`}
            accent={theme.text}
            dot={theme.dot}
          />
        );
      })}
    </div>
  );
}

export const StatsBar = memo(StatsBarComponent);
