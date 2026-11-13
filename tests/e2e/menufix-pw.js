// lane menufix (13 Nov, owner phone test of the beta e69871b). Each item FAILS on e69871b and PASSES on the fix, at 360/390/430.
//  D  I-60: ONE divider rule for the ds list cards: every divider between two rows is inset from the text start, the same inset in the
//     Settings hub, Om appen, Mer på kartan and the Vänner (group Ikväll) hub; no full-width divider inside a card
//  N  I-60: no nested rounded boxes inside a list card (rows / toggle rows have no own radius, no gap between rows)
//  G  I-61: "Vem fixar nästa? Välj gäng" = a ds list card (avatar initial, name, chevron) or buttons with a gap ≥ 8 px
//  C  I-62: group chat: the message list ≥ 55 % of the viewport height, the gear is in the sheet header row,
//     a tall photo bubble ≤ ~40 % of the viewport (cover), the composer is on screen
// Mocked Supabase (ds-helpers). usage: node menufix-pw.js <port> [only-regex, e.g. "D|C"]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const zlib = require("zlib");
const SP = require("./env.js").OUT;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait, GID } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 700))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: SP + "logs/menufix-" + name + ".png" }).catch(() => {});
// a tall 300x450 PNG (a phone photo is portrait)
function tallPng() {
  const w = 300, h = 450, crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9a)]), raw = Buffer.concat(Array(h).fill(row));
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]).toString("base64");
}
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
const MSGS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: i, name: i % 2 ? "Lisa" : "Anton", body: i === 5 ? "📷" : "Meddelande " + i, created_at: iso(80 - i * 5), is_me: !(i % 2) }));

// the divider geometry of every visible card on screen: the inset of each divider line (px from the card's inner left edge)
// and every rounded box inside a card. sel = the card elements; rows = how to find the rows of a card.
function cards(page, mode) {
  return page.evaluate((mode) => {
    const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none";
    const inset = (e, L) => {   // the divider line at the top of row e: border-top, a 1 px ::before, or a 1 px background-image line
      const cs = getComputedStyle(e), b = getComputedStyle(e, "::before"), r = e.getBoundingClientRect(), lx = L.left;
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") return Math.round(r.left - lx);
      if (b.content && b.content !== "none" && parseFloat(b.height) <= 1.5 && b.position === "absolute") return Math.round(r.left - lx + parseFloat(b.left));
      if (/gradient/.test(cs.backgroundImage) && /1px$/.test(cs.backgroundSize)) {   // "calc(100% - 52px) 1px" (right top) or "300px 1px"
        const m = /calc\(100% - ([\d.]+)px\)/.exec(cs.backgroundSize), w = m ? r.width - parseFloat(m[1]) : parseFloat(cs.backgroundSize);
        return /^(100%|right)/.test(cs.backgroundPosition) ? Math.round(r.right - lx - w) : Math.round(r.left - lx);
      }
      return null;
    };
    const out = [];
    let groups = [];
    if (mode === "plus") {   // the group Ikväll hub: one card per section = consecutive .a2-row tiles (a2-first … a2-last)
      let cur = null;
      document.querySelectorAll('#sheet .gpg[data-gv="plus"] > *').forEach((e) => {
        if (!vis(e)) return;
        const b = e.querySelector(":scope > .btn");
        if (e.classList.contains("a2-first") || !cur) { cur = { rows: [], box: null }; groups.push(cur); }
        if (b && e.classList.contains("a2-row")) cur.rows.push(b); else cur = null;
      });
      groups = groups.filter((g) => g.rows.length > 1);
    } else {
      document.querySelectorAll("#sheet-body .ds-list").forEach((L) => {
        if (!vis(L) || L.getBoundingClientRect().height < 40) return;
        const rows = [];
        [...L.children].filter(vis).forEach((c) => {
          const btns = c.matches(".ds-item") ? [...c.querySelectorAll(":scope > .row > .btn")].filter(vis) : [];
          if (btns.length > 1 && !c.matches(".ds-blk")) { rows.push({ e: c, first: true }); btns.slice(1).forEach((x) => rows.push({ e: x, inner: true })); }
          else rows.push({ e: c });
        });
        groups.push({ L, rows });
      });
    }
    groups.forEach((g, gi) => {
      const L = g.L ? g.L.getBoundingClientRect() : g.rows[0].getBoundingClientRect(), cl = g.L ? g.L.clientLeft : 0;
      const box = { left: L.left + cl }, lst = [], round = [];
      (g.L ? g.rows : g.rows.map((e) => ({ e }))).forEach((r, i) => {
        if (i === 0) return;
        const e = r.e, x = inset(e, box), t = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 22);
        if (r.first) { lst.push({ t, x: inset(e, box) }); return; }
        lst.push({ t, x });
      });
      if (g.L) g.L.querySelectorAll("*").forEach((e) => {
        if (!vis(e)) return; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        if (r.width < L.width * 0.6) return;   // switches, avatars, pills: small things may be round
        if (parseFloat(cs.borderTopLeftRadius) > 2) round.push((e.textContent || "").trim().slice(0, 20) + " r" + cs.borderTopLeftRadius);
      });
      // gaps between rows (a row of its own = a separate box)
      let gap = 0;
      if (g.L) { const kids = [...g.L.querySelectorAll(":scope > .ds-item:not(.ds-blk) > .row > .btn")].filter(vis); for (let i = 1; i < kids.length; i++) gap = Math.max(gap, Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom)); }
      out.push({ g: gi, div: lst, round, gap });
    });
    return out;
  }, mode);
}
async function closeSheet(page) {
  await page.evaluate(() => { const c = document.getElementById("sheet-close"), s = document.getElementById("sheet"); if (c && s && !s.hidden) c.click(); }); await wait(page, 500);
}
async function settings(page) {
  await closeSheet(page);
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 2000);
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const TALL = tallPng();
  try {
    for (const w of W3) {
      const P = w + "px";
      /* ================= D + N: one divider rule, no nested boxes ================= */
      if (ONLY.test("D") || ONLY.test("N")) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => J(r, []));
        await H.boot(page);
        const menus = {};
        await settings(page); menus.hub = await cards(page); await shot(page, w + "-hub");
        await page.evaluate(() => document.querySelector(".set-r-om").click()); await wait(page, 1200);
        menus.om = await cards(page); await shot(page, w + "-om");
        await closeSheet(page);
        await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 1500);
        menus.more = await cards(page); await shot(page, w + "-more");
        await closeSheet(page);
        await H.clickJS(page, "#btn-groups"); await wait(page, 1200);
        await H.clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
        await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
        await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {}); await wait(page, 2000);
        await H.clickJS(page, ".gpg-plus"); await wait(page, 900);
        menus.vanner = await cards(page, "plus"); await shot(page, w + "-vanner");
        const all = [], bad = {};
        for (const [k, gs] of Object.entries(menus)) gs.forEach((g) => g.div.forEach((d) => { all.push(d.x); if (d.x !== 52) (bad[k] = bad[k] || []).push(d); }));
        const per = Object.fromEntries(Object.entries(menus).map(([k, gs]) => [k, gs.reduce((n, g) => n + g.div.length, 0)]));
        if (ONLY.test("D")) {
          ok(`${P} D: every menu has dividers to check`, Object.values(per).every((n) => n >= 2), per);
          ok(`${P} D: every divider in Settings, Om appen, Mer på kartan, Vänner is inset from the text start (52 px)`, all.length > 8 && Object.keys(bad).length === 0, bad);
        }
        if (ONLY.test("N")) {
          const nested = Object.entries(menus).flatMap(([k, gs]) => gs.filter((g) => g.round.length || g.gap > 0).map((g) => ({ k, round: g.round, gap: g.gap })));
          ok(`${P} N: no rounded box or gap inside a list card (only the card has a radius)`, nested.length === 0, nested);
        }
        await ctx.close();
      }
      /* ================= G: Vem fixar nästa? Välj gäng ================= */
      if (ONLY.test("G")) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await page.route(/rest\/v1\/rpc\/my_groups\b/, (r) => J(r, [{ id: "g1", name: "TPM" }, { id: "g2", name: "Vänner" }, { id: "g3", name: "Test" }]));
        await H.boot(page);
        await closeSheet(page);
        for (let i = 0; i < 2; i++) {   // the boot may still close a sheet (welcome / consent): open again once
          await page.evaluate(() => window.GAMES.openVemFixar(null));
          if (await page.waitForSelector("#sheet-body .gm-vfg", { timeout: 4000 }).then(() => true, () => false)) break;
          await closeSheet(page);
        }
        await wait(page, 600);
        const g = await page.evaluate(() => {
          const b = [...document.querySelectorAll("#sheet-body .gm-vfg")].filter((e) => e.getClientRects().length);
          const r = b.map((e) => e.getBoundingClientRect());
          let gap = 99; for (let i = 1; i < r.length; i++) gap = Math.min(gap, Math.round(r[i].top - r[i - 1].bottom));
          const list = b.length && b.every((e) => e.parentElement.classList.contains("ds-list") && e.classList.contains("ds-row"));
          const av = b.map((e) => { const a = e.querySelector(".gm-vfav"); return a ? a.textContent : ""; });
          const chev = b.every((e) => !!e.querySelector(".ds-chev"));
          return { n: b.length, gap, list, av, chev, names: b.map((e) => e.textContent.trim()), h: r.map((x) => Math.round(x.height)) };
        });
        ok(`${P} G: the gang picker lists the 3 gangs`, g.n === 3 && /TPM/.test(g.names[0]), g);
        ok(`${P} G: the gangs are one ds list card (avatar initial + name + chevron) or buttons ≥ 8 px apart`, (g.list && g.chev && g.av.join("") === "TVT") || g.gap >= 8, g);
        await shot(page, w + "-gang");
        await ctx.close();
      }
      /* ================= C: the group chat gives the messages the height ================= */
      if (ONLY.test("C")) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} return J(r, b.p_after_id > 0 ? [] : MSGS); });
        await page.route(/rest\/v1\/rpc\/group_photos/, (r) => J(r, [{ id: 77, msg_id: 5, w: 300, h: 450, created_at: iso(55), is_me: false }]));
        await page.route(/rest\/v1\/rpc\/group_photo$/, (r) => J(r, { b64: TALL, mime: "image/png" }));
        await H.boot(page);
        await closeSheet(page);
        await page.evaluate((gid) => { document.querySelectorAll(".toast").forEach((t) => t.remove()); window.SOCIAL.openChat({ id: gid, name: "Ludvika" }); }, GID);
        await wait(page, 3200);
        const c = await page.evaluate(() => {
          const R = (e) => e ? e.getBoundingClientRect() : null, vh = innerHeight;
          const l = R(document.querySelector("#sheet-body .chat-list")), inp = R(document.querySelector("#sheet-body .chat-input"));
          const cog = document.querySelector(".ux-cog"), head = document.querySelector("#sheet .sheet-head");
          const ph = document.querySelector("#sheet-body .chat-list .ph-frame"), img = ph && ph.querySelector("img");
          return { vh, list: l ? Math.round(l.height) : 0, share: l ? +(l.height / vh).toFixed(2) : 0, cogInHead: !!(cog && head && head.contains(cog)),
            cogRow: cog ? Math.round(R(cog).top) : null, headTop: head ? Math.round(R(head).top) : null, headH: head ? Math.round(R(head).height) : null,
            ph: ph ? Math.round(R(ph).height) : null, fit: img ? getComputedStyle(img).objectFit : "", inpBottom: inp ? Math.round(inp.bottom) : 9999 };
        });
        ok(`${P} C: the message list is ≥ 55 % of the viewport height`, c.share >= 0.55, c);
        ok(`${P} C: the gear is in the sheet header row (not a row of its own)`, c.cogInHead, c);
        ok(`${P} C: a tall photo bubble is ≤ 42 % of the viewport and cover-cropped`, c.ph != null && c.ph <= c.vh * 0.42 && c.fit === "cover", c);
        ok(`${P} C: the composer is on screen`, c.inpBottom <= c.vh, c);
        await shot(page, w + "-chat");
        // the gear leaves the header with the chat
        await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 1200);
        ok(`${P} C: another sheet → no chat gear in its header`, await page.evaluate(() => !document.querySelector("#sheet .sheet-head .ux-cog")));
        await ctx.close();
      }
    }
  } catch (e) { console.log("FAIL crash " + (e && e.stack || e)); fail++; }
  await browser.close();
  console.log(`menufix: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
