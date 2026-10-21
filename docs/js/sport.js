/* Öl Nu — 📺 "VISAR SPORT" on bars (CONTRACT "SPORT + 📅 EVENT-KNAPPEN", migration 0101).
   - Bar sheet line (barPopupHTML): "📺 Visar sport · 👍 3" right under the title when the bar shows sport (class .ev-line, so
     app.js lifts it there), else the question "📺 Visar dom sport här?" quietly in the ℹ️ Info fold; both with 👍 / 👎 vote buttons (one vote per user per bar, tap again = take it back) → vote_bar_sport(bar, yes|null).
   - bar_sport_near(lat, lng) → cache of nearby bars with votes / owner flag; at sign-in, then max every 10 min, and on demand.
   - SPORT.pubs(lat, lng, n) = the nearest bars that show sport (for "📺 Matchen visas på: …" under a TV match, js/evsheet.js).
   Owner override lives in stats.html (docs/stats-sport.js). Missing RPCs (old database) → everything here hides quietly.
   Hooks (app.js mods): init, onAuthed, onPoll, barPopupHTML. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = false, busy = false, cache = { at: 0, key: "", bars: [] }, pollAt = 0, voteAt = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }

  var T = {
    yesOk: ["📺 Noterat! Storbildsspaning inrapporterad.", "📺 Tack, soldat. Nu vet truppen var matchen går.", "📺 Hä ä anteckna: dom visar sport här.",
      "📺 Underrättelsen ä inne. Stammisarna tackar.", "📺 Bra spanat! Nästa match tar vi här."],
    noOk: ["👎 Noterat. Ingen storbild här, bara ölen.", "👎 Tack! Då vet vi: hit går man för ölen, int' för matchen.", "👎 Inrapporterat. Spaningen fortsätter nån annanstans."],
    undo: ["↩️ Rösten tillbakadragen.", "↩️ Ångrat. Som om du aldrig sa nåt."],
    slow: ["Lugn i stormen – vänta lite mellan rösterna.", "Easy – wait a bit between votes."],
    err: ["Nåt gick snett. Försök igen.", "Something went wrong. Try again."]
  };

  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && me.lat != null && isFinite(me.lat) && isFinite(me.lng)) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    if (!p) p = { lat: 60.1496, lng: 15.1878 };
    p.lng = ((((p.lng + 180) % 360) + 360) % 360) - 180; p.lat = Math.max(-85, Math.min(85, p.lat));
    return p;
  }
  function load(force) {
    if (!A || !A.LIVE || off || !A.authed || !A.authed()) return Promise.resolve(cache.bars);
    var p = where(), key = (Math.round(p.lat * 20) / 20) + "," + (Math.round(p.lng * 10) / 10);
    if (!force && key === cache.key && Date.now() - cache.at < 120000) return Promise.resolve(cache.bars);
    if (busy) return Promise.resolve(cache.bars);
    busy = true;
    return A.rpc("bar_sport_near", { p_lat: p.lat, p_lng: p.lng }).then(function (r) {
      busy = false;
      if (r.error) { if (U.missing(r.error)) off = true; return cache.bars; }
      var d = A.parseData(r.data);
      cache = { at: Date.now(), key: key, bars: Array.isArray(d.bars) ? d.bars : [] };
      return cache.bars;
    });
  }
  function info(id) { id = String(id || ""); return cache.bars.filter(function (b) { return String(b.bar_id) === id; })[0] || null; }
  function km(a, b) { var dx = (a.lng - b.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * 111.32; return Math.sqrt(dx * dx + dy * dy); }
  // Nearest bars that show sport (owner flag or votes), nearest first.
  function pubs(lat, lng, n) {
    var p = lat != null ? { lat: lat, lng: lng } : where();
    return cache.bars.filter(function (b) { return b.shows && isFinite(b.lat); })
      .map(function (b) { var bb = null; try { bb = window.BARS && window.BARS.byId(b.bar_id); } catch (e) {}
        return { id: b.bar_id, name: (bb && bb.name) || b.name, lat: +b.lat, lng: +b.lng, km: km(p, b), yes: b.yes | 0, owner: b.owner === true, bar: bb }; })
      .sort(function (a, b) { return (b.owner - a.owner) || (a.km - b.km); }).slice(0, n || 6);
  }

  /* ---------- bar sheet line ---------- */
  function tagHTML(barId) {
    var s = info(barId) || { yes: 0, no: 0, shows: false, mine: null, owner: null };
    var shows = !!s.shows, mine = s.mine;
    var label = shows ? L("📺 Visar sport", "📺 Shows sports") + (s.owner === true ? " ✅" : "") : L("📺 Visar dom sport här?", "📺 Do they show sports?");
    return '<div class="sp-tag' + (shows ? " sp-on ev-line" : "") + '" data-sptag="' + esc(String(barId)) + '">' +
      '<span class="sp-l">' + esc(label) + "</span>" +
      '<span class="sp-v">' +
      '<button type="button" class="btn btn-small sp-b" data-spvote="1" data-spbar="' + esc(String(barId)) + '" aria-pressed="' + (mine === true) + '" aria-label="' + esc(L("Ja, dom visar sport", "Yes, they show sports")) + '">👍' + (s.yes ? " " + s.yes : "") + "</button>" +
      '<button type="button" class="btn btn-small sp-b" data-spvote="0" data-spbar="' + esc(String(barId)) + '" aria-pressed="' + (mine === false) + '" aria-label="' + esc(L("Nej, ingen sport här", "No sports here")) + '">👎' + (s.no ? " " + s.no : "") + "</button>" +
      "</span></div>";
  }
  function barHTML(bar) {
    if (!bar || bar.id == null || off || !A || !A.LIVE || /^pl_/.test(String(bar.id))) return "";
    var t = String(bar.type || "");
    if (t && !/^(bar|pub|nightclub|biergarten|restaurant|cafe)$/.test(t)) return "";
    return tagHTML(bar.id);
  }
  function onDocClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-spvote]") : null;
    if (!t || !A) return;
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - voteAt < 1500) return;
    var id = t.getAttribute("data-spbar"), want = t.getAttribute("data-spvote") === "1", s = info(id);
    var yes = s && s.mine === want ? null : want;   // tap the pressed one again = take the vote back
    voteAt = Date.now();
    try { if (window.FX && FX.haptic) FX.haptic(10); } catch (x) {}
    A.rpc("vote_bar_sport", { p_bar_id: String(id), p_yes: yes }).then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) { off = true; document.querySelectorAll(".sp-tag").forEach(function (x) { x.remove(); }); return; }
        A.toast(/slow_down/.test(String(r.error.message || "")) ? L(T.slow[0], T.slow[1]) : L(T.err[0], T.err[1]), { err: true }); return;
      }
      var d = A.parseData(r.data), b = null; try { b = window.BARS.byId(id); } catch (x) {}
      var row = info(id);
      var nrow = { bar_id: String(id), name: (b && b.name) || (row && row.name) || "", lat: b ? b.lat : row && row.lat, lng: b ? b.lng : row && row.lng,
        yes: d.yes | 0, no: d.no | 0, owner: d.owner, shows: !!d.shows, mine: d.mine };
      cache.bars = cache.bars.filter(function (x) { return String(x.bar_id) !== String(id); }).concat([nrow]);
      document.querySelectorAll('[data-sptag="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id)) + '"]').forEach(function (x) { x.outerHTML = tagHTML(id); });
      A.toast(yes === null ? pick("u", T.undo) : sv() ? pick(yes ? "y" : "n", yes ? T.yesOk : T.noOk) : yes ? "📺 Thanks! Noted." : "👎 Thanks! Noted.");
      try { if (window.EVSHEET && window.EVSHEET.refreshPubs) window.EVSHEET.refreshPubs(); } catch (x) {}
    });
  }

  window.SPORT = {
    init: function (api) { A = api; document.addEventListener("click", onDocClick, true); },
    onAuthed: function () { pollAt = Date.now(); load(true); },
    onPoll: function () { if (Date.now() - pollAt < 10 * 60000) return; pollAt = Date.now(); load(true); },
    barPopupHTML: function (bar) { try { return barHTML(bar); } catch (e) { return ""; } },
    load: load, pubs: pubs, info: info, off: function () { return off; },
    _cache: function () { return cache; }, _set: function (bars) { cache = { at: Date.now(), key: cache.key, bars: bars || [] }; }
  };
})();
