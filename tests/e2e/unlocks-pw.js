// lane unlocks: achievements unlock avatar clothes (js/unlock-parts.js + js/unlocks.js, SQL 0508/0509). Mocked server.
// A) new medal u_pass25 → the unlock sheet "Du låste upp: Upptäckarhatt", the character wears it, Använd nu / Senare →
//    "Använd nu" saves hw 44 (set_my_avatar) and the avatar changes. B) Garderob: 37 cards, locked = silhouette + how +
//    progress (my_unlock_progress), open = Använd / På dig. C) two at once = one sheet with a picker. D) a season window
//    alone gives no sheet; the first look on a phone only stores. E) no achievement counts drinks. F) Profil row.
//    G) reduced motion = no animation. H) old server (invalid_avatar) = error toast, sheet stays.
// Usage: node unlocks-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const PORT = process.argv[2] || 8871;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const ERR = (r, m) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: m }) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 300))); c ? pass++ : fail++; };
void PORT;

const SPEC = { v: 2, sk: 3, fs: 0, ey: 1, br: 1, mt: 0, hr: 2, hc: 1, fh: 0, hw: 0, gl: 0, up: 0, uc: 2, bg: 1 };
const SEED = "5e3a91c2";
const S = { spec: null, facts: null, saveErr: null, saves: [], prog: 0 };
function reset() { S.spec = JSON.parse(JSON.stringify(SPEC)); S.facts = { r: 3, s: 0, b: 5, t: 1, e: 0, g: 1, k: 0, m: ["pluton", "u_pass5"], today: "11-13", gf: false }; S.saveErr = null; S.saves = []; S.prog = 0; }

async function routes(page) {
  await page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar|my_unlock_progress)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (fn === "my_avatar") return J(r, { v: 2, spec: S.spec, seed: SEED, facts: S.facts });
    if (fn === "my_unlock_progress") { S.prog++; return J(r, { v: 1, c: { pass: 25, town: 1, lan: 1, gang: 3, event: 0, play: 2, win: 1, home: 0, water: 2, price: 0, ci: 7 } }); }
    const s = body.p_spec || {}; S.saves.push(s);
    if (S.saveErr) return ERR(r, S.saveErr);
    S.spec = s; return J(r, { ok: true, spec: s });
  });
}
const sheet = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return { open: !!(s && !s.hidden), title: (document.getElementById("sheet-title") || {}).textContent || "", body: s ? s.querySelector("#sheet-body").className : "" }; });
// baseline = what is open now (as the first look on this phone would store), then the server gives new facts
async function baseline(page) { await page.evaluate((seed) => localStorage.setItem("olnu.unl.v1", JSON.stringify({ s: seed, k: PN.unlocks._openKeys() })), SEED); }
async function relook(page) { return page.evaluate(() => AVATAR.loadMe(true).then(() => PN.unlocks.check())); }
async function waitSheet(page, re) {
  for (let i = 0; i < 30; i++) { const s = await sheet(page); if (s.open && re.test(s.title)) return s; await wait(page, 400); }
  return sheet(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  try {
    /* ---------- A + B + C + D + E + F + H ---------- */
    {
      reset();
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      await routes(page);
      await boot(page);
      await page.waitForFunction(() => window.AVATAR && AVATAR.meRaw() && AVATAR.meRaw().facts, null, { timeout: 15000 }).catch(() => {});
      ok("modules loaded (PN.unlocks + 12 new items)", await page.evaluate(() => !!(PN.unlocks && PN.unlockData && AVATAR.NAMES.hw[44] && AVATAR.MAX.hw === 47)));
      ok("no new window global", await page.evaluate(() => !("UNLOCKS" in window)));
      // D1: first look on this phone only stores (no sheet storm)
      await page.evaluate(() => localStorage.removeItem("olnu.unl.v1"));
      const first = await page.evaluate(() => PN.unlocks.check());
      ok("first look: stores, no sheet", first.length === 0 && !!(await page.evaluate(() => localStorage.getItem("olnu.unl.v1"))));

      // A: the server awards u_pass25 (25 bars) → hw:44 opens
      await baseline(page);
      S.facts = Object.assign({}, S.facts, { m: S.facts.m.concat(["u_pass25"]) });   // only the medal (more bars would also open bar items)
      const fresh = await relook(page);
      ok("check finds exactly the new hat", JSON.stringify(fresh) === '["hw:44"]', fresh);
      let st = await waitSheet(page, /Du låste upp/);
      if (!st.open) { await page.evaluate(() => PN.unlocks.show(["hw:44"], { now: true })); st = await waitSheet(page, /Du låste upp/); }   // CALM may hold an automatic sheet
      await wait(page, 1000);   // after the pop
      ok("sheet title 'Du låste upp: Upptäckarhatt'", st.open && /^Du låste upp: Upptäckarhatt$/.test(st.title), st);
      const view = await page.evaluate(() => {
        const b = document.getElementById("sheet-body"), btns = [...b.querySelectorAll(".ul-acts button")].map((x) => x.textContent.trim());
        const av = b.querySelector(".ul-av svg"), r = av && av.getBoundingClientRect();
        return { btns, av: !!av, w: r ? r.width : 0, tier: (b.querySelector(".ul-tier") || {}).textContent, why: (b.querySelector(".ul-why") || {}).textContent, rays: !!b.querySelector(".ul-rays"),
          anim: av ? getComputedStyle(b.querySelector(".ul-av")).animationName : "", gard: !!b.querySelector(".ul-link"), over: b.scrollWidth > b.clientWidth + 1 };
      });
      ok("buttons Använd nu / Senare", view.btns[0] === "Använd nu" && view.btns[1] === "Senare", view.btns);
      ok("big character preview + rays + pop animation", view.av && view.w >= 120 && view.rays && view.anim === "ul-pop", view);
      ok("tier Episk + reason (Upptäckaren: 25 krogar)", view.tier === "Episk" && /Upptäckaren/.test(view.why) && /25 krogar/.test(view.why), view);
      ok("link to Garderob, no sideways overflow", view.gard && !view.over, view);
      // H: old server (no 0508) says invalid_avatar → error toast, sheet stays open
      S.saveErr = "invalid_avatar";
      await page.evaluate(() => document.querySelector("#sheet-body .ul-use").click());
      await wait(page, 1200);
      const h = await page.evaluate(() => ({ t: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join("|"), open: !document.getElementById("sheet").hidden, dis: document.querySelector("#sheet-body .ul-use").disabled }));
      ok("old server: error toast, sheet stays, button back", /känner inte igen/.test(h.t) && h.open && !h.dis, h);
      // A: Använd nu → set_my_avatar with hw 44, sheet closes, my avatar wears it
      S.saveErr = null; S.saves = [];
      await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); document.querySelector("#sheet-body .ul-use").click(); });
      await wait(page, 1500);
      const a = await page.evaluate(() => ({ hw: AVATAR.meRaw().spec.hw, open: !document.getElementById("sheet").hidden, t: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join("|") }));
      ok("Använd nu saves hw 44 and keeps the rest", S.saves.length === 1 && S.saves[0].hw === 44 && S.saves[0].sk === SPEC.sk && S.saves[0].up === SPEC.up, S.saves);
      ok("avatar changes (me.spec.hw = 44), sheet closed, toast", a.hw === 44 && !a.open && /Upptäckarhatt/.test(a.t), a);
      ok("the drawn avatar now has the hat", await page.evaluate(() => AVATAR.svg(AVATAR.meRaw().spec) !== AVATAR.svg(Object.assign({}, AVATAR.meRaw().spec, { hw: 0 }))));

      // D2: a season window that just started (Halloween items) gives no sheet
      await baseline(page);
      S.facts = Object.assign({}, S.facts, { today: "10-25" });
      ok("season start alone: no unlock sheet", (await relook(page)).length === 0);
      S.facts = Object.assign({}, S.facts, { today: "11-13" });

      // C: two at once (u_town2 + u_gang1) = one sheet with a picker
      await baseline(page);
      S.facts = Object.assign({}, S.facts, { m: S.facts.m.concat(["u_town2", "u_gang1"]) });
      const two = await relook(page);
      if (!(await sheet(page)).open) await page.evaluate((k) => PN.unlocks.show(k, { now: true }), two);
      st = await waitSheet(page, /Du låste upp/);
      const pick = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .ul-pick button")].map((b) => [b.getAttribute("data-k"), b.getAttribute("aria-pressed")]));
      ok("two unlocks = one sheet 'Du låste upp 2 saker' + picker", two.length === 2 && /Du låste upp 2 saker/.test(st.title) && pick.length === 2 && pick[0][1] === "true", { two, st, pick });
      await page.evaluate(() => document.querySelectorAll("#sheet-body .ul-pick button")[1].click());
      await wait(page, 200);
      const nm2 = await page.evaluate(() => document.querySelector("#sheet-body .ul-name").textContent);
      ok("picker switches the item", nm2 === (await page.evaluate((k) => AVATAR.NAMES[k.split(":")[0]][+k.split(":")[1]][0], pick[1][0])), nm2);
      await page.evaluate(() => document.querySelector("#sheet-body .ul-later").click());
      await wait(page, 400);
      ok("Senare closes", !(await sheet(page)).open);

      // B: Garderob
      await page.evaluate(() => PN.unlocks.open());
      await wait(page, 1500);
      const g = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("#sheet-body .ul-card")];
        const by = (k) => cards.find((c) => c.getAttribute("data-k") === k);
        const lk = by("hw:46"), on = by("hw:44"), op = by("hw:27");
        const f = lk && lk.querySelector(".ul-art svg") ? getComputedStyle(lk.querySelector(".ul-art svg")).filter : "";
        return { n: cards.length, title: document.getElementById("sheet-title").textContent, sum: (document.querySelector("#sheet-body .ul-sum") || {}).textContent,
          lkCls: lk && lk.className, lkF: f, lkIcon: !!(lk && lk.querySelector(".ul-lk svg")), lkHow: lk && (lk.querySelector(".ul-how") || {}).textContent, lkPr: lk && (lk.querySelector(".ul-pr") || {}).textContent,
          passPr: (by("hw:44") || {}).className, on: on && (on.querySelector(".ul-on") || {}).textContent, opBtn: op && (op.querySelector(".ul-use") || {}).textContent,
          over: document.getElementById("sheet-body").scrollWidth > document.getElementById("sheet-body").clientWidth + 1 };
      });
      ok("Garderob: 37 cards", g.title === "Garderob" && g.n === 37, g);
      ok("locked = silhouette + lock + how to get it", /locked/.test(g.lkCls) && /brightness\(0\)/.test(g.lkF) && g.lkIcon && /Hämta kompisar 5 gånger/.test(g.lkHow || ""), g);
      ok("locked shows progress from my_unlock_progress (0 / 5)", S.prog >= 1 && g.lkPr === "0 / 5", g);
      ok("worn item says På dig; open item has Använd", g.on === "På dig" && g.opBtn === "Använd", g);
      ok("summary says no drinking needed, no overflow", /4 av 37 upplåsta/.test(g.sum || "") && /dricker mer/.test(g.sum || "") && !g.over, g);
      await page.evaluate(() => document.querySelector('#sheet-body [data-f="locked"]').click());
      await wait(page, 200);
      ok("filter Låsta shows only locked", await page.evaluate(() => { const c = [...document.querySelectorAll("#sheet-body .ul-card")]; return c.length === 33 && c.every((x) => x.classList.contains("locked")); }));
      S.saves = [];
      await page.evaluate(() => { document.querySelector('#sheet-body [data-f="open"]').click(); });
      await wait(page, 200);
      await page.evaluate(() => { const c = document.querySelector('#sheet-body .ul-card[data-k="hw:27"] .ul-use'); if (c) c.click(); });
      await wait(page, 2600);   // set_my_avatar slow_down guard is server side; the mock answers at once
      ok("Garderob Använd saves the item", S.saves.length === 1 && S.saves[0].hw === 27, S.saves);
      ok("…and the card now says På dig", await page.evaluate(() => /På dig/.test((document.querySelector('#sheet-body .ul-card[data-k="hw:27"]') || {}).textContent || "")));

      // E: no achievement counts drinks
      const e = await page.evaluate(() => PN.unlockData.CAT.map((c) => c.key + ":" + c.id + ":" + JSON.stringify(AVATAR.LOCKS[c.reward])));
      ok("no achievement counts beers (keys + locks)", e.length === 37 && e.every((x) => !/beer|drink|\bm(10|50|100|250|500|1000)\b|"n\d+"/.test(x.split(":")[0] + x.split(":")[1])), e.filter((x) => /beer|drink/.test(x)));
      ok("editor lock text names the new path", await page.evaluate(() => / eller med medaljen Utflykten/.test(AVATAR.lockText(AVATAR.LOCKS["hw:27"]))));

      // F: Profil → Mitt has a Garderob row next to Min uniform
      await page.evaluate(() => { try { PN.closeSheet(); } catch (e) {} });
      await wait(page, 300);
      await page.evaluate(() => document.getElementById("btn-settings").click());
      await wait(page, 900);
      await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button, [role=tab], .ds-row")].find((b) => /^\s*Profil/.test(b.textContent)); if (t) t.click(); });
      await page.waitForSelector("#sheet-body .pn-pf .ul-row", { timeout: 6000 }).catch(() => {});
      const pr = await page.evaluate(() => { const r = document.querySelector("#sheet-body .pn-pf .ul-row"); const prev = r && r.previousElementSibling; return { r: !!r, t: r && r.textContent, prev: prev && prev.textContent }; });
      ok("Profil row 'Garderob' after Min uniform", pr.r && /Garderob/.test(pr.t) && /37/.test(pr.t) && /Min uniform/.test(pr.prev || ""), pr);
      if (pr.r) { await page.evaluate(() => document.querySelector("#sheet-body .ul-row").click()); await wait(page, 800); ok("row opens Garderob", (await sheet(page)).title === "Garderob"); }
      await ctx.close();
    }
    /* ---------- G: reduced motion ---------- */
    {
      reset();
      const { ctx, page } = await ctxFor(browser, { width: 360, height: 780 }, { reduced: true });
      await routes(page);
      await boot(page);
      await page.waitForFunction(() => window.AVATAR && AVATAR.meRaw() && AVATAR.meRaw().facts, null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => PN.unlocks.show(["hw:45"], { now: true }));
      await wait(page, 600);
      const m = await page.evaluate(() => ({ a: getComputedStyle(document.querySelector(".ul-av")).animationName, r: getComputedStyle(document.querySelector(".ul-rays")).animationName, t: document.getElementById("sheet-title").textContent,
        over: document.getElementById("sheet-body").scrollWidth > document.getElementById("sheet-body").clientWidth + 1 }));
      ok("reduced motion: no pop, no spinning rays (360 px, no overflow)", m.a === "none" && m.r === "none" && /Pannlampa/.test(m.t) && !m.over, m);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL crash", e && e.stack); fail++; }
  await browser.close();
  console.log(`unlocks: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
