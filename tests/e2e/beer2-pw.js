// beer2-pw.js — I-132 follow-ups (lane beer2): friends' favourite beers on the person card (js/profilecard.js + beerlib_favs_for),
// "Tipsa om en öl" in group and event chats (js/gpage.js: full chat button + card, group page preview), "Tipsa en vän" to a group,
// the "Om data" licence page (js/beerlib-pages.js), and the data quality pass (scripts/beer/build-data.mjs, js/beerlib.js default list).
// Old code: the checks FAIL (no favourites on the card, no button in group chats, raw "[öl:id]" in the preview, no about page,
// % and pack sizes in names, beers without a photo in the default list, no "Stil (gissning)" label).
// 390 px, mocked Supabase. Usage: node beer2-pw.js <port>   (BEER2_SHOTS=<dir> also saves 390x844 @2x pictures)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SHOTS = process.env.BEER2_SHOTS || "";
const GID = "11111111-2222-3333-4444-555555555555";   // Ludvika Lager (d2-helpers)
const EVG = "44444444-eeee-4444-8888-666666666666";   // an event chat
const DM = RPCF.DM_GID;
const BEER = "5410228158424";      // Hoegaarden Blanche: witbier (a guess), 4.9 %, a photo
const BEER2 = "7310401006925";     // a second beer with a photo (Swedish)
const NOPHOTO = "7330755126360";   // Capital IPA (S:t Eriks): no photo -> only in search
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };
const shot = async (page, name) => { if (SHOTS) { await wait(page, 600); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };
const tipLine = (id, line) => "Öltips: Blanche [öl:" + id + "]" + (line ? " " + line : "");
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const calls = [], posts = [];
  await page.route(/rest\/v1\/rpc\/(beerlib_\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(beerlib_\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (o.old) return J(r, { code: "PGRST202", message: "Could not find the function public." + fn }, 404);
    if (fn === "beerlib_favs_for") return J(r, o.favsFor || []);
    if (fn === "beerlib_favs_mine") return J(r, []);
    if (fn === "beerlib_beer_get") return J(r, { my_stars: null, fav_slot: null, n: 0, avg: null, reviews: [] });
    return J(r, {});
  });
  const msgs = {};
  msgs[GID] = [{ id: 701, name: "Lisa", body: "Vad tar vi?", created_at: ago(20), is_me: false },
    { id: 702, name: "Oskar", body: tipLine(BEER, "Frisk, inte bitter"), created_at: ago(15), is_me: false }];
  msgs[EVG] = [{ id: 801, name: "Maja", body: tipLine(BEER, "Till maten"), created_at: ago(10), is_me: false }];
  await page.route(/rest\/v1\/rpc\/(group_msgs|post_group_msg)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const l = msgs[b.p_group_id]; if (!l) return r.fallback();
    if (fn === "group_msgs") return J(r, l.filter((m) => m.id > (b.p_after_id | 0)));
    posts.push({ g: b.p_group_id, body: b.p_body });
    const m = { id: 900 + posts.length, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true }; l.push(m);
    return J(r, { id: m.id, created_at: m.created_at });
  });
  if (o.dmList) await page.route(/rest\/v1\/rpc\/my_dms\b/, (r) => J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [RPCF.dmThread(DM)] }));
  await boot(page);
  return { ctx, page, errs, calls, posts };
}
const waitSheet = (page, re) => page.waitForFunction((r) => { const s = document.getElementById("sheet"); return s && !s.hidden && new RegExp(r).test(document.getElementById("sheet-title").textContent + " " + s.innerText); }, re.source, { timeout: 15000 }).catch(() => {});
const closeAll = (page) => page.evaluate(() => { try { if (window.PROFCARD) window.PROFCARD.close(); } catch (e) {} try { if (window.PN && PN.closeSheet) PN.closeSheet(); } catch (e) {} });

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  let ctx, page, errs, calls, posts;
  try {
    // ---------- 1. Data quality: the default list, names, ABV, "Stil (gissning)" ----------
    ({ ctx, page, errs, calls, posts } = await open(browser));
    await page.evaluate(() => window.BARSEARCH.open("beer"));
    await page.waitForSelector("#bs-beer .bl-row", { timeout: 15000 }).catch(() => {});
    await wait(page, 400);
    const d1 = await page.evaluate(() => {
      const B = window.BEERLIB, d = B && B.data(); if (!d) return null;
      const rows = [...document.querySelectorAll("#bs-beer .bl-list [data-bl-beer]")].map((r) => d.byId[r.getAttribute("data-bl-beer")]).filter(Boolean);
      const pct = d.beers.filter((b) => /(^|[^\d.,])([1-9]\d?|0[.,][6-9])([.,]\d+)?\s*%/.test(b.name)).map((b) => b.name);
      const pack = d.beers.filter((b) => /\b\d+\s*[x×]\s*\d+\s*(cl|ml)?\b|\b\d+([.,]\d+)?\s*(cl|ml)\b/i.test(b.name)).map((b) => b.name);
      const ent = d.beers.filter((b) => /&(quot|amp|#\d+);/.test(b.name)).map((b) => b.name);
      const caps = d.beers.filter((b) => b.name.length > 6 && b.name === b.name.toUpperCase() && /[A-ZÅÄÖ]{4}/.test(b.name)).map((b) => b.name);
      const badAbv = d.beers.filter((b) => b.abv != null && (b.abv > 16 || (!b.af && b.abv < 0.6) || (b.af && b.abv > 0.5))).map((b) => b.name + " " + b.abv);
      return { n: rows.length, noPhoto: rows.filter((b) => !b.photo).map((b) => b.name), noName: rows.filter((b) => b.nn).map((b) => b.name), pct: pct.slice(0, 5), pctN: pct.length,
        pack: pack.slice(0, 5), packN: pack.length, ent, caps: caps.slice(0, 5), capsN: caps.length, badAbv, total: d.beers.length, cols: (d.cols || null) };
    });
    ok("Default Öl list: only beers with a photo and a real name", !!d1 && d1.n >= 10 && d1.noPhoto.length === 0 && d1.noName.length === 0, d1 && { n: d1.n, noPhoto: d1.noPhoto.slice(0, 5), noName: d1.noName.slice(0, 5) });
    ok("Names: no strength (%), pack size or HTML entity in a beer name", !!d1 && d1.pctN === 0 && d1.packN === 0 && d1.ent.length === 0, d1 && { pct: d1.pct, pctN: d1.pctN, pack: d1.pack, ent: d1.ent });
    ok("Names: no SHOUTING names (all caps)", !!d1 && d1.capsN === 0, d1 && { caps: d1.caps, n: d1.capsN });
    ok("ABV only when plausible (0.6–16 %, alcohol-free <= 0.5 %)", !!d1 && d1.badAbv.length === 0, d1 && d1.badAbv.slice(0, 5));
    await page.evaluate(() => { const l = document.querySelector("#bs-beer .bl-list"), b = document.getElementById("bs-beer"); if (l && b) b.scrollTop += l.getBoundingClientRect().top - b.getBoundingClientRect().top - 48; });
    await shot(page, "01-ol-lista");
    await page.fill("#bs-q", "capital ipa"); await wait(page, 600);
    ok("Search still finds a beer without a photo (Capital IPA)", await page.evaluate((id) => !!document.querySelector('#bs-beer [data-bl-beer="' + id + '"]'), NOPHOTO));
    // the beer page: "Stil (gissning)" + the brewery in a style-only name
    await page.evaluate((id) => window.BEERLIB.beer(id), BEER);
    await waitSheet(page, /Hoegaarden/);
    await wait(page, 500);
    const b1 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, lab: (document.querySelector("#sheet-body .bl-bh .bl-stl") || {}).textContent || "",
      t: document.getElementById("sheet-body").innerText }));
    ok("Beer page: a style-only name gets the brewery ('Hoegaarden Blanche')", /^Hoegaarden Blanche$/.test(b1.title), b1.title);
    ok("Beer page: the style is labelled 'Stil (gissning)' when it is a guess", /^Stil \(gissning\)$/.test(b1.lab.trim()) && /Witbier/.test(b1.t), { lab: b1.lab, t: b1.t.slice(0, 200) });
    await shot(page, "02-ol-sida");

    // ---------- 2. Om data (licences) ----------
    await page.evaluate(() => document.getElementById("sheet-body").scrollTo(0, 9999));
    const ab0 = await page.evaluate(() => !!document.querySelector("#sheet-body [data-bl-about]"));
    ok("Beer page has a link 'Om data och licenser'", ab0);
    await page.evaluate(() => { const a = document.querySelector("#sheet-body [data-bl-about]"); if (a) a.click(); else if (window.BEERLIB && window.BEERLIB.about) window.BEERLIB.about(); });
    await waitSheet(page, /Om data/);
    const a1 = await page.evaluate(() => {
      const s = document.getElementById("sheet-body"), links = [...s.querySelectorAll("a[href]")].map((a) => ({ t: a.textContent.trim(), h: a.href, rel: a.rel, tg: a.target }));
      return { title: document.getElementById("sheet-title").textContent, t: s.innerText, links, imgs: [...s.querySelectorAll("img")].map((i) => i.src), h: Math.min(...[...s.querySelectorAll("a[href]")].map((a) => a.getBoundingClientRect().height)) };
    });
    ok("Om data: Open Food Facts with ODbL (database) and CC BY-SA (photos), with links", /Om data/.test(a1.title) && /ODbL/.test(a1.t) && /CC BY-SA/.test(a1.t) &&
      a1.links.some((l) => /openfoodfacts\.org/.test(l.h)) && a1.links.some((l) => /opendatacommons\.org\/licenses\/odbl/.test(l.h)), { t: a1.t.slice(0, 400), links: a1.links });
    ok("Om data: our own style texts; Untappd not used; no Systembolaget logo or link", /skriver vi själva/.test(a1.t) && /Untappd/.test(a1.t) && /inte Untappd/.test(a1.t) &&
      /Systembolaget/.test(a1.t) && !a1.imgs.some((s) => /systembolaget/i.test(s)) && !a1.links.some((l) => /systembolaget\.se/.test(l.h)), a1.t);
    ok("Om data: our beer list is shared under the same licence (ODbL), outside links open safely, 44 px", a1.links.some((l) => /data\/beer\/beers\.json$/.test(l.h)) &&
      a1.links.filter((l) => !/127\.0\.0\.1/.test(l.h)).every((l) => /noopener/.test(l.rel) && l.tg === "_blank") && a1.h >= 44, a1.links);
    ok("Om data: no drink-more words", !/starkast|strongest|topplista|top rated|bäst betyg|prova nu|ett måste/i.test(a1.t));
    await shot(page, "03-om-data");
    await page.evaluate(() => { window.__i18n = window.I18N; window.I18N = new Proxy(window.__i18n, { get: (t, k) => (k === "lang" ? "en" : t[k]) }); if (window.BEERLIB.about) window.BEERLIB.about(); });
    await waitSheet(page, /About the data/);
    const a2 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, t: document.getElementById("sheet-body").innerText }));
    ok("About the data (en): same facts in English", /About the data/.test(a2.title) && /ODbL/.test(a2.t) && /We do not use Untappd/.test(a2.t) && /We write the texts/.test(a2.t), a2.t.slice(0, 300));
    await page.evaluate(() => { if (window.__i18n) window.I18N = window.__i18n; });
    await closeAll(page); await wait(page, 300);
    await page.evaluate(() => window.BARSEARCH.open("beer")); await page.fill("#bs-q", ""); await wait(page, 500);
    ok("Öl tab has the link 'Om data och licenser' too", await page.evaluate(() => !!document.querySelector("#bs-beer [data-bl-about]")));
    ok("No page errors (data, about)", errs.length === 0, errs);
    await ctx.close();

  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); await ctx.close().catch(() => {}); }
  try {
    // ---------- 3. A friend's favourite beers on the person card ----------
    ({ ctx, page, errs, calls } = await open(browser, { favsFor: [{ slot: 1, beer: BEER }, { slot: 3, beer: BEER2 }] }));
    await page.evaluate((g) => window.PROFCARD.open({ g: { id: g, name: "Ludvika Lager" }, name: "Lisa", k: "cccccccccccc", is_me: false, live: true, n: 2 }), GID);
    await page.waitForSelector(".pc-card .bl-pcf .bl-pcf-t", { timeout: 15000 }).catch(() => {});
    await wait(page, 400);
    const c1 = await page.evaluate(() => {
      const s = document.querySelector(".pc-card .bl-pcf"), acts = document.querySelector(".pc-card .pc-acts");
      return s ? { h: (s.querySelector("h3") || {}).textContent, tiles: [...s.querySelectorAll(".bl-pcf-t")].map((t) => ({ t: t.textContent.trim(), id: t.getAttribute("data-bl-beer"), h: t.getBoundingClientRect().height })),
        after: acts ? !!(acts.compareDocumentPosition(s) & 4) : null } : null;
    });
    const fc = calls.filter((c) => c[0] === "beerlib_favs_for");
    ok("Person card asks beerlib_favs_for with the group + member key", fc.length === 1 && fc[0][1].p_group_id === GID && fc[0][1].p_k === "cccccccccccc", fc);
    ok("Person card: 'Lisas favoritöl' with her 2 beers in slot order (no empty tiles)", !!c1 && /Lisas favoritöl/.test(c1.h) && c1.tiles.length === 2 && c1.tiles[0].id === BEER && c1.tiles[1].id === "7310401006925" && c1.tiles.every((t) => t.h >= 44), c1);
    ok("Person card: the favourites sit below the buttons (nothing moves under the finger)", !!c1 && c1.after === true, c1);
    ok("Person card: no count of beers tried, no score", !!c1 && !/provat|tried|poäng|betyg/i.test(JSON.stringify(c1.tiles)), c1);
    await shot(page, "04-vankort");
    await page.click('.pc-card .bl-pcf [data-bl-beer="' + BEER + '"]');
    await waitSheet(page, /Hoegaarden/);
    ok("Tap a favourite: the card closes and the beer page opens", await page.evaluate(() => !window.PROFCARD.isOpen() && /Hoegaarden/.test(document.getElementById("sheet-title").textContent)));
    await closeAll(page); await wait(page, 300);
    // my own card: no call; a friend with no favourites (or ghost mode: the server sends []): no section
    calls.length = 0;
    await page.evaluate((g) => window.PROFCARD.open({ g: { id: g, name: "Ludvika Lager" }, name: "Anton", k: "me", is_me: true }), GID); await wait(page, 800);
    ok("My own card: no favourites call, no section", calls.filter((c) => c[0] === "beerlib_favs_for").length === 0 && await page.evaluate(() => !document.querySelector(".pc-card .bl-pcf")));
    await closeAll(page);
    ok("No page errors (person card)", errs.length === 0, errs);
    await ctx.close();
    for (const o of [{ favsFor: [] }, { old: true }]) {
      ({ ctx, page, errs, calls } = await open(browser, o));
      await page.evaluate((g) => window.PROFCARD.open({ g: { id: g, name: "Ludvika Lager" }, name: "Oskar", k: "bbbbbbbbbbbb", is_me: false, live: true }), GID); await wait(page, 1500);
      const s = await page.evaluate(() => ({ sec: !!document.querySelector(".pc-card .bl-pcf"), card: !!document.querySelector(".pc-card"), beerlib: !!window.BEERLIB }));
      ok("Person card, " + (o.old ? "old server (PGRST202)" : "no favourites / ghost mode") + ": no section, the card is fine, the beer library is not loaded", s.card && !s.sec && !s.beerlib && errs.length === 0, { s, errs });
      await ctx.close();
    }

  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); await ctx.close().catch(() => {}); }
  try {
    // ---------- 4. Group chat: the beer button + the beer card ----------
    ({ ctx, page, errs, calls, posts } = await open(browser));
    await page.evaluate((g) => window.SOCIAL.openChat({ id: g, name: "Ludvika Lager" }), GID);
    await page.waitForSelector(".chat-list .bl-chatcard", { timeout: 15000 }).catch(() => {});
    await wait(page, 300);
    const g1 = await page.evaluate(() => {
      const c = document.querySelector(".chat-list .bl-chatcard"), raw = document.querySelector(".chat-list .cm-body.bl-raw"), b = document.querySelectorAll(".chat-input .bl-dmb, #chat-inp ~ .bl-dmb, .bl-dmb");
      return { card: c ? c.innerText.replace(/\s+/g, " ") : null, rawHidden: raw ? getComputedStyle(raw).display === "none" : null, btns: b.length, h: b[0] ? b[0].getBoundingClientRect().height : 0, l: b[0] ? b[0].getAttribute("aria-label") : "" };
    });
    ok("Group chat: a tip line shows as the same beer card as in DM ('Oskar tipsar om', 'Visa ölen'), raw text hidden", !!g1.card && /Oskar tipsar om/.test(g1.card) && /Blanche/.test(g1.card) && /Frisk, inte bitter/.test(g1.card) && /Visa ölen/.test(g1.card) && g1.rawHidden === true, g1);
    ok("Group chat: ONE 44 px beer button 'Tipsa om en öl'", g1.btns === 1 && g1.h >= 44 && /Tipsa om en öl/.test(g1.l), g1);
    await shot(page, "05-gruppchatt");
    await page.click(".bl-dmb");
    await page.waitForSelector(".bl-dmp .bl-row", { timeout: 15000 }).catch(() => {});
    await page.fill(".bl-dmp .bl-q", "hoegaarden blanche"); await wait(page, 500);
    await shot(page, "06-gruppchatt-valj");
    await page.evaluate((id) => { const r = document.querySelector('.bl-dmp [data-bl-beer="' + id + '"]') || document.querySelector(".bl-dmp .bl-row"); if (r) r.click(); }, BEER);
    await page.waitForFunction(() => document.querySelectorAll(".chat-list .bl-chatcard").length >= 2, null, { timeout: 15000 }).catch(() => {});
    ok("Group chat: the pick goes out as ONE normal chat line to the group, and shows as a card", posts.length === 1 && posts[0].g === GID && /^Öltips: .+ \[öl:5410228158424\]$/.test(posts[0].body) &&
      await page.evaluate(() => document.querySelectorAll(".chat-list .bl-chatcard").length >= 2), posts);
    await closeAll(page); await wait(page, 400);
    // event chat (same social.js code path)
    await page.evaluate((g) => window.SOCIAL.openChat({ id: g, name: "Fest hos Maja", ev: true }), EVG);
    await page.waitForSelector(".chat-list .bl-chatcard", { timeout: 15000 }).catch(() => {});
    const e1 = await page.evaluate(() => ({ card: !!document.querySelector(".chat-list .bl-chatcard"), btns: document.querySelectorAll(".bl-dmb").length }));
    ok("Event chat: the beer card and ONE beer button too", e1.card && e1.btns === 1, e1);
    await closeAll(page); await wait(page, 400);
    // DM: still one button (dm.js has its own)
    await page.route(/rest\/v1\/rpc\/my_dms\b/, (r) => J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [RPCF.dmThread(DM)] }));
    await page.evaluate((id) => window.DM.openById(id), DM);
    await page.waitForSelector(".chat-list", { timeout: 15000 }).catch(() => {}); await wait(page, 1200);
    ok("DM chat: still exactly ONE beer button", await page.evaluate(() => document.querySelectorAll(".bl-dmb").length) === 1, await page.evaluate(() => document.querySelectorAll(".bl-dmb").length));
    await closeAll(page); await wait(page, 400);
    ok("No page errors (chats)", errs.length === 0, errs);
    await ctx.close();

  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); await ctx.close().catch(() => {}); }
  try {
    // ---------- 5. The group page chat preview ----------
    ({ ctx, page, errs } = await open(browser));
    await page.evaluate(() => document.getElementById("btn-groups").click()); await wait(page, 1200);
    await page.evaluate(() => { const t = document.querySelector('.inv-tabs button[data-t="g"]'); if (t) t.click(); }); await wait(page, 400);
    await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
    await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => [...document.querySelectorAll(".gpg-msgs > li")].some((li) => /Blanche/.test(li.textContent)), null, { timeout: 15000 }).catch(() => {});
    const p1 = await page.evaluate(() => {
      const li = [...document.querySelectorAll(".gpg-msgs > li")].find((x) => /Blanche/.test(x.textContent));
      return li ? { t: li.textContent.replace(/\s+/g, " "), tip: !!li.querySelector(".gpg-tip"), icon: !!li.querySelector(".gpg-tip svg") } : null;
    });
    ok("Group page preview: a tip reads 'tipsar om Blanche' with a beer icon, no '[öl:id]' code", !!p1 && !/\[öl:/.test(p1.t) && p1.tip && p1.icon && /tipsar om/.test(p1.t) && /Frisk, inte bitter/.test(p1.t), p1);
    await page.evaluate(() => { const c = document.querySelector(".gpg-chat"); if (c) c.scrollIntoView({ block: "center" }); });
    await shot(page, "07-gruppsida");
    ok("No page errors (group page)", errs.length === 0, errs);
    await ctx.close();

  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); await ctx.close().catch(() => {}); }
  try {
    // ---------- 6. Tipsa en vän: to a group too ----------
    ({ ctx, page, errs, posts } = await open(browser, { dmList: true }));
    await page.evaluate((id) => window.PN.beerlib().then((B) => B.load().then(() => B.tip(id))), BEER);
    await waitSheet(page, /Tipsa en vän/);
    await page.waitForSelector('#sheet-body .bl-pick[data-g]', { timeout: 8000 }).catch(() => {});
    const t1 = await page.evaluate(() => ({ picks: [...document.querySelectorAll("#sheet-body .bl-pick")].map((p) => p.innerText.replace(/\s+/g, " ")), hs: [...document.querySelectorAll("#sheet-body .bl-h")].map((h) => h.textContent) }));
    ok("Tipsa en vän: my groups are in the list too ('Ludvika Lager', 'Grupp')", t1.picks.some((p) => /Ludvika Lager/.test(p) && /Grupp/.test(p)), t1);
    await shot(page, "08-tipsa");
    await page.evaluate(() => { const p = [...document.querySelectorAll("#sheet-body .bl-pick")].find((x) => /Ludvika Lager/.test(x.textContent)); if (p) p.click(); });
    await page.click("#sheet-body [data-bl-go]").catch(() => {});
    await page.waitForFunction(() => document.getElementById("sheet").hidden, null, { timeout: 10000 }).catch(() => {});
    ok("Tipsa en vän: a picked group gets ONE tip line in its chat", posts.length === 1 && posts[0].g === GID && /^Öltips: .+ \[öl:5410228158424\]$/.test(posts[0].body), posts);
    ok("No page errors (tip to a group)", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); await ctx.close().catch(() => {}); }
  await browser.close();
  console.log(`\nbeer2: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
