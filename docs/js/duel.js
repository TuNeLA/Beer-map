/* Öl Nu v23 — ⚔️ GRUPPDUELLEN (CONTRACT "v23 ÖNSKELISTAN + GRUPPDUELLEN", migration 0031).
   Group vs group: which group has the most drinks tonight (plain total since the duel started, until 05:00).
   Main way in: "⚔️ Utmana grupp" shows a QR code (./?duel=TOKEN). A member of another group scans it and taps once.
   Fallback: type the other group's group code (they accept or decline), or pick an opted-in group near you.
   Several duels at once (max 10 per group per night). A member of both groups picks one side per duel.
   Truppanda (check-ins, skål, photos) = side stat + tiebreaker. Winner card the next morning with a medal.
   window.DUEL, called through app.js mods(): init, onAuthed, onPoll, groupItem, hudChipsHTML, hudClick.
   Deep link ?duel=TOKEN is read here (app.js does not touch it). A missing RPC (old database) = no duel UI at all.
   Styles: docs/duel.css. In-app only: no push events. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var state = "unknown";           // duel_poll: unknown | on | missing
  var data = null, loadedAt = 0, busy = false, POLL_MS = 30000;
  var view = null;                 // open duel sheet: { g, box, timer }
  var linkToken = null;            // ?duel=TOKEN waiting for sign-in
  var SEEN_KEY = "olnu.duelSeen", LINE_KEY = "olnu.duelLine";

  try {
    var q = new URLSearchParams(location.search), tk = q.get("duel");
    if (tk) {
      linkToken = String(tk).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      q.delete("duel");
      var qs = q.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }
  } catch (e) {}

  function sv() { return !I || I.lang !== "en"; }

  /* ---------- Texts ---------- */
  var S = {
    sv: {
      btn: "⚔️ Utmana grupp", duels: "⚔️ Dueller", sheet: "⚔️ Duell · {0}", vs: "{0} mot {1}",
      intro: "Vilken grupp dricker mest ikväll? Alla drinkar räknas från att duellen startar till kl. 05:00.",
      qrHead: "📱 Visa den här för den andra gruppen", qrNote: "De skannar med kameran och trycker en gång. Klart!",
      qrCode: "Duellkod: {0}", qrExp: "Koden gäller till {0}.", qrNew: "⚔️ Visa utmaningskod", copyLink: "📋 Kopiera länk", share: "📤 Dela",
      shareText: "⚔️ {0} utmanar er på duell i Öl Nu! Tryck här:",
      typeHead: "⌨️ Har ni en kod?", typePh: "Duellkod (8) eller gruppkod (6)", typeGo: "⚔️ Kör", typeNote: "Duellkod = ni antar direkt. Gruppkod = de får en utmaning att svara på.",
      nearHead: "📍 Grupper nära er ikväll", nearNone: "Inga öppna grupper ute nära er just nu.", nearBtn: "⚔️ Utmana", nearPos: "Slå på platsen så hittar vi grupper nära dig.",
      nearOut: "{0} ute · {1} i gruppen", openLabel: "Låt grupper nära oss utmana oss", openOn: "📍 Nu kan grupper nära er utmana er.", openOff: "🔒 Ni syns int’ längre i listan.",
      active: "Pågår", pending: "Väntar på svar", incoming: "⚔️ {0} utmanar er!", outgoing: "⏳ Väntar på att {0} svarar…",
      accept: "⚔️ Anta", decline: "🏳️ Neka", cancel: "Ta tillbaka", accepted: "⚔️ Duellen ä igång! Mot {0}.", declined: "🏳️ Ni nekade. Fegt eller klokt? Ingen vet.",
      cancelled: "Utmaningen ä återtagen.", sent: "📯 Utmaningen ä skickad till {0}! De har 30 min på sig.",
      drinks: "🍺 Drinkar", members: "👥 Med", spirit: "🤝 Truppanda", spiritNote: "Truppanda = incheckningar, skål och bilder. Avgör vid lika.",
      left: "⏱️ {0} kvar", leftEnd: "slut kl. 05:00", us: "Vi", them: "De",
      won: "🎖️ SEGER! {0} vann mot {1}", lost: "🫡 {1} vann den här gången", draw: "🤝 Oavgjort mot {1}", final: "Slutställning {0}–{1}",
      medal: "🥇 Medalj till {0}! Totalt {1} 🎖️", wins: "🎖️ {0} segrar", revenge: "Revansch nästa helg? 😏",
      pickHead: "⚔️ Du ä med i båda – vilken sida kämpar du för?", pickNote: "Dina drinkar räknas bara för den sida du väljer. Du kan byta en gång inom 10 min.",
      pickOk: "⚔️ Du kämpar för {0}!", picked: "Du kämpar för {0}", pickSwitch: "Byt sida", pickLocked: "🔒 Låst för kvällen",
      undecided: "{0} i båda grupperna har int’ valt sida", noPick: "⚠️ Välj sida! Tills dess räknas du inte.",
      league: "🏆 Duelltabell ikväll", leading: "leder", behind: "ligger under", tied: "lika", lead: "Ni leder {0} av {1} dueller",
      none: "Inga dueller ikväll. Utmana en grupp!", chipIn: "⚔️ Utmaning!", chipPick: "⚔️ Välj sida", chipWin: "🎖️ Duellen", chipLive: "⚔️ {0}–{1}",
      chipAria: "Gruppduell", linkHead: "⚔️ {0} utmanar er!", linkMembers: "{0} i gruppen", linkPick: "Vilken av era grupper tar fighten?",
      linkGo: "⚔️ Anta för {0}", linkMine: "Det här ä er egen duellkod. Visa den för en annan grupp!", linkNoGroup: "Du måste vara med i en grupp för att anta.",
      linkGroups: "👥 Grupper", stDueling: "redan i duell", stFull: "max 10 dueller", stSame: "samma grupp",
      already: "Ni ä redan i duell med {0}.", toastIn: "⚔️ {0} utmanar {1} på duell!", toastWin: "🎖️ {0} vann duellen mot {1}!", toastLost: "🫡 {1} vann duellen mot {0}.",
      toastPick: "⚔️ Du ä med i båda grupperna. Välj sida!", open: "Öppna", answer: "Svara", pickBtn: "Välj",
      loading: "Laddar…", fail: "Kunde int’ ladda. Försök igen.",
      errs: {
        token_not_found: "Duellkoden har gått ut. Be dem visa en ny.", same_group: "Ni kan int’ duellera mot er själva. Även om det vore kul.",
        not_member: "Du ä int’ med i den gruppen.", too_many_duels: "Max 10 dueller per grupp och kväll.", already_dueling: "Ni ä redan i duell med dem ikväll.",
        group_not_found: "Ingen grupp med den koden.", slow_down: "Lugn i stormen! Vänta en stund.", duel_not_found: "Duellen finns int’ längre.",
        duel_over: "Duellen ä redan över.", side_locked: "Du har redan valt. Sidan ä låst för kvällen.", not_both: "Du ä bara med i en av grupperna.",
        invalid_side: "Välj en av de två grupperna.", outside_sweden: "Ogiltig plats.", code_generation_failed: "Kunde int’ skapa kod. Försök igen.",
        not_authenticated: "Du ä int’ inloggad än. Försök igen om en stund."
      }
    },
    en: {
      btn: "⚔️ Challenge a group", duels: "⚔️ Duels", sheet: "⚔️ Duel · {0}", vs: "{0} vs {1}",
      intro: "Which group drinks the most tonight? All drinks count from the start of the duel until 05:00.",
      qrHead: "📱 Show this to the other group", qrNote: "They scan it with the camera and tap once.", qrCode: "Duel code: {0}", qrExp: "Valid until {0}.",
      qrNew: "⚔️ Show challenge code", copyLink: "📋 Copy link", share: "📤 Share", shareText: "⚔️ {0} challenges you to a duel in Öl Nu! Tap here:",
      typeHead: "⌨️ Got a code?", typePh: "Duel code (8) or group code (6)", typeGo: "⚔️ Go", typeNote: "Duel code = accept at once. Group code = they get a challenge.",
      nearHead: "📍 Groups near you tonight", nearNone: "No open groups out near you right now.", nearBtn: "⚔️ Challenge", nearPos: "Turn on location to find groups near you.",
      nearOut: "{0} out · {1} members", openLabel: "Let groups nearby challenge us", openOn: "📍 Groups nearby can now challenge you.", openOff: "🔒 You are hidden from the list.",
      active: "Live", pending: "Waiting", incoming: "⚔️ {0} challenges you!", outgoing: "⏳ Waiting for {0}…",
      accept: "⚔️ Accept", decline: "🏳️ Decline", cancel: "Take back", accepted: "⚔️ Duel on! Against {0}.", declined: "🏳️ Declined.",
      cancelled: "Challenge taken back.", sent: "📯 Challenge sent to {0}! They have 30 min.",
      drinks: "🍺 Drinks", members: "👥 In", spirit: "🤝 Team spirit", spiritNote: "Team spirit = check-ins, cheers and photos. Breaks a tie.",
      left: "⏱️ {0} left", leftEnd: "ends 05:00", us: "Us", them: "Them",
      won: "🎖️ VICTORY! {0} beat {1}", lost: "🫡 {1} won this time", draw: "🤝 Draw with {1}", final: "Final {0}–{1}",
      medal: "🥇 Medal for {0}! Total {1} 🎖️", wins: "🎖️ {0} wins", revenge: "Rematch next weekend? 😏",
      pickHead: "⚔️ You are in both groups – which side do you fight for?", pickNote: "Your drinks count only for the side you pick. One switch within 10 min.",
      pickOk: "⚔️ You fight for {0}!", picked: "You fight for {0}", pickSwitch: "Switch side", pickLocked: "🔒 Locked for tonight",
      undecided: "{0} in both groups have not picked a side", noPick: "⚠️ Pick a side! Until then you count for nobody.",
      league: "🏆 Duel table tonight", leading: "leading", behind: "behind", tied: "tied", lead: "You lead {0} of {1} duels",
      none: "No duels tonight. Challenge a group!", chipIn: "⚔️ Challenge!", chipPick: "⚔️ Pick side", chipWin: "🎖️ Duel", chipLive: "⚔️ {0}–{1}",
      chipAria: "Group duel", linkHead: "⚔️ {0} challenges you!", linkMembers: "{0} members", linkPick: "Which of your groups takes the fight?",
      linkGo: "⚔️ Accept for {0}", linkMine: "This is your own duel code. Show it to another group!", linkNoGroup: "You must be in a group to accept.",
      linkGroups: "👥 Groups", stDueling: "already dueling", stFull: "max 10 duels", stSame: "same group",
      already: "You are already dueling {0}.", toastIn: "⚔️ {0} challenges {1}!", toastWin: "🎖️ {0} won the duel against {1}!", toastLost: "🫡 {1} won the duel against {0}.",
      toastPick: "⚔️ You are in both groups. Pick a side!", open: "Open", answer: "Answer", pickBtn: "Pick",
      loading: "Loading…", fail: "Could not load. Try again.",
      errs: {
        token_not_found: "The duel code has expired. Ask for a new one.", same_group: "You cannot duel yourselves.", not_member: "You are not in that group.",
        too_many_duels: "Max 10 duels per group per night.", already_dueling: "Already dueling them tonight.", group_not_found: "No group with that code.",
        slow_down: "Easy! Wait a moment.", duel_not_found: "That duel is gone.", duel_over: "The duel is over.", side_locked: "Your side is locked for tonight.",
        not_both: "You are only in one of the groups.", invalid_side: "Pick one of the two groups.", outside_sweden: "Invalid location.",
        code_generation_failed: "Could not make a code. Try again.", not_authenticated: "Not signed in yet."
      }
    }
  };
  /* Commentary: rivalry and hype about who leads. Never urges drinking more or faster. {u} = us, {t} = them. */
  var LINES = {
    start: [
      "📯 Trumpeterna ljuder! {u} mot {t}. Må bästa grupp vinna.",
      "🪖 Duellen ä igång. Fanorna ä hissade över Dalarna.",
      "⚔️ Två grupper, en kväll, en vinnare. Historien skrivs nu.",
      "🗺️ Generalstaben har ritat fronten. {u} på ena sidan, {t} på andra.",
      "🐎 Kavalleriet ä uppsuttet. Nu ä det {u} mot {t}.",
      "📜 Krigsförklaringen ä underskriven med fin penna.",
      "🥁 Trummorna slår. Det här blir en kväll att berätta om."
    ],
    lead: [
      "🔥 {u} leder! {t} tittar oroligt i kikaren.",
      "🏰 {u} håller borgen. {t} står utanför vallgraven.",
      "🎖️ {u} ligger före. Generalen ler under mustaschen.",
      "🗻 {u} har tagit höjden. Utsikten ä fin däruppe.",
      "📈 {u} drar ifrån. Krigskorrespondenten skriver redan rubriken.",
      "🦅 {u} flyger högst just nu. {t} får nöja sig med utsikten underifrån.",
      "🐺 {u} leder flocken. {t} hörs yla i fjärran.",
      "🛡️ {u} har övertaget. Sköldarna blänker i krogljuset.",
      "🏆 {u} i ledningen! Pokalen putsas redan i Ludvika.",
      "🎺 Segerfanfaren övar redan för {u}. Men det ä långt kvar.",
      "🪵 {u} har staplat mest ved inför vintern. {t} fryser lite.",
      "🐴 {u} står stolt som en nymålad dalahäst."
    ],
    behind: [
      "🧭 {t} leder just nu. Men kvällen ä ung och kartan ä stor.",
      "🫡 {t} ligger före. {u} omgrupperar i skyttegraven.",
      "🌲 {t} har fått ett försprång. {u} smyger genom skogen.",
      "📡 Spaningen rapporterar: {t} leder. Truppandan avgör om det blir lika!",
      "🪖 {u} ligger efter, men en riktig armé ger aldrig upp moralen.",
      "🎯 {t} leder. {u} siktar på en legendarisk comeback-berättelse.",
      "⛺ {u} har slagit läger bakom linjen. Ingen panik, bara strategi.",
      "🐢 {t} leder, men minns sagan om sköldpaddan och haren.",
      "🗡️ {t} har övertaget. {u} vässar svärden och skämten.",
      "🏔️ {t} står på toppen. {u} njuter av den vackra vyn nedifrån."
    ],
    tied: [
      "⚖️ Dött lopp! {u} och {t} står exakt lika.",
      "🤝 Lika! Truppandan kan bli avgörande ikväll.",
      "🪙 Myntet står på kant. Ingen leder.",
      "🎭 Jämnt som i en riktig Dalarna-derby. Spänningen ä olidlig.",
      "📻 Radion sprakar: ställningen ä lika. Håll ut, alla soldater.",
      "🧊 Iskall jämvikt. Det här kan gå hur som helst."
    ],
    big: [
      "🚀 {u} har en ledning som syns från rymden!",
      "🏔️ {u} leder stort. {t} skickar en vit flagga med brevduva? Nej, de kämpar vidare!",
      "📰 Morgontidningens rubrik: \"{u} DOMINERAR\". Men tryckpressen väntar till 05:00.",
      "🐻 {u} ä starka som en björn från Orsa ikväll."
    ],
    bigBehind: [
      "🌄 {t} leder stort. {u} satsar på truppanda och gott humör.",
      "🎻 {t} drar ifrån. {u} spelar vidare på fiolen ändå.",
      "🦔 {u} ligger efter men ä taggade som en igelkott."
    ]
  };
  var LINES_EN = {
    start: ["📯 The duel is on: {u} vs {t}.", "⚔️ Two groups, one night, one winner."],
    lead: ["🔥 {u} lead! {t} watch through the binoculars.", "🏰 {u} hold the castle."],
    behind: ["🧭 {t} lead for now. The night is young.", "🫡 {u} regroup in the trench."],
    tied: ["⚖️ Dead even!", "🤝 Tied! Team spirit may decide it."],
    big: ["🚀 {u} lead by a mile!"], bigBehind: ["🌄 {t} lead big. {u} keep the spirit up."]
  };

  function T(k) { var o = sv() ? S.sv : S.en; return o[k] != null ? o[k] : S.sv[k]; }
  function F(s) { var a = arguments; return String(s).replace(/\{(\d)\}/g, function (m, i) { return a[+i + 1] != null ? a[+i + 1] : ""; }); }
  function errText(err) {
    var m = String((err && (err.message || err.details)) || ""), e = T("errs");
    for (var k in e) if (m.indexOf(k) >= 0) return e[k];
    return T("fail");
  }
  function el(tag, attrs, kids) {
    var n = A.el(tag, attrs);
    (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  function bt(label, cls, fn) { return el("button", { type: "button", class: "btn " + (cls || ""), text: label, onclick: fn }); }
  function call(name, params) {
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) state = "missing";
      return r;
    });
  }
  function on() { return A && A.LIVE && state === "on"; }
  function seen() { return U.ls.getJSON(SEEN_KEY, {}) || {}; }
  function markSeen(k) {
    var s = seen(); s[k] = Date.now();
    var keys = Object.keys(s);
    if (keys.length > 120) keys.sort(function (a, b) { return s[a] - s[b]; }).slice(0, keys.length - 120).forEach(function (x) { delete s[x]; });
    U.ls.setJSON(SEEN_KEY, s);
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function nm(s) { return s || (sv() ? "Okänd grupp" : "Unknown group"); }
  function nOf(x, k) { return x && x[k] != null ? x[k] | 0 : 0; }
  function inviteLink(tok) { return location.origin + location.pathname + "?duel=" + encodeURIComponent(tok); }
  function hm(iso) { return U.timeHM(iso); }
  function leftText(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return "0 min";
    var h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
    return (h ? h + " h " : "") + m + " min";
  }

  /* Commentary: one line per duel per 5 min, by state (start / lead / behind / tied / big). */
  function lineFor(d) {
    var L = sv() ? LINES : LINES_EN;
    var u = nOf(d.us, "drinks"), t = nOf(d.them, "drinks");
    var mins = d.accepted_at ? (Date.now() - new Date(d.accepted_at).getTime()) / 60000 : 0;
    var kind = (u + t === 0 || mins < 10) && u === t ? "start" : u === t ? "tied" : u > t ? (u - t >= 5 && u >= t * 1.5 ? "big" : "lead") : (t - u >= 5 && t >= u * 1.5 ? "bigBehind" : "behind");
    var list = L[kind] || L.tied;
    var i = hashStr(d.id + ":" + Math.floor(Date.now() / 300000) + ":" + kind) % list.length;
    return list[i].replace(/\{u\}/g, nm(d.group && d.group.name)).replace(/\{t\}/g, nm(d.opp && d.opp.name));
  }

  /* ---------- Data ---------- */
  function duels() { return data && Array.isArray(data.duels) ? data.duels.filter(Boolean) : []; }
  function ofGroup(gid) { return duels().filter(function (d) { return (d.group && d.group.id === gid) || (d.sides && d.sides.some(function (s) { return s.id === gid; })); }); }
  function live(d) { return d.status === "active" || d.status === "pending"; }
  function load(force) {
    if (!A || !A.LIVE || !A.authed || !A.authed() || state === "missing" || busy) return Promise.resolve();
    if (!force && Date.now() - loadedAt < POLL_MS) return Promise.resolve();
    busy = true;
    return call("duel_poll").then(function (r) {
      busy = false; loadedAt = Date.now();
      if (r.error) { return; }
      state = "on";
      data = A.parseData(r.data);
      notify();
      if (view) renderView();
      try { A.updateCounts(); } catch (e) {}
    }, function () { busy = false; });
  }
  // In-app toasts once per duel and event.
  function notify() {
    var s = seen(), first = !s._init;
    duels().forEach(function (d) {
      if (d.incoming && !s["in" + d.id]) {
        markSeen("in" + d.id);
        A.toast(F(T("toastIn"), nm(d.opp.name), nm(d.group.name)), { ms: 12000, action: { label: T("answer"), fn: function () { openDuels(d.group); } } });
      }
      if (d.needs_pick && !s["pk" + d.id]) {
        markSeen("pk" + d.id);
        A.toast(T("toastPick"), { ms: 12000, action: { label: T("pickBtn"), fn: function () { openDuels(d.group); } } });
      }
      if (d.status === "done" && d.winner && !s["w" + d.id]) {
        markSeen("w" + d.id);
        if (!first) A.toast(F(T(d.winner === "us" ? "toastWin" : "toastLost"), nm(d.group.name), nm(d.opp.name)), { ms: 9000, action: { label: T("open"), fn: function () { openDuels(d.group); } } });
      }
    });
    if (first) markSeen("_init");
  }

  /* ---------- Sheet ---------- */
  function openDuels(g) {
    if (!on() || !g || !g.id) return;
    stopTimer();
    var my = { g: { id: g.id, name: g.name, code: g.code }, box: null, timer: null };
    view = my;
    A.openSheet(F(T("sheet"), g.name || ""), function (body) {
      view = my;
      var root = el("div", { class: "du" });
      view.box = el("div", { class: "du-live" });
      root.appendChild(view.box);
      root.appendChild(challengeBox());
      body.appendChild(root);
      renderView();
      load(true);
    }, { onClose: function () { if (my.timer) { clearInterval(my.timer); my.timer = null; } if (view === my) view = null; } });
    my.timer = setInterval(function () {
      if (view !== my) { clearInterval(my.timer); my.timer = null; return; }
      if (document.visibilityState !== "visible") return;
      if (!document.getElementById("sheet") || document.getElementById("sheet").hidden) return;
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      if (ofGroup(view.g.id).some(live)) { loadedAt = 0; load(true); }
    }, 15000);
  }
  function stopTimer() { if (view && view.timer) { clearInterval(view.timer); view.timer = null; } }

  function renderView() {
    if (!view || !view.box) return;
    var box = view.box, list = ofGroup(view.g.id);
    box.textContent = "";
    box.appendChild(el("p", { class: "du-intro", text: T("intro") }));
    // Pick cards first.
    list.filter(function (d) { return d.needs_pick; }).forEach(function (d) { box.appendChild(pickCard(d)); });
    var shown = list.filter(function (d) { return d.status !== "expired" && d.status !== "cancelled" && !(d.status === "declined" && !d.outgoing); });
    if (!shown.length) box.appendChild(el("p", { class: "du-none", text: T("none") }));
    var ours = shown.filter(function (d) { return d.status === "active" || d.status === "done"; });
    if (ours.length >= 3) box.appendChild(leagueBox(ours));
    shown.forEach(function (d) { box.appendChild(card(d)); });
  }

  function bar(u, t) {
    var share = u + t > 0 ? u / (u + t) : 0.5;
    var pct = Math.round(Math.max(0.04, Math.min(0.96, share)) * 1000) / 10;
    var wrap = el("div", { class: "du-tug", role: "img", "aria-label": u + " – " + t });
    var a = el("div", { class: "du-tug-us" }); a.style.width = pct + "%";
    var knot = el("div", { class: "du-tug-knot", text: "🪢" }); knot.style.left = pct + "%";
    wrap.appendChild(a); wrap.appendChild(el("div", { class: "du-tug-mid" })); wrap.appendChild(knot);
    return wrap;
  }
  function statRow(label, u, t, cls) {
    return el("div", { class: "du-stat " + (cls || "") }, [
      el("b", { class: "du-n us", text: String(u) }), el("span", { class: "du-k", text: label }), el("b", { class: "du-n them", text: String(t) })
    ]);
  }
  function card(d) {
    var u = nOf(d.us, "drinks"), t = nOf(d.them, "drinks");
    var c = el("section", { class: "du-card du-" + d.status + (d.winner ? " du-w-" + d.winner : "") });
    c.appendChild(el("div", { class: "du-head" }, [
      el("span", { class: "du-name us", text: nm(d.group && d.group.name) }),
      el("span", { class: "du-x", text: "⚔️" }),
      el("span", { class: "du-name them", text: nm(d.opp && d.opp.name) })
    ]));
    if (d.status === "pending") {
      if (d.incoming) {
        c.appendChild(el("p", { class: "du-call", text: F(T("incoming"), nm(d.opp.name)) }));
        c.appendChild(el("div", { class: "du-row" }, [
          bt(T("decline"), "btn-small", function () { answer(d, false); }),
          bt(T("accept"), "btn-amber", function () { answer(d, true); })
        ]));
      } else {
        c.appendChild(el("p", { class: "du-call", text: F(T("outgoing"), nm(d.opp.name)) }));
        if (d.outgoing) c.appendChild(el("div", { class: "du-row" }, [bt(T("cancel"), "btn-small", function () { cancelDuel(d); })]));
      }
      return c;
    }
    if (d.status === "declined") { c.appendChild(el("p", { class: "du-call", text: T("declined") })); return c; }
    if (d.status === "done") {
      var key = d.winner === "us" ? "won" : d.winner === "draw" ? "draw" : "lost";
      c.appendChild(el("div", { class: "du-result" }, [
        el("div", { class: "du-medal", text: d.winner === "us" ? "🥇" : d.winner === "draw" ? "🤝" : "🫡" }),
        el("div", { class: "du-rt", text: F(T(key), nm(d.group.name), nm(d.opp.name)) }),
        el("div", { class: "du-rs", text: F(T("final"), u, t) })
      ]));
      if (d.winner === "us") c.appendChild(el("p", { class: "du-line", text: F(T("medal"), nm(d.group.name), nOf(d.group, "wins")) }));
      else c.appendChild(el("p", { class: "du-line", text: T("revenge") }));
    } else {
      c.appendChild(el("div", { class: "du-score" }, [
        el("span", { class: "du-big us", text: String(u) }), el("span", { class: "du-dash", text: "–" }), el("span", { class: "du-big them", text: String(t) })
      ]));
      c.appendChild(bar(u, t));
      c.appendChild(el("p", { class: "du-line", text: lineFor(d) }));
    }
    c.appendChild(statRow(T("drinks"), u, t));
    c.appendChild(statRow(T("members"), nOf(d.us, "members"), nOf(d.them, "members")));
    c.appendChild(statRow(T("spirit"), nOf(d.us, "spirit"), nOf(d.them, "spirit"), "du-spirit"));
    var foot = [];
    if (d.status === "active") foot.push(F(T("left"), leftText(d.ends_at)) + " · " + T("leftEnd"));
    if (nOf(d.group, "wins") || nOf(d.opp, "wins")) foot.push(F(T("wins"), nOf(d.group, "wins")) + " vs " + nOf(d.opp, "wins"));
    var und = nOf(d.us, "undecided");
    if (und && d.status === "active") foot.push(F(T("undecided"), und));
    if (foot.length) c.appendChild(el("p", { class: "du-foot", text: foot.join(" · ") }));
    if (d.both && d.pick && d.status === "active") c.appendChild(pickInfo(d));
    if (d.status === "active") c.appendChild(el("p", { class: "du-note", text: T("spiritNote") }));
    return c;
  }
  function pickCard(d) {
    var c = el("section", { class: "du-card du-pick" });
    c.appendChild(el("p", { class: "du-call", text: T("pickHead") }));
    c.appendChild(el("p", { class: "du-note", text: T("pickNote") }));
    var row = el("div", { class: "du-row" });
    (d.sides || []).forEach(function (s) { row.appendChild(bt("⚔️ " + nm(s.name), "btn-amber", function () { pickSide(d, s); })); });
    c.appendChild(row);
    return c;
  }
  function pickInfo(d) {
    var mine = (d.sides || []).filter(function (s) { return s.id === d.pick.group_id; })[0];
    var other = (d.sides || []).filter(function (s) { return s.id !== d.pick.group_id; })[0];
    var row = el("div", { class: "du-pickinfo" }, [el("span", { text: F(T("picked"), nm(mine && mine.name)) })]);
    if (d.pick.can_switch && other) row.appendChild(bt(T("pickSwitch"), "btn-small", function () { pickSide(d, other); }));
    else row.appendChild(el("span", { class: "du-lock", text: T("pickLocked") }));
    return row;
  }
  function leagueBox(list) {
    var box = el("section", { class: "du-league" });
    box.appendChild(el("h3", { class: "du-h", text: T("league") }));
    var rows = list.map(function (d) {
      var u = nOf(d.us, "drinks"), t = nOf(d.them, "drinks");
      var sp = nOf(d.us, "spirit") - nOf(d.them, "spirit");
      var st = d.winner ? d.winner : u > t ? "us" : u < t ? "them" : sp > 0 ? "us" : sp < 0 ? "them" : "draw";
      return { d: d, u: u, t: t, m: u - t, st: st };
    }).sort(function (a, b) { return b.m - a.m; });
    var ol = el("ol", { class: "du-ltab" });
    rows.forEach(function (r) {
      ol.appendChild(el("li", { class: "du-lrow du-l-" + r.st }, [
        el("span", { class: "du-ln", text: nm(r.d.opp.name) }),
        el("span", { class: "du-ls", text: r.u + "–" + r.t }),
        el("span", { class: "du-lst", text: r.st === "us" ? "✅ " + T("leading") : r.st === "them" ? "❌ " + T("behind") : "⚖️ " + T("tied") })
      ]));
    });
    box.appendChild(ol);
    var lead = rows.filter(function (r) { return r.st === "us"; }).length;
    box.appendChild(el("p", { class: "du-foot", text: F(T("lead"), lead, rows.length) }));
    return box;
  }

  /* ---------- Challenge: QR, code, nearby ---------- */
  function challengeBox() {
    var box = el("section", { class: "du-ch" });
    var qrWrap = el("div", { class: "du-qrwrap" });
    var showQr = bt(T("qrNew"), "btn-amber btn-block", function () { showQr.disabled = true; makeQr(qrWrap, function () { showQr.remove(); }, function () { showQr.disabled = false; }); });
    box.appendChild(showQr);
    box.appendChild(qrWrap);
    // Type a code
    box.appendChild(el("h3", { class: "du-h", text: T("typeHead") }));
    var inp = el("input", { class: "inp du-code", id: "du-code", maxlength: "8", autocapitalize: "characters", autocomplete: "off", autocorrect: "off",
      spellcheck: "false", enterkeyhint: "go", placeholder: T("typePh"), "aria-label": T("typePh") });
    inp.addEventListener("input", function () {
      var v = String(inp.value || "").toUpperCase().split("").filter(function (c) { return U.CODE_ALPHABET.indexOf(c) >= 0; }).join("").slice(0, 8);
      if (v !== inp.value) inp.value = v;
    });
    var go = function () {
      var v = inp.value;
      if (v.length === 8) { openToken(v, view && view.g ? view.g.id : null); return; }
      if (v.length !== 6) { A.toast(T("typePh"), { err: true }); return; }
      call("duel_challenge", { p_group_id: view.g.id, p_code: v, p_handle: null }).then(function (r) {
        if (r.error) { A.toast(errText(r.error), { err: true }); return; }
        var d = A.parseData(r.data);
        inp.value = "";
        A.toast(F(T("sent"), nm(d.opp && d.opp.name)), { ms: 6000 });
        load(true);
      });
    };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    box.appendChild(el("div", { class: "du-row du-typerow" }, [inp, bt(T("typeGo"), "btn-green", go)]));
    box.appendChild(el("p", { class: "du-note", text: T("typeNote") }));
    // Nearby
    box.appendChild(el("h3", { class: "du-h", text: T("nearHead") }));
    var near = el("div", { class: "du-near" });
    box.appendChild(near);
    var chk = el("input", { type: "checkbox", id: "du-open" });
    var openIds = data && Array.isArray(data.open) ? data.open : [];
    chk.checked = openIds.indexOf(view.g.id) >= 0;
    chk.addEventListener("change", function () {
      call("duel_set_open", { p_group_id: view.g.id, p_on: chk.checked }).then(function (r) {
        if (r.error) { chk.checked = !chk.checked; A.toast(errText(r.error), { err: true }); return; }
        A.toast(chk.checked ? T("openOn") : T("openOff"));
        loadedAt = 0; load(true);
      });
    });
    box.appendChild(el("label", { class: "du-open", for: "du-open" }, [chk, " " + T("openLabel")]));
    loadNear(near);
    return box;
  }
  function myPos() {
    try { var m = A.myBeer && A.myBeer(); if (m && U.validPos(m.lat, m.lng)) return { lat: m.lat, lng: m.lng }; } catch (e) {}
    try { var l = A.lastLoc && A.lastLoc(); if (l && U.validPos(l.lat, l.lng)) return l; } catch (e) {}
    try { var c = A.map.getCenter(); if (A.map.getZoom() >= 9) return { lat: c.lat, lng: c.lng }; } catch (e) {}
    return null;
  }
  function loadNear(box) {
    var p = myPos();
    box.textContent = "";
    if (!p) { box.appendChild(el("p", { class: "du-note", text: T("nearPos") })); return; }
    box.appendChild(el("p", { class: "du-note", text: T("loading") }));
    var gid = view.g.id;
    call("duel_nearby", { p_group_id: gid, p_lat: p.lat, p_lng: p.lng }).then(function (r) {
      if (!view || view.g.id !== gid) return;
      box.textContent = "";
      if (r.error) { box.appendChild(el("p", { class: "du-note", text: T("fail") })); return; }
      var d = A.parseData(r.data), gs = Array.isArray(d.groups) ? d.groups : [];
      if (!gs.length) { box.appendChild(el("p", { class: "du-note", text: T("nearNone") })); return; }
      gs.forEach(function (x) {
        var b = bt(T("nearBtn"), "btn-small btn-amber", function () {
          b.disabled = true;
          call("duel_challenge", { p_group_id: gid, p_code: null, p_handle: x.handle }).then(function (rr) {
            if (rr.error) { b.disabled = false; A.toast(errText(rr.error), { err: true }); return; }
            A.toast(F(T("sent"), nm(x.name)), { ms: 6000 });
            load(true);
            loadNear(box);
          });
        });
        box.appendChild(el("div", { class: "du-nrow" }, [
          el("div", { class: "du-nn" }, [el("b", { text: x.name }), el("span", { class: "du-note", text: F(T("nearOut"), x.out | 0, x.members | 0) })]), b
        ]));
      });
    });
  }
  function makeQr(wrap, done, fail) {
    call("duel_invite", { p_group_id: view.g.id }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); if (fail) fail(); return; }
      if (done) done();
      var d = A.parseData(r.data), link = inviteLink(d.token);
      wrap.textContent = "";
      wrap.appendChild(el("h3", { class: "du-h", text: T("qrHead") }));
      var qr = el("div", { class: "qr du-qr", "aria-hidden": "true" });
      wrap.appendChild(qr);
      try {
        if (window.QRCode) new window.QRCode(qr, { text: link, width: 208, height: 208, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
        else qr.remove();
      } catch (e) { qr.remove(); }
      wrap.appendChild(el("p", { class: "du-qrnote", text: T("qrNote") }));
      wrap.appendChild(el("div", { class: "du-tok", text: F(T("qrCode"), d.token) }));
      wrap.appendChild(el("p", { class: "du-note", text: F(T("qrExp"), hm(d.expires_at)) }));
      var row = el("div", { class: "du-row" }, [bt(T("copyLink"), "btn-small", function () { A.copyText(link); })]);
      if (navigator.share) row.appendChild(bt(T("share"), "btn-small", function () {
        navigator.share({ title: "Öl Nu", text: F(T("shareText"), d.group_name || view.g.name), url: link }).catch(function () {});
      }));
      wrap.appendChild(row);
    });
  }
  function answer(d, yes) {
    call("duel_answer", { p_duel_id: d.id, p_accept: !!yes }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); load(true); return; }
      A.toast(yes ? F(T("accepted"), nm(d.opp.name)) : T("declined"), { ms: 5000 });
      if (yes) try { if (window.FX && window.FX.clink) window.FX.clink(); } catch (e) {}
      loadedAt = 0; load(true);
    });
  }
  function cancelDuel(d) {
    call("duel_cancel", { p_duel_id: d.id }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      A.toast(T("cancelled")); loadedAt = 0; load(true);
    });
  }
  function pickSide(d, s) {
    call("duel_pick_side", { p_duel_id: d.id, p_group_id: s.id }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); load(true); return; }
      A.toast(F(T("pickOk"), nm(s.name)), { ms: 4000 });
      loadedAt = 0; load(true);
    });
  }

  /* ---------- Deep link / typed duel code: one tap to accept ---------- */
  function openToken(tok, preferGroup) {
    call("duel_token_info", { p_token: tok }).then(function (r) {
      if (r.error) { if (state !== "missing") A.toast(errText(r.error), { err: true }); return; }
      var info = A.parseData(r.data);
      var gs = Array.isArray(info.groups) ? info.groups : [];
      A.openSheet(F(T("linkHead"), nm(info.group_name)), function (body) {
        var root = el("div", { class: "du du-link" });
        root.appendChild(el("div", { class: "du-linkhero", text: "⚔️" }));
        root.appendChild(el("p", { class: "du-call", text: F(T("linkHead"), nm(info.group_name)) + " (" + F(T("linkMembers"), info.members | 0) + ")" }));
        root.appendChild(el("p", { class: "du-intro", text: T("intro") }));
        if (info.mine && gs.filter(function (g) { return g.state === "ok"; }).length === 0) {
          root.appendChild(el("p", { class: "du-note", text: T("linkMine") }));
        } else if (!gs.length) {
          root.appendChild(el("p", { class: "du-note", text: T("linkNoGroup") }));
          root.appendChild(bt(T("linkGroups"), "btn-block", function () { A.closeSheet(); A.showGroups(); }));
        } else {
          if (gs.length > 1) root.appendChild(el("p", { class: "du-note", text: T("linkPick") }));
          gs.slice().sort(function (a, b) { return (b.id === preferGroup) - (a.id === preferGroup); }).forEach(function (g) {
            if (g.state === "ok") {
              root.appendChild(bt(F(T("linkGo"), g.name), "btn-amber btn-block du-go", function (e) {
                var b = e && e.currentTarget; if (b) b.disabled = true;
                call("duel_accept_token", { p_token: tok, p_group_id: g.id }).then(function (rr) {
                  if (rr.error) { if (b) b.disabled = false; A.toast(errText(rr.error), { err: true }); return; }
                  var d = A.parseData(rr.data);
                  A.toast(d.already ? F(T("already"), nm(info.group_name)) : F(T("accepted"), nm(info.group_name)), { ms: 6000 });
                  loadedAt = 0;
                  load(true).then(function () { openDuels({ id: g.id, name: g.name }); });
                });
              }));
            } else {
              root.appendChild(el("div", { class: "du-gst" }, [el("b", { text: g.name }),
                el("span", { class: "du-note", text: g.state === "dueling" ? T("stDueling") : g.state === "full" ? T("stFull") : T("stSame") })]));
            }
          });
        }
        body.appendChild(root);
      });
    });
  }
  function runLink() {
    if (!linkToken) return;
    var tries = 0;
    (function wait() {
      var intro = document.getElementById("intro");
      if ((intro && !intro.hidden) || !A.authed()) { if (++tries < 120) setTimeout(wait, 700); return; }
      var tok = linkToken; linkToken = null;
      if (tok.length === 8) openToken(tok, null);
    })();
  }

  /* ---------- Group list + HUD ---------- */
  function groupItem(g, wrap) {
    if (!on() || !g || !g.id) return;
    var list = ofGroup(g.id).filter(live), sum = [];
    var act = list.filter(function (d) { return d.status === "active"; });
    if (act.length) {
      var lead = act.filter(function (d) { return nOf(d.us, "drinks") > nOf(d.them, "drinks"); }).length;
      sum.push("⚔️ " + act.length + (lead ? " · " + lead + " " + T("leading") : ""));
    }
    if (list.some(function (d) { return d.incoming; })) sum.push("📯!");
    if (list.some(function (d) { return d.needs_pick; })) sum.push("⚠️");
    var b = el("button", { type: "button", class: "btn btn-small btn-block du-gbtn" }, [
      el("span", { class: "du-gl", text: act.length || list.length ? T("duels") : T("btn") }),
      sum.length ? el("span", { class: "du-gs", text: sum.join(" · ") }) : null
    ]);
    b.addEventListener("click", function () { openDuels(g); });
    wrap.appendChild(el("div", { class: "du-gi" }, [b]));
  }
  function chipTarget() {
    var ds = duels(), s = seen();
    var x = ds.filter(function (d) { return d.incoming; })[0]; if (x) return { d: x, k: "in" };
    x = ds.filter(function (d) { return d.needs_pick; })[0]; if (x) return { d: x, k: "pick" };
    x = ds.filter(function (d) { return d.status === "done" && d.winner && !s["card" + d.id]; })[0]; if (x) return { d: x, k: "win" };
    x = ds.filter(function (d) { return d.status === "active"; })
      .sort(function (a, b) { return (nOf(b.us, "drinks") + nOf(b.them, "drinks")) - (nOf(a.us, "drinks") + nOf(a.them, "drinks")); })[0];
    if (x) return { d: x, k: "live" };
    return null;
  }

  window.DUEL = {
    state: function () { return state; },
    data: function () { return data; },
    open: openDuels, openToken: openToken, _lineFor: lineFor, _lines: LINES,
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
    },
    onAuthed: function () { load(true).then(runLink); },
    onPoll: function () { load(false); },
    groupItem: function (g, wrap) { groupItem(g, wrap); },
    hudChipsHTML: function () {
      if (!on()) return "";
      var c = chipTarget(); if (!c) return "";
      var txt = c.k === "in" ? T("chipIn") : c.k === "pick" ? T("chipPick") : c.k === "win" ? T("chipWin")
        : F(T("chipLive"), nOf(c.d.us, "drinks"), nOf(c.d.them, "drinks"));
      return '<button type="button" class="hx-chip du-chip du-c-' + c.k + '" data-hx="duel" aria-label="' + U.esc(T("chipAria")) + '">' + U.esc(txt) + "</button>";
    },
    hudClick: function (action) {
      if (action !== "duel") return;
      var c = chipTarget(); if (!c) return;
      if (c.k === "win") markSeen("card" + c.d.id);
      openDuels(c.d.group);
    }
  };
})();
