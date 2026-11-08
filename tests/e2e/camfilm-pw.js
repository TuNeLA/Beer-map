// 🎞️ FILMRULLAR + SPARA ALLA Playwright test (mocked server). Usage: node camfilm-pw.js <port> [shots-dir]
// FILMFX unit (6 films, WebGL, sizes, EXIF strip, ZIP, names) · camera sheet film card + picker (one amber, previews,
// film_set_stock, locked) · a real in-app shot (fake camera) gets the night's film · album: film name, save card,
// film_save_list filter, iPhone share (10 per tap), Android downloads, computer ZIP, viewer save, cam=save deep link, pnlog.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8877;
const SHOTS = (process.argv[3] || SP + "ui-testshots/").replace(/\/?$/, "/"); fs.mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const E = (r, code) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: code }) });
const G = "11111111-2222-3333-4444-555555555555";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const shot = (page, n, o) => page.screenshot(Object.assign({ path: SHOTS + n + ".png" }, o || {})).then(() => console.log("shot " + SHOTS + n + ".png"));
const nightEnd = () => { const d = new Date(); d.setDate(d.getDate() + (d.getHours() >= 5 ? 1 : 0)); d.setHours(5, 0, 0, 0); return d.toISOString(); };
const NIGHT_PAST = "2026-11-08T04:00:00.000Z";
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const DESK_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

async function extra(page, log, o) {
  await page.route(/rest\/v1\/rpc\/(film_poll|film_state|film_stock|film_set_stock|film_shoot|film_roll|film_photo|film_save_list|film_react|film_report|film_remove)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, fn === "film_shoot" ? { p_group_id: body.p_group_id, w: body.p_w, h: body.p_h, n: (body.p_b64 || "").length } : body]);
    if (fn === "film_shoot") o.shots.push(body.p_b64);
    if (fn === "film_poll") return J(r, { v: 2, now: new Date().toISOString(), night: nightEnd(), develop_at: nightEnd(), groups: [], rolls: [] });
    if (fn === "film_state" && o.state !== undefined) return J(r, o.state);
    if (fn === "film_state") return J(r, { now: new Date().toISOString(), night: nightEnd(), develop_at: nightEnd(), mine: 0, left: 10, max: 10, group_n: o.locked ? 3 : 0, group_max: 60, shooters: o.locked ? 1 : 0, keeps: false,
      rolls: [{ night: NIGHT_PAST, evening: "2026-11-07", develop_at: NIGHT_PAST, n: 12, alive: 12 }] });
    if (fn === "film_stock") return J(r, { night: nightEnd(), film: o.film || null, locked: !!o.locked, nights: [{ night: NIGHT_PAST, film: "retro" }] });
    if (fn === "film_set_stock") { if (o.setLocked) return E(r, "film_locked"); o.film = body.p_film; return J(r, { night: nightEnd(), film: body.p_film, locked: false }); }
    if (fn === "film_shoot") return J(r, { left: 9, mine: 1, group_n: 1, develop_at: nightEnd(), night: nightEnd() });
    if (fn === "film_roll") return J(r, { night: NIGHT_PAST, evening: "2026-11-07", develop_at: NIGHT_PAST, developed: true, n: o.photos.length, gone: 0, expires_at: "2026-11-15T09:00:00Z",
      photos: o.photos.map((b, i) => ({ id: 900 + i, k: "k" + (i % 3), name: ["Lisa", "Oskar", "Anton"][i % 3], is_me: i % 3 === 2, at: new Date(Date.parse("2026-11-07T21:00:00Z") + i * 9e5).toISOString(), w: 1024, h: 768, reacts: [], n: 0, my: null })) });
    if (fn === "film_photo") { const i = body.p_photo_id - 900; return J(r, { id: body.p_photo_id, mime: "image/jpeg", w: 1024, h: 768, b64: o.photos[i] }); }
    if (fn === "film_save_list") return J(r, { night: NIGHT_PAST, developed: true, evening: "2026-11-07", group_name: "Ludvika Lager", film: "retro",
      photos: o.photos.map((b, i) => ({ id: 900 + i, w: 1024, h: 768 })).filter((p) => p.id !== 905) });   // 905: blocked author → not saved
    if (fn === "film_report" || fn === "film_remove") return J(r, { ok: true, id: body.p_photo_id });
    return J(r, {});
  });
}
async function spies(page) {
  await page.addInitScript(() => {
    window.__dl = []; window.__share = []; window.__ev = [];
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; } return oc.apply(this, arguments); };
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = (d) => { window.__share.push((d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
    const hook = () => { if (window.PNLOG && !window.PNLOG.__spy) { const e = window.PNLOG.event; window.PNLOG.event = function (n, p) { window.__ev.push([n, p]); return e.apply(this, arguments); }; window.PNLOG.__spy = 1; } else setTimeout(hook, 200); };
    hook();
  });
}
// the film card has its film_stock answer (slow CI machines: up to 60 s)
const stOk = (page) => page.waitForFunction(() => { const f = document.querySelector('#sheet-body .fm-film[data-st="ok"]'); return !!f; }, null, { timeout: 60000 }).then(() => wait(page, 300), () => console.log("no film_stock answer in 60 s"));
const sheetInfo = (page) => page.evaluate(() => {
  const b = document.getElementById("sheet-body"), vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  return { title: document.getElementById("sheet-title").textContent, amber: [...b.querySelectorAll(".btn-amber")].filter(vis).map((x) => x.textContent.trim()),
    sw: document.documentElement.scrollWidth, iw: innerWidth };
});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    args: ["--ignore-certificate-errors", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const errs = [];
  let PHOTOS = [];
  try {
    { // A) FILMFX unit + fixture photos (procedural scenes, developed with the films; one gets a fake EXIF/GPS segment)
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, { shots: [], photos: [] }); await boot(page);
      const u = await page.evaluate(async () => {
        const F = window.FILMFX, out = { n: F.STOCKS.length, def: F.DEFAULT, names: F.STOCKS.map((s) => s.sv), gl: F.gl() };
        const src = F.sample(1600, 1200, "kvall"), b64 = (b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.readAsDataURL(b); });
        out.dev = [];
        for (const s of F.STOCKS) { const d = await F.develop(src, s.id, { seed: 3, at: Date.parse("2026-11-07T23:10:00"), quiet: 1 }); const u8 = new Uint8Array(await d.blob.arrayBuffer());
          let app1 = false; for (let i = 2; i < 200; i++) if (u8[i] === 0xFF && u8[i + 1] === 0xE1) app1 = true;
          out.dev.push({ id: s.id, w: d.w, h: d.h, kb: Math.round(d.blob.size / 1024), how: d.how, app1, ms: d.ms }); }
        // render size + B&W check
        const bw = F.render(F.sample(320, 240, "ute"), "svartvit", { max: 320, seed: 1 }), px = bw.getContext("2d").getImageData(100, 100, 1, 1).data;
        out.bw = Math.abs(px[0] - px[1]) + Math.abs(px[1] - px[2]);
        const warm = F.render(F.sample(320, 240, "ute"), "kvall", { max: 320, seed: 1 }), pw = warm.getContext("2d").getImageData(160, 30, 1, 1).data, po = F.sample(320, 240, "ute").getContext("2d").getImageData(160, 30, 1, 1).data;
        out.warm = [pw[0] - pw[2], po[0] - po[2]];
        // EXIF strip
        const j = new Uint8Array(await (await new Promise((ok) => F.sample(64, 48, "natt").toBlob(ok, "image/jpeg", 0.8))).arrayBuffer());
        const exif = new TextEncoder().encode("Exif\0\0GPSLatitude=60.15;GPSLongitude=15.18"), seg = new Uint8Array(4 + exif.length);
        seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (exif.length + 2) >> 8; seg[3] = (exif.length + 2) & 255; seg.set(exif, 4);
        const withExif = new Uint8Array(j.length + seg.length); withExif.set(j.subarray(0, 2)); withExif.set(seg, 2); withExif.set(j.subarray(2), 2 + seg.length);
        const st = F.stripJpeg(withExif), txt = new TextDecoder("latin1").decode(st);
        out.strip = { before: withExif.length, after: st.length, orig: j.length, gps: /GPS/.test(txt) };
        // ZIP
        const z = new Uint8Array(await F.zip([{ name: "PintsNow_2026-11-07_Ludvika_01.jpg", data: j }, { name: "PintsNow_2026-11-07_Ludvika_02.jpg", data: st }]).arrayBuffer());
        const dv = new DataView(z.buffer), eo = z.length - 22;
        out.zip = { sig: dv.getUint32(eo, true) === 0x06054b50, n: dv.getUint16(eo + 10, true), crc: dv.getUint32(14, true) === F.crc32(j), first: new TextDecoder().decode(z.subarray(30, 30 + dv.getUint16(26, true))) };
        out.name = F.fileName("2026-11-07", "Ludvika Lager", 1) + " " + F.fileName("2026-11-07", "Åre Öl & Co", 12);
        // fixtures: 12 developed photos (3 scenes, the retro film), #3 with fake EXIF
        const ph = [];
        for (let i = 0; i < 12; i++) { const d = await F.develop(F.sample(1024, 768, ["kvall", "ute", "natt"][i % 3]), "retro", { seed: i, at: Date.parse("2026-11-07T22:00:00"), quiet: 1 });
          let u8 = new Uint8Array(await d.blob.arrayBuffer());
          if (i === 3) { const w = new Uint8Array(u8.length + seg.length); w.set(u8.subarray(0, 2)); w.set(seg, 2); w.set(u8.subarray(2), 2 + seg.length); u8 = w; }
          let s = ""; for (let k = 0; k < u8.length; k += 32768) s += String.fromCharCode.apply(null, u8.subarray(k, k + 32768)); ph.push(btoa(s)); }
        out.ph = ph;
        return out;
      });
      PHOTOS = u.ph; u.ph = undefined;
      ok("FILMFX: 6 films, default kvall (Kvällsljus 400)", u.n === 6 && u.def === "kvall" && u.names[0] === "Kvällsljus 400", u.names);
      ok("FILMFX: WebGL path is used", u.gl && u.dev.every((d) => d.how === "gl"), u.dev.map((d) => d.how));
      ok("develop: 1600 px in → long side 1024, ≤ 158 kB (server limit), no APP1/EXIF", u.dev.every((d) => d.w === 1024 && d.h === 768 && d.kb <= 154 && !d.app1), u.dev);
      ok("Svartvit Klassiker is grey (r=g=b)", u.bw <= 3, u.bw);
      ok("Kvällsljus is warmer than the original (r−b up)", u.warm[0] > u.warm[1], u.warm);
      ok("stripJpeg removes the EXIF/GPS segment, keeps the image", !u.strip.gps && u.strip.after === u.strip.orig, u.strip);
      ok("ZIP writer: valid end record, 2 files, CRC, UTF-8 name", u.zip.sig && u.zip.n === 2 && u.zip.crc && u.zip.first === "PintsNow_2026-11-07_Ludvika_01.jpg", u.zip);
      ok("file names PintsNow_<date>_<group>_<NN>.jpg (ASCII)", u.name === "PintsNow_2026-11-07_LudvikaLager_01.jpg PintsNow_2026-11-07_AreOlCo_12.jpg", u.name);
      console.log("perf (this machine, SwiftShader GL): develop ms per film", JSON.stringify(u.dev.map((d) => [d.id, d.ms, d.kb + "kB"])));
      await ctx.close();
    }
    { // B) camera sheet: film card, picker (previews, one amber), film_set_stock, a real shot gets the film
      const log = [], o = { shots: [], photos: PHOTOS }; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      await ctx.grantPermissions(["camera", "geolocation"]);
      await extra(page, log, o); await spies(page); await boot(page);
      await page.evaluate(() => { try { localStorage.setItem("olnu.fmCamOk", "1"); } catch (e) {} document.querySelectorAll(".toast").forEach((t) => t.remove()); });
      await page.evaluate((G) => window.FILM.openCam({ id: G, name: "Ludvika Lager" }), G); await stOk(page);
      const card = await page.evaluate(() => { const f = document.querySelector("#sheet-body .fm-film"); return f && { text: f.textContent, btn: !f.querySelector(".fm-film-b").hidden, brand: document.querySelector("#sheet-body .fm-brand").textContent }; });
      ok("camera sheet: 'Film ikväll · Kvällsljus 400' + 'Byt film' (not locked)", card && /Film ikväll/.test(card.text) && /Kvällsljus 400/.test(card.text) && card.btn, card);
      ok("viewfinder brand shows the film", card && /Kvällsljus 400/.test(card.brand), card && card.brand);
      ok("film_stock asked for the group", log.some((x) => x[0] === "film_stock" && x[1].p_group_id === G));
      await page.evaluate(() => document.querySelector("#sheet-body .fm-film-b").click()); await wait(page, 900);
      const pk = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .fm-st")].map((b) => {
        const c = b.querySelector("canvas.fm-st-pv"); let lit = 0; if (c) { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 400) lit += d[i] + d[i + 1] + d[i + 2] > 60 ? 1 : 0; }
        const r = b.getBoundingClientRect(); return { film: b.dataset.film, checked: b.getAttribute("aria-checked"), lit, h: Math.round(r.height), name: b.querySelector("b").textContent }; }));
      ok("picker: 6 films with live previews (canvas, not blank), Kvällsljus checked", pk.length === 6 && pk.every((p) => p.lit > 20) && pk[0].checked === "true", pk);
      ok("picker: names Kvällsljus 400 · Midsommar 200 · Fjällgrön 160 · Svartvit Klassiker · Blixt-fest 800 · Retro 1998", pk.map((p) => p.name).join("|") === "Kvällsljus 400|Midsommar 200|Fjällgrön 160|Svartvit Klassiker|Blixt-fest 800|Retro 1998", pk.map((p) => p.name));
      ok("picker: items ≥ 44 px", pk.every((p) => p.h >= 44), pk.map((p) => p.h));
      let si = await sheetInfo(page);
      ok("picker open: ONE amber in the sheet ('Ladda Kvällsljus 400'), no side scroll", si.amber.length === 1 && /Ladda Kvällsljus 400/.test(si.amber[0]) && si.sw <= si.iw, si);
      await page.evaluate(() => document.querySelector('#sheet-body .fm-st[data-film="svartvit"]').click()); await wait(page, 300);
      await page.evaluate(() => document.querySelector("#sheet-body .fm-pick").scrollIntoView({ block: "start" })); await wait(page, 400);
      await shot(page, "camfilm-picker-390");
      si = await sheetInfo(page);
      ok("select Svartvit → 'Ladda Svartvit Klassiker'", /Ladda Svartvit Klassiker/.test(si.amber[0] || ""), si.amber);
      await page.evaluate(() => document.querySelector("#sheet-body .fm-pick-go").click()); await wait(page, 900);
      const set = log.filter((x) => x[0] === "film_set_stock").pop();
      const after = await page.evaluate((G) => ({ roll: window.FILMFX.rollOf(G), name: document.querySelector("#sheet-body .fm-film-n").textContent, open: !document.querySelector("#sheet-body .fm-pick").hidden, ev: window.__ev.filter((e) => e[0] === "cam.film_set") }), G);
      ok("Ladda → film_set_stock {p_film:'svartvit'}; card + FILMFX roll updated; picker closes; pnlog cam.film_set", set && set[1].p_film === "svartvit" && after.roll === "svartvit" && /Svartvit/.test(after.name) && !after.open && after.ev.length === 1, [set, after]);
      // a real in-app shot (fake camera): the upload is B&W
      await page.evaluate(() => document.querySelector("#sheet-body .fm-vf").scrollIntoView({ block: "center" })); await wait(page, 600);
      const live = await page.waitForFunction(() => { const v = document.querySelector("#sheet-body .fm-vf video"); return v && v.videoWidth > 0; }, null, { timeout: 8000 }).then(() => true, () => false);
      ok("fake camera runs in the sheet viewfinder", live);
      await shot(page, "camfilm-camera-390");
      if (live) {
        // ux2: the camera rules come BEFORE the first shot (the first tap shows them and takes no photo)
        await page.evaluate(() => { try { localStorage.removeItem("olnu.fmRules"); } catch (e) {} document.querySelector("#sheet-body .fm-shutter").click(); }); await wait(page, 700);
        const rc = await page.evaluate(() => { const c = document.querySelector(".fc-rules .fc-r-card"); return c && { t: c.textContent, amber: c.querySelectorAll(".btn-amber").length }; });
        ok("first shutter tap → 'Så funkar engångskameran' (gänget, i morgon kl, ta bort/anmäl, GPS), one amber, NO photo yet",
          rc && /Så funkar engångskameran/.test(rc.t) && /Bara gänget/.test(rc.t) && /i morgon kl/.test(rc.t) && /anmäla/.test(rc.t) && /GPS/.test(rc.t) && rc.amber === 1 && o.shots.length === 0 && !log.some((x) => x[0] === "film_shoot"), rc);
        await shot(page, "camfilm-rules-390");
        await page.evaluate(() => document.querySelector(".fc-rules .fc-r-ok").click()); await wait(page, 600);
        await page.evaluate(() => { const a = document.querySelector(".sf-accept"); if (a) a.click(); }); await wait(page, 500);
        ok("'Jag förstår' → saved (olnu.fmRules=1), card gone, still no photo", await page.evaluate(() => localStorage.getItem("olnu.fmRules") === "1" && !document.querySelector(".fc-rules")) && o.shots.length === 0);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-shutter").click());
        ok("2nd tap shoots, no rules card again", await page.evaluate(() => !document.querySelector(".fc-rules")));
        await page.waitForFunction(() => window.FILMFX.last() && window.FILMFX.last().film === "svartvit", null, { timeout: 8000 }).catch(() => {});
        for (let i = 0; i < 120 && !o.shots.length; i++) await wait(page, 500);   // develop + upload (slow CI: up to 60 s)
        const last = await page.evaluate(() => window.FILMFX.last());
        ok("shot developed with the night's film (svartvit), ≤ 1024 px", last && last.film === "svartvit" && Math.max(last.w, last.h) <= 1024, last);
        ok("film_shoot got the developed copy", o.shots.length === 1, log.filter((x) => x[0] === "film_shoot"));
        if (o.shots[0]) {
          const g = await page.evaluate(async (b64) => { const im = new Image(); im.src = "data:image/jpeg;base64," + b64; await im.decode(); const c = document.createElement("canvas"); c.width = 64; c.height = 48; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 64, 48); const d = x.getImageData(0, 0, 64, 48).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])); return { m, w: im.naturalWidth }; }, o.shots[0]);
          ok("uploaded photo is grey (B&W film) – the colour original stayed on the phone", g.m <= 14, g);
        }
        ok("pnlog cam.fx perf event", await page.evaluate(() => window.__ev.some((e) => e[0] === "cam.fx" && e[1].film === "svartvit" && e[1].ms > 0)));
      }
      // ux2: a friend alert toast must not cover the shutter: it waits while the camera is open, shows after
      await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); const t = document.createElement("div"); t.className = "toast err"; t.textContent = "🚑 Kolla till Oskar"; document.getElementById("toasts").appendChild(t); }); await wait(page, 400);
      const h1 = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent));
      ok("camera open: the friend alert toast waits (not on screen)", !h1.some((t) => /Oskar/.test(t)), h1);
      await page.evaluate(() => document.getElementById("sheet-close").click());
      let h2 = []; for (let i = 0; i < 30 && !h2.some((t) => /Oskar/.test(t)); i++) { await wait(page, 500); h2 = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent)); }
      ok("camera closed: the waiting toast shows", h2.some((t) => /Kolla till Oskar/.test(t)), h2);
      await ctx.close();
    }
    { // C) locked night + a late change that loses the race
      const log = [], o = { shots: [], photos: PHOTOS, locked: true, film: "blixt" }; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, o); await boot(page);
      await page.evaluate((G) => window.FILM.openCam({ id: G, name: "Ludvika Lager" }), G); await stOk(page);
      const c = await page.evaluate(() => { const f = document.querySelector("#sheet-body .fm-film"); return { t: f.textContent, btn: !f.querySelector(".fm-film-b").hidden, rolls: [...document.querySelectorAll("#sheet-body .fm-roll-btn")].map((b) => b.textContent) }; });
      console.log("C log", JSON.stringify(log.map((x) => x[0])));
      ok("locked: 'Blixt-fest 800 · Låst', no 'Byt film'", /Blixt-fest 800/.test(c.t) && /Låst/.test(c.t) && !c.btn, c);
      ok("developed rolls list the film ('… · Retro 1998')", c.rolls.length === 1 && /Retro 1998/.test(c.rolls[0]), c.rolls);
      await ctx.close();
      const log2 = [], o2 = { shots: [], photos: PHOTOS, setLocked: true }; const s2 = await ctxFor(browser, { width: 390, height: 844 }); s2.page.on("pageerror", (e) => errs.push(e.message));
      await extra(s2.page, log2, o2); await boot(s2.page);
      await s2.page.evaluate((G) => window.FILM.openCam({ id: G, name: "Ludvika Lager" }), G); await stOk(s2.page);
      await s2.page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); document.querySelector("#sheet-body .fm-film-b").click(); }); await wait(s2.page, 600);
      await s2.page.evaluate(() => { document.querySelector('#sheet-body .fm-st[data-film="retro"]').click(); document.querySelector("#sheet-body .fm-pick-go").click(); }); await wait(s2.page, 1200);
      const t = await s2.page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "));
      for (let i = 0; i < 20 && log2.filter((x) => x[0] === "film_stock").length < 2; i++) await wait(s2.page, 500);
      ok("film_locked from the server → clear toast, the picker closes, the film is asked again", /låst/i.test(t) && log2.filter((x) => x[0] === "film_stock").length >= 2 && await s2.page.evaluate(() => document.querySelector("#sheet-body .fm-pick").hidden), [t, log2.map((x) => x[0])]);
      await s2.ctx.close();
    }
    { // G) public hooks for other modules: FILMCAM.capture (Skåltimmen: back + selfie, no roll shot) and FILM.albumExtra
      const log = [], o = { shots: [], photos: PHOTOS }; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      await ctx.grantPermissions(["camera", "geolocation"]);
      await extra(page, log, o); await boot(page);
      const api = await page.evaluate(() => ({ cap: typeof window.FILMCAM.capture, stub: !!window.FILMCAM._stub, ae: typeof window.FILM.albumExtra, q: Array.isArray(window.FILM_EXTRAS) }));
      ok("API: FILMCAM.capture + FILM.albumExtra + window.FILM_EXTRAS (real modules, not stubs)", api.cap === "function" && !api.stub && api.ae === "function" && api.q, api);
      await page.evaluate(() => { window.__cap = null; window.FILMCAM.capture({ second: true, film: "blixt", label: "1/2 · Bakkameran: visa var ni är" }).then((r) => { window.__cap = { w: r.w, h: r.h, film: r.film, type: r.blob.type, kb: Math.round(r.blob.size / 1024), second: r.second && { w: r.second.w, type: r.second.blob.type, facing: r.second.facing }, facing: r.facing }; }, (e) => { window.__cap = { err: e.message }; }); });
      const sh = () => page.waitForFunction(() => { const b = document.querySelector(".fc-cap .fc-shutter"); return b && !b.disabled; }, null, { timeout: 30000 }).then(() => true, () => false);
      const s1 = await sh(); const lab1 = await page.evaluate(() => (document.querySelector(".fc-cap .fc-cap-l") || {}).textContent);
      await shot(page, "camfilm-capture-390");
      await page.evaluate(() => document.querySelector(".fc-cap .fc-shutter").click()); await wait(page, 600);
      const lab2 = await page.evaluate(() => (document.querySelector(".fc-cap .fc-cap-l") || {}).textContent);
      const s2 = await sh(); await page.evaluate(() => document.querySelector(".fc-cap .fc-shutter").click());
      await page.waitForFunction(() => window.__cap, null, { timeout: 30000 }).catch(() => {});
      const cap = await page.evaluate(() => window.__cap);
      ok("capture: label 1/2 → '2/2 · Selfie!' after the back shot", s1 && s2 && /1\/2/.test(lab1) && /2\/2 · Selfie!/.test(lab2), [lab1, lab2]);
      ok("capture → {blob jpeg ≤1024, film blixt, second {jpeg, user}}; overlay closed", cap && cap.type === "image/jpeg" && Math.max(cap.w, cap.h) <= 1024 && cap.film === "blixt" && cap.second && cap.second.type === "image/jpeg" && cap.second.facing === "user"
        && await page.evaluate(() => !document.querySelector(".fc-cap")), cap);
      ok("capture without useRoll spends no film shot (no film_shoot)", !log.some((x) => x[0] === "film_shoot"));
      await page.evaluate(() => { window.__cap = null; window.FILMCAM.capture({}).then(() => {}, (e) => { window.__cap = { err: e.message }; }); }); await sh();
      await page.evaluate(() => document.querySelector(".fc-cap .fc-x").click()); await wait(page, 400);
      ok("capture: ✕ → rejects Error('cancel')", (await page.evaluate(() => window.__cap)).err === "cancel");
      await page.evaluate(() => window.FILM.albumExtra((c) => { const t = document.createElement("button"); t.className = "btn btn-ghost btn-block test-replay"; t.textContent = "▶ Kvällsrepris · " + c.photos.length + " · " + c.g.id.slice(0, 4); c.slot.appendChild(t); }));
      await page.evaluate((G) => window.FILM.openRoll({ id: G, name: "Ludvika Lager" }, "2026-11-08T04:00:00.000Z"), G);
      await page.waitForFunction(() => document.querySelector("#sheet-body .test-replay"), null, { timeout: 30000 }).catch(() => {});
      const tile = await page.evaluate(() => { const t = document.querySelector("#sheet-body .test-replay"), h = document.querySelector("#sheet-body .fm-dev-head"), st = document.querySelector("#sheet-body .fm-strip");
        return t && { text: t.textContent, beforeStrip: !!(st && (t.compareDocumentPosition(st) & 4)), afterHead: !!(h && (h.compareDocumentPosition(t) & 4)) }; });
      ok("albumExtra: the tile shows at the top of the album (after the head, before the photos) with ctx.photos", tile && /Kvällsrepris · 12 · 1111/.test(tile.text) && tile.beforeStrip && tile.afterHead, tile);
      await ctx.close();
    }
    // E) ux2 review: "Filmen slut · 00" with 0 photos. A new group (real server shape) and a counter-less answer ([] / {})
    //    must both start with a full roll: "10 bilder kvar", LCD 10, shutter on, no "Filmen slut".
    for (const [nm, st] of [["new group (server shape)", { now: new Date().toISOString(), night: nightEnd(), develop_at: nightEnd(), mine: 0, left: 10, max: 10, group_n: 0, group_max: 60, shooters: 0, keeps: false, rolls: [] }],
      ["answer [] (the review mock)", []], ["answer {}", {}], ["only mine:3", { mine: 3 }]]) {
      const log = [], o = { shots: [], photos: PHOTOS, state: st }; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, o); await boot(page);
      await page.evaluate((G) => window.FILM.openCam({ id: G, name: "Nya gänget" }), G); await stOk(page);
      const c = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return { left: (b.querySelector(".fm-left") || {}).textContent, lcd: (b.querySelector(".fm-lcd b") || {}).textContent,
        dis: (b.querySelector(".fm-shutter") || {}).disabled, empty: /Filmen (ä )?slut|FILMEN SLUT/.test(b.textContent), frames: b.querySelectorAll(".fm-fr:not(.used)").length }; });
      const want = nm === "only mine:3" ? 7 : 10;
      ok("counter: " + nm + " → '" + want + " bilder kvar', LCD " + want + ", shutter on, no 'Filmen slut'", c.left === want + " bilder kvar" && +c.lcd === want && !c.dis && !c.empty && c.frames === want, c);
      if (nm === "answer [] (the review mock)") await shot(page, "camfilm-newgroup-390");
      await ctx.close();
    }
    // D) album + save: iPhone (share), Android (downloads), computer (ZIP)
    for (const plat of ["ios", "android", "desk"]) {
      const log = [], o = { shots: [], photos: PHOTOS };
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push(e.message));
      if (plat !== "android") await page.addInitScript((ua) => { Object.defineProperty(navigator, "userAgent", { get: () => ua }); if (/X11/.test(ua)) Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 }); }, plat === "ios" ? IOS_UA : DESK_UA);
      await extra(page, log, o); await spies(page); await boot(page);
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      if (plat === "ios") {   // the push hook: ?film=<gid>&cam=save
        await page.evaluate((G) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: "/?film=" + G + "&cam=save" } })), G);
      } else await page.evaluate((G) => window.FILM.openRoll({ id: G, name: "Ludvika Lager" }, "2026-11-08T04:00:00.000Z"), G);
      await page.waitForFunction(() => { const b = document.querySelector("#sheet-body .fm-save-all"); return b && !b.disabled; }, null, { timeout: 60000 }).catch(() => {});
      await wait(page, 600);
      const a = await page.evaluate(() => { const c = document.querySelector("#sheet-body .fm-save"); const vis = (e) => e && e.getClientRects().length > 0;
        return c && { t: c.querySelector(".fm-save-t").textContent, b: c.querySelector(".fm-save-all").textContent, amber: c.querySelector(".fm-save-all").classList.contains("btn-amber"), hint: c.querySelector(".fm-save-s").textContent,
          alt: vis(c.querySelector(".fm-save-alt")), focus: c.classList.contains("focus"), film: (document.querySelector("#sheet-body .fm-dev-f") || {}).textContent, edge: (document.querySelector("#sheet-body .fm-edge") || {}).textContent,
          ambers: [...document.querySelectorAll("#sheet-body .btn-amber")].filter(vis).length }; });
      ok(plat + ": save card 'Bilderna från igår är framkallade 📸 – vill du spara dem?' + 'Spara alla (11)' (blocked photo left out)", a && /Bilderna från igår är framkallade 📸 – vill du spara dem\?/.test(a.t) && /Spara alla \(11\)/.test(a.b) && a.amber && a.ambers === 1, a);
      ok(plat + ": album shows the film ('Film: Retro 1998', edge '1A ▸ Retro 1998')", a && /Retro 1998/.test(a.film) && /1A ▸ Retro 1998/.test(a.edge), a && [a.film, a.edge]);
      if (plat === "ios") {
        ok("ios: deep link cam=save opens the album with the save card in focus", a && a.focus, a);
        ok("ios: hint says 'Spara 10 bilder' → Bilder, max 10", a && /Spara 10 bilder/.test(a.hint) && /Bilder/.test(a.hint), a && a.hint);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-save").scrollIntoView({ block: "start" })); await wait(page, 400);
        await shot(page, "camfilm-album-save-390");
        await page.evaluate(() => document.querySelector("#sheet-body .fm-save-all").click()); await wait(page, 800);
        let s = await page.evaluate(() => ({ share: window.__share, b: document.querySelector("#sheet-body .fm-save-all").textContent }));
        ok("ios: tap 1 → navigator.share with 10 JPEG files, names _01…_10", s.share.length === 1 && s.share[0].length === 10 && s.share[0][0].name === "PintsNow_2026-11-07_LudvikaLager_01.jpg" && s.share[0].every((f) => f.type === "image/jpeg"), s);
        ok("ios: then 'Spara nästa 1 (11–11)'", /Spara nästa 1 \(11–11\)/.test(s.b), s.b);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-save-all").click()); await wait(page, 800);
        s = await page.evaluate(() => ({ share: window.__share, t: document.querySelector("#sheet-body .fm-save-t").textContent, ev: window.__ev.filter((e) => e[0] === "cam.save") }));
        ok("ios: tap 2 → the last file (_11); 'Klart! 11 bilder sparade.'", s.share.length === 2 && s.share[1].length === 1 && s.share[1][0].name === "PintsNow_2026-11-07_LudvikaLager_11.jpg" && /Klart! 11 bilder sparade/.test(s.t), s);
        ok("ios: pnlog cam.save {count 10, share} + {count 1, share}", s.ev.length === 2 && s.ev[0][1].count === 10 && s.ev[0][1].method === "share" && s.ev[1][1].count === 1, s.ev);
        await shot(page, "camfilm-album-saved-390");
      }
      if (plat === "android") {
        ok("android: hint 'Galleriet (mappen Download)' + 'Dela till en app istället'", a && /Galleriet/.test(a.hint) && a.alt, a);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-save-all").click()); await wait(page, 11 * 350 + 1200);
        const d = await page.evaluate(() => ({ dl: window.__dl.map((x) => x.name), ev: window.__ev.filter((e) => e[0] === "cam.save") }));
        ok("android: 11 downloads, PintsNow_2026-11-07_LudvikaLager_01…11.jpg, no 905", d.dl.length === 11 && d.dl[0] === "PintsNow_2026-11-07_LudvikaLager_01.jpg" && d.dl[10] === "PintsNow_2026-11-07_LudvikaLager_11.jpg", d.dl);
        ok("android: pnlog cam.save {count 11, method files}", d.ev.length === 1 && d.ev[0][1].count === 11 && d.ev[0][1].method === "files", d.ev);
        // the 4th photo had a fake EXIF/GPS block: the saved file has none
        const gps = await page.evaluate(async () => { const x = window.__dl[3]; const b = await (await fetch(x.href)).arrayBuffer(); return /GPS|Exif/.test(new TextDecoder("latin1").decode(new Uint8Array(b))); });
        ok("android: saved file 04 has no EXIF/GPS (stripped)", !gps);
        // viewer: one photo
        await page.evaluate(() => document.querySelector("#sheet-body .fm-shot img").click()); await wait(page, 900);
        await page.evaluate(() => document.querySelector(".fm-view .ph-save").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await wait(page, 800);
        const v = await page.evaluate(() => ({ dl: window.__dl.slice(11).map((x) => x.name), ev: window.__ev.filter((e) => e[0] === "cam.save").slice(1) }));
        ok("android: viewer 'Spara' → one download with the PintsNow name, cam.save {1, single}", v.dl.length === 1 && v.dl[0] === "PintsNow_2026-11-07_LudvikaLager_01.jpg" && v.ev[0] && v.ev[0][1].method === "single", v);
        await shot(page, "camfilm-viewer-390");
        const va = await page.evaluate(() => ({ rep: !!document.querySelector(".fm-view .fm-v-rep"), rm: !!document.querySelector(".fm-view .fm-v-rm") }));
        ok("viewer on Lisa's photo: 'Anmäl' (flag), no 'Ta bort'", va.rep && !va.rm, va);
        await page.evaluate(() => document.querySelector(".fm-view .fm-v-rep").click()); await wait(page, 500);
        await shot(page, "camfilm-report-390");
        await page.evaluate(() => [...document.querySelectorAll(".fm-mini .btn")].find((b) => /Hot eller kränkning/.test(b.textContent)).click()); await wait(page, 900);
        const rp = await page.evaluate(() => ({ hidden: document.querySelectorAll("#sheet-body .fm-frame")[0].hidden, view: !!document.querySelector(".fm-view"), ls: localStorage.getItem("olnu.filmRep") }));
        const rpc = log.filter((x) => x[0] === "film_report").pop();
        ok("Anmäl → film_report {900, hot}; viewer closes; the photo is hidden for me", rpc && rpc[1].p_photo_id === 900 && rpc[1].p_reason === "hot" && rp.hidden && !rp.view && /900/.test(rp.ls), [rpc, rp]);
        await page.evaluate(() => document.querySelectorAll("#sheet-body .fm-shot")[2].click()); await wait(page, 900);
        ok("viewer on my own photo: 'Ta bort'", await page.evaluate(() => !!document.querySelector(".fm-view .fm-v-rm")));
        await page.evaluate(() => document.querySelector(".fm-view .fm-v-rm").click()); await wait(page, 400);
        await page.evaluate(() => [...document.querySelectorAll(".fm-mini .btn")].find((b) => /Ta bort för alla/.test(b.textContent)).click()); await wait(page, 900);
        const rm = log.filter((x) => x[0] === "film_remove").pop();
        ok("Ta bort → film_remove {902}; the frame goes", rm && rm[1].p_photo_id === 902 && await page.evaluate(() => document.querySelectorAll("#sheet-body .fm-frame")[2].hidden), rm);
      }
      if (plat === "desk") {
        ok("computer: hint 'ZIP-fil'", a && /ZIP/.test(a.hint), a && a.hint);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-save-all").click()); await wait(page, 1500);
        const z = await page.evaluate(async () => { const x = window.__dl[0]; if (!x) return null; const u8 = new Uint8Array(await (await fetch(x.href)).arrayBuffer()); const dv = new DataView(u8.buffer), eo = u8.length - 22;
          return { name: x.name, n: dv.getUint16(eo + 10, true), gps: /GPSLat/.test(new TextDecoder("latin1").decode(u8)), ev: window.__ev.filter((e) => e[0] === "cam.save") }; });
        ok("computer: one ZIP PintsNow_2026-11-07.zip with 11 photos, no GPS inside; cam.save {11, zip}", z && z.name === "PintsNow_2026-11-07.zip" && z.n === 11 && !z.gps && z.ev[0][1].method === "zip", z);
      }
      await ctx.close();
    }
    ok("no page errors", errs.length === 0, errs);
  } catch (e) { console.log("ERROR", e.stack || e); fail++; }
  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
