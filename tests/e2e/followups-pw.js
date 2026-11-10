// lane followups (10 Nov): small leftovers of the day's lanes. Each check FAILS on the old code and PASSES on the new.
//  T1 ride → after: Kvällens chaufför from ride_awards (0453: rides / thanks), never for drinking
//  T2 "Dagens order" caption head: PNI rules icon (not the copy icon, no emoji)
//  T3 Topplistor → Meriter: no empty "Helgstreak" box without streak data
//  T4 safety.js: PNI flag / block in the chat picker + report / block / action overlays, no 🚩 🚫
//  T5 ⓘ legend: no emoji, the invite line has a PNI icon
//  T6 R1-38 Spel top bar icons at first paint · R1-40 no icon in the Kebabkungen heading · R1-42 fade under sticky tabs ·
//     R1-45 .ev-line in one file · R1-48 Topplistor boxes · R1-49 stamp ink contrast · R1-29 camera sentence case ·
//     R1-26 Spel badge ≠ bar sport line (.sp-tag)
//  T7 R1-43 token swaps: every swapped declaration is in the served CSS and computes exactly like the old literal
// Mocked Supabase (ds-helpers). usage: node followups-pw.js <port> [shot-tag] [only-regex]
const H = require("./ds-helpers.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SP = require("./env.js").OUT, DIR = SP + "followups-shots/";
fs.mkdirSync(DIR, { recursive: true });
const TAG = process.argv[3] || "t", ONLY = new RegExp(process.argv[4] || ".");
const { wait, GID } = H;
const DOCS = path.join(__dirname, "../../docs/"), MIG = path.join(__dirname, "../../supabase/migrations/");
let pass = 0, fail = 0;
const ok = (m, c, x) => { c = !!c; console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const W3 = [360, 390, 430], HT = { 360: 780, 390: 844, 430: 932 };
const shot = (page, name) => page.screenshot({ path: DIR + TAG + "-" + name + ".png" }).catch(() => {});
const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
async function setup(browser, w, o = {}) {
  const { ctx, page } = await H.ctxFor(browser, { width: w, height: HT[w] || 844 }, o);
  if (o.init) await ctx.addInitScript(o.init);
  if (o.routes) await o.routes(page);
  if (o.url) { await page.goto(`http://127.0.0.1:${process.argv[2]}/${o.url}`); await page.waitForFunction(() => window.PNI && window.PNDS, null, { timeout: 30000 }).catch(() => {}); await wait(page, o.settle || 5000); }
  else await H.boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page };
}
const closeSheet = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden) document.getElementById("sheet-close").click(); }).then(() => wait(page, 700));

// ---------- T1 data: one night, after_report2 shape (0450 + 0453 keys) ----------
const NIGHT = (() => { const d = new Date(); d.setHours(5, 0, 0, 0); return d; })();
const at = (h, m) => { const d = new Date(NIGHT); d.setDate(d.getDate() - (h >= 12 ? 1 : 0)); d.setHours(h, m, 0, 0); return d.toISOString(); };
const P = (o) => Object.assign({ is_me: false, first_at: null, last_at: null, first_place: null, bars: 0, said_ute: false, said_at: null, home_at: null, skal: 0, driver: false, out: false }, o);
function report() {
  return { v: 1, night: NIGHT.toISOString(), evening: at(18, 0).slice(0, 10), group: { id: GID, name: "Grabbarna Grus" }, groups: [{ id: GID, name: "Grabbarna Grus", n: 5, me: true }],
    people: [
      // Sara opened the night (first out) AND drove two rides home: she is Kvällens chaufför, not Kvällens kapten
      P({ k: "k-sara", name: "Sara", first_at: at(20, 10), last_at: at(23, 50), first_place: "Pitchers", bars: 1, home_at: at(1, 30), driver: true, rides: 2, thanks: 1, out: true }),
      P({ k: "k-anton", name: "Anton", is_me: true, first_at: at(20, 47), last_at: at(23, 30), first_place: "Pitchers", bars: 1, home_at: at(0, 40), skal: 3, out: true }),
      P({ k: "k-oskar", name: "Oskar", first_at: at(21, 21), last_at: at(1, 50), first_place: "Pitchers", bars: 2, home_at: at(2, 41), out: true }),
      // Nisse has a ride row but drank: the server says driver = false, rides = 0 → never the driver
      P({ k: "k-nisse", name: "Nisse", first_at: at(21, 40), last_at: at(0, 10), first_place: "Pitchers", bars: 1, home_at: at(0, 50), driver: false, rides: 0, out: true }),
      // Tre only drove (LÄSK!, no drink row): 0453 adds him as out = false
      P({ k: "k-tre", name: "Tre", driver: true, rides: 1, thanks: 0, out: false })],
    stops: [{ k: "k-sara", at: at(20, 10), bar_id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679 },
      { k: "k-anton", at: at(20, 47), bar_id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679 },
      { k: "k-oskar", at: at(21, 21), bar_id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679 },
      { k: "k-oskar", at: at(22, 5), bar_id: "x-lobby", name: "Lobbybaren", lat: 60.15098, lng: 15.18663 }],
    homes: [], prev: null, ghost_me: false, bets: [], missions: [], agent: null };
}
// ---------- Ölpasset data: bar ids x0…x5 give the 6 stamp inks (passport.js hash("b:" + id) % 6) ----------
const PB = { v: 1, nights_n: 9, towns: [{ town: "Ludvika", nights: 9, first: "2026-08-02", last: "2026-11-07" }],
  bars: ["Pitchers", "La Parma Pub", "Lobbybaren", "Bishops Arms", "Bryggeriet", "Grekiska Tavernan"].map((n, i) => ({ id: "x" + i, bar_id: "x" + i, name: n, lat: 60.15 + i * 0.001, lng: 15.18, town: "Ludvika", in_se: true, nights: 1 + (i % 3), first: "2026-10-0" + (1 + i) })) };
const SPORT = { v: 1, bars: [{ bar_id: "n3472634175", name: "Pitchers", lat: 60.14997, lng: 15.18679, yes: 3, no: 0, owner: null, shows: true, mine: null }] };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ================= T1 ride → after: Kvällens chaufför ================= */
    if (ONLY.test("T1")) for (const w of W3) {
      const { ctx, page } = await setup(browser, w, { routes: (pg) => pg.route(/rest\/v1\/rpc\/after_report2\b/, (r) => J(r, report())) });
      await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 900);
      const m = await page.evaluate(() => { const s = window.AFTER2._st(); return s && s.m ? s.m.people.map((p) => ({ n: p.name, id: p.aw.id, name: p.aw.name, fact: p.aw.fact })) : null; });
      const by = Object.fromEntries((m || []).map((x) => [x.n, x]));
      if (w === 390) {
        ok("T1 a ride driver (rides > 0) is Kvällens chaufför, even when first out (no wrong 'Först ute' title for someone else)",
          by.Sara && by.Sara.id === "chauf" && by.Sara.name === "Kvällens chaufför" && !(m || []).some((x) => /kapten|jarn/.test(x.id) && x.n !== "Sara" && /Först ute/.test(x.fact)), m);
        ok("T1 the award line says the rides + thanks (2 körningar hem · 1 tack)", by.Sara && /2 körningar hem/.test(by.Sara.fact) && /1 tack/.test(by.Sara.fact), by.Sara);
        ok("T1 a driver who only drove (no drink row, out = false) gets the award: 1 körning hem", by.Tre && by.Tre.id === "chauf" && /1 körning hem/.test(by.Tre.fact), by.Tre);
        ok("T1 never for drinking: a person the server marks as drank (driver false) is not the chaufför", by.Nisse && by.Nisse.id !== "chauf", by.Nisse);
        // old server (no rides key): exactly the 0450 behaviour (driver_status → chauf after the other titles)
        const old = await page.evaluate(() => window.AFTER2._awards([{ k: "a", name: "A", first_at: new Date(Date.now() - 4e6).toISOString(), last_at: new Date().toISOString(), bars: 1, driver: true, out: true },
          { k: "b", name: "B", first_at: new Date(Date.now() - 3e6).toISOString(), last_at: new Date().toISOString(), bars: 1, driver: false, out: true }]));
        ok("T1 old server (no rides): unchanged — a driver_status driver who opened the night keeps the first-out title (old order)", old && /^(kapten|jarn)$/.test(old[0].id), old);
      }
      // the report shows the chaufför card (one card per fact; the ride driver always gets one)
      const txt = await page.evaluate(async () => { const out = []; for (let i = 0; i < 20; i++) { const c = document.querySelector(".a2-card"); out.push(c ? c.innerText : ""); const n = document.querySelector('.a2 [data-a2="next"]'); if (!n || n.disabled) break; n.click(); await new Promise((r) => setTimeout(r, 70)); } return out; });
      const card = txt.findIndex((t) => /Kvällens chaufför/.test(t) && /Sara/.test(t) && /körningar/.test(t));
      ok(`T1 ${w}: the report has a Kvällens chaufför card for Sara`, card >= 0, txt.map((t) => t.slice(0, 60)));
      if (card >= 0) {   // the shot: open again and step to that card
        await page.evaluate(() => { const x = document.querySelector('.a2 [data-a2="x"]'); if (x) x.click(); }); await wait(page, 500);
        await page.evaluate(() => window.AFTER2.open(null, null)); await wait(page, 700);
        for (let k = 0; k < card; k++) { await page.evaluate(() => { const n = document.querySelector('.a2 [data-a2="next"]'); if (n && !n.disabled) n.click(); }); await wait(page, 350); }
        await shot(page, "T1-chauffor-" + w);
      }
      await ctx.close();
    }
    if (ONLY.test("T1")) {
      const f = MIG + "0453_followups_ride_award.sql", s = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "", base = fs.readFileSync(MIG + "0450_after_report.sql", "utf8");
      const anchors = [...s.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map((x) => x[1]);
      ok("T1 0453: both anchors occur exactly once in after_report2 (0450), no forbidden words, reads ride_awards",
        anchors.length === 2 && anchors.every((a) => base.split(a).length === 2) && !/\b(delete|drop|truncate)\b/i.test(s) && /ride_awards/.test(s) && /not p\.drank/.test(s), { n: anchors.length });
    }

    /* ================= T2 Dagens order: PNI rules icon ================= */
    if (ONLY.test("T2")) for (const w of W3) {
      const { ctx, page } = await setup(browser, w);
      await page.waitForSelector(".dl-cap-greet", { timeout: 9000 }).catch(() => page.evaluate(() => window.DELIGHT && window.DELIGHT.greet()));
      await page.waitForFunction(() => { const c = document.querySelector(".dl-cap-greet .dl-cap-h"); return c && c.querySelector("svg"); }, null, { timeout: 8000 }).catch(() => {});
      const h = await page.evaluate(() => { const c = document.querySelector(".dl-cap-greet .dl-cap-h"); return c ? { t: c.textContent, rules: !!c.querySelector(".pi-rules"), copy: !!c.querySelector(".pi-copy") } : null; });
      ok(`T2 ${w}: "Dagens order" head has the PNI rules icon, not the copy icon, no emoji`, h && /Dagens order/.test(h.t) && h.rules && !h.copy && !EMO.test(h.t), h);
      await shot(page, "T2-greet-" + w);
      await ctx.close();
    }

    /* ================= T3 Topplistor → Meriter: no empty Helgstreak box ================= */
    if (ONLY.test("T3")) for (const w of W3) {
      for (const withData of [false, true]) {
        if (withData && w !== 390) continue;
        const HS = { v: 1, week: "2026-W46", me: { streak: 3, best: 5, freezes: 1, weeks: [{ s: "out" }, { s: "out" }, { s: "frozen" }, { s: "out" }], done: false, at_risk: false }, groups: [] };
        const { ctx, page } = await setup(browser, w, withData ? { routes: (pg) => pg.route(/rest\/v1\/rpc\/helg_state\b/, (r) => J(r, HS)) } : {});
        await page.click("#btn-top"); await wait(page, 1500);
        await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body > .tt-bar button")].find((x) => x.getAttribute("data-t") === "mer"); if (b) b.click(); }); await wait(page, 1500);
        const r = await page.evaluate(() => { const s = [...document.querySelectorAll("#sheet-body .hs-top")]; return s.map((x) => ({ vis: !!x.getClientRects().length && getComputedStyle(x).display !== "none", h: Math.round(x.getBoundingClientRect().height), t: x.innerText.trim().slice(0, 80), big: !!x.querySelector(".hs-big") })); });
        if (!withData) ok(`T3 ${w}: no streak data → no visible Helgstreak section (no empty box)`, !r.some((x) => x.vis), r);
        else ok("T3 with streak data the Helgstreak section shows (3 veckor)", r.some((x) => x.vis && x.big && /3/.test(x.t)), r);
        await page.evaluate(() => { const b = document.getElementById("sheet-body"); b.scrollTop = b.scrollHeight; }); await wait(page, 300);
        await shot(page, "T3-meriter-" + (withData ? "data-" : "") + w);
        await ctx.close();
      }
    }

    /* ================= T4 safety: PNI flag / block, no 🚩 🚫 ================= */
    if (ONLY.test("T4")) for (const w of W3) {
      const { ctx, page } = await setup(browser, w);
      const pick = await page.evaluate(async () => {
        const li = document.createElement("li"); li.className = "chat-msg"; li.setAttribute("data-mid", "77"); li.innerHTML = '<span class="cm-name">Oskar</span><span class="cm-text">hej</span>';
        const ul = document.createElement("ul"); ul.className = "chat-list"; ul.style.cssText = "position:fixed;left:0;right:0;top:300px;z-index:5000;list-style:none;padding:60px 12px"; ul.appendChild(li); document.body.appendChild(ul);
        const pk = document.createElement("div"); pk.className = "cm-picker"; pk.setAttribute("role", "menu"); li.appendChild(pk);
        await new Promise((r) => setTimeout(r, 150));
        const b = [...pk.querySelectorAll(".sf-pick")];
        return b.map((x) => ({ a: x.getAttribute("aria-label"), t: x.textContent.trim(), flag: !!x.querySelector(".pi-flag"), block: !!x.querySelector(".pi-block") }));
      });
      ok(`T4 ${w}: chat picker report + block = PNI flag / block icons, no emoji text`, pick.length === 2 && pick[0].flag && pick[1].block && pick.every((x) => !x.t && x.a), pick);
      await shot(page, "T4-picker-" + w);
      await page.evaluate(() => document.querySelectorAll("ul.chat-list").forEach((u) => { if (u.querySelector('[data-mid="77"]')) u.remove(); }));
      await page.evaluate(() => window.SAFETY.report({ kind: "msg", ref: "77", what: "meddelandet", name: "Oskar" })); await wait(page, 500);
      const rep = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); if (!o) return null; return { t: o.innerText, h2: !!o.querySelector("h2 .pi-flag"), send: !!o.querySelector(".btn-danger .pi-flag"), chips: [...o.querySelectorAll(".sf-chip")].map((c) => c.textContent) }; });
      ok(`T4 ${w}: report sheet: PNI flag in the title + send button, reasons and labels without emoji`, rep && rep.h2 && rep.send && rep.chips.length === 7 && !EMO.test(rep.t), rep && { h2: rep.h2, send: rep.send, emo: (rep.t.match(EMO) || [])[0], t: rep.t.slice(0, 200) });
      await shot(page, "T4-report-" + w);
      await page.evaluate(() => { const o = document.querySelector(".sf-ov"); if (o) o.remove(); window.SAFETY.block({ kind: "msg", ref: "77", name: "Oskar" }); }); await wait(page, 400);
      const blk = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? { t: o.innerText, h2: !!o.querySelector("h2 .pi-block"), btn: !!o.querySelector(".btn-danger .pi-block") } : null; });
      ok(`T4 ${w}: block sheet: PNI block icon in the title + button, no emoji`, blk && blk.h2 && blk.btn && !EMO.test(blk.t), blk);
      await shot(page, "T4-block-" + w);
      await page.evaluate(() => { const o = document.querySelector(".sf-ov"); if (o) o.remove(); window.SAFETY.actions({ kind: "voice", ref: "9", what: "röstklippet", name: "Oskar" }); }); await wait(page, 400);
      const act = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? { t: o.innerText, flag: !!o.querySelector(".btn .pi-flag"), block: !!o.querySelector(".btn .pi-block") } : null; });
      ok(`T4 ${w}: action menu (long-press / MISC.reportMenu): PNI flag + block, no emoji`, act && act.flag && act.block && !EMO.test(act.t), act);
      await ctx.close();
    }

    /* ================= T5 ⓘ legend ================= */
    if (ONLY.test("T5")) for (const w of W3) {
      const { ctx, page } = await setup(browser, w);
      await page.evaluate(() => { const b = document.getElementById("btn-attrib"); if (b) b.click(); }); await wait(page, 600);
      const lg = await page.evaluate(() => { const l = document.querySelector("#attrib-pop .inv-legend"); return l ? { t: l.innerText, spans: [...l.querySelectorAll(":scope > span")].map((s) => ({ t: s.textContent.trim().slice(0, 40), mark: !!s.querySelector("i, svg") })) } : null; });
      ok(`T5 ${w}: ⓘ legend lines have no emoji; every line has its mark (invite = PNI icon)`, lg && !EMO.test(lg.t) && lg.spans.length === 4 && lg.spans.every((s) => s.mark) && /inbjudan/.test(lg.spans[3].t), lg);
      await shot(page, "T5-legend-" + w);
      await ctx.close();
    }

    /* ================= T6 R1 low items ================= */
    if (ONLY.test("T6")) {
      // R1-45 static: .ev-line rules live in ONE component file (pnds.css = the design system's last word, not counted)
      const files = fs.readdirSync(DOCS).filter((f) => f.endsWith(".css") && f !== "pnds.css").filter((f) => /\.ev-line\b/.test(fs.readFileSync(DOCS + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
      ok("T6 R1-45 .ev-line is styled from one file (events.css)", files.length === 1 && files[0] === "events.css", files);
      // R1-29 film camera: no ALL CAPS chrome
      const fc = fs.readFileSync(DOCS + "js/filmcam.js", "utf8");
      ok("T6 R1-29 Engångskamera: 'PintsNow · Engångs 27' + 'Filmen slut' (sentence case)", /"PintsNow · Engångs 27"/.test(fc) && /empty: "Filmen slut"/.test(fc) && !/PINTSNOW · ENGÅNGS|"FILMEN SLUT"|"OUT OF FILM"/.test(fc));
      for (const w of W3) {
        const { ctx, page } = await setup(browser, w, {
          init: () => {   // the Spel top bar buttons as they are first put in the DOM (before pnds.js may swap characters for icons)
            window.__fuFirst = [];
            new MutationObserver((l) => l.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) n.querySelectorAll && [n, ...n.querySelectorAll(".sp-back, .sp-x")].forEach((b) => { if (b.matches && b.matches(".sp-back, .sp-x")) window.__fuFirst.push({ c: b.className, t: b.textContent, svg: !!b.querySelector("svg") }); }); }))).observe(document, { childList: true, subtree: true });
          },
          routes: async (pg) => { await pg.route(/rest\/v1\/rpc\/my_passport\b/, (r) => J(r, PB)); await pg.route(/rest\/v1\/rpc\/beer_type_stats\b/, (r) => J(r, [{ scope: "town", period: "night", type: "lager", n: 5 }, { scope: "sweden", period: "night", type: "ipa", n: 9 }])); }
        });
        // R1-42 Grupper tabs + R1-48/R1-40 Topplistor
        await page.click("#btn-groups"); await wait(page, 1500);
        const fadeG = await page.evaluate(() => { const t = document.querySelector(".sheet .tabs.inv-tabs"); if (!t) return null; const a = getComputedStyle(t, "::after"), r = t.getBoundingClientRect(); return { bottom: a.bottom, h: parseFloat(a.height), bar: r.height, fade: /transparent|rgba\(0, 0, 0, 0\)/.test(a.backgroundImage.split("),").pop() || ""), layers: (a.backgroundImage.match(/gradient\(/g) || []).length }; });
        ok(`T6 R1-42 ${w}: Grupper tab bar ends in a 16 px fade (the strip above stays)`, fadeG && fadeG.bottom === "-16px" && fadeG.layers === 4 && fadeG.fade && fadeG.h >= fadeG.bar + 31, fadeG);
        await page.evaluate(() => { const b = document.getElementById("sheet-body"); b.scrollTop = 160; }); await wait(page, 300); await shot(page, "T6-R1-42-grupper-" + w);
        await closeSheet(page);
        await page.click("#btn-top"); await wait(page, 2200);
        const top = await page.evaluate(() => {
          const t = document.querySelector("#sheet-body > .tt-bar"), a = t && getComputedStyle(t, "::after");
          const sb = [...document.querySelectorAll(".bp-sb")].map((e) => { const c = getComputedStyle(e); return { sh: c.boxShadow, r: parseFloat(c.borderTopLeftRadius) }; });
          const bd = document.querySelector("#sheet-body > .bd-box"), k = [...document.querySelectorAll("#sheet-body .gg-h4")].find((h) => /Kebab/.test(h.textContent));
          return { fade: a && { bottom: a.bottom, layers: (a.backgroundImage.match(/gradient\(/g) || []).length }, sb, bd: bd && getComputedStyle(bd).borderTopWidth, keb: k ? { t: k.textContent.trim(), icon: !!k.querySelector("svg"), emo: /🌯/.test(k.textContent) } : null };
        });
        ok(`T6 R1-42 ${w}: Topplistor tab bar ends in a 16 px fade`, top.fade && top.fade.bottom === "-16px" && top.fade.layers === 4, top.fade);
        ok(`T6 R1-48 ${w}: "Vad dricker stan?" blocks rounded, no amber stripe; the opt-in wrapper has no amber top line`, top.sb.length >= 1 && top.sb.every((x) => x.sh === "none" && x.r >= 12) && top.bd === "0px", { sb: top.sb, bd: top.bd });
        ok(`T6 R1-40 ${w}: "Kebabkungen i …" heading without an icon (like the other headings)`, top.keb && !top.keb.icon && !top.keb.emo, top.keb);
        await page.evaluate(() => { const s = document.querySelector(".bp-stats"); if (s) s.scrollIntoView({ block: "center" }); }); await wait(page, 300); await shot(page, "T6-R1-48-top-" + w);
        await closeSheet(page);
        // R1-49 Ölpasset: ink text ≥ 3.6:1 on the paper for every ink (opacity + multiply over the darker paper end)
        await page.evaluate(() => window.PASSPORT.open()); await wait(page, 4000);
        const inks = await page.evaluate(() => {
          const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }, L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
          const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
          const pg = document.querySelector(".ps-page"); if (!pg) return null;
          const stops = (getComputedStyle(pg).backgroundImage.match(/rgb\([^)]*\)/g) || []).map(rgb).filter((p) => p.length === 3);
          const paper = stops.sort((a, b) => L(a) - L(b))[0];   // the darker paper stop (worst case)
          const seen = {};
          [...document.querySelectorAll(".ps-stamp")].forEach((s) => { const cs = getComputedStyle(s), ink = rgb(cs.color), op = +cs.opacity;
            const fin = ink.map((c, i) => paper[i] * (1 - op) + (c * paper[i] / 255) * op);
            seen[cs.color] = +((L(paper) + 0.05) / (L(fin) + 0.05)).toFixed(2); });
          return { paper, inks: seen };
        });
        const worst = inks ? Math.min(...Object.values(inks.inks)) : 0;
        ok(`T6 R1-49 ${w}: every stamp ink ≥ 3.6:1 on the paper (${inks ? Object.keys(inks.inks).length : 0} inks, worst ${worst})`, inks && Object.keys(inks.inks).length >= 5 && worst >= 3.6, inks);
        await page.evaluate(() => { const p = document.querySelector(".ps-page"); if (p) p.scrollIntoView({ block: "start" }); }); await wait(page, 400); await shot(page, "T6-R1-49-pass-" + w);
        await closeSheet(page);
        // R1-38 Spel top bar: PNI icons from the first paint (no ‹ / ✕ text), hub ‹ only, game ‹ + ✕
        await page.evaluate((g) => window.SPEL.open({ id: g, name: "Ludvika Lager" }), GID); await wait(page, 2500);
        const hub = await page.evaluate(() => ({ first: window.__fuFirst.slice(), back: (() => { const b = document.querySelector("#sp .sp-back"); return b && { l: b.getAttribute("aria-label"), svg: !!b.querySelector(".pi-chev-left") }; })(), x: !!document.querySelector("#sp .sp-x"),
          badges: [...document.querySelectorAll("#sp .sp-badge")].map((b) => b.textContent), tags: document.querySelectorAll("#sp .sp-tag").length }));
        ok(`T6 R1-38 ${w}: Spel hub ‹ is a PNI icon from the first paint ('Tillbaka till gruppen'), no ✕ in the hub`, hub.first.length >= 1 && hub.first.every((f) => f.svg && !/[‹✕]/.test(f.t)) && hub.back && hub.back.svg && hub.back.l === "Tillbaka till gruppen" && !hub.x, hub);
        ok(`T6 R1-26 ${w}: Spel badges use their own class (.sp-badge), never .sp-tag (the bar sport line)`, hub.tags === 0 && hub.badges.length >= 1, { badges: hub.badges, tags: hub.tags });
        await shot(page, "T6-R1-38-hub-" + w);
        await page.evaluate(() => { const c = document.querySelector("#sp .sp-card"); if (c) c.click(); }); await wait(page, 1500);
        const game = await page.evaluate(() => ({ first: window.__fuFirst.slice(-2), back: !!document.querySelector("#sp .sp-back .pi-chev-left"), x: !!document.querySelector("#sp .sp-x .pi-x"), xl: (document.querySelector("#sp .sp-x") || {}).ariaLabel }));
        ok(`T6 R1-38 ${w}: a game shows ‹ + ✕ as PNI icons from the first paint`, game.back && game.x && game.first.every((f) => f.svg && !/[‹✕]/.test(f.t)), game);
        await shot(page, "T6-R1-38-game-" + w);
        await ctx.close();
      }
      // R1-26 runtime: after Spel ran (spel.css loaded), the bar sport line keeps its own look, and an old server removes
      // only the sport lines, never the Spel badges
      const { ctx, page } = await setup(browser, 390, { url: "?bar=n3472634175", checkin: false, settle: 6000,
        routes: async (pg) => { await pg.route(/rest\/v1\/rpc\/bar_sport_near\b/, (r) => J(r, SPORT)); await pg.route(/rest\/v1\/rpc\/vote_bar_sport\b/, (r) => J(r, { code: "PGRST202", message: "Could not find the function public.vote_bar_sport" }, 404)); } });
      const before = await page.evaluate(() => { const t = document.querySelector(".leaflet-popup .sp-tag[data-sptag]"); const c = t && getComputedStyle(t); return t ? { ls: c.letterSpacing, color: c.color, font: c.fontWeight + " " + c.fontSize } : null; });
      await page.evaluate((g) => window.SPEL.open({ id: g, name: "Ludvika Lager" }), GID); await wait(page, 2500);
      const after = await page.evaluate(() => { const t = document.querySelector(".leaflet-popup .sp-tag[data-sptag]"); const c = t && getComputedStyle(t); return t ? { ls: c.letterSpacing, color: c.color, font: c.fontWeight + " " + c.fontSize } : null; });
      ok("T6 R1-26 the bar sport line looks the same after the Spel hub loaded spel.css (no .sp-tag clash)", before && after && JSON.stringify(before) === JSON.stringify(after), { before, after });
      const nb = await page.evaluate(() => document.querySelectorAll("#sp .sp-badge, #sp .sp-tag").length);
      await page.evaluate(() => { const b = document.querySelector('.leaflet-popup [data-spvote="1"]'); if (b) b.click(); }); await wait(page, 1200);
      const left = await page.evaluate(() => ({ lines: document.querySelectorAll(".leaflet-popup .sp-tag[data-sptag]").length, badges: document.querySelectorAll("#sp .sp-badge, #sp .sp-tag").length }));
      ok("T6 R1-26 old server (vote RPC missing): the sport lines go, the Spel badges stay (sport.js removes only its own)", nb >= 1 && left.lines === 0 && left.badges === nb, { nb, left });
      await ctx.close();
    }

    /* ================= T7 R1-43 token swaps ================= */
    if (ONLY.test("T7")) {
      const man = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/followups-tokswap.json"), "utf8")).decls;
      const missing = man.filter((m) => { const s = fs.readFileSync(DOCS + m.file, "utf8"); return !s.includes(m.prop + ":" + m.new) && !s.includes(m.prop + ": " + m.new); });
      ok("T7 all " + man.length + " swapped declarations are in the CSS files (literal → var(--token))", man.length >= 100 && missing.length === 0, { missing: missing.length, ex: missing.slice(0, 3) });
      // no token used by a swap is defined anywhere else than :root (CSS) or set from JS: the value is the same everywhere
      const toks = [...new Set(man.flatMap((m) => [...m.new.matchAll(/var\((--[\w-]+)\)/g)].map((x) => x[1])))];
      const css = fs.readdirSync(DOCS).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(DOCS + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
      const js = fs.readdirSync(DOCS + "js").filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(DOCS + "js/" + f, "utf8")).join("\n");
      const scoped = toks.filter((t) => { const re = new RegExp("([^{}]*)\\{[^{}]*" + t.replace(/-/g, "\\-") + "\\s*:", "g"); return [...css.matchAll(re)].some((m) => !/:root\s*$/.test(m[1].trim())) || new RegExp(t.replace(/-/g, "\\-") + "\\s*:").test(js); });
      ok("T7 the " + toks.length + " tokens are only defined in :root (never scoped, never set from JS)", scoped.length === 0, scoped);
      for (const pgName of ["index.html", "karta3d.html", "fx-test.html"]) {
        const list = pgName === "index.html" ? man : man.filter((m) => (pgName === "karta3d.html" ? ["styles.css", "polish.css"] : ["styles.css", "fx.css"]).includes(m.file));
        const ctx = await browser.newContext({ serviceWorkers: "block" }), page = await ctx.newPage();
        await page.route(/supabase\.co|mapbox\.com|open-meteo|tile\.openstreetmap/, (r) => r.abort());
        await page.goto(`http://127.0.0.1:${process.argv[2]}/${pgName}`); await wait(page, pgName === "index.html" ? 3500 : 1200);
        const bad = await page.evaluate((list) => {
          const host = document.createElement("div"); document.body.appendChild(host); const out = [];
          for (const m of list) {
            const st = (v) => { const e = document.createElement("div"); host.appendChild(e); e.style.setProperty(m.prop, v); const set = e.style.getPropertyValue(m.prop) !== ""; const cs = getComputedStyle(e), o = {}; for (const p of cs) o[p] = cs.getPropertyValue(p); e.remove(); return { set, o }; };
            const a = st(m.old), c = st(m.new), d = Object.keys(a.o).filter((p) => a.o[p] !== c.o[p]);
            if (!a.set || !CSS.supports(m.prop, m.old) || d.length) out.push({ f: m.file, p: m.prop, d: d.slice(0, 3).map((p) => [p, a.o[p], c.o[p]]) });
          }
          return out;
        }, list);
        ok(`T7 ${pgName}: ${list.length} swapped declarations compute exactly like the old literal (every computed property)`, bad.length === 0, bad.slice(0, 4));
        await ctx.close();
      }
    }
  } catch (e) { ok("crash " + (e && e.stack || e), false); }
  await browser.close();
  console.log(`SUMMARY followups pass ${pass} fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
