// Lane uifix3: I-123 (the character creator on an iPhone) + I-125 (the Annat button). node avwiz-ios-pw.js <port> [wk] [part,part]
// wk = WebKit (the iPhone engine; CI shard ui-ios). parts: av, annat (default both). Mocked Supabase (ds-helpers), iOS UA.
// I-123 at 390x844 and 360x640, step "Hår" (the owner's picture), list scrolled:
//   1. nothing above the sticky top: it sticks at the very top of the scroll area, no tile shows above it
//   2. at least 2 full tile rows fit between the sticky top and the bar; the list fades under the top (sheetfade head) and
//      above the bar (sheetfade foot = the bar)
//   3. the bar sits at the very bottom of the sheet; under the buttons only the bar's own 8 px + the safe area
//      (Playwright has no real safe area: --sab is set to 0 and to 34 px, the iPhone inset; the sheet and the bar both use it)
//   4. the tab strip fades on the side that has more tabs (right at the start, left at the end)
// I-125: Annat at rest looks like the other round buttons (locate): same glass, same thin neutral edge, same shadow; lilac only
//   on the glyph; waiting = lilac m:ss + the lilac ring.
const fs = require("fs");
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const WK = process.argv[3] === "wk";
const PARTS = (process.argv[4] || "av,annat").split(",");
const SP = require("./env.js").OUT + "logs/avwiz-ios-shots/";
fs.mkdirSync(SP, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };
const SPEC = { v: 2, sk: 11, fs: 2, ey: 0, br: 6, mt: 0, hr: 2, hc: 1, fh: 1, hw: 1, gl: 1, up: 1, uc: 0, bg: 0, ns: 4, ms: 1 };
const J = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// geometry of the open creator (in the page)
const geo = () => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height }; };
  const body = document.getElementById("sheet-body"), sheet = document.getElementById("sheet"), top = body.querySelector(".avw-top"), bar = body.querySelector(".avw-bar");
  const tiles = [...body.querySelectorAll(".avw-pane .avw-grid:not(.avw-grid-lock) .avw-tile")].map(R);
  const rows = [...new Set(tiles.map((t) => Math.round(t.t)))].sort((a, b) => a - b);
  const btns = [...bar.querySelectorAll(".btn")].filter((b) => !b.hidden && b.offsetHeight).map(R);
  const bt = R(body), tp = R(top);
  const above = tiles.filter((t) => Math.min(t.b, tp.t) - Math.max(t.t, bt.t) > 0.5).length;   // tiles with pixels between the top of the scroll area and the sticky top
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sab")) || 0;
  return { vh: innerHeight, sheet: R(sheet), body: bt, top: tp, bar: R(bar), tileH: tiles.length ? tiles[0].h : 0, rowGap: rows.length > 1 ? rows[1] - rows[0] - tiles[0].h : 0,
    above, btnB: Math.max.apply(null, btns.map((b) => b.b)), sab, sf: window.SHEETFADE ? window.SHEETFADE._state(body) : null, scrollTop: body.scrollTop };
};
const quickState = () => {
  const q = document.querySelector("#sheet-body .avw-quick"), cs = getComputedStyle(q), m = cs.webkitMaskImage || cs.maskImage || "";
  return { l: q.classList.contains("avw-q-l"), r: q.classList.contains("avw-q-r"), mask: m, sw: q.scrollWidth, cw: q.clientWidth, x: Math.round(q.scrollLeft) };
};

async function creator(browser, vw, vh) {
  const { ctx, page } = await ctxFor(browser, { width: vw, height: vh }, { ua: "ios" });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar)\b/, (r) => J(r, /set_my/.test(r.request().url()) ? {} : { v: 1, spec: SPEC, seed: "5e3a91c2", facts: { r: 8, m: [] } }));
  await boot(page);
  await page.evaluate(() => window.AVATAR && window.AVATAR.loadMe && window.AVATAR.loadMe(true)); await wait(page, 800);
  await page.evaluate(() => window.AVWIZ.open()); await wait(page, 1500);
  const steps = await page.evaluate(() => window.AVWIZ._steps.map((s) => s.k || s.id));
  await page.evaluate((i) => document.querySelector(`#sheet-body .avw-quick [data-i="${i}"]`).click(), steps.indexOf("hr")); await wait(page, 800);
  return { ctx, page, errs, steps };
}

(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  if (PARTS.includes("av")) for (const [vw, vh] of [[390, 844], [360, 640]]) {
    const T = `${vw}x${vh}:`;
    const { ctx, page, errs, steps } = await creator(browser, vw, vh);
    // 4. the tab strip (at "Hår" = the 2nd tab: more tabs to the right)
    const q0 = await page.evaluate(quickState);
    ok(T + " 4. tab strip at the start: a fade on the RIGHT edge only (more tabs there)", q0.sw > q0.cw && q0.r && !q0.l && /gradient/.test(q0.mask), q0);
    await page.evaluate(() => { const q = document.querySelector("#sheet-body .avw-quick"); q.scrollLeft = q.scrollWidth; }); await wait(page, 300);
    const q1 = await page.evaluate(quickState);
    ok(T + " 4. tab strip at the end: a fade on the LEFT edge only", q1.l && !q1.r && /gradient/.test(q1.mask), q1);
    await page.evaluate(() => { const q = document.querySelector("#sheet-body .avw-quick"); q.scrollLeft = 0; }); await wait(page, 200);
    // 1 + 2: scroll the list well past the top
    await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 300; }); await wait(page, 600);
    const g = await page.evaluate(geo);
    ok(T + " 1. the sticky top sticks at the very top of the scroll area (≤ 1 px gap) and no tile shows above it", g.scrollTop > 100 && g.top.t - g.body.t <= 1 && g.above === 0,
      { gap: Math.round(g.top.t - g.body.t), above: g.above, scrollTop: g.scrollTop });
    const win = g.bar.t - g.top.b, need = 2 * g.tileH + g.rowGap;
    ok(T + " 2. at least 2 full tile rows fit between the sticky top and the bar", g.tileH > 40 && win >= need, { window: Math.round(win), need: Math.round(need), tileH: Math.round(g.tileH), top: Math.round(g.top.h) });
    const headPx = parseFloat(g.sf && g.sf.head) || 0, footPx = parseFloat(g.sf && g.sf.foot) || 0;
    ok(T + " 2. soft fade: the list fades under the sticky top (sheetfade head = the top) and above the bar (foot = the bar)",
      g.sf && g.sf.top && g.sf.bot && Math.abs(headPx - (g.top.b - g.body.t)) <= 2 && Math.abs(footPx - (g.body.b - g.bar.t)) <= 2, { sf: g.sf, top: Math.round(g.top.b - g.body.t), bar: Math.round(g.body.b - g.bar.t) });
    await page.screenshot({ path: SP + (WK ? "wk-" : "") + `avwiz-${vw}x${vh}-scrolled.png` });
    // 3. the bar: at the very bottom of the sheet, only the safe area under the buttons (with no inset and with the iPhone's 34 px)
    for (const sab of [0, 34]) {
      await page.evaluate((v) => document.documentElement.style.setProperty("--sab", v + "px"), sab); await wait(page, 400);
      const b = await page.evaluate(geo);
      const under = b.vh - b.btnB - b.sab;
      ok(T + ` 3. safe area ${sab}: the bar sits at the bottom of the sheet (≤ 1 px), under the buttons only 8 px + the safe area (≤ 24)`,
        Math.abs(b.sheet.b - b.vh) <= 1 && Math.abs(b.sheet.b - b.bar.b) <= 1 && under <= 24 && under >= 0, { sheetB: Math.round(b.sheet.b), barB: Math.round(b.bar.b), under: Math.round(under), sab: b.sab });
    }
    await page.evaluate(() => document.documentElement.style.removeProperty("--sab"));
    // the first step (no preview): the text row is centred, the strip is hidden, nothing breaks
    await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; document.querySelector("#sheet-body .avw-quick [data-i='1']").click(); }); await wait(page, 400);
    await page.evaluate(() => document.querySelector("#sheet-body .avw-back").click()); await wait(page, 600);
    const s0 = await page.evaluate(() => { const t = document.querySelector("#sheet-body .avw-t"), r = t.getBoundingClientRect(); return { t: t.textContent, mid: (r.left + r.right) / 2, vw: innerWidth, bases: document.querySelectorAll(".avw-base").length }; });
    ok(T + " start step: title centred, 3 starts", s0.bases === 3 && Math.abs(s0.mid - s0.vw / 2) <= 12, s0);
    if (vw === 390) await page.screenshot({ path: SP + (WK ? "wk-" : "") + `avwiz-${vw}x${vh}-start.png` });
    ok(T + " no page errors", !errs.length, errs.slice(0, 2));
    await ctx.close();
  }

  if (PARTS.includes("annat")) {
    const look = () => {
      const b = document.getElementById("btn-other"), l = document.getElementById("btn-locate"), cb = getComputedStyle(b), cl = getComputedStyle(l);
      const e = b.querySelector(".ol-e"), t = b.querySelector(".ol-t"), tr = document.querySelector("#other-wrap .ocd-track");
      return { bw: parseFloat(cb.borderTopWidth), bc: cb.borderTopColor, bg: cb.backgroundColor, sh: cb.boxShadow, lw: parseFloat(cl.borderTopWidth), lc: cl.borderTopColor, lbg: cl.backgroundColor, lsh: cl.boxShadow,
        glyph: e ? getComputedStyle(e).color : "", text: t ? t.textContent : "", tcol: t ? getComputedStyle(t).color : "", track: tr ? getComputedStyle(tr).stroke : "", filter: cb.filter, cls: b.className,
        ring: document.getElementById("ocd-ring").style.strokeDashoffset };
    };
    const lilac = (c) => { const m = String(c).match(/[\d.]+/g); return !!m && +m[0] > 190 && +m[1] > 160 && +m[2] > 230 && +m[2] - +m[1] > 30; };
    // at rest
    let { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
    await boot(page); await wait(page, 600);
    const a = await page.evaluate(look);
    ok("I-125 rest: Annat has the same thin neutral edge as the locate button (no lilac ring)", a.bw <= 1 && a.bw === a.lw && a.bc === a.lc && !lilac(a.bc), a);
    ok("I-125 rest: the same dark glass and the same shadow as the locate button", a.bg === a.lbg && a.sh === a.lsh, { bg: a.bg, lbg: a.lbg, sh: a.sh, lsh: a.lsh });
    ok("I-125 rest: lilac only on the glyph (the word is the normal text colour), no track ring", lilac(a.glyph) && !lilac(a.tcol) && /^Annat$/i.test(a.text) && /transparent|rgba\(0, 0, 0, 0\)|none/.test(a.track), { glyph: a.glyph, tcol: a.tcol, track: a.track });
    await page.screenshot({ path: SP + (WK ? "wk-" : "") + "annat-rest.png", clip: { x: 0, y: 560, width: 390, height: 284 } });
    await ctx.close();
    // waiting
    ({ ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" }));
    await ctx.addInitScript(() => { try { localStorage.setItem("olnu.otherCd", String(Date.now() + 6 * 60000 + 30000)); } catch (e) {} });
    await boot(page); await wait(page, 1200);
    const w = await page.evaluate(look);
    ok("I-125 waiting: m:ss in lilac, not dimmed, the lilac track + ring show, the edge stays neutral", /cooldown/.test(w.cls) && /^\d+:\d\d$/.test(w.text) && lilac(w.tcol) && (w.filter === "none" || !w.filter) && !/transparent|rgba\(0, 0, 0, 0\)/.test(w.track) && w.bw <= 1 && !lilac(w.bc), w);
    await page.screenshot({ path: SP + (WK ? "wk-" : "") + "annat-wait.png", clip: { x: 0, y: 560, width: 390, height: 284 } });
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
