// lane ridechip (owner I-124, 15 Nov): "you click out of it and the menu's gone". Mocked server (the ride-pw.js model, cut down).
// Usage: node ridechip-pw.js <port>. Every check FAILS on 60093c5 (big-update: the ride chip is only inside the closed HUD
// panel, so nothing shows on the map) and PASSES with the lane.
// 1 after Skicka + close: a status chip #rd-stat next to the Ikväll drop-down, 44 px, not over Ikväll / ticker / top bar / rail
// 2 tap the chip → the ride sheet at the current state · 3 accept while another sheet is open → the ride sheet waits, then
// opens by itself ONCE · 4 På väg · N min (driver.eta_min) / Framme · 5 reload → the chip comes back, no second auto-open
// · 6 the driver: "Du kör · Lisa" · 7 done / cancel → no chip · 8 360x640 placement · 9 reduced motion: no pulse.
// Pictures: <OUT>/ridechip-shots/.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const OUT = require("./env.js").OUT + "ridechip-shots/";
require("fs").mkdirSync(OUT, { recursive: true });
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 500)); c ? pass++ : fail++; };
const PK = { lat: 60.14997, lng: 15.18679 };

/* ---------- the server model (the ride-pw.js rules, rider / taker / asked views) ---------- */
const NAMES = { R: "Lisa", D1: "Oskar" };
function Srv() { this.rides = []; this.calls = []; this.seq = 300; }
Srv.prototype.mk = function (o) {
  const t = Date.now(), r = Object.assign({ id: ++this.seq, rider: "R", to: ["D1"], status: "open", taker: null, ended: false, created: t, opened: t, taken: null,
    pax: 1, note: null, place: "Pitchers", step_at: { open: new Date(t).toISOString() }, declined: [], excluded: [], round: 1, msgs: [], drv: null }, o || {});
  this.rides.push(r); return r;
};
Srv.prototype.view = function (r, who) {
  const iso = (x) => x == null ? null : new Date(x).toISOString();
  const live = !r.ended && ["open", "taken", "enroute", "arrived"].includes(r.status), moving = live && r.status !== "open";
  const role = who === r.rider ? "rider" : who === r.taker ? "taker" : "asked";
  const v = { id: r.id, role, status: r.status, live, created_at: iso(r.created), opened_at: iso(r.opened), taken_at: iso(r.taken), ended_at: r.ended ? iso(Date.now()) : null,
    step_at: r.step_at, pax: r.pax, note: r.note, place: r.place, n: r.to.length, declined_n: r.declined.length, wide: false, again: false, round: r.round, thanks: false,
    taker_name: r.taker ? NAMES[r.taker] : null };
  if (role !== "asked") v.msgs = [];
  if (role === "rider" && r.taker) v.driver = { name: NAMES[r.taker], car: "Röd Volvo V70", avatar: null, lat: moving && r.drv ? r.drv.lat : null, lng: moving && r.drv ? r.drv.lng : null,
    pos_at: moving && r.drv ? iso(r.drv.at) : null, dist_m: moving && r.drv ? 1200 : null, eta_min: moving && r.drv ? 3 : null };   // 0495: eta_min only with a driver position
  if (role === "taker") Object.assign(v, { rider: { name: NAMES[r.rider], avatar: null }, pk_lat: live ? PK.lat : null, pk_lng: live ? PK.lng : null, dist_m: moving ? 1200 : null });
  if (role === "asked") Object.assign(v, { name: NAMES[r.rider], dist_m: 1200, my_declined: false, excluded: false, can_take: live && r.status === "open" });
  return v;
};
Srv.prototype.rpc = function (fn, b, who) {
  this.calls.push([fn, who, b]);
  const r = b && b.p_id != null ? this.rides.find((x) => x.id === +b.p_id) : null;
  const now = new Date().toISOString();
  switch (fn) {
    case "ride_flags_get": return { ride_v2: true, ride_v2_more: true };
    case "ride_poll": {
      const mine = this.rides.filter((x) => x.rider === who).slice(-1)[0], drive = this.rides.filter((x) => x.taker === who).slice(-1)[0];
      return { v: 1, now, driving: who !== "R", incoming: [], mine: null, ride: { v: 1, on: true, more: true, now, mine: mine ? this.view(mine, who) : null, drive: drive ? this.view(drive, who) : null,
        offers: this.rides.filter((x) => x.to.includes(who) && x.rider !== who && x.taker !== who).map((x) => this.view(x, who)), drinking: false, car: null, chauffeur: 0 } };
    }
    case "ride_stamp_get": return { on: true, s: String(Math.random()) };   // always "changed": every tick runs the full poll
    case "pickup_poll": return { v: 1, driving: who !== "R", incoming: [], mine: null };
    case "ride_request3": case "ride_request": { const x = this.mk({ pax: b.p_pax, note: b.p_note }); return this.view(x, who); }
    case "ride_take": if (r.status === "open") { r.status = "taken"; r.taker = who; r.taken = Date.now(); r.step_at.taken = now; return { ok: true, ride: this.view(r, who) }; } return { ok: false, code: "taken" };
    case "ride_cancel": if (who === r.rider) { r.status = "cancelled"; r.ended = true; } return this.view(r, who);
    case "ride_pos": r.drv = { lat: b.p_lat, lng: b.p_lng, at: Date.now() }; return { ok: true, live: true, status: r.status };
    case "ride_step": r.status = b.p_step; r.step_at[b.p_step] = now; if (b.p_step === "done") r.ended = true; return this.view(r, who);
  }
  return undefined;
};
async function page(browser, srv, who, vp, o) {
  const { ctx, page } = await ctxFor(browser, vp || { width: 390, height: 844 }, o || {});
  page.__errs = []; page.on("pageerror", (e) => page.__errs.push(e.message)); page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.route(/rest\/v1\/rpc\/(ride_\w+|pickup_poll)\b/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const a = srv.rpc(fn, b, who); return a === undefined ? r.fallback() : J(r, a);
  });
  await page.route(/functions\/v1\/notify-group/, (r) => J(r, { sent: 1 }));
  await boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const force = (p) => p.evaluate(() => window.SKJUTS && window.SKJUTS._force && window.SKJUTS._force()).then(() => wait(p, 600));
const sheet = (p) => p.evaluate(() => { const s = document.getElementById("sheet"); return { open: !!s && !s.hidden, title: (document.getElementById("sheet-title") || {}).textContent || "",
  text: ((document.getElementById("sheet-body") || {}).textContent || "").replace(/\s+/g, " ").slice(0, 300) }; });
const close = async (p) => { await p.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); }); await wait(p, 700); };
// the chip as the user sees it: visible, text, aria, box, and what it overlaps
const chip = (p) => p.evaluate(() => {
  const c = document.getElementById("rd-stat"), vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none";
  if (!vis(c)) return { vis: false, inPanel: (document.getElementById("hud-x") || {}).innerHTML ? /rd-chip/.test(document.getElementById("hud-x").innerHTML) : false };
  const b = c.getBoundingClientRect(), hit = (e) => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); return !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom); };
  const over = [["ikv", "#pn-ikv2"], ["ticker", ".ticker"], ["topbar", ".topbar"], ["rail", ".pn-rail"], ["locate", "#btn-locate"], ["top", "#btn-top"], ["settings", "#btn-settings"]]
    .filter(([, s]) => [...document.querySelectorAll(s)].some(hit)).map(([n]) => n);
  const ikv = document.getElementById("pn-ikv2"), ir = ikv && vis(ikv) ? ikv.getBoundingClientRect() : null;
  const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  const u = [...document.querySelectorAll(".hud-x .hx-urgent")].find(vis), ub = u ? u.getBoundingClientRect() : null, rail = [...document.querySelectorAll(".pn-rail")].filter(vis)
    .reduce((m, e) => Math.min(m, e.getBoundingClientRect().left), innerWidth);
  const tx = c.querySelector(".rd-stat-t");
  return { vis: true, text: (tx || c).textContent.trim(), full: !!tx && vis(tx) && tx.scrollWidth <= tx.clientWidth + 1, shown: c.innerText.replace(/\s+/g, " ").trim(),
    urg: ub ? { text: u.textContent.trim().slice(0, 30), top: Math.round(ub.top), l: Math.round(ub.left), r: Math.round(ub.right), oneRow: Math.abs(ub.top - b.top) < 4 && ub.left >= b.right,
      clear: ub.right <= rail } : null, rail: Math.round(rail), aria: c.getAttribute("aria-label") || "", k: c.getAttribute("data-k"), h: Math.round(b.height), w: Math.round(b.width),
    l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), iw: innerWidth, over, nextToIkv: !!ir && Math.abs(ir.top - b.top) < 4 && b.left >= ir.right && b.left - ir.right <= 16,
    onTop: !!top && (top === c || c.contains(top)), anim: getComputedStyle(c.querySelector(".rd-stat-d") || c).animationName, sw: document.documentElement.scrollWidth };
});
// the seeded data shows an urgent HUD chip ("Kolla till Oskar"); take it out to see the full ride chip (app-hud.js only
// rewrites #hud-x when its html changes, so it stays out until the next HUD change)
const noUrgent = (p) => p.evaluate(() => document.querySelectorAll(".hud-x .hx-urgent").forEach((e) => e.remove())).then(() => wait(p, 300));
const pics = [];
async function pic(p, name) { const f = OUT + name + ".png"; await p.screenshot({ path: f }); pics.push(f); }

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    const srv = new Srv();
    const R = await page(browser, srv, "R");
    let c = await chip(R.page);
    ok("I-124 no chip before a request", !c.vis, c);

    /* ---------- 1 request, close the sheet: the chip stays ---------- */
    await R.page.evaluate(() => window.SKJUTS.openPickup({})); await wait(R.page, 1500);
    await R.page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => x.getClientRects().length && /^Skicka$/.test(x.textContent.trim())); if (b) b.click(); });
    await wait(R.page, 1500);
    const ride = srv.rides[0] || srv.mk();   // old code without a request still runs the rest (and fails there)
    await close(R.page); await R.page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    c = await chip(R.page);
    ok("I-124-1 after Skicka + closing the sheet: a chip 'Väntar på skjuts' on the map", c.vis && c.text === "Väntar på skjuts" && c.k === "wait", c);
    ok("I-124-1 aria-label says what it is and that a tap opens it", /Hämta mig: väntar på skjuts\. Öppna\./.test(c.aria || ""), c.aria);
    ok("I-124-1 44 px tall, right after the Ikväll drop-down, on top, covers nothing (Ikväll, ticker, top bar, rail, locate)",
      c.vis && c.h >= 44 && c.w >= 44 && c.nextToIkv && c.onTop && c.over.length === 0 && c.r <= c.rail && c.sw <= c.iw, c);
    if (c.urg) {
      ok("I-124-1 with an urgent HUD chip ('" + c.urg.text + "'): ONE row (Ikväll · ride · urgent), the urgent chip stays left of the rail, ride chip compact",
        c.urg.oneRow && c.urg.clear && !c.full, c);
      await pic(R.page, "1-wait-with-urgent-chip-390");
    } else console.log("note: no urgent HUD chip in this run (one-row check skipped)");
    await noUrgent(R.page); c = await chip(R.page);
    ok("I-124-1 without an urgent chip: the full text 'Väntar på skjuts' shows", c.vis && c.full && c.shown === "Väntar på skjuts", c);
    await pic(R.page, "1-wait-390");

    /* ---------- 2 tap the chip → the ride sheet at the current state ---------- */
    await R.page.click("#rd-stat", { timeout: 3000 }).catch(() => {}); await wait(R.page, 900);
    let s = await sheet(R.page);
    ok("I-124-2 tap the chip → the ride sheet 'Hämta mig' with 'Väntar på chaufför' + Avbryt", s.open && s.title === "Hämta mig" && /Väntar på chaufför/.test(s.text) && /Avbryt förfrågan/.test(s.text), s);
    await pic(R.page, "2-sheet-from-chip-390");
    await close(R.page);
    ok("I-124-2 the chip is still there after closing again", (await chip(R.page)).vis);

    /* ---------- 3 accept while ANOTHER sheet is open: wait, then open once ---------- */
    await R.page.evaluate(() => window.PN && window.PN.openSheet ? window.PN.openSheet("Test", (b) => { b.textContent = "annat blad"; }) : document.getElementById("btn-settings").click());
    await wait(R.page, 900);
    const other = await sheet(R.page);
    ride.status = "taken"; ride.taker = "D1"; ride.taken = Date.now(); ride.step_at.taken = new Date().toISOString();
    await force(R.page); await wait(R.page, 1300);
    s = await sheet(R.page);
    ok("I-124-3 accept while another sheet is open → that sheet stays (no ride sheet over it)", other.open && s.open && s.title === other.title && s.title !== "Hämta mig", { other, s });
    c = await chip(R.page);
    ok("I-124-3 chip 'Accepterad · Oskar' (green state)", c.vis && c.text === "Accepterad · Oskar" && c.k === "taken" && /Oskar har accepterat/.test(c.aria), c);
    await close(R.page); await wait(R.page, 1500);
    s = await sheet(R.page);
    ok("I-124-3 the other sheet closed → the ride sheet opens by itself: 'Oskar tar dig!'", s.open && s.title === "Hämta mig" && /Oskar tar dig!/.test(s.text), s);
    await pic(R.page, "3-auto-open-on-accept-390");
    await close(R.page); await force(R.page); await wait(R.page, 1500);
    s = await sheet(R.page);
    ok("I-124-3 it opens only ONCE: closed again → stays closed (polls + 1 s timer)", !s.open, s);
    await noUrgent(R.page); await pic(R.page, "3-accepted-chip-390");

    /* ---------- 4 På väg · N min, Framme ---------- */
    ride.status = "enroute"; ride.step_at.enroute = new Date().toISOString(); ride.drv = { lat: 60.1440, lng: 15.1890, at: Date.now() };
    await force(R.page);
    c = await chip(R.page);
    ok("I-124-4 enroute + driver position → 'På väg · 3 min' (driver.eta_min)", c.vis && c.text === "På väg · 3 min" && /ca 3 min bort/.test(c.aria), c);
    if (c.urg) ok("I-124-4 compact chip (urgent chip on) still shows '3 min'", c.shown === "3 min", c.shown);
    await noUrgent(R.page); await pic(R.page, "4-enroute-390");
    ride.drv = null; await force(R.page);
    c = await chip(R.page);
    ok("I-124-4 enroute without a position (no eta_min) → 'På väg'", c.vis && c.text === "På väg", c);
    ride.status = "arrived"; ride.step_at.arrived = new Date().toISOString(); await force(R.page);
    c = await chip(R.page);
    ok("I-124-4 arrived → 'Framme'", c.vis && c.text === "Framme" && /Oskar ä framme/.test(c.aria), c);
    await noUrgent(R.page); await pic(R.page, "4-arrived-390");

    /* ---------- 5 reload: the chip comes back from the server, no second auto-open ---------- */
    await boot(R.page); await wait(R.page, 2500);
    c = await chip(R.page); s = await sheet(R.page);
    ok("I-124-5 after an app reload the chip comes back ('Framme')", c.vis && c.text === "Framme", c);
    ok("I-124-5 after the reload the sheet does not open again (already shown once)", !s.open, s);

    /* ---------- 6 the driver: "Du kör · Lisa" after closing the sheet ---------- */
    const D = await page(browser, srv, "D1");
    await force(D.page); await D.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride.id); await wait(D.page, 800);
    await close(D.page);
    c = await chip(D.page);
    ok("I-124-6 driver: the sheet closed → chip 'Du kör · Lisa'", c.vis && c.text === "Du kör · Lisa" && c.k === "drive" && /Du kör Lisa/.test(c.aria) && c.h >= 44 && c.over.length === 0, c);
    await noUrgent(D.page); await pic(D.page, "6-driver-390");
    await D.page.click("#rd-stat", { timeout: 3000 }).catch(() => {}); await wait(D.page, 900);
    s = await sheet(D.page);
    ok("I-124-6 driver: tap the chip → 'Du kör' sheet", s.open && s.title === "Du kör", s);
    await close(D.page);

    /* ---------- 7 done → no chip (both); cancel → no chip ---------- */
    ride.status = "done"; ride.ended = true; ride.step_at.done = new Date().toISOString();
    await force(R.page); await force(D.page);
    ok("I-124-7 done → the rider chip goes away", !(await chip(R.page)).vis);
    ok("I-124-7 done → the driver chip goes away", !(await chip(D.page)).vis);
    const r2 = srv.mk({ rider: "R" }); await force(R.page);
    ok("I-124-7 a new request → 'Väntar på skjuts' again", (await chip(R.page)).text === "Väntar på skjuts");
    await R.page.click("#rd-stat", { timeout: 3000 }).catch(() => {}); await wait(R.page, 900);
    await R.page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => x.getClientRects().length && /Avbryt förfrågan/.test(x.textContent)); if (b) b.click(); });
    await wait(R.page, 1200); await close(R.page); await force(R.page);
    ok("I-124-7 Avbryt förfrågan → ride_cancel and the chip goes away", srv.calls.some((x) => x[0] === "ride_cancel" && +x[2].p_id === r2.id) && !(await chip(R.page)).vis, srv.calls.filter((x) => x[0] === "ride_cancel"));
    ok("I-124 no page errors", R.page.__errs.length === 0 && D.page.__errs.length === 0, R.page.__errs.concat(D.page.__errs));
    await D.ctx.close();

    /* ---------- 8 small phone 360x640 + 9 reduced motion ---------- */
    const r3 = srv.mk({ rider: "R" }); r3.status = "taken"; r3.taker = "D1"; r3.taken = Date.now();
    NAMES.D1 = "Maximiliana-Charlotta";   // a long name: ellipsis, never over the rail
    const Q = await page(browser, srv, "R", { width: 360, height: 640 }, { reduced: true });
    await force(Q.page); await wait(Q.page, 1200); await close(Q.page);
    c = await chip(Q.page);
    ok("I-124-8 360x640: chip visible, 44 px, next to Ikväll, covers nothing, no sideways scroll", c.vis && c.h >= 44 && c.w >= 44 && c.nextToIkv && c.over.length === 0 && c.onTop && c.sw <= c.iw && c.r <= c.rail, c);
    if (c.urg) ok("I-124-8 360x640 with the urgent chip: one row, urgent chip left of the rail", c.urg.oneRow && c.urg.clear, c);
    await pic(Q.page, "8-360x640-with-urgent-chip");
    await noUrgent(Q.page); c = await chip(Q.page);
    ok("I-124-8 360x640 long name: one row, ends with … before the rail", c.vis && c.nextToIkv && c.r <= c.rail && c.over.length === 0 && c.sw <= c.iw, c);
    ok("I-124-9 reduced motion: no pulse on the chip", c.vis && c.anim === "none", c.anim);
    await pic(Q.page, "8-360x640-long-name");
    await Q.ctx.close(); await R.ctx.close();
  } catch (e) { console.log("ERROR", e && e.stack || e); fail++; }
  finally { await browser.close(); }
  console.log("pictures:", pics.join(" "));
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
