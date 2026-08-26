"use client";

import { memo } from "react";

import { Button, Spinner } from "@/components/ui";
import type { SyncStatus } from "@/types/roster";

interface SyncButtonProps {
  status: SyncStatus;
  disabled?: boolean;
  /** Explains why the action is unavailable, shown as the tooltip. */
  disabledReason?: string;
  onSync: () => void;
}

function SyncButtonComponent({ status, disabled, disabledReason, onSync }: SyncButtonProps) {
  const syncing = status === "syncing";

  return (
    <Button
      variant="primary"
      onClick={onSync}
      disabled={syncing || disabled}
      aria-busy={syncing}
      title={
        disabled && disabledReason
          ? disabledReason
          : "Re-fetch every alliance roster from the Kingshot Stats API"
      }
    >
      {syncing ? <Spinner /> : (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
          <path
            d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 4v3.2h-3.2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {syncing ? "Syncing…" : "Sync Rosters"}
    </Button>
  );
}

export const SyncButton = memo(SyncButtonComponent);
