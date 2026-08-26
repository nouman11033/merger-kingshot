import { errorResponse } from "@/lib/http";
import { getKingdomAllianceRanks } from "@/lib/kingshot";
import { HOME_KINGDOM_ID, TOP_ALLIANCE_LIMIT } from "@/types/roster";

export const dynamic = "force-dynamic";

/**
 * Top 10 alliances in kingdom 2362 by alliance power.
 * The kingdom is fixed on the server — the browser cannot request another one.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ranking = await getKingdomAllianceRanks(HOME_KINGDOM_ID, {
      force: url.searchParams.get("force") === "1",
      limit: TOP_ALLIANCE_LIMIT,
    });
    return Response.json({ ok: true, ...ranking });
  } catch (error) {
    return errorResponse(error);
  }
}
