"use client";

import { memo } from "react";
import clsx from "clsx";

import { Badge, Button, Card, SLOT_THEME } from "@/components/ui";
import {
  formatAllianceRankDisplay,
  formatCompactAge,
  formatExactPower,
  formatPower,
  formatRelativeTime,
} from "@/lib/roster";
import type { PrimeEntry, PrimeStats } from "@/types/roster";

interface PrimeRosterProps {
  prime: PrimeEntry[];
  visiblePrime: PrimeEntry[];
  stats: PrimeStats;
  filtersActive: boolean;
  expanded?: boolean;
  now?: number;
  onToggle: (playerId: string, next: boolean) => void;
  onToggleDetails?: () => void;
  onExportCsv: () => void;
  onCopy: () => void;
  onClear: () => void;
}

function PrimeRosterComponent({
  prime,
  visiblePrime,
  stats,
  filtersActive,
  expanded = false,
  now = Date.now(),
  onToggle,
  onToggleDetails,
  onExportCsv,
  onCopy,
  onClear,
}: PrimeRosterProps) {
  const hidden = prime.length - visiblePrime.length;

  return (
    <Card className="overflow-hidden border-primary/25">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-base font-black tracking-[0.18em] text-primary uppercase">
            Prime Roster
          </h2>
          <Badge
            className={clsx(
              "border-primary/40 bg-primary/10 text-primary",
              stats.isFull && "border-amber-400 bg-amber-400/20 text-amber-800 dark:text-amber-200",
            )}
          >
            <span className="tabular">
              {stats.primeCount} / {stats.primeLimit}
            </span>
          </Badge>
          {stats.isFull ? (
            <span className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
              Full
            </span>
          ) : (
            <span className="tabular text-[11px] text-muted-foreground">
              {stats.remainingSlots} slot{stats.remainingSlots === 1 ? "" : "s"} left
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onToggleDetails ? (
            <Button
              size="sm"
              variant={expanded ? "primary" : "secondary"}
              aria-pressed={expanded}
              onClick={onToggleDetails}
            >
              {expanded ? "Hide details" : "Show details"}
            </Button>
          ) : null}
          <Button size="sm" onClick={onExportCsv} disabled={prime.length === 0}>
            Export Prime CSV
          </Button>
          <Button size="sm" onClick={onCopy} disabled={prime.length === 0}>
            Copy to Clipboard
          </Button>
          <Button size="sm" variant="danger" onClick={onClear} disabled={prime.length === 0}>
            Clear Prime Selection
          </Button>
        </div>
      </header>

      {stats.isFull ? (
        <p
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-900 dark:text-amber-100"
          role="status"
        >
          Prime roster is full ({stats.primeCount}/{stats.primeLimit}). Uncheck a player before
          selecting another.
        </p>
      ) : null}

      <div className="max-h-[26rem] overflow-y-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              <th scope="col" className="w-16 px-4 py-2 font-semibold">
                Prime #
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                Player
              </th>
              <th scope="col" className="w-28 px-2 py-2 text-right font-semibold">
                Power
              </th>
              {expanded ? (
                <>
                  <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                    HQ
                  </th>
                  <th scope="col" className="w-20 px-2 py-2 text-right font-semibold">
                    Kills
                  </th>
                  <th scope="col" className="w-20 px-2 py-2 text-right font-semibold">
                    Active
                  </th>
                </>
              ) : null}
              <th scope="col" className="w-44 px-2 py-2 font-semibold">
                Alliance
              </th>
              <th scope="col" className="w-24 px-2 py-2 text-right font-semibold">
                Role
              </th>
              <th scope="col" className="w-20 px-4 py-2 text-right font-semibold">
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {visiblePrime.length === 0 ? (
              <tr>
                <td colSpan={expanded ? 9 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {prime.length === 0
                    ? "No players selected yet. Tick players in the alliance rosters below to build Prime."
                    : "No Prime players match the current filters."}
                </td>
              </tr>
            ) : (
              visiblePrime.map(({ primeRank, player }) => {
                const theme = SLOT_THEME[player.allianceSlot];
                return (
                  <tr
                    key={player.id}
                    className="animate-row-enter border-t border-border hover:bg-accent/60"
                  >
                    <td className="tabular px-4 py-1.5 text-[13px] font-bold text-primary">
                      #{primeRank}
                    </td>
                    <td className="max-w-0 px-2 py-1.5">
                      <span className="block truncate text-[13px] font-semibold text-foreground" title={player.name}>
                        {player.name}
                      </span>
                    </td>
                    <td
                      className="tabular px-2 py-1.5 text-right text-[13px] font-semibold text-foreground"
                      title={`${formatExactPower(player.power)} power`}
                    >
                      {formatPower(player.power)}
                    </td>
                    {expanded ? (
                      <>
                        <td
                          className="tabular px-2 py-1.5 text-right text-[13px] text-foreground"
                          title="Town center / HQ level"
                        >
                          {player.townCenterLevel ?? "—"}
                        </td>
                        <td
                          className="tabular px-2 py-1.5 text-right text-[13px] text-foreground"
                          title={
                            player.kills === null ? "Kills unknown" : `${formatExactPower(player.kills)} kills`
                          }
                        >
                          {player.kills === null ? "—" : formatPower(player.kills)}
                        </td>
                        <td
                          className="tabular px-2 py-1.5 text-right text-[13px] text-foreground"
                          title={
                            player.lastActiveAt
                              ? `Last active ${formatRelativeTime(player.lastActiveAt, now)}`
                              : "Last active unknown"
                          }
                        >
                          {formatCompactAge(player.lastActiveAt, now)}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2 py-1.5">
                      <span className={clsx("flex items-center gap-1.5 text-xs", theme.text)}>
                        <span className={clsx("size-1.5 shrink-0 rounded-full", theme.dot)} aria-hidden="true" />
                        <span className="truncate" title={`${theme.label}: ${player.allianceName}`}>
                          [{player.allianceTag}] {player.allianceName}
                        </span>
                      </span>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-[13px] font-semibold text-foreground">
                      {formatAllianceRankDisplay(player)}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => onToggle(player.id, false)}
                        className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
                        aria-label={`Remove ${player.name} from Prime`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtersActive && hidden > 0 ? (
        <p className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          {hidden} selected player{hidden === 1 ? "" : "s"} hidden by the active filters. Prime ranks
          always reflect the full roster.
        </p>
      ) : null}
    </Card>
  );
}

export const PrimeRoster = memo(PrimeRosterComponent);
