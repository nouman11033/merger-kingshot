# Kingshot Merge Planner

A collaborative planning tool for Kingshot alliance merges. Two or three alliances
load their rosters side by side, officers tick the players who should make the cut,
and everyone watching the same link sees the shared **PRIME** roster update
instantly. Prime is capped at 100 players and always ordered by Power descending.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and Supabase
(PostgreSQL + Realtime). Rosters come from the Kingshot Stats API, with CSV import
as a fallback.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the values
# apply supabase/migrations/0001_init.sql to your Supabase project
npm run dev
```

Open <http://localhost:3000>, create a merge, and share the resulting
`/merge/<id>` URL with your officers. There is no login: anyone with the link can
edit the same session.

### Environment variables

| Variable | Where it runs | Purpose |
| --- | --- | --- |
| `KINGSHOT_API_KEY` | **Server only** | Kingshot Stats API key (`kss_…`). Create one at <https://api.kingshotstats.com> by signing in with Discord. |
| `KINGSHOT_API_BASE_URL` | Server only | Optional override. Defaults to `https://api.kingshotstats.com/v1`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Anon key. Used for Realtime and for writing selections. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Writes rosters and clears Prime. Never expose it. |

The Kingshot key and the service-role key are read only inside server code
(`lib/kingshot.ts` is marked `server-only`) and are never sent to the browser. The
app still runs without a Kingshot key — roster fetching is disabled and the UI
points you at CSV import instead.

### Database setup

Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor (or with the
Supabase CLI). It is idempotent, so it is safe to re-run. It creates four tables,
the Prime-limit trigger, Row Level Security policies, explicit table grants, and
the Realtime publication.

---

## How it works

### Data model

| Table | Holds |
| --- | --- |
| `merge_sessions` | One planning session: name, 2 or 3 alliances, Prime limit (100). |
| `alliances` | One row per slot: kingdom ID, tag, name, source (`api` or `csv`), sync timestamps. |
| `players` | Roster members: stable external ID, name, power, alliance rank, `active` flag. |
| `merge_player_selections` | Which players are in Prime, per session. |

Two derived values are deliberately **not** stored: the Prime roster and its
statistics. Both are computed from players + selections on every render, so they
can never drift out of sync with the underlying data.

Players are identified by a namespaced external ID (`uid:12345` from the API,
`csv:…` from a file) rather than by name, so renames do not create duplicates or
lose a player's Prime slot.

### Sorting rules

- Alliance rosters: **Alliance Rank ascending**, then power descending as a tiebreak.
- Prime roster: **Power descending**, then alliance rank, then name.

### Roster sync

`SYNC ROSTERS` re-fetches every API-backed alliance and reconciles it:

- new members are added,
- existing members are updated (power, rank, name),
- departed members are marked inactive and **release their Prime slot**,
- returning members are reactivated but come back **unselected**, so Prime can
  never overflow behind your back.

Selections survive syncs. If someone's power changes, Prime reorders itself.

### Freshness, honestly labelled

The Kingshot API serves data that can be up to 60 minutes old, so the UI never
claims the roster is live. It shows two separate timestamps: when this app last
retrieved the roster, and when the API generated that data.

To protect the documented budget of 60 requests/minute and 5,000/day, the server
caches roster responses for 60 seconds and coalesces concurrent requests for the
same alliance. `SYNC ROSTERS` always bypasses that cache to get the freshest data
the API will give.

### Realtime collaboration

Selections are written straight to Supabase by the browser and fanned out to
every other open planner over Supabase Realtime. There is no polling and no
refreshing.

- The person clicking sees the change immediately (optimistic update), with a
  rollback and an explanation if the write fails.
- Incoming events are buffered and applied in a single React update, so a sync
  that rewrites 300 rows does not cause 300 re-renders.
- While a write is in flight, incoming rows for that player are ignored, and
  events are ordered by `updated_at`. Rapid clicking and two people editing the
  same player cannot leave the checkbox stuck on the wrong value.
- The connection indicator reads **LIVE**, **RECONNECTING** (with backoff
  retries), or **OFFLINE**. On every reconnect the app re-reads the session once
  to pick up anything missed while disconnected.

The database is the final authority: the 100-player cap is enforced by a trigger,
so even a race between two browsers cannot produce a 101st Prime member.

### CSV import

Use it when the API has no data for an alliance, or when you have no key. The
importer auto-detects Name, Power, Rank, and ID columns from common header
spellings, parses shorthand power values such as `31.4M` or `28,100,000`, shows a
preview before committing, and reports skipped rows. Imported players use the same
internal model as API players, so every feature behaves identically. Re-importing
a slot replaces that roster instead of duplicating it.

---

## Security

- The Kingshot API key never leaves the server; all calls go through
  `/api/kingshot/*` route handlers.
- The service-role key is used only in server code, for roster writes and for
  clearing Prime.
- RLS is enabled on all four tables. With the anon key a browser can read rosters
  and insert or update **selections only**. Creating sessions, writing rosters,
  and deleting anything are server-side operations. Grants are declared
  explicitly in the migration rather than inherited, and destructive verbs are
  revoked from `anon` and `authenticated` as defense in depth.
- Because sessions are shared by link with no login, treat the link as the
  credential. To lock a session down, add Supabase Auth and tighten the
  `selections_*` policies to authenticated users.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `npm start` | Production build and server. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run lint` | ESLint. |
| `npm run verify` | Typecheck + lint + build. |
| `npm run kingshot:inspect -- <kingdomId> <tag>` | Print the live API response shape for one alliance. Useful if the upstream schema changes. |

`GET /api/kingshot/health` reports which environment variables are configured
(booleans only, never values) and can inspect a live response shape with
`?kingdomId=1234&tag=ABC`.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/kingshot/roster` | POST | Preview one or more alliance rosters. `force: true` bypasses the server cache. |
| `/api/kingshot/health` | GET | Configuration and response-shape diagnostics. |
| `/api/sessions` | GET, POST | List sessions; create a session (fetching rosters when `source: "api"`). |
| `/api/sessions/[id]` | GET | Full session snapshot: session, alliances, players, selections. |
| `/api/sessions/[id]/sync` | POST | Re-fetch every API-backed alliance. |
| `/api/sessions/[id]/import` | POST | Import parsed CSV rosters into one or more slots. |
| `/api/sessions/[id]/clear` | POST | Clear every Prime selection in the session. |

Errors carry a machine-readable `code` (`unauthorized`, `alliance_not_found`,
`empty_roster`, `rate_limited`, `api_unavailable`, `timeout`,
`malformed_response`, …) plus a message written for the person reading the screen.

## Project layout

```
app/            routes, API handlers, layout, global styles
components/     UI: setup, planner, rosters, filters, export, toasts
hooks/          useMergeRealtime — subscription, batching, reconnection
lib/            Kingshot client, Supabase clients, session data access,
                roster derivation, CSV parsing, coercion helpers
types/          shared domain and database row types
supabase/       SQL migration
scripts/        API inspection helper
```

## Deploying

Any Node host works; Vercel needs no extra configuration. Set the five
environment variables in the hosting dashboard (only the two `NEXT_PUBLIC_` ones
are exposed to browsers), run the migration against your Supabase project, and
confirm Realtime is enabled for the `public` schema. Note that the 60-second
roster cache is per server instance, so a scaled-out deployment may fetch once
per instance.
