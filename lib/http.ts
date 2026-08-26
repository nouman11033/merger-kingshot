import "server-only";

import { KingshotApiError } from "@/lib/kingshot";
import { AppError } from "@/lib/sessions";

/** Turns internal errors into safe JSON responses. Never leaks credentials. */
export function errorResponse(error: unknown): Response {
  if (error instanceof KingshotApiError) {
    // Upstream 5xx becomes 502 (bad gateway) so clients know to retry, but a
    // missing key is our own misconfiguration and stays a plain 500.
    const status =
      error.code === "missing_server_api_key" ? 500 : error.status >= 500 ? 502 : error.status;
    const headers = error.retryAfterSeconds
      ? { "Retry-After": String(error.retryAfterSeconds) }
      : undefined;
    return Response.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        retryAfterSeconds: error.retryAfterSeconds,
        source: "kingshot",
      },
      { status, headers },
    );
  }

  if (error instanceof AppError) {
    return Response.json({ ok: false, error: error.message, source: "app" }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error("[kingshot-merge-planner]", error);
  return Response.json({ ok: false, error: message, source: "server" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError("Request body must be valid JSON.", 400);
  }
}

export function parseMergeSize(value: unknown): 2 | 3 {
  const numeric = typeof value === "number" ? value : Number(value);
  if (numeric !== 2 && numeric !== 3) {
    throw new AppError("Merge size must be 2 or 3.", 400);
  }
  return numeric;
}
