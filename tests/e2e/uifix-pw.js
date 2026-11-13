// lane uifix (13 Nov, final check on the release candidate). Each item FAILS on the old code (f5d22f3) and PASSES on the new.
//  F  the 1st ÖL!: in the 60 s after a beer only the beer toast + the "Vilken sort?" strip show. "Ny grad!" + "Befordrad!" = ONE card
//     (the hometown ask is a row in it), medal toasts wait for the next calm moment, the "Hjälp till?" consent sheet waits for a calm
//     moment (not in the 60 s, not while the strip is up) and still comes once. Real time, 390 px (the timing does not depend on the width).
//  I  settings rows "Logga ut", "Röst som säger skål", "Vibration", "Systembolaget på kartan", "Notiser om vänner och kaos" have a PNI
//     icon; "Önska en feature" has its icon in the icon column: icon + text start at the same x as the normal rows of the page (360/390/430)
//  O  Om appen: the about text has the ds row padding inside its card and the PNI lock (no 🔒 emoji) (360/390/430)
//  U  the ÅNGRA chip: PNI undo icon (no ↩️ emoji) and a solid ds background (Annat does not show through) (360/390/430)
// Mocked Supabase (ds-helpers). usage: node uifix-pw.js <port> [only-regex, e.g. "I|O"]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: SP + "logs/uifix-" + name + ".png" }).catch(() => {});
const rgb = (h) => { const n = parseInt(h.replace("#", ""), 16); return "rgb(" + (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ")"; };

async function settingsPage(page, key) {
  await page.evaluate(() => { const c = document.getElementById("sheet-close"), s = document.getElementById("sheet"); if (c && s && !s.hidden) c.click(); });
  await wait(page, 500);
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
  await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 2200);
  await page.evaluate((k) => { const b = document.querySelector(".set-r-" + k); b && b.click(); }, key); await wait(page, 900);
}
// icon x + text x of the visible row whose label starts with re (relative to the page card)
function rowGeo(page, key, re) {
  return page.evaluate(([k, src]) => {
    const pg = document.querySelector('.set-page[data-pg="' + k + '"]'); if (!pg) return { err: "no page" };
    const rx = new RegExp(src), card = pg.querySelector(".ds-list").getBoundingClientRect();
    const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
    const w = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (!rx.test(n.textContent.trim()) || !vis(n.parentElement)) continue;
      const row = n.parentElement.closest(".ds-row, .toggle-row, .btn, .ds-item"); if (!row) continue;
      const r = document.createRange(); r.selectNodeContents(n); const t = r.getBoundingClientRect();
      const svg = row.querySelector("svg"); const s = svg && svg.getBoundingClientRect();
      return { text: n.textContent.trim().slice(0, 30), pni: !!(svg && /\bpi\b/.test(svg.getAttribute("class") || "")), ix: s ? Math.round(s.left - card.left) : null,
        iw: s ? Math.round(s.width) : 0, tx: Math.round(t.left - card.left) };
    }
    return { err: "no row " + src };
  }, [key, re.source]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ================= F: the first ÖL! is calm for 60 s ================= */
    if (ONLY.test("F")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 });
      await ctx.addInitScript(() => {
        if (sessionStorage.getItem("uif")) return; sessionStorage.setItem("uif", "1");
        localStorage.setItem("olnu.logMode", "optin"); localStorage.removeItem("olnu.logCons"); localStorage.removeItem("olnu.logEv");   // the real app: ask before diagnostics
        localStorage.removeItem("olnu.homeTown"); localStorage.removeItem("olnu.homeAsked");
      });
      await page.route(/rest\/v1\/rpc\/pnlog_ingest\b/, (r) => J(r, { ok: true, mode: "optin" }));
      await page.route(/rest\/v1\/rpc\/my_home_town\b/, (r) => J(r, { v: 1, town: null }));
      let medalsLeft = 0;   // like the real server: the medals are "new" in ONE award answer (the one after the beer)
      await page.route(/rest\/v1\/rpc\/award_medals\b/, (r) => J(r, medalsLeft-- > 0 ? [{ medal: "m1", count: 1, is_new: true, earned_at: new Date().toISOString() }, { medal: "pluton", count: 1, is_new: true, earned_at: new Date().toISOString() }] : []));
      await H.boot(page);
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
      await wait(page, 800);
      // what the app does on an accepted 1st beer (app-beer beerDone → mods onBeerAccepted) + the poll's promotion (social.js promoted())
      medalsLeft = 1;
      await page.evaluate(() => {
        const n = JSON.parse(localStorage.getItem("olnu.night") || "{}"); n.count = 1; localStorage.setItem("olnu.night", JSON.stringify(n));
        window.__seen = {}; window.__toasts = []; const t0 = Date.now(); window.__t0 = t0;
        window.__spy = setInterval(() => {
          const s = window.__seen, at = Date.now() - t0, put = (k) => { if (s[k] == null) s[k] = at; };
          document.querySelectorAll("#toasts .toast").forEach((t) => {
            const x = t.textContent; if (window.__toasts.indexOf(x) < 0) window.__toasts.push(x);
            if (/UXBEER/.test(x)) put("beer-toast"); else if (/medalj/i.test(x) || t.classList.contains("medal-toast")) put("medal-toast");
            else if (/Ny grad|baserad|hemstad/i.test(x)) put("hometown-toast");
          });
          const st = document.querySelector(".bp-strip"); if (st && !st.hidden) put("strip");
          if (document.querySelector(".mx-pop")) put("befordrad");
          if (document.querySelector(".pnlog-yes")) put("consent-sheet");
          const sh = document.getElementById("sheet"); if (sh && !sh.hidden && !document.querySelector(".pnlog-yes")) put("other-sheet");
        }, 100);
        // the app's own 20 s ask timer, faster (the old code has no hook: its own timer runs)
        window.__askT = setInterval(() => { try { window.PNLOG._askOnce && window.PNLOG._askOnce(); } catch (e) {} }, 2000);
        window.PN.toast("UXBEER Uppdrag startat. Skål!", { ms: 5000 });
        window.PN.mods("onBeerAccepted", { beer_count: 1, lat: 60.15, lng: 15.1868, accepted: true }, { precise: true, ghost: false, total: 1 });
        try { window.HOMETOWN.afterLevelUp(); } catch (e) {}
        window.MEDALS.levelUp("Rekryt Lättöl", "Värnpliktig Veteöl", 8);
      });
      await wait(page, 8000);
      const up = await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !!s && !s.hidden; });
      await page.keyboard.press("Escape");   // the user picks / closes "Vilken sort?"
      await wait(page, 53500);
      await shot(page, "F-58s");
      const s60 = await page.evaluate(() => Object.assign({}, window.__seen));
      const in60 = Object.keys(s60).filter((k) => s60[k] < 60000);
      ok("F 'Vilken sort?' strip came with the beer", up && s60.strip != null, s60);
      ok("F in the 60 s after the 1st ÖL!: only the beer toast + the strip (no medal toast, no 'Ny grad!', no 'Befordrad!', no 'Hjälp till?')",
        in60.length <= 2 && in60.every((k) => k === "beer-toast" || k === "strip"), { s60, toasts: await page.evaluate(() => window.__toasts) });
      // after the window: the medal toasts, then ONE promotion card with the hometown row; then the consent sheet
      let after = {};
      for (let i = 0; i < 30; i++) {
        await wait(page, 1000);
        after = await page.evaluate(() => Object.assign({}, window.__seen));
        if (after.befordrad != null) break;
      }
      await wait(page, 500);
      const card = await page.evaluate(() => { const p = document.querySelector(".mx-pop"); return p ? { ht: !!p.querySelector(".mx-ht .mx-ht-b"), pin: !!p.querySelector(".mx-ht svg.pi"), txt: p.textContent.replace(/\s+/g, " ").slice(0, 200) } : null; });
      await shot(page, "F-card");
      ok("F after the calm window the medal toasts come (queued, not lost), before the card", after["medal-toast"] != null && after["medal-toast"] <= after.befordrad, after);
      ok("F 'Ny grad!' + 'Befordrad!' = ONE card: the hometown ask is a row in it, never its own toast", card && card.ht && card.pin && after["hometown-toast"] == null, { card, after });
      ok("F the consent sheet did not come before / with the medal toasts and the card", after["consent-sheet"] == null, after);
      // strip up (a 2nd beer type pick, no new beer in medals) → no consent sheet; strip gone + calm → the sheet comes
      await page.evaluate(() => { clearInterval(window.__askT); window.BARSPLUS.onBeerAccepted({ beer_count: 2 }); const b = document.querySelector(".mx-pop .btn-amber"); b && b.click(); });
      await wait(page, 1800);
      const stripUp = await page.evaluate(() => { const s = document.querySelector(".bp-strip"); return !!s && !s.hidden; });
      for (let i = 0; i < 3; i++) { await page.evaluate(() => { try { window.PNLOG._askOnce && window.PNLOG._askOnce(); } catch (e) {} }); await wait(page, 1500); }
      const dur = await page.evaluate(() => !!document.querySelector(".pnlog-yes"));
      await page.evaluate(() => { window.__askT = setInterval(() => { try { window.PNLOG._askOnce && window.PNLOG._askOnce(); } catch (e) {} }, 2000); });
      ok("F no 'Hjälp till?' while the 'Vilken sort?' strip is up", stripUp && !dur, { stripUp, dur });
      await page.keyboard.press("Escape");
      let got = false;
      for (let i = 0; i < 25 && !got; i++) { await wait(page, 1000); got = await page.evaluate(() => !!document.querySelector(".pnlog-yes")); }
      await shot(page, "F-consent");
      ok("F 'Hjälp till?' comes in a calm moment after the window", got);
      await page.evaluate(() => { const b = document.querySelector(".pnlog-no"); b && b.click(); }); await wait(page, 900);
      const cons = await page.evaluate(() => localStorage.getItem("olnu.logCons"));
      await wait(page, 4500);
      const again = await page.evaluate(() => !!document.querySelector(".pnlog-yes"));
      ok("F 'Hjälp till?' shows once ('Nej tack' = logCons 0, no 2nd ask)", cons === "0" && !again, { cons, again });
      await page.evaluate(() => { clearInterval(window.__spy); clearInterval(window.__askT); });
      await ctx.close();
    }

    /* ================= I: settings rows have a PNI icon in the icon column ================= */
    if (ONLY.test("I")) {
      for (const w of W3) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await H.boot(page);
        const CASES = [
          ["konto", /^Logga ut$/, /^Jag har en flyttkod$/],
          ["notis", /^Röst som säger skål$/, /^Ljud när du tar en öl$/],
          ["notis", /^Vibration$/, /^Ljud när du tar en öl$/],
          ["notis", /^Notiser om vänner och kaos$/, /^Ljud när du tar en öl$/],
          ["karta", /^Systembolaget på kartan$/, /^Visa restauranger$/],
          ["hjalp", /^Önska en feature$/, /^Något knas\?$/],
        ];
        let open = "";
        for (const [pg, re, ref] of CASES) {
          if (open !== pg) { await settingsPage(page, pg); open = pg; await shot(page, "I-" + pg + "-" + w); }
          const a = await rowGeo(page, pg, re), b = await rowGeo(page, pg, ref);
          ok("I " + w + ": '" + re.source.replace(/[\^$\\]/g, "") + "' has a PNI icon; icon + text in the columns of '" + ref.source.replace(/[\^$\\]/g, "") + "'",
            !a.err && !b.err && a.pni && a.iw >= 16 && Math.abs(a.ix - b.ix) <= 3 && Math.abs(a.tx - b.tx) <= 3, { a, b });
        }
        await ctx.close();
      }
    }

    /* ================= O: Om appen about text in a padded card, PNI lock ================= */
    if (ONLY.test("O")) {
      for (const w of W3) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await H.boot(page);
        await settingsPage(page, "om");
        const st = await page.evaluate(() => {
          const pg = document.querySelector('.set-page[data-pg="om"]');
          const p = [...pg.querySelectorAll("p, div")].find((e) => /^Kontot är anonymt/.test(e.textContent.trim()) && e.children.length <= 2 && !e.querySelector("p"));
          if (!p) return { err: "no about text" };
          p.scrollIntoView({ block: "center" });
          const list = pg.querySelector(".ds-list").getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(p);
          const rs = [...r.getClientRects()].filter((x) => x.width > 0), L = Math.min(...rs.map((x) => x.left)), R = Math.max(...rs.map((x) => x.right));
          let c = p, bg = "";   // the card = the nearest box with a solid background
          while (c && c !== document.body) { const b = getComputedStyle(c).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } c = c.parentElement; }
          const cr = c.getBoundingClientRect(), pr = p.getBoundingClientRect();
          return { emoji: /🔒/.test(p.textContent), lock: !!p.querySelector("svg.pi-lock"), l: Math.round(L - list.left), r: Math.round(list.right - R),
            top: Math.round(rs[0].top - Math.max(cr.top, pr.top)) >= 0 ? Math.round(rs[0].top - pr.top) : -1, bg, card: c.className, sw: document.documentElement.scrollWidth, vw: innerWidth };
        });
        await wait(page, 300); await shot(page, "O-om-" + w);
        ok("O " + w + ": about text uses the PNI lock, no 🔒 emoji", !st.err && st.lock && !st.emoji, st);
        ok("O " + w + ": about text has the ds row padding inside the card (>= 12 px left, right, top), no page scroll", !st.err && st.l >= 12 && st.r >= 12 && st.top >= 8 && st.bg && st.sw <= st.vw, st);
        await ctx.close();
      }
    }

    /* ================= U: the ÅNGRA chip ================= */
    if (ONLY.test("U")) {
      for (const w of W3) {
        const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
        await page.route(/rest\/v1\/rpc\/(post_beer_v2|post_beer)$/, (r) => J(r, { accepted: true, wait_seconds: 0, id: 77, beer_count: 4, is_new: false,
          expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), undo_until: new Date(Date.now() + 120e3).toISOString(), milestone: null, hidden: false, lat: 60.15, lng: 15.18, precise: true }));
        await H.boot(page);
        await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
        await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1800);
        const u = await page.evaluate(() => {
          const f = document.querySelector(".undo-fab"), o = document.getElementById("btn-other"); if (!f) return { err: "no chip" };
          const cs = getComputedStyle(f), a = f.getBoundingClientRect(), b = o ? o.getBoundingClientRect() : a;
          const tok = getComputedStyle(document.documentElement).getPropertyValue("--ds-raised").trim();
          const pts = [[.5, .5], [.5, .8], [.3, .7], [.7, .7]].map(([x, y]) => { const e = document.elementFromPoint(b.left + b.width * x, b.top + b.height * y); return !!(e && f.contains(e)); });
          return { svg: !!f.querySelector("svg.pi-undo"), txt: f.textContent.trim(), bg: cs.backgroundColor, tok, cover: pts };
        });
        await shot(page, "U-undo-" + w);
        ok("U " + w + ": ÅNGRA chip shows the PNI undo icon, no ↩️ emoji", !u.err && u.svg && !/[↩⏳]/.test(u.txt), u);
        ok("U " + w + ": ÅNGRA chip background is solid (the --ds-raised token) and covers Annat", !u.err && u.tok && u.bg === rgb(u.tok) && u.cover.every(Boolean), u);
        await ctx.close();
      }
    }
  } catch (e) { console.log("ERROR", e && e.stack); fail++; }
  await browser.close();
  console.log(`uifix: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
