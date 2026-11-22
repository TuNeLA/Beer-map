// mybeer-pw.js — lane mybeer (owner 22 Nov 2026, I-146 P1 + I-147 Q1), 390 px, mocked Supabase. Usage: node mybeer-pw.js <port>
// I-147 the ÖL! button becomes the beer I picked: the beer's colour + foam, its short name in place of "ÖL!" (BLANC, GUINNESS),
//       text contrast >= 4.5:1, the name fits; the wait fills the glass with that colour; one way back ("Vanlig ÖL!");
//       06:00 = back to ÖL!; store build = the same look (no effect); reduced motion = still; Christmas hat stays, GLÖGG steps back;
//       LÄSK! (driving) wins. A beer page has "Jag dricker den här".                       (js/mybeer.js, js/mybeer-look.js)
// I-146 a drawn mini bottle / can beside my pin and a group mate's pin (beer_lib_pins), never a stranger's pin or a cluster;
//       privacy "spoke" (server answers []) = none; an old server (PGRST202) = my own beer only, no errors, no retries.
// Old code: no MYBEER, no pn-beer: every check except "no page errors" FAILS.
// MB_SHOTS=<dir> saves the after pictures (390x844 @2x).
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.env.MB_SHOTS || "";
const BLANC = "5740700980176", GUIN = "5000213016107", KRON = "5740700992636", NORR = "7310401006925";
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 700)); };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const C = [60.1560, 15.1940];   // a quiet street (no bar): every pin here is a person pin
const pin = (id, ll, n, o = {}) => ({ id, lat: ll[0], lng: ll[1], beer_count: n, precise: true, created_at: iso(30), is_mine: !!o.mine, friend_name: o.f || null,
  skal_count: 0, i_skaled: false, shot_count: 0 });
const PINS = [pin(9001, C, 3, { mine: 1 }), pin(9002, [C[0] + 0.0018, C[1]], 2, { f: "Lisa" }), pin(9003, [C[0] - 0.0018, C[1]], 4),
  pin(9010, [C[0] - 0.0036, C[1]], 2, { f: "Oskar" }), pin(9011, [C[0] - 0.00361, C[1] + 0.00002], 1), pin(9012, [C[0] - 0.00359, C[1] - 0.00002], 5)];

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, o.vp || { width: 390, height: 844 }, { reduced: !!o.reduced });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  if (o.init) await ctx.addInitScript(o.init, o.initArg || null);
  const errs = [], calls = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/(live_beers|set_beer_lib|beer_lib_pins|set_beer_type|post_beer_v2|beerlib_\w+)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (fn === "live_beers") return J(r, PINS);
    if ((fn === "set_beer_lib" || fn === "beer_lib_pins") && o.old) return J(r, { code: "PGRST202", message: "Could not find the function public." + fn }, 404);
    if (fn === "set_beer_lib") return J(r, { ok: true, beer: b.p_beer });
    if (fn === "beer_lib_pins") return J(r, o.spoke ? [] : [{ id: 9002, beer: GUIN }, { id: 9010, beer: NORR }, { id: 9003, beer: KRON }]);
    if (fn === "set_beer_type") return J(r, { ok: true });
    if (fn === "post_beer_v2") return J(r, { accepted: true, beer_count: 4, drinks: 4, lat: b.p_lat, lng: b.p_lng, precise: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
      wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() });
    if (fn === "beerlib_favs_mine") return J(r, o.favs || []);
    if (fn === "beerlib_beer_get") return J(r, { my_stars: null, fav_slot: null, n: 0, avg: null, reviews: [] });
    return J(r, []);
  });
  await boot(page);
  await page.waitForFunction(() => !!window.MYBEER, null, { timeout: 8000 }).catch(() => console.log("no MYBEER"));
  return { ctx, page, errs, calls };
}
// the button now: label, colours, contrast (WCAG) of the text on the fill and on the light gradient stop, fit
const btn = (page) => page.evaluate(() => {
  const b = document.getElementById("btn-beer"), l = document.getElementById("beer-label"), cs = getComputedStyle(l), bs = getComputedStyle(b);
  const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const hx = (h) => { h = String(h).trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)); };
  const lum = (c) => { c = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, c) => { const x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const liq = bs.getPropertyValue("--mb-liq").trim(), hi = bs.getPropertyValue("--mb-hi").trim(), ink = rgb(cs.color);
  let w = 0; try { const r = document.createRange(); r.selectNodeContents(l); w = r.getBoundingClientRect().width; } catch (e) {}
  return { text: l.textContent, aria: b.getAttribute("aria-label") || "", on: document.body.classList.contains("pn-mybeer") && b.classList.contains("mb-on"),
    liq, ink: cs.color, cFill: liq ? +ratio(ink, hx(liq)).toFixed(2) : 0, cHi: hi ? +ratio(ink, hx(hi)).toFixed(2) : 0, fs: parseFloat(cs.fontSize),
    textW: Math.round(w), bw: b.clientWidth, bg: bs.backgroundImage, cls: b.className, anims: b.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    mug: (() => { const m = b.querySelector(".ss-mug"); return !!m && getComputedStyle(m).display !== "none"; })() };
});
// (old code: no MYBEER -> nothing happens, so the same steps make the "before" pictures and the checks FAIL)
const pickBeer = (page, id) => page.evaluate((id) => !window.MYBEER ? null : PN.beerlib().then((B) => B.load().then((d) => { const b = d.byId[id]; return MYBEER.pick({ id: b.id, n: b.name, t: B._kind(b), look: B.lookOf(b) }); })), id);
const toasts = (page) => page.evaluate(() => document.querySelectorAll(".toast:not(.hide), #toast:not([hidden]) .toast-msg, .pn-toast").length);
const shot = async (page, name) => { if (SHOTS) { await page.screenshot({ path: SHOTS + "/" + name + ".png" }); console.log("shot", name); } };
const zoomPins = (page, z) => page.evaluate(([c, z]) => window.__map.setView(c, z, { animate: false }), [[C[0] - 0.0012, C[1]], z || 16]);
const pinState = (page) => page.evaluate(() => {
  const ps = [...document.querySelectorAll(".pn-p")].map((p) => ({ cls: p.className, nm: (p.querySelector(".pn-nm") || {}).textContent || "", beer: !!p.querySelector(".pn-beer"),
    svg: (p.querySelector(".pn-beer") || { innerHTML: "" }).innerHTML }));
  return { mine: ps.filter((p) => /pn-m/.test(p.cls)), lisa: ps.filter((p) => p.nm === "Lisa"), strangers: ps.filter((p) => /pn-s/.test(p.cls)),
    clusters: [...document.querySelectorAll(".pn-cl")].map((c) => ({ beer: !!c.querySelector(".pn-beer"), txt: c.textContent })), n: ps.length };
});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  let ctx, page, errs, calls;
  const part = async (name, fn) => { try { await fn(); } catch (e) { fail++; console.log("FAIL " + name + " exception", e && e.message); } if (ctx) await ctx.close().catch(() => {}); ctx = null; };

  await part("I-147 button", async () => {
    ({ ctx, page, errs, calls } = await open(browser));
    const b0 = await btn(page);
    ok("I-147 before a pick: plain ÖL!", b0.text === "ÖL!" && !b0.on, b0);
    await shot(page, "1-olbutton-before");
    await pickBeer(page, BLANC); await wait(page, 400);
    const b1 = await btn(page);
    ok("I-147 a pale beer (1664 Blanc): the label is BLANC, the button is the beer", b1.text === "BLANC" && b1.on && /BLANC|1664 Blanc/.test(b1.aria), b1);
    ok("I-147 pale beer: text contrast >= 4.5 on the fill and on the light stop", b1.cFill >= 4.5 && b1.cHi >= 4.5, b1);
    ok("I-147 pale beer: dark ink (the higher contrast)", /rgb\(26, 15, 0\)/.test(b1.ink), b1.ink);
    ok("I-147 the name fits the round button", b1.text === "BLANC" && b1.textW > 0 && b1.textW <= b1.bw * 0.88, b1);
    ok("I-147 aria-label names the full beer", b1.aria === "Logga en öl (1664 Blanc Wheat Beer)", b1.aria);
    ok("I-147 set_beer_lib is sent with the id", calls.some((c) => c[0] === "set_beer_lib" && c[1].p_beer === BLANC), calls.map((c) => c[0]));
    ok("I-147 no motion added (no running animation on the button at rest)", b1.anims === 0, b1);
    await shot(page, "1-olbutton-blanc");
    await pickBeer(page, GUIN); await wait(page, 400);
    const b2 = await btn(page);
    ok("I-147 a dark beer (Guinness): GUINNESS, foam ink, contrast >= 4.5", b2.text === "GUINNESS" && /rgb\(255, 246, 222\)/.test(b2.ink) && b2.cFill >= 4.5 && b2.cHi >= 4.5, b2);
    ok("I-147 GUINNESS fits", b2.text === "GUINNESS" && b2.textW <= b2.bw * 0.88 && b2.fs >= 11, b2);
    await shot(page, "2-olbutton-guinness");
    // a long hand name (10 letters) still fits, at >= 11 px
    await pickBeer(page, "5410228158424"); await wait(page, 300);
    const b3 = await btn(page);
    ok("I-147 HOEGAARDEN fits (>= 11 px)", b3.text === "HOEGAARDEN" && b3.textW <= b3.bw * 0.88 && b3.fs >= 11, b3);
    // the wait: the glass fills with my beer colour
    await pickBeer(page, GUIN);
    await page.evaluate(() => { const n = JSON.parse(localStorage.getItem("olnu.night")); n.lastTap = Date.now() - 2 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); PN.tickCooldown(); });
    await wait(page, 500);
    const cd = await btn(page);
    ok("I-147 the wait: the glass fills with the beer colour (Guinness)", /cooldown/.test(cd.cls) && /rgb\(48, 10, 6\)/.test(cd.bg) && /\d:\d\d/.test(cd.text), { cls: cd.cls, bg: cd.bg.slice(0, 300), t: cd.text });
    await shot(page, "3-olbutton-wait-guinness");
    await page.evaluate(() => { const n = JSON.parse(localStorage.getItem("olnu.night")); n.lastTap = Date.now() - 60 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); PN.tickCooldown(); });
    await wait(page, 400);
    ok("I-147 after the wait: the beer stays (GUINNESS)", (await btn(page)).text === "GUINNESS");
    // 06:00: a pick from yesterday evening is over
    await page.evaluate(() => { const x = JSON.parse(localStorage.getItem("olnu.beer.now")); x.at = Date.now() - 30 * 3600e3; localStorage.setItem("olnu.beer.now", JSON.stringify(x)); window.MYBEER && MYBEER.sync(); });
    await wait(page, 300);
    const b4 = await btn(page);
    ok("I-147 06:00 (night end): back to plain ÖL!, the pick is gone", b4.text === "ÖL!" && !b4.on && !(await page.evaluate(() => localStorage.getItem("olnu.beer.now"))), b4);
    // LÄSK! wins
    await pickBeer(page, BLANC); await wait(page, 200);
    await page.evaluate(() => { window.__sk = window.SKJUTS; window.SKJUTS = Object.assign({}, window.SKJUTS || {}, { driving: () => true }); LASK.sync(); MYBEER.sync(); });
    await wait(page, 300);
    const b5 = await btn(page);
    ok("I-147 driving (LÄSK!) wins over the beer", b5.text === "LÄSK!" && !b5.on, b5);
    await page.evaluate(() => { window.SKJUTS = window.__sk; LASK.sync(); MYBEER.sync(); });
    await wait(page, 300);
    ok("I-147 driving off: the beer comes back", (await btn(page)).text === "BLANC");
    ok("I-147 no page errors", errs.length === 0, errs);
  });

  await part("I-147 strip", async () => {
    // the strip flow: favourites -> pick -> the button; "Vanlig ÖL!" -> back
    ({ ctx, page, errs, calls } = await open(browser, { favs: [{ slot: 1, beer: BLANC }, { slot: 2, beer: GUIN }] }));
    await page.evaluate(() => PN.beerlib().then((B) => B.favs(true)));
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("olnu.beer.favMini")).l.length === 2; } catch (e) { return false; } }, null, { timeout: 10000 }).catch(() => {});
    const mini = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.beer.favMini") || "null"));
    ok("I-147 the favourites copy keeps each beer's look (short name, container, 2 colours)", !!mini && mini.l[0].lk && mini.l[0].lk.sn === "BLANC" && mini.l[1].lk.sn === "GUINNESS" && /^#[0-9A-F]{6}$/.test(mini.l[1].lk.c1), mini);
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForSelector(".bp-strip:not([hidden]) .bp-st-fav", { timeout: 6000 }).catch(() => {});
    const t0 = await toasts(page);
    await page.evaluate((id) => document.querySelector(".bp-strip [data-bpf='" + id + "']").click(), BLANC);
    await wait(page, 900);
    const t1 = await toasts(page);
    const now = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.beer.now") || "null"));
    ok("I-147 a favourite pick in the strip = my beer now (set_beer_lib + set_beer_type)", !!now && now.id === "5740700980176" && now.sn === "BLANC" &&
      calls.some((c) => c[0] === "set_beer_lib" && c[1].p_beer === BLANC) && calls.some((c) => c[0] === "set_beer_type" && c[1].p_type === "vete"), { now, calls: calls.map((c) => c[0]) });
    ok("I-147 one text pop-up for that pick (at most)", t1 - t0 <= 1, { t0, t1 });
    const cd = await btn(page);
    ok("I-147 right after the pick (Ångra / wait) the glass already has the beer colour", cd.on && /rgb\(255, 202, 90\)|rgb\(255, 191, 66\)/.test(cd.bg + cd.liq) || cd.liq === "#FFCA5A", { liq: cd.liq, cls: cd.cls });
    // the next strip: "Vanlig ÖL!" first, my beer marked
    await page.evaluate(() => { const n = JSON.parse(localStorage.getItem("olnu.night")); n.lastTap = Date.now() - 60 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); PN.tickCooldown(); });
    await wait(page, 2600);   // Ångra (10 s) may still hold: wait it out below
    await page.waitForFunction(() => !document.getElementById("btn-beer").classList.contains("undo"), null, { timeout: 12000 }).catch(() => {});
    await page.evaluate(() => { const n = JSON.parse(localStorage.getItem("olnu.night")); n.lastTap = Date.now() - 60 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); PN.tickCooldown(); });
    await wait(page, 300);
    ok("I-147 at rest after the pick: BLANC", (await btn(page)).text === "BLANC");
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForSelector(".bp-strip:not([hidden]) [data-bpplain]", { timeout: 6000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const s = document.querySelector(".bp-strip:not([hidden])"); if (!s) return null;
      const p = s.querySelector("[data-bpplain]"), r = p && p.getBoundingClientRect(), on = s.querySelector("[data-bpf][aria-pressed='true']");
      return { plain: p && p.textContent.trim(), first: s.querySelector(".bp-st-chips button") === p, h: r && r.height, w: r && r.width, marked: on && on.getAttribute("data-bpf") };
    });
    ok("I-147 the next strip starts with 'Vanlig ÖL!' (44 px) and marks my beer", !!st && st.plain === "Vanlig ÖL!" && st.first && st.h >= 44 && st.w >= 44 && st.marked === BLANC, st);
    await shot(page, "4-strip-vanlig-ol");
    await page.evaluate(() => document.querySelector(".bp-strip [data-bpplain]").click());
    await wait(page, 600);
    await page.waitForFunction(() => !document.getElementById("btn-beer").classList.contains("undo"), null, { timeout: 12000 }).catch(() => {});
    await page.evaluate(() => { const n = JSON.parse(localStorage.getItem("olnu.night")); n.lastTap = Date.now() - 60 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); PN.tickCooldown(); });
    await wait(page, 300);
    const b = await btn(page);
    ok("I-147 'Vanlig ÖL!' = back to plain ÖL! + set_beer_lib(null)", b.text === "ÖL!" && !b.on && calls.some((c) => c[0] === "set_beer_lib" && c[1].p_beer === null), { b, calls: calls.filter((c) => c[0] === "set_beer_lib") });
    ok("I-147 (strip) no page errors", errs.length === 0, errs);
  });

  await part("I-147 store + reduced", async () => {
    ({ ctx, page, errs } = await open(browser, { store: true, reduced: true }));
    const isStore = await page.evaluate(() => !!window.OLNU_STORE);
    await pickBeer(page, BLANC); await wait(page, 400);
    const b = await btn(page);
    ok("I-147 store build: the same look (BLANC, beer colour), no animation", isStore && b.text === "BLANC" && b.on && b.anims === 0, { isStore, b });
    const extra = await page.evaluate(() => document.querySelectorAll(".pm-burst, .mb-fx, .confetti").length);
    ok("I-147 store build: no celebration element", extra === 0, extra);
    ok("I-147 (store) no page errors", errs.length === 0, errs);
  });

  await part("I-147 season", async () => {
    ({ ctx, page, errs } = await open(browser));
    await page.evaluate(() => { PNSeason._force({ season: "xmas", wx: "snow" }); PNDress.place(); }); await wait(page, 600);
    const g0 = await btn(page);
    await pickBeer(page, BLANC); await wait(page, 500);
    const g = await btn(page), d = await page.evaluate(() => PNDress.state());
    ok("I-147 Christmas: GLÖGG before the pick", g0.text === "GLÖGG" && g0.mug, g0);
    ok("I-147 Christmas + beer: the hat stays, the GLÖGG mug steps back, BLANC fits, the beer colour wins", d.shown && d.dress && !g.mug && g.text === "BLANC" && g.on &&
      /rgb\(255, 202, 90\)|rgb\(255, 191, 66\)/.test(g.bg) && g.textW <= g.bw * 0.88, { d, g: Object.assign({}, g, { bg: g.bg.slice(-160) }) });
    await shot(page, "5-olbutton-xmas-blanc");
    await page.evaluate(() => MYBEER.clear()); await wait(page, 300);
    ok("I-147 Christmas, beer cleared: GLÖGG again", (await btn(page)).text === "GLÖGG");
    ok("I-147 (season) no page errors", errs.length === 0, errs);
  });

  await part("I-147 beer page", async () => {
    ({ ctx, page, errs } = await open(browser));
    const opened = await page.evaluate((id) => PN.beerlib().then((B) => { if (typeof B.beer !== "function") return false; B.beer(id); return true; }), BLANC);
    ok("I-147 (setup) the beer page opens", opened, opened);
    await page.waitForSelector("#sheet:not([hidden]) [data-bl-now]", { timeout: 8000 }).catch(() => {});
    const t0 = await toasts(page);
    const nb = await page.evaluate(() => { const x = document.querySelector("#sheet [data-bl-now]"); if (!x) return null; const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), h: r.height, svg: !!x.querySelector("svg"), img: !!x.querySelector("image,text") }; });
    ok("I-147 the beer page has 'Jag dricker den här' (44 px, with the drawn bottle, no picture / text in it)", !!nb && nb.t === "Jag dricker den här" && nb.h >= 44 && nb.svg && !nb.img, nb);
    await shot(page, "6-beerpage-jag-dricker");
    await page.evaluate(() => document.querySelector("#sheet [data-bl-now]").click()); await wait(page, 500);
    const t1 = await toasts(page);
    const nb2 = await page.evaluate(() => { const x = document.querySelector("#sheet [data-bl-now]"); return x && { t: x.textContent.trim(), p: x.getAttribute("aria-pressed") }; });
    ok("I-147 tap: my beer now (pressed), the button says BLANC, one toast", !!nb2 && nb2.p === "true" && nb2.t === "Min öl nu" && (await btn(page)).text === "BLANC" && t1 - t0 <= 1, { nb2, t0, t1 });
    await page.evaluate(() => document.querySelector("#sheet [data-bl-now]").click()); await wait(page, 400);
    ok("I-147 tap again: plain ÖL! again", (await btn(page)).text === "ÖL!");
    ok("I-147 (beer page) no page errors", errs.length === 0, errs);
  });

  await part("I-146 pins", async () => {
    ({ ctx, page, errs, calls } = await open(browser));
    await pickBeer(page, BLANC);
    await zoomPins(page, 16); await wait(page, 1500);
    await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await wait(page, 2500);
    const s = await pinState(page);
    const q = calls.filter((c) => c[0] === "beer_lib_pins");
    ok("I-146 my lone pin has the mini bottle (2 colours, no logo / text / picture)", s.mine.length === 1 && s.mine[0].beer && !/<text|<image/.test(s.mine[0].svg) && /#2846B8/i.test(s.mine[0].svg) && /#F4F1EA/i.test(s.mine[0].svg), s.mine);
    ok("I-146 a group mate's pin (Lisa) gets her beer from beer_lib_pins (a can: Guinness)", s.lisa.length === 1 && s.lisa[0].beer && /mb-can/.test(s.lisa[0].svg), s.lisa);
    ok("I-146 a stranger's pin never (even if an answer named it)", s.strangers.length >= 1 && s.strangers.every((p) => !p.beer), s.strangers);
    ok("I-146 a cluster never shows a beer", s.clusters.length >= 1 && s.clusters.every((c) => !c.beer), s.clusters);
    ok("I-146 beer_lib_pins asks only for group mates' numeric ids (not me, not strangers)", q.length >= 1 && q.every((c) => Array.isArray(c[1].p_ids) && c[1].p_ids.every((x) => x === 9002 || x === 9010)) && q[0][1].p_ids.indexOf(9002) >= 0, q.map((c) => c[1]));
    await shot(page, "7-pins-me-lisa");
    await page.evaluate(() => { window.__map.setView([60.1560, 15.1940], 17, { animate: false }); }); await wait(page, 1500);
    await shot(page, "7b-pins-me-zoom17");
    await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await wait(page, 600);
    ok("I-146 at most one beer_lib_pins per minute for the same pins", calls.filter((c) => c[0] === "beer_lib_pins").length === q.length, calls.filter((c) => c[0] === "beer_lib_pins").length);
    ok("I-146 (pins) no page errors", errs.length === 0, errs);
  });

  await part("I-146 spoke", async () => {
    ({ ctx, page, errs } = await open(browser, { spoke: true }));
    await zoomPins(page, 16); await wait(page, 1200);
    await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await wait(page, 1500);
    const s = await pinState(page);
    ok("I-146 privacy 'spoke' (the server answers []): no beer on Lisa", s.lisa.length === 1 && !s.lisa[0].beer, s.lisa);
  });

  await part("I-146 old server", async () => {
    ({ ctx, page, errs, calls } = await open(browser, { old: true }));
    const cons = []; page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") cons.push(m.text()); });
    await pickBeer(page, BLANC);
    await zoomPins(page, 16); await wait(page, 1200);
    await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await wait(page, 1200);
    await page.evaluate(() => { MYBEER._state().srv; });
    await page.evaluate(() => { window.__mbT = Date.now(); });
    // more polls later (the 1-minute gate is passed by a new pin set): no 2nd call after the server said "missing"
    await page.evaluate(() => window.MYBEER && MYBEER.onPoll()); await wait(page, 400);
    const s = await pinState(page), b = await btn(page);
    const n = calls.filter((c) => c[0] === "beer_lib_pins").length;
    ok("I-146 old server: my own beer still on my pin and my button", s.mine.length === 1 && s.mine[0].beer && b.text === "BLANC", { mine: s.mine, b: b.text });
    ok("I-146 old server: no friend beers, beer_lib_pins asked once only", s.lisa.length === 1 && !s.lisa[0].beer && n === 1, { n, lisa: s.lisa });
    await pickBeer(page, GUIN); await wait(page, 400);
    ok("I-146 old server: set_beer_lib is not asked again after PGRST202", calls.filter((c) => c[0] === "set_beer_lib").length === 1, calls.filter((c) => c[0] === "set_beer_lib").length);
    ok("I-146 old server: no page errors, no console errors from mybeer", errs.length === 0 && !cons.some((x) => /mybeer|beer_lib/i.test(x)), { errs, cons: cons.slice(0, 5) });
  });

  await browser.close();
  console.log(`\nmybeer: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
