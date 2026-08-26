"use client";

import { memo } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui";

interface SearchBarProps {
  value: string;
  matchCount: number;
  onChange: (value: string) => void;
}

function SearchBarComponent({ value, matchCount, onChange }: SearchBarProps) {
  return (
    <div className="relative flex-1 sm:max-w-md">
      <label htmlFor="player-search" className="sr-only">
        Search players by name
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="player-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search players across all alliances…"
        className="pr-20 pl-9"
        autoComplete="off"
      />
      {value.trim() ? (
        <span
          className="tabular pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          {matchCount} match{matchCount === 1 ? "" : "es"}
        </span>
      ) : null}
    </div>
  );
}

export const SearchBar = memo(SearchBarComponent);
