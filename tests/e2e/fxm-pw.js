// fxm tests (ds31–ds38, raster fallback = no Mapbox load). usage: node fxm-pw.js <port> [wk]
const H = require("./ds-helpers.js");
const { chromium, webkit } = require("playwright");
const SP = require("./env.js").OUT;
const WK = process.argv[3] === "wk";
require("fs").mkdirSync(SP + "fxm-shots", { recursive: true });
const { wait } = H;
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const hit = (a, b) => a && b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: o.w || 390, height: o.h || 844 }, o);
  const srv = { calls: [], ikv: o.ikv || null, ci: o.checkin === false ? null : { bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679 } };
  await page.route(/rest\/v1\/rpc\/(ikvall_status|ikvall_set|check_in|check_out|live_checkins|driver_set|pickup_poll|my_visibility|set_visibility|post_beer_v2)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "live_checkins") return J(r, srv.ci ? [Object.assign({ name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }, srv.ci)] : []);
    srv.calls.push({ fn, body });
    if (fn === "ikvall_status") return J(r, { v: 1, night: "2026-11-08", mine: srv.ikv, counts: { ute: 2, kanske: 1, hemma: 0 }, people: [{ name: "Lisa", st: "ute", friend: true }] });
    if (fn === "ikvall_set") { srv.ikv = body.p_st || null; return J(r, { v: 1, ok: true, mine: srv.ikv }); }
    if (fn === "check_in") { srv.ci = { bar_id: body.p_bar_id, bar_name: body.p_bar_name, lat: body.p_lat, lng: body.p_lng }; return J(r, { ok: true, bar_name: body.p_bar_name, wait_seconds: 0 }); }
    if (fn === "check_out") { const w = srv.ci; srv.ci = null; return J(r, { ok: !!w }); }
    if (fn === "driver_set") return J(r, { v: 1, ok: true, driving: !!body.p_on });
    if (fn === "my_visibility") return J(r, { v: 1, friends_only: false });
    if (fn === "set_visibility") return J(r, { v: 1, friends_only: !!body.p_friends_only });
    if (fn === "post_beer_v2") return J(r, { accepted: true, beer_count: 7, lat: body.p_lat, lng: body.p_lng, precise: false, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0 });
    return J(r, { v: 1, driving: false, incoming: [], mine: null });
  });
  if (o.geo) await ctx.setGeolocation({ latitude: o.geo[0], longitude: o.geo[1], accuracy: 10 });
  if (o.extra) await ctx.addInitScript(o.extra);
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, srv };
}
const calls = (srv, fn) => srv.calls.filter((c) => c.fn === fn);

(async () => {
  const browser = WK ? await webkit.launch() : await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });

  // ---------- 1. main screen geometry: ANNAT, ⓘ, the precision bubble, toasts (360 / 390 / 430) ----------
  for (const [w, h] of [[390, 844], [360, 780], [430, 932]]) {
    const t = await setup(browser, { w, h, ikv: "ute" });
    const p = t.page;
    const an = await p.evaluate(() => {
      const b = document.getElementById("btn-other"), l = b && b.querySelector(".ol-t"), s = b && b.querySelector("svg"); if (!b || !l) return null;
      const r = b.getBoundingClientRect(), q = l.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 - 2, ink = 2;   // ink box: the line box minus the half-leading
      const corners = [[q.left, q.top + ink], [q.right, q.top + ink], [q.left, q.bottom - ink], [q.right, q.bottom - ink]].map(([x, y]) => Math.hypot(x - cx, y - cy));
      return { w: Math.round(r.width), txt: l.textContent, maxD: +Math.max(...corners).toFixed(1), R, cls: s ? s.getAttribute("class") : "", fit: l.scrollWidth <= l.clientWidth + 1 };
    });
    ok(an && an.maxD <= an.R && an.fit && /Annat/.test(an.txt), w + ": ANNAT label 'Annat' inside the circle (corner at " + (an && an.maxD) + " ≤ " + (an && an.R) + ")");
    ok(an && /pi-mixed/.test(an.cls) && an.w === 50, w + ": ANNAT 50 px with the new 'mixed' glyph (" + (an && an.cls) + ")");
    const at = await p.evaluate(() => { const b = document.getElementById("btn-attrib"), s = b && b.querySelector(":scope>span"), g = document.getElementById("btn-groups"), o = document.getElementById("other-wrap"); if (!b || !s || !g) return null;
      const r = b.getBoundingClientRect(), q = s.getBoundingClientRect(), gr = g.getBoundingClientRect(), orr = o && !o.hidden ? o.getBoundingClientRect() : null;
      return { dx: +Math.abs(r.left + r.width / 2 - (q.left + q.width / 2)).toFixed(2), dy: +Math.abs(r.top + r.height / 2 - (q.top + q.height / 2)).toFixed(2), bg: getComputedStyle(s).backgroundColor,
        tap: Math.round(r.width), aboveG: Math.round(gr.top - (r.top + r.height / 2)), leftG: Math.round(r.left - gr.left),
        annat: orr ? !(r.right <= orr.left + 0.5 || r.left >= orr.right - 0.5 || r.bottom <= orr.top + 0.5 || r.top >= orr.bottom - 0.5) : false }; });
    ok(at && at.dx <= 0.5 && at.dy <= 0.5 && /rgba\(0, 0, 0, 0\)|transparent/.test(at.bg) && at.tap >= 24 && !at.annat && at.aboveG > 0 && at.aboveG <= 60, w + ": ⓘ = plain info glyph (no disc) in the credits row just above Grupper, ≥ 24 px tap, never over ANNAT (" + JSON.stringify(at) + ")");
    // precision bubble + a long toast
    await p.evaluate(() => { const b = document.querySelector('#prec-seg [aria-checked="true"]'); if (b) b.click(); }); await wait(p, 500);
    await p.evaluate(() => window.PNDS._A().toast("Ett långt meddelande som måste få plats på två rader utan att klippas av vid kanten", { ms: 8000, urgent: true })); await wait(p, 700);
    const R = {}; for (const [k, s] of [["annat", "#other-wrap"], ["loc", "#btn-locate"], ["attr", "#btn-attrib"], ["hint", "#prec-hint"], ["toast", "#toasts > .toast:last-child"], ["rail", "#btn-more"]]) R[k] = await rect(p, s);
    const hintCut = await p.evaluate(() => { const e = document.getElementById("prec-hint"); return e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1; });
    ok(R.hint && !hit(R.hint, R.annat) && !hit(R.hint, R.loc) && !hit(R.hint, R.attr) && !hintCut, w + ": precision bubble clear of ANNAT / locate / ⓘ, text not cut " + JSON.stringify({ hint: R.hint, annat: R.annat, loc: R.loc, attr: R.attr, hintCut }));
    ok(R.toast && !hit(R.toast, R.annat) && !hit(R.toast, R.loc) && !hit(R.toast, R.attr) && !hit(R.toast, R.hint), w + ": toast clear of ANNAT / locate / ⓘ / bubble " + JSON.stringify({ toast: R.toast, annat: R.annat, loc: R.loc, attr: R.attr, hint: R.hint }));
    if (w === 390) await p.screenshot({ path: SP + "fxm-shots/t-main-bubble-toast-390.png" });
    // ---------- 2. Ikväll chip ----------
    await p.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    const ik = await p.evaluate(() => { const c = document.getElementById("pn-ikv2"), tk = document.querySelector(".ticker"), hx = [...document.querySelectorAll(".hud-left .hx-chip:not([hidden])")].find((e) => e.getBoundingClientRect().width > 0), rail = document.getElementById("pn-ghost") || document.getElementById("btn-more");
      if (!c || c.hidden) return null; const r = c.getBoundingClientRect(), t = tk.getBoundingClientRect(), x = hx && hx.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      return { txt: c.textContent.trim(), l: Math.round(r.left), top: Math.round(r.top), tkb: Math.round(t.bottom), h: Math.round(r.height), hxL: x ? Math.round(x.left) : null, hxR: x ? Math.round(x.right) : null, right: Math.round(r.right), railL: Math.round(rr.left) }; });
    ok(ik && /Ute/.test(ik.txt) && ik.l === 12 && ik.top >= ik.tkb && ik.top - ik.tkb <= 12 && ik.h === 44, w + ": Ikväll chip top-left under LIVE, shows 'Ute' (" + JSON.stringify(ik) + ")");
    ok(ik && (ik.hxL == null || (ik.hxL >= ik.right + 4 && ik.hxR <= ik.railL - 8)) && ik.right <= ik.railL - 8, w + ": Ikväll chip + 'Kolla till' chip in one row, clear of the rail");
    if (w === 390) {
      await p.click("#pn-ikv2"); await wait(p, 400);
      const m = await p.evaluate(() => { const m = document.getElementById("pn-ikm"); if (!m) return null; const r = m.getBoundingClientRect(), rail = document.getElementById("pn-ghost").getBoundingClientRect();
        return { radios: m.querySelectorAll('[role=radio]').length, checked: (m.querySelector('[aria-checked="true"][role=radio]') || {}).textContent, rows: [...m.querySelectorAll(".pn-ikm-row b")].map((b) => b.textContent), sw: !!m.querySelector('[role=switch] .switch'), right: Math.round(r.right), railL: Math.round(rail.left) }; });
      ok(m && m.radios === 3 && m.checked === "Ute" && m.sw && ["Jag kör ikväll", "Följ mig hem", "Hämta mig", "Vilka ska ut?"].every((x) => m.rows.includes(x)), "Ikväll menu: Ute / Kanske / Hemma + Jag kör ikväll (switch) + Följ mig hem + Hämta mig + Vilka ska ut? " + JSON.stringify(m));
      ok(m && m.right <= m.railL - 8, "Ikväll menu stays clear of the right rail");
      await p.screenshot({ path: SP + "fxm-shots/t-ikvall-menu-390.png" });
      await p.click('#pn-ikm [data-st="hemma"]'); await wait(p, 1300);
      const after = await p.evaluate(() => document.getElementById("pn-ikv2").textContent.trim());
      ok(calls(t.srv, "ikvall_set").some((c) => c.body.p_st === "hemma") && /Hemma/.test(after), "Ikväll menu: Hemma → ikvall_set('hemma') (pnui) and the chip says Hemma");
      await p.mouse.click(60, 30); await wait(p, 400);
      ok(await p.evaluate(() => !document.getElementById("pn-ikm")), "Ikväll menu closes on a tap outside");
      await p.click("#pn-ikv2"); await wait(p, 300);
      await p.evaluate(() => { const r = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].find((x) => /Hämta mig/.test(x.textContent)); r.click(); }); await wait(p, 1200);
      ok(await p.evaluate(() => !document.getElementById("sheet").hidden && /Hämta/i.test(document.getElementById("sheet-title").textContent)), "Ikväll menu: Hämta mig opens the Hämta mig sheet (skjuts.js)");
      await H.closeSheet(p); await wait(p, 500);
      // ---------- 3. friends' totals on the bar marker (DOM fallback reads the same .pft) ----------
      const ft = await p.evaluate(() => { const out = {}; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (c && c.bar && l.options.icon) { const m = /class="pft"[^>]*>([^<]*)</.exec(l.options.icon.options.html || ""); out[c.bar.id] = m ? m[1] : null; } }); return out; });
      ok(ft["x-la-parma-ludvika"] === "11 · 2" && ft["n3472634175"] === "3" && ft["x-lobbybaren-ludvika"] == null, "map label: friends' night totals (La Parma '11 · 2', Pitchers '3'), none at a bar with only strangers " + JSON.stringify({ p: ft["x-la-parma-ludvika"], pi: ft["n3472634175"], l: ft["x-lobbybaren-ludvika"] }));
      const art = await p.evaluate(() => { const P = window.PNPINS; const a = P.barOps({ k: "pub", p: { l: 0, f: true, n: "5", ft: "15" } }, "f", false), b = P.barOps({ k: "pub", p: { l: 0, n: "5" } }, "f", false);
        const pl = a.parts.filter((x) => x.sel === ".pill"); return { a: a.ops.length, b: b.ops.length, chipBelow: pl.some((x) => x.bb[1] > 10) }; });
      ok(art.a > art.b && art.chipBelow, "GL art: a bar with friends gets the chip under its disc, tappable as 'Folk här' (.pill part) " + JSON.stringify(art));
    }
    await t.ctx.close();
  }

  // ---------- 4. auto check-in in a dense area: 3+ bars → a short list ----------
  {
    const SOD = [59.31481, 18.07603];
    const t = await setup(browser, { checkin: false, geo: [60.1439, 15.176], extra: () => localStorage.setItem("olnu.autoCi", "1") });
    await t.page.waitForFunction(() => window.AUTOCI && window.AUTOCI.state().watching, null, { timeout: 15000 }).catch(() => {});
    await t.page.evaluate(() => window.__map.setView([59.31481, 18.07603], 16, { animate: false })); await wait(t.page, 2500);
    for (const m of [1, 2.5, 2.6]) {
      await t.page.evaluate((m) => window.AUTOCI._skew(m * 60e3), m);
      await t.ctx.setGeolocation({ latitude: SOD[0], longitude: SOD[1], accuracy: 10 }); await wait(t.page, 400);
      await t.page.evaluate(() => window.AUTOCI._tick()); await wait(t.page, 2500);
    }
    const L = await t.page.evaluate(() => { const x = document.querySelector("#toasts .ac-list"); return x ? { head: x.querySelector("span").textContent, rows: [...x.querySelectorAll(".ac-li")].map((b) => b.textContent.replace(/\s+/g, " ").trim()), els: !!x.querySelector(".ac-else"), no: !!x.querySelector(".ac-no"), amber: x.querySelectorAll(".btn-amber").length } : null; });
    ok(L && L.rows.length === 3 && L.els && L.no && L.amber === 0, "dense area: 'Var ä du?' + the 3 nearest + Någon annanstans + Inte på krogen " + JSON.stringify(L));
    ok(L && L.rows.every((r) => /\d+ m$/.test(r)), "dense area: each row = name · metres");
    ok(calls(t.srv, "check_in").length === 0, "dense area: no auto check-in (never a guess)");
    const r0 = await rect(t.page, "#toasts .ac-list"), an = await rect(t.page, "#other-wrap"), lo = await rect(t.page, "#btn-locate");
    ok(r0 && !hit(r0, an) && !hit(r0, lo), "dense area: the list toast is clear of ANNAT and locate");
    await t.page.screenshot({ path: SP + "fxm-shots/t-autoci-list-390.png" });
    await t.page.evaluate(() => document.querySelector("#toasts .ac-list .ac-li").click()); await wait(t.page, 1500);
    ok(calls(t.srv, "check_in").length === 1, "dense area: a tap on a row checks in there (" + JSON.stringify(calls(t.srv, "check_in").map((c) => c.body.p_bar_name)) + ")");
    await t.ctx.close();
  }

  // ---------- 5. Auto hemma ----------
  {
    const HOME = [60.1600, 15.2000];
    const seedHome = () => localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.16, lng: 15.2, r: 300, at: Date.now() }));
    const t = await setup(browser, { ikv: "ute", extra: seedHome });
    await wait(t.page, 800);
    const pre = await t.page.evaluate(() => window.AUTOHOME && window.AUTOHOME.state());
    ok(pre && pre.home && pre.on, "auto hemma: on by default once a home is set " + JSON.stringify(pre));
    await t.page.evaluate(([la, ln]) => window.AUTOHOME._fix({ lat: la + 0.0003, lng: ln, acc: 12 }), HOME);
    await t.page.evaluate(() => window.AUTOHOME._skew(5 * 60e3)); await t.page.evaluate(([la, ln]) => window.AUTOHOME._fix({ lat: la, lng: ln + 0.0004, acc: 15 }), HOME);
    ok(calls(t.srv, "check_out").length === 0, "auto hemma: nothing before 10 min (" + (await t.page.evaluate(() => window.AUTOHOME.state().why)) + ")");
    await t.page.evaluate(() => window.AUTOHOME._skew(6 * 60e3)); await t.page.evaluate(([la, ln]) => window.AUTOHOME._fix({ lat: la, lng: ln, acc: 20 }), HOME);
    await wait(t.page, 1500);
    const tx = await t.page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    ok(calls(t.srv, "check_out").length === 1 && calls(t.srv, "ikvall_set").some((c) => c.body.p_st === "hemma"), "auto hemma: 10 min at home → check_out + Ikväll = Hemma");
    ok(/Välkommen hem/.test(tx) && /Ångra/.test(tx), "auto hemma: one toast 'Välkommen hem 🏠 — vi satte dig som Hemma' + Ångra (" + tx + ")");
    const sent = JSON.stringify(t.srv.calls);
    ok(!/60\.16|15\.2[^0-9]?/.test(sent.replace(/60\.14997|15\.18679/g, "")), "auto hemma: the home point is never sent to the server");
    await t.page.screenshot({ path: SP + "fxm-shots/t-autohome-toast-390.png" });
    await t.page.evaluate(() => { const b = [...document.querySelectorAll("#toasts .toast button")].find((x) => /Ångra/.test(x.textContent)); b.click(); }); await wait(t.page, 1500);
    ok(calls(t.srv, "check_in").length === 1 && t.srv.ikv === "ute", "auto hemma: Ångra → checked in again, status back to Ute (" + t.srv.ikv + ")");
    await t.page.evaluate(([la, ln]) => { window.AUTOHOME._skew(11 * 60e3); window.AUTOHOME._fix({ lat: la, lng: ln, acc: 10 }); }, HOME);
    ok((await t.page.evaluate(() => window.AUTOHOME.state().why)) === "done", "auto hemma: once per night");
    // settings row
    await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 1500); await H.clickJS(t.page, "#sheet-body [data-pf=s]"); await wait(t.page, 1500);
    const row = await t.page.evaluate(() => { const b = document.querySelector("#sheet-body .ah-row"); return b ? { t: b.textContent.trim(), sw: b.getAttribute("role"), on: b.getAttribute("aria-checked") } : null; });
    ok(row && /Sätt mig som hemma automatiskt/.test(row.t) && row.sw === "switch" && row.on === "true", "settings: 'Sätt mig som hemma automatiskt' switch (on) " + JSON.stringify(row));
    await t.ctx.close();
    // no home / ghost / no activity → nothing
    const t2 = await setup(browser, { ikv: "ute", checkin: false, extra: () => { localStorage.setItem("olnu.ghostMode", "1"); localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.16, lng: 15.2, r: 300 })); } });
    await t2.page.evaluate(([la, ln]) => { window.AUTOHOME._fix({ lat: la, lng: ln, acc: 10 }); }, HOME);
    ok((await t2.page.evaluate(() => window.AUTOHOME.state().why)) === "ghost", "auto hemma: nothing in spökläge");
    await t2.ctx.close();
    const t3 = await setup(browser, { checkin: false });
    await t3.page.evaluate(() => window.AUTOHOME._fix({ lat: 60.16, lng: 15.2, acc: 10 }));
    const s3 = await t3.page.evaluate(() => window.AUTOHOME.state());
    await H.clickJS(t3.page, "#btn-settings"); await wait(t3.page, 1500); await H.clickJS(t3.page, "#sheet-body [data-pf=s]"); await wait(t3.page, 1500);
    const set3 = await t3.page.evaluate(() => !!document.querySelector("#sheet-body .ah-set") && /Ställ in hem/.test(document.querySelector("#sheet-body .ah-set").textContent));
    ok(s3.why === "no_home" && set3, "auto hemma: no home → nothing, settings offer 'Ställ in hem'");
    await t3.ctx.close();
  }


  // ---------- 7. usability test fixes (ds39) ----------
  {
    const t = await setup(browser, { ikv: "ute" });
    const p = t.page;
    await H.clickJS(p, "#btn-more"); await wait(p, 900);
    const mer = await p.evaluate(() => ({ h: !!document.querySelector("#sheet-body .pn-safe-h"), rows: [...document.querySelectorAll("#sheet-body .pn-safe .ds-row-t > span")].map((x) => x.textContent) }));
    ok(mer.h && mer.rows.includes("Följ mig hem") && mer.rows.includes("Hämta mig"), "Mer på kartan: 'Säker hem' with Följ mig hem + Hämta mig " + JSON.stringify(mer));
    await p.evaluate(() => { const r = [...document.querySelectorAll("#sheet-body .pn-safe .ds-row")].find((x) => /Följ mig hem/.test(x.textContent)); r.click(); }); await wait(p, 1200);
    const fm = await p.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, save: !![...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemadress/.test(b.textContent)) }));
    ok(/Följ mig hem/.test(fm.title) && fm.save, "Säker hem → Följ mig hem sheet (no home yet: 'Spara hemadress') " + JSON.stringify(fm));
    await p.evaluate(() => [...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemadress/.test(b.textContent)).click()); await wait(p, 1500);
    const hz = await p.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, q: !!document.querySelector("#sheet-body .hz-q"), pin: document.querySelectorAll("#sheet-body .hz-map path.leaflet-interactive, #sheet-body .hz-map svg path, #sheet-body .hz-map .leaflet-overlay-pane *").length, gps: !![...document.querySelectorAll("#sheet-body button")].find((b) => /nuvarande plats/.test(b.textContent)) }));
    ok(/Hemzon/.test(hz.title) && hz.q && hz.gps, "Hemzon: address search + 'Använd nuvarande plats' " + JSON.stringify(hz));
    ok(hz.pin > 0, "Hemzon: a pin shows at once (the map centre), before any tap (" + hz.pin + ")");
    await p.evaluate(() => [...document.querySelectorAll("#sheet-body button")].find((b) => /Spara hemzonen/.test(b.textContent)).click()); await wait(p, 1500);
    const back = await p.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, home: !!localStorage.getItem("olnu.home") }));
    ok(back.open && /Följ mig hem/.test(back.title) && back.home, "Hemzon: after Spara you are back in Följ mig hem (no dead end) " + JSON.stringify(back));
    await H.closeSheet(p); await wait(p, 500);
    // shape, not colour: my dot, MEDEVAC
    const sh = await p.evaluate(() => { const d = document.createElement("div"); d.className = "me-dot"; document.body.appendChild(d); const a = getComputedStyle(d).boxShadow; d.remove();
      const q = document.createElement("div"); q.className = "pill p2"; document.body.appendChild(q); const o = getComputedStyle(q).outlineStyle; q.remove(); return { me: (a.match(/rgb\(255, 255, 255\)/g) || []).length, p2: o }; });
    ok(sh.me >= 1 && sh.p2 === "dashed", "not colour only: my dot = target (outer white ring), MEDEVAC = dashed ring " + JSON.stringify(sh));
    // 44 px hit area on map chips
    const hitA = await p.evaluate(() => { const d = document.createElement("div"); d.className = "ap-pin"; d.style.cssText = "position:fixed;left:100px;top:300px;width:28px;height:22px"; document.body.appendChild(d); const s = getComputedStyle(d, "::after"); const r = [s.width, s.height]; d.remove(); return r; });
    ok(parseFloat(hitA[0]) >= 44 && parseFloat(hitA[1]) >= 44, "map chips: 28 × 22 arena chip gets a ≥ 44 px hit area " + JSON.stringify(hitA));
    // 130 % text: ÖL! and Annat stay inside
    await p.evaluate(() => { document.documentElement.style.fontSize = "130%"; }); await wait(p, 600);
    const big = await p.evaluate(() => { const f = (b, l) => { const r = b.getBoundingClientRect(), q = l.getBoundingClientRect(); return q.width <= r.width - 4 && q.left >= r.left && q.right <= r.right; };
      return { ol: f(document.getElementById("btn-beer"), document.getElementById("beer-label")), an: f(document.getElementById("btn-other"), document.querySelector("#btn-other .ol-t")) }; });
    ok(big.ol && big.an, "130 % text size: ÖL! and Annat stay inside their circles " + JSON.stringify(big));
    await p.screenshot({ path: SP + "fxm-shots/t-text130-390.png" });
    await p.evaluate(() => { document.documentElement.style.fontSize = ""; });
    // no data in view → one caption
    await p.evaluate(() => window.PNSTART && window.PNSTART.calm()); await wait(p, 300);
    await p.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); window.PNDS._A().map.setView([59.3326, 18.0649], 15, { animate: false }); /* the app map: window.__map = the last L.map made (the Hemzon mini map here) */ }); await wait(p, 3500);
    const nd = await p.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    const ndWhy = /Ingen data här ikväll/.test(nd) ? "" : JSON.stringify(await p.evaluate(() => { const A = window.PNDS && window.PNDS._A && window.PNDS._A(), m = A.map;
      return { z: m.getZoom(), sheet: !document.getElementById("sheet").hidden, live: !!(A && A.LIVE), beers: A && A.beers ? (A.beers() || []).filter((x) => m.getBounds().contains([x.lat, x.lng])).length : null, calm: window.__pnCalm, cs: window.CALM && window.CALM._state ? window.CALM._state() : null }; }));
    ok(/Ingen data här ikväll/.test(nd), "no crowd data in view (Stockholm) → 'Ingen data här ikväll än' (" + nd.slice(0, 90) + ") " + ndWhy.slice(0, 600));
    await p.screenshot({ path: SP + "fxm-shots/t-nodata-sthlm-390.png" });
    // ds41: at zone zoom (html[data-zones]) people pins + clusters are not drawn (friends are in the zone pills)
    await p.evaluate(() => window.PNDS._A().map.setView([60.1505, 15.1872], 15, { animate: false })); await wait(p, 2500);   // back where the friends are
    const zh = await p.evaluate(() => { const pins = [...document.querySelectorAll(".leaflet-marker-icon:has(>.pn-p), .olnu-cl")]; const vis0 = pins.filter((e) => getComputedStyle(e).display !== "none").length;
      document.documentElement.setAttribute("data-zones", ""); const vis1 = pins.filter((e) => getComputedStyle(e).display !== "none").length; document.documentElement.removeAttribute("data-zones"); return { n: pins.length, vis0, vis1 }; });
    ok(zh.n > 0 && zh.vis0 > 0 && zh.vis1 === 0, "zone zoom: no people pin / cluster is drawn over the zone pills " + JSON.stringify(zh));
    await t.ctx.close();
  }

  // ---------- 8. ux3 (ds42): Synlighet, ÖL! without GPS, iPhone note, splash text ----------
  {
    const t = await setup(browser, { ikv: "ute", ua: "ios" });
    const p = t.page;
    await p.evaluate(() => document.getElementById("pn-ghost").click()); await wait(p, 800);
    const v = await p.evaluate(() => { const m = document.getElementById("pn-vis"); return m ? { opts: [...m.querySelectorAll("[role=radio]")].map((b) => b.textContent.trim()), on: (m.querySelector('[aria-checked="true"]') || {}).textContent, note: (m.querySelector(".pn-vis-note") || {}).textContent } : null; });
    ok(v && v.opts.join("|") === "Alla|Bara vänner|Spöke" && v.on === "Alla" && v.note, "Synlighet: one control Alla · Bara vänner · Spöke, state + one line " + JSON.stringify(v));
    await p.screenshot({ path: SP + "fxm-shots/t-synlighet-390.png" });
    await p.evaluate(() => document.querySelector('#pn-vis [data-vis="vanner"]').click()); await wait(p, 800);
    ok(calls(t.srv, "set_visibility").some((c) => c.body.p_friends_only === true) && (await p.evaluate(() => document.getElementById("pn-ghost").getAttribute("data-vis"))) === "vanner", "Synlighet: Bara vänner → set_visibility(true), the button shows it");
    await p.evaluate(() => document.querySelector('#pn-vis [data-vis="spoke"]').click()); await wait(p, 500);
    ok(await p.evaluate(() => localStorage.getItem("olnu.ghostMode") === "1"), "Synlighet: Spöke = the existing spökläge (olnu.ghostMode)");
    await p.evaluate(() => document.querySelector('#pn-vis [data-vis="alla"]').click()); await wait(p, 400); await p.keyboard.press("Escape");
    // Följ mig hem on iPhone
    await p.evaluate(() => window.HEMFOLJ.open({})); await wait(p, 1000);
    ok(await p.evaluate(() => !!document.querySelector("#sheet-body .hf-ios") && /håll skärmen på/.test(document.querySelector("#sheet-body .hf-ios").textContent)), "Följ mig hem (iPhone): 'håll skärmen på' note up front");
    await H.closeSheet(p); await wait(p, 400);
    // ÖL! without GPS: the browser denies the position
    await t.ctx.clearPermissions(); await p.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, bad) => setTimeout(() => bad({ code: 1, message: "denied" }), 50); localStorage.removeItem("olnu.checkin"); localStorage.setItem("olnu.night", JSON.stringify({ count: 6, expires: Date.now() + 3600e3, lastTap: Date.now() - 3600e3 })); });
    await p.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((x) => x.remove()));
    await p.evaluate(() => document.getElementById("btn-beer").click()); await wait(p, 1200);
    const tb = await p.evaluate(() => [...document.querySelectorAll("#toasts .toast button")].map((b) => b.textContent));
    ok(tb.some((x) => /Räkna ölen ändå/.test(x)), "ÖL! without GPS: the toast offers 'Räkna ölen ändå' " + JSON.stringify(tb));
    await p.evaluate(() => { const b = [...document.querySelectorAll("#toasts .toast button")].find((x) => /Räkna ölen ändå/.test(x.textContent)); if (b) b.click(); }); await wait(p, 2500);
    const pb = calls(t.srv, "post_beer_v2").pop();
    ok(pb && pb.body.p_hidden === true, "ÖL! without GPS: posted with NO pin (p_hidden) " + JSON.stringify(pb && pb.body));
    await t.ctx.close();
    const html = await (await fetch("http://127.0.0.1:" + process.argv[2] + "/index.html")).text();
    ok(/id="pn-splash"[^]*Laddar PintsNow…/.test(html), "start: static 'Laddar PintsNow…' in index.html");
  }
  // ---------- 6. calm start ----------
  {
    const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
    await ctx.addInitScript(() => { window.__ls = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__ls.push([Math.round(e.startTime), e.value]); })).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
      window.__sp0 = null; const mo = new MutationObserver(() => { if (window.__sp0 == null && document.getElementById("pn-splash")) window.__sp0 = Math.round(performance.now()); }); mo.observe(document, { childList: true, subtree: true }); });
    await page.goto("http://127.0.0.1:" + process.argv[2] + "/");
    await page.waitForFunction(() => window.__pnSplashGone, null, { timeout: 8000 }).catch(() => {});
    await wait(page, 2500);
    const s = await page.evaluate(() => ({ first: window.__sp0, gone: window.__pnSplashGone, left: !!document.getElementById("pn-splash"), calm: !!window.__pnCalm, cls: window.__ls.filter((x) => x[0] > (window.__pnSplashGone || 0) + 300).reduce((a, x) => a + x[1], 0),
      pe: getComputedStyle(document.documentElement).getPropertyValue("--x") }));
    ok(s.first != null && s.first < 400, "start: the splash is in the first frame (parsed at " + s.first + " ms)");
    ok(s.gone && s.gone <= 3200 && !s.left, "start: the splash fades away when the map has painted (" + s.gone + " ms) and is removed");
    ok(s.calm, "start: 'pn:calm' fired (heavy work after the start)");
    ok(s.cls < 0.02, "start: layout shift after the splash < 0.02 (" + s.cls.toFixed(4) + ")");
    await ctx.close();
  }
  console.log("RESULT pass " + pass + " fail " + fail);
  await browser.close();
})();
