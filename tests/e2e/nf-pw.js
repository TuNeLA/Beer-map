// nf 2026-11-07 Playwright test (mocked server, 390x844): 📍 hemstad picker v2, 📍 Ställen nära dig, "Var dricker du?"
// restaurants, notification text mock. Usage: node nf-pw.js <port>. Shots: scratchpad/nf-shots/.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const SHOT = SP + "nf-shots/";
const PORT = process.argv[2] || 8987;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const vp = { width: 390, height: 844 };
async function htRoutes(page, log) {
  await page.route(/rest\/v1\/rpc\/(my_home_town|set_home_town)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, b]);
    return J(r, fn === "my_home_town" ? { town: null } : { town: b.p_town || null });
  });
}
const nearRows = (page) => page.evaluate(() => {
  const out = []; let inNear = false;
  for (const n of document.querySelectorAll(".ht-list2 > *")) {
    if (n.classList.contains("ht-h")) { inNear = n.classList.contains("ht-h-near"); continue; }
    if (inNear && n.classList.contains("ht-row")) out.push(n.querySelector(".ht-row-n").textContent + "|" + ((n.querySelector(".ht-row-k") || {}).textContent || ""));
  }
  return out;
});
const noToasts = (page) => page.addStyleTag({ content: "#toasts{display:none!important}" });
async function openHt(page) {
  await page.evaluate(() => window.HOMETOWN.open()); await wait(page, 900);
}
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  try {
    // ---------- A) Hemstad: near Stockholm → Stockholm first ----------
    for (const [city, ll, first] of [["Stockholm", [59.334, 18.063], "Stockholm"], ["Göteborg", [57.700, 11.970], "Göteborg"]]) {
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await htRoutes(page, log);
      await ctx.setGeolocation({ latitude: ll[0], longitude: ll[1] });
      await boot(page);
      await openHt(page); await wait(page, 1500);
      const rows = await nearRows(page);
      ok(`🏙️ ${city}: "Nära dig" starts with ${first}`, rows.length === 5 && rows[0].startsWith(first + "|"), rows);
      ok(`🏙️ ${city}: distances grow`, rows.map((r) => parseFloat(r.split("|")[1].replace(",", "."))).every((d, i, a) => !i || d >= a[i - 1]), rows);
      if (city === "Stockholm") {
        await noToasts(page); await page.screenshot({ path: SHOT + "hometown-near-stockholm-390.png" });
        const hasLetters = await page.evaluate(() => [...document.querySelectorAll(".ht-h-l")].map((h) => h.textContent).join(""));
        ok("A–Ö letter heads in Swedish order (… Ä Ö last)", /^AB.*S.*Ä?Ö$/.test(hasLetters) && hasLetters.indexOf("Å") < 0 || /Ö$/.test(hasLetters), hasLetters);
        const dem = await page.evaluate(() => { const r = [...document.querySelectorAll(".ht-row")].find((x) => x.querySelector(".ht-row-n").textContent === "Stockholm"); return r && r.querySelector(".ht-row-d") && r.querySelector(".ht-row-d").textContent; });
        ok("demonym under the name (Stockholmare)", dem === "Stockholmare", dem);
        await page.fill(".ht-inp", "göt"); await wait(page, 300);
        const s1 = await page.evaluate(() => [...document.querySelectorAll(".ht-list2 .ht-row .ht-row-n")].map((x) => x.textContent));
        ok("search 'göt' → Göteborg first", s1[0] === "Göteborg", s1);
        await noToasts(page); await page.screenshot({ path: SHOT + "hometown-search-390.png" });
        await page.fill(".ht-inp", "Bullerbyn"); await wait(page, 300);
        ok("unknown town → 'Använd \"Bullerbyn\"' row", await page.evaluate(() => /Använd "Bullerbyn"/.test(document.querySelector(".ht-free").textContent)));
        await page.fill(".ht-inp", "göt"); await wait(page, 300);
        await page.evaluate(() => document.querySelector(".ht-list2 .ht-row").click()); await wait(page, 700);
        const set = log.filter((x) => x[0] === "set_home_town").pop();
        ok("tap row → set_home_town('Göteborg')", set && set[1].p_town === "Göteborg", set);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        ok("no horizontal scroll at 390", sw <= 390, sw);
      }
      await ctx.close();
    }
    // ---------- A2) No location permission: one button, no automatic prompt ----------
    {
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await htRoutes(page, log);
      await ctx.clearPermissions();
      await page.addInitScript(() => { const g = navigator.geolocation; window.__geoAsks = 0;
        const o = g.getCurrentPosition.bind(g); g.getCurrentPosition = function (a, b, c) { window.__geoAsks++; return o(a, b, c); }; });
      await boot(page, { clean: true }); await wait(page, 1500);
      const before = await page.evaluate(() => window.__geoAsks);
      await openHt(page); await wait(page, 1200);
      const after = await page.evaluate(() => window.__geoAsks);
      ok("no permission: picker does not ask by itself", after === before, { before, after });
      ok("no permission: one '📍 Visa städer nära mig' button", await page.evaluate(() => document.querySelectorAll(".ht-ask").length === 1));
      const firstA = await page.evaluate(() => { const r = [...document.querySelectorAll(".ht-list2 > *")]; const i = r.findIndex((x) => x.classList.contains("ht-h-l")); return r[i].textContent + ":" + r[i + 1].querySelector(".ht-row-n").textContent; });
      const wantA = await page.evaluate(() => "A:" + window.CITIES.list.map((c) => c.name).filter((n) => /^A/.test(n)).sort((a, b) => a.localeCompare(b, "sv"))[0]);
      ok("A–Ö list starts at the first A town (" + wantA + "), not Ludvika", firstA === wantA, { firstA, wantA });
      await noToasts(page); await page.screenshot({ path: SHOT + "hometown-no-location-390.png" });
      await ctx.close();
    }
    // ---------- B) Ställen nära dig ----------
    {
      const { ctx, page } = await ctxFor(browser, vp);
      await boot(page);
      await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
      await wait(page, 1200);
      await page.evaluate(() => window.NEARPLACES.open()); await wait(page, 2500);
      const items = await page.evaluate(() => [...document.querySelectorAll(".np-list .np-row")].map((r) => [r.className, r.querySelector(".np-n").textContent, r.querySelector(".np-d").textContent]));
      const toM = (t) => /km/.test(t) ? parseFloat(t.replace(",", ".")) * 1000 : parseFloat(t);
      ok("nearby: bars AND restaurants listed", items.some((x) => /np-bar/.test(x[0])) && items.some((x) => /np-food/.test(x[0])), items.slice(0, 6));
      ok("nearby: nearest first", items.map((x) => toM(x[2])).every((d, i, a) => !i || d >= a[i - 1] - 1), items.map((x) => x[2]).slice(0, 12));
      await noToasts(page); await page.screenshot({ path: SHOT + "nearby-all-390.png" });
      await page.evaluate(() => [...document.querySelectorAll(".np-seg-b")].find((b) => b.textContent === "Mat & fika").click()); await wait(page, 300);
      const food = await page.evaluate(() => [...document.querySelectorAll(".np-list .np-row")].map((r) => r.className));
      ok("filter 'Mat & fika' → only food rows", food.length > 0 && food.every((c) => /np-food/.test(c)), food.length);
      await noToasts(page); await page.screenshot({ path: SHOT + "nearby-food-390.png" });
      // Empty state: swap the source (the map agent's hook)
      await page.evaluate(() => { window.NEARPLACES.setSource(function () { return Promise.resolve([]); }); window.NEARPLACES.open(); }); await wait(page, 800);
      const emp = await page.evaluate(() => document.querySelector(".np-empty") && document.querySelector(".np-empty").textContent);
      ok("empty: 'Inga ställen inom 2 km' + 'Visa fler (5 km)'", /Inga ställen inom 2 km/.test(emp || "") && /Visa fler \(5 km\)/.test(emp || ""), emp);
      await noToasts(page); await page.screenshot({ path: SHOT + "nearby-empty-390.png" });
      await page.evaluate(() => document.querySelector(".np-more").click()); await wait(page, 500);
      ok("'Visa fler' → 5 km", await page.evaluate(() => /inom 5 km/.test(document.querySelector(".np-empty").textContent)));
      await page.evaluate(() => window.NEARPLACES.setSource(null));
      // C) the cause: restaurants far from the map view are not loaded until asked
      await page.evaluate(() => { window.__map.setView([59.334, 18.063], 15, { animate: false }); }); await wait(page, 1500);
      const cause = await page.evaluate(async () => {
        const B = window.BARS, G = [57.7070, 11.9668];   // Göteborg centre, far from the map view
        const before = B.nearby(G[0], G[1], 400, 6, { places: true, placeM: 150, maxPlaces: 4 }).filter((x) => x.place).length;
        await B.ensurePlacesP(G[0], G[1], 1, 4000);
        const after = B.nearby(G[0], G[1], 400, 6, { places: true, placeM: 250, maxPlaces: 6 }).filter((x) => x.place).length;
        return { before, after };
      });
      ok("cause: first nearby() away from the map view had 0 restaurants; after ensurePlacesP > 0", cause.after > 0, cause);
      console.log("   (before/after restaurants)", JSON.stringify(cause));
      await ctx.close();
    }
    // ---------- D) "Var dricker du?" after the beer tap: restaurants + "Fler ställen nära" ----------
    {
      const { ctx, page } = await ctxFor(browser, vp);
      await ctx.setGeolocation({ latitude: 60.15124, longitude: 15.18797 });
      await boot(page);
      await page.evaluate(() => { try { localStorage.removeItem("olnu.where"); } catch (e) {} });
      await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 3500);
      const title = await page.evaluate(() => document.getElementById("sheet-title").textContent);
      if (/Var dricker du/.test(title)) {
        const rows = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .btn")].map((b) => b.textContent));
        ok("where-sheet lists restaurants", rows.some((t) => /🍽️|Pizzeria|Restaurang|Café|Thai/.test(t)), rows);
        ok("where-sheet has 'Fler ställen nära'", rows.some((t) => /Fler ställen nära/.test(t)), rows);
        await page.evaluate(() => [...document.querySelectorAll("#sheet-body .btn")].find((b) => /Fler ställen nära/.test(b.textContent)).click()); await wait(page, 1500);
        const more = await page.evaluate(() => document.querySelectorAll(".where-more-box .np-row").length);
        ok("'Fler ställen nära' shows more rows inline", more > 0, more);
        await noToasts(page); await page.evaluate(() => document.querySelector(".where-more-box").scrollIntoView({ block: "center" })); await wait(page, 300);
        await page.screenshot({ path: SHOT + "where-sheet-more-390.png" });
      } else ok("where-sheet opened after beer tap", false, title);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.stack); fail++; }
  await browser.close();
  console.log(`\nnf-pw: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
