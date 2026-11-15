// Seasons (js/seasonclock.js, lane seasons, I-117): the calendar maths. Sheet 13 (audit/maplook3) is the spec.
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

const SC = () => loadScript("js/seasonclock.js").PNSeason;
const S = SC();
const at = (iso) => S._at(S._sthlmMs(iso));   // iso = Stockholm wall time

test("seasons: Advent Sundays 2026 = 29 Nov, 6, 13, 20 Dec; 2027 = 28 Nov, 5, 12, 19 Dec; 2025 = 30 Nov", () => {
  assert.deepEqual({ ...S._advent1(2026) }, { mo: 11, d: 29 });
  assert.deepEqual({ ...S._advent1(2027) }, { mo: 11, d: 28 });
  assert.deepEqual({ ...S._advent1(2025) }, { mo: 11, d: 30 });
  assert.deepEqual({ ...S._advent1(2022) }, { mo: 11, d: 27 });   // 24 Dec 2022 = Saturday: Advent 4 = 18 Dec
  assert.deepEqual({ ...S._advent1(2028) }, { mo: 12, d: 3 });    // 24 Dec 2028 = Sunday: Advent 4 = 24 Dec itself
  const n = (mo, d, y = 2026) => S._adventN(y, mo, d);
  assert.equal(n(11, 28), 0); assert.equal(n(11, 29), 1); assert.equal(n(12, 5), 1); assert.equal(n(12, 6), 2);
  assert.equal(n(12, 12), 2); assert.equal(n(12, 13), 3); assert.equal(n(12, 20), 4); assert.equal(n(12, 24), 4);
  assert.equal(n(12, 26), 4); assert.equal(n(12, 27), 0); assert.equal(n(1, 2), 0);
});

test("seasons: Midsummer Eve = the Friday in 19-25 June (2026: 19 June, 2027: 25 June, 2028: 23 June)", () => {
  assert.equal(S._midsummerEve(2026), 19); assert.equal(S._midsummerEve(2027), 25); assert.equal(S._midsummerEve(2028), 23);
  assert.equal(at("2027-06-25T21:00").key, "midsummer");
  assert.equal(at("2027-06-26T12:00").key, "midsummer");   // Midsummer Day (Saturday)
  assert.equal(at("2027-06-24T21:00").key, "normal");
  assert.equal(at("2027-06-27T12:00").key, "normal");
  assert.equal(at("2027-06-25T21:00").dress, "crown");
});

test("seasons: Christmas 1 Dec – 13 Jan, glögg 1 – 26 Dec only, Lucia 13 Dec", () => {
  assert.equal(at("2026-11-30T23:59").key, "normal");
  const d1 = at("2026-12-01T00:01"); assert.equal(d1.key, "xmas"); assert.equal(d1.glogg, true); assert.equal(d1.dress, "santa"); assert.equal(d1.tap, "xmas");
  assert.equal(at("2026-12-26T22:00").glogg, true);
  const d27 = at("2026-12-27T12:00"); assert.equal(d27.glogg, false); assert.equal(d27.key, "xmas"); assert.equal(d27.map.tree, true);
  assert.equal(at("2027-01-13T22:00").key, "xmas");
  assert.equal(at("2027-01-14T00:01").key, "winter");
  const lu = at("2026-12-13T20:00"); assert.equal(lu.map.lucia, true); assert.equal(lu.map.advent, 3);
  assert.equal(at("2026-12-12T20:00").map.lucia, false);
  assert.equal(at("2026-11-29T18:00").map.advent, 1);   // 1st Advent before Christmas starts: candles only
  assert.equal(at("2026-11-29T18:00").map.tree, false);
});

test("seasons: New Year 31 Dec 18:00 – 1 Jan 03:00; fireworks from 00:00, no glögg that night", () => {
  assert.equal(at("2026-12-31T17:59").key, "xmas");
  const e = at("2026-12-31T18:00"); assert.equal(e.key, "newyear"); assert.equal(e.dress, "party"); assert.equal(e.glogg, false); assert.equal(e.map.fireworks, false);
  const m = at("2027-01-01T00:00"); assert.equal(m.map.fireworks, true); assert.equal(m.tap, "newyear");
  assert.equal(m.map.fwStart, S._sthlmMs("2027-01-01T00:00"));
  const late = at("2027-01-01T02:59"); assert.equal(late.map.fireworks, true); assert.equal(late.map.fwStart, S._sthlmMs("2027-01-01T00:00"));
  const after = at("2027-01-01T03:00"); assert.equal(after.key, "xmas"); assert.equal(after.map.fireworks, false);
});

test("seasons: Valborg 30 Apr all day (fires 18:00 – 01:00), spring April + May, autumn October, winter Jan – Mar", () => {
  const v = at("2027-04-30T12:00"); assert.equal(v.key, "valborg"); assert.equal(v.tap, "valborg"); assert.equal(v.dress, "cap"); assert.equal(v.map.fire, false);
  assert.equal(at("2027-04-30T18:00").map.fire, true);
  const may1 = at("2027-05-01T00:30"); assert.equal(may1.map.fire, true); assert.equal(may1.key, "spring");
  assert.equal(at("2027-05-01T01:00").map.fire, false);
  assert.equal(at("2027-04-12T20:00").tap, "spring"); assert.equal(at("2027-04-12T20:00").dress, "");
  assert.equal(at("2027-05-31T20:00").key, "spring"); assert.equal(at("2027-06-01T20:00").key, "normal");
  const a = at("2026-10-16T20:00"); assert.equal(a.key, "autumn"); assert.equal(a.dress, "leaves"); assert.equal(a.map.autumn, true);
  assert.equal(at("2026-11-01T20:00").key, "normal");
  assert.equal(at("2027-02-12T20:00").key, "winter"); assert.equal(at("2027-02-12T20:00").tap, "normal");
});

test("seasons: Stockholm wall time across summer time (CEST +2 / CET +1)", () => {
  assert.equal(S._sthlmMs("2027-06-25T21:00"), Date.parse("2027-06-25T19:00:00Z"));
  assert.equal(S._sthlmMs("2026-12-13T20:00"), Date.parse("2026-12-13T19:00:00Z"));
  const p = S._parts(Date.parse("2026-12-31T23:30:00Z")); assert.equal(p.d, 1); assert.equal(p.mo, 1); assert.equal(p.h, 0);
});

test("seasons: weather codes → snow / rain / fog levels; snow has fallen over 2 cm; aurora Kp rule by latitude", () => {
  const w = (o) => ({ ...S._wxOf(o) });
  assert.equal(w({ code: 71 }).snow, 1); assert.equal(w({ code: 73 }).snow, 2); assert.equal(w({ code: 75 }).snow, 3); assert.equal(w({ code: 86 }).snow, 3);
  assert.equal(w({ code: 61 }).rain, 1); assert.equal(w({ code: 63 }).rain, 2); assert.equal(w({ code: 82 }).rain, 3); assert.equal(w({ code: 99 }).rain, 3);
  assert.equal(w({ code: 45 }).fog, true); assert.equal(w({ code: 3 }).snow + w({ code: 3 }).rain, 0);
  assert.equal(w({ code: 0, cloud: 10, day: false }).clear, true); assert.equal(w({ code: 0, cloud: 10, day: true }).clear, false);
  assert.equal(w({ code: 3, sd: 2.5 }).fallen, true); assert.equal(w({ code: 3, sd: 1 }).fallen, false);
  assert.equal(S.auroraOK(5, 59.3, { clear: true }), true); assert.equal(S.auroraOK(4, 59.3, { clear: true }), false);
  assert.equal(S.auroraOK(4, 60.15, { clear: true }), false); assert.equal(S.auroraOK(4, 63.8, { clear: true }), true);
  assert.equal(S.auroraOK(3, 67.85, { clear: true }), true); assert.equal(S.auroraOK(9, 60, { clear: false }), false);
});

test("seasons: the test hook works only in a test build (never on the live config)", () => {
  const live = loadScript("js/seasonclock.js", { OLNU_CONFIG: { SUPABASE_URL: "https://wcdskpcevbhouvbytkhv.supabase.co" }, location: { hostname: "pintsnow.com", pathname: "/", search: "?season=xmas" } }).PNSeason;
  assert.equal(live.testBuild(), false); assert.equal(live._force({ season: "xmas" }), false); assert.equal(live.now().forced, false);
  const stg = loadScript("js/seasonclock.js", { OLNU_CONFIG: { SUPABASE_URL: "https://staging.supabase.co" }, location: { hostname: "tunela.github.io", pathname: "/Beer-map/", search: "?season=lucia&wx=snow3" } }).PNSeason;
  assert.equal(stg.testBuild(), true); const s = stg.now(); assert.equal(s.map.lucia, true); assert.equal(s.wx.snow, 3); assert.equal(s.snowcap, true);
});
