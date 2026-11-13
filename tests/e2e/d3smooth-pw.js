// d3smooth (Wave D, SMOOTH-PLAN 1, 4, 5, 7, 9, 10): a sheet slides in first and fills after its first frame, no 650 ms cold hold,
// pull down from the content with snap points (open / half / closed) and a spring, the ticker runs on the compositor, no infinite
// box-shadow animation, press feedback on every tap, the bold fonts load with the splash, reduced motion, layout shift.
// Usage: node d3smooth-pw.js <port>   (UI port: mocked Supabase, ds-helpers)
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };

const VP = { width: 390, height: 844 };
async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, VP, o);
  const cdp = await ctx.newCDPSession(page);
  await H.boot(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  // a finger drag: n moves of dy/n, `gap` ms apart, an optional still `hold` before lifting
  const drag = async (x, y, dy, n, gap, hold) => {
    await touch("touchStart", x, y);
    for (let i = 1; i <= n; i++) { await touch("touchMove", x, y + dy * i / n); if (gap) await wait(page, gap); }
    if (hold) { await wait(page, hold); await touch("touchMove", x, y + dy); }
    await touch("touchEnd");
  };
  const tap = async (sel) => { const b = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel); if (b) await page.touchscreen.tap(b[0], b[1]); return !!b; };
  const sheet = () => page.evaluate(() => { const s = document.getElementById("sheet"), m = /translateY\((-?[\d.]+)px\)/.exec(s.style.transform || "");
    return { open: !s.hidden, y: m ? Math.round(+m[1]) : 0, h: Math.round(s.getBoundingClientRect().height), anims: s.getAnimations().map((a) => a.effect.getKeyframes().length) }; });
  const close = async () => { await H.closeSheet(page); await wait(page, 600); };
  return { ctx, page, cdp, drag, tap, sheet, close };
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    const { ctx, page, drag, tap, sheet, close } = await setup(browser);

    // ---- 10. the bold faces are in before the first sheet ----
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => /Chakra/.test(f.family) && f.status === "loaded").map((f) => String(f.weight)));
    ok("fonts: Chakra Petch 600 and 700 are loaded before the first sheet opens", fonts.includes("600") && fonts.includes("700"), fonts);

    // ---- 1. slide first, fill second ----
    await page.evaluate(() => {
      const M = window.__d3 = { ls: 0 }; const s = document.getElementById("sheet"), b = document.getElementById("sheet-body");
      let frame = 0; (function f() { frame++; requestAnimationFrame(f); })();
      M.reset = () => { M.show = null; M.fill = null; };
      new MutationObserver(() => { if (!s.hidden && !M.show) M.show = { frame, shell: !!b.querySelector(".wm-shell") }; }).observe(s, { attributes: true, attributeFilter: ["hidden"] });
      new MutationObserver(() => { if (M.show && !M.fill && [...b.children].some((c) => !c.classList.contains("wm-shell"))) M.fill = { frame }; }).observe(b, { childList: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) M.ls += e.value; })).observe({ type: "layout-shift", buffered: false });
    });
    for (const sel of ["#btn-groups", "#btn-settings", "#btn-top"]) { await tap(sel); await wait(page, 1300); await close(); }   // 1st open: height not known yet = built at once
    await page.evaluate(() => { window.__d3.ls = 0; });
    for (const sel of ["#btn-groups", "#btn-settings", "#btn-top"]) {
      await page.evaluate(() => window.__d3.reset());
      await tap(sel); await wait(page, 1300);
      const r = await page.evaluate(() => { const b = document.getElementById("sheet-body"), M = window.__d3;
        return { show: M.show, fill: M.fill, shellLeft: !!b.querySelector(".wm-shell"), kids: b.children.length, hold: b.classList.contains("wm-hold") }; });
      ok("1 " + sel + ": the sheet shows with skeleton rows (it slides at once)", !!(r.show && r.show.shell), r);
      ok("1 " + sel + ": the real content comes after the first frame of the slide", !!(r.show && r.fill && r.fill.frame > r.show.frame), r);
      ok("1 " + sel + ": then the content is in (no skeleton shell left, not hidden)", !r.shellLeft && r.kids > 0 && !r.hold, r);
      await close();
    }
    const cls = await page.evaluate(() => window.__d3.ls);
    ok("CLS: layout shift over 3 opens + closes stays under 0.003", cls < 0.003, cls);

    // ---- 1b. after a tap, the wait for data shows the skeleton rows, not an invisible body (was 650 ms of empty box) ----
    await page.evaluate(() => {
      const b = document.createElement("button"); b.id = "d3-cold"; b.textContent = "kall"; b.style.cssText = "position:fixed;left:150px;top:420px;z-index:5000;width:90px;height:44px";
      b.onclick = () => window.PN.openSheet("d3 kall", (body) => { body.appendChild(document.createElement("p")).textContent = "x";
        window.WARM.rpc("my_stats", { d3: Math.random() }, () => new Promise((r) => setTimeout(() => r({ data: [], error: null }), 1500))); });
      document.body.appendChild(b);
    });
    await tap("#d3-cold"); await wait(page, 2000); await close();   // the 1st open teaches its height
    await tap("#d3-cold"); await wait(page, 300);
    const hold = await page.evaluate(() => { const b = document.getElementById("sheet-body"), cs = getComputedStyle(b);
      return { held: b.classList.contains("wm-hold"), opacity: cs.opacity, rows: /gradient/.test(cs.backgroundImage), lock: b.style.maxHeight }; });
    ok("1 cold sheet after a tap (data on the way): at 300 ms it shows skeleton rows, not an invisible body", hold.held && hold.opacity === "1" && hold.rows, hold);
    await wait(page, 1600);
    const rel = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return { held: b.classList.contains("wm-hold"), lock: b.style.maxHeight, op: getComputedStyle(b).opacity }; });
    ok("1 cold sheet: the content shows when its data is in (height lock gone)", !rel.held && !rel.lock, rel);
    await close();
    await page.evaluate(() => document.getElementById("d3-cold").remove());

    // ---- 4. pull down from the content, snap points, spring ----
    await tap("#btn-groups"); await wait(page, 1400);
    let s0 = await sheet();
    const half = s0.h > VP.height * 0.72 ? Math.round(s0.h - VP.height * 0.5) : 0;
    const body = await page.evaluate(() => { const r = document.getElementById("sheet-body").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 70, st: document.getElementById("sheet-body").scrollTop }; });
    await drag(body.x, body.y, 26, 5, 16, 120); await wait(page, 600);
    let s1 = await sheet();
    ok("4 a short slow pull on the content springs back (open, at the top)", s1.open && Math.abs(s1.y) < 3, s1);
    if (half) {
      await drag(body.x, body.y, half, 24, 28, 150);
      const mid = await sheet(); await wait(page, 800);
      s1 = await sheet();
      ok("4 the release settles with a spring (a Web Animation, many keyframes)", mid.anims.some((n) => n > 4), mid);
      ok("4 a slow pull to the middle rests on the half snap point", s1.open && Math.abs(s1.y - half) < 40, { s1, half });
      await drag(body.x, body.y + half, -240, 8, 20, 120); await wait(page, 800);
      s1 = await sheet();
      ok("4 from half, a pull up opens it fully again", s1.open && Math.abs(s1.y) < 3, s1);
    } else ok("4 (no half snap: sheet height " + s0.h + " under 72 % of the screen)", true);
    await drag(body.x, body.y, 280, 4, 8, 0); await wait(page, 900);
    s1 = await sheet();
    ok("4 a quick flick down from the content closes the sheet", !s1.open, s1);
    // grip still drags
    await tap("#btn-groups"); await wait(page, 1300);
    const g = await page.evaluate(() => { const r = document.querySelector("#sheet .sheet-grip").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await drag(g.x, g.y, 300, 4, 8, 0); await wait(page, 900);
    s1 = await sheet();
    ok("4 a flick on the grip still closes it", !s1.open, s1);
    // a scrolled content scrolls (it does not pull the sheet)
    await tap("#btn-groups"); await wait(page, 1300);
    const sc = await page.evaluate(() => { const b = document.getElementById("sheet-body"), f = document.createElement("div"); f.style.height = "1600px"; f.className = "d3-fill"; b.appendChild(f); b.scrollTop = 300; return b.scrollTop; });
    await drag(body.x, body.y + 100, 160, 6, 16, 80); await wait(page, 700);
    s1 = await sheet();
    const st1 = await page.evaluate(() => document.getElementById("sheet-body").scrollTop);
    ok("4 content scrolled down: a pull down scrolls the content, the sheet stays", s1.open && Math.abs(s1.y) < 3 && st1 < sc, { s1, sc, st1 });
    await close();

    // ---- 5. ticker on the compositor ----
    await page.evaluate(() => { const x = document.querySelector(".ticker.pn-kaos .pn-kaos-x"); if (x) x.click(); });
    const tk = await page.evaluate(() => new Promise((res) => {
      const tr = document.getElementById("ticker-track"), seen = new Set(); let n = 0;
      const an = tr.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => k.transform));
      (function f() { seen.add(tr.style.transform); if (++n < 20) requestAnimationFrame(f); else res({ writes: seen.size, anims: an.length, rate: an[0] ? an[0].playbackRate : null }); })();
    }));
    ok("5 ticker: ONE transform Web Animation moves the belt", tk.anims === 1 && tk.rate === 1, tk);
    ok("5 ticker: no JS transform write per frame", tk.writes <= 1, tk);
    const lt = await page.evaluate(() => new Promise((res) => {
      const tr = document.getElementById("ticker-track"), vr = tr.parentNode.getBoundingClientRect();
      const el = [...tr.children].find((e) => { const r = e.getBoundingClientRect(); return r.left > vr.left + 60 && r.left < vr.right - 40; }) || tr.lastElementChild;
      const a = el.getBoundingClientRect().left, t0 = performance.now(); while (performance.now() - t0 < 700) {}   // a 700 ms long task
      requestAnimationFrame(() => requestAnimationFrame(() => res({ moved: Math.round(a - el.getBoundingClientRect().left), con: el.isConnected })));   // 2nd frame: the 1st one carries the old frame time
    }));
    ok("5 ticker: a 700 ms long task does not freeze the belt (it keeps its 46 px/s)", lt.moved >= 20, lt);
    await tap("#btn-groups"); await wait(page, 900);
    const ps = await page.evaluate(() => new Promise((res) => { const tr = document.getElementById("ticker-track"), a = tr.getAnimations()[0];
      const x0 = tr.firstElementChild.getBoundingClientRect().left; setTimeout(() => res({ rate: a ? a.playbackRate : null, dx: Math.round(x0 - tr.firstElementChild.getBoundingClientRect().left) }), 500); }));
    ok("5 ticker: paused while a sheet is open", ps.rate === 0 && Math.abs(ps.dx) < 2, ps);
    await close();

    // ---- 7. no infinite box-shadow animation ----
    const gl = await page.evaluate(async () => {
      const box = document.createElement("div"); box.style.cssText = "position:fixed;left:0;top:300px;width:200px"; document.body.appendChild(box);
      [["div", "sk-banner"], ["div", "rally hud-panel rl-lv4"], ["div", "rl-pin rl-n4"]].forEach(([t, c]) => { const e = document.createElement(t); e.className = c; e.textContent = "d3"; box.appendChild(e); });
      await new Promise((r) => setTimeout(r, 200));
      const props = (a) => [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !/^(offset|easing|composite|computedOffset)$/.test(p)))];
      const all = new Set([...document.getAnimations(), ...box.getAnimations({ subtree: true })]);   // subtree: pseudo elements too
      const inf = [...all].filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity);
      const bad = inf.filter((a) => props(a).some((p) => /^(boxShadow|backgroundPosition|width|height|top|left)$/.test(p))).map((a) => (a.animationName || "?") + ":" + props(a).join("+"));
      const glow = inf.filter((a) => box.contains(a.effect.target) && a.effect.pseudoElement && props(a).join() === "opacity").length;
      box.remove();
      return { bad, glow };
    });
    ok("7 no infinite animation of box-shadow / background-position / size runs (glows included)", gl.bad.length === 0, gl);
    ok("7 the 3 glows (Skål banner, call-out lv4, call-out pin) pulse by opacity on a pseudo element", gl.glow >= 3, gl);

    // ---- 9. press feedback on every tap ----
    const pr = await page.evaluate(() => { const b = document.getElementById("btn-top"); window.__pr = []; new MutationObserver(() => window.__pr.push(b.classList.contains("pn-press"))).observe(b, { attributes: true, attributeFilter: ["class"] }); return !!b; });
    await tap("#btn-top"); await wait(page, 400);
    const press = await page.evaluate(() => ({ seen: window.__pr.includes(true), now: document.getElementById("btn-top").classList.contains("pn-press") }));
    ok("9 a quick tap shows the press state (.pn-press), then it goes", pr && press.seen && !press.now, press);
    await close();
    await ctx.close();

    // ---- reduced motion: no skeleton step, no spring, still works ----
    {
      const R = await setup(browser, { reduced: true });
      await R.page.evaluate(() => { const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"); window.__rm = null;
        new MutationObserver(() => { if (!s.hidden && !window.__rm) window.__rm = { shell: !!b.querySelector(".wm-shell"), kids: b.children.length }; }).observe(s, { attributes: true, attributeFilter: ["hidden"] }); });
      await R.tap("#btn-groups"); await wait(R.page, 1200);
      const rm = await R.page.evaluate(() => window.__rm);
      ok("reduced motion: the sheet opens complete in one step (no skeleton step)", rm && !rm.shell && rm.kids > 0, rm);
      const b2 = await R.page.evaluate(() => { const r = document.getElementById("sheet-body").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 70 }; });
      await R.drag(b2.x, b2.y, 280, 4, 8, 0); await wait(R.page, 500);
      const rs = await R.sheet();
      ok("reduced motion: a flick down from the content closes it (no spring)", !rs.open, rs);
      const tr = await R.page.evaluate(() => { const t = document.getElementById("ticker-track"); return { anims: t.getAnimations().length, one: t.classList.contains("tk-one") }; });
      ok("reduced motion: the ticker is the one-line mode, no belt animation", tr.one && tr.anims === 0, tr);
      await R.ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`\nd3smooth: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
