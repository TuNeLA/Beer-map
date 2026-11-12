// Skåla med telefonen (lane bump, docs/js/bump.js, flag pn_bump / PN_CFG.bump, migration 0509). node bump-pw.js <port> [shotsDir]
// Two phones (two browser contexts) on a mocked server with a shared matcher in this process (the real SQL matcher is tested
// with supabase/tests/bump-0509.test.sql: friends, blocked, 50 m, 1.5 s / 3 s, same limits). Motion = synthetic DeviceMotionEvents
// sent at 60 Hz in the page (the same shapes as tests/unit/bump.test.mjs).
// Checks: flag off = nothing; menu row; shake fills the glass → Redo; knock on both → both "Skål med …" + the beer logged (bump_ready
// params: kind, ms-ago, no phone clock); Ångra without the app-beer hook, the hook when present; tap fallback + the 10-min pause text;
// a miss; no sensor → the tap is the main way; iPhone permission button; delight.js shake glass stays closed under this screen.
process.argv[2] = process.argv[2] || "8971";
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bump-shots/";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const NAME = { A: "Anton", B: "Lisa", C: "Kim", D: "Eva" };
const rows = [], calls = [], beerOn = { A: 0, B: 0 }; let seq = 0, pauseNext = false;
function beer(who) {
  if (pauseNext || Date.now() - (beerOn[who] || 0) < 600e3) return { accepted: false, wait_seconds: 540, beer_count: 1, drinks: 1 };
  beerOn[who] = Date.now();
  return { accepted: true, is_new: true, beer_count: 1, drinks: 1, lat: 60.1511, lng: 15.1876, hidden: false, undo_until: new Date(Date.now() + 120e3).toISOString(), undos_left: 3 };
}
function ready(who, b) {
  calls.push({ who, ...b });
  const at = Date.now() - Math.min(2000, b.p_ago_ms | 0), me = { id: ++seq, who, at, kind: b.p_kind, pair: null, beer: null };
  rows.push(me);
  const other = rows.find((r) => r.who !== who && !r.pair && r.id !== me.id && Math.abs(r.at - at) <= (r.kind === "bump" && me.kind === "bump" ? 1500 : 3000));
  if (other) { other.pair = me.pair = other.id; me.beer = beer(who); }
  return out(me);
}
function out(r) {
  const o = r.pair ? rows.find((x) => x.pair === r.pair && x.who !== r.who) : null;
  return { v: 1, id: r.id, kind: r.kind, pair: r.pair, matched: o ? [{ name: NAME[o.who] }] : [], beer: r.beer, done: !!r.pair || Date.now() - r.at > 1500 };
}
function waitFor(who, id) { const r = rows.find((x) => x.id === id && x.who === who); if (r && r.pair && !r.beer) r.beer = beer(who); return r ? out(r) : {}; }
async function routes(page, who, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|bump_ready|bump_wait|undo_beer)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "bold_flags_get") return J(r, { bold_bump: false, pn_bump: !!flagOn });
    if (fn === "bump_ready") return J(r, ready(who, body));
    if (fn === "bump_wait") return J(r, waitFor(who, body.p_id));
    calls.push({ who, undo: true }); return J(r, { ok: true, undos_left: 2 });
  });
}
async function phone(browser, who, flagOn, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  if (o.perm) await ctx.addInitScript(() => { window.DeviceMotionEvent.requestPermission = () => { window.__asked = (window.__asked || 0) + 1; return Promise.resolve("granted"); }; });
  await routes(page, who, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.PN && window.PN.bump, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 600);
  return { ctx, page };
}
// synthetic motion at 60 Hz: "shake" (2.5 s at 4 Hz, then 1 s still) or "knock" (calm push, a 2-sample hit, ring, still)
function move(page, kind) {
  return page.evaluate((kind) => new Promise((done) => {
    const G = 9.81, s = [], n = (ms) => Math.round(ms / (1000 / 60));
    if (kind === "shake") { for (let i = 0; i < n(2500); i++) s.push([22 * Math.sin(2 * Math.PI * 4 * i / 60), 0, G]); for (let i = 0; i < n(1000); i++) s.push([0, 0, G]); }
    else { for (let i = 0; i < n(300); i++) s.push([0, 3 * Math.sin(Math.PI * i / n(300)), G]); for (const v of [-32, 19, -4, 2]) s.push([0, v, G]); for (let i = 0; i < n(400); i++) s.push([0, 0, G]); }
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
async function menuRow(page) {
  return page.evaluate(() => {
    const c = document.getElementById("pn-ikv2"); if (c) c.click();
    const r = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].find((x) => /Skåla med telefonen/.test(x.textContent));
    if (r) { r.click(); return "menu"; }
    // pnikv not on this screen: ask BOLD for the rows directly (the same call pnikv makes)
    const got = window.BOLD.menuRows((ic, t, s, fn) => { const b = document.createElement("button"); b.textContent = t; b.onclick = fn; return b; }, () => {});
    const b = got.find((x) => /Skåla med telefonen/.test(x.textContent)); if (b) { b.click(); return "bold"; }
    return "";
  });
}
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    // 1. flag off: no row, open() refuses
    const X = await phone(browser, "C", false);
    ok((await menuRow(X.page)) === "" && (await X.page.evaluate(() => window.PN.bump.open())) === false && !(await X.page.$(".pnb-ov")), "flag off: no menu row, nothing opens");
    await X.ctx.close();
    // 2. two phones, flag on
    const A = await phone(browser, "A", true), B = await phone(browser, "B", true);
    ok((await menuRow(A.page)) !== "", "menu row 'Skåla med telefonen' opens the screen");
    await wait(A.page, 400);
    if (!(await A.page.$(".pnb-ov"))) await A.page.evaluate(() => window.PN.bump.open());
    await B.page.evaluate(() => window.PN.bump.open());
    ok(!!(await A.page.$(".pnb-ov")) && /Skaka telefonen/.test(await msg(A.page)), "screen open: 'Skaka telefonen!'", await msg(A.page));
    await Promise.all([move(A.page, "shake"), move(B.page, "shake")]);
    const sa = await st(A.page);
    ok(sa.view === "ready" && sa.fill === 1 && /Redo/.test(await msg(A.page)), "shake → full glass → Redo", sa);
    ok(await A.page.evaluate(() => document.querySelector(".pnb-beer").style.height === "100%"), "glass drawn full");
    ok(await A.page.evaluate(() => !(window.OLGLAS && window.OLGLAS.isOpen()) && !document.getElementById("dl-foam")), "delight.js shake glass stays closed under this screen");
    await A.page.screenshot({ path: SHOTS + "bump-1-ready.png" });
    // knock: A, then B 0.4 s later
    const kA = move(A.page, "knock"); await wait(B.page, 400); await Promise.all([kA, move(B.page, "knock")]);
    await A.page.waitForFunction(() => /Skål med Lisa/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    await B.page.waitForFunction(() => /Skål med Anton/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const ma = await msg(A.page), mb = await msg(B.page);
    ok(/Skål med Lisa! Loggad som öl\./.test(ma) && /Skål med Anton! Loggad som öl\./.test(mb), "both phones: Skål med … Loggad som öl", [ma, mb]);
    const ca = calls.find((c) => c.who === "A" && c.p_kind);
    ok(ca && ca.p_kind === "bump" && ca.p_ago_ms >= 100 && ca.p_ago_ms <= 1500 && ca.p_hidden === false && typeof ca.p_lat === "number" && !("p_t" in ca), "bump_ready: kind bump, ms since the knock (no phone clock), a position", ca);
    ok(calls.filter((c) => c.p_kind).length === 2, "one bump_ready per phone (no double send)", calls.length);
    ok(await A.page.$(".pnb-undo") !== null, "no app-beer hook: Ångra on the screen");
    await A.page.click(".pnb-undo"); await wait(A.page, 600);
    ok(calls.some((c) => c.who === "A" && c.undo) && /ångrad/.test(await msg(A.page)), "Ångra calls undo_beer", await msg(A.page));
    await A.page.screenshot({ path: SHOTS + "bump-2-skal.png" });
    // 3. tap fallback within 3 s; the server says pause (10-min rule): the skål shows, no beer, no Ångra
    pauseNext = true;
    await A.page.evaluate(() => { const u = document.querySelector(".pnb-undo"); if (u) u.remove(); });
    await B.page.evaluate(() => { window.__hook = []; window.BOLD.api().beerFromBump = (b, s, g) => window.__hook.push(b.accepted); });
    await A.page.click(".pnb-tap"); await wait(A.page, 1000); await B.page.click(".pnb-tap");
    await A.page.waitForFunction(() => /paus/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const ta = await msg(A.page);
    ok(/Skål med Lisa! Du har paus i 9:00\. Ingen ny öl loggad\./.test(ta) && !(await A.page.$(".pnb-undo")), "tap fallback (3 s) + pause: skål, no beer, no Ångra", ta);
    ok(calls.filter((c) => c.p_kind === "tap").length === 2, "tap sends kind tap");
    pauseNext = false;
    // the app-beer hook (A.beerFromBump) gets an accepted beer; no Ångra button then
    beerOn.A = beerOn.B = 0;
    await wait(A.page, 2200); await A.page.click(".pnb-tap"); await wait(A.page, 300); await B.page.click(".pnb-tap");
    await B.page.waitForFunction(() => window.__hook && window.__hook.length, null, { timeout: 8000 }).catch(() => {});
    ok((await B.page.evaluate(() => window.__hook)).join() === "true" && !(await B.page.$(".pnb-undo")), "hook A.beerFromBump used when present (no own Ångra)", await B.page.evaluate(() => window.__hook));
    // 4. miss: A alone
    await wait(A.page, 2200); await A.page.click(".pnb-tap");
    await A.page.waitForFunction(() => /Ingen knackade tillbaka/.test((document.querySelector(".pnb-msg") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    ok(/Ingen knackade tillbaka/.test(await msg(A.page)), "alone → the friendly miss text", await msg(A.page));
    ok(!/(\d+\s*öl|bottna|drick upp|en till)/i.test(await A.page.evaluate(() => document.querySelector(".pnb-ov").textContent)), "no drink counts or 'drink more' words on the screen");
    // close: Escape stops the sensor listener
    await A.page.keyboard.press("Escape"); await wait(A.page, 200);
    ok(!(await A.page.$(".pnb-ov")) && (await st(A.page)).open === false, "Escape closes");
    await A.ctx.close(); await B.ctx.close();
    // 5. no sensor: after 1.5 s the tap is the main way
    const N = await phone(browser, "C", true);
    await N.page.evaluate(() => window.PN.bump.open()); await wait(N.page, 2000);
    ok((await st(N.page)).view === "nosensor" && /Ingen rörelsesensor/.test(await msg(N.page)), "no sensor → tap fallback text", await msg(N.page));
    await N.page.screenshot({ path: SHOTS + "bump-3-nosensor.png" });
    await N.ctx.close();
    // 6. iPhone: permission from the Starta tap
    const I = await phone(browser, "D", true, { ua: "ios", perm: true });
    await I.page.evaluate(() => { try { localStorage.removeItem("olnu.og.perm"); } catch (e) {} window.PN.bump.open(); }); await wait(I.page, 300);
    const vis = await I.page.evaluate(() => !document.querySelector(".pnb-start").hidden);
    await I.page.click(".pnb-start"); await wait(I.page, 400);
    ok(vis && (await I.page.evaluate(() => window.__asked)) === 1 && (await st(I.page)).view === "fill", "iPhone: Starta asks the motion permission once, then Skaka", await st(I.page));
    await I.ctx.close();
    // 7. store build: off
    const S = await phone(browser, "C", true);
    ok((await S.page.evaluate(() => { window.OLNU_STORE = true; return window.PN.bump.open(); })) === false, "store build: off");
    await S.ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bump: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
