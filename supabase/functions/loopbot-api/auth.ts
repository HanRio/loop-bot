const DEFAULT_MAX_AGE_SEC = 86400;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
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

function userIdOf(user: string | null): number | null {
  try {
    const id = JSON.parse(user ?? "null")?.id;
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** Returns the Telegram user id when initData is signed by the bot and fresh; otherwise null. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !HASH_PATTERN.test(hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || nowSec - authDate > maxAgeSec) return null;

  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData"), "sign"), encoder.encode(botToken));
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    hexToBytes(hash),
    encoder.encode(dataCheckString(params)),
  );
  return valid ? userIdOf(params.get("user")) : null;
}
