// Pure-function tests for supabase/functions/notify-group/index.ts (chaos rule, line picker, towns).
// Run: node --experimental-strip-types supabase/tests/notify-group.test.mjs
// It copies the "pure:start … pure:end" block of index.ts to a temp .ts file and imports it,
// so no Deno, network or npm packages are needed.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../functions/notify-group/index.ts"), "utf8");
const block = src.split("// ---- pure:start")[1]?.split("// ---- pure:end")[0];
assert.ok(block, "pure block markers not found");
const tmp = join(mkdtempSync(join(tmpdir(), "olnu-")), "pure.ts");
writeFileSync(tmp, "//" + block);
const m = await import(pathToFileURL(tmp).href);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const LUD = { lat: 60.1496, lng: 15.1878 };
const at = (km, count) => ({ lat: LUD.lat + km / 111.32, lng: LUD.lng, beer_count: count });

t("haversine ~ 1 deg lat = 111 km", () => {
  const d = m.haversineKm({ lat: 60, lng: 15 }, { lat: 61, lng: 15 });
  assert.ok(Math.abs(d - 111.2) < 0.5, String(d));
});

t("chaos: 9 out, 2 hot -> calm", () => {
  const beers = [...Array(7)].map(() => at(1, 2)).concat([at(2, 5), at(3, 7)]);
  assert.deepEqual(m.chaosCheck(LUD, beers), { out: 9, hot: 2, chaos: false });
});
t("chaos: 10 out -> chaos", () => {
  const beers = [...Array(10)].map(() => at(1, 1));
  assert.equal(m.chaosCheck(LUD, beers).chaos, true);
});
t("chaos: 3 hot -> chaos", () => {
  const r = m.chaosCheck(LUD, [at(0, 5), at(1, 9), at(4.9, 12)]);
  assert.deepEqual(r, { out: 3, hot: 3, chaos: true });
});
t("chaos: beers beyond 5 km and beer_count 0 do not count", () => {
  const beers = [...Array(20)].map(() => at(5.2, 6)).concat([...Array(20)].map(() => at(1, 0)));
  assert.deepEqual(m.chaosCheck(LUD, beers), { out: 0, hot: 0, chaos: false });
});
t("boxAround contains the circle", () => {
  const b = m.boxAround(LUD, 10);
  assert.ok(m.haversineKm(LUD, { lat: b.maxLat, lng: LUD.lng }) >= 10);
  const east = { lat: LUD.lat, lng: b.maxLng };
  assert.ok(m.haversineKm(LUD, east) >= 10);
});

t("drinksOf + chaos counts other drinks (v17)", () => {
  assert.equal(m.drinksOf({ beer_count: 3, other_count: 2 }), 5);
  assert.equal(m.drinksOf({ beer_count: 0, other_count: null }), 0);
  assert.equal(m.drinksOf(null), 0);
  const beers = [0, 0.5, 1].map((km) => ({ ...at(km, 1), other_count: 4 }));
  assert.deepEqual(m.chaosCheck(LUD, beers), { out: 3, hot: 3, chaos: true });
  assert.deepEqual(m.chaosCheck(LUD, [{ ...at(0, 0), other_count: 1 }]), { out: 1, hot: 0, chaos: false });
});

t("milestoneLevel", () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 15].map(m.milestoneLevel), [0, 1, 1, 5, 5, 10, 10]);
});

t("nearestTown: Ludvika and fallback", () => {
  assert.equal(m.nearestTown({ lat: 60.15, lng: 15.19 }), "Ludvika");
  assert.equal(m.nearestTown({ lat: 60.49, lng: 15.44 }), "Borlänge");
  assert.equal(m.nearestTown({ lat: 68.5, lng: 17.5 }), "stan");
  assert.ok(m.TOWNS.length >= 40);
});

t("line lists: about 6 per level, all use {namn}", () => {
  for (const lvl of [1, 5, 10]) {
    assert.ok(m.FRIEND_LINES[lvl].length >= 6);
    for (const l of m.FRIEND_LINES[lvl]) assert.ok(l.includes("{namn}"), l);
  }
  assert.ok(m.KAOS_LINES.length >= 7);
});

t("pickIndex never repeats the last line", () => {
  for (let n = 2; n <= 9; n++) {
    let last;
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const idx = m.pickIndex(n, last);
      assert.ok(idx >= 0 && idx < n);
      assert.notEqual(idx, last);
      seen.add(idx);
      last = idx;
    }
    assert.equal(seen.size, n, "all lines used");
  }
  assert.equal(m.pickIndex(1, 0), 0);
  // edge rand values
  assert.equal(m.pickIndex(3, 2, () => 0.999999), 1);
  assert.equal(m.pickIndex(3, 0, () => 0), 1);
});

t("kaosLineIndex differs on consecutive nights for the same user", () => {
  const n = m.KAOS_LINES.length;
  const nights = ["2026-10-18T03:00:00Z", "2026-10-19T03:00:00Z", "2026-10-26T04:00:00Z", "2026-10-27T04:00:00Z"];
  for (const u of ["a1b2c3d4-0000-0000-0000-000000000001", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
    const ids = nights.map((x) => m.kaosLineIndex(n, x, u));
    assert.notEqual(ids[0], ids[1]);
    assert.notEqual(ids[2], ids[3]);
    for (const i of ids) assert.ok(i >= 0 && i < n);
  }
});

t("kaosPayload text, body and tag (no names, no user id)", () => {
  const p = m.kaosPayload(0, "Ludvika", 12, 3, "2026-10-18T03:00:00Z");
  assert.equal(p.title, "🚨 Nu ballar det ur i Ludvika!");
  assert.equal(p.body, "12 ute · 3 på hot streak");
  assert.equal(p.url, "/");
  assert.equal(p.tag, "olnu-kaos-2026-10-17");
  const q = m.kaosPayload(8, "Falun", 10, 0, "2026-10-26T04:00:00Z");
  assert.equal(q.body, "10 ute");
  assert.equal(q.title, "🍻 10 pers är ute i Falun just nu. Och du då?");
  assert.equal(q.tag, "olnu-kaos-2026-10-25");
  for (let i = 0; i < m.KAOS_LINES.length; i++) {
    assert.ok(!/\{\w+\}/.test(m.kaosPayload(i, "X", 1, 1, "2026-10-18T03:00:00Z").title));
  }
});

t("fill leaves unknown placeholders", () => {
  assert.equal(m.fill("{namn} {x}", { namn: "Bosse" }), "Bosse {x}");
});

// ---- v7 SOCIAL ----
t("titles: ladder (v26, 42 steps by meriter), exact strings, next", () => {
  assert.equal(m.TITLES.length, 42);
  assert.deepEqual(m.titleFor(0), { title: "Rekryt", at: 0, next_title: "Mönstrad Mellanöl", next_at: 5 });
  assert.equal(m.titleFor(4).title, "Rekryt");
  assert.equal(m.titleFor(10).title, "Menig Mjöd");
  assert.equal(m.titleFor(39).title, "Korpral Korkskruv");
  assert.equal(m.titleFor(40).title, "Skumsergeant");
  for (const [, x] of m.TITLES) assert.ok(!/från|Dalarna|Dala|Ludvika|Väsman|Grängesberg|Säfsnäs|Smedjebacken|Grangärde|Humlegården/.test(x), "no place: " + x);
  assert.deepEqual(m.titleFor(7000), { title: "Ölguden", at: 7000, next_title: null, next_at: null });
  assert.equal(m.titleFor(99999).title, "Ölguden");
  assert.equal(m.titleFor(-3).title, "Rekryt");
  assert.equal(m.titleFor(NaN).title, "Rekryt");
  for (let i = 1; i < m.TITLES.length; i++) assert.ok(m.TITLES[i][0] > m.TITLES[i - 1][0]);
});

t("titles match migration 0036 olnu_titles() and docs/js/social.js", () => {
  const sql = readFileSync(join(here, "../migrations/0036_meriter.sql"), "utf8");
  const pairs = [...sql.matchAll(/\((\d+), '([^']+)'\)/g)].map((x) => [Number(x[1]), x[2]]);
  assert.deepEqual(pairs, m.TITLES);
  const js = readFileSync(join(here, "../../docs/js/social.js"), "utf8").split("var TITLES = ")[1].split(";")[0];
  assert.deepEqual(JSON.parse(js), m.TITLES);
});

t("level-up only for a rank reached in the window", () => {
  assert.equal(m.reachedNow(45, 10, 40), true);     // 35 → 45 crosses 40
  assert.equal(m.reachedNow(45, 4, 40), false);     // 41 → 45: reached earlier
  assert.equal(m.reachedNow(40, 1, 40), true);
  assert.equal(m.reachedNow(39, 39, 40), false);    // not there yet
  assert.equal(m.reachedNow(5, 5, 0), false);       // Rekryt never pushes
  assert.equal(m.reachedNow(120, 0, 100), false);   // backfill (no live rows) never pushes
});

t("friend lines with {titel}: level 1 and 5 have some, level 10 has none", () => {
  const n1 = m.FRIEND_LINES[1].filter((l) => l.includes("{titel}")).length;
  const n5 = m.FRIEND_LINES[5].filter((l) => l.includes("{titel}")).length;
  assert.ok(n1 >= 6, String(n1));
  assert.ok(n5 >= 3, String(n5));
  assert.equal(m.FRIEND_LINES[10].filter((l) => l.includes("{titel}")).length, 0);
});

t("fillFriend with and without title", () => {
  assert.equal(m.fillFriend("🎖️ {titel} {namn} dricker för fullo!", "Oskar", "Öl-veteranen"),
    "🎖️ Öl-veteranen Oskar dricker för fullo!");
  assert.equal(m.fillFriend("🎖️ {titel} {namn} dricker för fullo!", "Oskar", ""), "🎖️ Oskar dricker för fullo!");
  for (const lvl of [1, 5, 10]) {
    for (const l of m.FRIEND_LINES[lvl]) assert.ok(!/\{\w+\}/.test(m.fillFriend(l, "A", "")), l);
  }
});

t("levelUpPayload", () => {
  const p = m.levelUpPayload(0, "Bosse", "Korpral Kork", 42);
  assert.equal(p.title, "⬆️ Bosse har blivit befordrad till Korpral Kork!");
  assert.equal(p.url, "/?focus=42");
  assert.equal(p.tag, "olnu-title-42");
  for (let i = 0; i < m.LEVELUP_LINES.length + 2; i++) {
    const q = m.levelUpPayload(i, "X", "Y", 1);
    assert.ok(q.title.includes("X") && q.title.includes("Y") && !/\{\w+\}/.test(q.title));
  }
});

t("comehere: 8 bar lines, bar and no-bar payloads", () => {
  assert.ok(m.COMEHERE_LINES.length >= 8);
  for (const l of m.COMEHERE_LINES) assert.ok(l.includes("{namn}") && l.includes("{bar}"), l);
  const a = m.comeherePayload(0, "Anton", "Puben", 7);
  assert.equal(a.title, "📍 Anton vill att du kommer till Puben!");
  assert.equal(a.url, "/?focus=7");
  const b = m.comeherePayload(0, "Anton", "", 7);
  assert.equal(b.title, "📍 Anton vill att du kommer hit");
  assert.equal(b.url, "/?focus=7");
  for (let i = 0; i < 20; i++) {
    assert.ok(!/\{\w+\}/.test(m.comeherePayload(i, "A", "B", 1).title));
    assert.ok(!/\{\w+\}/.test(m.comeherePayload(i, "A", "", 1).title));
  }
});

t("cleanBarName", () => {
  assert.equal(m.cleanBarName("  Puben\n\t Ludvika  "), "Puben Ludvika");
  assert.equal(m.cleanBarName("x".repeat(100)).length, 60);
  assert.equal(m.cleanBarName(null), "");
  assert.equal(m.cleanBarName(42), "");
  assert.equal(m.cleanBarName("a\u0000b"), "a b");
});

t("sosPayload: exact place rounded to 5 decimals", () => {
  const p = m.sosPayload("Cilla", 60.1496123456, 15.18781, 1700000000000);
  assert.equal(p.title, "🆘 Cilla behöver hjälp!");
  assert.equal(p.body, "Tryck för att se var.");
  assert.equal(p.url, "/?sos=60.14961,15.18781");
  assert.equal(p.sos, true);
  assert.equal(p.tag, "olnu-sos-1700000000000");
});

t("validPt: world (v17), numbers only", () => {
  assert.equal(m.validPt(60.1, 15.2), true);
  assert.equal(m.validPt(37.98, 23.72), true);
  assert.equal(m.validPt(13.75, 100.5), true);
  assert.equal(m.validPt(-33.9, -180), true);
  assert.equal(m.validPt(86, 15), false);
  assert.equal(m.validPt(60, 180.5), false);
  assert.equal(m.validPt("60", 15), false);
  assert.equal(m.validPt(NaN, 15), false);
  assert.equal(m.validPt(undefined, undefined), false);
});

t("msgPayload", () => {
  const p = m.msgPayload("Bosse", "Kommer om 5!", "Gänget", "aaaaaaaa-0000-0000-0000-000000000001");
  assert.equal(p.title, "💬 Bosse: Kommer om 5!");
  assert.equal(p.body, "i Gänget");
  assert.equal(p.url, "/?chat=aaaaaaaa-0000-0000-0000-000000000001");
  assert.equal(p.tag, "olnu-msg-aaaaaaaa-0000-0000-0000-000000000001");
  assert.equal(m.msgPayload("A", "b", "", "g").body, "Nytt i gruppchatten");
});

t("isUuid and bucketStart", () => {
  assert.equal(m.isUuid("aaaaaaaa-0000-0000-0000-000000000001"), true);
  assert.equal(m.isUuid("nope"), false);
  assert.equal(m.isUuid(5), false);
  assert.equal(m.bucketStart(1_000_000, 600), 600_000);
  assert.equal(m.bucketStart(1_199_999, 600), 600_000);
  assert.equal(m.bucketStart(1_200_000, 600), 1_200_000);
  assert.deepEqual(m.RATE_SEC, { comehere: 600, sos: 180, msg: 120, checkin: 600, eta: 600 });
});

// ---- v9 INKALLELSE ----
t("rally lines: ~10 call-out lines with {namn}, ~5 yes lines with {namn} and {yes}", () => {
  assert.ok(m.RALLY_LINES.length >= 10);
  for (const l of m.RALLY_LINES) assert.ok(l.includes("{namn}"), l);
  assert.ok(m.RALLY_LINES.filter((l) => l.includes("{body}")).length >= 5);
  assert.ok(m.RALLY_YES_LINES.length >= 5);
  for (const l of m.RALLY_YES_LINES) assert.ok(l.includes("{namn}") && l.includes("{yes}"), l);
});

t("rallyPayload with and without place, actions, no leftover placeholders", () => {
  const p = m.rallyPayload(0, "Anton", "Behöver män till skyttegraven!", "Pitchers", 42);
  assert.equal(p.title, "🪖 Anton: Behöver män till skyttegraven!");
  assert.equal(p.body, "📍 Pitchers · Svara i appen");
  assert.equal(p.url, "/?rally=42");
  assert.equal(p.tag, "olnu-rally-42");
  assert.equal(p.rally_id, 42);
  assert.deepEqual(p.actions, [{ action: "yes", title: "✅ Jag kommer" }, { action: "no", title: "❌ Kan inte" }]);
  assert.equal(m.rallyPayload(1, "A", "hemma hos mig", null, 7).body, "Svara i appen");
  assert.equal(m.rallyPayload(1, "A", "x", "", 7).body, "Svara i appen");
  assert.equal(m.rallyPayload(1, "Bo", "Ses på Pitchers", null, 7).title, "📯 Bo blåser till samling! Ses på Pitchers");
  for (let i = -3; i < m.RALLY_LINES.length + 3; i++) {
    const q = m.rallyPayload(i, "A", "B", "C", 1);
    assert.ok(q.title.includes("A") && !/\{\w+\}/.test(q.title), q.title);
  }
});

t("rallyYesPayload: stacks per rally, count in text", () => {
  const p = m.rallyYesPayload(0, "Oskar", 7, 42);
  assert.equal(p.title, "✅ Oskar är på väg! 7 på väg nu");
  assert.equal(p.url, "/?rally=42");
  assert.equal(p.tag, "olnu-rally-42-yes");
  for (let i = 0; i < m.RALLY_YES_LINES.length + 2; i++) {
    const q = m.rallyYesPayload(i, "X", 3, 1);
    assert.ok(q.title.includes("X") && q.title.includes("3") && !/\{\w+\}/.test(q.title), q.title);
  }
});

t("parseRallyId", () => {
  assert.equal(m.parseRallyId(42), 42);
  assert.equal(m.parseRallyId("42"), 42);
  for (const bad of [0, -1, 1.5, NaN, Infinity, "", "4a", "-3", " 4", null, undefined, {}, 2 ** 60, "1234567890123456"]) {
    assert.equal(m.parseRallyId(bad), null, String(bad));
  }
});

t("checkin lines: enough, all filled, rate 10 min", () => {
  assert.ok(m.CHECKIN_LINES.length >= 25);
  assert.equal(m.RATE_SEC.checkin, 600);
  for (let i = -1; i < m.CHECKIN_LINES.length + 2; i++) {
    const q = m.checkinPayload(i, "Anton", "La Parma", 7);
    assert.ok(q.title.includes("Anton") && q.title.includes("La Parma") && !/\{\w+\}/.test(q.title), q.title);
    assert.ok(q.body && q.url === "/" && q.tag === "olnu-checkin-7");
  }
  assert.ok(m.checkinPayload(0, "A", "", 1).title.includes("baren"));
});

// ---- v12 KROGARNA ----
t("tip lines: 15, all with {namn} and {bar}", () => {
  assert.equal(m.TIP_LINES.length, 15);
  assert.equal(new Set(m.TIP_LINES).size, 15);
  m.TIP_LINES.forEach((l) => { assert.ok(l.includes("{namn}") && l.includes("{bar}"), l); });
});
t("tipPayload: url, tag, body, no placeholders", () => {
  for (let i = 0; i < 20; i++) {
    const p = m.tipPayload(i, "Anton", "Pitchers", i % 2 ? "fullt ös" : null, "node/123", 7);
    assert.ok(!/[{}]/.test(p.title), p.title);
    assert.ok(p.title.includes("Anton") && p.title.includes("Pitchers"));
    assert.equal(p.url, "/?bar=node%2F123");
    assert.equal(p.tag, "olnu-tip-7");
    if (i % 2) assert.ok(p.body.includes("fullt ös")); else assert.ok(!p.body.includes("”"));
  }
  assert.ok(m.tipPayload(-3, "A", "", "x".repeat(99), "1", 1).body.length < 80);
});
t("takeover lines: 15, payload filled", () => {
  assert.equal(m.TAKEOVER_LINES.length, 15);
  assert.equal(new Set(m.TAKEOVER_LINES).size, 15);
  for (let i = 0; i < 15; i++) {
    const p = m.takeoverPayload(i, "Grabbarna", "La Parma", "n1", "g-1");
    assert.ok(!/[{}]/.test(p.title), p.title);
    assert.ok(p.title.includes("La Parma"));
    assert.equal(p.url, "/?bar=n1");
    assert.equal(p.tag, "olnu-takeover-g-1-n1");
  }
});

// ---- v16 EFTERÅT ----
t("home lines: old + 40 safeHome, all filled", () => {
  assert.equal(m.SAFE_HOME_LINES.length, 40);
  assert.equal(m.homeLineCount(), m.HOME_LINES.length + 40);
  const ms = Date.UTC(2026, 9, 17, 23, 32);   // 01:32 Stockholm (CEST)
  for (let i = 0; i < m.homeLineCount(); i++) {
    const s = m.homeTitle(i, "Oskar", ms);
    assert.ok(s.includes("Oskar") && !/[{}]/.test(s), s);
    if (m.SAFE_HOME_LINES.concat([]).some((x) => x.includes("{tid}")) && s.includes(":")) assert.ok(/01:32|Oskar/.test(s));
  }
  assert.equal(m.hhmm(ms), "01:32");
});
t("voice lines: 20, payload", () => {
  assert.equal(m.VOICE_LINES.length, 20);
  for (let i = 0; i < 20; i++) {
    const p = m.voicePayload(i, "Anton", "Gänget", "g-1");
    assert.ok(p.title.includes("Anton") && !/[{}]/.test(p.title), p.title);
    assert.equal(p.url, "/?chat=g-1");
    assert.equal(p.tag, "olnu-voice-g-1");
    assert.ok(p.body.includes("Gänget"));
  }
});
t("medevac check payload: mates + target", () => {
  for (let i = 0; i < 12; i++) {
    const a = m.medcheckPayload(i, "Lisa", "Oskar", 42, 7);
    assert.ok(a.title.includes("Lisa") && a.title.includes("Oskar") && !/[{}]/.test(a.title), a.title);
    assert.equal(a.url, "/?focus=42");
    assert.equal(a.tag, "olnu-medcheck-7");
    const b = m.medcheckPayload(i, "Lisa", null, null, 7);
    assert.ok(b.title.includes("Lisa") && !b.title.includes("Oskar") && !/[{}]/.test(b.title), b.title);
    assert.equal(b.url, "/");
    assert.ok(b.body.includes("vatten"));
  }
});

// ---- v18 ETA ----
t("eta lines: >= 80 titles, 30 bodies, all with placeholders, no repeats", () => {
  const all = [...m.ETA_LINES.short, ...m.ETA_LINES.mid, ...m.ETA_LINES.long];
  assert.ok(all.length >= 80, String(all.length));
  assert.equal(new Set(all).size, all.length, "duplicate title");
  assert.ok(m.ETA_BODIES.length >= 30);
  assert.equal(new Set(m.ETA_BODIES).size, m.ETA_BODIES.length, "duplicate body");
  for (const l of all) assert.ok(l.includes("{namn}") && l.includes("{min}"), l);
  assert.ok(all.filter((l) => l.includes("{bar}")).length >= all.length - 2);
  for (const l of all.concat(m.ETA_BODIES)) assert.ok(!/\{(?!namn\}|min\}|bar\})/.test(l), l);
});
t("eta kind + minutes left", () => {
  assert.equal(m.etaKind(1), "short"); assert.equal(m.etaKind(5), "short");
  assert.equal(m.etaKind(6), "mid"); assert.equal(m.etaKind(15), "mid");
  assert.equal(m.etaKind(16), "long"); assert.equal(m.etaKind(30), "long");
  const now = Date.parse("2026-10-17T20:00:00Z");
  assert.equal(m.etaMinsLeft("2026-10-17T20:07:00Z", now), 7);
  assert.equal(m.etaMinsLeft("2026-10-17T20:06:01Z", now), 7);
  assert.equal(m.etaMinsLeft("2026-10-17T19:50:00Z", now), 1);
  assert.equal(m.etaMinsLeft("bad", now), 1);
});
t("eta payload: bar url, rally url, filled, tag", () => {
  for (let i = 0; i < 40; i++) {
    for (const min of [3, 10, 27]) {
      const p = m.etaPayload(i, i, "Anton", min, "Pitchers", "osm 1/2", null, 9);
      assert.ok(p.title.includes("Anton") && p.title.includes(String(min)), p.title);
      assert.ok(!/[{}]/.test(p.title + p.body), p.title + p.body);
      assert.equal(p.url, "/?bar=osm%201%2F2");
      assert.equal(p.tag, "olnu-eta-9");
      assert.equal(p.rally_id, undefined);
    }
  }
  const r = m.etaPayload(0, 0, "", 12, null, null, 77, 10);
  assert.equal(r.url, "/?rally=77"); assert.equal(r.rally_id, 77);
  assert.ok(r.title.includes("En vän"), r.title);
  assert.ok(m.etaPayload(1, 0, "", 12, null, null, 77, 10).title.includes("samlingsplatsen"));
  assert.equal(m.etaPayload(0, 0, "A", 5, "B", null, null, 1).url, "/");
  // the short list is used for 5 min, the long one for 30
  assert.equal(m.etaPayload(3, 0, "A", 5, "B", "b", null, 1).title, m.fill(m.ETA_LINES.short[3], { namn: "A", min: 5, bar: "B" }));
  assert.equal(m.etaPayload(3, 0, "A", 30, "B", "b", null, 1).title, m.fill(m.ETA_LINES.long[3], { namn: "A", min: 30, bar: "B" }));
});
t("eta recipients: only mates at the target, plus the rally creator", () => {
  const now = Date.parse("2026-10-17T21:00:00Z");
  const T = { bar_id: "pit", lat: 68.35, lng: 18.80 };
  const recent = "2026-10-17T20:30:00Z", old = "2026-10-17T17:30:00Z";
  const base = { caller: "me", mates: ["a", "b", "c", "d", "e", "f", "g", "h"], target: T, nowMs: now };
  const r = m.etaRecipients({
    ...base,
    checkins: [
      { user_id: "a", bar_id: "pit", lat: 68.35, lng: 18.80, created_at: recent },     // checked in there -> yes
      { user_id: "b", bar_id: "other", lat: 68.3502, lng: 18.80, created_at: recent }, // other bar 20 m away -> no
      { user_id: "c", bar_id: "pit", lat: 68.35, lng: 18.80, created_at: old },        // > 3 h ago -> no
      { user_id: "x", bar_id: "pit", lat: 68.35, lng: 18.80, created_at: recent },     // not a mate -> no
      { user_id: "me", bar_id: "pit", lat: 68.35, lng: 18.80, created_at: recent },    // caller -> no
    ],
    pins: [
      { user_id: "d", lat: 68.3505, lng: 18.80, precise: true },                       // 56 m -> yes
      { user_id: "e", lat: 68.352, lng: 18.80, precise: true },                        // 220 m -> no
      { user_id: "f", lat: 68.35, lng: 18.80, precise: false },                        // approximate -> no
      { user_id: "g", lat: 68.35, lng: 18.80, precise: true, ghost: true },            // ghost -> no
      { user_id: "h", lat: 68.40, lng: 18.90, precise: true, snap_bar: "pit" },        // server snapped to the bar -> yes
      { user_id: "y", lat: 68.35, lng: 18.80, precise: true },                         // not a mate -> no
    ],
  });
  assert.deepEqual(r, ["a", "d", "h"]);
  // rally: creator always (when a mate), target without bar -> check-ins within 100 m count
  const r2 = m.etaRecipients({
    ...base, target: { bar_id: null, lat: 68.35, lng: 18.80 }, rallyCreator: "c",
    checkins: [{ user_id: "b", bar_id: "other", lat: 68.3502, lng: 18.80, created_at: recent }], pins: [],
  });
  assert.deepEqual(r2, ["b", "c"]);
  // rally without coords: only the creator; creator = caller or not a mate -> nobody
  assert.deepEqual(m.etaRecipients({ ...base, target: {}, rallyCreator: "a", checkins: [], pins: [{ user_id: "d", lat: 68.35, lng: 18.8, precise: true }] }), ["a"]);
  assert.deepEqual(m.etaRecipients({ ...base, target: {}, rallyCreator: "me", checkins: [], pins: [] }), []);
  assert.deepEqual(m.etaRecipients({ ...base, target: {}, rallyCreator: "zz", checkins: [], pins: [] }), []);
  assert.equal(m.RATE_SEC.eta, 600);
});

console.log(`\n${passed} tests passed`);

// v22 GRUPPCHEF
{
  let n = 0;
  const p = m.statusReqPayload(3, "Anton", "Kapsylkommandot", 42);
  assert.equal(p.url, "/?status=42"); assert.equal(p.tag, "olnu-status-42");
  assert.ok(p.title.includes("Anton") && p.body.includes("10 min"));
  assert.ok(m.STATUS_LINES.length >= 15 && new Set(m.STATUS_LINES).size === m.STATUS_LINES.length);
  for (let i = -3; i < 40; i++) { assert.ok(m.statusReqPayload(i, "A", "B", 1).title.length > 3); n++; }
  console.log("ok - status_req payload", n);
}
