-- Synced lyrics per track (LRCLIB). status 'none' = searched, nothing found. Applies to both loopbot and loopbot_test.
create table if not exists loopbot.track_lyrics (
  track_id bigint primary key references loopbot.tracks (id) on delete cascade,
  status text not null check (status in ('found', 'none')),
  source text,
  source_id bigint,
  synced text,
  offset_ms integer not null default 0,
  searched_at timestamptz not null default now()
);
alter table loopbot.track_lyrics enable row level security;
drop policy if exists loopbot_app_all on loopbot.track_lyrics;
create policy loopbot_app_all on loopbot.track_lyrics for all to loopbot_app using (true) with check (true);
grant select, insert, update, delete on loopbot.track_lyrics to loopbot_app;

create table if not exists loopbot_test.track_lyrics (
  track_id bigint primary key references loopbot_test.tracks (id) on delete cascade,
  status text not null check (status in ('found', 'none')),
  source text,
  source_id bigint,
  synced text,
  offset_ms integer not null default 0,
  searched_at timestamptz not null default now()
);
alter table loopbot_test.track_lyrics enable row level security;
drop policy if exists loopbot_app_all on loopbot_test.track_lyrics;
create policy loopbot_app_all on loopbot_test.track_lyrics for all to loopbot_app using (true) with check (true);
grant select, insert, update, delete on loopbot_test.track_lyrics to loopbot_app;
