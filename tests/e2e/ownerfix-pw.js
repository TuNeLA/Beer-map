// ownerfix tests (owner live-beta test 11 Nov evening): 1 Event sheet empty after "Visa" · 2 "Göm min pin" = hide only ·
// 3 bigger food icons · 4 LIVE ticker (no gaps, one speed controller, reduced motion = one line at a time) ·
// 5 price confirm + "1 rapport" · 6 in-app Kontakt form.
// Mocked Supabase, Leaflet-shaped raster map. usage: node ownerfix-pw.js <port> [item-regex, e.g. "^(1|4b)$"] [shot-tag]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const { appFiles } = require("./lib/appsrc.js");   // W2 split: app.js + docs/js/app-*.js
const SP = require("./env.js").OUT, DIR = SP + "ownerfix-shots/";
fs.mkdirSync(DIR, { recursive: true });
const ONLY = new RegExp(process.argv[3] || ".");
const TAG = process.argv[4] || "t";
const { wait, clickJS } = H;
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name, clip) => page.screenshot({ path: DIR + TAG + "-" + name + ".png", ...(clip ? { clip } : {}) }).catch(() => {});

function events() {
  const day = (d, hh) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(hh, 0, 0, 0); return t.toISOString(); };
  const out = [];
  for (let k = 0; k < 4; k++) out.push({ id: 9100 + k, kind: "quiz", title: "Pubquiz " + (k + 1), place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, starts_at: day(k, 20) });
  for (let k = 0; k < 3; k++) out.push({ id: 9200 + k, kind: "sport", sport: "fotboll", league: "Div 2", title: "Ludvika FK – IFK Ore " + (k + 1), place: "Ludvika IP", lat: 60.15, lng: 15.19, starts_at: day(1 + k, 14) });
  out.push({ id: 9300, kind: "music", title: "Trubadur Kalle", place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, starts_at: day(1, 21), source: "user", is_mine: false, pending: false });
  return out;
}
const EV = events();
async function setup(browser, w, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: o.h || HT[w] || 844 }, o);
  page.__calls = [];
  page.on("request", (q) => { const m = q.url().match(/rest\/v1\/rpc\/(\w+)|functions\/v1\/([\w-]+)/); if (m) { let b = null; try { b = JSON.parse(q.postData() || "null"); } catch (e) {} page.__calls.push({ fn: m[1] || "fn:" + m[2], body: b }); } });
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: EV }));
  if (o.routes) await o.routes(page);
  if (o.init) await ctx.addInitScript(o.init);
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const calls = (page, re) => page.__calls.filter((c) => re.test(c.fn));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // ================= 1. Event → detail → 📍 Visa → close → Event again = the list =================
  if (ONLY.test("1")) for (const w of [360, 390]) {
    const { ctx, page } = await setup(browser, w);
    await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1500);
    const rows0 = await page.evaluate(() => document.querySelectorAll("#sheet-body .evs-list > *").length);
    ok(rows0 > 0, w + " 1 event list has rows at first open", rows0);
    await page.evaluate(() => window.EVSHEET.openDetail("9100")); await wait(page, 900);
    const det = await page.evaluate(() => !!document.querySelector("#sheet-body .evs-detail .evs-show"));
    ok(det, w + " 1 detail view with 📍 Visa");
    await clickJS(page, "#sheet-body .evs-detail .evs-show"); await wait(page, 1500);
    await shot(page, w + "-1-after-visa");
    // close what Visa opened (bar card in the sheet or a map popup)
    await page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden) document.getElementById("sheet-close").click(); try { window.__map.closePopup(); } catch (e) {} });
    await wait(page, 900);
    await page.evaluate(() => { const b = document.getElementById("btn-evs"); if (b && b.offsetParent) b.click(); else window.EVSHEET.open(); }); await wait(page, 1800);
    const r = await page.evaluate(() => {
      const b = document.getElementById("sheet-body"), l = b && b.querySelector(".evs-list"), bar = b && b.querySelector(".evs-bar");
      return { title: document.getElementById("sheet-title").textContent, cls: b ? b.className : "", listH: l ? Math.round(l.getBoundingClientRect().height) : -1,
        barH: bar ? Math.round(bar.getBoundingClientRect().height) : -1, rows: l ? l.querySelectorAll(".evs-dg, .evs-empty").length : 0 };
    });
    await shot(page, w + "-1-reopen");
    ok(r.listH > 40 && r.barH > 20 && r.rows > 0, w + " 1 Visa → close → Event again shows the list (not an empty body)", r);
    ok(!/evs-in-detail/.test(r.cls), w + " 1 #sheet-body has no left-over detail class", r.cls);
    // and an unrelated sheet after the event detail is not empty either
    await page.evaluate(() => window.EVSHEET.openDetail("9101")); await wait(page, 700);
    await clickJS(page, "#sheet-body .evs-detail .evs-show"); await wait(page, 1200);
    await page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden) document.getElementById("sheet-close").click(); try { window.__map.closePopup(); } catch (e) {} }); await wait(page, 700);
    await clickJS(page, "#btn-settings"); await wait(page, 1300);
    const st = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return { kids: [...b.children].filter((x) => x.getBoundingClientRect().height > 0).length, cls: b.className }; });
    ok(st.kids > 2, w + " 1 Inställningar after an event detail + Visa is not empty", st);
    await ctx.close();
  }

  // ================= 2. own pin popup "Göm min pin" = hide only (no Sluta dricka sheet, no group notice) =================
  if (ONLY.test("2")) {
    const routes = async (page) => {
      await page.route(/rest\/v1\/rpc\/(stop_beer|show_pin)\b/, (r) => J(r, null));
    };
    const { ctx, page } = await setup(browser, 390, { routes });
    await page.evaluate(() => { localStorage.setItem("olnu.pushOn", "1"); });
    // my beer marker (a clustered L.marker with options.mine): record markers made after a re-render, open its own popup content
    await page.evaluate(() => { window.__mk = []; L.Marker.addInitHook(function () { if (this.options && this.options.mine) window.__mk.push(this); }); window.__map.setView([60.1505, 15.1872], 10, { animate: false }); });
    await wait(page, 1500);
    const opened = await page.evaluate(() => {
      const m = window.__mk[window.__mk.length - 1]; if (!m || !m.getPopup()) return false;
      let c = m.getPopup().getContent(); if (typeof c === "function") c = c(m);
      if (!/data-hidepin/.test(String(c))) return false;
      L.popup({ offset: L.point(0, -12) }).setLatLng(m.getLatLng()).setContent(c).openOn(window.__map); return true;
    });
    await wait(page, 700);
    const btn = await page.evaluate(() => !!document.querySelector(".leaflet-popup [data-hidepin]"));
    ok(opened && btn, "2 own pin popup has the Göm min pin button", { opened, btn });
    await shot(page, "2-popup");
    page.__calls.length = 0;
    await clickJS(page, ".leaflet-popup [data-hidepin]"); await wait(page, 1500);
    const r = await page.evaluate(() => ({ sheet: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent,
      toast: [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | ") }));
    await shot(page, "2-after-hide");
    ok(!(r.sheet && /Sluta dricka/.test(r.title)), "2 Göm min pin does NOT open the Sluta dricka sheet", r);
    ok(calls(page, /^stop_beer$/).length === 1, "2 Göm min pin hides the pin (stop_beer once)", calls(page, /./).map((c) => c.fn));
    ok(!calls(page, /notify-group/).length, "2 no group notice (notify-group not called)");
    ok(/gömd/i.test(r.toast) && /Visa igen/.test(r.toast), "2 toast 'Pinnen ä gömd' with 'Visa igen'", r.toast);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#toasts .toast button")].find((x) => /Visa igen/.test(x.textContent)); if (b) b.click(); }); await wait(page, 1000);
    ok(calls(page, /^show_pin$/).length === 1, "2 Visa igen calls show_pin", calls(page, /show_pin/).length);
    // "Sluta dricka" is still its own choice
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    await page.evaluate(() => { const b = document.getElementById("btn-stop"); b.disabled = false; b.click(); }); await wait(page, 900);
    const s2 = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, txt: document.getElementById("sheet-body").textContent }));
    ok(s2.open && /Sluta dricka/.test(s2.title) && /hemma/.test(s2.txt), "2 Sluta dricka button still opens its own sheet (Jag är hemma / Öltorsk)", s2.title);
    await ctx.close();
  }

  // ================= 3. food / restaurant icons ~+20 %, bars stay bigger =================
  if (ONLY.test("3")) {
    const { ctx, page } = await setup(browser, 360);
    const s = await page.evaluate(() => {
      const P = window.PNPINS, w = (ops) => { const b = P.bboxOf(ops); return Math.round(b[2] - b[0]); };
      return { place: ["restaurant", "cafe", "fastfood", "kebab"].map((k) => w(P.placeOps(k).ops)), bar: w(P.barOps({ k: "pub" }, "d", false).ops),
        tok: window.PNTOKENS.size.placeDot, glyph: window.PNTOKENS.size.placeGlyph };
    });
    ok(s.tok >= 19 && s.tok <= 20 && s.glyph >= 12, "3 place disc ≈ +20 % (token 16 → 19–20 px, glyph 10 → 12)", s);
    ok(Math.max(...s.place) < s.bar, "3 bar dots stay bigger than food dots", s);
    // the drawn images (incl. ring + edge) of all four food kinds grow
    ok(Math.min(...s.place) >= 26, "3 every food icon image grew (old 24 px box incl. shadow, now ≥ 26)", s.place);
    await ctx.close();
  }

  // ================= 4a. LIVE belt: no gaps between headlines on a wide PC screen =================
  const tx = (page) => page.evaluate(() => { const m = /translate3d\((-?[\d.]+)px/.exec(document.getElementById("ticker-track").style.transform || ""); return m ? +m[1] : null; });
  const gaps = (page) => page.evaluate(() => {
    const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
    const vis = [...tr.children].map((e) => ({ r: e.getBoundingClientRect(), o: +getComputedStyle(e).opacity, t: (e.textContent || "").trim(), c: e.className }))
      .filter((x) => x.r.width > 0 && x.o > 0.3 && x.t && x.r.right > vr.left && x.r.left < vr.right).sort((a, b) => a.r.left - b.r.left);
    let worst = 0, at = null, prev = vr.left;
    for (const x of vis) { const g = Math.max(0, x.r.left) - Math.max(prev, vr.left); if (g > worst) { worst = g; at = x.t.slice(0, 40); } prev = Math.max(prev, x.r.right); }
    const tail = vr.right - prev; if (tail > worst) { worst = tail; at = "(end)"; }
    return { worst: Math.round(worst), at, n: vis.length, vw: Math.round(vr.width) };
  });
  if (ONLY.test("4a")) {
    const { ctx, page } = await setup(browser, 390, { h: 900 });
    await page.setViewportSize({ width: 2000, height: 900 }); await wait(page, 2500);
    const g0 = await gaps(page);
    ok(g0.worst <= 40, "4a 2000 px belt: no gap between headlines at start", g0);
    // an old quiet line on screen + a new snapshot with people (fixM freshBelt) → the line goes; no gap stays
    const ins = await page.evaluate(() => {
      const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
      const mid = [...tr.children].find((e) => { const r = e.getBoundingClientRect(); return e.classList.contains("tk-item") && r.left > vr.left + 100 && r.right < vr.left + vr.width * 0.6; });
      if (!mid) return null;
      const sep = document.createElement("span"); sep.className = "tk-sep"; sep.textContent = "///";
      const q = document.createElement("span"); q.className = "tk-item tk-quiet"; q.textContent = "Lugnt läge i stan. Alla sover, utom bartendern.";
      mid.after(sep, q);
      return { snapN: window.NEWS.snap().n, w: Math.round(q.getBoundingClientRect().width) };
    });
    await page.evaluate(() => window.NEWS.freshBelt(document.getElementById("ticker-track")));
    await wait(page, 120); await shot(page, "4a-2000-mid", { x: 0, y: 0, width: 2000, height: 160 });
    await wait(page, 1200);
    const g1 = await gaps(page);
    await shot(page, "4a-2000-after", { x: 0, y: 0, width: 2000, height: 160 });
    ok(ins && ins.snapN >= 3, "4a test setup: a quiet line on screen, snapshot has ≥ 3 people", ins);
    ok(g1.worst <= 40, "4a after a new snapshot: the old quiet line leaves NO gap (fade + fold shut)", g1);
    const mv = await page.evaluate(() => new Promise((res) => {   // follow one piece on screen (the transform jumps when a piece leaves on the left)
      const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
      const el = [...tr.children].find((e) => { const r = e.getBoundingClientRect(); return r.left > vr.left + 100 && r.left < vr.right - 100; });
      const a = el ? el.getBoundingClientRect().left : null; setTimeout(() => res({ a, b: el && el.isConnected ? el.getBoundingClientRect().left : null }), 700); }));
    ok(mv.a !== null && mv.b !== null && mv.b < mv.a - 3, "4a belt still moves after the fold", mv);
    await ctx.close();
  }

  // ================= 4b. fast tap-tap-tap: state and motion always agree, it moves again =================
  // motion = one belt piece on screen moves left (the transform alone jumps when a piece leaves on the left)
  const tState = async (page) => page.evaluate(() => new Promise((res) => {
    const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
    const el = [...tr.children].find((e) => { const r = e.getBoundingClientRect(); return r.left > vr.left + 40 && r.left < vr.right - 40; }) || tr.lastElementChild;
    const a = el.getBoundingClientRect().left;
    setTimeout(() => { const b = el.isConnected ? el.getBoundingClientRect().left : null;
      res({ stop: document.querySelector(".ticker").classList.contains("pn-tk-stop"), moving: b !== null && b < a - 3, a: Math.round(a), b: b === null ? null : Math.round(b), F: window.PN_TICK_F,
        ctl: window.PNTICK ? window.PNTICK.state() : null, sheet: !document.getElementById("sheet").hidden }); }, 700);
  }));
  if (ONLY.test("4b")) {
    // ONE speed controller: only one file may write window.PN_TICK_F (was pnds.js tap-stop loop + pnui.js hold loop)
    const { ctx, page } = await setup(browser, 390);
    const w = await page.evaluate(async (files) => { const out = {};
      for (const f of files) { const t = await (await fetch(f + "?x=" + Date.now())).text(); out[f] = (t.match(/PN_TICK_F\s*=(?!=)/g) || []).length; }
      return out; }, appFiles().concat(["js/pnds.js", "js/pnui.js", "js/news.js"]));
    const writers = Object.keys(w).filter((k) => w[k] > 0);
    ok(writers.length === 1 && writers[0] === "js/pnui.js", "4b ONE ticker speed controller: only pnui.js writes PN_TICK_F", w);
    await ctx.close();
  }
  if (ONLY.test("4b")) for (const how of ["mouse", "touch"]) {
    const { ctx, page } = await setup(browser, 390);
    // KAOS (many people in the mock) takes over the ticker line with its own button: switch it off for this test
    const noKaos = () => page.evaluate(() => { if (document.querySelector(".ticker.pn-kaos")) { const x = document.getElementById("chaos-close") || document.querySelector(".pn-kaos-x"); if (x) x.click(); } });
    const box = await page.evaluate(() => { const r = document.querySelector(".ticker .tk-viewport").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await noKaos(); await wait(page, 300);
    const tap = async () => { if (how === "mouse") { await page.mouse.move(box.x, box.y); await page.mouse.down(); await wait(page, 25); await page.mouse.up(); } else await page.touchscreen.tap(box.x, box.y); };
    const s0 = await tState(page);
    ok(s0.moving && !s0.stop, "4b " + how + " belt moves at start", s0);
    for (let i = 0; i < 30; i++) { await tap(); await wait(page, 30 + (i % 3) * 15); }
    await wait(page, 500);
    const s1 = await tState(page);
    ok(s1.stop === !s1.moving, "4b " + how + " after 30 fast taps: the shown state matches the motion", s1);
    await noKaos(); await tap(); await wait(page, 500);
    const s2 = await tState(page);
    ok(s2.stop === !s2.moving && s2.stop !== s1.stop, "4b " + how + " 1 more tap toggles, state matches the motion", s2);
    if (s2.stop) { await noKaos(); await tap(); await wait(page, 500); }
    const s3 = await tState(page);
    ok(s3.moving && !s3.stop, "4b " + how + " it moves again (never frozen)", s3);
    // hold = pause, release = go (the one controller also owns hold)
    if (how === "mouse") {
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await wait(page, 900);
      const h1 = await tState(page); await page.mouse.up(); await wait(page, 500); const h2 = await tState(page);
      ok(!h1.moving && h2.moving, "4b hold pauses, release goes on", { h1, h2 });
    }
    await ctx.close();
  }

  // ================= 4c. reduced motion: one headline at a time, swap every 6 s, tap = next =================
  if (ONLY.test("4c")) {
    const { ctx, page } = await setup(browser, 390, { reduced: true });
    await wait(page, 600);
    const one = () => page.evaluate(() => { const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
      const v = [...tr.children].filter((e) => { const r = e.getBoundingClientRect(); return (e.textContent || "").trim() && r.width > 0 && r.right > vr.left && r.left < vr.right; });
      const i = tr.querySelector(".tk-item"); return { n: v.length, kids: tr.children.length, t: i ? i.textContent : "", o: i ? +getComputedStyle(i).opacity : 0, tf: tr.style.transform, over: i ? i.scrollWidth > i.clientWidth + 2 : null }; });
    const a = await one();
    await shot(page, "4c-390-one", { x: 0, y: 0, width: 390, height: 160 });
    ok(a.kids === 1 && a.n === 1 && a.t.length > 3, "4c reduced motion: ONE headline on the line", a);
    await wait(page, 6800);
    const b = await one();
    ok(b.kids === 1 && b.t !== a.t && b.o > 0.9, "4c the headline swaps by itself within 7 s (soft fade, then fully visible)", { a: a.t, b: b.t, o: b.o });
    const tf0 = await page.evaluate(() => document.getElementById("ticker-track").style.transform);
    const box = await page.evaluate(() => { const r = document.querySelector(".ticker .tk-viewport").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(box.x, box.y); await wait(page, 800);
    const c = await one();
    ok(c.kids === 1 && c.t !== b.t, "4c tap = next headline", { b: b.t, c: c.t });
    ok(!/translate3d\(-/.test(tf0 || "") && !/translate3d\(-/.test(c.tf || ""), "4c no sideways motion", { tf0, tf: c.tf });
    await ctx.close();
  }

  // ================= 5. price: confirm above 150 kr, "1 rapport" =================
  if (ONLY.test("5")) {
    const routes = async (page) => {
      await page.route(/rest\/v1\/rpc\/bar_extra\b/, (r) => J(r, { v: 1, prices: { stor: { kr: 79, n: 1, at: new Date(Date.now() - 3600e3).toISOString() } } }));
      await page.route(/rest\/v1\/rpc\/report_bar_price\b/, (r) => J(r, { ok: true, kind: "stor", mine: 1, price: { kr: 79, n: 2 } }));
    };
    const { ctx, page } = await setup(browser, 390, { routes });
    await page.evaluate(() => { const b = window.BARS.byId("n3472634175"); L.popup().setLatLng([b.lat, b.lng]).setContent('<div class="of-test">' + window.BARINFO.barPopupHTML(b) + "</div>").openOn(window.__map); });
    await wait(page, 1800);
    const info = await page.evaluate(() => { const x = document.querySelector(".leaflet-popup .bi-info"); return x ? x.textContent : ""; });
    ok(/79 kr/.test(info) && /1 rapport(?!er)/.test(info), "5 one report shows '1 rapport' (thin data is visible)", info.slice(0, 200));
    await clickJS(page, '.leaflet-popup [data-bia="price"]'); await wait(page, 900);
    const sendTo = async (kr) => { await page.evaluate((kr) => { const i = document.querySelector("#sheet-body .bi-kr"); if (!i) return; i.value = String(kr); i.dispatchEvent(new Event("input", { bubbles: true })); }, kr);
      await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /Skicka/.test(x.textContent)); if (b) b.click(); }); await wait(page, 500); };
    page.__calls.length = 0;
    await sendTo(180);
    const c1 = await page.evaluate(() => { const s = document.querySelector("#sheet-body .bi-sure"); return { shown: !!(s && !s.hidden), txt: s ? s.textContent : "" }; });
    await shot(page, "5-confirm");
    ok(c1.shown && /Är du säker\? 180 kr för en öl\?/.test(c1.txt), "5 180 kr asks 'Är du säker? 180 kr för en öl?'", c1);
    ok(!calls(page, /report_bar_price/).length, "5 nothing sent before the confirm");
    await clickJS(page, "#sheet-body .bi-sure-no"); await wait(page, 300);
    ok(await page.evaluate(() => { const x = document.querySelector("#sheet-body .bi-sure"); return !!x && x.hidden; }) && !calls(page, /report_bar_price/).length, "5 'Ändra' closes the question, nothing sent");
    await sendTo(180); await clickJS(page, "#sheet-body .bi-sure-yes"); await wait(page, 900);
    const sent = calls(page, /report_bar_price/);
    ok(sent.length === 1 && sent[0].body && sent[0].body.p_kr === 180, "5 'Ja' sends 180 kr once", sent.map((x) => x.body));
    // a normal price goes at once
    await clickJS(page, '.leaflet-popup [data-bia="price"]'); await wait(page, 700);
    if (await page.evaluate(() => document.getElementById("sheet").hidden)) { await page.evaluate(() => { const b = window.BARS.byId("n3472634175"); L.popup().setLatLng([b.lat, b.lng]).setContent(window.BARINFO.barPopupHTML(b)).openOn(window.__map); }); await wait(page, 900); await clickJS(page, '.leaflet-popup [data-bia="price"]'); await wait(page, 700); }
    page.__calls.length = 0;
    await sendTo(75); await wait(page, 600);
    ok(calls(page, /report_bar_price/).length === 1, "5 75 kr goes at once (no question)", calls(page, /report_bar_price/).map((x) => x.body));
    await ctx.close();
  }

  // ================= 6. Kontakt = an in-app form (submit_knas → submit_feedback), mailto only as a fallback line =================
  if (ONLY.test("6")) for (const old of [false, true]) {
    const routes = async (page) => {
      if (old) await page.route(/rest\/v1\/rpc\/submit_knas\b/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.submit_knas" }) }));
      else await page.route(/rest\/v1\/rpc\/submit_knas\b/, (r) => J(r, { ok: true, id: 7, left: 4 }));
      await page.route(/rest\/v1\/rpc\/submit_feedback\b/, (r) => J(r, { ok: true, id: 8 }));
    };
    const { ctx, page } = await setup(browser, 360, { routes });
    // Inställningar → Trygghet row (same entry as kpi-pw: SAFETY.settingsSheet into a box)
    await page.evaluate(() => { const d = document.createElement("div"); d.id = "ofSet"; d.className = "sf-test"; document.body.appendChild(d); window.SAFETY.settingsSheet(d); });
    const k = await page.evaluate(() => { const b = [...document.querySelectorAll("#ofSet .sf-set a, #ofSet .sf-set button")].find((x) => /Kontakt/.test(x.textContent)); return b ? { tag: b.tagName, href: b.getAttribute("href") } : null; });
    ok(k && k.tag === "BUTTON" && !k.href, "6" + (old ? " (old server)" : "") + " Kontakt is an in-app button, not a mailto link", k);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#ofSet .sf-set button")].find((x) => /Kontakt/.test(x.textContent)); if (b) b.click(); }); await wait(page, 700);
    const f = await page.evaluate(() => { const c = document.querySelector(".sf-ov .sf-ct"); return c ? { topics: [...c.querySelectorAll("[data-t]")].map((x) => x.textContent), ta: !!c.querySelector("textarea"), mail: !!c.querySelector("input[type=email]"),
      mailto: !!c.querySelector('.sf-ct-mailto a[href^="mailto:"]') } : null; });
    if (!old) await shot(page, "6-form-360");
    ok(f && f.topics.join(",") === "Fråga,Anmälan,Fel i appen,Annat" && f.ta && f.mail && f.mailto, "6 form: 4 topics, text, optional e-mail, small mailto fallback line", f);
    if (f) {
      page.__calls.length = 0;
      await page.evaluate(() => { const c = document.querySelector(".sf-ov .sf-ct"); c.querySelector('[data-t="fel"]').click(); c.querySelector("textarea").value = "Kartan laggar när jag zoomar"; c.querySelector("input[type=email]").value = "test@example.com"; c.querySelector(".sf-ct-send").click(); });
      await wait(page, 1200);
      const kn = calls(page, /^submit_knas$/), fb = calls(page, /^submit_feedback$/);
      const body = (kn[0] && kn[0].body) || {};
      ok(kn.length === 1 && /^\[kontakt · Fel i appen\] Kartan laggar/.test(body.p_text || "") && /svar till: test@example\.com/.test(body.p_text) && body.p_meta && body.p_meta.from === "kontakt", "6 sends submit_knas with topic, text, e-mail, from=kontakt", body);
      if (old) ok(fb.length === 1 && fb[0].body.p_kind === "bug" && /Kartan laggar/.test(fb[0].body.p_text), "6 old server (no 0410): falls back to submit_feedback (LIVE)", fb.map((x) => x.body));
      else ok(!fb.length, "6 new server: no second call");
      const t = await page.evaluate(() => ({ ov: !!document.querySelector(".sf-ov"), toast: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | ") }));
      ok(!t.ov && /Tack/.test(t.toast), "6 form closes with a thank-you toast", t);
    }
    await ctx.close();
  }

  // ================= 7. event tips: auto ok answer, 3 a day, "Stämmer inte?" =================
  if (ONLY.test("7")) {
    let mode = "ok";
    const routes = async (page) => {
      await page.route(/rest\/v1\/rpc\/submit_event\b/, (r) => mode === "limit" ? r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "tip_limit" }) })
        : J(r, { id: 501, status: mode === "ok" ? "ok" : "pending", bar_id: "n3472634175", reason: mode === "ok" ? "auto:account" : "new_user" }));
      await page.route(/rest\/v1\/rpc\/report_event_tip\b/, (r) => J(r, { ok: true, n: 1, hidden: false }));
    };
    const { ctx, page } = await setup(browser, 390, { routes, init: () => { try { localStorage.setItem("olnu.terms", "1"); } catch (e) {} } });
    const tip = async (title) => {
      await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
      await page.evaluate(() => window.EVENTS.tip(window.BARS.byId("n3472634175") || null));
      await page.waitForSelector("#sheet .ev-kinds", { timeout: 10000 }).catch(() => {});
      await page.evaluate((t) => { const i = document.querySelector('#sheet input.inp[maxlength="80"]'); i.value = t; const b = [...document.querySelectorAll("#sheet .btn-green.btn-block")].pop(); b.click(); }, title);
      await wait(page, 900);
      await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /godkänner/i.test(x.textContent)); if (b) b.click(); }); await wait(page, 1200);
      return page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
    };
    const legal = await page.evaluate(() => { window.EVENTS.tip(window.BARS.byId("n3472634175")); return new Promise((r) => setTimeout(() => { const p = document.querySelector("#sheet .ev-legal"); r(p ? p.textContent : ""); document.getElementById("sheet-close").click(); }, 600)); });
    ok(/känd krog syns det direkt/.test(legal) && /Max 3 tips/.test(legal), "7 tip form says how it works (known bar = at once, max 3 a day)", legal);
    const t1 = await tip("Quiz på Pitchers");
    ok(/Ute på kartan/.test(t1), "7 an auto-ok tip says 'Ute på kartan' (not 'waits for approval')", t1);
    mode = "pending";
    const t2 = await tip("Karaoke på Pitchers");
    ok(!/Ute på kartan/.test(t2) && t2.length > 5, "7 a pending tip keeps the 'waits for the owner' toast", t2);
    mode = "limit";
    const t3 = await tip("Fjärde tipset");
    ok(/Max 3 tips om dan/.test(t3), "7 the 4th tip in a day: friendly 'Max 3 tips om dan' error", t3);
    // "Stämmer inte?" on a user event
    await page.evaluate(() => { const s = document.getElementById("sheet"); if (!s.hidden) document.getElementById("sheet-close").click(); });
    await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1500);
    await page.evaluate(() => window.EVSHEET.openDetail("9300")); await wait(page, 900);
    const wb = await page.evaluate(() => { const b = document.querySelector("#sheet-body .evs-detail .evs-wrong"); return b ? b.textContent : null; });
    await shot(page, "7-detail-wrong");
    ok(wb && /Stämmer inte\?/.test(wb), "7 a user event detail has 'Stämmer inte?'", wb);
    page.__calls.length = 0;
    await clickJS(page, "#sheet-body .evs-detail .evs-wrong"); await wait(page, 900);
    const rc = calls(page, /^report_event_tip$/);
    const after = await page.evaluate(() => { const b = document.querySelector("#sheet-body .evs-detail .evs-wrong"); return b ? { t: b.textContent, d: b.disabled } : null; });
    ok(rc.length === 1 && rc[0].body && rc[0].body.p_id === 9300 && after && after.d && /Tack/.test(after.t), "7 'Stämmer inte?' sends report_event_tip once and says thanks", { rc: rc.map((x) => x.body), after });
    await page.evaluate(() => window.EVSHEET.openDetail("9100")); await wait(page, 700);
    ok(await page.evaluate(() => !document.querySelector("#sheet-body .evs-detail .evs-wrong")), "7 a non-user event (quiz import) has no 'Stämmer inte?'");
    await ctx.close();
  }

  console.log("SUMMARY ownerfix pass=" + pass + " fail=" + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
