// beerux-pw.js — owner 21 Nov 2026 (lane beerux), 390 px, mocked Supabase. Usage: node beerux-pw.js <port>
// I-139 a beer / style page opened from a list OUTSIDE the sheet (Sök › Öl tab, the person card) has a back (‹) that goes one
//       step back to that list (same words in the field, same scroll place); Android back too; ✕ still closes all. From a style
//       page and from a chat tip (both inside the sheet) the back goes to that sheet.        (js/sheetnav.js from(), "ext" level)
// I-145 no dead back: Inställningar shows no ‹ (its hidden in-body "‹ Inställningar" page back made one); a sweep of sheets:
//       a header ‹ shows only where its tap goes somewhere.                                    (js/pnui.js inBodyBack/liveBack)
// I-142 the beer photo is whole: the image box never grows past its frame (the grid's auto row cut 1664 Blanc to its neck);
//       the beer page photo sits on a blurred copy of itself.                                  (docs/beerlib.css, js/beerlib.js pic)
// I-143 my 3 favourite beers are the first chips of the "Vilken sort?" strip after ÖL! (no extra tap: the post goes at the
//       first tap as before); a pick sends its kind (set_beer_type) and keeps the beer on this phone; no favourites = the strip
//       as before.                                                                               (js/barsplus.js, js/beerlib.js saveMini)
// Old code: the I-139, I-145, I-142 and I-143 "favourites" checks FAIL.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const GID = "11111111-2222-3333-4444-555555555555";   // Ludvika Lager (d2-helpers)
const BLANC = "5740700980176";                          // 1664 Blanc Wheat Beer: hefeweizen, a tall 139x300 photo
const KRON = "5740700992636", MARI = "7310401006734";
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  const errs = [], calls = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/rest\/v1\/rpc\/(beerlib_\w+|set_beer_type|post_beer_v2)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (fn === "beerlib_favs_mine") return J(r, o.favs || []);
    if (fn === "beerlib_favs_for") return J(r, o.favsFor || []);
    if (fn === "beerlib_beer_get") return J(r, { my_stars: null, fav_slot: null, n: 0, avg: null, reviews: [] });
    if (fn === "set_beer_type") return J(r, { ok: true });
    if (fn === "post_beer_v2") return J(r, { accepted: true, beer_count: 7, drinks: 7, lat: b.p_lat, lng: b.p_lng, precise: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
      wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() });
    return J(r, {});
  });
  await page.route(/rest\/v1\/rpc\/group_msgs\b/, (r) => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (b.p_group_id !== GID) return r.fallback();
    return J(r, (b.p_after_id | 0) > 0 ? [] : [{ id: 702, name: "Oskar", body: "Öltips: 1664 Blanc Wheat Beer [öl:" + BLANC + "] Frisk", created_at: ago(15), is_me: false }]);
  });
  await boot(page);
  return { ctx, page, errs, calls };
}
// the header ‹ and the sheet now
const st = (page) => page.evaluate(() => {
  const b = document.getElementById("pn-back"), s = document.getElementById("sheet");
  return { open: !!s && !s.hidden, title: (document.getElementById("sheet-title") || {}).textContent || "", back: !!b && !b.hidden && getComputedStyle(b).display !== "none",
    panel: !!document.querySelector(".bs-beer-on"), q: (document.getElementById("bs-q") || {}).value || "", card: !!document.querySelector(".pc-x"), lv: window.SHEETNAV ? SHEETNAV._levels() : [] };
});
const waitTitle = (page, re) => page.waitForFunction((r) => { const s = document.getElementById("sheet"); return s && !s.hidden && new RegExp(r).test(document.getElementById("sheet-title").textContent); }, re.source, { timeout: 10000 }).catch(() => {});
const waitPanel = (page) => page.waitForFunction(() => !!document.querySelector(".bs-beer-on #bs-beer [data-bl-beer]"), null, { timeout: 10000 }).catch(() => {});
const tapBack = (page) => page.evaluate(() => document.getElementById("pn-back").click());

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  let ctx, page, errs, calls;
  // each part runs on its own: a FAIL in one (old code) does not hide the others
  const part = async (name, fn) => { try { await fn(); } catch (e) { fail++; console.log("FAIL " + name + " exception", e && e.message); } await ctx.close().catch(() => {}); };
  await part("I-139 Öl tab", async () => {
    // ---------- I-139: back from a beer page opened in Sök › Öl ----------
    ({ ctx, page, errs, calls } = await open(browser));
    await page.evaluate(() => window.BARSEARCH.open("beer")); await waitPanel(page);
    await page.evaluate(() => { const i = document.getElementById("bs-q"); i.value = "1664"; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForFunction((id) => !!document.querySelector("#bs-beer [data-bl-beer='" + id + "']"), BLANC, { timeout: 10000 }).catch(() => {});
    await wait(page, 300);
    const top0 = await page.evaluate(() => { const b = document.getElementById("bs-beer"); b.scrollTop = Math.min(120, b.scrollHeight - b.clientHeight); return b.scrollTop; });
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-beer='" + id + "']").click(), BLANC);
    await waitTitle(page, /1664 Blanc/); await wait(page, 500);
    let s = await st(page);
    ok("I-139 beer page from the Öl tab: a back (‹) in the header", s.open && s.back && !s.panel, s);
    await tapBack(page);
    await waitPanel(page); await wait(page, 500);
    s = await st(page);
    const top1 = await page.evaluate(() => document.getElementById("bs-beer").scrollTop);
    ok("I-139 ‹ = the Öl tab again with the same words in the field", !s.open && s.panel && s.q === "1664", s);
    ok("I-139 ‹ keeps the scroll place of the list", Math.abs(top1 - top0) <= 4, { top0, top1 });
    // Android back (history) does the same
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-beer='" + id + "']").click(), BLANC);
    await waitTitle(page, /1664 Blanc/); await wait(page, 500);
    await page.evaluate(() => history.back());
    await waitPanel(page); await wait(page, 400);
    s = await st(page);
    ok("I-139 Android back on that beer page = the Öl tab again", !s.open && s.panel, s);
    // ✕ closes all: no panel comes back
    await page.evaluate((id) => document.querySelector("#bs-beer [data-bl-beer='" + id + "']").click(), BLANC);
    await waitTitle(page, /1664 Blanc/); await wait(page, 400);
    await page.evaluate(() => document.getElementById("sheet-close").click()); await wait(page, 900);
    s = await st(page);
    ok("I-139 ✕ on that beer page closes all (no panel)", !s.open && !s.panel, s);
    // Öl tab → style page → beer → ‹ = style → ‹ = Öl tab
    await page.evaluate(() => window.BARSEARCH.open("beer")); await waitPanel(page);
    await page.evaluate(() => { const i = document.getElementById("bs-q"); if (i.value) { i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); } });
    await page.waitForFunction(() => !!document.querySelector("#bs-beer [data-bl-style]"), null, { timeout: 10000 }).catch(() => {});
    const stName = await page.evaluate(() => { const t = document.querySelector("#bs-beer [data-bl-style]"); const n = t.querySelector("b").textContent; t.click(); return n; });
    await waitTitle(page, new RegExp(stName.replace(/[()]/g, "."))); await wait(page, 500);
    s = await st(page);
    ok("I-139 style page from the Öl tab: a back (‹)", s.open && s.back && s.title === stName, s);
    await page.evaluate(() => document.querySelector("#sheet-body [data-bl-beer]").click());
    await page.waitForFunction((n) => document.getElementById("sheet-title").textContent !== n, stName, { timeout: 10000 }).catch(() => {});
    await wait(page, 500);
    await tapBack(page); await waitTitle(page, new RegExp(stName.replace(/[()]/g, "."))); await wait(page, 400);
    s = await st(page);
    ok("I-139 beer from a style page: ‹ = the style page (with its own ‹ still there)", s.open && s.title === stName && s.back, s);
    await tapBack(page); await waitPanel(page); await wait(page, 300);
    s = await st(page);
    ok("I-139 … and ‹ again = the Öl tab", !s.open && s.panel, s);
    await page.evaluate(() => window.BARSEARCH.close()); await wait(page, 600);
    // a chat tip (inside the sheet): ‹ = the chat
    await page.evaluate((g) => window.SOCIAL.openChat({ id: g, name: "Ludvika Lager" }), GID);
    await page.waitForSelector(".chat-list .bl-chatcard [data-bl-beer]", { timeout: 15000 }).catch(() => {});
    const chatTitle = await page.evaluate(() => document.getElementById("sheet-title").textContent);
    await page.evaluate(() => document.querySelector(".chat-list .bl-chatcard [data-bl-beer]").click());
    await waitTitle(page, /1664 Blanc/); await wait(page, 500);
    s = await st(page);
    ok("I-139 beer page from a chat tip: a back (‹)", s.open && s.back, s);
    await tapBack(page); await page.waitForFunction((t) => document.getElementById("sheet-title").textContent === t, chatTitle, { timeout: 8000 }).catch(() => {});
    s = await st(page);
    ok("I-139 ‹ = the chat again", s.open && s.title === chatTitle, { s, chatTitle });
    ok("I-139 no page errors", errs.length === 0, errs);
    await ctx.close();

  });
  await part("I-139 card", async () => {
    // ---------- I-139: the person card ----------
    ({ ctx, page, errs, calls } = await open(browser, { favsFor: [{ slot: 1, beer: BLANC }] }));
    await page.evaluate((g) => window.PROFCARD.open({ g: { id: g, name: "Ludvika Lager" }, name: "Lisa", k: "cccccccccccc", is_me: false, live: true, n: 2 }), GID);
    await page.waitForSelector(".bl-pcf [data-bl-beer]", { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.querySelector(".bl-pcf [data-bl-beer]").click());
    await waitTitle(page, /1664 Blanc/); await wait(page, 500);
    s = await st(page);
    ok("I-139 beer page from the person card: a back (‹)", s.open && s.back && !s.card, s);
    await tapBack(page);
    await page.waitForSelector(".pc-x", { timeout: 8000 }).catch(() => {});
    s = await st(page);
    ok("I-139 ‹ = the person card again", !s.open && s.card, s);
    ok("I-139 card: no page errors", errs.length === 0, errs);
    await ctx.close();

  });
  await part("I-145", async () => {
    // ---------- I-145: no dead back ----------
    ({ ctx, page, errs, calls } = await open(browser));
    await page.evaluate(() => document.getElementById("btn-settings").click()); await waitTitle(page, /Profil/); await wait(page, 600);
    await page.evaluate(() => document.querySelector('.pf-tabs [data-pf="s"]').click()); await waitTitle(page, /Inställningar/); await wait(page, 600);
    s = await st(page);
    ok("I-145 Inställningar: no back (‹) in the header", s.open && !s.back, s);
    // a settings page has a real step back: ‹ shows, works, and goes away again
    await page.evaluate(() => { const r = document.querySelector("#sheet-body .set-hub button, #sheet-body .set-hub [role=button]"); if (r) r.click(); }); await wait(page, 600);
    const sub = await st(page);
    await tapBack(page); await wait(page, 600);
    const hub = await page.evaluate(() => { const h = document.querySelector("#sheet-body .set-hub"); return !!h && !h.hidden; });
    s = await st(page);
    ok("I-145 a settings page: ‹ shows, goes back to the list, then hides", sub.back && hub && !s.back && s.open, { sub, hub, s });
    // sweep: a fresh sheet never shows a ‹ whose tap does nothing
    const sweep = [];
    for (const [name, how] of [["Profil", "#btn-settings"], ["Topplista", "#btn-top"], ["Grupper", "#btn-groups"], ["Öl (direkt)", "beer"]]) {
      await page.evaluate(() => { try { PN.closeSheet(); } catch (e) {} }); await wait(page, 700);
      if (how === "beer") await page.evaluate((id) => PN.beerlib().then((B) => B.beer(id)), BLANC);
      else await page.evaluate((sel) => document.querySelector(sel).click(), how);
      await wait(page, 1500);
      const a = await st(page);
      let moved = null;
      if (a.back) {
        const html0 = await page.evaluate(() => document.getElementById("sheet-body").innerHTML.length + "|" + document.getElementById("sheet-title").textContent);
        await tapBack(page); await wait(page, 700);
        const b = await st(page);
        moved = !b.open || b.title !== a.title || (await page.evaluate(() => document.getElementById("sheet-body").innerHTML.length + "|" + document.getElementById("sheet-title").textContent)) !== html0;
      }
      sweep.push({ name, open: a.open, back: a.back, moved });
    }
    ok("I-145 sweep: no fresh sheet shows a dead ‹ (Profil, Topplista, Grupper, a beer page)", sweep.every((x) => x.open && (!x.back || x.moved)), sweep);
    ok("I-145 no page errors", errs.length === 0, errs);
    await ctx.close();

  });
  await part("I-142", async () => {
    // ---------- I-142: the whole photo ----------
    ({ ctx, page, errs, calls } = await open(browser));
    await page.evaluate((id) => PN.beerlib().then((B) => B.beer(id)), BLANC);
    await waitTitle(page, /1664 Blanc/);
    await page.waitForFunction(() => { const i = document.querySelector("#sheet .bl-bh .bl-pic img[data-bl-st]"); return i && i.complete && i.naturalHeight > 0; }, null, { timeout: 10000 }).catch(() => {});
    const ph = await page.evaluate(() => {
      const p = document.querySelector("#sheet .bl-bh .bl-pic"), im = p.querySelector("img[data-bl-st]"), pr = p.getBoundingClientRect(), r = im.getBoundingClientRect(), cs = getComputedStyle(im);
      // the drawn picture inside the img box (object-fit contain): its size from the natural ratio
      const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      return { box: [pr.width, pr.height], img: [r.width, r.height], fit: cs.objectFit, drawn: [Math.round(dw), Math.round(dh)], bg: !!p.querySelector("img.bl-pic-bg"), bgHidden: (p.querySelector("img.bl-pic-bg") || {}).getAttribute ? p.querySelector("img.bl-pic-bg").getAttribute("aria-hidden") : null,
        credit: !!document.querySelector("#sheet .bl-credit a[href*='openfoodfacts.org']") };
    });
    ok("I-142 beer page: the img box stays inside its frame (no cut-off photo)", ph.img[1] <= ph.box[1] + 0.5 && ph.img[0] <= ph.box[0] + 0.5 && ph.fit === "contain", ph);
    ok("I-142 beer page: the whole bottle is drawn (contain, height fills the frame)", ph.drawn[1] <= ph.box[1] + 1 && ph.drawn[1] >= ph.box[1] - 24, ph);
    ok("I-142 beer page: a blurred copy behind it (aria-hidden), the CC BY-SA credit stays", ph.bg && ph.bgHidden === "true" && ph.credit, ph);
    await page.evaluate(() => PN.closeSheet()); await wait(page, 500);
    await page.evaluate(() => window.BARSEARCH.open("beer")); await waitPanel(page);
    await page.waitForFunction(() => [...document.querySelectorAll("#bs-beer .bl-row .bl-pic img")].some((i) => i.complete && i.naturalHeight), null, { timeout: 10000 }).catch(() => {});
    const rows = await page.evaluate(() => [...document.querySelectorAll("#bs-beer .bl-row .bl-pic")].slice(0, 12).map((p) => { const i = p.querySelector("img"); if (!i) return null; const a = p.getBoundingClientRect(), b = i.getBoundingClientRect(); return [Math.round(a.height), Math.round(b.height)]; }).filter(Boolean));
    ok("I-142 list rows: every photo box stays inside its frame", rows.length > 3 && rows.every((x) => x[1] <= x[0] + 1), rows);
    ok("I-142 no page errors", errs.length === 0, errs);
    await ctx.close();

  });
  await part("I-143 favs", async () => {
    // ---------- I-143: favourites in the "Vilken sort?" strip ----------
    ({ ctx, page, errs, calls } = await open(browser, { favs: [{ slot: 1, beer: BLANC }, { slot: 2, beer: KRON }, { slot: 3, beer: MARI }] }));
    await page.evaluate(() => PN.beerlib().then((B) => B.favs(true)));
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("olnu.beer.favMini")).l.length === 3; } catch (e) { return false; } }, null, { timeout: 10000 }).catch(() => {});
    const mini = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.beer.favMini") || "null"));
    ok("I-143 the library keeps a small copy of my favourites with their strip kind", !!mini && mini.l.map((x) => x.id + ":" + x.t).join(",") === BLANC + ":vete," + KRON + ":lager," + MARI + ":lager", mini);
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForSelector(".bp-strip:not([hidden]) .bp-st-fav", { timeout: 6000 }).catch(() => {});
    const fv = await page.evaluate(() => {
      const s = document.querySelector(".bp-strip:not([hidden])"); if (!s) return null;
      const f = [...s.querySelectorAll(".bp-st-fav [data-bpf]")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute("data-bpf"), t: b.textContent.trim(), w: r.width, h: r.height, l: r.left, rt: r.right }; });
      return { fav: f, kinds: s.querySelectorAll("[data-bpt]").length, first: s.querySelector(".bp-st-chips [data-bpf], .bp-st-chips [data-bpt]").getAttribute("data-bpf"), label: (s.querySelector(".bp-st-lbl") || {}).textContent, strips: document.querySelectorAll(".bp-strip:not([hidden])").length };
    });
    ok("I-143 ÖL! still posts at the first tap (no extra step)", calls.filter((c) => c[0] === "post_beer_v2").length === 1, calls.map((c) => c[0]));
    ok("I-143 the strip shows my 3 favourites first, then the 10 kinds (one strip)", !!fv && fv.fav.length === 3 && fv.fav[0].id === BLANC && fv.first === BLANC && fv.kinds === 10 && fv.strips === 1 && fv.label === "Dina favoriter", fv);
    ok("I-143 favourite chips: 44 px targets, inside the screen, the name shows", !!fv && fv.fav.length === 3 && fv.fav.every((x) => x.h >= 44 && x.w >= 44 && x.l >= 0 && x.rt <= 390 && x.t.length > 3), fv && fv.fav);
    await page.evaluate((id) => document.querySelector(".bp-strip [data-bpf='" + id + "']").click(), BLANC);
    await page.waitForFunction(() => { const s = document.querySelector(".bp-strip"); return !s || s.hidden; }, null, { timeout: 5000 }).catch(() => {});
    await wait(page, 600);
    const after = await page.evaluate(() => ({ now: JSON.parse(localStorage.getItem("olnu.beer.now") || "null"), type: localStorage.getItem("olnu.beerType"), hidden: !document.querySelector(".bp-strip:not([hidden])"), toasts: document.querySelectorAll("#toasts .toast").length }));
    const sbt = calls.filter((c) => c[0] === "set_beer_type");
    ok("I-143 a favourite pick: its kind goes to the server (set_beer_type vete), the beer stays on this phone, the strip closes", sbt.length === 1 && sbt[0][1].p_type === "vete" && after.now && after.now.id === BLANC && after.type === "vete" && after.hidden, { sbt, after });
    ok("I-143 one text pop-up for that pick (at most)", after.toasts <= 1, after);
    ok("I-143 no page errors", errs.length === 0, errs);
    await ctx.close();

  });
  await part("I-143 none", async () => {
    // no favourites: the strip as before
    ({ ctx, page, errs, calls } = await open(browser, { favs: [] }));
    await page.evaluate(() => PN.beerlib().then((B) => B.favs(true))); await wait(page, 800);
    await page.evaluate(() => document.getElementById("btn-beer").click());
    await page.waitForSelector(".bp-strip:not([hidden]) [data-bpt]", { timeout: 6000 }).catch(() => {});
    const nf = await page.evaluate(() => { const s = document.querySelector(".bp-strip:not([hidden])"); return s ? { fav: s.querySelectorAll(".bp-st-fav").length, kinds: s.querySelectorAll("[data-bpt]").length } : null; });
    ok("I-143 no favourites: no favourites row, the 10 kinds as before", !!nf && nf.fav === 0 && nf.kinds === 10, nf);
    ok("I-143 (none) no page errors", errs.length === 0, errs);
  });
  await browser.close();
  console.log(`\nbeerux: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
