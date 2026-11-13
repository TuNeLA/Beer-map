// lane polish3 (owner 13 Nov 16:28). Usage: node polish3-pw.js <port> [part …]   parts: film toast groups places (default: all)
// film   (I-65): no emoji row under the photos; chips only with reactions; tap = big view with Spara + "Reagera";
//                press and hold 450 ms = the picker (8 round buttons, emoji centred); a pick = film_react, chip updates;
//                short tap = no picker; keyboard Enter = big view; Escape closes the picker only.
// toast  (I-66): the exit copy of a toast has the live toast's border / shadow / size (no amber border flash).
// groups (I-68): the Grupper button opens the Grupper tab after Vänner or Inkorg was used; openFriendsTab / INBOX.open keep theirs.
// places (I-69): "Mina förslag" in the add-place sheet (my_place_suggestions, no params, 3 states);
//                stats.html: "➕ Nya ställen (N)" at the top of the page while N > 0, none at 0.
// Every check marked [new] FAILS on e9481e4 and PASSES with the polish3 patches. Supabase is mocked (no server writes).
// Shots: OUT/polish3-shots/<tag>-<name>-390.png (P3_TAG=new|old).
const fs = require("fs");
const { chromium } = require("playwright");
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const OUT = require("./env.js").OUT, SHOTS = OUT + "polish3-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const TAG = process.env.P3_TAG || "new";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555", NIGHT = "2026-11-08T04:00:00.000Z";
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 500))); c ? pass++ : fail++; };
const shot = (page, name, o) => page.screenshot(Object.assign({ path: `${SHOTS}${TAG}-${name}-390.png` }, o || {})).catch(() => {});
const svg = (i) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${i * 70},55%,40%)"/><circle cx="200" cy="150" r="60" fill="#ffc24d"/></svg>`).toString("base64");

async function filmRoutes(page, log) {
  await page.route(/rest\/v1\/rpc\/(film_poll|film_state|film_stock|film_roll|film_photo|film_save_list|film_react)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, b]);
    if (fn === "film_poll") return J(r, { v: 2, now: new Date().toISOString(), night: NIGHT, groups: [], rolls: [] });
    if (fn === "film_roll") return J(r, { night: NIGHT, evening: "2026-11-07", develop_at: NIGHT, developed: true, n: 3, gone: 0, expires_at: "2026-11-15T09:00:00Z",
      photos: [0, 1, 2].map((i) => ({ id: 900 + i, name: ["Lisa", "Oskar", "Anton"][i], is_me: i === 2, at: "2026-11-07T21:0" + i + ":00Z", w: 4, h: 3,
        reacts: i === 0 ? [{ e: "🔥", n: 2 }, { e: "😂", n: 1 }] : [], n: i === 0 ? 3 : 0, my: i === 0 ? "🔥" : null })) });
    if (fn === "film_photo") return J(r, { id: b.p_photo_id, mime: "image/svg+xml", w: 400, h: 300, b64: svg(b.p_photo_id - 900) });
    if (fn === "film_save_list") return J(r, { night: NIGHT, developed: true, evening: "2026-11-07", group_name: "Ludvika Lager", photos: [] });
    if (fn === "film_react") return J(r, { id: b.p_photo_id, reacts: [{ e: b.p_emoji, n: 1 }], my: b.p_emoji, n: 1 });
    return J(r, {});
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox"] });
  const errs = [];
  try {
    /* ================= I-65 Engångskameran ================= */
    if (want("film")) {
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push("film: " + e.message));
      await filmRoutes(page, log); await boot(page);
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      await page.evaluate((G) => window.FILM.openRoll({ id: G, name: "Ludvika Lager" }, "2026-11-08T04:00:00.000Z"), G);
      await page.waitForFunction(() => document.querySelectorAll("#sheet-body .fm-shot img").length >= 3, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 500);
      const a = await page.evaluate(() => {
        const b = document.getElementById("sheet-body"), fr = [...b.querySelectorAll(".fm-frame")];
        const chips = (f) => { const c = f.querySelector(".fm-rchips"); return c && !c.hidden && c.getClientRects().length ? [...c.querySelectorAll(".fm-rc")].map((x) => x.textContent) : []; };
        return { row: b.querySelectorAll(".fm-reacts, .fm-r").length, frames: fr.length, c0: fr[0] ? chips(fr[0]) : null, c1: fr[1] ? chips(fr[1]) : null,
          on0: !!(fr[0] && fr[0].querySelector(".fm-rc.on")), role: fr[0] && fr[0].querySelector(".fm-shot").getAttribute("role"), tab: fr[0] && fr[0].querySelector(".fm-shot").tabIndex };
      });
      ok("[new] I-65 no emoji row under the photos (was 8 round buttons per photo)", a.frames === 3 && a.row === 0, a);
      ok("[new] I-65 photo with reactions: small chips '🔥2' '😂1' (mine marked); photo without: no chips", JSON.stringify(a.c0) === JSON.stringify(["🔥2", "😂1"]) && a.on0 && a.c1 && a.c1.length === 0, a);
      ok("[new] I-65 the photo is a keyboard button (role=button, tabindex 0)", a.role === "button" && a.tab === 0, a);
      await page.evaluate(() => document.querySelector("#sheet-body .fm-strip").scrollIntoView({ block: "start" })); await wait(page, 300);
      await shot(page, "film-album");
      // tap = big view with Spara + Reagera
      await page.evaluate(() => document.querySelectorAll("#sheet-body .fm-shot")[1].click()); await wait(page, 700);
      const v = await page.evaluate(() => { const o = document.querySelector(".fm-view"); return o && { save: !!o.querySelector(".ph-save"), react: (o.querySelector(".fm-v-react") || {}).textContent || null, pick: !!document.querySelector(".fm-rpick") }; });
      ok("tap a photo = the big view with 💾 Spara", v && v.save && !v.pick, v);
      ok("[new] I-65 big view has 'Reagera'", v && v.react === "Reagera", v);
      await shot(page, "film-view");
      await page.evaluate(() => document.querySelector(".fm-view .ph-x").click()); await wait(page, 300);
      // press and hold = picker (no big view after the finger lifts)
      const h = await page.evaluate(async () => {
        const fr = document.querySelectorAll("#sheet-body .fm-shot")[1], r = fr.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
        fr.dispatchEvent(new PointerEvent("pointerdown", o));
        await new Promise((ok) => setTimeout(ok, 250)); const early = !!document.querySelector(".fm-rpick");
        await new Promise((ok) => setTimeout(ok, 400)); const pick = document.querySelector(".fm-rpick");
        fr.dispatchEvent(new PointerEvent("pointerup", o)); fr.dispatchEvent(new MouseEvent("click", o));
        await new Promise((ok) => setTimeout(ok, 300));
        const btns = pick ? [...pick.querySelectorAll(".fm-rp")] : [];
        const geo = btns.map((b) => { const br = b.getBoundingClientRect(), e = b.querySelector(".fm-rp-e").getBoundingClientRect();
          return { w: Math.round(br.width), h: Math.round(br.height), dx: Math.abs((e.left + e.width / 2) - (br.left + br.width / 2)), dy: Math.abs((e.top + e.height / 2) - (br.top + br.height / 2)), rad: getComputedStyle(b).borderRadius }; });
        return { early, pick: !!pick, n: btns.length, emo: btns.map((b) => b.querySelector(".fm-rp-e").textContent).join(""), geo, view: !!document.querySelector(".fm-view"), sw: document.documentElement.scrollWidth };
      });
      ok("hold < 450 ms: no picker yet", !h.early, h);
      ok("[new] I-65 press and hold = picker with the 8 reactions", h.pick && h.n === 8 && h.emo === "🔥😂😍🍻💀👑🫡🥴", h);
      ok("[new] I-65 picker buttons are round 60×60, emoji centred (≤ 2 px)", h.geo.length === 8 && h.geo.every((g) => g.w === 60 && g.h === 60 && g.dx <= 2 && g.dy <= 2 && /50%|30px/.test(g.rad)), h.geo);
      ok("[new] I-65 the finger lifting after the hold does not open the big view; no side scroll", h.pick && !h.view && h.sw <= 390, h);
      await shot(page, "film-picker");
      await page.evaluate(() => [...document.querySelectorAll(".fm-rpick .fm-rp")].find((b) => b.textContent.indexOf("😂") === 0).click()); await wait(page, 700);
      const rc = log.filter((x) => x[0] === "film_react").pop();
      const after = await page.evaluate(() => { const f = document.querySelectorAll("#sheet-body .fm-frame")[1], c = f.querySelector(".fm-rchips"); return { pick: !!document.querySelector(".fm-rpick"), vis: !c.hidden, t: [...c.querySelectorAll(".fm-rc")].map((x) => x.textContent), on: !!c.querySelector(".fm-rc.on") }; });
      ok("[new] I-65 a pick = film_react {901, 😂}; picker closes; the photo gets the chip '😂1' (mine)", rc && rc[1].p_photo_id === 901 && rc[1].p_emoji === "😂" && !after.pick && after.vis && after.t.join() === "😂1" && after.on, [rc, after]);
      // short tap = no picker, big view
      const s = await page.evaluate(async () => {
        const fr = document.querySelectorAll("#sheet-body .fm-shot")[2], r = fr.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30, pointerId: 8, pointerType: "touch", isPrimary: true, button: 0 };
        fr.dispatchEvent(new PointerEvent("pointerdown", o)); await new Promise((ok) => setTimeout(ok, 120));
        fr.dispatchEvent(new PointerEvent("pointerup", o)); fr.dispatchEvent(new MouseEvent("click", o));
        await new Promise((ok) => setTimeout(ok, 700));
        return { pick: !!document.querySelector(".fm-rpick"), view: !!document.querySelector(".fm-view") };
      });
      ok("short tap = the big view, no picker", s.view && !s.pick, s);
      await page.evaluate(() => document.querySelector(".fm-view .ph-x").click()); await wait(page, 300);
      // keyboard: Enter on the photo = big view; Reagera = picker over the big view; Escape closes the picker only
      await page.focus("#sheet-body .fm-frame:nth-child(1) .fm-shot").catch(() => page.evaluate(() => document.querySelector("#sheet-body .fm-shot").focus()));
      await page.keyboard.press("Enter"); await wait(page, 700);
      const k1 = await page.evaluate(() => !!document.querySelector(".fm-view"));
      await page.evaluate(() => { const b = document.querySelector(".fm-view .fm-v-react"); if (b) b.click(); }); await wait(page, 400);
      const k2 = await page.evaluate(() => { const p = document.querySelector(".fm-rpick"), v = document.querySelector(".fm-view"); return { pick: !!p, on: p ? (p.querySelector(".fm-rp.on .fm-rp-e") || {}).textContent : null, above: !!(p && v && +getComputedStyle(p).zIndex > +getComputedStyle(v).zIndex), focus: document.activeElement && document.activeElement.classList.contains("fm-rp") }; });
      await page.keyboard.press("Escape"); await wait(page, 300);
      const k3 = await page.evaluate(() => ({ pick: !!document.querySelector(".fm-rpick"), view: !!document.querySelector(".fm-view") }));
      ok("[new] I-65 keyboard: Enter = big view; 'Reagera' = picker on top (my 🔥 marked, focus in it); Escape closes the picker only", k1 && k2.pick && k2.on === "🔥" && k2.above && k2.focus && !k3.pick && k3.view, [k1, k2, k3]);
      await ctx.close();
    }

    /* ================= I-66 toast exit ================= */
    if (want("toast")) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push("toast: " + e.message));
      await boot(page);
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove())); await wait(page, 600);
      const t = await page.evaluate(async () => {
        const el = window.PN.toast("🐈 Fredag den 13:e. Katten har koll på dig.", { ms: 0 });
        await new Promise((ok) => setTimeout(ok, 900));
        const pick = (e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return { bl: c.borderLeftColor, blw: c.borderLeftWidth, bt: c.borderTopColor, btw: c.borderTopWidth, sh: c.boxShadow, bg: c.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), ol: c.outlineStyle }; };
        const live = pick(el);
        el.remove();
        await new Promise((ok) => setTimeout(ok, 20));
        const g = document.querySelector("body > .toast.pn-toast-out");
        if (!g) return { live, ghost: null };
        const ghost = pick(g);
        // a frozen copy of the exit frame for the screenshot (the real copy is gone after 200 ms)
        const f = g.cloneNode(true); f.classList.add("p3-frozen"); f.style.animation = "none"; f.style.opacity = "1"; document.body.appendChild(f);
        return { live, ghost };
      });
      const amber = (c) => /rgb\(2(3[0-9]|4[0-9]|5[0-5]), 1([4-9][0-9]), ([0-9]|[1-3][0-9]|4[0-9])\)/.test(c || "");   // amber / orange
      ok("a toast exit copy exists (pnds.js toastOut)", !!t.ghost, t);
      ok("[new] I-66 the exit copy has the live border (colour + width) — no amber edge", t.ghost && t.ghost.bl === t.live.bl && t.ghost.blw === t.live.blw && t.ghost.bt === t.live.bt && !amber(t.ghost.bl) && !amber(t.ghost.bt), t);
      ok("[new] I-66 the exit copy has the live shadow (no amber inset line) and the same size", t.ghost && t.ghost.sh === t.live.sh && !/inset/.test(t.ghost.sh) && Math.abs(t.ghost.w - t.live.w) <= 1 && Math.abs(t.ghost.h - t.live.h) <= 2, t);
      await shot(page, "toast-exit-frame");
      await page.evaluate(() => document.querySelectorAll(".p3-frozen").forEach((x) => x.remove()));
      // an error toast keeps its red border while it leaves
      const e = await page.evaluate(async () => {
        const el = window.PN.toast("Dä gick int'.", { err: true, ms: 0 }); await new Promise((ok) => setTimeout(ok, 900));
        const lc = getComputedStyle(el).borderTopColor; el.remove(); await new Promise((ok) => setTimeout(ok, 20));
        const g = document.querySelector("body > .toast.pn-toast-out"); return { live: lc, ghost: g && getComputedStyle(g).borderTopColor, gl: g && getComputedStyle(g).borderLeftColor };
      });
      ok("[new] I-66 error toast: the exit copy keeps the red border on every side", e.ghost === e.live && e.gl === e.live, e);
      await ctx.close();
    }

    /* ================= I-68 Grupper button ================= */
    if (want("groups")) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push("groups: " + e.message));
      await boot(page);
      const tabNow = () => page.evaluate(() => { const b = document.querySelector("#sheet-body .inv-tabs [aria-selected=true]"); const vis = (id) => { const p = document.getElementById(id); return !!(p && !p.hidden); };
        return { t: b ? b.getAttribute("data-t") : null, g: vis("inv-pane-g"), f: vis("inv-pane-f"), i: vis("inv-pane-i"), title: document.getElementById("sheet-title").textContent }; });
      const close = () => page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }).then(() => wait(page, 500));
      const press = () => page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); document.getElementById("btn-groups").click(); }).then(() => page.waitForFunction(() => document.querySelector("#sheet-body .inv-tabs [aria-selected=true]"), null, { timeout: 15000 }).catch(() => {})).then(() => wait(page, 600));
      // the owner's case: Inkorg was the last tab
      await page.evaluate(() => { localStorage.setItem("olnu.gtab", "g"); localStorage.setItem("olnu.ibTab", "1"); });
      await press(); const a = await tabNow();
      ok("[new] I-68 Grupper button after Inkorg = the Grupper tab", a.t === "g" && a.g && !a.i, a);
      await shot(page, "groups-button");
      // Vänner used, closed, Grupper button again
      await page.evaluate(() => document.querySelector('#sheet-body .inv-tabs [data-t="f"]').click()); await wait(page, 500);
      const f0 = await tabNow(); await close(); await press(); const b = await tabNow();
      ok("[new] I-68 Grupper button after Vänner = the Grupper tab", f0.t === "f" && b.t === "g" && b.g && !b.f, [f0, b]);
      await close();
      await page.evaluate(() => window.INVITE.openFriendsTab()); await wait(page, 900); const c = await tabNow();
      ok("openFriendsTab (?friends=1, ⚙️ Vänner) still opens Vänner", c.t === "f" && c.f, c);
      await close();
      await page.evaluate(() => window.INBOX.open()); await wait(page, 900); const d = await tabNow();
      ok("INBOX.open() still opens Inkorg", d.t === "i" && d.i, d);
      await close(); await press(); const e = await tabNow();
      ok("[new] I-68 and the Grupper button after that = Grupper again", e.t === "g" && e.g, e);
      await ctx.close();
    }

    /* ================= I-69 place requests ================= */
    if (want("places")) {
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push("places: " + e.message));
      await page.route(/rest\/v1\/rpc\/(my_place_suggestions|user_places)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        log.push([fn, b]);
        if (fn === "user_places") return J(r, []);
        return J(r, [{ id: 3, name: "Bryggeriet", type: "pub", status: "pending", created_at: "2026-11-13T15:10:00Z", status_at: null, bar_id: "u-bryggeriet-3", lat: 60.15, lng: 15.18 },
          { id: 2, name: "Kaffestugan", type: "cafe", status: "ok", created_at: "2026-10-23T12:00:00Z", status_at: "2026-10-24T08:00:00Z", bar_id: "u-kaffestugan-2", lat: 57.7, lng: 11.97 },
          { id: 1, name: "Testbaren", type: "bar", status: "rejected", created_at: "2026-10-20T19:00:00Z", status_at: "2026-10-21T08:00:00Z", bar_id: "u-testbaren-1", lat: 60.1, lng: 15.1 }]);
      });
      await boot(page);
      await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); window.MAPMENU.addPlace(60.1502, 15.1871); }); await wait(page, 800);
      const a = await page.evaluate(() => { const b = document.querySelector("#sheet-body .pl-mine-b"); return { title: document.getElementById("sheet-title").textContent, btn: b ? b.textContent : null }; });
      ok("[new] I-69 the add-place sheet has 'Mina förslag'", /Lägg till ställe här/.test(a.title) && a.btn === "Mina förslag", a);
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .pl-mine-b"); if (b) b.click(); }); await wait(page, 900);
      const m = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, rows: [...document.querySelectorAll("#sheet-body .pl-mine-r")].map((r) => [r.querySelector("b").textContent, r.querySelector(".pl-st").textContent]), sw: document.documentElement.scrollWidth }));
      const call = log.filter((x) => x[0] === "my_place_suggestions").pop();
      ok("[new] I-69 Mina förslag: my_place_suggestions() with no params (own rows only on the server)", call && Object.keys(call[1]).length === 0, call);
      ok("[new] I-69 Mina förslag lists Väntar / Godkänd / Avvisad", m.title === "Mina förslag" && JSON.stringify(m.rows) === JSON.stringify([["Bryggeriet", "Väntar"], ["Kaffestugan", "Godkänd"], ["Testbaren", "Avvisad"]]) && m.sw <= 390, m);
      await shot(page, "places-mine");
      await ctx.close();
      // owner page
      for (const pend of [2, 0]) {
        const sc = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2, locale: "sv-SE", serviceWorkers: "block" });
        const sp = await sc.newPage(); sp.on("pageerror", (e) => errs.push("stats: " + e.message));
        await sp.route(/\/auth\/v1\//, (r) => J(r, {}));
        await sp.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
          const fn = r.request().url().match(/rpc\/(\w+)/)[1];
          if (fn === "owner_stats2" || fn === "owner_stats") return J(r, { generated_at: new Date().toISOString(), users: { total: 400 }, beers: {}, places: {}, social: {}, care: {}, tech: {} });
          if (fn === "owner_places") return J(r, { counts: pend ? { pending: pend, ok: 1, rejected: 1 } : { ok: 1, rejected: 1 },
            places: pend ? [{ id: 2, name: "Bryggeriet", type: "pub", lat: 57.7, lng: 11.97, status: "pending", created_at: "2026-10-23T12:00:00Z", bar_id: "u-bryggeriet-2", by_n: 1, near: [] },
              { id: 3, name: "Kaffestugan", type: "cafe", lat: 60.15, lng: 15.18, status: "pending", created_at: "2026-11-13T15:00:00Z", bar_id: "u-kaffestugan-3", by_n: 2, near: [] }] : [] });
          return J(r, { code: "PGRST202", message: "Could not find the function" }, 404);
        });
        await sp.addInitScript(() => { try { sessionStorage.setItem("olnu.ownerKey", "test-key"); } catch (e) {} });
        await sp.goto(BASE + "stats.html"); await wait(sp, 3000);
        const s = await sp.evaluate(() => { const b = document.getElementById("xPlBadge"), main = document.getElementById("main");
          return { vis: !!(b && !b.hidden && b.getClientRects().length), t: b ? b.textContent : null, top: !!(b && main.firstElementChild === b), y: b ? Math.round(b.getBoundingClientRect().top) : null, pl: !document.getElementById("pPl").hidden }; });
        if (pend) {
          ok("[new] I-69 stats.html: '➕ Nya ställen (2)' at the top of the owner page", s.vis && s.top && /^➕ Nya ställen \(2\)/.test(s.t) && s.pl, s);
          await shot(sp, "stats-badge");
          await sp.evaluate(() => document.getElementById("xPlBadge").click()); await wait(sp, 900);
          const y = await sp.evaluate(() => ({ top: Math.round(document.getElementById("pPl").getBoundingClientRect().top), sy: Math.round(scrollY), end: scrollY + innerHeight >= document.documentElement.scrollHeight - 2 }));
          ok("[new] I-69 tap the note = scroll to the ➕ Nya ställen panel (top, or the page end)", y.sy > 0 && ((y.top >= -4 && y.top < 200) || y.end), y);
        } else ok("stats.html: no note when nothing waits", !s.vis, s);
        await sc.close();
      }
    }
    /* ================= I-86 reactions keep the real emoji ================= */
    if (want("rx")) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }); page.on("pageerror", (e) => errs.push("rx: " + e.message));
      await boot(page);
      // the friend card row as e9481e4 writes it (emoji = the first text node of the button) inside a map popup: the iconizers must leave it alone
      const a = await page.evaluate(async () => {
        const box = document.createElement("div"); box.className = "leaflet-popup p3-rx"; box.style.cssText = "position:fixed;left:16px;top:300px;width:358px;z-index:5000;background:#123";
        box.innerHTML = '<div class="leaflet-popup-content"><div class="rx-wrap" data-rx="x"><div class="rx-row">' + ["🔥", "😂", "💀", "💪"].map((e) => '<button type="button" class="rx-btn" data-e="' + e + '">' + e + '<span class="rx-n"></span></button>').join("") +
          '</div><div class="rx-top">Toppreaktion: 🔥 ×3</div></div><ul class="cm-reacts"><li><button type="button" class="cm-react">🔥 2</button></li></ul><div class="cm-picker"><button type="button" class="cm-pick">🔥</button></div></div>';
        document.body.appendChild(box);
        if (window.PNDS && window.PNDS.iconize) window.PNDS.iconize(box);
        await new Promise((ok) => setTimeout(ok, 1500));
        const r = { svg: box.querySelectorAll(".rx-btn svg, .rx-btn .pi, .cm-react svg, .cm-pick svg").length, txt: [...box.querySelectorAll(".rx-btn")].map((b) => b.textContent).join(""), react: box.querySelector(".cm-react").textContent, pick: box.querySelector(".cm-pick").textContent };
        box.remove(); return r;
      });
      ok("[new] I-86 reaction buttons in a map card keep the real emoji (🔥 is not swapped for the flat PNI flame)", a.svg === 0 && a.txt === "🔥😂💀💪" && a.react === "🔥 2" && a.pick === "🔥", a);
      // the real friend card (social.js rxInner) on a friend's pin: emoji in its own span, centred, no icon
      await page.evaluate(() => window.__map.setView([60.1545, 15.1960], 17, { animate: false })); await wait(page, 2000);
      await page.evaluate(() => { const p = [...document.querySelectorAll(".pill")].find((x) => x.classList.contains("pf")); if (p) p.click(); }); await wait(page, 1500);
      const b = await page.evaluate(() => {
        const bs = [...document.querySelectorAll(".leaflet-popup .rx-btn, #sheet-body .rx-btn, .rx-btn")].filter((x) => x.getClientRects().length);
        return { n: bs.length, svg: bs.filter((x) => x.querySelector("svg")).length, e: bs.map((x) => x.getAttribute("data-e")).join(""), t: bs.map((x) => (x.querySelector(".rx-e") || x).textContent.replace(/\d/g, "")).join(""),
          geo: bs.map((x) => { const br = x.getBoundingClientRect(), s = x.querySelector(".rx-e"), n = x.querySelector(".rx-n"); if (!s) return { no: 1 }; const er = s.getBoundingClientRect();
            return { cnt: !!(n && n.textContent), dx: Math.round(Math.abs((er.left + er.width / 2) - (br.left + br.width / 2)) * 10) / 10, dy: Math.round(Math.abs((er.top + er.height / 2) - (br.top + br.height / 2)) * 10) / 10 }; }) };
      });
      if (b.n) {
        ok("[new] I-86 friend card: real emoji in every reaction button, no PNI icon", b.svg === 0 && b.t === b.e, b);
        ok("[new] I-86 friend card: an emoji without a count is centred in its button (≤ 2 px)", b.geo.every((g) => !g.no) && b.geo.filter((g) => !g.cnt).every((g) => g.dx <= 2 && g.dy <= 2), b.geo);
        await shot(page, "rx-friend-card");
      } else {   // the mock has no reaction row (social v7 off): the row as social.js rxInner now writes it, with the real CSS
        const c = await page.evaluate(async () => {
          const box = document.createElement("div"); box.className = "leaflet-popup p3-rx"; box.style.cssText = "position:fixed;left:16px;top:300px;width:300px;z-index:5000";
          box.innerHTML = '<div class="rx-wrap"><div class="rx-row">' + ["🔥", "😂", "💀", "💪"].map((e, i) => '<button type="button" class="rx-btn" data-e="' + e + '"><span class="rx-e" aria-hidden="true">' + e + '</span><span class="rx-n">' + (i === 1 ? 2 : "") + '</span></button>').join("") + "</div></div>";
          document.body.appendChild(box); await new Promise((ok) => setTimeout(ok, 800));
          const g = [...box.querySelectorAll(".rx-btn")].map((x) => { const br = x.getBoundingClientRect(), er = x.querySelector(".rx-e").getBoundingClientRect();
            return { cnt: !!x.querySelector(".rx-n").textContent, svg: !!x.querySelector("svg"), dx: Math.round(Math.abs((er.left + er.width / 2) - (br.left + br.width / 2)) * 10) / 10, dy: Math.round(Math.abs((er.top + er.height / 2) - (br.top + br.height / 2)) * 10) / 10 }; });
          box.remove(); return g;
        });
        ok("[new] I-86 friend card row (rxInner markup): no icon, an emoji without a count is centred (≤ 2 px)", c.every((g) => !g.svg) && c.filter((g) => !g.cnt).every((g) => g.dx <= 2 && g.dy <= 2), c);
      }
      await ctx.close();
    }
    ok("no page errors", errs.length === 0, errs);
  } catch (e) { console.log("ERROR", e.stack || e); fail++; }
  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
