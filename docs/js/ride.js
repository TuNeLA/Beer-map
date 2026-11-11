/* PintsNow — RIDE v2 (lane ride, F1, 2026-11-10; research scratchpad/research/F1-ride.md; migration 0420). window.RIDE.
   "Hämta mig" like Uber, for friends. Started by js/skjuts.js (SKJUTS.init → RIDE.init(api, hooks)); no app.js hook.
   OFF unless the server says ride_flags_get().ride_v2 = true (missing RPC / old server / flag off = today's skjuts.js).
   1 Request: one sheet — where (my position or a point picked on the map), how many, a short note → ride_request.
     Server picks the receivers: everyone in all my groups + all my friends with "Jag kör ikväll", minus anyone who
     pressed ÖL! tonight, minus ghost drivers, minus blocked.
   2 Driver push: notify-group {event:"pickup", req_id, ride:1} (safety class, outside the night budget; all facts in the
     text, iOS has no buttons and cannot update a sent push). Tap → the offer card [Jag tar den] [Kan int'].
     Android buttons open /?pickup=<id>&ride=ta|nej: the card opens and does that answer.
   3 First accept wins on the server (ride_take, one atomic UPDATE). The others see "Oskar tog den ✓" in the card.
   4 Live: the requester gets the driver card (avatar, car note, ETA, steps Tagen → På väg → Framme → Klar, 1-tap chat) and
     the driver's live pin on the map, ONLY while the ride is active. The driver's app sends its position every 10 s
     (ride_pos) only while it drives this ride and is not in ghost mode; it stops at Klar / cancel.
   5 No answer (flag ride_v2_more): 5 min → [Fråga igen] [Fråga fler]; 10 min (or all said no) → the taxi card with the
     verified numbers (BOLD_TAXI / TAXI_DATA, B2).
   6 Both can cancel (the driver backing out = the others are asked again). Klar → "Tack! Skål" + Kvällens chaufför.
   Copy: DIALEKT keys ride.* (sv-neutral pack registered below). Styles: ride.css (prefix rd-). 112: one small muted link at the bottom of the sheet (owner 11 Nov). */
(function () {
  "use strict";
  var U = window.U;
  var A = null, HK = {}, flags = null, flagsAt = 0, R = null, skew = 0, off = false;
  var box = null, view = null, tick = 0, posT = 0, posBusy = false, pend = {}, pick = null, form = null, mk = { drv: null, pk: null };
  var FLAGS_MS = 600000, POS_MS = 10000;
  var STEPS = ["taken", "enroute", "arrived", "done"];

  /* ---------- copy (sv-neutral; the dialect lane adds regions) ---------- */
  var P = {
    "ride.title": "Hämta mig", "ride.title.drive": "Du kör", "ride.title.offer": "Skjuts?",
    "ride.lead": "Frågan går till alla i dina gäng och vänner som kör ikväll. Ingen som tryckt ÖL! får den.",
    "ride.112": "Akut fara? Ring 112",
    "ride.where": "Var ä du?", "ride.here": "Där jag ä", "ride.pick": "Välj på kartan", "ride.pax": "Hur många?",
    "ride.note": "Nåt mer?", "ride.note.ph": "t.ex. vid kebaben", "ride.send": "Skicka", "ride.sending": "Skickar…",
    "ride.priv": "Bara den som tar körningen ser exakt var du ä. Bilens position syns bara för dig, bara under körningen.",
    "ride.pos.wait": "Hämtar din position…", "ride.pos.none": "Ingen position. Välj på kartan.",
    "ride.pick.lead": "Dra kartan så nålen står där du ska hämtas.", "ride.pick.ok": "Hämta mig här", "ride.pick.cancel": "Avbryt",
    "ride.wait": "Väntar på chaufför", "ride.asked": ["{n} tillfrågade", "{n} har fått frågan"], "ride.no": "{n} kan int'",
    "ride.since": "Skickad för {m} min sen", "ride.none": "Ingen kör ikväll just nu.", "ride.allno": "Alla har sagt nej.",
    "ride.again": "Fråga igen", "ride.wide": "Fråga fler", "ride.wide.sub": "Alla vänner som int' druckit, även de som int' kör.",
    "ride.taxi": "Ta en taxi", "ride.taxi.map": "Hitta taxi nära dig", "ride.cancel": "Avbryt förfrågan",
    "ride.taken": "{name} tar dig!", "ride.enroute": "{name} ä på väg", "ride.arrived": "{name} ä framme",
    "ride.eta": "ca {m} min · {km} km", "ride.waited": "Väntat {m} min", "ride.stale": "{name} verkar int' ha åkt än.",
    "ride.car.check": "Kolla att det ä rätt bil.", "ride.car.none": "Ingen bil angiven",
    "ride.step.taken": "Tagen", "ride.step.enroute": "På väg", "ride.step.arrived": "Framme", "ride.step.done": "Klar",
    "ride.map": "Visa på kartan", "ride.route": "Vägen dit", "ride.done.rider": "Jag sitter i bilen",
    "ride.done": ["Hemma snart. Snyggt jobbat, {name}!", "Framme! {name} levererade."], "ride.thanks": "Tack! Skål",
    "ride.thanks.sent": "Skål skickad till {name}", "ride.cancelled": "Avbrutet. Ingen ser nåns position längre.",
    "ride.expired": "Ingen hann svara. Ta en taxi eller fråga igen.",
    "ride.offer.lead": "{name} behöver skjuts", "ride.offer.from": "Från {place} · {pax} pers", "ride.offer.ago": "Frågade för {m} min sen",
    "ride.take": "Jag tar den", "ride.decline": "Kan int'", "ride.tookit": "{name} tog den ✓", "ride.tookit.me": "Du tog den",
    "ride.declined": "Du sa nej. Ändrat dig? Du kan fortfarande ta den.", "ride.gone": "{name} behöver int' skjuts längre.",
    "ride.excluded": "Du släppte den. Vi frågar de andra.",
    "ride.drunk": "Du har tryckt ÖL! ikväll. Kör int' bil.", "ride.drunk.off": "Stäng av Jag kör",
    "ride.drive.lead": "Du kör {name}", "ride.drive.go": "På väg", "ride.drive.at": "Framme", "ride.drive.done": "Klar",
    "ride.drive.letgo": "Släpp den", "ride.drive.share": "{name} ser din bil på kartan tills ni ä klara.",
    "ride.drive.ghost": "Du ä i spökläge: {name} ser int' din bil. Tryck På väg och Framme själv.",
    "ride.drive.donehead": "Kvällens chaufför", "ride.drive.donesub": ["Snyggt! {n} körning ikväll.", "Hjälte. {n} körning ikväll."],
    "ride.drive.thanked": "{name} säger: Tack! Skål",
    "ride.chat.ph": "Skriv…", "ride.chat.send": "Skicka", "ride.q1": "Kommer ut nu", "ride.q2": "2 min", "ride.q3": "Var ä du?", "ride.q4": "Tack!",
    "ride.toast.offer": "{name} behöver skjuts · {place}", "ride.toast.taken": "{name} tar dig! Spänn fast dig.",
    "ride.toast.arrived": "{name} ä framme. Kolla att det ä rätt bil.", "ride.toast.gone": "{name} behöver int' skjuts längre.",
    "ride.toast.redisp": "{name} kunde int'. Vi frågar de andra.", "ride.toast.sent": "Skickat till {n}. Håll appen öppen.",
    "ride.toast.sent0": "Ingen kör ikväll just nu. Kolla taxi.",
    "ride.chip.wait": "Hämta mig · väntar", "ride.chip.live": "{name} kör dig", "ride.chip.offer": "{name} behöver skjuts", "ride.chip.drive": "Du kör {name}",
    "ride.car.label": "Bil (syns bara för den du kör)", "ride.car.ph": "t.ex. Röd Volvo V70 · ABC 123", "ride.car.saved": "Bilen sparad.",
    "ride.err": "Det gick int'. Försök igen.", "ride.err.slow": "Vänta en liten stund innan du frågar igen.",
    "ride.err.pos": "Vi vet int' var du ä. Välj på kartan.", "ride.err.drinking": "Du har tryckt ÖL! ikväll. Någon annan får köra."
  };
  function reg() { try { if (window.DIALEKT && window.DIALEKT.register) { window.DIALEKT.register("sv-neutral", P); return true; } } catch (e) {} return false; }
  reg();
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (_m, k) { return v && v[k] != null ? String(v[k]) : ""; }); }
  function T(k, v) {
    try { if (window.DIALEKT && window.DIALEKT.t) { var r = window.DIALEKT.t(k, v); if (r && r !== k) return r; } } catch (e) {}
    var d = P[k]; if (Array.isArray(d)) d = d[0]; return fill(d == null ? k : d, v);
  }

  /* ---------- small helpers ---------- */
  function esc(s) { return U.esc(s); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function missing(e) { var m = String((e && (e.code || "")) + " " + (e && e.message || "")); return /PGRST202|42883|does not exist|Could not find the function/i.test(m); }
  function call(name, params) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, error: { message: "no_api" } });
    return A.rpc(name, params || {}).then(function (r) { r = r || { error: { message: "error" } }; if (r.error && missing(r.error)) { off = true; flags = {}; } return r; });
  }
  function data(r) { return r && !r.error ? A.parseData(r.data) : null; }
  function errText(e) {
    var m = String((e && e.message) || "");
    if (/slow_down/.test(m)) return T("ride.err.slow");
    if (/no_position|invalid_position/.test(m)) return T("ride.err.pos");
    return T("ride.err");
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function ic(name, cls) { try { return window.PNI ? window.PNI.svg(name, cls || "") : ""; } catch (e) { return ""; } }
  function icEl(name, cls) { return h("span", { class: "rd-ic " + (cls || ""), "aria-hidden": "true", html: ic(name) }); }
  function now() { return Date.now() + skew; }
  function mins(iso) { var t = Date.parse(iso); return isFinite(t) ? Math.max(0, Math.floor((now() - t) / 60000)) : 0; }
  function km(m) { return (Math.round((m || 0) / 100) / 10).toFixed(1).replace(".", ","); }
  function push(id) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", { event: "pickup", req_id: id, ride: 1 }); } catch (e) {} }
  function ghost() { try { if (window.EXTRAS && window.EXTRAS.ghostOn) return !!window.EXTRAS.ghostOn(); return localStorage.getItem("olnu.ghostMode") === "1"; } catch (e) { return false; } }
  function myName() { try { return (A.getName && A.getName()) || null; } catch (e) { return null; } }
  function more() { return !!(R && R.more); }
  function initial(n) { return String(n || "?").trim().charAt(0).toUpperCase() || "?"; }
  function face(name, spec, cls) {
    var f = h("span", { class: "rd-face " + (cls || ""), "aria-hidden": "true" });
    var s = ""; try { if (spec && window.AVATAR && window.AVATAR.svg) s = window.AVATAR.svg(spec, { small: true }); } catch (e) { s = ""; }
    if (typeof s === "string" && s.indexOf("<svg") >= 0) f.innerHTML = s; else { f.classList.add("rd-face-i"); f.textContent = initial(name); }
    return f;
  }
  function placeOf(lat, lng) {
    try { if (window.BARS && window.BARS.describe) { var d = window.BARS.describe({ precise: true, lat: lat, lng: lng }); if (d && d.name) return (d.kind === "near" ? "nära " : "") + d.name; } } catch (e) {}
    return "";
  }
  function fix(ms) { return HK.fix ? HK.fix(ms) : Promise.resolve(null); }

  /* ---------- flags + data ---------- */
  function loadFlags(force) {
    if (off || !A || !A.LIVE) return Promise.resolve(flags);
    if (!force && flags && Date.now() - flagsAt < FLAGS_MS) return Promise.resolve(flags);
    flagsAt = Date.now();
    return call("ride_flags_get").then(function (r) {
      var d = data(r); flags = d && typeof d === "object" ? d : {};
      if (!on()) { R = null; syncMap(); }
      return flags;
    });
  }
  function on() { return !off && !!(flags && flags.ride_v2); }
  function pollArgs() {
    var a = { p_lat: null, p_lng: null, p_ghost: ghost() };
    try { if (HK.driving && HK.driving()) { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) { a.p_lat = +(+l.lat).toFixed(3); a.p_lng = +(+l.lng).toFixed(3); } } } catch (e) {}
    return a;
  }
  function onData(r) {
    if (!r || !r.on) { R = null; if (r && r.on === false) flags = Object.assign({}, flags || {}, { ride_v2: false }); syncMap(); stopPos(); return; }
    var prev = R; R = r;
    if (r.now) { var t = Date.parse(r.now); if (isFinite(t)) skew = t - Date.now(); }
    announce(prev, r);
    syncMap(); syncPos(); repaint();
    if (want) openId(want);
  }
  function live() { return !!(R && ((R.mine && R.mine.live) || (R.drive && R.drive.live) || (R.offers || []).some(function (x) { return x.live && x.can_take; }))); }
  function find(id) {
    if (!R) return null; id = String(id);
    if (R.mine && String(R.mine.id) === id) return R.mine;
    if (R.drive && String(R.drive.id) === id) return R.drive;
    return (R.offers || []).filter(function (x) { return String(x.id) === id; })[0] || null;
  }
  function merge(x) {   // a fresh row from an action RPC (same shape as the poll)
    if (!x || !x.id) return; R = R || { on: true, offers: [] };
    if (x.role === "rider") R.mine = x; else if (x.role === "taker") { R.drive = x; R.offers = (R.offers || []).filter(function (o) { return o.id !== x.id; }); }
    else { var f = false; R.offers = (R.offers || []).map(function (o) { if (o.id === x.id) { f = true; return x; } return o; }); if (!f) R.offers.unshift(x); }
    if (x.role !== "taker" && R.drive && R.drive.id === x.id && x.role === "asked") R.drive = null;
    syncMap(); syncPos(); repaint();
  }
  function refresh() { return HK.force ? HK.force() : Promise.resolve(); }

  /* ---------- toasts on news (once per thing, kept 2 days) ---------- */
  function announce(prev, r) {
    var seen = lsGet("olnu.rdSeen", {}) || {}, t = Date.now(), ch = false;
    Object.keys(seen).forEach(function (k) { if (t - seen[k] > 2 * 864e5) { seen[k] = undefined; ch = true; } });
    seen = JSON.parse(JSON.stringify(seen));
    function once(k, fn) { if (seen[k]) return; seen[k] = t; ch = true; fn(); }
    (r.offers || []).forEach(function (x) {
      if (!x.live || !x.can_take || x.my_declined || r.drinking) return;
      once("o" + x.id + ":" + x.round, function () {
        A.toast(T("ride.toast.offer", { name: x.name, place: x.place || "" }).replace(/ · $/, ""), { id: "rd-o-" + x.id, ms: 15000, urgent: true, cls: "rd-toast",
          action: { label: "Visa", fn: function () { openId(x.id); } } });
        try { if (window.FX && window.FX.vibrate) window.FX.vibrate([30, 60, 30]); } catch (e) {}
      });
    });
    var m = r.mine;
    if (m && m.live && m.taker_name) {
      if (m.status === "taken" || m.status === "enroute") once("t" + m.id + ":" + m.taker_name, function () { A.toast(T("ride.toast.taken", { name: m.taker_name }), { id: "rd-m", ms: 8000, urgent: true }); });
      if (m.status === "arrived") once("a" + m.id + ":" + m.taker_name, function () { A.toast(T("ride.toast.arrived", { name: m.taker_name }), { id: "rd-m", ms: 10000, urgent: true }); });
    }
    if (m && m.live && m.status === "open" && m.round > 1 && m.step_at && m.step_at.redispatch && prev && prev.mine && prev.mine.id === m.id && prev.mine.taker_name)
      once("r" + m.id + ":" + m.round, function () { A.toast(T("ride.toast.redisp", { name: prev.mine.taker_name }), { id: "rd-m", ms: 8000 }); });
    var d = r.drive;
    if (d && d.status === "cancelled") once("c" + d.id, function () { A.toast(T("ride.toast.gone", { name: (d.rider && d.rider.name) || "" }), { id: "rd-d", ms: 8000 }); });
    if (ch) lsSet("olnu.rdSeen", seen);
  }

  /* ---------- map: the driver's live pin (rider) / the pickup pin (taker). No CSS transitions on markers. ---------- */
  function marker(key, lat, lng, cls, label, html) {
    var map = A && A.map, L = window.L;
    if (!map || !L) return;
    if (lat == null || !isFinite(+lat)) { if (mk[key]) { try { map.removeLayer(mk[key]); } catch (e) {} mk[key] = null; } return; }
    if (mk[key]) { try { mk[key].setLatLng([+lat, +lng]); } catch (e) {} return; }
    try {
      if (map.getPane && !map.getPane("ride")) { map.createPane("ride"); map.getPane("ride").style.zIndex = 725; }
      mk[key] = L.marker([+lat, +lng], { pane: "ride", keyboard: true, title: label, zIndexOffset: 9500,
        icon: L.divIcon({ className: "rd-mk", iconSize: [0, 0], iconAnchor: [0, 0], html: '<div class="rd-pin ' + cls + '">' + html + "</div>" }) }).addTo(map);
      mk[key].on("click", function () { var x = (R && (R.mine || R.drive)); if (x) openId(x.id); });
    } catch (e) { mk[key] = null; }
  }
  function syncMap() {
    var m = R && R.mine, d = R && R.drive, dr = m && m.live && m.driver && m.driver.lat != null ? m.driver : null;
    marker("drv", dr ? dr.lat : null, dr ? dr.lng : null, "rd-pin-car", dr ? dr.name : "", ic("taxi") + "<b>" + esc(dr ? String(dr.name).slice(0, 18) : "") + "</b>");
    var pk = d && d.live && d.pk_lat != null ? d : null;
    marker("pk", pk ? pk.pk_lat : null, pk ? pk.pk_lng : null, "rd-pin-pk", pk ? (pk.rider && pk.rider.name) : "", ic("pin") + "<b>" + esc(pk && pk.rider ? String(pk.rider.name).slice(0, 18) : "") + "</b>");
  }

  /* ---------- the taker's position (only this ride, only while live, never in ghost mode) ---------- */
  function syncPos() {
    var d = R && R.drive, go = !!(d && d.live && d.status !== "open" && !ghost());
    if (!go) { stopPos(); return; }
    if (posT) return;
    var step = function () {
      posT = setTimeout(step, POS_MS);
      var x = R && R.drive; if (!x || !x.live || ghost()) { stopPos(); return; }
      if (document.hidden || posBusy) return;
      posBusy = true;
      fix(6000).then(function (p) {
        if (!p || !(R && R.drive && R.drive.live)) { posBusy = false; return; }
        return call("ride_pos", { p_id: x.id, p_lat: p.lat, p_lng: p.lng }).then(function (r) {
          posBusy = false; var j = data(r);
          if (j && j.status && R && R.drive && R.drive.id === x.id && j.status !== R.drive.status) { R.drive.status = j.status; if (j.status === "arrived") push(x.id); repaint(); }
        });
      }).catch(function () { posBusy = false; });
    };
    step();
  }
  function stopPos() { if (posT) { clearTimeout(posT); posT = 0; } }

  /* ---------- sheets ---------- */
  function sheet(title, kind, id) {
    A.openSheet(title, function (body) {
      box = h("div", { class: "rd" }); view = { kind: kind, id: id };
      body.appendChild(box);
      // followups (owner 11 Nov): no big 112 at the top (a pickup is not an emergency); one small muted link at the bottom
      body.appendChild(h("p", { class: "rd-112f" }, [h("a", { class: "rd-112f-a", href: "tel:112", text: T("ride.112") })]));
      paint();
    });
    clearInterval(tick); tick = setInterval(function () { if (!box || !document.body.contains(box)) { clearInterval(tick); tick = 0; return; } if (view && view.kind !== "req") paint(); }, 30000);
  }
  function repaint() { if (box && document.body.contains(box) && view && view.kind !== "req") paint(); }
  function paint() {
    if (!box || !view) return;
    if (view.kind === "req") return paintReq();
    var x = find(view.id); box.innerHTML = "";
    if (!x) { box.appendChild(h("p", { class: "rd-muted", text: T("ride.cancelled") })); return; }
    if (x.role === "rider") paintRider(x); else if (x.role === "taker") paintTaker(x); else paintOffer(x);
    if (pend[x.id]) { var a = pend[x.id]; pend[x.id] = null; if (a === "ta" && x.role === "asked" && x.can_take) take(x); else if (a === "nej" && x.role === "asked" && x.live) decline(x); }
  }
  function openReq(opts) {
    if (!on()) return false;
    var m = R && R.mine;
    if (m && m.live) { openId(m.id); return true; }
    var keep = !!(opts && opts.keep && form);
    if (!keep) form = { pax: (form && form.pax) || 1, note: (form && form.note) || "", where: "here", lat: null, lng: null, place: "" };
    sheet(T("ride.title"), "req", null);
    if (!keep) locate();
    return true;
  }
  function locate() {
    form.lat = null; form.lng = null; form.place = ""; form.loading = true; paintReq();
    var l = null; try { l = A.lastLoc && A.lastLoc(); } catch (e) {}
    if (l && isFinite(l.lat)) { form.lat = l.lat; form.lng = l.lng; form.place = placeOf(l.lat, l.lng); }
    fix(8000).then(function (p) {
      form.loading = false;
      if (form.where !== "here") return;
      if (p) { form.lat = p.lat; form.lng = p.lng; form.place = placeOf(p.lat, p.lng); }
      paintReq();
    });
  }
  function seg(label, items, cur, onPick, cls) {
    var s = h("div", { class: "rd-seg " + (cls || ""), role: "radiogroup", "aria-label": label });
    items.forEach(function (it) {
      var b = h("button", { type: "button", role: "radio", class: "rd-segb", "aria-checked": String(it[0] === cur), "data-v": String(it[0]), text: it[1] });
      b.addEventListener("click", function () { onPick(it[0]); });
      s.appendChild(b);
    });
    return s;
  }
  function paintReq() {
    if (!box || !view || view.kind !== "req") return;
    var f = form; box.innerHTML = "";
    box.appendChild(h("p", { class: "rd-lead", text: T("ride.lead") }));
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.where") }));
    box.appendChild(seg(T("ride.where"), [["here", T("ride.here")], ["map", T("ride.pick")]], f.where, function (v) {
      if (v === "map") { startPick(); return; }
      f.where = "here"; locate();
    }, "rd-seg2"));
    var plTxt = f.lat != null ? (f.place || (f.where === "map" ? "Punkt på kartan" : "Din position")) : (f.loading ? T("ride.pos.wait") : T("ride.pos.none"));
    box.appendChild(h("div", { class: "rd-place" + (f.lat == null ? " rd-place-none" : "") }, [icEl("pin"), h("span", { text: plTxt })]));
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.pax") }));
    box.appendChild(seg(T("ride.pax"), [[1, "1"], [2, "2"], [3, "3"], [4, "4+"]], f.pax, function (v) { f.pax = v; paintReq(); }, "rd-seg4"));
    box.appendChild(h("h3", { class: "rd-h", text: T("ride.note") }));
    var inp = h("input", { type: "text", class: "rd-in", maxlength: "40", placeholder: T("ride.note.ph"), "aria-label": T("ride.note"), value: f.note || "" });
    inp.addEventListener("input", function () { f.note = inp.value; });
    box.appendChild(inp);
    var go = h("button", { type: "button", class: "btn btn-amber btn-block rd-go", text: T("ride.send"), disabled: f.lat == null || f.busy });
    go.addEventListener("click", function () { send(go); });
    box.appendChild(go);
    box.appendChild(h("p", { class: "rd-muted rd-priv", text: T("ride.priv") }));
  }
  function send(btn) {
    var f = form; if (f.lat == null || f.busy) return;
    f.busy = true; btn.disabled = true; btn.textContent = T("ride.sending");
    call("ride_request", { p_lat: f.lat, p_lng: f.lng, p_place: f.place || null, p_pax: f.pax, p_note: (f.note || "").trim() || null, p_name: myName() }).then(function (r) {
      f.busy = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); paintReq(); return; }
      var x = data(r); if (!x || !x.id) { paintReq(); return; }
      form = null; merge(x); push(x.id);
      A.toast(x.n ? T("ride.toast.sent", { n: x.n }) : T("ride.toast.sent0"), { ms: 5000 });
      openId(x.id);
      try { if (HK.fast) HK.fast(); } catch (e) {}
    });
  }
  /* map pick: a fixed pin over the map centre; the map moves under it (no marker, no per-frame JS) */
  function startPick() {
    var map = A && A.map; if (!map) return;
    form.where = "map"; pick = h("div", { class: "rd-pick", role: "dialog", "aria-label": T("ride.pick") });
    var c = map.getContainer ? map.getContainer().getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    var pin = h("div", { class: "rd-pick-pin", "aria-hidden": "true", html: ic("pin") });
    pin.style.left = Math.round(c.left + c.width / 2) + "px"; pin.style.top = Math.round(c.top + c.height / 2) + "px";
    var lbl = h("p", { class: "rd-pick-place", text: T("ride.pick.lead") });
    var okB = h("button", { type: "button", class: "btn btn-amber rd-pick-ok", text: T("ride.pick.ok") });
    var noB = h("button", { type: "button", class: "btn rd-pick-no", text: T("ride.pick.cancel") });
    var bar = h("div", { class: "rd-pick-bar" }, [lbl, h("div", { class: "rd-row2" }, [noB, okB])]);
    pick.appendChild(pin); pick.appendChild(bar);
    document.body.appendChild(pick);
    var upd = function () { try { var ll = map.getCenter(); var p = placeOf(ll.lat, ll.lng); lbl.textContent = p || T("ride.pick.lead"); } catch (e) {} };
    map.on("moveend", upd);
    var end = function (ok) {
      try { map.off("moveend", upd); } catch (e) {}
      if (ok) { try { var ll = map.getCenter(); form.lat = ll.lat; form.lng = ll.lng; form.place = placeOf(ll.lat, ll.lng); } catch (e) {} }
      else if (form.lat == null) form.where = "here";
      if (pick && pick.parentNode) pick.parentNode.removeChild(pick); pick = null;
      openReq({ keep: true });
      if (form && form.where === "here" && form.lat == null) locate();
    };
    okB.addEventListener("click", function () { end(true); });
    noB.addEventListener("click", function () { end(false); });
    try { A.closeSheet("pick"); } catch (e) {}
    try { var l = form.lat != null ? { lat: form.lat, lng: form.lng } : (A.lastLoc && A.lastLoc()); if (l) A.flyTo(l.lat, l.lng, 17); } catch (e) {}
  }

  function steps(x) {
    var cur = STEPS.indexOf(x.status === "done" ? "done" : x.status), ol = h("ol", { class: "rd-steps", "aria-label": "Status" });
    STEPS.forEach(function (s, i) {
      var st = i < cur ? "done" : i === cur ? "now" : "next";
      ol.appendChild(h("li", { class: "rd-step rd-step-" + st, "aria-current": st === "now" ? "step" : null }, [icEl(i < cur || x.status === "done" ? "check" : "clock"), h("span", { text: T("ride.step." + s) })]));
    });
    return ol;
  }
  function chat(x) {
    var wrap = h("div", { class: "rd-chat" });
    var list = h("ul", { class: "rd-msgs" });
    (x.msgs || []).slice(-6).forEach(function (m) { list.appendChild(h("li", { class: "rd-msg" + (m.me ? " rd-msg-me" : ""), text: m.body })); });
    if ((x.msgs || []).length) wrap.appendChild(list);
    var q = h("div", { class: "rd-quick" });
    [T("ride.q1"), T("ride.q2"), T("ride.q3"), T("ride.q4")].forEach(function (t) {
      q.appendChild(h("button", { type: "button", class: "rd-qb", text: t, onclick: function (e) { say(x, t, e.currentTarget); } }));
    });
    wrap.appendChild(q);
    var inp = h("input", { type: "text", class: "rd-in", maxlength: "120", placeholder: T("ride.chat.ph"), "aria-label": T("ride.chat.ph") });
    var sb = h("button", { type: "button", class: "rd-send", "aria-label": T("ride.chat.send"), html: ic("send") });
    sb.addEventListener("click", function () { var v = inp.value.trim(); if (v) { say(x, v, sb); inp.value = ""; } });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") sb.click(); });
    wrap.appendChild(h("div", { class: "rd-say" }, [inp, sb]));
    return wrap;
  }
  function say(x, text, btn) {
    if (btn) btn.disabled = true;
    call("ride_msg", { p_id: x.id, p_text: text }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      merge(data(r));
    });
  }
  function taxiCard() {
    var c = null; try { c = A.lastLoc && A.lastLoc(); } catch (e) {}
    var m = R && R.mine; if (m && m.pk_lat != null) c = { lat: m.pk_lat, lng: m.pk_lng };
    try { if (!window.TAXI_DATA && window.OLNU_LAZY_NOW) window.OLNU_LAZY_NOW().then(function () { repaint(); }); } catch (e) {}
    var list = [].concat(window.BOLD_TAXI || [], ((window.TAXI_DATA && window.TAXI_DATA.towns) || []).filter(function (t) { return t.tel && !t.unverified; }));
    var best = null, bd = 30000;
    if (c && isFinite(c.lat)) list.forEach(function (t) { var d = U.haversine(c.lat, c.lng, t.lat, t.lng); if (d <= bd) { bd = d; best = t; } });
    var href = best ? "tel:" + best.tel : "https://www.google.com/maps/search/taxi/" + (c ? "@" + (+c.lat).toFixed(5) + "," + (+c.lng).toFixed(5) + ",14z" : "");
    var a = h("a", { class: "rd-taxi", href: href, target: best ? null : "_blank", rel: best ? null : "noopener" }, [icEl("taxi"),
      h("span", { class: "rd-taxi-t" }, [h("b", { text: best ? T("ride.taxi") : T("ride.taxi.map") }), h("small", { text: best ? best.name + " · " + best.text : "Google Maps" })]),
      icEl(best ? "phone" : "chev-right", "rd-taxi-go")]);
    return a;
  }
  function act(btn, name, params, after) {
    if (btn) btn.disabled = true;
    return call(name, params).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); refresh(); return null; }
      var d = data(r); if (after) after(d); return d;
    });
  }
  function paintRider(x) {
    var b = box;
    if (x.status === "open" && x.live) {
      var m = mins(x.opened_at), none = !x.n, alln = x.n > 0 && x.declined_n >= x.n;
      b.appendChild(h("div", { class: "rd-card rd-wait" }, [
        h("div", { class: "rd-wait-top" }, [h("span", { class: "rd-pulse", "aria-hidden": "true" }), h("b", { class: "rd-big", text: none ? T("ride.none") : alln ? T("ride.allno") : T("ride.wait") })]),
        h("p", { class: "rd-muted", text: [x.place || "", x.pax + " pers", T("ride.asked", { n: x.n }) + (x.declined_n ? " · " + T("ride.no", { n: x.declined_n }) : "")].filter(Boolean).join(" · ") }),
        h("p", { class: "rd-muted", text: T("ride.since", { m: m }) })]));
      if (more() && (none || alln || m >= 5)) {
        var row = h("div", { class: "rd-row2" });
        if (!x.again && !none) row.appendChild(h("button", { type: "button", class: "btn rd-again", text: T("ride.again"), disabled: m < 4, onclick: function (e) { act(e.currentTarget, "ride_again", { p_id: x.id }, function (d) { merge(d); push(x.id); }); } }));
        if (!x.wide) row.appendChild(h("button", { type: "button", class: "btn rd-wide", text: T("ride.wide"), onclick: function (e) { act(e.currentTarget, "ride_widen", { p_id: x.id }, function (d) { merge(d); push(x.id); }); } }));
        if (row.childNodes.length) { b.appendChild(row); if (!x.wide) b.appendChild(h("p", { class: "rd-muted rd-small", text: T("ride.wide.sub") })); }
      }
      if (more() && (none || alln || m >= 10)) b.appendChild(taxiCard());
      b.appendChild(h("button", { type: "button", class: "btn btn-block rd-cancel", text: T("ride.cancel"), onclick: function (e) { cancel(x, e.currentTarget); } }));
      return;
    }
    if (x.live && x.driver) {
      var d = x.driver, msg = x.status === "arrived" ? T("ride.arrived", { name: d.name }) : x.status === "enroute" ? T("ride.enroute", { name: d.name }) : T("ride.taken", { name: d.name });
      var sub = x.status === "arrived" ? T("ride.waited", { m: mins(x.step_at && x.step_at.arrived) }) : d.eta_min ? T("ride.eta", { m: d.eta_min, km: km(d.dist_m) }) : "";
      var stale = x.status !== "arrived" && d.pos_at && mins(d.pos_at) >= 3;
      b.appendChild(h("div", { class: "rd-card rd-driver" }, [
        h("div", { class: "rd-who" }, [face(d.name, d.avatar, "rd-face-l"), h("div", { class: "rd-who-t" }, [h("b", { class: "rd-big", text: msg }),
          sub ? h("span", { class: "rd-eta", text: sub }) : null])]),
        h("div", { class: "rd-car" }, [icEl("taxi"), h("span", {}, [h("b", { text: d.car || T("ride.car.none") }), h("small", { text: T("ride.car.check") })])]),
        stale ? h("p", { class: "rd-warn", text: T("ride.stale", { name: d.name }) }) : null,
        steps(x)]));
      if (d.lat != null) b.appendChild(h("button", { type: "button", class: "rd-rowbtn", onclick: function () { try { A.closeSheet("map"); A.flyTo(+d.lat, +d.lng, 16); } catch (e) {} } }, [icEl("map"), h("span", { text: T("ride.map") }), icEl("chev-right", "rd-chev")]));
      b.appendChild(chat(x));
      var row2 = h("div", { class: "rd-row2" });
      row2.appendChild(h("button", { type: "button", class: "btn rd-cancel", text: T("ride.pick.cancel"), onclick: function (e) { cancel(x, e.currentTarget); } }));
      row2.appendChild(h("button", { type: "button", class: "btn" + (x.status === "arrived" ? " btn-amber" : "") + " rd-done", text: T("ride.done.rider"), onclick: function (e) { act(e.currentTarget, "ride_step", { p_id: x.id, p_step: "done" }, function (dd) { merge(dd); }); } }));
      b.appendChild(row2);
      return;
    }
    // ended
    if (x.status === "done") {
      var nm = x.taker_name || "";
      b.appendChild(h("div", { class: "rd-card rd-end" }, [icEl("check", "rd-ok"), h("b", { class: "rd-big", text: T("ride.done", { name: nm }) })]));
      if (more()) b.appendChild(x.thanks ? h("p", { class: "rd-muted", text: T("ride.thanks.sent", { name: nm }) })
        : h("button", { type: "button", class: "btn btn-amber btn-block rd-thanks", html: ic("cheers", "pi-lead") + esc(T("ride.thanks")), onclick: function (e) {
          act(e.currentTarget, "ride_thanks", { p_id: x.id }, function (dd) { merge(dd); A.toast(T("ride.thanks.sent", { name: nm }), { ms: 3500 }); try { if (window.FX && window.FX.cheers) window.FX.cheers(); } catch (er) {} }); } }));
      return;
    }
    b.appendChild(h("p", { class: "rd-lead", text: x.status === "expired" ? T("ride.expired") : T("ride.cancelled") }));
    if (x.status === "expired") { b.appendChild(taxiCard()); b.appendChild(h("button", { type: "button", class: "btn btn-block rd-new", text: T("ride.again"), onclick: function () { R.mine = null; openReq({}); } })); }
  }
  function cancel(x, btn) {
    act(btn, "ride_cancel", { p_id: x.id }, function (d) { merge(d); push(x.id); syncMap(); A.toast(T("ride.cancelled"), { ms: 3500 }); });
  }
  function paintOffer(x) {
    var b = box;
    b.appendChild(h("div", { class: "rd-card rd-offer" }, [
      h("b", { class: "rd-big", text: T("ride.offer.lead", { name: x.name }) }),
      h("p", { class: "rd-facts", text: T("ride.offer.from", { place: x.place || "?", pax: x.pax || 1 }) + (x.dist_m != null ? " · " + km(x.dist_m) + " km" : "") }),
      x.note ? h("p", { class: "rd-note", text: "”" + x.note + "”" }) : null,
      h("p", { class: "rd-muted", text: T("ride.offer.ago", { m: mins(x.created_at) }) })]));
    if (R && R.drinking && x.live && x.status === "open") {
      b.appendChild(h("div", { class: "rd-card rd-drunk", role: "alert" }, [icEl("block"), h("b", { text: T("ride.drunk") })]));
      if (HK.driving && HK.driving()) b.appendChild(h("button", { type: "button", class: "btn btn-block rd-drv-off", text: T("ride.drunk.off"), onclick: function (e) { if (HK.setDriver) HK.setDriver(false, e.currentTarget); } }));
      return;
    }
    if (x.taker_name && x.status !== "open") { b.appendChild(h("p", { class: "rd-took", html: ic("check") + esc(T("ride.tookit", { name: x.taker_name })) })); return; }
    if (!x.live) { b.appendChild(h("p", { class: "rd-lead", text: T("ride.gone", { name: x.name }) })); return; }
    if (x.excluded) { b.appendChild(h("p", { class: "rd-lead", text: T("ride.excluded") })); return; }
    if (x.my_declined) b.appendChild(h("p", { class: "rd-muted", text: T("ride.declined") }));
    var yes = h("button", { type: "button", class: "btn btn-amber rd-take", text: T("ride.take") });
    var no = h("button", { type: "button", class: "btn rd-decline", text: T("ride.decline"), "aria-pressed": String(!!x.my_declined) });
    yes.addEventListener("click", function () { take(x, yes); });
    no.addEventListener("click", function () { decline(x, no); });
    b.appendChild(h("div", { class: "rd-row2 rd-answer" }, [no, yes]));
  }
  function take(x, btn) {
    act(btn, "ride_take", { p_id: x.id }, function (d) {
      if (!d) return;
      if (d.ok && d.ride) { merge(d.ride); push(x.id); openId(x.id); A.toast(T("ride.drive.lead", { name: x.name }) + ". Kör försiktigt!", { ms: 4000 }); return; }
      if (d.code === "taken") { x.taker_name = d.name; x.status = "taken"; x.can_take = false; merge(x); }
      else if (d.code === "drinking") { if (R) R.drinking = true; A.toast(T("ride.err.drinking"), { err: true }); repaint(); }
      else if (d.code === "excluded") { x.excluded = true; merge(x); }
      else { x.live = false; merge(x); }
    });
  }
  function decline(x, btn) { act(btn, "ride_decline", { p_id: x.id }, function (d) { merge(d); try { A.closeSheet("done"); } catch (e) {} }); }
  function paintTaker(x) {
    var b = box, rn = (x.rider && x.rider.name) || "";
    if (!x.live) {
      if (x.status === "done") {
        var n = (R && R.chauffeur) || 1;
        b.appendChild(h("div", { class: "rd-card rd-end rd-medal" }, [icEl("medal", "rd-gold"), h("b", { class: "rd-big", text: T("ride.drive.donehead") }),
          h("p", { class: "rd-muted", text: T("ride.drive.donesub", { n: n }) }), x.thanks ? h("p", { class: "rd-took", html: ic("cheers") + esc(T("ride.drive.thanked", { name: rn })) }) : null]));
      } else b.appendChild(h("p", { class: "rd-lead", text: x.status === "cancelled" ? T("ride.gone", { name: rn }) : T("ride.cancelled") }));
      return;
    }
    if (x.status === "open") { b.appendChild(h("p", { class: "rd-lead", text: T("ride.excluded") })); return; }
    b.appendChild(h("div", { class: "rd-card rd-driver" }, [
      h("div", { class: "rd-who" }, [face(rn, x.rider && x.rider.avatar, "rd-face-l"), h("div", { class: "rd-who-t" }, [h("b", { class: "rd-big", text: T("ride.drive.lead", { name: rn }) }),
        h("span", { class: "rd-eta", text: [x.place || "", (x.pax || 1) + " pers", x.dist_m != null ? km(x.dist_m) + " km" : ""].filter(Boolean).join(" · ") })])]),
      x.note ? h("p", { class: "rd-note", text: "”" + x.note + "”" }) : null,
      steps(x)]));
    if (x.pk_lat != null) {
      b.appendChild(h("a", { class: "rd-rowbtn", href: "https://www.google.com/maps/dir/?api=1&destination=" + (+x.pk_lat).toFixed(5) + "," + (+x.pk_lng).toFixed(5), target: "_blank", rel: "noopener" },
        [icEl("compass"), h("span", { text: T("ride.route") }), icEl("chev-right", "rd-chev")]));
    }
    b.appendChild(h("p", { class: "rd-muted rd-small", text: ghost() ? T("ride.drive.ghost", { name: rn }) : T("ride.drive.share", { name: rn }) }));
    var nx = x.status === "taken" ? ["enroute", T("ride.drive.go")] : x.status === "enroute" ? ["arrived", T("ride.drive.at")] : ["done", T("ride.drive.done")];
    var row = h("div", { class: "rd-row2" });
    row.appendChild(h("button", { type: "button", class: "btn rd-letgo", text: T("ride.drive.letgo"), onclick: function (e) { act(e.currentTarget, "ride_cancel", { p_id: x.id }, function (d) { if (R) R.drive = null; push(x.id); stopPos(); syncMap(); if (d) merge(d); }); } }));
    row.appendChild(h("button", { type: "button", class: "btn btn-amber rd-next", "data-step": nx[0], text: nx[1], onclick: function (e) {
      act(e.currentTarget, "ride_step", { p_id: x.id, p_step: nx[0] }, function (d) { merge(d); if (nx[0] === "arrived") push(x.id); if (nx[0] === "done") { stopPos(); refresh(); } }); } }));
    b.appendChild(row);
    b.appendChild(chat(x));
  }

  /* ---------- open by id (push tap / HUD / map pin) ---------- */
  var want = null;
  function openId(id) {
    var x = find(id);
    if (!x) { want = String(id); return false; }
    want = null;
    sheet(x.role === "taker" ? T("ride.title.drive") : x.role === "rider" ? T("ride.title") : T("ride.title.offer"), "ride", x.id);
    return true;
  }
  function chip() {
    if (!on() || !R) return "";
    var o = (R.offers || []).filter(function (x) { return x.live && x.can_take && !x.my_declined && !R.drinking; })[0], d = R.drive, m = R.mine, t = "", id = 0;
    if (d && d.live && d.status !== "open") { t = T("ride.chip.drive", { name: (d.rider && d.rider.name) || "" }); id = d.id; }
    else if (m && m.live) { t = m.taker_name && m.status !== "open" ? T("ride.chip.live", { name: m.taker_name }) + (m.driver && m.driver.eta_min && m.status !== "arrived" ? " · ca " + m.driver.eta_min + " min" : "") : T("ride.chip.wait"); id = m.id; }
    else if (o) { t = T("ride.chip.offer", { name: o.name }); id = o.id; }
    if (!id) return "";
    return '<button type="button" class="hx-chip pk-chip-hud rd-chip" data-hx="rd:' + esc(String(id)) + '">' + ic("taxi", "pi-lead") + esc(t) + "</button>";
  }

  /* ---------- "Jag kör ikväll" extras (skjuts.js ikvNode): the car note + the drink rule ---------- */
  function ikvExtra(driving) {
    if (!on()) return null;
    var w = h("div", { class: "rd-ikv" });
    if (R && R.drinking) {
      w.appendChild(h("div", { class: "rd-drunk", role: "alert" }, [icEl("block"), h("b", { text: T("ride.drunk") })]));
      if (driving) w.appendChild(h("button", { type: "button", class: "btn btn-block rd-drv-off", text: T("ride.drunk.off"), onclick: function (e) { if (HK.setDriver) HK.setDriver(false, e.currentTarget); } }));
      return w;
    }
    if (!driving) return null;
    var inp = h("input", { type: "text", class: "rd-in", maxlength: "30", placeholder: T("ride.car.ph"), "aria-label": T("ride.car.label"), value: (R && R.car) || "" });
    var save = h("button", { type: "button", class: "btn rd-car-save", text: "Spara" });
    save.addEventListener("click", function () { act(save, "ride_car_set", { p_car: inp.value.trim() || null }, function (d) { if (d && R) R.car = d.car; A.toast(T("ride.car.saved"), { ms: 2500 }); }); });
    w.appendChild(h("label", { class: "rd-lbl", text: T("ride.car.label") }));
    w.appendChild(h("div", { class: "rd-say" }, [inp, save]));
    return w;
  }

  /* ---------- Android push buttons: /?pickup=<id>&ride=ta|nej ---------- */
  function noteAct(url) {
    try { var q = new URL(url, location.href).searchParams, id = q.get("pickup"), a = q.get("ride"); if (id && /^\d{1,18}$/.test(id) && (a === "ta" || a === "nej")) pend[id] = a; } catch (e) {}
  }
  noteAct(location.href);
  try { if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) { var d = e.data || {}; if (d.type === "olnu-open" && d.url) noteAct(d.url); }); } catch (e) {}

  window.RIDE = {
    init: function (api, hooks) { A = api; HK = hooks || {}; reg(); },
    onAuthed: function () { return loadFlags(true); },
    loadFlags: loadFlags, on: on, live: live, pollArgs: pollArgs, onData: onData,
    off: function () { off = true; flags = {}; R = null; syncMap(); stopPos(); },
    open: openReq, openId: openId, has: function (id) { return !!find(id); },
    chip: chip, hud: function (a) { a = String(a || ""); if (a.indexOf("rd:") === 0) return openId(a.slice(3)); return false; },
    ikvExtra: ikvExtra, taxiCard: taxiCard, T: T, PACK: P,
    _state: function () { return R; }, _flags: function () { return flags; }
  };
})();
