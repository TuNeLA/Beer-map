// lane unlocks: js/unlock-parts.js (37 achievements, 12 new avatar items) against avatar.js and SQL 0508.
// Store rule (owner): no achievement counts drinks. Runs the REAL docs/ files in a vm sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { DOCS } from "./load.mjs";

const ROOT = path.resolve(DOCS, "..");
const SQL = fs.readFileSync(path.join(ROOT, "supabase/migrations/0508_unlocks.sql"), "utf8");
const SQL_ON = fs.readFileSync(path.join(ROOT, "supabase/migrations/0511_unlocks_on.sql"), "utf8");

function load() {
  const store = {};
  const w = { console, Math, JSON, Date, Object, Array, String, Number, parseInt, RegExp, Promise, setTimeout,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { addEventListener() {}, querySelectorAll() { return []; } }, U: { esc: (s) => String(s), n1: (s) => s, ls: { get: () => null, set() {} } }, I18N: { lang: "sv" } };
  w.window = w;
  const ctx = vm.createContext(w);
  for (const f of ["js/avatar.js", "js/unlock-parts.js"]) vm.runInContext(fs.readFileSync(path.join(DOCS, f), "utf8"), ctx, { filename: f });
  return w;
}
const sqlJson = (fn) => {
  const m = SQL.match(new RegExp("function public\\." + fn + "\\(\\)[\\s\\S]*?select '([\\s\\S]*?)'::jsonb", "m"));
  assert.ok(m, "SQL " + fn);
  return JSON.parse(m[1]);
};

test("37 achievements, 12 new items at fixed indexes, all registered", () => {
  const w = load(), A = w.AVATAR, D = w.PN.unlockData;
  assert.equal(D.ready(), true);
  assert.equal(D.CAT.length, 37);
  assert.ok(D.CAT.length >= 30 && D.CAT.length <= 40);
  assert.equal(D.NEW.map((p) => p[0] + ":" + p[1]).join(","), ["hw:44", "hw:45", "hw:46", "hw:47", "up:31", "up:32", "nk:16", "nk:17", "gl:30", "fr:11", "fr:12", "bg:39"].join(","));
  for (const c of D.CAT) { const [k, i] = c.reward.split(":"); assert.ok(A.NAMES[k][+i], "reward exists " + c.reward); assert.ok(A.LOCKS[c.reward], "reward locked " + c.reward); }
  assert.equal(new Set(D.CAT.map((c) => c.reward)).size, 37, "one reward per achievement");
  assert.ok(D.CAT.every((c) => c.tier >= 1 && c.tier <= 3 && c.name[0] && c.how[0] && c.line));
});

test("client list = SQL 0508 (catalog, locks4, max)", () => {
  const w = load(), A = w.AVATAR, D = w.PN.unlockData;
  const list = sqlJson("olnu_unlock_list"), locks4 = sqlJson("olnu_avatar_locks4"), max = sqlJson("olnu_avatar_max");
  assert.deepEqual(list, JSON.parse(JSON.stringify(Object.fromEntries(D.CAT.map((c) => [c.id, [c.key, c.need]])))));
  assert.deepEqual(locks4, JSON.parse(JSON.stringify(Object.fromEntries(D.CAT.map((c) => [c.reward, { m: c.id }])))));
  for (const k of ["hw", "up", "nk", "gl", "fr", "bg", "hi", "mt", "sk", "hr"]) assert.equal(max[k], A.MAX[k], "max " + k);
  assert.equal(max.nl, 1, "keeps nl (0397)");
});

test("no achievement counts drinks (store rule)", () => {
  const w = load(), D = w.PN.unlockData;
  const allowed = new Set(["pass", "ci", "town", "lan", "gang", "event", "host", "play", "win", "price", "home", "escort", "buddy", "ride", "driver", "water", "lask", "skal", "photo", "lucia", "jul", "nyar", "mids"]);
  for (const c of D.CAT) assert.ok(allowed.has(c.key), "key " + c.key);
  const body = SQL.slice(SQL.indexOf("function public.olnu_unlock_counts"), SQL.indexOf("function public.olnu_unlock_medals"));
  for (const bad of ["beers", "drink_log", "week_beers", "beer_types", "olnu_lifetime", "medal_nights", "bar_taps"]) assert.ok(!body.includes(bad), "counts read " + bad);
  // no reward is gated by a drink-volume medal
  for (const c of D.CAT) assert.ok(!/^(m\d+|n\d+)$/.test(c.id));
});

test("SQL is additive and CR-safe", () => {
  for (const s of [SQL, SQL_ON]) {
    assert.ok(!/\b(delete|drop|truncate)\b/i.test(s), "no delete/drop/truncate");
    assert.match(s.trim(), /select public\.olnu_strip_cr\(\);$/);
  }
  assert.ok(!/olnu_medal_eval_/.test(SQL.replace(/--.*$/gm, "")), "0508 does not wire the medals (0509 does)");
  assert.match(SQL_ON, /function public\.olnu_medal_eval_unl\(p_uid uuid\)/);
});

test("locks: new item needs its medal; an old item gets one more path; lockText says 'eller'", () => {
  const w = load(), A = w.AVATAR;
  assert.equal(A.unlocked(A.LOCKS["hw:44"], { m: [] }), false);
  assert.equal(A.unlocked(A.LOCKS["hw:44"], { m: ["u_pass25"] }), true);
  assert.equal(A.unlocked(A.LOCKS["hw:27"], { r: 3, m: [] }), false);
  assert.equal(A.unlocked(A.LOCKS["hw:27"], { r: 3, m: ["u_town2"] }), true);
  assert.equal(A.unlocked(A.LOCKS["hw:27"], { r: 7, m: [] }), true, "old rank lock still works");
  assert.match(A.lockText(A.LOCKS["hw:27"]), / eller /);
  assert.doesNotMatch(A.lockText(A.LOCKS["hw:7"]), / eller /, "untouched lock text");
  // a second ready() does not add a path twice
  w.PN.unlockData.ready(); A.addPath("hw:27", { m: "u_town2" });
  assert.equal(A.LOCKS["hw:27"].o.length, 1);
});

test("every new item draws (big + small), and only in its own slot", () => {
  const w = load(), A = w.AVATAR, D = w.PN.unlockData;
  const base = { v: 2, sk: 3, fs: 0, ey: 1, br: 1, mt: 0, hr: 4, hc: 1, hw: 0, gl: 0, up: 0, uc: 2, bg: 1 };
  const plain = A.svg(base, { r: 5 }).replace(/av\d+/g, "");
  for (const p of D.NEW) {
    const s = Object.assign({}, base, { [p[0]]: p[1] });
    for (const small of [false, true]) {
      const x = A.svg(s, { r: 5, small });
      assert.ok(!/undefined|NaN/.test(x), p[2][0] + " clean svg");
      assert.notEqual(x.replace(/av\d+/g, ""), small ? null : plain, p[2][0] + " changes the picture");
    }
    assert.equal(A.clean(s)[p[0]], p[1], p[2][0] + " survives clean()");
  }
});
