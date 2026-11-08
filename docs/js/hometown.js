/* PintsNow v25 — HEMSTAD ("Var är du mest baserad?"). Server: migration 0033 (set_home_town, my_home_town,
   group_status_v2 / chief_state .home_town, local_board_v2 / wall_of_fame_v2 .home_town).
   - nf 2026-11-07 picker v2: search field, "Nära dig" (5 nearest by the coarse position, never an automatic prompt),
     then A–Ö rows with letter heads. Old notes: the user picks a home town: searchable list (the 52 taxi towns + the CITIES list + a few more) or free text
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
    try { (window.TAXI_DATA && window.TAXI_DATA.towns || []).concat(window.TAXI_DATA && window.TAXI_DATA.places || []).forEach(function (c) { add(c.town); }); } catch (e) {}   // bold bd09: + places
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

  /* ---------- Picker v2 (nf 2026-11-07): search + "Nära dig" (sorted by distance) + A–Ö list ----------
     Owner: "my friend saw Ludvika first … sort by his location". Position: the app's last own position (A.lastLoc), a
     coarse one this picker got before (olnu.htPos, 1 decimal ≈ 10 km, 30 days), or — only when location is already
     allowed (permissions "granted") — a quiet low-accuracy fix. Otherwise ONE button asks; never an automatic prompt.
     Rows: .ht-row (name · demonym · km). CSS tokens --ht-* in hometown.css (design agent can restyle). */
  // Coordinates for the towns that CITIES / TAXI_DATA do not know.
  var XY = {
    "Leksand": [60.730, 14.999], "Rättvik": [60.887, 15.116], "Härnösand": [62.632, 17.938], "Kungsbacka": [57.487, 12.076],
    "Hudiksvall": [61.729, 17.104], "Grangärde": [60.266, 14.993], "Säfsnäs": [60.150, 14.420], "Nyhammar": [60.285, 14.971],
    "Fredriksberg": [60.141, 14.380], "Söderbärke": [60.066, 15.555], "Malung": [60.686, 13.715], "Älvdalen": [61.227, 14.040],
    "Sälen": [61.160, 13.265], "Norberg": [60.065, 15.924], "Lindesberg": [59.594, 15.230], "Kopparberg": [59.875, 14.998],
    "Gagnef (Djurås)": [60.561, 15.144]
  };
  var LS_POS = "olnu.htPos", NEAR_N = 5;
  function xyOf(n) {
    if (XY[n]) return XY[n];
    try { var c = (window.CITIES && window.CITIES.list || []).filter(function (x) { return x.name === n; })[0]; if (c) return [c.lat, c.lng]; } catch (e) {}
    try { var t = (window.TAXI_DATA && window.TAXI_DATA.towns || []).concat(window.TAXI_DATA && window.TAXI_DATA.places || []).filter(function (x) { return x.town === n; })[0];   // bold bd09: + places
    if (t && isFinite(t.lat)) return [t.lat, t.lng]; } catch (e) {}
    return null;
  }
  function kmTxt(m) { var k = m / 1000; return k < 10 ? (Math.round(k * 10) / 10).toString().replace(".", ",") + " km" : Math.round(k) + " km"; }
  function savedPos() {
    try { var p = U.ls.getJSON ? U.ls.getJSON(LS_POS, null) : JSON.parse(U.ls.get(LS_POS, "null")); if (p && isFinite(p.lat) && Date.now() - (p.at || 0) < 30 * 864e5) return p; } catch (e) {}
    return null;
  }
  function keepPos(lat, lng) {
    var p = { lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10, at: Date.now() };   // coarse, ≈ 10 km
    try { if (U.ls.setJSON) U.ls.setJSON(LS_POS, p); else U.ls.set(LS_POS, JSON.stringify(p)); } catch (e) {}
    return p;
  }
  function knownPos() {
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) return { lat: l.lat, lng: l.lng }; } catch (e) {}
    return savedPos();
  }
  function askPos(quiet) {
    return new Promise(function (res) {
      if (!navigator.geolocation) { res(null); return; }
      try {
        navigator.geolocation.getCurrentPosition(function (p) { res(keepPos(p.coords.latitude, p.coords.longitude)); },
          function () { res(null); }, { enableHighAccuracy: false, timeout: quiet ? 6000 : 12000, maximumAge: 30 * 60000 });
      } catch (e) { res(null); }
    });
  }
  function granted() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(false);
      return navigator.permissions.query({ name: "geolocation" }).then(function (p) { return p && p.state === "granted"; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function svSort(a, b) { return a.localeCompare(b, "sv"); }
  function fold(s) { return String(s || "").toLowerCase(); }
  function open(after) {
    if (!A) return;
    var el = A.el;
    A.openSheet(L("📍 Din hemstad", "📍 Your home town"), function (body) {
      body.classList.add("ht-sheet");
      body.appendChild(el("p", { class: "muted ht-info", text: L("Gänget ser en liten etikett vid ditt namn, t.ex. \"Stockholmare\". Bara dina grupper ser den.",
        "Your groups see a small label next to your name. Only your groups see it.") }));
      var inp = el("input", { class: "inp ht-inp", type: "search", maxlength: "30", autocomplete: "off", enterkeyhint: "done",
        placeholder: L("Sök stad", "Search town"), "aria-label": L("Sök stad", "Search town") });
      var cur = el("div", { class: "ht-cur" });
      var list = el("div", { class: "ht-list2", role: "listbox", "aria-label": L("Städer", "Towns") });
      body.appendChild(el("div", { class: "ht-search" }, [inp]));
      body.appendChild(cur); body.appendChild(list);
      var pos = knownPos(), asking = false;
      function pickIt(v) {
        var t = clean(v);
        if (!t) { A.toast(L("Skriv eller välj en stad.", "Type or pick a town."), { err: true }); return; }
        save(t, function () { A.closeSheet(); if (after) after(); });
      }
      function row(n, extra) {
        var sel = !!mine && mine.toLowerCase() === n.toLowerCase();
        var dem = KEYS[n.toLowerCase()] || "";
        var b = el("button", { type: "button", class: "ht-row" + (sel ? " on" : ""), role: "option", "aria-selected": String(sel) }, [
          el("span", { class: "ht-row-t" }, [el("span", { class: "ht-row-n", text: n }), dem ? el("small", { class: "ht-row-d", text: dem }) : null]),
          extra ? el("span", { class: "ht-row-k", text: extra }) : null,
          sel ? el("span", { class: "ht-row-c", "aria-hidden": "true", text: "✓" }) : null
        ]);
        b.addEventListener("click", function () { pickIt(n); });
        return b;
      }
      function head(txt, cls) { return el("div", { class: "ht-h" + (cls ? " " + cls : ""), role: "presentation", text: txt }); }
      function drawCur() {
        cur.innerHTML = "";
        if (!mine) return;
        cur.appendChild(el("div", { class: "ht-cur-row" }, [
          el("span", { class: "ht-cur-t", text: L("Vald: ", "Picked: ") + mine + (KEYS[mine.toLowerCase()] ? " · " + KEYS[mine.toLowerCase()] : "") }),
          A.btn(L("Ta bort", "Clear"), "btn-small ht-clear", function () { save("", function () { A.closeSheet(); if (after) after(); }); })
        ]));
      }
      function draw() {
        var q = fold(clean(inp.value)), towns = allTowns();
        list.innerHTML = "";
        if (q) {
          var hits = towns.filter(function (n) { return fold(n).indexOf(q) >= 0 || fold(KEYS[n.toLowerCase()]).indexOf(q) >= 0; })
            .sort(function (a, b) { return (fold(a).indexOf(q) === 0 ? 0 : 1) - (fold(b).indexOf(q) === 0 ? 0 : 1) || svSort(a, b); }).slice(0, 30);
          hits.forEach(function (n) { list.appendChild(row(n, pos && xyOf(n) ? kmTxt(U.haversine(pos.lat, pos.lng, xyOf(n)[0], xyOf(n)[1])) : "")); });
          var t = clean(inp.value), exact = hits.some(function (n) { return fold(n) === fold(t); });
          if (!exact) {
            if (valid(t)) {
              var f = el("button", { type: "button", class: "ht-row ht-free" }, [el("span", { class: "ht-row-t" }, [
                el("span", { class: "ht-row-n", text: L("Använd \"" + t + "\"", "Use \"" + t + "\"") }),
                el("small", { class: "ht-row-d", text: L("Etikett: ", "Label: ") + label(t) })])]);
              f.addEventListener("click", function () { pickIt(t); });
              list.appendChild(f);
            } else list.appendChild(el("p", { class: "muted ht-none", text: L("Bara bokstäver, siffror och - . ' ( ), max 30 tecken.", "Letters and digits only, max 30.") }));
          }
          return;
        }
        // Nära dig
        list.appendChild(head(L("Nära dig", "Near you"), "ht-h-near"));
        if (pos) {
          towns.map(function (n) { var c = xyOf(n); return c ? { n: n, d: U.haversine(pos.lat, pos.lng, c[0], c[1]) } : null; })
            .filter(Boolean).sort(function (a, b) { return a.d - b.d; }).slice(0, NEAR_N)
            .forEach(function (x) { list.appendChild(row(x.n, kmTxt(x.d))); });
        } else {
          var ask = el("button", { type: "button", class: "ht-row ht-ask" }, [el("span", { class: "ht-row-t" }, [
            el("span", { class: "ht-row-n", text: asking ? L("Letar…", "Locating…") : L("📍 Visa städer nära mig", "📍 Show towns near me") }),
            el("small", { class: "ht-row-d", text: L("Ungefärlig plats, bara för att sortera listan.", "Rough position, only to sort the list.") })])]);
          ask.disabled = asking;
          ask.addEventListener("click", function () {
            asking = true; draw();
            askPos(false).then(function (p) {
              asking = false; if (p) pos = p;
              if (!p) A.toast(L("Ingen plats. Välj i listan i stället.", "No position. Pick from the list."), { ms: 4000 });
              if (document.body.contains(list)) draw();
            });
          });
          list.appendChild(ask);
        }
        // A–Ö
        list.appendChild(head(L("Alla städer A–Ö", "All towns A–Z")));
        var last = "";
        towns.slice().sort(svSort).forEach(function (n) {
          var L1 = n.charAt(0).toLocaleUpperCase("sv-SE");
          if (L1 !== last) { last = L1; list.appendChild(head(L1, "ht-h-l")); }
          list.appendChild(row(n, ""));
        });
      }
      inp.addEventListener("input", draw);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); pickIt(inp.value); } });
      drawCur(); draw();
      // Location already allowed: a quiet coarse fix sorts "Nära dig" (no prompt can show in this state).
      if (!pos) granted().then(function (ok) {
        if (!ok) return;
        askPos(true).then(function (p) { if (p && !pos) { pos = p; if (document.body.contains(list) && !clean(inp.value)) draw(); } });
      });
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
