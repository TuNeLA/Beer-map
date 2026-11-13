// lane fixC (test teams round 2, 11 Nov): N-03 chat line menu in a short chat, N-04 friend-request sender sees the answer
// (re-check, tab show, a stale friend_list) + Skriv / Bjud in on every friend row, N-18 blocked side drops the blocker,
// N-15 join card counts the others, N-16 invite form GPS default + "1 vald", N-17 one-group Grupper row follows a newer
// my_groups, N-20 Anta in Inkorg (toast + DUEL state), N-19 copy, T-22 plurals.
// Usage: node fixc-pw.js <port> [part …]   parts: menu fr join inv grp duel copy (default: all). Mocked Supabase.
// Every item FAILS on 184fe85 and PASSES with the fixC patches. Shots: OUT/fixc-shots/<tag>-<name>-<w>.png (FIXC_TAG=new|old).
const fs = require("fs");
const { chromium } = require("playwright");
const H = require("./ds-helpers.js");
const { ctxFor, boot, wait, clickJS } = H;
const RPCF = require("./fixtures/rpc.js");
const OUT = require("./env.js").OUT, SHOTS = OUT + "fixc-shots/";
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(3);
const want = (p) => !ONLY.length || ONLY.includes(p);
const TAG = process.env.FIXC_TAG || "new";
const W3 = [360, 390, 430];
const GID = "11111111-2222-3333-4444-555555555555", DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };
const shot = (page, name, w) => page.screenshot({ path: `${SHOTS}${TAG}-${name}-${w}.png` }).catch(() => {});
const KALLE = "5555aaaa6666bbbb", LISA = "1111aaaa2222bbbb";

// one stateful server; st fields are flipped by the tests
async function server(page, o, st) {
  st.calls = [];
  st.gmsgs = o.msgs || [{ id: 1, name: "Oskar", body: "Kör hårt ikväll", created_at: iso(12), is_me: false }];
  st.kalle = o.kalle || "none";   // none | pending | accepted
  st.flKalleAfter = o.flKalleAfter || 0;   // friend_list has Kalle only from this call number on (a stale first answer)
  st.flN = 0; st.lisa = !!o.lisa; st.lisaFl = !!o.lisa;
  st.mc = o.mc || 1; st.ac = 0;
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    st.calls.push([fn, b, Date.now()]);
    switch (fn) {
      case "safety_state": return J(r, { v: 1, age_ok: true, terms_ver: 1, terms_at: iso(9999), store: "off", blocks: 0, notices: [] });
      case "group_msgs": if (b.p_group_id !== GID) return r.fallback(); return J(r, st.gmsgs.filter((m) => m.id > (b.p_after_id | 0)));
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [] });
      case "my_friends": {
        const friends = (st.lisa ? [{ id: "f1", key: "f1", name: "Lisa", out: true, town: "Ludvika" }] : []).concat(st.kalle === "accepted" ? [{ id: "f5", key: "f5", name: "Kalle", out: false }] : []);
        return J(r, { code: "K7Q2MXA", friends, incoming: [], outgoing: st.kalle === "pending" ? [{ id: "f5", name: "Kalle" }] : [] });
      }
      case "friend_list": {
        st.flN++;
        const people = (st.lisaFl ? [{ key: LISA, name: "Lisa", friend_id: "f1", friend: true, out: true, groups: [] }] : [])
          .concat(st.kalle === "accepted" && st.flN >= st.flKalleAfter ? [{ key: KALLE, name: "Kalle", friend_id: "f5", friend: true, out: false, groups: [] }] : [])
          .concat(o.invPeople ? [{ key: KALLE, name: "Kalle", friend_id: "f5", friend: true, out: false, groups: [] }] : []);
        return J(r, { v: 1, people, groups: [] });
      }
      case "invite_create": return J(r, { id: 77, added: 1 });
      case "my_groups": if (!o.groups) return r.fallback();
        return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: st.mc, active_count: st.ac }]);
      case "duel_poll": return J(r, o.duel ? { v: 1, duels: [{ id: 41, status: st.duelDone ? "active" : "pending", incoming: !st.duelDone, outgoing: false, via: "code", created_at: iso(1),
        answer_by: new Date(now + 25 * 60e3).toISOString(), ends_at: new Date(now + 5 * 3600e3).toISOString(), group: { id: GID, name: "Ludvika Lager", wins: 0 },
        opp: { name: "Borlänge Bärs", members: 5, wins: 1 }, us: {}, them: {}, both: false, needs_pick: false }] } : { v: 1, duels: [] });
      case "my_inbox": return J(r, { v: 1, now: new Date().toISOString(), items: o.duel && !st.duelDone ? [{ k: "duel:41", type: "duel", id: 41, group_id: GID, group_name: "Ludvika Lager", opp: "Borlänge Bärs", answer_by: new Date(now + 25 * 60e3).toISOString(), at: iso(1) }] : [] });
      case "duel_answer": st.duelHold = true; return J(r, { ok: true, status: b.p_accept ? "active" : "declined" });
    }
    return r.fallback();
  });
}
async function app(browser, w, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: o.h || 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const st = {}; await server(page, o, st);
  if (o.duel) await ctx.addInitScript(() => { window.PN_CFG = Object.assign(window.PN_CFG || {}, { gangkamp: true }); });   // c1menus I-41: Gängkamp duels are behind PN_CFG.gangkamp (off on live); N-20 still checks Anta
  await boot(page);
  await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
  return { ctx, page, st, errs };
}
const n = (st, fn) => st.calls.filter((c) => c[0] === fn);
const friendRows = (page) => page.evaluate(() => [...document.querySelectorAll("#inv-pane-f .nr-flist .nr-frow")].map((x) => ({
  name: (x.querySelector("b") || {}).textContent, skriv: !!x.querySelector(".dm-fb"), bjud: !!x.querySelector(".inv-fb") })));
const waitTxt = (page) => page.evaluate(() => { const o = document.querySelector("#inv-pane-f .nr-out"); return o ? o.textContent : ""; });
const openVanner = async (page) => { await page.click("#btn-groups").catch(() => clickJS(page, "#btn-groups")); await wait(page, 1300); await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 2500); };
const src = async (p) => { try { const r = await fetch(BASE + p); return r.ok ? await r.text() : ""; } catch (e) { return ""; } };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });

  /* ---------- N-03: the chat line menu in a SHORT chat (one line, the 120 px box) ---------- */
  if (want("menu")) for (const w of W3) {
    const { ctx, page } = await app(browser, w);
    await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
    await page.waitForSelector('.chat-list .chat-msg[data-mid="1"]', { timeout: 10000 }).catch(() => {}); await wait(page, 1500);
    await page.click('.chat-list .chat-msg[data-mid="1"] .cm-body').catch(() => {}); await wait(page, 700);
    const m = await page.evaluate(() => {
      const p = document.querySelector(".chat-list .cm-picker"); if (!p) return null;
      const vw = document.documentElement.clientWidth, vh = innerHeight, pr = p.getBoundingClientRect(), list = document.querySelector(".chat-list").getBoundingClientRect();
      const hits = [...p.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { t: b.textContent.trim(), hit: !!e && (e === b || b.contains(e)), h: Math.round(r.height) }; });
      return { hits, inside: pr.left >= 0 && pr.right <= vw && pr.top >= 0 && pr.bottom <= vh, pr: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.right), Math.round(pr.bottom)], list: [Math.round(list.top), Math.round(list.bottom)] };
    });
    ok(`[${w}] N-03 short chat: every menu button (reactions, Anmäl, Blockera) is on top (a tap hits it, not the sheet), menu inside the screen`,
      !!m && m.hits.length >= 6 && m.hits.every((x) => x.hit) && m.hits.some((x) => x.t === "Anmäl") && m.hits.some((x) => x.t === "Blockera") && m.inside, m);
    await shot(page, "chat-menu-short", w);
    // a real tap on Blockera opens the block sheet (old: the tap went to the sheet behind)
    const bb = await page.evaluate(() => { const b = document.querySelector(".chat-list .cm-picker .sa-cm-blk"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (bb) await page.mouse.click(bb.x, bb.y); await wait(page, 700);
    const sh = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.innerText : null; });
    ok(`[${w}] N-03 a tap on "Blockera" in the short chat opens "Blockera Oskar?"`, !!sh && /Blockera Oskar\?/.test(sh), sh);
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Avbryt/.test(x.textContent)); if (b) b.click(); }); await wait(page, 400);
    // reopen, then a tap outside the chat box closes it
    await page.evaluate(() => { const p = document.querySelector(".chat-list .cm-picker"); if (p) p.remove(); });
    await page.click('.chat-list .chat-msg[data-mid="1"] .cm-body').catch(() => {}); await wait(page, 500);
    const hd = await page.evaluate(() => { const h = document.querySelector("#sheet .sheet-head h2, #sheet h2"); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; });
    const had = await page.evaluate(() => !!document.querySelector(".chat-list .cm-picker"));
    if (hd) await page.mouse.click(hd.x, hd.y); await wait(page, 400);
    ok(`[${w}] N-03 a tap outside the chat box closes the floating menu`, had && await page.evaluate(() => !document.querySelector(".chat-list .cm-picker")), { had });
    await ctx.close();
  }
  // a longer chat: the top line of a scrolled box → the line comes into view, the menu above or under it, inside the screen
  if (want("menu")) {
    const msgs = []; for (let i = 1; i <= 12; i++) msgs.push({ id: i, name: i % 3 ? "Oskar" : "Anton", body: "Rad " + i + " med lite text så det blir en rad", created_at: iso(60 - i), is_me: !(i % 3) });
    const { ctx, page } = await app(browser, 390, { msgs });
    await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
    await page.waitForSelector('.chat-list .chat-msg[data-mid="12"]', { timeout: 10000 }).catch(() => {}); await wait(page, 1500);
    // line 4 half hidden at the top of the box
    await page.evaluate(() => { const l = document.querySelector(".chat-list"), m = document.querySelector('.chat-msg[data-mid="4"]'); l.scrollTop += m.getBoundingClientRect().top - l.getBoundingClientRect().top + m.offsetHeight / 2; });
    await wait(page, 400);
    await page.evaluate(() => { const m = document.querySelector('.chat-msg[data-mid="4"] .cm-body'); const r = m.getBoundingClientRect(); window.__tapY = r.bottom - 4; });
    const y = await page.evaluate(() => window.__tapY), x = await page.evaluate(() => document.querySelector('.chat-msg[data-mid="4"] .cm-body').getBoundingClientRect().left + 20);
    await page.mouse.click(x, y); await wait(page, 700);
    const m = await page.evaluate(() => {
      const p = document.querySelector('.chat-msg[data-mid="4"] .cm-picker'); if (!p) return null;
      const li = p.closest(".chat-msg").getBoundingClientRect(), L = document.querySelector(".chat-list").getBoundingClientRect(), pr = p.getBoundingClientRect();
      const hits = [...p.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === b || b.contains(e)); });
      return { lineIn: li.top >= L.top - 1 && li.bottom <= L.bottom + 1, hits, inside: pr.top >= 0 && pr.bottom <= innerHeight };
    });
    ok("[390] N-03 a half-hidden line: it scrolls into the box, every menu button is on top and inside the screen", !!m && m.lineIn && m.hits.every(Boolean) && m.inside, m);
    await shot(page, "chat-menu-scrolled", 390);
    await ctx.close();
  }

  /* ---------- N-04 + N-18: Mina vänner follows the server while open ---------- */
  if (want("fr")) {
    // (a) I sent the request; the other side accepts while my Vänner tab is open → the row comes without a reopen
    {
      const { ctx, page, st } = await app(browser, 390, { kalle: "pending" });
      await openVanner(page);
      const w0 = await waitTxt(page);
      st.kalle = "accepted";
      await wait(page, 23000);
      const rows = await friendRows(page), w1 = await waitTxt(page), k = rows.find((r) => r.name === "Kalle");
      ok("[390] N-04 sender: \"Väntar på svar: Kalle\" first, then (tab open, no reopen, < 25 s) Kalle in Mina vänner with Skriv + Bjud in", /Väntar på svar/.test(w0) && !!k && k.skriv && k.bjud && !/Kalle/.test(w1), { w0, w1, rows });
      await shot(page, "sender-accepted", 390);
      await ctx.close();
    }
    // (b) the Vänner tab shown again = the server's list now
    for (const w of W3) {
      const { ctx, page, st } = await app(browser, w, { kalle: "pending" });
      await openVanner(page);
      st.kalle = "accepted";
      await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 600);
      await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 2500);
      const rows = await friendRows(page), k = rows.find((r) => r.name === "Kalle");
      if (process.env.FIXC_DEBUG) console.log("DEBUG", JSON.stringify(await page.evaluate(() => { const f = document.getElementById("inv-pane-f"); return { hid: f && f.hidden, html: f && f.innerHTML.replace(/<svg.*?<\/svg>/g, "").slice(0, 1500), panes: [...document.querySelectorAll(".inv-pane")].map((x) => x.id + ":" + x.hidden) }; })), JSON.stringify(st.calls.filter((c) => /friend/.test(c[0])).map((c) => c[0])));
      ok(`[${w}] N-04 Grupper → Vänner again: Kalle is a friend now, row has Skriv + Bjud in`, !!k && k.skriv && k.bjud && !/Väntar/.test(await waitTxt(page)), rows);
      await shot(page, "tab-again", w);
      await ctx.close();
    }
    // (c) friend_list is older than my_friends (first answer without Kalle) → the row still gets Skriv + Bjud in
    {
      const { ctx, page } = await app(browser, 390, { kalle: "accepted", flKalleAfter: 2 });
      await openVanner(page); await wait(page, 2500);
      const rows = await friendRows(page), k = rows.find((r) => r.name === "Kalle");
      ok("[390] N-04 a stale friend_list: the accepted friend's row has Skriv + Bjud in (DM start)", !!k && k.skriv && k.bjud, rows);
      await ctx.close();
    }
    // (d) N-18: I am blocked by Lisa: my_friends drops her (friend_list still has her) → she leaves Mina vänner on the next show
    {
      const { ctx, page, st } = await app(browser, 390, { lisa: true });
      await openVanner(page);
      const r0 = await friendRows(page);
      st.lisa = false;   // block_user on her side; friend_list answer still old
      await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 600);
      await clickJS(page, '.inv-tabs button[data-t="f"]'); await wait(page, 3000);
      const r1 = await friendRows(page);
      ok("[390] N-18 blocked side: Lisa leaves Mina vänner without a reopen (a stale friend_list does not bring her back)", r0.some((r) => r.name === "Lisa") && !r1.some((r) => r.name === "Lisa"), { r0, r1 });
      await shot(page, "blocked-side", 390);
      await ctx.close();
    }
  }

  /* ---------- N-15: the join card counts the others ---------- */
  if (want("join")) for (const mem of [true, false]) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { clean: true });
    await ctx.addInitScript(() => { try { localStorage.setItem("olnu.name", "Cia"); localStorage.setItem("olnu.age18", "1"); } catch (e) {} });
    await page.route(/rest\/v1\/rpc\/(link_preview|join_preview|join_group)\b/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1];
      if (fn === "link_preview") return J(r, { ok: true, kind: "join", name: "Verifygänget", members: mem ? 3 : 2, ute: 0, faces: [{ n: "Ada" }, { n: "Bo" }].concat(mem ? [{ n: "Cia" }] : []) });
      if (fn === "join_preview") return J(r, { ok: true, name: "Verifygänget", members: mem ? 3 : 2, member: mem, out: 0, faces: ["A", "B"].concat(mem ? ["C"] : []) });
      return J(r, { id: GID, name: "Verifygänget", code: "M9SKSY" });
    });
    await page.goto(BASE + "?join=M9SKSY&by=Ada");
    await page.waitForSelector(".jn-mem:not([hidden])", { timeout: 20000 }).catch(() => {}); await wait(page, 5000);
    const t = await page.evaluate(() => (document.querySelector(".jn-mem") || {}).textContent || "");
    if (mem) ok("[390] N-15 I am already a member (3 with me): \"3 i gänget\", never \"3 i gänget redan\"", /3 i gänget/.test(t) && !/redan/.test(t), t);
    else ok("[390] N-15 not a member yet: \"2 i gänget redan\" (the others)", /2 i gänget redan/.test(t), t);
    await shot(page, "join-" + (mem ? "member" : "new"), 390);
    await ctx.close();
  }

  /* ---------- N-16: invite form: the shown GPS default is the real choice; "1 vald" ---------- */
  if (want("inv")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w, { invPeople: true });
    await page.evaluate((k) => window.INVITE.openCreate({ keys: [k], who: "Kalle" }), KALLE);
    await page.waitForSelector(".inv-sel", { timeout: 10000 }).catch(() => {}); await wait(page, 2000);
    const f = await page.evaluate(() => ({ sel: (document.querySelector(".inv-sel") || {}).value, shown: ((document.querySelector(".inv-sel") || {}).selectedOptions || [{}])[0].textContent, n: (document.querySelector(".inv-pk-n") || {}).textContent }));
    ok(`[${w}] T-22 picker count: "1 vald" (not "1 valda")`, f.n === "1 vald", f);
    await shot(page, "invite-form", w);
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    await clickJS(page, ".inv-send"); await wait(page, 2500);
    const ic = n(st, "invite_create").pop(), toasts = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent));
    ok(`[${w}] N-16 "${f.shown}" shown first → Skicka sends with my GPS spot (no "Välj var.")`, /GPS/.test(f.shown || "") && !!ic && Math.abs(ic[1].p_lat - 60.1511) < 0.01 && !toasts.some((t) => /Välj var/.test(t)), { f, ic: ic && ic[1], toasts });
    await ctx.close();
  }

  /* ---------- N-17: ONE group: the Grupper row follows a newer my_groups (and the group page opens with it) ---------- */
  if (want("grp")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w, { groups: true, mc: 1 });
    await page.click("#btn-groups").catch(() => {}); await wait(page, 1500);
    await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 800);
    const t0 = await page.evaluate(() => (document.querySelector(".glist .gcard .gsub") || {}).textContent);
    await clickJS(page, "#sheet-close"); await wait(page, 1200);
    st.mc = 4; st.ac = 1;   // 3 people joined, one is out
    await wait(page, 16000);   // the cached answer is older than 15 s → warm.js asks again in the background
    await page.click("#btn-groups").catch(() => {}); await wait(page, 4000);
    await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 500);
    const t1 = await page.evaluate(() => (document.querySelector(".glist .gcard .gsub") || {}).textContent);
    ok(`[${w}] N-17 one group: the row said "${t0}", after 3 joins it says "1 av 4 dricker nu" without a reopen`, /av 1 /.test(t0 || "") && /1 av 4 dricker nu/.test(t1 || ""), { t0, t1, mg: n(st, "my_groups").length });
    await shot(page, "group-row", w);
    await ctx.close();
  }

  /* ---------- N-20: Anta in Inkorg: a toast you see + DUEL stops saying "Utmaning från" ---------- */
  if (want("duel")) for (const w of W3) {
    const { ctx, page, st } = await app(browser, w, { duel: true });
    await page.waitForFunction(() => window.DUEL && window.DUEL.data && window.DUEL.data() && (window.DUEL.data().duels || []).length, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { try { window.DUEL.onAuthed(); } catch (e) {} }); await wait(page, 1500);
    await clickJS(page, "#btn-groups"); await wait(page, 1300);
    await clickJS(page, ".inv-tabs .ib-tab"); await wait(page, 2000);
    const pre = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent));
    await page.evaluate(() => { const b = [...document.querySelectorAll("#inv-pane-i .ib-duel .sa-ib-yes")].find((x) => /Anta/.test(x.textContent)); if (b) b.click(); }); await wait(page, 900);
    const t = await page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => ({ t: x.textContent, open: !!x.querySelector("button") && /Öppna/.test(x.querySelector("button").textContent) })));
    const d = await page.evaluate(() => { const x = ((window.DUEL.data() || {}).duels || [])[0]; return x ? { inc: x.incoming, st: x.status } : null; });
    ok(`[${w}] N-20 Anta → the answer toast shows at once ("Öppna"), no old "utmanar" toast`, n(st, "duel_answer").length === 1 && t.some((x) => /Duellen|Utmaningen antagen|Krig/.test(x.t) && x.open) && !t.some((x) => /utmanar/.test(x.t)), { pre, t });
    ok(`[${w}] N-20 Anta → DUEL's duel is answered (tile + count follow, no "Utmaning från")`, !!d && d.inc === false && d.st === "active", d);
    await shot(page, "duel-anta", w);
    await ctx.close();
  }

  /* ---------- N-19 copy + T-22 plurals (source + runtime) ---------- */
  if (want("copy")) {
    const pf = await src("js/pinfolj.js");
    ok("N-19 \"Pinnen följer med dig\" hint = the T-09 rule (gang sees, friends outside the gang only the area, no name)", /Gänget ser var du ä nu\. Vänner utanför gänget och andra ser bara området eller krogen, utan namn/.test(pf) && !/Bara vänner och gänget ser var du/.test(pf), pf.length);
    const nw = await src("js/news.js"), mm = nw.match(/function sentences\(t\) \{ return (String\(t\)\.replace\(.*?\); \}\); )\}/);
    let out = null; try { out = mm ? new Function("t", "return " + mm[1])("Perfekt tid att skicka ”Ikväll?” till gänget. nu kör vi! ja") : null; } catch (e) { out = "ERR " + e.message; }
    ok("N-19 ticker: no capital after a quoted question (\"”Ikväll?” till gänget\"), sentences still start with a capital", out === "Perfekt tid att skicka ”Ikväll?” till gänget. Nu kör vi! Ja", out);
    const pr = await src("js/profile.js"), a2 = await src("js/after2.js"), ps = await src("js/passport.js"), pu = await src("js/pnui.js"), gw = await src("js/gw.js"), av = await src("js/avatar.js");
    ok("T-22 Profil \"Stamkrog i år: … · 1 kväll\" (U.pl)", /U\.pl\(y\.fav_bar_nights, "kväll", "kvällar"\)/.test(pr));
    ok("T-22 morning report numbers card \"1 krog\"", /\(m\.bars \| 0\) === 1 \? String\(U\.n1\("1 " \+ T\("after\.r2\.num\.bars"\)\)\)/.test(a2));
    ok("T-22 Ölpasset / Profil rows / Hemma-stan / avatar unlock: 1 krog, 1 medalj", /U\.pl\(data\.bars\.length, "krog", "krogar"\)/.test(ps) && /U\.pl\(nBars, "krog", "krogar"\)/.test(pu) && /U\.pl\(nMed, "medalj", "medaljer"\)/.test(pu) && /U\.n1\(\(t\.visited \| 0\) \+ " av "/.test(gw) && /U\.n1\(lk\.b \+ " krogar"\)/.test(av));
    const { ctx, page } = await app(browser, 390);
    const rt = await page.evaluate(() => ({ a: window.U.pl(1, "kväll", "kvällar"), b: window.U.n1("1 av 1 krogar"), c: window.U.pl(2, "vald", "valda") }));
    ok("T-22 runtime: U.pl(1) = \"1 kväll\", U.n1(\"1 av 1 krogar\") = \"1 av 1 krog\", 2 = \"2 valda\"", rt.a === "1 kväll" && rt.b === "1 av 1 krog" && rt.c === "2 valda", rt);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack); process.exit(1); });
