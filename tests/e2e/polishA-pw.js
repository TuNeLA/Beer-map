// lane polishA (13 Nov, release polish; blind test REPORT.md + AUDIT-NAV.md move 4). Each check FAILS on the old code
// (big-update c59fc83) and PASSES on the new. At 360 / 390 / 430:
//  R  P2-2 the words "Synlig / Event / Mer" under the round map buttons are part of the button: a tap on the word (or in the
//     gap between button and word) is a tap on the button; one 44 px wide column, the button stays 44 × 44 (no layout shift)
//  G  move 4 (owner I-17): "Följ mig hem", "Hämta mig", "Jag kör ikväll" are not in the GROUP's Ikväll (+) view any more; they
//     are in the personal menu (top-left Ikväll chip) = 2 taps from the map, and a row there opens its sheet
//  P  P2-4 the push "blocked" help text wraps and is shown whole, with our lock icon (PNI) and no 🔒 emoji
//  D  the privacy text says "Inställningar → Konto → Radera mitt konto", and that path is real (Inställningar → Konto has the row)
// Mocked Supabase (ds-helpers). usage: node polishA-pw.js <port> [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const ONLY = new RegExp(process.argv[3] || ".");
const { wait, clickJS } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: SP + "logs/polishA-" + name + ".png" }).catch(() => {});
const closeAll = (page) => page.evaluate(() => {
  const s = document.getElementById("sheet"), c = document.getElementById("sheet-close"); if (s && !s.hidden && c) c.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.querySelectorAll("#toasts .toast").forEach((t) => t.remove());
});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    for (const w of W3) {
      const P = "[" + w + "]";
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] });
      // a new user's first night (rail words on) + push blocked by the browser (help text shows)
      await ctx.addInitScript(() => {
        try { if (!sessionStorage.getItem("pa-rn")) { sessionStorage.setItem("pa-rn", "1"); localStorage.setItem("olnu.railNights", "[]"); } } catch (e) {}
        try { Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" }); } catch (e) {}
      });
      await H.boot(page);
      await closeAll(page); await wait(page, 500);

      /* ================= R: rail words are tappable ================= */
      if (ONLY.test("R")) {
        const ids = ["pn-ghost", "pn-evs", "btn-more"];
        const g = await page.evaluate((ids) => {
          const rr = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
          const hitIs = (x, y, id) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest && e.closest("#" + id)); };
          return { on: document.body.classList.contains("mn-rail-lbl"), out: ids.map((id) => {
            const b = document.getElementById(id), l = b && b.querySelector(".mn-rail-l"), br = rr(b), lr = rr(l);
            if (!br || !lr) return { id, br, lr };
            const cy = (lr.t + lr.b) / 2;
            return { id, w: br.w, h: br.h, word: l.textContent,
              mid: hitIs((lr.l + lr.r) / 2, cy, id),                    // the word itself
              gap: hitIs((br.l + br.r) / 2, br.b + 1, id),              // between the button and the word
              left: hitIs(br.l + 2, cy, id), right: hitIs(br.r - 2, cy, id) };   // 44 px wide at the word's line
          }) };
        }, ids);
        ok(P + " R rail words are on (first night)", g.on && g.out.map((x) => x.word).join(",") === "Synlig,Event,Mer", g);
        ok(P + " R P2-2 a tap on each word hits its button", g.out.every((x) => x.mid), g.out);
        ok(P + " R P2-2 no dead gap between button and word, and the word line is 44 px wide", g.out.every((x) => x.gap && x.left && x.right), g.out);
        ok(P + " R buttons stay 44 × 44 (no layout shift)", g.out.every((x) => Math.round(x.w) === 44 && Math.round(x.h) === 44), g.out.map((x) => [x.w, x.h]));
        // real taps on the words
        const tapWord = async (id) => { const c = await page.evaluate((id) => { const l = document.querySelector("#" + id + " .mn-rail-l"); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id); if (c) await page.touchscreen.tap(c.x, c.y); return !!c; };
        await tapWord("btn-more"); await wait(page, 900);
        const mer = await page.evaluate(() => { const s = document.getElementById("sheet"); return !!(s && !s.hidden && /Mer på kartan/.test((document.getElementById("sheet-title") || s).textContent)); });
        ok(P + " R tap on 'Mer' opens 'Mer på kartan'", mer);
        await closeAll(page); await wait(page, 700);
        await tapWord("pn-ghost"); await wait(page, 700);
        ok(P + " R tap on 'Synlig' opens the Synlighet menu", await page.evaluate(() => !!document.getElementById("pn-vis")));
        await closeAll(page); await wait(page, 500);
        if (w === 390) await shot(page, "R-rail-390");
      }

      /* ================= G: personal actions only in the personal menu ================= */
      if (ONLY.test("G")) {
        await closeAll(page); await wait(page, 500);
        // tap 1: the top-left Ikväll chip
        await clickJS(page, "#pn-ikv2"); await wait(page, 600);
        const m = await page.evaluate(() => {
          const menu = document.getElementById("pn-ikm"); if (!menu) return null;
          return [...menu.querySelectorAll(".pn-ikm-row")].map((b) => ({ t: (b.querySelector("b") || b).textContent.trim(), h: Math.round(b.getBoundingClientRect().height) }));
        });
        const names = ["Jag kör ikväll", "Följ mig hem", "Hämta mig"];
        ok(P + " G the personal menu (Ikväll chip) has Jag kör ikväll + Följ mig hem + Hämta mig", !!m && names.every((n) => m.some((r) => r.t === n)), m);
        ok(P + " G those rows are ≥ 44 px", !!m && m.filter((r) => names.includes(r.t)).every((r) => r.h >= 44), m);
        if (w === 390) await shot(page, "G-menu-390");
        // tap 2: Hämta mig opens its sheet
        await page.evaluate(() => { const b = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].find((x) => /Hämta mig/.test(x.textContent)); if (b) b.click(); }); await wait(page, 1200);
        ok(P + " G tap 2: 'Hämta mig' opens the Hämta mig sheet", await page.evaluate(() => { const s = document.getElementById("sheet"); return !!(s && !s.hidden && /Hämta mig/.test((document.getElementById("sheet-title") || s).textContent)); }));
        await closeAll(page); await wait(page, 700);
        // the group page: Ikväll (+) has no personal rows
        await clickJS(page, "#btn-groups"); await wait(page, 1200);
        await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
        await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)) || document.querySelector(".glist .gcard"); if (c) c.click(); });
        await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {}); await wait(page, 1800);
        await clickJS(page, ".gpg-plus"); await wait(page, 900);
        const plus = await page.evaluate(() => {
          const wr = document.querySelector('#sheet .gpg[data-gv="plus"]'); if (!wr) return null;
          const vis = [...wr.children].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none");
          return { tiles: vis.map((e) => (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30)), ga: [...wr.querySelectorAll("[data-ga]")].map((e) => e.getAttribute("data-ga")) };
        });
        ok(P + " G the group Ikväll (+) view opened", !!plus && plus.tiles.length >= 3, plus);
        ok(P + " G move 4: no Följ mig hem / Hämta mig / Jag kör ikväll in the group Ikväll (+)", !!plus && !plus.tiles.some((t) => /Följ mig hem|Hämta mig|Jag kör ikväll/.test(t)) && !plus.ga.some((x) => /^(hf-ga|pk-ga|pk-drv)$/.test(x)), plus);
        if (w === 390) await shot(page, "G-plus-390");
        await closeAll(page); await wait(page, 700);
      }

      /* ================= P: push help text ================= */
      if (ONLY.test("P")) {
        await closeAll(page); await wait(page, 400);
        await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
        await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 1500);
        await page.evaluate(() => { const b = document.querySelector(".set-r-notis"); b && b.click(); }); await wait(page, 1800);
        const st = await page.evaluate(() => {
          const info = [...document.querySelectorAll("#sheet-body .info")].find((e) => /blockerade/.test(e.textContent) && e.getClientRects().length); if (!info) return null;
          const cs = getComputedStyle(info), lh = parseFloat(cs.lineHeight) || 20, r = info.getBoundingClientRect(), ic = info.querySelector("svg.pi-lock"), ir = ic && ic.getBoundingClientRect();
          return { sh: info.scrollHeight, ch: info.clientHeight, lines: Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh), ws: cs.whiteSpace, clamp: cs.webkitLineClamp,
            txt: info.textContent, emoji: /🔒/.test(info.textContent), icon: !!ic, icW: ir ? Math.round(ir.width) : 0, inside: r.right <= innerWidth && r.left >= 0 };
        });
        if (w === 360) await shot(page, "P-notis-360");
        ok(P + " P the push help text is there (push blocked)", !!st, st);
        ok(P + " P P2-4 it is shown whole: wraps (≥ 2 lines, no clamp), nothing hidden, inside the screen", !!st && st.sh <= st.ch + 1 && st.lines >= 2 && st.ws !== "nowrap" && (st.clamp === "none" || st.clamp === "") && st.inside && /Behörigheter → Notiser\.$/.test(st.txt.trim()), st);
        ok(P + " P the lock is our PNI icon (16 px), not the 🔒 emoji", !!st && !st.emoji && st.icon && st.icW === 16 && /låset/.test(st.txt), st);
        await closeAll(page); await wait(page, 600);
      }

      /* ================= D: privacy text delete path ================= */
      if (ONLY.test("D")) {
        await closeAll(page); await wait(page, 400);
        await page.evaluate(() => window.PRIVACY.showPrivacy()); await wait(page, 1200);
        const pv = await page.evaluate(() => { const p = [...document.querySelectorAll("#sheet-body p")].find((x) => /Radera mitt konto/.test(x.textContent)); return p ? p.textContent : ""; });
        ok(P + " D the privacy text says 'Inställningar → Konto → Radera mitt konto'", /^Inställningar → Konto → Radera mitt konto/.test(pv) && !/🗑️/.test(pv), pv.slice(0, 80));
        await closeAll(page); await wait(page, 600);
        // follow the path: Inställningar → Konto → Radera mitt konto
        await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
        await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 1200);
        const hub = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .ds-row-t > span:first-child")].filter((e) => e.getClientRects().length).map((e) => e.textContent));
        ok(P + " D the hub has a row 'Konto'", hub.includes("Konto"), hub);
        await page.evaluate(() => { const b = document.querySelector(".set-r-konto"); b && b.click(); }); await wait(page, 1500);
        ok(P + " D Konto has 'Radera mitt konto'", await page.evaluate(() => [...document.querySelectorAll("#sheet-body button, #sheet-body [role=button]")].some((x) => /Radera mitt konto/.test(x.textContent) && x.getClientRects().length)));
        await closeAll(page); await wait(page, 400);
      }
      await ctx.close();
    }
  } catch (e) { console.log("ERROR", e && e.stack); fail++; }
  await browser.close();
  console.log(`polishA: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
