/* Öl Nu — 🔍 HITTA KOMPIS "Var ä du?" (CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS"). window.HITTA,
   in app.js mods(): init. No migration: it rides on 0047 find_* (near.js) and the visible map pins. No new button.
   Entry points: a friend row 🧭 (invite.js / near.js), Medlemmar "🧭 Hitta", the "🧭 Hitta nån" chooser (near.js) and the
   group page 🟢 NU strip (gpage.js → HITTA.nowSheet: "🗺️ Visa alla" + "🔍 Var ä du, Lisa?" per person out now).
   where(key, name):
   1. The friend's pin is on the map for me (group-mate, visible = not ghost / not stopped): close the sheet, fly there,
      a dashed line me → friend for 30 s, toast "📍 Lisa ä hä · 140 m ↗️ nordost · Pitchers" + "🧭 Kompass".
      "Bara område" pins say "ungefär" and never show a metre count.
   2. Else (or 🧭 Kompass): NEAR.openFinder(key, name) = the 0047 finder. It sends the find request; the friend gets the
      gentle push "👀 Anton letar efter dig" (notify-group "find": 1 per 30 s per sender, 3 per 30 min to the same person)
      and the compass (DeviceOrientation where allowed, else a north-up mini map) shows distance + arrow in the crowd. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, line = null, lineTm = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  var T = {
    found: ["📍 {n} ä hä · {d} {pil} {dir}", "📍 Spaning: {n} {d} {pil} {dir}", "📍 Målet lokaliserat: {n}, {d} {pil} {dir}", "📍 Där ä {n}! {d} {pil} {dir}"],
    approx: ["📍 {n} ä ungefär hä (bara område)", "📍 {n} visar bara området – ungefär hä nånstans", "📍 Ungefärlig position för {n}"],
    ask: ["👀 {n} delar int' platsen just nu. Vi frågar – hen får en knuff.", "👀 Ingen pin på {n}. Skickar en försiktig knuff…", "👀 {n} syns int' på kartan. Vi pingar hen."]
  };
  var DIRS = [["norr", "north"], ["nordost", "northeast"], ["öster", "east"], ["sydost", "southeast"], ["söder", "south"], ["sydväst", "southwest"], ["väster", "west"], ["nordväst", "northwest"]];
  var ARROWS = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];
  function bearing(a, b, c, d) {
    var r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function dist(d) { return d < 1000 ? Math.round(d / 5) * 5 + " m" : (d / 1000).toFixed(1).replace(".", sv() ? "," : ".") + " km"; }
  function ago(ts) { var m = Math.round((Date.now() - Date.parse(ts)) / 60000); return isFinite(m) ? (m < 1 ? L("nyss", "just now") : m + L(" min sen", " min ago")) : ""; }
  function pinOf(name) {
    if (!name || !A) return null;
    var best = null;
    (A.beers() || []).forEach(function (b) {
      if (b.is_mine || !b.friend_name || b.friend_name !== name) return;
      if (!best || Date.parse(b.updated_at || b.created_at) > Date.parse(best.updated_at || best.created_at)) best = b;
    });
    return best;
  }
  function finder(key, name) { try { if (window.NEAR && window.NEAR.openFinder) window.NEAR.openFinder(key, name); } catch (e) {} }
  function myPos() {
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return Promise.resolve(l); } catch (e) {}
    return new Promise(function (res) {
      try { A.getPosition().then(function (p) { var o = { lat: p.coords.latitude, lng: p.coords.longitude }; try { A.setLastLoc(o.lat, o.lng); } catch (e) {} res(o); }, function () { res(null); }); }
      catch (e) { res(null); }
    });
  }
  function where(key, name) {
    if (!A || !A.LIVE) return;
    var pin = pinOf(name);
    if (!pin) {
      A.toast(sv() ? fill(pick("a", T.ask), { n: name || "kompisen" }) : "👀 " + (name || "Your friend") + " is not on the map – sending a gentle ping.", { id: "ht", ms: 4000 });
      finder(key, name); return;
    }
    try { A.closeSheet(); } catch (e) {}
    try { A.map.closePopup(); } catch (e) {}
    var exact = pin.precise !== false && pin.snap !== "area";
    A.map.flyTo([pin.lat, pin.lng], Math.max(A.map.getZoom(), exact ? 17 : 15), { duration: 0.9 });
    myPos().then(function (me) {
      var txt;
      if (!exact) txt = sv() ? fill(pick("ap", T.approx), { n: name }) : "📍 " + name + " is roughly here (area only)";
      else if (me) {
        var d = U.haversine(me.lat, me.lng, pin.lat, pin.lng), i = Math.round(bearing(me.lat, me.lng, pin.lat, pin.lng) / 45) % 8;
        txt = sv() ? fill(pick("f", T.found), { n: name, d: dist(d), pil: ARROWS[i], dir: DIRS[i][0] }) : "📍 " + name + " · " + dist(d) + " " + ARROWS[i] + " " + DIRS[i][1];
        drawLine(me, pin);
      } else txt = "📍 " + name;
      if (pin.bar_id && window.BARS && window.BARS.byId) { var bb = window.BARS.byId(pin.bar_id); if (bb && bb.name) txt += " · " + bb.name; }
      A.toast(txt, { id: "ht", ms: 9000, action: { label: L("🧭 Kompass", "🧭 Compass"), fn: function () { finder(key, name); } } });
    });
  }
  function drawLine(me, pin) {
    var Lf = window.L; if (!Lf || !A.map) return;
    try { if (line) line.remove(); } catch (e) {}
    clearTimeout(lineTm);
    line = Lf.polyline([[me.lat, me.lng], [pin.lat, pin.lng]], { color: "#ffd23f", weight: 3, opacity: 0.9, dashArray: "4 8", interactive: false }).addTo(A.map);
    lineTm = setTimeout(function () { try { if (line) line.remove(); } catch (e) {} line = null; }, 30000);
  }
  // group page 🟢 NU strip: returns true when it handled the tap.
  function nowSheet(g, out, showAll) {
    if (!A || !A.LIVE || !g || !g.id) return false;
    var others = (out || []).filter(function (p) { return !p.me && p.name; });
    if (!others.length) return false;
    A.openSheet(L("🟢 Ute nu i ", "🟢 Out now in ") + (g.name || L("gruppen", "the group")), function (body) {
      var el = A.el;
      body.appendChild(el("div", { class: "row" }, [A.btn(L("🗺️ Visa alla på kartan (", "🗺️ Show all on the map (") + (out || []).length + ")", "btn-block", function () { showAll(); })]));
      var ul = el("ul", { class: "ht-list" });
      body.appendChild(ul);
      var keys = {};
      others.forEach(function (p) {
        var b = A.btn(L("🔍 Var ä du, ", "🔍 Where are you, ") + p.name + "?", "btn-block ht-b", function () {
          var k = keys[p.name];
          if (k) where("g" + g.id + ":" + k, p.name); else { var pin = pinOf(p.name); if (pin) where(null, p.name); }
        });
        var li = el("li", {}, [b, el("small", { class: "muted", text: (p.place ? "📍 " + p.place + " · " : "") + (p.at ? ago(p.at) : "") })]);
        ul.appendChild(li);
        try { if (window.FRIENDS2 && window.FRIENDS2.nowRow) window.FRIENDS2.nowRow(g, p, li); } catch (e) {}   // friends2
      });
      body.appendChild(el("p", { class: "muted", text: L("🔒 Syns bara om kompisen delar sin pin. Annars får hen en försiktig knuff och kan välja själv.",
        "🔒 Only when your friend shares the pin. Otherwise they get a gentle ping and choose.") }));
      A.rpc("group_status_v2", { p_group_id: g.id }).then(function (r) {
        ((r && r.data) || []).forEach(function (m) { if (m && m.name && m.k && !m.is_me) keys[m.name] = m.k; });
      });
    });
    return true;
  }
  window.HITTA = {
    init: function (api) { A = api; },
    where: where, nowSheet: nowSheet, _pinOf: pinOf
  };
})();
