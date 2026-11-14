// Hidden Easter eggs (docs/js/eggs.js). Mocked Supabase (ds-helpers). usage: node eggs-pw.js <port>
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const H = require("./ds-helpers.js");
const { wait } = H;
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(" | "));
const clear = (page) => page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
const found = (page) => page.evaluate(() => (window.PN.eggs ? window.PN.eggs.found() : null));
const tap = (page, sel, n) => page.evaluate(([s, n]) => { for (let i = 0; i < n; i++) document.querySelector(s).click(); }, [sel, n]);
const resetDay = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /^olnu\.egg\.d/.test(k)).forEach((k) => localStorage.removeItem(k)));
async function phone(browser, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, o);
  // c4fix: eggs are off under automation (navigator.webdriver) so they never fire in OTHER tests; this test turns them on
  if (!o.off) await ctx.addInitScript(() => { try { localStorage.setItem("olnu.egg.test", "1"); } catch (e) {} });
  await H.boot(page);
  await page.waitForFunction(() => window.PN && window.PN.eggs, null, { timeout: 10000 }).catch(() => {});
  await H.closeSheet(page); await wait(page, 300); await clear(page);
  return { ctx, page };
}
(async () => {
  const src = fs.readFileSync(path.join(__dirname, "../../docs/js/eggs.js"), "utf8");
  ok(Buffer.byteLength(src) < 6144, "eggs.js < 6 KB (" + Buffer.byteLength(src) + ")");
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|window\.[A-Z_]+\s*=/.test(src), "no network call, no new window global");
  const ids = ["logo", "water", "swipe", "world", "glenn", "dawn", "credits"];
  ok(ids.every((k) => (src.match(new RegExp("eg_" + k + ": ", "g")) || []).length === 2), "every egg has one sv and one en text");
  const browser = await chromium.launch();
  { // 1 logo + once a day + normal use
    const { ctx, page } = await phone(browser);
    ok((await found(page)) !== null, "module loaded (PN.eggs)");
    await tap(page, ".brand-name", 3); await tap(page, "#live-count", 3); await wait(page, 500);
    ok((await toasts(page)) === "" && (await found(page)).length === 0, "normal taps (3 + 3) do nothing");
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await tap(page, ".brand-name", 4); await wait(page, 300);
    ok(/Ölguden har sett dig/.test(await toasts(page)), "logo x7: Ölguden toast");
    ok(await page.evaluate(() => document.querySelectorAll("i[style*='fixed']").length > 0), "logo x7: foam burst");
    await wait(page, 1200);
    ok(await page.evaluate(() => document.querySelectorAll("i[style*='fixed']").length === 0), "foam gone after 1 s");
    ok((await page.evaluate(() => document.documentElement.scrollHeight)) === h0, "no layout shift");
    await clear(page); await tap(page, ".brand-name", 7); await wait(page, 400);
    ok((await toasts(page)) === "", "logo again the same day: nothing");
    await resetDay(page); await tap(page, ".brand-name", 7); await wait(page, 400);
    ok(/Ölguden/.test(await toasts(page)), "next day: works again");
    await clear(page);
    // off in Folj mig hem and in a live ride
    await resetDay(page); await page.evaluate(() => document.body.classList.add("hf-on"));
    await tap(page, ".brand-name", 7); await wait(page, 400);
    ok((await toasts(page)) === "", "off while body.hf-on (Folj mig hem)");
    await page.evaluate(() => { document.body.classList.remove("hf-on"); window.RIDE = { live: () => true }; });
    await tap(page, ".brand-name", 7); await wait(page, 400);
    ok((await toasts(page)) === "", "off while a ride is live");
    await page.evaluate(() => { window.RIDE = undefined; });
    // 2 water
    await tap(page, "#live-count", 5); await wait(page, 400);
    ok(/vatten/.test(await toasts(page)), "count x5: water toast (no pressure to drink)");
    ok(!/drick mer|dricka mer|drink more/i.test(src), "no 'drink more' text");
    // c4fix: a tap on the live count also opens "Ute nu" (zones.js fixM T-15). Close it like a person would before using the map:
    // map eggs stay quiet and calm toasts wait while a sheet is open (by design).
    ok(await page.evaluate(() => !document.getElementById("sheet").hidden), "count taps also open Ute nu (normal use kept)");
    await H.closeSheet(page); await wait(page, 400);
    // 6 dawn
    await clear(page);
    await page.evaluate(() => window.PN.eggs.clock(() => new Date(2026, 10, 13, 14, 2)));
    await page.evaluate(() => window.__map.setView([60.1496, 15.1878], 13, { animate: false })); await wait(page, 600);
    ok(!/Morgonrapport/.test(await toasts(page)), "Ludvika at 14:02: no morning report");
    await page.evaluate(() => window.PN.eggs.clock(() => new Date(2026, 10, 13, 5, 2)));
    await page.evaluate(() => window.__map.setView([59.33, 18.07], 13, { animate: false })); await wait(page, 600);
    ok(!/Morgonrapport/.test(await toasts(page)), "Stockholm at 05:02: no morning report");
    await page.evaluate(() => window.__map.setView([60.1496, 15.1878], 14, { animate: false })); await wait(page, 600);
    ok(/Morgonrapport/.test(await toasts(page)), "Ludvika at 05:02: morning report");
    // 4 world
    await page.evaluate(() => window.__map.setZoom(8, { animate: false })); await wait(page, 300);
    ok(!(await page.evaluate(() => /mittpunkt/.test(document.body.innerText))), "zoom 8: no chip");
    await page.evaluate(() => window.__map.setZoom(3, { animate: false })); await wait(page, 400);
    ok(await page.evaluate(() => /Ludvika: världens mittpunkt/.test(document.body.innerText)), "whole world: Ludvika chip");
    await wait(page, 3300);
    ok(!(await page.evaluate(() => /världens mittpunkt/.test(document.body.innerText))), "chip gone after 3 s");
    // 5 glenn
    await page.evaluate(() => { document.body.insertAdjacentHTML("beforeend", '<input id="chat-inp">'); const i = document.getElementById("chat-inp"); i.value = "hej glenn"; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await wait(page, 300);
    ok(!/Tjena Glenn/.test(await toasts(page)), "glenn in a neutral dialect: nothing");
    await page.evaluate(() => { window.DIALEKT.preview("sv-vast"); }); await wait(page, 300);
    // owner 13 Nov: one toast per tap (calm2): the Morgonrapport above was the answer to the last tap (the sheet close), so an
    // input event with no key press counted as the same tap and its toast was dropped. A real user types: send the keydown too.
    await page.evaluate(() => { const i = document.getElementById("chat-inp"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })); i.value = "glenn"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(page, 300);
    ok(/Tjena Glenn!/.test(await toasts(page)), "glenn in the Göteborg dialect: Tjena Glenn!");
    // 7 credits from Om appen
    await clear(page);
    await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1500);
    // d1settings hub (setfix): Inställningar tab → the page Om appen (the version row lives there)
    await page.evaluate(() => { const t = document.querySelector('#sheet-body [role="tab"][data-pf="s"]'); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }); await wait(page, 1200);
    await page.evaluate(() => { const b = document.querySelector("#sheet-body .set-r-om"); if (b) b.click(); }); await wait(page, 600);
    await page.waitForSelector(".ds-ver .toggle-row", { state: "attached", timeout: 6000 }).catch(() => {});
    const has = await page.evaluate(() => !!document.querySelector(".ds-ver .toggle-row")); ok(has, "Om appen has the version row");
    if (!has) console.log("  sheet:", await page.evaluate(() => document.getElementById("sheet-title").textContent + " | " + [...document.querySelectorAll("#sheet-body h3,#sheet-body .ds-sec-t,#sheet-body .toggle-row")].map((x) => x.textContent.trim().slice(0, 25)).join(" / ").slice(0, 600)));
    await page.evaluate(() => { const r = document.querySelector(".ds-ver .toggle-row"); for (let i = 0; i < 4; i++) r.click(); }); await wait(page, 300);
    ok(!/Byggd i Ludvika av TuNeLA/.test(await page.evaluate(() => document.getElementById("sheet-title").textContent)), "version x4: no credits");
    await page.evaluate(() => document.querySelector(".ds-ver .toggle-row").click()); await wait(page, 1200);
    const sheet = await page.evaluate(() => document.getElementById("sheet").innerText);
    ok(/Byggd i Ludvika av TuNeLA/.test(await page.evaluate(() => document.getElementById("sheet-title").textContent)), "version x5: credits sheet");
    const f = await found(page);
    ok(new RegExp("Hittade " + f.length + " av 7").test(sheet) && (sheet.match(/\?\?\?/g) || []).length === 7 - f.length, "sheet counts " + f.length + " found, rest are ???");
    // c4fix: the swipe egg is tested on the 2nd phone (own localStorage), so this phone finds the other 6
    ok(f.length === 6 && ids.filter((k) => k !== "swipe").every((k) => f.indexOf(k) >= 0), "all 6 eggs of this phone found (swipe: 2nd phone)");
    await ctx.close();
  }
  { // swipe code with real drags + reduced motion
    const { ctx, page } = await phone(browser, { reduced: true });
    await page.evaluate(() => window.__map.setView([60.1496, 15.1878], 14, { animate: false })); await wait(page, 800);
    // c4fix: start each swipe on bare map (a tile), not on a pin / cluster: after one swipe a marker could sit at a fixed start point,
    // and a drag that starts on a marker does not move the map (only the first swipe counted).
    const bare = () => page.evaluate(() => { for (let y = 300; y <= 600; y += 20) for (let x = 120; x <= 270; x += 15) { const e = document.elementFromPoint(x, y);
      if (e && (e.classList.contains("leaflet-tile") || e.classList.contains("leaflet-container"))) return [x, y]; } return [195, 420]; });
    const drag = async (dx, dy) => { const [x0, y0] = await bare(), m = page.mouse; await m.move(x0, y0); await m.down(); for (let i = 1; i <= 8; i++) await m.move(x0 + dx * i / 8, y0 + dy * i / 8); await m.up(); await wait(page, 900); };
    await drag(0, -120); await drag(0, -120); await drag(0, 120); await drag(0, 120); await drag(-120, 0);
    ok((await toasts(page)) === "" && (await found(page)).length === 0, "5 of 6 swipes: nothing");
    await drag(120, 0); await wait(page, 300);
    ok(/hemliga kod/.test(await toasts(page)), "swipe up up down down left right: toast");
    ok((await found(page)).indexOf("swipe") >= 0, "swipe egg counted as found");
    await clear(page); await resetDay(page);
    await tap(page, ".brand-name", 7); await wait(page, 300);
    ok(/Ölguden/.test(await toasts(page)) && (await page.evaluate(() => document.querySelectorAll("i[style*='fixed']").length)) === 0, "reduced motion: toast, no foam");
    await ctx.close();
  }
  { // c4fix: automation without the switch = no eggs (x8: the 05:0x morning toast replaced the test's ÖL! toast)
    const { ctx, page } = await phone(browser, { off: true });
    ok((await found(page)) === null, "under automation without olnu.egg.test: module off (no eggs in other tests)");
    await tap(page, ".brand-name", 7); await wait(page, 400);
    ok(!/Ölguden/.test(await toasts(page)), "under automation without the switch: logo x7 does nothing");
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? "DONE with " + fails + " FAIL" : "DONE all pass");
  process.exit(fails ? 1 : 0);
})();
