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
  /* hitta2 (I-92, I-93): calm compass helpers for the finder sheet (near.js openFinder uses HITTA.calm).
     heading(e, so): one tilt-compensated compass heading from a deviceorientation(absolute) event, or null.
       iOS: webkitCompassHeading (iOS compensates tilt); webkitCompassAccuracy < 0 = invalid.
       Android absolute: the W3C rotation (alpha, beta, gamma) → the horizontal part of the top edge + the back camera
       direction (flat: top edge, upright: back), then + the screen orientation angle.
     headingFilter(): circular low-pass (angle step along the shortest way, time based, tau 0.35 s; 0.12 s for a real steady turn, max 250°/s), drops a single
       outlier (> 60° off for one sample), ignores bad iOS accuracy (> 30°) while a good sample is < 3 s old,
       noisy() = circular std dev > 25° over 2 s (calibrate hint).
     unwrap(last, target): the rendered angle never goes the long way round (delta in (-180, 180]).
     posFilter(): ignores a fix with acc > 60 m when a fix ≤ 60 m is < 30 s old; 1/acc² weighted mean of the last 4 fixes in 20 s (target: 3 in 13 s).
     finder(st, d): the finder sheet's compass part (one stream, smoothing, Live / Senast sedd, Nära, lock line, 10 fps arrow).
     near(d, a, b): true under max(20, min(50, √(a²+b²))) m (enter), with 30 % hysteresis to leave. */
  var CALM = (function () {
    var R = Math.PI / 180;
    function norm(h) { h = h % 360; return h < 0 ? h + 360 : h; }
    function delta(a, b) { var d = norm(b - a); return d > 180 ? d - 360 : d; }   // b - a in (-180, 180]
    function unwrap(last, target) { return last == null || !isFinite(last) ? target : last + delta(last, target); }
    function heading(e, so) {
      if (!e) return null;
      var h = null, acc = null;
      if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) {
        acc = typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null;
        if (acc != null && acc < 0) return null;
        h = e.webkitCompassHeading;
      } else if ((e.absolute || e.type === "deviceorientationabsolute") && typeof e.alpha === "number" && isFinite(e.alpha)) {
        var a = e.alpha * R, b = (+e.beta || 0) * R, g = (+e.gamma || 0) * R;
        var cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
        var tx = -sA * cB, ty = cA * cB;                                   // top edge, horizontal part
        var bx = -cA * sG - sA * sB * cG, by = -sA * sG + cA * sB * cG;     // back camera, horizontal part (W3C compassHeading)
        var x = tx + bx, y = ty + by;
        if (x * x + y * y < 1e-6) return null;
        h = Math.atan2(x, y) / R;
      }
      if (h == null || !isFinite(h)) return null;
      return { h: norm(h + (+so || 0)), acc: acc };
    }
    function headingFilter() {
      // Angle low-pass along the shortest way (a sin/cos mean flips at once for a 180° change), max 250°/s.
      var cur = null, at = 0, goodAt = 0, out = null, raw = [];
      function value() { return cur; }
      return {
        push: function (s, now) {
          if (!s) return value();
          now = now == null ? Date.now() : now;
          if (s.acc != null && s.acc > 30 && now - goodAt < 3000) return value();
          if (s.acc == null || s.acc <= 30) goodAt = now;
          raw.push({ h: s.h, t: now }); while (raw.length && now - raw[0].t > 2000) raw.shift();
          var dt = Math.min(0.1, Math.max(0.005, (now - at) / 1000)); at = now;   // since the last sample (also a dropped one)
          if (cur == null) { cur = norm(s.h); return cur; }
          var d = delta(cur, s.h);
          if (Math.abs(d) > 60) {
            // One far sample = an outlier. A second one on the same side = a real turn: follow fast.
            if (!out || now - out.t > 1000 || Math.abs(delta(out.h, s.h)) > 30) { out = { h: s.h, t: now }; return cur; }
          }
          var steady = out && Math.abs(d) > 25; out = Math.abs(d) > 60 ? out : null;
          var step = d * (1 - Math.exp(-dt / (steady ? 0.12 : 0.35))), cap = 250 * dt;
          cur = norm(cur + Math.max(-cap, Math.min(cap, step)));
          return cur;
        },
        value: value,
        noisy: function (now) {
          now = now == null ? Date.now() : now;
          var a = raw.filter(function (r) { return now - r.t <= 2000; });
          if (a.length < 8) return false;
          var c = 0, s = 0; a.forEach(function (r) { c += Math.cos(r.h * R); s += Math.sin(r.h * R); });
          var Rl = Math.sqrt(c * c + s * s) / a.length;
          return Math.sqrt(-2 * Math.log(Math.max(1e-9, Rl))) / R > 25;
        }
      };
    }
    function posFilter(o) {
      var fx = [], WIN = (o && o.win) || 20000, N = (o && o.n) || 4;
      return {
        push: function (p, now) {
          if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return this.value();
          now = now == null ? Date.now() : now;
          var acc = isFinite(p.acc) && p.acc > 0 ? p.acc : 30;
          fx = fx.filter(function (f) { return now - f.t <= 30000; });
          if (acc > 60 && fx.some(function (f) { return f.acc <= 60; })) return this.value();
          fx.push({ lat: p.lat, lng: p.lng, acc: acc, t: now });
          fx = fx.filter(function (f) { return now - f.t <= WIN; }).slice(-N);
          return this.value();
        },
        value: function () {
          if (!fx.length) return null;
          var w = 0, la = 0, ln = 0;
          fx.forEach(function (f) { var q = 1 / Math.pow(Math.max(5, f.acc), 2); w += q; la += f.lat * q; ln += f.lng * q; });
          var last = fx[fx.length - 1];
          return { lat: la / w, lng: ln / w, acc: Math.min.apply(null, fx.map(function (f) { return f.acc; })), t: last.t };
        },
        reset: function () { fx = []; }
      };
    }
    function nearLimit(a, b) { return Math.max(20, Math.min(50, Math.sqrt((+a || 0) * (+a || 0) + (+b || 0) * (+b || 0)))); }
    function near(d, a, b, was) { if (d == null || !isFinite(d)) return false; var t = nearLimit(a, b); return d < (was ? t * 1.3 : t); }
    function ago(s, sv) {
      s = Math.max(0, s | 0);
      if (s < 60) return sv ? "för " + s + " s sedan" : s + " s ago";
      var m = Math.round(s / 60);
      return sv ? "för " + m + " min sedan" : m + " min ago";
    }
    return { heading: heading, headingFilter: headingFilter, posFilter: posFilter, unwrap: unwrap, delta: delta, near: near, nearLimit: nearLimit, ago: ago };
  })();
  // The finder's compass part. near.js openFinder keeps the sheet, the GPS watch and the pings; this smooths and draws.
  // d = { el, L, sv, bearing }. Adds st.nearEl / st.lockEl / st.calEl; st.heading, st.me, st.near are set here.
  function calmFinder(st, d) {
    var C = CALM, headingFilter = C.headingFilter, posFilter = C.posFilter, heading = C.heading, unwrap = C.unwrap, near = C.near, ago = C.ago;
    var hf = headingFilter(), pfMe = posFilter(), pfT = posFilter({ win: 13000, n: 3 }), U = window.U || {};
    var rot = null, nrot = null, rs = "", ns = "", key = null, absSeen = false, L = d.L;
    st.near = false;
    st.nearEl = d.el("div", { class: "nr-near", hidden: "", "aria-live": "polite" });
    st.lockEl = d.el("p", { class: "nr-lock muted", hidden: "", text: L("Du kan låsa skärmen – vi visar var du var senast.", "You can lock the screen – we show where you were last.") });
    st.calEl = d.el("p", { class: "nr-cal muted", hidden: "", text: L("Kalibrera kompassen: rör telefonen i en åtta.", "Calibrate the compass: move the phone in a figure 8.") });
    function hav(a, b) { return U.haversine(a.lat, a.lng, b.lat, b.lng); }
    return {
      // One stream only: some Android phones (Samsung) fire both events with other frames → alternating headings.
      ori: function (e) {
        var ios = typeof e.webkitCompassHeading === "number";
        if (e.type === "deviceorientationabsolute") absSeen = true; else if (absSeen && !ios) return false;
        var so = 0; try { so = (screen.orientation && screen.orientation.angle) || window.orientation || 0; } catch (x) {}
        var smp = heading(e, so); if (!smp) return false;
        st.heading = hf.push(smp); st.headingAt = Date.now(); return true;
      },
      fix: function (p) { var m = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; st.me = pfMe.push(m) || m; },
      wake: function () { pfMe.reset(); },
      // Server target → smoothed while live (< 20 s); the last fix the server keeps for this find as it is ("Senast sedd").
      target: function (t) {
        var live = t.live !== false && (t.age_s | 0) <= 20, tg = { lat: t.lat, lng: t.lng, acc: t.acc }, k = t.lat + "," + t.lng;
        st.tgtSeen = Date.now() - (t.age_s | 0) * 1000;
        if (!live) { pfT.reset(); key = null; }
        if (k !== key) { key = k; tg = pfT.push(tg) || tg; } else tg = pfT.value() || tg;
        return { lat: tg.lat, lng: tg.lng, acc: tg.acc, age_s: t.age_s | 0, live: live, bar: t.bar || null };
      },
      // Status lines. Returns false when there is no target yet (near.js then shows its waiting texts).
      view: function (s, req) {
        st.lockEl.hidden = !(req.mine === false && (s === "accepted" || s === "auto"));
        if (!(st.tgt && st.me)) { ["live", "stale", "near"].forEach(function (c) { st.dial.classList.remove(c); }); st.near = false; st.nearEl.hidden = true; return false; }
        var acc = Math.round(Math.max(st.me.acc || 0, st.tgt.acc || 0)), dn = hav(st.me, st.tgt), m = Math.round(dn);
        // Owner 17:48: the arrow always stays; close by (< 20 m or < the GPS error) add "Nära! Titta runt".
        st.near = near(dn, st.me.acc, st.tgt.acc, st.near);
        st.distEl.textContent = st.near ? "~" + m + " m" : m + " m" + (acc ? " ±" + acc : "");
        st.nearEl.hidden = !st.near;
        if (st.near) st.nearEl.textContent = L("Nära! Titta runt · ~" + m + " m", "Close! Look around · ~" + m + " m");
        var age = Math.max(0, Math.round((Date.now() - (st.tgtSeen || Date.now())) / 1000)), live = st.tgt.live !== false && age <= 20;
        var at = st.tgt.bar ? L(" vid " + st.tgt.bar, " at " + st.tgt.bar) : "", a = ago(age, d.sv());
        st.statusEl.textContent = live ? L("Live – " + st.name + " har kompassen öppen", "Live – " + st.name + " has the compass open")
          : L("Senast sedd" + at + " " + a, "Last seen" + at + " " + a);
        st.dial.classList.toggle("live", live);
        st.dial.classList.toggle("stale", age >= 300);
        return true;
      },
      // Unwrapped angles: the CSS glide never goes the long way round (359° → 1° = +2°, not -358°). Called at max 10 fps.
      arrow: function () {
        if (!st.arrow) return;
        var have = st.tgt && st.me, comp = st.heading != null && Date.now() - st.headingAt < 5000;
        st.arrow.classList.toggle("on", !!have);
        st.calEl.hidden = !(comp && hf.noisy());
        if (!have) return;
        var b = d.bearing(st.me.lat, st.me.lng, st.tgt.lat, st.tgt.lng);
        // With compass: arrow relative to where the phone points. Without: north-up (N mark at the top).
        rot = unwrap(rot, comp ? b - st.heading : b); nrot = unwrap(nrot, comp ? -st.heading : 0);
        var r = "rotate(" + rot.toFixed(1) + "deg)", n = "rotate(" + nrot.toFixed(1) + "deg)";
        if (r !== rs) { rs = r; st.arrow.style.transform = r; }
        if (st.nmark && n !== ns) { ns = n; st.nmark.style.transform = n; }
        st.dial.classList.toggle("nocomp", !comp);
        st.dial.classList.toggle("near", !!st.near);
      }
    };
  }
  CALM.finder = calmFinder;
  window.HITTA = {
    init: function (api) { A = api; },
    where: where, nowSheet: nowSheet, _pinOf: pinOf, calm: CALM
  };
})();
