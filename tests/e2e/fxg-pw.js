// fxg test: bar sheet (no window.__map), group page, members, chat runs, ‹ + ✕, warm stale-after-write, icons. node fxg-pw.js <port> [wk]
process.argv[2] = process.argv[2] || "8793";
const { ctxFor, wait, clickJS } = require("./ds-helpers.js");
const { routes, G } = require("./fxg-data.js");
const SCAN = () => { const out = []; const roots = [document.getElementById("sheet"), document.querySelector(".leaflet-popup")].filter(Boolean);
  const re = /^\s*\p{Extended_Pictographic}/u;
  roots.forEach((r) => { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!re.test(n.nodeValue)) continue; const e = n.parentElement; if (!e || !e.getClientRects().length) continue;
    if (e.closest(".chat-list .cm-body, .gpg-msgs, .tk-track, .sp-cards")) continue; out.push(e.tagName + "." + String(e.className).slice(0, 30) + " < " + String(e.parentElement.className).slice(0, 30) + " : " + n.nodeValue.trim().slice(0, 30)); } });
  return out; };

const pw = require("playwright");
const WK = process.argv[3] === "wk", BASE = `http://127.0.0.1:${process.argv[2]}/`;
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
async function start(browser, url, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { checkin: false });
  const log = []; await routes(page, { log });
  if (o.noMapHook) await page.addInitScript(() => { Object.defineProperty(window, "__map", { configurable: false, get() { return undefined; }, set() {} }); });
  await page.goto(BASE + (url || "")); await page.waitForFunction(() => window.SOCIAL && window.PNI, null, { timeout: 30000 }); await wait(page, 3000);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  return { ctx, page, log };
}
async function openGroup(page) {
  await clickJS(page, "#btn-groups");
  await page.waitForFunction(() => [...document.querySelectorAll(".glist .gcard")].some((x) => /Vänner/.test(x.textContent)), null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Vänner/.test(x.textContent)); if (c) c.click(); });
  await page.waitForSelector(".gpg .gpg-now", { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
}
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME });
  // ---------- 1. bar sheet, like the app (no window.__map) ----------
  {
    const { ctx, page } = await start(browser, "?bar=n3472634175", { noMapHook: true }); await wait(page, 3500);
    const r = await page.evaluate(() => {
      const p = document.querySelector(".leaflet-popup"); if (!p) return null;
      const x = p.querySelector(".leaflet-popup-close-button"), b = x.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const fr = p.querySelector(".pn-bs-fr2");
      return { root: p.classList.contains("pn-bs7-root"), xsvg: !!x.querySelector("svg.pi-x"), xtop: !!(hit && (hit === x || x.contains(hit))), xw: Math.round(b.width), xr: Math.round(innerWidth - b.right),
        fr: fr && fr.textContent, frChat: !!(fr && fr.querySelector("[data-dmpin] svg.pi-chat")), frSkal: !!(fr && fr.querySelector(".skal-btn[data-skal] svg.pi-cheers")), frBeer: !!(fr && fr.querySelector(".pn-bs-fs svg.pi-beer")),
        oldFr: !!p.querySelector(".pn-bs-fr"), clock: !!p.querySelector(".bi-line svg.pi-clock"), thumbs: p.querySelectorAll(".sp-b svg.pi-thumb-up, .sp-b svg.pi-thumb-down").length };
    });
    ok(r && r.root, "bar: ds07 code runs without window.__map (pn-bs7-root)", r);
    ok(r && r.xsvg && r.xtop && r.xw === 44 && r.xr >= 14 && r.xr <= 18, "bar: ✕ is the x icon, 44 px, on top (no dark arc), 16 px from the edge", r);
    ok(r && /Milos/.test(r.fr) && /1/.test(r.fr) && /ikväll/.test(r.fr) && r.frBeer && !r.oldFr, "bar: friend row = name + '1 [beer] ikväll' (no initials line)", r);
    ok(r && r.frChat && r.frSkal, "bar: friend quick actions Chatta + Skål", r);
    ok(r && r.clock && r.thumbs === 2, "bar: info rows use PNI (clock, thumb-up/down)", r);
    const emo = (await page.evaluate(SCAN)).filter((x) => !/ticker|tk-|dl-cap|ute-wx/.test(x));
    ok(!emo.some((x) => /pn-bs-info|bi-line|sp-l|pn-bs-fr/.test(x)), "bar: no emoji icons in friend / info rows", emo);
    await page.evaluate(() => { const b = document.querySelector(".pn-bs-chat"); if (b) b.click(); }); await wait(page, 1500);
    ok(await page.evaluate(() => !document.getElementById("sheet").hidden), "bar: Chatta opens a chat sheet (dm_open)");
    await ctx.close();
  }
  // ---------- 2. group page ----------
  {
    const { ctx, page } = await start(browser); await openGroup(page);
    const g = await page.evaluate(() => {
      const w = document.querySelector(".gpg"), vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
      const sp = document.querySelector(".sp-gi .sp-gt"), op = document.querySelector(".gpg-chat-o"), txt = getComputedStyle(document.body).getPropertyValue("--ds-text");
      return { beer: vis(document.querySelector(".gpg-beer")), inv: vis(w.querySelector(".pn-gp-inv")) && /Bjud in/.test(w.querySelector(".pn-gp-inv").textContent) && !!w.querySelector(".pn-gp-inv svg.pi-user-plus"),
        ikv: vis(w.querySelector(".gpg-plus")) && /Ikväll/.test(w.querySelector(".gpg-plus").textContent), about: vis(w.querySelector(".gpg-dots")) && /Om gruppen/.test(w.querySelector(".gpg-dots").textContent),
        spCol: sp && getComputedStyle(sp).color, spFont: sp && getComputedStyle(sp).fontFamily, opCol: op && getComputedStyle(op).color, amber: "rgb(255, 194, 77)",
        tiles: [...w.querySelectorAll(".pn-gp-ti")].map((t) => getComputedStyle(t).color), spSub: (document.querySelector(".sp-gi .sp-gs") || {}).textContent };
    });
    ok(!g.beer, "group: no ÖL! bar on the group page");
    ok(g.inv, "group: explicit 'Bjud in' button with person-plus", g);
    ok(await page.evaluate(() => { const c = document.querySelector(".gpg > .pn-gp-code"); return !!c && c.getClientRects().length > 0 && /ABC234/.test(c.textContent); }), "group: [ds60] group code on the main screen");
    ok(await page.evaluate(() => !document.querySelector("#sheet-body .gpg") || ![...document.querySelectorAll("#sheet-body button")].some((b) => /^Skapa grupp$|Har du en kod/.test(b.textContent.trim()) && b.getClientRects().length)), "group: [ds60] no create / join rows on the group page");
    ok(g.ikv && g.about, "group: labelled 'Ikväll' button + 'Om gruppen' row", g);
    ok(g.spCol !== g.amber && !/Black Ops/.test(g.spFont) && g.opCol !== g.amber, "group: Spel title + 'Öppna' not yellow", g);
    ok(/^\d+ spel · /.test(g.spSub || ""), "group: Spel sub '15 spel · Skämskort, Kungaleken…'", g.spSub);
    ok(new Set(g.tiles).size >= 3, "group: tinted accent icon tiles (≥ 3 accents)", g.tiles);
    await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 80; }); await wait(page, 300);
    ok(await page.evaluate(() => document.getElementById("sheet").classList.contains("pn-scrolled") && /gradient/.test(getComputedStyle(document.getElementById("sheet-body")).webkitMaskImage || getComputedStyle(document.getElementById("sheet-body")).maskImage || "")),
      "group: scrolled body fades under the header (mask)");
    await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; });
    await clickJS(page, ".gpg-plus"); await wait(page, 600);
    const pl = await page.evaluate(() => ({ gv: document.querySelector(".gpg").getAttribute("data-gv"), bar: [...document.querySelectorAll(".gpg-bar")].some((e) => e.getClientRects().length && getComputedStyle(e).display !== "none"),
      back: document.getElementById("sheet").classList.contains("pn-has-back"), x: getComputedStyle(document.getElementById("sheet-close")).visibility }));
    ok(pl.gv === "plus" && !pl.bar, "group: Ikväll opens the tonight list (bottom bar hidden there)", pl);
    ok(pl.back && pl.x === "visible", "sub-screen: ‹ and ✕ both show", pl);
    await clickJS(page, "#pn-back"); await wait(page, 400);
    await clickJS(page, ".pn-gp-inv"); await wait(page, 1200);
    ok(/Bjud in/.test(await page.textContent("#sheet-title")), "group: Bjud in opens the invite sheet", await page.textContent("#sheet-title"));
    await ctx.close();
  }
  // ---------- 3. members + 4. chat ----------
  {
    const { ctx, page } = await start(browser); await openGroup(page);
    await clickJS(page, ".gpg-dots"); await wait(page, 600);
    await page.evaluate(() => { const r = [...document.querySelectorAll(".gpg-row")].find((x) => /Medlemmar/.test(x.textContent)); r.click(); }); await wait(page, 2500);
    const m = await page.evaluate(() => {
      const L = document.querySelector(".st-list").getBoundingClientRect(), rows = [...document.querySelectorAll(".st-row")];
      const r0 = rows[0], av = r0.querySelector(".av").getBoundingClientRect(), rb = r0.querySelector(".role-b"), n = r0.querySelector(".st-n");
      return { n: rows.length, names: rows.map((r) => r.querySelector(".st-nm").textContent).slice(0, 4), avInset: Math.round(av.left - L.left), avW: Math.round(av.width),
        roleBorder: rb && getComputedStyle(rb).borderTopWidth, roleBg: rb && getComputedStyle(rb).backgroundColor, nTxt: n.textContent, nCol: getComputedStyle(n).color,
        leftBorder: getComputedStyle(r0).borderLeftWidth, milos: (rows.find((r) => /Milos/.test(r.textContent)) || {}).querySelector(".st-n svg.pi-beer") ? 1 : 0, emo: /🎖|🍺/.test(document.querySelector(".st-list").textContent) };
    });
    ok(m.names.join() === "oggelito,Anton,Robert,Milos", "members: server (meriter) order kept", m.names);
    ok(m.avInset >= 15 && m.avW === 40 && m.leftBorder === "0px", "members: avatar 40 px, 16 px inset, no coloured left border", m);
    ok(m.roleBorder === "0px" && m.roleBg !== "rgba(0, 0, 0, 0)", "members: role = neutral pill (no amber box)", m);
    ok(m.nTxt === "Inga öl" && m.nCol !== "rgb(255, 194, 77)" && m.milos === 1 && !m.emo, "members: status grey 'Inga öl' / count with beer glyph, no emoji", m);
    await page.evaluate((g) => window.SOCIAL.openChat({ id: g, name: "Vänner" }), G); await wait(page, 2500);
    const c = await page.evaluate(() => {
      const lis = [...document.querySelectorAll(".chat-list > .chat-msg")], vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
      return lis.map((li) => ({ who: li.getAttribute("data-who"), first: li.classList.contains("av-first"), last: li.classList.contains("av-last"), name: vis(li.querySelector(".cm-name")) ? li.querySelector(".cm-name").textContent : "",
        pic: !!li.querySelector(":scope > .av-pic") }));
    });
    const runsOk = c.every((x) => x.who === "me" ? !x.pic && !x.name : (x.pic === x.last) && (x.first ? x.name === x.who.slice(2) : x.name === ""));
    ok(c.length === 8 && runsOk, "chat: name on the first bubble of a run, avatar on the last, mine plain", c);
    ok(!c.some((x) => /Generalmajor|Överste|🎖/.test(x.name)), "chat: the name is the member-list name (no rank prefix)");
    ok(await page.evaluate(() => !!document.querySelector(".ux-cog svg.pi-gear") && Math.round(document.querySelector(".ux-cog").getBoundingClientRect().width) === 44), "chat: settings = 44 px round gear");
    await ctx.close();
  }
  // ---------- 5. friends sub-view: ‹ + ✕, avatars ----------
  {
    const { ctx, page } = await start(browser);
    await clickJS(page, "#btn-groups"); await wait(page, 1000); await page.click('.inv-tabs button[data-t="f"]').catch(() => {}); await wait(page, 1800);
    ok(await page.evaluate(() => document.querySelectorAll(".nr-frow > .av").length === 2 && !/🍺|🌙/.test(document.querySelector(".nr-flist, #inv-pane-f").textContent)), "friends: rows with avatars, no 🍺 / 🌙");
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button, #sheet-body summary")].find((x) => /väns kod/.test(x.textContent)); if (b) b.click(); }); await wait(page, 1000);
    const s = await page.evaluate(() => ({ back: document.getElementById("sheet").classList.contains("pn-has-back"), x: getComputedStyle(document.getElementById("sheet-close")).visibility, title: document.getElementById("sheet-title").textContent }));
    ok(!s.back || s.x === "visible", "friends: a sub-view with ‹ also shows ✕", s);
    await ctx.close();
  }
  // ---------- 6. warm: stale-after-write for self-patching calls ----------
  {
    const { ctx, page } = await start(browser);
    await page.mouse.click(5, 400);   // a trusted gesture (writes after a gesture make the cache dirty)
    const w = await page.evaluate(async () => {
      const W = window.WARM; let n = 0; const raw = (fn) => { n++; return Promise.resolve({ data: { v: 1, out: [], now: String(Date.now() + n) }, error: null }); };
      const p = { p_group_id: "x-1" };
      W.openWin(800); await W.rpc("group_now", p, raw);
      W.rpc("post_group_msg", { p_body: "x" }, () => Promise.resolve({ data: {}, error: null }));   // a write → dirty
      const p2 = { p_group_id: "x-2" }; W.openWin(800); await W.rpc("group_now", p2, raw);
      W.rpc("post_group_msg", { p_body: "y" }, () => Promise.resolve({ data: {}, error: null }));   // dirty again (p2 was cached before it)
      W.openWin(800); const n0 = n; const a = await W.rpc("group_now", p, raw); const coldAfterWrite = a.warm === undefined;
      await new Promise((r) => setTimeout(r, 4300));
      const p_ = p; 
      W.openWin(800); const n1 = n; const b = await W.rpc("group_now", p2, raw); await new Promise((r) => setTimeout(r, 50));
      return { coldAfterWrite, served: b.warm !== undefined, reval: n > n1, net0: n0 };
    });
    ok(w.coldAfterWrite, "warm: right after a write the call waits for the server", w);
    ok(w.served && w.reval, "warm: 4 s after the write group_now is instant from the cache + re-fetched", w);
    await ctx.close();
  }
  // ---------- 7. icons ----------
  {
    const { ctx, page } = await start(browser);
    const ic = await page.evaluate(() => ({ t: ["thumb-up", "thumb-down", "gear", "user-plus", "beer", "moon"].every((n) => window.PNI.has(n)), g: window.PNI._I.gear[0].length > 200 && window.PNI._I.gear[1] === "c 12 12 3",
      e: window.PNI.EMOJI["👍"] === "thumb-up" && window.PNI.EMOJI["🪖"] === "medal" }));
    ok(ic.t && ic.g && ic.e, "icons: new gear (8 teeth + hole), thumbs, emoji map", ic);
    await ctx.close();
  }

  // ---------- 8. usability fixes (ds41 check-out, ds47 Ute nu + invite back, ds48 gang strip + info cards) ----------
  {
    const { ctx, page } = await start(browser, "?bar=n3472634175", { noMapHook: true }); await wait(page, 3500);
    await page.evaluate(() => { const b = document.querySelector(".leaflet-popup .ci-btn"); if (b) b.click(); });
    await page.waitForFunction(() => !!document.querySelector(".leaflet-popup .ci-out[data-ciout]"), null, { timeout: 12000 }).catch(() => {});
    const co = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup"); return { out: !!(p && p.querySelector(".ci-out[data-ciout]")), dead: !!(p && [...p.querySelectorAll(".ci-btn")].some((b) => /incheckad/i.test(b.textContent))) }; });
    ok(co.out && !co.dead, "check-in: the button becomes 'Checka ut' at once (no dead 'Du ä incheckad här')", co);
    await ctx.close();
  }
  {
    const { ctx, page } = await start(browser); await openGroup(page); await wait(page, 800);
    await clickJS(page, "#sheet-close"); await wait(page, 800); await openGroup(page); await wait(page, 800);   // 2nd open: the strip comes from the cache (no pop-in)
    const gs = await page.evaluate(() => { const m = document.querySelector(".pn-gp-mem"), vis = m && !m.hidden && m.getClientRects().length > 0;
      return { vis, n: m ? m.querySelectorAll(".pn-gp-mi").length : 0, first: m && m.querySelector(".pn-gp-mn") && m.querySelector(".pn-gp-mn").textContent, beer: !!(m && m.querySelector(".pn-gp-mc.has svg.pi-beer")),
        line: (document.querySelector(".gmain .gsub") || {}).textContent || "" }; });
    ok(gs.vis && gs.n === 12 && gs.first === "Milos" && gs.beer, "group: Gänget ikväll strip (faces, live first, count + beer glyph)", gs);
    ok(/1 av 15/.test(gs.line), "group: status line from group_now (one source)", gs.line);
    await clickJS(page, ".gpg-dots"); await wait(page, 600);
    const ci = await page.evaluate(() => { const c = document.querySelector(".gpg .chief-gi"), w = document.querySelector(".gpg"); return c ? Math.round(c.getBoundingClientRect().width / w.getBoundingClientRect().width * 100) : -1; });
    ok(ci === -1 || ci >= 95, "group info: chief card spans the full width", ci);
    await ctx.close();
  }
  {
    const { ctx, page } = await start(browser);
    await clickJS(page, "#btn-groups"); await wait(page, 1500);
    const had = await page.evaluate(() => { const c = document.querySelector("[data-pnout]"); if (c) c.click(); return !!c; }); await wait(page, 1200);
    const t = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, rows: [...document.querySelectorAll(".pn-un-row")].map((r) => r.textContent), ikv: !!document.querySelector(".pn-un-ikv") }));
    ok(had && t.title === "Ute nu" && t.rows.some((x) => /Milos/.test(x)) && t.ikv, "Grupper: 'N vänner ute nu' opens who is out (Ikväll? optional row)", t);
    await ctx.close();
  }
  {
    const { ctx, page } = await start(browser);
    await page.evaluate(() => { window.SOCIAL && 0; }); await clickJS(page, "#btn-groups"); await wait(page, 1200);
    const opened = await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /Skapa/.test(x.textContent)); if (b) b.click(); return !!b; }); await wait(page, 900);
    await page.fill("#gname-inp", "Flogsta").catch(() => {}); await page.press("#gname-inp", "Enter").catch(() => {}); await wait(page, 2500);
    const inv = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, code: (document.querySelector(".jn-code-v") || {}).textContent, codeAfterQr: (() => { const q = document.querySelector(".jn-qr-cap"), c = document.querySelector(".jn-code"); return !!(q && c && q.nextElementSibling === c); })() }));
    ok(opened && /Bjud in/.test(inv.title) && inv.code === "FLX234" && inv.codeAfterQr, "create → invite: group code as text under the QR", inv);
    await clickJS(page, "#pn-back"); await wait(page, 1500);
    const back = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, form: !!document.getElementById("gname-inp") }));
    ok(!back.form && back.title === "Flogsta", "create → invite → ‹ = the new group (never the empty form)", back);
    await ctx.close();
  }
  {
    const { ctx, page } = await start(browser, "", { dflt: 1 });
    await page.route(/rest\/v1\/rpc\/group_status_v[23]$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.route(/rest\/v1\/rpc\/group_status$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await openGroup(page); await clickJS(page, ".gpg-dots"); await wait(page, 500);
    await page.evaluate(() => { const r = [...document.querySelectorAll(".gpg-row")].find((x) => /Medlemmar/.test(x.textContent)); if (r) r.click(); }); await wait(page, 2500);
    ok(await page.evaluate(() => /Inga medlemmar att visa/.test((document.querySelector(".st-list") || {}).textContent || "")), "members: empty state text");
    await ctx.close();
  }
  await browser.close();
  console.log(`\nfxg: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
