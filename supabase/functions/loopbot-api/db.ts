import postgres from "postgres";

const DEFAULT_PLAYLIST_NAME = "기본";
export const SHEET_MAX_PAGES = 20;

export interface Playlist {
  id: number;
  name: string;
  track_ids: number[];
}

export interface SharedPlaylist {
  id: number;
  name: string;
  track_ids: number[];
}

export interface LibraryTrack {
  id: number;
  title: string;
  duration: number | null;
}

// sheet_version is null when there is no photo; video_id is null when there is no reference video.
export interface TrackMedia {
  sheet_version: number | null;
  sheet_count: number;
  video_id: string | null;
}

export interface SheetPages {
  version: number;
  count: number;
}

export interface State {
  library: LibraryTrack[];
  playlists: (Playlist & { shared: boolean })[];
  active_id: number;
  shared_playlists: SharedPlaylist[];
  shared_tracks: LibraryTrack[];
  media: Record<string, TrackMedia>;
  notes: Record<string, string>;
}

export interface AllowedUsername {
  username: string;
  seen: boolean;
  is_admin: boolean;
  user_id: number | null;
}

// unknown = never searched; none = searched, nothing found.
export interface LyricsView {
  status: "found" | "none" | "unknown";
  synced: string | null;
  offset_ms: number;
}

export interface Db {
  state(userId: number): Promise<State>;
  createPlaylist(userId: number, name: string, trackIds: number[]): Promise<Playlist>;
  savePlaylist(userId: number, id: number, name: string, trackIds: number[]): Promise<Playlist | null>;
  deletePlaylist(userId: number, id: number): Promise<number | null>;
  setActive(userId: number, id: number): Promise<number | null>;
  deleteTrack(userId: number, id: number): Promise<boolean>;
  fileId(userId: number, id: number): Promise<string | null>;
  setShared(userId: number, id: number, shared: boolean): Promise<boolean>;
  renameTrack(userId: number, id: number, title: string): Promise<boolean>;
  ownsTrack(userId: number, id: number): Promise<boolean>;
  sheetFileId(userId: number, id: number, page: number): Promise<string | null>;
  saveSheet(userId: number, id: number, fileId: string): Promise<SheetPages | "full" | null>;
  deleteSheet(userId: number, id: number, page: number): Promise<SheetPages | null>;
  saveVideo(userId: number, id: number, videoId: string | null): Promise<boolean>;
  saveNote(userId: number, id: number, body: string): Promise<boolean>;
  lyrics(userId: number, id: number): Promise<LyricsView | null>;
  saveLyrics(userId: number, id: number, sourceId: number, synced: string): Promise<boolean>;
  saveLyricsOffset(userId: number, id: number, offsetMs: number): Promise<boolean>;
  trackTitle(userId: number, id: number): Promise<string | null>;
  claimUsername(username: string, userId: number, authDate: number): Promise<boolean>;
  listUsernames(): Promise<AllowedUsername[]>;
  isAdminUser(userId: number): Promise<boolean>;
  usernameRow(username: string): Promise<{ user_id: number | null; is_admin: boolean } | null>;
  addUsername(username: string, addedBy: number): Promise<void>;
  removeUsername(username: string): Promise<boolean>;
  setAdmin(username: string, grant: boolean, by: number): Promise<"ok" | "missing" | "not_seen">;
  close(): Promise<void>;
}

type Tx = postgres.TransactionSql;

// The one read rule: a track is readable when it is the user's own or sits on a shared playlist.
// Callers must alias the tracks table as `t`.
function readableFilter(tx: Tx, userId: number) {
  return tx`(t.user_id = ${userId} or exists (
    select 1 from playlist_tracks pt join playlists p on p.id = pt.playlist_id
    where pt.track_id = t.id and p.shared = true))`;
}

async function ownsTrackIn(tx: Tx, userId: number, id: number): Promise<boolean> {
  const rows = await tx`select 1 from tracks where id = ${id} and user_id = ${userId}`;
  return rows.length > 0;
}

async function insertPlaylist(tx: Tx, userId: number, name: string): Promise<number> {
  const [row] = await tx<{ id: number }[]>`insert into playlists (user_id, name) values (${userId}, ${name}) returning id`;
  return row.id;
}

async function activate(tx: Tx, userId: number, id: number): Promise<void> {
  await tx`insert into user_state (user_id, active_playlist_id) values (${userId}, ${id})
    on conflict (user_id) do update set active_playlist_id = excluded.active_playlist_id`;
}

// Same rule as PostgresStore._active_id: keep the stored one, else the newest playlist, else create 기본.
async function activeId(tx: Tx, userId: number): Promise<number> {
  const [state] = await tx<{ active_playlist_id: number | null }[]>`
    select active_playlist_id from user_state where user_id = ${userId}`;
  if (state?.active_playlist_id != null) return state.active_playlist_id;

  const [latest] = await tx<{ id: number | null }[]>`select max(id) as id from playlists where user_id = ${userId}`;
  const id = latest.id ?? (await insertPlaylist(tx, userId, DEFAULT_PLAYLIST_NAME));
  await activate(tx, userId, id);
  return id;
}

async function ownsPlaylist(tx: Tx, userId: number, id: number): Promise<boolean> {
  const rows = await tx`select 1 from playlists where id = ${id} and user_id = ${userId}`;
  return rows.length > 0;
}

// Same filter as PostgresStore.save_playlist: only the user's own tracks, first occurrence wins.
async function replaceTracks(tx: Tx, userId: number, playlistId: number, trackIds: number[]): Promise<void> {
  const libraryRows = await tx<{ id: number }[]>`select id from tracks where user_id = ${userId}`;
  const libraryIds = new Set(libraryRows.map((row) => row.id));
  const ordered = [...new Set(trackIds)].filter((id) => libraryIds.has(id));

  await tx`delete from playlist_tracks where playlist_id = ${playlistId}`;
  if (ordered.length === 0) return;
  const rows = ordered.map((track_id, position) => ({ playlist_id: playlistId, track_id, position }));
  await tx`insert into playlist_tracks ${tx(rows)}`;
}

async function playlistOf(tx: Tx, id: number): Promise<Playlist> {
  const [row] = await tx<{ id: number; name: string }[]>`select id, name from playlists where id = ${id}`;
  const tracks = await tx<{ track_id: number }[]>`
    select track_id from playlist_tracks where playlist_id = ${id} order by position`;
  return { id: row.id, name: row.name, track_ids: tracks.map((t) => t.track_id) };
}

export function createDb(dsn: string, schema: string): Db {
  const sql = postgres(dsn, {
    max: 1,
    idle_timeout: 20,
    prepare: false,
    fetch_types: false,
    types: {
      bigint: { to: 20, from: [20], serialize: String, parse: Number },
    },
  });

  // Transaction-local, so it works through the pooler's transaction mode too.
  const inSchema = <T>(work: (tx: Tx) => Promise<T>): Promise<T> =>
    sql.begin(async (tx) => {
      await tx`select set_config('search_path', ${schema}, true)`;
      await tx`select set_config('lock_timeout', '5s', true)`;
      await tx`select set_config('statement_timeout', '10s', true)`;
      await tx`select set_config('idle_in_transaction_session_timeout', '15s', true)`;
      return work(tx);
    }) as Promise<T>;

  return {
    state: (userId) =>
      inSchema(async (tx) => {
        const active_id = await activeId(tx, userId);
        const library = await tx<LibraryTrack[]>`
          select id, title, duration from tracks where user_id = ${userId} order by id`;
        const playlistRows = await tx<{ id: number; name: string; shared: boolean }[]>`
          select id, name, shared from playlists where user_id = ${userId} order by id`;
        const trackRows = await tx<{ playlist_id: number; track_id: number }[]>`
          select pt.playlist_id, pt.track_id from playlist_tracks pt
          join playlists p on p.id = pt.playlist_id
          where p.user_id = ${userId} order by pt.position`;
        const playlists = playlistRows.map((p) => ({
          id: p.id,
          name: p.name,
          shared: p.shared,
          track_ids: trackRows.filter((t) => t.playlist_id === p.id).map((t) => t.track_id),
        }));

        const sharedRows = await tx<{ id: number; name: string }[]>`
          select id, name from playlists where shared = true and user_id <> ${userId} order by id`;
        const sharedTrackRows = await tx<{ playlist_id: number; track_id: number }[]>`
          select pt.playlist_id, pt.track_id from playlist_tracks pt
          join playlists p on p.id = pt.playlist_id
          where p.shared = true and p.user_id <> ${userId} order by pt.position`;
        const shared_playlists = sharedRows.map((p) => ({
          id: p.id,
          name: p.name,
          track_ids: sharedTrackRows.filter((t) => t.playlist_id === p.id).map((t) => t.track_id),
        }));
        const shared_tracks = await tx<LibraryTrack[]>`
          select t.id, t.title, t.duration from tracks t
          where t.user_id <> ${userId} and exists (
            select 1 from playlist_tracks pt join playlists p on p.id = pt.playlist_id
            where pt.track_id = t.id and p.shared = true and p.user_id <> ${userId})
          order by t.id`;

        const mediaRows = await tx<
          { track_id: number; sheet_version: number; sheet_count: number; video_id: string | null }[]
        >`
          select tm.track_id, tm.sheet_version, cardinality(tm.sheet_file_ids) as sheet_count, tm.video_id
          from track_media tm join tracks t on t.id = tm.track_id
          where ${readableFilter(tx, userId)}`;
        const media = Object.fromEntries(
          mediaRows.map((m) => [
            m.track_id,
            {
              sheet_version: m.sheet_count === 0 ? null : m.sheet_version,
              sheet_count: m.sheet_count,
              video_id: m.video_id,
            },
          ]),
        );

        const noteRows = await tx<{ track_id: number; body: string }[]>`
          select n.track_id, n.body from track_notes n join tracks t on t.id = n.track_id
          where n.user_id = ${userId} and ${readableFilter(tx, userId)}`;
        const notes = Object.fromEntries(noteRows.map((n) => [n.track_id, n.body]));

        return {
          library: [...library],
          playlists,
          active_id,
          shared_playlists,
          shared_tracks: [...shared_tracks],
          media,
          notes,
        };
      }),

    createPlaylist: (userId, name, trackIds) =>
      inSchema(async (tx) => {
        const id = await insertPlaylist(tx, userId, name);
        await replaceTracks(tx, userId, id, trackIds);
        await activate(tx, userId, id);
        return playlistOf(tx, id);
      }),

    savePlaylist: (userId, id, name, trackIds) =>
      inSchema(async (tx) => {
        if (!(await ownsPlaylist(tx, userId, id))) return null;
        await tx`update playlists set name = ${name} where id = ${id}`;
        await replaceTracks(tx, userId, id, trackIds);
        await activate(tx, userId, id);
        return playlistOf(tx, id);
      }),

    deletePlaylist: (userId, id) =>
      inSchema(async (tx) => {
        const deleted = await tx`delete from playlists where id = ${id} and user_id = ${userId} returning id`;
        if (deleted.length === 0) return null;
        // The FK on user_state.active_playlist_id clears the pointer when the active list is deleted.
        return activeId(tx, userId);
      }),

    setActive: (userId, id) =>
      inSchema(async (tx) => {
        if (!(await ownsPlaylist(tx, userId, id))) return null;
        await activate(tx, userId, id);
        return id;
      }),

    deleteTrack: (userId, id) =>
      inSchema(async (tx) => {
        const deleted = await tx`delete from tracks where id = ${id} and user_id = ${userId} returning id`;
        return deleted.length > 0;
      }),

    fileId: (userId, id) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ file_id: string }[]>`
          select t.file_id from tracks t where t.id = ${id} and ${readableFilter(tx, userId)}`;
        return row?.file_id ?? null;
      }),

    setShared: (userId, id, shared) =>
      inSchema(async (tx) => {
        if (!(await ownsPlaylist(tx, userId, id))) return false;
        await tx`update playlists set shared = ${shared} where id = ${id}`;
        return true;
      }),

    renameTrack: (userId, id, title) =>
      inSchema(async (tx) => {
        const renamed = await tx`update tracks set title = ${title} where id = ${id} and user_id = ${userId} returning id`;
        return renamed.length > 0;
      }),

    ownsTrack: (userId, id) => inSchema((tx) => ownsTrackIn(tx, userId, id)),

    // page is 0-based; an out-of-range page gives null (the array subscript is past the end).
    sheetFileId: (userId, id, page) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ sheet_file_id: string | null }[]>`
          select tm.sheet_file_ids[${page + 1}::int] as sheet_file_id
          from track_media tm join tracks t on t.id = tm.track_id
          where tm.track_id = ${id} and ${readableFilter(tx, userId)}`;
        return row?.sheet_file_id ?? null;
      }),

    // Pages are appended in order. The version bump and the cap are checked in the same statement, so a race cannot exceed the cap.
    saveSheet: (userId, id, fileId) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return null;
        const [row] = await tx<SheetPages[]>`
          insert into track_media (track_id, sheet_file_ids, sheet_version)
          values (${id}, array[${fileId}]::text[], 1)
          on conflict (track_id) do update
            set sheet_file_ids = array_append(track_media.sheet_file_ids, ${fileId}::text),
                sheet_version = track_media.sheet_version + 1
            where cardinality(track_media.sheet_file_ids) < ${SHEET_MAX_PAGES}::int
          returning sheet_version as version, cardinality(sheet_file_ids) as count`;
        return row ?? "full";
      }),

    // Later pages move down one slot, so the version changes too. Deleting the last page leaves count 0 and keeps the version.
    deleteSheet: (userId, id, page) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return null;
        const [row] = await tx<SheetPages[]>`
          update track_media
          set sheet_file_ids = sheet_file_ids[1:${page}::int] || sheet_file_ids[${page}::int + 2:],
              sheet_version = sheet_version + 1
          where track_id = ${id} and ${page}::int < cardinality(sheet_file_ids)
          returning sheet_version as version, cardinality(sheet_file_ids) as count`;
        return row ?? null;
      }),

    saveVideo: (userId, id, videoId) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return false;
        await tx`insert into track_media (track_id, video_id) values (${id}, ${videoId})
          on conflict (track_id) do update set video_id = excluded.video_id`;
        return true;
      }),

    // null when the track is not readable. No row means it was never searched.
    lyrics: (userId, id) =>
      inSchema(async (tx) => {
        const readable = await tx`select 1 from tracks t where t.id = ${id} and ${readableFilter(tx, userId)}`;
        if (readable.length === 0) return null;
        const [row] = await tx<{ status: "found" | "none"; synced: string | null; offset_ms: number }[]>`
          select status, synced, offset_ms from track_lyrics where track_id = ${id}`;
        return row ?? { status: "unknown", synced: null, offset_ms: 0 };
      }),

    saveLyrics: (userId, id, sourceId, synced) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return false;
        await tx`insert into track_lyrics (track_id, status, source, source_id, synced, offset_ms, searched_at)
          values (${id}, 'found', 'lrclib', ${sourceId}, ${synced}, 0, now())
          on conflict (track_id) do update set status = 'found', source = 'lrclib', source_id = excluded.source_id,
            synced = excluded.synced, offset_ms = 0, searched_at = now()`;
        return true;
      }),

    saveLyricsOffset: (userId, id, offsetMs) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return false;
        const rows = await tx`update track_lyrics set offset_ms = ${offsetMs} where track_id = ${id} returning track_id`;
        return rows.length > 0;
      }),

    trackTitle: (userId, id) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ title: string }[]>`select title from tracks where id = ${id} and user_id = ${userId}`;
        return row?.title ?? null;
      }),

    saveNote: (userId, id, body) =>
      inSchema(async (tx) => {
        const readable = await tx`select 1 from tracks t where t.id = ${id} and ${readableFilter(tx, userId)}`;
        if (readable.length === 0) return false;
        if (body === "") {
          await tx`delete from track_notes where user_id = ${userId} and track_id = ${id}`;
        } else {
          await tx`insert into track_notes (user_id, track_id, body) values (${userId}, ${id}, ${body})
            on conflict (user_id, track_id) do update set body = excluded.body, updated_at = now()`;
        }
        return true;
      }),

    // A holder is replaced only by a sign-in whose signed auth_date is newer than the holder's claim, so an old initData cannot take the name back.
    // The previous holder loses admin, so it cannot stay an invisible admin.
    claimUsername: (username, userId, authDate) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ user_id: number | null; claimed_auth_date: number | null }[]>`
          select user_id, claimed_auth_date from allowed_usernames where username = ${username} for update`;
        if (row === undefined) return false;
        const claimedAt = row.claimed_auth_date ?? 0;
        if (row.user_id === null) {
          await tx`update allowed_usernames set user_id = ${userId}, claimed_auth_date = ${authDate} where username = ${username}`;
          return true;
        }
        if (row.user_id === userId) {
          if (authDate > claimedAt) {
            await tx`update allowed_usernames set claimed_auth_date = ${authDate} where username = ${username}`;
          }
          return true;
        }
        if (authDate <= claimedAt) return false;
        await tx`delete from admin_users where user_id = ${row.user_id}`;
        await tx`update allowed_usernames set user_id = ${userId}, claimed_auth_date = ${authDate} where username = ${username}`;
        return true;
      }),

    listUsernames: () =>
      inSchema(async (tx) => {
        return tx<AllowedUsername[]>`
          select a.username, a.user_id, a.user_id is not null as seen, ad.user_id is not null as is_admin
          from allowed_usernames a left join admin_users ad on ad.user_id = a.user_id
          order by a.username`;
      }),

    isAdminUser: (userId) =>
      inSchema(async (tx) => {
        const rows = await tx`select 1 from admin_users where user_id = ${userId}`;
        return rows.length > 0;
      }),

    usernameRow: (username) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ user_id: number | null; is_admin: boolean }[]>`
          select a.user_id, ad.user_id is not null as is_admin
          from allowed_usernames a left join admin_users ad on ad.user_id = a.user_id
          where a.username = ${username}`;
        return row ?? null;
      }),

    addUsername: (username, addedBy) =>
      inSchema(async (tx) => {
        await tx`insert into allowed_usernames (username, added_by) values (${username}, ${addedBy})
          on conflict do nothing`;
      }),

    removeUsername: (username) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ user_id: number | null }[]>`
          delete from allowed_usernames where username = ${username} returning user_id`;
        if (row === undefined) return false;
        if (row.user_id !== null) {
          await tx`delete from admin_users where user_id = ${row.user_id}`;
        }
        return true;
      }),

    // Admin rights attach to the numeric id seen for the name, so a name that was never opened cannot be granted.
    setAdmin: (username, grant, by) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ user_id: number | null }[]>`
          select user_id from allowed_usernames where username = ${username} for update`;
        if (row === undefined) return "missing";
        if (row.user_id === null) return "not_seen";
        if (grant) {
          await tx`insert into admin_users (user_id, granted_by) values (${row.user_id}, ${by})
            on conflict do nothing`;
        } else {
          await tx`delete from admin_users where user_id = ${row.user_id}`;
        }
        return "ok";
      }),

    close: () => sql.end(),
  };
}
