// beerlist-pw.js — lane beerlist (24 Nov 2026), 390 px, mocked Supabase. Usage: node beerlist-pw.js <port>
// I-141 the Öl tab = A3 with A1 cards (owner default): "Mina favoriter" (3 slots) on top, then one sideways row per beer family
//       (Lager, Veteöl, Pale ale och IPA …) in its family colour; cards = glass on a glow in the style's beer colour, family line,
//       flavour tags WITH words, one height per row. An empty slot "+ Lägg till" = pick mode (Sök field + beer list pick it;
//       Avbryt ends it). Chips, search, the camera button and the I-139 back (‹) still work; a row keeps its sideways place.
// Data: "A ship full of IPA" (7310401034799) is the alcohol-free bottle: its line says "Alkoholfri 0,0 %", never a bare 0,0 %.
// Polish: loading skeleton, error state with retry, empty search with a hint.
// Old code: every I-141 check, the "Alkoholfri 0,0 %" check and the error-state check FAIL.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const BLANC = "5740700980176", NORR = "7310401006925", GUIN = "5000213016107", SHIP_AF = "7310401034799";
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = [], calls = [], favs = (o.favs || []).slice();   // server slots: [{slot, beer}]
  page.on("pageerror", (e) => errs.push(e.message));
  if (o.failData) await ctx.route(/data\/beer\/beers\.json/, (r) => r.fulfill({ status: 500, body: "no" }));   // ctx: also the service worker
  await page.route(/rest\/v1\/rpc\/(beerlib_\w+)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (fn === "beerlib_favs_mine") return J(r, favs);
    if (fn === "beerlib_fav_set") {
      for (let i = favs.length - 1; i >= 0; i--) if (favs[i].slot === b.p_slot) favs.splice(i, 1);
      if (b.p_beer) favs.push({ slot: b.p_slot, beer: b.p_beer });
      return J(r, favs);
    }
    if (fn === "beerlib_beer_get") return J(r, { my_stars: null, fav_slot: null, n: 0, avg: null, reviews: [] });
    return J(r, {});
  });
  await boot(page);
  return { ctx, page, errs, calls, favs };
}
const tab = async (page) => {
  await page.evaluate(() => window.BARSEARCH.open("beer"));
  await page.waitForFunction(() => !!document.querySelector("#bs-beer [data-bl-style], #bs-beer .bl-empty"), null, { timeout: 15000 }).catch(() => {});
  await wait(page, 500);
};
const type = (page, v) => page.evaluate((x) => { const i = document.getElementById("bs-q"); i.value = x; i.dispatchEvent(new Event("input", { bubbles: true })); }, v);
const st = (page) => page.evaluate(() => {
  const b = document.getElementById("pn-back"), s = document.getElementById("sheet");
  return { open: !!s && !s.hidden, title: (document.getElementById("sheet-title") || {}).textContent || "", back: !!b && !b.hidden && getComputedStyle(b).display !== "none",
    panel: !!document.querySelector(".bs-beer-on"), q: (document.getElementById("bs-q") || {}).value || "" };
});
const waitTitle = (page, re) => page.waitForFunction((r) => { const s = document.getElementById("sheet"); return s && !s.hidden && new RegExp(r).test(document.getElementById("sheet-title").textContent); }, re.source, { timeout: 10000 }).catch(() => {});
const waitPanel = (page) => page.waitForFunction(() => !!document.querySelector(".bs-beer-on #bs-beer [data-bl-style]"), null, { timeout: 10000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  let ctx, page, errs, calls, favs;
  const part = async (name, fn) => { try { await fn(); } catch (e) { fail++; console.log("FAIL " + name + " exception", e && e.message); } await ctx.close().catch(() => {}); };

  await part("I-141 layout", async () => {
    ({ ctx, page, errs } = await open(browser, { favs: [{ slot: 1, beer: NORR }, { slot: 3, beer: GUIN }] }));
    await tab(page);
    await page.waitForFunction(() => document.querySelectorAll("#bs-beer .bl-fav:not(.empty)").length >= 2, null, { timeout: 8000 }).catch(() => {});
    const a = await page.evaluate(() => {
      const box = document.getElementById("bs-beer"), kids = [...box.children].map((e) => e.className || e.tagName);
      const favs = [...box.querySelectorAll(".bl-fav")].map((f) => ({ id: f.getAttribute("data-bl-beer"), add: f.getAttribute("data-bl-add"), n: (f.querySelector(".bl-fav-n") || {}).textContent || "", h: f.getBoundingClientRect().height }));
      const rows = [...box.querySelectorAll(".bl-fs")].map((s) => {
        const car = s.querySelector(".bl-car"), tiles = [...car.querySelectorAll(".bl-tile")], hs = tiles.map((t) => Math.round(t.getBoundingClientRect().height));
        return { name: s.querySelector(".bl-fh").firstChild.textContent, n: tiles.length, bar: getComputedStyle(s.querySelector(".bl-fh"), "::before").backgroundColor,
          sideways: getComputedStyle(car).overflowX, scrolls: car.scrollWidth > car.clientWidth + 4, hs: [Math.min(...hs), Math.max(...hs)] };
      });
      const t = box.querySelector(".bl-tile"), tags = [...t.querySelectorAll(".bl-tag")].map((x) => x.textContent);
      const art = t.querySelector(".bl-stage img").getBoundingClientRect();
      const order = [...box.querySelectorAll(".bl-h")].map((h) => h.firstChild.textContent);
      return { kids: kids.slice(0, 4), favs, rows, tiles: box.querySelectorAll(".bl-tile").length, fam: t.querySelector(".bl-fam").textContent, tags, sc: t.style.getPropertyValue("--bl-sc"),
        art: [Math.round(art.width), Math.round(art.height)], order, more: !!box.querySelector('[data-bl-more="st"]'), tileW: Math.round(t.getBoundingClientRect().width),
        chipH: Math.min(...[...box.querySelectorAll(".bl-chip")].map((c) => c.getBoundingClientRect().height)) };
    });
    ok("I-141 'Mina favoriter' is first, then Smak, then 'Stilar per familj', then Öl", a.order.join("|") === "Mina favoriter|Smak|Stilar per familj|Öl", a.order);
    ok("I-141 3 favourite slots: 1 = Norrlands Guld (numbered), 2 = '+ Lägg till', 3 = Guinness; each >= 44 px", a.favs.length === 3 && a.favs[0].id === NORR && a.favs[0].n === "1" &&
      a.favs[1].add === "2" && a.favs[2].id === GUIN && a.favs.every((f) => f.h >= 44), a.favs);
    ok("I-141 one sideways row per family, Lager first, all 61 styles, no 'Visa alla stilar'", a.rows.length >= 8 && a.rows[0].name === "Lager" && a.tiles === 61 && !a.more &&
      a.rows.every((r) => r.sideways === "auto") && a.rows[0].scrolls, a.rows.map((r) => r.name + ":" + r.n));
    ok("I-141 each family has its own colour bar (at least 6 different colours)", new Set(a.rows.map((r) => r.bar)).size >= 6, a.rows.map((r) => r.bar));
    ok("I-141 A1 cards: one height per row, family line, glass >= 60 px on the style colour, tags WITH words", a.rows.every((r) => r.hs[1] - r.hs[0] <= 1) && a.fam === "Lager" &&
      a.art[0] >= 60 && /^#/.test(a.sc) && a.tags.length >= 1 && a.tags.every((x) => /\p{L}{3}/u.test(x)), { fam: a.fam, tags: a.tags, sc: a.sc, art: a.art, hs: a.rows.map((r) => r.hs) });
    ok("I-141 a part of the next card shows at the edge (the row scrolls), cards 120-160 px", a.tileW >= 120 && a.tileW <= 160, a.tileW);
    ok("Chips still 44 px", a.chipH >= 44, a.chipH);
    // chip: the rows show only matching styles, the family with the most "rostad" first
    await page.click('#bs-beer [data-bl-fl="rostad"]'); await wait(page, 400);
    const c = await page.evaluate(() => ({ on: document.querySelector('#bs-beer [data-bl-fl="rostad"]').getAttribute("aria-pressed"), h: [...document.querySelectorAll("#bs-beer .bl-h")].map((x) => x.textContent).join("|"),
      first: (document.querySelector("#bs-beer .bl-fh") || {}).textContent || "", n: document.querySelectorAll("#bs-beer .bl-tile").length }));
    ok("Smak chip: 'Mest rostad först', fewer styles, a dark family first", c.on === "true" && /Mest rostad först/.test(c.h) && c.n < 61 && /Porter|stout|lager|Mörk/i.test(c.first), c);
    await page.click('#bs-beer [data-bl-fl="rostad"]'); await wait(page, 300);
    // search: no favourites, styles in family rows, beers
    await type(page, "ipa"); await wait(page, 700);
    const s = await page.evaluate(() => ({ fav: !!document.querySelector("#bs-beer .bl-favs"), st: [...document.querySelectorAll("#bs-beer .bl-tile b")].map((b) => b.textContent), rows: document.querySelectorAll("#bs-beer .bl-row").length,
      cam: !document.getElementById("bs-cam").hidden }));
    ok("Search 'ipa': styles + beers, no favourites block while typing", !s.fav && s.st.some((x) => /IPA/.test(x)) && s.rows > 0, s);
    await type(page, ""); await wait(page, 600);
    ok("The camera (scan) button is there again with an empty field", await page.evaluate(() => !document.getElementById("bs-cam").hidden));
    // the owner's data case
    await type(page, "ship full"); await wait(page, 700);
    const sh = await page.evaluate((id) => { const r = document.querySelector("#bs-beer [data-bl-beer='" + id + "']"); return { t: r ? r.textContent : "", all: [...document.querySelectorAll("#bs-beer .bl-row")].map((x) => x.textContent) }; }, SHIP_AF);
    ok("'A ship full of IPA' (the alcohol-free bottle) says 'Alkoholfri 0,0 %'", /Alkoholfri\s0,0/.test(sh.t), sh.t);
    ok("No beer row shows a bare 0,0 % (without 'Alkoholfri')", sh.all.every((x) => !/(^|[^i]\s)0,0\s%/.test(x.replace(/Alkoholfri\s0,0/g, ""))), sh.all);
    ok("No double word 'Alkoholfri öl … · Alkoholfri'", sh.all.every((x) => !/Alkoholfri öl.*·\s*Alkoholfri/.test(x)), sh.all);
    await type(page, "zzqxw"); await wait(page, 700);
    ok("Empty search: an icon, one line and a hint", await page.evaluate(() => { const e = document.querySelector("#bs-beer .bl-empty"); return !!e && !!e.querySelector("svg") && /Ingen öl/.test(e.textContent) && /IPA/.test(e.textContent); }));
    ok("No page errors (layout)", errs.length === 0, errs);
  });

  await part("I-141 pick", async () => {
    ({ ctx, page, errs, calls, favs } = await open(browser, { favs: [{ slot: 1, beer: NORR }] }));
    await tab(page);
    await page.waitForFunction(() => !!document.querySelector('#bs-beer [data-bl-add="2"]'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('#bs-beer [data-bl-add="2"]').click()); await wait(page, 400);
    const p = await page.evaluate(() => ({ bar: (document.querySelector("#bs-beer .bl-pickbar") || {}).textContent || "", cars: document.querySelectorAll("#bs-beer .bl-car").length,
      chips: document.querySelectorAll("#bs-beer .bl-chip").length, rows: document.querySelectorAll("#bs-beer .bl-row").length, focus: document.activeElement && document.activeElement.id,
      x: (document.querySelector("#bs-beer [data-bl-pickx]") || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height }));
    ok("'+ Lägg till' opens the beer search to pick: 'Välj favorit nr 2', beers only, the field has focus, Avbryt 44 px", /Välj favorit nr 2/.test(p.bar) && p.cars === 0 && p.chips === 0 && p.rows > 5 && p.focus === "bs-q" && p.x >= 44, p);
    await type(page, "guinness original"); await wait(page, 700);
    ok("Pick mode stays while typing", await page.evaluate(() => !!document.querySelector("#bs-beer .bl-pickbar") && document.querySelectorAll("#bs-beer .bl-row").length > 0));
    // the one already in slot 1 -> a short note, nothing changes
    await type(page, "norrlands guld"); await wait(page, 700);
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-beer='" + id + "']").click(), NORR); await wait(page, 500);
    ok("Picking a beer that is already a favourite: still in pick mode, no save", await page.evaluate(() => !!document.querySelector("#bs-beer .bl-pickbar")) && !calls.some((c) => c[0] === "beerlib_fav_set"), calls);
    await type(page, "guinness original"); await wait(page, 700);
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-beer='" + id + "']").click(), GUIN);
    await page.waitForFunction((id) => { const f = document.querySelectorAll("#bs-beer .bl-fav")[1]; return f && f.getAttribute("data-bl-beer") === id; }, GUIN, { timeout: 8000 }).catch(() => {});
    const d = await page.evaluate(() => ({ bar: !!document.querySelector("#bs-beer .bl-pickbar"), q: document.getElementById("bs-q").value, f: [...document.querySelectorAll("#bs-beer .bl-fav")].map((x) => x.getAttribute("data-bl-beer") || "+"),
      sheet: !document.getElementById("sheet").hidden }));
    ok("A tap saves it as favourite 2 (server slot 2), ends pick mode, clears the field, opens no beer page", !d.bar && d.q === "" && d.f[0] === "7310401006925" && d.f[1] === "5000213016107" && !d.sheet &&
      calls.some((c) => c[0] === "beerlib_fav_set" && c[1].p_slot === 2 && c[1].p_beer === "5000213016107"), { d, calls });
    // Avbryt
    await page.evaluate(() => document.querySelector('#bs-beer [data-bl-add="3"]').click()); await wait(page, 300);
    await page.evaluate(() => document.querySelector("#bs-beer [data-bl-pickx]").click()); await wait(page, 400);
    ok("Avbryt ends pick mode: favourites and family rows are back, nothing saved", await page.evaluate(() => !document.querySelector("#bs-beer .bl-pickbar") && !!document.querySelector("#bs-beer .bl-favs") &&
      document.querySelectorAll("#bs-beer .bl-car").length >= 8) && calls.filter((c) => c[0] === "beerlib_fav_set").length === 1);
    ok("No page errors (pick)", errs.length === 0, errs);
  });

  await part("I-141 back", async () => {
    ({ ctx, page, errs } = await open(browser, { favs: [{ slot: 1, beer: BLANC }] }));
    await tab(page);
    // a style in the Veteöl row, scrolled sideways, after the list scrolled down
    const k = await page.evaluate(() => {
      const box = document.getElementById("bs-beer"), car = document.querySelector('#bs-beer [data-bl-car="pale-ipa"]');
      car.scrollIntoView({ block: "center" }); car.scrollLeft = 180; car.dispatchEvent(new Event("scroll"));
      const t = [...car.querySelectorAll("[data-bl-style]")].find((x) => x.getBoundingClientRect().left > 20);
      return { top: box.scrollTop, left: car.scrollLeft, id: t.getAttribute("data-bl-style"), name: t.querySelector("b").textContent };
    });
    await wait(page, 200);
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-style='" + id + "']").click(), k.id);
    await waitTitle(page, new RegExp(k.name.replace(/[()]/g, "."))); await wait(page, 400);
    let s = await st(page);
    ok("I-139 a style card in a family row opens the style page with a back (‹)", s.open && s.back && !s.panel, { s, k });
    await page.evaluate(() => document.getElementById("pn-back").click()); await waitPanel(page); await wait(page, 700);
    const b = await page.evaluate(() => { const box = document.getElementById("bs-beer"), car = document.querySelector('#bs-beer [data-bl-car="pale-ipa"]'); return { top: box.scrollTop, left: car ? car.scrollLeft : -1 }; });
    ok("‹ = the Öl tab again, same scroll place, the row keeps its sideways place", Math.abs(b.top - k.top) <= 30 && Math.abs(b.left - k.left) <= 30, { b, k });
    // a favourite opens the beer page with a back
    await page.evaluate(() => { document.getElementById("bs-beer").scrollTop = 0; });
    await page.evaluate((id) => document.querySelector("#bs-beer .bl-fav[data-bl-beer='" + id + "']").click(), BLANC);
    await waitTitle(page, /1664 Blanc/); await wait(page, 400);
    s = await st(page);
    ok("A favourite opens its beer page with a back (‹)", s.open && s.back, s);
    await page.evaluate(() => history.back()); await waitPanel(page); await wait(page, 400);
    s = await st(page);
    ok("Android back on that page = the Öl tab", !s.open && s.panel, s);
    ok("No page errors (back)", errs.length === 0, errs);
  });

  await part("polish states", async () => {
    ({ ctx, page, errs } = await open(browser, { failData: true }));
    await page.evaluate(() => window.BARSEARCH.open("beer"));
    await page.waitForFunction(() => !!document.querySelector("#bs-beer .bl-empty, #bs-beer .bs-err, #bs-beer [data-bl-retry]"), null, { timeout: 15000 }).catch(() => {});
    const e = await page.evaluate(() => { const x = document.querySelector("#bs-beer .bl-empty"), r = document.querySelector("#bs-beer [data-bl-retry]");
      return { t: x ? x.textContent : document.getElementById("bs-beer").textContent, icon: !!(x && x.querySelector("svg")), retry: r ? r.getBoundingClientRect().height : 0 }; });
    ok("Error: an icon, 'gick inte att ladda', a hint and a 44 px 'Försök igen'", e.icon && /gick inte att ladda/.test(e.t) && /nätet/.test(e.t) && e.retry >= 44, e);
  });

  await browser.close();
  console.log(`\nbeerlist: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
