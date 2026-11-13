// Map + levels polish: heat jump, composite bar markers, levels, news. Mocked server (poll_v2), nothing reaches Supabase.
// Usage: NODE_PATH=... node polish-test.js <port> <tag> [scenario...]   (tag = "before" | "after", used in file names)
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871, TAG = process.argv[3] || "after", ONLY = process.argv.slice(4);
const BASE = `http://127.0.0.1:${PORT}/`;
// Clock-independent: the page and the mocks share one fixed evening clock (Fri 22:30 Swedish time) that then ticks normally.
const FIX = Date.parse("2026-11-06T21:30:00Z"), T0 = Date.now();
const vnow = () => FIX + (Date.now() - T0);
const now = FIX;
const iso = (m) => new Date(now - m * 60e3).toISOString();
const results = [];
const ok = (name, cond, info) => { results.push([cond ? "PASS" : "FAIL", name, info || ""]); console.log(cond ? "PASS" : "FAIL", name, info === undefined ? "" : typeof info === "string" ? info : JSON.stringify(info)); };
const GID = "11111111-2222-3333-4444-555555555555";
const BAR = { parma: [60.15124, 15.18797, "x-la-parma-ludvika"], pitch: [60.14997, 15.18679, "n3472634175"], lobby: [60.15098, 15.18663, "x-lobbybaren-ludvika"], grek: [60.15205, 15.18059, "x-grekiska-grill-bar-ludvika"] };
let sid = 0;
const S = (b, n, o = {}) => ({ id: o.id || ("p" + (1e14 + sid++).toString(16).padStart(15, "0").slice(0, 15)), lat: b[0], lng: b[1], snap: "bar", bar_id: b[2], precise: true, beer_count: n, created_at: iso(o.m || 30), ...(o.x || {}) });
const pins = () => [
  S(BAR.parma, 11, { id: 501, x: { snap: "exact", lat: 60.15128, lng: 15.18805, is_friend: true, friend_name: "Oskar", total: 300, skal_count: 4 } }),
  S(BAR.parma, 3), S(BAR.parma, 2), S(BAR.parma, 6), S(BAR.parma, 1), S(BAR.parma, 4),
  S(BAR.parma, 2, { id: 502, x: { snap: "exact", lat: 60.15119, lng: 15.18790, is_friend: true, friend_name: "Lisa", total: 18 } }),
  S(BAR.pitch, 6, { id: 77, x: { snap: "exact", lat: 60.15, lng: 15.18683, is_mine: true, total: 43, skal_count: 2 } }),
  S(BAR.pitch, 2), S(BAR.pitch, 5), S(BAR.pitch, 1),
  S(BAR.pitch, 3, { id: 503, x: { snap: "exact", lat: 60.14993, lng: 15.18672, is_friend: true, friend_name: "Ida", total: 40 } }),
  S(BAR.lobby, 2), S(BAR.lobby, 1), S(BAR.lobby, 3),
  S(BAR.grek, 2), S(BAR.grek, 1),
  { id: 504, lat: 60.1545, lng: 15.1960, snap: "exact", precise: true, beer_count: 7, created_at: iso(80), is_friend: true, friend_name: "Robban", total: 90 },
  { id: "pa00000000000001", lat: 60.155, lng: 15.20, snap: "area", beer_count: 4, created_at: iso(60) },
  { id: "pa00000000000002", lat: 60.145, lng: 15.18, snap: "area", beer_count: 1, created_at: iso(60) },
  { id: "pa00000000000003", lat: 60.145, lng: 15.19, snap: "area", beer_count: 3, created_at: iso(60) },
  { id: "pa00000000000004", lat: 60.16, lng: 15.19, snap: "area", beer_count: 12, created_at: iso(60) },
];
// Server heat trail (tonight): at bars (bar point) + ~55 m cells + a few far away towns (Borlänge, Falun) for zoomed-out.
const heat = () => [[BAR.parma[0], BAR.parma[1], 22], [BAR.pitch[0], BAR.pitch[1], 14], [BAR.lobby[0], BAR.lobby[1], 6], [BAR.grek[0], BAR.grek[1], 3],
  [60.1545, 15.1960, 8], [60.155, 15.20, 4], [60.16, 15.19, 12], [60.145, 15.18, 1], [60.1480, 15.1830, 2],
  [60.4858, 15.4371, 6], [60.4870, 15.4300, 3], [60.6065, 15.6355, 9], [60.6050, 15.6300, 2], [59.3293, 18.0686, 30]];
const checkins = [
  { bar_id: "x-la-parma-ludvika", bar_name: "La Parma Pub & Restaurang", lat: BAR.parma[0], lng: BAR.parma[1], name: "Oskar", is_mine: false, is_friend: true, created_at: iso(120) },
  { bar_id: "x-la-parma-ludvika", bar_name: "La Parma Pub & Restaurang", lat: BAR.parma[0], lng: BAR.parma[1], name: null, is_mine: false, is_friend: false, created_at: iso(60) },
  { bar_id: "n3472634175", bar_name: "Pitchers", lat: BAR.pitch[0], lng: BAR.pitch[1], name: "Anton", is_mine: true, is_friend: false, created_at: iso(90) },
  { bar_id: "x-blackstone-ludvika", bar_name: "Blackstone Steakhouse", lat: 60.15038, lng: 15.18507, name: "Ida", is_mine: false, is_friend: true, created_at: iso(20) },
];
const rallies = () => [
  { id: 77, name: "Oskar", body: "Alla till La Parma!!", place: "La Parma Pub & Restaurang", lat: BAR.parma[0] + 0.0002, lng: BAR.parma[1], created_at: iso(6), yes: 3, no: 0, maybe: 1, my_answer: null, yes_names: ["Lisa", "Ida", "Kalle"], is_mine: false, group_id: GID, group_name: "Ludvika Lager" },
  { id: 78, name: "Robban", body: "Efterfest hos mig", place: "Hemma hos Robban", lat: 60.1545, lng: 15.1960, created_at: iso(3), yes: 1, no: 0, maybe: 0, my_answer: null, yes_names: ["Lisa"], is_mine: false, group_id: GID, group_name: "Ludvika Lager" },
];
const homeStatus = [
  { group_id: GID, group_name: "Ludvika Lager", name: "Oskar", is_me: false, beers: 11, others: 0, was_out: true, home: false, home_at: null, live: true },
  { group_id: GID, group_name: "Ludvika Lager", name: "Anton", is_me: true, beers: 6, others: 0, was_out: true, home: false, home_at: null, live: true },
  { group_id: GID, group_name: "Ludvika Lager", name: "Lisa", is_me: false, beers: 2, others: 0, was_out: true, home: false, home_at: null, live: true },
  { group_id: GID, group_name: "Ludvika Lager", name: "Ida", is_me: false, beers: 3, others: 0, was_out: true, home: false, home_at: null, live: true },
  { group_id: GID, group_name: "Ludvika Lager", name: "Nisse", is_me: false, beers: 2, others: 0, was_out: true, home: true, home_at: iso(15), live: false },
  { group_id: "g2", group_name: "Jobbet", name: "Anton", is_me: true, beers: 6, others: 0, was_out: true, home: false, home_at: null, live: true },
  { group_id: "g2", group_name: "Jobbet", name: "Pelle", is_me: false, beers: 0, others: 0, was_out: false, home: false, home_at: null, live: false },
];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role: "authenticated", exp: Math.floor(now / 1000) + 86400, is_anonymous: true }) + ".sig";
}
const SESSION = { access_token: fakeJwt(), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, refresh_token: "rt-fake",
  user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: iso(9999) } };

async function setup(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: o.vp || { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE", timezoneId: "Europe/Stockholm", isMobile: true, hasTouch: true,
    geolocation: { latitude: 60.1500, longitude: 15.1868 }, permissions: ["geolocation"], ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  await ctx.clock.install({ time: vnow() });   // page Date = the same fixed evening (time still flows)
  const ls = Object.assign({ "olnu.intro": "1", "olnu.age18": "1", "olnu.locOk": "1", "olnu.notifAsked": "1", "olnu.notifAskAt": String(vnow()),
    "olnu.guideSeen": "9999999999999", "olnu.installSeen": "1", "olnu.name": "Anton", "olnu.lang": o.lang || "sv", "olnu.prec": "exact", "olnu.heat": o.heat === false ? "0" : "1",
    "olnu.medalsSeeded": "1", "olnu.medalsMigrated": "1" }, o.ls || {});
  await ctx.addInitScript((ls) => {
    if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); Object.keys(ls).forEach((k) => localStorage.setItem(k, ls[k])); }
    let _L;
    Object.defineProperty(window, "L", { configurable: true, get() { return _L; },
      set(v) { _L = v; if (v && v.Map && !v.__hooked) { v.__hooked = 1; v.Map.addInitHook(function () { window.__map = this; }); } } });
  }, ls);
  // Heat blob at La Parma, measured in visual CSS px (canvas pixels × the canvas CSS scale). Used during animations.
  await ctx.addInitScript(() => {
    window.__olnuBlob = function (ll, th) {
      ll = ll || [60.15124, 15.18797]; th = th || 30;
      const m = window.__map, cv = document.querySelector("canvas.leaflet-heatmap-layer");
      if (!m || !cv || cv.width === 0) return null;
      const ctx = cv.getContext("2d"), r = cv.getBoundingClientRect(), mc = m.getContainer().getBoundingClientRect();
      const sx = r.width / cv.width;
      // During a CSS zoom animation the map state is the OLD view: find the bar's visual spot from a marker icon if possible.
      let px, py;
      const ic = document.querySelector('[data-bar="x-la-parma-ludvika"]') || null;
      if (ic) { const b = ic.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
      else { const p = m.latLngToContainerPoint(ll); px = p.x + mc.left; py = p.y + mc.top; }
      const cx = (px - r.left) / sx, cy = (py - r.top) / sx;
      if (cx < 0 || cy < 0 || cx >= cv.width || cy >= cv.height) return { off: true };
      const row = ctx.getImageData(0, Math.round(cy), cv.width, 1).data;
      let x = Math.round(cx);
      while (x >= 0 && x < cv.width && row[x * 4 + 3] >= th) x++;
      return { r: Math.abs(x - cx) * sx, a0: row[Math.round(cx) * 4 + 3], scale: sx, z: m.getZoom() };
    };
  });
  const page = await ctx.newPage();
  const errors = [], calls = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  const st = { me: { beer_count: o.meN != null ? o.meN : 6, other_count: 0, hidden: false, ghost: false, wait_seconds: 0, undo_until: null, undos_left: 3, total: 43, week: 6,
      title: "Löjtnant Lager", next_title: "Premiärlöjtnant Pilsner", next_at: 52, expires_at: new Date(now + 5 * 3600e3).toISOString(), lat: 60.15, lng: 15.18683, precise: true },
    pins: o.pins || pins(), rallies: o.rallies === false ? [] : rallies() };
  page.__st = st;
  await page.route(/\/auth\/v1\//, (r) => { const u = r.request().url(); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(/\/user/.test(u) ? SESSION.user : SESSION) }); });
  await page.route(/api\.open-meteo\.com/, (r) => r.abort());   // weather is not part of this test (no network in tests)
  await page.route(/functions\/v1\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push({ fn, body, t: vnow() });
    const j = (b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    switch (fn) {
      case "poll_v2": {
        const ps = st.pins.slice();
        const mine = ps.find((p) => p.is_mine); if (mine) mine.beer_count = st.me.beer_count;
        return j({ v: 1, server_time: new Date(vnow()).toISOString(), full: true, ids_until: new Date(vnow() + 6e5).toISOString(),
          bbox: [body.p_min_lat - 0.01, body.p_min_lng - 0.01, body.p_max_lat + 0.01, body.p_max_lng + 0.01], pins: ps.filter((p) => !p.is_mine || st.me.beer_count > 0), capped: false, pins_in_view: ps.length,
          live_total: 211, me: st.me, checkins, rallies: st.rallies, heat: body.p_heat ? (o.heatPts || heat()) : null });
      }
      case "post_beer_v2": case "post_beer": {
        st.me.beer_count++; st.me.wait_seconds = 0;
        const until = new Date(vnow() + 120e3).toISOString();
        st.me.undo_until = until;
        return j({ accepted: true, wait_seconds: 0, id: 77, lat: body.p_lat, lng: body.p_lng, beer_count: st.me.beer_count, is_new: false, expires_at: st.me.expires_at, milestone: null, hidden: false, undo_until: until, undos_left: 3 });
      }
      case "bar_kings": return j([{ bar_id: "x-la-parma-ludvika", king_name: "Oskar", king_n: 11, is_me: false }]);
      case "my_groups": return j([{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: 4 }, { id: "g2", name: "Jobbet", code: "XYZ789", member_count: 2, active_count: 1 }]);
      case "home_status": return j(homeStatus);
      case "my_stats": return j({ total: 43, week: 6, title: "Löjtnant Lager", next_title: "Premiärlöjtnant Pilsner", next_at: 52 });
      case "answer_rally": return j({ yes: 4, no: 0, maybe: 1, mine: body.p_answer });
      case "check_in": return j({ ok: true, bar_name: body.p_bar_name, wait_seconds: 0 });
      case "my_medals": case "award_medals": return j([]);
      default: return j([]);
    }
  });
  if (o.blankTiles) {
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    await page.route(/arcgisonline|basemaps\.cartocdn/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  }
  await page.goto(BASE);
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 2, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  await page.waitForTimeout(1500);
  // Time-dependent start-up sheets (e.g. the daytime "Kom alla hem?" morning check) are not part of this test: close them.
  for (let i = 0; i < 3; i++) { const open = await page.evaluate(() => !document.getElementById("sheet").hidden); if (!open) break; await page.click("#sheet-close").catch(() => {}); await page.waitForTimeout(500); }
  return { ctx, page, errors, calls, st };
}
const shot2 = (page, name) => page.screenshot({ path: SP + "ui-testshots/strip-" + TAG + "-" + name + ".png" }).then(() => console.log("shot", SP + "strip-" + TAG + "-" + name + ".png"));
const CI = { "olnu.checkin": JSON.stringify({ id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679, at: vnow() - 600e3, until: vnow() + 5 * 3600e3 }) };
// State of the strip and anything on top of it.
const stripState = (page) => page.evaluate(() => {
  const s = document.querySelector(".bp-strip");
  const vis = !!(s && !s.hidden && s.getClientRects().length);
  const chips = vis ? [...s.querySelectorAll("[data-bpt]")] : [];
  const tappable = chips.map((c) => { const r = c.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && c.contains(e)); });
  const sr = vis ? s.getBoundingClientRect() : null;
  const toasts = [...document.querySelectorAll("#toasts .toast")].map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.slice(0, 80), bottom: Math.round(r.bottom) }; });
  return { vis, chips: chips.length, tappable: tappable.length && tappable.every(Boolean), stripTop: sr && Math.round(sr.top),
    takeover: !!document.querySelector(".takeover"), mxPop: !!document.querySelector(".mx-pop"), sheet: !document.getElementById("sheet").hidden,
    calm: /TA DET LUGNT|Okej, okej/.test(document.body.innerText), toasts };
});
// Ranking / encouragement words that must not follow a 10th drink (care framing). Care words are fine.
const RANKING = /rekord|vinnare|vinner|leder|ledningen|topplista|toppen|\betta\b|\bbäst|kung|drottning|mästare|en till|en runda till|kör på|fortsätt|full rulle|ös på|heja|bra jobbat|grattis|snyggt|\bmer!|starkt|legend/i;
const S2 = {
  async third(browser) {
    const { ctx, page, errors, calls } = await setup(browser, { meN: 2, heat: false, rallies: false, ls: Object.assign({ "olnu.beerTimes": JSON.stringify([vnow() - 20 * 60e3, vnow() - 10 * 60e3]) }, CI) });
    await page.evaluate(() => document.getElementById("btn-beer").click());
    const seen = [];
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(500); seen.push(await stripState(page)); }
    const st = seen[seen.length - 1];
    console.log("third beer +5s", JSON.stringify(st));
    ok("3rd fast beer: strip visible, all chips tappable", st.vis && st.chips > 3 && st.tappable, st);
    ok("3rd fast beer: no takeover / popup / sheet / Ta det lugnt at any time", seen.every((x) => !x.mxPop && !x.takeover && !x.sheet && !x.calm), seen.filter((x) => x.mxPop || x.takeover || x.sheet || x.calm)[0]);
    ok("toasts sit above the strip", st.toasts.every((x) => x.bottom <= st.stripTop + 1), st.toasts);
    await shot2(page, "third-beer");
    // Owner flow: tap a chip.
    await page.locator(".bp-strip [data-bpt]").nth(1).tap();
    await page.waitForTimeout(800);
    const after = await stripState(page);
    ok("chip tap works: set_beer_type sent, strip closes", calls.some((c) => c.fn === "set_beer_type") && !after.vis, after);
    await shot2(page, "third-after-chip");
    ok("third: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  },
  async fifth(browser) {
    // 5 = fire takeover first; the strip waits for it, then nothing covers the strip; a level-up popup waits for the strip.
    const { ctx, page, errors } = await setup(browser, { meN: 4, heat: false, rallies: false, ls: CI });
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForTimeout(1500);
    const a = await stripState(page);
    ok("5: takeover first, strip not under it", a.takeover && !a.vis, a);
    await page.waitForFunction(() => !document.querySelector(".takeover"), null, { timeout: 12000 });
    await page.waitForTimeout(1200);
    const b = await stripState(page);
    ok("5: strip shows after the takeover, chips tappable", b.vis && b.tappable && !b.takeover, b);
    await page.evaluate(() => window.MEDALS && window.MEDALS.levelUp("Menig Mjöd", "Korpral Kalja", 50));
    await page.waitForTimeout(3500);
    const c = await stripState(page);
    ok("level-up popup waits while the strip is up", c.vis && !c.mxPop && c.tappable, c);
    await shot2(page, "fifth-strip");
    await page.locator(".bp-strip .bp-st-x").tap();
    await page.waitForTimeout(1500);
    let d = await stripState(page);
    // uxfix P1-3 (owner/blind test 13 Nov): the popup also waits while a sheet is open (here the sheet that the strip's after-queue
    // opens). Same intent: never under the strip, never lost. A sheet up → the popup waits; the sheet closes → it shows.
    // uifix (final check 13 Nov): in the 60 s after a beer only the beer toast + the strip show: the popup also waits for that window.
    ok("level-up popup is not on top of the strip / a sheet, and waits out the 60 s after the beer", !d.vis && !d.mxPop, d);
    if (d.sheet) { await page.click("#sheet-close").catch(() => {}); await page.waitForTimeout(1000); }
    await page.clock.fastForward(60000); await page.waitForTimeout(2500); d = await stripState(page);
    ok("level-up popup shows after the strip closes (and the sheet, if one opened)", !d.vis && d.mxPop, d);
    await shot2(page, "fifth-after");
    ok("fifth: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  },
  async tenth(browser) {
    const { ctx, page, errors } = await setup(browser, { meN: 9, heat: false, rallies: false, ls: CI });
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForTimeout(1500);
    const tk = await page.evaluate(() => { const t = document.querySelector(".takeover"); return t ? { title: t.querySelector(".to-title").textContent, sub: t.querySelector(".to-sub").textContent } : null; });
    console.log("takeover 10", JSON.stringify(tk));
    // Store-safe rule (owner decision, tease + care): at 10 the takeover is a CARE text. Care words (vatten, mat, taxi, kompis)
    // are allowed; ranking / encouragement words are not.
    ok("10: care takeover (no ranking / encouragement words)", tk && tk.title && tk.sub && !RANKING.test(tk.title + " " + tk.sub), tk);
    await shot2(page, "tenth-takeover");
    await page.waitForFunction(() => !document.querySelector(".takeover"), null, { timeout: 12000 });
    await page.waitForTimeout(1200);
    const b = await stripState(page);
    const hud = await page.textContent("#my-streak");
    console.log("hud", hud, JSON.stringify(b));
    ok("10: strip after takeover, tappable; no ranking / encouragement toast", b.vis && b.tappable && !b.toasts.some((x) => RANKING.test(x.t)), b);
    await shot2(page, "tenth-strip");
    ok("tenth: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  },
};
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  for (const [k, fn] of Object.entries(S2)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    try { await fn(browser); } catch (e) { ok("SCENARIO " + k + " threw", false, String(e && e.stack || e).slice(0, 500)); }
  }
  await browser.close();
  const f = results.filter((r) => r[0] === "FAIL");
  console.log(`\nSUMMARY ${results.length - f.length} pass, ${f.length} fail`);
})();
