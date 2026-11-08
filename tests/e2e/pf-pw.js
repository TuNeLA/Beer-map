// pf01 + pf02: bar markers count PEOPLE (people glyph) + "Folk här" night totals; "Pinnen följer med dig" (pinfolj.js).
// Mocked Supabase (ds-helpers) + mocked geolocation. usage: node pf-pw.js <port>
const { chromium } = require("playwright");
const H = require("./ds-helpers.js");
const SP = require("./env.js").OUT;
const { wait } = H;
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const GREK = [60.15205, 15.18059], PITCH = [60.14997, 15.18679];
const FAR = [60.14390, 15.17600];   // ~700 m from Pitchers (my pin)
const shot = (page, n) => page.screenshot({ path: SP + "pf-shots/pf-" + n + ".png" });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();

// The owner's night: Robban (friend) had 15 at home, then went to Grekiska; one stranger (2) is there too.
const ROBBAN = { id: 5001, lat: GREK[0] + 0.00003, lng: GREK[1] + 0.00002, beer_count: 15, precise: true, created_at: iso(300), is_mine: false, friend_name: "Robban", bar_id: "x-grekiska-grill-bar-ludvika", snap: "exact" };
const STRANGER2 = { id: 5003, lat: GREK[0] + 0.00001, lng: GREK[1] - 0.00003, beer_count: 4, precise: true, created_at: iso(70), is_mine: false, friend_name: null, bar_id: "x-grekiska-grill-bar-ludvika", snap: "bar" };
const STRANGER = { id: 5002, lat: GREK[0] - 0.00002, lng: GREK[1], beer_count: 2, precise: true, created_at: iso(40), is_mine: false, friend_name: null, bar_id: "x-grekiska-grill-bar-ludvika", snap: "bar" };

async function setup(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, Object.assign({ checkin: false }, o));
  const srv = { calls: [], reply: o.reply || null };
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route(/rest\/v1\/rpc\/(pin_follow|live_beers)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "live_beers") {
      const mine = { id: 4000, lat: PITCH[0], lng: PITCH[1], beer_count: 6, precise: true, created_at: iso(150), is_mine: true, friend_name: null };
      return J(r, [mine, Object.assign({}, ROBBAN), Object.assign({}, STRANGER)].concat(o.two ? [] : [Object.assign({}, STRANGER2)]));
    }
    srv.calls.push({ fn, body });
    if (srv.missing) return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.pin_follow" }) });
    return J(r, srv.reply || { ok: true, moved: true, d: 700, lat: body.p_lat, lng: body.p_lng, precise: !body.p_area, bar_id: null });
  });
  await ctx.setGeolocation({ latitude: PITCH[0], longitude: PITCH[1], accuracy: 10 });
  if (o.extra) await ctx.addInitScript(o.extra);
  await H.boot(page);
  await page.waitForFunction(() => window.AUTOCI && window.AUTOCI.state().watching, null, { timeout: 15000 }).catch(() => {});
  await H.closeSheet(page); await wait(page, 300);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, srv };
}
async function read(t, ll, acc, advMin, dm = [0, 0]) {
  await t.page.evaluate((m) => window.AUTOCI._skew(m * 60e3), advMin);
  await t.ctx.setGeolocation({ latitude: ll[0] + dm[0] / 111320, longitude: ll[1] + dm[1] / 55600, accuracy: acc });
  await wait(t.page, 400);
  await t.page.evaluate(() => window.AUTOCI._tick());
  await wait(t.page, 1600);
}
const pf = (t) => t.srv.calls.filter((c) => c.fn === "pin_follow");
const why = (t) => t.page.evaluate(() => window.PINFOLJ.state().why);

(async () => {
  require("fs").mkdirSync(SP + "pf-shots", { recursive: true });
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } : undefined, args: ["--ignore-certificate-errors"] });

  // ---------- 1. people count at the bar + night total in Folk här ----------
  {
    const t = await setup(browser);
    await t.page.evaluate((g) => window.__map.setView(g, 17, { animate: false }), GREK); await wait(t.page, 2500);
    const m = await t.page.evaluate(() => {
      const ic = document.querySelector('.leaflet-marker-icon[data-bar="x-grekiska-grill-bar-ludvika"]') ||
        [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((x) => /Grekiska/.test(x.textContent));
      if (!ic) return null;
      const p = ic.querySelector(".pill");
      return p ? { n: p.querySelector(".pn").textContent, ppl: !!p.querySelector(".pe-ppl"), svg: !!p.querySelector(".pe-ppl svg.pi-users"), beer: /🍺/.test(p.textContent), friend: p.classList.contains("pf") } : { nopill: 1 };
    });
    ok(m && m.n === "3", "bar marker: count = 3 people at Grekiska " + JSON.stringify(m));
    ok(m && m.ppl && m.svg && !m.beer, "bar marker: PEOPLE glyph (pnicons users), no 🍺 glyph next to the people count");
    ok(m && m.friend, "bar marker: friend ring kept (a friend is there)");
    // GL art (mapart): the count badge draws the people glyph
    const art = await t.page.evaluate(() => {
      const P = window.PNPINS; if (!P || !P.barOps) return null;
      const ops = P.barOps({ k: "pub", p: { n: "3", e: true, u: true, l: 0, f: true } }, "f", false).ops;
      return { people: ops.some((o) => o.o === "g" && o.n === "people"), txt: ops.filter((o) => o.o === "t").map((o) => o.t) };
    });
    ok(!art || (art.people && art.txt.indexOf("3") >= 0), "GL count badge: people glyph + '3' " + JSON.stringify(art));
    const gl = await t.page.evaluate(() => window.GLBARS && window.GLBARS._parse ? 1 : 0);
    // open the bar sheet → Folk här
    await t.page.evaluate(() => { const ic = [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((x) => /Grekiska/.test(x.textContent)); const p = ic && (ic.querySelector(".pill") || ic); if (p) p.click(); });
    await wait(t.page, 1500);
    await t.page.evaluate(() => { const d = document.querySelector('details[data-fold="here"]'); if (d) d.open = true; });
    await wait(t.page, 600);
    const head = await t.page.evaluate(() => { const sm = document.querySelector('details[data-fold="here"] > summary'); return sm ? { html: sm.innerHTML, txt: sm.textContent } : null; });
    ok(head && !/🍺/.test(head.txt) && !/pi-beer|pi-mug|pi-pub/.test(head.html) && (/👥/.test(head.txt) || /pi-users/.test(head.html)), "Folk här header: people icon, no beer glyph next to the people count " + (head && head.txt.trim()));
    const rows = await t.page.evaluate(() => [...document.querySelectorAll(".pp-list li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()));
    ok(rows.some((r) => /Robban/.test(r) && /15 🍺 ikväll/.test(r)), "Folk här: Robban shows his NIGHT TOTAL '15 🍺 ikväll' " + JSON.stringify(rows));
    ok(rows.some((r) => /Någon/.test(r) && !/\d/.test(r.replace(/Skål.*$/, ""))) && rows.filter((r) => /Någon/.test(r)).every((r) => !/\d/.test(r.replace(/Skål.*$/, ""))), "Folk här: strangers show no number (store-safe)");
    await t.page.evaluate(() => { const s = document.querySelector('details[data-fold="here"]'); if (s) s.scrollIntoView(); });
    await wait(t.page, 400); await shot(t.page, "1-folk-har");
    await t.page.evaluate(() => window.__map.closePopup()); await H.closeSheet(t.page); await wait(t.page, 500);
    await t.page.evaluate((g) => window.__map.setView(g, 17, { animate: false }), GREK); await wait(t.page, 1500);
    await shot(t.page, "1-bar-marker");
    await t.ctx.close();
  }

  // ---------- 1b. 2 people (gw honest crowd): no number at all, still no beer glyph ----------
  {
    const t = await setup(browser, { two: true });
    await t.page.evaluate((g) => window.__map.setView(g, 17, { animate: false }), GREK); await wait(t.page, 2500);
    const m = await t.page.evaluate(() => { const ic = [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((x) => /Grekiska/.test(x.textContent)); const p = ic && ic.querySelector(".pill");
      if (!p) return null; const cs = getComputedStyle(p.querySelector(".pn")); return { pq: p.classList.contains("pq"), numShown: cs.display !== "none", ppl: !!p.querySelector(".pe-ppl"), beer: /🍺/.test(p.textContent) }; });
    ok(m && m.pq && !m.numShown && !m.beer, "2 people at the bar: 'Lugnt', no number, no beer glyph " + JSON.stringify(m));
    await t.ctx.close();
  }

  // ---------- 2. pin follows me (friends) ----------
  {
    const t = await setup(browser);
    ok(await t.page.evaluate(() => !!(window.PINFOLJ && window.PINFOLJ.state().hooked)), "pinfolj: hooked to AUTOCI readings (no own GPS sampler)");
    ok(await t.page.evaluate(() => window.PINFOLJ.on()), "pinfolj: on by default");
    const gp = await t.page.evaluate(() => { let n = 0; const o = navigator.geolocation.watchPosition; return typeof o === "function" ? "ok" : "none"; });
    await read(t, PITCH, 10, 1, [5, 5]);
    ok(pf(t).length === 0 && (await why(t)) === "near", "near the pin (< 150 m): nothing sent");
    await read(t, FAR, 80, 1);
    ok(pf(t).length === 0 && (await why(t)) === "accuracy", "accuracy 80 m: not counted");
    await read(t, FAR, 12, 1);
    ok(pf(t).length === 0 && (await why(t)) === "first", "1st far reading: waits for a 2nd");
    await read(t, FAR, 12, 1, [10, 0]);
    ok(pf(t).length === 0 && (await why(t)) === "wait_gap", "2nd far reading after 1 min: still waits (needs >= 2 min)");
    await read(t, FAR, 12, 1.2, [0, 8]);
    const c = pf(t);
    ok(c.length === 1 && Math.abs(c[0].body.p_lat - FAR[0]) < 0.0005 && c[0].body.p_area === false && c[0].body.p_acc <= 50, "far 2 readings >= 2 min apart → pin_follow(lat, lng, acc, area=false) " + JSON.stringify(c.map((x) => x.body)));
    await wait(t.page, 600);
    const tx = await t.page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    ok(/Din pin flyttade med dig/.test(tx), "one short toast the first time tonight (" + tx + ")");
    await shot(t.page, "2-moved-toast");
    // the follow point is now "where friends see me": the same place is near → nothing more
    await read(t, FAR, 12, 3);
    ok(pf(t).length === 1 && (await why(t)) === "near", "after the move: the new point is the pin (near → nothing sent)");
    // moves again: rate limit 2 min between calls
    const FAR2 = [60.1545, 15.1960];
    await read(t, FAR2, 12, 1); await read(t, FAR2, 12, 2.1);
    ok(pf(t).length === 2, "moves again (2 readings, 2 min) → 2nd call " + pf(t).length);
    // settings row
    await H.clickJS(t.page, "#btn-settings"); await wait(t.page, 1500);
    await H.clickJS(t.page, "#sheet-body [data-pf=s]"); await wait(t.page, 1200);
    const row = await t.page.evaluate(() => { const b = document.querySelector("#sheet-body .pf-row"); if (!b) return null; b.scrollIntoView({ block: "center" }); return { swb: b.classList.contains("pn-swb"), icon: !!b.querySelector("svg"), checked: b.getAttribute("aria-checked"), txt: b.textContent.trim(), after: !!document.querySelector("#sheet-body .ac-row") }; });
    ok(row && row.swb && row.icon && row.checked === "true" && /Pinnen följer med dig/.test(row.txt), "settings: switch row 'Pinnen följer med dig' (on) " + JSON.stringify(row));
    await wait(t.page, 400); await shot(t.page, "3-settings");
    await H.clickJS(t.page, "#sheet-body .pf-row"); await wait(t.page, 300);
    ok(await t.page.evaluate(() => !window.PINFOLJ.on()), "settings: tap turns it off");
    await H.closeSheet(t.page); await wait(t.page, 400);
    const FAR3 = [60.1610, 15.1890];
    await read(t, FAR3, 10, 3); await read(t, FAR3, 10, 2.5);
    ok(pf(t).length === 2 && (await why(t)) === "setting", "setting off: nothing sent");
    await t.page.evaluate(() => window.PINFOLJ.setOn(true));
    // ghost mode
    await t.page.evaluate(() => localStorage.setItem("olnu.ghostMode", "1"));
    const ghostKey = await t.page.evaluate(() => window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn());
    await read(t, FAR3, 10, 3); await read(t, FAR3, 10, 2.5);
    ok(ghostKey && (pf(t).length === 2 && (await why(t)) === "ghost"), "spökläge: nothing sent (ghost=" + ghostKey + ")");
    await t.page.evaluate(() => localStorage.removeItem("olnu.ghostMode"));
    await t.ctx.close();
  }

  // ---------- 2b. "Bara område" → p_area true ----------
  {
    const t = await setup(browser, { extra: () => { try { localStorage.setItem("olnu.prec", "area"); } catch (e) {} } });
    await read(t, FAR, 10, 1); await read(t, FAR, 10, 2.5);
    const last = pf(t)[pf(t).length - 1];
    ok(pf(t).length === 1 && last.body.p_area === true, "Bara område: p_area = true (server stores the rounded area) " + JSON.stringify(last && last.body));
    await t.ctx.close();
  }

  // ---------- 3. home zone + old server ----------
  {
    const t = await setup(browser, { extra: () => { try { localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.14390, lng: 15.17600, r: 300 })); } catch (e) {} } });
    const home = await t.page.evaluate(() => !!(window.PRIVACY && window.PRIVACY.inHome && window.PRIVACY.inHome(60.14390, 15.17600)));
    await read(t, FAR, 10, 1); await read(t, FAR, 10, 2.5);
    ok(home && (pf(t).length === 0 && (await why(t)) === "home"), "home zone: nothing sent (inHome=" + home + ")");
    await t.ctx.close();
  }
  {
    const t = await setup(browser);
    t.srv.missing = true;
    await read(t, FAR, 10, 1); await read(t, FAR, 10, 2.5);
    await wait(t.page, 500);
    const st = await t.page.evaluate(() => window.PINFOLJ.state());
    const tx = await t.page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" | "));
    ok(pf(t).length === 1 && st.off && !/fel|Error/i.test(tx), "old server (no RPC): one try, then quiet for the session");
    const FAR2 = [60.1545, 15.1960];
    await read(t, FAR2, 10, 3); await read(t, FAR2, 10, 2.5);
    ok(pf(t).length === 1, "old server: no more calls");
    await t.ctx.close();
  }

  await browser.close();
  console.log(fails ? "FAILS " + fails : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
