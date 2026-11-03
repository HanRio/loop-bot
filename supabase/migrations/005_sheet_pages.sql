-- A track's lyric sheet can have several pages. sheet_file_id stays until the new code is live, then it can be dropped.
-- The backfill is safe to run again: it only fills tracks that have no pages yet.
alter table loopbot.track_media add column if not exists sheet_file_ids text[] not null default '{}';
update loopbot.track_media set sheet_file_ids = array[sheet_file_id] where sheet_file_id is not null and sheet_file_ids = '{}';

alter table loopbot_test.track_media add column if not exists sheet_file_ids text[] not null default '{}';
update loopbot_test.track_media set sheet_file_ids = array[sheet_file_id] where sheet_file_id is not null and sheet_file_ids = '{}';
