/* PintsNow — GLHIT (mapfix5 B9, blind test §4 "tap targets under 44 px"; DESIGN rule 9 "targets >= 44 px"). PN.glhit (no new window global).
   The things js/glmap.js draws INSIDE the GL map (a bar disc or dot, the friends' faces and the count pill beside it, the small
   badges) are 13-32 px on the screen. Their TAP area is now at least 44 x 44 px, centred on the drawn shape. (Restaurant dots
   already had more: glmap.js takes any dot whose image touches a 28 px box around the finger; image r >= 11 px = 50 px.)
   The look does not change (no bigger icon, no invisible DOM layer: GL draws, this module only does the maths).
   Order (glmap.js onPreclick): its exact rules first (a finger ON a disc / part, as before), then these 44 px areas, then the
   loose rules (cluster, the nearest icon within 28 px, the name). So a tap that worked before still goes to the same thing.
   Among the 44 px areas the drawn edge nearest to the finger wins. A finger exactly on a restaurant dot is never taken by a
   bar's area. One click router (CLAUDE.md): while a bar sheet / pop-up is open, glmap.js does NOT use these areas (a tap then
   only closes, unless the finger is exactly ON another bar or dot, as before: mapfix I-110). */
(function () {
  "use strict";
  var MIN = 44, HALF = MIN / 2;
  // how far (px) the finger (x, y) is from a drawn shape; Infinity = outside its 44 px area
  //   box: [x0, y0, x1, y1] screen px · disc: { x, y, r }
  function reachBox(x, y, b) {
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, hw = Math.max((b[2] - b[0]) / 2, HALF), hh = Math.max((b[3] - b[1]) / 2, HALF);
    if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) return Infinity;
    var dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function reachDisc(x, y, c) {
    var d = Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y));
    return d > Math.max(c.r, HALF) ? Infinity : Math.max(0, d - c.r);
  }
  // shapes [{ box | disc, ... }] → the shape whose 44 px area holds the finger and whose drawn edge is nearest (null = none)
  function pick(x, y, shapes) {
    var best = null, bd = Infinity;
    shapes.forEach(function (s) {
      var d = s.disc ? reachDisc(x, y, s.disc) : reachBox(x, y, s.box);
      if (d < bd || (d === bd && best && (s.sk || 0) > (best.sk || 0))) { bd = d; best = s; }
    });
    return best;
  }
  /* A bar, by its 44 px areas. m = the Mapbox map, p = the finger (GL canvas px), list = glmap's bars near the finger
     [{ f (feature), r (disc radius px) }], partOf(id) = glmap's parts entry { im: { parts: [{ sel, bb }] }, sz }, k = zk(zoom),
     full = the full-pill layer id, place = the restaurant layer id. Returns { f, sel } (sel = the part to click) or null. */
  function bar(m, p, list, partOf, k, full, place) {
    if (!m || !p || !list || !list.length) return null;
    try {   // the finger is ON a restaurant dot: that dot is the target (glmap.js step 6), not a bar's area
      if (place && m.getLayer(place) && m.queryRenderedFeatures([[p.x - 2, p.y - 2], [p.x + 2, p.y + 2]], { layers: [place] }).length) return null;
    } catch (e) {}
    var shapes = [];
    list.forEach(function (o) {
      var f = o.f, id = String(f.properties.id), q = m.project(f.geometry.coordinates), pi = partOf(id);
      if (f.layer.id !== full || !pi || !pi.im || !pi.im.parts) { shapes.push({ f: f, sel: ".bar-ico", sk: f.properties.sk || 0, disc: { x: q.x, y: q.y, r: o.r } }); return; }
      var kk = (pi.sz || 1) * k;
      pi.im.parts.forEach(function (x) {
        var b = [q.x + x.bb[0] * kk, q.y + x.bb[1] * kk, q.x + x.bb[2] * kk, q.y + x.bb[3] * kk];
        if (x.sel === ".bar-ico") shapes.push({ f: f, sel: x.sel, sk: f.properties.sk || 0, disc: { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, r: (b[2] - b[0]) / 2 } });
        else shapes.push({ f: f, sel: x.sel, sk: f.properties.sk || 0, box: b });
      });
    });
    var s = pick(p.x, p.y, shapes);
    return s ? { f: s.f, sel: s.sel } : null;
  }
  var PN = window.PN = window.PN || {};
  PN.glhit = { MIN: MIN, HALF: HALF, pick: pick, bar: bar, _reachBox: reachBox, _reachDisc: reachDisc };
})();
