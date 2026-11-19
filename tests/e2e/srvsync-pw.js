// lane srvsync (19 Nov 2026, PLAN A7 / A8 / B3 / C6). Mocked Supabase (ds-helpers) + a small server emulator:
//   poll_v2 with real pins, post_beer_v2, award_medals (counted), rpc_bundle2 (live today = 0297: cap 24, old list) and
//   pn_sync (0525: the same rule as supabase/migrations/0525_pn_sync.sql: md5 per field, {s:1} = same, p:1 = only the changed
//   fields). Inner calls are sent from the page with the header x-pn-inner (the mocks answer them) and are not counted.
// Server modes: "sync" = live + 0525 (pn_sync there) · "live" = live today (no pn_sync, old rpc_bundle2) · "staging" = no pn_sync,
//   rpc_bundle2 after 0465/0466 (cap 40).
// usage: node srvsync-pw.js <port> [parts]                     CI checks (exit 1 on a FAIL). parts: sync,fallback,b3,medals
//        node srvsync-pw.js <port> --measure <docs dir> <mode> [minutes]   numbers only (requests / min, bytes / poll)
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.argv[2] || 8753;
const MEASURE = process.argv[3] === "--measure";
const DOCS = MEASURE ? process.argv[4] : process.env.SRVSYNC_DOCS || null, MMODE = MEASURE ? process.argv[5] || "sync" : "", MMIN = MEASURE ? +(process.argv[6] || 2) : 0;
const PARTS = (!MEASURE && process.argv[3] ? process.argv[3] : "sync,fallback,b3,medals").split(",");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });

// server lists (supabase/migrations: 0297 = OLD; 0500 rpc_bundle_allow = FULL, the list pn_sync reads)
const OLD = ["game_poll", "gang_poll", "skal_poll", "film_poll", "ceremony_poll", "walk_poll", "my_invites", "helg_state", "my_status", "my_inbox",
  "my_dms", "pickup_poll", "safety_state", "duel_poll", "knuff_inbox", "my_rallies", "bar_status", "medevac_checks", "group_etas", "beer_reactions",
  "crew_poll", "near_poll", "my_meriter", "avatars_for", "ikvall_status", "home_status", "friend_totals", "ghost_points2", "golden_horse"];
const FULL = OLD.concat(["zone_counts", "poll_v2", "account_config", "public_config", "after_flags_get", "ride_flags_get", "bold_flags_get", "my_visibility",
  "my_account_deletion", "my_avatar", "my_home_town", "my_medals", "my_passport", "my_groups", "party_mine", "spel_mine", "rnd_me", "my_board_optin",
  "bars_gone", "guess_night_kind", "my_removals", "friend_suggest", "my_wrapped", "city_league", "events_near", "events_near2", "bar_sport_near",
  "my_past_events", "user_places", "group_now", "group_msgs", "drivers_for", "friend_list", "my_stats", "my_friends", "my_event_chats", "mark_seen",
  "walk_timer_tick", "after_report2", "my_night_report", "group_photos", "msg_reacts", "group_voices", "group_status_v3", "group_status_v2", "moments_poll"]);

// pn_sync entry: JS copy of public.olnu_sync_entry (jsonb text has sorted keys: sorted JSON here)
const sortJ = (v) => Array.isArray(v) ? v.map(sortJ) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortJ(v[k]); return o; }, {}) : v;
const md5 = (v) => crypto.createHash("md5").update(JSON.stringify(sortJ(v === undefined ? null : v))).digest("hex");
function entry(v, have) {
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= 40) {
    const hs = {}; Object.keys(v).forEach((k) => { hs[k] = md5(v[k]).slice(0, 12); });
    if (have && typeof have === "object" && !Array.isArray(have)) {
      if (JSON.stringify(sortJ(have)) === JSON.stringify(sortJ(hs))) return { s: 1 };
      const d = {}; Object.keys(v).forEach((k) => { if (have[k] !== hs[k]) d[k] = v[k]; });
      return { d, h: hs, p: 1 };
    }
    return { d: v, h: hs };
  }
  const h = md5(v).slice(0, 16);
  return typeof have === "string" && have === h ? { s: 1 } : { d: v, h };
}

const BAR = { pitch: [60.14997, 15.18679], parma: [60.15124, 15.18797] };
const CI_AT = new Date(Date.now() - 90 * 60e3).toISOString();   // fixed: a real server row does not change its time
const PINS = [[60.14997, 15.18679], [60.15124, 15.18797], [60.15098, 15.18663], [60.1545, 15.196], [60.1462, 15.1801], [60.1478, 15.204], [60.161, 15.189], [60.1431, 15.195]]
  .map((ll, i) => ({ id: 5000 + i, lat: ll[0], lng: ll[1], beer_count: 1 + (i % 5), other_count: 0, precise: true, created_at: new Date(Date.now() - (20 + i) * 60e3).toISOString(),
    is_mine: false, friend_name: i === 1 ? "Oskar" : null, skal_count: 0, i_skaled: false }));
// --measure only: SRVSYNC_PINS=N adds strangers around Ludvika (a busy Friday has 50-150 pins in view)
for (let i = 0; i < +(process.env.SRVSYNC_PINS || 0); i++) PINS.push({ id: 6000 + i, lat: 60.14 + (i % 13) * 0.0021, lng: 15.17 + Math.floor(i / 13) * 0.0033, beer_count: 1 + (i % 4),
  other_count: 0, precise: i % 3 > 0, created_at: new Date(Date.now() - (10 + i) * 60e3).toISOString(), is_mine: false, friend_name: null, skal_count: 0, i_skaled: false });

// tick = new beers on Oskar's pin (index 1: a friend; strangers show no number, app-crowd.js _nc)
function v2(S, b) {
  const pins = PINS.map((p, i) => (i === 1 ? Object.assign({}, p, { beer_count: p.beer_count + S.tick }) : p));
  return { v: 1, server_time: new Date().toISOString(), full: true, ids_until: null, bbox: [59.5, 14.5, 60.8, 15.9], pins, capped: false, pins_in_view: pins.length, live_total: 12 + S.tick,
    me: { id: 1, beer_count: S.count, other_count: 0, other_kind: null, hidden: false, ghost: false, expires_at: S.exp, beer_at: null, wait_seconds: 0, undo_until: null, undos_left: 3 },
    checkins: [{ bar_id: S.ci.id, bar_name: S.ci.name, lat: S.ci.ll[0], lng: S.ci.ll[1], name: "Anton", is_mine: true, is_friend: false, created_at: S.ci.at }],
    rallies: [], heat: b && b.p_heat ? pins.map((p) => [p.lat, p.lng, p.beer_count]) : null };
}
// inner calls from the page (the test's routes, ds-helpers and fixtures/rpc.js answer them)
async function inner(page, q, calls) {
  const h = q.headers(), base = q.url().slice(0, q.url().indexOf("/rpc/") + 5);
  try {
    return await page.evaluate(async ({ base, calls, auth, key }) => {
      const o = {};
      await Promise.all(calls.map(async (c) => {
        try {
          const res = await fetch(base + c.n, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: auth, "x-pn-inner": "1" }, body: JSON.stringify(c.a || {}) });
          const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
          o[c.k] = res.ok ? { d } : { e: { code: (d && d.code) || String(res.status), message: (d && d.message) || "error" } };
        } catch (e) { o[c.k] = { e: { code: "XX000", message: String(e) } }; }
      }));
      return o;
    }, { base, calls, auth: h.authorization || "", key: h.apikey || "" });
  } catch (e) { return {}; }
}

async function server(ctx, page, S) {
  // static files from another docs dir (the old code for "before" numbers); config.js points at staging like serve.py
  if (DOCS) await ctx.route(new RegExp("^http://127\\.0\\.0\\.1:" + PORT + "/"), (r) => {
    let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p === "/") p = "/index.html";
    const f = path.join(DOCS, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: "" });
    let body = fs.readFileSync(f);
    if (p === "/config.js") body = Buffer.from(String(body).replace(/(SUPABASE_URL\s*:\s*)"[^"]*"/, '$1"https://vdtmzsxajpvzwwbhnfmr.supabase.co"'));
    const ct = /\.js$/.test(p) ? "text/javascript" : /\.css$/.test(p) ? "text/css" : /\.html$/.test(p) ? "text/html" : /\.json$/.test(p) ? "application/json" : /\.svg$/.test(p) ? "image/svg+xml" : /\.png$/.test(p) ? "image/png" : "application/octet-stream";
    return r.fulfill({ status: 200, contentType: ct, body });
  });
  await page.route(/supabase\.co\/(?!rest\/v1\/rpc\/|auth\/v1\/|functions\/v1\/)/, (r) => J(r, []));
  await page.route(/rest\/v1\/rpc\/(rpc_bundle2|pn_sync|poll_v2|post_beer_v2|award_medals)\b/, async (r) => {
    const q = r.request(), fn = q.url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(q.postData() || "{}"); } catch (e) {}
    if (fn === "poll_v2") return J(r, v2(S, body));
    if (fn === "award_medals") { S.award++; return J(r, []); }
    if (fn === "post_beer_v2") {
      S.count++; S.posts++;
      return J(r, { accepted: true, wait_seconds: 0, id: 1, lat: body.p_lat, lng: body.p_lng, beer_count: S.count, drinks: S.count, is_new: false, expires_at: S.exp, milestone: null,
        hidden: !!body.p_hidden, undo_until: new Date(Date.now() + 120e3).toISOString(), undos_left: 3 });
    }
    if (fn === "pn_sync") {
      S.pnAsk++;
      if (S.mode !== "sync") return J(r, { code: "PGRST202", message: "Could not find the function public.pn_sync(p_calls, p_have) in the schema cache", details: null, hint: null }, 404);
      const calls = body.p_calls || [], have = body.p_have || {};
      if (calls.length > 40) return J(r, { code: "P0001", message: "invalid_calls", details: null, hint: null }, 400);
      const got = await inner(page, q, calls.filter((c) => FULL.includes(c.n)));
      const out = {};
      calls.forEach((c) => {
        if (out[c.k]) return;
        if (!FULL.includes(c.n)) { out[c.k] = { e: { code: "P0001", message: "not_bundled" } }; return; }
        const g = got[c.k] || { e: { code: "XX000", message: "lost" } };
        out[c.k] = g.e ? g : entry(g.d, have[c.k]);
        S.ent.push(c.n + ":" + (out[c.k].e ? "err" : out[c.k].s ? "same" : out[c.k].p ? "part" : "full") + ":" + JSON.stringify(out[c.k]).length);
        if (c.n === "poll_v2") S.pv.push(out[c.k].s ? "same" : out[c.k].p ? "part:" + Object.keys(out[c.k].d).sort().join("+") : "full");
      });
      return J(r, { pn: 1, r: out });
    }
    // rpc_bundle2: live today = 0297 (cap 24, OLD), staging = after 0465/0466/0480 (cap 40, FULL)
    const calls = body.p_calls || [], cap = S.mode === "staging" ? 40 : 24, list = S.mode === "staging" ? FULL : OLD;
    if (calls.length > cap) return J(r, { code: "P0001", message: "invalid_calls", details: null, hint: null }, 400);
    const got = await inner(page, q, calls.filter((c) => list.includes(c.n)));
    const out = {};
    calls.forEach((c) => { if (!out[c.k]) out[c.k] = list.includes(c.n) ? got[c.k] || { e: { code: "XX000", message: "lost" } } : { e: { code: "P0001", message: "not_bundled" } }; });
    return J(r, out);
  });
}
// every request the phone really sends (no inner calls, no OPTIONS) + the answer size
function counter(page) {
  const log = [];
  page.on("request", (q) => {
    const u = q.url(); if (!/supabase\.co\//.test(u) || q.method() === "OPTIONS" || q.headers()["x-pn-inner"]) return;
    const m = u.match(/\/rest\/v1\/rpc\/(\w+)/), name = m ? m[1] : "auth:" + ((u.match(/\/(auth|functions)\/v1\/([\w-]+)/) || [])[2] || "?");
    let innerN = null; if (name === "rpc_bundle2" || name === "pn_sync") { try { innerN = JSON.parse(q.postData()).p_calls.map((c) => c.n); } catch (e) {} }
    const x = { t: Date.now(), name, inner: innerN, bytes: 0, up: (q.postData() || "").length }; log.push(x);
    q.response().then((res) => (res ? res.body() : null)).then((b) => { if (b) x.bytes = b.length; }).catch(() => {});
  });
  return log;
}
const since = (log, t0, t1) => log.filter((x) => x.t >= t0 && (!t1 || x.t < t1));
const mix = (xs) => { const m = {}; xs.forEach((x) => { m[x.name] = (m[x.name] || 0) + 1; }); return m; };
const isPoll = (x) => x.name === "poll_v2" || (x.inner || []).includes("poll_v2");
const hidInit = () => {
  let hid = false;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return hid ? "hidden" : "visible"; } });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return hid; } });
  window.__setHidden = (v) => { hid = v; document.dispatchEvent(new Event("visibilitychange")); if (v) window.dispatchEvent(new Event("pagehide")); };
};

async function open(browser, mode, o = {}) {
  const S = { mode, tick: 0, ent: [], count: 6, posts: 0, award: 0, pnAsk: 0, pv: [], exp: new Date(Date.now() + 5 * 3600e3).toISOString(),
    ci: { id: "n3472634175", name: "Pitchers", ll: BAR.pitch, at: CI_AT }, errors: [] };
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  await ctx.addInitScript(hidInit);
  // the medal check-in key the app makes from the poll's own check-in (medals.js onPoll): a start that is not a NEW check-in
  await ctx.addInitScript(([at, seedAt]) => {
    if (sessionStorage.getItem("srv.seed")) return; sessionStorage.setItem("srv.seed", "1");
    localStorage.setItem("olnu.medalsCi", "n3472634175|" + Date.parse(at));
    localStorage.setItem("olnu.medalsSeeded", "1");
    if (seedAt) localStorage.setItem("olnu.medalsAt", String(Date.now() - seedAt));
  }, [CI_AT, o.medalsAge || 0]);
  await server(ctx, page, S);
  page.on("pageerror", (e) => S.errors.push(e.message));
  const log = counter(page), t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__map && window.PN && window.PN.s && window.PN.s.firstLoadDone && window.PN.s.beers.length > 3, null, { timeout: 30000 }).catch(() => console.log("no pins"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false })).catch(() => {});
  return { ctx, page, log, S, t0 };
}
// count render() calls that come from the poll (app-poll.js), not from other modules
const spyRender = (page) => page.evaluate(() => {
  window.__rn = 0; window.__rnAll = 0; const o = window.PN.render; window.__rnOrig = o;
  window.PN.render = function () { window.__rnAll++; if (/app-poll\.js/.test(String(new Error().stack))) window.__rn++; return o.apply(this, arguments); };
});
const spyLog = (page) => page.evaluate(() => {
  window.__ev = []; window.PNLOG = window.PNLOG || { event: function () {} };
  const pe = window.PNLOG.event; window.PNLOG.event = function (n, p) { window.__ev.push([n, p]); try { return pe.apply(this, arguments); } catch (e) {} };
});
const poll = (page) => page.evaluate(() => window.PN.refresh()).catch(() => {});
const errTexts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));

async function measure(browser) {
  const { ctx, page, log, S, t0 } = await open(browser, MMODE);
  await wait(page, 40000 - (Date.now() - t0));
  const t1 = Date.now(); await wait(page, MMIN * 60000);
  const w = since(log, t1), polls = w.filter(isPoll), bytes = w.reduce((a, x) => a + x.bytes, 0), pb = polls.reduce((a, x) => a + x.bytes, 0);
  const cold = since(log, t0, t0 + 20000);
  const R = { docs: DOCS || "this worktree", mode: MMODE, minutes: MMIN, perMin: +(w.length / MMIN).toFixed(2), mix: mix(w), polls: polls.length,
    bytesPerPoll: polls.length ? Math.round(pb / polls.length) : 0, pollReqPerPoll: polls.length ? +(w.filter((x) => /^(poll_v2|rpc_bundle2|pn_sync)$/.test(x.name)).length / polls.length).toFixed(2) : 0,
    bytesPerMin: Math.round(bytes / MMIN), upPerMin: Math.round(w.reduce((a, x) => a + x.up, 0) / MMIN), award: S.award, cold: cold.length, coldMix: mix(cold), pv: S.pv.slice(-6), errors: S.errors.slice(0, 3) };
  console.log("MEASURE " + JSON.stringify(R));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  try {
    if (MEASURE) { await measure(browser); return; }

    /* ---------- A7 + A8: live + 0525 (pn_sync there) ---------- */
    if (PARTS.includes("sync")) try {
      const { ctx, page, log, S } = await open(browser, "sync");
      await wait(page, 6000);
      const t1 = Date.now();
      await wait(page, 66000);   // 2 map polls at 30 s
      const w = since(log, t1), polls = w.filter(isPoll), m = mix(w);
      ok("A7: every map poll goes in pn_sync (poll_v2 inside it)", polls.length >= 2 && polls.every((x) => x.name === "pn_sync"), { polls: polls.map((x) => x.name), m });
      ok("A7: no rpc_bundle2 and no poll_v2 alone after the start (live has the old rpc_bundle2)", !m.rpc_bundle2 && !m.poll_v2, m);
      const quiet = S.pv.slice(1);
      ok("A7: a quiet poll gets no pins again (only what changed: same or server_time / me)", quiet.length >= 1 && quiet.every((k) => k === "same" || (/^part:/.test(k) && !/pins|checkins/.test(k))), S.pv);
      const ps = polls.filter((x) => x.bytes > 0).map((x) => x.bytes), q = S.pv[0] === "full" ? ps.slice(1) : ps;   // the 1st pn_sync poll is in full
      ok("A7: a quiet poll answer is small (< 1500 bytes; the full one is about 2700)", q.length >= 1 && Math.max.apply(null, q) < 1500, { ps, pv: S.pv, ent: S.ent.slice(-30) });
      // A8: the poll draws only when its data changed
      await spyRender(page);
      await poll(page); await wait(page, 600); await poll(page); await wait(page, 600);
      const same = await page.evaluate(() => window.__rn);
      ok("A8: 2 polls with the same data = no render()", same === 0, { same, pv: S.pv.slice(-2) });
      S.tick++;
      await poll(page); await wait(page, 600);
      const changed = await page.evaluate(() => ({ n: window.__rn, c: (window.PN.s.beers.find((b) => b.id === 5001) || {}).beer_count }));
      ok("A8: a changed pin count = render() once, the new count in the app", changed.n === 1 && changed.c === PINS[1].beer_count + 1, changed);
      const pins = await page.evaluate(() => Object.keys(window.PN.s.markerById || {}).length);
      ok("A7: pins on the map (markers)", pins > 3, pins);
      // hidden: nothing goes out (the log batch at pagehide may)
      const t2 = Date.now();
      await page.evaluate(() => window.__setHidden(true));
      await wait(page, 35000);
      const hid = mix(since(log, t2 + 1500));
      ok("A7: hidden page = no polls (no pn_sync, rpc_bundle2, poll_v2)", !hid.pn_sync && !hid.rpc_bundle2 && !hid.poll_v2, hid);
      await page.evaluate(() => window.__setHidden(false));
      ok("sync: no page errors", !S.errors.length, S.errors);
      await ctx.close();
    } catch (e) { console.log("FAIL sync section:", e && e.message); fail++; }

    /* ---------- A7 fallback: live today (no pn_sync): rpc_bundle2 as before, asked once, remembered ---------- */
    if (PARTS.includes("fallback")) try {
      const { ctx, page, log, S } = await open(browser, "live");
      await wait(page, 40000);
      const st = await page.evaluate(() => ({ ls: JSON.parse(localStorage.getItem("olnu.pnsync") || "null"), pins: window.PN.s.beers.length, err: document.querySelectorAll("#toasts .toast.err").length }));
      ok("A7 no pn_sync: asked at most once", S.pnAsk <= 1, S.pnAsk);
      ok("A7 no pn_sync: remembered on this phone (olnu.pnsync off)", !!(st.ls && st.ls.v === "off"), st.ls);
      ok("A7 no pn_sync: polls go on (rpc_bundle2 / poll_v2), pins in the app, no red toast", log.filter(isPoll).length >= 2 && st.pins > 3 && !st.err, { m: mix(log), st });
      const n0 = S.pnAsk, t3 = Date.now();
      await page.reload();
      await page.waitForFunction(() => window.PN && window.PN.s && window.PN.s.firstLoadDone, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 35000);
      ok("A7 no pn_sync: after a reload it is not asked again (6 h)", S.pnAsk === n0 && since(log, t3).filter(isPoll).length >= 1, { ask: S.pnAsk - n0, m: mix(since(log, t3)) });
      ok("fallback: no page errors", !S.errors.length, S.errors);
      await ctx.close();
    } catch (e) { console.log("FAIL fallback section:", e && e.message); fail++; }

    /* ---------- B3: a draw error is not "no network"; a UI error after an accepted beer is not "could not report" ---------- */
    if (PARTS.includes("b3")) try {
      const { ctx, page, S } = await open(browser, "sync");
      await wait(page, 5000);
      await spyLog(page);
      await page.evaluate(() => { window.PN.render = function () { throw new Error("srvsync test draw error"); }; });
      S.tick++; await poll(page); await wait(page, 500);
      S.tick++; await poll(page); await wait(page, 500);
      const st = await page.evaluate(() => ({ x8: window.X8 && window.X8._s ? window.X8._s() : null, stale: document.body.classList.contains("x8-stale-on"),
        ev: window.__ev.filter((e) => e[0] === "err.js").map((e) => e[1]), c: (window.PN.s.beers.find((b) => b.id === 5001) || {}).beer_count }));
      ok("B3 draw error: not a failed poll (x8 fails 0, no 'Senast uppdaterad' / no-network caption)", st.x8 && st.x8.fails === 0 && !st.stale, { fails: st.x8 && st.x8.fails, stale: st.stale });
      ok("B3 draw error: the real error is logged (PNLOG err.js, app-poll.js)", st.ev.some((p) => p && /srvsync test draw error/.test(p.m) && /app-poll/.test(p.f)), st.ev);
      ok("B3 draw error: the poll data still reached the app", st.c === PINS[1].beer_count + 2, { c: st.c, pv: S.pv, b: await page.evaluate(() => window.PN.s.beers.map((b) => b.id + ":" + b.beer_count).join(",")) });
      await page.evaluate(() => { window.PN.render = window.__rnOrig || window.PN.render; });
      // the beer: the server accepts it, then an effect throws
      await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); window.__ev = [];
        const fx = window.FX; if (fx.juice) fx.juice.accepted = function () { throw new Error("srvsync test fx error"); };
        else fx.sound.beer = function () { throw new Error("srvsync test fx error"); }; });
      const posts0 = S.posts;
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await wait(page, 3000);
      const b = await page.evaluate(() => ({ t: [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "),
        night: (JSON.parse(localStorage.getItem("olnu.night") || "{}").count | 0), ev: window.__ev.filter((e) => e[0] === "err.js").map((e) => e[1]) }));
      ok("B3 beer: the server took the beer", S.posts === posts0 + 1, S.posts - posts0);
      ok("B3 beer: no 'could not report' toast after an accepted beer", !/rapportera|Could not report/.test(b.t), b.t);
      ok("B3 beer: the count is the server's count", b.night === S.count, { night: b.night, server: S.count });
      ok("B3 beer: the real error is logged (PNLOG err.js, app-beer.js)", b.ev.some((p) => p && /srvsync test fx error/.test(p.m) && /app-beer/.test(p.f)), b.ev);
      await ctx.close();
    } catch (e) { console.log("FAIL b3 section:", e && e.message); fail++; }

    /* ---------- C6: award_medals after a beer or a check-in, not from the poll ---------- */
    if (PARTS.includes("medals")) try {
      // the last award was 6 h minus 25 s ago: the app start does not award; an old poll would, 25 s later
      const { ctx, page, S, t0 } = await open(browser, "sync", { medalsAge: 6 * 3600e3 - 25000 });
      await wait(page, 32000 - (Date.now() - t0));
      await poll(page); await wait(page, 4000);   // a poll after the 6 h line (+ its onPoll wave)
      ok("C6: no award_medals from the poll", S.award === 0, S.award);
      // a check-in at another bar (seen by the poll) = one award
      S.ci = { id: "x-la-parma-ludvika", name: "La Parma", ll: BAR.parma, at: new Date().toISOString() };
      await poll(page); await wait(page, 4000);
      ok("C6: a new check-in = one award_medals", S.award === 1, S.award);
      await poll(page); await wait(page, 4000);
      ok("C6: the same check-in on the next poll = no 2nd award", S.award === 1, S.award);
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await wait(page, 4500);
      ok("C6: an accepted beer = one award_medals", S.posts === 1 && S.award === 2, { posts: S.posts, award: S.award });
      ok("medals: no page errors", !S.errors.length, S.errors);
      await ctx.close();
    } catch (e) { console.log("FAIL medals section:", e && e.message); fail++; }
  } finally {
    await browser.close();
    if (!MEASURE) { console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0); }
  }
})();
