-- Usernames an admin allowed from the mini app. Replaces the ALLOWED_USERNAMES settings once seeded.
create table if not exists loopbot.allowed_usernames (
  username text primary key check (username = lower(username)),
  added_by bigint,
  created_at timestamptz not null default now()
);
grant select, insert, delete on loopbot.allowed_usernames to loopbot_app;

create table if not exists loopbot_test.allowed_usernames (
  username text primary key check (username = lower(username)),
  added_by bigint,
  created_at timestamptz not null default now()
);
grant select, insert, delete, truncate on loopbot_test.allowed_usernames to loopbot_app;
