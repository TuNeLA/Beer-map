// dbeer-pw.js — lane d-beer, I-114 (owner 15 Nov 2026, design proposals 02 + 04 with his changes).
// A  after an accepted ÖL! (web build): NO text pop-up, the count burst is the answer. The ÖL! button itself is "Ångra"
//    for 10 s (dark glass + a ring that runs down), then the timer. Order: tap → number + effect → Ångra → timer.
//    Taps in the first 1.0 s do nothing. A tap on "Ångra" = undo_beer, the count goes back, the button is ready again.
//    Nothing covers the Annat button (the old round ↩ sat on it). Store build: ONE plain fact toast, no burst, same button.
//    Offline / refused / error taps keep their toast.
// A4 the wait: only m:ss in the middle of the glass (no "Nästa öl om", no box), readable on the empty and the full glass.
// A5 the burst: soft dark backdrop, about 1.6 s in all, and a beer that got no burst at the tap and no card gets it late.
// B  "Var dricker du?": the nearest bar = the one amber button, rows with the distance at the right, "Hemma eller annan
//    plats" in view without scrolling (360x640 and 390x844) with rounded corners; pick / cancel / the 150 m rule as before.
// N  Min kväll: "Ångra" on the newest beer row while the server's 2-minute window is open.
// Mocked Supabase. Usage: node dbeer-pw.js <port> [part,part…]   parts: tap, undo, guard, store, keep, wait, burst, where, night
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const PARTS = (process.argv[3] || "tap,undo,guard,store,keep,wait,burst,where,night").split(",");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 700)); };
const J = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const PITCH = { latitude: 60.14997, longitude: 15.18679 }, PARMA = { latitude: 60.15124, longitude: 15.18797 };

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: o.w || 390, height: o.h || 844 }, { reduced: !!o.reduced, checkin: o.checkin, lang: o.lang });
  await ctx.setGeolocation(o.geo || PITCH);   // at Pitchers = the seeded check-in: no "Var dricker du?"
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); } catch (e) {} });
  const errs = [], calls = [], srv = { refuse: 0, net: false, slow: 0, n: o.n || 7 };
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, async (r) => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push(["post_beer_v2", b]);
    if (srv.slow) await new Promise((res) => setTimeout(res, srv.slow));
    if (srv.net) return r.abort("failed");
    if (srv.refuse) return J(r, { accepted: false, wait_seconds: srv.refuse, beer_count: srv.n - 1 });
    return J(r, { accepted: true, beer_count: srv.n, drinks: srv.n, lat: b.p_lat, lng: b.p_lng, precise: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
      wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() });
  });
  await page.route(/rest\/v1\/rpc\/undo_beer/, (r) => { calls.push(["undo_beer"]); return J(r, { ok: true, beer_count: srv.n - 1, undos_left: 2 }); });
  if (o.route) await o.route(page, calls);
  await boot(page);
  await page.waitForFunction(() => window.MYCOUNT && window.FX && window.PN && window.PN.tickCooldown && document.getElementById("btn-beer"), null, { timeout: 15000 }).catch(() => console.log("app not ready"));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await wait(page, 400);
  return { ctx, page, errs, calls, srv };
}
const n = (calls, fn) => calls.filter((c) => c[0] === fn).length;
// Watch the page for `ms` after an (optional) ÖL! tap: one row every 50 ms. Runs in the page.
const watch = (page, ms, tap) => page.evaluate(([ms, tap]) => new Promise((res) => {
  const t0 = performance.now(), rows = [], b = document.getElementById("btn-beer"), o = document.getElementById("btn-other"), lab = document.getElementById("beer-label");
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const hit = (r, q) => !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom);
  const snap = () => {
    const or = o.getBoundingClientRect(), on = or.width > 0;
    // the things this flow puts on screen: none may lie on the Annat button
    const over = on ? [...document.querySelectorAll(".undo-fab, .undo-pill, #toasts .toast, .pn-beerok, .pm-burst .pm-num, .pm-burst .pm-sub")].filter((e) => vis(e) && hit(or, e.getBoundingClientRect())).map((e) => e.className) : [];
    const mid = on ? document.elementFromPoint(or.left + or.width / 2, or.top + or.height * 0.6) : null;
    rows.push({ t: Math.round(performance.now() - t0), undo: b.classList.contains("undo"), cd: b.classList.contains("cooldown"), dis: b.disabled, label: lab.textContent, aria: b.getAttribute("aria-label") || "",
      toasts: [...document.querySelectorAll("#toasts .toast")].filter(vis).map((x) => x.textContent.trim().slice(0, 80)), chip: document.querySelectorAll(".pn-beerok").length,
      burst: !!document.querySelector(".pm-burst"), fab: document.querySelectorAll(".undo-fab").length, over: over, annat: !on || !mid || mid === o || o.contains(mid) });
  };
  const iv = setInterval(snap, 50);
  if (tap) b.click();
  snap();
  setTimeout(() => { clearInterval(iv); snap(); res(rows); }, ms);
}), [ms, tap ? 1 : 0]);
const at = (rows, ms) => rows.reduce((best, r) => (Math.abs(r.t - ms) < Math.abs(best.t - ms) ? r : best), rows[0]);
const first = (rows, f) => { const r = rows.find(f); return r ? r.t : -1; };
// WCAG contrast of two css rgb() colours
const lum = (c) => { const m = String(c).match(/[\d.]+/g).slice(0, 3).map((v) => { v = +v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// the timer state with `left` ms to go (the app's own tick paints it)
const cooldownAt = (page, leftMs) => page.evaluate((leftMs) => {
  const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = Date.now() - (window.U.COOLDOWN_MS - leftMs) + 400;
  localStorage.setItem("olnu.night", JSON.stringify(m)); window.PN.tickCooldown();
}, leftMs);
const timer = (page) => page.evaluate(() => {
  const b = document.getElementById("btn-beer"), lab = document.getElementById("beer-label"), sub = document.getElementById("beer-sub"), cs = getComputedStyle(lab), br = b.getBoundingClientRect(), lr = lab.getBoundingClientRect();
  const boxes = [lab, ...lab.querySelectorAll("*")].map((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, bw: parseFloat(c.borderTopWidth) + parseFloat(c.borderLeftWidth) }; });
  return { label: lab.textContent, text: b.textContent.trim(), aria: b.getAttribute("aria-label") || "", sub: sub.textContent, subShown: getComputedStyle(sub).display !== "none" && sub.getBoundingClientRect().height > 0,
    box: boxes.some((x) => x.bw > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(x.bg)), font: cs.fontFamily, size: parseFloat(cs.fontSize), color: cs.color, stroke: cs.webkitTextStrokeColor, strokeW: parseFloat(cs.webkitTextStrokeWidth),
    paint: cs.paintOrder, fill: b.style.getPropertyValue("--fill"), cells: [...lab.querySelectorAll(".bt-d")].map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10),
    mid: Math.abs((lr.left + lr.width / 2) - (br.left + br.width / 2)) < 2 && Math.abs((lr.top + lr.height / 2) - (br.top + br.height / 2)) < 4, inside: lr.left >= br.left + 3 && lr.right <= br.right - 3, dis: b.disabled, cd: b.classList.contains("cooldown") };
});

(async () => {
  const browser = await chromium.launch();
  try {
    let ctx, page, errs, calls, srv;

    // ---------- A1 + A2 · the tap: no pop-up, burst, then "Ångra" 10 s on the button, then the timer ----------
    if (PARTS.includes("tap")) {
      ({ ctx, page, errs, calls } = await open(browser));
      const rest = await page.evaluate(() => ({ label: document.getElementById("beer-label").textContent, cd: document.getElementById("btn-beer").classList.contains("cooldown") }));
      ok("rest: the button says ÖL!", rest.label === "ÖL!" && !rest.cd, rest);
      const rows = await watch(page, 12300, true);
      const r300 = at(rows, 300), r1500 = at(rows, 1500);
      ok("A1 no text pop-up after an accepted ÖL!: the toast stack is empty at +300 ms and +1500 ms", r300.toasts.length === 0 && r1500.toasts.length === 0, { r300: r300.toasts, r1500: r1500.toasts });
      ok("A1 no toast and no 'Öl #N registrerad' chip at any time in the 12 s after the tap", rows.every((r) => r.toasts.length === 0 && r.chip === 0), rows.filter((r) => r.toasts.length || r.chip).slice(0, 3));
      ok("A1 the count burst shows while there is no toast (+300 ms)", r300.burst === true, r300);
      const tBurst = first(rows, (r) => r.burst), tUndo = first(rows, (r) => r.undo), tEnd = first(rows, (r) => r.t > tUndo && !r.undo);
      ok("A2 order: number + effect first, then 'Ångra' on the button (not before 0.55 s, at 1.6 s the latest)", tBurst >= 0 && tBurst < tUndo && tUndo >= 550 && tUndo <= 1600, { tBurst, tUndo });
      ok("A2 before 'Ångra' the button keeps ÖL! (no timer flash)", rows.filter((r) => r.t < tUndo).every((r) => r.label === "ÖL!" && r.dis), rows.filter((r) => r.t < tUndo && r.label !== "ÖL!").slice(0, 2));
      const u = at(rows, tUndo + 2000);
      ok("A2 'Ångra' state: the word Ångra, enabled, aria-label 'Ångra senaste ölen'", u.undo && u.label === "Ångra" && !u.dis && u.aria === "Ångra senaste ölen", u);
      ok("A2 'Ångra' stays 10 s (9.6–10.6 s), then the timer", tEnd - tUndo >= 9600 && tEnd - tUndo <= 10600, { tUndo, tEnd });
      const after = rows[rows.length - 1];
      ok("A2 after the 10 s: the timer (m:ss), disabled, aria 'Paus, m:ss kvar'", !after.undo && after.cd && after.dis && /^9:\d\d$/.test(after.label) && /^Paus, 9:\d\d kvar$/.test(after.aria), after);
      ok("A2 no floating undo button, nothing of this flow lies on Annat (whole flow)", rows.every((r) => r.fab === 0 && r.over.length === 0 && r.annat), rows.filter((r) => r.fab || r.over.length || !r.annat).slice(0, 3));
      ok("A2 no undo_beer was sent (nobody tapped Ångra)", n(calls, "undo_beer") === 0 && n(calls, "post_beer_v2") === 1, calls.map((c) => c[0]));
      ok("tap: no page errors", errs.length === 0, errs);
      await ctx.close();

      // the look of the Ångra state (taken 2 s after the tap)
      ({ ctx, page, errs, calls } = await open(browser));
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await page.waitForFunction(() => document.getElementById("btn-beer").classList.contains("undo"), null, { timeout: 5000 }).catch(() => {});
      await wait(page, 600);
      const lk = await page.evaluate(() => {
        const b = document.getElementById("btn-beer"), lab = document.getElementById("beer-label"), ring = document.getElementById("cd-ring"), cs = getComputedStyle(b), ls = getComputedStyle(lab), rs = getComputedStyle(ring);
        const an = ring.getAnimations()[0], br = b.getBoundingClientRect(), lr = lab.getBoundingClientRect(), o = document.getElementById("btn-other").getBoundingClientRect();
        return { icon: !!lab.querySelector("svg"), word: lab.textContent, bg: cs.backgroundImage, color: ls.color, size: parseFloat(ls.fontSize), ringOp: rs.opacity, ringDur: an ? an.effect.getTiming().duration : 0,
          ringProps: an ? an.effect.getKeyframes().map((k) => k.strokeDashoffset).join(">") : "", bub: getComputedStyle(b.querySelector(".pn-cdbub")).display, inside: lr.left >= br.left && lr.right <= br.right && lr.top >= br.top && lr.bottom <= br.bottom,
          w: br.width, h: br.height, annatW: o.width, emoji: /[\u2190-\u21ff\u2600-\u27bf\ud83c-\ud83e]/.test(lab.textContent) };
      });
      ok("A2 look: undo icon (svg, no emoji) + the word inside the round button", lk.icon && lk.word === "Ångra" && lk.inside && !lk.emoji, lk);
      ok("A2 look: dark glass, not the amber ÖL! face (no beer fill, no bubbles), amber word ≥ 4.5:1 on it", /radial-gradient\(circle at 35% 30%, rgb\(34, 46, 72\)/.test(lk.bg) && lk.bub === "none" && contrast(lk.color, "rgb(34, 46, 72)") >= 4.5 && lk.size >= 16, { bg: lk.bg.slice(0, 90), bub: lk.bub, c: contrast(lk.color, "rgb(34, 46, 72)") });
      ok("A2 look: a ring runs down over the 10 s", lk.ringOp === "1" && lk.ringDur === 10000 && /^0(px)?>(351\.86px|var\(--bu-ring-len\))$/.test(lk.ringProps), lk);
      ok("A2 look: the button is a ≥ 44 px target and Annat is there", lk.w >= 90 && lk.h >= 90 && lk.annatW >= 44, lk);
      await ctx.close();

    }

    // ---------- A2 · a tap on "Ångra" = undo: count back, button ready, one calm toast ----------
    if (PARTS.includes("undo")) {
      ({ ctx, page, errs, calls } = await open(browser));
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await page.waitForFunction(() => document.getElementById("btn-beer").classList.contains("undo"), null, { timeout: 5000 }).catch(() => {});
      await wait(page, 1500);
      const b4 = await page.evaluate(() => ({ night: JSON.parse(localStorage.getItem("olnu.night")).count, me: window.PN.s.meState && window.PN.s.meState.beer_count, open: window.PN.beerUndo.open() }));
      ok("undo: the beer is counted (7) and the undo window is open", b4.night === 7 && b4.open === true, b4);
      await page.click("#btn-beer");   // a real pointer tap on "Ångra"
      await wait(page, 900);
      const a = await page.evaluate(() => {
        const b = document.getElementById("btn-beer"), vis = (e) => e.getBoundingClientRect().height > 0;
        return { night: JSON.parse(localStorage.getItem("olnu.night")).count, me: window.PN.s.meState && window.PN.s.meState.beer_count, label: document.getElementById("beer-label").textContent, cls: b.className, dis: b.disabled,
          aria: b.getAttribute("aria-label"), toasts: [...document.querySelectorAll("#toasts .toast")].filter(vis).map((x) => x.textContent.trim()), rail: (document.querySelector("#pn-mine .pm-n") || {}).textContent, open: window.PN.beerUndo.open(), st: window.PN.beerUndo.state() };
      });
      ok("undo: a tap on 'Ångra' sends undo_beer once", n(calls, "undo_beer") === 1, calls.map((c) => c[0]));
      ok("undo: the count goes back (7 → 6: the night count and the 🍺 button)", a.night === 6 && a.rail === "6", a);
      ok("undo: the button is ready again (ÖL!, enabled, no wait, no Ångra)", a.label === "ÖL!" && !a.dis && !/cooldown|undo/.test(a.cls) && a.st === null && a.open === false, a);
      ok("undo: ONE calm toast 'Ölen togs bort.'", a.toasts.length === 1 && a.toasts[0] === "Ölen togs bort.", a.toasts);
      ok("undo: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- A2 · the double-tap guard ----------
    if (PARTS.includes("guard")) {
      ({ ctx, page, errs, calls } = await open(browser));
      // people tap twice (and more) fast: a tap every 100 ms from the ÖL! tap until "Ångra" has been on screen for 0.35 s
      // (all inside the guard time: 1.0 s after the ÖL! tap, and the first 0.5 s of the state)
      const g = await page.evaluate(() => new Promise((res) => {
        const b = document.getElementById("btn-beer"), t0 = performance.now(), seen = []; let onAt = 0;
        b.click();
        const iv = setInterval(() => { const t = performance.now() - t0, on = b.classList.contains("undo");
          if (on && !onAt) onAt = t;
          if ((onAt && t - onAt > 350) || t > 6000) { clearInterval(iv); setTimeout(() => res({ seen, onAt: Math.round(onAt), undo: b.classList.contains("undo"), label: document.getElementById("beer-label").textContent }), 250); return; }
          seen.push([Math.round(t), on, b.disabled]); b.click(); }, 100);
      }));
      await wait(page, 500);
      ok("guard: taps in the first 1.0 s after the ÖL! tap do nothing (1 beer, no undo)", n(calls, "post_beer_v2") === 1 && n(calls, "undo_beer") === 0, { calls: calls.map((c) => c[0]), g });
      ok("guard: 'Ångra' was on screen for some of those taps and is still there", g.seen.some((s) => s[1] && !s[2]) && g.undo && g.label === "Ångra", g);
      await page.click("#btn-beer"); await wait(page, 600);
      ok("guard: a tap after the guard time does undo", n(calls, "undo_beer") === 1, calls.map((c) => c[0]));
      await ctx.close();
    }

    // ---------- A3 · store build: ONE plain fact toast, no burst, the same button, no 2nd undo control ----------
    if (PARTS.includes("store")) {
      ({ ctx, page, errs, calls } = await open(browser, { store: true }));
      ok("store flag on", await page.evaluate(() => window.OLNU_STORE === true));
      const rows = await watch(page, 3000, true);
      const r = at(rows, 1500);
      ok("store: ONE toast, the plain fact 'Öl nr 7 ikväll', all the time", r.toasts.length === 1 && r.toasts[0] === "Öl nr 7 ikväll" && rows.every((x) => x.toasts.length <= 1 && x.chip === 0), { r: r.toasts, max: Math.max(...rows.map((x) => x.toasts.length)) });
      ok("store: no burst", rows.every((x) => !x.burst), rows.filter((x) => x.burst).length);
      const s2 = await page.evaluate(() => ({ undo: document.getElementById("btn-beer").classList.contains("undo"), label: document.getElementById("beer-label").textContent, fab: document.querySelectorAll(".undo-fab").length,
        act: document.querySelectorAll("#toasts .toast button").length, mine: !document.getElementById("pn-mine").hidden }));
      ok("store: the button is 'Ångra' too, and there is no second undo control (no floating button, no toast button)", s2.undo && s2.label === "Ångra" && s2.fab === 0 && s2.act === 0 && rows.every((x) => x.annat && x.fab === 0), s2);
      ok("store: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- A1 · the toasts that carry information stay ----------
    if (PARTS.includes("keep")) {
      // no signal → the outbox toast
      ({ ctx, page, errs, calls, srv } = await open(browser));
      srv.net = true;
      let rows = await watch(page, 1800, true);
      let last = rows[rows.length - 1];
      ok("no signal: the outbox toast 'Skickas när du har täckning' still shows", last.toasts.length === 1 && /Skickas när du har täckning/.test(last.toasts[0]), last.toasts);
      ok("no signal: no 'Ångra' state (nothing to undo yet), the early number went back", !last.undo && !last.burst && (await page.evaluate(() => (document.querySelector("#pn-mine .pm-n") || {}).textContent)) === "6", last);
      await ctx.close();
      // offline at the tap
      ({ ctx, page, errs, calls } = await open(browser));
      await ctx.setOffline(true); await wait(page, 300);
      rows = await watch(page, 1500, true); last = rows[rows.length - 1];
      ok("offline tap: the outbox toast shows, no beer RPC", last.toasts.length === 1 && /Skickas när du har täckning/.test(last.toasts[0]) && n(calls, "post_beer_v2") === 0, { t: last.toasts, calls: calls.length });
      await ctx.setOffline(false);
      await ctx.close();
      // refused by the server (its 10-minute rule)
      ({ ctx, page, errs, calls, srv } = await open(browser));
      srv.refuse = 300;
      rows = await watch(page, 1600, true); last = rows[rows.length - 1];
      ok("refused: ONE toast with the time, without 'Nästa öl'", last.toasts.length === 1 && /^Paus\. 5:00 kvar\.$/.test(last.toasts[0]), last.toasts);
      ok("refused: no 'Ångra', the button shows the timer, the early burst is gone", !last.undo && last.cd && /^\d:\d\d$/.test(last.label) && !last.burst, last);
      ok("keep: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- A4 · the wait: only m:ss in the glass ----------
    if (PARTS.includes("wait")) {
      ({ ctx, page, errs } = await open(browser));
      for (const [left, re, name] of [[598000, /^9:5\d$/, "9:59 (empty glass)"], [30000, /^0:[23]\d$/, "0:30 (full glass)"]]) {
        await cooldownAt(page, left); await wait(page, 200);
        const t = await timer(page);
        ok("wait " + name + ": only the time in the button (no 'Nästa öl', no sub line)", re.test(t.label) && t.text === t.label && !/Nästa|Next/i.test(t.text + t.aria) && !t.subShown && t.cd && t.dis, t);
        ok("wait " + name + ": no box around the time (no background, no border)", t.box === false, t);
        ok("wait " + name + ": in the middle of the glass, display font, ≥ 28 px, same width for every figure", t.mid && t.inside && /Black Ops One/.test(t.font) && t.size >= 28 && t.cells.length === 3 && new Set(t.cells).size === 1, t);
        ok("wait " + name + ": cream figures with a dark outline ≥ 4.5:1 (reads on the empty and on the filled glass)", t.strokeW >= 4 && /stroke/.test(t.paint) && contrast(t.color, t.stroke) >= 4.5, { c: contrast(t.color, t.stroke), w: t.strokeW, paint: t.paint, fill: t.fill });
        ok("wait " + name + ": aria-label 'Paus, m:ss kvar'", /^Paus, \d:\d\d kvar$/.test(t.aria), t.aria);
      }
      const f = await page.evaluate(() => document.getElementById("btn-beer").style.getPropertyValue("--fill"));
      ok("wait: the glass still fills (near full at 0:30)", parseFloat(f) > 80, f);
      await cooldownAt(page, 600000 + 5000); await wait(page, 200);
      const long = await timer(page);
      ok("wait 10:0x: five figures still fit inside the button", /^10:0\d$/.test(long.label) && long.inside, long);
      // the wait ends → ÖL! is back with the ready effect
      await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night")); m.lastTap = Date.now() - window.U.COOLDOWN_MS - 1000; localStorage.setItem("olnu.night", JSON.stringify(m)); window.PN.tickCooldown(); });
      const back = await page.evaluate(() => { const b = document.getElementById("btn-beer"); return { label: document.getElementById("beer-label").textContent, cd: b.classList.contains("cooldown"), dis: b.disabled, pop: b.classList.contains("ready-pop"), spill: b.parentNode.classList.contains("spill"), aria: b.getAttribute("aria-label") }; });
      ok("wait over: ÖL! is back, enabled, with the ready effect", back.label === "ÖL!" && !back.cd && !back.dis && back.pop && back.spill, back);
      ok("wait: no page errors", errs.length === 0, errs);
      // the words are gone from the texts, Swedish and English (the app runs in Swedish only for now: i18n.js "SAFE: always sv",
      // so the English twins are checked in the source)
      const src = await page.evaluate(async () => { const g = async (u) => (await fetch(u)).text(); const i = await g("./js/i18n.js"), a = await g("./js/app-beer.js");
        return { next: /Nästa öl om|Next beer in/.test(i + a), nextIn: /nextIn/.test(i + a), sv: window.PN.t("cooldownToast", "3:00"), en: /"Pause\. " \+ m \+ " left\."/.test(i), ariaEn: /"Pause, " \+ mmss \+ " left"/.test(a), undoEn: /tl\("Ångra", "Undo"\)/.test(a) && /"Undo the last beer"/.test(a) }; });
      ok("texts: no 'Nästa öl om' / 'Next beer in' in i18n.js and app-beer.js; the refused toast is 'Paus. 3:00 kvar.'", !src.next && !src.nextIn && src.sv === "Paus. 3:00 kvar.", src);
      ok("texts: the English twins are there (Pause. m:ss left. / Pause, m:ss left / Undo / Undo the last beer)", src.en && src.ariaEn && src.undoEn, src);
      await ctx.close();
    }

    // ---------- A5 · the burst ----------
    if (PARTS.includes("burst")) {
      ({ ctx, page, errs } = await open(browser));
      const b = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now(); window.MYCOUNT.set(3); window.MYCOUNT.onBeerAccepted({}, { total: 4 }); window.MYCOUNT.set(4);
        const h = document.querySelector(".pm-burst"), back = h && h.querySelector(".pm-back"), nw = h && h.querySelector(".pm-new"), out = { host: !!h };
        if (!h) return res(out);
        const bs = getComputedStyle(back), br = back.getBoundingClientRect(), kf = nw.getAnimations()[0].effect.getKeyframes();
        const ba = back.getAnimations()[0], bk = ba ? ba.effect.getKeyframes() : [];
        out.back = { bg: bs.backgroundImage.slice(0, 40), radius: bs.borderRadius, border: parseFloat(bs.borderTopWidth), pe: getComputedStyle(h).pointerEvents,
          fade: !!ba && bk.length === 2 && bk[0].opacity === "0" && bk[1].opacity === "1" && ba.effect.getTiming().fill === "both" && ba.effect.getTiming().duration <= 250 };   // fades in and stays (a slow machine starts animations late: the end state is checked, not a moment)
        out.slam = { dur: nw.getAnimations()[0].effect.getTiming().duration, filter: kf.some((k) => k.filter && k.filter !== "none"), from: kf[0].transform };
        setTimeout(() => {   // 500 ms: the number and the label are in
          const num = h.querySelector(".pm-num").getBoundingClientRect(), sub = h.querySelector(".pm-sub").getBoundingClientRect(), q = back.getBoundingClientRect();
          out.covers = q.left <= num.left && q.right >= num.right && q.top <= num.top && q.bottom >= sub.bottom && q.left <= sub.left && q.right >= sub.right;
          out.backOp = getComputedStyle(back).opacity; out.an = back.getAnimations().map((x) => x.animationName + ":" + x.playState + ":" + Math.round(x.currentTime || 0));
        }, 500);
        const iv = setInterval(() => { if (!document.querySelector(".pm-burst")) { clearInterval(iv); out.gone = Math.round(performance.now() - t0);
          const m = document.getElementById("pn-mine"); out.bump = m.classList.contains("pm-bump"); out.n = m.querySelector(".pm-n").textContent;
          const w = setInterval(() => { if (!m.classList.contains("pm-bump")) { clearInterval(w); out.done = Math.round(performance.now() - t0); res(out); } }, 20); } }, 20);
        setTimeout(() => res(out), 4000);
      }));
      ok("A5 burst: a soft dark round backdrop (radial gradient, no box edge) behind the number and 'ikväll'", b.host && /radial-gradient/.test(b.back.bg) && b.back.radius === "50%" && b.back.border === 0 && b.covers && b.back.fade && b.back.pe === "none", b);
      // uifix4 D2 (19 Nov): shorter again: the number is in the rail after about 1.0 s (hold 640 + fly 300), all over after about 1.3 s
      ok("A5 burst: the number is in the rail after about 1.0 s and all is over in about 1.3 s (was 1.2 / 1.6 s, first 2.2 s)", b.gone >= 700 && b.gone <= 1300 && b.done >= 900 && b.done <= 1700 && b.n === "4", { gone: b.gone, done: b.done });
      ok("A5 burst: the slam has no blur filter and starts at 1.6x in 300 ms (uifix4 D2; was 2.2x / 450 ms, first 3.2x)", b.slam.filter === false && /scale\(1\.6\)/.test(b.slam.from) && b.slam.dur === 300, b.slam);
      await wait(page, 300);
      const late = await page.evaluate(() => {
        const c = () => document.querySelectorAll(".pm-burst").length, clean = () => document.querySelectorAll(".pm-burst").forEach((x) => x.remove());
        window.MYCOUNT.set(4); window.MYCOUNT.early(5); const atTap = c();                                  // 4 → 5: the card is expected, no burst at the tap
        window.MYCOUNT.onBeerAccepted({}, { total: 5, big: true }); const card = c();                         // the card came: still no burst
        window.MYCOUNT.settle(); clean();
        window.MYCOUNT.set(4); window.MYCOUNT.early(5); window.MYCOUNT.onBeerAccepted({}, { total: 6, big: false }); const noCard = c();   // no card came (the counts did not agree)
        const num = (document.querySelector(".pm-burst .pm-new") || {}).textContent; window.MYCOUNT.settle(); clean();
        window.MYCOUNT.set(2); window.MYCOUNT.early(3); const e = c(); window.MYCOUNT.onBeerAccepted({}, { total: 3, big: false }); const once = c(); clean();
        return { atTap, card, noCard, num, e, once };
      });
      ok("A5 a 5/10/15 beer: no burst at the tap, none when the card came", late.atTap === 0 && late.card === 0, late);
      ok("A5 a beer with no burst at the tap and no card gets its burst with the answer", late.noCard === 1 && late.num === "6", late);
      ok("A5 a normal beer still gets ONE burst (at the tap)", late.e === 1 && late.once === 1, late);
      // the level emoji (3, 7, …) does not sit on the number
      const pop = await page.evaluate(() => {
        window.MYCOUNT.set(6); window.MYCOUNT._burst(7, 6); window.FX.levelPop({ emoji: "x", intensity: 2 });
        const e = document.querySelector(".fx-pop .fp-emo"), nm = document.querySelector(".pm-burst .pm-num");
        e.getAnimations().forEach((a) => a.finish()); nm.querySelector(".pm-new").getAnimations().forEach((a) => a.finish());
        const top = parseFloat(getComputedStyle(e).top), q = nm.getBoundingClientRect();
        return { top, numTop: q.top, mid: innerHeight * 0.42 };
      });
      ok("A5 the level emoji sits above the number while the burst shows", pop.top < pop.mid - 80, pop);
      ok("burst: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- B · "Var dricker du?" ----------
    if (PARTS.includes("where")) {
      for (const [w, h] of [[360, 640], [390, 844]]) {
        ({ ctx, page, errs, calls } = await open(browser, { w, h, checkin: false, geo: PARMA }));
        await page.evaluate(() => document.getElementById("btn-beer").click());
        await page.waitForFunction(() => { const s = document.getElementById("sheet"); return s && !s.hidden && document.querySelector("#sheet-body .btn"); }, null, { timeout: 8000 }).catch(() => console.log("no where sheet"));
        await wait(page, 900);
        const s = await page.evaluate(() => {
          const body = document.getElementById("sheet-body"), sheet = document.getElementById("sheet"), home = body.querySelector(".wh-home"), q = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
          if (!home) return { home: false, btns: body.querySelectorAll(".btn").length };
          const hr = q(home), cs = getComputedStyle(home), top = document.elementFromPoint(hr.l + hr.w / 2, hr.t + hr.h / 2), rows = [...body.querySelectorAll(".wh-list .wh-row")], sr = q(sheet);
          return { home: true, hr, vh: innerHeight, vw: innerWidth, scrollTop: body.scrollTop, scrolls: body.scrollHeight > body.clientHeight + 4, hit: top === home || home.contains(top), text: home.textContent.trim(),
            radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius], sheetB: sr.b, icon: !!home.querySelector("svg"),
            amber: [...body.querySelectorAll(".btn-amber")].map((x) => x.textContent.trim()), rows: rows.length, rowH: Math.min(...rows.map((x) => q(x).h)),
            dist: rows.map((x) => (x.querySelector(".wh-dist") || {}).textContent), names: rows.map((x) => (x.querySelector(".wh-name") || {}).textContent),
            distRight: rows.every((x) => { const d = q(x.querySelector(".wh-dist")), nm = q(x.querySelector(".wh-name")), r = q(x); return d.l >= nm.r - 1 && r.r - d.r <= 20 && d.r <= r.r; }),
            lists: [...body.querySelectorAll(".wh-list")].map((l) => getComputedStyle(l).borderTopLeftRadius), heads: [...body.querySelectorAll(".wh h3")].map((x) => x.textContent), more: (body.querySelector(".where-more") || {}).textContent,
            emoji: /[\u2600-\u27bf\ud83c-\ud83e]/.test(body.textContent), wide: body.scrollWidth > body.clientWidth + 1, places: body.querySelectorAll(".wh-row.where-place").length };
        });
        const T = "where @" + w + "x" + h + ": ";
        ok(T + "'Hemma eller annan plats' is in view without scrolling (on top at its place)", s.home && s.scrollTop === 0 && s.hr.t >= 0 && s.hr.b <= s.vh && s.hit && s.text === "Hemma eller annan plats", s);
        ok(T + "the list is longer than the sheet (it scrolls), the row still shows", s.home && s.scrolls, { scrolls: s.scrolls });
        ok(T + "the row is a full-width rounded row: all 4 corners 16 px (the bottom corners too), ≥ 56 px high, safe-area room under it", s.home && s.radius.every((r) => r === "16px") && s.hr.h >= 56 && s.hr.w >= s.vw - 34 && s.sheetB - s.hr.b >= 15.5, { radius: s.radius, hr: s.hr, sheetB: s.sheetB });
        ok(T + "the nearest bar is the ONE amber button", s.home && s.amber.length === 1 && /^La Parma Pub & Restaurang · här$/.test(s.amber[0]), s.amber);
        ok(T + "other bars and places are rows in rounded lists, ≥ 56 px, with the distance at the right", s.home && s.rows >= 4 && s.rowH >= 56 && s.distRight && s.dist.every((d) => /^(\d+ m|här)$/.test(d || "")) && s.lists.length === 2 && s.lists.every((r) => r === "16px") && s.places >= 1, { rows: s.rows, rowH: s.rowH, dist: s.dist, lists: s.lists, distRight: s.distRight });
        ok(T + "headings 'Krogar nära' + 'Restauranger och caféer', 'Fler ställen nära' stays, no emoji, no sideways scroll", s.home && s.heads.join("|") === "Krogar nära|Restauranger och caféer" && /Fler ställen nära/.test(s.more || "") && !s.emoji && !s.wide, { heads: s.heads, more: s.more, emoji: s.emoji });
        // I-118 (owner: "it's all squashed" on 360x640): rows keep their height, no cut text, the sheet fits, enough list in view.
        const sq = await page.evaluate(() => {
          const body = document.getElementById("sheet-body"), sheet = document.getElementById("sheet"), sr = sheet.getBoundingClientRect(), br = body.getBoundingClientRect();
          const hs = [...body.querySelectorAll(".wh-row,.wh-main,.wh-home,.where-more")].map((e) => e.getBoundingClientRect().height);
          const cut = [...body.querySelectorAll(".wh-name,.wh-main span,.wh-home span")].filter((e) => { const cs = getComputedStyle(e); return e.classList.contains("wh-name") ? e.scrollHeight > e.clientHeight + 1 && cs.webkitLineClamp === "none" : e.scrollWidth > e.clientWidth + 1; }).length;
          const nameClip = [...body.querySelectorAll(".wh-name")].filter((e) => e.scrollHeight > e.clientHeight + 1).length;
          const homeR = body.querySelector(".wh-home").getBoundingClientRect(), vis = [...body.querySelectorAll(".wh-row")].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= br.top && r.bottom <= homeR.top; }).length;
          return { minH: Math.min(...hs), cut, nameClip, sheetT: sr.top, sheetB: sr.bottom, vh: innerHeight, bodyH: br.height, vis };
        });
        ok(T + "no row is squashed: every row, the amber button and 'Hemma' are >= 44 px high", sq.minH >= 44, sq);
        ok(T + "no text is cut (names fit in 2 lines, nothing overflows sideways)", sq.cut === 0 && sq.nameClip === 0, sq);
        ok(T + "the sheet fits in the viewport (top >= 0, bottom <= viewport)", sq.sheetT >= 0 && sq.sheetB <= sq.vh + 0.5, sq);
        if (w === 360) ok(T + "the list has room: at least 4 full rows in view above the pinned row (was 3: squashed)", sq.vis >= 4, sq);
        if (w === 360) {
          // scrolled to the end: still there, same place
          const e = await page.evaluate(() => { const body = document.getElementById("sheet-body"); body.scrollTop = body.scrollHeight; const r = body.querySelector(".wh-home").getBoundingClientRect(); return { t: r.top, b: r.bottom, vh: innerHeight }; });
          ok(T + "at the end of the list the row is at the same place", Math.abs(e.b - s.hr.b) < 2, e);
          // pick "Hemma": the beer goes to where I am (not a bar)
          await page.evaluate(() => document.querySelector("#sheet-body .wh-home").click());
          await wait(page, 1200);
          const p = calls.find((c) => c[0] === "post_beer_v2");
          ok(T + "pick 'Hemma…' → the beer is posted at my own spot, the sheet closes", !!p && Math.abs(p[1].p_lat - 60.15124) < 1e-4 && (await page.evaluate(() => document.getElementById("sheet").hidden)), p);
        } else {
          // pick a row: the beer counts at that bar
          await page.evaluate(() => [...document.querySelectorAll("#sheet-body .wh-row")].find((x) => /Pitchers/.test(x.textContent)).click());
          await wait(page, 1200);
          const p = calls.find((c) => c[0] === "post_beer_v2");
          ok(T + "pick a row (Pitchers) → the beer is posted at that bar, exact", !!p && Math.abs(p[1].p_lat - 60.14997) < 5e-4 && Math.abs(p[1].p_lat - 60.15124) > 5e-4 && p[1].p_precise === true, p);
        }
        ok(T + "no page errors", errs.length === 0, errs);
        await ctx.close();
      }
      // cancel = no beer, and the cancel toast stays
      ({ ctx, page, errs, calls } = await open(browser, { checkin: false, geo: PARMA }));
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await page.waitForFunction(() => document.querySelector("#sheet-body .wh-home"), null, { timeout: 8000 }).catch(() => {});
      await wait(page, 600);
      await page.evaluate(() => document.getElementById("sheet-close").click());
      await wait(page, 900);
      const c = await page.evaluate(() => ({ toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent.trim()), cd: document.getElementById("btn-beer").classList.contains("cooldown"), burst: document.querySelectorAll(".pm-burst").length }));
      ok("where: ✕ = no beer (no RPC, no wait, no burst) and ONE toast says so", n(calls, "post_beer_v2") === 0 && !c.cd && c.burst === 0 && c.toasts.length === 1, { c, calls: calls.length });
      await ctx.close();
      // the 150 m rule: nothing near → no question
      ({ ctx, page, errs, calls } = await open(browser, { checkin: false, geo: { latitude: 60.1702, longitude: 15.2405 } }));
      await page.evaluate(() => document.getElementById("btn-beer").click());
      await wait(page, 2500);
      ok("where: no bar or place within 150 m → no sheet, the beer is posted", n(calls, "post_beer_v2") === 1 && (await page.evaluate(() => document.getElementById("sheet").hidden)), calls.map((x) => x[0]));
      await ctx.close();
    }

    // ---------- N · Min kväll: "Ångra" on the newest beer row (the server's 2 minutes) ----------
    if (PARTS.includes("night")) {
      const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
      const log = (kinds) => ({ v: 1, night: iso(0), evening: iso(0).slice(0, 10), tonight: true, source: "log", nights: [],
        stats: { drinks: kinds.length, first_at: iso(90), last_at: iso(1), per_hour: 1.5, bars: 1, kinds: { beer: kinds.length }, hours: [] },
        items: kinds.map((k, i) => ({ at: iso(90 - i * (89 / Math.max(1, kinds.length - 1))), kind: k, bar: "Pitchers", ghost: false })) });
      let items = ["beer", "beer", "beer"];
      ({ ctx, page, errs, calls } = await open(browser, { route: (page) => page.route(/rest\/v1\/rpc\/my_night_log\b/, (r) => J(r, log(items))) }));
      const rowState = () => page.evaluate(() => { const rows = [...document.querySelectorAll("#sheet-body .nl-it")], u = [...document.querySelectorAll("#sheet-body .nl-undo")]; const r = u[0] && u[0].getBoundingClientRect();
        return { rows: rows.length, undo: u.length, inLast: !!(u[0] && rows[rows.length - 1].contains(u[0])), h: r ? r.height : 0, w: r ? r.width : 0, text: u[0] ? u[0].textContent : "", aria: u[0] ? u[0].getAttribute("aria-label") : "", right: r ? r.right <= innerWidth : false }; });
      const openLog = async (night) => { await page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden) document.getElementById("sheet-close").click(); }); await wait(page, 500);
        await page.evaluate((night) => window.NIGHTLOG.open(night), night);   // a new night key = a fresh read (the log is cached 30 s)
        await page.waitForFunction(() => document.querySelectorAll("#sheet-body .nl-it").length >= 2, null, { timeout: 8000 }).catch(() => {}); await wait(page, 300); };
      // window closed: no button
      await page.evaluate(() => { window.PN.s.meState = Object.assign(window.PN.s.meState || {}, { undo_until: null }); });
      await openLog(null);
      let s = await rowState();
      ok("Min kväll: no 'Ångra' when the undo window is closed", s.rows === 3 && s.undo === 0, s);
      // window open, but the newest drink is not a beer (undo_beer takes back beers only)
      await page.evaluate(() => { window.PN.s.meState.undo_until = new Date(Date.now() + 100000).toISOString(); });
      items = ["beer", "beer", "vin"];
      await openLog("n2");
      s = await rowState();
      ok("Min kväll: no 'Ångra' when the newest drink is not a beer", s.rows === 3 && s.undo === 0, s);
      // window open, the newest drink is my beer
      items = ["beer", "beer", "beer"];
      await openLog("n3");
      s = await rowState();
      ok("Min kväll: 'Ångra' on the newest beer row only, a 44 px target with an aria-label", s.undo === 1 && s.inLast && s.h >= 44 && s.w >= 44 && s.text === "Ångra" && s.aria === "Ångra senaste ölen" && s.right, s);
      items = ["beer", "beer"];
      await page.evaluate(() => document.querySelector("#sheet-body .nl-undo").click());
      await wait(page, 1500);
      s = await rowState();
      const tt = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent.trim()));
      ok("Min kväll: the tap sends undo_beer, the log is read again (2 rows, no button), one calm toast", n(calls, "undo_beer") === 1 && s.rows === 2 && s.undo === 0 && tt.length === 1 && tt[0] === "Ölen togs bort.", { s, tt, calls: calls.map((c) => c[0]) });
      ok("Min kväll: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL crash", e.stack || e.message); }
  await browser.close();
  console.log("dbeer: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
