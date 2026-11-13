// hotfix1-pw.js — lane hotfix1 (owner phone test 13 Nov 14:56, first fix after the release):
//   I-63 my dot: the blue ring (GL layer olnu-me-ring) is drawn ONLY when a bar / food icon covers or touches my dot;
//        away from the bars = the dot only (+ the accuracy circle). Checked in = no dot, the "Du" tag (unchanged).
//   I-64 avatar editor labels: "Form" → "Ansiktsform", "Överdel" → "Tröja & jacka" (editor tabs, headers, wizard chips);
//        the one tab row still fits / scrolls at 360 px (no sideways page overflow, every tab one line).
// Map part: real Mapbox when MAPBOX_TEST_TOKEN is set, else a STUB Mapbox (fake token, blank style) with the real GL bar layers.
// Usage: node hotfix1-pw.js <port> [only: regex of sections i63|i64]
const { H, TOKEN, launchOpts, closeCounted, SP } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793, ONLY = new RegExp(process.argv[3] || ".");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const wait = (p, ms) => p.waitForTimeout(ms);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
const PIT = "n3472634175";   // Pitchers, Ludvika
// away from every bar / food icon: a spot in the Väsman lake shore park west of the centre (checked on screen below)
const AWAY = [[60.1452, 15.1745], [60.1440, 15.1690], [60.1560, 15.1700], [60.1420, 15.2010]];

async function openMap(b, o = {}) {
  const proxy = { newContext: (opt) => b.newContext(opt) };
  const { ctx, page } = await H.ctxFor(proxy, { width: 412, height: 860 }, o.h || {});
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
  if (o.noMine) await page.route(/rest\/v1\/rpc\/live_checkins/, (r) => J(r, []));
  if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    } catch (e) { r.abort().catch(() => {}); }
  });
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
  const url = "https://tunela.github.io/Beer-map/";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(async () => { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); });
  await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox(), null, { timeout: 45000 }).catch(() => console.log("GL not on"));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  await page.evaluate(() => { window.__gm = () => BASEMAP.mapbox().getMapboxMap(); });
  return { ctx, page, errs };
}
async function idle(page, ms) {
  await page.waitForFunction(() => { const g = __gm(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  if (ms) await wait(page, ms);
}
// put me at ll (GLBARS.me = the hook app-map.js showMe() calls on each GPS fix), then the map on me at z (moveend)
async function meAt(page, ctx, ll, z) {
  await page.evaluate(([ll, z]) => { __map.closePopup(); GLBARS.me(ll[0], ll[1]); __map.setView(ll, z, { animate: false }); }, [ll, z]);
  await idle(page, 1200);
}
// what is drawn at my dot: dot / ring features, and the venue icons in a 13 px box around it (what the app tests)
const meState = (page) => page.evaluate(() => {
  const g = __gm(), me = GLBARS._me(), q = (l) => g.getLayer(l) ? g.queryRenderedFeatures({ layers: [l] }).length : -1;
  const p = me.ll ? g.project([me.ll[1], me.ll[0]]) : null, B = 13;
  const lays = GLBARS._layers().filter((l) => /^olnu-(bar-|place$)/.test(l) && l !== "olnu-bar-blk" && g.getLayer(l));
  const near = p ? g.queryRenderedFeatures([[p.x - B, p.y - B], [p.x + B, p.y + B]], { layers: lays }).map((f) => f.layer.id + ":" + (f.properties.id || "")) : null;
  return { ll: me.ll, cov: me.cov, nDot: q("olnu-me-dot"), nRing: q("olnu-me-ring"), near };
});

(async () => {
  const b = await chromium.launch(launchOpts([]));
  try {
    /* ---------- I-63: the ring only when an icon covers my dot ---------- */
    if (ONLY.test("i63")) {
      const { ctx, page, errs } = await openMap(b, { noMine: true, h: { checkin: false } });
      await page.evaluate(() => { if (PN.locate) PN.locate({}); }); await wait(page, 2000);   // the real locate path once (showMe → GLBARS.me)
      // 1) away from the bars: the dot only
      let away = null;
      for (const ll of AWAY) { await meAt(page, ctx, ll, 16.5); const s = await meState(page); if (s.near && s.near.length === 0) { away = s; break; } }
      ok("I-63 setup: a spot with no bar / food icon on my dot", !!away, away);
      if (away) ok("I-63 away from the bars: my dot, NO separate ring around it", away.nDot === 1 && away.nRing === 0, away);
      await page.screenshot({ path: SP + "hotfix1-i63-away.png" }).catch(() => {});
      // 2) on Pitchers: its icon covers my dot → the ring (over the icons) shows where I am
      const pit = await page.evaluate((id) => { const x = BARS.byId(id); return x ? [+x.lat, +x.lng] : null; }, PIT);
      await meAt(page, ctx, pit, 16.5);
      const on = await meState(page);
      ok("I-63 setup: the Pitchers icon covers my dot", on.near && on.near.length > 0, on);
      ok("I-63 under a bar icon: my dot + the ring over the icons", on.nDot === 1 && on.nRing >= 1 && on.cov === true, on);
      await page.screenshot({ path: SP + "hotfix1-i63-bar.png" }).catch(() => {});
      // 3) move away again (pan only, moveend): the ring goes again
      if (away) {
        await meAt(page, ctx, away.ll, 16.5);
        const back = await meState(page);
        ok("I-63 moved off the bar again: the ring is gone (re-checked)", back.nDot === 1 && back.nRing === 0 && back.cov === false, back);
        // 4) zoom only (zoomend) with me on the spot of a bar: covered → ring
        await page.evaluate((ll) => GLBARS.me(ll[0], ll[1]), pit);
        await page.evaluate((ll) => __map.setView(ll, 16, { animate: false }), pit); await idle(page, 1000);
        const z = await meState(page);
        ok("I-63 zoom (zoomend) + new position on a bar: the ring comes back", z.nRing >= 1 && z.near.length > 0, z);
      }
      ok("I-63 no page errors", errs.length === 0, errs.slice(0, 3));
      await closeCounted(ctx, page, "hotfix1-i63");
    }
    /* ---------- I-64: avatar editor labels ---------- */
    if (ONLY.test("i64")) {
      const { ctx, page } = await H.ctxFor(b, { width: 360, height: 740 });
      const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
      await page.route(/rest\/v1\/rpc\/my_avatar\b/, (r) => J(r, { v: 1, spec: { v: 1, sk: 2, fs: 1, ey: 1, br: 1, mt: 0, hr: 2, hc: 1, fh: 1, hw: 0, gl: 0, up: 0, uc: 0, bg: 1 }, seed: "5e3a91c2",
        facts: { mer: 30, r: 5, n: 42, title: "Korpral Korkskruv", s: 1, b: 2, t: 1, e: 0, m: ["m1"], today: "11-13" } }));
      await H.boot(page, { clean: true });
      await page.waitForFunction(() => window.AVATAR && AVATAR.on(), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => AVATAR.openEditor());
      await page.waitForSelector("#sheet-body .ave-tab", { timeout: 8000 }).catch(() => {});
      await wait(page, 600);
      const tabs = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .ave-tab")].map((b) => ({ t: b.textContent.trim(), k: b.getAttribute("data-t"), h: Math.round(b.getBoundingClientRect().height) })));
      const by = (k) => tabs.find((x) => x.k === k) || {};
      ok("I-64 editor: the face shape tab says 'Ansiktsform' (was 'Form')", by("face-fs").t === "Ansiktsform", by("face-fs"));
      ok("I-64 editor: the top tab says 'Tröja & jacka' (was 'Överdel')", by("uni-up").t === "Tröja & jacka", by("uni-up"));
      ok("I-64 editor: no tab named 'Form' or 'Överdel' any more", !tabs.some((x) => x.t === "Form" || x.t === "Överdel"), tabs.map((x) => x.t));
      // headers of the two parts
      const head = async (t) => { await page.evaluate((t) => [...document.querySelectorAll("#sheet-body .ave-tab")].find((b) => b.textContent.trim() === t).click(), t); await wait(page, 1200);
        return page.evaluate(() => { const r = document.querySelector("#sheet-body .ave-tabs").getBoundingClientRect(), on = document.querySelector("#sheet-body .ave-tab.on"), o = on && on.getBoundingClientRect(), h3 = document.querySelector("#sheet-body .ave-body h3");
          return { h3: h3 && h3.textContent, inRow: !!o && o.left >= r.left - 1 && o.right <= r.right + 1, oneLine: !!o && o.height <= 48, h: o && Math.round(o.height) }; }); };
      const a = await head("Ansiktsform"), u = await head("Tröja & jacka");
      ok("I-64 editor: 'Ansiktsform · N' header, the tab scrolls fully into the row", /^Ansiktsform · \d+/.test(a.h3 || "") && a.inRow, a);
      ok("I-64 editor: 'Tröja & jacka · N' header, the tab on one line, fully in the row", /^Tröja & jacka · \d+/.test(u.h3 || "") && u.inRow && u.oneLine, u);
      const row = await page.evaluate(() => { const t = document.querySelector("#sheet-body .ave-tabs"), sb = document.getElementById("sheet-body"), cs = getComputedStyle(t);
        return { scrolls: t.scrollWidth > t.clientWidth && /auto|scroll/.test(cs.overflowX), wrap: cs.flexWrap, page: sb.scrollWidth <= sb.clientWidth + 1, doc: document.documentElement.scrollWidth <= innerWidth + 1 }; });
      ok("I-64 editor at 360 px: one tab row that scrolls sideways, no page overflow", row.scrolls && row.wrap === "nowrap" && row.page && row.doc, row);
      ok("I-64 editor at 360 px: every tab is one line (no wrapped label)", tabs.every((x) => x.h <= 48), tabs.filter((x) => x.h > 48));
      await page.screenshot({ path: SP + "hotfix1-i64-editor.png" }).catch(() => {});
      // the step wizard's quick-jump chips
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 600);
      await page.evaluate(() => window.AVWIZ.open()); await wait(page, 1500);
      const steps = await page.evaluate(() => window.AVWIZ._steps.map((s) => s.k || s.id));
      await page.evaluate((i) => { const e = document.querySelector('#sheet-body .avw-quick [data-i="' + i + '"]'); if (e) e.click(); }, steps.indexOf("sk")); await wait(page, 500);
      const chips = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .avw-quick button")].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) })));
      ok("I-64 wizard: the face shape chip says 'Ansiktsform' (was 'Form'), 'Kläder' stays", chips.some((c) => c.t === "Ansiktsform") && !chips.some((c) => c.t === "Form") && chips.some((c) => c.t === "Kläder"), chips.map((c) => c.t));
      ok("I-64 wizard at 360 px: chips one line, no page overflow", chips.length > 5 && chips.every((c) => c.h <= 48) && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), chips);
      ok("I-64 no page errors", errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }
  } catch (e) { ok("run: " + (e && e.message || e).split("\n")[0], false); }
  finally { await b.close(); }
  console.log("RESULT " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
