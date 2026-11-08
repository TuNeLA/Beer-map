/* Öl Nu — 🎉 SPEL UI (window.SPEL_UI, lazy; loaded by js/spel.js). The game hub (one picker for every game) and the
   room screens of the multi-phone games on the 0168–0169 round engine: 🃏 Skämskort (judge picks the best card),
   👉 Vem i gänget?, 🙊 Jag har aldrig, ⚖️ Hellre eller?. Every phone plays on its own screen; state lives on the
   server (spel_state polled every 1.5 s while open and visible), so a reload or a locked phone loses nothing.
   Overlay #sp (z-index 2150, like #ff / #pt). Android back: room → hub → closed. Texts: dalmål "ä" for é. */
(function () {
  "use strict";
  var I = window.I18N;
  var A = null, root = null, st = null;
  var POLL = 1500, LS_RECENT = "olnu.spel.recent", LS_GOAL = "olnu.spel.goal";

  function en() { return !!(I && I.lang === "en"); }
  function L(sv, e) { return en() && e != null ? e : sv; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function C() { return window.SPEL_CARDS || { white: [], black: [], vem: [], aldrig: [], hellre: [] }; }
  // ⚖️ every penalty word comes from window.OLNU_PEN (spel.js); the room's pack = pub.pen (0186), else my own choice
  function PK() { var d = st && st.d, p = d && d.pub && d.pub.pen; return window.OLNU_PEN ? window.OLNU_PEN.ok(p || window.OLNU_PEN.pref()) : "utm"; }
  function PEN(s, pack) { var d = st && st.d; return window.OLNU_PEN ? window.OLNU_PEN.fill(s, pack || PK(), d ? (d.round | 0) + (d.game_no | 0) : 0) : String(s).replace(/\{(k1|k2|d3)\}/gi, "tar straffet").replace(/\{(ic|mark)\}/g, "🎯"); }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }

  /* ---------- the game list (hub) ---------- */
  // mode: own = every phone plays on its own · tv = own phones + one big screen (party rooms) · one = one phone passed
  // around · night = runs all evening. Order = popularity (the most fun first); recent games move to the top.
  var GAMES = [
    { id: "kort", ic: "🃏", name: "Skämskort", sub: "Fyll luckan med det sjukaste kortet du har. Domaren väljer vinnaren.", n: "3–10", mode: "own", tag: "NYTT", col: "#14161c",
      how: ["Varje runda har en domare (byts varje gång).", "Alla andra har 7 kort på sin lur och lägger det roligaste i luckan.", "Domaren ser svaren anonymt och korar vinnaren. Först till målet vinner."] },
    { id: "vem", ic: "👉", name: "Vem i gänget?", sub: "Alla pekar ut nån i hemlighet. Flest röster tar straffet.", n: "3–16", mode: "own", tag: "NYTT", col: "#3b1f6b",
      how: ["En fråga: \"Vem i gänget… somnar först?\"", "Alla röstar i hemlighet på sin lur.", "Flest röster {k1}. Röstningen ä hemlig, resultatet int'."] },
    { id: "aldrig", ic: "🙊", name: "Jag har aldrig", sub: "Tryck \"Jag har\" eller \"Aldrig\". Alla ser vilka som har.", n: "2–16", mode: "own", tag: "NYTT", col: "#6b1f3b",
      how: ["Ett påstående: \"Jag har aldrig…\"", "Alla trycker Jag har / Aldrig på sin lur.", "Alla som har {k1}. Ingen ljuger – vi ser er."] },
    { id: "hellre", ic: "⚖️", name: "Hellre eller?", sub: "Välj sida. Den minsta sidan tar straffet.", n: "2–16", mode: "own", tag: "NYTT", col: "#1f4f6b",
      how: ["Två val: \"Hellre A eller B?\"", "Alla väljer på sin lur.", "Den sida som ä minst {k1}. Lika = alla klarar sig."] },
    { id: "quiz", grp: 1, ic: "🧠", name: "Gängkollen", sub: "Hur bra känner ni varandra? Frågor om gängets egna meriter, öl och grader.", n: "2–16", mode: "own", tag: "NYTT", col: "#0f4c3a",
      how: ["Frågorna byggs av gängets egen statistik: meriter, grader, öl genom tiderna, ikväll och mer.", "Alla svarar på sin lur. Snabbt – ingen väntar på dig.", "Rätt = 1 poäng. Fel = {K1}. Flest poäng vinner."] },
    { id: "kung", ic: "👑", name: "Kungaleken", sub: "En vanlig kortlek med våra egna regler. Dra ett kort, gör vad det säger. Fjärde kungen avgör.", n: "3–12", mode: "one", tag: "NYTT", col: "#4a1a1a" },
    { id: "imposter", ic: "🕵️", name: "Imposter", sub: "Alla utom en ser det hemliga ordet. Hitta impostern!", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "hatten", ic: "🎩", name: "Namn i hatten", sub: "Alla svarar i hemlighet. Lapparna dras en och en.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "flocken", ic: "🐑", name: "Flocken", sub: "Svara som de flesta. Den ensamma får 🥾 Kängan.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "forfest", ic: "🍻", name: "Förfestläget", sub: "Utmaningar, kategorier, virus och order. En lur går runt.", n: "2–12", mode: "one", col: "#3d2a14" },
    { id: "vagen", ic: "📡", name: "Radarn", sub: "Siaren ger en ledtråd, alla drar reglaget.", n: "3–12", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "survivor", ic: "🔥", name: "Östra lägret", sub: "Rösta ut varandra tills juryn utser en vinnare.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "spin", ic: "🎡", name: "Vem fixar nästa?", sub: "Snurran bestämmer vem som hämtar – dricka, chips eller vatten.", n: "2+", mode: "one", col: "#3d2a14" },
    { id: "lek", ic: "🎯", name: "Kvällens lekar", sub: "Uppdrag, bingo, hemlig agent och oraklet.", n: "1+", mode: "night", col: "#1f3d2a" },
    { id: "duel", grp: 1, ic: "⚔️", name: "Gängkamp", sub: "Utmana ett annat gäng om kvällen.", n: "2 gäng", mode: "night", col: "#1f3d2a" }
  ];
  var MODES = {
    own: L("📱 Allas egna lurar", "📱 Everyone's phone"), tv: L("📱 Allas lurar + 📺 en storskärm", "📱 Phones + 📺 one big screen"),
    one: L("📱 En lur, skicka runt", "📱 One phone, pass it on"), night: L("🌙 Hela kvällen", "🌙 All evening")
  };
  var ROOM_GAMES = { kort: 1, vem: 1, aldrig: 1, hellre: 1, quiz: 1 };
  function game(id) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i]; return null; }
  function sorted() {
    var rec = lsGet(LS_RECENT, []);
    var list = GAMES.slice();
    list.sort(function (a, b) {
      var ra = rec.indexOf(a.id), rb = rec.indexOf(b.id);
      if (ra < 0) ra = 99; if (rb < 0) rb = 99;
      return ra - rb || GAMES.indexOf(a) - GAMES.indexOf(b);
    });
    return { list: list, rec: rec };
  }
  function used(id) { var r = lsGet(LS_RECENT, []).filter(function (x) { return x !== id; }); r.unshift(id); lsSet(LS_RECENT, r.slice(0, 3)); }

  /* ---------- texts ---------- */
  var TX = {
    hubT: L("🎉 Spel", "🎉 Games"), hubSub: L("Välj ett spel. Alla i gruppen kan hoppa in.", "Pick a game. Everyone in the group can join."),
    recent: L("Senast", "Recent"), noGroup: L("Öppna 🎉 Spel från en grupp för att spela ihop.", "Open 🎉 Games from a group to play together."),
    liveT: L("pågår nu", "is on now"), liveJoin: L("HOPPA IN ›", "JUMP IN ›"),
    start: L("▶ STARTA", "▶ START"), few: L("Minst {0} spelare. Säg åt gänget: Grupper → gruppen → 🎉 Spel.", "At least {0} players. Tell the gang: Groups → the group → 🎉 Games."),
    switchG: L("↔ Byt spel", "↔ Other game"), here: L("Här nu", "Here now"), goalK: L("Först till", "First to"), goalP: L("Rundor", "Rounds"),
    pts: L("poäng", "points"), judge: L("⚖️ DOMARE", "⚖️ JUDGE"), pickN: L("Välj {0} kort", "Pick {0} card(s)"), pick2: L("Välj 2 kort – i ordning", "Pick 2 cards – in order"),
    play: L("🃏 LÄGG KORTET", "🃏 PLAY THE CARD"), play2: L("🃏 LÄGG KORTEN", "🃏 PLAY THE CARDS"), change: L("Ändra", "Change"),
    played: [L("✅ Lagt! Nu ä det domarens tur snart.", "✅ Played! The judge is up soon."), L("✅ Kortet ä lagt. Håll pokeransiktet.", "✅ Card played. Keep a poker face."), L("✅ Skickat till fronten.", "✅ Sent to the front.")],
    waitN: L("Väntar på {0} till…", "Waiting for {0} more…"), youJudge: L("Du ä domare! Läs upp kortet högt.", "You are the judge! Read the card out loud."),
    force: L("⏩ Kör med de svar som finns", "⏩ Go with the answers we have"),
    pickWin: L("Välj vinnaren", "Pick the winner"), crown: L("🏆 KORA VINNAREN", "🏆 CROWN THE WINNER"),
    judging: L("⚖️ {0} väljer vinnare…", "⚖️ {0} is picking the winner…"), judgeAway: L("Domaren ä borta – ni får välja.", "The judge is away – you pick."),
    roundWin: L("🏆 {0} vinner rundan!", "🏆 {0} wins the round!"), hasPts: L("{0} har {1} {2}", "{0} has {1} {2}"),
    next: L("NÄSTA RUNDA ›", "NEXT ROUND ›"), toEnd: L("SE SLUTRESULTATET ›", "SEE THE FINAL ›"),
    won: L("{0} vann!", "{0} won!"), tieWin: L("Delad seger: {0}!", "Shared win: {0}!"), again: L("🔁 Kör igen", "🔁 Play again"), board: L("Ställning", "Scores"), shame: L("Kvällens skamlista 📏", "Tonight's shame list 📏"),
    voted: L("✅ Röstat! Du kan ändra tills alla svarat.", "✅ Voted! You can change until everyone answered."),
    have: L("🙋 Jag har", "🙋 I have"), never: L("😇 Aldrig", "😇 Never"), or: L("eller", "or"),
    drinks: L("🎯 {0} tar straffet!", "🎯 {0} takes the penalty!"), penIs: L("Straffet: {K1}.", "Penalty: {K1}."), penIs2: L("Straffet: {K2}.", "Penalty: {K2}."),
    packH: L("Straffpaket", "Penalty pack"), nobody: L("Ingen röstade. Fegisar.", "Nobody voted. Cowards."),
    haveL: L("🙋 Har gjort det", "🙋 Have done it"), neverL: L("😇 Aldrig", "😇 Never"), cleanAll: L("Hela gänget ä oskyldigt. Misstänkt.", "The whole gang is innocent. Suspicious."),
    tie: L("Lika! Alla klarar sig.", "A tie! Everyone is safe."), minority: L("🎯 Minsta sidan: {k1}", "🎯 The smaller side: {k1}"),
    round: L("Runda {0}", "Round {0}"), roundOf: L("Runda {0}/{1}", "Round {0}/{1}"), stop: L("🏁 Avsluta", "🏁 End"),
    close: L("Stäng", "Close"), back: L("‹ Spel", "‹ Games"), you: L("du", "you"),
    err: { too_few: L("För få spelare här. Be gänget öppna 🎉 Spel.", "Too few players here."), slow_down: L("Lugn i stormen – vänta lite.", "Easy – wait a bit."),
      room_closed: L("Spelet ä slut. Starta ett nytt.", "The game is over. Start a new one."), not_member: L("Du ä int' med i gruppen.", "You are not in the group."),
      invalid_cards: L("Fel kort – välj igen.", "Wrong cards – pick again."), x: L("Nåt gick fel. Försök igen.", "Something went wrong. Try again.") },
    unan: [L("🤝 Enigt! Hela gänget tycker lika – alla skålar.", "🤝 Unanimous! Everyone cheers."), L("🤝 Alla på samma sida. Skål för sammanhållningen!", "🤝 All on one side. Cheers!")],
    allVem: L("ENHÄLLIGT! {0} {k2}! {mark}{mark}", "UNANIMOUS! {0} {k2}! {mark}{mark}"),
    alone: L("{0} ä ensam om det! Berätta historien – eller {K2}.", "{0} is the only one! Tell the story – or {K2}."),
    call: L("📣 Kalla in gänget", "📣 Call the gang"), called: L("📣 Skickat i chatten. Nu kommer dom!", "📣 Sent in the chat."),
    calledWait: L("Du kallade nyss. Vänta lite.", "You just called. Wait a bit."),
    callMsg: L("🎉 {0} startar {1}! Hoppa in: Grupper → gruppen → 🎉 Spel", "🎉 {0} starts {1}! Jump in: Groups → the group → 🎉 Games"),
    askT: L("{0} väntar redan i {1}", "{0} already waits in {1}"), askRun: L("{0} pågår. Hoppa in – eller vänta tills spelet ä slut.", "{0} is on. Jump in – or wait until it ends."),
    askJoin: L("HOPPA IN DÄR ›", "JUMP IN THERE ›"), askSwitch: L("Byt till {0} för alla", "Switch to {0} for everyone"), askNo: L("Avbryt", "Cancel"),
    qFew: L("Gänget behöver lite mer historia först. Gör nåt ihop ikväll och försök igen!", "The gang needs more history first."),
    qRight: L("✅ Rätt: {0}", "✅ Right: {0}"), qWrong: L("{mark} Fel: {0} – {K1}", "{mark} Wrong: {0} – {K1}"), qNone: L("Ingen hade rätt. Skäms, gänget!", "Nobody was right."),
    qAll: L("Alla hade rätt! Ni känner varandra för bra.", "Everyone was right!"), qYou: L("Du hade RÄTT! +1", "You were RIGHT! +1"), qYouNo: L("Fel! {K1}.", "Wrong! {K1}."),
    load: [L("Laddar ammunition…", "Loading ammo…"), L("Blandar korten…", "Shuffling…"), L("Kallar in trupperna…", "Calling in the troops…")]
  };
  function F(s) { var a = arguments; return String(s).replace(/\{(\d)\}/g, function (m, i) { var v = a[+i + 1]; return v == null ? "" : v; }); }

  /* ---------- root ---------- */
  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = el("div", { id: "sp", class: "sp", role: "dialog", "aria-modal": "true", "aria-label": TX.hubT, hidden: true });
    document.body.appendChild(root);
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); back(); return; }
      if (st && st.view === "kung" && !(e.target && /INPUT|BUTTON/.test(e.target.tagName))) {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); kungDraw(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); kungDraw(-1); }
      }
    });
    return root;
  }
  window.addEventListener("popstate", function () {
    if (!root || root.hidden || !st) return;
    if (st.closing) { close(true); return; }
    if (st.view !== "hub") { toHub(); try { history.pushState({ sp: 1 }, ""); } catch (e) {} }
    else close(true);
  });
  document.addEventListener("visibilitychange", function () { if (st && st.view === "room" && document.visibilityState === "visible") poll(true); });

  function open(api, g, what, opts) {
    A = api;
    ensureRoot().hidden = false;
    document.documentElement.classList.add("sp-on");
    var fresh = !st;
    st = { g: g || null, view: "hub", room: null, d: null, v: 0, sel: [], win: null, busy: false, timer: null, off: !!(opts && opts.off), live: st && st.live || null };
    if (fresh) { try { history.pushState({ sp: 1 }, ""); } catch (e) {} }
    if (what && what.room) { enterRoom(what.room, what.game); return; }
    if (what && what.join) { renderHub(); launch(what.join, true, true); return; }
    if (what && typeof what === "string") { renderHub(); launch(what); return; }
    renderHub();
  }
  // Leaving the room screen = leave the room, so a round never waits for someone who is not looking (spel_open rejoins).
  function leaveQuiet() {
    if (!st || !st.room || !A || !A.rpc) return;
    try { A.rpc("spel_act", { p_room: st.room, p_act: "leave", p_val: null, p_data: null }); } catch (e) {}
  }
  function close(fromPop) {
    if (st && st.view === "room" && !st.closing) leaveQuiet();
    if (!fromPop && st) { try { if (history.state && history.state.sp) { st.closing = true; var s0 = st; history.back(); setTimeout(function () { if (st === s0) close(true); }, 500); return; } } catch (e) {} }
    stopPoll();
    st = null;
    if (root) { root.hidden = true; root.innerHTML = ""; }
    document.documentElement.classList.remove("sp-on");
  }
  function back() { if (!st) return; if (st.view !== "hub") toHub(); else close(); }
  function toHub() { if (st.view === "room") leaveQuiet(); stopPoll(); st.view = "hub"; st.room = null; st.d = null; st.v = 0; renderHub(); }

  function topBar(title, sub, onBack, extra) {
    return el("div", { class: "sp-top" }, [
      onBack ? el("button", { type: "button", class: "sp-back", "aria-label": TX.back, text: onBack === close ? "✕" : "‹", onclick: function () { onBack(); } }) : null,
      el("div", { class: "sp-top-t" }, [el("b", { text: title }), sub ? el("small", { text: sub }) : null]),
      extra || null,
      onBack === close ? null : el("button", { type: "button", class: "sp-x", "aria-label": TX.close, text: "✕", onclick: function () { close(); } })
    ]);
  }

  /* ---------- hub ---------- */
  function renderHub() {
    if (!st || !root) return;
    st.view = "hub";
    root.className = "sp sp-hub";
    root.innerHTML = "";
    root.appendChild(topBar(TX.hubT, st.g && st.g.name ? st.g.name : TX.hubSub, close));
    var body = el("div", { class: "sp-body" });
    var liveBox = el("div", { class: "sp-livebox", hidden: true });
    body.appendChild(liveBox);
    var s = sorted();
    var list = el("div", { class: "sp-cards", role: "list" });
    s.list.forEach(function (gm) {
      if (st.g && st.g.evg && gm.grp) return;   // 📨 event group: Kvällens lekar + Gängkamp are group-only
      var rec = s.rec.indexOf(gm.id) >= 0;
      var b = el("button", { type: "button", class: "sp-card", role: "listitem", "data-g": gm.id, style: "--sp-c:" + gm.col, onclick: function () { launch(gm.id); } }, [
        el("span", { class: "sp-card-ic", "aria-hidden": "true", text: gm.ic }),
        el("span", { class: "sp-card-tx" }, [
          el("span", { class: "sp-card-h" }, [el("b", { text: gm.name }), gm.tag && pnNew(gm) ? el("em", { class: "sp-tag", text: "Nytt" }) : null, rec ? el("em", { class: "sp-tag sp-rec", text: TX.recent }) : null]),
          el("span", { class: "sp-card-s", text: gm.sub }),
          el("span", { class: "sp-card-m" }, [el("span", { text: "👥 " + gm.n }), el("span", { text: MODES[gm.mode] })])
        ])
      ]);
      list.appendChild(b);
    });
    body.appendChild(list);
    if (!st.g) body.appendChild(el("p", { class: "sp-note", text: TX.noGroup }));
    root.appendChild(body);
    // a running room of this group = a big "jump in" banner on top
    if (st.g && A && A.rpc && !st.off) A.rpc("spel_group", { p_group_id: st.g.id }).then(function (r) {
      var d = r && !r.error ? (A.parseData ? A.parseData(r.data) : r.data) : null, room = d && d.room;
      if (st) st.liveRoom = room || null;
      if (!room || !st || st.view !== "hub" || room.phase === "lobby" && (room.n | 0) < 1) return;
      var gm = game(room.game) || {};
      liveBox.hidden = false; liveBox.innerHTML = "";
      liveBox.appendChild(el("button", { type: "button", class: "sp-live", onclick: function () { if (room.is_in) enterRoom(room.id, room.game); else launch(room.game, true, true); } }, [
        el("span", { class: "sp-live-dot", "aria-hidden": "true" }),
        el("span", { class: "sp-live-tx" }, [el("b", { text: (gm.ic || "🎉") + " " + (gm.name || "") + " " + TX.liveT }),
          el("small", { text: (room.names || []).join(", ") })]),
        el("b", { class: "sp-live-go", text: TX.liveJoin })
      ]));
    });
    try { var f = root.querySelector(".sp-card"); if (f && !("ontouchstart" in window)) f.focus({ preventScroll: true }); } catch (e) {}
  }

  function askFirst(gm, room) {
    var cur = game(room.game) || {}, canSwitch = room.phase === "lobby" || room.phase === "end";
    var who = (room.names || []).slice(0, 3).join(", ") || "Gänget";
    var box = el("div", { class: "sp-ask", role: "alertdialog", "aria-modal": "true" });
    var card = el("div", { class: "sp-ask-c" }, [
      el("div", { class: "sp-big-ic", text: cur.ic || "🎉" }),
      el("h3", { text: canSwitch ? F(TX.askT, who, cur.name || "") : F(TX.askRun, (cur.ic || "") + " " + (cur.name || "")) }),
      el("button", { type: "button", class: "sp-main", text: TX.askJoin, onclick: function () { box.remove(); launch(room.game, true, true); } }),
      canSwitch ? el("button", { type: "button", class: "sp-sec", text: F(TX.askSwitch, gm.ic + " " + gm.name), onclick: function () { box.remove(); launch(gm.id, true); } }) : null,
      el("button", { type: "button", class: "sp-sec sp-ask-no", text: TX.askNo, onclick: function () { box.remove(); } })
    ]);
    box.appendChild(card); root.appendChild(box);
    try { card.querySelector(".sp-main").focus(); } catch (e) {}
  }
  function launch(id, sure, join) {
    var gm = game(id); if (!gm || !st) return;
    var lr = st.liveRoom;
    if (id === "kung") { used(id); kungStart(); return; }
    if (!sure && ROOM_GAMES[id] && lr && lr.game !== id && !lr.is_in && (lr.n | 0) > 0) { askFirst(gm, lr); return; }
    used(id);
    var g = st.g;
    if (ROOM_GAMES[id]) {
      if (!g) { A.toast(TX.noGroup, { id: "spel" }); return; }
      if (st.off) { A.toast(TX.err.x, { err: true, id: "spel" }); return; }
      loadingScreen(gm);
      A.rpc("spel_open", { p_group_id: g.id, p_game: join ? null : id }).then(function (r) {   // join = never switch the game
        if (!st) return;
        if (r && r.error) { fail(r.error); renderHub(); return; }
        var d = A.parseData ? A.parseData(r.data) : r.data;
        setView(d, true);
        startPoll();
      });
      return;
    }
    // games that live in their own module: close the hub, then open them
    var go = {
      forfest: function () { window.FORFEST && window.FORFEST.open(g ? { id: g.id, name: g.name || "" } : null); },
      spin: function () { window.RUNDAN && window.RUNDAN.openSpin && window.RUNDAN.openSpin(g); },
      lek: function () { if (!window.GAMES) return; if (g) window.GAMES.openGroup(g.evg ? { id: g.id, name: g.name, evg: true } : g); else window.GAMES.openMe(); },
      duel: function () { window.DUEL && window.DUEL.open && window.DUEL.open(g); }
    }[id];
    if (gm.party) {
      var p = lsGet("olnu.party", {}); p.game = id; lsSet("olnu.party", p);
      go = function () { window.PARTY && window.PARTY.open(g ? { group: { id: g.id, name: g.name || "" } } : {}); };
    }
    close();
    setTimeout(function () { try { if (go) go(); } catch (e) {} }, 380);
  }
  // ds19: "Nytt" = launched in the last 14 days AND not opened yet on this phone (a badge on every game means nothing)
  var PN_LAUNCH = { kort: "2026-11-07", vem: "2026-11-07", aldrig: "2026-11-07", hellre: "2026-11-07", quiz: "2026-11-07", kung: "2026-11-07" };
  function pnSeen() { try { return JSON.parse(localStorage.getItem("olnu.spSeen") || "{}") || {}; } catch (e) { return {}; } }
  function pnNew(gm) { var d = Date.parse(PN_LAUNCH[gm.id] || ""); return isFinite(d) && Date.now() - d < 14 * 864e5 && !pnSeen()[gm.id]; }
  document.addEventListener("click", function (e) {
    var c = e.target && e.target.closest && e.target.closest(".sp-card[data-g]"); if (!c) return;
    try { var s = pnSeen(); s[c.getAttribute("data-g")] = 1; localStorage.setItem("olnu.spSeen", JSON.stringify(s)); } catch (x) {}
  }, true);
  function loadingScreen(gm) {
    root.className = "sp sp-room";
    root.innerHTML = "";
    root.appendChild(topBar(gm.ic + " " + gm.name, "", toHub));
    var box = el("div", { class: "sp-body sp-center" }, [el("div", { class: "sp-big-ic", text: gm.ic }), el("p", { class: "sp-muted", text: pick(TX.load) })]);
    root.appendChild(box);
    // ds19: no answer in 12 s → say so, with a way on (retry) and a way out (back to the games)
    setTimeout(function () {
      if (!root || !box.isConnected || root.lastChild !== box) return;
      var p = box.querySelector(".sp-muted"); if (p) p.textContent = L("Spelet svarar int'. Kolla nätet och försök igen.", "The game does not answer. Check the network and try again.");
      box.appendChild(el("div", { class: "pn-sp-fail" }, [
        el("button", { type: "button", class: "sp-main", text: L("Försök igen", "Try again"), onclick: function () { if (st && st.room) { loadingScreen(gm); poll(true); } else toHub(); } }),
        el("button", { type: "button", class: "sp-sec", text: L("Tillbaka", "Back"), onclick: function () { toHub(); } })]));
    }, 12000);
  }
  function fail(err) {
    var m = String(err && err.message || err || "");
    var k = Object.keys(TX.err).filter(function (x) { return m.indexOf(x) >= 0; })[0];
    if (/not_now/.test(m)) { poll(true); return; }
    A.toast(TX.err[k || "x"], { err: true, id: "spel" });
  }

  /* ---------- room: sync ---------- */
  function enterRoom(id, gid) {
    st.room = id; st.view = "room"; st.v = 0;
    loadingScreen(game(gid) || game("kort"));
    poll(true); startPoll();
  }
  function startPoll() { stopPoll(); st.timer = setInterval(function () { poll(false); }, POLL); }
  function stopPoll() { if (st && st.timer) { clearInterval(st.timer); st.timer = null; } }
  function poll(force) {
    if (!st || !st.room || st.view !== "room" || st.busy) return;
    if (!force && document.visibilityState !== "visible") return;
    st.busy = true;
    A.rpc("spel_state", { p_room: st.room, p_v: force ? 0 : st.v }).then(function (r) {
      if (!st) return; st.busy = false;
      if (r && r.error) {
        if (/not_in_room|room_not_found/.test(r.error.message || "")) { toHub(); return; }
        return;
      }
      var d = A.parseData ? A.parseData(r.data) : r.data;
      if (!d || d.same) return;
      if (d.closed) { A.toast(TX.err.room_closed, { id: "spel" }); toHub(); return; }
      setView(d, false);
    }, function () { if (st) st.busy = false; });
  }
  function act(a, val, data) {
    if (!st || !st.room) return Promise.resolve();
    return A.rpc("spel_act", { p_room: st.room, p_act: a, p_val: val == null ? null : String(val), p_data: data || null }).then(function (r) {
      if (!st) return;
      if (r && r.error) { fail(r.error); return; }
      var d = A.parseData ? A.parseData(r.data) : r.data;
      if (d && d.left) { toHub(); return; }
      if (d) setView(d, true);
    });
  }
  function setView(d, mine) {
    if (!st || !d || !d.id) return;
    var key = d.game_no + ":" + d.round + ":" + d.phase;
    var changed = key !== st.key;
    if (changed) {
      if (st.key && d.phase !== "lobby") buzz(changed && !mine ? 18 : 0);
      st.sel = []; st.win = null; st.editing = false;
    }
    st.reveal = changed && (d.phase === "result" || d.phase === "end");
    st.key = key; st.room = d.id; st.view = "room"; st.v = d.v; st.d = d;
    var sc = root.querySelector(".sp-body"), top = sc ? sc.scrollTop : 0;
    render();
    if (!changed) { var nb = root.querySelector(".sp-body"); if (nb) nb.scrollTop = top; }
  }

  /* ---------- room: render ---------- */
  function render() {
    var d = st.d, gm = game(d.game) || game("kort");
    root.className = "sp sp-room sp-g-" + d.game + " sp-p-" + d.phase;
    root.style.setProperty("--sp-c", gm.col);
    root.innerHTML = "";
    var sub = d.phase === "lobby" ? (st.g && st.g.name || "") : d.phase === "end" ? "" :
      d.game === "kort" ? F(TX.round, d.round) + " · " + TX.goalK.toLowerCase() + " " + d.goal : F(TX.roundOf, d.round, d.goal);
    var stopB = (d.phase !== "lobby" && d.phase !== "end") ? el("button", { type: "button", class: "sp-stop", "aria-label": TX.stop, title: TX.stop, text: "🏁", onclick: function () { act("end"); } }) : null;
    root.appendChild(topBar(gm.ic + " " + gm.name, sub, toHub, stopB));
    var body = el("div", { class: "sp-body" });
    root.appendChild(body);
    var foot = el("div", { class: "sp-foot" });
    if (d.phase === "lobby") lobby(body, foot, gm);
    else if (d.phase === "end") endView(body, foot, gm);
    else if (d.game === "kort") kort(body, foot);
    else if (d.game === "quiz") quiz(body, foot);
    else pollGame(body, foot);
    if (foot.childNodes.length) root.appendChild(foot);
    if (st.reveal) { root.classList.add("sp-rv"); st.reveal = false; if (d.phase === "end" || d.game === "kort") burst(d.game === "kort" || d.game === "quiz" ? "🏆🎉⭐🃏" : "🎉🎯🥳⭐"); }
  }
  // emoji burst on a win / big result (motion only; nothing with prefers-reduced-motion)
  function burst(set) {
    try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    var em = Array.from ? Array.from(set) : set.split(""), box = el("div", { class: "sp-burst", "aria-hidden": "true" });
    for (var i = 0; i < 18; i++) box.appendChild(el("i", { style: "left:" + Math.round(Math.random() * 100) + "%;animation-delay:" + Math.round(Math.random() * 400) + "ms;font-size:" + (22 + Math.round(Math.random() * 18)) + "px", text: em[i % em.length] }));
    root.appendChild(box); setTimeout(function () { box.remove(); }, 2200);
  }
  function people(d, opts) {
    var row = el("div", { class: "sp-people" });
    (d.players || []).forEach(function (p) {
      var c = "sp-pp" + (p.is_me ? " me" : "") + (p.on ? "" : " off") + (p.done ? " done" : "") + (p.judge ? " judge" : "");
      row.appendChild(el("span", { class: c, title: p.name }, [
        el("span", { class: "sp-pp-n", text: (p.judge ? "⚖️ " : p.done && opts && opts.done ? "✅ " : "") + p.name }),
        opts && opts.score ? el("b", { text: String(p.score | 0) }) : null
      ]));
    });
    return row;
  }
  function active(d) { return (d.players || []).filter(function (p) { return p.on; }).length; }

  function lobby(body, foot, gm) {
    var d = st.d, min = d.game === "kort" || d.game === "vem" ? 3 : 2, n = active(d), isQ = d.game === "quiz";
    body.appendChild(el("div", { class: "sp-hero" }, [el("div", { class: "sp-big-ic", text: gm.ic }), el("h2", { text: gm.name }), el("p", { class: "sp-muted", text: gm.sub })]));
    body.appendChild(el("ol", { class: "sp-how" }, (gm.how || []).map(function (h) { return el("li", { text: PEN(h, packChoice()) }); })));
    body.appendChild(el("h3", { class: "sp-h", text: TX.here + " (" + n + ")" }));
    body.appendChild(people(d));
    // goal: points (kort) or rounds (poll games)
    var goals = lsGet(LS_GOAL, {}), opts = d.game === "kort" ? [3, 5, 7, 10] : isQ ? [5, 8, 12] : [8, 12, 20, 30];
    var cur = goals[d.game] || (d.game === "kort" ? 5 : isQ ? 8 : 12);
    var seg = el("div", { class: "sp-seg", role: "radiogroup", "aria-label": d.game === "kort" ? TX.goalK : TX.goalP });
    opts.forEach(function (o) {
      seg.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(o === cur), class: o === cur ? "on" : "", text: String(o),
        onclick: function () { goals[d.game] = o; lsSet(LS_GOAL, goals); render(); } }));
    });
    body.appendChild(el("div", { class: "sp-goal" }, [el("span", { text: d.game === "kort" ? TX.goalK + " (" + TX.pts + ")" : TX.goalP }), seg]));
    if (n < min) body.appendChild(el("p", { class: "sp-warn", text: F(TX.few, min) }));
    if (d.game !== "kort") packPicker(body);
    if (st.g && !st.g.evg && A.rpc) body.appendChild(el("button", { type: "button", class: "sp-sec sp-call", text: TX.call, onclick: function (e) { callGang(gm, e.currentTarget); } }));
    foot.appendChild(el("button", { type: "button", class: "sp-main", disabled: n < min, text: TX.start, onclick: function (e) { e.currentTarget.disabled = true; startGame(d.game, cur); } }));
    foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.switchG, onclick: toHub }));
  }
  // ⚖️ Straffpaket (lobby): one segmented row; Skålstraff shows its rule text once
  function packChoice() { return window.OLNU_PEN ? window.OLNU_PEN.pref() : "utm"; }
  function packPicker(body) {
    if (!window.OLNU_PEN) return;
    var cur = packChoice(), list = window.OLNU_PEN.packs();
    var seg = el("div", { class: "sp-seg sp-packs", role: "radiogroup", "aria-label": TX.packH });
    list.forEach(function (p) {
      seg.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(p.id === cur), class: p.id === cur ? "on" : "", title: p.sub,
        text: p.ic + " " + p.name, onclick: function () { window.OLNU_PEN.setPref(p.id); if (st.view === "kung") kungRender(); else render(); } }));
    });
    var cp = list.filter(function (p) { return p.id === cur; })[0] || list[0];
    body.appendChild(el("div", { class: "sp-goal sp-packrow" }, [el("span", { text: TX.packH }), seg]));
    body.appendChild(el("p", { class: "sp-muted sp-packsub", text: cp.rule || cp.sub }));
  }
  function callGang(gm, btn) {
    var key = "olnu.spel.called", m = lsGet(key, {}), id = st.d && st.d.id;
    if (!id || !st.g) return;
    if (m[id] && Date.now() - m[id] < 180000) { A.toast(TX.calledWait, { id: "spel" }); return; }
    btn.disabled = true;
    var body = F(TX.callMsg, (st.d.me && st.d.me.name) || "", gm.ic + " " + gm.name).slice(0, 140);
    A.rpc("post_group_msg", { p_group_id: st.g.id, p_body: body }).then(function (r) {
      if (r && r.error) { btn.disabled = false; A.toast(TX.err.x, { err: true, id: "spel" }); return; }
      m[id] = Date.now(); lsSet(key, m);
      try { A.invoke("notify-group", { event: "msg", group_id: st.g.id }); } catch (e) {}
      A.toast(TX.called, { id: "spel" });
    });
  }
  function startGame(id, goal) {
    if (id === "quiz") {
      quizBuild(st.g).then(function (qs) {
        if (!st) return;
        if (!qs || qs.length < 3) { A.toast(TX.qFew, { err: true, id: "spel" }); render(); return; }
        act("start", null, { game: "quiz", goal: goal, qs: qs, pen: packChoice() });
      });
      return;
    }
    var c = C(), data = { game: id, goal: goal, pen: packChoice() };
    if (id === "kort") { data.nw = c.white.length; data.bp = c.black.map(function (b) { return Math.min(2, Math.max(1, (String(b).match(/___/g) || []).length)); }); }
    else data.np = (c[id] || []).length;
    act("start", null, data);
  }

  /* --- Skämskort --- */
  function blackText(i) { return C().black[i] || "___"; }
  function whiteText(i) { return C().white[i] || "…"; }
  // "Statsministerns nya hobby: en krabba…" – lower case for a plain first word when the blank is mid-sentence
  var LOW = /^(En|Ett|Att|Den|Det|De|Min|Mitt|Mina|Tre|Fyra|Sju|Fem|Två|Någons|Ninjamormor)\b/;
  function wtext(i, mid) { var t = whiteText(i); return mid && LOW.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
  function filled(bi, cards, cls) {
    var parts = String(blackText(bi)).split("___"), box = el("div", { class: "sp-fill-card " + (cls || "") });
    var p = el("p");
    parts.forEach(function (t, i) {
      if (t) p.appendChild(document.createTextNode(t));
      if (i < parts.length - 1) p.appendChild(el("b", { class: "sp-fill", text: cards && cards[i] != null ? wtext(cards[i], /[^.!?"\s]\s*$/.test(t) || /[,:]\s*$/.test(t)) : "_____" }));
    });
    if (parts.length === 1 && cards && cards.length) { p.appendChild(document.createTextNode(" ")); p.appendChild(el("b", { class: "sp-fill", text: whiteText(cards[0]) })); }
    box.appendChild(p);
    return box;
  }
  function blackCard(d) {
    return el("div", { class: "sp-black" }, [el("p", { text: String(blackText(d.pub.black)).replace(/___/g, "_____") }),
      el("small", { text: d.pub.pick > 1 ? TX.pick2 : F(TX.pickN, 1) })]);
  }
  function kort(body, foot) {
    var d = st.d, pub = d.pub || {}, me = d.me || {};
    var waiting = (d.players || []).filter(function (p) { return p.on && !p.judge && !p.done; }).length;
    if (d.phase === "pick") {
      body.appendChild(blackCard(d));
      if (me.judge) {
        body.appendChild(el("div", { class: "sp-judgebox" }, [el("b", { text: TX.judge }), el("p", { text: TX.youJudge }), el("p", { class: "sp-muted", text: F(TX.waitN, waiting) })]));
        body.appendChild(people(d, { done: true }));
        if (me.can_force) foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.force, onclick: function () { act("force"); } }));
        return;
      }
      var mine = Array.isArray(me.mine) ? me.mine : null;
      if (mine && !st.editing) {
        body.appendChild(filled(pub.black, mine, "mine"));
        body.appendChild(el("p", { class: "sp-ok", text: pick(TX.played) }));
        body.appendChild(el("p", { class: "sp-muted", text: F(TX.waitN, waiting) }));
        body.appendChild(people(d, { done: true }));
        foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.change, onclick: function () { st.editing = true; st.sel = []; render(); } }));
        if (me.can_force) foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.force, onclick: function () { act("force"); } }));
        return;
      }
      var need = pub.pick | 0 || 1;
      var hand = el("div", { class: "sp-hand", role: "group", "aria-label": F(TX.pickN, need) });
      (me.hand || []).forEach(function (c) {
        var at = st.sel.indexOf(c);
        hand.appendChild(el("button", { type: "button", class: "sp-white" + (at >= 0 ? " on" : ""), "aria-pressed": String(at >= 0), onclick: function () {
          var i = st.sel.indexOf(c);
          if (i >= 0) st.sel.splice(i, 1); else { if (st.sel.length >= need) st.sel.shift(); st.sel.push(c); }
          buzz(8); render();
        } }, [at >= 0 && need > 1 ? el("i", { class: "sp-no", text: String(at + 1) }) : null, el("span", { text: whiteText(c) })]));
      });
      if (st.sel.length) body.appendChild(filled(pub.black, st.sel, "preview"));
      body.appendChild(hand);
      foot.appendChild(el("button", { type: "button", class: "sp-main", disabled: st.sel.length !== need, text: need > 1 ? TX.play2 : TX.play, onclick: function (e) {
        e.currentTarget.disabled = true; st.editing = false; act("play", null, { cards: st.sel.slice() });
      } }));
      return;
    }
    if (d.phase === "judge") {
      var can = !!me.can_force;
      body.appendChild(el("h3", { class: "sp-h", text: me.judge ? TX.pickWin : (can ? TX.judgeAway : F(TX.judging, pub.judge_name || "?")) }));
      var list = el("div", { class: "sp-answers", role: can ? "radiogroup" : null });
      (pub.answers || []).forEach(function (a) {
        var on = st.win === a.i;
        var card = filled(pub.black, a.cards, (on ? "on" : "") + (Array.isArray(me.mine) && same(me.mine, a.cards) ? " mine" : ""));
        if (can) list.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(on), class: "sp-ans", onclick: function () { st.win = a.i; buzz(8); render(); } }, [card]));
        else list.appendChild(el("div", { class: "sp-ans" }, [card]));
      });
      body.appendChild(list);
      if (can) foot.appendChild(el("button", { type: "button", class: "sp-main", disabled: st.win == null, text: TX.crown, onclick: function (e) { e.currentTarget.disabled = true; act("best", st.win); } }));
      return;
    }
    if (d.phase === "result") {
      var w = pub.win || {};
      body.appendChild(el("div", { class: "sp-win" }, [el("h2", { text: F(TX.roundWin, w.k === me.k ? TX.you.toUpperCase() : w.name || "?") }), filled(pub.black, w.cards || [], "winner"),
        el("p", { class: "sp-muted", text: F(TX.hasPts, w.name || "?", w.score | 0, TX.pts) })]));
      body.appendChild(scoreboard(pub.board || d.players, false));
      foot.appendChild(el("button", { type: "button", class: "sp-main", text: TX.next, onclick: function (e) { e.currentTarget.disabled = true; act("next"); } }));
    }
  }
  function same(a, b) { return a && b && a.length === b.length && a.every(function (x, i) { return +x === +b[i]; }); }
  function scoreboard(list, drinks) {
    var box = el("div", { class: "sp-board" }, [el("h3", { class: "sp-h", text: drinks ? TX.shame : TX.board })]);
    var max = Math.max.apply(null, (list || []).map(function (p) { return p.score | 0; }).concat([1]));
    (list || []).slice().sort(function (a, b) { return (b.score | 0) - (a.score | 0); }).forEach(function (p, i) {
      var medal = (p.score | 0) > 0 ? ["🥇", "🥈", "🥉"][i] || "" : "";
      box.appendChild(el("div", { class: "sp-brow", style: "--i:" + i }, [
        el("span", { class: "sp-bn", text: (medal ? medal + " " : "") + p.name }),
        el("span", { class: "sp-bar" }, [el("i", { style: "width:" + Math.round(100 * (p.score | 0) / max) + "%" })]),
        el("b", { text: (drinks ? "📏 " : "") + (p.score | 0) })
      ]));
    });
    return box;
  }
  function endView(body, foot, gm) {
    var d = st.d, pub = d.pub || {}, board = pub.board || d.players || [], drinks = d.game !== "kort" && d.game !== "quiz";
    var top = board.slice().sort(function (a, b) { return (b.score | 0) - (a.score | 0); })[0];
    var tops = top ? board.filter(function (p) { return (p.score | 0) === (top.score | 0); }).map(function (p) { return p.name; }) : [];
    if (top && (top.score | 0) > 0) body.appendChild(el("div", { class: "sp-hero" }, [el("div", { class: "sp-big-ic", text: drinks ? "📏" : "🏆" }),
      el("h2", { text: drinks ? F(L("{0} ä kvällens mest skyldiga!", "{0} is tonight's most guilty!"), tops.join(" & ")) : tops.length > 1 ? F(TX.tieWin, tops.join(" & ")) : F(TX.won, top.name) })]));
    if (d.game === "kort" && pub.win) body.appendChild(filled(pub.black, pub.win.cards || [], "winner"));
    body.appendChild(scoreboard(board, drinks));
    foot.appendChild(el("button", { type: "button", class: "sp-main", text: TX.again, onclick: function (e) {
      e.currentTarget.disabled = true; startGame(d.game, lsGet(LS_GOAL, {})[d.game] || d.goal);
    } }));
    foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.switchG, onclick: toHub }));
  }

  /* --- Vem i gänget? · Jag har aldrig · Hellre eller? --- */
  function prompt(d) {
    var c = C(), i = d.pub.prompt | 0;
    if (d.game === "vem") return c.vem[i] || "Vem i gänget…?";
    if (d.game === "aldrig") return c.aldrig[i] || "Jag har aldrig…";
    return (c.hellre[i] || ["A", "B"]);
  }
  function pollGame(body, foot) {
    var d = st.d, me = d.me || {}, mine = me.mine == null ? null : String(me.mine), pr = prompt(d);
    var waiting = (d.players || []).filter(function (p) { return p.on && !p.done; }).length;
    if (d.phase === "vote") {
      if (d.game === "hellre") {
        body.appendChild(el("p", { class: "sp-kicker", text: L("Hellre…", "Would you rather…") }));
        var two = el("div", { class: "sp-two" });
        ["a", "b"].forEach(function (k, i) {
          two.appendChild(el("button", { type: "button", class: "sp-opt sp-opt-" + k + (mine === k ? " on" : ""), "aria-pressed": String(mine === k), onclick: function () { buzz(10); act("vote", k); } }, [el("span", { text: pr[i] })]));
          if (!i) two.appendChild(el("span", { class: "sp-or", text: TX.or }));
        });
        body.appendChild(two);
      } else {
        body.appendChild(el("div", { class: "sp-prompt" }, [el("p", { text: pr })]));
        if (d.game === "aldrig") {
          body.appendChild(el("div", { class: "sp-yn" }, [
            el("button", { type: "button", class: "sp-opt sp-y" + (mine === "y" ? " on" : ""), "aria-pressed": String(mine === "y"), text: TX.have, onclick: function () { buzz(10); act("vote", "y"); } }),
            el("button", { type: "button", class: "sp-opt sp-n" + (mine === "n" ? " on" : ""), "aria-pressed": String(mine === "n"), text: TX.never, onclick: function () { buzz(10); act("vote", "n"); } })
          ]));
        } else {
          var grid = el("div", { class: "sp-names" });
          (d.players || []).filter(function (p) { return !p.is_me; }).forEach(function (p) {
            grid.appendChild(el("button", { type: "button", class: "sp-name" + (mine === p.k ? " on" : "") + (p.on ? "" : " off"), "aria-pressed": String(mine === p.k), text: p.name,
              onclick: function () { buzz(10); act("vote", p.k); } }));
          });
          body.appendChild(grid);
        }
      }
      body.appendChild(el("p", { class: mine ? "sp-ok" : "sp-muted", text: mine ? TX.voted : F(TX.waitN, waiting) }));
      if (mine) body.appendChild(el("p", { class: "sp-muted", text: F(TX.waitN, waiting) }));
      body.appendChild(people(d, { done: true }));
      if (me.can_force) foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.force, onclick: function () { act("force"); } }));
      return;
    }
    // result
    var res = d.pub.res || {};
    if (d.game === "vem") {
      body.appendChild(el("div", { class: "sp-prompt small" }, [el("p", { text: pr })]));
      var counts = res.counts || [], names = counts.filter(function (c) { return (res.top || []).indexOf(c.k) >= 0; }).map(function (c) { return c.name; });
      body.appendChild(el("h2", { class: "sp-drink", text: names.length ? F(TX.drinks, names.join(" & ")) : TX.nobody }));
      if (names.length) body.appendChild(el("p", { class: "sp-penline", text: PEN(TX.penIs) }));
      var mx = Math.max.apply(null, counts.map(function (c) { return c.n; }).concat([1]));
      var bars = el("div", { class: "sp-board" });
      if ((res.n | 0) >= 3 && counts.length && counts[0].n >= Math.max(2, (res.n | 0) - 1) && (counts.length < 2 || counts[1].n <= 1)) body.appendChild(el("p", { class: "sp-twist", text: PEN(F(TX.allVem, counts[0].name)) }));
      counts.forEach(function (c, ci) { bars.appendChild(el("div", { class: "sp-brow", style: "--i:" + ci }, [el("span", { class: "sp-bn", text: c.name }), el("span", { class: "sp-bar" }, [el("i", { style: "width:" + Math.round(100 * c.n / mx) + "%" })]), el("b", { text: String(c.n) })])); });
      body.appendChild(bars);
    } else if (d.game === "aldrig") {
      body.appendChild(el("div", { class: "sp-prompt small" }, [el("p", { text: pr })]));
      var yes = res.yes || [], no = res.no || [];
      body.appendChild(el("h2", { class: "sp-drink", text: yes.length ? F(TX.drinks, yes.map(function (p) { return p.name; }).join(", ")) : TX.cleanAll }));
      if (yes.length) body.appendChild(el("p", { class: "sp-penline", text: PEN(TX.penIs) }));
      if (yes.length === 1 && no.length >= 2) body.appendChild(el("p", { class: "sp-twist", text: PEN(F(TX.alone, yes[0].name)) }));
      body.appendChild(el("div", { class: "sp-sides" }, [side(TX.haveL, yes, true), side(TX.neverL, no, false)]));
    } else {
      var dr = res.drink;
      var dl = dr ? (res[dr] || []).map(function (p) { return p.name; }) : [];
      if (dr && !dl.length) dr = "same";   // everyone on one side: nobody is the smaller side
      body.appendChild(el("p", { class: "sp-kicker", text: L("Hellre…", "Would you rather…") }));
      body.appendChild(el("h2", { class: "sp-drink", text: dr === "same" ? pick(TX.unan) : dr ? F(TX.drinks, dl.join(", ")) : TX.tie }));
      if (dr && dr !== "same") body.appendChild(el("p", { class: "sp-penline", text: PEN(TX.minority) }));
      body.appendChild(el("div", { class: "sp-sides" }, [side(pr[0], res.a || [], dr === "a"), side(pr[1], res.b || [], dr === "b")]));
    }
    body.appendChild(scoreboard(d.pub.board || d.players, true));
    foot.appendChild(el("button", { type: "button", class: "sp-main", text: d.round >= d.goal ? TX.toEnd : TX.next, onclick: function (e) { e.currentTarget.disabled = true; act("next"); } }));
  }
  function side(title, list, hot) {
    return el("div", { class: "sp-side" + (hot ? " hot" : "") }, [el("b", { text: title + (hot ? " 🎯" : "") }),
      el("span", { text: list.length ? list.map(function (p) { return p.name; }).join(", ") : "–" })]);
  }

  /* --- 🧠 Gängkollen --- */
  var QSH = ["▲", "◆", "●", "■"];
  function quiz(body, foot) {
    var d = st.d, me = d.me || {}, q = d.pub.q || {}, o = q.o || [], mine = me.mine == null ? null : String(me.mine);
    var waiting = (d.players || []).filter(function (p) { return p.on && !p.done; }).length;
    body.appendChild(el("div", { class: "sp-prompt sp-qq" }, [el("p", { text: q.q || "?" })]));
    if (d.phase === "vote") {
      var g = el("div", { class: "sp-qopts" });
      o.forEach(function (t, i) {
        g.appendChild(el("button", { type: "button", class: "sp-qo sp-qo" + i + (mine === String(i) ? " on" : ""), "aria-pressed": String(mine === String(i)),
          onclick: function () { buzz(10); act("vote", i); } }, [el("i", { "aria-hidden": "true", text: QSH[i] }), el("span", { text: t })]));
      });
      body.appendChild(g);
      body.appendChild(el("p", { class: mine ? "sp-ok" : "sp-muted", text: mine ? TX.voted : F(TX.waitN, waiting) }));
      body.appendChild(people(d, { done: true }));
      if (me.can_force) foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.force, onclick: function () { act("force"); } }));
      return;
    }
    var res = d.pub.res || {}, a = res.a | 0, right = res.right || [], wrong = res.wrong || [];
    var picks = {}; (res.picks || []).forEach(function (p) { picks[p.i] = p.names || []; });
    var g2 = el("div", { class: "sp-qopts res" });
    o.forEach(function (t, i) {
      g2.appendChild(el("div", { class: "sp-qo sp-qo" + i + (i === a ? " right" : " dim"), style: "--i:" + i }, [el("i", { "aria-hidden": "true", text: i === a ? "✓" : QSH[i] }),
        el("span", { text: t }), (picks[i] || []).length ? el("small", { text: picks[i].join(", ") }) : null]));
    });
    body.appendChild(g2);
    var iWas = right.some(function (p) { return p.k === me.k; }), iVoted = mine != null;
    if (iVoted) body.appendChild(el("h2", { class: "sp-drink", text: iWas ? TX.qYou : PEN(TX.qYouNo) }));
    body.appendChild(el("p", { class: "sp-twist", text: !right.length ? TX.qNone : !wrong.length ? TX.qAll : PEN(F(TX.qWrong, wrong.map(function (p) { return p.name; }).join(", "))) }));
    body.appendChild(scoreboard(d.pub.board || d.players, false));
    foot.appendChild(el("button", { type: "button", class: "sp-main", text: d.round >= d.goal ? TX.toEnd : TX.next, onclick: function (e) { e.currentTarget.disabled = true; act("next"); } }));
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function cut(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  // 2–4 options with the answer at a random place; null when it cannot be a fair question
  function qOf(q, right, wrongs) {
    var seen = {}, o = [cut(right, 48)]; seen[o[0].toLowerCase()] = 1;
    wrongs.forEach(function (w) { w = cut(w, 48); if (o.length < 4 && w && !seen[w.toLowerCase()]) { seen[w.toLowerCase()] = 1; o.push(w); } });
    if (o.length < 2) return null;
    var ord = shuffle(o.map(function (x, i) { return i; }));
    return { q: cut(q, 160), o: ord.map(function (i) { return o[i]; }), a: ord.indexOf(0) };
  }
  function nums(n) {   // three believable wrong numbers around n
    n = Math.max(0, n | 0); var out = [], f = [0.5, 0.7, 1.4, 1.8, 2.5];
    shuffle(f).forEach(function (x) { var v = Math.round(n * x + (x < 1 ? -1 : 1) * (1 + Math.random() * 2)); if (v >= 0 && v !== n && out.indexOf(String(v)) < 0 && out.length < 3) out.push(String(v)); });
    for (var k = 1; out.length < 3; k++) if (out.indexOf(String(n + k * 3)) < 0) out.push(String(n + k * 3));
    return out;
  }
  // who has the most/least of a field; null on a tie or when nobody has any
  function topBy(m, f, low) {
    var s = m.filter(function (x) { return x[f] != null; }).slice().sort(function (a, b) { return low ? (a[f] | 0) - (b[f] | 0) : (b[f] | 0) - (a[f] | 0); });
    if (s.length < 2 || (s[0][f] | 0) === (s[1][f] | 0) || (!low && !(s[0][f] | 0))) return null;
    return s[0];
  }
  function others(m, x) { return shuffle(m.filter(function (y) { return y !== x; }).map(function (y) { return y.name; })); }
  var QFIX = [
    ["Hur gammal måste man vara för att handla på Systembolaget?", "20 år", ["18 år", "21 år", "19 år"]],
    ["Vad ä folköl?", "Öl med högst 3,5 % alkohol", ["Öl som bara säljs på midsommar", "Öl utan humle", "Öl med minst 5 %"]],
    ["Vilket land kommer pilsnern ifrån?", "Tjeckien", ["Tyskland", "Belgien", "Danmark"]],
    ["Vad ä humle?", "En klätterväxt", ["En sorts jäst", "Ett korn", "En ölmätare"]],
    ["När ä PintsNow-natten slut och allt börjar om?", "Kl 05:00", ["Kl 03:00", "Kl 00:00", "Kl 07:00"]],
    ["Vad händer om du använder 👻 Spökläge?", "Din pin syns int' på kartan", ["Du får dubbla meriter", "Gänget får en push", "Ölen räknas int'"]]
  ];
  function quizBuild(g) {
    function call(fn) { return A.rpc(fn, { p_group_id: g.id }).then(function (r) { return r && !r.error ? (A.parseData ? A.parseData(r.data) : r.data) : null; }, function () { return null; }); }
    return call("group_status_v3").then(function (m) { return m || call("group_status_v2"); }).then(function (m) {
      return call("group_now").then(function (now) { return makeQs(Array.isArray(m) ? m : [], now || {}); });
    });
  }
  function makeQs(m, now) {
    m = m.filter(function (x) { return x && x.name; });
    var qs = [], add = function (q) { if (q) qs.push(q); };
    if (m.length >= 2) {
      var t;
      if ((t = topBy(m, "meriter"))) add(qOf("Vem i gänget har flest meriter?", t.name, others(m, t)));
      if ((t = topBy(m, "total"))) add(qOf("Vem har druckit flest öl genom tiderna?", t.name, others(m, t)));
      if ((t = topBy(m, "total", true))) add(qOf("Vem har druckit MINST genom tiderna? (Skärpning!)", t.name, others(m, t)));
      if ((t = topBy(m, "rank"))) add(qOf("Vem har högst grad i gänget?", t.name, others(m, t)));
      if ((t = topBy(m, "rank", true))) add(qOf("Vem ä gängets menigaste menig (lägst grad)?", t.name, others(m, t)));
      var tn = m.map(function (x) { return { name: x.name, n: (x.beers | 0) + (x.others | 0) }; });
      if ((t = topBy(tn, "n"))) add(qOf("Vem har druckit mest ikväll?", t.name, others(tn, t)));
      var sum = m.reduce(function (s, x) { return s + (x.total | 0); }, 0);
      if (sum >= 3) add(qOf("Hur många öl har gänget druckit tillsammans, genom tiderna?", String(sum), nums(sum)));
      var live = m.filter(function (x) { return x.live; }).length;
      add(qOf("Hur många i gänget ä ute just nu?", String(live), nums(live).concat([String(m.length)])));
      var ch = m.filter(function (x) { return x.is_chief; })[0];
      if (ch) add(qOf("Vem ä gängets 🎖️ gruppchef?", ch.name, others(m, ch)));
      var ow = m.filter(function (x) { return x.is_owner; })[0];
      if (ow) add(qOf("Vem startade gänget?", ow.name, others(m, ow)));
      var j = m.filter(function (x) { return x.joined_at; }).slice().sort(function (a, b) { return Date.parse(b.joined_at) - Date.parse(a.joined_at); });
      if (j.length >= 3) add(qOf("Vem ä gängets nyaste rekryt?", j[0].name, others(m, j[0])));
      var towns = m.filter(function (x) { return x.home_town; });
      var ht = shuffle(towns.slice())[0];
      if (ht) {
        var tw = towns.map(function (x) { return x.home_town; }).filter(function (x) { return x !== ht.home_town; });
        add(qOf("Vilken hemstad har " + ht.name + "?", ht.home_town, shuffle(tw.concat(["Borlänge", "Mora", "Göteborg", "Kiruna", "Ystad", "Falun"]))));
      }
      var r = shuffle(m.filter(function (x) { return (x.total | 0) >= 2; }))[0];
      if (r) add(qOf("Hur många öl har " + r.name + " druckit genom tiderna?", String(r.total | 0), nums(r.total | 0)));
      var r2 = shuffle(m.filter(function (x) { return (x.meriter | 0) >= 2 && x !== r; }))[0];
      if (r2) add(qOf("Hur många meriter har " + r2.name + "?", String(r2.meriter | 0), nums(r2.meriter | 0)));
      var out = (now && now.out || []).filter(function (x) { return x && x.name && x.place; });
      if (out.length) {
        var w = shuffle(out.slice())[0], pl = out.map(function (x) { return x.place; }).filter(function (x) { return x !== w.place; });
        add(qOf("Var ä " + w.name + " just nu?", w.place, shuffle(pl.concat(["Hemma i soffan", "I kön till kebaben", "På Systemet", "Vilse i skogen"]))));
        var first = out.filter(function (x) { return x.at; }).slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
        if (first.length >= 2) add(qOf("Vem kom ut först ikväll?", first[0].name, others(m, m.filter(function (x) { return x.name === first[0].name; })[0])));
      }
    }
    shuffle(qs);
    // a few fixed Öl Nu facts so a small gang still gets a full game (max 1 fact per 3 gang questions, at least 3 questions)
    var fx = shuffle(QFIX.slice()), want = Math.max(3 - qs.length, Math.min(fx.length, Math.ceil(qs.length / 3)));
    for (var i = 0; i < want && i < fx.length; i++) { var f = qOf(fx[i][0], fx[i][1], fx[i][2]); if (f) qs.splice(Math.floor(Math.random() * (qs.length + 1)), 0, f); }
    return qs.slice(0, 30);
  }

  /* --- 👑 Kungaleken (a plain card deck with our own rules, one phone; penalties from OLNU_PEN) --- */
  var KR = [
    ["A", "🎺 Fanfar", "Alla gör en fanfar, en i taget, varvet runt. Den som skrattar först {k1}."],
    ["2", "👉 Du", "Välj nån som {k2}."],
    ["3", "🙋 Jag", "Du {k1}. Sorry."],
    ["4", "🧎 Golvet", "Alla rör golvet! Sist ner {k1}."],
    ["5", "👍 Tummästare", "Du ä Tummästare. När du lägger tummen på bordkanten ska alla göra samma. Sist {k1}. Gäller tills nästa femma."],
    ["6", "☝️ Himlen", "Alla pekar upp i taket! Sist {k1}."],
    ["7", "📂 Kategori", "Säg en kategori. Varvet runt säger alla en sak. Den som tvekar eller upprepar {k1}."],
    ["8", "🤝 Kompis", "Välj en kompis. Varje gång du får ett straff resten av spelet får kompisen samma."],
    ["9", "🎤 Rim", "Säg ordet nedan. Varvet runt rimmar alla. Den som missar {k1}."],
    ["10", "🙊 Jag har aldrig", "Läs upp påståendet. Alla som HAR gjort det {k1}."],
    ["J", "📜 Ny regel", "Hitta på en regel som gäller resten av spelet. Den som bryter den {k1}."],
    ["Q", "❓ Frågemästare", "Du ä Frågemästare. Den som svarar på en fråga från dig {k1}. Gäller tills nästa dam."],
    ["K", "👑 Kungen", "Skriv en utmaning på en lapp och lägg den i kungens hatt (en mugg duger). Den som drar den fjärde kungen gör den roligaste lappen – gänget väljer."]
  ];
  var KCAT = ["Ölmärken", "Saker i en lumpenpackning", "Städer i Dalarna", "Dansbandslåtar", "Saker man hittar i en jackficka", "Hockeylag", "Saker på en smörgåstårta",
    "Ord för att vara full", "Saker på en midsommarafton", "Kebabsåser", "Bilmärken", "Saker man ångrar på morgonen", "Djur i skogen", "Godis i lösvikt",
    "Saker i en bastu", "Svenska maträtter", "Pinsamma dansmoves", "Saker man säger till en dörrvakt", "Fjällsporter", "Saker som luktar illa"];
  var KRIM = ["Öl", "Krog", "Bastu", "Kung", "Skål", "Natt", "Dans", "Korv", "Kö", "Fest", "Snus", "Gran", "Sjö", "Tält", "Hatt"];
  var SUIT = [["♥", "r"], ["♦", "r"], ["♣", "b"], ["♠", "b"]];
  function kungStart() {
    var deck = [];
    for (var s = 0; s < 4; s++) for (var r = 0; r < 13; r++) deck.push([r, s]);
    st.view = "kung";
    st.kung = { deck: shuffle(deck), pos: -1, kings: 0, hist: [], extra: {} };
    kungRender();
  }
  function kungDraw(dir) {
    var k = st.kung; if (!k) return;
    if (dir < 0) { if (k.pos > 0) { k.pos--; kungRender(); } return; }
    if (k.pos < k.hist.length - 1) { k.pos++; kungRender(); return; }
    if (!k.deck.length || k.kings >= 4) return;
    var c = k.deck.pop(), extra = null;
    if (c[0] === 12) k.kings++;
    if (c[0] === 6) extra = pick(KCAT);
    if (c[0] === 8) extra = pick(KRIM);
    if (c[0] === 9) { var al = C().aldrig || []; extra = al.length ? al[Math.floor(Math.random() * al.length)] : "Jag har aldrig druckit ur en sko."; }
    k.hist.push({ c: c, extra: extra, kings: k.kings });
    k.pos = k.hist.length - 1;
    buzz(14); kungRender();
  }
  function kungRender() {
    var k = st.kung, h = k.hist[k.pos], gm = game("kung");
    root.className = "sp sp-room sp-kung" + (h ? " kr-" + h.c[0] : "");
    root.style.setProperty("--sp-c", gm.col);
    root.innerHTML = "";
    var left = k.deck.length, kings = h ? h.kings : k.kings;
    root.appendChild(topBar(gm.ic + " " + gm.name, (52 - left) + "/52 · 👑 " + kings + "/4", toHub));
    var body = el("div", { class: "sp-body sp-kbody" });
    if (!h) {
      body.appendChild(el("div", { class: "sp-hero" }, [el("div", { class: "sp-big-ic", text: "👑" }), el("h2", { text: gm.name }),
        el("p", { class: "sp-muted", text: L("Ställ en mugg mitt på bordet = kungens hatt. Sitt i en ring. Lägg luren i mitten och dra ett kort i taget, varvet runt.", "Put a mug in the middle = the king's hat. Draw one card each, round the table.") })]));
      packPicker(body);
      body.appendChild(el("ol", { class: "sp-how sp-krules" }, KR.map(function (r) { return el("li", {}, [el("b", { text: r[0] + " " + r[1] }), " – " + PEN(r[2], packChoice())]); })));
    } else {
      var r = KR[h.c[0]], su = SUIT[h.c[1]], last = h.c[0] === 12 && h.kings >= 4;
      body.appendChild(el("button", { type: "button", class: "sp-kcard " + su[1] + (last ? " last" : ""), "aria-label": r[0] + " " + su[0], onclick: function () { kungDraw(1); } }, [
        el("span", { class: "sp-kc-tl", text: r[0] + su[0] }), el("span", { class: "sp-kc-big", text: su[0] }), el("span", { class: "sp-kc-br", text: r[0] + su[0] })]));
      body.appendChild(el("h2", { class: "sp-drink", text: last ? L("👑 FJÄRDE KUNGEN! Gör den roligaste lappen i hatten!", "👑 THE FOURTH KING! Do the best note in the hat!") : r[1] }));
      body.appendChild(el("p", { class: "sp-krule", text: last ? L("Spelet ä slut. Länge leve kungen!", "Game over. Long live the king!") : PEN(r[2], packChoice()) }));
      if (h.extra && !last) body.appendChild(el("div", { class: "sp-prompt" }, [el("p", { text: h.extra })]));
      if (st.reveal !== false && last) burst("👑🎉⭐");
    }
    root.appendChild(body);
    var foot = el("div", { class: "sp-foot" });
    var over = !k.deck.length || k.kings >= 4;
    if (k.pos > 0) foot.appendChild(el("button", { type: "button", class: "sp-sec sp-kprev", text: "‹", "aria-label": L("Förra kortet", "Previous card"), onclick: function () { kungDraw(-1); } }));
    foot.appendChild(over && k.pos === k.hist.length - 1 ? el("button", { type: "button", class: "sp-main", text: TX.again, onclick: function () { kungStart(); } })
      : el("button", { type: "button", class: "sp-main", text: h ? L("Dra nästa kort", "Next card") : L("👑 Dra första kortet", "👑 Draw the first card"), onclick: function () { kungDraw(1); } }));
    root.appendChild(foot);
  }

  window.SPEL_UI = {
    open: open, close: close, isOpen: function () { return !!(root && !root.hidden); },
    games: function () { return GAMES.map(function (g) { return { id: g.id, ic: g.ic, name: g.name, n: g.n, mode: g.mode }; }); },
    _state: function () { return st; }
  };
})();
