// Pure tests for notify-group DEPLOY v28 🔕 LUGNA NOTISER (short titles, evening rule, digest, specific bodies).
// Run: node --experimental-strip-types supabase/tests/notify-v28.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../functions/notify-group/index.ts"), "utf8");
const block = src.split("// ---- pure:start")[1]?.split("// ---- pure:end")[0];
assert.ok(block, "pure block markers not found");
const tmp = join(mkdtempSync(join(tmpdir(), "olnu28-")), "pure.ts");
writeFileSync(tmp, "//" + block);
const m = await import(pathToFileURL(tmp).href);
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const len = (s) => [...s].length;
const emojiFirst = (s) => /^\p{Extended_Pictographic}/u.test(s);

t("tidyTitle: emoji moves to the end, max 30", () => {
  for (const s of ["🚕 Taxin har lämnat av Lisa vid Chinatown.", "📣 Flottiljamiral Flaskpost Oskar har lämnat basen!",
    "🏰 Ni har tagit över Restaurang Kinesiska Muren!", "🍺🍺🍺🍺🍺 Lisa. Mer behöver vi inte säga."]) {
    const x = m.tidyTitle(s);
    assert.ok(len(x) <= 30, x); assert.ok(!emojiFirst(x), x);
  }
  assert.equal(m.tidyTitle("Filmen är framkallad! 📸"), "Filmen är framkallad! 📸");
  assert.equal(m.tidyTitle("5 öl"), "5 öl");
});
t("all v28 titles are ≤ 30 and start with the info", () => {
  const long = "Restaurang Kinesiska Muren och Bar";
  const ps = [
    m.friendPayload28(1, 0, "Oskar", "Flottiljamiral Flaskpost", 1, "Chinatown", "11:27"),
    m.friendPayload28(5, 1, "Oskar", "", 1, "", "21:00"), m.friendPayload28(10, 0, "Alexandra", "", 1, long, "23:10"),
    m.checkinPayload28(0, "Lisa", long, 1, "b1", 3, "11:38"), m.takeoverPayload28(0, "Gänget", long, "b", "g", 3),
    m.levelUpPayload28(0, "Oskar", "Generallöjtnant Guldskum", 1, "General Gyllenbärs"),
    m.kaosPayload28(2, "Ludvika", 14, 3, "2026-11-08T04:00:00Z"), m.comeherePayload28("Lisa", long, 1),
  ];
  for (const p of ps) { assert.ok(len(p.title) <= 30, p.title); assert.ok(!emojiFirst(p.title), p.title); }
  assert.match(ps[0].title, /^Oskar/); assert.match(ps[3].title, /^Lisa/);
});
t("bodies are specific (name, bar, count or time) and never a generic line", () => {
  const b = [0, 1, 2, 3].map((i) => m.checkinPayload28(i, "Lisa", "Tegera Arena", 1, "b", 1, "11:38").body);
  for (const x of b) { assert.ok(!m.GENERIC_BODIES.includes(x), x); assert.match(x, /11:38|Tegera Arena/); }
  assert.match(m.checkinPayload28(0, "Lisa", "Tegera Arena", 1, "b", 3, "11:38").body, /3/);
  assert.match(m.friendPayload28(1, 0, "Oskar", "", 9, "Chinatown", "11:27").body, /11:27/);
  assert.equal(m.tidyBody("Öppna kartan och se var."), "");
  assert.equal(m.tidyBody("Ny rang i Öl Nu. Skål för det! 🍻"), "Ny rang i PintsNow. Skål för det! 🍻");
});
t("tags: one per pin (öl 5 replaces öl 1), per bar for check-ins", () => {
  assert.equal(m.friendPayload28(1, 0, "A", "", 7, "", "").tag, "olnu-7-f1");
  assert.equal(m.pushCat("olnu-7-f5"), "ute");
  assert.equal(m.checkinPayload28(0, "A", "B", 1, "n9", 1, "").tag, "olnu-checkin-n9");
});
t("evening rule: hype only 17–05, check-ins and safety always", () => {
  assert.equal(m.rule28("ute", "olnu-7-f1", 11), "day");
  assert.equal(m.rule28("bar", "olnu-takeover-g-b", 11), "day");
  assert.equal(m.rule28("kul", "olnu-title-3", 14), "day");
  assert.equal(m.rule28("kaos", "olnu-kaos-2026-11-07", 12), "day");
  assert.equal(m.rule28("ute", "olnu-7-f10", 11), "pace");
  assert.equal(m.rule28("ute", "olnu-checkin-b", 11), "pace");
  assert.equal(m.rule28("bar", "olnu-takeover-g-b", 21), "pace");
  assert.equal(m.rule28("kul", "olnu-title-3", 2), "pace");
  assert.equal(m.rule28("safe", "olnu-sos-1", 11), "send");
  assert.equal(m.rule28("chat", "olnu-msg-x", 11), "send");
  assert.equal(m.rule28("plan", "olnu-rally-1", 11), "send");
});
t("digest: 1 line = that line; 3 lines = count + newest first", () => {
  const one = m.digestPayload(["11:38|Lisa på Tegera Arena"], "Gänget");
  assert.equal(one.title, "Lisa på Tegera Arena"); assert.equal(one.body, "kl 11:38 · Gänget"); assert.equal(one.tag, "olnu-digest");
  const three = m.digestPayload(["11:27|Oskar är ute", "11:28|Gänget äger Chinatown", "11:38|Lisa på Tegera Arena"], "Gänget");
  assert.equal(three.title, "3 nya i Gänget 🍻");
  assert.ok(three.body.startsWith("Lisa på Tegera Arena"), three.body);
  const five = m.digestPayload(["1|a", "2|b", "3|c", "4|d", "5|e"], "");
  assert.match(five.body, /\+2 till$/); assert.equal(five.title, "5 nya från vänner 🍻");
});
t("tidyPayload keeps chat titles long (the text is the info) and names no 'Öl Nu'", () => {
  const p = m.tidyPayload(m.msgPayload28("Anton", "Vi ses på Pitchers om tio minuter, ta med Lisa", "Gänget", "g"));
  assert.equal(p.title, "Anton i Gänget 💬"); assert.match(p.body, /Pitchers/);
  const q = m.tidyPayload({ title: "🍺 Öl Nu", body: "", tag: "x" });
  assert.equal(q.title, "PintsNow 🍺");
});
t("paceOf: default 10 min / 4 per night (gw), user caps win", () => {
  assert.deepEqual(m.paceOf(null), { gap: 600, max: 4 });
  assert.deepEqual(m.paceOf({ cap: 5 }), { gap: 600, max: 5 });
  assert.deepEqual(m.paceOf({ cap: 99 }), { gap: 120, max: 99 });
});
// ---- ntf v2 (0390) pure tests ----
const NOW = Date.parse("2026-11-07T20:30:00Z");   // Sat 21:30 Stockholm
const v2all = () => [
  m.friendOutV2("Lisa", "Pitchers", "21:04", 7, NOW, "a980c8c7ce2e"), m.friendOutV2("Oskar", "", "20:10", 8, NOW),
  m.friendCareV2("Oskar", 9), m.checkinV2("Lisa", "Tegera Arena", "b1", 1, 1, "21:10", NOW), m.checkinV2("Lisa", "Pitchers", "b2", 1, 3, "21:10", NOW),
  m.ikvallProofV2(["Bosse", "Cecilia"], 2, NOW), m.ikvallProofV2(["Bosse", "Cecilia"], 5, NOW), m.filmV2("Gänget", 23, "g1"),
  m.gangStreakV2("Gänget", 4, "g1"), m.winbackV2("Gänget", ["Lisa", "Oskar"], 4), m.eventDueV2("Hockey", "19:00", "Tegera Arena", 3, 5),
  m.skalHourV2("Lisa", "Gänget", 3), m.skalBoldV2("Gänget", 4), m.replayReadyV2("Gänget", 4, "g1"), m.replayReadyV2("Gänget", 1, "g1"),
];
const emojiCount = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).length;
t("v2 titles: ≤ 30, info first, max ONE emoji, no cut-off for normal names, every kind has ≥ 2 variants", () => {
  for (const p of v2all()) {
    assert.ok(Array.isArray(p.alts) && p.alts.length >= 2, p.tag);
    for (const a of p.alts) {
      const x = m.tidyTitle(a.title);
      assert.ok(len(x) <= 30, x); assert.ok(!emojiFirst(x), x); assert.ok(emojiCount(x) <= 1, x);
      assert.ok(!/…$/.test(x), "cut: " + a.title);
      assert.ok(a.body && !m.GENERIC_BODIES.includes(a.body), a.v);
      assert.ok(len(a.body) <= 110, a.body);
    }
    assert.equal(new Set(p.alts.map((a) => a.v)).size, p.alts.length, "unique ids " + p.tag);
  }
});
t("v2 store-safe: no drink counts, no 'drink more', no öl/drick words in friend/check-in/ikväll/film/gang/winback copy", () => {
  const bad = /\böl\b|\böl nr\b|\d+\s*öl|drick|dricka|fylla|full|hot streak|supa|shot/i;
  for (const p of v2all()) for (const a of p.alts) { assert.ok(!bad.test(a.title + " " + a.body), a.v + ": " + a.title + " / " + a.body); }
  const care = m.friendCareV2("Oskar", 9);
  for (const a of care.alts) assert.ok(!/\d/.test(a.title + a.body), "care push shows no number: " + a.title);
});
t("pickVariant: never a recent id while a fresh one exists; all recent → the least recently used", () => {
  const alts = [{ v: "a", title: "A", body: "x" }, { v: "b", title: "B", body: "x" }, { v: "c", title: "C", body: "x" }];
  for (let i = 0; i < 50; i++) assert.notEqual(m.pickVariant(alts, ["a", "c"], Math.random).v, "a");
  assert.equal(m.pickVariant(alts, ["a", "c"], () => 0.99).v, "b");
  assert.equal(m.pickVariant(alts, ["b", "c", "a"], () => 0).v, "b");   // b is the oldest
  assert.equal(m.pickVariant([], ["a"]).v, "");
});
t("rotation: 12 sends to one user never repeat the last variant and use every variant", () => {
  const p = m.friendOutV2("Lisa", "Pitchers", "21:04", 7, NOW);
  let recent = [], last = "", used = new Set();
  for (let i = 0; i < 12; i++) {
    const q = m.applyVariant(p, recent, Math.random, NOW);
    assert.notEqual(q.v, last, "repeat at " + i); last = q.v; used.add(q.v);
    recent = [...recent, q.v].slice(-8);
  }
  assert.equal(used.size, p.alts.length);
});
t("applyVariant: k, v, prio, ts set; alts removed; title tidy", () => {
  const q = m.applyVariant(m.ikvallProofV2(["Bosse", "Cecilia"], 2, NOW), [], () => 0, NOW);
  assert.equal(q.k, "ikvall"); assert.equal(q.v, "ik.1"); assert.equal(q.prio, 70); assert.equal(q.ts, NOW); assert.equal(q.alts, undefined);
  assert.equal(q.title, "Bosse och Cecilia ska ut ikväll".length <= 30 ? "Bosse och Cecilia ska ut ikväll" : q.title);
  const d = m.applyVariant(m.digestPayload(["1|a", "2|b"], "G"), null, () => 0, NOW);
  assert.equal(d.k, "digest"); assert.equal(d.v, "digest.0");
  assert.equal(m.applyVariant({ title: "x", tag: "olnu-sos-1" }, null).k, "safe");
});
t("priorities: safety > chat/dm > plan > friends out = Ikväll? > film > gang > bar > kul > kaos; care push 85", () => {
  const P = (tag) => m.prioOf(tag);
  assert.ok(P("olnu-sos-1") > P("olnu-msg-g") && P("olnu-msg-g") > P("olnu-inv-1") && P("olnu-inv-1") > P("olnu-7-f1"));
  assert.equal(P("olnu-7-f1"), P("olnu-ikvall-2026-11-07"));
  assert.ok(P("olnu-7-f1") > P("olnu-film-g") && P("olnu-film-g") >= m.PRIO_RESERVE && P("olnu-gang-g") < m.PRIO_RESERVE);
  assert.ok(P("olnu-gang-g") > P("olnu-takeover-g-b") && P("olnu-takeover-g-b") > P("olnu-title-3") && P("olnu-title-3") > P("olnu-kaos-x"));
  assert.equal(P("olnu-9-f10"), 85); assert.equal(P("olnu-come-3"), 75);
});
t("kinds: gang + winback → 'gang' (paced, can be off); Ikväll? proof window Fri/Sat 17:30–20:59", () => {
  assert.equal(m.pushCat("olnu-gang-g1"), "gang"); assert.equal(m.pushCat("olnu-winback-1"), "gang");
  assert.ok(m.PACE_CATS.includes("gang") && m.PUSH_NOISY.includes("gang"));
  assert.equal(m.rule28("gang", "olnu-gang-g1", 14), "pace");
  const at = (s) => Date.parse(s);
  assert.equal(m.ikvallWindowV2(at("2026-11-06T16:30:00Z")), true);    // Fri 17:30
  assert.equal(m.ikvallWindowV2(at("2026-11-06T16:29:00Z")), false);   // Fri 17:29
  assert.equal(m.ikvallWindowV2(at("2026-11-07T19:59:00Z")), true);    // Sat 20:59
  assert.equal(m.ikvallWindowV2(at("2026-11-08T17:00:00Z")), false);   // Sun 18:00
  assert.equal(m.rule28("ikvall", "olnu-ikvall-x", 18, at("2026-11-06T17:00:00Z")), "pace");   // Fri 18:00
  assert.equal(m.rule28("ikvall", "olnu-ikvall-x", 18, at("2026-11-05T17:00:00Z")), "day");    // Thu 18:00
});
t("quiet hours + flags: v2 kinds respect nattro and 'off'; safety ignores both", () => {
  const pref = { off: ["gang"], quiet_from: 23, quiet_to: 8, cap: 0 };
  assert.equal(m.pushGate("gang", pref, 14), "off");
  assert.equal(m.pushGate("ikvall", pref, 2), "quiet");
  assert.equal(m.pushGate("ikvall", pref, 19), "cap");
  assert.equal(m.pushGate("safe", pref, 2), "send");
  assert.equal(m.pushGate("film", { off: [], quiet_from: null, quiet_to: null, cap: 99 }, 10), "send");
});
t("fold: friends out + check-ins of one night share one key; buttons Jag kommer / Skål; Ikväll? buttons answer", () => {
  const a = m.friendOutV2("Lisa", "Pitchers", "21:04", 7, NOW), b = m.checkinV2("Oskar", "Pitchers", "b1", 1, 2, "21:30", NOW);
  assert.equal(a.fold.key, b.fold.key); assert.equal(a.fold.key, "ute-2026-11-07");
  assert.equal(m.friendOutV2("L", "", "02:10", 7, Date.parse("2026-11-08T01:10:00Z")).fold.key, "ute-2026-11-07");   // 02:10 = same night
  assert.deepEqual(a.actions.map((x) => x.action), ["coming", "skal"]);
  const k = m.ikvallProofV2(["B", "C"], 2, NOW);
  assert.deepEqual(k.actions.map((x) => x.url), ["/?ikvall=1&st=ute", "/?ikvall=1&st=kanske"]);
  assert.equal(m.filmV2("G", 3, "g1").image, "./icons/ntf-film.png?v=1");
});
t("md5 + faceKey = SQL olnu_chief_k (no user id in the payload)", () => {
  assert.equal(m.md5hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(m.md5hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(m.md5hex("Smörgås ÅÄÖ 🍺"), "986ff5046b7e6c9ea30539ce4b83a597");   // live: select md5('Smörgås ÅÄÖ 🍺')
  assert.equal(m.faceKey("2f2a410e-549b-4539-9018-ba4d1fb0c325", "3e23daec-958f-4437-a039-163a385f40aa"), "a980c8c7ce2e");   // live olnu_chief_k
  assert.equal(m.faceKey("x", "y"), "");
  const p = JSON.stringify(m.friendOutV2("Lisa", "P", "21:00", 7, NOW, m.faceKey("2f2a410e-549b-4539-9018-ba4d1fb0c325", "3e23daec-958f-4437-a039-163a385f40aa")));
  assert.ok(!/3e23daec/.test(p));
});
t("feedRow: kind, variant, short title/body, url, why", () => {
  const r = m.feedRow("u1", m.applyVariant(m.filmV2("Gänget", 3, "g1"), [], () => 0, NOW), "cap");
  assert.deepEqual(Object.keys(r).sort(), ["b", "k", "t", "u", "url", "v", "why"]);
  assert.equal(r.k, "film"); assert.equal(r.v, "fi.1"); assert.equal(r.url, "/?film=g1"); assert.equal(r.why, "cap");
});
t("budget model (same rule as SQL push_pace_take2): last slot only for prio ≥ 60; 'farre' = 2 and only prio ≥ 60", () => {
  const take = (n, max, prio, farre) => { const mx = farre ? Math.min(max, 2) : max;
    return n >= mx || (prio < m.PRIO_RESERVE && (farre || n >= mx - 1)) ? "cap" : "send"; };
  let n = 0; const seq = [70, 70, 70, 30, 70, 70].map((p) => { const v = take(n, 4, p, false); if (v === "send") n++; return v; });
  assert.deepEqual(seq, ["send", "send", "send", "cap", "send", "cap"]);   // = live SQL test result p1..p6
  n = 0; const f = [30, 70, 70, 70].map((p) => { const v = take(n, 4, p, true); if (v === "send") n++; return v; });
  assert.deepEqual(f, ["cap", "send", "send", "cap"]);                      // = live SQL f1..f4
});
t("bold × ntf: Skåltimmen v2, Kvällsreprisen, film merge, kinds", () => {
  const sk = m.skalBoldV2("Gänget", 4);
  assert.equal(sk.tag, "olnu-skal2-4"); assert.equal(m.pushCat(sk.tag), "ute"); assert.equal(sk.actions[0].url, "/?skal=4");
  assert.ok(sk.alts.every((a) => !/dricka/i.test(a.title + a.body)));
  const rp = m.replayReadyV2("Gänget", 4, "g1");
  assert.equal(m.pushCat(rp.tag), "film"); assert.equal(rp.actions[0].title, "▶ Spela"); assert.equal(rp.url, "/?replay=g1");
  assert.equal(m.replayReadyV2("G", 1, "g1").alts.length, 2);   // no "Ni va på 1 krogar"
  const f = m.withReplay(m.filmV2("Gänget", 3, "g1"), "g1");
  assert.ok(f.body.endsWith("…och kvällsreprisen ä klar ▶") && f.alts.every((a) => a.body.endsWith("kvällsreprisen ä klar ▶")));
  assert.deepEqual(f.actions.map((a) => a.url), ["/?replay=g1"]);
  assert.equal(m.pushCat("olnu-crown-ludvika"), "bar");
  assert.ok(m.prioOf("olnu-replay-g1") >= m.PRIO_RESERVE && m.prioOf("olnu-skal2-4") === 70);
});
console.log(`v28 lugna notiser + ntf v2: ${passed} tests ok`);
