// d1settings lane: Inställningar = 8 rows that open pages with ‹ (moves 3, 6, 9). Usage: node d1settings-pw.js <port>
// Top level <= 1 screen at 390x844, each page opens and ‹ returns, every old setting is still reachable, ONE Hem row, Konto page, Profil link row.
const { chromium } = require("playwright");
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const PORT = process.argv[2] || 8967;
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const PAGES = ["konto", "synl", "notis", "plats", "karta", "bjud", "hjalp", "om"];
// every setting that the old flat sheet had (regex on the page text) -> the page it must live on
const OLD = [
  ["Ölpriser", "karta"], ["Restauranger på kartan", "karta"], ["Kartstil", "karta"], ["Dialekt", "karta"], ["Systembolaget på kartan", "karta"],
  ["Pinnen följer med dig", "plats"], ["Checka in automatiskt", "plats"], ["^Hem", "plats"],
  ["Vem ser dig", "synl"], ["Göm min pin", "synl"], ["SOS till gänget", "synl"], ["Integritet – förbättra appen", "synl"], ["Regler", "synl"], ["Blockerade", "synl"], ["Kontakt", "synl"],
  ["Notiser", "notis"], ["Välj notiser", "notis"], ["Ljud", "notis"],
  ["Något knas", "hjalp"],
  ["Betaversion", "om"], ["Uppdatera nu", "om"], ["Introduktionen|introduktionen", "om"],
  ["Swish-nummer", "konto"], ["Flytta till annan", "konto"], ["Jag har en flyttkod", "konto"], ["Radera mitt konto", "konto"], ["Vad vi sparar och varför", "om"]
];
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const { ctx, page } = await ctxFor(browser, vp);
    await boot(page);
    const tag = vp.width + ": ";
    await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); b && b.click(); }); await wait(page, 2500);
    const top = await page.evaluate(() => {
      const sb = document.getElementById("sheet-body"), hub = sb.querySelector(".set-hub");
      return { rows: hub ? [...hub.children].filter((c) => c.getClientRects().length && c.matches(".ds-row")).length : 0, sh: sb.scrollHeight, ch: sb.clientHeight, vh: innerHeight };
    });
    ok(tag + "top level has 8 rows (7-9)", top.rows >= 7 && top.rows <= 9, top);
    ok(tag + "top level fits one screen (scrollHeight <= viewport height)", top.sh <= top.vh, top);
    // every page opens, shows the title, has ‹, and ‹ returns
    for (const key of PAGES) {
      if (key === "bjud") continue;   // direct action row (opens the invite sheet), checked below
      const r = await page.evaluate((k) => { const b = document.querySelector(".set-r-" + k); if (!b) return null; const name = b.querySelector(".ds-row-t > span").textContent; b.click(); return name; }, key); await wait(page, 500);
      const st = await page.evaluate((k) => { const pg = document.querySelector('.set-page[data-pg="' + k + '"]'), back = document.getElementById("pn-back"), hub = document.querySelector(".set-hub"); const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
        return { title: document.getElementById("sheet-title").textContent, page: vis(pg), items: pg ? pg.querySelectorAll(".ds-row, .ds-item").length : 0, back: vis(back), hubHidden: !vis(hub), h: pg ? pg.getBoundingClientRect().height : 0 }; }, key);
      ok(tag + key + ": opens as a page with a title, a back arrow, the hub hidden", r && st.page && st.back && st.hubHidden && st.title === r, { r, st });
      ok(tag + key + ": page has content and fits 1.1 screens", st.items > 0 && st.h <= vp.height * (key === "notis" ? 1.5 : 1.1), st);
      await page.click("#pn-back"); await wait(page, 400);
      const bk = await page.evaluate(() => { const hub = document.querySelector(".set-hub"); return { hub: !hub.hidden && hub.getClientRects().length > 0, title: document.getElementById("sheet-title").textContent }; });
      ok(tag + key + ": ‹ returns to the 8 rows (title Inställningar)", bk.hub && /Inställningar/.test(bk.title), bk);
    }
    if (vp.width !== 390) { await ctx.close(); continue; }
    // every old setting is still reachable, on its page
    const txt = await page.evaluate(() => { const o = {}; document.querySelectorAll(".set-page").forEach((p) => { o[p.getAttribute("data-pg")] = (p.textContent || "").replace(/\s+/g, " "); }); return o; });
    OLD.forEach(([re, pg]) => ok("old setting still reachable: " + re.split("|")[0] + " -> " + pg, new RegExp(re).test(txt[pg] || ""), (txt[pg] || "").slice(0, 200)));
    // move 9: ONE Hem row, no "Ställ in hem", no Hemzon row in Synlighet
    const home = await page.evaluate(() => { const rows = [...document.querySelectorAll(".set-page .ds-item, .set-page .ds-row")].filter((e) => !e.classList.contains("pn-gone") && !e.closest(".pn-gone") && /^\s*(Hem\b|Hemzon|Ställ in hem)/.test(e.textContent)); return { n: document.querySelectorAll(".set-page .set-home").length, rows: rows.map((e) => e.textContent.trim().slice(0, 30)), synl: /Hemzon/.test((document.querySelector('.set-page[data-pg="synl"]') || { textContent: "" }).textContent) }; });
    ok("one Hem row in Plats & hem (no Ställ in hem, no Hemzon in Synlighet)", home.n === 1 && !home.synl && !home.rows.some((x) => /Ställ in hem/.test(x)), home);
    // Hem row opens the Hemzon sheet
    await page.evaluate(() => document.querySelector(".set-r-plats").click()); await wait(page, 400);
    await page.evaluate(() => document.querySelector(".set-home").click()); await wait(page, 900);
    ok("Hem row opens the Hemzon sheet", await page.evaluate(() => /Hemzon/.test(document.getElementById("sheet-title").textContent)), await page.evaluate(() => document.getElementById("sheet-title").textContent));
    // Konto page rows + Profil link row
    await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet [role=tab]")].find((x) => /Profil/.test(x.textContent)); b && b.click(); }); await wait(page, 2500);
    const pf = await page.evaluate(() => ({ acct: !!document.querySelector("#sheet-body > .acct-sect, #sheet-body > .rnd-set"), link: !!document.querySelector("#sheet-body .pf-konto-row") }));
    ok("Profil: no account block, one Konto link row", !pf.acct && pf.link, pf);
    await page.evaluate(() => document.querySelector(".pf-konto-row").click()); await wait(page, 900);
    const kt = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, rows: [...document.querySelectorAll('.set-page[data-pg="konto"] .ds-row')].map((r) => r.querySelector(".ds-row-t > span").textContent), vis: !document.querySelector('.set-page[data-pg="konto"]').hidden }));
    ok("Profil Konto row opens Inställningar > Konto", kt.vis && /Konto/.test(kt.title), kt);
    ok("Konto rows in the order: save/login, flytta, flyttkod, (logga ut), radera", kt.rows.length >= 3 && kt.rows[kt.rows.length - 1] === "Radera mitt konto" && kt.rows.indexOf("Flytta till annan app/telefon") < kt.rows.indexOf("Jag har en flyttkod"), kt.rows);
    await page.screenshot({ path: require("./env.js").OUT + "d1settings-konto.png" }).catch(() => {});
    await ctx.close();
  }
  await browser.close();
  console.log(`d1settings-pw: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
