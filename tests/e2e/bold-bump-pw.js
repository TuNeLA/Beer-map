// 🍻 Skål! (bd08, flag bold_bump). Two phones (two browser contexts) on a mocked server with a shared tap matcher in this
// process (the real SQL matcher is tested on staging: same window, distance, friends). node bold-bump-pw.js <port> [shotsDir]
// Checks: local feedback < 500 ms; both phones get "SKÅL med …" (second tapper at once, first tapper via bold_bump_wait);
// no match → the friendly miss text; "Nära dig nu" list + the HUD chip once; Ikväll menu row; flag OFF = nothing.
process.argv[2] = process.argv[2] || "8965";
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bold-shots/";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const taps = []; let seq = 0;
const NAME = { A: "Anton", B: "Lisa" };
function bump(who) {
  const now = Date.now(), me = { id: ++seq, who, at: now, group: null };
  taps.push(me);
  const other = taps.find((t) => t.who !== who && now - t.at <= 3000 && t.id !== me.id);
  if (other) { me.group = other.group = other.id; return { v: 1, id: me.id, matched: [{ name: NAME[other.who] }], new_pairs: 1, pts: 2, stats: { total: 1, next: 3, tier: null } }; }
  return { v: 1, id: me.id, matched: [], new_pairs: 0, pts: 0, stats: { total: 0, next: 3 } };
}
function waitFor(who, id) {
  const me = taps.find((t) => t.id === id);
  if (me && me.group) { const o = taps.find((t) => t.group === me.group && t.who !== who); return { v: 1, id, matched: [{ name: NAME[o.who] }], pts: 2, new_pairs: 1, done: true, stats: { total: 1, next: 3 } }; }
  return { v: 1, id, matched: [], done: me ? Date.now() - me.at > 4000 : true };
}
async function routes(page, who, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|bold_bump|bold_bump_wait|bold_bump_stats|bold_presence_ping)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    switch (fn) {
      case "bold_flags_get": return J(r, { bold_hemlage: false, bold_krog: false, bold_skal_v2: false, bold_replay: false, bold_bump: !!flagOn });
      case "bold_bump": return J(r, bump(who));
      case "bold_bump_wait": return J(r, waitFor(who, body.p_id));
      case "bold_bump_stats": return J(r, { v: 1, total: 0, tonight: 0, tier: null, next: 3 });
      case "bold_presence_ping": return J(r, { v: 1, near: [{ name: who === "A" ? "Lisa" : "Anton", d: "~10 m" }] });
    }
  });
}
async function phone(browser, who, flagOn) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await routes(page, who, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.BOLD_BUMP, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 600);
  return { ctx, page };
}
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const A = await phone(browser, "A", true), B = await phone(browser, "B", true);
    // the HUD chip after a background ping (night out: the seeded check-in)
    await A.page.evaluate(() => { window.BOLD.api().setLastLoc(60.14997, 15.18679); window.BOLD.onPoll(); }); await wait(A.page, 1500);
    await A.page.evaluate(() => window.BOLD.api().updateCounts()); await wait(A.page, 800);
    ok(await A.page.evaluate(() => /Lisa ä nära · Skål!/.test((document.querySelector(".bb-chip") || {}).textContent || "")), "HUD chip: Lisa ä nära · Skål!");
    // Ikväll menu row
    await A.page.evaluate(() => { const c = document.getElementById("pn-ikv2"); if (c) c.click(); }); await wait(A.page, 400);
    const row = await A.page.evaluate(() => { const r = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].find((x) => /Skål!/.test(x.textContent)); if (r) r.click(); return !!r; });
    ok(row, "Ikväll menu row Skål! (when pnikv.js is merged)");
    await wait(A.page, 800);
    if (!(await A.page.$(".bb-ov"))) await A.page.evaluate(() => window.BOLD_BUMP.open());
    await B.page.evaluate(() => window.BOLD_BUMP.open()); await wait(B.page, 1500); await wait(A.page, 300);
    ok(await A.page.evaluate(() => /Lisa/.test((document.querySelector(".bb-near") || {}).textContent || "")), "Nära dig nu shows Lisa (~10 m)");
    await A.page.screenshot({ path: SHOTS + "bump-1-open.png" });
    // A taps, B taps 0.8 s later
    await A.page.click(".bb-btn");
    const local = await A.page.evaluate(() => window.BOLD_BUMP._state().local);
    ok(local !== undefined && local < 500 && await A.page.evaluate(() => document.querySelector(".bb-btn").classList.contains("bb-tilt")), "local feedback < 500 ms", local);
    await wait(B.page, 800); await B.page.click(".bb-btn");
    await B.page.waitForFunction(() => /SKÅL med Anton/.test((document.querySelector(".bb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    await A.page.waitForFunction(() => /SKÅL med Lisa/.test((document.querySelector(".bb-msg") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const ma = await A.page.evaluate(() => document.querySelector(".bb-msg").textContent), mb = await B.page.evaluate(() => document.querySelector(".bb-msg").textContent);
    ok(/SKÅL med Lisa! \+2 meriter/.test(ma) && /SKÅL med Anton! \+2 meriter/.test(mb), "both phones: SKÅL med … +2 meriter", [ma, mb]);
    ok(await A.page.evaluate(() => document.querySelector(".bb-btn").classList.contains("bb-yes")), "clink animation on the first tapper");
    await A.page.screenshot({ path: SHOTS + "bump-2-match.png" });
    // no match
    await wait(A.page, 2500); await A.page.click(".bb-btn");
    await A.page.waitForFunction(() => /Ingen skålade tillbaka/.test((document.querySelector(".bb-msg") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    ok(/Ingen skålade tillbaka/.test(await A.page.evaluate(() => document.querySelector(".bb-msg").textContent)), "no match → the friendly miss text");
    await A.page.screenshot({ path: SHOTS + "bump-3-miss.png" });
    ok(!(await A.page.evaluate(() => /\böl\b.*\d|\d.*\böl\b/i.test(document.querySelector(".bb-ov").textContent.replace("aldrig öl", "")))), "no drink numbers on the screen");
    await A.ctx.close(); await B.ctx.close();
    const C = await phone(browser, "A", false);
    ok((await C.page.evaluate(() => window.BOLD_BUMP.open())) === false && !(await C.page.$(".bb-ov")), "flag off: nothing opens");
    await C.ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bold-bump: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
