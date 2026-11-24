// dsocial-pw.js — lane d-social (owner 15 Nov 2026, I-114: design proposals 07 + 09 + 10 + 11, small fixes 7, 8, 14, 15, 27, 30).
//   grp   07 group page: ONE "who is out" card, the chat starts >= 80 px higher, the "Ikväll" bar and its neighbours are as before
//   chat  the group chat line shows at the tap (3 s slow server), one copy after the answer, "Inte skickat" + retry on a failure;
//         chat avatar = a 44 px target with a 32 px picture (fix 14), my bubble colour is a token (fix 15)
//   tell  the event chat line ("Säg till gruppen", evsheet.js): the same three things
//   empty 09: Event / Inkorg / Topplistor: one sentence, one button that works, no control that does nothing; tab "Krogar" (fix 8)
//   van   10 Vänner: 64 px rows, friends who are out first (fix 27), Hitta + "⋯", Skriv + Bjud in in the open row, "Låt mig hittas" card
//   inv   11 Bjud in: no emoji in a field, one label style, quick time choices send what the old form sent, the chosen one is marked
//   join  fix 30: the group "Bjud in" sheet fits: no hint box cut at the sheet edge
// "Before" numbers (old code, big-update defe149): fixtures/dsocial-before.json. Mocked Supabase, 390 x 844.
// Usage: node dsocial-pw.js <port> [grp,chat,tell,empty,van,inv,join] [shotsDir]
const { ctxFor, boot, wait, clickJS, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const BEFORE = require("./fixtures/dsocial-before.json");
const ONLY = (process.argv[3] || "").split(",").filter(Boolean), SHOTS = process.argv[4] || "";
const want = (k) => !ONLY.length || ONLY.includes(k);
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };
const now = Date.now();
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const BAD = (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "boom" }) });
const EMOJI = "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]";
const FRIENDS = [
  { id: 1, key: "k1", name: "Lisa", out: false, home_town: "Ludvika" },
  { id: 2, key: "k2", name: "Oskar", out: true, town: "Ludvika", home_town: "Göteborg" },
  { id: 3, key: "k3", name: "Maximilian Andersson-Lindqvist", out: false, home_town: "Smedjebacken" },
  { id: 4, key: "k4", name: "Ida", out: true, town: "Ludvika", home_town: null }];
const PEOPLE = FRIENDS.map((f) => ({ friend_id: f.id, key: f.key, find_key: f.key, name: f.name, out: f.out, town: f.town || null, home_town: f.home_town, friend: true, groups: f.id < 3 ? [{ id: GID, name: "Ludvika Lager" }] : [] }));

async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (o.routes) await o.routes(page);
  await boot(page, o);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  return { ctx, page, errs };
}
const closeAll = async (page) => { await page.evaluate(() => { for (let i = 0; i < 4; i++) { const c = document.getElementById("sheet-close"), s = document.getElementById("sheet"); if (s && !s.hidden && c) c.click(); } }); await wait(page, 500); };
const shot = async (page, name) => { if (SHOTS) { await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove())); await page.screenshot({ path: SHOTS + "/dsocial-" + name + ".png" }); } };
async function openGroup(page) {
  await clickJS(page, "#btn-groups"); await wait(page, 1200);
  await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
  await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {});
  await wait(page, 2600);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}
const tab = (page, re) => page.evaluate((r) => { const b = [...document.querySelectorAll("#sheet .inv-tabs button")].find((x) => new RegExp(r).test(x.textContent)); if (b) b.click(); return !!b; }, re);
// Click, then look at the page in the same task and at each frame: how many ms until `sel` (with `text` in it) is there (-1 = not within `max` ms)
const msUntil = (page, clickSel, sel, text, max) => page.evaluate(([c, s, t, mx]) => new Promise((res) => {
  const hit = () => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length && e.textContent.indexOf(t) >= 0);
  const t0 = performance.now(); document.querySelector(c).click();
  (function look() { if (hit()) return res(Math.round(performance.now() - t0)); if (performance.now() - t0 > mx) return res(-1); requestAnimationFrame(look); })();
}), [clickSel, sel, text, max]);

// one section = one part of the lane; an exception stops that section only (on the old code most parts are not there)
const sect = async (k, fn) => { if (!want(k)) return; try { await fn(); } catch (e) { fail++; console.log("FAIL " + k + " stopped by an exception:", String(e.message).split("\n")[0].slice(0, 200)); } };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ---------- grp: design 07, one "who is out" card ---------- */
    await sect("grp", async () => {
      const { ctx, page, errs } = await open(browser);
      await openGroup(page);
      const G = await page.evaluate((P) => {
        const w = document.querySelector(".gpg"), V = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden";
        const T = (e) => Math.round(e.getBoundingClientRect().top), H = (e) => Math.round(e.getBoundingClientRect().height);
        const cards = [...new Set([...w.querySelectorAll(":scope > .gpg-now, :scope > .pn-gp-mem, :scope > .gmain .gsub")])].filter(V);
        const card = w.querySelector(":scope > .gpg-now"), nb = card && card.querySelector(".gpg-now-b"), more = card && card.querySelector(".pn-gp-mem-more");
        const cs = (e, props) => { const s = getComputedStyle(e), o = {}; props.forEach((p) => { o[p] = s.getPropertyValue(p); }); return o; };
        const bar = w.querySelector(":scope > .gpg-bar"), ikv = w.querySelector(".gpg-plus.pn-gp-ikv"), about = w.querySelector(":scope > .gpg-dots"), chat = w.querySelector(":scope > .gpg-chat");
        return { n: cards.length, cls: cards.map((c) => c.className), title: card ? (card.querySelector(".gpg-now-t") || {}).textContent : "", where: card ? (card.querySelector(".gpg-now-l") || {}).textContent : "",
          last: card ? (card.querySelector(".gpg-now-s") || {}).textContent : "", faces: card ? [...card.querySelectorAll(".pn-gp-mi")].map((m) => m.querySelector(".pn-gp-mn").textContent + ":" + m.querySelector(".pn-gp-mc").textContent) : [],
          nbH: nb ? H(nb) : 0, moreW: more ? Math.round(more.getBoundingClientRect().width) : 0, moreH: more ? H(more) : 0,
          wrapTop: T(w), chatTop: T(chat), msgsTop: T(w.querySelector(".gpg-msgs")),
          ikv: { bar: cs(bar, P), btn: cs(ikv, P), ti: cs(ikv.querySelector(".pn-gp-ti"), P), tx: cs(ikv.querySelector(".pn-gp-tx b"), P), sm: cs(ikv.querySelector(".pn-gp-tx small"), P), about: cs(about, P), chat: cs(chat, P),
            barAfter: getComputedStyle(bar, "::after").content, barBefore: getComputedStyle(bar, "::before").content, btnAfter: getComputedStyle(ikv, "::after").content, btnBefore: getComputedStyle(ikv, "::before").content },
          order: [...w.children].filter(V).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => String(e.className).split(" ")[0]) };
      }, Object.keys(BEFORE.ikv.bar));
      const B = BEFORE.group;
      ok(`grp exactly ONE "who is out" card on the group page (before: ${B.whoCards.length}: ${B.whoCards.join(", ")})`, G.n === 1 && /gpg-now/.test(G.cls[0]) && /pn-gp-mem/.test(G.cls[0]), { n: G.n, cls: G.cls });
      ok("grp the card says who is out now, where, and the newest one", /^3 ute nu$/.test(G.title) && /La Parma/.test(G.where) && /Pitchers/.test(G.where) && /^Senast: Oskar · \d+ min$/.test(G.last), { t: G.title, w: G.where, l: G.last });
      ok("grp the card keeps tonight's drink counts in the Gänget ikväll strip (4 faces)", G.faces.length === 4 && G.faces[0] === "Oskar:11" && G.faces.some((f) => /^Du:7$/.test(f)) && G.faces.some((f) => /^Nisse:–$/.test(f)), G.faces);
      ok("grp the Nu text and the Medlemmar arrow are 44 px targets", G.nbH >= 44 && G.moreW >= 44 && G.moreH >= 44, { nbH: G.nbH, moreW: G.moreW, moreH: G.moreH });
      const upChat = (B.chatTop - B.wrapTop) - (G.chatTop - G.wrapTop), upMsgs = (B.msgsTop - B.wrapTop) - (G.msgsTop - G.wrapTop);
      console.log(`     chat block top: before ${B.chatTop} px, now ${G.chatTop} px (page top ${B.wrapTop} / ${G.wrapTop}); first chat line: before ${B.msgsTop} px, now ${G.msgsTop} px`);
      ok(`grp the chat list starts >= 80 px higher (before ${B.msgsTop - B.wrapTop} px under the page top, now ${G.msgsTop - G.wrapTop} px: ${upMsgs} px higher)`, upMsgs >= 80 && upChat >= 80, { upChat, upMsgs });
      const diff = [];
      Object.keys(BEFORE.ikv).forEach((k) => {
        const a = BEFORE.ikv[k], b = G.ikv[k];
        if (typeof a === "string") { if (a !== b) diff.push(k + ": " + a + " → " + b); return; }
        Object.keys(a).forEach((p) => { if (a[p] !== b[p]) diff.push(k + "." + p + ": " + a[p] + " → " + b[p]); });
      });
      // fixD P-08 (polish sweep, 24 Nov): the bar is a row in the page flow now (no sticky strip, no float shadow, card look): these
      // values changed on purpose. Everything else of the bar, the button and its neighbours must stay as it was.
      const fixD = /^(bar\.(position|padding-top|padding-bottom|background-image|height|order)|btn\.(background-color|border-(top|right|bottom|left)-color|box-shadow)):/;
      const diff2 = diff.filter((d) => !fixD.test(d));
      ok('grp the "Ikväll" bar, its button and its neighbours (Chatten, Om gruppen) have the computed styles of the old code (no strip, no border; fixD P-08 changes excepted)', diff2.length === 0, diff2);
      ok("grp order on the page: top card, the one card, …, chat, Om gruppen (the bar floats)", G.order.indexOf("gpg-now") > G.order.indexOf("gmain") && G.order.indexOf("gpg-now") < G.order.indexOf("gpg-chat") && G.order.indexOf("gpg-chat") < G.order.indexOf("gpg-dots"), G.order);
      await shot(page, "group");
      // the Nu text is still a way to "show them"; the arrow opens Medlemmar
      const tap = await page.evaluate(() => { let n = 0; const k = window.HITTA && window.HITTA.nowSheet; if (window.HITTA) window.HITTA.nowSheet = function () { n++; return true; };
        document.querySelector(".gpg-now-b").click(); if (window.HITTA) window.HITTA.nowSheet = k; return n; });
      ok("grp a tap on the Nu text still opens 'who is out' (HITTA.nowSheet)", tap === 1, tap);
      ok("grp no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- chat: the group chat line at the tap + small fixes 14, 15 ---------- */
    await sect("chat", async () => {
      const st = { posts: [], mode: "slow", next: 100, rows: [] };
      const { ctx, page, errs } = await open(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/post_group_msg/, async (r) => {
          const b = JSON.parse(r.request().postData() || "{}"); st.posts.push(b.p_body);
          if (st.mode === "fail") return BAD(r);
          await new Promise((res) => setTimeout(res, 3000));
          const m = { id: st.next++, name: "Anton", body: b.p_body, created_at: new Date().toISOString(), is_me: true }; st.rows.push(m);
          return J(r, { id: m.id, created_at: m.created_at });
        });
        await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); return (b.p_after_id | 0) > 0 ? J(r, st.rows.filter((m) => m.id > b.p_after_id)) : r.fallback(); });
      } });
      await openGroup(page);
      await page.evaluate(() => { const sb = document.getElementById("sheet-body"), c = document.querySelector(".gpg-chat"); sb.scrollTop += c.getBoundingClientRect().top - sb.getBoundingClientRect().top - 8; });
      const rowsOf = (t) => page.evaluate((t) => [...document.querySelectorAll(".gpg-msgs > li")].filter((li) => li.textContent.indexOf(t) >= 0).map((li) => ({ c: li.className, t: li.textContent.trim(), busy: li.getAttribute("aria-busy"), role: li.getAttribute("role"), h: Math.round(li.getBoundingClientRect().height) })), t);
      // 1. a 3 s slow server
      await page.fill(".gpg-inp", "Vi ses vid baren");
      const ms = await msUntil(page, ".gpg-send", ".gpg-msgs > li", "Vi ses vid baren", 1500);
      const r0 = await rowsOf("Vi ses vid baren"), v0 = await page.inputValue(".gpg-inp");
      ok(`chat group: my line is on the page ${ms} ms after the tap (3 s slow server; limit 300 ms)`, ms >= 0 && ms <= 300, { ms, r0 });
      ok('chat group: it is one "sending" line (Skickar…, aria-busy), the box is empty for the next line', r0.length === 1 && /gpg-pend/.test(r0[0].c) && /Skickar…/.test(r0[0].t) && r0[0].busy === "true" && v0 === "", { r0, v0 });
      await shot(page, "chat-sending");
      await page.waitForFunction(() => { const l = [...document.querySelectorAll(".gpg-msgs > li")].filter((li) => li.textContent.indexOf("Vi ses vid baren") >= 0); return l.length === 1 && !/gpg-pend/.test(l[0].className) || l.length === 1 && /gpg-sent/.test(l[0].className); }, null, { timeout: 8000 }).catch(() => {});
      await wait(page, 1500);
      const r1 = await rowsOf("Vi ses vid baren");
      ok("chat group: after the answer there is ONE copy of the line (the real row took the place of the sending line), one post", r1.length === 1 && !/gpg-pend/.test(r1[0].c) && /\d\d:\d\d$/.test(r1[0].t) && st.posts.filter((p) => p === "Vi ses vid baren").length === 1, { r1, posts: st.posts });
      // 2. a failed send
      st.mode = "fail";
      await page.fill(".gpg-inp", "Kommer om tio");
      await page.click(".gpg-send"); await wait(page, 900);
      const f0 = await rowsOf("Kommer om tio");
      ok('chat group: a failed send stays as ONE line "Inte skickat – tryck för att försöka igen" (a 44 px button)', f0.length === 1 && /gpg-fail/.test(f0[0].c) && /Inte skickat – tryck för att försöka igen/.test(f0[0].t) && f0[0].role === "button" && f0[0].h >= 44, f0);
      await shot(page, "chat-failed");
      st.mode = "slow";
      const ms2 = await msUntil(page, ".gpg-msgs > li.gpg-fail", ".gpg-msgs > li.gpg-pend:not(.gpg-fail)", "Kommer om tio", 1500);
      ok("chat group: a tap on the failed line sends it again (a sending line at once, the chat sheet does not open)", ms2 >= 0 && ms2 <= 300 && await page.evaluate(() => !!document.querySelector(".gpg-msgs")), { ms2 });
      await wait(page, 5200);
      const f1 = await rowsOf("Kommer om tio");
      ok("chat group: the retry lands: ONE copy, 2 posts of that text in all", f1.length === 1 && !/gpg-pend/.test(f1[0].c) && st.posts.filter((p) => p === "Kommer om tio").length === 2, { f1, posts: st.posts });
      // 3. full chat: avatar target + my bubble token
      await page.evaluate((GID) => window.SOCIAL.openChat({ id: GID, name: "Ludvika Lager" }), GID); await wait(page, 1800);
      const av = await page.evaluate(() => {
        const a = document.querySelector(".chat-list .chat-msg.av-on > .av-pic"); if (!a) return null;
        const r = a.getBoundingClientRect(), s = getComputedStyle(a), me = document.querySelector(".chat-list .chat-msg.me"), l = document.querySelector(".chat-list").getBoundingClientRect();
        const at = (x, y) => { const e = document.elementFromPoint(x, y); return e && (e === a || a.contains(e)) ? true : (e ? e.tagName + "." + String(e.className).slice(0, 40) + "#" + e.id : "none"); };
        return { w: r.width, h: r.height, picW: parseFloat(s.width), picH: parseFloat(s.height), bw: s.borderTopWidth, clip: s.backgroundClip,
          edges: [at(r.left + 2, r.top + 22), at(r.right - 2, r.top + 22), at(r.left + 22, r.top + 2), at(r.left + 22, Math.min(r.bottom - 2, l.bottom - 1))], inList: r.left >= l.left - 0.5,
          meBg: me ? getComputedStyle(me).backgroundColor : "", tok: getComputedStyle(document.documentElement).getPropertyValue("--pn-chat-me").trim() };
      });
      ok(`chat fix 14: an avatar is a 44 px target (before ${BEFORE.avatar.w} px) and the picture is still 32 px`, !!av && av.w === 44 && av.h === 44 && av.picW === 32 && av.picH === 32 && av.clip === "padding-box", av);
      ok("chat fix 14: the whole 44 px square takes the tap (4 edges), nothing cut by the list", !!av && av.edges.every((x) => x === true) && av.inList, av);
      ok("chat fix 15: my bubble colour is the token --pn-chat-me (#3b3329)", !!av && av.tok.toLowerCase() === "#3b3329" && av.meBg === "rgb(59, 51, 41)", av);
      ok("chat no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- tell: the event chat line (evsheet.js "Säg till gruppen") ---------- */
    await sect("tell", async () => {
      const st = { posts: [], tells: 0, mode: "fail" };
      const { ctx, page, errs } = await open(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/events_near2/, (r) => J(r, { v: 1, server_time: new Date().toISOString(), events: [{ id: 501, title: "Pubquiz", kind: "quiz", starts_at: new Date(now + 3 * 3600e3).toISOString(), place: "Pitchers", bar_id: "n3472634175", lat: 60.14997, lng: 15.18679, town: "Ludvika" }] }));
        await page.route(/rest\/v1\/rpc\/event_go$/, (r) => J(r, { ok: true, id: 501, mine: true, n: 1, who: [{ name: "Anton", me: true }], told: false, remind: true }));
        await page.route(/rest\/v1\/rpc\/event_go_tell/, (r) => { st.tells++; return J(r, { ok: true, first: st.tells === 1 }); });
        await page.route(/rest\/v1\/rpc\/post_group_msg/, async (r) => {
          const b = JSON.parse(r.request().postData() || "{}"); st.posts.push(b);
          if (st.mode === "fail") return BAD(r);
          await new Promise((res) => setTimeout(res, 3000)); return J(r, { id: 99, created_at: new Date().toISOString() });
        });
      } });
      await page.evaluate("window.EVSHEET.open()"); await wait(page, 1500);
      await page.evaluate(() => { const r = document.querySelector(".evs-row"); if (r) r.click(); }); await wait(page, 800);
      await page.evaluate(() => { const b = document.querySelector(".evs-dgar"); if (b) b.click(); }); await wait(page, 1500);
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      ok('tell setup: "Säg till gruppen?" with my groups is in the event detail', await page.evaluate(() => document.querySelectorAll(".evs-tell .evs-tell-g").length >= 1));
      const row = () => page.evaluate(() => [...document.querySelectorAll(".evs-tell-msg")].map((e) => ({ c: e.className, t: e.innerText.replace(/\s*\n\s*/g, " | "), busy: e.getAttribute("aria-busy"), role: e.getAttribute("role"), h: Math.round(e.getBoundingClientRect().height) })));
      // 1. the post fails
      const ms = await msUntil(page, ".evs-tell .evs-tell-g", ".evs-tell-msg", "Pubquiz", 1500);
      ok(`tell event: the line to the group is on the page ${ms} ms after the tap (limit 300 ms)`, ms >= 0 && ms <= 300, { ms });
      await wait(page, 1500);
      const f0 = await row();
      ok('tell event: a failed post stays as ONE line "Inte skickat – tryck för att försöka igen" (a 44 px button)', f0.length === 1 && /evs-tell-fail/.test(f0[0].c) && /Inte skickat – tryck för att försöka igen/.test(f0[0].t) && f0[0].role === "button" && f0[0].h >= 44, f0);
      await shot(page, "tell-failed");
      // 2. the retry: a 3 s slow server
      st.mode = "slow";
      await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      const ms2 = await msUntil(page, ".evs-tell-fail", '.evs-tell-msg[aria-busy="true"]', "Skickar…", 1500);
      const s0 = await row();
      ok(`tell event: a tap sends it again: "Skickar…" ${ms2} ms after the tap (3 s slow server; limit 300 ms)`, ms2 >= 0 && ms2 <= 300 && s0.length === 1 && s0[0].busy === "true", { ms2, s0 });
      await shot(page, "tell-sending");
      await wait(page, 4200);
      const s1 = await row();
      ok('tell event: after the answer ONE line "Skickat" (no 2nd copy), 2 posts of the same text, event_go_tell asked once', s1.length === 1 && /evs-tell-ok/.test(s1[0].c) && /Skickat/.test(s1[0].t) && st.posts.length === 2 && st.posts[0].p_body === st.posts[1].p_body && st.posts[0].p_group_id === GID && st.tells === 1, { s1, n: st.posts.length, tells: st.tells });
      ok("tell event: the text that was sent is the line on the page", s1.length === 1 && s1[0].t.indexOf(st.posts[0].p_body) >= 0, { s1, body: st.posts[0] && st.posts[0].p_body });
      ok("tell no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- empty: design 09 + small fixes 7, 8 ---------- */
    await sect("empty", async () => {
      const { ctx, page, errs } = await open(browser, { empty: true });
      // what one empty state must be: 1 visible card, 1 sentence (b), 1 help line, 1 button, and no disabled / single-choice control near it
      const look = (page, root) => page.evaluate((root) => {
        const V = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden";
        const r = document.querySelector(root), cards = r ? [...r.querySelectorAll(".ds-estate")].filter(V) : [], c = cards[0];
        return { cards: cards.length, b: c ? [...c.querySelectorAll(":scope > b")].map((x) => x.textContent) : [], p: c ? [...c.querySelectorAll(":scope > p")].map((x) => x.textContent) : [],
          btns: c ? [...c.querySelectorAll("button")].filter(V).map((x) => ({ t: x.textContent.trim(), h: Math.round(x.getBoundingClientRect().height), dis: x.disabled })) : [],
          disabled: r ? [...r.querySelectorAll("button:disabled, input:disabled, [aria-disabled='true']")].filter(V).map((x) => x.className + ":" + x.textContent.trim().slice(0, 20)) : [],
          dashed: r ? [...r.querySelectorAll(".ds-empty, li.muted, .top-empty, .evs-empty:not(.ds-estate), .ib-empty:not(.ds-estate)")].filter(V).map((x) => x.textContent.trim().slice(0, 40)) : [],
          emoji: c ? /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.innerText) : null };
      }, root);
      // Event
      await page.evaluate("window.EVSHEET.open()"); await wait(page, 1500);
      const ev = await look(page, "#sheet-body");
      const evx = await page.evaluate(() => { const V = (e) => !!e && e.getClientRects().length > 0; return { chips: [...document.querySelectorAll("#sheet-body .evs-chip")].filter(V).length, sw: [...document.querySelectorAll("#sheet-body .evs-maptg")].filter(V).length,
        tips: [...document.querySelectorAll("#sheet-body button")].filter((b) => V(b) && /Tipsa om ett event/.test(b.textContent)).length, seg: [...document.querySelectorAll("#sheet-body .evs-time button")].filter(V).length }; });
      ok('empty Event: ONE card, one sentence "Inga event den närmaste månaden" (fixD P-21: nothing in 31 days is said at once), one help line, one button, no emoji', ev.cards === 1 && ev.b.length === 1 && ev.b[0] === "Inga event den närmaste månaden" && ev.p.length === 1 && ev.btns.length === 1 && ev.btns[0].h >= 44 && ev.emoji === false, ev);
      ok('empty Event fix 7: no single "Alla" chip, no disabled "Visa på kartan" switch, no disabled control, no dashed joke box, ONE "Tipsa" button', evx.chips === 0 && evx.sw === 0 && ev.disabled.length === 0 && ev.dashed.length === 0 && evx.tips === 1 && evx.seg === 4, { evx, ev });
      const tipN = await page.evaluate(() => { let n = 0; const k = window.EVENTS.tip; window.EVENTS.tip = function () { n++; }; document.querySelector("#sheet-body .ds-estate button").click(); window.EVENTS.tip = k; return n; });
      ok("empty Event: the button works (opens the tip form: EVENTS.tip)", tipN === 1, tipN);
      await page.evaluate(() => document.querySelector('#sheet-body .evs-time button[data-t="weekend"]').click()); await wait(page, 500);
      // fixD P-21: the whole month is empty, so every tab says so (was: "Inga event i helgen", then the user tapped on)
      ok('empty Event: an empty month says "den närmaste månaden" on the Helgen tab too', (await look(page, "#sheet-body")).b[0] === "Inga event den närmaste månaden");
      await shot(page, "empty-event");
      await closeAll(page);
      // Inkorg
      await clickJS(page, "#btn-groups"); await wait(page, 900); await tab(page, "Inkorg"); await wait(page, 1200);
      const ib = await look(page, "#inv-pane-i");
      const ibTxt = await page.evaluate(() => document.getElementById("inv-pane-i").innerText.replace(/\s*\n\s*/g, " | "));
      ok('empty Inkorg: ONE card, one sentence "Inget väntar på dig", one help line, one button, no emoji, no other text', ib.cards === 1 && ib.b[0] === "Inget väntar på dig" && ib.p.length === 1 && ib.btns.length === 1 && ib.btns[0].h >= 44 && ib.emoji === false && ib.disabled.length === 0 && ib.dashed.length === 0 && /^Inget väntar på dig \| /.test(ibTxt), { ib, ibTxt });
      await shot(page, "empty-inbox");
      await page.evaluate(() => document.querySelector("#inv-pane-i .ds-estate button").click()); await wait(page, 1200);
      ok('empty Inkorg: the button works (opens "Bjud in")', await page.evaluate(() => /Bjud in/.test(document.getElementById("sheet-title").textContent) && !!document.querySelector("#sheet-body .inv-form .inv-send")));
      await closeAll(page);
      // Topplistor
      await clickJS(page, "#btn-top"); await wait(page, 1500);
      const tp = await look(page, "#sheet-body");
      const tpx = await page.evaluate(() => { const V = (e) => !!e && e.getClientRects().length > 0; return { title: document.getElementById("sheet-title").textContent.trim(), tabs: [...document.querySelectorAll("#sheet-body .tt-bar button")].filter(V).map((b) => b.textContent.trim()),
        old: [...document.querySelectorAll("#sheet-body > ol.toplist > li.top-empty, #sheet-body > .top-note")].filter(V).length, first: (document.querySelector("#sheet-body > .tt-bar ~ *:not([hidden])") || {}).className }; });
      ok(`empty Topplistor fix 8: the first tab is "Krogar" (before "${BEFORE.topTabs[0]}" under the title "Topplistor")`, tpx.title === "Topplistor" && tpx.tabs[0] === "Krogar" && tpx.tabs.indexOf("Topplistor") < 0, tpx);
      ok("empty Topplistor: the bar list is ONE card, one sentence, one help line, one button (no dashed box, no extra note)", tp.cards === 1 && tp.b.length === 1 && /Ingen krog på listan än/.test(tp.b[0]) && tp.p.length === 1 && tp.btns.length === 1 && tp.btns[0].h >= 44 && tp.emoji === false && tpx.old === 0 && tp.disabled.length === 0, { tp, tpx });
      await shot(page, "empty-top");
      const nearN = await page.evaluate(() => { let n = 0; const N = window.NEARPLACES, k = N && N.open; if (N) N.open = function () { n++; }; document.querySelector("#sheet-body .ds-estate button").click(); if (N) N.open = k; return N ? n : -1; });
      ok("empty Topplistor: the button works (opens Ställen nära dig; no NEARPLACES = it closes the sheet)", nearN === 1 || (nearN === -1 && await page.evaluate(() => document.getElementById("sheet").hidden)), nearN);
      await page.evaluate(() => { const b = document.querySelector('#sheet-body .tt-bar [data-t="mer"]'); if (b && !b.hidden) b.click(); }); await wait(page, 500);
      ok("empty Topplistor: the card belongs to the Krogar tab (hidden on Meriter)", await page.evaluate(() => { const c = document.querySelector("#sheet-body .bd-none"); return !!c && c.getClientRects().length === 0; }));
      ok("empty no page errors", errs.length === 0, errs);
      await ctx.close();
      // with data: no empty state, the controls are back
      const d = await open(browser);
      await clickJS(d.page, "#btn-top"); await wait(d.page, 1500);
      ok("Topplistor with bars: the list shows, no empty card, tab Krogar", await d.page.evaluate(() => !document.querySelector("#sheet-body .bd-none") && document.querySelectorAll("#sheet-body > ol.toplist .top-row").length > 0 && document.querySelector('#sheet-body .tt-bar [data-t="top"]').textContent === "Krogar"));
      await d.ctx.close();
    });

    /* ---------- van: design 10 Vänner ---------- */
    await sect("van", async () => {
      const { ctx, page, errs } = await open(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/my_friends/, (r) => J(r, { code: "K7Q2MXA", friends: FRIENDS, incoming: [], outgoing: [] }));
        await page.route(/rest\/v1\/rpc\/friend_list/, (r) => J(r, { v: 1, people: PEOPLE, groups: [{ id: GID, name: "Ludvika Lager" }] }));
      } });
      await clickJS(page, "#btn-groups"); await wait(page, 900); await tab(page, "Vänner"); await wait(page, 2600);
      const rows = () => page.evaluate(() => [...document.querySelectorAll("#inv-pane-f .nr-flist > .nr-frow")].map((li) => {
        const V = (e) => !!e && e.getClientRects().length > 0, b = li.querySelector(".nr-fmain > b"), info = li.querySelector(".nr-finfo") || li.querySelector(".nr-fmain small"), r = li.getBoundingClientRect();
        return { n: b.textContent, h: Math.round(r.height), out: li.classList.contains("out"), nameLines: Math.round(b.getBoundingClientRect().height / 22), nameCut: b.scrollHeight > b.clientHeight + 1,
          info: info ? info.textContent : "", infoLines: info ? Math.round(info.getBoundingClientRect().height / 20) : 0, av: !!li.querySelector(":scope > .av"),
          btns: [...li.querySelectorAll("button")].filter(V).map((x) => ({ c: x.className.replace(/\bbtn(-small|-ghost)?\b/g, "").trim(), w: Math.round(x.getBoundingClientRect().width), h: Math.round(x.getBoundingClientRect().height), right: Math.round(r.right - x.getBoundingClientRect().right), t: x.textContent.trim() })),
          stGreen: li.querySelector(".nr-st") ? getComputedStyle(li.querySelector(".nr-st")).color : "", emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(li.innerText) };
      }));
      const R = await rows(), short = R.filter((x) => x.nameLines === 1);
      ok("van fix 27: friends who are out come first (Oskar, Ida), then the others in the server order (Lisa, Maximilian)", R.map((x) => x.n.split(" ")[0]).join(",") === "Oskar,Ida,Lisa,Maximilian" && R[0].out && R[1].out && !R[2].out, R.map((x) => x.n + ":" + x.out));
      ok(`van one friend = one 64 px row (± 2; before ${BEFORE.vannerRowH.join(" / ")} px)`, short.length === 3 && short.every((x) => Math.abs(x.h - 64) <= 2), R.map((x) => x.n + ":" + x.h));
      ok("van a long name keeps its words on 2 lines (not cut), the row is still under 90 px", R[3].nameLines === 2 && !R[3].nameCut && R[3].h <= 90, R[3]);
      ok("van each row: an avatar, ONE status line (the state first), no emoji", R.every((x) => x.av && x.infoLines === 1 && !x.emoji) && /^Ute ikväll i Ludvika · Göteborgare/.test(R[0].info) && /^Int' ute · /.test(R[2].info), R.map((x) => x.info + " (" + x.infoLines + ")"));
      ok("van each row shows Hitta + ⋯ at the right (2 buttons, 44 px), nothing under the name", R.every((x) => x.btns.length === 2 && /nr-find-b/.test(x.btns[0].c) && /nr-more-b/.test(x.btns[1].c) && x.btns.every((b) => b.w >= 44 && b.h >= 44)), R.map((x) => x.btns));
      await shot(page, "vanner");
      // ⋯ = the row opens: Skriv + Bjud in (with words) and Ta bort vän / Blockera
      await page.evaluate(() => { const r = [...document.querySelectorAll(".nr-flist .nr-frow")].find((x) => /Oskar/.test(x.textContent)); r.querySelector(".nr-more-b").click(); }); await wait(page, 600);
      const m = await page.evaluate(() => { const V = (e) => !!e && e.getClientRects().length > 0, r = [...document.querySelectorAll(".nr-flist .nr-frow")].find((x) => /Oskar/.test(x.textContent));
        const xa = [...r.querySelectorAll(".nr-xacts button")].filter(V).map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), c: b.className }));
        const menu = r.nextElementSibling && r.nextElementSibling.classList.contains("f2-menu") ? [...r.nextElementSibling.querySelectorAll("button")].map((b) => b.textContent.trim()) : null;
        const others = [...document.querySelectorAll(".nr-flist .nr-frow .nr-xacts button")].filter((b) => V(b) && !r.contains(b)).length;
        return { xa, menu, others, right: Math.max(...[...r.querySelectorAll("button")].filter(V).map((b) => b.getBoundingClientRect().right)), vw: innerWidth }; });
      ok('van ⋯ opens the row: "Skriv" + "Bjud in" (44 px, with words), then Ta bort vän / Blockera; only in that row; inside the screen', m.xa.length === 2 && /dm-fb/.test(m.xa[0].c) && /Skriv/.test(m.xa[0].t) && /inv-fb/.test(m.xa[1].c) && /Bjud in/.test(m.xa[1].t) && m.xa.every((b) => b.h >= 44) && !!m.menu && m.menu.includes("Ta bort vän") && m.others === 0 && m.right <= m.vw, m);
      await shot(page, "vanner-open");
      const inv = await page.evaluate(() => { const r = [...document.querySelectorAll(".nr-flist .nr-frow")].find((x) => /Oskar/.test(x.textContent)); r.querySelector(".nr-xacts .inv-fb").click(); return true; });
      await wait(page, 1200);
      ok('van "Bjud in" in the open row opens the invite form with that friend chosen', inv && await page.evaluate(() => { const c = [...document.querySelectorAll("#sheet-body .inv-form .inv-pk-row")].find((x) => /Oskar/.test(x.textContent)); return !!c && c.querySelector("input").checked; }));
      await closeAll(page);
      await clickJS(page, "#btn-groups"); await wait(page, 900); await tab(page, "Vänner"); await wait(page, 2000);
      const sh = await page.evaluate(() => { const s = document.querySelector("#inv-pane-f .nr-share"), l = document.querySelector("#inv-pane-f .nr-flist"), cs = getComputedStyle(s), sw = [...s.querySelectorAll(".switch")];
        return { after: !!(l.compareDocumentPosition(s) & 4), radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth, bg: cs.backgroundColor, listBg: getComputedStyle(l).backgroundColor, h3: s.querySelector("h3").textContent, sw: sw.length,
          rows: [...s.querySelectorAll(".toggle-row")].map((r) => Math.round(r.getBoundingClientRect().height)), swDis: sw.some((x) => x.disabled) }; });
      ok('van "Låt mig hittas ikväll" is a card (same look as the friends list) with 2 switch rows of >= 56 px, no emoji in its title', sh.radius === "16px" && sh.bw === "1px" && sh.bg === sh.listBg && sh.sw === 2 && sh.rows.every((h) => h >= 56) && sh.h3 === "Låt mig hittas ikväll" && !sh.swDis, sh);
      await page.evaluate(() => document.querySelector("#inv-pane-f .nr-share .switch").click()); await wait(page, 800);
      ok("van the switch in the card still works (set_find_share → on)", await page.evaluate(() => document.querySelector("#inv-pane-f .nr-share .switch").getAttribute("aria-checked") === "true"));
      ok("van no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- inv: design 11 Bjud in ---------- */
    await sect("inv", async () => {
      let body = null;
      const { ctx, page, errs } = await open(browser, { routes: async (page) => {
        await page.route(/rest\/v1\/rpc\/friend_list/, (r) => J(r, { v: 1, people: PEOPLE, groups: [{ id: GID, name: "Ludvika Lager" }] }));
        await page.route(/rest\/v1\/rpc\/invite_create/, (r) => { body = JSON.parse(r.request().postData() || "{}"); return J(r, { id: 5, title: body.p_title, starts_at: body.p_starts_at, added: 1, mine: true, live: true, people: [] }); });
      } });
      const openForm = async () => { await closeAll(page); await page.evaluate("window.INVITE.openCreate({})"); await wait(page, 1500); };
      await openForm();
      const f = await page.evaluate((EM) => {
        const re = new RegExp(EM, "u"), F = document.querySelector("#sheet-body .inv-form"), V = (e) => !!e && e.getClientRects().length > 0;
        const lab = [...F.querySelectorAll(".ev-l, .inv-pk-head > b")].filter(V).map((l) => { const s = getComputedStyle(l); return { t: l.textContent, st: s.fontSize + "/" + s.fontWeight + "/" + s.color }; });
        const chips = [...F.querySelectorAll(".inv-wq button")].map((b) => ({ t: b.textContent, k: b.getAttribute("data-w"), on: b.getAttribute("aria-checked"), role: b.getAttribute("role"), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), cut: b.scrollWidth > b.clientWidth + 1 }));
        return { fields: [...F.querySelectorAll("input, select, textarea")].map((i) => (i.value || "") + "|" + (i.placeholder || "")).concat([...F.querySelectorAll("option")].map((o) => o.textContent)), emoji: [...F.querySelectorAll("input, select, textarea")].some((i) => re.test(i.value || "") || re.test(i.placeholder || "")) || [...F.querySelectorAll("option")].some((o) => re.test(o.textContent)),
          title: F.querySelector(".inv-title").value, lab, chips, when: F.querySelector("input[type=datetime-local]").value, whenVis: V(F.querySelector("input[type=datetime-local]")), hour: new Date().getHours() };
      }, EMOJI);
      ok('inv no emoji inside a field (title "Öl", place choices, placeholders)', f.emoji === false && f.title === "Öl", f.fields);
      ok("inv ONE label style for Vad? / När? / Var? / Meddelande / Vem bjuder du in?", f.lab.length === 5 && new Set(f.lab.map((l) => l.st)).size === 1, f.lab);
      const names = f.chips.map((c) => c.t).join(" | "), hasEve = f.hour < 20;
      ok('inv "När?" = quick choices Nu · Om 30 min · Ikväll 20 · Välj tid (44 px, no label cut; "Ikväll 20" only before 20:00)', names === (hasEve ? "Nu | Om 30 min | Ikväll 20 | Välj tid" : "Nu | Om 30 min | Välj tid") && f.chips.every((c) => c.h >= 44 && !c.cut && c.role === "radio"), f.chips);
      ok("inv exactly one choice is marked at the start, and the raw time field shows only with Välj tid", f.chips.filter((c) => c.on === "true").length === 1 && f.whenVis === (f.chips.find((c) => c.on === "true").k === "pick"), { chips: f.chips, whenVis: f.whenVis });
      // each quick choice: the payload is the old one (fixture) + the right time
      const send = async (k) => {
        await openForm(); body = null;
        await page.evaluate(() => { const c = [...document.querySelectorAll("#sheet-body .inv-pk-row")].find((x) => /Lisa/.test(x.textContent)); c.querySelector("input").click(); });
        const has = await page.evaluate((k) => {
          const F = document.querySelector("#sheet-body .inv-form"), b = F.querySelector('.inv-wq button[data-w="' + k + '"]'); if (!b) return false;
          b.click();
          if (k === "pick") { const w = F.querySelector("input[type=datetime-local]"); w.value = "2026-11-20T21:15"; w.dispatchEvent(new Event("input", { bubbles: true })); w.dispatchEvent(new Event("change", { bubbles: true })); }
          return true;
        }, k);
        if (!has) return null;
        await wait(page, 450);   // the segment's colour change is a 200 ms transition
        const mark = await page.evaluate((k) => {
          const F = document.querySelector("#sheet-body .inv-form"), b = F.querySelector('.inv-wq button[data-w="' + k + '"]');
          const all = [...F.querySelectorAll(".inv-wq button")], bg = (x) => getComputedStyle(x).backgroundColor, col = (x) => getComputedStyle(x).color, other = all.find((x) => x !== b);
          return { on: all.filter((x) => x.getAttribute("aria-checked") === "true").map((x) => x.getAttribute("data-w")), bgDiff: bg(b) !== bg(other), colDiff: col(b) !== col(other), fieldVis: F.querySelector("input[type=datetime-local]").getClientRects().length > 0,
            pickIso: new Date("2026-11-20T21:15").toISOString(), eveIso: (() => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.toISOString(); })() };
        }, k);
        const t0 = Date.now();
        await page.evaluate(() => document.querySelector("#sheet-body .inv-send").click()); await wait(page, 2500);
        return { mark, body, t0 };
      };
      const same = (b) => !!b && Object.keys(BEFORE.invitePayload).every((key) => JSON.stringify(b[key]) === JSON.stringify(BEFORE.invitePayload[key])) && Object.keys(b).sort().join() === Object.keys(BEFORE.invitePayload).concat("p_starts_at").sort().join();
      for (const k of ["now", "30", "eve", "pick"]) {
        const r = await send(k);
        if (!r) { ok(`inv choice "${k}": not shown (20:00 has passed)`, k === "eve" && !hasEve); continue; }
        const at = r.body ? Date.parse(r.body.p_starts_at) : NaN;
        const timeOk = k === "now" ? Math.abs(at - r.t0) <= 90e3 : k === "30" ? Math.abs(at - (r.t0 + 30 * 60e3)) <= 90e3 : k === "eve" ? r.body.p_starts_at === r.mark.eveIso : r.body.p_starts_at === r.mark.pickIso;
        ok(`inv choice "${k}": it is the ONE marked choice (aria-checked, other colours), the time field shows only for Välj tid`, r.mark.on.length === 1 && r.mark.on[0] === k && r.mark.bgDiff && r.mark.colDiff && r.mark.fieldVis === (k === "pick"), r.mark);
        ok(`inv choice "${k}": invite_create gets the same payload as the old form (title with its emoji, place, keys, spot …) and the right start time`, same(r.body) && timeOk, { body: r.body, want: BEFORE.invitePayload, t0: new Date(r.t0).toISOString(), mark: r.mark });
      }
      // a friend that is chosen has a check mark
      await openForm();
      const pk = await page.evaluate(() => { const c = [...document.querySelectorAll("#sheet-body .inv-pk-row")].find((x) => /Lisa/.test(x.textContent)), i = c.querySelector("input"), a = getComputedStyle(i).backgroundImage; i.click(); const s = getComputedStyle(i);
        return { before: a, img: s.backgroundImage.slice(0, 40), bg: s.backgroundColor, w: i.getBoundingClientRect().width, rowH: Math.round(c.getBoundingClientRect().height), emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.querySelector("#sheet-body .inv-pk-list").innerText),
          send: document.querySelector("#sheet-body .inv-send").disabled }; });
      ok("inv a chosen friend has a round amber check mark (not the grey system box), rows >= 56 px, the send button is on", pk.before === "none" && /^url\(/.test(pk.img) && pk.bg === "rgb(245, 166, 35)" && pk.w === 24 && pk.rowH >= 56 && !pk.emoji && pk.send === false, pk);
      await shot(page, "bjudin");
      ok("inv no page errors", errs.length === 0, errs);
      await ctx.close();
    });

    /* ---------- join: small fix 30 ---------- */
    await sect("join", async () => {
      for (const [w, h] of [[390, 844], [360, 780]]) {
        const { ctx, page } = await ctxFor(browser, { width: w, height: h });
        await boot(page);
        await page.evaluate((GID) => window.JOIN.openGroup({ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4 }, false), GID); await wait(page, 1500);
        const j = await page.evaluate(() => { const sb = document.getElementById("sheet-body").getBoundingClientRect(), V = (e) => !!e && e.getClientRects().length > 0;
          const cut = [...document.querySelectorAll("#sheet-body .jn-inv > *")].filter(V).filter((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e), box = parseFloat(s.borderTopWidth) > 0 || (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
            return box && r.top < Math.min(sb.bottom, innerHeight) - 1 && r.bottom > Math.min(sb.bottom, innerHeight) + 1; }).map((e) => e.className);
          const how = document.querySelector("#sheet-body .jn-how"), qr = document.querySelector("#sheet-body .jn-qr"); return { cut, how: how ? how.textContent : "", qrW: qr ? Math.round(qr.getBoundingClientRect().width) : 0 }; });
        ok(`join fix 30 [${w}]: no box of the group "Bjud in" sheet is cut at the sheet edge; the hint text and the QR code are still there`, j.cut.length === 0 && /Kompisen öppnar länken/.test(j.how) && j.qrW >= 180, j);
        if (w === 390) await shot(page, "join");
        await ctx.close();
      }
    });
  } catch (e) { fail++; console.log("FAIL exception", e.stack); }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
