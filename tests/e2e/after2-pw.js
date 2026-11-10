// lane after (big update, 10 Nov): A2 Kvällsrapporten (swipe cards → 9:16 share card), R1-11 MEDEVAC = chip only (no red
// card), R1-39 Mina kvällar without an empty chip. Usage: node after2-pw.js <port> [tag]
// Server side (0450, owner-run) is tested on staging by SQL (scratchpad after/DONE.md); here the client runs against mocks.
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const SP = require("./env.js").OUT, DIR = SP + "after2-shots/";
fs.mkdirSync(DIR, { recursive: true });
const TAG = process.argv[3] || "t";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 500))); c ? pass++ : fail++; };
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: DIR + TAG + "-" + name + ".png" }).catch(() => {});

// ---------- one night of the gang "Grabbarna Grus" (after_report2 shape, 0450) ----------
const NIGHT = (() => { const d = new Date(); d.setHours(5, 0, 0, 0); return d; })();   // last night ended 05:00 today (local tz of the runner)
const at = (h, m) => { const d = new Date(NIGHT); d.setDate(d.getDate() - (h >= 12 ? 1 : 0)); d.setHours(h, m, 0, 0); return d.toISOString(); };
const PITCH = [60.14997, 15.18679], LOBBY = [60.15098, 15.18663], BRYG = [60.1531, 15.1932];
function report(o = {}) {
  return Object.assign({ v: 1, night: NIGHT.toISOString(), evening: at(18, 0).slice(0, 10),
    group: { id: GID, name: "Grabbarna Grus" }, groups: [{ id: GID, name: "Grabbarna Grus", n: 5, me: true }],
    people: [
      { k: "k-anton", name: "Anton", is_me: true, first_at: at(20, 47), last_at: at(23, 30), first_place: "Pitchers", bars: 1, said_ute: true, said_at: at(18, 12), home_at: at(0, 40), skal: 3, driver: false, out: true },
      { k: "k-oskar", name: "Oskar", is_me: false, first_at: at(21, 21), last_at: at(1, 50), first_place: "Pitchers", bars: 2, said_ute: true, said_at: at(19, 2), home_at: at(2, 41), skal: 0, driver: false, out: true },
      { k: "k-lisa", name: "Lisa", is_me: false, first_at: at(21, 30), last_at: at(0, 15), first_place: "Pitchers", bars: 3, said_ute: false, said_at: null, home_at: at(1, 0), skal: 5, driver: false, out: true },
      { k: "k-sara", name: "Sara", is_me: false, first_at: at(22, 0), last_at: at(0, 30), first_place: "Lobbybaren", bars: 1, said_ute: true, said_at: at(19, 30), home_at: at(1, 30), skal: 1, driver: true, out: true },
      { k: "k-jonte", name: "Jonte", is_me: false, first_at: null, last_at: null, first_place: null, bars: 0, said_ute: true, said_at: at(18, 30), home_at: null, skal: 0, driver: false, out: false }],
    stops: [
      { k: "k-anton", at: at(20, 47), bar_id: "n3472634175", name: "Pitchers", lat: PITCH[0], lng: PITCH[1] },
      { k: "k-oskar", at: at(21, 21), bar_id: "n3472634175", name: "Pitchers", lat: PITCH[0], lng: PITCH[1] },
      { k: "k-lisa", at: at(21, 30), bar_id: "n3472634175", name: "Pitchers", lat: PITCH[0], lng: PITCH[1] },
      { k: "k-sara", at: at(22, 0), bar_id: "x-lobby", name: "Lobbybaren", lat: LOBBY[0], lng: LOBBY[1] },
      { k: "k-oskar", at: at(22, 5), bar_id: "x-lobby", name: "Lobbybaren", lat: LOBBY[0], lng: LOBBY[1] },
      { k: "k-lisa", at: at(22, 10), bar_id: "x-lobby", name: "Lobbybaren", lat: LOBBY[0], lng: LOBBY[1] },
      { k: "k-lisa", at: at(0, 15), bar_id: "x-bryg", name: "Bryggeriet", lat: BRYG[0], lng: BRYG[1] }],
    homes: [{ lat: 60.1560, lng: 15.1770 }, { lat: 60.1470, lng: 15.2040 }],
    prev: { night: "2026-10-31T04:00:00Z", evening: "2026-10-30", n_out: 3, first_at: at(21, 0), last_home: at(1, 30), last_at: at(1, 10), bars: 2 },
    ghost_me: false, bets: [], missions: [], agent: null }, o);
}
async function ctx(browser, w, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: HT[w] || 844 }, o);
  if (o.report !== undefined) await page.route(/rest\/v1\/rpc\/after_report2\b/, (r) => typeof o.report === "function" ? o.report(r) : J(r, o.report));
  return { ctx, page };
}
const allCardText = (page) => page.evaluate(async () => {
  const out = []; const st = () => window.AFTER2 && window.AFTER2._st();
  for (let i = 0; i < 20 && st(); i++) {
    out.push(document.querySelector(".a2-card") ? document.querySelector(".a2-card").innerText : "");
    const n = document.querySelector('.a2 [data-a2="next"]'); if (!n || n.disabled) break;
    n.click(); await new Promise((r) => setTimeout(r, 60));
  }
  return out;
});

const ONLY = process.argv[4] || "";
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ---------- R1-11: MEDEVAC = the HUD chip only, never the red card (Oskar is on 11 in the mock) ---------- */
    if (!ONLY || ONLY === "r1") for (const w of W3) {
      const { ctx: c, page } = await ctx(browser, w);
      await page.addInitScript(() => {
        window.__medToast = 0;
        document.addEventListener("DOMContentLoaded", () => {
          const t = document.getElementById("toasts");
          if (t) new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("med")) window.__medToast++; }))).observe(t, { childList: true, subtree: true });
        });
      });
      await boot(page);
      await wait(page, 4000);
      const r = await page.evaluate(() => ({ red: window.__medToast, vis: [...document.querySelectorAll(".toast.med")].filter((x) => !x.hidden && x.offsetParent).length,
        chip: !!document.querySelector(".af-chip-med"), anim: (() => { const e = document.querySelector(".af-chip-med"); return e ? getComputedStyle(e).animationIterationCount : null; })() }));
      ok(`R1-11 no red MEDEVAC card on the map @${w}`, r.red === 0 && r.vis === 0, r);
      ok(`R1-11 the HUD chip is the one signal @${w}`, r.chip, r);
      ok(`R1-11 chip pulse stops (no endless loop) @${w}`, r.anim !== "infinite", r);
      await shot(page, "r1-11-map-" + w);
      // a sheet open: still no red toast at the top
      await page.evaluate(() => { localStorage.removeItem("olnu.afMedSeen"); });
      await page.evaluate(() => { const b = document.querySelector('[data-hx="afmed"]'); if (b) b.click(); });
      await wait(page, 800);
      const sheet = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: (document.getElementById("sheet-title") || {}).textContent || "" }));
      ok(`R1-11 chip tap opens the Kompisvakt sheet @${w}`, sheet.open && /Kompisvakt/.test(sheet.title), sheet);
      if (w === 360) await shot(page, "r1-11-sheet-360");
      await c.close();
    }

    /* ---------- R1-39: Mina kvällar, no empty round chip ---------- */
    if (!ONLY || ONLY === "r1") for (const w of W3) {
      const { ctx: c, page } = await ctx(browser, w);
      await page.route(/rest\/v1\/rpc\/my_night_log\b/, (r) => J(r, { v: 1, night: null, evening: null, tonight: false, source: "none", nights: [], stats: { drinks: 0 }, items: [] }));
      await boot(page);
      await page.evaluate(() => window.NIGHTLOG.open(null));
      await wait(page, 1200);
      const r = await page.evaluate(() => ({ chips: [...document.querySelectorAll(".nl-night")].map((x) => x.textContent.trim()), lead: (document.querySelector(".nl-lead") || {}).textContent }));
      ok(`R1-39 no empty chip above the empty log @${w}`, r.chips.length === 0 && /\S/.test(r.lead || ""), r);
      await shot(page, "r1-39-" + w);
      await c.close();
    }
    {
      const { ctx: c, page } = await ctx(browser, 390);
      const n1 = NIGHT.toISOString(), n0 = new Date(NIGHT.getTime() - 7 * 864e5).toISOString();
      await page.route(/rest\/v1\/rpc\/my_night_log\b/, (r) => J(r, { v: 1, night: n1, evening: "x", tonight: false, source: "log", nights: [{ night: n1, evening: "a", drinks: 3 }, { night: n0, evening: "b", drinks: 2 }],
        stats: { drinks: 3, first_at: at(21, 0), last_at: at(23, 0), bars: 1, kinds: { beer: 3 } }, items: [] }));
      await boot(page);
      await page.evaluate(() => window.NIGHTLOG.open(null)); await wait(page, 1200);
      const chips = await page.evaluate(() => [...document.querySelectorAll(".nl-night")].map((x) => x.textContent.trim()));
      ok("R1-39 two real nights still give two labelled chips", chips.length === 2 && chips.every((x) => /\S/.test(x)), chips);
      await c.close();
    }

    /* ---------- A2: the report from the push link /?after=<gid> ---------- */
    for (const w of W3) {
      const { ctx: c, page } = await ctx(browser, w, { report: report() });
      await page.goto(`http://127.0.0.1:${process.argv[2]}/?after=${GID}`);
      await page.waitForFunction(() => window.AFTER2 && window.AFTER2._st && window.AFTER2._st(), null, { timeout: 30000 }).catch(() => {});
      await wait(page, 900);
      const r0 = await page.evaluate(() => ({ open: !!(window.AFTER2 && window.AFTER2._st()), vis: !!document.querySelector(".a2:not([hidden])"), title: (document.querySelector(".a2-title") || {}).textContent,
        segs: document.querySelectorAll(".a2-seg").length, url: location.search }));
      ok(`A2 push link opens the report on the intro card @${w}`, r0.open && r0.vis && r0.title === "Grabbarna Grus" && !/after=/.test(r0.url), r0);
      // every card fits (no horizontal overflow, footer buttons >= 44 px)
      const shots = [];
      for (let i = 0; i < r0.segs; i++) {
        const f = await page.evaluate(() => {
          const a = document.querySelector(".a2"), card = document.querySelector(".a2-card");
          const btns = [...document.querySelectorAll(".a2 button")].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); });
          return { type: card && card.className, over: a.scrollWidth > a.clientWidth + 1 || [...card.querySelectorAll("*")].filter((e) => !e.closest(".a2-art")).some((e) => e.getBoundingClientRect().right > innerWidth + 1),
            small: btns.filter((x) => x < 43.5).length };
        });
        if (f.over || f.small) ok(`A2 card ${i + 1} fits at ${w} px`, false, f);
        await shot(page, `a2-card${i + 1}-${w}`); shots.push(f.type);
        await page.evaluate(() => { const n = document.querySelector('.a2 [data-a2="next"]'); if (n && !n.disabled) n.click(); });
        await wait(page, 380);
      }
      ok(`A2 ${r0.segs} cards, none cut or with small targets @${w}`, shots.length === r0.segs && r0.segs >= 6, shots);
      await c.close();
    }
    {
      const { ctx: c, page } = await ctx(browser, 390, { report: report() });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 900);
      // one award per person, from the data; no drink award
      const m = await page.evaluate(() => window.AFTER2._st().m.people.map((p) => ({ n: p.name, a: p.aw.id, t: p.aw.name })));
      const by = Object.fromEntries(m.map((x) => [x.n, x.a]));
      ok("A2 every person has exactly one award", m.length === 5 && m.every((x) => x.a && x.t), m);
      ok("A2 awards come from the data (kapten = first out, sist = last home, hoppare = most bars, chaufför, spöke)",
        by.Anton === "kapten" && by.Oskar === "sist" && by.Lisa === "hopp" && by.Sara === "chauf" && by.Jonte === "spoke", by);
      const txt = (await allCardText(page)).join("\n");
      ok("A2 no 'Snabbaste pinten' and no drink counts in any card", !/Snabbast|pint|öl per|antal öl/i.test(txt.replace(/inga öl per person/i, "")), txt.slice(0, 300));
      ok("A2 compare card: later home than last time", /senare än förra gången|tidigare än förra gången/.test(txt), txt.slice(-600));
      ok("A2 story card: the night minute by minute", /öppnade kvällen på Pitchers/.test(txt) && /drog vidare till Lobbybaren/.test(txt) && /släckte lyset/.test(txt), txt);
      ok("A2 numbers card: bars, km, hours, skål", /krogar/.test(txt) && /km marsch/.test(txt) && /timmar i fält/.test(txt), txt.slice(0, 400));
      // navigation: back, tap zones, Escape, Android back
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 600);
      const nav = await page.evaluate(async () => {
        const st = () => window.AFTER2._st(), r = document.querySelector(".a2-stage").getBoundingClientRect();
        const tap = (x) => document.querySelector(".a2-stage").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: r.top + r.height / 2 }));
        tap(r.left + r.width * 0.8); await new Promise((z) => setTimeout(z, 50)); const a = st().i;
        tap(r.left + r.width * 0.8); await new Promise((z) => setTimeout(z, 50)); const b = st().i;
        tap(r.left + r.width * 0.1); await new Promise((z) => setTimeout(z, 50)); const c = st().i;
        return [a, b, c];
      });
      ok("A2 tap right = next, tap left = back", nav[0] === 1 && nav[1] === 2 && nav[2] === 1, nav);
      await page.keyboard.press("Escape"); await wait(page, 600);
      ok("A2 Escape closes the report", await page.evaluate(() => !window.AFTER2._st() && document.querySelector(".a2").hidden));
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 600);
      await page.goBack(); await wait(page, 700);
      ok("A2 Android back closes the report", await page.evaluate(() => !window.AFTER2._st()));
      // share card: 9:16, toggles change it, the share sheet has the 2 switches + the primary
      await page.evaluate(() => window.AFTER2.open(null, null));
      await page.waitForFunction(() => document.querySelector('.a2 [data-a2="prev"]'), null, { timeout: 8000 }).catch(() => console.log("no overlay", ""));
      await page.evaluate(() => { const st = window.AFTER2._st(); st.i = st.m.cards.length - 2; document.querySelector('.a2 [data-a2="next"]').click(); });
      await wait(page, 400);
      await shot(page, "a2-end-390");
      await page.evaluate(() => document.querySelector('.a2 [data-a2="shareAll"]').click()); await wait(page, 1600);
      const sh = await page.evaluate(() => {
        const cv = document.querySelector(".a2-sh-cv"); if (!cv) return null;
        const px = (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007; return s; };
        const a = px(cv);
        document.querySelector('.a2-sw-row[data-k="names"]').click();
        return { w: cv.width, h: cv.height, a, sw: document.querySelectorAll(".a2-sw-row").length, pri: !!document.querySelector('.a2-sh [data-a2="send"].a2-pri'), cvRef: true };
      });
      await wait(page, 900);
      const after = await page.evaluate(() => { const c = document.querySelector(".a2-sh-cv"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007; return s; });
      ok("A2 share card is a 1080 x 1920 (9:16) image", sh && sh.w === 1080 && sh.h === 1920 && sh.a > 0, sh);
      ok("A2 share sheet: Visa namn + Visa kartlinjen switches, one primary", sh && sh.sw === 2 && sh.pri, sh);
      ok("A2 'Visa namn' off redraws the card without names", sh && after !== sh.a, { before: sh && sh.a, after });
      await shot(page, "a2-share-390");
      // privacy of the image: no home point is drawn as a pin (homes are rings only) — the model keeps only grid areas
      const pr = await page.evaluate(() => { const m = window.AFTER2._st().m; return { homes: m.homes.length, routeBars: m.route.map((s) => s.name) }; });
      ok("A2 the route is bars only (homes = rings, never on the line)", pr.routeBars.join(",") === "Pitchers,Lobbybaren,Bryggeriet" && pr.homes === 2, pr);
      await c.close();
    }
    // screenshots of the share card and sheet at 360 / 430 too
    for (const w of [360, 430]) {
      const { ctx: c, page } = await ctx(browser, w, { report: report() });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 600);
      await page.evaluate(() => { const st = window.AFTER2._st(); st.i = st.m.cards.length - 2; document.querySelector('.a2 [data-a2="next"]').click(); });
      await wait(page, 400);
      await page.evaluate(() => document.querySelector('.a2 [data-a2="shareAll"]').click()); await wait(page, 1600);
      const f = await page.evaluate(() => { const b = document.querySelector(".a2-sh-card").getBoundingClientRect(); return { fits: b.right <= innerWidth + 1 && b.left >= -1 }; });
      ok(`A2 share sheet fits @${w}`, f.fits, f);
      await shot(page, "a2-share-" + w);
      await c.close();
    }
    // the share image itself (for the owner): render it big
    {
      const { ctx: c, page } = await ctx(browser, 390, { report: report() });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 600);
      const png = await page.evaluate(async () => { const cv = document.createElement("canvas"); await document.fonts.ready; window.AFTER2._drawShare(cv, window.AFTER2._st().m, { names: true, route: true }); return cv.toDataURL("image/png"); });
      fs.writeFileSync(DIR + TAG + "-a2-share-image.png", Buffer.from(png.split(",")[1], "base64"));
      const one = await page.evaluate(async () => { const cv = document.createElement("canvas"); const st = window.AFTER2._st(); window.AFTER2._drawCard(cv, st.m.cards[1], st.m); return cv.toDataURL("image/png"); });
      fs.writeFileSync(DIR + TAG + "-a2-card2-image.png", Buffer.from(one.split(",")[1], "base64"));
      ok("A2 card images render", png.length > 20000 && one.length > 20000, [png.length, one.length]);
      await c.close();
    }
    /* ---------- the morning: 11:00 Stockholm → a calm toast + the HUD chip; seen = no second RPC that day ---------- */
    {
      const { ctx: c, page } = await ctx(browser, 390, { report: report() });
      const t11 = new Date(); t11.setUTCHours(10, 0, 0, 0);   // 11:00 CET (Nov)
      await page.clock.setFixedTime(t11);
      let calls = 0; page.on("request", (q) => { if (/rpc\/after_report2\b/.test(q.url())) calls++; });
      await page.addInitScript(() => { window.__t = []; document.addEventListener("DOMContentLoaded", () => { const t = document.getElementById("toasts"); if (t) new MutationObserver(() => { window.__t.push(t.textContent); }).observe(t, { childList: true, subtree: true }); }); });
      await boot(page); await wait(page, 2500);
      await page.evaluate(() => document.getElementById("my-streak").click()); await wait(page, 400);   // the Ikväll panel
      const r = await page.evaluate(() => ({ toast: (window.__t || []).join(" | "), chip: (document.querySelector(".a2-chip") || {}).textContent || "", bakis: /Bakisrapporten/.test((document.getElementById("sheet-title") || {}).textContent || "") && !document.getElementById("sheet").hidden }));
      ok("A2 morning: toast 'Kvällsrapporten från … ä klar' + HUD chip, no Bakis sheet on top", /Kvällsrapporten från Grabbarna Grus ä klar|rapporten från fronten ä klar/.test(r.toast) && /Rapporten/.test(r.chip) && !r.bakis, r);
      await shot(page, "a2-morning-chip-390");
      await page.evaluate(() => { const b = document.querySelector('[data-hx="a2"]'); if (b) b.click(); }); await wait(page, 800);
      ok("A2 morning: the chip opens the cards", await page.evaluate(() => !!window.AFTER2._st()));
      await page.evaluate(() => window.AFTER2._st() && document.querySelector('.a2 [data-a2="x"]').click()); await wait(page, 600);
      const n1 = calls;
      await page.reload(); await wait(page, 5000);
      ok("A2 morning: seen today = no new report call and no chip after a restart", calls === n1 && !(await page.evaluate(() => !!document.querySelector(".a2-chip"))), { n1, calls });
      await c.close();
    }
    /* ---------- edge cases: ghost me, a lone person, old server ---------- */
    {
      const gh = report({ ghost_me: true }); gh.people = gh.people.filter((p) => !p.is_me);   // the server leaves a ghost night out
      const { ctx: c, page } = await ctx(browser, 390, { report: gh });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 600);
      const t = await page.evaluate(() => document.querySelector(".a2-card").innerText);
      ok("A2 ghost night: I am told I am not in the report", /spökläge/i.test(t), t);
      await c.close();
    }
    {
      const lone = report(); lone.people = lone.people.slice(0, 1);
      const { ctx: c, page } = await ctx(browser, 390, { report: lone });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 900);
      ok("A2 a night with one person gives no report (needs the gang)", await page.evaluate(() => !window.AFTER2._st()));
      await c.close();
    }
    {
      const { ctx: c, page } = await ctx(browser, 390, { report: (r) => J(r, { code: "PGRST202", message: "Could not find the function public.after_report2" }, 404) });
      await page.goto(`http://127.0.0.1:${process.argv[2]}/?after=${GID}`);
      await wait(page, 6000);
      const r = await page.evaluate(() => ({ off: window.AFTER2 && window.AFTER2.off(), open: !!(window.AFTER2 && window.AFTER2._st()), chip: !!document.querySelector(".a2-chip") }));
      ok("A2 old server: the report hides quietly (no overlay, no chip)", r.off === true && !r.open && !r.chip, r);
      await c.close();
    }
    {
      // more than ten people, long names: one award each, the end card scrolls inside the card, no overflow
      const big = report(); big.people = [];
      for (let i = 0; i < 12; i++) big.people.push({ k: "k" + i, name: i === 3 ? "Maximilian-Alexander von Långnamnsson" : "Soldat " + i, is_me: i === 0, first_at: at(20, 10 + i * 3), last_at: at(23, 0),
        first_place: "Pitchers", bars: i % 4, said_ute: true, said_at: at(18, 0), home_at: i % 3 ? at(0, i * 4) : null, skal: i % 5, driver: false, out: i !== 11 });
      const { ctx: c, page } = await ctx(browser, 360, { report: big });
      await boot(page);
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 700);
      const r = await page.evaluate(() => {
        const st = window.AFTER2._st(); const ids = st.m.people.map((p) => p.aw && p.aw.id);
        st.i = st.m.cards.length - 2; document.querySelector('.a2 [data-a2="next"]').click();
        return { n: ids.length, all: ids.every(Boolean) };
      });
      await wait(page, 500); await shot(page, "a2-end-12-360");
      r.over = await page.evaluate(() => { const a = document.querySelector(".a2"), c = document.querySelector(".a2-card"); return a.scrollWidth > a.clientWidth + 1 || c.scrollWidth > c.clientWidth + 1; });
      r.names = await page.evaluate(() => [...document.querySelectorAll(".a2-aw-x b")].map((b) => b.textContent));
      ok("A2 12 people incl. a very long name: one award each, no overflow at 360", r.n === 12 && r.all && !r.over, r);
      ok("A2 the fallback award names take turns (no two the same in a row)", r.names.every((x, i) => i === 0 || x !== r.names[i - 1] || !/Lugna|Stabil|Fotfolket/.test(x)), r.names);
      await c.close();
    }
  } catch (e) { ok("run without error", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`after2: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
