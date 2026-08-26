import { errorResponse, parseMergeSize, readJson } from "@/lib/http";
import { createSession, listSessions } from "@/lib/sessions";
import type { AllianceInput } from "@/types/roster";

export const dynamic = "force-dynamic";

interface CreateSessionRequest {
  name?: string;
  mergeSize?: number;
  alliances?: AllianceInput[];
  source?: "api" | "csv";
}

export async function GET() {
  try {
    return Response.json({ ok: true, sessions: await listSessions() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<CreateSessionRequest>(request);
    const mergeSize = parseMergeSize(body.mergeSize);

    const { session, reports } = await createSession({
      name: body.name,
      mergeSize,
      alliances: body.alliances ?? [],
      source: body.source === "csv" ? "csv" : "api",
    });

    return Response.json({ ok: true, session, reports }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
