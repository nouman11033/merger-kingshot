import { errorResponse } from "@/lib/http";
import { inspectAllianceResponse, isKingshotApiConfigured } from "@/lib/kingshot";
import { isSupabaseConfigured, hasServiceRoleKey } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Configuration and API-shape diagnostics.
 *
 * GET /api/kingshot/health                       -> configuration report
 * GET /api/kingshot/health?kingdomId=1&tag=ABC   -> live response structure
 *
 * Only structural information and a small normalized sample are returned; the
 * API key itself is never included in the response.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kingdomId = url.searchParams.get("kingdomId") ?? url.searchParams.get("kid");
  const tag = url.searchParams.get("tag") ?? url.searchParams.get("allianceTag");

  const config = {
    kingshotApiKey: isKingshotApiConfigured(),
    supabase: isSupabaseConfigured(),
    supabaseServiceRole: hasServiceRoleKey(),
    kingshotBaseUrl: process.env.KINGSHOT_API_BASE_URL?.trim() || "https://api.kingshotstats.com/v1",
  };

  if (!kingdomId || !tag) {
    return Response.json({
      ok: true,
      config,
      hint: "Add ?kingdomId=1234&tag=ABC to inspect the live Kingshot API response shape.",
    });
  }

  try {
    const inspection = await inspectAllianceResponse(kingdomId, tag);
    return Response.json({ ok: true, config, inspection });
  } catch (error) {
    return errorResponse(error);
  }
}
