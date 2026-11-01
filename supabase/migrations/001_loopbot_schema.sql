-- loop-bot lives in its own schema inside a shared project; only loopbot_app can touch it.
-- Not listed in PostgREST's exposed schemas, so the project's anon/authenticated API keys never see it.
do $$
begin
  if not exists (select from pg_roles where rolname = 'loopbot_app') then
    create role loopbot_app login noinherit;
  end if;
end $$;

create schema if not exists loopbot;
revoke all on schema loopbot from public;
grant usage on schema loopbot to loopbot_app;

create table if not exists loopbot.tracks (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  title text not null,
  file_id text not null,
  duration integer,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists tracks_user_idx on loopbot.tracks (user_id, id);

create table if not exists loopbot.playlists (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists playlists_user_idx on loopbot.playlists (user_id, id);

create table if not exists loopbot.playlist_tracks (
  playlist_id bigint not null references loopbot.playlists (id) on delete cascade,
  track_id bigint not null references loopbot.tracks (id) on delete cascade,
  position integer not null,
  primary key (playlist_id, track_id)
);
create index if not exists playlist_tracks_track_idx on loopbot.playlist_tracks (track_id);

create table if not exists loopbot.user_state (
  user_id bigint primary key,
  active_playlist_id bigint references loopbot.playlists (id) on delete set null
);

alter table loopbot.tracks enable row level security;
alter table loopbot.playlists enable row level security;
alter table loopbot.playlist_tracks enable row level security;
alter table loopbot.user_state enable row level security;

drop policy if exists loopbot_app_all on loopbot.tracks;
drop policy if exists loopbot_app_all on loopbot.playlists;
drop policy if exists loopbot_app_all on loopbot.playlist_tracks;
drop policy if exists loopbot_app_all on loopbot.user_state;
create policy loopbot_app_all on loopbot.tracks for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot.playlists for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot.playlist_tracks for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot.user_state for all to loopbot_app using (true) with check (true);

grant select, insert, update, delete on all tables in schema loopbot to loopbot_app;
grant usage, select on all sequences in schema loopbot to loopbot_app;
