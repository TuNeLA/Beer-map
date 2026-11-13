// c3chat lane: I-37 DM list fills the sheet, I-38 voice/photo/text bubbles share one left edge, I-39 DM header avatar = chat avatar component,
// I-40 avatar tap = profile card (bubble tap = reactions), I-43 Truppen sheet: plain time field + tabs do not move the sheet.
// Mocked server (ds-helpers + fixtures/rpc.js). Usage: node c3chat-pw.js <port>
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const RPCF = require("./fixtures/rpc.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const DM = RPCF.DM_GID;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
const shot = (page, n) => page.screenshot({ path: SP + "c3chat-" + n + ".png" }).catch(() => {});

async function dmServer(page, S) {
  const thread = () => Object.assign(RPCF.dmThread(DM), { blocked_by_me: false, blocked_me: false, can_write: true, muted: false, full_block: false,
    last_id: 503, last_body: "Hej", last_at: iso(30), last_me: false, unread: 0, at: iso(30), out: true, now: new Date().toISOString() });
  await page.route(/rest\/v1\/rpc\/(my_dms|dm_seen|group_keep_history|set_group_keep_history|group_now|group_msgs|post_group_msg|group_photos|group_voices|avatars_for|msg_reacts)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const isDm = b.p_group_id === DM;
    switch (fn) {
      case "my_dms": return J(r, { v: 1, now: new Date().toISOString(), unread: 0, threads: [thread()] });
      case "dm_seen": return J(r, thread());
      case "group_keep_history": case "set_group_keep_history": case "group_now": return isDm ? J(r, { code: "P0001", message: "not_member" }, 400) : r.fallback();
      case "group_msgs": return isDm ? J(r, S.msgs.filter((m) => m.id > (b.p_after_id | 0))) : r.fallback();
      case "post_group_msg": return isDm ? J(r, { id: 900, created_at: new Date().toISOString() }) : r.fallback();
      case "group_photos": return isDm ? J(r, []) : r.fallback();
      case "group_voices": return isDm ? J(r, S.voices || []) : r.fallback();
      case "msg_reacts": return isDm ? J(r, []) : r.fallback();
      case "avatars_for": return isDm ? J(r, { v: 1, people: [{ k: "me", name: "Anton", is_me: true }, { k: "eeeeeeeeeeee", name: "Ida", is_me: false }] }) : r.fallback();
    }
    return r.fallback();
  });
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
  // ---------- DM: I-37 / I-38 / I-39 / I-40 ----------
  for (const vp of [{ width: 390, height: 844 }, { width: 960, height: 1250 }]) {
    const S = { msgs: [{ id: 501, name: "Ida", body: "Tjena mannen", created_at: iso(40), is_me: false }, { id: 502, name: "Ida", body: "Ute ikväll?", created_at: iso(39), is_me: false },
      { id: 503, name: "Anton", body: "Japp", created_at: iso(30), is_me: true }],
      voices: [{ id: 71, name: "Ida", is_me: false, dur_ms: 2000, mime: "audio/webm", created_at: iso(38) }] };
    const { ctx, page } = await ctxFor(browser, vp);
    page.on("pageerror", (e) => errs.push(e.message));
    await dmServer(page, S);
    await boot(page);
    ok(vp.width + " DM opens", await openDm(page));
    await wait(page, 1800);
    const m = await page.evaluate(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), h: Math.round(b.height) }; };
      const sheet = document.getElementById("sheet"), list = document.querySelector("#sheet-body .chat-list"), inp = document.querySelector(".chat-input");
      const lefts = [...document.querySelectorAll("#sheet-body .chat-list > li.chat-msg:not(.me)")].map((l) => Math.round(l.getBoundingClientRect().left));
      const hdAv = document.querySelector(".dm-cwho .av, .dm-cwho .dm-av"), pic = document.querySelector(".chat-list .av-pic");
      return { sheet: r(sheet), list: r(list), inp: r(inp), lefts, voice: !!document.querySelector(".chat-msg.af-voice"), last: Math.round([...document.querySelectorAll("#sheet-body > *")].filter((e) => e.getBoundingClientRect().height > 0).pop().getBoundingClientRect().bottom), hd: hdAv ? { avk: hdAv.getAttribute("data-avk"), cls: hdAv.className } : null, pic: pic ? pic.getAttribute("data-avk") : null };
    });
    ok(vp.width + " I-37 no big empty area under the composer (last line ends < 70 px above the sheet bottom)", m.sheet && m.last && m.sheet.b - m.last < 70, m);
    ok(vp.width + " I-37 list fills the free height (list bottom touches the composer, list > 40% of sheet)", m.list && m.inp && m.inp.t - m.list.b < 24 && m.list.h > m.sheet.h * 0.4, m);
    ok(vp.width + " I-38 voice bubble exists", m.voice, m);
    ok(vp.width + " I-38 text + voice bubbles of Ida share one left edge", m.lefts.length >= 3 && new Set(m.lefts).size === 1, m.lefts);
    ok(vp.width + " I-39 DM header avatar = the chat avatar component (same data-avk)", !!(m.hd && m.pic && m.hd.avk === m.pic && /\bav\b/.test(m.hd.cls)), m);
    // I-40: avatar tap = profile card, no reactions menu; bubble tap = reactions
    await page.evaluate(() => { const list = document.querySelector("#sheet-body .chat-list"); list.scrollTop = list.scrollHeight; });
    await page.click(".chat-list .av-pic"); await wait(page, 600);
    const t1 = await page.evaluate(() => ({ picker: !!document.querySelector(".cm-picker"), card: !!document.querySelector(".pc-ov .pc-card"), name: (document.querySelector(".pc-name") || {}).textContent }));
    ok(vp.width + " I-40 avatar tap opens the profile card, no reactions menu", t1.card && !t1.picker && t1.name === "Ida", t1);
    await shot(page, "card-" + vp.width);
    await page.evaluate(() => window.PROFCARD && window.PROFCARD.close()); await wait(page, 200);
    await page.evaluate(() => { const c = document.querySelector(".cm-picker"); if (c) c.remove(); });
    await page.evaluate(() => document.querySelector(".chat-list li.chat-msg[data-mid='501'] .cm-body").click()); await wait(page, 500);
    const t2 = await page.evaluate(() => ({ picker: !!document.querySelector(".cm-picker"), card: !!document.querySelector(".pc-ov .pc-card") }));
    ok(vp.width + " I-40 bubble tap opens the reactions menu, no card", t2.picker && !t2.card, t2);
    await shot(page, "dm-" + vp.width);
    if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => ({
      voice: (document.querySelector(".chat-msg.af-voice") || {}).className,
      kids: [...document.querySelectorAll("#sheet-body > *")].map((e) => { const b = e.getBoundingClientRect(); return e.tagName + "." + e.className + " " + Math.round(b.top) + "-" + Math.round(b.bottom); }),
      sb: (() => { const b = document.getElementById("sheet-body").getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; })() }))));
    await ctx.close();
  }
  // ---------- Truppen sheet: I-43 ----------
  for (const vp of [{ width: 390, height: 844 }, { width: 960, height: 900 }]) {
    const { ctx, page } = await ctxFor(browser, vp);
    page.on("pageerror", (e) => errs.push(e.message));
    await page.route(/rest\/v1\/rpc\/crew_group\b/, (r) => J(r, { deps: [], dates: { closed: true }, mood: { my: "ok" }, members: [], replay: null }));
    await boot(page);
    await page.evaluate((g) => window.CREW.open(g, "Test", "dep"), RPCF.GID); await wait(page, 1200);
    const geo = () => page.evaluate(() => { const s = document.getElementById("sheet").getBoundingClientRect(), p = document.getElementById("cr-pane").getBoundingClientRect(); return { top: Math.round(s.top), bot: Math.round(s.bottom), ph: Math.round(p.height) }; });
    const base = await geo(), seen = [base];
    // c35fix: wait for the Departures form itself (crew_group answer drawn), not a fixed 1.2 s; on a miss report what the pane shows
    await page.waitForSelector(".cr-time", { timeout: 8000 }).catch(() => {});
    const tin = await page.evaluate(() => { const e = document.querySelector(".cr-time"); if (!e) { const p = document.getElementById("cr-pane"); return { missing: true, pane: p ? p.textContent.slice(0, 120) : "no #cr-pane", toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ").slice(0, 120) }; } e.focus(); const c = getComputedStyle(e), p = e.parentElement, pc = getComputedStyle(p);
      return { ml: c.borderLeftWidth + " " + c.borderLeftColor, bs: c.boxShadow, pbs: pc.boxShadow, pbl: pc.borderLeftWidth, ptr: pc.backgroundColor, rad: c.borderRadius, h: Math.round(e.getBoundingClientRect().height) }; });
    ok(vp.width + " I-43 time field: no accent bar (no inset left shadow, border 1 px all sides)", tin && !tin.missing && !/inset\s+-?\d+px 0/.test(tin.bs + " " + tin.pbs) && /^1px/.test(tin.ml) && tin.pbl === "0px", tin);   // the row around it must not wear the bar-list style (border-left 3px amber)
    await shot(page, "truppen-" + vp.width);
    for (const t of ["dates", "laget", "torch", "replay", "dep"]) {
      await page.evaluate((t) => document.querySelector('.cr-tab[data-tab="' + t + '"]').click(), t); await wait(page, 500);
      seen.push(await geo());
    }
    ok(vp.width + " I-43 switching tabs does not move the sheet (top and bottom equal on all 5 tabs)", seen.every((g) => g.top === base.top && g.bot === base.bot), seen);
    await ctx.close();
  }
  await browser.close();
  console.log(`c3chat: ${pass} passed, ${fail} failed` + (errs.length ? "  page errors: " + errs.slice(0, 3).join(" | ") : ""));
  process.exit(fail ? 1 : 0);
})();
