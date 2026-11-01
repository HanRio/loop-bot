-- Test copy of 001 (schema loopbot_test), used by the pytest suite against the real database.
-- Already applied by hand; kept here so the setup is reproducible. Generated from 001 with: s/\bloopbot\b/loopbot_test/g
-- plus a TRUNCATE grant, which the tests need to reset tables between runs.
do $$
begin
  if not exists (select from pg_roles where rolname = 'loopbot_app') then
    create role loopbot_app login noinherit;
  end if;
end $$;

create schema if not exists loopbot_test;
revoke all on schema loopbot_test from public;
grant usage on schema loopbot_test to loopbot_app;

create table if not exists loopbot_test.tracks (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  title text not null,
  file_id text not null,
  duration integer,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists tracks_user_idx on loopbot_test.tracks (user_id, id);

create table if not exists loopbot_test.playlists (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists playlists_user_idx on loopbot_test.playlists (user_id, id);

create table if not exists loopbot_test.playlist_tracks (
  playlist_id bigint not null references loopbot_test.playlists (id) on delete cascade,
  track_id bigint not null references loopbot_test.tracks (id) on delete cascade,
  position integer not null,
  primary key (playlist_id, track_id)
);
create index if not exists playlist_tracks_track_idx on loopbot_test.playlist_tracks (track_id);

create table if not exists loopbot_test.user_state (
  user_id bigint primary key,
  active_playlist_id bigint references loopbot_test.playlists (id) on delete set null
);

alter table loopbot_test.tracks enable row level security;
alter table loopbot_test.playlists enable row level security;
alter table loopbot_test.playlist_tracks enable row level security;
alter table loopbot_test.user_state enable row level security;

drop policy if exists loopbot_app_all on loopbot_test.tracks;
drop policy if exists loopbot_app_all on loopbot_test.playlists;
drop policy if exists loopbot_app_all on loopbot_test.playlist_tracks;
drop policy if exists loopbot_app_all on loopbot_test.user_state;
create policy loopbot_app_all on loopbot_test.tracks for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.playlists for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.playlist_tracks for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.user_state for all to loopbot_app using (true) with check (true);

grant select, insert, update, delete on all tables in schema loopbot_test to loopbot_app;
grant usage, select on all sequences in schema loopbot_test to loopbot_app;

grant truncate on all tables in schema loopbot_test to loopbot_app;
