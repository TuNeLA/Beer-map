// folkhar-pw.js — "Folk här" face wall + tap menu (I-120 / I-122, design4 D "Ansiktsväggen"; js/app-crowd.js folkWallHTML).
// Checks: order = crowdSort (never by count) · group label = first shared group (+N) or "Vän" (no shared_groups = old server)
// · strangers: no name, no group, no number · count badge only on named friends (not me, not strangers; also in store builds)
// · all targets >= 44 · tap = menu (Skåla, Visa profil, Skriv till X) · stranger menu: only Skåla, no name / number
// · scrim tap / Esc / back close only the menu (sheet stays) · skål = "Skålat med X", closes by itself, no clink / pop
// · 8+ named = 7 faces + "Visa alla" (crowd list rows get the group label) · only strangers · me alone (+ Bjud hit gänget).
// Fails on the old code (no .pn-fh wall). Mocked Supabase (ds-helpers): poll_v2 is "missing" there, so rows come from
// live_beers; the client reads shared_groups the same way from both. 390 × 844 @2x.
// usage: node folkhar-pw.js <port>      FH_SHOTS=<dir> also saves the review pictures there.
const { chromium } = require("playwright");
const H = require("./ds-helpers.js");
const { wait } = H;
const SHOTS = process.env.FH_SHOTS || "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const PITCH = [60.14997, 15.18679], BAR_ID = "n3472634175";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
// groups: ids of the mocked my_groups (same colour as the Grupper list) + one more
const G = {
  lager: { id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" },
  jobb: { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet" },
  klatter: { id: "a0000004-2222-3333-4444-555555555555", name: "Klättergänget" },
};
let pid = 7000;
const me = (n, sk) => ({ id: pid++, lat: PITCH[0], lng: PITCH[1], beer_count: n, precise: true, created_at: iso(150), is_mine: true, friend_name: null, skal_count: sk || 0, i_skaled: false, bar_id: BAR_ID, snap: "bar" });
// g = keys of G; null = no shared_groups field at all (old server)
const fr = (name, n, m, g, o = {}) => Object.assign({ id: pid++, lat: PITCH[0] + 0.00002, lng: PITCH[1] - 0.00002, beer_count: n, precise: true, created_at: iso(m), is_mine: false, friend_name: name, skal_count: 0, i_skaled: false, bar_id: BAR_ID, snap: "bar" },
  g ? { shared_groups: g.map((k) => G[k]) } : {}, o);
const st = (n, m, o = {}) => Object.assign({ id: pid++, lat: PITCH[0] - 0.00002, lng: PITCH[1] + 0.00001, beer_count: n, precise: true, created_at: iso(m), is_mine: false, friend_name: null, skal_count: 0, i_skaled: false, bar_id: BAR_ID, snap: "bar" }, o);
const SCEN = {
  // Kalle: the most drinks, came last, no shared group (old server style: no field) → last friend, "Vän"
  mix: () => [me(6, 2), fr("Lisa", 2, 120, ["lager"]), fr("Ida", 3, 100, ["lager", "klatter"], { skal_count: 1 }), fr("Sara", 4, 80, ["jobb"]), fr("Kalle", 9, 60, null),
    st(3, 70), st(2, 50), st(5, 40), st(1, 30), st(2, 20)],
  groups2: () => [me(4, 1), fr("Jonas", 2, 130, ["lager"]), fr("Emma", 3, 110, ["lager"]), fr("Oskar", 2, 95, ["jobb"]), fr("Nisse", 1, 85, ["jobb", "lager"]), fr("Sara", 4, 70, ["jobb"]), st(2, 40), st(3, 25)],
  many: () => [me(5, 3), fr("Kalle", 3, 140, ["lager"]), fr("Emma", 1, 130, ["lager"]), fr("Jonas", 4, 120, ["lager"]), fr("Sara", 2, 110, ["jobb"]),
    fr("Nisse", 1, 100, ["jobb"]), fr("Oskar", 5, 90, ["lager", "jobb"]), fr("Lisa", 2, 80, ["lager"]), fr("Ida", 3, 70, ["klatter"]), fr("Hugo", 2, 60, []), fr("Maja", 1, 50, ["lager"]), st(2, 30), st(1, 20)],
  strangers: () => [st(3, 90), st(2, 70), st(5, 60), st(1, 45), st(2, 30), st(4, 20), st(1, 10)],
  me: () => [me(6, 2)],
};

async function open(browser, name, o = {}) {
  pid = 7000;
  const list = SCEN[name]();
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { checkin: name !== "strangers" });
  if (o.store) await ctx.addInitScript(() => { try { sessionStorage.setItem("olnu.store", "1"); window.OLNU_STORE = true; } catch (e) {} });
  const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  const srv = { skal: [] };
  await page.route(/rest\/v1\/rpc\/(live_beers|live_checkins|bar_kings|my_rallies|skal|skal_v2)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "live_beers") return J(r, list.map((b) => Object.assign({}, b)));
    if (fn === "skal" || fn === "skal_v2") { srv.skal.push(body); return J(r, { skal_count: 2, already: false }); }
    return J(r, []);
  });
  await ctx.setGeolocation({ latitude: PITCH[0], longitude: PITCH[1], accuracy: 10 });
  await H.boot(page);
  await H.closeSheet(page); await wait(page, 300);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  await page.evaluate((g) => window.__map.setView(g, 17, { animate: false }), PITCH); await wait(page, 2200);
  await page.evaluate((id) => {
    const ic = document.querySelector('.leaflet-marker-icon[data-bar="' + id + '"]') || [...document.querySelectorAll(".leaflet-marker-icon.cm")].find((x) => /Pitchers/.test(x.textContent));
    const p = ic && (ic.querySelector(".pill") || ic); if (p) p.click();
  }, BAR_ID);
  await wait(page, 1500);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="here"]'); if (d) d.open = true; });
  await wait(page, 600);
  return { ctx, page, list, srv };
}
// scroll the sheet so the Folk här card sits right under the sticky header (pictures + menu placement)
const frame = (page) => page.evaluate(() => {
  const d = document.querySelector('details[data-fold="here"]'); if (!d) return "no fold";
  let sc = d.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  const head = document.querySelector(".pn-bs7 .bs-head"); if (!sc) return "no scroller";
  // barcard I-133: the band header scrolls away; the 56 px name bar (.pn-bc-mini) is what stays on top
  const mini = document.querySelector(".pn-bc-mini"), hb = mini ? sc.getBoundingClientRect().top + 56 : (head ? head.getBoundingClientRect().bottom : 0);
  sc.scrollTop += d.getBoundingClientRect().top - (hb + 8); return "ok";
});
const shot = async (page, n) => { if (SHOTS) { await wait(page, 350); await page.screenshot({ path: SHOTS.replace(/\/?$/, "/") + n + ".png" }); } };
// the wall as data
const wall = (page) => page.evaluate(() => {
  const q = (s, r) => [...(r || document).querySelectorAll(s)];
  const W = document.querySelector(".pn-fh"); if (!W) return null;
  const small = q(".pn-fh button, .pn-fh [data-fh], .pn-fh [data-fh-all]").map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, w: r.width, h: r.height }; }).filter((x) => x.w && (x.w < 44 || x.h < 44));
  return {
    old: !!document.querySelector(".pp-sec-here .pp-list"),
    tiles: q(".pn-fh-wall > .pn-fh-p").map((t) => ({ me: t.classList.contains("pn-fh-me"), tag: t.tagName, n: (t.querySelector(".pn-fh-n") || {}).textContent || "",
      g: ((t.querySelector(".pn-fh-g") || {}).textContent || "").replace(/\u00a0/g, " ").trim(), gcls: (t.querySelector(".pn-fh-g") || { className: "" }).className,
      cnt: t.querySelector(".pn-fh-cnt") ? t.querySelector(".pn-fh-cnt").textContent.trim() : null, aria: t.getAttribute("aria-label") || "", allt: t.classList.contains("pn-fh-allt") })),
    strangers: q(".pn-fh-s").map((s) => ({ txt: s.textContent.trim(), aria: s.getAttribute("aria-label"), cnt: !!s.querySelector(".pn-fh-cnt"), g: !!s.querySelector(".pn-fh-g") })),
    anonGrid: q(".pn-fh-anon .pn-fh-s").length, leg: q(".pn-fh-lg").map((x) => x.textContent.trim()), alone: !!document.querySelector(".pn-fh-alone"),
    inv: (document.querySelector(".pn-fh-inv[data-invbar]") || {}).textContent || null, allt: !!document.querySelector(".pn-fh-allt[data-fh-all]"),
    small, text: W.textContent.replace(/\s+/g, " ").trim(),
  };
});
const menu = (page) => page.evaluate(() => {
  const m = document.querySelector(".pn-fh-menu"); if (!m) return null;
  const r = m.getBoundingClientRect(), go = m.querySelector(".pn-fh-go");
  const tg = [...m.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return Math.min(x.width, x.height); });
  return { name: (m.querySelector(".pn-fh-mn") || {}).textContent, groups: [...m.querySelectorAll(".pn-fh-mg > span")].map((s) => s.textContent.trim()),
    mc: (m.querySelector(".pn-fh-mc") || {}).textContent || "", go: go ? go.textContent.trim() : null, goSkal: go ? go.getAttribute("data-skal") : null, goDone: !!(go && go.classList.contains("done")),
    goPop: !!(go && go.classList.contains("pop")), rows: [...m.querySelectorAll(".pn-fh-mr")].map((b) => b.textContent.trim()), note: (m.querySelector(".pn-fh-mnote") || {}).textContent || "",
    inView: r.left >= 15 && r.right <= innerWidth - 15 && r.top >= 0 && r.bottom <= innerHeight, minTarget: Math.min.apply(null, tg), scrim: !!document.querySelector(".pn-fh-scrim"),
    focus: document.activeElement === go, text: m.textContent.replace(/\s+/g, " ").trim(), hist: !!(history.state && history.state.pnFh) };
});
const tapFace = (page, name) => page.evaluate((n) => {
  const t = [...document.querySelectorAll(".pn-fh [data-fh]")].find((x) => n === null ? x.classList.contains("pn-fh-s") : (x.querySelector(".pn-fh-n") || {}).textContent === n);
  if (!t) return false; t.click(); return true;
}, name);
const sheetOpen = (page) => page.evaluate(() => !!document.querySelector(".leaflet-popup.olnu-sheet .pn-fh, .leaflet-popup .pn-fh"));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- 1. friends + strangers ----------
    {
      const t = await open(browser, "mix"); const p = t.page;
      await frame(p);
      const w = await wall(p);
      ok("wall: the face wall replaced the old list", w && !w.old && w.tiles.length === 5, w);
      ok("order = crowdSort: me, then friends by arrival (Kalle has the most drinks and came last = last)", w && w.tiles.map((x) => x.n).join(",") === "Du,Lisa,Ida,Sara,Kalle", w && w.tiles.map((x) => x.n));
      const by = {}; (w ? w.tiles : []).forEach((x) => { by[x.n] = x; });
      ok("label: the first shared group (Lisa = Ludvika Lager)", by.Lisa && by.Lisa.g === "Ludvika Lager" && /sa-gcol-\d/.test(by.Lisa.gcls), by.Lisa);
      ok("label: 2 shared groups = the first + '+1' (Ida)", by.Ida && by.Ida.g === "Ludvika Lager +1", by.Ida);
      ok("label: a friend with no shared_groups field = 'Vän' (old server)", by.Kalle && by.Kalle.g === "Vän" && /pn-fh-van/.test(by.Kalle.gcls), by.Kalle);
      ok("badge: tonight's count on each named friend (Lisa 2, Ida 3, Sara 4, Kalle 9)", by.Lisa && by.Lisa.cnt === "2" && by.Ida.cnt === "3" && by.Sara.cnt === "4" && by.Kalle.cnt === "9", w && w.tiles.map((x) => x.n + ":" + x.cnt));
      ok("badge: not on my own face; me is not a button", by.Du && by.Du.cnt === null && by.Du.tag === "DIV", by.Du);
      ok("aria: friend tile says name, group and count", by.Ida && /^Ida, Ludvika Lager, 3 öl ikväll$/.test(by.Ida.aria), by.Ida && by.Ida.aria);
      ok("strangers: 5 grey faces, no text, no badge, no group", w && w.strangers.length === 5 && w.strangers.every((s) => s.txt === "" && !s.cnt && !s.g && s.aria === "Skåla med någon här"), w && w.strangers);
      ok("strangers: '5 till här' line", w && /5 till här/.test(w.text), w && w.text);
      ok("targets: every face / button in the wall is >= 44 px", w && !w.small.length, w && w.small);
      await shot(p, "1-van-okanda");
      // the menu: Ida
      await p.evaluate(() => { window.__clink = 0; const s = window.FX && window.FX.sound; if (s && s.clink) { const o = s.clink; s.clink = function () { window.__clink++; return o.apply(this, arguments); }; } });
      ok("tap Ida: the face exists", await tapFace(p, "Ida"));
      await wait(p, 300);
      let m = await menu(p);
      ok("menu: opens with Ida's name, both shared groups and her count line", m && m.name === "Ida" && m.groups.join("|") === "Ludvika Lager|Klättergänget" && /^3 öl ikväll · här sedan \d\d:\d\d$/.test(m.mc), m);
      ok("menu: Skåla med Ida is the main button (focused, data-skal kept)", m && m.go === "Skåla med Ida" && m.goSkal === String(t.list[2].id) && m.focus, m);
      ok("menu: Visa profil + Skriv till Ida", m && m.rows.join("|") === "Visa profil|Skriv till Ida", m && m.rows);
      ok("menu: on screen, scrim behind, targets >= 44, one history entry", m && m.inView && m.scrim && m.minTarget >= 44 && m.hist, m);
      await shot(p, "6-meny-ida");
      // scrim tap closes ONLY the menu (one click router)
      await p.evaluate(() => document.querySelector(".pn-fh-scrim").click()); await wait(p, 500);
      ok("scrim tap: menu closed, bar sheet still open, history entry gone", !(await menu(p)) && (await sheetOpen(p)) && !(await p.evaluate(() => !!(history.state && history.state.pnFh))));
      // Esc
      await tapFace(p, "Sara"); await wait(p, 300);
      await p.keyboard.press("Escape"); await wait(p, 400);
      ok("Esc: menu closed, sheet still open", !(await menu(p)) && (await sheetOpen(p)));
      // back gesture
      await tapFace(p, "Lisa"); await wait(p, 300);
      await p.evaluate(() => history.back()); await wait(p, 700);
      ok("back: closes the menu only (the bar sheet stays)", !(await menu(p)) && (await sheetOpen(p)));
      // skål
      await tapFace(p, "Ida"); await wait(p, 300);
      await p.evaluate(() => document.querySelector(".pn-fh-menu .pn-fh-go").click()); await wait(p, 350);
      m = await menu(p);
      ok("skål: the button says 'Skålat med Ida' (done, no pop)", m && m.goDone && m.go === "Skålat med Ida" && !m.goPop, m);
      ok("skål: one server call for Ida's pin", t.srv.skal.length === 1 && String(t.srv.skal[0].p_beer_id || t.srv.skal[0].p_pin) === String(t.list[2].id), t.srv.skal);
      await shot(p, "7-skalat");
      await wait(p, 1400);
      const after = await p.evaluate(() => ({ menu: !!document.querySelector(".pn-fh-menu"), done: [...document.querySelectorAll(".pn-fh-p")].filter((x) => x.querySelector(".pn-fh-done")).map((x) => x.querySelector(".pn-fh-n").textContent), clink: window.__clink }));
      ok("skål: the menu closed by itself after about 1 s; Ida's face has the skål mark", !after.menu && after.done.indexOf("Ida") >= 0, after);
      ok("skål: no sound (no celebration)", after.clink === 0, after);
      await shot(p, "8-efter");
      // a stranger
      await tapFace(p, null); await wait(p, 300);
      m = await menu(p);
      const noNum = m && !/\d/.test(m.text.replace(/\d\d:\d\d/g, ""));
      ok("stranger menu: 'Någon här', only Skåla, no rows, no group", m && m.name === "Någon här" && m.go === "Skåla" && !m.rows.length && !m.groups.length && /Inget namn, ingen siffra/.test(m.note), m);
      ok("stranger menu: no number (only the time)", noNum, m && m.text);
      await shot(p, "9-meny-okand");
      await p.evaluate(() => document.querySelector(".pn-fh-scrim").click()); await wait(p, 300);
      await t.ctx.close();
    }
    // ---------- 2. two groups (6+ named: the group line) ----------
    {
      const t = await open(browser, "groups2"); const p = t.page; await frame(p);
      const w = await wall(p);
      ok("2 groups: a group line with the 2 groups and their people", w && w.leg.length === 2 && /Ludvika Lager 3/.test(w.leg.join("|")) && /Jobbet 3/.test(w.leg.join("|")), w && w.leg);
      ok("2 groups: Nisse in both = 'Jobbet +1' (first by name)", w && w.tiles.some((x) => x.n === "Nisse" && x.g === "Jobbet +1"), w && w.tiles);
      await shot(p, "2-tva-grupper");
      await t.ctx.close();
    }
    // ---------- 3. 8+ named: 7 faces + Visa alla ----------
    {
      const t = await open(browser, "many"); const p = t.page; await frame(p);
      const w = await wall(p);
      ok("8+: 7 faces + one 'Visa alla' face, never more", w && w.tiles.length === 8 && w.tiles[7].allt && w.allt && /Visa alla/.test(w.tiles[7].n), w && w.tiles.map((x) => x.n));
      ok("8+: the order is still crowdSort (Du, Kalle, Emma, Jonas, ...)", w && w.tiles.slice(0, 4).map((x) => x.n).join(",") === "Du,Kalle,Emma,Jonas", w && w.tiles.map((x) => x.n));
      ok("8+: group line = 2 biggest groups + '+1'", w && w.leg.length === 3 && w.leg[2] === "+1", w && w.leg);
      ok("8+: targets >= 44", w && !w.small.length, w && w.small);
      await shot(p, "3-atta-eller-fler");
      await p.evaluate(() => document.querySelector(".pn-fh-allt").click()); await wait(p, 1200);
      const cr = await p.evaluate(() => ({ open: !!document.querySelector("#sheet:not([hidden]) .crowd-list"), g: [...document.querySelectorAll(".crowd-list .cr-g")].map((x) => x.textContent.replace(/\u00a0/g, " ").trim()) }));
      ok("Visa alla: the crowd list opens; friend rows have the dot + group label", cr.open && cr.g.length === 10 && cr.g.indexOf("Ludvika Lager") >= 0 && cr.g.indexOf("Vän") >= 0, cr);
      await shot(p, "10-visa-alla");
      await t.ctx.close();
    }
    // ---------- 4. only strangers ----------
    {
      const t = await open(browser, "strangers"); const p = t.page; await frame(p);
      const w = await wall(p);
      ok("only strangers: 7 bigger grey faces in the grid, no names, no numbers", w && w.anonGrid === 7 && !w.tiles.length && w.strangers.every((s) => s.txt === "" && !s.cnt), w);
      ok("only strangers: '7 här just nu' and the hint", w && /7 här just nu/.test(w.text) && /Tryck på någon för att skåla/.test(w.text), w && w.text);
      await shot(p, "4-bara-okanda");
      await t.ctx.close();
    }
    // ---------- 5. me alone ----------
    {
      const t = await open(browser, "me"); const p = t.page; await frame(p);
      const w = await wall(p);
      ok("me alone: my face, the line, and 'Bjud hit gänget' (data-invbar)", w && w.alone && /Bara du här just nu/.test(w.text) && /Bjud hit gänget/.test(w.inv || ""), w);
      ok("me alone: targets >= 44", w && !w.small.length, w && w.small);
      await shot(p, "5-bara-du");
      await t.ctx.close();
    }
    // ---------- 6. store build: counts are information (shown), strangers still none ----------
    {
      const t = await open(browser, "mix", { store: true }); const p = t.page;
      const w = await wall(p);
      const st = await p.evaluate(() => window.OLNU_STORE === true);
      ok("store build: friend count badges shown as plain info, strangers none", st && w && w.tiles.filter((x) => x.cnt).length === 4 && w.strangers.every((s) => !s.cnt), w && w.tiles.map((x) => x.n + ":" + x.cnt));
      await t.ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nfolkhar: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
