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
