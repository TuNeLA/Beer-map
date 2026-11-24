// uifix4-pw.js — lane uifix4 (19 Nov 2026). Each check FAILS on the old code (big-update 9b1fe98) and PASSES on the new code.
//   A18  rank icons 1-6: the bottle cap is drawn from the side (wide top + crimps), not a round sun (owner default yes)
//   D2   the count burst is shorter (number in 300 ms, fly starts <= 700 ms, one ring) and "ikväll" is a solid chip (sentence
//        case) under the number, so it never mixes with the map's pin labels
//   B9   person pins / people clusters / DOM bar pills / restaurant dots: an invisible 44 px hit area (the look is the same)
//   I-95 my departure chip says "På väg till O'Learys" (a PLACE, owner's case) and a tap opens the card with my På väg box
//   B5   the first open shows the pitch first (PintsNow + what it is + Fortsätt), then the install guide; the intro does not
//        repeat the 3 lines
//   H2   design review small fixes: 2 KAOS red waits for its own line, 10 Systembolaget row aligned, 19 Förfest contrast,
//        20 bar card buttons 44 px, 23 no emoji in Hämta mig body text, 25 intro small print 14 px, 26 offline chip says Offline
// Mocked Supabase (ds-helpers). usage: node uifix4-pw.js <port> [part,part…]   parts: a18,d2,b9,i95,b5,h2 (default all)
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const PARTS = (process.argv[3] || "a18,d2,b9,i95,b5,h2").split(",");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 500))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
// WCAG contrast of white on "rgb(r, g, b)"
const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const onWhite = (c) => 1.05 / (lum(c) + 0.05);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  const open = async (o) => { const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o || {}); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); return { ctx, page, errs }; };

  /* ---------- A18 + D2 + H2 (one booted page) ---------- */
  if (PARTS.some((p) => ["a18", "d2", "h2"].includes(p))) {
    const { ctx, page, errs } = await open();
    await H.boot(page);
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    if (PARTS.includes("a18")) {
      const a = await page.evaluate(() => {
        const box = document.createElement("div"); box.style.cssText = "position:fixed;left:0;top:0;z-index:99999"; document.body.appendChild(box);
        const out = [];
        for (const i of [0, 3, 5]) {   // ranks 1, 4, 6: the cap crest + chevrons / stars
          box.innerHTML = window.RANKICO.svg(i, 20); const s = box.firstChild;
          let x0 = 99, y0 = 99, x1 = -1, y1 = -1;   // the crest = every shape that starts in the top half
          [...s.children].forEach((e) => { const b = e.getBBox(); if (b.y < 11) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); } });
          out.push({ i, w: Math.round((x1 - x0) * 10) / 10, h: Math.round((y1 - y0) * 10) / 10, shapes: s.children.length });
        }
        box.remove(); return out;
      });
      // old cap: a round disc 11.2 x 11.2 (ratio 1.0, like a sun); new: a wide top + crimps 14.3 x 10.6 (ratio 1.35)
      ok(a.every((x) => x.w / x.h >= 1.25 && x.h >= 8), "A18 rank 1-6: the bottle cap is drawn from the side (wider than high), not as a round sun", a);
    }
    if (PARTS.includes("d2")) {
      const d = await page.evaluate(() => {
        // record the burst's own timers (no clock): the hold before the fly and the fly time
        const st = window.setTimeout, delays = [];
        window.setTimeout = function (f, ms) { delays.push(ms | 0); return 0; };
        try { window.MYCOUNT.set(3); window.MYCOUNT.onBeerAccepted({}, { total: 4 }); } finally { window.setTimeout = st; }
        const h = document.querySelector(".pm-burst"); if (!h) return { host: false };
        const nw = h.querySelector(".pm-new"), sub = h.querySelector(".pm-sub"), cs = getComputedStyle(sub);
        const slam = nw.getAnimations()[0], kf = slam.effect.getKeyframes();
        const out = { host: true, delays, slam: slam.effect.getTiming().duration, from: kf[0].transform, rings: h.querySelectorAll(".pm-ring").length,
          subBg: cs.backgroundColor, subTT: cs.textTransform, subText: sub.textContent, subLS: cs.letterSpacing };
        h.remove(); window.MYCOUNT.set(4); return out;
      });
      const hold = d.host ? Math.max(...d.delays.filter((x) => x < 2000)) : 9999;   // 3000 = "never stuck", 2800 = the season tap effect
      ok(d.host && hold <= 700 && d.slam <= 300, "D2 burst: the number comes in 300 ms and flies to the rail after <= 700 ms (was 450 ms / 820 ms)", { hold, slam: d.slam, delays: d.delays });
      ok(d.host && d.rings === 1 && !/scale\(2\.2\)/.test(d.from || ""), "D2 burst: one ring, no 2.2x slam (motion audit 6)", { rings: d.rings, from: d.from });
      const a = d.host ? (/rgba?\(([^)]+)\)/.exec(d.subBg) || [, "0,0,0,0"])[1].split(",").map(Number) : [0, 0, 0, 0];
      ok(d.host && (a.length === 3 || a[3] >= 0.9) && d.subTT === "none" && d.subText === "ikväll", "D2 'ikväll' is a solid chip (not loose text over pin labels), sentence case", { bg: d.subBg, tt: d.subTT, t: d.subText });
    }
    if (PARTS.includes("h2")) {
      // 2: KAOS red waits for its own line (html.pn-settle hides the line)
      const k = await page.evaluate(() => {
        const t = document.querySelector(".ticker"), had = t.classList.contains("pn-kaos"), H0 = document.documentElement.classList.contains("pn-settle");
        t.classList.add("pn-kaos"); document.documentElement.classList.add("pn-settle");
        const bg = getComputedStyle(t).backgroundColor;
        document.documentElement.classList.remove("pn-settle"); const bg2 = getComputedStyle(t).backgroundColor;
        if (!had) t.classList.remove("pn-kaos"); if (H0) document.documentElement.classList.add("pn-settle");
        return { bg, bg2 };
      });
      ok(k.bg !== "rgb(200, 32, 42)" && k.bg2 !== "rgb(200, 32, 42)" && k.bg2 !== k.bg, "H2-2 KAOS: no red bar behind the green ticker text in the first seconds; the KAOS look (fixA P-04: dark + amber, no longer red) with the KAOS line", k);
      // 10: Mer → Systembolaget row title in line with the other rows
      await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 1500);
      const m = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .ds-row.pn-row")].filter((r) => r.getClientRects().length && r.getBoundingClientRect().height > 0)
        .map((r) => { const i = r.querySelector(".ds-row-i"), n = i && i.nextElementSibling; return { sb: r.classList.contains("pn-sb-row"), x: n ? Math.round(n.getBoundingClientRect().left) : null }; }));
      const sb = m.find((x) => x.sb), oth = m.filter((x) => !x.sb && x.x != null);
      ok(sb && oth.length && oth.every((x) => Math.abs(x.x - sb.x) <= 1), "H2-10 Mer: the Systembolaget row title is in line with the other rows", m);
      await H.closeSheet(page); await wait(page, 600);
      // 20: bar card buttons (Fel tider?, Rapportera pris, Dansgolvet) are 44 px
      await page.evaluate(() => { const b = BARS.byId("n3472634175"); PN.openBar(b); }); await wait(page, 2500);
      const bb = await page.evaluate(() => [...document.querySelectorAll(".bi-btn, .cr-dance-b")].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)));
      ok(bb.length >= 3 && bb.every((x) => x >= 44), "H2-20 bar card: Fel tider? / Rapportera pris / Dansgolvet buttons >= 44 px (were 40 / 34)", bb);
      await page.evaluate(() => __map.closePopup()); await wait(page, 500);
      // 19: Förfest "Uppvärmning" + "Kaos" cards: every gradient stop >= 4.5:1 with white
      await page.evaluate((g) => window.FORFEST.open({ id: g, name: "Ludvika Lager" }), H.GID); await wait(page, 2500);
      const ff = await page.evaluate(() => [".ff-mode.m-u", ".ff-mode.m-k"].map((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundImage : null; }));
      const stops = ff.map((g) => (g ? (g.match(/rgb\((\d+), (\d+), (\d+)\)/g) || []) : []).map((x) => x.match(/\d+/g).map(Number)));
      const worst = stops.map((l) => l.length ? Math.min(...l.map(onWhite)) : 0).map((x) => Math.round(x * 100) / 100);
      ok(worst.every((x) => x >= 4.5), "H2-19 Förfest: white text on the Uppvärmning / Kaos cards >= 4.5:1 at every colour stop (was 2.1 / 4.46)", worst);
      await page.evaluate(() => { try { window.FORFEST.close(); } catch (e) {} }); await wait(page, 600);
      // 23: Hämta mig: no emoji in the body text
      await page.evaluate(() => window.SKJUTS.openPickup({})); await wait(page, 2000);
      const pk = await page.evaluate(() => [...document.querySelectorAll("#sheet-body p")].map((p) => p.textContent).filter((t) => /\p{Extended_Pictographic}/u.test(t)));
      ok(pk.length === 0, "H2-23 Hämta mig: no emoji in the body text (the privacy line had 🔒)", pk);
      await H.closeSheet(page); await wait(page, 500);
      // 26: the stale chip says Offline when there is no network (it hides the offline banner)
      await ctx.setOffline(true);
      const off = await page.evaluate(() => { window.dispatchEvent(new Event("offline")); if (window.X8 && X8.staleShow) X8.staleShow(true); const c = document.getElementById("x8-stale"); return c ? c.textContent : null; });
      await ctx.setOffline(false);
      ok(/^Offline/.test(off || ""), "H2-26 no network: the chip says 'Offline · senast uppdaterad …' (was only 'Senast uppdaterad …')", off);
    }
    ok(errs.length === 0, "A18/D2/H2: no page errors", errs);
    await ctx.close();
  }

  /* ---------- B9: 44 px hit area around person pins (look unchanged) ---------- */
  if (PARTS.includes("b9")) {
    const { ctx, page } = await open();
    await H.boot(page);
    await wait(page, 1500);
    // bring a person pin (stranger, 28 px) to the middle of the map, away from the rail and the dock
    await page.evaluate(() => { const p = [...document.querySelectorAll(".leaflet-marker-icon .pn-p")].find((x) => x.getBoundingClientRect().width > 0); if (!p) return;
      const r = p.getBoundingClientRect(); __map.panBy([r.left + r.width / 2 - 195, r.top + r.height / 2 - 430], { animate: false }); });
    await wait(page, 1500);
    const b = await page.evaluate(() => {
      const res = { pins: 0, good: 0, kinds: {}, size: [] };
      [...document.querySelectorAll(".leaflet-marker-icon .pn-p, .leaflet-marker-icon .pn-cl, .leaflet-marker-icon .pill, .leaflet-marker-icon .pl-in")].forEach((p) => {
        const r = p.getBoundingClientRect(); if (!r.width || r.top < 120 || r.bottom > 760 || r.left < 24 || r.right > 366) return;
        const mk = p.closest(".leaflet-marker-icon"), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = 19;
        const top = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.closest(".leaflet-marker-icon") : null; };
        const pts = [[cx + d, cy], [cx - d, cy], [cx, cy + d], [cx, cy - d]].filter((q) => Math.abs(q[0] - cx) > r.width / 2 || Math.abs(q[1] - cy) > r.height / 2);
        const own = pts.filter((q) => top(q[0], q[1]) === mk).length, other = pts.filter((q) => { const t = top(q[0], q[1]); return t && t !== mk; }).length;
        res.pins++; const k = p.className.split(" ")[0];
        if (pts.length && own + other === pts.length && own > 0) { res.good++; res.kinds[k] = (res.kinds[k] || 0) + 1; }
        if (res.size.length < 3) res.size.push([k, Math.round(r.width), Math.round(r.height)]);
      });
      return res;
    });
    ok(b.pins > 0 && b.good > 0 && (b.kinds["pn-p"] || b.kinds["pn-cl"]), "B9 a tap 19 px from a person pin / people cluster centre (outside the drawn pin) lands on that pin", b);
    ok(b.size.every((s) => s[1] < 44 || s[0] === "pill"), "B9 the pins look the same (no bigger drawing)", b.size);
    // a real tap 19 px right of a person pin reaches its marker (click)
    const t = await page.evaluate(() => {
      const p = [...document.querySelectorAll(".leaflet-marker-icon .pn-p")].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.top > 120 && r.bottom < 760 && r.left > 24 && r.right < 366 &&
        document.elementFromPoint(r.left + r.width / 2 + 19, r.top + r.height / 2) && document.elementFromPoint(r.left + r.width / 2 + 19, r.top + r.height / 2).closest(".leaflet-marker-icon") === x.closest(".leaflet-marker-icon"); })
        || document.querySelector(".leaflet-marker-icon .pn-p");
      if (!p) return null; const mk = p.closest(".leaflet-marker-icon"); window.__b9 = 0; mk.addEventListener("click", () => { window.__b9++; }, { capture: true, once: true });
      const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2 + 19, y: r.top + r.height / 2, w: r.width };
    });
    if (t) await page.mouse.click(t.x, t.y);
    const hits = await page.evaluate(() => window.__b9 || 0);
    ok(t && hits === 1, "B9 a real tap 19 px from a person pin's centre opens that pin (it hit the map before)", { t, hits });
    await ctx.close();
  }

  /* ---------- I-95: the departure chip for a PLACE (O'Learys Borlänge) ---------- */
  if (PARTS.includes("i95")) {
    const { ctx, page, errs } = await open();
    const P = { id: "pl_6048761_1543531", name: "O'Learys", lat: 60.48761, lng: 15.43531 };
    await page.route(/rest\/v1\/rpc\/group_etas\b/, (r) => J(r, [{ id: 91, is_me: true, bar_id: P.id, bar_name: P.name, lat: P.lat, lng: P.lng,
      eta_at: new Date(Date.now() + 10 * 60e3).toISOString(), created_at: new Date(Date.now() - 5 * 60e3).toISOString() }]));
    await H.boot(page);
    await page.waitForFunction(() => window.BARSPLUS && BARSPLUS.eta && BARSPLUS.eta.mine && BARSPLUS.eta.mine(), null, { timeout: 30000 }).catch(() => console.log("no eta"));
    await page.evaluate(() => __map.setView([60.4870, 15.4350], 11, { animate: false })); await wait(page, 2000);
    await page.waitForSelector(".mp-pin.mp-eta", { timeout: 8000 }).catch(() => {});
    const c = await page.evaluate(() => { const e = document.querySelector(".mp-pin.mp-eta"); return e ? { t: e.textContent, aria: e.getAttribute("aria-label"), w: Math.round(e.getBoundingClientRect().width) } : null; });
    ok(c && /På väg till O'Learys/.test(c.t) && /På väg till O'Learys/.test(c.aria || ""), "I-95 my departure chip says 'På väg till O'Learys' (was '🏃 O'Learys')", c);
    const el = await page.$(".mp-pin.mp-eta");
    if (el) { const bb = await el.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await wait(page, 3200); }
    const card = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup.olnu-bar"); return { open: !!p, name: !!(p && /O'Learys/.test(p.textContent)), eta: !!(p && p.querySelector(".pp-sec-eta .eta-me")), framme: !!(p && /Framme/.test(p.textContent)) }; });
    ok(card.open && card.name && card.eta && card.framme, "I-95 a tap on the chip opens the O'Learys card with my På väg box (Framme! / Avbryt)", card);
    ok(errs.length === 0, "I-95: no page errors", errs);
    await ctx.close();
  }

  /* ---------- B5: the pitch first, then the install guide, then the intro without a repeat ---------- */
  if (PARTS.includes("b5")) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "sv-SE", userAgent: UA_IOS });
    await ctx.route(/supabase\.co/, (r) => J(r, [])); await ctx.route(/api\.mapbox\.com|tiles\.mapbox\.com|events\.mapbox\.com/, (r) => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE); await wait(page, 3500);
    const s1 = await page.evaluate(() => { const c = document.getElementById("ux-inst"); return c ? { h: (c.querySelector("h2") || {}).textContent, t: c.textContent, next: !!c.querySelector(".mn-inst-next"), prim: c.querySelectorAll(".ds-btn-primary").length,
      wide: [...c.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length,
      emoji: /\p{Extended_Pictographic}/u.test([...c.querySelectorAll("b, h2, button, small, p")].map((e) => e.textContent).join(" ")) } : null; });
    ok(s1 && s1.h === "PintsNow" && /Live ölkarta/.test(s1.t) && !/Installera appen/.test(s1.t) && s1.next && s1.prim === 1, "B5 first open = the pitch (PintsNow, 'Live ölkarta…', ONE primary Fortsätt), not 'Installera appen'", s1);
    ok(s1 && s1.wide === 0 && !s1.emoji, "B5 pitch: nothing wider than the screen, no emoji (PNI icons)", s1);
    await page.click("#ux-inst .mn-inst-next").catch(() => {}); await wait(page, 500);
    const s2 = await page.evaluate(() => { const c = document.getElementById("ux-inst"); return c ? { t: c.textContent, steps: c.querySelectorAll(".mn-inst-step").length, skip: !!c.querySelector(".mn-inst-skip") } : null; });
    ok(s2 && /Installera appen/.test(s2.t) && s2.steps === 3 && s2.skip, "B5 Fortsätt → the install guide (3 steps + 'Fortsätt utan att installera')", s2);
    await page.click("#ux-inst .mn-inst-skip").catch(() => {}); await wait(page, 900);
    const s3 = await page.evaluate(() => { const i = document.getElementById("intro"); const n = i && i.querySelector(".sf-age-note"), sel = i && i.querySelector(".sf-age-sel");
      return { intro: !!(i && !i.hidden), steps: i ? i.querySelectorAll(".intro-steps").length : -1, age: !!(i && /född|18/.test(i.textContent)),
        note: n ? parseFloat(getComputedStyle(n).fontSize) : null, sel: sel ? parseFloat(getComputedStyle(sel).fontSize) : null }; });
    ok(s3.intro && s3.steps === 0 && s3.age, "B5 then the intro (age question) without the same 3 lines again", s3);
    ok(s3.note === null || s3.note >= 14, "H2-25 intro: the small print under the year is 14 px (was 13.6)", s3);
    ok(s3.sel === null || s3.sel === 16, "H2-25 intro: the year select uses the 16 px body size (was 16.8)", s3);
    ok(errs.length === 0, "B5: no page errors", errs);
    await ctx.close();
  }

  await browser.close();
  console.log(`\nuifix4: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
