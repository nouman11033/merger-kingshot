"use client";

import { memo, useState } from "react";
import clsx from "clsx";

import { Button, Input, SLOT_THEME } from "@/components/ui";
import { toNumber } from "@/lib/coerce";
import { formatPower } from "@/lib/roster";
import type { AllianceFilter, MergeSize, RosterFilters, SelectionFilter } from "@/types/roster";

interface FilterBarProps {
  filters: RosterFilters;
  mergeSize: MergeSize;
  filtersActive: boolean;
  onChange: (patch: Partial<RosterFilters>) => void;
  onReset: () => void;
}

function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-2xl border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? clsx("border-current bg-accent text-foreground", className)
          : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Power inputs accept plain numbers and shorthand such as 25m or 1.2b. */
function PowerInput({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (next: number | null) => void;
}) {
  // Keeps the raw text the user typed ("25m") while reporting a parsed number.
  // Remounted via `key` when filters are reset, so no sync effect is needed.
  const [text, setText] = useState(value === null ? "" : String(value));

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      onCommit(null);
      return;
    }
    const parsed = toNumber(trimmed);
    onCommit(parsed !== null && parsed >= 0 ? parsed : null);
  };

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          commit(event.target.value);
        }}
        placeholder="e.g. 25M"
        className="tabular h-8 w-24 px-2 py-1 text-xs"
        aria-describedby={value !== null ? `${id}-parsed` : undefined}
      />
      {value !== null ? (
        <span id={`${id}-parsed`} className="text-[10px] text-muted-foreground">
          = {formatPower(value)}
        </span>
      ) : null}
    </div>
  );
}

function FilterBarComponent({ filters, mergeSize, filtersActive, onChange, onReset }: FilterBarProps) {
  const [resetKey, setResetKey] = useState(0);
  const allianceOptions: AllianceFilter[] = ["all", 1, 2, ...(mergeSize === 3 ? ([3] as const) : [])];
  const selectionOptions: SelectionFilter[] = ["all", "selected", "unselected"];

  const handleReset = () => {
    setResetKey((current) => current + 1);
    onReset();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by alliance">
        {allianceOptions.map((option) => (
          <Chip
            key={String(option)}
            active={filters.alliance === option}
            onClick={() => onChange({ alliance: option })}
            className={option === "all" ? undefined : SLOT_THEME[option].text}
          >
            {option === "all" ? "All alliances" : SLOT_THEME[option].label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by selection">
        {selectionOptions.map((option) => (
          <Chip
            key={option}
            active={filters.selection === option}
            onClick={() => onChange({ selection: option })}
          >
            {option === "all" ? "All players" : option === "selected" ? "Selected" : "Unselected"}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PowerInput
          key={`min-${resetKey}`}
          id="min-power"
          label="Min power"
          value={filters.minPower}
          onCommit={(next) => onChange({ minPower: next })}
        />
        <PowerInput
          key={`max-${resetKey}`}
          id="max-power"
          label="Max power"
          value={filters.maxPower}
          onCommit={(next) => onChange({ maxPower: next })}
        />
      </div>

      {filtersActive ? (
        <Button size="sm" variant="ghost" onClick={handleReset}>
          Reset filters
        </Button>
      ) : null}
    </div>
  );
}

export const FilterBar = memo(FilterBarComponent);
