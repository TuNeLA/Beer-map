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

console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
