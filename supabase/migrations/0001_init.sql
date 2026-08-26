-- Kingshot Merge Planner — initial schema
--
-- Entities:
--   merge_sessions            one merge plan (2 or 3 alliances)
--   alliances                 a configured alliance slot inside a session
--   players                   roster members, sourced from the Kingshot Stats API or CSV
--   merge_player_selections   per-session Prime selection (never global on the player)
--
-- Prime is always derived: selected + active players ordered by power desc.
-- Prime rank is never stored.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- merge_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.merge_sessions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  merge_size   smallint not null check (merge_size in (2, 3)),
  prime_limit  smallint not null default 100 check (prime_limit between 1 and 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- alliances
-- ---------------------------------------------------------------------------
create table if not exists public.alliances (
  id                  uuid primary key default gen_random_uuid(),
  merge_session_id    uuid not null references public.merge_sessions (id) on delete cascade,
  slot_number         smallint not null check (slot_number between 1 and 3),
  kingdom_id          text not null check (char_length(btrim(kingdom_id)) between 1 and 24),
  alliance_tag        text not null check (char_length(btrim(alliance_tag)) between 1 and 24),
  alliance_name       text not null default '',
  source              text not null default 'api' check (source in ('api', 'csv')),
  external_alliance_id text,
  power               numeric,
  member_count        integer,
  leader_name         text,
  flag_url            text,
  api_cached_at       timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (merge_session_id, slot_number)
);

create index if not exists alliances_session_idx on public.alliances (merge_session_id);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id                uuid primary key default gen_random_uuid(),
  merge_session_id  uuid not null references public.merge_sessions (id) on delete cascade,
  alliance_id       uuid not null references public.alliances (id) on delete cascade,
  -- Stable identity from the Kingshot API, namespaced by source of the id
  -- (e.g. "uid:123456", "gov:98765", "csv:<slug>"). Never the player name.
  external_id       text not null,
  name              text not null default '',
  power             bigint not null default 0 check (power >= 0),
  alliance_rank     integer,
  kingdom_id        text,
  town_center_level integer,
  kills             bigint,
  online            boolean,
  last_active_at    timestamptz,
  avatar_url        text,
  -- Extra API fields are preserved here so the UI never depends on them.
  metadata          jsonb not null default '{}'::jsonb,
  active            boolean not null default true,
  last_synced_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (alliance_id, external_id)
);

create index if not exists players_session_idx on public.players (merge_session_id);
create index if not exists players_alliance_rank_idx on public.players (alliance_id, alliance_rank);
create index if not exists players_power_idx on public.players (merge_session_id, power desc);

-- ---------------------------------------------------------------------------
-- merge_player_selections
-- ---------------------------------------------------------------------------
create table if not exists public.merge_player_selections (
  merge_session_id uuid not null references public.merge_sessions (id) on delete cascade,
  player_id        uuid not null references public.players (id) on delete cascade,
  selected         boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (merge_session_id, player_id)
);

create index if not exists selections_session_selected_idx
  on public.merge_player_selections (merge_session_id)
  where selected;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists merge_sessions_touch on public.merge_sessions;
create trigger merge_sessions_touch before update on public.merge_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists alliances_touch on public.alliances;
create trigger alliances_touch before update on public.alliances
  for each row execute function public.touch_updated_at();

drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players
  for each row execute function public.touch_updated_at();

drop trigger if exists selections_touch on public.merge_player_selections;
create trigger selections_touch before update on public.merge_player_selections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Integrity: a selection must reference a player from the same session,
-- and the session's Prime limit is enforced in the database, not only the UI.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_selection_rules()
returns trigger
language plpgsql
as $$
declare
  player_session uuid;
  limit_size     smallint;
  current_count  integer;
begin
  select p.merge_session_id into player_session
  from public.players p
  where p.id = new.player_id;

  if player_session is null then
    raise exception 'unknown player %', new.player_id using errcode = '23503';
  end if;

  if player_session <> new.merge_session_id then
    raise exception 'player % does not belong to merge session %',
      new.player_id, new.merge_session_id using errcode = '23514';
  end if;

  if new.selected is not true then
    return new;
  end if;

  -- Serialize concurrent selections for this session so the limit cannot be
  -- exceeded by two clients racing each other.
  perform pg_advisory_xact_lock(hashtextextended(new.merge_session_id::text, 0));

  select s.prime_limit into limit_size
  from public.merge_sessions s
  where s.id = new.merge_session_id;

  select count(*) into current_count
  from public.merge_player_selections sel
  join public.players p on p.id = sel.player_id
  where sel.merge_session_id = new.merge_session_id
    and sel.selected
    and p.active
    and sel.player_id <> new.player_id;

  if current_count >= limit_size then
    raise exception 'prime_roster_full: % of % slots used', current_count, limit_size
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists selections_enforce on public.merge_player_selections;
create trigger selections_enforce before insert or update on public.merge_player_selections
  for each row execute function public.enforce_selection_rules();

-- A player who leaves an alliance releases their Prime slot. Without this, a
-- returning player would silently re-enter Prime on the next sync and could
-- push the roster past its limit, since reactivation does not touch the
-- selections table. Keeps "selected and active <= prime_limit" always true.
create or replace function public.release_selection_on_deactivate()
returns trigger
language plpgsql
as $$
begin
  if old.active and not new.active then
    update public.merge_player_selections
    set selected = false, updated_at = now()
    where player_id = new.id and selected;
  end if;
  return new;
end;
$$;

drop trigger if exists players_release_selection on public.players;
create trigger players_release_selection after update of active on public.players
  for each row execute function public.release_selection_on_deactivate();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The planner is a shared-link collaboration tool with no end-user login, so
-- the anon key may read and write selections. Deletes and session/roster
-- mutations are reserved for the server (service role), which bypasses RLS.
-- Tighten these policies if you add authentication (see README > Security).
-- ---------------------------------------------------------------------------
alter table public.merge_sessions          enable row level security;
alter table public.alliances               enable row level security;
alter table public.players                 enable row level security;
alter table public.merge_player_selections enable row level security;

drop policy if exists merge_sessions_read on public.merge_sessions;
create policy merge_sessions_read on public.merge_sessions
  for select to anon, authenticated using (true);

drop policy if exists alliances_read on public.alliances;
create policy alliances_read on public.alliances
  for select to anon, authenticated using (true);

drop policy if exists players_read on public.players;
create policy players_read on public.players
  for select to anon, authenticated using (true);

drop policy if exists selections_read on public.merge_player_selections;
create policy selections_read on public.merge_player_selections
  for select to anon, authenticated using (true);

drop policy if exists selections_insert on public.merge_player_selections;
create policy selections_insert on public.merge_player_selections
  for insert to anon, authenticated with check (true);

drop policy if exists selections_update on public.merge_player_selections;
create policy selections_update on public.merge_player_selections
  for update to anon, authenticated using (true) with check (true);

-- Privileges are granted explicitly rather than inherited from Supabase's
-- default privileges, so this migration produces the same security posture on
-- any Postgres and the intent is auditable in one place. Policies above decide
-- *which rows*; these grants decide *which verbs* are possible at all.
grant usage on schema public to anon, authenticated;

-- Read access is required for Realtime: a subscriber only receives changes for
-- tables it may select from.
grant select on public.merge_sessions          to anon, authenticated;
grant select on public.alliances               to anon, authenticated;
grant select on public.players                 to anon, authenticated;

-- Ticking a player is the only write a browser performs. No delete: clearing
-- Prime goes through the server, which flips selected to false.
grant select, insert, update on public.merge_player_selections to anon, authenticated;

-- Defense in depth: even if a future default privilege or migration grants more,
-- browsers must never mutate rosters or sessions directly.
revoke insert, update, delete, truncate on public.merge_sessions from anon, authenticated;
revoke insert, update, delete, truncate on public.alliances      from anon, authenticated;
revoke insert, update, delete, truncate on public.players        from anon, authenticated;
revoke delete, truncate on public.merge_player_selections        from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE payloads carry every column so
-- clients can patch state (and so `filter` works on delete events).
-- ---------------------------------------------------------------------------
alter table public.merge_player_selections replica identity full;
alter table public.players                 replica identity full;
alter table public.alliances               replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'merge_player_selections'
  ) then
    alter publication supabase_realtime add table public.merge_player_selections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alliances'
  ) then
    alter publication supabase_realtime add table public.alliances;
  end if;
end
$$;
