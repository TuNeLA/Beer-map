// lane kpi (X9 + ds12): owner panel "Nyckeltal" in stats.html (owner_kpi, migration 0460) and no emoji in safety.js UI chrome.
// Usage: node kpi-pw.js <port> [part …]   parts: stats safety (default: both). Supabase is mocked (no server writes).
// stats:  the panel renders 14 nights + the 7-night block from a mocked owner_kpi; "<3" from the server shows as "<3";
//         a raw 1 or 2 in a count is shown as "<3" too; a wrong key = login, no panel, no numbers; an old server (no
//         owner_kpi) = no panel and no page error; no emoji in the panel.
// safety: report sheet + toast, block toast, unblock toast, Regler accept, Ring 112, Trygghet row, removal notice, age
//         widget: no emoji in buttons, labels, headings or toasts; PNI icons where the old text had an emoji;
//         safety.js string literals hold emoji only in the allow-list (big under-18 picture, the rank-prefix regex).
// Every check that needs the new code FAILS on 9d20bc9 (no stats-kpi.js, emoji in safety.js) and PASSES with the kpi patches;
// the two guard checks (wrong key, old server: no panel) pass on both.
// Shots: OUT/kpi-shots/<tag>-<name>-<w>.png (KPI_TAG=new|old).
const fs = require("fs");
const { chromium } = require("playwright");
const { ctxFor, wait } = require("./ds-helpers.js");
const OUT = require("./env.js").OUT, SHOTS = OUT + "kpi-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const TAG = process.env.KPI_TAG || "new";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const EMO = /\p{Extended_Pictographic}/u;
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 600))); c ? pass++ : fail++; };
const shot = (page, name, w, full) => page.screenshot({ path: `${SHOTS}${TAG}-${name}-${w}.png`, fullPage: !!full }).catch(() => {});

// ---------- mocked owner_kpi answer (what 0460 sends: counts, "<3", null for "not known yet") ----------
function stockholmDay(ms) {   // evening date: 05:00 → 05:00 Europe/Stockholm
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 5 * 3600e3));
  return p;   // YYYY-MM-DD
}
function kpiAnswer(o = {}) {
  const now = Date.now(), today = stockholmDay(now), rows = [];
  for (let i = 0; i < 14; i++) {
    const day = stockholmDay(now - i * 86400e3);
    rows.push({ day, su_anon: 12 + i, su_email: i === 2 ? "<3" : 4, groups: i === 3 ? "<3" : 3, out: 25 - i, act: 40 - i, coh: 16,
      d2: i >= 1 ? 6 : null, d2_pct: i >= 1 ? 38 : null, d7: i >= 7 ? "<3" : null, d7_pct: i >= 7 ? "<3" : null,
      beers_med: i === 5 ? "<3" : 3.5, crashes: i === 1 ? 0 : 4, cpu: 0.1, push: 45, inv_sent: 9, inv_yes: i === 4 ? (o.raw ? 2 : "<3") : 5 });
  }
  if (o.raw) rows[0].groups = 1;   // a raw small count (old or wrong answer): the client must still show "<3"
  return { ok: true, generated_at: new Date(now).toISOString(), today, days: 14, log_mode: o.mode || "on", rows,
    week: { su_anon: 101, su_email: 28, groups: 19, out: 160, people_out: 61, act: 260, coh2: 112, d2: 40, d2_pct: 36, coh7: 90, d7: 21, d7_pct: 23,
      beers_med: 3.5, crashes: 24, cpu: 0.09, push: 44, inv_sent: 63, inv_yes: "<3" } };
}
const FORBIDDEN = { code: "PT403", message: "forbidden", details: null, hint: null };
const MISSING = { code: "PGRST202", message: "Could not find the function public.owner_kpi(p_days, p_key) in the schema cache", details: null, hint: null };

async function statsPage(browser, w, o) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 860 }, deviceScaleFactor: 2, locale: "sv-SE", serviceWorkers: "block" });
  const page = await ctx.newPage(), errs = [], calls = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/\/auth\/v1\//, (r) => J(r, {}));
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (b.p_key !== "test-key") return J(r, FORBIDDEN, 403);
    if (fn === "owner_kpi") return o.missing ? J(r, MISSING, 404) : J(r, kpiAnswer(o));
    if (fn === "owner_stats2" || fn === "owner_stats") return J(r, { generated_at: new Date().toISOString(), users: { total: 400 }, beers: {}, places: {}, social: {}, care: {}, tech: {} });
    return J(r, MISSING, 404);   // other owner panels: "old server" = they stay hidden
  });
  await page.addInitScript((k) => { try { sessionStorage.setItem("olnu.ownerKey", k); } catch (e) {} }, o.key || "test-key");
  await page.goto(BASE + "stats.html");
  await wait(page, 3000);
  return { ctx, page, errs, calls };
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--no-sandbox"] });
  try {
    /* ================= stats: Nyckeltal ================= */
    if (want("stats")) {
      for (const w of [360, 390]) {
        const { ctx, page, errs, calls } = await statsPage(browser, w, {});
        const s = await page.evaluate(() => {
          const p = document.getElementById("pKpi"); if (!p || p.hidden) return null;
          const rows = [...p.querySelectorAll("table tr")].map((tr) => [...tr.children].map((c) => c.textContent));
          const de = document.documentElement;
          return { t: p.textContent, rows, head: rows[0], week: [...p.querySelectorAll(".kpi-week .stat")].map((x) => x.textContent),
            today: (p.querySelector("tr.today td") || {}).textContent || "", masks: p.querySelectorAll("td.mask").length,
            first: document.querySelector("#main > section.panel") === p, hscroll: de.scrollWidth > de.clientWidth + 1 };
        });
        ok(`stats ${w}: owner_kpi asked once with the owner key and 14 nights`, calls.some((c) => c[0] === "owner_kpi" && c[1].p_key === "test-key" && c[1].p_days === 14), calls.map((c) => c[0]));
        ok(`stats ${w}: Nyckeltal panel shown first in the owner page, 14 night rows + header, newest = 'ikväll'`,
          !!s && s.first && s.rows.length === 15 && /^ikväll /.test(s.today), s && { rows: s.rows.length, today: s.today, first: s.first });
        ok(`stats ${w}: columns for sign-ups anon/e-post, groups, out, D2, D7, beers median, crashes, push, invites`,
          !!s && ["Nya anon", "Nya e-post", "Grupper", "Ute", "Tillbaka D2", "Tillbaka D7", "Öl/pers (median)", "Krasch/anv", "Push", "Inbjudna", "Ja"].every((h) => s.head.includes(h)), s && s.head);
        ok(`stats ${w}: 7-night block (sign-ups, D2 36 %, D7 23 %, push 44 %)`, !!s && s.week.length === 9 && /101 anon · 28 e-post/.test(s.week[0]) && /40 · 36 %/.test(s.week[3]) && /21 · 23 %/.test(s.week[4]) && /44 %/.test(s.week[7]), s && s.week);
        ok(`stats ${w}: "<3" from the server shows as "<3" (masked cells), D2/D7 not known yet = "–"`,
          !!s && s.masks >= 5 && s.rows[1][7] === "–" && s.rows[2][6] === "6 · 38 %" && s.rows[9][7] === "<3" && /<3 svarade ja/.test(s.week[8]), s && { masks: s.masks, r1: s.rows[1], r9: s.rows[9] });
        ok(`stats ${w}: no emoji in the panel, no page scroll sideways, no page errors`, !!s && !EMO.test(s.t) && !s.hscroll && !errs.length, s && { emo: (s.t.match(EMO) || [])[0], h: s.hscroll, errs });
        await page.evaluate(() => { const p = document.getElementById("pKpi"); if (p) p.scrollIntoView(); }); await wait(page, 200);
        await shot(page, "nyckeltal", w);
        await page.evaluate(() => { const t = document.querySelector("#pKpi .kpi-scroll"); if (t) t.scrollLeft = 9999; }); await wait(page, 200);
        await shot(page, "nyckeltal-right", w);
        await ctx.close();
      }
      { // a raw 1 / 2 in a count (old answer) is still masked by the page
        const { ctx, page } = await statsPage(browser, 390, { raw: 1 });
        const r = await page.evaluate(() => { const p = document.getElementById("pKpi"); if (!p || p.hidden) return null; const tr = p.querySelectorAll("table tr"); return tr.length > 5 ? { g0: tr[1].children[3].textContent, y4: tr[5].children[13].textContent } : null; });
        ok("stats: a raw count 1 or 2 is shown as \"<3\" (client guard)", !!r && r.g0 === "<3" && r.y4 === "<3", r);
        await ctx.close();
      }
      { // log mode not on → a warning line
        const { ctx, page } = await statsPage(browser, 390, { mode: "optin" });
        const t = await page.evaluate(() => { const p = document.getElementById("pKpi"); return p && !p.hidden ? p.textContent : ""; });
        ok("stats: log mode 'optin' → note that active / returning / crashes are too low", /Loggen står på "optin"/.test(t), t.slice(0, 120));
        await ctx.close();
      }
      { // wrong key: login, no numbers
        const { ctx, page, calls } = await statsPage(browser, 390, { key: "wrong-key" });
        const r = await page.evaluate(() => ({ login: !document.getElementById("login").hidden, main: !document.getElementById("main").hidden,
          kpi: !!document.querySelector("#pKpi:not([hidden])"), rows: document.querySelectorAll("#pKpi table tr").length }));
        ok("stats: wrong key = login shown, no Nyckeltal panel, no number rows", r.login && !r.main && !r.kpi && r.rows === 0 && !calls.some((c) => c[0] === "owner_kpi" && c[1].p_key === "test-key"), r);
        await shot(page, "wrong-key", 390);
        await ctx.close();
      }
      { // old server: no owner_kpi
        const { ctx, page, errs } = await statsPage(browser, 390, { missing: 1 });
        const r = await page.evaluate(() => ({ main: !document.getElementById("main").hidden, kpi: !!document.querySelector("#pKpi:not([hidden])") }));
        ok("stats: old server (no owner_kpi, before 0460) = the rest of the page works, no Nyckeltal panel, no page error", r.main && !r.kpi && !errs.length, { r, errs });
        await ctx.close();
      }
    }

    /* ================= safety.js: no emoji in buttons / labels / headings / toasts ================= */
    if (want("safety")) {
      const src = await (await fetch(BASE + "js/safety.js")).text();   // the served file (old or new copy)
      // string literals (comments stripped) with an emoji; allowed: the big under-18 / age pictures and the rank-prefix regex
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
      const lits = (code.match(/"(?:[^"\\\n]|\\.)*"/g) || []).filter((x) => EMO.test(x));
      const allowed = (x) => /^"(🧃|🎂)"$/.test(x);
      const bad = lits.filter((x) => !allowed(x));
      ok("safety.js: no emoji in any UI string (only the big age pictures 🧃 / 🎂 stay)", bad.length === 0, bad);

      const w = 390;
      const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
      const calls = [];
      await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        calls.push([fn, b]);
        if (fn === "safety_state") return J(r, { v: 1, age_ok: true, terms_ver: 0, terms_at: null, store: "off", blocks: 1,
          notices: [{ id: 1, text: "Ditt inlägg togs bort eftersom det bröt mot Reglerna." }] });
        if (fn === "report_content") return J(r, { ok: true, hidden: false });
        if (fn === "block_user") return J(r, { ok: true, on: true, name: "Oskar", id: "0123456789abcdef" });
        if (fn === "my_blocks") return J(r, { blocks: [{ id: "0123456789abcdef", name: "Oskar" }] });
        if (fn === "unblock_user") return J(r, { ok: true });
        if (fn === "accept_terms") return J(r, { ok: true });
        return r.fallback();
      });
      await page.goto(BASE); await wait(page, 4500);
      await page.evaluate(() => {
        window.__toasts = [];
        const box = document.getElementById("toasts");
        new MutationObserver((l) => l.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) window.__toasts.push(n.textContent); }))).observe(box, { childList: true, subtree: true });
      });
      const ov = () => page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? { t: o.innerText, html: o.innerHTML } : null; });
      const closeOv = () => page.evaluate(() => document.querySelectorAll(".sf-ov").forEach((o) => o.remove()));
      // removal notice (safety_state notices) → heading with the megaphone icon
      const note = await ov();
      ok("safety: removal notice heading 'Från PintsNow' = PNI megaphone, no emoji", !!note && /Från PintsNow/.test(note.t) && /pi-megaphone/.test(note.html) && !EMO.test(note.t), note && note.t.slice(0, 120));
      await closeOv();
      // Regler accept button (terms_ver 0 = not accepted yet)
      await page.evaluate(() => { try { localStorage.removeItem("olnu.terms"); } catch (e) {} window.SAFETY.ensureTerms(); }); await wait(page, 500);
      const acc = await page.evaluate(() => { const b = document.querySelector(".sf-ov .sf-accept"); return b ? { t: b.textContent.trim(), i: !!b.querySelector(".pi-check") } : null; });
      ok("safety: Regler → 'Jag godkänner' with the PNI check icon, no emoji", !!acc && acc.t === "Jag godkänner" && acc.i, acc);
      await shot(page, "regler", w);
      await page.evaluate(() => { const b = document.querySelector(".sf-ov .sf-accept"); if (b) b.click(); }); await wait(page, 500);
      await closeOv();
      // report: sheet + send + thank-you toast
      await page.evaluate(() => window.SAFETY.report({ kind: "msg", ref: "77", what: "meddelandet", name: "Oskar" })); await wait(page, 400);
      await page.evaluate(() => { const c = document.querySelector('.sf-ov [data-r="spam"]'); if (c) c.click(); }); await wait(page, 150);
      await page.evaluate(() => { const b = document.querySelector(".sf-ov .btn-danger"); if (b) b.click(); }); await wait(page, 900);
      let t = await page.evaluate(() => window.__toasts.slice());
      ok("safety: report → report_content sent; thank-you toast has no emoji", calls.some((c) => c[0] === "report_content" && c[1].p_reason === "spam") && t.some((x) => /Tack! Vi kollar inom 24 timmar/.test(x)) && !t.some((x) => EMO.test(x)), t);
      // block → toast
      await page.evaluate(() => window.SAFETY.block({ kind: "msg", ref: "77", name: "Oskar" })); await wait(page, 300);
      await page.evaluate(() => { const b = document.querySelector(".sf-ov .btn-danger"); if (b) b.click(); }); await wait(page, 900);
      t = await page.evaluate(() => window.__toasts.slice());
      ok("safety: block → 'Oskar är blockerad.' toast, no emoji", t.some((x) => /Oskar är blockerad/.test(x)) && !t.some((x) => EMO.test(x)), t);
      // settings row: Trygghet heading + Regler / Blockerade / Kontakt
      const set = await page.evaluate(() => {
        const d = document.createElement("div"); d.id = "kpiSet"; document.body.appendChild(d); window.SAFETY.settingsSheet(d);
        const h3 = d.querySelector("h3"), bs = [...d.querySelectorAll(".btn")];
        return { h3: h3 && h3.textContent, h3i: !!(h3 && h3.querySelector(".pi-shield")), btns: bs.map((b) => b.textContent.trim()), icons: bs.map((b) => !!b.querySelector("svg.pi, .pi")) };
      });
      ok("safety: Inställningar → Trygghet: heading + Regler / Kontakt buttons with PNI icons and no emoji",
        set.h3 === "Trygghet" && set.h3i && set.btns.includes("Regler") && set.btns.includes("Kontakt") && set.icons.every(Boolean) && !set.btns.some((x) => EMO.test(x)), set);
      // Blockerade → Häv → toast
      const hasBlk = await page.evaluate(() => { const b = [...document.querySelectorAll("#kpiSet .btn")].find((x) => /Blockerade/.test(x.textContent)); if (b) b.click(); return !!b; });
      if (hasBlk) {
        await wait(page, 700);
        await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov .sf-blist button")].find((x) => /Häv|Avblockera/.test(x.textContent)); if (b) b.click(); }); await wait(page, 800);
        t = await page.evaluate(() => window.__toasts.slice());
        ok("safety: Blockerade → Häv → 'Oskar är inte blockerad längre.' toast, no emoji", t.some((x) => /Oskar är inte blockerad längre/.test(x)) && !t.some((x) => EMO.test(x)), t);
        await closeOv();
      } else ok("safety: Blockerade button in Trygghet (signed in)", false, set);
      // Ring 112
      const sos = await page.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); window.SAFETY.sos112(d); const a = d.querySelector("a.sf-112-btn"); return a ? { t: a.textContent.trim(), href: a.getAttribute("href"), i: !!a.querySelector(".pi-phone") } : null; });
      ok("safety: SOS 'Ring 112' = tel:112 link with the PNI phone icon, no emoji", !!sos && sos.t === "Ring 112" && sos.href === "tel:112" && sos.i, sos);
      // age widget: label + OK message
      const age = await page.evaluate(async () => {
        const cb = document.createElement("input"); cb.type = "checkbox"; const box = window.SAFETY.ageWidget(cb); document.body.appendChild(box);
        const sel = box.querySelector("select"); sel.value = "1990"; sel.dispatchEvent(new Event("change"));
        await new Promise((r) => setTimeout(r, 100));
        const msg = box.querySelector(".sf-age-msg");
        return { l: box.querySelector("label").textContent, m: msg.textContent.trim(), i: !!msg.querySelector(".pi-check") };
      });
      ok("safety: age picker label + 'Välkommen in, soldat.' without emoji (check icon)", age.l === "Vilket år ä du född?" && age.m === "Välkommen in, soldat." && age.i, age);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e && e.stack); fail++; }
  await browser.close();
  console.log(`kpi-pw: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
