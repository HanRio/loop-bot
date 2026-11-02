import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import postgres from "postgres";
import { handle, type Deps } from "./app.ts";
import { createDb, type Db } from "./db.ts";

const dsn = Deno.env.get("LOOPBOT_TEST_DATABASE_URL") ?? "";
const SCHEMA = "loopbot_test";
const ORIGIN = "https://example.test";
const BOT_TOKEN = "0000000000:test-bot-token";
const NOW = 1_800_000_000;
const ALLOWED_USER = 900001;
const OTHER_USER = 900002;
const STRANGER = 900003;
const TEST_USERS = [ALLOWED_USER, OTHER_USER];

// Test-only signer, same Telegram rules as auth_test.ts.
async function signFor(userId: number): Promise<string> {
  const encoder = new TextEncoder();
  const fields: [string, string][] = [
    ["auth_date", String(NOW)],
    ["user", JSON.stringify({ id: userId })],
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
    db,
    fetch: unexpectedFetch,
    now: () => NOW,
    ...overrides,
  };
}

// Each test starts from an empty state for the two test users only.
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
  options: { body?: unknown; userId?: number; initData?: string; deps?: Deps } = {},
): Promise<Response> {
  const initData = options.initData ?? (await signFor(options.userId ?? ALLOWED_USER));
  const headers: Record<string, string> = { "x-telegram-init-data": initData, "content-type": "application/json" };
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
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

dbTest("answers 401 expired when initData is missing", async (ctx) => {
  const res = await call(ctx, "GET", "/state", { initData: "" });

  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "expired" });
});

dbTest("answers 403 forbidden for a user outside the allowed set", async (ctx) => {
  const res = await call(ctx, "GET", "/state", { userId: STRANGER });

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
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
  assertEquals((await ctx.db.state(OTHER_USER)).playlists[0], foreignPlaylist);
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
    return new Response("AUDIO", { headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;

  const res = await call(ctx, "GET", `/tracks/${t}/file`, { deps: depsWith(ctx.db, { fetch: fetchStub }) });

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "AUDIO");
  assertEquals(res.headers.get("content-type"), "audio/mpeg");
  assertEquals(requested.length, 2);
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
