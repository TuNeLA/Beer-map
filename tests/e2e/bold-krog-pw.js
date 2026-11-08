// 👑 Kvällens krog (bd04, flag bold_krog). Mocked Supabase (ds-helpers). node bold-krog-pw.js <port> [shotsDir]
// Checks: the crown sits on the leading bar only (the old weekly beer crown is gone while the flag is on), the bar sheet board
// (people · skål, friends here, "Aldrig öl", no drink numbers), the LIVE ticker line, Topplista, no crown under 5 people,
// the morning lines (ticker "Igår…", Din kväll "… blev Pitchers. Du va där!"), and flag OFF = the old crown again.
process.argv[2] = process.argv[2] || "8962";
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const SHOTS = process.argv[3] || require("./env.js").OUT + "bold-shots/";
require("fs").mkdirSync(SHOTS, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const PITCH = "n3472634175", PARMA = "x-la-parma-ludvika";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const LIVE = { v: 1, town: "Ludvika", live: true, min_people: 5, night: "x",
  leader: { bar_id: PITCH, name: "Pitchers", people: 14, skal: 6, score: 48 },
  top: [{ bar_id: PITCH, name: "Pitchers", people: 14, skal: 6, score: 48 }, { bar_id: PARMA, name: "La Parma Pub & Restaurang", people: 9, skal: 2, score: 29 },
    { bar_id: "x-lobbybaren-ludvika", name: "Lobbybaren", people: 6, skal: 0, score: 18 }],
  friends: { [PITCH]: { n: 3, names: ["Lisa", "Ida"] } }, last: null };
let board = LIVE;
async function routes(page, flagOn) {
  await page.route(/rest\/v1\/rpc\/(bold_flags_get|bold_krog)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "bold_flags_get") return J(r, { bold_hemlage: false, bold_krog: !!flagOn, bold_skal_v2: false, bold_replay: false, bold_bump: false });
    return J(r, flagOn ? board : { v: 1, off: true });
  });
}
async function start(browser, flagOn) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await routes(page, flagOn);
  await boot(page);
  await page.waitForFunction(() => window.BOLD && window.BOLD_KROG, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.BOLD.refresh()); await wait(page, 600);
  return { ctx, page };
}
const zoomTo = async (page, ll, z) => { await page.evaluate(([a, b, z]) => window.__map.setView([a, b], z, { animate: false }), [ll[0], ll[1], z]); await wait(page, 1800); };
const crowns = (page) => page.evaluate(() => [...document.querySelectorAll(".cm-king")].map((k) => { const m = k.closest(".cm"); const l = m && m.querySelector(".cm-lbl"); return l ? l.textContent : "?"; }));
const popup = (page, id) => page.evaluate((id) => window.BOLD.api().barPopup(window.BARS.byId(id)), id);
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    /* ---------- flag ON, live board ---------- */
    let { ctx, page } = await start(browser, true);
    await page.evaluate(() => window.BOLD_KROG.refresh()); await wait(page, 800);
    ok(await page.evaluate(() => !!(window.BOLD_KROG.data() && window.BOLD_KROG.data().leader)), "board loaded from bold_krog");
    await page.evaluate(() => window.BOLD.api().render()); await zoomTo(page, [60.1506, 15.1873], 17);
    let c = await crowns(page);
    ok(c.length === 1 && /Pitchers/.test(c[0]), "one crown, on Pitchers (old beer crown gone)", c);
    await page.screenshot({ path: SHOTS + "krog-1-crown.png" });
    let h = await popup(page, PITCH);
    ok(/Kvällens krog · Ludvika/.test(h) && /14 pers · 6 skål/.test(h) && /Aldrig öl/.test(h), "bar sheet board: people · skål + Aldrig öl", h.match(/bk-box[\s\S]{0,200}/));
    ok(/Lisa, Ida \+ 1 kompis ä här/.test(h), "friends at this bar", (h.match(/bk-fr[^<]*<[^>]*>[^<]*<\/svg>?[^<]*/) || [""])[0]);
    ok(!/🍺\s*\d|\d+\s*🍺|\böl\b\s*\d/i.test((h.match(/bk-box[\s\S]*?<\/div>/) || [""])[0]), "no drink numbers in the board");
    await page.evaluate((id) => window.BOLD.api().openBar(window.BARS.byId(id)), PITCH); await wait(page, 2200);
    ok(await page.evaluate(() => { const b = document.querySelector(".bk-box"); if (b) b.scrollIntoView({ block: "center" }); return !!b; }), "the board is in the open bar sheet");
    await wait(page, 400); await page.screenshot({ path: SHOTS + "krog-2-barsheet.png" });
    const tick = await page.evaluate(() => window.NEWS.build(window.NEWS.last().beers, window.NEWS.last().ctx).map((x) => x.text));
    ok(tick.some((t) => /Kvällens krog i Ludvika: Pitchers leder \(14 pers\)/.test(t)), "LIVE ticker line", tick.slice(0, 3));
    await page.evaluate(() => { const s = document.getElementById("sheet-close"); if (s) s.click(); window.__map.closePopup(); }); await wait(page, 400);
    await page.evaluate(() => document.getElementById("btn-top").click()); await wait(page, 1500);
    ok(await page.evaluate(() => !!document.querySelector("#sheet .bk-top .bk-box")), "Topplista ikväll shows the town board");
    await page.screenshot({ path: SHOTS + "krog-3-top.png" });
    await page.evaluate(() => { const s = document.getElementById("sheet-close"); if (s) s.click(); }); await wait(page, 400);
    /* under 5 people: no crown */
    await page.evaluate((d) => window.BOLD_KROG._set(d), Object.assign({}, LIVE, { leader: null, top: [{ bar_id: PITCH, name: "Pitchers", people: 3, skal: 0, score: 9 }] }));
    await wait(page, 1500); c = await crowns(page);
    ok(c.length === 0, "no crown under 5 people", c);
    h = await popup(page, PITCH);
    ok(/Ingen krona än\. 5 pers behövs/.test(h), "board says 5 people are needed");
    /* the morning after */
    await page.evaluate(() => window.BOLD_KROG._set({ v: 1, town: "Ludvika", live: false, top: [], friends: {}, leader: null,
      last: { name: "Pitchers", bar_id: "n3472634175", people: 14, skal: 6, was_there: true } }));
    const tick2 = await page.evaluate(() => window.NEWS.build(window.NEWS.last().beers, window.NEWS.last().ctx).map((x) => x.text));
    ok(tick2.some((t) => /Igår blev Pitchers Kvällens krog i Ludvika/.test(t)), "morning ticker line", tick2.slice(0, 3));
    await page.evaluate(() => { const k = window.NEWS.nightKey(); localStorage.setItem("olnu.nightlog", JSON.stringify({ key: k, beers: 6, others: 1, bars: ["n3472634175"], skal: 5, best: 6, badges: [] })); window.EXTRAS.showNight(); });
    await wait(page, 1500);
    const nl = await page.evaluate(() => { const p = document.querySelector("#sheet .bk-night"); return p ? p.textContent : ""; });
    ok(/Kvällens krog i Ludvika blev Pitchers\. Du va där!/.test(nl), "Din kväll line", nl);
    await page.screenshot({ path: SHOTS + "krog-4-dinkvall.png" });
    await ctx.close();
    /* ---------- flag OFF = old behaviour ---------- */
    ({ ctx, page } = await start(browser, false));
    await zoomTo(page, [60.1506, 15.1873], 17); await wait(page, 1500);
    c = await crowns(page);
    h = await popup(page, PITCH);
    ok(!/bk-box/.test(h), "flag off: no board in the bar sheet");
    const safe = await page.evaluate(() => !!window.SAFETY);   // safety.js turns the weekly beer crown off by itself
    ok(safe ? !c.some((x) => /Pitchers/.test(x)) : c.some((x) => /La Parma/.test(x)), "flag off: the old crown behaviour (" + (safe ? "SAFETY: none" : "weekly crown") + ")", c);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e.message); }
  await browser.close();
  console.log(`bold-krog: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
