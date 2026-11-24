// barcard-pw.js — I-133 unique bar card, option A (owner 24 Nov 2026: all 8 A34 defaults = yes). docs/js/barcard.js + docs/barcard.css.
// The bar sheet (Leaflet popup "olnu-bar") gets a themed header band: crest with initials, kind chip, seeded picture, name, hours,
// shaped edge; a 56 px sticky name bar when the band has scrolled away; 9 themes; chain look / own photo only with brand data.
// Checks that the old parts still work: crowd hero, Checka in / På väg, Info (barinfo / oppet hours), Mer, "På kran" (beer library),
// ✕ (44 px, 16 px from the edge, on top), a tap on the map closes the card and selects nothing. Old code: no band -> most checks fail.
// 390 px + 1280 px, mocked Supabase (port B). Usage: node barcard-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = require("./env.js").OUT, SP = OUT + "barcard/";
fs.mkdirSync(SP, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const PARMA = "x-la-parma-ludvika", LL = [60.15124, 15.18797];
const BEER = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/data/beer/beers.json"), "utf8")).rows[0][0];
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="780" height="400"><rect width="780" height="400" fill="#5a3519"/><circle cx="200" cy="120" r="60" fill="#ffd890"/></svg>';
const CHAIN = { chains: { c1: { name: "Kopparkannan", n: 14, acc: "#7FE0B8", band: "#0c2b22" } }, bars: {} };
const WEEK = ["660-1500", "660-1500", "660-1500", "660-1500", "660-1560", "660-1560", "660-1500"];

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, o.vp || { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { window.OLNU_STORE = true; try { localStorage.setItem("olnu.store", "1"); } catch (e) {} });
  await page.route("**/storage/v1/object/public/bar-brand/**", (r) => r.fulfill({ status: 200, body: PHOTO, headers: { "content-type": "image/svg+xml" } }));
  // "På kran": the same fetch stub as beerui-pw.js (the service worker would bypass page.route)
  await ctx.addInitScript(([bars]) => { const f = window.fetch; window.fetch = function (u) {
    if (/\/data\/beer\/taps\.json/.test(String(u && u.url || u))) return Promise.resolve(new Response(JSON.stringify({ v: 1, bars }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return f.apply(this, arguments); }; }, [{ [PARMA]: { beers: [BEER], updated: "2026-11-20" } }]);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.PN && PN.barcard && window.PNDS && PNDS._A && PNDS._A(), null, { timeout: 15000 }).catch(() => console.log("no PN.barcard"));
  await page.evaluate(() => { document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()); });
  return { ctx, page, errs };
}
// open the bar sheet: the real marker (c = null) or a popup made by the app's own barPopup with a changed name / kind / id
async function sheet(page, c, brands) {
  await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} });
  await wait(page, 250);
  await page.evaluate((ll) => window.__map.setView(ll, 17, { animate: false }), LL); await wait(page, 700);
  const r = await page.evaluate(([id, c, brands, week]) => {
    if (window.PN && PN.barcard) PN.barcard.setBrands(brands ? JSON.parse(JSON.stringify(brands).replace(/@SB@/g, OLNU_CONFIG.SUPABASE_URL)) : null);
    let m = null; window.__map.eachLayer((l) => { const o = l.options && l.options.olnuC; if (o && o.bar && String(o.bar.id) === id) m = l; });
    if (!m) return "no marker";
    const o = m.options.olnuC, b = Object.assign({}, o.bar, c || {});
    if (window.OPPET && OPPET.setFix) OPPET.setFix(b.id, week, "crowd");
    if (!c) { m.fire("click"); return "marker"; }
    L.popup({ offset: L.point(0, -10), className: "olnu-bar" }).setLatLng(m.getLatLng()).setContent(PNDS._A().barPopup(b, o.beers || [])).openOn(window.__map);
    return "popup";
  }, [PARMA, c || null, brands || null, WEEK]);
  await wait(page, 1600);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return r;
}
const facts = (page) => page.evaluate(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const pop = document.querySelector(".leaflet-popup:has(.bs)"); if (!pop) return null;
  const q = (s) => pop.querySelector(s), band = q(".pn-bc"), wr = q(".leaflet-popup-content-wrapper"), x = pop.querySelector(".leaflet-popup-close-button");
  const o = { band: !!band, sheet: pop.classList.contains("olnu-sheet") };
  if (!band) { o.headPos = q(".bs-head") && getComputedStyle(q(".bs-head")).position; return o; }
  const title = q(".pn-bc .pp-title"), chips = [...band.querySelectorAll(".pn-bc-chip")], mot = q(".pn-bc-mot"), crest = q(".pn-bc-crest"), meta = q(".pn-bc .bs-meta");
  const tc = getComputedStyle(title), xr = R(x);
  const hit = x && document.elementFromPoint(xr.l + xr.w / 2, xr.t + xr.h / 2);
  // the picture's drawing starts at x = 80 of 180 (viewBox) and fades out at 90 % of its height
  const mr = R(mot), flip = mot ? new DOMMatrix(getComputedStyle(mot).transform).a < 0 : false;
  o.look = band.dataset.bc; o.kind = band.dataset.kind; o.style = band.getAttribute("style");
  o.crest = (crest.querySelector("b") || {}).textContent || ""; o.crestSvg = !!crest.querySelector("svg path, svg circle, svg rect, img");
  o.chips = chips.map((c) => c.textContent.trim()); o.chipR = Math.max(...chips.map((c) => R(c).r));
  o.motL = mr ? (flip ? mr.l + mr.w * 0.11 : mr.l + mr.w * 0.44) : null; o.motFade = mr ? mr.t + mr.h * 0.8 : null;   // the mask ends at 80 % (barcard.css)
  o.title = { txt: title.textContent, ff: tc.fontFamily.split(",")[0].replace(/"/g, ""), fs: tc.fontSize, col: tc.color, h: R(title).h, t: R(title).t, inBand: band.contains(title) };
  o.meta = meta ? meta.textContent.trim() : null; o.metaInBand = !!(meta && band.contains(meta));
  o.pat = (q(".pn-bc-pat") && getComputedStyle(q(".pn-bc-pat")).maskImage) || "none";
  o.edge = !!q(".pn-bc-edge path"); o.photo = q(".pn-bc-photo") ? { ok: q(".pn-bc-photo").naturalWidth > 0, cred: (q(".pn-bc-cred") || {}).textContent } : null;
  o.bandR = R(band); o.wrap = R(wr); o.crestR = R(crest);
  o.close = xr ? { w: Math.round(xr.w), h: Math.round(xr.h), right: Math.round(R(wr).r - xr.r), cy: xr.t + xr.h / 2, top: xr.t, onTop: !!(hit && (hit === x || x.contains(hit))) } : null;
  o.order = ["head", ".bs-head", ".pn-bs-hero", ".pp-act", ".pn-bs-info", "details[data-fold=mer]"].slice(1).map((s) => (R(q(s)) || { t: null }).t);
  const act = [...pop.querySelectorAll(".pp-act .ci-btn, .pp-act .ci-out, .pp-act .eta-go")].filter((e) => e.getClientRects().length);
  o.actFree = act.length > 0 && act.every((e) => { const r = R(e), h = document.elementFromPoint(r.l + r.w / 2, r.t + r.h / 2); return h && (h === e || e.contains(h)); });
  o.mini = q(".pn-bc-mini") ? { vis: getComputedStyle(q(".pn-bc-mini")).visibility, r: R(q(".pn-bc-mini")), pos: getComputedStyle(q(".pn-bc-mini")).position, txt: q(".pn-bc-mini").textContent } : null;
  o.stuck = !!q(".bs.pn-bc-stuck");
  o.bandText = band.textContent.replace(/\s+/g, " ").trim();
  o.links = band.querySelectorAll("a, button").length;
  return o;
});
const scrollTo = (page, y) => page.evaluate((y) => { const s = document.querySelector(".leaflet-popup:has(.bs) .leaflet-popup-content"); if (s) { s.scrollTop = y; s.dispatchEvent(new Event("scroll")); } }, y);
const shot = (page, n) => page.screenshot({ path: SP + n + ".png" });

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- 1. La Parma (real marker): the pub theme, layout, old parts ----------
    let { ctx, page, errs } = await open(browser);
    ok("setup: La Parma opens from its marker", (await sheet(page, null)) === "marker");
    let f = await facts(page);
    await shot(page, "parma");
    ok("A: the bar sheet has the themed band (pub)", f && f.band && f.look === "pub" && f.kind === "pub", f);
    if (!f || !f.band) { await ctx.close(); throw new Error("no band: stop"); }
    ok("A q2: crest with the initials 'LP' in a drawn shape", f.crest === "LP" && f.crestSvg, f.crest);
    ok("A: kind chip says 'Pub'", f.chips[0] === "Pub", f.chips);
    ok("A: the name + hours are in the band; hours from OPPET ('Öppet till 01:00'), no 'Pub' repeated", f.title.inBand && f.metaInBand && /Öppet till 01:00/.test(f.meta) && !/^Pub/.test(f.meta), f.meta);
    ok("A: title stays Black Ops One 22 amber", f.title.ff === "Black Ops One" && Math.round(parseFloat(f.title.fs)) === 22 && /255, 194, 77/.test(f.title.col), f.title);
    ok("A: the band is full width and starts at the sheet top", Math.abs(f.bandR.w - f.wrap.w) <= 2 && Math.abs(f.bandR.t - f.wrap.t) <= 2, { b: f.bandR, w: f.wrap });
    ok("A: header is about 70 px taller than before: band 150-215 px", f.bandR.h >= 150 && f.bandR.h <= 215, f.bandR.h);
    ok("A: ✕ round 44, 16 px from the edge, on top, in the crest row", f.close && f.close.w === 44 && f.close.h === 44 && Math.abs(f.close.right - 16) <= 1 && f.close.onTop && Math.abs(f.close.cy - (f.crestR.t + 22)) <= 6, f.close);
    ok("A: the picture never sits behind the chips or the title", f.motL >= f.chipR - 2 && f.motFade <= f.title.t + 3, { motL: f.motL, chipR: f.chipR, fade: f.motFade, title: f.title.t });
    ok("A: pattern (mask) + shaped edge are drawn", f.pat !== "none" && f.edge, f.pat);
    ok("A: the old parts follow in order: header < crowd hero < actions < Info < Mer", f.order.every((v, i, a) => v != null && (i === 0 || a[i - 1] < v)), f.order);
    ok("A: Checka in / På väg are not covered by anything", f.actFree);
    ok("A: the band has no buttons or links (the ✕ stays the only control up there)", f.links === 0, f.links);
    const tap = await page.evaluate(() => { const s = document.querySelector("[data-plc-tap]"); return s && !s.hidden ? s.textContent.replace(/\s+/g, " ").slice(0, 60) : null; });
    ok("A: 'På kran' (beer library) still shows under the actions", !!tap && /På kran/.test(tap), tap);
    const info = await page.evaluate(() => !!document.querySelector(".leaflet-popup .pn-bs-info .bi-line"));
    ok("A: Info rows from barinfo.js / oppet.js are still there", info);

    // ---------- 2. q1: the band scrolls away, the 56 px name bar comes back ----------
    ok("q1 setup: the name bar exists, hidden at the top", f.mini && f.mini.vis === "hidden" && f.mini.pos === "sticky" && !f.stuck, f.mini);
    await scrollTo(page, 420); await wait(page, 300);
    let s = await facts(page);
    await shot(page, "parma-scrolled");
    ok("q1: scrolled -> name bar shows at the sheet top, 56 px, with the initials + name", s.stuck && s.mini.vis === "visible" && Math.abs(s.mini.r.t - s.wrap.t) <= 2 && Math.round(s.mini.r.h) === 56 && /LP\s*La Parma/.test(s.mini.txt), s.mini);
    ok("q1: ✕ moves into the name bar and stays on top", s.close.onTop && s.close.top >= s.mini.r.t && s.close.top + 44 <= s.mini.r.b + 1, s.close);
    await scrollTo(page, 0); await wait(page, 300);
    s = await facts(page);
    ok("q1: back at the top -> name bar hidden, ✕ back in the crest row", !s.stuck && s.mini.vis === "hidden" && Math.abs(s.close.cy - (s.crestR.t + 22)) <= 6, { stuck: s.stuck, close: s.close });

    // ---------- 3. a tap on the map closes the card and selects nothing (one click router) ----------
    // the install hint ("Tryck på Dela …") can sit over the map strip: hide it, then tap a plain map spot
    await page.evaluate(() => [].forEach.call(document.querySelectorAll("div,section,aside"), (e) => { if (/^(Tryck på Dela|Under betan)/.test((e.innerText || "").trim()) && e.offsetHeight < 300) e.style.display = "none"; }));
    const spot = await page.evaluate(() => {   // a plain map spot in the strip above the sheet (no marker, chip, control or banner)
      const top = document.querySelector(".leaflet-popup:has(.bs)").getBoundingClientRect().top;
      for (let y = top - 16; y > 90; y -= 12) for (let x = 24; x < 366; x += 16) {
        const e = document.elementFromPoint(x, y);
        if (e && e.closest(".leaflet-container") && !e.closest(".leaflet-marker-icon, .leaflet-marker-pane, .leaflet-overlay-pane svg path, .leaflet-popup, .leaflet-control, button, a, [role=button]")) return [x, y];
      }
      return null;
    });
    ok("router setup: found a plain map spot above the sheet", !!spot, spot);
    if (spot) await page.mouse.click(spot[0], spot[1]); await wait(page, 900);
    const after = await page.evaluate(() => document.querySelectorAll(".leaflet-popup .bs").length);
    ok("router: a tap on the map closes the card, no other card opens", after === 0, after);

    // ---------- 4. the 9 themes (+ long name, wide chips) ----------
    const KINDS = [["pub", "Lyktgubben", "pub", "Pub"], ["sportbar", "Målvakten", "sportbar", "Sportbar"], ["cocktail", "Blå timmen", "cocktail", "Cocktailbar"],
      ["nattklubb", "Neonhallen", "nattklubb", "Nattklubb"], ["olbar", "Gruvbryggeriet Taproom", "olbar", "Ölbar / bryggeri"], ["restbar", "Grytan Mat & Bar", "restbar", "Mat & bar"],
      ["hotellbar", "Lobbybaren på Hotell Fyrklövern", "hotellbar", "Hotellbar"], ["olbar", "Stora ölhallen", "olhall", "Ölhall"], ["bar", "Bar Kometen", "bar", "Bar"],
      ["nation", "Västmanlands-Dala nation", "pub", "Studentpub / nation"], ["vinbar", "Vinbaren", "cocktail", "Vinbar"], ["oltradgard", "Parkens ölträdgård", "olhall", "Ölträdgård"]];
    const looks = {};
    for (const [vt, name, look, label] of KINDS) {
      await sheet(page, { vt, name });
      const k = await facts(page);
      await shot(page, "kind-" + vt + "-" + look);
      looks[look] = 1;
      ok("themes: " + name + " (" + vt + ") -> " + look + ", chip '" + label + "', crest, pattern, edge, title max 2 lines, picture clear of chips + title",
        k && k.look === look && k.chips[0] === label && k.crestSvg && k.pat !== "none" && k.edge && k.title.h <= 57 && k.motL >= k.chipR - 2 && k.motFade <= k.title.t + 3 && k.close.onTop,
        k && { look: k.look, chips: k.chips, h: k.title.h, motL: k.motL, chipR: k.chipR, fade: k.motFade, tt: k.title.t });
    }
    ok("themes: all 9 themes were drawn", Object.keys(looks).length === 9, Object.keys(looks));

    // ---------- 5. q3: same kind, still its own card ----------
    const pubs = [];
    for (const [id, name] of [["x-bc-a", "Lyktgubben"], ["x-bc-b", "Tre tunnor"], ["x-bc-c", "Gamla Krogen"]]) { await sheet(page, { id, name, vt: "pub" }); const k = await facts(page); pubs.push([k.crest, k.style]); await shot(page, "unique-" + id); }
    await sheet(page, { id: "x-bc-a", name: "Lyktgubben", vt: "pub" }); const again = await facts(page);
    ok("q3: three pubs = three crests and three picture shifts; the same bar = the same look", new Set(pubs.map((p) => p[0])).size === 3 && new Set(pubs.map((p) => p[1])).size === 3 && again.style === pubs[0][1], pubs);

    // ---------- 6. q6 + q7: chain look only with permission; '1 av 14 ställen' is text only ----------
    const ch = JSON.parse(JSON.stringify(CHAIN)); ch.bars[PARMA] = { chain: "c1" };
    await sheet(page, { name: "Kopparkannan Ludvika", vt: "pub" }, ch);
    let c = await facts(page); await shot(page, "chain-yes");
    ok("q6: chain with permission -> chain look, chain chip, chain colour, no seeded shift", c.look === "chain" && c.chips.includes("Kopparkannan") && /--bc-acc:#7FE0B8/.test(c.style) && /--bc-dx:0px/.test(c.style) && /--bc-rot:0deg/.test(c.style), c);
    ok("q7: '1 av 14 ställen' is plain text (no list, no rank, no link)", /1 av 14 ställen/.test(c.meta) && c.links === 0 && !/#\d|plats \d/i.test(c.bandText), c.meta);
    await sheet(page, { name: "Kopparkannan Falun", vt: "pub" }, null);
    c = await facts(page); await shot(page, "chain-no");
    ok("q6: same chain, no permission -> the normal pub theme", c.look === "pub" && !c.chips.includes("Kopparkannan") && !/ställen/.test(c.meta), c.look);

    // ---------- 7. q5: photo only from the bar itself (our bucket); none today = no photo ----------
    await sheet(page, null, { bars: { [PARMA]: { photo: "@SB@/storage/v1/object/public/bar-brand/" + PARMA + "/1.jpg" } } });
    c = await facts(page); await shot(page, "photo-own");
    ok("q5: the bar's own approved photo shows with 'Foto: krogen'", c.photo && c.photo.ok && c.photo.cred === "Foto: krogen" && c.title.inBand, c.photo);
    await sheet(page, null, { bars: { [PARMA]: { photo: "https://maps.googleapis.com/maps/api/place/photo?ref=1" } } });
    c = await facts(page);
    ok("q5: a scraped / outside photo is never shown", !c.photo && c.look === "pub", c.photo);
    await sheet(page, null, null);
    c = await facts(page);
    ok("q5: no brand data (today) = no photo", !c.photo, c.photo);

    // ---------- 8. places keep today's plain header ----------
    await page.evaluate((ll) => { window.__map.closePopup(); L.popup({ className: "olnu-bar" }).setLatLng(ll).setContent(PNDS._A().barPopup({ id: "x-bc-pizza", name: "Pizzeria Test", type: "restaurant", place: 1, lat: ll[0], lng: ll[1] }, [])).openOn(window.__map); }, LL);
    await wait(page, 900);
    c = await facts(page);
    ok("places: a restaurant card keeps the plain sticky header (no band)", c && !c.band && c.headPos === "sticky", c);
    ok("1: no page errors", errs.length === 0, errs);
    await ctx.close();

    // ---------- 9. store build + reduced motion ----------
    ({ ctx, page, errs } = await open(browser, { store: true, reduced: true }));
    await sheet(page, null);
    c = await facts(page);
    const mo = await page.evaluate(() => [".pn-bc", ".pn-bc-mot", ".pn-bc-mini", ".pn-bc-pat"].map((s) => { const e = document.querySelector(s), cs = e && getComputedStyle(e); return cs ? cs.animationName + "/" + (/transform|top|height|all/.test(cs.transitionProperty) && parseFloat(cs.transitionDuration) > 0.01 ? "moves" : "still") : "none"; }));
    await shot(page, "store-reduced");
    ok("store: the same card in a store build; band text = crest + kind + name + hours only (no counts, no praise)",
      c.band && c.look === "pub" && c.bandText.replace(/LP|Pub|La Parma Pub & Restaurang|Öppet till 01:00|·/g, "").trim() === "", c.bandText);
    ok("reduced motion: the band is still (no animation, no own transition)", mo.every((m) => m === "none/still" || m === "none"), mo);   // barcard.css has no transition at all (unit test); the app's global colour fades do not move anything
    ok("9: no page errors", errs.length === 0, errs);
    await ctx.close();

    // ---------- 10. desktop popup (1280) ----------
    ({ ctx, page, errs } = await open(browser, { vp: { width: 1280, height: 800 } }));
    await sheet(page, null);
    c = await facts(page);
    await shot(page, "desktop");
    ok("desktop: the card popup has the band, full card width, ✕ on top", c && c.band && !c.sheet && Math.abs(c.bandR.w - c.wrap.w) <= 2 && c.close.onTop, c && { b: c.bandR, w: c.wrap, x: c.close });
    ok("10: no page errors", errs.length === 0, errs);
    await ctx.close();
  } finally { await browser.close(); }
  console.log("barcard-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
