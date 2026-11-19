// dating2-pw.js — Öppen ikväll (P-088, lane dating2): docs/js/dating*.js + docs/dating.css.
// TWO users (made up: Anton = A, Maja = B) on two phones at the same bar, against ONE fake server in this file that follows the
// rules of supabase/migrations/0530_dating.sql (oi_* RPCs). The rest of Supabase is mocked by d2-helpers.
// Checks: stable + store load no dating code · switch · consent (unticked, explicit) · crowd < 5 = nothing · random delay = nothing
// until notice_at · same notice on both · one "no" = the other sees the neutral text · the game (A Hellre än, B 2 sanningar,
// E Vem ä mest sannolik, D Snabbfrågor, C Gissa vad jag dricker) · each reveal needs both · chat filter · code word · Stopp ·
// report (+ block: never matched again) · auto-off / expiry · safety page help numbers · PGRST202 = hidden · safety rules
// (no count, no place, Stopp + Anmäl on every game screen, 44 px targets, equal buttons, reduced motion).
// Usage: node dating2-pw.js <port>      Pictures: DATING_SHOTS=<dir> node dating2-pw.js <port>
const { ctxFor, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const { CHROME } = require("./env.js");
const PORT = process.argv[2] || 8771, BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.DATING_SHOTS || "";
const BAR = "n3472634175";   // Pitchers: the seed check-in of d2-helpers
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };

/* ---------- the fake server (same rules as 0530; one instance shared by both phones) ---------- */
const NAMES = { A: "Anton", B: "Maja" };
class Fake {
  constructor() { this.reset(); }
  reset() {
    this.crowd = 5; this.missing = false; this.calls = []; this.users = {}; this.pairs = []; this.blocks = new Set(); this.reports = []; this.recent = []; this.n = 0;
    for (const k of ["A", "B"]) this.users[k] = { consent: false, age: true, open: null, paused: false, offers: 3, checkedIn: true };
    this.plans = [[{ t: "A", q: [1, 2, 3, 4] }, { t: "B", q: [1, 2, 3] }, { t: "E", q: [1, 2, 3, 4] }], [{ t: "D", q: [1, 2, 3, 4] }, { t: "C", q: [4] }, { t: "A", q: [5, 6, 7, 8] }]];
  }
  other(k) { return k === "A" ? "B" : "A"; }
  live(k) { return this.pairs.find((p) => (p.a === k || p.b === k) && p.state !== "ended"); }
  last(k) { return this.pairs.filter((p) => (p.a === k || p.b === k) && p.notice).slice(-1)[0]; }
  err(m) { const e = new Error(m); e.pg = m; throw e; }
  tidy(k) {
    const u = this.users[k];
    if (u.open && (!u.checkedIn || u.paused)) u.open = null;
    for (const p of this.pairs) if ((p.a === k || p.b === k) && p.state !== "ended" && (!this.users[p.a].checkedIn || !this.users[p.b].checkedIn)) this.end(p, "left");
  }
  match(k) {
    const o = this.other(k), u = this.users[k], v = this.users[o];
    if (!u.open || !v.open || this.crowd < 5 || this.live(k) || this.live(o) || u.offers < 1 || v.offers < 1) return;
    if (this.blocks.has("A|B") || this.pairs.some((p) => p.night === this.night())) return;
    const fits = (x, y) => !x.want || x.want === "alla" || x.want === y.i_am;
    if (!fits(u.open, v.open) || !fits(v.open, u.open)) return;
    u.offers--; v.offers--;
    this.pairs.push({ id: "00000000-0000-4000-8000-00000000000" + (++this.n), night: this.night(), a: k, b: o, alias: { [k]: "Gul räv", [o]: "Blå uggla" },
      age: { [k]: u.open.age, [o]: v.open.age }, plan: this.plans[this.n >= 3 ? 1 : 0], state: "offered", phase: "offer", ok: {}, ans: {}, round: 1, step: 0,
      steps: { A: 0, B: 0 }, meet: {}, code: null, msgs: [], notice: false, end: null });
  }
  night() { return this.nightN || 1; }
  end(p, why) { if (p.state === "ended") return; p.phase = p.state === "offered" ? "offer" : "game"; p.state = "ended"; p.end = why; }
  items(t) { return t === "B" || t === "C" ? 3 : 4; }
  seen(p, r, i, t) { const j = t === "B" && i === 1 ? 2 : i; return p.ans[r + "." + j + ".A"] != null && p.ans[r + "." + j + ".B"] != null; }
  view(p, k) {
    if (!p || !p.notice) return null;
    if (p.state === "ended") return { id: p.id, state: "ended", ended: true, phase: p.phase };
    if (p.state === "offered") return { id: p.id, state: "offered", mine: p.ok[k] === true ? true : null, left_s: 540 };
    const o = this.other(k), t = p.plan[p.round - 1].t, answers = {}, done = [];
    for (let r = 1; r <= p.round; r++) for (let i = 0; i < 4; i++) {
      const key = r + "." + i, me = p.ans[key + "." + k], th = p.ans[key + "." + o];
      if (me != null || (th != null && this.seen(p, r, i, p.plan[r - 1].t))) answers[key] = {};
      if (me != null) answers[key].me = me;
      if (th != null && this.seen(p, r, i, p.plan[r - 1].t)) answers[key].them = th;
      if (r === p.round && th != null) done.push(i);
    }
    let mine = 0, theirs = 0; for (let i = 0; i < 4; i++) { if (p.ans[p.round + "." + i + "." + k] != null) mine++; if (p.ans[p.round + "." + i + "." + o] != null) theirs++; }
    const rev = {}; if (p.step >= 1) rev.age = p.age[o]; if (p.step >= 2) rev.name = NAMES[o]; if (p.step >= 3) rev.avatar = null;
    return { id: p.id, state: p.state, me: p.alias[k], them: p.alias[o], plan: p.plan, round: p.round, answers, them_done: done,
      complete: p.state === "playing" && mine >= this.items(t) && theirs >= this.items(t), step: p.step, my_step: p.steps[k], reveal: rev,
      msgs: p.state === "chat" ? p.msgs.map((m) => ({ id: m.id, me: m.by === k, body: m.body, at: m.at })) : [],
      meet: { me: !!p.meet[k], code: p.meet.A && p.meet.B ? p.code : null } };
  }
  pairOf(k, id) { const p = this.pairs.find((x) => x.id === id && (x.a === k || x.b === k)); if (!p) this.err("not_in_pair"); return p; }
  call(k, fn, a) {
    this.calls.push({ k, fn, a });
    if (this.missing) return { status: 404, body: { code: "PGRST202", message: "Could not find the function public." + fn + " in the schema cache" } };
    try { return { status: 200, body: this[fn](k, a || {}) }; } catch (e) { if (!e.pg) throw e; return { status: 400, body: { code: "P0001", message: e.pg, details: null, hint: null } }; }
  }
  oi_state(k) {
    this.tidy(k); if (this.users[k].open) this.match(k);
    const u = this.users[k], live = this.live(k), p = live && live.notice ? live : this.last(k);
    return { on: !!u.open, expires_at: u.open ? new Date(Date.now() + 6 * 3600e3).toISOString() : null, consent: u.consent, age_ok: u.age, paused: u.paused, pair: this.view(p, k) };
  }
  oi_give_consent(k, a) { if (a.p_version !== 1) this.err("bad_version"); if (!this.users[k].age) this.err("need_age"); this.users[k].consent = true; return { ok: true, version: 1 }; }
  oi_withdraw(k) { const u = this.users[k]; u.consent = false; u.open = null; const p = this.live(k); if (p) this.end(p, "withdraw"); return { ok: true }; }
  oi_set_open(k, a) {
    const u = this.users[k];
    if (!a.p_on) { u.open = null; const p = this.live(k); if (p) this.end(p, "off"); return { on: false, expires_at: null }; }
    if (!u.consent) this.err("no_consent"); if (u.paused) this.err("paused"); if (!u.checkedIn) this.err("no_checkin");
    if (!["18-24", "25-34", "35-44", "45+"].includes(a.p_age)) this.err("invalid_value");
    if (a.p_acc == null || a.p_acc > 100) this.err("not_exact");
    u.open = { age: a.p_age, i_am: a.p_i_am, want: a.p_want };
    this.match(k);
    return { on: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString() };
  }
  oi_offer(k, a) {
    const p = this.pairOf(k, a.p_pair); if (p.state !== "offered" || !p.notice) this.err("wrong_state");
    if (!a.p_yes) this.end(p, "no"); else { p.ok[k] = true; if (p.ok.A && p.ok.B) { p.state = "playing"; p.phase = "game"; for (const x of ["A", "B"]) this.recent.push({ k: x, ref: p.id, alias: p.alias[this.other(x)] }); } }
    return this.view(p, k);
  }
  oi_answer(k, a) {
    const p = this.pairOf(k, a.p_pair); if (p.state !== "playing") this.err("wrong_state"); if (a.p_round !== p.round) this.err("wrong_round");
    const t = p.plan[p.round - 1].t, v = String(a.p_answer || "").trim();
    if (a.p_item < 0 || a.p_item >= this.items(t)) this.err("bad_answer");
    if ((t === "B" && a.p_item === 0) || (t === "C" && a.p_item === 2)) { const f = filter(v); if (f !== "ok") this.err("filtered_" + f); }
    if (t === "B" && a.p_item === 2 && p.ans[p.round + ".0." + this.other(k)] == null) this.err("wait_other");
    const key = p.round + "." + a.p_item + "." + k; if (p.ans[key] == null) p.ans[key] = v;
    return this.view(p, k);
  }
  oi_step(k, a) {
    const p = this.pairOf(k, a.p_pair); if (p.state !== "playing") this.err("wrong_state");
    const t = p.plan[p.round - 1].t; let n = 0; for (const x of Object.keys(p.ans)) if (x.startsWith(p.round + ".")) n++;
    if (n < 2 * this.items(t)) this.err("not_complete");
    if (!a.p_yes) { this.end(p, "no"); return this.view(p, k); }
    p.steps[k] = Math.max(p.steps[k], p.round);
    if (p.steps.A >= p.round && p.steps.B >= p.round && p.step < p.round) { p.step = p.round; if (p.round >= 3) p.state = "chat"; else p.round++; }
    return this.view(p, k);
  }
  oi_send(k, a) {
    const p = this.pairOf(k, a.p_pair); if (p.state !== "chat") this.err("wrong_state");
    const f = filter(a.p_body); if (f !== "ok") return { ok: false, filtered: f };
    p.msgs.push({ id: p.msgs.length + 1, by: k, body: String(a.p_body).trim(), at: new Date().toISOString() }); return { ok: true, id: p.msgs.length };
  }
  oi_meet(k, a) { const p = this.pairOf(k, a.p_pair); if (p.state !== "chat") this.err("wrong_state"); p.meet[k] = true; if (p.meet.A && p.meet.B && !p.code) p.code = "Hjortron"; return this.view(p, k); }
  oi_stop(k, a) { const p = this.pairOf(k, a.p_pair); this.end(p, "stop"); return { ok: true }; }
  oi_block(k, a) { const p = this.pairOf(k, a.p_pair); this.blocks.add("A|B"); this.end(p, "block"); return { ok: true }; }
  oi_report(k, a) {
    const p = this.pairOf(k, a.p_pair); if (!["hot", "sex", "minor", "fake", "meet", "other"].includes(a.p_reason)) this.err("invalid_reason");
    this.reports.push({ by: k, reason: a.p_reason, note: a.p_note, snapshot: { msgs: p.msgs.length } }); if (a.p_block !== false) this.blocks.add("A|B");
    this.end(p, "report"); if (a.p_reason === "minor") this.users[this.other(k)].paused = true; return { ok: true };
  }
  oi_recent(k) { return this.recent.filter((r) => r.k === k).map((r) => ({ ref: r.ref, alias: r.alias, name: null, night: "2026-11-20", reported: this.reports.some((x) => x.by === k) })); }
}
// the same rules as olnu_oi_filter (server) and PN.oiLogic.filter (client)
function filter(t) {
  const v = String(t || "").toLowerCase();
  if (v.replace(/[^0-9]/g, "").length >= 7 && /\d[\d\s().+\/-]{5,}\d/.test(v)) return "phone";
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(v)) return "mail";
  if (/(https?:|www\.|[a-z0-9-]+\.(se|com|nu)\b)/.test(v)) return "link";
  if (/(^|[^a-z0-9])@[a-z0-9_.]{2,}/.test(v)) return "handle";
  return "ok";
}
const F = new Fake();

/* ---------- phones ---------- */
async function phone(browser, k, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.beta !== false) await ctx.addInitScript(() => { window.PN_BETA = "abc1234"; });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.acct.nudged", String(Date.now())); } catch (e) {} });   // no "Säkra kontot" sheet in the way
  if (k === "B") await ctx.addInitScript(() => { try { localStorage.setItem("olnu.name", "Maja"); } catch (e) {} });
  const errs = [], files = [];
  page.on("pageerror", (e) => errs.push(k + " " + page.url().slice(0, 60) + " " + e.message + " " + String(e.stack || "").split("\n").slice(1, 3).join(" ")));
  page.on("request", (q) => { const u = q.url(); if (/dating-(core|ui|logic|content)\.js|dating\.css/.test(u)) files.push(u.replace(/^.*\//, "")); });
  await page.route(/rest\/v1\/rpc\/((?:oi|owner_oi)_\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const a = F.call(k, fn, body);
    return r.fulfill({ status: a.status, contentType: "application/json", body: JSON.stringify(a.body) });
  });
  await page.goto(BASE + "?bar=" + BAR);
  await page.waitForFunction(() => window.PNI && document.querySelector(".bs .ci-out[data-ciout]"), null, { timeout: 30000 }).catch(() => console.log("no bar sheet for " + k));
  await wait(page, o.settle || 3500);
  return { ctx, page, errs, files, k };
}
const poll = (p) => p.page.evaluate(() => window.PN && PN.oiCore ? PN.oiCore.poll().then(() => true) : false);
const shot = async (p, name) => { if (!SHOTS) return; await p.page.screenshot({ path: SHOTS + "/" + name + ".png" }); console.log("shot", name); };
const txt = (p, sel) => p.page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const click = (p, sel) => p.page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const clickText = (p, sel, re) => p.page.evaluate(([s, r]) => { const e = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); if (e) e.click(); return !!e; }, [sel, re]);
const toasts = (p) => p.page.evaluate(() => [...document.querySelectorAll("#toasts .toast, .toast")].map((t) => t.textContent.replace(/\s+/g, " ").trim()));
const clearToasts = (p) => p.page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
const sheetTitle = (p) => txt(p, "#sheet-title");
async function settleBoth(a, b, ms) { await Promise.all([poll(a), poll(b)]); await wait(a.page, ms || 500); await Promise.all([poll(a), poll(b)]); await wait(a.page, 300); }

// answer whatever item the game screen asks (any of the 5 types), like a person would
async function answerOne(p) {
  return p.page.evaluate(() => {
    const ui = document.querySelector(".oi-ui"); if (!ui) return "no-ui";
    const amber = () => [...ui.querySelectorAll(".oi-btns .btn-amber")].pop();
    const lines = ui.querySelectorAll(".oi-line-row .oi-line");
    if (lines.length === 3) {
      ["Jag har åkt Vasaloppet", "Jag har sett norrsken från ett tåg", "Jag kan alla verser i Änglamark"].forEach((v, i) => { lines[i].value = v; lines[i].dispatchEvent(new Event("input")); });
      ui.querySelectorAll(".oi-lie")[1].click(); amber().click(); return "B-write";
    }
    const one = ui.querySelector("input.oi-line");
    if (one) { one.value = "Raggmunk med lingon"; amber().click(); return "C-follow"; }
    const segs = ui.querySelectorAll(".oi-seg");
    if (segs.length === 2) { segs[0].children[0].click(); segs[1].children[1].click(); amber().click(); return "E"; }
    const opt = ui.querySelector(".oi-opts .oi-opt:not([disabled])");
    if (opt) { opt.click(); amber().click(); return "pick"; }
    return "none";
  });
}
async function playRound(a, b) {
  const done = [];
  for (let i = 0; i < 12; i++) {
    let moved = false;
    for (const p of [a, b]) {
      const n = await p.page.evaluate(() => { const s = PN.oiLogic.screen(PN.oiCore.S.st, PN.oiCore.S.local); return s.name; });
      if (n === "play") { done.push(p.k + ":" + (await answerOne(p))); moved = true; await wait(p.page, 250); }
    }
    await settleBoth(a, b, 200);
    if (!moved) break;
  }
  return done;
}
const screenOf = (p) => p.page.evaluate(() => PN.oiLogic.screen(PN.oiCore.S.st, PN.oiCore.S.local));
// every button in our UI: >= 44 px high
const smallTargets = (p) => p.page.evaluate(() => [...document.querySelectorAll(".oi-ui button, .oi-sec button, .oi-sec [role=button], .oi-card button, .oi-ui a")]
  .filter((b) => b.offsetParent && !b.closest("[hidden]") && !b.classList.contains("switch"))   // the app's .switch: 52 × 32 drawn, 48 px hit area (ds.css ::before).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }; })
  .filter((r) => r.h < 44 || r.w < 44));
const hasStopReport = (p) => p.page.evaluate(() => !!document.querySelector(".oi-ui .oi-stop") && !!document.querySelector(".oi-ui .oi-rep"));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    /* 1. stable channel and store build: no dating code at all */
    for (const [name, o] of [["stable", { beta: false }], ["store build (beta code)", { beta: true, store: true }]]) {
      const s = await phone(browser, "A", o);
      const r = await s.page.evaluate(() => ({ sec: !!document.querySelector(".oi-sec"), core: !!(window.PN && PN.oiCore), logic: !!(window.PN && PN.oiLogic),
        allowed: !!(window.DATING && DATING.allowed()), css: !!document.getElementById("oi-css") }));
      ok(name + ": no section, no code, no stylesheet", !r.sec && !r.core && !r.logic && !r.allowed && !r.css, r);
      ok(name + ": no dating file was requested", s.files.length === 0, s.files);
      ok(name + ": no oi_* RPC was called", !F.calls.length, F.calls.map((c) => c.fn));
      await s.ctx.close(); F.calls = [];
    }

    /* 2. beta: the section, the switch, the consent sheet */
    const A = await phone(browser, "A"), B = await phone(browser, "B");
    let sec = await A.page.evaluate(() => { const s = document.querySelector(".bs .oi-sec"), act = document.querySelector(".bs .pp-act");
      return s ? { rows: s.querySelectorAll(".oi-row:not([hidden])").length, sw: s.querySelector(".oi-switch").getAttribute("aria-checked"), after: !!(act && act.nextElementSibling === s), t: s.textContent } : null; });
    ok("beta: Ikväll section in the checked-in bar sheet, right under Checka ut", sec && sec.rows === 3 && sec.after && /Öppen ikväll/.test(sec.t) && /Stängs av själv/.test(sec.t), sec);
    ok("beta: the switch starts off", sec && sec.sw === "false", sec);
    ok("beta: the lazy files came with ?b=<sha>", A.files.some((f) => /dating-core\.js\?b=abc1234/.test(f)) && !A.files.some((f) => /dating-ui/.test(f)), A.files);
    ok("no count: the section has no number of people", sec && !/\d/.test(sec.t.replace(/Kl 05|kl 06|05|06/g, "")), sec && sec.t);
    await shot(A, "01-section");
    await click(A, ".oi-sec .oi-switch"); await wait(A.page, 900);
    let c = await A.page.evaluate(() => { const b = document.querySelector("#sheet-body"), go = b && b.querySelector(".oi-go"), cb = b && b.querySelector(".oi-consent");
      return { title: document.getElementById("sheet-title").textContent, facts: b ? b.querySelectorAll(".oi-list .oi-row").length : 0, stored: b ? /raderas kl 06/.test(b.textContent) : false,
        cb: cb ? cb.checked : null, go: go ? go.disabled : null, ages: b ? b.querySelectorAll(".oi-seg")[0].children.length : 0 }; });
    ok("consent: its own sheet, 4 facts, says what is stored and until when", c.title === "Öppen ikväll" && c.facts === 4 && c.stored, c);
    ok("consent: the box starts unticked, Jag ä med is off", c.cb === false && c.go === true, c);
    ok("consent: the age group choice is there (18–24 … 45+)", c.ages === 4, c);
    await A.page.evaluate(() => { document.querySelectorAll("#sheet-body .oi-seg")[0].children[1].click(); });
    ok("consent: an age group alone does not enable it", await A.page.evaluate(() => document.querySelector("#sheet-body .oi-go").disabled));
    await A.page.evaluate(() => { const b = document.querySelector("#sheet-body"); b.querySelectorAll(".oi-seg")[1].children[1].click(); b.querySelectorAll(".oi-seg")[2].children[0].click(); });
    await shot(A, "02-consent-top");
    await A.page.evaluate(() => { const x = document.querySelector("#sheet-body .oi-consent"); x.click(); document.querySelector("#sheet-body").scrollTop = 9999; });
    ok("consent: the ticked box enables Jag ä med", !(await A.page.evaluate(() => document.querySelector("#sheet-body .oi-go").disabled)));
    await wait(A.page, 500); await shot(A, "02-consent-bottom");   // the button colour eases in after enable
    await click(A, "#sheet-body .oi-go"); await wait(A.page, 1500);
    ok("switch: consent version 1 sent, then oi_set_open with age group", F.calls.some((x) => x.fn === "oi_give_consent" && x.a.p_version === 1) &&
      F.calls.some((x) => x.k === "A" && x.fn === "oi_set_open" && x.a.p_on === true && x.a.p_age === "25-34"), F.calls.map((x) => x.fn));
    ok("switch: on after the sheet", (await A.page.evaluate(() => document.querySelector(".oi-sec .oi-switch").getAttribute("aria-checked"))) === "true");
    ok("location: only oi_set_open carries a position (checked and forgotten by the server)", F.calls.filter((x) => JSON.stringify(x.a).match(/lat|lng/)).every((x) => x.fn === "oi_set_open"));

    /* 3. B turns on too. Crowd 4 = nothing; crowd 5 = a pair, hidden until notice_at */
    F.crowd = 4;
    await click(B, ".oi-sec .oi-switch"); await wait(B.page, 800);
    await B.page.evaluate(() => { const b = document.querySelector("#sheet-body"); b.querySelectorAll(".oi-seg")[0].children[0].click(); b.querySelectorAll(".oi-seg")[1].children[0].click();
      b.querySelectorAll(".oi-seg")[2].children[1].click(); b.querySelector(".oi-consent").click(); b.querySelector(".oi-go").click(); });
    await wait(B.page, 1500); await settleBoth(A, B);
    ok("threshold: 4 checked in = no pair, no notice on either phone", !F.pairs.length && !(await A.page.$(".oi-card")) && !(await B.page.$(".oi-card")));
    F.crowd = 5; await settleBoth(A, B);
    ok("threshold: 5 checked in = the server makes a pair", F.pairs.length === 1);
    ok("delay: before notice_at nobody sees anything", !(await A.page.$(".oi-card")) && !(await B.page.$(".oi-card")));
    F.pairs[0].notice = true; await settleBoth(A, B);
    const nA = await txt(A, ".oi-card"), nB = await txt(B, ".oi-card");
    ok("notice: the same text on both phones", nA && nA === nB && /Nån mer här ä öppen ikväll/.test(nA), [nA, nB]);
    ok("notice: no count, no place, no who", nA && !/(\d+ (st|personer|öppna|här)|meter|\bm bort|Pitchers)/.test(nA), nA);
    const eq = await A.page.evaluate(() => { const b = [...document.querySelectorAll(".oi-card .oi-btns .btn")].map((x) => x.getBoundingClientRect()); return b.length === 2 ? [Math.round(b[0].width), Math.round(b[1].width), Math.round(b[0].height)] : null; });
    ok("notice: Inte ikväll and Kör! are the same size, 44+ px", eq && Math.abs(eq[0] - eq[1]) <= 1 && eq[2] >= 44, eq);
    await shot(A, "03-notice");

    /* 4. one "no": the other side sees the same neutral text as a timeout */
    await click(A, ".oi-card .oi-yes"); await wait(A.page, 700);
    ok("offer: A said yes and waits; B is not told", /Väntar på den andra/.test(await txt(A, ".oi-card") || "") && /Kör ni ett matchspel/.test(await txt(B, ".oi-card") || ""));
    await clearToasts(A); await clearToasts(B);
    await click(B, ".oi-card .oi-no"); await wait(B.page, 500); await settleBoth(A, B);
    const tA = await toasts(A), tB = await toasts(B);
    ok("no: A sees the neutral line (no reason, no who)", tA.some((t) => /Det blev inget den här gången. Du ä fortfarande öppen/.test(t)) && !tA.some((t) => /nej|sa nej|declined/i.test(t)), tA);
    ok("no: B (who said no) gets no extra line", !tB.some((t) => /Det blev inget/.test(t)), tB);
    ok("no: the card is gone on both", !(await A.page.$(".oi-card")) && !(await B.page.$(".oi-card")));
    ok("no: the switch stays on for both", (await A.page.evaluate(() => document.querySelector(".oi-sec .oi-switch").getAttribute("aria-checked"))) === "true");

    /* 5. a new night: the full game */
    F.nightN = 2; await settleBoth(A, B); F.pairs[1].notice = true; await settleBoth(A, B);
    await click(A, ".oi-card .oi-yes"); await click(B, ".oi-card .oi-yes"); await wait(A.page, 1200); await settleBoth(A, B, 800);
    ok("game: Kör! on both = the game sheet opens by itself on both", (await sheetTitle(A)) === "Matchspelet" && (await sheetTitle(B)) === "Matchspelet", [await sheetTitle(A), await sheetTitle(B)]);
    const vs = await txt(A, ".oi-ui .oi-vs");
    ok("game: aliases only (Du ä Gul räv · mot Blå uggla), no name", /Gul räv/.test(vs || "") && /Blå uggla/.test(vs || "") && !/Maja|Anton/.test(vs || ""), vs);
    ok("game: Stopp + Anmäl on the game screen", await hasStopReport(A));
    await shot(A, "04-game-hellre");
    // the HUD chip "Matchspel pågår" brings a closed game back (one urgent chip, only while a game runs)
    await A.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(A.page, 700);
    await A.page.evaluate(() => { try { PN.updateCounts(); } catch (e) {} }); await wait(A.page, 200);
    const chip = await A.page.evaluate(() => { const c = document.querySelector('#hud-x [data-hx="oi"]'); return c ? c.textContent.trim() : null; });
    ok("HUD: the chip 'Matchspel pågår' shows while the game runs and its sheet is closed", chip === "Matchspel pågår", chip);
    await A.page.evaluate(() => { const c = document.querySelector('#hud-x [data-hx="oi"]'); if (c) c.click(); }); await wait(A.page, 700);
    ok("HUD: the chip opens the game again", (await sheetTitle(A)) === "Matchspelet", await sheetTitle(A));
    // A answers the first item: B sees "Blå uggla/Gul räv har svarat", not the answer
    await answerOne(A); await settleBoth(A, B, 300);
    const st1 = await txt(B, ".oi-ui .oi-their:not([hidden])");
    ok("answers: B sees that A answered, not what", /har svarat/.test(st1 || ""), st1);
    await shot(B, "04b-game-their-answer");
    const r1 = await playRound(A, B);
    let sA = await screenOf(A), sB = await screenOf(B);
    ok("round 1 (Hellre än): both answered all 4, then the reveal question", sA.name === "decide" && sB.name === "decide", [sA, sB, r1]);
    const score = await txt(A, ".oi-ui .oi-score");
    ok("round 1: the score 'Ni tänker lika x av y' is shown", /Ni tänker lika/.test(score || "") && /\d av \d/.test(score || ""), score);
    await shot(A, "05-decide");
    // step 1: A yes, B not yet → nothing revealed to anyone
    await clickText(A, ".oi-ui .btn-amber", "Visa åldersgrupp"); await wait(A.page, 400); await settleBoth(A, B);
    sA = await screenOf(A); sB = await screenOf(B);
    ok("step 1: one yes = A waits, B still decides, nothing is revealed", sA.name === "waitStep" && sB.name === "decide" &&
      !(await A.page.evaluate(() => JSON.stringify(PN.oiCore.S.st.pair.reveal) !== "{}")), [sA, sB]);
    await clickText(B, ".oi-ui .btn-amber", "Visa åldersgrupp"); await wait(B.page, 400); await settleBoth(A, B);
    const rv1 = await txt(A, ".oi-ui");
    ok("step 1: both yes = the age group on both phones (A sees Maja's 18–24)", (await sheetTitle(A)) === "Ni båda ville" && /18–24/.test(rv1 || "") && !/Maja/.test(rv1 || ""), rv1);
    await shot(A, "06a-reveal-age");
    await clickText(A, ".oi-ui .btn-amber", "Nästa runda"); await clickText(B, ".oi-ui .btn-amber", "Nästa runda"); await settleBoth(A, B);
    // round 2: 2 sanningar, 1 lögn
    ok("round 2 is 2 sanningar, 1 lögn: three lines + mark the lie", await A.page.evaluate(() => document.querySelectorAll(".oi-ui .oi-line-row").length === 3),
      [await screenOf(A), await sheetTitle(A), (await txt(A, "#sheet-body") || "").slice(0, 160), await A.page.evaluate(() => JSON.stringify(PN.oiCore.S.local))]);
    await A.page.evaluate(() => { const i = document.querySelectorAll(".oi-ui .oi-line"); i[0].value = "ring 070-123 45 67"; i[1].value = "Jag har en katt"; i[2].value = "Jag har bott i Kiruna";
      i.forEach((x) => x.dispatchEvent(new Event("input"))); document.querySelectorAll(".oi-ui .oi-lie")[2].click(); document.querySelector(".oi-ui .oi-btns .btn-amber").click(); });
    await wait(A.page, 400);
    ok("filter: a phone number in a line is stopped before sending", /Telefonnummer skickas inte här/.test(await txt(A, ".oi-ui .oi-filter") || "") &&
      !F.calls.some((x) => x.fn === "oi_answer" && /070/.test(x.a.p_answer || "")));
    await shot(A, "07a-game-lies-filter");
    await A.page.evaluate(() => { const i = document.querySelectorAll(".oi-ui .oi-line"); i[0].value = "Jag har åkt Vasaloppet"; i[0].dispatchEvent(new Event("input")); });
    await playRound(A, B);
    await shot(B, "07b-game-lie-guess-done");
    sA = await screenOf(A);
    ok("round 2: done, the lie is shown after both guessed", sA.name === "decide" && /Lögnen|Rätt!/.test(await txt(A, ".oi-ui .oi-res") || ""), sA);
    await shot(A, "07c-decide-lies");
    await clickText(A, ".oi-ui .btn-amber", "Visa förnamn"); await clickText(B, ".oi-ui .btn-amber", "Visa förnamn"); await wait(A.page, 300); await settleBoth(A, B);
    ok("step 2: the first name (A sees Maja)", /Maja/.test(await txt(A, ".oi-ui .oi-name") || ""), await txt(A, ".oi-ui .oi-name"));
    await clickText(A, ".oi-ui .btn-amber", "Nästa runda"); await clickText(B, ".oi-ui .btn-amber", "Nästa runda"); await settleBoth(A, B);
    ok("round 3 is Vem ä mest sannolik att…: jag / inte jag + a guess", await A.page.evaluate(() => document.querySelectorAll(".oi-ui .oi-seg").length === 2));
    await shot(A, "08-game-likely");
    await playRound(A, B);
    await clickText(A, ".oi-ui .btn-amber", "Visa bild"); await clickText(B, ".oi-ui .btn-amber", "Visa bild"); await wait(A.page, 300); await settleBoth(A, B);
    const pic = await A.page.evaluate(() => { const p = document.querySelector(".oi-ui .oi-pic.on"); return { svg: !!(p && p.querySelector("svg")), t: document.querySelector(".oi-ui").textContent }; });
    ok("step 3: the picture (the avatar) shows, steps list all done", pic.svg && /Visas nu/.test(pic.t) && /Steg 3 av 3/.test(pic.t), pic.t.slice(0, 200));
    ok("reveal: Stopp + Anmäl on the reveal screen", await hasStopReport(A));
    await shot(A, "09-reveal-picture");

    /* 6. chat: filters, code word */
    await clickText(A, ".oi-ui .btn-amber", "Chatta"); await clickText(B, ".oi-ui .btn-amber", "Chatta"); await settleBoth(A, B);
    ok("chat: Maja's chat opens with the first system line", (await sheetTitle(A)) === "Maja" && /Ni ville båda vidare/.test(await txt(A, ".oi-ui .oi-sys") || ""), await sheetTitle(A));
    ok("chat: Stopp + Anmäl on the chat screen", await hasStopReport(A));
    for (const bad of ["ring mig 070-123 45 67", "+46 70 123 45 67", "maja@exempel.se", "www.exempel.se", "adda @maja_92"]) {
      await A.page.fill(".oi-ui .oi-in", bad); await click(A, ".oi-ui .oi-send"); await wait(A.page, 200);
    }
    ok("chat filter: phone (both formats), e-mail, link, @handle never reach the server", !F.calls.some((x) => x.fn === "oi_send") &&
      !(await A.page.evaluate(() => document.querySelector(".oi-ui .oi-filter").hidden)));
    await A.page.fill(".oi-ui .oi-in", "Bastu i fjällen, respekt. Men Vasaloppet? Nä."); await click(A, ".oi-ui .oi-send"); await wait(A.page, 500); await settleBoth(A, B);
    ok("chat: B gets the message", /Bastu i fjällen/.test(await txt(B, ".oi-ui .oi-log") || ""));
    await B.page.fill(".oi-ui .oi-in", "Haha nä. Du gissade fel på mitt glas dock"); await click(B, ".oi-ui .oi-send"); await wait(B.page, 500); await settleBoth(A, B);
    await A.page.fill(".oi-ui .oi-in", "070-123 45 67"); await click(A, ".oi-ui .oi-send"); await wait(A.page, 200);
    await shot(A, "10-chat-filter");
    await click(A, ".oi-ui .oi-meet .btn"); await wait(A.page, 400); await settleBoth(A, B);
    ok("meet: one tap = A waits, B sees only the question (not that A wants to)", /Du vill ses/.test(await txt(A, ".oi-ui .oi-meet") || "") && /Vill du ses\?/.test(await txt(B, ".oi-ui .oi-meet") || ""));
    await click(B, ".oi-ui .oi-meet .btn"); await wait(B.page, 400); await settleBoth(A, B);
    const wA = await txt(A, ".oi-ui .oi-word"), wB = await txt(B, ".oi-ui .oi-word");
    ok("code word: the same word on both phones, no place", wA && wA === wB && !/(meter|Pitchers|bord)/.test(await txt(A, ".oi-ui") || ""), [wA, wB]);
    ok("code word: Stopp + Anmäl on the code screen", await hasStopReport(A));
    await shot(A, "11-code-word");
    ok("targets: every button in our screens is 44 px or more", !(await smallTargets(A)).length, await smallTargets(A));

    /* 7. Stopp ends it for both at once */
    await click(A, ".oi-ui .oi-stop"); await wait(A.page, 400);
    ok("stop: a confirm sheet first (Avbryt / Stoppa)", (await sheetTitle(A)) === "Stoppa spelet?");
    await shot(A, "12-stop-confirm");
    await clearToasts(B);
    await click(A, ".oi-ui .oi-stop-yes"); await wait(A.page, 600); await settleBoth(A, B);
    ok("stop: A sees 'Spelet ä stoppat för er båda.'", /Spelet ä stoppat för er båda/.test(await txt(A, ".oi-ui") || ""));
    const endB = (await toasts(B)).concat([await txt(B, ".oi-ui") || ""]).join(" | ");
    ok("stop: B sees the same neutral end as any other end", /Spelet ä slut för ikväll. Tack för sällskapet/.test(endB) && !/stopp/i.test(endB.replace(/Stopp|Anmäl/g, "")), endB);
    await shot(B, "13-ended-other-side");
    await A.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await B.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); });

    /* 8. game 2: Snabbfrågor + Gissa vad jag dricker, then a report with block */
    F.nightN = 3; F.users.A.offers = 3; F.users.B.offers = 3; await settleBoth(A, B); F.pairs[2].notice = true; await settleBoth(A, B);
    await click(A, ".oi-card .oi-yes"); await click(B, ".oi-card .oi-yes"); await wait(A.page, 1200); await settleBoth(A, B, 800);
    ok("Snabbfrågor: a 5 s timer shows", /^[0-5]$/.test(await txt(A, ".oi-ui .oi-timer") || ""), await txt(A, ".oi-ui .oi-timer"));
    await shot(A, "14-game-quick");
    await playRound(A, B);
    await clickText(A, ".oi-ui .btn-amber", "Visa åldersgrupp"); await clickText(B, ".oi-ui .btn-amber", "Visa åldersgrupp"); await wait(A.page, 300); await settleBoth(A, B);
    await clickText(A, ".oi-ui .btn-amber", "Nästa runda"); await clickText(B, ".oi-ui .btn-amber", "Nästa runda"); await settleBoth(A, B);
    const gl = await A.page.evaluate(() => [...document.querySelectorAll(".oi-ui .oi-opt")].map((x) => x.textContent));
    ok("Gissa vad jag dricker: alkoholfritt and water are equal options, no counts", gl.length === 6 && gl.some((x) => /Alkoholfritt/.test(x)) && gl.some((x) => /Vatten/.test(x)) && !gl.some((x) => /\d+ ?(st|cl|%)/.test(x)), gl);
    await shot(A, "15-game-glass");
    await clearToasts(A);
    await click(B, ".oi-ui .oi-rep"); await wait(B.page, 500);
    const rep = await B.page.evaluate(() => { const b = document.querySelector(".oi-ui"); return { t: b.textContent, reasons: b.querySelectorAll(".oi-radio").length, block: b.querySelector(".oi-check input").checked, tel: !!b.querySelector('a[href="tel:112"]') }; });
    ok("report: anonymous, 6 reasons, block on by default, 112 card", /Anonymt\. (Gul räv|Blå uggla) får inte veta/.test(rep.t) && rep.reasons === 6 && rep.block && rep.tel, rep);
    await shot(B, "16-report");
    await click(B, ".oi-ui .oi-rep-send"); await wait(B.page, 300);
    ok("report: send without a reason = asks for one", /Välj vad som hände/.test(await txt(B, ".oi-ui .oi-msg") || "") && !F.reports.length);
    await B.page.evaluate(() => document.querySelectorAll(".oi-ui .oi-radio")[1].click());
    await click(B, ".oi-ui .oi-rep-send"); await wait(B.page, 700); await settleBoth(A, B);
    ok("report: sent with block; B sees what happens next", F.reports.length === 1 && F.reports[0].reason === "sex" && F.blocks.has("A|B") && /Det här händer nu/.test(await txt(B, ".oi-ui") || ""), F.reports);
    await shot(B, "17-report-done");
    const endA = (await toasts(A)).concat([await txt(A, ".oi-ui") || ""]).join(" | ");
    ok("report: A (reported) sees the same neutral end, never 'reported'", /Spelet ä slut för ikväll. Tack för sällskapet/.test(endA) && !/anmäl(d|an)/i.test(endA.replace(/Anmäl\b/g, "")), endA);
    F.nightN = 4; await settleBoth(A, B);
    ok("block: A and B are never matched again", F.pairs.length === 3);
    await A.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await B.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); });
    await wait(B.page, 600);   // sheetnav.js closes with an async history.go(-1); a person never re-opens within a few ms (a faster re-open drains history)

    /* 9a. Inställningar → Integritet & synlighet has the row "Öppen ikväll" (beta only) */
    await B.page.evaluate(() => window.PN.showSettings("s", "synl")); await wait(B.page, 1500);
    const setRow = await B.page.evaluate(() => { const r = document.querySelector("#sheet-body .oi-set"); return r ? { vis: !!r.offsetParent, t: r.textContent.trim() } : null; });
    ok("settings: Integritet & synlighet has the Öppen ikväll row", setRow && setRow.vis && /Öppen ikväll/.test(setRow.t), setRow);
    await B.page.evaluate(() => { const r = document.querySelector("#sheet-body .oi-set"); if (r) r.scrollIntoView({ block: "center" }); }); await wait(B.page, 300);
    await shot(B, "20-settings-row");
    await B.page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(B.page, 600);

    /* 9. safety page, recent list, auto-off */
    await click(B, ".oi-sec .oi-row-go"); await wait(B.page, 900);
    const safe = await B.page.evaluate(() => { const b = document.querySelector(".oi-ui"); return b ? { t: b.textContent, tel: [...b.querySelectorAll("a[href^='tel:']")].map((a) => a.getAttribute("href")) } : null; });
    ok("safety: rules + help numbers 112, 114 14, 116 016 (tel links)", safe && /Minst 5 incheckade/.test(safe.t) && /Kvinnofridslinjen 116 016/.test(safe.t) && /114 14/.test(safe.t) &&
      ["tel:112", "tel:116016", "tel:11414"].every((x) => safe.tel.includes(x)), safe);
    ok("safety: withdraw + report from the last 7 days + hide are there", safe && /Ta tillbaka samtycket/.test(safe.t) && /Anmäl nån från Öppen ikväll/.test(safe.t) && /Visa inte funktionen alls/.test(safe.t));
    await shot(B, "18-safety");
    await B.page.evaluate(() => { document.querySelector("#sheet-body").scrollTop = 9999; }); await shot(B, "18b-safety-bottom");
    await clickText(B, ".oi-ui .oi-row-go", "Anmäl nån från"); await wait(B.page, 700);
    ok("recent: the game is in the 7-day list, marked as reported", /Gul räv/.test(await txt(B, ".oi-ui") || "") && /Anmäld/.test(await txt(B, ".oi-ui") || ""), await txt(B, ".oi-ui"));
    await shot(B, "19-recent");
    await click(B, ".oi-ui .oi-back"); await wait(B.page, 500);   // back to the safety page in place (no sheet close: see DONE "sheetnav")
    ok("recent: '‹ Säkerhet' goes back to the safety page", (await sheetTitle(B)) === "Säkerhet");
    // auto-off: the check-in ended (check-out / 05:00): the server says off, the phone says so once
    await clearToasts(A); F.users.A.checkedIn = false; await poll(A); await wait(A.page, 400);
    ok("auto-off: 'Öppen ikväll ä av. God natt!' and the switch is off", (await toasts(A)).some((t) => /Öppen ikväll ä av. God natt/.test(t)) &&
      (await A.page.evaluate(() => { const s = document.querySelector(".oi-sec .oi-switch"); return !s || s.getAttribute("aria-checked") === "false"; })), await toasts(A));
    ok("auto-off: the local 'on tonight' record is gone", !(await A.page.evaluate(() => localStorage.getItem("olnu.oi.on"))));
    // withdraw consent
    await clickText(B, ".oi-ui .oi-row-go", "Ta tillbaka samtycket"); await wait(B.page, 600);
    ok("withdraw: one tap, consent gone, off", !F.users.B.consent && !F.users.B.open && (await toasts(B)).some((t) => /Samtycket ä borta/.test(t)),
      [F.users.B, await toasts(B), await sheetTitle(B), (await txt(B, "#sheet-body") || "").slice(0, 200)]);
    ok("no page errors on either phone", !A.errs.length && !B.errs.length, A.errs.concat(B.errs));
    await A.ctx.close(); await B.ctx.close();

    /* 10. a missing server (PGRST202) = the feature hides quietly; reduced motion = still */
    F.reset(); F.missing = true;
    const M = await phone(browser, "A", { reduced: true });
    await M.page.evaluate(() => { const s = document.querySelector(".oi-sec .oi-switch"); if (s) s.click(); }); await wait(M.page, 1200);
    const m = await M.page.evaluate(() => ({ sec: !!document.querySelector(".oi-sec"), gone: sessionStorage.getItem("olnu.oi.gone") }));
    ok("PGRST202: the section goes away, nothing else breaks", !m.sec && m.gone === "1" && !M.errs.length, [m, M.errs]);
    F.missing = false; F.users.A.consent = true; F.users.A.open = { age: "25-34" }; F.users.B.open = { age: "25-34" };
    await M.page.evaluate(() => sessionStorage.removeItem("olnu.oi.gone")); await M.page.goto(BASE + "?bar=" + BAR); await wait(M.page, 5000);
    F.match("A"); F.pairs[0].notice = true; await poll(M); await wait(M.page, 500);
    const anim = await M.page.evaluate(() => { const c = document.querySelector(".oi-card"); return c ? getComputedStyle(c).animationName : "no card"; });
    ok("reduced motion: the notice card does not move", anim === "none", anim);
    await M.ctx.close();
  } catch (e) {
    fail++; console.log("FAIL crashed", e && e.stack);
  } finally {
    await browser.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
