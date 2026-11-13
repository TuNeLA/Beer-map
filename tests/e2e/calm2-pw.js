// calm2-pw.js — lane calm2 (owner 13 Nov, I-79 / I-82 / I-84 / I-80; spec POPUP-RULES.md "Our rules").
//  A  a burst of 13 medals + a "+1 merit" + a done mission = at most ONE toast line, and only when idle on the map
//  B  one Skål tap = exactly ONE toast (the answer); the merit, mission and medal news after it do not pop up
//  C  no medal toast while a sheet is open + the chat input is focused (even right after a tap); no unlock sheet over a sheet
//  D  "Ingen data här ikväll än": max once per night per phone; never when the header already says nobody is out
//  K  the chat input stays above a 300 px keyboard (DM): resizes-visual (visualViewport mock) and resizes-content (viewport)
// Mocked Supabase (ds-helpers). Each check FAILS on the base (e9481e4) and PASSES on calm2. usage: node calm2-pw.js <port> [only]
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const ONLY = new RegExp(process.argv[3] || ".");
const DMG = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 500)); c ? pass++ : fail++; };
const shot = (page, n) => page.screenshot({ path: SP + "logs/calm2-" + n + ".png" }).catch(() => {});
// every toast that ever shows (text), and a fake visualViewport (Android resizes-visual: innerHeight stays, vv.height shrinks)
const init = () => {
  window.__toasts = [];
  const go = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
    .observe(document.getElementById("toasts"), { childList: true });
  if (document.getElementById("toasts")) go(); else document.addEventListener("DOMContentLoaded", go);
  const real = window.visualViewport, et = new EventTarget(); let kb = 0;
  const fake = { get height() { return window.innerHeight - kb; }, get width() { return window.innerWidth; }, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    addEventListener: (a, b, c) => et.addEventListener(a, b, c), removeEventListener: (a, b, c) => et.removeEventListener(a, b, c), dispatchEvent: (e) => et.dispatchEvent(e) };
  if (real) { real.addEventListener("resize", () => et.dispatchEvent(new Event("resize"))); }
  Object.defineProperty(window, "visualViewport", { configurable: true, get() { return fake; } });
  window.__kb = (px) => { kb = px; et.dispatchEvent(new Event("resize")); window.dispatchEvent(new Event("resize")); };
};
async function server(page) {
  const msgs = []; for (let i = 0; i < 14; i++) msgs.push({ id: 501 + i, name: i % 2 ? "Anton" : "Ida", body: "Meddelande nummer " + (i + 1) + " – lite text så raden blir längre", created_at: iso(60 - i), is_me: !!(i % 2) });
  await page.route(/rest\/v1\/rpc\/(my_dms|group_keep_history|group_now|group_msgs|post_group_msg|group_photos|group_voices|avatars_for)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (b.p_group_id !== DMG && fn !== "my_dms") return r.fallback();
    switch (fn) {
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [Object.assign(RPCF.dmThread(DMG), { last_id: 514, last_body: "x", last_at: iso(5), last_me: false, unread: 0, at: iso(5), out: true })] });
      case "group_keep_history": case "group_now": return J(r, { code: "P0001", message: "not_member" }, 400);
      case "group_msgs": return J(r, msgs.filter((m) => m.id > (b.p_after_id | 0)));
      case "post_group_msg": return J(r, { id: 600, created_at: new Date().toISOString() });
      case "group_photos": case "group_voices": return J(r, []);
      case "avatars_for": return J(r, { v: 1, people: [] });
    }
    return r.fallback();
  });
}
async function start(browser, vp) {
  const { ctx, page } = await ctxFor(browser, vp || { width: 390, height: 844 });
  await ctx.addInitScript(init);
  await server(page);
  await boot(page);
  await page.evaluate(() => { window.__toasts = []; document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
  return { ctx, page };
}
const tap = (page) => page.evaluate(() => { const m = document.getElementById("map"); ["pointerdown", "pointerup", "click"].forEach((e) => m.dispatchEvent(new MouseEvent(e, { bubbles: true }))); });
const idle = (page) => page.evaluate(() => { if (window.CALM) { CALM._reset(); CALM._idle(30000); } });
const closeAll = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden) document.getElementById("sheet-close").click(); if (document.activeElement) document.activeElement.blur(); });
const openDm = (page) => page.evaluate((g) => window.DM.open(Object.assign({ group_id: g, name: "Ida" })), DMG);
const MEDALS13 = () => { for (let i = 0; i < 13; i++) PN.toast(i === 5 ? "🎖️ 🎯 Uppdragstagaren ×13" : "🎖️ Ny medalj: 🍺 Medalj " + (i + 1) + "!", { cls: "badge-toast medal-toast", ms: 5000 }); };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    if (ONLY.test("A")) {
      const { ctx, page } = await start(browser);
      await closeAll(page); await idle(page); await wait(page, 300);
      await page.evaluate(() => { window.__toasts = []; });
      await page.evaluate(MEDALS13);
      await page.evaluate(() => { PN.toast("+1 merit · 🍻 Skål given! Generositet ä en dygd i fält.", { cls: "mer-toast", ms: 3600 });
        PN.toast("🏅 Medaljen ä på väg med posten. Den kommer om tre till fem arbetsdagar.", { cls: "promo pn-news", ms: 6000 }); });
      await wait(page, 9000);
      const t = await page.evaluate(() => window.__toasts.slice());
      await shot(page, "A-burst");
      ok("A burst of 13 medals + merit + mission = at most ONE toast line", t.length <= 1, t);
      ok("A the one line counts the medals (\"13 medaljer\") and has no +1 merit", t.length === 1 && /13 medaljer/.test(t[0]) && !/merit/.test(t[0]), t);
      await ctx.close();
    }
    if (ONLY.test("B")) {
      const { ctx, page } = await start(browser);
      await closeAll(page); await idle(page); await wait(page, 300);
      await page.evaluate(() => { window.__toasts = []; });
      await tap(page);
      await page.evaluate(() => {
        PN.toast("🍻 Skål skickad till Enberg!", { cls: "skal" });
        setTimeout(() => PN.toast("+1 merit · 🍻 Skål given! Generositet ä en dygd i fält.", { cls: "mer-toast", ms: 3600 }), 1400);
        setTimeout(() => PN.toast("🏅 Medaljen ä på väg med posten. Den kommer om tre till fem arbetsdagar.", { cls: "promo pn-news", ms: 6000 }), 1900);
        setTimeout(() => PN.toast("🎖️ 🎯 Uppdragstagaren ×13", { cls: "badge-toast medal-toast", ms: 5000 }), 2300);
        setTimeout(() => PN.toast("Gruppen har 3 ute nu", {}), 3000);
      });
      await wait(page, 3600);
      const t = await page.evaluate(() => window.__toasts.slice());
      ok("B one Skål tap = exactly ONE toast in the first 3.5 s (the answer)", t.length === 1 && /Skål skickad/.test(t[0]), t);
      await ctx.close();
    }
    if (ONLY.test("C")) {
      const { ctx, page } = await start(browser);
      await closeAll(page); await idle(page);
      await openDm(page); await wait(page, 2500);
      const inp = await page.$("#sheet .chat-input input, #sheet .chat-input textarea");
      if (inp) await inp.click(); await wait(page, 200);
      await page.evaluate(() => { window.__toasts = []; PN.toast("🎖️ Ny medalj: 🧣 Halsduken!", { cls: "badge-toast medal-toast", ms: 5000 }); });
      await wait(page, 6000);
      const t = await page.evaluate(() => window.__toasts.slice());
      ok("C no medal toast while the DM chat is open and the input is focused (right after a tap)", !t.some((x) => /medalj|Halsduk/i.test(x)), t);
      const u = await page.evaluate(() => new Promise((res) => {
        if (!window.CALM || !CALM.unlock) return res("no CALM.unlock");
        let ran = false; CALM.unlock(() => { ran = true; }, 1); setTimeout(() => res(ran ? "ran" : "held"), 2500);
      }));
      ok("C the unlock sheet waits while a sheet is open + typing", u === "held", u);
      await closeAll(page); await page.evaluate(() => CALM._idle(30000));
      await wait(page, 4000);
      const t2 = await page.evaluate(() => window.__toasts.slice());
      await shot(page, "C-after");
      ok("C after the chat closes (idle on the map) the medal comes as ONE quiet line", t2.filter((x) => /Halsduk/.test(x)).length === 1, t2);
      await ctx.close();
    }
    if (ONLY.test("D")) {
      const { ctx, page } = await start(browser);
      await closeAll(page); await idle(page);
      const ND = "Ingen data här ikväll än: ingen har tryckt ÖL! i närheten. Bli först!";
      const n = await page.evaluate((nd) => new Promise((res) => {
        const lc = document.getElementById("live-count"); lc.setAttribute("data-out", "4"); lc.textContent = "Ludvika · några";
        window.__toasts = [];
        PN.toast(nd, { id: "pn-nodata", ms: 5000, cls: "pn-nodata" });
        setTimeout(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); PN.toast(nd, { id: "pn-nodata", ms: 5000, cls: "pn-nodata" }); }, 600);
        setTimeout(() => res(window.__toasts.filter((x) => /Ingen data/.test(x)).length), 1500);
      }), ND);
      ok("D 'Ingen data här' max once per night (2 map moves = 1 toast)", n === 1, n);
      await page.reload(); await wait(page, 4000);
      const n2 = await page.evaluate((nd) => new Promise((res) => {
        window.__toasts = []; PN.toast(nd, { id: "pn-nodata", ms: 5000, cls: "pn-nodata" });
        setTimeout(() => res(window.__toasts.filter((x) => /Ingen data/.test(x)).length), 800);
      }), ND);
      ok("D … and not again after a reload the same night (localStorage)", n2 === 0, n2);
      await page.evaluate(() => { try { localStorage.removeItem("olnu.calm.nd"); } catch (e) {} });
      const n3 = await page.evaluate((nd) => new Promise((res) => {
        const lc = document.getElementById("live-count"); lc.setAttribute("data-out", "0"); lc.textContent = "Ludvika · lugnt";
        window.__toasts = []; PN.toast(nd, { id: "pn-nodata", ms: 5000, cls: "pn-nodata" });
        setTimeout(() => res(window.__toasts.filter((x) => /Ingen data/.test(x)).length), 800);
      }), ND);
      ok("D never when the header already says 'lugnt' (nobody out)", n3 === 0, n3);
      await ctx.close();
    }
    if (ONLY.test("K")) {
      for (const mode of ["visual", "content"]) {
        const { ctx, page } = await start(browser, { width: 390, height: 844 });
        await closeAll(page);
        await openDm(page); await wait(page, 2500);
        const sel = "#sheet .chat-input input, #sheet .chat-input textarea";
        const inp = await page.$(sel);
        if (!inp) { ok("K[" + mode + "] DM chat input found", false); await ctx.close(); continue; }
        await inp.click(); await wait(page, 200);
        if (mode === "visual") await page.evaluate(() => window.__kb(300));
        else { await page.evaluate(() => { Object.defineProperty(window, "visualViewport", { configurable: true, get() { return undefined; } }); }); await page.setViewportSize({ width: 390, height: 544 }); await page.evaluate(() => window.dispatchEvent(new Event("resize"))); }
        await wait(page, 900);
        const g = await page.evaluate((s) => {
          const i = document.querySelector(s).getBoundingClientRect(), vh = mode2() ;
          function mode2() { return window.visualViewport ? window.visualViewport.height : window.innerHeight; }
          const L = document.querySelector("#sheet .chat-list"), last = L && L.lastElementChild ? L.lastElementChild.getBoundingClientRect() : null, Lr = L ? L.getBoundingClientRect() : null;
          return { inBottom: Math.round(i.bottom), inTop: Math.round(i.top), vh: Math.round(vh), lastBottom: last ? Math.round(last.bottom) : null, listBottom: Lr ? Math.round(Lr.bottom) : null,
            listTop: Lr ? Math.round(Lr.top) : null, focus: document.activeElement === document.querySelector(s) };
        }, sel);
        await shot(page, "K-" + mode);
        ok("K[" + mode + "] the chat input row sits above a 300 px keyboard (input bottom <= visual viewport " + g.vh + ")", g.inBottom <= g.vh && g.inTop > 60, g);
        ok("K[" + mode + "] the last message is in view above the input", g.lastBottom != null && g.lastBottom <= g.listBottom + 2 && g.lastBottom <= g.inTop + 2 && g.lastBottom > g.listTop, g);
        if (mode === "visual") {
          // I-87: no lines under the input, the 7-day fact in the DM header, send = round icon, mic + camera fold while typing
          const s87 = await page.evaluate(() => {
            const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
            const sb = document.querySelector("#sheet .chat-send"), r = sb ? sb.getBoundingClientRect() : null;
            const txt = sb ? [...sb.childNodes].filter((n) => n.nodeType === 3 ? n.textContent.trim() : vis(n) && n.tagName !== "svg" && n.textContent.trim()).length : -1;
            return { note: vis(document.querySelector("#sheet-body > .chat-note")), tip: vis(document.querySelector("#sheet-body > .cmx-tip")),
              head: (document.querySelector("#sheet-body .dm-cpriv") || {}).textContent || "", send: r ? { w: Math.round(r.width), h: Math.round(r.height), txt, aria: sb.getAttribute("aria-label") } : null };
          });
          ok("I-87 no 'Privat linje' / 'Tryck på ett meddelande' lines under the input", !s87.note && !s87.tip, s87);
          ok("I-87 the DM header says 'försvinner efter 7 dagar'", /7 dagar/.test(s87.head), s87.head);
          const ov = await page.evaluate(() => { const t = document.querySelector("#sheet-body .dm-cpriv > span"), b = document.querySelector("#sheet-body .dm-mute"); if (!t || !b) return { miss: true };
            const r = document.createRange(); r.selectNodeContents(t); const rs = [...r.getClientRects()], br = b.getBoundingClientRect();
            return { right: Math.round(Math.max(...rs.map((x) => x.right))), bell: Math.round(br.left), lines: rs.length }; });
          ok("I-87 the DM subtitle never runs under the bell button (it wraps)", !ov.miss && ov.right <= ov.bell, ov);
          ok("I-87 send = round icon only (>= 44x44, no text, aria-label Skicka)", s87.send && s87.send.txt === 0 && s87.send.w >= 44 && s87.send.h >= 44 && Math.abs(s87.send.w - s87.send.h) <= 2 && /Skicka/.test(s87.send.aria || ""), s87.send);
          const w = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : -1; }, sel);
          const mic0 = await w("#sheet .chat-input .af-mic"), cam0 = await w("#sheet .chat-input .ph-btn"), in0 = await w(sel);
          await page.keyboard.type("Yoooo"); await wait(page, 450);
          const mic1 = await w("#sheet .chat-input .af-mic"), cam1 = await w("#sheet .chat-input .ph-btn"), in1 = await w(sel);
          ok("I-87 typing: mic + camera fold away, the field gets wider", mic0 > 30 && cam0 > 30 && mic1 <= 1 && cam1 <= 1 && in1 > in0 + 60, { mic0, cam0, in0, mic1, cam1, in1 });
          await page.fill(sel, ""); await wait(page, 450);
          const mic2 = await w("#sheet .chat-input .af-mic"), cam2 = await w("#sheet .chat-input .ph-btn");
          ok("I-87 empty field: mic + camera come back", mic2 > 30 && cam2 > 30, { mic2, cam2 });
          await page.evaluate(() => window.__kb(0)); await wait(page, 600);
          const h = await page.evaluate(() => { const s = document.getElementById("sheet"); return { b: Math.round(s.getBoundingClientRect().bottom), ih: innerHeight, inl: s.style.bottom }; });
          ok("K[visual] keyboard closed: the sheet goes back to the bottom", Math.abs(h.b - h.ih) <= 14, h);
        }
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  console.log(`\ncalm2: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
