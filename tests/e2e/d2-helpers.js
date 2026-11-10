// Design review screenshots. Usage: node design-shots.js <port> [scenario...]
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const RPCF = require("./fixtures/rpc.js");
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const now = Date.now();
const iso = (m) => new Date(now - m * 60e3).toISOString();
const J = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const GID = "11111111-2222-3333-4444-555555555555";

// ---------- A busy Friday night in Ludvika ----------
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
let id = 1000;
const P = (ll, n, o = {}) => ({ id: id++, lat: ll[0] + (o.j ? (Math.random() - .5) * 0.00025 : 0), lng: ll[1] + (o.j ? (Math.random() - .5) * 0.0004 : 0),
  beer_count: n, precise: o.precise !== false, created_at: iso(o.m || 30), is_mine: !!o.mine, friend_name: o.f || null,
  skal_count: o.sk || 0, i_skaled: false, shot_count: 0 });
const beers = [
  // La Parma: 7 incl. Oskar MEDEVAC
  P(BAR.parma, 11, { f: "Oskar", sk: 4, j: 1, m: 200 }), P(BAR.parma, 3, { j: 1 }), P(BAR.parma, 2, { j: 1 }), P(BAR.parma, 6, { j: 1 }),
  P(BAR.parma, 1, { j: 1, m: 5 }), P(BAR.parma, 4, { j: 1 }), P(BAR.parma, 2, { f: "Lisa", j: 1 }),
  // Pitchers: me (6, hot) + 4
  P(BAR.pitch, 6, { mine: 1, sk: 2, m: 150 }), P(BAR.pitch, 2, { j: 1 }), P(BAR.pitch, 5, { j: 1 }), P(BAR.pitch, 1, { j: 1 }), P(BAR.pitch, 3, { f: "Ida", j: 1 }),
  // Lobbybaren 3
  P(BAR.lobby, 2, { j: 1 }), P(BAR.lobby, 1, { j: 1 }), P(BAR.lobby, 3, { j: 1 }),
  // Grekiska 2
  P(BAR.grek, 2, { j: 1 }), P(BAR.grek, 1, { j: 1 }),
  // Home parties and singles around town
  P([60.1545, 15.1960], 7, { f: "Robban", sk: 1 }), P([60.15456, 15.19615], 4), P([60.15445, 15.1958], 2),
  P([60.1462, 15.1801], 1), P([60.1431, 15.1950], 3, { precise: false }), P([60.1580, 15.1745], 9, { precise: false }),
  P([60.1478, 15.2040], 2), P([60.1610, 15.1890], 12), P([60.1395, 15.1712], 1, { precise: false }),
];
const MY = beers.find((b) => b.is_mine);
const others = [{ beer_id: beers[2].id, other_count: 2, other_kind: "vin" }, { beer_id: beers[9].id, other_count: 1, other_kind: "cider" },
  { beer_id: beers[18].id, other_count: 3, other_kind: "shot" }];
const checkins = [
  { bar_id: "x-la-parma-ludvika", bar_name: "La Parma Pub & Restaurang", lat: BAR.parma[0], lng: BAR.parma[1], name: "Oskar", is_mine: false, is_friend: true, created_at: iso(120) },
  { bar_id: "n3472634175", bar_name: "Pitchers", lat: BAR.pitch[0], lng: BAR.pitch[1], name: "Anton", is_mine: true, is_friend: false, created_at: iso(90) },
  { bar_id: "n3472634175", bar_name: "Pitchers", lat: BAR.pitch[0], lng: BAR.pitch[1], name: "Kalle K", is_mine: false, is_friend: false, created_at: iso(40) },
  { bar_id: "x-lobbybaren-ludvika", bar_name: "Lobbybaren (Grand Hotel Elektra)", lat: BAR.lobby[0], lng: BAR.lobby[1], name: "Sara", is_mine: false, is_friend: false, created_at: iso(20) },
];
const rally = { id: 77, name: "Oskar", body: "Alla till La Parma, jag bjuder på första rundan!!", place: "La Parma Pub & Restaurang", lat: BAR.parma[0], lng: BAR.parma[1],
  created_at: iso(6), yes: 2, no: 0, maybe: 1, my_answer: null, yes_names: ["Lisa", "Ida"], is_mine: false, group_id: GID, group_name: "Ludvika Lager" };
const M = (medal, count) => ({ medal, count: count || 1, earned_at: iso(60) });
const myMedals = [M("m1"), M("m10"), M("pluton"), M("krogrunda", 3), M("stammis"), M("kung", 2), M("hemvarn", 4), M("fortrupp", 2), M("radio"), M("tisdag", 5), M("vatten", 6), M("het")];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role: "authenticated", exp: Math.floor(now / 1000) + 86400, is_anonymous: true }) + ".sig";
}
const SESSION = { access_token: fakeJwt(), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, refresh_token: "rt-fake",
  user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: iso(9999) } };

// rpc_bundle2 (app.js bundleGo): send each inner call from the page to /rest/v1/rpc/<name>, so it goes through the same
// routes as a single call (a test's own page.route wins, then the switch below, then fixtures/rpc.js).
async function bundleViaPage(page, r, body) {
  const url = r.request().url(), base = url.slice(0, url.indexOf("/rpc/") + 5), h = r.request().headers();
  const calls = (body && body.p_calls) || [];
  let out = null;
  try {
    out = await page.evaluate(async ({ base, calls, auth, key }) => {
      const o = {};
      await Promise.all(calls.map(async (c) => {
        try {
          const res = await fetch(base + c.n, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: auth }, body: JSON.stringify(c.a || {}) });
          const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
          o[c.k] = res.ok ? { d } : { e: { code: (d && d.code) || String(res.status), message: (d && d.message) || "error" } };
        } catch (e) { o[c.k] = { e: { code: "not_bundled", message: "not_bundled" } }; }
      }));
      return o;
    }, { base, calls, auth: h.authorization || "", key: h.apikey || "" });
  } catch (e) { out = null; }
  if (!out) { out = {}; calls.forEach((c) => { out[c.k] = { e: { code: "not_bundled", message: "not_bundled" } }; }); }
  return J(r, out);
}
async function mock(page, opt = {}) {
  await page.route(/\/auth\/v1\//, (r) => {
    const u = r.request().url();
    if (/\/user/.test(u)) return J(r, SESSION.user);
    return J(r, SESSION);
  });
  await page.route(/functions\/v1\//, (r) => J(r, {}));
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "rpc_bundle2") return bundleViaPage(page, r, body);
    switch (fn) {
      case "live_beers": return J(r, opt.empty ? [] : beers);
      case "live_others": return J(r, opt.empty ? [] : others);
      case "live_checkins": return J(r, opt.empty ? [] : checkins);
      case "heat_points": return J(r, beers.map((b) => ({ lat: b.lat, lng: b.lng, w: b.beer_count })));
      case "ghost_points": return J(r, beers.map((b) => ({ lat: b.lat + 0.001, lng: b.lng - 0.002, w: 2 })));
      case "bar_kings": return J(r, [{ bar_id: "x-la-parma-ludvika", king_name: "Oskar", king_n: 11, is_me: false }, { bar_id: "n3472634175", king_name: "Anton", king_n: 6, is_me: true }]);
      case "my_stats": return J(r, { total: 43, week: 6, title: "Löjtnant Lager", next_title: "Premiärlöjtnant Pilsner", next_at: 52 });
      case "my_groups": return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 3 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet (ABB-gänget)", code: "XYZ789", member_count: 9, active_count: 0 }]);
      case "group_status": return J(r, [
        { name: "Oskar", beers: 11, others: 0, other_kind: null, live: true, total: 312, is_me: false },
        { name: "Anton", beers: 6, others: 1, other_kind: "rom", live: true, total: 43, is_me: true },
        { name: "Lisa", beers: 2, others: 2, other_kind: "vin", live: true, total: 18, is_me: false },
        { name: "Nisse", beers: 0, others: 0, other_kind: null, live: false, total: 1, is_me: false }]);
      case "group_msgs": return J(r, body.p_after_id > 0 ? [] : [
        { id: 1, name: "Lisa", body: "Var é ni?", created_at: iso(50), is_me: false },
        { id: 2, name: "Oskar", body: "La Parma. Kom nu, det är fullt ös här och bartendern har gett upp", created_at: iso(44), is_me: false },
        { id: 3, name: "Anton", body: "Sitter på Pitchers, kommer efter den här", created_at: iso(40), is_me: true },
        { id: 4, name: "Oskar", body: "🚁🚁🚁", created_at: iso(12), is_me: false }]);
      case "group_league": return J(r, [
        { group_id: "g1", name: "Borlänge Bärs", total: 61, members: 12, rank: 1, is_mine: false },
        { group_id: GID, name: "Ludvika Lager", total: 19, members: 4, rank: 2, is_mine: true },
        { group_id: "g3", name: "Smedjebackens Supare", total: 14, members: 7, rank: 3, is_mine: false },
        { group_id: "g4", name: "Grängesberg Gänget", total: 6, members: 3, rank: 4, is_mine: false }]);
      case "friend_totals": return J(r, beers.filter((b) => b.friend_name).map((b) => ({ beer_id: b.id, total: 100 + b.id % 50 })));
      case "beer_reactions": return J(r, [{ beer_id: beers[0].id, emoji: "🚁", n: 3, mine: false }, { beer_id: beers[0].id, emoji: "🍻", n: 2, mine: true }, { beer_id: MY.id, emoji: "🔥", n: 2, mine: false }]);
      case "my_rallies": return J(r, opt.rally ? [rally] : []);
      case "my_medals": return J(r, myMedals);
      case "award_medals": return J(r, []);
      case "member_medals": return J(r, [
        ...["m1", "m10", "m50", "m100", "b5", "krogrunda", "stammis", "kung", "pluton", "kompani"].map((m) => ({ name: "Oskar", is_me: false, medal: m, earned_at: iso(60), count: 1 })),
        ...myMedals.map((x) => ({ name: "Anton", is_me: true, medal: x.medal, earned_at: iso(60), count: x.count }))]);
      case "post_beer": return J(r, { accepted: true, beer_count: opt.postN || 7, lat: MY.lat, lng: MY.lng, precise: true, expires_at: new Date(now + 6 * 3600e3).toISOString(), wait_seconds: 0 });
      case "record_bar": return J(r, {});
      default: {   // shared answers (fixtures/rpc.js); anything else is recorded as unmocked (rpc-cover-pw.js fails on it)
        const a = RPCF.answer(fn, body, { now });
        if (a !== undefined) return J(r, a);
        (page.__pnUnmocked = page.__pnUnmocked || new Set()).add(fn);
        return J(r, []);
      }
    }
  });
}
// RPC names this page asked for that neither the switch above nor fixtures/rpc.js answers (a test's own routes win first)
const unmocked = (page) => [...(page.__pnUnmocked || [])].sort();

function seed(o = {}) {
  return ({ o, SESSION }) => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    // lane main S5: a fresh phone now meets "Installera appen" first; tests of other things start at the intro ({install: true} = keep the guide)
    if (o.clean) { if (!o.install) localStorage.setItem("olnu.inst1", JSON.stringify({ n: 2, how: "test" })); return; }
    const S = (k, v) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    S("olnu.name", "Anton"); S("olnu.age18", "1"); S("olnu.intro", "1"); S("olnu.newsPn", "1"); S("olnu.locOk", "1"); S("olnu.notifAsked", "1"); S("olnu.notifAskAt", String(Date.now()));
    S("olnu.guideSeen", String(Date.now())); S("olnu.installSeen", "1"); S("olnu.lang", o.lang || "sv");
    S("olnu.title", "Löjtnant Lager"); S("olnu.titleTotal", "43"); S("olnu.ladder", "11"); S("olnu.medalsSeeded", "1"); S("olnu.medalsMigrated", "1");
    S("olnu.auth", SESSION);
    const exp = Date.now() + 6 * 3600e3;
    S("olnu.night", { count: 6, expires: exp, lastTap: o.cooldown ? Date.now() - 3 * 60e3 : Date.now() - 40 * 60e3 });
    if (o.checkin !== false) S("olnu.checkin", { id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679, at: Date.now() - 90 * 60e3, until: exp });
  };
}

const shot = (page, name) => page.screenshot({ path: SP + "ui-testshots/design-" + name + ".png" }).then(() => console.log("shot", name));
const wait = (page, ms) => page.waitForTimeout(ms);
const clickJS = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const clickText = (page, sel, re) => page.evaluate(([s, r]) => { const e = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); if (e) e.click(); return e ? e.textContent : null; }, [sel, re]);
const closeSheet = (page) => clickJS(page, "#sheet-close");

async function ctxFor(browser, vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, locale: "sv-SE", isMobile: true, hasTouch: true,
    geolocation: { latitude: 60.1511, longitude: 15.1876 }, permissions: ["geolocation"], reducedMotion: o.reduced ? "reduce" : "no-preference",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  await ctx.addInitScript(seed(o), { o, SESSION });
  await ctx.addInitScript(() => {
    let _L;
    Object.defineProperty(window, "L", { configurable: true, get() { return _L; },
      set(v) { _L = v; if (v && v.Map && !v.__hooked) { v.__hooked = 1; v.Map.addInitHook(function () { window.__map = this; }); } } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await mock(page, o);
  return { ctx, page };
}
async function boot(page, o = {}) {
  await page.goto(BASE);
  if (o.clean) { await wait(page, 3500); return; }
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
  await wait(page, 3500);
}

const scenarios = {
  async main(browser) {
    for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
      const { ctx, page } = await ctxFor(browser, vp);
      await boot(page);
      await shot(page, "main-" + vp.width);
      if (vp.width === 360) {
        // zoom levels for map readability
        for (const z of [13, 17]) { await page.evaluate((z) => window.__map.setView([60.1508, 15.1868], z, { animate: false }), z); await wait(page, 2500); await shot(page, "map-z" + z); }
        await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false })); await wait(page, 1000);
        await clickJS(page, "#btn-heat"); await wait(page, 2500); await shot(page, "heat");
        await clickJS(page, "#btn-heat"); await clickJS(page, "#btn-ghostpins"); await wait(page, 2000); await shot(page, "ghostpins"); await clickJS(page, "#btn-ghostpins");
        // Bar popup (Pitchers / La Parma badge)
        await page.evaluate(() => window.__map.setView([60.15124, 15.18797], 17, { animate: false })); await wait(page, 2500);
        const ok = await page.evaluate(() => { const p = document.querySelector(".leaflet-hotbars-pane .pill") || document.querySelector(".pill"); if (p) p.click(); return !!p; });
        await wait(page, 1500); await shot(page, "bar-popup");
        await clickJS(page, ".pp-all"); await wait(page, 1000); await shot(page, "crowd-list");
        await closeSheet(page); await wait(page, 400);
        // A person popup: Oskar (friend medevac)
        await page.evaluate(() => window.__map.closePopup());
        await page.evaluate(() => window.__map.setView([60.1545, 15.1960], 17, { animate: false })); await wait(page, 2000);
        await page.evaluate(() => { const p = [...document.querySelectorAll(".pill")].find((x) => x.classList.contains("pf")); if (p) p.click(); }); await wait(page, 1200);
        await shot(page, "pin-popup");
        await page.evaluate(() => window.__map.closePopup());
        await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false })); await wait(page, 800);
        // Top list
        await clickJS(page, "#btn-top"); await wait(page, 1200); await shot(page, "top");
        for (let i = 1; i < 4; i++) { const t = await page.evaluate((i) => { const b = document.querySelectorAll(".tabs button")[i]; if (b) { b.click(); return b.textContent; } }, i); await wait(page, 900); if (t) await shot(page, "top-tab" + i); }
        await closeSheet(page); await wait(page, 400);
        // Groups → group view → chat
        await clickJS(page, "#btn-groups"); await wait(page, 1200); await shot(page, "groups");
        await clickJS(page, ".gmain.gtap"); await wait(page, 1800); await shot(page, "group-view");
        await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID); await wait(page, 1500); await shot(page, "chat");
        await closeSheet(page); await wait(page, 400);
        // Uniform
        await clickJS(page, ".hx-title"); await wait(page, 1800); await shot(page, "uniform");
        await page.evaluate(() => { document.querySelectorAll("#sheet *").forEach((e) => { if (e.scrollHeight > e.clientHeight + 20) e.scrollTop = 99999; }); }); await wait(page, 300); await shot(page, "uniform-bottom");
        await closeSheet(page); await wait(page, 400);
        // Settings + sub-sheets
        await clickJS(page, "#btn-settings"); await wait(page, 1000); await shot(page, "settings");
        await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 99999; }); await wait(page, 300); await shot(page, "settings-bottom");
        await clickText(page, "#sheet-body button", "Hemskärm|hemskärm|Installera|appen"); await wait(page, 1000); await shot(page, "install-guide");
        await closeSheet(page); await wait(page, 400);
        await clickJS(page, "#btn-settings"); await wait(page, 600);
        const f = await clickText(page, "#sheet-body button", "Flytta|flytt"); console.log("flytt btn", f); await wait(page, 1000); await shot(page, "flytt");
        await closeSheet(page); await wait(page, 400);
        // Taxi (HUD chip)
        await clickJS(page, ".hx-taxi"); await wait(page, 1000); await shot(page, "taxi");
        await closeSheet(page); await wait(page, 400);
        // Night summary
        await page.evaluate(() => {
          const k = window.NEWS.nightKey();
          localStorage.setItem("olnu.nightlog", JSON.stringify({ key: k, beers: 6, others: 1, bars: ["n3472634175", "x-la-parma-ludvika"], skal: 5, best: 6, badges: ["het"] }));
          window.EXTRAS.showNight();
        }); await wait(page, 1500); await shot(page, "night");
        await closeSheet(page); await wait(page, 400);
        // Level-up + calm popups
        await page.evaluate(() => window.MEDALS.levelUp("Fänrik Fatöl", "Löjtnant Lager", 43)); await wait(page, 900); await shot(page, "levelup");
        await page.evaluate(() => document.querySelectorAll(".mx-pop").forEach((x) => x.remove()));
        await page.evaluate(() => window.MEDALS.calmDown()); await wait(page, 900); await shot(page, "calm");
        await page.evaluate(() => document.querySelectorAll(".mx-pop").forEach((x) => x.remove()));
        // Beer tap → toast + cooldown
        await clickJS(page, "#btn-beer"); await wait(page, 1400); await shot(page, "after-beer-toast");
        await wait(page, 4000); await shot(page, "cooldown");
        // Other drink picker
        await page.evaluate(() => localStorage.removeItem("olnu.otherCd"));
        await clickJS(page, "#btn-other"); await wait(page, 900); await shot(page, "other-pick");
        await closeSheet(page);
      }
      await ctx.close();
    }
  },
  async rally(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { rally: true });
    await boot(page); await wait(page, 2500);
    await shot(page, "rally-banner");
    await clickJS(page, ".hx-rally"); await wait(page, 1000); await shot(page, "rally-sheet");
    await ctx.close();
  },
  async where(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { checkin: false, postN: 5 });
    await boot(page);
    await clickJS(page, "#btn-beer"); await wait(page, 1500); await shot(page, "where");
    await page.evaluate(() => { const b = document.querySelector("#sheet-body .btn-amber"); if (b) b.click(); }); await wait(page, 900); await shot(page, "takeover-hot");
    await ctx.close();
  },
  async takeover10(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { postN: 10 });
    await boot(page);
    await clickJS(page, "#btn-beer"); await wait(page, 1600); await shot(page, "takeover-medevac");
    await ctx.close();
  },
  async cooldown(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { cooldown: true });
    await boot(page); await shot(page, "cooldown-390");
    await ctx.close();
  },
  async reduced(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { reduced: true });
    await boot(page); await shot(page, "reduced-main");
    await ctx.close();
  },
  async empty(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { empty: true, checkin: false });
    await boot(page); await wait(page, 2000); await shot(page, "empty");
    await clickJS(page, "#btn-top"); await wait(page, 1000); await shot(page, "empty-top");
    await ctx.close();
  },
  async english(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { lang: "en" });
    await boot(page); await shot(page, "en-main");
    await ctx.close();
  },
  async intro(browser) {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { clean: true });
    await boot(page, { clean: true }); await shot(page, "intro-1");
    for (let i = 2; i <= 5; i++) {
      await page.evaluate(() => { const a = document.querySelector("#intro-body input[type=checkbox]"); if (a && !a.checked) a.click(); });
      const t = await page.evaluate(() => { const b = document.querySelector("#intro-body .btn-amber:not([disabled]), #intro-body .btn-block:not([disabled])"); if (b) { b.click(); return b.textContent; } });
      console.log("intro click", t); await wait(page, 1500);
      if (await page.evaluate(() => document.getElementById("intro").hidden)) { await shot(page, "intro-done"); break; }
      await shot(page, "intro-" + i);
    }
    await ctx.close();
  },
  async stats(browser) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE" });
    const page = await ctx.newPage();
    await mock(page, {});
    await page.goto(BASE + "stats.html"); await wait(page, 3000);
    await page.screenshot({ path: SP + "ui-testshots/design-stats.png", fullPage: true }); console.log("shot stats");
    await ctx.close();
  },
};

module.exports = { ctxFor, boot, wait, clickJS, shot, unmocked };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  for (const [k, fn] of Object.entries(scenarios)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    try { await fn(browser); } catch (e) { console.log("SCENARIO FAIL", k, e.message); }
  }
  await browser.close();
})();
