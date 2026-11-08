// PNLOG (docs/js/pnlog.js + autoci hooks + stats-pnlog.js). Mocked Supabase only. usage: node lg-pw.js <port> [main]
// "main" = run against the live-app copy (no autoci): the autoci part is replaced by the own 1/min sampler check.
const { chromium } = require("playwright");
const H = require("./ds-helpers.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8920, MAIN = process.argv[3] === "main", BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = SP + (MAIN ? "lg-shots/main-" : "lg-shots/");
const { wait } = H;
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const BAR = { parma: [60.15124, 15.18797], pitch: [60.14997, 15.18679], lobby: [60.15098, 15.18663], grek: [60.15205, 15.18059] };
const FAR = [60.14390, 15.17600];
const PII = /Anton|Oskar|Lisa|Ida|Robban|Kalle|Sara|Ludvika Lager|ABB-gänget|ABC234|XYZ789|aaaaaaaa-bbbb|bartendern|Var é ni|@/;

async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  const srv = { batches: [], forget: 0, mode: o.mode || "on", reqs: [], ci: o.checkin === false ? null : { bar_id: "n3472634175", bar_name: "Pitchers", lat: BAR.pitch[0], lng: BAR.pitch[1] } };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  page.on("request", (rq) => { if (/rpc\/pnlog_ingest/.test(rq.url())) srv.reqs.push({ at: Date.now(), body: rq.postData() || "" }); });
  await page.route(/rest\/v1\/rpc\/(pnlog_ingest|pnlog_forget_loc|check_in|check_out|live_checkins)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "pnlog_forget_loc") { srv.forget++; return J(r, { ok: true, rows: 3 }); }
    if (fn === "live_checkins") return J(r, srv.ci ? [Object.assign({ name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }, srv.ci)] : []);
    if (fn === "check_in") { srv.ci = { bar_id: body.p_bar_id, bar_name: body.p_bar_name, lat: body.p_lat, lng: body.p_lng }; return J(r, { ok: true, bar_name: body.p_bar_name, wait_seconds: 0 }); }
    if (fn === "check_out") { const w = srv.ci; srv.ci = null; return J(r, { ok: !!w }); }
    srv.batches.push({ hdr: r.request().headers(), p: body.p, raw: r.request().postData() || "" });
    return J(r, { ok: true, mode: srv.mode, ev: (body.p.ev || []).length, loc: (body.p.loc || []).length });
  });
  if (o.geo) await ctx.setGeolocation({ latitude: o.geo[0], longitude: o.geo[1], accuracy: 10 });
  if (o.extra) await ctx.addInitScript(o.extra);
  page.setDefaultNavigationTimeout(300000);   // lx: the test box is shared (load avg 50+)
  await H.boot(page);
  await page.waitForFunction(() => window.PNLOG && window.PNLOG.state, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, srv };
}
const st = (t) => t.page.evaluate(() => window.PNLOG.state());
const flush = async (t) => { await t.page.evaluate(() => window.PNLOG.flush()); await wait(t.page, 700); };
const evs = (t) => t.srv.batches.flatMap((b) => (b.p.ev || []));
const locs = (t) => t.srv.batches.flatMap((b) => (b.p.loc || []));
async function read(t, ll, acc, advMin, dm = [0, 0]) {
  await t.page.evaluate((m) => window.AUTOCI._skew(m * 60e3), advMin);
  await t.ctx.setGeolocation({ latitude: ll[0] + dm[0] / 111320, longitude: ll[1] + dm[1] / 55600, accuracy: acc });
  await wait(t.page, 400);
  await t.page.evaluate(() => window.AUTOCI._tick());
  await wait(t.page, 2200);
}

(async () => {
  require("fs").mkdirSync(SP + "lg-shots", { recursive: true });
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // 1. batching + no PII + payload shape
  {
    const t = await setup(browser);
    const s0 = await st(t);
    ok(s0.full === true && s0.loc === true && s0.mode === "on", "default (beta, mode on): usage + position log ON (" + JSON.stringify(s0) + ")");
    ok(t.srv.reqs.length === 0, "no request at boot (events wait in memory)");
    await H.clickJS(t.page, "#btn-groups"); await wait(t.page, 1200);
    await H.clickJS(t.page, ".gmain.gtap"); await wait(t.page, 1500);
    await t.page.evaluate((gid) => window.SOCIAL && window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), H.GID); await wait(t.page, 1200);
    await H.closeSheet(t.page); await wait(t.page, 400);
    await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 1200); await H.closeSheet(t.page); await wait(t.page, 300);
    for (let i = 0; i < 5; i++) await H.clickJS(t.page, "#btn-heat");
    await t.page.evaluate(() => { window.PNLOG.event("pf.test", { n: 2, name: "Kalle", lat: 60.1, note: "kalle@x.se", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }); });
    ok(t.srv.reqs.length === 0, "taps and sheets do not send one request each (" + t.srv.reqs.length + " requests before flush)");
    await flush(t);
    ok(t.srv.batches.length === 1, "one flush = one request (" + t.srv.batches.length + ")");
    const b = t.srv.batches[0] || { p: {}, hdr: {}, raw: "" };
    const names = (b.p.ev || []).map((e) => e.n);
    ok(["app.open", "tap", "sheet.open", "sheet.close"].every((n) => names.includes(n)), "batch has app.open, tap, sheet.open, sheet.close (" + [...new Set(names)].join(",") + ")");
    ok(/^Bearer /.test(b.hdr.authorization || "") && !!b.hdr.apikey, "request carries the user session (Bearer) + apikey");
    ok(b.p.sess && b.p.ver && b.p.ch && b.p.t0 > 1e12 && b.p.sq === 1, "batch header: sess, ver, ch, t0, sq");
    const taps = (b.p.ev || []).filter((e) => e.n === "tap").map((e) => e.p.k);
    ok(taps.includes("btn-groups") && taps.includes("btn-settings") && taps.filter((k) => k === "btn-heat").length === 5, "tap keys are stable ids (" + [...new Set(taps)].slice(0, 12).join(",") + ")");
    const screens = (b.p.ev || []).filter((e) => e.n === "sheet.open").map((e) => e.p.s);
    console.log("   screens:", screens.join(" | "));
    ok(!PII.test(b.raw), "no names / group names / chat text / user id / e-mail anywhere in the payload" + (PII.test(b.raw) ? " → " + b.raw.match(PII)[0] : ""));
    const pf = (b.p.ev || []).find((e) => e.n === "pf.test");
    ok(pf && pf.p.n === 2 && !("name" in pf.p) && !("lat" in pf.p) && !/@/.test(JSON.stringify(pf.p)) && pf.p.id === "#", "generic PNLOG.event(): props cleaned (" + JSON.stringify(pf && pf.p) + ")");
    console.log("   payload bytes:", b.raw.length, "events:", (b.p.ev || []).length);
    require("fs").writeFileSync(SP + "lg-shots/" + (MAIN ? "main-" : "") + "payload-usage.json", JSON.stringify(b.p, null, 1));
    // perf: 300 events + flush, our own time and long tasks
    const perf = await t.page.evaluate(async () => {
      const lt = []; const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(e.duration))); po.observe({ type: "longtask" });
      const s0 = window.PNLOG.state().selfMs, t0 = performance.now();
      for (let i = 0; i < 300; i++) document.getElementById("btn-heat").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const tTap = performance.now() - t0;
      // the heat toggle itself costs time: measure our part only
      const s1 = window.PNLOG.state().selfMs - s0;   // lx: only the 300 taps (boot-time hook cost is measured in the lx part)
      const f0 = performance.now(); window.PNLOG.flush(); const tFlush = performance.now() - f0;
      await new Promise((r) => setTimeout(r, 300)); po.disconnect();
      return { tTap, selfMs: window.PNLOG.state().selfMs, s1, tFlush, longFromFlush: lt.filter((d) => d > 50).length };
    });
    console.log("   perf:", JSON.stringify(perf));
    ok(perf.tFlush < 15, "flush (build + JSON of 200 events) takes < 15 ms on the main thread (" + perf.tFlush.toFixed(1) + " ms)");
    ok(perf.s1 / 300 < 0.2, "logging cost per tap < 0.2 ms (" + (perf.s1 / 300).toFixed(3) + " ms avg, total " + perf.s1 + " ms)");
    await wait(t.page, 600);
    ok(t.srv.batches.length >= 2 && (t.srv.batches[1].p.ev || []).length <= 300, "max 300 events per batch (" + (t.srv.batches[1] ? t.srv.batches[1].p.ev.length : "-") + ")");
    // beacon on pagehide: real navigation away
    const before = t.srv.reqs.length;
    for (let i = 0; i < 3; i++) await H.clickJS(t.page, "#btn-top");
    await t.page.goto("about:blank"); await wait(t.page, 1200);
    const last = t.srv.reqs.slice(before).map((r) => r.body).join("\n");
    ok(/app\.hide/.test(last) && /perf\.self/.test(last), "pagehide sends the rest at once (fetch keepalive): app.hide + perf.self in the last request");
    await t.ctx.close();
  }

  // 2. opt-out: switch off → only errors; position switch off → forget + no loc rows
  {
    const t = await setup(browser);
    await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 1200);
    await H.clickJS(t.page, "#sheet-body [data-pf=s]"); await wait(t.page, 1200);
    const rows = await t.page.evaluate(() => [...document.querySelectorAll("#sheet-body .pnlog-set")].map((r) => r.textContent.trim()));
    ok(rows.length === 2 && /förbättra appen/.test(rows[0]) && /position/.test(rows[1]), "⚙️ Inställningar: 2 switch rows (" + rows.join(" | ") + ")");
    await t.page.evaluate(() => { const r = document.querySelector("#sheet-body .pnlog-set"); r && r.scrollIntoView({ block: "center" }); });
    await wait(t.page, 400);
    await t.page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove())); await wait(t.page, 200);
    await t.page.screenshot({ path: SHOTS + "settings-rows.png" });
    const sec = await t.page.evaluate(() => { const r = document.querySelector("#sheet-body .pnlog-set"); const s = r && r.closest("section.ds-section"); return s ? s.getAttribute("data-ds") : "?"; });
    ok(MAIN || sec === "integ", "rows sit in the section Integritet & säkerhet (" + sec + ")");
    // turn both off (pn-swb row button in big-update, .pnlog-switch in main)
    await t.page.evaluate(() => document.querySelectorAll("#sheet-body .pnlog-set").forEach((r) => (r.querySelector(".pnlog-row") || r.querySelector(".pnlog-switch")).click()));
    await wait(t.page, 800);
    const s1 = await st(t);
    ok(!s1.full && !s1.loc, "both switches off → usage + position off (" + JSON.stringify(s1) + ")");
    ok(t.srv.forget === 1, "position switch off → pnlog_forget_loc called once (" + t.srv.forget + ")");
    await H.closeSheet(t.page); await wait(t.page, 300);
    t.srv.batches.length = 0;
    for (let i = 0; i < 4; i++) await H.clickJS(t.page, "#btn-heat");
    await t.page.evaluate(() => { window.PNLOG._fix(60.15, 15.18, 9, "test"); window.PNLOG.loc("ci", { b: "x" }); setTimeout(() => { throw new Error("boom lg-test"); }, 0); });
    await wait(t.page, 300);
    await flush(t);
    const e2 = evs(t), l2 = locs(t);
    const cl2 = await t.page.evaluate((ns) => ns.map((n) => window.PNLOG.cls ? window.PNLOG.cls(n) : (n.indexOf("err.") === 0 ? "err" : "use")), e2.map((e) => e.n));
    ok(!cl2.some((c) => c === "use" || c === "heavy"), "opted out: no usage events sent, only errors + diagnostics (" + [...new Set(e2.map((e) => e.n))].join(",") + ")");
    ok(e2.some((e) => e.n === "err.js" && /boom lg-test/.test(e.p.m)), "opted out: error reports still go (no position)");
    ok(l2.length === 0, "opted out: no position rows (" + l2.length + ")");
    const ls = await t.page.evaluate(() => [localStorage.getItem("olnu.logEv"), localStorage.getItem("olnu.logLoc")]);
    ok(ls[0] === "0" && ls[1] === "0", "choice kept on the phone (olnu.logEv / olnu.logLoc = 0)");
    await t.ctx.close();
  }

  // 3. consent gate (store / optin): nothing until yes; the one-screen ask; beta notice once
  {
    const t = await setup(browser, { mode: "optin", extra: () => { if (!sessionStorage.getItem("lgm")) { sessionStorage.setItem("lgm", "1"); localStorage.setItem("olnu.logMode", "optin"); } } });
    const s0 = await st(t);
    ok(s0.mode === "optin" && !s0.full && !s0.loc, "optin mode: usage + position OFF until the user says yes (" + JSON.stringify(s0) + ")");
    await t.page.evaluate(() => window.PNLOG._fix(60.15, 15.18, 9, "test"));
    ok((await st(t)).l === 0, "optin mode: a reading is NOT kept");
    await t.page.evaluate(() => window.PNLOG._ask()); await wait(t.page, 1000);
    const askTxt = await t.page.evaluate(() => document.getElementById("sheet-body").textContent);
    ok(/30 dagar/.test(askTxt) && /position/.test(askTxt) && /Inga texter, inga namn/.test(askTxt), "the ask says what, why, how long");
    await t.page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove())); await wait(t.page, 200);
    await t.page.screenshot({ path: SHOTS + "consent-screen.png" });
    await H.clickJS(t.page, ".pnlog-yes"); await wait(t.page, 600);
    await t.page.evaluate(() => window.PNLOG._fix(60.15, 15.18, 9, "test"));
    const s1 = await st(t);
    ok(s1.full && s1.loc && s1.l === 1, "after 'Ja, hjälp till': usage + position on, the reading is kept (" + JSON.stringify(s1) + ")");
    await flush(t);
    ok(t.srv.batches.length && t.srv.batches[t.srv.batches.length - 1].p.cons === true, "batch says cons = true (the server accepts position rows in optin only then)");
    ok(!(await t.page.$("#pnlog-note")), "optin: no beta notice");
    await t.ctx.close();
  }
  {
    const t = await setup(browser, { extra: () => { if (!sessionStorage.getItem("lgs")) { sessionStorage.setItem("lgs", "1"); localStorage.setItem("olnu.store", "1"); } } });
    const s0 = await st(t);
    ok(s0.mode === "optin" && !s0.loc, "store build (OLNU_STORE): acts as optin even when the server says on (" + s0.mode + ")");
    await t.ctx.close();
  }
  {
    const t = await setup(browser);
    await t.page.evaluate(() => window.PNLOG._cfg({ fixMs: 0 }));
    await t.page.evaluate(() => window.PNLOG._fix(60.1512, 15.1879, 8, "test"));
    let n1 = [];
    for (let i = 0; i < 30 && !n1.length; i++) {   // the notice waits for a calm moment (no toast, no sheet, no tap for 20 s)
      await t.page.evaluate(() => document.querySelectorAll("#toasts .toast:not(.pnlog-note)").forEach((x) => x.remove()));
      await wait(t.page, 1000);
      n1 = await t.page.$$eval("#pnlog-note", (x) => x.map((y) => y.textContent));
    }
    ok(n1.length === 1 && /Under betan sparar vi din position/.test(n1[0]) && /Inställningar/.test(n1[0]), "beta: one notice the first time a position is kept (" + (n1[0] || "") + ")");
    await t.page.evaluate(() => document.querySelectorAll("#toasts .toast:not(.pnlog-note)").forEach((x) => x.remove())); await wait(t.page, 200);
    await t.page.screenshot({ path: SHOTS + "notice-toast.png" });
    await t.page.evaluate(() => document.querySelectorAll("#toasts .toast, #pnlog-note").forEach((x) => x.remove()));
    await t.page.evaluate(() => window.PNLOG._fix(60.1513, 15.1879, 8, "test")); await wait(t.page, 1900);
    ok(!(await t.page.$("#pnlog-note")), "the notice comes only once (olnu.logNote)");
    const l0 = (await st(t)).l;
    await t.page.evaluate(() => window.PNLOG._cfg({ fixMs: 55000 }));
    await t.page.evaluate(() => { window.PNLOG._fix(60.1514, 15.1879, 8, "t"); window.PNLOG._fix(60.1515, 15.1879, 8, "t"); });
    const s = await st(t);
    ok(s.l === l0, "max 1 reading per minute (2 readings right after one: none kept, " + (s.l - l0) + ")");
    // ghost mode: no position
    await t.page.evaluate(() => { localStorage.setItem("olnu.ghostMode", "1"); window.PNLOG._cfg({ fixMs: 0 }); window.PNLOG._fix(60.1516, 15.1879, 8, "t"); });
    const g = await t.page.evaluate(() => window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn());
    if (g) ok((await st(t)).l === s.l, "ghost mode: no position kept");
    // in-app privacy block
    await t.page.evaluate(() => { localStorage.removeItem("olnu.ghostMode"); });
    const opened = await t.page.evaluate(() => { if (window.PRIVACY && window.PRIVACY.showPrivacy) { window.PRIVACY.showPrivacy(); return true; } return false; });
    if (!opened) { await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 900); await H.clickJS(t.page, "#sheet-body [data-pf=s]"); await wait(t.page, 900); await t.page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /Integritet/.test(x.textContent)); b && b.click(); }); }
    await wait(t.page, 1200);
    const pv = await t.page.evaluate(() => { const b = document.querySelector("#sheet-body .pnlog-priv"); if (b) b.scrollIntoView({ block: "center" }); return b ? b.textContent : ""; });
    await wait(t.page, 300);
    ok(/30 dagar/.test(pv) && /Inställningar/.test(pv), "🔒 Integritet sheet has the 📊 block (" + pv.slice(0, 60) + "…)");
    await t.page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove())); 
    if (pv) await t.page.screenshot({ path: SHOTS + "privacy-sheet.png" });
    await t.ctx.close();
  }

  // 4. auto check-in hooks (big-update) / own sampler (main)
  if (!MAIN) {
    const t = await setup(browser, { checkin: false, geo: FAR });
    await t.page.waitForFunction(() => window.AUTOCI && window.AUTOCI.state().watching, null, { timeout: 15000 }).catch(() => {});
    await H.closeSheet(t.page); await wait(t.page, 300);
    await t.page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()); localStorage.setItem("olnu.logNote", "1"); });
    await read(t, BAR.grek, 10, 1, [3, 2]); await read(t, BAR.grek, 10, 2.5, [-2, 3]); await read(t, BAR.grek, 9, 2.6, [1, -2]);
    const tx = await t.page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join("|"));
    ok(/Är du på Grekiska/.test(tx), "autoci still asks as before (" + tx.slice(0, 60) + ")");
    await t.page.evaluate(() => document.querySelector("#toasts .ac-yes") && document.querySelector("#toasts .ac-yes").click()); await wait(t.page, 1800);
    await flush(t);
    const L = locs(t), kinds = L.map((l) => l.k);
    console.log("   loc kinds:", kinds.join(","));
    ok(kinds.filter((k) => k === "fix").length >= 1 && kinds.includes("eval"), "readings (fix) and evaluations (eval) are logged");
    const ev = L.find((l) => l.k === "eval" && l.d && l.d.s && l.d.s.length);
    ok(ev && ev.d.s[0].id && isFinite(ev.d.s[0].m) && ev.d.m === "in", "eval row: nearest spots with distance (" + JSON.stringify(ev && ev.d).slice(0, 120) + ")");
    const ask = L.find((l) => l.k === "ask");
    ok(ask && ask.d.act === "suggest" && ask.b, "decision row: ask/suggest + bar id (" + JSON.stringify(ask) + ")");
    const ans = L.find((l) => l.k === "answer" && l.d.ans === "accepted");
    ok(!!ans, "answer row: accepted");
    const ci = L.find((l) => l.k === "ci");
    ok(ci && ci.b === ask.b && ci.d.src === "ask" && isFinite(ci.la), "check-in row: same bar, src = ask, with the user's position (" + JSON.stringify(ci) + ")");
    ok(evs(t).some((e) => e.n === "ac.decide") && evs(t).some((e) => e.n === "rpc" && e.p.fn === "check_in"), "usage events: ac.decide + rpc check_in");
    require("fs").writeFileSync(SP + "lg-shots/payload-loc.json", JSON.stringify(t.srv.batches.map((b) => b.p.loc).flat(), null, 1));
    // the hook never changes autoci: thresholds untouched
    const src = require("fs").readFileSync(process.env.LG_SITE ? SP + process.env.LG_SITE + "/docs/js/autoci.js" : __dirname + "/../../docs/js/autoci.js", "utf8");
    ok(/var ACC_IN = 25, ACC_OUT = 50, AT_M = 30, GAP_MIN = 15, REACH_MAX = 55, OUT_M = 60,/.test(src), "autoci thresholds unchanged");
    await t.ctx.close();
  } else {
    const t = await setup(browser, { checkin: false, geo: [60.1512, 15.1879] });
    await t.page.evaluate(() => localStorage.setItem("olnu.logNote", "1"));
    await t.page.clock && 0;
    const have = await t.page.evaluate(() => !!window.AUTOCI);
    ok(!have, "main: no autoci → own sampler");
    // speed the minute up: the sampler interval is fixed (60 s); wait for one tick
    await wait(t.page, 62000);
    const s = await st(t);
    ok(s.l >= 1, "main: one position reading per minute while visible (" + s.l + ")");
    await t.page.evaluate(() => window.PNLOG.loc("ci", { b: "n1" }));
    await flush(t);
    const f = locs(t).find((l) => l.k === "fix");
    ok(f && f.d.src === "own" && isFinite(f.la) && f.a != null, "main: fix row (" + JSON.stringify(f) + ")");
    await t.ctx.close();
  }

  // 5. owner panel (stats.html) with mocked owner_* data
  {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, locale: "sv-SE" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    const now = Date.now(), M = 60e3;
    const rows = []; let u = 1;
    const add = (o) => rows.push(Object.assign({ u }, o));
    // user 1: Grekiska: evals → suggest → accepted → ci (good); later auto at Pitchers kept
    for (let i = 0; i < 6; i++) { add({ at: now - 200 * M + i * M, k: "fix", la: 60.15205 + i * 1e-5, ln: 15.18059, a: 9 }); add({ at: now - 200 * M + i * M + 1, k: "eval", d: { m: "in", a: 9, s: [{ id: "n-grek", m: 6 + i, bl: 1 }, { id: "n-parma", m: 120, bl: 1 }], w: "n-grek", n: i + 1, cl: 1 } }); }
    add({ at: now - 194.8 * M, k: "ask", b: "n-grek", d: { act: "suggest" } }); add({ at: now - 194.5 * M, k: "answer", b: "n-grek", d: { ans: "accepted" } });
    add({ at: now - 194.4 * M, k: "ci", b: "n-grek", la: 60.15206, ln: 15.18061, a: 9, d: { src: "ask" } });
    for (let i = 0; i < 6; i++) { add({ at: now - 100 * M + i * M, k: "fix", la: 60.14997, ln: 15.18679 + i * 1e-5, a: 7 }); add({ at: now - 100 * M + i * M + 1, k: "eval", d: { m: "in", a: 7, s: [{ id: "n3472634175", m: 4, bl: 1 }, { id: "x-lobby", m: 140, bl: 1 }], w: "n3472634175", n: i + 1, cl: 1 } }); }
    add({ at: now - 94.8 * M, k: "auto_in", b: "n3472634175", d: { act: "auto" } }); add({ at: now - 94.8 * M + 2000, k: "ci", b: "n3472634175", d: { src: "auto" } });
    // user 2: Lobbybaren vs La Parma: ask choose → picked other; auto_out wrong; a missed hand check-in
    u = 2;
    for (let i = 0; i < 4; i++) { add({ at: now - 150 * M + i * M, k: "fix", la: 60.1510, ln: 15.1872, a: 18 }); add({ at: now - 150 * M + i * M + 1, k: "eval", d: { m: "in", a: 18, s: [{ id: "x-lobby", m: 14, bl: 1 }, { id: "x-parma", m: 22, bl: 1 }], w: null, n: i + 1, cl: 0 } }); }
    add({ at: now - 146 * M, k: "ask", b: "x-lobby", d: { act: "choose", b2: "x-parma" } }); add({ at: now - 140 * M, k: "ci", b: "n-grek", la: 60.1511, ln: 15.1873, a: 15, d: { src: "hand" } });
    add({ at: now - 90 * M, k: "auto_out", b: "n-grek", d: { act: "checkout", why: "far" } }); add({ at: now - 80 * M, k: "ci", b: "n-grek", la: 60.15204, ln: 15.1806, a: 12, d: { src: "hand" } });
    for (let i = 0; i < 3; i++) add({ at: now - 40 * M + i * M, k: "fix", la: 60.1492, ln: 15.1853, a: 30 });
    add({ at: now - 37 * M, k: "ci", b: "x-pub3", la: 60.1492, ln: 15.1853, a: 30, d: { src: "hand" } });
    await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1];
      if (fn === "owner_pnlog") return J(r, { mode: "on", days: 7, batches: 412, bytes: 2.4e6, events: 18350, wau: 14, mau: 16,
        dau: [{ day: "2026-11-06", users: 9, sessions: 21, events: 6100, bytes: 820000 }, { day: "2026-11-07", users: 13, sessions: 35, events: 12250, bytes: 1600000 }],
        screens: [{ s: "Grupper", n: 120, users: 12, ms50: 140 }, { s: "🔒 Integritet", n: 9, users: 6, ms50: 90 }, { s: "🎖️ …", n: 31, users: 8, ms50: 210 }],
        taps: [{ s: "map", k: "btn-beer", n: 210, users: 13 }, { s: "map", k: "btn-groups", n: 130, users: 12 }, { s: "Grupper", k: "gmain", n: 96, users: 11 }],
        features: [{ fn: "post_beer_v2", n: 190, users: 13, fails: 2 }, { fn: "check_in", n: 44, users: 10, fails: 0 }, { fn: "join_group", n: 3, users: 3, fails: 0 }],
        errors: [{ n: "err.rpc", m: "timeout", f: "poll_v2", cnt: 14, users: 5, ver: "e1a7c0f0" }, { n: "err.js", m: "Cannot read properties of null (reading 'x')", f: "barea.js:212", cnt: 3, users: 2, ver: "e1a7c0f0" }],
        perf: [{ m: "perf.boot", cnt: 40, p50: 1180, p95: 3400 }, { m: "perf.map", cnt: 38, p50: 2100, p95: 5200 }, { m: "perf.sheet", cnt: 300, p50: 120, p95: 480 }, { m: "perf.cls", cnt: 30, p50: 0.012, p95: 0.08 }, { m: "perf.self", cnt: 40, p50: 6.1, p95: 19 }],
        versions: [{ ver: "e1a7c0f0", ch: "stable", users: 11, batches: 300 }, { ver: "beta1234", ch: "beta", users: 3, batches: 112 }],
        sess_sec: { p50: 410, p90: 2300, n: 60 }, funnel_beer: { open: 56, tap: 41, post: 38 }, funnel_join: { invite: 7, preview: 5, join: 4 }, daily: [] });
      if (fn === "owner_pnlog_loc") return J(r, { mode: "on", rows });
      if (/^owner_stats/.test(fn)) return J(r, { generated_at: new Date().toISOString() });
      return J(r, []);
    });
    await page.addInitScript(() => sessionStorage.setItem("olnu.ownerKey", "test-key"));
    await page.goto(BASE + "stats.html"); await wait(page, 3500);
    const has = await page.evaluate(() => [!!document.querySelector("#pPnU:not([hidden])"), !!document.querySelector("#pPnQ:not([hidden])"), !!document.querySelector("#pPnQ svg.dmap circle")]);
    ok(has[0] && has[1] && has[2], "stats.html: 📊 Användning + 📍 kvalitet panels + disagreement map (" + has + ")");
    const conf = await page.evaluate(() => [...document.querySelectorAll("#pPnQB table")][0].textContent);
    ok(/Auto-incheckning/.test(conf) && /behöll/.test(conf) && /annan krog/.test(conf) && /missad av auto/.test(conf) && /checkade in igen/.test(conf), "confusion table: kept / other bar / missed / wrong check-out");
    await page.evaluate(() => document.getElementById("pPnU").scrollIntoView()); await wait(page, 300);
    await page.screenshot({ path: SHOTS + "owner-usage.png", fullPage: false });
    await page.evaluate(() => document.getElementById("pPnQ").scrollIntoView()); await wait(page, 300);
    await page.screenshot({ path: SHOTS + "owner-quality.png" });
    await page.evaluate(() => document.querySelector("#pPnQ svg.dmap").scrollIntoView({ block: "center" })); await wait(page, 300);
    await page.screenshot({ path: SHOTS + "owner-map.png" });
    const sim = await page.evaluate(() => { const i = document.querySelector("#pPnQ label.sl input"); i.value = 10; i.dispatchEvent(new Event("input")); const o = document.querySelector("#pPnQ .pnl-sim"); return o ? o.textContent : ""; });
    ok(/Precision/.test(sim) && /Recall/.test(sim), "simulator recomputes on slider change");
    const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await page.evaluate(() => [...document.querySelectorAll("#pPnQ button")].find((b) => /CSV/.test(b.textContent)).click());
    const d = await dl;
    ok(!!d && /positionslogg/.test(d.suggestedFilename()), "CSV export (" + (d ? d.suggestedFilename() : "none") + ")");
    await ctx.close();
  }

  if (!MAIN && !process.env.LG_SKIP_LX) await require("./lgx-part.js")({ browser, setup, ok, st, flush, evs, wait, H, SP, BASE, SHOTS });
  await browser.close();
  console.log(fails ? "FAILED " + fails : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
