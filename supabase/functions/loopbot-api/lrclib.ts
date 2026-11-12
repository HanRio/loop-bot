export interface Candidate {
  id: number;
  track: string;
  artist: string;
  duration: number;
}

const LRCLIB = "https://lrclib.net/api";
const USER_AGENT = "loopbot (lyrics)";
const TIMEOUT_MS = 8000;
const MAX_CANDIDATES = 8;
const HANGUL = /[가-힣]/g;

const hangulCount = (s: string): number => (s.match(HANGUL) ?? []).length;

// Same rules as the bot's clean_title (without the performer prefix handling).
export function cleanTitle(title: string): string {
  let t = title.replace(/\[[^\]]*\]/g, "");
  t = t.split("|")[0].split(" / ")[0].replace(/\([^)]*\)/g, "");
  const pieces = t.split(" - ").map((p) => p.trim()).filter((p) => p !== "");
  if (pieces.length === 0) return title.trim();
  const kept = pieces.filter((p) => !p.includes("LIVE WORSHIP") && !p.includes("워십"));
  const pool = kept.length > 0 ? kept : pieces;
  let best = pool[pool.length - 1];
  let bestCount = 0;
  for (const p of pool) {
    if (hangulCount(p) > bestCount) {
      best = p;
      bestCount = hangulCount(p);
    }
  }
  return best.replace(/^\d+\s*\.?\s+/, "").replace(/\s+/g, " ").trim();
}

async function lrclibGet(url: string, fetchFn: typeof fetch): Promise<Response> {
  return await fetchFn(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Only candidates that have synced lyrics. Throws on any upstream failure.
export async function searchCandidates(q: string, fetchFn: typeof fetch = fetch): Promise<Candidate[]> {
  const res = await lrclibGet(`${LRCLIB}/search?q=${encodeURIComponent(q)}`, fetchFn);
  if (!res.ok) throw new Error(`lrclib search failed: ${res.status}`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("lrclib search: bad body");
  return rows
    .filter((r) => r && typeof r.syncedLyrics === "string" && r.syncedLyrics !== "")
    .slice(0, MAX_CANDIDATES)
    .map((r) => ({ id: Number(r.id), track: String(r.trackName ?? ""), artist: String(r.artistName ?? ""), duration: Number(r.duration ?? 0) }));
}

export async function getSynced(id: number, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await lrclibGet(`${LRCLIB}/get/${id}`, fetchFn);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib get failed: ${res.status}`);
  const row = await res.json();
  return typeof row?.syncedLyrics === "string" && row.syncedLyrics !== "" ? row.syncedLyrics : null;
}
