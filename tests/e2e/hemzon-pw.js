// hemzon-pw.js — I-127 (owner 16 Nov 2026): the Hemzon sheet (docs/js/homezone.js), the shared address search
// (docs/js/placesearch.js), the app-wide text-field focus ring (docs/ds.css) and the Auto hemma rule (docs/js/autohome.js).
// Mocked: Supabase (ds-helpers), the geocoders (Mapbox v6 + Nominatim), and Mapbox GL's network: a fake pk token from
// public_config + a tiny local style (no Mapbox account, no tiles). mapbox-gl.js itself is the real one from the CDN.
// Usage: node hemzon-pw.js <port>
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const { wait } = H;
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 400))); };
const J = (r, b, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(b) });
// a fake public token (payload {"u":"test"}): only the mocked routes below ever see it
const TOK = "pk.eyJ1IjoidGVzdCJ9.dGVzdHRlc3R0ZXN0dGVzdA";
const STYLE = { version: 8, name: "hemzon-test", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "rgb(60,64,110)" } }] };
const LUD = [60.1489, 15.1935], GNO = [57.3605, 14.0336];   // Köpmansgatan 23a Ludvika · the same address in Gnosjö
const MBF = (t, ll, town) => ({ properties: { feature_type: "address", name: t, address: t, context: { place: { name: town } } }, geometry: { coordinates: [ll[1], ll[0]] } });

async function open(browser, vp, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, vp, { checkin: o.checkin });
  const errs = [], reqs = { mb: [], nom: [] };
  page.on("pageerror", (e) => errs.push(e.message));
  if (o.gl) {   // the token before boot: the app map AND the Hemzon map run on (mocked) Mapbox GL
    await ctx.addInitScript((t) => { try { localStorage.setItem("olnu.mbToken", t); } catch (e) {} }, TOK);
    await page.route(/rest\/v1\/rpc\/public_config/, (r) => J(r, { v: 3, support: "x", visning: "off", terms_ver: 1, store_mode: "off", mapbox_token: TOK }));
  }
  await page.route(/api\.mapbox\.com\/styles\//, (r) => J(r, STYLE));
  await page.route(/(events\.mapbox\.com|api\.mapbox\.com\/(map-sessions|v4|fonts|tiles|models|raster))/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.route(/api\.mapbox\.com\/search\/geocode/, (r) => {
    const u = new URL(r.request().url()), q = u.searchParams.get("q") || ""; reqs.mb.push(q);
    if (o.mbDown) return J(r, { message: "Forbidden" }, 403);
    if (/23\s?a/i.test(q)) return J(r, { features: [MBF("Köpmansgatan 23a", LUD, "Ludvika"), MBF("Köpmansgatan 23a", GNO, "Gnosjö")] });
    return J(r, { features: [MBF(q.replace(/^\w/, (c) => c.toUpperCase()), [60.1495, 15.19], "Ludvika")] });
  });
  await page.route(/nominatim\.openstreetmap\.org\/search/, (r) => {   // Nominatim knows "23", not "23A" (like the real one did)
    const q = new URL(r.request().url()).searchParams.get("q") || ""; reqs.nom.push(q);
    if (/23\s?a/i.test(q)) return J(r, []);
    return J(r, [{ name: "", display_name: "Köpmansgatan 23, Ludvika", lat: String(LUD[0]), lon: String(LUD[1]), address: { road: "Köpmansgatan", house_number: "23", town: "Ludvika" } }]);
  });
  await H.boot(page);
  if (o.tok) await page.evaluate((t) => localStorage.setItem("olnu.mbToken", t), TOK);   // after boot: the search has a token, the maps stay raster (fast)
  if (o.home) await page.evaluate((h) => localStorage.setItem("olnu.home", JSON.stringify(h)), o.home);
  await page.evaluate(() => window.PN.placeSearch && window.PN.placeSearch._clear());
  return { ctx, page, errs, reqs };
}
const openHz = async (p) => { await p.evaluate(() => window.HOMEZONE.open()); await p.waitForSelector("#sheet-body .hz-map", { timeout: 8000 }).catch(() => {}); await wait(p, 1500); };
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("olnu.home") || "null"));
const clickSave = (p) => p.evaluate(() => [...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemzonen/.test(b.textContent)).click());
const hits = (p) => p.evaluate(() => [...document.querySelectorAll("#sheet-body .ps-hit")].map((b) => b.textContent.trim()));
const glOn = (p) => p.waitForFunction(() => { const m = (window.MBX._maps || []).find((x) => x.getContainer().classList.contains("hz-map")); return m && m.isGL() && m.getMapboxMap().loaded(); }, null, { timeout: 15000 }).then(() => true, () => false);

// the ring of a focused field vs the box of its nearest clipping parent (0 = nothing is cut)
const RING = (sel) => {
  const el = document.querySelector(sel); if (!el) return { sel, missing: true };
  el.focus(); const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  let grow = 0;
  if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) grow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || 0);
  (cs.boxShadow || "none").split(/,(?![^(]*\))/).forEach((s) => { if (s === "none" || /inset/.test(s)) return; const n = s.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/).map(parseFloat); if (n.length >= 4 && n[3] > 0) grow = Math.max(grow, n[3]); });
  let L = 0, R = innerWidth;
  for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowX !== "visible") { const q = p.getBoundingClientRect(); L = Math.max(L, q.left); R = Math.min(R, q.right); } }
  return { sel, grow: +grow.toFixed(1), offset: cs.outlineOffset, ring: cs.outlineStyle !== "none", cutL: +Math.max(0, L - (r.left - grow)).toFixed(1), cutR: +Math.max(0, (r.right + grow) - R).toFixed(1) };
};

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {};
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"], ...proxy });
  // each section: its own contexts; a crash = one FAIL line, the next section still runs (the old code must show every FAIL)
  const sec = async (name, fn) => {
    const ctxs = [], use = async (vp, o) => { const r = await open(browser, vp, o); ctxs.push(r.ctx); return r; };
    try { await fn(use); } catch (e) { ok(name + " (crashed: " + String(e.message).split("\n")[0] + ")", false); }
    for (const c of ctxs) await c.close().catch(() => {});
  };
  const V = { width: 390, height: 844 };
  try {
    await sec("A search", async (use) => {
    // ---------- 1+2. suggestions while typing; "23A" finds the house; a pick places the point ----------
    let { page, reqs } = await use(V, { tok: true });
    await openHz(page);
    ok("A0 the address search runs on Mapbox (config switch placeSearch: mapbox)", await page.evaluate(() => window.PN.placeSearch.engine()) === "mapbox");
    await page.focus("#sheet-body .hz-q"); await page.keyboard.type("Köpsmansgatan 23A", { delay: 35 }); await wait(page, 1200);
    let l = await hits(page);
    ok("A1 suggestions appear while typing (no Sök tap)", l.length >= 2, { l, mb: reqs.mb });
    ok("A2 debounced: fewer Mapbox calls than letters typed, never Nominatim while typing", reqs.mb.length >= 1 && reqs.mb.length <= 4 && reqs.nom.length === 0, reqs);
    ok("A3 23A: the Ludvika house is the first suggestion", /Köpmansgatan 23a/.test(l[0] || "") && /Ludvika/.test(l[0] || ""), l);
    const shot = (n) => page.screenshot({ path: require("./env.js").OUT + "hemzon-" + n + ".png" });
    await shot("typing");
    await page.click("#sheet-body .ps-hit >> nth=0", { timeout: 3000 }); await wait(page, 1200);
    ok("A4 a pick places the point (hint) and closes the list", /Punkt vald/.test(await page.evaluate(() => document.querySelector("#sheet-body .hz-hint").textContent)) && (await hits(page)).length === 0);
    await clickSave(page); await wait(page, 500);
    const h = await saved(page);
    ok("A5 Spara saves the picked house (23A, Ludvika)", h && Math.abs(h.lat - LUD[0]) < 1e-4 && Math.abs(h.lng - LUD[1]) < 1e-4, h);
    });
    await sec("A6 fallback", async (use) => {
    const { page, reqs } = await use(V, { tok: true, mbDown: true });   // Mapbox says no → Nominatim on Sök, letter dropped
    await openHz(page);
    await page.fill("#sheet-body .hz-q", "Köpsmansgatan 23A"); await wait(page, 900);
    const nomTyping = reqs.nom.length;
    await page.click("#sheet-body .hz-qb"); await wait(page, 2000);
    await clickSave(page); await wait(page, 500); const h = await saved(page);
    ok("A6 Mapbox down: typing never calls Nominatim; Sök → Nominatim; '23A' unknown there → '23' found and picked", nomTyping === 0 && reqs.nom.some((q) => /23A/.test(q)) && reqs.nom.some((q) => /23$/.test(q)) && h && Math.abs(h.lat - LUD[0]) < 1e-4, { nomTyping, nom: reqs.nom, h });
    });
    // ---------- 3. the Mapbox GL map: tap, drag, circle, destroyed on close ----------
    await sec("B GL map", async (use) => {
    const { page, errs } = await use(V, { gl: true });
    await openHz(page);
    const gl = await glOn(page);
    const g = await page.evaluate(() => {
      const el = document.querySelector("#sheet-body .hz-map"), m = (window.MBX._maps || []).find((x) => x.getContainer() === el);
      const mm = m && m.getMapboxMap();
      return { engine: el.getAttribute("data-engine"), canvas: !!el.querySelector("canvas.mapboxgl-canvas"), isGL: !!(m && m.isGL()), notMain: !!mm && mm !== window.BASEMAP.mapbox().getMapboxMap(),
        style: mm && mm.getStyle().name, shapes: mm ? mm.getStyle().layers.filter((l) => /^mbx-/.test(l.id) || /fill|line/.test(l.type)).length : 0, pin: !!el.querySelector(".hz2-pin"),
        logo: !!el.querySelector(".mapboxgl-ctrl-logo") && getComputedStyle(el.querySelector(".mapboxgl-ctrl-logo")).display !== "none",
        scripts: [...document.scripts].filter((s) => /mapbox-gl/.test(s.src)).length, touch: mm ? mm.touchZoomRotate.isEnabled() : false };
    });
    ok("B1 Hemzon map = a Mapbox GL map in the app's style (not the raster mini map)", gl && g.engine === "gl" && g.canvas && g.isGL && g.notMain && g.style === "hemzon-test", g);
    ok("B2 the circle is drawn on the GL map, the pin is there, pinch zoom on, one copy of GL, Mapbox logo shown", g.shapes >= 1 && g.pin && g.touch && g.scripts === 1 && g.logo, g);
    const box = await page.$eval("#sheet-body .hz-map", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.7); await wait(page, 800);
    const c0 = await page.evaluate(() => { const m = (window.MBX._maps || []).find((x) => x.getContainer().classList.contains("hz-map")); return m.getCenter(); });
    await clickSave(page); await wait(page, 500); const h = await saved(page);
    ok("B3 a tap on the GL map places the point (west + south of the centre)", h && h.lng < c0.lng && h.lat < c0.lat, { h, c0 });
    await openHz(page); await glOn(page); await wait(page, 600);
    const pb = await page.$eval("#sheet-body .hz2-pin", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(pb.x, pb.y); await page.mouse.down(); await page.mouse.move(pb.x + 30, pb.y - 10, { steps: 4 }); await page.mouse.move(pb.x + 60, pb.y - 20, { steps: 4 }); await page.mouse.up(); await wait(page, 600);
    await clickSave(page); await wait(page, 500); const h2 = await saved(page);
    ok("B4 dragging the pin moves the point (east + north)", h2 && h2.lng > h.lng && h2.lat > h.lat, { h, h2 });
    await openHz(page); await glOn(page);
    const n0 = await page.evaluate(() => ({ maps: (window.MBX._maps || []).length, canvases: document.querySelectorAll("canvas.mapboxgl-canvas").length }));
    await H.closeSheet(page); await wait(page, 700);
    const n1 = await page.evaluate(() => ({ maps: (window.MBX._maps || []).length, canvases: document.querySelectorAll("canvas.mapboxgl-canvas").length }));
    ok("B5 the GL map is destroyed when the sheet closes (no leak)", n1.maps === n0.maps - 1 && n1.canvases === n0.canvases - 1, { n0, n1 });
    ok("B6 no page errors", errs.length === 0, errs.slice(0, 3));
    });
    await sec("B7 raster", async (use) => {
    const { page } = await use(V, {});   // no token → the raster mini map
    await openHz(page);
    const rs = await page.evaluate(() => { const el = document.querySelector("#sheet-body .hz-map"); return { engine: el.getAttribute("data-engine"), tiles: el.querySelectorAll("img.leaflet-tile").length, svg: el.querySelectorAll("svg.mbx-svg path").length, pin: !!el.querySelector(".hz2-pin") }; });
    ok("B7 no token / no GL → the old raster mini map still works (tiles, circle, pin)", rs.engine === "raster" && rs.tiles > 0 && rs.svg >= 1 && rs.pin, rs);
    });

    // ---------- 4. one screen: everything incl. Spara without scrolling ----------
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) await sec("C " + vp.width, async (use) => {
      const { page } = await use(vp, { home: { lat: LUD[0], lng: LUD[1], r: 150, ar: 150, at: 1 } });
      await openHz(page);
      const f = await page.evaluate(() => {
        const b = document.getElementById("sheet-body"), br = b.getBoundingClientRect(), bot = Math.min(br.bottom, innerHeight) + 0.5;
        const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= br.top - 0.5 && r.bottom <= bot; };
        const save = [...b.querySelectorAll("button")].find((x) => /Spara hemzonen/.test(x.textContent)), del = b.querySelector(".hz2-del");
        return { scroll: b.scrollHeight - b.clientHeight, save: vis(save), del: vis(del), q: vis(b.querySelector(".hz-q")), map: vis(b.querySelector(".hz-map")), r: vis(b.querySelector("#hz-r")),
          mapH: Math.round(b.querySelector(".hz-map").getBoundingClientRect().height), info: b.querySelector(".hz2-line") && b.querySelector(".hz2-line").getBoundingClientRect().height };
      });
      ok(`C1 ${vp.width}x${vp.height}: search, map, radius, Spara and Ta bort all visible, no scrolling`, f.scroll <= 1 && f.save && f.del && f.q && f.map && f.r, f);
      ok(`C2 ${vp.width}x${vp.height}: one short info line (+ an (i) for the full text)`, f.info > 0 && f.info <= 24 && await page.evaluate(() => { const i = document.querySelector("#sheet-body .hz2-i"); if (!i) return false; i.click(); const v = !document.querySelector("#hz2-more").hidden; i.click(); return v; }), f);
    });

    // ---------- 5. focus ring: never cut (Hemzon, chat, Kväll search, invite, ride destination) ----------
    await sec("D ring", async (use) => {
    const { page } = await use(V, {});
    const rings = [];
    const field = async (name, how, sel, then) => {
      await H.closeSheet(page); await wait(page, 500);
      await page.evaluate(how).catch(() => {}); await wait(page, 1500);
      if (then) { await page.evaluate(then).catch(() => {}); await wait(page, 800); }
      const m = await page.evaluate(RING, sel); m.name = name; rings.push(m);
    };
    await field("hemzon", "window.HOMEZONE.open()", "#sheet-body .hz-q");
    await field("chat", `window.SOCIAL.openChat({ id: "${H.GID}", name: "Ludvika Lager" })`, "#sheet-body .chat-input textarea, #sheet-body .chat-input input");
    await field("kvall", "window.EVSHEET.open()", "#sheet-body .evs-q");
    await field("invite", "window.INVITE.openCreate({})", "#sheet-body .inv-form input.inp, #sheet-body input.inp");
    // ride destination: the ride v2 sheet needs the ride server (ride-pw.js); here its field (same classes, full width) in a sheet
    await field("ride", "window.HOMEZONE.open()", "#sheet-body .rd-dq", "(() => { const d = document.createElement('div'); d.className = 'rd'; d.innerHTML = '<div class=\"rd-say\"><input type=\"search\" class=\"rd-in rd-dq\"></div>'; document.getElementById('sheet-body').prepend(d); })()");
    const found = rings.filter((r) => !r.missing);
    ok("D1 the focus ring of a text field is drawn inside the field and is never cut (" + found.map((r) => r.name).join(", ") + ")",
      found.length >= 5 && found.every((r) => r.ring && r.cutL === 0 && r.cutR === 0 && parseFloat(r.offset) <= 0), rings);
    });

    // ---------- 6. radius: 25 m minimum, privacy area stays ≥ 100 m ----------
    await sec("E radius", async (use) => {
    const { page } = await use(V, {});
    await openHz(page);
    const rr = await page.evaluate(() => { const r = document.getElementById("hz-r"); r.value = r.min; r.dispatchEvent(new Event("input", { bubbles: true }));
      return { out: document.querySelector("#sheet-body .hz2-rv").textContent, txt: r.getAttribute("aria-valuetext") }; });
    await clickSave(page); await wait(page, 500); const h = await saved(page);
    ok("E1 the radius goes down to 25 m (slider minimum)", /^25 m$/.test(rr.out) && h && h.ar === 25, { rr, h });
    ok("E2 a drink at home is still only an area within 100 m (privacy r = max(radius, 100))", h && h.r === 100, h);
    });

    // ---------- 7. Auto hemma: not at a bar near home; home after 2 good readings over 2 min ----------
    const BAR = [60.14997, 15.18679];                         // Pitchers (ds-helpers: I am checked in there)
    const HOME60 = [BAR[0] + 60 / 111200, BAR[1]];            // home 60 m north of the bar
    await sec("F1", async (use) => {
    const { page } = await use(V, { home: { lat: HOME60[0], lng: HOME60[1], r: 100, ar: 100, at: 1 } });
    await wait(page, 600);
    for (const m of [0, 3, 8]) await page.evaluate(([la, ln, m]) => { window.AUTOHOME._skew(m ? 5 * 60e3 : 0); window.AUTOHOME._fix({ lat: la, lng: ln, acc: 10 }); }, [BAR[0], BAR[1], m]);
    const s = await page.evaluate(() => window.AUTOHOME.state());
    ok("F1 at the bar 60 m from home (checked in), 3 readings over 10 min → NOT home", !s.undo && s.why === "bar", s);
    });
    const HOME = [60.1535, 15.1990];                          // a quiet street, no bar within 40 m
    await sec("F2", async (use) => {
    const { page } = await use(V, { checkin: false, home: { lat: HOME[0], lng: HOME[1], r: 100, ar: 100, at: 1 } });
    await wait(page, 600);
    await page.evaluate(([la, ln]) => window.AUTOHOME._fix({ lat: la, lng: ln, acc: 15 }), HOME);
    await page.evaluate(([la, ln]) => { window.AUTOHOME._skew(150e3); window.AUTOHOME._fix({ lat: la + 0.0002, lng: ln, acc: 12 }); }, HOME);
    await wait(page, 1200);
    const s = await page.evaluate(() => window.AUTOHOME.state());
    const tx = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    ok("F2 2 good readings inside the zone over 2.5 min → home (toast + Ångra)", s.undo && /Välkommen hem/.test(tx), { s, tx });
    });
    await sec("F3", async (use) => {
    const { page } = await use(V, { checkin: false, home: { lat: HOME[0], lng: HOME[1], r: 100, ar: 25, at: 1 } });
    await wait(page, 600);
    await page.evaluate(([la, ln]) => { window.AUTOHOME._fix({ lat: la, lng: ln, acc: 30 }); window.AUTOHOME._skew(11 * 60e3); window.AUTOHOME._fix({ lat: la, lng: ln, acc: 30 }); }, HOME);
    const s = await page.evaluate(() => window.AUTOHOME.state());
    ok("F3 a 25 m zone: readings with 30 m accuracy never count (accuracy must beat the radius)", !s.undo && s.why === "accuracy", s);
    });
  } finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
