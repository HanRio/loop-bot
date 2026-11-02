import { verifyInitData } from "./auth.ts";
import type { Db } from "./db.ts";

export interface Deps {
  botToken: string;
  allowed: Set<number>;
  db: Db;
  fetch: typeof fetch;
  now(): number;
}

const ALLOWED_ORIGIN = "https://hanrio.github.io";
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": ALLOWED_ORIGIN,
  "access-control-allow-headers": "content-type, x-telegram-init-data",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const FUNCTION_PREFIX = /^\/loopbot-api(?=\/|$)/;
const NAME_MAX_LENGTH = 20;
const TELEGRAM_API = "https://api.telegram.org";

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function badRequest(): HttpError {
  return new HttpError(400, "bad_request");
}

function notFound(): HttpError {
  return new HttpError(404, "not_found");
}

function isTrackId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw notFound();
  return id;
}

function normalizeName(raw: string): string {
  const name = [...raw.trim()].slice(0, NAME_MAX_LENGTH).join("");
  return name || "새 플레이리스트";
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest();
  return body as Record<string, unknown>;
}

function playlistFields(body: Record<string, unknown>): { name: string; trackIds: number[] } {
  const { name, track_ids: trackIds } = body;
  if (typeof name !== "string" || !Array.isArray(trackIds) || !trackIds.every(isTrackId)) throw badRequest();
  return { name: normalizeName(name), trackIds };
}

async function authenticate(req: Request, deps: Deps): Promise<number> {
  const userId = await verifyInitData(req.headers.get("x-telegram-init-data") ?? "", deps.botToken, deps.now());
  if (userId === null) throw new HttpError(401, "expired");
  if (!deps.allowed.has(userId)) throw new HttpError(403, "forbidden");
  return userId;
}

// Telegram's getFile refuses files over 20MB; the bot token lives in the download URL.
async function trackFile(userId: number, id: number, deps: Deps): Promise<Response> {
  const fileId = await deps.db.fileId(userId, id);
  if (fileId === null) throw notFound();

  const endpoint = new URL(`${TELEGRAM_API}/bot${deps.botToken}/getFile`);
  endpoint.searchParams.set("file_id", fileId);
  const info: { ok: boolean; description?: string; result?: { file_path: string } } = await (
    await deps.fetch(endpoint)
  ).json();
  if (!info.ok) {
    if (/too big/i.test(info.description ?? "")) throw new HttpError(413, "too_big");
    throw new Error(`getFile rejected: ${info.description}`);
  }

  const download = await deps.fetch(`${TELEGRAM_API}/file/bot${deps.botToken}/${info.result!.file_path}`);
  if (!download.ok || !download.body) throw new Error(`download failed: ${download.status}`);
  return new Response(download.body, {
    headers: { ...CORS_HEADERS, "content-type": download.headers.get("content-type") ?? "application/octet-stream" },
  });
}

async function route(req: Request, deps: Deps, userId: number): Promise<Response> {
  const path = new URL(req.url).pathname.replace(FUNCTION_PREFIX, "");
  const { db } = deps;

  if (req.method === "GET" && path === "/state") return json(await db.state(userId));

  if (req.method === "POST" && path === "/playlists") {
    const { name, trackIds } = playlistFields(await readBody(req));
    return json(await db.createPlaylist(userId, name, trackIds));
  }

  if (req.method === "PUT" && path === "/active") {
    const { playlist_id: playlistId } = await readBody(req);
    if (!isTrackId(playlistId)) throw badRequest();
    const activeId = await db.setActive(userId, playlistId);
    if (activeId === null) throw notFound();
    return json({ active_id: activeId });
  }

  const playlist = path.match(/^\/playlists\/(\d+)$/);
  if (playlist && req.method === "PUT") {
    const { name, trackIds } = playlistFields(await readBody(req));
    const saved = await db.savePlaylist(userId, idParam(playlist[1]), name, trackIds);
    if (saved === null) throw notFound();
    return json(saved);
  }
  if (playlist && req.method === "DELETE") {
    const activeId = await db.deletePlaylist(userId, idParam(playlist[1]));
    if (activeId === null) throw notFound();
    return json({ active_id: activeId });
  }

  const track = path.match(/^\/tracks\/(\d+)$/);
  if (track && req.method === "DELETE") {
    if (!(await db.deleteTrack(userId, idParam(track[1])))) throw notFound();
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const file = path.match(/^\/tracks\/(\d+)\/file$/);
  if (file && req.method === "GET") return trackFile(userId, idParam(file[1]), deps);

  throw notFound();
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const userId = await authenticate(req, deps);
    return await route(req, deps, userId);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    // Telegram URLs carry the bot token, so scrub it before the message reaches the logs.
    const message = err instanceof Error ? err.message : String(err);
    console.error("upstream", message.replaceAll(deps.botToken, "<token>"));
    return json({ error: "upstream" }, 502);
  }
}
