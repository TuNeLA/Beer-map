// invite-pw.js — lane invite, item E1 (audit product.md B2.1 / blind test P1-6): inviting a friend took 5 taps from the map
// (Grupper → group card → Bjud in → Dela länk → the app). Now: Grupper → a group pill in "Bjud in en kompis" → the app = 3 taps
// (docs/js/invite.js quickBox / quickShare, docs/invite.css .inv-q). The links are the SAME as the JOIN sheet (join.js), so old
// and new app versions both open them. QR + group code stay one tap away. 390 px, mocked Supabase. Usage: node invite-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const env = require("./env.js");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };

// share: "ok" (records the data), "abort" (the user closes the share sheet), "none" (no Web Share API: desktop)
async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await ctx.addInitScript((mode) => {
    window.__shared = []; window.__copied = [];
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); } catch (e) {}
    if (mode === "none") { try { Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined }); delete navigator.share; } catch (e) {} return; }
    navigator.share = (d) => { window.__shared.push(d); return mode === "abort" ? Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) : Promise.resolve(); };
  }, o.share || "ok");
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.pnOb", "1"); } catch (e) {} });   // no "Vem går du ut med?" sheet (pnui.js, 0 groups)
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (o.groups) await page.route(/rest\/v1\/rpc\/my_groups$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o.groups) }));
  await boot(page);
  await page.waitForFunction(() => window.INVITE && window.JOIN && document.getElementById("btn-groups"), null, { timeout: 15000 }).catch(() => console.log("no INVITE"));
  await wait(page, 300);
  // the app is Swedish only (i18n.js SAFE, owner 7 Nov); the en texts stay for later: force I18N.lang to check them
  if (o.lang === "en") await page.evaluate(() => Object.defineProperty(window.I18N, "lang", { configurable: true, get: () => "en" }));
  return { ctx, page, errs };
}
const vis = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => {
  const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && r.top >= 0 && r.bottom <= innerHeight;
}).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), aria: e.getAttribute("aria-label") || "", code: e.getAttribute("data-code"), w: r.width, h: r.height, l: r.left, r: r.right }; }), sel);
// Tap count from the map: tap 1 = the Grupper button; then the in-app taps until navigator.share has the group link; +1 = the app in
// the OS share sheet. Searches the first screen for a visible invite control (old code: none there → more than 3 taps).
async function tapsToShare(page, code) {
  await page.tap("#btn-groups"); await wait(page, 1500);
  const cands = await page.evaluate(() => [...document.querySelectorAll("#sheet button, #sheet [role=button]")].filter((e) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== "none" && r.top >= 0 && r.bottom <= innerHeight &&
      /bjud in|invite|dela/i.test(e.textContent + " " + (e.getAttribute("aria-label") || "")) && !e.closest(".gcard");
  }).map((e, i) => { e.setAttribute("data-e1", String(i)); return i; }));
  for (const i of cands) {
    await page.evaluate(() => { window.__shared = []; });
    await page.tap('[data-e1="' + i + '"]'); await wait(page, 300);
    const s = await page.evaluate(() => window.__shared.slice());
    if (s.some((d) => String(d.url).indexOf(code) >= 0)) return 1 + 1 + 1;
  }
  return 99;
}

(async () => {
  const browser = await chromium.launch({ executablePath: env.CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  try {
    // 1. the tap count (FAILS on the old code: no invite control on the first Grupper screen)
    let { ctx, page, errs } = await open(browser);
    const taps = await tapsToShare(page, "ABC234");
    ok("E1 invite from the map in 3 taps or fewer (Grupper → pill → app)", taps <= 3, { taps });
    await page.screenshot({ path: env.OUT + "invite-after-grupper.png" });
    const pills = await vis(page, ".inv-q-p"), qr = await vis(page, ".inv-q-qr");
    ok("E1 one pill per group, in the list order", pills.length === 2 && pills[0].code === "ABC234" && pills[1].code === "XYZ789", pills);
    ok("E1 pills + QR button are 44 px targets, inside the screen", pills.concat(qr).every((p) => p.h >= 44 && p.w >= 44 && p.l >= 0 && p.r <= 390) && qr.length === 1, { pills, qr });
    const box = await page.evaluate(() => { const b = document.querySelector(".inv-q"), h = b && b.parentNode.querySelector("h3"); return { to: b && b.querySelector(".inv-q-to").textContent,
      sub: b && b.querySelector("small").textContent, beforeList: !!(b && h && (b.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)), tab: b && b.closest("#inv-pane-g") ? 1 : 0 }; });
    ok("E1 box sits in the Grupper tab, above Mina grupper, sv text (fixD P-29: title \"Bjud in en kompis\" + \"Till:\" over the pills)", box.tab === 1 && box.beforeList && box.to === "Bjud in en kompis" && box.sub.length > 5, box);

    // 2. the links = the JOIN sheet links (old + new versions read them)
    const mine = await page.evaluate(() => { window.__shared = []; document.querySelector('.inv-q-p[data-code="XYZ789"]').click(); return window.__shared[0]; });
    ok("E1 second pill shares its own group", mine && /XYZ789/.test(mine.url) && /by=Anton/.test(mine.url), mine);
    const emo = /\p{Extended_Pictographic}/u;
    ok("E1 share text names the group, no emoji, no drink push", mine && /Jobbet/.test(mine.text) && !emo.test(mine.text) && !/(öl|beer|drick|drink|supa|full)\b/i.test(mine.text.replace(/PintsNow/g, "")), mine);
    await page.evaluate(() => { window.__shared = []; window.JOIN.openGroup({ name: "Ludvika Lager", code: "ABC234" }, false); });
    await wait(page, 600);
    await page.evaluate(() => document.querySelector(".jn-share").click()); await wait(page, 200);
    const jn = await page.evaluate(() => window.__shared[0]), q1 = await page.evaluate(() => window.INVITE.quickLink({ code: "ABC234" }));
    ok("E1 the quick link is the same link as the JOIN sheet (Dela länk)", jn && jn.url === q1, { jn: jn && jn.url, q1 });
    const plain = await page.evaluate(() => { const C = window.CARDS, keep = C.on; C.on = () => false; const g = window.INVITE.quickLink({ code: "abc234" }), a = window.INVITE.quickLink(null); C.on = keep;
      const u = new URL(g), v = new URL(a); return { g, a, join: u.searchParams.get("join"), by: u.searchParams.get("by"), inv: v.searchParams.get("invite"), same: u.origin + u.pathname === location.origin + location.pathname }; });
    ok("E1 without the card: the old ?join=CODE&by= / ?invite=1 links (old site reads them)", plain.join === "ABC234" && plain.by === "Anton" && plain.inv === "1" && plain.same, plain);
    ok("E1 no page errors", errs.length === 0, errs);
    await ctx.close();

    // 3. the old path still works (rules kept: the group page Bjud in → JOIN sheet with QR + code)
    ({ ctx, page, errs } = await open(browser));
    await page.tap("#btn-groups"); await wait(page, 1200);
    await page.evaluate(() => document.querySelector(".inv-q-qr").click()); await wait(page, 800);
    const qrs = await page.evaluate(() => ({ qr: !!document.querySelector(".jn-qr canvas, .jn-qr img"), code: (document.querySelector(".jn-code-v") || {}).textContent, share: !!document.querySelector(".jn-share") }));
    ok("E1 QR button opens the JOIN sheet: QR + group code + Dela länk", qrs.qr && qrs.code === "ABC234" && qrs.share, qrs);
    await ctx.close();

    // 4. no group: the app link
    ({ ctx, page, errs } = await open(browser, { groups: [] }));
    await page.tap("#btn-groups"); await wait(page, 1500);
    const zero = await vis(page, ".inv-q-p");
    ok("E1 no group: one pill with the app link", zero.length === 1 && zero[0].code === "" && /appen/.test(zero[0].t), zero);
    const zs = await page.evaluate(() => { window.__shared = []; document.querySelector(".inv-q-p").click(); return window.__shared[0]; });
    ok("E1 no group: shares the invite link", zs && /invite/.test(zs.url) && /PintsNow/.test(zs.text), zs);
    await page.screenshot({ path: env.OUT + "invite-after-nogroup.png" });
    await ctx.close();

    // 5. no Web Share API: copy text + link, ONE toast
    ({ ctx, page, errs } = await open(browser, { share: "none" }));
    await page.tap("#btn-groups"); await wait(page, 1500);
    await page.tap('.inv-q-p[data-code="ABC234"]'); await wait(page, 500);
    const cp = await page.evaluate(() => ({ c: window.__copied.slice(), toasts: [...document.querySelectorAll(".toast")].filter((t) => /kopierad/.test(t.textContent)).length }));
    ok("E1 no share API: the text + link is copied, one toast", cp.c.length === 1 && /ABC234/.test(cp.c[0]) && /Ludvika Lager/.test(cp.c[0]) && cp.toasts === 1, cp);
    await ctx.close();

    // 6. the user closes the share sheet: nothing else happens
    ({ ctx, page, errs } = await open(browser, { share: "abort" }));
    await page.tap("#btn-groups"); await wait(page, 1500);
    await page.tap('.inv-q-p[data-code="ABC234"]'); await wait(page, 500);
    const ab = await page.evaluate(() => ({ s: window.__shared.length, c: window.__copied.length, toasts: [...document.querySelectorAll(".toast")].filter((t) => /kopierad/.test(t.textContent)).length }));
    ok("E1 share closed (AbortError): no copy, no toast", ab.s === 1 && ab.c === 0 && ab.toasts === 0, ab);
    await ctx.close();

    // 7. English (helper L) + a long group name
    ({ ctx, page, errs } = await open(browser, { lang: "en", groups: [{ id: "g9", name: "Den väldigt långa gruppen med ett namn som aldrig tar slut", code: "LNG234", member_count: 3, active_count: 0 }] }));
    await page.tap("#btn-groups"); await wait(page, 1500);
    const en = await page.evaluate(() => { const b = document.querySelector(".inv-q"), p = b.querySelector(".inv-q-p"), r = p.getBoundingClientRect();
      return { to: b.querySelector(".inv-q-to").textContent, aria: p.getAttribute("aria-label"), qr: b.querySelector(".inv-q-qr").getAttribute("aria-label"), l: r.left, r: r.right, sw: document.documentElement.scrollWidth }; });
    ok("E1 English texts", en.to === "Invite a friend" && /^Invite to /.test(en.aria) && /QR/.test(en.qr), en);
    ok("E1 a long name stays inside the box (ellipsis), no side scroll", en.l >= 0 && en.r <= 390 && en.sw <= 390, en);
    const es = await page.evaluate(() => { window.__shared = []; document.querySelector(".inv-q-p").click(); return window.__shared[0]; });
    ok("E1 English share text", es && /LNG234/.test(es.url) && /(Join|backup|drafted|gang)/.test(es.text), es);
    ok("E1 no page errors (en)", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.message); }
  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
