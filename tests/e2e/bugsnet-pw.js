// bugsnet-pw.js — lane bugsnet (19 Nov 2026). Each section FAILS on the old code (big-update 9b1fe98) and PASSES on the new code.
//   ver   I-129: the error log field `ver` is the build stamp (sw.js VERSION = the name of the service-worker cache the page came
//         from), not the app.js ?v= hash. Two version caches (an update waits): the one whose index.html names this page's ?v= tags.
//   chat  A3b group page chat (gpage.js): a post whose answer is lost (no network / timeout) but that the server saved = ONE line,
//         no "Inte skickat"; a lost post that the chat cannot check yet stays "Inte skickat" and its retry does not post a 2nd copy.
//   tell  A3b event "Säg till gruppen" (evsheet.js): the same two cases.
//   cam   A11: the map opens where the user was last (olnu.cam), else the last own fix, else the coarse home town (a town view, no
//         pin), else Ludvika; broken or blocked storage = Ludvika, no error; the camera is saved after a move.
//   sb    A2b: a Systembolaget card (systemet-pins.js, GL path) closes on a tap on its own pin (old: the same card opened again,
//         like I-110); a tap on the empty map closes it; a tap ON another store switches (one card).
// Mocked Supabase, 390 x 844 (sb: 412 x 860, stub Mapbox without MAPBOX_TEST_TOKEN). Usage: node bugsnet-pw.js <port> [ver,chat,tell,cam,sb]
const { ctxFor, boot, wait, clickJS, GID } = require("./ds-helpers.js");
const { H, TOKEN, launchOpts, closeCounted } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793;
const ONLY = (process.argv[3] || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const now = Date.now();
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const sect = async (k, fn) => { if (!want(k)) return; try { await fn(); } catch (e) { fail++; console.log("FAIL " + k + " stopped by an exception:", String(e.message).split("\n")[0].slice(0, 200)); } };
const noToasts = (page) => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));

async function openUi(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (o.init) await ctx.addInitScript(o.init, o.initArg || null);
  if (o.routes) await o.routes(page, ctx);
  await boot(page, o);
  await noToasts(page);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch(launchOpts([]));
  try {
    /* ---------- ver: I-129 the build stamp in the error log ---------- */
    await sect("ver", async () => {
      const sent = [];
      const { ctx, page, errs } = await openUi(browser, {
        init: () => { try { caches.open("olnu-1a2b3c4d5e"); } catch (e) {} },   // what the service worker makes: cache name = sw.js VERSION
        routes: async (page) => {
          page.on("request", (rq) => { if (/rpc\/pnlog_ingest/.test(rq.url())) sent.push(rq.postData() || ""); });
          await page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => J(r, { ok: true, mode: "on" }));
        } });
      const vers = () => sent.map((b) => { try { return JSON.parse(b).p.ver; } catch (e) { return "bad"; } });
      await page.evaluate(() => { window.PNLOG.event("err.bugsnet", { m: "ver check 1" }); return window.PNLOG.flush(); }); await wait(page, 900);
      const v1 = vers();
      ok("ver: every batch sends the build stamp olnu-1a2b3c4d5e (one version cache; old: the app.js hash or '?')", v1.length > 0 && v1.every((v) => v === "olnu-1a2b3c4d5e"), v1);
      // an update waits: two version caches. Ours = the one whose index.html names the ?v= tags of this page.
      const pick = await page.evaluate(async () => {
        const mk = async (k, html) => { const c = await caches.open(k); await c.put("./index.html", new Response(html, { headers: { "content-type": "text/html" } })); };
        await mk("olnu-aaaaaaaaaa", '<script src="./js/x.js?v=0123456789"></script><link rel="stylesheet" href="./y.css?v=1111111111">');
        await mk("olnu-bbbbbbbbbb", '<script src="./js/x.js?v=9876543210"></script><link rel="stylesheet" href="./y.css?v=1111111111">');
        ["./js/x.js?v=0123456789", "./y.css?v=1111111111"].forEach((u) => { const l = document.createElement("link"); l.rel = "x-bugsnet"; l.href = u; document.head.appendChild(l); });
        return window.PNLOG._build();
      });
      sent.length = 0;
      await page.evaluate(() => { window.PNLOG.event("err.bugsnet", { m: "ver check 2" }); return window.PNLOG.flush(); }); await wait(page, 900);
      const v2 = vers();
      ok("ver: two version caches (an update waits) = the one with this page's ?v= tags (olnu-aaaaaaaaaa)", pick === "olnu-aaaaaaaaaa" && v2.length > 0 && v2.every((v) => v === "olnu-aaaaaaaaaa"), { pick, v2 });
      ok("ver: the stamp fits the server column (24 chars)", v2.every((v) => String(v).length <= 24), v2);
      ok("ver: no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- chat: A3b group page chat, a lost answer ---------- */
    await sect("chat", async () => {
      const st = { posts: [], mode: "ok", down: false, next: 100, rows: [] };
      const save = (b) => { const m = { id: st.next++, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true }; st.rows.push(m); return m; };
      const { ctx, page, errs } = await openUi(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/post_group_msg/, async (r) => {
          const b = JSON.parse(r.request().postData() || "{}"); st.posts.push(b.p_body);
          if (st.mode === "lostSaved") { save(b); return r.abort("failed"); }   // the server saved it, the answer never came
          if (st.mode === "lostNot") return r.abort("failed");                   // it never reached the server
          const m = save(b); return J(r, { id: m.id, created_at: m.created_at });
        });
        await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => {
          const b = JSON.parse(r.request().postData() || "{}");
          if ((b.p_after_id | 0) <= 0) return r.fallback();
          if (st.down) return r.abort("failed");
          return J(r, st.rows.filter((m) => m.id > b.p_after_id));
        });
      } });
      await clickJS(page, "#btn-groups"); await wait(page, 1200);
      await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
      await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
      await page.waitForSelector(".gpg-inp", { timeout: 15000 }).catch(() => {});
      await wait(page, 2600); await noToasts(page);
      const rowsOf = (t) => page.evaluate((t) => [...document.querySelectorAll(".gpg-msgs > li")].filter((li) => li.textContent.indexOf(t) >= 0).map((li) => ({ c: li.className, t: li.textContent.trim() })), t);
      ok("chat setup: the group page chat box is there", await page.evaluate(() => !!document.querySelector(".gpg-inp")));
      // 1. lost answer, saved on the server
      st.mode = "lostSaved";
      await page.fill(".gpg-inp", "Bin på väg"); await page.click(".gpg-send"); await wait(page, 2500);
      const r1 = await rowsOf("Bin på väg");
      ok('chat: a lost answer that the server saved = ONE line, not "Inte skickat", one post (old: "Inte skickat" + a retry = 2 copies)', r1.length === 1 && !/gpg-fail/.test(r1[0].c) && st.posts.filter((p) => p === "Bin på väg").length === 1, { r1, posts: st.posts });
      // 2. lost answer, saved, and the chat cannot ask yet → "Inte skickat"; the retry finds it: no 2nd post
      st.mode = "lostSaved"; st.down = true;
      await page.fill(".gpg-inp", "Tar en taxi"); await page.click(".gpg-send"); await wait(page, 2000);
      const r2 = await rowsOf("Tar en taxi");
      ok('chat: lost and not checkable = ONE "Inte skickat" line', r2.length === 1 && /gpg-fail/.test(r2[0].c), r2);
      st.down = false; st.mode = "ok";
      await page.evaluate(() => { const f = [...document.querySelectorAll(".gpg-msgs > li.gpg-fail")].find((li) => li.textContent.indexOf("Tar en taxi") >= 0); if (f) f.click(); });
      await wait(page, 2500);
      const r3 = await rowsOf("Tar en taxi");
      ok("chat: the retry of a saved line posts nothing again: ONE line, 1 post (old: 2 posts)", r3.length === 1 && !/gpg-fail/.test(r3[0].c) && st.posts.filter((p) => p === "Tar en taxi").length === 1, { r3, posts: st.posts });
      // 3. guard: lost and NOT saved → "Inte skickat"; the retry posts it (2 posts, one line)
      st.mode = "lostNot";
      await page.fill(".gpg-inp", "Kommer snart"); await page.click(".gpg-send"); await wait(page, 2000);
      const r4 = await rowsOf("Kommer snart");
      st.mode = "ok";
      await page.evaluate(() => { const f = [...document.querySelectorAll(".gpg-msgs > li.gpg-fail")].find((li) => li.textContent.indexOf("Kommer snart") >= 0); if (f) f.click(); });
      await wait(page, 2500);
      const r5 = await rowsOf("Kommer snart");
      ok("chat guard: a line that never reached the server stays \"Inte skickat\"; its retry sends it (ONE line, 2 posts)", r4.length === 1 && /gpg-fail/.test(r4[0].c) && r5.length === 1 && !/gpg-fail/.test(r5[0].c) && st.posts.filter((p) => p === "Kommer snart").length === 2, { r4, r5, posts: st.posts });
      ok("chat: no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- tell: A3b the event line "Säg till gruppen", a lost answer ---------- */
    await sect("tell", async () => {
      const st = { posts: [], tells: {}, mode: "ok", down: false, next: 900, rows: [] };
      const ev = (id, title) => ({ id, title, kind: "quiz", starts_at: new Date(now + 3 * 3600e3).toISOString(), place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, town: "Ludvika" });
      const { ctx, page, errs } = await openUi(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/events_near2/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: [ev(501, "Pubquiz"), ev(502, "Bingo")] }));
        await page.route(/rest\/v1\/rpc\/event_go$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); return J(r, { ok: true, id: b.p_event_id, mine: true, n: 1, who: [{ name: "Anton", me: true }], told: false, remind: true }); });
        await page.route(/rest\/v1\/rpc\/event_go_tell/, (r) => { const b = JSON.parse(r.request().postData() || "{}"), k = b.p_event_id; st.tells[k] = (st.tells[k] || 0) + 1; return J(r, { ok: true, first: st.tells[k] === 1 }); });
        await page.route(/rest\/v1\/rpc\/post_group_msg/, async (r) => {
          const b = JSON.parse(r.request().postData() || "{}"); st.posts.push(b.p_body);
          const m = { id: st.next++, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true };
          if (st.mode === "lostSaved") { st.rows.push(m); return r.abort("failed"); }
          st.rows.push(m); return J(r, { id: m.id, created_at: m.created_at });
        });
        await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => {
          const b = JSON.parse(r.request().postData() || "{}");
          if (st.down) return r.abort("failed");
          return J(r, st.rows.filter((m) => m.id > (b.p_after_id | 0)));
        });
      } });
      const row = () => page.evaluate(() => [...document.querySelectorAll(".evs-tell-msg")].map((e) => ({ c: e.className, t: e.innerText.replace(/\s*\n\s*/g, " | ") })));
      const detail = async (title) => {
        await page.evaluate(() => { const c = document.getElementById("sheet-close"), s = document.getElementById("sheet"); if (s && !s.hidden && c) c.click(); }); await wait(page, 500);
        await page.evaluate("window.EVSHEET.open()"); await wait(page, 1500);
        await page.evaluate((t) => { const r = [...document.querySelectorAll(".evs-row")].find((x) => x.textContent.indexOf(t) >= 0); if (r) r.click(); }, title); await wait(page, 800);
        await page.evaluate(() => { const b = document.querySelector(".evs-dgar"); if (b) b.click(); }); await wait(page, 1500);
        await noToasts(page);
        return page.evaluate(() => document.querySelectorAll(".evs-tell .evs-tell-g").length);
      };
      // 1. lost answer, saved on the server
      ok('tell setup: "Säg till gruppen?" in the Pubquiz detail', (await detail("Pubquiz")) >= 1);
      st.mode = "lostSaved";
      await page.evaluate(() => document.querySelector(".evs-tell .evs-tell-g").click()); await wait(page, 2500);
      const t1 = await row(), n1 = st.posts.length;
      ok('tell: a lost answer that the server saved = "Skickat", one post (old: "Inte skickat", a retry = 2 copies)', t1.length === 1 && /evs-tell-ok/.test(t1[0].c) && n1 === 1, { t1, posts: st.posts });
      // 2. lost, saved, and the chat cannot ask yet → "Inte skickat"; the retry finds it: no 2nd post
      ok('tell setup: "Säg till gruppen?" in the Bingo detail', (await detail("Bingo")) >= 1);
      st.mode = "lostSaved"; st.down = true;
      await page.evaluate(() => document.querySelector(".evs-tell .evs-tell-g").click()); await wait(page, 2500);
      const t2 = await row();
      ok('tell: lost and not checkable = ONE "Inte skickat" line', t2.length === 1 && /evs-tell-fail/.test(t2[0].c), t2);
      st.down = false; st.mode = "ok";
      await page.evaluate(() => { const f = document.querySelector(".evs-tell-fail"); if (f) f.click(); }); await wait(page, 2500);
      const t3 = await row(), bingo = st.posts.filter((p) => /Bingo/.test(p)).length;
      ok("tell: the retry of a saved line posts nothing again: \"Skickat\", 1 post of it (old: 2 posts)", t3.length === 1 && /evs-tell-ok/.test(t3[0].c) && bingo === 1, { t3, posts: st.posts });
      ok("tell: event_go_tell asked once per event", st.tells[501] === 1 && st.tells[502] === 1, st.tells);
      ok("tell: no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- cam: A11 the camera opens where the user was last ---------- */
    await sect("cam", async () => {
      // the first setView of the map (app-map.js start) = the start camera
      const spy = () => {
        let m0;
        Object.defineProperty(window, "__map", { configurable: true, get() { return m0; }, set(m) {
          m0 = m; const sv = m.setView;
          m.setView = function (c, z) { if (!window.__firstView) { const ll = Array.isArray(c) ? c : [c.lat, c.lng]; window.__firstView = { lat: +ll[0], lng: +ll[1], z: z }; } return sv.apply(this, arguments); };
        } });
      };
      const seedLs = (o) => { if (sessionStorage.getItem("bn-cam")) return; sessionStorage.setItem("bn-cam", "1"); Object.keys(o).forEach((k) => localStorage.setItem(k, o[k])); };
      const run = async (ls, o = {}) => {
        const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, {});
        const errs = []; page.on("pageerror", (e) => errs.push(e.message));
        if (o.noGeo) await ctx.clearPermissions();
        await ctx.addInitScript(spy);
        await ctx.addInitScript(seedLs, ls);
        if (o.block) await ctx.addInitScript(() => { const gi = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (k === "olnu.cam") throw new Error("SecurityError: blocked"); return gi.call(this, k); }; });
        await page.goto("http://127.0.0.1:" + PORT + "/");
        await page.waitForFunction(() => !!window.__firstView, null, { timeout: 30000 }).catch(() => {});
        const v = await page.evaluate(() => window.__firstView || null);
        return { ctx, page, errs, v };
      };
      const near = (v, lat, lng) => !!v && Math.abs(v.lat - lat) < 0.001 && Math.abs(v.lng - lng) < 0.001;
      const J2 = (o) => JSON.stringify(o);
      // a) a saved camera (Göteborg, z 13.5)
      let x = await run({ "olnu.cam": J2({ lat: 57.7089, lng: 11.9746, z: 13.5, at: now - 60e3 }) });
      ok("cam: a saved camera = the map starts there (Göteborg z13.5; old: Ludvika z14)", near(x.v, 57.7089, 11.9746) && x.v.z === 13.5, x.v);
      // saved after a move
      await page_move(x.page);
      const saved = await x.page.evaluate(() => { try { return JSON.parse(localStorage.getItem("olnu.cam")); } catch (e) { return null; } });
      ok("cam: a move is saved (olnu.cam = Uppsala z15, fresh time)", !!saved && Math.abs(saved.lat - 59.8586) < 0.001 && Math.abs(saved.lng - 17.6389) < 0.001 && saved.z === 15 && Date.now() - saved.at < 30e3, saved);
      ok("cam: no page errors (a)", x.errs.length === 0, x.errs); await x.ctx.close();
      // b) no camera, the last own fix (Stockholm, 1 h old)
      x = await run({ "olnu.lastFix": J2({ lat: 59.3326, lng: 18.0649, at: now - 3600e3 }) });
      ok("cam: no camera = the last own fix (Stockholm z14; old: Ludvika)", near(x.v, 59.3326, 18.0649) && x.v.z === 14, x.v);
      await x.ctx.close();
      // c) only the coarse home town, no location permission: a town view, no pin
      x = await run({ "olnu.htPos": J2({ lat: 60.6, lng: 15.6, at: now - 86400e3 }) }, { noGeo: true });
      await wait(x.page, 4000);
      const dot = await x.page.evaluate(() => document.querySelectorAll(".me-dot").length);
      ok("cam: only the coarse home town = a town view (Falun z11) and NO pin (fastpos rule; old: Ludvika)", near(x.v, 60.6, 15.6) && x.v.z === 11 && dot === 0, { v: x.v, dot });
      await x.ctx.close();
      // d) broken data and blocked storage: Ludvika, no error
      x = await run({ "olnu.cam": "{not json" });
      ok("cam guard: a broken saved camera = Ludvika z14, no page error", near(x.v, 60.1496, 15.1878) && x.v.z === 14 && x.errs.length === 0, { v: x.v, e: x.errs });
      await x.ctx.close();
      x = await run({}, { block: true });
      ok("cam guard: storage that throws = Ludvika z14, no page error", near(x.v, 60.1496, 15.1878) && x.v.z === 14 && x.errs.length === 0, { v: x.v, e: x.errs });
      await x.ctx.close();
      // e) an old camera (40 days) is not used
      x = await run({ "olnu.cam": J2({ lat: 57.7089, lng: 11.9746, z: 13, at: now - 40 * 86400e3 }) });
      ok("cam guard: a camera older than 30 days is not used (Ludvika)", near(x.v, 60.1496, 15.1878), x.v);
      await x.ctx.close();
    });
    async function page_move(page) {
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 5000);   // the quiet locate() at start moves the map too: wait until it is done
      await page.evaluate(() => window.__map.setView([59.8586, 17.6389], 15, { animate: false }));
      await wait(page, 1800);
    }

    /* ---------- sb: A2b a Systembolaget card does not open again on a tap outside it ---------- */
    await sect("sb", async () => {
      const STUB_TOKEN = "pk.mapstubmapstubmapstubmapstub.stub";
      const STYLE = { version: 8, name: "stub", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#2b3260" } }] };
      const WK = ["600-1140", "600-1140", "600-1140", "600-1140", "600-1140", "600-900", ""];
      const A1 = [60.2, 15.35], A2 = [60.2, 15.3535];   // two stores in open country (no bar near), about 190 m apart
      const proxy = { newContext: (opt) => browser.newContext(Object.assign({}, opt, { isMobile: false, hasTouch: false, deviceScaleFactor: 1 })) };
      const { ctx, page } = await H.ctxFor(proxy, { width: 412, height: 860 }, {});
      await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 1, mapbox_token: TOKEN || STUB_TOKEN }));
      if (!TOKEN) await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, (r) => /\/styles\/v1\//.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }) : r.fulfill({ status: 204, body: "" }));
      await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
        const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
        try { const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
          await r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
        } catch (e) { r.abort().catch(() => {}); }
      });
      const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message); });
      await page.goto("https://tunela.github.io/Beer-map/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.GLBARS && GLBARS.on() && window.BASEMAP && BASEMAP.isMapbox() && window.SYSTEMET && SYSTEMET._stores() && SYSTEMET._gl().sig, null, { timeout: 45000 }).catch(() => console.log("GL / stores not ready"));
      await page.addStyleTag({ content: "#toasts{display:none !important}" }).catch(() => {});
      await page.evaluate(([w, a, b]) => { OPPET._set(null, { stores: [["Systembolaget", a[0], a[1], w, 0, "Storgatan 1, Testby"], ["Systembolaget", b[0], b[1], w, 0, "Bygatan 2, Testby"]] }); }, [WK, A1, A2]);
      await wait(page, 600);
      await page.evaluate(([ll]) => { __map.closePopup(); __map.setView(ll, 16, { animate: false }); }, [[60.2, 15.35175]]);
      await page.waitForFunction(() => { const g = BASEMAP.mapbox().getMapboxMap(); return g.loaded() && !g.isMoving(); }, null, { timeout: 20000 }).catch(() => {});
      await wait(page, 1500);
      const pins = await page.evaluate(() => { const g = BASEMAP.mapbox().getMapboxMap(), c = __map.getContainer().getBoundingClientRect(); return g.queryRenderedFeatures({ layers: [SYSTEMET.LAYER] }).map((f) => { const p = g.project(f.geometry.coordinates); return { k: f.properties.k, x: c.left + p.x, y: c.top + p.y }; }); });
      const pa = pins.find((p) => p.k === A1.join(",")), pb = pins.find((p) => p.k === A2.join(","));
      const card = () => page.evaluate(() => [...document.querySelectorAll(".sb-card")].map((e) => e.innerText.replace(/\s*\n\s*/g, " | ")));
      ok("sb setup: both store pins are drawn (GL)", !!pa && !!pb, pins);
      if (!pa || !pb) { await closeCounted(ctx, page, "bugsnet-sb"); return; }
      await page.mouse.click(pa.x, pa.y); await wait(page, 600);
      const c1 = await card();
      ok("sb setup: a tap on the pin opens its card", c1.length === 1 && /Storgatan 1/.test(c1[0]), c1);
      const under = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest(".mapboxgl-popup, .leaflet-popup, .sb-pop") ? "popup" : e.tagName + "." + String(e.className).slice(0, 30)) : "none"; }, [pa.x, pa.y]);
      ok("sb setup: the pin is outside the card (a tap there is a tap outside the card)", under !== "popup", under);
      // the bug: a tap on the open store's own pin (outside the card) opened the same card again
      await page.mouse.click(pa.x, pa.y); await wait(page, 600);
      const c2 = await card();
      ok("sb: a tap on the open store's own pin only closes the card (old: the same card again)", c2.length === 0, c2);
      // guard: the empty map closes it
      await page.mouse.click(pa.x, pa.y); await wait(page, 600);
      const c3 = await card();
      await page.mouse.click(pa.x, pa.y + 140); await wait(page, 600);
      const c4 = await card();
      ok("sb guard: with no card open the pin opens it; a tap on the empty map closes it", c3.length === 1 && c4.length === 0, { c3, c4 });
      // guard: a tap ON another store switches (one card)
      await page.mouse.click(pa.x, pa.y); await wait(page, 600);
      await page.mouse.click(pb.x, pb.y); await wait(page, 600);
      const c5 = await card();
      ok("sb guard: a tap ON another store's pin switches to its card (one card)", c5.length === 1 && /Bygatan 2/.test(c5[0]), c5);
      ok("sb: no page errors", errs.length === 0, errs);
      await closeCounted(ctx, page, "bugsnet-sb");
    });
  } finally { await browser.close(); }
  console.log("bugsnet-pw: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
