/* PintsNow — LASTBUS: "Sista bussen hem" card in Hem-läge (lane places, E3; data-sources.md Top 10 no. 1).
   PN.lastbus = { node(o) → Element | null, _state() }. No window global. js/bold-hem.js puts node({pos}) under the taxi row.
   - Data: the edge function `lastbus` (supabase/functions/lastbus, Trafiklab ResRobot v2.1, CC0). It holds the Trafiklab key
     as the Supabase secret TRAFIKLAB_KEY (read at run time; never in this file, a log or a picture). No key on the server
     ({ok:false, code:"no_key"}), function not deployed (404) or any error = the card is NOT there (and we ask again in 6 h).
   - Needs a home zone (Hemzon, olnu.home on this phone). No home zone, or I am within 600 m of it = no card.
   - Privacy: the home zone never leaves the phone without a yes. The first time the card asks: "Sista bussen hem? Visa
     tider" with the line "Din hemzon skickas avrundad (cirka 500 m) via vår server till Trafiklab. Inget sparas." Yes =
     localStorage olnu.lastbusOk. Both points are rounded to 0.005° here (and again on the server). From = the bar I am
     checked in at, else my last position.
   - Card: "Sista bussen hem" · big time of the LAST trip tonight · "om 52 min · Buss 302 från Ludvika resecentrum" ·
     "6 min att gå till hållplatsen" · "Nästa: 22:52" when an earlier one goes. After the last one: "Sista bussen har gått"
     (the taxi row is right above). Credit line "Tider: Trafiklab". Calm text only, no countdown animation, no push.
   - One lookup per 5 min per point pair (cache here + on the server). Offline = no card. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var OK_KEY = "olnu.lastbusOk", OFF_KEY = "olnu.lastbusOff", OFF_MS = 6 * 3600e3, TTL = 5 * 60e3, STEP = 0.005, HOME_M = 600;
  var cache = {}, busy = {}, last = null;

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function ic(n) { try { return window.PNI ? window.PNI.svg(n, "lb-i") : ""; } catch (e) { return ""; } }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function rnd(v) { return +(Math.round(+v / STEP) * STEP).toFixed(3); }
  function home() { try { var h = JSON.parse(localStorage.getItem("olnu.home") || "null"); return h && isFinite(h.lat) && isFinite(h.lng) ? h : null; } catch (e) { return null; } }
  function from(o) {
    try { var c = window.PN && window.PN.myCheckin && window.PN.myCheckin(); if (c && isFinite(c.lat) && isFinite(c.lng)) return { lat: +c.lat, lng: +c.lng }; } catch (e) {}
    var p = o && o.pos; return p && isFinite(p.lat) && isFinite(p.lng) ? { lat: +p.lat, lng: +p.lng } : null;
  }
  function dist(a, b) { var r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2), y = Math.sin((b.lng - a.lng) * r / 2); return 12742000 * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * r) * Math.cos(b.lat * r) * y * y)); }
  function offNow() { var t = +ls(OFF_KEY) || 0; return t && Date.now() - t < OFF_MS; }
  function client() { try { return window.PN && window.PN.s && window.PN.s.client && window.PN.s.client.functions ? window.PN.s.client : null; } catch (e) { return null; } }
  // Stockholm wall clock as minutes since the epoch day (to compare with "YYYY-MM-DD HH:MM" from the server)
  function sthlmKeyMin(ms) {
    try {
      var p = {}; new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 60000;
    } catch (e) { return Math.floor(ms / 60000); }
  }
  function keyMin(s) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null; }
  function inTxt(dep) {
    var d = keyMin(dep), n = sthlmKeyMin(Date.now()); if (d == null) return "";
    var m = Math.round(d - n); if (m < 0) return "";
    if (m < 60) return L("om " + m + " min", "in " + m + " min");
    return L("om " + Math.floor(m / 60) + " h " + (m % 60) + " min", "in " + Math.floor(m / 60) + " h " + (m % 60) + " min");
  }
  function hm(dep) { return String(dep || "").slice(11, 16); }

  function paintInto(box, st) {
    if (!box) return;
    if (st.hide) { box.remove(); return; }
    box.innerHTML = "";
    var head = el("div", "lb-h", ic("bus") + "<b>" + esc(L("Sista bussen hem", "Last bus home")) + "</b>");
    box.appendChild(head);
    if (st.ask) {
      box.classList.add("lb-ask");
      box.appendChild(el("p", "lb-s", esc(L("Din hemzon skickas avrundad (cirka 500 m) via vår server till Trafiklab. Inget sparas.",
        "Your home zone is sent rounded (about 500 m) via our server to Trafiklab. Nothing is stored."))));
      var b = el("button", "lb-go", esc(L("Visa tider", "Show times"))); b.type = "button";
      b.addEventListener("click", function () { ls(OK_KEY, "1"); box.classList.remove("lb-ask"); run(box, st.o); });
      box.appendChild(b);
      return;
    }
    box.classList.remove("lb-ask");
    if (st.loading) { box.appendChild(el("p", "lb-s", esc(L("Letar tider…", "Finding times…")))); return; }
    var d = st.d || {}, x = d.last;
    if (d.gone || !x) {
      box.classList.add("lb-gone");
      box.appendChild(el("p", "lb-big lb-gone-t", esc(x ? L("Sista bussen har gått", "The last bus has left") : L("Ingen buss hem i natt", "No bus home tonight"))));
      box.appendChild(el("p", "lb-s", esc(L("Ta en taxi eller gå hem med Följ mig hem.", "Take a taxi or walk home with Följ mig hem."))));
    } else {
      box.classList.remove("lb-gone");
      box.appendChild(el("p", "lb-big", '<span class="lb-time">' + esc(hm(x.dep)) + '</span> <span class="lb-in">' + esc(inTxt(x.dep)) + "</span>"));
      box.appendChild(el("p", "lb-s", esc((x.line ? x.line + " " : "") + L("från ", "from ") + (x.stop || "?"))));
      if (x.walk > 0) box.appendChild(el("p", "lb-s lb-walk", ic("walk") + esc(L(x.walk + " min att gå till hållplatsen", x.walk + " min walk to the stop"))));
      var n = d.next;
      if (n && n.dep && n.dep !== x.dep) box.appendChild(el("p", "lb-s lb-next", esc(L("Nästa: ", "Next: ") + hm(n.dep) + (n.line ? " · " + n.line : ""))));
    }
    box.appendChild(el("p", "lb-src", esc(L("Tider: Trafiklab", "Times: Trafiklab"))));
  }
  function run(box, o) {
    var h = home(), f = from(o), c = client();
    if (!h || !f || !c) { paintInto(box, { hide: true }); return; }
    var a = { lat: rnd(f.lat), lng: rnd(f.lng) }, b = { lat: rnd(h.lat), lng: rnd(h.lng) }, k = a.lat + "," + a.lng + ">" + b.lat + "," + b.lng;
    var hit = cache[k];
    if (hit && Date.now() - hit.at < TTL) { paintInto(box, { d: hit.d }); return; }
    paintInto(box, { loading: true });
    if (busy[k]) { busy[k].push(box); return; }
    busy[k] = [box];
    var done = function (d) {
      var boxes = busy[k] || []; delete busy[k];
      if (!d || d.ok !== true) {
        if (!d || d.code === "no_key" || d.code === "404") ls(OFF_KEY, String(Date.now()));
        last = { k: k, err: d ? d.code || "bad" : "net" };
        boxes.forEach(function (x) { paintInto(x, { hide: true }); });
        return;
      }
      cache[k] = { at: Date.now(), d: d }; last = { k: k, d: d };
      boxes.forEach(function (x) { if (document.body.contains(x)) paintInto(x, { d: d }); });
    };
    try {
      Promise.resolve(c.functions.invoke("lastbus", { body: { from: a, to: b } })).then(function (r) {
        var d = r && r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (r && r.error) { var st = r.error && r.error.context && r.error.context.status; done({ ok: false, code: st === 404 ? "404" : "err" }); return; }
        done(d);
      }, function () { done(null); });
    } catch (e) { done(null); }
  }
  function node(o) {
    o = o || {};
    if (offNow() || navigator.onLine === false) return null;
    var h = home(), f = from(o);
    if (!h || !f || !client()) return null;
    if (dist(h, f) <= Math.max(HOME_M, +h.r || 0)) return null;   // at home already
    var box = el("div", "lb"); box.setAttribute("role", "group"); box.setAttribute("aria-label", L("Sista bussen hem", "Last bus home"));
    if (ls(OK_KEY) !== "1") paintInto(box, { ask: true, o: o }); else run(box, o);
    return box;
  }

  (window.PN = window.PN || {}).lastbus = { node: node, _state: function () { return { last: last, cache: cache, off: offNow() }; } };
})();
