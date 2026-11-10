// social-a (Wave 3 G1–G5 + Gängkamp + R1-04/09/22/23/24 + DM header). Usage: node social-a-pw.js <port>
// Each check FAILS on the 10dbb7a design and PASSES after the social-a patches. 3 widths: 360 / 390 / 430.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const PORT = process.argv[2] || 8871;
const DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString(), at = (h) => new Date(now + h * 3600e3).toISOString();
const NOT_MEMBER = { code: "P0001", message: "not_member", details: null, hint: null };
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const EMOJI = /\p{Extended_Pictographic}/u;
const PAST = { v: 1, events: [
  { group_id: "e3333333-2222-3333-4444-555555555555", title: "🧠 Pubquiz på Pitchers på Pitchers", kind: "quiz", place: "Pitchers", starts_at: iso(60 * 24 * 19), people: 3, drinks: 18, photos: 0 },
  { group_id: "e2222222-2222-3333-4444-555555555555", title: "QUIZZZZEN", kind: "quiz", place: "Pitchers", starts_at: iso(60 * 24 * 5), people: 4, drinks: 20, photos: 1 },
  { group_id: "e1111111-2222-3333-4444-555555555555", title: "Grekiska Grill & Bar", kind: null, place: "Grekiska Grill & Bar", starts_at: iso(60 * 24 * 4), people: 3, drinks: 12, photos: 0 }] };
const EVENTS = [{ id: 901, kind: "quiz", title: "Pubquiz på Pitchers", place: "Pitchers", bar_id: "n3472634175", starts_at: at(1.5), ends_at: null, lat: 60.14997, lng: 15.18679,
  km: 0.2, going: 1, source: "user", is_mine: false, pending: false, town: "Ludvika", url: null, tv: false, sport: null, league: null, home: null, away: null, ticket_url: null }];

async function server(page, rec) {
  await page.route(/rest\/v1\/rpc\/(my_friends|my_friend_code|friend_request|my_inbox|my_past_events|my_dms|group_keep_history|set_group_keep_history|group_now|group_msgs|events_near2|events_near3|events_near)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const isDm = b.p_group_id === DM;
    switch (fn) {
      case "my_friends": return J(r, { code: "K7Q2MXA", friends: [{ id: "f1", k: "cccccccccccc", name: "Lisa", out: true, town: "Ludvika" }, { id: "f4", k: "f4", name: "Ida", out: false }],
        incoming: [{ id: 5, name: "Kalle" }], outgoing: [] });
      case "my_friend_code": return J(r, { code: "K7Q2MXA" });
      case "friend_request": rec.fr.push(b.p_code); return J(r, { status: "pending", id: 77, name: "Maja" });
      case "my_inbox": return J(r, { v: 1, now: new Date().toISOString(), items: [
        { k: "friend:5", type: "friend", id: 5, name: "Kalle", home_town: null, at: iso(3) },
        { k: "rally:77", type: "rally", id: 77, group_id: RPCF.GID || "11111111-2222-3333-4444-555555555555", group_name: "Ludvika Lager", name: "Oskar", body: "Alla till La Parma!", place: "La Parma", yes: 2, at: iso(6) },
        { k: "inv:9", type: "inv", id: 9, title: "🧠 Pubquiz på Pitchers på Pitchers", starts_at: at(3), place: "Pitchers", from: "Lisa", group_name: null, at: iso(30) }] });
      case "my_past_events": return J(r, PAST);
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [Object.assign(RPCF.dmThread(DM), { last_id: 501, last_body: "Tjena!", last_at: iso(30), last_me: false, unread: 0, at: iso(30), out: true })] });
      case "group_keep_history": case "set_group_keep_history": case "group_now":
        if (isDm) return J(r, NOT_MEMBER, 400);
        if (fn === "group_keep_history") return J(r, false);
        if (fn === "set_group_keep_history") return J(r, !!b.p_on);
        return r.fallback();
      case "group_msgs": return isDm ? J(r, b.p_after_id ? [] : [{ id: 501, name: "Ida", body: "Tjena!", created_at: iso(30), is_me: false }]) : r.fallback();
      case "events_near2": case "events_near3": return J(r, { v: 1, server_time: new Date().toISOString(), events: EVENTS });
      case "events_near": return J(r, EVENTS);
    }
    return r.fallback();
  });
}
const tab = (page, t) => page.evaluate((t) => { const x = document.querySelector('.inv-tabs button[data-t="' + t + '"]'); if (x) x.click(); return !!x; }, t);
const back = (page) => page.evaluate(() => { const b = document.getElementById("pn-back"); if (b && !b.hidden) b.click(); });
const close = (page) => page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); });

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  for (const w of [360, 390, 430]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
    const rec = { fr: [] };
    await server(page, rec);
    await ctx.addInitScript(() => { try { localStorage.setItem("olnu.pnFold", "1"); } catch (e) {} });
    await boot(page);
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));

    // ---------- G1 Vänner: "Lägg till vän" + "Min kod & QR" first ----------
    await page.click("#btn-groups"); await wait(page, 1200); await tab(page, "f"); await wait(page, 1800);
    const top = await page.evaluate(() => {
      const p = document.getElementById("inv-pane-f"); if (!p) return null;
      const vis = [...p.children].filter((c) => c.getClientRects().length && getComputedStyle(c).display !== "none");
      const f = vis[0]; const btns = f ? [...f.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
      const tb = document.querySelector(".inv-tabs").getBoundingClientRect();
      return { first: f && f.className, btns, y: f ? Math.round(f.getBoundingClientRect().top - tb.bottom) : 999, fold: !!p.querySelector("details.pn-codefold") };
    });
    ok(`[${w}] G1 Vänner: the first block under the tabs = Lägg till vän + Min kod & QR`, !!top && top.btns.length === 2 && /Lägg till vän/.test(top.btns[0]) && /Min kod/.test(top.btns[1]) && top.y < 40, top);
    ok(`[${w}] G1 Vänner: no "Har du en väns kod?" fold at the bottom`, !!top && !top.fold, top);
    // Lägg till vän: paste a link → friend_request with its code; ‹ comes back to Vänner
    await page.evaluate(() => { const b = document.querySelector(".sa-vadd") || [...document.querySelectorAll("#inv-pane-f button")].find((x) => /Lägg till vän/.test(x.textContent)); if (b) b.click(); });
    await wait(page, 900);
    const addT = await page.evaluate(() => (document.getElementById("sheet-title") || {}).textContent);
    ok(`[${w}] G1 Lägg till vän opens its own screen`, /Lägg till vän/.test(addT || ""), addT);
    const filled = await page.evaluate(() => { const i = document.querySelector("#sheet-body .sa-add-inp"); if (!i) return false; i.value = "https://tunela.github.io/Beer-map/?friend=MAJ4X7Q"; return true; });
    if (filled) { await page.evaluate(() => document.querySelector("#sheet-body .sa-add-go").click()); await wait(page, 1500); }
    ok(`[${w}] G1 a pasted friend link sends friend_request with its code`, rec.fr[0] === "MAJ4X7Q", rec.fr);
    const backT = await page.evaluate(() => ({ t: (document.getElementById("sheet-title") || {}).textContent, f: !!document.querySelector('.inv-tabs button[data-t="f"][aria-selected="true"]') }));
    ok(`[${w}] G1 after the add, back on Grupper → Vänner`, /Grupper/.test(backT.t || "") && backT.f, backT);
    // Min kod & QR: QR + code at once
    await page.evaluate(() => { const b = document.querySelector(".sa-vmine"); if (b) b.click(); });
    await wait(page, 1500);
    const mine = await page.evaluate(() => ({ t: (document.getElementById("sheet-title") || {}).textContent, qr: !!document.querySelector("#sheet-body .sa-mine-qr canvas, #sheet-body .sa-mine-qr img"),
      code: ((document.querySelector("#sheet-body .sa-mine-code") || {}).textContent || ""), share: !!document.querySelector("#sheet-body .sa-mine-share.btn-amber") }));
    ok(`[${w}] G1 Min kod & QR shows the QR, the code and one primary Dela`, /Min kod/.test(mine.t || "") && mine.qr && /K7Q2MXA/.test(mine.code) && mine.share, mine);
    await back(page); await wait(page, 900);
    // R1-09: the friend request in Vänner = the Inkorg row (no stripe, tonal Ja, PNI)
    const req = await page.evaluate(() => { const r = document.querySelector("#inv-pane-f .nr-req"); if (!r) return null; const cs = getComputedStyle(r);
      return { sh: cs.boxShadow, bl: cs.borderLeftWidth, emo: /\p{Extended_Pictographic}/u.test(r.textContent), svg: !!r.querySelector(".sa-ib-ti svg"), yesBg: getComputedStyle(r.querySelector("button")).backgroundColor }; });
    ok(`[${w}] R1-09 Vänner request row: no stripe, PNI tile, no emoji`, !!req && req.sh === "none" && req.bl === "1px" && req.svg && !req.emo, req);

    // ---------- R1-09 Inkorg ----------
    await tab(page, "i"); await wait(page, 1500);
    const ib = await page.evaluate(() => [...document.querySelectorAll("#sheet-body .ib-item")].map((li) => {
      const cs = getComputedStyle(li), b = li.querySelector(".ib-acts .btn");
      return { sh: cs.boxShadow, ico: !!li.querySelector(".ib-ico svg"), emo: /\p{Extended_Pictographic}/u.test((li.querySelector(".ib-ico") || {}).textContent + (li.querySelector(".ib-acts") || { textContent: "" }).textContent),
        bg: b ? getComputedStyle(b).backgroundColor : "", t: (li.querySelector(".ib-t") || {}).textContent };
    }));
    ok(`[${w}] R1-09 Inkorg: 3 rows, PNI icon tiles, no emoji, no 3 px stripe`, ib.length === 3 && ib.every((x) => x.ico && !x.emo && x.sh === "none"), ib);
    ok(`[${w}] R1-09 Inkorg: answer buttons are tonal (not filled green)`, ib.length > 0 && ib.every((x) => !/rgb\(61, 220, 132\)|rgb\(31, 157, 87\)/.test(x.bg)), ib.map((x) => x.bg));
    ok(`[${w}] G3 Inkorg invite title says the place once`, ib.some((x) => x.t === "Pubquiz på Pitchers"), ib.map((x) => x.t));

    // ---------- G4 group tiles ----------
    await tab(page, "g"); await wait(page, 1000);
    const gc = await page.evaluate(() => [...document.querySelectorAll(".glist .gcard")].map((c) => ({ before: getComputedStyle(c, "::before").content, svg: !!c.querySelector(".sa-gc-ti svg"),
      go: (c.querySelector(".gcard-go") || c).textContent.trim() === "" && !!(c.querySelector(".gcard-go svg")) })));
    ok(`[${w}] G4 group tiles: PNI icon tile, no 🍺 ::before`, gc.length >= 2 && gc.every((x) => x.svg && (x.before === "none" || x.before === "normal")), gc);
    ok(`[${w}] R1-24 group cards: the chevron is an icon (no "›" glyph)`, gc.length >= 2 && gc.every((x) => x.go), gc);
    // G3 Tidigare event in Grupper: one list, PNI icons, place once
    const gp = await page.evaluate(() => { const d = document.querySelector("#inv-pane-g details.evg-fold"); if (!d) return null; d.open = true;
      const rows = [...d.querySelectorAll(".evg-prow")]; return { inPane: !!d.closest("#inv-pane-g"), n: rows.length, emo: rows.some((r) => /\p{Extended_Pictographic}/u.test(r.textContent)) || /\p{Extended_Pictographic}/u.test(d.querySelector("summary").textContent),
        titles: rows.map((r) => r.querySelector("b").textContent), radius: rows.map((r) => getComputedStyle(r).borderTopWidth) }; });
    ok(`[${w}] G3 Grupper Tidigare event: only under Grupper, no emoji, no "på X på X"`, !!gp && gp.inPane && gp.n === 3 && !gp.emo && !gp.titles.some((t) => /på (\S+) på \1/.test(t)), gp);

    // ---------- group page: G4 colour, Gängkamp, R1-23, R1-24 ----------
    await page.evaluate(() => { window.__gk = []; if (window.GAMES) { const f = window.GAMES.openGangkamp; window.GAMES.openGangkamp = function (g) { window.__gk.push(g); }; window.GAMES.__gk0 = f; } });
    await page.evaluate(() => { const c = [...document.querySelectorAll(".gcard")].find((x) => /Ludvika Lager/.test(x.textContent)); if (c) c.click(); });
    await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {}); await wait(page, 2200);
    const pg = await page.evaluate(() => { const g = document.querySelector(".gpg"); const m = g && g.querySelector(":scope > .gmain"); return { cls: g && g.className, bg: m ? getComputedStyle(m).backgroundImage : "" }; });
    ok(`[${w}] G4 group page has its colour (option A: a header band in the group colour)`, /sa-gpc-a/.test(pg.cls || "") && /sa-gpcol-\d/.test(pg.cls || "") && /gradient/.test(pg.bg), pg);
    const gk = await page.evaluate(() => { const b = document.querySelector(".gpg > .sa-gk"); if (!b) return null; const r = b.getBoundingClientRect(); b.click(); return { h: Math.round(r.height), vis: r.height > 0, svg: !!b.querySelector("svg"), t: b.textContent }; });
    await wait(page, 300);
    const gkArg = await page.evaluate(() => window.__gk && window.__gk[0]);
    ok(`[${w}] Gängkamp row on the group page (PNI icon, ≥ 44 px)`, !!gk && gk.vis && gk.svg && gk.h >= 44 && /Gängkamp/.test(gk.t), gk);
    ok(`[${w}] Gängkamp row calls GAMES.openGangkamp({id, name, code})`, !!gkArg && gkArg.id === "11111111-2222-3333-4444-555555555555" && gkArg.name === "Ludvika Lager" && gkArg.code === "ABC234", gkArg);
    await page.evaluate(() => { const p = document.querySelector(".gpg-plus"); if (p) p.click(); }); await wait(page, 1000);
    const plus = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.gpg[data-gv="plus"] > [data-gm~="plus"]:not(.gp-h):not(.gpg-ph)')].filter((c) => c.getClientRects().length && getComputedStyle(c).display !== "none");
      const rs = items.map((c) => { const r = c.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom), s: c.getAttribute("data-gp") }; }).sort((a, b) => a.y - b.y);
      let gaps = 0; for (let i = 1; i < rs.length; i++) if (rs[i].s === rs[i - 1].s && rs[i].y - rs[i - 1].b > 2) gaps++;
      const subs = [...document.querySelectorAll('.gpg[data-gv="plus"] .gpg-gs, .gpg[data-gv="plus"] [class$="-gs"]')].filter((x) => x.getClientRects().length).map((x) => parseFloat(getComputedStyle(x).fontSize));
      const chev = [...document.querySelectorAll('.gpg[data-gv="plus"] > [data-gm~="plus"] > .btn')].map((b) => getComputedStyle(b, "::after").content).filter((c) => c && c !== "none");
      return { n: items.length, gaps, minSub: subs.length ? Math.min.apply(null, subs) : 0, chev: chev.filter((c) => /›/.test(c)).length };
    });
    ok(`[${w}] R1-23 group Ikväll: rows of one section touch (one list, no gaps)`, plus.n >= 4 && plus.gaps === 0, plus);
    ok(`[${w}] R1-23 group Ikväll: sub lines ≥ 14 px`, plus.minSub >= 14, plus);
    ok(`[${w}] R1-24 group Ikväll: no "›" character chevrons`, plus.chev === 0, plus);
    await page.evaluate(() => { const b = document.querySelector(".gpg-ph .gpg-back"); if (b) b.click(); }); await wait(page, 600);
    await page.evaluate(() => { const e = document.querySelector(".gpg-dots"); if (e) e.click(); }); await wait(page, 900);
    const about = await page.evaluate(() => { const n = document.querySelector('.gpg[data-gv="info"] .gmain .gname'), m = document.querySelector(".gpg-info .gpg-row small");
      return { after: n ? getComputedStyle(n, "::after").content : "", mem: m ? m.textContent : "", svg: !!(m && m.querySelector("svg")) }; });
    ok(`[${w}] R1-24 Om gruppen: icon chevrons, no "›" text`, !/›/.test(about.after) && !/›/.test(about.mem) && about.svg, about);
    await close(page); await wait(page, 600);

    // ---------- R1-22 chat "Spara chatten" = switch ----------
    await page.evaluate(() => window.SOCIAL.openChat({ id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" })); await wait(page, 2000);
    const keep = await page.evaluate(() => { const b = document.querySelector(".chat-keep"); if (!b) return null; const cb = b.querySelector(".chat-keep-cb");
      return { role: cb && cb.getAttribute("role"), tag: cb && cb.tagName, txt: b.textContent, chk: !!b.querySelector('input[type="checkbox"]') }; });
    ok(`[${w}] R1-22 chat keep-history is a switch row, no checkbox, no 💾`, !!keep && keep.role === "switch" && !keep.chk && !/💾/.test(keep.txt), keep);
    if (keep && keep.role === "switch") {
      await page.evaluate(() => { const s = document.querySelector(".chat-keep .chat-keep-cb"); s.click(); }); await wait(page, 800);
      ok(`[${w}] R1-22 the switch saves (aria-checked true)`, await page.evaluate(() => document.querySelector(".chat-keep .chat-keep-cb").getAttribute("aria-checked") === "true"));
    }
    await close(page); await wait(page, 600);

    // ---------- DM header not cut ----------
    await page.click("#btn-groups"); await wait(page, 1000); await tab(page, "f"); await wait(page, 1500);
    const row = await page.$(".dm-box .dm-row");
    if (row) { await row.click(); await wait(page, 2000); }
    const dmh = await page.evaluate(() => { const s = document.querySelector(".dm-chead .dm-cwho small"); if (!s) return null;
      const t = s.querySelector("span") || s; return { txt: s.textContent.trim(), cut: t.scrollWidth > t.clientWidth + 1 || s.scrollWidth > s.clientWidth + 1, btns: [...document.querySelectorAll(".dm-cacts button")].map((b) => ({ w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), t: b.textContent.trim(), a: b.getAttribute("aria-label") })) }; });
    ok(`[${w}] DM header: "Bara ni två" whole, no emoji`, !!dmh && dmh.txt === "Bara ni två" && !dmh.cut, dmh);
    ok(`[${w}] DM header: mute + block = 44 px icon buttons with labels`, !!dmh && dmh.btns.length === 2 && dmh.btns.every((b) => b.w >= 44 && b.h >= 44 && !b.t && b.a), dmh && dmh.btns);
    await close(page); await wait(page, 600);

    // ---------- G2 + G5 Profil ----------
    await page.click("#btn-settings"); await wait(page, 2500);
    const pf = await page.evaluate(() => {
      const sb = document.getElementById("sheet-body");
      const vis = (e) => e && e.getClientRects().length && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden";
      const secs = [...sb.querySelectorAll(":scope > section.ds-section")].filter(vis);
      const empty = secs.filter((s) => { const l = s.querySelector(":scope > .ds-list"); return !l || ![...l.children].some(vis); }).map((s) => s.textContent.trim().slice(0, 20));
      // a card inside a card: a visible element with a border + radius inside a .ds-list (rows only have dividers)
      const nested = [];
      sb.querySelectorAll(":scope > section.ds-section .ds-list *").forEach((e) => {
        if (!vis(e) || e.closest(".sa-plist")) return; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        if (r.width < 120 || r.height < 30 || e.matches("input, textarea, .inp, .switch, .btn-amber, select")) return;
        const bw = parseFloat(cs.borderTopWidth) && parseFloat(cs.borderBottomWidth) && parseFloat(cs.borderLeftWidth);
        if (bw && parseFloat(cs.borderTopLeftRadius) >= 8) nested.push((e.className || e.tagName).toString().slice(0, 40) + ":" + e.textContent.trim().slice(0, 20));
      });
      const kompisar = secs.some((s) => /^Kompisar/.test(s.textContent.trim()));
      const pastRow = [...sb.querySelectorAll(":scope > .pn-pf .ds-list > .ds-row")].find((r) => /Tidigare event/.test(r.textContent));
      const evInFold = !!sb.querySelector(":scope > section.ds-section .evg-past, :scope > section.ds-section .evg-prow");
      const tabs = sb.querySelector(":scope > .pf-tabs"), fade = tabs ? getComputedStyle(tabs, "::after") : null;
      const pen = sb.querySelector(".pf-av.av-pf .av-pen"), av = sb.querySelector(".pf-av.av-pf");
      let p = null;
      if (pen && av) { const a = av.getBoundingClientRect(), b = pen.getBoundingClientRect(), cs = getComputedStyle(pen);
        const cx = b.left + b.width / 2 - (a.left + a.width / 2), cy = b.top + b.height / 2 - (a.top + a.height / 2);
        p = { w: Math.round(b.width), h: Math.round(b.height), dist: Math.round(Math.hypot(cx, cy)), r: Math.round(a.width / 2), ang: Math.round(Math.atan2(cy, cx) * 180 / Math.PI), fs: cs.color, glyph: getComputedStyle(pen, "::before").maskImage || getComputedStyle(pen, "::before").webkitMaskImage }; }
      return { empty, nested, kompisar, past: pastRow ? pastRow.textContent : null, evInFold, fade: fade ? { c: fade.content, h: fade.height, bg: fade.backgroundImage } : null, pen: p };
    });
    ok(`[${w}] G2 Profil: no empty section (Kompisar)`, pf.empty.length === 0 && !pf.kompisar, pf.empty);
    ok(`[${w}] G2 Profil: no card inside a card`, pf.nested.length === 0, pf.nested);
    ok(`[${w}] G2 Profil: Tidigare event = one row in Mitt (not a card in Kompisar)`, !!pf.past && /3 event/.test(pf.past) && !pf.evInFold, pf);
    ok(`[${w}] G2 Profil: the sticky tabs end in a fade (labels never cut under them)`, !!pf.fade && pf.fade.c !== "none" && /gradient/.test(pf.fade.bg) && parseFloat(pf.fade.h) >= 12, pf.fade);
    ok(`[${w}] G5 pen badge: 32–36 px circle, glyph is the PNI edit mask (no text)`, !!pf.pen && pf.pen.w >= 32 && pf.pen.w <= 36 && pf.pen.w === pf.pen.h && /rgba\(0, 0, 0, 0\)|transparent/.test(pf.pen.fs) && /svg/.test(pf.pen.glyph || ""), pf.pen);
    ok(`[${w}] G5 pen badge: centred on the avatar edge, lower right (45° ± 12°)`, !!pf.pen && Math.abs(pf.pen.dist - pf.pen.r) <= 6 && Math.abs(pf.pen.ang - 45) <= 12, pf.pen);
    // the Tidigare event list sheet: one list, no emoji, place once
    await page.evaluate(() => { const r = [...document.querySelectorAll("#sheet-body .pn-pf .ds-row")].find((x) => /Tidigare event/.test(x.textContent)); if (r) r.click(); }); await wait(page, 1200);
    const all = await page.evaluate(() => { const rows = [...document.querySelectorAll("#sheet-body .evg-prow")]; const l = document.querySelector("#sheet-body .evg-plist");
      return { t: (document.getElementById("sheet-title") || {}).textContent, n: rows.length, titles: rows.map((r) => r.querySelector("b").textContent), emo: rows.some((r) => /\p{Extended_Pictographic}/u.test(r.textContent)),
        rowBorder: rows.map((r) => getComputedStyle(r).borderLeftWidth), listR: l ? getComputedStyle(l).borderTopLeftRadius : "" }; });
    ok(`[${w}] G2/G3 Tidigare event sheet: one list (rows without own border), no emoji, place once`, all.n === 3 && all.rowBorder.every((b) => b === "0px") && all.listR === "16px" && !all.emo && all.titles[0] === "Pubquiz på Pitchers" && !/🗂/.test(all.t || ""), all);
    await close(page); await wait(page, 600);

    // ---------- G3 autoTitle + R1-04 bar event line ----------
    const at3 = await page.evaluate(() => window.INVITE && window.INVITE._autoTitle ? window.INVITE._autoTitle({ event: { kind: "quiz", title: "Pubquiz på Pitchers", place: "Pitchers" } }) : null);
    ok(`[${w}] G3 a new invite from "Pubquiz på Pitchers" says the place once`, !!at3 && (at3.match(/ på /g) || []).length === 1, at3);
    const evl = await page.evaluate(async () => {
      for (let i = 0; i < 20 && !(window.EVENTS && window.EVENTS.barPopupHTML && window.EVENTS.barPopupHTML({ id: "n3472634175", name: "Pitchers" })); i++) await new Promise((r) => setTimeout(r, 300));
      const html = window.EVENTS && window.EVENTS.barPopupHTML ? window.EVENTS.barPopupHTML({ id: "n3472634175", name: "Pitchers" }) : "";
      const box = document.createElement("div"); box.className = "bs"; box.style.cssText = "position:fixed;left:0;top:0;width:" + innerWidth + "px"; box.innerHTML = html; document.body.appendChild(box);
      const l = box.querySelector(".ev-line"); const cs = l ? getComputedStyle(l) : null;
      const t = l ? l.querySelector(".ev-l-t") : null;
      const out = l ? { r: cs.borderTopLeftRadius, bc: cs.borderTopColor, emo: /\p{Extended_Pictographic}/u.test(l.textContent), svg: l.querySelectorAll("svg").length, cut: t ? t.scrollWidth > t.clientWidth + 1 : true } : null;
      box.remove(); return out;
    });
    ok(`[${w}] R1-04 bar event line: rounded 12 px, no amber edge, PNI icons, no emoji, title not cut`, !!evl && evl.r === "12px" && !/255, 224, 138/.test(evl.bc) && !evl.emo && evl.svg >= 2 && !evl.cut, evl);

    // ---------- Gängkamp in Topplistor ----------
    await page.click("#btn-top"); await wait(page, 2000);
    const tg = await page.evaluate(() => { const r = document.querySelector("#sheet-body .sa-gk-top"); return r ? { vis: r.getClientRects().length > 0, svg: !!r.querySelector("svg") } : null; });
    ok(`[${w}] Gängkamp row in Topplistor`, !!tg && tg.vis && tg.svg, tg);
    if (tg) { await page.evaluate(() => { window.__gk = []; document.querySelector("#sheet-body .sa-gk-top").click(); }); await wait(page, 1200);
      const pick = await page.evaluate(() => ({ t: (document.getElementById("sheet-title") || {}).textContent, n: document.querySelectorAll("#sheet-body .sa-gk-pick .ds-row").length }));
      ok(`[${w}] Topplistor Gängkamp: 2 groups → a group picker`, /Vilket gäng/.test(pick.t || "") && pick.n === 2, pick);
      await page.evaluate(() => { const r = document.querySelector("#sheet-body .sa-gk-pick .ds-row"); if (r) r.click(); }); await wait(page, 400);
      ok(`[${w}] Topplistor Gängkamp: the pick opens GAMES.openGangkamp`, await page.evaluate(() => !!(window.__gk[0] && window.__gk[0].id && window.__gk[0].code)));
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nsocial-a: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
