/* PintsNow — 🗺️ MBX: ONE Mapbox GL JS map, no Leaflet (CONTRACT "KARTSTIL 6 · MBX", owner 2026-11-07: "move everything to Mapbox").
   window.MBX + window.L. L is a small Leaflet-shaped API (the subset the app's ~45 map files use) drawn by Mapbox GL JS, so every
   module keeps its code: L.map, marker, divIcon, layerGroup, featureGroup, markerClusterGroup, popup, circle, circleMarker,
   polyline, polygon, tileLayer, latLng(Bounds), point, DomUtil, DomEvent, Layer.extend, svg / canvas (no-ops), heatLayer (GL heat
   lives in glmap.js). Zoom numbers stay on the Leaflet scale (= GL zoom + 1), so every zoom rule in the app keeps its meaning.
   - Engines: "gl" (the main map, once js/basemap.js has made the ONE mapboxgl.Map = one billed map load) and "raster" (a tiny
     built-in raster map: the start frame before GL, the no-WebGL / no-token fallback, and the small free mini maps in
     homezone / near / passport, which must not cost a Mapbox map load each).
   - DOM markers (people pins, clusters, chips, my pins …) sit in 0 × 0 Leaflet-style panes inside the GL canvas container (a drag
     on a pin pans the map), positioned on GL "move" (same frame as the GL render, no lag). Only markers in view (+ 60 %) are in
     the DOM; markers in "virtual" panes (bars / hotbars while glmap.js draws them in GL) are never in the DOM.
   - Vector layers (circle, polygon, polyline, circleMarker) are GL fill / line / circle layers, one GeoJSON source per pane,
     under the GL bar layers. Raster engine: SVG.
   - Clusters: screen-space greedy clustering per zoom (≥ 0.25 step), re-used markers by key, no spiderfy (as before).
   No RPC, no mods hooks. MBX.nearbyPlaces(lat, lng, opts) → Promise of bars + restaurants near a spot (loaded data). */
(function () {
  "use strict";
  var W = window, D = document;
  var MBX = W.MBX = W.MBX || {};
  var stats = MBX.stats = { moves: 0, posMs: 0, posN: 0, mounted: 0, markers: 0, clusterRuns: 0, clusterMs: 0, shapeSets: 0 };

  /* ================= util ================= */
  var lastId = 0;
  function stamp(o) { if (o._leaflet_id == null) o._leaflet_id = ++lastId; return o._leaflet_id; }
  function extend(d) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) d[k] = s[k]; } return d; }
  function setOptions(obj, o) {
    if (!Object.prototype.hasOwnProperty.call(obj, "options")) obj.options = obj.options ? Object.create(obj.options) : {};
    for (var k in o) obj.options[k] = o[k];
    return obj.options;
  }
  function words(s) { return String(s).trim().split(/\s+/); }
  function raf(fn) { return (W.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }
  var Util = { extend: extend, stamp: stamp, setOptions: setOptions, splitWords: words, bind: function (fn, o) { return fn.bind(o); },
    requestAnimFrame: raf, cancelAnimFrame: function (id) { (W.cancelAnimationFrame || clearTimeout)(id); },
    isArray: Array.isArray, emptyImageUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", trim: function (s) { return String(s).trim(); } };

  /* ================= Class (Leaflet-like) ================= */
  function Class() {}
  Class.extend = function (props) {
    var Parent = this;
    var NewClass = function () {
      setOptions(this);
      if (this.initialize) this.initialize.apply(this, arguments);
      this.callInitHooks();
    };
    var proto = NewClass.prototype = Object.create(Parent.prototype);
    proto.constructor = NewClass;
    for (var s in Parent) if (Object.prototype.hasOwnProperty.call(Parent, s) && s !== "prototype") NewClass[s] = Parent[s];
    if (props.statics) { extend(NewClass, props.statics); }
    if (props.includes) [].concat(props.includes).forEach(function (inc) { extend(proto, inc); });
    if (proto.options) props.options = extend(Object.create(proto.options), props.options);
    for (var k in props) if (k !== "statics" && k !== "includes") proto[k] = props[k];
    proto._initHooks = [];
    proto.callInitHooks = function () {
      if (this._initHooksCalled) return;
      var chain = [], p = Object.getPrototypeOf(this);
      while (p && p._initHooks) { chain.unshift(p._initHooks); p = Object.getPrototypeOf(p); }
      this._initHooksCalled = true;
      var self = this; chain.forEach(function (hs) { hs.forEach(function (h) { h.call(self); }); });
    };
    return NewClass;
  };
  Class.prototype.callInitHooks = function () {};
  Class.include = function (p) { extend(this.prototype, p); return this; };
  Class.mergeOptions = function (o) { extend(this.prototype.options, o); return this; };
  Class.addInitHook = function (fn) { var args = [].slice.call(arguments, 1), f = typeof fn === "function" ? fn : function () { this[fn].apply(this, args); };
    if (!Object.prototype.hasOwnProperty.call(this.prototype, "_initHooks")) this.prototype._initHooks = [];
    this.prototype._initHooks.push(f); return this; };

  /* ================= Evented ================= */
  var Events = {
    on: function (types, fn, ctx) {
      if (types && typeof types === "object") { for (var t in types) this._on(t, types[t], fn); return this; }
      var w = words(types); for (var i = 0; i < w.length; i++) this._on(w[i], fn, ctx);
      return this;
    },
    _on: function (type, fn, ctx) {
      if (typeof fn !== "function") return;
      var ev = this._events || (this._events = {}), l = ev[type] || (ev[type] = []);
      for (var i = 0; i < l.length; i++) if (l[i].fn === fn && l[i].ctx === ctx) return;
      l.push({ fn: fn, ctx: ctx });
    },
    off: function (types, fn, ctx) {
      if (!arguments.length) { this._events = {}; return this; }
      if (types && typeof types === "object") { for (var t in types) this._off(t, types[t], fn); return this; }
      var w = words(types); for (var i = 0; i < w.length; i++) this._off(w[i], fn, ctx);
      return this;
    },
    _off: function (type, fn, ctx) {
      var ev = this._events, l = ev && ev[type]; if (!l) return;
      if (!fn) { ev[type] = []; return; }
      ev[type] = l.filter(function (x) { return !(x.fn === fn && (ctx === undefined || x.ctx === ctx)); });
    },
    once: function (types, fn, ctx) {
      if (types && typeof types === "object") { for (var t in types) this.once(t, types[t], fn); return this; }
      var self = this, h = function () { self.off(types, fn, ctx).off(types, h, ctx); };
      return this.on(types, fn, ctx).on(types, h, ctx);
    },
    fire: function (type, data, propagate) {
      var ev = extend({}, data, { type: type, target: this, sourceTarget: (data && data.sourceTarget) || this });
      var l = this._events && this._events[type];
      if (l && l.length) {
        l = l.slice();
        for (var i = 0; i < l.length; i++) { try { l[i].fn.call(l[i].ctx || this, ev); } catch (e) { try { console.warn("olnu mbx " + type, e); } catch (x) {} } }
      }
      if (propagate && this._eventParents) for (var k in this._eventParents) this._eventParents[k].fire(type, extend({}, ev, { layer: ev.layer || this, propagatedFrom: this }), true);
      return this;
    },
    listens: function (type) { var l = this._events && this._events[type]; return !!(l && l.length); },
    addEventParent: function (p) { (this._eventParents = this._eventParents || {})[stamp(p)] = p; return this; },
    removeEventParent: function (p) { if (this._eventParents) delete this._eventParents[stamp(p)]; return this; }
  };
  Events.addEventListener = Events.on; Events.removeEventListener = Events.off; Events.clearAllEventListeners = function () { this._events = {}; return this; };
  Events.addOneTimeEventListener = Events.once; Events.fireEvent = Events.fire; Events.hasEventListeners = Events.listens;
  var Evented = Class.extend(Events);

  /* ================= geometry ================= */
  function Point(x, y, round) { this.x = round ? Math.round(x) : x; this.y = round ? Math.round(y) : y; }
  Point.prototype = {
    clone: function () { return new Point(this.x, this.y); },
    add: function (p) { p = point(p); return new Point(this.x + p.x, this.y + p.y); }, _add: function (p) { p = point(p); this.x += p.x; this.y += p.y; return this; },
    subtract: function (p) { p = point(p); return new Point(this.x - p.x, this.y - p.y); }, _subtract: function (p) { p = point(p); this.x -= p.x; this.y -= p.y; return this; },
    multiplyBy: function (n) { return new Point(this.x * n, this.y * n); }, divideBy: function (n) { return new Point(this.x / n, this.y / n); },
    scaleBy: function (p) { return new Point(this.x * p.x, this.y * p.y); }, unscaleBy: function (p) { return new Point(this.x / p.x, this.y / p.y); },
    round: function () { return new Point(Math.round(this.x), Math.round(this.y)); }, floor: function () { return new Point(Math.floor(this.x), Math.floor(this.y)); },
    ceil: function () { return new Point(Math.ceil(this.x), Math.ceil(this.y)); }, trunc: function () { return new Point(Math.trunc(this.x), Math.trunc(this.y)); },
    distanceTo: function (p) { p = point(p); var x = p.x - this.x, y = p.y - this.y; return Math.sqrt(x * x + y * y); },
    equals: function (p) { p = point(p); return p.x === this.x && p.y === this.y; },
    contains: function (p) { p = point(p); return Math.abs(p.x) <= Math.abs(this.x) && Math.abs(p.y) <= Math.abs(this.y); },
    toString: function () { return "Point(" + this.x + ", " + this.y + ")"; }
  };
  function point(x, y, round) {
    if (x instanceof Point) return x;
    if (Array.isArray(x)) return new Point(x[0], x[1]);
    if (x == null) return x;
    if (typeof x === "object" && "x" in x && "y" in x) return new Point(x.x, x.y);
    return new Point(x, y, round);
  }
  function Bounds(a, b) { if (!a) return; var pts = b ? [a, b] : a; for (var i = 0; i < pts.length; i++) this.extend(pts[i]); }
  Bounds.prototype = {
    extend: function (p) { p = point(p); if (!this.min) { this.min = p.clone(); this.max = p.clone(); } else { this.min.x = Math.min(p.x, this.min.x); this.max.x = Math.max(p.x, this.max.x); this.min.y = Math.min(p.y, this.min.y); this.max.y = Math.max(p.y, this.max.y); } return this; },
    getCenter: function () { return new Point((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2); },
    getSize: function () { return this.max.subtract(this.min); }, isValid: function () { return !!(this.min && this.max); },
    contains: function (o) { var a, b; if (o instanceof Bounds) { a = o.min; b = o.max; } else a = b = point(o); return a.x >= this.min.x && b.x <= this.max.x && a.y >= this.min.y && b.y <= this.max.y; },
    intersects: function (o) { return o.min.x <= this.max.x && o.max.x >= this.min.x && o.min.y <= this.max.y && o.max.y >= this.min.y; }
  };
  function LatLng(lat, lng, alt) { this.lat = +lat; this.lng = +lng; if (alt !== undefined) this.alt = +alt; }
  LatLng.prototype = {
    equals: function (o, m) { o = latLng(o); if (!o) return false; return Math.max(Math.abs(this.lat - o.lat), Math.abs(this.lng - o.lng)) <= (m == null ? 1e-9 : m); },
    toString: function () { return "LatLng(" + this.lat + ", " + this.lng + ")"; },
    distanceTo: function (o) { return haversine(this, latLng(o)); },
    wrap: function () { var l = ((this.lng + 180) % 360 + 360) % 360 - 180; return new LatLng(this.lat, l === -180 ? 180 : l, this.alt); },
    toBounds: function (m) { var dLat = 180 * m / 40075017, dLng = dLat / Math.cos(Math.PI / 180 * this.lat); return latLngBounds([this.lat - dLat, this.lng - dLng], [this.lat + dLat, this.lng + dLng]); },
    clone: function () { return new LatLng(this.lat, this.lng, this.alt); }
  };
  function latLng(a, b, c) {
    if (a instanceof LatLng) return a;
    if (Array.isArray(a) && typeof a[0] !== "object") return a.length >= 2 ? new LatLng(a[0], a[1], a[2]) : null;
    if (a == null) return a;
    if (typeof a === "object" && "lat" in a) return new LatLng(a.lat, "lng" in a ? a.lng : a.lon, a.alt);
    if (b === undefined) return null;
    return new LatLng(a, b, c);
  }
  function haversine(a, b) { var R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
    var s = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)); }
  function LatLngBounds(a, b) { if (!a) return; var ll = b ? [a, b] : a; for (var i = 0; i < ll.length; i++) this.extend(ll[i]); }
  LatLngBounds.prototype = {
    extend: function (o) {
      var sw, ne;
      if (o instanceof LatLngBounds) { sw = o._southWest; ne = o._northEast; if (!sw || !ne) return this; }
      else if (Array.isArray(o) && o.length && typeof o[0] === "object" && !(o[0] instanceof LatLng) && Array.isArray(o[0])) { return this.extend(latLngBounds(o)); }
      else { o = latLng(o); if (!o) return this; sw = ne = o; }
      if (!this._southWest) { this._southWest = new LatLng(sw.lat, sw.lng); this._northEast = new LatLng(ne.lat, ne.lng); }
      else { this._southWest.lat = Math.min(sw.lat, this._southWest.lat); this._southWest.lng = Math.min(sw.lng, this._southWest.lng);
        this._northEast.lat = Math.max(ne.lat, this._northEast.lat); this._northEast.lng = Math.max(ne.lng, this._northEast.lng); }
      return this;
    },
    pad: function (r) { var sw = this._southWest, ne = this._northEast, h = Math.abs(sw.lat - ne.lat) * r, w = Math.abs(sw.lng - ne.lng) * r;
      return new LatLngBounds(new LatLng(sw.lat - h, sw.lng - w), new LatLng(ne.lat + h, ne.lng + w)); },
    getCenter: function () { return new LatLng((this._southWest.lat + this._northEast.lat) / 2, (this._southWest.lng + this._northEast.lng) / 2); },
    getSouthWest: function () { return this._southWest; }, getNorthEast: function () { return this._northEast; },
    getNorthWest: function () { return new LatLng(this.getNorth(), this.getWest()); }, getSouthEast: function () { return new LatLng(this.getSouth(), this.getEast()); },
    getWest: function () { return this._southWest.lng; }, getSouth: function () { return this._southWest.lat; }, getEast: function () { return this._northEast.lng; }, getNorth: function () { return this._northEast.lat; },
    contains: function (o) {
      var sw, ne;
      if (o instanceof LatLngBounds) { sw = o._southWest; ne = o._northEast; } else if (o && (o._southWest)) { sw = o._southWest; ne = o._northEast; } else { sw = ne = latLng(o); }
      if (!sw || !this._southWest) return false;
      return sw.lat >= this._southWest.lat && ne.lat <= this._northEast.lat && sw.lng >= this._southWest.lng && ne.lng <= this._northEast.lng;
    },
    intersects: function (o) { o = latLngBounds(o); var sw = this._southWest, ne = this._northEast, s2 = o._southWest, n2 = o._northEast;
      return n2.lat >= sw.lat && s2.lat <= ne.lat && n2.lng >= sw.lng && s2.lng <= ne.lng; },
    overlaps: function (o) { return this.intersects(o); },
    toBBoxString: function () { return [this.getWest(), this.getSouth(), this.getEast(), this.getNorth()].join(","); },
    equals: function (o, m) { o = latLngBounds(o); return !!o && this._southWest.equals(o._southWest, m) && this._northEast.equals(o._northEast, m); },
    isValid: function () { return !!(this._southWest && this._northEast); }
  };
  function latLngBounds(a, b) { if (a instanceof LatLngBounds) return a; return new LatLngBounds(a, b); }

  /* Web Mercator on the Leaflet scale: world size = 256 · 2^z (= GL 512 · 2^(z − 1)) */
  var MAXLAT = 85.0511287798;
  function wx(lng, z) { return (lng + 180) / 360 * 256 * Math.pow(2, z); }
  function wy(lat, z) { lat = Math.max(-MAXLAT, Math.min(MAXLAT, lat)); var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  function ux(x, z) { return x / (256 * Math.pow(2, z)) * 360 - 180; }
  function uy(y, z) { var n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  /* ================= DomUtil / DomEvent ================= */
  var DomUtil = {
    get: function (id) { return typeof id === "string" ? D.getElementById(id) : id; },
    create: function (tag, cls, parent) { var e = D.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; },
    remove: function (e) { if (e && e.parentNode) e.parentNode.removeChild(e); },
    empty: function (e) { while (e && e.firstChild) e.removeChild(e.firstChild); },
    toFront: function (e) { if (e && e.parentNode && e.parentNode.lastChild !== e) e.parentNode.appendChild(e); },
    toBack: function (e) { if (e && e.parentNode && e.parentNode.firstChild !== e) e.parentNode.insertBefore(e, e.parentNode.firstChild); },
    hasClass: function (e, c) { return !!(e && e.classList && e.classList.contains(c)); },
    addClass: function (e, c) { if (e && e.classList) words(c).forEach(function (x) { if (x) e.classList.add(x); }); },
    removeClass: function (e, c) { if (e && e.classList) words(c).forEach(function (x) { if (x) e.classList.remove(x); }); },
    setClass: function (e, c) { if (e) e.className = c; }, getClass: function (e) { return e ? e.className : ""; },
    setOpacity: function (e, v) { if (e) e.style.opacity = v; },
    setTransform: function (e, off, scale) { var p = off || new Point(0, 0); e.style.transform = "translate3d(" + p.x + "px," + p.y + "px,0)" + (scale ? " scale(" + scale + ")" : ""); },
    setPosition: function (e, p) { e._leaflet_pos = p; DomUtil.setTransform(e, p); },
    getPosition: function (e) { return e._leaflet_pos || new Point(0, 0); },
    disableTextSelection: function () {}, enableTextSelection: function () {}, disableImageDrag: function () {}, enableImageDrag: function () {},
    TRANSFORM: "transform"
  };
  function stopProp(e) { if (e && e.stopPropagation) e.stopPropagation(); else if (e && e.originalEvent) { e.originalEvent._stopped = true; } if (e) e._stopped = true; return DomEvent; }
  var DomEvent = {
    on: function (el, types, fn, ctx) {
      if (types && typeof types === "object") { for (var t in types) DomEvent.on(el, t, types[t], fn); return DomEvent; }
      words(types).forEach(function (t) { var h = ctx ? fn.bind(ctx) : fn; (el._mbxH = el._mbxH || []).push([t, fn, h]); el.addEventListener(t, h, t === "wheel" || t === "touchstart" || t === "touchmove" ? { passive: false } : false); });
      return DomEvent;
    },
    off: function (el, types, fn) {
      if (types && typeof types === "object") { for (var t in types) DomEvent.off(el, t, types[t]); return DomEvent; }
      words(types).forEach(function (t) { (el._mbxH || []).forEach(function (x) { if (x[0] === t && (!fn || x[1] === fn)) el.removeEventListener(t, x[2]); }); });
      return DomEvent;
    },
    stopPropagation: stopProp,
    preventDefault: function (e) { if (e && e.preventDefault) e.preventDefault(); return DomEvent; },
    stop: function (e) { DomEvent.preventDefault(e); stopProp(e); return DomEvent; },
    disableClickPropagation: function (el) { DomEvent.on(el, "mousedown touchstart pointerdown dblclick contextmenu", function (e) { e.stopPropagation(); }); el._leaflet_disable_click = true; return DomEvent; },
    disableScrollPropagation: function (el) { DomEvent.on(el, "wheel", function (e) { e.stopPropagation(); }); return DomEvent; },
    getMousePosition: function (e, c) { if (!c) return new Point(e.clientX, e.clientY); var r = c.getBoundingClientRect(); return new Point(e.clientX - r.left - c.clientLeft, e.clientY - r.top - c.clientTop); },
    isExternalTarget: function () { return false; }
  };
  DomEvent.addListener = DomEvent.on; DomEvent.removeListener = DomEvent.off;

  /* ================= CSS (the Leaflet base rules the app's own CSS builds on) =================
     Parts adapted from Leaflet 1.9.4 leaflet.css (BSD-2-Clause, © Vladimir Agafonkin): pane / marker / popup layout. */
  var CSS =
    ".leaflet-pane,.leaflet-marker-icon,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-layer,.mbx-tile{position:absolute;left:0;top:0}" +
    ".leaflet-container{overflow:hidden;-webkit-tap-highlight-color:transparent;outline-offset:1px;font-family:inherit}" +
    ".leaflet-container .mbx-raster img{max-width:none !important;max-height:none !important;width:256px;height:256px;padding:0}" +
    ".leaflet-marker-icon{display:block;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;pointer-events:none;will-change:transform}" +
    ".leaflet-marker-icon.leaflet-interactive{pointer-events:auto;cursor:pointer}" +
    ".leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}" +
    ".leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}" +
    ".leaflet-map-pane{position:absolute;left:0;top:0;width:0;height:0}" +
    ".mbx-raster{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;z-index:0;pointer-events:none}" +
    ".mbx-raster img{position:absolute;left:0;top:0;user-select:none}" +
    ".mbx-svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}.mbx-svg .leaflet-interactive{pointer-events:auto;cursor:pointer}" +
    ".leaflet-popup{position:absolute;text-align:center;margin-bottom:20px;will-change:transform}" +
    ".leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}" +
    ".leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;min-height:1px}.leaflet-popup-content p{margin:1.3em 0}" +
    ".leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}" +
    ".leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;transform:rotate(45deg)}" +
    ".leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}" +
    ".leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:transparent}" +
    ".leaflet-popup-scrolled{overflow:auto}" +
    ".leaflet-tooltip{position:absolute;padding:4px 8px;background:#0a0f24;color:#fff6e5;border-radius:8px;white-space:nowrap;pointer-events:none;font:600 12px/1.2 var(--body,system-ui,sans-serif);box-shadow:0 1px 4px rgba(0,0,0,.5)}" +
    // the Mapbox logo: js/basemap.js shows the official logo next to the ⓘ button (Mapbox terms), the built-in copy sits under the dock
    ".mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-logo{display:none}" +
    ".mbx-virtual{display:none !important}";
  function css() { if (D.getElementById("mbx-css") || !D.head) return; var s = D.createElement("style"); s.id = "mbx-css"; s.textContent = CSS; D.head.insertBefore(s, D.head.firstChild); }
  if (D.head) css(); else D.addEventListener("DOMContentLoaded", css);

  /* ================= Map ================= */
  var DEF_PANES = { mapPane: 0, tilePane: 200, overlayPane: 400, shadowPane: 500, markerPane: 600, tooltipPane: 650, popupPane: 700 };
  var MapC = Evented.extend({
    options: { minZoom: 0, maxZoom: 19, zoomControl: false, attributionControl: false, closePopupOnClick: true, dragging: true, touchZoom: true,
      scrollWheelZoom: true, doubleClickZoom: true, boxZoom: true, keyboard: true, zoomSnap: 1 },
    initialize: function (id, options) {
      css();
      options = setOptions(this, options);
      var c = this._container = DomUtil.get(id);
      if (!c) throw new Error("Map container not found.");
      if (c._leaflet_id) throw new Error("Map container is already initialized.");
      stamp(c);
      DomUtil.addClass(c, "leaflet-container leaflet-touch leaflet-fade-anim leaflet-grab leaflet-touch-drag leaflet-touch-zoom");
      var pos = W.getComputedStyle ? W.getComputedStyle(c).position : "";
      if (pos !== "absolute" && pos !== "relative" && pos !== "fixed" && pos !== "sticky") c.style.position = "relative";
      this._layers = {}; this._zoomBoundLayers = {}; this._panes = {}; this._paneZ = {}; this._virtual = {};
      this._dom = {};            // stamp → Marker / DivOverlay that needs positioning
      this._shapes = new Shapes(this);
      this._c = options.center ? latLng(options.center) : new LatLng(0, 0);
      this._z = options.zoom != null ? +options.zoom : 3;
      this._loaded = false; this._gl = null; this._glReady = false;
      this._mapPane = this.createPane("mapPane", c);
      this._mapPane.className = "leaflet-pane leaflet-map-pane";
      for (var n in DEF_PANES) if (n !== "mapPane") this.createPane(n);
      this._raster = DomUtil.create("div", "mbx-raster", c); c.insertBefore(this._raster, c.firstChild);
      this._rasterOn = true; this._tiles = {};
      this._handlers();
      this._domEvents();
      var self = this;
      this._ro = W.ResizeObserver ? new ResizeObserver(function () { self._onResize(); }) : null;
      if (this._ro) this._ro.observe(c); else W.addEventListener("resize", function () { self._onResize(); });
      this._size = null;
      if (options.center && options.zoom != null) this.setView(this._c, this._z, { reset: true });
      MBX._maps = (MBX._maps || []).concat(this);
      if (!MBX.main) MBX.main = this;
    },
    /* ---------- engines ---------- */
    _attachGL: function (gl) {   // js/basemap.js: the ONE Mapbox map now drives this map (again, after a parked fallback)
      var self = this, again = gl._mbxHooked === this; this._gl = gl;
      var cc = gl.getCanvasContainer();
      if (again) { cc.style.display = ""; try { gl.resize(); } catch (e) {} this._glReady = !!gl.loaded && gl.loaded(); }
      cc.appendChild(this._mapPane);
      try { gl.dragRotate.disable(); gl.touchZoomRotate.disableRotation(); gl.touchPitch && gl.touchPitch.disable(); gl.keyboard.disableRotation && gl.keyboard.disableRotation(); } catch (e) {}
      try { gl.jumpTo({ center: [this._c.lng, this._c.lat], zoom: Math.max(0, this._z - 1) }); } catch (e) {}
      this._applyHandlers();
      if (again) { if (this._glReady) this._rasterShow(false); this._shapes.styleLoaded(); this._onMove(); this._onMoveEnd(); return this; }
      gl._mbxHooked = this;
      ["movestart", "move", "moveend", "zoomstart", "zoom", "zoomend", "dragstart", "drag", "dragend", "resize"].forEach(function (t) {
        gl.on(t, function (e) {
          if (self._gl !== gl) return;
          if (t === "move") self._onMove(); else if (t === "moveend") self._onMoveEnd(); else if (t === "zoomend") self._zIndexAll();
          if (t === "resize") self._size = null;
          self.fire(t, e && e.originalEvent ? { originalEvent: e.originalEvent } : null);
        });
      });
      ["click", "dblclick", "contextmenu", "mousedown", "mouseup", "mousemove"].forEach(function (t) {
        gl.on(t, function (e) { if (self._gl === gl) self._glMouse(t, e); });
      });
      gl.on("style.load", function () { if (self._gl === gl) self._shapes.styleLoaded(); });
      gl.on("load", function () { if (self._gl !== gl) return; self._glReady = true; self._rasterShow(false); self._shapes.styleLoaded(); });
      if (gl.isStyleLoaded && gl.isStyleLoaded()) this._shapes.styleLoaded();
      this._onMove(); this._onMoveEnd();
      return this;
    },
    // fallback: back to the built-in raster engine (tiles from the map's tile layers). The GL map is PARKED (hidden, kept),
    // so coming back is the same map object (no second billed map load); destroy = true removes it for good.
    _detachGL: function (destroy) {
      var gl = this._gl; if (!gl) return this;
      this._c = this.getCenter(); this._z = this.getZoom();
      this._gl = null; this._glReady = false;
      this._container.appendChild(this._mapPane);
      if (destroy) { try { gl.remove(); } catch (e) {} } else { try { gl.getCanvasContainer().style.display = "none"; } catch (e) {} }
      this._shapes.engineChanged();
      this._rasterShow(true); this._onMove(); this._onMoveEnd();
      return this;
    },
    _rasterShow: function (on) { this._rasterOn = on; this._raster.style.display = on ? "" : "none"; if (on) this._drawTiles(); else { DomUtil.empty(this._raster); this._tiles = {}; } },
    isGL: function () { return !!this._gl; },
    getMapboxMap: function () { return this._gl; },
    /* ---------- view ---------- */
    getZoom: function () { return this._gl ? this._gl.getZoom() + 1 : this._z; },
    getCenter: function () { if (this._gl) { var c = this._gl.getCenter(); return new LatLng(c.lat, c.lng); } return new LatLng(this._c.lat, this._c.lng); },
    getSize: function () {
      if (!this._size) { var c = this._container; this._size = new Point(c.clientWidth || 0, c.clientHeight || 0); }
      return this._size.clone();
    },
    getBounds: function () { var s = this.getSize(), a = this.containerPointToLatLng([0, s.y]), b = this.containerPointToLatLng([s.x, 0]); return new LatLngBounds(a, b); },
    getPixelBounds: function () { var c = this.project(this.getCenter()), h = this.getSize().divideBy(2); return new Bounds(c.subtract(h), c.add(h)); },
    getPixelOrigin: function () { return this.getPixelBounds().min; },
    getMinZoom: function () { return this.options.minZoom || 0; }, getMaxZoom: function () { return this.options.maxZoom == null ? 19 : this.options.maxZoom; },
    setMinZoom: function (z) { this.options.minZoom = z; if (this._gl) this._gl.setMinZoom(Math.max(0, z - 1)); return this; },
    setMaxZoom: function (z) { this.options.maxZoom = z; if (this._gl) this._gl.setMaxZoom(z - 1); return this; },
    getZoomScale: function (to, from) { return Math.pow(2, to - (from == null ? this.getZoom() : from)); },
    getScaleZoom: function (s, from) { return (from == null ? this.getZoom() : from) + Math.log(s) / Math.LN2; },
    _clampZ: function (z) { return Math.max(this.getMinZoom(), Math.min(this.getMaxZoom(), z)); },
    project: function (ll, z) { ll = latLng(ll); z = z == null ? this.getZoom() : z; return new Point(wx(ll.lng, z), wy(ll.lat, z)); },
    unproject: function (p, z) { p = point(p); z = z == null ? this.getZoom() : z; return new LatLng(uy(p.y, z), ux(p.x, z)); },
    latLngToContainerPoint: function (ll) {
      ll = latLng(ll);
      if (this._gl) { var q = this._gl.project([ll.lng, ll.lat]); return new Point(q.x, q.y); }
      var z = this._z, s = this.getSize();
      return new Point(wx(ll.lng, z) - wx(this._c.lng, z) + s.x / 2, wy(ll.lat, z) - wy(this._c.lat, z) + s.y / 2);
    },
    containerPointToLatLng: function (p) {
      p = point(p);
      if (this._gl) { var l = this._gl.unproject([p.x, p.y]); return new LatLng(l.lat, l.lng); }
      var z = this._z, s = this.getSize();
      return new LatLng(uy(p.y - s.y / 2 + wy(this._c.lat, z), z), ux(p.x - s.x / 2 + wx(this._c.lng, z), z));
    },
    // the panes never move: layer points = container points
    latLngToLayerPoint: function (ll) { return this.latLngToContainerPoint(ll); },
    layerPointToLatLng: function (p) { return this.containerPointToLatLng(p); },
    containerPointToLayerPoint: function (p) { return point(p).clone(); },
    layerPointToContainerPoint: function (p) { return point(p).clone(); },
    mouseEventToContainerPoint: function (e) { return DomEvent.getMousePosition(e, this._container); },
    mouseEventToLayerPoint: function (e) { return this.mouseEventToContainerPoint(e); },
    mouseEventToLatLng: function (e) { return this.containerPointToLatLng(this.mouseEventToContainerPoint(e)); },
    distance: function (a, b) { return haversine(latLng(a), latLng(b)); },
    wrapLatLng: function (ll) { return latLng(ll).wrap(); }, wrapLatLngBounds: function (b) { return b; },
    _getMapPanePos: function () { return new Point(0, 0); },
    _animOpts: function (o, dflt) { o = o || {}; var anim = o.animate === true || (o.animate !== false && o.duration != null) || (dflt && o.animate !== false); return { anim: anim, ms: o.duration != null ? o.duration * 1000 : 300 }; },
    setView: function (center, zoom, o) {
      center = latLng(center) || this.getCenter(); zoom = this._clampZ(zoom == null ? this.getZoom() : +zoom);
      var a = this._animOpts(o);
      if (this._gl) {
        var cam = { center: [center.lng, center.lat], zoom: Math.max(0, zoom - 1) };
        if (a.anim) this._gl.easeTo(extend(cam, { duration: a.ms })); else this._gl.jumpTo(cam);
      } else this._rasterView(center, zoom);
      if (!this._loaded) { this._loaded = true; this.fire("load"); }
      return this;
    },
    _rasterView: function (center, zoom, quiet) {
      var zc = Math.abs(zoom - this._z) > 1e-9, moved = zc || !center.equals(this._c);
      if (!quiet) { this.fire("movestart"); if (zc) this.fire("zoomstart"); }
      this._c = new LatLng(center.lat, center.lng); this._z = zoom;
      this._onMove();
      if (!quiet) { this.fire("move"); if (zc) this.fire("zoom"); if (zc) { this._zIndexAll(); this.fire("zoomend"); } this._onMoveEnd(); this.fire("moveend"); }
      return moved;
    },
    setZoom: function (z, o) { return this.setView(this.getCenter(), z, o); },
    zoomIn: function (d, o) { return this.setZoom(this.getZoom() + (d || 1), extend({ animate: true }, o)); },
    zoomOut: function (d, o) { return this.setZoom(this.getZoom() - (d || 1), extend({ animate: true }, o)); },
    setZoomAround: function (ll, z, o) { var p = ll instanceof Point ? ll : this.latLngToContainerPoint(ll), s = this.getScaleZoom ? this.getZoomScale(z) : 1, c = this.getSize().divideBy(2);
      var off = p.subtract(c).multiplyBy(1 - 1 / s); return this.setView(this.containerPointToLatLng(c.add(off)), z, o); },
    panTo: function (ll, o) { o = o || {}; return this.setView(ll, this.getZoom(), extend({ animate: o.animate !== false, duration: o.duration != null ? o.duration : 0.3 }, o)); },
    panBy: function (off, o) {
      off = point(off).round(); o = o || {}; if (!off.x && !off.y) return this;
      if (this._gl) { this._gl.panBy([off.x, off.y], { duration: o.animate === false ? 0 : (o.duration != null ? o.duration * 1000 : 250) }); return this; }
      var c = this.getSize().divideBy(2).add(off); this._rasterView(this.containerPointToLatLng(c), this._z); return this;
    },
    panInside: function (ll, o) { o = o || {}; var p = this.latLngToContainerPoint(ll), s = this.getSize(), pd = point(o.padding || [0, 0]), dx = 0, dy = 0;
      if (p.x < pd.x) dx = p.x - pd.x; else if (p.x > s.x - pd.x) dx = p.x - s.x + pd.x; if (p.y < pd.y) dy = p.y - pd.y; else if (p.y > s.y - pd.y) dy = p.y - s.y + pd.y;
      return dx || dy ? this.panBy([dx, dy], o) : this; },
    flyTo: function (ll, zoom, o) {
      o = o || {}; ll = latLng(ll); zoom = this._clampZ(zoom == null ? this.getZoom() : zoom);
      if (o.animate === false) return this.setView(ll, zoom, { animate: false });
      if (this._gl) { this._gl.flyTo({ center: [ll.lng, ll.lat], zoom: Math.max(0, zoom - 1), duration: (o.duration != null ? o.duration : 1) * 1000, essential: true }); return this; }
      return this.setView(ll, zoom);
    },
    _pad: function (o) {
      o = o || {}; var p = point(o.padding || [0, 0]), tl = point(o.paddingTopLeft || p), br = point(o.paddingBottomRight || p);
      return { top: tl.y, left: tl.x, bottom: br.y, right: br.x };
    },
    getBoundsZoom: function (b, inside, padding) {
      b = latLngBounds(b); padding = point(padding || [0, 0]);
      var s = this.getSize().subtract(padding), z0 = 20;
      var w = Math.abs(wx(b.getEast(), z0) - wx(b.getWest(), z0)), h = Math.abs(wy(b.getSouth(), z0) - wy(b.getNorth(), z0));
      var sc = Math.min(s.x / Math.max(1e-9, w), s.y / Math.max(1e-9, h)), z = z0 + Math.log(sc) / Math.LN2;
      z = inside ? Math.ceil(z) : Math.floor(z);
      return this._clampZ(z);
    },
    _boundsView: function (b, o) {
      b = latLngBounds(b); if (!b.isValid()) return null;
      var pd = this._pad(o), s = this.getSize();
      var inner = new Point(Math.max(1, s.x - pd.left - pd.right), Math.max(1, s.y - pd.top - pd.bottom));
      var z0 = 20, w = Math.abs(wx(b.getEast(), z0) - wx(b.getWest(), z0)), h = Math.abs(wy(b.getSouth(), z0) - wy(b.getNorth(), z0));
      var z = z0 + Math.log(Math.min(inner.x / Math.max(1e-9, w), inner.y / Math.max(1e-9, h))) / Math.LN2;
      z = Math.floor(z * 4) / 4;
      if (o && o.maxZoom != null) z = Math.min(z, o.maxZoom);
      z = this._clampZ(z);
      // centre of the bounds, shifted by the uneven padding
      var cx = (wx(b.getEast(), z) + wx(b.getWest(), z)) / 2 + (pd.right - pd.left) / 2, cy = (wy(b.getSouth(), z) + wy(b.getNorth(), z)) / 2 + (pd.bottom - pd.top) / 2;
      return { c: new LatLng(uy(cy, z), ux(cx, z)), z: z };
    },
    fitBounds: function (b, o) { var v = this._boundsView(b, o); if (!v) return this; return this.setView(v.c, v.z, o); },
    flyToBounds: function (b, o) { var v = this._boundsView(b, o); if (!v) return this; return this.flyTo(v.c, v.z, o); },
    setMaxBounds: function () { return this; },
    stop: function () { if (this._gl) this._gl.stop(); return this; },
    invalidateSize: function () { this._size = null; if (this._gl) this._gl.resize(); else this._onMove(), this._onMoveEnd(); return this; },
    whenReady: function (fn, ctx) { if (this._loaded) fn.call(ctx || this, { target: this }); else this.once("load", fn, ctx); return this; },
    getContainer: function () { return this._container; },
    getRenderer: function () { return null; },
    remove: function () {
      var self = this;
      this.fire("unload");
      Object.keys(this._layers).forEach(function (k) { try { self.removeLayer(self._layers[k]); } catch (e) {} });
      if (this._gl) { try { this._gl.remove(); } catch (e) {} this._gl = null; }
      if (this._ro) this._ro.disconnect();
      DomUtil.remove(this._mapPane); DomUtil.remove(this._raster);
      if (this._svgRoot) DomUtil.remove(this._svgRoot);
      (this._unbind || []).forEach(function (f) { f(); });
      delete this._container._leaflet_id;
      MBX._maps = (MBX._maps || []).filter(function (m) { return m !== self; });
      return this;
    },
    /* ---------- panes ---------- */
    createPane: function (name, container) {
      var cls = "leaflet-pane" + (name ? " leaflet-" + name.replace("Pane", "") + "-pane" : ""), p = DomUtil.create("div", cls, container || this._mapPane);
      if (name) { this._panes[name] = p; if (DEF_PANES[name]) p.style.zIndex = DEF_PANES[name]; }
      if (this._virtual[name]) DomUtil.addClass(p, "mbx-virtual");
      return p;
    },
    getPane: function (p) { return typeof p === "string" ? this._panes[p] : p; },
    getPanes: function () { return this._panes; },
    // MBX: markers in a virtual pane are never put in the DOM (glmap.js draws the bars in GL; their DOM twins only carry state)
    setVirtualPane: function (name, on) {
      on = !!on; if (!!this._virtual[name] === on) return this;
      this._virtual[name] = on; var p = this._panes[name]; if (p) p.classList.toggle("mbx-virtual", on);
      this._cull(true);
      return this;
    },
    isVirtualPane: function (name) { return !!this._virtual[name]; },
    /* ---------- layers ---------- */
    addLayer: function (l) {
      if (!l || !l._layerAdd) return this;
      var id = stamp(l); if (this._layers[id]) return this;
      this._layers[id] = l; l._mapToAdd = this;
      if (l.beforeAdd) l.beforeAdd(this);
      l._layerAdd(this);
      return this;
    },
    removeLayer: function (l) {
      if (!l) return this;
      var id = stamp(l); if (!this._layers[id]) return this;
      if (this._loaded || true) { try { if (l.onRemove) l.onRemove(this); } catch (e) { try { console.warn("olnu mbx remove", e); } catch (x) {} } }
      delete this._layers[id];
      if (l.getEvents) { var ev = l.getEvents(); if (ev && typeof ev === "object") this.off(ev, l); }
      this.fire("layerremove", { layer: l }); l.fire("remove");
      l._map = l._mapToAdd = null;
      return this;
    },
    hasLayer: function (l) { return !!l && stamp(l) in this._layers; },
    eachLayer: function (fn, ctx) { for (var k in this._layers) fn.call(ctx, this._layers[k]); return this; },
    addControl: function (c) { if (c && c.addTo) c.addTo(this); return this; }, removeControl: function () { return this; },
    /* ---------- popups ---------- */
    openPopup: function (popup, ll, o) { if (!(popup instanceof Popup)) popup = new Popup(o).setContent(popup); if (ll) popup.setLatLng(ll); return popup.openOn(this); },
    closePopup: function (popup) { popup = arguments.length ? popup : this._popup; if (popup) popup.close(); return this; },
    openTooltip: function (t) { return this.addLayer(t); }, closeTooltip: function (t) { return t ? this.removeLayer(t) : this; },
    /* ---------- events from the DOM / GL ---------- */
    _mouseEvent: function (type, oe, pt) {
      var p = pt || this.mouseEventToContainerPoint(oe);
      return { originalEvent: oe, containerPoint: p, layerPoint: p, latlng: this.containerPointToLatLng(p) };
    },
    _blocked: function (oe) {   // a click on a DOM marker / popup / control: not a map click (Leaflet rules)
      var t = oe && oe.target; if (!t || !t.closest) return false;
      if (t.closest(".leaflet-marker-icon.leaflet-interactive, .leaflet-popup, .leaflet-control, .mbx-svg .leaflet-interactive")) return true;
      for (var e = t; e && e !== this._container; e = e.parentNode) if (e._leaflet_disable_click) return true;
      return false;
    },
    _glMouse: function (type, e) {
      var oe = e.originalEvent;
      if (type === "click" || type === "dblclick" || type === "contextmenu" || type === "mousedown") { if (this._blocked(oe)) return; }
      var ev = { originalEvent: oe, containerPoint: new Point(e.point.x, e.point.y), layerPoint: new Point(e.point.x, e.point.y), latlng: new LatLng(e.lngLat.lat, e.lngLat.lng) };
      if (type === "click") { this._click(ev); return; }
      if (type === "mousemove" && !this.listens("mousemove")) return;
      this.fire(type, ev);
    },
    _click: function (ev) {
      var oe = ev.originalEvent;
      this.fire("preclick", ev);
      if (oe && oe._olnuGl) return;                                  // glmap.js used this tap for a GL bar
      if (this._shapes.click(ev)) return;                            // a vector layer took it (no bubbling)
      if (oe && oe._stopped) return;
      this.fire("click", ev);
    },
    _domEvents: function () {
      var self = this, c = this._container;
      // raster engine only: GL has its own gestures and click events
      var st = null, pts = {}, moved = false, pinch = null, lastTap = 0;
      function down(e) {
        if (self._gl) return;
        if (e.button && e.button !== 0) return;
        if (self._blocked(e) && e.target.closest(".leaflet-popup, .leaflet-control")) return;
        if (e.target.closest && e.target.closest(".leaflet-marker-draggable")) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        if (ids.length === 1) { st = { x: e.clientX, y: e.clientY, c: self.getCenter(), t: Date.now(), z: self._z }; moved = false; self._dragStart = false; }
        else if (ids.length === 2 && self.options.touchZoom !== false) {
          var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: self._z, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; moved = true;
        }
        W.addEventListener("pointermove", move); W.addEventListener("pointerup", up); W.addEventListener("pointercancel", up);
      }
      function move(e) {
        if (self._gl || !pts[e.pointerId]) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts), r = c.getBoundingClientRect();
        if (pinch && ids.length >= 2) {
          var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), z = self._clampZ(pinch.z + Math.log(d / Math.max(1, pinch.d)) / Math.LN2);
          var m = new Point(pinch.mid.x - r.left, pinch.mid.y - r.top), ll = self.containerPointToLatLng(m);
          self._c = latLng(ll); self._z = z;   // keep the pinch centre under the fingers
          var p2 = self.latLngToContainerPoint(ll), off = p2.subtract(m); self._c = self.containerPointToLatLng(self.getSize().divideBy(2).add(off));
          self._onMove(); self.fire("move"); self.fire("zoom"); return;
        }
        if (!st || self.options.dragging === false) return;
        var dx = e.clientX - st.x, dy = e.clientY - st.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        if (!moved) { moved = true; self.fire("movestart"); self.fire("dragstart"); }
        var z = self._z, cx = wx(st.c.lng, z) - dx, cy = wy(st.c.lat, z) - dy;
        self._c = new LatLng(uy(cy, z), ux(cx, z)); self._onMove(); self.fire("move"); self.fire("drag");
      }
      function up(e) {
        if (self._gl || !pts[e.pointerId]) return;
        delete pts[e.pointerId];
        var left = Object.keys(pts).length;
        if (pinch && left < 2) { pinch = null; st = null; self._zIndexAll(); self.fire("zoomend"); self._onMoveEnd(); self.fire("moveend"); return; }
        if (left) return;
        W.removeEventListener("pointermove", move); W.removeEventListener("pointerup", up); W.removeEventListener("pointercancel", up);
        if (st && moved) { self.fire("dragend"); self._onMoveEnd(); self.fire("moveend"); }
        else if (st && !moved && !self._blocked(e)) {
          var now = Date.now();
          if (now - lastTap < 300 && self.options.doubleClickZoom !== false) { lastTap = 0; self.setZoomAround(self.mouseEventToContainerPoint(e), self._z + 1); }
          else { lastTap = now; self._click(self._mouseEvent("click", e)); }
        }
        st = null;
      }
      function wheel(e) {
        if (self._gl || self.options.scrollWheelZoom === false || self._blocked(e)) return;
        e.preventDefault();
        var z = self._clampZ(self._z + (e.deltaY < 0 ? 0.5 : -0.5));
        self.setZoomAround(self.mouseEventToContainerPoint(e), z);
      }
      c.addEventListener("pointerdown", down);
      c.addEventListener("wheel", wheel, { passive: false });
      this._unbind = [function () { c.removeEventListener("pointerdown", down); W.removeEventListener("pointermove", move); W.removeEventListener("pointerup", up); W.removeEventListener("pointercancel", up); c.removeEventListener("wheel", wheel); }];
      if (!this._gl) c.style.touchAction = "none";
    },
    /* ---------- handlers (dragging.disable() …) ---------- */
    _handlers: function () {
      var self = this;
      var mk = function (opt, gl) { return { enable: function () { self.options[opt] = true; self._applyHandlers(); return this; }, disable: function () { self.options[opt] = false; self._applyHandlers(); return this; },
        enabled: function () { return self.options[opt] !== false; }, _gl: gl }; };
      this.dragging = mk("dragging", "dragPan"); this.touchZoom = mk("touchZoom", "touchZoomRotate"); this.scrollWheelZoom = mk("scrollWheelZoom", "scrollZoom");
      this.doubleClickZoom = mk("doubleClickZoom", "doubleClickZoom"); this.boxZoom = mk("boxZoom", "boxZoom"); this.keyboard = mk("keyboard", "keyboard"); this.tap = mk("tap", null);
    },
    _applyHandlers: function () {
      var gl = this._gl; if (!gl) return;
      var self = this;
      ["dragging", "touchZoom", "scrollWheelZoom", "doubleClickZoom", "boxZoom", "keyboard"].forEach(function (k) {
        var h = self[k] && self[k]._gl && gl[self[k]._gl]; if (!h) return;
        try { if (self.options[k] === false) h.disable(); else h.enable(); } catch (e) {}
      });
      try { gl.touchZoomRotate.disableRotation(); } catch (e) {}
    },
    /* ---------- overlay positioning ---------- */
    _onResize: function () { this._size = null; if (!this._gl) { this._onMove(); this._cull(true); this.fire("resize"); } },
    _onMove: function () {
      var t0 = performance.now(), n = 0;
      stats.moves++;
      if (!this._gl && this._rasterOn) this._drawTiles();
      if (this._gl && this._rasterOn && !this._glReady) this._drawTiles();
      var now = t0;
      if (!this._cullAt || now - this._cullAt > 140) this._cull(false);
      for (var k in this._dom) { var o = this._dom[k]; if (o._mounted) { o._setPos(); n++; } }
      this._shapes.move();
      var ms = performance.now() - t0; stats.posMs += ms; stats.posN++; stats.lastPosMs = ms; stats.lastPosN = n;
    },
    _onMoveEnd: function () { this._cull(true); this._zIndexAll(); this._shapes.moveEnd(); },
    _zIndexAll: function () { for (var k in this._dom) { var o = this._dom[k]; if (o._mounted && o._setZ) o._setZ(); } },
    _cull: function (force) {
      this._cullAt = performance.now();
      var s = this.getSize(), mx = s.x * 0.6 + 80, my = s.y * 0.6 + 80, n = 0, tot = 0;
      for (var k in this._dom) {
        var o = this._dom[k]; tot++;
        var want = o._wantMount(s, mx, my);
        if (want && !o._mounted) o._mount(); else if (!want && o._mounted) o._unmount();
        if (o._mounted) n++;
      }
      stats.mounted = n; stats.markers = tot;
    },
    _domAdd: function (o) { this._dom[stamp(o)] = o; },
    _domRemove: function (o) { delete this._dom[stamp(o)]; if (o._mounted) o._unmount(); },
    /* ---------- raster engine: tiles ---------- */
    _tileLayers: function () { var out = []; for (var k in this._layers) if (this._layers[k] instanceof TileLayer) out.push(this._layers[k]); return out; },
    _drawTiles: function () {
      var tls = this._tileLayers(), root = this._raster, s = this.getSize(); if (!s.x || !s.y) return;
      var z = this.getZoom(), c = this.getCenter(), want = {}, self = this;
      tls.forEach(function (tl, li) {
        var o = tl.options, tz = Math.max(0, Math.min(o.maxNativeZoom != null ? o.maxNativeZoom : 19, Math.round(z)));
        var sc = Math.pow(2, z - tz), ts = 256 * sc, cx = wx(c.lng, tz) * sc, cy = wy(c.lat, tz) * sc, n = Math.pow(2, tz);
        var x0 = Math.floor((cx - s.x / 2) / ts), x1 = Math.floor((cx + s.x / 2) / ts), y0 = Math.max(0, Math.floor((cy - s.y / 2) / ts)), y1 = Math.min(n - 1, Math.floor((cy + s.y / 2) / ts));
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
          var xx = ((x % n) + n) % n, key = li + "/" + tz + "/" + xx + "/" + y + "/" + x, img = self._tiles[key];
          if (!img) {
            img = self._tiles[key] = D.createElement("img"); img.alt = ""; img.decoding = "async"; img.draggable = false; img.className = "leaflet-tile leaflet-tile-loaded";
            img.src = tl.getTileUrl({ x: xx, y: y, z: tz }); img.style.opacity = o.opacity != null ? o.opacity : 1; img.style.zIndex = li;
            root.appendChild(img);
          }
          want[key] = 1;
          img.style.width = img.style.height = ts + "px";
          img.style.transform = "translate3d(" + (x * ts - cx + s.x / 2) + "px," + (y * ts - cy + s.y / 2) + "px,0)";
        }
      });
      for (var k in this._tiles) if (!want[k]) { DomUtil.remove(this._tiles[k]); delete this._tiles[k]; }
    }
  });
  Object.defineProperty(MapC.prototype, "_animatingZoom", { get: function () { return !!(this._gl && this._gl.isZooming && this._gl.isZooming() && this._gl.isEasing && this._gl.isEasing()); } });
  Object.defineProperty(MapC.prototype, "_zooming", { get: function () { return !!(this._gl && this._gl.isZooming && this._gl.isZooming()); } });
  function map(id, o) { return new MapC(id, o); }

  /* ================= Layer + groups ================= */
  var Layer = Evented.extend({
    options: { pane: "overlayPane", attribution: null, bubblingMouseEvents: true },
    addTo: function (m) { m.addLayer(this); return this; },
    remove: function () { return this.removeFrom(this._map || this._mapToAdd); },
    removeFrom: function (o) { if (o) o.removeLayer(this); return this; },
    getPane: function (n) { var m = this._map || this._mapToAdd; return m ? m.getPane(n ? this.options[n] || n : this.options.pane) : null; },
    addInteractiveTarget: function () { return this; }, removeInteractiveTarget: function () { return this; },
    getAttribution: function () { return this.options.attribution; },
    _layerAdd: function (m) {
      this._map = m; this._zoomAnimated = false;
      var ev = this.getEvents && this.getEvents(); if (ev && typeof ev === "object") m.on(ev, this);
      this.onAdd(m);
      this.fire("add"); m.fire("layeradd", { layer: this });
    },
    onAdd: function () {}, onRemove: function () {},
    /* popups (Leaflet Layer.include(Popup)) */
    bindPopup: function (content, o) {
      this._popup = content instanceof Popup ? content : new Popup(o, this).setContent(content);
      this._popup._source = this;
      if (!this._popupHandlersAdded) { this.on({ click: this._openPopup, keypress: this._onKeyPress, remove: this.closePopup, move: this._movePopup }); this._popupHandlersAdded = true; }
      return this;
    },
    unbindPopup: function () { if (this._popup) { this.off({ click: this._openPopup, keypress: this._onKeyPress, remove: this.closePopup, move: this._movePopup }); this._popupHandlersAdded = false; this._popup = null; } return this; },
    openPopup: function (ll) {
      var m = this._map; if (!this._popup || !m) return this;
      this._popup._source = this;
      this._popup.setLatLng(ll || (this.getLatLng ? this.getLatLng() : this.getCenter ? this.getCenter() : null));
      this._popup._anchorOf = this;
      this._popup.openOn(m);
      return this;
    },
    closePopup: function () { if (this._popup) this._popup.close(); return this; },
    togglePopup: function () { if (this._popup) { if (this._popup._map) this.closePopup(); else this.openPopup(); } return this; },
    isPopupOpen: function () { return !!(this._popup && this._popup.isOpen()); },
    setPopupContent: function (c) { if (this._popup) this._popup.setContent(c); return this; },
    getPopup: function () { return this._popup; },
    _openPopup: function (e) {
      if (!this._popup || !this._map) return;
      if (e && e.originalEvent) e.originalEvent._stopped = true;
      var target = e && (e.layer || e.target) || this;
      if (this._popup._source === target && !(target instanceof Path)) {
        if (this._map.hasLayer(this._popup)) this.closePopup(); else this.openPopup(e && e.latlng && !(target.getLatLng) ? e.latlng : undefined);
        return;
      }
      this._popup._source = target;
      this.openPopup(target instanceof Path && e && e.latlng ? e.latlng : undefined);
    },
    _movePopup: function (e) { if (this._popup && e.latlng) this._popup.setLatLng(e.latlng); },
    _onKeyPress: function (e) { if (e.originalEvent && e.originalEvent.keyCode === 13) this._openPopup(e); },
    /* tooltips: a light "title" + hover chip */
    bindTooltip: function (content, o) { this._tooltip = { c: content, o: o || {} }; this._applyTooltip && this._applyTooltip(); return this; },
    unbindTooltip: function () { this._tooltip = null; return this; }, openTooltip: function () { return this; }, closeTooltip: function () { return this; },
    getTooltip: function () { return this._tooltip || null; }, isTooltipOpen: function () { return false; }
  });
  var LayerGroup = Layer.extend({
    initialize: function (layers, o) { setOptions(this, o); this._layers = {}; if (layers) for (var i = 0; i < layers.length; i++) this.addLayer(layers[i]); },
    addLayer: function (l) { var id = this.getLayerId(l); this._layers[id] = l; if (this._map) this._map.addLayer(l); return this; },
    removeLayer: function (l) { var id = l in this._layers ? l : this.getLayerId(l); if (this._map && this._layers[id]) this._map.removeLayer(this._layers[id]); delete this._layers[id]; return this; },
    hasLayer: function (l) { return !!l && (typeof l === "number" ? l in this._layers : this.getLayerId(l) in this._layers); },
    clearLayers: function () { return this.eachLayer(this.removeLayer, this); },
    invoke: function (fn) { var args = [].slice.call(arguments, 1); for (var k in this._layers) { var l = this._layers[k]; if (l[fn]) l[fn].apply(l, args); } return this; },
    onAdd: function (m) { this.eachLayer(m.addLayer, m); },
    onRemove: function (m) { this.eachLayer(m.removeLayer, m); },
    eachLayer: function (fn, ctx) { var ks = Object.keys(this._layers); for (var i = 0; i < ks.length; i++) { var l = this._layers[ks[i]]; if (l) fn.call(ctx, l); } return this; },
    getLayer: function (id) { return this._layers[id]; },
    getLayers: function () { var a = []; this.eachLayer(a.push, a); return a; },
    setZIndex: function (z) { return this.invoke("setZIndex", z); },
    getLayerId: function (l) { return stamp(l); }
  });
  var FeatureGroup = LayerGroup.extend({
    addLayer: function (l) { if (this.hasLayer(l)) return this; l.addEventParent(this); LayerGroup.prototype.addLayer.call(this, l); return this.fire("layeradd", { layer: l }); },
    removeLayer: function (l) { if (!this.hasLayer(l)) return this; if (l in this._layers) l = this._layers[l]; l.removeEventParent(this); LayerGroup.prototype.removeLayer.call(this, l); return this.fire("layerremove", { layer: l }); },
    setStyle: function (s) { return this.invoke("setStyle", s); }, bringToFront: function () { return this.invoke("bringToFront"); }, bringToBack: function () { return this.invoke("bringToBack"); },
    getBounds: function () { var b = new LatLngBounds(); this.eachLayer(function (l) { b.extend(l.getBounds ? l.getBounds() : l.getLatLng()); }); return b; }
  });

  /* ================= icons ================= */
  var Icon = Class.extend({
    options: { popupAnchor: [0, 0], tooltipAnchor: [0, 0], className: "" },
    initialize: function (o) { setOptions(this, o); },
    createIcon: function (old) {
      var o = this.options, el = old && old.tagName === "IMG" ? old : D.createElement("img");
      el.src = o.iconUrl || ""; this._setIconStyles(el, "icon"); return el;
    },
    createShadow: function () { return null; },
    _setIconStyles: function (el, name) {
      var o = this.options, sz = o[name + "Size"]; if (typeof sz === "number") sz = [sz, sz];
      var size = sz ? point(sz) : null, anchor = point(name === "shadow" && o.shadowAnchor || o.iconAnchor || (size && size.divideBy(2)));
      el.className = "leaflet-marker-" + name + " " + (o.className || "");
      if (anchor) { el.style.marginLeft = (-anchor.x) + "px"; el.style.marginTop = (-anchor.y) + "px"; }
      if (size) { el.style.width = size.x + "px"; el.style.height = size.y + "px"; }
    }
  });
  var DivIcon = Icon.extend({
    options: { iconSize: [12, 12], html: false, bgPos: null, className: "leaflet-div-icon" },
    createIcon: function (old) {
      var div = old && old.tagName === "DIV" ? old : D.createElement("div"), o = this.options;
      if (o.html instanceof Element) { DomUtil.empty(div); div.appendChild(o.html); } else div.innerHTML = o.html !== false ? o.html : "";
      if (o.bgPos) { var p = point(o.bgPos); div.style.backgroundPosition = (-p.x) + "px " + (-p.y) + "px"; }
      this._setIconStyles(div, "icon");
      return div;
    }
  });

  /* ================= Marker (DOM, positioned on GL move) ================= */
  var Marker = Layer.extend({
    options: { icon: new DivIcon({ className: "mbx-default", html: "" }), interactive: true, keyboard: true, title: "", alt: "Marker", zIndexOffset: 0, opacity: 1,
      riseOnHover: false, riseOffset: 250, pane: "markerPane", bubblingMouseEvents: false, draggable: false, autoPan: false },
    initialize: function (ll, o) { setOptions(this, o); this._latlng = latLng(ll); },
    onAdd: function (m) {
      this._initIcon();
      m._domAdd(this);
      this._mounted = false;
      var s = m.getSize(); if (this._wantMount(s, s.x * 0.6 + 80, s.y * 0.6 + 80)) this._mount();
    },
    onRemove: function (m) { m._domRemove(this); },
    getEvents: function () { return null; },
    getLatLng: function () { return this._latlng; },
    setLatLng: function (ll) { var old = this._latlng; this._latlng = latLng(ll); if (this._map && this._mounted) { this._setPos(); this._setZ(); } else if (this._map) this._map._cull(true); return this.fire("move", { oldLatLng: old, latlng: this._latlng }); },
    setZIndexOffset: function (z) { this.options.zIndexOffset = z; if (this._mounted) this._setZ(); return this; },
    getIcon: function () { return this.options.icon; },
    setIcon: function (icon) { this.options.icon = icon; if (this._map) { var was = this._mounted; if (was) this._unmount(); this._initIcon(); if (was) this._mount(); } if (this._popup) this.bindPopup(this._popup, this._popup.options); return this; },
    getElement: function () { return this._icon; },
    update: function () { if (this._mounted) { this._setPos(); this._setZ(); } return this; },
    setOpacity: function (v) { this.options.opacity = v; if (this._icon) this._icon.style.opacity = v; return this; },
    toGeoJSON: function () { return { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [this._latlng.lng, this._latlng.lat] } }; },
    _initIcon: function () {
      var o = this.options, old = this._icon, el = o.icon.createIcon(old);
      DomUtil.addClass(el, "leaflet-zoom-animated");
      if (o.interactive) DomUtil.addClass(el, "leaflet-interactive");
      if (o.keyboard) { el.tabIndex = "0"; el.setAttribute("role", "button"); }
      if (o.title) el.title = o.title;
      if (el.tagName === "IMG") el.alt = o.alt || "";
      if (o.opacity < 1) el.style.opacity = o.opacity;
      if (o.draggable) DomUtil.addClass(el, "leaflet-marker-draggable");
      if (el !== old) { if (old && old.parentNode) old.parentNode.replaceChild(el, old); this._icon = el; this._bindIcon(el); }
      this._icon = el; el._leaflet_id = stamp(this);
      this._applyTooltip();
    },
    _applyTooltip: function () { var t = this._tooltip, el = this._icon; if (!t || !el) return; var c = typeof t.c === "function" ? t.c(this) : t.c; var tmp = D.createElement("div"); tmp.innerHTML = String(c || ""); el.title = tmp.textContent; },
    _bindIcon: function (el) {
      var self = this;
      if (this.options.interactive) {
        ["click", "dblclick", "mousedown", "mouseup", "mouseover", "mouseout", "contextmenu", "keypress"].forEach(function (t) {
          el.addEventListener(t, function (e) {
            if (t === "click" && self._dragMoved) { self._dragMoved = false; return; }
            if (t === "mouseover" && self.options.riseOnHover) { self._rise = self.options.riseOffset; self._setZ(); }
            if (t === "mouseout" && self.options.riseOnHover) { self._rise = 0; self._setZ(); }
            if (t === "click" || t === "dblclick" || t === "contextmenu") e._mbxMk = 1;
            var m = self._map; if (!m) return;
            self.fire(t, { originalEvent: e, latlng: self._latlng, containerPoint: m.latLngToContainerPoint(self._latlng) }, true);
          });
        });
      }
      if (this.options.draggable) this._bindDrag(el);
    },
    _bindDrag: function (el) {
      var self = this, st = null;
      el.addEventListener("pointerdown", function (e) {
        if (!self._map || (self.dragging && !self.dragging._on)) return;
        e.stopPropagation(); e.preventDefault();
        var p0 = self._map.latLngToContainerPoint(self._latlng);
        st = { x: e.clientX, y: e.clientY, p: p0, id: e.pointerId, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch (x) {}
      });
      ["touchstart", "mousedown"].forEach(function (t) { el.addEventListener(t, function (e) { if (self.dragging && !self.dragging._on) return; e.stopPropagation(); }, { passive: true }); });
      el.addEventListener("pointermove", function (e) {
        if (!st || e.pointerId !== st.id) return;
        var dx = e.clientX - st.x, dy = e.clientY - st.y; if (!st.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!st.moved) { st.moved = true; self.fire("dragstart").fire("movestart"); }
        var old = self._latlng; self._latlng = self._map.containerPointToLatLng(st.p.add([dx, dy])); self._setPos();
        self.fire("drag", { latlng: self._latlng, oldLatLng: old }).fire("move", { latlng: self._latlng, oldLatLng: old });
      });
      var end = function (e) { if (!st || e.pointerId !== st.id) return; var mv = st.moved; st = null; if (mv) { self._dragMoved = true; setTimeout(function () { self._dragMoved = false; }, 0); self.fire("moveend").fire("dragend", { distance: 1 }); } };
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
      this.dragging = { _on: true, enable: function () { this._on = true; DomUtil.addClass(el, "leaflet-marker-draggable"); }, disable: function () { this._on = false; DomUtil.removeClass(el, "leaflet-marker-draggable"); }, enabled: function () { return this._on; } };
    },
    _paneName: function () { return this.options.pane; },
    _wantMount: function (s, mx, my) {
      var m = this._map; if (!m || !this._icon) return false;
      if (m._virtual[this._paneName()]) return false;
      if (this._popup && this._popup._map) return true;
      var p = m.latLngToContainerPoint(this._latlng);
      return p.x > -mx && p.x < s.x + mx && p.y > -my && p.y < s.y + my;
    },
    _mount: function () {
      var m = this._map, pane = m && m.getPane(this._paneName()); if (!pane || !this._icon) return;
      pane.appendChild(this._icon); this._mounted = true; this._setPos(); this._setZ();
    },
    _unmount: function () { DomUtil.remove(this._icon); this._mounted = false; },
    _setPos: function () {
      var p = this._map.latLngToContainerPoint(this._latlng), x = Math.round(p.x), y = Math.round(p.y), el = this._icon;
      if (el._mx !== x || el._my !== y) { el._mx = x; el._my = y; el.style.transform = "translate3d(" + x + "px," + y + "px,0)"; }
      el._leaflet_pos = new Point(x, y);
    },
    _setZ: function () { var el = this._icon; if (!el) return; var z = Math.round((el._my || 0) + (this.options.zIndexOffset || 0) + (this._rise || 0)); if (el._mz !== z) { el._mz = z; el.style.zIndex = z; } }
  });

  /* ================= Popup ================= */
  var Popup = Layer.extend({
    options: { pane: "popupPane", offset: [0, 7], minWidth: 50, maxWidth: 300, maxHeight: null, autoPan: true, autoPanPaddingTopLeft: null, autoPanPaddingBottomRight: null,
      autoPanPadding: [5, 5], keepInView: false, closeButton: true, autoClose: true, closeOnEscapeKey: true, closeOnClick: undefined, className: "", interactive: true },
    initialize: function (o, source) {
      if (o instanceof LatLng || Array.isArray(o)) { this._latlng = latLng(o); setOptions(this, source); }
      else { setOptions(this, o); this._source = source; }
      if (this.options.content) this._content = this.options.content;
    },
    openOn: function (m) {
      m = m || (this._source && this._source._map); if (!m) return this;
      if (!m.hasLayer(this) && m._popup && m._popup !== this && m._popup.options.autoClose) m.removeLayer(m._popup);
      m._popup = this;
      if (m.hasLayer(this)) { this.update(); return this; }
      m.addLayer(this);
      return this;
    },
    close: function () { if (this._map) this._map.removeLayer(this); return this; },
    toggle: function (l) { if (this._map) this.close(); else { if (l) this._source = l; this.openOn(l ? l._map : undefined); } return this; },
    isOpen: function () { return !!this._map && this._map.hasLayer(this); },
    getLatLng: function () { return this._latlng; },
    setLatLng: function (ll) { this._latlng = latLng(ll); if (this._map) { this._updatePosition(); this._adjustPan(); } return this; },
    getContent: function () { return this._content; },
    setContent: function (c) { this._content = c; if (this._map) this.update(); return this; },
    getElement: function () { return this._container; },
    bringToFront: function () { if (this._map) DomUtil.toFront(this._container); return this; }, bringToBack: function () { if (this._map) DomUtil.toBack(this._container); return this; },
    getEvents: function () {
      var ev = {}, coc = this.options.closeOnClick;
      if (coc === undefined) coc = this._map && this._map.options.closePopupOnClick;
      if (coc) ev.preclick = this.close;
      return ev;
    },
    onAdd: function (m) {
      if (!this._container) this._initLayout();
      if (this.options.interactive) DomUtil.addClass(this._container, "leaflet-interactive");
      m.getPane(this.options.pane).appendChild(this._container);
      m._domAdd(this); this._mounted = true;
      D.addEventListener("keydown", this._esc);
      this.update();
      m.fire("popupopen", { popup: this });
      if (this._source) { this._source.fire("popupopen", { popup: this }, true); }
      this.bringToFront();
      if (this._source && this._source._map) this._source._map._cull(true);
    },
    onRemove: function (m) {
      if (m._popup === this) m._popup = null;
      m._domRemove(this); this._mounted = false;
      D.removeEventListener("keydown", this._esc);
      DomUtil.remove(this._container);
      m.fire("popupclose", { popup: this });
      if (this._source) this._source.fire("popupclose", { popup: this }, true);
    },
    _wantMount: function () { return !!this._map; },
    _mount: function () { if (this._map && this._container && !this._container.parentNode) this._map.getPane(this.options.pane).appendChild(this._container); this._mounted = true; },
    _unmount: function () { this._mounted = false; },
    _setPos: function () { this._updatePosition(); },
    _initLayout: function () {
      var p = "leaflet-popup", c = this._container = DomUtil.create("div", p + " " + (this.options.className || "") + " leaflet-zoom-animated"), self = this;
      var w = this._wrapper = DomUtil.create("div", p + "-content-wrapper", c);
      this._contentNode = DomUtil.create("div", p + "-content", w);
      DomEvent.disableClickPropagation(c); DomEvent.disableScrollPropagation(c);
      ["touchmove", "mousemove"].forEach(function (t) { c.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
      this._tipContainer = DomUtil.create("div", p + "-tip-container", c);
      this._tip = DomUtil.create("div", p + "-tip", this._tipContainer);
      if (this.options.closeButton) {
        var b = this._closeButton = DomUtil.create("a", p + "-close-button", c);
        b.setAttribute("role", "button"); b.setAttribute("aria-label", "Stäng"); b.href = "#close"; b.innerHTML = '<span aria-hidden="true">&#215;</span>';
        b.addEventListener("click", function (e) { e.preventDefault(); self.close(); });
        c.insertBefore(b, w);
      }
      this._esc = function (e) { if (e.key === "Escape" && self._map && self.options.closeOnEscapeKey) self.close(); };
    },
    update: function () {
      if (!this._map) return;
      this._container.style.visibility = "hidden";
      this._updateContent(); this._updateLayout(); this._updatePosition();
      this._container.style.visibility = "";
      this._adjustPan();
    },
    _updateContent: function () {
      if (!this._content) return;
      var n = this._contentNode, c = typeof this._content === "function" ? this._content(this._source || this) : this._content;
      if (typeof c === "string") n.innerHTML = c; else { DomUtil.empty(n); if (c) n.appendChild(c); }
      this.fire("contentupdate");
    },
    _updateLayout: function () {
      var c = this._contentNode, s = c.style;
      s.width = ""; s.whiteSpace = "nowrap";
      var w = c.offsetWidth; w = Math.min(w, this.options.maxWidth); w = Math.max(w, this.options.minWidth);
      s.width = (w + 1) + "px"; s.whiteSpace = ""; s.height = "";
      var h = c.offsetHeight, mh = this.options.maxHeight;
      if (mh && h > mh) { s.height = mh + "px"; DomUtil.addClass(c, "leaflet-popup-scrolled"); } else DomUtil.removeClass(c, "leaflet-popup-scrolled");
      this._containerWidth = this._container.offsetWidth;
    },
    _anchor: function () {
      var s = this._source, ic = s && s.options && s.options.icon && s.getLatLng && s._latlng && this._latlng && s._latlng.equals(this._latlng) ? s.options.icon : null;
      return point(ic && ic.options.popupAnchor ? ic.options.popupAnchor : [0, 0]);
    },
    _updatePosition: function () {
      if (!this._map || !this._latlng || !this._container) return;
      var p = this._map.latLngToContainerPoint(this._latlng).add(this._anchor()), off = point(this.options.offset);
      var bottom = this._containerBottom = -off.y, left = this._containerLeft = -Math.round((this._containerWidth || 0) / 2) + off.x, c = this._container;
      c.style.bottom = bottom + "px"; c.style.left = left + "px";
      c.style.transform = "translate3d(" + Math.round(p.x) + "px," + Math.round(p.y) + "px,0)"; c._leaflet_pos = p.round();
    },
    _adjustPan: function () {
      if (!this.options.autoPan || !this._map || !this._container || this._container.parentNode !== this._map.getPane(this.options.pane)) return;
      var m = this._map, h = this._container.offsetHeight, w = this._containerWidth, pos = this._container._leaflet_pos || new Point(0, 0);
      var cp = new Point(this._containerLeft + pos.x, -h - this._containerBottom + pos.y);
      var pad = point(this.options.autoPanPadding), tl = point(this.options.autoPanPaddingTopLeft || pad), br = point(this.options.autoPanPaddingBottomRight || pad), s = m.getSize(), dx = 0, dy = 0;
      if (cp.x + w + br.x > s.x) dx = cp.x + w - s.x + br.x;
      if (cp.x - dx - tl.x < 0) dx = cp.x - tl.x;
      if (cp.y + h + br.y > s.y) dy = cp.y + h - s.y + br.y;
      if (cp.y - dy - tl.y < 0) dy = cp.y - tl.y;
      if (dx || dy) { m.fire("autopanstart"); m.panBy([dx, dy]); }
    }
  });
  var Tooltip = Popup.extend({ options: { pane: "tooltipPane", direction: "top", permanent: false, closeButton: false } });

  /* ================= vector layers ================= */
  var CLASS_STYLE = { "me-acc": { fillColor: "#4aa3ff", fillOpacity: 0.12 } };
  var Path = Layer.extend({
    options: { stroke: true, color: "#3388ff", weight: 3, opacity: 1, lineCap: "round", lineJoin: "round", dashArray: null, fill: false, fillColor: null,
      fillOpacity: 0.2, fillRule: "evenodd", interactive: true, bubblingMouseEvents: true, pane: "overlayPane" },
    onAdd: function (m) { m._shapes.add(this); },
    onRemove: function (m) { m._shapes.remove(this); },
    setStyle: function (s) { setOptions(this, s); this._changed(); return this; },
    redraw: function () { this._changed(); return this; },
    bringToFront: function () { if (this._map) this._map._shapes.front(this, true); return this; },
    bringToBack: function () { if (this._map) this._map._shapes.front(this, false); return this; },
    getElement: function () { return null; },
    _changed: function () { if (this._map) this._map._shapes.change(this); },
    _style: function () {
      var o = this.options, cs = {};
      String(o.className || "").split(/\s+/).forEach(function (c) { if (CLASS_STYLE[c]) extend(cs, CLASS_STYLE[c]); });
      var fc = cs.fillColor || o.fillColor || o.color, fo = cs.fillOpacity != null ? cs.fillOpacity : o.fillOpacity;
      return { stroke: o.stroke !== false && o.weight > 0, color: o.color, weight: +o.weight || 0, opacity: o.opacity == null ? 1 : +o.opacity,
        fill: !!o.fill, fillColor: fc, fillOpacity: fo == null ? 0.2 : +fo, dash: o.dashArray ? String(o.dashArray).split(/[\s,]+/).map(Number).filter(function (x) { return x >= 0; }) : null };
    }
  });
  function normLL(a) { // → array of arrays of LatLng (rings / lines)
    if (!a || !a.length) return [];
    if (latLng(a[0]) && !(Array.isArray(a[0]) && Array.isArray(a[0][0]))) return [a.map(function (x) { return latLng(x); })];
    var out = []; a.forEach(function (x) { out = out.concat(normLL(x)); }); return out;
  }
  var Polyline = Path.extend({
    options: { smoothFactor: 1, noClip: false },
    initialize: function (lls, o) { setOptions(this, o); this._setLatLngs(lls); },
    _setLatLngs: function (lls) { this._latlngs = lls || []; this._rings = normLL(this._latlngs); },
    getLatLngs: function () { return this._latlngs; },
    setLatLngs: function (lls) { this._setLatLngs(lls); this._changed(); return this.fire("move"); },
    addLatLng: function (ll) { if (!this._rings.length) this._latlngs = [], this._rings = [[]]; var r = this._rings[this._rings.length - 1]; r.push(latLng(ll)); if (Array.isArray(this._latlngs) && (this._latlngs === r || !Array.isArray(this._latlngs[0]))) { if (this._latlngs !== r) this._latlngs.push(latLng(ll)); } this._changed(); return this; },
    isEmpty: function () { return !this._rings.some(function (r) { return r.length; }); },
    getBounds: function () { var b = new LatLngBounds(); this._rings.forEach(function (r) { r.forEach(function (x) { b.extend(x); }); }); return b; },
    getCenter: function () { return this.getBounds().getCenter(); },
    _geom: function () {
      var rs = this._rings.filter(function (r) { return r.length >= 2; }).map(function (r) { return r.map(function (x) { return [x.lng, x.lat]; }); });
      if (!rs.length) return null;
      return rs.length === 1 ? { type: "LineString", coordinates: rs[0] } : { type: "MultiLineString", coordinates: rs };
    }
  });
  var Polygon = Polyline.extend({
    options: { fill: true },
    _geom: function () {
      // Leaflet: [ring] | [outer, hole…] | [[outer, hole…], …]. Rings close themselves.
      var a = this._latlngs, polys = [];
      var ring = function (r) { var c = r.map(function (x) { x = latLng(x); return [x.lng, x.lat]; }); if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push(c[0]); return c; };
      if (!a || !a.length) return null;
      if (latLng(a[0]) && !Array.isArray(a[0][0])) polys = [[ring(a)]];
      else if (a[0] && latLng(a[0][0]) && !Array.isArray(a[0][0][0])) polys = [a.map(ring)];
      else polys = a.map(function (p) { return p.map(ring); });
      polys = polys.map(function (p) { return p.filter(function (r) { return r.length >= 4; }); }).filter(function (p) { return p.length; });
      if (!polys.length) return null;
      return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
    }
  });
  var Rectangle = Polygon.extend({ initialize: function (b, o) { b = latLngBounds(b); Polygon.prototype.initialize.call(this, [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()], o); } });
  var CircleMarker = Path.extend({
    options: { fill: true, radius: 10 },
    initialize: function (ll, o) { setOptions(this, o); this._latlng = latLng(ll); this._radius = this.options.radius; },
    setLatLng: function (ll) { var old = this._latlng; this._latlng = latLng(ll); this._changed(); return this.fire("move", { oldLatLng: old, latlng: this._latlng }); },
    getLatLng: function () { return this._latlng; },
    setRadius: function (r) { this.options.radius = this._radius = r; this._changed(); return this; }, getRadius: function () { return this._radius; },
    getBounds: function () { return new LatLngBounds(this._latlng, this._latlng); },
    _geom: function () { return { type: "Point", coordinates: [this._latlng.lng, this._latlng.lat] }; },
    _pt: true
  });
  var Circle = CircleMarker.extend({
    initialize: function (ll, o, legacy) { if (typeof o === "number") o = extend({}, legacy, { radius: o }); setOptions(this, o); this._latlng = latLng(ll); this._mRadius = this.options.radius; },
    setRadius: function (r) { this._mRadius = r; this._changed(); return this; }, getRadius: function () { return this._mRadius; },
    getBounds: function () { var d = this._mRadius / 111320, dl = d / Math.max(0.01, Math.cos(this._latlng.lat * Math.PI / 180)); return latLngBounds([this._latlng.lat - d, this._latlng.lng - dl], [this._latlng.lat + d, this._latlng.lng + dl]); },
    _geom: function () {
      var c = this._latlng, r = this._mRadius || 0, n = 64, pts = [], dLat = r / 111320, dLng = dLat / Math.max(0.01, Math.cos(c.lat * Math.PI / 180));
      for (var i = 0; i <= n; i++) { var a = i / n * 2 * Math.PI; pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]); }
      return { type: "Polygon", coordinates: [pts] };
    },
    _pt: false
  });

  /* shapes: GL (one GeoJSON source + fill / line / circle layers per pane) or SVG (raster engine) */
  function Shapes(m) { this.m = m; this.byPane = {}; this.all = {}; this.dirty = {}; this.ready = false; this.t = 0; }
  Shapes.prototype = {
    add: function (s) { var p = s.options.pane || "overlayPane"; s._spane = p; (this.byPane[p] = this.byPane[p] || {})[stamp(s)] = s; this.all[stamp(s)] = s; this.change(s); },
    remove: function (s) { var p = s._spane; if (this.byPane[p]) delete this.byPane[p][stamp(s)]; delete this.all[stamp(s)]; this.mark(p); },
    change: function (s) { this.mark(s._spane || s.options.pane || "overlayPane"); },
    front: function (s, top) { var p = s._spane, o = this.byPane[p]; if (!o) return; delete o[stamp(s)]; var n = {}; if (!top) n[stamp(s)] = s; for (var k in o) n[k] = o[k]; if (top) n[stamp(s)] = s; this.byPane[p] = n; this.mark(p); },
    mark: function (p) { this.dirty[p] = 1; var self = this; if (!this.t) this.t = raf(function () { self.t = 0; self.flush(); }); },
    engineChanged: function () { this.ready = false; this.layers = {}; for (var p in this.byPane) this.dirty[p] = 1; this.flush(); },
    styleLoaded: function () { this.sig = {}; this.ready = !!(this.m._gl && this.m._gl.isStyleLoaded && this.m._gl.isStyleLoaded()) || !!(this.m._gl && this.m._gl.style && this.m._gl.style._loaded); this.layers = {}; for (var p in this.byPane) this.dirty[p] = 1; this.flush(); },
    flush: function () {
      var m = this.m;
      for (var p in this.dirty) { delete this.dirty[p]; if (m._gl) this.glPane(p); else this.svgPane(p); }
    },
    paneZ: function (p) { var el = this.m.getPane(p), z = el ? +(el.style.zIndex || DEF_PANES[p] || 400) : 400; return z; },
    feats: function (p) {
      var o = this.byPane[p] || {}, out = [], i = 0;
      for (var k in o) {
        var s = o[k], g = s._geom(); if (!g) continue;
        var st = s._style(), pr = { id: +k, ord: i++, it: s.options.interactive !== false ? 1 : 0 };
        if (s._pt && s instanceof CircleMarker) { pr.pt = 1; pr.r = +s._radius || 0; pr.fc = st.fillColor; pr.fo = st.fill ? st.fillOpacity : 0; pr.lc = st.color; pr.lw = st.stroke ? st.weight : 0; pr.lo = st.stroke ? st.opacity : 0; }
        else { pr.fc = st.fillColor; pr.fo = st.fill ? st.fillOpacity : 0; pr.lc = st.color; pr.lw = st.stroke ? st.weight : 0; pr.lo = st.stroke ? st.opacity : 0;
          pr.ld = this.dashIx(st.dash && st.dash.length >= 2 ? st.dash.map(function (x) { return +Math.max(0.05, x / Math.max(1, st.weight)).toFixed(2); }) : null); pr.fl = st.fill ? 1 : 0; }
        if (s.options.lineCap === "butt") pr.bt = 1;
        out.push({ type: "Feature", id: +k, geometry: g, properties: pr });
      }
      return out;
    },
    // GeoJSON properties cannot carry arrays into GL tiles: a dash pattern is an index into a table read by a "match"
    dashIx: function (d) {
      if (!d) return 0;
      var k = d.join(","), t = this.dash || (this.dash = { list: [[1, 0]], ix: { "1,0": 0 } });
      if (t.ix[k] == null) { t.ix[k] = t.list.length; t.list.push(d); this.dashDirty = true; }
      return t.ix[k];
    },
    dashExpr: function () {
      var t = this.dash || { list: [[1, 0]] }; if (t.list.length < 2) return ["literal", [1, 0]];
      var e = ["match", ["get", "ld"]]; t.list.forEach(function (d, i) { if (i) e.push(i, ["literal", d]); }); e.push(["literal", [1, 0]]); return e;
    },
    ids: function (p) { var b = "mbx-" + p.replace(/[^\w-]/g, ""); return { src: b, fill: b + "-fill", line: b + "-line", pt: b + "-pt" }; },
    glPane: function (p) {
      var gl = this.m._gl; if (!gl || !this.ready) return;
      var id = this.ids(p), data = { type: "FeatureCollection", features: this.feats(p) };
      try {
        if (this.dashDirty) { this.dashDirty = false; var de = this.dashExpr(), ls0 = this.layers || {}; for (var q in ls0) if (gl.getLayer(ls0[q].line)) gl.setPaintProperty(ls0[q].line, "line-dasharray", de); }
        var src = gl.getSource(id.src);
        if (!src) {
          if (!data.features.length) return;
          gl.addSource(id.src, { type: "geojson", data: data, tolerance: 0.2, buffer: 32 }); (this.sig = this.sig || {})[p] = JSON.stringify(data.features);
          var before = this.beforeId(p);
          gl.addLayer({ id: id.fill, type: "fill", source: id.src, filter: ["all", ["==", ["get", "fl"], 1], ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]]],
            paint: { "fill-color": ["get", "fc"], "fill-opacity": ["get", "fo"], "fill-emissive-strength": 1, "fill-antialias": true } }, before);
          gl.addLayer({ id: id.line, type: "line", source: id.src, filter: ["all", [">", ["get", "lw"], 0], ["!=", ["get", "pt"], 1]], layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["get", "lc"], "line-width": ["get", "lw"], "line-opacity": ["get", "lo"], "line-dasharray": this.dashExpr(), "line-emissive-strength": 1 } }, before);
          gl.addLayer({ id: id.pt, type: "circle", source: id.src, filter: ["==", ["get", "pt"], 1],
            paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "fc"], "circle-opacity": ["get", "fo"], "circle-stroke-color": ["get", "lc"], "circle-stroke-width": ["get", "lw"],
              "circle-stroke-opacity": ["get", "lo"], "circle-pitch-alignment": "map", "circle-emissive-strength": 1 } }, before);
          (this.layers = this.layers || {})[p] = id;
        } else {
          // only when something really changed (a setData re-tiles the source and keeps the map from going idle)
          var sig = JSON.stringify(data.features); if (sig === (this.sig || {})[p]) return;
          (this.sig = this.sig || {})[p] = sig; src.setData(data);
        }
        stats.shapeSets++;
      } catch (e) { try { console.warn("olnu mbx shapes", e && e.message); } catch (x) {} }
    },
    beforeId: function (p) {
      // under every GL layer of our own (bars, heat, zones: "olnu-…") and under a shape pane with a higher z
      var gl = this.m._gl, z = this.paneZ(p), best = null, bz = 1e9, ls = [];
      try { ls = gl.getStyle().layers || []; } catch (e) {}
      for (var q in (this.layers || {})) { var qz = this.paneZ(q); if (q !== p && qz > z && qz < bz && gl.getLayer(this.layers[q].fill)) { bz = qz; best = this.layers[q].fill; } }
      if (best) return best;
      for (var i = 0; i < ls.length; i++) if (/^olnu-/.test(ls[i].id)) return ls[i].id;
      return undefined;
    },
    // a tap on the GL map: the top interactive shape under it gets "click"
    click: function (ev) {
      var gl = this.m._gl, oe = ev.originalEvent, hit = null;
      if (gl && this.ready) {
        var lids = [], self = this; Object.keys(this.layers || {}).forEach(function (p) { var id = self.layers[p]; [id.pt, id.line, id.fill].forEach(function (l) { if (gl.getLayer(l)) lids.push(l); }); });
        if (!lids.length) return false;
        var pt = ev.containerPoint, fs = [];
        try { fs = gl.queryRenderedFeatures([[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]], { layers: lids, filter: ["==", ["get", "it"], 1] }); } catch (e) { fs = []; }
        for (var i = 0; i < fs.length && !hit; i++) { var s = this.all[fs[i].properties.id]; if (s && s.listens("click")) hit = s; }
      } else if (oe && oe.target && oe.target._mbxShape) hit = oe.target._mbxShape;
      if (!hit) return false;
      hit.fire("click", ev, true);
      return hit.options.bubblingMouseEvents === false || !!(oe && oe._stopped);
    },
    move: function () { if (!this.m._gl && this.svg) this.svgAll(); },
    moveEnd: function () {},
    svgPane: function () { this.svgAll(); },
    svgAll: function () {
      var m = this.m, NS = "http://www.w3.org/2000/svg", self = this;
      if (!this.svg) { this.svg = {}; }
      for (var p in this.byPane) {
        var pane = m.getPane(p) || m.getPane("overlayPane"), sv = this.svg[p];
        if (!sv) { sv = this.svg[p] = D.createElementNS(NS, "svg"); sv.setAttribute("class", "mbx-svg"); sv.setAttribute("width", "1"); sv.setAttribute("height", "1"); pane.appendChild(sv); }
        while (sv.firstChild) sv.removeChild(sv.firstChild);
        var o = this.byPane[p];
        for (var k in o) {
          var s = o[k], st = s._style(), el;
          if (s instanceof CircleMarker && s._pt) { var c = m.latLngToContainerPoint(s._latlng); el = D.createElementNS(NS, "circle"); el.setAttribute("cx", c.x); el.setAttribute("cy", c.y); el.setAttribute("r", s._radius); }
          else {
            var g = s._geom(); if (!g) continue;
            var rings = g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? [].concat.apply([], g.coordinates) : g.type === "LineString" ? [g.coordinates] : g.coordinates;
            var d = rings.map(function (r) { return r.map(function (q, i) { var pp = m.latLngToContainerPoint([q[1], q[0]]); return (i ? "L" : "M") + pp.x.toFixed(1) + " " + pp.y.toFixed(1); }).join("") + (/Polygon/.test(g.type) ? "Z" : ""); }).join("");
            el = D.createElementNS(NS, "path"); el.setAttribute("d", d); el.setAttribute("fill-rule", "evenodd");
          }
          el.setAttribute("fill", st.fill ? st.fillColor : "none"); el.setAttribute("fill-opacity", st.fillOpacity);
          el.setAttribute("stroke", st.stroke ? st.color : "none"); el.setAttribute("stroke-width", st.weight); el.setAttribute("stroke-opacity", st.opacity);
          el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
          if (st.dash) el.setAttribute("stroke-dasharray", st.dash.join(" "));
          if (s.options.interactive !== false && s.listens("click")) { el.setAttribute("class", "leaflet-interactive"); el._mbxShape = s; }
          sv.appendChild(el);
        }
      }
    }
  };

  /* ================= TileLayer (raster engine only; on GL js/basemap.js uses them as the fallback style) ================= */
  var TileLayer = Layer.extend({
    options: { minZoom: 0, maxZoom: 18, subdomains: "abc", opacity: 1, attribution: null, tileSize: 256, maxNativeZoom: null, pane: "tilePane" },
    initialize: function (url, o) { this._url = url; setOptions(this, o); if (typeof this.options.subdomains === "string") this.options.subdomains = this.options.subdomains.split(""); },
    onAdd: function (m) { if (!m._gl || m._rasterOn) m._drawTiles(); },
    onRemove: function (m) { var self = this; setTimeout(function () { if (!m._gl || m._rasterOn) { DomUtil.empty(m._raster); m._tiles = {}; m._drawTiles(); } }, 0); },
    setUrl: function (u) { this._url = u; return this; },
    redraw: function () { return this; },
    getTileUrl: function (c) {
      var sd = this.options.subdomains || ["a"], s = sd[Math.abs(c.x + c.y) % sd.length];
      return this._url.replace(/\{s\}/g, s).replace(/\{z\}/g, c.z).replace(/\{x\}/g, c.x).replace(/\{y\}/g, c.y).replace(/\{r\}/g, (W.devicePixelRatio || 1) > 1 ? "@2x" : "");
    },
    glTiles: function () { var sd = this.options.subdomains || ["a"], self = this; return (/\{s\}/.test(this._url) ? sd : ["a"]).map(function (s) { return self._url.replace(/\{s\}/g, s).replace(/\{r\}/g, ""); }); },
    setZIndex: function () { return this; }, bringToFront: function () { return this; }, bringToBack: function () { return this; }
  });

  /* ================= MarkerClusterGroup (screen-space greedy, no animation, no spiderfy) ================= */
  var ClusterMarker = Marker.extend({
    initialize: function (group, kids, ll) { setOptions(this, { pane: group.options.clusterPane || "markerPane", keyboard: false }); this._group = group; this._kids = kids; this._latlng = ll; this.options.icon = group.options.iconCreateFunction(this); },
    getAllChildMarkers: function () { return this._kids.slice(); },
    getChildCount: function () { return this._kids.length; },
    getBounds: function () { var b = new LatLngBounds(); this._kids.forEach(function (k) { b.extend(k.getLatLng()); }); return b; },
    zoomToBounds: function (o) { var m = this._group._map; if (!m) return; var b = this.getBounds(); if (!b.isValid()) return; var z = m.getBoundsZoom(b, false, point((o && o.padding) || [40, 40]).multiplyBy(2));
      if (z <= m.getZoom()) z = m.getZoom() + 1; m.flyTo(b.getCenter(), Math.min(m.getMaxZoom(), z), { duration: 0.6 }); },
    spiderfy: function () {}, unspiderfy: function () {}
  });
  var MarkerClusterGroup = FeatureGroup.extend({
    options: { maxClusterRadius: 80, iconCreateFunction: null, spiderfyOnMaxZoom: false, showCoverageOnHover: false, zoomToBoundsOnClick: true, disableClusteringAtZoom: null },
    initialize: function (o) {
      setOptions(this, o);
      if (!this.options.iconCreateFunction) this.options.iconCreateFunction = function (c) { return new DivIcon({ html: "<div><span>" + c.getChildCount() + "</span></div>", className: "marker-cluster", iconSize: [40, 40] }); };
      this._layers = {}; this._kids = {}; this._shown = {}; this._clusters = {}; this._parent = {}; this._z = null; this._t = 0;
    },
    addLayer: function (l) { var id = stamp(l); if (this._kids[id]) return this; this._kids[id] = l; this._layers[id] = l; l._mcg = this; this._soon(); return this; },
    addLayers: function (ls) { for (var i = 0; i < ls.length; i++) { var id = stamp(ls[i]); this._kids[id] = ls[i]; this._layers[id] = ls[i]; ls[i]._mcg = this; } this._run(true); return this; },
    removeLayer: function (l) { var id = stamp(l); if (!this._kids[id]) return this; delete this._kids[id]; delete this._layers[id]; if (this._shown[id] && this._map) this._map.removeLayer(l); delete this._shown[id]; this._soon(); return this; },
    removeLayers: function (ls) { var self = this; ls.forEach(function (l) { self.removeLayer(l); }); return this; },
    clearLayers: function () { var m = this._map, self = this; Object.keys(this._shown).forEach(function (id) { if (m) m.removeLayer(self._kids[id] || self._shown[id]); }); Object.keys(this._clusters).forEach(function (k) { if (m) m.removeLayer(self._clusters[k]); });
      this._kids = {}; this._layers = {}; this._shown = {}; this._clusters = {}; this._parent = {}; return this; },
    hasLayer: function (l) { return !!l && !!this._kids[stamp(l)]; },
    eachLayer: function (fn, ctx) { var ks = Object.keys(this._kids); for (var i = 0; i < ks.length; i++) fn.call(ctx, this._kids[ks[i]]); return this; },
    getLayers: function () { var a = []; this.eachLayer(a.push, a); return a; },
    getVisibleParent: function (m) { var id = stamp(m); if (this._shown[id]) return m; return this._parent[id] || null; },
    refreshClusters: function () { this._run(true); return this; },
    zoomToShowLayer: function (m, cb) { var map = this._map; if (!map) return; map.setView(m.getLatLng(), Math.max(map.getZoom(), 17)); if (cb) setTimeout(cb, 0); },
    onAdd: function (m) { this._map = m; m.on("zoomend", this._onZoom, this); m.on("moveend", this._onMoveEnd, this); this._run(true); },
    onRemove: function (m) { m.off("zoomend", this._onZoom, this); m.off("moveend", this._onMoveEnd, this); var self = this;
      Object.keys(this._shown).forEach(function (id) { m.removeLayer(self._kids[id]); }); Object.keys(this._clusters).forEach(function (k) { m.removeLayer(self._clusters[k]); }); this._shown = {}; this._clusters = {}; this._parent = {}; this._map = null; },
    _onZoom: function () { if (this._map && Math.abs(this._map.getZoom() - this._z) >= 0.2) this._run(false); },
    _onMoveEnd: function () { if (this._map && (this._z == null || Math.abs(this._map.getZoom() - this._z) >= 0.2)) this._run(false); },
    _soon: function () { var self = this; if (!this._t) this._t = setTimeout(function () { self._t = 0; self._run(true); }, 0); },
    _run: function (force) {
      var m = this._map; if (!m) return;
      var t0 = performance.now(), z = m.getZoom(), o = this.options, R = typeof o.maxClusterRadius === "function" ? o.maxClusterRadius(z) : o.maxClusterRadius;
      this._z = z;
      var kids = this.eachLayer ? this.getLayers() : [], cells = {}, groups = [], cs = Math.max(1, R);
      var noCl = o.disableClusteringAtZoom != null && z >= o.disableClusteringAtZoom;
      // friends / me first, so a group's anchor is the most interesting pin
      kids.sort(function (a, b) { return ((b.options.mine ? 2 : 0) + (b.options.friend ? 1 : 0)) - ((a.options.mine ? 2 : 0) + (a.options.friend ? 1 : 0)) || stamp(a) - stamp(b); });
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i], ll = k.getLatLng(), x = wx(ll.lng, z), y = wy(ll.lat, z), cx = Math.floor(x / cs), cy = Math.floor(y / cs), best = null, bd = R * R;
        if (!noCl) for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          var cell = cells[(cx + dx) + "_" + (cy + dy)]; if (!cell) continue;
          for (var j = 0; j < cell.length; j++) { var g = cell[j], d = (g.x - x) * (g.x - x) + (g.y - y) * (g.y - y); if (d <= bd) { bd = d; best = g; } }
        }
        if (best) { best.kids.push(k); best.sx += x; best.sy += y; }
        else { var ng = { x: x, y: y, sx: x, sy: y, kids: [k] }; groups.push(ng); (cells[cx + "_" + cy] = cells[cx + "_" + cy] || []).push(ng); }
      }
      var shown = {}, clusters = {}, parent = {}, self = this;
      groups.forEach(function (g) {
        if (g.kids.length === 1) { shown[stamp(g.kids[0])] = g.kids[0]; return; }
        var key = g.kids.map(function (k) { return stamp(k); }).sort(function (a, b) { return a - b; }).join(",");
        var n = g.kids.length, ll = new LatLng(uy(g.sy / n, z), ux(g.sx / n, z)), cm = !force && self._clusters[key];
        if (cm) { cm.setLatLng(ll); delete self._clusters[key]; }
        else { cm = new ClusterMarker(self, g.kids, ll); cm.on("click", function (e) { self.fire("clusterclick", extend({}, e, { layer: cm })); }); }
        clusters[key] = cm; g.kids.forEach(function (k) { parent[stamp(k)] = cm; });
      });
      Object.keys(this._clusters).forEach(function (k) { m.removeLayer(self._clusters[k]); });
      Object.keys(this._shown).forEach(function (id) { if (!shown[id] && self._kids[id]) m.removeLayer(self._kids[id]); else if (!shown[id] && self._shown[id]) m.removeLayer(self._shown[id]); });
      Object.keys(shown).forEach(function (id) { if (!m.hasLayer(shown[id])) m.addLayer(shown[id]); });
      Object.keys(clusters).forEach(function (k) { if (!m.hasLayer(clusters[k])) m.addLayer(clusters[k]); });
      this._shown = shown; this._clusters = clusters; this._parent = parent;
      var ms = performance.now() - t0; stats.clusterRuns++; stats.clusterMs += ms; stats.lastCluster = { n: kids.length, groups: groups.length, ms: +ms.toFixed(2) };
    }
  });

  /* ================= heat (GL heat in glmap.js; this keeps app.js's heat button and calls working) ================= */
  var HeatLayer = Layer.extend({
    initialize: function (lls, o) { this._latlngs = lls || []; setOptions(this, o); },
    setLatLngs: function (l) { this._latlngs = l || []; return this; }, addLatLng: function (l) { this._latlngs.push(l); return this; },
    setOptions: function (o) { setOptions(this, o); return this; }, redraw: function () { return this; }, _redraw: function () {}
  });

  /* ================= MBX extras ================= */
  // Bars + restaurants / cafés / fast food near a spot, nearest first, from the data the map already loads (bars.json + the
  // docs/places/ tiles). Waits up to ~2.5 s for the place tiles around the spot. → Promise [{ bar, d, place }]
  MBX.nearbyPlaces = function (lat, lng, o) {
    o = o || {}; var B = W.BARS, maxM = o.maxM || 1500, max = o.max || 30;
    if (!B || !B.nearby) return Promise.resolve([]);
    // bars.js nf (2026-11-07): around() sees any radius, ensurePlacesP() waits for the place tiles of THIS spot
    if (B.around && B.ensurePlacesP) return B.ensurePlacesP(lat, lng, Math.max(1, maxM / 1000), o.waitMs || 2500).then(function () {
      var a = B.around(lat, lng, maxM) || { bars: [], places: [] }, pl = o.places === false ? [] : a.places.slice(0, o.maxPlaces != null ? o.maxPlaces : max);
      return a.bars.slice(0, max).concat(pl);
    });
    try { if (B.ensurePlaces) B.ensurePlaces(lat, lng); } catch (e) {}
    var ask = function () {
      try { return B.nearby(lat, lng, maxM, max, { places: o.places !== false, placeM: maxM, maxPlaces: o.maxPlaces != null ? o.maxPlaces : max }) || []; } catch (e) { return []; }
    };
    var first = ask();
    if (o.places === false || first.some(function (x) { return x.place; })) return Promise.resolve(first);
    return new Promise(function (res) {
      var done = false, fin = function () { if (done) return; done = true; res(ask()); };
      try { if (B.onPlacesReady) B.onPlacesReady(function () { setTimeout(fin, 50); }); } catch (e) {}
      setTimeout(fin, o.waitMs || 2500);
    });
  };
  // perf: DOM nodes in the map / marker counts (tests, vitals)
  MBX.domStats = function () { var m = MBX.main, c = m && m.getContainer(); return { all: D.getElementsByTagName("*").length, map: c ? c.getElementsByTagName("*").length : 0, mounted: stats.mounted, markers: stats.markers }; };

  /* ================= L ================= */
  var Lns = {
    version: "mbx-1", noConflict: function () { return Lns; },
    Class: Class, Evented: Evented, Mixin: { Events: Events }, Util: Util, extend: extend, bind: Util.bind, stamp: stamp, setOptions: setOptions,
    Point: Point, point: point, Bounds: Bounds, bounds: function (a, b) { return new Bounds(a, b); }, LatLng: LatLng, latLng: latLng, LatLngBounds: LatLngBounds, latLngBounds: latLngBounds,
    DomUtil: DomUtil, DomEvent: DomEvent,
    Map: MapC, map: map,
    Layer: Layer, LayerGroup: LayerGroup, layerGroup: function (l, o) { return new LayerGroup(l, o); }, FeatureGroup: FeatureGroup, featureGroup: function (l, o) { return new FeatureGroup(l, o); },
    Icon: Icon, icon: function (o) { return new Icon(o); }, DivIcon: DivIcon, divIcon: function (o) { return new DivIcon(o); },
    Marker: Marker, marker: function (ll, o) { return new Marker(ll, o); },
    Popup: Popup, popup: function (o, s) { return new Popup(o, s); }, Tooltip: Tooltip, tooltip: function (o, s) { return new Tooltip(o, s); },
    Path: Path, Polyline: Polyline, polyline: function (l, o) { return new Polyline(l, o); }, Polygon: Polygon, polygon: function (l, o) { return new Polygon(l, o); },
    Rectangle: Rectangle, rectangle: function (b, o) { return new Rectangle(b, o); },
    CircleMarker: CircleMarker, circleMarker: function (ll, o) { return new CircleMarker(ll, o); }, Circle: Circle, circle: function (ll, o, x) { return new Circle(ll, o, x); },
    TileLayer: TileLayer, tileLayer: function (u, o) { return new TileLayer(u, o); },
    MarkerClusterGroup: MarkerClusterGroup, markerClusterGroup: function (o) { return new MarkerClusterGroup(o); },
    heatLayer: function (l, o) { return new HeatLayer(l, o); },
    svg: function (o) { return { options: o || {}, _mbx: "svg" }; }, canvas: function (o) { return { options: o || {}, _mbx: "canvas" }; },
    Browser: { mobile: /Mobi|Android/i.test(navigator.userAgent || ""), touch: true, retina: (W.devicePixelRatio || 1) > 1, pointer: !!W.PointerEvent }
  };
  MBX.L = Lns;
  W.L = Lns;   // (assignment, not defineProperty: test harnesses hook the setter)
})();
