// dm B1: a 1:1 chat (DM) opened from Vänner → Meddelanden must load, send and stay open. Usage: node dm-pw.js <port>
// The bug: a DM is a hidden group with no group_members rows, so member-only RPCs (group_keep_history, group_now) answer
// not_member for it (like the live server). app.js cln D then blocked ALL calls for that group id, also group_msgs and
// post_group_msg → toast "Du ä int' med i den gruppen." and the chat closed. The server here answers like live.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const NOT_MEMBER = { code: "P0001", message: "not_member", details: null, hint: null };
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
const apiHook = () => { let v; Object.defineProperty(window, "VITALS", { configurable: true, get() { return v; }, set(x) { const i = x.init; x.init = function (api) { window.__api = api; return i.apply(this, arguments); }; v = x; } }); };
// every toast text that ever shows (they go away after ~4 s)
const toastSpy = () => {
  window.__toasts = [];
  const go = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
    .observe(document.getElementById("toasts"), { childList: true });
  if (document.getElementById("toasts")) go(); else document.addEventListener("DOMContentLoaded", go);
};
const BAD = /int.? med i den gruppen|not_member|Not a member|not in that group/i;

async function server(page, calls) {
  const msgs = [{ id: 501, name: "Ida", body: "Tjena! Ute ikväll?", created_at: iso(30), is_me: false },
    { id: 502, name: "Anton", body: "Japp, Pitchers om en kvart", created_at: iso(25), is_me: true }];
  await page.route(/rest\/v1\/rpc\/(my_dms|group_keep_history|set_group_keep_history|group_now|group_msgs|post_group_msg|group_photos|group_voices|avatars_for)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const isDm = b.p_group_id === DM;
    calls.push([fn, b.p_group_id || null]);
    switch (fn) {
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 1, threads: [Object.assign(RPCF.dmThread(DM), {
        last_id: 501, last_body: "Tjena! Ute ikväll?", last_at: iso(30), last_me: false, unread: 1, at: iso(30), out: true })] });
      // member-only RPCs: like live, a DM has no group_members row
      case "group_keep_history": case "set_group_keep_history": case "group_now":
        if (isDm) return J(r, NOT_MEMBER, 400);
        return r.fallback();
      // chat RPCs (olnu_chat_can): the DM works
      case "group_msgs":
        if (!isDm) return r.fallback();
        return J(r, msgs.filter((m) => m.id > (b.p_after_id | 0)));
      case "post_group_msg": {
        if (!isDm) return r.fallback();
        const m = { id: 500 + msgs.length + 1, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true };
        msgs.push(m); return J(r, { id: m.id, created_at: m.created_at });
      }
      case "group_photos": case "group_voices": return isDm ? J(r, []) : r.fallback();
      case "avatars_for": return isDm ? J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true }, { k: "eeeeeeeeeeee", name: "Ida", is_me: false }] }) : r.fallback();
    }
    return r.fallback();
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  // ---------- 1. Vänner → Meddelanden → Ida: load, wait 2 polls, send (3 widths) ----------
  for (const w of [360, 390, 430]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
    await ctx.addInitScript(toastSpy);
    const calls = [];
    await server(page, calls);
    await boot(page);
    await page.evaluate(() => { window.__toasts = []; document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
    await page.click("#btn-groups"); await wait(page, 1200);
    await page.evaluate(() => { const b = document.querySelector('.inv-tabs button[data-t="f"]'); if (b) b.click(); });
    const row = await page.waitForSelector(".dm-box .dm-row", { timeout: 15000 }).catch(() => null);
    ok(`[${w}] Vänner: Meddelanden box lists the Ida thread`, !!row && /Ida/.test(await row.textContent()));
    if (!row) { await ctx.close(); continue; }
    await row.click();
    const got = await page.waitForFunction(() => document.querySelectorAll(".chat-list li.chat-msg").length >= 2, null, { timeout: 10000 }).then(() => true, () => false);
    ok(`[${w}] DM: messages load`, got, await page.evaluate(() => (document.querySelector(".chat-list") || {}).textContent));
    ok(`[${w}] DM: header shows the friend (dm.js chatOpen)`, await page.evaluate(() => /Ida/.test((document.querySelector(".dm-chead") || {}).textContent || "")));
    await wait(page, 9000);   // the chat polls group_msgs (fixP: first tick 7 s after the open): 2+ polls
    const polls = calls.filter((c) => c[0] === "group_msgs" && c[1] === DM).length;
    ok(`[${w}] DM: group_msgs keeps polling the server (${polls} calls in ~9 s)`, polls >= 2, calls);
    ok(`[${w}] DM: chat still open after 2 polls`, await page.evaluate(() => !document.getElementById("sheet").hidden && !!document.querySelector(".chat-list")));
    const canSend = await page.$("#chat-inp");
    if (canSend) { await page.fill("#chat-inp", "Skål Ida! Kommer nu"); await page.click(".chat-send"); await wait(page, 1800); }
    ok(`[${w}] DM: post_group_msg sent with the DM id`, calls.some((c) => c[0] === "post_group_msg" && c[1] === DM), calls.filter((c) => c[0] === "post_group_msg"));
    ok(`[${w}] DM: my message shows in the chat`, await page.evaluate(() => [...document.querySelectorAll(".chat-list li.chat-msg.me")].some((li) => /Skål Ida/.test(li.textContent))));
    ok(`[${w}] DM: input cleared after send`, !!canSend && (await page.inputValue("#chat-inp", { timeout: 2000 }).catch(() => "x")) === "");
    const toasts = await page.evaluate(() => window.__toasts || []);
    ok(`[${w}] DM: no not_member toast`, !toasts.some((t) => BAD.test(t)), toasts);
    ok(`[${w}] DM: no group_keep_history call for a 1:1 chat`, !calls.some((c) => c[0] === "group_keep_history" && c[1] === DM));
    await page.screenshot({ path: SP + "ui-testshots/dm-chat-" + w + ".png" });
    await ctx.close();
  }
  // ---------- 2. app.js cache: member-only not_member must not block chat RPCs; chat not_member blocks all ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(apiHook);
    const n = { keep: 0, msgs: 0, now: 0 };
    const A1 = "77777777-2222-3333-4444-555555555555", B1 = "88888888-2222-3333-4444-555555555555";
    await page.route(/rpc\/(group_keep_history|group_msgs|group_now)\b/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      if (b.p_group_id !== A1 && b.p_group_id !== B1) return r.fallback();
      if (fn === "group_keep_history") { n.keep++; return J(r, NOT_MEMBER, 400); }
      if (fn === "group_now") { n.now++; return J(r, NOT_MEMBER, 400); }
      n.msgs++; return b.p_group_id === A1 ? J(r, []) : J(r, NOT_MEMBER, 400);
    });
    await boot(page, { clean: true }); await wait(page, 1500);
    const r = await page.evaluate(async ([a, b]) => {
      const A = window.__api, e = (x) => x.error ? x.error.message + (x.error.quiet ? ":quiet" : "") : "ok";
      const k1 = await A.rpc("group_keep_history", { p_group_id: a });   // DM-like: member-only → not_member
      const m1 = await A.rpc("group_msgs", { p_group_id: a, p_after_id: 0 });   // chat RPC must still go out
      const k2 = await A.rpc("group_keep_history", { p_group_id: a });   // member-only: blocked (cln D kept)
      const m2 = await A.rpc("group_msgs", { p_group_id: b, p_after_id: 0 });   // real "kicked" group: chat not_member
      const m3 = await A.rpc("group_msgs", { p_group_id: b, p_after_id: 0 });   // → blocked without network
      const g3 = await A.rpc("group_now", { p_group_id: b });
      return [e(k1), e(m1), e(k2), e(m2), e(m3), e(g3)];
    }, [A1, B1]);
    ok("cache: chat RPC still reaches the server after a member-only not_member", r[1] === "ok" && n.msgs >= 1, { r, n });
    ok("cache: member-only RPC blocked after its not_member (cln D kept)", r[0] === "not_member" && r[2] === "not_member:quiet" && n.keep === 1, { r, n });
    ok("cache: chat not_member blocks every call for that group", r[3] === "not_member" && r[4] === "not_member:quiet" && r[5] === "not_member:quiet" && n.now === 0 && n.msgs === 2, { r, n });
    await ctx.close();
  }
  console.log(`dm: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
