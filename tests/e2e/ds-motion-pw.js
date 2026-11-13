// ds10 motion rules, measured. node ds-motion-pw.js <port> [wk]
// tokens, no endless loop on the idle map after the 3-cycle stop, no "transition: all", press scale .96, ÖL! squash + foam,
// sheet close slides (ghost), bar sheet close slides, sub-screen axis class, LIVE ticker tap = stop, reduced motion = still.
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
const WK = process.argv[3] === "wk";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME });
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
    await boot(page);
    const tk = await page.evaluate(() => { const c = getComputedStyle(document.documentElement); return ["--m-1", "--m-2", "--m-3", "--m-4", "--m-5", "--m-6", "--e-std", "--e-in", "--e-out", "--e-spring"].map((k) => k + "=" + c.getPropertyValue(k).trim()); });
    ok(tk.every((x) => !/=$/.test(x)) && tk[0] === "--m-1=50ms" && tk[5] === "--m-6=450ms", "motion tokens on :root", tk);
    // endless loops: wait for the 3-cycle stop (longest loop here ≤ 6.5 s → 3 cycles ≤ 20 s; the sweep runs every 1.5 s)
    await wait(page, 22000);
    const loops = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations === Infinity).map((a) => (a.animationName || "?") + "@" + ((a.effect.target && a.effect.target.className) || "").toString().slice(0, 30)));
    const allowed = loops.filter((x) => !/spin|load|skel|shim|busy|wait|breath|rot/i.test(x));
    console.log("INFO endless loops on the idle map (allowed since owner 13 Nov 16:50: no 3-cycle stop):", JSON.stringify(allowed.slice(0, 8)));
    const tAll = await page.evaluate(() => { const out = []; for (const s of document.styleSheets) { let r; try { r = s.cssRules; } catch (e) { continue; } for (const x of r) if (x.style && /(^|\s|,)all(\s|$)/.test(x.style.transitionProperty || "") && x.style.transitionDuration && !/^0s/.test(x.style.transitionDuration)) out.push(x.selectorText.slice(0, 40)); } return out; });
    ok(!tAll.length, "no transition: all", tAll.slice(0, 6));
    // press scale
    const sc = await page.evaluate(async () => { const b = document.getElementById("btn-groups"); const t = getComputedStyle(b).transitionDuration; return { t }; });
    ok(/0\.1s|100ms/.test(sc.t), "button press uses --m-2 (100 ms)", sc);
    // ÖL! squash then foam on click
    const beer = await page.evaluate(async () => {
      const b = document.getElementById("btn-beer"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      const sq = b.classList.contains("pn-squash"); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      const sp = b.classList.contains("pn-spring");
      return { sq, sp };
    });
    ok(beer.sq && beer.sp, "ÖL!: squash on press, spring on release", beer);
    // sheet close slides: a ghost copy exists right after close
    await clickJS(page, "#btn-more"); await wait(page, 1200);
    const g = await page.evaluate(async () => { const x = document.getElementById("sheet-close"); x.click(); await new Promise((r) => setTimeout(r, 40)); return { ghost: !!document.querySelector(".sm-ghost-host, .sm-bd-out"), hidden: document.getElementById("sheet").hidden }; });
    ok(g.ghost && g.hidden, "sheet close: slides down (ghost copy + backdrop fade)", g);
    // ds18: switch knob + progress bars move with transform only
    const tr = await page.evaluate(() => {
      const out = [];
      const win = new Set();
      for (const sh of document.styleSheets) { let r; try { r = sh.cssRules; } catch (e) { continue; } for (const x of r) if (x.style && x.selectorText && /switch|bar|bt i|tug-us|seg-mark/.test(x.selectorText)) {
        const m = /(?:^|;\s*)transition(?:-property)?\s*:\s*([^;]*)/.exec(x.style.cssText); if (!m) continue;
        const bad = /(^|,|\s)(left|width)(\s|,|$)/.test(m[1]) && !/^\s*(none|0s)/.test(m[1]);
        // a later rule for the same element may win: keep the last verdict per selector
        win.add(x.selectorText + "§" + (bad ? "BAD " + m[1].slice(0, 40) : "ok")); } }
      const last = {}; [...win].forEach((v) => { const [k, w] = v.split("§"); last[k] = w; });
      for (const el of document.querySelectorAll(".switch")) { const c = getComputedStyle(el, "::after").transitionProperty; if (/\b(left|width)\b/.test(c)) out.push(".switch::after computed → " + c); break; }
      const tmp = document.createElement("div"); tmp.className = "mer-bar"; tmp.innerHTML = "<span></span>"; document.body.appendChild(tmp);
      const c2 = getComputedStyle(tmp.firstChild).transitionProperty; tmp.remove(); if (/\bwidth\b/.test(c2)) out.push(".mer-bar span computed → " + c2);
      return out; });
    ok(!tr.length, "switch knob, progress bars, tab marker: no left/width transitions", tr.slice(0, 6));
    // ds18: Grupper tabs: the marker slides (even though the tab bar is rebuilt)
    await clickJS(page, "#btn-groups"); await wait(page, 1500);
    const mk = await page.evaluate(async () => { const t = document.querySelector('.inv-tabs [data-t="f"]'); if (!t) return "no tab";
      let seen = false; const mo = new MutationObserver(() => { if (document.querySelector(".pn-seg-mark")) seen = true; }); mo.observe(document.getElementById("sheet"), { childList: true, subtree: true });
      t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); t.click(); await new Promise((r) => setTimeout(r, 80));
      seen = !!document.querySelector("#sheet .inv-tabs .pn-seg-mark"); mo.disconnect(); await new Promise((r) => setTimeout(r, 300));
      const g = document.querySelector('.inv-tabs [data-t="g"]'); if (g) { g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); g.click(); } await new Promise((r) => setTimeout(r, 600)); return seen ? "slid" : "none"; });
    ok(mk === "slid", "Grupper tabs: the marker slides", mk);
    // sub-screen axis
    await clickJS(page, "#btn-groups"); await wait(page, 1500);
    const ax = await page.evaluate(async () => { const c = document.querySelector(".glist .gcard"); if (!c) return "no card"; c.click(); for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 20)); const b = document.getElementById("sheet-body"); if (b.getAnimations().some((x) => x.id === "pn-ax-in")) return "in"; } return "none"; });
    ok(ax === "in", "sub-screen slides in on the X axis", ax);
    const two = await page.evaluate(() => document.getElementById("sheet-body").getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.getKeyframes().some((k) => k.transform)).length);
    ok(two <= 1, "sub-screen push: one transform animation on #sheet-body", two);
    await page.evaluate(() => { const x = document.getElementById("sheet-close"); if (x) x.click(); }); await wait(page, 600);
    // bar sheet ghost
    await page.waitForFunction(() => window.__map && window.__map.setView, null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => window.__map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(page, 1500);
    await page.evaluate(() => { let m = null; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!m && c && c.bar && String(c.bar.id) === "n3472634175") m = l; }); if (m) m.fire("click"); }); await wait(page, 1500);
    const sp = await page.evaluate(() => { const w = document.querySelector(".olnu-sheet .leaflet-popup-content-wrapper"); const c = w && getComputedStyle(w); return c ? c.animationName + " " + c.animationTimingFunction.slice(0, 12) : "no sheet"; });
    ok(/smSheetIn linear\(/.test(sp) || /smSheetIn cubic-bezier\(0\.2, 1\.2/.test(sp), "bar sheet opens with the spring (like other sheets)", sp);
    const bg = await page.evaluate(async () => { const x = document.querySelector(".olnu-sheet .leaflet-popup-close-button"); if (!x) return "no sheet"; x.click(); await new Promise((r) => setTimeout(r, 40)); return { ghost: !!document.querySelector(".pn-bs-ghost"), sheet: !!document.querySelector(".olnu-sheet") }; });
    ok(bg.ghost && !bg.sheet, "bar sheet close: slides down (ghost, not findable as .olnu-sheet)", bg);
    await wait(page, 400);
    ok(await page.evaluate(() => !document.querySelector(".pn-bs-ghost")), "bar sheet ghost is gone after 260 ms");
    // ticker tap = stop / go
    const tkr = await page.evaluate(async () => { const t = document.querySelector(".ticker"); if (!t) return "no ticker"; t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); t.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300)); const a = { stop: t.classList.contains("pn-tk-stop"), f: window.PN_TICK_F };
      t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); t.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); a.go = !t.classList.contains("pn-tk-stop"); return a; });
    ok(tkr.stop && tkr.f === 0 && tkr.go, "LIVE ticker: tap stops it (readable), tap again goes", tkr);
    await ctx.close();
  }
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page); await wait(page, 1500);
    const run = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect && (a.effect.getTiming().iterations === Infinity || a.effect.getComputedTiming().duration > 1)).map((a) => (a.animationName || a.constructor.name) + "@" + ((a.effect.target && a.effect.target.className) || "").toString().slice(0, 30)));
    ok(!run.length, "reduced motion: nothing moves", run.slice(0, 8));
    const b = await page.evaluate(() => { const b = document.getElementById("btn-beer"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); const s = b.classList.contains("pn-squash"); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); return s; });
    ok(!b, "reduced motion: no ÖL! squash");
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
