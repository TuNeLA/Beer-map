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
