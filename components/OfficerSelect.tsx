"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface OfficerSelectProps {
  id: string;
  total: number;
  selected: number;
  busy?: boolean;
  compact?: boolean;
  onChange: (next: boolean) => void;
}

/**
 * One checkbox that selects or deselects every R4 and R5 in scope.
 * Indeterminate when only some officers are already in Prime.
 */
export function OfficerSelect({
  id,
  total,
  selected,
  busy = false,
  compact = false,
  onChange,
}: OfficerSelectProps) {
  const allSelected = total > 0 && selected >= total;
  const someSelected = selected > 0 && selected < total;
  const disabled = total === 0 || busy;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl border px-2.5 py-1.5 transition-colors",
        disabled
          ? "cursor-not-allowed border-border text-muted-foreground"
          : allSelected
            ? "cursor-pointer border-primary/40 bg-primary/10 text-primary"
            : "cursor-pointer border-border text-foreground hover:bg-accent",
      )}
    >
      <Checkbox
        id={id}
        checked={someSelected ? "indeterminate" : allSelected}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className={cn("font-semibold", compact ? "text-[11px]" : "text-xs")}>
        {compact ? "R4 & R5" : "Select all R4 & R5"}
        <span className="ml-1.5 tabular font-normal text-muted-foreground">
          {total === 0 ? "none found" : `${selected}/${total}`}
        </span>
      </span>
    </label>
  );
}
