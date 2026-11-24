// barsearch-pw.js — I-126 (owner 16 Nov 2026: "I'm in Stockholm and I want to go to a certain bar ... How can I search for
// it?"): docs/js/barsearch.js + docs/barsearch.css. Every check FAILS on c56a4ec (no search on the map at all).
// Mocked Supabase (d2-helpers), mocked place search (Nominatim + Mapbox routes), an extra test bar "Köpsmans Krog" through
// bars-extra.json. 390x844 + 360x640. Pictures: $TEST_OUT/barsearch/. Usage: node barsearch-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const { OUT, CHROME } = require("./env.js");
const fs = require("fs");
const SHOTS = OUT + "barsearch/"; fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const PIT = { id: "n3472634175", lat: 60.14997, lng: 15.18679 };
const KOP = { id: "x-test-kopsmans", name: "Köpsmans Krog", lat: 60.14962, lng: 15.18931, type: "pub" };
const NOM = [{ lat: "60.15310", lon: "15.19220", name: "Stortorget", display_name: "Stortorget, Ludvika", address: { road: "Stortorget", town: "Ludvika" } }];

async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const net = { nom: 0, mb: 0 };
  await page.route(/\/bars-extra\.json/, async (r) => {
    let list = []; try { list = await (await r.fetch()).json(); } catch (e) {}
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list.concat([KOP])) });
  });
  await page.route(/nominatim\.openstreetmap\.org\/search/, (r) => { net.nom++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NOM) }); });
  await page.route(/api\.mapbox\.com\/search\/geocode/, (r) => { net.mb++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) }); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => document.getElementById("pn-search") && window.BARS && BARS.byId("x-test-kopsmans"), null, { timeout: 15000 }).catch(() => console.log("no #pn-search / test bar"));
  return { ctx, page, net, errs };
}
const R = (page, sels) => page.evaluate((s) => s.map((q) => {
  const e = document.querySelector(q); if (!e || !e.getClientRects().length || getComputedStyle(e).display === "none") return null;
  const r = e.getBoundingClientRect(); return { q, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
}), sels);
const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
async function tapSearch(page) { await page.locator("#pn-search").click(); await wait(page, 350); }
async function type(page, q) { await page.fill("#bs-q", ""); await page.type("#bs-q", q, { delay: 30 }); await wait(page, 650); }
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#bs-list .bs-hit")].map((b) => ({ t: b.querySelector(".bs-t").textContent, s: (b.querySelector(".bs-s") || {}).textContent || "" })));
const card = (page) => page.evaluate(() => { const p = document.querySelector(".leaflet-popup.olnu-bar"); return p ? p.textContent.replace(/\s+/g, " ").slice(0, 160) : ""; });
const panelOpen = (page) => page.evaluate(() => !!document.getElementById("bs-panel"));

async function layout(page, vp, tag) {
  // a ride chip next to Ikväll (lane ridechip, #rd-stat in .hud-left) + my count button (#pn-mine): nothing may touch search
  await page.evaluate(() => {
    const h = document.querySelector(".hud-left");
    if (h && !document.getElementById("rd-stat")) { const b = document.createElement("button"); b.id = "rd-stat"; b.textContent = "Skjuts · På väg 4 min"; h.appendChild(b); }
    if (window.MYCOUNT) MYCOUNT.set(3);
  });
  await wait(page, 300);
  const [s, more, mine, tk, ikv, hud, rd, dock, loc, prec] = await R(page, ["#pn-search", "#btn-more", "#pn-mine", ".ticker", "#pn-ikv2", ".hud-left .hx-chip", "#rd-stat", ".dock", "#btn-locate", "#prec-seg"]);
  ok(`${tag} the search button is visible, 44 px, in the rail under ⋯ Mer`, s && s.w >= 44 && s.h >= 44 && more && s.t >= more.b && Math.abs(s.r - more.r) <= 1, { s, more });
  ok(`${tag} it covers nothing: ticker, Ute chip, urgent chip, ride chip, dock, locate`, s && ![tk, ikv, hud, rd, dock, loc, prec].some((x) => hit(s, x)), { s, tk, ikv, hud, rd, dock, loc, prec });
  ok(`${tag} my count button moves one slot down (no overlap)`, s && mine && mine.t >= s.b && !hit(s, mine) && (!loc || mine.b <= loc.t), { s, mine, loc });
  const icon = await page.evaluate(() => { const b = document.getElementById("pn-search"); return { svg: !!(b && b.querySelector("svg")), aria: b && b.getAttribute("aria-label") }; });
  ok(`${tag} a magnifier icon (svg) + aria-label "Sök krog"`, icon.svg && icon.aria === "Sök krog", icon);
  // first 3 nights: the rail has words under the buttons (68 px steps): still clear of locate
  // barsearch2: add the class and measure in ONE synchronous step. pnds.js paintRail() sets the class again from its own state
  // on every rail repaint (body mutations, a 2 s timer), so a class set by the test, then a 100 ms wait, was often gone again
  // (CI 43792966550: Mer at its plain slot t222).
  const [s2, more2, mine2, loc2] = await page.evaluate((s) => {
    document.body.classList.add("mn-rail-lbl");
    return s.map((q) => { const e = document.querySelector(q); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect();
      return { q, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), on: document.body.classList.contains("mn-rail-lbl") }; });
  }, ["#pn-search", "#btn-more", "#pn-mine", "#btn-locate"]);
  ok(`${tag} rail with words: search under Mer, count under search, above locate`, s2 && more2 && s2.t >= more2.b + 18 && mine2 && mine2.t >= s2.b + 18 && (!loc2 || mine2.b <= loc2.t), { s2, more2, mine2, loc2 });
  await page.evaluate(() => { document.body.classList.remove("mn-rail-lbl"); const r = document.getElementById("rd-stat"); if (r) r.remove(); MYCOUNT.set(0); }); await wait(page, 100);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const tag = vp.width + ":";
      const { ctx, page, net, errs } = await open(browser, vp);
      await layout(page, vp, tag);
      await page.screenshot({ path: SHOTS + `1-map-${vp.width}.png` });

      // tap = the panel, keyboard at once
      await tapSearch(page);
      const f = await page.evaluate(() => ({ open: !!document.getElementById("bs-panel"), focus: document.activeElement && document.activeElement.id, ph: (document.getElementById("bs-q") || {}).placeholder }));
      ok(`${tag} tap = the search panel, the field has focus (keyboard), "Sök bar eller ställe"`, f.open && f.focus === "bs-q" && f.ph === "Sök bar eller ställe", f);
      const [pn, tk2] = await R(page, ["#bs-panel", "#bs-q"]);
      ok(`${tag} the panel fits the screen width (16 px gutter or less, no side scroll)`, pn && pn.l >= 8 && pn.r <= vp.width - 8 && tk2 && tk2.h >= 44, { pn, tk2 });

      // "pitch" → Pitchers (Ludvika) first, town · distance · people now
      await type(page, "pitch");
      let rs = await rows(page);
      ok(`${tag} "pitch" → Pitchers first`, rs[0] && rs[0].t === "Pitchers", rs.slice(0, 4));
      ok(`${tag} the row says town · distance · N här nu (totals only)`, rs[0] && /Ludvika/.test(rs[0].s) && /· \d+ m/.test(rs[0].s) && /\d+ här nu/.test(rs[0].s), rs[0]);
      ok(`${tag} Pitcher's in other towns are found too (bars.json = the whole country)`, rs.filter((r) => /^Pitcher/.test(r.t)).length >= 3, rs.map((r) => r.t + " | " + r.s));
      ok(`${tag} no place search while typing with Nominatim (usage policy)`, net.nom === 0, net);
      await page.screenshot({ path: SHOTS + `3-typing-pitch-${vp.width}.png` });

      if (vp.width === 390) {
        await type(page, "kopsmans");
        rs = await rows(page);
        ok(`accent and case free: "kopsmans" → Köpsmans Krog`, rs[0] && rs[0].t === "Köpsmans Krog", rs.slice(0, 3));
        await type(page, "KÖPSM");
        rs = await rows(page);
        ok(`"KÖPSM" → Köpsmans Krog`, rs[0] && rs[0].t === "Köpsmans Krog", rs.slice(0, 3));
        await type(page, "krog kopsmans");
        rs = await rows(page);
        ok(`words in any order: "krog kopsmans" → Köpsmans Krog`, rs[0] && rs[0].t === "Köpsmans Krog", rs.slice(0, 3));
        await type(page, "pitchers stockholm");
        rs = await rows(page);
        ok(`a word can name the town: "pitchers stockholm" → the Stockholm Pitcher's`, rs[0] && /Stockholm/.test(rs[0].s), rs.slice(0, 3));

        // few own hits → places (Nominatim: only on a tap), marked "plats"; pick = fly + a short-lived marker
        await type(page, "stortorget");
        const more = await page.evaluate(() => { const b = document.querySelector(".bs-more"); return b ? b.textContent : null; });
        ok(`no own hit → "Sök bland platser" (no request yet)`, !!more && /Sök bland platser/.test(more) && net.nom === 0, { more, net });
        await page.locator(".bs-more").click(); await wait(page, 700);
        rs = await rows(page);
        ok(`place results are marked "plats"`, rs[0] && rs[0].t === "Stortorget" && /plats/.test(rs[0].s) && net.nom >= 1, { rs, net });
        await page.locator(".bs-hit").first().click(); await wait(page, 1500);
        const pl = await page.evaluate(() => { const c = __map.getCenter(); return { lat: c.lat, lng: c.lng, z: __map.getZoom(), mark: !!document.querySelector(".bs-mark"), open: !!document.getElementById("bs-panel") }; });
        ok(`a "plats" pick: the map goes there + a short-lived marker`, !pl.open && Math.abs(pl.lat - 60.1531) < 0.002 && Math.abs(pl.lng - 15.1922) < 0.004 && pl.mark, pl);
        await page.evaluate(() => __map.setView([60.1505, 15.1872], 15, { animate: false })); await wait(page, 400);
        await tapSearch(page);
      }

      // pick Pitchers = its bar card (the same card as a pin tap)
      await type(page, "pitch");
      await page.locator(".bs-hit").first().click();
      await page.waitForFunction(() => { const p = document.querySelector(".leaflet-popup.olnu-bar"); return p && /Pitchers/.test(p.textContent); }, null, { timeout: 5000 }).catch(() => {});
      const c1 = await card(page), z1 = await page.evaluate(() => ({ z: __map.getZoom(), c: __map.getCenter() }));
      ok(`${tag} pick = the bar card of Pitchers opens, the map is there (zoom ≥ 16)`, /Pitchers/.test(c1) && !(await panelOpen(page)) && z1.z >= 16 && Math.abs(z1.c.lat - PIT.lat) < 0.003, { c1, z1 });
      await wait(page, 500);
      await page.screenshot({ path: SHOTS + `4-card-${vp.width}.png` });

      // Senaste: shown while the field is empty
      await page.evaluate(() => __map.closePopup()); await wait(page, 300);
      await tapSearch(page);
      let rec = await page.evaluate(() => ({ head: (document.querySelector("#bs-list .bs-h") || {}).textContent, rows: [...document.querySelectorAll("#bs-list .bs-t")].map((x) => x.textContent) }));
      ok(`${tag} "Senaste" shows the pick when the field is empty`, rec.head === "Senaste" && rec.rows[0] === "Pitchers", rec);
      await page.screenshot({ path: SHOTS + `2-empty-senaste-${vp.width}.png` });

      if (vp.width === 390) {
        const stored = await page.evaluate(() => localStorage.getItem("olnu.barsearch.recent"));
        let sj = []; try { sj = JSON.parse(stored); } catch (e) {}
        ok(`Senaste on the phone holds names + coordinates only, max 6`, Array.isArray(sj) && sj.length >= 1 && sj.length <= 6 && sj.every((x) => Object.keys(x).every((k) => ["n", "lat", "lng", "k"].includes(k))), sj);
        // Senaste pick = the card again
        await page.locator(".bs-hit").first().click();
        await page.waitForFunction(() => { const p = document.querySelector(".leaflet-popup.olnu-bar"); return p && /Pitchers/.test(p.textContent); }, null, { timeout: 5000 }).catch(() => {});
        ok(`a Senaste pick opens the bar card`, /Pitchers/.test(await card(page)), await card(page));
        await page.evaluate(() => __map.closePopup());

        // Esc and Android back close the panel; back stays in the app
        await tapSearch(page); await page.keyboard.press("Escape"); await wait(page, 600);
        ok(`Esc closes the panel`, !(await panelOpen(page)));
        const u0 = page.url();
        await tapSearch(page); await page.goBack().catch(() => {}); await wait(page, 700);
        ok(`Android back closes the panel and stays in the app`, !(await panelOpen(page)) && page.url() === u0 && (await page.evaluate(() => !!window.BARSEARCH)), page.url());

        // One click router: the tap that closes the panel never opens a pin card under it
        // lane walktime (E6, 24 Nov): the empty panel now also lists "Inom 10 min promenad" (up to 5 rows), so it is taller and
        // covered the pin at the screen centre. The pin now sits about 220 px below the centre (map centre 0.0012° north), on the
        // dimmed map under the panel. The check itself is the same.
        await page.evaluate((p) => __map.setView([p.lat + 0.0012, p.lng], 17, { animate: false }), PIT); await wait(page, 1200);
        // fixC P-20 (24 Nov): "Senaste" + 3 near rows can still reach the pin: measure the open panel and move the map so the
        // pin sits 80 px below it.
        await tapSearch(page);
        const pb = await page.evaluate(() => Math.round(document.getElementById("bs-panel").getBoundingClientRect().bottom));
        await page.keyboard.press("Escape"); await wait(page, 600);
        await page.evaluate((b) => { const m = [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((e) => /Pitchers/.test(e.textContent)); if (!m) return;
          const r = m.getBoundingClientRect(), y = r.top + r.height / 2; if (y < b + 80) __map.panBy([0, -(b + 80 - y)], { animate: false }); }, pb); await wait(page, 900);
        const pt = await page.evaluate(() => {
          const m = [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((e) => /Pitchers/.test(e.textContent)); if (!m) return null;
          const r = m.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (pt) { await page.touchscreen.tap(pt.x, pt.y); await wait(page, 900); }
        const ctl = await card(page);
        ok(`control: a tap on the Pitchers pin opens its card`, !!pt && /Pitchers/.test(ctl), { pt, ctl });
        await page.evaluate(() => __map.closePopup()); await wait(page, 400);
        await tapSearch(page);
        if (pt) { await page.touchscreen.tap(pt.x, pt.y); await wait(page, 900); }
        const after = { open: await panelOpen(page), card: await card(page), sheet: await page.evaluate(() => !document.getElementById("sheet").hidden) };
        ok(`closing the panel (tap on the dimmed map over a pin) does not open a pin card`, !!pt && !after.open && !after.card && !after.sheet, after);

        // Senaste survives a reload
        await page.reload(); await wait(page, 4500);
        await page.waitForFunction(() => document.getElementById("pn-search"), null, { timeout: 15000 }).catch(() => {});
        await tapSearch(page);
        rec = await page.evaluate(() => [...document.querySelectorAll("#bs-list .bs-t")].map((x) => x.textContent));
        ok(`Senaste survives a reload`, rec[0] === "Pitchers", rec);
        await page.keyboard.press("Escape"); await wait(page, 500);

        // offline: our own bars still work, no place search
        await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        const n0 = net.nom;
        await tapSearch(page); await type(page, "pitch");
        rs = await rows(page);
        ok(`offline: "pitch" still finds Pitchers`, rs[0] && rs[0].t === "Pitchers", rs.slice(0, 2));
        await type(page, "stortorget");
        const off = await page.evaluate(() => ({ msg: (document.querySelector(".bs-msg") || {}).textContent, more: !!document.querySelector(".bs-more") }));
        ok(`offline: no place search, a plain note instead`, /offline/i.test(off.msg || "") && !off.more && net.nom === n0, off);
        await ctx.setOffline(false);
      }
      ok(`${tag} no page errors`, errs.length === 0, errs);
      await ctx.close();
    }

    // reduced motion + store build: the same search, the map JUMPS (no fly)
    {
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { reduced: true, store: true });
      const store = await page.evaluate(() => !!window.OLNU_STORE);
      await page.evaluate(() => { window.__mv = []; const m = __map, fl = m.flyTo, sv = m.setView;
        m.flyTo = function (ll, z, o) { __mv.push(["fly", Array.isArray(ll) ? ll[0] : ll.lat]); return fl.apply(this, arguments); };
        m.setView = function (ll, z, o) { __mv.push(["set", Array.isArray(ll) ? ll[0] : ll.lat, !!(o && o.animate === false)]); return sv.apply(this, arguments); }; });
      await page.evaluate(() => __map.setView([59.33, 18.06], 13, { animate: false })); await page.evaluate(() => { __mv = []; });
      await tapSearch(page); await type(page, "pitch");
      const rs = await rows(page);
      ok(`store build: the button and the search work the same`, store && rs[0] && /^Pitcher/.test(rs[0].t), { store, r: rs[0] });
      await page.locator(".bs-hit").first().click(); await wait(page, 300);
      const mv = await page.evaluate(() => __mv);
      ok(`reduced motion: the first map move is a jump (setView, animate:false), not a fly`, mv[0] && mv[0][0] === "set" && mv[0][2] === true, mv);
      ok(`reduced motion: no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nbarsearch: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
