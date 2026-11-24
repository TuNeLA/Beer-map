/* PintsNow — BARSEARCH (lane barsearch, owner I-126, 16 Nov 2026): search for a bar by name on the map. window.BARSEARCH.
   Owner: "I'm in Stockholm and I want to go to a certain bar and I have a hard time finding it on the map."
   - A 44 px rail button (magnifier) under ⋯ Mer (#pn-search, 4th rail slot; the count button #pn-mine moves one slot down).
   - Tap = a compact panel at the TOP (the keyboard never covers the field): "Sök bar eller ställe", keyboard at once.
   - While typing (200 ms): OUR spots first = BARS.each(): every bar of bars.json (the whole country, so Stockholm works from
     Ludvika, also offline) + the loaded place tiles. Case + accent free (ö = o, å = a, é = e), prefix / word prefix
     ("pitch" finds "Pitchers"), several words in any order, a word may name the town ("pitchers stockholm").
     Sort: match quality, then distance (from me, else the map centre). Row: town · distance · "N här nu" (people now,
     PNCROWD.count, totals only, never names).
   - Few own hits (< 3): places from PN.placeSearch.query (Mapbox live; Nominatim only on a tap / Enter, its usage policy
     forbids search-as-you-type), marked "plats". A "plats" pick flies there, loads the place tiles around it, and opens
     the card when the app knows a spot with that name there; else a short-lived marker (8 s).
   - Pick = the map goes there and opens the bar card (app openBar, the same as a pin tap). Reduced motion = a jump.
   - "Senaste": the last 6 picks on this phone (localStorage, names + coordinates only), shown while the field is empty.
   - Close: ✕, Esc, Android back, or a tap on the dimmed map. That tap is eaten by the scrim: it never reaches the map.
   - Store builds: the same. No drinking words: a count of people is information only.
   Texts: tl(sv, en) here (i18n.js is at its quality limit). CSS: docs/barsearch.css. Test: tests/e2e/barsearch-pw.js.
   I-132 beer library (lane beerui, owner default A24 "C"): tabs "Krogar | Öl" under the field (.ds-seg, the last tab is remembered on
   this phone). Öl = js/beerlib.js tab(): taste chips, style cards, beers; typing finds styles and beers. The Öl tab does not open the
   keyboard by itself (browse with one hand). PN.beerlib() = the ONE loader of the beer files (beerlib.js + beerlib-pages.js + beerlib.css,
   on demand; profile.js, placecard.js and dm.js call it too). Test: tests/e2e/beerui-pw.js. */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "olnu.barsearch.recent", TAB_KEY = "olnu.barsearch.tab", BEER_MS = 150, MAX_RECENT = 6, TYPE_MS = 200, PLACE_MS = 350, FEW = 3, MAX_OWN = 12, MARK_MS = 8000, NEAR_M = 150;
  var A = null, btn = null, ui = null, seq = 0, tType = 0, tPlace = 0, tBtn = 0, hist = 0, selfBack = null, mark = null, sheetMo = null;
  var st = { q: "", own: [], places: null, placeQ: "", placeBusy: false, placeErr: false, tab: "bars" }, tBeer = 0, beerP = null;

  function tl(sv, en) { return W.I18N && W.I18N.lang === "en" ? en : sv; }
  function ic(n) { return W.PNI && W.PNI.svg ? W.PNI.svg(n) : ""; }
  function mk(tag, cls, txt) { var e = D.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function reduced() { try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function online() { return !(W.navigator && W.navigator.onLine === false); }

  /* ---------- matching ---------- */
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/['’`´]/g, "").replace(/&/g, " och ").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function startsWord(words, t) { for (var i = 0; i < words.length; i++) if (words[i].indexOf(t) === 0) return true; return false; }
  // 3 = the name or its start · 2 = a word of the name starts with it (all words, any order) · 1 = inside the name · 0 = no
  function score(nm, q, qt, townN) {
    if (!nm || !q) return 0;
    if (nm.indexOf(q) === 0) return 3;
    var w = nm.split(" "), c = nm.replace(/ /g, ""), cq = q.replace(/ /g, "");
    if (qt.length === 1) {
      if (startsWord(w, q) || c.indexOf(cq) === 0) return 2;
      return q.length >= 3 && c.indexOf(cq) >= 0 ? 1 : 0;
    }
    var inName = 0, inTown = 0, tw = townN ? townN.split(" ") : [];
    for (var i = 0; i < qt.length; i++) { if (startsWord(w, qt[i])) inName++; else if (startsWord(tw, qt[i])) inTown++; else return c.indexOf(cq) >= 0 ? 1 : 0; }
    return inName ? 2 : 0;
  }
  function town(b) {
    if (b._bsT === undefined) { var c = null; try { c = W.CITIES && W.CITIES.nearest(b.lat, b.lng); } catch (e) {} b._bsT = c ? c.name : ""; }
    return b._bsT;
  }
  function origin() {
    var p = null; try { p = A && A.lastLoc ? A.lastLoc() : null; } catch (e) {}
    if (p && isFinite(p.lat) && isFinite(p.lng)) return { lat: +p.lat, lng: +p.lng, me: true };
    try { var c = A.map.getCenter(); return { lat: c.lat, lng: c.lng, me: false }; } catch (e) { return null; }
  }
  function dist(o, b) { return o && W.U ? W.U.haversine(o.lat, o.lng, b.lat, b.lng) : 0; }
  // our own spots that match q: [{ bar, s, d }], best first
  function ownHits(q) {
    var B = W.BARS, out = [], qn = norm(q); if (!B || !B.each || !qn) return out;
    var qt = qn.split(" "), o = origin(), seen = {};
    B.each(function (b) {
      if (b._bsRaw !== b.name) { b._bsRaw = b.name; b._bsN = norm(b.name); }
      var s = score(b._bsN, qn, qt, qt.length > 1 ? norm(town(b)) : ""); if (!s) return;
      out.push({ bar: b, s: s, d: dist(o, b) });
    });
    out.sort(function (a, b) { return b.s - a.s || a.d - b.d; });
    return out.filter(function (h) {   // the same name at the same spot twice (a bar + a place tile): once
      var k = h.bar._bsN + "@" + Math.round(h.bar.lat * 1000) + "," + Math.round(h.bar.lng * 1000);
      if (seen[k]) return false; seen[k] = 1; return true;
    }).slice(0, MAX_OWN);
  }
  // a known spot with this name at (lat, lng): a bar or a loaded place within maxM, nearest first
  function findOwn(name, lat, lng, maxM) {
    var B = W.BARS, n = norm(name); if (!B || !B.around || !n) return null;
    var r = B.around(lat, lng, maxM || NEAR_M), l = r.bars.concat(r.places), best = null;
    l.forEach(function (x) { var xn = norm(x.bar.name); if ((xn === n || xn.indexOf(n) === 0 || n.indexOf(xn) === 0) && (!best || x.d < best.d)) best = x; });
    return best ? best.bar : null;
  }

  /* ---------- text for a row ---------- */
  function km(m) {
    if (!(m >= 0)) return "";
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " m";
    var k = m < 10000 ? (Math.round(m / 100) / 10).toFixed(1) : String(Math.round(m / 1000));
    return (W.I18N && W.I18N.lang === "en" ? k : k.replace(".", ",")) + " km";
  }
  function peopleNow(per, cis, bar) {
    try {
      var agg = per[String(bar.id)], pins = agg ? agg.beers : [];
      return W.PNCROWD && W.PNCROWD.count ? W.PNCROWD.count(bar, pins, cis) : pins.length;
    } catch (e) { return 0; }
  }
  function crowd() {
    var per = {}, cis = [];
    try { per = W.BARS.assign(A.beers() || []).perBar || {}; } catch (e) {}
    try { cis = (A.checkins && A.checkins()) || []; } catch (e) {}
    return { per: per, cis: cis };
  }
  function iconOf(b) { return b.place ? "food" : b.arena ? "ticket" : "beer"; }

  /* ---------- recent picks (this phone only) ---------- */
  function recentGet() {
    var l = []; try { l = JSON.parse(W.localStorage.getItem(KEY) || "[]"); } catch (e) { l = []; }
    return (Array.isArray(l) ? l : []).filter(function (r) { return r && typeof r.n === "string" && isFinite(r.lat) && isFinite(r.lng); }).slice(0, MAX_RECENT);
  }
  function remember(h) {
    var r = { n: String(h.title).slice(0, 80), lat: +(+h.lat).toFixed(5), lng: +(+h.lng).toFixed(5), k: h.bar ? "b" : "p" };
    var l = recentGet().filter(function (x) { return !(norm(x.n) === norm(r.n) && Math.abs(x.lat - r.lat) < 0.002 && Math.abs(x.lng - r.lng) < 0.004); });
    l.unshift(r);
    try { W.localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX_RECENT))); } catch (e) {}
  }

  /* ---------- the map side ---------- */
  function goTo(lat, lng, z) {
    var m = A && A.map; if (!m) return;
    try { if (reduced()) m.setView([lat, lng], z, { animate: false }); else m.flyTo([lat, lng], z, { duration: 0.9 }); } catch (e) {}
  }
  function openOwn(bar) {
    if (!bar || !A || !A.openBar) return;
    var m = A.map;
    if (reduced() && m) { try { m.setView([bar.lat, bar.lng], Math.max(m.getZoom(), 17), { animate: false }); } catch (e) {} }   // a jump, then the card
    A.openBar(bar);
  }
  function unmark() { if (!mark) return; clearTimeout(mark.t); try { mark.m.remove(); } catch (e) {} mark = null; }
  function dropMark(lat, lng, title) {
    unmark();
    var L = W.L, m = A && A.map; if (!L || !m || !L.marker || !L.divIcon) return;
    try {
      var icon = L.divIcon({ className: "bs-mark" + (reduced() ? " bs-still" : ""), html: "<i></i>", iconSize: [32, 32], iconAnchor: [16, 30] });
      var mm = L.marker([lat, lng], { icon: icon, interactive: false, keyboard: false, title: title || "" }).addTo(m);
      mark = { m: mm, t: setTimeout(unmark, MARK_MS) };
    } catch (e) { mark = null; }
  }
  function goPlace(h) {
    goTo(h.lat, h.lng, 16);
    var known = findOwn(h.title, h.lat, h.lng);
    if (known) { openOwn(known); return; }
    dropMark(h.lat, h.lng, h.title);
    var B = W.BARS; if (!B || !B.ensurePlacesP) return;
    B.ensurePlacesP(h.lat, h.lng, 0.5, 4000).then(function () {   // the tiles there are in: the card when the app knows the spot
      var b = findOwn(h.title, h.lat, h.lng); if (b) { unmark(); openOwn(b); }
    });
  }
  function go(h) {
    if (h.bar) { openOwn(h.bar); return; }
    if (h.recent && h.k === "b") {
      var b = findOwn(h.title, h.lat, h.lng, 120); if (b) { openOwn(b); return; }
    }
    goPlace(h);
  }

  /* ---------- place search (Mapbox / Nominatim through PN.placeSearch) ---------- */
  function PS() { return W.PN && W.PN.placeSearch; }
  function liveEngine() { var p = PS(); try { return !!(p && p.engine && p.engine() === "mapbox"); } catch (e) { return false; } }
  function runPlaces(q) {
    var p = PS(); q = String(q || "").trim();
    if (!p || !p.query || q.length < 3 || !online()) return;
    var my = ++seq, o = origin();
    st.placeQ = q; st.placeBusy = true; st.placeErr = false; st.places = null; paint();
    p.query(q, { center: o ? { lat: o.lat, lng: o.lng } : null }).then(function (l) {
      if (my !== seq || !ui) return;
      st.placeBusy = false;
      st.places = (l || []).filter(function (x) {   // a place that IS one of our hits: once (ours)
        return !st.own.some(function (h) { return dist(h.bar, x) < NEAR_M && norm(h.bar.name).indexOf(norm(x.title).split(" ")[0]) >= 0; });
      }).slice(0, 5);
      paint();
    }, function () { if (my !== seq || !ui) return; st.placeBusy = false; st.placeErr = true; paint(); });
  }

  /* ---------- the panel ---------- */
  function row(h, sub, icon, tag) {
    var b = mk("button", "bs-hit"); b.type = "button"; b.setAttribute("role", "option");
    var t = mk("span", "bs-ic"); t.innerHTML = ic(icon); t.setAttribute("aria-hidden", "true"); b.appendChild(t);
    var tx = mk("span", "bs-tx"), nm = mk("b", "bs-t", h.title);
    tx.appendChild(nm);
    if (sub || tag) {
      var s = mk("small", "bs-s");
      if (tag) s.appendChild(mk("span", "bs-tag", tag));
      if (sub) s.appendChild(D.createTextNode(sub));
      tx.appendChild(s);
    }
    b.appendChild(tx);
    b.addEventListener("click", function () { pick(h); });
    var li = mk("li"); li.appendChild(b); return li;
  }
  function ownRow(x, cr, o) {
    var b = x.bar, bits = [], n = peopleNow(cr.per, cr.cis, b), tn = town(b);
    if (tn) bits.push(tn);
    if (o) bits.push(km(x.d));
    var wt = o && o.me && W.WALKTIME ? W.WALKTIME.short(b) : "";   // lane walktime (E6): "ca 8 min", only with a good position
    if (wt) bits.push(wt);
    var li = row({ bar: b, title: b.name, lat: b.lat, lng: b.lng }, bits.join(" · "), iconOf(b));
    if (n > 0) {
      var s = li.querySelector(".bs-s") || li.querySelector(".bs-tx").appendChild(mk("small", "bs-s"));
      var p = mk("span", "bs-now"); p.appendChild(mk("i", "bs-dot")); p.appendChild(D.createTextNode(tl(n + " här nu", n + " here now")));
      s.appendChild(p);
    }
    return li;
  }
  function head(txt) { var h = mk("li", "bs-h", txt); h.setAttribute("role", "presentation"); return h; }
  function say(txt, cls) { ui.msg.textContent = txt || ""; ui.msg.className = "bs-msg" + (cls ? " " + cls : ""); ui.msg.hidden = !txt; }
  function paintRecent() {
    var l = recentGet(), nb = W.WALKTIME && W.WALKTIME.near ? W.WALKTIME.near() : [];
    if (!l.length && !nb.length) { say(tl("Skriv namnet på en krog eller ett ställe.", "Type the name of a bar or a place.")); return; }
    say("");
    if (l.length) ui.list.appendChild(head(tl("Senaste", "Recent")));
    l.forEach(function (r) {
      var h = { title: r.n, lat: r.lat, lng: r.lng, recent: true, k: r.k }, tn = "";
      try { var c = W.CITIES && W.CITIES.nearest(r.lat, r.lng); tn = c ? c.name : ""; } catch (e) {}
      ui.list.appendChild(row(h, tn, "history"));
    });
    // lane walktime (E6): bars within 10 min on foot (on-phone estimate, only with a good position), under "Senaste"
    if (nb.length) {
      ui.list.appendChild(head(tl("Inom 10 min promenad", "Within a 10 min walk")));
      nb.forEach(function (x) { ui.list.appendChild(row({ bar: x.bar, title: x.bar.name, lat: x.bar.lat, lng: x.bar.lng }, [town(x.bar), x.label].filter(Boolean).join(" · "), iconOf(x.bar))); });
    }
  }
  function paintPlaces() {
    if (!online()) { if (!st.own.length) say(tl("Du är offline. Bara krogar som appen redan känner.", "You are offline. Only bars the app already knows."), "bs-off"); return; }
    if (st.places && st.placeQ === st.q) {
      if (st.places.length) {
        ui.list.appendChild(head(tl("Platser", "Places")));
        st.places.forEach(function (p) { ui.list.appendChild(row({ title: p.title, lat: p.lat, lng: p.lng }, p.sub || "", "pin", tl("plats", "place"))); });
      } else if (!st.own.length) say(tl("Hittade inget med det namnet.", "Nothing found with that name."));
      return;
    }
    if (st.placeBusy) { say(tl("Söker platser …", "Searching places …")); return; }
    if (st.placeErr) { say(tl("Sökningen gick int'. Försök igen.", "Search failed. Try again."), "bs-err"); }
    if (liveEngine() || st.q.length < 3) { if (!st.own.length && st.q.length < 3) say(tl("Skriv minst 3 tecken.", "Type at least 3 letters.")); return; }
    var b = mk("button", "bs-more"); b.type = "button";
    b.innerHTML = ic("search") + "<span></span>"; b.lastChild.textContent = tl("Sök bland platser: “" + st.q + "”", "Search places: “" + st.q + "”");
    b.addEventListener("click", function () { runPlaces(st.q); });
    var li = mk("li"); li.appendChild(b); ui.list.appendChild(li);
    if (!st.own.length && !st.placeErr) say(tl("Ingen krog i appen med det namnet.", "No bar in the app with that name."));
  }
  function paint() {
    if (!ui) return;
    ui.list.innerHTML = ""; say("");
    ui.clear.hidden = !ui.input.value;
    if (!st.q) { paintRecent(); fit(); return; }
    var cr = crowd(), o = origin();
    st.own.forEach(function (x) { ui.list.appendChild(ownRow(x, cr, o)); });
    if (st.own.length < FEW) paintPlaces();
    fit();
  }
  function onType() {
    clearTimeout(tType); clearTimeout(tPlace);
    ui.clear.hidden = !ui.input.value; camShow();
    if (st.tab === "beer") { clearTimeout(tBeer); tBeer = setTimeout(paintBeer, BEER_MS); return; }
    tType = setTimeout(function () {
      var q = String(ui.input.value || "").trim();
      if (q === st.q && st.own) return;
      st.q = q; st.own = q ? ownHits(q) : []; st.places = null; st.placeErr = false; st.placeBusy = false; seq++;
      paint();
      if (q.length >= 3 && st.own.length < FEW && liveEngine() && online()) tPlace = setTimeout(function () { runPlaces(q); }, PLACE_MS);
    }, TYPE_MS);
  }
  function onEnter() {
    clearTimeout(tType);
    if (st.tab === "beer") { clearTimeout(tBeer); paintBeer(); try { ui.input.blur(); } catch (e) {} return; }
    var q = String(ui.input.value || "").trim(); if (!q) return;
    if (q !== st.q) { st.q = q; st.own = ownHits(q); st.places = null; }
    var first = st.own[0] ? { bar: st.own[0].bar, title: st.own[0].bar.name, lat: st.own[0].bar.lat, lng: st.own[0].bar.lng } : null;
    if (!first && st.places && st.places[0]) first = { title: st.places[0].title, lat: st.places[0].lat, lng: st.places[0].lng };
    if (first) { pick(first); return; }
    runPlaces(q);
  }
  // the list ends above the keyboard (visualViewport), never under it
  function fit() {
    if (!ui) return;
    try {
      var vv = W.visualViewport, h = vv ? vv.height + vv.offsetTop : W.innerHeight, top = ui.list.getBoundingClientRect().top;
      ui.list.style.maxHeight = Math.max(120, Math.floor(h - top - 12)) + "px";
      if (!ui.beer.hidden) ui.beer.style.maxHeight = Math.max(160, Math.floor(h - ui.beer.getBoundingClientRect().top - 8)) + "px";
    } catch (e) {}
  }
  function build() {
    var scrim = mk("div", "bs-scrim"); scrim.id = "bs-scrim"; scrim.setAttribute("aria-hidden", "true");
    var box = mk("div", "bs-panel"); box.id = "bs-panel";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", tl("Sök krog", "Search bar"));
    var bar = mk("div", "bs-bar"), lab = mk("label", "bs-field"), lic = mk("span", "bs-lic"), input = mk("input", "bs-input");
    lic.innerHTML = ic("search"); lic.setAttribute("aria-hidden", "true");
    input.type = "search"; input.id = "bs-q"; input.setAttribute("enterkeyhint", "search"); input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off"); input.setAttribute("spellcheck", "false"); input.setAttribute("aria-controls", "bs-list");
    input.placeholder = tl("Sök bar eller ställe", "Search bar or place"); input.setAttribute("aria-label", input.placeholder);
    var clear = mk("button", "bs-clear"); clear.type = "button"; clear.hidden = true; clear.innerHTML = ic("x"); clear.setAttribute("aria-label", tl("Rensa", "Clear"));
    var x = mk("button", "bs-close"); x.type = "button"; x.textContent = tl("Stäng", "Close");
    // I-140 (lane beerscan): the camera button = scan a beer (barcode, else the label text). Öl tab + empty field only (the ✕ takes its place).
    var cam = mk("button", "bs-clear bs-cam"); cam.type = "button"; cam.id = "bs-cam"; cam.hidden = true; cam.innerHTML = ic("camera");
    cam.setAttribute("aria-label", tl("Skanna en öl med kameran", "Scan a beer with the camera")); cam.title = cam.getAttribute("aria-label");
    cam.addEventListener("click", function (e) { e.preventDefault(); scan(); });
    lab.appendChild(lic); lab.appendChild(input); lab.appendChild(clear); lab.appendChild(cam); bar.appendChild(lab); bar.appendChild(x);
    var msg = mk("p", "bs-msg"); msg.setAttribute("role", "status"); msg.hidden = true;
    var list = mk("ul", "bs-list"); list.id = "bs-list"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", tl("Träffar", "Results"));
    var tabs = mk("div", "ds-seg bs-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", tl("Sök efter", "Search for"));
    [["bars", tl("Krogar", "Bars")], ["beer", tl("Öl", "Beers")]].forEach(function (t) {
      var b = mk("button", null, t[1]); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("data-bs-tab", t[0]); b.id = "bs-tab-" + t[0];
      b.addEventListener("click", function () { setTab(t[0], true); });
      tabs.appendChild(b);
    });
    var beer = mk("div", "bl-in-bs"); beer.id = "bs-beer"; beer.setAttribute("role", "tabpanel"); beer.setAttribute("aria-labelledby", "bs-tab-beer"); beer.hidden = true;
    box.appendChild(bar); box.appendChild(tabs); box.appendChild(msg); box.appendChild(list); box.appendChild(beer);
    // One click router: the tap on the dimmed map closes the panel and is eaten here (it never selects a map feature).
    scrim.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); close(); });
    ["pointerdown", "touchstart", "mousedown", "wheel"].forEach(function (t) { scrim.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
    x.addEventListener("click", function () { close(); });
    clear.addEventListener("click", function () { input.value = ""; st.q = ""; st.own = []; st.places = null; if (st.tab === "beer") paintBeer(); else paint(); try { input.focus(); } catch (e) {} });
    input.addEventListener("input", onType);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); onEnter(); } });
    return { scrim: scrim, box: box, input: input, list: list, msg: msg, clear: clear, tabs: tabs, beer: beer, cam: cam };
  }
  function onKey(e) { if (e.key === "Escape" && ui) { e.preventDefault(); close(); } }
  function onVV() { fit(); }
  function onPop(e) {
    if (selfBack) { var f = selfBack; selfBack = null; f(); return; }
    if (ui && !(e.state && e.state.pnBs)) { hist = 0; close(); }
  }
  function open(tab, q) {   // q: the words to put back in the field (I-139 back from a beer page)
    if (ui) { if (tab) setTab(tab, false); return; }
    if (!A) return;
    try { if (A.sheetOpen && A.sheetOpen()) A.closeSheet(); } catch (e) {}
    ui = build();
    st.q = ""; st.own = []; st.places = null; st.placeBusy = false; st.placeErr = false;
    if (q && tab === "beer") { ui.input.value = q; ui.clear.hidden = false; }
    D.body.appendChild(ui.scrim); D.body.appendChild(ui.box); D.body.classList.add("bs-on");
    if (btn) btn.setAttribute("aria-expanded", "true");
    var t0 = tab === "beer" || tab === "bars" ? tab : lsTab();
    setTab(t0, false);
    if (t0 === "bars") { try { ui.input.focus({ preventScroll: true }); } catch (e) { try { ui.input.focus(); } catch (x) {} } }   // in the tap: the keyboard opens at once
    D.addEventListener("keydown", onKey, true);
    if (W.visualViewport) W.visualViewport.addEventListener("resize", onVV);
    try { var hs = history.state || {}; hist = Date.now(); history.pushState({ pnBs: hist, olnuNav: typeof hs.olnuNav === "number" ? hs.olnuNav : 0 }, ""); } catch (e) { hist = 0; }
    if (W.MutationObserver) {   // the app opens a sheet on its own: the panel gives way
      var sh = D.getElementById("sheet");
      if (sh) { sheetMo = new MutationObserver(function () { if (!sh.hidden) close(); }); sheetMo.observe(sh, { attributes: true, attributeFilter: ["hidden"] }); }
    }
  }
  function close(after) {
    if (!ui) { if (after) after(); return; }
    clearTimeout(tType); clearTimeout(tPlace); clearTimeout(tBeer); seq++;
    try { ui.input.blur(); } catch (e) {}
    ui.scrim.remove(); ui.box.remove(); ui = null; D.body.classList.remove("bs-on");
    if (sheetMo) { sheetMo.disconnect(); sheetMo = null; }
    D.removeEventListener("keydown", onKey, true);
    if (W.visualViewport) W.visualViewport.removeEventListener("resize", onVV);
    if (btn) btn.setAttribute("aria-expanded", "false");
    var hs = null; try { hs = history.state; } catch (e) {}
    var then = after || function () { try { if (btn) btn.focus({ preventScroll: true }); } catch (e) {} };
    if (hist && hs && hs.pnBs === hist) {   // our own history step goes first (a new sheet's step must not be undone by it)
      hist = 0;
      var done = false, fin = function () { if (done) return; done = true; selfBack = null; then(); };
      selfBack = fin; setTimeout(fin, 450);
      try { history.back(); } catch (e) { fin(); }
    } else { hist = 0; then(); }
  }
  function pick(h) {
    remember(h);
    close(function () { go(h); });
  }

  /* ---------- I-132: the Öl tab + the ONE beer-library loader ---------- */
  function lsTab() { try { return W.localStorage.getItem(TAB_KEY) === "beer" ? "beer" : "bars"; } catch (e) { return "bars"; } }
  function setTab(t, user) {
    if (!ui) return;
    st.tab = t === "beer" ? "beer" : "bars";
    if (user) { try { W.localStorage.setItem(TAB_KEY, st.tab); } catch (e) {} }
    [].forEach.call(ui.tabs.children, function (b) { var on = b.getAttribute("data-bs-tab") === st.tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    var beer = st.tab === "beer";
    ui.box.classList.toggle("bs-beer-on", beer);
    ui.list.hidden = beer; ui.beer.hidden = !beer;
    ui.input.placeholder = beer ? tl("Sök öl, bryggeri eller stil", "Search beer, brewery or style") : tl("Sök bar eller ställe", "Search bar or place");
    ui.input.setAttribute("aria-label", ui.input.placeholder); ui.input.setAttribute("aria-controls", beer ? "bs-beer" : "bs-list");
    ui.box.setAttribute("aria-label", beer ? tl("Sök öl", "Search beer") : tl("Sök krog", "Search bar"));
    camShow();
    if (beer) { say(""); paintBeer(); } else { st.q = ""; onType(); paint(); }
  }
  function paintBeer() {
    if (!ui || st.tab !== "beer") return;
    var box = ui.beer, q = String(ui.input.value || "").trim();
    loadBeer().then(function (L) { if (ui && ui.beer === box && st.tab === "beer") { L.tab(box, String(ui.input.value || "").trim(), { beer: fromBeer(L, "beer"), style: fromBeer(L, "style") }); fit(); } }, function () {
      if (!ui || ui.beer !== box) return;
      box.innerHTML = ""; var p = mk("p", "bs-msg bs-err", tl("Ölen gick inte att ladda. Försök igen.", "Could not load the beers. Try again.")); p.setAttribute("role", "status"); box.appendChild(p);
    });
    if (!W.BEERLIB && !box.firstChild) { var p = mk("p", "bs-msg", tl("Laddar ölen …", "Loading the beers …")); p.setAttribute("role", "status"); box.appendChild(p); }
    st.q = q; camShow(); fit();
  }
  /* I-140 (lane beerscan): the beer scanner. js/beerscan-match.js + js/beerscan.js + beerscan.css load on the first tap only. */
  function camShow() { if (ui && ui.cam) ui.cam.hidden = !(st.tab === "beer" && !ui.input.value); }
  function loadScan() {
    var ld = W.PN && PN.load;
    if (W.BEERSCAN && W.BEERSCAN_MATCH) return Promise.resolve(W.BEERSCAN);
    if (!ld) return Promise.reject(new Error("no loader"));
    var href = lazyRef(/beerscan\.css/, 'link[rel="x-lazy-css"],link[rel="stylesheet"]', "href", "./beerscan.css");
    if (!D.querySelector('link[rel="stylesheet"][href="' + href + '"]')) { var l = D.createElement("link"); l.rel = "stylesheet"; l.href = href; D.head.appendChild(l); }
    return ld(lazyRef(/js\/beerscan-match\.js/, 'script[type="text/x-lazy"]', "src", "./js/beerscan-match.js"), { test: function () { return !!W.BEERSCAN_MATCH; } })
      .then(function () { return ld(lazyRef(/js\/beerscan\.js/, 'script[type="text/x-lazy"]', "src", "./js/beerscan.js"), { test: function () { return !!W.BEERSCAN; } }); })
      .then(function () { return W.BEERSCAN; });
  }
  function scan() {
    if (!ui) return;
    var box = ui.box, back = function () { try { if (ui && ui.cam && !ui.cam.hidden) ui.cam.focus({ preventScroll: true }); } catch (e) {} };
    Promise.all([loadBeer(), loadScan()]).then(function (r) {
      if (!ui || ui.box !== box) return;
      r[1].open({ openBeer: function (id) { if (r[0].beer) r[0].beer(id); }, back: back,
        fill: function (q) { if (!ui) return; ui.input.value = q || ""; st.q = ""; onType(); try { ui.input.focus({ preventScroll: true }); } catch (e) {} } });
    }, function () { say(tl("Skannern gick inte att ladda. Försök igen.", "Could not load the scanner. Try again."), "bs-err"); });
  }
  // I-139: a beer or style page opened from the Öl tab gets a back (‹) to this tab: the same words in the field, the same
  // scroll place (js/sheetnav.js from(): the sheet's bottom level reopens the panel). Taste chip + "show more" live in BEERLIB.
  function fromBeer(L, kind) {
    return function (id) {
      var keep = ui ? { q: String(ui.input.value || ""), top: ui.beer.scrollTop } : null;
      try { if (keep && W.SHEETNAV && W.SHEETNAV.from) W.SHEETNAV.from(function () { reopenBeer(keep); }); } catch (e) {}
      L[kind](id);
    };
  }
  function reopenBeer(keep) {
    if (ui) return;
    open("beer", keep.q);
    if (!ui) return;
    var box = ui.beer, n = 0;
    (function put() {   // the list paints when the beer files are in (at once: they are loaded)
      if (!ui || ui.beer !== box) return;
      if (box.scrollHeight - box.clientHeight < keep.top && n++ < 10) { setTimeout(put, 50); return; }
      box.scrollTop = keep.top;
    })();
  }
  function lazyRef(re, sel, attr, def) {
    var n = null; try { n = [].filter.call(D.querySelectorAll(sel), function (x) { return re.test(x.getAttribute(attr) || ""); })[0]; } catch (e) {}
    return n ? n.getAttribute(attr) : def;
  }
  function beerCss() {
    var href = lazyRef(/beerlib\.css/, 'link[rel="x-lazy-css"],link[rel="stylesheet"]', "href", "./beerlib.css");
    if (D.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    var l = D.createElement("link"); l.rel = "stylesheet"; l.href = href; D.head.appendChild(l);
  }
  // PN.beerlib() -> Promise<BEERLIB with pages>. Uses the stamped src from index.html when it is there (x-lazy data-demand).
  function loadBeer() {
    beerCss();
    if (W.BEERLIB && W.BEERLIB.beer) return Promise.resolve(W.BEERLIB);
    if (beerP) return beerP;
    var ld = W.PN && PN.load;
    if (!ld) return Promise.reject(new Error("no loader"));
    beerP = ld(lazyRef(/js\/beerlib\.js/, 'script[type="text/x-lazy"]', "src", "./js/beerlib.js"), { test: function () { return !!W.BEERLIB; } })
      .then(function () { return ld(lazyRef(/js\/beerlib-pages\.js/, 'script[type="text/x-lazy"]', "src", "./js/beerlib-pages.js"), { test: function () { return !!(W.BEERLIB && W.BEERLIB.beer); } }); })
      .then(function () { return W.BEERLIB; });
    beerP.catch(function () { beerP = null; });
    return beerP;
  }
  if (W.PN) PN.beerlib = loadBeer;

  /* ---------- the rail button ---------- */
  function railBtn() {
    if (btn && btn.isConnected) return true;
    var more = D.getElementById("btn-more"); if (!more || !more.parentNode) return false;
    btn = D.getElementById("pn-search");
    if (!btn) {
      btn = mk("button", "pn-rail pn-search"); btn.type = "button"; btn.id = "pn-search";
      btn.setAttribute("aria-label", tl("Sök krog", "Search bar")); btn.title = btn.getAttribute("aria-label");
      btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = ic("search") + '<span class="mn-rail-l" aria-hidden="true"></span>';
      btn.lastChild.textContent = tl("Sök", "Search");
      btn.addEventListener("click", function () { open(); });
    }
    more.parentNode.insertBefore(btn, more.nextSibling);
    return true;
  }
  function start() {
    if (railBtn()) return;
    var n = 0; clearInterval(tBtn);
    tBtn = setInterval(function () { if (railBtn() || ++n > 60) clearInterval(tBtn); }, 500);
  }

  W.BARSEARCH = {
    init: function (api) { A = api; start(); W.addEventListener("popstate", onPop); },
    open: open, close: close,
    // tests
    _norm: norm, _own: function (q) { return ownHits(q).map(function (h) { return { name: h.bar.name, s: h.s, d: Math.round(h.d), id: String(h.bar.id) }; }); },
    _state: function () { return { open: !!ui, q: st.q, own: st.own.length, places: st.places ? st.places.length : null, recent: recentGet(), mark: !!mark, tab: st.tab }; }
  };
  if (W.PN) PN.mod("BARSEARCH");
})();
