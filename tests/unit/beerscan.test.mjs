// I-140 beer scanner (lane beerscan): docs/js/beerscan-match.js on the REAL library (docs/data/beer/beers.json, 1 489 beers).
// Barcode -> beer (ids are EAN codes, aliases, UPC-A form), OCR text -> rank + decide (open / Menade du / none), noise finds
// nothing, the search word. Old code: the file does not exist -> every test fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const DOCS = new URL("../../docs/", import.meta.url);
const win = {};
vm.runInNewContext(fs.readFileSync(new URL("js/beerscan-match.js", DOCS), "utf8"), { window: win });
const M = win.BEERSCAN_MATCH;
// the same shape as js/beerlib.js load(): beers + byId (+ aliases into byId)
const raw = JSON.parse(fs.readFileSync(new URL("data/beer/beers.json", DOCS), "utf8"));
const data = { beers: [], byId: {} };
for (const row of raw.rows) { const o = {}; raw.cols.forEach((c, i) => (o[c] = row[i])); if (!o.id || !o.name) continue; o.id = String(o.id); data.beers.push(o); data.byId[o.id] = o; }
for (const a of Object.keys(raw.alias || {})) { const k = data.byId[String(raw.alias[a])]; if (k && !data.byId[a]) data.byId[a] = k; }
const run = (t) => { const l = M.rank(t, data, 5); return { l, d: M.decide(l, t, data), names: l.map((x) => x.b.name) }; };

test("barcode: an EAN-13 id finds its beer", () => {
  assert.equal(M.ean("5740700992636", data).name, "Kronenbourg 1664");
  assert.equal(M.ean(" 5740700992636\n", data).name, "Kronenbourg 1664");
});
test("barcode: an alias (a duplicate beer's code) finds the kept beer", () => {
  assert.equal(M.ean("57013831", data).id, "5740700992636");
});
test("barcode: UPC-A (12 digits) finds the EAN-13 with a leading 0, and back", () => {
  assert.equal(M.ean("038766651334", data).name, "Asahi Kuronama");
  data.byId["012345678905"] = { id: "012345678905", name: "T" };
  assert.equal(M.ean("0012345678905", data).name, "T");
  delete data.byId["012345678905"];
});
test("barcode: unknown or empty codes find nothing", () => {
  assert.equal(M.ean("4006381333931", data), null);
  assert.equal(M.ean("", data), null);
  assert.equal(M.ean("abc", data), null);
  assert.equal(M.ean("123", null), null);
});

test("text: clear label text opens the beer (Kronenbourg 1664, Pripps Blå, no accents)", () => {
  for (const [t, want] of [["KRONENBOURG 1664", "Kronenbourg 1664"], ["Pripps Blå", "Pripps BLa"], ["PRIPPS BLA", "Pripps BLa"]]) {
    const r = run(t);
    assert.equal(r.d.kind, "open", t + " -> " + JSON.stringify(r.names));
    assert.equal(r.d.beer.name, want, t);
  }
});
test("text: an OCR error (0 for o) still puts the right beer first; two close variants = 'Menade du', not a wrong open", () => {
  const r = run("Kronenb0urg 1664 lager");
  assert.equal(r.names[0], "Kronenbourg 1664 Lager");
  assert.ok(r.d.kind === "pick" || (r.d.kind === "open" && r.d.beer.name === "Kronenbourg 1664 Lager"), JSON.stringify(r.d.kind));
});
test("text: a brand alone gives 'Menade du' with at most 3, all of that brand", () => {
  const r = run("eld Ww 3,5% | Heineken");
  assert.equal(r.d.kind, "pick");
  assert.ok(r.d.list.length >= 2 && r.d.list.length <= 3, JSON.stringify(r.names));
  assert.ok(r.d.list.every((x) => /heineken/i.test(x.b.name + " " + x.b.brewery)), JSON.stringify(r.names));
});
test("text: a cut name in the data ('Heinek') does not beat the exact brand", () => {
  assert.match(run("Heineken").names[0], /^Heineken/);
});
test("text: words run together ('NORRLANDSGULD') still find Norrlands Guld first", () => {
  const r = run("NORRLANDSGULD");
  assert.notEqual(r.d.kind, "none");
  assert.equal(r.names[0], "Norrlands Guld");
});
test("text: OCR noise never opens a beer (the 'ol' -> 'Øl' / 'Sol' bug from the OCR test)", () => {
  for (const t of ["- (an le nN ol —l TA ; Ola | J 72 18 | ; |»", "Ll | Le £5: & he 5 To % / CN A as 4) 2 |. ¢Al OL oa — a", "q [al CANT 7 i a CE ov (Pe Eo Zag oN | : gry", "", "   ", "!!!"]) {
    const r = run(t);
    assert.notEqual(r.d.kind, "open", JSON.stringify(t) + " -> " + JSON.stringify(r.names));
    assert.ok(!r.names.includes("Øl") && !r.names.includes("Sol"), JSON.stringify(r.names));
  }
});
test("text: no match -> 'none' with the best word for the normal search", () => {
  const r = run("zzqx wobble Mariestadz xqv");
  assert.ok(r.d.kind !== "open");
  assert.match(M.queryFrom("zzqx wobble Mariestadz xqv", data), /^mariestads?$/);   // "mariestad" finds both forms in the search
  const n = M.decide([], "Sofiaro qqq", data);
  assert.equal(n.kind, "none");
  assert.equal(typeof n.q, "string");
});
test("text: the same name twice (two breweries) is shown once", () => {
  const r = run("Kronenbourg 1664 Lager");
  const n = r.names.filter((x) => M.norm(x) === "kronenbourg 1664 lager").length;
  assert.equal(n, 1, JSON.stringify(r.names));
});
test("text: 120 words of OCR are ranked fast enough for a phone (< 400 ms here)", () => {
  const t = Array.from({ length: 120 }, (_, i) => ["lager", "premium", "brewed", "since", "1842", "alc", "vol", "beer", "export", "guld"][i % 10] + (i % 7)).join(" ");
  M.rank("warm", data);   // the index is built once per library
  const t0 = Date.now(); M.rank(t, data, 3); const ms = Date.now() - t0;
  assert.ok(ms < 400, ms + " ms");
});
test("sim: short words and numbers must be exact; close long words count", () => {
  assert.equal(M.sim("1664", "1665"), 0);
  assert.equal(M.sim("ol", "ok"), 0);
  assert.ok(M.sim("kronenbourg", "kronenbovrg") >= 0.75);
  assert.equal(M.sim("guld", "norrlandsguld", false), 0.9);
  assert.equal(M.sim("heinek", "heineken", true), 0.6);
});
