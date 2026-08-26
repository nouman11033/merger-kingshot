import { errorResponse } from "@/lib/http";
import { clearSelections } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * Clears Prime for this session only. The resulting row updates travel over
 * Realtime, so every connected client empties Prime without refreshing.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const cleared = await clearSelections(id);
    return Response.json({ ok: true, cleared });
  } catch (error) {
    return errorResponse(error);
  }
}
