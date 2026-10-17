/* Öl Nu v19 — GÄNGET (group fun pack; CONTRACT "v19 GÄNGET", migration 0026).
   📖 Citatboken · 🤔 Mest troligt · 🗳️ Vart ska vi? · 🥞 Bakisbrunchen · 🌯 Kebabtoppen · 💸 Skuldboken · 📰 Morgontidningen
   Hooks from app.js mods(): init, onAuthed, onPoll, hudChipsHTML (ONE chip), hudClick, groupItem, topSheet, barPopupHTML.
   social.js calls GANG.chatPick(picker, g, msg, close) from the chat long-press menu ("📖 Spara som citat").
   Texts: js/gang-content.js (window.GANG_CONTENT). Every RPC may be missing on an older database: then all of this
   hides quietly (no chip, no group button, no top-sheet section). In-app only: no new push events. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null;
  var C = window.GANG_CONTENT || {};
  var off = {};
  var state = "unknown";            // gang_poll: "unknown" | "on" | "missing"
  var poll = null, pollAt = 0, busy = false, again = false, POLL_MS = 45000, firstPoll = true;
  var view = null;                  // open Gänget sheet: {g, tab, d, pane, timer, quotes, paper, head}
  var statusCache = { at: 0, m: {} }, kebabTopCache = {}, kebabPlaceCache = {};
  var SEEN_KEY = "olnu.gangSeen", TAB_KEY = "olnu.gangTab", PAPER_KEY = "olnu.gangPaper", PUSHED_KEY = "olnu.gangRally";
  var TABS = ["citat", "mt", "vart", "brunch", "skuld", "tidning", "kebab"];
  var CODES = ["not_member", "slow_down", "invalid_quote", "quote_not_found", "not_yours", "round_open", "not_enough",
    "round_not_found", "round_done", "invalid_member", "invalid_poll", "poll_open", "poll_not_found", "poll_ended",
    "invalid_option", "not_morning", "invalid_brunch", "brunch_open", "brunch_not_found", "invalid_answer", "invalid_place",
    "not_food", "invalid_stars", "invalid_tag", "too_far", "invalid_debt", "debt_not_found", "invalid_action", "invalid_swish",
    "too_late", "outside_sweden", "not_authenticated"];

  /* ---------- UI strings ---------- */
  var S = {
    sv: {
      btn: "🍻 Gänget", sheet: "🍻 Gänget · {0}", back: "← Grupper", loading: "Laddar…", fail: "Kunde int’ ladda. Försök igen.",
      you: "Du", someone: "Någon",
      tabs: { citat: "📖 Citat", mt: "🤔 Troligt", vart: "🗳️ Vart?", brunch: "🥞 Brunch", skuld: "💸 Skulder", tidning: "📰 Tidning", kebab: "🌯 Kebab" },
      chip: { vart: "🗳️ Rösta!", mt: "🤔 Rösta!", brunch: "🥞 Brunch?", paper: "📰" },
      chipAria: { vart: "Vart ska vi? Rösta", mt: "Mest troligt: rösta", brunch: "Brunch? Svara", paper: "Morgontidningen ä klar" },
      // Citat
      qYday: "📖 Gårdagens citat", qAdd: "+ Citat", qWho: "Vem sa det?", qWhoPh: "Namn", qBody: "Vad sa hen?", qBodyPh: "Max 140 tecken",
      qSave: "📖 Spara i citatboken", qPending: "🔒 {0} hemliga citat avslöjas {1}.", qWhen: "imorgon kl. 10:00", qWhenToday: "idag kl. 10:00",
      qEmpty: "Boken ä tom. Nån säger nåt dumt snart – spara det!", qMore: "Visa äldre", qHide: "🙈 Göm", qHidden: "Citatet ä gömt.",
      qLocked: "🔒 avslöjas {0}", qChatHint: "Tips: håll inne på ett meddelande i chatten → 📖.", qPick: "📖 Citat", qPickAria: "Spara som citat",
      // Mest troligt
      mtHead: "🤔 Mest troligt", mtIntro: "En fråga åt gången. Alla röstar på en i gruppen. Inga dryckesregler – bara heder och ära.",
      mtStart: "🤔 Starta en runda", mtNext: "🤔 Nästa fråga", mtQ: "Vem ä mest trolig att {0}?", mtVotes: "{0}/{1} har röstat",
      mtClose: "🏁 Visa resultat nu", mtVoted: "Röst lagd! Du kan ändra tills alla röstat.", mtHist: "Tidigare ikväll",
      mtLeft: "{0} kvar", mtNeed2: "Det behövs minst 2 i gruppen.", mtVoteN: "{0} röst(er)",
      // Vart ska vi
      vHead: "🗳️ Vart ska vi?", vIntro: "Välj 2–4 krogar. Gänget röstar i 15 min. Vinnaren blir en inkallelse 🪖.",
      vPick: "Krogar nära dig", vNone: "Inga krogar nära. Flytta kartan till stan (zooma in) och försök igen.",
      vStart: "🗳️ Starta omröstning ({0})", vNeed: "Välj 2–4 krogar.", vEnds: "⏱️ {0} kvar", vEnd: "🏁 Avsluta nu",
      vWin: "🏆 Det blir {0}!", vNoWin: "Ingen röstade. Ni får bestämma som förr i tiden: högljutt.", vRally: "🪖 Inkallelse skickad.",
      vRallyBtn: "🪖 Skicka inkallelse", vRallyOk: "🪖 Inkallelse skickad till gänget!", vShow: "📍 Visa på kartan", vNew: "🗳️ Ny omröstning",
      vCrowd: "👥 {0} här nu", vCi: "📍 {0} incheckade", vQ: { none: "🚶 Ingen kö", short: "🚶 Kort kö", long: "🚶 Lång kö" },
      vVoteToast: "🗳️ Röst lagd på {0}.", vBy: "Startad av {0}",
      // Brunch
      bHead: "🥞 Bakisbrunchen", bWhere: "Var?", bWherePh: "Eller skriv ett ställe", bWhen: "När?", bNow: "Nu",
      bSend: "🥞 Brunch? Fråga gänget", bCall: "{0}: brunch på {1}{2}?", bAt: " kl. {0}",
      bJa: "✅ Ja", bKanske: "🤔 Kanske", bNej: "🛌 Nej", bIn: "{0} kommer", bCancel: "Ställ in", bCancelled: "Brunchen ä inställd.",
      bNoPlaces: "Inga kaféer i närheten på kartan. Skriv ett ställe.", bHours: "Öppettider: kolla innan ni går.",
      bNeedPlace: "Välj eller skriv ett ställe.",
      // Kebab
      kHead: "🌯 Kebabtoppen", kNear: "Käk nära dig", kNone: "Inga matställen nära dig. Gå närmare kebaben 🌯", kRate: "Betygsätt",
      kStars: "Kebabstjärnor", kTag: "Bäst på (valfritt)", kSave: "🌯 Spara betyg", kTop: "🌯 Kebabkungen i {0}", kTopNone: "Ingen har betygsatt käk i {0} den här månaden. Bli först!",
      kTown: "närområdet", kAvg: "★ {0} ({1})", kMine: "Ditt: {0}★", kOnce: "Ett betyg per ställe och natt. Du kan ändra det.",
      kNeedPos: "Slå på platsen så vi vet att du ä vid käket.", kPopBtn: "🌯 Betygsätt käket", kFoodOnly: "Bara mat – aldrig alkohol.",
      kRated: "Betygsatt ikväll ✓",
      // Skulder
      dHead: "💸 Skuldboken", dNetMe: "Netto: {0}", dOwes: "{0} ä skyldig {1} kr", dGets: "{0} får {1} kr", dEven: "{0} ä kvitt", dAllEven: "Alla ä kvitt. Vänskapen blomstrar. 🌸",
      dPlan: "Så blir alla kvitt", dPay: "{0} → {1}: {2} kr", dAdd: "+ Skriv in skuld", dWho: "Vem ä skyldig?", dTo: "Till vem?",
      dAmount: "Belopp (kr)", dWhat: "För vad?", dWhatPh: "t.ex. pizzan", dSave: "💸 Skriv in", dLine: "{0} ä skyldig {1} {2} kr för {3}",
      dPaidBtn: "✅ Betald", dCancelBtn: "✕", dCancelQ: "Ta bort skulden?", dPaidList: "Betalt senaste tiden", dUndo: "Ångra",
      dSwishHead: "📱 Mitt Swish-nummer i den här gruppen", dSwishPh: "07x-xxx xx xx", dSwishSave: "Spara", dSwishClear: "Ta bort",
      dSwishInfo: "⚠️ Numret syns för ALLA i gruppen {0} (bara här). Spara det bara om du vill att gänget ska kunna swisha dig.",
      dSwishOk: "📱 Swish-nummer sparat i {0}.", dSwishGone: "Swish-numret ä borttaget.", dSwish: "📱 Swisha {0}", dCopy: "📋 Kopiera nummer",
      dCopied: "📋 Kopierat: {0}", dNoSwish: "{0} har int’ sparat Swish-nummer.", dSwishNote: "Swish öppnas med belopp ifyllt om din telefon stöder det. Annars: kopiera numret.",
      dNeed: "Välj två olika personer, belopp och vad.",
      // Tidning
      pHead: "📰 Morgontidningen", pShare: "📤 Dela", pSave: "⬇️ Spara bild", pMaking: "Trycker tidningen…", pShared: "📰 Delad!",
      pDate: "{0}", pExtra: "EXTRA!",
      // Toasts
      tMt: "🤔 {0}: ny fråga i Mest troligt. Rösta!", tVart: "🗳️ {0}: Vart ska vi? Rösta!", tWin: "🏆 {0} har bestämt: {1}!",
      tBrunch: "🥞 {0}: brunch på {1}?", tPaper: "📰 Morgontidningen för {0} ä tryckt!", open: "Öppna", vote: "Rösta", answer: "Svara", read: "Läs",
      errs: {
        not_member: "Du ä int’ med i gruppen.", slow_down: "Lugn i stormen. Vänta en stund.", invalid_quote: "Skriv vem och vad (max 140 tecken).",
        quote_not_found: "Citatet finns int’ längre.", not_yours: "Det får bara den det gäller göra.", round_open: "En fråga pågår redan. Rösta klart först!",
        not_enough: "Det behövs minst 2 i gruppen.", round_not_found: "Rundan finns int’ längre.", round_done: "Rundan ä redan klar.",
        invalid_member: "Den personen ä int’ med längre.", invalid_poll: "Välj 2–4 olika krogar.", poll_open: "En omröstning pågår redan.",
        poll_not_found: "Omröstningen finns int’ längre.", poll_ended: "Omröstningen ä slut.", invalid_option: "Välj en krog.",
        not_morning: "Bakisbrunchen öppnar 06:00 och stänger 14:00.", invalid_brunch: "Kolla stället och tiden.", brunch_open: "Nån har redan bjudit in till brunch. Svara på den!",
        brunch_not_found: "Brunchen ä inställd.", invalid_answer: "Välj Ja, Kanske eller Nej.", invalid_place: "Det stället kändes int’ igen.",
        not_food: "Kebabtoppen ä bara för matställen.", invalid_stars: "Välj 1–5 stjärnor.", invalid_tag: "Välj en av taggarna.",
        too_far: "Du måste vara nära stället (2 km).", invalid_debt: "Välj två olika personer, belopp 1–50 000 kr och vad.",
        debt_not_found: "Skulden finns int’ längre.", invalid_action: "Det gick int’.", invalid_swish: "Skriv ett svenskt mobilnummer: 07xxxxxxxx.",
        too_late: "För sent att ångra.", outside_sweden: "Ogiltig plats.", error: "Nåt gick fel. Försök igen."
      }
    },
    en: {
      btn: "🍻 The gang", sheet: "🍻 Gang · {0}", back: "← Groups", loading: "Loading…", fail: "Could not load. Try again.",
      you: "You", someone: "Someone",
      tabs: { citat: "📖 Quotes", mt: "🤔 Likely", vart: "🗳️ Where?", brunch: "🥞 Brunch", skuld: "💸 Debts", tidning: "📰 Paper", kebab: "🌯 Kebab" },
      chip: { vart: "🗳️ Vote!", mt: "🤔 Vote!", brunch: "🥞 Brunch?", paper: "📰" },
      chipAria: { vart: "Where next? Vote", mt: "Most likely: vote", brunch: "Brunch? Answer", paper: "The morning paper is ready" },
      qYday: "📖 Yesterday's quotes", qAdd: "+ Quote", qWho: "Who said it?", qWhoPh: "Name", qBody: "What did they say?", qBodyPh: "Max 140 characters",
      qSave: "📖 Save to the quote book", qPending: "🔒 {0} secret quotes revealed {1}.", qWhen: "tomorrow at 10:00", qWhenToday: "today at 10:00",
      qEmpty: "The book is empty. Someone will say something silly soon – save it!", qMore: "Show older", qHide: "🙈 Hide", qHidden: "Quote hidden.",
      qLocked: "🔒 revealed {0}", qChatHint: "Tip: long-press a chat message → 📖.", qPick: "📖 Quote", qPickAria: "Save as quote",
      mtHead: "🤔 Most likely", mtIntro: "One question at a time. Everyone votes for one member. No drinking rules.",
      mtStart: "🤔 Start a round", mtNext: "🤔 Next question", mtQ: "Who is most likely to {0}?", mtVotes: "{0}/{1} voted",
      mtClose: "🏁 Show result now", mtVoted: "Vote cast! You can change it until all have voted.", mtHist: "Earlier tonight",
      mtLeft: "{0} left", mtNeed2: "Needs 2+ members.", mtVoteN: "{0} vote(s)",
      vHead: "🗳️ Where next?", vIntro: "Pick 2–4 bars. The gang votes for 15 min. The winner becomes a call-out 🪖.",
      vPick: "Bars near you", vNone: "No bars nearby. Move the map to town (zoom in) and try again.",
      vStart: "🗳️ Start vote ({0})", vNeed: "Pick 2–4 bars.", vEnds: "⏱️ {0} left", vEnd: "🏁 End now",
      vWin: "🏆 It's {0}!", vNoWin: "Nobody voted.", vRally: "🪖 Call-out sent.", vRallyBtn: "🪖 Send call-out", vRallyOk: "🪖 Call-out sent!",
      vShow: "📍 Show on map", vNew: "🗳️ New vote", vCrowd: "👥 {0} here now", vCi: "📍 {0} checked in",
      vQ: { none: "🚶 No queue", short: "🚶 Short queue", long: "🚶 Long queue" }, vVoteToast: "🗳️ Voted for {0}.", vBy: "Started by {0}",
      bHead: "🥞 Hangover brunch", bWhere: "Where?", bWherePh: "Or type a place", bWhen: "When?", bNow: "Now",
      bSend: "🥞 Brunch? Ask the gang", bCall: "{0}: brunch at {1}{2}?", bAt: " at {0}", bJa: "✅ Yes", bKanske: "🤔 Maybe", bNej: "🛌 No",
      bIn: "{0} coming", bCancel: "Cancel", bCancelled: "Brunch cancelled.", bNoPlaces: "No cafés nearby on the map. Type a place.",
      bHours: "Opening hours: check before you go.", bNeedPlace: "Pick or type a place.",
      kHead: "🌯 Kebab top", kNear: "Food near you", kNone: "No food places near you.", kRate: "Rate", kStars: "Kebab stars", kTag: "Best at (optional)",
      kSave: "🌯 Save rating", kTop: "🌯 Kebab king of {0}", kTopNone: "No ratings in {0} this month. Be the first!", kTown: "the area",
      kAvg: "★ {0} ({1})", kMine: "Yours: {0}★", kOnce: "One rating per place per night. You can change it.", kNeedPos: "Turn on location so we know you're at the place.",
      kPopBtn: "🌯 Rate the food", kFoodOnly: "Food only – never alcohol.", kRated: "Rated tonight ✓",
      dHead: "💸 Debt book", dNetMe: "Net: {0}", dOwes: "{0} owes {1} kr", dGets: "{0} gets {1} kr", dEven: "{0} is even", dAllEven: "Everyone is even. 🌸",
      dPlan: "How to settle", dPay: "{0} → {1}: {2} kr", dAdd: "+ Add debt", dWho: "Who owes?", dTo: "To whom?", dAmount: "Amount (kr)", dWhat: "For what?",
      dWhatPh: "e.g. the pizza", dSave: "💸 Add", dLine: "{0} owes {1} {2} kr for {3}", dPaidBtn: "✅ Paid", dCancelBtn: "✕", dCancelQ: "Remove this debt?",
      dPaidList: "Paid recently", dUndo: "Undo", dSwishHead: "📱 My Swish number in this group", dSwishPh: "07x-xxx xx xx", dSwishSave: "Save", dSwishClear: "Remove",
      dSwishInfo: "⚠️ Everyone in the group {0} sees this number (only here). Save it only if you want the gang to Swish you.",
      dSwishOk: "📱 Swish number saved in {0}.", dSwishGone: "Swish number removed.", dSwish: "📱 Swish {0}", dCopy: "📋 Copy number", dCopied: "📋 Copied: {0}",
      dNoSwish: "{0} has no Swish number saved.", dSwishNote: "Swish opens with the amount filled in if your phone supports it. Else copy the number.",
      dNeed: "Pick two different people, amount and what.",
      pHead: "📰 Morning paper", pShare: "📤 Share", pSave: "⬇️ Save image", pMaking: "Printing…", pShared: "📰 Shared!", pDate: "{0}", pExtra: "EXTRA!",
      tMt: "🤔 {0}: new Most likely question. Vote!", tVart: "🗳️ {0}: where next? Vote!", tWin: "🏆 {0} decided: {1}!", tBrunch: "🥞 {0}: brunch at {1}?",
      tPaper: "📰 The morning paper for {0} is out!", open: "Open", vote: "Vote", answer: "Answer", read: "Read",
      errs: { error: "Something went wrong. Try again." }
    }
  };

  /* ---------- Helpers ---------- */
  function lang() { return I && I.lang === "en" ? "en" : "sv"; }
  function T(k) {
    var v = S[lang()][k]; if (v == null) v = S.sv[k];
    if (typeof v !== "string") return v;
    var args = arguments;
    return v.replace(/\{(\d)\}/g, function (m, i) { var a = args[+i + 1]; return a == null ? "" : String(a); });
  }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  var lastPick = {};
  function pick(key, list) {
    list = list || []; if (!list.length) return "";
    var i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[key]) i = (i + 1) % list.length;
    lastPick[key] = i; return list[i];
  }
  // Seeded random (same paper / same result line for everyone in the group).
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var x = hash(seed) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function spick(r, list) { return list && list.length ? list[Math.floor(r() * list.length) % list.length] : ""; }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) {
        off[name] = true; r.off = true;
        if (name === "gang_poll") { state = "missing"; poll = null; A.updateCounts(); }
      }
      return r;
    });
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function errText(err) { var e = S[lang()].errs || {}; return e[codeOf(err)] || S.sv.errs[codeOf(err)] || S.sv.errs.error; }
  function fail(r) { A.toast(errText(r.error), { err: true }); }
  function on() { return !!(A && A.LIVE && state !== "missing"); }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function bt(label, cls, fn) { return A.btn(label, cls, fn); }
  function fx(big) {
    try { window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate(big ? [20, 40, 20, 40, 80] : [18, 40, 18]); } catch (e) {}
  }
  function hourNow() { try { return U.hourSthlm(new Date()); } catch (e) { return new Date().getHours(); } }
  function myPos() {
    var c = (A.lastLoc && A.lastLoc()) || null;
    if (c && isFinite(c.lat) && isFinite(c.lng)) return { lat: c.lat, lng: c.lng, gps: true };
    var m = A.center && A.center();
    if (m && isFinite(m.lat)) return { lat: m.lat, lng: m.lng, gps: false };
    var mc = A.map.getCenter(); return { lat: mc.lat, lng: mc.lng, gps: false };
  }
  function townName(lat, lng) { var t = window.CITIES && window.CITIES.nearest ? window.CITIES.nearest(lat, lng) : null; return t ? t.name : null; }
  function dist(a, b) { return U.haversine(a.lat, a.lng, b.lat, b.lng); }
  function groupOf(id) { var gs = (poll && poll.groups) || []; for (var i = 0; i < gs.length; i++) if (String(gs[i].id) === String(id)) return gs[i]; return null; }
  function seenGet() { var s = U.ls.getJSON(SEEN_KEY, null); var n = poll ? poll.night : ""; if (!s || s.night !== n) s = { night: n, k: {} }; return s; }
  function seen(key) { var s = seenGet(); if (s.k[key]) return true; s.k[key] = 1; U.ls.setJSON(SEEN_KEY, s); return false; }
  function alive() { return !!(view && view.pane && document.body.contains(view.pane)); }
  function typing() { var ae = document.activeElement; return !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest && ae.closest(".gg")); }
  function mmss(ms) { return U.mmss(Math.max(0, ms)); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(lang() === "en" ? "en-GB" : "sv-SE", { timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long" }); }
    catch (e) { return String(iso || "").slice(0, 10); }
  }

  /* ---------- Toast queue ---------- */
  var tq = [], tqBusy = false;
  function queueToast(msg, opts) { tq.push([msg, opts || {}]); if (!tqBusy) nextToast(); }
  function nextToast() {
    var x = tq.shift(); if (!x) { tqBusy = false; return; }
    tqBusy = true; A.toast(x[0], x[1]); if (x[1].fx) fx(false);
    setTimeout(nextToast, Math.max(2600, Math.min(4800, (x[1].ms || 5000) - 600)));
  }

  /* ---------- Poll ---------- */
  function load(force) {
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    if (busy) { if (force) again = true; return Promise.resolve(); }
    if (!force && Date.now() - pollAt < POLL_MS) return Promise.resolve();
    if (document.visibilityState === "hidden") return Promise.resolve();
    busy = true; pollAt = Date.now();
    return call("gang_poll").then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data);
      if (!d || !Array.isArray(d.groups)) return;
      state = "on";
      var prev = poll; poll = d;
      try { notify(prev, d); } catch (e) {}
      // A poll past its 15 min: finish it (winner -> call-out). The server lock makes this safe for many phones.
      d.groups.forEach(function (g) { if (g.poll_due && g.poll_id) endPoll(g.poll_id, true); });
      A.updateCounts();
    }).then(function () { busy = false; firstPoll = false; if (again) { again = false; load(true); } }, function () { busy = false; });
  }
  function notify(prev, d) {
    var quiet = firstPoll, shown = 0, max = quiet ? 2 : 4;
    function say(key, msg, opts) { if (seen(key) || shown >= max) return; shown++; queueToast(msg, opts); }
    var h = d.hour != null ? d.hour : hourNow();
    d.groups.forEach(function (g) {
      var nm = g.name || "";
      if (g.mt_open && !g.mt_voted && g.mt_last) say("mt:" + g.mt_last, T("tMt", nm), { ms: 6000, fx: !quiet, action: { label: T("vote"), fn: function () { openGang(g, "mt"); } } });
      if (g.poll_open && !g.poll_voted && g.poll_id) say("poll:" + g.poll_id, T("tVart", nm), { ms: 6000, fx: !quiet, action: { label: T("vote"), fn: function () { openGang(g, "vart"); } } });
      if (g.poll_winner && g.poll_id) say("win:" + g.poll_id, T("tWin", nm, g.poll_winner), { ms: 6000, action: { label: T("open"), fn: function () { openGang(g, "vart"); } } });
      if (g.brunch && !g.brunch.by_me && !g.brunch.mine) say("brunch:" + g.brunch.id, T("tBrunch", g.brunch.by || T("someone"), g.brunch.place), { ms: 7000, fx: !quiet, action: { label: T("answer"), fn: function () { openGang(g, "brunch"); } } });
      if ((g.quotes_yday | 0) > 0 && h >= 10) say("qy:" + g.id, fill(pick("qr", C.quoteRevealToast), { n: g.quotes_yday }) + " · " + nm, { ms: 7000, action: { label: T("read"), fn: function () { openGang(g, "citat"); } } });
    });
  }
  function soon(ms) { setTimeout(function () { load(true); }, ms || 1500); }

  /* ---------- HUD chip (ONE) ---------- */
  function chipTarget() {
    if (!on() || !poll) return null;
    var gs = poll.groups || [], h = poll.hour != null ? poll.hour : hourNow(), i;
    for (i = 0; i < gs.length; i++) if (gs[i].poll_open && !gs[i].poll_voted) return { g: gs[i], tab: "vart" };
    for (i = 0; i < gs.length; i++) if (gs[i].mt_open && !gs[i].mt_voted) return { g: gs[i], tab: "mt" };
    for (i = 0; i < gs.length; i++) if (gs[i].brunch && !gs[i].brunch.mine && h >= 6 && h < 14) return { g: gs[i], tab: "brunch" };
    if (h >= 5 && h < 15) {
      var seenP = U.ls.getJSON(PAPER_KEY, {}) || {};
      for (i = 0; i < gs.length; i++) if (gs[i].paper && seenP[gs[i].id] !== poll.last_night) return { g: gs[i], tab: "tidning" };
    }
    return null;
  }

  /* ---------- Gänget sheet ---------- */
  function openGang(g, tab) {
    if (!on() || !g || !g.id) return;
    var t0 = tab || U.ls.get(TAB_KEY, "citat");
    if (TABS.indexOf(t0) < 0) t0 = "citat";
    stopTimer();
    view = { g: { id: g.id, name: g.name }, tab: t0, d: null, pane: null, timer: null, quotes: null, head: pick("qh", C.quoteHeaders) };
    A.openSheet(T("sheet", g.name || ""), function (body) {
      var root = el("div", { class: "gg" });
      root.appendChild(el("div", { class: "gg-top" }, [bt(T("back"), "btn-small", function () { stopTimer(); view = null; A.showGroups(); })]));
      var tabs = el("div", { class: "gg-tabs", role: "tablist" });
      TABS.forEach(function (k) {
        var b = el("button", { type: "button", class: "gg-tab", role: "tab", "data-t": k, "aria-selected": String(k === view.tab), text: T("tabs")[k] });
        b.addEventListener("click", function () { setTab(k); });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      var pane = el("div", { class: "gg-pane", role: "tabpanel" });
      root.appendChild(pane);
      body.appendChild(root);
      view.pane = pane; view.tabs = tabs;
      pane.appendChild(el("p", { class: "gg-note", text: T("loading") }));
      refreshGroup(true);
      view.timer = setInterval(function () {
        if (!alive()) { stopTimer(); return; }
        if (document.visibilityState === "hidden" || typing()) return;
        var fast = view.tab === "mt" || view.tab === "vart" || view.tab === "brunch";
        view.tick = (view.tick | 0) + 1;
        if (fast || view.tick % 5 === 0) refreshGroup(false);
        else paintClock();
      }, 3000);
      try { var sel = tabs.querySelector('[aria-selected="true"]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) {}
    });
  }
  function stopTimer() { if (view && view.timer) { clearInterval(view.timer); view.timer = null; } }
  function setTab(k) {
    if (!view) return;
    view.tab = k; U.ls.set(TAB_KEY, k);
    Array.prototype.forEach.call(view.tabs.children, function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-t") === k)); });
    render();
    if (k === "vart") loadStatus();
  }
  function refreshGroup(first) {
    if (!view) return Promise.resolve();
    var gid = view.g.id;
    return call("gang_group", { p_group_id: gid }).then(function (r) {
      if (!view || view.g.id !== gid || !alive()) return;
      if (r.error) {
        if (codeOf(r.error) === "not_member") { A.toast(errText(r.error), { err: true }); stopTimer(); A.showGroups(); return; }
        if (first) { view.pane.innerHTML = ""; view.pane.appendChild(el("p", { class: "gg-note", text: T("fail") })); }
        return;
      }
      var d = A.parseData(r.data);
      var key = JSON.stringify([d.mt, d.poll, d.brunch, d.quotes, d.debts, d.members]);
      checkRallyPush(d.poll);
      if (!first && key === view.key) { paintClock(); return; }
      view.key = key; view.d = d;
      if (!typing()) render();
    });
  }
  function render() {
    if (!view || !alive()) return;
    var pane = view.pane, d = view.d;
    var keep = pane.scrollTop;
    // Keep open <details> (forms) open across re-renders: match by summary text start.
    var openD = Array.prototype.map.call(pane.querySelectorAll("details[open]>summary"), function (x) { return x.textContent.slice(0, 12); });
    pane.innerHTML = "";
    if (!d && view.tab !== "kebab") { pane.appendChild(el("p", { class: "gg-note", text: T("loading") })); return; }
    try {
      ({ citat: renderQuotes, mt: renderMt, vart: renderVart, brunch: renderBrunch, skuld: renderDebts, tidning: renderPaper, kebab: renderKebab })[view.tab](pane, d);
    } catch (e) { try { console.warn("olnu gang", e); } catch (x) {} pane.appendChild(el("p", { class: "gg-note", text: T("fail") })); }
    if (openD.length) pane.querySelectorAll("details>summary").forEach(function (x) { if (openD.indexOf(x.textContent.slice(0, 12)) >= 0) x.parentNode.open = true; });
    pane.scrollTop = keep;
  }
  function paintClock() {
    if (!alive()) return;
    view.pane.querySelectorAll("[data-ends]").forEach(function (x) {
      var ms = Date.parse(x.getAttribute("data-ends")) - Date.now();
      x.textContent = T(x.getAttribute("data-fmt") || "vEnds", mmss(ms));
      if (ms <= 0 && x.getAttribute("data-poll") && !x.getAttribute("data-done")) { x.setAttribute("data-done", "1"); endPoll(+x.getAttribute("data-poll"), true); }
    });
  }
  function memberName(m) { return m.is_me ? T("you") : (m.name || T("someone")); }
  function card(cls, kids) { return el("div", { class: "gg-card " + (cls || "") }, kids); }

  /* ---------- 📖 Citatboken ---------- */
  function renderQuotes(pane, d) {
    var q = d.quotes || {}, members = d.members || [];
    pane.appendChild(el("h3", { class: "gg-h", text: view.head || "📖" }));
    var yd = q.yesterday || [];
    if (yd.length) {
      pane.appendChild(card("gg-yday", [el("div", { class: "gg-ct", text: T("qYday") })].concat(yd.map(function (x) {
        return el("blockquote", { class: "gg-quote" }, [el("p", { text: "”" + x.body + "”" }), el("cite", { text: "– " + x.who + " · " + U.timeHM(x.at) })]);
      }))));
    }
    // Add form
    var who = el("input", { class: "inp", maxlength: "30", placeholder: T("qWhoPh"), "aria-label": T("qWho"), autocomplete: "off" });
    var chips = el("div", { class: "gg-chips" });
    members.forEach(function (m) {
      var c = el("button", { type: "button", class: "gg-chip", text: m.name || "?" });
      c.addEventListener("click", function () { who.value = m.name || ""; chips.querySelectorAll(".gg-chip").forEach(function (x) { x.classList.toggle("on", x === c); }); });
      chips.appendChild(c);
    });
    var body = el("textarea", { class: "inp gg-ta", maxlength: "140", rows: "2", placeholder: T("qBodyPh"), "aria-label": T("qBody") });
    var cnt = el("span", { class: "gg-cnt", text: "0/140" });
    body.addEventListener("input", function () { cnt.textContent = body.value.length + "/140"; });
    var save = bt(T("qSave"), "btn-amber btn-block", function () {
      var w = who.value.trim(), b = body.value.trim();
      if (!w || !b) { A.toast(S.sv.errs.invalid_quote, { err: true }); return; }
      save.disabled = true;
      call("add_quote", { p_group_id: view.g.id, p_who: w, p_body: b, p_msg_id: null }).then(function (r) {
        save.disabled = false;
        if (r.error) { fail(r); return; }
        body.value = ""; cnt.textContent = "0/140";
        A.toast(pick("qs", C.quoteSaved), { ms: 4500 }); fx(false);
        view.quotes = null; refreshGroup(true); soon(2500);
      });
    });
    var det = el("details", { class: "gg-add" }, [el("summary", { text: T("qAdd") }),
      el("label", { class: "gg-l", text: T("qWho") }), chips, who,
      el("label", { class: "gg-l", text: T("qBody") }), body, cnt, save,
      el("p", { class: "gg-note", text: T("qChatHint") })]);
    if (!yd.length && !(view.quotes && view.quotes.length)) det.open = true;
    pane.appendChild(det);
    if ((q.pending | 0) > 0) {
      var nr = q.next_reveal ? Date.parse(q.next_reveal) : 0;
      var when = nr && new Date(nr).toDateString() === new Date().toDateString() ? T("qWhenToday") : T("qWhen");
      pane.appendChild(el("p", { class: "gg-lock", text: T("qPending", q.pending, when) }));
    }
    // Book
    var list = el("ul", { class: "gg-book" });
    pane.appendChild(list);
    function paint(rows) {
      list.innerHTML = "";
      if (!rows.length) { list.appendChild(el("li", { class: "gg-note", text: T("qEmpty") })); return; }
      rows.forEach(function (x) {
        var li = el("li", { class: "gg-q" + (x.revealed ? "" : " locked") }, [
          el("p", { class: "gg-qb", text: "”" + x.body + "”" }),
          el("div", { class: "gg-qm" }, [
            el("span", { text: "– " + x.who + " · " + fmtDate(x.created_at) + " " + U.timeHM(x.created_at) }),
            x.revealed ? null : el("span", { class: "gg-qlock", text: T("qLocked", T("qWhen")) })
          ])
        ]);
        if (x.can_hide) {
          var hb = el("button", { type: "button", class: "gg-qhide", text: T("qHide") });
          hb.addEventListener("click", function () {
            hb.disabled = true;
            call("hide_quote", { p_quote_id: x.id }).then(function (r) {
              if (r.error) { hb.disabled = false; fail(r); return; }
              A.toast(T("qHidden")); view.quotes = view.quotes.filter(function (y) { return y.id !== x.id; }); paint(view.quotes);
            });
          });
          li.querySelector(".gg-qm").appendChild(hb);
        }
        list.appendChild(li);
      });
      if (rows.length && rows.length % 30 === 0) {
        var more = bt(T("qMore"), "btn-small btn-block", function () {
          more.disabled = true;
          loadQuotes(rows[rows.length - 1].id).then(function (n) { if (n) paint(view.quotes); else more.remove(); });
        });
        list.appendChild(el("li", {}, [more]));
      }
    }
    if (view.quotes) paint(view.quotes);
    else { list.appendChild(el("li", { class: "gg-note", text: T("loading") })); loadQuotes(null).then(function () { if (alive() && view.tab === "citat") paint(view.quotes || []); }); }
  }
  function loadQuotes(before) {
    var gid = view.g.id;
    return call("gang_quotes", { p_group_id: gid, p_before_id: before }).then(function (r) {
      if (!view || view.g.id !== gid) return 0;
      var rows = r.error ? [] : (r.data || []);
      view.quotes = before ? (view.quotes || []).concat(rows) : rows;
      return rows.length;
    });
  }
  // Chat long-press menu (social.js): "📖 Citat" next to the reactions.
  function chatPick(picker, g, m, close) {
    if (!on() || !picker || !g || !m || !m.id) return;
    var b = el("button", { type: "button", class: "cm-pick gg-pickq", role: "menuitem", text: T("qPick"), "aria-label": T("qPickAria"), title: T("qPickAria") });
    b.addEventListener("click", function (ev) {
      ev.stopPropagation(); if (close) close();
      call("add_quote", { p_group_id: g.id, p_who: m.name || T("someone"), p_body: String(m.body || "").slice(0, 140), p_msg_id: +m.id }).then(function (r) {
        if (r.off) return;
        if (r.error) { fail(r); return; }
        A.toast(pick("qs", C.quoteSaved), { ms: 4500 }); fx(false); soon(2000);
      });
    });
    picker.appendChild(b);
  }

  /* ---------- 🤔 Mest troligt ---------- */
  function qText(q) { var l = C.mt || []; return l.length ? l[(q | 0) % l.length] : "…"; }
  function renderMt(pane, d) {
    var mt = d.mt || {}, r = mt.round, members = d.members || [];
    pane.appendChild(el("h3", { class: "gg-h", text: T("mtHead") }));
    if (r && !r.done) {
      var c = card("gg-mt", [el("div", { class: "gg-bigq", text: T("mtQ", qText(r.q)) })]);
      var grid = el("div", { class: "gg-grid" });
      members.forEach(function (m) {
        var b = el("button", { type: "button", class: "gg-vote" + (r.my_vote === m.k ? " on" : ""), "aria-pressed": String(r.my_vote === m.k), text: m.name || "?" });
        b.addEventListener("click", function () {
          grid.querySelectorAll(".gg-vote").forEach(function (x) { x.disabled = true; });
          call("mt_vote", { p_round_id: r.id, p_member: m.k }).then(function (res) {
            if (res.error) { fail(res); refreshGroup(true); return; }
            fx(false); var j = A.parseData(res.data);
            if (j && j.done) A.toast(resultLine(j)); else A.toast(T("mtVoted"));
            refreshGroup(true); soon(1500);
          });
        });
        grid.appendChild(b);
      });
      c.appendChild(grid);
      c.appendChild(el("div", { class: "gg-meta" }, [
        el("span", { text: T("mtVotes", r.votes | 0, r.needed | 0) }),
        el("span", { class: "gg-clock", "data-ends": r.ends_at, "data-fmt": "mtLeft", text: T("mtLeft", mmss(Date.parse(r.ends_at) - Date.now())) })
      ]));
      if (r.by_me) c.appendChild(bt(T("mtClose"), "btn-small btn-block", function () {
        call("mt_close", { p_round_id: r.id }).then(function (res) { if (res.error) fail(res); refreshGroup(true); });
      }));
      pane.appendChild(c);
    } else {
      if (r && r.done) pane.appendChild(resultCard(r));
      else pane.appendChild(el("p", { class: "gg-note", text: T("mtIntro") }));
      var sb = bt(r ? T("mtNext") : T("mtStart"), "btn-amber btn-block", function () {
        if (members.length < 2) { A.toast(T("mtNeed2"), { err: true }); return; }
        sb.disabled = true;
        call("mt_start", { p_group_id: view.g.id, p_n: (C.mt || []).length || 120 }).then(function (res) {
          sb.disabled = false;
          if (res.error) { fail(res); refreshGroup(true); return; }
          fx(false); refreshGroup(true); soon(1500);
        });
      });
      pane.appendChild(sb);
    }
    var hist = (mt.history || []).filter(function (x) { return x.done && (!r || x.id !== r.id); });
    if (hist.length) {
      pane.appendChild(el("h4", { class: "gg-h4", text: T("mtHist") }));
      pane.appendChild(el("ul", { class: "gg-hist" }, hist.map(function (x) {
        var w = winners(x);
        return el("li", {}, [el("span", { class: "gg-hq", text: qText(x.q) }), el("b", { text: w.length ? w.map(function (y) { return y.name; }).join(" & ") : "–" })]);
      })));
    }
  }
  function winners(r) {
    var res = r.results || []; if (!res.length) return [];
    var top = res[0].n | 0; return res.filter(function (x) { return (x.n | 0) === top; });
  }
  function resultLine(r) {
    var w = winners(r);
    if (!w.length) return C.mtNoVotes || "";
    var names = w.map(function (x) { return x.name || "?"; }).join(" & ");
    if (w.length > 1) return fill(C.mtTie, { name: names });
    return fill(spick(rng("mt" + r.id), C.mtResult || []), { name: names });
  }
  function resultCard(r) {
    var res = r.results || [], max = Math.max(1, res.length ? res[0].n | 0 : 1);
    var c = card("gg-mt done", [el("div", { class: "gg-bigq", text: T("mtQ", qText(r.q)) })]);
    var ul = el("ul", { class: "gg-res" });
    res.forEach(function (x, i) {
      ul.appendChild(el("li", { class: i === 0 || (x.n | 0) === max ? "win" : "" }, [
        el("span", { class: "gg-rn", text: (x.is_me ? T("you") + " (" + x.name + ")" : x.name) || "?" }),
        el("span", { class: "gg-rbar" }, [el("span", { style: "width:" + Math.round(100 * (x.n | 0) / max) + "%" })]),
        el("span", { class: "gg-rv", text: String(x.n | 0) })
      ]));
    });
    c.appendChild(ul);
    c.appendChild(el("p", { class: "gg-line", text: resultLine(r) }));
    return c;
  }

  /* ---------- 🗳️ Vart ska vi? ---------- */
  function loadStatus() {
    if (Date.now() - statusCache.at < 60000 || off.bar_status) return Promise.resolve();
    statusCache.at = Date.now();
    return call("bar_status").then(function (r) {
      if (r.error) return;
      var m = {}; (r.data || []).forEach(function (x) { if (x && x.bar_id != null) m[String(x.bar_id)] = x; });
      statusCache.m = m;
      if (alive() && view.tab === "vart" && !typing()) render();
    });
  }
  function liveInfo(id) {
    var out = [], n = 0, ci = 0;
    try { A.beers().forEach(function (b) { if (String(b.bar_id) === String(id) && U.drinks(b) >= 1) n++; }); } catch (e) {}
    try { (A.checkins() || []).forEach(function (c) { if (String(c.bar_id) === String(id)) ci++; }); } catch (e) {}
    if (n) out.push(T("vCrowd", n));
    if (ci) out.push(T("vCi", ci));
    var s = statusCache.m[String(id)];
    if (s && s.queue && T("vQ")[s.queue]) out.push(T("vQ")[s.queue]);
    return out.join(" · ");
  }
  function nearbyBars() {
    var p = myPos(), seenIds = {}, out = [];
    function add(b) {
      if (!b || !b.name || seenIds[b.id] || !isFinite(b.lat)) return;
      seenIds[b.id] = 1; out.push({ id: String(b.id), name: b.name, lat: b.lat, lng: b.lng, d: dist(p, b) });
    }
    try { window.BARS.nearby(p.lat, p.lng, 3000, 30).forEach(function (x) { add(x.bar); }); } catch (e) {}
    try { if (A.map.getZoom() >= 12) window.BARS.inBounds(A.map.getBounds(), 60).forEach(add); } catch (e) {}
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, 30);
  }
  function renderVart(pane, d) {
    var p = d.poll;
    pane.appendChild(el("h3", { class: "gg-h", text: T("vHead") }));
    if (p && !p.ended) {
      var c = card("gg-poll", [el("p", { class: "gg-line", text: spick(rng("pl" + p.id), C.pollLines || []) })]);
      (p.options || []).forEach(function (o) {
        var info = liveInfo(o.id);
        var b = el("button", { type: "button", class: "gg-opt" + (p.my_vote === o.i ? " on" : ""), "aria-pressed": String(p.my_vote === o.i) }, [
          el("span", { class: "gg-on", text: o.name }),
          info ? el("span", { class: "gg-oi", text: info }) : null,
          el("span", { class: "gg-ov" }, [el("b", { text: String(o.n | 0) }), el("span", { text: (o.names || []).join(", ") })]),
          el("span", { class: "gg-obar" }, [el("span", { style: "width:" + Math.round(100 * (o.n | 0) / Math.max(1, p.votes | 0)) + "%" })])
        ]);
        b.addEventListener("click", function () {
          c.querySelectorAll(".gg-opt").forEach(function (x) { x.disabled = true; });
          call("vote_bar_poll", { p_poll_id: p.id, p_option: o.i }).then(function (r) {
            if (r.error) { fail(r); refreshGroup(true); return; }
            fx(false); A.toast(T("vVoteToast", o.name)); refreshGroup(true); soon(1500);
          });
        });
        c.appendChild(b);
      });
      c.appendChild(el("div", { class: "gg-meta" }, [
        el("span", { text: T("vBy", p.by_me ? T("you") : (p.by || T("someone"))) }),
        el("span", { class: "gg-clock", "data-ends": p.ends_at, "data-poll": String(p.id), text: T("vEnds", mmss(Date.parse(p.ends_at) - Date.now())) })
      ]));
      if (p.by_me) c.appendChild(bt(T("vEnd"), "btn-small btn-block", function () { endPoll(p.id, false); }));
      pane.appendChild(c);
      return;
    }
    if (p && p.ended) {
      var w = p.winner != null ? (p.options || [])[p.winner] : null;
      var wc = card("gg-poll done", [el("div", { class: "gg-bigq", text: w ? T("vWin", w.name) : T("vNoWin") })]);
      if (w) {
        wc.appendChild(el("p", { class: "gg-line", text: fill(spick(rng("pw" + p.id), C.pollWinner || []), { bar: w.name }) }));
        var info = liveInfo(w.id); if (info) wc.appendChild(el("p", { class: "gg-note", text: info }));
        var row = el("div", { class: "gg-row" }, [bt(T("vShow"), "btn-small", function () { A.closeSheet(); A.flyTo(w.lat, w.lng, 17, null); })]);
        if (p.rally_id) wc.appendChild(el("p", { class: "gg-ok", text: T("vRally") }));
        else row.appendChild(bt(T("vRallyBtn"), "btn-small btn-green", function (e) { rallyFor(w, e && e.target); }));
        wc.appendChild(row);
      }
      pane.appendChild(wc);
    }
    pane.appendChild(el("p", { class: "gg-note", text: T("vIntro") }));
    var bars = nearbyBars(), chosen = [];
    pane.appendChild(el("h4", { class: "gg-h4", text: T("vPick") }));
    if (!bars.length) { pane.appendChild(el("p", { class: "gg-note", text: T("vNone") })); return; }
    var go = bt(T("vStart", 0), "btn-amber btn-block", function () {
      if (chosen.length < 2 || chosen.length > 4) { A.toast(T("vNeed"), { err: true }); return; }
      go.disabled = true;
      call("create_bar_poll", { p_group_id: view.g.id, p_options: chosen.map(function (b) { return { id: b.id, name: b.name.slice(0, 60), lat: b.lat, lng: b.lng }; }) }).then(function (r) {
        go.disabled = false;
        if (r.error) { fail(r); refreshGroup(true); return; }
        fx(true); refreshGroup(true); soon(1500);
      });
    });
    go.disabled = true;
    var ul = el("ul", { class: "gg-pick" });
    bars.forEach(function (b) {
      var info = liveInfo(b.id);
      var li = el("li", {}, [el("button", { type: "button", class: "gg-pk", "aria-pressed": "false" }, [
        el("span", { class: "gg-pkn", text: b.name }),
        el("span", { class: "gg-pkd", text: (b.d < 1000 ? Math.round(b.d / 10) * 10 + " m" : (b.d / 1000).toFixed(1) + " km") + (info ? " · " + info : "") })
      ])]);
      var btn = li.firstChild;
      btn.addEventListener("click", function () {
        var i = chosen.indexOf(b);
        if (i >= 0) chosen.splice(i, 1); else { if (chosen.length >= 4) { A.toast(T("vNeed")); return; } chosen.push(b); }
        btn.classList.toggle("on", chosen.indexOf(b) >= 0); btn.setAttribute("aria-pressed", String(chosen.indexOf(b) >= 0));
        go.textContent = T("vStart", chosen.length); go.disabled = chosen.length < 2;
      });
      ul.appendChild(li);
    });
    pane.appendChild(ul);
    pane.appendChild(el("div", { class: "gg-sticky" }, [go]));
  }
  function endPoll(id, quiet) {
    return call("end_bar_poll", { p_poll_id: id }).then(function (r) {
      if (r.error) { if (!quiet) fail(r); return; }
      var p = A.parseData(r.data);
      checkRallyPush(p);
      if (!quiet && p && p.winner != null) fx(true);
      if (view && alive()) refreshGroup(true);
      soon(1200);
    });
  }
  // The call-out made by our end/view call: send the normal rally push once (existing notify-group event).
  function checkRallyPush(p) {
    if (!p || !p.rally_id || !p.rally_mine) return;
    var done = U.ls.getJSON(PUSHED_KEY, []) || [];
    if (done.indexOf(p.rally_id) >= 0) return;
    done.push(p.rally_id); U.ls.setJSON(PUSHED_KEY, done.slice(-20));
    A.invoke("notify-group", { event: "rally", rally_id: p.rally_id });
    try { A.refresh(true); } catch (e) {}
  }
  function rallyFor(w, b) {
    if (b) b.disabled = true;
    A.rpc("create_rally", { p_group_id: view.g.id, p_body: ("🗳️ Gänget har röstat: " + w.name + "!").slice(0, 100), p_place: w.name.slice(0, 60), p_lat: w.lat, p_lng: w.lng }).then(function (r) {
      if (b) b.disabled = false;
      if (r.error) { A.toast(U.errCode(r.error) === "slow_down" ? S.sv.errs.slow_down : S.sv.errs.error, { err: true }); return; }
      var j = A.parseData(r.data);
      if (j && j.id) A.invoke("notify-group", { event: "rally", rally_id: j.id });
      A.toast(T("vRallyOk")); fx(true); try { A.refresh(true); } catch (e) {}
    });
  }

  /* ---------- 🥞 Bakisbrunchen ---------- */
  function nearbyPlaces(types, maxM, max) {
    var p = myPos(), out = [];
    try {
      window.BARS.nearby(p.lat, p.lng, 1, 0, { places: true, placeM: maxM, maxPlaces: 200 }).forEach(function (x) {
        if (x.place && x.bar && types.indexOf(x.bar.type) >= 0) out.push({ id: x.bar.id, name: x.bar.name, lat: x.bar.lat, lng: x.bar.lng, type: x.bar.type, d: x.d });
      });
    } catch (e) {}
    out.sort(function (a, b) { return types.indexOf(a.type) - types.indexOf(b.type) || a.d - b.d; });
    return out.slice(0, max || 12);
  }
  function renderBrunch(pane, d) {
    var b = d.brunch, h = d.hour != null ? d.hour : hourNow();
    pane.appendChild(el("h3", { class: "gg-h", text: T("bHead") }));
    if (b) {
      var c = card("gg-brunch", [
        el("div", { class: "gg-bigq", text: T("bCall", b.by_me ? T("you") : (b.by || T("someone")), b.place, b.at_time ? T("bAt", b.at_time) : "") }),
        el("p", { class: "gg-line", text: spick(rng("br" + b.id), C.brunch || []) })
      ]);
      var seg = el("div", { class: "gg-seg" });
      [["ja", T("bJa")], ["kanske", T("bKanske")], ["nej", T("bNej")]].forEach(function (a) {
        var x = el("button", { type: "button", class: "gg-sb a-" + a[0] + (b.mine === a[0] ? " on" : ""), "aria-pressed": String(b.mine === a[0]), text: a[1] });
        x.addEventListener("click", function () {
          seg.querySelectorAll("button").forEach(function (y) { y.disabled = true; });
          call("answer_brunch", { p_brunch_id: b.id, p_answer: a[0] }).then(function (r) {
            if (r.error) fail(r); else fx(false);
            refreshGroup(true); soon(1500);
          });
        });
        seg.appendChild(x);
      });
      c.appendChild(seg);
      c.appendChild(el("p", { class: "gg-in", text: T("bIn", (b.ja || []).length) }));
      [["ja", "✅"], ["kanske", "🤔"], ["nej", "🛌"]].forEach(function (a) {
        if ((b[a[0]] || []).length) c.appendChild(el("p", { class: "gg-names", text: a[1] + " " + b[a[0]].join(", ") }));
      });
      c.appendChild(el("p", { class: "gg-note", text: T("bHours") }));
      var row = el("div", { class: "gg-row" });
      if (b.lat != null && b.lng != null) row.appendChild(bt(T("vShow"), "btn-small", function () { A.closeSheet(); A.flyTo(b.lat, b.lng, 17, null); }));
      if (b.by_me) row.appendChild(bt(T("bCancel"), "btn-small", function () {
        call("close_brunch", { p_brunch_id: b.id }).then(function (r) { if (r.error) fail(r); else A.toast(T("bCancelled")); refreshGroup(true); });
      }));
      if (row.children.length) c.appendChild(row);
      pane.appendChild(c);
      return;
    }
    if (h < 6 || h >= 14) { pane.appendChild(el("p", { class: "gg-note gg-big", text: C.brunchClosed || "" })); return; }
    pane.appendChild(el("p", { class: "gg-line", text: pick("br", C.brunch || []) }));
    var sel = null, places = nearbyPlaces(["cafe", "restaurant", "fast_food"], 2000, 10);
    pane.appendChild(el("h4", { class: "gg-h4", text: T("bWhere") }));
    var inp = el("input", { class: "inp", maxlength: "60", placeholder: T("bWherePh"), "aria-label": T("bWhere") });
    if (!places.length) pane.appendChild(el("p", { class: "gg-note", text: T("bNoPlaces") }));
    else {
      var ul = el("ul", { class: "gg-pick" });
      places.forEach(function (pl) {
        var x = el("button", { type: "button", class: "gg-pk", "aria-pressed": "false" }, [
          el("span", { class: "gg-pkn", text: (pl.type === "cafe" ? "☕ " : "🍽️ ") + pl.name }),
          el("span", { class: "gg-pkd", text: pl.d < 1000 ? Math.round(pl.d / 10) * 10 + " m" : (pl.d / 1000).toFixed(1) + " km" })
        ]);
        x.addEventListener("click", function () {
          sel = sel === pl ? null : pl;
          ul.querySelectorAll(".gg-pk").forEach(function (y) { y.classList.toggle("on", y === x && !!sel); y.setAttribute("aria-pressed", String(y === x && !!sel)); });
          if (sel) inp.value = "";
        });
        ul.appendChild(el("li", {}, [x]));
      });
      pane.appendChild(ul);
    }
    inp.addEventListener("input", function () { if (inp.value.trim()) { sel = null; pane.querySelectorAll(".gg-pk.on").forEach(function (y) { y.classList.remove("on"); }); } });
    pane.appendChild(inp);
    pane.appendChild(el("h4", { class: "gg-h4", text: T("bWhen") }));
    var at = null, times = el("div", { class: "gg-chips" });
    var opts = [[null, T("bNow")]];
    for (var hh = Math.max(h + 1, 9); hh <= 14; hh++) opts.push([("0" + hh).slice(-2) + ":00", ("0" + hh).slice(-2) + ":00"]);
    opts.forEach(function (o, i) {
      var x = el("button", { type: "button", class: "gg-chip" + (i === 0 ? " on" : ""), text: o[1] });
      x.addEventListener("click", function () { at = o[0]; times.querySelectorAll(".gg-chip").forEach(function (y) { y.classList.toggle("on", y === x); }); });
      times.appendChild(x);
    });
    pane.appendChild(times);
    var send = bt(T("bSend"), "btn-amber btn-block", function () {
      var place = sel ? sel.name : inp.value.trim();
      if (!place) { A.toast(T("bNeedPlace"), { err: true }); return; }
      send.disabled = true;
      call("create_brunch", { p_group_id: view.g.id, p_place: place.slice(0, 60), p_place_id: sel ? String(sel.id) : null,
        p_lat: sel ? sel.lat : null, p_lng: sel ? sel.lng : null, p_at: at }).then(function (r) {
        send.disabled = false;
        if (r.error) { fail(r); refreshGroup(true); return; }
        fx(true); refreshGroup(true); soon(1500);
      });
    });
    pane.appendChild(el("div", { class: "gg-sticky" }, [send]));
  }

  /* ---------- 🌯 Kebabtoppen ---------- */
  function renderKebab(pane) {
    pane.appendChild(el("h3", { class: "gg-h", text: T("kHead") }));
    pane.appendChild(el("p", { class: "gg-line", text: pick("kl", C.kebabLines || []) }));
    kebabTopBox(pane);
    pane.appendChild(el("h4", { class: "gg-h4", text: T("kNear") }));
    var places = nearbyPlaces(["fast_food", "restaurant"], 1500, 15);
    if (!places.length) { pane.appendChild(el("p", { class: "gg-note", text: T("kNone") })); return; }
    var ul = el("ul", { class: "gg-pick" });
    places.forEach(function (pl) {
      var x = el("button", { type: "button", class: "gg-pk" }, [
        el("span", { class: "gg-pkn", text: (pl.type === "fast_food" ? "🌯 " : "🍽️ ") + pl.name }),
        el("span", { class: "gg-pkd", text: (pl.d < 1000 ? Math.round(pl.d / 10) * 10 + " m" : (pl.d / 1000).toFixed(1) + " km") + " · " + T("kRate") + " ›" })
      ]);
      x.addEventListener("click", function () { rateSheet(pl); });
      ul.appendChild(el("li", {}, [x]));
    });
    pane.appendChild(ul);
    pane.appendChild(el("p", { class: "gg-note", text: T("kFoodOnly") }));
  }
  function kebabTopBox(parent) {
    var p = myPos(), box = el("div", { class: "gg-ktop" }), key = (Math.round(p.lat * 20) / 20) + ":" + (Math.round(p.lng * 20) / 20);
    var town = townName(p.lat, p.lng) || T("kTown");
    box.appendChild(el("h4", { class: "gg-h4", text: T("kTop", town) }));
    var ol = el("ol", { class: "gg-klist" }, [el("li", { class: "gg-note", text: T("loading") })]);
    box.appendChild(ol);
    parent.appendChild(box);
    var c = kebabTopCache[key];
    var go = c && Date.now() - c.at < 60000 ? Promise.resolve(c.d) : call("kebab_top", { p_lat: p.lat, p_lng: p.lng, p_month_offset: 0 }).then(function (r) {
      if (r.error) return r.off ? "off" : null;
      var d = A.parseData(r.data); kebabTopCache[key] = { at: Date.now(), d: d }; return d;
    });
    go.then(function (d) {
      if (d === "off") { box.remove(); return; }
      ol.innerHTML = "";
      var list = (d && d.list) || [];
      if (d && d.town) box.querySelector("h4").textContent = T("kTop", d.town);
      if (!list.length) { ol.appendChild(el("li", { class: "gg-note", text: T("kTopNone", (d && d.town) || town) })); return; }
      list.forEach(function (x) {
        var tag = null; (C.kebabTags || []).forEach(function (t) { if (t[0] === x.tag) tag = t[1]; });
        var li = el("li", { class: x.rank === 1 ? "king" : "" }, [
          el("span", { class: "gg-kr", text: x.rank === 1 ? "👑" : String(x.rank) }),
          el("span", { class: "gg-kn", text: x.name }),
          el("span", { class: "gg-ks", text: T("kAvg", (+x.avg).toFixed(1), x.n) + (tag ? " · " + tag : "") })
        ]);
        li.addEventListener("click", function () { A.closeSheet(); A.flyTo(x.lat, x.lng, 17, null); });
        ol.appendChild(li);
      });
    });
  }
  function rateSheet(pl) {
    var back = view ? { g: view.g, tab: view.tab } : null;
    A.openSheet(T("kHead"), function (body) {
      var root = el("div", { class: "gg" });
      root.appendChild(el("div", { class: "gg-top" }, [bt("← " + (back ? T("tabs").kebab : T("kHead")), "btn-small", function () { if (back) openGang(back.g, "kebab"); else A.closeSheet(); })]));
      root.appendChild(el("h3", { class: "gg-h", text: "🌯 " + pl.name }));
      var info = el("p", { class: "gg-note", text: T("loading") });
      root.appendChild(info);
      var stars = 0, tag = null;
      root.appendChild(el("h4", { class: "gg-h4", text: T("kStars") }));
      var srow = el("div", { class: "gg-stars", role: "radiogroup", "aria-label": T("kStars") });
      for (var i = 1; i <= 5; i++) (function (n) {
        var s = el("button", { type: "button", class: "gg-star", role: "radio", "aria-checked": "false", "aria-label": n + " ★", text: "🌯" });
        s.addEventListener("click", function () { stars = n; paintStars(); });
        srow.appendChild(s);
      })(i);
      function paintStars() { Array.prototype.forEach.call(srow.children, function (s, i) { s.classList.toggle("on", i < stars); s.setAttribute("aria-checked", String(i + 1 === stars)); }); }
      root.appendChild(srow);
      root.appendChild(el("h4", { class: "gg-h4", text: T("kTag") }));
      var tags = el("div", { class: "gg-chips" });
      (C.kebabTags || []).forEach(function (t) {
        var x = el("button", { type: "button", class: "gg-chip", "data-tag": t[0], text: t[1] });
        x.addEventListener("click", function () { tag = tag === t[0] ? null : t[0]; paintTags(); });
        tags.appendChild(x);
      });
      function paintTags() { tags.querySelectorAll(".gg-chip").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-tag") === tag); }); }
      root.appendChild(tags);
      var save = bt(T("kSave"), "btn-amber btn-block", function () {
        if (!stars) { A.toast(S.sv.errs.invalid_stars, { err: true }); return; }
        var me = (A.lastLoc && A.lastLoc()) || null;
        var doSave = function (pos) {
          save.disabled = true;
          call("rate_kebab", { p_place_id: String(pl.id), p_name: pl.name.slice(0, 60), p_lat: pl.lat, p_lng: pl.lng, p_stars: stars, p_tag: tag,
            p_my_lat: pos ? pos.lat : null, p_my_lng: pos ? pos.lng : null }).then(function (r) {
            save.disabled = false;
            if (r.error) { fail(r); return; }
            kebabPlaceCache[pl.id] = null; kebabTopCache = {};
            A.toast(pick("ks", C.kebabSaved), { ms: 4000 }); fx(false);
            if (back) openGang(back.g, "kebab"); else A.closeSheet();
          });
        };
        if (me && isFinite(me.lat)) doSave(me);
        else if (A.getPosition) {
          Promise.resolve(A.getPosition()).then(function (p) {
            var pos = p && p.coords ? { lat: p.coords.latitude, lng: p.coords.longitude } : p && isFinite(p.lat) ? p : null;
            if (!pos) { A.toast(T("kNeedPos"), { err: true }); return; }
            try { A.setLastLoc(pos.lat, pos.lng); } catch (e) {}
            doSave(pos);
          }, function () { A.toast(T("kNeedPos"), { err: true }); });
        } else A.toast(T("kNeedPos"), { err: true });
      });
      root.appendChild(save);
      root.appendChild(el("p", { class: "gg-note", text: T("kOnce") + " " + T("kFoodOnly") }));
      body.appendChild(root);
      call("kebab_place", { p_place_id: String(pl.id) }).then(function (r) {
        if (r.error) { info.textContent = ""; return; }
        var d = A.parseData(r.data) || {};
        var parts = [];
        if ((d.n | 0) > 0) parts.push(T("kAvg", (+d.avg).toFixed(1), d.n));
        if (d.my_stars) { parts.push(T("kMine", d.my_stars)); stars = d.my_stars | 0; tag = d.my_tag || null; paintStars(); paintTags(); }
        if (d.rated_tonight) parts.push(T("kRated"));
        info.textContent = parts.join(" · ");
      });
    });
  }

  /* ---------- 💸 Skuldboken ---------- */
  // Fewest transfers: biggest debtor pays biggest creditor, repeat.
  function settlePlan(net) {
    var debt = [], cred = [], out = [];
    (net || []).forEach(function (x) { if (x.net < 0) debt.push({ x: x, v: -x.net }); else if (x.net > 0) cred.push({ x: x, v: x.net }); });
    debt.sort(function (a, b) { return b.v - a.v; }); cred.sort(function (a, b) { return b.v - a.v; });
    var i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      var a = Math.min(debt[i].v, cred[j].v);
      if (a > 0) out.push({ from: debt[i].x, to: cred[j].x, amount: a });
      debt[i].v -= a; cred[j].v -= a;
      if (debt[i].v <= 0) i++; if (cred[j].v <= 0) j++;
    }
    return out;
  }
  function swishUrl(num, amount, msg) {
    // Swish app link with payee, amount and message filled in (unofficial but widely used; falls back to copying the number).
    var data = { version: 1, payee: { value: num }, amount: { value: amount }, message: { value: String(msg || "").slice(0, 50), editable: true } };
    return "swish://payment?data=" + encodeURIComponent(JSON.stringify(data));
  }
  function renderDebts(pane, d) {
    var db = d.debts || {}, members = d.members || [], net = db.net || [], swish = {};
    (db.swish || []).forEach(function (s) { swish[s.k] = s; });
    pane.appendChild(el("h3", { class: "gg-h", text: T("dHead") }));
    pane.appendChild(el("p", { class: "gg-line", text: spick(rng("dl" + view.g.id + (poll ? poll.night : "")), C.debtLines || []) }));
    var me = null; net.forEach(function (x) { if (x.is_me) me = x; });
    var myName = (members.filter(function (m) { return m.is_me; })[0] || {}).name || T("you");
    pane.appendChild(card("gg-net", [el("div", { class: "gg-bigq", text: T("dNetMe", me ? (me.net < 0 ? T("dOwes", myName, -me.net) : T("dGets", myName, me.net)) : T("dEven", myName)) })]));
    if (!net.length) pane.appendChild(el("p", { class: "gg-note", text: T("dAllEven") }));
    else {
      var plan = settlePlan(net);
      pane.appendChild(el("h4", { class: "gg-h4", text: T("dPlan") }));
      var ul = el("ul", { class: "gg-plan" });
      plan.forEach(function (t) {
        var li = el("li", {}, [el("span", { class: "gg-pt", text: T("dPay", t.from.is_me ? T("you") : t.from.name, t.to.is_me ? T("you") : t.to.name, t.amount) })]);
        if (t.from.is_me) {
          var s = swish[t.to.k];
          if (s && s.number) {
            var row = el("div", { class: "gg-row" });
            var a = el("a", { class: "btn btn-small btn-green", href: swishUrl(s.number, t.amount, "Öl Nu: " + view.g.name), text: T("dSwish", t.to.name) });
            row.appendChild(a);
            row.appendChild(bt(T("dCopy"), "btn-small", function () { A.copyText(s.number); }));
            li.appendChild(row);
            li.appendChild(el("p", { class: "gg-note", text: s.number + " · " + T("dSwishNote") }));
          } else li.appendChild(el("p", { class: "gg-note", text: T("dNoSwish", t.to.name) }));
        }
        ul.appendChild(li);
      });
      pane.appendChild(ul);
    }
    // Open entries
    if ((db.open || []).length) {
      var ol = el("ul", { class: "gg-debts" });
      db.open.forEach(function (x) {
        var li = el("li", {}, [el("span", { class: "gg-dt", text: T("dLine", x.i_owe ? T("you") : x.debtor_name, x.owed_me ? (lang() === "en" ? "you" : "dig") : x.creditor_name, x.amount, x.what) }),
          el("span", { class: "gg-dm", text: (x.by ? x.by + " · " : "") + fmtDate(x.created_at) })]);
        var row = el("div", { class: "gg-row" });
        row.appendChild(bt(T("dPaidBtn"), "btn-small btn-green", function (e) { settle(x.id, "paid", e.target); }));
        if (x.can_cancel) row.appendChild(bt(T("dCancelBtn"), "btn-small gg-x", function (e) { if (window.confirm(T("dCancelQ"))) settle(x.id, "cancel", e.target); }));
        li.appendChild(row);
        ol.appendChild(li);
      });
      pane.appendChild(ol);
    }
    // Add form
    var debtor = el("select", { class: "inp", "aria-label": T("dWho") }), creditor = el("select", { class: "inp", "aria-label": T("dTo") });
    members.forEach(function (m, i) {
      debtor.appendChild(el("option", { value: m.k, text: m.name || "?" }));
      creditor.appendChild(el("option", { value: m.k, text: m.name || "?" }));
    });
    var meM = members.filter(function (m) { return m.is_me; })[0];
    if (meM) creditor.value = meM.k;
    var other = members.filter(function (m) { return !m.is_me; })[0]; if (other) debtor.value = other.k;
    var amount = el("input", { class: "inp", type: "number", inputmode: "numeric", min: "1", max: "50000", step: "1", placeholder: "85", "aria-label": T("dAmount") });
    var what = el("input", { class: "inp", maxlength: "40", placeholder: T("dWhatPh"), "aria-label": T("dWhat") });
    var wchips = el("div", { class: "gg-chips" });
    (C.debtWhat || []).forEach(function (w) {
      var x = el("button", { type: "button", class: "gg-chip", text: w });
      x.addEventListener("click", function () { what.value = w.replace(/^\S+\s/, "").toLowerCase(); wchips.querySelectorAll(".gg-chip").forEach(function (y) { y.classList.toggle("on", y === x); }); });
      wchips.appendChild(x);
    });
    var add = bt(T("dSave"), "btn-amber btn-block", function () {
      var n = Math.round(+amount.value);
      if (debtor.value === creditor.value || !(n >= 1 && n <= 50000) || !what.value.trim()) { A.toast(T("dNeed"), { err: true }); return; }
      add.disabled = true;
      call("add_debt", { p_group_id: view.g.id, p_debtor: debtor.value, p_creditor: creditor.value, p_amount: n, p_what: what.value.trim() }).then(function (r) {
        add.disabled = false;
        if (r.error) { fail(r); return; }
        amount.value = ""; what.value = ""; fx(false); refreshGroup(true); soon(2000);
      });
    });
    pane.appendChild(el("details", { class: "gg-add" }, [el("summary", { text: T("dAdd") }),
      el("label", { class: "gg-l", text: T("dWho") }), debtor, el("label", { class: "gg-l", text: T("dTo") }), creditor,
      el("label", { class: "gg-l", text: T("dAmount") }), amount, el("label", { class: "gg-l", text: T("dWhat") }), wchips, what, add]));
    if ((db.paid || []).length) {
      var pl = el("ul", { class: "gg-debts paid" });
      db.paid.forEach(function (x) {
        var li = el("li", {}, [el("span", { class: "gg-dt", text: "✅ " + T("dLine", x.debtor_name, x.creditor_name, x.amount, x.what) })]);
        if (x.can_undo) li.appendChild(bt(T("dUndo"), "btn-small", function (e) { settle(x.id, "unpaid", e.target); }));
        pl.appendChild(li);
      });
      pane.appendChild(el("details", { class: "gg-add" }, [el("summary", { text: T("dPaidList") }), pl]));
    }
    // My Swish number (this group only)
    var mine = null; (db.swish || []).forEach(function (s) { if (s.is_me) mine = s.number; });
    var sw = el("input", { class: "inp", type: "tel", inputmode: "tel", maxlength: "16", placeholder: T("dSwishPh"), value: mine || "", "aria-label": T("dSwishHead") });
    var swRow = el("div", { class: "gg-row" }, [bt(T("dSwishSave"), "btn-small btn-green", function () { setSwish(sw.value); })]);
    if (mine) swRow.appendChild(bt(T("dSwishClear"), "btn-small", function () { setSwish(""); }));
    pane.appendChild(el("details", { class: "gg-add gg-swish" }, [el("summary", { text: T("dSwishHead") + (mine ? " · " + mine : "") }),
      el("p", { class: "gg-warn", text: T("dSwishInfo", view.g.name || "") }), sw, swRow]));
  }
  function settle(id, action, b) {
    if (b) b.disabled = true;
    call("settle_debt", { p_debt_id: id, p_action: action }).then(function (r) {
      if (b) b.disabled = false;
      if (r.error) { fail(r); return; }
      if (action === "paid") { A.toast(pick("dp", C.debtPaid)); fx(false); }
      refreshGroup(true); soon(2000);
    });
  }
  function setSwish(v) {
    var s = String(v || "").replace(/[\s\-().]/g, "");
    if (s && !/^(\+46|0046|0)7\d{8}$/.test(s)) { A.toast(S.sv.errs.invalid_swish, { err: true }); return; }
    call("set_swish", { p_group_id: view.g.id, p_number: s }).then(function (r) {
      if (r.error) { fail(r); return; }
      A.toast(s ? T("dSwishOk", view.g.name || "") : T("dSwishGone")); refreshGroup(true);
    });
  }

  /* ---------- 📰 Morgontidningen ---------- */
  function renderPaper(pane) {
    pane.appendChild(el("h3", { class: "gg-h", text: T("pHead") }));
    var box = el("div", { class: "gg-paper" }, [el("p", { class: "gg-note", text: T("pMaking") })]);
    pane.appendChild(box);
    var gid = view.g.id;
    var got = view.paper ? Promise.resolve(view.paper) : call("gang_paper", { p_group_id: gid, p_night: null }).then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data); if (view && view.g.id === gid) view.paper = d; return d;
    });
    got.then(function (d) {
      if (!alive() || view.tab !== "tidning") return;
      box.innerHTML = "";
      if (!d) { box.appendChild(el("p", { class: "gg-note", text: T("fail") })); return; }
      if (!d.ready) { box.appendChild(el("p", { class: "gg-note gg-big", text: (C.paper || {}).none || "" })); return; }
      var seenP = U.ls.getJSON(PAPER_KEY, {}) || {}; seenP[gid] = poll ? poll.last_night : d.night; U.ls.setJSON(PAPER_KEY, seenP); A.updateCounts();
      var model = paperModel(d, view.g);
      drawPaper(model).then(function (cv) {
        if (!alive()) return;
        var img = el("img", { class: "gg-pimg", alt: model.big + ". " + model.small.join(". "), src: cv.toDataURL("image/png") });
        box.appendChild(img);
        var row = el("div", { class: "gg-row" });
        if (navigator.share && navigator.canShare) row.appendChild(bt(T("pShare"), "btn-amber", function () { sharePaper(cv, model); }));
        row.appendChild(bt(T("pSave"), "btn-small", function () { downloadPaper(cv); }));
        box.appendChild(row);
      });
    });
  }
  function hhmm(iso) { return iso ? U.timeHM(iso) : ""; }
  function paperModel(d, g) {
    var P = (C.paper || {}), r = rng("paper:" + g.id + ":" + d.night);
    var ms = (d.members || []).filter(function (m) { return m.out; });
    var town = d.town || townName(myPos().lat, myPos().lng) || "Ludvika";
    var group = d.group_name || g.name || "Gänget";
    var facts = [];   // {kind, w, v}
    function best(key, min) {
      var top = null; ms.forEach(function (m) { if ((m[key] | 0) >= min && (!top || (m[key] | 0) > (top[key] | 0))) top = m; }); return top;
    }
    var b = best("bars", 2);
    if (b) facts.push({ kind: "bars", w: 6 + (b.bars | 0), v: { name: b.name, n: b.bars, bar: (b.bar_names || [])[0] || "" } });
    if ((d.takeovers || []).length) facts.push({ kind: "takeover", w: 9, v: { bar: d.takeovers[0], group: group } });
    var qs = (d.quotes || []).filter(function (q) { return q.body && q.body.length <= 70; });
    if (qs.length) { var q = spick(r, qs); facts.push({ kind: "quote", w: 8, v: { quote: q.body, who: q.who } }); }
    var mts = (d.mt || []).filter(function (x) { return (x.names || []).length === 1; });
    if (mts.length) { var m = spick(r, mts); facts.push({ kind: "mt", w: 7, v: { name: m.names[0], q: qText(m.q) } }); }
    var sk = best("skal", 3); if (sk) facts.push({ kind: "skal", w: 5 + Math.min(4, (sk.skal | 0) / 3), v: { name: sk.name, n: sk.skal } });
    var homes = ms.filter(function (x) { return x.home_at; }).sort(function (a, b2) { return Date.parse(a.home_at) - Date.parse(b2.home_at); });
    if (homes.length) facts.push({ kind: "home", w: 5, v: { name: homes[0].name, time: hhmm(homes[0].home_at) } });
    var et = best("eta_max", 15); if (et) facts.push({ kind: "eta", w: 5, v: { name: et.name, n: et.eta_max } });
    var kb = ms.filter(function (x) { return x.kebab; })[0] || (d.members || []).filter(function (x) { return x.kebab; })[0];
    if (kb) facts.push({ kind: "kebab", w: 6, v: { name: kb.name, place: kb.kebab } });
    var ra = best("rallies", 1); if (ra) facts.push({ kind: "rally", w: 4, v: { name: ra.name } });
    if (d.crawl_done) facts.push({ kind: "crawl", w: 6, v: { group: group } });
    if ((d.out_n | 0) >= 3) facts.push({ kind: "crowd", w: 3 + (d.out_n | 0) / 2, v: { n: d.out_n, town: town, group: group } });
    var firsts = ms.filter(function (x) { return x.first_at; }).sort(function (a, b2) { return Date.parse(a.first_at) - Date.parse(b2.first_at); });
    if (firsts.length) facts.push({ kind: "first", w: 2, v: { name: firsts[0].name, time: hhmm(firsts[0].first_at) } });
    facts.forEach(function (f) { f.w += r() * 3; f.v.town = f.v.town || town; f.v.group = f.v.group || group; });
    facts.sort(function (a, b2) { return b2.w - a.w; });
    var bigF = facts[0] || { kind: "quiet", v: { town: town, group: group } };
    var big = fill(spick(r, (P.big || {})[bigF.kind] || P.big.quiet), bigF.v).toUpperCase();
    var small = [];
    facts.slice(1).forEach(function (f) { if (small.length < 3) small.push(fill(spick(r, (P.small || {})[f.kind] || []), f.v)); });
    if (small.length < 3 && ms.length) small.push(fill(spick(r, P.small.names), { names: ms.map(function (x) { return x.name; }).slice(0, 6).join(", ") }));
    var fl = (P.small.filler || []).slice();
    while (small.length < 3 && fl.length) small.push(fl.splice(Math.floor(r() * fl.length), 1)[0]);
    return {
      masthead: (town + " " + (P.mastheadTail || "KVÄLLSPOST")).toUpperCase(),
      date: fmtDate(new Date(Date.parse(d.night) + 5 * 3600000).toISOString()),
      price: P.price || "", slogan: spick(r, P.slogans || [""]), big: big, kicker: T("pExtra"),
      small: small.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }),
      footer: spick(r, P.footer || [""]), group: group
    };
  }
  function wrapLines(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function fitText(ctx, text, font, maxW, maxH, start, minSize, lh) {
    for (var s = start; s >= minSize; s -= 4) {
      ctx.font = font.replace("{s}", s);
      var lines = wrapLines(ctx, text, maxW);
      var tooWide = lines.some(function (l) { return ctx.measureText(l).width > maxW; });
      if (!tooWide && lines.length * s * lh <= maxH) return { size: s, lines: lines };
    }
    ctx.font = font.replace("{s}", minSize);
    return { size: minSize, lines: wrapLines(ctx, text, maxW) };
  }
  function drawPaper(m) {
    var W = 1080, H = 1350;
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    var DISP = '"Black Ops One", Impact, "Arial Black", sans-serif', BODY = '"Chakra Petch", "Arial Narrow", Arial, sans-serif';
    var ready = (document.fonts && document.fonts.load) ? Promise.all([
      document.fonts.load('100px "Black Ops One"'), document.fonts.load('700 40px "Chakra Petch"')
    ]).catch(function () {}) : Promise.resolve();
    return Promise.race([ready, new Promise(function (res) { setTimeout(res, 1500); })]).then(function () {
      // Paper
      ctx.fillStyle = "#ffd60a"; ctx.fillRect(0, 0, W, H);
      // Masthead
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, 210);
      ctx.fillStyle = "#e10600"; ctx.fillRect(0, 210, W, 14);
      var mh = fitText(ctx, m.masthead, DISP.replace(/^/, "{s}px "), W - 80, 150, 120, 48, 1);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
      ctx.font = mh.size + "px " + DISP;
      ctx.fillText(mh.lines.join(" "), W / 2, 40 + mh.size * 0.95, W - 60);
      ctx.font = "600 30px " + BODY; ctx.fillStyle = "#ffd60a";
      ctx.fillText(m.slogan, W / 2, 196, W - 80);
      // Date bar
      ctx.fillStyle = "#111"; ctx.textAlign = "left"; ctx.font = "700 32px " + BODY;
      ctx.fillText(m.date.charAt(0).toUpperCase() + m.date.slice(1), 44, 284, 700);
      ctx.textAlign = "right"; ctx.fillText(m.price, W - 44, 284, 320);
      ctx.fillRect(44, 304, W - 88, 5);
      // Kicker
      ctx.save(); ctx.translate(44, 336); ctx.rotate(-0.04);
      ctx.fillStyle = "#e10600"; ctx.fillRect(0, 0, 300, 82);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "62px " + DISP; ctx.fillText(m.kicker, 150, 64, 280);
      ctx.restore();
      // Big headline
      var bh = fitText(ctx, m.big, "{s}px " + DISP, W - 100, 520, 150, 56, 1.02);
      ctx.fillStyle = "#111"; ctx.textAlign = "left"; ctx.font = bh.size + "px " + DISP;
      var y = 450 + bh.size * 0.9;
      bh.lines.forEach(function (l) { ctx.fillText(l, 50, y, W - 100); y += bh.size * 1.02; });
      // Small headlines
      y = Math.min(Math.max(y - bh.size * 0.6, 940), 1000);
      ctx.fillStyle = "#111"; ctx.fillRect(44, y, W - 88, 4);
      var bx = y + 66;
      m.small.slice(0, 3).forEach(function (s, i) {
        var f = fitText(ctx, s, "700 {s}px " + BODY, W - 170, 96, 46, 28, 1.1);
        ctx.font = "700 " + f.size + "px " + BODY;
        ctx.fillStyle = i === 0 ? "#e10600" : "#111";
        ctx.fillRect(50, bx - f.size * 0.62, 26, 26);
        ctx.fillStyle = "#111";
        f.lines.slice(0, 2).forEach(function (l, k) { ctx.fillText(l, 96, bx + k * f.size * 1.1, W - 150); });
        bx += Math.min(2, f.lines.length) * f.size * 1.1 + 22;
      });
      // Footer
      ctx.fillStyle = "#111"; ctx.fillRect(0, H - 86, W, 86);
      ctx.fillStyle = "#ffd60a"; ctx.textAlign = "left"; ctx.font = "600 28px " + BODY;
      ctx.fillText(m.footer, 40, H - 34, W - 300);
      ctx.textAlign = "right"; ctx.font = "34px " + DISP; ctx.fillText("ÖL NU 🍺", W - 40, H - 32, 240);
      return cv;
    });
  }
  function paperBlob(cv) { return new Promise(function (res) { if (cv.toBlob) cv.toBlob(function (b) { res(b); }, "image/png"); else res(null); }); }
  function sharePaper(cv, m) {
    paperBlob(cv).then(function (b) {
      if (!b) { downloadPaper(cv); return; }
      var file = new File([b], "kvallsposten.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: m.masthead, text: m.big }).then(function () { A.toast(T("pShared")); }, function () {});
      } else downloadPaper(cv);
    });
  }
  function downloadPaper(cv) {
    paperBlob(cv).then(function (b) {
      var a = document.createElement("a");
      a.download = "kvallsposten.png";
      a.href = b ? URL.createObjectURL(b) : cv.toDataURL("image/png");
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); if (b) URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  /* ---------- Group list row ---------- */
  function groupItem(g, wrap) {
    if (!on() || !g || !g.id) return;
    var pg = groupOf(g.id), sum = [];
    if (pg) {
      if (pg.poll_open) sum.push("🗳️" + (pg.poll_voted ? "✓" : "!"));
      else if (pg.poll_winner) sum.push("🏆 " + pg.poll_winner);
      if (pg.mt_open) sum.push("🤔" + (pg.mt_voted ? "✓" : "!"));
      if (pg.brunch) sum.push("🥞 " + (pg.brunch.ja | 0));
      if ((pg.quotes_yday | 0) > 0) sum.push("📖 " + pg.quotes_yday);
      else if ((pg.quotes_pending | 0) > 0) sum.push("🔒 " + pg.quotes_pending);
      if ((pg.debt_net | 0) !== 0) sum.push("💸 " + (pg.debt_net > 0 ? "+" : "") + pg.debt_net + " kr");
      if (pg.paper) sum.push("📰");
    }
    var b = el("button", { type: "button", class: "btn btn-small btn-block gg-gbtn" }, [
      el("span", { class: "gg-gl", text: T("btn") }),
      sum.length ? el("span", { class: "gg-gs", text: sum.join(" · ") }) : null
    ]);
    b.addEventListener("click", function () {
      var tab = pg && pg.poll_open && !pg.poll_voted ? "vart" : pg && pg.mt_open && !pg.mt_voted ? "mt" : pg && pg.brunch && !pg.brunch.mine ? "brunch" : null;
      openGang(g, tab);
    });
    wrap.appendChild(el("div", { class: "gg-gi" }, [b]));
  }

  /* ---------- Top sheet + food popup ---------- */
  function topSheet(body) {
    if (!on() || off.kebab_top) return;
    var sec = el("section", { class: "gg gg-topsec" });
    kebabTopBox(sec);
    sec.appendChild(bt("🌯 " + T("kRate"), "btn-small btn-block", function () { openKebabSheet(); }));
    body.appendChild(sec);
  }
  function openKebabSheet() {
    view = null;
    A.openSheet(T("kHead"), function (body) {
      var root = el("div", { class: "gg" }), pane = el("div", { class: "gg-pane" });
      root.appendChild(pane); body.appendChild(root);
      renderKebab(pane);
    });
  }
  function isFood(bar) { return !!(bar && bar.place && (bar.type === "fast_food" || bar.type === "restaurant")); }
  function barPopupHTML(bar) {
    if (!on() || off.rate_kebab || !isFood(bar)) return "";
    return '<div class="gg-pop"><button type="button" class="btn btn-small btn-block" data-gang-kebab="' + esc(String(bar.id)) + '">' + esc(T("kPopBtn")) + "</button></div>";
  }

  /* ---------- Public hooks ---------- */
  window.GANG = {
    state: function () { return state; },
    data: function () { return poll; },
    openGang: openGang, chatPick: chatPick, openKebab: openKebabSheet,
    _paperModel: paperModel, _drawPaper: drawPaper, _settlePlan: settlePlan,
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
      // Food popup button (capture: Leaflet stops click propagation inside popups).
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest("[data-gang-kebab]");
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        var bar = window.BARS && window.BARS.byId(b.getAttribute("data-gang-kebab"));
        if (!bar) return;
        try { A.map.closePopup(); } catch (x) {}
        var p = myPos();
        rateSheet({ id: bar.id, name: bar.name, lat: bar.lat, lng: bar.lng, type: bar.type, d: dist(p, bar) });
      }, true);
      var close = document.getElementById("sheet-close"), bd = document.getElementById("backdrop");
      [close, bd].forEach(function (x) { if (x) x.addEventListener("click", function () { stopTimer(); view = null; }); });
    },
    onAuthed: function () { load(true); },
    onPoll: function () { load(false); },
    hudChipsHTML: function () {
      var c = chipTarget(); if (!c) return "";
      return '<button type="button" class="hx-chip gg-chip t-' + c.tab + '" data-hx="gang" aria-label="' + esc(T("chipAria")[c.tab === "tidning" ? "paper" : c.tab]) + '">' +
        esc(T("chip")[c.tab === "tidning" ? "paper" : c.tab]) + "</button>";
    },
    hudClick: function (action) { if (action !== "gang") return; var c = chipTarget(); if (c) openGang(c.g, c.tab); },
    groupItem: function (g, wrap) { groupItem(g, wrap); },
    topSheet: topSheet,
    barPopupHTML: barPopupHTML
  };
})();
