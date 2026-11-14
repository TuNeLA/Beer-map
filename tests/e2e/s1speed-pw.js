// s1speed ⚡: a DM line from the other phone shows at once on a live nudge (not at the next 7–30 s chat tick), my own line
// shows at once ("Skickar…" → ✓ → the real row, never 2 copies), dm_seen stops asking every 4 s while the socket is up,
// flag OFF = exactly the old polling, a refused socket = polling only. Usage: node s1speed-pw.js <port>
// The socket is a fake (CHATLIVE._transport test seam): the test sends the nudges. The real Supabase socket is measured
// on staging by the lane harness (s1speed/harness/measure.mjs, see DONE.md).
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
// flag + fake socket (live.js test seam PN.chatLive._transport), set before the app loads
const live = (o) => {
  try { if (o.flag) localStorage.setItem("olnu.dmLive", o.flag); sessionStorage.removeItem("olnu.liveBad"); } catch (e) {}
  // owner 13 Nov: fast chat is ON for everyone (config.js dmLive: true, release 1db56f8, 0507 on live). The config wins over the
  // localStorage test flag, so the OFF case turns the flag off with PN_CFG (read first by live.js flag()).
  if (o.off) window.PN_CFG = Object.assign({}, window.PN_CFG || {}, { dmLive: 0 });
  window.__ons = []; window.__left = 0;
  const fake = function (gid, on) {
    window.__ons.push(on);
    setTimeout(() => o.refuse ? on.state("err", { message: "Unauthorized" }) : on.state("up"), 50);
    return { leave() { window.__left++; } };
  };
  const t = setInterval(() => { const c = window.PN && window.PN.chatLive; if (c) { c._transport = fake; clearInterval(t); } }, 5);
};
async function server(page, S) {
  S.msgs = [{ id: 501, name: "Ida", body: "Tjena! Ute ikväll?", created_at: iso(30), is_me: false },
    { id: 502, name: "Anton", body: "Japp, Pitchers om en kvart", created_at: iso(25), is_me: true }];
  S.calls = [];
  await page.route(/rest\/v1\/rpc\/(my_dms|group_keep_history|group_now|group_msgs|post_group_msg|group_photos|group_voices|dm_seen)\b/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (b.p_group_id !== DM && fn !== "my_dms") return r.fallback();
    S.calls.push([fn, Date.now()]);
    switch (fn) {
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [Object.assign(RPCF.dmThread(DM), {
        last_id: 502, last_body: "Japp", last_at: iso(25), last_me: true, unread: 0, at: iso(25), out: true })] });
      case "group_keep_history": case "group_now": return J(r, { code: "P0001", message: "not_member" }, 400);
      case "group_msgs": return J(r, S.msgs.filter((m) => m.id > (b.p_after_id | 0)));
      case "post_group_msg": {
        await new Promise((res) => setTimeout(res, 1200));   // a slow phone network: the bubble must not wait for this
        const m = { id: 600 + S.msgs.length, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true };
        S.msgs.push(m); return J(r, { id: m.id, created_at: m.created_at });
      }
      case "group_photos": case "group_voices": return J(r, []);
      case "dm_seen": return J(r, RPCF.dmThread(DM));
    }
    return r.fallback();
  });
}
async function openDm(page) {
  await page.click("#btn-groups"); await wait(page, 1200);
  await page.evaluate(() => { const b = document.querySelector('.inv-tabs button[data-t="f"]'); if (b) b.click(); });
  const row = await page.waitForSelector(".dm-box .dm-row", { timeout: 15000 }).catch(() => null);
  if (!row) return false;
  await row.click();
  return page.waitForFunction(() => document.querySelectorAll(".chat-list li.chat-msg[data-mid]").length >= 2, null, { timeout: 10000 }).then(() => true, () => false);
}
const seenN = (S, from) => S.calls.filter((c) => c[0] === "dm_seen" && c[1] >= from).length;
const has = (page, id) => page.evaluate((i) => !!document.querySelector('.chat-list li[data-mid="' + i + '"]'), id);
async function arrive(page, S, id, nudge) {   // the other phone posts; the nudge comes (or not)
  S.msgs.push({ id, name: "Ida", body: "Ses vid baren " + id, created_at: new Date().toISOString(), is_me: false });
  const t0 = Date.now();
  if (nudge) await page.evaluate((i) => (window.__ons || []).forEach((on) => on.msg({ i })), id);
  return t0;
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  // ---------- 1. flag ON: nudge → the line at once; optimistic send; dm_seen quiet; leave on close ----------
  for (const w of [360, 390]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
    await ctx.addInitScript(live, { flag: "1" });
    const S = {}; await server(page, S); await boot(page);
    ok(`[${w}] ON: DM opens`, await openDm(page));
    await wait(page, 600);
    ok(`[${w}] ON: the live socket is up for this DM`, await page.evaluate((g) => !!(window.PN.chatLive && window.PN.chatLive.up(g)), DM));
    const t0 = await arrive(page, S, 503, true);
    const got = await page.waitForFunction(() => !!document.querySelector('.chat-list li[data-mid="503"]'), null, { timeout: 1500 }).then(() => Date.now() - t0, () => -1);
    ok(`[${w}] ON: Ida's new line shows ≤ 1.5 s after the nudge (${got} ms; old: next tick, 7–30 s)`, got >= 0, got);
    await page.fill("#chat-inp", "Kommer om fem " + w);
    const c0 = Date.now(); await page.click(".chat-send"); await wait(page, 250);
    const pend = await page.evaluate((t) => { const p = document.querySelector(".chat-list li.pn-pend"); return p ? p.textContent : ""; }, "");
    ok(`[${w}] ON: my line shows at once as "Skickar…" (before the 1.2 s server answer)`, pend.includes("Kommer om fem " + w) && /Skickar/.test(pend), pend);
    if (w === 360) await page.screenshot({ path: SP + "ui-testshots/s1speed-pending-" + w + ".png" });
    await page.waitForFunction((t) => [...document.querySelectorAll(".chat-list li.chat-msg.me[data-mid] .cm-body")].some((b) => b.textContent === t), "Kommer om fem " + w, { timeout: 5000 }).catch(() => null);
    await wait(page, 300);
    const after = await page.evaluate((t) => ({ pend: document.querySelectorAll(".chat-list li.pn-pend").length,
      n: [...document.querySelectorAll(".chat-list li.chat-msg.me")].filter((li) => li.textContent.includes(t)).length }), "Kommer om fem " + w);
    ok(`[${w}] ON: the real row replaces the bubble, exactly 1 copy (${Date.now() - c0} ms)`, after.pend === 0 && after.n === 1, after);
    await page.screenshot({ path: SP + "ui-testshots/s1speed-sent-" + w + ".png" });
    await wait(page, 2000);
    const q0 = Date.now(); await wait(page, 9000);
    const quiet = seenN(S, q0);
    ok(`[${w}] ON: dm_seen quiet while the socket is up (${quiet} in 9 s; old: every 4 s)`, quiet === 0, quiet);
    const s0 = Date.now(); await page.evaluate(() => (window.__ons || []).forEach((on) => on.seen())); await wait(page, 700);
    ok(`[${w}] ON: an 's' nudge asks dm_seen at once ("Sett")`, seenN(S, s0) === 1, seenN(S, s0));
    await page.click("#sheet-close"); await wait(page, 2600);
    ok(`[${w}] ON: the socket closes with the chat`, await page.evaluate(() => window.__left >= 1 && Object.keys(window.PN.chatLive._rooms()).length === 0));
    await ctx.close();
  }
  // ---------- 2. flag OFF: the old polling, no socket, no bubble ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(live, { flag: "", off: true });
    const S = {}; await server(page, S); await boot(page);
    ok("OFF: DM opens", await openDm(page));
    const q0 = Date.now(); await wait(page, 9000);
    ok(`OFF: no socket (${await page.evaluate(() => (window.__ons || []).length)} joins)`, await page.evaluate(() => (window.__ons || []).length === 0));
    ok(`OFF: dm_seen every 4 s as before (${seenN(S, q0)} in 9 s)`, seenN(S, q0) >= 2, seenN(S, q0));
    await page.fill("#chat-inp", "Utan flagga"); await page.click(".chat-send"); await wait(page, 250);
    ok("OFF: no optimistic bubble", await page.evaluate(() => !document.querySelector(".chat-list li.pn-pend")));
    await ctx.close();
  }
  // ---------- 3. the server refuses the socket (no 0507 yet): polling only, the line still comes at the tick ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(live, { flag: "1", refuse: true });
    const S = {}; await server(page, S); await boot(page);
    ok("REFUSED: DM opens", await openDm(page));
    await wait(page, 500);
    ok("REFUSED: socket given up, 10 min pause", await page.evaluate((g) => !window.PN.chatLive.up(g) && +(sessionStorage.getItem("olnu.liveBad") || 0) > Date.now()
      && Object.keys(window.PN.chatLive._rooms()).length === 0, DM));
    await arrive(page, S, 504, false);
    const got = await page.waitForFunction(() => !!document.querySelector('.chat-list li[data-mid="504"]'), null, { timeout: 9000 }).then(() => true, () => false);
    ok("REFUSED: the line still comes with the chat tick (≤ 9 s)", got);
    await ctx.close();
  }
  console.log(`s1speed: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
