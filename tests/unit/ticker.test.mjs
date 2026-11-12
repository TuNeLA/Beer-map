// Ticker line choice (js/news.js): which headlines may show at this hour, and the night key.
import test from "node:test";
import assert from "node:assert/strict";
import { loadScript } from "./load.mjs";

const U = loadScript("js/util.js").U;
const NEWS = loadScript("js/news.js", { U, I18N: { t: (k) => k } }).NEWS;

test("ticker: a night line ('förfest', 'i natt') is hidden from 05:00 to 14:59", () => {
  for (const h of [5, 9, 14]) for (const t of ["Förfest på Pitchers", "Nattmat efterfrågas i natt", "Sista beställning närmar sig"]) assert.equal(NEWS._timeOk(t, h), false, h + " " + t);
});
test("ticker: a night line shows in the evening and at night", () => {
  for (const h of [15, 20, 23, 0, 2, 4]) assert.equal(NEWS._timeOk("Förfest på Pitchers", h), true, String(h));
});
test("ticker: an evening line ('ikväll') is hidden from 05:00 to 11:59, shows from 12:00", () => {
  for (const h of [5, 8, 11]) assert.equal(NEWS._timeOk("Ikväll blir det lugnt", h), false, String(h));
  for (const h of [12, 15, 21, 3]) assert.equal(NEWS._timeOk("Ikväll blir det lugnt", h), true, String(h));
});
test("ticker: a plain line shows at every hour", () => {
  for (let h = 0; h < 24; h++) assert.equal(NEWS._timeOk("Pitchers har det trevligt", h), true);
});
test("ticker: 'inatt' as part of another word does not hide the line", () => {
  assert.equal(NEWS._timeOk("Innattuttna ölglas", 9), true);
});
test("ticker: nightKey = the date of the 05:00 Stockholm cut that ends the night", () => {
  assert.equal(NEWS.nightKey(new Date("2026-11-10T20:00:00Z")), "2026-11-11");   // 21:00 CET Tue -> night ends Wed 05:00
  assert.equal(NEWS.nightKey(new Date("2026-11-11T01:00:00Z")), "2026-11-11");   // 02:00 CET Wed
  assert.equal(NEWS.nightKey(new Date("2026-11-11T05:00:00Z")), "2026-11-12");   // 06:00 CET Wed: the next night starts after the 05:00 cut
});
test("ticker: prevNightKey is one night earlier", () => {
  assert.equal(NEWS.prevNightKey(new Date("2026-11-10T20:00:00Z")), "2026-11-10");
});
