import { assertEquals } from "jsr:@std/assert@1";
import { verifyInitData } from "./auth.ts";

const BOT_TOKEN = "0000000000:test-bot-token";
const NOW = 1_800_000_000;
const USER_ID = 279058397;

// Test-only signer that follows the Telegram rules, so the tests do not depend on auth.ts.
async function sign(fields: [string, string][], botToken = BOT_TOKEN): Promise<string> {
  const encoder = new TextEncoder();
  const dataCheck = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const hmacKey = (raw: BufferSource, usage: KeyUsage) =>
    crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
  const secret = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode("WebAppData"), "sign"), encoder.encode(botToken));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(dataCheck));
  const hash = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams([...fields, ["hash", hash]]).toString();
}

function fieldsFor(user: object, authDate: number | string): [string, string][] {
  return [
    ["query_id", "AAHtest"],
    ["user", JSON.stringify(user)],
    ["auth_date", String(authDate)],
  ];
}

Deno.test("returns the user id for a correctly signed initData", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID, first_name: "Vladislav" }, NOW - 60));

  assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), USER_ID);
});

Deno.test("rejects a tampered hash", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID }, NOW - 60));
  const tampered = initData.slice(0, -1) + (initData.endsWith("0") ? "1" : "0");

  assertEquals(await verifyInitData(tampered, BOT_TOKEN, NOW), null);
});

Deno.test("rejects a changed field value even when the hash is kept", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID }, NOW - 60));
  const params = new URLSearchParams(initData);
  params.set("query_id", "changed");

  assertEquals(await verifyInitData(params.toString(), BOT_TOKEN, NOW), null);
});

Deno.test("rejects auth_date older than 24 hours", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID }, NOW - 25 * 3600));

  assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), null);
});

Deno.test("rejects auth_date more than 60 seconds in the future", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID }, NOW + 3600));

  assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), null);
});

Deno.test("accepts auth_date a few seconds in the future (clock skew)", async () => {
  const initData = await sign(fieldsFor({ id: USER_ID }, NOW + 30));

  assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), USER_ID);
});

// Number() would read these as valid numbers; only plain decimal digits are a Telegram auth_date.
Deno.test("rejects auth_date written in exponent or hex notation", async () => {
  for (const authDate of ["1e10", "0x6B49D200"]) {
    const initData = await sign(fieldsFor({ id: USER_ID }, authDate));

    assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), null);
  }
});

Deno.test("rejects an empty string", async () => {
  assertEquals(await verifyInitData("", BOT_TOKEN, NOW), null);
});

Deno.test("accepts non-ASCII user fields and a signature field", async () => {
  const initData = await sign([
    ...fieldsFor({ id: 42, first_name: "하늘" }, NOW - 60),
    ["signature", "abc"],
  ]);

  assertEquals(await verifyInitData(initData, BOT_TOKEN, NOW), 42);
});

// Public sample from https://docs.telegram-mini-apps.com/packages/tma-js-init-data/validating (not a secret).
Deno.test("accepts the published Telegram docs sample", async () => {
  const token = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";
  const initData =
    "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";

  assertEquals(await verifyInitData(initData, token, 1662771700), 279058397);
});
