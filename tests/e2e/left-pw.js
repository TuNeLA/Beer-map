// lane left (11 Nov): T-05b Regler BEFORE every post RPC (the 15 s timer never runs while Regler is open; one post only;
// "Int' nu" = nothing sent, no error toast, the text stays) and Z1 zone_counts rides the map-poll bundle (poll plan).
// usage: node left-pw.js <port> [part …]   parts: core photo voice invite event wish zone zoneold (default: all). Mocked Supabase.
// Every part FAILS on big-update 744b622 and PASSES with the left patches (zoneold / tap = guards that pass on both).
const { chromium } = require("playwright");
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const PORT = process.argv[2] || 8871;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const GID = "11111111-2222-3333-4444-555555555555";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
// safety.js POST_FNS (every one is gated)
const POSTS = ["post_group_msg", "post_photo", "post_voice", "invite_create", "add_offer", "submit_event", "skal_photo", "film_photo", "film_shoot",
  "bar_photo_share", "create_rally", "send_tip", "add_quote", "submit_wish", "set_board_optin"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGP4z8DwnxLMMGrAqAGjBowaMGrAqAGjBowaMGrAqAEAagH/AdQ1EwUAAAAASUVORK5CYII=", "base64");

// app api (VITALS.init(api) gets it, like perf-pw.js) + a movable clock for the poll plan (Date.now only)
const hooks = () => {
  let vv; Object.defineProperty(window, "VITALS", { configurable: true, get() { return vv; }, set(x) { const i = x.init; x.init = function (api) { window.__api = api; return i.apply(this, arguments); }; vv = x; } });
  const RN = Date.now.bind(Date); window.__dt = 0; Date.now = () => RN() + window.__dt;
  window.__gum = 0;
  try { navigator.mediaDevices.getUserMedia = () => { window.__gum++; return Promise.reject(new Error("no mic in test")); }; } catch (e) {}
};

async function app(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.addInitScript(hooks);
  if (process.env.LEFT_DOCS) await ctx.route(new RegExp("^http://127\\.0\\.0\\.1:" + PORT + "/"), (r) => {   // old / other code (like perf-pw --measure)
    const fs = require("fs"), path = require("path");
    let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p === "/") p = "/index.html";
    const f = path.join(process.env.LEFT_DOCS, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: "" });
    let body = fs.readFileSync(f);
    if (p === "/config.js") body = Buffer.from(String(body).replace(/(SUPABASE_URL\s*:\s*)"[^"]*"/, '$1"https://vdtmzsxajpvzwwbhnfmr.supabase.co"'));
    const ct = /\.js$/.test(p) ? "text/javascript" : /\.css$/.test(p) ? "text/css" : /\.html$/.test(p) ? "text/html" : /\.json$/.test(p) ? "application/json" : /\.png$/.test(p) ? "image/png" : /\.svg$/.test(p) ? "image/svg+xml" : "application/octet-stream";
    return r.fulfill({ status: 200, contentType: ct, body });
  });
  const st = { calls: [], outer: [], bundles: [] };
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  // the outer requests the phone really sends (bundle inner calls carry x-pn-inner and are not counted)
  page.on("request", (q) => {
    const m = q.url().match(/\/rest\/v1\/rpc\/(\w+)/); if (!m || q.headers()["x-pn-inner"]) return;
    let inner = null; if (m[1] === "rpc_bundle2") { try { inner = JSON.parse(q.postData()).p_calls.map((c) => c.n); } catch (e) {} }
    st.outer.push({ t: Date.now(), n: m[1], inner });
  });
  await page.route(/rest\/v1\/rpc\/(\w+)/, async (r) => {
    const q = r.request(), fn = q.url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(q.postData() || "{}"); } catch (e) {}
    if (fn === "rpc_bundle2") {   // server emulation (0465 + 0480): inner calls go through the page's routes with x-pn-inner
      const calls = b.p_calls || [], h = q.headers(), base = q.url().slice(0, q.url().indexOf("/rpc/") + 5);
      st.bundles.push(calls.map((c) => c.n));
      const take = calls.filter((c) => !(o.old0480 && c.n === "zone_counts"));
      let got = {};
      try {
        got = await page.evaluate(async ({ base, calls, auth, key }) => {
          const out = {};
          await Promise.all(calls.map(async (c) => {
            const res = await fetch(base + c.n, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: auth, "x-pn-inner": "1" }, body: JSON.stringify(c.a || {}) });
            const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
            out[c.k] = res.ok ? { d } : { e: { code: (d && d.code) || String(res.status), message: (d && d.message) || "error" } };
          }));
          return out;
        }, { base, calls: take, auth: h.authorization || "", key: h.apikey || "" });
      } catch (e) { got = {}; }
      const out = {}; calls.forEach((c) => { out[c.k] = got[c.k] || { e: { code: "P0001", message: "not_bundled" } }; });
      return J(r, out);
    }
    st.calls.push([fn, b]);
    switch (fn) {
      case "safety_state": return J(r, { v: 1, age_ok: true, terms_ver: o.terms === false ? 0 : 1, terms_at: iso(9999), store: "off", blocks: 0, notices: [] });
      case "accept_terms": return J(r, { ok: true });
      case "post_photo": return J(r, { id: 9001, msg_id: 99, created_at: new Date().toISOString(), left: 9 });
      case "post_voice": return J(r, { id: 9002, left: 8 });
      case "invite_create": return J(r, { id: 77, added: 1, title: b.p_title, starts_at: b.p_starts_at, mine: true, live: true, answers: [] });
      case "submit_event": return J(r, { ok: true, id: 5 });
      case "submit_wish": return J(r, { ok: true, left_today: 2 });
      case "post_group_msg": return J(r, { id: 500, created_at: new Date().toISOString() });
      case "create_rally": return J(r, { id: 31 });
      case "poll_v2": {   // the map poll (like perf-pw.js): a few pins around Ludvika
        const pins = [[60.15124, 15.18797, 7], [60.14997, 15.18679, 5], [60.15098, 15.18663, 3], [60.15205, 15.18059, 2], [60.1545, 15.196, 4], [60.1462, 15.1801, 1],
          [60.1431, 15.195, 3], [60.158, 15.1745, 9], [60.1478, 15.204, 2], [60.161, 15.189, 12]]
          .map((p, i) => ({ id: 500 + i, lat: p[0], lng: p[1], beer_count: p[2], precise: true, created_at: iso(50), is_mine: i === 1 }));
        return J(r, { v: 1, server_time: new Date().toISOString(), full: true, bbox: [(b.p_min_lat || 60.1) - 0.01, (b.p_min_lng || 15.1) - 0.01, (b.p_max_lat || 60.2) + 0.01, (b.p_max_lng || 15.3) + 0.01],
          pins, capped: false, pins_in_view: pins.length, live_total: 23, checkins: [], rallies: [], heat: null,
          me: { beer_count: 5, other_count: 0, wait_seconds: 0, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(), total: 43 } });
      }
      case "zone_counts": st.zc = (st.zc || 0) + 1;
        return J(r, { v: 1, at: new Date().toISOString(), total: 52, k: 3, some: false, kommun: [{ c: "2085", n: 11, bar: null }], lan: [{ c: "20", n: 30 }] });
    }
    if (POSTS.includes(fn)) return J(r, { ok: true, id: 1 });
    return r.fallback();
  });
  await boot(page);
  await page.waitForFunction(() => window.__api && window.SAFETY && window.SAFETY._state && window.SAFETY._state(), null, { timeout: 20000 }).catch(() => {});
  if (o.terms === false) await page.evaluate(() => { try { localStorage.removeItem("olnu.terms"); } catch (e) {} });
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, st, errs };
}
const n = (st, fn) => st.calls.filter((c) => c[0] === fn);
const rules = (page) => page.evaluate(() => !!document.querySelector(".sf-ov .sf-accept"));
const accept = (page) => page.evaluate(() => { const b = document.querySelector(".sf-ov .sf-accept"); if (b) b.click(); return !!b; });
const decline = (page) => page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Int' nu/.test(x.textContent)); if (b) b.click(); return !!b; });
const errToasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].filter((t) => /err|error/.test(t.className) || /gick int|kunde int|Försök igen|fel/i.test(t.textContent)).map((t) => t.textContent));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });

  /* ---------- core: every post RPC waits for Regler BEFORE its request and its 15 s timer ---------- */
  if (want("core")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate((POSTS) => { window.__res = {}; POSTS.forEach((fn) => { window.__api.rpc(fn, fn === "set_board_optin" ? { p_on: true } : { p_group_id: "11111111-2222-3333-4444-555555555555" }).then((r) => { window.__res[fn] = r; }); }); }, POSTS);
    await wait(page, 800);
    ok("core: Regler shows for a post RPC", await rules(page));
    ok("core: no post request is sent while Regler is open", POSTS.every((fn) => !n(st, fn).length), POSTS.filter((fn) => n(st, fn).length));
    await wait(page, 16000);   // longer than app.js RPC_TIMEOUT_MS (15 s)
    const early = await page.evaluate(() => Object.keys(window.__res).map((k) => k + ":" + JSON.stringify(window.__res[k] && window.__res[k].error)));
    ok("core: after 16 s with Regler open no post has timed out or ended (" + POSTS.length + " post RPCs)", early.length === 0, early);
    await accept(page); await wait(page, 2500);
    const res = await page.evaluate(() => window.__res);
    const bad = POSTS.filter((fn) => !res[fn] || res[fn].error || n.length < 0);
    ok("core: after \"Jag godkänner\" each post is sent ONCE and answers without error", bad.length === 0 && POSTS.every((fn) => n(st, fn).length === 1),
      { bad, counts: POSTS.map((fn) => fn + ":" + n(st, fn).length) });
    ok("core: Regler asked once (accept_terms once)", n(st, "accept_terms").length === 1, n(st, "accept_terms").length);
    await ctx.close();
  }

  /* ---------- photo: Regler before the post; Int' nu = nothing sent, photo + caption stay; accept = ONE post ---------- */
  if (want("photo")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
    await page.waitForSelector(".ph-file", { state: "attached", timeout: 15000 }).catch(() => {});
    await page.setInputFiles(".ph-file", { name: "skal.png", mimeType: "image/png", buffer: PNG }).catch((e) => console.log("setInputFiles", e.message));
    await page.waitForSelector(".ph-send:not([disabled])", { timeout: 10000 }).catch(() => {});
    await page.fill(".ph-cap", "Skål från Pitchers");
    await clickJS(page, ".ph-send"); await wait(page, 700);
    ok("photo: Regler shows before the post", await rules(page));
    await clickJS(page, ".ph-send"); await wait(page, 300);   // an impatient 2nd tap
    await decline(page); await wait(page, 1200);
    const s1 = await page.evaluate(() => ({ ov: !!document.querySelector(".ph-ov .ph-send"), cap: (document.querySelector(".ph-cap") || {}).value, dis: (document.querySelector(".ph-send") || {}).disabled }));
    const e1 = await errToasts(page);
    ok("photo: \"Int' nu\" = no post, no error toast, the photo and the caption stay, Skicka works again", !n(st, "post_photo").length && !e1.length && s1.ov && s1.cap === "Skål från Pitchers" && s1.dis === false, { posts: n(st, "post_photo").length, e1, s1 });
    await clickJS(page, ".ph-send"); await wait(page, 600); await clickJS(page, ".ph-send");
    await accept(page); await wait(page, 2500);
    ok("photo: after \"Jag godkänner\" ONE post with the caption, the sheet closes", n(st, "post_photo").length === 1 && n(st, "post_photo")[0][1].p_caption === "Skål från Pitchers" && !(await page.evaluate(() => !!document.querySelector(".ph-ov .ph-send"))), n(st, "post_photo").length);
    await ctx.close();
  }

  /* ---------- voice: Regler before the mic opens (no recording is lost) ---------- */
  if (want("voice")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
    await page.waitForSelector(".af-mic", { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { const m = document.querySelector(".af-mic"); if (m) { m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); } });
    await wait(page, 700);
    const s = await page.evaluate(() => ({ gum: window.__gum, rules: !!document.querySelector(".sf-ov .sf-accept"), rec: !!document.querySelector(".af-mic.rec") }));
    ok("voice: a press on the mic asks Regler first; the mic does not open, nothing records", s.rules && s.gum === 0 && !s.rec, s);
    await accept(page); await wait(page, 600);
    await page.evaluate(() => { const m = document.querySelector(".af-mic"); if (m) m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await wait(page, 600);
    const s2 = await page.evaluate(() => ({ gum: window.__gum, rules: !!document.querySelector(".sf-ov .sf-accept") }));
    ok("voice: after \"Jag godkänner\" the next press opens the mic (no 2nd Regler)", s2.gum === 1 && !s2.rules && !n(st, "post_voice").length, s2);
    await ctx.close();
  }

  /* ---------- invite: Regler first; Int' nu keeps the form; accept = ONE invite ---------- */
  if (want("invite")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate(() => window.INVITE.openCreate({ custom: true, lat: 60.1511, lng: 15.1876, keys: ["1111aaaa2222bbbb"] }));
    await page.waitForSelector(".inv-send", { timeout: 10000 }).catch(() => {});
    await page.fill(".inv-title", "Grillkväll hos mig"); await wait(page, 300);
    await clickJS(page, ".inv-send"); await wait(page, 700);
    ok("invite: Regler shows before the post", await rules(page));
    await decline(page); await wait(page, 1000);
    const s = await page.evaluate(() => ({ t: (document.querySelector(".inv-title") || {}).value, dis: (document.querySelector(".inv-send") || {}).disabled }));
    const e1 = await errToasts(page);
    ok("invite: \"Int' nu\" = no post, no error toast, the form stays", !n(st, "invite_create").length && !e1.length && s.t === "Grillkväll hos mig" && s.dis === false, { e1, s });
    await clickJS(page, ".inv-send"); await wait(page, 500); await clickJS(page, ".inv-send");
    await accept(page); await wait(page, 2000);
    ok("invite: after \"Jag godkänner\" ONE invite", n(st, "invite_create").length === 1 && n(st, "invite_create")[0][1].p_title === "Grillkväll hos mig", n(st, "invite_create").length);
    await ctx.close();
  }

  /* ---------- event tip (submit_event): Regler first; Int' nu keeps the form; accept = ONE event ---------- */
  if (want("event")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate(() => window.EVENTS.tip(window.BARS.byId("n3472634175") || null));
    await page.waitForSelector("#sheet .ev-kinds", { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { const i = document.querySelector('#sheet input.inp[maxlength="80"]'); i.value = "Quiz på Pitchers"; });
    const go = () => page.evaluate(() => { const b = [...document.querySelectorAll("#sheet .btn-green.btn-block")].pop(); if (b) b.click(); return !!b; });
    await go(); await wait(page, 700);
    ok("event: Regler shows before the post", await rules(page));
    await decline(page); await wait(page, 1000);
    const s = await page.evaluate(() => ({ t: (document.querySelector('#sheet input.inp[maxlength="80"]') || {}).value, open: !document.getElementById("sheet").hidden }));
    const e1 = await errToasts(page);
    ok("event: \"Int' nu\" = no post, no error toast, the form stays", !n(st, "submit_event").length && !e1.length && s.t === "Quiz på Pitchers" && s.open, { e1, s });
    await go(); await wait(page, 500); await go();
    await accept(page); await wait(page, 2000);
    ok("event: after \"Jag godkänner\" ONE event", n(st, "submit_event").length === 1 && n(st, "submit_event")[0][1].p_title === "Quiz på Pitchers", n(st, "submit_event").length);
    await ctx.close();
  }

  /* ---------- wish (Önska): Regler first; Int' nu keeps the text ---------- */
  if (want("wish")) {
    const { ctx, page, st } = await app(browser, { terms: false });
    await page.evaluate(() => window.WISH.open());
    await page.waitForSelector(".ws-send", { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { const t = document.querySelector("#sheet textarea"); t.value = "Mörkt läge på Ölpasset"; t.dispatchEvent(new Event("input")); });
    await clickJS(page, ".ws-send"); await wait(page, 700);
    ok("wish: Regler shows before the post", await rules(page));
    await decline(page); await wait(page, 1000);
    const e1 = await errToasts(page);
    const t = await page.evaluate(() => (document.querySelector("#sheet textarea") || {}).value);
    ok("wish: \"Int' nu\" = no post, no error toast, the text stays", !n(st, "submit_wish").length && !e1.length && t === "Mörkt läge på Ölpasset", { e1, t });
    await clickJS(page, ".ws-send"); await wait(page, 500);
    await accept(page); await wait(page, 2000);
    ok("wish: after \"Jag godkänner\" ONE wish", n(st, "submit_wish").length === 1, n(st, "submit_wish").length);
    await ctx.close();
  }

  /* ---------- Z1: zone_counts rides the map-poll bundle (no request of its own) ---------- */
  const zoneRun = async (o) => {
    const { ctx, page, st } = await app(browser, o);
    await page.waitForFunction(() => window.ZONES && window.ZONES._counts && window.ZONES._counts(), null, { timeout: 30000 }).catch(() => {});
    await wait(page, 4000);
    const zcIn = (b) => b.inner && b.inner.includes("zone_counts");
    const cycle = async (label) => {
      const i0 = st.outer.length, a0 = await page.evaluate(() => window.ZONES.stats.asks);
      await page.evaluate(() => { window.__dt += 5 * 60e3 + 5000; });
      // two map polls (the module asks in the fan-out of the first; a deferred ask goes with the 2nd)
      for (let k = 0; k < 2; k++) { await page.evaluate(() => window.__api.refresh(true)); await wait(page, 5500); }
      const out = st.outer.slice(i0), a1 = await page.evaluate(() => window.ZONES.stats.asks);
      return { label, asks: a1 - a0, alone: out.filter((x) => x.n === "zone_counts").length, withPoll: out.filter((x) => zcIn(x) && x.inner.includes("poll_v2")).length,
        noPoll: out.filter((x) => zcIn(x) && !x.inner.includes("poll_v2")).length, out: out.map((x) => x.n + (x.inner ? "[" + x.inner.join(",") + "]" : "")) };
    };
    const c1 = await cycle("1st 5-min ask"), c2 = await cycle("2nd 5-min ask (the plan knows the rhythm)");
    const counts = await page.evaluate(() => !!(window.ZONES._counts() && window.ZONES._counts().total === 52));
    return { ctx, page, st, c1, c2, counts };
  };
  if (want("zone")) {
    const z = await zoneRun({});
    for (const c of [z.c1, z.c2]) ok("Z1 " + c.label + ": zone_counts asked and it rides a bundle WITH poll_v2 (no request of its own)", c.asks >= 1 && c.alone === 0 && c.noPoll === 0 && c.withPoll >= 1, c);
    ok("Z1 the top bar counts come in (total 52)", z.counts);
    // a tap on the pill still asks at once (its own request, no wait for a poll)
    await z.page.evaluate(() => { window.__dt += 70e3; });   // the counts are > 60 s old: a tap asks again
    const i0 = z.st.outer.length;
    await clickJS(z.page, "#live-count"); await wait(z.page, 1500);
    const tap = z.st.outer.slice(i0).filter((x) => x.n === "zone_counts" || (x.inner && x.inner.includes("zone_counts")));
    ok("Z1 a tap on the pill asks at once (no wait for the next poll)", tap.length >= 1, z.st.outer.slice(i0).map((x) => x.n));
    await z.ctx.close();
  }
  if (want("zoneold")) {   // server without 0480: zone_counts answers not_bundled → it goes alone, the counts still come
    const z = await zoneRun({ old0480: true });
    ok("Z1 old server (no 0480): zone_counts goes alone and the counts still come in (fallback)", z.counts && z.c2.alone >= 1 && z.c2.asks >= 1, { c1: z.c1, c2: z.c2 });
    await z.ctx.close();
  }

  await browser.close();
  console.log("left:", pass, "PASS", fail, "FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", String(e && e.stack || e).slice(0, 500)); process.exit(1); });
