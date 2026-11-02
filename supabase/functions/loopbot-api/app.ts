import { verifyInitData } from "./auth.ts";
import type { Db } from "./db.ts";

export interface Deps {
  botToken: string;
  allowed: Set<number>;
  allowedUsernames: Set<string>;
  admins: Set<number>;
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
const TITLE_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 10_000;
const SHEET_MAX_BYTES = 10 * 1024 * 1024;
const TELEGRAM_API = "https://api.telegram.org";
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const YOUTUBE_PATH_PREFIXES = ["/shorts/", "/embed/", "/live/"];
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Usernames are compared lowercased; Telegram usernames are case-insensitive.
export function parseUsernames(raw: string): Set<string> {
  const names = raw
    .split(",")
    .map((part) => part.trim().replace(/^@/, "").toLowerCase())
    .filter((name) => name !== "");
  return new Set(names);
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

// Only the URL's video id is kept. Anything else (other hosts, odd ids) is null.
export function youtubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  let id: string | null = null;
  if (parsed.hostname === "youtu.be") {
    id = parsed.pathname.slice(1);
  } else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
    const prefix = YOUTUBE_PATH_PREFIXES.find((p) => parsed.pathname.startsWith(p));
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (prefix !== undefined) id = parsed.pathname.slice(prefix.length);
  }
  return id !== null && YOUTUBE_ID_PATTERN.test(id) ? id : null;
}

// Admins are matched by numeric id only, because usernames can be taken over.
function requireAdmin(deps: Deps, userId: number): void {
  if (!deps.admins.has(userId)) throw new HttpError(403, "forbidden");
}

function titleField(body: Record<string, unknown>): string {
  const { title } = body;
  if (typeof title !== "string") throw badRequest();
  const trimmed = title.trim();
  if (trimmed === "") throw badRequest();
  return [...trimmed].slice(0, TITLE_MAX_LENGTH).join("");
}

// Blank means "remove the reference video", so it returns null instead of failing.
function videoField(body: Record<string, unknown>): string | null {
  const { url } = body;
  if (typeof url !== "string") throw badRequest();
  const trimmed = url.trim();
  if (trimmed === "") return null;
  const id = youtubeId(trimmed);
  if (id === null) throw badRequest();
  return id;
}

function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
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
  const user = await verifyInitData(req.headers.get("x-telegram-init-data") ?? "", deps.botToken, deps.now());
  if (user === null) throw new HttpError(401, "expired");
  const byName = user.username !== null && deps.allowedUsernames.has(user.username.toLowerCase());
  if (!deps.allowed.has(user.id) && !byName) throw new HttpError(403, "forbidden");
  return user.id;
}

// Telegram's getFile refuses files over 20MB; the bot token lives in the download URL.
async function telegramFile(fileId: string, headers: Record<string, string>, deps: Deps): Promise<Response> {
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
  const responseHeaders: Record<string, string> = { ...CORS_HEADERS, ...headers };
  const length = download.headers.get("content-length");
  if (length !== null) responseHeaders["content-length"] = length;
  return new Response(download.body, { headers: responseHeaders });
}

async function trackFile(userId: number, id: number, deps: Deps): Promise<Response> {
  const fileId = await deps.db.fileId(userId, id);
  if (fileId === null) throw notFound();
  return telegramFile(fileId, { "content-type": "audio/mp4", "cache-control": "private, max-age=31536000" }, deps);
}

// no-cache: the sheet URL does not change when the photo is replaced, so always revalidate.
async function trackSheet(userId: number, id: number, deps: Deps): Promise<Response> {
  const fileId = await deps.db.sheetFileId(userId, id);
  if (fileId === null) throw notFound();
  return telegramFile(fileId, { "content-type": "image/jpeg", "cache-control": "private, no-cache" }, deps);
}

// Best effort: the photo is already stored by file_id, so a leftover message only clutters the admin chat.
async function deleteMessage(chatId: number, messageId: number, deps: Deps): Promise<void> {
  try {
    await deps.fetch(`${TELEGRAM_API}/bot${deps.botToken}/deleteMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {
    // Ignored on purpose. The error may carry the bot token, so it is not logged either.
  }
}

// The JPEG goes to the admin's own chat as a document so Telegram keeps the lyrics sharp (no photo re-encode).
async function uploadSheet(userId: number, bytes: Uint8Array<ArrayBuffer>, deps: Deps): Promise<string> {
  const form = new FormData();
  form.set("chat_id", String(userId));
  form.set("disable_notification", "true");
  form.set("document", new File([bytes], "sheet.jpg", { type: "image/jpeg" }));
  const endpoint = `${TELEGRAM_API}/bot${deps.botToken}/sendDocument`;
  const sent: {
    ok: boolean;
    description?: string;
    result?: { message_id: number; document?: { file_id: string } };
  } = await (await deps.fetch(endpoint, { method: "POST", body: form })).json();

  if (sent.result !== undefined) await deleteMessage(userId, sent.result.message_id, deps);
  const fileId = sent.result?.document?.file_id;
  if (!sent.ok || fileId === undefined) throw new Error(`sendDocument rejected: ${sent.description}`);
  return fileId;
}

// Reads chunk by chunk so a body without Content-Length cannot make us buffer more than the cap.
async function readSheetBytes(req: Request): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  if (reader === undefined) throw badRequest();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  let next = await reader.read();
  while (!next.done) {
    total += next.value.byteLength;
    if (total > SHEET_MAX_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "too_big");
    }
    chunks.push(next.value);
    next = await reader.read();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function putSheet(req: Request, userId: number, id: number, deps: Deps): Promise<Response> {
  if (!(await deps.db.ownsTrack(userId, id))) throw notFound();
  if (mediaType(req) !== "image/jpeg") throw badRequest();
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > SHEET_MAX_BYTES) throw new HttpError(413, "too_big");
  const bytes = await readSheetBytes(req);

  const fileId = await uploadSheet(userId, bytes, deps);
  const version = await deps.db.saveSheet(userId, id, fileId);
  if (version === null) throw notFound();
  return json({ version });
}

async function route(req: Request, deps: Deps, userId: number): Promise<Response> {
  const path = new URL(req.url).pathname.replace(FUNCTION_PREFIX, "");
  const { db } = deps;

  if (req.method === "GET" && path === "/state") {
    return json({ ...(await db.state(userId)), is_admin: deps.admins.has(userId) });
  }

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

  const shared = path.match(/^\/playlists\/(\d+)\/shared$/);
  if (shared && req.method === "PUT") {
    requireAdmin(deps, userId);
    const { shared: isShared } = await readBody(req);
    if (typeof isShared !== "boolean") throw badRequest();
    const id = idParam(shared[1]);
    if (!(await db.setShared(userId, id, isShared))) throw notFound();
    return json({ id, shared: isShared });
  }

  const track = path.match(/^\/tracks\/(\d+)$/);
  if (track && req.method === "PUT") {
    const title = titleField(await readBody(req));
    const id = idParam(track[1]);
    if (!(await db.renameTrack(userId, id, title))) throw notFound();
    return json({ id, title });
  }
  if (track && req.method === "DELETE") {
    if (!(await db.deleteTrack(userId, idParam(track[1])))) throw notFound();
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const file = path.match(/^\/tracks\/(\d+)\/file$/);
  if (file && req.method === "GET") return trackFile(userId, idParam(file[1]), deps);

  const sheet = path.match(/^\/tracks\/(\d+)\/sheet$/);
  if (sheet && req.method === "GET") return trackSheet(userId, idParam(sheet[1]), deps);
  if (sheet && req.method === "PUT") {
    requireAdmin(deps, userId);
    return putSheet(req, userId, idParam(sheet[1]), deps);
  }
  if (sheet && req.method === "DELETE") {
    requireAdmin(deps, userId);
    if (!(await db.deleteSheet(userId, idParam(sheet[1])))) throw notFound();
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const video = path.match(/^\/tracks\/(\d+)\/video$/);
  if (video && req.method === "PUT") {
    requireAdmin(deps, userId);
    const videoId = videoField(await readBody(req));
    if (!(await db.saveVideo(userId, idParam(video[1]), videoId))) throw notFound();
    return json({ video_id: videoId });
  }

  const note = path.match(/^\/tracks\/(\d+)\/note$/);
  if (note && req.method === "PUT") {
    const { body } = await readBody(req);
    if (typeof body !== "string" || [...body].length > NOTE_MAX_LENGTH) throw badRequest();
    if (!(await db.saveNote(userId, idParam(note[1]), body))) throw notFound();
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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
