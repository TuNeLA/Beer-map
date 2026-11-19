// E3 "Sista bussen hem": the pure part of the edge function supabase/functions/lastbus (plan.mjs): rounding (privacy),
// the two ResRobot v2.1 URLs (next trips + the last trips that arrive before 03:00) and the answer the app reads.
import test from "node:test";
import assert from "node:assert/strict";
import { roundPt, urls, answer, tripOf, sthlm } from "../../supabase/functions/lastbus/plan.mjs";

const leg = (type, o) => Object.assign({ type }, o);
const trip = (date, walk, dep, line, stop, arr) => ({ LegList: { Leg: [
  leg("WALK", { duration: "PT" + walk + "M", Origin: { name: "start", date, time: dep }, Destination: { name: stop, date, time: dep } }),
  leg("JNY", { Origin: { name: stop, date, time: dep + ":00" }, Destination: { name: "Ludvika Gamla Bruket", date, time: arr + ":00" },
    Product: [{ name: "Länstrafik - Buss " + line, num: line, catOutL: "Buss" }] }),
  leg("WALK", { duration: "PT4M" }) ] } });
// 19 Nov 2026 22:30 Stockholm (UTC+1) = 21:30 UTC
const NOW = Date.UTC(2026, 10, 19, 21, 30);

test("lastbus: points are rounded to the 0.005° grid (≈ 550 m), Sweden only", () => {
  assert.deepEqual(roundPt({ lat: 60.16437, lng: 15.20512 }), { lat: 60.165, lng: 15.205 });
  assert.equal(roundPt({ lat: 48.85, lng: 2.35 }), null);
  assert.equal(roundPt({}), null);
});
test("lastbus: Stockholm wall clock and the two URLs (key only as accessId; last = arrive before 03:00 next day)", () => {
  assert.deepEqual(sthlm(NOW), { date: "2026-11-19", time: "22:30", hour: 22 });
  const [a, b] = urls("K3Y", { lat: 60.15, lng: 15.19 }, { lat: 60.165, lng: 15.205 }, NOW);
  assert.match(a, /^https:\/\/api\.resrobot\.se\/v2\.1\/trip\?/); assert.match(a, /date=2026-11-19&time=22:30&numF=3/);
  assert.match(b, /date=2026-11-20&time=03:00&searchForArrival=1/); assert.match(a, /accessId=K3Y/);
  assert.match(a, /originCoordLat=60\.15&originCoordLong=15\.19&destCoordLat=60\.165&destCoordLong=15\.205/);
});
test("lastbus: answer = next trip + LAST trip of the night; gone when the last one has left", () => {
  const next = { Trip: [trip("2026-11-19", 6, "22:52", "302", "Ludvika resecentrum", "23:05"), trip("2026-11-19", 6, "23:40", "302", "Ludvika resecentrum", "23:53")] };
  const last = { Trip: [trip("2026-11-19", 6, "23:40", "302", "Ludvika resecentrum", "23:53"), trip("2026-11-20", 6, "00:40", "N1", "Ludvika resecentrum", "00:53")] };
  const a = answer(next, last, NOW);
  assert.equal(a.ok, true); assert.equal(a.gone, false);
  assert.deepEqual(a.next, { dep: "2026-11-19 22:52", line: "Buss 302", stop: "Ludvika resecentrum", walk: 6, arr: "23:05", to: "Ludvika Gamla Bruket" });
  assert.equal(a.last.dep, "2026-11-20 00:40"); assert.equal(a.last.line, "Buss N1");
  const late = answer({ Trip: [] }, last, Date.UTC(2026, 10, 19, 23, 50));   // 00:50 Stockholm: the 00:40 has left
  assert.equal(late.gone, true); assert.equal(late.next, null);
  assert.equal(answer({}, {}, NOW).gone, true);                             // no trip tonight at all
});
test("lastbus: a trip with no bus or train leg is ignored (walk only)", () => {
  assert.equal(tripOf({ LegList: { Leg: { type: "WALK", duration: "PT20M" } } }), null);
});
