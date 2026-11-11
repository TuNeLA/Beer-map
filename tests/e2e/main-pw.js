// lane main (10 Nov 2026): S5 install guide first, R1-03 beta note caption, S2 Synlighet quick rows + R1-12, rail labels.
// usage: node main-pw.js <port> [part,part…]   parts: s5, note, s2, rail (default all). Mocked Supabase (ds-helpers).
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const PARTS = (process.argv[3] || "s5,note,s2,rail,f2,x6,set,r1").split(",");
const { wait } = H;
require("fs").mkdirSync(SP + "main-shots", { recursive: true });
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 400))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], VH = { 360: 780, 390: 844, 430: 932 };
const UA = { ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" };
const shot = (p, n) => p.screenshot({ path: SP + "main-shots/" + n + ".png" });
const R = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const hit = (a, b) => a && b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

// a fresh phone (no storage) with only Supabase mocked as empty: the very first open
async function fresh(browser, kind, w, init) {
  const mob = kind !== "desktop";
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: VH[w] || 844 }, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob, locale: "sv-SE", userAgent: UA[kind] });
  await ctx.route(/supabase\.co/, (r) => J(r, []));
  await ctx.route(/api\.mapbox\.com|tiles\.mapbox\.com|events\.mapbox\.com/, (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE); await wait(page, 3500);
  return { ctx, page, errs };
}
const inst = (page) => page.evaluate(() => {
  const c = document.getElementById("ux-inst"), i = document.getElementById("intro");
  const sk = c && [...c.querySelectorAll("button")].find((b) => /Fortsätt utan att installera/.test(b.textContent));
  return { card: !!c, intro: !!(i && !i.hidden), steps: c ? c.querySelectorAll("li").length : 0, txt: c ? c.textContent : "", skip: !!sk,
    skipSmall: sk ? parseFloat(getComputedStyle(sk).fontSize) <= 14 && getComputedStyle(sk).backgroundColor === "rgba(0, 0, 0, 0)" : false,
    wide: c ? [...c.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length : -1,
    st: (() => { try { return JSON.parse(localStorage.getItem("olnu.inst1") || "null"); } catch (e) { return localStorage.getItem("olnu.inst1"); } })() };
});
const tapSkip = (page) => page.evaluate(() => { const b = [...document.querySelectorAll("#ux-inst button")].find((x) => /Fortsätt utan att installera/.test(x.textContent)); if (b) b.click(); return !!b; });

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });

  if (PARTS.includes("s5")) {
    // S5 · iPhone: the guide is the first thing, before the intro, at 3 widths
    for (const w of W3) {
      const { ctx, page, errs } = await fresh(browser, "ios", w);
      const r = await inst(page);
      ok(r.card && !r.intro, "S5 iPhone " + w + ": first open = 'Installera appen' before the intro (no tour behind it)", { card: r.card, intro: r.intro });
      ok(r.steps === 3 && /Dela/.test(r.txt) && /Lägg till på hemskärmen/.test(r.txt) && /Installera appen/.test(r.txt), "S5 iPhone " + w + ": 3 steps Dela → Lägg till på hemskärmen → Lägg till", r.txt.slice(0, 160));
      ok(/notiser bara när appen ligger på hemskärmen/.test(r.txt), "S5 iPhone " + w + ": one line says push only works when installed");
      ok(r.skip && r.skipSmall, "S5 iPhone " + w + ": a small text link 'Fortsätt utan att installera'", { skip: r.skip, small: r.skipSmall });
      ok(r.wide === 0, "S5 iPhone " + w + ": nothing wider than the screen", r.wide);
      const em = await page.evaluate(() => /\p{Extended_Pictographic}/u.test(document.getElementById("ux-inst") ? [...document.querySelectorAll("#ux-inst b, #ux-inst h2, #ux-inst button, #ux-inst small, #ux-inst p")].map((e) => e.textContent).join(" ") : "x"));
      ok(!em, "S5 iPhone " + w + ": no emoji in the guide (PNI icons)");
      await shot(page, "s5-ios-" + w);
      if (w === 390) {
        await tapSkip(page); await wait(page, 700);
        const a = await inst(page);
        ok(!a.card && a.intro && a.st && a.st.n === 1 && a.st.how === "skip", "S5: 'Fortsätt utan att installera' → the intro; state = shown once, skipped", a.st);
        const owns = await page.evaluate(() => !!(window.INSTALL1.owns && window.INSTALL1.owns()) && !!localStorage.getItem("olnu.pnInst"));
        ok(owns, "S5: after the guide the other install prompts stay quiet (owns + olnu.pnInst)");
        await page.reload(); await wait(page, 3000);
        ok(!(await inst(page)).card, "S5: same night, reload → no guide again");
        // 2nd night: they continued, the intro is done, the night key is older
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("olnu.inst1")); s.k = "2000-01-01"; s.at = Date.now() - 20 * 3600e3; localStorage.setItem("olnu.inst1", JSON.stringify(s)); localStorage.setItem("olnu.intro", "1"); localStorage.setItem("olnu.age18", "1"); });
        await page.reload(); await wait(page, 3000);
        const n2 = await inst(page);
        ok(n2.card && /Andra kvällen/.test(n2.txt), "S5: 2nd night → the guide once more", n2.txt.slice(0, 120));
        await shot(page, "s5-ios-night2-390");
        await tapSkip(page); await wait(page, 600);
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("olnu.inst1")); s.k = "2000-01-02"; s.at = Date.now() - 20 * 3600e3; localStorage.setItem("olnu.inst1", JSON.stringify(s)); });
        await page.reload(); await wait(page, 3000);
        const n3 = await inst(page);
        ok(!n3.card && n3.st && n3.st.n === 2, "S5: 3rd night → no guide (shown twice)", n3.st);
      }
      ok(errs.length === 0, "S5 iPhone " + w + ": no page errors", errs);
      await ctx.close();
    }
    // S5 · Android: steps, then the one-tap install button
    {
      const { ctx, page, errs } = await fresh(browser, "android", 390);
      const r = await inst(page);
      ok(r.card && !r.intro && r.steps === 3 && /Installera app/.test(r.txt), "S5 Android: first open = guide with ⋮ → Installera app → Installera", r.txt.slice(0, 160));
      await shot(page, "s5-android-390");
      await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = 1; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); }); await wait(page, 300);
      const go = await page.evaluate(() => { const b = document.querySelector("#ux-inst .mn-inst-go"); return b ? { t: b.textContent, bg: getComputedStyle(b).backgroundImage, n: document.querySelectorAll("#ux-inst .ds-btn-primary").length } : null; });
      ok(go && go.t === "Installera appen" && go.n === 1, "S5 Android: install prompt → ONE primary 'Installera appen'", go);
      await shot(page, "s5-android-prompt-390");
      await page.click("#ux-inst .mn-inst-go"); await wait(page, 400);
      const done = await page.evaluate(() => ({ p: window.__prompted, t: (document.getElementById("ux-inst") || {}).textContent || "", st: JSON.parse(localStorage.getItem("olnu.inst1") || "{}") }));
      ok(done.p === 1 && /Klart/.test(done.t) && done.st.how === "done", "S5 Android: tap → prompt() → Klart (state done)", done.st);
      ok(errs.length === 0, "S5 Android: no page errors", errs);
      await ctx.close();
    }
    // S5 · no guide: desktop, installed (standalone), invite link
    for (const [k, init, url] of [["desktop", null, ""], ["ios", () => { Object.defineProperty(navigator, "standalone", { get: () => true }); }, ""]]) {
      const { ctx, page } = await fresh(browser, k, 390, init);
      ok(!(await inst(page)).card, "S5 " + (init ? "installed (standalone)" : k) + ": no install guide");
      await ctx.close();
    }
  }

  if (PARTS.includes("note")) {
    // R1-03 · the beta note: a caption under the HUD row, left of the rail, OK = primary, opt-out = text button, once
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      await ctx.clearPermissions();   // location not allowed → the "use" kind (the one that used to come twice)
      await H.boot(page);
      let got = false;
      for (let i = 0; i < 50 && !got; i++) {
        await page.evaluate(() => document.querySelectorAll("#toasts .toast, .dl-cap").forEach((x) => x.remove()));
        await wait(page, 1000); got = !!(await page.$("#pnlog-note"));
      }
      const g = await page.evaluate(() => {
        const n = document.getElementById("pnlog-note"); if (!n) return null;
        const rr = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const rails = [...document.querySelectorAll(".pn-rail, #btn-more")].map(rr).filter(Boolean);
        const hud = [...document.querySelectorAll(".hud-left > *")].map(rr).filter((x) => x && x.r > x.l);
        const ok = n.querySelector(".pnlog-note-ok"), off = n.querySelector(".pnlog-note-off"), t = n.querySelector("p") || n.firstChild;
        return { n: rr(n), rails, hud, tk: rr(document.querySelector(".ticker")), okBg: getComputedStyle(ok).backgroundColor, offBg: getComputedStyle(off).backgroundColor,
          lines: Math.round((t.getBoundingClientRect().height) / parseFloat(getComputedStyle(t).lineHeight || "20")), note: localStorage.getItem("olnu.logNote"), txt: n.textContent };
      });
      ok(!!g, "R1-03 " + w + ": the beta note shows (" + (g ? g.txt.slice(0, 60) : "none") + ")");
      if (g) {
        const railL = Math.min(...g.rails.map((x) => x.l)), hudB = Math.max(0, ...g.hud.map((x) => x.b));
        ok(g.n.r <= railL - 7.5 && !g.rails.some((x) => hit(x, g.n)), "R1-03 " + w + ": left of the rail (never over it)", { r: g.n.r, railL });
        ok(g.n.t >= hudB - 0.5 && (!g.tk || g.n.t >= g.tk.b), "R1-03 " + w + ": under the HUD row and the ticker", { t: g.n.t, hudB, tk: g.tk && g.tk.b });
        ok(g.lines <= 3 && g.n.b - g.n.t <= 130, "R1-03 " + w + ": a caption, not a big card (≤ 3 lines, ≤ 130 px)", { lines: g.lines, h: g.n.b - g.n.t });
        ok(g.okBg === "rgb(245, 166, 35)" && g.offBg === "rgba(0, 0, 0, 0)", "R1-03 " + w + ": OK is the primary, the opt-out is a text button", { ok: g.okBg, off: g.offBg });
        ok(g.note === "1", "R1-03 " + w + ": one note per phone (olnu.logNote set, so no 2nd note when location turns on)", g.note);
      }
      if (w === 390) await shot(page, "r103-note-390");
      await ctx.close();
    }
  }

  if (PARTS.includes("s2")) {
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      await page.route(/rest\/v1\/rpc\/(my_visibility|set_visibility)\b/, (r) => J(r, { v: 1, friends_only: false }));
      await H.boot(page);
      await page.evaluate(() => { document.querySelectorAll("#toasts .toast, .dl-cap, #pnlog-note").forEach((x) => x.remove()); localStorage.setItem("olnu.home", JSON.stringify({ lat: 60.15, lng: 15.19, r: 300, at: Date.now() })); });
      await page.evaluate(() => document.getElementById("pn-ghost").click()); await wait(page, 700);
      const m = await page.evaluate(() => {
        const m = document.getElementById("pn-vis"); if (!m) return null;
        const r = m.getBoundingClientRect(), g = document.getElementById("pn-ghost").getBoundingClientRect();
        const rows = [...m.querySelectorAll(".pn-ikm-row")].map((b) => b.querySelector("b").textContent + "|" + ((b.querySelector("small") || {}).textContent || ""));
        return { right: r.right, left: r.left, railL: g.left, rows, radios: m.querySelectorAll("[role=radio]").length, inView: r.bottom <= innerHeight + 0.5 || m.scrollHeight > m.clientHeight };
      });
      const cut = await page.evaluate(() => [...document.querySelectorAll("#pn-vis .pn-vis-seg, #pn-vis [role=radio]")].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      ok(cut === 0, "S2 " + w + ": the 3 Synlighet choices are never cut", cut);
      ok(m && m.right <= m.railL - 7.5 && m.left >= 11.5, "R1-12 " + w + ": the Synlighet menu never covers the rail", m && { right: m.right, railL: m.railL, left: m.left });
      ok(m && m.radios >= 2 && m.rows.some((x) => /^Göm min pin\|/.test(x)) && m.rows.some((x) => /^Hemzon\|På · 300 m/.test(x)) && m.rows.some((x) => /^Alla inställningar\|/.test(x)),
        "S2 " + w + ": Synlighet = Vem ser dig? (Alla / Spöke …) + Göm min pin, Hemzon (På · 300 m), Alla inställningar", m && m.rows);
      if (w === 390) {
        await shot(page, "s2-vis-390");
        const sos = await page.evaluate(() => { const d = document.createElement("div"); try { window.SOCIAL.sosBlock(d); } catch (e) {} return !!d.querySelector(".sos-block"); });
        ok(sos === m.rows.some((x) => /^SOS till gänget\|/.test(x)), "S2: SOS row shows exactly when SOS works here (" + sos + ")");
        const open = async (cls) => { await page.evaluate(() => { if (!document.getElementById("pn-vis")) document.getElementById("pn-ghost").click(); }); await wait(page, 500);
          await page.evaluate((c) => { const b = document.querySelector("#pn-vis ." + c); if (b) b.click(); }, cls); await wait(page, 900);
          const s = await page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent, menu: !!document.getElementById("pn-vis"),
            tab: (document.querySelector('#sheet-body [role="tab"][aria-selected="true"]') || {}).getAttribute ? document.querySelector('#sheet-body [role="tab"][aria-selected="true"]').getAttribute("data-pf") : null }));
          await H.closeSheet(page); await wait(page, 600); return s; };
        let s = await open("mn-vis-hide"); const hideT = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
        ok(!(s.open && /Sluta dricka/.test(s.title)) && !s.menu && /gömd/i.test(hideT), "S2: Göm min pin → hides the pin only (ownerfix 2: no Sluta dricka sheet, menu closed, 'Pinnen ä gömd' toast)", { s, hideT });
        s = await open("mn-vis-home"); ok(s.open && /Hemzon/.test(s.title), "S2: Hemzon → the home zone sheet", s);
        s = await open("mn-vis-all"); ok(s.open && s.tab === "s", "S2: Alla inställningar → the Inställningar tab", s);
        if (sos) { s = await open("mn-vis-sos"); ok(s.open && s.title === "SOS", "S2: SOS → the SOS sheet (with the existing block)", s); }
        const blk = await page.evaluate(() => { const b = window.PNVIS.settingsBlock && window.PNVIS.settingsBlock(); return b ? { h: b.querySelector("h3").textContent, rows: b.querySelectorAll(".pn-ikm-row").length, seg: b.querySelectorAll("[role=radio]").length } : null; });
        ok(blk && blk.seg >= 2 && blk.rows >= 2, "S2: PNVIS.settingsBlock() for Inställningar (control + rows)", blk);
      }
      await ctx.close();
    }
  }

  if (PARTS.includes("rail")) {
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      await page.addInitScript(() => { if (!sessionStorage.getItem("rn")) { sessionStorage.setItem("rn", "1"); localStorage.setItem("olnu.railNights", "[]"); } });
      await H.boot(page);
      const g = await page.evaluate(() => {
        const rr = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const ids = ["pn-ghost", "pn-evs", "btn-more"];
        return { on: document.body.classList.contains("mn-rail-lbl"), btn: ids.map((i) => rr(document.getElementById(i))), lbl: ids.map((i) => { const l = document.querySelector("#" + i + " .mn-rail-l"); return l ? Object.assign(rr(l) || {}, { t2: l.textContent }) : null; }),
          loc: rr(document.getElementById("btn-locate")), vw: innerWidth };
      });
      const words = g.lbl.map((x) => x && x.t2);
      ok(g.on && words.join(",") === "Synlig,Event,Mer", "rail " + w + ": a new user's first night = a word under each rail button", words);
      ok(g.btn.every((b) => b && Math.round(b.w) === 44 && Math.round(b.h) === 44), "rail " + w + ": the buttons stay 44 × 44", g.btn.map((b) => b && [b.w, b.h]));
      ok(g.lbl.every((l, i) => l && l.r <= g.vw - 2 && l.t >= g.btn[i].b && (i === 2 || l.b <= g.btn[i + 1].t - 2)), "rail " + w + ": each label is under its button, inside the screen, never on the next button", g.lbl);
      ok(!g.lbl.some((l) => hit(l, g.loc)) && !g.btn.some((b) => hit(b, g.loc)), "rail " + w + ": labels and buttons never over locate");
      if (w === 390) {
        await shot(page, "rail-labels-390");
        await page.evaluate(() => window.PNVIS.setMode("spoke")); await wait(page, 1800);
        ok((await page.evaluate(() => (document.querySelector("#pn-ghost .mn-rail-l") || {}).textContent)) === "Spöke", "rail: the eye label follows the state (Spöke)");
        await page.evaluate(() => window.PNVIS.setMode("alla"));
        // night 4 → gone
        await page.evaluate(() => localStorage.setItem("olnu.railNights", JSON.stringify(["2000-01-01", "2000-01-02", "2000-01-03"])));
        await page.reload(); await wait(page, 4000);
        ok(!(await page.evaluate(() => document.body.classList.contains("mn-rail-lbl") && [...document.querySelectorAll(".mn-rail-l")].some((l) => l.getClientRects().length))), "rail: 4th night → no labels");
        // a user from before (intro done, no list) → never labels
        await page.evaluate(() => localStorage.removeItem("olnu.railNights")); await page.reload(); await wait(page, 4000);
        ok(!(await page.evaluate(() => document.body.classList.contains("mn-rail-lbl"))), "rail: a user from before the update gets no labels");
      }
      await ctx.close();
    }
  }
  if (PARTS.includes("f2")) {
    // F2 · "Jag kör ikväll" on → LÄSK! (no drink is logged); off → ÖL! again
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      const srv = { drive: true, beers: 0, set: [] };
      await page.route(/rest\/v1\/rpc\/(pickup_poll|driver_set|post_beer_v2|post_beer)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        if (fn === "pickup_poll") return J(r, { v: 1, driving: srv.drive, incoming: [], mine: null });
        if (fn === "driver_set") { srv.set.push(b.p_on); srv.drive = !!b.p_on; return J(r, { v: 1, ok: true, driving: srv.drive }); }
        srv.beers++; return J(r, { accepted: true, beer_count: 7, lat: b.p_lat, lng: b.p_lng, precise: false, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0 });
      });
      await page.addInitScript(() => { try { const n = JSON.parse(localStorage.getItem("olnu.night") || "null"); if (n) { n.lastTap = Date.now() - 40 * 60e3; localStorage.setItem("olnu.night", JSON.stringify(n)); } } catch (e) {} });
      await H.boot(page);
      await page.evaluate(() => window.SKJUTS && window.SKJUTS._force && window.SKJUTS._force()); await wait(page, 2200);
      const g = await page.evaluate(() => { const b = document.getElementById("btn-beer"), l = document.getElementById("beer-label"); const cs = getComputedStyle(b), lr = l.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { on: document.body.classList.contains("mn-lask"), t: l.textContent, sub: getComputedStyle(l, "::after").content, bg: cs.backgroundImage, cd: b.classList.contains("cooldown"), fit: lr.left >= br.left + 4 && lr.right <= br.right - 4, aria: b.getAttribute("aria-label") }; });
      ok(g.on && g.t === "LÄSK!" && /chaufför/.test(g.sub) && /181, 230, 106/.test(g.bg), "F2 " + w + ": Jag kör on → the button is LÄSK! (chaufför, soda colours)", g);
      ok(g.fit && /Ingen öl räknas/.test(g.aria || ""), "F2 " + w + ": LÄSK! fits inside the circle and says so to screen readers", { fit: g.fit, aria: g.aria });
      if (w === 390) {
        await shot(page, "f2-lask-390");
        await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
        await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1200);
        const t1 = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | "));
        ok(srv.beers === 0 && /chaufför|ratten|Chaufför/i.test(t1) && /Jag kör inte/.test(t1), "F2: a tap on LÄSK! logs NO drink, a skål toast with 'Jag kör inte'", { beers: srv.beers, t1 });
        await page.evaluate(() => { const b = [...document.querySelectorAll("#toasts .toast button, #toasts .toast .btn")].find((x) => /Jag kör inte/.test(x.textContent)); if (b) b.click(); }); await wait(page, 2500);
        const g2 = await page.evaluate(() => ({ on: document.body.classList.contains("mn-lask"), t: document.getElementById("beer-label").textContent }));
        ok(srv.set.includes(false) && !g2.on && g2.t === "ÖL!", "F2: 'Jag kör inte' → driver_set(false) → ÖL! again", { set: srv.set, g2 });
        await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
        await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 2500);
        const st2 = await page.evaluate(() => ({ sheet: !document.getElementById("sheet").hidden && document.getElementById("sheet-title").textContent, busy: document.getElementById("btn-beer").classList.contains("busy") }));
        ok(srv.beers >= 1 || !!st2.sheet || st2.busy, "F2: not driving → the ÖL! tap goes through as before (beer posted or the picker opens)", { beers: srv.beers, st2 });
      }
      await ctx.close();
    }
  }

  if (PARTS.includes("x6")) {
    const H2C = "window.html2canvas = function () { var c = document.createElement('canvas'); c.width = 40; c.height = 80; var x = c.getContext('2d'); x.fillStyle = '#f5a623'; x.fillRect(0, 0, 40, 80); return Promise.resolve(c); };";
    const setup = async (w, o = {}) => {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      const srv = { knas: [], fb: [] };
      await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas\//, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: H2C }));
      await page.route(/rest\/v1\/rpc\/(submit_knas|submit_feedback)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        if (fn === "submit_feedback") { srv.fb.push(b); return J(r, { ok: true, id: 9 }); }
        srv.knas.push(b);
        if (o.missing) return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.submit_knas" }) });
        if (o.slow) return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "slow_down" }) });
        return J(r, { ok: true, id: 1, left: 4 });
      });
      await H.boot(page);
      await page.evaluate(() => { document.querySelectorAll("#toasts .toast, #pnlog-note").forEach((t) => t.remove()); console.warn("test line for the log"); });
      return { ctx, page, srv };
    };
    const viaMore = async (page) => { await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 900);
      const row = await page.evaluate(() => { const b = document.querySelector("#sheet-body .mn-knas-more"); if (b) b.click(); return !!b; }); await wait(page, 2200); return row; };
    for (const w of W3) {
      const { ctx, page, srv } = await setup(w);
      const row = await viaMore(page);
      const s = await page.evaluate(() => ({ title: document.getElementById("sheet-title").textContent, img: (document.querySelector("#sheet-body .mn-knas-img") || {}).src || "",
        sws: document.querySelectorAll("#sheet-body .mn-knas-sw[role=switch]").length, prim: document.querySelectorAll("#sheet-body .ds-btn-primary, #sheet-body .btn-amber").length,
        wide: [...document.querySelectorAll("#sheet-body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length }));
      ok(row && s.title === "Något knas?" && /^data:image\/jpeg;base64,/.test(s.img) && s.sws === 2 && s.prim === 1 && s.wide === 0, "X6 " + w + ": ⋯ Mer → 'Något knas?' sheet with the screenshot, 2 switches, ONE primary", s);
      if (w === 390) {
        await shot(page, "x6-sheet-390");
        await page.evaluate(() => document.querySelector("#sheet-body .mn-knas-go").click()); await wait(page, 500);
        ok(srv.knas.length === 0 && /Skriv vad som hände/.test(await page.evaluate(() => document.getElementById("toasts").textContent)), "X6: no text → 'Skriv vad som hände', nothing sent");
        await page.fill("#mn-knas-ta", "Checka in gjorde inget på Pitchers"); await page.evaluate(() => document.querySelector("#sheet-body .mn-knas-go").click()); await wait(page, 1500);
        const b = srv.knas[0] || {};
        ok(b.p_text === "Checka in gjorde inget på Pitchers" && /^data:image\/jpeg;base64,/.test(b.p_shot || "") && Array.isArray(b.p_logs) && b.p_logs.length > 0 && b.p_logs.length <= 200 && b.p_logs.some((x) => /test line for the log/.test(x)) && "beta" in (b.p_meta || {}) && b.p_meta.from === "mer",
          "X6: Skicka → submit_knas {text, JPEG screenshot, ≤ 200 log lines incl. console, meta with beta id + from}", { text: b.p_text, shot: (b.p_shot || "").slice(0, 30), logs: (b.p_logs || []).length, meta: b.p_meta });
        ok(/Tack/.test(await page.evaluate(() => document.getElementById("toasts").textContent)) && await page.evaluate(() => document.getElementById("sheet").hidden), "X6: sent → 'Tack!' and the sheet closes");
        // switches off → no picture, no log
        await page.waitForTimeout(400); await viaMore(page);
        await page.evaluate(() => document.querySelectorAll("#sheet-body .mn-knas-sw").forEach((x) => x.click()));
        await page.fill("#mn-knas-ta", "Utan bild"); await page.evaluate(() => document.querySelector("#sheet-body .mn-knas-go").click()); await wait(page, 1200);
        const b2 = srv.knas[1] || {};
        ok(b2.p_text === "Utan bild" && !b2.p_shot && Array.isArray(b2.p_logs) && b2.p_logs.length === 0, "X6: both switches off → no screenshot, no log", { shot: !!b2.p_shot, logs: (b2.p_logs || []).length });
        // the phone counts: 5 today → the 6th says so at once, no sheet
        await page.evaluate(() => { const d = new Date(); localStorage.setItem("olnu.knasDay", JSON.stringify({ k: d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(), n: 5 })); document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
        await viaMore(page);
        const lim = await page.evaluate(() => ({ t: document.getElementById("toasts").textContent, sheet: !document.getElementById("sheet").hidden && document.getElementById("sheet-title").textContent }));
        ok(/Max 5 om dagen/.test(lim.t) && lim.sheet !== "Något knas?", "X6: max 5 per day (phone count) → a toast, no sheet", lim);
        // Inställningar row
        await page.evaluate(() => { localStorage.removeItem("olnu.knasDay"); if (!document.getElementById("sheet").hidden) document.getElementById("sheet-close").click(); }); await wait(page, 500);
        await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 900);
        await page.evaluate(() => { const t = document.querySelector('#sheet-body [role="tab"][data-pf="s"]'); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }); await wait(page, 1600);
        const inr = await page.evaluate(() => { const r = document.querySelector("#sheet-body .mn-knas-row"); const s = r && r.closest("section"); return r ? { sec: s && s.getAttribute("data-ds"), vis: r.getClientRects().length > 0 } : null; });
        ok(inr && inr.sec === "om", "X6: Inställningar → Om appen has 'Något knas?'", inr);
      }
      await ctx.close();
    }
    { // server says slow_down → limit text; old server (no 0410) → the text goes through submit_feedback
      const a = await setup(390, { slow: true }); await viaMore(a.page); await a.page.fill("#mn-knas-ta", "Femte idag"); await a.page.evaluate(() => document.querySelector("#sheet-body .mn-knas-go").click()); await wait(a.page, 1200);
      ok(/Max 5 om dagen/.test(await a.page.evaluate(() => document.getElementById("toasts").textContent)), "X6: server slow_down (6th in 24 h) → 'Max 5 om dagen'"); await a.ctx.close();
      const m = await setup(390, { missing: true }); await viaMore(m.page); await m.page.fill("#mn-knas-ta", "Gammal server"); await m.page.evaluate(() => document.querySelector("#sheet-body .mn-knas-go").click()); await wait(m.page, 1500);
      ok(m.srv.fb.length === 1 && m.srv.fb[0].p_kind === "bug" && /\[knas\] Gammal server/.test(m.srv.fb[0].p_text), "X6: before 0410 runs → the text goes through submit_feedback (kind bug)", m.srv.fb[0]); await m.ctx.close();
    }
    { // owner panel
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage(); const calls = [];
      await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        calls.push([fn, b]);
        if (fn === "owner_knas") return J(r, { generated_at: new Date().toISOString(), counts: { all: 2, ny: 1, day: 2 }, items: [
          { id: 7, body: "Checka in gjorde inget", beta: "3536dbd", meta: { v: "abc", from: "mer", screen: "kartan", w: "390", h: "844" }, logs: ["+1.0s rpc my_groups ok 120ms", "+2.0s error boom"], has_shot: true, status: "ny", created_at: new Date().toISOString(), test: false },
          { id: 6, body: "Annat", beta: null, meta: {}, logs: [], has_shot: false, status: "läst", created_at: new Date().toISOString(), test: true }] });
        if (fn === "owner_knas_shot") return J(r, { id: 7, shot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
        if (fn === "owner_set_knas") return J(r, { ok: true });
        return J(r, null);
      });
      await page.addInitScript(() => sessionStorage.setItem("olnu.ownerKey", "test-key"));
      await page.goto(BASE + "stats.html"); await wait(page, 2000);
      await page.evaluate(() => { const m = document.getElementById("main"); if (m) m.hidden = false; const l = document.getElementById("login"); if (l) l.hidden = true; }); await wait(page, 2000);
      const pan = await page.evaluate(() => { const p = document.getElementById("pKnas"); return p && !p.hidden ? { t: p.textContent, rows: [...p.querySelectorAll("[data-knas]")].map((x) => x.getAttribute("data-knas")) } : null; });
      ok(!!pan && pan.rows.join() === "7,6" && /beta 3536dbd/.test(pan.t) && /Logg \(2 rader\)/.test(pan.t) && /1 nya/.test(pan.t), "X6 owner panel: the reports list (beta id, log fold, counts)", pan);
      await page.evaluate(() => { const b = [...document.querySelectorAll('#pKnas [data-knas="7"] button')].find((x) => /Visa bild/.test(x.textContent)); if (b) b.click(); }); await wait(page, 700);
      ok(calls.some((c) => c[0] === "owner_knas_shot" && c[1].p_id === 7 && c[1].p_key === "test-key") && await page.evaluate(() => !!document.querySelector('#pKnas [data-knas="7"] img')), "X6 owner panel: 'Visa bild' → owner_knas_shot, the picture shows");
      await page.evaluate(() => { const b = [...document.querySelectorAll('#pKnas [data-knas="7"] button')].find((x) => x.textContent === "fixad"); if (b) b.click(); }); await wait(page, 700);
      ok(calls.some((c) => c[0] === "owner_set_knas" && c[1].p_id === 7 && c[1].p_status === "fixad"), "X6 owner panel: status → owner_set_knas");
      await page.screenshot({ path: SP + "main-shots/x6-owner-390.png" });
      await ctx.close();
    }
  }

  if (PARTS.includes("set")) {
    // S2 (batch 2): the full Synlighet settings live in Inställningar; Profil shows only the profile
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      await page.route(/rest\/v1\/rpc\/(my_visibility|set_visibility)\b/, (r) => J(r, { v: 1, friends_only: false }));
      await H.boot(page);
      const tab = async (k) => { await page.evaluate(() => { if (document.getElementById("sheet").hidden) document.getElementById("btn-settings").click(); }); await wait(page, 900);
        await page.evaluate((k) => { const t = document.querySelector('#sheet-body [role="tab"][data-pf="' + k + '"]'); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }, k); await wait(page, 1600); };
      await tab("s");
      const s = await page.evaluate(() => { const sec = document.querySelector('#sheet-body section[data-ds="integ"]'); if (!sec) return null;
        const items = [...sec.querySelectorAll(":scope > .ds-list > .ds-item:not(.pn-gone)")];
        return { first: items[0] && items[0].querySelector(".mn-vis-set") ? "vis" : (items[0] || {}).textContent, radios: sec.querySelectorAll(".mn-vis-set [role=radio]").length,
          rows: [...sec.querySelectorAll(".mn-vis-srow .ds-row-t > span")].map((x) => x.textContent), nested: sec.querySelectorAll(".ds-list .ds-list").length,
          wide: [...sec.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length,
          cut: [...sec.querySelectorAll(".mn-vis-set .pn-vis-seg, .mn-vis-set [role=radio]")].filter((e) => e.scrollWidth > e.clientWidth + 1).length }; });
      ok(s && s.first === "vis" && s.radios >= 2 && s.rows.includes("Göm min pin") && s.rows.includes("Hemzon") && s.nested === 0 && s.wide === 0 && s.cut === 0,
        "S2 " + w + ": Inställningar → Integritet & säkerhet starts with Vem ser dig? + Göm min pin, Hemzon (SOS when on); no card in a card", s);
      if (w === 390) {
        await page.evaluate(() => document.querySelector('#sheet-body section[data-ds="integ"]').scrollIntoView()); await wait(page, 400); await shot(page, "set-integ-390");
        await page.evaluate(() => document.querySelector('#sheet-body .mn-vis-set [data-vis="spoke"]').click()); await wait(page, 700);
        ok(await page.evaluate(() => localStorage.getItem("olnu.ghostMode") === "1" && document.getElementById("pn-ghost").getAttribute("data-vis") === "spoke"), "S2: Spöke in Inställningar = the same spökläge as the rail");
        await page.evaluate(() => window.PNVIS.setMode("alla"));
      }
      await tab("p");
      await page.evaluate(() => { const f = document.querySelector("#sheet-body .pn-fold-t"); if (f && f.getAttribute("aria-expanded") !== "true") f.click(); }); await wait(page, 700);
      const p = await page.evaluate(() => { const b = document.getElementById("sheet-body"), t = b.textContent;
        return { ghost: [...b.querySelectorAll('[role="switch"]')].some((x) => /spökläge|ghost/i.test(x.getAttribute("aria-label") || "")), sos: !!b.querySelector(".sos-block"),
          hide: /Göm min pin/.test(t), home: !!b.querySelector(".hz-row, .hz-set") || /Hemzon:/.test(t), sub: (b.querySelector(".pn-fold-t small") || {}).textContent }; });
      ok(!p.ghost && !p.sos && !p.hide && !p.home && !/synlighet/.test(p.sub || ""), "S2 " + w + ": Profil shows only the profile (no Spökläge switch, SOS, Göm min pin, Hemzon)", p);
      if (w === 390) await shot(page, "set-profil-390");
      await ctx.close();
    }
  }

  if (PARTS.includes("r1")) {
    for (const w of W3) {
      const { ctx, page } = await H.ctxFor(browser, { width: w, height: VH[w] });
      // R1-14: from the moment ANNAT shows, it never shows the 🥃 text
      await page.goto(BASE);
      let seenEmoji = false, seenIcon = false;
      for (let i = 0; i < 40; i++) {
        const r = await page.evaluate(() => { const w = document.getElementById("other-wrap"), b = document.getElementById("btn-other"); if (!w || w.hidden || !b) return null;
          const lab = b.querySelector(".other-label"); const vis = lab && getComputedStyle(lab).visibility !== "hidden";
          return { emo: vis && /\p{Extended_Pictographic}/u.test(lab.textContent), svg: !!b.querySelector("svg") }; });
        if (r) { if (r.emo) seenEmoji = true; if (r.svg) seenIcon = true; }
        await wait(page, 250);
      }
      ok(!seenEmoji && seenIcon, "R1-14 " + w + ": ANNAT never shows the 🥃 emoji at cold start (PNI glyph at once)", { seenEmoji, seenIcon });
      await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => {});
      await wait(page, 1500);
      await page.evaluate(() => document.getElementById("btn-other").click()); await wait(page, 1200);
      const kb = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .kind-btn")].map((b) => getComputedStyle(b).borderTopLeftRadius));
      ok(kb.length > 0 && kb.every((r) => r === "12px"), "R1-13 " + w + ": Sidospår tiles have radius 12 (not square)", kb.slice(0, 3));
      if (w === 390) await shot(page, "r113-annat-390");
      await H.closeSheet(page); await wait(page, 500);
      // R1-37: Mer på kartan: no darker square panel behind the lists
      await page.evaluate(() => document.getElementById("btn-more").click()); await wait(page, 1200);
      const bg = await page.evaluate(() => [...document.querySelectorAll("#sheet *")].filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          return r.width >= 60 && r.height >= 60 && (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none") && !e.classList.contains("ds-list"); }).map((e) => e.tagName + "." + e.className));
      ok(bg.length === 0, "R1-37 " + w + ": Mer på kartan has no panel behind its lists (only the rounded lists)", bg);
      await ctx.close();
      // R1-27: intro "Tillåt plats" = a PNI pin, no 📍 emoji hero
      const f = await H.ctxFor(browser, { width: w, height: VH[w] }, { clean: true });
      await f.page.goto(BASE); await wait(f.page, 3500);
      await f.page.evaluate(() => { const root = document.getElementById("intro-body"); if (!root) return; root.querySelectorAll("input[type=checkbox]").forEach((c) => { if (!c.checked) c.click(); });
        root.querySelectorAll("select").forEach((x) => { if (x.options.length > 1 && !x.value) { x.selectedIndex = Math.max(1, x.options.length - 20); x.dispatchEvent(new Event("change", { bubbles: true })); } }); });
      await wait(f.page, 300);
      await f.page.evaluate(() => { const b = [...document.querySelectorAll("#intro-body .btn-amber:not([disabled]), #intro-body .btn-block:not([disabled])")].find((x) => x.getClientRects().length); if (b) b.click(); });
      await wait(f.page, 1500);
      const it = await f.page.evaluate(() => { const b = document.querySelector("#intro-body .intro-big"); const h = document.querySelector("#intro-body .intro-h"); return b ? { svg: !!b.querySelector("svg"), txt: b.textContent, h: h && h.textContent } : null; });
      ok(it && it.svg && !/\p{Extended_Pictographic}/u.test(it.txt) && /plats/i.test(it.h || ""), "R1-27 " + w + ": 'Tillåt plats' hero is the PNI pin, no emoji", it);
      if (w === 390) await shot(f.page, "r127-intro-390");
      await f.ctx.close();
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
