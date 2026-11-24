// olbtn-pw.js — lane olbtn (24 Nov 2026): the ÖL! button looks.
//  i144  I-144 (owner 21 Nov "the snow on the button looks bad", default B4): on a snow day ONE look per Stockholm day
//        (clean / frost rim / knit beanie + flakes / frost + beanie), the same all day; a season-hat day keeps the hat and
//        only adds flakes (never the beanie). No white hair any more. The frost and the rim flakes step back in the wait
//        and in "Ångra" (they would lie on the 10 s ring); the beanie stays (A37).
//  a2    A2: GLÖGG (mug + word) only 1-26 Dec. LÄSK! ("Jag kör ikväll") on a GLÖGG day: no mug, LÄSK! keeps its own size.
//  a3    A3: the season colour never paints over LÄSK! (the driver's button stays a soda can); label contrast >= 4.5:1 on the
//        real pixels behind the label, every season colour (+ normal days, GLÖGG).
//  a18   A18: the rank cap (ranks 1-6) is ONE joined skirt with V crimps, wider than high, at 16-48 px (not loose rays).
//  store store build + reduced motion: the snow look shows, nothing in the dress moves after a tap.
// usage: node olbtn-pw.js <port> [parts regex]   (mocked Supabase, 390 x 844)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const ONLY = new RegExp(process.argv[3] || ".");
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });

async function open(b, o = {}) {
  const { ctx, page } = await ctxFor(b, { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, (r) => J(r, { accepted: true, beer_count: 3, drinks: 3, lat: 60.1511, lng: 15.1876, precise: true,
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }));
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await boot(page);
  await page.waitForFunction(() => window.PNSeason && window.PNDress && window.PN && PN.tickCooldown && window.RANKICO, null, { timeout: 30000 });
  await page.addStyleTag({ content: "#toasts{display:none !important} .pm-burst{display:none !important}" });
  return { ctx, page, errs };
}
const force = async (page, o) => { await page.evaluate((o) => { PNSeason._force(o); PNDress.place(); }, o); await wait(page, 350); };
const rest = (page) => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = 0; localStorage.setItem("olnu.night", JSON.stringify(m));
  try { PN.s.meState && (PN.s.meState.undo_until = null); } catch (e) {} PN.tickCooldown(); });
const dress = (page) => page.evaluate(() => {
  const d = document.querySelector(".ss-dress"), vis = (sel) => [...document.querySelectorAll(".ss-dress " + sel)].filter((e) => getComputedStyle(e).display !== "none" && e.getClientRects().length).length;
  return { st: PNDress.state(), shown: !!d && !d.hidden, hair: document.querySelectorAll(".ss-hair").length, frost: vis(".ss-frost"), beanie: vis(".ss-d-beanie"),
    hat: (document.querySelector(".ss-dress .ss-d") || { className: "" }).className.replace(/ss-p |ss-d /g, ""), flHat: vis(".ss-fl-hat"), flRim: vis(".ss-fl-rim") };
});

async function i144(b) {
  const { ctx, page, errs } = await open(b);
  // the daily pick (no forced look): the same at 00:05 and 23:55 Stockholm time, from PNSeason._snowLook; the next day another
  const day = async (iso) => { await force(page, { date: iso, wx: "snow", snow: "" }); return page.evaluate(() => ({ s: PNDress.state(), now: PNSeason.now().snowlook })); };
  const a = await day("2027-02-11T00:05"), c = await day("2027-02-11T23:55"), n = await day("2027-02-12T00:05");
  const want = await page.evaluate(() => typeof PNSeason._snowLook === "function" ? [PNSeason._snowLook(2027, 2, 11, false), PNSeason._snowLook(2027, 2, 12, false)] : null);
  ok(!!want && a.s.snow === want[0] && c.s.snow === want[0] && n.s.snow === want[1] && want[0] !== want[1], "B4: one snow look per Stockholm day, the same all day, another one the next day", { a, c, n, want });
  // every look on a no-hat day, and the hat-day looks at Christmas
  const W = { clean: [0, 0, 0, 0], frost: [1, 0, 0, 0], beanie: [0, 1, 1, 1], "frost+beanie": [1, 1, 1, 1] };
  for (const look of Object.keys(W)) {
    await force(page, { season: "winter", wx: "snow", snow: look }); await rest(page); await wait(page, 200);
    const d = await dress(page), w = W[look];
    ok(d.hair === 0 && d.frost === w[0] && d.beanie === w[1] && d.flHat === w[2] && d.flRim === w[3] && d.shown === (look !== "clean") && d.st.snow === look,
      `winter snow "${look}": frost ${w[0]}, beanie ${w[1]}, flakes ${w[2]}, no white hair`, d);
  }
  for (const look of ["clean", "frost", "flakes", "frost+flakes", "frost+beanie"]) {
    await force(page, { season: "xmas", wx: "snow", snow: look }); await wait(page, 150);
    const d = await dress(page), fr = /frost/.test(look) ? 1 : 0, fl = /flakes|beanie/.test(look) ? 1 : 0;
    ok(d.hair === 0 && /ss-d-santa/.test(d.hat) && d.beanie === 0 && d.frost === fr && d.flHat === fl && d.flRim === fl, `Christmas snow "${look}": the Santa hat stays, never a beanie, frost ${fr}, flakes ${fl}`, d);
  }
  // no snow: no snow look
  await force(page, { season: "winter", wx: "clear", snow: "" }); let d = await dress(page);
  ok(!d.shown && d.st.snow === "" && d.frost === 0, "no snow: the button is clean (no dress)", d);
  // the wait and Ångra: frost + rim flakes step back, the beanie and its flakes stay (A37: the hat stays over the ring)
  await force(page, { season: "winter", wx: "snow", snow: "frost+beanie" }); await rest(page); await wait(page, 300);
  await page.click("#btn-beer"); await wait(page, 1600);
  d = await dress(page); const cls = await page.evaluate(() => document.getElementById("btn-beer").className);
  ok(/undo/.test(cls) && d.frost === 0 && d.flRim === 0 && d.beanie === 1 && d.flHat === 1, "Ångra: no frost and no rim flakes on the 10 s ring; the beanie stays", { cls, d });
  await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = Date.now() - (window.U.COOLDOWN_MS - 300000); localStorage.setItem("olnu.night", JSON.stringify(m)); try { PN.s.meState && (PN.s.meState.undo_until = null); } catch (e) {} PN.tickCooldown(); });
  await wait(page, 13000);
  d = await dress(page); const w2 = await page.evaluate(() => ({ cls: document.getElementById("btn-beer").className, label: document.getElementById("beer-label").textContent }));
  ok(/cooldown/.test(w2.cls) && !/undo/.test(w2.cls) && d.frost === 0 && d.flRim === 0 && d.beanie === 1, "the wait (" + w2.label + "): no frost on the ring; the beanie stays", { w2, d });
  await rest(page); await wait(page, 300); d = await dress(page);
  ok(d.frost === 1 && d.flRim === 1, "back at rest: the frost and the rim flakes come back", d);
  ok(errs.length === 0, "i144: no page error", errs);
  await ctx.close();
}

// the computed look of the button at rest (LÄSK! compares a normal day with a GLÖGG day)
const look = (page) => page.evaluate(() => { const b = document.getElementById("btn-beer"), l = document.getElementById("beer-label"), cb = getComputedStyle(b), cl = getComputedStyle(l);
  const m = b.querySelector(".ss-mug"); return { text: l.textContent, bg: cb.backgroundImage + "|" + cb.backgroundColor, ink: cl.color, fs: cl.fontSize, pt: cl.paddingTop, mug: !!m && getComputedStyle(m).display !== "none" && !m.hidden }; });
async function a2(b) {
  const { ctx, page, errs } = await open(b);
  for (const [iso, word] of [["2026-11-30T23:30", "ÖL!"], ["2026-12-01T00:30", "GLÖGG"], ["2026-12-26T23:30", "GLÖGG"], ["2026-12-27T00:30", "ÖL!"]]) {
    await force(page, { date: iso, wx: "none", snow: "" }); await rest(page); await wait(page, 200);
    const l = await look(page);
    ok(l.text === word && l.mug === (word === "GLÖGG"), `${iso}: the button says ${word}${word === "GLÖGG" ? " with the mug" : ""}`, l);
  }
  // LÄSK! ("Jag kör ikväll"): the same soda can on a normal day and on a GLÖGG day; no glögg mug on the driver's button
  await page.evaluate(() => { window.__drv = SKJUTS.driving; SKJUTS.driving = () => true; });
  await force(page, { season: "normal", wx: "none", snow: "" }); await page.evaluate(() => LASK.sync()); await wait(page, 300);
  const n = await look(page);
  await force(page, { season: "xmas", wx: "none", snow: "" }); await page.evaluate(() => LASK.sync()); await wait(page, 300);
  const x = await look(page);
  ok(n.text === "LÄSK!" && x.text === "LÄSK!" && !x.mug, "Christmas + Jag kör ikväll: LÄSK!, no glögg mug", { n, x });
  ok(x.fs === n.fs && x.pt === n.pt, "Christmas LÄSK!: the label keeps the LÄSK! size (was the GLÖGG size + 22 px top padding)", { n, x });
  ok(x.bg === n.bg && x.ink === n.ink, "A3: the Christmas colour does not paint over LÄSK! (soda can, as on a normal day)", { n: n.bg.slice(0, 160), x: x.bg.slice(0, 160), ni: n.ink, xi: x.ink });
  for (const season of ["newyear", "valborg", "midsummer", "autumn"]) {
    await force(page, { season, wx: "none", snow: "" }); await page.evaluate(() => LASK.sync()); await wait(page, 200);
    const s = await look(page); ok(s.bg === n.bg && s.text === "LÄSK!", `A3 ${season}: LÄSK! keeps the soda look`, s.bg.slice(0, 160));
  }
  await page.evaluate(() => { SKJUTS.driving = window.__drv; LASK.sync(); }); await wait(page, 200);
  await force(page, { season: "xmas", wx: "none", snow: "" }); await rest(page);
  const back = await look(page); ok(back.text === "GLÖGG" && back.mug, "driving off: GLÖGG and the mug come back", back);
  ok(errs.length === 0, "a2: no page error", errs);
  await ctx.close();
}

// A3 contrast on the real pixels: the label colour against the button pixels right under each glyph pixel (two shots: with
// and without the text; the hats, the mug and the sub line hidden). 5th percentile >= 4.5:1 and no glyph pixel under 3:1.
async function a3(b) {
  const { ctx, page, errs } = await open(b);
  for (const season of ["normal", "xmas", "newyear", "valborg", "midsummer", "autumn"]) {
    await force(page, { season, wx: "none", snow: "" }); await rest(page); await wait(page, 250);
    const g = await page.evaluate(() => { const l = document.getElementById("beer-label"), rg = document.createRange(); rg.selectNodeContents(l); const q = rg.getBoundingClientRect();
      return { text: l.textContent, ink: getComputedStyle(l).color, r: { x: q.left, y: q.top, width: q.width, height: q.height }, cls: document.body.className.match(/ss-c-\w+/) }; });
    const shot = async (hide) => { const t = await page.addStyleTag({ content: (hide ? "#btn-beer#btn-beer #beer-label#beer-label{color:transparent !important;text-shadow:none !important} " : "") +
      "#btn-beer .ss-mug,.ss-dress,#beer-sub{visibility:hidden !important}" }); await wait(page, 100); const p = await page.screenshot({ clip: g.r }); await t.evaluate((n) => n.remove()); return p.toString("base64"); };
    const withText = await shot(false), bare = await shot(true);
    // the glyph pixels = where the text changes the picture; their background = the same pixel without the text
    const res = await page.evaluate(async ([t64, b64, ink]) => {
      const px = async (s) => { const img = new Image(); img.src = "data:image/png;base64," + s; await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const T = await px(t64), d = await px(b64), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const Lm = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), m = /(\d+)\D+(\d+)\D+(\d+)/.exec(ink), Li = Lm(+m[1], +m[2], +m[3]);
      const cr = []; for (let i = 0; i < d.length; i += 4) { if (Math.abs(T[i] - d[i]) + Math.abs(T[i + 1] - d[i + 1]) + Math.abs(T[i + 2] - d[i + 2]) < 60) continue;
        const L = Lm(d[i], d[i + 1], d[i + 2]); cr.push((Math.max(L, Li) + 0.05) / (Math.min(L, Li) + 0.05)); }
      cr.sort((a, b) => a - b); return { p5: +cr[Math.floor(cr.length * 0.05)].toFixed(2), min: +cr[0].toFixed(2), n: cr.length };
    }, [withText, bare, g.ink]);
    ok(res.n > 200 && res.p5 >= 4.5 && res.min >= 3, `A3 ${season} (${g.text}): label contrast on the real button pixels under the glyphs ${res.p5}:1 (5th percentile; min ${res.min})`, { g, res });
  }
  ok(errs.length === 0, "a3: no page error", errs);
  await ctx.close();
}

async function a18(b) {
  const { ctx, page, errs } = await open(b);
  const r = await page.evaluate(() => {
    const box = document.createElement("div"); box.style.cssText = "position:fixed;left:0;top:0;z-index:99999;color:#f5a623"; document.body.appendChild(box);
    const out = [];
    for (const size of [16, 20, 24, 32, 48]) for (const i of [0, 1, 2, 3, 4, 5]) {
      box.innerHTML = RANKICO.svg(i, size); const s = box.firstChild, crest = [...s.children].filter((e) => e.getBBox().y < 11);
      let x0 = 99, y0 = 99, x1 = -1, y1 = -1; crest.forEach((e) => { const q = e.getBBox(); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.width); y1 = Math.max(y1, q.y + q.height); });
      const skirt = crest[crest.length - 1], subs = ((skirt && skirt.getAttribute("d")) || "").match(/M/g) || [];
      out.push({ size, i, w: +(x1 - x0).toFixed(1), h: +(y1 - y0).toFixed(1), paths: crest.length, subs: subs.length, px: s.getBoundingClientRect().width });
    }
    box.remove(); return out;
  });
  ok(r.every((x) => x.paths === 2 && x.subs === 1), "A18 ranks 1-6: the cap = a top disc + ONE joined skirt outline (the old cap had 6 loose crimp pieces = rays)", r.filter((x) => !(x.paths === 2 && x.subs === 1)).slice(0, 3));
  ok(r.every((x) => x.w / x.h >= 1.25 && x.h >= 8 && Math.abs(x.px - x.size) < 0.5), "A18: wider than high (a cap from the side, not a round sun) at 16, 20, 24, 32 and 48 px", r.slice(0, 2));
  ok(errs.length === 0, "a18: no page error", errs);
  await ctx.close();
}

async function store(b) {
  const { ctx, page, errs } = await open(b, { store: true, reduced: true });
  await force(page, { season: "winter", wx: "snow", snow: "frost+beanie" }); await rest(page); await wait(page, 300);
  const d = await dress(page), st = await page.evaluate(() => !!window.OLNU_STORE);
  ok(st && d.shown && d.frost === 1 && d.beanie === 1, "store build: the snow look shows (no drinking celebration in it)", { st, d });
  await page.click("#btn-beer"); await wait(page, 300);
  const a = await page.evaluate(() => ({ hop: document.querySelector(".ss-dress").classList.contains("ss-hop"), anims: document.querySelector(".ss-dress").getAnimations({ subtree: true }).length }));
  ok(!a.hop && a.anims === 0, "store + reduced motion: nothing in the dress moves after the tap", a);
  ok(errs.length === 0, "store: no page error", errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch(launchOpts());
  try {
    if (ONLY.test("i144")) await i144(b);
    if (ONLY.test("a2")) await a2(b);
    if (ONLY.test("a3")) await a3(b);
    if (ONLY.test("a18")) await a18(b);
    if (ONLY.test("store")) await store(b);
  } catch (e) { console.log("FAIL crash " + (e && e.stack || e)); fail++; }
  await b.close();
  console.log(`olbtn: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
