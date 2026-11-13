// 📸 FILMSTART Playwright test (mocked server). Usage: node cam-pw.js <port>
// HUD chip "Gänget fotar ikväll" (closed Ikväll row), tap → camera, chooser for 2 groups, gone after the night,
// 🚑 keeps priority, group page tile on home, film_start push once, deep links ?film=<gid>&cam=1, 🔔 film kind row.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8877;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555", G2 = "22222222-2222-3333-4444-555555555555";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const shot = (page, n) => page.screenshot({ path: SP + "ui-testshots/cam-ds-" + n + ".png" }).then(() => console.log("shot " + SP + "cam-" + n + ".png"));
const nightEnd = (past) => { const d = new Date(); if (past) return new Date(Date.now() - 60e3).toISOString(); d.setDate(d.getDate() + (d.getHours() >= 5 ? 1 : 0)); d.setHours(5, 0, 0, 0); return d.toISOString(); };
const grp = (id, name, n, left, o = {}) => ({ group_id: id, group_name: name, group_n: n, left, mine: 10 - left, shooters: 2, first_name: "Lisa", first_me: false, first_at: new Date(Date.now() - (o.ago || 20) * 60e3).toISOString() });
const PREFS = { v: 1, off: [], quiet_from: null, quiet_to: null, cap: 0, cap_default: 15, cats: ["ute", "chat", "dm", "plan", "kaos", "bar", "kul", "vanner", "film"], tonight: 2 };
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
// calm pins: no friend at 10+ (else the 🚑 chip owns the one slot)
const CALM = [
  { id: 501, lat: 60.14997, lng: 15.18679, beer_count: 3, precise: true, created_at: iso(60), is_mine: true, friend_name: null, skal_count: 0, i_skaled: false, shot_count: 0 },
  { id: 502, lat: 60.15124, lng: 15.18797, beer_count: 2, precise: true, created_at: iso(30), is_mine: false, friend_name: "Lisa", skal_count: 0, i_skaled: false, shot_count: 0 }];

async function extra(page, log, o) {
  await page.route(/rest\/v1\/rpc\/(film_poll|film_state|my_push_prefs|set_push_prefs|live_beers)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, body]);
    if (fn === "live_beers") return o.calm ? J(r, CALM) : r.fallback();
    if (fn === "film_poll") return J(r, { v: 2, now: new Date().toISOString(), night: nightEnd(o.past), develop_at: nightEnd(o.past), groups: o.groups || [], rolls: [] });
    if (fn === "film_state") return J(r, { now: new Date().toISOString(), night: nightEnd(), develop_at: nightEnd(), mine: 2, left: 8, max: 10, group_n: 5, group_max: 60, shooters: 2, keeps: false, rolls: [] });
    if (fn === "my_push_prefs") return J(r, PREFS);
    if (fn === "set_push_prefs") return J(r, { ...PREFS, off: body.p_off });
    return r.fallback();
  });
  await page.route(/functions\/v1\/notify-group/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} log.push(["fn", b]); return J(r, { sent: 2, failed: 0 }); });
}
const chip = (page) => page.evaluate(() => {
  const c = document.querySelector("#hud-x .fm-chip"), p = document.getElementById("my-streak");
  if (!c) return null;
  const r = c.getBoundingClientRect(), pr = p.getBoundingClientRect(), vis = c.getClientRects().length > 0 && getComputedStyle(c).display !== "none";
  return { vis, urgent: c.classList.contains("hx-urgent"), text: c.textContent, aria: c.getAttribute("aria-label"), top: Math.round(r.top), ptop: Math.round(pr.top),
    right: Math.round(r.right), h: Math.round(r.height), bg: getComputedStyle(c).backgroundColor, sw: document.documentElement.scrollWidth, iw: innerWidth };
});
const sheet = (page) => page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, body: document.getElementById("sheet-body").textContent.slice(0, 200) }));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const errs = [];
  try {
    for (const vp of [{ width: 412, height: 915 }, { width: 360, height: 780 }]) {   // A) the chip, one group
      const log = []; const { ctx, page } = await ctxFor(browser, vp); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, { calm: true, groups: [grp(G, "Ludvika Lager", 5, 8), grp(G2, "Jobbet", 0, 10)] });
      await boot(page); await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      const c = await chip(page);
      ok(vp.width + ": 📸 chip shows on the main map (closed Ikväll row)", c && c.vis && c.urgent && /Gänget fotar/.test(c.text) && /8$/.test(c.text) && /Ludvika Lager fotar ikväll/.test(c.aria), c);
      ok(vp.width + ": chip alone on the left (Ikväll pill hidden by design), clear of the right rail", c && c.right <= vp.width - 56 && c.sw <= c.iw, c);
      ok(vp.width + ": aria says shots left", c && /8 bilder kvar/.test(c.aria), c && c.aria);
      ok(vp.width + ": amber, not the red alarm colour", c && !/rgba?\(90, 14, 20/.test(c.bg), c && c.bg);
      await shot(page, "main-" + vp.width);
      if (vp.width === 412) {
        await page.click("#hud-x .fm-chip"); await wait(page, 1200);
        const s = await sheet(page);
        ok("tap → the camera of that group", s.open && /Engångskamera/.test(s.title) && log.some((x) => x[0] === "film_state" && x[1].p_group_id === G), s);
        await shot(page, "cam-sheet");
        await page.evaluate(() => document.getElementById("sheet-close").click()); /* pnds: ✕ hides on sub-screens; same close-all action */ await wait(page, 600);
        // G) my first shot → film_start push once
        await page.evaluate((G) => window.FILM._shot(G[0], { left: 9, mine: 1, group_n: 1, night: G[1] }), [G2, nightEnd()]); await wait(page, 600);
        let fs = log.filter((x) => x[0] === "fn" && x[1].event === "film_start");
        ok("my first shot tonight → notify-group {event:'film_start', group_id}", fs.length === 1 && fs[0][1].group_id === G2, fs);
        await page.evaluate((G) => { window.FILM._shot(G[0], { left: 8, mine: 2, group_n: 2, night: G[1] }); window.FILM._shot(G[0], { left: 9, mine: 1, group_n: 1, night: G[1] }); }, [G2, nightEnd()]); await wait(page, 600);
        fs = log.filter((x) => x[0] === "fn" && x[1].event === "film_start");
        ok("2nd shot / same night again → no 2nd film_start call", fs.length === 1, fs.length);
        await page.evaluate((G) => window.FILM._shot(G, { left: 8, mine: 1, group_n: 14 }), G); await wait(page, 400);
        ok("my first shot when the group already shot 14 → no call", log.filter((x) => x[0] === "fn" && x[1].event === "film_start").length === 1);
        const c2 = await chip(page);
        ok("after my shot in Jobbet: chip counts 2 groups", c2 && /2 gäng fotar/.test(c2.text), c2 && c2.text);
        await page.click("#hud-x .fm-chip"); await wait(page, 900);
        const picks = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .fm-pick")].map((b) => b.textContent));
        ok("2 groups → chooser with both", picks.length === 2 && picks.some((t) => /Jobbet/.test(t)) && picks.some((t) => /Ludvika Lager/.test(t)), picks);
        await shot(page, "chooser");
        await page.evaluate(() => document.querySelector("#sheet-body .fm-pick").click()); await wait(page, 1000);
        ok("chooser → camera", /Engångskamera/.test((await sheet(page)).title));
        await page.evaluate(() => document.getElementById("sheet-close").click()); /* pnds: ✕ hides on sub-screens; same close-all action */ await wait(page, 600);
        // F) group page tile on home
        await page.click("#btn-groups"); await wait(page, 1300);
        await page.evaluate(() => document.querySelector('.inv-tabs [data-t="g"]') && document.querySelector('.inv-tabs [data-t="g"]').click()); await wait(page, 600);
        await page.click(".glist .gcard >> nth=0"); await wait(page, 1600);
        const tile = await page.evaluate(() => {
          const t = document.querySelector("#sheet-body .fm-gi"); if (!t) return null;
          const wrap = t.closest("[data-gv]");
          return { gm: t.getAttribute("data-gm"), gv: wrap && wrap.getAttribute("data-gv"), vis: t.getClientRects().length > 0 && getComputedStyle(t).display !== "none", text: t.textContent, tonight: !!t.querySelector(".fm-tonight") };
        });
        ok("group page: 📸 tile in Ikväll (+) (d2group AUDIT-NAV Q5: not on the calm home view)", tile && /plus/.test(tile.gm), tile);
        ok("group page tile: '🔴 Gänget fotar ikväll · 8 kvar för dig'", tile && tile.tonight && /Gänget fotar ikväll · 8 kvar för dig/.test(tile.text), tile && tile.text);
        await page.evaluate(() => document.querySelector("#sheet-body .fm-gi").scrollIntoView({ block: "center" })); await wait(page, 300);
        await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
        await shot(page, "group-tile");
        await page.evaluate(() => document.getElementById("sheet-close").click()); /* pnds: ✕ hides on sub-screens; same close-all action */ await wait(page, 600);
        // J) app open: a tapped filmstart push (sw → routeOpen)
        await page.evaluate((G) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: "/?film=" + G + "&cam=1" } })), G); await wait(page, 1500);
        const s2 = await sheet(page);
        ok("push tapped while the app is open (?film=…&cam=1) → camera", s2.open && /Engångskamera/.test(s2.title), s2);
      }
      await ctx.close();
    }
    { // C) gone after the night / no film tonight / film empty
      for (const [name, o] of [["night over", { calm: true, past: true, groups: [grp(G, "Ludvika Lager", 5, 8)] }], ["nobody shot", { calm: true, groups: [grp(G, "Ludvika Lager", 0, 10)] }],
        ["my film empty", { calm: true, groups: [grp(G, "Ludvika Lager", 14, 0)] }]]) {
        const log = []; const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }); page.on("pageerror", (e) => errs.push(e.message));
        await extra(page, log, o); await boot(page);
        ok("no chip when " + name, !(await chip(page)));
        await ctx.close();
      }
    }
    { // E) 🚑 keeps the slot; the 📸 chip is in the open panel
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, { groups: [grp(G, "Ludvika Lager", 5, 8)] }); await boot(page);
      const r = await page.evaluate(() => ({ urg: (document.querySelector("#hud-x .hx-urgent") || {}).className, fm: !!document.querySelector("#hud-x .fm-chip") }));
      ok("a friend at 10+ (🚑) keeps the one slot; 📸 waits in the panel", /af-chip-med/.test(r.urg) && r.fm, r);
      // suite: the Ikväll pill is hidden by design (pnds.css "My night lives in Grupper / Profil"), so there is no panel to open.
      // The 📸 chip stays in #hud-x (not urgent, not shown) and the pill stays hidden; the camera way in is the group tile (tested above).
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      const pv = await page.evaluate(() => ({ pill: !!document.getElementById("my-streak") && document.getElementById("my-streak").getClientRects().length > 0,
        fm: !!document.querySelector("#hud-x .fm-chip"), fmUrgent: !!document.querySelector("#hud-x .fm-chip.hx-urgent") }));
      ok("Ikväll pill hidden by design; 📸 chip kept in #hud-x behind the 🚑 slot", !pv.pill && pv.fm && !pv.fmUrgent, pv);
      await shot(page, "panel");
      await ctx.close();
    }
    { // I) cold start from the push
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, { calm: true, groups: [grp(G, "Ludvika Lager", 1, 10)] });
      await page.goto(`http://127.0.0.1:${PORT}/?film=${G}&cam=1`);
      await page.waitForFunction(() => !document.getElementById("sheet").hidden && /Engångskamera/.test(document.getElementById("sheet-title").textContent), null, { timeout: 25000 }).catch(() => {});
      const s = await sheet(page);
      ok("cold start ?film=<gid>&cam=1 → camera, url cleaned", s.open && /Engångskamera/.test(s.title) && !/film=|cam=/.test(page.url()), [s, page.url()]);
      await ctx.close();
    }
    { // H) 🔔 Välj notiser: 📸 row when the server lists "film"
      const log = []; const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }); page.on("pageerror", (e) => errs.push(e.message));
      await extra(page, log, { calm: true }); await boot(page);
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 900);
      await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button")].find((b) => /Inställningar/.test(b.textContent)); if (t) t.click(); }); await wait(page, 1200);
      await page.waitForSelector(".push-prefs:not([hidden])", { timeout: 6000 }).catch(() => {});
      const k = await page.evaluate(() => ({ n: document.querySelectorAll(".push-prefs .switch[data-kind]").length, film: (document.querySelector('.push-prefs .switch[data-kind="film"]') || {}).getAttribute ? document.querySelector('.push-prefs .switch[data-kind="film"]').closest(".toggle-row").textContent : null,
        kul: document.querySelector('.push-prefs .switch[data-kind="kul"]').closest(".toggle-row").textContent }));
      ok("🔔 9 kinds incl. 📸 Engångskameran; kul row without 'film'", k.n === 9 && /(📸 )?Engångskameran/.test(k.film) /* pnds: the 📸 is an icon now */ && /Befordringar och helgstreak/.test(k.kul) && !/film/.test(k.kul), k);
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="film"]').closest(".toggle-row").click()); await wait(page, 500);
      const last = log.filter((x) => x[0] === "set_push_prefs").pop();
      ok("turn 📸 off → set_push_prefs p_off ['film']", last && JSON.stringify(last[1].p_off) === '["film"]', last);
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="film"]').scrollIntoView({ block: "center" })); await wait(page, 300);
      await shot(page, "prefs");
      await ctx.close();
    }
    ok("no page errors", errs.length === 0, errs);
  } catch (e) { console.log("ERROR", e.stack || e); fail++; }
  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
