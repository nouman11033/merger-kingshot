"use client";

import { memo } from "react";
import clsx from "clsx";

import { OfficerSelect } from "@/components/OfficerSelect";
import { PlayerRow } from "@/components/PlayerRow";
import { Badge, Button, Card, SLOT_THEME } from "@/components/ui";
import { formatPower, formatRelativeTime } from "@/lib/roster";
import type { Alliance, Player } from "@/types/roster";

interface AllianceRosterProps {
  alliance: Alliance;
  players: Player[];
  totalPlayers: number;
  selectedCount: number;
  officerTotal: number;
  officerSelected: number;
  officerBusy: boolean;
  primeRanks: Map<string, number>;
  primeFull: boolean;
  now: number;
  expanded?: boolean;
  onToggle: (playerId: string, next: boolean) => void;
  onToggleOfficers: (next: boolean) => void;
  onClear: () => void;
}

/** One alliance column: always sorted by Alliance Rank ascending. */
function AllianceRosterComponent({
  alliance,
  players,
  totalPlayers,
  selectedCount,
  officerTotal,
  officerSelected,
  officerBusy,
  primeRanks,
  primeFull,
  now,
  expanded = false,
  onToggle,
  onToggleOfficers,
  onClear,
}: AllianceRosterProps) {
  const theme = SLOT_THEME[alliance.slotNumber];
  const hiddenByFilters = totalPlayers - players.length;
  const listPower = players.reduce((sum, player) => sum + player.power, 0);

  return (
    <Card className="flex flex-col overflow-hidden">
      <header
        className={clsx(
          "border-b border-border bg-card/95 px-3 py-2.5",
          theme.border,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              <span className={clsx("size-1.5 rounded-full", theme.dot)} aria-hidden="true" />
              {theme.label}
            </p>
            <h3 className={clsx("truncate text-sm font-bold", theme.text)} title={alliance.allianceName}>
              [{alliance.allianceTag}] {alliance.allianceName}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Kingdom {alliance.kingdomId} · {alliance.source === "csv" ? "CSV import" : "Kingshot API"} ·
              synced {formatRelativeTime(alliance.lastSyncedAt, now)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge className={clsx(theme.border, theme.bg, theme.text)}>
              {selectedCount} selected
            </Badge>
            <p className="tabular text-[11px] text-muted-foreground">{totalPlayers} members</p>
            <OfficerSelect
              id={`officers-${alliance.id}`}
              total={officerTotal}
              selected={officerSelected}
              busy={officerBusy}
              compact
              onChange={onToggleOfficers}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={selectedCount === 0 || officerBusy}
            >
              Clear all
            </Button>
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <span>
          Role · Player{expanded ? " · HQ · Kills · Active" : ""}
          {hiddenByFilters > 0 ? (
            <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/80">
              ({hiddenByFilters} hidden by filters)
            </span>
          ) : null}
        </span>
        <span>{formatPower(listPower)}</span>
      </div>

      <div role="list">
        {players.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {totalPlayers === 0
              ? "No roster loaded for this alliance yet. Use SYNC ROSTERS or import a CSV."
              : "No players match the current filters."}
          </p>
        ) : (
          players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              primeRank={primeRanks.get(player.id) ?? null}
              disabled={primeFull}
              expanded={expanded}
              now={now}
              onToggle={onToggle}
            />
          ))
        )}
      </div>
    </Card>
  );
}

export const AllianceRoster = memo(AllianceRosterComponent);
