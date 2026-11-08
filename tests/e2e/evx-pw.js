// evx client test (mocked server): 📊 Min kväll, 📨 Eventgruppen, 🗂️ Tidigare event + recap, 📅 dedupe fields. 412x915.
// NODE_PATH=... node evx-pw.js <port>
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs");
const SP = require("./env.js").OUT;
const J = (r, b, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, i === undefined ? "" : JSON.stringify(i).slice(0, 300)); c ? pass++ : fail++; };
const shot = (page, n) => page.screenshot({ path: SP + "ui-testshots/evx-" + n + ".png" });
const now = Date.now(), at = (m) => new Date(now - m * 60e3).toISOString();
const TG = "7bdbeaa4-0c46-428f-b0e1-72588a28e3c1";
const nightEnd = (() => { const d = new Date(now + 6 * 3600e3); return d.toISOString(); })();
const LOG = { v: 1, now: new Date().toISOString(), night: nightEnd, evening: "2026-11-07", tonight: true, source: "log",
  items: [
    { at: at(200), kind: "checkin", bar: "Pitchers", bar_id: "n3472634175", area: "Ludvika", ghost: false },
    { at: at(195), kind: "beer", bar: "Pitchers", bar_id: "n3472634175", area: "Ludvika", ghost: false },
    { at: at(170), kind: "beer", bar: "Pitchers", bar_id: "n3472634175", area: "Ludvika", ghost: false },
    { at: at(140), kind: "shot", bar: "Pitchers", bar_id: "n3472634175", area: "Ludvika", ghost: false },
    { at: at(110), kind: "checkin", bar: "La Parma Pub & Restaurang", bar_id: "x-la-parma-ludvika", area: "Ludvika", ghost: false },
    { at: at(100), kind: "cider", bar: "La Parma Pub & Restaurang", bar_id: "x-la-parma-ludvika", area: "Ludvika", ghost: false },
    { at: at(60), kind: "drink", bar: null, area: "Ludvika", ghost: true },
    { at: at(20), kind: "beer", bar: "Lobbybaren (Grand Hotel Elektra)", area: "Ludvika", ghost: false }],
  nights: [{ night: nightEnd, evening: "2026-11-07", drinks: 6, log: true }, { night: new Date(now - 18 * 3600e3).toISOString(), evening: "2026-11-06", drinks: 4, log: false },
    { night: new Date(now - 6 * 864e5).toISOString(), evening: "2026-11-01", drinks: 9, log: false }],
  stats: { drinks: 6, logged: 6, beers: 3, others: 3, kinds: { beer: 3, shot: 1, cider: 1, drink: 1 }, first_at: at(195), last_at: at(20), per_hour: 2.1, bars: 3, checkins: 2,
    hours: [{ h: "21", n: 2 }, { h: "22", n: 2 }, { h: "23", n: 1 }, { h: "00", n: 1 }] } };
const LEGACY = Object.assign({}, LOG, { tonight: false, source: "legacy", night: LOG.nights[1].night, evening: "2026-11-06",
  items: [{ at: at(1500), kind: "unknown", bar: null, area: null, ghost: false }, { at: at(1470), kind: "checkin", bar: "Pitchers", bar_id: "n3472634175" },
    { at: at(1440), kind: "unknown" }, { at: at(1400), kind: "unknown" }, { at: at(1380), kind: "unknown" }],
  stats: { drinks: 4, logged: 4, beers: 3, others: 1, kinds: {}, first_at: at(1500), last_at: at(1380), per_hour: 2, bars: 1, checkins: 1, hours: [{ h: "19", n: 2 }, { h: "20", n: 2 }] } });
const PEOPLE = [{ k: "a1", name: "Anton", answer: "yes", creator: true, is_me: true, out: true }, { k: "b1", name: "Lisa", answer: "yes", creator: false, is_me: false, out: true },
  { k: "c1", name: "Oskar Olsson", answer: "maybe", creator: false, is_me: false, out: false }];
const EG = (o) => Object.assign({ v: 1, group_id: TG, invite_id: 16, title: "🎉 Förfest hos Anton", kind: "party", place: "Hemma hos Anton", bar_id: null, starts_at: new Date(now + 90 * 60e3).toISOString(),
  open_until: new Date(now + 13 * 3600e3).toISOString(), hide_at: new Date(now + 9 * 864e5).toISOString(), night: nightEnd, evening: "2026-11-07", past: false, state: "open",
  can_write: true, can_play: true, mine: true, my_answer: "yes", invited: 4, people: PEOPLE }, o || {});
const CHAT = { group_id: TG, invite_id: 16, title: "🎉 Förfest hos Anton", name: "🎉 Förfest hos Anton · lör 7/11", kind: "party", place: "Hemma hos Anton",
  starts_at: new Date(now + 90 * 60e3).toISOString(), open_until: new Date(now + 13 * 3600e3).toISOString(), hide_at: new Date(now + 9 * 864e5).toISOString(),
  state: "open", can_write: true, my_answer: "yes", mine: true, members: 3, invited: 4, last_id: 9, unread: 2 };
let STORY = null;
try { STORY = JSON.parse(fs.readFileSync(require("./env.js").FIX + "evx-story.json", "utf8")); } catch (e) {}
if (!STORY) STORY = { ready: false, members: [], photos: [], chat: { top: [] }, drinks: {}, event: { title: "x" } };
// make the real (thin) live story richer for the screenshot, same shape
STORY = Object.assign({}, STORY, {
  town: "Ludvika", group_name: "🎉 Förfest hos Anton",
  event: Object.assign({}, STORY.event || {}, { title: "🎉 Förfest hos Anton", place: "Hemma hos Anton", kind: "party" }),
  members: [
    { k: "a", name: "Anton", is_me: true, creator: true, answer: "yes", drinks: 7, first_at: at(1600), last_at: at(1300), hours: [], checkins: 2, bars: 2, first_ci: at(1500), skal_given: 3, skal_got: 2, home_at: at(1250), out: true },
    { k: "b", name: "Lisa", is_me: false, answer: "yes", drinks: 5, first_at: at(1580), last_at: at(1320), hours: [], checkins: 2, bars: 2, first_ci: at(1500), skal_given: 1, skal_got: 3, home_at: null, out: true },
    { k: "c", name: "Oskar Olsson", is_me: false, answer: "maybe", drinks: 9, first_at: at(1560), last_at: at(1260), hours: [], checkins: 1, bars: 1, first_ci: at(1490), skal_given: 0, skal_got: 1, home_at: at(1240), out: true }],
  arrivals: [{ at: at(1500), last_at: at(1490), bar: "Pitchers", bar_id: "n3472634175", n: 3, names: ["Anton", "Lisa", "Oskar Olsson"], ks: ["a", "b", "c"], from_bar: null, first: true, met_n: 0, met_group: null },
    { at: at(1400), last_at: at(1395), bar: "La Parma", bar_id: "x-la-parma-ludvika", n: 2, names: ["Anton", "Lisa"], ks: ["a", "b"], from_bar: "Pitchers", first: false, met_n: 0, met_group: null }],
  drinks: { total: 21, hours: [{ h: "21", at: at(1560), n: 6 }, { h: "22", at: at(1500), n: 9 }, { h: "23", at: at(1440), n: 6 }], peak: { h: "22", at: at(1500), n: 9 }, first_at: at(1600), last_at: at(1260) },
  skal: { total: 4, top: { name: "Anton", n: 3 } },
  chat: { texts: 14, top: [{ name: "Lisa", body: "Nu kör vi! Pitchers sen?", at: at(1610), reacts: 3, emoji: "🍻" }, { name: "Oskar Olsson", body: "Jag tar med kortleken", at: at(1620), reacts: 1, emoji: "😂" }] },
  photos_n: (STORY.photos || []).length, ready: true });
const B64 = fs.readFileSync(require("./env.js").FIX + "photo-mid.jpg").toString("base64");
const PAST = { v: 1, events: [
  { group_id: TG, invite_id: 16, title: "🎉 Förfest hos Anton", kind: "party", place: "Hemma hos Anton", starts_at: at(1620), night: at(1200), evening: "2026-11-06", mine: true, people: 3, names: ["Anton", "Lisa", "Oskar Olsson"], drinks: 21, photos: 1, msgs: 14 },
  { group_id: "99999999-2222-3333-4444-555555555555", invite_id: 9, title: "🧠 Pubquiz på Pitchers", kind: "quiz", place: "Pitchers", starts_at: at(9000), night: at(8600), evening: "2026-11-01", mine: false, people: 5, names: ["Ida"], drinks: 12, photos: 0, msgs: 3 }] };

async function routes(page, calls, o) {
  o = o || {};
  await page.route(/rest\/v1\/rpc\/(my_night_log|event_group|my_past_events|event_story|night_story_photo|my_event_chats|party_group|rnd_group|invite_get|my_invites)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (o.old) return J(r, { code: "PGRST202", message: "Could not find the function public." + fn }, 404);
    if (fn === "my_night_log") return J(r, b.p_night ? LEGACY : (o.emptyLog ? Object.assign({}, LOG, { items: [], nights: [], source: "none", stats: { drinks: 0, kinds: {}, hours: [], bars: 0 } }) : LOG));
    if (fn === "event_group") return J(r, EG(o.eg));
    if (fn === "my_past_events") return J(r, o.noPast ? { v: 1, events: [] } : PAST);
    if (fn === "event_story") return J(r, STORY);
    if (fn === "night_story_photo") return J(r, { id: b.p_photo_id, mime: "image/jpeg", w: 640, h: 480, b64: B64 });
    if (fn === "my_event_chats") return J(r, { v: 1, now: new Date().toISOString(), chats: [CHAT] });
    if (fn === "party_group") return J(r, { room: null });
    if (fn === "rnd_group") return J(r, { v: 1, me: "a1", my_swish: null, members: PEOPLE.slice(0, 2).map((p) => ({ k: p.k, name: p.name, is_me: p.is_me, out: p.out, swish: null, paid_n: 0, net: 0 })), expenses: [], payments: [] });
    return J(r, []);
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const VP = { width: 412, height: 915 };
  try {
    /* 1. 📊 Min kväll from the Ikväll panel */
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = []; const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await routes(page, calls); await boot(page);
      await clickJS(page, "#my-streak"); await wait(page, 500);
      const chip = await page.evaluate(() => { const c = document.querySelector('#hud-x [data-hx="nightlog"]'); return c ? c.textContent : null; });
      ok("Ikväll panel has the quiet 📊 Min kväll chip", /Min kväll/.test(chip || ""), chip);
      const urgent = await page.evaluate(() => !!document.querySelector('#hud-x [data-hx="nightlog"].hx-urgent'));
      ok("the chip is never the urgent one", !urgent);
      await shot(page, "1-ikvall-chip");
      await clickJS(page, '#hud-x [data-hx="nightlog"]'); await wait(page, 900);
      const t = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, items: document.querySelectorAll(".nl-it").length, ci: document.querySelectorAll(".nl-ci").length,
        grid: [...document.querySelectorAll(".nl-stat b")].map((x) => x.textContent), kinds: document.querySelectorAll(".nl-kind").length, cols: document.querySelectorAll(".nl-hcol").length,
        place: (document.querySelector(".nl-it:not(.nl-ci) small") || {}).textContent, ghost: /👻/.test(document.querySelector(".nl-list").textContent), chips: document.querySelectorAll(".nl-night").length,
        overflow: document.querySelector("#sheet-body").scrollWidth > document.querySelector("#sheet-body").clientWidth + 1 }));
      ok("sheet 📊 Min kväll: 8 timeline rows, 2 check-ins", /^(📊 )?Min kväll$/.test(t.title.trim()) && t.items === 8 && t.ci === 2, t);   // suite: pnds titles carry no emoji
      ok("stats grid: 6 drinks, 2,1 per hour, first time, 3 places", t.grid[0] === "6" && t.grid[1] === "2,1" && /^\d\d:\d\d$/.test(t.grid[2]) && t.grid[3] === "3", t.grid);
      ok("kinds chips (4) + hour bars (4) + place line + ghost mark", t.kinds === 4 && t.cols === 4 && /Pitchers/.test(t.place || "") && t.ghost, t);
      ok("night chips (3) and no sideways scroll", t.chips === 3 && !t.overflow, t);
      await shot(page, "2-minkvall");
      await page.evaluate(() => document.querySelector("#sheet-body").scrollTo(0, 9999)); await wait(page, 200);
      await shot(page, "3-minkvall-timeline");
      await page.evaluate(() => document.querySelectorAll(".nl-night")[1].click()); await wait(page, 900);
      const lg = await page.evaluate(() => ({ note: [...document.querySelectorAll(".nl-note")].map((x) => x.textContent).join(" "), items: document.querySelectorAll(".nl-it").length, on: (document.querySelector(".nl-night.on") || {}).textContent }));
      ok("older night → my_night_log(p_night) + legacy note", calls.some((c) => c[0] === "my_night_log" && c[1].p_night) && /7\/11/.test(lg.note) && lg.items === 5, lg);
      await page.evaluate(() => document.querySelector("#sheet-body").scrollTo(0, 0));
      await shot(page, "4-minkvall-legacy");
      ok("no page errors (1)", !errs.length, errs);
      await ctx.close();
    }
    /* 2. Event page + tiles, locked page, Grupper fold, chat header, invite box */
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = []; const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await routes(page, calls); await boot(page);
      await page.evaluate(() => window.EVCHAT && window.EVCHAT._poll && window.EVCHAT._poll(true)); await wait(page, 500);
      await page.evaluate(() => document.getElementById("btn-groups").click()); await wait(page, 1400);
      const g = await page.evaluate(() => ({ evc: !!document.querySelector(".evc-sec:not([hidden]) .evc-row"), fold: (document.querySelector(".evg-fold summary") || {}).textContent }));
      ok("Grupper: 📨 Kvällens event row + 🗂️ Tidigare event fold", g.evc && /Tidigare event \(2\)/.test(g.fold || ""), g);
      await page.evaluate(() => { const d = document.querySelector(".evg-fold"); if (d) { d.open = true; d.scrollIntoView(); } }); await wait(page, 300);
      await shot(page, "5-grupper-fold");
      await page.evaluate(() => document.querySelector(".evc-sec .evc-row").click()); await wait(page, 1500);
      const p = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, people: document.querySelectorAll(".evg-p").length,
        chat: !!document.querySelector(".evg-chat"), ff: !!document.querySelector(".evg-tiles .ff-gi"), pt: !!document.querySelector(".evg-tiles .pt-gi"), rnd: !!document.querySelector(".evg-tiles .rnd-gi"), sp: !!document.querySelector("#sheet-body .sp-gi"),
        note: (document.querySelector(".evg-note") || {}).textContent, overflow: document.querySelector("#sheet-body").scrollWidth > document.querySelector("#sheet-body").clientWidth + 1 }));
      ok("row tap opens the event page (event_group)", calls.some((c) => c[0] === "event_group") && /Förfest hos Anton/.test(p.title), p.title);
      ok("event page: 3 people, 💬 Chatt, one 🎉 Spel card (Förfest + Partyspel merged, 197c586) + 💸 Kvällens nota", p.people === 3 && p.chat && p.sp && !p.ff && !p.pt && p.rnd, p);
      ok("event page: temporary-group note, no sideways scroll", /tillfällig/.test(p.note || "") && !p.overflow, p);
      ok("party_group + rnd_group asked for the temp group id", calls.some((c) => c[0] === "party_group" && c[1].p_group_id === "7bdbeaa4-0c46-428f-b0e1-72588a28e3c1") && calls.some((c) => c[0] === "rnd_group"));
      await shot(page, "6-event-page");
      await page.evaluate(() => document.querySelector("#sheet-body").scrollTo(0, 9999)); await wait(page, 200);
      await shot(page, "7-event-page-bottom");
      // 🎉 Förfest gets the event people as players
      const names = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("olnu.ffNames"))["7bdbeaa4-0c46-428f-b0e1-72588a28e3c1"]; } catch (e) { return null; } });
      ok("🎉 Förfest players seeded with the event people", names && names.length === 3 && names.includes("Lisa"), names);
      // 💬 Chatt → event chat, with the 🎉 Eventgruppen header button
      await page.evaluate(() => document.querySelector(".evg-chat").click()); await wait(page, 1500);
      const hb = await page.evaluate(() => [...document.querySelectorAll(".evc-acts button")].map((b) => b.textContent));
      ok("💬 Chatt opens the event chat; header has 🎉 Eventgruppen", hb.some((x) => /Eventgruppen/.test(x)), hb);
      await shot(page, "8-chat-header");
      await page.evaluate(() => [...document.querySelectorAll(".evc-acts button")].find((b) => /Eventgruppen/.test(b.textContent)).click()); await wait(page, 1200);
      ok("🎉 Eventgruppen in the chat → back to the page", await page.evaluate(() => !!document.querySelector(".evg-chat")));
      ok("no page errors (2)", !errs.length, errs);
      await ctx.close();
    }
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = [];
      await routes(page, calls, { eg: { can_play: false, can_write: false, my_answer: "none", mine: false } }); await boot(page);
      await page.evaluate(() => window.EVGROUP.open({ group_id: "7bdbeaa4-0c46-428f-b0e1-72588a28e3c1", title: "🎉 Förfest hos Anton" })); await wait(page, 1200);
      const l = await page.evaluate(() => ({ lock: (document.querySelector(".evg-lock") || {}).textContent, tiles: document.querySelectorAll(".evg-tiles").length }));
      ok("invited without answer: hint, no game / tab tiles", /✅|🤔/.test(l.lock || "") && l.tiles === 0, l);
      await shot(page, "9-event-locked");
      await ctx.close();
    }
    /* 3. Past event + recap (the live event_story json) */
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = []; const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await routes(page, calls, { eg: { past: true, state: "archived", can_play: false, starts_at: at(1620) } }); await boot(page);
      await page.evaluate(() => window.EVGROUP.open({ group_id: "7bdbeaa4-0c46-428f-b0e1-72588a28e3c1", title: "🎉 Förfest hos Anton" })); await wait(page, 1200);
      const pb = await page.evaluate(() => ({ recap: !!document.querySelector(".evg-recap-btn"), lock: (document.querySelector(".evg-lock") || {}).textContent }));
      ok("past event page: 📰 Kvällens tidning button, play closed", pb.recap && /över|avslutat/i.test(pb.lock || ""), pb);
      await shot(page, "10-event-past");
      await page.evaluate(() => document.querySelector(".evg-recap-btn").click());
      await page.waitForSelector(".evg-pimg", { timeout: 15000 }).catch(() => {});
      await wait(page, 800);
      const r = await page.evaluate(() => ({ img: !!document.querySelector(".evg-pimg"), who: document.querySelectorAll(".evg-who li").length, q: document.querySelectorAll(".evg-q").length,
        ph: document.querySelectorAll(".evg-ph img").length, grid: [...document.querySelectorAll(".evg-grid b")].map((x) => x.textContent),
        overflow: document.querySelector("#sheet-body").scrollWidth > document.querySelector("#sheet-body").clientWidth + 1,
        off: (() => { const b = document.querySelector("#sheet-body"), W = b.getBoundingClientRect().right; return [...b.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > W + 1).slice(0, 4).map((e) => e.tagName + "." + e.className); })() }));
      ok("recap: Morgontidningen canvas drawn (GANG._drawStory)", r.img, r);
      ok("recap: who came (3), quotes, photo, stats", r.who === 3 && r.q >= 1 && r.ph >= 1 && r.grid[0] === "3" && r.grid[1] === "21", r);
      ok("recap: no sideways scroll", !r.overflow);
      await shot(page, "11-recap-paper");
      await page.evaluate(() => document.querySelector("#sheet-body").scrollTo(0, 99999)); await wait(page, 300);
      await shot(page, "12-recap-bottom");
      ok("no page errors (3)", !errs.length, errs);
      await ctx.close();
    }
    /* 4. 👤 Profil rows + old server */
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = [];
      await routes(page, calls); await boot(page);
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1500);
      const pr = await page.evaluate(() => ({ nl: [...document.querySelectorAll("#sheet-body h3")].some((h) => /Min kväll/.test(h.textContent)), past: document.querySelectorAll(".evg-past:not([hidden]) .evg-prow").length }));
      ok("👤 Profil: 📊 Min kväll row + 🗂️ Tidigare event (2)", pr.nl && pr.past === 2, pr);
      await page.evaluate(() => { const h = [...document.querySelectorAll("#sheet-body h3")].find((x) => /Min kväll/.test(x.textContent)); if (h) { const b = document.querySelector("#sheet-body"); b.scrollTop += h.getBoundingClientRect().top - b.getBoundingClientRect().top - 20; } }); await wait(page, 300);
      await shot(page, "13-profil");
      await ctx.close();
    }
    {
      const { ctx, page } = await ctxFor(browser, VP); const calls = []; const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await routes(page, calls, { old: true }); await boot(page);
      await clickJS(page, "#my-streak"); await wait(page, 300);
      await page.evaluate(() => window.NIGHTLOG.open()); await wait(page, 800);
      await page.evaluate(() => window.EVGROUP.open({ group_id: "7bdbeaa4-0c46-428f-b0e1-72588a28e3c1", title: "x", invite_id: 16 })); await wait(page, 800);
      ok("old server: no page errors, the event page falls back", !errs.length, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
