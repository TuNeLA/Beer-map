// P-13 (polish sweep 24 Nov 2026): one screen never mixes dialect and standard forms ("Robban är på 5" next to
// "Oskar ä på 10"). The chosen pack decides: Dalarna / Norrland / Väst say "ä", Syd says "e", every other pack, Dialekt Av
// and no region say "är" and no Dalarna words (mä, dä, hä, int'). Runs the REAL docs/js/dialekt.js + every pack file + the
// ticker templates (news-gt.js, news-more.js, i18n.js "news") + news.js (formFix) in one vm sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { DOCS } from "./load.mjs";

const JS = path.join(DOCS, "js"), PK = path.join(JS, "dialekt-packs");
const noop = () => {};
const el = () => ({ appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
function sandbox() {
  const store = {};
  const sb = {
    console, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, Promise, JSON, Math, Date, Proxy, Reflect,
    performance: { now: () => 0 }, fetch: () => Promise.reject(new Error("no network in test")), requestAnimationFrame: () => 0,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { readyState: "loading", addEventListener: noop, createElement: el, getElementById: () => null, head: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], documentElement: Object.assign(el(), { lang: "sv" }) },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, CustomEvent: function () {}, navigator: { language: "sv-SE", userAgent: "node" },
    location: { pathname: "/", search: "", href: "http://x/", hostname: "x" }, history: { replaceState: noop },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}
const run = (sb, f) => vm.runInContext(fs.readFileSync(f, "utf8").replace(/\/\/ <split:imports>[\s\S]*?\/\/ <\/split:imports>/g, ""), sb, { filename: f });

const sb = sandbox();
run(sb, path.join(JS, "util.js"));
run(sb, path.join(JS, "lang.js"));
run(sb, path.join(JS, "dialekt.js"));
const D = sb.DIALEKT;
const files = fs.readdirSync(PK).filter((f) => f.endsWith(".js")).sort((a, b) => (b.startsWith("sv-neutral") ? 1 : 0) - (a.startsWith("sv-neutral") ? 1 : 0));
files.forEach((f) => run(sb, path.join(PK, f)));
let i18nOk = true; try { run(sb, path.join(JS, "i18n.js")); } catch (e) { i18nOk = false; }
run(sb, path.join(JS, "news-gt.js"));
run(sb, path.join(JS, "news-more.js"));
run(sb, path.join(JS, "news.js"));
const NEWS = sb.NEWS;

// the ticker templates and a sample d for each (every d.x the template reads; numbers for counts, words for the rest)
const TPL = [].concat(sb.NEWS_GT || [], (sb.NEWS_MORE && sb.NEWS_MORE.sv) || [], (i18nOk && sb.I18N && sb.I18N.t && Array.isArray(sb.I18N.t("news")) ? sb.I18N.t("news") : []));
const NUM = /^(n|k|rek|min|max|tot|total|nn|cnt|m|h|t|km|d|antal|p|nr|i|x|y|z|q|v|w|s|r|a|b|c)$/;
function sample(f) {
  const d = {}, src = String(f); let m; const re = /\bd\.([A-Za-z_]\w*)/g;
  while ((m = re.exec(src))) { const k = m[1]; if (d[k] !== undefined) continue; d[k] = NUM.test(k) ? 5 : k === "b" ? "krogar" : k === "group" || k === "grupp" ? "Gänget" : k === "name" || k === "namn" || k === "who" ? "Robban" : k === "bar" ? "Pitchers" : "Ludvika"; }
  return d;
}
const L_ = "A-Za-zÅÄÖåäöÉéÜü'’”\"“»«";
const has = (tx, w) => new RegExp("(^|[^" + L_ + "])" + w + "(?=$|[^" + L_ + "-])").test(tx);
function render(code, off) {
  D.setMode(off ? "off" : "auto"); D.preview(code || null);
  const out = [];
  for (let night = 0; night < 3; night++) {
    D._setNow(Date.UTC(2026, 10, 2 + night, 20));
    TPL.forEach((x) => { let tx = ""; try { const d = sample(x.f); tx = String(x.f(d)); if (NEWS._formFix) tx = NEWS._formFix(tx, d); } catch (e) { tx = ""; } if (tx) out.push(tx); });
  }
  D._setNow(null); D.preview(null); D.setMode("auto");
  return out;
}
const STD_BAD = ["ä", "Ä", "mä", "Mä", "dä", "Dä", "hä", "Hä", "int'", "Int'"];

test("P-13 setup: the ticker templates load (news-gt, news-more" + (i18nOk ? ", i18n news" : "") + ")", () => {
  assert.ok(TPL.length > 300, "templates " + TPL.length);
  assert.equal(typeof NEWS._formFix, "function");
  assert.equal(typeof D.form, "function");
});

for (const [code, off] of [[null, false], ["sv-sthlm", false], [null, true]]) {
  test("P-13: standard Swedish (" + (off ? "Dialekt Av" : code || "no region") + "): no ticker line has a Dalarna word", () => {
    const bad = render(code, off).filter((tx) => STD_BAD.some((w) => has(tx, w)));
    assert.deepEqual(bad.slice(0, 5), [], bad.length + " lines");
  });
}
for (const code of ["sv-dalarna", "sv-norr", "sv-vast"]) {
  test("P-13: " + code + " ticker never says \"är\" next to \"ä\" (the pack's form wins)", () => {
    const all = render(code, false), ar = all.filter((tx) => has(tx, "är") || has(tx, "Är")), a = all.filter((tx) => has(tx, "ä"));
    assert.ok(a.length > 20, "the pack form shows (" + a.length + ")");
    assert.deepEqual(ar.slice(0, 5), [], ar.length + " lines with är");
  });
}
test("P-13: sv-syd ticker says \"e\", never \"är\" or \"ä\"", () => {
  const all = render("sv-syd", false), bad = all.filter((tx) => has(tx, "är") || has(tx, "ä"));
  assert.deepEqual(bad.slice(0, 5), [], bad.length + " lines");
});
test("P-13: names and group names are never changed; words in quotes stay", () => {
  D.preview(null);
  assert.equal(D.v("test.form.name", 0, { name: "Vi ä bäst" }, "{name} ä här"), "Vi ä bäst är här");
  D.preview("sv-dalarna");
  assert.equal(D.v("test.form.name", 0, { name: "Vi är bäst" }, "{name} är här"), "Vi är bäst ä här");
  const d = { group: "Hä ä vi", n: 3 };
  assert.equal(NEWS._formFix("Gruppen " + d.group + " är på " + d.n + ".", d), "Gruppen Hä ä vi ä på 3.");
  D.preview(null);
  assert.equal(NEWS._formFix("Gruppen " + d.group + " ä på 3.", d), "Gruppen Hä ä vi är på 3.");
  assert.equal(D.form("I Ludvika säger man ”int'” och ”ä”. Dä ä int' mä hä."), "I Ludvika säger man ”int'” och ”ä”. Det är inte med här.");
  assert.equal(D.form("e-post, 13:e, e.d."), "e-post, 13:e, e.d.");
});
test("P-13: English texts are never changed", () => {
  const was = sb.I18N; sb.I18N = { lang: "en" };
  try { assert.equal(D.form("Robban ä here"), "Robban ä here"); } finally { sb.I18N = was; }
});
