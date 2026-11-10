// games lane (big update, 10 Nov): GM1 host handover, GM2 only the host switches games, GM3 confirm before
// "Stäng rummet för alla", GM5 game list changes, GM6 Hemlig agent + Gissa kvällen hidden. Usage: node games2-pw.js <port>
// Server side (0440, owner-run) is tested in Postgres (scratchpad games/sql-test-0440.sql); here the client is tested
// against mocked rooms: 🎉 Spel rooms (spel_*) and 🎲 Party rooms (party_*).
const { ctxFor, boot, wait, GID } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const ERR = (r, m) => J(r, { code: "P0001", message: m, details: null, hint: null }, 400);
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 400))); c ? pass++ : fail++; };
const G = { id: GID, name: "Ludvika Lager" };
const R1 = "5e1a0000-0000-4000-8000-000000000001", P1 = "9a170000-0000-4000-8000-000000000001";
const toastSpy = () => {
  window.__toasts = [];
  const go = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
    .observe(document.getElementById("toasts"), { childList: true });
  if (document.getElementById("toasts")) go(); else document.addEventListener("DOMContentLoaded", go);
};
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const shot = (page, name) => page.screenshot({ path: SP + "ui-testshots/games2-" + name + ".png" });
const texts = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
const tapText = (page, sel, re) => page.evaluate(([s, r]) => { const e = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); if (e) e.click(); return e ? e.textContent : null; }, [sel, re]);

// 🎉 Spel room view (olnu_spel_view shape)
const P = (k, name, o = {}) => Object.assign({ k, name, score: 0, is_me: k === "me", done: false, judge: false, on: true }, o);
function sview(o = {}) {
  return Object.assign({ v: 1, now: new Date().toISOString(), id: R1, group_id: GID, game: "kort", phase: "lobby", round: 0, goal: 5, game_no: 0, pub: {}, closed: false,
    creator_k: "me", judge_on: false, me: { k: "me", name: "Anton", score: 0, status: "in", hand: [], judge: false, mine: null, can_force: false },
    players: [P("me", "Anton"), P("l", "Lisa"), P("o", "Oskar")] }, o);
}
// 🎲 Party room view (olnu_party_view shape)
const PP = (k, name, o = {}) => Object.assign({ k, name, is_host: false, status: "in", in_game: false, score: 0, wins: 0, is_me: k === "me", done: false, need: false, on: true }, o);
function pview(o = {}, me = {}) {
  return Object.assign({ v: 1, now: new Date().toISOString(), id: P1, code: "WXYZ", game: "imposter", phase: "lobby", round: 0, step: 0, game_no: 0, opts: {}, group_id: GID, closed: false,
    host_k: "me", host_name: "Anton", host_away: false,
    me: Object.assign({ k: "me", name: "Anton", is_host: true, status: "in", in_game: false, score: 0, wins: 0, can_host: true }, me),
    players: [PP("me", "Anton", { is_host: !!(me.is_host !== false) }), PP("l", "Lisa", { is_host: me.is_host === false }), PP("o", "Oskar")], pub: {} }, o);
}

async function rooms(page, S) {
  await page.route(/rest\/v1\/rpc\/(spel_group|spel_open|spel_state|spel_act|party_group|party_mine|party_state|party_act|party_create|party_join|game_poll|game_group|guess_night_kind|evg_lek)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    S.calls.push([fn, b]);
    switch (fn) {
      case "spel_group": return J(r, { room: S.liveRoom || null });
      case "spel_open": return J(r, S.openView ? S.openView(b) : sview({ game: b.p_game || "kort" }));
      case "spel_state": return J(r, S.stateView ? S.stateView(b) : { same: true, v: b.p_v });
      case "spel_act":
        if (b.p_act === "leave") return J(r, { left: true });
        if (b.p_act === "game") { S.game = b.p_val; return J(r, sview({ v: 3, game: b.p_val })); }
        return J(r, sview({ v: 2, game: S.game || "kort", pub: { cfg: b.p_data || {} } }));
      case "party_mine": return J(r, { v: 1, room: null });
      case "party_group": return J(r, { v: 1, room: S.partyRoom || null });
      case "party_state": return J(r, S.pstate ? S.pstate(b) : (b.p_v ? { same: true, v: b.p_v, host_away: false } : S.pv || pview()));
      case "party_act":
        if (b.p_act === "close") return J(r, { closed: true, v: 9, id: P1, code: "WXYZ" });
        return J(r, Object.assign({}, S.pv || pview(), { v: (b.p_act === "start" ? 5 : 2) }));
      case "party_create":
        if (S.roomExists) { S.partyRoom = { id: P1, code: "QRST", game: "imposter", phase: "lobby", n: 3, host_name: "Lisa", is_in: false, is_host: false }; return ERR(r, "room_exists"); }
        return J(r, pview());
      case "party_join": return J(r, pview({}, { is_host: false }));
      case "guess_night_kind": return J(r, "folk");   // the server counts people: the old code showed 🎲 Gissa
      case "game_poll": return J(r, { v: 1, night: iso(0).slice(0, 10), me: { out: true, guess_open: true, sugen: null, missions: [], done_n: 0,
        agent: [{ group_id: GID, group_name: "Ludvika Lager", mission: 3 }] },
        groups: [{ id: GID, name: "Ludvika Lager", sugen: [{ k: "l", name: "Lisa", status: "sugen", at: iso(2), is_me: false }],
          agent: { active: true, by: "Lisa" }, oracle: { name: "Oskar", guess: 40, real: 44, err: 0.1 } }] });
      case "game_group": return J(r, { v: 1, sugen: [{ k: "l", name: "Lisa", status: "sugen", at: iso(2) }], crawl: null,
        bingo: { card: [0, 1, 2, 3, 4, 5, 6, 7, 8], ticks: [], lines: 0 }, agent: { active: false }, agent_prev: null, members: [], points: [] });
      case "evg_lek": return J(r, { people: [], ticks: [] });
    }
    return r.fallback();
  });
}
async function open(browser, w, S, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: w, height: 844 }, o);
  await ctx.addInitScript(toastSpy);
  await rooms(page, S);
  await boot(page);
  await page.evaluate(() => { window.__toasts = []; document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
  return { ctx, page };
}
const St = (o) => Object.assign({ calls: [] }, o || {});
const spelOpen = (page, what) => page.evaluate(([g, w]) => w ? window.SPEL.play(g, w) : window.SPEL.open(g), [G, what || null]);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  try {
    /* ---------- GM5 + GM6: the 🎉 Spel list (3 widths) ---------- */
    for (const w of [360, 390, 430]) {
      const S = St();
      const { ctx, page } = await open(browser, w, S);
      await spelOpen(page); await page.waitForSelector(".sp-card[data-g]", { timeout: 20000 }).catch(() => {}); await wait(page, 800);
      const ids = await page.evaluate(() => [...document.querySelectorAll(".sp-card[data-g]")].map((c) => c.getAttribute("data-g")));
      ok(`[${w}] GM5 Spel list: no 🎡 Vem fixar nästa? (moved to the Ikväll menu)`, ids.length > 5 && ids.indexOf("spin") < 0, ids);
      ok(`[${w}] GM5 Spel list: no ⚔️ Gängkamp (moved to the group page)`, ids.length > 5 && ids.indexOf("duel") < 0, ids);
      const lek = await page.evaluate(() => (document.querySelector('.sp-card[data-g="lek"] .sp-card-s') || {}).textContent || "");
      ok(`[${w}] GM6 Kvällens lekar text: no hemlig agent / oraklet`, !!lek && !/agent|orakel/i.test(lek), lek);
      const sv = await page.evaluate(() => (document.querySelector('.sp-card[data-g="survivor"] .sp-card-s') || {}).textContent || "");
      ok(`[${w}] GM5 Östra lägret: short text in the list (≤ 45 chars)`, !!sv && sv.length <= 45, sv);
      const hat = await page.evaluate(() => (document.querySelector('.sp-card[data-g="hatten"] .sp-card-s') || {}).textContent || "");
      ok(`[${w}] GM5 Namn i hatten: written answers in the list text`, /påhitta|skriver/i.test(hat), hat);
      await shot(page, "hub-" + w);
      await ctx.close();
    }

    /* ---------- GM5: Vem fixar nästa? + Gängkamp APIs for the Ikväll menu / group page ---------- */
    {
      const S = St();
      const { ctx, page } = await open(browser, 390, S);
      const api = await page.evaluate(() => {
        const G2 = window.GAMES || {}, spins = [], duels = [];
        if (window.RUNDAN) { const o = window.RUNDAN.openSpin; window.RUNDAN.openSpin = function (g) { spins.push(g && g.id); }; window.__spinOrig = o; }
        if (window.DUEL) window.DUEL.open = function (g) { duels.push(g && g.id); };
        window.__spins = spins; window.__duels = duels;
        const rows = typeof G2.menuRows === "function" ? G2.menuRows(function (icon, title, sub, fn) { const b = document.createElement("button"); b.textContent = title; b.dataset.icon = icon; b.onclick = fn; return b; }, function () { window.__menuClosed = 1; }) : null;
        if (typeof G2.openGangkamp === "function") G2.openGangkamp({ id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" });
        return { vf: typeof G2.openVemFixar, rows: rows ? rows.map((b) => [b.textContent, b.dataset.icon]) : null, duels };
      });
      ok("GM5 GAMES.openVemFixar is a function", api.vf === "function", api);
      ok("GM5 GAMES.menuRows(row, close) gives one 'Vem fixar nästa?' row (PNI icon game)", !!api.rows && api.rows.length === 1 && /Vem fixar/.test(api.rows[0][0]) && api.rows[0][1] === "game", api.rows);
      ok("GM5 GAMES.openGangkamp(g) opens ⚔️ Gängkamp (DUEL.open) for that group", JSON.stringify(api.duels) === JSON.stringify([GID]), api.duels);
      await page.evaluate(() => { const b = document.createElement("div"); b.id = "gm-test-row"; document.body.appendChild(b); });
      await page.evaluate(() => window.GAMES && window.GAMES.openVemFixar && window.GAMES.openVemFixar()); await wait(page, 1200);
      const pick = await texts(page, "#sheet-body .gm-vfg");
      ok("GM5 Vem fixar from the Ikväll menu: 2 groups → a group picker", pick.length === 2 && /Ludvika Lager/.test(pick[0]), pick);
      await shot(page, "vemfixar-pick-390");
      await page.evaluate(() => { const b = document.querySelector("#sheet-body .gm-vfg"); if (b) b.click(); }); await wait(page, 500);
      ok("GM5 tap a group → the 🎡 spin opens for it (RUNDAN.openSpin)", await page.evaluate((gid) => (window.__spins || []).indexOf(gid) >= 0, GID), await page.evaluate(() => window.__spins));
      await ctx.close();
    }

    /* ---------- GM5 + GM6: Kvällens lekar sheets (games.js) ---------- */
    for (const w of [390]) {
      const S = St();
      const { ctx, page } = await open(browser, w, S);
      await page.waitForFunction(() => window.GAMES && window.GAMES.state() === "on", null, { timeout: 15000 }).catch(() => {});
      await page.evaluate((g) => window.GAMES.openGroup(g), G); await wait(page, 1200);
      const tabs = await texts(page, ".gm-tab");
      ok(`[${w}] GM5 Lek tabs: no 🙋 Sugen`, tabs.length > 0 && !tabs.some((t) => /Sugen/.test(t)), tabs);
      ok(`[${w}] GM6 Lek tabs: no 🕵️ Agent, no 🎲 Gissa (even when the server counts people)`, tabs.length > 0 && !tabs.some((t) => /Agent|Gissa/.test(t)), tabs);
      ok(`[${w}] Lek tabs: Runda + Bingo stay`, tabs.some((t) => /Runda/.test(t)) && tabs.some((t) => /Bingo/.test(t)), tabs);
      await shot(page, "lek-group-" + w);
      await page.evaluate(() => window.GAMES.openMe()); await wait(page, 1000);
      const heads = await texts(page, "#sheet-body .gm h3");
      ok(`[${w}] GM5/GM6 my missions sheet: no Sugen, no Gissa kvällen`, heads.length > 0 && !heads.some((t) => /Sugen|Gissa/.test(t)), heads);
      const ts = await toasts(page);
      ok(`[${w}] GM5/GM6 no Sugen / agent / oracle toasts`, !ts.some((t) => /sugen|agent|orakel|Gissa/i.test(t)), ts);
      await ctx.close();
    }

    /* ---------- GM2: the hub never switches a live room that I do not host ---------- */
    {
      const S = St({ liveRoom: { id: R1, game: "kort", phase: "lobby", round: 0, n: 2, names: ["Lisa", "Oskar"], is_in: true } });
      const { ctx, page } = await open(browser, 390, S);
      await spelOpen(page); await page.waitForSelector('.sp-card[data-g="vem"]', { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
      await page.evaluate(() => { const b = document.querySelector('.sp-card[data-g="vem"]'); if (b) b.click(); }); await wait(page, 1500);
      const sw = S.calls.filter((c) => c[0] === "spel_open" && c[1].p_game === "vem");
      ok("GM2 hub: tapping another game does not switch the live room (no spel_open p_game)", sw.length === 0, sw);
      const ask = await page.evaluate(() => { const a = document.querySelector(".sp-ask"); return a ? { t: a.textContent, b: [...a.querySelectorAll("button")].map((x) => x.textContent) } : null; });
      ok("GM2 hub: the 'already running' box offers HOPPA IN, no 'Byt till … för alla'", !!ask && ask.b.some((t) => /HOPPA IN/.test(t)) && !ask.b.some((t) => /Byt till/.test(t)), ask);
      ok("GM2 hub: the box says only the host switches", !!ask && /Bara värden/.test(ask.t), ask && ask.t);
      await shot(page, "hub-onlyhost-390");
      await ctx.close();
    }

    /* ---------- GM2: the host switches in the room (no leave); GM2: a refused switch says why ---------- */
    for (const w of [390]) {
      const S = St();
      const { ctx, page } = await open(browser, w, S);
      await spelOpen(page, "kort"); await page.waitForSelector(".sp-room .sp-foot", { timeout: 20000 }).catch(() => {}); await wait(page, 1200);
      const sw = await tapText(page, ".sp-foot button", "Byt spel"); await wait(page, 700);
      const box = await texts(page, ".sp-swbox button");
      ok(`[${w}] GM2 host: ↔ Byt spel opens a picker in the room`, !!sw && box.some((t) => /Vem i gänget/.test(t)) && !box.some((t) => /Skämskort/.test(t)), { sw, box });
      ok(`[${w}] GM2 host: opening the picker does not leave the room`, !S.calls.some((c) => c[0] === "spel_act" && c[1].p_act === "leave"), S.calls.filter((c) => c[0] === "spel_act"));
      if (w === 390) await shot(page, "switch-box-390");
      await tapText(page, ".sp-swbox button", "Vem i gänget"); await wait(page, 1200);
      const act = S.calls.filter((c) => c[0] === "spel_act" && c[1].p_act === "game");
      ok(`[${w}] GM2 host: picking 👉 Vem i gänget? = spel_act game for the room`, act.length === 1 && act[0][1].p_val === "vem" && act[0][1].p_room === R1, act);
      ok(`[${w}] GM2 host: the room shows the new game`, await page.evaluate(() => /Vem i gänget/.test((document.querySelector(".sp-top") || {}).textContent || "")));
      await ctx.close();
    }
    {
      const S = St({ openView: (b) => sview({ game: "kort", creator_k: "l" }) });   // 0440: the server kept Lisa's game
      const { ctx, page } = await open(browser, 390, S);
      await spelOpen(page, "vem"); await wait(page, 2500);
      const ts = await toasts(page);
      ok("GM2 the server kept the host's game → toast 'Bara värden (Lisa) byter spel'", ts.some((t) => /Bara värden \(Lisa\)/.test(t)), ts);
      ok("GM2 a guest sees no ↔ Byt spel", !(await texts(page, ".sp-foot button")).some((t) => /Byt spel/.test(t)));
      await ctx.close();
    }

    /* ---------- GM1: 🎉 Spel host handover → the next player is told ---------- */
    for (const w of [390]) {
      const S = St({ openView: () => sview({ creator_k: "l" }) });
      const { ctx, page } = await open(browser, w, S);
      await spelOpen(page, "kort"); await page.waitForSelector(".sp-room", { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
      ok(`[${w}] GM1 guest lobby first (Lisa hosts)`, await page.evaluate(() => /Väntar på värden \(Lisa\)/.test((document.querySelector(".sp-foot") || {}).textContent || "")));
      S.stateView = () => sview({ v: 2, creator_k: "me", players: [P("me", "Anton"), P("o", "Oskar")] });   // Lisa left; 0440 moved the host to me
      await wait(page, 3500);
      const ts = await toasts(page);
      ok(`[${w}] GM1 toast '👑 Du ä värd nu'`, ts.some((t) => /Du ä värd nu/.test(t)), ts);
      ok(`[${w}] GM1 I get the host lobby (▶ STARTA)`, (await texts(page, ".sp-foot button")).some((t) => /STARTA/.test(t)));
      await shot(page, "spel-host-toast-" + w);
      await ctx.close();
    }

    /* ---------- GM3: confirm before "Stäng rummet för alla" (3 widths) ---------- */
    for (const w of [360, 390, 430]) {
      const S = St();
      const { ctx, page } = await open(browser, w, S);
      await page.evaluate((id) => window.PARTY.open({ room: id }), P1); await page.waitForSelector(".pt-top", { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
      await tapText(page, ".pt-top button", "Meny"); await wait(page, 400);
      const hit = await tapText(page, ".pt-menu button", "Stäng rummet för alla"); await wait(page, 700);
      const closes = () => S.calls.filter((c) => c[0] === "party_act" && c[1].p_act === "close").length;
      ok(`[${w}] GM3 Stäng rummet för alla → a confirm box first`, !!hit && await page.evaluate(() => !!document.querySelector(".pt-ask") && /Stäng rummet för alla\?/.test(document.querySelector(".pt-ask").textContent)), hit);
      ok(`[${w}] GM3 nothing closed before the confirm`, closes() === 0, closes());
      await wait(page, 1500);   // a poll redraw must keep the box
      ok(`[${w}] GM3 the box survives a poll`, await page.evaluate(() => !!document.querySelector(".pt-ask")));
      await shot(page, "party-close-ask-" + w);
      await tapText(page, ".pt-ask button", "Stanna kvar"); await wait(page, 500);
      ok(`[${w}] GM3 Stanna kvar = no close, box gone`, closes() === 0 && await page.evaluate(() => !document.querySelector(".pt-ask")));
      await tapText(page, ".pt-top button", "Meny"); await wait(page, 300);
      await tapText(page, ".pt-menu button", "Stäng rummet för alla"); await wait(page, 500);
      await tapText(page, ".pt-ask button", "Stäng för alla"); await wait(page, 1000);
      ok(`[${w}] GM3 confirm → party_act close once`, closes() === 1, closes());
      await ctx.close();
    }

    /* ---------- GM1: 🎲 party host handover toast; no second room for a group ---------- */
    for (const w of [390]) {
      const S = St({ pv: pview({ host_k: "l", host_name: "Lisa" }, { is_host: false, can_host: false }) });
      const { ctx, page } = await open(browser, w, S);
      await page.evaluate((id) => window.PARTY.open({ room: id }), P1); await page.waitForSelector(".pt-top", { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
      S.pstate = () => pview({ v: 4, host_k: "me", host_name: "Anton" });   // 0440: Lisa went quiet, I am next
      await wait(page, 2500);
      const ts = await toasts(page);
      ok(`[${w}] GM1 party: toast '👑 Du ä värd nu' when the host moves to me`, ts.some((t) => /Du ä värd nu/.test(t)), ts);
      ok(`[${w}] GM1 party: my phone shows the host screen (room code + START)`, await page.evaluate(() => !!document.querySelector(".pt-bigcode")));
      await shot(page, "party-host-toast-" + w);
      await ctx.close();
    }
    for (const w of [360, 390, 430]) {
      const S = St({ partyRoom: { id: P1, code: "WXYZ", game: "imposter", phase: "lobby", n: 3, host_name: "Lisa", is_in: false, is_host: false } });
      const { ctx, page } = await open(browser, w, S);
      await page.evaluate((g) => window.PARTY.open({ group: g }), G); await page.waitForSelector(".pt-hero", { timeout: 20000 }).catch(() => {}); await wait(page, 1200);
      const bs = await texts(page, "#pt button");
      ok(`[${w}] GM1 party: the group has a room → GÅ MED I WXYZ, no 'Skapa rum' (no second room)`, bs.some((t) => /GÅ MED I WXYZ/.test(t)) && !bs.some((t) => /Skapa rum/.test(t)), bs);
      await shot(page, "party-oneroom-" + w);
      await ctx.close();
    }
    {
      const S = St({ roomExists: true });
      const { ctx, page } = await open(browser, 390, S);
      await page.evaluate((g) => window.PARTY.open({ group: g }), G); await page.waitForSelector(".pt-hero", { timeout: 20000 }).catch(() => {}); await wait(page, 1200);
      await tapText(page, "#pt button", "Skapa rum"); await wait(page, 3000);
      const ts = await toasts(page), bs = await texts(page, "#pt button");
      ok("GM1 party: room_exists (0440) → 'Gänget har redan ett rum' + join with its code", ts.some((t) => /redan ett rum/.test(t)) && bs.some((t) => /GÅ MED I QRST/.test(t)), { ts, bs });
      await ctx.close();
    }

    /* ---------- GM5: Namn i hatten = written answers only; Östra lägret short ---------- */
    {
      const S = St({ pv: pview({ game: "hatten" }) });
      const { ctx, page } = await open(browser, 390, S);
      await page.evaluate((id) => window.PARTY.open({ room: id }), P1); await page.waitForSelector(".pt-pick", { timeout: 20000 }).catch(() => {}); await wait(page, 1500);
      const opts = await texts(page, ".pt-opts .pt-ol");
      ok("GM5 hatten lobby: no 'Frågor' choice (Vem i gruppen / Blandat)", opts.length > 0 && !opts.some((t) => /Frågor/.test(t)), opts);
      const one = await page.evaluate(() => (document.querySelector(".pt-one") || {}).textContent || "");
      ok("GM5 hatten lobby: the rule says written answers", /påhitta/i.test(one), one);
      await shot(page, "hatten-lobby-390");
      await tapText(page, ".pt-foot button", "STARTA"); await wait(page, 1200);
      const st = S.calls.filter((c) => c[0] === "party_act" && c[1].p_act === "start")[0];
      const list = st && st[1].p_data && st[1].p_data.list || [];
      ok("GM5 hatten start: every question is a written one (t|)", list.length >= 3 && list.every((x) => /^t\|/.test(x)), list.slice(0, 6));
      await ctx.close();
    }
    {
      const S = St();
      const { ctx, page } = await open(browser, 390, S);
      await page.evaluate(() => window.PARTY.open({})); await page.waitForSelector(".pt-gcard", { timeout: 20000 }).catch(() => {}); await wait(page, 800);
      const sv = await page.evaluate(() => { const c = document.querySelector(".pt-gcard.g-survivor .pt-gb"); return c ? [...c.children].map((x) => x.textContent) : null; });
      ok("GM5 Östra lägret: short card text in Partyspel (≤ 50 chars)", !!sv && sv[1].length <= 50, sv);
      ok("GM5 Namn i hatten card: written answers", await page.evaluate(() => /påhitta/i.test((document.querySelector(".pt-gcard.g-hatten") || {}).textContent || "")));
      await shot(page, "party-start-390");
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.message, (e.stack || "").split("\n")[1]); fail++; }
  console.log(`games2: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
