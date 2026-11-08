// gw (2026-11-08) Playwright test, mocked server, 390 x 844. Usage: node gw-pw.js <port>
// Competitor-research build (js/gw.js + patches gw-patches/02-08): 1 "Ute ikväll?" answer-to-see + opt-in, 2 invite /
// event preview without an account, 3 honest crowd ("Lugnt" below 3), 4 friend pin "Ute i …" + Knuff, 5 Följ mig hem
// timer (start, "Är du hemma?", viewer alert, 112 first), 6 album card the morning after, 7 place medals + Mina ställen,
// 8 Demo label + push budget label. Screenshots: scratchpad/gw-shots/.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const SHOTS = SP + "gw-shots/"; require("fs").mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8981, BASE = `http://127.0.0.1:${PORT}/`;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const GID = "11111111-2222-3333-4444-555555555555";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const inMin = (m) => new Date(Date.now() + m * 60e3).toISOString();
const VP = { width: 390, height: 844 };
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const shot = async (page, n, keepToast) => {
  if (!keepToast) await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await page.screenshot({ path: SHOTS + n + ".png" }); console.log("shot", n);
};
const calls = [];
const called = (fn, f) => calls.some((c) => c.fn === fn && (!f || f(c.body)));
const toastLog = () => {   // every toast text, also the ones that are gone again
  window.__toasts = []; new MutationObserver(() => document.querySelectorAll(".toast").forEach((t) => { const x = t.textContent; if (x && window.__toasts.indexOf(x) < 0) window.__toasts.push(x); }))
    .observe(document, { childList: true, subtree: true, characterData: true });
};
const toasts = (page) => page.evaluate(() => (window.__toasts || []).join(" | "));
const sheetText = (page) => page.evaluate(() => (document.getElementById("sheet-body") || {}).innerText || "");
const closeSheet = (page) => page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); });

const S = { ikvMine: null, tick: { v: 1, mine: null, alerts: [], push: [] }, knuff: { ok: true, id: 5 } };
async function routes(page) {
  await page.route(/rest\/v1\/rpc\/(poll_public|ikvall_status|ikvall_set|ikvall_prompt_get|ikvall_prompt_set|knuff_send|knuff_inbox|walk_\w+|friend_list|film_poll|film_roll|film_photo|my_places|link_preview|join_group|join_preview|ev_preview|ev_join)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push({ fn, body, at: Date.now() });
    switch (fn) {
      case "poll_public": return J(r, { pins: [], checkins: [], live_total: 0, bbox: null });
      case "ikvall_status": return J(r, { v: 1, night: "x", mine: S.ikvMine, counts: { ute: 2, kanske: 1, hemma: 0 }, people: [
        { name: "Ida", st: "ute", friend: true }, { name: "Oskar", st: "ute", friend: false }, { name: "Lisa", st: "kanske", friend: true }] });
      case "ikvall_set": S.ikvMine = body.p_st; return J(r, { ok: true, st: body.p_st });
      case "ikvall_prompt_get": return J(r, { v: 1, on: false });
      case "ikvall_prompt_set": return J(r, { ok: true, on: !!body.p_on });
      case "knuff_send": return J(r, S.knuff);
      case "knuff_inbox": { const x = S.inbox; S.inbox = null; return J(r, x || []); }
      case "walk_poll": return J(r, { v: 1, now: new Date().toISOString(), mine: S.walk || null, watching: [] });
      case "walk_start": S.walk = { id: 9, live: true, n: 1, watching: 0, ends_at: inMin(120), started_at: iso(0) }; return J(r, S.walk);
      case "walk_end": S.walk = Object.assign({}, S.walk, { live: false, end_reason: body.p_reason }); return J(r, S.walk);
      case "walk_ping": return J(r, S.walk || {});
      case "walk_timer_set": return J(r, { walk_id: body.p_walk_id, minutes: body.p_minutes, due_at: inMin(body.p_minutes), now: new Date().toISOString(), left_s: body.p_minutes * 60 });
      case "walk_timer_ok": return J(r, { ok: true });
      case "walk_timer_tick": return J(r, S.tick);
      case "friend_list": return J(r, { v: 1, people: [{ key: "k1", name: "Lisa", out: true, friend: true, groups: [{ id: GID, name: "Ludvika Lager" }] },
        { key: "k2", name: "Oskar", out: false, groups: [{ id: GID, name: "Ludvika Lager" }] }], groups: [{ id: GID, name: "Ludvika Lager", n: 4 }] });
      case "film_poll": return J(r, { now: new Date().toISOString(), night: inMin(600), rolls: [{ group_id: GID, group_name: "Ludvika Lager", night: iso(400), n: 6, push_mine: false }], groups: [] });
      case "film_roll": return J(r, { developed: true, night: iso(400), evening: "2026-11-07", photos: [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, w: 3, h: 4, name: "Lisa", at: iso(600), reacts: [] })) });
      case "film_photo": return J(r, { mime: "image/svg+xml", b64: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="hsl(${body.p_photo_id * 50},60%,45%)"/></svg>`).toString("base64") });
      case "my_places": return J(r, { v: 1, bars_n: 4, towns_n: 2, dalarna_n: 2, dalarna_goal: 3,
        towns: [{ town: "Ludvika", visited: 3, total: 3, dalarna: true, all: true }, { town: "Smedjebacken", visited: 1, total: 4, dalarna: true, all: false }],
        bars: [{ id: "n3472634175", name: "Pitchers", town: "Ludvika", lat: 60.14997, lng: 15.18679, first: "2026-10-03" },
          { id: "x-la-parma-ludvika", name: "La Parma Pub & Restaurang", town: "Ludvika", lat: 60.15124, lng: 15.18797, first: "2026-10-10" },
          { id: "x-lobbybaren-ludvika", name: "Lobbybaren", town: "Ludvika", lat: 60.15098, lng: 15.18663, first: "2026-10-17" },
          { id: "s1", name: "Smedjan", town: "Smedjebacken", lat: 60.1405, lng: 15.4128, first: "2026-11-01" }] });
      case "link_preview": return J(r, body.p_kind === "join"
        ? { ok: true, kind: "join", name: "Ludvika Lager", members: 5, ute: 2, faces: [{ n: "Anton", ute: true }, { n: "Lisa", ute: true }, { n: "Oskar", ute: false }, { n: "Ida", ute: false }, { n: "Nisse", ute: false }] }
        : { ok: true, kind: "ev", title: "🧠 Pubquiz på Pitchers", ev_kind: "quiz", place: "Pitchers", starts_at: inMin(90), live: true, yes: 3, maybe: 1, from: "Lisa", faces: [{ n: "Lisa" }, { n: "Ida" }, { n: "Anton" }] });
      case "join_group": return J(r, { id: GID, name: "Ludvika Lager", code: "ABC234" });
      case "join_preview": return J(r, { ok: true, name: "Ludvika Lager", members: 5, member: false, out: 2, faces: ["A", "L", "O", "I"] });
      case "ev_preview": return J(r, { ok: true, token: "QWE234", title: "🧠 Pubquiz på Pitchers", starts_at: inMin(90), place: "Pitchers", yes: 3, maybe: 1, faces: ["L", "I", "A"], member: false, my_answer: "none", from: "Lisa" });
      case "ev_join": return J(r, { ok: true, yes: 4, maybe: 1, faces: ["L", "I", "A", "N"], id: 31 });
      default: return J(r, []);
    }
  });
}
async function launch() { return chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] }); }
async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, VP, o);
  await ctx.addInitScript(toastLog);
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.pnEve", "1"); localStorage.setItem("olnu.pnAutoUte", "x"); localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.1440, lng: 15.1700 })); } catch (e) {} });
  await routes(page);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  return { ctx, page, errs };
}

(async () => {
  const browser = await launch();
  try {
    /* ---------- 1. Ute ikväll? ---------- */
    {
      const { ctx, page, errs } = await open(browser);
      await boot(page);
      ok("GW loaded, last in mods()", await page.evaluate(() => !!window.GW && typeof window.GW.ikvLockNode === "function"));
      await page.evaluate(() => window.PNUI.openIkvall()); await wait(page, 1500);
      let t = await sheetText(page);
      ok("1 locked: 'Svara för att se' + count, no names", /Svara för att se/.test(t) && /3 har svarat/.test(t) && !/Oskar|Ida/.test(t), t);
      ok("1 opt-in switch 'Fråga mig fre + lör kl 20'", /Fråga mig fre \+ lör kl 20/.test(t) && !!(await page.$(".gw-ikvp .switch")));
      ok("1 PNUI._ikv() hides the names before you answer (Ute ikväll card)", await page.evaluate(() => window.PNUI._ikv().d && window.PNUI._ikv().d.people.length === 0));
      await shot(page, "gw-1-ikvall-locked");
      await page.click(".gw-ikvp .gw-sw"); await wait(page, 700);
      ok("1 switch → ikvall_prompt_set(true)", called("ikvall_prompt_set", (b) => b.p_on === true));
      await page.click(".pn-ikv-b.pn-ute"); await wait(page, 1200);
      t = await sheetText(page);
      ok("1 answered: '2 ute · 1 kanske' + names", /2 ute · 1 kanske/.test(t) && /Ida/.test(t) && /Oskar/.test(t), t);
      await shot(page, "gw-1-ikvall-answered");
      ok("1 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 2. Invite / event preview without an account ---------- */
    for (const kind of ["join", "ev"]) {
      const { ctx, page, errs } = await open(browser, { clean: true });
      const auth = []; page.on("request", (q) => { if (/\/auth\/v1\/(signup|token)/.test(q.url())) auth.push(q.url()); });
      await page.goto(BASE + (kind === "join" ? "?join=ABC234&by=Anton" : "?ev=QWE234&by=Lisa")); await wait(page, 3500);
      const txt = await page.textContent("#jn-wel").catch(() => "");
      ok(kind + " 2 link_preview called", called("link_preview", (b) => b.p_kind === kind));
      ok(kind + " 2 no account before the tap", auth.length === 0 && !called(kind === "join" ? "join_preview" : "ev_preview"), auth);
      ok(kind + " 2 card shows who + count", kind === "join" ? /I gänget: Anton, Lisa, Oskar och 2 till/.test(txt) && /2 ute nu/.test(txt) && /5 i gänget/.test(txt)
        : /Pubquiz/.test(txt) && /Lisa, Ida och Anton hänger med/.test(txt) && /3 kommer/.test(txt), txt);
      const btn = kind === "join" ? ".jn-joinbtn" : ".jn-evyes";
      ok(kind + " 2 big 'Jag hänger med', enabled", await page.evaluate((s) => { const b = document.querySelector(s); return !!b && /Jag hänger med/.test(b.textContent) && !b.disabled; }, btn));
      await shot(page, "gw-2-" + (kind === "join" ? "invite" : "event") + "-noaccount");
      await page.fill("#jn-name", "Nisse"); await page.click(btn); await wait(page, 2500);
      ok(kind + " 2 the tap made the account and answered", auth.length > 0 && (kind === "join" ? called("join_group", (b) => b.p_display_name === "Nisse") : called("ev_join", (b) => b.p_name === "Nisse")), { auth: auth.length });
      await shot(page, "gw-2-" + (kind === "join" ? "invite" : "event") + "-done");
      ok(kind + " 2 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 3. honest crowd + 4. friend pin / Knuff ---------- */
    {
      const { ctx, page, errs } = await open(browser);
      await boot(page);
      const bars = await page.evaluate(() => {
        const out = []; const seen = new Set();
        const add = (h) => { if (!h || seen.has(h)) return; seen.add(h); const m = /class="pill[^"]*p-bar[^"]*"/.exec(h); if (!m) return; const n = (/<span class="pn">(\d+)</.exec(h) || [])[1]; out.push({ q: /\bpq\b/.test(m[0]), n: +n }); };
        try { window.__map.eachLayer((l) => add(l.options && l.options.icon && l.options.icon.options && l.options.icon.options.html)); } catch (e) {}
        document.querySelectorAll(".pill.p-bar").forEach((p) => add(p.outerHTML));
        return out;
      });
      ok("3 bar pills: 'pq' exactly below 3 people", bars.length > 1 && bars.every((b) => b.q === (b.n < 3)) && bars.some((b) => b.q) && bars.some((b) => !b.q), bars);
      const gl = await page.evaluate(() => !!(window.GLBARS && window.GLBARS.on()));
      if (gl) {
        const v = await page.evaluate(() => (window.GLBARS._view() || []).filter((x) => x.full && x.n > 0).map((x) => ({ n: x.n, pill: !!(window.GLBARS._img(x.id).parts || []).some((p) => p.sel === ".pill") })));
        ok("3 GL: no count badge below 3", v.length > 0 && v.every((x) => x.pill === (x.n >= 3)), v);
      } else console.log("info: GL bars off in this run (DOM pills checked)");
      // the bar sheet of the 2-person bar (Grekiska)
      const opened = await page.evaluate(() => {
        let mk = null; window.__map.eachLayer((l) => { const h = l.options && l.options.icon && l.options.icon.options && l.options.icon.options.html; if (!mk && h && /\bpq\b/.test(h) && /<span class="pn">2</.test(h)) mk = l; });
        if (!mk) return false; if (window.GLBARS && window.GLBARS.on() && mk.options.olnuKey && window.GLBARS.open(mk.options.olnuKey.replace(/^bar:?/, ""))) return "gl"; mk.fire("click"); return "fire";
      });
      await wait(page, 1500);
      const bs = await page.evaluate(() => { const s = document.querySelector("#sheet:not([hidden]) .bs-head, .leaflet-popup .bs-head"); return s ? s.textContent : ""; });
      ok("3 bar sheet below 3: 'Lugnt', no '≈ 2 här', no meter", !!opened && /Lugnt/.test(bs) && !/≈ \d+ här/.test(bs) && !(await page.$("#sheet .pn-meter, .leaflet-popup .pn-meter")), { opened, bs });
      if (opened) await shot(page, "gw-3-bar-lugnt");
      await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} const c = document.getElementById("sheet-close"); if (c) c.click(); });
      await wait(page, 600);
      // 4. friend pin: Robban (not at a bar)
      await page.evaluate(() => window.__map.setView([60.1545, 15.1960], 17, { animate: false })); await wait(page, 1800);
      const fp = await page.evaluate(() => { const A = window.GW._A(); const b = A.beers().filter((x) => x.friend_name === "Robban")[0]; if (!b) return false; A.flyTo(b.lat, b.lng, 17, b.id); return true; });
      await wait(page, 2600);
      await wait(page, 1500);
      const ft = await page.evaluate(() => { const g = document.querySelector(".gw-fr"); return g ? g.textContent : ""; });
      ok("4 friend pin: 'Ute i …' + Knuffa Robban", fp && /Ute i \d/.test(ft) && /Knuffa Robban/.test(ft), ft);
      await shot(page, "gw-4-friend-knuff");
      await page.click(".gw-knuff"); await wait(page, 1000);
      ok("4 Knuff → knuff_send(beer id) + 'Knuff skickad'", called("knuff_send", (b) => b.p_beer_id > 0) && /Knuff skickad/.test(await page.textContent(".gw-knuff")));
      await shot(page, "gw-4-knuff-sent");
      S.knuff = { ok: false, why: "slow_down", wait_s: 1500 };
      await page.evaluate(() => { const b = document.querySelector(".gw-knuff"); b.disabled = false; b.click(); }); await wait(page, 900);
      ok("4 rate limit: 'Vänta 25 min'", /Vänta 25 min/.test(await toasts(page)), await toasts(page));
      S.inbox = [{ id: 1, name: "Lisa", at: iso(1) }];
      await page.evaluate(() => { window.__toasts = []; window.GW._inbox(); }); await wait(page, 1200);
      ok("4 incoming knuff → toast 'Lisa knuffar dig'", /Lisa knuffar dig/.test(await toasts(page)), { t: await toasts(page), n: calls.filter((c) => c.fn === "knuff_inbox").length });
      ok("3/4 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 5. Följ mig hem timer ---------- */
    {
      const { ctx, page, errs } = await open(browser);
      await boot(page);
      await page.evaluate(() => window.HEMFOLJ.open({})); await wait(page, 1500);
      let first = await page.evaluate(() => { const b = document.getElementById("sheet-body"); const a = b && b.querySelector("a[href='tel:112'], .sos112, [href^='tel:112']"); return a ? b.firstElementChild.contains(a) || b.firstElementChild === a : false; });
      const segN = await page.$$eval(".gw-wt .gw-seg button", (x) => x.map((b) => b.textContent));
      ok("5 start sheet: timer Av / 20 / 40 / 60 min; 112 first", segN.join(",") === "Av,20 min,40 min,60 min" && first, { segN, first });
      await page.click(".gw-wt .gw-seg button:nth-child(2)");
      await page.evaluate(() => { const c = document.querySelector("#hf-p-k1"); if (c) { c.checked = true; c.dispatchEvent(new Event("change")); } }); await wait(page, 300);
      await shot(page, "gw-5-start-timer");
      await page.click(".hf-go"); await wait(page, 2000);
      ok("5 start → walk_timer_set(9, 20)", called("walk_timer_set", (b) => b.p_walk_id === 9 && b.p_minutes === 20));
      // time is up: the server says "reminded"
      S.tick = { v: 1, now: new Date().toISOString(), mine: { walk_id: 9, minutes: 20, due_at: iso(0.1), reminded_at: new Date(Date.now() - 2000).toISOString(), alert_at: null, now: new Date().toISOString() }, alerts: [], push: [9] };
      await page.evaluate(() => window.GW._tick()); await wait(page, 1200);
      const ov = await page.evaluate(() => { const o = document.querySelector(".gw-ov"); return o ? { t: o.innerText, first112: !!o.querySelector(".gw-ov-c > a[href='tel:112']:first-child") } : null; });
      ok("5 'Är du hemma?' overlay with countdown, 112 first", ov && /Är du hemma\?/.test(ov.t) && /Svara inom \d+ s/.test(ov.t) && ov.first112, ov);
      await shot(page, "gw-5-are-you-home");
      S.tick = { v: 1, mine: null, alerts: [], push: [] };
      await page.click(".gw-ov-home"); await wait(page, 1200);
      ok("5 'Ja, jag är hemma' → walk_timer_ok + overlay gone", called("walk_timer_ok", (b) => b.p_walk_id === 9) && !(await page.$(".gw-ov")));
      // viewer side: an alert from Lisa
      S.tick = { v: 1, mine: null, push: [], alerts: [{ walk_id: 12, name: "Lisa", due_at: iso(3), alert_at: iso(0.2), last_lat: 60.1489, last_lng: 15.1801, last_at: iso(6), ok_at: null }] };
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 500);
      await page.evaluate(() => window.GW._tick()); await wait(page, 1500);
      const al = await sheetText(page);
      first = await page.evaluate(() => { const b = document.getElementById("sheet-body"); return !!(b && b.firstElementChild && b.firstElementChild.matches("a[href='tel:112']")); });
      ok("5 viewer alert sheet: 'Lisa har inte svarat', last position, 112 first", /Lisa har inte svarat|skulle höra av sig/.test(al) && /Senaste plats kl/.test(al) && first, al);
      await shot(page, "gw-5-viewer-alert");
      ok("5 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- 6. album card + 7. medals / Mina ställen + 8. demo ---------- */
    {
      const { ctx, page, errs } = await open(browser);
      await boot(page);
      await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); try { localStorage.setItem("olnu.gtab", "g"); } catch (e) {} document.getElementById("btn-groups").click(); });
      await wait(page, 1200);
      if (await page.$(".glist .gcard")) { await page.click(".glist .gcard >> nth=0"); await wait(page, 2200); }
      const alb = await page.evaluate(() => { const a = document.querySelector(".gw-album"); return a ? { t: a.textContent, imgs: a.querySelectorAll("img").length } : null; });
      ok("6 group page: 'Gårdagens bilder är framkallade 📸' + thumbnails", alb && /Gårdagens bilder är framkallade/.test(alb.t) && /6 bilder/.test(alb.t) && alb.imgs >= 1, alb);
      await page.evaluate(() => { const a = document.querySelector(".gw-album"); if (a) a.scrollIntoView({ block: "center" }); }); await wait(page, 400);
      await shot(page, "gw-6-album-card");
      await page.click(".gw-album"); await wait(page, 1500);
      ok("6 tap → the developed roll", /framkallad/i.test(await sheetText(page)) && called("film_roll"));
      await closeSheet(page); await wait(page, 500);
      // 7
      ok("7 medals in the catalog (no drink counts)", await page.evaluate(() => ["pl_ny", "pl_stad", "pl_dalarna"].every((id) => window.MEDALS.info(id).name !== id) && window.MEDALS.info("pl_dalarna").name === "Utforskat Dalarna"));
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 900);
      await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button, [role=tab]")].find((b) => /Profil/.test(b.textContent)); if (t) t.click(); }); await wait(page, 1500);
      const row = await page.evaluate(() => { const r = document.querySelector(".gw-places-row"); return r ? r.textContent : null; });
      ok("7 Profil → Mitt: 'Mina ställen · 4 krogar · 2 städer'", row && /Mina ställen/.test(row) && /4 krogar · 2 städer/.test(row), row);
      await page.evaluate(() => { const r = document.querySelector(".gw-places-row"); if (r) r.scrollIntoView({ block: "center" }); }); await wait(page, 300);
      await shot(page, "gw-7-profil-row");
      await page.click(".gw-places-row"); await wait(page, 1500);
      const pl = await sheetText(page);
      ok("7 Mina ställen: tiles, Dalarna 2 av 3, towns, bars", /Utforskat Dalarna/.test(pl) && /2 av 3 städer i Dalarna/.test(pl) && /3 av 3 krogar · alla!/.test(pl) && /Pitchers/.test(pl) && !/\d+ (öl|drinkar|glas)/.test(pl), pl);
      await shot(page, "gw-7-mina-stallen");
      await closeSheet(page); await wait(page, 500);
      // 8
      ok("8 demo off by default: no chip", await page.evaluate(() => { window.GW._demo(); const d = document.querySelector(".gw-demo"); return !d || d.hidden; }));
      await page.evaluate(() => { localStorage.setItem("olnu.visning", "1"); window.GW._demo(); }); await wait(page, 300);
      const demo = await page.evaluate(() => { const d = document.querySelector(".gw-demo"); return d && !d.hidden ? d.textContent : null; });
      ok("8 demo on → 'Demo' chip", !!demo && /Demo/.test(demo), demo);
      await shot(page, "gw-8-demo-label");
      await page.evaluate(() => { localStorage.setItem("olnu.visning", "0"); window.GW._demo(); });
      ok("8 push budget label: '4 (standard)'", await page.evaluate(() => { const s = document.createElement("div"); return !!window.PUSH && typeof window.PUSH.prefsSection === "function"; }) && /4 \(standard\)/.test(require("fs").readFileSync(__dirname + "/../../docs/js/push.js", "utf8")));
      ok("6/7/8 no page errors", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL crash", e && e.stack); fail++; }
  await browser.close();
  console.log(`${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
