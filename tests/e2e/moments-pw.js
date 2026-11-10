// lane after (big update, 10 Nov): GM7 moments (Kvällens vad, Halvtid, Uppdrag vid bordet, Hemlig agent) + GM4 room card,
// and the moments in the morning report (Oraklet). Usage: node moments-pw.js <port> [tag]
// Server side (0451/0452, owner-run) is tested in Postgres (scratchpad after/sql-test-all.sql, 51 checks); here the client
// runs against mocked rounds (the olnu_mom_view shape).
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const SP = require("./env.js").OUT, DIR = SP + "moments-shots/";
fs.mkdirSync(DIR, { recursive: true });
const TAG = process.argv[3] || "t";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 500))); c ? pass++ : fail++; };
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: DIR + TAG + "-" + name + ".png" }).catch(() => {});
const ME = "aaaaaaaaaaaa", OS = "bbbbbbbbbbbb", LI = "cccccccccccc", SA = "dddddddddddd";
const NAMES = { [ME]: "Anton", [OS]: "Oskar", [LI]: "Lisa", [SA]: "Sara" };
const soon = (m) => new Date(Date.now() + m * 60e3).toISOString();
const base = (o) => Object.assign({ group_id: GID, group_name: "Ludvika Lager", me: ME, asked: true, names: NAMES, n_picks: 0, n_who: 4, picks: null, answer: null,
  mine: null, closes_at: soon(50), reveal_at: null, mission: null, agent_me: false, host_me: false, agent_k: null, done_at: null, done_by: null, bar_name: null, night: soon(400) }, o);
const VAD = () => base({ id: 101, kind: "vad", q: "first_home", phase: "open", opts: [{ v: ME }, { v: OS }, { v: LI }, { v: SA }] });
const HALV = () => base({ id: 102, kind: "halvtid", q: "last_home_t", phase: "open", opts: [{ v: "f01" }, { v: "01_02" }, { v: "e02" }], n_who: 3 });
const BORD = () => base({ id: 103, kind: "bord", q: "", phase: "open", opts: [], bar_name: "Pitchers", mission: 3, n_who: 3 });
const AG = (o) => base(Object.assign({ id: 104, kind: "agent", q: "", phase: "secret", opts: [], reveal_at: soon(90), closes_at: soon(105), mission: null }, o));
function view(r) { return JSON.parse(JSON.stringify(r)); }

async function setup(browser, w, rounds, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: HT[w] || 844 }, Object.assign({ empty: true }, o));
  const S = { rounds: rounds.map(view), calls: [] };
  await page.route(/rest\/v1\/rpc\/(after_flags_get|moments_poll|moment_pick|moment_done|moment_reveal|moments_report|party_group)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    S.calls.push([fn, b]);
    if (o.old && fn !== "after_flags_get") return J(r, { code: "PGRST202", message: "Could not find the function public." + fn }, 404);
    if (fn === "after_flags_get") return J(r, { v: 1, flags: { moments: o.flag !== false, push_ev: false } });
    if (fn === "moments_poll") return J(r, { v: 1, on: o.flag !== false, opened: 0, rounds: S.rounds });
    if (fn === "moments_report") return J(r, { v: 1, rounds: o.report || [] });
    if (fn === "party_group") return J(r, o.room ? { v: 1, room: o.room } : { v: 1, room: null });
    const x = S.rounds.find((q) => q.id === b.p_round);
    if (!x) return J(r, { code: "P0001", message: "not_found" }, 400);
    if (fn === "moment_pick") { x.mine = b.p_pick; x.picks = [{ k: ME, pick: b.p_pick, right: false }, { k: OS, pick: LI, right: false }]; x.n_picks = x.picks.length; }
    if (fn === "moment_done") { x.done_at = new Date().toISOString(); x.done_by = "Anton"; if (x.kind === "bord") x.phase = "done"; }
    if (fn === "moment_reveal") { x.phase = "vote"; }
    return J(r, view(x));
  });
  return { ctx, page, S };
}
const toastSpy = () => { window.__t = []; document.addEventListener("DOMContentLoaded", () => { const t = document.getElementById("toasts"); if (t) new MutationObserver(() => window.__t.push(t.textContent)).observe(t, { childList: true, subtree: true }); }); };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* flag off (default fixtures): nothing polls, nothing shows */
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { empty: true });
      const calls = []; page.on("request", (q) => { const m = q.url().match(/rpc\/(moments_poll|after_flags_get)\b/); if (m) calls.push(m[1]); });
      await boot(page); await wait(page, 3000);
      const r = await page.evaluate(() => ({ chip: !!document.querySelector(".mo-chip"), M: !!window.MOMENTS, off: window.MOMENTS && window.MOMENTS.off() }));
      ok("GM7 flag off: no moments_poll, no chip, module off", r.M && r.off && !r.chip && !calls.includes("moments_poll"), { r, calls });
      await ctx.close();
    }
    /* Kvällens vad: toast + chip (closed pill), the card = the answer buttons, pick → the others' picks */
    for (const w of W3) {
      const { ctx, page, S } = await setup(browser, w, [VAD()]);
      await page.addInitScript(toastSpy);
      await boot(page); await wait(page, 4500);
      const r = await page.evaluate(() => ({ toasts: (window.__t || []).join(" | "), pill: !!document.querySelector(".hud-left:not(.open) .mo-chip.hx-urgent"),
        chip: (document.querySelector(".mo-chip") || {}).textContent || "" }));
      ok(`GM7 vad: toast "Kvällens vad: Vem går hem först?" + Svara @${w}`, /Vem går hem först\?/.test(r.toasts) && /Svara/.test(r.toasts), r);
      ok(`GM7 vad: the chip shows on the closed Ikväll pill @${w}`, r.pill && /Kvällens vad/.test(r.chip), r);
      if (w === 390) await shot(page, "vad-chip-390");
      await page.evaluate(() => document.querySelector(".mo-chip").click()); await wait(page, 800);
      const c = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, q: (document.querySelector(".mo-q") || {}).textContent,
        opts: [...document.querySelectorAll(".mo-opt")].map((b) => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height })), hidden: (document.querySelector(".mo-sub") || {}).textContent,
        over: document.getElementById("sheet-body").scrollWidth > document.getElementById("sheet-body").clientWidth + 1 }));
      ok(`GM7 vad card: question + 4 faces (≥ 56 px), others hidden until I pick @${w}`, /Kvällens vad/.test(c.title) && c.q === "Vem går hem först?" && c.opts.length === 4 &&
        c.opts.every((o) => o.h >= 55.5) && /Tippa själv/.test(c.hidden) && !c.over, c);
      await shot(page, "vad-card-" + w);
      await page.evaluate(() => [...document.querySelectorAll(".mo-opt")].find((b) => /Lisa/.test(b.textContent)).click()); await wait(page, 700);
      const p = await page.evaluate(() => ({ on: (document.querySelector(".mo-opt.on") || {}).textContent, small: [...document.querySelectorAll(".mo-opt small")].map((x) => x.textContent), sub: document.querySelector(".mo-sub").textContent }));
      ok(`GM7 vad pick: saved (moment_pick p_pick = Lisa's face), the picks show @${w}`, S.calls.some((x) => x[0] === "moment_pick" && x[1].p_round === 101 && x[1].p_pick === "cccccccccccc") &&
        /Lisa/.test(p.on || "") && p.small.length >= 1 && /2 av 4/.test(p.sub), { p, calls: S.calls.filter((x) => x[0] === "moment_pick") });
      await shot(page, "vad-picked-" + w);
      await ctx.close();
    }
    /* early settle: the poll brings the answer → "Lisa hade rätt!" toast + the card shows the answer */
    {
      const r1 = Object.assign(VAD(), { mine: LI, n_picks: 2, picks: [{ k: ME, pick: LI }, { k: OS, pick: OS }] });
      const { ctx, page, S } = await setup(browser, 390, [r1]);
      await page.addInitScript(toastSpy);
      await boot(page); await wait(page, 4000);
      S.rounds = [Object.assign(view(r1), { phase: "settled", answer: { v: LI }, picks: [{ k: ME, pick: LI, right: true }, { k: OS, pick: OS, right: false }] })];
      await page.evaluate(() => window.MOMENTS.poll()); await wait(page, 800);
      const t = await page.evaluate(() => (window.__t || []).join(" | "));
      ok("GM7 early settle: toast 'Du hade rätt i Kvällens vad!'", /Du hade rätt i Kvällens vad/.test(t), t);
      await page.evaluate(() => window.MOMENTS.open(101)); await wait(page, 700);
      const c = await page.evaluate(() => ({ res: (document.querySelector(".mo-res") || {}).textContent, right: !!document.querySelector(".mo-opt.right"), dis: [...document.querySelectorAll(".mo-opt")].every((b) => b.disabled) }));
      ok("GM7 settled card: 'Svar: Lisa', right option marked, no more picks", /Svar: Lisa/.test(c.res || "") && c.right && c.dis, c);
      await shot(page, "vad-settled-390");
      await ctx.close();
    }
    /* Halvtid: 3 options in one row; Uppdrag vid bordet: mission + Klart */
    for (const w of W3) {
      const { ctx, page, S } = await setup(browser, w, [HALV(), BORD()]);
      await boot(page); await wait(page, 4000);
      await page.evaluate(() => window.MOMENTS.open(102)); await wait(page, 700);
      const h = await page.evaluate(() => ({ q: document.querySelector(".mo-q").textContent, o: [...document.querySelectorAll(".mo-opt")].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.top), r.height >= 55.5, r.right <= innerWidth]; }) }));
      ok(`GM7 Halvtid: 3 options in one row, ≥ 56 px, inside the screen @${w}`, h.q === "När ä sista person hemma?" && h.o.length === 3 && new Set(h.o.map((x) => x[1])).size === 1 && h.o.every((x) => x[2] && x[3]), h);
      await shot(page, "halvtid-" + w);
      await page.evaluate(() => window.MOMENTS.open(103)); await wait(page, 700);
      const b = await page.evaluate(() => ({ lead: document.querySelector(".mo-sub").textContent, q: document.querySelector(".mo-q").textContent, btn: !!document.querySelector('.mo [data-mo-a="done"].mo-pri') }));
      ok(`GM7 bordet: "3 i plutonen på Pitchers", the mission, one Klart @${w}`, /3 i plutonen på Pitchers/.test(b.lead) && /allvarliga soldatmin/.test(b.q) && b.btn, b);
      await shot(page, "bord-" + w);
      await page.evaluate(() => document.querySelector('.mo [data-mo-a="done"]').click()); await wait(page, 700);
      const d = await page.evaluate(() => (document.querySelector(".mo-res") || {}).textContent || "");
      ok(`GM7 bordet: Klart → moment_done + "Klart … · Anton tryckte" @${w}`, S.calls.some((x) => x[0] === "moment_done" && x[1].p_round === 103) && /Anton tryckte/.test(d), d);
      await ctx.close();
    }
    /* Hemlig agent: the agent sees the mission + Klart; the others see the secret; the host reveals; vote; result */
    for (const w of W3) {
      const { ctx, page, S } = await setup(browser, w, [AG({ agent_me: true, mission: 5 })]);
      await boot(page); await wait(page, 4000);
      await page.evaluate(() => window.MOMENTS.open(104)); await wait(page, 700);
      const a = await page.evaluate(() => ({ q: document.querySelector(".mo-q").textContent, m: (document.querySelector(".mo-mission") || {}).textContent, done: !!document.querySelector('.mo [data-mo-a="done"]') }));
      ok(`GM7 agent: "Du ä kvällens hemliga agent" + the mission + Klart @${w}`, /hemliga agent/.test(a.q) && /Kexchoklad eller Japp/.test(a.m || "") && a.done, a);
      await shot(page, "agent-me-" + w);
      await ctx.close();
    }
    {
      const { ctx, page, S } = await setup(browser, 390, [AG({ host_me: true })]);
      await boot(page); await wait(page, 4000);
      await page.evaluate(() => window.MOMENTS.open(104)); await wait(page, 700);
      const s = await page.evaluate(() => ({ q: document.querySelector(".mo-q").textContent, mission: !!document.querySelector(".mo-mission"), rev: !!document.querySelector('.mo [data-mo-a="reveal"]') }));
      ok("GM7 agent (not me): 'En agent finns bland er', no mission, the host has Avslöja", /En agent finns bland er/.test(s.q) && !s.mission && s.rev, s);
      await shot(page, "agent-secret-390");
      await page.evaluate(() => document.querySelector('.mo [data-mo-a="reveal"]').click()); await wait(page, 800);
      const v = await page.evaluate(() => ({ q: document.querySelector(".mo-q").textContent, faces: [...document.querySelectorAll(".mo-opt")].map((b) => b.textContent.trim()) }));
      ok("GM7 Avslöja → moment_reveal → vote: the faces without me", S.calls.some((x) => x[0] === "moment_reveal") && /Vem ä agenten/.test(v.q) && v.faces.length === 3 && !v.faces.some((f) => /Anton|Du/.test(f)), v);
      await shot(page, "agent-vote-390");
      S.rounds[0] = Object.assign(S.rounds[0], { phase: "done", agent_k: OS, mission: 7, answer: { v: OS, votes: 3, right: 0, done: true, won: true } });
      await page.evaluate(() => window.MOMENTS.poll()); await wait(page, 800);
      const d = await page.evaluate(() => document.querySelector(".mo").innerText);
      ok("GM7 agent result: 'Agenten var Oskar!' + mission + 'Agenten vann'", /Agenten var Oskar!/.test(d) && /Uppdraget: Säg "det ä fakta"/.test(d) && /Agenten vann/.test(d), d);
      await shot(page, "agent-done-390");
      await ctx.close();
    }
    /* the push link /?mom=<id> opens that card */
    {
      const { ctx, page } = await setup(browser, 390, [VAD(), BORD()]);
      await page.goto(`http://127.0.0.1:${process.argv[2]}/?mom=103`);
      await page.waitForFunction(() => document.querySelector('.mo[data-mo="103"]'), null, { timeout: 20000 }).catch(() => {});
      const r = await page.evaluate(() => ({ card: !!document.querySelector('.mo[data-mo="103"]'), url: location.search }));
      ok("GM7 push link /?mom=103 opens the Uppdrag card, the param is removed", r.card && !/mom=/.test(r.url), r);
      await ctx.close();
    }
    /* GM4: the room card for the group page */
    {
      const { ctx, page } = await setup(browser, 390, [], { room: { id: "r1", code: "WXYZ", game: "imposter", host_name: "Oskar", n: 3, is_in: false } });
      await boot(page); await wait(page, 2000);
      const t = await page.evaluate(async () => { const b = window.MOMENTS.roomCard({ id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" }); document.body.appendChild(b); await new Promise((r) => setTimeout(r, 800)); return { t: b.textContent, hidden: b.hidden }; });
      ok("GM4 room card: 'Partyspel pågår · Imposter' + 'Oskar ä värd · 3 med · Hoppa in'", /Partyspel pågår · Imposter/.test(t.t) && /Oskar ä värd · 3 med · Hoppa in/.test(t.t) && !t.hidden, t);
      await ctx.close();
    }
    /* the morning report: the bet card + Oraklet for the right picker */
    {
      const NIGHT = new Date(); NIGHT.setHours(5, 0, 0, 0);
      const at = (h, m) => { const d = new Date(NIGHT); d.setDate(d.getDate() - (h >= 12 ? 1 : 0)); d.setHours(h, m, 0, 0); return d.toISOString(); };
      const rep = { v: 1, night: NIGHT.toISOString(), evening: "2026-11-09", group: { id: GID, name: "Ludvika Lager" }, groups: [],
        people: [{ k: ME, name: "Anton", is_me: true, first_at: at(20, 0), out: true, home_at: at(0, 30), bars: 1 },
          { k: OS, name: "Oskar", first_at: at(20, 30), out: true, home_at: at(1, 30), bars: 1 },
          { k: LI, name: "Lisa", first_at: at(21, 0), out: true, home_at: at(0, 10), bars: 1 }],
        stops: [], homes: [], prev: null, ghost_me: false };
      const settled = Object.assign(VAD(), { phase: "settled", answer: { v: LI }, picks: [{ k: ME, pick: OS, right: false }, { k: LI, pick: LI, right: true }] });
      const { ctx, page } = await setup(browser, 390, [], { flag: false, report: [settled] });
      await page.route(/rest\/v1\/rpc\/after_report2\b/, (r) => J(r, rep));
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 900);
      const m = await page.evaluate(() => { const st = window.AFTER2._st(); return st ? { aw: st.m.people.map((p) => p.name + ":" + p.aw.id), cards: st.m.cards.map((c) => c.type + ":" + (c.kick || "")) } : null; });
      ok("GM7 report: Lisa (right pick) is Oraklet, a 'Kvällens vad' card is in the report", m && m.aw.includes("Lisa:orakel") && m.cards.some((c) => /^list:Kvällens vad/.test(c)), m);
      const txt = await page.evaluate(async () => { const st = window.AFTER2._st(); st.i = st.m.cards.findIndex((c) => c.kick === "Kvällens vad") - 1; document.querySelector('.a2 [data-a2="next"]').click(); await new Promise((r) => setTimeout(r, 400)); return document.querySelector(".a2-card").innerText; });
      ok("GM7 report card text: question, answer, who was right", /Vem går hem först\?/.test(txt) && /Svar: Lisa/.test(txt) && /Lisa hade rätt/.test(txt), txt);
      await shot(page, "report-vad-390");
      await ctx.close();
    }
    /* old server: moments_poll missing → quiet */
    {
      const { ctx, page } = await setup(browser, 390, [VAD()], { old: true });
      await boot(page); await wait(page, 5000);
      const r = await page.evaluate(() => ({ chip: !!document.querySelector(".mo-chip"), off: window.MOMENTS.off() }));
      ok("GM7 old server (PGRST202): no chip, module off, no error", !r.chip && r.off, r);
      await ctx.close();
    }
  } catch (e) { ok("run without error", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`moments: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
