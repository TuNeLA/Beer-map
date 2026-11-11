// fixMo (test teams round 2, 11 Nov): moments host reveal + Förfest members (N-05), test-kit clock vs login (N-06),
// all moments in the morning report (N-07), distinct crowd count (N-08 / N-10), checked-in mates in the bar sheet (N-09),
// the anonymous crowd line (N-11), takeover news only nearby (N-12), the GL-failed fallback cluster tap (N-13),
// the report really goes to the group chat (N-14), true copy (N-19). Server parts: supabase/tests/fixmo-0481.test.sql.
// Mocked Supabase (ds-helpers). usage: node fixmo-pw.js <port> [part ...]
//   parts: mom forfest crowd sheet ticker takeover fallback report copy clock   (none = all; "shots" = also the 3-width shots)
// FIXMO_OLD=<repo root>: serve docs/ (and testenv/) from that copy instead (run the checks on the old code).
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT, DIR = SP + "fixmo-shots/";
fs.mkdirSync(DIR, { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3).filter((x) => x !== "shots"), SHOTS = process.argv.includes("shots") || !ONLY.length;
const OLD = process.env.FIXMO_OLD || "", ROOT = OLD || path.join(__dirname, "..", ".."), DOCS = path.join(ROOT, "docs");
const want = (k) => !ONLY.length || ONLY.includes(k);
const { wait, GID } = H;
let pass = 0, fail = 0;
const ok = (c, m, i) => { console.log((c ? "PASS " : "FAIL ") + m + (c || i === undefined ? "" : " " + JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const soon = (m) => new Date(Date.now() + m * 60e3).toISOString();
const HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: DIR + name + ".png" }).catch(() => {});
const PITCH = { id: "n3472634175", lat: 60.14997, lng: 15.18679 }, LOBBY = { id: "x-lobbybaren-ludvika", lat: 60.15098, lng: 15.18663 };
const LUD = { lat: 60.1505, lng: 15.1872 }, SODER = { lat: 59.3155, lng: 18.0745 };

async function serveOld(page) {
  if (!OLD) return;
  await page.route((u) => u.href.startsWith(BASE) && !/\/config\.js(\?|$)/.test(u.pathname) && !/\/rest\/|\/auth\/|\/functions\//.test(u.pathname), (r) => {
    const u = new URL(r.request().url()); let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(DOCS, p);
    if (!f.startsWith(path.resolve(DOCS)) || !fs.existsSync(f)) return r.fallback();
    const ext = path.extname(f), ct = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[ext] || "application/octet-stream";
    return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
  });
}
async function setup(browser, o = {}) {
  const w = o.w || 390;
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] || 844 }, o);
  await serveOld(page);
  if (o.routes) await o.routes(page);
  if (o.init) for (const f of [].concat(o.init)) await ctx.addInitScript(f.fn || f, f.arg);
  if (o.boot !== false) await H.boot(page);
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); }).catch(() => {});
  return { ctx, page };
}
const toastSpy = () => { window.__t = []; document.addEventListener("DOMContentLoaded", () => { const t = document.getElementById("toasts"); if (t) new MutationObserver(() => window.__t.push(t.textContent)).observe(t, { childList: true, subtree: true }); }); };

// ---------- moments (the olnu_mom_view shape) ----------
const ME = "aaaaaaaaaaaa", OS = "bbbbbbbbbbbb", LI = "cccccccccccc", SA = "dddddddddddd";
const NAMES = { [ME]: "Anton", [OS]: "Oskar", [LI]: "Lisa", [SA]: "Sara" };
const base = (o) => Object.assign({ group_id: GID, group_name: "Ludvika Lager", me: ME, asked: true, names: NAMES, n_picks: 0, n_who: 4, picks: null, answer: null,
  mine: null, closes_at: soon(50), reveal_at: null, mission: null, agent_me: false, host_me: false, agent_k: null, done_at: null, done_by: null, bar_name: null, night: soon(400) }, o);
const AG = (o) => base(Object.assign({ id: 104, kind: "agent", q: "", phase: "secret", opts: [], reveal_at: soon(90), closes_at: soon(105) }, o));
const HALV = () => base({ id: 102, kind: "halvtid", q: "last_home_t", phase: "open", opts: [{ v: "f01" }, { v: "01_02" }, { v: "e02" }], n_who: 3 });
async function momRoutes(page, S) {
  await page.route(/rest\/v1\/rpc\/(after_flags_get|moments_poll|moment_reveal|moments_report|party_group)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; S.calls.push(fn);
    if (fn === "after_flags_get") return J(r, { v: 1, flags: { moments: true, push_ev: false } });
    if (fn === "moments_poll") return J(r, { v: 1, on: true, opened: 0, rounds: S.rounds });
    if (fn === "moments_report") return J(r, { v: 1, rounds: [] });
    if (fn === "party_group") return J(r, { v: 1, room: null });
    S.rounds[0].phase = "vote"; S.rounds[0].revealed_at = new Date().toISOString();
    return J(r, S.rounds[0]);
  });
}

// ---------- the morning report (after_report2 shape, 0450) ----------
const NIGHT = (() => { const d = new Date(); d.setHours(5, 0, 0, 0); return d; })();
const at = (h, m) => { const d = new Date(NIGHT); d.setDate(d.getDate() - (h >= 12 ? 1 : 0)); d.setHours(h, m, 0, 0); return d.toISOString(); };
const REPORT = { v: 1, night: NIGHT.toISOString(), evening: at(18, 0).slice(0, 10), group: { id: GID, name: "Grabbarna Grus" }, groups: [{ id: GID, name: "Grabbarna Grus", n: 3, me: true }],
  people: [
    { k: "k-anton", name: "Anton", is_me: true, first_at: at(20, 47), last_at: at(23, 30), first_place: "Pitchers", bars: 1, said_ute: true, said_at: at(18, 12), home_at: at(0, 40), skal: 3, driver: false, out: true },
    { k: "k-oskar", name: "Oskar", is_me: false, first_at: at(21, 21), last_at: at(1, 50), first_place: "Pitchers", bars: 2, said_ute: true, said_at: at(19, 2), home_at: at(2, 41), skal: 0, driver: false, out: true },
    { k: "k-lisa", name: "Lisa", is_me: false, first_at: at(21, 30), last_at: at(0, 15), first_place: "Pitchers", bars: 1, said_ute: false, said_at: null, home_at: at(1, 0), skal: 5, driver: false, out: true }],
  stops: [{ k: "k-anton", at: at(20, 47), bar_id: PITCH.id, name: "Pitchers", lat: PITCH.lat, lng: PITCH.lng },
    { k: "k-oskar", at: at(22, 5), bar_id: LOBBY.id, name: "Lobbybaren", lat: LOBBY.lat, lng: LOBBY.lng }],
  homes: [], prev: null, ghost_me: false, bets: [], missions: [], agent: null };

(async () => {
  // the proxy (when the machine has one) only so that N-13 can load mapbox-gl.js from the CDN; every Supabase call is mocked
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"],
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}) });
  try {
    /* ---------- N-05 a: the Förfest host (not the agent) gets a chip + group card in the secret phase ---------- */
    if (want("mom")) {
      for (const w of SHOTS ? [360, 390, 430] : [390]) {
        const S = { rounds: [AG({ host_me: true })], calls: [] };
        const { ctx, page } = await setup(browser, { w, empty: true, routes: (p) => momRoutes(p, S), init: toastSpy });
        await wait(page, 3500);
        const r = await page.evaluate((GID) => {
          const M = window.MOMENTS, chip = M.chipHTML(), g = M.groupCard({ id: GID, name: "Ludvika Lager" });
          if (g) { g.id = "fixmo-gcard"; (document.getElementById("sheet-body") || document.body).appendChild(g); }
          return { chip, g: g ? g.textContent : null, need: M._need(M._rounds()[0]), toasts: (window.__t || []).join(" | ") };
        }, GID);
        if (w === 390) {
          ok(/Avslöja agenten/.test(r.chip || "") && r.need === "reveal", "N-05 host in the secret phase: HUD chip 'Avslöja agenten'", r);
          ok(/Avslöja agenten/.test(r.g || ""), "N-05 host: group card 'Hemlig agent · Avslöja agenten'", r);
          await page.evaluate(() => { const g = document.getElementById("fixmo-gcard"); if (g) g.click(); }); await wait(page, 700);
          const c = await page.evaluate(() => ({ rev: !!document.querySelector('.mo [data-mo-a="reveal"]') }));
          ok(c.rev, "N-05 the card from the group card has 'Avslöja nu'", c);
          await page.evaluate(() => { const b = document.querySelector('.mo [data-mo-a="reveal"]'); if (b) b.click(); }); await wait(page, 800);
          ok(S.calls.includes("moment_reveal"), "N-05 Avslöja nu → moment_reveal", S.calls);
        } else {
          await page.evaluate(() => { const c = document.getElementById("fixmo-gcard"); if (c) c.scrollIntoView(); });
          await shot(page, "n05-host-card-" + w);
        }
        await ctx.close();
      }
      {   // a host who already voted / a non-host member: no reveal chip; an urgent moment comes before the reveal chip
        const S = { rounds: [AG({ host_me: false }), HALV()], calls: [] };
        const { ctx, page } = await setup(browser, { empty: true, routes: (p) => momRoutes(p, S) });
        await wait(page, 3500);
        const r = await page.evaluate(() => ({ n0: window.MOMENTS._need(window.MOMENTS._rounds()[0]), chip: window.MOMENTS.chipHTML() }));
        ok(r.n0 === "" && /Halvtid/.test(r.chip), "N-05 a member who is not the host: no reveal (the old rule)", r);
        S.rounds = [AG({ host_me: true }), HALV()];
        await page.evaluate(() => window.MOMENTS.poll()); await wait(page, 800);
        const r2 = await page.evaluate(() => window.MOMENTS.chipHTML());
        ok(/Halvtid/.test(r2), "N-05 host with an open Halvtid: the Halvtid chip first, the reveal waits", r2);
        /* N-07: every moment of the night in the morning report */
        const n = await page.evaluate(() => {
          const set = (o) => Object.assign({ names: { a1: "Anton", b2: "Oskar" }, picks: [{ k: "a1", pick: "f01", right: true }] }, o);
          const rs = [set({ kind: "vad", q: "first_home", answer: { v: "a1" } }), set({ kind: "halvtid", q: "last_home_t", answer: { v: "f01" } }),
            set({ kind: "bord", bar_name: "Pitchers", mission: 2, done_at: new Date().toISOString(), done_by: "Oskar" }), set({ kind: "bord", bar_name: "Lobbybaren", mission: 4 }),
            set({ kind: "agent", agent_k: "b2", mission: 3, answer: { v: "b2", done: true, won: true, votes: 2, right: 0 } })];
          return window.MOMENTS.reportCards({ d: { moments: rs } }).map((c) => c.kick);
        });
        ok(n.length === 5 && n.includes("Halvtid") && n.includes("Hemlig agent"), "N-07 morning report: all 5 moments (Halvtid + agent no longer dropped)", n);
        await ctx.close();
      }
    }

    /* ---------- N-05 b: the Förfest start screen shows new group members when it comes back ---------- */
    if (want("forfest")) {
      const S = { n: 3 };
      const NM = ["Oskar", "Lisa", "Gus", "Hed"];
      const { ctx, page } = await setup(browser, { empty: true, routes: (p) => p.route(/rest\/v1\/rpc\/group_status\b/, (r) =>
        J(r, [{ name: "Anton", is_me: true, beers: 0, live: true }].concat(NM.slice(0, S.n - 1).map((n) => ({ name: n, is_me: false, beers: 0, live: true }))))) });
      await page.evaluate((GID) => window.FORFEST.open({ id: GID, name: "Ludvika Lager" }), GID);
      await page.waitForFunction(() => document.querySelector(".ff-mode.m-u:not([disabled])"), null, { timeout: 15000 }).catch(() => {});
      const a = await page.evaluate(() => window.FORFEST._state().players.map((p) => p.name));
      await page.evaluate(() => { const b = document.querySelector(".ff-mode.m-u"); if (b) b.click(); }); await wait(page, 800);
      S.n = 5;   // Gus + Hed joined the group while the game runs
      await wait(page, 15500);
      await page.evaluate(() => document.getElementById("ff").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await wait(page, 1500);
      const b = await page.evaluate(() => ({ p: window.FORFEST._state().players.map((p) => p.name), playing: window.FORFEST._state().playing }));
      ok(a.length === 3 && !b.playing && b.p.includes("Gus") && b.p.includes("Hed"), "N-05 Förfest: back on the start screen the 2 new members show", { a, b });
      await ctx.close();
    }

    /* ---------- N-08: crowd count = distinct people (pins ∪ check-ins) ---------- */
    if (want("crowd")) {
      const { ctx, page } = await setup(browser, { empty: true });
      const r = await page.evaluate((P) => {
        const C = window.PNCROWD, bar = { id: P.id }, ci = (o) => Object.assign({ bar_id: P.id, bar_name: "Pitchers", lat: P.lat, lng: P.lng, is_mine: false, is_friend: false, name: null }, o);
        C._reset();
        const a = C.at(bar, [{ friend_name: "Lisa" }, { friend_name: "Bo" }], [ci({ is_friend: true, name: "Oskar" })]);
        C._reset();
        const b = C.at(bar, [{ friend_name: "Lisa" }], [ci({ is_friend: true, name: "Lisa" })]);
        C._reset();
        const c = C.at(bar, [{ is_mine: true }, {}, {}], [ci({ is_mine: true }), ci({}), ci({}), ci({})]);
        C._reset();
        return { a: [a.n, a.word], b: b.n, c: c.n };
      }, PITCH);
      ok(r.a[0] === 3 && r.a[1] === "Livligt", "N-08 2 mates with a pin + 1 checked-in mate = 3 people · Livligt (was max = 2 · Lugnt)", r);
      ok(r.b === 1, "N-08 the same mate with a pin AND a check-in counts once", r);
      ok(r.c === 4, "N-08 me (pin + check-in) once + strangers = the larger anonymous count (2 pins / 3 check-ins → 3)", r);
      await ctx.close();
    }

    /* ---------- N-09: the bar sheet lists checked-in mates without a pin ---------- */
    if (want("sheet")) {
      for (const w of SHOTS ? [390, 360, 430] : [390]) {
        const { ctx, page } = await setup(browser, { w, routes: (p) => p.route(/rest\/v1\/rpc\/live_checkins\b/, (r) => J(r, [
          { bar_id: LOBBY.id, bar_name: "Lobbybaren (Grand Hotel Elektra)", lat: LOBBY.lat, lng: LOBBY.lng, name: "Mia", is_mine: false, is_friend: true, created_at: iso(15) },
          { bar_id: LOBBY.id, bar_name: "Lobbybaren (Grand Hotel Elektra)", lat: LOBBY.lat, lng: LOBBY.lng, name: null, is_mine: false, is_friend: false, created_at: iso(25) }])) });
        await page.evaluate((L) => { window.__map.closePopup(); window.__map.setView([L.lat, L.lng], 17, { animate: false }); }, LOBBY); await wait(page, 2500);
        const opened = await page.evaluate((id) => { const m = document.querySelector('.leaflet-marker-icon.cm[data-bar="' + id + '"] .bar-ico') || document.querySelector('.leaflet-marker-icon.cm[data-bar="' + id + '"]'); if (m) m.click(); return !!m; }, LOBBY.id);
        await wait(page, 1500);
        const r = await page.evaluate(() => { const h = document.querySelector(".pn-bs-hero"); return { hero: h ? h.innerText : null, row: !!document.querySelector(".pn-bs-frci") }; });
        if (w === 390) ok(opened && r.row && /Mia/.test(r.hero || "") && /Incheckad/.test(r.hero || ""), "N-09 bar sheet: checked-in mate Mia (no pin) is in 'here' with 'Incheckad'", Object.assign({ opened }, r));
        else await shot(page, "n09-bar-sheet-" + w);
        if (w === 390 && SHOTS) await shot(page, "n09-bar-sheet-390");
        await ctx.close();
      }
    }

    /* ---------- N-10 / N-11 / N-19 (Ikväll): the ticker ---------- */
    if (want("ticker") || want("copy")) {
      const { ctx, page } = await setup(browser, { empty: true, checkin: false });
      await page.waitForFunction(() => window.NEWS && window.NEWS_GT && window.CITIES, null, { timeout: 20000 }).catch(() => {});
      const R = await page.evaluate(({ P, LUD }) => {
        const N = window.NEWS, when = (hh, mm) => new Date("2026-11-13T" + hh + ":" + mm + ":00+01:00");
        const rounds = (n, beers, ctx) => { const out = []; for (let i = 0; i < n; i++) { try { localStorage.removeItem("olnu.tkNight"); } catch (e) {} out.push(...N.build(beers, Object.assign({ prev: [] }, ctx()))); } return out; };
        const pin = (id, n, o) => Object.assign({ id, lat: P.lat, lng: P.lng, bar_id: P.id, beer_count: n, other_count: 0, precise: true, is_mine: false, friend_name: null, skal_count: 0, created_at: new Date(Date.now() - 40 * 60e3).toISOString() }, o || {});
        const ci = (o) => Object.assign({ bar_id: P.id, bar_name: "Pitchers", lat: P.lat, lng: P.lng, name: null, is_mine: false, is_friend: false, created_at: new Date(Date.now() - 12 * 60e3).toISOString() }, o);
        // 2 mates with a pin at Pitchers + 3 check-ins there (2 other mates + one of the pin mates) = 4 people
        const pins = [pin(9301, 2, { friend_name: "Lisa" }), pin(9302, 3, { friend_name: "Bo" })];
        const cis = [ci({ is_friend: true, name: "Oskar" }), ci({ is_friend: true, name: "Cia" }), ci({ is_friend: true, name: "Lisa" })];
        const a = rounds(160, pins, () => ({ center: LUD, now: when("22", "10"), checkins: cis, liveTotal: 30 }));
        const K = /^(barReport|checkinCrowd|townOut)$/, nums = (t) => (t.match(/\d+/g) || []).map(Number);
        const counted = a.filter((x) => K.test(x.k));
        const bad = counted.filter((x) => { const n = nums(x.text); return n.length && !n.includes(4); }).map((x) => x.k + ": " + x.text).slice(0, 4);
        const good = counted.filter((x) => nums(x.text).includes(4)).map((x) => x.k);
        // 9 anonymous check-ins: the crowd line never says "Hela gänget" (it is not the user's gang)
        const b = rounds(160, [], () => ({ center: LUD, now: when("22", "20"), checkins: Array.from({ length: 9 }, () => ci({})), liveTotal: 30 }));
        const gang = b.filter((x) => x.k === "checkinCrowd" && /Hela gänget/.test(x.text)).map((x) => x.text).slice(0, 2);
        // 14:05: the "”Ikväll?” till gänget" line keeps a small "till"
        const c = rounds(260, [], () => ({ center: LUD, now: when("14", "05"), checkins: [], liveTotal: 3 }));
        const ikvBad = c.filter((x) => /”Ikväll\?” Till/.test(x.text)).map((x) => x.text).slice(0, 2), ikvOk = c.filter((x) => /”Ikväll\?” till/.test(x.text)).length;
        return { n: a.length, bad, good: [...new Set(good)], nCounted: counted.length, nCrowd: b.filter((x) => x.k === "checkinCrowd").length, gang, ikvBad, ikvOk };
      }, { P: PITCH, LUD });
      if (want("ticker")) {
        ok(R.nCounted > 0 && !R.bad.length && R.good.includes("townOut"), "N-10 ticker: bar / check-in / town lines count 4 distinct people (not pins only / check-ins only)", R);
        ok(R.nCrowd > 0 && !R.gang.length, "N-11 the anonymous crowd line never says 'Hela gänget' (" + R.nCrowd + " lines)", R.gang);
        const packs = fs.readdirSync(path.join(DOCS, "js", "dialekt-packs")).filter((f) => /\.js$/.test(f)).concat(["../news-more.js"]);
        const hits = [];
        packs.forEach((f) => {
          const s = fs.readFileSync(path.join(DOCS, "js", "dialekt-packs", f), "utf8");
          const i = s.indexOf('"live.checkinCrowd": ['); if (i >= 0) { const blk = s.slice(i, s.indexOf("]", i)); if (/Hela gänget/.test(blk)) hits.push(f); }
          if (f === "../news-more.js" && /live\.checkinCrowd"[^\n]*Hela gänget/.test(s)) hits.push(f);
        });
        ok(!hits.length, "N-11 no pack (and no plain def) has 'Hela gänget' in live.checkinCrowd", hits);
      }
      if (want("copy")) ok(R.ikvOk > 0 && !R.ikvBad.length, "N-19 ”Ikväll?” till gänget: no capital after a quoted question (" + R.ikvOk + " lines)", R.ikvBad);
      await ctx.close();
    }

    /* ---------- N-12: takeover / queue news only for bars near the user ---------- */
    if (want("takeover")) {
      const STH = { id: "fixmo-sth-bar", name: "Fixmo Söderbar", lat: SODER.lat, lng: SODER.lng, type: "pub" };
      const { ctx, page } = await setup(browser, { routes: async (p) => {
        await p.route(/\/bars\.json(\?|$)/, (r) => { let list = []; try { list = JSON.parse(fs.readFileSync(path.join(DOCS, "bars.json"), "utf8")); } catch (e) {} return J(r, list.concat([STH])); });
        await p.route(/rest\/v1\/rpc\/bar_status\b/, (r) => J(r, [{ bar_id: STH.id, owner_n: 4, owner_name: "Söderligan", owner_mine: false, queue: "long", queue_at: iso(3), offers: [] }]));
        await p.route(/overpass/, (r) => r.abort());
      } });
      await page.waitForFunction((id) => window.BARSPLUS && window.BARSPLUS.status && window.BARSPLUS.status()[id], STH.id, { timeout: 30000 }).catch(() => {});
      const r = await page.evaluate(({ LUD, SODER }) => {
        const B = window.BARSPLUS, f = (c) => (B.newsCands({ center: c, checkins: [] }) || []).map((x) => x.k + ":" + (x.d && x.d.bar));
        return { has: !!B.status()["fixmo-sth-bar"], lud: f(LUD), sod: f(SODER) };
      }, { LUD, SODER });
      ok(r.has && !r.lud.some((x) => /Fixmo Söderbar/.test(x)), "N-12 in Ludvika: no takeover / queue news about a Stockholm bar", r);
      ok(r.sod.some((x) => /^takeover:Fixmo Söderbar/.test(x)), "N-12 on Söder: that bar's takeover news shows", r);
      await ctx.close();
    }

    /* ---------- N-13: GL attached but the style failed → the DOM fallback cluster tap zooms in ---------- */
    if (want("fallback")) {
      const { ctx, page } = await setup(browser, { boot: false, routes: async (p) => {
        await p.route(/rest\/v1\/rpc\/public_config\b/, (r) => J(r, { v: 1, mapbox_token: "pk.eyJ1IjoiZml4bW8iLCJhIjoiZml4bW8ifQ.fixmo-test-not-a-token" }));
        await p.route(/api\.mapbox\.com\//, (r) => r.abort());   // the style never loads (as on a blocked / failed Mapbox)
      } });
      await page.goto(BASE);
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 40000 }).catch(() => console.log("no pills"));
      await wait(page, 3000);
      const st0 = await page.evaluate(() => ({ gl: !!(window.__map.isGL && window.__map.isGL()), canvas: !!document.querySelector(".mapboxgl-canvas"), glbars: !!(window.GLBARS && window.GLBARS.on && window.GLBARS.on()) }));
      await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 13.6, { animate: false })); await wait(page, 2500);
      const cl = await page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-icon.tz-cl")].map((e) => { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2, t = document.elementFromPoint(x, y);
        return { x, y, hit: !!(t && t.closest(".tz-cl")), top: t ? t.tagName + "." + String(t.className && t.className.baseVal != null ? t.className.baseVal : t.className).slice(0, 40) : "" }; }).filter((c) => c.y > 140 && c.y < innerHeight - 260));
      let z0 = 0, z1 = 0;
      if (cl.length) {
        z0 = await page.evaluate(() => window.__map.getZoom());
        await page.touchscreen.tap(cl[0].x, cl[0].y); await wait(page, 1600);
        z1 = await page.evaluate(() => window.__map.getZoom());
      }
      ok(st0.gl && !st0.glbars && cl.length > 0, "N-13 setup: GL map attached, its style failed (GLBARS off), DOM fallback clusters drawn", { st0, n: cl.length });
      ok(cl.length > 0 && z1 > z0 + 0.5, "N-13 a tap on a fallback cluster capsule zooms in (even where a full pill box / the GL canvas is on top of it)", { c: cl[0], z0, z1 });
      await ctx.close();
    }

    /* ---------- N-14: "Skicka till gruppchatten" posts the report card in the group chat ---------- */
    if (want("report")) {
      for (const w of SHOTS ? [390, 360, 430] : [390]) {
        const S = { posts: [] };
        const { ctx, page } = await setup(browser, { w, empty: true, init: [toastSpy, () => { try { localStorage.setItem("olnu.terms", "1"); } catch (e) {} }], routes: async (p) => {
          await p.route(/rest\/v1\/rpc\/after_report2\b/, (r) => J(r, REPORT));
          await p.route(/rest\/v1\/rpc\/post_photo\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} S.posts.push(b); return J(r, { id: 501, msg_id: 9001, created_at: new Date().toISOString(), left: 40 }); });
        } });
        await page.evaluate(() => window.AFTER2.open(null, null));
        await page.waitForFunction(() => document.querySelector('.a2 [data-a2="next"]'), null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => { const st = window.AFTER2._st(); st.i = st.m.cards.length - 2; document.querySelector('.a2 [data-a2="next"]').click(); }); await wait(page, 400);
        await page.evaluate(() => document.querySelector('.a2 [data-a2="shareAll"]').click()); await wait(page, 1600);
        const f = await page.evaluate(() => { const c = document.querySelector(".a2-sh-card"), b = c && c.getBoundingClientRect(), row = c && [...c.querySelectorAll(".a2-row .a2-btn")].map((x) => x.getBoundingClientRect());
          return { fits: !!b && b.right <= innerWidth + 1 && b.left >= -1 && row.every((r) => r.right <= b.right + 1 && r.height >= 44), n: row ? row.length : 0, label: (c.querySelector('[data-a2="send"]') || {}).textContent }; });
        if (w !== 390) { await shot(page, "n14-share-sheet-" + w); ok(f.fits, `N-14 share sheet (3 buttons) fits @${w}`, f); await ctx.close(); continue; }
        await shot(page, "n14-share-sheet-390");
        await page.evaluate(() => { const b = document.querySelector('.a2-sh [data-a2="send"]'); if (b) b.click(); });
        await page.waitForFunction(() => !document.querySelector(".a2-sh"), null, { timeout: 15000 }).catch(() => {});
        await wait(page, 500);
        const p0 = S.posts[0] || {};
        const t = await page.evaluate(() => (window.__t || []).join(" | "));
        ok(S.posts.length === 1 && p0.p_group_id === GID && String(p0.p_b64 || "").length > 2000 && p0.p_w <= 1024 && p0.p_h <= 1024 && /Kvällsrapporten/.test(p0.p_caption || ""),
          "N-14 'Skicka till gruppchatten' = post_photo in the group (JPEG ≤ 1024 px + the share text)", { n: S.posts.length, g: p0.p_group_id, b64: String(p0.p_b64 || "").length, w: p0.p_w, h: p0.p_h, cap: p0.p_caption });
        ok(/chatten hos Grabbarna Grus|Skickat till Grabbarna Grus/.test(t) && !(await page.evaluate(() => !!document.querySelector(".a2-sh"))), "N-14 toast 'in the group chat', the share sheet closes", t.slice(0, 200));
        await ctx.close();
      }
    }

    /* ---------- N-19: the Ute nu sheet tells the true refresh ---------- */
    if (want("copy")) {
      for (const w of SHOTS ? [390, 360, 430] : [390]) {
        const { ctx, page } = await setup(browser, { w });
        await page.evaluate(() => document.getElementById("live-count").click()); await wait(page, 1200);
        const t = await page.evaluate(() => (document.querySelector(".zn-out-note") || {}).textContent || "");
        if (w === 390) ok(/var 5:e minut/.test(t) && !/varje minut/.test(t), "N-19 Ute nu (zoomed in): 'uppdateras var 5:e minut' (the real 5 min)", t);
        if (SHOTS) await shot(page, "n19-ute-nu-" + w);
        await ctx.close();
      }
    }

    /* ---------- N-06: the test kit's fake clock (+5 h) does not make the login refresh in a loop ---------- */
    if (want("clock")) {
      const TE = fs.readFileSync(path.join(ROOT, "testenv", "testenv.js"), "utf8");
      let refresh = 0, signup = 0;
      const { ctx, page } = await setup(browser, { boot: false, init: [
        // the test build's storage prefix: copy the seeded keys to pnt1: and set the clock offset (+5 h); then testenv.js
        () => { try { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); ks.forEach((k) => { if (k.indexOf("pnt") !== 0 && !localStorage.getItem("pnt1:" + k)) localStorage.setItem("pnt1:" + k, localStorage.getItem(k)); });
          if (!localStorage.getItem("pnt1:pnt.clock")) { localStorage.setItem("pnt1:pnt.clock", JSON.stringify({ off: 5 * 3600e3 })); const a = JSON.parse(localStorage.getItem("pnt1:olnu.auth") || "{}"); a.expires_at = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem("pnt1:olnu.auth", JSON.stringify(a)); } } catch (e) {} },
        { fn: (src) => { (0, eval)(src); }, arg: TE }], routes: async (p) => {
        // a REAL-time expiry (1 h from now), like the staging auth server
        await p.route(/\/auth\/v1\//, (r) => { const u = r.request().url(); if (/grant_type=refresh_token/.test(u)) refresh++; if (/signup/.test(u)) signup++;
          if (/\/user/.test(u)) return J(r, { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true });
          const now = Math.floor(Date.now() / 1000);
          return J(r, { access_token: "x." + Buffer.from(JSON.stringify({ sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role: "authenticated", exp: now + 3600 })).toString("base64url") + ".s", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "rt-" + now + "-" + Math.random().toString(36).slice(2),
            user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true } });
        });
        await p.route(/rest\/v1\/rpc\/zz_test_\w+/, (r) => J(r, { ok: true, flags: {}, offset_min: 300 }));
      } });
      await page.goto(BASE);
      await page.waitForFunction(() => window.PNTEST && window.__map, null, { timeout: 30000 }).catch(() => {});
      const r0 = await page.evaluate(() => ({ off: window.PNTEST && window.PNTEST.clock.off(), skew: Date.now() - (window.PNTEST ? window.PNTEST.clock.real() : Date.now()) }));
      const n0 = refresh; await wait(page, 25000);
      const n1 = refresh - n0;
      ok(r0.off === 5 * 3600e3 && Math.abs(r0.skew - 5 * 3600e3) < 5000, "N-06 setup: the test kit's fake clock is +5 h", r0);
      ok(n1 <= 1, "N-06 fake clock +5 h: at most 1 login refresh in 25 s (was a refresh ~1/s)", { refresh25s: n1, total: refresh, signup });
      await ctx.close();
    }
  } catch (e) { console.log("ERROR", e && e.stack || e); fail++; }
  await browser.close();
  console.log(`SUMMARY fixmo ${pass} PASS ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
