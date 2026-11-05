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

-- The numeric id seen when a listed username last opened the app. Admin rights attach to that id, because usernames can be taken over.
alter table loopbot.allowed_usernames add column if not exists user_id bigint;
create table if not exists loopbot.admin_users (
  user_id bigint primary key,
  granted_by bigint not null,
  created_at timestamptz not null default now()
);
grant update on loopbot.allowed_usernames to loopbot_app;
grant select, insert, delete on loopbot.admin_users to loopbot_app;

alter table loopbot_test.allowed_usernames add column if not exists user_id bigint;
create table if not exists loopbot_test.admin_users (
  user_id bigint primary key,
  granted_by bigint not null,
  created_at timestamptz not null default now()
);
grant update on loopbot_test.allowed_usernames to loopbot_app;
grant select, insert, delete, truncate on loopbot_test.admin_users to loopbot_app;

-- auth_date of the sign-in that last claimed the name, so an old sign-in cannot take it back.
alter table loopbot.allowed_usernames add column if not exists claimed_auth_date bigint;
alter table loopbot_test.allowed_usernames add column if not exists claimed_auth_date bigint;

alter table loopbot.allowed_usernames enable row level security;
drop policy if exists loopbot_app_all on loopbot.allowed_usernames;
create policy loopbot_app_all on loopbot.allowed_usernames for all to loopbot_app using (true) with check (true);
alter table loopbot.admin_users enable row level security;
drop policy if exists loopbot_app_all on loopbot.admin_users;
create policy loopbot_app_all on loopbot.admin_users for all to loopbot_app using (true) with check (true);
alter table loopbot_test.allowed_usernames enable row level security;
drop policy if exists loopbot_app_all on loopbot_test.allowed_usernames;
create policy loopbot_app_all on loopbot_test.allowed_usernames for all to loopbot_app using (true) with check (true);
alter table loopbot_test.admin_users enable row level security;
drop policy if exists loopbot_app_all on loopbot_test.admin_users;
create policy loopbot_app_all on loopbot_test.admin_users for all to loopbot_app using (true) with check (true);
