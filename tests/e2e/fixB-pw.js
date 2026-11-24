// fixB-pw.js — lane fixB (polish sweep 24 Nov 2026, $S/lanes/polish-FINDINGS.md): the ÖL! flow, the night and the driver rule.
//   P-01 "Jag kör ikväll" does not turn on while drinks are logged tonight (one calm sheet, Ångra = the way out);
//        LÄSK! with drinks logged = information, no praise.
//   P-02 Ångra closes "Vilken sort?" (also one that was still on its way, 900 ms after the tap).
//   P-12 the "Vilken sort?" strip: rounded, an even 3-column grid, a 44 px close button named "Stäng".
//   P-17 "Annan dryck": Vatten + Läsk (post_soft, 0538), never a drink; works during the alcohol wait; Min kväll line.
//   P-19 Kompisvakt says "10+" (not "10" when the pin says 11); the taxi row is outline (one filled button).
// Mocked Supabase (d2-helpers), 390 x 844. Usage: node fixB-pw.js <port> [only...]   Pictures: SHOTS=<dir> (optional).
// Every check marked [bug] FAILS on b146482 (big-update before this lane) and PASSES with fixB.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.env.SHOTS ? process.env.SHOTS.replace(/\/?$/, "/") : "";
if (SHOTS) require("fs").mkdirSync(SHOTS, { recursive: true });
const ONLY = process.argv.slice(3);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 500)); c ? pass++ : fail++; };
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: SHOTS + n + ".png" }); };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, Object.assign({ reduced: true }, o.ctx || {}));
  const st = page.__fx = { rpcs: [], driving: !!o.driving, undo: 0 };
  page.on("request", (q) => { const m = q.url().match(/rpc\/(\w+)/); if (m) { let b = {}; try { b = JSON.parse(q.postData() || "{}"); } catch (e) {} st.rpcs.push([m[1], b]); } });
  await page.route(/rest\/v1\/rpc\/(pickup_poll|driver_set|ride_lask_post)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "driver_set") { st.driving = !!b.p_on; return J(r, { ok: true, on: !!b.p_on }); }
    if (fn === "ride_lask_post") return J(r, { ok: true, n: 1 });
    return J(r, { v: 1, driving: st.driving, incoming: [], mine: null });
  });
  await page.route(/rest\/v1\/rpc\/(post_beer_v2|undo_beer\w*)\b/, (r) => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (/undo/.test(r.request().url())) { st.undo++; return J(r, { ok: true, beer_count: 6 }); }
    return J(r, { accepted: true, beer_count: 7, drinks: 7, lat: b.p_lat || 60.15, lng: b.p_lng || 15.187, precise: true,
      expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() });
  });
  await page.route(/rest\/v1\/rpc\/(my_night_log|my_soft_tonight)\b/, (r) => {
    if (/my_soft_tonight/.test(r.request().url())) return J(r, { vatten: 2, lask: 1 });
    return J(r, { v: 1, night: new Date(Date.now() + 6 * 3600e3).toISOString(), evening: "2026-11-24", tonight: true, source: "log", items: [], nights: [],
      stats: { drinks: 7, logged: 7, beers: 6, others: 1, kinds: { beer: 6, rom: 1 }, bars: 1, checkins: 0, hours: [] } });
  });
  page.__errs = []; page.on("pageerror", (e) => page.__errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.SKJUTS && window.LASK && window.BARSPLUS && window.PN && PN.s, null, { timeout: 15000 }).catch(() => console.log("modules missing"));
  await wait(page, 600);
  return { ctx, page, st };
}
const sheetTitle = (page) => page.evaluate(() => { const t = document.querySelector("#sheet-title"); const s = document.getElementById("sheet"); return s && !s.hidden && getComputedStyle(s).display !== "none" && t ? t.textContent.trim() : ""; });
const closeSheet = (page) => page.evaluate(() => { const b = document.getElementById("sheet-close"); if (b) b.click(); });
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.innerText.replace(/\s+/g, " ").trim()).join(" | "));
const want = (k) => !ONLY.length || ONLY.includes(k);

async function p01(browser) {
  // A: 6 beers + 1 other tonight (the fixture: me + my pin + MYCOUNT) → switching on is blocked, driver_set is never sent
  let { ctx, page, st } = await open(browser);
  await page.evaluate(() => { const b = document.getElementById("pn-ikv2"); if (b) b.click(); });
  await wait(page, 500); await shot(page, "p01-menu");
  const n0 = st.rpcs.filter((x) => x[0] === "driver_set").length;
  const row = await page.evaluate(() => { const r = document.querySelector("#pn-ikm .pn-ikm-sw"); if (r) r.click(); return !!r; });   // the real switch "Jag kör ikväll"
  if (!row) await page.evaluate(() => window.SKJUTS.setDriver(true));
  await wait(page, 1500);
  const a = { title: await sheetTitle(page), driving: await page.evaluate(() => window.SKJUTS.driving()), sent: st.rpcs.filter((x) => x[0] === "driver_set").length - n0,
    body: await page.evaluate(() => (document.getElementById("sheet-body") || {}).innerText || ""), alert: await page.evaluate(() => !!document.querySelector("#sheet-body .mn-block[role=alert]")),
    taxi: await page.evaluate(() => document.querySelectorAll("#sheet-body .taxi-row a").length), lask: await page.evaluate(() => document.body.classList.contains("mn-lask")) };
  await shot(page, "p01-block");
  ok("[bug] P-01 drinks tonight: driver mode stays OFF, no driver_set sent", a.driving === false && a.sent === 0 && a.lask === false, a);
  ok("[bug] P-01 one calm sheet 'Kör inte ikväll' with the count + taxi", a.title === "Kör inte ikväll" && /Du har loggat \d+ drycker ikväll/.test(a.body) && a.alert && a.taxi >= 1, a);
  ok("P-01 the sheet has no praise words", !/hjält|tack vare dig|Respekt|Skål/i.test(a.body), a.body);
  // B: the way out = Ångra (the 2-min undo window is open)
  await closeSheet(page); await wait(page, 400);
  await page.evaluate(() => { window.__bu = PN.beerUndo; PN.beerUndo = { open: () => true, run: (b, cb) => { window.__undone = 1; setTimeout(() => cb(true), 50); } }; });
  await page.evaluate(() => window.SKJUTS.setDriver(true)); await wait(page, 1200);
  await shot(page, "p01-block-undo");
  const u = await page.evaluate(() => { const b = document.querySelector("#sheet-body .mn-block-undo"); const r = b && b.getBoundingClientRect(); if (b) b.click(); return { has: !!b, txt: b && b.textContent, h: r && r.height }; });
  await wait(page, 600);
  const u2 = { undone: await page.evaluate(() => window.__undone === 1), title: await sheetTitle(page) };
  await page.evaluate(() => { PN.beerUndo = window.__bu; });
  ok("[bug] P-01 undo open: the sheet offers 'Ångra senaste ölen' (44 px) and it runs the undo + closes", u.has && u.h >= 44 && u2.undone && u2.title === "", { u, u2 });
  // C: count 0 = as before (driver_set is sent, driving ON, LÄSK!)
  await page.evaluate(() => { const A = window.PNDS._A(); PN.s.meState = Object.assign({}, PN.s.meState || {}, { beer_count: 0, other_count: 0 }); window.MYCOUNT.set(0); A.myBeer = () => null; });
  const n1 = st.rpcs.filter((x) => x[0] === "driver_set").length;
  await page.evaluate(() => window.SKJUTS.setDriver(true)); await wait(page, 1500);
  const c = { sent: st.rpcs.filter((x) => x[0] === "driver_set").length - n1, driving: await page.evaluate(() => window.SKJUTS.driving()), title: await sheetTitle(page) };
  ok("P-01 0 drinks tonight: driver mode turns on as before", c.sent === 1 && c.driving === true && c.title !== "Kör inte ikväll", c);
  await ctx.close();

  // D: LÄSK! while drinks are logged (driving was on before the beer / another phone): info + "Stäng av Jag kör", no praise
  ({ ctx, page, st } = await open(browser, { driving: true }));
  await page.waitForFunction(() => document.body.classList.contains("mn-lask"), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()); document.getElementById("btn-beer").click(); });
  await wait(page, 900);
  const d = { lask: await page.evaluate(() => document.body.classList.contains("mn-lask")), t: await toasts(page),
    act: await page.evaluate(() => { const b = document.querySelector("#toasts .rd-lask-toast button"); return b ? b.textContent : ""; }),
    beer: st.rpcs.filter((x) => /^post_beer/.test(x[0])).length };
  await shot(page, "p01-lask");
  ok("[bug] P-01 LÄSK! with drinks logged: no praise, says 'Kör inte bil', no beer", d.lask && !/hjält|tack vare dig|Respekt|Skål/i.test(d.t) && /Kör inte bil/.test(d.t) && /Stäng av Jag kör/.test(d.act) && d.beer === 0, d);
  await ctx.close();
}

async function p02p12(browser) {
  const { ctx, page, st } = await open(browser);
  // P-12 first: the strip after an accepted ÖL!
  await page.evaluate(() => document.getElementById("btn-beer").click());
  await page.waitForFunction(() => { const s = document.querySelector(".bp-strip"); return s && !s.hidden; }, null, { timeout: 8000 }).catch(() => {});
  await wait(page, 500);
  await shot(page, "p12-strip");
  const s = await page.evaluate(() => {
    const st = document.querySelector(".bp-strip"); if (!st || st.hidden) return { up: false };
    const kinds = [...st.querySelectorAll(":scope > .bp-st-chips > .bp-tc")].map((b) => b.getBoundingClientRect());
    const x = st.querySelector(".bp-st-x"), xr = x.getBoundingClientRect();
    const w9 = kinds.slice(0, 9).map((r) => Math.round(r.width)), cols = new Set(kinds.slice(0, 9).map((r) => Math.round(r.left)));
    const over = [...st.querySelectorAll(".bp-tn")].some((t) => t.scrollWidth > t.clientWidth + 1);
    return { up: true, n: kinds.length, w9, cols: cols.size, rStrip: parseFloat(getComputedStyle(st).borderTopLeftRadius), rChip: parseFloat(getComputedStyle(st.querySelector(".bp-tc")).borderTopLeftRadius),
      x: { w: xr.width, h: xr.height, aria: x.getAttribute("aria-label") }, minH: Math.min(...kinds.map((r) => r.height)), over };
  });
  ok("P-02/P-12 the strip shows after ÖL!", s.up && s.n === 10, s);
  ok("[bug] P-12 rounded panel + chips (radius tokens)", s.rStrip >= 12 && s.rChip >= 8, s);
  ok("[bug] P-12 the 9 first kinds: 3 columns, equal widths", s.cols === 3 && Math.max(...s.w9) - Math.min(...s.w9) <= 1, s);
  ok("[bug] P-12 close = 44 px, name 'Stäng'", s.x.w >= 44 && s.x.h >= 44 && s.x.aria === "Stäng", s.x);
  ok("P-12 chips >= 44 px, no name is cut", s.minH >= 44 && !s.over, s);
  // P-02: Ångra (the same doUndo as the button) closes the strip
  await page.evaluate(() => PN.beerUndo.run(null, () => {}));
  await wait(page, 900);
  const a = { undo: page.__fx.undo, hidden: await page.evaluate(() => { const x = document.querySelector(".bp-strip"); return !x || x.hidden; }), t: await toasts(page) };
  await shot(page, "p02-after-undo");
  ok("[bug] P-02 after Ångra 'Vilken sort?' is gone", a.undo >= 1 && a.hidden && /Ölen togs bort/.test(a.t), a);
  // P-02 race: undo BEFORE the strip came (it opens 900 ms after the answer)
  await page.evaluate(() => { PN.s.lastAcceptAt = 0; });
  await page.evaluate(() => window.BARSPLUS.onBeerAccepted({ beer_count: 7 }));
  await page.evaluate(() => window.BARSPLUS.onBeerUndone && window.BARSPLUS.onBeerUndone({ ok: true }));
  await wait(page, 1800);
  const b = await page.evaluate(() => { const x = document.querySelector(".bp-strip"); return !x || x.hidden; });
  ok("[bug] P-02 undo before the strip came: it never opens", b, b);
  await ctx.close();
  // 360 px: the strip still fits (no cut names)
  const c2 = await ctxFor(browser, { width: 360, height: 740 }, { reduced: true });
  await c2.page.route(/rest\/v1\/rpc\/post_beer_v2\b/, (r) => J(r, { accepted: true, beer_count: 7, drinks: 8, lat: 60.15, lng: 15.187, precise: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }));
  await boot(c2.page);
  await c2.page.evaluate(() => document.getElementById("btn-beer").click());
  await c2.page.waitForFunction(() => { const s = document.querySelector(".bp-strip"); return s && !s.hidden; }, null, { timeout: 8000 }).catch(() => {});
  await wait(c2.page, 500);
  if (SHOTS) await c2.page.screenshot({ path: SHOTS + "p12-strip-360.png" });
  const o360 = await c2.page.evaluate(() => { const st = document.querySelector(".bp-strip"); if (!st || st.hidden) return { up: false };
    const r = st.getBoundingClientRect(); return { up: true, l: r.left, r: r.right, over: [...st.querySelectorAll(".bp-tn")].some((t) => t.scrollWidth > t.clientWidth + 1) }; });
  ok("P-12 360 px: the strip is on screen, no name is cut", o360.up && o360.l >= 0 && o360.r <= 360 && !o360.over, o360);
  await c2.ctx.close();
}

async function p17(browser) {
  const { ctx, page, st } = await open(browser);
  const vis = await page.evaluate(() => { const w = document.getElementById("other-wrap"); return !!(w && !w.hidden); });
  await page.evaluate(() => document.getElementById("btn-other").click());
  await wait(page, 900);
  await shot(page, "p17-sheet");
  const a = await page.evaluate(() => ({ soft: [...document.querySelectorAll("#sheet-body [data-soft]")].map((b) => [b.getAttribute("data-soft"), b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]),
    kinds: document.querySelectorAll("#sheet-body [data-kind]").length, title: (document.querySelector("#sheet-title") || {}).textContent || "" }));
  ok("[bug] P-17 'Annan dryck' has Vatten + Läsk (44 px+) and the 9 kinds", vis && a.soft.length === 2 && a.soft[0][1] === "Vatten" && a.soft[1][1] === "Läsk" && a.soft.every((x) => x[2] >= 44) && a.kinds === 9 && /Annan dryck/.test(a.title), a);
  const before = await page.evaluate(() => ({ mc: window.MYCOUNT._state().want, me: window.U.drinks(PN.s.meState) }));
  const n0 = st.rpcs.length;
  await page.evaluate(() => { const v = document.querySelector("#sheet-body [data-soft=vatten]"); if (v) v.click(); });
  await wait(page, 1000);
  const sent = st.rpcs.slice(n0).map((x) => x[0]);
  const b = { sent, body: (st.rpcs.slice(n0).find((x) => x[0] === "post_soft") || [])[1], t: await toasts(page), after: await page.evaluate(() => ({ mc: window.MYCOUNT._state().want, me: window.U.drinks(PN.s.meState) })), burst: await page.evaluate(() => document.querySelectorAll(".pm-burst").length) };
  await shot(page, "p17-water-logged");
  ok("[bug] P-17 Vatten = post_soft {p_kind: vatten}, never post_other", sent.includes("post_soft") && b.body && b.body.p_kind === "vatten" && !sent.some((x) => /^post_other/.test(x)), b);
  ok("P-17 water is never a drink: count, burst unchanged; plain line, no praise", b.after.mc === before.mc && b.after.me === before.me && b.burst === 0 && /Vatten loggat · 1 glas ikväll/.test(b.t) && !/Skål|hjält/i.test(b.t), { before, b });
  // the 10-min alcohol wait: the sheet opens, alcohol off, water / soda on
  await page.evaluate(() => { localStorage.setItem("olnu.otherCd", String(Date.now() + 5 * 60e3)); document.getElementById("btn-other").click(); });
  await wait(page, 900);
  await shot(page, "p17-sheet-wait");
  const c = await page.evaluate(() => ({ title: (document.querySelector("#sheet-title") || {}).textContent || "", off: [...document.querySelectorAll("#sheet-body [data-kind]")].every((b) => b.disabled),
    soft: [...document.querySelectorAll("#sheet-body [data-soft]")].every((b) => !b.disabled) && document.querySelectorAll("#sheet-body [data-soft]").length === 2 }));
  ok("[bug] P-17 during the alcohol wait: water + soda still work, alcohol is off", /Annan dryck/.test(c.title) && c.off && c.soft, c);
  await closeSheet(page); await wait(page, 400);
  // Min kväll: its own line, never inside "drycker"
  await page.evaluate(() => window.NIGHTLOG.open(null));
  await wait(page, 1200);
  await shot(page, "p17-minkvall");
  const d = await page.evaluate(() => ({ soft: (document.querySelector("#sheet-body .nl-soft") || {}).textContent || "", n: (document.querySelector("#sheet-body .nl-stat b") || {}).textContent }));
  ok("[bug] P-17 Min kväll: 'Utan alkohol ikväll: 2 vatten · 1 läsk', drycker stays 7", d.soft === "Utan alkohol ikväll: 2 vatten · 1 läsk" && d.n === "7", d);
  ok("P-17 no page errors", page.__errs.length === 0, page.__errs);
  await ctx.close();
}

async function p19(browser) {
  const { ctx, page } = await open(browser);
  const has = await page.evaluate(() => !!window.AFTER && typeof window.AFTER.hudClick === "function");
  const lines = [];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.AFTER.hudClick("afmed"));
    await wait(page, 350);
    const t = await page.evaluate(() => (document.querySelector("#sheet-body .af-lead") || {}).textContent || "");
    if (t) lines.push(t);
    if (i === 0) await shot(page, "p19-kompisvakt");
    await closeSheet(page); await wait(page, 250);
  }
  ok("[bug] P-19 Kompisvakt never says 'på 10' for a friend on 11 (says 10+)", has && lines.length >= 10 && !lines.some((t) => /p[åa] 10(?![+\d])/.test(t)) && lines.some((t) => /10\+/.test(t)), lines);
  await page.evaluate(() => window.AFTER.hudClick("afmed")); await wait(page, 500);
  const f = await page.evaluate(() => {
    const filled = (e) => { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g) || []; return m.length >= 3 && (m.length < 4 || +m[3] > 0.5) && (+m[0] + +m[1] + +m[2]) > 200; };
    const all = [...document.querySelectorAll("#sheet-body button, #sheet-body a")].filter((e) => e.getBoundingClientRect().height > 0);
    return { filled: all.filter(filled).map((e) => e.textContent.trim()), taxi: all.filter((e) => e.closest(".taxi-row")).map((e) => Math.round(e.getBoundingClientRect().height)) };
  });
  ok("[bug] P-19 one filled button ('Jag kollar'); the taxi row is outline, 44 px", f.filled.length === 1 && /Jag kollar/.test(f.filled[0]) && f.taxi.length >= 1 && f.taxi.every((h) => h >= 44), f);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  try {
    if (want("p01")) await p01(browser);
    if (want("p02")) await p02p12(browser);
    if (want("p17")) await p17(browser);
    if (want("p19")) await p19(browser);
  } catch (e) { fail++; console.log("FAIL crash", e.message); }
  await browser.close();
  console.log(`fixB: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
