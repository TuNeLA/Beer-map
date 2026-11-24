// E8 (owner 14 Nov 2026 "start English texts"; OWNER-INPUTS D5 Swedish only until the Nordic plan): the English switch
// behind a test flag (docs/js/lang.js) and the guard that keeps new Swedish texts inside the switch.
//   1. the flag rules: normal users (live config) always get Swedish; the test flag (test build or ?langtest=1) allows English
//   2. the guard: no file gets MORE Swedish texts outside I18N than tests/unit/fixtures/i18n-baseline.json
//      (scripts/i18n/inventory.mjs). A new visible Swedish text needs its English twin: I18N.L("sv", "en"),
//      I18N.add({ sv: {...}, en: {...} }), a module's L(sv, en) helper, or an "en-neutral" DIALEKT pack row.
//      Proper names (places, the brand, people) are not Swedish text: scripts/i18n/svdetect.js PROPER.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { DOCS } from "./load.mjs";
import { inventory, scanSource, BASELINE } from "../../scripts/i18n/inventory.mjs";
const require = createRequire(import.meta.url);
const { svWords } = require("../../scripts/i18n/svdetect.js");

const LIVE = "https://wcdskpcevbhouvbytkhv.supabase.co", STAGING = "https://abcdefghijklmnop.supabase.co";
// run docs/js/lang.js with a stub page: { url: "?x", path: "/", cfg: SUPABASE_URL, store: { "olnu.lang": "en" } }
function lang(o = {}) {
  const store = Object.assign({}, o.store || {}), urls = [];
  const head = { appendChild(n) { w.__style = n; } };
  const w = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { search: o.url || "", pathname: o.path || "/", hash: "", reload() { w.__reloads = (w.__reloads || 0) + 1; } },
    history: { state: null, replaceState(s, t, u) { urls.push(u); } },
    document: { documentElement: { lang: "sv" }, head, createElement: () => ({}) },
    OLNU_CONFIG: { SUPABASE_URL: o.cfg || LIVE }, URLSearchParams,
  };
  w.window = w;
  vm.runInNewContext(fs.readFileSync(path.join(DOCS, "js/lang.js"), "utf8"), vm.createContext(w), { filename: "lang.js" });
  return { I: w.I18N, store, urls, html: w.document.documentElement.lang, w };
}

test("normal users (live config): Swedish, always", () => {
  const a = lang({ store: { "olnu.lang": "en" } });
  assert.equal(a.I.lang, "sv"); assert.equal(a.I.available(), false); assert.equal(a.store["olnu.lang"], "sv", "a stored en is removed");
  assert.equal(a.html, "sv");
  const b = lang({ url: "?lang=en" });
  assert.equal(b.I.lang, "sv", "?lang=en alone does nothing on the live build");
  assert.equal(b.I.set("en"), "sv", "set(en) keeps Swedish without the flag");
  assert.equal(b.I.locale(), "sv-SE");
});

test("the test flag: test build, /test/ path, PN_DEV or ?langtest=1", () => {
  const s = lang({ cfg: STAGING, store: { "olnu.lang": "en" } });
  assert.equal(s.I.available(), true); assert.equal(s.I.lang, "en"); assert.equal(s.html, "en"); assert.equal(s.I.locale(), "en-GB");
  assert.ok(s.w.__style && /html:lang\(en\)/.test(s.w.__style.textContent), "the English CSS content texts are added");
  assert.equal(lang({ path: "/Beer-map/test/" }).I.available(), true);
  const f = lang({ url: "?langtest=1&lang=en&join=ABC" });
  assert.equal(f.I.available(), true); assert.equal(f.I.lang, "en"); assert.equal(f.store["olnu.langtest"], "1");
  assert.deepEqual(f.urls, ["/?join=ABC"], "langtest + lang leave the address, other params stay");
  const off = lang({ url: "?langtest=0", store: { "olnu.langtest": "1", "olnu.lang": "en" } });
  assert.equal(off.I.available(), false); assert.equal(off.I.lang, "sv"); assert.equal(off.store["olnu.langtest"], undefined);
});

test("the switch stores the choice per device and reloads once", () => {
  const s = lang({ cfg: STAGING });
  assert.equal(s.I.lang, "sv");
  s.I.switchTo("en");
  assert.equal(s.store["olnu.lang"], "en"); assert.equal(s.w.__reloads, 1); assert.equal(s.w.document.documentElement.lang, "en");
  s.I.switchTo("en"); assert.equal(s.w.__reloads, 1, "the same language: no reload");
  assert.equal(s.I.L("Hej", "Hi"), "Hi");
  assert.equal(s.I.rank("Löjtnant Lager"), "Lieutenant Lager"); assert.equal(s.I.rank("Oskar"), "Oskar");
  assert.match(s.I.date("2026-11-24T20:00:00Z", { day: "numeric", month: "long" }), /November/);
});

test("the English rank ladder has the same 42 ranks as social.js TITLES, no Swedish left", () => {
  const src = fs.readFileSync(path.join(DOCS, "js/social.js"), "utf8");
  const ranks = [...src.slice(src.indexOf("var TITLES = ["), src.indexOf("function titleFor")).matchAll(/\[\d+, "([^"]+)"\]/g)].map((m) => m[1]);
  assert.equal(ranks.length, 42);
  const s = lang({ cfg: STAGING, store: { "olnu.lang": "en" } });
  const en = ranks.map((r) => s.I.rank(r));
  assert.equal(new Set(en).size, 42, "42 different English names");
  for (let i = 0; i < 42; i++) assert.deepEqual(svWords(en[i]), [], ranks[i] + " -> " + en[i]);
});

test("the guard tells a text with an English twin from one without", () => {
  const r = scanSource(`
    var a = "Visa kartan";                       // bypass
    var b = I18N.L("Visa kartan", "Show the map"); // covered: a pair
    var c = sv() ? "Stäng" : "Close";            // covered: a language branch
    I18N.add({ sv: { k: "Inga vänner ute" }, en: { k: "No friends out" } });   // covered: a dictionary
    console.log("ingen svensk text för folk");  // not a text for people
    if (x === "ute") y();                        // a key compare, not a text
  `);
  const by = r.filter((x) => !x.covered && !x.skip).map((x) => x.text);
  assert.deepEqual(by, ["Visa kartan"]);
});

test("no file has more Swedish texts outside the language switch than the baseline", () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).bypass, now = inventory();
  const grown = [];
  for (const [f, v] of Object.entries(now.per)) {
    const b = base[f] || 0;
    if (v.bypass > b) grown.push(f + ": " + b + " -> " + v.bypass + "\n      new: " + v.items.slice(-Math.min(5, v.bypass - b)).map((x) => x.line + " " + JSON.stringify(x.text.slice(0, 70))).join("\n           "));
  }
  assert.deepEqual(grown, [], "Swedish text without an English twin (use I18N.L(sv, en) or I18N.add({sv, en}); run node scripts/i18n/inventory.mjs --file <file>):\n  " + grown.join("\n  "));
});
