import postgres from "postgres";

const DEFAULT_PLAYLIST_NAME = "기본";

export interface Playlist {
  id: number;
  name: string;
  track_ids: number[];
}

export interface LibraryTrack {
  id: number;
  title: string;
  duration: number | null;
}

export interface State {
  library: LibraryTrack[];
  playlists: Playlist[];
  active_id: number;
}

export interface Db {
  state(userId: number): Promise<State>;
  createPlaylist(userId: number, name: string, trackIds: number[]): Promise<Playlist>;
  savePlaylist(userId: number, id: number, name: string, trackIds: number[]): Promise<Playlist | null>;
  deletePlaylist(userId: number, id: number): Promise<number | null>;
  setActive(userId: number, id: number): Promise<number | null>;
  deleteTrack(userId: number, id: number): Promise<boolean>;
  fileId(userId: number, id: number): Promise<string | null>;
  close(): Promise<void>;
}

type Tx = postgres.TransactionSql;

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
        const playlistRows = await tx<{ id: number; name: string }[]>`
          select id, name from playlists where user_id = ${userId} order by id`;
        const trackRows = await tx<{ playlist_id: number; track_id: number }[]>`
          select pt.playlist_id, pt.track_id from playlist_tracks pt
          join playlists p on p.id = pt.playlist_id
          where p.user_id = ${userId} order by pt.position`;
        const playlists = playlistRows.map((p) => ({
          id: p.id,
          name: p.name,
          track_ids: trackRows.filter((t) => t.playlist_id === p.id).map((t) => t.track_id),
        }));
        return { library: [...library], playlists, active_id };
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
          select file_id from tracks where id = ${id} and user_id = ${userId}`;
        return row?.file_id ?? null;
      }),

    close: () => sql.end(),
  };
}
