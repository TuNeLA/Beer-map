/* Öl Nu v26 MERITER. window.MERITER, called through mods() in app.js.
   Ranks are earned by meriter (points from many actions), not by total beers. Server: migration 0036
   (meriter_log ledger filled by triggers, my_meriter, my_stats/poll_v2 meriter fields, group_status_v3,
   meriter_board). This module:
   1 polls my_meriter(after_id) and shows "+N meriter" toasts (batched, funny reason lines, own queue on top
     of the app toast queue; the first open after install shows nothing old),
   2 hands the new total to SOCIAL (rank chip, BEFORDRAN popup, quiet "new ranks" toast),
   3 adds a meriter chip with a progress bar to the Ikväll panel,
   4 "Hur får jag meriter?" explainer sheet (from the rank chip / uniform and from 🏆),
   5 🎖️ Meriter board in 🏆: group or town, tonight / week / all time.
   A missing RPC (old database, PGRST202) = the feature hides quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var off = false;              // my_meriter missing → no toasts, no chip
  var boardOff = false;         // meriter_board missing → no 🏆 section
  var state = null;             // last my_meriter answer
  var LAST_KEY = "olnu.merLast", SEEN_KEY = "olnu.merSeen";
  var busy = false, lastAt = 0, soonTimer = null;
  var POLL_MS = 20000;

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- The meriter table (same numbers as migration 0036 and CONTRACT.md v26) ---------- */
  var ACTS = [
    // [kind, emoji, points, sv name, en name, sv cap, en cap]
    ["squad", "🪖", 10, "Natt med truppen", "Night with the squad", "1 gång per natt. En kompis ur gruppen inom 150 m (pin eller incheckning).", "Once a night. A group-mate within 150 m (pin or check-in)."],
    ["duel_win", "⚔️", 15, "Vinna en gruppduell", "Win a group duel", "Varje medlem som drack i duellen.", "Every member who drank in the duel."],
    ["duel", "🛡️", 5, "Vara med i en duell", "Take part in a duel", "Per duell.", "Per duel."],
    ["rally_yes", "✅", 5, "Svara ✅ Kommer på en inkallelse", "Answer ✅ Coming to a call-out", "Max 3 per natt.", "Max 3 a night."],
    ["invite_show", "📨", 3, "Säga ✅ Kommer på en inbjudan och dyka upp (±2 h)", "Say ✅ Coming to an invite and show up (±2 h)", "Max 2 per natt.", "Max 2 a night."],
    ["arrive", "🏃", 5, "Komma fram dit (ETA eller incheckning inom 2 h)", "Actually arrive (ETA or check-in within 2 h)", "Max 3 per natt.", "Max 3 a night."],
    ["callout", "📯", 5, "Kom hit! eller en inkallelse med 2+ svar", "Come here! or a call-out with 2+ answers", "Max 2 per natt.", "Max 2 a night."],
    ["buddy", "🚑", 5, "Kolla läget med en kompis på 10+", "Check on a friend at 10+", "Max 2 per natt.", "Max 2 a night."],
    ["home", "🏠", 5, "Trycka ”Jag ä hemma”", "Tap \"I'm home\"", "1 gång per natt.", "Once a night."],
    ["status", "📸", 5, "Svara på lägesrapporten i tid", "Answer the status report in time", "Max 3 per natt.", "Max 3 a night."],
    ["checkin", "📍", 3, "Checka in på en krog", "Check in at a bar", "1 per krog, max 6 per natt.", "1 per bar, max 6 a night."],
    ["game", "🎲", 3, "Vinna i Lek (uppdrag, bingo, orakel)", "Win in Games (mission, bingo, oracle)", "Max 3 per natt.", "Max 3 a night."],
    ["party_win", "👑", 3, "Vinna ett partyspel", "Win a party game", "Max 3 per natt.", "Max 3 a night."],
    ["party", "🎲", 2, "Spela ett partyspel (3+ spelare)", "Play a party game (3+ players)", "Max 3 spel per natt.", "Max 3 games a night."],
    ["photo", "📷", 2, "Bild i gruppchatten", "Photo in the group chat", "Max 5 per natt.", "Max 5 a night."],
    ["skal_give", "🍻", 1, "Ge en skål", "Give a skål", "Max 10 per natt.", "Max 10 a night."],
    ["skal_get", "🥂", 1, "Få en skål", "Get a skål", "Max 10 per natt.", "Max 10 a night."],
    ["drink", "🍺", 5, "En dryck", "A drink", "Inget tak. Varje öl ger 5.", "No cap. Every drink gives 5."]
  ];
  var ACT = {};
  ACTS.forEach(function (a) { ACT[a[0]] = a; });

  /* ---------- Reason lines (dalmål + military; "ä" for dialect "é"). Keep list ORDER, add at the end. ---------- */
  var LINES = {
    squad: [
      "🪖 Truppen ä samlad. Generalstaben gråter av lycka.",
      "🪖 Natt med truppen! Ingen soldat dricker ensam i kväll.",
      "🫡 Pluton på plats. Det här ä vad armén ä till för.",
      "🪖 Ni ä inom skotthåll från varandra. Sammanhållning, dä!",
      "🎖️ Kamratskap i fält. Det ger mer än tio öl.",
      "🪖 Kompaniet håller ihop. Fältprästen nickar gillande.",
      "🫂 Ingen lämnas kvar. Inte i kväll heller.",
      "🪖 Truppen ä på samma krog. Fienden darrar.",
      "📻 Radion sprakar: ”Alla enheter på plats.” Snyggt.",
      "🪖 Natt med truppen. Det här ska stå i memoarerna.",
      "🎺 Signal: samling! Och ni samlades. Bra jobbat.",
      "🪖 Två soldater, en front. Mer behövs int'."
    ],
    checkin: [
      "📍 Incheckad. Kartan tackar för underrättelserna.",
      "📍 Ny position rapporterad. Spaningen fortsätter.",
      "📍 Krogen erövrad. Flaggan ä uppe.",
      "📍 Fotfäste säkrat. Nu ä du på plats, dä.",
      "📍 Högkvarteret vet var du ä. Bra soldat.",
      "📍 Incheckning godkänd av staben.",
      "📍 Brohuvud etablerat vid baren.",
      "📍 Positionen ä inrapporterad. Kaffet ä varmt i tältet.",
      "📍 Landstigning lyckad. Nu kan du slappna av.",
      "📍 Ny krog på kartan. Kartläsaren i dig ler.",
      "📍 Rapport: soldaten ä framme och mår bra."
    ],
    skal_give: [
      "🍻 Skål given! Generositet ä en dygd i fält.",
      "🍻 Du skålade. Kamraten blev glad.",
      "🍻 En skål till en vän. Det kostar inget och ger allt.",
      "🍻 Skålkanonen avfyrad. Träff!",
      "🍻 Snällt gjort, soldat. Skål!",
      "🍻 Det skålas i skyttegraven. Fint.",
      "🍻 En skål i rätt tid ä värd en medalj. Nästan.",
      "🍻 Du spred lite värme. Truppen märker sånt.",
      "🍻 Skål! Moralen höjs med en hel procent.",
      "🍻 Ge en skål, få en merit. Så funkar armén."
    ],
    skal_get: [
      "🥂 Nån skålade för dig. Du ä omtyckt, dä!",
      "🥂 En skål kom in. Folket älskar dig.",
      "🥂 Skål mottagen. Bekräfta med en nick.",
      "🥂 Du fick en skål. Truppen ser dig.",
      "🥂 Folkkär soldat. En skål till dig!",
      "🥂 Inkommande skål! Ingen fara, bara kärlek.",
      "🥂 Nån tänkte på dig. Det ä fint.",
      "🥂 Skålmagneten drar igen.",
      "🥂 En skål i din ära. Ta emot den med värdighet.",
      "🥂 Du ä populär i kväll. Skål tillbaka?"
    ],
    rally_yes: [
      "✅ Du svarade på inkallelsen. En sann soldat.",
      "✅ ”Kommer!” Det ä vad kompisar säger.",
      "✅ Inryckning bekräftad. Marschera!",
      "✅ Truppen räknar med dig nu. Bra!",
      "✅ Du ställde upp. Det ger meriter, dä.",
      "✅ Förstärkning på väg. Det var du.",
      "✅ Ja på inkallelsen. Kaptenen ler.",
      "✅ Du sa ja. Inga ursäkter, bara stövlar.",
      "✅ Signalen hördes och du svarade. Bra soldat.",
      "✅ Kommer! Det enklaste ordet i armén."
    ],
    arrive: [
      "🏃 Framme! Du höll vad du lovade.",
      "🏃 Anlänt till fronten. Det kallas lojalitet.",
      "🏃 Du kom faktiskt dit. Respekt.",
      "🏃 Framme i tid. Generalen noterar.",
      "🏃 Löfte infriat. Truppen jublar.",
      "🏃 Du sa kommer och du kom. Ovanligt bra.",
      "🏃 Marschen klar. Nu ä du där du behövs.",
      "🏃 Framme vid samlingsplatsen. Bra jobbat.",
      "🏃 Ankomst bekräftad. Stolen ä din.",
      "🏃 Från ord till handling. Snyggt, soldat."
    ],
    callout: [
      "📯 Du blåste till samling och folk kom. Ledarskap!",
      "📯 Inkallelsen fick svar. Du ä en riktig befälhavare.",
      "📯 Truppen lyssnar på dig. Det ger meriter.",
      "📯 Du samlade gänget. Det ä int' alla som klarar det.",
      "📯 Kom hit! Och folk tänkte komma. Bra.",
      "📯 Befälet har talat. Soldaterna svarade.",
      "📯 Samlingssignal med eko. Snyggt.",
      "📯 Du drog ihop truppen. Generalen nickar.",
      "📯 En kallelse värd namnet.",
      "📯 Trumslagaren slår igen. Och folk dansar."
    ],
    buddy: [
      "🚑 Du kollade läget med en kompis. Det ä riktig kamratskap.",
      "🚑 Sjukvårdare i fält. Tack för att du bryr dig.",
      "💚 Du tog hand om en vän. Det ä värt mer än alla öl.",
      "🚑 Ingen lämnas kvar. Du såg till det.",
      "💚 Omtanke ä också en merit. Den största.",
      "🚑 Kompisvakt i tjänst. Bra jobbat.",
      "💚 Du ställde upp när det behövdes. Respekt.",
      "🚑 Fältskären kollar läget. Det var du.",
      "💚 Truppen ä tryggare med dig i den.",
      "🚑 Vatten, taxi, en arm om axeln. Du fixar."
    ],
    home: [
      "🏠 Hemma! Bästa uppdraget ä att komma hem.",
      "🏠 Soldaten ä hemma och säker. Bra.",
      "🏠 Hemkomst rapporterad. Truppen kan sova lugnt.",
      "🏠 Du kom hem. Det ä det viktigaste av allt.",
      "🏠 Basen nådd. Ta ett glas vatten innan du sover.",
      "🏠 Hemma igen. Uppdraget slutfört.",
      "🏠 Säkert hemma. Mamma skulle vara stolt.",
      "🏠 Tillbaka i förläggningen. Godnatt, soldat.",
      "🏠 Retirerat i god ordning. Det kräver klokskap.",
      "🏠 Hemma. Nu ä stövlarna av och vattnet framme."
    ],
    status: [
      "📸 Lägesrapport i tid! Staben ä nöjd.",
      "📸 Rapporten kom in. Underrättelsetjänsten tackar.",
      "📸 Bilden ä inne. Bra jobbat i fält.",
      "📸 Snabb rapport. Gruppchefen ler.",
      "📸 Spaningsfoto levererat i tid.",
      "📸 Rapport från fronten mottagen.",
      "📸 Du rapporterade läget. Så ska det gå till.",
      "📸 Fotot ä i arkivet. Historien tackar dig.",
      "📸 Inom tidsramen! Disciplin, dä.",
      "📸 Krigsfotografen har talat."
    ],
    photo: [
      "📷 Bild i chatten. Bevisen säkrade.",
      "📷 Krigsfotografen slår till igen.",
      "📷 En bild säger mer än tusen sms.",
      "📷 Dokumenterat för eftervärlden.",
      "📷 Truppen fick en bild. Fint.",
      "📷 Fototjänsten rapporterar.",
      "📷 Nu finns det bildbevis. Tänk på det.",
      "📷 Snyggt foto, soldat.",
      "📷 Arkivet växer. Historien skrivs.",
      "📷 Klick! Ännu en bild för memoarerna."
    ],
    duel_win: [
      "⚔️ Duellen vunnen! Fanan vajar över er grupp.",
      "⚔️ Seger! Fienden drar sig tillbaka.",
      "⚔️ Ni vann duellen. Hjältar, allihop.",
      "⚔️ Segerrapport till staben. Medaljregn!",
      "⚔️ Den andra gruppen buggar. Ni vann.",
      "⚔️ Triumf på slagfältet. Skål för det!",
      "⚔️ Duellen ä er. Glöm int' att vara snälla vinnare.",
      "⚔️ Seger! Det här kommer berättas länge.",
      "⚔️ Ni tog hem det. Generalen höjer sitt glas.",
      "⚔️ Vinnare! Truppanda slår allt."
    ],
    duel: [
      "🛡️ Du var med i duellen. Ingen soldat för mycket.",
      "🛡️ Duellen ä över. Tack för insatsen.",
      "🛡️ Du ställde upp för gruppen. Det räknas.",
      "🛡️ Deltagit i strid. Medaljen putsas.",
      "🛡️ Du höll linjen. Bra jobbat.",
      "🛡️ Kamp ä kamp. Du var där.",
      "🛡️ Duellveteran. Det låter bra, dä.",
      "🛡️ Du kämpade för fanan. Merit!",
      "🛡️ Med i matchen. Det ä det som gäller.",
      "🛡️ En till duell i loggboken."
    ],
    game: [
      "🎲 Lek vunnen! Hjärnan ä i form.",
      "🎲 Uppdraget slutfört. Agenten ä nöjd.",
      "🎲 Seger i leken. Inga fusk upptäckta.",
      "🎲 Spelgeneralen har talat.",
      "🎲 Bingo, uppdrag eller orakel – du fixade det.",
      "🎲 Strateg i fält. Bra spelat.",
      "🎲 Du vann. Lagom kaxigt nu, dä.",
      "🎲 Leken ger meriter. Vem visste?",
      "🎲 Taktiskt geni. Nästan.",
      "🎲 Spelet ä vunnet. Truppen applåderar."
    ],
    party: [
      "🎲 Partyspel avklarat. Truppen leker, truppen lever.",
      "🎲 Ett spel i rummet. Generalen gillar lagövningar.",
      "🎲 Lekstuga godkänd av högkvarteret.",
      "🕵️ Imposter eller int', du var med. Merit!",
      "🎩 Lapparna ä dragna. Meriten ä din.",
      "🔥 Östra lägret överlevde kvällen. Du med.",
      "🎲 Övning i samarbete och lögner. Godkänd.",
      "🐑 Flocken tackar för insatsen.",
      "🔮 Spelat och klart. Siarna ser fler meriter.",
      "🎲 Ett spel till i krigsdagboken."
    ],
    invite_show: [
      "📨 Du sa ja och du kom. Pålitlig soldat!",
      "📨 Inbjudan hedrad. Generalen noterar.",
      "📨 Ordet hållet – du dök upp. Merit!",
      "📨 Ja betyder ja. Du ä på plats.",
      "📨 Anmäld och närvarande. Så ska dä se ut.",
      "📨 Uppställd i tid. Truppen tackar.",
      "📨 Du kom som du lovade. Skål på dig!",
      "📨 Närvaro bekräftad. Dalregementet ä stolt.",
      "📨 Inbjudan + incheckning = merit. Matematik.",
      "📨 Där sa du ja, och där står du. Snyggt."
    ],
    party_win: [
      "👑 Seger i partyspelet! Medaljen ä på väg.",
      "👑 Vinnare! Truppen bugar.",
      "🕵️ Du lurade dom allihop. Snyggt, soldat.",
      "👑 Segern ä din. Bjud på en runda, kanske?",
      "🔥 Sista man i lägret. Legend.",
      "🎩 Hattens mästare! Ingen slår dig i kväll.",
      "👑 Vinst! Generalen skriver ditt namn i boken.",
      "🔮 Tankeläsare! Du såg det komma.",
      "🐑 Flockledare. Alla följde dig.",
      "👑 Triumf vid bordet. Dalarna minns."
    ],
    drink: [
      "🍺 En dryck. Det ger en merit – resten får du med truppen.",
      "🍺 +1. Vill du ha fler: checka in och samla gänget.",
      "🍺 Noterat. Öl ä bra, kamrater ä bättre.",
      "🍺 En merit för glaset. Tio för truppen.",
      "🍺 Bokfört. Drick vatten mellan varven, soldat.",
      "🍺 Liten merit. Stora meriter finns bland vännerna.",
      "🍺 Ölen räknas, lite grann.",
      "🍺 +1 i loggen. Skåla med nån för mer.",
      "🍺 Kvartermästaren noterar en dryck.",
      "🍺 Glaset ä bokfört. Ta det lugnt, dä."
    ]
  };
  function lineFor(kind) {
    var list = LINES[kind] || LINES.drink;
    var seen = {};
    try { seen = JSON.parse(lsGet(SEEN_KEY, "{}")) || {}; } catch (e) { seen = {}; }
    var last = Array.isArray(seen[kind]) ? seen[kind] : [];
    var pool = [];
    for (var i = 0; i < list.length; i++) if (last.indexOf(i) < 0) pool.push(i);
    var k = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * list.length);
    last.push(k); seen[kind] = last.slice(-6);
    lsSet(SEEN_KEY, JSON.stringify(seen));
    return list[k];
  }
  function ptsText(n) { return "+" + n + " " + (n === 1 ? L("merit", "merit") : L("meriter", "merits")); }

  /* ---------- Toasts: batch, then wait for a free slot in the app toast queue ---------- */
  var pending = [], flushTimer = null, waitStart = 0;
  function queue(events) {
    if (!events || !events.length) return;
    pending = pending.concat(events);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1400);
  }
  function busyToasts() {
    var box = document.getElementById("toasts"); if (!box) return false;
    return Array.prototype.some.call(box.children, function (x) { return !x.hasAttribute("data-keep"); });
  }
  function flush() {
    flushTimer = null;
    if (!pending.length || !A) return;
    if (!waitStart) waitStart = Date.now();
    if (busyToasts() && Date.now() - waitStart < 9000) { flushTimer = setTimeout(flush, 800); return; }
    waitStart = 0;
    var evs = pending; pending = [];
    var sum = 0, by = {};
    evs.forEach(function (e) { var p = Math.max(0, e.pts | 0); sum += p; by[e.kind] = (by[e.kind] || 0) + p; });
    if (!sum) return;
    var kinds = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    var main = kinds[0], msg = ptsText(sum) + " · " + lineFor(main);
    if (kinds.length > 1) {
      msg += " (" + kinds.slice(1, 4).map(function (k) { return ((ACT[k] && ACT[k][1]) || "⭐") + " +" + by[k]; }).join(" ") + ")";
    }
    A.toast(msg, { cls: "mer-toast" + (sum >= 10 ? " mer-big" : ""), ms: sum >= 5 ? 5200 : 3600 });
    try { if (sum >= 5 && window.FX && window.FX.vibrate) window.FX.vibrate([30, 30, 30]); } catch (e) {}
  }

  /* ---------- Server ---------- */
  function load(force) {
    if (!A || !A.LIVE || off || busy || !A.authed || !A.authed()) return Promise.resolve();
    if (!force && Date.now() - lastAt < POLL_MS) return Promise.resolve();
    busy = true; lastAt = Date.now();
    var after = +lsGet(LAST_KEY, "0") || 0;
    return A.rpc("my_meriter", { p_after_id: after }).then(function (r) {
      busy = false;
      if (r.error) { if (U.missing(r.error)) { off = true; A.updateCounts(); } return; }
      var d = A.parseData(r.data);
      if (!d || d.meriter == null) return;
      var last = +d.last_id || 0;
      if (after > 0 && last >= after && Array.isArray(d.events)) queue(d.events);
      // A smaller last id = another account on this phone: start again without toasts.
      lsSet(LAST_KEY, String(last));
      state = d;
      try { if (window.SOCIAL && window.SOCIAL.applyMeriter) window.SOCIAL.applyMeriter(d); } catch (e) {}
      A.updateCounts();
      repaintOpen();
    }, function () { busy = false; });
  }
  function soon(ms) {
    clearTimeout(soonTimer);
    soonTimer = setTimeout(function () { load(true); }, ms || 2500);
  }

  /* ---------- Rank numbers (state from my_meriter, else SOCIAL stats) ---------- */
  function cur() {
    var s = window.SOCIAL && window.SOCIAL.stats ? window.SOCIAL.stats() : null;
    var m = state ? state.meriter : s && s.meriter != null ? s.meriter : null;
    if (m == null) return null;
    var tf = window.SOCIAL && window.SOCIAL.titleFor ? window.SOCIAL.titleFor(m) : { title: "", next: null, nextAt: null };
    var T = (window.SOCIAL && window.SOCIAL.TITLES) || [[0, ""]], at = 0, idx = 0;
    T.forEach(function (x, i) { if (m >= x[0]) { at = x[0]; idx = i + 1; } });
    return { m: m, title: tf.title, next: tf.next, nextAt: tf.nextAt, at: at, idx: idx, n: T.length,
      tonight: state ? state.tonight | 0 : s ? s.tonight | 0 : 0, week: state ? state.week | 0 : 0 };
  }
  function pct(c) { return c.nextAt ? Math.max(0, Math.min(100, Math.round(100 * (c.m - c.at) / Math.max(1, c.nextAt - c.at)))) : 100; }
  function barHTML(c, cls) { return '<span class="mer-bar ' + (cls || "") + '" aria-hidden="true"><span style="width:' + pct(c) + '%"></span></span>'; }
  function nextText(c) {
    return c.next && c.nextAt ? L((c.nextAt - c.m) + " meriter kvar till " + c.next, (c.nextAt - c.m) + " merits left to " + c.next)
      : L("Högsta grad. Ölguden själv.", "Highest rank.");
  }

  /* ---------- "Hur får jag meriter?" ---------- */
  function explain() {
    if (!A) return;
    var el = A.el;
    A.openSheet(L("🎖️ Hur får jag meriter?", "🎖️ How do I earn merits?"), function (body) {
      var c = cur();
      var box = el("div", { class: "mer-ex" });
      var h = "";
      if (c) {
        h += '<div class="mer-me"><div class="mer-rank">' + esc(c.title) + '</div><div class="mer-sub">' +
          esc(L("Grad ", "Rank ") + c.idx + "/" + c.n + " · " + c.m + L(" meriter", " merits") + (c.tonight ? L(" · +" + c.tonight + " ikväll", " · +" + c.tonight + " tonight") : "")) +
          "</div>" + barHTML(c, "mer-bar-big") + '<div class="mer-next">' + esc(nextText(c)) + "</div></div>";
      }
      h += '<p class="mer-lead">' + esc(L("Graderna tjänas in med meriter. Mest får du när truppen ä ute tillsammans – en öl ger bara 1.",
        "Ranks are earned with merits. You get the most when the squad is out together – a beer gives only 1.")) + "</p>";
      h += '<ul class="mer-list">' + ACTS.map(function (a) {
        return '<li class="mer-row"><span class="mer-e" aria-hidden="true">' + a[1] + '</span><span class="mer-main"><span class="mer-name">' +
          esc(sv() ? a[3] : a[4]) + '</span><span class="mer-cap">' + esc(sv() ? a[5] : a[6]) + '</span></span><span class="mer-pts">+' + a[2] + "</span></li>";
      }).join("") + "</ul>";
      h += '<p class="muted mer-care">' + esc(L("Natten räknas 05–05. Drick lagom, ta vatten och kom hem säkert – det ger också meriter.",
        "The night runs 05–05. Drink sensibly, have water and get home safe – that earns merits too.")) + "</p>";
      box.innerHTML = h;
      body.appendChild(box);
    });
  }

  /* ---------- 🏆 Meriter board ---------- */
  var bScope = lsGet("olnu.merScope", "group") === "town" ? "town" : "group";
  var bPeriod = (function () { var p = lsGet("olnu.merPeriod", "week"); return p === "tonight" || p === "all" ? p : "week"; })();
  var bGroup = lsGet("olnu.merGroup", "");
  var groupsCache = null, bCache = {};
  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && me.lat != null && isFinite(me.lat) && isFinite(me.lng)) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    return p || { lat: 60.1496, lng: 15.1878 };
  }
  function townOf(p) { try { var c = window.CITIES && window.CITIES.nearest(p.lat, p.lng); return c ? c.name : ""; } catch (e) { return ""; } }
  function loadGroups() {
    if (groupsCache) return Promise.resolve(groupsCache);
    return A.rpc("my_groups").then(function (r) {
      groupsCache = r.error ? [] : (r.data || []).filter(function (g) { return g && g.id; });
      setTimeout(function () { groupsCache = null; }, 120000);
      return groupsCache;
    });
  }
  function boardSection() {
    var el = A.el;
    var sec = el("section", { class: "mer-board" });
    var head = el("h3", { text: L("🎖️ Meriter", "🎖️ Merits") });
    var how = A.btn(L("❓ Hur får jag meriter?", "❓ How do I earn merits?"), "btn-small mer-how", explain);
    var scopes = el("div", { class: "tabs mer-tabs", role: "tablist" });
    var periods = el("div", { class: "tabs mer-tabs", role: "tablist" });
    var gsel = el("div", { class: "tabs mer-groups", role: "tablist" });
    var list = el("ol", { class: "toplist mer-blist" });
    var seq = 0;
    var note = el("p", { class: "muted mer-note" });
    sec.appendChild(head); sec.appendChild(scopes); sec.appendChild(gsel); sec.appendChild(periods); sec.appendChild(list); sec.appendChild(note);
    sec.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [how]));
    function tabs(box, items, curv, fn) {
      box.innerHTML = "";
      items.forEach(function (it) {
        box.appendChild(el("button", { type: "button", role: "tab", "aria-selected": String(it[0] === curv), class: it[0] === curv ? "on" : "",
          text: it[1], onclick: function () { fn(it[0]); } }));
      });
    }
    function draw() {
      if (!document.body.contains(sec) && sec.parentNode) return;
      tabs(scopes, [["group", L("👥 Gruppen", "👥 Group")], ["town", "🏙️ " + (townOf(where()) || L("Stan", "Town"))]], bScope, function (v) {
        bScope = v; lsSet("olnu.merScope", v); draw();
      });
      tabs(periods, [["tonight", L("Ikväll", "Tonight")], ["week", L("Veckan", "Week")], ["all", L("Totalt", "All time")]], bPeriod, function (v) {
        bPeriod = v; lsSet("olnu.merPeriod", v); draw();
      });
      list.innerHTML = ""; gsel.innerHTML = ""; gsel.hidden = true; note.textContent = "";
      var my = ++seq;
      list.appendChild(el("li", { class: "muted", text: "…" }));
      var go = function (params, key) {
        var hit = bCache[key];
        var p = hit && Date.now() - hit.at < 45000 ? Promise.resolve(hit.r) : A.rpc("meriter_board", params).then(function (r) {
          if (!r.error) bCache[key] = { at: Date.now(), r: r };
          return r;
        });
        p.then(function (r) {
          if (my !== seq) return;
          list.innerHTML = "";
          if (r.error) {
            if (U.missing(r.error)) { boardOff = true; sec.remove(); return; }
            var code = U.errCode(r.error);
            list.appendChild(el("li", { class: "muted", text: code === "slow_down" ? L("Lugn i stormen – vänta en minut.", "Easy – wait a minute.") : L("Kunde inte hämta listan.", "Could not load the list.") }));
            return;
          }
          var rows = r.data || [];
          if (!rows.length || rows.every(function (x) { return !(x.meriter > 0); })) {
            list.appendChild(el("li", { class: "muted top-empty", text: L("Inga meriter här än. Samla truppen!", "No merits here yet. Gather the squad!") }));
          }
          rows.forEach(function (x) {
            if (!(x.meriter > 0) && !x.is_me) return;
            var nm = x.name || (x.is_me ? L("Du (hemlig)", "You (hidden)") : L("Hemlig agent", "Secret agent"));
            if (x.is_me && x.name) nm += L(" (du)", " (you)");
            var ht = "";
            try { if (x.home_town && window.HOMETOWN && window.HOMETOWN.label) ht = window.HOMETOWN.label(x.home_town); } catch (e) {}
            list.appendChild(el("li", {}, [el("div", { class: "top-row" + (x.is_me ? " mine" : "") }, [
              el("span", { class: "top-rank", text: String(x.rank | 0).padStart(2, "0") }),
              el("span", { class: "top-main" }, [el("span", { class: "top-name", text: nm + (ht ? " · " + ht : "") }),
                el("span", { class: "top-sub", text: "🎖️ " + (x.title || "") })]),
              el("span", { class: "top-n", text: (x.meriter | 0) + L(" m", " m") })
            ])]));
          });
          if (bScope === "town") note.textContent = L("Namn syns bara för den som slagit på ”Visa mig på topplistan”.", "Names show only for people who turned on \"Show me on the top list\".");
        });
      };
      if (bScope === "group") {
        loadGroups().then(function (gs) {
          if (!gs.length) { list.innerHTML = ""; list.appendChild(el("li", { class: "muted", text: L("Gå med i en grupp för att se gruppens meriter.", "Join a group to see its merits.") })); return; }
          var g = gs.filter(function (x) { return x.id === bGroup; })[0] || gs[0];
          bGroup = g.id;
          if (my !== seq) return;
          if (gs.length > 1) gsel.hidden = false;
          if (gs.length > 1) tabs(gsel, gs.slice(0, 8).map(function (x) { return [x.id, x.name || "?"]; }), g.id, function (v) {
            bGroup = v; lsSet("olnu.merGroup", v); draw();
          });
          go({ p_scope: "group", p_group_id: g.id, p_period: bPeriod }, "g|" + g.id + "|" + bPeriod);
        });
      } else {
        var p = where();
        go({ p_scope: "town", p_lat: p.lat, p_lng: p.lng, p_period: bPeriod }, "t|" + p.lat.toFixed(2) + "|" + p.lng.toFixed(2) + "|" + bPeriod);
      }
    }
    draw();
    return sec;
  }

  /* ---------- Repaint an open explainer / uniform after new numbers ---------- */
  function repaintOpen() {
    var me = document.querySelector(".mer-ex .mer-me");
    if (!me) return;
    var c = cur(); if (!c) return;
    me.innerHTML = '<div class="mer-rank">' + esc(c.title) + '</div><div class="mer-sub">' +
      esc(L("Grad ", "Rank ") + c.idx + "/" + c.n + " · " + c.m + L(" meriter", " merits") + (c.tonight ? L(" · +" + c.tonight + " ikväll", " · +" + c.tonight + " tonight") : "")) +
      "</div>" + barHTML(c, "mer-bar-big") + '<div class="mer-next">' + esc(nextText(c)) + "</div>";
  }

  /* ---------- Public ---------- */
  window.MERITER = {
    ACTS: ACTS, LINES: LINES, explain: explain, barHTML: barHTML, cur: cur, nextText: nextText,
    on: function () { return !off; },
    state: function () { return state; },
    init: function (api) {
      A = api;
      // Taps that may earn meriter: check a little later (the server trigger has run by then).
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest(".skal-btn, [data-ans], .rl-ans, .rally-ans, .ci-btn, [data-ci], .af-check, .chat-send, .ph-send, .mx-btns button, [data-hx='home']");
        if (b) soon(3000);
      }, true);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) load(false); });
    },
    onAuthed: function () { load(true); },
    onPoll: function () { load(false); },
    onBeerAccepted: function () { soon(2500); },
    onStopped: function () { soon(2500); },
    onChat: function () { soon(2500); },
    hudChipsHTML: function () {
      if (off || !A || !A.LIVE) return "";
      // The rank chip (social.js) shows the total + progress bar; this one shows tonight and opens the explainer.
      var c = cur(); if (!c) return "";
      return '<button type="button" class="hx-chip hx-mer" data-hx="meriter" aria-label="' +
        esc(L("Meriter ikväll: " + c.tonight + ". Hur får jag meriter?", "Merits tonight: " + c.tonight + ". How do I earn merits?")) + '">⭐ ' +
        esc("+" + c.tonight + L(" meriter ikväll", " merits tonight")) + '<span class="mer-q" aria-hidden="true">?</span></button>';
    },
    hudClick: function (action) { if (action === "meriter") explain(); },
    topSheet: function (body) {
      if (!A || !A.LIVE || boardOff || !A.authed || !A.authed()) return;
      // Near the top: before the town boards (boards.js .bd-box) when they are there.
      var sec = boardSection(), ref = body.querySelector(".bd-box");
      if (ref && ref.parentNode === body) body.insertBefore(sec, ref); else body.appendChild(sec);
    }
  };
})();
