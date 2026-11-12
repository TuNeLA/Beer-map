// lane ride3 (ride v3, migration 0495) — two users (rider Lisa + driver Oskar) on a mocked server with the 0495 rules,
// FAKE CLOCK (page.clock) for every "the other phone sees it within 3 s" check: the watching phone is paused, the other one
// acts, then the watching phone runs exactly 3 s of timers (clock.runFor(3000)) and must show the change.
// Usage: node ride3-pw.js <port>. Every "R3" check FAILS on e9ba569/9339e94 (ride v2: 10 s fast poll, 45 s idle poll, no
// destination, one chat list, rider "Jag sitter i bilen" = done, 112 link, 10-min flag cache) and PASSES with ride3.
// Flow: request with destination (search + Hem) → the idle driver sees the offer (area + trip) ≤ 6 s → take → På väg →
// Jag är här → rider "Jag sitter i bilen" → Framme vid målet, each seen by the other phone ≤ 3 s · role chats + toast +
// read-aloud · Ring = consent, the number only after Ja · poll windows (live 2.5 s, idle driver 5 s stamp, nothing open =
// slow, busy = none) · flag OFF→ON reaches the app ≤ 65 s · no 112 on ride sheets · 390 px shots → <OUT>/ride3-shots/.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const OUT = require("./env.js").OUT + "ride3-shots/";
require("fs").mkdirSync(OUT, { recursive: true });
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 500)); c ? pass++ : fail++; };
const HOME = { lat: 60.1640, lng: 15.2050 }, PK = { lat: 60.1511, lng: 15.1876 };
const hav = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(x))); };

/* ---------- the server model (0420 + 0495 rules) ---------- */
const NAMES = { R: "Lisa", D1: "Oskar" }, CAR = { D1: "Röd Volvo V70 · ABC 123" };
function Srv() { this.flags = { ride_v2: true, ride_v2_more: true }; this.rides = []; this.calls = []; this.push = []; this.seq = 300; this.awards = { D1: 1 }; this.ccalls = []; this.msgSeq = 0; this.lask = {}; this.laskN = {}; this.driving = { D1: true }; }
Srv.prototype.mk = function (o) {
  const t = Date.now(), r = Object.assign({ id: ++this.seq, rider: "R", to: ["D1"], status: "open", taker: null, ended: false, created: t, opened: t, taken: null,
    pax: 1, note: null, place: "Pitchers", step_at: { open: new Date(t).toISOString() }, declined: [], excluded: [], round: 1, thanks: false, msgs: [], drv: null, dest: null }, o || {});
  this.rides.push(r); return r;
};
Srv.prototype.callJson = function (r, who, live) {
  const other = who === r.rider ? r.taker : r.rider; if (!other || !r.taker) return null;
  const mine = this.ccalls.filter((c) => c.req === r.id && c.from === who), o = mine.slice(-1)[0];
  const i = this.ccalls.filter((c) => c.req === r.id && c.from === other && c.to === who && !c.answer).slice(-1)[0];
  const y = mine.filter((c) => c.answer === "yes" && c.phone).slice(-1)[0];
  return { n_out: mine.length, out: o ? { id: o.id, at: o.at, answer: o.answer || null } : null, in: i && live ? { id: i.id, at: i.at, saved: false } : null, tel: live && y ? y.phone : null };
};
Srv.prototype.view = function (r, who) {
  const iso = (x) => x == null ? null : new Date(x).toISOString();
  const live = !r.ended && ["open", "taken", "enroute", "arrived"].includes(r.status), moving = live && r.status !== "open";
  const role = who === r.rider ? "rider" : who === r.taker ? "taker" : "asked";
  const trip = r.dest ? Math.round(1.3 * hav(PK.lat, PK.lng, r.dest.lat, r.dest.lng)) : null, tmin = trip ? Math.max(1, Math.ceil(trip / (trip < 4000 ? 500 : 900))) : null;
  const dest = !r.dest ? null : role === "rider" ? Object.assign({ trip_m: trip, trip_min: tmin }, r.dest)
    : role === "taker" ? { kind: r.dest.kind, name: r.dest.name, area: r.dest.area, lat: live ? r.dest.lat : null, lng: live ? r.dest.lng : null, trip_m: trip, trip_min: tmin }
    : { kind: r.dest.kind, area: r.dest.area, trip_m: trip, trip_min: tmin };
  const v = { id: r.id, role, status: r.status, live, created_at: iso(r.created), opened_at: iso(r.opened), taken_at: iso(r.taken), ended_at: r.ended ? iso(Date.now()) : null,
    step_at: r.step_at, pax: r.pax, note: r.note, place: r.place, n: r.to.length, declined_n: r.declined.length, wide: false, again: false, round: r.round, thanks: r.thanks,
    taker_name: r.taker ? NAMES[r.taker] : null, dest, v3: true };
  if (role !== "asked") { v.msgs = r.msgs.map((m) => ({ id: m.id, me: m.from === who, body: m.body, at: iso(m.at) })); v.call = this.callJson(r, who, live); }
  if (role === "rider") Object.assign(v, { pk_lat: live ? PK.lat : null, pk_lng: live ? PK.lng : null });
  if (role === "rider" && r.taker) v.driver = { name: NAMES[r.taker], car: CAR[r.taker], avatar: null, lat: moving && r.drv ? r.drv.lat : null, lng: moving && r.drv ? r.drv.lng : null,
    pos_at: moving && r.drv ? iso(r.drv.at) : null, dist_m: moving && r.drv ? 1200 : null, eta_min: moving && r.drv ? 3 : null };
  if (role === "taker") Object.assign(v, { rider: { name: NAMES[r.rider], avatar: null }, pk_lat: live ? PK.lat : null, pk_lng: live ? PK.lng : null, dist_m: moving ? 1200 : null });
  if (role === "asked") Object.assign(v, { name: NAMES[r.rider], dist_m: 1200, drv_min: 3, my_declined: r.declined.includes(who), excluded: r.excluded.includes(who), can_take: live && r.status === "open" });
  return v;
};
Srv.prototype.poll = function (who) {
  const p = { v: 1, now: new Date().toISOString(), driving: !!this.driving[who], incoming: [], mine: null };
  if (!this.flags.ride_v2) return Object.assign(p, { ride: { v: 1, on: false } });
  const mine = this.rides.filter((r) => r.rider === who).slice(-1)[0], drive = this.rides.filter((r) => r.taker === who).slice(-1)[0];
  return Object.assign(p, { ride: { v: 1, on: true, more: true, now: p.now, mine: mine ? this.view(mine, who) : null, drive: drive ? this.view(drive, who) : null,
    offers: this.rides.filter((r) => r.to.includes(who) && r.rider !== who && r.taker !== who).map((r) => this.view(r, who)), drinking: false, car: CAR[who] || null, chauffeur: this.awards[who] || 0 } });
};
Srv.prototype.stamp = function (who) {
  if (!this.flags.ride_v2) return { on: false };
  const rows = this.rides.filter((r) => r.rider === who || r.taker === who || r.to.includes(who))
    .map((r) => [r.id, r.status, r.round, r.taker, r.ended, r.declined.length, JSON.stringify(r.step_at), r.msgs.length, r.rider === who && r.drv ? r.drv.at : 0, this.ccalls.filter((c) => c.req === r.id).map((c) => c.id + (c.answer || "")).join()].join(":"));
  return { on: true, s: rows.join(",") || "-", n: rows.length, now: new Date().toISOString() };
};
Srv.prototype.rpc = function (fn, b, who) {
  this.calls.push([fn, who, b, Date.now()]);
  const r = b && b.p_id != null ? this.rides.find((x) => x.id === +b.p_id) : null;
  const order = (v) => Object.assign(v, { code: "order" });
  switch (fn) {
    case "ride_flags_get": return this.flags;
    case "ride_poll": return this.poll(who);
    case "ride_stamp_get": return this.stamp(who);
    case "pickup_poll": return { v: 1, driving: !!this.driving[who], incoming: [], mine: null };
    case "driver_set": this.driving[who] = !!b.p_on; return { ok: true, on: !!b.p_on };
    case "ride_request": { const x = this.mk({ pax: b.p_pax, note: b.p_note, place: b.p_place || null }); return this.view(x, who); }
    case "ride_request2": { const x = this.mk({ pax: b.p_pax, note: b.p_note, place: b.p_place || null,
      dest: b.p_dest_lat != null ? { kind: b.p_dest_kind, name: b.p_dest_name, area: b.p_dest_area, lat: b.p_dest_lat, lng: b.p_dest_lng } : null }); return this.view(x, who); }
    case "ride_take":
      if (r.status === "open" && !r.taker && !r.ended) { r.status = "taken"; r.taker = who; r.taken = Date.now(); r.step_at.taken = new Date().toISOString(); return { ok: true, ride: this.view(r, who) }; }
      return r.taker ? { ok: false, code: "taken", name: NAMES[r.taker] } : { ok: false, code: "ended" };
    case "ride_decline": if (!r.declined.includes(who)) r.declined.push(who); return this.view(r, who);
    case "ride_step": {   // 0495: the driver owns the steps; rider 'done' = 'picked'; wrong order = unchanged + code 'order'
      let s = b.p_step; const rider = who !== r.taker;
      if (rider && s === "done") s = "picked";
      if (rider && s !== "picked") return { error: "not_taker" };
      const ok2 = (s === "enroute" && r.status === "taken") || (s === "arrived" && r.status === "enroute") || (s === "picked" && r.status === "arrived" && !r.step_at.picked)
        || (s === "done" && r.status === "arrived" && !!r.step_at.picked);
      if (!ok2) return order(this.view(r, who));
      r.step_at[s] = new Date().toISOString();
      if (s === "picked") r.step_at.picked_by = rider ? "rider" : "taker";
      else if (s === "done") { r.status = "done"; r.ended = true; r.drv = null; this.awards[r.taker] = (this.awards[r.taker] || 0) + 1; }
      else r.status = s;
      return this.view(r, who);
    }
    case "ride_cancel": if (who === r.rider) { r.status = "cancelled"; r.ended = true; } return this.view(r, who);
    case "ride_pos": r.drv = { lat: b.p_lat, lng: b.p_lng, at: Date.now() }; return { ok: true, live: true, status: r.status };
    case "ride_msg": r.msgs.push({ id: ++this.msgSeq, from: who, body: b.p_text, at: Date.now() }); return this.view(r, who);
    case "ride_call_ask": { const other = who === r.rider ? r.taker : r.rider;
      if (this.ccalls.filter((c) => c.req === r.id && c.from === who).length >= 2) return { error: "slow_down" };
      if (!this.ccalls.some((c) => c.req === r.id && c.from === who && !c.answer)) this.ccalls.push({ id: this.ccalls.length + 1, req: r.id, from: who, to: other, at: new Date().toISOString() });
      return this.view(r, who); }
    case "ride_call_answer": { const c = this.ccalls.filter((k) => k.req === r.id && k.to === who && !k.answer).slice(-1)[0];
      if (c) { if (b.p_yes) { const t = String(b.p_phone || "").replace(/\D/g, ""); if (!/^07\d{8}$/.test(t)) return { error: "no_phone" }; c.answer = "yes"; c.phone = t; } else c.answer = "no"; }
      return this.view(r, who); }
    case "ride_thanks": r.thanks = true; return this.view(r, who);
    case "ride_car_set": return { ok: true, car: b.p_car };
    case "ride_lask_post": { const last = this.lask[who] || 0; if (Date.now() - last < 60000) return { error: "slow_down" }; this.lask[who] = Date.now(); this.laskN[who] = (this.laskN[who] || 0) + 1; return { ok: true, n: this.laskN[who] }; }
  }
  return undefined;
};
async function page(browser, srv, who) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  page.__errs = []; page.on("pageerror", (e) => page.__errs.push(e.message));
  page.__posts = []; page.on("request", (q) => { const m = q.url().match(/rpc\/(post_\w+)/); if (m) page.__posts.push(m[1]); });
  await page.route(/rest\/v1\/rpc\/(ride_\w+|pickup_poll|driver_set)\b/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const a = srv.rpc(fn, b, who);
    if (a === undefined) return r.fallback();
    if (a && a.error) return J(r, { code: "P0001", message: a.error, details: null, hint: null }, 400);
    return J(r, a);
  });
  await page.route(/nominatim\.openstreetmap\.org\/reverse/, (r) => J(r, { address: { suburb: "Marnäs", town: "Ludvika" } }));
  await page.route(/nominatim\.openstreetmap\.org\/search/, (r) => J(r, [{ name: "Folkets park", display_name: "Folkets park, Ludvika", lat: "60.1450", lon: "15.1700", address: { suburb: "Centrum", town: "Ludvika" } }]));
  await page.route(/functions\/v1\/notify-group/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} srv.push.push([who, b]); return J(r, { sent: 1 }); });
  await page.addInitScript((h) => {
    localStorage.setItem("olnu.home", JSON.stringify({ lat: h.lat, lng: h.lng, r: 300, at: Date.now() }));
    window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
      .observe(document, { childList: true, subtree: true });
    // read-aloud: a Swedish voice + record what is spoken
    window.__spoken = [];
    try {
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "sv-SE", name: "Alva" }], speak: (u) => window.__spoken.push(u.text), cancel: () => {} } });
    } catch (e) {}
  }, HOME);
  await page.clock.install();
  await boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const S = (p) => p.evaluate(() => {
  const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"), vis = (e) => !!e && e.getClientRects().length > 0;
  const btns = [...b.querySelectorAll("button, a.btn, a.rd-rowbtn")].filter(vis).map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), h: Math.round(r.height), c: x.className, href: x.getAttribute("href") || "", dis: !!x.disabled }; });
  return { open: !s.hidden, title: document.getElementById("sheet-title").textContent, text: b.textContent.replace(/\s+/g, " "), btns, sw: document.documentElement.scrollWidth, iw: innerWidth,
    tel112: !!b.querySelector('a[href="tel:112"]'), chips: [...b.querySelectorAll(".rd-qb")].map((x) => x.textContent), amber: [...b.querySelectorAll(".btn-amber")].filter(vis).map((x) => x.textContent.trim()),
    state: (b.querySelector(".rd-state") || {}).textContent || "", now: (b.querySelector(".rd-step-now") || {}).textContent || "" };
});
const tap = (p, re, sel) => p.evaluate(([r, s]) => { const e = [...document.querySelectorAll(s || "#sheet-body button, #sheet-body a")].find((x) => x.getClientRects().length && !x.disabled && new RegExp(r).test(x.textContent.trim())); if (e) e.click(); return e ? e.textContent.trim() : null; }, [re, sel]);
const toasts = (p) => p.evaluate(() => (window.__toasts || []).join(" | "));
const openRide = (p, id) => p.evaluate((i) => window.RIDE && window.RIDE.openId(i), id);
const pause = async (p) => { const t = await p.evaluate(() => Date.now()); await p.clock.pauseAt(t + 20); };
// the watching phone runs exactly `ms` of its timers; then real time for the network answers (fetch is not on the fake clock)
const run = async (p, ms) => { await p.clock.runFor(ms); await p.waitForTimeout(900); };
// a long window in steps, with real time between the steps so the network answers (and their follow-up timers) land
const steps = async (pages, total, step) => { for (let t = 0; t < total; t += step) { for (const p of pages) await p.clock.runFor(Math.min(step, total - t)); await pages[0].waitForTimeout(350); } };
const small = (s) => s.btns.filter((b) => b.h < 44 && !/\bswitch\b/.test(b.c));
const count = (srv, who, fn, since) => srv.calls.filter((c) => c[1] === who && c[0] === fn && c[3] >= since).length;
async function shot(p, name) { await p.screenshot({ path: OUT + name + (/-\d{3}$/.test(name) ? "" : "-390") + ".png" }); }

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    const srv = new Srv();
    const R = await page(browser, srv, "R"), D = await page(browser, srv, "D1");

    /* ---------- poll windows while nothing is open ---------- */
    await pause(R.page); await pause(D.page);
    let t0 = Date.now();
    await steps([R.page, D.page], 30000, 2500); await wait(R.page, 900);
    const rIdle = count(srv, "R", "ride_poll", t0) + count(srv, "R", "ride_stamp_get", t0), dStamp = count(srv, "D1", "ride_stamp_get", t0), dPoll = count(srv, "D1", "ride_poll", t0);
    ok("R3-1 nothing open (rider, not driving): at most 1 ride call in 30 s (slow lane)", rIdle <= 1, { rIdle });
    ok("R3-1 'Jag kör ikväll' driver: checks every ~5 s (≥ 5 checks in 30 s), mostly the cheap ride_stamp_get", dStamp + dPoll >= 5 && dStamp >= 3 && dPoll <= 3, { dStamp, dPoll });
    await R.page.clock.resume(); await D.page.clock.resume();

    /* ---------- request with destination (search, then Hem) ---------- */
    await R.page.evaluate(() => window.SKJUTS.openPickup({})); await wait(R.page, 1500);
    let s = await S(R.page);
    ok("R3-4 request sheet has 'Vart ska du?' (Valfritt) with [Hem] [Annan plats]", /Vart ska du\?/.test(s.text) && /Valfritt/.test(s.text) && s.btns.some((b) => b.t === "Hem") && s.btns.some((b) => b.t === "Annan plats"), s.text.slice(0, 300));
    ok("R3 no 112 link in the request sheet (owner 21:09)", !s.tel112);
    await tap(R.page, "^Annan plats$"); await wait(R.page, 400);
    await R.page.fill("#sheet-body .rd-dq", "Folkets park", { timeout: 3000 }).catch(() => {});
    await tap(R.page, "^Sök$"); await wait(R.page, 1200);
    s = await S(R.page);
    ok("R3-4 Annan plats: search → result 'Folkets park · Centrum, Ludvika'", /Folkets park/.test(s.text) && /Centrum, Ludvika/.test(s.text), s.text.slice(0, 400));
    await tap(R.page, "Folkets park", "#sheet-body .ps-hit"); await wait(R.page, 1200);
    s = await S(R.page);
    ok("R3-4 picked place shows as the destination row (with a 44 px clear button)", /Folkets park/.test(s.text) && s.btns.some((b) => /rd-x/.test(b.c) && b.h >= 44), s.text.slice(0, 300));
    await shot(R.page, "r1-request-place");
    await tap(R.page, "^Hem$"); await wait(R.page, 1500);
    s = await S(R.page);
    ok("R3-4 'Hem' = the home zone; area from one reverse lookup: 'Hem · Marnäs, Ludvika'", /Hem · Marnäs, Ludvika/.test(s.text), s.text.slice(0, 300));
    ok("R3 request sheet: no sideways scroll, buttons ≥ 44 px", s.sw <= s.iw && small(s).length === 0, small(s));
    await shot(R.page, "r2-request-home");
    await pause(D.page);
    await tap(R.page, "^Skicka$"); await wait(R.page, 1500);
    const req = srv.calls.find((c) => c[0] === "ride_request2");
    ok("R3-4 Skicka → ride_request2 with the destination (kind home, area, exact point)", !!req && req[2].p_dest_kind === "home" && req[2].p_dest_area === "Marnäs, Ludvika" && Math.abs(req[2].p_dest_lat - HOME.lat) < 1e-6, req && req[2]);
    const ride = srv.rides[0] || srv.mk({ dest: { kind: "home", name: "Hem", area: "Marnäs, Ludvika", lat: HOME.lat, lng: HOME.lng } });

    /* ---------- the idle driver sees it within seconds ---------- */
    t0 = Date.now();
    await run(D.page, 6000);
    s = await S(D.page);
    const dt = await toasts(D.page);
    ok("R3-1 idle driver: the request shows within 6 s (fake clock): toast + the offer sheet opens by itself", /Lisa behöver skjuts/.test(dt) && s.open && /Lisa behöver skjuts/.test(s.text), { dt, title: s.title });
    ok("R3-4 offer card: Från <pickup place> / Till Marnäs, Ludvika (area only) + distance + trip estimate", /Från \S/.test(s.text) && /Till Marnäs, Ludvika/.test(s.text) && !/Hem/.test(s.text)
      && /1,2 km bort · ca 3 min dit/.test(s.text) && /Resa ca \d+,\d km · \d+ min/.test(s.text), s.text.slice(0, 400));
    ok("R3 offer sheet: no 112 link", !s.tel112);
    await shot(D.page, "d1-offer");
    await D.page.clock.resume();

    /* ---------- take → rider sees "tar dig" ≤ 3 s ---------- */
    await openRide(D.page, ride.id); await wait(D.page, 500);
    await pause(R.page);
    await tap(D.page, "^Jag tar den$"); await wait(D.page, 1200);
    await run(R.page, 3000);
    await openRide(R.page, ride.id); await R.page.clock.runFor(300); await wait(R.page, 300);
    s = await S(R.page);
    ok("R3-2 take → the rider sees 'Oskar tar dig!' within 3 s (toast + card)", /Oskar tar dig/.test(await toasts(R.page)) && /Oskar tar dig!/.test(s.state), { st: s.state, t: await toasts(R.page) });
    ok("R3-2 rider at 'taken': no 'Jag sitter i bilen' / done button; steps show Tagen as now", !s.btns.some((b) => /sitter i bilen|Klar|Framme/.test(b.t)) && /Tagen/.test(s.now), s.btns.map((b) => b.t));
    ok("R3-3 rider chips = Kommer ut nu / Står vid ingången / Ge mig 5 min / Tack!", JSON.stringify(s.chips) === JSON.stringify(["Kommer ut nu", "Står vid ingången", "Ge mig 5 min", "Tack!"]), s.chips);
    ok("R3 rider live sheet: no 112 link; buttons ≥ 44 px; no sideways scroll", !s.tel112 && small(s).length === 0 && s.sw <= s.iw, small(s));
    await R.page.clock.resume();
    await openRide(D.page, ride.id); await wait(D.page, 500);
    s = await S(D.page);
    ok("R3-2 driver at 'taken': ONE amber step button 'På väg' (no Framme / Klar / OK)", JSON.stringify(s.amber) === JSON.stringify(["På väg"]) && !s.btns.some((b) => !/rd-qb/.test(b.c) && /^(Klar|OK|Framme vid målet|Jag är här)$/.test(b.t)), s.amber);
    ok("R3-3 driver chips = Jag är här / 2 min kvar / Hittar int' / Står utanför", JSON.stringify(s.chips) === JSON.stringify(["Jag är här", "2 min kvar", "Hittar int'", "Står utanför"]), s.chips);
    ok("R3 driver sheet: no 112 link; 'Ring' button; 'Läs upp meddelanden' switch; Till Hem · Marnäs (exact after take)", !s.tel112 && s.btns.some((b) => /^Ring$/.test(b.t)) && /Läs upp meddelanden/.test(s.text) && /Till Hem · Marnäs, Ludvika/.test(s.text), s.text.slice(0, 300));
    await shot(D.page, "d2-taken");
    // owner 22:08: the focus ring of the chat field was cut on the left edge → inset ring, inside the sheet's clip box
    const ring = (p) => p.evaluate(() => {
      const i = document.querySelector("#sheet-body .rd-chat-in"); if (!i) return null;
      i.focus(); const c = getComputedStyle(i), r = i.getBoundingClientRect(), b = document.getElementById("sheet-body").getBoundingClientRect();
      const off = parseFloat(c.outlineOffset) || 0, w = parseFloat(c.outlineWidth) || 0;
      return { off: c.outlineOffset, style: c.outlineStyle, w: c.outlineWidth, ringL: Math.round(r.left - off - w), clipL: Math.round(b.left), ringR: Math.round(r.right + off + w), clipR: Math.round(b.right) };
    });
    for (const [nm, P0] of [["rider", R.page], ["driver", D.page]]) for (const w of [360, 390, 430]) {
      await P0.setViewportSize({ width: w, height: 844 }); await openRide(P0, ride.id); await wait(P0, 500);
      const g = await ring(P0);
      ok(`R3 ${nm} ${w}: chat field focus ring is inset and inside the sheet (not cut)`, !!g && g.style !== "none" && g.off === "-2px" && g.ringL >= g.clipL && g.ringR <= g.clipR, g);
      if (w === 360) {
        await shot(P0, (nm === "rider" ? "r" : "d") + "9-focus-360");
        await P0.keyboard.type("Kommer");
        await P0.waitForTimeout(5000);   // ≥ 2 live polls (2 s) repaint the card meanwhile
        const kept = await P0.evaluate(() => { const a = document.activeElement; return { focus: !!(a && a.classList.contains("rd-chat-in")), v: a && a.value }; });
        ok(`R3 ${nm}: the chat field keeps focus and the half-written line through the 2 s polls (keyboard stays open)`, kept.focus && kept.v === "Kommer", kept);
        await P0.evaluate(() => { const a = document.activeElement; if (a) a.value = ""; });
      }
      await P0.evaluate(() => document.activeElement && document.activeElement.blur());
    }
    await R.page.setViewportSize({ width: 390, height: 844 }); await D.page.setViewportSize({ width: 390, height: 844 });
    await openRide(D.page, ride.id); await wait(D.page, 400);

    /* ---------- På väg → Jag är här, each ≤ 3 s on the rider ---------- */
    await pause(R.page);
    await tap(D.page, "^På väg$"); await wait(D.page, 900);
    await run(R.page, 3000);
    s = await S(R.page);
    ok("R3-2 På väg → rider sees 'Oskar ä på väg' within 3 s (toast + card + step)", /Oskar ä på väg/.test(s.state) && /På väg/.test(s.now) && /Oskar ä på väg till dig/.test(await toasts(R.page)), { st: s.state, now: s.now });
    s = await S(D.page);
    ok("R3-2 driver next button = 'Jag är här' (in order)", JSON.stringify(s.amber) === JSON.stringify(["Jag är här"]), s.amber);
    await tap(D.page, "^Jag är här$", "#sheet-body .rd-next"); await wait(D.page, 900);
    await run(R.page, 3000);
    s = await S(R.page);
    ok("R3-2 Jag är här → rider sees 'Oskar ä framme' within 3 s + the amber 'Jag sitter i bilen'", /Oskar ä framme/.test(s.state) && /Framme/.test(s.now) && s.amber.includes("Jag sitter i bilen"), { st: s.state, amber: s.amber });
    await shot(R.page, "r3-arrived");
    await R.page.clock.resume();
    s = await S(D.page);
    ok("R3-2 driver at Framme: next = 'Lisa sitter i bilen' (no Klar before the pickup)", JSON.stringify(s.amber) === JSON.stringify(["Lisa sitter i bilen"]), s.amber);
    await shot(D.page, "d3-arrived");

    /* ---------- chats: rider line → driver toast + read aloud ≤ 3 s ---------- */
    await pause(D.page);
    await tap(R.page, "^Står vid ingången$"); await wait(R.page, 900);
    await run(D.page, 3000);
    ok("R3-3 rider 'Står vid ingången' → driver toast 'Lisa: Står vid ingången' within 3 s + read aloud", /Lisa: Står vid ingången/.test(await toasts(D.page)) && (await D.page.evaluate(() => window.__spoken.join("|"))).indexOf("Står vid ingången") >= 0,
      { t: await toasts(D.page), sp: await D.page.evaluate(() => window.__spoken) });

    /* ---------- Ring: consent, the number only after Ja ---------- */
    await pause(D.page);
    s = await S(R.page);
    ok("R3 Ring: no number shown by default (no tel: link except none)", !s.btns.some((b) => /^tel:0/.test(b.href)), s.btns.filter((b) => b.href));
    await tap(R.page, "^Ring$"); await wait(R.page, 900);
    await run(D.page, 3000);
    await openRide(D.page, ride.id); await D.page.clock.runFor(300); await wait(D.page, 300);
    s = await S(D.page);
    ok("R3 Ring: the driver gets 'Lisa vill ringa dig. Visa ditt nummer?' [Nej] [Ja, visa] + 'Hen ser ditt nummer och kan spara det.'", /Lisa vill ringa dig\. Visa ditt nummer\?/.test(s.text) && /Hen ser ditt nummer och kan spara det/.test(s.text)
      && s.btns.some((b) => b.t === "Ja, visa") && s.btns.some((b) => b.t === "Nej"), s.text.slice(0, 400));
    await shot(D.page, "d4-call-consent");
    await D.page.clock.resume();
    await pause(R.page);
    await D.page.fill("#sheet-body .rd-phone", "070-123 45 67").catch(() => {});
    await tap(D.page, "^Ja, visa$"); await wait(D.page, 900);
    await run(R.page, 3000);
    s = await S(R.page);
    ok("R3 Ring: after Ja the rider has 'Ring Oskar' = tel:0701234567", s.btns.some((b) => b.href === "tel:0701234567" && /Ring Oskar/.test(b.t)), s.btns.filter((b) => b.href));
    await R.page.clock.resume();

    /* ---------- rider "Jag sitter i bilen" = trip starts (never Klar) → driver ≤ 3 s ---------- */
    await pause(D.page);
    await tap(R.page, "^Jag sitter i bilen$"); await wait(R.page, 900);
    const stp = srv.calls.filter((c) => c[0] === "ride_step" && c[1] === "R").slice(-1)[0];
    ok("R3-2 rider 'Jag sitter i bilen' → ride_step 'picked' (not done); the ride is still live", !!stp && stp[2].p_step === "picked" && ride.status === "arrived" && !ride.ended, stp && stp[2]);
    s = await S(R.page);
    ok("R3-2 rider card: 'Ni åker · till Hem · Marnäs, Ludvika' + step I bilen", /Ni åker · till Hem · Marnäs, Ludvika/.test(s.state) && /I bilen/.test(s.now), { st: s.state, now: s.now });
    await shot(R.page, "r4-in-car");
    await run(D.page, 3000);
    s = await S(D.page);
    ok("R3-2 driver sees 'Lisa sitter i bilen' within 3 s; next = 'Framme vid målet'; nav to the destination", /Lisa sitter i bilen/.test(await toasts(D.page)) && JSON.stringify(s.amber) === JSON.stringify(["Framme vid målet"])
      && s.btns.some((b) => /rd-nav/.test(b.c) && /destination=60\.164/.test(b.href)), { amber: s.amber, t: await toasts(D.page) });
    await shot(D.page, "d5-in-car");
    await D.page.clock.resume();

    /* ---------- Framme vid målet → rider ≤ 3 s: Klar + Tack; driver: plural ---------- */
    await pause(R.page);
    await tap(D.page, "^Framme vid målet$"); await wait(D.page, 1200);
    await run(R.page, 3000);
    s = await S(R.page);
    ok("R3-2 Framme vid målet → rider sees 'Framme! Oskar levererade.' + Tack! Skål within 3 s", /Framme! Oskar levererade|Hemma snart\. Snyggt jobbat, Oskar/.test(s.text) && /Framme! Tacka Oskar/.test(await toasts(R.page)) && s.btns.some((b) => /Tack! Skål/.test(b.t)), s.text.slice(0, 200));
    await R.page.clock.resume();
    await D.page.evaluate(() => window.SKJUTS._force()); await wait(D.page, 900); await openRide(D.page, ride.id); await wait(D.page, 500);
    s = await S(D.page);
    ok("R3 driver done card: 'Kvällens chaufför' + '2 körningar ikväll' (plural)", /Kvällens chaufför/.test(s.text) && /2 körningar ikväll/.test(s.text), s.text.slice(0, 200));
    await shot(D.page, "d6-done");

    /* ---------- LÄSK! (owner 21:26): a driver's tap logs a SODA (ride_lask_post), never a drink ---------- */
    await D.page.evaluate(() => { try { window.closeSheet && window.closeSheet(); } catch (e) {} const s = document.getElementById("sheet"); if (s) s.hidden = true; window.__toasts = []; });
    await D.page.evaluate(() => window.LASK && window.LASK.sync()); await wait(D.page, 300);
    const laskOn = await D.page.evaluate(() => !!(window.LASK && window.LASK.on()));
    const vis = (p) => p.evaluate(() => { const w = document.getElementById("other-wrap"), b = document.getElementById("btn-other"); return !!(w && b && b.getClientRects().length && getComputedStyle(w).display !== "none"); });
    const annR = await vis(R.page), annD = await vis(D.page);
    ok("ANNAT: hidden while 'Jag kör ikväll' is on (driver), shown for the rider (not driving)", annR && !annD, { annR, annD });
    D.page.__posts.length = 0;
    await D.page.evaluate(() => { const b = document.getElementById("btn-beer"); if (b) b.click(); }); await wait(D.page, 1200);
    const live = () => D.page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
    const lt = await live(), lq = srv.calls.filter((c) => c[0] === "ride_lask_post" && c[1] === "D1").length;
    const lnk = await D.page.evaluate(() => { const b = document.querySelector("#toasts .rd-lask-toast .btn"); if (!b) return null; const c = getComputedStyle(b); return { t: b.textContent, bg: c.backgroundColor, dec: c.textDecorationLine, h: Math.round(b.getBoundingClientRect().height) }; });
    ok("LÄSK: the driver's tap logs a soda (ride_lask_post), toast 'Skål … · 1 läsk ikväll', no post_beer / post_other", laskOn && lq === 1 && /läsk ikväll/.test(lt) && /1 läsk ikväll/.test(lt)
      && !D.page.__posts.some((n) => n !== "post_lask"), { laskOn, lq, lt, posts: D.page.__posts });
    ok("LÄSK: 'Jag kör inte' is a small secondary link (no fill, underlined, ≥ 44 px)", !!lnk && lnk.t === "Jag kör inte" && /rgba\(0, 0, 0, 0\)|transparent/.test(lnk.bg) && /underline/.test(lnk.dec) && lnk.h >= 44, lnk);
    await shot(D.page, "d7-lask-toast");
    await D.page.evaluate(() => { const b = document.getElementById("btn-beer"); if (b) b.click(); }); await wait(D.page, 1000);
    ok("LÄSK: a 2nd soda within 60 s = 'En läsk i minuten räcker, chaufför.'", /En läsk i minuten räcker/.test(await live()), await live());
    await D.page.evaluate(() => window.SKJUTS.setDriver(false)); await wait(D.page, 1500);
    const offD = await vis(D.page), lblD = await D.page.evaluate(() => document.getElementById("beer-label").textContent);
    ok("ANNAT: driving off → ANNAT back at once, ÖL! back", offD && lblD === "ÖL!" && !srv.driving.D1, { offD, lblD });
    await shot(D.page, "d8-driving-off");
    await D.page.evaluate(() => window.SKJUTS.setDriver(true)); await wait(D.page, 1500);

    /* ---------- live-ride poll window + busy back-off ---------- */
    const r2 = srv.mk({ status: "enroute", taker: "D1", taken: Date.now(), step_at: { open: new Date().toISOString(), taken: new Date().toISOString(), enroute: new Date().toISOString() } });
    await R.page.evaluate(() => window.SKJUTS._force()); await wait(R.page, 900);
    await pause(R.page); t0 = Date.now();
    await steps([R.page], 10000, 1000); await wait(R.page, 900);
    const live10 = count(srv, "R", "ride_poll", t0);
    ok("R3-1 live ride: the rider polls ride_poll every 2 s (≥ 4 in 10 s)", live10 >= 4, { live10 });
    await R.page.evaluate(() => { window.X8 = window.X8 || {}; window.__b = window.X8.busy; window.X8.busy = () => true; });
    await steps([R.page], 3000, 1000); await wait(R.page, 600); t0 = Date.now();
    await steps([R.page], 10000, 1000); await wait(R.page, 900);
    const busy10 = count(srv, "R", "ride_poll", t0) + count(srv, "R", "ride_stamp_get", t0);
    ok("R3-1 busy back-off: no fast ride calls in 10 s while X8.busy()", busy10 === 0, { busy10 });
    await R.page.evaluate(() => { window.X8.busy = window.__b; });
    await R.page.clock.resume();
    r2.status = "cancelled"; r2.ended = true;

    /* ---------- flags: OFF → ON reaches the app within ~1 min ---------- */
    await R.page.evaluate(() => window.SKJUTS._force()); await wait(R.page, 900);
    srv.flags.ride_v2 = false;
    await pause(R.page);
    await steps([R.page], 65000, 2500); await wait(R.page, 900);
    const offNow = await R.page.evaluate(() => !(window.RIDE && window.RIDE.on()));
    srv.flags.ride_v2 = true; t0 = Date.now();
    await steps([R.page], 65000, 2500); await wait(R.page, 1200);
    const onNow = await R.page.evaluate(() => !!(window.RIDE && window.RIDE.on()));
    ok("R3-6 flag OFF reaches the app within 65 s, and back ON within 65 s (ride_flags_get re-asked)", offNow && onNow && count(srv, "R", "ride_flags_get", t0) >= 1, { offNow, onNow, asks: count(srv, "R", "ride_flags_get", t0) });
    await R.page.clock.resume();

    const errs = [].concat(R.page.__errs, D.page.__errs);
    ok("R3 no page errors", errs.length === 0, errs);
    await R.ctx.close(); await D.ctx.close();
  } catch (e) { ok("no exception", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`ride3: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
