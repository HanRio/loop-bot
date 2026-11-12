import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { cleanTitle, getSynced, searchCandidates } from "./lrclib.ts";

const CASES: [string, string][] = [
  ["F.I.A - F.I.A LIVE WORSHIP - 슬픈 마음 있는 사람 (찬송가 91장/피아버전) / TAKE THE NAME OF JESUS WITH YOU (FIA.ver)", "슬픈 마음 있는 사람"],
  ["F.I.A - 나의 가장 낮은 마음 / HUMBLE AND LOWLY SPIRIT - 피아워십", "나의 가장 낮은 마음"],
  ["F.I.A - 1. 나는 일어섭니다 (Official) | I SHALL STAND", "나는 일어섭니다"],
  ["ANOINTING - 13 빛으로 비추시네 (Official Video)", "빛으로 비추시네"],
  ["WECCLESIA 위클레시아 - 예수 늘 함께하시네 | Jesus", "예수 늘 함께하시네"],
  ["[LIVE] 예수, 늘 함께하시네 - 마커스워십 정규 앨범 실황 (Official Live Video)", "예수, 늘 함께하시네"],
  ["Way Maker", "Way Maker"],
  ["찬양 - 은혜", "찬양"],
  ["   ", ""],
  ["1 . 나는 일어섭니다", "나는 일어섭니다"],
];

for (const [input, want] of CASES) {
  Deno.test(`cleanTitle: ${want}`, () => assertEquals(cleanTitle(input), want));
}

const reply = (body: unknown, status = 200) => (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

Deno.test("searchCandidates drops rows without synced lyrics and caps at 8", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1, trackName: `t${i}`, artistName: "a", duration: 200, syncedLyrics: i === 0 ? null : "[00:01.00]x",
  }));
  const got = await searchCandidates("q", reply(rows));
  assertEquals(got.length, 8);
  assertEquals(got[0], { id: 2, track: "t1", artist: "a", duration: 200 });
});

Deno.test("searchCandidates throws on fetch failure and bad status", async () => {
  await assertRejects(() => searchCandidates("q", (() => Promise.reject(new Error("down"))) as typeof fetch));
  await assertRejects(() => searchCandidates("q", reply([], 500)));
});

Deno.test("getSynced returns lyrics, null for 404 or none, throws on 500", async () => {
  assertEquals(await getSynced(1, reply({ syncedLyrics: "[00:01.00]x" })), "[00:01.00]x");
  assertEquals(await getSynced(1, reply({ syncedLyrics: null })), null);
  assertEquals(await getSynced(1, reply({}, 404)), null);
  await assertRejects(() => getSynced(1, reply({}, 500)));
});
