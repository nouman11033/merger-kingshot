import { errorResponse, readJson } from "@/lib/http";
import { AppError, getSnapshot, importCsvRoster } from "@/lib/sessions";
import type { CsvImportPayload } from "@/types/roster";

export const dynamic = "force-dynamic";

interface ImportRequest {
  imports?: CsvImportPayload[];
}

/** CSV fallback import. Feeds the same tables and model as the API sync. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<ImportRequest>(request);

    const imports = body.imports ?? [];
    if (imports.length === 0) throw new AppError("No CSV rosters were supplied.", 400);

    const reports = [];
    for (const payload of imports) {
      reports.push(await importCsvRoster(id, payload));
    }

    const snapshot = await getSnapshot(id);
    if (!snapshot) throw new AppError("Merge session not found.", 404);

    return Response.json({ ok: true, reports, ...snapshot });
  } catch (error) {
    return errorResponse(error);
  }
}
