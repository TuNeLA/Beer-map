// hockeybuild-pw.js — lane hockeybuild (I-116 + A28, A30). node hockeybuild-pw.js <port> [shots]
// 1. Hockey shirts in town colours in the avatar creator (docs/js/hockey-shirts.js = PN.hockey, hooks in avatar.js + avwiz.js):
//    22 sourced towns (not the 6 without a source), grouped SHL / HockeyAllsvenskan 2026/27, label = TOWN (colours), never a club
//    name; colours + a generic stripe only (no <text>, no <image>); spec key tm; old avatars draw the same; an old server
//    (invalid_avatar on tm) = saved without tm + a toast; a normal top after a team shirt drops tm.
// 2. Taxi (docs/js/taxi-data.js): Smedjebacken, Avesta, Hedemora, Falun Koppartaxi added (taxidalarna.se, 2026-11-19);
//    Mora, Leksand, Rättvik still without a number.
// shots = also save before/after pictures (390x844 @2x) to $HB_SHOTS (default env OUT/logs/hockeybuild-shots/<tag>/).
const fs = require("fs");
const { ctxFor, boot, wait, settle } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] === "shots";
const TAG = process.env.HB_TAG || "after";
const SP = (process.env.HB_SHOTS || require("./env.js").OUT + "logs/hockeybuild-shots/") + TAG + "/";
if (SHOTS) fs.mkdirSync(SP, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 700)); };
const J = (r, body, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(body) });
const SPEC = { v: 2, sk: 11, fs: 2, ey: 0, br: 6, mt: 0, hr: 2, hc: 1, fh: 1, hw: 0, gl: 0, up: 1, uc: 0, bg: 6, ns: 4, ms: 1 };
const CLUBS = /Björklöven|Brynäs|Djurgården|Färjestad|Frölunda|HV71|Rögle|Lakers|Redhawks|MoDo|Modo|\bAIK\b|Leksands|\bIF\b|\bHC\b|\bIK\b|\bHF\b|Vikings|Almtuna|Södertälje SK/;
const NO_SRC = ["Uppsala", "Södertälje", "Vimmerby", "Visby", "Östersund"];

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { lang: o.lang });
  if (o.at) await ctx.setGeolocation({ latitude: o.at[0], longitude: o.at[1] });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const sent = [];
  await page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar)\b/, (r) => {
    if (!/set_my/.test(r.request().url())) return J(r, { v: 1, spec: o.spec || SPEC, seed: "5e3a91c2", facts: { r: 8, m: [] } });
    const p = JSON.parse(r.request().postData() || "{}").p_spec || {}; sent.push(p);
    if (o.oldServer && p.tm != null) return J(r, { code: "P0001", message: "invalid_avatar" }, 400);
    return J(r, { spec: p });
  });
  await boot(page);
  await page.waitForFunction(() => window.AVATAR && window.AVATAR.loadMe, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.AVATAR.loadMe(true)); await wait(page, 700);
  if (o.at) { await page.evaluate((c) => window.__map.setView(c, 15, { animate: false }), o.at); await wait(page, 1000); }
  return { ctx, page, errs, sent };
}
const editorUp = async (page) => {
  await page.evaluate(() => window.AVATAR.openEditor({ full: true })); await settle(page, 1500);
  await page.evaluate(() => { const t = document.querySelector('#sheet-body .ave-tab[data-t="uni-up"]'); if (t) t.click(); }); await settle(page, 1200);
};
const paneInfo = (page) => page.evaluate(() => {
  const b = document.getElementById("sheet-body"), sec = b.querySelector("[data-hk]");
  const grids = sec ? [...sec.querySelectorAll(".hk-grid")].map((g) => ({ lg: g.getAttribute("data-lg"), n: g.children.length,
    labels: [...g.querySelectorAll("[data-k='tm']")].map((x) => x.getAttribute("aria-label")), vis: [...g.querySelectorAll("[data-k='tm']")].map((x) => x.textContent.replace(/\s+/g, " ").trim()),
    h: [...g.children].map((x) => Math.round(x.getBoundingClientRect().height)), w: [...g.children].map((x) => Math.round(x.getBoundingClientRect().width)) })) : [];
  const heads = sec ? [...sec.querySelectorAll("h4")].map((h) => h.textContent) : [];
  return { has: !!sec, grids, heads, text: sec ? sec.textContent : "", sw: document.documentElement.scrollWidth, vw: innerWidth };
});
const prevSvg = (page, sel) => page.evaluate((s) => { const p = document.querySelector(s); return p ? p.innerHTML : ""; }, sel);

(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  // ---------- data + drawing ----------
  {
    const { ctx, page, errs } = await open(browser);
    const d = await page.evaluate(() => {
      const H = window.PN && PN.hockey; if (!H) return null;
      const T = H.TEAMS, hex = /^#[0-9A-Fa-f]{6}$/;
      return { n: T.length, shl: T.filter((t) => t.lg === "SHL").length, ha: T.filter((t) => t.lg === "HA").length,
        tms: T.map((t) => t.tm), towns: T.map((t) => t.town), lek: T.filter((t) => t.town === "Leksand").map((t) => ({ lg: t.lg, sv: H.label(t, true), en: H.label(t, false) }))[0],
        allSrc: T.every((t) => /^https:\/\//.test(t.src)), allHex: T.every((t) => t.c.length === 3 && t.c.every((c) => hex.test(c))), pats: [...new Set(T.map((t) => t.pat))].sort(),
        labels: T.map((t) => H.label(t, true)).concat(T.map((t) => H.label(t, false))), max: window.AVATAR.MAX.tm };
    });
    ok("PN.hockey: 22 towns = 13 SHL + 9 HockeyAllsvenskan, tm 1..22 unique and fixed", !!d && d.n === 22 && d.shl === 13 && d.ha === 9 && d.tms.join() === Array.from({ length: 22 }, (_, i) => i + 1).join(), d);
    ok("the 6 towns without a colour source are NOT there (Djurgården, Södertälje, Almtuna, Vimmerby, Visby/Roma, Östersund); Stockholm once (AIK)", !!d && NO_SRC.every((t) => d.towns.indexOf(t) < 0) && d.towns.filter((t) => t === "Stockholm").length === 1 && new Set(d.towns).size === 22, d && d.towns);
    ok("Leksand is in HockeyAllsvenskan 2026/27, label 'Leksand (blå-vit)' / 'Leksand (blue-white)'", !!d && d.lek && d.lek.lg === "HA" && d.lek.sv === "Leksand (blå-vit)" && d.lek.en === "Leksand (blue-white)", d && d.lek);
    ok("every row has a source URL, 3 hex colours and one of 4 generic patterns", !!d && d.allSrc && d.allHex && d.pats.join() === "band,classic,hoops,yoke", d && { s: d.allSrc, h: d.allHex, p: d.pats });
    ok("no label has a club name (town + colours only)", !!d && d.labels.every((l) => !CLUBS.test(l) && /^[A-ZÅÄÖ][^()]+ \([a-zåäö-]+\)$/.test(l)), d && d.labels.filter((l) => CLUBS.test(l)));
    ok("the avatar knows the key tm (max 28 = room for the 6 later towns)", !!d && d.max === 28, d && d.max);
    const art = await page.evaluate(() => {
      const A = window.AVATAR, base = { v: 2, sk: 3, fs: 0, ey: 1, br: 1, mt: 1, hr: 4, hc: 2, up: 0, uc: 2, bg: 6, ms: 1 };
      const strip = (s) => s.replace(/av\d+/g, "av");
      const lek = A.svg(Object.assign({}, base, { tm: 17 })), none = A.svg(base), t23 = A.svg(Object.assign({}, base, { tm: 23 }));
      const all = (window.PN.hockey ? window.PN.hockey.TEAMS : []).map((t) => A.svg(Object.assign({}, base, { tm: t.tm })));
      // old avatars: the same SVG with and without the hockey module (memo cleared between)
      const specs = []; for (let i = 0; i < 40; i++) { const s = A.defaultSpec("hb" + i, i % 15); s.up = i % 33; s.uc = i % 20; specs.push(s); }
      const a1 = specs.map((s) => strip(A.svg(s))), keep = window.PN.hockey;
      window.PN.hockey = null; A._oldFit(false);
      const a2 = specs.map((s) => strip(A.svg(s)));
      const lekOff = strip(A.svg(Object.assign({}, base, { tm: 17 })));
      window.PN.hockey = keep; A._oldFit(false);
      return { lekMain: lek.indexOf("#26358C") >= 0 && lek.indexOf("#FFFFFF") >= 0, noneMain: none.indexOf("#26358C") < 0, diff: strip(lek) !== strip(none),
        t23same: strip(t23) === strip(none), clean: all.every((s) => !/<text|<image|<use|href=/.test(s)), allDiff: new Set(all.map(strip)).size,
        oldSame: a1.every((s, i) => s === a2[i]), lekOffSame: lekOff === strip(none),
        small: !/<text/.test(A.svg(Object.assign({}, base, { tm: 17 }), { small: true })) };
    });
    ok("tm 17 draws the Leksand colours (#26358C + white) over the top; no tm = no team colour", art.lekMain && art.noneMain && art.diff, art);
    ok("all 22 shirts draw differently and have no text, image or link (no crest, no wordmark)", art.clean && art.allDiff === 22 && art.small, art);
    ok("old avatars (no tm, 40 specs, every top) draw the SAME with and without the hockey module", art.oldSame, art);
    ok("tm without data (23) or without the module draws the old top (old app = old look)", art.t23same && art.lekOffSame, art);
    const ct = await page.evaluate(() => { const A = window.AVATAR; return { team: A.contrastOk({ up: 0, uc: 3, bg: 0, tm: 17 }), plain: A.contrastOk({ up: 0, uc: 3, bg: 0 }) }; });
    ok("the top / background contrast check uses the team colour (amber T-shirt on amber = too close; Leksand navy on amber = ok)", ct.team === true && ct.plain === false, ct);
    ok("no page errors", errs.length === 0, errs);
    await ctx.close();
  }
  // ---------- the editor ----------
  {
    const { ctx, page, errs, sent } = await open(browser);
    if (SHOTS) { await editorUp(page); await page.screenshot({ path: SP + "1-editor-top.png" }); }
    else await editorUp(page);
    const p = await paneInfo(page);
    ok("editor 'Tröja & jacka': a hockey section with SHL (13) and HockeyAllsvenskan (9) groups", p.has && p.grids.length === 2 && p.grids[0].lg === "SHL" && p.grids[0].n === 13 && p.grids[1].lg === "HA" && p.grids[1].n === 9, p);
    ok("headings: 'Hockeytröja i stadens färger', 'SHL 2026/27', 'HockeyAllsvenskan 2026/27' + the no-badge note", p.heads.join("|") === "Hockeytröja i stadens färger|SHL 2026/27|HockeyAllsvenskan 2026/27" && /Inga klubbmärken/.test(p.text), p.heads);
    ok("each tile: aria-label 'Town (colours)', shows the town + colours, at least 44 px, no sideways scroll", p.grids.every((g) => g.labels.every((l, i) => g.vis[i] === l.replace(" (", "("))) &&
      p.grids.every((g) => g.h.every((h) => h >= 44) && g.w.every((w) => w >= 44)) && (p.grids[1] || { labels: [] }).labels.indexOf("Leksand (blå-vit)") >= 0 && p.sw <= p.vw, p.grids.map((g) => ({ v: g.vis.slice(0, 3), h: g.h.slice(0, 3) })));
    const pick = await page.evaluate(() => {
      const b = document.querySelector('#sheet-body [data-k="tm"][data-i="17"]'); if (b) { b.scrollIntoView({ block: "center" }); b.click(); }
      return { on: document.querySelectorAll('#sheet-body [data-k="tm"].on').length, upOn: document.querySelectorAll('#sheet-body .ave-tile[data-k="up"].on').length };
    });
    await settle(page, 900);
    const pv = await prevSvg(page, "#sheet-body .ave-prev");
    await page.evaluate(() => { const t = [...document.querySelectorAll('#sheet-body .ave-tile[data-k="up"]')].pop(); if (t) t.scrollIntoView({ block: "center" }); }); await settle(page, 900);
    const after = await page.evaluate(() => ({ on: [...document.querySelectorAll('#sheet-body [data-k="tm"].on')].map((x) => x.getAttribute("data-i")), upOn: document.querySelectorAll('#sheet-body .ave-tile[data-k="up"].on').length,
      art: [...document.querySelectorAll('#sheet-body .ave-tile[data-k="up"] .ave-art')].filter((a) => a.innerHTML).slice(0, 4).map((a) => a.innerHTML.indexOf("#26358C") >= 0) }));
    ok("tap Leksand: the preview wears blue-white, the Leksand tile is on, no normal top is on", pick.on === 1 && pv.indexOf("#26358C") >= 0 && after.on.join() === "17" && after.upOn === 0, { pick, after });
    ok("the normal top tiles still show their own top (not the team shirt)", after.art.length > 0 && after.art.every((x) => !x), after.art);
    if (SHOTS) {
      await page.evaluate(() => { const s = document.querySelector("#sheet-body [data-hk]"); if (s) { s.scrollIntoView({ block: "start" }); document.getElementById("sheet-body").scrollTop -= 230; } }); await settle(page, 800);
      await page.screenshot({ path: SP + "2-editor-shl.png" });
      await page.evaluate(() => { const s = document.querySelector('#sheet-body .hk-grid[data-lg="HA"]'); if (s) s.scrollIntoView({ block: "center" }); }); await settle(page, 800);
      await page.screenshot({ path: SP + "3-editor-ha.png" });
    }
    await page.evaluate(() => document.querySelector("#sheet-body .ave-save").click()); await settle(page, 1500);
    const s1 = sent[sent.length - 1] || {};
    ok("Spara sends tm 17 and keeps the old top (up 1) for old apps", s1.tm === 17 && s1.up === 1, s1);
    // a normal top after a team shirt: tm goes away
    await editorUp(page);
    await page.evaluate(() => { const b = document.querySelector('#sheet-body .ave-tile[data-k="up"][data-i="0"]'); if (b) b.click(); }); await settle(page, 800);
    const st2 = await page.evaluate(() => ({ tm: document.querySelectorAll('#sheet-body [data-k="tm"].on').length, up: [...document.querySelectorAll('#sheet-body .ave-tile[data-k="up"].on')].map((x) => x.getAttribute("data-i")) }));
    await page.evaluate(() => document.querySelector("#sheet-body .ave-save").click()); await settle(page, 1500);
    const s2 = sent[sent.length - 1] || {};
    ok("then tap T-shirt: no team tile on, Spara sends up 0 and no tm", st2.tm === 0 && st2.up.join() === "0" && s2.up === 0 && s2.tm == null, { st2, s2 });
    // English
    ok("no page errors (editor)", errs.length === 0, errs);
    await ctx.close();
  }
  // ---------- English labels (the app is Swedish-only now: I18N is swapped for this one check) ----------
  {
    const { ctx, page, errs } = await open(browser);
    const en = await page.evaluate(() => {
      if (!window.PN || !PN.hockey) return null;
      const keep = window.I18N; window.I18N = { lang: "en" };
      let e; try { e = PN.hockey.section({ cls: "ave", draft: {} }); } finally { window.I18N = keep; }
      return { heads: [...e.querySelectorAll("h4")].map((h) => h.textContent), note: e.querySelector("p").textContent, labels: [...e.querySelectorAll("[data-k='tm']")].map((b) => b.getAttribute("aria-label")) };
    });
    ok("English: 'Hockey shirt in town colours', 'Only colours and stripes. No club badges.', 'Leksand (blue-white)'", !!en && en.heads[0] === "Hockey shirt in town colours" && /No club badges/.test(en.note) && en.labels.indexOf("Leksand (blue-white)") >= 0 && en.labels.length === 22, en);
    ok("no page errors (en)", errs.length === 0, errs);
    await ctx.close();
  }
  // ---------- an old server: tm is not known yet ----------
  {
    const { ctx, page, errs, sent } = await open(browser, { oldServer: true });
    await editorUp(page);
    await page.evaluate(() => { const b = document.querySelector('#sheet-body [data-k="tm"][data-i="17"]'); if (b) b.click(); }); await settle(page, 600);
    await page.evaluate(() => document.querySelector("#sheet-body .ave-save").click()); await settle(page, 1800);
    const t = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    ok("old server (invalid_avatar on tm): saved again WITHOUT tm, and a toast says the shirt comes in the next update", sent.length === 2 && sent[0].tm === 17 && sent[1].tm == null && sent[1].up === 1 && /Hockeytröjan.*nästa uppdatering/.test(t), { sent, t });
    ok("no page errors (old server)", errs.length === 0, errs);
    await ctx.close();
  }
  // ---------- the wizard ----------
  {
    const { ctx, page, errs, sent } = await open(browser);
    await page.evaluate(() => window.AVWIZ.open()); await settle(page, 1500);
    const steps = await page.evaluate(() => window.AVWIZ._steps.map((s) => s.k || s.id));
    await page.evaluate((i) => document.querySelector(`#sheet-body .avw-quick [data-i="${i}"]`).click(), steps.indexOf("up")); await settle(page, 1000);
    if (SHOTS) await page.screenshot({ path: SP + "4-wizard-top.png" });
    const w = await page.evaluate(() => { const s = document.querySelector("#sheet-body [data-hk]"); return s ? { n: s.querySelectorAll(".avw-tile[data-k='tm']").length, heads: [...s.querySelectorAll("h4")].map((h) => h.textContent), h: Math.min(...[...s.querySelectorAll(".avw-tile")].map((x) => x.getBoundingClientRect().height)) } : null; });
    ok("wizard step 'Kläder': the same hockey section, 22 tiles, 2 leagues, tiles 44 px+", !!w && w.n === 22 && w.heads.length === 3 && w.h >= 44, w);
    await page.evaluate(() => { const b = document.querySelector('#sheet-body .avw-tile[data-k="tm"][data-i="4"]'); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }); await settle(page, 800);
    const pv = await prevSvg(page, "#sheet-body .avw-prev");
    const on = await page.evaluate(() => ({ tm: [...document.querySelectorAll('#sheet-body .avw-tile[data-k="tm"].on')].map((x) => x.getAttribute("data-i")), up: document.querySelectorAll('#sheet-body .avw-tile[data-k="up"].on').length,
      art: [...document.querySelectorAll('#sheet-body .avw-tile[data-k="up"] .avw-art')].slice(0, 4).map((a) => a.innerHTML.indexOf("#00573F") >= 0) }));
    ok("wizard: tap Göteborg = green-white in the preview, only that tile on; normal tops keep their own art", pv.indexOf("#00573F") >= 0 && on.tm.join() === "4" && on.up === 0 && on.art.every((x) => !x), on);
    if (SHOTS) { await page.evaluate(() => { const s = document.querySelector("#sheet-body [data-hk]"); if (s) { s.scrollIntoView({ block: "start" }); document.getElementById("sheet-body").scrollTop -= 230; } }); await settle(page, 800); await page.screenshot({ path: SP + "5-wizard-hockey.png" }); }
    await page.evaluate(() => { const b = document.querySelector('#sheet-body .avw-tile[data-k="up"]'); if (b) b.click(); }); await settle(page, 600);
    const on2 = await page.evaluate(() => document.querySelectorAll('#sheet-body .avw-tile[data-k="tm"].on').length);
    const pv2 = await prevSvg(page, "#sheet-body .avw-prev");
    ok("wizard: a normal top after it = no team tile on, no team colour in the preview", on2 === 0 && pv2.indexOf("#00573F") < 0, { on2 });
    ok("no page errors (wizard)", errs.length === 0, errs);
    await ctx.close();
  }
  // ---------- taxi numbers (A30) ----------
  {
    const { ctx, page, errs } = await open(browser);
    await page.evaluate(() => window.OLNU_LAZY_NOW && window.OLNU_LAZY_NOW());
    await page.waitForFunction(() => window.TAXI_DATA && window.TAXI_DATA.towns, null, { timeout: 15000 }).catch(() => {});
    const t = await page.evaluate(() => {
      const D = window.TAXI_DATA, T = D.towns, row = (n) => T.filter((x) => x.town === n).map((x) => [x.name, x.text, x.tel, x.src, x.url, !!x.unverified].join("|"));
      return { sm: row("Smedjebacken"), av: row("Avesta"), he: row("Hedemora"), fa: row("Falun"), places: D.places.map((x) => x.town),
        bad: T.filter((x) => /^(Mora|Leksand|Rättvik)$/.test(x.town)).length, bold: (window.BOLD_TAXI || []).filter((x) => /^(Smedjebacken|Avesta|Hedemora)$/.test(x.town) || x.tel === "+462363000").length };
    });
    const TD = "https://taxidalarna.se/";
    ok("taxi: Smedjebacken = Ludvikataxi 0240-139 00 (taxidalarna.se, verified)", t.sm.join() === ["Ludvikataxi", "0240-139 00", "+4624013900", "co", TD, false].join("|"), t.sm);
    ok("taxi: Avesta and Hedemora = Södra Dalarnas Taxi 0226-804 00 (taxidalarna.se, verified)", [t.av, t.he].every((r) => r.join() === ["Södra Dalarnas Taxi", "0226-804 00", "+4622680400", "co", TD, false].join("|")), { av: t.av, he: t.he });
    ok("taxi: Falun keeps TaxiKurir 023-153 00 first and adds Koppartaxi 023-630 00", t.fa.length === 2 && /^TaxiKurir Falun\|023-153 00\|\+462315300/.test(t.fa[0]) && t.fa[1] === ["Koppartaxi", "023-630 00", "+462363000", "co", TD, false].join("|"), t.fa);
    ok("taxi: the 3 towns left 'places' (no double town); Mora, Leksand, Rättvik still have no number", ["Smedjebacken", "Avesta", "Hedemora"].every((n) => t.places.indexOf(n) < 0) && t.places.indexOf("Mora") >= 0 && t.bad === 0, t);
    ok("taxi: Hem-läge (BOLD_TAXI = verified rows only) has the 4 new rows", t.bold === 4, t.bold);
    const sheet = async (at) => {
      const o2 = await open(browser, { at });
      await o2.page.evaluate(() => window.OLNU_LAZY_NOW && window.OLNU_LAZY_NOW()); await wait(o2.page, 800);
      await o2.page.evaluate(() => document.getElementById("btn-taxi").click()); await settle(o2.page, 1500);
      const r = await o2.page.evaluate(() => { const c = document.querySelector("#sheet-body .hs-call"); return { call: c ? c.textContent.replace(/\s+/g, " ").trim() : "", href: c ? c.getAttribute("href") : "",
        more: [...document.querySelectorAll("#sheet-body .hs-sub")].map((e) => e.getAttribute("href")) }; });
      r.errs = o2.errs; await o2.ctx.close();
      return r;
    };
    const he = await sheet([60.2754, 15.9883]), fa = await sheet([60.6065, 15.6355]);
    ok("'Ta dig hem' in Hedemora: one amber button 'Ring Södra Dalarnas Taxi 0226-804 00' (was: Borlänge 40 km away)", /^Ring Södra Dalarnas Taxi ?0226-804 00$/.test(he.call) && he.href === "tel:+4622680400", he);
    ok("'Ta dig hem' in Falun: TaxiKurir first, Koppartaxi under 'Fler taxibolag'", /TaxiKurir Falun/.test(fa.call) && fa.more.indexOf("tel:+462363000") >= 0, fa);
    ok("no page errors (taxi)", errs.length === 0 && he.errs.length === 0 && fa.errs.length === 0, errs.concat(he.errs, fa.errs));
    await ctx.close();
  }
  // ---------- a few avatars (pictures) ----------
  if (SHOTS) {
    const { ctx, page } = await open(browser);
    await page.evaluate(() => {
      const A = window.AVATAR, H = window.PN && PN.hockey;
      const people = [{ v: 2, sk: 11, fs: 2, ey: 0, br: 6, mt: 0, hr: 2, hc: 1, fh: 1, up: 9, uc: 0, bg: 6, ns: 4, ms: 1 }, { v: 2, sk: 10, fs: 1, ey: 9, br: 5, mt: 8, hr: 5, hc: 2, up: 9, uc: 13, bg: 0, ck: 2, er: 2, ms: 1 },
        { v: 2, sk: 3, fs: 0, ey: 1, br: 1, mt: 2, hr: 4, hc: 4, fh: 4, up: 9, uc: 2, bg: 15, ms: 1 }, { v: 2, sk: 16, fs: 2, ey: 5, br: 2, mt: 7, hr: 8, hc: 0, up: 9, uc: 0, bg: 11, hw: 3, ms: 1 },
        { v: 2, sk: 8, fs: 1, ey: 2, br: 1, mt: 1, hr: 3, hc: 6, up: 9, uc: 5, bg: 2, ms: 1 }, { v: 2, sk: 20, fs: 0, ey: 0, br: 4, mt: 0, hr: 1, hc: 0, fh: 2, up: 9, uc: 1, bg: 13, ms: 1 }];
      const teams = [17, 19, 4, 11, 13, 22];
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0b1638;color:#fff;font:14px system-ui;padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-content:start";
      people.forEach((p, i) => {
        const s = Object.assign({}, p); if (H) s.tm = teams[i];
        const t = H ? H.team(teams[i]) : null, c = document.createElement("div"); c.style.textAlign = "center";
        c.innerHTML = '<div style="width:104px;height:104px;margin:auto">' + A.svg(s) + '</div><div style="margin-top:4px">' + (t ? H.label(t, true) : "Hockeytröja (gammal)") + "</div>" +
          '<div style="width:56px;height:56px;margin:6px auto 0">' + A.svg(s, { small: true }) + "</div>";
        box.appendChild(c);
      });
      document.body.appendChild(box);
    });
    await wait(page, 500); await page.screenshot({ path: SP + "6-avatars.png" });
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
