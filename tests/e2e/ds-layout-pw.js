// Main-screen geometry rules (coordinator measure 2026-11-07). node ds-layout-pw.js <port> [wk]
// 360 / 390 / 430 px, iOS UA, with the KAOS banner, the install banner and the care chip visible; and once with the ticker
// (no KAOS). Rules: no overlaps between HUD controls / banners / ticker / rail; top row one height; one 12 px edge;
// equal dock side boxes; ÖL! centre = viewport centre ±1; ANNAT centred above Grupper; every tap target ≥ 44;
// nested radius (inner ≤ outer − inset, or round).
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const WK = process.argv[3] === "wk";
const SP = require("./env.js").OUT + "ds-shots/test/";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const measure = (page) => page.evaluate(() => {
  const vis = (e) => { if (!e || e.hidden || !e.getClientRects().length) return false; const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.05; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const one = (s) => { const e = document.querySelector(s); return vis(e) ? R(e) : null; };
  const vw = innerWidth, vh = innerHeight;
  // things that float over the map at the top; none may overlap another
  const items = {};
  [["ticker", ".ticker"], ["chaos", "#chaos"], ["rally", "#rally"], ["more", "#btn-more"], ["ghost", "#pn-ghost"], ["evs", "#pn-evs"], ["install", "#install-banner"],
   ["topbar", ".topbar"], ["caption", "#dl-cap"]].forEach(([k, s]) => { const r = one(s); if (r) items[k] = r; });
  document.querySelectorAll(".hud-left > *, .hud-x > *").forEach((e, i) => { if (vis(e) && !e.classList.contains("hud-x")) items["hud" + i] = R(e); });
  document.querySelectorAll("#toasts .toast").forEach((e, i) => { if (vis(e)) items["toast" + i] = R(e); });
  const over = [];
  const ks = Object.keys(items);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = items[ks[i]], b = items[ks[j]];
    if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) over.push(ks[i] + "×" + ks[j]);
  }
  const top = ["#live-count", "#btn-top", "#btn-settings"].map((s) => one(s)).filter(Boolean).map((r) => Math.round(r.h));
  // one edge: left and right gaps of edge-to-edge things
  const edges = {};
  [["topbar-first", ".topbar > .brand", "l"], ["topbar-last", "#btn-settings", "r"], ["ticker", ".ticker", "lr"], ["chaos", "#chaos", "lr"], ["install", "#install-banner", "l"],
   ["hud", ".hud-left", "l"], ["more", "#btn-more", "r"], ["ghost", "#pn-ghost", "r"], ["evs", "#pn-evs", "r"], ["locate", "#btn-locate", "r"], ["groups", "#btn-groups", "l"], ["prec", "#prec-seg", "r"]].forEach(([k, s, side]) => {
    const r = one(s); if (!r) return;
    if (side.includes("l")) edges[k + ".L"] = Math.round(r.l);
    if (side.includes("r")) edges[k + ".R"] = Math.round(vw - r.r);
  });
  const g = one("#btn-groups"), p = one("#prec-seg"), beer = one("#btn-beer"), ow = one(".other-wrap"), ob = one("#btn-other");
  // tap targets
  const small = [];
  document.querySelectorAll(".topbar button, .hud-left button, #btn-more, #btn-locate, .pn-rail, .ticker button, #chaos button, #rally button, #install-banner button, .dock button, #btn-attrib").forEach((e) => {
    if (!vis(e)) return; const r = R(e); if (r.w < 43.5 || r.h < 43.5) small.push((e.id || e.className || e.tagName).toString().slice(0, 24) + " " + Math.round(r.w) + "×" + Math.round(r.h)); });
  // nested radius inside rounded boxes
  const nest = [];
  document.querySelectorAll("#install-banner button, .hud-left button").forEach((e) => {
    if (!vis(e)) return; const box = e.closest("#install-banner") || e; if (box === e) return;
    const br = R(box), er = R(e), outer = parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0, inner = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
    const inset = Math.min(er.t - br.t, br.r - er.r);
    const round = inner >= er.h / 2 - 0.5;
    if (!round && inner > Math.max(0, outer - inset) + 1) nest.push([e.id || e.className, inner, outer, Math.round(inset)]);
  });
  const chaosClip = (() => { const c = document.getElementById("chaos"); return vis(c) ? getComputedStyle(c).overflow : null; })();
  const care = [...document.querySelectorAll(".af-chip-med")].filter(vis).map((e) => e.textContent.trim());
  // bottom: locate above the dock on the right; map credits bottom-left; none of the bottom things overlap
  const dock = one(".dock-row"), loc = one("#btn-locate"), at = one("#btn-attrib"), logo = one(".bm-mblogo"), bw = one(".beer-wrap");
  const bot = { loc, at, logo, ow: one(".other-wrap"), g: one("#btn-groups"), p: one("#prec-seg"), beer: one("#btn-beer") }, bover = [];
  const bk = Object.keys(bot).filter((k) => bot[k]);
  const pair = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  for (let i = 0; i < bk.length; i++) for (let j = i + 1; j < bk.length; j++) { const A = bk[i], B = bk[j];
    if ([A, B].includes("ow") && [A, B].includes("beer")) continue;   // two circles: checked by centre distance below
    if (pair(bot[A], bot[B])) bover.push(A + "×" + B); }
  const kaos = (() => { const t = document.querySelector(".ticker"); return { on: !!(t && t.classList.contains("pn-kaos")), box: vis(document.getElementById("chaos")), txt: ((t && t.querySelector(".pn-kaos-line")) || {}).textContent || "" }; })();
  return { vw, vh, over, dock, bw, bot, bover, kaos, top, edges, g, p, beer, ow, ob, small, nest, chaosClip, care, items: Object.keys(items) };
});
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  for (const w of [360, 390, 430]) for (const mode of ["kaos", "ticker"]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: w === 360 ? 780 : 844 }, { ua: "ios" });
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await boot(page); await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
    if (mode === "ticker") { await page.evaluate(() => { const c = document.getElementById("chaos-close"); if (c && !document.getElementById("chaos").hidden) c.click(); const b = document.getElementById("install-close"); if (b && !document.getElementById("install-banner").hidden) b.click(); }); }
    await wait(page, 700);
    const m = await measure(page);
    const tag = w + " " + mode + ":";
    if (mode === "kaos") ok(m.kaos.on && !m.kaos.box && /\S/.test(m.kaos.txt) && m.items.includes("install") && m.care.length, tag + " KAOS is shown INSIDE the ticker (no separate box) + install banner + care chip on screen", [m.kaos, m.items]);
    ok(m.items.includes("ghost") && m.items.includes("more"), tag + " right rail: Spökläge + (Event) + ⋯ Mer", m.items);
    ok(m.bot.loc && m.p && Math.abs(m.p.t - m.bot.loc.b - 12) <= 1 && Math.abs(m.bot.loc.r - m.p.r) <= 1 && Math.abs(m.vw - m.bot.loc.r - 12) <= 1, tag + " locate: bottom right, 12 px above the dock's right box", [m.bot.loc, m.p]);
    { const oc = m.bot.ow && [m.bot.ow.l + m.bot.ow.w / 2, m.bot.ow.t + m.bot.ow.h / 2], bc = m.bw && [m.bw.l + m.bw.w / 2, m.bw.t + m.bw.h / 2];
      const dist = oc && bc ? Math.hypot(oc[0] - bc[0], oc[1] - bc[1]) : 0, need = m.bw ? m.bw.w / 2 + 8 + m.bot.ow.w / 2 - 1 : 0;
      const g = m.g, ow = m.bot.ow; let gap = 99;
      if (g && ow) { const nx = Math.max(g.l, Math.min(oc[0], g.r)), ny = Math.max(g.t, Math.min(oc[1], g.b)); gap = Math.hypot(oc[0] - nx, oc[1] - ny) - ow.w / 2; }
      ok(oc && bc && oc[0] < bc[0] && oc[1] < bc[1] && dist >= need && dist <= need + 6 && ow.w >= 44 && gap >= 7.5, tag + " ANNAT up-LEFT of ÖL!: 8 px outside the ring, never on it, ≥ 44 px, ≥ 8 px clear of Grupper", { dist: Math.round(dist), need: Math.round(need), gap: Math.round(gap), ow }); }
    ok(!m.bover.length, tag + " bottom: locate, credits, ANNAT, Grupper, precision, ÖL! do not overlap", m.bover);
    ok(m.bot.at && m.dock && m.bot.at.l <= m.vw / 2 && Math.abs(m.dock.t - m.bot.at.b - 12) <= 1 && (!m.bot.logo || (m.bot.logo.l <= 13 && Math.abs((m.bot.logo.t + m.bot.logo.b) / 2 - (m.bot.at.t + m.bot.at.b) / 2) <= 2)), tag + " map credits: Mapbox wordmark + ⓘ one unit, bottom-left, 12 px over the dock", [m.bot.at, m.bot.logo, m.dock && m.dock.t]);
    ok(!m.over.length, tag + " no overlaps (ticker, KAOS, HUD row, ⋯, locate, banners, toasts, caption)", m.over);
    ok(m.top.length === 3 && m.top.every((h) => h === 44), tag + " top row: pill and both buttons 44 px", m.top);
    const ev = Object.values(m.edges);
    ok(ev.length >= 6 && ev.every((v) => Math.abs(v - 12) <= 1), tag + " one 12 px screen edge, left and right", m.edges);
    ok(m.g && m.p && Math.abs(m.g.w - m.p.w) < 0.5 && Math.abs(m.g.h - m.p.h) < 0.5 && Math.abs(m.g.t - m.p.t) < 0.5, tag + " dock side boxes are the same box", [m.g, m.p]);
    ok(m.beer && Math.abs(m.beer.l + m.beer.w / 2 - m.vw / 2) <= 1, tag + " ÖL! centre = viewport centre ±1", m.beer && m.beer.l + m.beer.w / 2);
    ok(!m.small.length, tag + " every tap target ≥ 44 × 44", m.small);
    ok(!m.nest.length, tag + " nested radius: inner ≤ outer − inset (or round)", m.nest);
    if (mode === "kaos") { ok(m.care.every((t) => /^Kolla till \S/.test(t)), tag + " care chip says 'Kolla till <namn>'", m.care); }
    if (w === 390) await page.screenshot({ path: SP + (WK ? "wk-" : "") + "layout-" + mode + "-390.png" });
    ok(!errs.length, tag + " no page errors", errs.slice(0, 2));
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
