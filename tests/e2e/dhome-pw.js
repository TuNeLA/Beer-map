// dhome-pw.js — lane d-home, I-114 proposal 03 (owner 15 Nov 2026: "I like that menu a lot more"): the "Ta dig hem" sheet =
// ONE amber call button (tel:), then rows of ONE style (icon, title, one sub-line, chevron), then the safety group.
// Code: docs/js/rundan.js (taxiSheet, homeRow), docs/js/hemfolj.js (taxiNode row, fresh fix at walk start), docs/js/safety.js
// (homeSafety), docs/js/extras.js (showTaxi), docs/rundan.css (.hs-*). Mocked Supabase (port B). Usage: node dhome-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const GID = "11111111-2222-3333-4444-555555555555";
const HOME = { lat: 60.1452, lng: 15.1801, r: 300, at: Date.now() };
const MORA = [61.007, 14.543], STHLM = [59.3293, 18.0686], NYK = [58.753, 17.0079];

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, o.vp || { width: 390, height: 844 }, { lang: o.lang });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); localStorage.setItem("olnu.store", "1"); } catch (e) {} });
  if (o.home) await ctx.addInitScript((h) => { try { localStorage.setItem("olnu.home", JSON.stringify(h)); } catch (e) {} }, HOME);
  if (o.at) await ctx.setGeolocation({ latitude: o.at[0], longitude: o.at[1] });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.RUNDAN && window.EXTRAS && window.HEMFOLJ && window.SAFETY && document.getElementById("btn-taxi"), null, { timeout: 15000 }).catch(() => console.log("modules missing"));
  if (o.at) { await page.evaluate((c) => window.__map.setView(c, 15, { animate: false }), o.at); await wait(page, 1200); }
  return { ctx, page, errs };
}
const close = async (page) => { await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); }); await wait(page, 350); };
// what is on the sheet now
const snap = (page) => page.evaluate(() => {
  const s = document.getElementById("sheet"), b = document.getElementById("sheet-body");
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none"; };
  const row = (e) => ({ tag: e.tagName, t: (e.querySelector(".ds-row-t>span") || {}).textContent || "", sub: (e.querySelector(".ds-row-t>small") || {}).textContent || "", href: e.getAttribute("href"),
    icon: !!e.querySelector(".ds-row-i svg"), chev: !!e.querySelector(".ds-chev"), vis: vis(e) });
  const call = [...b.querySelectorAll(".hs-call")];
  const tap = [...s.querySelectorAll("a,button,summary,[role=button],input,select")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.className || e.id || e.tagName) + "", w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right) }; });
  const text = s.innerText || "";
  return { open: !s.hidden, title: document.getElementById("sheet-title").textContent.trim(), calls: call.length, amber: [...b.querySelectorAll(".btn-amber")].filter(vis).length,
    callHref: call[0] && call[0].getAttribute("href"), callText: call[0] && call[0].textContent.replace(/\s+/g, " ").trim(), callTarget: call[0] && call[0].getAttribute("target"),
    rows: [...b.querySelectorAll(".hs .hs-list .hs-row")].map(row), safe: [...b.querySelectorAll(".hs-safe .hs-row")].map(row),
    safeH: (b.querySelector("h3.hs-h") || {}).textContent || "", old: b.querySelectorAll(".rnd-taxirow, .hf-taxi-row, details.rnd-more, .sf-112-btn, .taxi-row").length,
    looks: [...new Set([...b.querySelectorAll("a,button")].filter(vis).map((e) => e.classList.contains("hs-row") ? "row" : e.classList.contains("hs-call") ? "call" : "other:" + e.className))],
    emoji: (text.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu) || []).join(""), text: text.replace(/\s+/g, " ").slice(0, 400),
    small: tap.filter((x) => x.h < 44 || x.w < 44), out: tap.filter((x) => x.l < 0 || x.r > innerWidth), hscroll: [b.scrollWidth - b.clientWidth, document.documentElement.scrollWidth - innerWidth] };
});
const titles = (rows) => rows.filter((r) => r.vis).map((r) => r.t);

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- 1. Ludvika, no home: the picture ---------- */
    let { ctx, page, errs } = await open(browser);
    const ways = { "#btn-taxi": () => page.evaluate(() => document.getElementById("btn-taxi").click()),
      "HUD chip .hx-taxi": () => page.evaluate(() => { const c = document.querySelector(".hx-taxi"); if (c) c.click(); else window.EXTRAS.hudClick("taxi"); return !!c; }),
      'EXTRAS.hudClick("taxi")': () => page.evaluate(() => window.EXTRAS.hudClick("taxi")),
      "⋯ Mer → Taxi hem": async () => { await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 500);
        await page.evaluate(() => { const r = document.querySelector('#sheet-body .pn-row[data-src="btn-taxi"]'); if (r) r.click(); }); } };
    const WANT = ["Följ mig hem", "Dela taxin", "Spara hemadress", "Fler taxibolag"];
    let s = null;
    for (const [name, go] of Object.entries(ways)) {
      await go(); await wait(page, 900);
      s = await snap(page);
      ok(`entry ${name}: new sheet, ONE amber call button with a tel: href`, s.open && /^Ta dig hem/.test(s.title) && s.calls === 1 && s.amber === 1 && s.callHref === "tel:+4624013900" && s.old === 0, s);
      ok(`entry ${name}: rows = ${WANT.join(" · ")} + safety Ring 112 · SOS till gruppen`, JSON.stringify(titles(s.rows)) === JSON.stringify(WANT) && JSON.stringify(titles(s.safe)) === JSON.stringify(["Ring 112", "SOS till gruppen"]), { rows: titles(s.rows), safe: titles(s.safe) });
      await close(page);
    }
    await ways["#btn-taxi"](); await wait(page, 900); s = await snap(page);
    ok("primary says who and the number: Ring Ludvikataxi 0240-139 00", /^Ring Ludvikataxi\s*0240-139 00$/.test(s.callText), s.callText);
    ok("one row style: every row has an icon, a title, one sub-line and a chevron; only 'call' and 'row' looks in the sheet", s.rows.concat(s.safe).every((r) => r.icon && r.t && r.sub && r.chev) && s.looks.sort().join() === "call,row", { looks: s.looks, rows: s.rows });
    ok("safety is a group of its own: 'Om något händer', Ring 112 = tel:112", s.safeH === "Om något händer" && s.safe[0].href === "tel:112" && s.safe[0].tag === "A", s.safe);
    ok("no emoji in the sheet's visible text", s.emoji === "", { emoji: s.emoji, text: s.text });
    ok("every target is at least 44 px", s.small.length === 0, s.small);
    ok("390: nothing outside the screen, no sideways scroll", s.out.length === 0 && s.hscroll.every((v) => v <= 0), { out: s.out, hs: s.hscroll });
    // function count: before = Följ mig hem, taxi, Spara hemadress, Fler taxibolag (2 numbers), Dela taxin, Ring 112, SOS = 9 controls
    const all = s.calls + s.rows.length + s.safe.length;
    ok("same 9 functions as the old sheet (1 call + 4 rows + 2 more numbers + 112 + SOS)", all === 9, { all, rows: s.rows.map((r) => r.t) });

    // each row does its old job
    const more = await page.evaluate(() => {
      const m = document.querySelector("#sheet-body .hs-more"), sub = () => [...document.querySelectorAll("#sheet-body .hs-sub")].map((e) => ({ href: e.getAttribute("href"), hid: e.hidden || getComputedStyle(e).display === "none", h: Math.round(e.getBoundingClientRect().height), t: e.textContent.replace(/\s+/g, " ").trim() }));
      const a = sub(); m.click(); const b = sub(), ex = m.getAttribute("aria-expanded"); return { a, b, ex, sub: (m.querySelector("small") || {}).textContent };
    });
    ok("Fler taxibolag: says the towns, a tap opens 2 more numbers as tel: rows (44 px+)", more.sub === "Borlänge, Falun" && more.a.every((x) => x.hid) && more.ex === "true" && more.b.length === 2 && more.b.every((x) => !x.hid && x.h >= 44) &&
      more.b[0].href === "tel:+4624313100" && more.b[1].href === "tel:+462315300" && /0243-131 00/.test(more.b[0].t), more);
    s = await snap(page);
    ok("Fler taxibolag open: still no emoji, 44 px, one row style", s.emoji === "" && s.small.length === 0 && s.looks.sort().join() === "call,row", { e: s.emoji, small: s.small, looks: s.looks });
    const again = await page.evaluate(() => { const m = document.querySelector("#sheet-body .hs-more"); m.click(); return [m.getAttribute("aria-expanded"), [...document.querySelectorAll("#sheet-body .hs-sub")].every((e) => e.hidden)]; });
    ok("Fler taxibolag: a second tap closes it", again[0] === "false" && again[1] === true, again);

    const hz = await page.evaluate(() => { let n = 0; const keep = window.HOMEZONE.open; window.HOMEZONE.open = function () { n++; };
      document.querySelector("#sheet-body .rnd-savehome").click(); window.HOMEZONE.open = keep; return n; });
    ok("Spara hemadress opens the home zone (HOMEZONE.open)", hz === 1, hz);

    // SOS: the row asks first (social.js), "Ja, skicka" sends the sos event
    const q = await page.evaluate(() => { document.querySelector("#sheet-body .hs-sosrow").click(); const c = document.querySelector("#sheet-body .hs-sos .confirm");
      return { q: !!c, t: c ? c.textContent.replace(/\s+/g, " ") : "", btn: c ? [...c.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height)) : [], hiddenBtn: getComputedStyle(document.querySelector("#sheet-body .hs-sos .sos-btn")).display };
    });
    ok("SOS till gruppen: the row opens the question (no send on the first tap), buttons 44 px+", q.q && /Skicka din exakta plats/.test(q.t) && q.btn.length === 2 && q.btn.every((h) => h >= 44) && q.hiddenBtn === "none", q);
    s = await snap(page);
    ok("SOS question open: no emoji, 44 px", s.emoji === "" && s.small.length === 0, { e: s.emoji, small: s.small });
    const sosReq = page.waitForRequest((r) => /functions\/v1\/notify-group/.test(r.url()) && /"sos"/.test(r.postData() || ""), { timeout: 15000 }).then(() => true, () => false);
    await page.evaluate(() => { const c = document.querySelector("#sheet-body .hs-sos .confirm"); const b = c && [...c.querySelectorAll("button")].find((x) => x.classList.contains("btn-danger")); if (b) b.click(); });
    ok("SOS: 'Ja, skicka' sends the sos event to the group (notify-group)", await sosReq);
    await wait(page, 600); await close(page);

    // Dela taxin → the split sheet (2 groups in the mock = the group question)
    await ways["#btn-taxi"](); await wait(page, 900);
    await page.evaluate(() => document.querySelector("#sheet-body .hs-split").click()); await wait(page, 1500);
    const sp = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, body: document.getElementById("sheet-body").textContent.slice(0, 120) }));
    ok("Dela taxin opens the taxi split (old splitTaxi)", /Dela taxin/.test(sp.title) && /Vilken grupp delar taxin/.test(sp.body), sp);
    await close(page); await close(page);

    // Följ mig hem → the start sheet
    await ways["#btn-taxi"](); await wait(page, 900);
    await page.evaluate(() => document.querySelector("#sheet-body .hf-taxi").click()); await wait(page, 1200);
    const fs = await page.evaluate(() => { const b = document.getElementById("sheet-body"), ps = [...b.querySelectorAll("p")].map((p) => p.textContent).join(" | ");
      return { title: document.getElementById("sheet-title").textContent, lead: !!b.querySelector(".hf-lead"), emoji: (ps.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu) || []).join(""), ps: ps.slice(0, 300) }; });
    ok("Följ mig hem opens its start sheet (old openStart)", /Följ mig hem/.test(fs.title) && fs.lead, fs);
    ok("Följ mig hem start: no emoji in the body paragraphs (design report small fix 23)", fs.emoji === "", fs);
    await close(page); await close(page);
    ok("no page errors (Ludvika)", errs.length === 0, errs);
    await ctx.close();

    /* ---------- 2. with a saved home: Uber hem + Ändra hemadress; fresh fix at walk start ---------- */
    ({ ctx, page, errs } = await open(browser, { home: true }));
    await page.evaluate(() => document.getElementById("btn-taxi").click()); await wait(page, 900);
    s = await snap(page);
    const uber = s.rows.find((r) => r.t === "Uber hem");
    ok("home saved: rows = Följ mig hem · Uber hem · Dela taxin · Ändra hemadress · Fler taxibolag", JSON.stringify(titles(s.rows)) === JSON.stringify(["Följ mig hem", "Uber hem", "Dela taxin", "Ändra hemadress", "Fler taxibolag"]) && s.calls === 1 && s.amber === 1, titles(s.rows));
    ok("Uber hem = the Uber link with pickup here and drop-off home", !!uber && /m\.uber\.com/.test(uber.href) && /pickup=my_location/.test(uber.href) && /dropoff/.test(uber.href), uber);
    ok("Ändra hemadress shows the distance home", /^Hem: .*(m|km) fågelvägen$/.test((s.rows.find((r) => r.t === "Ändra hemadress") || {}).sub || ""), s.rows);
    ok("home saved: no emoji, 44 px", s.emoji === "" && s.small.length === 0, { e: s.emoji, small: s.small });
    // the walk start: a NEW fix (maximumAge 0), the sheet stays usable while it waits
    await page.route(/rest\/v1\/rpc\/friend_list/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, people: [{ key: "k1", name: "Lisa", friend: true, groups: [{ id: GID, name: "Ludvika Lager" }] }], groups: [{ id: GID, name: "Ludvika Lager", n: 3 }] }) }));
    let walkStarts = 0, walkBody = null;
    await page.route(/rest\/v1\/rpc\/walk_start/, (r) => { walkStarts++; try { walkBody = JSON.parse(r.request().postData() || "{}"); } catch (e) {} return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "slow_down" }) }); });
    await page.evaluate(() => {
      window.__geo = []; window.__geoCb = null;
      // every ask is recorded; the background "warm" ask of fastpos.js (timeout 20000) is not the walk's ask
      navigator.geolocation.getCurrentPosition = function (res, rej, opts) { opts = opts || {}; if (opts.timeout === 20000) return; window.__geo.push({ hi: opts.enableHighAccuracy, age: opts.maximumAge, to: opts.timeout }); window.__geoCb = res; };
      // a kept exact fix (30 s old): the default getPosition() answers with it and never asks the browser for a new one
      window.FASTPOS.last = { pos: { coords: { latitude: 60.15, longitude: 15.18, accuracy: 10 }, timestamp: Date.now() - 30000 }, at: Date.now() - 30000 };
    });
    await page.evaluate(() => document.querySelector("#sheet-body .hf-taxi").click()); await wait(page, 1500);
    const picked = await page.evaluate(() => { const c = document.querySelector("#sheet-body .hf-people input[data-k]"); if (c) c.click(); const g = document.querySelector("#sheet-body .hf-go"); return { c: !!c, dis: g && g.disabled }; });
    await page.evaluate(() => { window.__geo = []; document.querySelector("#sheet-body .hf-go").click(); }); await wait(page, 400);
    const w1 = await page.evaluate(() => ({ geo: window.__geo, txt: document.querySelector("#sheet-body .hf-go").textContent, closeOk: !document.getElementById("sheet-close").disabled, open: !document.getElementById("sheet").hidden }));
    ok("walk start asks the browser for a NEW exact fix: {enableHighAccuracy: true, maximumAge: 0, timeout: 12000}", picked.c && w1.geo.length === 1 && w1.geo[0] && w1.geo[0].hi === true && w1.geo[0].age === 0 && w1.geo[0].to === 12000, { picked, w1 });
    ok("while it waits: the button says so, the sheet is still open and can be closed, nothing is sent yet", /position/i.test(w1.txt) && w1.open && w1.closeOk && walkStarts === 0, { w1, walkStarts });
    await page.evaluate(() => { if (window.__geoCb) window.__geoCb({ coords: { latitude: 60.1511, longitude: 15.1876, accuracy: 8 }, timestamp: Date.now() }); }); await wait(page, 900);
    ok("the fix comes → walk_start goes out with that position", walkStarts === 1 && walkBody && Math.abs(walkBody.p_lat - 60.1511) < 1e-6 && walkBody.p_acc === 8, { walkStarts, walkBody });
    // closed while waiting = no walk starts behind my back
    await wait(page, 600);
    const again2 = await page.evaluate(() => { const g = document.querySelector("#sheet-body .hf-go"); if (!g) return "no button"; g.disabled = false; g.click(); return "ok"; }); await wait(page, 300);
    await page.evaluate(() => { document.getElementById("sheet-close").click(); }); await wait(page, 400);
    await page.evaluate(() => { document.getElementById("sheet-close").click(); }); await wait(page, 400);
    await page.evaluate(() => { if (window.__geoCb) window.__geoCb({ coords: { latitude: 60.1511, longitude: 15.1876, accuracy: 8 }, timestamp: Date.now() }); }); await wait(page, 700);
    ok("sheet closed while the fix was on its way → no walk starts", again2 === "ok" && walkStarts === 1, { again2, walkStarts });
    ok("no page errors (home)", errs.length === 0, errs);
    await ctx.close();

    /* ---------- 3. a town without a taxi number (Mora): the amber button is the map search ---------- */
    ({ ctx, page, errs } = await open(browser, { at: MORA }));
    await page.evaluate(() => document.getElementById("btn-taxi").click()); await wait(page, 900);
    s = await snap(page);
    ok("Mora (no verified taxi): ONE amber button = 'Hitta taxi nära dig', a real link to the map search at my position", s.calls === 1 && s.amber === 1 && /^Hitta taxi nära dig/.test(s.callText) &&
      /^https:\/\/www\.google\.com\/maps\/search\/taxi\/@61\.00\d+,14\.54\d+,14z$/.test(s.callHref || "") && s.callTarget === "_blank", s);
    ok("Mora: no phone number that we do not know (only tel:112), no 'Fler taxibolag' row, rest of the rows stay", !s.rows.some((r) => /^tel:/.test(r.href || "")) && JSON.stringify(titles(s.rows)) === JSON.stringify(["Följ mig hem", "Dela taxin", "Spara hemadress"]) && titles(s.safe).length === 2, titles(s.rows));
    ok("Mora: no emoji, 44 px, nothing outside", s.emoji === "" && s.small.length === 0 && s.out.length === 0, { e: s.emoji, small: s.small, out: s.out });
    await close(page);
    // the taxi file not there (lazy file failed): still a working amber button
    await page.evaluate(() => { window.__map.setView([60.1505, 15.1872], 15, { animate: false }); window.TAXI_DATA = null; document.getElementById("btn-taxi").click(); }); await wait(page, 900);
    s = await snap(page);
    ok("no taxi data at all: the amber button is still a working link (map search)", s.calls === 1 && /^https:\/\/www\.google\.com\/maps\/search\/taxi\//.test(s.callHref || ""), s.callHref);
    ok("no page errors (Mora)", errs.length === 0, errs);
    await ctx.close();

    /* ---------- 4. 360 x 640: fits sideways; a long taxi name wraps ---------- */
    for (const [town, at, re] of [["Ludvika", null, /Ring Ludvikataxi/], ["Nyköping (long name)", NYK, /Ring Taxi Nyköping Oxelösund\s*0155-21 75 00/], ["Mora", MORA, /Hitta taxi/]]) {
      ({ ctx, page, errs } = await open(browser, { vp: { width: 360, height: 640 }, at }));
      await page.evaluate(() => document.getElementById("btn-taxi").click()); await wait(page, 900);
      await page.evaluate(() => { const m = document.querySelector("#sheet-body .hs-more"); if (m) m.click(); });
      s = await snap(page);
      ok(`360x640 ${town}: primary shown, no sideways scroll, nothing outside, 44 px, no emoji`, re.test(s.callText) && s.hscroll.every((v) => v <= 0) && s.out.length === 0 && s.small.length === 0 && s.emoji === "", { t: s.callText, hs: s.hscroll, out: s.out, small: s.small, e: s.emoji });
      const reach = await page.evaluate(() => { const b = document.getElementById("sheet-body"); b.scrollTop = 99999; const l = b.querySelector(".hs-sosrow").getBoundingClientRect(); return l.bottom <= innerHeight + 1 && l.top >= 0; });
      ok(`360x640 ${town}: the last row (SOS) can be scrolled into view`, reach);
      await ctx.close();
    }

    /* ---------- 5. Stockholm with home: Bolt row; store build = the same sheet; English ---------- */
    ({ ctx, page, errs } = await open(browser, { at: STHLM, home: true }));
    await page.evaluate(() => document.getElementById("btn-taxi").click()); await wait(page, 900);
    s = await snap(page);
    const bolt = s.rows.find((r) => r.t === "Bolt");
    ok("Stockholm: Ring Taxi Stockholm + a Bolt row (link to bolt.eu)", /^Ring Taxi Stockholm\s*08-15 00 00$/.test(s.callText) && s.callHref === "tel:+468150000" && !!bolt && /^https:\/\/bolt\.eu\//.test(bolt.href), { t: s.callText, bolt });
    await ctx.close();

    ({ ctx, page, errs } = await open(browser, { store: true }));
    const isStore = await page.evaluate(() => !!(window.SAFETY && window.SAFETY.store && window.SAFETY.store()));
    await page.evaluate(() => document.getElementById("btn-taxi").click()); await wait(page, 900);
    s = await snap(page);
    ok("store build: the same sheet (call button, rows, safety group)", isStore && s.calls === 1 && s.callHref === "tel:+4624013900" && JSON.stringify(titles(s.rows)) === JSON.stringify(WANT) && titles(s.safe).length === 2, { isStore, rows: titles(s.rows), safe: titles(s.safe) });
    await ctx.close();

    // The app is Swedish only today (i18n.js: a stored "en" is ignored). The English texts are there for the day it comes back:
    // the test turns the language getter to "en" by hand.
    ({ ctx, page, errs } = await open(browser));
    await page.evaluate(() => { Object.defineProperty(window.I18N, "lang", { configurable: true, get: () => "en" }); document.getElementById("btn-taxi").click(); }); await wait(page, 900);
    s = await snap(page);
    ok("English: Call Ludvikataxi, English rows, no emoji", /^Call Ludvikataxi\s*0240-139 00$/.test(s.callText) && JSON.stringify(titles(s.rows)) === JSON.stringify(["Walk me home", "Split the taxi", "Save home address", "More taxi firms"]) &&
      JSON.stringify(titles(s.safe)) === JSON.stringify(["Call 112", "SOS to my group"]) && s.safeH === "If something happens" && s.emoji === "", { t: s.callText, rows: titles(s.rows), safe: titles(s.safe), h: s.safeH, e: s.emoji });
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log(`dhome: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
