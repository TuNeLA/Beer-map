// lane themes (I-46): seasonal theme engine docs/js/themes.js + docs/themes/*.json. usage: node themes-pw.js <port> [parts]   parts: unit, app (default both)
// Part unit (no browser): date windows 2026-27 (Easter / 1st Advent are calculated), Stockholm time zone, priority, year wrap, allow-list,
//   contrast, size budgets, copy lint (banned words, alcohol-free twin), ticker mix rules.
// Part app (mocked Supabase, no Mapbox): ?theme=jul preview, switch off = none + no theme request, the Installningar row, reduced motion,
//   no layout shift / same hit area, pins stay tappable, offline theme file = normal app, low-end = no overlay, LA phone on Lucia night.
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const PARTS = (process.argv[3] || "unit,app").split(",");
const DOCS = path.join(__dirname, "../../docs");
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (!c && x !== undefined ? " " + JSON.stringify(x).slice(0, 500) : "")); c ? pass++ : fail++; };
const SRC = fs.readFileSync(path.join(DOCS, "js/themes.js"), "utf8");
const IDX = JSON.parse(fs.readFileSync(path.join(DOCS, "themes/index.json"), "utf8"));
const THEME = {}; IDX.forEach((e) => { THEME[e.id] = JSON.parse(fs.readFileSync(path.join(DOCS, "themes", e.id + ".json"), "utf8")); });
// a Stockholm winter moment (UTC+1): all theme days of 2026-27 are in winter time
const cet = (y, m, d, h = 12, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h - 1, mi, s);

function load() {   // the engine alone in a vm: no document, no fetch = only the pure API
  const win = { PN: {}, I18N: { lang: "sv" } }; win.window = win;
  vm.runInNewContext(SRC, win, { filename: "themes.js" });
  return win.PN.themes;
}

function unit() {
  const T = load();
  ok(!!T && typeof T._pick === "function" && typeof T.settingsRow === "function", "engine exports PN.themes (settingsRow, _pick, _at) and needs no document");
  // moving days (oracle: THEMES-PLAN section 2, dateutil.easter + Swedish rules)
  const D = [["easter", 2026, "2026-04-05"], ["easter", 2027, "2027-03-28"], ["easter-2", 2026, "2026-04-03"], ["easter-2", 2027, "2027-03-26"],
    ["easter-47", 2026, "2026-02-17"], ["easter-47", 2027, "2027-02-09"], ["easter+39", 2026, "2026-05-14"], ["easter+39", 2027, "2027-05-06"],
    ["easter+49", 2026, "2026-05-24"], ["easter+49", 2027, "2027-05-16"], ["advent1", 2026, "2026-11-29"], ["advent1", 2027, "2027-11-28"],
    ["advent1", 2028, "2028-12-03"], ["advent1", 2029, "2029-12-02"], ["easter", 2038, "2038-04-25"], ["easter", 2285, "2285-03-22"], ["12-13", 2026, "2026-12-13"], ["02-29", 2028, "2028-02-29"]];
  D.forEach(([r, y, w]) => { const g = T._at(r, y); ok(g === w, `day rule ${r} ${y} = ${w}`, g); });
  // the real index: windows incl. the moving 1st Advent and the Nyår year wrap
  const P = (y, m, d, h, mi, s) => T._pick(IDX, cet(y, m, d, h, mi, s));
  const W = [[[2026, 11, 28, 23, 59, 59], null], [[2026, 11, 29, 0, 0, 0], "jul"], [[2026, 12, 11, 23, 59, 59], "jul"], [[2026, 12, 12, 0, 0, 0], "lucia"],
    [[2026, 12, 13, 12], "lucia"], [[2026, 12, 14, 23, 59, 59], "lucia"], [[2026, 12, 15, 0, 0, 0], "jul"], [[2026, 12, 26, 23, 59, 59], "jul"], [[2026, 12, 27, 0, 0, 0], "nyar"],
    [[2026, 12, 31, 23, 59, 59], "nyar"], [[2027, 1, 1, 0, 0, 0], "nyar"], [[2027, 1, 1, 23, 59, 59], "nyar"], [[2027, 1, 2, 0, 0, 0], null], [[2027, 6, 19, 12], null],
    [[2027, 11, 27, 12], null], [[2027, 11, 28, 12], "jul"], [[2027, 12, 13, 12], "lucia"], [[2027, 12, 26, 12], "jul"], [[2027, 12, 27, 12], "nyar"], [[2026, 11, 13, 12], null]];
  W.forEach(([a, w]) => { const g = P(...a); ok(g === w, `window ${a.slice(0, 3).join("-")} ${a.slice(3).join(":") || ""} (Stockholm) -> ${w}`, g); });
  // time zone: the instant counts in Stockholm, never in the phone's zone
  ok(T._pick(IDX, Date.UTC(2026, 11, 12, 22, 30)) === "lucia", "UTC 22:30 on 12 Dec (= 23:30 Stockholm) = Lucia (a phone in UTC-8 reads 14:30)");
  ok(T._pick(IDX, Date.UTC(2026, 11, 11, 23, 30)) === "lucia", "UTC 23:30 on 11 Dec (= 00:30 on 12 Dec Stockholm) = Lucia already");
  ok(T._pick(IDX, Date.UTC(2026, 11, 14, 23, 30)) === "jul", "UTC 23:30 on 14 Dec (= 00:30 on 15 Dec Stockholm) = Jul again");
  ok(T._pick(IDX, Date.UTC(2026, 11, 31, 22, 59, 59)) === "nyar" && T._pick(IDX, Date.UTC(2026, 11, 31, 23, 0, 0)) === "nyar", "Nyår across the year change 31 Dec 23:59:59 -> 1 Jan 00:00 (Stockholm)");
  // priority: the highest p wins, a tie goes to the later start, an entry that is not active never wins
  const L = [{ id: "a", from: "12-01", to: "12-31", p: 10 }, { id: "b", from: "12-10", to: "12-20", p: 10 }, { id: "c", from: "12-05", to: "12-25", p: 5 }, { id: "d", from: "12-12", to: "12-12", p: 99 }];
  ok(T._pick(L, cet(2026, 12, 3)) === "a" && T._pick(L, cet(2026, 12, 6)) === "a", "priority: highest p, a lower one never beats it");
  ok(T._pick(L, cet(2026, 12, 11)) === "b", "priority tie: the later start wins");
  ok(T._pick(L, cet(2026, 12, 12)) === "d" && T._pick(L, cet(2026, 12, 13)) === "b", "priority: p 99 wins on its day only");
  ok(T._pick([], cet(2026, 12, 12)) == null, "no entries = no theme");
  let threw = false; try { T._pick([{ id: "x", from: "garbage", to: "12-01", p: 1 }], cet(2026, 12, 1)); } catch (e) { threw = true; }
  ok(threw, "a bad date rule throws (the engine turns that into 'no theme')");
  // allow-list
  const good = THEME.jul, cp = (o) => Object.assign(JSON.parse(JSON.stringify(good)), o);
  ok(["jul", "lucia", "nyar"].every((k) => T._ok(THEME[k], "#0a0f1c")), "the 3 shipped themes pass the allow-list");
  ok(!T._ok(cp({ position: "fixed" })), "unknown key (position) is refused");
  ok(!T._ok(cp({ map: { layer: "water" } })), "unknown key (map / new layer) is refused");
  ok(!T._ok(cp({ tokens: { "--ds-bg": "#ffffff" } })), "a token outside --pn-theme-* / --ds-amber-t is refused");
  ok(!T._ok(cp({ tokens: { "--ds-amber-t": "#202020" } }), "#0a0f1c"), "--ds-amber-t below 4.5:1 on the background is refused");
  ok(!T._ok(cp({ tokens: { "--pn-theme-x": "red" } })), "a token value that is not #rrggbb is refused");
  ok(!T._ok(cp({ css: '@import "x.css";' })) && !T._ok(cp({ css: "a{background:url(https://x.se/a.png)}" })), "css: @import and remote url() are refused");
  ok(!T._ok(cp({ sprites: ['<svg onload="x()"></svg>'] })) && !T._ok(cp({ sprites: ['<svg><use href="x"/></svg>'] })), "sprites: event handlers and href are refused");
  ok(!T._ok(cp({ count: 13 })), "more than 12 sprites is refused");
  ok(!T._ok(cp({ id: "Jul!" })) && !T._ok(null), "bad id / no object is refused");

  // budgets
  const gz = zlib.gzipSync(SRC).length;
  ok(SRC.length <= 14000 && gz <= 6000, `engine source ${SRC.length} B, gzip ${gz} B (limits 14000 / 6000; the bundle minifies the lazy file)`, { b: SRC.length, gz });
  const isz = fs.statSync(path.join(DOCS, "themes/index.json")).size;
  ok(isz <= 2048, `themes/index.json ${isz} B <= 2 KB`);
  Object.keys(THEME).forEach((k) => {
    const files = fs.readdirSync(path.join(DOCS, "themes")).filter((f) => f.startsWith(k + "."));
    const sz = files.reduce((a, f) => a + fs.statSync(path.join(DOCS, "themes", f)).size, 0), t = THEME[k];
    ok(sz <= 50 * 1024 && sz <= 6144, `theme ${k}: ${sz} B incl. sprites (limit 50 KB; plan 6 KB for the json)`);
    ok(t.count <= 12 && t.sprites.length >= 1 && t.btn && /^<svg/.test(t.btn), `theme ${k}: <= 12 sprites, a button decoration`);
    // css: every rule is under [data-theme="id"] (or is a keyframes block), nothing global
    const css = t.css.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const sels = css.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    ok(sels.length >= 1 && sels.every((s) => s.split(",").every((p) => p.trim().startsWith(`[data-theme="${k}"]`))), `theme ${k}: every css rule starts with [data-theme="${k}"]`, sels);
    ok(!/position\s*:\s*fixed|z-index|pointer-events\s*:\s*(auto|all)/i.test(t.css), `theme ${k}: css does not move the layer, set z-index or catch taps`);
  });
  // contrast of the shipped warm token vs the app background (ds.css --ds-bg)
  const bg = /--ds-bg:\s*(#[0-9a-f]{6})/i.exec(fs.readFileSync(path.join(DOCS, "ds.css"), "utf8"))[1];
  const lum = (h) => { const c = [1, 3, 5].map((i) => { const v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  Object.keys(THEME).forEach((k) => { const a = THEME[k].tokens["--ds-amber-t"]; if (!a) return; const r = (lum(a) + .05) / (lum(bg) + .05); ok(r >= 4.5, `theme ${k}: --ds-amber-t ${a} on ${bg} = ${r.toFixed(1)}:1 (>= 4.5)`); });

  // copy lint (KOVFS: never "drink more"; an alcohol-free twin for every Glögg; the label stays ÖL!)
  const BAN = /(^|[^a-zåäö])(fler|mer öl|en till|ta en|ännu en|ännu ett|botten upp|chugga|full|fulla|fullt|rus|bälta|drick mer|dricka mer|drink more|another round|another one|one more|more beer|bottoms up|chug|wasted|drunk|hammered|sloshed|plastered|ta ett glas)([^a-zåäö]|$)/i;
  const FREE = /alkoholfri|julmust|alcohol-free|non-alcoholic/i, GLOGG = /glögg|glogg|mulled/i;
  Object.keys(THEME).forEach((k) => {
    const t = THEME[k], sv = t.tick.sv, en = t.tick.en, all = sv.concat(en, [t.name]);
    ok(sv.length >= 6 && en.length === sv.length, `theme ${k}: ${sv.length} sv + ${en.length} en ticker lines (>= 6, same count)`);
    ok(all.every((s) => !BAN.test(s)), `theme ${k}: no banned word`, all.filter((s) => BAN.test(s)));
    ok(sv.some((s) => /alkoholfri/i.test(s)) && en.some((s) => /alcohol-free/i.test(s)), `theme ${k}: an alcohol-free line in sv and en`);
    ok(all.filter((s) => GLOGG.test(s)).every((s) => FREE.test(s)), `theme ${k}: every Glögg line has its alcohol-free twin`);
    ok(all.every((s) => s.length <= 130 && !/\{|\}/.test(s)) && new Set(sv).size === sv.length, `theme ${k}: lines <= 130 chars, no {var}, no duplicates`);
    ok(!/countdown|nedräkning|midnatt|midnight/i.test(all.join(" ")), `theme ${k}: no countdown / midnight line (plan rule 4)`);
  });
  ok(BAN.test("Ta en till!") && BAN.test("Glögg-kvällen kräver fler!") && BAN.test("drink more") && !BAN.test("Rustik glögg i Gustavsberg"), "the lint itself catches the plan's bad examples and spares look-alike words");

  // ticker mix: ~30 % of the slots, never 2 theme lines within 3 slots, real / quiet lines stay, >= 1 when the belt has > 3 lines
  const mk = (n, real) => Array.from({ length: n }, (_, i) => ({ text: "n" + i, cls: real && real.includes(i) ? "tk-real" : "", k: "x" }));
  let slots = 0, hits = 0, gapOk = true, realOk = true, textOk = true, one = true;
  for (let n = 4; n <= 40; n++) for (let r = 0; r < 3; r++) {
    const o = mk(n, r === 1 ? [0, 1, 2, 3, 5, 8] : null), m = T._mix(o, THEME.jul), idx = m.map((x, i) => x.cls === "tk-theme" ? i : -1).filter((i) => i >= 0);
    if (n <= 6 && !idx.length && r !== 1) one = false;
    idx.forEach((i, j) => { if (j && i - idx[j - 1] < 3) gapOk = false; if (o[i].cls === "tk-real") realOk = false; if (!THEME.jul.tick.sv.includes(m[i].text)) textOk = false; });
    if (r === 0) { slots += n; hits += idx.length; }
  }
  ok(gapOk, "mix: never 2 theme lines within 3 slots");
  ok(realOk, "mix: a real-event line is never replaced");
  ok(textOk, "mix: a theme line is one of the theme's own lines");
  ok(one, "mix: a belt of 4-6 lines gets at least 1 theme line");
  ok(hits / slots >= .15 && hits / slots <= .34, `mix: about 30 % of the slots (got ${(100 * hits / slots).toFixed(0)} %)`);
  const a = JSON.stringify(T._mix(mk(6), THEME.jul)), b = JSON.stringify(T._mix(mk(6), THEME.jul));
  ok(a === b, "mix: the same belt gives the same theme lines (stable all night, no flicker on re-render)");
  ok(T._night(cet(2026, 12, 24, 4, 59)) === "2026-12-23" && T._night(cet(2026, 12, 24, 5, 0)) === "2026-12-24", "night key flips at 05:00 Stockholm");
}

/* ---------------- app part ---------------- */
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
async function fresh(browser, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "sv-SE",
    userAgent: UA, timezoneId: o.tz, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const reqs = [], warns = [], errs = [];
  await ctx.route(/supabase\.co/, (r) => J(r, []));
  await ctx.route(/api\.mapbox\.com|tiles\.mapbox\.com|events\.mapbox\.com/, (r) => r.abort());
  if (o.abort) await ctx.route(/\/themes\/[a-z]+\.json/, (r) => r.abort());
  await ctx.addInitScript((c) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => c.cores });
    if (c.off) try { localStorage.setItem("pn_theme_off", "1"); } catch (e) {}
  }, { cores: o.cores || 8, off: !!o.off });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (/themes?\.js|theme/i.test((e.stack || "") + e.message)) errs.push(e.message); });   // only errors that name the theme code
  page.on("console", (m) => { if (/themes off/.test(m.text())) warns.push(m.text()); });
  page.on("request", (r) => { if (/\/themes\//.test(r.url())) reqs.push(r.url().replace(/^.*\/themes\//, "")); });
  if (o.time) await page.clock.setFixedTime(new Date(o.time));
  await page.goto(BASE + (o.q || ""));
  await page.waitForFunction(() => window.PN && window.PN.themes && window.PN.themes._run, null, { timeout: 40000 });
  return { ctx, page, reqs, warns, errs };
}
const run = (page) => page.evaluate(() => window.PN.themes._run());
const theme = (page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const RECTS = ["#btn-beer", ".beer-wrap", ".topbar", ".dock"];
const rects = (page) => page.evaluate((sels) => sels.map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); }), RECTS);

async function app() {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  // baseline: switch off = no theme, no theme file requested, the layout that the themed pages must keep
  let base;
  {
    const c = await fresh(browser, { off: true }); await run(c.page);
    base = await rects(c.page);
    ok(!(await theme(c.page)) && !(await c.page.$(".pn-th-layer, #pn-th-css, .pn-th-hat")), "switch off: no data-theme, no layer, no style, no hat");
    ok(c.reqs.length === 0, "switch off: no request for docs/themes/*", c.reqs);
    ok(await c.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ds-amber-t").trim().toLowerCase() === "#ffc24d"), "switch off: the app's own --ds-amber-t");
    await c.ctx.close();
  }
  // preview ?theme=jul (also works with the switch off: an explicit URL)
  {
    const c = await fresh(browser, { q: "?theme=jul", off: true }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme === "jul", null, { timeout: 10000 }).catch(() => {});
    const r = await c.page.evaluate(() => {
      const L = document.querySelector(".pn-th-layer"), hat = document.querySelector(".beer-wrap > .pn-th-hat"), b = document.getElementById("btn-beer");
      const cs = L && getComputedStyle(L), pts = [];
      for (let x = 5; x < 390; x += 40) for (let y = 5; y < 844; y += 60) { const e = document.elementFromPoint(x, y); pts.push(!!(e && e.closest(".pn-th-layer"))); }
      const bb = b.getBoundingClientRect(), top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
      return { th: document.documentElement.dataset.theme, tok: getComputedStyle(document.documentElement).getPropertyValue("--ds-amber-t").trim(), n: L ? L.querySelectorAll(".pn-th-s").length : -1,
        pe: cs && cs.pointerEvents, aria: L && L.getAttribute("aria-hidden"), z: cs && +cs.zIndex, hat: !!hat && !!hat.querySelector("svg") && hat.getAttribute("aria-hidden") === "true" && getComputedStyle(hat).pointerEvents,
        label: document.getElementById("beer-label").textContent, onLayer: pts.some(Boolean), btnTop: !!(top && top.closest("#btn-beer")), css: !!document.getElementById("pn-th-css"),
        hcw: document.getElementById("pn-th-css").textContent.length, anim: L ? L.getAnimations({ subtree: true }).length : -1 };
    });
    ok(r.th === "jul", "?theme=jul sets data-theme=jul", r);
    ok(r.tok === "#ffcf7a", "jul: warm token --ds-amber-t applied", r.tok);
    ok(r.n >= 1 && r.n <= 12, "jul: snow overlay has 1..12 sprites", r.n);
    ok(r.pe === "none" && r.aria === "true" && !r.onLayer, "jul: layer is pointer-events:none, aria-hidden, never the tap target", r);
    ok(r.z < 999, "jul: layer sits below the HUD, topbar, ticker and sheets (z-index)", r.z);
    ok(r.hat === "none", "jul: the button decoration (Santa hat outline) is a decorative svg inside .beer-wrap, no pointer events", r.hat);
    ok(r.label === "ÖL!", "jul: the button label stays ÖL!", r.label);
    ok(r.btnTop, "jul: a tap on the middle of the ÖL! button still reaches the button");
    const now = await rects(c.page);
    ok(JSON.stringify(now) === JSON.stringify(base), "jul: no layout shift (button, wrap, topbar, dock rectangles equal to the no-theme page)", { base, now });
    // ticker: the build mixes theme lines (through DIALEKT.t); an event tells the ticker to rebuild
    const tk = await c.page.evaluate(() => {
      const out = []; for (let i = 0; i < 1; i++) { try { out.push(window.NEWS.build([], { center: null, checkins: [] })); } catch (e) { out.push("ERR " + e.message); } }
      return out[0];
    });
    const th = Array.isArray(tk) ? tk.filter((x) => x.cls === "tk-theme") : [];
    ok(Array.isArray(tk) && tk.length >= 1, "NEWS.build still returns a belt with the theme wrapped around it", tk);
    ok(!Array.isArray(tk) || tk.length < 4 || th.length >= 1, "jul: the belt carries at least one Jul line", tk);
    ok(th.every((x) => THEME.jul.tick.sv.includes(x.text)), "jul: a Jul line is one of the Jul lines (sv)", th);
    ok(c.errs.length === 0, "no page error", c.errs);
    await c.ctx.close();
  }
  // date-driven: 20 Dec 2026 12:00 Stockholm = Jul; switch row off/on; resume re-check
  {
    const c = await fresh(browser, { time: "2026-12-20T11:00:00Z" }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme === "jul", null, { timeout: 10000 }).catch(() => {});
    ok((await theme(c.page)) === "jul", "20 Dec 2026 (no URL param): Jul by the date window");
    ok([...new Set(c.reqs)].sort().join() === "index.json,jul.json" && c.reqs.length <= 4, "only index.json + jul.json are fetched", c.reqs);
    const row = await c.page.evaluate(() => {
      document.body.appendChild(window.PN.themes.settingsRow());
      const r = document.querySelector(".pn-th-set"), b = r.querySelector("[role=switch]");
      return { title: r.textContent, on: b.getAttribute("aria-checked"), sw: r.querySelector(".switch").getAttribute("aria-checked") };
    });
    ok(/Säsongstema/.test(row.title) && /Jul/.test(row.title) && row.on === "true" && row.sw === "true", "Installningar row: 'Säsongstema', default ON, shows the active theme", row);
    await c.page.click(".pn-th-set [role=switch]"); await c.page.waitForFunction(() => !document.documentElement.getAttribute("data-theme"), null, { timeout: 8000 }).catch(() => {});
    const off = await c.page.evaluate(() => ({ th: document.documentElement.getAttribute("data-theme"), ls: localStorage.getItem("pn_theme_off"), layer: !!document.querySelector(".pn-th-layer"), hat: !!document.querySelector(".pn-th-hat"),
      css: !!document.getElementById("pn-th-css"), inl: document.documentElement.style.getPropertyValue("--ds-amber-t"), sw: document.querySelector(".pn-th-set [role=switch]").getAttribute("aria-checked"), sub: document.querySelector(".pn-th-sub").textContent }));
    ok(!off.th && off.ls === "1" && !off.layer && !off.hat && !off.css && !off.inl && off.sw === "false" && off.sub === "Av", "switch Av: theme removed at once, tokens restored, stored as pn_theme_off=1", off);
    const n0 = c.reqs.length; await run(c.page);
    ok(c.reqs.length === n0 && !(await theme(c.page)), "switch Av: a later check fetches nothing and keeps none", c.reqs);
    await c.page.click(".pn-th-set [role=switch]"); await c.page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "jul", null, { timeout: 8000 }).catch(() => {});
    ok((await theme(c.page)) === "jul" && (await c.page.evaluate(() => localStorage.getItem("pn_theme_off"))) === null, "switch På: the theme is back");
    // low data: the tab comes back while the theme file is gone = the running theme stays
    await c.ctx.route(/\/themes\//, (r) => r.abort());
    await c.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await c.page.waitForTimeout(800);
    ok((await theme(c.page)) === "jul", "a failed re-check when the tab comes back keeps the running theme");
    ok(c.errs.length === 0, "no page error", c.errs);
    await c.ctx.close();
  }
  // a phone in Los Angeles, 13 Dec 2026 23:30 Stockholm (= 14:30 in LA): Lucia wins over Jul; 15 Dec back to Jul
  {
    const c = await fresh(browser, { tz: "America/Los_Angeles", time: "2026-12-13T22:30:00Z" }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme, null, { timeout: 10000 }).catch(() => {});
    ok((await theme(c.page)) === "lucia", "LA phone at 23:30 Stockholm time on 13 Dec: Lucia (priority over Jul)");
    ok(await c.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pn-theme-accent").trim() === "#f7e7a0"), "lucia: its own tokens");
    await c.ctx.close();
  }
  // reduced motion: nothing animates (static sprites); the layer is still there
  {
    const c = await fresh(browser, { q: "?theme=jul", reduced: true }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme === "jul", null, { timeout: 10000 }).catch(() => {});
    const r = await c.page.evaluate(() => { const L = document.querySelector(".pn-th-layer"); return { n: L ? L.querySelectorAll(".pn-th-s").length : -1, anim: L ? L.getAnimations({ subtree: true }).length : -1, top: L && getComputedStyle(L.querySelector(".pn-th-s")).top }; });
    ok(r.n >= 1 && r.anim === 0, "reduced motion: sprites are static (no running animation)", r);
    await c.ctx.close();
  }
  // motion on: the sprites do move, and the hidden tab pauses them
  {
    const c = await fresh(browser, { q: "?theme=jul" }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme === "jul", null, { timeout: 10000 }).catch(() => {});
    const a = await c.page.evaluate(() => document.querySelector(".pn-th-layer").getAnimations({ subtree: true }).length);
    ok(a >= 1 && a <= 12, "motion on: 1..12 compositor animations (one per sprite)", a);
    await c.ctx.close();
  }
  // the theme file is missing (offline): the app is normal, one warning, no error loop
  {
    const c = await fresh(browser, { q: "?theme=jul", abort: true });
    await run(c.page); await run(c.page); await c.page.waitForTimeout(500);
    ok(!(await theme(c.page)) && !(await c.page.$(".pn-th-layer, #pn-th-css, .pn-th-hat")), "theme file missing: no theme, nothing left behind");
    ok(c.warns.length <= 1 && c.errs.length === 0, "theme file missing: at most one warning, no page error", { w: c.warns, e: c.errs });
    ok(await c.page.evaluate(() => !!document.getElementById("btn-beer") && document.getElementById("beer-label").textContent === "ÖL!"), "theme file missing: the app itself is unchanged");
    await c.ctx.close();
  }
  // a refused theme (forbidden key) is not applied
  {
    const c = await fresh(browser, { q: "?theme=jul" });
    await c.ctx.route(/\/themes\/jul\.json/, (r) => J(r, Object.assign({}, THEME.jul, { position: "fixed" })));
    await run(c.page); await c.page.waitForTimeout(300);
    ok(!(await theme(c.page)) && c.warns.length === 1, "a theme file with a forbidden key is refused (one warning)", c.warns);
    await c.ctx.close();
  }
  // low-end phone (2 cores), 20 Dec: tokens + hat + texts, no sprite layer (no preview param); the preview param still shows the layer
  {
    const c = await fresh(browser, { cores: 2, time: "2026-12-20T11:00:00Z" }); await run(c.page);
    await c.page.waitForFunction(() => document.documentElement.dataset.theme === "jul", null, { timeout: 10000 }).catch(() => {});
    ok((await theme(c.page)) === "jul" && !(await c.page.$(".pn-th-layer")) && !!(await c.page.$(".pn-th-hat")), "low-end phone: Jul without the sprite layer (tokens + hat stay)");
    await c.ctx.close();
  }
  await browser.close();
}

(async () => {
  if (PARTS.includes("unit")) unit();
  if (PARTS.includes("app")) await app();
  console.log(`\nthemes-pw: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack || e); process.exit(1); });
