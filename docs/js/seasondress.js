/* PintsNow — ÖL! BUTTON DRESS (lane seasons, owner 15 Nov 2026, I-117: "Snow on the beer button looks nice. New Year's
   little hat, midsummer, Valborg, autumn: I think it looks great." / "Maybe we can change the colour of the beer button as
   well." / "In Christmas we have glögg instead of beer."). window.PNDress. Styles: docs/season.css.
   - One small drawn piece on the top-RIGHT rim of the ÖL! button (top-left is Annat): Santa hat (Christmas), party hat
     (New Year), flower crown (Midsummer, across the top rim), student cap (Valborg), leaves + acorn (October). Snow lies on
     the top rim when it snows. It never takes a tap (pointer-events: none), never covers the label, the timer or "Ångra".
     It goes down with the pressed button and hops once after the tap. Reduced motion: no hop.
   - The button colour per season (body.ss-c-<season>): Christmas, New Year, Valborg, Midsummer, Autumn. Normal days keep
     today's amber. The wait (pint glass + timer) and "Ångra" keep their own look (the colour is for the button at rest).
   - Christmas 1 - 26 Dec: the button says GLÖGG with a small mug (I18N "beer" = "GLÖGG"). It is still ONE drink, exactly
     as before: only the look changes (no new drink type, no new RPC).
   - Map decorations are allowed in store builds; so is the dress (no drinking celebration in it).
   - Kill switch: PNSeason.off() (?seasons=0 / PN.CFG.seasons === false). */
(function () {
  "use strict";
  var W = window, D = W.document;
  var el = null, mug = null, cur = "", curC = "", curG = null, hopT = 0;
  // the pieces (inline SVG, drawn for a 56 × 48 box unless said)
  var SVG = {
    santa: '<svg viewBox="0 0 64 56" aria-hidden="true"><defs><linearGradient id="ss-sr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a5a"/><stop offset=".55" stop-color="#d8202c"/><stop offset="1" stop-color="#8e0b15"/></linearGradient>' +
      '<radialGradient id="ss-sw" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6ee"/></radialGradient></defs>' +
      '<path d="M8 42C10 24 24 9 42 7c9-1 15 3 17 10-7-3-13 0-15 7-2 7 0 13 4 18Z" fill="url(#ss-sr)"/>' +
      '<path d="M22 20c6-7 14-10 22-10" stroke="#ff9e9e" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55"/>' +
      '<rect x="3" y="37" width="50" height="14" rx="7" fill="url(#ss-sw)"/><path d="M8 42h40" stroke="#c9d3de" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>' +
      '<circle cx="58" cy="18" r="7" fill="url(#ss-sw)"/><circle cx="56" cy="16" r="2.2" fill="#fff"/></svg>',
    party: '<svg viewBox="0 0 64 56" aria-hidden="true"><defs><linearGradient id="ss-pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9820f"/><stop offset=".45" stop-color="#ffe08a"/><stop offset="1" stop-color="#c48a12"/></linearGradient>' +
      '<clipPath id="ss-pc"><path d="M14 48 34 4 54 48Z"/></clipPath></defs>' +
      '<path d="M14 48 34 4 54 48Z" fill="url(#ss-pg)"/>' +
      '<g clip-path="url(#ss-pc)" fill="#ff4fa0"><path d="M10 38 58 26v6L10 44Z"/><path d="M10 22 58 10v6L10 28Z" fill="#3d7bff"/></g>' +
      '<g fill="#fff6c8"><circle cx="26" cy="36" r="1.6"/><circle cx="40" cy="30" r="1.6"/><circle cx="33" cy="18" r="1.4"/><circle cx="44" cy="42" r="1.6"/></g>' +
      '<ellipse cx="34" cy="48" rx="21" ry="4.5" fill="#ffe7a0"/><path d="M15 48c6 3 32 3 38 0" stroke="#b9820f" stroke-width="1.4" fill="none"/>' +
      '<g transform="translate(34 6)"><circle r="6" fill="#ff4fa0"/><path d="M-7 0h14M0-7v14M-5-5l10 10M5-5-5 5" stroke="#ffd2e8" stroke-width="2" stroke-linecap="round"/></g>' +
      '<path d="M57 10l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#fff3b0"/></svg>',
    cap: '<svg viewBox="0 0 64 56" aria-hidden="true"><defs><linearGradient id="ss-cw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7dce6"/></linearGradient></defs>' +
      '<ellipse cx="36" cy="45" rx="23" ry="6" fill="#121318"/>' +
      '<ellipse cx="32" cy="22" rx="27" ry="13" fill="url(#ss-cw)" stroke="#9aa3b4" stroke-width="1.2"/>' +
      '<path d="M7 26h50l-2 12c-12 5-34 5-46 0Z" fill="#1c1f27"/><path d="M8 28h48" stroke="#3a3f4c" stroke-width="1.2"/>' +
      '<circle cx="32" cy="32" r="4.4" fill="#e3b43a"/><circle cx="31" cy="30.6" r="1.4" fill="#fff2b8"/>' +
      '<path d="M14 16c8-5 26-6 36-1" stroke="#ffffff" stroke-width="2" fill="none" opacity=".8"/></svg>',
    leaves: '<svg viewBox="0 0 64 56" aria-hidden="true"><defs><radialGradient id="ss-lo" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ffc04a"/><stop offset=".55" stop-color="#ef7418"/><stop offset="1" stop-color="#a8370a"/></radialGradient>' +
      '<radialGradient id="ss-lr" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ff8a4a"/><stop offset=".55" stop-color="#d63c18"/><stop offset="1" stop-color="#7a1a06"/></radialGradient>' +
      '<radialGradient id="ss-ac" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#e2a35c"/><stop offset="1" stop-color="#8a4a14"/></radialGradient></defs>' +
      '<g transform="translate(22 30) rotate(-30)"><path id="ss-ml" d="M0-20 4-10 11-14 9-6 19-7 14 0 17 4 8 4 10 11 2 7 1 13-1 13-2 7-10 11-8 4-17 4-14 0-19-7-9-6-11-14-4-10Z" fill="url(#ss-lo)"/>' +
      '<path d="M0 13V-17M0-2 14-6M0-2-14-6M0 3 8 9M0 3-8 9" stroke="#7a2a06" stroke-width="1" fill="none" opacity=".55"/></g>' +
      '<g transform="translate(44 22) rotate(28) scale(.9)"><path d="M0-20 4-10 11-14 9-6 19-7 14 0 17 4 8 4 10 11 2 7 1 13-1 13-2 7-10 11-8 4-17 4-14 0-19-7-9-6-11-14-4-10Z" fill="url(#ss-lr)"/>' +
      '<path d="M0 13V-17M0-2 14-6M0-2-14-6" stroke="#5a1004" stroke-width="1" fill="none" opacity=".55"/></g>' +
      '<g transform="translate(36 42) rotate(18)"><ellipse cy="3" rx="6.5" ry="8" fill="url(#ss-ac)"/><path d="M-8-1a8 6 0 0 1 16 0c-4 2-12 2-16 0Z" fill="#6b4520"/><path d="M0-6v-4" stroke="#4a2e12" stroke-width="2.2" stroke-linecap="round"/></g></svg>',
    // across the top rim (112 × 34)
    crown: '<svg viewBox="0 0 112 34" aria-hidden="true"><path d="M6 30C24 8 88 8 106 30" stroke="#3f8f2a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<g fill="#6cc04a"><ellipse cx="14" cy="21" rx="3" ry="6" transform="rotate(-50 14 21)"/><ellipse cx="38" cy="10" rx="3" ry="6" transform="rotate(-70 38 10)"/><ellipse cx="74" cy="10" rx="3" ry="6" transform="rotate(70 74 10)"/><ellipse cx="98" cy="21" rx="3" ry="6" transform="rotate(50 98 21)"/></g>' +
      '<g><g transform="translate(9 27)"><circle r="6" fill="#fff"/><circle r="2.4" fill="#ffc928"/></g><g transform="translate(25 15)"><circle r="6" fill="#ffd21c"/><circle r="2.2" fill="#ff9f00"/></g>' +
      '<g transform="translate(44 8)"><circle r="6.4" fill="#5f86ff"/><circle r="2.2" fill="#1d2f8a"/></g><g transform="translate(60 7)"><circle r="6.4" fill="#ff8cc0"/><circle r="2.4" fill="#ffd84a"/></g>' +
      '<g transform="translate(77 12)"><circle r="6" fill="#fff"/><circle r="2.4" fill="#ffc928"/></g><g transform="translate(92 19)"><circle r="6" fill="#ffd21c"/><circle r="2.2" fill="#ff9f00"/></g>' +
      '<g transform="translate(104 28)"><circle r="5.6" fill="#5f86ff"/><circle r="2" fill="#1d2f8a"/></g></g></svg>',
    snow: '<svg viewBox="0 0 112 34" aria-hidden="true"><defs><linearGradient id="ss-sn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e6f5"/></linearGradient></defs>' +
      '<path d="M8 31C14 18 30 9 56 9s42 9 48 22c-4-2-6 3-10 1-3 4-7 0-10 3-4-3-7 2-11 0-4 3-8-1-12 1-4-3-8 1-12-1-4 2-7-2-11 0-4-3-7 1-11-2-3 2-6-1-9 0Z" fill="url(#ss-sn)"/>' +
      '<path d="M22 17c10-5 22-7 34-7" stroke="#ffffff" stroke-width="2.4" fill="none" stroke-linecap="round"/><g fill="#ffffff"><circle cx="30" cy="31" r="2.2"/><circle cx="72" cy="33" r="2"/><circle cx="90" cy="31" r="1.8"/></g></svg>',
    mug: '<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M13 6c-2-2 2-3 0-5M20 6c-2-2 2-3 0-5M27 6c-2-2 2-3 0-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".75"/>' +
      '<path d="M8 9h24v12a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7Z" fill="currentColor"/><path d="M32 12h2a5 5 0 0 1 0 10h-2" stroke="currentColor" stroke-width="3" fill="none"/>' +
      '<path d="M11 15h18" stroke="var(--ss-glogg-deep)" stroke-width="2" opacity=".55"/></svg>'
  };
  function S() { return W.PNSeason; }
  function btn() { return D.getElementById("btn-beer"); }
  function place() {
    var b = btn(); if (!b || !el) return;
    var wrap = b.parentNode, wr = wrap.getBoundingClientRect(), br = b.getBoundingClientRect(), w = br.width;
    el.style.setProperty("--ss-bx", (br.left - wr.left).toFixed(1) + "px");
    el.style.setProperty("--ss-by", (br.top - wr.top).toFixed(1) + "px");
    el.style.setProperty("--ss-bw", w.toFixed(1) + "px");
  }
  function hop() {
    if (!el || !cur) return;
    try { if (S().reduced()) return; } catch (e) {}
    el.classList.remove("ss-hop"); void el.offsetWidth; el.classList.add("ss-hop");
    W.clearTimeout(hopT); hopT = W.setTimeout(function () { if (el) el.classList.remove("ss-hop"); }, 700);
  }
  // the label: "GLÖGG!" (I18N override) and back; then the app paints the button again (app-beer.js tickCooldown)
  var keep = null;
  function glogg(on) {
    if (on === curG) return; curG = on;
    var I = W.I18N; if (!I || !I.add || !I.t) return;
    if (keep == null) keep = { sv: I.t("beer") };
    try { I.add(on ? { sv: { beer: "GLÖGG" }, en: { beer: "GLÖGG" } } : { sv: { beer: keep.sv || "ÖL!" }, en: { beer: "BEER!" } }); } catch (e) {}
    D.body.classList.toggle("ss-glogg", !!on);
    var b = btn();
    if (on && b && !mug) { mug = D.createElement("span"); mug.className = "ss-mug"; mug.setAttribute("aria-hidden", "true"); mug.innerHTML = SVG.mug; b.insertBefore(mug, b.firstChild); }
    try { if (W.PN && W.PN.tickCooldown) W.PN.tickCooldown(); } catch (e) {}
  }
  function apply(s) {
    var b = btn(); if (!b || !s) return;
    var off = S().off(), kind = off ? "" : s.dress || "", snow = !off && s.snowcap, col = off ? "" : s.color || "";
    var want = kind + (snow ? "+snow" : "");
    if (want !== cur) {
      cur = want;
      if (!el) { el = D.createElement("span"); el.className = "ss-dress"; el.setAttribute("aria-hidden", "true"); b.parentNode.insertBefore(el, b.nextSibling); }
      var rim = kind === "crown" ? "" : kind ? '<i class="ss-d ss-d-' + kind + '">' + SVG[kind] + "</i>" : "";
      var top = kind === "crown" ? '<i class="ss-top ss-top-crown">' + SVG.crown + "</i>" : snow ? '<i class="ss-top ss-top-snow">' + SVG.snow + "</i>" : "";
      if (kind === "crown" && snow) top = '<i class="ss-top ss-top-snow">' + SVG.snow + "</i>" + top;
      el.innerHTML = top + rim;
      el.hidden = !want;
      el.setAttribute("data-dress", want);
      place();
    }
    if (col !== curC) { if (curC) D.body.classList.remove("ss-c-" + curC); curC = col; if (col) D.body.classList.add("ss-c-" + col); }
    glogg(!off && !!s.glogg);
    if (mug) mug.hidden = !curG;
  }
  // I-117 "the Annat button looks a little bit weird" (sheet 11): the "Vilken sort?" strip (.bp-strip, barsplus.js) covered the
  // top of Annat. When both show, the strip moves up until it ends 8 px above Annat. Annat itself is not restyled (I-125).
  var stripMo = null;
  function stripFix() {
    var st = D.querySelector(".bp-strip"), o = D.getElementById("other-wrap");
    if (!st) return;
    if (!stripMo && W.MutationObserver) { stripMo = new MutationObserver(function () { W.requestAnimationFrame(stripFix); }); stripMo.observe(st, { attributes: true, attributeFilter: ["hidden"] }); }
    st.style.removeProperty("margin-bottom");
    if (st.hidden || !o || o.hidden) return;
    var sr = st.getBoundingClientRect(), or = o.getBoundingClientRect(), over = sr.bottom - (or.top - 8);
    if (over > 0 && sr.top - over > 40) st.style.setProperty("margin-bottom", Math.ceil(over) + "px");
  }
  function init() {
    if (!S() || !btn()) return false;
    if (W.MutationObserver) new MutationObserver(function (l) { for (var i = 0; i < l.length; i++) for (var j = 0; j < l[i].addedNodes.length; j++) { var n = l[i].addedNodes[j]; if (n.classList && n.classList.contains("bp-strip")) { W.requestAnimationFrame(stripFix); return; } } })
      .observe(D.body, { childList: true });
    S().on(apply); apply(S().now());
    var b = btn();
    // the hat goes down with the pressed button (CSS :active) and hops once after the tap
    b.addEventListener("click", function () { W.setTimeout(hop, 120); });
    W.addEventListener("resize", function () { W.requestAnimationFrame(place); });
    W.setTimeout(place, 1500);
    return true;
  }
  if (!init()) D.addEventListener("DOMContentLoaded", init);
  W.PNDress = {
    state: function () { return { dress: cur, color: curC, glogg: !!curG, shown: !!(el && !el.hidden), label: (D.getElementById("beer-label") || {}).textContent || "" }; },
    rects: function () { var out = []; if (el && !el.hidden) el.querySelectorAll("i").forEach(function (i) { out.push(i.getBoundingClientRect().toJSON()); }); return out; },
    hop: hop, place: place, stripFix: stripFix
  };
})();
