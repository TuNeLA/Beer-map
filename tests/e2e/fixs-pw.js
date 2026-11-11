// lane fixS (test teams 11 Nov): T-01 full block (DM + friend row), T-05 chat send after Regler, T-09 honest Synlighet copy,
// T-12 chat line menu (tap, labelled Anmäl/Blockera, stays open), T-13 Gängkamp challenge in Inkorg + on the tile,
// T-16 group page counts, T-17 Dialekt visible, T-18 three Synlighet choices, T-23 blocked DM wording + accepted friend.
// Usage: node fixs-pw.js <port> [part …]   parts: dm fr send menu duel count set acc (default: all). Mocked Supabase.
// Every check FAILS on e292592 and PASSES with the fixS patches. Shots: OUT/fixs-shots/<tag>-<name>-<w>.png (FIXS_TAG=new|old).
const fs = require("fs");
const { chromium } = require("playwright");
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const RPCF = require("./fixtures/rpc.js");
const OUT = require("./env.js").OUT, SHOTS = OUT + "fixs-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8871;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const TAG = process.env.FIXS_TAG || "new";
const W3 = [360, 390, 430];
const GID = "11111111-2222-3333-4444-555555555555", DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const NOT_MEMBER = { code: "P0001", message: "not_member", details: null, hint: null };
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 600))); c ? pass++ : fail++; };
const shot = (page, name, w) => page.screenshot({ path: `${SHOTS}${TAG}-${name}-${w}.png` }).catch(() => {});
const EMO = /\p{Extended_Pictographic}/u;

// one stateful server for every part; o = { terms: false, inboxDelay: ms, duel: true, members0: true, visFail: true }
async function server(page, o, st) {
  st.calls = []; st.blocked = false; st.closed = false; st.accepted = false; st.visN = 0;
  st.gmsgs = [{ id: 1, name: "Lisa", body: "Var é ni?", created_at: iso(50), is_me: false },
    { id: 2, name: "Oskar", body: "La Parma. Kom nu, det är fullt ös här och bartendern har gett upp", created_at: iso(44), is_me: false },
    { id: 3, name: "Anton", body: "Sitter på Pitchers, kommer efter den här", created_at: iso(40), is_me: true },
    { id: 4, name: "Oskar", body: "Kör hårt", created_at: iso(12), is_me: false }];
  st.dmsgs = [{ id: 501, name: "Ida", body: "Tjena! Ute ikväll?", created_at: iso(30), is_me: false }];
  const thread = () => Object.assign(RPCF.dmThread(DM), o.dmBlockedMe ? { can_write: false, blocked_me: true }
    : st.blocked || st.closed ? { can_write: false, blocked_by_me: true } : {});
  const friends = () => (st.lisaGone ? [] : [{ id: "f1", key: "f1", name: "Lisa", out: true, town: "Ludvika" }]).concat(st.accepted ? [{ id: "f5", key: "f5", name: "Kalle", out: false }] : []);
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const isDm = b.p_group_id === DM;
    st.calls.push([fn, b]);
    switch (fn) {
      case "safety_state": return J(r, { v: 1, age_ok: true, terms_ver: o.terms === false ? 0 : 1, terms_at: iso(9999), store: "off", blocks: 0, notices: [] });
      case "accept_terms": return J(r, { ok: true });
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: st.blocked ? [] : [Object.assign(thread(), { last_id: 501, last_body: "Tjena! Ute ikväll?", last_at: iso(30), last_me: false, unread: 0, at: iso(30) })] });
      case "dm_seen": return J(r, thread());
      case "dm_block": st.closed = !!b.p_on; if (!b.p_on) st.blocked = false; return J(r, thread());
      case "block_user": if (b.p_group === DM) st.blocked = !!b.p_on; if (b.p_k === "1111aaaa2222bbbb") st.lisaGone = !!b.p_on; return J(r, { ok: true, on: !!b.p_on, name: b.p_group === DM ? "Ida" : "Lisa", id: "0123456789abcdef" });
      case "group_keep_history": case "set_group_keep_history": case "group_now": if (isDm) return J(r, NOT_MEMBER, 400); return r.fallback();
      case "group_photos": case "group_voices": return isDm ? J(r, []) : r.fallback();
      case "group_msgs": {
        const l = isDm ? st.dmsgs : b.p_group_id === GID ? st.gmsgs : null; if (!l) return r.fallback();
        return J(r, l.filter((m) => m.id > (b.p_after_id | 0)));
      }
      case "post_group_msg": {
        const l = isDm ? st.dmsgs : st.gmsgs;
        const m = { id: l[l.length - 1].id + 1, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true };
        l.push(m); return J(r, { id: m.id, created_at: m.created_at });
      }
      case "duel_poll": return J(r, o.duel ? { v: 1, duels: [{ id: 41, status: "pending", incoming: true, outgoing: false, via: "code", created_at: iso(1), answer_by: new Date(now + 25 * 60e3).toISOString(),
        ends_at: new Date(now + 5 * 3600e3).toISOString(), group: { id: GID, name: "Ludvika Lager", wins: 0 }, opp: { name: "Borlänge Bärs", members: 5, wins: 1 }, us: {}, them: {}, both: false, needs_pick: false }] } : { v: 1, duels: [] });
      case "my_inbox": {
        const items = o.friendIn && !st.accepted ? [{ k: "friend:5", type: "friend", id: 5, name: "Kalle", home_town: null, at: iso(3) }]
          : o.inboxDuel ? [{ k: "duel:41", type: "duel", id: 41, group_id: GID, group_name: "Ludvika Lager", opp: "Borlänge Bärs", answer_by: new Date(now + 25 * 60e3).toISOString(), at: iso(1) }] : [];
        const send = () => J(r, { v: 1, now: new Date().toISOString(), items });
        if (o.inboxDelay) return new Promise((res) => setTimeout(() => res(send()), o.inboxDelay));
        return send();
      }
      case "friend_answer": st.accepted = !!b.p_accept; return J(r, { id: 5, status: "accepted", name: "Kalle" });
      case "my_friends": return J(r, { code: "K7Q2MXA", friends: friends(), incoming: [], outgoing: [] });
      case "friend_list": return J(r, { v: 1, people: friends().map((f, i) => ({ key: i ? "5555aaaa6666bbbb" : "1111aaaa2222bbbb", name: f.name, friend_id: f.id, friend: true, out: f.out, groups: [] })), groups: [] });
      case "my_visibility": st.visN++; if (o.visFail && st.visN === 1) return J(r, { code: "PGRST003", message: "Timed out acquiring connection from connection pool." }, 504); return J(r, { v: 1, friends_only: false });
      case "my_groups": if (!o.members0) return r.fallback();
        return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 0, active_count: 0 }]);
    }
    return r.fallback();
  });
}
async function app(browser, w, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const st = {}; await server(page, o, st);
  await boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, st, errs };
}
const openDm = (page) => page.evaluate((dm) => window.SOCIAL.openChat({ id: dm, name: "Ida", dm: { group_id: dm, name: "Ida", can_write: true } }), DM);
const openGroupChat = (page) => page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
const n = (st, fn) => st.calls.filter((c) => c[0] === fn);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });

  /* ---------- T-01 + T-23: DM block = the full block; honest texts on both sides; DM line menu ---------- */
  if (want("dm")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w);
    await openDm(page);
    await page.waitForSelector(".dm-chead .dm-block", { timeout: 10000 }).catch(() => {});
    await wait(page, 1500);
    // T-12 in a DM: one tap on Ida's line → labelled Anmäl + Blockera
    await page.click('.chat-list .chat-msg:not(.me)[data-mid="501"] .cm-body').catch(() => {});
    await wait(page, 500);
    const dmPick = await page.evaluate(() => { const p = document.querySelector(".chat-list .cm-picker"); return p ? [...p.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean) : null; });
    ok(`[${w}] T-12 DM: one tap on a line opens the menu with "Anmäl" and "Blockera" as text`, !!dmPick && dmPick.includes("Anmäl") && dmPick.includes("Blockera"), dmPick);
    await page.click('.chat-list .chat-msg:not(.me)[data-mid="501"] .cm-body').catch(() => {}); await wait(page, 400);   // tap again = close
    await clickJS(page, ".dm-chead .dm-block"); await wait(page, 500);
    const ask = await page.evaluate(() => {
      const a = document.querySelector(".dm-ask"); if (!a || a.hidden) return null;
      const bs = [...a.querySelectorAll("button")], r = (b) => b.getBoundingClientRect();
      return { t: a.innerText, btn: bs.map((b) => b.textContent.trim()), h: bs.map((b) => Math.round(r(b).height)), cut: bs.some((b) => b.scrollWidth > b.clientWidth + 1 || r(b).right > innerWidth), emo: EMO_T(a.innerText) };
      function EMO_T(s) { return /\p{Extended_Pictographic}/u.test(s); }
    });
    ok(`[${w}] T-01 DM block sheet: main "Blockera Ida", 2nd "Stäng bara chatten", 44 px, not cut, no emoji`, !!ask && /^Blockera Ida$/.test(ask.btn[0]) && /Stäng bara chatten/.test(ask.btn[1]) && ask.h.every((x) => x >= 44) && !ask.cut && !ask.emo, ask);
    ok(`[${w}] T-23 DM block sheet says what the other side sees (no "ingen signal")`, !!ask && /ser bara att chatten är stängd/.test(ask.t) && /Vänskapen tas bort/.test(ask.t) && !/signal/i.test(ask.t), ask && ask.t);
    await shot(page, "dm-block-sheet", w);
    await page.evaluate(() => { const b = document.querySelector(".dm-ask .dm-yes"); if (b) b.click(); }); await wait(page, 1500);
    const bu = n(st, "block_user").pop(), db = n(st, "dm_block").pop();
    ok(`[${w}] T-01 "Blockera" = block_user(person, the DM, on) + dm_block(on)`, !!bu && bu[1].p_kind === "person" && bu[1].p_group === DM && !bu[1].p_k && bu[1].p_on === true && !!db && db[1].p_on === true, { bu, db });
    const lock = await page.evaluate(() => { const l = document.querySelector(".dm-lock"); return l && !l.hidden ? l.innerText : null; });
    ok(`[${w}] T-23 blocker sees "Du har blockerat Ida" + Avblockera`, !!lock && /Du har blockerat Ida/.test(lock) && /Avblockera Ida/.test(lock) && !EMO.test(lock), lock);
    await shot(page, "dm-blocked", w);
    // undo from the DM = both off
    st.calls.length = 0;
    await page.evaluate(() => { const b = document.querySelector(".dm-lock .dm-unb"); if (b) b.click(); }); await wait(page, 1500);
    const ub = n(st, "block_user").pop(), ud = n(st, "dm_block").pop();
    ok(`[${w}] T-01 Avblockera in the DM = block_user(off) + dm_block(off)`, !!ub && ub[1].p_on === false && !!ud && ud[1].p_on === false, { ub, ud });
    // "Stäng bara chatten" = the old DM-only block, no block_user
    st.calls.length = 0;
    await clickJS(page, ".dm-chead .dm-block"); await wait(page, 400);
    await page.evaluate(() => { const b = document.querySelector(".dm-ask .dm-close-only"); if (b) b.click(); }); await wait(page, 1200);
    ok(`[${w}] T-01 "Stäng bara chatten" = dm_block only (no block_user)`, n(st, "dm_block").length === 1 && n(st, "block_user").length === 0, st.calls.map((c) => c[0]));
    const lock2 = await page.evaluate(() => { const l = document.querySelector(".dm-lock"); return l && !l.hidden ? l.innerText : null; });
    ok(`[${w}] T-23 closed-only chat: "Du har stängt chatten" + "Öppna chatten igen"`, !!lock2 && /stängt chatten/.test(lock2) && /Öppna chatten igen/.test(lock2), lock2);
    await ctx.close();
  }
  // T-23 the blocked side: the text matches (the chat is closed), no "just nu"
  if (want("dm")) {
    const { ctx, page } = await app(browser, 390, { dmBlockedMe: true });
    await openDm(page); await wait(page, 2500);
    const lock = await page.evaluate(() => { const l = document.querySelector(".dm-lock"); return l && !l.hidden ? l.innerText : null; });
    ok("[390] T-23 blocked side: \"Chatten är stängd\" (no promise that it opens 'just nu', no emoji)", !!lock && /Chatten är stängd/.test(lock) && !/just nu/.test(lock) && !EMO.test(lock), lock);
    await shot(page, "dm-blocked-side", 390);
    await ctx.close();
  }

  /* ---------- T-01: Mina vänner row → Blockera (full block) ---------- */
  if (want("fr")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w);
    await clickJS(page, "#btn-groups"); await wait(page, 1200);
    await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 2500);
    await page.evaluate(() => { const r = [...document.querySelectorAll(".nr-flist .nr-frow")].find((x) => /Lisa/.test(x.textContent)); const b = r && r.querySelector(".nr-more-b"); if (b) b.click(); });
    await wait(page, 500);
    const m = await page.evaluate(() => { const box = document.querySelector(".f2-menu"); if (!box) return null; const bs = [...box.querySelectorAll("button")];
      return { t: bs.map((b) => b.textContent.trim()), h: bs.map((b) => Math.round(b.getBoundingClientRect().height)), right: Math.max(...bs.map((b) => b.getBoundingClientRect().right)), vw: innerWidth, emo: /\p{Extended_Pictographic}/u.test(box.innerText) }; });
    ok(`[${w}] T-01 friend row menu: "Ta bort vän" + "Blockera" (44 px, PNI icons, no emoji, inside the screen)`, !!m && m.t.includes("Ta bort vän") && m.t.includes("Blockera") && m.h.every((x) => x >= 44) && m.right <= m.vw && !m.emo, m);
    await shot(page, "friend-menu", w);
    await page.evaluate(() => { const b = document.querySelector(".f2-menu .f2-blk"); if (b) b.click(); }); await wait(page, 1200);
    const sheet = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.innerText : null; });
    ok(`[${w}] T-01 friend Blockera → the block sheet "Blockera Lisa?"`, !!sheet && /Blockera Lisa\?/.test(sheet) && /Vänskapen tas bort/.test(sheet), sheet);
    if (process.env.FIXS_DEBUG) page.on("console", (m) => console.log("CONSOLE", m.text()));
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /^Blockera$/.test(x.textContent.trim())); if (b) b.click(); }); await wait(page, 1800);
    const bu = n(st, "block_user").pop();
    ok(`[${w}] T-01 friend Blockera = block_user(person, the friend key)`, !!bu && bu[1].p_kind === "person" && bu[1].p_k === "1111aaaa2222bbbb" && bu[1].p_on === true, bu);
    const left = await page.evaluate(() => [...document.querySelectorAll(".nr-flist .nr-frow:not(.f2-gone)")].map((x) => x.textContent));
    ok(`[${w}] T-01 the blocked friend leaves Mina vänner`, !left.some((x) => /Lisa/.test(x)), { left, toasts: await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent)), calls: st.calls.filter((c) => /friend|block/.test(c[0])).map((c) => c[0]) });
    await ctx.close();
  }

  /* ---------- T-05: send after Regler (> 15 s reading) = ONE post, field empty, line shown; group + DM ---------- */
  if (want("send")) for (const kind of ["group", "dm"]) {
    const { ctx, page, st } = await app(browser, 390, { terms: false });
    if (kind === "dm") await openDm(page); else await openGroupChat(page);
    await page.waitForSelector("#chat-inp", { timeout: 10000 }).catch(() => {}); await wait(page, 1500);
    await page.fill("#chat-inp", "Skål på er!");
    await clickJS(page, ".chat-send"); await wait(page, 600);
    const rules = await page.evaluate(() => !!document.querySelector(".sf-ov .sf-accept"));
    ok(`[390] T-05 ${kind}: Regler shows before the first post`, rules);
    await wait(page, 16500);   // longer than the app's 15 s RPC timeout
    await clickJS(page, ".chat-send");   // an impatient 2nd tap while Regler is open
    await page.evaluate(() => { const b = document.querySelector(".sf-ov .sf-accept"); if (b) b.click(); }); await wait(page, 2500);
    const posts = n(st, "post_group_msg").filter((c) => c[1].p_body === "Skål på er!").length;
    const s = await page.evaluate(() => ({ v: document.getElementById("chat-inp").value, mine: [...document.querySelectorAll(".chat-list li.chat-msg.me .cm-body")].map((b) => b.textContent),
      toasts: [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent) }));
    ok(`[390] T-05 ${kind}: after "Jag godkänner" ONE post, the field is empty, the line shows, no error toast`, posts === 1 && s.v === "" && s.mine.filter((x) => x === "Skål på er!").length === 1 && !s.toasts.some((t) => /gick int|Försök igen|fail/i.test(t)), { posts, s });
    await clickJS(page, ".chat-send"); await wait(page, 1200);
    ok(`[390] T-05 ${kind}: a tap on Skicka with the empty field posts nothing more`, n(st, "post_group_msg").length === 1, n(st, "post_group_msg").length);
    await shot(page, "send-" + kind, 390);
    await ctx.close();
  }

  /* ---------- T-12: chat line menu ---------- */
  if (want("menu")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w);
    await page.evaluate(() => { try { localStorage.removeItem("olnu.cmxTip"); } catch (e) {} });
    await openGroupChat(page); await page.waitForSelector('.chat-list .chat-msg[data-mid="4"]', { timeout: 10000 }).catch(() => {}); await wait(page, 1500);
    const tip = await page.evaluate(() => { const t = document.querySelector(".cmx-tip"); return t && !t.hidden ? t.textContent : null; });
    ok(`[${w}] T-12 a visible line says how: "Tryck på ett meddelande …"`, !!tip && /Tryck på ett meddelande/.test(tip), tip);
    await page.evaluate(() => { const m = document.querySelector('.chat-msg[data-mid="2"]'); if (m) m.scrollIntoView({ block: "center" }); }); await wait(page, 600);
    await page.click('.chat-list .chat-msg[data-mid="2"] .cm-body').catch(() => {}); await wait(page, 500);
    const m = await page.evaluate(() => {
      const p = document.querySelector(".chat-list .cm-picker"); if (!p) return null;
      const a = [...p.querySelectorAll(".cmx-act")].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), svg: !!b.querySelector("svg"), cut: b.scrollWidth > b.clientWidth + 1 }; });
      const pr = p.getBoundingClientRect(); return { a, vw: innerWidth, top: Math.round(pr.top), left: Math.round(pr.left), right: Math.round(pr.right) };
    });
    ok(`[${w}] T-12 ONE tap opens the menu: labelled "Anmäl" + "Blockera", icons, ≥ 44 px, inside the screen, not cut`,
      !!m && m.a.length === 2 && m.a[0].t === "Anmäl" && m.a[1].t === "Blockera" && m.a.every((x) => x.h >= 44 && x.svg && !x.cut && x.l >= 0 && x.r <= m.vw) && m.top >= 0, m);
    await shot(page, "chat-menu", w);
    await wait(page, 2500);
    ok(`[${w}] T-12 the menu stays open (no close by itself)`, await page.evaluate(() => !!document.querySelector(".chat-list .cm-picker")));
    await page.click('.chat-list .chat-msg[data-mid="2"] .cm-body').catch(() => {}); await wait(page, 500);
    ok(`[${w}] T-12 a 2nd tap on the same line closes it`, await page.evaluate(() => !document.querySelector(".chat-list .cm-picker")));
    // long-press held 1.2 s: the menu is there after the finger is up
    const body = await page.$('.chat-list .chat-msg[data-mid="4"] .cm-body'); const bx = body && await body.boundingBox();
    if (bx) { await page.mouse.move(bx.x + 20, bx.y + bx.height / 2); await page.mouse.down(); await wait(page, 1200); await page.mouse.up(); }
    await wait(page, 700);
    ok(`[${w}] T-12 long-press (1.2 s) → the menu stays after release`, await page.evaluate(() => !!document.querySelector('.chat-msg[data-mid="4"] .cm-picker')));
    await page.evaluate(() => { const b = document.querySelector(".cm-picker .sa-cm-blk"); if (b) b.click(); }); await wait(page, 500);
    const blk = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.innerText : null; });
    ok(`[${w}] T-12 "Blockera" in the menu → the block sheet for Oskar`, !!blk && /Blockera Oskar\?/.test(blk), blk);
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Avbryt/.test(x.textContent)); if (b) b.click(); }); await wait(page, 300);
    await page.click('.chat-list .chat-msg[data-mid="2"] .cm-body').catch(() => {}); await wait(page, 400);
    await page.evaluate(() => { const b = document.querySelector(".cm-picker .sa-cm-rep"); if (b) b.click(); }); await wait(page, 500);
    const rep = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? { t: o.innerText, chips: o.querySelectorAll(".sf-chip").length } : null; });
    ok(`[${w}] T-12 "Anmäl" in the menu → the report sheet for this line (reasons)`, !!rep && /Anmäl meddelandet/.test(rep.t) && rep.chips === 7, rep);
    ok(`[${w}] T-12 tip line hides once the menu was used`, await page.evaluate(() => { const t = document.querySelector(".cmx-tip"); return !t || t.hidden; }));
    await ctx.close();
  }

  /* ---------- T-13: a Gängkamp challenge in Inkorg and on the tile ---------- */
  // (a) my_inbox is slow (it waits in rpc_bundle2; a 500 there = ~15 s): Inkorg says "Hämtar…", never "Inga order", then the row
  if (want("duel")) {
    const { ctx, page } = await app(browser, 390, { duel: false, inboxDuel: true, inboxDelay: 9000 });
    await clickJS(page, "#btn-groups"); await wait(page, 1000);
    await clickJS(page, ".inv-tabs .ib-tab"); await wait(page, 600);
    const s0 = await page.evaluate(() => ({ empty: !!document.querySelector("#inv-pane-i .ib-empty"), load: !!document.querySelector("#inv-pane-i .ib-loading") }));
    ok("[390] T-13 Inkorg before the first answer: \"Hämtar…\", not \"Inga order\"", s0.load && !s0.empty, s0);
    await shot(page, "inbox-loading", 390);
    await page.waitForSelector("#inv-pane-i .ib-duel", { timeout: 20000 }).catch(() => {});
    const r1 = await page.evaluate(() => { const r = document.querySelector("#inv-pane-i .ib-duel"); return r ? r.innerText : null; });
    ok("[390] T-13 … then the challenge row when my_inbox answers", !!r1 && /Borlänge Bärs/.test(r1), r1);
    await ctx.close();
  }
  // (b) my_inbox missed it (or is still late) but duel_poll has it: the row, the badge and the tile come from DUEL
  if (want("duel")) for (const w of W3) {
    const { ctx, page } = await app(browser, w, { duel: true });
    await wait(page, 5000);
    const badge = await page.evaluate(() => { const b = document.getElementById("ib-badge"); return b && !b.hidden ? b.textContent : null; });
    ok(`[${w}] T-13 the red count on Grupper counts it`, !!badge && +badge >= 1, badge);
    await clickJS(page, "#btn-groups"); await wait(page, 1200);
    await clickJS(page, ".inv-tabs .ib-tab"); await wait(page, 1500);
    const ib = await page.evaluate(() => { const r = document.querySelector("#inv-pane-i .ib-duel"); return { row: r ? r.innerText : null, acts: r ? [...r.querySelectorAll(".ib-b")].length : 0, empty: !!document.querySelector("#inv-pane-i .ib-empty") }; });
    ok(`[${w}] T-13 Inkorg lists the challenge at once (Anta + Nej), also while my_inbox is late`, !!ib.row && /Borlänge Bärs utmanar Ludvika Lager/.test(ib.row) && ib.acts === 2 && !ib.empty, ib);
    await shot(page, "inbox-duel", w);
    await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 600);
    await page.evaluate(() => { window.GAMES.openGangkamp = function () {}; const c = [...document.querySelectorAll(".gcard")].find((x) => /Ludvika Lager/.test(x.textContent)); if (c) c.click(); });
    await page.waitForSelector(".gpg > .sa-gk", { timeout: 15000 }).catch(() => {}); await wait(page, 1500);
    const gk = await page.evaluate(() => { const b = document.querySelector(".gpg > .sa-gk"); if (!b) return null; b.scrollIntoView({ block: "center" }); const c = b.querySelector(".pn-gp-chev"), dot = c ? getComputedStyle(c, "::before") : null; return { t: b.innerText, dot: !!dot && dot.content !== "none" && dot.width === "10px", cls: b.className }; });
    ok(`[${w}] T-13 the Gängkamp tile says "Utmaning från Borlänge Bärs" (+ dot)`, !!gk && /Utmaning från Borlänge Bärs/.test(gk.t) && gk.dot, gk);
    await wait(page, 300); await shot(page, "gk-tile", w);
    await ctx.close();
  }

  /* ---------- T-16: group page counts follow the member list ---------- */
  if (want("count")) {
    const { ctx, page } = await app(browser, 390, { members0: true });
    await clickJS(page, "#btn-groups"); await wait(page, 1200);
    await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 500);
    await page.evaluate(() => { const c = [...document.querySelectorAll(".gcard")].find((x) => /Ludvika Lager/.test(x.textContent)); if (c) c.click(); });
    await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {}); await wait(page, 3500);
    const c = await page.evaluate(() => ({ about: (document.querySelector(".gpg-dots .pn-gp-tx small") || {}).textContent, sub: (document.querySelector(".gpg .gmain .gsub") || {}).textContent,
      mem: ((document.querySelector(".gpg-info .sa-gpg-n") || {}).textContent || "").trim() }));
    ok("[390] T-16 open group page: 4 members (from the member list, the list object said 0)", /^4 medlemmar/.test(c.about || "") && /av 4 dricker nu/.test(c.sub || "") && c.mem === "4" && !/av 0 /.test(c.sub || ""), c);
    await shot(page, "group-count", 390);
    await ctx.close();
  }

  /* ---------- T-09 + T-17 + T-18: Inställningar ---------- */
  if (want("set")) for (const w of W3) {
    const { ctx, page } = await app(browser, w, { visFail: true });
    await wait(page, 2500);
    await clickJS(page, "#btn-settings"); await wait(page, 1300);
    await page.waitForSelector("#sheet-body [data-pf=s]", { timeout: 10000 }).catch(() => {});
    await clickJS(page, "#sheet-body [data-pf=s]"); await wait(page, 1800);
    const v = await page.evaluate(() => { const s = document.querySelector("#sheet-body .mn-vis-set"); return s ? { opts: [...s.querySelectorAll("[role=radio]")].map((b) => b.textContent.trim()), note: (s.querySelector(".pn-vis-note") || {}).textContent } : null; });
    ok(`[${w}] T-18 Inställningar "Vem ser dig?" has Alla · Bara vänner · Spöke (also after a failed my_visibility)`, !!v && v.opts.join("|") === "Alla|Bara vänner|Spöke", v);
    ok(`[${w}] T-09 Alla note is honest: the gang sees the pin, friends outside the gang see only the area, no name`, !!v && /Gänget ser din pin/.test(v.note) && /utan namn/.test(v.note) && !/Vänner ser din pin/.test(v.note), v && v.note);
    const dk = await page.evaluate(() => { const r = document.querySelector("#sheet-body .dk-set"); if (!r) return null; const it = r.closest(".ds-item"), sec = r.closest("section.ds-section");
      r.scrollIntoView({ block: "center" }); const b = r.getBoundingClientRect(); return { sec: sec && sec.getAttribute("data-ds"), fold: !!(it && it.classList.contains("pn-f20-in")), h: Math.round(b.height), vis: b.height > 0 && getComputedStyle(it || r).display !== "none" }; });
    ok(`[${w}] T-17 Dialekt is a visible row (Karta), not behind "Mer"`, !!dk && dk.sec === "karta" && !dk.fold && dk.vis && dk.h >= 44, dk);
    await wait(page, 300); await shot(page, "settings-dialekt", w);
    await page.evaluate(() => { const s = document.querySelector("#sheet-body .mn-vis-set"); if (s) s.scrollIntoView({ block: "center" }); }); await wait(page, 300);
    await shot(page, "settings-vis", w);
    await page.evaluate(() => { const b = document.querySelector('#sheet-body .mn-vis-set [data-vis="vanner"]'); if (b) b.click(); }); await wait(page, 600);
    const vn = await page.evaluate(() => (document.querySelector("#sheet-body .mn-vis-set .pn-vis-note") || {}).textContent);
    ok(`[${w}] T-09 Bara vänner note: friends outside the gang see only the area, others nothing`, /Vänner utanför gänget ser bara området/.test(vn || "") && /Andra ser ingenting/.test(vn || ""), vn);
    await page.evaluate(() => { const b = document.querySelector('#sheet-body .mn-vis-set [data-vis="alla"]'); if (b) b.click(); }); await wait(page, 400);
    await clickJS(page, "#sheet-close"); await wait(page, 600);
    await page.evaluate(() => { const g = document.getElementById("pn-ghost"); if (g) g.click(); }); await wait(page, 700);
    const rail = await page.evaluate(() => { const m = document.getElementById("pn-vis"); return m ? { opts: [...m.querySelectorAll("[role=radio]")].length, note: (m.querySelector(".pn-vis-note") || {}).textContent } : null; });
    ok(`[${w}] T-09 rail menu: same honest note, 3 choices`, !!rail && rail.opts === 3 && /utan namn/.test(rail.note || ""), rail);
    await ctx.close();
  }

  /* ---------- T-23: a friend accepted in Inkorg is in Mina vänner at once ---------- */
  if (want("acc")) {
    const { ctx, page, st } = await app(browser, 390, { friendIn: true });
    await clickJS(page, "#btn-groups"); await wait(page, 1200);
    await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 2500);
    const before = await page.evaluate(() => [...document.querySelectorAll(".nr-flist .nr-frow")].map((x) => x.querySelector("b") && x.querySelector("b").textContent));
    await clickJS(page, ".inv-tabs .ib-tab"); await wait(page, 1500);
    await page.evaluate(() => { const b = document.querySelector("#inv-pane-i .ib-friend .sa-ib-yes"); if (b) b.click(); }); await wait(page, 1500);
    await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 1800);
    const after = await page.evaluate(() => [...document.querySelectorAll("#inv-pane-f .nr-flist .nr-frow")].map((x) => x.querySelector("b") && x.querySelector("b").textContent));
    ok("[390] T-23 accepted in Inkorg → Kalle is in Mina vänner at once (no reopen)", n(st, "friend_answer").length === 1 && !before.includes("Kalle") && after.includes("Kalle"), { before, after });
    ok("[390] T-23 the Vänner tab still has one 'Lägg till vän' row and one list (rebuilt in place)", await page.evaluate(() => document.querySelectorAll("#inv-pane-f .sa-vtop").length === 1 && document.querySelectorAll("#inv-pane-f .nr-flist").length === 1));
    await shot(page, "accepted-friend", 390);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
