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
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }

  /* ---------- the game list (hub) ---------- */
  // mode: own = every phone plays on its own · tv = own phones + one big screen (party rooms) · one = one phone passed
  // around · night = runs all evening. Order = popularity (the most fun first); recent games move to the top.
  var GAMES = [
    { id: "kort", ic: "🃏", name: "Skämskort", sub: "Fyll luckan med det sjukaste kortet du har. Domaren väljer vinnaren.", n: "3–10", mode: "own", tag: "NYTT", col: "#14161c",
      how: ["Varje runda har en domare (byts varje gång).", "Alla andra har 7 kort på sin lur och lägger det roligaste i luckan.", "Domaren ser svaren anonymt och korar vinnaren. Först till målet vinner."] },
    { id: "vem", ic: "👉", name: "Vem i gänget?", sub: "Alla pekar ut nån i hemlighet. Flest röster dricker.", n: "3–16", mode: "own", tag: "NYTT", col: "#3b1f6b",
      how: ["En fråga: \"Vem i gänget… somnar först?\"", "Alla röstar i hemlighet på sin lur.", "Flest röster tar en klunk. Röstningen ä hemlig, resultatet int'."] },
    { id: "aldrig", ic: "🙊", name: "Jag har aldrig", sub: "Tryck \"Jag har\" eller \"Aldrig\". Alla ser vilka som har.", n: "2–16", mode: "own", tag: "NYTT", col: "#6b1f3b",
      how: ["Ett påstående: \"Jag har aldrig…\"", "Alla trycker Jag har / Aldrig på sin lur.", "Alla som har tar en klunk. Ingen ljuger – vi ser er."] },
    { id: "hellre", ic: "⚖️", name: "Hellre eller?", sub: "Välj sida. Den minsta sidan dricker.", n: "2–16", mode: "own", tag: "NYTT", col: "#1f4f6b",
      how: ["Två val: \"Hellre A eller B?\"", "Alla väljer på sin lur.", "Den sida som ä minst tar en klunk. Lika = alla klarar sig."] },
    { id: "imposter", ic: "🕵️", name: "Imposter", sub: "Alla utom en ser det hemliga ordet. Hitta impostern!", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "hatten", ic: "🎩", name: "Namn i hatten", sub: "Alla svarar i hemlighet. Lapparna dras en och en.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "flocken", ic: "🐑", name: "Flocken", sub: "Svara som de flesta. Den ensamma får kossan 🐄.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "forfest", ic: "🍻", name: "Förfestläget", sub: "Utmaningar, kategorier, virus och order. En lur går runt.", n: "2–12", mode: "one", col: "#3d2a14" },
    { id: "vagen", ic: "🔮", name: "Vågen", sub: "Siaren ger en ledtråd, alla drar reglaget.", n: "3–12", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "survivor", ic: "🔥", name: "Östra lägret", sub: "Rösta ut varandra tills juryn utser en vinnare.", n: "3–16", mode: "tv", party: 1, col: "#2a2f45" },
    { id: "spin", ic: "🎡", name: "Vem bjuder?", sub: "Snurran bestämmer vem som tar nästa runda.", n: "2+", mode: "one", col: "#3d2a14" },
    { id: "lek", ic: "🎯", name: "Kvällens lekar", sub: "Uppdrag, bingo, hemlig agent och oraklet.", n: "1+", mode: "night", col: "#1f3d2a" },
    { id: "duel", ic: "⚔️", name: "Gängkamp", sub: "Utmana ett annat gäng om kvällen.", n: "2 gäng", mode: "night", col: "#1f3d2a" }
  ];
  var MODES = {
    own: L("📱 Allas egna lurar", "📱 Everyone's phone"), tv: L("📱 Allas lurar + 📺 en storskärm", "📱 Phones + 📺 one big screen"),
    one: L("📱 En lur, skicka runt", "📱 One phone, pass it on"), night: L("🌙 Hela kvällen", "🌙 All evening")
  };
  var ROOM_GAMES = { kort: 1, vem: 1, aldrig: 1, hellre: 1 };
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
    won: L("{0} vann!", "{0} won!"), tieWin: L("Delad seger: {0}!", "Shared win: {0}!"), again: L("🔁 Kör igen", "🔁 Play again"), board: L("Ställning", "Scores"), shame: L("Kvällens skamlista 🍺", "Tonight's shame list 🍺"),
    voted: L("✅ Röstat! Du kan ändra tills alla svarat.", "✅ Voted! You can change until everyone answered."),
    have: L("🍺 Jag har", "🍺 I have"), never: L("😇 Aldrig", "😇 Never"), or: L("eller", "or"),
    drinks: L("🍺 {0} dricker!", "🍺 {0} drinks!"), nobody: L("Ingen röstade. Fegisar.", "Nobody voted. Cowards."),
    haveL: L("🍺 Har gjort det", "🍺 Have done it"), neverL: L("😇 Aldrig", "😇 Never"), cleanAll: L("Hela gänget ä oskyldigt. Misstänkt.", "The whole gang is innocent. Suspicious."),
    tie: L("Lika! Alla klarar sig.", "A tie! Everyone is safe."), minority: L("🍺 Minsta sidan dricker", "🍺 The smaller side drinks"),
    round: L("Runda {0}", "Round {0}"), roundOf: L("Runda {0}/{1}", "Round {0}/{1}"), stop: L("🏁 Avsluta", "🏁 End"),
    close: L("Stäng", "Close"), back: L("‹ Spel", "‹ Games"), you: L("du", "you"),
    err: { too_few: L("För få spelare här. Be gänget öppna 🎉 Spel.", "Too few players here."), slow_down: L("Lugn i stormen – vänta lite.", "Easy – wait a bit."),
      room_closed: L("Spelet ä slut. Starta ett nytt.", "The game is over. Start a new one."), not_member: L("Du ä int' med i gruppen.", "You are not in the group."),
      invalid_cards: L("Fel kort – välj igen.", "Wrong cards – pick again."), x: L("Nåt gick fel. Försök igen.", "Something went wrong. Try again.") },
    load: [L("Laddar ammunition…", "Loading ammo…"), L("Blandar korten…", "Shuffling…"), L("Kallar in trupperna…", "Calling in the troops…")]
  };
  function F(s) { var a = arguments; return String(s).replace(/\{(\d)\}/g, function (m, i) { var v = a[+i + 1]; return v == null ? "" : v; }); }

  /* ---------- root ---------- */
  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = el("div", { id: "sp", class: "sp", role: "dialog", "aria-modal": "true", "aria-label": TX.hubT, hidden: true });
    document.body.appendChild(root);
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); back(); } });
    return root;
  }
  window.addEventListener("popstate", function () {
    if (!root || root.hidden || !st) return;
    if (st.closing) { close(true); return; }
    if (st.view === "room") { toHub(); try { history.pushState({ sp: 1 }, ""); } catch (e) {} }
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
    if (what && what.room) { enterRoom(what.room); return; }
    if (what && typeof what === "string") { renderHub(); launch(what); return; }
    renderHub();
  }
  function close(fromPop) {
    if (!fromPop && st) { try { if (history.state && history.state.sp) { st.closing = true; var s0 = st; history.back(); setTimeout(function () { if (st === s0) close(true); }, 500); return; } } catch (e) {} }
    stopPoll();
    st = null;
    if (root) { root.hidden = true; root.innerHTML = ""; }
    document.documentElement.classList.remove("sp-on");
  }
  function back() { if (!st) return; if (st.view === "room") toHub(); else close(); }
  function toHub() { stopPoll(); st.view = "hub"; st.room = null; st.d = null; st.v = 0; renderHub(); }

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
      var rec = s.rec.indexOf(gm.id) >= 0;
      var b = el("button", { type: "button", class: "sp-card", role: "listitem", "data-g": gm.id, style: "--sp-c:" + gm.col, onclick: function () { launch(gm.id); } }, [
        el("span", { class: "sp-card-ic", "aria-hidden": "true", text: gm.ic }),
        el("span", { class: "sp-card-tx" }, [
          el("span", { class: "sp-card-h" }, [el("b", { text: gm.name }), gm.tag ? el("em", { class: "sp-tag", text: gm.tag }) : null, rec ? el("em", { class: "sp-tag sp-rec", text: TX.recent }) : null]),
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
      if (!room || !st || st.view !== "hub" || room.phase === "lobby" && (room.n | 0) < 1) return;
      var gm = game(room.game) || {};
      liveBox.hidden = false; liveBox.innerHTML = "";
      liveBox.appendChild(el("button", { type: "button", class: "sp-live", onclick: function () { if (room.is_in) enterRoom(room.id); else launch(room.game); } }, [
        el("span", { class: "sp-live-dot", "aria-hidden": "true" }),
        el("span", { class: "sp-live-tx" }, [el("b", { text: (gm.ic || "🎉") + " " + (gm.name || "") + " " + TX.liveT }),
          el("small", { text: (room.names || []).join(", ") })]),
        el("b", { class: "sp-live-go", text: TX.liveJoin })
      ]));
    });
    try { var f = root.querySelector(".sp-card"); if (f && !("ontouchstart" in window)) f.focus({ preventScroll: true }); } catch (e) {}
  }

  function launch(id) {
    var gm = game(id); if (!gm || !st) return;
    used(id);
    var g = st.g;
    if (ROOM_GAMES[id]) {
      if (!g) { A.toast(TX.noGroup, { id: "spel" }); return; }
      if (st.off) { A.toast(TX.err.x, { err: true, id: "spel" }); return; }
      loadingScreen(gm);
      A.rpc("spel_open", { p_group_id: g.id, p_game: id }).then(function (r) {
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
      lek: function () { if (!window.GAMES) return; if (g) window.GAMES.openGroup(g); else window.GAMES.openMe(); },
      duel: function () { window.DUEL && window.DUEL.open && window.DUEL.open(g); }
    }[id];
    if (gm.party) {
      var p = lsGet("olnu.party", {}); p.game = id; lsSet("olnu.party", p);
      go = function () { window.PARTY && window.PARTY.open(g ? { group: { id: g.id, name: g.name || "" } } : {}); };
    }
    close();
    setTimeout(function () { try { if (go) go(); } catch (e) {} }, 380);
  }
  function loadingScreen(gm) {
    root.className = "sp sp-room";
    root.innerHTML = "";
    root.appendChild(topBar(gm.ic + " " + gm.name, "", toHub));
    root.appendChild(el("div", { class: "sp-body sp-center" }, [el("div", { class: "sp-big-ic", text: gm.ic }), el("p", { class: "sp-muted", text: pick(TX.load) })]));
  }
  function fail(err) {
    var m = String(err && err.message || err || "");
    var k = Object.keys(TX.err).filter(function (x) { return m.indexOf(x) >= 0; })[0];
    if (/not_now/.test(m)) { poll(true); return; }
    A.toast(TX.err[k || "x"], { err: true, id: "spel" });
  }

  /* ---------- room: sync ---------- */
  function enterRoom(id) {
    st.room = id; st.view = "room"; st.v = 0;
    loadingScreen(game("kort"));
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
    else pollGame(body, foot);
    if (foot.childNodes.length) root.appendChild(foot);
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
    var d = st.d, min = d.game === "kort" || d.game === "vem" ? 3 : 2, n = active(d);
    body.appendChild(el("div", { class: "sp-hero" }, [el("div", { class: "sp-big-ic", text: gm.ic }), el("h2", { text: gm.name }), el("p", { class: "sp-muted", text: gm.sub })]));
    body.appendChild(el("ol", { class: "sp-how" }, (gm.how || []).map(function (h) { return el("li", { text: h }); })));
    body.appendChild(el("h3", { class: "sp-h", text: TX.here + " (" + n + ")" }));
    body.appendChild(people(d));
    // goal: points (kort) or rounds (poll games)
    var goals = lsGet(LS_GOAL, {}), opts = d.game === "kort" ? [3, 5, 7, 10] : [8, 12, 20, 30];
    var cur = goals[d.game] || (d.game === "kort" ? 5 : 12);
    var seg = el("div", { class: "sp-seg", role: "radiogroup", "aria-label": d.game === "kort" ? TX.goalK : TX.goalP });
    opts.forEach(function (o) {
      seg.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(o === cur), class: o === cur ? "on" : "", text: String(o),
        onclick: function () { goals[d.game] = o; lsSet(LS_GOAL, goals); render(); } }));
    });
    body.appendChild(el("div", { class: "sp-goal" }, [el("span", { text: d.game === "kort" ? TX.goalK + " (" + TX.pts + ")" : TX.goalP }), seg]));
    if (n < min) body.appendChild(el("p", { class: "sp-warn", text: F(TX.few, min) }));
    foot.appendChild(el("button", { type: "button", class: "sp-main", disabled: n < min, text: TX.start, onclick: function (e) { e.currentTarget.disabled = true; startGame(d.game, cur); } }));
    foot.appendChild(el("button", { type: "button", class: "sp-sec", text: TX.switchG, onclick: toHub }));
  }
  function startGame(id, goal) {
    var c = C(), data = { game: id, goal: goal };
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
      box.appendChild(el("div", { class: "sp-brow" }, [
        el("span", { class: "sp-bn", text: (medal ? medal + " " : "") + p.name }),
        el("span", { class: "sp-bar" }, [el("i", { style: "width:" + Math.round(100 * (p.score | 0) / max) + "%" })]),
        el("b", { text: (drinks ? "🍺 " : "") + (p.score | 0) })
      ]));
    });
    return box;
  }
  function endView(body, foot, gm) {
    var d = st.d, pub = d.pub || {}, board = pub.board || d.players || [], drinks = d.game !== "kort";
    var top = board.slice().sort(function (a, b) { return (b.score | 0) - (a.score | 0); })[0];
    var tops = top ? board.filter(function (p) { return (p.score | 0) === (top.score | 0); }).map(function (p) { return p.name; }) : [];
    if (top && (top.score | 0) > 0) body.appendChild(el("div", { class: "sp-hero" }, [el("div", { class: "sp-big-ic", text: drinks ? "🍺" : "🏆" }),
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
      var mx = Math.max.apply(null, counts.map(function (c) { return c.n; }).concat([1]));
      var bars = el("div", { class: "sp-board" });
      counts.forEach(function (c) { bars.appendChild(el("div", { class: "sp-brow" }, [el("span", { class: "sp-bn", text: c.name }), el("span", { class: "sp-bar" }, [el("i", { style: "width:" + Math.round(100 * c.n / mx) + "%" })]), el("b", { text: String(c.n) })])); });
      body.appendChild(bars);
    } else if (d.game === "aldrig") {
      body.appendChild(el("div", { class: "sp-prompt small" }, [el("p", { text: pr })]));
      var yes = res.yes || [], no = res.no || [];
      body.appendChild(el("h2", { class: "sp-drink", text: yes.length ? F(TX.drinks, yes.map(function (p) { return p.name; }).join(", ")) : TX.cleanAll }));
      body.appendChild(el("div", { class: "sp-sides" }, [side(TX.haveL, yes, true), side(TX.neverL, no, false)]));
    } else {
      var dr = res.drink;
      var dl = dr ? (res[dr] || []).map(function (p) { return p.name; }) : [];
      body.appendChild(el("h2", { class: "sp-drink", text: dr ? F(TX.drinks, dl.join(", ")) : TX.tie }));
      if (dr) body.appendChild(el("p", { class: "sp-muted", style: "text-align:center;margin-top:0", text: TX.minority }));
      body.appendChild(el("div", { class: "sp-sides" }, [side(pr[0], res.a || [], dr === "a"), side(pr[1], res.b || [], dr === "b")]));
    }
    body.appendChild(scoreboard(d.pub.board || d.players, true));
    foot.appendChild(el("button", { type: "button", class: "sp-main", text: d.round >= d.goal ? TX.toEnd : TX.next, onclick: function (e) { e.currentTarget.disabled = true; act("next"); } }));
  }
  function side(title, list, hot) {
    return el("div", { class: "sp-side" + (hot ? " hot" : "") }, [el("b", { text: title + (hot && title.indexOf("🍺") < 0 ? " 🍺" : "") }),
      el("span", { text: list.length ? list.map(function (p) { return p.name; }).join(", ") : "–" })]);
  }

  window.SPEL_UI = {
    open: open, close: close, isOpen: function () { return !!(root && !root.hidden); },
    games: function () { return GAMES.map(function (g) { return { id: g.id, ic: g.ic, name: g.name, n: g.n, mode: g.mode }; }); },
    _state: function () { return st; }
  };
})();
