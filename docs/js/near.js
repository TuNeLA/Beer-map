/* Öl Nu v26 — VÄNNER + TRUPPEN SAMLAD + HITTA KOMPISEN (CONTRACT "v26", migrations 0045_friends, 0046_squad, 0047_find).
   1. 👥 Vänner: one-to-one friends outside groups. Add with a friend code / QR (?friend=CODE) or tap a member in a
      shared group → "➕ Lägg till vän". The other person accepts. List: name, demonym (0033), out tonight + town.
      Remove = friend_remove (status UPDATE on the server, rows are never removed).
   2. 🪖 Truppen samlad: the server (near_poll → squad_poll) sees 3+ members of a group within 50 m (check-ins and
      precise pins, as stored). Every member's phone celebrates once per gathering: vibration, a short confetti fall
      (no flashing, nothing ≥ 2 Hz, none with reduced motion), clink, toast "🪖 TRUPPEN SAMLAD vid Pitchers – 4 man!".
      Max once per 90 min per group per place (server). Group page: "Nätter tillsammans". Ticker lines (NEWS hooks).
   3. 🧭 Hitta kompisen: compass arrow to a friend / group member. Both opt in: a request + Accept, or the
      target's switch "Låt gruppen/vännerna hitta mig" (until 05:00). Exact positions only while the finder sheet is
      open (ping every 6 s), they expire after 2 min on the server, find_stop() clears them on close. No history.
      iOS: DeviceOrientationEvent.requestPermission() on a tap. No compass → north-up mini map (Leaflet).
   Entry points (owner: no clutter): ⚙️ "👥 Vänner & 🧭 Hitta" (settingsSheet), group page tile (groupItem), member
   tap in Medlemmar (memberPanel, from social.js), ONE urgent HUD chip only for a live find request.
   Effects wait for the beer-type strip (OLNU_STRIP.after) and never cover it.
   Hooks (app.js mods): init, onAuthed, onPoll, applyText, settingsSheet, groupItem, hudChipsHTML, hudClick,
   openNearLink(find, friend). Public: NEAR.memberPanel(g, m, panel, openUniform), NEAR.openFriends(),
   NEAR.openFinder(key, name), NEAR.newsTemplates/newsCands. A missing RPC (old server) → that part hides. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = {}, P = null, pollAt = 0, pollBusy = false, firstPoll = true;
  var SEEN_SQ = "olnu.squadSeen", SEEN_FR = "olnu.friendSeen", SEEN_FIND = "olnu.findSeen", LAST_SQ = "olnu.squadLast";
  var POLL_MS = 60000, POLL_FAST_MS = 10000, PING_MS = 6000;   // review2: idle 60 s (was 30 s)
  var CODES = ["friend_not_found", "own_code", "not_member", "invalid_member", "slow_down", "friend_limit", "friend_req_not_found",
    "invalid_target", "no_find", "find_req_not_found", "outside_sweden", "code_generation_failed", "not_authenticated"];
  var squadCache = {};   // group id -> {at, d}

  /* ---------- Texts (dalmål "ä" for é, military) ---------- */
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    if (!a || !a.length) return "";
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  var T = {
    squadFlavor: ["Hela plutonen på samma plätt. Generalen gråter av lycka.", "Uppställning klar! Nu ä dä fest i skyttegraven.",
      "Truppen ä samlad. Radion kan vila.", "Alla i samma bunker. Så ska dä se ut, gubbar.", "Mönstringen godkänd. Skål på er!",
      "Formeringen sitter. Dalregementet nickar.", "Ingen saknas i strid ikväll – i alla fall int' just nu.",
      "Sammanstrålning bekräftad. Högkvarteret ä nöjt.", "Gänget ä på plats. Nu börjar operationen på riktigt.",
      "Plutonen ä hel. Nån bjuder väl på nästa?", "Samling vid lägerelden! Fast med öl.", "Rapport: truppen ä fulltalig. Över.",
      "Kamrater i vapen – och i kön till baren.", "Spaningen klar: alla här. Bra jobbat, korpraler."],
    squadFlavorEn: ["The whole platoon in one spot. Cheers!", "Formation complete. The party is on.", "Squad assembled. Over."],
    friendAdded: ["🤝 Vänförfrågan skickad till {namn}. Nu väntar vi på svar från fronten.", "🤝 Förfrågan ä ute hos {namn}. Håll ställningarna.",
      "🤝 Brevduvan flög iväg till {namn}.", "🤝 {namn} har fått din förfrågan. Spänningen ä olidlig."],
    friendNow: ["🤝 Nu ä ni vänner, du och {namn}! Kamrater för livet.", "🤝 {namn} ä din vän nu. Skål på den alliansen!",
      "🤝 Alliansen med {namn} ä spikad.", "🤝 Vänskapsfördrag undertecknat med {namn}."],
    friendGone: ["Vänskapen ä avslutad. Inga sura miner.", "Borttagen. Fronten flyttas, livet går vidare.", "Klart. {namn} ä int' längre i din vänlista."],
    friendIn: ["🤝 {namn} vill bli din vän!", "🤝 {namn} skickar en vänförfrågan. Ta emot?", "🤝 Ny kamrat på ingång: {namn}."],
    findIn: ["🧭 {namn} vill hitta dig i vimlet!", "🧭 {namn} letar efter dig. Får hen se var du ä?", "🧭 Spaning: {namn} söker din position."],
    findAuto: ["🧭 {namn} letar efter dig just nu. Öppna kompassen så hittar ni varann.", "🧭 {namn} ä på väg mot dig med kompassen fram."],
    warmer: ["🔥 Varmare!", "🔥 Varmare, varmare!", "🔥 Nu bränns dä!", "🔥 Rätt håll, soldat!", "🔥 Varmt! Fortsätt."],
    colder: ["🧊 Kallare…", "🧊 Kallare. Vänd om, korpral!", "🧊 Fel håll, dä blir kallt!", "🧊 Iskallt. Prova åt andra hållet."],
    same: ["🙂 Ungefär lika", "🙂 Stå still eller gå, välj nu", "🙂 Varken varmt eller kallt"],
    here: ["👀 Du ä framme! Titta upp.", "👀 Här nånstans! Ropa namnet.", "👀 Inom spottavstånd. Vinka!"],
    waitAns: ["⏳ Väntar på att {namn} svarar…", "⏳ Förfrågan skickad. {namn} funderar…"],
    waitPos: ["📡 {namn} har int' öppnat sin kompass än. Vi har knackat på.", "📡 Ingen signal från {namn} än. Hen måste öppna appen."]
  };

  /* ---------- Server ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; }
      return r;
    });
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function errText(c) {
    var sv1 = {
      friend_not_found: "Den koden finns int'. Kolla stavningen.", own_code: "Dä ä din egen kod, kamrat.",
      not_member: "Du ä int' med i den gruppen.", invalid_member: "Hittar int' den personen i gruppen.",
      slow_down: "Lugn i stormen. Vänta en stund.", friend_limit: "Max 300 vänner. Du ä populär!",
      friend_req_not_found: "Förfrågan finns int' längre.", invalid_target: "Den personen kan du int' leta efter.",
      no_find: "Ingen har sagt ja än.", find_req_not_found: "Förfrågan ä för gammal.", outside_sweden: "Konstig GPS-position.",
      error: "Dä gick int'. Försök igen."
    };
    var en = { friend_not_found: "No such code.", own_code: "That is your own code.", not_member: "Not a member.", slow_down: "Slow down.",
      friend_req_not_found: "Request is gone.", invalid_target: "You cannot look for that person.", find_req_not_found: "Request expired.",
      error: "That did not work." };
    return sv() ? sv1[c] || sv1.error : en[c] || en.error;
  }
  // notify-group events "friend" / "find" exist only from the merged function (scratchpad near-ef/index.ts).
  // An older function treats an unknown event as the after-beer call (milestone push before the undo window),
  // so this stays false until that function is deployed (patch 05-push-on.py flips it).
  var PUSH_EVENTS = true;
  function push(body) { try { if (PUSH_EVENTS && A.PUSH_ON && A.invoke) A.invoke("notify-group", body); } catch (e) {} }
  function name() { try { return A.getName() || null; } catch (e) { return null; } }
  function demonym(town) { try { return town && window.HOMETOWN && window.HOMETOWN.label ? window.HOMETOWN.label(town) : ""; } catch (e) { return ""; } }
  function seen(key) { return U.ls.getJSON(key, []) || []; }
  function markSeen(key, id) { var a = seen(key); id = String(id); if (a.indexOf(id) < 0) { a.push(id); U.ls.setJSON(key, a.slice(-60)); } }
  function isSeen(key, id) { return seen(key).indexOf(String(id)) >= 0; }
  function minsAgo(iso) { var t = Date.parse(iso); return isFinite(t) ? (Date.now() - t) / 60000 : 1e9; }

  /* ---------- Poll ---------- */
  function pollMs() {
    if (!P) return POLL_MS;
    var live = (P.find_in || []).concat(P.find_out || []).some(function (r) { return r.status === "pending" || ((r.status === "accepted" || r.status === "auto") && r.finding); });
    return live ? POLL_FAST_MS : POLL_MS;
  }
  function poll(force) {
    if (!A || !A.LIVE || !A.authed() || off.near_poll || pollBusy) return Promise.resolve();
    if (!force && Date.now() - pollAt < pollMs()) return Promise.resolve();
    if (document.hidden && !force) return Promise.resolve();
    pollBusy = true; pollAt = Date.now();
    return call("near_poll", { p_name: name() }).then(function (r) {
      pollBusy = false;
      if (r.error) return;
      var was = chipKey();
      P = A.parseData(r.data);
      handleSquads(P.squads || []);
      handleFriendsIn(P.friends_in || []);
      handleFindIn(P.find_in || []);
      firstPoll = false;
      if (chipKey() !== was) { try { A.updateCounts(); } catch (e) {} }
      if (finder) finder.poll();
    }, function () { pollBusy = false; });
  }
  setInterval(function () { poll(false); }, 5000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(true); });

  /* ---------- 2. TRUPPEN SAMLAD ---------- */
  function placePhrase(s) {
    if (!s || !s.place) return "";
    if (s.kind === "bar") return L("vid ", "at ") + s.place;
    return L("i ", "in ") + s.place;
  }
  function squadHead(s) {
    var p = placePhrase(s);
    return sv() ? "🪖 TRUPPEN SAMLAD" + (p ? " " + p : "") + " – " + (s.n | 0) + " man!"
                : "🪖 SQUAD ASSEMBLED" + (p ? " " + p : "") + " – " + (s.n | 0) + " strong!";
  }
  var celebQ = [], celebBusy = false;
  function handleSquads(list) {
    var fresh = list.filter(function (s) { return s && s.id && !isSeen(SEEN_SQ, s.id) && minsAgo(s.at) < (firstPoll ? 30 : 60); });
    // Mark old ones seen quietly (e.g. after a reinstall), so they never celebrate late.
    list.forEach(function (s) { if (s && s.id && minsAgo(s.at) >= 60) markSeen(SEEN_SQ, s.id); });
    if (firstPoll && fresh.length > 1) { fresh.slice(1).forEach(function (s) { markSeen(SEEN_SQ, s.id); }); fresh = fresh.slice(0, 1); }
    fresh.forEach(function (s) { markSeen(SEEN_SQ, s.id); celebQ.push(s); squadCache[s.group_id] = null; });
    if (list.length) U.ls.setJSON(LAST_SQ, list.slice(0, 6).map(function (s) { return { g: s.group_name, place: placePhrase(s), n: s.n | 0, at: s.at, nights: s.nights | 0 }; }));
    if (fresh.length) { try { A.renderTicker(); } catch (e) {} }
    pumpCeleb();
  }
  function pumpCeleb() {
    if (celebBusy || !celebQ.length) return;
    celebBusy = true;
    var go = function () {
      var s = celebQ.shift();
      celebrate(s);
      setTimeout(function () { celebBusy = false; pumpCeleb(); }, 4200);
    };
    try { if (window.OLNU_STRIP && window.OLNU_STRIP.after) { window.OLNU_STRIP.after(go); return; } } catch (e) {}
    go();
  }
  function reduced() { try { return window.FX && window.FX.reduced ? window.FX.reduced() : matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function celebrate(s) {
    try { window.FX.vibrate([70, 50, 70, 50, 200]); } catch (e) {}
    try { if (window.FX && window.FX.sound && window.FX.sound.clink) window.FX.sound.clink(); } catch (e) {}
    confetti();
    var flavor = sv() ? pick("sqf", T.squadFlavor) : pick("sqfe", T.squadFlavorEn);
    var names = (s.names || []).slice(0, 6).join(", ");
    A.toast(squadHead(s) + " " + flavor + (names ? " (" + names + ")" : ""), { cls: "skal near-sq-toast", urgent: true, ms: 7000 });
  }
  // Confetti: ~40 pieces fall once (2.6 s), pointer-events none, no blinking. Off with reduced motion.
  function confetti() {
    if (reduced()) return;
    var box = document.createElement("div");
    box.className = "near-confetti"; box.setAttribute("aria-hidden", "true");
    var cols = ["#f5a623", "#ffc24d", "#3ddc84", "#fffaf0", "#ff7a1a", "#6f7d4f"];
    for (var i = 0; i < 40; i++) {
      var p = document.createElement("i");
      p.style.left = (Math.random() * 100).toFixed(1) + "%";
      p.style.background = cols[i % cols.length];
      p.style.animationDelay = (Math.random() * 0.5).toFixed(2) + "s";
      p.style.animationDuration = (1.8 + Math.random() * 0.8).toFixed(2) + "s";
      p.style.setProperty("--dx", ((Math.random() - 0.5) * 120).toFixed(0) + "px");
      p.style.setProperty("--rot", (Math.random() * 540 + 180).toFixed(0) + "deg");
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3600);
  }
  function squadGroup(gid) {
    var c = squadCache[gid];
    if (c && Date.now() - c.at < 60000) return Promise.resolve(c.d);
    return call("squad_group", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data); squadCache[gid] = { at: Date.now(), d: d }; return d;
    });
  }

  /* Ticker (window.NEWS via BARSPLUS hooks, same ride-along as after.js) */
  var NEWS_SQ = ["🪖 TRUPPEN SAMLAD: {grupp} ä {n} man {plats}!", "🪖 {grupp} har mönstrat {n} man {plats}. Plutonen ä hel!",
    "📯 Samling! {n} ur {grupp} står axel mot axel {plats}.", "🪖 Rapport från fronten: {grupp} ä samlad {plats} – {n} man.",
    "🍻 {grupp} har tagit ställning {plats}. {n} man i skyttegraven.", "🪖 Sammanstrålning: {n} kamrater ur {grupp} {plats}.",
    "📡 Underrättelse: {grupp} ä {n} man starka {plats}.", "🎖️ {grupp} ä fulltalig(ish) {plats}: {n} man på plats."];
  var NEWS_NIGHTS = ["🪖 {grupp} har varit samlade {k} nätter. Kamratskap på riktigt.", "🎖️ {k} nätter tillsammans för {grupp}. Veteraner!",
    "📖 Krigsdagboken: {grupp} – {k} nätter i samma skyttegrav.", "🪖 {grupp}: {k} samlingar i boken. Nästa ikväll?"];
  var NEWS_SQ_EN = ["🪖 SQUAD ASSEMBLED: {grupp} is {n} strong {plats}!"];
  function newsTemplates() {
    var out = [];
    (sv() ? NEWS_SQ : NEWS_SQ_EN).forEach(function (s) { out.push({ k: "groupSquad", f: function (d) { return fill(s, d); } }); });
    if (sv()) NEWS_NIGHTS.forEach(function (s) { out.push({ k: "groupSquadNights", f: function (d) { return fill(s, d); } }); });
    return out;
  }
  function newsCands() {
    var out = [], list = P && P.squads ? P.squads : (U.ls.getJSON(LAST_SQ, []) || []).map(function (x) { return { group_name: x.g, phrase: x.place, n: x.n, at: x.at, nights: x.nights }; });
    var doneG = {};
    list.forEach(function (s) {
      var g = s.group_name || L("Gruppen", "The group");
      if (doneG[g] || minsAgo(s.at) > 120) return; doneG[g] = 1;
      out.push({ k: "groupSquad", d: { grupp: g, n: s.n | 0, plats: s.phrase != null ? s.phrase : placePhrase(s) }, imp: minsAgo(s.at) < 45 ? 2 : 1, cls: "tk-friend" });
      if ((s.nights | 0) >= 2) out.push({ k: "groupSquadNights", d: { grupp: g, k: s.nights | 0 }, imp: 0, cls: "tk-friend" });
    });
    return out;
  }
  function hookNews() {
    var bp = window.BARSPLUS;
    if (!bp || bp._nearWrapped) return;
    var t0 = bp.newsTemplates, c0 = bp.newsCands;
    bp.newsTemplates = function () { var a = []; try { a = t0 ? t0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsTemplates()); };
    bp.newsCands = function (ctx) { var a = []; try { a = c0 ? c0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsCands(ctx)); };
    bp._nearWrapped = true;
  }

  /* ---------- 1. VÄNNER ---------- */
  function handleFriendsIn(list) {
    list.forEach(function (f) {
      var k = f.id + ":" + f.at;
      if (isSeen(SEEN_FR, k)) return;
      markSeen(SEEN_FR, k);
      if (minsAgo(f.at) > 24 * 60) return;
      A.toast(sv() ? fill(pick("fin", T.friendIn), { namn: f.name || "Någon" }) : "🤝 " + (f.name || "Someone") + " wants to be your friend!", {
        action: { label: L("Visa", "Show"), fn: function () { openFriends(); } }, ms: 9000 });
    });
  }
  function friendRow(f, onChange) {
    var el = A.el;
    var dem = demonym(f.home_town);
    var sub = [];
    if (dem) sub.push(dem);
    sub.push(f.out ? L("🍺 ute ikväll", "🍺 out tonight") + (f.town ? " " + L("i ", "in ") + f.town : "") : L("🌙 int' ute", "🌙 not out"));
    var li = el("li", { class: "nr-frow" + (f.out ? " out" : "") }, [
      el("span", { class: "st-dot" + (f.out ? " on" : ""), "aria-hidden": "true" }),
      el("span", { class: "nr-fmain" }, [el("b", { text: f.name || L("Okänd kamrat", "Unknown") }), el("small", { class: "muted", text: sub.join(" · ") })]),
      off.find_request ? null : A.btn("🧭", "btn-small nr-find-b", function () { openFinder(f.key, f.name); }),
      A.btn("✕", "btn-small btn-ghost nr-rm-b", function () { askRemove(); })
    ]);
    li.querySelector(".nr-find-b") && li.querySelector(".nr-find-b").setAttribute("aria-label", L("Hitta ", "Find ") + (f.name || ""));
    li.querySelector(".nr-rm-b").setAttribute("aria-label", L("Ta bort vän ", "Remove friend ") + (f.name || ""));
    function askRemove() {
      if (li.nextSibling && li.nextSibling.classList && li.nextSibling.classList.contains("confirm")) return;
      var c = el("li", { class: "confirm" }, [
        el("p", { text: L("Ta bort " + (f.name || "vännen") + " ur vänlistan?", "Remove " + (f.name || "this friend") + "?") }),
        el("div", { class: "row" }, [A.btn(L("Avbryt", "Cancel"), "btn-small", function () { c.remove(); }),
          A.btn(L("Ta bort", "Remove"), "btn-small btn-danger", function () {
            call("friend_remove", { p_id: f.id }).then(function (r) {
              if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
              A.toast(sv() ? fill(pick("fg", T.friendGone), { namn: f.name || "" }) : "Friend removed.");
              if (onChange) onChange();
            });
          })])
      ]);
      li.parentNode.insertBefore(c, li.nextSibling);
    }
    return li;
  }
  function sendRequest(params, done) {
    params.p_name = name();
    call("friend_request", params).then(function (r) {
      if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); if (done) done(null); return; }
      var d = A.parseData(r.data), nm = d.name || L("kamraten", "your friend");
      if (d.status === "accepted") A.toast(sv() ? fill(pick("fnow", T.friendNow), { namn: nm }) : "🤝 You and " + nm + " are friends now!", { cls: "skal" });
      else A.toast(sv() ? (d.already ? "🤝 Förfrågan till " + nm + " väntar redan på svar." : fill(pick("fadd", T.friendAdded), { namn: nm })) : "🤝 Request sent to " + nm + ".");
      try { window.FX.vibrate(20); } catch (e) {}
      if (d.status === "pending" && !d.already && d.id) push({ event: "friend", friend_id: d.id });
      if (done) done(d);
    });
  }
  function codeLink(code) { return location.origin + location.pathname + "?friend=" + encodeURIComponent(code); }
  function openFriends() {
    if (!A || !A.LIVE) return;
    A.withName(function () {
      A.openSheet(L("👥 Vänner & 🧭 Hitta", "👥 Friends & 🧭 Find"), function (body) {
        var el = A.el;
        var inBox = el("div", { class: "nr-in" }), listBox = el("ul", { class: "nr-flist" }), outBox = el("div", { class: "nr-out muted" });
        body.appendChild(inBox);
        body.appendChild(el("h3", { text: L("Mina vänner", "My friends") }));
        body.appendChild(listBox);
        body.appendChild(outBox);
        listBox.appendChild(el("li", { class: "muted", text: "…" }));

        // Add with code
        var add = el("div", { class: "nr-add" });
        var inp = el("input", { class: "inp nr-code-inp", maxlength: "12", autocomplete: "off", autocapitalize: "characters", enterkeyhint: "go",
          placeholder: L("Väns kod, t.ex. K7Q2MXA", "Friend code"), "aria-label": L("Väns kod", "Friend code") });
        var go = A.btn(L("➕ Lägg till", "➕ Add"), "btn-amber", function () {
          var c = String(inp.value || "").replace(/^.*[?&]friend=/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (c.length < 5) { A.toast(L("Skriv väns kod (7 tecken).", "Type the friend code."), { err: true }); return; }
          go.disabled = true;
          sendRequest({ p_code: c }, function (d) { go.disabled = false; if (d) { inp.value = ""; load(); } });
        });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
        add.appendChild(el("h3", { text: L("➕ Lägg till vän", "➕ Add a friend") }));
        add.appendChild(el("div", { class: "row nr-add-row" }, [inp, go]));
        add.appendChild(el("p", { class: "muted nr-hint", text: L("Eller tryck på en kompis i en grupp → ➕ Lägg till vän.", "Or tap a member in a group → ➕ Add friend.") }));
        body.appendChild(add);

        // My code + QR
        var mine = el("div", { class: "nr-mine" });
        body.appendChild(mine);

        // Find-me switches
        var share = el("div", { class: "nr-share" });
        body.appendChild(share);
        drawShare(share);

        body.appendChild(el("p", { class: "muted nr-priv", text: L("🔒 Vänner ser ditt namn, din hemstad och om du ä ute ikväll (bara stan). Exakt position delas bara i 🧭 Hitta, när båda sagt ja, och försvinner efter 2 min.",
          "🔒 Friends see your name, home town and whether you are out tonight (town only). Exact position only in 🧭 Find, when both said yes; gone after 2 min.") }));

        function load() {
          call("my_friends", { p_name: name() }).then(function (r) {
            if (!document.body.contains(listBox)) return;
            listBox.innerHTML = ""; inBox.innerHTML = ""; outBox.innerHTML = "";
            if (r.error) { listBox.appendChild(el("li", { class: "muted", text: r.off ? L("Vänner finns int' på servern än.", "Friends are not on the server yet.") : errText("error") })); return; }
            var d = A.parseData(r.data);
            (d.incoming || []).forEach(function (f) {
              var dem = demonym(f.home_town);
              inBox.appendChild(el("div", { class: "nr-req" }, [
                el("p", {}, [el("b", { text: "🤝 " + (f.name || L("Någon", "Someone")) }), document.createTextNode(dem ? " · " + dem : ""),
                  el("span", { class: "muted", text: L(" vill bli din vän", " wants to be your friend") })]),
                el("div", { class: "row" }, [
                  A.btn(L("✅ Acceptera", "✅ Accept"), "btn-small btn-green", function () { answer(f, true); }),
                  A.btn(L("Nej tack", "No thanks"), "btn-small", function () { answer(f, false); })])
              ]));
            });
            var fr = d.friends || [];
            if (!fr.length) listBox.appendChild(el("li", { class: "muted", text: L("Inga vänner än. Dela din kod nedan, eller lägg till nån från en grupp.", "No friends yet. Share your code below.") }));
            fr.forEach(function (f) { listBox.appendChild(friendRow(f, load)); });
            if ((d.outgoing || []).length) {
              outBox.appendChild(el("p", { text: L("⏳ Väntar på svar: ", "⏳ Waiting: ") }));
              d.outgoing.forEach(function (f) {
                outBox.appendChild(el("span", { class: "nr-pend" }, [document.createTextNode(f.name || "?"),
                  A.btn(L("Ångra", "Undo"), "btn-small btn-ghost", function () { call("friend_remove", { p_id: f.id }).then(load); })]));
              });
            }
            drawMine(d.code);
          });
        }
        function answer(f, yes) {
          call("friend_answer", { p_id: f.id, p_accept: yes, p_name: name() }).then(function (r) {
            if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); load(); return; }
            if (yes) { A.toast(sv() ? fill(pick("fnow", T.friendNow), { namn: f.name || "" }) : "🤝 Friends now!", { cls: "skal" }); try { window.FX.vibrate([20, 40, 20]); } catch (e) {} }
            load(); poll(true);
          });
        }
        function drawMine(code) {
          mine.innerHTML = "";
          mine.appendChild(el("h3", { text: L("📲 Min vänkod", "📲 My friend code") }));
          if (!code) {
            mine.appendChild(A.btn(L("Visa min kod", "Show my code"), "btn-block", function () {
              call("my_friend_code", { p_name: name() }).then(function (r) { if (!r.error) drawMine(A.parseData(r.data).code); });
            }));
            return;
          }
          var link = codeLink(code);
          mine.appendChild(el("div", { class: "code-big nr-code", text: code }));
          var qr = el("div", { class: "qr", "aria-hidden": "true" });
          mine.appendChild(qr);
          try {
            if (window.QRCode) new window.QRCode(qr, { text: link, width: 168, height: 168, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
            else qr.remove();
          } catch (e) { qr.remove(); }
          var row = el("div", { class: "row", style: "margin-top:8px" }, [A.btn(L("📋 Kopiera länk", "📋 Copy link"), "btn-small", function () { A.copyText(link); })]);
          if (navigator.share) row.appendChild(A.btn(L("Dela", "Share"), "btn-small btn-amber", function () {
            navigator.share({ title: "Öl Nu", text: L("Bli min vän på Öl Nu 🍺", "Be my friend on Öl Nu 🍺"), url: link }).catch(function () {});
          }));
          row.appendChild(A.btn(L("🔄 Ny kod", "🔄 New code"), "btn-small btn-ghost", function () {
            call("my_friend_code", { p_new: true, p_name: name() }).then(function (r) {
              if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
              drawMine(A.parseData(r.data).code); A.toast(L("Ny kod! Den gamla funkar int' längre.", "New code. The old one stops working."));
            });
          }));
          mine.appendChild(row);
        }
        load();
      });
    });
  }
  function drawShare(box) {
    var el = A.el;
    box.innerHTML = "";
    if (off.set_find_share || off.near_poll) return;
    var s = (P && P.share) || {};
    box.appendChild(el("h3", { text: L("🧭 Låt mig hittas ikväll", "🧭 Let me be found tonight") }));
    box.appendChild(el("p", { class: "muted nr-hint", text: L("Påslaget kan gänget/vännerna starta kompassen mot dig utan att fråga – till kl 05 eller tills du slår av. Din exakta position skickas bara när DIN kompass ä öppen.",
      "When on, your groups/friends can start the compass to you without asking – until 05:00 or until you switch off. Your exact position is only sent while YOUR compass is open.") }));
    [["groups", L("Låt gruppen hitta mig", "Let my groups find me")], ["friends", L("Låt vännerna hitta mig", "Let my friends find me")]].forEach(function (x) {
      var on = !!s[x[0]];
      var sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": x[1] });
      sw.addEventListener("click", function () {
        var ns = { groups: !!s.groups, friends: !!s.friends }; ns[x[0]] = !on;
        sw.disabled = true;
        call("set_find_share", { p_groups: ns.groups, p_friends: ns.friends }).then(function (r) {
          sw.disabled = false;
          if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
          var d = A.parseData(r.data);
          P = P || {}; P.share = d;
          A.toast(d[x[0]] ? L("🧭 På till kl 05. Ingen ser dig förrän din kompass ä öppen.", "🧭 On until 05:00.") : L("🧭 Avslaget.", "🧭 Off."));
          drawShare(box);
        });
      });
      box.appendChild(el("div", { class: "toggle-row" }, [el("span", { text: x[1] + (on && s.until ? " · " + L("till ", "until ") + U.timeHM(s.until) : "") }), sw]));
    });
  }
  // From social.js member tap (v25 panel): add "➕ Lägg till vän" and "🧭 Hitta".
  function memberPanel(g, m, panel, openU) {
    if (!A || !A.LIVE || !m || m.is_me || !m.k || off.friend_request) return panel;
    var el = A.el, box = panel, row;
    if (!box) {
      box = el("li", { class: "st-act" });
      row = el("div", { class: "row" });
      if (openU) row.appendChild(A.btn(L("🎖️ Uniform", "🎖️ Uniform"), "btn-small", openU));
      box.appendChild(row);
    } else row = box.querySelector(".row") || box;
    var add = A.btn(L("➕ Lägg till vän", "➕ Add friend"), "btn-small nr-addf", function () {
      add.disabled = true;
      sendRequest({ p_group_id: g.id, p_k: m.k }, function (d) { add.disabled = false; if (d) add.textContent = d.status === "accepted" ? L("✅ Vänner", "✅ Friends") : L("⏳ Skickad", "⏳ Sent"); });
    });
    row.appendChild(add);
    if (!off.find_request) row.appendChild(A.btn(L("🧭 Hitta", "🧭 Find"), "btn-small nr-findm", function () { openFinder("g" + g.id + ":" + m.k, m.name); }));
    return box;
  }

  /* ---------- Group page tile: Nätter tillsammans + 🧭 Hitta nån ---------- */
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || !g || !g.id || off.squad_group) return;
    var el = A.el;
    var tile = el("div", { class: "nr-tile" }, [el("span", { class: "nr-tile-t", text: L("🪖 Nätter tillsammans: …", "🪖 Nights together: …") })]);
    var findB = off.find_request ? null : A.btn(L("🧭 Hitta nån", "🧭 Find someone"), "btn-small nr-tile-find", function () { pickMember(g); });
    if (findB) tile.appendChild(findB);
    wrap.appendChild(tile);
    squadGroup(g.id).then(function (d) {
      var tt = tile.querySelector(".nr-tile-t");
      if (!d) { if (off.squad_group) tile.remove(); else tt.textContent = L("🪖 Nätter tillsammans", "🪖 Nights together"); return; }
      var last = (d.last || [])[0], n = d.nights | 0;
      tt.innerHTML = "";
      tt.appendChild(el("b", { text: L("🪖 Nätter tillsammans: ", "🪖 Nights together: ") + n }));
      var sub = !last ? L("3 man inom 50 m så smäller dä.", "3 members within 50 m and it pops.")
        : L("Senast ", "Last ") + (placePhrase(last) ? placePhrase(last) + ", " : "") + (last.n | 0) + L(" man", " strong") + " · " + dayText(last.at);
      tt.appendChild(el("small", { class: "muted", text: sub }));
    });
  }
  function dayText(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return "";
    var mins = (Date.now() - t) / 60000;
    if (mins < 12 * 60) return L("ikväll ", "tonight ") + U.timeHM(iso);
    try { return new Date(t).toLocaleDateString(sv() ? "sv-SE" : "en-GB", { day: "numeric", month: "short" }); } catch (e) { return ""; }
  }
  function pickMember(g) {
    A.openSheet(L("🧭 Vem vill du hitta?", "🧭 Who do you want to find?"), function (body) {
      var el = A.el, list = el("div", { class: "nr-pick" });
      body.appendChild(el("p", { class: "muted", text: L("Kompisen får en fråga (eller har redan sagt att gruppen får hitta hen).", "Your friend gets a question (unless they already let the group find them).") }));
      body.appendChild(list);
      list.appendChild(el("p", { class: "muted", text: "…" }));
      A.rpc("group_status_v2", { p_group_id: g.id }).then(function (r) {
        list.innerHTML = "";
        var rows = r.error ? [] : (r.data || []).filter(function (m) { return !m.is_me && m.k; });
        if (!rows.length) { list.appendChild(el("p", { class: "muted", text: r.error ? errText("error") : L("Ingen annan i gruppen än.", "Nobody else in the group yet.") })); return; }
        rows.sort(function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0); }).forEach(function (m) {
          list.appendChild(A.btn((m.live ? "🟢 " : "") + (m.name || "?"), "btn-small nr-pick-b", function () { openFinder("g" + g.id + ":" + m.k, m.name); }));
        });
      });
    });
  }

  /* ---------- 3. HITTA KOMPISEN: incoming requests ---------- */
  function handleFindIn(list) {
    list.forEach(function (r) {
      if (r.status !== "pending" || isSeen(SEEN_FIND, r.id)) return;
      markSeen(SEEN_FIND, r.id);
      A.toast(sv() ? fill(pick("fi", T.findIn), { namn: r.name || "Någon" }) : "🧭 " + (r.name || "Someone") + " wants to find you!", {
        action: { label: L("🧭 Svara", "🧭 Answer"), fn: function () { askFind(r); } }, ms: 12000 });
      try { window.FX.vibrate([30, 60, 30]); } catch (e) {}
    });
    list.forEach(function (r) {
      if ((r.status !== "auto" && r.status !== "accepted") || !r.finding || isSeen(SEEN_FIND, "a" + r.id) || (finder && finder.key === r.key)) return;
      markSeen(SEEN_FIND, "a" + r.id);
      A.toast(sv() ? fill(pick("fa", T.findAuto), { namn: r.name || "Någon" }) : "🧭 " + (r.name || "Someone") + " is looking for you.", {
        action: { label: L("🧭 Öppna", "🧭 Open"), fn: function () { openFinder(r.key, r.name); } }, ms: 10000 });
    });
  }
  function urgentFind() {
    if (!P) return null;
    var list = P.find_in || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (finder && finder.key === r.key) continue;
      if (r.status === "pending" && Date.parse(r.answer_by) > Date.now()) return { r: r, kind: "ask" };
      if ((r.status === "auto" || r.status === "accepted") && r.finding) return { r: r, kind: "open" };
    }
    return null;
  }
  function chipKey() { var u = urgentFind(); return u ? u.kind + u.r.id : ""; }
  function chipHTML() {
    var u = urgentFind(); if (!u) return "";
    var nm = esc(u.r.name || L("Någon", "Someone"));
    return '<button type="button" class="hx-chip hx-urgent nr-chip" data-hx="near" aria-label="' + esc(L("Hitta kompisen: ", "Find friend: ") + (u.r.name || "")) + '">🧭 ' +
      (u.kind === "ask" ? L(nm + " söker dig", nm + " looks for you") : L(nm + " letar", nm + " is looking")) + "</button>";
  }
  function askFind(r) {
    A.openSheet(L("🧭 Hitta kompisen", "🧭 Find a friend"), function (body) {
      var el = A.el;
      body.appendChild(el("p", {}, [el("b", { text: r.name || L("Någon", "Someone") }),
        document.createTextNode(L(" vill hitta dig i vimlet" + (r.group_name ? " (" + r.group_name + ")" : "") + ".", " wants to find you in the crowd."))]));
      body.appendChild(el("p", { class: "muted", text: L("Säger du ja ser ni varandras exakta position i 30 min, men bara medan kompassen ä öppen. Inget sparas.",
        "If you say yes you see each other's exact position for 30 min, only while the compass is open. Nothing is kept.") }));
      body.appendChild(el("div", { class: "row" }, [
        A.btn(L("✅ Ja, hitta mig", "✅ Yes, find me"), "btn-green", function () {
          call("find_answer", { p_id: r.id, p_accept: true }).then(function (x) {
            if (x.error) { A.toast(errText(codeOf(x.error)), { err: true }); A.closeSheet(); return; }
            poll(true); openFinder(r.key, r.name);
          });
        }),
        A.btn(L("❌ Int' nu", "❌ Not now"), "", function () {
          call("find_answer", { p_id: r.id, p_accept: false }).then(function () { poll(true); A.closeSheet(); });
        })
      ]));
    });
  }

  /* ---------- 3. Finder sheet (compass) ---------- */
  var finder = null;
  function bearing(la1, ln1, la2, ln2) {
    var r = Math.PI / 180, y = Math.sin((ln2 - ln1) * r) * Math.cos(la2 * r);
    var x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((ln2 - ln1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function openFinder(key, nm) {
    if (!A || !A.LIVE || !key) return;
    if (!navigator.geolocation) { A.toast(L("Telefonen har ingen GPS för detta.", "No GPS on this device."), { err: true }); return; }
    if (finder) finder.close(true);
    var st = { key: key, name: nm || L("kompisen", "your friend"), me: null, tgt: null, dist: null, prev: null, heading: null,
      headingAt: 0, watch: null, timer: null, req: null, alive: true, info: null, mini: null, miniMe: null, miniT: null, hotText: "" };
    var el = A.el;
    var dial = el("div", { class: "nr-dial", "aria-hidden": "true" }, [
      el("div", { class: "nr-ring" }), el("div", { class: "nr-n", text: "N" }),
      el("div", { class: "nr-arrow" }, [el("span", { class: "nr-arrow-head" })])
    ]);
    st.dial = dial; st.arrow = dial.querySelector(".nr-arrow"); st.nmark = dial.querySelector(".nr-n");
    st.distEl = el("div", { class: "nr-dist", "aria-live": "polite", text: "– m" });
    st.hotEl = el("div", { class: "nr-hot", text: "" });
    st.statusEl = el("p", { class: "nr-status muted", text: L("📡 Söker GPS…", "📡 Getting GPS…") });
    st.compBtn = A.btn(L("🧭 Slå på kompassen", "🧭 Turn on compass"), "btn-amber btn-block nr-comp", askCompass);
    st.compBtn.hidden = !(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === "function");
    st.mapEl = el("div", { class: "nr-mini", hidden: "" });
    A.openSheet(L("🧭 Hitta ", "🧭 Find ") + st.name, function (body) {
      var box = el("div", { class: "nr-finder" }, [dial, st.distEl, st.hotEl, st.statusEl, st.compBtn, st.mapEl,
        el("p", { class: "muted nr-priv", text: L("🔒 Exakt position delas bara medan denna ruta ä öppen och bara med " + st.name + ". Raderas efter 2 min.",
          "🔒 Exact position only while this is open, only with " + st.name + ". Gone after 2 min.") }),
        el("div", { class: "row" }, [A.btn(L("✖️ Stäng", "✖️ Close"), "btn-block", function () { A.closeSheet(); })])]);
      body.appendChild(box);
      start();
    }, { onClose: function () { st.close(false); } });

    st.close = function (replaced) {
      if (!st.alive) return; st.alive = false;
      if (st.watch != null) try { navigator.geolocation.clearWatch(st.watch); } catch (e) {}
      if (st.timer) clearInterval(st.timer);
      window.removeEventListener("deviceorientationabsolute", onOri, true);
      window.removeEventListener("deviceorientation", onOri, true);
      if (st.mini) try { st.mini.remove(); } catch (e) {}
      call("find_stop", {});
      if (finder === st) finder = null;
      try { A.updateCounts(); } catch (e) {}
    };
    st.poll = function () { if (st.alive) draw(); };

    function start() {
      if (st.started || !st.alive) return; st.started = true; finder = st;
      // 1. Ask / start (server decides: auto with share, pending otherwise).
      call("find_request", { p_key: key, p_name: name() }).then(function (r) {
        if (!st.alive) return;
        if (r.error) { st.reqErr = true; st.statusEl.textContent = errText(r.off ? "error" : codeOf(r.error)); return; }
        st.req = A.parseData(r.data);
        // Push to the friend (server: once per request, atomic claim; a repeat call is harmless).
        if ((st.req.status === "pending" || st.req.status === "auto") && st.req.mine && st.req.id) push({ event: "find", req_id: st.req.id });
        draw(); ping();
      });
      // 2. GPS while open.
      try {
        st.watch = navigator.geolocation.watchPosition(function (p) {
          st.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
          if (!st.firstFix) { st.firstFix = true; ping(); }
          draw();
        }, function (e) {
          st.statusEl.textContent = e && e.code === 1 ? L("📍 Appen får int' använda platsen. Tillåt plats i inställningarna.", "📍 Location not allowed.") : L("📡 Ingen GPS-signal än…", "📡 No GPS yet…");
        }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
      } catch (e) {}
      st.timer = setInterval(ping, PING_MS);
      // 3. Compass (Android: absolute event; iOS: webkitCompassHeading after a permission tap).
      window.addEventListener("deviceorientationabsolute", onOri, true);
      window.addEventListener("deviceorientation", onOri, true);
      setTimeout(function () { if (st.alive && st.heading == null) showMini(); }, 2500);

    }
    function askCompass() {
      try {
        window.DeviceOrientationEvent.requestPermission().then(function (res) {
          if (res === "granted") { st.compBtn.hidden = true; } else { A.toast(L("Utan kompass visar vi en karta istället.", "No compass: showing a map instead.")); showMini(); }
        }).catch(function () { showMini(); });
      } catch (e) { showMini(); }
    }
    function onOri(e) {
      if (!st.alive) return;
      var h = null;
      if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
      else if ((e.absolute || e.type === "deviceorientationabsolute") && typeof e.alpha === "number" && isFinite(e.alpha)) h = (360 - e.alpha) % 360;
      if (h == null) return;
      var so = 0; try { so = (screen.orientation && screen.orientation.angle) || window.orientation || 0; } catch (x) {}
      st.heading = (h + so + 360) % 360; st.headingAt = Date.now();
      if (st.compBtn) st.compBtn.hidden = true;
      if (!st.raf) st.raf = requestAnimationFrame(function () { st.raf = 0; drawArrow(); });
    }
    function ping() {
      if (!st.alive || !st.me || (!st.req && !st.reqErr)) return;
      call("find_ping", { p_key: key, p_lat: st.me.lat, p_lng: st.me.lng, p_acc: st.me.acc }).then(function (r) {
        if (!st.alive) return;
        if (r.error) {
          var c = codeOf(r.error);
          if (c === "no_find") { st.info = { allowed: false, status: "none" }; draw(); return; }
          st.statusEl.textContent = errText(c); return;
        }
        st.info = A.parseData(r.data);
        if (st.info.target) {
          var t = st.info.target, d = U.haversine(st.me.lat, st.me.lng, t.lat, t.lng);
          st.prev = st.dist; st.dist = d; st.tgt = t;
          hotCold();
        } else st.tgt = null;
        draw();
      });
    }
    function hotCold() {
      var d = st.dist, p = st.prev, txt;
      if (d == null) return;
      if (d <= 8) txt = sv() ? pick("here", T.here) : "👀 You are there! Look up.";
      else if (p == null) txt = "";
      else if (p - d > 2) txt = sv() ? pick("w", T.warmer) : "🔥 Warmer!";
      else if (d - p > 2) txt = sv() ? pick("c", T.colder) : "🧊 Colder…";
      // Small change: keep the last warmer/colder line for 15 s (no flicker between texts).
      else txt = st.hotText && /🔥|🧊/.test(st.hotText) && Date.now() - st.hotAt < 15000 ? st.hotText : (sv() ? pick("s", T.same) : "🙂 About the same");
      if (txt !== st.hotText) st.hotAt = Date.now();
      st.hotText = txt;
      st.hotEl.textContent = txt;
      st.hotEl.className = "nr-hot" + (/🔥/.test(txt) ? " warm" : /🧊/.test(txt) ? " cold" : /👀/.test(txt) ? " here" : "");
    }
    function draw() {
      if (!st.alive || !document.body.contains(st.distEl)) return;
      var inf = st.info || {}, req = st.req || {};
      var s = inf.status || req.status;
      if (st.tgt && st.me) {
        var acc = Math.round(Math.max(st.me.acc || 0, st.tgt.acc || 0));
        st.distEl.textContent = Math.round(st.dist) + " m" + (acc ? " ±" + acc : "");
        var age = st.tgt.age_s | 0;
        st.statusEl.textContent = (age > 20 ? L("📡 " + st.name + " sågs för " + age + " s sen", "📡 Seen " + age + " s ago") : L("📡 Live – " + st.name + " har kompassen öppen", "📡 Live"));
        st.dial.classList.add("live");
      } else {
        st.dial.classList.remove("live");
        st.distEl.textContent = "– m";
        if (!st.me) st.statusEl.textContent = L("📡 Söker GPS…", "📡 Getting GPS…");
        else if (s === "pending") st.statusEl.textContent = (sv() ? fill(pick("wa", T.waitAns), { namn: st.name }) : "⏳ Waiting for " + st.name + "…") + cd(req.answer_by || inf.answer_by);
        else if (s === "declined") st.statusEl.textContent = L("🙅 " + st.name + " vill int' bli hittad just nu. Inga sura miner.", "🙅 " + st.name + " said no for now.");
        else if (s === "expired" || s === "cancelled" || s === "ended" || s === "none") st.statusEl.textContent = L("⌛ Förfrågan ä slut. Stäng och försök igen.", "⌛ Request ended.");
        else st.statusEl.textContent = sv() ? fill(pick("wp", T.waitPos), { namn: st.name }) : "📡 Waiting for " + st.name + " to open the compass.";
      }
      drawArrow(); drawMini();
    }
    function cd(iso) { var t = Date.parse(iso); if (!isFinite(t)) return ""; var ms = t - Date.now(); return ms > 0 ? " (" + U.mmss(ms) + ")" : ""; }
    function drawArrow() {
      if (!st.arrow) return;
      var have = st.tgt && st.me, comp = st.heading != null && Date.now() - st.headingAt < 5000;
      st.arrow.classList.toggle("on", !!have);
      if (!have) return;
      var b = bearing(st.me.lat, st.me.lng, st.tgt.lat, st.tgt.lng);
      // With compass: arrow relative to where the phone points. Without: north-up (N mark at the top).
      var rot = comp ? b - st.heading : b;
      st.arrow.style.transform = "rotate(" + rot.toFixed(1) + "deg)";
      if (st.nmark) st.nmark.style.transform = "rotate(" + (comp ? -st.heading : 0).toFixed(1) + "deg)";
      st.dial.classList.toggle("nocomp", !comp);
    }
    function showMini() {
      if (!st.alive || st.mini || !st.mapEl || !window.L) return;
      st.mapEl.hidden = false;
      try {
        st.mini = window.L.map(st.mapEl, { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false });
        window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19 }).addTo(st.mini);
        st.mini.setView(st.me ? [st.me.lat, st.me.lng] : A.map.getCenter(), 17);
        st.mapEl.appendChild(A.el("div", { class: "nr-mini-n", text: "N ↑" }));
        st.mapEl.appendChild(A.el("div", { class: "nr-mini-cap", text: L("Ingen kompass – kartan visar riktningen (norr upp).", "No compass – map shows the direction (north up).") }));
      } catch (e) { st.mini = null; }
      drawMini();
    }
    function drawMini() {
      if (!st.mini || !st.me) return;
      var Lf = window.L;
      var me = [st.me.lat, st.me.lng];
      if (!st.miniMe) st.miniMe = Lf.circleMarker(me, { radius: 7, color: "#fff", weight: 2, fillColor: "#4aa3ff", fillOpacity: 1 }).addTo(st.mini); else st.miniMe.setLatLng(me);
      if (st.tgt) {
        var tg = [st.tgt.lat, st.tgt.lng];
        if (!st.miniT) st.miniT = Lf.circleMarker(tg, { radius: 8, color: "#241300", weight: 2, fillColor: "#f5a623", fillOpacity: 1 }).addTo(st.mini); else st.miniT.setLatLng(tg);
        if (!st.miniLine) st.miniLine = Lf.polyline([me, tg], { color: "#ffc24d", weight: 3, dashArray: "6 6" }).addTo(st.mini); else st.miniLine.setLatLngs([me, tg]);
        if (!st.miniFit || Date.now() - st.miniFit > 15000) { st.miniFit = Date.now(); st.mini.fitBounds(Lf.latLngBounds([me, tg]).pad(0.4), { maxZoom: 19 }); }
      } else st.mini.setView(me, st.mini.getZoom());
      setTimeout(function () { try { st.mini && st.mini.invalidateSize(); } catch (e) {} }, 60);
    }
  }

  /* ---------- Deep links: ?friend=CODE, ?find=<id> ---------- */
  var linkDone = false;
  function linkFromUrl() {
    if (linkDone) return null;
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    var fr = q.get("friend"), fi = q.get("find"), fs = q.get("friends");
    if (!fr && !fi && !fs) return null;
    linkDone = true;
    try { q.delete("friend"); q.delete("find"); q.delete("friends"); var s = q.toString(); history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash); } catch (e) {}
    return { friend: fr, find: fi, friends: fs };
  }
  function openNearLink(find, friend) {
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      if (friend) { openCode(friend); return; }
      if (find === "list" || find === "1") { openFriends(); return; }
      if (find) poll(true).then(function () {
        var r = (P && P.find_in || []).filter(function (x) { return String(x.id) === String(find); })[0];
        if (!r) { openFriends(); return; }
        if (r.status === "pending") askFind(r); else if (r.status === "auto" || r.status === "accepted") openFinder(r.key, r.name);
        else A.toast(L("Förfrågan ä slut.", "That request ended."));
      });
      else openFriends();
    })();
  }
  function openCode(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    call("friend_code_info", { p_code: code }).then(function (r) {
      if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); return; }
      var d = A.parseData(r.data);
      if (d.mine) { A.toast(L("Dä ä din egen vänkod. Skicka den till nån annan!", "That is your own code.")); return; }
      A.withName(function () {
        A.openSheet(L("🤝 Bli vänner?", "🤝 Be friends?"), function (body) {
          var el = A.el, dem = demonym(d.home_town);
          body.appendChild(el("p", {}, [el("b", { text: d.name || L("En kamrat", "Someone") }), document.createTextNode(dem ? " · " + dem : "")]));
          if (d.state === "accepted") { body.appendChild(el("p", { text: L("Ni ä redan vänner. 🍻", "You are already friends. 🍻") })); return; }
          if (d.state === "pending_out") { body.appendChild(el("p", { class: "muted", text: L("Din förfrågan väntar på svar.", "Your request is waiting.") })); return; }
          body.appendChild(el("p", { class: "muted", text: L("Vänner ser varandras namn, hemstad och om ni ä ute ikväll.", "Friends see each other's name, home town and whether out tonight.") }));
          body.appendChild(el("div", { class: "row" }, [
            A.btn(d.state === "pending_in" ? L("✅ Acceptera", "✅ Accept") : L("➕ Skicka vänförfrågan", "➕ Send friend request"), "btn-amber btn-block", function () {
              sendRequest({ p_code: code }, function (x) { if (x) openFriends(); });
            })
          ]));
        });
      });
    });
  }

  /* ---------- Public hooks ---------- */
  window.NEAR = {
    _texts: T, newsTemplates: newsTemplates, newsCands: newsCands, memberPanel: memberPanel,
    openFriends: openFriends, openFinder: openFinder, _celebrate: celebrate, _poll: function () { return P; },
    init: function (api) { A = api; hookNews(); },
    onAuthed: function () {
      hookNews();
      var l = linkFromUrl();
      poll(true).then(function () { if (l) openNearLink(l.find || (l.friends ? "list" : null), l.friend); });
    },
    onPoll: function () { hookNews(); poll(false); },
    applyText: function () {},
    settingsSheet: function (body) {
      if (!A || !A.LIVE || off.my_friends || off.near_poll) return;
      var nIn = P && P.friends_in ? P.friends_in.length : 0;
      body.appendChild(A.el("div", { class: "row nr-set", style: "margin-bottom:10px" }, [
        A.btn(L("👥 Vänner & 🧭 Hitta", "👥 Friends & 🧭 Find") + (nIn ? " (" + nIn + L(" ny", " new") + ")" : ""), "btn-block", openFriends)]));
    },
    groupItem: function (g, wrap) { groupItem(g, wrap); },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (action) {
      if (action !== "near") return;
      var u = urgentFind(); if (!u) return;
      if (u.kind === "ask") askFind(u.r); else openFinder(u.r.key, u.r.name);
    },
    openNearLink: function (find, friend) { openNearLink(find, friend); }
  };
})();
