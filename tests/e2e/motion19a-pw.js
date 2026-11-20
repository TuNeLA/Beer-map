// motion19a (audit motion19 Section 2, fixes 1-4 + 11; owner GO 20 Nov, I-135): sheets.
//   1 a sheet that opens from closed after a tap shows its frame first (title + skeleton rows), the body is built after that
//     first frame (Doherty < 400 ms). sheetFail fallback, SHEETNAV.didOpen, warm hold, scroll top still hold.
//   2 the real sheet closes (no clone), open + close are Web Animations that turn around from where they are: a reopen during
//     the close reverses, a finger that drags the closing sheet brings it back, a drag during the open takes it over.
//   3 the first 8 list rows come in one after the other (30 ms step). Not on a repeat open, a refresh, in a chat.
//   4 a tap opened sheet grows from the tap x (transform-origin + scale .97). A map tap: no scale.
//  11 html.sheet-open pauses the ambient loops (pill glow, alive2) while a sheet is open.
//   Reduced motion: still (no skeleton step, no slide, no stagger).
// Usage: node motion19a-pw.js <port>   (UI port: mocked Supabase, d2-helpers)
const H = require("./d2-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const VP = { width: 390, height: 844 };

async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, VP, o);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await H.boot(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  const center = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const tap = async (sel) => { const c = await center(sel); if (c) await page.touchscreen.tap(c[0], c[1]); return c; };
  const close = async () => { await page.evaluate(() => { const s = document.getElementById("sheet"); if (!s.hidden) document.getElementById("sheet-close").click(); }); await wait(page, 500); };
  // In-page recorder: what the sheet looks like the moment it is shown (after smooth.js started its slide) and when the body fills.
  await page.evaluate(() => {
    const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"), R = window.__m19 = {};
    let frame = 0; (function f() { frame++; requestAnimationFrame(f); })();
    R.reset = () => { R.show = null; R.fill = null; };
    new MutationObserver(() => {
      if (s.hidden || R.show) return;
      const a = s.getAnimations().filter((x) => !x.animationName);
      const k = a[0] ? a[0].effect.getKeyframes() : [], t = a[0] ? a[0].effect.getTiming() : {};
      R.show = { frame, shell: !!b.querySelector(".wm-shell"), kids: b.children.length, waapi: a.length, from: k[0] ? k[0].transform : "", dur: t.duration, ease: String(t.easing || ""),
        origin: s.style.transformOrigin, left: s.offsetLeft, html: document.documentElement.classList.contains("sheet-open"),
        css: getComputedStyle(s).animationName };
    }).observe(s, { attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(() => { if (R.show && !R.fill && [...b.children].some((c) => !c.classList.contains("wm-shell"))) R.fill = { frame }; }).observe(b, { childList: true });
  });
  return { ctx, page, errs, touch, tap, close, center };
}
const rec = (page) => page.evaluate(() => window.__m19);
const resetRec = (page) => page.evaluate(() => window.__m19.reset());

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    const T = await setup(browser);
    const { page, touch, tap, close } = T;

    // ---- 1 + 4 + 3 + 11: first open of "Mer på kartan" (⋯, right side of the screen) by a finger tap ----
    await page.evaluate(() => { const box = document.createElement("div"); box.id = "m19-loops"; box.style.cssText = "position:fixed;left:0;top:120px;width:60px;height:30px;z-index:5";
      box.innerHTML = '<div class="pill p1" style="position:relative;width:30px;height:20px"></div><div class="a2-holring" style="width:20px;height:20px"></div>'; document.body.appendChild(box); });
    const loops = () => page.evaluate(() => { const box = document.getElementById("m19-loops");
      return box.getAnimations({ subtree: true }).map((a) => a.animationName + ":" + a.playState).sort().join(" "); });
    const l0 = await loops();
    await resetRec(page);
    const tp = await tap("#btn-more");
    await wait(page, 60);
    const ff = await page.evaluate(() => { const s = document.getElementById("sheet"); return { rows: [...document.querySelectorAll("#sheet-body .sm-st")].map((r) => r.style.getPropertyValue("--i")).join(","), st: window.SMOOTH.stats.stagger }; });
    const lOpen = await loops();
    await wait(page, 900);
    let r = await rec(page);
    ok("1 tap → the sheet shows at once with skeleton rows (frame first, body next)", !!(r.show && r.show.shell && r.show.kids === 1), r.show);
    ok("1 the real body comes after the first frame of the slide", !!(r.show && r.fill && r.fill.frame > r.show.frame), { show: r.show && r.show.frame, fill: r.fill });
    const body1 = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return { shell: !!b.querySelector(".wm-shell"), rows: b.querySelectorAll(".ds-row").length, hold: b.classList.contains("wm-hold"), lock: b.style.maxHeight }; });
    ok("1 then the content is in (rows, no skeleton, no hold, no height lock)", !body1.shell && body1.rows >= 3 && !body1.hold && !body1.lock, body1);
    ok("2 open = Web Animation --m-5 with --e-spring (no CSS slide on #sheet)", r.show && r.show.waapi === 1 && r.show.dur === 300 && /linear\(|cubic-bezier\(0\.2, 1\.2/.test(r.show.ease) && r.show.css === "none", r.show);
    const ox = r.show && parseFloat(r.show.origin), want = tp[0] - (r.show ? r.show.left : 0);
    ok("4 tap opened: the sheet grows from the tap x (scale .97, transform-origin x = tap x)", r.show && /scale\(0\.97\)/.test(r.show.from) && Math.abs(ox - want) < 8 && /100%|844|px$/.test(r.show.origin.split(" ")[1] || ""), { from: r.show && r.show.from, origin: r.show && r.show.origin, want });
    const idx = ff.rows.split(",").filter(Boolean).map(Number);
    ok("3 stagger: the first list rows get --i 0,1,2… (3 to 8 rows)", idx.length >= 3 && idx.length <= 8 && idx.every((v, i) => v === i), ff);
    ok("11 html.sheet-open while the sheet is open", r.show && r.show.html && await page.evaluate(() => document.documentElement.classList.contains("sheet-open")));
    ok("11 ambient loops (pill glow, alive2 ring) run on the map, pause under the open sheet", /running/.test(l0) && !/running/.test(lOpen) && /paused/.test(lOpen), { l0, lOpen });
    await wait(page, 1200);
    ok("3 the stagger classes are gone after the rows are in", await page.evaluate(() => !document.querySelector("#sheet-body .sm-st")));

    // ---- 2: close = the real sheet, --m-4 --e-out, no clone ----
    const c = await page.evaluate(async () => {
      const s = document.getElementById("sheet"); document.getElementById("sheet-close").click();
      const a = s.getAnimations().filter((x) => !x.animationName), t = a[0] ? a[0].effect.getTiming() : {};
      return { n: a.length, dur: t.duration, ease: t.easing, sheets: document.querySelectorAll("#sheet, .sheet:not(.leaflet-popup)").length, clone: !!document.querySelector(".sm-ghost-host, [id=sheet] [id=sheet]"), hidden: s.hidden, html: document.documentElement.classList.contains("sheet-open") };
    });
    ok("2 close: the real #sheet slides (one Web Animation, --m-4, --e-out), no copy of the sheet", c.n === 1 && c.dur === 200 && /cubic-bezier\(0\.3, 0, 0\.8, 0\.15\)/.test(c.ease) && c.sheets === 1 && !c.clone && c.hidden, c);
    ok("11 html.sheet-open is removed at the close", !c.html, c);
    await wait(page, 500);
    const lClosed = await loops();
    ok("11 the ambient loops run again after the close", /running/.test(lClosed) && !/paused/.test(lClosed), lClosed);

    // ---- 3: a repeat open within 3 s has no stagger ----
    await tap("#btn-more"); await wait(page, 60);
    const again = await page.evaluate(() => document.querySelectorAll("#sheet-body .sm-st").length);
    ok("3 the same sheet again within 3 s: no stagger", again === 0, again);
    await wait(page, 700);

    // ---- 2: reopen during the close slide reverses from where it is ----
    const rv = await page.evaluate(async () => {
      const s = document.getElementById("sheet"), y = () => new DOMMatrixReadOnly(getComputedStyle(s).transform).m42, o = () => +getComputedStyle(s).opacity;
      const n0 = window.SMOOTH.stats.reverse;
      document.getElementById("sheet-close").click();
      let y1 = 0, o1 = 1; for (let i = 0; i < 40 && y1 < 18; i++) { await new Promise((r) => requestAnimationFrame(r)); y1 = y(); o1 = o(); }
      document.getElementById("btn-more").click();
      await new Promise((r) => requestAnimationFrame(r));
      const y2 = y(), o2 = o();
      await new Promise((r) => setTimeout(r, 650));
      return { y1: Math.round(y1), y2: Math.round(y2), o1: +o1.toFixed(2), o2: +o2.toFixed(2), end: Math.round(y()), open: !s.hidden, rev: window.SMOOTH.stats.reverse - n0, shell: !!document.querySelector("#sheet-body .wm-shell"), rows: document.querySelectorAll("#sheet-body .ds-row").length };
    });
    ok("2 reopen during the close: it turns around from its live place (no jump to the bottom or the top)", rv.y1 >= 18 && Math.abs(rv.y2 - rv.y1) < 30 && rv.y2 > 4 && Math.abs(rv.o2 - rv.o1) < 0.2, rv);
    ok("2 … and settles fully open, with its rows (no skeleton step)", rv.open && Math.abs(rv.end) < 3 && rv.rev === 1 && !rv.shell && rv.rows >= 3, rv);

    // ---- 2: a finger that drags the closing sheet brings it back; a plain tap on it does nothing ----
    await page.evaluate(() => document.getElementById("sheet-close").click());
    await touch("touchStart", 200, 700); await touch("touchMove", 200, 690); await touch("touchMove", 200, 672); await touch("touchMove", 200, 650); await touch("touchEnd");
    await wait(page, 800);
    const cg = await page.evaluate(() => { const s = document.getElementById("sheet"); return { open: !s.hidden, y: Math.round(new DOMMatrixReadOnly(getComputedStyle(s).transform).m42), caught: window.SMOOTH.stats.caught, title: document.getElementById("sheet-title").textContent, rows: document.querySelectorAll("#sheet-body .ds-row").length }; });
    ok("2 a drag on the closing sheet catches it: the same sheet opens again and rests open", cg.open && cg.caught === 1 && Math.abs(cg.y) < 3 && cg.rows >= 3, cg);
    await page.evaluate(() => { window.__m19clicks = 0; document.getElementById("sheet-body").addEventListener("click", () => window.__m19clicks++, true); document.getElementById("sheet-close").click(); });
    await wait(page, 30); await page.touchscreen.tap(200, 760); await wait(page, 600);
    const tp2 = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, clicks: window.__m19clicks }));
    ok("2 a plain tap on the closing sheet (double tap on ✕) does nothing: it stays closed, no row is clicked", !tp2.open && tp2.clicks === 0, tp2);

    // ---- 2: a close during the open slide goes down from its live place ----
    await wait(page, 800);   // no recent tap: a plain slide (no scale, built at once)
    const co = await page.evaluate(async () => {
      const s = document.getElementById("sheet"), y = () => new DOMMatrixReadOnly(getComputedStyle(s).transform).m42;
      window.PN.openSheet("m19 kort", (b) => { b.appendChild(document.createElement("p")).textContent = "x"; });
      await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r));
      const y1 = y(); document.getElementById("sheet-close").click();
      let y2 = 1e9; for (let i = 0; i < 4; i++) { await new Promise((r) => requestAnimationFrame(r)); y2 = Math.min(y2, y()); }
      await new Promise((r) => setTimeout(r, 400));
      return { y1: Math.round(y1), y2: Math.round(y2), hidden: s.hidden, anims: s.getAnimations().length };
    });
    ok("2 close during the open slide: it goes down from where it is (no jump up first)", co.y2 >= co.y1 - 6 && co.hidden && co.anims === 0, co);

    // ---- 2: a finger takes the sheet during the open slide ----
    await resetRec(page);
    const g0 = await T.center("#btn-more"); await page.touchscreen.tap(g0[0], g0[1]);
    const grip = await page.evaluate(() => { const r = document.querySelector("#sheet .sheet-grip").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await touch("touchStart", grip[0], grip[1]);
    for (let i = 1; i <= 6; i++) { await touch("touchMove", grip[0], grip[1] + i * 20); await wait(page, 16); }
    const dg = await page.evaluate(() => { const s = document.getElementById("sheet"); return { anims: s.getAnimations().filter((a) => !a.animationName).length, y: Math.round(new DOMMatrixReadOnly(getComputedStyle(s).transform).m42), inl: s.style.transform }; });
    await touch("touchEnd"); await wait(page, 900);
    ok("2 a drag during the open slide takes the sheet (the slide stops, the sheet follows the finger)", dg.anims === 0 && dg.y >= 60 && /translateY/.test(dg.inl), dg);
    await close(); await wait(page, 2600);   // past the 3 s repeat window

    // ---- 3: list sheet (10 rows) → 8 rows staggered; a refresh in place → none; a chat → none ----
    await page.evaluate(() => {
      const mk = (id, left, fn) => { const b = document.createElement("button"); b.id = id; b.textContent = id; b.style.cssText = "position:fixed;top:300px;left:" + left + "px;z-index:5000;width:80px;height:44px"; b.onclick = fn; document.body.appendChild(b); };
      window.__m19list = (body) => { const ul = document.createElement("ul"); for (let i = 0; i < 10; i++) { const li = document.createElement("li"); li.textContent = "rad " + i; li.style.minHeight = "56px"; ul.appendChild(li); } body.appendChild(ul); };
      mk("m19-list", 300, () => window.PN.openSheet("m19 lista", window.__m19list));
      mk("m19-chat", 10, () => window.PN.openSheet("m19 chatt", (body) => { const ul = document.createElement("ul"); ul.className = "chat-list"; for (let i = 0; i < 6; i++) { const li = document.createElement("li"); li.className = "chat-msg"; li.textContent = "hej " + i; ul.appendChild(li); } body.appendChild(ul); }));
      mk("m19-boom", 150, () => window.PN.openSheet("m19 trasig", () => { throw new Error("m19 boom"); }));
    });
    await tap("#m19-list"); await wait(page, 120);
    const ls = await page.evaluate(() => { const r = [...document.querySelectorAll("#sheet-body .sm-st")]; const c = r[3] && getComputedStyle(r[3]);
      return { n: r.length, max: Math.max(...r.map((x) => +x.style.getPropertyValue("--i"))), name: c && c.animationName, delay: c && c.animationDelay, dur: c && c.animationDuration }; });
    ok("3 a list of 10 rows: the first 8 stagger, 30 ms step, smRow --m-4", ls.n === 8 && ls.max === 7 && ls.name === "smRow" && ls.delay === "0.09s" && ls.dur === "0.2s", ls);
    await page.evaluate(() => { [...document.querySelectorAll("#sheet-body .sm-st")].forEach((x) => x.classList.remove("sm-st")); window.PN.openSheet("m19 lista", window.__m19list); });
    await wait(page, 60);
    ok("3 a refresh in place (same sheet, open) has no stagger", await page.evaluate(() => document.querySelectorAll("#sheet-body .sm-st").length === 0 && document.querySelectorAll("#sheet-body li").length === 10));
    await close();
    await tap("#m19-chat"); await wait(page, 120);
    ok("3 a chat list has no stagger", await page.evaluate(() => document.querySelectorAll("#sheet-body .sm-st").length === 0 && document.querySelectorAll("#sheet-body .chat-msg").length === 6));
    await close();

    // ---- 1: the fallback, the back stack hook, the start at the top ----
    await tap("#m19-boom"); await wait(page, 600);
    const bm = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return { kids: b.children.length, shell: !!b.querySelector(".wm-shell"), text: b.textContent.trim().slice(0, 60) }; });
    ok("1 a build that throws after the first frame still gets the sheetFail text (never an empty sheet)", bm.kids > 0 && !bm.shell && bm.text.length > 0, bm);
    await close();
    await tap("#btn-groups"); await wait(page, 1300);
    const gr = await page.evaluate(() => { const s = document.getElementById("sheet"); return { tall: s.classList.contains("sn-tall"), tabs: !!document.querySelector("#sheet-body .inv-tabs"), cards: document.querySelectorAll("#sheet-body .gcard").length }; });
    ok("1 Grupper: built after the first frame, SHEETNAV.didOpen still sees the tabs (sn-tall)", gr.tabs && gr.tall && gr.cards > 0, gr);
    await page.evaluate(() => { const b = document.getElementById("sheet-body"), f = document.createElement("div"); f.style.height = "1600px"; b.appendChild(f); b.scrollTop = 400; });
    await close(); await tap("#btn-groups"); await wait(page, 1300);
    ok("1 a sheet that opens fresh starts at the top (ds22)", await page.evaluate(() => document.getElementById("sheet-body").scrollTop === 0));
    await close();
    // a sheet that replaces an open one is built at once (no skeleton step)
    await tap("#btn-more"); await wait(page, 800); await resetRec(page);
    const rp = await page.evaluate(() => { window.PN.openSheet("m19 ersätt", (b) => { b.appendChild(document.createElement("p")).textContent = "ny"; }); const b = document.getElementById("sheet-body"); return { shell: !!b.querySelector(".wm-shell"), text: b.textContent }; });
    ok("1 a sheet that replaces an open sheet is built at once (no skeleton flash)", !rp.shell && rp.text === "ny", rp);
    await close();

    // ---- 4: a sheet opened from a map tap: no scale (pins and map layers keep their own motion) ----
    await resetRec(page);
    await page.evaluate(() => { const m = document.querySelector("#map"); m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 300 })); window.PN.openSheet("m19 karta", (b) => { b.textContent = "karta"; }); });
    await wait(page, 400);
    r = await rec(page);
    ok("4 a sheet opened by a map tap slides without the scale", r.show && r.show.waapi === 1 && !/scale/.test(r.show.from) && !r.show.origin, r.show);
    await close();
    ok("no page errors", T.errs.length === 0, T.errs.slice(0, 3));
    await T.ctx.close();

    // ---- reduced motion: still ----
    {
      const R = await setup(browser, { reduced: true });
      await R.page.evaluate(() => { window.__m19.reset(); });
      await R.tap("#btn-more"); await wait(R.page, 60);
      const rr = await rec(R.page);
      const st = await R.page.evaluate(() => document.querySelectorAll("#sheet-body .sm-st").length);
      ok("reduced motion: built at once (no skeleton step), no slide, no stagger", rr.show && !rr.show.shell && rr.show.kids > 0 && rr.show.waapi === 0 && st === 0, { show: rr.show, st });
      const rc = await R.page.evaluate(() => { const s = document.getElementById("sheet"); document.getElementById("sheet-close").click(); return { anims: s.getAnimations().length, html: document.documentElement.classList.contains("sheet-open") }; });
      ok("reduced motion: the close is instant, html.sheet-open goes", rc.anims === 0 && !rc.html, rc);
      await R.ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\nmotion19a: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
