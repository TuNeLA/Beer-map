// dprofile-pw.js — lane d-profile (owner I-114, design proposals 05 + 06 + "the bottom of the sheet looks cut off").
// A  settings sub-pages: no Profil | Inställningar strip, a one-line title, every hint in full, one sheet height (small fix 12)
// B  soft scroll edges (docs/sheetfade.css + js/sheetfade.js): a fade at the bottom while content goes on, gone at the end,
//    none when the content fits, a fixed footer inside the sheet is never masked, a floating bar = no bottom fade
// C  Profil: identity card, then "Vem ser mig" (the real settings), then the rest; no "öl kvar" goal; the progress bar counts
//    MERITS ("N meriter till …", owner wording 15 Nov); one SVG icon per rank (js/rankico.js); the same rank name on Profil and Min uniform
//    (small fix 6); Konto: Swish = a normal row (11); Radera kontot has a ghost "Avbryt" (24)
// 360 + 390 px, mocked Supabase (port B). Usage: node dprofile-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const TITLES = { 12: "Menig Mellanöl", 103: "Löjtnant Lager", 2650: "Ölguden" };

// o.mer = my merits (the server's my_stats gives them since 0036); no o.mer = the helper's default answer (an old server: no merits)
async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, {});
  if (o.mer != null) {
    await ctx.addInitScript((t) => { try { localStorage.setItem("olnu.title", t); } catch (e) {} }, TITLES[o.mer]);   // no promotion pop-up
    await page.route(/rest\/v1\/rpc\/my_stats/, (r) => r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ total: 43, week: 6, title: TITLES[o.mer], meriter: o.mer, tonight_meriter: 6 }) }));
  }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.PN && window.PN.showSettings && window.RANKICO && window.SHEETFADE && window.SOCIAL && window.SOCIAL.stats && window.SOCIAL.stats(), null, { timeout: 20000 }).catch(() => console.log("no stats"));
  await wait(page, 300);
  return { ctx, page, errs };
}
const profil = async (page) => { await page.evaluate(() => window.PN.showSettings("p")); await page.waitForSelector("#sheet-body .pn-pf", { timeout: 8000 }).catch(() => {}); await wait(page, 700); };
const setPage = async (page, key) => { await page.evaluate((k) => window.PN.showSettings("s", k), key); await wait(page, 1900); };   // the last fill() pass runs at 1.5 s
const fadeState = (page, sel) => page.evaluate((sel) => {
  const b = document.querySelector(sel || "#sheet-body"); if (!b) return null;
  window.SHEETFADE.sync();
  const cs = getComputedStyle(b), m = cs.webkitMaskImage || cs.maskImage || "none";
  return { top: b.classList.contains("sf-top"), bot: b.classList.contains("sf-bot"), mask: m === "none" ? "" : m, st: Math.round(b.scrollTop), max: Math.round(b.scrollHeight - b.clientHeight),
    foot: b.style.getPropertyValue("--sf-foot"), b: b.style.getPropertyValue("--sf-b"), t: b.style.getPropertyValue("--sf-t"), head: b.style.getPropertyValue("--sf-head") };
}, sel);
const scrollTo = async (page, y, sel) => { await page.evaluate(([y, sel]) => { const b = document.querySelector(sel || "#sheet-body"); b.scrollTop = y === "end" ? b.scrollHeight : y; }, [y, sel]); await wait(page, 250); };

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- A: settings sub-pages, 360 and 390 px ---------- */
    for (const vp of [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
      const { ctx, page, errs } = await open(browser, vp);
      const W = vp.width;
      await page.evaluate(() => window.PN.showSettings("s")); await wait(page, 1200);
      const root = await page.evaluate(() => { const t = document.querySelector("#sheet-body > .tabs.pf-tabs"), s = document.getElementById("sheet");
        return { tabs: !!t && getComputedStyle(t).display !== "none" && t.offsetHeight > 0, h: Math.round(s.getBoundingClientRect().height) }; });
      ok(W + " A root list keeps the Profil | Inställningar strip", root.tabs, root);
      const bad = [];
      for (const key of ["konto", "synl", "notis", "plats", "karta", "hjalp", "om"]) {
        await setPage(page, key);
        const p = await page.evaluate(() => {
          const t = document.querySelector("#sheet-body > .tabs.pf-tabs"), s = document.getElementById("sheet"), h2 = document.getElementById("sheet-title");
          const pg = document.querySelector("#sheet-body .set-page:not([hidden])");
          const hints = pg ? [...pg.querySelectorAll(".ds-item-hint, .ds-row-t > small")].filter((e) => e.offsetParent && (e.textContent || "").trim()) : [];
          return { pg: pg && pg.getAttribute("data-pg"), tabs: !!t && getComputedStyle(t).display !== "none" && t.offsetHeight > 0, title: h2.textContent, titleH: Math.round(h2.getBoundingClientRect().height),
            titleCut: h2.scrollWidth > h2.clientWidth + 1, h: Math.round(s.getBoundingClientRect().height), back: !!document.getElementById("pn-back") && !document.getElementById("pn-back").hidden,
            nHints: hints.filter((e) => e.classList.contains("ds-item-hint")).length,
            cut: hints.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 || (e.classList.contains("ds-item-hint") && !/^(none|auto|normal|)$/.test(String(getComputedStyle(e).webkitLineClamp))))
              .map((e) => e.className + ": " + e.textContent.trim().slice(0, 40) + " " + e.scrollHeight + "/" + e.clientHeight + " clamp " + getComputedStyle(e).webkitLineClamp) };
        });
        if (p.pg !== key || p.tabs || p.titleH > 34 || p.titleCut || !p.back || p.cut.length || Math.abs(p.h - root.h) > 1) bad.push({ key, ...p });
        if (key === "synl") {
          ok(W + " A Integritet: title is one line (\"Integritet\"), with back", p.title === "Integritet" && p.titleH <= 34 && p.back, p);
          ok(W + " A Integritet: the privacy hints show in full (no clamp, nothing cut)", p.nHints >= 2 && p.cut.length === 0, p);
        }
      }
      ok(W + " A every settings page: no tab strip, one-line title not cut, back, hints in full, same sheet height as the root", bad.length === 0, bad);
      await page.evaluate(() => document.getElementById("pn-back").click()); await wait(page, 500);
      const again = await page.evaluate(() => { const t = document.querySelector("#sheet-body > .tabs.pf-tabs"); return { tabs: !!t && getComputedStyle(t).display !== "none" && t.offsetHeight > 0, title: document.getElementById("sheet-title").textContent,
        hub: !document.querySelector("#sheet-body .set-hub").hidden }; });
      ok(W + " A back from a page: the root list and the strip are back", again.tabs && again.hub && again.title === "Inställningar", again);
      ok(W + " A no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    /* ---------- B: soft scroll edges ---------- */
    {
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { mer: 103 });
      await profil(page);
      let f = await fadeState(page);
      ok("B Profil at the top: bottom fade on, no top fade, mask = a gradient", f.max > 100 && f.bot && !f.top && /gradient/.test(f.mask) && f.b === "28px", f);
      await scrollTo(page, 300); f = await fadeState(page);
      ok("B Profil in the middle: both edges fade", f.top && f.bot && /gradient/.test(f.mask) && f.t === "16px" && f.b === "28px", f);
      // the sticky Profil | Inställningar strip is never masked: the top fade starts under it
      const strip = await page.evaluate(() => { const b = document.getElementById("sheet-body").getBoundingClientRect(), t = document.querySelector("#sheet-body > .tabs.pf-tabs").getBoundingClientRect();
        return { zone: Math.round(t.bottom - b.top), clip: { x: Math.round(t.left), y: Math.round(t.top), width: Math.round(t.width), height: Math.round(t.height) },
          under: { x: Math.round(t.left), y: Math.round(t.bottom), width: Math.round(t.width), height: 16 } }; });
      ok("B Profil in the middle: the top fade starts under the sticky strip (--sf-head = its bottom edge)", f.head === strip.zone + "px" && strip.zone >= 52 && strip.zone <= 90, { f, strip });
      const s1 = await page.screenshot({ clip: strip.clip }), u1 = await page.screenshot({ clip: strip.under });
      await page.evaluate(() => { document.getElementById("sheet-body").style.setProperty("-webkit-mask-image", "none"); document.getElementById("sheet-body").style.setProperty("mask-image", "none"); });
      const s2 = await page.screenshot({ clip: strip.clip }), u2 = await page.screenshot({ clip: strip.under });
      await page.evaluate(() => { document.getElementById("sheet-body").style.removeProperty("-webkit-mask-image"); document.getElementById("sheet-body").style.removeProperty("mask-image"); });
      ok("B the sticky strip keeps its pixels (crisp), the 16 px under it fade", s1.equals(s2) && !u1.equals(u2));
      await scrollTo(page, f.max - 10); f = await fadeState(page);
      ok("B 10 px before the end: the bottom fade is 10 px (it shrinks, no pop)", f.bot && f.b === "10px", f);
      await scrollTo(page, "end"); f = await fadeState(page);
      ok("B Profil at the end: the bottom fade is gone, the top fade stays", !f.bot && f.top && f.b === "" && /gradient/.test(f.mask), f);
      // the pixels: the bottom 28 px of the scroll area differ with / without the mask at the top of the scroll; not at the end
      await scrollTo(page, 0);
      const edge = await page.evaluate(() => { const r = document.getElementById("sheet-body").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.bottom - 28), width: Math.round(r.width), height: 28 }; });
      const withMask = await page.screenshot({ clip: edge });
      await page.evaluate(() => { document.getElementById("sheet-body").style.setProperty("-webkit-mask-image", "none"); document.getElementById("sheet-body").style.setProperty("mask-image", "none"); });
      const noMask = await page.screenshot({ clip: edge });
      await page.evaluate(() => { document.getElementById("sheet-body").style.removeProperty("-webkit-mask-image"); document.getElementById("sheet-body").style.removeProperty("mask-image"); });
      ok("B the last 28 px really fade (pixels differ from the unmasked sheet)", !withMask.equals(noMask));

      // content that fits: no mask at all
      await setPage(page, "hjalp"); f = await fadeState(page);
      ok("B a sheet whose content fits: no fade, no mask", f.max <= 2 && !f.top && !f.bot && f.mask === "", f);

      // a fixed footer inside the sheet (the where-sheet "Hemma…" row of lane d-beer is one): never masked, the fade ends above it
      const footSheet = (kind) => page.evaluate((kind) => new Promise((res) => {
        const A = window.PNDS._A();
        A.openSheet("Fot " + kind, (body) => {
          const list = document.createElement("div"); list.className = "ds-list";
          for (let i = 0; i < 30; i++) { const r = document.createElement("div"); r.className = "ds-row"; r.textContent = "Rad " + (i + 1); r.style.minHeight = "56px"; list.appendChild(r); }
          body.appendChild(list);
          const f = document.createElement("div"); f.id = "t-foot"; f.textContent = "Hemma eller annan plats";
          f.style.cssText = "position:sticky;bottom:0;height:56px;display:flex;align-items:center;background:var(--ds-card);z-index:3";
          if (kind === "class") f.className = "sheet-foot"; if (kind === "float") f.className = "gpg-bar";
          body.appendChild(f);
        }, { now: true });
        setTimeout(res, 700);
      }), kind);
      for (const kind of ["class", "plain"]) {
        await footSheet(kind); f = await fadeState(page);
        const g = await page.evaluate(() => { const b = document.getElementById("sheet-body").getBoundingClientRect(), r = document.getElementById("t-foot").getBoundingClientRect();
          return { foot: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, zone: Math.round(b.bottom - r.top),
            above: { x: Math.round(r.left), y: Math.round(r.top - 28), width: Math.round(r.width), height: 28 } }; });
        ok("B footer (" + kind + "): bottom fade on, the footer zone is kept out of the mask (--sf-foot = its height)", f.bot && f.foot === g.zone + "px" && g.zone >= 56 && g.zone <= 80, { f, g });
        const a1 = await page.screenshot({ clip: g.foot }), b1 = await page.screenshot({ clip: g.above });
        await page.evaluate(() => { document.getElementById("sheet-body").style.setProperty("-webkit-mask-image", "none"); document.getElementById("sheet-body").style.setProperty("mask-image", "none"); });
        const a2 = await page.screenshot({ clip: g.foot }), b2 = await page.screenshot({ clip: g.above });
        await page.evaluate(() => { document.getElementById("sheet-body").style.removeProperty("-webkit-mask-image"); document.getElementById("sheet-body").style.removeProperty("mask-image"); });
        ok("B footer (" + kind + "): the footer pixels are the same with and without the mask (crisp)", a1.equals(a2));
        ok("B footer (" + kind + "): the 28 px above the footer fade", !b1.equals(b2));
        await scrollTo(page, "end"); f = await fadeState(page);
        ok("B footer (" + kind + "): at the end of the list the bottom fade is gone", !f.bot && f.foot === "", f);
      }
      await footSheet("float"); f = await fadeState(page);
      ok("B a floating bar (.gpg-bar): no bottom fade (the bar owns the edge)", !f.bot && f.max > 100, f);
      await scrollTo(page, 200); f = await fadeState(page);
      ok("B a floating bar: the top fade still works", f.top && !f.bot, f);

      // the other sheets: the state always follows the scroll position (top / middle / end)
      const sheets = [["Inställningar", () => window.PN.showSettings("s")], ["Integritet", () => window.PN.showSettings("s", "synl")],
        ["Grupper", () => document.getElementById("btn-groups").click()], ["Min kväll", () => window.NIGHTLOG.open()]];
      for (const [name, fn] of sheets) {
        await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); }); await wait(page, 400);
        await page.evaluate(fn); await wait(page, name === "Integritet" ? 1900 : 1400);
        const rows = [];
        for (const pos of [0, "mid", "end"]) {
          const max = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return b.scrollHeight - b.clientHeight; });
          await scrollTo(page, pos === "mid" ? Math.round(max / 2) : pos);
          const s = await fadeState(page);
          const float = await page.evaluate(() => !![...document.querySelectorAll("#sheet-body .gpg-bar, #sheet-body .gg-sticky")].find((e) => e.offsetParent));
          rows.push({ pos, ...s, okTop: s.top === (s.st >= 2), okBot: float ? !s.bot : s.bot === (s.max - s.st >= 2), okMask: (s.top || s.bot) === /gradient/.test(s.mask) });
        }
        ok("B " + name + ": fade state follows the scroll at top / middle / end", rows.every((r) => r.okTop && r.okBot && r.okMask), rows);
      }
      // the bar sheet (a map popup): bottom edge only
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); }); await wait(page, 400);
      await page.evaluate(() => window.__map.setView([60.15124, 15.18797], 17, { animate: false })); await wait(page, 2500);
      await page.evaluate(() => { const p = document.querySelector(".leaflet-hotbars-pane .pill") || document.querySelector(".pill"); if (p) p.click(); }); await wait(page, 1800);
      const SEL = ".olnu-sheet .leaflet-popup-content";
      if (await page.evaluate((s) => !!document.querySelector(s), SEL)) {
        const rows = [];
        for (const pos of [0, "end"]) { await scrollTo(page, pos, SEL); const s = await fadeState(page, SEL); rows.push({ pos, ...s, good: !s.top && s.bot === (s.max - s.st >= 2) }); }
        ok("B bar sheet: bottom fade only while content goes on, never a top fade (sticky head)", rows.every((r) => r.good), rows);
      } else ok("B bar sheet opened", false);
      ok("B no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    /* ---------- C: Profil ---------- */
    // rank icons (pure): N ranks = N different SVGs; also for ranks that do not exist yet
    {
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { mer: 103 });
      const ic = await page.evaluate(() => {
        const R = window.RANKICO, n = R.count(), strip = (s) => s.replace(/ data-rk="\d+"/, ""), set = new Set(), set72 = new Set(), small = [], noEmoji = [];
        const box = document.createElement("div"); box.style.cssText = "position:fixed;left:0;top:0;z-index:99999"; document.body.appendChild(box);
        for (let i = 0; i < 72; i++) {
          const s = R.svg(i, 20); set72.add(strip(s)); if (i < n) set.add(strip(s));
          if (!/^<svg[^>]* class="rk-ico"/.test(s) || /<image|<img|href=/.test(s) || /[\u{1F000}-\u{1FAFF}☀-➿]/u.test(s)) noEmoji.push(i);
          if (i < n) { box.innerHTML = s; const e = box.firstChild, r = e.getBoundingClientRect(), bb = e.getBBox();
            if (r.width < 20 || r.height < 20 || bb.width < 6 || bb.height < 16 || bb.x < -0.5 || bb.y < -0.5 || bb.x + bb.width > 24.5 || bb.y + bb.height > 24.5) small.push([i, r.width, r.height, bb.x, bb.y, bb.width, bb.height].map((v) => Math.round(v * 10) / 10)); }
        }
        box.innerHTML = R.svg(11, 48); const r48 = box.firstChild.getBoundingClientRect(); const col = getComputedStyle(box.firstChild).color; box.remove();
        return { n, distinct: set.size, distinct72: set72.size, small, noEmoji, w48: r48.width, col, titles: window.SOCIAL.TITLES.length,
          amber: getComputedStyle(document.documentElement).getPropertyValue("--ds-amber").trim() };
      });
      ok("C rank icons: one per rank of the ladder (" + ic.n + " ranks = " + ic.distinct + " different SVGs)", ic.n === ic.titles && ic.n >= 42 && ic.distinct === ic.n, ic);
      ok("C rank icons: future ranks get their own too (72 indexes = 72 SVGs)", ic.distinct72 === 72, ic);
      ok("C rank icons: plain SVG marks (no emoji, no image), each fills the box at 20 px, 48 px works, amber", ic.noEmoji.length === 0 && ic.small.length === 0 && ic.w48 === 48 && /rgb\(245, 166, 35\)/.test(ic.col), ic);

      await profil(page);
      const p = await page.evaluate(() => {
        const body = document.getElementById("sheet-body"), kids = [...body.children].filter((e) => e.offsetParent);
        const cls = kids.map((e) => e.classList.contains("pf-tabs") ? "tabs" : e.classList.contains("pf-hero") ? "hero" : e.classList.contains("pn-vsm-w") ? "vsm" : e.classList.contains("pn-pf") ? "rest" : e.classList.contains("pn-fold-w") ? "fold" : e.className);
        const secs = [...body.querySelectorAll(".pn-pf > section")].filter((e) => e.offsetParent).map((e) => e.querySelector("h3").textContent);
        const hero = body.querySelector(".pf-hero"), rk = hero.querySelector(".pf-rank"), cta = hero.querySelector(".avw-cta"), vsm = body.querySelector(".pn-vsm");
        const r = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) }; };
        return { cls, text: body.innerText, name: !!hero.querySelector(".pf-name"), first: hero.firstElementChild.className,
          rank: rk && { title: rk.querySelector(".pf-rank-t").textContent, ico: rk.querySelector(".pf-rank-t svg.rk-ico") && rk.querySelector(".pf-rank-t svg.rk-ico").getAttribute("data-rk"),
            icoW: rk.querySelector("svg.rk-ico") && rk.querySelector("svg.rk-ico").getBoundingClientRect().width, bar: rk.querySelector(".pf-bar > span") && rk.querySelector(".pf-bar > span").style.width,
            n: rk.querySelector(".pf-rank-n") && rk.querySelector(".pf-rank-n").textContent, m: !!rk.querySelector(".pf-rank-m"), h: r(rk).h, aria: rk.getAttribute("aria-label") },
          cta: cta && { h: r(cta).h, small: !!(cta.querySelector("small") && cta.querySelector("small").offsetParent) },
          vsm: vsm && { head: vsm.querySelector("h3").textContent, rows: [...vsm.querySelectorAll(".ds-row")].map((b) => ({ c: b.className.replace(/ds-row|pn-row/g, "").trim(), t: b.querySelector(".ds-row-t > span").textContent,
            v: b.querySelector(".pn-row-v") ? b.querySelector(".pn-row-v").textContent : null, sw: b.getAttribute("role") === "switch" ? b.getAttribute("aria-checked") : null, h: r(b).h })) },
          secs, garderob: !body.querySelector(".pn-vsm .ul-row"), heroT: r(hero).t, heroB: r(hero).t + r(hero).h, vsmT: vsm ? r(vsm).t : 0, mittT: r(body.querySelector(".pn-pf > section:not(.pn-vsm)")).t,
          fav: body.querySelector(".bl-fav") ? { t: r(body.querySelector(".bl-fav")).t, b: r(body.querySelector(".bl-fav")).t + r(body.querySelector(".bl-fav")).h } : null };
      });
      ok("C Profil order: strip, identity card, \"Vem ser mig\" right after it, then the rest (Mitt, Hjälp …)", p.cls.join(",") === "tabs,hero,vsm,rest,fold" && p.secs[0] === "Mitt" && p.garderob &&
        // lane beerui (I-132, owner A24): "Mina favoritöl" sits between the identity card and "Vem ser mig" (inside the vsm wrapper)
        (p.fav ? p.heroB <= p.fav.t && p.fav.t - p.heroB <= 40 && p.fav.b <= p.vsmT && p.vsmT - p.fav.b <= 40 : p.heroB <= p.vsmT && p.vsmT - p.heroB <= 40) &&
        p.vsmT < p.mittT && p.name && /pf-top/.test(p.first), { cls: p.cls, secs: p.secs, heroB: p.heroB, vsmT: p.vsmT, mittT: p.mittT, fav: p.fav });
      ok("C no drink goal on Profil (no \"öl kvar\", no \"kvar till\")", !/öl kvar|kvar till|beers left/i.test(p.text), (/.{0,80}(öl kvar|kvar till|beers left).{0,40}/i.exec(p.text) || [])[0]);
      ok("C rank block: icon (≥ 20 px) + name, bar and text in MERITS: \"12 meriter till Premiärlöjtnant Pilsner\", bar 40 %",
        !!p.rank && p.rank.title === "Löjtnant Lager" && p.rank.ico === "11" && p.rank.icoW >= 20 && p.rank.bar === "40%" && p.rank.n === "12 meriter till Premiärlöjtnant Pilsner" && !p.rank.m && p.rank.h >= 44 && /12 meriter till/.test(p.rank.aria), p.rank);
      ok("C the character invite is one row (no long text)", !p.cta || (p.cta.h <= 64 && p.cta.h >= 44 && !p.cta.small), p.cta);
      ok("C \"Vem ser mig\": Synlighet (Alla), Spökläge (switch, off), Exakt plats (switch, on), Hemzon (Av); 44 px rows",
        !!p.vsm && p.vsm.head === "Vem ser mig" && p.vsm.rows.length === 4 && p.vsm.rows[0].t === "Synlighet" && p.vsm.rows[0].v === "Alla" && p.vsm.rows[1].t === "Spökläge" && p.vsm.rows[1].sw === "false" &&
        p.vsm.rows[2].t === "Exakt plats" && p.vsm.rows[2].sw === "true" && p.vsm.rows[3].t === "Hemzon" && p.vsm.rows[3].v === "Av" && p.vsm.rows.every((r) => r.h >= 44), p.vsm);

      // each privacy row reaches its real setting
      const g = await page.evaluate(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms)), q = (s) => document.querySelector("#sheet-body " + s), out = {};
        q(".pn-vsm-ghost").click(); await w(150);
        out.ghostOn = { ls: localStorage.getItem("olnu.ghostMode"), mode: window.PNVIS.mode(), sw: q(".pn-vsm-ghost").getAttribute("aria-checked"), knob: q(".pn-vsm-ghost .switch").getAttribute("aria-checked"), val: q(".pn-vsm-vis .pn-row-v").textContent };
        q(".pn-vsm-ghost").click(); await w(150);
        out.ghostOff = { ls: localStorage.getItem("olnu.ghostMode"), mode: window.PNVIS.mode(), sw: q(".pn-vsm-ghost").getAttribute("aria-checked"), val: q(".pn-vsm-vis .pn-row-v").textContent };
        q(".pn-vsm-exact").click(); await w(100);
        out.area = { prec: window.PN.s.prec, ls: localStorage.getItem("olnu.prec"), real: document.getElementById("prec-area").getAttribute("aria-checked"), sw: q(".pn-vsm-exact").getAttribute("aria-checked"), sub: q(".pn-vsm-exact small").textContent };
        q(".pn-vsm-exact").click(); await w(100);
        out.exact = { prec: window.PN.s.prec, ls: localStorage.getItem("olnu.prec"), real: document.getElementById("prec-exact").getAttribute("aria-checked"), sw: q(".pn-vsm-exact").getAttribute("aria-checked"), sub: q(".pn-vsm-exact small").textContent };
        return out;
      });
      ok("C Spökläge switch = the real ghost mode (PNVIS), and the Synlighet value follows", g.ghostOn.ls === "1" && g.ghostOn.mode === "spoke" && g.ghostOn.sw === "true" && g.ghostOn.knob === "true" && g.ghostOn.val === "Spöke" &&
        g.ghostOff.ls === "0" && g.ghostOff.mode === "alla" && g.ghostOff.sw === "false" && g.ghostOff.val === "Alla", g);
      ok("C Exakt plats switch = the app's own precision setting (PN.s.prec / olnu.prec)", g.area.prec === "area" && g.area.ls === "area" && g.area.real === "true" && g.area.sw === "false" &&
        g.exact.prec === "exact" && g.exact.ls === "exact" && g.exact.real === "true" && g.exact.sw === "true", g);
      // the sub line tells what the current state does (old code: always "Av: nya öl visar bara området", also while the switch was on)
      ok("C Exakt plats sub line follows the switch (on = exact place, off = only the area)", /bara området/.test(g.area.sub) && !/^Av:/.test(g.area.sub) && /exakta plats/.test(g.exact.sub), { area: g.area.sub, exact: g.exact.sub });
      await page.evaluate(() => document.querySelector("#sheet-body .pn-vsm-vis").click()); await wait(page, 1900);
      const v = await page.evaluate(() => { const pg = document.querySelector("#sheet-body .set-page:not([hidden])");
        return { title: document.getElementById("sheet-title").textContent, pg: pg && pg.getAttribute("data-pg"), ctl: !!(pg && pg.querySelector(".mn-vis-set")) }; });
      ok("C Synlighet row opens Inställningar › Integritet with the real \"Vem ser dig?\" control", v.title === "Integritet" && v.pg === "synl" && v.ctl, v);
      await profil(page);
      await page.evaluate(() => document.querySelector("#sheet-body .pn-vsm-home").click()); await wait(page, 1200);
      const hz = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, map: !!document.querySelector("#sheet-body .hz-map, #sheet-body [class*='hz-']") }));
      ok("C Hemzon row opens the Hemzon sheet", /hem/i.test(hz.title) && hz.title !== "Profil" && hz.map, hz);

      // the same rank on Profil and Min uniform (small fix 6), with merits
      await page.evaluate(() => window.MEDALS.showMine()); await wait(page, 1200);
      const u = await page.evaluate(() => { const b = document.getElementById("sheet-body"), ic = b.querySelector(".uni-ico svg.rk-ico"), bar = b.querySelector(".uni-box .rank-bar > span");
        return { rank: (b.querySelector(".uni-rank") || {}).textContent, ico: ic && ic.getAttribute("data-rk"), icoW: ic && ic.getBoundingClientRect().width, next: (b.querySelector(".uni-next") || {}).textContent,
          bar: bar && bar.style.width, text: b.textContent, chev: !!b.querySelector(".uni-chev") }; });
      ok("C Min uniform: the same rank name and icon as Profil, the icon at 48 px, progress in merits", u.rank === p.rank.title && u.ico === p.rank.ico && u.icoW === 48 && u.next === "12 meriter till Premiärlöjtnant Pilsner" && u.bar === "40%" && !u.chev && !/kvar till/.test(u.text), u);
      await page.evaluate(() => window.MERITER.explain()); await wait(page, 900);
      const mx = await page.evaluate(() => { const b = document.getElementById("sheet-body"), r = b.querySelector(".mer-me .mer-rank");
        return { rank: r && r.textContent, ico: r && r.querySelector("svg.rk-ico") && r.querySelector("svg.rk-ico").getAttribute("data-rk"), next: (b.querySelector(".mer-me .mer-next") || {}).textContent }; });
      ok("C Meriter sheet: the same rank, icon and wording", mx.rank === "Löjtnant Lager" && mx.ico === "11" && mx.next === "12 meriter till Premiärlöjtnant Pilsner", mx);
      ok("C no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    // the merit numbers in two more states + an old server without merits
    for (const st of [{ mer: 12, title: "Menig Mellanöl", ico: "2", bar: "80%", n: "1 merit till Vicekorpral Kapsyl" }, { mer: 2650, title: "Ölguden", ico: "41", bar: null, n: "Högsta grad." },
      { mer: null, title: "Löjtnant Lager", ico: "11", bar: null, n: null }]) {
      const { ctx, page } = await open(browser, { width: 390, height: 844 }, { mer: st.mer });
      await profil(page);
      const r = await page.evaluate(() => { const rk = document.querySelector("#sheet-body .pf-hero .pf-rank"), body = document.getElementById("sheet-body");
        return rk && { title: rk.querySelector(".pf-rank-t").textContent, ico: rk.querySelector("svg.rk-ico") && rk.querySelector("svg.rk-ico").getAttribute("data-rk"),
          bar: rk.querySelector(".pf-bar > span") ? rk.querySelector(".pf-bar > span").style.width : null, n: rk.querySelector(".pf-rank-n") ? rk.querySelector(".pf-rank-n").textContent : null,
          goal: /öl kvar|kvar till/i.test(body.innerText) }; });
      const name = st.mer == null ? "an old server without merits: the rank name + icon only (no bar, no drink goal)" : st.mer + " merits: \"" + st.n + "\"" + (st.bar ? ", bar " + st.bar : ", no bar");
      ok("C " + name, !!r && r.title === st.title && r.ico === st.ico && r.bar === st.bar && r.n === st.n && !r.goal, r);
      await page.evaluate(() => window.MEDALS.showMine()); await wait(page, 1200);
      const u = await page.evaluate(() => { const b = document.getElementById("sheet-body"), ic = b.querySelector(".uni-ico svg.rk-ico");
        return { rank: (b.querySelector(".uni-rank") || {}).textContent, ico: ic && ic.getAttribute("data-rk"), goal: /öl kvar|kvar till/i.test(b.innerText), next: (b.querySelector(".uni-next") || {}).textContent || null,
          bar: !!b.querySelector(".uni-box .rank-bar") }; });
      ok("C " + (st.mer == null ? "old server" : st.mer + " merits") + ": Min uniform shows the same rank name and icon as Profil, no drink goal", u.rank === st.title && u.ico === st.ico && !u.goal && u.next === st.n && u.bar === !!st.bar, u);
      await ctx.close();
    }

    /* ---------- small fixes 11 + 24 (Konto) ---------- */
    {
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 });
      await setPage(page, "konto");
      const k = await page.evaluate(() => { const pg = document.querySelector('#sheet-body .set-page[data-pg="konto"]'), row = pg.querySelector(".set-swish-row"), old = pg.querySelector(".rnd-swrow .btn");
        const other = pg.querySelector(".set-flytt-in"), r = (e) => e && e.getBoundingClientRect();
        return { row: !!row && row.classList.contains("ds-row") && !!row.offsetParent, t: row && row.querySelector(".ds-row-t > span").textContent, sub: row && (row.querySelector(".ds-row-t > small") || {}).textContent,
          icon: !!(row && row.querySelector(".ds-row-i svg")), chev: !!(row && row.querySelector(".ds-chev")), oldShown: !!(old && old.offsetParent), h: row && Math.round(r(row).height), hOther: other && Math.round(r(other).height),
          x: row && Math.round(r(row.querySelector(".ds-row-t")).left), xOther: other && Math.round(r(other.querySelector(".ds-row-t")).left), emoji: row && /[\u{1F000}-\u{1FAFF}]/u.test(row.textContent) }; });
      ok("C11 Konto: Swish is a normal row (icon, title, sub line, chevron; same height and text column as the other rows), the wide button is gone",
        k.row && /Swish/.test(k.t) && !!k.sub && k.icon && k.chev && !k.oldShown && k.h >= 56 && Math.abs(k.h - k.hOther) <= 1 && k.x === k.xOther && !k.emoji, k);
      await page.evaluate(() => document.querySelector("#sheet-body .set-swish-row").click()); await wait(page, 900);
      const sw = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, inp: !!document.querySelector("#sheet-body .rnd-swinp") }));
      ok("C11 the Swish row opens the Swish number sheet", sw.inp, sw);
      await setPage(page, "konto");
      await page.evaluate(() => document.querySelector("#sheet-body .set-del").click());
      await page.waitForSelector("#sheet-body .mm-del-go", { timeout: 6000 }).catch(() => {}); await wait(page, 400);
      const d = await page.evaluate(() => { const c = document.querySelector("#sheet-body .pn-del-cancel"), go = document.querySelector("#sheet-body .mm-del-go"), cs = c && getComputedStyle(c), gs = go && getComputedStyle(go);
        return { cancel: !!c && !!c.offsetParent, t: c && c.textContent, ghost: !!c && c.classList.contains("btn-ghost"), h: c && Math.round(c.getBoundingClientRect().height), after: !!c && go.nextElementSibling === c,
          n: document.querySelectorAll("#sheet-body .pn-del-cancel").length, bg: cs && cs.color, goBg: gs && gs.color, title: document.getElementById("sheet-title").textContent }; });
      ok("C24 Radera kontot: a ghost \"Avbryt\" under the red button (one, 44 px, not red)", d.cancel && d.t === "Avbryt" && d.ghost && d.h >= 44 && d.after && d.n === 1 && d.bg !== d.goBg, d);
      await page.evaluate(() => document.querySelector("#sheet-body .mm-del-go").click()); await wait(page, 300);
      await page.evaluate(() => { const no = document.querySelector("#sheet-body .mm-del-no"); if (no) no.click(); }); await wait(page, 400);
      const d2 = await page.evaluate(() => document.querySelectorAll("#sheet-body .pn-del-cancel").length);
      ok("C24 the \"Avbryt\" is back (once) when the sheet draws its first step again", d2 === 1, d2);
      await page.evaluate(() => document.querySelector("#sheet-body .pn-del-cancel").click()); await wait(page, 1900);
      const d3 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, del: !!document.querySelector("#sheet-body .mm-del"), open: !document.getElementById("sheet").hidden }));
      ok("C24 \"Avbryt\" leaves the delete sheet (one step back, nothing deleted)", !d3.del && d3.title !== "Radera kontot", d3);
      ok("C11/24 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL crashed", e.stack || e.message); }
  await browser.close();
  console.log("\ndprofile: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
