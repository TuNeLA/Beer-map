/* PintsNow — HOURSVOTE: "Stämmer öppettiderna?" on the bar sheet (lane places, E4, data-sources.md items 2 + 3; SQL 0532).
   PN.hoursvote = { init(api), html(bar), fetch(id), click(btn, bar, root) }. No window global. js/barinfo.js calls it:
   html() in the Opening hours part of the Info fold, fetch() on popupopen, click() for [data-hva] buttons, init() from its init.
   - The row: "Stämmer öppettiderna?" [Ja] [Nej] [Rätta]. No hours at all: "Vet du öppettiderna?" [Lägg till tider].
     After my answer: "Tack för ditt svar." + [Rätta]. Counts only, never who: "Bekräftat av 3 gäster · senast 12 nov".
   - Rätta / Lägg till = a sheet with 7 rows (Mån–Sön): opens, closes (after midnight is fine), "Stängt". Prefilled with the
     hours we show. Send = vote_bar_hours(bar, 'fix', week). My fix shows at once for me (OPPET.setFix "me"). For everybody
     when 2 different guests send the same week (or the owner sets it): the server answer has state.fixed → OPPET.setFix.
   - Closed-place signal (state.check: no check-in for 8 weeks, a "Finns inte längre" report or 2 "Nej"): "Finns stället
     kvar?" [Ja, det finns] (vote 'here') [Nej, stängt] (presses the existing js/gone.js button on the same card).
   - One text pop-up per tap: each answer gives ONE toast. Nothing pushes drinking; hours are facts.
   - Signed out, not LIVE, or the server has no 0532 (PGRST202) = the row is not there. Never breaks the card. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, state = {}, busy = {}, TTL = 90000;
  var DSV = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"], DEN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MSV = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  var MEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  function O() { return window.OPPET || null; }
  function live() { return !!(A && A.LIVE && A.authed && A.authed() && !off); }
  function sel(id) { return '.hv[data-hv="' + String(id).replace(/["\\]/g, "") + '"]'; }
  function dateTxt(ts) {
    var d = new Date(ts); if (!isFinite(d.getTime())) return "";
    return sv() ? d.getDate() + " " + MSV[d.getMonth()] : MEN[d.getMonth()] + " " + d.getDate();
  }
  function codeOf(e) { var m = String((e && (e.message || e.hint || e.details)) || ""); var x = m.match(/slow_down|invalid_hours|invalid_bar|invalid_kind|not_authenticated/); return x ? x[0] : ""; }
  function rpc(name, p) {
    return A.rpc(name, p).then(function (r) {
      if (r && r.error && U.missing && U.missing(r.error)) { off = true; r.off = true; }
      return r;
    }, function (e) { return { error: e || { message: "net" } }; });
  }

  /* ---------- the row ---------- */
  function inner(bar) {
    var id = String(bar.id), s = state[id] && state[id].d, o = O(), has = !!(o && o.hoursFor(bar));
    var h = "", c = (s && s.counts) || {};
    if (s && s.check) {
      h += '<div class="hv-q"><span class="hv-t">' + esc(L("Finns stället kvar?", "Is this place still here?")) + "</span>" +
        '<span class="hv-bs"><button type="button" class="hv-b" data-hva="here">' + esc(L("Ja, det finns", "Yes, it is")) + "</button>" +
        '<button type="button" class="hv-b" data-hva="gone">' + esc(L("Nej, stängt", "No, closed")) + "</button></span></div>";
    }
    if (c.yes > 0) h += '<div class="bi-r hv-n">' + esc(L("Bekräftat av ", "Confirmed by ") + c.yes + L(c.yes === 1 ? " gäst" : " gäster", c.yes === 1 ? " guest" : " guests") +
      (s.last_yes ? L(" · senast ", " · last ") + dateTxt(s.last_yes) : "")) + "</div>";
    if (s && s.mine) {
      h += '<div class="hv-q"><span class="hv-t muted">' + esc(L("Tack för ditt svar.", "Thanks for your answer.")) + "</span>" +
        '<span class="hv-bs"><button type="button" class="hv-b" data-hva="fix">' + esc(L("Rätta tiderna", "Fix the hours")) + "</button></span></div>";
    } else if (has) {
      h += '<div class="hv-q"><span class="hv-t">' + esc(L("Stämmer öppettiderna?", "Are these hours right?")) + "</span>" +
        '<span class="hv-bs"><button type="button" class="hv-b" data-hva="yes">' + esc(L("Ja", "Yes")) + "</button>" +
        '<button type="button" class="hv-b" data-hva="no">' + esc(L("Nej", "No")) + "</button>" +
        '<button type="button" class="hv-b" data-hva="fix">' + esc(L("Rätta", "Fix")) + "</button></span></div>";
    } else {
      h += '<div class="hv-q"><span class="hv-t">' + esc(L("Vet du öppettiderna?", "Do you know the hours?")) + "</span>" +
        '<span class="hv-bs"><button type="button" class="hv-b" data-hva="fix">' + esc(L("Lägg till tider", "Add hours")) + "</button></span></div>";
    }
    return h;
  }
  function html(bar) {
    if (!bar || bar.id == null || !live()) return "";
    return '<div class="hv" data-hv="' + esc(String(bar.id)) + '">' + inner(bar) + "</div>";
  }
  function paint(id) {
    var bar = barOf(id); if (!bar) return;
    document.querySelectorAll(sel(id)).forEach(function (x) { if (off) x.remove(); else x.innerHTML = inner(bar); });
  }
  function barOf(id) { try { return (window.BARS && window.BARS.byId(id)) || null; } catch (e) { return null; } }
  // → true when there is a live fix or the shown hours changed: the caller redraws the whole hours part
  function take(id, d) {
    if (!d || typeof d !== "object") return false;
    state[id] = { d: d, at: Date.now() };
    var o = O(), bar = barOf(id), was = o && bar ? JSON.stringify(o.hoursFor(bar)) : "";
    if (o && o.setFix && d.fixed && Array.isArray(d.fixed.w)) o.setFix(id, d.fixed.w, d.fixed.src, d.fixed.at);
    // a live fix: always redraw (bar_hours_fixes may have set it a moment before the card was drawn from OpenStreetMap)
    return !!(o && bar && (d.fixed || JSON.stringify(o.hoursFor(bar)) !== was));
  }
  // cb(changed): js/barinfo.js redraws its hours part when a live fix changed what we show
  function fetch(id, force, cb) {
    id = String(id);
    if (!live() || busy[id]) return;
    try { var o = O(); if (o && o.loadFixes) o.loadFixes(false); } catch (e) {}
    if (!force && state[id] && Date.now() - state[id].at < TTL) return;
    busy[id] = true;
    rpc("bar_hours_state", { p_bar_id: id }).then(function (r) {
      busy[id] = false;
      if (r.error) { if (r.off) paint(id); return; }
      var ch = take(id, A.parseData(r.data)); paint(id);
      if (cb) try { cb(ch); } catch (e) {}
    });
  }

  /* ---------- answers ---------- */
  function errToast(r) {
    var m = { slow_down: L("Du har redan svarat. Försök igen om en stund.", "You already answered. Try again in a while."),
      invalid_hours: L("Kolla tiderna: öppnar och stänger per dag.", "Check the hours: opens and closes per day.") }[codeOf(r.error)];
    A.toast(m || L("Gick inte att skicka. Försök igen.", "Could not send. Try again."), { err: true, ms: 4500 });
  }
  function vote(bar, kind, week, done) {
    var id = String(bar.id);
    return rpc("vote_bar_hours", { p_bar_id: id, p_kind: kind, p_week: week || null }).then(function (r) {
      if (r.error) { if (r.off) { paint(id); A.toast(L("Funktionen är inte på än.", "This is not switched on yet."), { ms: 3500 }); } else errToast(r); return null; }
      var d = A.parseData(r.data); take(id, d); paint(id);
      if (done) done(d);
      return d;
    });
  }
  function click(b, bar, root) {
    var a = b.getAttribute("data-hva");
    if (!bar || !live()) return;
    if (a === "fix") { fixSheet(bar); return; }
    if (a === "gone") {   // the existing "Finns inte längre / Stängt för gott" flow of js/gone.js (one confirm step)
      var g = (root || document).querySelector('[data-gone-id="' + String(bar.id).replace(/["\\]/g, "") + '"] [data-gone]');
      if (g) g.click(); else A.toast(L("Använd \"Finns inte längre\" längre ner.", "Use \"Gone\" further down."), { ms: 3500 });
      return;
    }
    b.disabled = true;
    vote(bar, a, null, function () {
      A.toast(a === "yes" ? L("Tack! Fler ser nu att tiderna stämmer.", "Thanks! Others now see the hours are right.") :
        a === "no" ? L("Tack! Vet du rätt tider? Tryck Rätta.", "Thanks! Know the right hours? Tap Fix.") :
        L("Tack! Stället finns kvar på kartan.", "Thanks! The place stays on the map."), { ms: 3500 });
    }).then(function () { b.disabled = false; });
  }

  /* ---------- the fix sheet ---------- */
  function toHM(m) { m = ((m % 1440) + 1440) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  // "16:00", "16.00", "1600", "16" → minutes (24 h clock). Text fields, not type=time: a 12 h browser showed "04:00 PM" cut off.
  function toMin(v) {
    var t = String(v || "").trim().replace(/[.,;h ]/g, ":"), m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t);
    if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h === 24 && mi === 0) return 0;
    return h < 24 && mi < 60 ? h * 60 + mi : null;
  }
  // one day: [open "HH:MM", close "HH:MM", closed] → "start-end" ("" = closed). A close at or before the open = after midnight.
  function dayStr(open, close, closed) {
    if (closed) return "";
    var a = toMin(open), z = toMin(close);
    if (a == null || z == null) return null;
    if (z <= a) z += 1440;
    return a + "-" + z;
  }
  function weekOf(rows) {
    var w = [];
    for (var i = 0; i < rows.length; i++) { var s = dayStr(rows[i].o.value, rows[i].c.value, rows[i].x.getAttribute("aria-pressed") === "true"); if (s == null) return null; w.push(s); }
    return w;
  }
  function fixSheet(bar) {
    var o = O(), cur = o ? o.hoursFor(bar) : null, id = String(bar.id);
    try { A.map.closePopup(); } catch (e) {}
    A.openSheet(L("Rätta öppettiderna", "Fix the opening hours"), function (body) {
      var el = A.el, rows = [];
      body.classList.add("hv-sheet");
      body.appendChild(el("p", { class: "muted hv-info", text: (bar.name || "") + " · " + L("Tiderna syns för alla när två gäster skickar samma tider.",
        "Everybody sees the hours when two guests send the same hours.") }));
      var grid = el("div", { class: "hv-grid", role: "group", "aria-label": L("Öppettider per dag", "Hours per day") });
      for (var d = 0; d < 7; d++) {
        var parts = o && cur ? o.day(cur, d) : [], p = parts[0] || null;
        var oi = el("input", { class: "inp hv-tm", type: "text", inputmode: "numeric", maxlength: "5", autocomplete: "off", placeholder: "16:00",
          value: p ? toHM(p[0]) : "", "aria-label": (sv() ? DSV : DEN)[d] + L(" öppnar", " opens") });
        var ci = el("input", { class: "inp hv-tm", type: "text", inputmode: "numeric", maxlength: "5", autocomplete: "off", placeholder: "01:00",
          value: p ? toHM(p[1]) : "", "aria-label": (sv() ? DSV : DEN)[d] + L(" stänger", " closes") });
        var x = el("button", { type: "button", class: "hv-x", "aria-pressed": String(!!cur && !p), text: L("Stängt", "Closed") });
        (function (oi, ci, x) {
          x.addEventListener("click", function () { var on = x.getAttribute("aria-pressed") !== "true"; x.setAttribute("aria-pressed", String(on)); oi.disabled = ci.disabled = on; });
          oi.disabled = ci.disabled = x.getAttribute("aria-pressed") === "true";
        })(oi, ci, x);
        rows.push({ o: oi, c: ci, x: x });
        grid.appendChild(el("div", { class: "hv-day" }, [el("span", { class: "hv-dn", text: (sv() ? DSV : DEN)[d] }), oi, el("span", { class: "hv-to", "aria-hidden": "true", text: "–" }), ci, x]));
      }
      body.appendChild(grid);
      body.appendChild(el("p", { class: "muted hv-note", text: L("Stänger efter midnatt? Skriv t.ex. 02:00, det blir natten efter.", "Closes after midnight? Type e.g. 02:00, it means that night.") }));
      var send = A.btn(L("Skicka", "Send"), "btn-amber btn-block", function () {
        var w = weekOf(rows);
        if (!w) { A.toast(L("Fyll i öppnar och stänger, eller tryck Stängt.", "Fill in opens and closes, or tap Closed."), { err: true, ms: 3500 }); return; }
        send.disabled = true;
        vote(bar, "fix", w, function (s) {
          var o2 = O(), shown = s && s.fixed && JSON.stringify(s.fixed.w) === JSON.stringify(w);
          if (o2 && o2.setFix) o2.setFix(id, w, "me");
          A.closeSheet();
          A.toast(shown ? L("Tack! Nu visas de nya tiderna för alla.", "Thanks! Everybody now sees the new hours.") :
            L("Tack! Du ser dina tider nu. Alla ser dem när en gäst till skickar samma.", "Thanks! You see your hours now. Everybody sees them when one more guest sends the same."), { ms: 4500 });
        }).then(function () { send.disabled = false; });
      });
      body.appendChild(send);
    });
  }

  (window.PN = window.PN || {}).hoursvote = {
    init: function (api) { A = api; },
    html: html, fetch: fetch, click: click,
    // tests
    _state: state, _day: dayStr, _off: function () { return off; }
  };
})();
