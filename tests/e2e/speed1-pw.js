// speed1-pw.js — lane speed1 (owner 14 Nov 2026: "When you press it, it's supposed to be immediate. Any loading that ever
// happens should be in the background"). Slow server (RPC 3 s) + slow GPS (5 s) + a kept exact fix (FASTPOS.last).
//  S1 PN.getPosition() with no options answers from the kept exact fix at once; own options keep the exact wait; a coarse
//     quick fix is never returned; the ÖL! path makes no 2nd quick try.
//  S2 Annat: toast + count + 10-min ring at the tap; the server answer confirms or takes it back.
//  S3 ticker: no layout read 4x per second; none while a sheet is open or the tab is hidden; the belt still runs.
//  S4 check-in: the checked-in state at the tap; error / cool-down takes it back.
//  S5 chat send: the line shows at once ("Skickar…"), then the real row; a failed send = "Inte skickat – tryck för att försöka igen".
//  S6 smooth.js: the CSS copy for the close ghost is not rebuilt for every <head> change.
// 390 px, mocked Supabase. Usage: node speed1-pw.js <port> [only: s1,s2,...]
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8803, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = (process.argv[3] || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
const GID = "11111111-2222-3333-4444-555555555555";

// A fake GPS under fastpos.js (it wraps this). window.__geo: { gpsMs, gpsAcc, netMs, netAcc, netErr, deny, calls: [] }.
function fakeGeo() {
  const G = window.__geo = { gpsMs: 5000, gpsAcc: 12, netMs: 5000, netAcc: 800, netErr: 0, deny: 0, calls: [] };
  const mk = (acc) => ({ coords: { latitude: 60.1511, longitude: 15.1876, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
  const g = navigator.geolocation;
  g.getCurrentPosition = function (okF, errF, o) {
    o = o || {};
    G.calls.push({ hi: !!o.enableHighAccuracy, age: o.maximumAge, to: o.timeout, at: Date.now() });
    if (G.deny) { setTimeout(() => errF && errF({ code: 1, message: "denied" }), 20); return; }
    if (!o.enableHighAccuracy && G.netErr) { setTimeout(() => errF && errF({ code: G.netErr, message: "x" }), 30); return; }
    const ms = o.enableHighAccuracy ? G.gpsMs : G.netMs, acc = o.enableHighAccuracy ? G.gpsAcc : G.netAcc;
    if (o.timeout && ms > o.timeout) { setTimeout(() => errF && errF({ code: 3, message: "timeout" }), o.timeout); return; }
    setTimeout(() => okF(mk(acc)), ms);
  };
  g.watchPosition = function () { return 1; };
  g.clearWatch = function () {};
  // S3: count layout reads on the ticker belt
  const T = window.__tk = { reads: 0, at: [] };
  const hit = (e) => { try { if (e && (e.id === "ticker-track" || (e.parentNode && e.parentNode.id === "ticker-track") || (e.firstElementChild && e.firstElementChild.id === "ticker-track"))) { T.reads++; T.at.push(performance.now()); } } catch (x) {} };
  [[HTMLElement.prototype, "offsetWidth"], [Element.prototype, "scrollWidth"], [Element.prototype, "clientWidth"]].forEach(([proto, k]) => {
    const d = Object.getOwnPropertyDescriptor(proto, k); if (!d || !d.get) return;
    Object.defineProperty(proto, k, { configurable: true, get() { hit(this); return d.get.call(this); } });
  });
  // S6: every text that goes into a constructed stylesheet (smooth.js ghost CSS)
  window.__css = [];
  try { ["replace", "replaceSync"].forEach((k) => { const f = CSSStyleSheet.prototype[k]; if (!f) return;
    CSSStyleSheet.prototype[k] = function (t) { try { window.__css.push({ n: String(t).length, at: Math.round(performance.now()), mark: /speed1-mark-(\d)/.test(String(t)) ? RegExp.$1 : "" }); } catch (e) {} return f.apply(this, arguments); }; }); } catch (e) {}
  const si = window.setInterval; window.__iv = [];
  window.setInterval = function (fn, ms) { try { window.__iv.push({ n: fn && fn.name, ms: ms }); } catch (e) {} return si.apply(this, arguments); };
}
const seedFix = (page, acc, ageMs) => page.evaluate(([acc, ageMs]) => {
  window.FASTPOS.last = { pos: { coords: { latitude: 60.1511, longitude: 15.1876, accuracy: acc }, timestamp: Date.now() - ageMs }, at: Date.now() - ageMs };
}, [acc == null ? 10 : acc, ageMs || 0]);
const noFix = (page) => page.evaluate(() => { window.FASTPOS.last = null; });

async function open(browser, o = {}, path) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  await ctx.addInitScript(fakeGeo);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (o.routes) await o.routes(page);
  if (path) { await page.goto(BASE + path); await page.waitForFunction(() => window.__map && window.PN && window.PN.getPosition, null, { timeout: 30000 }).catch(() => console.log("no boot")); await wait(page, 3500); }
  else await boot(page);
  await page.waitForFunction(() => window.FASTPOS && window.PN && window.PN.getPosition && window.MYCOUNT, null, { timeout: 15000 }).catch(() => console.log("no FASTPOS"));
  return { ctx, page, errs };
}
// run fn in the page and tell how long its promise took
const timed = (page, body) => page.evaluate(`(async () => { const t0 = performance.now(); let v, e = null; try { v = await (${body}); } catch (x) { e = x && x.code != null ? x.code : String(x); }
  return { ms: Math.round(performance.now() - t0), acc: v && v.coords ? v.coords.accuracy : null, err: e }; })()`);

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- S1: GPS wait ---------- */
    if (want("s1")) {
      const { ctx, page, errs } = await open(browser);
      await seedFix(page, 10, 30e3);
      let r = await timed(page, "PN.getPosition()");
      ok("S1 a kept exact fix (30 s old, 10 m) answers PN.getPosition() at once (GPS takes 5 s)", r.ms < 300 && r.acc === 10, r);
      await page.evaluate(() => { window.__geo.gpsMs = 1200; window.__geo.calls.length = 0; });
      r = await timed(page, "PN.getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })");
      let calls = await page.evaluate(() => window.__geo.calls.filter((c) => c.age === 0));
      ok("S1 a caller with its own options still gets a new exact fix (not the kept one)", r.ms >= 1000 && r.acc === 12 && calls.length === 1 && calls[0].hi, { r, calls });
      // a later coarse fix (any module's quick network fix) does not push out the kept exact fix
      await seedFix(page, 10, 30e3); await page.evaluate(() => { const G = window.__geo; G.netMs = 50; G.netAcc = 800; });
      await page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition(res, res, { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 })));
      r = await timed(page, "PN.getPosition()");
      ok("S1 a later coarse fix (800 m) does not push out the kept exact fix", r.ms < 300 && r.acc === 10, r);
      // no kept fix, the quick network fix is coarse (800 m): the answer is the exact one, never the coarse one
      await noFix(page); await page.evaluate(() => { const G = window.__geo; G.gpsMs = 900; G.netMs = 100; G.netAcc = 800; G.calls.length = 0; });
      r = await timed(page, "PN.getPosition()");
      ok("S1 a coarse quick fix (800 m) is not returned: the exact wait answers (12 m)", r.acc === 12 && r.ms >= 900, r);
      // a kept COARSE fix is not used either
      await seedFix(page, 500, 5e3);
      r = await timed(page, "PN.getPosition()");
      ok("S1 a kept coarse fix (500 m) is not used", r.acc === 12, r);
      // no kept fix, the quick network fix is exact enough (40 m): fast, no exact GPS call
      await noFix(page); await page.evaluate(() => { const G = window.__geo; G.gpsMs = 5000; G.netMs = 150; G.netAcc = 40; G.calls.length = 0; });
      r = await timed(page, "PN.getPosition()");
      calls = await page.evaluate(() => window.__geo.calls.slice());
      ok("S1 no kept fix + a good quick fix (40 m): answer in < 0.6 s, no exact GPS wait", r.ms < 600 && r.acc === 40 && !calls.some((c) => c.hi), { r, calls });
      // ÖL! path (app-beer.js tapPos): forTap falls back to PN.getPosition(): only ONE quick try
      await noFix(page); await page.evaluate(() => { const G = window.__geo; G.gpsMs = 300; G.netErr = 2; G.calls.length = 0; });
      r = await timed(page, "FASTPOS.forTap(function () { return PN.getPosition(); })");
      calls = await page.evaluate(() => window.__geo.calls.slice());
      ok("S1 ÖL! fallback: one quick try, then the exact wait (no 2nd quick try)", r.acc === 12 && calls.filter((c) => !c.hi).length === 1 && calls.filter((c) => c.hi).length === 1, { r, calls });
      await noFix(page); await page.evaluate(() => { const G = window.__geo; G.netErr = 0; G.deny = 1; });
      r = await timed(page, "PN.getPosition()");
      ok("S1 location denied: PN.getPosition() rejects with code 1 at once", r.err === 1 && r.ms < 500, r);
      ok("S1 no page error", errs.length === 0, errs);
      await ctx.close();
    }

    /* ---------- S2: Annat ---------- */
    if (want("s2")) {
      const run = async (name, answer) => {
        const srv = { n: 0, mine: null, done: false };
        const { ctx, page, errs } = await open(browser, { routes: async (page) => {
          await page.route(/rest\/v1\/rpc\/post_other(_v2)?\b/, async (r) => { srv.n++; await new Promise((z) => setTimeout(z, 3000)); srv.done = true; return answer(r); });
          // the poll after an accepted drink has it (as the real server does)
          await page.route(/rest\/v1\/rpc\/live_others\b/, (r) => J(r, srv.done && srv.ok && srv.mine != null ? [{ beer_id: srv.mine, other_count: 1, other_kind: "vin" }] : []));
        } });
        srv.ok = /^accepted/.test(name); srv.mine = await page.evaluate(() => { const m = window.PN.myBeer && window.PN.myBeer(); return m ? m.id : null; });
        await seedFix(page, 10, 20e3);
        await page.evaluate(() => { localStorage.removeItem("olnu.otherCd"); document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()); });
        await page.evaluate(() => document.getElementById("btn-other").click());
        await page.waitForFunction(() => !!document.querySelector('.kind-btn[data-kind="vin"]'), null, { timeout: 5000 }).catch(() => {});
        await wait(page, 600);
        const snap = () => page.evaluate(() => ({
          toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => ({ t: x.textContent, err: x.classList.contains("err") })),
          want: window.MYCOUNT._state().want, burst: (document.querySelector(".pm-burst .pm-new") || {}).textContent || null,
          cd: document.getElementById("btn-other").classList.contains("cooldown"), ls: +localStorage.getItem("olnu.otherCd") > Date.now(),
          busy: document.getElementById("btn-other").classList.contains("busy") }));
        const before = (await snap()).want;
        const at0 = await page.evaluate(() => new Promise((res) => {
          const t0 = performance.now(); document.querySelector('.kind-btn[data-kind="vin"]').click();
          const sync = { toast: !!document.querySelector("#toasts .toast"), want: window.MYCOUNT._state().want };
          setTimeout(() => res({ sync, ms: Math.round(performance.now() - t0) }), 250);
        }));
        const a = await snap();
        ok(`S2 ${name}: at the tap (< 300 ms, GPS 5 s, server 3 s): one line "Drinken räknas", count ${before} -> ${before + 1}, the 10-min ring runs`,
          a.toasts.length === 1 && /räknas/.test(a.toasts[0].t) && a.want === before + 1 && a.cd && a.ls && at0.sync.toast && at0.sync.want === before + 1, { before, at0, a });
        ok(`S2 ${name}: no busy pulse in the first 0.9 s`, !a.busy, a);
        await wait(page, 1300);
        ok(`S2 ${name}: the request left within 1.5 s (position from the kept fix)`, srv.n === 1, srv);
        await wait(page, 2700);
        const b = await snap();
        await ctx.close();
        return { before, b, srv, errs };
      };
      let r = await run("accepted", (q) => J(q, { accepted: true, other_count: 1, beer_count: 6, drinks: 7, wait_seconds: 600, lat: 60.1511, lng: 15.1876 }));
      ok("S2 accepted: the same toast now shows the drink line, the count stays, one request, ring on", r.b.toasts.length === 1 && !/räknas/.test(r.b.toasts[0].t) && !r.b.toasts[0].err && r.b.want === r.before + 1 && r.b.cd && r.srv.n === 1, r);
      ok("S2 accepted: no page error", r.errs.length === 0, r.errs);
      r = await run("refused (10-min rule)", (q) => J(q, { accepted: false, wait_seconds: 400 }));
      ok("S2 refused: the count goes back, one calm line with the wait, the ring stays (server rule)", r.b.want === r.before && !r.b.burst && r.b.toasts.length === 1 && /6:\d\d|vänta|Vänta/i.test(r.b.toasts[0].t) && !r.b.toasts[0].err && r.b.cd, r);
      r = await run("server error", (q) => J(q, { code: "XX000", message: "boom" }, 500));
      ok("S2 error: the count and the ring go back, one error line, no pending line left", r.b.want === r.before && !r.b.burst && !r.b.cd && !r.b.ls && r.b.toasts.length === 1 && r.b.toasts[0].err && !/räknas/.test(r.b.toasts[0].t), r);
    }

    /* ---------- S3: ticker ---------- */
    if (want("s3")) {
      const { ctx, page, errs } = await open(browser);
      await wait(page, 2500);
      const belt = () => page.evaluate(() => { const t = document.getElementById("ticker-track"), v = t.parentNode.getBoundingClientRect(), f = t.firstElementChild.getBoundingClientRect(), l = t.lastElementChild.getBoundingClientRect();
        return { n: t.children.length, firstRight: Math.round(f.right - v.left), lastRight: Math.round(l.right - v.right), vw: Math.round(v.width), first: t.firstElementChild.textContent.slice(0, 30) }; });
      const count = async (ms) => { await page.evaluate(() => { window.__tk.reads = 0; window.__tk.at = []; }); await wait(page, ms);
        return page.evaluate(() => { const a = window.__tk.at; let c = 0, last = -1e9; a.forEach((t) => { if (t - last > 50) c++; last = t; }); return { reads: window.__tk.reads, passes: c }; }); };
      const idle = await count(5000);
      const iv = await page.evaluate(() => window.__iv.filter((x) => x.n === "tickKeep"));
      console.log("     ticker 5 s idle: " + idle.reads + " layout reads in " + idle.passes + " passes; keeper timer " + JSON.stringify(iv));
      ok("S3 idle 5 s: at most 3 layout passes on the belt (old code: 20, 4 per second)", idle.passes <= 3, idle);
      ok("S3 the keeper runs once per second (was 250 ms)", iv.length === 1 && iv[0].ms === 1000, iv);
      const b0 = await belt();
      await wait(page, 14000);
      const b1 = await belt();
      ok("S3 the belt still runs: old pieces are dropped, new ones are added, never empty on the right", b1.first !== b0.first && b1.n < b0.n + 8 && b1.firstRight > -150 && b1.lastRight > b1.vw * 0.5, { b0, b1 });
      // a sheet is open: no read at all once the belt stands
      await page.evaluate(() => document.getElementById("btn-top").click());
      await wait(page, 2500);
      const sheet = await count(3000);
      const st = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, f: window.PN_TICK_F }));
      ok("S3 sheet open: no layout read on the belt (3 s)", st.open && sheet.reads === 0, { sheet, st });
      await page.evaluate(() => document.getElementById("sheet-close").click());
      await wait(page, 3000);
      const b2 = await belt();
      await wait(page, 6000);
      const b3 = await belt();
      ok("S3 after the sheet closes the belt runs on and is kept full", b3.lastRight > b3.vw * 0.5 && b3.firstRight > -150 && (b3.first !== b2.first || b3.firstRight < b2.firstRight), { b2, b3 });
      // hidden tab
      await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
      await wait(page, 1200);
      const hid = await count(3000);
      ok("S3 hidden tab: no layout read on the belt (3 s)", hid.reads === 0, hid);
      ok("S3 no page error", errs.length === 0, errs);
      await ctx.close();
    }

    /* ---------- S4: check-in ---------- */
    if (want("s4")) {
      const run = async (name, answer) => {
        const srv = { n: 0 };
        const { ctx, page, errs } = await open(browser, { checkin: false, routes: async (page) => {
          await page.route(/rest\/v1\/rpc\/check_in\b/, async (r) => {
            srv.n++; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
            await new Promise((z) => setTimeout(z, 3000));
            if (srv.ok) srv.mine = { bar_id: body.p_bar_id, bar_name: body.p_bar_name, lat: body.p_lat, lng: body.p_lng, name: "Anton", is_mine: true, is_friend: false, created_at: new Date().toISOString() };
            return answer(r, body); });
          await page.route(/rest\/v1\/rpc\/live_checkins\b/, (r) => J(r, srv.mine ? [srv.mine] : []));   // the server has my check-in only after a yes
        } }, "?bar=n3472634175");
        srv.ok = name === "ok";
        await page.waitForFunction(() => !!document.querySelector(".ci-btn[data-ci]"), null, { timeout: 12000 }).catch(() => console.log("no .ci-btn"));
        await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()));
        const snap = () => page.evaluate(() => { const o = document.querySelector(".ci-out[data-ciout]"), b = document.querySelector(".ci-btn[data-ci]"), c = JSON.parse(localStorage.getItem("olnu.checkin") || "null");
          return { here: !!document.querySelector(".ci-here"), out: !!o, outOff: !!(o && o.disabled), btn: !!b, btnOff: !!(b && b.disabled), btnText: b ? b.textContent : null, ls: c && c.id,
            toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => ({ t: x.textContent, err: x.classList.contains("err") })) }; });
        const s0 = await snap();
        const sync = await page.evaluate(() => { document.querySelector(".ci-btn[data-ci]").click(); return { here: !!document.querySelector(".ci-here"), toast: !!document.querySelector("#toasts .toast") }; });
        await wait(page, 250);
        const a = await snap();
        ok(`S4 ${name}: at the tap (server 3 s): "incheckad" + Checka ut (off until the server has it), one toast, the phone knows the bar`,
          s0.btn && !s0.here && sync.here && sync.toast && a.here && a.out && a.outOff && !a.btn && a.ls === "n3472634175" && a.toasts.length === 1 && !a.toasts[0].err, { s0, sync, a });
        await wait(page, 3600);
        const b = await snap();
        await ctx.close();
        return { b, srv, errs };
      };
      let r = await run("ok", (q, body) => J(q, { ok: true, bar_name: body.p_bar_name, wait_seconds: 0 }));
      ok("S4 ok: the state stays, Checka ut works now, one request", r.b.here && r.b.out && !r.b.outOff && r.b.ls === "n3472634175" && r.srv.n === 1, r);
      ok("S4 ok: no page error", r.errs.length === 0, r.errs);
      r = await run("cool-down", (q) => J(q, { ok: false, wait_seconds: 90 }));
      ok("S4 cool-down (ok:false): Checka in is back and works, the phone forgets the bar, one line with the wait", !r.b.here && !r.b.out && r.b.btn && !r.b.btnOff && /Checka in/.test(r.b.btnText) && !r.b.ls && r.b.toasts.length === 1 && /90/.test(r.b.toasts[0].t), r);
      r = await run("server error", (q) => J(q, { code: "XX000", message: "boom" }, 500));
      ok("S4 error: Checka in is back, the phone forgets the bar, one error line", !r.b.here && !r.b.out && r.b.btn && !r.b.btnOff && !r.b.ls && r.b.toasts.length === 1 && r.b.toasts[0].err, r);
    }

    /* ---------- S5: group chat send ---------- */
    if (want("s5")) {
      const chat = async (S) => {
        const { ctx, page, errs } = await open(browser, { routes: async (page) => {
          await page.route(/rest\/v1\/rpc\/(post_group_msg|group_msgs)\b/, async (r) => {
            const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
            if (fn === "group_msgs") return J(r, S.msgs.filter((m) => m.id > (body.p_after_id || 0)));
            S.posts++;
            const row = { id: 100 + S.posts, name: "Anton", body: body.p_body, created_at: new Date().toISOString(), is_me: true };
            if (S.early && !S.fail) S.msgs.push(row);   // saved at once, the answer is slow
            await new Promise((z) => setTimeout(z, S.ms));
            if (S.fail) return J(r, { code: "XX000", message: "boom" }, 500);
            if (!S.early) S.msgs.push(row);
            return J(r, { id: row.id });
          });
        } });
        await page.evaluate((g) => window.SOCIAL.openChat({ id: g, name: "Ludvika Lager" }), GID);
        await page.waitForFunction(() => document.querySelectorAll(".chat-list li.chat-msg[data-mid]").length >= 2 && document.getElementById("chat-inp"), null, { timeout: 12000 }).catch(() => console.log("no chat"));
        await wait(page, 500);
        await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()));
        return { ctx, page, errs };
      };
      const snap = (page, t) => page.evaluate((t) => { const p = document.querySelector(".chat-list li.pn-pend");
        return { pend: document.querySelectorAll(".chat-list li.pn-pend").length, pendText: p ? p.textContent : "", fail: !!(p && p.classList.contains("pn-fail")),
          real: [...document.querySelectorAll(".chat-list li.chat-msg.me[data-mid] .cm-body")].filter((b) => b.textContent === t).length,
          copies: [...document.querySelectorAll(".chat-list li.chat-msg.me")].filter((li) => li.textContent.includes(t)).length,
          inp: document.getElementById("chat-inp").value, off: document.querySelector(".chat-send").disabled,
          toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => ({ t: x.textContent, err: x.classList.contains("err") })) }; }, t);
      const send = (page, t) => page.evaluate((t) => { const i = document.getElementById("chat-inp"); i.value = t; document.querySelector(".chat-send").click();
        const p = document.querySelector(".chat-list li.pn-pend"); return { pend: !!p, text: p ? p.textContent : "" }; }, t);
      const base = [{ id: 1, name: "Lisa", body: "Var é ni?", created_at: new Date(Date.now() - 3e6).toISOString(), is_me: false }, { id: 2, name: "Oskar", body: "La Parma", created_at: new Date(Date.now() - 2e6).toISOString(), is_me: false }];
      // a. slow server (3 s): the line at once, then the real row, one copy
      {
        const S = { msgs: base.slice(), posts: 0, ms: 3000 }, T = "Kommer om fem";
        const { ctx, page, errs } = await chat(S);
        const sync = await send(page, T); await wait(page, 250);
        const a = await snap(page, T);
        ok('S5 group chat: my line is in the list at the tap as "Skickar…" (server 3 s), the box is empty', sync.pend && sync.text.includes(T) && /Skickar/.test(sync.text) && a.pend === 1 && a.inp === "" && a.real === 0, { sync, a });
        await page.waitForFunction((t) => [...document.querySelectorAll(".chat-list li.chat-msg.me[data-mid] .cm-body")].some((b) => b.textContent === t), T, { timeout: 8000 }).catch(() => null);
        await wait(page, 400);
        const b = await snap(page, T);
        ok("S5 group chat: the real row replaces the bubble: exactly 1 copy, 1 post, no error", b.pend === 0 && b.real === 1 && b.copies === 1 && S.posts === 1 && !b.toasts.some((x) => x.err), { b, posts: S.posts });
        ok("S5 group chat: no page error", errs.length === 0, errs);
        await ctx.close();
      }
      // b. the send fails: "Inte skickat – tryck för att försöka igen"; a tap sends it again
      {
        const S = { msgs: base.slice(), posts: 0, ms: 1500, fail: true }, T = "Hallå där";
        const { ctx, page } = await chat(S);
        await send(page, T); await wait(page, 2300);
        const a = await snap(page, T);
        ok('S5 failed send: the bubble stays as "Inte skickat – tryck för att försöka igen", one error line, Skicka works again', a.pend === 1 && a.fail && /Inte skickat/.test(a.pendText) && a.pendText.includes(T) && a.real === 0 && !a.off && a.toasts.length === 1 && a.toasts[0].err, a);
        S.fail = false;
        await page.evaluate(() => { document.getElementById("chat-inp").value = "nytt utkast"; const f = document.querySelector(".chat-list li.pn-fail"); if (f) f.click(); });
        await wait(page, 300);
        const b = await snap(page, T);
        ok('S5 retry: a tap on the bubble sends it again ("Skickar…"), what I typed since stays in the box', b.pend === 1 && !b.fail && /Skickar/.test(b.pendText) && S.posts === 2 && b.inp === "nytt utkast", { b, posts: S.posts });
        await page.waitForFunction((t) => [...document.querySelectorAll(".chat-list li.chat-msg.me[data-mid] .cm-body")].some((x) => x.textContent === t), T, { timeout: 8000 }).catch(() => null);
        await wait(page, 400);
        const c = await snap(page, T);
        ok("S5 retry: sent, exactly 1 copy, the draft is still in the box", c.pend === 0 && c.real === 1 && c.copies === 1 && c.inp === "nytt utkast", c);
        await ctx.close();
      }
      // c. the poll brings my line before the (slow) answer: no 2nd copy
      {
        const S = { msgs: base.slice(), posts: 0, ms: 9000, early: true }, T = "Poll först";
        const { ctx, page } = await chat(S);
        await send(page, T);
        await page.waitForFunction((t) => [...document.querySelectorAll(".chat-list li.chat-msg.me[data-mid] .cm-body")].some((x) => x.textContent === t), T, { timeout: 9000 }).catch(() => null);
        await wait(page, 200);
        const a = await snap(page, T);
        await wait(page, 3200);
        const b = await snap(page, T);
        ok("S5 the poll returns my line before the answer: the bubble goes, 1 copy then and after the answer", a.real === 1 && a.copies === 1 && a.pend === 0 && b.real === 1 && b.copies === 1 && b.pend === 0, { a, b });
        await ctx.close();
      }
    }

    /* ---------- S6: the ghost CSS copy ---------- */
    if (want("s6")) {
      const { ctx, page, errs } = await open(browser);
      await page.waitForFunction(() => window.__css.reduce((n, x) => n + x.n, 0) > 200000, null, { timeout: 25000 }).catch(() => console.log("no CSS copy"));
      await wait(page, 9000);   // load + 2.5 s, the lazy files at 3 s
      const all = await page.evaluate(() => { let n = 0; [...document.styleSheets].forEach((sh) => { try { [...sh.cssRules].forEach((r) => { n += r.cssText.length; }); } catch (e) {} }); return n; });
      const css = () => page.evaluate(() => ({ chars: window.__css.reduce((n, x) => n + x.n, 0), copies: window.__css.length, marks: window.__css.filter((x) => x.mark).map((x) => x.mark + ":" + x.n).join(","), sheets: document.styleSheets.length }));
      const a = await css();
      console.log("     ghost CSS after start: page CSS " + all + " chars; copied " + JSON.stringify(a));
      ok("S6 start: the page CSS is copied ONCE (old code: again 2.5 s after load and for every <head> change)", a.chars > all * 0.5 && a.chars < all * 1.3, { all, a });
      // 2 modules add a <style>, a lazy <script> comes into <head>
      for (const k of [1, 2]) {
        await page.evaluate((k) => { const st = document.createElement("style"); st.textContent = ".speed1-mark-" + k + "{color:red}"; document.head.appendChild(st);
          const sc = document.createElement("script"); sc.type = "text/x-nothing"; document.head.appendChild(sc); }, k);
        await wait(page, 7500);
      }
      const b = await css();
      console.log("     ghost CSS after 2 new <style> + 2 <script> in <head>: " + JSON.stringify(b));
      ok("S6 new <style> nodes: only the new sheet is copied (< 5 KB more; old code: all CSS again, twice)", b.chars - a.chars < 5000 && /1:\d+/.test(b.marks) && /2:\d+/.test(b.marks), { a, b });
      // the close ghost still works
      await page.evaluate(() => document.getElementById("btn-top").click());
      await wait(page, 1500);
      const g0 = await page.evaluate(() => window.SMOOTH.stats.ghost);
      await page.evaluate(() => document.getElementById("sheet-close").click());
      await wait(page, 100);
      const g = await page.evaluate(() => ({ n: window.SMOOTH.stats.ghost, host: !!document.querySelector(".sm-ghost-host") }));
      ok("S6 the sheet close still slides out (ghost made)", g.n === g0 + 1 && g.host, { g0, g });
      ok("S6 no page error", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\nspeed1: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
