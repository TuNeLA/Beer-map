// lane consent (13 Nov): ePrivacy art. 5(3) / LEK (2022:482) 9 kap. 28 § — reading device data that is not strictly needed
// needs a yes first. The REAL app (the live site tunela.github.io/Beer-map/ and the store build) sends no diagnostics
// (device, memory, CPU, network, speed) before "Ja": they wait in memory, "Ja" sends them, "Nej" / no answer = never sent.
// Errors are always sent, but without device fields. Old users who said yes (olnu.logCons = "1") keep their yes.
// The opt-out switch still works. Beta / test builds (PN_BETA, served under /pintsnow-beta/) keep sending as today.
// Usage: node consent-pw.js <port>   (port = tests/e2e/serve.py serving docs; the live and beta hosts are routed to it)
const { ctxFor, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793;
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const KEEP = /^(dev$|dev\.|net\.|sw\.|crash\.|perf\.)/;
const FPKEYS = ["os", "osv", "br", "brv", "mdl", "mem", "cpu", "scw", "sch", "dpr", "ct", "rtt", "dl", "tz", "tch"];

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { logCons: null });
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem("cns")) return; sessionStorage.setItem("cns", "1");
    localStorage.setItem("olnu.logMode", "on");   // the server flag today (live + beta): "on"
    localStorage.removeItem("olnu.logCons");
    if (a.cons) localStorage.setItem("olnu.logCons", a.cons);
  }, { cons: o.cons || null });
  if (o.beta) await ctx.addInitScript(() => { window.PN_BETA = "abc1234"; });   // what beta.js / test.js set in the beta + test builds
  const sent = [];
  page.on("request", (rq) => {
    const u = rq.url();
    if (rq.method() === "POST" && /supabase\.co\//.test(u)) sent.push({ fn: (u.match(/rpc\/(\w+)/) || [])[1] || u.split("?")[0], body: rq.postData() || "" });
  });
  await page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "on" }) }));
  await page.route(/rest\/v1\/rpc\/(report_vitals|pnlog_ping|pnlog_forget_loc)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  let url = "http://127.0.0.1:" + PORT + "/";
  if (o.host) {   // "/Beer-map/" = the live site, "/pintsnow-beta/" = the beta: served from the local docs
    await page.route(/^https:\/\/tunela\.github\.io\//, async (r) => {
      const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/(Beer-map|pintsnow-beta)\//, "/"); if (p === "/") p = "/index.html";
      const res = await fetch("http://127.0.0.1:" + PORT + p + u.search);
      r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
    });
    url = "https://tunela.github.io" + o.host;
  }
  await page.goto(url);
  await page.waitForFunction(() => window.PNLOG && window.PNLOG.state && document.querySelectorAll(".pill").length > 3, null, { timeout: 60000 }).catch(() => console.log("no app"));
  await wait(page, 2500);
  return { ctx, page, sent };
}
// make diagnostics + an error, then send: the 5-min batch (flush) and the pagehide batch (_bye)
async function provoke(t, tag) {
  await t.page.evaluate((g) => {
    const P = window.PNLOG;
    P.event("net." + g, { ct: "4g", rtt: 50, dl: 9.5 });
    P.event("perf.mem", { v: 80, lim: 4096 });
    P.event("err." + g, { m: "boom " + g, mem: 8, cpu: 4, ct: "4g", scw: 412 });
    try { window.VITALS && window.VITALS._send && window.VITALS._send(); } catch (e) {}
  }, tag);
  await t.page.evaluate(() => window.PNLOG.flush()); await wait(t.page, 900);
}
async function ask(t) {   // open the one-screen ask (retry: another sheet may be on its way at boot)
  for (let i = 0; i < 6; i++) {
    if (await t.page.$(".pnlog-yes")) return true;
    await t.page.evaluate(() => { const x = document.getElementById("sheet-close"); const sh = document.getElementById("sheet"); if (x && sh && !sh.hidden) x.click(); });
    await wait(t.page, 500);
    await t.page.evaluate(() => window.PNLOG._ask()); await wait(t.page, 900);
  }
  return !!(await t.page.$(".pnlog-yes"));
}
async function bye(t) { await t.page.evaluate(() => window.PNLOG._bye()); await wait(t.page, 900); }
function evs(t) {
  const out = [];
  t.sent.filter((s) => s.fn === "pnlog_ingest").forEach((s) => { try { (JSON.parse(s.body).p.ev || []).forEach((e) => out.push(e)); } catch (e) {} });
  return out;
}
const keepSent = (t) => evs(t).filter((e) => KEEP.test(e.n)).map((e) => e.n);
const fpIn = (e) => FPKEYS.filter((k) => e.p && k in e.p);
const st = (t) => t.page.evaluate(() => window.PNLOG.state());

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    { // A. real app (live site), server flag "on", NO answer yet
      const t = await open(browser, { host: "/Beer-map/" });
      await provoke(t, "a"); await bye(t);
      const s = await st(t), k = keepSent(t), E = evs(t), er = E.find((e) => e.n === "err.a");
      ok("A live site: the app acts as optin (asks first), not beta 'on'", s.mode === "optin", s);
      ok("A live site, no answer: NO diagnostics sent (device, memory, CPU, network, speed)", k.length === 0, k);
      ok("A live site, no answer: no request body has device fields (mem / cpu / screen / network)", !t.sent.some((x) => /"(mem|cpu|scw|sch|dpr|rtt|mdl)":/.test(x.body)), t.sent.map((x) => x.fn));
      ok("A live site, no answer: no report_vitals, no pnlog_ping", !t.sent.some((x) => /^(report_vitals|pnlog_ping)$/.test(x.fn)), t.sent.map((x) => x.fn));
      ok("A live site: the error is still sent (strictly needed), without device fields", !!er && /boom a/.test(er.p.m || "") && fpIn(er).length === 0, er);
      ok("A live site: the diagnostics wait in memory (not sent, not stored)", s.hold > 0, s);
      // B. "Nej tack" → the held diagnostics are dropped, later ones are never sent
      const asked = await ask(t);
      await t.page.evaluate(() => document.querySelector(".pnlog-no") && document.querySelector(".pnlog-no").click()); await wait(t.page, 700);
      t.sent.length = 0;
      await provoke(t, "b"); await bye(t);
      const s2 = await st(t), cons = await t.page.evaluate(() => localStorage.getItem("olnu.logCons"));
      ok("B 'Nej tack': the ask showed, the answer is stored (olnu.logCons = 0)", asked && cons === "0", { asked, cons });
      ok("B 'Nej tack': no diagnostics sent, nothing held", keepSent(t).length === 0 && s2.hold === 0 && !s2.keep, { k: keepSent(t), s2 });
      const eb = evs(t).find((e) => e.n === "err.b");
      ok("B 'Nej tack': errors still sent, without device fields", !!eb && fpIn(eb).length === 0, eb);
      await t.ctx.close();
    }
    { // C. real app, "Ja, hjälp till" → the held diagnostics go out; D. the opt-out switch stops them again
      const t = await open(browser, { host: "/Beer-map/" });
      const s0 = await st(t);
      ok("C the ask shows", await ask(t));
      await t.page.evaluate(() => document.querySelector(".pnlog-yes") && document.querySelector(".pnlog-yes").click()); await wait(t.page, 700);
      await provoke(t, "c");
      const k = keepSent(t), s1 = await st(t);
      ok("C 'Ja': held diagnostics from before the yes are sent now (" + s0.hold + " held)", s0.hold > 0 && k.includes("dev"), { k, s0: s0.hold });
      ok("C 'Ja': new diagnostics are sent", k.includes("net.c") && s1.keep && s1.hold === 0, { k, s1 });
      // D. opt-out: ⚙️ Integritet switch "Hjälp till att förbättra appen" off
      await t.page.evaluate(() => { const d = document.createElement("div"); d.id = "cns-set"; document.body.appendChild(d); window.PNLOG.settingsSheet(d); const b = d.querySelector(".pnlog-row, .pnlog-switch"); if (b) b.click(); });
      await wait(t.page, 500); t.sent.length = 0;
      await provoke(t, "d"); await bye(t);
      const s2 = await st(t);
      ok("D opt-out switch off: diagnostics stop again", !s2.keep && keepSent(t).length === 0, { k: keepSent(t), s2 });
      await t.ctx.close();
    }
    { // E. old user who already said yes (same key olnu.logCons = "1"): no new ask, diagnostics go at once
      const t = await open(browser, { host: "/Beer-map/", cons: "1" });
      await provoke(t, "e");
      const k = keepSent(t), s = await st(t), c = await t.page.evaluate(() => localStorage.getItem("olnu.logCons"));
      ok("E old yes kept: diagnostics sent without a new ask", s.keep && k.includes("net.e") && c === "1" && !(await t.page.$(".pnlog-yes")), { k, c });
      await t.ctx.close();
    }
    { // F. beta tester (PN_BETA, /pintsnow-beta/): diagnostics as today, no ask
      const t = await open(browser, { host: "/pintsnow-beta/", beta: true });
      await provoke(t, "f"); await bye(t);
      const s = await st(t), k = keepSent(t);
      ok("F beta build: mode 'on', diagnostics sent without an answer (as today)", s.mode === "on" && k.includes("net.f") && k.includes("dev"), { mode: s.mode, k });
      await t.ctx.close();
    }
    { // G. local dev server (tests): beta rules; the store build (OLNU_STORE) = the real app again
      const t = await open(browser, {});
      const s = await st(t);
      const m2 = await t.page.evaluate(() => { window.OLNU_STORE = true; return window.PNLOG.state(); });
      ok("G local dev server = beta 'on'; store build = optin, no diagnostics before a yes", s.mode === "on" && m2.mode === "optin" && !m2.keep, { s: s.mode, m2 });
      await t.ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nconsent: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
