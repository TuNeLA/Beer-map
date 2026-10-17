/* Öl Nu v15 — LEK (omgång 2; CONTRACT "v15 LEK", migration 0017).
   1. Kvällens uppdrag  2. Krogrunda  3. Hemlig agent  4. Gissa kvällen  5. Kvällsbingo  6. Sugen-status.
   Hooks from app.js mods(): init, onAuthed, onPoll, onBeerAccepted, onStopped, hudChipsHTML (ONE chip "🎯 1/3"),
   hudClick, groupItem, applyText. Texts: js/games-content.js (window.GAMES_CONTENT) + the UI strings below.
   Every RPC may be missing on an older database: then all of this hides quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null;
  var C = window.GAMES_CONTENT || {};
  var off = {};                 // rpc name -> true when missing on this server
  var state = "unknown";        // game_poll: "unknown" | "on" | "missing"
  var poll = null, pollAt = 0, busy = false, again = false, POLL_MS = 45000, forcedAt = 0;
  var openView = null;          // {kind:"me"} | {kind:"group", g, tab} | {kind:"crawl"} while one of our sheets is open
  var flagLayer = null, flagKey = "";
  var SEEN_KEY = "olnu.gameSeen", TAB_KEY = "olnu.gameTab";
  var CODES = ["not_member", "slow_down", "not_enough", "no_agent", "is_agent", "invalid_suspect", "not_yours", "too_late",
    "invalid_guess", "outside_sweden", "invalid_crawl", "no_card", "crawl_not_found", "invalid_status", "invalid_idx", "not_authenticated"];

  /* ---------- UI strings (Swedish first, English fallback) ---------- */
  var S = {
    sv: {
      chipAria: "Kvällens uppdrag: {0} av {1} klara",
      meTitle: "Kvällens uppdrag",
      meHint: "Uppdragen kollas automatiskt. Inget uppdrag handlar om att dricka mer.",
      waterBtn: "💧 Jag tog vatten",
      waterOk: "💧 Vatten noterat ({0}). Snyggt, soldat!",
      waterWait: "💧 Ett vatten per 5 min räknas. Vänta {0} min.",
      waterMax: "💧 Tio vatten ikväll. Du é officiellt ett vattenverk.",
      homeHint: "Tryck ”Jag är hemma” (⚙️ → Sluta dricka) före 02:00.",
      allDone: "🏅 Alla tre uppdrag klara! Generalstaben tar av sig mössan.",
      loading: "Laddar…",
      fail: "Kunde inte ladda. Försök igen.",
      lek: "Lek",
      lekBtn: "🎲 Lek",
      you: "Du",
      groupsHead: "Gruppens lekar",
      noGroup: "Gå med i en grupp för krogrunda, bingo och hemlig agent.",
      back: "← Tillbaka",
      tabs: { sugen: "🙋 Sugen", runda: "🗺️ Runda", bingo: "🎱 Bingo", agent: "🕵️ Agent", gissa: "🎲 Gissa" },
      // Sugen
      sugenHead: "Sugen ikväll?",
      sugenOpts: { sugen: "🍺 Sugen!", kanske: "🤔 Kanske", inte: "🛋️ Ikväll inte" },
      sugenEmoji: { sugen: "🍺", kanske: "🤔", inte: "🛋️" },
      sugenSet: { sugen: "🍺 Du é sugen! Gruppen ser det.", kanske: "🤔 Kanske. Gruppen ser det.", inte: "🛋️ Soffan vinner ikväll. Gruppen ser det." },
      sugenCleared: "Status borttagen.",
      sugenOut: "Du é redan ute ikväll. 🍺",
      sugenNone: "Ingen har satt status än ikväll.",
      sugenOutTag: "ute",
      sugenNote: "Gäller till 05:00.",
      // Krogrunda
      crawlHead: "Krogrunda",
      crawlNone: "Ingen krogrunda ikväll. Rita en med 2–6 krogar, så bockas stoppen av när ni checkar in.",
      crawlDraw: "🗺️ Rita krogrunda",
      crawlNew: "✏️ Ny runda",
      crawlEnd: "Avsluta rundan",
      crawlEnded: "Krogrundan é avslutad.",
      crawlShow: "📍 Visa på kartan",
      crawlBy: "Ritad av {0}",
      crawlProg: "{0}/{1} stopp",
      crawlDone: "🏁 Klar!",
      crawlStopHint: "Checka in på krogen (📍 i krogens ruta) för att bocka av stoppet.",
      pickTitle: "Rita krogrunda",
      pickHint: "Välj 2–6 krogar i ordning. Listan visar krogar där kartan står nu.",
      pickSearch: "Sök krog…",
      pickNone: "Inga krogar här. Stäng, flytta kartan till krogarna (zooma in) och försök igen.",
      pickSave: "✅ Spara rundan ({0} stopp)",
      pickMax: "Max 6 stopp.",
      pickFlag: "Stopp {0}/{1}",
      // Bingo
      bingoHead: "Kvällsbingo",
      bingoHint: "Bocka av det som händer. Hedersystem: alla ser vem som bockade. Tre i rad = BINGO!",
      bingoLines: "🎱 {0} rad(er) klara",
      bingoToast: "🎱 BINGO i {0}! Tre i rad. Hela gänget jublar.",
      bingoNotYours: "Bara {0} kan ta bort den bocken.",
      // Agent
      agentHead: "Hemlig agent",
      agentStart: "🕵️ Starta hemlig agent",
      agentStartHint: "Servern väljer en av er som é ute ikväll och ger hen ett hemligt (snällt) uppdrag. Imorgon efter 05:00 gissar ni vem det var.",
      agentActive: "🕵️ En hemlig agent é aktiv ikväll. Håll ögonen öppna!",
      agentBy: "Startad av {0}.",
      agentYouCard: "DU é kvällens hemliga agent",
      agentYouOnly: "Bara du ser detta. Avslöja dig int'!",
      agentYouToast: "🕵️ Du é hemlig agent i {0}! Uppdrag: {1}",
      agentNotEnough: "Det behövs minst 3 i gruppen och 2 som é ute ikväll.",
      agentAlready: "Agenten é redan utsedd ikväll.",
      agentStarted: "🕵️ Agenten é utsedd. Nån av er har fått ett hemligt uppdrag…",
      agentVoteQ: "Vem var agenten igår? En röst var.",
      agentVoted: "Du har röstat. {0}/{1} röster. Svaret kommer när alla röstat, senast 12:00.",
      agentWasYou: "Du var agenten igår! Gruppen gissar nu. Svaret kommer senast 12:00.",
      agentVoteToast: "🕵️ Vem var agenten i {0}? Rösta i appen!",
      agentVotes: "{0}/{1} har röstat. Svaret kommer när alla röstat, senast 12:00.",
      agentVoteSent: "🗳️ Röst lagd. Spänningen stiger.",
      agentRight: "🔎 Du gissade rätt! +1 poäng.",
      agentRightNames: "Rätt gissat: {0}",
      agentPoints: "🏆 Agentpoäng: {0}",
      agentMission: "Uppdraget: {0}",
      vote: "Rösta",
      // Gissa
      guessHead: "Gissa kvällen",
      guessTown: "Öl i {0} (2 mil runt) ikväll:",
      guessBtn: "Gissa",
      guessMine: "Din gissning: {0}. Du kan ändra till 21:00.",
      guessClosed: "Gissningen stängde 21:00.",
      guessSoFar: "Din gissning: {0} · hittills ikväll: {1}",
      guessSaved: "🎲 Gissning sparad: {0}. Facit imorgon!",
      guessPrev: "Igår gissade du {0}, det blev {1} i {2}.",
      guessOracle: "🔮 Dagens orakel: {0}",
      guessCount: "{0} i gruppen har gissat ikväll.",
      guessList: "Igår: {0}",
      guessNoTown: "Närområdet",
      errs: {
        not_member: "Du é int' med i gruppen.", slow_down: "Lugn i stormen. Vänta en stund.", not_enough: null,
        no_agent: "Ingen agent att gissa på.", is_agent: "Du var ju agenten själv!", invalid_suspect: "Välj nån annan.",
        too_late: "Gissningen stängde 21:00.", invalid_guess: "Skriv ett tal mellan 0 och 20000.", outside_sweden: "Bara i Sverige.",
        invalid_crawl: "Välj 2–6 olika krogar.", no_card: "Öppna bingon igen.", crawl_not_found: "Rundan finns int' längre.",
        error: "Nåt gick fel. Försök igen."
      }
    },
    en: {
      chipAria: "Tonight's missions: {0} of {1} done",
      meTitle: "Tonight's missions",
      meHint: "Missions are checked automatically. No mission is about drinking more.",
      waterBtn: "💧 I had water",
      waterOk: "💧 Water noted ({0}). Nice, soldier!",
      waterWait: "💧 One water per 5 min counts. Wait {0} min.",
      waterMax: "💧 Ten waters tonight. You are a waterworks.",
      homeHint: "Tap “I'm home” (⚙️ → Stop drinking) before 02:00.",
      allDone: "🏅 All three missions done!",
      loading: "Loading…",
      fail: "Could not load. Try again.",
      lek: "Games",
      lekBtn: "🎲 Games",
      you: "You",
      groupsHead: "Group games",
      noGroup: "Join a group for pub crawls, bingo and the secret agent.",
      back: "← Back",
      tabs: { sugen: "🙋 Up for it", runda: "🗺️ Crawl", bingo: "🎱 Bingo", agent: "🕵️ Agent", gissa: "🎲 Guess" },
      sugenHead: "Up for it tonight?",
      sugenOpts: { sugen: "🍺 Up for it!", kanske: "🤔 Maybe", inte: "🛋️ Not tonight" },
      sugenEmoji: { sugen: "🍺", kanske: "🤔", inte: "🛋️" },
      sugenSet: { sugen: "🍺 You're up for it! Your group sees it.", kanske: "🤔 Maybe. Your group sees it.", inte: "🛋️ Sofa wins. Your group sees it." },
      sugenCleared: "Status removed.",
      sugenOut: "You're already out tonight. 🍺",
      sugenNone: "No status set tonight yet.",
      sugenOutTag: "out",
      sugenNote: "Valid until 05:00.",
      crawlHead: "Pub crawl",
      crawlNone: "No pub crawl tonight. Draw one with 2–6 bars; stops tick when you check in.",
      crawlDraw: "🗺️ Draw a pub crawl",
      crawlNew: "✏️ New crawl",
      crawlEnd: "End crawl",
      crawlEnded: "Pub crawl ended.",
      crawlShow: "📍 Show on map",
      crawlBy: "Drawn by {0}",
      crawlProg: "{0}/{1} stops",
      crawlDone: "🏁 Done!",
      crawlStopHint: "Check in at the bar (📍 in the bar popup) to tick the stop.",
      pickTitle: "Draw a pub crawl",
      pickHint: "Pick 2–6 bars in order. The list shows bars in the current map view.",
      pickSearch: "Search bar…",
      pickNone: "No bars here. Close, move the map to the bars (zoom in) and try again.",
      pickSave: "✅ Save crawl ({0} stops)",
      pickMax: "Max 6 stops.",
      pickFlag: "Stop {0}/{1}",
      bingoHead: "Night bingo",
      bingoHint: "Tick what happens. Honour system: everyone sees who ticked. Three in a row = BINGO!",
      bingoLines: "🎱 {0} line(s) done",
      bingoToast: "🎱 BINGO in {0}! Three in a row.",
      bingoNotYours: "Only {0} can untick that.",
      agentHead: "Secret agent",
      agentStart: "🕵️ Start secret agent",
      agentStartHint: "The server picks one of you who is out tonight and gives them a secret (kind) mission. Tomorrow after 05:00 you guess who.",
      agentActive: "🕵️ A secret agent is active tonight. Keep your eyes open!",
      agentBy: "Started by {0}.",
      agentYouCard: "YOU are tonight's secret agent",
      agentYouOnly: "Only you see this. Don't blow your cover!",
      agentYouToast: "🕵️ You are the secret agent in {0}! Mission: {1}",
      agentNotEnough: "Needs 3+ members and 2 who are out tonight.",
      agentAlready: "The agent is already chosen tonight.",
      agentStarted: "🕵️ Agent chosen. One of you got a secret mission…",
      agentVoteQ: "Who was the agent last night? One vote each.",
      agentVoted: "You voted. {0}/{1} votes. Reveal when all voted, at 12:00 latest.",
      agentWasYou: "You were the agent! The group is guessing. Reveal at 12:00 latest.",
      agentVoteToast: "🕵️ Who was the agent in {0}? Vote in the app!",
      agentVotes: "{0}/{1} have voted. Reveal when all voted, at 12:00 latest.",
      agentVoteSent: "🗳️ Vote cast.",
      agentRight: "🔎 You guessed right! +1 point.",
      agentRightNames: "Guessed right: {0}",
      agentPoints: "🏆 Agent points: {0}",
      agentMission: "Mission: {0}",
      vote: "Vote",
      guessHead: "Guess the night",
      guessTown: "Beers in {0} (20 km) tonight:",
      guessBtn: "Guess",
      guessMine: "Your guess: {0}. You can change it until 21:00.",
      guessClosed: "Guessing closed at 21:00.",
      guessSoFar: "Your guess: {0} · so far tonight: {1}",
      guessSaved: "🎲 Guess saved: {0}. Results tomorrow!",
      guessPrev: "Yesterday you guessed {0}, it was {1} in {2}.",
      guessOracle: "🔮 Oracle of the day: {0}",
      guessCount: "{0} in the group guessed tonight.",
      guessList: "Yesterday: {0}",
      guessNoTown: "Nearby",
      errs: {
        not_member: "You're not in this group.", slow_down: "Easy. Wait a moment.", not_enough: null,
        no_agent: "No agent to guess.", is_agent: "You were the agent!", invalid_suspect: "Pick someone else.",
        too_late: "Guessing closed at 21:00.", invalid_guess: "Enter a number 0–20000.", outside_sweden: "Sweden only.",
        invalid_crawl: "Pick 2–6 different bars.", no_card: "Open the bingo again.", crawl_not_found: "The crawl is gone.",
        error: "Something went wrong. Try again."
      }
    }
  };
  var KIND_EMOJI = { checkin_bars: "📍", skal_give: "🍻", skal_get: "🥂", chat: "💬", rally_yes: "🪖", group_out: "👥", home: "🏠",
    water: "💧", beer_type: "⭐", queue_report: "🚶", tip: "📣", early: "🌇", other_none: "🍺" };

  /* ---------- Helpers ---------- */
  function lang() { return I.lang === "en" ? "en" : "sv"; }
  function T(k) {
    var v = S[lang()][k]; if (v == null) v = S.sv[k];
    if (typeof v !== "string") return v;
    var args = arguments;
    return v.replace(/\{(\d)\}/g, function (m, i) { var a = args[+i + 1]; return a == null ? "" : String(a); });
  }
  function fill(s, o) {
    return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; });
  }
  var lastPick = {};
  function pick(key, list) {
    list = list || [];
    if (!list.length) return "";
    var i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[key]) i = (i + 1) % list.length;
    lastPick[key] = i;
    return list[i];
  }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) {
        off[name] = true; r.off = true;
        if (name === "game_poll") { state = "missing"; poll = null; A.updateCounts(); drawFlags(); }
      }
      return r;
    });
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function errText(err) { var e = T("errs") || {}; return e[codeOf(err)] || e.error; }
  function on() { return !!(A && A.LIVE && state !== "missing"); }
  function fx(kind) {
    try {
      window.FX.unlock();
      if (kind !== "quiet") window.FX.sound.clink();
      window.FX.vibrate(kind === "big" ? [20, 40, 20, 40, 80] : [18, 40, 18]);
    } catch (e) {}
  }
  function award() { if (window.MEDALS && window.MEDALS.award) setTimeout(function () { window.MEDALS.award(null, true); }, 1500); }
  function minsAgo(ts) { var d = Date.parse(ts); return isFinite(d) ? (Date.now() - d) / 60000 : 1e9; }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function missionText(id) {
    var l = C.missions || [];
    for (var i = 0; i < l.length; i++) if (l[i][0] === id) return l[i][3];
    return "";
  }
  function agentText(idx) { var l = (C.secretAgent && C.secretAgent.missions) || []; return l.length ? l[(idx | 0) % l.length] : ""; }
  function squareText(n) { var l = C.bingo || []; return l.length ? l[(n | 0) % l.length] : "?"; }
  function groupOf(id) {
    var gs = (poll && poll.groups) || [];
    for (var i = 0; i < gs.length; i++) if (String(gs[i].id) === String(id)) return gs[i];
    return null;
  }
  function myTown() {
    var c = (A.lastLoc && A.lastLoc()) || A.center();
    if (!c || !isFinite(c.lat)) return null;
    var t = window.CITIES ? window.CITIES.nearest(c.lat, c.lng) : null;
    return t ? { name: t.name, lat: t.lat, lng: t.lng } : { name: T("guessNoTown"), lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100 };
  }

  /* ---------- Toast queue (one at a time, after the app's own toasts) ---------- */
  var tq = [], tqBusy = false;
  function queueToast(msg, opts) {
    tq.push([msg, opts || {}]);
    if (!tqBusy) nextToast();
  }
  function nextToast() {
    var x = tq.shift();
    if (!x) { tqBusy = false; return; }
    tqBusy = true;
    A.toast(x[0], x[1]);
    if (x[1].fx) fx(x[1].fx);
    setTimeout(nextToast, Math.max(2400, Math.min(4500, (x[1].ms || 4000) - 600)));
  }

  /* ---------- Seen keys (per night, so a toast never repeats after a reload) ---------- */
  function seenMap(night) {
    var s = U.ls.getJSON(SEEN_KEY, null);
    if (!s || s.night !== night) s = { night: night, k: {} };
    return s;
  }

  /* ---------- Poll ---------- */
  function load(force) {
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    if (busy) { if (force) again = true; return Promise.resolve(); }
    if (!force && Date.now() - pollAt < POLL_MS) return Promise.resolve();
    if (document.visibilityState === "hidden") return Promise.resolve();
    busy = true; pollAt = Date.now();
    return call("game_poll").then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data);
      if (!d || !d.me) return;
      state = "on";
      var prev = poll;
      poll = d;
      try { notify(prev, d); } catch (e) {}
      A.updateCounts();
      drawFlags();
      var ae = document.activeElement;
      var typing = ae && ae.tagName === "INPUT" && ae.closest && ae.closest(".gm");
      if (openView && openView.kind === "me" && A.sheetOpen() && !typing) renderMe(true);
    }).then(function () {
      busy = false;
      if (again) { again = false; load(true); }
    }, function () { busy = false; });
  }
  function soon(ms) {
    if (Date.now() - forcedAt < 12000) return;
    forcedAt = Date.now();
    setTimeout(function () { load(true); }, ms || 2500);
  }

  // Toasts for things that changed between polls. First poll of a session: only things < 20 min old.
  function notify(prev, d) {
    var night = String(d.night || ""), s = seenMap(night), k = s.k, first = !prev, changed = false, shown = 0;
    // First poll after opening the app: max 2 toasts (the rest is marked seen and waits in the sheets).
    function once(key, fresh, fn) {
      if (k[key]) return;
      k[key] = 1; changed = true;
      if (!fresh || (first && shown >= 2)) return;
      shown++;
      fn();
    }
    var me = d.me || {}, newDone = false;
    (me.missions || []).forEach(function (m) {
      if (!m.done) return;
      once("m" + m.slot + ":" + m.id, !first || m.fresh || minsAgo(m.done_at) < 20, function () {
        newDone = true;
        var line = fill(pick("done", C.missionDone), { m: missionText(m.id) || T("meTitle") });
        queueToast(line, { cls: "promo", ms: 6000, fx: "big" });
      });
    });
    if (newDone) {
      if ((me.done_n | 0) >= 3) once("all", true, function () { queueToast(T("allDone"), { cls: "promo", ms: 5000 }); });
      award();
    }
    (me.agent || []).forEach(function (a) {
      once("ag:" + a.group_id, true, function () {
        queueToast(T("agentYouToast", a.group_name || "", agentText(a.mission)), { cls: "promo", ms: 10000, fx: "quiet",
          action: { label: "🕵️", fn: function () { openGroup({ id: a.group_id, name: a.group_name }, "agent"); } } });
      });
    });
    (d.groups || []).forEach(function (g) {
      var gname = g.name || "";
      (g.sugen || []).forEach(function (x) {
        if (x.is_me || x.status !== "sugen") return;
        once("s:" + g.id + ":" + x.k + ":" + x.at, minsAgo(x.at) < (first ? 20 : 60), function () {
          queueToast(fill(pick("sugen", C.sugen), { name: x.name || "?" }), { cls: "skal", ms: 5000 });
        });
      });
      var c = g.crawl;
      if (c && c.id) {
        var byOther = !c.is_mine;
        once("c:" + c.id, byOther && (!first || minsAgo(c.created_at) < 20), function () {
          queueToast(fill(pick("created", C.pubCrawl && C.pubCrawl.created), { name: c.by || "?", total: c.n }), { ms: 5500,
            action: { label: "🗺️", fn: function () { openGroup(g, "runda"); } } });
        });
        (c.stops || []).forEach(function (st) {
          if (!st.done) return;
          once("cs:" + c.id + ":" + st.i, !first, function () {
            queueToast(fill(pick("stop", C.pubCrawl && C.pubCrawl.stop), { n: (st.i | 0) + 1, total: c.n, bar: st.name || "" }), { ms: 4500 });
          });
        });
        if (c.done) once("cd:" + c.id, !first || minsAgo(c.done_at) < 20, function () {
          queueToast(fill(pick("cdone", C.pubCrawl && C.pubCrawl.done), { total: c.n }), { cls: "promo", ms: 6000, fx: "big" });
          award();
        });
      }
      var b = g.bingo;
      if (b && (b.lines | 0) > 0) {
        once("b:" + g.id + ":" + (b.lines | 0), !first || minsAgo(b.bingo_at) < 20, function () {
          queueToast(T("bingoToast", gname), { cls: "promo", ms: 5500, fx: "big" });
          award();
        });
      }
      var ap = g.agent_prev;
      if (ap && ap.revealed) {
        once("ar:" + g.id, true, function () {
          var line = (ap.correct | 0) > 0
            ? fill(pick("reveal", C.secretAgent && C.secretAgent.reveal), { name: ap.agent_name || "?", m: agentText(ap.mission) })
            : fill(pick("nobody", C.secretAgent && C.secretAgent.nobody), { name: ap.agent_name || "?", m: agentText(ap.mission) });
          queueToast(line + (ap.i_was_right ? " " + T("agentRight") : ""), { cls: "promo", ms: 8000, fx: "big",
            action: { label: "🕵️", fn: function () { openGroup(g, "agent"); } } });
          award();
        });
      } else if (ap && ap.voting && !ap.is_agent && !ap.my_vote) {
        once("av:" + g.id, true, function () {
          queueToast(T("agentVoteToast", gname), { ms: 7000, action: { label: T("vote"), fn: function () { openGroup(g, "agent"); } } });
        });
      }
      var o = g.oracle;
      if (o && o.name) {
        once("o:" + g.id, true, function () {
          var list = +o.err > 0.5 ? C.guessNight && C.guessNight.wayOff : C.guessNight && C.guessNight.winner;
          queueToast(fill(pick("oracle", list), { name: o.name, guess: o.guess, real: o.real }), { ms: 6500 });
          if (o.is_me) award();
        });
      }
    });
    if (changed) U.ls.setJSON(SEEN_KEY, s);
  }

  /* ---------- Map: numbered flags for tonight's crawls ---------- */
  function drawFlags() {
    if (!A || !A.map) return;
    var gs = on() && poll ? poll.groups || [] : [];
    var items = [];
    gs.forEach(function (g) {
      var c = g.crawl; if (!c || !c.stops) return;
      c.stops.forEach(function (st) { if (isFinite(st.lat) && isFinite(st.lng)) items.push({ g: g, c: c, st: st }); });
    });
    var key = JSON.stringify(items.map(function (x) { return [x.c.id, x.st.i, x.st.done]; })) + (A.map.getZoom() >= 11);
    if (key === flagKey) return;
    flagKey = key;
    if (!flagLayer) {
      if (!A.map.getPane("gameflags")) { A.map.createPane("gameflags"); A.map.getPane("gameflags").style.zIndex = 640; }
      flagLayer = L.layerGroup().addTo(A.map);
    }
    flagLayer.clearLayers();
    if (A.map.getZoom() < 11) return;
    items.forEach(function (x) {
      var n = (x.st.i | 0) + 1;
      var icon = L.divIcon({ className: "", iconSize: [26, 30], iconAnchor: [4, 30], popupAnchor: [9, -28],
        html: '<div class="gm-flag' + (x.st.done ? " ok" : "") + (x.c.done ? " fin" : "") + '"><b>' + n + "</b>" + (x.st.done ? "<i>✓</i>" : "") + "</div>" });
      var m = L.marker([x.st.lat, x.st.lng], { icon: icon, pane: "gameflags", keyboard: false, zIndexOffset: 900 });
      m.bindPopup('<div class="pp-title">🗺️ ' + esc(T("pickFlag", n, x.c.n)) + "</div><div>" + esc(x.st.name || "") + (x.st.done ? " ✓" : "") +
        '</div><div class="muted">' + esc(x.g.name || "") + "</div>");
      flagLayer.addLayer(m);
    });
  }

  /* ---------- Sheet: my missions ---------- */
  function openMe() {
    if (!on()) return;
    openView = { kind: "me" };
    renderMe(false);
    load(true);
  }
  function progressBar(p, goal) {
    var pct = Math.max(0, Math.min(100, Math.round((p | 0) * 100 / Math.max(1, goal | 0))));
    return el("span", { class: "gm-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })]);
  }
  function renderMe(keepScroll) {
    var sb = document.getElementById("sheet-body"), top = keepScroll && sb ? sb.scrollTop : 0;
    A.openSheet("🎯 " + T("meTitle"), function (body) {
      var me = (poll && poll.me) || null;
      var box = el("div", { class: "gm" });
      body.appendChild(box);
      if (!me) { box.appendChild(el("p", { class: "muted", text: T("loading") })); return; }
      var list = el("ul", { class: "gm-ms" });
      (me.missions || []).forEach(function (m) {
        var li = el("li", { class: "gm-m" + (m.done ? " done" : "") }, [
          el("span", { class: "gm-m-e", "aria-hidden": "true", text: m.done ? "✅" : (KIND_EMOJI[m.kind] || "🎯") }),
          el("div", { class: "gm-m-b" }, [
            el("div", { class: "gm-m-t", text: missionText(m.id) || m.kind }),
            el("div", { class: "gm-m-p" }, [progressBar(m.progress, m.goal), el("span", { class: "gm-m-n", text: (m.progress | 0) + "/" + (m.goal | 0) })])
          ])
        ]);
        if (!m.done && m.kind === "water") li.querySelector(".gm-m-b").appendChild(A.btn(T("waterBtn"), "btn-small gm-water", function (e) { water(true, e.currentTarget); }));
        if (!m.done && m.kind === "home") li.querySelector(".gm-m-b").appendChild(el("div", { class: "gm-note", text: T("homeHint") }));
        list.appendChild(li);
      });
      box.appendChild(list);
      box.appendChild(el("p", { class: "gm-note", text: T("meHint") }));
      // Sugen (before the first beer) + Gissa kvällen
      box.appendChild(el("h3", { text: T("sugenHead") }));
      box.appendChild(sugenSeg(me, function () { renderMe(true); }));
      box.appendChild(el("h3", { text: T("guessHead") }));
      box.appendChild(guessBlock(me, function () { renderMe(true); }));
      // Group games
      box.appendChild(el("h3", { text: T("groupsHead") }));
      var gs = (poll && poll.groups) || [];
      if (!gs.length) box.appendChild(el("p", { class: "muted", text: T("noGroup") }));
      var row = el("div", { class: "gm-glinks" });
      gs.forEach(function (g) { row.appendChild(A.btn("🎲 " + (g.name || ""), "btn-small", function () { openGroup(g); })); });
      box.appendChild(row);
    });
    if (keepScroll && sb) sb.scrollTop = top;
  }

  function water(fromMission, button) {
    if (button) button.disabled = true;
    return call("game_water").then(function (r) {
      if (button) button.disabled = false;
      if (r.error) { if (fromMission && !r.off) A.toast(errText(r.error), { err: true }); return; }
      var d = A.parseData(r.data);
      if (fromMission) {
        if (d.ok) { A.toast(T("waterOk", d.water | 0), { cls: "water", ms: 3500 }); fx("quiet"); }
        else if (d.reason === "limit") A.toast(T("waterMax"), { cls: "water" });
        else A.toast(T("waterWait", Math.max(1, Math.ceil((d.wait_seconds | 0) / 60))), { cls: "water" });
        if (d.ok && window.MEDALS && window.MEDALS.claim) window.MEDALS.claim("vatten");
      }
      if (d.ok) load(true);
    });
  }

  /* ---------- Sugen ---------- */
  function sugenSeg(me, after) {
    var wrap = el("div", { class: "gm-sugen" });
    if (me && me.out) { wrap.appendChild(el("p", { class: "muted", text: T("sugenOut") })); return wrap; }
    var seg = el("div", { class: "gm-seg", role: "group", "aria-label": T("sugenHead") });
    var opts = T("sugenOpts");
    ["sugen", "kanske", "inte"].forEach(function (s) {
      var onv = me && me.sugen === s;
      seg.appendChild(el("button", { type: "button", class: "gm-sb s-" + s + (onv ? " on" : ""), "aria-pressed": String(!!onv), text: opts[s],
        onclick: function (e) { setSugen(onv ? "none" : s, e.currentTarget, after); } }));
    });
    wrap.appendChild(seg);
    wrap.appendChild(el("div", { class: "gm-note", text: T("sugenNote") }));
    return wrap;
  }
  function setSugen(s, button, after) {
    if (button) button.disabled = true;
    call("set_sugen", { p_status: s }).then(function (r) {
      if (button) button.disabled = false;
      if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
      var d = A.parseData(r.data);
      if (poll && poll.me) poll.me.sugen = d.status || null;
      A.toast(d.status ? T("sugenSet")[d.status] : T("sugenCleared"), { cls: d.status === "sugen" ? "skal" : "", ms: 3500 });
      if (d.status === "sugen") fx("quiet");
      if (after) after();
      load(true);
    });
  }

  /* ---------- Gissa kvällen ---------- */
  function guessBlock(me, after) {
    var box = el("div", { class: "gm-guess" });
    if (!me) return box;
    if (me.guess_prev) box.appendChild(el("p", { class: "gm-note", text: T("guessPrev", me.guess_prev.guess, me.guess_prev.real == null ? "?" : me.guess_prev.real, me.guess_prev.town || "") }));
    if (me.guess_open) {
      var town = myTown();
      if (!town) return box;
      var prompts = (C.guessNight && C.guessNight.prompt) || [];
      if (prompts.length) box.appendChild(el("p", { class: "gm-prompt", text: prompts[(String(poll.night || "").length + new Date().getDate()) % prompts.length] }));
      var inp = el("input", { class: "inp gm-ginp", type: "number", inputmode: "numeric", min: "0", max: "20000", step: "1",
        "aria-label": T("guessTown", town.name), placeholder: "?", value: me.guess ? String(me.guess.guess) : "" });
      var go = A.btn(T("guessBtn"), "btn-small btn-amber", function () {
        var v = parseInt(inp.value, 10);
        if (!isFinite(v) || v < 0 || v > 20000) { A.toast(T("errs").invalid_guess, { err: true }); return; }
        go.disabled = true;
        call("guess_night", { p_guess: v, p_town: town.name, p_lat: town.lat, p_lng: town.lng }).then(function (r) {
          go.disabled = false;
          if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
          if (poll && poll.me) poll.me.guess = { guess: v, town: town.name };
          A.toast(T("guessSaved", v), { ms: 3500 }); fx("quiet");
          if (after) after();
        });
      });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
      box.appendChild(el("label", { class: "gm-glbl", text: T("guessTown", town.name) }));
      box.appendChild(el("div", { class: "gm-grow" }, [inp, go]));
      if (me.guess) box.appendChild(el("div", { class: "gm-note", text: T("guessMine", me.guess.guess) }));
    } else if (me.guess) {
      box.appendChild(el("p", { class: "gm-note", text: me.guess_so_far != null ? T("guessSoFar", me.guess.guess, me.guess_so_far) : T("guessMine", me.guess.guess) }));
    } else {
      box.appendChild(el("p", { class: "muted", text: T("guessClosed") }));
    }
    return box;
  }

  /* ---------- Sheet: one group's games (tabs) ---------- */
  var TABS = ["sugen", "runda", "bingo", "agent", "gissa"];
  function openGroup(g, tab) {
    if (!on() || !g || !g.id) return;
    tab = TABS.indexOf(tab) >= 0 ? tab : (TABS.indexOf(U.ls.get(TAB_KEY, "")) >= 0 ? U.ls.get(TAB_KEY, "") : "sugen");
    openView = { kind: "group", g: g, tab: tab, data: null };
    var view = openView;
    A.openSheet((g.name || "") + " · " + T("lek"), function (body) {
      var box = el("div", { class: "gm" });
      body.appendChild(box);
      box.appendChild(el("div", { class: "gm-top" }, [A.btn(T("back"), "btn-small", function () { openView = null; A.showGroups(); })]));
      var bar = el("div", { class: "gm-tabs", role: "tablist" });
      var pane = el("div", { class: "gm-pane", role: "tabpanel" }, [el("p", { class: "muted", text: T("loading") })]);
      var names = T("tabs");
      TABS.forEach(function (k) {
        bar.appendChild(el("button", { type: "button", role: "tab", class: "gm-tab", "data-t": k, "aria-selected": String(k === view.tab), text: names[k],
          onclick: function () {
            view.tab = k; U.ls.set(TAB_KEY, k);
            bar.querySelectorAll(".gm-tab").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-t") === k)); });
            drawPane();
          } }));
      });
      box.appendChild(bar);
      box.appendChild(pane);
      view.pane = pane;
      function drawPane() { if (view.data) renderTab(view, pane); }
      view.redraw = drawPane;
    });
    reloadGroup(view);
  }
  function reloadGroup(view) {
    return call("game_group", { p_group_id: view.g.id, p_bingo_n: (C.bingo || []).length || 40 }).then(function (r) {
      if (openView !== view || !document.body.contains(view.pane)) return;
      if (r.error) {
        view.pane.innerHTML = "";
        view.pane.appendChild(el("p", { class: "muted", text: r.off ? T("fail") : errText(r.error) }));
        return;
      }
      view.data = A.parseData(r.data);
      view.redraw();
    });
  }
  function renderTab(view, pane) {
    var d = view.data, f = { sugen: tabSugen, runda: tabCrawl, bingo: tabBingo, agent: tabAgent, gissa: tabGuess }[view.tab];
    pane.innerHTML = "";
    try { f(view, d, pane); } catch (e) { pane.appendChild(el("p", { class: "muted", text: T("fail") })); try { console.warn("olnu games", e); } catch (x) {} }
  }
  function again2(view) { return function () { reloadGroup(view); load(true); }; }

  function tabSugen(view, d, pane) {
    var me = (poll && poll.me) || {};
    pane.appendChild(el("h3", { text: T("sugenHead") }));
    pane.appendChild(sugenSeg(me, again2(view)));
    var rows = d.sugen || [];
    if (!rows.length) { pane.appendChild(el("p", { class: "muted", text: T("sugenNone") })); return; }
    var ul = el("ul", { class: "gm-slist" });
    var em = T("sugenEmoji"), opts = T("sugenOpts");
    rows.forEach(function (x) {
      ul.appendChild(el("li", { class: "gm-srow s-" + x.status + (x.is_me ? " me" : "") }, [
        el("span", { class: "gm-se", "aria-hidden": "true", text: em[x.status] || "" }),
        el("span", { class: "gm-sn", text: x.name || "?" }),
        el("span", { class: "gm-ss", text: (opts[x.status] || "").replace(/^\S+\s/, "") + (x.out ? " · " + T("sugenOutTag") + " 🍺" : "") }),
        el("span", { class: "gm-st", text: x.at ? U.timeHM(x.at) : "" })
      ]));
    });
    pane.appendChild(ul);
  }

  function tabCrawl(view, d, pane) {
    var c = d.crawl;
    pane.appendChild(el("h3", { text: T("crawlHead") + (c ? " · " + T("crawlProg", c.done_n | 0, c.n | 0) : "") }));
    if (!c) {
      pane.appendChild(el("p", { class: "muted", text: T("crawlNone") }));
      pane.appendChild(A.btn(T("crawlDraw"), "btn-amber btn-block", function () { openPicker(view.g); }));
      return;
    }
    if (c.done) pane.appendChild(el("div", { class: "gm-done", text: T("crawlDone") }));
    if (c.by) pane.appendChild(el("div", { class: "gm-note", text: T("crawlBy", c.by) }));
    var ol = el("ol", { class: "gm-stops" });
    (c.stops || []).forEach(function (st) {
      ol.appendChild(el("li", { class: "gm-stop" + (st.done ? " ok" : "") }, [
        el("span", { class: "gm-sn2", text: String((st.i | 0) + 1) }),
        el("div", { class: "gm-stb" }, [
          el("div", { class: "gm-stn", text: st.name || "?" }),
          st.done && st.who && st.who.length ? el("div", { class: "gm-stw", text: "✓ " + st.who.join(", ") }) : null
        ]),
        A.btn("📍", "btn-small gm-go", function () { openView = null; A.flyTo(st.lat, st.lng, 17, null); })
      ]));
    });
    pane.appendChild(ol);
    if (!c.done) pane.appendChild(el("p", { class: "gm-note", text: T("crawlStopHint") }));
    var row = el("div", { class: "gm-row" }, [
      A.btn(T("crawlShow"), "btn-small", function () { showCrawlOnMap(c); }),
      A.btn(T("crawlNew"), "btn-small", function () { openPicker(view.g); })
    ]);
    pane.appendChild(row);
    if (c.is_mine && !c.done) pane.appendChild(A.btn(T("crawlEnd"), "btn-small btn-danger btn-block gm-end", function (e) {
      e.currentTarget.disabled = true;
      call("close_crawl", { p_crawl_id: c.id }).then(function (r) {
        if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
        A.toast(T("crawlEnded")); again2(view)();
      });
    }));
  }
  function showCrawlOnMap(c) {
    var pts = (c.stops || []).filter(function (s) { return isFinite(s.lat) && isFinite(s.lng); }).map(function (s) { return [s.lat, s.lng]; });
    if (!pts.length) return;
    A.closeSheet();
    try { A.map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 17 }); } catch (e) {}
    setTimeout(drawFlags, 400);
  }

  // Bar picker: bars in the current map view, nearest the map centre first.
  function openPicker(g) {
    var sel = [], q = "";
    openView = { kind: "crawl", g: g };
    var center = A.map.getCenter();
    var all = [];
    try { all = window.BARS.inBounds(A.map.getBounds(), 600) || []; } catch (e) { all = []; }
    all = all.filter(function (b) { return b && b.name && isFinite(b.lat) && isFinite(b.lng); }).map(function (b) {
      return { bar: b, d: U.haversine(center.lat, center.lng, b.lat, b.lng) };
    }).sort(function (a, b) { return a.d - b.d; });
    A.openSheet("🗺️ " + T("pickTitle"), function (body) {
      var box = el("div", { class: "gm" });
      body.appendChild(box);
      box.appendChild(el("div", { class: "gm-top" }, [A.btn(T("back"), "btn-small", function () { openGroup(g, "runda"); })]));
      box.appendChild(el("p", { class: "gm-note", text: T("pickHint") }));
      var chips = el("ol", { class: "gm-pchips" });
      var inp = el("input", { class: "inp gm-psearch", type: "search", placeholder: T("pickSearch"), "aria-label": T("pickSearch") });
      var list = el("ul", { class: "gm-plist" });
      var save = A.btn("", "btn-amber btn-block gm-psave", function () {
        if (sel.length < 2 || sel.length > 6) return;
        save.disabled = true;
        var stops = sel.map(function (b) { return { id: String(b.id), name: String(b.name).slice(0, 60), lat: b.lat, lng: b.lng }; });
        call("create_crawl", { p_group_id: g.id, p_stops: stops }).then(function (r) {
          save.disabled = false;
          if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
          A.toast(fill(pick("created", C.pubCrawl && C.pubCrawl.created), { name: A.getName() || T("you"), total: stops.length }), { cls: "promo", ms: 5000 });
          fx();
          var s = seenMap(poll ? String(poll.night || "") : ""); s.k["c:" + A.parseData(r.data).id] = 1; U.ls.setJSON(SEEN_KEY, s);
          load(true);
          openGroup(g, "runda");
        });
      });
      box.appendChild(chips);
      box.appendChild(inp);
      box.appendChild(list);
      box.appendChild(save);
      function draw() {
        chips.innerHTML = "";
        sel.forEach(function (b, i) {
          chips.appendChild(el("li", {}, [el("button", { type: "button", class: "gm-pchip", "aria-label": "✕ " + b.name, text: (i + 1) + ". " + b.name + " ✕",
            onclick: function () { sel.splice(i, 1); draw(); } })]));
        });
        save.textContent = T("pickSave", sel.length);
        save.disabled = sel.length < 2 || sel.length > 6;
        list.innerHTML = "";
        var ql = q.toLowerCase(), shown = 0;
        if (!all.length) { list.appendChild(el("li", { class: "muted", text: T("pickNone") })); return; }
        for (var i = 0; i < all.length && shown < 40; i++) {
          var b = all[i].bar;
          if (ql && String(b.name).toLowerCase().indexOf(ql) < 0) continue;
          var idx = sel.indexOf(b);
          shown++;
          list.appendChild(el("li", {}, [el("button", { type: "button", class: "gm-pbar" + (idx >= 0 ? " on" : ""), "aria-pressed": String(idx >= 0),
            onclick: (function (bar) { return function () {
              var j = sel.indexOf(bar);
              if (j >= 0) sel.splice(j, 1);
              else if (sel.length >= 6) { A.toast(T("pickMax")); return; }
              else sel.push(bar);
              draw();
            }; })(b) }, [
            el("span", { class: "gm-pn", text: (idx >= 0 ? (idx + 1) + ". " : "") + b.name }),
            el("span", { class: "gm-pd", text: all[i].d < 1000 ? Math.round(all[i].d / 10) * 10 + " m" : (all[i].d / 1000).toFixed(1) + " km" })
          ])]));
        }
      }
      inp.addEventListener("input", function () { q = inp.value.trim(); draw(); });
      draw();
    });
  }

  function tabBingo(view, d, pane) {
    var b = d.bingo;
    pane.appendChild(el("h3", { text: T("bingoHead") }));
    if (!b || !b.card) { pane.appendChild(el("p", { class: "muted", text: T("fail") })); return; }
    var ticks = {};
    (b.ticks || []).forEach(function (x) { ticks[x.idx] = x; });
    if ((b.lines | 0) > 0) pane.appendChild(el("div", { class: "gm-done gm-bingo-l", text: T("bingoLines", b.lines | 0) }));
    var grid = el("div", { class: "gm-grid", role: "grid" });
    b.card.forEach(function (sq, i) {
      var t = ticks[i];
      grid.appendChild(el("button", { type: "button", class: "gm-sq" + (t ? " on" : "") + (t && t.is_me ? " me" : ""), "aria-pressed": String(!!t),
        onclick: function (e) { tick(view, i, t, e.currentTarget); } }, [
        el("span", { class: "gm-sqt", text: squareText(sq) }),
        t ? el("span", { class: "gm-sqw", text: "✓ " + (t.name || "?") }) : null
      ]));
    });
    pane.appendChild(grid);
    pane.appendChild(el("p", { class: "gm-note", text: T("bingoHint") }));
  }
  function tick(view, i, t, button) {
    if (t && !t.is_me) { A.toast(T("bingoNotYours", t.name || "?")); return; }
    button.disabled = true;
    call("tick_bingo", { p_group_id: view.g.id, p_idx: i, p_on: !t }).then(function (r) {
      button.disabled = false;
      if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
      var d = A.parseData(r.data);
      try { window.FX.vibrate(12); } catch (e) {}
      if (d.new_bingo) {
        var s = seenMap(poll ? String(poll.night || "") : ""); s.k["b:" + view.g.id + ":" + (d.lines | 0)] = 1; U.ls.setJSON(SEEN_KEY, s);
        queueToast(T("bingoToast", view.g.name || ""), { cls: "promo", ms: 5500, fx: "big" });
        award();
      }
      reloadGroup(view);
    });
  }

  function tabAgent(view, d, pane) {
    pane.appendChild(el("h3", { text: T("agentHead") }));
    var a = d.agent, ap = d.agent_prev;
    // Last night first (the morning game), then tonight.
    if (ap) {
      var card = el("div", { class: "gm-card" });
      if (ap.revealed) {
        var line = (ap.correct | 0) > 0
          ? fill((C.secretAgent && C.secretAgent.reveal || [""])[0], { name: ap.agent_name || "?", m: agentText(ap.mission) })
          : fill((C.secretAgent && C.secretAgent.nobody || [""])[0], { name: ap.agent_name || "?", m: agentText(ap.mission) });
        card.appendChild(el("div", { class: "gm-reveal", text: line }));
        if ((ap.correct | 0) > 0) card.appendChild(el("div", { class: "gm-agm", text: T("agentMission", agentText(ap.mission)) }));
        if (ap.correct_names && ap.correct_names.length) card.appendChild(el("div", { class: "gm-note", text: T("agentRightNames", ap.correct_names.join(", ")) }));
        if (ap.i_was_right) card.appendChild(el("div", { class: "gm-done", text: T("agentRight") }));
      } else if (ap.is_agent) {
        card.appendChild(el("div", { class: "gm-reveal", text: T("agentWasYou") }));
        card.appendChild(el("div", { class: "gm-agm", text: T("agentMission", agentText(ap.mission)) }));
      } else if (ap.my_vote) {
        card.appendChild(el("div", { text: T("agentVoted", ap.votes | 0, ap.needed | 0) }));
      } else {
        card.appendChild(el("div", { class: "gm-vq", text: T("agentVoteQ") }));
        var vg = el("div", { class: "gm-votes" });
        (d.members || []).forEach(function (m) {
          if (m.is_me) return;
          vg.appendChild(el("button", { type: "button", class: "gm-vb", text: m.name || "?", onclick: function (e) { vote(view, m.k, e.currentTarget); } }));
        });
        card.appendChild(vg);
        card.appendChild(el("div", { class: "gm-note", text: T("agentVotes", ap.votes | 0, ap.needed | 0) }));
      }
      pane.appendChild(card);
    }
    if (a && a.active) {
      if (a.is_me) {
        pane.appendChild(el("div", { class: "gm-secret" }, [
          el("div", { class: "gm-sec-h", text: "🕵️ " + T("agentYouCard") }),
          el("div", { class: "gm-sec-m", text: agentText(a.mission) }),
          el("div", { class: "gm-note", text: T("agentYouOnly") })
        ]));
      } else {
        pane.appendChild(el("p", { text: T("agentActive") }));
        if (a.by) pane.appendChild(el("div", { class: "gm-note", text: T("agentBy", a.by) }));
      }
    } else {
      pane.appendChild(el("p", { class: "gm-note", text: T("agentStartHint") }));
      pane.appendChild(A.btn(T("agentStart"), "btn-amber btn-block", function (e) {
        var b = e.currentTarget; b.disabled = true;
        call("start_agent", { p_group_id: view.g.id }).then(function (r) {
          b.disabled = false;
          if (r.error) {
            if (r.off) return;
            A.toast(codeOf(r.error) === "not_enough" ? T("agentNotEnough") : errText(r.error), { err: true, ms: 5000 });
            return;
          }
          var x = A.parseData(r.data);
          A.toast(x.already ? T("agentAlready") : T("agentStarted"), { ms: 5000 });
          if (!x.already) fx("quiet");
          again2(view)();
        });
      }));
    }
    var pts = d.points || [];
    if (pts.length) pane.appendChild(el("p", { class: "gm-note gm-pts", text: T("agentPoints", pts.slice(0, 6).map(function (p) { return (p.name || "?") + " " + (p.pts | 0); }).join(" · ")) }));
  }
  function vote(view, k, button) {
    button.disabled = true;
    call("vote_agent", { p_group_id: view.g.id, p_member: k }).then(function (r) {
      button.disabled = false;
      if (r.error) { if (!r.off) A.toast(errText(r.error), { err: true }); return; }
      A.toast(T("agentVoteSent"), { ms: 3000 }); fx("quiet");
      again2(view)();
    });
  }

  function tabGuess(view, d, pane) {
    pane.appendChild(el("h3", { text: T("guessHead") }));
    var o = d.oracle;
    if (o && o.name) {
      var list = +o.err > 0.5 ? C.guessNight && C.guessNight.wayOff : C.guessNight && C.guessNight.winner;
      pane.appendChild(el("div", { class: "gm-card" }, [
        el("div", { class: "gm-reveal", text: T("guessOracle", o.name) }),
        el("div", { class: "gm-note", text: fill((list || [""])[0], { name: o.name, guess: o.guess, real: o.real }) })
      ]));
    }
    var prev = d.guesses_prev || [];
    if (prev.length) pane.appendChild(el("p", { class: "gm-note", text: T("guessList", prev.map(function (x) { return (x.name || "?") + " " + x.guess + (x.real != null ? "→" + x.real : ""); }).join(" · ")) }));
    pane.appendChild(guessBlock((poll && poll.me) || null, again2(view)));
    var n = (d.guessed || []).length;
    if (n) pane.appendChild(el("p", { class: "gm-note", text: T("guessCount", n) }));
  }

  /* ---------- Group list row (groupItem) ---------- */
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || state === "missing" || !g || !g.id) return;
    var row = el("div", { class: "gm-gi" });
    var pg = groupOf(g.id);
    var em = T("sugenEmoji");
    if (pg && pg.sugen && pg.sugen.length) {
      var chips = el("div", { class: "gm-gchips" });
      pg.sugen.slice(0, 5).forEach(function (x) {
        chips.appendChild(el("span", { class: "gm-gchip s-" + x.status, text: (em[x.status] || "") + " " + (x.is_me ? T("you") : x.name || "?") }));
      });
      if (pg.sugen.length > 5) chips.appendChild(el("span", { class: "gm-gchip", text: "+" + (pg.sugen.length - 5) }));
      row.appendChild(chips);
    }
    var sum = [];
    if (pg) {
      if (pg.crawl) sum.push("🗺️ " + (pg.crawl.done_n | 0) + "/" + (pg.crawl.n | 0));
      if (pg.bingo) sum.push("🎱 " + ((pg.bingo.lines | 0) > 0 ? "BINGO" : (pg.bingo.ticks | 0) + "/9"));
      if (pg.agent_prev && pg.agent_prev.voting && !pg.agent_prev.my_vote && !pg.agent_prev.is_agent) sum.push("🕵️ " + T("vote") + "!");
      else if (pg.agent && pg.agent.active) sum.push("🕵️");
      if (pg.oracle && pg.oracle.name) sum.push("🔮 " + pg.oracle.name);
    }
    var b = el("button", { type: "button", class: "btn btn-small btn-block gm-gbtn" }, [
      el("span", { class: "gm-gl", text: T("lekBtn") }),
      sum.length ? el("span", { class: "gm-gs", text: sum.join(" · ") }) : null
    ]);
    b.addEventListener("click", function () { openGroup(pg || g); });
    row.appendChild(b);
    wrap.appendChild(row);
  }

  /* ---------- Public hooks ---------- */
  window.GAMES = {
    state: function () { return state; },
    data: function () { return poll; },
    openMe: openMe, openGroup: openGroup,
    init: function (api) {
      A = api;
      A.map.on("zoomend", function () { drawFlags(); });
      // Water taps from the existing water toast ("💧 Druckit vatten") also count for the water mission.
      try {
        var M = window.MEDALS;
        if (M && typeof M.waterTaken === "function" && !M._gamesWrapped) {
          var orig = M.waterTaken;
          M.waterTaken = function () { var r = orig.apply(this, arguments); try { water(false); } catch (e) {} return r; };
          M._gamesWrapped = true;
        }
      } catch (e) {}
      // Skål, rally answers, check-ins, queue reports, tips, chat: refresh mission progress a bit later.
      document.addEventListener("click", function (e) {
        if (!on() || !poll) return;
        var b = e.target && e.target.closest && e.target.closest("button");
        if (!b || (b.closest && b.closest(".gm"))) return;
        soon(3000);
      }, true);
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
      // Our sheets: forget the view when the sheet closes.
      var close = document.getElementById("sheet-close"), bd = document.getElementById("backdrop");
      [close, bd].forEach(function (x) { if (x) x.addEventListener("click", function () { openView = null; }); });
    },
    applyText: function () { flagKey = ""; drawFlags(); },
    onAuthed: function () { load(true); },
    onPoll: function () { load(false); },
    onBeerAccepted: function () { setTimeout(function () { load(true); }, 3500); },
    onStopped: function (kind) {
      if (kind !== "home" || !on()) return;
      call("game_home").then(function () { setTimeout(function () { load(true); }, 1200); });
    },
    // ONE HUD chip: "🎯 1/3" (missions). Tap = my missions sheet.
    hudChipsHTML: function () {
      if (!on() || !poll || !poll.me || !(poll.me.missions || []).length) return "";
      var n = (poll.me.missions || []).length, dn = Math.min(n, poll.me.done_n | 0);
      return '<button type="button" class="hx-chip gm-chip' + (dn >= n ? " all" : "") + '" data-hx="games" aria-label="' + esc(T("chipAria", dn, n)) + '">🎯 ' + dn + "/" + n + "</button>";
    },
    hudClick: function (action) { if (action === "games") openMe(); },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
