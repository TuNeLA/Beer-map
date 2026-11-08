// 🧪 node --test scripts/import-sport.test.mjs — no network. stats.swehockey.se ids / skip / time / retire, venue fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseSwehockeyDay, parseSwehockeySchedule, swehockeyRows, swhId, swhTimeKnown, swhWomen, swhFilters,
  retirePlan, retireSwehockey, placer, stockholm } from "./import-sport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(here, "sport-feeds.json"), "utf8")).swehockey;
const venues = JSON.parse(readFileSync(resolve(here, "sport-venues.json"), "utf8"));
const place = placer(venues, [{ name: "Leksand", lat: 60.73, lng: 14.99 }, { name: "Ludvika", lat: 60.15, lng: 15.19 }]);

// "Games By Date" page as parseSwehockeyDay reads it: header, group row (colspan=5 + Schedule link), game rows (time | teams | result | venue).
const group = (id, name) => `<tr><td colspan="5"><a href="/ScheduleAndResults/Schedule/${id}">${name}</a></td></tr>`;
const game = (time, home, away, venue, res = "") => `<tr><td>${time}</td><td>${home} - ${away}</td><td>${res}</td><td>${venue}</td></tr>`;
const DAY = "2026-12-05";
const DAY_HTML = `<html><table><tr><th class="tdHeader">Time</th><th class="tdHeader">Game</th><th class="tdHeader">Result</th><th class="tdHeader">Venue</th></tr>
${group(19001, "HockeyTrean Dalarna")}
${game("19:00", "Ludvika Hockey Förening", "Kvarnsvedens GoIF", "Ludvika Ishall")}
${game("00:00", "Frösö IK", "Näldens IF", "Klanghallen")}
${group(18263, "HockeyTvåan Dam Region Väst")}
${game("17:15", "Leksands IF:2", "Hedesunda IF/BIF:2", "Tegera Arena")}
${group(17000, "SDHL")}
${game("15:00", "Leksands IF", "Brynäs IF", "Tegera Arena")}
${group(17100, "HockeyTvåan Herr Region Väst B")}
${game("19:00", "Hallstahammars HK", "IFK Arboga", "Swetex Arena")}
${game("19:00", "Kumla Hockey", "Hallstahammars HK", "ICA Maxi Arena")}
${group(16000, "SHL")}
${game("19:00", "Leksands IF", "Mora IK", "Tegera Arena")}
</table></html>`;

// League "Schedule" page as parseSwehockeySchedule reads it (game id in the lnkTooltip title).
const SCHED_HTML = `<table><tr><td class="tdHeader">Date</td><td class="tdHeader">Game</td><td class="tdHeader">Venue</td></tr>
<tr><td>${DAY}</td><td><a class="lnkTooltip" title="94220099">19:00</a></td><td>Hallstahammars HK - IFK Arboga</td><td>Swetex Arena</td></tr>
<tr><td>2026-12-12</td><td><a class="lnkTooltip" title="94220100">19:00</a></td><td>IFK Arboga - Hallstahammars HK</td><td>Gyllene Balken Arena</td></tr>
</table>`;

test("day page parses all game rows (time, teams, group)", () => {
  const g = parseSwehockeyDay(DAY_HTML);
  assert.equal(g.length, 7);
  assert.deepEqual(g.map((x) => x.time), ["19:00", "00:00", "17:15", "15:00", "19:00", "19:00", "19:00"]);
  assert.equal(g[0].home, "Ludvika Hockey Förening");
  assert.equal(g[2].group, "HockeyTvåan Dam Region Väst");
  assert.equal(g[0].gameId, null);   // day pages carry no game id → the id must not depend on it
});

test("ONE id for both paths: day page and schedule page give the same source_id", () => {
  const day = swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, place).filter((r) => r.home === "Hallstahammars HK" && !r.tv);
  const sch = parseSwehockeySchedule(SCHED_HTML).filter((g) => g.day === DAY).map((g) => Object.assign(g, { group: "HockeyTvåan Herr Region Väst B", groupId: "17100" }));
  assert.equal(sch[0].gameId, "94220099");
  const far = swehockeyRows(DAY, sch, cfg, place);
  assert.equal(day.length, 1); assert.equal(far.length, 1);
  assert.equal(day[0].source_id, far[0].source_id);
  assert.equal(day[0].source_id, "swh:hallstahammarshkifkarboga:2026-12-05");
  assert.equal(swhId("Leksands IF:2", "Hällefors IK/ÖHK:2/ÖHUF/GSK", DAY), "swh:leksandsif2halleforsikohk2ohufgsk:2026-12-05");   // same as live day-page rows
});

test("skip: women's lower leagues in both spellings; SDHL / NDHL kept", () => {
  const { keep, skip } = swhFilters(cfg);
  const ok = (g) => keep.test(g) && !skip.test(g);
  for (const g of ["HockeyTvåan Dam Region Väst", "HockeyTvåan Dam Syd", "HockeyEttan Dam Norra", "HockeyTrean Dam", "DamEttan Norra", "HockeyTvåan U18"]) assert.equal(ok(g), false, g);
  for (const g of ["SHL", "SDHL", "NDHL", "HockeyAllsvenskan", "Hockeyettan Norra", "HockeyTvåan Herr Region Väst B", "HockeyTrean Dalarna"]) assert.equal(ok(g), true, g);
  // the built-in default (no config) skips them too
  const d = swhFilters({});
  assert.equal(d.skip.test("HockeyTvåan Dam Region Väst"), true);
});

test("kept women's game says Dam in league and title", () => {
  const rows = swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, place);
  const w = rows.find((r) => r.league.startsWith("SDHL"));
  assert.equal(w.league, "SDHL Dam");
  assert.equal(w.title, "Leksands IF – Brynäs IF (dam)");
  assert.equal(swhWomen("HockeyTvåan Herr Region Väst B"), false);
  assert.ok(!rows.some((r) => /Dam Region/.test(r.league)));
  const men = rows.find((r) => r.home === "Leksands IF" && r.away === "Mora IK" && !r.tv);
  assert.equal(men.title, "Leksands IF – Mora IK"); assert.equal(men.league, "SHL");
});

test("no start time (00:00 placeholder) → no row, not in the seen set", () => {
  assert.equal(swhTimeKnown("00:00"), false); assert.equal(swhTimeKnown(""), false); assert.equal(swhTimeKnown(undefined), false);
  assert.equal(swhTimeKnown("19:00"), true);
  const seen = new Set(), rows = swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, place, seen);
  assert.ok(!rows.some((r) => /Frösö/.test(r.title)));
  assert.ok(![...seen].some((s) => s.includes("froso")));
  for (const r of rows) assert.notEqual(new Date(r.starts_at).getTime(), stockholm(DAY, "00:00"));
});

test("seen set holds every id the run would write, also rows without a position and TV twins", () => {
  const seen = new Set(), rows = swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, place, seen);
  for (const r of rows) assert.ok(seen.has(r.source_id), r.source_id);
  assert.ok(seen.has("tv:swh:leksandsifmoraik:2026-12-05"));   // Leksand – Mora: SHL TV match for Dalarna
  assert.ok(seen.has("swh:ludvikahockeyforeningkvarnsvedensgoif:2026-12-05"));
  const noPos = swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, () => null, new Set());
  assert.ok(noPos.every((r) => r.tv));   // without a position only TV rows are written…
  const s2 = new Set(); swehockeyRows(DAY, parseSwehockeyDay(DAY_HTML), cfg, () => null, s2);
  assert.deepEqual([...s2].sort(), [...seen].sort());   // …but the seen set is the same, so nothing is retired by mistake
});

test("retire plan only for HTTP 200 with ≥ 1 parsed game", () => {
  const games = parseSwehockeyDay(DAY_HTML), seen = new Set(["swh:b:x", "swh:a:x"]);
  assert.deepEqual(retirePlan(DAY, 200, games, seen), { day: DAY, seen: ["swh:a:x", "swh:b:x"] });
  assert.equal(retirePlan(DAY, 503, games, seen), null);
  assert.equal(retirePlan(DAY, 200, [], seen), null);                               // empty / changed page → never hide
  assert.equal(retirePlan(DAY, 200, parseSwehockeyDay("<html>Service unavailable</html>"), seen), null);
  // a page with games but none kept is still the truth for that day (empty seen list)
  assert.deepEqual(retirePlan(DAY, 200, games, new Set()), { day: DAY, seen: [] });
});

test("retireSwehockey calls swh_retire per day and stops at the first error", async () => {
  const calls = [], logs = [];
  const rpc = async (name, body) => { calls.push([name, body]); if (body.p_day === "2026-12-06") throw new Error("swh_retire 404 not found"); return { hidden: 1 }; };
  const plan = [{ day: "2026-12-05", seen: ["swh:a:2026-12-05"] }, { day: "2026-12-06", seen: [] }, { day: "2026-12-07", seen: [] }];
  const n = await retireSwehockey(rpc, plan, (...a) => logs.push(a.join(" ")));
  assert.equal(n, 1);
  assert.deepEqual(calls, [["swh_retire", { p_day: "2026-12-05", p_seen: ["swh:a:2026-12-05"] }], ["swh_retire", { p_day: "2026-12-06", p_seen: [] }]]);
  assert.ok(logs.some((l) => /swh_retire failed/.test(l)));
  assert.equal(await retireSwehockey(rpc, [], () => {}), 0);
});

test("import-events.mjs calls swh_retire only after a good sport import", () => {
  const src = readFileSync(resolve(here, "import-events.mjs"), "utf8");
  assert.match(src, /retire = sport\.retire \|\| \[\]/);
  assert.match(src, /catch \(e\) \{ sportOk = false;/);
  assert.match(src, /if \(sportOk && retire\.length\) await retireSwehockey\(rpc, retire, log\)/);
  assert.ok(src.indexOf("retireSwehockey(rpc") > src.indexOf('rpc("import_sport_events"'));
});

test("venues: Swetex Arena = Hallstahammar, ICA Maxi Arena = Kumla (not Visby)", () => {
  const sw = place("Swetex Arena", "Hallstahammars HK");
  assert.ok(Math.abs(sw.lat - 59.6217) < 0.01 && Math.abs(sw.lng - 16.2285) < 0.01);
  const ku = place("ICA Maxi Arena", "Kumla Hockey");
  assert.ok(Math.abs(ku.lat - 59.1314) < 0.01 && Math.abs(ku.lng - 15.1277) < 0.01);
});
