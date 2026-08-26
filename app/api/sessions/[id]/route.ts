import { errorResponse } from "@/lib/http";
import { AppError, getSnapshot } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/** Full snapshot for a session (used for the first paint and manual reloads). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const snapshot = await getSnapshot(id);
    if (!snapshot) throw new AppError("Merge session not found.", 404);
    return Response.json({ ok: true, ...snapshot });
  } catch (error) {
    return errorResponse(error);
  }
}
