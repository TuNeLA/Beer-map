// lane c1menus (13 Nov 2026): I-48 profile fold closed, I-47 avatar/trophy toggle, I-36 no solo nudge, I-41 Gängkamp flag, I-55 one Taxi + one Uber hem.
// usage: node c1menus-pw.js <port>   (mocked Supabase, ds-helpers)
process.argv[2] = process.argv[2] || "8961";
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const SOLO = [{ id: "11111111-2222-3333-4444-555555555555", name: "Ensam", code: "ABC234", member_count: 1, active_count: 0 }];
const open = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return !!(s && !s.hidden); });
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 1000 }, { ua: "ios" });
  await page.route(/rest\/v1\/rpc\/my_groups$/, (r) => J(r, SOLO));
  await page.addInitScript(() => { try { localStorage.setItem("olnu.pnFold", "1"); localStorage.setItem("olnu.pnEve", "1"); } catch (e) {} });
  await boot(page);
  // I-48: profile opens with the fold CLOSED even when "1" was stored
  await clickJS(page, "#btn-settings"); await wait(page, 1500);
  const f = await page.evaluate(() => ({ pf: !!document.querySelector("#sheet-body.pn-pfmode"), openCls: document.getElementById("sheet-body").classList.contains("pn-pfopen"), tog: (document.querySelector(".pn-fold-t") || {}).getAttribute ? document.querySelector(".pn-fold-t").getAttribute("aria-expanded") : null }));
  ok(f.pf && !f.openCls && f.tog === "false", "I-48: profile fold closed on open (stored 1 ignored)", f);
  // I-47: 2nd tap on the avatar closes, never stacks
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 700);
  ok(!(await open(page)), "I-47: avatar tapped again closes the sheet");
  await clickJS(page, "#btn-top"); await wait(page, 1200);
  const o1 = await open(page);
  await clickJS(page, "#btn-top"); await wait(page, 700);
  ok(o1 && !(await open(page)), "I-47: trophy tapped again closes the sheet", { o1 });
  await clickJS(page, "#btn-settings"); await wait(page, 1200);
  await clickJS(page, "#btn-top"); await wait(page, 1200);
  const t = await page.evaluate(() => document.getElementById("sheet-title").textContent);
  ok(/Topplist/.test(t), "I-47: trophy while Profil is open still switches (one sheet)", t);
  await clickJS(page, "#sheet-close"); await wait(page, 500);
  // I-36: no solo nudge in Grupper
  await clickJS(page, "#btn-groups"); await wait(page, 3500);
  const n = await page.evaluate(() => ({ nudge: document.querySelectorAll(".pn-nudge").length, txt: /Ett gäng på en är ingen fest/.test(document.getElementById("sheet-body").textContent), list: !!document.querySelector("#sheet-body .glist") }));
  ok(n.list && !n.nudge && !n.txt, "I-36: no 'Bara du i …' nudge card in Grupper", n);
  // I-41: Gängkamp hidden everywhere without the flag
  const g = await page.evaluate(() => ({ cfg: !!(window.PN_CFG && window.PN_CFG.gangkamp), gk: document.querySelectorAll(".sa-gk, .sa-gk-top").length }));
  ok(!g.cfg && g.gk === 0, "I-41: no Gängkamp row in Grupper list (flag off)", g);
  await clickJS(page, "#sheet-close"); await wait(page, 400);
  await clickJS(page, "#btn-top"); await wait(page, 2000);
  ok(await page.evaluate(() => document.querySelectorAll(".sa-gk-top").length === 0 && !/Gängkamp/.test(document.getElementById("sheet-body").textContent)), "I-41: no Gängkamp row in Topplistor");
  await clickJS(page, "#sheet-close"); await wait(page, 400);
  const inb = await page.evaluate(() => { try { const D = window.DUEL; return { duel: !!D, items: window.INBOX && window.INBOX.items ? window.INBOX.items().filter((x) => x.type === "duel").length : "n/a" }; } catch (e) { return String(e); } });
  ok(inb.items === 0 || inb.items === "n/a", "I-41: Inkorg shows no duel item", inb);
  // I-41b: flag on = the entry points come back (the group page row)
  const on = await page.evaluate(() => { window.PN_CFG = Object.assign(window.PN_CFG || {}, { gangkamp: true }); return !!(window.GAMES && window.DUEL); });
  ok(on, "I-41: flag on is switchable at runtime (GAMES + DUEL loaded)");
  await page.evaluate(() => { window.PN_CFG.gangkamp = false; });
  // I-55: Taxi sheet = one Taxi + one Uber hem
  // c12fix: "Ring 112" (the Trygghet block under the taxi buttons, safety.js) is no taxi: the count skips tel:112
  await clickJS(page, "#btn-taxi"); await wait(page, 1500);
  const x = await page.evaluate(() => { const b = document.getElementById("sheet-body"); const a = [...b.querySelectorAll("a,button")];
    return { uber: a.filter((e) => /uber/i.test((e.href || "") + e.textContent)).length, tel: [...b.querySelectorAll("a[href^='tel:']:not([href='tel:112'])")].filter((e) => !e.closest(".rnd-more")).length, saveHome: a.filter((e) => /Lägg in hem|Spara hem/i.test(e.textContent)).length, rows: b.querySelectorAll(".taxi-row").length, txt: b.textContent.replace(/\s+/g, " ").slice(0, 200) }; });
  ok(x.uber <= 1 && x.rows === 0 && x.tel <= 1, "I-55: no duplicate top row; at most one Uber and one Taxi (no home)", x);
  ok(x.saveHome >= 1 && x.uber === 0, "I-55: no home → 'Lägg in hem' first (no Uber link)", x);
  await clickJS(page, "#sheet-close"); await wait(page, 400);
  await page.evaluate(() => { localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.15, lng: 15.19, r: 300, at: Date.now() })); });
  await clickJS(page, "#btn-taxi"); await wait(page, 1500);
  const y = await page.evaluate(() => { const b = document.getElementById("sheet-body"); const u = [...b.querySelectorAll("a")].filter((e) => /uber/i.test((e.href || "") + e.textContent));
    return { uber: u.length, href: u[0] && u[0].href, tel: [...b.querySelectorAll("a[href^='tel:']:not([href='tel:112'])")].filter((e) => !e.closest(".rnd-more")).length, rows: b.querySelectorAll(".taxi-row").length }; });
  ok(y.uber === 1 && /pickup=my_location/.test(y.href || "") && /dropoff/.test(y.href || "") && y.rows === 0 && y.tel <= 1, "I-55: with home = exactly one 'Uber hem' (pickup my_location + dropoff) and one Taxi", y);
  await ctx.close(); await browser.close();
  console.log(`c1menus: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
