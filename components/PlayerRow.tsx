"use client";

import { memo } from "react";
import clsx from "clsx";

import { Checkbox } from "@/components/ui/checkbox";
import { SLOT_THEME } from "@/components/ui";
import {
  formatAllianceRankDisplay,
  formatAllianceRole,
  formatCompactAge,
  formatExactPower,
  formatPower,
  formatRelativeTime,
} from "@/lib/roster";
import type { Player } from "@/types/roster";

interface PlayerRowProps {
  player: Player;
  primeRank: number | null;
  disabled: boolean;
  expanded?: boolean;
  now?: number;
  onToggle: (playerId: string, next: boolean) => void;
}

function PlayerRowComponent({
  player,
  primeRank,
  disabled,
  expanded = false,
  now = Date.now(),
  onToggle,
}: PlayerRowProps) {
  const theme = SLOT_THEME[player.allianceSlot];
  const checkboxId = `select-${player.id}`;
  const blocked = disabled && !player.selected;

  return (
    <div
      className={clsx(
        "grid grid-cols-[auto_2.4rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 border-b border-border px-2.5 py-1.5 transition-colors last:border-b-0",
        player.selected ? clsx(theme.bg, "hover:bg-accent") : "hover:bg-accent/60",
        blocked && "opacity-55",
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={player.selected}
        disabled={blocked}
        onCheckedChange={(value) => onToggle(player.id, value === true)}
        aria-label={`${player.selected ? "Remove" : "Add"} ${player.name} — ${
          formatAllianceRankDisplay(player)
        }, power ${formatExactPower(player.power)}${blocked ? " (Prime roster is full)" : ""}`}
      />

      <RankBadge player={player} />

      <label htmlFor={checkboxId} className="min-w-0 cursor-pointer select-none">
        <span className="flex items-center gap-1.5">
          <span
            className={clsx(
              "truncate text-[13px]",
              player.selected ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
            title={player.name}
          >
            {player.name}
          </span>
          {primeRank !== null ? (
            <span
              className="tabular shrink-0 rounded-md border border-primary/40 bg-primary/10 px-1 text-[10px] font-bold text-primary"
              title={`Prime rank ${primeRank}`}
            >
              P{primeRank}
            </span>
          ) : null}
        </span>
        {expanded ? <PlayerDetails player={player} now={now} /> : null}
      </label>

      <span
        className="tabular self-start text-right text-[13px] font-semibold text-foreground"
        title={`${formatExactPower(player.power)} power`}
      >
        {formatPower(player.power)}
      </span>
    </div>
  );
}

function PlayerDetails({ player, now }: { player: Player; now: number }) {
  const hq = player.townCenterLevel;
  const kills = player.kills;
  const lastActive = formatCompactAge(player.lastActiveAt, now);

  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="tabular" title="Town center / HQ level">
        HQ {hq ?? "—"}
      </span>
      <span className="tabular" title={kills === null ? "Kills unknown" : `${formatExactPower(kills)} kills`}>
        {kills === null ? "— kills" : `${formatPower(kills)} kills`}
      </span>
      <span
        className="tabular"
        title={
          player.lastActiveAt
            ? `Last active ${formatRelativeTime(player.lastActiveAt, now)}`
            : "Last active unknown"
        }
      >
        {lastActive === "—" ? "—" : lastActive}
      </span>
    </span>
  );
}

export const PlayerRow = memo(PlayerRowComponent);

const ROLE_CLASS: Record<string, string> = {
  R5: "border-primary/50 bg-primary/15 text-primary",
  R4: "border-violet-400/50 bg-violet-500/15 text-violet-700 dark:text-violet-200",
  R3: "border-sky-400/50 bg-sky-500/15 text-sky-700 dark:text-sky-200",
  R2: "border-border bg-muted text-muted-foreground",
  R1: "border-border bg-muted/60 text-muted-foreground",
};

function RankBadge({ player }: { player: Player }) {
  const role = formatAllianceRole(player);
  if (role) {
    return (
      <span
        className={clsx(
          "tabular inline-flex min-w-[2rem] justify-center rounded-md border px-1 py-px text-[10px] font-black tracking-wide",
          ROLE_CLASS[role] ?? "border-border text-muted-foreground",
        )}
        title={`Alliance rank ${role}`}
      >
        {role}
      </span>
    );
  }
  return (
    <span className="tabular text-right text-xs text-muted-foreground" title="Roster position">
      {formatAllianceRankDisplay(player)}
    </span>
  );
}
