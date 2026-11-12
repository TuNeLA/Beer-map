// lane ride (F1, migration 0420) — mocked server (ds-helpers + a small ride state machine in this file).
// Usage: node ride-pw.js <port>. Every "F1" check FAILS on 9f4746d (no js/ride.js: "Hämta mig" is the old friend picker,
// no ride_request / ride_take / offer card / driver card) and PASSES with the ride lane.
// 1 request sheet → ride_request (place, pax, note) + push {event:"pickup", ride:1} · 2 the offer card from a push tap
// (all facts) + Android "Jag tar den" button url · 3 RACE: two drivers tap at the same moment → one wins, the other sees
// "Oskar tog den ✓" · 4 live driver card (car, ETA, steps, chat, live pin only while live) + taker card (steps, ride_pos)
// · 5 5 min → Fråga igen / Fråga fler, 10 min → verified taxi · 6 cancel both ways, Tack! Skål, Kvällens chaufför ·
// drink rule (no take button) · flag off and old server = the old sheet, no ride RPC · R1-30 member row.
// Screens at 360 / 390 / 430 → <OUT>/ride-shots/.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const OUT = require("./env.js").OUT + "ride-shots/";
require("fs").mkdirSync(OUT, { recursive: true });
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const MISSING = (fn) => ({ code: "PGRST202", message: "Could not find the function public." + fn + " without parameters in the schema cache", details: null, hint: null });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 400)); c ? pass++ : fail++; };
const W = [360, 390, 430];
const PK = { lat: 60.14997, lng: 15.18679 };

/* ---------- the server model (same rules as 0420) ---------- */
const NAMES = { R: "Lisa", D1: "Oskar", D2: "Nisse" }, CAR = { D1: "Röd Volvo V70 · ABC 123", D2: null };
function Srv() { this.flags = { ride_v2: true, ride_v2_more: true }; this.rides = []; this.calls = []; this.push = []; this.drinking = {}; this.seq = 76; this.awards = {}; this.old = false; }
Srv.prototype.mk = function (o) {
  const t = Date.now(), r = Object.assign({ id: ++this.seq, rider: "R", to: ["D1", "D2"], status: "open", taker: null, ended: false, created: t, opened: t, taken: null,
    pax: 2, note: "vid kebaben", place: "Pitchers", step_at: { open: new Date(t).toISOString() }, declined: [], excluded: [], wide: false, again: false, round: 1, thanks: false,
    msgs: [], drv: null }, o || {});
  this.rides.push(r); return r;
};
Srv.prototype.view = function (r, who) {
  const iso = (x) => x == null ? null : new Date(x).toISOString();
  const live = !r.ended && ["open", "taken", "enroute", "arrived"].includes(r.status), moving = live && r.status !== "open";
  const role = who === r.rider ? "rider" : who === r.taker ? "taker" : "asked";
  const v = { id: r.id, role, area: r.area || null, status: r.status, live, created_at: iso(r.created), opened_at: iso(r.opened), taken_at: iso(r.taken), ended_at: r.ended ? iso(Date.now()) : null,
    step_at: r.step_at, pax: r.pax, note: r.note, place: r.place, n: r.to.length, declined_n: r.declined.length, wide: r.wide, again: r.again, round: r.round, thanks: r.thanks,
    taker_name: r.taker ? NAMES[r.taker] : null };
  if (role !== "asked") v.msgs = r.msgs.map((m) => ({ me: m.from === who, body: m.body, at: iso(m.at) }));
  if (role === "rider" && r.taker) v.driver = { name: NAMES[r.taker], car: CAR[r.taker], avatar: null, lat: moving && r.drv ? r.drv.lat : null, lng: moving && r.drv ? r.drv.lng : null,
    pos_at: moving && r.drv ? iso(r.drv.at) : null, dist_m: moving && r.drv ? 1200 : null, eta_min: moving && r.drv ? 3 : null };
  if (role === "taker") Object.assign(v, { rider: { name: NAMES[r.rider], avatar: null }, pk_lat: live ? PK.lat : null, pk_lng: live ? PK.lng : null, dist_m: moving ? 1200 : null });
  if (role === "asked") Object.assign(v, { name: NAMES[r.rider], dist_m: 1200, my_declined: r.declined.includes(who), excluded: r.excluded.includes(who), can_take: live && r.status === "open" && !r.excluded.includes(who) });
  return v;
};
Srv.prototype.poll = function (who) {
  const p = { v: 1, now: new Date().toISOString(), driving: who !== "R", incoming: [], mine: null };
  if (!this.flags.ride_v2) return Object.assign(p, { ride: { v: 1, on: false } });
  const mine = this.rides.filter((r) => r.rider === who).slice(-1)[0], drive = this.rides.filter((r) => r.taker === who).slice(-1)[0];
  return Object.assign(p, { ride: { v: 1, on: true, more: !!this.flags.ride_v2_more, now: p.now, mine: mine ? this.view(mine, who) : null, drive: drive ? this.view(drive, who) : null,
    offers: this.rides.filter((r) => r.to.includes(who) && r.rider !== who && r.taker !== who).map((r) => this.view(r, who)), drinking: !!this.drinking[who], car: CAR[who] || null, chauffeur: this.awards[who] || 0 } });
};
Srv.prototype.rpc = function (fn, b, who) {
  this.calls.push([fn, who, b]);
  const r = b && b.p_id != null ? this.rides.find((x) => x.id === +b.p_id) : null;
  switch (fn) {
    case "ride_flags_get": return this.flags;
    case "ride_poll": return this.poll(who);
    case "pickup_poll": return { v: 1, driving: who !== "R", incoming: [], mine: null };
    case "ride_request3": { const x = this.mk({ pax: b.p_pax, note: b.p_note, place: b.p_pk_chosen ? (b.p_place || null) : null, area: b.p_pk_area || null }); return this.view(x, who); }   // 0506: the name only when chosen (I-30)
    case "ride_request": { const x = this.mk({ pax: b.p_pax, note: b.p_note, place: b.p_place || null }); return this.view(x, who); }
    case "ride_take":   // first accept wins: one synchronous check-and-set (the server does it in one UPDATE)
      if (this.drinking[who]) return { ok: false, code: "drinking" };
      if (r.excluded.includes(who)) return { ok: false, code: "excluded" };
      if (r.status === "open" && !r.taker && !r.ended) { r.status = "taken"; r.taker = who; r.taken = Date.now(); r.step_at.taken = new Date().toISOString(); return { ok: true, ride: this.view(r, who) }; }
      return r.taker ? { ok: false, code: "taken", name: NAMES[r.taker], mine: r.taker === who } : { ok: false, code: "ended" };
    case "ride_decline": if (!r.declined.includes(who)) r.declined.push(who); return this.view(r, who);
    case "ride_step": r.status = b.p_step; r.step_at[b.p_step] = new Date().toISOString(); if (b.p_step === "done") { r.ended = true; r.drv = null; this.awards[r.taker] = (this.awards[r.taker] || 0) + 1; } return this.view(r, who);
    case "ride_cancel":
      if (who === r.rider) { r.status = "cancelled"; r.ended = true; r.drv = null; }
      else { r.excluded.push(who); r.taker = null; r.status = "open"; r.round++; r.drv = null; r.opened = Date.now(); r.step_at.redispatch = new Date().toISOString(); }
      return this.view(r, who);
    case "ride_widen": r.wide = true; r.to.push("D3"); return Object.assign(this.view(r, who), { added: 1 });
    case "ride_again": r.again = true; r.round++; return this.view(r, who);
    case "ride_thanks": r.thanks = true; return this.view(r, who);
    case "ride_pos": r.drv = { lat: b.p_lat, lng: b.p_lng, at: Date.now() }; return { ok: true, live: true, status: r.status };
    case "ride_msg": r.msgs.push({ from: who, body: b.p_text, at: Date.now() }); return this.view(r, who);
    case "ride_car_set": CAR[who] = b.p_car; return { ok: true, car: b.p_car };
  }
  return undefined;
};
async function page(browser, srv, who, w, o) {
  const { ctx, page } = await ctxFor(browser, { width: w || 390, height: 844 });
  const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  page.__dialogs = dialogs; page.__errs = []; page.on("pageerror", (e) => page.__errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/(ride_\w+|pickup_poll)\b/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (srv.old && /^ride_/.test(fn)) { srv.calls.push([fn, who, b]); return J(r, MISSING(fn), 404); }
    if (o && o.delay && fn === "ride_take") await new Promise((res) => setTimeout(res, o.delay));
    const a = srv.rpc(fn, b, who); return a === undefined ? r.fallback() : J(r, a);
  });
  await page.route(/functions\/v1\/notify-group/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} srv.push.push([who, b]); return J(r, { sent: 1 }); });
  await page.addInitScript(() => {   // every toast text, also the ones shown while the app boots
    window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
      .observe(document, { childList: true, subtree: true });
  });
  await boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const S = (p) => p.evaluate(() => {
  const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"), vis = (e) => !!e && e.getClientRects().length > 0;
  const btns = [...b.querySelectorAll("button, a.rd-taxi, a.rd-rowbtn")].filter(vis).map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width), c: x.className, href: x.getAttribute("href") || "" }; });
  return { open: !s.hidden, title: document.getElementById("sheet-title").textContent, text: b.textContent.replace(/\s+/g, " "), btns, sw: document.documentElement.scrollWidth, iw: innerWidth,
    first: (b.querySelector(".rd > *") || {}).className || "", rd: !!b.querySelector(".rd"),
    // owner 11 Nov: no big 112 in the ride sheet; one small muted link at the very bottom
    big112: !!b.querySelector(".sf-112, .rd-112"), foot112: (() => { const l = b.lastElementChild; const a = l && l.querySelector('a[href="tel:112"]'); return a ? { t: a.textContent.trim(), c: getComputedStyle(a).color } : null; })() };
});
const tap = (p, re, sel) => p.evaluate(([r, s]) => { const e = [...document.querySelectorAll(s || "#sheet-body button, #sheet-body a")].find((x) => x.getClientRects().length && new RegExp(r).test(x.textContent.trim())); if (e) e.click(); return e ? e.textContent.trim() : null; }, [re, sel]);
const force = (p) => p.evaluate(() => window.SKJUTS && window.SKJUTS._force && window.SKJUTS._force()).then(() => wait(p, 400));
const small = (s) => s.btns.filter((b) => b.h < 44 && !/rd-taxi|rd-rowbtn|\bswitch\b/.test(b.c));   // ride3: .switch = the app toggle (32 px, ::before makes the target 48 px)
async function shots(p, name, open) {
  for (const w of W) {
    await p.setViewportSize({ width: w, height: 844 }); await wait(p, 150);
    if (open) { await open(); await wait(p, 600); }
    const s = await S(p);
    ok(`[${w}] ${name}: no sideways scroll, buttons ≥ 44 px`, s.sw <= s.iw && small(s).length === 0, { sw: s.sw, iw: s.iw, small: small(s) });
    await p.screenshot({ path: OUT + name + "-" + w + ".png" });
  }
  await p.setViewportSize({ width: 390, height: 844 });
}
const openReq = (p) => p.evaluate(() => window.SKJUTS.openPickup({}));
const openId = (p, id) => p.evaluate((i) => window.SKJUTS.hudClick("pk-in:" + i), id);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    /* ---------- 1 request (rider = Lisa) ---------- */
    const srv = new Srv();
    const R = await page(browser, srv, "R");
    await openReq(R.page); await wait(R.page, 1500);
    let s = await S(R.page);
    ok("F1-1 'Hämta mig' opens the ride request sheet (title, request content first, where / how many / note)", s.open && s.title === "Hämta mig" && s.rd && /rd-lead/.test(s.first)
      && /Var ä du\?/.test(s.text) && /Hur många\?/.test(s.text) && /Nåt mer\?/.test(s.text) && !/Vem ska få frågan/.test(s.text), { title: s.title, first: s.first, text: s.text.slice(0, 200) });
    ok("F1-1 no 112 link at all in the ride sheet (owner 11 Nov 21:09, ride3: a pickup is not an emergency)", !s.big112 && !s.foot112 && !s.text.includes("Ring 112"), { big: s.big112, foot: s.foot112 });
    ok("F1-1 one amber button (Skicka), segmented where (2) + pax (4)", s.btns.filter((b) => /btn-amber/.test(b.c)).length === 1
      && s.btns.filter((b) => /rd-segb/.test(b.c)).length === 8, s.btns.map((b) => b.t));   // ride3: + Vart ska du? [Hem] [Annan plats]
    await shots(R.page, "1-request", async () => { await openReq(R.page); await wait(R.page, 900); });
    await openReq(R.page); await wait(R.page, 1200);
    await R.page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body .rd-seg4 .rd-segb")].find((x) => x.textContent === "2"); if (b) b.click(); });
    await R.page.fill("#sheet-body .rd-in", "vid kebaben", { timeout: 3000 }).catch(() => {});
    await tap(R.page, "^Skicka$"); await wait(R.page, 1500);
    const req = srv.calls.find((c) => c[0] === "ride_request3");
    ok("F1-1 Skicka → ride_request with position, 2 pers, note", !!req && req[2].p_pax === 2 && req[2].p_note === "vid kebaben" && Math.abs(req[2].p_lat - 60.1511) < 0.01, req);
    ok("F1-2 push asked: notify-group {event:'pickup', req_id, ride:1}", srv.push.some((x) => x[1].event === "pickup" && x[1].ride === 1 && srv.rides[0] && x[1].req_id === srv.rides[0].id), srv.push);
    s = await S(R.page);
    ok("F1-1 after send: 'Väntar på chaufför' + 2 tillfrågade + Avbryt", /Väntar på chaufför/.test(s.text) && /2 tillfrågade|2 har fått frågan/.test(s.text) && s.btns.some((b) => /Avbryt förfrågan/.test(b.t)), s.text.slice(0, 200));
    await shots(R.page, "1-waiting", async () => { await openReq(R.page); });
    ok("F1-1 HUD chip 'Hämta mig · väntar'", await R.page.evaluate(() => /Hämta mig · väntar/.test(window.SKJUTS.hudChipsHTML())));
    const ride1 = srv.rides[0] || srv.mk();   // old code sends no request: later parts still run (and fail) on a server-made ride

    /* ---------- 2 + 3 offer card and the RACE (drivers Oskar + Nisse) ---------- */
    const D1 = await page(browser, srv, "D1", 390, { delay: 300 }), D2 = await page(browser, srv, "D2", 390, { delay: 300 });
    await force(D1.page); await force(D2.page); await wait(D1.page, 600);
    const toast = await D1.page.evaluate(() => (window.__toasts || []).join(" | "));
    const PL = (req && req[2].p_place) || "?";
    ok("F1-2 driver gets an in-app alert 'Lisa behöver skjuts · <place>'", toast.indexOf("Lisa behöver skjuts · " + PL) >= 0, { toast, PL });
    ok("F1-2 driver HUD chip 'Lisa behöver skjuts'", await D1.page.evaluate(() => /Lisa behöver skjuts/.test(window.SKJUTS.hudChipsHTML())));
    await openId(D1.page, ride1.id); await openId(D2.page, ride1.id); await wait(D1.page, 800);
    s = await S(D1.page);
    ok("F1-2 push tap (?pickup=id → hudClick pk-in) opens the offer: name, place, pax, km, note, [Kan int'] [Jag tar den]",
      s.title === "Skjuts?" && /Lisa behöver skjuts/.test(s.text) && s.text.indexOf("Från " + PL) >= 0 && s.text.indexOf("2 pers · 1,2 km bort") >= 0 && /Inget mål angivet/.test(s.text) && /vid kebaben/.test(s.text)
      && s.btns.some((b) => b.t === "Jag tar den" && /btn-amber/.test(b.c)) && s.btns.some((b) => b.t === "Kan int'"), s);
    const two = s.btns.filter((b) => /rd-take|rd-decline/.test(b.c));
    ok("F1-2 the two answers side by side, same width, ≥ 48 px", two.length === 2 && Math.abs(two[0].w - two[1].w) <= 1 && two.every((b) => b.h >= 48), two);
    await shots(D1.page, "2-offer", async () => { await openId(D1.page, ride1.id); });
    await openId(D1.page, ride1.id); await wait(D1.page, 400);
    // RACE: both tap at the same moment (each ride_take answer waits 300 ms on the wire)
    await Promise.all([tap(D1.page, "^Jag tar den$"), tap(D2.page, "^Jag tar den$")]);
    await wait(D1.page, 1500);
    const takes = srv.calls.filter((c) => c[0] === "ride_take");
    const s1 = await S(D1.page), s2 = await S(D2.page);
    const won = [s1, s2].filter((x) => /Du kör/.test(x.title)).length, lost = [s1, s2].filter((x) => /Oskar tog den ✓|Nisse tog den ✓/.test(x.text)).length;
    ok("F1-3 RACE: both drivers sent ride_take at once → exactly one 'Du kör', the other sees '<name> tog den ✓'", takes.length === 2 && won === 1 && lost === 1 && !!ride1.taker,
      { takes: takes.map((c) => c[1]), t1: s1.title, t2: s2.title, x1: s1.text.slice(0, 80), x2: s2.text.slice(0, 80) });
    const W1 = ride1.taker === "D1" ? D1 : D2, L1 = ride1.taker === "D1" ? D2 : D1;
    ok("F1-3 the loser has no take button left", !(await S(L1.page)).btns.some((b) => b.t === "Jag tar den"));
    await shots(L1.page, "3-taken-by-other", async () => { await openId(L1.page, ride1.id); });
    ok("F1-2 taker's app asked for the 'tar dig' push", srv.push.some((x) => x[0] === ride1.taker && x[1].ride === 1));

    /* ---------- 4 live: taker card + rider card ---------- */
    // make Oskar the taker for stable names below
    ride1.taker = "D1"; const T = D1;
    await force(T.page); await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(T.page, 800);
    s = await S(T.page);
    ok("F1-4 taker card: 'Kör till Lisa', place + pax, route link, [Släpp den] [På väg], chat quick replies", s.title === "Du kör" && /Kör till Lisa/.test(s.text)
      && s.btns.some((b) => /rd-rowbtn/.test(b.c) && /maps\/dir/.test(b.href)) && s.btns.some((b) => b.t === "På väg" && /btn-amber/.test(b.c)) && s.btns.some((b) => b.t === "Släpp den")
      && /Jag är här/.test(s.text) && !/Kommer ut nu/.test(s.text), s);   // ride3: driver chips
    await wait(T.page, 1500);
    ok("F1-4 taker sends its live position (ride_pos) while driving", srv.calls.some((c) => c[0] === "ride_pos" && c[1] === "D1"), srv.calls.filter((c) => c[0] === "ride_pos").length);
    await shots(T.page, "4-taker", async () => { await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); });
    await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(T.page, 300);
    await tap(T.page, "^På väg$"); await wait(T.page, 700);
    ok("F1-4 På väg → ride_step enroute; next button 'Jag är här' (ride3)", srv.calls.some((c) => c[0] === "ride_step" && c[2].p_step === "enroute") && (await S(T.page)).btns.some((b) => b.t === "Jag är här" && /rd-next/.test(b.c)));
    // rider
    ride1.drv = ride1.drv || { lat: 60.1440, lng: 15.1890, at: Date.now() };
    await force(R.page); await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(R.page, 800);
    s = await S(R.page);
    ok("F1-4 rider card: 'Oskar ä på väg', car + 'Kolla att det ä rätt bil', ETA 'ca 3 min · 1,2 km', 4 steps", /Oskar ä på väg/.test(s.text) && /Röd Volvo V70 · ABC 123/.test(s.text)
      && /Kolla att det ä rätt bil/.test(s.text) && /ca 3 min · 1,2 km/.test(s.text) && /Tagen/.test(s.text) && /På väg/.test(s.text) && /Framme/.test(s.text) && /Klar/.test(s.text), s.text.slice(0, 300));
    ok("F1-4 rider sees the driver's live pin on the map (only while live)", await R.page.evaluate(() => !!document.querySelector(".rd-pin-car")));
    ok("F1-4 rider toast 'Oskar tar dig!'", await R.page.evaluate(() => /Oskar tar dig! Spänn fast dig\./.test((window.__toasts || []).join(" | "))));
    await tap(R.page, "^Kommer ut nu$"); await wait(R.page, 600);
    ok("F1-4 1-tap chat: 'Kommer ut nu' → ride_msg and shows in the thread", srv.calls.some((c) => c[0] === "ride_msg" && c[2].p_text === "Kommer ut nu") && /Kommer ut nu/.test((await R.page.evaluate(() => (document.querySelector("#sheet-body .rd-msgs") || {}).textContent || ""))));
    await shots(R.page, "4-rider-live", async () => { await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); });
    ride1.status = "arrived"; ride1.step_at.arrived = new Date().toISOString();
    await force(R.page); await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(R.page, 700);
    s = await S(R.page);
    // ride3: the rider never ends the ride; on a 0420 server (no v3 'picked' step) the driver's next after Framme is Klar
    ok("F1-4 arrived: 'Oskar ä framme' + 'Väntat 0 min'; no rider end button on a 0420 server (ride3: the driver owns the steps)", /Oskar ä framme/.test(s.text) && /Väntat \d+ min/.test(s.text) && !s.btns.some((b) => /Jag sitter i bilen|Klar/.test(b.t)), s.text.slice(0, 200));
    await shots(R.page, "4-rider-arrived", async () => { await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); });

    /* ---------- 6 end: done → Tack! Skål (rider) + Kvällens chaufför (driver); pin gone ---------- */
    await force(T.page); await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(T.page, 500);
    ok("F1-6 (0420 server) driver at Framme: next = 'Klar, framme'", (await S(T.page)).btns.some((b) => b.t === "Klar, framme" && /rd-next/.test(b.c)));
    await tap(T.page, "^Klar, framme$"); await wait(T.page, 800);
    await force(R.page); await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(R.page, 800);
    s = await S(R.page);
    ok("F1-6 done → 'Tack! Skål' button; the live pin is removed", /Tack! Skål/.test(s.text) && !(await R.page.evaluate(() => !!document.querySelector(".rd-pin-car"))), s.text.slice(0, 200));
    await shots(R.page, "6-rider-done", async () => { await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); });
    await tap(R.page, "Tack! Skål"); await wait(R.page, 600);
    ok("F1-6 Tack! Skål → ride_thanks, 'Skål skickad till Oskar'", srv.calls.some((c) => c[0] === "ride_thanks") && /Skål skickad till Oskar/.test((await S(R.page)).text));
    await force(T.page); await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); await wait(T.page, 700);
    s = await S(T.page);
    ok("F1-6 driver: 'Kvällens chaufför' + 'Lisa säger: Tack! Skål'; position sharing stopped", /Kvällens chaufför/.test(s.text) && /Lisa säger: Tack! Skål/.test(s.text)
      && await T.page.evaluate(() => { const st = window.RIDE && window.RIDE._state(); return !!st && (!st.drive || !st.drive.live); }), s.text.slice(0, 200));
    await shots(T.page, "6-driver-done", async () => { await T.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), ride1.id); });

    /* ---------- 6 cancel both ways + redispatch ---------- */
    const r2 = srv.mk({ rider: "R", to: ["D1", "D2"] }); r2.status = "taken"; r2.taker = "D2"; r2.taken = Date.now();
    await force(D2.page); await D2.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r2.id); await wait(D2.page, 600);
    await tap(D2.page, "^Släpp den$"); await wait(D2.page, 700);
    ok("F1-6 driver 'Släpp den' → ride_cancel, ride back to open, Nisse excluded, card says we ask the others", srv.calls.some((c) => c[0] === "ride_cancel" && c[1] === "D2") && r2.status === "open"
      && r2.excluded.includes("D2") && /Vi frågar de andra/.test((await S(D2.page)).text), r2);
    await force(R.page); await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r2.id); await wait(R.page, 600);
    await tap(R.page, "^Avbryt förfrågan$"); await wait(R.page, 700);
    ok("F1-6 rider 'Avbryt förfrågan' → ride_cancel, 'Avbrutet. Ingen ser nåns position längre.'", r2.status === "cancelled" && /Avbrutet/.test((await S(R.page)).text));

    /* ---------- 5 no answer: 5 min → Fråga igen / Fråga fler, 10 min → verified taxi ---------- */
    const r3 = srv.mk({ rider: "R", opened: Date.now() - 6 * 60e3, created: Date.now() - 6 * 60e3 });
    await force(R.page); await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r3.id); await wait(R.page, 600);
    s = await S(R.page);
    ok("F1-5 after 5 min: [Fråga igen] [Fråga fler], no taxi yet", s.btns.some((b) => b.t === "Fråga igen") && s.btns.some((b) => b.t === "Fråga fler") && !s.btns.some((b) => /rd-taxi/.test(b.c)), s.btns.map((b) => b.t));
    await shots(R.page, "5-five-min", async () => { await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r3.id); });
    await tap(R.page, "^Fråga fler$"); await wait(R.page, 700);
    ok("F1-5 Fråga fler → ride_widen + push", srv.calls.some((c) => c[0] === "ride_widen") && r3.wide && srv.push.filter((x) => x[1].req_id === r3.id).length >= 1);
    r3.opened = r3.created = Date.now() - 11 * 60e3;
    await force(R.page); await R.page.evaluate(() => window.OLNU_LAZY_NOW && window.OLNU_LAZY_NOW()); await wait(R.page, 1500);
    await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r3.id); await wait(R.page, 800);
    s = await S(R.page);
    const tx = s.btns.find((b) => /rd-taxi/.test(b.c));
    ok("F1-5 after 10 min: taxi card with the verified Ludvika number (tel:+4624013900)", !!tx && tx.href === "tel:+4624013900" && /Ludvikataxi · 0240-139 00/.test(tx.t), tx || s.btns);
    await shots(R.page, "5-taxi", async () => { await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r3.id); });
    await R.page.evaluate((i) => window.RIDE && window.RIDE.openId(i), r3.id); await tap(R.page, "^Avbryt förfrågan$"); await wait(R.page, 500);

    /* ---------- drink rule + Android button url ---------- */
    const r4 = srv.mk({ rider: "R", to: ["D1", "D2"] }); srv.drinking.D2 = true;
    await D2.page.evaluate(() => { window.__toasts = []; });
    await force(D2.page); await wait(D2.page, 400);
    const t2 = await D2.page.evaluate(() => (window.__toasts || []).join(" | "));
    await openId(D2.page, r4.id); await wait(D2.page, 600);
    s = await S(D2.page);
    ok("F1 drink rule: a driver who pressed ÖL! tonight gets no alert, the card says 'Kör int' bil' and has NO take button", !/behöver skjuts/.test(t2) && /Du har tryckt ÖL! ikväll\. Kör int' bil\./.test(s.text)
      && !s.btns.some((b) => b.t === "Jag tar den") && s.btns.some((b) => /Stäng av Jag kör/.test(b.t)), { t2, text: s.text.slice(0, 200) });
    await shots(D2.page, "7-drunk", async () => { await openId(D2.page, r4.id); });
    // Android "Jag tar den" button: /?pickup=<id>&ride=ta opens the card and takes it
    await D1.page.goto(D1.page.url().split("?")[0] + "?pickup=" + r4.id + "&ride=ta"); await wait(D1.page, 6000);
    ok("F1-2 Android button url ?pickup=<id>&ride=ta → the card opens and ride_take is sent", srv.calls.some((c) => c[0] === "ride_take" && c[1] === "D1" && +c[2].p_id === r4.id) && r4.taker === "D1",
      srv.calls.filter((c) => c[0] === "ride_take").map((c) => [c[1], c[2].p_id]));

    /* ---------- map pick (fresh request) ---------- */
    srv.rides.forEach((x) => { x.ended = true; if (x.status !== "done") x.status = "cancelled"; });
    await force(R.page); await openReq(R.page); await wait(R.page, 800);
    await tap(R.page, "^Välj på kartan$"); await wait(R.page, 1200);
    const pk2 = await R.page.evaluate(() => ({ o: !!document.querySelector(".rd-pick"), sheet: !document.getElementById("sheet").hidden, b: [...document.querySelectorAll(".rd-pick button")].map((x) => { const r = x.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return [x.textContent, Math.round(r.height), top === x || x.contains(top)]; }) }));
    ok("F1-1 'Välj på kartan' = map with a fixed centre pin + [Avbryt] [Hämta mig här] on top of the dock (sheet closed)", pk2.o && !pk2.sheet && pk2.b.length === 2 && pk2.b.every((x) => x[1] >= 44 && x[2]), pk2);
    for (const w of W) { await R.page.setViewportSize({ width: w, height: 844 }); await wait(R.page, 300); await R.page.screenshot({ path: OUT + "1-map-pick-" + w + ".png" }); }
    await R.page.setViewportSize({ width: 390, height: 844 });
    await R.page.evaluate(() => window.__map.setView([60.1520, 15.1900], 16, { animate: false })); await wait(R.page, 600);
    await R.page.evaluate(() => { const b = document.querySelector(".rd-pick-ok"); if (b) b.click(); }); await wait(R.page, 900);
    s = await S(R.page);
    await tap(R.page, "^Skicka$"); await wait(R.page, 1000);
    const req2 = srv.calls.filter((c) => c[0] === "ride_request3").slice(-1)[0];
    ok("F1-1 the picked point is sent (not the GPS position)", s.open && /Hämta mig/.test(s.title) && req2 && Math.abs(req2[2].p_lat - 60.1520) < 0.001 && Math.abs(req2[2].p_lng - 15.19) < 0.001, req2 && req2[2]);

    /* ---------- R1-30 member row ---------- */
    await R.page.evaluate(() => window.SKJUTS.loadDrivers({ id: "11111111-2222-3333-4444-555555555555" }));
    await wait(R.page, 600);
    const row = await R.page.evaluate(() => {
      const A = { el: null }; document.getElementById("sheet").hidden = false; const b = document.getElementById("sheet-body"); b.innerHTML = "";
      const li = document.createElement("li"); li.className = "st-row";
      li.innerHTML = '<span class="st-dot on"></span><span class="st-main"><span class="st-name"><span class="st-nm">Lisa</span></span><span class="st-title">Menig · 5 meriter</span></span><span class="st-n">2</span>';
      const ul = document.createElement("ul"); ul.className = "st-list"; ul.appendChild(li); b.appendChild(ul);
      window.SKJUTS.statusRow({ id: "11111111-2222-3333-4444-555555555555" }, { name: "Lisa", k: "cccccccccccc", is_me: false }, li);
      const tag = li.querySelector(".skj-role"), btn = li.querySelector(".skj-ask-t"), cs = btn && getComputedStyle(btn), r = btn && btn.getBoundingClientRect();
      return { tag: tag ? tag.textContent : null, svg: !!(tag && tag.querySelector("svg")), roleb: !!(tag && tag.classList.contains("role-b")), emoji: /🚗|🚕/.test(li.textContent),
        btn: btn ? btn.textContent : null, h: r ? Math.round(r.height) : 0, border: cs ? cs.borderTopWidth : "", old: !!li.querySelector(".skj-ask-s, .skj-tag") };
    });
    ok("R1-30 member row: role pill 'Kör ikväll' (PNI icon, role-b), no emoji, 'Skjuts?' text button ≥ 44 px without border, no old blue pill",
      row.tag === "Kör ikväll" && row.svg && row.roleb && !row.emoji && row.btn === "Skjuts?" && row.h >= 44 && row.border === "0px" && !row.old, row);
    for (const w of W) { await R.page.setViewportSize({ width: w, height: 844 }); await wait(R.page, 200); await R.page.screenshot({ path: OUT + "8-member-row-" + w + ".png" }); }

    const errs = [].concat(R.page.__errs, D1.page.__errs, D2.page.__errs), dl = [].concat(R.page.__dialogs, D1.page.__dialogs, D2.page.__dialogs);
    ok("F1 no page errors, no browser dialogs", errs.length === 0 && dl.length === 0, { errs, dl });
    await R.ctx.close(); await D1.ctx.close(); await D2.ctx.close();

    /* ---------- flag off + old server = the old sheet, no ride RPC after the flag check ---------- */
    for (const mode of ["off", "old"]) {
      const s0 = new Srv(); if (mode === "off") s0.flags = { ride_v2: false, ride_v2_more: false }; else s0.old = true;
      const P0 = await page(browser, s0, "R");
      await openReq(P0.page); await wait(P0.page, 1200);
      const x = await S(P0.page);
      const rideCalls = s0.calls.filter((c) => /^ride_/.test(c[0]) && c[0] !== "ride_flags_get").map((c) => c[0]);
      ok(`F1 ${mode === "off" ? "flag ride_v2 OFF" : "old server (no ride RPCs)"}: 'Hämta mig' = the old friend picker, pickup_poll used, no ride_poll / ride_request`,
        /Vem ska få frågan\?/.test(x.text) && !x.rd && s0.calls.some((c) => c[0] === "pickup_poll") && rideCalls.length === 0,
        { text: x.text.slice(0, 120), rideCalls });
      await P0.ctx.close();
    }
  } catch (e) { ok("no exception", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`ride: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
