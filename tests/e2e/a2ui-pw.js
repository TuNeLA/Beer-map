// lane a2ui: I-05 toast system, I-16/I-23 one row + divider, I-21 start-up shift, I-22 Ikväll choice at first paint, I-26 drink icons.
// Usage: node a2ui-pw.js <port>
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };

async function routes(page, o = {}) {
  await page.route(/rest\/v1\/rpc\/(my_groups|group_status_v3|group_status_v2|ikvall_status|my_friends|friend_list)$/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "my_groups") return J(r, [{ id: G, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: 3 }]);
    if (fn === "ikvall_status") {
      if (o.ikvDelay) await new Promise((res) => setTimeout(res, o.ikvDelay));
      return J(r, { v: 1, night: "x", mine: o.ikvServer === undefined ? null : o.ikvServer, counts: { ute: 1, kanske: 0, hemma: 0 }, people: [] });
    }
    if (fn === "my_friends") return J(r, { code: "K7Q2MXA", friends: [], incoming: [], outgoing: [] });
    if (fn === "friend_list") return J(r, { v: 1, people: [], groups: [] });
    return J(r, [{ name: "Anton", k: "k0", is_me: true, beers: 3, others: 0, live: true, total: 40, meriter: 12 }, { name: "Lisa", k: "k1", is_me: false, beers: 2, others: 0, live: true, total: 18, meriter: 5 }]);
  });
}
async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, o);
  if (o.init) await page.addInitScript(o.init, o.initArg);
  await routes(page, o);
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return { ctx, page };
}
const toastRect = (page) => page.evaluate(() => {
  const t = document.querySelector("#toasts > .toast:last-child"); if (!t) return null;
  const r = t.getBoundingClientRect(), hd = document.querySelector(".topbar"), hr = hd ? hd.getBoundingClientRect() : { bottom: 0 };
  const beer = document.getElementById("btn-beer").getBoundingClientRect(), gr = document.getElementById("btn-groups").getBoundingClientRect();
  return { l: r.left, r: r.right, w: r.width, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, hdB: hr.bottom, beerT: beer.top, grT: gr.top,
    txt: t.textContent, icon: !!t.querySelector(".pn-toast-i svg"), hasEmoji: /\p{Extended_Pictographic}/u.test(t.textContent) };
});
const fire = (page, msg, o) => page.evaluate(([m, o]) => { window.PNDS._A().toast(m, o || {}); }, [msg, o]);

(async () => {
  const browser = await pw.chromium.launch(require("./env.js").CHROME ? { executablePath: require("./env.js").CHROME } : {});

  /* ---------- I-05 toast ---------- */
  for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const { ctx, page } = await open(browser, vp);
    await fire(page, "🔕 Tyst. Inga notiser från Rickard.", { ms: 0, id: "t1" }); await wait(page, 700);
    let r = await toastRect(page);
    const tag = "[" + vp.width + " map] ";
    ok(r && Math.abs((r.l + r.r) / 2 - r.vw / 2) <= 1.5, tag + "toast centred", r && [r.l, r.r, r.vw]);
    ok(r && r.w <= 420.5 && r.l >= 15.5 && r.r <= r.vw - 15.5, tag + "max 420 px, 16 px margin", r && r.w);
    ok(r && r.b <= Math.min(r.beerT, r.grT) + 0.5, tag + "above ÖL! / Grupper", r && [r.b, r.beerT, r.grT]);
    ok(r && r.t > r.hdB, tag + "never over the header", r && [r.t, r.hdB]);
    ok(r && r.icon && !r.hasEmoji, tag + "PNI icon, no emoji", r && r.txt);
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    // sheet open
    await clickJS(page, "#btn-settings"); await wait(page, 1200);
    await fire(page, "Koden kopierad", { ms: 0, id: "t2" }); await wait(page, 700);
    r = await toastRect(page);
    const tg = "[" + vp.width + " sheet] ";
    ok(r && Math.abs((r.l + r.r) / 2 - r.vw / 2) <= 1.5, tg + "toast centred", r && [r.l, r.r, r.vw]);
    ok(r && r.w <= 420.5, tg + "max 420 px", r && r.w);
    ok(r && r.t > r.hdB + 60, tg + "never over the header (bottom place)", r && [r.t, r.hdB]);
    ok(r && r.b <= r.vh - 8 && r.b >= r.vh - 120, tg + "16 px over the bottom edge", r && [r.b, r.vh]);
    // composer: a text field low in the sheet; the toast keeps above it
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "a2-comp"; i.type = "text"; i.style.cssText = "position:fixed;left:16px;right:16px;bottom:12px;height:48px;z-index:3000"; document.getElementById("sheet").appendChild(i); });
    await wait(page, 1000);
    const c = await page.evaluate(() => { const t = document.querySelector("#toasts > .toast:last-child"), i = document.getElementById("a2-comp"); return t && i ? [t.getBoundingClientRect().bottom, i.getBoundingClientRect().top] : null; });
    ok(c && c[0] <= c[1] + 0.5, tg + "above the composer", c);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    // max 2 stacked
    await page.evaluate(() => { const b = document.getElementById("toasts"); for (let i = 0; i < 4; i++) { const t = document.createElement("div"); t.className = "toast"; t.innerHTML = "<span>Rad " + i + "</span>"; b.appendChild(t); } });
    await wait(page, 300);
    const n = await page.evaluate(() => document.querySelectorAll("#toasts > .toast").length);
    ok(n === 2, "max 2 toasts stacked", n);
    // swipe to dismiss
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    await fire(page, "Swipa bort mig", { ms: 0, id: "sw" }); await wait(page, 500);
    const b = await page.evaluate(() => { const r = document.querySelector("#toasts > .toast").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 60, b.y, { steps: 4 }); await page.mouse.move(b.x + 160, b.y, { steps: 4 }); await page.mouse.up();
    await wait(page, 500);
    ok((await page.evaluate(() => document.querySelectorAll("#toasts > .toast").length)) === 0, "swipe dismisses the toast");
    await ctx.close();
  }

  /* ---------- I-16 / I-23 rows ---------- */
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    await clickJS(page, "#btn-settings"); await wait(page, 1500);
    const p = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#sheet-body .ds-list > .ds-row")].filter((x) => x.getClientRects().length);
      const lists = new Set(rows.map((x) => x.parentNode));
      const L = [...lists][0];
      const rs = [...L.children].filter((x) => x.classList.contains("ds-row"));
      const cs = rs.map((x) => getComputedStyle(x));
      const ic = rs.map((x) => x.querySelector(".ds-row-i").getBoundingClientRect()), bb = rs.map((x) => x.getBoundingClientRect());
      return { n: rs.length, minH: Math.min(...bb.map((r) => r.height)), icW: ic.map((r) => Math.round(r.width)), firstBg: getComputedStyle(rs[0], "::before").content, restBg: rs.slice(1).map((x) => { const b = getComputedStyle(x, "::before"); return b.content === '""' && b.height === "1px" && b.left === "52px"; }),
        title: rs.map((x) => getComputedStyle(x.querySelector(".ds-row-t > span")).fontSize), sub: rs.map((x) => { const s = x.querySelector("small"); return s ? getComputedStyle(s).fontSize : ""; }),
        radius: getComputedStyle(L).borderTopLeftRadius, icCy: ic.map((r, i) => Math.abs(r.top + r.height / 2 - (bb[i].top + bb[i].height / 2))) };
    });
    ok(p.n >= 4, "Profil list has rows", p.n);
    ok(p.minH >= 63.5, "rows >= 64 px", p.minH);
    ok(p.icW.every((w) => w === 24), "icons 24 px", p.icW);
    ok(p.title.every((f) => f === "16px") && p.sub.every((f) => f === "" || f === "14px"), "one title size 16, sub 14", [p.title, p.sub]);
    ok((p.firstBg === "none" || p.firstBg === "normal") && p.restBg.every(Boolean), "divider on every row but the first (I-23)", [p.firstBg, p.restBg]);
    ok(p.radius === "16px", "list radius 16", p.radius);
    ok(p.icCy.every((d) => d < 2), "icon centred to the text lines", p.icCy);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    await clickJS(page, "#btn-groups"); await wait(page, 1400);
    await page.evaluate(() => { const c = document.querySelector(".glist .gcard"); if (c) c.click(); }); await wait(page, 1800);
    await page.evaluate(() => { const f = [...document.querySelectorAll("#sheet-body button, #sheet-body summary")].find((x) => /Ikväll/.test(x.textContent) && /Jag kör|Skåltimmen/.test(x.textContent)); if (f) f.click(); }); await wait(page, 1200);   // d2group: the Ikväll button says "Kamera, Skåltimmen, Spel…"
    const g = await page.evaluate(() => {
      const w = document.querySelector('#sheet .gpg[data-gv="plus"]'); if (!w) return null;
      const tiles = [...w.querySelectorAll(":scope > .sa-gl.a2-row")].filter((t) => t.getClientRects().length).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top), out = [];
      tiles.forEach((t) => {
        const b = t.querySelector(":scope > .btn"); if (!b) return;
        const br = b.getBoundingClientRect(), s = b.querySelector("svg"), sr = s && s.getBoundingClientRect();
        const cs = getComputedStyle(b), gs = b.querySelector('[class$="-gs"]');
        out.push({ first: t.classList.contains("a2-first"), last: t.classList.contains("a2-last"), h: Math.round(br.height), fs: cs.fontSize, ic: sr ? Math.round(sr.width) : 0,
          icLeft: sr ? sr.left < br.left + 40 : false, icCy: sr ? Math.abs(sr.top + sr.height / 2 - (br.top + br.height / 2)) : 99, gsFs: gs ? getComputedStyle(gs).fontSize : "",
          gap: 0, top: br.top, bottom: br.bottom, tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius });
      });
      return out;
    });
    ok(g && g.length >= 4, "group Ikväll view has tiles", g && g.length);
    if (g) {
      ok(g.every((x) => x.h >= 63), "all tiles >= 64 px (even row height)", g.map((x) => x.h));
      ok(g.every((x) => x.fs === "16px"), "one title size", g.map((x) => x.fs));
      ok(g.every((x) => x.ic === 24 && x.icLeft), "icon left, 24 px", g.map((x) => [x.ic, x.icLeft]));
      ok(g.every((x) => x.icCy < 2.5), "icon centred to the 2 lines", g.map((x) => x.icCy));
      ok(g.every((x) => x.gsFs === "" || x.gsFs === "14px"), "sub size 14", g.map((x) => x.gsFs));
      ok(g.filter((x) => x.first).every((x) => x.tl === "16px") && g.filter((x) => x.last).every((x) => x.bl === "16px"), "even radius at section ends", g.map((x) => [x.first, x.last, x.tl, x.bl]));
      let gaps = []; for (let i = 1; i < g.length; i++) if (!g[i].first) gaps.push(Math.abs(g[i].top - g[i - 1].bottom));
      ok(gaps.every((d) => d < 1.5), "no gap inside a section", gaps);
      ok(g.filter((x) => x.first).length >= 2 && g.filter((x) => x.last).length === g.filter((x) => x.first).length, "one card per section (first/last pairs)", g.map((x) => [x.first, x.last]));
    }
    await ctx.close();
  }

  /* ---------- I-21 start-up shift of the bottom bar ---------- */
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__cls = []; window.__dockRects = [];
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls.push({ v: e.value, t: Math.round(e.startTime), src: (e.sources || []).map((s) => (s.node && (s.node.id || s.node.className || s.node.nodeName)) + ":" + Math.round(s.previousRect.x) + "," + Math.round(s.previousRect.y) + "," + Math.round(s.previousRect.height) + ">" + Math.round(s.currentRect.x) + "," + Math.round(s.currentRect.y) + "," + Math.round(s.currentRect.height)) }); }).observe({ type: "layout-shift", buffered: true });
      } catch (e) {}
      const rec = () => { const o = document.getElementById("btn-other"), b = document.getElementById("btn-beer"), g = document.getElementById("btn-groups");
        if (b && b.getClientRects().length) window.__dockRects.push([o && o.getClientRects().length ? Math.round(o.getBoundingClientRect().left * 10) / 10 : null, Math.round(b.getBoundingClientRect().left * 10) / 10, g ? Math.round(g.getBoundingClientRect().left * 10) / 10 : null, Math.round(performance.now())]); };
      const iv = setInterval(rec, 50); setTimeout(() => clearInterval(iv), 9000);
    });
    await routes(page); await boot(page); await wait(page, 4500);
    const r = await page.evaluate(() => ({ cls: window.__cls, dock: window.__dockRects }));
    const bar = r.cls.filter((c) => c.src.some((s) => /dock|btn-beer|btn-other|other-wrap|beer-wrap|btn-groups|side-btn|dock-row|other-label|beer-label|groups-label/.test(s)));
    ok(bar.reduce((a, c) => a + c.v, 0) === 0, "CLS of the bottom bar = 0", bar);
    const dk = r.dock.filter((d) => d[3] > 700), od = dk.filter((d) => d[0] != null).map((d) => d[0]);
    ok(od.length > 0 && Math.max(...od) - Math.min(...od) < 0.6, "ANNAT left edge never moves", [Math.min(...od), Math.max(...od)]);
    const bd = dk.map((d) => d[1]), gd = dk.map((d) => d[2]);
    ok(Math.max(...bd) - Math.min(...bd) < 0.6 && Math.max(...gd) - Math.min(...gd) < 0.6, "ÖL! and Grupper never move", [Math.min(...bd), Math.max(...bd), Math.min(...gd), Math.max(...gd)]);
    await ctx.close();
  }

  /* ---------- I-22 Ikväll choice at first paint, after reload, new night ---------- */
  {
    const spy = () => {
      window.__ikv = [];
      const look = () => { const c = document.getElementById("pn-ikv2"); if (c && !c.hidden && c.textContent.trim()) { const t = c.textContent.trim(); if (!window.__ikv.length || window.__ikv[window.__ikv.length - 1] !== t) window.__ikv.push(t); } };
      new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
      document.addEventListener("DOMContentLoaded", look);
    };
    const night = (t) => { const d = new Date(t - 5 * 3600000); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
    const { ctx, page } = await open(browser, { width: 390, height: 844 }, { ikvDelay: 2500, ikvServer: null, init: spy });
    await page.evaluate((n) => localStorage.setItem("olnu.pnIkvMine", JSON.stringify({ mine: "ute", night: n })), night(Date.now()));
    await page.reload(); await page.waitForFunction(() => document.getElementById("pn-ikv2") && !document.getElementById("pn-ikv2").hidden, null, { timeout: 20000 }).catch(() => {});
    await wait(page, 300);
    let seq = await page.evaluate(() => window.__ikv);
    ok(seq.length > 0 && /Ute/.test(seq[0]), "chip shows the saved choice (Ute) in the first paint, after a reload", seq);
    await wait(page, 4500);
    seq = await page.evaluate(() => window.__ikv);
    ok(seq.every((s) => /Ute/.test(s)) || seq.length === 1, "no flip of the chip text while the server answer is slow", seq);
    // a choice made by the user is saved with the night id
    const sv = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.pnIkvMine") || "null"));
    ok(sv && sv.mine === "ute" && /^\d+-\d+-\d+$/.test(sv.night), "choice saved with night id", sv);
    await ctx.close();
    // fake 05:00 next day: the saved choice of the old night is dropped → "Ikväll?"
    const off = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(5, 1, 0, 0); return d.getTime() - Date.now(); })();
    const b = await open(browser, { width: 390, height: 844 }, { ikvServer: null, init: (a) => { const RD = Date, off = a.off; window.Date = class extends RD { constructor(...x) { if (x.length) super(...x); else super(RD.now() + off); } static now() { return RD.now() + off; } }; }, initArg: { off } });
    await b.page.evaluate((n) => localStorage.setItem("olnu.pnIkvMine", JSON.stringify({ mine: "ute", night: n })), night(Date.now()));
    await b.page.reload(); await wait(b.page, 3500);
    const txt = await b.page.evaluate(() => { const c = document.getElementById("pn-ikv2"); return c ? c.textContent.trim() : null; });
    ok(txt && /Ikväll\?/.test(txt), "after 05:00 (new night) the chip is back to Ikväll?", txt);
    await b.ctx.close();
  }

  /* ---------- I-26 drink icons ---------- */
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    await page.evaluate(() => document.getElementById("btn-other").click()); await wait(page, 1500);
    const d = await page.evaluate(async () => {
      const bs = [...document.querySelectorAll(".kind-btn[data-kind]")];
      const kinds = bs.map((b) => b.getAttribute("data-kind"));
      const svgs = bs.map((b) => b.querySelector(".kb-e svg"));
      const sizes = svgs.map((s) => s ? Math.round(s.getBoundingClientRect().width) : 0);
      const emoji = bs.some((b) => /\p{Extended_Pictographic}/u.test(b.querySelector(".kb-e").textContent));
      const px = [];
      for (const s of svgs) {
        if (!s) { px.push(null); continue; }
        const x = new XMLSerializer().serializeToString(s).replace(/currentColor/g, "#000");
        const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x.replace(/width="24" height="24"/, 'width="28" height="28"'));
        await img.decode();
        const c = document.createElement("canvas"); c.width = 28; c.height = 28; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 28, 28);
        const a = g.getImageData(0, 0, 28, 28).data, m = []; for (let i = 3; i < a.length; i += 4) m.push(a[i] > 60 ? 1 : 0); px.push(m);
      }
      let minD = 1, pair = "";
      for (let i = 0; i < px.length; i++) for (let j = i + 1; j < px.length; j++) {
        if (!px[i] || !px[j]) { minD = 0; pair = kinds[i] + "/" + kinds[j]; continue; }
        let u = 0, n = 0; for (let k = 0; k < px[i].length; k++) { if (px[i][k] || px[j][k]) u++; if (px[i][k] !== px[j][k]) n++; }
        const v = u ? n / u : 0; if (v < minD) { minD = v; pair = kinds[i] + "/" + kinds[j]; }
      }
      return { kinds, sizes, emoji, minD, pair, html: new Set(svgs.map((s) => s && s.innerHTML)).size };
    });
    ok(d.kinds.length === 9, "Sidospår shows 9 kinds", d.kinds);
    ok(d.sizes.every((s) => s === 28), "each icon 28 px", d.sizes);
    ok(!d.emoji && d.html === 9, "own PNI icons, no emoji, 9 different drawings", [d.emoji, d.html]);
    ok(d.minD >= 0.3, "icons clearly different at 28 px (min pixel difference)", [d.minD, d.pair]);
    await page.screenshot({ path: (process.env.TEST_OUT || "/tmp/") + "a2ui-sidospar.png" });
    await ctx.close();
  }

  await browser.close();
  console.log("a2ui: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
