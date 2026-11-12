// lane a3search (I-07): the shared address search (docs/js/placesearch.js) in Hemzon. Geocoder answers are mocked.
// "Storgatan 5" exists in Kiruna (far north) and in Ludvika. Old code (limit=1, no viewbox) picked the first Swedish hit
// = Kiruna; new code asks near the map centre first, shows a list, and moves the map only after a pick / Enter.
// Usage: node placesearch-pw.js <port>
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0; const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const KIRUNA = { name: "", display_name: "Storgatan 5, Kiruna", lat: "67.8558", lon: "20.2253", address: { road: "Storgatan", house_number: "5", town: "Kiruna" } };
const LUDVIKA = { name: "", display_name: "Storgatan 5, Ludvika", lat: "60.1490", lon: "15.1880", address: { road: "Storgatan", house_number: "5", town: "Ludvika" } };
const LUDV2 = { name: "", display_name: "Storgatan 5, Grängesberg", lat: "60.0920", lon: "14.9960", address: { road: "Storgatan", house_number: "5", village: "Grängesberg" } };
const MBF = (t, la, lo) => ({ properties: { feature_type: "address", name: t, address: t, context: { place: { name: "Ludvika" } } }, geometry: { coordinates: [lo, la] } });
async function open(browser, mb) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
  const reqs = []; await page.route(/nominatim\.openstreetmap\.org\/search/, (r) => {
    const u = r.request().url(); reqs.push(u);
    // the real service ranks by importance: without a viewbox the far hit is first
    if (/bounded=1/.test(u)) return J(r, [LUDVIKA, LUDV2]);
    return J(r, /viewbox/.test(u) ? [LUDVIKA, KIRUNA] : [KIRUNA, LUDVIKA]);
  });
  await page.route(/api\.mapbox\.com\/search\/geocode/, (r) => { reqs.push(r.request().url()); J(r, { features: [MBF("Storgatan 5", 60.149, 15.188), MBF("Storgatan 50", 60.1495, 15.1885)] }); });
  await H.boot(page); await page.evaluate(() => window.PN.placeSearch && window.PN.placeSearch._clear());
  if (mb) await page.evaluate(() => { window.PN_CFG = { placeSearch: "mapbox" }; localStorage.setItem("olnu.mbToken", "pk.testtesttesttesttesttest.testtesttesttest"); });
  await page.evaluate(() => window.HOMEZONE.open()); await wait(page, 1200);
  return { ctx, page, reqs };
}
const homeLat = (p) => p.evaluate(() => { const h = JSON.parse(localStorage.getItem("olnu.home") || "null"); return h && h.lat; });
const hits = (p) => p.evaluate(() => [...document.querySelectorAll("#sheet-body .ps-hit")].map((b) => b.textContent.trim()));
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    let { ctx, page, reqs } = await open(browser);
    ok("P0 helper loaded", await page.evaluate(() => !!window.PN.placeSearch));
    await page.fill("#sheet-body .hz-q", "Storgatan 5"); await wait(page, 800);
    ok("P1 Nominatim: typing alone sends NO request (usage policy)", reqs.length === 0, reqs);
    await page.click("#sheet-body .hz-qb"); await wait(page, 1500);
    let l = await hits(page);
    ok("P2 street only: a list of results appears under the field, nearby town first", l.length >= 2 && /Storgatan 5/.test(l[0]) && /Ludvika/.test(l[0]), l);
    ok("P3 request is Sweden only, Swedish, with a viewbox near the map centre", reqs.some((u) => /countrycodes=se/.test(u) && /accept-language=sv/.test(u) && /viewbox=/.test(u)), reqs[0]);
    ok("P4 no jump before a pick (nothing saved, map not moved)", (await homeLat(page)) === null);
    await page.screenshot({ path: require("./env.js").OUT + "placesearch-list.png" });
    await page.focus("#sheet-body .hz-q"); await page.keyboard.press("Enter"); await wait(page, 800);   // list shown for this text → first result
    ok("P5 Enter = the first result (hint says spot picked)", /Punkt vald/.test(await page.evaluate(() => document.querySelector("#sheet-body .hz-hint").textContent)));
    await page.evaluate(() => [...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemzonen/.test(b.textContent)).click()); await wait(page, 500);
    const la = await homeLat(page);
    ok("P6 saved spot = Ludvika (not Kiruna)", la && Math.abs(la - 60.149) < 0.01, la);
    await ctx.close();

    ({ ctx, page, reqs } = await open(browser));   // pick by tap on the second entry
    await page.fill("#sheet-body .hz-q", "Storgatan 5"); await page.keyboard.press("Enter"); await wait(page, 1500);
    ok("P7 Enter on a fresh text searches and shows the list (no jump)", (await hits(page)).length >= 2 && (await homeLat(page)) === null);
    await page.click("#sheet-body .ps-hit >> nth=1"); await wait(page, 600);
    await page.evaluate(() => [...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemzonen/.test(b.textContent)).click()); await wait(page, 500);
    const lb = await homeLat(page);
    ok("P8 tap on result 2 → the map moves there (Grängesberg)", lb && Math.abs(lb - 60.092) < 0.01, lb);
    await ctx.close();

    ({ ctx, page, reqs } = await open(browser, true));
    await page.fill("#sheet-body .hz-q", "Storgatan 5"); await wait(page, 1200);
    l = await hits(page);
    ok("P9 flag placeSearch=mapbox: live suggestions after the debounce, no Sök needed", l.length === 2 && reqs.length === 1 && /autocomplete=true/.test(reqs[0]) && /country=se/.test(reqs[0]) && /proximity=/.test(reqs[0]), { l, reqs });
    await page.keyboard.press("Enter"); await wait(page, 600);
    ok("P10 mapbox: Enter = first suggestion", /Punkt vald/.test(await page.evaluate(() => document.querySelector("#sheet-body .hz-hint").textContent)));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
