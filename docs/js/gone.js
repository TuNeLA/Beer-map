/* Öl Nu — 🚫 STÄNGT FÖR GOTT: the crowd hides places that no longer exist (CONTRACT "🚫 STÄNGT FÖR GOTT", migrations 0147–0148).
   window.GONE, in app.js mods(): init, onAuthed, onPoll, barPopupHTML. No new map buttons.
   - Bar / place / arena sheet, ℹ️ Info fold: "🚫 Finns inte längre / Stängt för gott" → ONE confirm step ("Ja, stängt för gott" /
     "Avbryt") → report_bar_gone(bar_id, name). 2 different users, or 1 report from the owner's trusted phone
     (bar_area_trusted, "📱 Den här mobilen är min" in stats.html) = hidden for everyone. My own open report shows
     "✓ Du har rapporterat" with "↩️ Ta tillbaka" (report_bar_gone_withdraw).
   - Boot: the cached server list (localStorage "olnu.goneIds", from the last bars_gone()) is merged into BARS at once
     (BARS.closeIds, same effect as docs/bars-closed.json: bars, restaurants and arenas); after sign-in bars_gone() refreshes it
     (max every 30 min). An id the owner un-hides (Ångra in stats.html) shows again from the next start.
   - Old database (no RPC) = the button is not shown, nothing breaks. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, mine = {}, busy = false, fetchedAt = 0;
  var KEY = "olnu.goneIds", MINE = "olnu.goneMine", TTL = 30 * 60e3;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  var T = {
    btn: ["🚫 Finns inte längre / Stängt för gott", "🚫 Gone / closed for good"],
    ask: ["Säker? Stället ä stängt för gott – int' bara ikväll.", "Sure? The place is closed for good – not just tonight."],
    yes: ["Ja, stängt för gott", "Yes, closed for good"], no: ["Avbryt", "Cancel"],
    mineT: ["✓ Du har rapporterat att stället ä stängt. En till behövs.", "✓ You reported it closed. One more report is needed."],
    undo: ["↩️ Ta tillbaka", "↩️ Take it back"],
    hidden: [["🚫 Rapport mottagen. Stället ä struket från kartan – vila i frid.", "🚫 Högkvarteret bekräftar: stället ä borta. Kartan uppdaterad.",
      "🚫 Strukit ur registret. Truppen marscherar förbi det härifrån."], ["🚫 Thanks! The place is off the map."]],
    one: [["🚫 Tack, rapporten ä inne. En kompis till behöver bekräfta innan stället försvinner.", "🚫 Noterat i loggboken. En rapport till, så ä hä borta.",
      "🚫 Spaningsrapport mottagen. Väntar på en andra observatör."], ["🚫 Thanks! One more report is needed before it disappears."]],
    back: ["↩️ Rapporten tillbakatagen.", "↩️ Report taken back."],
    bad: ["Det här stället går int' att rapportera.", "This place can't be reported."],
    slow: ["Lugn i stormen – max 10 rapporter per dygn.", "Easy – max 10 reports a day."]
  };
  function two(k) { return L(T[k][0], T[k][1]); }
  function many(k) { return sv() ? pick(k, T[k][0]) : T[k][1][0]; }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var CSS = ".gone-sec{margin-top:10px;display:flex;flex-direction:column;gap:6px}" +
    ".gone-sec .gone-ask{margin:0;font-size:14px;line-height:1.35}" +
    ".gone-sec .gone-row{display:flex;gap:8px;flex-wrap:wrap}" +
    ".gone-sec .gone-mine{margin:0;font-size:13px;opacity:.85}";

  function apply(ids) { try { if (window.BARS && window.BARS.closeIds) return window.BARS.closeIds(ids); } catch (e) {} return 0; }
  function loadMine() { (lsGet(MINE, []) || []).forEach(function (id) { mine[id] = true; }); }
  function saveMine() { lsSet(MINE, Object.keys(mine).slice(-200)); }
  function refresh(force) {
    if (!A || !A.LIVE || off || busy || !A.authed || !A.authed()) return;
    if (!force && Date.now() - fetchedAt < TTL) return;
    busy = true;
    A.rpc("bars_gone", {}).then(function (r) {
      busy = false;
      if (r.error) { if (U.missing(r.error)) off = true; return; }
      var d = A.parseData(r.data); fetchedAt = Date.now();
      var ids = Array.isArray(d.ids) ? d.ids.map(String) : [];
      lsSet(KEY, { t: Date.now(), ids: ids });
      mine = {}; (Array.isArray(d.mine) ? d.mine : []).forEach(function (id) { mine[String(id)] = true; }); saveMine();
      apply(ids);
    }, function () { busy = false; });
  }
  function secHTML(bar) {
    var id = String(bar.id), esc = U.esc;
    if (mine[id]) return '<div class="gone-sec" data-gone-id="' + esc(id) + '"><p class="gone-mine">' + esc(two("mineT")) + '</p>' +
      '<div class="gone-row"><button type="button" class="btn btn-small" data-gone-undo="1">' + esc(two("undo")) + "</button></div></div>";
    return '<div class="gone-sec" data-gone-id="' + esc(id) + '"><button type="button" class="btn btn-small btn-block" data-gone="1">' + esc(two("btn")) + "</button></div>";
  }
  function barOf(id) {
    try { return window.BARS.byId(id) || null; } catch (e) { return null; }
  }
  function report(sec, id) {
    var b = barOf(id), name = b && b.name ? String(b.name).slice(0, 60) : null;
    sec.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
    A.rpc("report_bar_gone", { p_bar_id: id, p_name: name }).then(function (r) {
      if (r.error) {
        var m = String(r.error.message || "");
        if (U.missing(r.error)) { off = true; sec.remove(); return; }
        A.toast(/slow_down/.test(m) ? two("slow") : /invalid_bar/.test(m) ? two("bad") : A.errMsg(r.error), { err: true });
        sec.outerHTML = secHTML({ id: id });
        return;
      }
      var d = A.parseData(r.data);
      mine[id] = true; saveMine();
      if (d.hidden) {
        A.toast(many("hidden"), { id: "gone", ms: 4200 });
        var c = lsGet(KEY, { ids: [] }) || { ids: [] }; c.ids = (c.ids || []).concat([id]); lsSet(KEY, c);
        try { A.map.closePopup(); } catch (e) {}
        apply([id]);
      } else {
        A.toast(many("one"), { id: "gone", ms: 4200 });
        sec.outerHTML = secHTML({ id: id });
      }
    });
  }
  function withdraw(sec, id) {
    sec.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
    A.rpc("report_bar_gone_withdraw", { p_bar_id: id }).then(function (r) {
      if (r.error) { A.toast(A.errMsg(r.error), { err: true }); sec.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); return; }
      delete mine[id]; saveMine();
      A.toast(two("back"), { id: "gone" });
      sec.outerHTML = secHTML({ id: id });
    });
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-gone], [data-gone-yes], [data-gone-no], [data-gone-undo]") : null;
    if (!t) return;
    var sec = t.closest(".gone-sec"); if (!sec || !A) return;
    e.preventDefault(); e.stopPropagation();
    var id = sec.getAttribute("data-gone-id");
    if (t.hasAttribute("data-gone")) {   // step 1 → confirm
      sec.innerHTML = '<p class="gone-ask">' + U.esc(two("ask")) + '</p><div class="gone-row">' +
        '<button type="button" class="btn btn-small btn-danger" data-gone-yes="1">' + U.esc(two("yes")) + "</button>" +
        '<button type="button" class="btn btn-small" data-gone-no="1">' + U.esc(two("no")) + "</button></div>";
      return;
    }
    if (t.hasAttribute("data-gone-no")) { sec.outerHTML = secHTML({ id: id }); return; }
    if (t.hasAttribute("data-gone-yes")) { report(sec, id); return; }
    if (t.hasAttribute("data-gone-undo")) withdraw(sec, id);
  }

  window.GONE = {
    init: function (api) {
      A = api;
      var st = document.createElement("style"); st.id = "gone-css"; st.textContent = CSS; document.head.appendChild(st);
      loadMine();
      var c = lsGet(KEY, null); if (c && Array.isArray(c.ids)) apply(c.ids);   // cached server list: at once, before the data loads
      document.addEventListener("click", onClick, true);
    },
    onAuthed: function () { refresh(true); },
    onPoll: function () { refresh(false); },
    barPopupHTML: function (bar) {
      if (!A || !A.LIVE || off || !bar || bar.id == null || bar.user) return "";
      return secHTML(bar);
    },
    // tests
    _refresh: refresh, _mine: function () { return mine; }, T: T
  };
})();
