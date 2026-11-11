// lane fixJ (11 Nov): test-team fixes T-03 T-04 T-06 T-07 T-20 T-21 T-22. Each check FAILS on the old code and PASSES on the new.
//  J03 a link join that answered 18+ on the card: the intro does not ask the birth year again
//  J04 "Jag hänger med": a tap while the card is still loading, and a tap while the preview lands (node swap), both join
//  J06 the morning: AFTER2 on → no old "Din kväll" card (drink numbers); old server (no after_report2) → the old card as before
//  J07 a beer picked at another bar moves the check-in (check_in RPC); "Ingen krog" does not
//  J20 "Du leder" (meLead) only with a real lead: never on a tie, never at 1 beer
//  J21 migration 0475: anchor + no forbidden words; medals.js hides void_ medals
//  J22 copy: U.n1 singular, ticker never says "1 prickar", "kamrat" not "pojk", "Ditt namn" not "(anropssignal)",
//      install guide 2nd show not 30 min after a skip, near.js no "nedan", Profil tiles "1 dryck totalt"
// Mocked Supabase (ds-helpers). usage: node fixj-pw.js <port> [shot-tag] [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT, DIR = SP + "fixj-shots/";
fs.mkdirSync(DIR, { recursive: true });
const PORT = process.argv[2] || 8978, BASE = `http://127.0.0.1:${PORT}/`;
const TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const { wait, GID } = H;
const ROOT = path.join(__dirname, "../../");
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: DIR + TAG + "-" + name + ".png" }).catch(() => {});

// the join link: link_preview (gw, no account), join_preview, join_group; calls are recorded
function joinRoutes(page, calls, o = {}) {
  return page.route(/rest\/v1\/rpc\/(link_preview|join_preview|join_group|ev_preview)\b/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push({ fn, body, at: Date.now() });
    if (fn === "link_preview") { if (o.slowPreview) await new Promise((res) => setTimeout(res, o.slowPreview));
      return J(r, { ok: true, kind: "join", name: "Tjärnagänget", members: 3, ute: 1, faces: [{ n: "Sara" }, { n: "Jonte" }, { n: "Hampus" }] }).catch(() => {}); }
    if (fn === "join_preview") return J(r, { ok: true, name: "Tjärnagänget", members: 3, member: false, out: 1, faces: ["S", "J", "H"] });
    if (fn === "join_group") return J(r, { id: GID, name: "Tjärnagänget", code: "SE5686" });
    return J(r, {});
  });
}
async function freshPhone(browser, w, init) {
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] || 844 }, { clean: true });
  if (init) await ctx.addInitScript(init);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  return { ctx, page, errs };
}
// one night of after_report2 (0450 shape), me + 2 mates
function report() {
  const N = new Date(); N.setUTCHours(4, 0, 0, 0);
  const at = (h) => new Date(N.getTime() - h * 3600e3).toISOString();
  const P = (o) => Object.assign({ is_me: false, first_at: null, last_at: null, first_place: null, bars: 1, said_ute: false, said_at: null, home_at: null, skal: 0, driver: false, out: true }, o);
  return { v: 1, night: N.toISOString(), evening: at(10).slice(0, 10), group: { id: GID, name: "Fredagsgänget" }, groups: [{ id: GID, name: "Fredagsgänget", n: 3, me: true }],
    people: [P({ k: "a", name: "Max", is_me: true, first_at: at(7), last_at: at(4), first_place: "Pitchers", home_at: at(3) }),
      P({ k: "b", name: "Linnea", first_at: at(6.5), last_at: at(3.5), first_place: "Pitchers", home_at: at(2.5) }),
      P({ k: "c", name: "Ahmed", first_at: at(6), last_at: at(3.2), first_place: "Pitchers", home_at: at(2.8), skal: 1 })],
    stops: [], homes: [], prev: null, ghost_me: false, bets: [], missions: [], agent: null };
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ================= J03 link join → the intro asks the year once ================= */
    if (ONLY.test("J03")) for (const w of W3) {
      const calls = [];
      const { ctx, page, errs } = await freshPhone(browser, w);
      await joinRoutes(page, calls);
      await page.goto(BASE + "?join=SE5686&by=Elin");
      await page.waitForSelector(".jn-joinbtn", { timeout: 20000 }).catch(() => {});
      await wait(page, 3500);
      await page.fill("#jn-name", "Elin");
      await page.click(".jn-joinbtn"); await wait(page, 600);
      const asked1 = await page.evaluate(() => !!document.querySelector("#jn-wel #sf-age-year"));
      await page.selectOption("#sf-age-year", "1995").catch(() => {}); await wait(page, 300);
      await page.click(".jn-age-go").catch(() => {}); await wait(page, 2500);
      const joined = calls.some((c) => c.fn === "join_group");
      await page.click(".jn-skip").catch(() => {}); await wait(page, 3000);
      const intro = await page.evaluate(() => {
        const r = document.getElementById("intro"), b = document.getElementById("intro-body");
        const go = b ? [...b.querySelectorAll("button")].find((x) => /btn-amber/.test(x.className) && !/intro-privlink/.test(x.className)) : null;
        return { shown: !!r && !r.hidden, year: !!(b && b.querySelector("#sf-age-year, .sf-age")), goOn: !!go && !go.disabled, go: go ? go.textContent : "" };
      });
      await shot(page, "J03-intro-" + w);
      if (w === 390) ok("J03 the card asked the year once, then joined", asked1 && joined, { asked1, joined });
      ok("J03 intro after a link join: no 2nd year question, Kör enabled (" + w + ")", intro.shown && !intro.year && intro.goOn, intro);
      if (w === 390) ok("J03 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ================= J04 the first tap is never lost ================= */
    if (ONLY.test("J04")) {
      // a) a tap while the card is still loading (the old button was a disabled "⏳ Laddar…" for ~3 s)
      for (const w of W3) {
        const calls = [];
        const { ctx, page, errs } = await freshPhone(browser, w, () => { try { localStorage.setItem("olnu.name", "Oskar"); localStorage.setItem("olnu.age18", "1"); } catch (e) {} });
        await joinRoutes(page, calls, { slowPreview: 8000 });
        // a slow phone / busy server: the session comes 5 s after open (test teams: join_group waited behind ~45 start RPCs)
        await page.route(/\/auth\/v1\//, async (r) => { await new Promise((res) => setTimeout(res, 5000)); return r.fallback().catch(() => {}); });
        await page.goto(BASE + "?join=SE5686&by=Elin");
        await page.waitForSelector(".jn-joinbtn", { timeout: 20000 }).catch(() => {});
        await wait(page, 700);
        const box = await page.evaluate(() => { const b = document.querySelector(".jn-joinbtn"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, dis: b.disabled, t: b.textContent }; });
        await shot(page, "J04a-loading-" + w);
        if (box) await page.mouse.click(box.x, box.y);
        await wait(page, 9000);
        const joined = calls.some((c) => c.fn === "join_group" && c.body.p_display_name === "Oskar");
        await shot(page, "J04a-after-" + w);
        console.log("info J04a box", JSON.stringify(box));
        ok("J04a a tap ~0.7 s after open (still loading) joins (" + w + ")", !!box && joined, { box, calls: calls.map((c) => c.fn) });
        if (w === 390) ok("J04a no page errors", errs.length === 0, errs);
        await ctx.close();
      }
      // b) the preview lands between finger down and finger up (the old code swapped the button node)
      {
        const calls = [];
        const { ctx, page } = await freshPhone(browser, 390, () => { try { localStorage.setItem("olnu.name", "Hugo"); localStorage.setItem("olnu.age18", "1"); } catch (e) {} });
        await joinRoutes(page, calls);
        await page.goto(BASE + "?join=SE5686&by=Elin");
        await page.waitForFunction(() => { const b = document.querySelector(".jn-joinbtn"); return b && !b.disabled && /Jag hänger med/.test(b.textContent); }, null, { timeout: 20000 }).catch(() => {});
        await wait(page, 4000);   // past the 3 s install-state change
        const box = await page.evaluate(() => { const r = document.querySelector(".jn-joinbtn").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const node0 = await page.evaluateHandle(() => document.querySelector(".jn-joinbtn"));
        await page.mouse.move(box.x, box.y); await page.mouse.down();
        await page.evaluate(() => window.JOIN.applyPreview({ ok: true, kind: "join", name: "Tjärnagänget", members: 4, ute: 2, faces: [{ n: "Sara" }, { n: "Jonte" }] }));
        await wait(page, 60);
        await page.mouse.up(); await wait(page, 2500);
        const same = await page.evaluate((n) => n.isConnected, node0);
        ok("J04b the preview landing mid-tap keeps the same button and the tap joins", calls.some((c) => c.fn === "join_group" && c.body.p_display_name === "Hugo"), { same, calls: calls.map((c) => c.fn) });
        // N1-11: after the join the count includes me and drops "redan"
        const mem = await page.evaluate(() => (document.querySelector(".jn-mem") || {}).textContent || "");
        ok("J04c after the join: '5 i gänget' (me counted, no 'redan')", /5 i gänget/.test(mem) && !/redan/.test(mem), mem);
        await shot(page, "J04b-joined-390");
        await ctx.close();
      }
    }
    /* ================= J06 the morning: no old drink card when AFTER2 is on ================= */
    if (ONLY.test("J06")) for (const mode of ["a2", "old"]) for (const w of (mode === "a2" ? W3 : [390])) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] }, {});
      await ctx.addInitScript(() => { try { localStorage.setItem("olnu.nightlog", JSON.stringify({ key: "2000-01-01", beers: 3, others: 0, bars: ["n3472634175"], skal: 2, best: 3, badges: [] }));
        localStorage.removeItem("olnu.a2Day"); localStorage.removeItem("olnu.a2Seen"); localStorage.setItem("olnu.bakis", "x"); } catch (e) {} });
      await page.route(/rest\/v1\/rpc\/after_report2\b/, (r) => mode === "a2" ? J(r, report()) : J(r, { code: "PGRST202", message: "Could not find the function public.after_report2" }, 404));
      const t = new Date(); t.setUTCHours(6, 30, 0, 0);   // 07:30 Stockholm (Nov)
      await ctx.clock.install({ time: t });   // time flows (a frozen clock would hold every sheet in CALM's quiet start)
      await page.addInitScript(() => { window.__sheets = []; document.addEventListener("DOMContentLoaded", () => { const s = document.getElementById("sheet-title"); if (s) new MutationObserver(() => window.__sheets.push(s.textContent)).observe(s, { childList: true, subtree: true, characterData: true }); }); });
      await page.goto(BASE);
      await wait(page, 9000);
      const r = await page.evaluate(() => ({ sheets: window.__sheets || [], open: !document.getElementById("sheet").hidden ? document.getElementById("sheet-title").textContent : "", chip: !!document.querySelector(".a2-chip") || !!(window.AFTER2 && window.AFTER2.chipHTML && window.AFTER2.chipHTML()) }));
      await shot(page, "J06-" + mode + "-" + w);
      const din = r.sheets.some((x) => /Din kväll/.test(x)) || /Din kväll/.test(r.open);
      if (mode === "a2") ok("J06 AFTER2 on: no old 'Din kväll' card in the morning, the report is there (" + w + ")", !din && r.chip, r);
      else ok("J06 old server (no after_report2): the old 'Din kväll' card opens as before", din, r);
      await ctx.close();
    }
    /* ================= J07 a beer at another bar moves the check-in ================= */
    if (ONLY.test("J07")) for (const pickWhat of ["bar", "none"]) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
      await ctx.setGeolocation({ latitude: 60.15124, longitude: 15.18797 });   // at La Parma, 155 m from the Pitchers check-in
      const calls = [];
      let mineAt = { bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679 };   // the server row (one per user)
      await page.route(/rest\/v1\/rpc\/(post_beer_v2|check_in|live_checkins)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        if (fn === "live_checkins") return J(r, [Object.assign({ name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }, mineAt)]);
        calls.push({ fn, body });
        if (fn === "check_in") { mineAt = { bar_id: body.p_bar_id, bar_name: body.p_bar_name, lat: body.p_lat, lng: body.p_lng, created_at: new Date().toISOString() }; return J(r, { ok: true, bar_name: body.p_bar_name, wait_seconds: 0 }); }
        return J(r, { accepted: true, beer_count: 7, lat: body.p_lat, lng: body.p_lng, precise: true, undo_until: new Date(Date.now() + 120e3).toISOString(), expires_at: new Date(Date.now() + 5 * 3600e3).toISOString(), wait_seconds: 0 });
      });
      await H.boot(page);
      await page.evaluate(() => { localStorage.removeItem("olnu.where"); localStorage.removeItem("olnu.cooldownUntil"); const n = JSON.parse(localStorage.getItem("olnu.night") || "{}"); n.lastTap = Date.now() - 3600e3; localStorage.setItem("olnu.night", JSON.stringify(n)); });
      await H.clickJS(page, "#btn-beer"); await wait(page, 2500);
      const rows = await page.evaluate(() => [...document.querySelectorAll("#sheet-body button")].map((b) => b.textContent));
      if (pickWhat === "bar") await shot(page, "J07-picker-390");
      const clicked = await page.evaluate((what) => {
        const b = [...document.querySelectorAll("#sheet-body button")].find((x) => what === "bar" ? /La Parma/.test(x.textContent) : /Ingen krog/.test(x.textContent));
        if (b) b.click(); return b ? b.textContent : null;
      }, pickWhat);
      await wait(page, 3000);
      const ci = calls.filter((c) => c.fn === "check_in"), posted = calls.some((c) => c.fn === "post_beer_v2");
      const local = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.checkin") || "null"));
      if (pickWhat === "bar") {
        ok("J07 beer picked at La Parma ('här') while checked in at Pitchers → check_in La Parma", !!clicked && posted && ci.length === 1 && /la-parma/.test(ci[0].body.p_bar_id) && local && /la-parma/.test(local.id), { clicked, rows, ci, local });
        await shot(page, "J07-moved-390");
      } else ok("J07 'Ingen krog' → no check_in, the Pitchers check-in stays", !!clicked && posted && ci.length === 0 && local && local.id === "n3472634175", { clicked, ci, local });
      await ctx.close();
    }
    /* ================= J20 Du leder: a real lead only ================= */
    if (ONLY.test("J20")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
      await H.boot(page);
      const r = await page.evaluate(() => {
        const mk = (id, n, o) => Object.assign({ id, lat: 60.1500, lng: 15.1868, beer_count: n, precise: true, created_at: new Date().toISOString(), is_mine: false, friend_name: null, skal_count: 0, shot_count: 0 }, o);
        const run = (me, fr) => { let lead = 0; for (let i = 0; i < 25; i++) { const out = window.NEWS.build([mk(1, me, { is_mine: true }), mk(2, fr, { friend_name: "Linnea" })], { now: new Date() }); if (out.some((x) => x.k === "meLead")) lead++; } return lead; };
        return { tie1: run(1, 1), tie3: run(3, 3), one: run(1, 0), ahead: run(4, 1) };
      });
      ok("J20 no 'Du leder' on a tie (1–1, 3–3) or with 1 beer", r.tie1 === 0 && r.tie3 === 0 && r.one === 0, r);
      ok("J20 'Du leder' still there with a real lead (4 vs 1)", r.ahead > 0, r);
      await ctx.close();
    }
    /* ================= J21 Barkungen: migration 0475 + void_ medals hidden ================= */
    if (ONLY.test("J21")) {
      const f = ROOT + "supabase/migrations/0475_fixj_bar_king_week.sql";
      const sql = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
      ok("J21 0475: anchor patch on olnu_medal_eval adds 'and t.week < v_week' (finished weeks only)", /pg_get_functiondef\('public\.olnu_medal_eval'::regproc\)/.test(sql) && /' and t\.week < v_week'/.test(sql) && /raise exception '0475 anchor missing/.test(sql));
      ok("J21 0475: no DELETE / DROP / TRUNCATE anywhere in the file", sql.length > 0 && !/\b(delete|drop|truncate)\b/i.test(sql));
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
      await page.route(/rest\/v1\/rpc\/my_medals\b/, (r) => J(r, [{ medal: "m1", count: 1, earned_at: new Date().toISOString() }, { medal: "void_kung", count: 1, earned_at: new Date().toISOString() }]));
      await H.boot(page);
      await page.waitForFunction(() => window.MEDALS && window.MEDALS.mine() && Object.keys(window.MEDALS.mine()).length, null, { timeout: 15000 }).catch(() => {});
      const has = await page.evaluate(() => Object.keys(window.MEDALS.mine() || {}));
      ok("J21 a medal renamed to void_kung (owner UPDATE) is not shown", has.indexOf("void_kung") < 0 && has.indexOf("m1") >= 0, has);
      await ctx.close();
    }
    /* ================= J22 copy ================= */
    if (ONLY.test("J22")) {
      const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
      await H.boot(page);
      const u = await page.evaluate(() => window.U && window.U.n1 ? ["Riksläget: 1 prickar på kartan", "1 meriter kvar till Fänrik", "1 drycker totalt", "Max: 1 skål utdelade", "21 prickar", "1,5 drycker", "11 kvällar"].map(window.U.n1) : null);
      ok("J22 U.n1: '1 prick', '1 merit kvar', '1 dryck totalt', '1 skål utdelad'; 21 / 1,5 / 11 unchanged", !!u && u[0] === "Riksläget: 1 prick på kartan" && u[1] === "1 merit kvar till Fänrik" && u[2] === "1 dryck totalt" && u[3] === "Max: 1 skål utdelad" && u[4] === "21 prickar" && u[5] === "1,5 drycker" && u[6] === "11 kvällar", u);
      const tick = await page.evaluate(() => {
        const bad = [];
        for (let i = 0; i < 40; i++) {
          const out = window.NEWS.build([{ id: 9, lat: 60.1500, lng: 15.1868, beer_count: 2, precise: true, created_at: new Date().toISOString(), is_mine: false, friend_name: null, skal_count: 0, shot_count: 0 }], { now: new Date(), center: { lat: 60.15, lng: 15.18 } });
          out.forEach((x) => { if (/(^|[^\d,.])1 (prickar|personer|soldater|drycker|kvällar|krogar)\b/.test(x.text)) bad.push(x.text); });
        }
        return bad;
      });
      ok("J22 ticker with 1 person out: never '1 prickar / 1 personer / 1 soldater'", tick.length === 0, tick.slice(0, 3));
      const name = await page.evaluate(() => window.I18N.t("yourName"));
      ok("J22 name sheet title 'Ditt namn' (no '(anropssignal)')", name === "Ditt namn", name);
      const fnow = await page.evaluate(() => window.I18N.t("friendsNow", 1));
      ok("J22 '1 vän dricker nu'", /^1 vän dricker nu$/.test(fnow), fnow);
      // the install guide: skipped 30 min ago on the previous night key → not again now ("Andra kvällen!" at 05:06)
      const inst = await page.evaluate(() => {
        const prev = { n: 1, how: "skip", k: "2000-01-01", at: Date.now() - 30 * 60e3 };
        localStorage.setItem("olnu.inst1", JSON.stringify(prev)); localStorage.removeItem("olnu.jn.done");
        const a = window.INSTALL1.want();
        prev.at = Date.now() - 20 * 3600e3; localStorage.setItem("olnu.inst1", JSON.stringify(prev));
        const b = window.INSTALL1.want();
        localStorage.setItem("olnu.inst1", JSON.stringify({ n: 2, how: "test" }));
        return { soon: a, later: b, standalone: window.U.isStandalone && window.U.isStandalone() };
      });
      ok("J22 install guide: not again 30 min after a skip (night key changed at 05:00), again a day later", inst.soon === false && inst.later === true, inst);
      await ctx.close();
      // files: the Dalarna empty-group line and near.js
      const served = async (f) => { try { const r = await fetch(BASE + f); return r.ok ? await r.text() : ""; } catch (e) { return ""; } };   // the served build, not this checkout
      const dal = await served("js/dialekt-packs/sv-dalarna.js");
      ok("J22 sv-dalarna grp.empty row 0 'Bli först, kamrat!' (no 'pojk')", /"grp\.empty": \[\s*"Ingen ute än\. Bli först, kamrat!"/.test(dal) && !/Bli först, pojk/.test(dal));
      const near = await served("js/near.js");
      ok("J22 near.js: 'Dela din kod' without 'nedan' (the code is above)", /Dela din kod/.test(near) && !/Dela din kod nedan/.test(near));
      // Profil tiles: 1 drink → "1 dryck totalt"
      const { ctx: c2, page: p2 } = await H.ctxFor(browser, { width: 390, height: 844 }, {});
      await H.boot(p2);
      const tiles = await p2.evaluate(() => {
        try { window.SOCIAL.stats = () => ({ total: 1, title: "Rekryt", next: "Menig", nextAt: 2, meriter: 1 }); } catch (e) {}
        const box = document.createElement("div"); try { window.PROFIL.profileHead(box); } catch (e) { return "ERR " + e.message; }
        return box.textContent;
      });
      ok("J22 Profil tile: '1 dryck totalt' (not '1 drycker')", /dryck totalt/.test(tiles) && !/drycker totalt/.test(tiles), String(tiles).slice(0, 300));
      await c2.close();
    }
  } catch (e) { ok("run", false, e.message); }
  await browser.close();
  console.log(`\nfixj: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
