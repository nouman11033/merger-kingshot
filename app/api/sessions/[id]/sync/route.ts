import { errorResponse } from "@/lib/http";
import { AppError, getSnapshot, syncSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/** SYNC ROSTERS — refetches the Kingshot API and upserts every alliance. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    const reports = await syncSession(id);
    const snapshot = await getSnapshot(id);
    if (!snapshot) throw new AppError("Merge session not found.", 404);

    return Response.json({ ok: true, reports, ...snapshot });
  } catch (error) {
    return errorResponse(error);
  }
}
