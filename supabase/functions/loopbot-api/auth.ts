const DEFAULT_MAX_AGE_SEC = 86400;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const AUTH_DATE_PATTERN = /^\d+$/;
const MAX_CLOCK_SKEW_SEC = 60;
const encoder = new TextEncoder();

const hmacKey = (raw: BufferSource, usage: KeyUsage): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [usage]);

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export interface VerifiedUser {
  id: number;
  username: string | null;
  authDate: number;
}

function userOf(user: string | null, authDate: number): VerifiedUser | null {
  try {
    const parsed = JSON.parse(user ?? "null");
    const id = parsed?.id;
    if (!Number.isSafeInteger(id)) return null;
    const username = typeof parsed.username === "string" && parsed.username !== "" ? parsed.username : null;
    return { id, username, authDate };
  } catch {
    return null;
  }
}

/** Returns the signed Telegram user when initData is signed by the bot and fresh; otherwise null. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): Promise<VerifiedUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !HASH_PATTERN.test(hash)) return null;

  // Digits only: Number() would also accept "1e10" and "0x6B49D200".
  const rawAuthDate = params.get("auth_date") ?? "";
  if (!AUTH_DATE_PATTERN.test(rawAuthDate)) return null;
  const authDate = Number(rawAuthDate);
  if (authDate > nowSec + MAX_CLOCK_SKEW_SEC || nowSec - authDate > maxAgeSec) return null;

  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData"), "sign"), encoder.encode(botToken));
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    hexToBytes(hash),
    encoder.encode(dataCheckString(params)),
  );
  return valid ? userOf(params.get("user"), authDate) : null;
}
