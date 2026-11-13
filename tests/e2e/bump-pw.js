// Skåla med telefonen (lane bump, docs/js/bump.js, migration 0509; owner design 13 Nov 01:15–01:18). node bump-pw.js <port> [shotsDir]
// Two phones (two browser contexts) on a mocked server with the same rules as 0509 in this process (the real SQL is tested with
// supabase/tests/bump-0509.test.sql). Motion = synthetic DeviceMotionEvents at 60 Hz in the page (same shapes as tests/unit/bump.test.mjs).
// Checks: off = no listener; ?bump=1 / ?bump=0 switch; guards (pocket walk, text field, Följ mig hem); shake opens the glass by itself;
// knock both = match, NOTHING logged; tilt drains; one empty = wait; both empty = one ÖL! each (toast + Ångra / app-beer hook);
// one never drinks = "Skålen rann ut", nothing logged; shake alone fades after ~8 s, no server call; hidden page detaches;
// iPhone asks the motion permission once after the first ÖL! press; store build off; delight.js shake glass stays closed.
process.argv[2] = process.argv[2] || "8971";
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bump-shots/";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const NAME = { A: "Anton", B: "Lisa", C: "Kim", D: "Eva" };
const rows = [], calls = [], logged = []; let seq = 0, WIN = 60000;
function beer(who) {
  const pause = logged.some((l) => l.who === who && l.accepted);
  const b = pause ? { accepted: false, wait_seconds: 540, beer_count: 1, drinks: 1 }
    : { accepted: true, is_new: true, beer_count: 1, drinks: 1, lat: 60.1511, lng: 15.1876, hidden: false, undo_until: new Date(Date.now() + 120e3).toISOString(), undos_left: 3 };
  logged.push({ who, accepted: b.accepted });
  return b;
}
const mateOf = (r) => rows.find((x) => r.pair && x.pair === r.pair && x.id !== r.id);
const both = (r) => { const m = mateOf(r); return !!(r.fin && m && m.fin && r.fin <= r.at0 + WIN && m.fin <= r.at0 + WIN); };
function post(r) { if (both(r) && !r.beer) r.beer = beer(r.who); }
function out(r) {
  const m = mateOf(r), now = Date.now();
  return { v: 2, id: r.id, pair: r.pair, matched: m ? [{ name: NAME[m.who] }] : [], me_done: !!r.fin, mate_done: !!(m && m.fin), both: both(r),
    left_s: r.pair ? Math.max(0, Math.ceil((r.at0 + WIN - now) / 1000)) : null, expired: !!(r.pair && now > r.at0 + WIN && !both(r)),
    beer: r.beer || null, done: !!r.pair || now - r.at > 1500 };
}
function ready(who, b) {
  calls.push({ fn: "ready", who, ...b });
  const at = Date.now() - Math.min(2000, b.p_ago_ms | 0), me = { id: ++seq, who, at, pair: null };
  rows.push(me);
  const o = rows.find((r) => r.who !== who && !r.pair && r.id !== me.id && Math.abs(r.at - at) <= 1500);
  if (o) { o.pair = me.pair = o.id; o.at0 = me.at0 = Date.now(); }
  return out(me);
}
async function routes(page, who, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|bump_ready|bump_wait|bump_finish|undo_beer)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "bold_flags_get") return J(r, { bold_bump: false, pn_bump: !!flagOn, pn_bump_test: true });   // test flag = server only
    if (fn === "bump_ready") return J(r, ready(who, body));
    const row = rows.find((x) => x.id === body.p_id && x.who === who);
    if (fn === "bump_finish") {
      calls.push({ fn: "finish", who });
      if (!row) return J(r, { message: "not_found" }, 400);
      if (!row.fin && Date.now() <= row.at0 + WIN) row.fin = Date.now();
      post(row); return J(r, out(row));
    }
    if (fn === "bump_wait") { if (!row) return J(r, { message: "not_found" }, 400); post(row); return J(r, out(row)); }
    calls.push({ fn: "undo", who }); return J(r, { ok: true, undos_left: 2 });
  });
}
async function phone(browser, who, flagOn, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  if (o.perm) await ctx.addInitScript(() => { window.DeviceMotionEvent.requestPermission = () => { window.__asked = (window.__asked || 0) + 1; return Promise.resolve("granted"); }; });
  await routes(page, who, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.PN && window.PN.bump, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 700);
  return { ctx, page };
}
// synthetic motion at 60 Hz (Android signs): shake 2.5 s + 1 s still | knock | drink (tip to 130°) | pocket walk | jolt
function move(page, kind) {
  return page.evaluate((kind) => new Promise((done) => {
    const G = 9.81, s = [], n = (ms) => Math.round(ms / (1000 / 60)), still = (ms) => { for (let i = 0; i < n(ms); i++) s.push([0, G, 0, 0, 0]); };
    // [incl x, y, z] with the phone upright (y up); the plain event has z gravity for shake/knock (phone flat in the hand)
    if (kind === "shake") { for (let i = 0; i < n(2500); i++) s.push([22 * Math.sin(2 * Math.PI * 4 * i / 60), 0, G]); for (let i = 0; i < n(1000); i++) s.push([0, 0, G]); }
    else if (kind === "knock") { for (let i = 0; i < n(300); i++) s.push([0, 3 * Math.sin(Math.PI * i / n(300)), G]); for (const v of [-32, 19, -4, 2]) s.push([0, v, G]); for (let i = 0; i < n(400); i++) s.push([0, 0, G]); }
    else if (kind === "drink") { still(200); for (let i = 0; i < n(1200); i++) { const p = 130 * i / n(1200) * Math.PI / 180; s.push([0, G * Math.cos(p), G * Math.sin(p)]); } for (let i = 0; i < n(2500); i++) { const p = 130 * Math.PI / 180; s.push([0, G * Math.cos(p), G * Math.sin(p)]); } }
    else if (kind === "pocket") { for (let i = 0; i < n(5000); i++) { const e = i * 1000 / 60, ph = (e * 1.9 / 1000) % 1; s.push([5 * Math.sin(2 * Math.PI * 1.9 * e / 1000), -G + (ph < 0.035 ? 16 : ph < 0.07 ? -7 : 0), 2]); } }
    let i = 0;
    const tm = setInterval(() => {
      if (i >= s.length) { clearInterval(tm); done(); return; }
      const [x, y, z] = s[i++];
      window.dispatchEvent(new DeviceMotionEvent("devicemotion", { accelerationIncludingGravity: { x, y, z }, interval: 16 }));
    }, 1000 / 60);
  }), kind);
}
const st = (p) => p.evaluate(() => window.PN.bump._state());
const msg = (p) => p.evaluate(() => (document.querySelector(".pnb-msg") || {}).textContent || "");
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
async function knockPair(A, B) {
  await Promise.all([move(A.page, "shake"), move(B.page, "shake")]);
  const kA = move(A.page, "knock"); await wait(B.page, 300); await Promise.all([kA, move(B.page, "knock")]);
  await A.page.waitForFunction(() => window.PN.bump._state().view === "drink", null, { timeout: 8000 }).catch(() => {});
  await B.page.waitForFunction(() => window.PN.bump._state().view === "drink", null, { timeout: 8000 }).catch(() => {});
}
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    // 1. off: no listener; a shake does nothing. ?bump=1 turns it on for this phone, ?bump=0 off.
    const X = await phone(browser, "C", false);
    ok((await st(X.page)).listening === false, "pn_bump off (pn_bump_test on = server only): no devicemotion listener");
    await move(X.page, "shake");
    ok(!(await X.page.$(".pnb-ov")), "flag off: a shake opens nothing");
    await X.page.goto(X.page.url().split("?")[0] + "?bump=1"); await X.page.waitForFunction(() => window.PN && window.PN.bump, null, { timeout: 15000 }); await wait(X.page, 2500);
    const on1 = await X.page.evaluate(() => [localStorage.getItem("olnu.bump"), window.PN.bump._state().on, window.PN.bump._state().listening]);
    ok(on1.join() === "1,true,true", "?bump=1 → olnu.bump=1, on, listening", on1);
    await X.page.goto(X.page.url().split("?")[0] + "?bump=0"); await X.page.waitForFunction(() => window.PN && window.PN.bump, null, { timeout: 15000 }); await wait(X.page, 2500);
    const on0 = await X.page.evaluate(() => [localStorage.getItem("olnu.bump"), window.PN.bump._state().on]);
    ok(on0[0] === null && on0[1] === false, "?bump=0 clears it", on0);
    await X.ctx.close();
    // 2. two phones (server flag on)
    const A = await phone(browser, "A", true), B = await phone(browser, "B", true);
    ok((await st(A.page)).listening, "flag on + visible: listening");
    await move(A.page, "pocket");
    ok(!(await A.page.$(".pnb-ov")), "phone in a pocket while walking: no glass");
    await A.page.evaluate(() => { const i = document.createElement("input"); i.id = "tmp-in"; document.body.appendChild(i); i.focus(); });
    await move(A.page, "shake");
    ok(!(await A.page.$(".pnb-ov")), "text field has focus: no glass");
    await A.page.evaluate(() => { document.getElementById("tmp-in").remove(); document.body.classList.add("hf-on"); });
    await move(A.page, "shake");
    ok(!(await A.page.$(".pnb-ov")), "Följ mig hem on: no glass");
    await A.page.evaluate(() => document.body.classList.remove("hf-on"));
    // the hook from app-beer.js on B (A has none: toast path)
    await B.page.evaluate(() => { window.__hook = []; window.BOLD.api().beerFromBump = (b) => window.__hook.push(b.accepted); });
    await Promise.all([move(A.page, "shake"), move(B.page, "shake")]);
    const sa = await st(A.page);
    ok(sa.open && sa.phase === "ready" && sa.fill === 1 && /Redo/.test(await msg(A.page)), "shake → the glass opens by itself → full → Redo", sa);
    ok(await A.page.evaluate(() => !(window.OLGLAS && window.OLGLAS.isOpen()) && !document.getElementById("dl-foam")), "delight.js shake glass stays closed");
    await A.page.screenshot({ path: SHOTS + "bump-1-ready.png" });
    const kA = move(A.page, "knock"); await wait(B.page, 300); await Promise.all([kA, move(B.page, "knock")]);
    await A.page.waitForFunction(() => window.PN.bump._state().view === "drink", null, { timeout: 8000 }).catch(() => {});
    await B.page.waitForFunction(() => window.PN.bump._state().view === "drink", null, { timeout: 8000 }).catch(() => {});
    ok(/Skål med Lisa! Luta telefonen/.test(await msg(A.page)) && /Skål med Anton!/.test(await msg(B.page)), "knock both → match → drink", [await msg(A.page), await msg(B.page)]);
    const ca = calls.find((c) => c.fn === "ready" && c.who === "A");
    ok(ca && ca.p_kind === "bump" && ca.p_ago_ms >= 100 && ca.p_ago_ms <= 1500 && typeof ca.p_lat === "number", "bump_ready: ms since the knock, a position, no phone clock", ca);
    ok(logged.length === 0 && !calls.some((c) => c.fn === "finish"), "match alone logs NOTHING");
    await A.page.screenshot({ path: SHOTS + "bump-2-drink.png" });
    // B drinks first: empty → waits for Anton; still nothing logged
    await move(B.page, "drink");
    const sb = await st(B.page);
    ok(sb.drained && sb.level === 0 && /Väntar på Anton/.test(await msg(B.page)) && logged.length === 0, "B tilts → glass empty → waits; nothing logged yet", sb);
    ok(await B.page.evaluate(() => document.querySelector(".pnb-glass").classList.contains("pnb-empty")), "foam lace stays at the rim");
    await B.page.screenshot({ path: SHOTS + "bump-3-empty.png" });
    await move(A.page, "drink");
    await A.page.waitForFunction(() => !document.querySelector(".pnb-ov"), null, { timeout: 8000 }).catch(() => {});
    await B.page.waitForFunction(() => window.__hook && window.__hook.length, null, { timeout: 8000 }).catch(() => {});
    const ta = await toasts(A.page);
    ok(/Skål med Lisa! Loggad som öl\./.test(ta), "both empty → A: Skål! then the ÖL! confirmation (toast)", ta);
    ok((await B.page.evaluate(() => window.__hook)).join() === "true", "B: app-beer hook gets the accepted beer");
    ok(logged.filter((l) => l.accepted).length === 2, "one ÖL! each", logged);
    await A.page.evaluate(() => { const b = [...document.querySelectorAll("#toasts .toast button")].find((x) => x.textContent === "Ångra"); if (b) b.click(); }); await wait(A.page, 600);
    ok(calls.some((c) => c.fn === "undo" && c.who === "A"), "Ångra in the toast calls undo_beer");
    // 3. one never drinks: Skålen rann ut, nothing logged (window 6 s in the mock)
    WIN = 6000; const before = logged.length;
    await knockPair(A, B);
    await move(A.page, "drink");
    await A.page.waitForFunction(() => /Skålen rann ut/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 12000 }).catch(() => {});
    ok(/Skålen rann ut\. Ingen öl loggad\./.test(await msg(A.page)), "A drank, B never → Skålen rann ut", await msg(A.page));
    await B.page.waitForFunction(() => /Skålen rann ut/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    ok(/Skålen rann ut/.test(await msg(B.page)) && logged.length === before, "B (never drank) → Skålen rann ut; nothing logged");
    WIN = 60000; await wait(A.page, 3000);
    // 4. shake alone: no server call, the glass fades after ~8 s
    const nReady = calls.filter((c) => c.fn === "ready").length;
    await move(A.page, "shake");
    ok(!!(await A.page.$(".pnb-ov")), "shake alone: glass open");
    await wait(A.page, 9000);
    ok(!(await A.page.$(".pnb-ov")) && calls.filter((c) => c.fn === "ready").length === nReady, "no knock → fades after ~8 s, no server call");
    // 5. knock alone: friendly miss
    await move(A.page, "shake"); await move(A.page, "knock");
    await A.page.waitForFunction(() => /Ingen knackade tillbaka/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    ok(/Ingen knackade tillbaka/.test(await msg(A.page)), "knock alone → miss text");
    ok(!/(\d+\s*öl\b|bottna|drick upp|en till)/i.test(await A.page.evaluate(() => document.querySelector(".pnb-ov").textContent)), "no drink counts or 'drink more' words");
    await A.page.keyboard.press("Escape"); await wait(A.page, 200);
    // 6. hidden page: listener off; visible: on again
    await A.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    const hid = (await st(A.page)).listening;
    await A.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    ok(hid === false && (await st(A.page)).listening === true, "hidden → listener detached; visible → attached");
    // 7. store build: off
    ok(await A.page.evaluate(() => { window.OLNU_STORE = true; window.PN.bump.sync(); return window.PN.bump._state().listening === false; }), "store build: off");
    await A.ctx.close(); await B.ctx.close();
    // 8. iPhone: ask once after the first ÖL! press
    const I = await phone(browser, "D", false, { ua: "ios", perm: true });
    await I.page.evaluate(() => { localStorage.setItem("olnu.bump", "1"); localStorage.removeItem("olnu.bump.asked"); localStorage.removeItem("olnu.og.perm"); document.getElementById("btn-beer").click(); });
    await I.page.waitForSelector(".pnb-ask", { timeout: 5000 }).catch(() => {});
    ok(!!(await I.page.$(".pnb-ask")), "iPhone: a small card after the first ÖL! press");
    await I.page.screenshot({ path: SHOTS + "bump-4-ask.png" });
    await I.page.click(".pnb-ask-ok"); await wait(I.page, 400);
    const ask = await I.page.evaluate(() => [window.__asked, localStorage.getItem("olnu.bump.asked"), localStorage.getItem("olnu.og.perm"), !!document.querySelector(".pnb-ask")]);
    ok(ask.join() === "1,1,1,false", "Tillåt → requestPermission once, stored", ask);
    await I.page.evaluate(() => document.getElementById("btn-beer").click()); await wait(I.page, 2500);
    ok(!(await I.page.$(".pnb-ask")), "never asked again");
    await I.ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bump: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
