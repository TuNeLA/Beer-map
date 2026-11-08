/* PintsNow — 👑 KVÄLLENS KROG (agent bold, owner OK 2026-11-08, flag bold_krog, migration 0383). window.BOLD_KROG.
   One live crown per town per night: the bar with the most PEOPLE (check-ins + pins at the bar) and Skål! meetings.
   Never drinks. Replaces the old weekly beer crown (social.js bar_kings stops while this flag is on; owner decision E).
   - Map: the leading bar wears the crown in the existing crown slot (app.js reads .bi-king from barIcoHTML → mapart crown,
     tiers priority). Only 20:00–03:00 and only with ≥ 5 people at the top bar and ≥ 2 active bars in the town (server).
   - Bar sheet (barPopupHTML): "👑 Kvällens krog · Ludvika" + top 3 (people · skål) + friends at this bar + "Aldrig öl".
   - Topplista ikväll (topSheet): the same board for the town in view.
   - LIVE ticker: one line "👑 Kvällens krog i Ludvika: Pitchers leder (14 pers)"; the day after (until 20:00):
     "👑 Igår blev Pitchers Kvällens krog i Ludvika". NEWS.build is wrapped (no news.js edit).
   - Din kväll + Bakisrapporten: nightLine(container) adds "👑 Kvällens krog i Ludvika blev Pitchers – du va där!".
   Data: RPC bold_krog(lat, lng) for the map centre (zoom ≥ 11), at most every 2 min or when the town changes.
   Public: BOLD_KROG = { nightLine(el), data(), refresh(), _set(d) (tests) }. */
(function () {
  "use strict";
  var U = window.U;
  var KEY = "bold_krog", A = null, K = null, at = 0, busy = false, off = false, lastLeader = "", wrapped = false;
  var GAP_MS = 2 * 60e3;
  function W(n) { return window[n] || null; }
  function on() { try { return !!(W("BOLD") && W("BOLD").on(KEY)); } catch (e) { return false; } }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s); }
  function ic(n, c) { try { return W("PNI") ? W("PNI").svg(n, c || "") : ""; } catch (e) { return ""; } }
  function center() {
    try { var m = A.map; if (!m || m.getZoom() < 11) return null; var c = m.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return null; }
  }
  function live() { return !!(K && K.live && K.town); }
  function leaderId() { return live() && K.leader ? String(K.leader.bar_id) : ""; }
  function load(force) {
    if (off || busy || !A || !A.LIVE || !on()) return;
    try { if (A.authed && !A.authed()) return; } catch (e) {}
    var c = center(); if (!c) return;
    var moved = K && K.__c ? U.haversine(c.lat, c.lng, K.__c.lat, K.__c.lng) > 15000 : true;
    if (!force && !moved && Date.now() - at < GAP_MS) return;
    busy = true;
    A.rpc("bold_krog", { p_lat: c.lat, p_lng: c.lng }).then(function (r) {
      busy = false; at = Date.now();
      if (r && r.error) { if (U.missing && U.missing(r.error)) off = true; return; }
      set(A.parseData(r && r.data), c);
    }, function () { busy = false; });
  }
  function set(d, c) {
    var before = leaderId();
    K = d && !d.off ? d : null; if (K && c) K.__c = c;
    var now = leaderId();
    if (now !== before) { try { A.render(); } catch (e) {} }
    if (now && now !== lastLeader) { lastLeader = now; try { A.renderTicker(); } catch (e) {} }
  }
  function pers(n) { return (n | 0) + " pers"; }
  function boardHTML(barId) {
    if (!live()) return "";
    var top = K.top || [], h = '<div class="bk-box"><div class="bk-h">' + ic("crown", "bk-i") + "<b>Kvällens krog · " + esc(K.town) + "</b></div>";
    if (!K.leader) h += '<p class="bk-none">Ingen krona än. ' + (K.min_people || 5) + " pers behövs på samma krog.</p>";
    if (top.length) {
      h += '<ol class="bk-list">';
      top.forEach(function (x, i) {
        var me = barId && String(x.bar_id) === String(barId);
        h += '<li class="' + (me ? "bk-me" : "") + '"><span class="bk-n">' + (i + 1) + '</span><span class="bk-name">' + esc(x.name || "Krogen") + "</span>" +
          '<span class="bk-v">' + esc(pers(x.people) + ((x.skal | 0) ? " · " + x.skal + " skål" : "")) + "</span></li>";
      });
      h += "</ol>";
    }
    var f = barId && K.friends ? K.friends[String(barId)] : null;
    if (f && (f.n | 0) > 0) {
      var names = (f.names || []).slice(0, 2), rest = (f.n | 0) - names.length;
      h += '<p class="bk-fr">' + ic("users", "bk-i") + esc(names.join(", ") + (rest > 0 ? " + " + rest + (rest === 1 ? " kompis" : " kompisar") : "") + " ä här") + "</p>";
    }
    return h + '<p class="bk-foot">Räknar folk, incheckningar och Skål!. Aldrig öl.</p></div>';
  }
  function nearTown(bar) {
    if (!live() || !bar || !isFinite(bar.lat)) return false;
    if ((K.top || []).some(function (x) { return String(x.bar_id) === String(bar.id); })) return true;
    return !!(K.__c && U.haversine(bar.lat, bar.lng, K.__c.lat, K.__c.lng) < 12000);
  }
  function tickerLine() {
    if (!K || !K.town) return null;
    if (live() && K.leader) return { text: "👑 Kvällens krog i " + K.town + ": " + K.leader.name + " leder (" + pers(K.leader.people) + ")", cls: "tk-krog" };
    if (!K.live && K.last && K.last.name) return { text: "👑 Igår blev " + K.last.name + " Kvällens krog i " + K.town + ".", cls: "tk-krog" };
    return null;
  }
  function wrapNews() {
    var N = W("NEWS"); if (wrapped || !N || typeof N.build !== "function") return;
    wrapped = true;
    var orig = N.build;
    N.build = function () {
      var items = orig.apply(this, arguments) || [];
      try { if (on()) { var x = tickerLine(); if (x) items.splice(Math.min(1, items.length), 0, x); } } catch (e) {}
      return items;
    };
  }
  function nightLine(container) {
    if (!on() || !container || !K || !K.last || !K.last.name) return null;
    var p = document.createElement("p"); p.className = "bk-night";
    p.innerHTML = ic("crown", "bk-i") + "<span>" + esc("Kvällens krog i " + K.town + " blev " + K.last.name + (K.last.was_there ? ". Du va där!" : ".")) + "</span>";
    container.appendChild(p); return p;
  }
  var feat = {
    key: KEY,
    init: function (api) { A = api; wrapNews(); },
    onAuthed: function () { wrapNews(); load(true); },
    onPoll: function () { wrapNews(); load(false); },
    onFlags: function () { if (!on()) { K = null; try { A.render(); } catch (e) {} } else load(true); },
    barIcoHTML: function (bar) { return bar && leaderId() && String(bar.id) === leaderId() ? '<span class="bi-king" aria-hidden="true">👑</span>' : ""; },
    barPopupHTML: function (bar) { return nearTown(bar) ? boardHTML(bar.id) : ""; },
    topSheet: function (body) {
      if (!live() || !body) return;
      var d = document.createElement("div"); d.className = "bk-top"; d.innerHTML = boardHTML(null); body.appendChild(d);
    }
  };
  window.BOLD_KROG = { nightLine: nightLine, data: function () { return K; }, refresh: function () { load(true); },
    _set: function (d) { set(d, d && d.__c); } };
  if (W("BOLD")) W("BOLD").add(feat);
})();
