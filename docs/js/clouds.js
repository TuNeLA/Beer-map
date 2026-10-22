/* Öl Nu — ☁️ CLOUDS: the "senaste dagarna" ghost points as soft clouds (CONTRACT "PIN-NIVÅER" → ☁️ Moln).
   window.CLOUDS. No hooks, no RPC, no button. social.js (👻 chip, ghost_points2 / ghost_points) uses CLOUDS.layer(map, pane).
   - ONE canvas in the "ghosts" pane (z 380: under heat, glow and every marker). No outline, no dashes, no half rings:
     each point = a radial fade (light blue-grey haze #c8d4ea) that reads on Klassisk and the dark Mapbox styles.
   - Size = how much happened (metres: 45 m + 22 m × √beers), clamped to 14–48 px on screen at every zoom; far out, points
     closer than 24 px merge into one cloud. A point within the bar snap distance of a
     bar is drawn on the bar's own point (centred under its marker; weights of one spot summed).
   - Age fade: age_h 24 h (the newest, the last day is the live map) → alpha 1, 72 h → 0, linear. No age (old server) → 0.6.
   - Drawn on add / moveend / zoomend / resize only (no per-frame work); hidden while Leaflet animates a zoom
     (leaflet-zoom-hide). The canvas covers the view + 25 % on each side, so a pan shows clouds right away. */
(function () {
  "use strict";
  var L = window.L;
  var FRESH_H = 24, GONE_H = 72, PAD = 0.25, COL = "200,212,234", R_MIN = 14, R_MAX = 48;   // cloud radius px, every zoom
  function alphaFor(age) {
    if (age == null || !isFinite(age)) return 0.6;
    var t = (age - FRESH_H) / (GONE_H - FRESH_H);
    return t <= 0 ? 1 : t >= 1 ? 0 : 1 - t;
  }
  function snap(list) {
    var spots = {}, out = [];
    (list || []).forEach(function (p) {
      var lat = +p.lat, lng = +p.lng, w = +p.w; if (!isFinite(lat) || !isFinite(lng) || !(w > 0)) return;
      var s = null; try { s = window.BARS && window.BARS.nearestSpot ? window.BARS.nearestSpot(lat, lng) : null; } catch (e) { s = null; }
      var k = s ? "b" + s.id : lat.toFixed(5) + "," + lng.toFixed(5), a = alphaFor(p.age_h);
      if (a <= 0.02) return;
      var o = spots[k];
      if (o) { o.a = (o.a * o.w + a * w) / (o.w + w); o.w += w; return; }
      out.push(spots[k] = { lat: s ? s.lat : lat, lng: s ? s.lng : lng, w: w, a: a });
    });
    return out;
  }
  function layer(map, pane) {
    if (!L || !L.Layer) return null;
    var Cloud = L.Layer.extend({
      initialize: function () { this._pts = []; },
      setPoints: function (list) { this._pts = snap(list); this.redraw(); return this; },
      count: function () { return this._pts.length; }, points: function () { return this._pts; },
      onAdd: function (m) {
        this._map = m;
        var c = this._c = L.DomUtil.create("canvas", "olnu-clouds leaflet-zoom-hide");
        c.style.position = "absolute"; c.style.pointerEvents = "none";
        m.getPane(pane || "overlayPane").appendChild(c);
        m.on("moveend zoomend resize viewreset", this.redraw, this);
        this.redraw();
      },
      onRemove: function (m) {
        m.off("moveend zoomend resize viewreset", this.redraw, this);
        if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c);
        this._c = null;
      },
      redraw: function () {
        var m = this._map, c = this._c; if (!m || !c) return this;
        var size = m.getSize(), px = Math.round(size.x * PAD), py = Math.round(size.y * PAD);
        var W = size.x + 2 * px, H = size.y + 2 * py, dpr = Math.min(2, window.devicePixelRatio || 1);
        // clouds are soft: draw at ≤ 1 canvas px per CSS px (half the pixels on a 2× phone, looks the same)
        var s = Math.min(1, dpr), cw = Math.round(W * s), ch = Math.round(H * s);
        if (c.width !== cw) c.width = cw; if (c.height !== ch) c.height = ch;
        c.style.width = W + "px"; c.style.height = H + "px";
        L.DomUtil.setPosition(c, m.containerPointToLayerPoint([-px, -py]));
        var g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); g.setTransform(s, 0, 0, s, 0, 0);
        var z = m.getZoom(), lat0 = m.getCenter().lat, mpp = 156543.03 * Math.cos(lat0 * Math.PI / 180) / Math.pow(2, z);
        // far out, near points merge on a 24 px screen grid into one cloud (weights summed, alpha weighted), so the country view
        // shows one soft cloud per town at the clamped size, never a giant disc
        var cells = {}, list = [], G = 24;
        for (var i = 0; i < this._pts.length; i++) {
          var p = this._pts[i], pt = m.latLngToContainerPoint([p.lat, p.lng]), x = pt.x + px, y = pt.y + py;
          if (x < -R_MAX || y < -R_MAX || x > W + R_MAX || y > H + R_MAX) continue;
          var k = Math.floor(x / G) + "_" + Math.floor(y / G), o = cells[k];
          if (o) { o.x = (o.x * o.w + x * p.w) / (o.w + p.w); o.y = (o.y * o.w + y * p.w) / (o.w + p.w); o.a = (o.a * o.w + p.a * p.w) / (o.w + p.w); o.w += p.w; }
          else list.push(cells[k] = { x: x, y: y, w: p.w, a: p.a });
        }
        for (i = 0; i < list.length; i++) {
          var q = list[i], r = Math.max(R_MIN, Math.min(R_MAX, (45 + 22 * Math.sqrt(q.w)) / mpp));
          var a = q.a * 0.55, gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
          gr.addColorStop(0, "rgba(" + COL + "," + a.toFixed(3) + ")");
          gr.addColorStop(0.45, "rgba(" + COL + "," + (a * 0.55).toFixed(3) + ")");
          gr.addColorStop(1, "rgba(" + COL + ",0)");
          g.fillStyle = gr; g.beginPath(); g.arc(q.x, q.y, r, 0, 6.2832); g.fill();
        }
        return this;
      }
    });
    var inst = new Cloud(); window.CLOUDS._last = inst; return inst;   // _last: tests
  }
  window.CLOUDS = { layer: layer, R_MIN: R_MIN, R_MAX: R_MAX, alphaFor: alphaFor, FRESH_H: FRESH_H, GONE_H: GONE_H };
})();
