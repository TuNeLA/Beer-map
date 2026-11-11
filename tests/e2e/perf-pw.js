// perf lane (X10 load REPORT fixes 3–8, 11 Nov): requests per user. Mocked Supabase (ds-helpers) + a small server emulator:
// rpc_bundle2 with the server's whitelist and cap ("new" = after 0465: + poll_v2 and the start-up reads, cap 40;
// "old" = 0297 list, cap 24, a name off the list answers { e: { code: "P0001", message: "not_bundled" } } like Postgres does),
// poll_v2 with real pins, and a "busy" switch (every RPC answers 504 PGRST003). Inner bundle calls are sent from the page with
// the header x-pn-inner (so the test's mocks answer them) and are not counted: only what the phone really sends counts.
// usage: node perf-pw.js <port>                      CI checks (exit 1 on a FAIL)
//        node perf-pw.js <port> --measure <docs> <tag> [old|new]   numbers only (<docs> = a docs dir to serve, e.g. the old code)
const { ctxFor, wait, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const MEASURE = process.argv[3] === "--measure", DOCS = MEASURE ? process.argv[4] : null, TAG = MEASURE ? process.argv[5] || "x" : "ci", SRV = MEASURE ? process.argv[6] || "new" : "new";
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : i === undefined ? "" : JSON.stringify(i).slice(0, 600)); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });

const OLD = ["game_poll", "gang_poll", "skal_poll", "film_poll", "ceremony_poll", "walk_poll", "my_invites", "helg_state", "my_status", "my_inbox",
  "my_dms", "pickup_poll", "safety_state", "duel_poll", "knuff_inbox", "my_rallies", "bar_status", "medevac_checks", "group_etas", "beer_reactions",
  "crew_poll", "near_poll", "my_meriter", "avatars_for", "ikvall_status", "home_status", "friend_totals", "ghost_points2", "golden_horse"];
const ADD = ["poll_v2", "account_config", "public_config", "after_flags_get", "ride_flags_get", "bold_flags_get", "my_visibility", "my_account_deletion",
  "my_avatar", "my_home_town", "my_medals", "my_passport", "my_groups", "party_mine", "spel_mine", "rnd_me", "my_board_optin", "bars_gone",
  "guess_night_kind", "my_removals", "friend_suggest", "my_wrapped", "city_league", "events_near", "events_near2", "bar_sport_near", "my_past_events",
  "user_places", "group_now", "group_msgs", "drivers_for", "friend_list", "my_stats", "my_friends", "my_event_chats", "mark_seen", "walk_timer_tick"];
const R1 = "5e1a0000-0000-4000-8000-000000000001";
const sview = (o = {}) => Object.assign({ v: 1, now: new Date().toISOString(), id: R1, group_id: GID, game: "kort", phase: "lobby", round: 0, goal: 5, game_no: 0, pub: {}, closed: false,
  creator_k: "me", judge_on: false, me: { k: "me", name: "Anton", score: 0, status: "in", hand: [], judge: false, mine: null, can_force: false },
  players: [["me", "Anton"], ["l", "Lisa"], ["o", "Oskar"]].map(([k, name]) => ({ k, name, score: 0, is_me: k === "me", done: false, judge: false, on: true })) }, o);

function v2(body) {
  const pins = [[60.15124, 15.18797, 7], [60.14997, 15.18679, 5], [60.15098, 15.18663, 3], [60.15205, 15.18059, 2], [60.1545, 15.196, 4], [60.1462, 15.1801, 1]]
    .map((p, i) => ({ id: 500 + i, lat: p[0], lng: p[1], beer_count: p[2], precise: true, created_at: new Date(Date.now() - 3e6).toISOString(), is_mine: i === 1 }));
  const b = body || {};
  return { v: 1, server_time: new Date().toISOString(), full: true, bbox: [(b.p_min_lat || 60.1) - 0.01, (b.p_min_lng || 15.1) - 0.01, (b.p_max_lat || 60.2) + 0.01, (b.p_max_lng || 15.3) + 0.01],
    pins, capped: false, pins_in_view: pins.length, live_total: 23, checkins: [], rallies: [], heat: b.p_heat ? pins.map((p) => [p.lat, p.lng, p.beer_count]) : null,
    me: { beer_count: 5, other_count: 0, wait_seconds: 0, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(), total: 43 } };
}

// S = { mode: "new" | "old", busy: false, bundles: [[names]], refused: n, spelV: 0 }
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
  // never the real project: anything on supabase.co that is not an RPC / auth / function answers empty here
  await page.route(/supabase\.co\/(?!rest\/v1\/rpc\/|auth\/v1\/|functions\/v1\/)/, (r) => J(r, []));
  // busy switch for every RPC (inner calls excepted)
  await page.route(/rest\/v1\/rpc\/\w+/, (r) => {
    if (S.busy && !r.request().headers()["x-pn-inner"]) return J(r, { code: "PGRST003", message: "Timed out acquiring connection from connection pool.", details: null, hint: null }, 504);
    return r.fallback();
  });
  await page.route(/rest\/v1\/rpc\/(rpc_bundle2|poll_v2|spel_state|spel_open)\b/, async (r) => {
    const q = r.request(), fn = q.url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(q.postData() || "{}"); } catch (e) {}
    if (S.busy && !q.headers()["x-pn-inner"]) return J(r, { code: "PGRST003", message: "Timed out acquiring connection from connection pool.", details: null, hint: null }, 504);
    if (fn === "poll_v2") return J(r, v2(body));
    if (fn === "spel_open") return J(r, sview({ v: 1 }));
    if (fn === "spel_state") return J(r, !body.p_v ? sview({ v: 1 }) : { same: true, v: body.p_v });
    const calls = body.p_calls || [], cap = S.mode === "old" ? 24 : 40, list = S.mode === "old" ? OLD : OLD.concat(ADD);
    if (calls.length > cap) { S.refused = (S.refused || 0) + 1; return J(r, { code: "P0001", message: "invalid_calls", details: null, hint: null }, 400); }
    S.bundles.push(calls.map((c) => c.n));
    const h = q.headers(), base = q.url().slice(0, q.url().indexOf("/rpc/") + 5);
    const inList = calls.filter((c) => list.includes(c.n));
    let got = {};
    try {
      got = await page.evaluate(async ({ base, calls, auth, key }) => {
        const o = {};
        await Promise.all(calls.map(async (c) => {
          try {
            const res = await fetch(base + c.n, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: auth, "x-pn-inner": "1" }, body: JSON.stringify(c.a || {}) });
            const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
            o[c.k] = res.ok ? { d } : { e: { code: (d && d.code) || String(res.status), message: (d && d.message) || "error" } };
          } catch (e) { o[c.k] = { e: { code: "XX000", message: String(e) } }; }
        }));
        return o;
      }, { base, calls: inList, auth: h.authorization || "", key: h.apikey || "" });
    } catch (e) { got = {}; }
    const out = {};
    calls.forEach((c) => { if (out[c.k]) return; out[c.k] = list.includes(c.n) ? got[c.k] || { e: { code: "XX000", message: "lost" } } : { e: { code: "P0001", message: "not_bundled" } }; });
    return J(r, out);
  });
}

function counter(page) {
  const log = [];
  page.on("request", (q) => {
    const u = q.url(); if (!/supabase\.co\//.test(u) || q.method() === "OPTIONS" || q.headers()["x-pn-inner"]) return;
    const m = u.match(/\/rest\/v1\/rpc\/(\w+)/);
    const name = m ? m[1] : "auth:" + ((u.match(/\/(auth|functions)\/v1\/([\w-]+)/) || [])[2] || "?");
    let inner = null; if (name === "rpc_bundle2") { try { inner = JSON.parse(q.postData()).p_calls.map((c) => c.n); } catch (e) {} }
    log.push({ t: Date.now(), name, inner });
  });
  return log;
}
const since = (log, t0, t1) => log.filter((x) => x.t >= t0 && (!t1 || x.t < t1));
const rpcOnly = (xs) => xs.filter((x) => !/^auth:/.test(x.name));
function mix(xs) { const m = {}; xs.forEach((x) => { m[x.name] = (m[x.name] || 0) + 1; }); return m; }
const hidInit = () => {
  let hid = false;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return hid ? "hidden" : "visible"; } });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return hid; } });
  window.__setHidden = (v) => { hid = v; document.dispatchEvent(new Event("visibilitychange")); if (v) window.dispatchEvent(new Event("pagehide")); };
  // the app api (like cln-pw.js): VITALS.init(api) gets it
  let vv; Object.defineProperty(window, "VITALS", { configurable: true, get() { return vv; }, set(x) { const i = x.init; x.init = function (api) { window.__api = api; return i.apply(this, arguments); }; vv = x; } });
};

async function open(browser, S, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  await ctx.addInitScript(hidInit);
  if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
  await server(ctx, page, S);
  page.on("pageerror", (e) => { (S.errors = S.errors || []).push(e.message); });
  const log = counter(page);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  return { ctx, page, log, t0 };
}

const R = {};   // numbers for DONE.md
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  try {
    /* ---------- 1. cold start + 2 min open ---------- */
    {
      const S = { mode: SRV, bundles: [] };
      const { ctx, page, log, t0 } = await open(browser, S);
      await wait(page, 20000 - (Date.now() - t0));
      const cold = since(log, t0, t0 + 20000);
      R.cold = { all: cold.length, rpc: rpcOnly(cold).length, mix: mix(cold) };
      console.log("cold start (20 s):", cold.length, JSON.stringify(R.cold.mix));
      if (process.env.PERF_DEBUG) cold.forEach((x) => console.log("  c", ((x.t - t0) / 1000).toFixed(1), x.name, (x.inner || []).join(",")));
      await wait(page, 40000);   // settle (start-up timers, 2 slow-lane rounds: the poll plan has learned the rhythm)
      const t1 = Date.now();
      await wait(page, 120000);
      const op = since(log, t1, t1 + 120000);
      R.open = { perMin: +(op.length / 2).toFixed(2), rpcPerMin: +(rpcOnly(op).length / 2).toFixed(2), mix: mix(op), bundles: op.filter((x) => x.inner).map((x) => x.inner.length) };
      if (process.env.PERF_DEBUG) op.forEach((x) => console.log("  o", ((x.t - t1) / 1000).toFixed(1), x.name, (x.inner || []).join(",")));
      console.log("open 2 min:", op.length, "requests =", R.open.perMin, "/min", JSON.stringify(R.open.mix), "bundle sizes", JSON.stringify(R.open.bundles));
      const st = await page.evaluate(() => window.__api && window.__api.bundleStats ? window.__api.bundleStats() : null).catch(() => null);
      console.log("bundleStats", JSON.stringify(st));
      // hide → pnlog sends its batch at once (pagehide), and the map poll stops
      const t2 = Date.now();
      await page.evaluate(() => window.__setHidden(true));
      await wait(page, 35000);
      const hid = since(log, t2, Date.now());
      R.hidden = { n: hid.length, mix: mix(hid) };
      console.log("hidden 35 s:", JSON.stringify(R.hidden.mix));
      await page.evaluate(() => window.__setHidden(false));
      await wait(page, 4000);
      // 2nd start within 10 min (same phone): config + flags come from this phone
      const t3 = Date.now();
      await page.reload();
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
      await wait(page, 20000 - (Date.now() - t3));
      const warm = since(log, t3, t3 + 20000);
      R.reopen = { all: warm.length, rpc: rpcOnly(warm).length, mix: mix(warm) };
      console.log("reopen (20 s):", warm.length, JSON.stringify(R.reopen.mix));
      if (!MEASURE) {
        ok("open app: ≤ 3 requests a minute (was ~7)", R.open.perMin <= 3, R.open);
        ok("open app: poll_v2 never alone after the first poll", !R.open.mix.poll_v2, R.open.mix);
        ok("open app: near_poll rides in the poll bundle", !R.open.mix.near_poll, R.open.mix);
        ok("open app: pnlog_ingest at most once in 2 min (5-min batches)", (R.open.mix.pnlog_ingest || 0) <= 1, R.open.mix);
        ok("open app: every bundle ≤ 40 calls", R.open.bundles.every((n) => n <= 40), R.open.bundles);
        ok("cold start: ≤ 12 requests in 20 s (was ~45)", R.cold.all <= 12, R.cold);
        ok("hidden: the log batch goes out at once (pagehide)", (R.hidden.mix.pnlog_ingest || 0) >= 1, R.hidden);
        ok("hidden: no polls while hidden", !R.hidden.mix.poll_v2 && !R.hidden.mix.rpc_bundle2 && !R.hidden.mix.near_poll, R.hidden);
        ok("reopen < 10 min: no flags / config calls (cached 10 min)", !/(_flags_get|_config)\b/.test(JSON.stringify(warm.map((x) => x.inner || x.name))), R.reopen);
        ok("reopen < 10 min: ≤ 10 requests in 20 s", R.reopen.all <= 10, R.reopen);
        ok("no page errors", !(S.errors || []).length, S.errors);
        const pins = await page.evaluate(() => document.querySelectorAll(".pill").length);
        ok("pins on the map", pins > 3, pins);
      }
      await ctx.close();
    }

    /* ---------- 2. game player: spel_state rhythm, hidden = none ---------- */
    {
      const S = { mode: SRV, bundles: [] };
      const init = [({ gid }) => { if (sessionStorage.getItem("pf.sp")) return; sessionStorage.setItem("pf.sp", "1");
        sessionStorage.setItem("olnu.spel.in", JSON.stringify({ room: "5e1a0000-0000-4000-8000-000000000001", game: "kort", g: { id: gid, name: "Ludvika Lager" }, t: Date.now() })); }, { gid: GID }];
      const { ctx, page, log } = await open(browser, S, { init });
      await page.waitForFunction(() => window.SPEL_UI && window.SPEL_UI.isOpen && window.SPEL_UI.isOpen(), null, { timeout: 20000 }).catch(() => console.log("no room"));
      await wait(page, 3000);
      const t1 = Date.now();
      await wait(page, 60000);
      const g = since(log, t1, t1 + 60000);
      R.game = { perMin: g.length, spel_state: mix(g).spel_state || 0, mix: mix(g) };
      console.log("game 60 s:", g.length, JSON.stringify(R.game.mix));
      const t2 = Date.now();
      await page.evaluate(() => window.__setHidden(true));
      await wait(page, 20000);
      const gh = since(log, t2 + 300, Date.now());
      R.gameHidden = { spel_state: mix(gh).spel_state || 0, mix: mix(gh) };
      const t3 = Date.now();
      await page.evaluate(() => window.__setHidden(false));
      await wait(page, 1500);
      const back = since(log, t3, Date.now());
      R.gameBack = mix(back).spel_state || 0;
      console.log("game hidden 20 s:", JSON.stringify(R.gameHidden.mix), "back 1.5 s spel_state:", R.gameBack);
      if (!MEASURE) {
        ok("game: spel_state ≤ 26 a minute (was 40)", R.game.spel_state <= 26 && R.game.spel_state >= 15, R.game);
        ok("game hidden: 0 spel_state while hidden", R.gameHidden.spel_state === 0, R.gameHidden);
        ok("game back: spel_state at once on return", R.gameBack >= 1, R.gameBack);
      }
      await ctx.close();
    }

    /* ---------- 3. busy back-off (504 PGRST003) ---------- */
    if (!MEASURE) {
      const S = { mode: "new", bundles: [] };
      const { ctx, page, log } = await open(browser, S);
      await wait(page, 5000);
      await page.evaluate(() => window.X8._busy({ min: 12000, jit: 2000 }));   // test: 12–14 s instead of 60–120 s
      S.busy = true;
      const tb = Date.now();
      // two background polls in a row fail → busy
      await page.evaluate(() => Promise.all([window.__api.rpc("game_poll"), window.__api.rpc("my_status")]).then(() => window.__api.refresh && window.__api.refresh()));
      await page.waitForFunction(() => window.X8.busy(), null, { timeout: 30000 }).catch(() => {});
      const busy = await page.evaluate(() => window.X8.busy());
      const cap = await page.evaluate(() => { const c = document.getElementById("x8-stale"); return c && !c.hidden ? c.textContent.trim() : ""; });
      ok("busy: 2 × 504/PGRST003 → busy mode", busy, await page.evaluate(() => window.X8._busy()));
      ok("busy: one calm caption 'Det är mycket nu'", /Det är mycket nu/.test(cap), cap);
      const tq = Date.now();
      // background polls while busy: no request (near / game / bundle names answer locally)
      const local = await page.evaluate(() => Promise.all(["near_poll", "game_poll", "my_dms", "group_msgs"].map((n) => window.__api.rpc(n, n === "near_poll" ? { p_name: "Anton" } : n === "group_msgs" ? { p_group_id: "11111111-2222-3333-4444-555555555555", p_after_id: 0 } : undefined)
        .then((r) => r && r.error && r.error.code))));
      await wait(page, 8000);
      const quiet = since(log, tq, Date.now()).filter((x) => !/^auth:/.test(x.name) && x.name !== "pnlog_ingest");
      ok("busy: background polls send nothing during the back-off", quiet.length === 0 && local.every((c) => c === "busy"), { quiet: quiet.map((x) => x.name), local });
      ok("busy: the map poll waits the back-off (not 5 s)", (await page.evaluate(() => window.X8.delay())) >= 4000, await page.evaluate(() => window.X8.delay()));
      // after the back-off ONE probe goes out; it fails → busy again, still no loop
      await wait(page, 9000);
      const probes = since(log, tq, Date.now()).filter((x) => !/^auth:/.test(x.name) && x.name !== "pnlog_ingest");
      ok("busy: one probe after the back-off, no tight loop", probes.length >= 1 && probes.length <= 3, probes.map((x) => x.name));
      // the server is fine again: a tap answer (good) ends busy at once
      S.busy = false;
      await page.evaluate(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); return window.__api.rpc("my_groups"); });
      await wait(page, 600);
      const after = await page.evaluate(() => ({ busy: window.X8.busy(), cap: (() => { const c = document.getElementById("x8-stale"); return c && !c.hidden && !c.classList.contains("x8-stale-out") ? c.textContent.trim() : ""; })() }));
      ok("busy: first good answer → calm at once, caption gone", !after.busy && !/mycket/.test(after.cap), after);
      const tr = Date.now();
      await page.evaluate(() => window.__api.refresh && window.__api.refresh());
      await wait(page, 3000);
      const resumed = since(log, tr, Date.now()).map((x) => x.name);
      ok("busy: polls go out again after the recovery", resumed.includes("poll_v2") || resumed.includes("rpc_bundle2"), resumed);
      // a client timeout counts as busy too (unit level)
      const to = await page.evaluate(() => { window.X8.netSeen({ data: null, error: { message: "timeout" } }); window.X8.netSeen({ data: null, error: { message: "timeout" } }); const b = window.X8.busy(); window.X8.netSeen({ data: [], error: null, status: 200 }); return [b, window.X8.busy()]; });
      ok("busy: 2 timeouts → busy, a good answer → calm", to[0] === true && to[1] === false, to);
      ok("busy: no page errors", !(S.errors || []).length, S.errors);
      void tb;
      await ctx.close();
    }

    /* ---------- 4. old server (before 0465): separate calls, no errors ---------- */
    if (!MEASURE) {
      const S = { mode: "old", bundles: [] };
      const { ctx, page, log, t0 } = await open(browser, S, { init: [() => { try { if (!sessionStorage.getItem("pf.o")) { sessionStorage.setItem("pf.o", "1"); localStorage.setItem("olnu.bsrv", JSON.stringify({ v: "new", at: Date.now() })); } } catch (e) {} }, null] });
      await wait(page, 40000);
      const all = since(log, t0, Date.now());
      const errs = await page.evaluate(() => [...document.querySelectorAll(".toast.err")].map((x) => x.textContent));
      const st = await page.evaluate(() => window.__api.bundleStats());
      const tooBig = S.bundles.filter((b) => b.length > 24).length;
      const m = mix(all);
      console.log("old server 40 s:", all.length, JSON.stringify(m), "refused", S.refused || 0, "stats", JSON.stringify(st));
      ok("old server: a > 24 bundle (cap 40 remembered) is sent again in chunks of ≤ 24", (S.refused || 0) <= 1 && tooBig === 0, { refused: S.refused, sizes: S.bundles.map((b) => b.length) });
      ok("old server: poll_v2 still goes out (alone)", (m.poll_v2 || 0) >= 2, m);
      ok("old server: new names fall back to their own calls (my_groups, bold_flags_get …)", (m.my_groups || 0) >= 1 && (m.bold_flags_get || 0) >= 1, m);
      ok("old server: no error toasts, no page errors", !errs.length && !(S.errors || []).length, { errs, pe: S.errors });
      ok("old server: remembers 'old' (cap 24 next time)", await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.bsrv") || "{}").v === "old"));
      const pins = await page.evaluate(() => document.querySelectorAll(".pill").length);
      ok("old server: pins on the map", pins > 3, pins);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e && e.stack || e); fail++; }
  await browser.close();
  if (MEASURE) { fs.writeFileSync(OUT + "perf-" + TAG + ".json", JSON.stringify(R, null, 1)); console.log("wrote", OUT + "perf-" + TAG + ".json"); }
  console.log(`\nperf-pw: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
