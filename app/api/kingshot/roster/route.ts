import { errorResponse, readJson } from "@/lib/http";
import { getAllianceRoster } from "@/lib/kingshot";
import { AppError } from "@/lib/sessions";
import type { AllianceInput } from "@/types/roster";

export const dynamic = "force-dynamic";

interface RosterRequest {
  alliances?: AllianceInput[];
  kingdomId?: string;
  allianceTag?: string;
  /** Set by SYNC-style callers that need the freshest data the API allows. */
  force?: boolean;
}

/**
 * Roster preview. The Kingshot API key stays on the server: the browser only
 * ever talks to this route, and only normalized data comes back.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson<RosterRequest>(request);

    const requested: AllianceInput[] = body.alliances?.length
      ? body.alliances
      : body.kingdomId && body.allianceTag
        ? [{ slotNumber: 1, kingdomId: body.kingdomId, allianceTag: body.allianceTag }]
        : [];

    if (requested.length === 0) throw new AppError("Provide at least one alliance to fetch.", 400);
    if (requested.length > 3) throw new AppError("A merge supports at most 3 alliances.", 400);

    const results = [];
    for (const [index, alliance] of requested.entries()) {
      const kingdomId = String(alliance.kingdomId ?? "").trim();
      const allianceTag = String(alliance.allianceTag ?? "").trim();
      const slotNumber = alliance.slotNumber ?? ((index + 1) as 1 | 2 | 3);

      const roster = await getAllianceRoster(kingdomId, allianceTag, { force: body.force === true });
      results.push({
        slotNumber,
        kingdomId,
        allianceTag,
        allianceName: roster.info.name,
        leaderName: roster.info.leaderName,
        alliancePower: roster.info.power,
        memberCount: roster.members.length,
        reportedMemberCount: roster.info.memberCount,
        totalPower: roster.members.reduce((sum, member) => sum + member.power, 0),
        fresh: roster.fresh,
        cachedAt: roster.cachedAt,
        ageSeconds: roster.ageSeconds,
        retrievedAt: roster.retrievedAt,
        servedFromServerCache: roster.fromCache,
        warnings: roster.warnings,
        topMembers: roster.members
          .slice()
          .sort((a, b) => b.power - a.power)
          .slice(0, 5)
          .map((member) => ({ name: member.name, power: member.power, rank: member.allianceRank })),
      });
    }

    return Response.json({ ok: true, alliances: results });
  } catch (error) {
    return errorResponse(error);
  }
}
