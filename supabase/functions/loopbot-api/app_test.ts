import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import postgres from "postgres";
import { handle, parseNewUsername, parseUsernames, youtubeId, type Deps } from "./app.ts";
import { createDb, type Db } from "./db.ts";

const dsn = Deno.env.get("LOOPBOT_TEST_DATABASE_URL") ?? "";
const SCHEMA = "loopbot_test";
const ORIGIN = "https://example.test";
const BOT_TOKEN = "0000000000:test-bot-token";
const NOW = 1_800_000_000;
const ALLOWED_USER = 900001;
const OTHER_USER = 900002;
const STRANGER = 900003;
const NAMED_USER = 900004;
const TEST_USERS = [ALLOWED_USER, OTHER_USER, NAMED_USER];

// Test-only signer, same Telegram rules as auth_test.ts.
async function signFor(userId: number, username?: string): Promise<string> {
  const encoder = new TextEncoder();
  const user = username === undefined ? { id: userId } : { id: userId, username };
  const fields: [string, string][] = [
    ["auth_date", String(NOW)],
    ["user", JSON.stringify(user)],
  ];
  const dataCheck = fields.map(([key, value]) => `${key}=${value}`).join("\n");
  const hmacKey = (raw: BufferSource) =>
    crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData")), encoder.encode(BOT_TOKEN));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(dataCheck));
  const hash = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams([...fields, ["hash", hash]]).toString();
}

const unexpectedFetch = (() => Promise.reject(new Error("fetch not expected"))) as typeof fetch;

interface Ctx {
  db: Db;
  sql: postgres.Sql;
  deps: Deps;
}

function depsWith(db: Db, overrides: Partial<Deps> = {}): Deps {
  return {
    botToken: BOT_TOKEN,
    allowed: new Set([ALLOWED_USER, OTHER_USER]),
    allowedUsernames: new Set(),
    admins: new Set([ALLOWED_USER]),
    db,
    fetch: unexpectedFetch,
    now: () => NOW,
    ...overrides,
  };
}

// Each test starts from an empty state for the test users only, and an empty allowed_usernames list.
function dbTest(name: string, fn: (ctx: Ctx) => Promise<void>): void {
  Deno.test({
    name,
    ignore: dsn === "",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const sql = postgres(dsn, { max: 1, prepare: false });
      const db = createDb(dsn, SCHEMA);
      try {
        await sql`delete from loopbot_test.user_state where user_id in ${sql(TEST_USERS)}`;
        await sql`delete from loopbot_test.playlists where user_id in ${sql(TEST_USERS)}`;
        await sql`delete from loopbot_test.tracks where user_id in ${sql(TEST_USERS)}`;
        await sql`delete from loopbot_test.allowed_usernames`;
        await fn({ db, sql, deps: depsWith(db) });
      } finally {
        await db.close();
        await sql.end();
      }
    },
  });
}

async function call(
  ctx: Ctx,
  method: string,
  path: string,
  options: { body?: unknown; rawBody?: string; userId?: number; initData?: string; deps?: Deps } = {},
): Promise<Response> {
  const initData = options.initData ?? (await signFor(options.userId ?? ALLOWED_USER));
  const headers: Record<string, string> = { "x-telegram-init-data": initData, "content-type": "application/json" };
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return handle(new Request(`${ORIGIN}/loopbot-api${path}`, { method, headers, body }), options.deps ?? ctx.deps);
}

async function insertTrack(ctx: Ctx, userId: number, title: string): Promise<number> {
  const [row] = await ctx.sql`
    insert into loopbot_test.tracks (user_id, title, file_id)
    values (${userId}, ${title}, ${"file-" + title}) returning id`;
  return Number(row.id);
}

async function createPlaylistVia(ctx: Ctx, name: string, trackIds: number[]): Promise<number> {
  const res = await call(ctx, "POST", "/playlists", { body: { name, track_ids: trackIds } });
  return (await res.json()).id;
}

// Auth failures must answer before any DB call, so these run without LOOPBOT_TEST_DATABASE_URL.
const untouchedDb = {} as Db;

function authOnlyDeps(): Deps {
  return depsWith(untouchedDb);
}

Deno.test("answers 401 expired when initData is missing", async () => {
  const req = new Request(`${ORIGIN}/loopbot-api/state`, { headers: { "x-telegram-init-data": "" } });
  const res = await handle(req, authOnlyDeps());

  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "expired" });
});

Deno.test("answers 403 forbidden for a user outside the allowed set", async () => {
  const req = new Request(`${ORIGIN}/loopbot-api/state`, {
    headers: { "x-telegram-init-data": await signFor(STRANGER) },
  });
  const res = await handle(req, authOnlyDeps());

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

// Stub DB for the auth-only cases: GET /state only reads state, and no username is in the DB list, so no Postgres is needed.
const stateOnlyDb = {
  state: async () => ({ library: [], playlists: [], active_id: null }),
  isUsernameAllowed: async () => false,
} as unknown as Db;

async function getStateAs(allowedUsernames: string[], userId: number, username?: string): Promise<Response> {
  const deps = depsWith(stateOnlyDb, { allowedUsernames: new Set(allowedUsernames) });
  const req = new Request(`${ORIGIN}/loopbot-api/state`, {
    headers: { "x-telegram-init-data": await signFor(userId, username) },
  });
  return handle(req, deps);
}

Deno.test("admits a user outside the id list by an allowed username, ignoring case", async () => {
  const res = await getStateAs(["some_user"], STRANGER, "SOME_USER");

  assertEquals(res.status, 200);
});

Deno.test("answers 403 for a user outside the id list whose username is not allowed", async () => {
  const res = await getStateAs(["some_user"], STRANGER, "other");

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("answers 403 for a user outside the id list who has no username", async () => {
  const res = await getStateAs(["some_user"], STRANGER);

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("parseUsernames trims, strips @, lowercases, and drops blank entries", () => {
  assertEquals(parseUsernames("@Some_User, other ,,"), new Set(["some_user", "other"]));
  assertEquals(parseUsernames(" , "), new Set());
});

Deno.test("parseNewUsername trims, strips one leading @, lowercases, and rejects invalid names", () => {
  assertEquals(parseNewUsername("  @Some_User "), "some_user");
  assertEquals(parseNewUsername("abcde"), "abcde");
  assertEquals(parseNewUsername("a".repeat(32)), "a".repeat(32));
  assertEquals(parseNewUsername("@@abcde"), null);
  assertEquals(parseNewUsername("@"), null);
  for (const raw of ["abc", "has space", "bad-name", "a".repeat(33), "", 12345, null, undefined, ["abcde"]]) {
    assertEquals(parseNewUsername(raw), null, String(raw));
  }
});

dbTest("GET /state creates an active 기본 playlist for a new user", async (ctx) => {
  const res = await call(ctx, "GET", "/state");
  const state = await res.json();

  assertEquals(res.status, 200);
  assertEquals(state.library, []);
  assertEquals(state.playlists.map((p: { name: string }) => p.name), ["기본"]);
  assertEquals(state.active_id, state.playlists[0].id);
  assertEquals(typeof state.active_id, "number");
  assertEquals(typeof state.playlists[0].id, "number");
});

dbTest("routes with and without the function name prefix", async (ctx) => {
  const headers = { "x-telegram-init-data": await signFor(ALLOWED_USER) };
  const bare = await handle(new Request(`${ORIGIN}/state`, { headers }), ctx.deps);
  const prefixed = await handle(new Request(`${ORIGIN}/loopbot-api/state`, { headers }), ctx.deps);

  assertEquals(bare.status, 200);
  assertEquals(prefixed.status, 200);
});

dbTest("POST /playlists trims, truncates to 20 characters, and defaults a blank name", async (ctx) => {
  const trimmed = await (await call(ctx, "POST", "/playlists", { body: { name: "  노래  ", track_ids: [] } })).json();
  const long = await (await call(ctx, "POST", "/playlists", { body: { name: "가".repeat(21), track_ids: [] } })).json();
  const blank = await (await call(ctx, "POST", "/playlists", { body: { name: "   ", track_ids: [] } })).json();

  assertEquals(trimmed.name, "노래");
  assertEquals(long.name, "가".repeat(20));
  assertEquals(blank.name, "새 플레이리스트");
  assertEquals((await ctx.db.state(ALLOWED_USER)).active_id, blank.id);
});

dbTest("POST /playlists keeps own tracks in first-seen order and drops unknown or foreign ids", async (ctx) => {
  const mine1 = await insertTrack(ctx, ALLOWED_USER, "a");
  const mine2 = await insertTrack(ctx, ALLOWED_USER, "b");
  const foreign = await insertTrack(ctx, OTHER_USER, "c");

  const res = await call(ctx, "POST", "/playlists", {
    body: { name: "x", track_ids: [mine2, foreign, 999999999, mine1, mine2] },
  });

  assertEquals((await res.json()).track_ids, [mine2, mine1]);
});

dbTest("PUT /playlists/:id keeps the given order and makes the playlist active", async (ctx) => {
  const a = await insertTrack(ctx, ALLOWED_USER, "a");
  const b = await insertTrack(ctx, ALLOWED_USER, "b");
  const c = await insertTrack(ctx, ALLOWED_USER, "c");
  const id = await createPlaylistVia(ctx, "p", [a]);

  const res = await call(ctx, "PUT", `/playlists/${id}`, { body: { name: "q", track_ids: [c, a, b] } });

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { id, name: "q", track_ids: [c, a, b] });
  assertEquals((await ctx.db.state(ALLOWED_USER)).active_id, id);
});

dbTest("PUT /playlists/:id answers 404 for another user's playlist and leaves it unchanged", async (ctx) => {
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");
  const foreignPlaylist = await ctx.db.createPlaylist(OTHER_USER, "other", [theirs]);

  const res = await call(ctx, "PUT", `/playlists/${foreignPlaylist.id}`, {
    body: { name: "hijack", track_ids: [] },
  });

  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
  assertEquals((await ctx.db.state(OTHER_USER)).playlists[0], { ...foreignPlaylist, shared: false });
});

dbTest("PUT /playlists/:id and POST /playlists reject non-array track_ids and boolean entries", async (ctx) => {
  const id = await createPlaylistVia(ctx, "p", []);
  const cases = [{ name: "x", track_ids: "abc" }, { name: "x", track_ids: [1, true] }];

  for (const body of cases) {
    const put = await call(ctx, "PUT", `/playlists/${id}`, { body });
    const post = await call(ctx, "POST", "/playlists", { body });
    assertEquals(put.status, 400);
    assertEquals(await put.json(), { error: "bad_request" });
    assertEquals(post.status, 400);
    assertEquals(await post.json(), { error: "bad_request" });
  }
});

dbTest("DELETE of the active playlist activates the highest remaining id", async (ctx) => {
  const p1 = await createPlaylistVia(ctx, "one", []);
  const p2 = await createPlaylistVia(ctx, "two", []);
  const p3 = await createPlaylistVia(ctx, "three", []);

  const deleteOther = await call(ctx, "DELETE", `/playlists/${p2}`);
  assertEquals(await deleteOther.json(), { active_id: p3 });

  const deleteActive = await call(ctx, "DELETE", `/playlists/${p3}`);
  assertEquals(await deleteActive.json(), { active_id: p1 });
});

dbTest("DELETE of the last playlist recreates 기본", async (ctx) => {
  const only = await createPlaylistVia(ctx, "only", []);

  const res = await call(ctx, "DELETE", `/playlists/${only}`);
  const state = await ctx.db.state(ALLOWED_USER);

  assertEquals(res.status, 200);
  assertEquals(state.playlists.map((p) => p.name), ["기본"]);
  assertEquals(state.active_id, state.playlists[0].id);
});

dbTest("DELETE /tracks/:id removes the track from every playlist", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "t");
  const keep = await insertTrack(ctx, ALLOWED_USER, "keep");
  await createPlaylistVia(ctx, "one", [t, keep]);
  await createPlaylistVia(ctx, "two", [t]);

  const res = await call(ctx, "DELETE", `/tracks/${t}`);
  const state = await ctx.db.state(ALLOWED_USER);

  assertEquals(res.status, 204);
  assertEquals(state.library.map((x) => x.id), [keep]);
  assertEquals(state.playlists.map((p) => p.track_ids), [[keep], []]);
});

dbTest("DELETE /tracks/:id answers 404 for another user's track and keeps it", async (ctx) => {
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");

  const res = await call(ctx, "DELETE", `/tracks/${theirs}`);

  assertEquals(res.status, 404);
  assertEquals(await ctx.db.fileId(OTHER_USER, theirs), "file-theirs");
});

dbTest("OPTIONS answers the CORS preflight for the Pages origin", async (ctx) => {
  const res = await handle(new Request(`${ORIGIN}/loopbot-api/state`, { method: "OPTIONS" }), ctx.deps);

  assertEquals(res.headers.get("access-control-allow-origin"), "https://hanrio.github.io");
  assertStringIncludes(res.headers.get("access-control-allow-headers") ?? "", "x-telegram-init-data");
});

dbTest("GET /tracks/:id/file streams the Telegram bytes", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const requested: string[] = [];
  const fetchStub = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/getFile")) {
      return Response.json({ ok: true, result: { file_path: "music/song.mp3" } });
    }
    return new Response("AUDIO", { headers: { "content-type": "audio/mpeg", "content-length": "5" } });
  }) as typeof fetch;

  const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "AUDIO");
  assertEquals(res.headers.get("content-type"), "audio/mp4");
  assertEquals(res.headers.get("cache-control"), "private, max-age=31536000");
  assertEquals(res.headers.get("content-length"), "5");
  assertEquals(res.headers.get("access-control-allow-origin"), "https://hanrio.github.io");
  assertEquals(requested.length, 2);
});

dbTest("GET /tracks/:id/file answers 502 upstream when getFile fails for another reason", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "bad");
  const requested: string[] = [];
  const fetchStub = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return Response.json({ ok: false, error_code: 400, description: "Bad Request: wrong file_id" });
  }) as typeof fetch;
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

    assertEquals(res.status, 502);
    assertEquals(await res.json(), { error: "upstream" });
  } finally {
    console.error = originalError;
  }
  assertEquals(requested.length, 1);
});

dbTest("GET /tracks/:id/file answers 404 for another user's track without calling Telegram", async (ctx) => {
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");
  const requested: string[] = [];
  const fetchStub = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return Response.json({ ok: true, result: { file_path: "music/x.mp3" } });
  }) as typeof fetch;

  const res = await call(ctx, "GET", `/tracks/${theirs}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
  assertEquals(requested.length, 0);
});

dbTest("GET /tracks/:id/file error responses never contain the bot token", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "err");
  const failures: typeof fetch[] = [
    (async () => Response.json({ ok: false, description: "Bad Request: file is too big" })) as typeof fetch,
    (async () => Response.json({ ok: false, description: "Bad Request: wrong file_id" })) as typeof fetch,
    (async () => new Response("gone", { status: 404 })) as typeof fetch,
    (async (input: string | URL | Request) => {
      throw new Error(`error sending request for url (${String(input)})`);
    }) as typeof fetch,
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const fetchStub of failures) {
      const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

      assertEquals(res.status >= 400, true);
      assertEquals((await res.text()).includes(BOT_TOKEN), false);
    }
  } finally {
    console.error = originalError;
  }
});

dbTest("GET /tracks/:id/file answers 413 too_big when Telegram rejects the size", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "huge");
  const fetchStub = (async () =>
    Response.json({ ok: false, error_code: 400, description: "Bad Request: file is too big" })) as typeof fetch;

  const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

  assertEquals(res.status, 413);
  assertEquals(await res.json(), { error: "too_big" });
});

dbTest("upstream failure answers 502 and logs the message without the bot token", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "down");
  const fetchStub = (async (input: string | URL | Request) => {
    throw new Error(`error sending request for url (${String(input)})`);
  }) as typeof fetch;
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

    assertEquals(res.status, 502);
    assertEquals(await res.json(), { error: "upstream" });
  } finally {
    console.error = originalError;
  }
  assertEquals(logged.length, 1);
  assertEquals(logged[0].includes(BOT_TOKEN), false);
});

dbTest("PUT /active sets the active playlist to the given one", async (ctx) => {
  const p1 = await createPlaylistVia(ctx, "one", []);
  await createPlaylistVia(ctx, "two", []);

  const res = await call(ctx, "PUT", "/active", { body: { playlist_id: p1 } });

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { active_id: p1 });
  assertEquals((await ctx.db.state(ALLOWED_USER)).active_id, p1);
});

dbTest("PUT /active answers 404 for another user's playlist and keeps the active one", async (ctx) => {
  const mine = await createPlaylistVia(ctx, "mine", []);
  const theirs = await ctx.db.createPlaylist(OTHER_USER, "theirs", []);

  const res = await call(ctx, "PUT", "/active", { body: { playlist_id: theirs.id } });

  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
  assertEquals((await ctx.db.state(ALLOWED_USER)).active_id, mine);
});

dbTest("POST /playlists and PUT /active answer 400 for a body that is not JSON", async (ctx) => {
  const id = await createPlaylistVia(ctx, "p", []);

  for (const [method, path] of [["POST", "/playlists"], ["PUT", "/active"]] as const) {
    const res = await call(ctx, method, path, { rawBody: "{not json" });

    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "bad_request" });
  }
  assertEquals((await ctx.db.state(ALLOWED_USER)).active_id, id);
});

dbTest("POST /playlists and PUT /active answer 400 for a JSON body that is not an object", async (ctx) => {
  for (const rawBody of ["[]", "null", "42", "\"text\""]) {
    for (const [method, path] of [["POST", "/playlists"], ["PUT", "/active"]] as const) {
      const res = await call(ctx, method, path, { rawBody });

      assertEquals(res.status, 400);
      assertEquals(await res.json(), { error: "bad_request" });
    }
  }
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const MAX_SHEET_BYTES = 10 * 1024 * 1024;

interface SentCall {
  url: string;
  body: unknown;
}

// Fake Telegram: records every call. sendDocument answers with fileId (null means no file_id).
function telegramStub(fileId: string | null = "sheet-file-1", calls: SentCall[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body });
    if (url.includes("/sendDocument")) {
      const document = fileId === null ? undefined : { file_id: fileId };
      return Response.json({ ok: true, result: { message_id: 77, document } });
    }
    if (url.includes("/deleteMessage")) return Response.json({ ok: true, result: true });
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_path: "music/x.mp3" } });
    return new Response("BYTES");
  }) as typeof fetch;
}

// Fake Telegram whose download body is the file id, so a test can tell which page it got.
function echoTelegram(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/getFile")) {
      return Response.json({ ok: true, result: { file_path: `music/${url.searchParams.get("file_id")}.jpg` } });
    }
    return new Response(url.pathname.split("/").pop());
  }) as typeof fetch;
}

async function uploadSheet(
  ctx: Ctx,
  trackId: number,
  bytes: Uint8Array<ArrayBuffer>,
  fetchStub: typeof fetch,
  options: { userId?: number; contentType?: string } = {},
): Promise<Response> {
  const req = new Request(`${ORIGIN}/loopbot-api/tracks/${trackId}/sheet`, {
    method: "POST",
    headers: {
      "x-telegram-init-data": await signFor(options.userId ?? ALLOWED_USER),
      "content-type": options.contentType ?? "image/jpeg",
    },
    body: bytes,
  });
  return handle(req, depsWith(ctx.db, { fetch: fetchStub }));
}

// ALLOWED_USER is the admin; this playlist is shared with every member.
async function sharedPlaylistWith(ctx: Ctx, title: string): Promise<{ playlistId: number; trackId: number }> {
  const trackId = await insertTrack(ctx, ALLOWED_USER, title);
  const playlistId = await createPlaylistVia(ctx, "shared", [trackId]);
  const res = await call(ctx, "PUT", `/playlists/${playlistId}/shared`, { body: { shared: true } });
  assertEquals(res.status, 200);
  return { playlistId, trackId };
}

dbTest("admin-only routes answer 403 to a member", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const p = await createPlaylistVia(ctx, "p", [t]);
  const cases: [string, string, unknown][] = [
    ["PUT", `/playlists/${p}/shared`, { shared: true }],
    ["POST", `/tracks/${t}/sheet`, {}],
    ["DELETE", `/tracks/${t}/sheet/0`, undefined],
    ["PUT", `/tracks/${t}/video`, { url: "https://youtu.be/aaaaaaaaaaa" }],
  ];

  for (const [method, path, body] of cases) {
    const res = await call(ctx, method, path, { userId: OTHER_USER, body });

    assertEquals(res.status, 403);
    assertEquals(await res.json(), { error: "forbidden" });
  }
});

dbTest("a username never grants admin rights", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const deps = depsWith(ctx.db, { allowedUsernames: new Set(["some_user"]) });
  const initData = await signFor(STRANGER, "some_user");

  const res = await call(ctx, "DELETE", `/tracks/${t}/sheet/0`, { initData, deps });

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

dbTest("a member's state shows the shared playlist, its tracks and media until unshared", async (ctx) => {
  const { playlistId, trackId } = await sharedPlaylistWith(ctx, "shared-song");
  await ctx.db.saveVideo(ALLOWED_USER, trackId, "aaaaaaaaaaa");

  const adminState = await (await call(ctx, "GET", "/state")).json();
  assertEquals(adminState.is_admin, true);
  assertEquals(adminState.playlists[0].shared, true);
  assertEquals(adminState.shared_playlists, []);

  const memberState = await (await call(ctx, "GET", "/state", { userId: OTHER_USER })).json();
  assertEquals(memberState.is_admin, false);
  assertEquals(memberState.shared_playlists, [{ id: playlistId, name: "shared", track_ids: [trackId] }]);
  assertEquals(memberState.shared_tracks.map((t: { id: number }) => t.id), [trackId]);
  assertEquals(memberState.shared_tracks[0].title, "shared-song");
  assertEquals(memberState.media, { [trackId]: { sheet_version: null, sheet_count: 0, video_id: "aaaaaaaaaaa" } });

  await call(ctx, "PUT", `/playlists/${playlistId}/shared`, { body: { shared: false } });
  const unshared = await (await call(ctx, "GET", "/state", { userId: OTHER_USER })).json();
  assertEquals(unshared.shared_playlists, []);
  assertEquals(unshared.shared_tracks, []);
  assertEquals(unshared.media, {});
});

dbTest("a member reads a shared track's audio and sheet only while the playlist is shared", async (ctx) => {
  const { playlistId, trackId } = await sharedPlaylistWith(ctx, "s");
  const hidden = await insertTrack(ctx, ALLOWED_USER, "hidden");
  await ctx.db.saveSheet(ALLOWED_USER, trackId, "sheet-1");
  await ctx.db.saveSheet(ALLOWED_USER, hidden, "sheet-h");
  const deps = depsWith(ctx.db, { fetch: telegramStub() });

  const file = await call(ctx, "GET", `/tracks/${trackId}/file`, { userId: OTHER_USER, deps });
  const sheet = await call(ctx, "GET", `/tracks/${trackId}/sheet`, { userId: OTHER_USER, deps });

  assertEquals(file.status, 200);
  assertEquals(sheet.status, 200);
  assertEquals(sheet.headers.get("content-type"), "image/jpeg");

  await call(ctx, "PUT", `/playlists/${playlistId}/shared`, { body: { shared: false } });

  assertEquals((await call(ctx, "GET", `/tracks/${trackId}/file`, { userId: OTHER_USER, deps })).status, 404);
  assertEquals((await call(ctx, "GET", `/tracks/${trackId}/sheet`, { userId: OTHER_USER, deps })).status, 404);
  assertEquals((await call(ctx, "GET", `/tracks/${hidden}/file`, { userId: OTHER_USER, deps })).status, 404);
  assertEquals((await call(ctx, "GET", `/tracks/${hidden}/sheet`, { userId: OTHER_USER, deps })).status, 404);
});

dbTest("a member gets 404 for playlist writes on the admin's shared playlist", async (ctx) => {
  const { playlistId } = await sharedPlaylistWith(ctx, "s");

  const put = await call(ctx, "PUT", `/playlists/${playlistId}`, {
    userId: OTHER_USER,
    body: { name: "hijack", track_ids: [] },
  });
  const del = await call(ctx, "DELETE", `/playlists/${playlistId}`, { userId: OTHER_USER });
  const active = await call(ctx, "PUT", "/active", { userId: OTHER_USER, body: { playlist_id: playlistId } });

  for (const res of [put, del, active]) {
    assertEquals(res.status, 404);
    assertEquals(await res.json(), { error: "not_found" });
  }
  assertEquals((await ctx.db.state(ALLOWED_USER)).playlists.map((p) => p.name), ["shared"]);
});

dbTest("notes are per user, only for readable tracks, and blank notes delete", async (ctx) => {
  const { playlistId, trackId } = await sharedPlaylistWith(ctx, "s");
  const hidden = await insertTrack(ctx, ALLOWED_USER, "hidden");

  assertEquals((await call(ctx, "PUT", `/tracks/${trackId}/note`, { body: { body: "admin thoughts" } })).status, 204);
  assertEquals(
    (await call(ctx, "PUT", `/tracks/${trackId}/note`, { userId: OTHER_USER, body: { body: "member thoughts" } })).status,
    204,
  );
  const adminNotes = (await (await call(ctx, "GET", "/state")).json()).notes;
  const memberNotes = (await (await call(ctx, "GET", "/state", { userId: OTHER_USER })).json()).notes;
  assertEquals(adminNotes, { [trackId]: "admin thoughts" });
  assertEquals(memberNotes, { [trackId]: "member thoughts" });

  const hiddenNote = await call(ctx, "PUT", `/tracks/${hidden}/note`, { userId: OTHER_USER, body: { body: "x" } });
  assertEquals(hiddenNote.status, 404);

  await call(ctx, "PUT", `/tracks/${trackId}/note`, { userId: OTHER_USER, body: { body: "" } });
  assertEquals((await (await call(ctx, "GET", "/state", { userId: OTHER_USER })).json()).notes, {});

  const tooLong = await call(ctx, "PUT", `/tracks/${trackId}/note`, { body: { body: "가".repeat(10001) } });
  assertEquals(tooLong.status, 400);
  assertEquals(await tooLong.json(), { error: "bad_request" });

  await call(ctx, "PUT", `/playlists/${playlistId}/shared`, { body: { shared: false } });
  assertEquals((await (await call(ctx, "GET", "/state")).json()).notes, { [trackId]: "admin thoughts" });
  assertEquals((await call(ctx, "PUT", `/tracks/${trackId}/note`, { userId: OTHER_USER, body: { body: "x" } })).status, 404);
});

dbTest("PUT /tracks/:id renames the owner's track, rejects blank titles, and hides others'", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "old");
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");

  const renamed = await call(ctx, "PUT", `/tracks/${t}`, { body: { title: "  새 제목  " } });
  assertEquals(renamed.status, 200);
  assertEquals(await renamed.json(), { id: t, title: "새 제목" });

  const blank = await call(ctx, "PUT", `/tracks/${t}`, { body: { title: "   " } });
  assertEquals(blank.status, 400);
  assertEquals(await blank.json(), { error: "bad_request" });

  assertEquals((await call(ctx, "PUT", `/tracks/${theirs}`, { body: { title: "x" } })).status, 404);

  const long = await (await call(ctx, "PUT", `/tracks/${t}`, { body: { title: "가".repeat(201) } })).json();
  assertEquals(long.title, "가".repeat(200));
});

dbTest("POST /tracks/:id/sheet appends each photo as the next page and bumps the version", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");

  const first = await uploadSheet(ctx, t, JPEG, telegramStub("sheet-1"));
  assertEquals(first.status, 200);
  assertEquals(await first.json(), { version: 1, count: 1 });

  const second = await uploadSheet(ctx, t, JPEG, telegramStub("sheet-2"));
  assertEquals(await second.json(), { version: 2, count: 2 });
  const third = await uploadSheet(ctx, t, JPEG, telegramStub("sheet-3"));
  assertEquals(await third.json(), { version: 3, count: 3 });

  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 0), "sheet-1");
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 1), "sheet-2");
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 2), "sheet-3");
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t], { sheet_version: 3, sheet_count: 3, video_id: null });
});

dbTest("GET /tracks/:id/sheet/:page streams each page, and /sheet is page 0", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  await uploadSheet(ctx, t, JPEG, telegramStub("sheet-a"));
  await uploadSheet(ctx, t, JPEG, telegramStub("sheet-b"));
  const deps = depsWith(ctx.db, { fetch: echoTelegram() });

  const first = await call(ctx, "GET", `/tracks/${t}/sheet/0`, { deps });
  const second = await call(ctx, "GET", `/tracks/${t}/sheet/1`, { deps });
  const legacy = await call(ctx, "GET", `/tracks/${t}/sheet`, { deps });

  assertEquals(first.headers.get("content-type"), "image/jpeg");
  assertEquals(await first.text(), "sheet-a.jpg");
  assertEquals(await second.text(), "sheet-b.jpg");
  assertEquals(await legacy.text(), "sheet-a.jpg");
});

dbTest("GET and DELETE of a page past the last one answer 404 without touching Telegram", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const empty = await call(ctx, "GET", `/tracks/${t}/sheet/0`);
  await ctx.db.saveSheet(ALLOWED_USER, t, "sheet-1");
  await ctx.db.saveSheet(ALLOWED_USER, t, "sheet-2");

  const past = await call(ctx, "GET", `/tracks/${t}/sheet/2`);
  const deleted = await call(ctx, "DELETE", `/tracks/${t}/sheet/5`);

  assertEquals(empty.status, 404);
  assertEquals(past.status, 404);
  assertEquals(await past.json(), { error: "not_found" });
  assertEquals(deleted.status, 404);
  assertEquals(await deleted.json(), { error: "not_found" });
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t].sheet_count, 2);
});

dbTest("DELETE /tracks/:id/sheet/:page shifts later pages down and bumps the version", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  for (const fileId of ["sheet-a", "sheet-b", "sheet-c"]) await ctx.db.saveSheet(ALLOWED_USER, t, fileId);

  const res = await call(ctx, "DELETE", `/tracks/${t}/sheet/1`);

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { version: 4, count: 2 });
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 0), "sheet-a");
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 1), "sheet-c");
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 2), null);
});

dbTest("the 21st photo answers 409 too_many and the sheet keeps its 20 pages", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  for (let i = 1; i <= 20; i++) await ctx.db.saveSheet(ALLOWED_USER, t, `sheet-${i}`);

  const res = await uploadSheet(ctx, t, JPEG, telegramStub("sheet-21"));

  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "too_many" });
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t], { sheet_version: 20, sheet_count: 20, video_id: null });
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 19), "sheet-20");
});

dbTest("a member reads each shared page only while the playlist is shared", async (ctx) => {
  const { playlistId, trackId } = await sharedPlaylistWith(ctx, "s");
  await ctx.db.saveSheet(ALLOWED_USER, trackId, "sheet-1");
  await ctx.db.saveSheet(ALLOWED_USER, trackId, "sheet-2");
  const deps = depsWith(ctx.db, { fetch: telegramStub() });

  assertEquals((await call(ctx, "GET", `/tracks/${trackId}/sheet/1`, { userId: OTHER_USER, deps })).status, 200);

  await call(ctx, "PUT", `/playlists/${playlistId}/shared`, { body: { shared: false } });

  assertEquals((await call(ctx, "GET", `/tracks/${trackId}/sheet/0`, { userId: OTHER_USER, deps })).status, 404);
  assertEquals((await call(ctx, "GET", `/tracks/${trackId}/sheet/1`, { userId: OTHER_USER, deps })).status, 404);
});

dbTest("sheet upload sends a silent JPEG document to the admin chat, then deletes that message", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const calls: SentCall[] = [];

  const res = await uploadSheet(ctx, t, JPEG, telegramStub("sheet-1", calls));

  assertEquals(res.status, 200);
  const form = calls.find((c) => c.url.includes("/sendDocument"))!.body as FormData;
  assertEquals(form.get("chat_id"), String(ALLOWED_USER));
  assertEquals(form.get("disable_notification"), "true");
  assertEquals((form.get("document") as File).name, "sheet.jpg");
  const deleted = calls.find((c) => c.url.includes("/deleteMessage"))!.body;
  assertEquals(JSON.parse(deleted as string), { chat_id: ALLOWED_USER, message_id: 77 });
});

dbTest("a sheet upload without a file id answers 502 and keeps the old sheet", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  await uploadSheet(ctx, t, JPEG, telegramStub("sheet-1"));
  const originalError = console.error;
  console.error = () => {};
  try {
    const broken = await uploadSheet(ctx, t, JPEG, telegramStub(null));

    assertEquals(broken.status, 502);
    assertEquals(await broken.json(), { error: "upstream" });
  } finally {
    console.error = originalError;
  }
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 0), "sheet-1");
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t].sheet_version, 1);
});

dbTest("POST /tracks/:id/sheet answers 413 over 10MB, 400 for another type, and 404 for another's track without Telegram", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");
  const calls: SentCall[] = [];
  const stub = telegramStub("x", calls);

  const tooBig = await uploadSheet(ctx, t, new Uint8Array(MAX_SHEET_BYTES + 1), stub);
  assertEquals(tooBig.status, 413);
  assertEquals(await tooBig.json(), { error: "too_big" });

  const png = await uploadSheet(ctx, t, JPEG, stub, { contentType: "image/png" });
  assertEquals(png.status, 400);
  assertEquals(await png.json(), { error: "bad_request" });

  const foreign = await uploadSheet(ctx, theirs, JPEG, stub);
  assertEquals(foreign.status, 404);
  assertEquals(calls.length, 0);
});

dbTest("POST /tracks/:id/sheet stops reading a chunked body past 10MB and answers 413", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const CHUNK_BYTES = 1024 * 1024;
  const CHUNK_COUNT = 20;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (pulled === CHUNK_COUNT) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(CHUNK_BYTES));
    },
  });
  const req = new Request(`${ORIGIN}/loopbot-api/tracks/${t}/sheet`, {
    method: "POST",
    headers: { "x-telegram-init-data": await signFor(ALLOWED_USER), "content-type": "image/jpeg" },
    body,
  });

  const res = await handle(req, depsWith(ctx.db, { fetch: telegramStub() }));

  assertEquals(res.status, 413);
  assertEquals(await res.json(), { error: "too_big" });
  assertEquals(pulled < CHUNK_COUNT, true);
});

dbTest("POST /tracks/:id/sheet answers 400 when the request has no body", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const req = new Request(`${ORIGIN}/loopbot-api/tracks/${t}/sheet`, {
    method: "POST",
    headers: { "x-telegram-init-data": await signFor(ALLOWED_USER), "content-type": "image/jpeg" },
  });

  const res = await handle(req, depsWith(ctx.db));

  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "bad_request" });
});

dbTest("DELETE /tracks/:id/sheet/:page clears the last page to version null and count 0, and versions keep counting", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  await ctx.db.saveSheet(ALLOWED_USER, t, "sheet-1");

  const res = await call(ctx, "DELETE", `/tracks/${t}/sheet/0`);

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { version: 2, count: 0 });
  assertEquals(await ctx.db.sheetFileId(ALLOWED_USER, t, 0), null);
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t], { sheet_version: null, sheet_count: 0, video_id: null });
  assertEquals(await ctx.db.saveSheet(ALLOWED_USER, t, "sheet-2"), { version: 3, count: 1 });
});

dbTest("PUT /tracks/:id/video stores only the YouTube id, clears on blank, and rejects other links", async (ctx) => {
  const t = await insertTrack(ctx, ALLOWED_USER, "song");
  const theirs = await insertTrack(ctx, OTHER_USER, "theirs");

  const saved = await call(ctx, "PUT", `/tracks/${t}/video`, { body: { url: "https://youtu.be/aaaaaaaaaaa" } });
  assertEquals(await saved.json(), { video_id: "aaaaaaaaaaa" });
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t].video_id, "aaaaaaaaaaa");

  const rejected = await call(ctx, "PUT", `/tracks/${t}/video`, { body: { url: "https://evil.com/watch?v=aaaaaaaaaaa" } });
  assertEquals(rejected.status, 400);
  assertEquals(await rejected.json(), { error: "bad_request" });

  const cleared = await call(ctx, "PUT", `/tracks/${t}/video`, { body: { url: "   " } });
  assertEquals(await cleared.json(), { video_id: null });
  assertEquals((await ctx.db.state(ALLOWED_USER)).media[t].video_id, null);

  const foreign = await call(ctx, "PUT", `/tracks/${theirs}/video`, { body: { url: "https://youtu.be/aaaaaaaaaaa" } });
  assertEquals(foreign.status, 404);
});

dbTest("deleting a track also removes its media and every user's notes", async (ctx) => {
  const { trackId } = await sharedPlaylistWith(ctx, "s");
  await ctx.db.saveSheet(ALLOWED_USER, trackId, "sheet-1");
  await call(ctx, "PUT", `/tracks/${trackId}/note`, { userId: OTHER_USER, body: { body: "memo" } });

  const res = await call(ctx, "DELETE", `/tracks/${trackId}`);

  assertEquals(res.status, 204);
  const [media] = await ctx.sql`select count(*)::int as n from loopbot_test.track_media where track_id = ${trackId}`;
  const [notes] = await ctx.sql`select count(*)::int as n from loopbot_test.track_notes where track_id = ${trackId}`;
  assertEquals(media.n, 0);
  assertEquals(notes.n, 0);
});

dbTest("admin username routes answer 403 to a non-admin allowed user and to a stranger", async (ctx) => {
  await ctx.db.addUsername("keeper", ALLOWED_USER);
  const cases: [string, string, unknown][] = [
    ["GET", "/admin/usernames", undefined],
    ["POST", "/admin/usernames", { username: "someone" }],
    ["DELETE", "/admin/usernames/keeper", undefined],
  ];

  for (const userId of [OTHER_USER, STRANGER]) {
    for (const [method, path, body] of cases) {
      const res = await call(ctx, method, path, { userId, body });

      assertEquals(res.status, 403);
      assertEquals(await res.json(), { error: "forbidden" });
    }
  }
  assertEquals(await ctx.db.listUsernames(), ["keeper"]);
});

dbTest("admin adds a username, stored lowercase, and that user is then admitted in any case", async (ctx) => {
  const before = await call(ctx, "GET", "/state", { initData: await signFor(NAMED_USER, "SOME_USER") });
  assertEquals(before.status, 403);

  const added = await call(ctx, "POST", "/admin/usernames", { body: { username: "  @Some_User " } });
  assertEquals(added.status, 200);
  assertEquals(await added.json(), { username: "some_user" });
  assertEquals(await ctx.db.listUsernames(), ["some_user"]);

  const after = await call(ctx, "GET", "/state", { initData: await signFor(NAMED_USER, "SOME_USER") });
  assertEquals(after.status, 200);
  assertEquals((await after.json()).is_admin, false);
});

dbTest("DELETE removes a username, and that user gets 403 again", async (ctx) => {
  await call(ctx, "POST", "/admin/usernames", { body: { username: "@Some_User" } });
  const initData = await signFor(NAMED_USER, "some_user");
  assertEquals((await call(ctx, "GET", "/state", { initData })).status, 200);

  const removed = await call(ctx, "DELETE", "/admin/usernames/some_user");
  assertEquals(removed.status, 204);

  const res = await call(ctx, "GET", "/state", { initData });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
  assertEquals(await ctx.db.listUsernames(), []);
});

dbTest("POST /admin/usernames answers 400 for invalid names and stores nothing", async (ctx) => {
  const bodies: unknown[] = [{ username: "abc" }, { username: "has space" }, { username: 12345 }, { username: "a".repeat(33) }, {}];

  for (const body of bodies) {
    const res = await call(ctx, "POST", "/admin/usernames", { body });

    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "bad_request" });
  }
  assertEquals(await ctx.db.listUsernames(), []);
});

dbTest("DELETE /admin/usernames/:name answers 404 for a name that is not on the list", async (ctx) => {
  const res = await call(ctx, "DELETE", "/admin/usernames/nobody1");

  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

dbTest("adding the same username twice is fine and keeps one row", async (ctx) => {
  const first = await call(ctx, "POST", "/admin/usernames", { body: { username: "some_user" } });
  const second = await call(ctx, "POST", "/admin/usernames", { body: { username: "some_user" } });

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(await ctx.db.listUsernames(), ["some_user"]);
});

dbTest("GET /admin/usernames lists usernames in ascending order", async (ctx) => {
  await ctx.db.addUsername("zed_user", ALLOWED_USER);
  await ctx.db.addUsername("alpha_user", ALLOWED_USER);

  const res = await call(ctx, "GET", "/admin/usernames");

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { usernames: ["alpha_user", "zed_user"] });
});

Deno.test("youtubeId accepts each YouTube link form and rejects everything else", () => {
  const id = "aaaaaaaaaaa";
  const accepted = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=10`,
    `http://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://youtu.be/${id}?si=x`,
  ];
  const rejected = [
    "https://evil.com/watch?v=aaaaaaaaaaa",
    `https://www.youtube.com/watch?v=${"a".repeat(10)}`,
    `https://www.youtube.com/watch?v=${"a".repeat(12)}`,
    "https://www.youtube.com/watch?v=aaaaaaaaaa!",
    "javascript:alert(1)",
    `ftp://youtu.be/${id}`,
    "not a url",
  ];

  for (const url of accepted) assertEquals(youtubeId(url), id, url);
  for (const url of rejected) assertEquals(youtubeId(url), null, url);
});
