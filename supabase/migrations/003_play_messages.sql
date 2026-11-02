-- Message ids of the last /play batch, so the next play can delete them. Applies to both loopbot and loopbot_test.
alter table loopbot.user_state add column if not exists play_message_ids bigint[] not null default '{}';
alter table loopbot_test.user_state add column if not exists play_message_ids bigint[] not null default '{}';
