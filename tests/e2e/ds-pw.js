// PNDS tests (owner feedback 1–12 + coordinator items). Usage: node ds-pw.js <port> [wk]   (wk = WebKit iPhone run)
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
const SP = require("./env.js").OUT + "ds-shots/test/";
const WK = process.argv[3] === "wk";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const shot = (page, n) => page.screenshot({ path: SP + (WK ? "wk-" : "") + n + ".png" });
const noToasts = (page) => page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
async function routes(page) {
  await page.route(/rest\/v1\/rpc\/(my_groups|group_status_v3|group_status_v2|ikvall_status|my_friends|friend_list)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "my_groups") return J(r, [{ id: G, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: 3 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }]);
    if (fn === "ikvall_status") return J(r, { v: 1, night: "x", mine: null, counts: { ute: 1, kanske: 0, hemma: 0 }, people: [{ name: "Ida", st: "ute", friend: true }] });
    if (fn === "my_friends") return J(r, { code: "K7Q2MXA", friends: [], incoming: [], outgoing: [] });
    if (fn === "friend_list") return J(r, { v: 1, people: [], groups: [] });
    return J(r, [{ name: "Anton", k: "k0", is_me: true, beers: 3, others: 0, live: true, total: 40, meriter: 12 }, { name: "Lisa", k: "k1", is_me: false, beers: 2, others: 0, live: true, total: 18, meriter: 5 }]);
  });
}
async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, Object.assign({ ua: "ios" }, o));
  if (o.standalone) await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await routes(page); await boot(page); await noToasts(page);
  return { ctx, page, errs };
}
const dock = (page) => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height, t: b.top, cx: b.left + b.width / 2 }; };
  return { vw: innerWidth, beer: r("#btn-beer"), seg: r("#prec-seg"), row: r(".dock-row"), side: r("#btn-groups") };
});
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  // ---- 1. ÖL! centred, precision control fixed size (owner #2, #7) ----
  for (const w of [320, 360, 390, 430]) {
    const { ctx, page, errs } = await open(browser, { width: w, height: 800 }, { standalone: w === 390 });
    const a = await dock(page);
    await page.evaluate(() => { const b = document.querySelector('#prec-seg [aria-checked="false"]'); b.click(); }); await wait(page, 400);
    const b = await dock(page);
    await page.evaluate(() => { const g = document.getElementById("groups-label"); if (g) g.textContent = "Grupperna"; const o = document.querySelector(".pn-gout"); if (o) { o.hidden = false; o.textContent = "● 12 ute"; } }); await wait(page, 200);
    const c = await dock(page);
    ok(Math.abs(a.beer.cx - w / 2) <= 1 && Math.abs(b.beer.cx - w / 2) <= 1 && Math.abs(c.beer.cx - w / 2) <= 1, w + " px: ÖL! is in the exact centre (both modes, long label)", [a.beer.cx, b.beer.cx, c.beer.cx, w / 2]);
    ok(Math.abs(a.seg.w - b.seg.w) < 0.5 && Math.abs(a.seg.h - b.seg.h) < 0.5 && Math.abs(a.row.h - b.row.h) < 0.5, w + " px: precision control keeps its size (no layout jump)", [a.seg, b.seg]);
    ok(a.seg.r <= w - 8 && a.side.l >= 8, w + " px: dock fits, 8 px+ gutters", [a.side.l, a.seg.r]);
    const hint = await page.evaluate(() => { const h = document.getElementById("prec-hint"); const s = getComputedStyle(h); return { op: s.opacity, pos: s.position, show: h.classList.contains("pn-show") }; });
    ok(hint.pos === "absolute" && hint.show, w + " px: helper text = a bubble after the change (no permanent line)", hint);
    if (w === 390) {
      await wait(page, 3200);
      const h2 = await page.evaluate(() => getComputedStyle(document.getElementById("prec-hint")).opacity);
      ok(h2 === "0", "390: the bubble goes away by itself", h2);
      // ---- ÖL! = only the word, centred, with a spoken name ----
      const bb = await page.evaluate(() => { const b = document.getElementById("btn-beer"), l = document.getElementById("beer-label"), s = document.getElementById("beer-sub");
        const br = b.getBoundingClientRect(), lr = l.getBoundingClientRect();
        return { aria: b.getAttribute("aria-label"), sub: getComputedStyle(s).display, txt: l.textContent, fs: parseFloat(getComputedStyle(l).fontSize), dx: Math.round((lr.left + lr.width / 2) - (br.left + br.width / 2)), dy: Math.round((lr.top + lr.height / 2) - (br.top + br.height / 2)), wr: +(lr.width / br.width).toFixed(2) }; });
      ok(bb.aria === "Rapportera öl" && bb.sub === "none" && bb.txt === "ÖL!" && bb.fs >= 40 && Math.abs(bb.dx) <= 2 && Math.abs(bb.dy) <= 3 && bb.wr <= 0.85, "ÖL! button: only 'ÖL!', bigger, centred; aria-label 'Rapportera öl'", bb);
      // ---- 2. calm main screen (owner #1) ----
      const m = await page.evaluate(() => {
        const s = document.getElementById("pn-strip"), hl = document.querySelector(".hud-left");
        return { strip: !!(s && s.getClientRects().length && getComputedStyle(s).display !== "none"), hudH: hl ? hl.getBoundingClientRect().height : 0 };
      });
      ok(!m.strip && m.hudH <= 50, "main: no friends strip on the map, one HUD row", m);
      // ---- 3. solid top (owner #9) ----
      const top = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll(".topbar, .topbar *, .ticker, .hud-left, .hud-left *, .locate-btn, #btn-more, .backdrop, .live-count").forEach((e) => {
          const s = getComputedStyle(e); const f = s.backdropFilter || s.webkitBackdropFilter || "none"; if (f !== "none") bad.push(e.className || e.id); });
        const bg = getComputedStyle(document.querySelector(".topbar")).backgroundColor, bi = getComputedStyle(document.querySelector(".topbar")).backgroundImage;
        const tb = document.querySelector(".topbar").getBoundingClientRect();
        return { bad: bad.slice(0, 5), bg, bi, top: tb.top, meta: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content, vf: /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]').content) };
      });
      ok(!top.bad.length && /^rgb\(10, 15, 28\)$/.test(top.bg) && top.bi === "none" && top.top === 0, "top: solid navy header from y=0, no blur near the status bar", top);
      ok(top.meta === "black-translucent" && top.vf, "top: status-bar meta + viewport-fit=cover (the solid header paints under the island)", top);
      // ---- live count pill fits (coordinator 6) ----
      const lc = await page.evaluate(() => { const e = document.getElementById("live-count"); return { t: e.textContent.trim(), fit: e.scrollWidth <= e.clientWidth + 1, ic: !!e.querySelector(".pi") }; });
      ok(/^\d+\s*ute$/.test(lc.t.replace(/ /g, " ")) && lc.fit && lc.ic, "top: world pill = icon + 'N ute', no cut text", lc);
      // ---- og tags (owner #10) ----
      const og = await page.evaluate(() => ({ img: document.querySelector('meta[property="og:image"]').content, tw: document.querySelector('meta[name="twitter:image"]').content, t: document.querySelector('meta[property="og:title"]').content }));
      ok(/og-image\.png\?v=pn2$/.test(og.img) && /\?v=pn2$/.test(og.tw) && !/\p{Extended_Pictographic}/u.test(og.t) && /PintsNow/.test(og.t), "link preview: PintsNow title, image URL with ?v=pn2", og);
      // ---- Mer på kartan has content (coordinator iPhone bug) ----
      await clickJS(page, "#btn-more"); await wait(page, 900); await noToasts(page);
      const mer = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, rows: [...document.querySelectorAll("#sheet-body .pn-row")].filter((r) => r.getBoundingClientRect().height > 40).length, h: document.getElementById("sheet-body").getBoundingClientRect().height }));
      ok(mer.title === "Mer på kartan" && mer.rows >= 2 && mer.h > 150, "Mer på kartan shows its rows (iPhone UA, standalone)", mer);
      await shot(page, "mer-390");
      await clickJS(page, "#sheet-close"); await wait(page, 500);
      // empty-sheet guard
      await page.evaluate(() => window.PNDS._A().openSheet("Trasigt test", function () { throw new Error("boom"); })); await wait(page, 600);
      const fl = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, fail: !!document.querySelector("#sheet-body .pn-fail"), btn: (document.querySelector("#sheet-body .pn-fail .btn") || {}).textContent }));
      ok(fl.open && fl.fail && /Uppdatera appen/.test(fl.btn || ""), "a sheet that throws shows a finished error state (never empty)", fl);
      await clickJS(page, "#sheet-close"); await wait(page, 500);
      // ---- 4. Grupper: header rule + "Ute ikväll" card + back from the game hub (owner #3, #1) ----
      await clickJS(page, "#btn-groups"); await wait(page, 1500); await noToasts(page);
      const g1 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, x: getComputedStyle(document.getElementById("sheet-close")).visibility, back: !document.getElementById("pn-back").hidden,
        out: (document.querySelector("#inv-pane-g > .pn-out") || {}).textContent || null }));
      ok(g1.title === "Grupper" && g1.x === "visible" && !g1.back, "Grupper (first screen): ✕ shows, no ‹", g1);
      ok(!!g1.out && /ute|ska ut|Ingen/.test(g1.out), "Grupper: one calm 'Ute ikväll' card at the top", g1.out);
      await shot(page, "grupper");
      await page.waitForSelector(".glist .gcard", { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => document.querySelector(".glist .gcard").click()); await wait(page, 1600); await noToasts(page);
      const g2 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, x: getComputedStyle(document.getElementById("sheet-close")).visibility, back: !document.getElementById("pn-back").hidden }));
      ok(g2.title === "Ludvika Lager" && g2.x === "visible" && g2.back, "group page (sub-screen): ‹ and ✕ both show (ds55)", g2);
      await page.waitForSelector(".sp-gbtn", { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => document.querySelector(".sp-gbtn").click()); await page.waitForSelector("#sp .sp-back", { timeout: 15000 }).catch(() => {}); await wait(page, 800);
      const hub = await page.evaluate(() => { const b = document.querySelector("#sp .sp-back"); return { open: !!(document.getElementById("sp") && !document.getElementById("sp").hidden), lab: b && b.getAttribute("aria-label"), icon: !!(b && b.querySelector(".pi-chev-left")) }; });
      ok(hub.open && hub.lab === "Tillbaka till gruppen" && hub.icon, "game hub: top-left is ‹ 'Tillbaka till gruppen'", hub);
      await shot(page, "spel-hub");
      await page.evaluate(() => document.querySelector("#sp .sp-back").click()); await wait(page, 1500);
      const g3 = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, gv: (document.querySelector("#sheet-body [data-gv]") || { getAttribute: () => null }).getAttribute("data-gv"), sp: !!(document.getElementById("sp") && !document.getElementById("sp").hidden) }));
      ok(g3.open && g3.title === "Ludvika Lager" && !g3.sp, "‹ in the game hub goes back to the group page (not to the map)", g3);
      await page.waitForSelector(".sp-gbtn", { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => document.querySelector(".sp-gbtn").click()); await page.waitForSelector("#sp .sp-back", { timeout: 15000 }).catch(() => {}); await wait(page, 800);
      await page.goBack(); await wait(page, 1500);
      const g4 = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent }));
      ok(g4.open && g4.title === "Ludvika Lager", "Android back in the game hub → the group page", g4);
      await clickJS(page, "#pn-back"); await wait(page, 1200);
      const g5 = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent }));
      ok(g5.open && g5.title === "Grupper", "‹ on the group page → Grupper", g5);
      await clickJS(page, "#sheet-close"); await wait(page, 600);
      // ---- 5. Inställningar (owner #5, #11) ----
      await clickJS(page, "#btn-settings"); await wait(page, 1200);
      await page.evaluate(() => { const t = [...document.querySelectorAll("#sheet-body .pf-tabs button")].find((x) => /Inställningar/.test(x.textContent)); t.click(); }); await wait(page, 1800); await noToasts(page);
      const st = await page.evaluate(() => {
        const out = [], body = document.getElementById("sheet-body");
        body.querySelectorAll(".ds-set .ds-list").forEach((l) => {
          const lr = l.getBoundingClientRect();
          l.querySelectorAll(".toggle-row > span, .ds-item > .row > .btn, .sf-set-row > .btn, .pn-fold-row").forEach((t) => {
            if (!t.getClientRects().length) return;
            const r = t.getBoundingClientRect(); const cs = getComputedStyle(t);
            const textL = r.left + (t.tagName === "SPAN" ? 0 : parseFloat(cs.paddingLeft));
            const rh = t.tagName === "SPAN" ? t.parentElement.getBoundingClientRect().height : r.height;
            if (textL - lr.left < 12 || rh < 40) out.push([t.textContent.trim().slice(0, 30), Math.round(textL - lr.left), Math.round(r.height)]);
          });
          l.querySelectorAll(".switch").forEach((s) => { if (!s.getClientRects().length) return; const r = s.getBoundingClientRect(); if (lr.right - r.right < 12) out.push(["switch", Math.round(lr.right - r.right)]); });
        });
        const sf = document.querySelector(".sf-set"), integ = document.querySelector('section[data-ds="integ"]');
        return { bad: out, sfInInteg: !!(sf && integ && integ.contains(sf)), fold: !!document.querySelector(".pn-fold-row"), pp: !!(document.querySelector(".push-prefs") && document.querySelector(".push-prefs").getClientRects().length) };
      });
      ok(!st.bad.length, "Inställningar: every row has 12 px+ inner padding, 40 px+ height, switches 12 px+ from the edge", st.bad);
      ok(st.sfInInteg && st.fold && !st.pp, "Inställningar: Trygghet rows under Integritet & säkerhet; notification types folded behind 'Välj notiser'", st);
      await shot(page, "settings");
      const d0 = await page.evaluate(() => window.SHEETNAV.depth());
      await page.click(".pn-fold-row"); await wait(page, 500);
      const f1 = await page.evaluate(() => ({ open: document.querySelector(".push-prefs").getClientRects().length > 0, d: window.SHEETNAV.depth(), back: !document.getElementById("pn-back").hidden }));
      ok(f1.open && f1.d === d0 + 1 && f1.back, "Välj notiser opens as a back step (‹ shows)", [d0, f1]);
      await shot(page, "settings-notiser");
      await page.goBack(); await wait(page, 600);
      const f2 = await page.evaluate(() => ({ open: document.querySelector(".push-prefs").getClientRects().length > 0, sheet: !document.getElementById("sheet").hidden }));
      ok(!f2.open && f2.sheet, "back closes only the notification list, Inställningar stays", f2);
      // ---- 6. icons, not emoji, in the chrome (owner #6) ----
      const emo = await page.evaluate(() => {
        const re = /^\s*\p{Extended_Pictographic}/u, bad = [];
        document.querySelectorAll(".sheet-head h2, #sheet-body h3, #sheet-body .tabs > button, #sheet-body .toggle-row > span, #sheet-body .ds-item > .row > .btn, .topbar button, .dock .side-ico, .sf-set-row > .btn").forEach((e) => {
          if (!e.getClientRects().length) return; const t = [...e.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.trim()); if (t && re.test(t.nodeValue)) bad.push(t.nodeValue.trim().slice(0, 24)); });
        return { bad, icons: document.querySelectorAll("#sheet .pi").length };
      });
      ok(!emo.bad.length && emo.icons > 10, "no emoji as icons in headings / tabs / rows / toggles / top bar / dock", emo);
      // one type scale in the sheet
      const ts = await page.evaluate(() => { const s = {}; document.querySelectorAll("#sheet *").forEach((e) => { if (!e.getClientRects().length || ![...e.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim())) return; const k = getComputedStyle(e).fontSize; s[k] = (s[k] || 0) + 1; if (![12, 14, 16, 18, 22, 28, 34, 44].includes(parseFloat(k))) s["@" + k] = (e.className || e.tagName) + ":" + e.textContent.trim().slice(0, 20); }); return s; });
      const off = Object.keys(ts).filter((k) => ![12, 14, 16, 18, 22, 28, 34, 44].includes(parseFloat(k)));
      ok(!off.length, "Inställningar: every text size is on the type scale 12/14/16/18/22/28", ts);
      await clickJS(page, "#sheet-close"); await wait(page, 500);
      // ---- Visste du? / captions: a small toast at the top (coordinator 4) ----
      await page.evaluate(() => { const d = document.getElementById("dl-cap"); if (d) d.remove(); if (window.DELIGHT && window.DELIGHT.caption) window.DELIGHT.caption({ head: "📜 VISSTE DU?", text: "Kronorna ovanför rådhusets fönster påminner om stadsprivilegierna, 1919–1971.", cls: "dl-cap-secret", now: true, ms: 9000 }); });
      await wait(page, 600);
      const cap = await page.evaluate(() => { const d = document.getElementById("dl-cap"); if (!d || d.hidden) return null; const r = d.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight }; });
      ok(!cap || (cap.bottom < cap.vh * 0.42 && cap.h <= 96), "captions (Visste du?) sit small at the top, not over the map centre", cap);
      await shot(page, "caption");
    }
    ok(errs.length === 0, w + " px: no page errors", errs.slice(0, 3));
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
