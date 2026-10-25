-- "Bring your own Muse": one isolated room per plan a judge starts from their own Muse.
--
-- A room is one JSON document, the whole StateSnapshot of that room, kept apart from the demo room's
-- tables so a judge's plan can never appear on the stage and the demo's Reset (store_replace_all) can
-- never wipe it. A room stops being served at expires_at and is deleted by the next request that
-- notices (and by the cleanup in docs/RUNBOOK.md after the event). created_at is also what the cap on
-- rooms per hour counts, so the cap holds across server instances.
--
-- Access is server-side only: row level security is on with no policies, and anon and authenticated
-- have no privileges, so only the service role key (which never leaves the server) can read or write.

create table public.byom_rooms (
  room_key text primary key,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index byom_rooms_created_at_idx on public.byom_rooms (created_at);
create index byom_rooms_expires_at_idx on public.byom_rooms (expires_at);

alter table public.byom_rooms enable row level security;

revoke all on table public.byom_rooms from anon, authenticated;
