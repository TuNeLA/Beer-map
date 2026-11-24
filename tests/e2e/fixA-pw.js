// fixA-pw.js — lane fixA (polish sweep A · map HUD, 24 Nov 2026). 390 × 844 and 360 × 740 @2x, mocked Supabase, raster map.
// usage: node fixA-pw.js <port>
//  P-03 bar marks: the friends' totals are INSIDE the people pill (one pill per bar), the crowd word is a pill (radius) and is
//       placed LAST (a crowd word never covers another bar's pill / name / totals), a long bar name wraps (no "…").
//  P-04 top area: KAOS is amber (not the danger red); "Dagens order" does not show while the care chip "Kolla till X" shows.
//  P-23 header at 360 px: the word "ute" always stays ("Ludvika · 12" was unclear); KAOS text may use 2 lines.
//  P-05 privacy words: the rail button is an eye (never the people icon); one word set Alla / Vänner / Spöke; the "Exakt
//       plats" button's accessible name = its visible words + state.
//  P-27 toasts: A.toast(msg, { ok: true }) = check icon (done lines: "Ölen togs bort.", "Sparad som favorit nr N.").
//  P-28 header: Topplistor and Profil use ONE active look (amber ring), not a filled tile on one and a ring on the other.
// Old code (big-update b146482): every part FAILS at least one check.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8831, BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); };

async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp || { width: 390, height: 844 }, o);
  if (o.rail) await ctx.addInitScript(() => { try { localStorage.setItem("olnu.railNights", "[]"); } catch (e) {} });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  return { ctx, page, errs };
}
// every visible part of every bar marker, in screen px
const PARTS = () => {
  const vis = (e) => { if (!e) return null; const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return null;
    const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  return [...document.querySelectorAll(".leaflet-marker-icon.cm")].filter((ic) => !ic.classList.contains("cm-dot")).map((ic, i) => ({
    i, name: (ic.querySelector(".cm-lbl") || {}).textContent || "",
    disc: vis(ic.querySelector(".bar-ico")), pill: vis(ic.querySelector(".pill")), pft: vis(ic.querySelector(".pft")),
    crowd: vis(ic.querySelector(".bm-crowd")), lbl: vis(ic.querySelector(".cm-lbl")) }));
};
const hit = (a, b) => a && b && a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
function overlaps(ms) {
  const out = [];
  ms.forEach((a) => ms.forEach((b) => {
    if (a === b) return;
    ["crowd", "pft", "lbl"].forEach((k) => ["disc", "pill", "pft", "crowd", "lbl"].forEach((q) => { if (hit(a[k], b[q])) out.push(a.name.slice(0, 14) + "." + k + " x " + b.name.slice(0, 14) + "." + q); }));
  }));
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  try {
    // ---------- P-03 ----------
    let { ctx, page, errs } = await open(browser);
    for (const z of [16, 17]) {
      await page.evaluate((zz) => { __map.closePopup(); __map.setView([60.15, 15.1868], zz, { animate: false }); }, z);
      await wait(page, 1600);
      const ms = await page.evaluate(PARTS);
      const withFt = ms.filter((m) => m.pft && m.pill);
      ok(`P-03 z${z}: the friends' totals sit inside the people pill (one pill per bar)`, withFt.length > 0 && withFt.every((m) => m.pft.l >= m.pill.l - 1 && m.pft.r <= m.pill.r + 1 && m.pft.t >= m.pill.t - 1 && m.pft.b <= m.pill.b + 1), withFt);
      const ov = overlaps(ms);
      ok(`P-03 z${z}: no crowd word, totals chip or name sits on another bar's marks`, ov.length === 0, ov);
    }
    const cr = await page.evaluate(() => { const c = document.querySelector(".cm .bm-crowd"); return c ? parseFloat(getComputedStyle(c).borderTopLeftRadius) : -1; });
    ok("P-03 the crowd word is a pill (round ends, not a square box)", cr >= 8, cr);
    await page.evaluate(() => { __map.closePopup(); __map.setView([60.1505, 15.1866], 17, { animate: false }); });
    await wait(page, 1600);
    const lb = await page.evaluate(() => { const l = [...document.querySelectorAll(".cm-lbl")].find((x) => /Lobbybaren/.test(x.textContent)); if (!l) return null;
      const s = getComputedStyle(l); return { cut: l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1, h: l.getBoundingClientRect().height, lh: parseFloat(s.lineHeight), ov: s.textOverflow, shown: s.display !== "none" }; });
    ok("P-03 a long bar name wraps to 2 lines (no '…')", !!lb && lb.shown && !lb.cut && lb.h > lb.lh * 1.5, lb);

    await ctx.close();

    // the greeting card while the care chip shows (a fresh phone: the card comes once a day)
    ({ ctx, page, errs } = await open(browser));
    const g = await page.evaluate(async () => {
      const on = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
      const seen = [];
      for (let i = 0; i < 12; i++) { seen.push({ med: on(document.querySelector(".hud-left .af-chip-med")), greet: on(document.querySelector(".dl-cap-greet")) }); await new Promise((r) => setTimeout(r, 250)); }
      return seen;
    });
    ok("P-04 'Dagens order' never shows at the same time as the care chip 'Kolla till X'", g.some((x) => x.med) && !g.some((x) => x.med && x.greet), g);
    // ---------- P-04 + P-23 (KAOS) ----------
    await page.waitForFunction(() => document.querySelector(".ticker.pn-kaos") && !document.documentElement.classList.contains("pn-settle"), null, { timeout: 15000 }).catch(() => {});
    await wait(page, 400);
    const k = await page.evaluate(() => {
      const tk = document.querySelector(".ticker.pn-kaos"); if (!tk) return { none: 1, tk: (document.querySelector(".ticker") || {}).className, chaos: (document.getElementById("chaos") || {}).hidden, html: document.documentElement.className, z: __map.getZoom(), rally: (document.getElementById("rally") || {}).hidden };
      const probe = document.createElement("i"); probe.style.color = "var(--ds-red)"; document.body.appendChild(probe); const red = getComputedStyle(probe).color;
      probe.style.color = "var(--ds-amber)"; const amb = getComputedStyle(probe).color; probe.remove();
      const sp = tk.querySelector(".pn-kaos-line > span"), live = tk.querySelector(".tk-live");
      return { bg: getComputedStyle(tk).backgroundColor, red, amb, tag: getComputedStyle(live).backgroundColor, ws: sp && getComputedStyle(sp).whiteSpace };
    });
    ok("P-04 KAOS is not the danger red: dark bar, amber tag", !!k && !k.none && k.bg !== k.red && k.tag === k.amb, k);
    ok("P-23 the KAOS text may wrap (2 lines, not always cut at 1 line)", !!k && !k.none && k.ws !== "nowrap", k);
    await ctx.close();

    // ---------- P-23 header at 360 ----------
    ({ ctx, page, errs } = await open(browser, { width: 360, height: 740 }));
    const hp = await page.evaluate(() => { const n = document.querySelector(".zn-pn"); const p = n && n.parentElement; return p ? { txt: p.innerText.replace(/\s+/g, " ").trim(), cut: n.scrollWidth > n.clientWidth + 1 } : null; });
    ok("P-23 360 px header: the town name whole AND the word 'ute' stays", !!hp && /\bute\b/.test(hp.txt) && !hp.cut && /Ludvika/.test(hp.txt), hp);
    await ctx.close();

    // ---------- P-05 ----------
    ({ ctx, page, errs } = await open(browser, null, { rail: true }));
    const v = await page.evaluate(async () => {
      const out = {};
      const g = document.getElementById("pn-ghost");
      for (const m of ["vanner", "alla", "spoke"]) {
        window.PNVIS.setMode(m); await new Promise((r) => setTimeout(r, 120));
        out[m] = { eye: !!g.querySelector(".pi-eye"), off: !!g.querySelector(".pi-eye-off"), ppl: !!g.querySelector(".pi-users"), lbl: (g.querySelector(".mn-rail-l") || {}).textContent || "" };
      }
      window.PNVIS.setMode("alla");
      g.click(); await new Promise((r) => setTimeout(r, 400));
      out.seg = [...document.querySelectorAll(".pn-vis-seg [role=radio], .pn-vis-seg button")].map((b) => b.textContent.trim());
      document.body.click(); await new Promise((r) => setTimeout(r, 200));
      const ex = document.getElementById("prec-exact"), ar = document.getElementById("prec-area");
      out.prec = { ex: (ex.getAttribute("aria-label") || ex.textContent).trim(), ar: (ar.getAttribute("aria-label") || ar.textContent).trim() };
      return out;
    });
    ok("P-05 rail = an eye for Alla and Vänner, eye-off for Spöke, never the people icon", v.vanner.eye && !v.vanner.ppl && v.alla.eye && !v.alla.ppl && v.spoke.off && !v.spoke.ppl, v);
    ok("P-05 rail word says what it is: 'Syns: Vänner' / 'Syns: Alla' / 'Spöke'", v.vanner.lbl === "Syns: Vänner" && v.alla.lbl === "Syns: Alla" && v.spoke.lbl === "Spöke", v);
    ok("P-05 one word set in the menu: Alla · Vänner · Spöke", v.seg.join("|") === "Alla|Vänner|Spöke", v.seg);
    ok("P-05 'Exakt plats' button name = its words + state (no hidden 'Bara område')", /^Exakt plats: på$/i.test(v.prec.ex) && /^Exakt plats: av$/i.test(v.prec.ar), v.prec);
    const rl = await page.evaluate(() => { const l = document.querySelector("#pn-ghost .mn-rail-l"); const r = l && l.getBoundingClientRect(); return r ? { l: r.left, r: r.right, cut: l.scrollWidth > l.clientWidth + 1, W: innerWidth } : null; });
    ok("P-05 the rail word is whole and on screen", !!rl && !rl.cut && rl.l >= 0 && rl.r <= rl.W, rl);

    // ---------- P-27 ----------
    const t = await page.evaluate(async () => {
      const A = window.PNDS._A(); A.toast("Sparad som favorit nr 1.", { ok: true, urgent: true });
      await new Promise((r) => setTimeout(r, 400));
      const el = [...document.querySelectorAll(".toast")].find((x) => /favorit nr 1/.test(x.textContent));
      const src = await Promise.all(["js/app-beer.js", "js/beerlib.js"].map((f) => fetch(f).then((r) => r.text())));
      return { icon: el && el.querySelector(".pn-toast-i .pi") ? el.querySelector(".pn-toast-i .pi").getAttribute("class") : null,
        undo: /Ölen togs bort\.[^\n]*ok: true/.test(src[0]), fav: /Sparad som favorit nr[^\n]*\{ ok: true \}/.test(src[1]) };
    });
    ok("P-27 a done toast (ok: true) shows the check icon, not the info 'i'", !!t.icon && /pi-check/.test(t.icon), t);
    ok("P-27 'Ölen togs bort.' and 'Sparad som favorit nr N.' are done toasts", t.undo && t.fav, t);

    // ---------- P-28 ----------
    const h = await page.evaluate(async () => {
      const w = (ms) => new Promise((r) => setTimeout(r, ms));
      const S = (e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, sh: c.boxShadow, on: e.classList.contains("ic-on") }; };
      document.getElementById("btn-top").click(); await w(1500); const top = S(document.getElementById("btn-top"));
      document.getElementById("sheet-close").click(); await w(900);
      document.getElementById("btn-settings").click(); await w(1500); const me = S(document.getElementById("btn-settings"));
      document.getElementById("sheet-close").click(); await w(500);
      return { top, me };
    });
    ok("P-28 Topplistor and Profil have the same active look (amber ring on the dark button)", h.top.on && h.me.on && h.top.bg === h.me.bg && h.top.sh === h.me.sh && /inset/.test(h.top.sh) && !/245, 166, 35\)$/.test(h.top.bg), h);
    ok("no page errors", errs.length === 0, errs);
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
