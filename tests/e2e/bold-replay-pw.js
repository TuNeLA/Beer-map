// 📼 Kvällsrepris 2.0 (bd07, flag bold_replay). Mocked Supabase (ds-helpers). node bold-replay-pw.js <port> [shotsDir] [mapboxToken]
// Checks: start(gid) opens the canvas film; it ends after ~15 s with the end card; fuzzy home areas are circles (no pin);
// "Spara som video" records a real video blob (MediaRecorder); "Ta bort mig" calls bold_replay_hide_me; the morning button;
// flag OFF = start() returns false (crew.js plays its old replay).
process.argv[2] = process.argv[2] || "8964";
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bold-shots/";
const TOKEN = process.argv[4] || "";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0, hid = null;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const ev = new Date(Date.now() - 12 * 3600e3), base = new Date(ev.toISOString().slice(0, 10) + "T19:00:00Z").getTime();
const at = (min) => new Date(base + min * 60e3).toISOString();
const B = { pitch: [60.14997, 15.18679], parma: [60.15124, 15.18797], lobby: [60.15098, 15.18663] };
const REPLAY = { available: true, night: at(600), evening: new Date(base).toISOString().slice(0, 10),
  members: [{ k: "a", name: "Anton", is_me: true }, { k: "b", name: "Lisa", is_me: false }, { k: "c", name: "Milos", is_me: false }],
  points: [
    { k: "a", at: at(0), lat: 60.1515, lng: 15.198, kind: "area", bar_name: "🏠 Förfest" },
    { k: "a", at: at(60), lat: B.pitch[0], lng: B.pitch[1], kind: "ci", bar_name: "Pitchers" },
    { k: "a", at: at(150), lat: B.parma[0], lng: B.parma[1], kind: "ci", bar_name: "La Parma Pub & Restaurang" },
    { k: "b", at: at(30), lat: B.lobby[0], lng: B.lobby[1], kind: "ci", bar_name: "Lobbybaren" },
    { k: "b", at: at(120), lat: B.parma[0], lng: B.parma[1], kind: "ci", bar_name: "La Parma Pub & Restaurang" },
    { k: "b", at: at(330), lat: 60.1425, lng: 15.174, kind: "area", bar_name: "🏠 Hemma" },
    { k: "c", at: at(10), lat: 60.1605, lng: 15.18, kind: "area", bar_name: "🏠 Hemma" },
    { k: "c", at: at(200), lat: 60.1605, lng: 15.18, kind: "area", bar_name: "🏠 Hemma" }],
  summary: { members_out: 3, bars: 3, checkins: 4, points: 8 } };
async function routes(page, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|crew_replay|bold_replay_photos|bold_replay_hide_me|my_groups)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    switch (fn) {
      case "bold_flags_get": return J(r, { bold_hemlage: false, bold_krog: false, bold_skal_v2: false, bold_replay: !!flagOn, bold_bump: false });
      case "crew_replay": return J(r, REPLAY);
      case "bold_replay_photos": return J(r, { v: 1, photos: [{ k: "a", at: at(75), kind: "skal" }, { k: "b", at: at(125), kind: "film" }] });
      case "bold_replay_hide_me": hid = body; return J(r, { v: 1, hidden: true });
      case "my_groups": return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 3, active_count: 0 }]);
    }
  });
}
async function start(browser, flagOn) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  if (TOKEN) await ctx.addInitScript((t) => { try { localStorage.setItem("olnu.mbToken", t); } catch (e) {} }, TOKEN);
  await routes(page, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.BOLD_REPLAY, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 600);
  return { ctx, page };
}
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    let { ctx, page } = await start(browser, true);
    const t0 = Date.now();
    ok(await page.evaluate((g) => window.BOLD_REPLAY.start(g), GID), "start(gid) takes over when the flag is on");
    await page.waitForSelector(".brp-ov .brp-cv", { timeout: 10000 }).catch(() => {});
    ok(!!(await page.$(".brp-ov .brp-cv")), "the film opens (canvas)");
    await wait(page, 6500); await page.screenshot({ path: SHOTS + "replay-1-mid.png" });
    await page.waitForFunction(() => /Igen/.test((document.querySelector(".brp-pp") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => {});
    const dur = (Date.now() - t0) / 1000;
    ok(dur > 13 && dur < 24, "the film ends after about 15 s", Math.round(dur));
    await page.screenshot({ path: SHOTS + "replay-2-end.png" });
    const end = await page.evaluate(() => { const c = document.querySelector(".brp-cv"), d = c.getContext("2d").getImageData(360, 600, 1, 1).data; return [d[0], d[1], d[2]]; });
    ok(end[0] < 90 && end[2] < 90, "end card darkens the film", end);
    // the home area is a soft circle around the area point, not a pin: the model keeps 'area' points out of the bar list
    const bars = await page.evaluate((d) => Object.keys(window.BOLD_REPLAY._model(d, []).bars), REPLAY);
    ok(bars.length === 3 && !bars.some((b) => /🏠/.test(b)), "home areas are never drawn as bars/pins", bars);
    // record a video
    const canRec = await page.evaluate(() => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream));
    await page.click(".brp-save"); await wait(page, 1000);
    ok(/Spelar in/.test(await page.evaluate(() => document.querySelector(".brp-save").textContent)) || !canRec, "recording starts");
    await page.waitForFunction(() => window.__brpLast, null, { timeout: 40000 }).catch(() => {});
    const vid = await page.evaluate(() => window.__brpLast ? { size: window.__brpLast.size, type: window.__brpLast.type } : null);
    ok(vid && vid.size > 50000 && /video\/(webm|mp4)/.test(vid.type), "Spara som video → a real video file", vid);
    // Ta bort mig
    await page.click(".brp-hide"); await wait(page, 1500);
    ok(hid && hid.p_group_id && hid.p_on === true, "Ta bort mig → bold_replay_hide_me", hid);
    await page.evaluate(() => window.BOLD_REPLAY.close()); await wait(page, 400);
    // morning button
    await page.evaluate(() => { const r = document.createElement("div"); r.id = "brp-row-test"; r.className = "row"; document.body.appendChild(r); window.BOLD_REPLAY.morningButton(r); });
    await wait(page, 1500);
    ok(await page.evaluate(() => /Spela gårdagens kväll/.test((document.querySelector("#brp-row-test .brp-morning") || {}).textContent || "")), "morning button: Spela gårdagens kväll");
    await ctx.close();
    ({ ctx, page } = await start(browser, false));
    ok((await page.evaluate((g) => window.BOLD_REPLAY.start(g), GID)) === false, "flag off: start() returns false (old replay)");
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bold-replay: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
