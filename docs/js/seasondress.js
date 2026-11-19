/* PintsNow — ÖL! BUTTON DRESS (lane seasons, owner 15 Nov 2026, I-117: "Snow on the beer button looks nice. New Year's
   little hat, midsummer, Valborg, autumn: I think it looks great." / "Maybe we can change the colour of the beer button as
   well." / "In Christmas we have glögg instead of beer."). window.PNDress. Styles: docs/season.css.
   - One hat that SITS ON the ÖL! button like on a head (I-134, lane btndress 19 Nov: centred, the brim follows the circle
     with a little overlap on the rim and a soft shadow under it; the tip flops / tilts away from Annat, .ss-flip when Annat
     is up-right): Santa hat (Christmas), party hat (New Year), flower crown (Midsummer), student cap (Valborg), leaves +
     acorn (October). When it snows the button gets fluffy WHITE HAIR (round tufts along the top, a fringe, down the sides),
     and the hat sits on the hair. It never takes a tap (pointer-events: none), never covers the label, the GLÖGG mug, the
     timer, "Ångra" or Annat. It goes down with the pressed button and the hat hops once after the tap (the hair stays
     still). Reduced motion: no hop. Check: tests/e2e/btndress-pw.js (pixel mask).
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
  // I-134 (owner 19 Nov: "I want it to feel like they're actually sitting on the button, like the button is a head" /
  // "change [the snow] in a way, like it looks like white hair"). Every piece is drawn in BUTTON UNITS: the ÖL! circle has
  // its centre at (0, 0) and radius 50, so a brim is simply an arc of that circle. The piece box (CSS .ss-p) maps the
  // viewBox onto the button with --x0 / --y0 / --w / --h (units), so it scales with the button (106 px at 390, 96 at 360).
  // Safe zones (measured at 390 and 360 px): Annat's 50 px circle is centred near (-61, -75) r 24-26 (or mirrored);
  // the label starts at y = -3; the GLÖGG mug spans x -15..15 from y = -32. Brims end above y = -30 at x = +-36.
  var BOX = { santa: [-62, -122, 124, 100], party: [-62, -130, 124, 108], cap: [-62, -96, 124, 74], leaves: [-62, -96, 124, 74],
    crown: [-62, -78, 124, 62], hair: [-64, -68, 128, 66] };
  // a point on the circle of radius r, a degrees from the top (clockwise): [x, y]
  function pt(r, a) { var t = a * Math.PI / 180; return [+(r * Math.sin(t)).toFixed(1), +(-r * Math.cos(t)).toFixed(1)]; }
  // an arc of radius r from -a to +a over the top (left to right)
  function arc(r, a) { var p = pt(r, -a), q = pt(r, a); return "M" + p[0] + " " + p[1] + "A" + r + " " + r + " 0 0 1 " + q[0] + " " + q[1]; }
  // the soft shadow a brim throws on the button (blurred dark arc just under it)
  var BLUR = '<filter id="ss-bl" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="1.8"/></filter>';
  function shade(r, a, w) { return '<path class="ss-sh" d="' + arc(r, a) + '" stroke="#000" stroke-opacity=".34" stroke-width="' + w + '" fill="none" stroke-linecap="round" filter="url(#ss-bl)"/>'; }
  function hairSvg() {
    var o = "", i, j, p, c, R, rows = [[43, 36, 7, 6.6], [48.5, 42, 9, 7], [53, 48, 11, 7.2]];
    // the mass, then three rows of round tufts (inner row = a scalloped fringe, outer row = the bumpy top), each outer tuft
    // with a small curl, and two small tufts down each side outside the label (|x| > 45: the label box reaches y = -27)
    o += '<path d="' + arc(49, 40) + '" stroke="url(#ss-hb)" stroke-width="15" fill="none" stroke-linecap="round"/>';
    [[47.5, -33.5, 5.5], [50.5, -26, 4.4]].forEach(function (t) { [-1, 1].forEach(function (k) { o += '<circle cx="' + k * t[0] + '" cy="' + t[1] + '" r="' + t[2] + '" fill="url(#ss-hw)"/>'; }); });
    for (j = 0; j < 3; j++) {
      R = rows[j];
      for (i = 0; i < R[2]; i++) {
        p = pt(R[0], -R[1] + i * 2 * R[1] / (R[2] - 1)); c = (i % 2 ? 1 : -1);
        o += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + R[3] + '" fill="url(#ss-hw)"/>';
        if (j === 0) o += '<path d="M' + (p[0] - 2.6 * c) + " " + (p[1] + 2) + "q" + (2.6 * c) + " 2.4 " + (5 * c) + ' -.4" stroke="#c0c8d3" stroke-width="1.1" fill="none" stroke-linecap="round"/>';
        if (j === 2) o += '<path d="M' + (p[0] - 3 * c) + " " + (p[1] + 1.5) + "a3.2 3.2 0 1 " + (c > 0 ? 1 : 0) + " " + (4.6 * c) + ' -2.4" stroke="#b4bdc9" stroke-width="1.2" fill="none" stroke-linecap="round"/>';
      }
    }
    o += '<path d="' + arc(55, 30) + '" stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-dasharray="5 9" opacity=".9"/>';
    return '<svg viewBox="' + BOX.hair.join(" ") + '" aria-hidden="true"><defs>' + BLUR +
      '<radialGradient id="ss-hw" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eef1f5"/><stop offset="1" stop-color="#c9d0da"/></radialGradient>' +
      '<linearGradient id="ss-hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf2"/><stop offset="1" stop-color="#bcc5d1"/></linearGradient></defs>' +
      shade(41, 36, 6) + '<g class="ss-g">' + o + "</g></svg>";
  }
  function crownSvg() {
    var o = "", i, p, cols = [["#ffffff", "#ffc928"], ["#ffd21c", "#ff9f00"], ["#5f86ff", "#1d2f8a"], ["#ff8cc0", "#ffd84a"]];
    for (i = 0; i < 8; i++) { p = pt(55, -48 + i * 13.7); o += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="3" ry="6.4" fill="#6cc04a" transform="rotate(' + (-48 + i * 13.7 + 40) + " " + p[0] + " " + p[1] + ')"/>'; }
    for (i = 0; i < 9; i++) { p = pt(54, -50 + i * 12.5); var k = cols[i % 4]; o += '<g transform="translate(' + p[0] + " " + p[1] + ')"><circle r="6.6" fill="' + k[0] + '"/><circle r="2.4" fill="' + k[1] + '"/></g>'; }
    return '<svg viewBox="' + BOX.crown.join(" ") + '" aria-hidden="true"><defs>' + BLUR + "</defs>" + shade(47, 50, 5) +
      '<g class="ss-g"><path d="' + arc(52, 54) + '" stroke="#3f8f2a" stroke-width="5" fill="none" stroke-linecap="round"/>' + o + "</g></svg>";
  }
  var SVG = {
    // Santa hat: the white fur brim hugs the top of the button, the red top flops over to the side away from Annat
    santa: '<svg viewBox="' + BOX.santa.join(" ") + '" aria-hidden="true"><defs>' + BLUR + '<linearGradient id="ss-sr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a5a"/><stop offset=".55" stop-color="#d8202c"/><stop offset="1" stop-color="#8e0b15"/></linearGradient>' +
      '<radialGradient id="ss-sw" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6ee"/></radialGradient></defs>' +
      shade(45.5, 42, 6) + '<g class="ss-g">' +
      '<path d="M-35 -42C-34 -74 -15 -101 10 -105C30 -108 47 -98 53 -80C46 -85 37 -84 33 -76C29 -67 33 -53 37 -40A53 53 0 0 0 -35 -42Z" fill="url(#ss-sr)"/>' +
      '<path d="M-22 -70C-14 -88 0 -98 14 -101" stroke="#ff9e9e" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>' +
      '<path class="ss-brim" d="' + arc(52, 43) + '" stroke="url(#ss-sw)" stroke-width="14" fill="none" stroke-linecap="round"/>' +
      '<path d="' + arc(51, 40) + '" stroke="#c9d3de" stroke-width="1.8" fill="none" stroke-dasharray="2 5" stroke-linecap="round"/>' +
      '<path d="' + arc(56.5, 28) + '" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>' +
      '<circle cx="53" cy="-77" r="9" fill="url(#ss-sw)"/><circle cx="50" cy="-80" r="3" fill="#fff"/></g></svg>',
    // party hat: a gold-striped cone on a gold trim, tilted a little away from Annat
    party: '<svg viewBox="' + BOX.party.join(" ") + '" aria-hidden="true"><defs>' + BLUR + '<linearGradient id="ss-pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9820f"/><stop offset=".45" stop-color="#ffe08a"/><stop offset="1" stop-color="#c48a12"/></linearGradient>' +
      '<clipPath id="ss-pc"><path d="M-25 -45L2 -118L27 -44A51.5 51.5 0 0 0 -25 -45Z"/></clipPath></defs>' +
      shade(46, 26, 6) + '<g class="ss-g"><g transform="rotate(6 0 -50)">' +
      '<path d="M-25 -45L2 -118L27 -44A51.5 51.5 0 0 0 -25 -45Z" fill="url(#ss-pg)"/>' +
      '<g clip-path="url(#ss-pc)"><path d="M-40 -60L40 -80v7L-40 -53Z" fill="#ff4fa0"/><path d="M-40 -86L40 -106v7L-40 -79Z" fill="#3d7bff"/></g>' +
      '<g fill="#fff6c8"><circle cx="-9" cy="-62" r="1.8"/><circle cx="10" cy="-70" r="1.8"/><circle cx="2" cy="-92" r="1.6"/><circle cx="14" cy="-54" r="1.8"/></g>' +
      '<g transform="translate(2 -119)"><circle r="7" fill="#ff4fa0"/><path d="M-8 0h16M0-8v16M-5.6-5.6l11.2 11.2M5.6-5.6-5.6 5.6" stroke="#ffd2e8" stroke-width="2.2" stroke-linecap="round"/></g></g>' +
      '<path class="ss-brim" d="' + arc(51.5, 27) + '" stroke="#ffe7a0" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="' + arc(48.5, 25) + '" stroke="#b9820f" stroke-width="1.4" fill="none"/></g>' +
      '<path d="M36 -108l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4Z" fill="#fff3b0"/></svg>',
    // student cap (Valborg): black band round the head, white top above it, the shiny black visor in front
    cap: '<svg viewBox="' + BOX.cap.join(" ") + '" aria-hidden="true"><defs>' + BLUR + '<linearGradient id="ss-cw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7dce6"/></linearGradient></defs>' +
      shade(44, 40, 7) + '<g class="ss-g"><g transform="rotate(4 0 -58)">' +
      '<ellipse cx="0" cy="-63" rx="33" ry="14.5" fill="url(#ss-cw)" stroke="#9aa3b4" stroke-width="1.2"/>' +
      '<path d="M-23 -72C-11 -78 11 -78 23 -72" stroke="#ffffff" stroke-width="2.2" fill="none" opacity=".85"/></g>' +
      '<path class="ss-brim" d="' + arc(52, 38) + '" stroke="#1c1f27" stroke-width="12" fill="none" stroke-linecap="round"/>' +
      '<path d="' + arc(56.5, 34) + '" stroke="#3a3f4c" stroke-width="1.2" fill="none"/>' +
      '<path d="M-27 -42Q0 -54 27 -42Q0 -27 -27 -42Z" fill="#121318"/><path d="M-16 -38Q0 -33 16 -38" stroke="#5a6070" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<circle cx="0" cy="-52" r="4.4" fill="#e3b43a"/><circle cx="-1" cy="-53.4" r="1.4" fill="#fff2b8"/></g></svg>',
    // October: leaves and an acorn that fell on the head
    leaves: '<svg viewBox="' + BOX.leaves.join(" ") + '" aria-hidden="true"><defs>' + BLUR + '<radialGradient id="ss-lo" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ffc04a"/><stop offset=".55" stop-color="#ef7418"/><stop offset="1" stop-color="#a8370a"/></radialGradient>' +
      '<radialGradient id="ss-lr" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ff8a4a"/><stop offset=".55" stop-color="#d63c18"/><stop offset="1" stop-color="#7a1a06"/></radialGradient>' +
      '<radialGradient id="ss-ac" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#e2a35c"/><stop offset="1" stop-color="#8a4a14"/></radialGradient>' +
      '<path id="ss-ml" d="M0-20 4-10 11-14 9-6 19-7 14 0 17 4 8 4 10 11 2 7 1 13-1 13-2 7-10 11-8 4-17 4-14 0-19-7-9-6-11-14-4-10Z"/></defs>' +
      shade(46, 40, 6) + '<g class="ss-g">' +
      '<g transform="translate(-33 -44) rotate(-58) scale(.62)"><use href="#ss-ml" fill="url(#ss-lr)"/></g>' +
      '<g transform="translate(-13 -57) rotate(-30) scale(.95)"><use href="#ss-ml" fill="url(#ss-lo)"/><path d="M0 13V-17M0-2 14-6M0-2-14-6M0 3 8 9M0 3-8 9" stroke="#7a2a06" stroke-width="1" fill="none" opacity=".55"/></g>' +
      '<g transform="translate(13 -61) rotate(22) scale(1.05)"><use href="#ss-ml" fill="url(#ss-lr)"/><path d="M0 13V-17M0-2 14-6M0-2-14-6" stroke="#5a1004" stroke-width="1" fill="none" opacity=".55"/></g>' +
      '<g transform="translate(34 -50) rotate(28)"><ellipse cy="3" rx="6.5" ry="8" fill="url(#ss-ac)"/><path d="M-8-1a8 6 0 0 1 16 0c-4 2-12 2-16 0Z" fill="#6b4520"/><path d="M0-6v-4" stroke="#4a2e12" stroke-width="2.2" stroke-linecap="round"/></g></g></svg>',
    mug: '<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M13 6c-2-2 2-3 0-5M20 6c-2-2 2-3 0-5M27 6c-2-2 2-3 0-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".75"/>' +
      '<path d="M8 9h24v12a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7Z" fill="currentColor"/><path d="M32 12h2a5 5 0 0 1 0 10h-2" stroke="currentColor" stroke-width="3" fill="none"/>' +
      '<path d="M11 15h18" stroke="var(--ss-glogg-deep)" stroke-width="2" opacity=".55"/></svg>'
  };
  SVG.crown = crownSvg(); SVG.hair = hairSvg();
  // one piece: <i class="ss-p ..."> placed in button units (CSS .ss-p)
  function piece(cls, kind) { var b = BOX[kind]; return '<i class="ss-p ' + cls + '" style="--x0:' + b[0] + ";--y0:" + b[1] + ";--w:" + b[2] + ";--h:" + b[3] + '">' + SVG[kind] + "</i>"; }
  function S() { return W.PNSeason; }
  function btn() { return D.getElementById("btn-beer"); }
  function place() {
    var b = btn(); if (!b || !el) return;
    var wrap = b.parentNode, wr = wrap.getBoundingClientRect(), br = b.getBoundingClientRect(), w = br.width;
    el.style.setProperty("--ss-bx", (br.left - wr.left).toFixed(1) + "px");
    el.style.setProperty("--ss-by", (br.top - wr.top).toFixed(1) + "px");
    el.style.setProperty("--ss-bw", w.toFixed(1) + "px");
    // the hat flops / tilts AWAY from Annat (pnds.js puts Annat up-left or up-right of ÖL!)
    var o = D.getElementById("other-wrap"), or = o && !o.hidden ? o.getBoundingClientRect() : null;
    el.classList.toggle("ss-flip", !!(or && or.width && or.left + or.width / 2 > br.left + w / 2));
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
      // snow weather = white hair; the hat (if any) sits on top of the hair
      el.innerHTML = (snow ? piece("ss-hair", "hair") : "") + (kind && SVG[kind] ? piece("ss-d ss-d-" + kind, kind) : "");
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
    var down = function (on) { return function () { if (el) el.classList.toggle("ss-down", on && !b.disabled); }; };
    b.addEventListener("pointerdown", down(true), { passive: true });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { b.addEventListener(n, down(false), { passive: true }); });
    W.addEventListener("resize", function () { W.requestAnimationFrame(place); });
    W.setTimeout(place, 1500);
    return true;
  }
  if (!init()) D.addEventListener("DOMContentLoaded", init);
  W.PNDress = {
    state: function () { return { dress: cur, color: curC, glogg: !!curG, shown: !!(el && !el.hidden), label: (D.getElementById("beer-label") || {}).textContent || "" }; },
    // the drawn part of each piece, in paint order (hair, then hat): screen rects of the .ss-g groups
    rects: function () { var out = []; if (el && !el.hidden) el.querySelectorAll(".ss-d .ss-g, .ss-hair .ss-g").forEach(function (g) { out.push(g.getBoundingClientRect().toJSON()); }); return out; },
    hop: hop, place: place, stripFix: stripFix
  };
})();
