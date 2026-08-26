import { MergeSetup } from "@/components/MergeSetup";
import { ToastProvider } from "@/components/Toaster";
import { Alert, Badge } from "@/components/ui";
import { getKingdomAllianceRanks, isKingshotApiConfigured, KingshotApiError } from "@/lib/kingshot";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { HOME_KINGDOM_ID, TOP_ALLIANCE_LIMIT, type KingdomAllianceRank } from "@/types/roster";

export const dynamic = "force-dynamic";

async function loadRanking(): Promise<{
  alliances: KingdomAllianceRank[];
  error: { message: string; code: string | null; retryAfterSeconds: number | null } | null;
  retrievedAt: string | null;
}> {
  if (!isKingshotApiConfigured()) {
    return { alliances: [], error: null, retrievedAt: null };
  }
  try {
    const ranking = await getKingdomAllianceRanks(HOME_KINGDOM_ID, { limit: TOP_ALLIANCE_LIMIT });
    return { alliances: ranking.alliances, error: null, retrievedAt: ranking.retrievedAt };
  } catch (error) {
    if (error instanceof KingshotApiError) {
      return {
        alliances: [],
        error: {
          message: error.message,
          code: error.code,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        retrievedAt: null,
      };
    }
    return {
      alliances: [],
      error: {
        message: error instanceof Error ? error.message : "Could not load kingdom rankings.",
        code: null,
        retryAfterSeconds: null,
      },
      retrievedAt: null,
    };
  }
}

export default async function HomePage() {
  const apiConfigured = isKingshotApiConfigured();
  const ranking = await loadRanking();
  const supabaseReady = isSupabaseConfigured();

  return (
    <ToastProvider>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-primary/40 bg-primary/10 text-primary">
              Alliance merge tooling
            </Badge>
            <Badge>{apiConfigured ? "Kingshot API connected" : "CSV mode"}</Badge>
          </div>
          <h1 className="font-heading text-3xl font-black tracking-[0.12em] text-foreground uppercase sm:text-4xl">
            Kingshot Merge Planner
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Kingdom {HOME_KINGDOM_ID} merge planner. Pick 2 or 3 alliances from the top 10, then
            build a shared 100-player Prime roster in realtime.
          </p>
        </header>

        {!supabaseReady ? (
          <Alert tone="error" title="Setup required">
            Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
            and SUPABASE_SERVICE_ROLE_KEY in .env.local, then run the migration in
            supabase/migrations.
          </Alert>
        ) : null}

        <MergeSetup
          apiConfigured={apiConfigured}
          initialRanking={ranking.alliances}
          initialRankingError={ranking.error}
          rankingRetrievedAt={ranking.retrievedAt}
        />
      </main>
    </ToastProvider>
  );
}
