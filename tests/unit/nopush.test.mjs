// E2 / B1 / A36 / B2 (owner default 24 Nov 2026): texts that push drinking must not come back.
// Scans every string the app ships (docs/js, docs/app.js, docs/data/**.json, docs/*.html, supabase/functions) for the
// banned phrases below. A count is information only. A line may opt out with the marker "pushban-ok" (a filter list that
// REMOVES such a phrase, never a shown text). Plus: the drink-race ticker kinds are skipped in every build, the
// after-beer text is one fact, the weekend-streak push is off, ride texts are short (I-19d).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { DOCS, loadScript, functionSource } from "./load.mjs";

const ROOT = path.resolve(DOCS, "..");
export const BANNED = [
  // the owner's list (OWNER-INPUTS B1, A36)
  /nästa öl om/i, /next beer in\b/i, /öl kvar till/i, /beers? left to/i, /respekt från redaktionen/i, /kör hårt:/i,
  /kör hårt – fem öl/i, /hot streak/i, /fått upp farten/i,
  // praise of the count, records, "one more"
  /bara att köra/i, /skicka en hyllning/i, /legendrapport/i, /legend report/i, /legend mode!/i, /entered legend mode/i,
  /you go hard/i, /en öl till och/i, /one more and it burns/i, /one beer from/i, /drinking at full speed/i, /dricker för fullo/i,
  /hela byn väntar på din femte/i, /beställ en till/i,
  // shame for staying home / pausing (POLICY-GAPS critical pools)
  /sitta hemma/i, /sitter i soffan\?/i, /still on the couch/i, /tråkmåns/i, /svag insats/i, /öltorsk/i, /tappat räkningen/i, /lost count/i,
  /nån måste ta första ölen/i, /nån som tar första ölen/i, /väntar på en hjälte/i, /törsten kommer tillbaka/i, /thirst comes back/i, /beer drought/i,
  // weekend-streak pressure (product report: switch the push off)
  /hänger på en tråd/i, /räddar dem/i, /helgen är räddad/i,
  // the old empty-log and share-card words (design2 small fixes 4 and 5)
  /så börjar rapporten/i, /bästa streak/i, /best streak/i,
];

function walk(dir, out, ext) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "img") walk(p, out, ext); }
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}
const prevSig = (s, i) => { for (let j = i - 1; j >= 0; j--) if (!/\s/.test(s[j])) return s[j]; return ";"; };
// every string literal (with its line) of a JS / TS file; comments and regex literals are skipped
export function strings(src) {
  const out = []; let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") { line++; continue; }
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); i = (j < 0 ? src.length : j) - 1; continue; }
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); const end = j < 0 ? src.length : j + 1; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    if (c === "/" && /[(,=:[!&|?{};]/.test(prevSig(src, i))) {
      for (i++; i < src.length && src[i] !== "/" && src[i] !== "\n"; i++) { if (src[i] === "\\") i++; else if (src[i] === "[") { for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++; } }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const at = line; let j = i + 1, t = "";
      for (; j < src.length && src[j] !== c; j++) { if (src[j] === "\\") { t += src[j] + src[j + 1]; j++; continue; } if (src[j] === "\n") { line++; if (c !== "`") break; } t += src[j]; }
      out.push({ t, line: at }); i = j; continue;
    }
  }
  return out;
}
function files() {
  return [
    ...walk(path.join(DOCS, "js"), [], /\.js$/), path.join(DOCS, "app.js"),
    ...walk(path.join(DOCS, "data"), [], /\.json$/), ...walk(DOCS, [], /\.html$/).filter((f) => path.dirname(f) === DOCS && !/^stats/.test(path.basename(f))),   // stats*.html = the owner's panel (metric names)
    ...walk(path.join(ROOT, "supabase", "functions"), [], /\.ts$/),
  ];
}
export function hits() {
  const bad = [];
  for (const f of files()) {
    const src = fs.readFileSync(f, "utf8"), lines = src.split("\n"), rel = path.relative(ROOT, f);
    const list = /\.(js|ts)$/.test(f) ? strings(src) : /\.json$/.test(f) ? [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ t: m[1], line: src.slice(0, m.index).split("\n").length }))
      : src.replace(/<!--[\s\S]*?-->/g, "").split("\n").map((t, k) => ({ t, line: k + 1 }));
    for (const s of list) {
      if (/pushban-ok/.test(lines[s.line - 1] || "")) continue;
      for (const re of BANNED) if (re.test(s.t)) bad.push(rel + ":" + s.line + " " + re + " " + JSON.stringify(s.t.slice(0, 90)));
    }
  }
  return bad;
}

test("no shipped text pushes drinking (banned phrase list)", () => {
  const bad = hits();
  assert.deepEqual(bad, [], "\n" + bad.join("\n"));
});
test("the scanner sees strings, not comments (self check)", () => {
  const s = strings('// hot streak here\nvar a = "HOT STREAK!"; /* nästa öl om */ var r = /"x"/; var b = \'kör hårt: 7\';');
  assert.deepEqual(s.map((x) => x.t), ["HOT STREAK!", "kör hårt: 7"]);
  assert.ok(BANNED.some((re) => re.test(s[0].t)) && BANNED.some((re) => re.test(s[1].t)));
});
test("ticker: drink-race kinds are skipped in the WEB build too; beers per hour only in the store build", () => {
  const U = loadScript("js/util.js").U;
  const N = loadScript("js/news.js", { U, I18N: { t: (k) => k } }).NEWS;
  for (const k of ["meBehind", "meLead", "groupLeader", "recNew", "recChase", "recClose", "meRecNew", "meRec", "hotClose", "medClose", "meHotClose", "meMedClose"])
    assert.equal(N._skip(k), true, k);
  for (const k of ["hot", "med", "barRate", "checkin", "calm"]) assert.equal(N._skip(k), false, k);
});
test("after-beer text: one plain fact (no level name, no joke about the number)", () => {
  const src = fs.readFileSync(path.join(DOCS, "js/app-beer.js"), "utf8");
  const f = vm.runInNewContext("(" + functionSource(src, "levelToast") + ")", { tl: (sv, en) => sv });
  assert.equal(f(5), "Öl nr 5 ikväll"); assert.equal(f(10), "Öl nr 10 ikväll"); assert.equal(f(1), "Öl nr 1 ikväll");
});
const NG = fs.readFileSync(path.join(ROOT, "supabase/functions/notify-group/index.ts"), "utf8");
const ng = (names) => vm.runInNewContext(names.map((n) => stripTypeScriptTypes(functionSource(NG, n))).join("\n") + "\n({" + names.join(",") + "})");
test("weekend-streak push is off and the face icon is off (one icon, I-19e)", () => {
  assert.match(NG, /export const HELG_PUSH_ON = false;/);
  assert.match(NG, /if \(!HELG_PUSH_ON\) return \{ \.\.\.NONE, reason: "off" \};/);
  assert.match(NG, /export const FACE_ICON = false;/);
});
test("ride texts (I-19d, B2 rows 33-38): short, one idea, no dialect", () => {
  const f = ng(["tidyRideText", "rideTitle", "rideBody", "rideAction"]);
  assert.equal(f.rideTitle("Oskar tar dig!"), "Oskar kommer");
  assert.equal(f.rideTitle("Oskar ä framme"), "Oskar är här");
  assert.equal(f.rideTitle("Lisa vill ringa dig"), "Lisa vill ringa");
  assert.equal(f.rideTitle("Lisa behöver int' skjuts längre"), "Skjutsen är avbokad");
  assert.equal(f.rideTitle("Oskar kunde int' köra"), "Ny förare söks");
  assert.equal(f.rideTitle("Lisa behöver skjuts"), "Lisa behöver skjuts");
  assert.equal(f.rideBody("Från Pitchers → Centrum · 2 pers · 1,2 km · resa ca 4,0 km"), "Från Pitchers · 2 pers · 1,2 km");
  assert.equal(f.rideBody("Röd Volvo · ca 3 min · Tryck för att följa bilen"), "Röd Volvo · ca 3 min");
  assert.equal(f.rideBody("Vid Pitchers · Röd Volvo · Kolla att det ä rätt bil"), "Pitchers · Röd Volvo. Kolla bilen.");
  assert.equal(f.rideBody("Vid nära Taste Of India · Röd Volvo · Kolla att det ä rätt bil"), "Röd Volvo. Kolla bilen.");
  assert.equal(f.rideBody("Visa ditt nummer? Tryck för att svara."), "Visa ditt nummer?");
  assert.equal(f.rideBody("Du kan släppa den. Tack ändå!"), "Tack ändå!");
  assert.equal(f.rideBody("Vi frågar de andra. Tryck för att se läget."), "Vi frågar de andra.");
  assert.equal(f.rideAction("Kan int'"), "Kan inte");
  for (const t of ["Oskar kommer", "Oskar är här", "Skjutsen är avbokad"]) assert.ok(!/(^|\s)ä(\s|$)|int'/.test(t), t);
});
test("privacy start (B3/B8): a NEW phone = area, friends only, position log off; an OLD phone keeps its settings", () => {
  const w = loadScript("js/privstart.js");
  const L = w.localStorage;
  assert.equal(w.PN.privStart.state(), "new");
  assert.equal(L.getItem("olnu.prec"), "area"); assert.equal(L.getItem("olnu.visMode"), "vanner"); assert.equal(L.getItem("olnu.logLoc"), "0");
  assert.equal(w.PN.privStart.needSync(), true); w.PN.privStart.synced(); assert.equal(w.PN.privStart.needSync(), false);
  // an old phone: has an account and the intro; no privacy keys = the old defaults (exact, Alla, log on) stay
  const o = loadScript("js/privstart.js", {});   // fresh sandbox; prime it like a phone used before
  const store = {}; const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  store["olnu.intro"] = "1"; store["olnu.auth"] = "{}";
  const w2 = { localStorage: ls }; w2.window = w2;
  vm.runInNewContext(fs.readFileSync(path.join(DOCS, "js/privstart.js"), "utf8"), vm.createContext(w2));
  assert.equal(w2.PN.privStart.state(), "old"); assert.ok(o.PN.privStart);
  assert.equal(store["olnu.prec"], undefined); assert.equal(store["olnu.visMode"], undefined); assert.equal(store["olnu.logLoc"], undefined);
  assert.equal(w2.PN.privStart.needSync(), false);
  // runs once: a second load keeps the first answer
  vm.runInNewContext(fs.readFileSync(path.join(DOCS, "js/privstart.js"), "utf8"), vm.createContext(w2));
  assert.equal(w2.PN.privStart.state(), "old");
});
