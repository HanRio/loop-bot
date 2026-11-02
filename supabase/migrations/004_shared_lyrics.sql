-- Shared playlists, per-track lyric sheet and reference video, per-user notes. Applies to both loopbot and loopbot_test.
alter table loopbot.playlists add column if not exists shared boolean not null default false;
create table if not exists loopbot.track_media (
  track_id bigint primary key references loopbot.tracks (id) on delete cascade,
  sheet_file_id text,
  sheet_version integer not null default 0,
  video_id text
);
create table if not exists loopbot.track_notes (
  user_id bigint not null,
  track_id bigint not null references loopbot.tracks (id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index if not exists track_notes_track_idx on loopbot.track_notes (track_id);
alter table loopbot.track_media enable row level security;
alter table loopbot.track_notes enable row level security;
drop policy if exists loopbot_app_all on loopbot.track_media;
drop policy if exists loopbot_app_all on loopbot.track_notes;
create policy loopbot_app_all on loopbot.track_media for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot.track_notes for all to loopbot_app using (true) with check (true);
grant select, insert, update, delete on loopbot.track_media, loopbot.track_notes to loopbot_app;

alter table loopbot_test.playlists add column if not exists shared boolean not null default false;
create table if not exists loopbot_test.track_media (
  track_id bigint primary key references loopbot_test.tracks (id) on delete cascade,
  sheet_file_id text,
  sheet_version integer not null default 0,
  video_id text
);
create table if not exists loopbot_test.track_notes (
  user_id bigint not null,
  track_id bigint not null references loopbot_test.tracks (id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index if not exists track_notes_track_idx on loopbot_test.track_notes (track_id);
alter table loopbot_test.track_media enable row level security;
alter table loopbot_test.track_notes enable row level security;
drop policy if exists loopbot_app_all on loopbot_test.track_media;
drop policy if exists loopbot_app_all on loopbot_test.track_notes;
create policy loopbot_app_all on loopbot_test.track_media for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.track_notes for all to loopbot_app using (true) with check (true);
grant select, insert, update, delete, truncate on loopbot_test.track_media, loopbot_test.track_notes to loopbot_app;
