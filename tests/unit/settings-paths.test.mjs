// relrisk (13 Nov): every "Inställningar → <place>" that the app copy tells the user must name a real row of the
// Inställningar hub (d1settings PAGES). Before: intro, beta toast, logging note and integritet.html said
// "Inställningar → Integritet", but the hub had no Integritet row (the logging switch sat under "Synlighet & trygghet").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const R = new URL("../../docs/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, R), "utf8");
const settings = read("js/app-settings.js");
const pages = settings.slice(settings.indexOf("var PAGES = ["), settings.indexOf("];", settings.indexOf("var PAGES = [")));
const titles = [...pages.matchAll(/\[\s*"[a-z]+",\s*"[a-z]+",\s*"([^"]+)"/g)].map((m) => m[1]);
// The app's own privacy path. "Integritet och säkerhet" is the iPhone system setting, not ours.
const FILES = ["js/i18n.js", "js/kanal.js", "js/pnlog.js", "integritet.html"];

test("the hub has its 8 pages", () => { assert.equal(titles.length, 8, titles.join(", ")); });
for (const f of FILES) {
  test(f + ": 'Inställningar → Integritet' names a hub row", () => {
    const hits = [...read(f).matchAll(/Inställningar → (Integritet)(?! och)/g)];
    for (const h of hits) assert.ok(titles.some((t) => t.startsWith(h[1])), f + " says 'Inställningar → " + h[1] + "' but the hub rows are: " + titles.join(" | "));
  });
}

// polishA (13 Nov, blind test + AUDIT-NAV): EVERY app path "Inställningar → <X>" (copy, not comments) names a real hub page
// exactly (Konto, Integritet & synlighet, Notiser & ljud, …). Before: "Inställningar → 🗑️ Radera mitt konto" (v14 privacy text),
// "→ Integritet", "→ Blockerade", "Om PintsNow". Phone system paths (iPhone: Inställningar → Notiser …, Safari) are not ours.
// polishB: dm.js + safety.js now say "Inställningar → Integritet & synlighet → Blockerade" and are checked too (SKIP empty).
const SKIP = new Set([]);
const SYS = /^(Notiser|Notifications|Safari|Integritet och säkerhet|Privacy & Security|Location)\b/;
const strip = (f, s) => f.endsWith(".html") ? s.replace(/<!--[\s\S]*?-->/g, "") : s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'\w])\/\/.*$/gm, "$1");
const list = (d) => fs.readdirSync(new URL(d, R)).filter((f) => /\.(js|html)$/.test(f)).map((f) => d + f);
const ALL = [...list("js/"), ...list("")].filter((f) => !SKIP.has(f));
test("every 'Inställningar → X' in the app copy names a hub page (polishA)", () => {
  const bad = [];
  for (const f of ALL) {
    const s = strip(f, read(f)).replace(/&amp;/g, "&");
    for (const m of s.matchAll(/(?<!Website |Webbplats)(Inställningar|Settings)(?: \(Settings\))? → ([^→.,()<\n]+)/g)) {
      const before = s.slice(Math.max(0, m.index - 12), m.index);
      const x = m[2].replace(/\\"|"|\p{Extended_Pictographic}|️/gu, "").trim();
      if (/iPhone|Android/.test(before) || SYS.test(x)) continue;
      if (!titles.includes(x)) bad.push(f + ": '" + m[0].slice(0, 60) + "'");
    }
  }
  assert.deepEqual(bad, [], "paths that name no hub page (" + titles.join(" | ") + ")");
});
test("the privacy text and radera.html give the new delete path Inställningar → Konto → Radera mitt konto", () => {
  assert.match(read("js/v14.js"), /privDel: "Inställningar → Konto → Radera mitt konto/);
  assert.match(read("integritet.html"), /Inställningar → Konto → Radera mitt konto/);
  const rd = read("radera.html"); assert.match(rd, /<b>Konto<\/b> och sedan <b>Radera mitt konto<\/b>/); assert.doesNotMatch(rd, /Om PintsNow/);
});
