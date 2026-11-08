// LX part of lg-pw.js (agent lgx): pnlog-hooks.js events, consent / mode matrix (on, optin, optin+yes, lite, off, none,
// heavy off), anonymous pings before an account, payload size per active minute (before = LG_BASE_PORT site without hooks),
// logging cost: perf.self share + long tasks with logging on vs off (mode none).
module.exports = async function ({ browser, setup, ok, st, flush, evs, wait, H, SP, BASE, SHOTS }) {
  const fs = require("fs");
  const PII = /Anton|Oskar|Lisa|Ida|Robban|Kalle|Sara|Ludvika Lager|ABB-gänget|ABC234|XYZ789|SECRETCODE9|aaaaaaaa-bbbb|bartendern|Var é ni|kalle@/;
  const names = (t) => evs(t).map((e) => e.n);
  const one = (t, n) => evs(t).find((e) => e.n === n);
  const fakeShare = () => {
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: function () { return Promise.resolve(); } });
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: function () { return Promise.resolve(); } } }); } catch (e) {}
  };
  // one "active use" cycle: sheets, a tab, map zoom + pan, taps on the map, a switch
  async function cycle(t, i) {
    if (!(await t.page.evaluate(() => !!window.__map).catch(() => false))) await t.page.waitForFunction(() => window.__map, null, { timeout: 120000 });
    await H.clickJS(t.page, "#btn-groups"); await t.page.waitForSelector("#sheet-body button[role=tab]", { timeout: 15000 }).catch(() => {}); await wait(t.page, 300);
    await t.page.evaluate(() => { const b = document.querySelector("#sheet-body button[role=tab]:not([aria-selected=true])"); if (b && !b.closest("a")) b.click(); }); await wait(t.page, 700);
    await H.closeSheet(t.page); await wait(t.page, 300);
    await t.page.evaluate((z) => window.__map.setZoom(z), 14 + (i % 4)); await wait(t.page, 600);
    await t.page.evaluate(() => window.__map.panBy([60, -40], { animate: false })); await wait(t.page, 400);
    const bg = await t.page.evaluate(() => { const e = document.elementFromPoint(180, 420); return !!e && !e.closest("a, button, .pill, .leaflet-marker-icon, .leaflet-popup") && !!e.closest("#map"); });
    if (bg) { await t.page.mouse.click(180, 420); await wait(t.page, 250); }
    await H.clickJS(t.page, "#btn-heat"); await wait(t.page, 250); await H.clickJS(t.page, "#btn-heat");
    if (i % 3 === 0) { await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 600); await H.closeSheet(t.page); await wait(t.page, 300); }
  }

  // 6. hooks: events and their props
  {
    const t = await setup(browser, { extra: fakeShare });
    await t.page.waitForFunction(() => window.PNLOG_HOOKS && !window.PNLOG_HOOKS.off, null, { timeout: 10000 }).catch(() => {});
    ok(await t.page.evaluate(() => !!(window.PNLOG_HOOKS && window.PNLOG_HOOKS.init)), "pnlog-hooks.js loaded (window.PNLOG_HOOKS)");
    await cycle(t, 0); await cycle(t, 1);
    await t.page.evaluate(() => window.__map.closePopup && window.__map.closePopup());
    const rx = await t.page.evaluate(() => { for (const [x, y] of [[200, 300], [120, 520], [300, 600], [60, 400]]) { const e = document.elementFromPoint(x, y); if (e && e.closest("#map") && !e.closest("a, button, .pill, .leaflet-marker-icon, .leaflet-popup, .leaflet-control")) return [x, y]; } return [200, 300]; });
    for (let i = 0; i < 4; i++) await t.page.mouse.click(rx[0], rx[1]);   // rage
    await t.page.evaluate(() => navigator.share({ url: location.origin + "/?join=SECRETCODE9", text: "Kom med i Ludvika Lager" }));
    await t.page.evaluate(() => navigator.clipboard.writeText(location.origin + "/?ev=SECRETCODE9"));
    // a step flow (avatar-like) inside a sheet, then close it half way
    await H.clickJS(t.page, "#btn-groups"); await wait(t.page, 800);
    await t.page.evaluate(() => { const b = document.getElementById("sheet-body"); const d = document.createElement("div"); d.className = "avw-step"; d.setAttribute("data-step", "skin"); b.appendChild(d); });
    await wait(t.page, 700);
    await t.page.evaluate(() => document.querySelector("#sheet-body [data-step]").setAttribute("data-step", "hair")); await wait(t.page, 700);
    await t.page.evaluate(() => { const b = document.getElementById("sheet-body"); const f = document.createElement("div"); f.style.height = "3000px"; b.appendChild(f); }); await wait(t.page, 200);
    await t.page.evaluate(() => { const b = document.getElementById("sheet-body"); b.scrollTop = 1200; b.dispatchEvent(new Event("scroll")); }); await wait(t.page, 600);
    await t.page.evaluate(() => { const x = document.getElementById("sheet-close"); x.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); x.click(); }); await wait(t.page, 400);
    // a game room: start (3 players) → end, through the RPC listener
    await t.page.evaluate(() => {
      window.PNLOG._seen("spel_state", { p_room: "r1" }, { data: { id: "r1", game: "imposter", phase: "lobby", players: [{}, {}, {}] } }, 120);
      window.PNLOG._seen("spel_act", { p_room: "r1", p_act: "start" }, { data: { room: { id: "r1", game: "imposter", phase: "clue" } } }, 140);
      window.PNLOG._seen("spel_state", { p_room: "r1" }, { data: { id: "r1", game: "imposter", phase: "end", players: [{}, {}, {}], round: 2 } }, 90);
      window.PNLOG._seen("walk_end", { p_id: 5, p_reason: "home", p_line: "Anton ä hemma" }, { data: { ok: true } }, 200);
    });
    await t.page.evaluate(() => setTimeout(() => { throw new Error("lx boom"); }, 0)); await wait(t.page, 400);
    await t.page.evaluate(() => window.PNLOG_HOOKS._sum(false));
    await flush(t);
    const N = names(t), raw = t.srv.batches.map((b) => b.raw).join("\n");
    const want = ["dev", "dev.env", "sheet.open", "sheet.close", "sheet.view", "map.sum", "perf.ft", "net.sum", "net.res", "ux.rage", "share", "copy", "flow.step", "flow.quit", "game.start", "game.end", "err.js", "rpc", "tap", "perf.mem"];
    const miss = want.filter((n) => !N.includes(n));
    ok(!miss.length, "hook events present (missing: " + (miss.join(",") || "none") + "; got " + [...new Set(N)].length + " names)");
    const dev = one(t, "dev"), env = one(t, "dev.env");
    ok(dev && dev.p.os === "android" && dev.p.br === "chrome" && dev.p.brv && dev.p.scw > 0 && dev.p.cpu > 0, "dev: os, browser, screen, cpu (" + JSON.stringify(dev && dev.p) + ")");
    ok(env && env.p.nav && "swc" in env.p && "np" in env.p, "dev.env: navigation type, sw, notification permission (" + JSON.stringify(env && env.p) + ")");
    const so = evs(t).filter((e) => e.n === "sheet.open" && e.p.fr != null && e.p.dw != null);
    ok(so.length >= 2, "sheet.open has screen flow: fr + dw (" + JSON.stringify(so[0] && so[0].p) + ")");
    const sc = evs(t).filter((e) => e.n === "sheet.close"), scx = sc.find((e) => e.p.h === "x");
    ok(sc.length && sc.every((e) => e.p.h) && !!scx, "sheet.close says how (x / code …) (" + sc.map((e) => e.p.h).join(",") + ")");
    const ms = one(t, "map.sum");
    ok(ms && ms.p.zm >= 1 && ms.p.pan >= 1 && /\d+:\d+/.test(ms.p.zh), "map.sum: zoom histogram, zooms, pans (" + JSON.stringify(ms && ms.p) + ")");
    const ft = one(t, "perf.ft");
    ok(ft && ft.p.b.split(",").length === 6 && ft.p.n > 0, "perf.ft: frame-time histogram (" + JSON.stringify(ft && ft.p) + ")");
    const sh = one(t, "share"), cp = one(t, "copy");
    ok(sh && sh.p.k === "join" && sh.p.r === "ok" && cp && cp.p.k === "ev", "share / copy: only the link type (" + JSON.stringify([sh && sh.p, cp && cp.p]) + ")");
    const fq = one(t, "flow.quit");
    ok(fq && fq.p.f === "avatar" && fq.p.k === "hair" && fq.p.n === 2, "flow.step x2 + flow.quit at 'hair' (" + JSON.stringify(fq && fq.p) + ")");
    const ge = one(t, "game.end"), gs = one(t, "game.start");
    ok(gs && gs.p.k === "spel:imposter" && gs.p.np === 3 && ge && ge.p.sec >= 0, "game.start (3 players) + game.end (" + JSON.stringify([gs && gs.p, ge && ge.p]) + ")");
    const we = evs(t).find((e) => e.n === "rpc" && e.p.fn === "walk_end");
    ok(we && we.p.a === "home" && !/hemma/.test(JSON.stringify(we.p)), "rpc walk_end carries a = home, never the text (" + JSON.stringify(we && we.p) + ")");
    const er = evs(t).find((e) => e.n === "err.js" && /lx boom/.test(e.p.m));
    ok(er && er.p.s && er.p.age >= 0 && /btn-groups|btn-heat/.test(er.p.bc || ""), "error with screen, age and breadcrumbs (" + JSON.stringify(er && er.p) + ")");
    const sv = one(t, "sheet.view"), sd = sc.find((e) => e.p.sd != null);
    ok(sv && sv.p.tab && sd && sd.p.sd > 0 && sd.p.sd <= 100, "sheet.view (tab) + scroll depth on close (" + JSON.stringify([sv && sv.p, sd && sd.p]) + ")");
    ok(!PII.test(raw), "no names / codes / text in any payload" + (PII.test(raw) ? " → " + raw.match(PII)[0] : ""));
    const cls = await t.page.evaluate(() => ["err.x", "dev", "net.sum", "perf.ft", "perf.inp", "tap", "map.cam", "sheet.view", "ux.rage", "game.start", "sheet.open"].map((n) => n + "=" + window.PNLOG.cls(n)).join(" "));
    ok(/err.x=err dev=keep net.sum=keep perf.ft=keep perf.inp=keep tap=heavy map.cam=heavy sheet.view=heavy ux.rage=use game.start=use sheet.open=use/.test(cls), "event classes (" + cls + ")");
    fs.writeFileSync(SP + "lg-shots/payload-lx.json", JSON.stringify(t.srv.batches.map((b) => b.p), null, 1));
    await t.ctx.close();
  }

  // 7. mode / consent matrix: which classes are sent
  const probe = async (t) => {
    await t.page.evaluate(() => { const P = window.PNLOG; P.event("err.lx", { v: 1 }); P.event("net.lx", { v: 1 }); P.event("ux.lx", { v: 1 }); P.event("map.cam", { z: 15 }); });
    await H.clickJS(t.page, "#btn-heat"); await H.clickJS(t.page, "#btn-heat");
    await t.page.evaluate(() => window.PNLOG.flush()); await wait(t.page, 700);
    const N = names(t);
    return { err: N.includes("err.lx"), keep: N.includes("net.lx"), use: N.includes("ux.lx"), heavy: N.includes("map.cam") || N.includes("tap"), reqs: t.srv.reqs.length };
  };
  const MATRIX = [
    ["on", {}, { err: 1, keep: 1, use: 1, heavy: 1 }],
    ["optin", {}, { err: 1, keep: 1, use: 0, heavy: 0 }],
    ["optin", { cons: 1 }, { err: 1, keep: 1, use: 1, heavy: 1 }],
    ["lite", {}, { err: 1, keep: 1, use: 0, heavy: 0 }],
    ["off", {}, { err: 1, keep: 0, use: 0, heavy: 0 }],
    ["on", { heavyOff: 1 }, { err: 1, keep: 1, use: 1, heavy: 0 }],
  ];
  for (const [mode, o, want] of MATRIX) {
    const fn = (a) => { if (!sessionStorage.getItem("lxm")) { sessionStorage.setItem("lxm", "1"); localStorage.setItem("olnu.logMode", a.mode); if (a.cons) localStorage.setItem("olnu.logCons", "1"); if (a.heavyOff) localStorage.setItem("olnu.logHeavy", "0"); } };
    const t = await setup(browser, { mode, extra: "(" + fn.toString() + ")(" + JSON.stringify({ mode, cons: o.cons, heavyOff: o.heavyOff }) + ");" });
    const r = await probe(t);
    const good = ["err", "keep", "use", "heavy"].every((k) => !!r[k] === !!want[k]);
    ok(good, "mode " + mode + (o.cons ? " + yes" : "") + (o.heavyOff ? " + heavy off" : "") + ": " + JSON.stringify(r) + " want " + JSON.stringify(want));
    await t.ctx.close();
  }
  {
    const t = await setup(browser, { mode: "none", extra: () => { localStorage.setItem("olnu.logMode", "none"); } });
    const r = await probe(t);
    const off = await t.page.evaluate(() => !!(window.PNLOG_HOOKS && window.PNLOG_HOOKS.off) && !window.fetch._pnlog);
    ok(r.reqs === 0 && off, "mode none: no request at all, hooks not installed, fetch not wrapped (" + JSON.stringify(r) + ")");
    await t.ctx.close();
  }
  {   // server says heavy = off → the phone stores it and drops HEAVY from then on
    const t = await setup(browser);
    await t.page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "on", heavy: false }) }));
    await t.page.evaluate(() => window.PNLOG.event("ux.lx0", {})); await t.page.evaluate(() => window.PNLOG.flush()); await wait(t.page, 600);
    const s = await st(t);
    ok(s.heavy === false && s.full === true, "server answer heavy:false → HEAVY off, usage still on (" + JSON.stringify({ heavy: s.heavy, full: s.full }) + ")");
    await t.ctx.close();
  }

  // 7b. position log only when the user allowed location (olnu.locOk) AND the browser permission is granted
  {   // "Inte nu" in the intro: no permission, no olnu.locOk → nothing, also when autoci / a check-in reports a position
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
    page.setDefaultNavigationTimeout(300000);
    await ctx.clearPermissions();
    await ctx.addInitScript(() => { localStorage.removeItem("olnu.locOk"); });
    await page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mode":"on"}' }));
    await page.goto(BASE); await page.waitForFunction(() => window.PNLOG && window.PNLOG.state, null, { timeout: 120000 }); await wait(page, 2500);
    await page.evaluate(() => { window.PNLOG._cfg({ fixMs: 0 }); window.PNLOG._fix(60.1512, 15.1879, 8, "ac"); window.PNLOG.loc("ci", { b: "x" }); window.PNLOG.loc("eval", { d: {} }); });
    const s = await page.evaluate(() => window.PNLOG.state());
    ok(s.l === 0 && s.loc === false, "'Inte nu' (no permission, no olnu.locOk): no position / check-in / eval rows (" + JSON.stringify({ l: s.l, loc: s.loc }) + ")");
    await ctx.close();
  }
  {
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
    page.setDefaultNavigationTimeout(300000);
    await ctx.clearPermissions();
    await page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mode":"on"}' }));
    await page.goto(BASE); await page.waitForFunction(() => window.PNLOG && window.PNLOG.state, null, { timeout: 120000 }); await wait(page, 2500);
    await page.evaluate(() => { window.PNLOG._cfg({ fixMs: 0 }); window.PNLOG._fix(60.1512, 15.1879, 8, "test"); });
    const s = await page.evaluate(() => window.PNLOG.state());
    ok(s.l === 0 && s.loc === false, "browser permission not granted (even with olnu.locOk = 1): no position rows (" + JSON.stringify({ l: s.l, loc: s.loc }) + ")");
    await ctx.close();
  }

  // 7c. first-run notice: names usage + position, ONE tap turns the position log off (own card, not a toast)
  {
    const t = await setup(browser);
    await t.page.evaluate(() => { window.PNLOG._cfg({ fixMs: 0 }); window.PNLOG._fix(60.1512, 15.1879, 8, "test"); });
    await t.page.waitForSelector("#pnlog-note", { timeout: 120000 }).catch(() => {});
    const txt = await t.page.evaluate(() => (document.getElementById("pnlog-note") || {}).textContent || "");
    ok(/position/.test(txt) && /trycker på/.test(txt) && /Stäng av position/.test(txt) && !(await t.page.$("#toasts .pnlog-note")), "first-run notice names position + taps, has 'Stäng av position', is not in the toast queue (" + txt.slice(0, 70) + "…)");
    await t.page.evaluate(() => document.querySelector("#pnlog-note .pnlog-note-off").click()); await wait(t.page, 800);
    const s2 = await st(t);
    ok(s2.loc === false && t.srv.forget === 1 && s2.l === 0, "one tap 'Stäng av position': position log off + saved rows forgotten (" + JSON.stringify({ loc: s2.loc, forget: t.srv.forget, l: s2.l }) + ")");
    await t.ctx.close();
  }

  // 8. before an account: intro steps + invite link → anonymous pings only (no user, no code)
  {
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { clean: true });
    page.setDefaultNavigationTimeout(300000);
    const pings = [];
    await page.route(/rest\/v1\/rpc\/pnlog_(ping|ingest)/, (r) => { if (/ping/.test(r.request().url())) pings.push({ body: r.request().postData(), auth: r.request().headers().authorization || "" }); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mode":"on"}' }); });
    await page.route(/\/auth\/v1\//, (r) => r.fulfill({ status: 500, body: "{}" }));   // no account yet
    await page.goto(BASE + "?join=SECRETCODE9"); await wait(page, 5000);
    const ks = pings.map((p) => JSON.parse(p.body).p_k);
    ok(ks.includes("inv.open.join") && ks.includes("pub.open"), "no account: anonymous pings inv.open.join + pub.open (" + ks.join(",") + ")");
    ok(!pings.some((p) => /SECRETCODE9/.test(p.body)), "pings never carry the code");
    const intro = await page.evaluate(() => { const i = document.getElementById("intro"); return !!i && !i.hidden; });
    const itxt = await page.evaluate(() => (document.getElementById("intro-body") || {}).textContent || "");
    if (intro) ok(!/ingen spårning/i.test(itxt) && /hur appen används/.test(itxt) && /Inställningar/.test(itxt), "intro text: no 'ingen spårning', says we log app use + where to turn it off");
    if (intro) ok(ks.some((k) => /^ob\./.test(k)), "intro shown → ob.* ping (" + ks.join(",") + ")");
    const q = await page.evaluate(() => window.PNLOG.state().q);
    ok(q > 0, "events wait in memory until the account exists (" + q + " queued)");
    await ctx.close();
  }

  // 10. STORE bundle (scripts/strip-logging.py output served on LG_STORE_PORT): crash events only, no usage code at all
  if (process.env.LG_STORE_PORT) {
    const SB = "http://127.0.0.1:" + process.env.LG_STORE_PORT + "/";
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
    page.setDefaultNavigationTimeout(300000);
    const sb = [], loaded = [];
    page.on("request", (r) => { if (/\/js\/pnlog/.test(r.url())) loaded.push(r.url().split("/js/")[1].split("?")[0]); });
    await page.route(/rest\/v1\/rpc\/(pnlog_ingest|pnlog_ping)/, (r) => { sb.push(r.request().url() + " " + (r.request().postData() || "")); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mode":"on"}' }); });
    await page.route(/rest\/v1\/rpc\/user_places/, (r) => r.fulfill({ status: 400, contentType: "application/json", body: '{"code":"42883","message":"function does not exist"}' }));
    await page.goto(SB);
    await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 120000 }).catch(() => {});
    await wait(page, 2500);
    const t = { ctx, page, srv: { batches: [] } };
    await cycle(t, 0); await cycle(t, 1);
    await page.evaluate(() => { window.PNLOG.event("ux.test", { n: 1 }); window.PNLOG.event("tap", { k: "x" }); window.PNLOG.loc("fix", { la: 60, ln: 15 }); setTimeout(() => { throw new Error("store boom"); }, 0); });
    await wait(page, 500);
    await page.evaluate(() => window.PNLOG.flush()); await wait(page, 1000);
    const st2 = await page.evaluate(() => window.PNLOG.state());
    const evN = sb.filter((x) => /pnlog_ingest/.test(x)).flatMap((x) => { try { return JSON.parse(x.slice(x.indexOf(" ") + 1)).p.ev; } catch (e) { return []; } });
    const raw = sb.join("\n");
    ok(st2.crashOnly === true && !(await page.evaluate(() => !!window.PNLOG_HOOKS)) && !loaded.includes("pnlog.js") && !loaded.includes("pnlog-hooks.js") && loaded.includes("pnlog-crash.js"),
      "store bundle: only js/pnlog-crash.js is loaded (" + [...new Set(loaded)].join(",") + ")");
    ok(evN.length > 0 && evN.every((e) => /^err\./.test(e.n)), "store bundle sends only crash events (" + [...new Set(evN.map((e) => e.n))].join(",") + ")");
    ok(evN.some((e) => e.n === "err.js" && /store boom/.test(e.p.m) && e.p.s) && evN.some((e) => e.n === "err.rpc" && e.p.fn === "user_places" && e.p.c === "42883"), "store: err.js + err.rpc (function + code + screen)");
    ok(!/pnlog_ping/.test(raw) && !/"la"|"ln"|"loc":\[\{/.test(raw) && !/"k":"btn-|"bc"|"mdl"/.test(raw), "store: no pings, no position, no taps / device data");
    await H.clickJS(page, "#btn-settings"); await wait(page, 1500);
    ok(!(await page.$("#sheet-body .pnlog-set")), "store: no logging switches in Inställningar (nothing to switch)");
    await ctx.close();
  }

  // 9. bytes per active minute (after vs before) and logging cost (on vs off)
  async function run(port, mode, cycles) {
    cycles = cycles || 12;
    const base = "http://127.0.0.1:" + port + "/";
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
    page.setDefaultNavigationTimeout(300000);
    const t = { ctx, page, srv: { batches: [], reqs: [] } };
    if (mode) await ctx.addInitScript((m) => { if (!sessionStorage.getItem("lxp")) { sessionStorage.setItem("lxp", "1"); localStorage.setItem("olnu.logMode", m); } }, mode);
    await page.route(/rest\/v1\/rpc\/pnlog_ingest/, (r) => { t.srv.batches.push({ raw: r.request().postData() || "" }); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: mode || "on", heavy: true }) }); });
    await page.goto(base);
    await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 120000 }).catch(() => {});
    if (!(await page.evaluate(() => !!window.__map))) { await ctx.close(); return null; }
    await wait(page, 2500);
    await page.evaluate(() => { window.__lt = 0; window.__ltn = 0; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lt += e.duration; window.__ltn++; })).observe({ type: "longtask" }); } catch (e) {} window.__t0 = performance.now(); window.__s0 = window.PNLOG && window.PNLOG.state ? window.PNLOG.state().selfMs : 0; });
    const t0 = Date.now();
    for (let i = 0; i < cycles; i++) await cycle(t, i);
    const res = await page.evaluate(() => ({ lt: Math.round(window.__lt), ltn: window.__ltn, el: Math.round(performance.now() - window.__t0), self: window.PNLOG && window.PNLOG.state ? window.PNLOG.state().selfMs - window.__s0 : 0 }));
    res.min = (Date.now() - t0) / 60000;
    await page.evaluate(() => { try { window.PNLOG_HOOKS && window.PNLOG_HOOKS._sum && window.PNLOG_HOOKS._sum(true); } catch (e) {} });
    await page.evaluate(() => window.PNLOG && window.PNLOG.flush && window.PNLOG.flush()); await wait(page, 800);
    for (let k = 0; k < 4 && await page.evaluate(() => window.PNLOG.state().q) > 0; k++) { await page.evaluate(() => window.PNLOG.flush()); await wait(page, 600); }
    const wire = t.srv.batches.reduce((s, b) => s + b.raw.length, 0);
    const stored = t.srv.batches.reduce((s, b) => { try { return s + JSON.stringify(JSON.parse(b.raw).p.ev).length; } catch (e) { return s; } }, 0);
    const nev = t.srv.batches.reduce((s, b) => { try { return s + JSON.parse(b.raw).p.ev.length; } catch (e) { return s; } }, 0);
    await ctx.close();
    return Object.assign(res, { wire, stored, nev, perMin: Math.round(wire / res.min) });
  }
  const tryRun = async (p, m) => { for (let k = 0; k < 2; k++) { const r = await run(p, m); if (r) return r; } return null; };
  const after = await tryRun(new URL(BASE).port, null);
  const basePort = process.env.LG_BASE_PORT;
  const before = basePort ? await tryRun(basePort, null) : null;
  if (!after) { ok(false, "bytes run: the map did not load (box too busy)"); return; }
  // cost: interleaved off / on / off / on (6 cycles each) so a load change on the shared box hits both sides
  const pairs = [];
  for (const m of ["none", null, "none", null]) { const r = await tryRun(new URL(BASE).port, m, 6); if (r) pairs.push([m || "on", r]); }
  const frac = (m) => pairs.filter((x) => x[0] === m).map((x) => x[1].lt / Math.max(1, x[1].el)).sort((a, b) => a - b);
  const med = (a) => a.length ? a[Math.floor((a.length - 1) / 2)] : null;
  const fOn = med(frac("on")), fOff = med(frac("none"));
  const offRun = (pairs.find((x) => x[0] === "none") || [])[1] || { lt: 0, ltn: 0, el: 1 };
  // per action cycle (the wall time per cycle depends on the box load, so bytes per minute is not fair between runs).
  // Night estimate = the heaviest real user of 2026-11-08 (LX_LIVE_MAX_KB = 51 KB stored, 15 min in the app) × after/before.
  const LIVE = +(process.env.LX_LIVE_MAX_KB || 51);
  const per = (x) => Math.round(x.wire / 12);   // 12 cycles per bytes run
  console.log("   bytes after :", JSON.stringify(after), "=", per(after), "B per cycle");
  if (before) console.log("   bytes before:", JSON.stringify(before), "=", per(before), "B per cycle");
  console.log("   logging off :", JSON.stringify(offRun));
  const ratio = before ? after.stored / Math.max(1, before.stored) : 2;
  const est = Math.round(LIVE * ratio);
  ok(est <= 150, "payload: " + per(after) + " B per action cycle (before " + (before ? per(before) : "?") + "); stored ×" + ratio.toFixed(2) + " → heaviest real user ≈ " + est + " KB/night (before " + LIVE + " KB; target ≤ 150 KB)");
  const share = after.self / after.el * 100;
  ok(share < 1, "logging cost perf.self = " + after.self.toFixed(1) + " ms of " + after.el + " ms = " + share.toFixed(2) + " % (< 1 %)");
  console.log("   cost pairs:", JSON.stringify(pairs.map((x) => [x[0], x[1].lt, x[1].el, x[1].self])));
  ok(fOn != null && fOff != null && fOn <= fOff + 0.10, "long tasks share of time, logging on " + (fOn * 100).toFixed(1) + " % vs off " + (fOff * 100).toFixed(1) + " % (interleaved runs; on ≤ off + 10 points)");
  fs.writeFileSync(SP + "lg-shots/lx-bytes.json", JSON.stringify({ after, before, pairs }, null, 1));
};
