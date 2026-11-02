import postgres from "postgres";

const DEFAULT_PLAYLIST_NAME = "기본";

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
  video_id: string | null;
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
  sheetFileId(userId: number, id: number): Promise<string | null>;
  saveSheet(userId: number, id: number, fileId: string): Promise<number | null>;
  deleteSheet(userId: number, id: number): Promise<boolean>;
  saveVideo(userId: number, id: number, videoId: string | null): Promise<boolean>;
  saveNote(userId: number, id: number, body: string): Promise<boolean>;
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
          { track_id: number; sheet_file_id: string | null; sheet_version: number; video_id: string | null }[]
        >`
          select tm.track_id, tm.sheet_file_id, tm.sheet_version, tm.video_id
          from track_media tm join tracks t on t.id = tm.track_id
          where ${readableFilter(tx, userId)}`;
        const media = Object.fromEntries(
          mediaRows.map((m) => [
            m.track_id,
            { sheet_version: m.sheet_file_id === null ? null : m.sheet_version, video_id: m.video_id },
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

    sheetFileId: (userId, id) =>
      inSchema(async (tx) => {
        const [row] = await tx<{ sheet_file_id: string | null }[]>`
          select tm.sheet_file_id from track_media tm join tracks t on t.id = tm.track_id
          where tm.track_id = ${id} and ${readableFilter(tx, userId)}`;
        return row?.sheet_file_id ?? null;
      }),

    saveSheet: (userId, id, fileId) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return null;
        const [row] = await tx<{ sheet_version: number }[]>`
          insert into track_media (track_id, sheet_file_id, sheet_version) values (${id}, ${fileId}, 1)
          on conflict (track_id) do update
            set sheet_file_id = excluded.sheet_file_id, sheet_version = track_media.sheet_version + 1
          returning sheet_version`;
        return row.sheet_version;
      }),

    deleteSheet: (userId, id) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return false;
        // Keep sheet_version so the next upload gets a new version number.
        await tx`update track_media set sheet_file_id = null where track_id = ${id}`;
        return true;
      }),

    saveVideo: (userId, id, videoId) =>
      inSchema(async (tx) => {
        if (!(await ownsTrackIn(tx, userId, id))) return false;
        await tx`insert into track_media (track_id, video_id) values (${id}, ${videoId})
          on conflict (track_id) do update set video_id = excluded.video_id`;
        return true;
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

    close: () => sql.end(),
  };
}
