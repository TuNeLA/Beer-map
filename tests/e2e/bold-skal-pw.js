// 📸 Skåltimmen v2 (bd05, flag bold_skal_v2). Mocked Supabase (ds-helpers) + Chromium's fake camera.
// node bold-skal-pw.js <port> [shotsDir]
// Checks: the banner says "visa var ni är"; "📸 Visa" opens the in-app camera; back shot → the front camera takes the selfie by
// itself → ONE 4:5 photo in the normal preview → Skicka = skal_post; no camera → the old file picker; the same-night collage
// (tiles, "sen", Spara/Dela); the Av · Helg · Varje kväll control (chief) calls bold_skal_mode_set; flag OFF = the old flow.
process.argv[2] = process.argv[2] || "8963";
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const pw = require("playwright");
const fs = require("fs");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bold-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const PHOTO = fs.readFileSync(require("./env.js").FIX + "photo-mid.jpg").toString("base64");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const iso = (s) => new Date(Date.now() + s * 1000).toISOString();
function hour(mine) {
  return { id: 501, group_id: GID, group_name: "Ludvika Lager", auto: true, by_me: false, by: null, created_at: iso(-40), ends_at: iso(140), late_until: iso(3560),
    mine: !!mine, done: false, needed: 5, posted: mine ? 4 : 3,
    posts: [{ k: "a", name: "Lisa", is_me: false, sec: 21, in_time: true, rank: 1, photo_id: mine ? 11 : null },
      { k: "b", name: "Ida", is_me: false, sec: 58, in_time: true, rank: 2, photo_id: mine ? 12 : null },
      { k: "c", name: "Oskar", is_me: false, sec: 100, in_time: true, rank: 3, photo_id: mine ? 13 : null }].concat(mine ? [{ k: "me", name: "Anton", is_me: true, sec: 420, in_time: false, rank: 4, photo_id: 14 }] : []),
    missing: [{ k: "d", name: "Nisse" }] };
}
let posted = null, modeSet = null, mine = false, noHours = false;
async function routes(page, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|skal_poll|skal_hour|skal_post|skal_photo|skal_state|bold_skal_mode_get|bold_skal_mode_set|bold_skal_tick)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    switch (fn) {
      case "bold_flags_get": return J(r, { bold_hemlage: false, bold_krog: false, bold_skal_v2: !!flagOn, bold_replay: false, bold_bump: false });
      case "skal_poll": return J(r, { v: 1, now: new Date().toISOString(), hours: noHours ? [] : [hour(mine)], fired: [] });
      case "skal_hour": return J(r, Object.assign(hour(mine), { now: new Date().toISOString() }));
      case "skal_post": posted = { len: (body.p_b64 || "").length, w: body.p_w, h: body.p_h }; mine = true; return J(r, { photo_id: 14, in_time: true, rank: 4, hour: hour(true) });
      case "skal_photo": return J(r, { b64: PHOTO, mime: "image/jpeg" });
      case "skal_state": return J(r, { group_id: GID, can_start: true, random_on: false, used: 0, max: 4, next_at: new Date().toISOString(), now: new Date().toISOString(), hour: null });
      case "bold_skal_mode_get": return J(r, { v: 1, on: !!flagOn, mode: "off", stored: null, can_set: true });
      case "bold_skal_mode_set": modeSet = body.p_mode; return J(r, { v: 1, on: true, mode: body.p_mode, stored: body.p_mode, can_set: true });
      case "bold_skal_tick": return J(r, { v: 1, fired: [], window: true });
    }
  });
}
async function start(browser, flagOn, noCam) {
  mine = false; posted = null; modeSet = null; const nh = noHours; noHours = false; if (nh) noHours = true;
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.grantPermissions(["geolocation", "camera"]);
  if (noCam) await ctx.addInitScript(() => { try { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); } catch (e) {} });
  await routes(page, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.BOLD_SKAL && window.SKAL, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 600);
  await page.evaluate(() => { try { window.SKAL.onPoll(); } catch (e) {} }); await wait(page, 1200);
  return { ctx, page };
}
const bannerText = (page) => page.evaluate(() => { const b = document.getElementById("sk-banner"); return b && !b.hidden ? b.textContent : ""; });
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    /* ---------- flag ON ---------- */
    let { ctx, page } = await start(browser, true);
    let t = await bannerText(page);
    ok(/visa var ni är/.test(t), "banner: visa var ni är", t.slice(0, 80));
    await page.screenshot({ path: SHOTS + "skal-1-banner.png" });
    await page.evaluate(() => { const b = document.querySelector("#sk-banner [data-shoot]"); if (b) b.click(); }); await wait(page, 2500);
    ok(!!(await page.$(".bsk-cam")), "📸 Visa opens the in-app camera");
    await page.screenshot({ path: SHOTS + "skal-2-camera.png" });
    await page.click(".bsk-shut"); await wait(page, 1200);
    ok(await page.evaluate(() => { const i = document.querySelector(".bsk-inset"); return !!(i && i.classList.contains("got")); }), "back shot → selfie step (inset shows the back photo)");
    await page.screenshot({ path: SHOTS + "skal-3-selfie.png" });
    await page.waitForSelector(".sk-ov .sk-send:not([disabled])", { timeout: 15000 }).catch(() => {});
    ok(!(await page.$(".bsk-cam")) && !!(await page.$(".sk-ov")), "front camera fires by itself → the normal preview");
    const dim = await page.evaluate(() => { const i = document.querySelector(".sk-ov img.ph-prev"); return i ? [i.naturalWidth, i.naturalHeight] : null; });
    ok(dim && Math.abs(dim[0] / dim[1] - 0.8) < 0.02, "one 4:5 photo (back + selfie inset)", dim);
    await page.screenshot({ path: SHOTS + "skal-4-preview.png" });
    await page.click(".sk-ov .sk-send"); await wait(page, 2500);
    ok(posted && posted.len > 5000 && Math.abs(posted.w / posted.h - 0.8) < 0.02, "Skicka → skal_post with the composed photo", posted);
    // collage in the hour sheet (I posted → I see the others)
    await page.waitForSelector("#sheet .bsk-cv", { timeout: 15000 }).catch(() => {});
    await wait(page, 2500);
    const col = await page.evaluate(() => { const c = document.querySelector("#sheet .bsk-cv"); const b = document.querySelector("#sheet .bsk-save");
      if (!c) return null; const d = c.getContext("2d").getImageData(540, 700, 1, 1).data; return { w: c.width, h: c.height, btn: b && b.textContent, px: [d[0], d[1], d[2]] }; });
    ok(col && col.w === 1080 && col.h === 1350 && /collage/.test(col.btn || ""), "same-night collage + Spara/Dela", col);
    await page.evaluate(() => { const s = document.getElementById("sheet-body"); if (s) s.scrollTop = 0; }); await page.screenshot({ path: SHOTS + "skal-5-collage.png" });
    await wait(page, 5600);
    ok((await page.$$("#sheet .bsk-cv")).length === 1, "collage survives the 5 s refresh (one canvas, not rebuilt)");
    await page.evaluate(() => { const s = document.getElementById("sheet-close"); if (s) s.click(); }); await wait(page, 500);
    await ctx.close();
    // group mode (chief): a new page without a live skåltimme
    noHours = true; ({ ctx, page } = await start(browser, true)); noHours = true;
    await page.evaluate((gid) => { const w = document.createElement("div"); w.id = "bsk-test"; document.body.appendChild(w); window.SKAL.groupItem({ id: gid, name: "Ludvika Lager" }, w); }, GID);
    await wait(page, 1500);
    await page.evaluate(() => { const b = document.querySelector("#bsk-test .sk-gbtn"); if (b) b.click(); }); await wait(page, 1800);
    const seg = await page.evaluate(() => [...document.querySelectorAll("#sheet .bsk-seg-b")].map((b) => b.textContent + (b.getAttribute("aria-checked") === "true" ? "*" : "")));
    ok(seg.join("|") === "Av*|Helg|Varje kväll", "mode control Av · Helg · Varje kväll", seg);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet .bsk-seg-b")].find((x) => x.textContent === "Helg"); if (b) b.click(); }); await wait(page, 1200);
    ok(modeSet === "helg", "Helg → bold_skal_mode_set('helg')", modeSet);
    ok(!(await page.evaluate(() => !!document.querySelector("#sheet .sk-rnd"))), "the old 🎲 switch is replaced");
    await page.screenshot({ path: SHOTS + "skal-6-mode.png" });
    await ctx.close();
    /* ---------- no camera → the old file picker ---------- */
    noHours = false; ({ ctx, page } = await start(browser, true, true));
    await page.evaluate(() => { window.__picked = 0; HTMLInputElement.prototype.click = function () { if (this.type === "file") window.__picked++; }; });
    await page.evaluate(() => { const b = document.querySelector("#sk-banner [data-shoot]"); if (b) b.click(); }); await wait(page, 1500);
    ok((await page.evaluate(() => window.__picked)) === 1 && !(await page.$(".bsk-cam")), "no camera → the old file picker");
    await ctx.close();
    /* ---------- flag OFF = old behaviour ---------- */
    ({ ctx, page } = await start(browser, false));
    t = await bannerText(page);
    ok(/visa din dricka/.test(t), "flag off: the old banner copy", t.slice(0, 80));
    await page.evaluate(() => { window.__picked = 0; HTMLInputElement.prototype.click = function () { if (this.type === "file") window.__picked++; }; });
    await page.evaluate(() => { const b = document.querySelector("#sk-banner [data-shoot]"); if (b) b.click(); }); await wait(page, 1200);
    ok((await page.evaluate(() => window.__picked)) === 1 && !(await page.$(".bsk-cam")), "flag off: the old file picker");
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bold-skal: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
