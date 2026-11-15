/* PintsNow — soft scroll edges for sheets (lane d-profile, owner I-114). Styles + the idea: sheetfade.css.
   Scroll areas: #sheet-body (every app sheet) and the bar sheet (.olnu-sheet .leaflet-popup-content: bottom edge only,
   its sticky head owns the top). One passive scroll listener (capture, rAF-throttled) + a re-check when the content
   changes (MutationObserver / ResizeObserver, a tap, a sheet opening). Reads: scrollTop, scrollHeight, clientHeight
   (+ two rects when the sheet has a fixed bar). Writes only when a value changed.
   A bar that sticks to the top of the scroll area (a direct child, or the first child of the first child; position sticky
   with a top) is never masked: the top fade starts under it (--sf-head).
   A bar fixed at the bottom of the scroll area (position sticky / fixed with a bottom) is never masked:
     - a solid bar (.sheet-foot, [data-sheet-foot], or any sticky bar among the last children of the body, 3 levels down): the fade ends at
       its top edge (--sf-foot);
     - a floating bar (FLOAT: it has its own gradient or lets the list show around it): no bottom fade at all;
     - a fixed bar that is not inside the scroll box: no mask at all (a mask would cut it off).
   Public: window.SHEETFADE = { sync(), _state(el) }. */
(function () {
  "use strict";
  var W = window, D = document;
  var TOP = 16, BOT = 28;
  var AREAS = [["#sheet-body", true], [".olnu-sheet .leaflet-popup-content", false]];
  var SOLID = ".sheet-foot, [data-sheet-foot], .wh-foot";   // .wh-foot = the fixed "Hemma eller annan plats" row of the where-sheet (lane d-beer)
  var FLOAT = ".gpg-bar, .gg-sticky";
  var raf = 0, dirty = true, feet = W.WeakMap ? new WeakMap() : null, heads = W.WeakMap ? new WeakMap() : null;

  function shown(n) { return !!(n && n.isConnected && (n.offsetWidth || n.offsetHeight)); }
  function fixedBar(n) {
    var cs; try { cs = getComputedStyle(n); } catch (e) { return ""; }
    return (cs.position === "sticky" || cs.position === "fixed") && cs.bottom !== "auto" ? cs.position : "";
  }
  // the last 2 shown children, 3 levels down the end of the body (a bar that sticks to the bottom is at the end of its box)
  function scan(n, depth, out) {
    var c = n.lastElementChild, k = 0;
    while (c && k < 2) {
      if (shown(c)) { k++; if (fixedBar(c)) out.push(c); else if (depth < 3) scan(c, depth + 1, out); }
      c = c.previousElementSibling;
    }
  }
  function findFoot(el) {
    if (!dirty && feet && feet.has(el)) { var f0 = feet.get(el); if (!f0 || f0.el.isConnected) return f0; }
    var f = null, i, list = el.querySelectorAll(FLOAT);
    for (i = 0; i < list.length && !f; i++) if (shown(list[i])) f = { el: list[i], float: true };
    if (!f) { list = el.querySelectorAll(SOLID); for (i = 0; i < list.length && !f; i++) if (shown(list[i])) f = { el: list[i], float: false }; }
    if (!f) { var out = []; scan(el, 1, out); if (out.length) f = { el: out[0], float: false }; }
    if (feet) feet.set(el, f);
    return f;
  }
  // a bar that sticks to the TOP of the scroll area (Profil | Inställningar, Grupper | Vänner | Inkorg …): one of the first 2
  // shown children of the body, position sticky with a top. The top fade starts under it (--sf-head), the bar stays crisp.
  // uifix3 (I-123): also one level down, when the sheet puts everything in one wrapper (the character creator: .avw > .avw-top)
  function headIn(n, depth) {
    var c = n.firstElementChild, k = 0, f = null;
    while (c && k < 2 && !f) {
      if (shown(c)) { k++; var cs = getComputedStyle(c); if (cs.position === "sticky" && cs.top !== "auto") f = c; else if (depth < 2 && k === 1) f = headIn(c, depth + 1); }
      c = c.nextElementSibling;
    }
    return f;
  }
  function findHead(el) {
    if (!dirty && heads && heads.has(el)) { var h0 = heads.get(el); if (!h0 || h0.isConnected) return h0; }
    var f = headIn(el, 1);
    if (heads) heads.set(el, f);
    return f;
  }
  function put(el, cls, name, v) {
    var on = v > 0;
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
    var s = v + "px";
    if (el.style.getPropertyValue(name) !== (on ? s : "")) { if (on) el.style.setProperty(name, s); else el.style.removeProperty(name); }
  }
  function one(el, top) {
    var t = 0, b = 0, fh = 0, hh = 0;
    if (shown(el) && el.clientHeight > 0) {
      var st = el.scrollTop, rem = el.scrollHeight - el.clientHeight - st;
      t = top ? Math.min(TOP, Math.max(0, Math.floor(st))) : 0;
      b = Math.min(BOT, Math.max(0, Math.floor(rem)));
      if (t < 2) t = 0;
      if (b < 2) b = 0;
      if (t || b) {
        var f = findFoot(el);
        var kind = f && shown(f.el) ? fixedBar(f.el) : "";   // "" = a normal block in the flow (not fixed now): plain content
        if (kind) {
          if (f.float) b = 0;
          else {
            var fr = f.el.getBoundingClientRect(), er = el.getBoundingClientRect(), inside = fr.bottom <= er.bottom + 1 && fr.top >= er.top;
            if (kind === "fixed" && !inside) { t = 0; b = 0; }                                       // a fixed bar outside the scroll box: a mask would cut it off
            else if (inside && fr.bottom >= er.bottom - 24) fh = Math.min(Math.round(er.bottom - fr.top), Math.round(er.height * 0.6));   // stuck at the bottom now
          }
        }
      }
    }
    if (t) {
      var hd = findHead(el);
      if (hd && shown(hd)) {
        var hr = hd.getBoundingClientRect(), br = el.getBoundingClientRect();
        if (hr.top <= br.top + 20 && hr.bottom > br.top) hh = Math.min(Math.round(hr.bottom - br.top), Math.round(br.height * 0.4));   // stuck at the top now
      }
    }
    put(el, "sf-top", "--sf-t", t);
    put(el, "sf-bot", "--sf-b", b);
    var fs = fh > 0 && b > 0 ? fh + "px" : "";
    if (el.style.getPropertyValue("--sf-foot") !== fs) { if (fs) el.style.setProperty("--sf-foot", fs); else el.style.removeProperty("--sf-foot"); }
    var hs = hh > 0 && t > 0 ? hh + "px" : "";
    if (el.style.getPropertyValue("--sf-head") !== hs) { if (hs) el.style.setProperty("--sf-head", hs); else el.style.removeProperty("--sf-head"); }
  }
  function sync() {
    raf = 0;
    for (var i = 0; i < AREAS.length; i++) {
      var list = AREAS[i][0].charAt(0) === "#" ? [D.getElementById(AREAS[i][0].slice(1))] : D.querySelectorAll(AREAS[i][0]);
      for (var j = 0; j < list.length; j++) if (list[j]) { try { one(list[j], AREAS[i][1]); } catch (e) {} }
    }
    dirty = false;
  }
  function soon() { if (!raf) raf = (W.requestAnimationFrame || setTimeout)(sync); }
  function changed() { dirty = true; soon(); }
  function later() { changed(); [120, 400, 900].forEach(function (ms) { setTimeout(changed, ms); }); }
  function isArea(n) { return !!(n && n.nodeType === 1 && (n.id === "sheet-body" || (n.classList && n.classList.contains("leaflet-popup-content")))); }

  D.addEventListener("scroll", function (e) { if (isArea(e.target)) soon(); }, { capture: true, passive: true });
  D.addEventListener("click", function () { later(); }, { capture: true, passive: true });   // a fold opens, a tab changes: the height changes
  W.addEventListener("resize", changed, { passive: true });
  function start() {
    var body = D.getElementById("sheet-body"), sheet = D.getElementById("sheet");
    if (W.MutationObserver) {
      if (body) new MutationObserver(changed).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
      if (sheet) new MutationObserver(later).observe(sheet, { attributes: true, attributeFilter: ["hidden", "class"] });
      new MutationObserver(later).observe(D.body, { attributes: true, attributeFilter: ["class"] });   // body.barsheet-open: the bar sheet came or went
    }
    if (W.ResizeObserver && body) { try { new ResizeObserver(changed).observe(body); } catch (e) {} }
    later();
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();

  W.SHEETFADE = {
    sync: function () { dirty = true; sync(); },
    _state: function (el) { el = el || D.getElementById("sheet-body"); return { top: el.classList.contains("sf-top"), bot: el.classList.contains("sf-bot"),
      t: el.style.getPropertyValue("--sf-t"), b: el.style.getPropertyValue("--sf-b"), foot: el.style.getPropertyValue("--sf-foot"), head: el.style.getPropertyValue("--sf-head") }; }
  };
})();
