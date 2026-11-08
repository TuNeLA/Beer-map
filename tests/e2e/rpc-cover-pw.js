// RPC cover: opens every main screen on the shared mock (ds-helpers.js + fixtures/rpc.js) and FAILS when the app asks the
// server for an RPC that the mock does not answer (it would get a silent [] and show an empty / broken screen in mock runs).
// Also checks that the shared fixtures fill the screens: group members, camera film, game lobby, friends.
// Fix a FAIL: add the RPC to fixtures/rpc.js (answer with the shape its reader in docs/js expects). node rpc-cover-pw.js <port>
process.argv[2] = process.argv[2] || "8942";
const { ctxFor, boot, wait, clickJS, unmocked } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const F = require("./fixtures/rpc.js");
const G = { id: F.GID, name: "Ludvika Lager" };
let fails = 0;
const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined ? " " + JSON.stringify(x).slice(0, 500) : "")); if (!c) fails++; };
// wait (≤ 20 s, slow CI) until the open sheet's text matches, then return it
const sheetWait = (p, re) => p.waitForFunction((r) => { const s = document.getElementById("sheet"); return s && !s.hidden && new RegExp(r).test(s.innerText); }, re.source, { timeout: 20000 }).catch(() => {});
const sheetText = (p) => p.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? s.innerText.replace(/\s+/g, " ").slice(0, 600) : ""; });
const groupsThen = (tab) => async (p) => { await clickJS(p, "#btn-groups"); await wait(p, 1300); if (tab) await p.evaluate((t) => { const b = document.querySelector('.inv-tabs [data-t="' + t + '"]'); if (b) b.click(); }, tab); };

const SCREENS = [
  ["main", async () => {}],
  ["mer", async (p) => clickJS(p, "#btn-more")],
  ["nara", async (p) => { await clickJS(p, "#btn-more"); await wait(p, 700); await p.evaluate(() => { const r = document.querySelector("[data-pn-near]"); if (r) r.click(); }); }],
  ["ikvall", async (p) => p.evaluate(() => window.PNUI && window.PNUI.openIkvall())],
  ["topp", async (p) => clickJS(p, "#btn-top")],
  ["grupper", groupsThen(null)],
  ["vanner", groupsThen("f"), async (p) => { await sheetWait(p, /Mina vänner[\s\S]*Lisa/); const t = await sheetText(p); ok(/Lisa/.test(t), "vänner: friends listed (Lisa)", t.slice(0, 200)); }],
  ["inkorg", groupsThen("i")],
  ["grupp", async (p) => { await groupsThen("g")(p); await p.waitForSelector(".glist .gcard", { timeout: 20000 }).catch(() => {}); await p.evaluate(() => { const c = document.querySelector(".glist .gcard"); if (c) c.click(); }); },
    async (p) => {   // members live in the ⋯ (info) view of the group page (gpage.js)
      await p.waitForSelector("[data-gv]", { timeout: 20000 }).catch(() => {});
      await p.evaluate(() => { const w = document.querySelector("#sheet-body [data-gv]"); if (w && window.GPAGE) window.GPAGE.view(w, "info"); });
      await wait(p, 600);   // ⋯ → "Medlemmar & roller" opens the list
      await p.evaluate(() => { const r = [...document.querySelectorAll("#sheet-body button, #sheet-body [role=button], #sheet-body summary, #sheet-body .gi, #sheet-body li")]
        .filter((e) => e.offsetParent && /Medlemmar/.test(e.textContent) && e.textContent.length < 60).pop(); if (r) r.click(); });
      await sheetWait(p, /Nisse/); const t = await sheetText(p);
      ok(["Oskar", "Lisa", "Nisse"].every((n) => t.includes(n)), "group page ⋯: members listed (group_status_v3)", t.slice(0, 300)); }],
  ["kamera", async (p) => p.evaluate((g) => window.FILM && window.FILM.openCam(g), G),
    async (p) => { await sheetWait(p, /kvar/); const t = await sheetText(p); ok(/Engångskamera/.test(t) && !/Filmen slut/.test(t) && /10/.test(t), "camera: a fresh film (not 'Filmen slut')", t.slice(0, 200)); }],
  ["spel", async (p) => { await p.evaluate((g) => window.SPEL && window.SPEL.open(g), G); await wait(p, 2500); await p.waitForSelector('.sp-card[data-g="kort"]', { timeout: 20000 }).catch(() => {}); await clickJS(p, '.sp-card[data-g="kort"]'); },
    async (p) => { await p.waitForSelector(".sp-room .sp-pp", { timeout: 20000 }).catch(() => {}); const r = await p.evaluate(() => { const s = window.SPEL_UI && window.SPEL_UI._state(); const root = document.querySelector(".sp-room");
      return { room: !!root, players: root ? root.querySelectorAll(".sp-pp").length : 0, view: s && s.view, err: !!document.querySelector(".toast.err, .toast-err") }; });
      ok(r.room && r.players >= 3 && r.view === "room" && !r.err, "spel: room game opens its lobby with the live members", r); }],
  ["profil", async (p) => clickJS(p, "#btn-settings")],
  ["installningar", async (p) => { await clickJS(p, "#btn-settings"); await wait(p, 1200); await p.evaluate(() => { const t = [...document.querySelectorAll("#sheet-body .pf-tabs button")].find((x) => /Inställningar/.test(x.textContent)); if (t) t.click(); }); }],
  ["krog", async (p) => { await p.evaluate(() => window.__map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(p, 1800);
    await p.evaluate(() => { let m = null; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!m && c && c.bar && String(c.bar.id) === "n3472634175") m = l; }); if (m) m.fire("click"); }); }],
];

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const all = new Map();
  try {
    for (const [name, open, check] of SCREENS) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
      page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);   // CI runners are slow; the checks wait for content
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      try {
        await boot(page);
        const before = new Set(unmocked(page));
        await open(page); await wait(page, 2800);
        if (check) await check(page);
        unmocked(page).forEach((fn) => { if (!all.has(fn)) all.set(fn, before.has(fn) ? "boot" : name); });
        ok(!errs.length, name + ": no page errors", errs.slice(0, 3));
      } catch (e) { ok(false, name + ": screen ran", String(e && e.message || e).slice(0, 300)); }
      await ctx.close();
    }
    const list = [...all].map(([fn, s]) => fn + " (" + s + ")");
    if (list.length) console.log("UNMOCKED " + list.length + ": " + list.join(", "));
    ok(!list.length, "every RPC the main screens call is answered by the mock (else add it to fixtures/rpc.js)", list);
  } catch (e) { ok(false, "run", String(e && e.stack || e).slice(0, 400)); }
  await browser.close();
  console.log(fails ? "FAILS " + fails : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
