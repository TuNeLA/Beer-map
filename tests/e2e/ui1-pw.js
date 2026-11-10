// ui1 tests (Wave 1, 10 Nov): B3 sticky day headers · B4 chip fades · B6 close jumps · B7 bar card report buttons ·
// B10 top bar pill fit · B11 tabs under the sheet header · B12 precision bubble only on tap.
// Mocked Supabase, Leaflet-shaped raster map (no Mapbox). usage: node ui1-pw.js <port> [shot-tag]   (B5 + real zones: ui1-map-pw.js)
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT, DIR = SP + "ui1-shots/";
fs.mkdirSync(DIR, { recursive: true });
const TAG = process.argv[3] || "t";
const { wait, clickJS } = H;
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name, clip) => page.screenshot({ path: DIR + TAG + "-" + name + ".png", ...(clip ? { clip } : {}) }).catch(() => {});

// ---------- 29 events in the next month (Hockey 20, Fotboll 5, På TV 21, Quiz 4) ----------
function events() {
  const out = [], day = (d, hh) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(hh, 0, 0, 0); return t.toISOString(); };
  let id = 9000;
  const teams = [["Västerås IK", "Leksands IF"], ["Visby/Roma HK", "Mora IK"], ["BIK Karlskoga", "Södertälje SK"], ["AIK", "Djurgården"], ["Modo", "IF Björklöven"]];
  for (let k = 0; k < 10; k++) for (let j = 0; j < 2; j++) {
    const t = teams[(k + j) % teams.length];
    out.push({ id: id++, kind: "sport", sport: "hockey", tv: true, league: "HockeyAllsvenskan", title: t[0] + " – " + t[1], home: t[0], away: t[1], starts_at: day(2 + k * 2, 19) });
  }
  out.push({ id: id++, kind: "sport", sport: "fotboll", tv: true, league: "Premier League", title: "Arsenal – Chelsea", home: "Arsenal", away: "Chelsea", starts_at: day(3, 21) });
  for (let k = 0; k < 4; k++) out.push({ id: id++, kind: "sport", sport: "fotboll", league: "Div 2", title: "Ludvika FK – IFK Ore " + (k + 1), place: "Ludvika IP", lat: 60.15, lng: 15.19, starts_at: day(4 + k * 5, 14) });
  for (let k = 0; k < 4; k++) out.push({ id: id++, kind: "quiz", title: "Pubquiz " + (k + 1), place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, starts_at: day(1 + k * 7, 20) });
  return out;
}
const EV = events();
async function setup(browser, w, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] || 844 }, o);
  await page.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: EV }));
  if (o.init) await ctx.addInitScript(o.init);
  if (o.url) { await page.goto(`http://127.0.0.1:${process.argv[2]}/${o.url}`); await page.waitForFunction(() => window.PNI && window.PNDS, null, { timeout: 30000 }).catch(() => {}); await wait(page, o.settle || 3500); }
  else await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}

// ---------- B6 (static): no closing class may hit a generic CSS rule (the .pn-out lesson) ----------
function staticCloseScan() {
  const D = path.join(__dirname, "../../docs/");
  const js = fs.readdirSync(D + "js").filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(D + "js/" + f, "utf8")).join("\n") + fs.readFileSync(D + "app.js", "utf8");
  const cls = new Set();
  for (const m of js.matchAll(/classList\.add\("([\w-]+)"\);?\s*(?:\/\*[^*]*\*\/\s*)?setTimeout\(function \(\) \{[^}]*remove/g)) cls.add(m[1]);
  for (const m of js.matchAll(/classList\.add\("([\w-]+)"\);?\s*setTimeout\(/g)) cls.add(m[1]);
  const bad = [];
  for (const f of fs.readdirSync(D).filter((f) => f.endsWith(".css"))) {
    const t = fs.readFileSync(D + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const sel of m[1].split(",")) for (const c of cls) {
      const last = sel.trim().split(/[\s>+~]+/).pop() || "";
      if (new RegExp("^\\." + c + "(:[\\w-]+(\\([^)]*\\))?)*$").test(last) && /display|width|height|margin|padding|position/.test(m[2])) bad.push(f + " " + sel.trim() + " (" + c + ")");
    }
  }
  return { cls: [...cls].sort(), bad };
}

// record a box every frame from now until it is gone (or ms)
async function boxFrames(page, sel, ms) {
  return page.evaluate(([sel, ms]) => new Promise((res) => {
    const out = [], t0 = performance.now();
    const f = () => { const e = typeof sel === "string" ? document.querySelector(sel) : null; if (!e || !e.isConnected) { res(out); return; }
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e); out.push({ t: Math.round(performance.now() - t0), x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), o: +cs.opacity, bg: cs.backgroundColor, cls: e.className });
      if (performance.now() - t0 > ms) { res(out); return; } requestAnimationFrame(f); };
    f(); }), [sel, ms]);
}
function noJump(fr, w0, h0, moveMax) {
  if (!fr.length) return { ok: true, why: "gone at once" };
  const x0 = fr[0].x, y0 = fr[0].y; let worst = 0, why = "";
  for (const f of fr) {
    const dw = f.w - w0, dh = f.h - h0, mv = Math.hypot(f.x - x0, f.y - y0);
    if (dw > 1 || dh > 1) { worst = Math.max(worst, dw, dh); why = "grew " + JSON.stringify(f); }
    if (dw < -1 && f.o > 0.5 || dh < -1 && f.o > 0.5) { why = why || "size jump " + JSON.stringify(f); worst = Math.max(worst, -dw, -dh); }
    if (mv > (moveMax || 10)) { why = why || "moved " + JSON.stringify(f); worst = Math.max(worst, mv); }
  }
  return { ok: !why, why, n: fr.length };
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // ================= B6 static scan =================
  const sc = staticCloseScan();
  ok(!sc.bad.length, "B6 no closing class hits a generic layout rule (classes: " + sc.cls.join(" ") + ")", sc.bad);

  for (const w of W3) {
    // ================= B3 + B4 event sheet =================
    {
      const { ctx, page } = await setup(browser, w);
      await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1500);
      await page.evaluate(() => { const b = document.querySelector('.evs-time button[data-t="month"]'); if (b) b.click(); }); await wait(page, 1500);
      await page.evaluate(() => { const b = document.querySelector('.evs-chip[data-k="hockey"]'); if (b) b.click(); }); await wait(page, 800);
      // open the TV folds so the days are long (like the owner's screenshot)
      for (let i = 0; i < 6; i++) { const did = await page.evaluate(() => { const b = document.querySelector('.evs-tvh[aria-expanded="false"]'); if (b) { b.click(); return true; } return false; }); if (!did) break; await wait(page, 250); }
      const n = await page.evaluate(() => document.querySelectorAll(".evs-day").length);
      let worst = null, multi = 0, steps = 0;
      for (let y = 0; y <= 1800; y += 23) {
        const r = await page.evaluate((y) => {
          const b = document.getElementById("sheet-body"); b.scrollTop = y;
          const bar = document.querySelector(".evs-bar").getBoundingClientRect(), br = b.getBoundingClientRect();
          const hs = [...document.querySelectorAll(".evs-day")].map((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, txt: e.textContent }; })
            .filter((h) => h.b > bar.bottom + 0.5 && h.t < br.bottom);
          let ov = null;
          for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const o = Math.min(hs[i].b, hs[j].b) - Math.max(hs[i].t, hs[j].t); if (o > 1) ov = { a: hs[i].txt, b: hs[j].txt, px: +o.toFixed(1) }; }
          const stuck = hs.filter((h) => Math.abs(h.t - bar.bottom) < 2).length;
          return { ov, stuck, top: b.scrollTop };
        }, y);
        steps++;
        if (r.ov && !worst) worst = { y, ...r.ov };
        if (r.stuck > 1) multi++;
        if (y === 92 || y === 437) await shot(page, "B3-month-" + w + "-y" + y, { x: 0, y: 0, width: w, height: Math.min(HT[w], 700) });
        if (r.top < y - 30) break;
      }
      ok(n >= 5 && !worst && !multi, w + ": B3 Månad · Hockey: day headers never stack (one at a time, the next pushes the old one out) over " + steps + " scroll steps", { n, worst, multi });
      const z = await page.evaluate(() => { const d = document.querySelector(".evs-day"), b = document.querySelector(".evs-bar"); return { day: +getComputedStyle(d).zIndex, bar: +getComputedStyle(b).zIndex, bg: getComputedStyle(d).backgroundColor }; });
      ok(z.day < z.bar && !/rgba\(0, 0, 0, 0\)/.test(z.bg), w + ": B3 day header is solid and under the chip row", z);
      // B4: fades
      await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; }); await wait(page, 200);
      const f = await page.evaluate(async () => {
        const c = document.querySelector(".evs-chips"), m = () => getComputedStyle(c).webkitMaskImage || getComputedStyle(c).maskImage || "none";
        const fades = (s) => ({ l: /^linear-gradient\(90deg, (transparent|rgba\(0, 0, 0, 0\))/.test(s), r: /(transparent|rgba\(0, 0, 0, 0\))\)$/.test(s) });
        const out = { max: c.scrollWidth - c.clientWidth };
        c.scrollLeft = 0; c.dispatchEvent(new Event("scroll")); await new Promise((r) => setTimeout(r, 80)); out.start = fades(m());
        c.scrollLeft = 1e5; c.dispatchEvent(new Event("scroll")); await new Promise((r) => setTimeout(r, 80)); out.end = fades(m());
        const last = c.lastElementChild.getBoundingClientRect(), cr = c.getBoundingClientRect();
        out.lastIn = last.right <= cr.right + 0.5 && last.left >= cr.left - 0.5; out.last = c.lastElementChild.textContent;
        const pl = parseFloat(getComputedStyle(c).paddingLeft), pr = parseFloat(getComputedStyle(c).paddingRight); out.pad = [pl, pr];
        return out;
      });
      ok(f.max > 0 ? (f.start.r && !f.start.l) : (!f.start.r && !f.start.l), w + ": B4 at the start: fade only on the right (more chips there)", f);
      ok(!f.end.r && (f.max <= 0 || f.end.l) && f.lastIn, w + ": B4 at the end: last chip '" + f.last + "' fully visible, no right fade", f);
      ok(Math.abs(f.pad[0] - f.pad[1]) < 0.5, w + ": B4 end padding = start padding", f.pad);
      await shot(page, "B4-chips-end-" + w, { x: 0, y: 0, width: w, height: 420 });
      // the chosen chip comes into view when the sheet opens again (På TV = the last chip)
      await page.evaluate(() => { const b = document.querySelector('.evs-chip[data-k="tv"]'); if (b) b.click(); }); await wait(page, 300);
      await H.closeSheet(page); await wait(page, 700);
      await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1500);
      await page.evaluate(() => { const b = document.querySelector('.evs-time button[data-t="month"]'); if (b) b.click(); }); await wait(page, 1200);
      const iv = await page.evaluate(() => { const c = document.querySelector(".evs-chips"), b = c && c.querySelector('[aria-pressed="true"]'); if (!b) return null; const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { k: b.getAttribute("data-k"), in: r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5, l: Math.round(r.left), r: Math.round(r.right), cl: Math.round(cr.left), cr: Math.round(cr.right),
          sl: Math.round(c.scrollLeft), max: c.scrollWidth - c.clientWidth, ow: b.offsetWidth, tf: getComputedStyle(b).transform, ml: getComputedStyle(b).marginRight }; });
      ok(iv && iv.k === "tv" && iv.in, w + ": B4 the chosen chip (På TV) is in view when the sheet opens", iv);
      await shot(page, "B4-chips-open-tv-" + w, { x: 0, y: 0, width: w, height: 420 });
      await page.evaluate(() => { try { localStorage.removeItem("olnu.evsFilter"); } catch (e) {} });
      await ctx.close();
    }

    // ================= B10 top bar pill =================
    {
      const { ctx, page } = await setup(browser, w);
      const names = ["Upplands Väsby", "Malung-Sälen", "Östra Göinge", "Smedjebacken", "Skinnskatteberg", "Ludvika"];
      for (const [n, some] of [[3, false], [0, false]]) {
        const res = await page.evaluate(([names, n, some]) => {
          const el = document.getElementById("live-count"), out = [];
          const oldFit = (name) => {   // the code before ui1 (zones.js pill()): 3 one-line variants, then CSS ellipsis
            const h = name + (n ? " · <b>" + n + "</b> ute ikväll" : " · lugnt ikväll");
            const vs = [h, h.replace(/ ikväll$/, ""), h.replace(/ ute ikväll$/, "").replace(/ · lugnt ikväll$/, " · lugnt")];
            el.classList.add("zn-pill"); for (const v of vs) { el.innerHTML = v; if (el.scrollWidth <= el.clientWidth + 1) break; }
          };
          for (const name of names) {
            if (window.ZONES && window.ZONES._fitPill) window.ZONES._fitPill(name, n, some); else oldFit(name);
            const nm = el.querySelector(".zn-pn"), tb = document.getElementById("btn-top").getBoundingClientRect(), r = el.getBoundingClientRect(), br = document.querySelector(".brand").getBoundingClientRect();
            const cut = el.scrollWidth > el.clientWidth + 1 || (nm && nm.scrollWidth > nm.clientWidth + 1);
            const fs = nm ? parseFloat(getComputedStyle(nm).fontSize) : parseFloat(getComputedStyle(el).fontSize);
            out.push({ name, txt: el.textContent.replace(/ /g, " "), whole: (nm ? nm.textContent : el.textContent).indexOf(name) === 0, cut, fs, clear: r.right <= tb.left - 4 && r.left >= br.right, two: el.classList.contains("zn-2l"), tight: document.body.classList.contains("pn-pill-tight") });
          }
          return out;
        }, [names, n, some]);
        const bad = res.filter((x) => !x.whole || x.cut || x.fs < 14 || !x.clear);
        ok(!bad.length, w + ": B10 pill (" + (n ? n + " ute" : "lugnt") + "): " + names.length + " town names whole, font ≥ 14, nothing cut, clear of 🏆", bad.length ? bad : res.map((x) => x.name + (x.two ? "²" : "") + (x.tight ? "ᵗ" : "")));
      }
      for (const name of ["Smedjebacken", "Upplands Väsby"]) {
        await page.evaluate((name) => { if (window.ZONES && window.ZONES._fitPill) window.ZONES._fitPill(name, 3, false); else { const el = document.getElementById("live-count"); el.classList.add("zn-pill"); const h = name + " · <b>3</b> ute ikväll";
          for (const v of [h, h.replace(/ ikväll$/, ""), h.replace(/ ute ikväll$/, "")]) { el.innerHTML = v; if (el.scrollWidth <= el.clientWidth + 1) break; } } }, name);
        await shot(page, "B10-pill-" + name.replace(/\W+/g, "") + "-" + w, { x: 0, y: 0, width: w, height: 64 });
      }
      await ctx.close();
    }

    // ================= B11 tabs under a sheet header =================
    {
      const { ctx, page } = await setup(browser, w);
      const measure = (name) => page.evaluate((name) => {
        const head = document.querySelector("#sheet .sheet-head"), body = document.getElementById("sheet-body");
        const t = body.querySelector(":scope > .tabs, :scope > .tt-bar, :scope > .ds-seg, :scope > .evs-bar .ds-seg");
        if (!head || !t) return { name, none: true };
        const hb = head.getBoundingClientRect().bottom, line = parseFloat(getComputedStyle(head).borderBottomWidth);
        const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
        return { name, cls: t.className, gap: +(r.top - hb).toFixed(1), line, outline: cs.boxShadow !== "none" || parseFloat(cs.borderTopWidth) > 0 };
      }, name);
      const sheets = [
        ["Grupper", async () => { await clickJS(page, "#btn-groups"); await wait(page, 1600); }],
        ["Vänner", async () => { await page.evaluate(() => { const b = document.querySelector('.inv-tabs button[data-t="f"]'); if (b) b.click(); }); await wait(page, 1000); }],
        ["Inkorg", async () => { await page.evaluate(() => { const b = document.querySelector('.inv-tabs button[data-t="i"]'); if (b) b.click(); }); await wait(page, 1000); }],
        ["Topplista", async () => { await H.closeSheet(page); await wait(page, 500); await clickJS(page, "#btn-top"); await wait(page, 1800); }],
        ["Profil", async () => { await H.closeSheet(page); await wait(page, 500); await clickJS(page, "#btn-settings"); await wait(page, 1800); }],
        ["Event", async () => { await H.closeSheet(page); await wait(page, 500); await page.evaluate(() => window.EVSHEET.open()); await wait(page, 1500); }],
      ];
      for (const [name, go] of sheets) {
        await go();
        const a = await measure(name);
        if (a.none) { ok(name === "Topplista" || name === "Event", w + ": B11 " + name + ": no segmented control under the header", a); continue; }
        await shot(page, "B11-" + name + "-" + w, { x: 0, y: 0, width: w, height: 420 });
        await page.evaluate(() => { const b = document.getElementById("sheet-body"); b.scrollTop = 240; b.dispatchEvent(new Event("scroll")); }); await wait(page, 400);
        const s = await measure(name);
        await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; }); await wait(page, 200);
        ok(a.gap >= 8 && (s.none || s.gap >= 8 || s.gap === a.gap), w + ": B11 " + name + ": the tab box sits ≥ 8 px under the header line (no double line), at the top and when sticky", { top: a, sticky: s });
      }
      await ctx.close();
    }

    // ================= B7 bar card: Kö och erbjudanden =================
    {
      const { ctx, page } = await setup(browser, w, { url: "?bar=n3472634175", checkin: false, settle: 5000 });
      const r = await page.evaluate(async () => {
        const f = document.querySelector('.leaflet-popup details.pp-fold[data-fold="bp"]'); if (!f) return null;
        const s = f.querySelector(":scope > summary"); s.scrollIntoView({ block: "center" }); s.click();
        await new Promise((r) => setTimeout(r, 500));
        const f2 = document.querySelector('.leaflet-popup details.pp-fold[data-fold="bp"]') || f;
        const body = f2.querySelector(".bp") || f2;
        const inner = body.querySelectorAll("details").length;
        const vis = (e) => e && e.getClientRects().length && e.getBoundingClientRect().height > 0;
        const q = [...f2.querySelectorAll("[data-bpq]")].filter(vis).map((b) => b.textContent.trim());
        const acts = [...f2.querySelectorAll("[data-bpa]")].filter(vis).map((b) => b.textContent.trim());
        const square = [];
        f2.querySelectorAll(".pf-body *").forEach((e) => { if (!vis(e)) return; const cs = getComputedStyle(e);
          const bw = ["Top", "Right", "Bottom", "Left"].filter((k) => parseFloat(cs["border" + k + "Width"]) > 0 && cs["border" + k + "Style"] !== "none" && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs["border" + k + "Color"])).length;
          if (bw >= 4 && parseFloat(cs.borderTopLeftRadius) < 4) square.push(e.tagName + "." + String(e.className).slice(0, 30)); });
        const dashed = [...f2.querySelectorAll(".pf-body *")].filter((e) => vis(e) && getComputedStyle(e).borderTopStyle === "dashed").map((e) => String(e.className).slice(0, 20));
        const copy = !!f2.querySelector(".pi-copy"), emo = /[\u{1F300}-\u{1FAFF}☀-➿]/u.test([...f2.querySelectorAll("button")].map((b) => b.textContent).join(""));
        const sum = f2.querySelector(":scope > summary"), rowIcon = !!(sum && sum.querySelector("svg"));
        const small = [...f2.querySelectorAll(".pf-body button")].filter(vis).filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim());
        const cutL = [...f2.querySelectorAll(".pf-body button, .pf-body button > span")].filter(vis).filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
        return { open: f2.open, inner, q, acts, square, dashed, copy, emo, rowIcon, small, cutL };
      });
      ok(r && r.open && r.inner === 0 && r.q.length === 3 && r.acts.length === 2, w + ": B7 one tap on 'Kö och erbjudanden' shows the 3 queue buttons + Erbjudande + Tipsa gruppen (no inner dropdown)", r);
      ok(r && !r.square.length && !r.dashed.length, w + ": B7 no square box / dashed line around the rounded buttons", r && { square: r.square, dashed: r.dashed });
      ok(r && !r.copy && !r.emo && r.rowIcon && !r.small.length, w + ": B7 PNI icons only (no copy icon, no emoji), the row has its icon, buttons ≥ 44 px", r && { copy: r.copy, emo: r.emo, rowIcon: r.rowIcon, small: r.small });
      ok(r && !r.cutL.length, w + ": B7 no button label is cut", r && r.cutL);
      await page.evaluate(() => { const f = document.querySelector('.leaflet-popup details.pp-fold[data-fold="bp"]'); if (f) f.scrollIntoView({ block: "start" }); }); await wait(page, 300);
      await shot(page, "B7-bar-ko-" + w);
      // every other part of the bar card: open "På väg" (ETA picker) and "Mer", then look for square boxes anywhere in the card
      const all = await page.evaluate(async () => {
        const g = document.querySelector(".leaflet-popup .eta-go"); if (g) { g.click(); await new Promise((r) => setTimeout(r, 400)); }
        const m = document.querySelector('.leaflet-popup details.pp-fold[data-fold="mer"]'); if (m && !m.open) { m.querySelector("summary").click(); await new Promise((r) => setTimeout(r, 400)); }
        const root = document.querySelector(".leaflet-popup .pn-bs7"); if (!root) return null;
        const vis = (e) => e.getClientRects().length && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden";
        const sq = [];
        root.querySelectorAll("*").forEach((e) => { if (!vis(e)) return; const cs = getComputedStyle(e);
          const bw = ["Top", "Right", "Bottom", "Left"].filter((k) => parseFloat(cs["border" + k + "Width"]) > 0 && cs["border" + k + "Style"] !== "none" && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs["border" + k + "Color"])).length;
          if (bw >= 4 && parseFloat(cs.borderTopLeftRadius) < 4 && e.getBoundingClientRect().width > 24) sq.push(e.tagName + "." + String(e.className).slice(0, 30)); });
        return { eta: !!g, sq };
      });
      ok(all && !all.sq.length, w + ": B7 no square bordered box anywhere in the bar card (Info, På väg picker, Mer)", all);
      await ctx.close();
    }
  }

  // ================= B6 close animations (390) =================
  {
    const splashLog = () => {   // init script: watch the splash while it fades
      const out = window.__ui1Splash = [];
      const watch = () => { const s = document.getElementById("pn-splash"); if (!s) return setTimeout(watch, 20);
        const r0 = s.getBoundingClientRect(); out.push({ t: 0, w: r0.width, h: r0.height, bg: getComputedStyle(s).backgroundColor, cls: s.className });
        new MutationObserver(() => { const f = () => { if (!s.isConnected) return; const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
          out.push({ w: r.width, h: r.height, x: r.left, y: r.top, bg: cs.backgroundColor, pad: cs.paddingTop, o: +cs.opacity, cls: s.className }); if (out.length < 40) requestAnimationFrame(f); }; f(); })
          .observe(s, { attributes: true, attributeFilter: ["class"] }); };
      watch();
    };
    const { ctx, page } = await setup(browser, 390, { init: splashLog });
    const sp = await page.evaluate(() => window.__ui1Splash || []);
    const s0 = sp[0] || {}, bad = sp.filter((f) => Math.abs(f.w - s0.w) > 1 || Math.abs(f.h - s0.h) > 1 || f.bg !== s0.bg);
    ok(sp.length >= 2 && !bad.length, "B6 start splash fades out without changing size or colour", { frames: sp.length, first: s0, bad: bad.slice(0, 2) });

    // Ikväll menu + Synlighet menu: open, then a tap outside; the box must only fade (no width / height jump)
    for (const [name, btn, sel] of [["Ikväll menu", "#pn-ikv2", "#pn-ikm"], ["Synlighet menu", "PNVIS", "#pn-vis"]]) {
      await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
      if (btn === "PNVIS") await page.evaluate(() => window.PNVIS && window.PNVIS.open()); else await page.click(btn).catch(() => {});
      await wait(page, 450);
      const r0 = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }, sel);
      if (!r0) { ok(false, "B6 " + name + " opens", null); continue; }
      if (btn === "#pn-ikv2") {   // coordinator 10 Nov: the games row "Vem fixar nästa?" (GAMES.menuRows) is in the Ikväll menu
        const g = await page.evaluate(() => { const m = document.getElementById("pn-ikm"), rows = m ? [...m.querySelectorAll(".pn-ikm-row")].map((r) => r.textContent.trim()) : [];
          return { api: !!(window.GAMES && window.GAMES.menuRows && window.RUNDAN && window.RUNDAN.openSpin), rows, vem: rows.some((t) => /Vem fixar/.test(t)) }; });
        ok(g.api && g.vem, "Ikväll menu has the 'Vem fixar nästa?' row (GAMES.menuRows)", g);
      }
      const p = boxFrames(page, sel, 400);
      await page.keyboard.press("Escape");   // the same close() as a tap outside, without tapping something on the map
      const fr = await p;
      // 3 frames of the close animation for the report: open again, keep the element, pause its animation at 0 / 50 / 100 %
      await wait(page, 300);
      if (btn === "PNVIS") await page.evaluate(() => window.PNVIS.open()); else await page.click(btn).catch(() => {});
      await wait(page, 450);
      await page.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.remove = function () { window.__ui1Kept = this; }; }, sel);
      await page.keyboard.press("Escape"); await wait(page, 20);
      for (const [k, f] of [["0-start", 0], ["1-mid", 0.5], ["2-end", 1]]) {
        await page.evaluate(([sel, f]) => { const e = document.querySelector(sel); if (!e) return; e.getAnimations().forEach((a) => { a.pause(); const d = a.effect.getComputedTiming().duration || 150; a.currentTime = d * f; }); }, [sel, f]);
        await shot(page, "B6-" + name.replace(/\W+/g, "") + "-" + k);
      }
      await page.evaluate((sel) => { const e = document.querySelector(sel); if (e) { delete e.remove; e.remove(); } }, sel);
      const j = noJump(fr, r0.w, r0.h, 10);
      ok(j.ok, "B6 " + name + " closes without a jump (" + fr.length + " frames, " + (fr[0] && fr[0].cls) + ")", { r0, j, f: fr.slice(0, 3) });
      await wait(page, 300);
    }
    // toast: the fade-out copy keeps the toast's size
    await page.evaluate(() => window.PNDS._A().toast("Skål! Ölen ä räknad.", { ms: 1500, urgent: true })); await wait(page, 600);
    const t0 = await page.evaluate(() => { const t = document.querySelector("#toasts .toast"); if (!t) return null; const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const tf = await page.evaluate(() => new Promise((res) => {
      const out = [], t0 = performance.now();
      let g = null;   // follow ONE fade-out copy (the first one) until it is removed
      const f = () => { if (!g) g = [...document.querySelectorAll("body > .toast[aria-hidden=true]")][0] || null;
        if (g && !g.isConnected) return res(out);
        if (g) { const r = g.getBoundingClientRect(), cs = getComputedStyle(g); out.push({ w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: r.left, y: r.top, o: +cs.opacity, bg: cs.backgroundColor, cls: g.className }); }
        if (performance.now() - t0 > 2200) return res(out); requestAnimationFrame(f); };
      f(); }));
    const tj = t0 ? noJump(tf, t0.w, t0.h, 12) : { ok: false };
    ok(t0 && tf.length > 0 && tj.ok, "B6 toast fade-out copy keeps the toast size (" + tf.length + " frames, " + (tf[0] && tf[0].cls) + ")", { t0, tj, f: tf.slice(0, 2) });
    // ⓘ map credits popup
    await page.evaluate(() => { const b = document.getElementById("btn-attrib"); if (b) b.click(); }); await wait(page, 400);
    const a0 = await page.evaluate(() => { const e = document.getElementById("attrib-pop"); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, hidden: e.hidden }; });
    await shot(page, "B6-attrib-0-open");
    const ap = boxFrames(page, "#attrib-pop:not([hidden])", 300);
    await page.mouse.click(200, Math.round(HT[390] * 0.45));
    const af = await ap; await shot(page, "B6-attrib-2-end");
    ok(!a0.hidden && noJump(af, a0.w, a0.h, 4).ok, "B6 ⓘ credits popup closes without a jump", { a0, af: af.slice(0, 3) });
    // "Dagens order" caption: leaves on the first map move
    // the caption box as delight.js makes it (#dl-cap.dl-cap.dl-cap-greet); the close path under test is pnui.js (map move → close class)
    await page.evaluate(() => { document.querySelectorAll("#dl-cap").forEach((x) => x.remove()); document.documentElement.classList.remove("pn-settle");
      const c = document.createElement("div"); c.id = "dl-cap"; c.className = "dl-cap dl-cap-greet dl-in"; c.setAttribute("role", "status");
      c.innerHTML = '<div class="dl-cap-h">Dagens order · tisdag</div><div class="dl-cap-t">Drick vatten mellan varven.</div>'; document.body.appendChild(c); });
    await page.waitForFunction(() => { const c = document.querySelector(".dl-cap-greet"); return c && c.getBoundingClientRect().width > 0 && +getComputedStyle(c).opacity > 0.9; }, null, { timeout: 5000 }).catch(() => {});
    const cap = await page.evaluate(() => { const c = document.querySelector(".dl-cap-greet"); if (!c) return null; const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    await shot(page, "B6-greet-0-open");
    if (cap && cap.w) {
      const c0 = await page.evaluate(() => { const r = document.querySelector(".dl-cap-greet").getBoundingClientRect(); return { w: r.width, h: r.height }; });
      const cp = boxFrames(page, ".dl-cap-greet", 400);
      await page.evaluate(() => window.__map.panBy([40, 0], { animate: false }));
      const cf = await cp;
      ok(noJump(cf, c0.w, c0.h, 10).ok, "B6 Dagens order caption leaves without a jump (" + cf.length + " frames, " + (cf[1] && cf[1].cls) + ")", { c0, cf: cf.slice(0, 3) });
    } else ok(false, "B6 Dagens order caption shows", cap);
    await ctx.close();
  }

  // ================= B12 precision bubble =================
  for (const w of W3) {
    const first = () => { try { if (!sessionStorage.getItem("ui1b12")) { sessionStorage.setItem("ui1b12", 1); localStorage.removeItem("olnu.night"); localStorage.removeItem("olnu.pnBeer1"); } } catch (e) {} };
    const { ctx, page } = await setup(browser, w, { init: first, checkin: false });
    const samp = [];
    for (let i = 0; i < 16; i++) { samp.push(await page.evaluate(() => { const h = document.getElementById("prec-hint"); return { s: h.classList.contains("pn-show"), o: +getComputedStyle(h).opacity, first: document.body.classList.contains("pn-first") }; })); await wait(page, 300); }
    const shown = samp.filter((x) => x.s || x.o > 0.05);
    ok(samp.some((x) => x.first) && !shown.length, w + ": B12 cold start (no beer yet): no 'Exakt plats' bubble by itself", { first: samp[0], shown: shown.length });
    await shot(page, "B12-cold-" + w);
    await page.evaluate(() => { const b = document.querySelector('#prec-seg [aria-checked="true"]') || document.querySelector("#prec-seg button"); if (b) b.click(); }); await wait(page, 450);
    const tap = await page.evaluate(() => { const h = document.getElementById("prec-hint"); return { s: h.classList.contains("pn-show"), txt: h.textContent }; });
    ok(tap.s && tap.txt.length > 5, w + ": B12 a tap on Exakt / Område shows the bubble", tap);
    await shot(page, "B12-tap-" + w);
    await ctx.close();
  }

  await browser.close();
  console.log("ui1 done: pass " + pass + " fail " + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack || e)); process.exit(1); });
