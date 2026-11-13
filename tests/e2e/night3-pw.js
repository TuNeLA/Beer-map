// night3-pw.js — lane night3 (owner 13 Nov 19:21):
//   I-97  the event search box's orange focus ring is whole (not clipped by #sheet-body) at 360 / 390 / 430 px, no side scroll.
//   I-96  while events_search loads, the time segment + type chips stay (bar height kept, list faded / skeleton, no jump);
//         search starts at 3 characters; 12 rows of one title at 12 places = ONE row "… · 12 platser · närmast Ludvika"
//         (expandable); nearest first (my real position), else by time.
//   I-98  a friend checked in at O'Learys Borlänge (a PLACE id pl_6048761_1543531) drinks there: his beer (server bar_id = Pitcher's
//         i Borlänge, 57 m away) belongs to O'Learys, not Pitcher's; a stranger's beer 20 m from Pitcher's still snaps to it.
//   I-99  an active check-in wins over an OLDER beer pin: my beer (Ludvika, 60 min ago) + my check-in at Pitcher's i Borlänge
//         (10 min ago) = I am drawn at Pitcher's, not in Ludvika; the same for a friend (Lisa).
//   I-95  the "🏃 Pitchers" departure chip (my ETA): a tap opens the bar card with my "På väg" box (Framme! / Avbryt), also when
//         that card is already open (a 2nd tap closed it) and when the GL marker click does nothing.
// Mocked Supabase (ds-helpers). usage: node night3-pw.js <port> [section-regex: i98|i97|i96|i95]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const ONLY = new RegExp(process.argv[3] || ".");
const OUT = process.env.N3_SHOTS || "";
const { wait } = H;
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const at = (h) => { const t = new Date(Date.now() + h * 3600e3); t.setMinutes(0, 0, 0); return t.toISOString(); };

// 12 cinemas show one film; the Ludvika one is the latest. Plus a far, early single event.
const TOWNS = [["Malmö", 55.605, 13.0], ["Lund", 55.70, 13.19], ["Göteborg", 57.70, 11.97], ["Stockholm", 59.33, 18.06], ["Uppsala", 59.86, 17.64],
  ["Umeå", 63.83, 20.26], ["Luleå", 65.58, 22.15], ["Örebro", 59.27, 15.21], ["Västerås", 59.61, 16.55], ["Falun", 60.61, 15.63], ["Borlänge", 60.48, 15.43], ["Ludvika", 60.1496, 15.1878]];
const FILM = TOWNS.map((t, i) => ({ id: 9300 + i, kind: "other", title: "A Talent for Murder", place: "Filmstaden " + t[0], town: t[0], lat: t[1], lng: t[2], starts_at: at(20 + i) }));
const HITS = FILM.concat([{ id: 9400, kind: "quiz", title: "Talentjakt Malmö", place: "Pub Malmö", town: "Malmö", lat: 55.6, lng: 13.0, starts_at: at(3) }]);
function search(q) {
  q = String(q || "").toLowerCase();
  if (q === "lud") return [{ id: 9500, kind: "quiz", title: "Pubquiz på Pitchers", place: "Pitchers", town: "Ludvika", lat: 60.14997, lng: 15.18679, starts_at: at(30) }];
  return HITS.filter((e) => [e.title, e.place, e.town].some((s) => String(s || "").toLowerCase().includes(q)));
}

async function setup(browser, vp, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, vp || { width: 390, height: 844 });
  page.__calls = [];
  page.on("request", (q) => { const m = q.url().match(/rest\/v1\/rpc\/(\w+)/); if (m) { let b = null; try { b = JSON.parse(q.postData() || "null"); } catch (e) {} page.__calls.push({ fn: m[1], body: b }); } });
  await page.route(/rest\/v1\/rpc\/events_search\b/, async (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (o.slow) await new Promise((res) => setTimeout(res, o.slow));
    J(r, { v: 1, q: b.p_q, events: search(b.p_q) }); });
  if (o.live) { await page.route(/rest\/v1\/rpc\/live_beers\b/, (r) => J(r, o.live.beers)); await page.route(/rest\/v1\/rpc\/live_checkins\b/, (r) => J(r, o.live.cis)); }
  if (o.eta) await page.route(/rest\/v1\/rpc\/group_etas\b/, (r) => J(r, [{ id: 91, is_me: true, bar_id: o.eta.id, bar_name: o.eta.name, lat: o.eta.lat, lng: o.eta.lng,
    eta_at: new Date(Date.now() + 10 * 60e3).toISOString(), created_at: new Date(Date.now() - 5 * 60e3).toISOString() }]));
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
  return { ctx, page };
}
const openEv = async (page) => { await page.waitForFunction(() => window.EVSHEET && EVSHEET._cache().rows.length > 0, null, { timeout: 15000 }).catch(() => {}); await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1200); };
const calls = (page, fn) => page.__calls.filter((c) => c.fn === fn);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  /* ---------- I-98: the beer of a friend checked in at a place belongs to that place (not the bar 57 m away) ---------- */
  if (ONLY.test("i98")) {
    const now = (m) => new Date(Date.now() - m * 60e3).toISOString();
    const B = (id, lat, lng, o) => Object.assign({ id, lat, lng, beer_count: 1, other_count: 0, precise: true, created_at: now(20), is_mine: false, friend_name: null, skal_count: 0, i_skaled: false }, o);
    const beers = [B(9801, 60.48761, 15.43531, { friend_name: "Kalle", bar_id: "n3911317766", snap: "bar" }),            // AT O'Learys; the server said Pitcher's
      B(9802, 60.48733, 15.43488, { bar_id: "n3911317766", snap: "bar" }),                                                  // a stranger 20 m from Pitcher's
      B(9803, 60.1505, 15.1872, { is_mine: true, created_at: now(60) }),                                                  // I-99: my beer in Ludvika (older)
      B(9804, 60.1520, 15.1900, { friend_name: "Lisa", created_at: now(70) })];                                            // I-99: Lisa's beer in Ludvika (older)
    const cis = [{ id: 7801, bar_id: "pl_6048761_1543531", bar_name: "O'Learys", lat: 60.48761, lng: 15.43531, is_friend: true, is_mine: false, name: "Kalle", created_at: now(40) },
      { id: 7802, bar_id: "n3911317766", bar_name: "Pitcher’s i Borlänge", lat: 60.48715, lng: 15.43488, is_mine: true, name: "Anton", created_at: now(10) },
      { id: 7803, bar_id: "n3911317766", bar_name: "Pitcher’s i Borlänge", lat: 60.48715, lng: 15.43488, is_friend: true, name: "Lisa", created_at: now(12) }];
    const { ctx, page } = await setup(browser, null, { live: { beers, cis } });
    await page.waitForFunction(() => PN.s.beers.some((b) => b.id === 9801) && PN.s.checkins.length > 0, null, { timeout: 30000 }).catch(() => console.log("no beers / check-ins"));
    await page.evaluate(() => __map.setView([60.48740, 15.43510], 17, { animate: false })); await wait(page, 3000);
    const r = await page.evaluate(() => { const per = BARS.assign(PN.s.beers).perBar, ids = (k) => (per[k] ? per[k].beers.map((b) => b.id) : []);
      const mk = (id) => { const e = document.querySelector('.cm[data-bar="' + id + '"]'); return e ? e.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : null; };
      return { rest: BARS.assign(PN.s.beers).rest.map((b) => b.id), ol: ids("pl_6048761_1543531"), pit: ids("n3911317766"), olName: per["pl_6048761_1543531"] && per["pl_6048761_1543531"].bar.name, olMk: mk("pl_6048761_1543531"), pitMk: mk("n3911317766") }; });
    if (OUT) await page.screenshot({ path: OUT + "/i98-borlange-390.png" });
    ok(r.ol.includes(9801) && !r.pit.includes(9801) && /O.Learys/.test(r.olName || ""), "I-98 Kalle (checked in at O'Learys, a place) drinks there: his beer is on O'Learys, not Pitcher's", r);
    ok(r.pit.includes(9802), "I-98 a beer 20 m from Pitcher's (no check-in) still snaps to Pitcher's", r);
    ok(r.pit.includes(9803) && !r.rest.includes(9803), "I-99 my older beer pin in Ludvika + my check-in at Pitcher's i Borlänge = I am drawn at Pitcher's (no Ludvika pin)", r);
    ok(r.pit.includes(9804) && !r.rest.includes(9804), "I-99 the same for a friend (Lisa): drawn at her check-in, not at her older Ludvika pin", r);
    await page.evaluate(() => __map.setView([60.1505, 15.1872], 16, { animate: false })); await wait(page, 2500);
    const lud = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-icon")].filter((m) => { const r = m.getBoundingClientRect(); return r.width > 2 && r.top > 0 && r.top < innerHeight && m.classList.contains("pp-f"); }).map((m) => m.className.slice(0, 60)));
    ok(lud.length === 0, "I-99 Ludvika: no beer pin of me or Lisa left there (the GPS me-dot may stay)", lud);
    await ctx.close();
  }

  /* ---------- I-97: the whole focus ring is inside #sheet-body (its clip box) at 360-430 px ---------- */
  if (ONLY.test("i97")) {
    for (const w of [360, 390, 430]) {
      const { ctx, page } = await setup(browser, { width: w, height: 844 });
      await openEv(page);
      await page.focus("#sheet-body .evs-q"); await wait(page, 200);
      const m = await page.evaluate(() => {
        const i = document.querySelector("#sheet-body .evs-q"), cs = getComputedStyle(i), r = i.getBoundingClientRect();
        const ow = cs.outlineStyle === "none" ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || 0);
        let clip = { left: 0, right: innerWidth }, e = i.parentElement;
        while (e && e !== document.documentElement) { const s = getComputedStyle(e); if (s.overflowX !== "visible") { const b = e.getBoundingClientRect(); clip = { left: Math.max(clip.left, b.left), right: Math.min(clip.right, b.right) }; } e = e.parentElement; }
        return { ring: [r.left - ow, r.right + ow], ow, clip: [clip.left, clip.right], sw: document.documentElement.scrollWidth, iw: innerWidth, sbw: document.getElementById("sheet-body").scrollWidth - document.getElementById("sheet-body").clientWidth };
      });
      ok(m.ow >= 2 && m.ring[0] >= m.clip[0] - 0.01 && m.ring[1] <= m.clip[1] + 0.01 && m.sw <= m.iw && m.sbw <= 0, "I-97 " + w + " px: the focus ring is whole inside the sheet, no side scroll", m);
      if (OUT && w === 390) await page.screenshot({ path: OUT + "/i97-390.png", clip: { x: 0, y: 330, width: 390, height: 260 } });
      await ctx.close();
    }
  }

  /* ---------- I-96: stable bar while loading, 3 characters, one row per title, nearest first ---------- */
  if (ONLY.test("i96")) {
    const { ctx, page } = await setup(browser, null, { slow: 1800 });
    await page.evaluate(() => { PN.s.lastLoc = { lat: 60.1496, lng: 15.1878 }; });   // my real position: Ludvika
    await openEv(page);
    const before = await page.evaluate(() => ({ bar: document.querySelector("#sheet-body .evs-bar").getBoundingClientRect().height, list: document.querySelector("#sheet-body .evs-list").getBoundingClientRect().height }));
    await page.fill("#sheet-body .evs-q", "Le"); await wait(page, 700);
    ok(calls(page, "events_search").length === 0, "I-96 2 characters ('Le', not a town) = no search yet", calls(page, "events_search").map((c) => c.body));
    await page.fill("#sheet-body .evs-q", "Lud"); await wait(page, 800);   // the debounce has passed, the RPC is still slow
    const mid = await page.evaluate(() => { const seg = document.querySelector("#sheet-body .evs-time"), ch = document.querySelector("#sheet-body .evs-chips"), lb = document.querySelector("#sheet-body .evs-list");
      return { bar: document.querySelector("#sheet-body .evs-bar").getBoundingClientRect().height, seg: getComputedStyle(seg).display, chips: getComputedStyle(ch).display,
        list: lb.getBoundingClientRect().height, busy: lb.classList.contains("evs-busy"), skel: lb.querySelectorAll(".evs-skel").length, kids: lb.children.length }; });
    if (OUT) await page.screenshot({ path: OUT + "/i96-loading-390.png" });
    ok(calls(page, "events_search").length === 1 && mid.seg !== "none" && mid.chips !== "none" && Math.abs(mid.bar - before.bar) < 2,
      "I-96 while the search loads: the time segment + chips stay, the bar keeps its height (" + before.bar + " → " + mid.bar + ")", mid);
    ok(mid.busy && mid.kids > 0 && mid.list >= Math.min(before.list, 200) - 2, "I-96 while it loads the list fades (or 3 skeleton rows) and keeps its height: no jump", { before, mid });
    await page.fill("#sheet-body .evs-q", "Talent"); await wait(page, 2600);
    const res = await page.evaluate(() => { const lb = document.querySelector("#sheet-body .evs-list");
      return { rows: lb.querySelectorAll(".evs-row").length, grp: [...lb.querySelectorAll(".evs-hgrp")].map((g) => ({ n: +g.getAttribute("data-n"), t: g.textContent.replace(/\s+/g, " ").trim() })),
        first: (lb.firstElementChild && lb.firstElementChild.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90) }; });
    if (OUT) await page.screenshot({ path: OUT + "/i96-grouped-390.png" });
    ok(res.grp.length === 1 && res.grp[0].n === 12 && /A Talent for Murder/.test(res.grp[0].t) && /12 platser/.test(res.grp[0].t) && /närmast Ludvika/.test(res.grp[0].t) && res.rows === 1,
      "I-96 12 rows of 'A Talent for Murder' = ONE row '… · 12 platser · närmast Ludvika' (+ the other title)", res);
    ok(/A Talent for Murder/.test(res.first), "I-96 nearest first: the film (in Ludvika) before the earlier event in Malmö", res.first);
    await page.evaluate(() => { const h = document.querySelector("#sheet-body .evs-hgh"); if (h) h.click(); }); await wait(page, 500);
    const ex = await page.evaluate(() => { const g = document.querySelector("#sheet-body .evs-hgrp"); const rs = g ? [...g.querySelectorAll(".evs-row")] : [];
      return { n: rs.length, first: rs[0] ? rs[0].textContent.replace(/\s+/g, " ") : "", exp: g && g.querySelector(".evs-hgh").getAttribute("aria-expanded") }; });
    ok(ex.n === 12 && /Ludvika/.test(ex.first) && ex.exp === "true", "I-96 a tap opens the group: 12 rows, Ludvika first", ex);
    await ctx.close();
  }

  /* ---------- I-95: my departure chip "🏃 Pitchers" opens the bar card with my På väg box ---------- */
  if (ONLY.test("i95")) {
    const PIT = { id: null, name: "Pitchers", lat: 60.14997, lng: 15.18679 };
    const { ctx, page } = await setup(browser, null, { eta: new Proxy(PIT, { get: (t, k) => (k === "id" ? (PIT.id || "n3472634175") : t[k]) }) });
    PIT.id = await page.evaluate(() => { const b = (BARS.nearby(60.15, 15.187, 2000) || []).map((x) => x.bar || x).find((x) => /pitchers/i.test(x.name || "")); return b ? String(b.id) : null; });
    await page.waitForFunction(() => window.BARSPLUS && BARSPLUS.eta && BARSPLUS.eta.mine && BARSPLUS.eta.mine(), null, { timeout: 30000 }).catch(() => console.log("no eta"));
    const card = () => page.evaluate(() => { const p = document.querySelector(".leaflet-popup.olnu-bar"); return { open: !!p, eta: !!(p && p.querySelector(".pp-sec-eta .eta-me")), framme: !!(p && /Framme/.test(p.textContent)), z: __map.getZoom() }; });
    const tapChip = async () => { const el = await page.$(".mp-pin"); if (!el) return false; const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await wait(page, 3000); return true; };
    const far = async () => { await page.evaluate(() => __map.setView([60.14997, 15.18679], 10, { animate: false })); await wait(page, 1500); };
    // a) the bar card is already open (I tapped the bar, zoomed out); the chip tap used to close it (marker click = popup toggle)
    await page.evaluate(() => __map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(page, 1500);
    await page.evaluate((id) => { const b = BARS.byId(id); if (b && window.PN && PN.openBar) PN.openBar(b); }, PIT.id); await wait(page, 2600);
    const pre = await card();
    await far();
    const t1 = await tapChip(), a = await card();
    if (OUT) await page.screenshot({ path: OUT + "/i95-card-390.png" });
    ok(pre.open && t1 && a.open && a.eta && a.framme, "I-95a tap on '🏃 Pitchers' while its card is open: the card stays with my På väg box (Framme!)", { pre, t1, a });
    // b) GL map: the marker click is a no-op (no marker element) → the bar card still opens
    await page.evaluate(() => __map.closePopup()); await far();
    await page.evaluate(() => { window.__glo = [GLBARS.on, GLBARS.open]; GLBARS.on = () => true; GLBARS.open = () => true; });
    const t2 = await tapChip(), b2 = await card();
    await page.evaluate(() => { GLBARS.on = __glo[0]; GLBARS.open = __glo[1]; });
    ok(t2 && b2.open && b2.eta, "I-95b GL marker click did nothing: the chip tap still opens the bar card with my På väg box", { t2, b2 });
    await ctx.close();
  }

  await browser.close();
  console.log(`\nnight3: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
