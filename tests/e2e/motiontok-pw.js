// motiontok-pw.js — lane motiontok (24 Nov 2026), PLAN D1 "one motion token set". node motiontok-pw.js <port>
//  A  the token set is on :root (--m-1..8, --e-std/in/out/io/pop/spring/lin) and SMOOTH.ms / SMOOTH.ease read it (Web Animations)
//  B  live CSSOM (every sheet, also CSS that JS injects after the screens open): no raw duration under 1 s, no raw easing
//     (same rule as tests/quality/motion.mjs; it fails on the code before D1: 200+ raw values)
//  C  reduced motion = still on the main screens: map, ÖL! press, level pop, takeover, Mer, Grupper + sub-screen, toast.
//     Nothing moves (no running transform / position animation over 1 ms); a fade (opacity / colour only) stays ≤ 150 ms;
//     every element with a CSS animation has a computed duration of 1 ms or less, or the animation only fades.
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 700)); };

// B: in the page. Specified values (cssText keeps var()), media rules included. Mirrors motion.mjs judgeDecl in short.
function cssomRaw() {
  const out = [], TIME = /^[-+]?(?:\d*\.)?\d+(ms|s)$/, KW = /^(ease|ease-in|ease-out|ease-in-out|linear)$/, FN = /^(cubic-bezier|linear)\(/;
  const ms = (t) => parseFloat(t) * (/ms$/.test(t) ? 1 : 1000);
  const split = (s, sep) => { const o = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; else if (ch === ")") d--;
    if (d === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) { if (cur.trim()) o.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) o.push(cur.trim()); return o; };
  const judge = (prop, val) => { const bad = [];
    for (const part of split(val.replace(/!important/, ""), ",")) {
      const ps = split(part, " ");
      if (prop === "-timing-function") { if (KW.test(ps[0]) || FN.test(ps[0])) bad.push(part); continue; }
      if (prop === "-duration") { if (TIME.test(ps[0]) && ms(ps[0]) > 1 && ms(ps[0]) < 1000) bad.push(part); continue; }
      const t = ps.find((p) => TIME.test(p) || /^(var|calc)\(/.test(p) && /--m-|\d(ms|s)/.test(p));
      if (!t || (TIME.test(t) && !(ms(t) > 1))) continue;   // no motion
      if (TIME.test(t) && ms(t) < 1000) bad.push(part);
      else if (ps.some((p) => KW.test(p) || FN.test(p))) bad.push(part);
    }
    return bad; };
  const walk = (rules, href) => { for (const r of rules) {
    if (r instanceof CSSKeyframesRule) { for (const k of r.cssRules) { const v = k.style.getPropertyValue("animation-timing-function"); if (v && judge("-timing-function", v).length) out.push(href + " @keyframes " + r.name + " " + v); } continue; }
    if (r.cssRules && r.cssRules.length) walk(r.cssRules, href);   // @media / @supports, and nested rules (a style rule has cssRules too)
    if (!r.style) continue;
    for (const m of r.style.cssText.matchAll(/(?:^|;\s*)(animation|transition)(-duration|-timing-function)?\s*:\s*([^;]+)/g)) {
      if (/^\s*(none|initial|inherit|unset)\s*(!important)?\s*$/.test(m[3])) continue;
      if (judge(m[2] || "", m[3]).length) out.push(href + " " + (r.selectorText || "").slice(0, 50) + " {" + m[0].replace(/^;\s*/, "").slice(0, 90) + "}");
    }
  } };
  for (const s of document.styleSheets) {   // our sheets only (mapbox-gl.css from the CDN is not ours)
    if (s.href && new URL(s.href).origin !== location.origin) continue;
    let rules; try { rules = s.cssRules; } catch (e) { continue; } walk(rules, (s.href || "inline").split("/").pop()); }
  return out;
}

// C: what moves now, and what has a CSS animation longer than 1 ms
function stillReport() {
  const FADE = /^(opacity|visibility|fill|stroke|fill-?opacity|stroke-?opacity|box-?shadow|text-?shadow|filter)$|colou?r$/i;   // fades and colour, no movement
  const fadeOnly = {};   // keyframes name -> true when it only changes opacity / colour
  for (const s of document.styleSheets) { let rules; try { rules = s.cssRules; } catch (e) { continue; }
    const each = (rs) => { for (const r of rs) { if (r instanceof CSSKeyframesRule) { let f = true; for (const k of r.cssRules) for (let i = 0; i < k.style.length; i++) if (!FADE.test(k.style[i]) && !/^animation-timing-function$/.test(k.style[i])) f = false; fadeOnly[r.name] = f; } else if (r.cssRules && r.cssRules.length) each(r.cssRules); } };
    each(rules); }
  const moving = [], longFade = [];
  for (const a of document.getAnimations()) {
    if (a.playState !== "running" || !a.effect) continue;
    const t = a.effect.getComputedTiming(), d = +t.duration || 0;
    if (!(d > 1)) continue;
    const props = new Set();
    if (a.transitionProperty) props.add(a.transitionProperty);
    try { for (const k of a.effect.getKeyframes()) for (const p in k) if (!/^(offset|easing|composite|computedOffset)$/.test(p)) props.add(p); } catch (e) {}
    const tg = a.effect.target, who = (a.animationName || a.transitionProperty || a.id || "waapi") + "@" + (tg ? (tg.id || String(tg.className || tg.tagName)).slice(0, 30) : "?") + " " + Math.round(d) + "ms";
    if ([...props].some((p) => !FADE.test(p))) moving.push(who + " [" + [...props].join(",") + "]");
    else if (d > 150 || t.iterations === Infinity) longFade.push(who);
  }
  const css = [];
  for (const el of document.querySelectorAll("*")) for (const ps of [null, "::before", "::after"]) {
    const c = getComputedStyle(el, ps); if (!c.animationName || c.animationName === "none") continue;
    const ds = c.animationDuration.split(",").map((x) => parseFloat(x) * (/ms/.test(x) ? 1 : 1000)), names = c.animationName.split(",").map((x) => x.trim());
    names.forEach((n, i) => { const d = ds[i % ds.length]; if (d > 1 && !(fadeOnly[n] && d <= 150)) css.push(n + "@" + (el.id || String(el.className || el.tagName)).slice(0, 30) + (ps || "") + " " + d + "ms"); });
  }
  return { moving, longFade, css: [...new Set(css)] };
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME });
  // ---------- A + B: normal motion ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
    await boot(page); await wait(page, 800);
    const tk = await page.evaluate(() => { const c = getComputedStyle(document.documentElement), g = (k) => c.getPropertyValue(k).trim();
      return { m: ["--m-1", "--m-2", "--m-3", "--m-4", "--m-5", "--m-6", "--m-7", "--m-8"].map(g), io: g("--e-io"), pop: g("--e-pop"), lin: g("--e-lin"), spring: g("--e-spring").slice(0, 12),
        js: window.SMOOTH && SMOOTH.ms ? [SMOOTH.ms("--m-5", -1), SMOOTH.ms("--m-8", -1), SMOOTH.ease("--e-in", "x")] : null }; });
    ok(tk.m.join() === "50ms,100ms,150ms,200ms,300ms,450ms,600ms,900ms", "A tokens: --m-1..8 = 50/100/150/200/300/450/600/900 ms", tk.m);
    ok(tk.io === "cubic-bezier(.42,0,.58,1)" && tk.pop === "cubic-bezier(.2,1.4,.4,1)" && tk.lin === "linear" && /^(linear\(|cubic)/.test(tk.spring), "A tokens: --e-io, --e-pop, --e-lin, --e-spring", tk);
    ok(tk.js && tk.js[0] === 300 && tk.js[1] === 900 && tk.js[2] === "cubic-bezier(.05,.7,.1,1)", "A Web Animations read the tokens (SMOOTH.ms / SMOOTH.ease)", tk.js);
    // open the screens so their JS-injected CSS is in, then read every sheet
    await clickJS(page, "#btn-more"); await wait(page, 900);
    await page.evaluate(() => { const x = document.getElementById("sheet-close"); if (x) x.click(); }); await wait(page, 400);
    await clickJS(page, "#btn-groups"); await wait(page, 1200);
    await page.evaluate(() => { const x = document.getElementById("sheet-close"); if (x) x.click(); }); await wait(page, 400);
    await page.evaluate(() => { try { window.FX.levelPop({ emoji: "x", intensity: 3 }); } catch (e) {} }); await wait(page, 300);
    const raw = await page.evaluate(cssomRaw);
    ok(!raw.length, "B live CSSOM: no raw duration under 1 s and no raw easing (CSS files + CSS that JS injected): " + raw.length, raw.slice(0, 12));
    // the sheet still slides with the spring token (motion19a: Web Animation, tokens read at run time)
    const sh = await page.evaluate(async () => { document.getElementById("btn-more").click(); await new Promise((r) => setTimeout(r, 60));
      const a = document.getElementById("sheet").getAnimations().find((x) => !x.animationName); const t = a && a.effect.getTiming(); return t ? { d: t.duration, e: t.easing.slice(0, 10) } : null; });
    ok(sh && sh.d === 300 && /^linear\(|^cubic/.test(sh.e), "A the sheet opens in --m-5 with --e-spring", sh);
    await ctx.close();
  }
  // ---------- C: reduced motion = still ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page); await wait(page, 1500);
    const steps = [
      ["map", async () => {}],
      ["ÖL! press", async () => page.evaluate(() => { const b = document.getElementById("btn-beer"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); try { window.FX.juice.press(b); } catch (e) {} })],
      ["level pop", async () => page.evaluate(() => { try { window.FX.levelPop({ emoji: "x", intensity: 3 }); } catch (e) {} })],
      ["takeover", async () => page.evaluate(() => { try { window.FX.takeover(1, { title: "x", sub: "y", icon: "x", hint: "x", noAmbient: true }); } catch (e) {} })],
      ["takeover close", async () => page.evaluate(() => { const t = document.querySelector(".takeover"); if (t) t.click(); })],
      ["toast", async () => page.evaluate(() => { try { window.PN.toast("motiontok"); } catch (e) {} })],
      ["Mer sheet", async () => clickJS(page, "#btn-more")],
      ["sheet close", async () => page.evaluate(() => { const x = document.getElementById("sheet-close"); if (x) x.click(); })],
      ["Grupper", async () => clickJS(page, "#btn-groups")],
      ["sub-screen", async () => page.evaluate(() => { const c = document.querySelector(".glist .gcard"); if (c) c.click(); })],
    ];
    for (const [name, go] of steps) {
      await page.waitForTimeout(700);   // the takeover tap guard is 400 ms
      await go();
      await page.waitForTimeout(50);    // inside every motion window (the shortest token is 50 ms)
      const r = await page.evaluate(stillReport);
      ok(!r.moving.length, "C reduced motion, " + name + ": nothing moves", r.moving.slice(0, 6));
      ok(!r.longFade.length && !r.css.length, "C reduced motion, " + name + ": CSS animations ≤ 1 ms (a fade ≤ 150 ms)", { fade: r.longFade.slice(0, 4), css: r.css.slice(0, 6) });
    }
    await ctx.close();
  }
  console.log(`\nmotiontok: ${pass} PASS, ${fail} FAIL`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
