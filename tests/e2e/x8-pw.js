// lane x8 (11 Nov 2026): weak-signal mode. ÖL! instant feedback + outbox (offline / slow 3G / lost answer), stale caption
// "Senast uppdaterad HH:MM" + poll back-off, no double log after a reload, LÄSK! and spökläge rules.
// usage: node x8-pw.js <port> [part,part…]   parts: offline, slow, neterr, reload, reload2, stale, cold, lask, ghost, pace, limits, shots
// Mocked Supabase (ds-helpers). This test answers poll_v2 (the new path) and post_beer_v2 itself, with the server's
// 10-min cooldown, so a re-sent beer is answered like the real server would.
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const PARTS = (process.argv[3] || "offline,slow,neterr,reload,reload2,stale,cold,lask,ghost,pace,limits,shots").split(",");
const { wait } = H;
require("fs").mkdirSync(SP + "x8-shots", { recursive: true });
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 400))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const VH = { 360: 780, 390: 844, 430: 932 };
const shot = (p, n) => p.screenshot({ path: SP + "x8-shots/" + n + ".png" });
const COOL = 10 * 60e3;

// pins around Ludvika (Pitchers / La Parma)
const PINS = [];
[[60.14997, 15.18679], [60.15124, 15.18797], [60.15098, 15.18663], [60.1545, 15.196], [60.1462, 15.1801], [60.1478, 15.204], [60.161, 15.189], [60.1431, 15.195]]
  .forEach((ll, i) => PINS.push({ id: 5000 + i, lat: ll[0], lng: ll[1], beer_count: 1 + (i % 5), other_count: 0, precise: true, created_at: new Date(Date.now() - (20 + i) * 60e3).toISOString(),
    is_mine: false, friend_name: i === 1 ? "Oskar" : null, skal_count: 0, i_skaled: false }));

// one fake server per page: poll_v2, post_beer_v2 (+ cooldown), pickup_poll (driving), and "no net" for every Supabase call
async function server(ctx, page, o = {}) {
  const srv = { down: false, pollDown: false, postSlow: 0, postFail: false, loseAnswer: false, noBeerAt: !!o.noBeerAt, drive: !!o.drive,
    posts: 0, accepted: 0, count: 6, beerAt: 0, polls: 0, pollOk: 0, hidden: [], log: [] };
  const ans = () => ({ v: 1, server_time: new Date().toISOString(), full: true, bbox: [59.5, 14.5, 60.8, 15.9], pins: PINS, capped: false, pins_in_view: PINS.length, live_total: 12,
    me: Object.assign({ id: 1, beer_count: srv.count, other_count: 0, other_kind: null, hidden: false, ghost: false, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
      wait_seconds: srv.beerAt && Date.now() - srv.beerAt < COOL ? Math.ceil((srv.beerAt + COOL - Date.now()) / 1000) : 0, undo_until: null, undos_left: 3 },
      srv.noBeerAt ? {} : { beer_at: srv.beerAt ? new Date(srv.beerAt).toISOString() : null }),
    checkins: [{ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }] });
  await page.route(/supabase\.co\/(rest|auth|functions)\//, (r) => (srv.down ? r.abort("internetdisconnected") : r.fallback()));
  await page.route(/rest\/v1\/rpc\/(poll_v2|post_beer_v2|post_beer|pickup_poll|driver_set)\b/, async (r) => {
    if (srv.down) return r.abort("internetdisconnected");
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "pickup_poll") return J(r, { v: 1, driving: srv.drive, incoming: [], mine: null });
    if (fn === "driver_set") { srv.drive = !!b.p_on; return J(r, { v: 1, ok: true, driving: srv.drive }); }
    if (fn === "poll_v2") { srv.polls++; srv.log.push(Date.now()); if (srv.pollDown) return r.abort("failed"); srv.pollOk++; return J(r, ans()); }
    // post_beer_v2 / post_beer
    srv.posts++;
    if (srv.postSlow) await new Promise((res) => setTimeout(res, srv.postSlow));
    if (srv.postFail) return r.abort("failed");
    let out;
    if (srv.beerAt && Date.now() - srv.beerAt < COOL) out = { accepted: false, wait_seconds: Math.ceil((srv.beerAt + COOL - Date.now()) / 1000), id: 1, beer_count: srv.count, lat: b.p_lat, lng: b.p_lng };
    else {
      srv.accepted++; srv.count++; srv.beerAt = Date.now(); srv.hidden.push(!!b.p_hidden);
      out = { accepted: true, wait_seconds: 0, id: 1, lat: b.p_lat, lng: b.p_lng, beer_count: srv.count, is_new: false, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
        milestone: null, hidden: !!b.p_hidden, undo_until: new Date(Date.now() + 120e3).toISOString(), undos_left: 3, drinks: srv.count };
    }
    if (srv.loseAnswer) return r.abort("connectionreset");   // the server did it, the phone never hears back
    return J(r, out);
  });
  return srv;
}
// boot: the map, the first good poll (pins in the app state), then the view over Ludvika
async function boot(page, reload) {
  if (reload) await page.reload(); else await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.__map && window.PNDS && window.PNDS._A && window.PNDS._A() && window.PNDS._A().beers().length > 3, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
  await wait(page, 2500);
}
async function open(browser, w, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] || 844 }, o);
  const srv = await server(ctx, page, o);
  if (o.init) await page.addInitScript(o.init);
  await boot(page);
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); const s = document.getElementById("sheet"); if (s && !s.hidden && window.PNDS && window.PNDS._A) window.PNDS._A().closeSheet(); });
  return { ctx, page, srv };
}
const outbox = (page) => page.evaluate(() => { try { const q = JSON.parse(localStorage.getItem("olnu.x8.outbox") || "[]"); return Array.isArray(q) ? q.length : -1; } catch (e) { return -2; } });
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
const redToasts = (page) => page.evaluate(() => document.querySelectorAll("#toasts .toast.err").length);
const cap = (page) => page.evaluate(() => {
  const c = document.getElementById("x8-stale"), ban = document.getElementById("offline-banner"), hud = document.querySelector(".hud-left");
  const vis = (e) => !!(e && !e.hidden && e.getClientRects().length && getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0");
  const r = c && vis(c) ? c.getBoundingClientRect() : null, hr = hud ? hud.getBoundingClientRect() : null;
  return { on: vis(c), txt: c ? c.textContent : "", red: vis(ban), below: !!(r && hr && r.top >= hr.top + 20), inside: !!(r && r.left >= 0 && r.right <= innerWidth),
    bg: c ? getComputedStyle(c).backgroundColor : "" };
});
const hhmm = (ms) => { const d = new Date(ms); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
// tap ÖL! and time the first feedback (splash call + first toast) inside the page
const tapTimed = (page) => page.evaluate(() => new Promise((res) => {
  const t0 = performance.now(), out = { splash: -1, toast: -1, text: "" };
  const fx = window.FX, orig = fx.splash; fx.splash = function () { if (out.splash < 0) out.splash = performance.now() - t0; return orig.apply(this, arguments); };
  const box = document.getElementById("toasts");
  const mo = new MutationObserver(() => { const t = box.querySelector(".toast"); if (t && out.toast < 0) { out.toast = performance.now() - t0; out.text = t.textContent; t.setAttribute("data-x8test", "1"); } });
  mo.observe(box, { childList: true, subtree: true, characterData: true });
  document.getElementById("btn-beer").click();
  setTimeout(() => { mo.disconnect(); fx.splash = orig; res(out); }, 1200);
}));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });

  if (PARTS.includes("offline")) {
    // offline ÖL! → instant feedback, outbox 1, no RPC; back online → exactly 1 beer RPC, outbox empty, "Ölen från HH:MM ä skickad"
    const { ctx, page, srv } = await open(browser, 390);
    srv.down = true; await ctx.setOffline(true); await wait(page, 400);
    const posts0 = srv.posts, tapAt = Date.now();
    const f = await tapTimed(page);
    ok(f.splash >= 0 && f.splash < 150 && f.toast >= 0 && f.toast < 600, "offline: ÖL! gives feedback at once (splash + toast, no RPC wait)", f);
    ok(/Skickas när du har täckning/.test(f.text) && !(await redToasts(page)), "offline: the toast says 'Skickas när du har täckning' (no red error)", f.text);
    ok((await outbox(page)) === 1 && srv.posts === posts0, "offline: the outbox has 1 beer, no beer RPC sent", { outbox: await outbox(page), posts: srv.posts - posts0 });
    const c = await cap(page);
    ok(c.on && /Senast uppdaterad \d\d:\d\d/.test(c.txt) && !c.red, "offline: one calm 'Senast uppdaterad HH:MM' caption, no red offline banner", c);
    await shot(page, "offline-390");
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    srv.down = false; await ctx.setOffline(false);
    for (let i = 0; i < 40 && !(srv.posts > posts0 && (await outbox(page)) === 0); i++) await wait(page, 250);
    await wait(page, 2500);
    const t = await toasts(page);
    ok(srv.posts - posts0 === 1 && srv.accepted === 1 && (await outbox(page)) === 0, "back online: exactly 1 beer RPC, outbox empty", { posts: srv.posts - posts0, accepted: srv.accepted, outbox: await outbox(page) });
    ok(new RegExp("Ölen från " + hhmm(tapAt) + " ä skickad").test(t), "back online: 'Ölen från HH:MM ä skickad' (the tap time)", t);
    ok(!(await cap(page)).on, "back online: the good poll hides the caption");
    await shot(page, "online-sent-390");
    await ctx.close();
  }

  if (PARTS.includes("slow")) {
    // slow 3G: the answer takes 4 s; the toast is there at once, and the SAME toast then shows the level line
    const { ctx, page, srv } = await open(browser, 390);
    srv.postSlow = 4000;
    const f = await tapTimed(page);
    ok(f.splash >= 0 && f.splash < 150 && f.toast >= 0 && f.toast < 800 && /Ölen räknas/.test(f.text) && srv.accepted === 0, "slow 3G: splash + 'Skål! Ölen räknas…' before the server answers", { f, accepted: srv.accepted });
    await shot(page, "slow-pending-390");
    await wait(page, 4200);
    const s = await page.evaluate(() => { const t = document.querySelector('#toasts .toast[data-x8test="1"]'); return { same: !!t, txt: t ? t.textContent : "", n: document.querySelectorAll("#toasts .toast").length, all: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | ") }; });
    ok(srv.accepted === 1 && s.same && !/Ölen räknas/.test(s.txt) && s.txt.length > 3, "slow 3G: the same toast now shows the answer (no 2nd toast slides in)", s);
    ok((await outbox(page)) === 0, "slow 3G: a slow answer is not queued (outbox 0)");
    await ctx.close();
  }

  if (PARTS.includes("neterr")) {
    // online, but the beer RPC fails on the network → outbox (not a red error); the next good poll sends it
    const { ctx, page, srv } = await open(browser, 390);
    srv.postFail = true;
    await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1500);
    const t = await toasts(page);
    ok((await outbox(page)) === 1 && /Skickas när du har täckning/.test(t) && !(await redToasts(page)), "network error on post_beer_v2 → the outbox, calm toast, no red error", { outbox: await outbox(page), t });
    srv.postFail = false; const p0 = srv.posts;
    await page.evaluate(() => window.PNDS._A().refresh());
    for (let i = 0; i < 30 && (await outbox(page)) !== 0; i++) await wait(page, 250);
    ok((await outbox(page)) === 0 && srv.accepted === 1 && srv.posts - p0 === 1, "next good poll → sent once, outbox empty", { posts: srv.posts - p0, accepted: srv.accepted });
    await ctx.close();
  }

  for (const part of ["reload", "reload2"]) {
    if (!PARTS.includes(part)) continue;
    // the server takes the beer but the answer is lost; the page reloads → the outbox must NOT log it again
    // reload: poll "me".beer_at shows it landed · reload2: no beer_at → the re-send gets the 10-min answer → dropped
    const { ctx, page, srv } = await open(browser, 390, { noBeerAt: part === "reload2" });
    srv.loseAnswer = true;
    await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1800);
    ok(srv.accepted === 1 && (await outbox(page)) === 1, part + ": lost answer → kept in the outbox (the server has it)", { accepted: srv.accepted, outbox: await outbox(page) });
    srv.loseAnswer = false;
    await boot(page, true);
    for (let i = 0; i < 40 && (await outbox(page)) !== 0; i++) await wait(page, 250);
    await wait(page, 2000);
    if (process.env.X8_DEBUG) console.log("trail", JSON.stringify(await page.evaluate(() => window.X8._s().trail)));
    ok(srv.accepted === 1 && (await outbox(page)) === 0, part + ": after the reload → no double log (1 beer on the server), outbox empty", { accepted: srv.accepted, posts: srv.posts, outbox: await outbox(page) });
    if (part === "reload") ok(srv.posts === 1, "reload: poll 'me'.beer_at shows it landed → dropped without a 2nd call", { posts: srv.posts });
    else ok(srv.posts === 2, "reload2: no beer_at → ONE re-send, answered by the 10-min rule → dropped", { posts: srv.posts });
    await ctx.close();
  }

  if (PARTS.includes("stale")) {
    // polls fail (online): 2 failures → the caption; back-off (no 1 s loop); a good poll → the caption goes
    const { ctx, page, srv } = await open(browser, 390);
    await wait(page, 500);
    const goodAt = await page.evaluate(() => Date.now());
    srv.pollDown = true; const n0 = srv.polls, t0 = Date.now();
    await page.evaluate(() => window.PNDS._A().refresh());
    for (let i = 0; i < 60 && !(await cap(page)).on; i++) await wait(page, 250);
    const c = await cap(page);
    ok(c.on && /Senast uppdaterad \d\d:\d\d/.test(c.txt) && (c.txt.indexOf(hhmm(goodAt)) >= 0 || c.txt.indexOf(hhmm(goodAt - 60e3)) >= 0) && !c.red && (await redToasts(page)) === 0,
      "stale: polls fail → 'Senast uppdaterad HH:MM' (last good poll), no red error", { c, red: await redToasts(page) });
    ok(c.below && c.inside, "stale: the caption sits under the HUD row, inside the screen", c);
    ok((await page.evaluate(() => window.PNDS._A().beers().length)) === 8 && (await page.evaluate(() => document.querySelectorAll(".pill").length)) > 0, "stale: the last pins stay on the map");
    await shot(page, "stale-390");
    while (Date.now() - t0 < 36000) await wait(page, 1000);
    const n = srv.polls - n0;
    ok(n >= 2 && n <= 6, "stale: polls back off (2–6 tries in 36 s, not a 1 s loop)", { polls: n, at: srv.log.slice(-8).map((x) => Math.round((x - t0) / 1000)) });
    srv.pollDown = false;
    await page.evaluate(() => window.PNDS._A().refresh()); await wait(page, 1200);
    ok(!(await cap(page)).on, "stale: the next good poll hides the caption");
    await ctx.close();
  }

  if (PARTS.includes("cold")) {
    // a cold start with no net after a good night: the last pins + the caption, no red "load failed" error
    const { ctx, page, srv } = await open(browser, 390);
    await wait(page, 1500);
    const has = await page.evaluate(() => !!localStorage.getItem("olnu.x8.snap"));
    srv.down = true;   // Supabase out of reach at the start (the page itself comes from the cache / local server)
    await page.reload(); await wait(page, 7000);
    const s = await page.evaluate(() => ({ pins: window.PNDS._A().beers().length, pills: document.querySelectorAll(".pill").length, red: document.querySelectorAll("#toasts .toast.err").length }));
    const c = await cap(page);
    ok(has && s.pins === 8 && s.pills > 0 && c.on && /Senast uppdaterad/.test(c.txt) && s.red === 0, "cold start offline: the last map (pins) + 'Senast uppdaterad', no red error", { has, s, c });
    await shot(page, "cold-offline-390");
    srv.down = false; await page.evaluate(() => window.dispatchEvent(new Event("online"))); await wait(page, 4000);
    ok(!(await cap(page)).on && srv.pollOk >= 2, "cold start: net back → a good poll, caption gone", { pollOk: srv.pollOk });
    await ctx.close();
  }

  if (PARTS.includes("lask")) {
    // LÄSK! (Jag kör ikväll) offline: no drink → nothing in the outbox
    const { ctx, page, srv } = await open(browser, 390, { drive: true });
    await page.evaluate(() => window.SKJUTS && window.SKJUTS._force && window.SKJUTS._force()); await wait(page, 2200);
    const on = await page.evaluate(() => document.body.classList.contains("mn-lask"));
    srv.down = true; await ctx.setOffline(true); await wait(page, 300);
    await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1200);
    ok(on && (await outbox(page)) === 0 && srv.posts === 0, "LÄSK! offline: no drink → the outbox stays empty", { on, outbox: await outbox(page), posts: srv.posts });
    await ctx.close();
  }

  if (PARTS.includes("ghost")) {
    // spökläge on: the beer from the outbox goes as p_hidden = true
    const { ctx, page, srv } = await open(browser, 390, { init: () => { try { localStorage.setItem("olnu.ghostMode", "1"); } catch (e) {} } });
    srv.down = true; await ctx.setOffline(true); await wait(page, 300);
    await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1200);
    const q = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.x8.outbox") || "[]"));
    srv.down = false; await ctx.setOffline(false);
    for (let i = 0; i < 40 && srv.accepted < 1; i++) await wait(page, 250);
    ok(q.length === 1 && q[0].ghost === true && srv.accepted === 1 && srv.hidden[0] === true, "spökläge: the queued beer keeps spökläge (p_hidden true)", { q: q.length && q[0].ghost, hidden: srv.hidden });
    await ctx.close();
  }

  if (PARTS.includes("pace")) {
    // 2 beers in the outbox (from a long offline stretch): the 1st goes at once, the 2nd waits for the server's 10-min rule
    const init = () => { if (sessionStorage.getItem("x8seed")) return; sessionStorage.setItem("x8seed", "1");
      const it = (m, id) => ({ id: id, at: Date.now() - m * 60e3, lat: 60.14997, lng: 15.18679, precise: true, home: false, ghost: false, sent: 0, tries: 0, next: 0 });
      localStorage.setItem("olnu.x8.outbox", JSON.stringify([it(30, "x8-a"), it(15, "x8-b")])); };
    const { ctx, page, srv } = await open(browser, 390, { init });
    for (let i = 0; i < 40 && srv.accepted < 1; i++) await wait(page, 250);
    await wait(page, 3000);
    const q = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.x8.outbox") || "[]"));
    const waitMin = q.length ? (q[0].next - Date.now()) / 60e3 : 0;
    ok(srv.accepted === 1 && srv.posts === 1 && q.length === 1 && q[0].id === "x8-b" && waitMin > 9 && waitMin < 10.2,
      "pace: 2 queued → the oldest is sent, the 2nd waits ~10 min (server rule), no burst", { accepted: srv.accepted, posts: srv.posts, q: q.map((x) => x.id), waitMin: Math.round(waitMin * 10) / 10 });
    await ctx.close();
  }

  if (PARTS.includes("limits")) {
    // max 5 in the outbox, 90 min TTL, storage errors never break the tap
    const { ctx, page, srv } = await open(browser, 390);
    srv.down = true; await ctx.setOffline(true); await wait(page, 300);
    const r = await page.evaluate(() => {
      localStorage.setItem("olnu.x8.outbox", JSON.stringify([{ id: "x8-old", at: Date.now() - 95 * 60e3, lat: 60.15, lng: 15.18, precise: true, sent: 0, tries: 0, next: 0 }]));
      const ttl = window.X8.count();
      const adds = []; for (let i = 0; i < 6; i++) adds.push(window.X8.add({ lat: 60.15, lng: 15.18, precise: true }, false));
      const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
      Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); };
      Storage.prototype.getItem = function () { throw new Error("SecurityError"); };
      let mem = null; try { localStorage.removeItem("olnu.x8.outbox"); } catch (e) {}
      try { mem = window.X8.add({ lat: 60.15, lng: 15.18, precise: true }, false); } catch (e) { mem = "threw " + e.message; }
      const memN = window.X8.count();
      Storage.prototype.setItem = set; Storage.prototype.getItem = get;
      return { ttl, oks: adds.filter((a) => a.ok).length, full: !!adds[5].full, mem, memN };
    });
    ok(r.ttl === 0 && r.oks === 5 && r.full, "limits: a 95-min-old beer is dropped (TTL 90 min), max 5 in the outbox", r);
    ok(r.mem && r.mem.ok && r.memN === 1, "limits: storage blocked → the outbox lives in memory, no crash", r);
    await page.evaluate(() => localStorage.removeItem("olnu.x8.outbox"));
    await ctx.close();
  }

  if (PARTS.includes("shots")) {
    for (const w of [360, 430]) {
      const { ctx, page, srv } = await open(browser, w);
      srv.down = true; await ctx.setOffline(true); await wait(page, 300);
      await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 900);
      const c = await cap(page);
      ok(c.on && c.inside, "caption " + w + ": shown and inside the screen", c);
      await shot(page, "offline-" + w);
      await ctx.close();
    }
  }

  await browser.close();
  console.log("x8: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
