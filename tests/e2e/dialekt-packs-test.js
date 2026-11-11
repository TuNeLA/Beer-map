// dialect lane, phase 1: the DIALEKT region packs (docs/js/dialekt-packs/*.js). No browser.
// Loads docs/js/dialekt.js + the modules that register sv-neutral keys + every pack file in a node vm, then checks:
//   every key in every region pack exists in sv-neutral; same {vars} (a region line uses only vars the neutral line has);
//   no empty line; no line over 140 chars (the 4 written region packs); no banned word (slurs, drinking pressure; swearing
//   in the written packs); variant objects are well formed ({t, not|only} with known codes, {mix: 0<p<1});
//   each file registers the locale in its name; preview(region) + t() give region text; mode off gives neutral text.
// usage: node dialekt-packs-test.js [repo root]
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? path.resolve(process.argv[2]) : path.resolve(__dirname, "../..");
const JS = path.join(ROOT, "docs/js"), PK = path.join(JS, "dialekt-packs");
let fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); if (!c) fail++; };

// keep in sync with scratchpad/dialect/tools/banned.py
const SLURS = ["neger", "negrer", "negerboll", "svartskall", "blatte", "blattar", "zigenar", "tattare", "lappjävel", "lapphelvete",
  "lappdjävul", "finnjävel", "finnkoling", "norrbagge", "bonnläpp", "bonnjävel", "hora", "horor", "horunge", "fitta", "bög", "bögig",
  "fjolla", "flata", "mongo", "efterbliven", "efterblivna", "retard", "cp-", "kärring", "hen-galen"];
const PRESSURE = ["supa ner", "supa skallen", "supa sig", "drick mer", "dricka mer", "drick upp", "ta en till", "en till!", "häll i dig",
  "hälla i sig", "svep", "hinka", "bälga", "bunka", "botten upp", "dricka ikapp", "ölrace", "dricka dig full", "dricka sig full", "full som",
  "packad", "asfull", "dyngrak", "stupfull", "på lyset", "kröka", "pimpla", "beställ en till", "en stor stark till", "töm glaset",
  "drick snabbare", "snabbast att dricka"];
const SWEAR = ["jävla", "jävlar", "helvete", "satan", "fan ta", "kuken", "skit i"];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wre = (a) => new RegExp("(?<![a-zåäö])(" + a.map(esc).join("|") + ")(?![a-zåäö])", "i");
const BANNED = wre(SLURS.concat(PRESSURE)), SWEARS = wre(SWEAR);
// lines that say NO to more, or game cards that only name the phrase (listed for the owner in the dialect DONE.md)
const ALLOW = { "medal.levelup|ta en till": 1, "spel.white.283|ta en till": 1, "spel.aldrig.95|en till!": 1 };
const WRITTEN = ["sv-syd", "sv-vast", "sv-sthlm", "sv-norr"];
const CODES = ["sv-neutral", "sv-syd", "sv-vast", "sv-sthlm", "sv-dalarna", "sv-norr", "sv-smaland", "sv-varmland", "sv-norr-ovre", "sv-norr-mitt", "sv-gotland"];
const MAX = 140;

// ---------- a small browser-like sandbox ----------
const store = {};
const noop = () => {};
const el = () => ({ appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, style: {}, classList: { add: noop, remove: noop, toggle: noop } });
const sb = {
  console, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, Promise, JSON, Math, Date,
  performance: { now: () => 0 }, fetch: () => Promise.reject(new Error("no network in test")),
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { readyState: "loading", addEventListener: noop, createElement: el, getElementById: () => null, head: el(), body: el(), querySelector: () => null, querySelectorAll: () => [] },
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, CustomEvent: function () {}, navigator: { language: "sv-SE" }, location: { pathname: "/", search: "" },
};
sb.window = sb; sb.self = sb; sb.globalThis = sb;
vm.createContext(sb);
function load(f, required) {
  try { vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: f }); return true; }
  catch (e) { if (required) ok(false, "load " + path.basename(f), String(e && e.message || e)); return false; }
}
ok(load(path.join(JS, "dialekt.js"), true) && !!sb.DIALEKT, "dialekt.js loads in node");
const D = sb.DIALEKT;
// the modules that own sv-neutral keys register them at load (P objects); a module may crash later on missing DOM: that is fine
fs.readdirSync(JS).filter((f) => f.endsWith(".js") && f !== "dialekt.js" && /DIALEKT\.register\("sv-neutral"/.test(fs.readFileSync(path.join(JS, f), "utf8")))
  .forEach((f) => load(path.join(JS, f), false));

// ---------- packs ----------
ok(fs.existsSync(PK), "docs/js/dialekt-packs exists");
const files = fs.existsSync(PK) ? fs.readdirSync(PK).filter((f) => f.endsWith(".js")).sort() : [];
const regs = {};   // file -> locale(s) it registered
const fromFiles = {};   // locale -> {key: 1} registered by a pack file (module-owned keys are only reported, other lanes own them)
const realReg = D.register;
D.register = function (loc, pack) {
  (regs[cur] = regs[cur] || []).push(loc);
  const o = fromFiles[loc] = fromFiles[loc] || {}; Object.keys(pack || {}).forEach((k) => { o[k] = 1; });
  return realReg(loc, pack);
};
let cur = "";
// neutral first, so the order of the other files does not matter
files.sort((a, b) => (b.startsWith("sv-neutral") ? 1 : 0) - (a.startsWith("sv-neutral") ? 1 : 0));
files.forEach((f) => { cur = f; ok(load(path.join(PK, f), true), "pack file runs: " + f); });
D.register = realReg;
files.forEach((f) => {
  const want = f.replace(/(-lek)?\.js$/, "");
  ok((regs[f] || []).length === 1 && regs[f][0] === want, f + " registers exactly " + want, regs[f]);
});
const packs = D._packs();
const N = packs["sv-neutral"] || {};
const keysOf = (p) => Object.keys(p || {}).filter((k) => k[0] !== "_");
ok(keysOf(N).length > 3000, "sv-neutral has the inventory keys", keysOf(N).length);
for (const c of ["sv-syd", "sv-vast", "sv-sthlm", "sv-dalarna", "sv-norr"]) ok(keysOf(packs[c]).length >= 100, c + " has >= 100 keys", keysOf(packs[c]).length);

const VAR = /\{([A-Za-z_]\w*)\}/g;
const varsOf = (s) => { const o = new Set(); let m; VAR.lastIndex = 0; while ((m = VAR.exec(s))) o.add(m[1]); return o; };
const list = (v) => (Array.isArray(v) ? v : [v]);
const isMix = (x) => x && typeof x === "object" && "mix" in x;
const txt = (x) => (x && typeof x === "object" ? x.t : x);
function nvars(k) { const o = new Set(); list(N[k]).forEach((x) => { if (!isMix(x) && typeof x !== "function") varsOf(String(txt(x))).forEach((v) => o.add(v)); }); return o; }

for (const code of Object.keys(packs)) {
  if (!/^sv-/.test(code)) continue;
  const P = packs[code], bad = { missing: [], vars: [], empty: [], long: [], banned: [], shape: [] };
  for (const k of keysOf(P)) {
    if (code !== "sv-neutral" && !(k in N)) bad.missing.push(k);
    const nv = code !== "sv-neutral" && k in N ? nvars(k) : null;
    for (const x of list(P[k])) {
      if (typeof x === "function") continue;
      if (isMix(x)) { if (!(x.mix > 0 && x.mix < 1)) bad.shape.push(k + " mix"); continue; }
      if (x && typeof x === "object") {
        const codes = (x.not || []).concat(x.only || []);
        if (typeof x.t !== "string" || !codes.length || codes.some((c) => CODES.indexOf(c) < 0)) bad.shape.push(k);
      }
      const t = txt(x);
      if (typeof t !== "string" || !t.trim()) { bad.empty.push(k); continue; }
      if (WRITTEN.indexOf(code) >= 0 && t.length > MAX) bad.long.push(k + " (" + t.length + ")");
      // Dalarna keeps today's lines: their vars are today's vars (the call site passes them); written packs must match neutral
      if (nv && WRITTEN.indexOf(code) >= 0) { for (const v of varsOf(t)) if (!nv.has(v)) bad.vars.push(k + " {" + v + "}"); }
      const m = BANNED.exec(t) || (WRITTEN.indexOf(code) >= 0 ? SWEARS.exec(t) : null);
      if (m && !ALLOW[k + "|" + m[0].toLowerCase()]) {
        if (fromFiles[code] && fromFiles[code][k]) bad.banned.push(k + ": " + m[0]);
        else console.log("NOTE " + code + " " + k + " (module-owned, not a pack line): banned word \"" + m[0] + "\": " + t);
      }
    }
  }
  if (code !== "sv-neutral") ok(!bad.missing.length, code + ": every key exists in sv-neutral", bad.missing.slice(0, 10));
  if (WRITTEN.indexOf(code) >= 0) ok(!bad.vars.length, code + ": region lines use only the neutral line's {vars}", bad.vars.slice(0, 10));
  ok(!bad.empty.length, code + ": no empty lines", bad.empty.slice(0, 10));
  if (WRITTEN.indexOf(code) >= 0) ok(!bad.long.length, code + ": no line over " + MAX + " chars", bad.long.slice(0, 10));
  ok(!bad.banned.length, code + ": no banned word (slurs, drinking pressure" + (WRITTEN.indexOf(code) >= 0 ? ", swearing)" : ")"), bad.banned.slice(0, 10));
  ok(!bad.shape.length, code + ": variant objects are well formed", bad.shape.slice(0, 10));
}

// ---------- the layer picks the region text ----------
const reg = (k, v) => D.t(k, v || {});
const neutralTexts = (k) => list(N[k]).filter((x) => !isMix(x)).map((x) => String(txt(x)));
D.setMode("auto");
for (const [code, k, v] of [["sv-syd", "grp.empty"], ["sv-vast", "grp.empty"], ["sv-sthlm", "grp.empty"], ["sv-norr", "grp.empty"], ["sv-dalarna", "grp.empty"]]) {
  D.preview(code);
  const P = packs[code], all = list(P[k]).filter((x) => !isMix(x)).map(txt);
  const got = new Set(); for (let i = 0; i < 40; i++) got.add(D.t(k, { _seed: i }));
  ok([...got].some((s) => all.indexOf(s) >= 0), "preview " + code + ": t(" + k + ") gives a " + code + " line", [...got].slice(0, 3));
}
D.preview("sv-sthlm");
{ // a {mix} key gives both region and neutral lines over many seeds
  const k = "live.checkin", R = list(packs["sv-sthlm"][k]).filter((x) => !isMix(x)).map(txt), NT = neutralTexts(k);
  const got = []; for (let i = 0; i < 200; i++) got.push(D.t(k, { name: "Kim", bar: "Pitchers", _seed: i }));
  const f = (t) => t.split("{name}").join("Kim").split("{bar}").join("Pitchers");
  const r = got.filter((s) => R.some((t) => f(t) === s)).length;
  const n = got.filter((s) => NT.some((t) => f(t) === s)).length;
  ok(r > 0 && n > 0 && r + n === got.length, "mix: live.checkin in sv-sthlm gives region and neutral lines, nothing else", { region: r, neutral: n });
  ok(got.every((s) => !/\{|\}/.test(s)), "vars are filled", got.find((s) => /\{|\}/.test(s)));
}
D.preview(null); D.setMode("off");
{ const s = D.t("grp.empty"); ok(neutralTexts("grp.empty").indexOf(s) >= 0, "mode off: neutral text", s); }
D.setMode("auto");
{ const s = D.t("live.townQuiet", { town: "Ludvika" }); ok(s && s !== "live.townQuiet" && /Ludvika/.test(s), "neutral fallback with vars (no region)", s); }

// ---------- phase 2 (dialect lane): call sites, v() / list(), exact {mix}, Av = def, aligned Dalarna ----------
{
  const files = fs.readdirSync(JS).filter((f) => f.endsWith(".js") && f !== "dialekt.js");
  let nV = 0, nL = 0, noDef = [], keys = new Set(), defOut = [];
  const V = /DIALEKT\.v\(("(?:[^"\\]|\\.)*"), (\d+), (null|\{[^]*?\}), ("(?:[^"\\]|\\.)*")(, \d+)?\)/g;
  for (const f of files) {
    const s = fs.readFileSync(path.join(JS, f), "utf8");
    const all = (s.match(/DIALEKT\.v\(/g) || []).length; let m, n = 0;
    V.lastIndex = 0; while ((m = V.exec(s))) { n++; const k = JSON.parse(m[1]), d = JSON.parse(m[4]); keys.add(k); if (N[k] !== undefined && !neutralTexts(k).includes(d)) defOut.push([f, k, d.slice(0, 60)]); }
    if (n !== all && !/^(dialekt)/.test(f)) noDef.push([f, all - n]);
    nV += n;
    // the 2nd argument of every DIALEKT.list( … ) is an array literal of defs (skip the 1st argument: a string or a {…} spec)
    let L = 0, Ld = 0, at = 0;
    while ((at = s.indexOf("DIALEKT.list(", at)) >= 0) {
      L++; let i = at + 13, dep = 0, q = null;
      for (; i < s.length; i++) { const c = s[i]; if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; } if (c === '"') { q = c; continue; } if ("[{(".includes(c)) dep++; else if ("]})".includes(c)) dep--; else if (c === "," && dep === 0) break; }
      if (s.slice(i, i + 3) === ", [") Ld++;
      at = i;
    }
    if (L !== Ld) noDef.push([f, "list", L - Ld]);
    nL += L;
  }
  if (nV + nL === 0) console.log("NOTE p2: no call sites yet (dialect patch 31 not applied): phase-2 checks skipped");
  else {
  ok(nV > 1000 && nL > 800, "p2: call sites in docs/js: " + nV + " DIALEKT.v + " + nL + " DIALEKT.list");
  ok(noDef.length === 0, "p2: every DIALEKT.v call has a string def and every DIALEKT.list call an array of defs", noDef);
  ok(defOut.length <= 5, "p2: every def is a line of the sv-neutral catalog for its key (Av = the neutral pack) (" + defOut.length + " outside)", defOut.slice(0, 5));
  const missing = [...keys].filter((k) => N[k] === undefined && !/^(after|mom|x8|lask)\./.test(k));
  ok(missing.length === 0, "p2: every call-site key is in sv-neutral", missing.slice(0, 10));

  // exact {mix}: a key with {mix: p} in a region pack shows the def (next pack) p of the time over many rows/seeds
  D.setMode("auto"); D.preview("sv-sthlm");
  const P = packs["sv-sthlm"];
  const mk = Object.keys(P).filter((k) => Array.isArray(P[k]) && P[k].some((x) => isMix(x)) && !/\{/.test(JSON.stringify(P[k].filter((x) => !isMix(x))))).slice(0, 6);
  for (const k of mk) {
    const p = P[k].find((x) => isMix(x)).mix, R = 4000; let d = 0;
    for (let i = 0; i < R; i++) if (D.v(k, i, null, "§def§") === "§def§") d++;
    ok(Math.abs(d / R - p) < 0.03, "p2: exact mix " + k + " (p " + p + "): the def shows " + (d / R).toFixed(3) + " of the time");
  }
  // no mix = always the region line; Av = always the def; an unknown key = the def
  const nk = Object.keys(P).find((k) => typeof P[k] === "string" && !/\{/.test(P[k]));
  ok(nk && D.v(nk, 0, null, "§def§") === P[nk], "p2: a key without {mix} gives the region line", nk);
  D.setMode("off");
  ok(D.v(nk, 0, null, "§def§") === "§def§" && D.v("no.such.key", 3, { a: 1 }, "x {a} {b}") === "x 1 {b}", "p2: Av gives the def (vars filled, the caller's own {b} kept)");
  D.setMode("auto");
  // a region line that needs a var the call site does not pass is never used
  D.register("sv-sthlm", { "test.p2.var": ["Hej {name} på {bar}"] });
  ok(D.v("test.p2.var", 0, { name: "Kim" }, "Hej {name}") === "Hej Kim" && D.v("test.p2.var", 0, { name: "Kim", bar: "Pitchers" }, "Hej {name}") === "Hej Kim på Pitchers",
    "p2: region lines with vars the call site lacks are skipped (no {var} left)");
  // list(): same length / order / Array type, elements read through v() at read time
  const L = D.list("test.p2.list", ["a", "b", "c"]);
  D.register("sv-sthlm", { "test.p2.list": ["R"] });
  ok(Array.isArray(L) && L.length === 3 && L.join() === "R,R,R" && JSON.stringify(L.slice(1)) === '["R","R"]', "p2: list() keeps the array shape and reads the region line", L.join());
  D.setMode("off");
  ok(L.join() === "a,b,c" && L.indexOf("b") === 1, "p2: list() under Av = the defs, at once (no re-build)", L.join());
  D.setMode("auto");
  const C = D.list({ 1: ["s|", ["test.p2.card", "kort"], "|8"] }, [7, "s|kort|8"]);
  D.register("sv-sthlm", { "test.p2.card": "Sthlm-kort" });
  ok(C[0] === 7 && C[1] === "s|Sthlm-kort|8", "p2: list() card made of parts (Förfest MODES|text|N)", [C[0], C[1]]);
  // aligned: sv-dalarna = today's lines in order -> row i gives today's line i
  D.preview("sv-dalarna");
  const DK = Object.keys(packs["sv-dalarna"]).find((k) => Array.isArray(packs["sv-dalarna"][k]) && packs["sv-dalarna"][k].length > 5 && packs["sv-dalarna"][k].every((x) => typeof x === "string"));
  const DL = packs["sv-dalarna"][DK];
  ok(DL.every((t, i) => D.v(DK, i, null, "§", DL.length) === t), "p2: sv-dalarna rows are read aligned (row i = today's line i): " + DK);
  D.preview(null);
  }
}

// ---------- dialect2 (owner 11 Nov: "more region, less neutral", "in Gothenburg they say Glenn") ----------
// 1. {mix} ≤ 0.25 everywhere (region line ~90 %, care keys ~75 %); 2. region share ≥ 80 % over 200 renders of the ticker keys;
// 3. no line breaks the alcohol-law list (scratchpad legal/alcohol-law.md section 5) in the written packs (Dalarna = NOTE:
//    today's lines, owner / legal lane); 4. every rendered ticker line has no {var} left; 5. Glenn in sv-vast;
// 6. within(area, fn): the ticker scope uses that area's pack, the phone's region stays.
{
  const LAW = ["beställ en till", "en öl till", "en till så", "bara att köra", "ska du inte ta det", "ska du låta det hända", "det här är krig",
    "flest öl", "dricker för fullo", "svept", "svepa", "morsan", "öltorsk", "fyller inte på", "slutat dricka", "svag insats", "tråkmåns", "och du då",
    "sitta hemma nu", "hänger du med", "ölbilen", "snabbare än en raggare", "väntat sig mer av dig", "nästa runda blir öl", "truppen följer efter",
    "kör hårt", "slutat räkna", "inget mer öl", "törsten kommer tillbaka", "drick mer", "dricka mer", "en till!", "ta en till", "häll i", "botten upp",
    "hinka", "kröka", "bala", "supa", "full som", "packad", "dricka ikapp", "ölrace", "töm glaset", "drick snabbare"];
  const LAWRE = new RegExp("(?<![a-zåäö])(" + LAW.map(esc).join("|") + ")(?![a-zåäö])", "i");
  const REG = ["sv-syd", "sv-vast", "sv-sthlm", "sv-norr", "sv-dalarna"];
  for (const code of REG) {
    const P = packs[code] || {}, hi = [], law = [];
    keysOf(P).forEach((k) => list(P[k]).forEach((x) => {
      if (isMix(x) && x.mix > 0.25) hi.push(k + " " + x.mix);
      const t = txt(x); if (typeof t !== "string") return;
      const m = LAWRE.exec(t); if (m && !ALLOW[k + "|" + m[0].toLowerCase()]) law.push(k + ": " + m[0]);
    }));
    ok(!hi.length, "d2 " + code + ": {mix} <= 0.25 (region line >= 75 %, ~90 % for most keys)", hi.slice(0, 5));
    if (code === "sv-dalarna") { if (law.length) console.log("NOTE d2 sv-dalarna: " + law.length + " of today's Dalmål lines hit the alcohol-law list (owner / legal lane): " + law.slice(0, 6).join(" | ")); }
    else ok(!law.length, "d2 " + code + ": no alcohol-law phrase (drink pressure, 'morsan', 'kör hårt' …)", law.slice(0, 8));
    // share: 200 renders over the ticker keys this pack has (all vars of the key passed, as the call sites do)
    D.setMode("auto"); D.preview(code);
    const keys = keysOf(P).filter((k) => /^live\./.test(k) && N[k] !== undefined);
    let hit = 0, tot = 0, left = [];
    for (let i = 0; i < 200; i++) {
      const k = keys[i % keys.length], defs = list(N[k]).filter((x) => !isMix(x)).map((x) => String(txt(x))), row = Math.floor(i / keys.length) % defs.length;
      const vars = {}; nvars(k).forEach((v) => { vars[v] = "X" + v; });
      D._setNow(Date.UTC(2026, 10, 1 + i, 20)); const r0 = D.stats.region;
      const out = D.v(k, row, vars, defs[row], defs.length); tot++; if (D.stats.region > r0) hit++;
      if (/\{[A-Za-z_]\w*\}/.test(out)) left.push(k + ": " + out);
    }
    D._setNow(null); D.preview(null);
    ok(hit / tot >= 0.8, "d2 " + code + ": region share " + Math.round(hit / tot * 100) + " % over " + tot + " ticker renders (>= 80 %)", { hit, tot });
    ok(!left.length, "d2 " + code + ": no {var} left in rendered ticker lines", left.slice(0, 3));
  }
  // Glenn: the Göteborg everyman (owner: "I've seen no Glenn")
  const V = packs["sv-vast"] || {}, glenn = [];
  keysOf(V).forEach((k) => list(V[k]).forEach((x) => { const t = txt(x); if (typeof t === "string" && /\bGlenn\b/.test(t)) glenn.push(k); }));
  ok(glenn.length >= 30 && glenn.some((k) => /^live\.(random|general|town\.goteborg)$/.test(k)), "d2 sv-vast: Glenn lines in the ticker (" + glenn.length + ")", glenn.slice(0, 5));
  ok(V["live.town.goteborg"] && list(V["live.town.goteborg"]).filter((x) => !isMix(x)).length >= 10, "d2 sv-vast: Göteborg town jokes (live.town.goteborg, >= 10)");
  // within(): the ticker scope reads that area's pack; the phone's own region (here: none / neutral) is unchanged
  if (typeof D.within === "function") {
    D.setMode("auto"); D.preview(null);
    const own = D.region(), k = "live.town.goteborg";
    const inV = D.within({ cc: "SE", lang: "sv", a: "sv-vast", b: "sv-vast", code: "1480", name: "Göteborg" }, () => ({ r: D.chain()[0], s: D.v(k, 0, {}, "§def§", 11) }));
    ok(inV.r === "sv-vast" && D.region() === own && D.chain()[0] === own, "d2 within(): chain = the area's region inside, the phone's outside", { inV, own });
    D.setMode("off");
    const offV = D.within(D.tickerArea ? D.tickerArea({ lat: 57.7, lng: 11.97 }) : null, () => D.v(k, 0, {}, "§def§", 11));
    ok(offV === "§def§", "d2 Dialekt Av: the ticker scope gives the plain line", offV);
    D.setMode("auto");
  } else ok(false, "d2 DIALEKT.within (ticker scope) exists");
}

console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
