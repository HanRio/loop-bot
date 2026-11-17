-- One row per counted play (the client sends it once 99% of the track was really heard).
-- play_key is made by the client per play, so a retried request is stored once.
-- display_names holds the Telegram name shown on the user ranking; it is refreshed on each counted play.
create table if not exists loopbot.play_events (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  track_id bigint not null references loopbot.tracks (id) on delete cascade,
  play_key uuid not null,
  played_at timestamptz not null default now(),
  unique (user_id, play_key)
);
create index if not exists play_events_time_idx on loopbot.play_events (played_at);
create index if not exists play_events_user_track_idx on loopbot.play_events (user_id, track_id);

create table if not exists loopbot.display_names (
  user_id bigint primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

create table if not exists loopbot_test.play_events (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  track_id bigint not null references loopbot_test.tracks (id) on delete cascade,
  play_key uuid not null,
  played_at timestamptz not null default now(),
  unique (user_id, play_key)
);
create index if not exists play_events_time_idx on loopbot_test.play_events (played_at);
create index if not exists play_events_user_track_idx on loopbot_test.play_events (user_id, track_id);

create table if not exists loopbot_test.display_names (
  user_id bigint primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

alter table loopbot.play_events enable row level security;
alter table loopbot.display_names enable row level security;
alter table loopbot_test.play_events enable row level security;
alter table loopbot_test.display_names enable row level security;
drop policy if exists loopbot_app_all on loopbot.play_events;
drop policy if exists loopbot_app_all on loopbot.display_names;
drop policy if exists loopbot_app_all on loopbot_test.play_events;
drop policy if exists loopbot_app_all on loopbot_test.display_names;
create policy loopbot_app_all on loopbot.play_events for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot.display_names for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.play_events for all to loopbot_app using (true) with check (true);
create policy loopbot_app_all on loopbot_test.display_names for all to loopbot_app using (true) with check (true);

grant select, insert on loopbot.play_events to loopbot_app;
grant select, insert, update on loopbot.display_names to loopbot_app;
grant select, insert, delete, truncate on loopbot_test.play_events to loopbot_app;
grant select, insert, update, delete, truncate on loopbot_test.display_names to loopbot_app;
grant usage, select on all sequences in schema loopbot to loopbot_app;
grant usage, select on all sequences in schema loopbot_test to loopbot_app;
