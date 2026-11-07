/* Öl Nu — 🔙 SHEETNAV (owner 2026-11-07, Android feedback): back goes ONE step, the grab handle works.
   1. A history stack for the ONE app sheet (#sheet). Every level gets a history.pushState entry, so the Android
      back gesture / button (popstate) goes back one step: sub-view → previous sheet → close the sheet → only then
      leave the app. Levels:
        base   the sheet is open (back = close it)
        sheet  a sheet that replaced an open sheet (back = open the previous sheet again: its title + build are
               kept, plus its gpage view (data-gv) and scroll position)
        sub    an in-place sub-view: gpage "+" / "⋯" (data-gv ≠ home, seen with a MutationObserver) or a module
               panel (SHEETNAV.sub(undo) → done()). Back = undo.
        popup  a Leaflet bar sheet (.leaflet-popup) while #sheet is closed (back = close the popup).
      Replace rules in app.js openSheet (hook willOpen): same title = refresh in place (no level); a tab tap
      ([role=tab], .tabs/.seg button) = in place; the title of an earlier level = back to that level (Avbryt/Klar →
      Grupper); else a new "sheet" level.
   2. The ← / ‹ buttons at the top of sub-views: a capture click listener marks "back intent". If that click then
      opens a sheet (most of them call A.showGroups()) or closes it, the sheet goes back ONE level instead. Their own
      clean-up code still runs.
   3. Grab handle: drag the grip or the sheet head down → the sheet follows; release past 28 % of its height or
      fast (≥ 0.55 px/ms) → it slides away and closes; else it springs back. Up = rubber band (no half state).
   4. #sheet gets .sn-tall when it holds the Grupper | Vänner | Inkorg tabs → one constant height (ux3.css).
   app.js hooks (patch ux3/01): willOpen(title, build, opts, isOpen) → null | [title, build, opts]; didOpen(title,
   build, opts); willClose(reason) → true = handled (went back a step); didClose().
   Public: window.SHEETNAV = { init, willOpen, didOpen, willClose, didClose, back, sub, depth, _levels }. */
(function () {
  "use strict";
  var A = null;
  var levels = [], cur = null;            // cur = [title, build, opts] of the sheet on screen
  var ignorePop = 0, pendingUnwind = 0, replay = false, closingNav = false;
  var backIntent = false, tabIntent = false, restoring = false;
  function $(id) { return document.getElementById(id); }
  function sheet() { return $("sheet"); }
  function sbody() { return $("sheet-body"); }
  function isOpen() { var s = sheet(); return !!(s && !s.hidden); }
  function push() {
    try { history.pushState({ olnuNav: levels.length }, ""); } catch (e) {}
  }
  function unwind(n) {
    if (n <= 0) return;
    ignorePop++;
    try { history.go(-n); } catch (e) { ignorePop--; }
  }
  function gvWrap() { var b = sbody(); return b ? b.querySelector("[data-gv]") : null; }
  function topLevel() { return levels[levels.length - 1] || null; }

  /* ---------- open / close hooks (from app.js) ---------- */
  function willOpen(title, build, opts, open) {
    if (replay) return null;
    if (!open) {
      // A fresh open. A sheet that closed in this same task (close → open) keeps one of its history entries.
      if (pendingUnwind > 0) { var keep = pendingUnwind; pendingUnwind = 0; levels = [{ kind: "base" }]; unwind(keep - 1); }
      else if (levels.length === 1 && levels[0].kind === "popup") levels = [{ kind: "base" }];   // the bar sheet's entry is reused
      else { levels = [{ kind: "base" }]; push(); }
      return null;
    }
    if (levels.length === 0) { levels = [{ kind: "base" }]; push(); }   // opened before this module started
    if (backIntent) {
      backIntent = false;
      var n = 0;
      while (levels.length > 1 && topLevel().kind === "sub") { levels.pop(); n++; }
      if (levels.length > 1 && topLevel().kind === "sheet") {
        var lv = levels.pop(); n++;
        unwind(n);
        pendingRestore = lv;
        var o = {}; Object.keys(lv.entry[2] || {}).forEach(function (k) { o[k] = lv.entry[2][k]; }); o.now = true;
        return [lv.entry[0], lv.entry[1], o];
      }
      unwind(n);
      return null;   // nothing to go back to: the button does what it says, in place
    }
    if (tabIntent || same(cur, title, build)) {
      // In place: a tab or a refresh of the same sheet. Its own sub-views end.
      var k = 0; while (levels.length > 1 && topLevel().kind === "sub") { levels.pop(); k++; }
      unwind(k);
      return null;
    }
    for (var i = levels.length - 1; i >= 1; i--) {
      if (levels[i].kind === "sheet" && same(levels[i].entry, title, build)) {
        var m = levels.length - i; levels.length = i; unwind(m);
        return null;
      }
    }
    if (cur) {
      var w = gvWrap(), b = sbody();
      levels.push({ kind: "sheet", entry: cur, gv: w ? w.getAttribute("data-gv") : null, scroll: b ? b.scrollTop : 0 });
      push();
    }
    return null;
  }
  var pendingRestore = null;
  // The same sheet again = same title AND the same build code (a refresh). Same title, other code = a new view
  // (the group page and its member list are both called by the group's name).
  function src(f) { try { return f.__snSrc || (f.__snSrc = String(f)); } catch (e) { return ""; } }
  function same(entry, title, build) { return !!entry && entry[0] === title && src(entry[1]) === src(build); }
  function didOpen(title, build, opts) {
    cur = [title, build, opts || {}];
    var s = sheet(), b = sbody();
    if (s && b) s.classList.toggle("sn-tall", !!b.querySelector(".inv-tabs"));
    if (pendingRestore) { var lv = pendingRestore; pendingRestore = null; restore(lv); }
    watchGv();
  }
  // Back on a sheet level: its gpage view and scroll come back; the sub level under it points at the new wrap.
  function restore(lv) {
    var tries = 0;
    (function go() {
      var w = gvWrap(), b = sbody();
      if (lv.gv && lv.gv !== "home") {
        if (!w && tries++ < 8) { setTimeout(go, 60); return; }
        if (w) {
          restoring = true;
          try { if (window.GPAGE && window.GPAGE.view) window.GPAGE.view(w, lv.gv); else w.setAttribute("data-gv", lv.gv); } catch (e) {}
          setTimeout(function () { restoring = false; }, 0);
          var t = topLevel(); if (t && t.kind === "sub" && !t.undo) t.wrap = w;
        }
      }
      if (b && lv.scroll) setTimeout(function () { try { b.scrollTop = lv.scroll; } catch (e) {} }, 30);
    })();
  }
  function willClose() {
    if (closingNav) return false;
    if (backIntent && levels.length > 1) { backIntent = false; back(false); return true; }
    return false;
  }
  function didClose() {
    var s = sheet(); if (s) s.classList.remove("sn-tall");
    cur = null;
    if (closingNav) { levels = []; return; }
    var n = levels.filter(function (l) { return l.kind !== "popup"; }).length;
    levels = levels.filter(function (l) { return l.kind === "popup"; });
    if (n > 0) {
      pendingUnwind += n;
      setTimeout(function () { if (pendingUnwind > 0) { var x = pendingUnwind; pendingUnwind = 0; unwind(x); } }, 0);
    }
  }

  /* ---------- one step back ---------- */
  function back(fromPop) {
    var t = levels.pop();
    if (!t) return false;
    if (!fromPop) { ignorePop++; try { history.back(); } catch (e) { ignorePop--; } }
    if (t.kind === "sub") {
      restoring = true;
      try {
        if (t.undo) t.undo();
        else {
          var w = t.wrap && document.body.contains(t.wrap) ? t.wrap : gvWrap();
          if (w) { if (window.GPAGE && window.GPAGE.view) window.GPAGE.view(w, "home"); else w.setAttribute("data-gv", "home"); }
        }
      } catch (e) {}
      setTimeout(function () { restoring = false; }, 0);
    } else if (t.kind === "sheet") {
      var o = {}; Object.keys(t.entry[2] || {}).forEach(function (k) { o[k] = t.entry[2][k]; }); o.now = true;
      replay = true;
      try { A.openSheet(t.entry[0], t.entry[1], o); } catch (e) {}
      replay = false;
      restore(t);
    } else if (t.kind === "base") {
      closingNav = true;
      try { A.closeSheet("cancel"); } catch (e) {}
      closingNav = false;
    } else if (t.kind === "popup") {
      try { if (A.map && A.map.closePopup) A.map.closePopup(); } catch (e) {}
    }
    return true;
  }
  window.addEventListener("popstate", function (e) {
    if (ignorePop > 0) { ignorePop--; return; }
    var d = e.state && typeof e.state.olnuNav === "number" ? e.state.olnuNav : 0;
    var guard = 20;
    while (levels.length > d && guard-- > 0) back(true);
  });

  /* ---------- sub-views ---------- */
  // Generic: a module panel inside the sheet. Returns done() for when the panel closes by itself.
  function sub(undo) {
    if (!isOpen()) return function () {};
    if (levels.length === 0) { levels = [{ kind: "base" }]; push(); }
    var lv = { kind: "sub", undo: undo };
    levels.push(lv); push();
    return function done() {
      var i = levels.indexOf(lv); if (i < 0) return;
      if (i === levels.length - 1) { levels.pop(); ignorePop++; try { history.back(); } catch (e) { ignorePop--; } }
      else lv.undo = function () {};
    };
  }
  var gvObs = null;
  function watchGv() {
    var b = sbody(); if (gvObs || !b || !window.MutationObserver) return;
    gvObs = new MutationObserver(function (ms) {
      if (restoring || !isOpen()) return;
      ms.forEach(function (m) {
        var w = m.target, v = w.getAttribute("data-gv"), old = m.oldValue;
        if (old == null || v === old) return;
        if (v !== "home" && old === "home") { levels.push({ kind: "sub", wrap: w }); push(); }
        else if (v === "home") {
          var t = topLevel();
          if (t && t.kind === "sub" && !t.undo) { levels.pop(); ignorePop++; try { history.back(); } catch (e) { ignorePop--; } }
        }
      });
    });
    gvObs.observe(b, { subtree: true, attributes: true, attributeFilter: ["data-gv"], attributeOldValue: true });
  }

  /* ---------- back / tab intent (capture, before the buttons' own handlers) ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var s = sheet(); if (!s || !s.contains(t)) return;
    var b = t.closest("button, [role=button], a"); if (!b) return;
    var txt = String(b.textContent || "").trim();
    if (/^[←‹]/.test(txt) || b.classList.contains("g-back")) {
      backIntent = true; setTimeout(function () { backIntent = false; }, 0);
    } else if (b.closest("[role=tab], [role=tablist], .tabs, .seg, .tt-bar")) {
      tabIntent = true; setTimeout(function () { tabIntent = false; }, 0);
    }
  }, true);

  /* ---------- grab handle: drag down to close ---------- */
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function initDrag() {
    var s = sheet(); if (!s) return;
    var st = null;
    s.addEventListener("pointerdown", function (e) {
      if (e.button > 0 || !isOpen()) return;
      var t = e.target; if (!t || !t.closest) return;
      if (!t.closest(".sheet-grip, .sheet-head") || t.closest("button, a, input, select, textarea")) return;
      st = { id: e.pointerId, y0: e.clientY, dy: 0, h: s.getBoundingClientRect().height || 400, pts: [[e.timeStamp || Date.now(), e.clientY]], moved: false };
      try { s.setPointerCapture(e.pointerId); } catch (x) {}
    });
    s.addEventListener("pointermove", function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dy = e.clientY - st.y0;
      if (!st.moved && Math.abs(dy) < 4) return;
      if (!st.moved) { st.moved = true; s.classList.add("sn-drag"); s.style.animation = "none"; }   // grip-noreplay: no smSheetIn replay at release
      st.dy = dy;
      var y = dy > 0 ? dy : -Math.pow(-dy, 0.7);   // up: rubber band
      s.style.transform = "translateY(" + y + "px)";
      var bd = $("backdrop"); if (bd) bd.style.opacity = String(Math.max(0.15, 1 - Math.max(0, dy) / st.h));
      st.pts.push([e.timeStamp || Date.now(), e.clientY]); if (st.pts.length > 6) st.pts.shift();
      e.preventDefault();
    });
    function end(e) {
      if (!st || (e && e.pointerId !== st.id)) return;
      var x = st; st = null;
      try { s.releasePointerCapture(x.id); } catch (er) {}
      if (!x.moved) return;
      var p0 = x.pts[0], p1 = x.pts[x.pts.length - 1], dt = Math.max(1, p1[0] - p0[0]), v = (p1[1] - p0[1]) / dt;
      var bd = $("backdrop");
      var close = x.dy > x.h * 0.28 || (v > 0.55 && x.dy > 24);
      s.classList.remove("sn-drag");
      if (close) {
        var ms = reduced() ? 0 : Math.max(90, Math.min(220, (x.h - x.dy) / Math.max(v, 1.2)));
        s.style.transition = "transform " + ms + "ms cubic-bezier(.2,.7,.4,1)";
        s.style.transform = "translateY(" + (x.h + 40) + "px)";
        if (bd) { bd.style.transition = "opacity " + ms + "ms linear"; bd.style.opacity = "0"; }
        setTimeout(function () {
          s.hidden = true;   // no slide-down ghost: the sheet is already gone
          try { A.closeSheet("cancel"); } catch (er) {}
          s.style.transition = ""; s.style.transform = "";
          if (bd) { bd.style.transition = ""; bd.style.opacity = ""; }
        }, ms + 10);
      } else {
        s.style.transition = reduced() ? "none" : "transform 220ms cubic-bezier(.2,.9,.3,1.2)";
        s.style.transform = "";
        if (bd) { bd.style.transition = "opacity 200ms linear"; bd.style.opacity = ""; }
        setTimeout(function () { s.style.transition = ""; if (bd) bd.style.transition = ""; }, 260);
      }
    }
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    // grip-noreplay: the next open of the sheet animates in again.
    try { new MutationObserver(function () { if (s.hidden && s.style.animation) s.style.animation = ""; }).observe(s, { attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
  }

  /* ---------- Leaflet bar sheet (popup) while #sheet is closed ---------- */
  function initPopup() {
    var m = A && A.map; if (!m || !m.on) return;
    m.on("popupopen", function () {
      if (isOpen()) return;
      var t = topLevel(); if (t && t.kind === "popup") return;
      if (levels.length) return;
      levels.push({ kind: "popup" }); push();
    });
    m.on("popupclose", function () {
      setTimeout(function () {
        var t = topLevel(); if (!t || t.kind !== "popup") return;
        if (document.querySelector(".leaflet-popup")) return;   // a redraw reopened it
        levels.pop(); ignorePop++; try { history.back(); } catch (e) { ignorePop--; }
      }, 160);
    });
  }

  window.SHEETNAV = {
    init: function (api) { A = api; initDrag(); try { initPopup(); } catch (e) {} watchGv(); },
    willOpen: willOpen, didOpen: didOpen, willClose: willClose, didClose: didClose,
    back: function () { return back(false); }, sub: sub,
    depth: function () { return levels.length; }, _levels: function () { return levels.map(function (l) { return l.kind + (l.entry ? ":" + l.entry[0] : ""); }); }
  };
})();
