import { assertEquals } from "jsr:@std/assert@1";
import { periodStart } from "./ranking.ts";

const sec = (iso: string) => Date.parse(iso) / 1000;

Deno.test("week starts Monday 00:00 KST", () => {
  // Wed 2026-11-18 12:00 KST -> Mon 2026-11-16 00:00 KST = Sun 15:00 UTC
  assertEquals(periodStart("week", sec("2026-11-18T03:00:00Z")).toISOString(), "2026-11-15T15:00:00.000Z");
});

Deno.test("Monday 00:30 KST is already the new week, Sunday 23:59 KST is not", () => {
  assertEquals(periodStart("week", sec("2026-11-15T15:30:00Z")).toISOString(), "2026-11-15T15:00:00.000Z");
  assertEquals(periodStart("week", sec("2026-11-15T14:59:00Z")).toISOString(), "2026-11-08T15:00:00.000Z");
});

Deno.test("Sunday KST belongs to the week that started six days earlier", () => {
  // Sun 2026-11-22 10:00 KST
  assertEquals(periodStart("week", sec("2026-11-22T01:00:00Z")).toISOString(), "2026-11-15T15:00:00.000Z");
});

Deno.test("week crossing a month and year boundary", () => {
  // Fri 2027-01-01 09:00 KST -> Mon 2026-12-28 KST
  assertEquals(periodStart("week", sec("2027-01-01T00:00:00Z")).toISOString(), "2026-12-27T15:00:00.000Z");
});

Deno.test("month starts on the 1st 00:00 KST, even when UTC is still the previous month", () => {
  // 2026-12-01 05:00 KST is 2026-11-30 20:00 UTC
  assertEquals(periodStart("month", sec("2026-11-30T20:00:00Z")).toISOString(), "2026-11-30T15:00:00.000Z");
  // 2026-11-30 23:00 KST is still November
  assertEquals(periodStart("month", sec("2026-11-30T14:00:00Z")).toISOString(), "2026-10-31T15:00:00.000Z");
});
