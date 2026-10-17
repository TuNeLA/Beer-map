/* "Kaos i stan": anonymous crowd level around one point, from the live beer rows. In-app only. */
(function () {
  "use strict";
  var U = window.U;
  var RADIUS_M = 5000, OUT_MIN = 10, HOT_MIN = 3, BAR_MIN = 2, DENSE_M = 300;

  // beers: live rows (beer_count >= 1). center: {lat, lng}.
  // Returns {on, out, hot, city, bar, target} — counts only, never names of people.
  function compute(beers, center) {
    var near = (beers || []).filter(function (b) {
      return U.haversine(center.lat, center.lng, b.lat, b.lng) <= RADIUS_M;
    });
    var out = near.length, hot = 0;
    near.forEach(function (b) { if ((b.beer_count | 0) >= 5) hot++; });
    var res = { on: out >= OUT_MIN || hot >= HOT_MIN, out: out, hot: hot, city: null, bar: null, target: null };
    if (!res.on) return res;
    var c = window.CITIES && window.CITIES.nearest(center.lat, center.lng);
    res.city = c ? c.name : null;
    // Busiest bar: same assignment as the map (precise beers within 75 m). Needs 2+ people, so it never points at one person.
    var per = window.BARS ? window.BARS.assign(near).perBar : {}, best = null;
    Object.keys(per).forEach(function (k) {
      var a = per[k];
      if (a.beers.length < BAR_MIN) return;
      if (!best || a.beers.length > best.beers.length) best = a;
    });
    if (best) {
      res.bar = best.bar.name || null;
      res.target = { lat: best.bar.lat, lng: best.bar.lng, zoom: 17 };
      return res;
    }
    // No busy bar: the densest spot (mean of the biggest group within 300 m), only when 2+ people are there.
    var top = null;
    near.forEach(function (b) {
      var grp = near.filter(function (x) { return U.haversine(b.lat, b.lng, x.lat, x.lng) <= DENSE_M; });
      if (!top || grp.length > top.length) top = grp;
    });
    if (top && top.length >= BAR_MIN) {
      var la = 0, ln = 0;
      top.forEach(function (x) { la += x.lat; ln += x.lng; });
      res.target = { lat: la / top.length, lng: ln / top.length, zoom: 15 };
    } else {
      res.target = { lat: center.lat, lng: center.lng, zoom: 13 };
    }
    return res;
  }

  window.CHAOS = { compute: compute, RADIUS_M: RADIUS_M };
})();
