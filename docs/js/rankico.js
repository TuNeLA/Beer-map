/* PintsNow — rank insignia (lane d-profile, owner I-114: "an icon per rank so that each rank feels more unique").
   ONE function gives the SVG for rank index N (0 = the first rank). No emoji, no images: amber marks (currentColor) on
   the navy of the app. Every rank of the ladder (SOCIAL.TITLES, 42 today) and every future rank gets its own icon:
     crest = floor(N / 6): a beer mark that grows with the rank
             0 kapsyl (bottle cap) · 1 flaska (bottle) · 2 glas · 3 sejdel (tankard) · 4 fat (barrel) · 5 krona (crown) ·
             6 strålkrona (crown with rays) · 7+ = strålkrona + one more dot per step of 6 ranks
     pips  = N % 6: 1, 2, 3 chevrons, then 1, 2, 3 stars
   24 x 24 box: the crest in the top half, the pips under it. Readable at 20 px and at 48 px.
   Also the one place that turns a rank value into a rank (index, title, next rank, progress), so Profil and Min uniform
   always show the same rank name, and the one wording of the progress: "N meriter till <next rank>" (a count is
   information only; no "kvar", no push).
   Public: window.RANKICO = { svg(n, size, cls), plate(n, size), info(value), mine(), indexOf(title), progText(r), count() }. */
(function () {
  "use strict";
  var W = window;
  var C = 'fill="currentColor"', ST = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  function num(v) { return String(Math.round(v * 100) / 100); }
  var CROWN = '<path ' + C + ' stroke="currentColor" stroke-width=".9" stroke-linejoin="round" d="M6.7 11.4 5.7 4.1l3.5 2.8L12 2l2.8 4.9 3.5-2.8-1 7.3z"/>';
  var RAYS = '<path ' + C + ' stroke="currentColor" stroke-width=".8" stroke-linejoin="round" d="M7.5 11.6 6.7 6.7l2.8 2L12 5.3l2.5 3.4 2.8-2-.8 4.9z"/>' +
    '<path ' + ST + ' stroke-width="1.4" d="M12 .9v1.9M7.7 1.9l.9 1.6M16.3 1.9l-.9 1.6M4.2 4.9l1.5 1M19.8 4.9l-1.5 1"/>';
  // kapsyl: a disc with 14 crimps and a ring cut out (even-odd), so it reads as a bottle cap, not a sun
  function cap() {
    var p = [], cx = 12, cy = 6.7;
    for (var i = 0; i < 28; i++) { var a = Math.PI * i / 14, d = i % 2 ? 4.6 : 5.6; p.push(num(cx + d * Math.cos(a)) + " " + num(cy + d * Math.sin(a))); }
    return '<path ' + C + ' fill-rule="evenodd" d="M' + p.join("L") + 'zM12 3.3a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM12 4.6a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z"/>';
  }
  var CREST = [
    cap(),
    '<path ' + C + ' d="M10.8 1h2.4v3.3c0 1 2 1.6 2 3.5v3.6a1 1 0 0 1-1 1H9.8a1 1 0 0 1-1-1V7.8c0-1.9 2-2.5 2-3.5z"/>',
    '<path ' + ST + ' stroke-width="1.5" d="M8.2 1.6h7.6l-1 10.4H9.2z"/><path ' + C + ' d="M8.7 5.6h6.6l-.6 6H9.3z"/>',
    '<rect x="6.6" y="4.4" width="7.8" height="7.6" rx="1.2" ' + C + '/><path ' + ST + ' stroke-width="1.5" d="M14.6 6.1h1.2a1.9 1.9 0 0 1 1.9 1.9v.7a1.9 1.9 0 0 1-1.9 1.9h-1.2"/>' +
      '<circle cx="7.8" cy="3.8" r="1.7" ' + C + '/><circle cx="10.5" cy="3.1" r="1.9" ' + C + '/><circle cx="13.2" cy="3.8" r="1.7" ' + C + '/>',
    '<path ' + ST + ' stroke-width="1.5" d="M8.4 1.9h7.2c1.9 3.3 1.9 6.7 0 10H8.4c-1.9-3.3-1.9-6.7 0-10z"/><path ' + ST + ' stroke-width="1.3" d="M7.4 5.1h9.2M7.4 8.7h9.2"/>',
    CROWN,
    RAYS
  ];
  function star(cx, cy, R) {
    var p = [], r = R * 0.42;
    for (var i = 0; i < 10; i++) { var a = Math.PI * (i / 5 - 0.5), d = i % 2 ? r : R; p.push(num(cx + d * Math.cos(a)) + " " + num(cy + d * Math.sin(a))); }
    return '<path ' + C + ' d="M' + p.join("L") + 'z"/>';
  }
  function pips(step) {
    var n = step % 3 + 1, out = "", i;
    if (step < 3) {   // 1–3 chevrons, stacked
      var y0 = 14.2 + (3 - n) * 1.5;
      for (i = 0; i < n; i++) out += '<path ' + ST + ' stroke-width="1.7" d="M6.2 ' + num(y0 + i * 3 + 3) + 'L12 ' + num(y0 + i * 3) + 'l5.8 3"/>';
      return out;
    }
    var xs = n === 1 ? [12] : n === 2 ? [8.2, 15.8] : [4.9, 12, 19.1];   // 1–3 stars, in a row
    for (i = 0; i < n; i++) out += star(xs[i], 18.6, n === 1 ? 3.9 : 3.3);
    return out;
  }
  function crest(tier) {
    if (tier < CREST.length) return CREST[tier];
    var extra = tier - (CREST.length - 1), out = RAYS, gap = Math.min(2.4, 16 / extra);   // future ranks: one more dot per tier
    for (var i = 0; i < extra; i++) out += '<circle cx="' + num(12 + (i - (extra - 1) / 2) * gap) + '" cy="13.1" r="' + num(Math.min(0.8, gap / 3)) + '" ' + C + '/>';
    return out;
  }
  function svg(n, size, cls) {
    n = Math.max(0, n | 0); size = size || 24;
    return '<svg class="rk-ico' + (cls ? " " + cls : "") + '" data-rk="' + n + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      crest(Math.floor(n / 6)) + pips(n % 6) + "</svg>";
  }
  function plate(n, size) { return '<span class="rk-plate" aria-hidden="true">' + svg(n, size || 48) + "</span>"; }

  /* ---------- rank value → rank ---------- */
  function sv() { var I = W.I18N; return !I || I.lang !== "en"; }
  function titles() { var S = W.SOCIAL; return S && S.TITLES && S.TITLES.length ? S.TITLES : [[0, ""]]; }
  function info(value) {
    var T = titles(), v = Math.max(0, value | 0), i = 0;
    while (i + 1 < T.length && v >= T[i + 1][0]) i++;
    var nx = T[i + 1] || null, at = T[i][0];
    return { idx: i, n: T.length, title: T[i][1], at: at, next: nx ? nx[1] : null, nextAt: nx ? nx[0] : null, v: v,
      pct: nx ? Math.max(0, Math.min(100, Math.round(100 * (v - at) / Math.max(1, nx[0] - at)))) : 100 };
  }
  function at(i, v) {   // the rank at ladder index i (the server named it), with the value v
    var T = titles(), nx = T[i + 1] || null;
    return { idx: i, n: T.length, title: T[i][1], at: T[i][0], next: nx ? nx[1] : null, nextAt: nx ? nx[0] : null, v: v, pct: nx ? 0 : 100 };
  }
  // My rank now. By merits when the server gives them (my_stats / my_meriter: every server since 0036). An old server
  // without merits names the rank itself (by lifetime drinks): then that title, no progress (r.mer = false).
  function mine() {
    var st = null, c = null;
    try { st = W.SOCIAL && W.SOCIAL.stats ? W.SOCIAL.stats() : null; } catch (e) {}
    try { c = W.MERITER && W.MERITER.on() ? W.MERITER.cur() : null; } catch (e) {}
    var mer = c && c.m != null ? c.m : st && st.meriter != null ? st.meriter : null;
    var total = st && st.total != null ? st.total | 0 : null;
    if (mer == null && total == null) return null;
    var r, i = mer == null && st && st.title ? indexOf(st.title) : -1;
    r = i >= 0 ? at(i, total) : info(mer != null ? mer : total);
    r.mer = mer != null; r.total = total;
    return r;
  }
  function indexOf(title) { var T = titles(); for (var i = 0; i < T.length; i++) if (T[i][1] === title) return i; return -1; }
  // "8 meriter till Korpral Kranöl" (owner wording 15 Nov: N = the merits to the next rank). Only for a rank by merits (r.mer);
  // "" for the old drink-based rank (no goal for drinks). 1 = "1 merit till …".
  function progText(r) {
    if (!r) return "";
    if (!r.next || !r.nextAt) return sv() ? "Högsta grad." : "Highest rank.";
    if (!r.mer) return "";
    var n = Math.max(1, r.nextAt - r.v);
    return sv() ? n + (n === 1 ? " merit" : " meriter") + " till " + r.next : n + (n === 1 ? " merit" : " merits") + " to " + r.next;
  }
  W.RANKICO = { svg: svg, plate: plate, info: info, mine: mine, indexOf: indexOf, progText: progText, count: function () { return titles().length; } };
})();
