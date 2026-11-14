// friends2 lane (13 Nov): I-90 Vänner + "Du kanske känner" rows use the full row width at 360-430 px (short rows, real avatars),
// I-89 profile card friend button label centred in every state, I-91 DM header tap = the full profile card with "Lägg till vän".
// Mocked server (ds-helpers + fixtures/rpc.js). Usage: node friends2-pw.js <port>   (F2_TAG=base: screenshot names for the old code)
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const TAG = process.env.F2_TAG || "new";
const DM = RPCF.DM_GID, GID = RPCF.GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const shot = (page, n) => page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove())).catch(() => {})
  .then(() => page.screenshot({ path: SP + "friends2-" + TAG + "-" + n + ".png" })).catch(() => {});
const SPEC = { v: 1, sk: 1, fs: 2, ey: 2, br: 4, mt: 1, hr: 4, hc: 3, fh: 5, hw: 7, gl: 0, up: 4, uc: 0, bg: 8 };
const STATES = { "a1111111-0000-4000-8000-000000000001": "none", "a1111111-0000-4000-8000-000000000002": "out", "a1111111-0000-4000-8000-000000000003": "friend", "a1111111-0000-4000-8000-000000000004": "in" };

async function server(page, rec) {
  await page.route(/rest\/v1\/rpc\/(my_friends|friend_list|avatars_for|friend_suggest|my_dms|dm_seen|group_keep_history|set_group_keep_history|group_now|group_msgs|group_photos|group_voices|msg_reacts|group_friend_states|dm_friend_state|dm_friend_request|friend_request)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const isDm = b.p_group_id === DM;
    const thread = () => Object.assign(RPCF.dmThread(DM), { blocked_by_me: false, blocked_me: false, can_write: true, muted: false, full_block: false, friends: true,
      last_id: 501, last_body: "Hej", last_at: iso(30), last_me: false, unread: 0, at: iso(30), out: true, now: new Date().toISOString() });
    switch (fn) {
      case "my_friends": return J(r, { code: "K7Q2MXA", incoming: [], outgoing: [], friends: [
        { id: 11, key: "f11", name: "Enberg", out: true, town: "Göteborg", home_town: "Göteborg" },
        { id: 12, key: "f12", name: "oggelito", out: false, home_town: "Ludvika" }] });
      case "friend_list": return J(r, { v: 1, groups: [{ id: GID, name: "Ludvika Lager" }], people: [
        { key: "ik-enberg", friend_id: 11, name: "Enberg", out: true, town: "Göteborg", home_town: "Göteborg", friend: true, find_key: "f11", groups: [{ name: "Vänner" }, { name: "Kompisgänget Ludvika" }] },
        { key: "ik-ogge", friend_id: 12, name: "oggelito", out: false, home_town: "Ludvika", friend: true, find_key: "f12", groups: [{ name: "TPM" }, { name: "Vänner" }] }] });
      case "avatars_for":
        if (!b.p_group_id) return J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true }, { k: "ik-enberg", name: "Enberg", is_me: false, a: SPEC, seed: "0b77aa10" }] });
        if (isDm) return J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true }, { k: "eeeeeeeeeeee", name: "Ida", is_me: false, a: SPEC, seed: "0b77aa10" }] });
        return r.fallback();
      case "friend_suggest": return J(r, { v: 1, people: [{ k: "0123456789abcdef", name: "Philip", group: "Vänner", mutual: 1 }] });
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [thread()] });
      case "dm_seen": return J(r, thread());
      case "group_keep_history": case "set_group_keep_history": case "group_now": return isDm ? J(r, { code: "P0001", message: "not_member" }, 400) : r.fallback();
      case "group_msgs": return isDm ? J(r, b.p_after_id ? [] : [{ id: 501, name: "Ida", body: "Hej", created_at: iso(30), is_me: false }]) : r.fallback();
      case "group_photos": case "group_voices": case "msg_reacts": return isDm ? J(r, []) : r.fallback();
      case "group_friend_states":
        if (isDm) return J(r, { code: "P0001", message: "not_member" }, 400);   // the real server: a DM has no group_members
        if (STATES[b.p_group_id]) return J(r, { v: 1, states: [{ k: "kenberg00000", name: "Enberg", s: STATES[b.p_group_id] }] });
        return r.fallback();
      case "dm_friend_state": return isDm ? J(r, { v: 1, dm: true, states: [{ k: "eeeeeeeeeeee", name: "Ida", s: rec.dmSent ? "out" : "none" }] }) : J(r, { code: "P0001", message: "not_member" }, 400);
      case "dm_friend_request": rec.dmReq.push(b); rec.dmSent = true; return J(r, { id: 91, status: "pending", name: "Ida", already: false, auto: false });
      case "friend_request": rec.fr.push(b); return J(r, { id: 92, status: "pending", name: "Enberg", already: false, auto: false });
    }
    return r.fallback();
  });
}
const tab = (page, t) => page.evaluate((t) => { const x = document.querySelector('.inv-tabs button[data-t="' + t + '"]'); if (x) x.click(); return !!x; }, t);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  for (const w of [360, 412]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: 900 });
    const rec = { fr: [], dmReq: [], dmSent: false };
    await server(page, rec);
    await boot(page);
    // ---------- I-90 Vänner list ----------
    await page.click("#btn-groups"); await wait(page, 1200);
    await tab(page, "f");
    await page.waitForSelector("#sheet-body .nr-flist > .nr-frow", { timeout: 15000 }).catch(() => null);
    await page.waitForSelector("#sheet-body .sg-row", { timeout: 8000 }).catch(() => null);
    await wait(page, 2500);
    const m = await page.evaluate(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left) }; };
      const rows = [...document.querySelectorAll("#sheet-body .nr-flist > .nr-frow")].map((li) => {
        const nm = li.querySelector(".nr-fmain > b"), info = li.querySelector(".nr-finfo") || li.querySelector(".nr-fmain small"), av = li.querySelector(":scope > .av");
        const ib = info ? info.getBoundingClientRect() : null, lh = info ? parseFloat(getComputedStyle(info).lineHeight) || 18 : 18;
        return { name: nm ? nm.textContent : "", row: r(li), nm: r(nm), info: r(info), infoLines: ib ? Math.round(ib.height / lh) : 0, infoText: info ? info.textContent : "",
          av: av ? { avk: av.getAttribute("data-avk"), svg: !!av.querySelector("svg"), ph: av.classList.contains("av-ph"), live: av.classList.contains("av-live") } : null,
          btns: [...li.querySelectorAll(":scope > .btn")].map((b) => { const x = b.getBoundingClientRect(); return { t: Math.round(x.top), h: Math.round(x.height), r: Math.round(x.right) }; }) };
      });
      const sg = [...document.querySelectorAll("#sheet-body .sg-row")].map((li) => ({ row: r(li), main: r(li.querySelector(".sg-main")) }));
      return { rows, sg, vw: innerWidth };
    });
    const en = m.rows.find((x) => x.name === "Enberg") || {};
    ok(w + " I-90 two friend rows", m.rows.length === 2, m);
    ok(w + " I-90 every friend row is shorter than 120 px (long info text)", m.rows.length && m.rows.every((x) => x.row.h < 120), m.rows.map((x) => x.row.h));
    ok(w + " I-90 name width > 50% of the row", m.rows.length && m.rows.every((x) => x.nm && x.nm.w > x.row.w * 0.5), m.rows.map((x) => [x.nm && x.nm.w, x.row.w]));
    ok(w + " I-90 info width > 50% of the row, max 2 lines", m.rows.length && m.rows.every((x) => x.info && x.info.w > x.row.w * 0.5 && x.infoLines <= 2), m.rows.map((x) => [x.info && x.info.w, x.row.w, x.infoLines]));
    ok(w + " I-90 info has town + status + groups in one text", /Göteborg/.test(en.infoText || "") && /Vänner/.test(en.infoText || ""), en.infoText);
    ok(w + " I-90 friend with an avatar spec gets the real avatar (svg, not the letter disc), green ring when out", en.av && en.av.svg && !en.av.ph && en.av.live, en.av);
    // nightfix: 44 px (the DESIGN.md tap target minimum, gated by ds-sheet-pw "tap targets ≥ 44"); compact = not taller than 44
    ok(w + " I-90 the 4 actions are in ONE row (same top) of 44 px buttons", en.btns && en.btns.length === 4 && new Set(en.btns.map((b) => b.t)).size === 1 && en.btns.every((b) => b.h >= 43.5 && b.h <= 44.5), en.btns);
    ok(w + " I-90 'Du kanske känner' row < 120 px and its text > 50% of the row", m.sg.length && m.sg.every((x) => x.row.h < 120 && x.main.w > x.row.w * 0.5), m.sg);
    await page.evaluate(() => { const l = document.querySelector("#sheet-body .nr-flist"); if (l) l.scrollIntoView({ block: "start" }); });
    await shot(page, "vanner-" + w);
    // the other layout (actions as 40 px icons on the right), forced for the comparison screenshot only
    await page.addStyleTag({ content: "#sheet-body .nr-flist>.nr-frow{flex-wrap:nowrap!important;align-items:center!important}#sheet-body .nr-flist>.nr-frow>.nr-fmain{flex:1 1 auto!important}#sheet-body .nr-flist>.nr-frow .nr-fmain+.btn,#sheet-body .nr-flist>.nr-frow>.btn.nr-more-b{margin-left:0!important}" });
    await wait(page, 200); await shot(page, "vanner-right-" + w);
    await page.evaluate(() => document.querySelectorAll("style").forEach((s) => { if (/nr-more-b\{margin-left:0!important/.test(s.textContent)) s.remove(); }));

    // ---------- I-89 profile card: every friend state ----------
    for (const [gid, s] of Object.entries(STATES)) {
      await page.evaluate((gid) => window.PROFCARD.open({ g: { id: gid, name: "Ludvika Lager" }, name: "Enberg", k: "kenberg00000", live: true, n: 2 }), gid);
      await page.waitForSelector(".pc-friend .f2-slot > *", { timeout: 6000 }).catch(() => null);
      await wait(page, 300);
      const c = await page.evaluate(() => {
        const el = document.querySelector(".pc-friend .f2-chip, .pc-friend .f2-add"), act = document.querySelector(".pc-acts .pc-act");
        if (!el) return null;
        const b = el.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(el);
        const t = rg.getBoundingClientRect(), a = act ? act.getBoundingClientRect() : null;
        return { text: el.textContent.trim(), dy: Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2), dx: Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2), h: b.height, w: b.width, actH: a ? a.height : null, actW: a ? a.width : null };
      });
      ok(w + " I-89 card state " + s + ": label centred (|dy| < 3, |dx| < 3)", c && c.dy < 3 && c.dx < 3, c);
      ok(w + " I-89 card state " + s + ": same height and width as the other card buttons", c && c.actH && Math.abs(c.h - c.actH) <= 1 && Math.abs(c.w - c.actW) <= 1, c);
      if (s === "out") await shot(page, "card-skickad-" + w);
      await page.evaluate(() => window.PROFCARD.close()); await wait(page, 150);
    }

    // ---------- I-91 DM header tap = the full profile card ----------
    await page.evaluate(() => { const b = document.querySelector(".dm-box .dm-row"); if (b) b.scrollIntoView(); });
    const row = await page.waitForSelector(".dm-box .dm-row", { timeout: 15000 }).catch(() => null);
    if (row) { await row.click(); await page.waitForSelector(".dm-chead", { timeout: 8000 }).catch(() => null); }
    ok(w + " I-91 DM opens", !!row);
    await wait(page, 1500);
    await shot(page, "dm-head-" + w);
    await page.click(".dm-cwho b").catch(() => {});
    await page.waitForSelector(".pc-card .f2-add", { timeout: 6000 }).catch(() => null);
    await wait(page, 400);
    const d = await page.evaluate(() => ({ card: !!document.querySelector(".pc-ov .pc-card"), name: (document.querySelector(".pc-name") || {}).textContent || "",
      add: ((document.querySelector(".pc-card .f2-add") || {}).textContent || "").trim(), big: !!document.querySelector(".pc-card .pc-av"),
      block: !!document.querySelector(".pc-card .pc-block"), skriv: !!document.querySelector(".pc-card .pc-dm") }));
    ok(w + " I-91 tap on the DM header name opens the profile card (big avatar, Blockera, no Skriv inside the DM)", d.card && d.name === "Ida" && d.big && d.block && !d.skriv, d);
    ok(w + " I-91 the card has 'Lägg till vän' for a non-friend", /Lägg till vän/.test(d.add), d);
    await shot(page, "dm-card-" + w);
    await page.click(".pc-card .f2-add").catch(() => {}); await wait(page, 800);
    const sent = await page.evaluate(() => ((document.querySelector(".pc-card .f2-chip") || {}).textContent || "").trim());
    ok(w + " I-91 'Lägg till vän' sends dm_friend_request for this DM and shows Skickad", rec.dmReq.length === 1 && rec.dmReq[0].p_group_id === DM && /Skickad/.test(sent), { req: rec.dmReq, sent });
    await page.click(".pc-card .pc-x").catch(() => {}); await wait(page, 300);
    const back = await page.evaluate(() => ({ card: !!document.querySelector(".pc-ov"), chat: !!document.querySelector("#sheet-body .dm-chead") }));
    ok(w + " I-91 ✕ closes the card and the chat is still there", !back.card && back.chat, back);
    // the avatar opens it too
    await page.click(".dm-cwho .av").catch(() => {}); await wait(page, 500);
    ok(w + " I-91 tap on the DM header avatar opens the card too", await page.evaluate(() => !!document.querySelector(".pc-ov .pc-card")));
    await page.evaluate(() => window.PROFCARD && window.PROFCARD.close());
    await ctx.close();
  }
  await browser.close();
  console.log(`friends2: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
