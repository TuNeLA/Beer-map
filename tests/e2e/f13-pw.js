// f13 (owner 13 Nov 2026): the Fredag 13 badge above ÖL! is a small SVG scene (black cat with amber eyes + crystal ball), not emoji.
//   date mocked to Fri 13 Nov 2026 20:00 Stockholm: the scene shows (360 / 390 / 430 px), no emoji, a tap = cat hop/flick + one
//   "fredag13" line as a toast (max once per 5 s), ÖL! not covered (elementFromPoint) and still posts, idle blink/swish only while
//   visible + the map stands still; reduced motion = no running animation. Sat 14 Nov 12:00: no scene, no badge. Other holidays
//   (forced halloween) keep the old emoji chip.
// Usage: node f13-pw.js <port>   (port B: UI tests, mocked Supabase)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const { OUT } = require("./env.js");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const D13 = new Date("2026-11-13T20:00:00+01:00"), D14 = new Date("2026-11-14T12:00:00+01:00");
const EMO = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
// the toast shows a line without its emoji (the app toast strips them): compare the plain words
const plain = (x) => String(x || "").replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f]/gu, "").replace(/\s+/g, " ").trim();
const sheetOpen = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return !!(s && !s.hidden && s.getClientRects().length && getComputedStyle(s).visibility !== "hidden"); });

async function open(browser, vp, date, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, { reduced: !!o.reduced });
  await ctx.clock.setFixedTime(date);   // Date is fixed, timers keep running
  // nightfix (C, date-independent): the helper seed (an init script added BEFORE the fixed clock) writes olnu.night.lastTap and
  // olnu.checkin with the REAL time. After 13 Nov ~20:40 the real time is later than the fixed 20:00, so the last beer was "in the
  // future": ÖL! stayed in cooldown (disabled, wide mm:ss label) and the tap test failed. Move the seeded times onto the fixed clock.
  await ctx.addInitScript(() => {
    try {
      const t = Date.now(), G = (k) => JSON.parse(localStorage.getItem(k) || "null"), P = (k, v) => localStorage.setItem(k, JSON.stringify(v));
      const n = G("olnu.night"); if (n && n.lastTap > t) P("olnu.night", Object.assign(n, { lastTap: t - 40 * 60e3, expires: t + 6 * 3600e3 }));
      const c = G("olnu.checkin"); if (c && c.at > t) P("olnu.checkin", Object.assign(c, { at: t - 90 * 60e3, until: t + 6 * 3600e3 }));
    } catch (e) {}
  });
  await ctx.addInitScript((a) => {
    window.PN_F13_MS = a.ms || 0;
    if (a.hol) try { sessionStorage.setItem("olnu.hol", a.hol); } catch (e) {}
  }, { ms: o.ms || 0, hol: o.hol || "" });
  const posts = []; page.on("request", (r) => { if (/\/rpc\/post_beer/.test(r.url())) posts.push(r.url()); });
  await boot(page);
  await page.waitForFunction(() => window.AFTER && document.querySelector(".beer-wrap"), null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, posts };
}
// the geometry + content facts of the badge
const facts = (page) => page.evaluate((src) => {
  const EMO = new RegExp(src, "u"), b = document.getElementById("af-hol-e"), btn = document.getElementById("btn-beer");
  const lab = document.getElementById("beer-label"), R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  if (!b) return { badge: false, hol: document.body.classList.contains("af-hol") };
  const br = R(b), bt = R(btn), lr = R(lab), cx = bt.l + bt.w / 2, cy = bt.t + bt.h / 2, rad = bt.w / 2;
  const inBtn = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("#btn-beer")); };
  // points on ÖL!: the centre, the label corners and 8 points on the ring 5 px inside the edge
  const pts = [[cx, cy], [lr.l + 1, lr.t + 1], [lr.r - 1, lr.t + 1], [lr.l + 1, lr.b - 1], [lr.r - 1, lr.b - 1]];
  for (let a = 0; a < 360; a += 45) pts.push([cx + (rad - 5) * Math.cos(a * Math.PI / 180), cy - (rad - 5) * Math.sin(a * Math.PI / 180)]);
  for (let a = 0; a <= 90; a += 5) pts.push([cx + (rad - 3) * Math.cos(a * Math.PI / 180), cy - (rad - 3) * Math.sin(a * Math.PI / 180)]);   // the ring under the scene, 3 px inside
  const miss = pts.filter((p) => !inBtn(p[0], p[1])).map((p) => p.map(Math.round));
  const hit = (a, c) => !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
  const sibs = [...document.querySelectorAll(".dock-row > *, #other-wrap, #btn-locate")].filter((e) => !e.contains(b) && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden")
    .filter((e) => hit(R(e), br)).map((e) => e.id || e.className);
  // a painted point of the cat (its body) must take the tap
  const body = b.querySelector(".f13-body"), bb = body && body.getBoundingClientRect(), bc = bb && [bb.left + bb.width / 2, bb.top + bb.height * 0.6];
  const catHit = bc ? !!(document.elementFromPoint(bc[0], bc[1]) || { closest() {} }).closest("#af-hol-e") : false;
  return {
    badge: true, hol: document.body.classList.contains("af-hol"), tag: b.tagName, f13: b.classList.contains("af-f13"),
    svg: !!b.querySelector("svg.f13-svg"), cat: !!b.querySelector(".f13-cat .f13-body"), eyes: b.querySelectorAll(".f13-eyes ellipse").length,
    ball: !!b.querySelector("circle[fill^='url(#f13-ball']"), emoji: EMO.test(b.textContent + (b.getAttribute("aria-label") || "") + (b.title || "")),
    text: b.textContent, label: b.getAttribute("aria-label"), br, bt, lr, vw: innerWidth, miss, overLabel: hit(br, lr), sibs, catHit, bc,
    centre: (document.elementFromPoint(cx, cy) || {}).id || (document.elementFromPoint(cx, cy) || {}).className, cxy: [cx, cy],
    size: [Math.round(br.w), Math.round(br.h)],
  };
}, EMO.source);
const anims = (page) => page.evaluate(() => { const b = document.getElementById("af-hol-e"); return document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.target && b && b.contains(a.effect.target)).length; });
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent));
const watchToasts = (page) => page.evaluate(() => { window.__f13t = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains("toast")) window.__f13t.push(n.textContent); }))).observe(document.getElementById("toasts"), { childList: true }); });
const lines = (page) => page.evaluate(() => (window.AFTER_CONTENT.holidays.fredag13.lines || []).slice());

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    ok("holidayOf: Fri 13 Nov 2026 = fredag13, Sat 14 Nov = none, Fri 13 Feb 2026 = fredag13",
      await (async () => { const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); await boot(page, { clean: true });
        const r = await page.evaluate(() => [AFTER.holidayOf({ y: 2026, m: 11, d: 13 }), AFTER.holidayOf({ y: 2026, m: 11, d: 14 }), AFTER.holidayOf({ y: 2026, m: 2, d: 13 })]);
        await ctx.close(); return r[0] === "fredag13" && r[1] === null && r[2] === "fredag13"; })());

    for (const w of [360, 390, 430]) {
      const { ctx, page, posts } = await open(browser, { width: w, height: 844 }, D13, { ms: w === 390 ? 250 : 0 });
      const f = await facts(page);
      ok(w + ": 13 Nov: the Fredag 13 scene shows (button.af-f13 with svg, cat, 2 eyes + 2 pupils, crystal ball)", f.badge && f.hol && f.tag === "BUTTON" && f.f13 && f.svg && f.cat && f.eyes === 4 && f.ball, f);
      ok(w + ": no emoji in the badge (text, label, title)", f.badge && !f.emoji && f.text.trim() === "" && f.label === "Fredag 13", { text: f.text, label: f.label });
      ok(w + ": small: about the old chip size (44..60 x 44..46 px: a full 44 px tap target) and fully on screen", f.badge && f.size[0] >= 44 && f.size[0] <= 60 && f.size[1] >= 44 && f.size[1] <= 46 && f.br.l >= 0 && f.br.r <= f.vw && f.br.t >= 0, { size: f.size, br: f.br, vw: f.vw });
      ok(w + ": the scene never covers the ÖL! text", f.badge && !f.overLabel, { br: f.br, lr: f.lr });
      ok(w + ": elementFromPoint at the ÖL! centre is the button (and the label corners, 8 ring points, the top-right ring every 5 deg)", f.badge && f.centre && f.miss.length === 0, { centre: f.centre, miss: f.miss });
      ok(w + ": the scene does not overlap the other dock items (Grupper, Annat, the right box, locate)", f.badge && f.sibs.length === 0, f.sibs);
      ok(w + ": the cat itself takes taps (badge may take taps)", f.catHit, f.bc);
      await page.screenshot({ path: OUT + "ui-testshots/f13-" + w + ".png" });

      // tap the cat: hop or flick + a fredag13 toast; a 2nd tap within 5 s gives no 2nd toast; ÖL! gets no click
      await watchToasts(page);
      await page.evaluate(() => { window.__beerClicks = 0; document.getElementById("btn-beer").addEventListener("click", () => window.__beerClicks++, true); });
      const L = (await lines(page)).map(plain), sh0 = await sheetOpen(page);
      await page.touchscreen.tap(f.bc[0], f.bc[1]); await wait(page, 120);
      const st = await page.evaluate(() => { const b = document.getElementById("af-hol-e"); return { hop: b.classList.contains("f13-hop"), flick: b.classList.contains("f13-flick") }; });
      const a1 = await anims(page);
      await wait(page, 600);
      await page.touchscreen.tap(f.bc[0], f.bc[1]); await wait(page, 700);
      const t = await page.evaluate(() => window.__f13t.slice()), bc1 = await page.evaluate(() => window.__beerClicks);
      ok(w + ": tap on the badge = cat hop or tail flick (a running animation)", (st.hop || st.flick) && a1 > 0, { st, a1 });
      ok(w + ": tap on the badge = one toast with a fredag13 line; a 2nd tap within 5 s = no 2nd toast", t.length === 1 && L.includes(plain(t[0])), { t, n: L.length });
      ok(w + ": the badge tap does not press ÖL! (no click, no post, no sheet)", bc1 === 0 && posts.length === 0 && !sh0 && !(await sheetOpen(page)), { bc1, posts: posts.length });
      if (w === 390) {
        await wait(page, 4600);
        await page.touchscreen.tap(f.bc[0], f.bc[1]); await wait(page, 500);
        const t2 = await page.evaluate(() => window.__f13t.slice());
        ok("390: after 5 s a new tap gives a new (different) fredag13 line", t2.length === 2 && L.includes(plain(t2[1])) && plain(t2[1]) !== plain(t2[0]), t2);
        // idle (PN_F13_MS = 250 ms here, 20 000 ms live): blink / swish now and then, never while the map moves or the page is hidden
        const idle = (ms) => page.evaluate((ms) => new Promise((res) => { const b = document.getElementById("af-hol-e"), seen = [];
          const mo = new MutationObserver(() => ["f13-blink", "f13-swish"].forEach((c) => { if (b.classList.contains(c)) seen.push(c); })); mo.observe(b, { attributes: true, attributeFilter: ["class"] });
          setTimeout(() => { mo.disconnect(); res(seen); }, ms); }), ms);
        const s1 = await idle(2500);
        ok("390: idle: the cat does a slow blink or a tail swish now and then", s1.length > 0, s1);
        await page.evaluate(() => document.documentElement.classList.add("map-moving"));
        const s2 = await idle(2200);
        await page.evaluate(() => { document.documentElement.classList.remove("map-moving"); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); });
        const s3 = await idle(2200);
        await page.evaluate(() => { delete document.visibilityState; });
        ok("390: idle: nothing while html.map-moving", s2.length === 0, s2);
        ok("390: idle: nothing while the page is hidden", s3.length === 0, s3);
        ok("390: live idle pace is 20-40 s (PN_F13_MS default 20000 x 1..2)", /\(window\.PN_F13_MS \|\| 20000\) \* \(1 \+ Math\.random\(\)\)/.test(await page.evaluate(() => fetch("./js/after.js").then((r) => r.text()))));
        // the 390 delivery screenshot: the dock with the scene
        const d = await page.$(".dock-row"), db = await d.boundingBox();
        await page.screenshot({ path: OUT + "ui-testshots/f13-dock-390.png", clip: { x: 0, y: Math.max(0, db.y - 70), width: 390, height: db.height + 90 } });
      }
      // ÖL! still works: a real tap on its centre reaches the button and posts the beer
      await page.touchscreen.tap(f.cxy[0], f.cxy[1]); await wait(page, 2500);
      const bc2 = await page.evaluate(() => window.__beerClicks), sh = await sheetOpen(page);
      // at 20:00 near bars ÖL! first asks "Var dricker du?" (bar picker sheet); else it posts at once (post_beer_v2)
      ok(w + ": a tap on the ÖL! centre presses ÖL! (click on #btn-beer, then post_beer or the bar picker)", bc2 === 1 && (posts.length >= 1 || sh), { bc2, posts: posts.length, sh });
      await ctx.close();
    }

    { // reduced motion: a static scene (no running animation, also after a tap and idle plays), the tap still gives the toast
      const { ctx, page } = await open(browser, { width: 390, height: 844 }, D13, { reduced: true, ms: 200 });
      const f = await facts(page);
      ok("reduced motion: the scene shows", f.badge && f.f13 && f.svg, f);
      await watchToasts(page);
      const a0 = await anims(page);
      await page.touchscreen.tap(f.bc[0], f.bc[1]); await wait(page, 150);
      const a1 = await anims(page); await wait(page, 900);
      const a2 = await anims(page), t = await page.evaluate(() => window.__f13t.slice());
      ok("reduced motion: no running animation (idle, right after a tap, during idle plays)", a0 === 0 && a1 === 0 && a2 === 0, { a0, a1, a2 });
      ok("reduced motion: the tap still gives the fredag13 toast", t.length === 1, t);
      await page.screenshot({ path: OUT + "ui-testshots/f13-reduced-390.png" });
      await ctx.close();
    }

    { // 14 Nov: no scene, no badge, no holiday class
      for (const w of [360, 430]) {
        const { ctx, page } = await open(browser, { width: w, height: 844 }, D14);
        const f = await facts(page);
        const sc = await page.evaluate(() => document.querySelectorAll(".af-f13, .f13-svg").length);
        ok(w + ": 14 Nov: no Fredag 13 scene and no holiday badge", !f.badge && !f.hol && sc === 0, { f, sc });
        await ctx.close();
      }
    }

    { // other holidays stay as before: forced halloween = the old emoji span, no scene
      const { ctx, page } = await open(browser, { width: 390, height: 844 }, D14, { hol: "halloween" });
      const r = await page.evaluate(() => { const b = document.getElementById("af-hol-e"); return b && { tag: b.tagName, cls: b.className, text: b.textContent, want: AFTER_CONTENT.holidays.halloween.theme.emoji, role: b.getAttribute("role"), svg: !!b.querySelector("svg"), pe: getComputedStyle(b).pointerEvents }; });
      ok("other holiday (halloween): unchanged emoji chip (span.af-hol-e, role=img, theme emoji, no svg, no taps)", r && r.tag === "SPAN" && r.cls === "af-hol-e" && r.text === r.want && r.role === "img" && !r.svg && r.pe === "none", r);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e.stack); }
  await browser.close();
  console.log("\n" + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
