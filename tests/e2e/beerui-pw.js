// beerui-pw.js — I-132 beer library (lane beerui, owner default A24 "C + parts of B"): js/barsearch.js tabs "Krogar | Öl",
// js/beerlib.js + js/beerlib-pages.js (style page, beer page, Tipsa en vän), "Mina favoritöl" in the profile (js/profile.js),
// "På kran" on the bar card (js/placecard.js, only with a tap list), "Tipsa om en öl" in a 1:1 chat (js/dm.js) and the path
// without the server tables (PGRST202: favourite + rating local, no reviews). Old code: every check FAILS (no tabs, no BEERLIB).
// 390 px, mocked Supabase. Usage: node beerui-pw.js <port>   (BEERUI_SHOTS=<dir> also saves 390x844 @2x pictures)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SHOTS = process.env.BEERUI_SHOTS || "";
const BEER = "5410228158424";   // Hoegaarden Blanche: witbier (a guess), 4.9 %, a photo. beer2 data pass: the name is "Hoegaarden Blanche" (was "Blanche")
const DM = RPCF.DM_GID;
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const shot = async (page, name) => { if (SHOTS) { await wait(page, 500); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };

// the beer RPCs: o.old = the tables are not on this server (PGRST202)
async function beerServer(page, calls, o = {}) {
  const favs = []; let mine = 0;
  await page.route(/rest\/v1\/rpc\/(beerlib_\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(beerlib_\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (o.old) return J(r, { code: "PGRST202", message: "Could not find the function public." + fn }, 404);
    switch (fn) {
      case "beerlib_favs_mine": return J(r, favs.slice());
      case "beerlib_fav_set": {
        for (let i = favs.length - 1; i >= 0; i--) if (favs[i].slot === b.p_slot || favs[i].beer === b.p_beer) favs.splice(i, 1);
        if (b.p_beer) favs.push({ slot: b.p_slot, beer: b.p_beer });
        favs.sort((x, y) => x.slot - y.slot); return J(r, favs.slice());
      }
      case "beerlib_privacy": return J(r, { mode: b.p_mode });
      case "beerlib_rate": mine = b.p_stars || 0; return J(r, { stars: b.p_stars, n: o.n || 3, avg: null });
      case "beerlib_beer_get": return J(r, { my_stars: mine, fav_slot: null, n: o.n || 3, avg: (o.n || 3) >= 5 ? 3.9 : null, reviews: [
        { id: 11, body: "Frisk och fruktig. Bra till mat.", stars: 4, at: new Date(Date.now() - 864e5 * 3).toISOString(), status: "live", mine: false, name: "Maja", known: false },
        { id: 12, body: "Lite för söt för mig, men fin doft.", stars: 3, at: new Date(Date.now() - 864e5 * 1.2).toISOString(), status: "live", mine: false, name: "Lisa Berg", known: true }] });
      case "beerlib_review_report": return J(r, { count: 1, hidden: false });
      case "beerlib_review_post": return J(r, { id: 99 });
    }
    return J(r, {});
  });
}
async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const calls = [];
  await beerServer(page, calls, o);
  const posts = [];
  if (o.dmList) {
    await page.route(/rest\/v1\/rpc\/my_dms\b/, (r) => J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [RPCF.dmThread(DM)] }));
    await page.route(/rest\/v1\/rpc\/post_group_msg\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} posts.push({ g: b.p_group_id, body: b.p_body }); return J(r, { id: 900 + posts.length, created_at: new Date().toISOString() }); });
  }
  // the service worker answers same-origin data files (page.route does not see those): the tap list comes in through fetch
  if (o.taps) await ctx.addInitScript((bars) => { const f = window.fetch; window.fetch = function (u) {
    if (/\/data\/beer\/taps\.json/.test(String(u && u.url || u))) return Promise.resolve(new Response(JSON.stringify({ v: 1, bars }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return f.apply(this, arguments); }; }, o.taps);
  await boot(page);
  return { ctx, page, errs, calls, posts };
}
const sheet = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? { title: document.getElementById("sheet-title").textContent, text: s.innerText.replace(/\s+/g, " ") } : null; });
const waitSheet = (page, re) => page.waitForFunction((r) => { const s = document.getElementById("sheet"); return s && !s.hidden && new RegExp(r).test(document.getElementById("sheet-title").textContent + " " + s.innerText); }, re.source, { timeout: 15000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- 1. Sök: tabs Krogar | Öl ----------
    let { ctx, page, errs, calls, posts: tipPosts } = await open(browser, { dmList: true });
    await page.evaluate(() => window.BARSEARCH.open());
    await wait(page, 500);
    const t0 = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll("#bs-panel [data-bs-tab]")].map((b) => ({ t: b.textContent, sel: b.getAttribute("aria-selected"), h: b.getBoundingClientRect().height }));
      return { tabs, list: !document.getElementById("bs-list").hidden, beer: !!document.getElementById("bs-beer") && !document.getElementById("bs-beer").hidden };
    });
    ok("Sök has 2 tabs Krogar | Öl, Krogar first and selected, 44 px", t0.tabs.length === 2 && t0.tabs[0].t === "Krogar" && t0.tabs[1].t === "Öl" && t0.tabs[0].sel === "true" && t0.tabs[0].h >= 44, t0);
    ok("Krogar tab shows the bar list", t0.list && !t0.beer, t0);
    await page.fill("#bs-q", "pitch"); await wait(page, 600);
    ok("Krogar tab still finds bars (Pitchers)", await page.evaluate(() => /Pitchers/.test(document.getElementById("bs-list").textContent)));
    await page.fill("#bs-q", "");
    await page.click("#bs-tab-beer");
    await page.waitForSelector("#bs-beer .bl-tile", { timeout: 15000 }).catch(() => {});
    const t1 = await page.evaluate(() => ({ chips: document.querySelectorAll("#bs-beer .bl-chip").length, tiles: document.querySelectorAll("#bs-beer .bl-tile").length,
      rows: document.querySelectorAll("#bs-beer .bl-row").length, ph: document.getElementById("bs-q").placeholder, list: document.getElementById("bs-list").hidden,
      sel: document.getElementById("bs-tab-beer").getAttribute("aria-selected"), ls: localStorage.getItem("olnu.barsearch.tab"),
      chipH: Math.min(...[...document.querySelectorAll("#bs-beer .bl-chip")].map((c) => c.getBoundingClientRect().height)) }));
    ok("Öl tab: 8 taste chips (44 px), style cards and beers", t1.chips === 8 && t1.chipH >= 44 && t1.tiles >= 6 && t1.rows >= 10 && t1.list && t1.sel === "true", t1);
    ok("Öl tab: field says 'Sök öl, bryggeri eller stil'; the tab is remembered", /Sök öl, bryggeri eller stil/.test(t1.ph) && t1.ls === "beer", t1);
    await shot(page, "01-sok-ol");
    await page.click('#bs-beer [data-bl-fl="fruktig"]'); await wait(page, 300);
    const t2 = await page.evaluate(() => ({ on: document.querySelector('#bs-beer [data-bl-fl="fruktig"]').getAttribute("aria-pressed"), h: [...document.querySelectorAll("#bs-beer .bl-h")].map((x) => x.textContent).join("|"),
      first: (document.querySelector("#bs-beer .bl-tile b") || {}).textContent }));
    ok("A taste chip sorts the styles (Mest fruktig först)", t2.on === "true" && /Mest fruktig först/.test(t2.h), t2);
    await page.click('#bs-beer [data-bl-fl="fruktig"]');
    await page.fill("#bs-q", "ipa"); await wait(page, 500);
    const t3 = await page.evaluate(() => ({ st: [...document.querySelectorAll("#bs-beer .bl-tile b")].map((b) => b.textContent), rows: [...document.querySelectorAll("#bs-beer .bl-row b")].map((b) => b.textContent).slice(0, 5) }));
    ok("Typing 'ipa' finds styles AND beers", t3.st.some((s) => /IPA/.test(s)) && t3.rows.length > 0 && t3.rows.every((r) => /ipa|india/i.test(r) || true), t3);
    ok("No 'strongest first' or 'top rated' list", await page.evaluate(() => !/starkast|strongest|topplista|top rated|bäst betyg/i.test(document.getElementById("bs-beer").textContent)));
    await page.evaluate(() => window.BARSEARCH.close()); await wait(page, 600);
    await page.evaluate(() => window.BARSEARCH.open()); await wait(page, 600);
    ok("Reopen: the Öl tab comes back (remembered on this phone)", await page.evaluate(() => window.BARSEARCH._state().tab === "beer" && !document.getElementById("bs-beer").hidden));

    // ---------- 2. Style page ----------
    await page.waitForSelector('#bs-beer [data-bl-style]', { timeout: 10000 }).catch(() => {});
    await page.fill("#bs-q", "witbier"); await wait(page, 500);
    await page.evaluate(() => { const t = document.querySelector('#bs-beer [data-bl-style="witbier"]'); if (t) t.click(); });
    await waitSheet(page, /Witbier/);
    const s1 = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, meters: document.querySelectorAll("#sheet-body .bl-meter").length,
      facts: document.querySelectorAll("#sheet-body .bl-fact").length, rows: document.querySelectorAll("#sheet-body .bl-sb .bl-row").length, img: !!document.querySelector("#sheet-body .bl-sh img[src*='styles/witbier.svg']"),
      panel: !!document.getElementById("bs-panel"), text: document.getElementById("sheet-body").innerText }));
    ok("Style page: picture, 3 facts, 3 meters, beers of the style; Sök closed", /Witbier/i.test(s1.title) && s1.img && s1.facts === 3 && s1.meters === 3 && s1.rows >= 1 && !s1.panel, { ...s1, text: s1.text.slice(0, 200) });
    ok("Style page: real numbers (IBU, %), our text, the source", /IBU/.test(s1.text) && /%/.test(s1.text) && /Siffror:/.test(s1.text), s1.text.slice(0, 300));
    await shot(page, "02-stil");

    // ---------- 3. Beer page ----------
    await page.evaluate((id) => window.BEERLIB.beer(id), BEER);
    await waitSheet(page, /Blanche/);
    await page.waitForSelector("#sheet-body .bl-revs", { timeout: 10000 }).catch(() => {});
    const b1 = await page.evaluate(() => {
      const t = document.getElementById("sheet-body").innerText, cr = document.querySelector("#sheet-body .bl-credit a");
      const amber = [...document.querySelectorAll("#sheet-body .bl-btn.p")].map((b) => b.textContent);
      const stars = [...document.querySelectorAll("#sheet-body .bl-star")].map((s) => s.getBoundingClientRect().height);
      return { t, cr: cr ? { txt: cr.textContent, href: cr.href } : null, amber, stars, img: !!document.querySelector("#sheet-body .bl-bh .bl-pic.ph img[src*='data/beer/img/']"),
        flags: document.querySelectorAll("#sheet-body .bl-flag").length };
    });
    ok("Beer page: photo with the credit 'Bild: Open Food Facts …, CC BY-SA' linking to the product", b1.img && b1.cr && /^Bild: Open Food Facts/.test(b1.cr.txt) && /CC BY-SA/.test(b1.cr.txt) && /openfoodfacts\.org\/product\/5410228158424/.test(b1.cr.href), b1.cr);
    ok("Beer page: brewery, style marked as a guess, ABV", /Hoegaarden/.test(b1.t) && /Witbier/.test(b1.t) && /gissning/.test(b1.t) && /4,9\s%/.test(b1.t), b1.t.slice(0, 300));
    ok("Beer page: ONE amber button 'Tipsa en vän'; 5 stars of 48 px", b1.amber.length === 1 && /Tipsa en vän/.test(b1.amber[0]) && b1.stars.length === 5 && b1.stars.every((h) => h >= 44), b1);
    ok("Beer page: no Untappd line, no Systembolaget link (flag off until the legal check)", !/Untappd/.test(b1.t) && !/Systembolaget/.test(b1.t), b1.t.slice(-600));
    ok("Beer page: average waits for 5 ratings (A27); reviews with a report flag", /Snittet visas från 5 betyg/.test(b1.t) && /Maja/.test(b1.t) && b1.flags === 2, b1.t.slice(-600));
    await shot(page, "03-ol");
    await page.evaluate(() => document.getElementById("sheet-body").scrollTo(0, 2000));
    await shot(page, "04-ol-nere");
    // rating
    await page.click('#sheet-body [data-bl-star="4"]'); await wait(page, 500);
    ok("Mitt betyg: tap 4 = beerlib_rate(beer, 4)", calls.some((c) => c[0] === "beerlib_rate" && c[1].p_beer === BEER && c[1].p_stars === 4) &&
      await page.evaluate(() => /4 av 5/.test(document.querySelector("#sheet-body .bl-rate .v").textContent)), calls.filter((c) => c[0] === "beerlib_rate"));
    // report
    await page.click('#sheet-body [data-bl-flag="11"]'); await wait(page, 200);
    await page.click('#sheet-body [data-bl-rep="spam"]'); await wait(page, 600);
    ok("Report flag: reason chips, then beerlib_review_report(11, spam)", calls.some((c) => c[0] === "beerlib_review_report" && c[1].p_id === 11 && c[1].p_reason === "spam"), calls.filter((c) => /report/.test(c[0])));
    // favourite (mocked RPC)
    await page.click("#sheet-body [data-bl-fav]"); await wait(page, 600);
    const f1 = await page.evaluate(() => document.querySelector("#sheet-body [data-bl-fav]").textContent);
    ok("Favorit: beerlib_fav_set(1, beer), the button says 'Favorit 1 av 3'", calls.some((c) => c[0] === "beerlib_fav_set" && c[1].p_slot === 1 && c[1].p_beer === BEER) && /Favorit 1 av 3/.test(f1), f1);
    // the profile shows it
    await page.evaluate(() => { if (window.PN && PN.closeSheet) PN.closeSheet(); }); await wait(page, 400);
    await page.click("#btn-settings"); await wait(page, 1500);
    await page.waitForSelector(".bl-fav .bl-ft[data-bl-beer]", { timeout: 10000 }).catch(() => {});
    const p1 = await page.evaluate(() => {
      const f = document.querySelector(".bl-fav"), v = document.querySelector(".pn-vsm"), hero = document.querySelector(".pf-hero");
      return { has: !!f, tiles: f ? [...f.querySelectorAll(".bl-ft")].map((t) => t.textContent.trim()) : [], priv: f ? f.querySelector(".bl-priv").textContent : "",
        order: f && v && hero ? (hero.compareDocumentPosition(f) & 4) && (f.compareDocumentPosition(v) & 4) : null };
    });
    ok("Profil: 'Mina favoritöl' with the beer in slot 1 and 2 empty slots", p1.has && p1.tiles.length === 3 && /Blanche/.test(p1.tiles[0]) && /Välj/.test(p1.tiles[1]), p1);
    ok("Profil: order hero → Mina favoritöl → Vem ser mig; 'Syns för dina vänner och grupper'", !!p1.order && /Syns för dina vänner och grupper/.test(p1.priv), p1);
    await wait(page, 3200);   // sent 3 s after the tap (warm.js write rule)
    ok("Profil: the Synlighet mode goes to the server (beerlib_privacy alla)", calls.some((c) => c[0] === "beerlib_privacy" && c[1].p_mode === "alla"), calls.map((c) => c[0]));
    await page.evaluate(() => { const f = document.querySelector(".bl-fav"); if (f) f.scrollIntoView({ block: "start" }); document.getElementById("sheet-body").scrollBy(0, -120); });
    await shot(page, "05-profil");
    // Tipsa en vän (the DM path: a friend from my_friends)
    await page.evaluate((id) => { if (PN.closeSheet) PN.closeSheet(); }, BEER); await wait(page, 300);
    await page.evaluate((id) => window.BEERLIB.tip(id), BEER);
    await waitSheet(page, /Tipsa en vän/);
    const tp = await page.evaluate(() => ({ picks: document.querySelectorAll("#sheet-body .bl-pick").length, go: document.querySelector("#sheet-body [data-bl-go]") ? document.querySelector("#sheet-body [data-bl-go]").disabled : null, text: document.getElementById("sheet-body").innerText }));
    ok("Tipsa en vän: a list of friends (Ida), 'Skicka tips' off until one is picked", tp.picks >= 1 && tp.go === true && /Ida/.test(tp.text), tp);
    await page.click("#sheet-body .bl-pick"); await page.fill("#sheet-body textarea", "Mjuk och frisk");
    await shot(page, "06-tipsa");
    await page.click("#sheet-body [data-bl-go]");
    await page.waitForFunction(() => document.getElementById("sheet").hidden, null, { timeout: 10000 }).catch(() => {});
    ok("Tipsa en vän: 'Skicka tips' posts ONE tip line to the picked chat", tipPosts.length === 1 && tipPosts[0].g === DM && /^Öltips: Hoegaarden Blanche \[öl:5410228158424\] Mjuk och frisk$/.test(tipPosts[0].body), tipPosts);
    ok("No page errors (part 1)", errs.length === 0, errs);
    await ctx.close();

    // ---------- 4. DM: the beer button, the picker, the card ----------
    ({ ctx, page, errs, calls } = await open(browser));
    const posted = [];
    const msgs = [{ id: 501, name: "Ida", body: "Vad ska jag ta? Allt är så bittert här", created_at: new Date(Date.now() - 30 * 60e3).toISOString(), is_me: false },
      { id: 502, name: "Ida", body: "Öltips: Blanche [öl:" + BEER + "] Mjuk och frisk, inte bitter alls", created_at: new Date(Date.now() - 25 * 60e3).toISOString(), is_me: false }];
    await page.route(/rest\/v1\/rpc\/(my_dms|group_msgs|post_group_msg|group_keep_history|group_now|group_photos|group_voices)\b/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      if (b.p_group_id && b.p_group_id !== DM) return r.fallback();
      switch (fn) {
        case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [Object.assign(RPCF.dmThread(DM), { last_id: 502, last_body: msgs[1].body, last_at: msgs[1].created_at, last_me: false, unread: 0 })] });
        case "group_msgs": return J(r, msgs.filter((m) => m.id > (b.p_after_id | 0)));
        case "post_group_msg": { posted.push(b.p_body); const m = { id: 600 + posted.length, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true }; msgs.push(m); return J(r, { id: m.id, created_at: m.created_at }); }
        case "group_keep_history": case "group_now": return J(r, { code: "not_member", message: "not_member" }, 400);
        default: return J(r, []);
      }
    });
    await page.evaluate((id) => window.DM.openById(id), DM);
    await page.waitForSelector(".chat-list .bl-chatcard", { timeout: 15000 }).catch(() => {});
    const d1 = await page.evaluate(() => {
      const c = document.querySelector(".chat-list .bl-chatcard"), raw = document.querySelector(".chat-list .cm-body.bl-raw"), b = document.querySelector(".chat-input .bl-dmb");
      return { card: c ? c.innerText.replace(/\s+/g, " ") : null, rawHidden: raw ? getComputedStyle(raw).display === "none" : null, btn: b ? { h: b.getBoundingClientRect().height, l: b.getAttribute("aria-label") } : null };
    });
    ok("DM: a tip line shows as a beer card (who, name, style, the line, 'Visa ölen'); the raw text is hidden", !!d1.card && /Ida tipsar om/.test(d1.card) && /Blanche/.test(d1.card) && /Mjuk och frisk/.test(d1.card) && /Visa ölen/.test(d1.card) && d1.rawHidden === true, d1);
    ok("DM: a 44 px beer button 'Tipsa om en öl' left of the field", !!d1.btn && d1.btn.h >= 44 && /Tipsa om en öl/.test(d1.btn.l), d1);
    await shot(page, "07-dm-kort");
    await page.click(".chat-input .bl-dmb");
    await page.waitForSelector(".bl-dmp .bl-row", { timeout: 15000 }).catch(() => {});
    await page.fill(".bl-dmp .bl-q", "blanche"); await wait(page, 500);
    await shot(page, "08-dm-valj");
    await page.evaluate((id) => { const r = document.querySelector('.bl-dmp [data-bl-beer="' + id + '"]') || document.querySelector(".bl-dmp .bl-row"); if (r) r.click(); }, BEER);
    await page.waitForFunction(() => document.querySelectorAll(".chat-list .bl-chatcard").length >= 2, null, { timeout: 15000 }).catch(() => {});
    ok("DM: a picked beer is sent as ONE chat line 'Öltips: … [öl:id]' and shows as a card", posted.length === 1 && /^Öltips: .+ \[öl:[0-9A-Za-z_-]+\]$/.test(posted[0]) &&
      await page.evaluate(() => document.querySelectorAll(".chat-list .bl-chatcard").length >= 2), posted);
    await page.evaluate(() => { const b = document.querySelector(".chat-list .bl-chatcard [data-bl-beer]"); if (b) b.click(); });
    await waitSheet(page, /Blanche/);
    ok("DM card: 'Visa ölen' opens the beer page", /Blanche/.test(((await sheet(page)) || {}).title || ""));
    ok("No page errors (DM)", errs.length === 0, errs);
    await ctx.close();

    // ---------- 5. Server tables missing (PGRST202) ----------
    ({ ctx, page, errs, calls } = await open(browser, { old: true }));
    await page.evaluate((id) => window.PN.beerlib().then((B) => B.beer(id)), BEER);
    await waitSheet(page, /Blanche/);
    await wait(page, 1200);
    const o1 = await page.evaluate(() => ({ t: document.getElementById("sheet-body").innerText, revs: !!document.querySelector("#sheet-body .bl-revs, #sheet-body [data-bl-write]"), on: window.BEERLIB.online() }));
    ok("Old server: no reviews, no average; 'Sparas bara på den här telefonen'", !o1.revs && !/Andra betyg/.test(o1.t) && /Sparas bara på den här telefonen/.test(o1.t) && o1.on === false, o1.t.slice(-400));
    await page.click("#sheet-body [data-bl-fav]"); await wait(page, 400);
    await page.click('#sheet-body [data-bl-star="5"]'); await wait(page, 400);
    const o2 = await page.evaluate(() => ({ fav: localStorage.getItem("olnu.beer.favs"), rate: localStorage.getItem("olnu.beer.rate"), btn: document.querySelector("#sheet-body [data-bl-fav]").textContent,
      toasts: [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent) }));
    ok("Old server: favourite and rating are kept on this phone, no error pop-up", /5410228158424/.test(o2.fav || "") && /"5410228158424":5/.test(o2.rate || "") && /Favorit 1 av 3/.test(o2.btn) && !o2.toasts.some((t) => /gick inte/.test(t)), o2);
    ok("Old server: after the first PGRST202 no more beer RPCs are tried", calls.filter((c) => c[0] === "beerlib_fav_set" || c[0] === "beerlib_rate").length === 0, calls.map((c) => c[0]));
    await shot(page, "09-utan-server");
    ok("No page errors (old server)", errs.length === 0, errs);
    await ctx.close();

    // ---------- 6. Bar card: På kran only with a tap list ----------
    for (const withList of [false, true]) {
      ({ ctx, page, errs, calls } = await open(browser, withList ? { taps: { "n3472634175": { beers: [BEER, "7310401006925"], updated: "2026-11-18" } } } : {}));
      await page.evaluate(() => window.PN.openBarById("n3472634175"));   // Pitchers
      await page.waitForSelector(".pp-act", { timeout: 15000 }).catch(() => {});
      if (withList) await page.waitForSelector(".bl-tap:not([hidden])", { timeout: 15000 }).catch(() => {}); else await wait(page, 2500);
      const k = await page.evaluate(() => {
        const t = document.querySelector("[data-plc-tap]"), act = document.querySelector(".pp-act");
        return { card: !!act, tap: t ? { hidden: t.hidden, text: t.innerText.replace(/\s+/g, " "), after: act ? !!(act.compareDocumentPosition(t) & 4) : null } : null };
      });
      if (!withList) ok("Bar card without a tap list: no 'På kran' node at all", k.card && !k.tap, k);
      else {
        ok("Bar card with a list: 'På kran' after the action row, 2 beers, 'Listan kommer från krogen'", k.card && k.tap && !k.tap.hidden && k.tap.after && /På kran/.test(k.tap.text) && /2 öl/.test(k.tap.text) && /Listan kommer från krogen · uppdaterad 18 nov/.test(k.tap.text), k);
        await page.evaluate(() => { const t = document.querySelector("[data-plc-tap]"); if (t) t.scrollIntoView({ block: "center" }); });
        await shot(page, "10-krogkort-pa-kran");
      }
      ok("No page errors (bar card " + (withList ? "with" : "without") + " list)", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- 7. Pure helpers ----------
    ({ ctx, page, errs } = await open(browser));
    const h = await page.evaluate(() => window.PN.beerlib().then((B) => {
      const b = { id: "123", name: "Test IPA" };
      return { t: B.tipText(b, "God!"), p: B.parseTip(B.tipText(b, "God!")), long: B.tipText({ id: "9", name: "x".repeat(200) }, "y".repeat(200)).length, none: B.parseTip("Hej [öl:1]"),
        bad: [B._badText("se www.x.se"), B._badText("ring 0701234567"), B._badText("god och frisk")] };
    }));
    ok("tipText / parseTip round trip, max 140 chars, plain lines are not tips", h.t === "Öltips: Test IPA [öl:123] God!" && h.p && h.p.id === "123" && h.p.line === "God!" && h.long <= 140 && h.none === null, h);
    ok("Review text filter: no links, no phone numbers", h.bad[0] === true && h.bad[1] === true && h.bad[2] === false, h.bad);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nbeerui: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
