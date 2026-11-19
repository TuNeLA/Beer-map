// Öppen ikväll (P-088, lane dating2): the pure client rules (docs/js/dating-logic.js), the gate of the hook (docs/js/dating.js),
// and the safety rules of the SQL file (supabase/migrations/0530_dating.sql). No browser, no database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, "docs/js/dating-logic.js"));
const SQL = fs.readFileSync(path.join(ROOT, "supabase/migrations/0530_dating.sql"), "utf8");

const plan = [{ t: "A", q: [1, 2, 3, 4] }, { t: "B", q: [1, 2, 3] }, { t: "E", q: [5, 6, 7, 8] }];
const base = (o) => ({ on: true, pair: Object.assign({ id: "p1", state: "playing", round: 1, step: 0, my_step: 0, plan, answers: {}, them_done: [], complete: false, me: "Gul räv", them: "Blå uggla", reveal: {}, meet: { me: false, code: null }, msgs: [] }, o) });

test("items per round = the server (A D E 4, B 3, C 3)", () => {
  assert.deepEqual(["A", "B", "C", "D", "E"].map(L.items), [4, 3, 3, 4, 4]);
  for (const t of ["A", "B", "C", "D", "E"]) assert.ok(SQL.includes("when 'B' then 3 when 'C' then 3 else 4"), t);
});

test("screen: off / open / nothing before the notice (threshold not met = nothing shown)", () => {
  assert.equal(L.screen(null).name, "off");
  assert.equal(L.screen({ on: false, pair: null }).name, "off");
  assert.equal(L.screen({ on: true, pair: null }).name, "open");   // the server hides a pair before notice_at: same as no pair
});

test("screen: notice, my yes = wait, the other's yes is never shown", () => {
  assert.equal(L.screen({ on: true, pair: { id: "p", state: "offered", mine: null, left_s: 300 } }).name, "notice");
  assert.equal(L.screen({ on: true, pair: { id: "p", state: "offered", mine: true, left_s: 300 } }).name, "waitOffer");
});

test("screen: play → waitThem → decide → waitStep → reveal (both must agree at each step)", () => {
  let s = base();
  assert.deepEqual([L.screen(s).name, L.screen(s).item], ["play", 0]);
  const four = { "1.0": { me: "a" }, "1.1": { me: "b" }, "1.2": { me: "a" }, "1.3": { me: "s" } };
  s = base({ answers: four });
  assert.equal(L.screen(s).name, "waitThem");
  s = base({ answers: four, complete: true });
  assert.deepEqual([L.screen(s).name, L.screen(s).step], ["decide", 1]);
  s = base({ answers: four, complete: true, my_step: 1 });
  assert.equal(L.screen(s).name, "waitStep");   // I said yes; the other has not: nothing is revealed
  s = base({ round: 2, step: 1, my_step: 1, reveal: { age: "25-34" } });
  assert.deepEqual([L.screen(s, { seenStep: 0 }).name, L.screen(s, { seenStep: 0 }).step], ["reveal", 1]);
  assert.equal(L.screen(s, { seenStep: 1 }).name, "play");
});

test("screen: B guess waits for the other's three lines", () => {
  const s = base({ round: 2, step: 1, answers: { "2.0": { me: "x\ny\nz" }, "2.1": { me: "1" } } });
  assert.equal(L.screen(s, { seenStep: 1 }).name, "waitThem");
  s.pair.answers["2.0"].them = "a\nb\nc";
  assert.deepEqual([L.screen(s, { seenStep: 1 }).name, L.screen(s, { seenStep: 1 }).item], ["play", 2]);
});

test("screen: chat, code word once, ended (one end text for every reason)", () => {
  let s = base({ state: "chat", step: 3, round: 3 });
  assert.equal(L.screen(s, { seenStep: 3 }).name, "chat");
  s = base({ state: "chat", step: 3, round: 3, meet: { me: true, code: "Hjortron" } });
  assert.equal(L.screen(s, { seenStep: 3 }).name, "code");
  assert.equal(L.screen(s, { seenStep: 3, codeSeen: true }).name, "chat");
  const e = L.screen({ on: true, pair: { id: "p9", state: "ended", ended: true, phase: "game" } }, {});
  assert.deepEqual([e.name, e.phase, e.seen], ["ended", "game", false]);
  assert.equal(L.screen({ on: true, pair: { id: "p9", state: "ended", phase: "game" } }, { ended: "p9" }).seen, true);
  // a no, a timeout, Stopp, block, report, check-out: the server sends only {state: ended, phase}; the text depends on the phase only
  assert.equal(L.endKey("offer", true), "endOfferOpen");
  assert.equal(L.endKey("offer", false), "endOffer");
  assert.equal(L.endKey("game", true), "endGame");
  assert.equal(L.endKey("game", false), "endGame");
});

test("score: A/D same choice, skip not counted; E guesses both ways; B lie found; C glass guessed", () => {
  const p = base({ answers: { "1.0": { me: "a", them: "a" }, "1.1": { me: "b", them: "a" }, "1.2": { me: "s", them: "a" }, "1.3": { me: "b", them: "b" } } }).pair;
  assert.deepEqual(L.score(p, 1), [2, 3]);
  const e = base({ plan: [{ t: "E", q: [1, 2, 3, 4] }], answers: { "1.0": { me: "jn", them: "nj" }, "1.1": { me: "jj", them: "nn" } } }).pair;
  assert.deepEqual(L.score(e, 1), [2, 4]);   // item0: my guess n = their n (hit), their guess j = my j (hit); item1: 0 hits
  const b = base({ plan: [{ t: "B", q: [1, 2, 3] }], answers: { "1.0": { me: "x", them: "y" }, "1.1": { me: "2", them: "0" }, "1.2": { me: "0", them: "1" } } }).pair;
  assert.deepEqual(L.score(b, 1), [1, 2]);
  const c = base({ plan: [{ t: "C", q: [3] }], answers: { "1.0": { me: "4", them: "1" }, "1.1": { me: "1", them: "4" } } }).pair;
  assert.deepEqual(L.score(c, 1), [2, 2]);
});

test("filter: Swedish phone numbers, links, e-mail, @handles, apps, block words (same rules as the server)", () => {
  for (const s of ["070-123 45 67", "+46 70 123 45 67", "0701234567", "ring 08-123 456 78"]) assert.equal(L.filter(s), "phone", s);
  for (const s of ["www.exempel.se", "kolla https://x.y", "pintsnow.com"]) assert.equal(L.filter(s), "link", s);
  assert.equal(L.filter("maja@exempel.se"), "mail");
  assert.equal(L.filter("adda @maja_92"), "handle");
  assert.equal(L.filter("min snapchat är maja"), "handle");
  assert.equal(L.filter("skicka nudes"), "word");
  for (const s of ["Bastu i fjällen, respekt. Kl 22 vid baren?", "6 av 8!", "Jag föddes 1995", "Haha nä"]) assert.equal(L.filter(s), "ok", s);
  // the server has the same lists
  for (const w of ["snapchat", "whatsapp", "nudes", "knulla", "(se|com|nu|net|org|io|me|app|ly|gg|tv|link|xyz)"]) assert.ok(SQL.includes(w), w);
});

test("expiry: the next 06:00 Stockholm, also over a DST change", () => {
  const at = (iso) => new Date(iso).getTime();
  assert.equal(new Date(L.nightEnd(at("2026-11-19T21:00:00Z"))).toISOString(), "2026-11-20T05:00:00.000Z");   // CET: 06:00 = 05:00Z
  assert.equal(new Date(L.nightEnd(at("2026-11-20T04:59:00Z"))).toISOString(), "2026-11-20T05:00:00.000Z");
  assert.equal(new Date(L.nightEnd(at("2026-11-20T05:00:00Z"))).toISOString(), "2026-11-21T05:00:00.000Z");
  assert.equal(new Date(L.nightEnd(at("2026-07-01T22:00:00Z"))).toISOString(), "2026-07-02T04:00:00.000Z");   // CEST: 06:00 = 04:00Z
  assert.equal(new Date(L.nightEnd(at("2026-03-28T23:30:00Z"))).toISOString(), "2026-03-29T04:00:00.000Z");   // the spring-forward night
  const now = at("2026-11-19T22:00:00Z");
  assert.equal(L.stillOn({ until: L.nightEnd(now) }, now), true);
  assert.equal(L.stillOn({ until: now - 1 }, now), false);
  assert.equal(L.stillOn({ until: L.nightEnd(now) + 24 * 3600e3 }, now), false);   // an "on" from a later night is not trusted
});

test("poll: quiet while open, quick in a game, none when hidden or off", () => {
  assert.equal(L.pollMs({ on: false, pair: null }, false, false), 0);
  assert.equal(L.pollMs({ on: true, pair: null }, false, false), 20000);
  assert.equal(L.pollMs({ on: true, pair: { state: "playing" } }, true, false), 3000);
  assert.equal(L.pollMs({ on: true, pair: { state: "playing" } }, false, false), 8000);
  assert.equal(L.pollMs({ on: true, pair: { state: "playing" } }, true, true), 0);
});

// the hook in a sandbox: which channel loads the lazy files
function hook(o) {
  const loads = [], ss = {}, store = Object.assign({}, o.ls || {});
  const doc = {
    getElementById: (id) => (id === "olnu-beta" && o.badge ? {} : null), querySelectorAll: () => [], body: {}, head: { appendChild: () => {} },
    createElement: () => ({ setAttribute() {}, appendChild() {} }), referrer: ""
  };
  const win = {
    document: doc, location: { search: "", hostname: "x" }, localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    sessionStorage: { getItem: (k) => ss[k] || null, setItem: (k, v) => { ss[k] = v; } },
    PN: { load: (src) => { loads.push(src); return new Promise(() => {}); }, mod: () => {} },
    setTimeout: (f) => f(), requestAnimationFrame: (f) => f()
  };
  if (o.beta) win.PN_BETA = "abc1234";
  if (o.store != null) win.OLNU_STORE = o.store;
  win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "docs/js/dating.js"), "utf8"), Object.assign(win, { window: win, document: doc, location: win.location, Date, JSON, Promise, String, RegExp, setTimeout: win.setTimeout }));
  win.DATING.init({});
  return { win, loads };
}
test("gate: stable and store builds load no dating code; beta does", () => {
  assert.equal(hook({}).win.DATING.allowed(), false);                          // stable / live
  assert.equal(hook({ store: true, beta: true }).win.DATING.allowed(), false); // store build, even with beta code
  assert.equal(hook({ beta: true, store: false }).win.DATING.allowed(), true);
  assert.equal(hook({ badge: true }).win.DATING.allowed(), true);              // the beta build's own badge
  // a stored "on tonight" in stable never starts a load
  const until = String(Date.now() + 3600e3);
  assert.deepEqual(hook({ ls: { "olnu.oi.on": JSON.stringify({ until: +until }) } }).loads, []);
  assert.deepEqual(hook({ store: true, beta: true, ls: { "olnu.oi.on": JSON.stringify({ until: +until }) } }).loads, []);
  const b = hook({ beta: true, ls: { "olnu.oi.on": JSON.stringify({ until: +until }) } });
  assert.deepEqual(b.loads, ["./js/dating-logic.js?b=abc1234"]);
  // the lazy files are not named in index.html (the stable service worker precaches every file named there)
  const idx = fs.readFileSync(path.join(ROOT, "docs/index.html"), "utf8");
  for (const f of ["dating-core.js", "dating-ui.js", "dating-logic.js", "dating-content.js", "dating.css"]) assert.ok(!idx.includes(f), f);
  assert.ok(idx.includes('src="./js/dating.js"'));
});

test("texts: never push drinking (no 'en till', 'skål', counts of drinks, 'fyllecourage')", () => {
  const src = ["dating-content.js", "dating-core.js", "dating-ui.js"].map((f) => fs.readFileSync(path.join(ROOT, "docs/js", f), "utf8")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();   // the texts, not the comments that name the banned words
  for (const w of ["en till", "skål", "fyllecourage", "one more", "cheers", "shots", "drick mer", "drink more"]) assert.ok(!src.includes(w), w);
});

test("sql: no remove words, ends with olnu_strip_cr, definer + search_path + auth.uid() in every RPC, no location column", () => {
  assert.ok(!/\b(delete|drop|truncate)\b/i.test(SQL));
  assert.ok(/select public\.olnu_strip_cr\(\);\s*$/.test(SQL));
  const fns = [...SQL.matchAll(/create or replace function public\.((?:oi|owner_oi)_\w+)\(([\s\S]*?)\$\$;/g)];
  assert.ok(fns.length >= 15, "rpcs: " + fns.length);
  for (const m of fns) {
    assert.ok(/security definer set search_path = public/.test(m[2]), m[1] + " definer + search_path");
    assert.ok(/auth\.uid\(\)/.test(m[2]), m[1] + " auth.uid()");
  }
  assert.ok(!/olnu_oi_match[\s\S]{0,40}to authenticated/.test(SQL));
  const tables = [...SQL.matchAll(/create table if not exists public\.(oi_\w+) \(([\s\S]*?)\n\);/g)];
  assert.ok(tables.length >= 10);
  for (const t of tables) assert.ok(!/^\s+(lat|lng|lon|acc|accuracy|pos|geo|dist)\b/m.test(t[2]), t[1]);
  assert.ok(/revoke all on function ' \|\| f \|\| ' from anon/.test(SQL));
});
