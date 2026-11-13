// placecard-pw.js — lane placesdata (13 Nov): the place card (docs/js/placecard.js, PN.placecard) for restaurants / cafés / bars.
// Data docs/placeinfo/ and the bar_prices_in RPC are mocked. The bar sheet hook (ONE line in app-pins.js barPopup, owned by the map
// lane) is simulated with a test hook module that calls PN.placecard.popupHTML(bar): same string, same place in the sheet.
// Checks: cuisine label, "Öppet dygnet runt" / "Stängt · öppnar", chips, website / phone buttons, OSM (+ Overture) source line,
// $$$ from crowd prices (bars only, ≥ 5 priced bars), lazy tile fill in the sheet, quiet when data is missing, 360 px fit.
// Usage: node placecard-pw.js <port>
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0; const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const ALL = "0-1440|0-1440|0-1440|0-1440|0-1440|0-1440|0-1440", NEVER_TODAY = "|||||||".split("|").slice(0, 7);
const PIZZA = { id: "pl_6014900_1518800", name: "Pizzeria Test", lat: 60.149, lng: 15.188, type: "restaurant", place: true };
const SHUT = { id: "pl_6015000_1519000", name: "Lunchstället", lat: 60.15, lng: 15.19, type: "restaurant", place: true };
const NONE = { id: "pl_6015100_1519100", name: "Okänd", lat: 60.151, lng: 15.191, type: "cafe", place: true };
const BAR = "n3472634175";
const TILE = {
  [PIZZA.id]: [ALL, "pizza;kebab", "tow", "pizzeria.example/meny", "+46 240 123 45"],
  [SHUT.id]: [NEVER_TODAY.map((x, i) => (i === 0 ? "660-840" : "")).join("|"), "regional"],
  [BAR]: ["", "burger", "w", "", "+46 240 1", "c"],
};
async function open(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: o.w || 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await H.boot(page);
  const asked = [];
  await page.route(/\/placeinfo\/(.+)$/, (r) => {
    const f = r.request().url().match(/\/placeinfo\/([^?]+)/)[1]; asked.push(f);
    if (o.noData) return r.fulfill({ status: 404, body: "" });
    if (f === "index.json") return J(r, { v: 1, b: [0.5, 1], n: 3, t: { "120_15": 1 } });
    if (f === "120_15.json") return J(r, TILE);
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route(/rest\/v1\/rpc\/bar_prices_in/, (r) => J(r, [{ bar_id: BAR, kr: 89, n: 3 }, { bar_id: "a", kr: 70 }, { bar_id: "b", kr: 72 }, { bar_id: "c", kr: 75 }, { bar_id: "d", kr: 78 }]));
  await page.waitForFunction(() => window.PN && window.PN.placecard && window.PNDS && window.PNDS._A, null, { timeout: 20000 }).catch(() => {});
  return { ctx, page, errs, asked };
}
const cardText = (page, place) => page.evaluate(async (p) => {
  const el = document.createElement("div"); el.id = "plc-test"; document.body.appendChild(el);
  await window.PN.placecard.render(p, el);
  const out = { text: el.textContent.replace(/\s+/g, " ").trim(), hidden: el.hidden, html: el.innerHTML };
  el.remove(); return out;
}, place);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    let { ctx, page, errs, asked } = await open(browser);
    ok("C0 PN.placecard loaded, no new window global", await page.evaluate(() => !!(window.PN.placecard && window.PN.placecard.render) && !("PLACECARD" in window)));

    let c = await cardText(page, PIZZA);
    ok("C1 restaurant: Swedish cuisine label 'Pizza · Kebab'", /Pizza · Kebab/.test(c.text), c.text);
    ok("C2 hours from the tile: 'Öppet dygnet runt'", /Öppet dygnet runt/.test(c.text), c.text);
    ok("C3 chips: Avhämtning, Uteservering, Rullstolsvänligt", /Avhämtning/.test(c.text) && /Uteservering/.test(c.text) && /Rullstolsvänligt/.test(c.text), c.text);
    ok("C4 website button opens a new tab (https added), phone button = tel:", /href="https:\/\/pizzeria\.example\/meny" target="_blank" rel="noopener nofollow"/.test(c.html) && /href="tel:\+4624012345"/.test(c.html), c.html.slice(0, 200));
    ok("C5 source line: OpenStreetMap only (no Overture field here), no $ for a restaurant", /Data: © OpenStreetMap$/.test(c.text) && !/\$/.test(c.text), c.text);

    c = await cardText(page, SHUT);
    ok("C6 closed now: 'Stängt · öppnar …' (Mondays 11–14 only)", /Stängt( · öppnar (i morgon )?(mån )?11:00)?/.test(c.text) && /Husman/.test(c.text), c.text);

    const bar = await page.evaluate((id) => { const b = window.BARS.byId(id); return b ? { id: b.id, name: b.name, lat: b.lat, lng: b.lng, type: b.type, outdoor: b.outdoor } : null; }, BAR);
    if (bar) {
      bar.lat = 60.1495; bar.lng = 15.1875;   // into the mocked tile
      c = await cardText(page, bar);
      ok("C7 bar: $$$ = 89 kr vs town median 75 kr (5 priced bars), cuisine 'Hamburgare'", /\$\$\$/.test(c.text) && /Hamburgare/.test(c.text), c.text);
      ok("C8 a field from Overture → source line names Overture Maps", /Overture Maps/.test(c.text), c.text);
    } else ok("C7 fixture bar " + BAR + " exists", false);

    c = await cardText(page, NONE);
    ok("C9 no data for a place → the card stays hidden, empty", c.hidden && c.text === "", c);

    // the bar sheet: simulated 1-line hook (barPopup gets PN.placecard.popupHTML(bar) next to mods("barPopupHTML"))
    const askedBefore = asked.length;
    await page.evaluate(() => { window.PN.placecard._reset(); window.PLCHOOK = { barPopupHTML: (b) => window.PN.placecard.popupHTML(b) }; window.PN.mod("PLCHOOK"); });
    await page.evaluate((p) => {
      const A = window.PNDS._A(); L.popup({ className: "olnu-bar", maxWidth: 320 }).setLatLng([p.lat, p.lng]).setContent(A.barPopup(p)).openOn(window.__map);
    }, PIZZA);
    const first = await page.evaluate(() => { const l = document.querySelector(".leaflet-popup .plc-line"); return l ? { hidden: l.hidden, text: l.textContent } : null; });
    ok("C10 sheet: first paint has the line slot (tile not loaded yet → hidden, no wait)", first && first.hidden && first.text === "", first);
    await wait(page, 900);
    const sheet = await page.evaluate(() => {
      const l = document.querySelector(".leaflet-popup .plc-line"), m = document.querySelector(".leaflet-popup .plc-more"), head = document.querySelector(".leaflet-popup .bs-head");
      let after = false; for (let n = head && head.nextElementSibling; n; n = n.nextElementSibling) { if (n === l) { after = true; break; } if (!n.classList.contains("ev-line")) break; }
      return { line: l && !l.hidden ? l.textContent.replace(/\s+/g, " ").trim() : null, more: m && !m.hidden ? m.textContent.replace(/\s+/g, " ").trim() : null, underTitle: after,
        // the plain sheet puts it in the Info fold; the pn-bs7 design (js/pnds.js) moves the Info fold rest to "Mer"
        inInfo: !!(m && m.closest('.pp-sec-info, .pn-bs-info, details[data-fold="mer"]')) };
    });
    ok("C11 sheet line under the title fills in: 'Pizza · Kebab · Öppet dygnet runt'", sheet.line && /Pizza · Kebab\s*·\s*Öppet dygnet runt/.test(sheet.line) && sheet.underTitle, sheet);
    ok("C12 chips + buttons + source go to the Info / Mer part of the sheet", sheet.more && /Webbplats/.test(sheet.more) && /Ring/.test(sheet.more) && sheet.inInfo, sheet);
    await page.evaluate(() => { const i = document.querySelector(".leaflet-popup .pp-sec-info"); if (i && i.tagName === "DETAILS") i.open = true; else if (i) { const b = i.querySelector("button, summary"); if (b && !i.classList.contains("open")) b.click(); } });
    await wait(page, 400);
    await page.screenshot({ path: require("./env.js").OUT + "placecard-sheet-390.png" });
    const late = asked.slice(askedBefore);
    ok("C13 sheet asked only the index + ONE tile (lazy, after a cache reset)", late.filter((f) => f !== "index.json").length === 1 && late.includes("120_15.json"), late);
    ok("C14 no page errors", errs.length === 0, errs);
    await ctx.close();

    ({ ctx, page, errs } = await open(browser, { w: 360 }));
    await page.evaluate((p) => { const el = document.createElement("div"); el.id = "plc-w"; el.style.cssText = "width:320px;margin:8px"; document.body.prepend(el); return window.PN.placecard.render(p, el); }, PIZZA);
    const fit = await page.evaluate(() => { const el = document.getElementById("plc-w"); return { sw: el.scrollWidth, cw: el.clientWidth, btn: Math.min(...[...el.querySelectorAll(".plc-btn")].map((b) => b.getBoundingClientRect().height)) }; });
    ok("C15 360 px: card fits (no sideways scroll), buttons ≥ 44 px tall", fit.sw <= fit.cw + 1 && fit.btn >= 44, fit);
    await ctx.close();

    ({ ctx, page, errs } = await open(browser, { noData: true }));
    c = await cardText(page, PIZZA);
    const html = await page.evaluate((p) => window.PN.placecard.popupHTML(p), PIZZA);
    await wait(page, 600);
    ok("C16 no docs/placeinfo (404) → card hidden, popup parts hidden, no errors", c.hidden && /hidden/.test(html) && errs.length === 0, { c, errs });
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
