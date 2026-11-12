// b1people lane (people / safety UI): I-01 Blockerade row, I-02 one fold style, I-03 unblock opens the DM at once, I-04 mute bell = state,
// I-12 profile card, I-13 group chat card, I-15 group top card, ownerfix 8 (DM voice bubble), 9 (DM photo preview text, one scroll area).
// Mocked server (ds-helpers + fixtures/rpc.js). Usage: node b1people-pw.js <port>
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const DM = RPCF.DM_GID, GID = RPCF.GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
const shot = (page, n) => page.screenshot({ path: SP + "b1people-" + n + ".png" }).catch(() => {});
const toastSpy = () => {
  window.__toasts = [];
  const go = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
    .observe(document.getElementById("toasts"), { childList: true });
  if (document.getElementById("toasts")) go(); else document.addEventListener("DOMContentLoaded", go);
};
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden"; }, sel);
const PNI_PATH = (n) => `window.PNI.svg("${n}")`;

// One server state for the DM tests: S.blocked = DM-only block row, S.full = full block (user_blocks), S.muted.
// S.old = a server without 0470: unblock_user leaves the DM-only block on (the bug of I-03).
function mkServer(S, calls) {
  return async (page) => {
    const thread = () => Object.assign(RPCF.dmThread(DM), { blocked_by_me: S.blocked, blocked_me: false, can_write: !S.blocked, muted: S.muted, full_block: S.full && !S.old,
      last_id: 501, last_body: "Tjena! Ute ikväll?", last_at: iso(30), last_me: false, unread: 0, at: iso(30), out: true, now: new Date().toISOString() });
    await page.route(/rest\/v1\/rpc\/(my_dms|dm_seen|dm_mute|dm_block|my_blocks|unblock_user|block_user|group_keep_history|set_group_keep_history|group_now|group_msgs|post_group_msg|group_photos|group_voices|avatars_for)\b/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1];
      let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      const isDm = b.p_group_id === DM;
      calls.push([fn, b]);
      switch (fn) {
        case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [thread()] });
        case "dm_seen": return J(r, thread());
        case "dm_mute": S.muted = !!b.p_on; return J(r, thread());
        case "dm_block": S.blocked = !!b.p_on; if (!b.p_on) S.full = S.full && S.old ? S.full : false; return J(r, thread());
        case "block_user": S.full = !!b.p_on; S.blocked = !!b.p_on; return J(r, { ok: true });
        case "my_blocks": return J(r, { v: 1, blocks: S.full ? [{ id: "abcdef0123456789", name: "Ida", kind: "person" }].concat(S.more || []) : (S.more || []) });
        case "unblock_user": S.full = false; if (!S.old) S.blocked = false; S.more = []; return J(r, { ok: true });
        case "group_keep_history": case "set_group_keep_history": case "group_now": return isDm ? J(r, { code: "P0001", message: "not_member" }, 400) : r.fallback();
        case "group_msgs": return isDm ? J(r, S.msgs.filter((m) => m.id > (b.p_after_id | 0))) : r.fallback();
        case "post_group_msg": return isDm ? J(r, { id: 900, created_at: new Date().toISOString() }) : r.fallback();
        case "group_photos": return isDm ? J(r, []) : r.fallback();
        case "group_voices": return isDm ? J(r, S.voices || []) : r.fallback();
        case "avatars_for": return isDm ? J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true }, { k: "eeeeeeeeeeee", name: "Ida", is_me: false }] }) : r.fallback();
      }
      return r.fallback();
    });
  };
}
async function openDm(page) {
  await page.click("#btn-groups"); await wait(page, 1200);
  await page.evaluate(() => { const b = document.querySelector('.inv-tabs button[data-t="f"]'); if (b) b.click(); });
  const row = await page.waitForSelector(".dm-box .dm-row", { timeout: 15000 }).catch(() => null);
  if (row) { await row.click(); await page.waitForSelector(".dm-chead", { timeout: 8000 }).catch(() => null); }
  return !!row;
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const errs = [];

  // ---------- 1. DM: I-04 mute bell = state, I-03 unblock in Settings opens the DM at once, I-01 Blockerade row ----------
  {
    const S = { blocked: false, full: false, muted: false, old: true, msgs: [{ id: 501, name: "Ida", body: "Tjena! Ute ikväll?", created_at: iso(30), is_me: false }] };
    const calls = [];
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(toastSpy);
    page.on("pageerror", (e) => errs.push(e.message));
    await mkServer(S, calls)(page);
    await boot(page);
    await page.evaluate(() => { window.__toasts = []; document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
    ok("DM opens from Vänner → Meddelanden", await openDm(page));
    // I-04: icon = state
    const bell = await page.evaluate(() => ({ html: document.querySelector(".dm-mute").innerHTML, on: window.PNI.svg("bell"), off: window.PNI.svg("bell-off"), pr: document.querySelector(".dm-mute").getAttribute("aria-pressed") }));
    ok("I-04 not muted: the bell icon (not the crossed bell), aria-pressed=false", /pi-bell"/.test(bell.html) && !/pi-bell-off/.test(bell.html) && bell.pr === "false", bell);
    await page.click(".dm-mute"); await wait(page, 700);
    const bell2 = await page.evaluate(() => ({ html: document.querySelector(".dm-mute").innerHTML, off: window.PNI.svg("bell-off"), pr: document.querySelector(".dm-mute").getAttribute("aria-pressed"), cls: document.querySelector(".dm-mute").classList.contains("on"),
      t: (window.__toasts || []).slice(-1)[0] || "" }));
    ok("I-04 muted: the crossed bell, aria-pressed=true, highlighted, toast 'Notiser av för Ida.' (no emoji)", /pi-bell-off/.test(bell2.html) && bell2.pr === "true" && bell2.cls && /^Notiser av för Ida/.test(bell2.t) && !/[🔕🔔]/u.test(bell2.t), bell2);
    await page.click(".dm-mute"); await wait(page, 700);
    ok("I-04 tap again = on again (bell, aria-pressed=false)", await page.evaluate(() => document.querySelector(".dm-mute").getAttribute("aria-pressed") === "false" && /pi-bell"/.test(document.querySelector(".dm-mute").innerHTML)));
    // block from the DM header (full block)
    await page.click(".dm-block"); await wait(page, 500);
    await clickJS(page, ".dm-yes"); await wait(page, 1500);
    const blk = await page.evaluate(() => ({ lock: !!document.querySelector(".dm-lock:not([hidden])"), txt: (document.querySelector(".dm-block") || {}).textContent, inp: document.querySelector("#chat-inp") && document.querySelector("#chat-inp").getClientRects().length ? "shown" : "none" }));
    ok("DM blocked: header button says 'Avblockera' in words, the composer is closed", /Avblockera/.test(blk.txt) && blk.lock && blk.inp === "none", blk);
    // I-03: unblock in Settings → Blockerade (the DM chat stays open below the overlay)
    await page.evaluate(() => window.SAFETY.blocked()); await wait(page, 800);
    const lst = await page.evaluate(() => [...document.querySelectorAll(".sf-ov .sf-blist button")].map((b) => b.textContent));
    ok("I-01 Blockerade list: one 'Avblockera' button per person", lst.length === 1 && /Avblockera/.test(lst[0]), lst);
    calls.length = 0;
    await page.evaluate(() => { const b = document.querySelector(".sf-ov .sf-blist button"); if (b) b.click(); });
    await wait(page, 1100);   // far less than the 4 s chat poll
    await page.evaluate(() => { const c = document.querySelector(".sf-ov button.btn-ghost"); if (c) c.click(); }); await wait(page, 300);
    const un = await page.evaluate(() => ({ inp: document.querySelector("#chat-inp") && document.querySelector("#chat-inp").getClientRects().length ? "shown" : "none", lock: !!document.querySelector(".dm-lock:not([hidden])"),
      txt: (document.querySelector(".dm-block") || {}).textContent }));
    ok("I-03 unblock_user called, and the DM-only block is ended by the client too (dm_block off)", calls.some((c) => c[0] === "unblock_user") && calls.some((c) => c[0] === "dm_block" && c[1].p_on === false), calls.map((c) => c[0]));
    ok("I-03 after unblock the DM composer is back within 1.1 s (no 2nd tap, no 4 s wait), header says 'Blockera' again", un.inp !== "none" && !un.lock && !/Avblockera/.test(un.txt), un);
    await shot(page, "dm-unblocked");
    // I-01: the "Blockerade (N)" row at the bottom of the friends list
    S.full = true; S.blocked = true; S.more = [{ id: "bbbbbbbbbbbb0001", name: "Kalle", kind: "person" }];
    await page.evaluate(() => { const b = document.querySelector("#pn-back, .g-back"); });
    await page.evaluate(() => window.INVITE && window.INVITE.openFriendsTab && window.INVITE.openFriendsTab()); await wait(page, 2200);
    const row = await page.evaluate(() => { const p = document.getElementById("inv-pane-f"), s = p && p.querySelector(":scope > .dm-blk"); return { has: !!s, last: !!s && p.lastElementChild === s, text: s ? s.textContent.replace(/\s+/g, " ").trim() : "", vis: !!s && !s.hidden && s.getClientRects().length > 0 }; });
    ok("I-01 friends list: 'Blockerade (2)' row, last in the list, visible", row.has && row.last && row.vis && /Blockerade \(2\)/.test(row.text), row);
    await page.evaluate(() => document.querySelector("#inv-pane-f .dm-blk-b").click()); await wait(page, 800);
    const lst2 = await page.evaluate(() => [...document.querySelectorAll(".sf-ov .sf-blist li")].map((l) => l.textContent.replace(/\s+/g, " ").trim()));
    ok("I-01 tap the row = the list, 'Avblockera' per person (2 people)", lst2.length === 2 && lst2.every((x) => /Avblockera/.test(x)), lst2);
    await shot(page, "blocked-list");
    await ctx.close();
  }

  await browser.close();
  console.log(`b1people: ${pass} passed, ${fail} failed` + (errs.length ? "  page errors: " + errs.slice(0, 3).join(" | ") : ""));
  process.exit(fail ? 1 : 0);
})();
