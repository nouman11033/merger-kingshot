import { notFound } from "next/navigation";

import { MergePlanner } from "@/components/MergePlanner";
import { ToastProvider } from "@/components/Toaster";
import { Alert } from "@/components/ui";
import { getKingdomAllianceRanks, isKingshotApiConfigured, KingshotApiError } from "@/lib/kingshot";
import { getSnapshot } from "@/lib/sessions";
import { getSupabaseConfig } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { HOME_KINGDOM_ID, TOP_ALLIANCE_LIMIT, type KingdomAllianceRank } from "@/types/roster";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return { title: "Kingshot Merge Planner" };
  try {
    const { id } = await params;
    const snapshot = await getSnapshot(id);
    return { title: snapshot ? `${snapshot.session.name} · Merge Planner` : "Kingshot Merge Planner" };
  } catch {
    return { title: "Kingshot Merge Planner" };
  }
}

async function loadRanking(): Promise<{
  alliances: KingdomAllianceRank[];
  retrievedAt: string | null;
}> {
  if (!isKingshotApiConfigured()) return { alliances: [], retrievedAt: null };
  try {
    const ranking = await getKingdomAllianceRanks(HOME_KINGDOM_ID, { limit: TOP_ALLIANCE_LIMIT });
    return { alliances: ranking.alliances, retrievedAt: ranking.retrievedAt };
  } catch (error) {
    if (error instanceof KingshotApiError) {
      return { alliances: [], retrievedAt: null };
    }
    return { alliances: [], retrievedAt: null };
  }
}

export default async function MergePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Alert tone="error" title="Supabase is not configured">
          Set the Supabase environment variables and run the migration in{" "}
          <code className="font-mono">supabase/migrations</code>, then reload this page.
        </Alert>
      </main>
    );
  }

  const [snapshot, ranking] = await Promise.all([getSnapshot(id), loadRanking()]);
  if (!snapshot) notFound();

  // Realtime needs the public anon credentials in the browser.
  const realtimeReady = getSupabaseConfig() !== null;

  return (
    <ToastProvider>
      <main>
        {!realtimeReady ? (
          <div className="mx-auto max-w-[1600px] px-4 pt-5 sm:px-6">
            <Alert tone="warning" title="Realtime collaboration is disabled">
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> must be set for live
              selection sharing.
            </Alert>
          </div>
        ) : null}
        <MergePlanner
          snapshot={snapshot}
          apiConfigured={isKingshotApiConfigured()}
          initialRanking={ranking.alliances}
          rankingRetrievedAt={ranking.retrievedAt}
        />
      </main>
    </ToastProvider>
  );
}
