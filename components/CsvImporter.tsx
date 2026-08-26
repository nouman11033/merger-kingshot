"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";

import { Alert, Badge, Button, Card, SLOT_THEME, Spinner } from "@/components/ui";
import { parseCsvFile } from "@/lib/csvParser";
import { formatPower } from "@/lib/roster";
import type { AllianceSlot, CsvImportPayload, CsvParseResult } from "@/types/roster";

export interface CsvSlot {
  slotNumber: AllianceSlot;
  kingdomId: string;
  allianceTag: string;
  allianceName?: string;
}

interface CsvImporterProps {
  slots: CsvSlot[];
  busy?: boolean;
  requireAll?: boolean;
  submitLabel?: string;
  onImport: (payloads: CsvImportPayload[]) => void | Promise<void>;
}

/**
 * CSV fallback. Columns are auto-detected (never hardcoded) and previewed
 * before anything is written, then mapped into the same player model the
 * Kingshot API path produces.
 */
export function CsvImporter({
  slots,
  busy = false,
  requireAll = false,
  submitLabel = "Import CSV rosters",
  onImport,
}: CsvImporterProps) {
  const [parsed, setParsed] = useState<Record<number, CsvParseResult | null>>({});
  const [parsing, setParsing] = useState<number | null>(null);

  const handleFile = useCallback(
    async (slot: CsvSlot, file: File | undefined) => {
      if (!file) {
        setParsed((current) => ({ ...current, [slot.slotNumber]: null }));
        return;
      }
      setParsing(slot.slotNumber);
      const result = await parseCsvFile(file, slot.kingdomId);
      setParsed((current) => ({ ...current, [slot.slotNumber]: result }));
      setParsing(null);
    },
    [],
  );

  const ready = slots.filter((slot) => {
    const result = parsed[slot.slotNumber];
    return result && result.rows.length > 0;
  });

  const canSubmit =
    !busy && ready.length > 0 && (!requireAll || ready.length === slots.length);

  const submit = async () => {
    const payloads: CsvImportPayload[] = ready.map((slot) => ({
      slotNumber: slot.slotNumber,
      kingdomId: slot.kingdomId,
      allianceTag: slot.allianceTag,
      allianceName: slot.allianceName || slot.allianceTag,
      members: parsed[slot.slotNumber]!.rows,
    }));
    await onImport(payloads);
  };

  return (
    <div className="flex flex-col gap-3">
      {slots.map((slot) => {
        const theme = SLOT_THEME[slot.slotNumber];
        const result = parsed[slot.slotNumber];
        const inputId = `csv-slot-${slot.slotNumber}`;

        return (
          <Card key={slot.slotNumber} className={clsx("p-3", theme.border)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={clsx("size-1.5 rounded-full", theme.dot)} aria-hidden="true" />
                <span className={clsx("text-xs font-bold uppercase tracking-wide", theme.text)}>
                  {theme.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {slot.allianceTag ? `[${slot.allianceTag}]` : "tag not set"}
                  {slot.kingdomId ? ` · Kingdom ${slot.kingdomId}` : ""}
                </span>
              </div>
              {parsing === slot.slotNumber ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Spinner /> Parsing…
                </span>
              ) : null}
            </div>

            <div className="mt-2">
              <label htmlFor={inputId} className="sr-only">
                CSV file for {theme.label}
              </label>
              <input
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void handleFile(slot, event.target.files?.[0])}
                className="w-full cursor-pointer rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-foreground hover:border-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>

            {result ? (
              <div className="mt-2.5 flex flex-col gap-2">
                {result.errors.length > 0 ? (
                  <Alert tone={result.rows.length > 0 ? "warning" : "error"}>
                    <ul className="list-inside list-disc space-y-0.5">
                      {result.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge className="border-border bg-muted text-muted-foreground">
                    {result.rows.length} players
                  </Badge>
                  <Badge
                    className={
                      result.mapping.name
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-red-500/40 bg-red-500/10 text-red-200"
                    }
                  >
                    Name → {result.mapping.name ?? "not found"}
                  </Badge>
                  <Badge
                    className={
                      result.mapping.power
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-red-500/40 bg-red-500/10 text-red-200"
                    }
                  >
                    Power → {result.mapping.power ?? "not found"}
                  </Badge>
                  <Badge
                    className={
                      result.mapping.rank
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    }
                  >
                    Rank → {result.mapping.rank ?? "derived from power"}
                  </Badge>
                  <Badge
                    className={
                      result.mapping.id
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    }
                  >
                    Player ID → {result.mapping.id ?? "generated from name"}
                  </Badge>
                  {result.skippedRows > 0 ? (
                    <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                      {result.skippedRows} rows skipped
                    </Badge>
                  ) : null}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Detected columns: {result.headers.join(", ") || "none"}
                </p>

                {result.previewRows.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-2 py-1 font-semibold">Rank</th>
                          <th scope="col" className="px-2 py-1 font-semibold">Player</th>
                          <th scope="col" className="px-2 py-1 text-right font-semibold">Power</th>
                          <th scope="col" className="px-2 py-1 font-semibold">Player ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.previewRows.map((row) => (
                          <tr key={row.externalId} className="border-t border-border">
                            <td className="tabular px-2 py-1 text-muted-foreground">#{row.allianceRank ?? "?"}</td>
                            <td className="px-2 py-1 text-foreground">{row.name}</td>
                            <td className="tabular px-2 py-1 text-right text-foreground">
                              {formatPower(row.power)}
                            </td>
                            <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                              {row.externalId}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.rows.length > result.previewRows.length ? (
                      <p className="border-t border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                        Preview of the first {result.previewRows.length} of {result.rows.length} rows.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} aria-busy={busy}>
          {busy ? <Spinner /> : null}
          {submitLabel}
          {ready.length > 0 ? ` (${ready.length})` : ""}
        </Button>
        {requireAll && ready.length > 0 && ready.length < slots.length ? (
          <p className="text-xs text-amber-300">
            Upload a CSV for all {slots.length} alliances to continue.
          </p>
        ) : null}
      </div>
    </div>
  );
}
