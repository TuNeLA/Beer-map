// sweepC-pw.js — lane fixC, polish sweep 24 Nov 2026 (source: lanes/polish-FINDINGS.md P-06 P-07 P-11 P-14 P-20 P-25 P-26 P-28).
// Bar card: hours row first in Info (P-06), "Mer" scrolls into view, "Fel tider?" only with hours; Checka ut = outline, ONE
// "Rapportera fel" with the 2 choices, one button style in Mer (P-07); crowd line words, the 10+ care line, phone 0240-101 00,
// friends once, "Ute nu -2°" (P-25). Sök: nearest bars when the field is empty (P-20). Öl: no duplicate beers, a "?" chip for a
// guessed style (P-11). Profil: an empty favourite tile opens the pick for ITS slot and comes back (P-14). Beer page: one data
// line, a calm "no ratings yet", the app icon (P-26). Topplista: "Vänner här" in words, not colour only (P-28).
// Old code: most checks fail (no row, amber Checka ut, two report buttons, Heineken x12, an extra tap, ...).
// 390 px, mocked Supabase (port B). Usage: node sweepC-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT + "sweepC/";
fs.mkdirSync(SP, { recursive: true });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const PITCHERS = "n3472634175", PARMA = "x-la-parma-ludvika";
const WEEK = ["660-1500", "660-1500", "660-1500", "660-1500", "660-1560", "660-1560", "660-1500"];
const BEERS = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/data/beer/beers.json"), "utf8"));

async function open(browser) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, {});
  const J = (rt, b) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  const favs = [];
  await page.route(/rest\/v1\/rpc\/(beerlib_favs_mine|beerlib_fav_set|beerlib_beer_get|beerlib_rate|beerlib_privacy)\b/, (rt) => {
    let b = {}; try { b = JSON.parse(rt.request().postData() || "{}"); } catch (e) {}
    const fn = rt.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "beerlib_favs_mine") return J(rt, favs.slice());
    if (fn === "beerlib_fav_set") { for (let i = favs.length - 1; i >= 0; i--) if (favs[i].slot === b.p_slot || favs[i].beer === b.p_beer) favs.splice(i, 1); if (b.p_beer) favs.push({ slot: b.p_slot, beer: b.p_beer }); favs.sort((x, y) => x.slot - y.slot); return J(rt, favs.slice()); }
    if (fn === "beerlib_beer_get") return J(rt, { my_stars: null, fav_slot: null, n: 3, avg: null, reviews: [] });
    if (fn === "beerlib_rate") return J(rt, { stars: b.p_stars, n: 3, avg: null });
    return J(rt, { mode: b.p_mode || "friends" });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return { ctx, page, errs };
}
async function bar(page, id, week) {
  await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} }); await wait(page, 300);
  await page.evaluate(([id, week]) => { if (week && window.OPPET && OPPET.setFix) OPPET.setFix(id, week, "crowd"); window.PN.openBarById(id, 0); }, [id, week || null]);
  await page.waitForFunction(() => document.querySelector(".leaflet-popup .bs.pn-bs7"), null, { timeout: 10000 }).catch(() => {});
  await wait(page, 1500);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
}
const shot = (page, n) => page.screenshot({ path: SP + n + ".png" }).catch(() => {});
// one block per finding: an exception (old code: a missing element) is a FAIL of that block, the next block still runs
async function step(page, name, f) {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} try { PN.closeSheet(); } catch (e) {} }).catch(() => {});
    await wait(page, 500);
    await f();
  } catch (e) { fail++; console.log("FAIL " + name + " threw: " + String(e && e.message).split("\n")[0]); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  try {
    let { ctx, page, errs } = await open(browser);

    await step(page, "P-06 / P-07 / P-25 on Pitchers", async () => {
    // ---------- P-06 / P-07 / P-25 on Pitchers (checked in, no hours in the data) ----------
    await bar(page, PITCHERS);
    const a = await page.evaluate(() => {
      const bs = document.querySelector(".leaflet-popup .bs.pn-bs7"), info = bs && bs.querySelector(".pn-bs-info");
      const first = info && [...info.querySelectorAll(".bi-line:not([hidden]) > span, :scope > *:not(.bi-line)")].find((e) => e.getClientRects().length);
      const add = bs && bs.querySelector(".pn-bs-info .oh-none [data-hva='fix']"), out = bs && bs.querySelector(".pp-act .ci-out");
      return { first: first ? first.textContent.replace(/\s+/g, " ").trim() : null, addH: add ? Math.round(add.getBoundingClientRect().height) : 0,
        fel: !!(bs && bs.querySelector("[data-bia='close']")), outBg: out ? getComputedStyle(out).backgroundColor : null,
        meter: (bs && bs.querySelector(".pn-mt-none") || {}).textContent || null, sub: (bs && bs.querySelector('details[data-fold="mer"] .pn-bs-sub') || {}).textContent };
    });
    ok("P-06 Info, first row: 'Öppettider saknas' + [Lägg till] (44 px) when there are no hours", a.first === "Öppettider saknasLägg till" && a.addH >= 44, a);
    ok("P-06 no 'Fel tider?' when there are no hours to be wrong", !a.fel, a);
    ok("P-06 the Mer line names the hours: 'Tider, pris, stammis, QR'", a.sub === "Tider, pris, stammis, QR", a.sub);
    ok("P-07 checked in: 'Checka ut' is an outline button (not amber)", a.outBg === "rgba(0, 0, 0, 0)", a.outBg);
    ok("P-25 the crowd line says what is missing: 'Okänt än hur fullt det brukar vara'", a.meter === "Okänt än hur fullt det brukar vara", a.meter);
    await shot(page, "1-pitchers");
    // Mer: a tap opens it AND scrolls it up under the name bar
    const m = await page.evaluate(async () => {
      const sc = document.querySelector(".leaflet-popup .leaflet-popup-content"), d = sc.querySelector('details[data-fold="mer"]');
      if (d.open) { d.open = false; await new Promise((r) => setTimeout(r, 200)); }
      sc.scrollTop = 0; await new Promise((r) => setTimeout(r, 200));
      const b0 = d.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      d.querySelector("summary").click(); await new Promise((r) => setTimeout(r, 1200));
      return { b0: Math.round(b0), after: Math.round(d.getBoundingClientRect().top - sc.getBoundingClientRect().top), open: d.open };
    });
    ok("P-06 a tap on 'Mer' opens it and scrolls it into view (top 40–110 px under the sheet top)", m.open && m.b0 > 300 && m.after >= 40 && m.after <= 110, m);
    const r = await page.evaluate(() => {
      const bs = document.querySelector(".leaflet-popup .bs.pn-bs7"), g = bs.querySelector("details.pn-bs-rep");
      const vis = (e) => !!(e && e.getClientRects().length && e.getBoundingClientRect().height > 0);
      const o = { group: !!g, sum: g ? g.querySelector("summary").textContent.trim() : null, evrep: !!(g && g.querySelector("[data-evrep]")), gone: !!(g && g.querySelector(".gone-sec [data-gone]")),
        outside: bs.querySelectorAll('details[data-fold="mer"] [data-evrep], details[data-fold="mer"] .gone-sec').length - (g ? g.querySelectorAll("[data-evrep], .gone-sec").length : 0),
        closedVis: g ? g.open : null, tip: !!bs.querySelector('details[data-fold="mer"] [data-evtip]') };
      const acts = [...bs.querySelectorAll('details[data-fold="mer"] .pp-info .btn, details[data-fold="mer"] .plc-btn, details[data-fold="mer"] .pn-bs-repb, details[data-fold="mer"] .af-qr, details[data-fold="mer"] .inv-here')].filter(vis);
      o.acts = acts.map((e) => { const s = getComputedStyle(e); return [Math.round(e.getBoundingClientRect().height), s.fontSize, s.backgroundColor, Math.round(e.getBoundingClientRect().width)].join("|"); });
      o.tel = (bs.querySelector(".plc-tel") || {}).textContent || null; o.telHref = (bs.querySelector(".plc-tel") || {}).href || null;
      return o;
    });
    ok("P-07 ONE 'Rapportera fel' row holds both report choices (events 'Fel plats…' + gone 'Finns inte längre')", r.group && r.sum === "Rapportera fel›" && r.evrep && r.gone && r.outside === 0 && r.closedVis === false && r.tip, r);
    ok("P-07 one button style for the actions in Mer (same height ≥ 48, 16 px text, no fill, full width)",
      r.acts.length >= 4 && new Set(r.acts).size === 1 && /^(4[89]|5\d)\|16px\|rgba\(0, 0, 0, 0\)\|/.test(r.acts[0]), r.acts);
    ok("P-25 the phone number as Swedes write it: 'Ring 0240-101 00' (the link keeps +46)", r.tel === "Ring 0240-101 00" && /tel:\+4624010100$/.test(r.telHref || ""), [r.tel, r.telHref]);
    await page.evaluate(async () => { document.querySelector("details.pn-bs-rep > summary").click(); await new Promise((x) => setTimeout(x, 300)); });
    const r2 = await page.evaluate(() => [...document.querySelectorAll("details.pn-bs-rep [data-evrep], details.pn-bs-rep [data-gone]")].map((e) => Math.round(e.getBoundingClientRect().height)));
    ok("P-07 'Rapportera fel' opens to the 2 choices (≥ 44 px)", r2.length === 2 && r2.every((h) => h >= 44), r2);
    await shot(page, "2-pitchers-mer");
    // P-06 Lägg till = the hoursvote fix sheet
    await page.evaluate(() => document.querySelector(".pn-bs-info .oh-none [data-hva='fix']").click()); await wait(page, 1200);
    const fx = await page.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? (s.querySelector("h2") || {}).textContent : null; });
    ok("P-06 [Lägg till] opens 'Rätta öppettiderna'", /Rätta öppettiderna/.test(fx || ""), fx);
    await page.evaluate(() => { try { PN.closeSheet(); } catch (e) {} }); await wait(page, 500);
    // P-25 live: the weather value repainted by ute.js ("🌨 -2°") reads "Ute nu -2°"
    await bar(page, PITCHERS);
    const u = await page.evaluate(async () => {
      const l = document.querySelector(".leaflet-popup .pn-bs7 .ute-line"); if (!l) return "no ute line";
      let w = l.querySelector(".ute-wx"); if (!w) { w = document.createElement("span"); w.className = "ute-wx"; l.appendChild(w); }
      w.textContent = "\u{1F328}️ -2°"; await new Promise((r) => setTimeout(r, 1200));
      return w.textContent;
    });
    ok("P-25 a bare temperature on Uteservering reads 'Ute nu -2°' (not like a status)", u === "Ute nu -2°", u);
    // with hours: the first Info row is the open / closed line, and "Fel tider?" is back
    await bar(page, PITCHERS, WEEK);
    const h = await page.evaluate(() => {
      const bs = document.querySelector(".leaflet-popup .bs.pn-bs7"), sp = bs && bs.querySelector(".pn-bs-info .bi-line > span");
      return { first: sp ? sp.className + ": " + sp.textContent.trim() : null, none: !!bs.querySelector(".oh-none"), fel: !!bs.querySelector("[data-bia='close']") };
    });
    ok("P-06 with hours: Info, first row = 'Öppet till …' / 'Stängt …'; 'Fel tider?' is there", h.first && /^oh-(open|shut|soon): (Öppet|Stängt|Stänger)/.test(h.first) && !h.none && h.fel, h);
    });

    await step(page, "P-25 La Parma", async () => {
    // ---------- P-25 La Parma: friends with a hero row are not drawn again; the care line ----------
    await bar(page, PARMA);
    const p = await page.evaluate(async () => {
      const bs = document.querySelector(".leaflet-popup .bs.pn-bs7"), d = bs.querySelector('details[data-fold="here"]'); if (d) d.open = true;
      await new Promise((r) => setTimeout(r, 700));
      const hero = [...bs.querySelectorAll(".pn-bs-fr2 .pn-bs-ft > b")].map((b) => b.textContent.trim());
      const wall = [...bs.querySelectorAll(".pn-fh-wall .pn-fh-fr")].filter((t) => t.getClientRects().length).map((t) => (t.querySelector(".pn-fh-n") || {}).textContent);
      return { hero, wall, care: (bs.querySelector(".pp-care1") || {}).textContent || null, lv: !!bs.querySelector(".pp-lv"), careCol: bs.querySelector(".pp-care1") ? getComputedStyle(bs.querySelector(".pp-care1")).color : null };
    });
    ok("P-25 friends listed once: hero rows (Chatta + Skål) and not again in the Folk här wall", p.hero.length >= 2 && !p.wall.some((n) => p.hero.includes(n)), p);
    ok("P-25 the 10+ care line says who to check on: 'Kolla till Oskar ikväll.' (no level name, no link colour)", p.care === "Kolla till Oskar ikväll." && !p.lv && !/159, 211, 255|169, 216, 255/.test(p.careCol), p);
    await shot(page, "3-parma");
    await page.evaluate(() => { try { window.__map.closePopup(); } catch (e) {} }); await wait(page, 400);
    });

    await step(page, "P-28 Topplista", async () => {
    // ---------- P-28 Topplista ----------
    await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Topplista/.test(x.getAttribute("aria-label") || "")).click()); await wait(page, 2000);
    const t = await page.evaluate(() => [...document.querySelectorAll("ol.toplist .top-row")].map((r) => ({ fr: r.classList.contains("friend"), tag: (r.querySelector(".bd-frtag") || {}).textContent || "", svg: !!r.querySelector(".bd-frtag svg") })));
    ok("P-28 a green bar name says why: 'Vänner här' + icon (colour is not the only sign)", t.some((x) => x.fr) && t.every((x) => x.fr ? x.tag === "Vänner här" && x.svg : x.tag === ""), t);
    await shot(page, "4-top");
    await page.evaluate(() => { try { PN.closeSheet(); } catch (e) {} }); await wait(page, 500);
    });

    await step(page, "P-20 Sök", async () => {
    // ---------- P-20 Sök → Krogar, empty field ----------
    await page.evaluate(() => { localStorage.removeItem("olnu.barsearch.recent"); localStorage.setItem("olnu.barsearch.tab", "bars"); document.getElementById("pn-search").click(); }); await wait(page, 1200);
    const s = await page.evaluate(() => ({ head: [...document.querySelectorAll("#bs-list .bs-h")].map((x) => x.textContent), rows: [...document.querySelectorAll("#bs-list .bs-hit.bs-near")].map((b) => b.textContent.trim()),
      msg: (document.querySelector(".bs-msg") || {}).textContent }));
    ok("P-20 empty Krogar: the hint + 'Nära dig' with the 5 nearest bars (distance, crowd word)", s.head[0] === "Nära dig" && s.rows.length === 5 && s.rows.every((x) => /\d+ (m|km)/.test(x)) && s.rows.some((x) => /Livligt|Lugnt|Packat/.test(x)) && /Skriv namnet/.test(s.msg || ""), s);
    await shot(page, "5-krogar");
    await page.keyboard.press("Escape"); await wait(page, 500);
    await page.evaluate(() => { localStorage.setItem("olnu.barsearch.recent", JSON.stringify([{ n: "Pitchers", lat: 60.14997, lng: 15.18679, k: "b" }])); document.getElementById("pn-search").click(); }); await wait(page, 1200);
    const s2 = await page.evaluate(() => [...document.querySelectorAll("#bs-list .bs-h")].map((x) => x.textContent));
    ok("P-20 with recent picks: 'Senaste' first, then 'Nära dig'", s2.join("|") === "Senaste|Nära dig", s2);
    });

    await step(page, "P-11 Öl list", async () => {
    // ---------- P-11 Öl list ----------
    await page.evaluate(() => { localStorage.setItem("olnu.barsearch.tab", "beer"); document.getElementById("pn-search").click(); }); await wait(page, 1200);
    await page.evaluate(() => { const b = document.querySelector('[data-bs-tab="beer"]'); if (b) b.click(); }); await wait(page, 2500);
    const l = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#bs-beer .bl-list .bl-row")].map((r) => ({ n: r.querySelector("b").textContent, br: (r.querySelector("small") || {}).textContent || "", t: r.textContent, chip: !!r.querySelector(".bl-guess") }));
      return { rows, note: (document.querySelector("#bs-beer .bl-guess-n") || {}).textContent || null };
    });
    // same name words (any order, "beer" in any language left out) AND the same brewery = the same beer (the build's rule)
    const core = (x) => x.n.toLowerCase().replace(/[^a-z0-9åäöéü ]+/g, " ").split(/\s+/).filter((w) => w && !/^(beer|bier|biere|bière|birra|cerveza|öl|olut|alus)$/.test(w)).sort().join(" ") + "@" + x.br.toLowerCase();
    const dup = l.rows.map(core).filter((k, i, a) => a.indexOf(k) !== i);
    ok("P-11 the browse list has no beer twice by name ('Heineken' / 'Heineken Bier' / 'Beer Heineken')", l.rows.length >= 20 && !dup.length, dup);
    ok("P-11 a guessed style = a small '?' chip, explained once above the list; no '(gissning)' on the rows", l.rows.some((x) => x.chip) && !l.rows.some((x) => /gissning/.test(x.t)) && /stilen är en gissning/.test(l.note || ""), { note: l.note, r: l.rows.slice(0, 3) });
    await shot(page, "6-ol");
    // search "heineken": the plain Heineken once (it was 12 rows: "Heineken", "Heineken Bier", "Beer Heineken", "Heineken st 330" ...)
    await page.fill("#bs-q", "heineken"); await wait(page, 1500);
    const hk = await page.evaluate(() => [...document.querySelectorAll("#bs-beer .bl-row b")].map((b) => b.textContent)
      .filter((n) => n.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !/^(beer|bier|biere|bi|re|birra|cerveza|alus|st|330|pack|x\d+)$/.test(w)).join(" ") === "heineken"));
    ok("P-11 search 'heineken': the plain Heineken is ONE row", hk.length === 1, hk);
    await page.keyboard.press("Escape"); await wait(page, 600);
    });

    await step(page, "P-26 beer page", async () => {
    // ---------- P-26 beer page ----------
    const hk = BEERS.rows.find((x) => x[1] === "Mariestads Export");
    await page.evaluate(async (id) => { await PN.beerlib(); window.BEERLIB.beer(id); }, hk[0]); await wait(page, 2500);
    const bp = await page.evaluate(() => {
      const b = document.getElementById("sheet-body"), t = b.innerText;
      return { data: (t.match(/Data: Open Food Facts/g) || []).length, old: /Bilden är CC BY-SA/.test(t), about: b.querySelectorAll(".bl-about").length, src: !!b.querySelector(".bl-src .bl-about"),
        none: (b.querySelector(".bl-none-t") || {}).textContent || null, row: [...b.querySelectorAll(".bl-ext b")].map((x) => x.textContent),
        now: b.querySelector("[data-bl-now]") ? { pni: !!b.querySelector("[data-bl-now] > svg"), can: !!b.querySelector("[data-bl-now] .mb-now-ic") } : null };
    });
    ok("P-26 one data line with 'Om data' in it (no second 'Data: … Bilden är CC BY-SA' line)", bp.data === 1 && !bp.old && bp.about === 1 && bp.src, bp);
    ok("P-26 no average yet = a calm empty state ('3 betyg än. Snittet visas från 5 betyg.'), not a 'PintsNow' row", bp.none === "3 betyg än. Snittet visas från 5 betyg." && !bp.row.includes("PintsNow"), bp);
    ok("P-26 'Jag dricker den här' uses the app icon like the other buttons", !bp.now || (bp.now.pni && !bp.now.can), bp.now);
    await shot(page, "7-beerpage");
    await page.evaluate(() => { try { PN.closeSheet(); } catch (e) {} }); await wait(page, 600);
    });

    await step(page, "P-14 favourite from Profil", async () => {
    // ---------- P-14 favourite from Profil ----------
    await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1500);
    await page.waitForFunction(() => document.querySelector('.bl-ft.empty[data-bl-slot="1"]'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('.bl-ft.empty[data-bl-slot="1"]').click()); await wait(page, 2500);
    const f1 = await page.evaluate(() => ({ bar: (document.querySelector("#bs-beer .bl-pickbar b") || {}).textContent || null, rows: document.querySelectorAll("#bs-beer .bl-row").length, add: document.querySelectorAll("#bs-beer [data-bl-add]").length }));
    ok("P-14 'Välj Favorit 1' opens the pick for slot 1 at once (no extra 'Lägg till' tap)", f1.bar === "Välj favorit nr 1" && f1.rows > 0 && f1.add === 0, f1);
    await shot(page, "8-pick");
    const pickId = await page.evaluate(() => { const r = document.querySelectorAll("#bs-beer .bl-row")[2]; const id = r.getAttribute("data-bl-beer"); r.click(); return id; });
    await wait(page, 2500);
    const f2 = await page.evaluate(() => ({ search: !!document.getElementById("bs-beer"), title: (document.querySelector("#sheet:not([hidden]) h2") || {}).textContent || null,
      t1: (document.querySelector('.bl-fav .bl-ft[data-bl-beer]') || { getAttribute: () => null }).getAttribute("data-bl-beer") }));
    ok("P-14 after the save: back in Profil (Sök closed), slot 1 shows the beer", !f2.search && f2.title === "Profil" && f2.t1 === pickId, { f2, pickId });
    await shot(page, "9-profil");
    // Avbryt goes back too
    await page.evaluate(() => document.querySelector('.bl-ft.empty[data-bl-slot="2"]').click()); await wait(page, 2500);
    await page.evaluate(() => document.querySelector("#bs-beer [data-bl-pickx]").click()); await wait(page, 2000);
    const f3 = await page.evaluate(() => ({ search: !!document.getElementById("bs-beer"), title: (document.querySelector("#sheet:not([hidden]) h2") || {}).textContent || null }));
    ok("P-14 Avbryt in that pick goes back to Profil", !f3.search && f3.title === "Profil", f3);
    });

    ok("no page errors", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nsweepC: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
