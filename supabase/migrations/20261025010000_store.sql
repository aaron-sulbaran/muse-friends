-- Production store for Muse Friends (lib/store/supabase.ts).
--
-- Every collection is a table of JSONB documents keyed by the ids the Store interface uses, so a
-- change to a type in lib/protocol.ts never needs a migration. Only the columns the store queries
-- by are real columns. `ord` is the insertion order that "oldest first" listings use.
--
-- Access is server-side only: row level security is on with no policies, and anon and
-- authenticated have no privileges, so only the service role key (which never leaves the server)
-- can read or write.

create table public.threads (
  context_id text primary key,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.messages (
  context_id text not null,
  seq integer not null,
  data jsonb not null,
  ord bigint generated always as identity,
  primary key (context_id, seq)
);

create table public.plans (
  id text primary key,
  context_id text not null unique,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.cards (
  id text primary key,
  plan_id text not null,
  for_agent text not null,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.policies (
  owner text not null,
  friend text not null,
  data jsonb not null,
  ord bigint generated always as identity,
  primary key (owner, friend)
);

create table public.redactions (
  id text primary key,
  context_id text not null,
  data jsonb not null,
  ord bigint generated always as identity
);

-- The rejected-window ledger: hashes of windows proposed and passed over in a thread.
create table public.rejected_windows (
  context_id text not null,
  hash text not null,
  ord bigint generated always as identity,
  primary key (context_id, hash)
);

create table public.signals (
  id text primary key,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.events (
  id text primary key,
  context_id text,
  plan_id text,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.busy (
  event_id text primary key,
  agent text not null,
  data jsonb not null,
  ord bigint generated always as identity
);

create table public.room (
  id text primary key check (id = 'demo'),
  data jsonb not null
);

create table public.clock (
  id integer primary key check (id = 1),
  data jsonb not null
);

-- Recorded runs for Replay. They survive store_replace_all.
create table public.recorded_runs (
  id text primary key,
  data jsonb not null,
  ord bigint generated always as identity
);

-- One counter that changes whenever live state changes, so /api/state can answer a poll with 304.
create table public.cursor (
  id integer primary key check (id = 1),
  version bigint not null default 0
);
insert into public.cursor (id, version) values (1, 0);

create function public.bump_cursor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.cursor set version = version + 1 where id = 1;
  return null;
end;
$$;

create trigger threads_bump after insert or update or delete on public.threads
  for each statement execute function public.bump_cursor();
create trigger messages_bump after insert or update or delete on public.messages
  for each statement execute function public.bump_cursor();
create trigger plans_bump after insert or update or delete on public.plans
  for each statement execute function public.bump_cursor();
create trigger cards_bump after insert or update or delete on public.cards
  for each statement execute function public.bump_cursor();
create trigger policies_bump after insert or update or delete on public.policies
  for each statement execute function public.bump_cursor();
create trigger redactions_bump after insert or update or delete on public.redactions
  for each statement execute function public.bump_cursor();
create trigger rejected_windows_bump after insert or update or delete on public.rejected_windows
  for each statement execute function public.bump_cursor();
create trigger signals_bump after insert or update or delete on public.signals
  for each statement execute function public.bump_cursor();
create trigger events_bump after insert or update or delete on public.events
  for each statement execute function public.bump_cursor();
create trigger busy_bump after insert or update or delete on public.busy
  for each statement execute function public.bump_cursor();
create trigger room_bump after insert or update or delete on public.room
  for each statement execute function public.bump_cursor();
create trigger clock_bump after insert or update or delete on public.clock
  for each statement execute function public.bump_cursor();

-- Everything in one read, shaped like StateSnapshot in lib/protocol.ts.
create function public.store_snapshot() returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room', (select data from public.room where id = 'demo'),
    'clock', (select data from public.clock where id = 1),
    'busy', coalesce((select jsonb_agg(data order by ord) from public.busy), '[]'::jsonb),
    'signals', coalesce((select jsonb_agg(data order by ord) from public.signals), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(data order by ord) from public.threads), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(data order by context_id, seq) from public.messages), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(data order by ord) from public.plans), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(data order by ord) from public.cards), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(data order by ord) from public.policies), '[]'::jsonb),
    'redactions', coalesce((select jsonb_agg(data order by ord) from public.redactions), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(data order by ord) from public.events), '[]'::jsonb),
    'rejectedWindows', coalesce(
      (
        select jsonb_object_agg(grouped.context_id, grouped.hashes)
        from (
          select context_id, jsonb_agg(hash order by ord) as hashes
          from public.rejected_windows
          group by context_id
        ) as grouped
      ),
      '{}'::jsonb
    )
  );
$$;

-- Wipe live state and load a snapshot in one transaction. Recorded runs survive.
create function public.store_replace_all(snapshot jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.threads where true;
  delete from public.messages where true;
  delete from public.plans where true;
  delete from public.cards where true;
  delete from public.policies where true;
  delete from public.redactions where true;
  delete from public.rejected_windows where true;
  delete from public.signals where true;
  delete from public.events where true;
  delete from public.busy where true;
  delete from public.room where true;
  delete from public.clock where true;

  insert into public.threads (context_id, data)
  select item.value ->> 'contextId', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'threads', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.messages (context_id, seq, data)
  select item.value -> 'message' ->> 'contextId', (item.value -> 'message' ->> 'seq')::integer, item.value
  from jsonb_array_elements(coalesce(snapshot -> 'messages', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.plans (id, context_id, data)
  select item.value ->> 'id', item.value ->> 'contextId', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'plans', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.cards (id, plan_id, for_agent, data)
  select item.value ->> 'id', item.value ->> 'planId', item.value ->> 'forAgent', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'cards', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.policies (owner, friend, data)
  select item.value ->> 'owner', item.value ->> 'friend', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'policies', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.redactions (id, context_id, data)
  select item.value ->> 'id', item.value ->> 'contextId', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'redactions', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.rejected_windows (context_id, hash)
  select entry.key, hash.value
  from jsonb_each(coalesce(snapshot -> 'rejectedWindows', '{}'::jsonb)) as entry(key, value),
       jsonb_array_elements_text(entry.value) with ordinality as hash(value, n)
  order by entry.key, hash.n;

  insert into public.signals (id, data)
  select item.value ->> 'id', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'signals', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.events (id, context_id, plan_id, data)
  select item.value ->> 'id', item.value ->> 'contextId', item.value ->> 'planId', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'events', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  insert into public.busy (event_id, agent, data)
  select item.value -> 'event' ->> 'id', item.value ->> 'agent', item.value
  from jsonb_array_elements(coalesce(snapshot -> 'busy', '[]'::jsonb)) with ordinality as item(value, n)
  order by item.n;

  if snapshot ? 'room' and snapshot -> 'room' <> 'null'::jsonb then
    insert into public.room (id, data) values ('demo', snapshot -> 'room');
  end if;

  if snapshot ? 'clock' and snapshot -> 'clock' <> 'null'::jsonb then
    insert into public.clock (id, data) values (1, snapshot -> 'clock');
  end if;
end;
$$;

-- Lock everything to the service role.
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.plans enable row level security;
alter table public.cards enable row level security;
alter table public.policies enable row level security;
alter table public.redactions enable row level security;
alter table public.rejected_windows enable row level security;
alter table public.signals enable row level security;
alter table public.events enable row level security;
alter table public.busy enable row level security;
alter table public.room enable row level security;
alter table public.clock enable row level security;
alter table public.recorded_runs enable row level security;
alter table public.cursor enable row level security;

revoke all on table
  public.threads, public.messages, public.plans, public.cards, public.policies, public.redactions,
  public.rejected_windows, public.signals, public.events, public.busy, public.room, public.clock,
  public.recorded_runs, public.cursor
from anon, authenticated;

revoke execute on function public.bump_cursor(), public.store_snapshot(), public.store_replace_all(jsonb)
from public, anon, authenticated;
grant execute on function public.store_snapshot(), public.store_replace_all(jsonb) to service_role;
