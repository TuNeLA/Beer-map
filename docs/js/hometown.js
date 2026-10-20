/* Öl Nu v25 — HEMSTAD ("Var är du mest baserad?"). Server: migration 0033 (set_home_town, my_home_town,
   group_status_v2 / chief_state .home_town, local_board_v2 / wall_of_fame_v2 .home_town).
   - The user picks a home town: searchable list (the 52 taxi towns + the CITIES list + a few more) or free text
     (max 30 chars). Shown as a small demonym label next to the name: "Ludvikabo", "Smedjebackare",
     "Göteborgare"; unknown town → "från {stad}" (English: "from {town}").
   - Where to set it: ⚙️ Settings next to the name (hook settingsName), and ONE gentle prompt after the next
     level-up (afterLevelUp, called by social.js). The prompt waits for the BEFORDRAN popup and never shows
     while the beer-type strip is up (window.OLNU_STRIP, barsplus.js).
   - Missing RPC (old server) → the settings row and the prompt hide; labels just do not show.
   Hooks (app.js mods): init, onAuthed, settingsName. Public: HOMETOWN.label(town), towns(), mine(), open(). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, mine = null, loaded = false;
  var LS_TOWN = "olnu.homeTown", LS_ASKED = "olnu.homeAsked";

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }

  /* ---------- Demonyms (dialect é written as ä). Keys are matched case-insensitively. ---------- */
  var DEMONYM = {
    "Ludvika": "Ludvikabo", "Borlänge": "Borlängebo", "Falun": "Faluguing", "Smedjebacken": "Smedjebackare",
    "Avesta": "Avestabo", "Hedemora": "Hedemorabo", "Säter": "Säterbo", "Mora": "Morabo", "Orsa": "Orsabo",
    "Vansbro": "Vansbrobo", "Gagnef (Djurås)": "Gagnefsbo", "Gagnef": "Gagnefsbo", "Djurås": "Djuråsbo",
    "Grängesberg": "Grängesbergare", "Stockholm": "Stockholmare", "Göteborg": "Göteborgare", "Malmö": "Malmöbo",
    "Uppsala": "Uppsalabo", "Västerås": "Västeråsare", "Örebro": "Örebroare", "Linköping": "Linköpingsbo",
    "Helsingborg": "Helsingborgare", "Jönköping": "Jönköpingsbo", "Norrköping": "Norrköpingsbo", "Lund": "Lundabo",
    "Umeå": "Umebo", "Gävle": "Gävlebo", "Borås": "Boråsare", "Södertälje": "Södertäljebo", "Eskilstuna": "Eskilstunabo",
    "Halmstad": "Halmstadbo", "Växjö": "Växjöbo", "Karlstad": "Karlstadbo", "Sundsvall": "Sundsvallsbo",
    "Östersund": "Östersundsbo", "Trollhättan": "Trollhättebo", "Luleå": "Luleåbo", "Kalmar": "Kalmarbo",
    "Kristianstad": "Kristianstadsbo", "Skövde": "Skövdebo", "Karlskrona": "Karlskronabo", "Skellefteå": "Skelleftebo",
    "Uddevalla": "Uddevallabo", "Nyköping": "Nyköpingsbo", "Varberg": "Varbergsbo", "Örnsköldsvik": "Örnsköldsviksbo",
    "Visby": "Visbybo", "Falkenberg": "Falkenbergare", "Motala": "Motalabo", "Sandviken": "Sandvikenbo",
    "Köping": "Köpingsbo", "Fagersta": "Fagerstabo", "Arboga": "Arbogabo", "Kiruna": "Kirunabo",
    // CITIES list + more around Ludvika / Dalarna and the push town list
    "Piteå": "Pitebo", "Leksand": "Leksandsbo", "Rättvik": "Rättviksbo", "Härnösand": "Härnösandsbo",
    "Kungsbacka": "Kungsbackabo", "Hudiksvall": "Hudiksvallsbo", "Grangärde": "Grangärdebo", "Säfsnäs": "Säfsnäsbo",
    "Nyhammar": "Nyhammarsbo", "Fredriksberg": "Fredriksbergsbo", "Söderbärke": "Söderbärkebo", "Malung": "Malungsbo",
    "Älvdalen": "Älvdaling", "Sälen": "Sälenbo", "Norberg": "Norbergsbo", "Lindesberg": "Lindesbergsbo",
    "Kopparberg": "Kopparbergsbo", "Gotland": "Gotlänning", "Öland": "Ölänning"
  };
  var TOWNS = ["Ludvika", "Borlänge", "Falun", "Smedjebacken", "Avesta", "Hedemora", "Säter", "Mora", "Orsa", "Vansbro",
    "Gagnef (Djurås)", "Grängesberg", "Stockholm", "Göteborg", "Malmö", "Uppsala", "Västerås", "Örebro", "Linköping",
    "Helsingborg", "Jönköping", "Norrköping", "Lund", "Umeå", "Gävle", "Borås", "Södertälje", "Eskilstuna", "Halmstad",
    "Växjö", "Karlstad", "Sundsvall", "Östersund", "Trollhättan", "Luleå", "Kalmar", "Kristianstad", "Skövde",
    "Karlskrona", "Skellefteå", "Uddevalla", "Nyköping", "Varberg", "Örnsköldsvik", "Visby", "Falkenberg", "Motala",
    "Sandviken", "Köping", "Fagersta", "Arboga", "Kiruna",
    "Piteå", "Leksand", "Rättvik", "Härnösand", "Kungsbacka", "Hudiksvall", "Grangärde", "Säfsnäs", "Nyhammar",
    "Fredriksberg", "Söderbärke", "Malung", "Älvdalen", "Sälen", "Norberg", "Lindesberg", "Kopparberg"];
  var KEYS = {};
  Object.keys(DEMONYM).forEach(function (k) { KEYS[k.toLowerCase()] = DEMONYM[k]; });
  // The taxi list (lazy file) and CITIES may know more towns: add them to the picker (no demonym → "från X").
  function allTowns() {
    var seen = {}, out = [];
    function add(n) { n = clean(n); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } }
    TOWNS.forEach(add);
    try { (window.CITIES && window.CITIES.list || []).forEach(function (c) { add(c.name); }); } catch (e) {}
    try { (window.TAXI_DATA && window.TAXI_DATA.towns || []).forEach(function (c) { add(c.town); }); } catch (e) {}
    return out;
  }
  function clean(s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
  function valid(s) { return s.length <= 30 && /^[\p{L}\p{N} .,'’()&/-]+$/u.test(s) && /\p{L}/u.test(s); }
  // Demonym label for a town ("" for none). Unknown → "från X".
  function label(town) {
    var t = clean(town); if (!t) return "";
    var d = KEYS[t.toLowerCase()];
    if (sv()) return d || "från " + t;
    return "from " + t;
  }

  /* ---------- Server ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off = true; r.off = true; }
      return r;
    });
  }
  function load() {
    return call("my_home_town").then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data);
      mine = d.town || null; loaded = true;
      try { if (mine) U.ls.set(LS_TOWN, mine); else localStorage.removeItem(LS_TOWN); } catch (e) {}
    });
  }
  function save(town, done) {
    var t = clean(town);
    if (t && !valid(t)) { A.toast(L("Bara bokstäver, siffror och - . ' ( ), max 30 tecken.", "Letters, digits and - . ' ( ) only, max 30."), { err: true }); return; }
    call("set_home_town", { p_town: t }).then(function (r) {
      if (r.error) {
        var c = U.errCode(r.error);
        A.toast(c === "invalid_town" ? L("Den stan känner vi int' igen. Prova en annan stavning.", "That town name is not valid.")
          : c === "slow_down" ? L("Lugn, en sak i taget.", "Easy, one at a time.") : L("Det gick int'. Försök igen.", "That did not work."), { err: true });
        return;
      }
      var d = A.parseData(r.data);
      mine = d.town || null; loaded = true;
      try { if (mine) U.ls.set(LS_TOWN, mine); else localStorage.removeItem(LS_TOWN); } catch (e) {}
      try { U.ls.set(LS_ASKED, "1"); } catch (e) {}
      A.toast(mine ? L("📍 Sparat! Nu vet gänget att du ä " + label(mine) + ".", "📍 Saved: " + mine + ".") : L("📍 Hemstaden ä borttagen.", "📍 Home town cleared."), { ms: 4000 });
      try { window.FX.vibrate(15); } catch (e) {}
      if (done) done(mine);
    });
  }

  /* ---------- Picker (searchable list + free text) ---------- */
  function open(after) {
    if (!A) return;
    var el = A.el;
    A.openSheet(L("📍 Var är du mest baserad?", "📍 Where are you based?"), function (body) {
      body.appendChild(el("p", { class: "muted", text: L("Gänget ser en liten etikett vid ditt namn, t.ex. \"Ludvikabo\". Bara grupper du ä med i ser den.",
        "Your groups see a small label next to your name. Only your groups see it.") }));
      var inp = el("input", { class: "inp ht-inp", maxlength: "30", autocomplete: "off", enterkeyhint: "done",
        placeholder: L("Sök eller skriv din stad", "Search or type your town"), "aria-label": L("Hemstad", "Home town"), value: mine || "" });
      var list = el("div", { class: "ht-list", role: "listbox", "aria-label": L("Städer", "Towns") });
      var prev = el("p", { class: "ht-prev muted" });
      body.appendChild(inp); body.appendChild(prev); body.appendChild(list);
      var row = el("div", { class: "row ht-btns" });
      var saveB = A.btn(L("💾 Spara", "💾 Save"), "btn-amber", function () { pickIt(inp.value); });
      row.appendChild(saveB);
      if (mine) row.appendChild(A.btn(L("Ta bort", "Clear"), "btn-small", function () { save("", function () { A.closeSheet(); if (after) after(); }); }));
      body.appendChild(row);
      function pickIt(v) {
        var t = clean(v);
        if (!t) { A.toast(L("Skriv eller välj en stad.", "Type or pick a town."), { err: true }); return; }
        save(t, function () { A.closeSheet(); if (after) after(); });
      }
      function draw() {
        var q = clean(inp.value).toLowerCase(), towns = allTowns();
        var hits = towns.filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; })
          .sort(function (a, b) { var ia = a.toLowerCase().indexOf(q), ib = b.toLowerCase().indexOf(q); return (ia === 0 ? 0 : 1) - (ib === 0 ? 0 : 1); })
          .slice(0, q ? 24 : 60);
        list.innerHTML = "";
        hits.forEach(function (n) {
          var b = el("button", { type: "button", class: "chip-btn ht-chip", role: "option", "aria-selected": String(!!mine && mine.toLowerCase() === n.toLowerCase()) }, [
            document.createTextNode(n), el("small", { class: "ht-dem", text: KEYS[n.toLowerCase()] ? " · " + KEYS[n.toLowerCase()] : "" })]);
          b.addEventListener("click", function () { inp.value = n; pickIt(n); });
          list.appendChild(b);
        });
        var t = clean(inp.value);
        prev.textContent = t ? (valid(t) ? L("Etikett: ", "Label: ") + label(t) : L("Bara bokstäver, siffror och - . ' ( )", "Letters and digits only")) : "";
        if (!hits.length && t) list.appendChild(el("p", { class: "muted ht-none", text: L("Int' i listan – tryck Spara så blir det \"" + label(t) + "\".", "Not in the list – tap Save.") }));
      }
      inp.addEventListener("input", draw);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); pickIt(inp.value); } });
      draw();
    });
  }

  /* ---------- Settings row (next to the name) ---------- */
  function settingsName(body) {
    if (!A || !A.LIVE || off) return;
    var el = A.el;
    var box = el("div", { class: "ht-set" });
    body.appendChild(box);
    function paint() {
      box.innerHTML = "";
      var t = mine || "";
      box.appendChild(el("div", { class: "ht-set-row" }, [
        el("span", { class: "ht-set-l", text: L("📍 Hemstad: ", "📍 Home town: ") }),
        el("b", { class: "ht-set-v", text: t ? t + (label(t) && sv() ? " · " + label(t) : "") : L("int' vald", "not set") }),
        A.btn(t ? L("Ändra", "Change") : L("Välj", "Pick"), "btn-small ht-set-b", function () { open(); })
      ]));
    }
    try { mine = mine || U.ls.get(LS_TOWN, "") || null; } catch (e) {}
    paint();
    if (!loaded) load().then(function () { if (off) box.remove(); else if (document.body.contains(box)) paint(); });
  }

  /* ---------- One gentle prompt after the next level-up ---------- */
  var promptTimer = null;
  function afterLevelUp() {
    if (!A || !A.LIVE || off || promptTimer) return;
    if (mine || U.ls.get(LS_ASKED, "") === "1") return;
    try { U.ls.set(LS_ASKED, "1"); } catch (e) {}
    var tries = 0;
    function show() {
      promptTimer = null;
      if (mine) return;
      // Wait for the BEFORDRAN popup / takeover; never over the beer-type strip.
      if ((document.querySelector(".mx-pop, .takeover") && tries++ < 30)) { promptTimer = setTimeout(show, 2000); return; }
      if (window.OLNU_STRIP && window.OLNU_STRIP.up()) { window.OLNU_STRIP.after(show); return; }
      A.toast(L("📍 Ny grad! Var är du mest baserad? Visa gänget om du ä Ludvikabo eller Göteborgare.",
        "📍 New rank! Where are you based? Show your groups your home town."),
        { ms: 9000, action: { label: L("📍 Välj", "📍 Pick"), fn: function () { open(); } } });
    }
    promptTimer = setTimeout(show, 3500);
  }

  window.HOMETOWN = {
    label: label, towns: allTowns, mine: function () { return mine; }, open: open, afterLevelUp: afterLevelUp,
    DEMONYM: DEMONYM,
    init: function (api) { A = api; },
    onAuthed: function () { load(); },
    settingsName: function (body) { settingsName(body); }
  };
})();
