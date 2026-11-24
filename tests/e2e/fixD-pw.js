// fixD-pw.js — lane fixD (polish sweep D, 24 Nov 2026; findings: pn-scratch lanes/polish-FINDINGS.md).
// P-08 the Ikväll button is a row in the page flow: it never covers the chat preview or the chat field (360 + 390 px).
// P-09 Spel = ONE ordinary card on the group page (no game running); no second Spel row in Ikväll; no empty "Spel & kul" head.
// P-16 Ikväll rows: one own icon per row (Ceremoni, Truppen and Kalla in had the same medal); hints start with a capital.
// P-21 events: nothing in 7 days → the month is asked for and shown at once; an empty tab names the next event + "Visa nästa
//      event"; nothing at all → the text says so for the whole month (not only "ikväll").
// P-22 chat composer: while you type, mic + camera step aside (field ≥ 240 px at 390); send is not amber while empty.
// P-29 Grupper invite card: "Bjud in en kompis" + "Till:" over the group pills (sv + en); after "Skapa grupp" the invite
//      sheet names the new group (guard).
// Mocked Supabase (d2-helpers). Usage: node fixD-pw.js <port> [shotsDir]
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.argv[3] || "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 500)); };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/fixD-" + name + ".png" }); };
const day = (d, hh) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(hh, 0, 0, 0); return t.toISOString(); };

async function open(browser, vp, o = {}) {
  const { ctx, page } = await ctxFor(browser, vp, o);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (o.routes) await o.routes(page);
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  return { ctx, page, errs };
}
async function openGroup(page) {
  await clickJS(page, "#btn-groups"); await wait(page, 1200);
  await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika Lager/.test(x.textContent)); if (c) c.click(); });
  await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {});
  await wait(page, 2000);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}
const R = (r) => r ? { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) } : null;

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    // ---------- P-08 · P-09 · P-16 (group page) ----------
    for (const [w, h] of [[360, 740], [390, 844]]) {
      const P = `[${w}]`;
      const { ctx, page, errs } = await open(browser, { width: w, height: h });
      await openGroup(page);
      const a = await page.evaluate(() => {
        const sb = document.getElementById("sheet-body"), vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).display !== "none");
        const box = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; };
        const bar = document.querySelector(".gpg > .gpg-bar"), chat = document.querySelector(".gpg > .gpg-chat"), sp = document.querySelector(".gpg > .sp-gi");
        const about = document.querySelector(".gpg > .gpg-dots"), sbr = sb.getBoundingClientRect();
        // overlap in the first view: the part of the chat card that is on screen vs the Ikväll button
        const cb = box(chat), bb = box(bar), top = Math.max(cb.t, bb.t, sbr.top), bot = Math.min(cb.b, bb.b, sbr.bottom);
        const out = { pos: getComputedStyle(bar).position, over0: Math.max(0, Math.round(bot - top)), barBelowChat: bb.t >= cb.b - 1,
          sp: vis(sp), spText: sp ? sp.textContent.replace(/\s+/g, " ").trim() : "", spAfterChat: !!(sp && vis(sp) && box(sp).t >= cb.b - 1),
          barBeforeAbout: !!(about && bb.b <= box(about).t + 1), chev: !!bar.querySelector(".pi-chev-right"), sub: (bar.querySelector("small") || {}).textContent || "" };
        // the chat field brought to the bottom edge of the sheet: what is under its centre?
        const inp = document.querySelector(".gpg-chat .gpg-inp");
        inp.scrollIntoView({ block: "end" });
        const ir = inp.getBoundingClientRect(), hit = document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
        out.inpFree = hit === inp || inp.contains(hit); out.hit = hit ? hit.className : null;
        sb.scrollTop = 0;
        return out;
      });
      ok(`${P} P-08: the Ikväll button is in the page flow (not sticky)`, a.pos === "static", a);
      ok(`${P} P-08: the Ikväll button does not cover the chat card (first view)`, a.over0 === 0 && a.barBelowChat, a);
      ok(`${P} P-08: the chat field at the bottom edge is free (no dock over it)`, a.inpFree, a);
      ok(`${P} P-08: Ikväll = a row (chevron right), before Om gruppen`, a.chev && a.barBeforeAbout, a);
      ok(`${P} P-09: the Spel card is on the group page (no game running), under the chat`, a.sp && /^Spel/.test(a.spText) && a.spAfterChat, a);
      ok(`${P} P-09: the Ikväll button names what is inside (no Spel there now)`, /Kamera/.test(a.sub) && !/Spel/.test(a.sub), a.sub);
      await shot(page, w + "-group");
      if (w === 390) {
        await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 99999; }); await wait(page, 300);
        await shot(page, w + "-group-bottom");
        await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; });
        // Spel card → the Spel hub
        await page.evaluate(() => { const b = document.querySelector(".gpg > .sp-gi .sp-gbtn"); if (b) b.click(); });
        const hub = await page.waitForSelector(".sp-hub", { timeout: 10000 }).then(() => true).catch(() => false);
        ok(`${P} P-09: a tap on the Spel card opens the Spel hub`, hub);
        await shot(page, w + "-spel");
        await page.evaluate(() => { const b = document.querySelector(".sp-hub .sp-back, .sp-hub [data-sp-back], .sp-top button"); if (b) b.click(); }); await wait(page, 800);
        if (!(await page.$(".gpg"))) await openGroup(page);
      }
      // Ikväll (+)
      await clickJS(page, ".gpg-plus"); await wait(page, 900);
      const p = await page.evaluate(() => {
        const w = document.querySelector(".gpg"), vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).display !== "none");
        const rows = [...w.children].filter((c) => vis(c) && c.classList.contains("sa-gl"));
        const icons = rows.map((c) => { const s = c.querySelector("svg.pi-lead"); return s ? [...s.classList].find((k) => /^pi-/.test(k) && k !== "pi-lead") : null; });
        const names = rows.map((c) => (c.querySelector("b, [class$='-gl']") || c).textContent.replace(/\s+/g, " ").trim().slice(0, 20));
        const subs = rows.map((c) => c.querySelector("[class$='-gs']")).filter((s) => s && vis(s) && s.textContent.trim()).map((s) => {
          const t = s.textContent.trim(), ft = getComputedStyle(s, "::first-letter").textTransform;
          return { t: t.slice(0, 24), cap: t.charAt(0) === t.charAt(0).toUpperCase() || ft === "uppercase" };
        });
        const heads = [...w.children].filter((c) => vis(c) && c.classList.contains("gp-h")).map((c) => c.textContent.trim());
        return { icons, names, subs, heads, spelRow: vis(w.querySelector(':scope > [data-ga="spel"]')) };
      });
      const dup = p.icons.filter((x, i) => x && p.icons.indexOf(x) !== i);
      ok(`${P} P-16: every Ikväll row has its own icon`, p.icons.length >= 6 && p.icons.every(Boolean) && dup.length === 0, { dup, icons: p.icons, names: p.names });
      ok(`${P} P-16: every row hint starts with a capital (sentence case)`, p.subs.length >= 3 && p.subs.every((s) => s.cap), p.subs);
      ok(`${P} P-09: no Spel row in Ikväll (one way in) and no empty "Spel & kul" head`, !p.spelRow && !p.heads.some((x) => /Spel/.test(x)), p);
      await shot(page, w + "-ikvall");
      ok(`${P} no page errors`, errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- P-22 (chat composer) ----------
    {
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 });
      await page.evaluate(() => window.SOCIAL.openChat({ id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" }));
      await page.waitForSelector("#chat-inp", { timeout: 10000 }).catch(() => {});
      await wait(page, 1200);
      const st = () => page.evaluate(() => {
        const vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).display !== "none");
        const inp = document.getElementById("chat-inp"), s = document.querySelector(".chat-input .chat-send");
        return { w: Math.round(inp.getBoundingClientRect().width), mic: vis(document.querySelector(".chat-input .af-mic")), cam: vis(document.querySelector(".chat-input .ph-btn")),
          bg: getComputedStyle(s).backgroundImage + "|" + getComputedStyle(s).backgroundColor };
      });
      const e0 = await st();
      await shot(page, "chat-empty");
      await page.fill("#chat-inp", "Vi ses vid Pitchers om tio");
      const t1 = await st();
      await shot(page, "chat-typing");
      await page.fill("#chat-inp", "");
      const e2 = await st();
      ok("P-22: empty field: mic + camera are there", e0.mic && e0.cam, e0);
      ok("P-22: while typing: mic + camera step aside, the field gets the room (≥ 240 px)", !t1.mic && !t1.cam && t1.w >= 240, t1);
      ok("P-22: field empty again: mic + camera come back", e2.mic && e2.cam && e2.w < t1.w, e2);   // the beer-tip button (beerlib) keeps its own state: width may differ a little
      ok("P-22: send is not amber while there is nothing to send, amber while typing", e0.bg !== t1.bg && !/245, 1|f5a|255, 194/i.test(e0.bg), { e0: e0.bg, t1: t1.bg });
      ok("P-22: no page errors", errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- P-29 (invite words) ----------
    for (const lang of ["sv", "en"]) {
      if (lang === "en") { const src = require("fs").readFileSync(require("path").join(__dirname, "../../docs/js/invite.js"), "utf8");
        ok("P-29 (en): \"Invite a friend\" + \"To:\" are in the source (English is off in the app until lane i18n E8)", /L\("Bjud in en kompis", "Invite a friend"\)/.test(src) && /L\("Till:", "To:"\)/.test(src)); continue; }
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, {
        routes: (pg) => pg.route(/rest\/v1\/rpc\/create_group\b/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} return J(r, { id: "44444444-2222-3333-4444-555555555555", name: b.p_name || "Ny", code: "FLX234" }); }) });
      await clickJS(page, "#btn-groups"); await wait(page, 1200);
      await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 800);
      const c = await page.evaluate(() => {
        const q = document.querySelector(".inv-q"), l = q && q.querySelector(".inv-q-lbl"), row = q && q.querySelector(".inv-q-row");
        return { to: q ? q.querySelector(".inv-q-to").textContent : null, lbl: l && !l.hidden && l.getClientRects().length ? l.textContent : null,
          above: !!(l && row && l.getBoundingClientRect().bottom <= row.getBoundingClientRect().top + 1), pills: row ? row.querySelectorAll(".inv-q-p").length : 0 };
      });
      if (lang === "sv") {
        ok("P-29: Grupper card title = a whole phrase \"Bjud in en kompis\"", c.to === "Bjud in en kompis", c);
        ok("P-29: \"Till:\" sits over the group pills", c.lbl === "Till:" && c.above && c.pills === 2, c);
        await shot(page, "grupper");
        // guard: after Skapa grupp, the invite sheet names the new group (server answer: id, name, code)
        await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /^Skapa grupp$/.test(x.textContent.trim())); if (b) b.click(); });
        await page.waitForSelector("#gname-inp", { timeout: 8000 }).catch(() => {});
        await page.fill("#gname-inp", "Fredagsgänget");
        await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].reverse().find((x) => /^Skapa grupp$/.test(x.textContent.trim())); if (b) b.click(); });
        await page.waitForSelector(".jn-to", { timeout: 8000 }).catch(() => {});
        await wait(page, 600);
        const to = await page.evaluate(() => (document.querySelector(".jn-to") || {}).textContent || "");
        ok("P-29 guard: after Skapa grupp the invite says \"Bjud in till Fredagsgänget\"", to === "Bjud in till Fredagsgänget", to);
        await shot(page, "created");
      }
      ok(`P-29 (${lang}): no page errors`, errs.length === 0, errs);
      await ctx.close();
    }

    // ---------- P-21 (events) ----------
    const evRoutes = (near2, near3, calls) => (pg) => pg.route(/rest\/v1\/rpc\/(events_near2|events_near3)\b/, (r) => {
      const three = /events_near3/.test(r.request().url()); calls.push(three ? 3 : 2);
      return J(r, { v: 1, server_time: new Date().toISOString(), events: three ? near3 : near2 });
    });
    const evState = (page) => page.evaluate(() => {
      const sel = document.querySelector('.evs-time [aria-selected="true"]'), e = document.querySelector(".evs-empty");
      return { tab: sel ? sel.getAttribute("data-t") : null, empty: e ? e.textContent.replace(/\s+/g, " ").trim() : null,
        rows: [...document.querySelectorAll(".evs-list .evs-dg")].map((x) => x.textContent.replace(/\s+/g, " ").trim().slice(0, 60)),
        sum: (document.querySelector(".evs-sum") || {}).textContent || "", next: !!document.querySelector(".evs-next-go") };
    });
    // (a) nothing in 7 days, one event in 12 days → the month at once
    {
      const calls = [], far = [{ id: 701, kind: "quiz", title: "Julquiz", place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, town: "Ludvika", starts_at: day(12, 20) }];
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { routes: evRoutes([], far, calls) });
      await page.evaluate(() => window.EVSHEET.open()); await wait(page, 2500);
      const s = await evState(page);
      ok("P-21a: nothing this week → the Månad tab opens by itself and shows the event", s.tab === "month" && s.rows.some((x) => /Julquiz/.test(x)) && calls.includes(3), { s, calls });
      ok("P-21a: a short note says why (sv)", /månaden/.test(s.sum), s.sum);
      await shot(page, "ev-month");
      ok("P-21a: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    // (b) the user picks an empty tab → "Nästa: … · Pubquiz" + "Visa nästa event"
    {
      const calls = [], soon = [{ id: 702, kind: "quiz", title: "Pubquiz", place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, town: "Ludvika", starts_at: day(3, 20) }];
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { routes: evRoutes(soon, soon, calls) });
      await page.evaluate(() => window.EVSHEET.open()); await wait(page, 2200);
      await page.evaluate(() => { const b = document.querySelector('.evs-time [data-t="tonight"]'); if (b) b.click(); }); await wait(page, 800);
      const s = await evState(page);
      ok("P-21b: an empty tab names the next event", s.tab === "tonight" && /Nästa: .*Pubquiz/.test(s.empty || "") && s.next, s);
      await shot(page, "ev-next");
      await page.evaluate(() => { const b = document.querySelector(".evs-next-go"); if (b) b.click(); }); await wait(page, 800);
      const s2 = await evState(page);
      ok("P-21b: \"Visa nästa event\" opens the tab with the event", s2.tab && s2.tab !== "tonight" && s2.rows.some((x) => /Pubquiz/.test(x)), s2);
      ok("P-21b: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    // (c) nothing in the whole month → the text says so at once (no tapping Helgen, 7 dagar, Månad)
    {
      const calls = [];
      const { ctx, page, errs } = await open(browser, { width: 390, height: 844 }, { routes: evRoutes([], [], calls) });
      await page.evaluate(() => window.EVSHEET.open()); await wait(page, 2500);
      const s = await evState(page);
      ok("P-21c: nothing in 31 days → \"Inga event den närmaste månaden\" on the first view", /Inga event den närmaste månaden/.test(s.empty || "") && calls.includes(3), { s, calls });
      await shot(page, "ev-none");
      ok("P-21c: no page errors", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL crash", e && e.stack); }
  await browser.close();
  console.log(`\nfixD: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
