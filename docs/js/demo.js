/* Demo backend: same RPC names and shapes as the contract, all local. */
(function () {
  "use strict";
  var U = window.U;
  var KEY = "olnu.demo";

  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  var CITIES = [
    { n: "Stockholm", lat: 59.3326, lng: 18.0649, c: 40, s: 0.03 },
    { n: "Göteborg", lat: 57.7072, lng: 11.9668, c: 24, s: 0.025 },
    { n: "Malmö", lat: 55.6050, lng: 13.0038, c: 18, s: 0.02 },
    { n: "Uppsala", lat: 59.8586, lng: 17.6389, c: 14, s: 0.015 },
    { n: "Ludvika", lat: 60.1496, lng: 15.1878, c: 10, s: 0.01 },
    { n: "Umeå", lat: 63.8258, lng: 20.2630, c: 12, s: 0.015 }
  ];
  // Fake but real-looking bar spots. Beers placed close to these get counted.
  var BARS = [
    { id: "demo/1", name: "Kvarnen", lat: 59.31555, lng: 18.07144, type: "pub", n: 9 },
    { id: "demo/2", name: "Mälarpaviljongen", lat: 59.32860, lng: 18.04210, type: "biergarten", n: 6 },
    { id: "demo/3", name: "Akkurat", lat: 59.31977, lng: 18.06890, type: "bar", n: 5 },
    { id: "demo/4", name: "Stureplan Klubb", lat: 59.33570, lng: 18.07390, type: "nightclub", n: 7 },
    { id: "demo/5", name: "Ölstugan Tullen", lat: 57.69780, lng: 11.95510, type: "pub", n: 6 },
    { id: "demo/6", name: "Brewers Beer Bar", lat: 57.70420, lng: 11.96070, type: "bar", n: 4 },
    { id: "demo/7", name: "Malmö Brygghus", lat: 55.59920, lng: 13.00990, type: "pub", n: 5 },
    { id: "demo/8", name: "Nationsfiket", lat: 59.85750, lng: 17.63220, type: "bar", n: 4 },
    { id: "demo/9", name: "Bishops Arms Ludvika", lat: 60.14960, lng: 15.18660, type: "pub", n: 4 },
    { id: "demo/10", name: "Rex Bar", lat: 63.82560, lng: 20.25870, type: "bar", n: 4 },
    { id: "demo/11", name: "Glasklart", lat: 59.31270, lng: 18.08010, type: "bar", n: 0 }
  ];
  var FRIENDS = [
    { name: "Elin", lat: 59.31560, lng: 18.07150 }, // at Kvarnen
    { name: "Johan", lat: 60.14820, lng: 15.19180 },
    { name: "Sara", lat: 59.32710, lng: 18.05420 }
  ];

  function state() {
    var s = U.ls.getJSON(KEY, null);
    if (!s || typeof s !== "object") s = {};
    if (!Array.isArray(s.groups)) {
      s.groups = [{ id: "demo-g1", name: "Kompisarna", code: "KMP2SA", member_count: 5, demo: true }];
    }
    return s;
  }
  function save(s) { U.ls.setJSON(KEY, s); }

  var base = null;
  function buildBase() {
    var r = rng(20261016), out = [], id = 1000, now = Date.now();
    function minutesAgo() { return new Date(now - Math.floor(r() * 300) * 60e3).toISOString(); }
    function push(lat, lng, precise, friend) {
      out.push({ id: id++, lat: +lat.toFixed(5), lng: +lng.toFixed(5), beer_count: 1 + Math.floor(r() * r() * 5),
        precise: precise, created_at: minutesAgo(), is_mine: false, friend_name: friend || null });
    }
    BARS.forEach(function (b) {
      for (var i = 0; i < b.n; i++) {
        var d = 0.00035; push(b.lat + (r() - 0.5) * d, b.lng + (r() - 0.5) * d * 1.8, true);
      }
    });
    CITIES.forEach(function (c) {
      var n = c.c - Math.round(c.c * 0.4);
      for (var i = 0; i < n; i++) {
        var precise = r() > 0.3;
        var lat = c.lat + (r() - 0.5) * c.s * 2, lng = c.lng + (r() - 0.5) * c.s * 3.6;
        if (!precise) { lat = Math.round(lat / 0.005) * 0.005; lng = Math.round(lng / 0.01) * 0.01; }
        push(lat, lng, precise);
      }
    });
    FRIENDS.forEach(function (f) { push(f.lat, f.lng, true, f.name); });
    // Hot streaks and one medevac (at Stureplan Klubb). Elin (friend at Kvarnen) is on a hot streak.
    function setCount(i, n) { if (out[i]) out[i].beer_count = n; }
    setCount(BARS[0].n, 6);                              // a beer at Mälarpaviljongen
    setCount(BARS[0].n + BARS[1].n + BARS[2].n, 11);     // first beer at Stureplan Klubb -> medevac
    setCount(BARS[0].n + BARS[1].n + BARS[2].n + BARS[3].n, 7); // Ölstugan Tullen
    out[out.length - 3].beer_count = 6;                  // Elin
    out[out.length - 5].beer_count = 8;                  // a city beer (not at a bar)
    base = out;
  }

  function ok(data) { return Promise.resolve({ data: data, error: null }); }
  function fail(msg) { return Promise.resolve({ data: null, error: { message: msg } }); }
  function genCode() {
    var a = U.CODE_ALPHABET, s = ""; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s;
  }

  var rpcs = {
    post_beer: function (p) {
      if (p.p_lat < 55.0 || p.p_lat > 69.1 || p.p_lng < 10.9 || p.p_lng > 24.2) return fail("outside_sweden");
      var s = state(), now = new Date();
      var lat = p.p_precise ? +(+p.p_lat).toFixed(5) : +(Math.round(p.p_lat / 0.005) * 0.005).toFixed(5);
      var lng = p.p_precise ? +(+p.p_lng).toFixed(5) : +(Math.round(p.p_lng / 0.01) * 0.01).toFixed(5);
      var b = s.mine;
      if (b && new Date(b.expires_at) <= now) b = null;
      function shape(acc, wait, isNew, ms) {
        return { accepted: acc, wait_seconds: wait, id: b.id, lat: b.lat, lng: b.lng, beer_count: b.beer_count,
          is_new: isNew, expires_at: b.expires_at, milestone: ms };
      }
      if (b) {
        var left = U.COOLDOWN_MS - (now - new Date(b.updated_at));
        if (left > 0) return ok(shape(false, Math.ceil(left / 1000), false, null));
      }
      var isNew = !b;
      if (!b) b = { id: 1, beer_count: 0, created_at: now.toISOString(), expires_at: U.next5am(now).toISOString() };
      b.lat = lat; b.lng = lng; b.precise = !!p.p_precise; b.beer_count += 1; b.updated_at = now.toISOString(); b.stopped = false;
      s.mine = b; save(s);
      var c = b.beer_count;
      return ok(shape(true, 0, isNew, c === 1 || c === 5 || c === 10 ? c : null));
    },
    stop_beer: function () { var s = state(); if (s.mine) s.mine.stopped = true; save(s); return ok(null); },
    live_beers: function () {
      if (!base) buildBase();
      var s = state(), rows = base.slice();
      var inKomp = s.groups.some(function (g) { return g.demo; });
      if (!inKomp) rows = rows.map(function (r) { return r.friend_name ? Object.assign({}, r, { friend_name: null }) : r; });
      if (s.mine && !s.mine.stopped && new Date(s.mine.expires_at) > new Date()) {
        rows.push({ id: s.mine.id, lat: s.mine.lat, lng: s.mine.lng, beer_count: s.mine.beer_count, precise: s.mine.precise,
          created_at: s.mine.created_at, is_mine: true, friend_name: null });
      }
      return ok(rows);
    },
    create_group: function (p) {
      var s = state(), g = { id: "demo-" + Date.now(), name: String(p.p_name).slice(0, 40), code: genCode(), member_count: 1 };
      s.groups.push(g); save(s); return ok({ id: g.id, name: g.name, code: g.code });
    },
    join_group: function (p) {
      var s = state(), code = String(p.p_code || "").toUpperCase();
      var g = s.groups.filter(function (x) { return x.code === code; })[0];
      if (g) return ok({ id: g.id, name: g.name, code: g.code });
      if (code === "KMP2SA") {
        g = { id: "demo-g1", name: "Kompisarna", code: "KMP2SA", member_count: 5, demo: true };
        s.groups.push(g); save(s); return ok({ id: g.id, name: g.name, code: g.code });
      }
      return fail("group_not_found");
    },
    leave_group: function (p) {
      var s = state(); s.groups = s.groups.filter(function (g) { return g.id !== p.p_group_id; }); save(s); return ok(null);
    },
    my_groups: function () {
      var s = state(), mine = !!(s.mine && !s.mine.stopped && new Date(s.mine.expires_at) > new Date());
      return ok(s.groups.map(function (g) {
        return { id: g.id, name: g.name, code: g.code, member_count: g.member_count,
          active_count: (g.demo ? FRIENDS.length : 0) + (mine ? 1 : 0) };
      }));
    },
    set_display_name: function () { return ok(null); },
    save_push_subscription: function () { return ok(null); },
    delete_push_subscription: function () { return ok(null); }
  };

  window.DEMO = {
    skipCooldown: function () {
      var s = state();
      if (s.mine) { s.mine.updated_at = new Date(Date.now() - U.COOLDOWN_MS - 1000).toISOString(); save(s); }
    },
    bars: BARS.map(function (b) { return { id: b.id, name: b.name, lat: b.lat, lng: b.lng, type: b.type }; }),
    rpc: function (name, params) {
      var f = rpcs[name];
      if (!f) return fail("unknown rpc " + name);
      return new Promise(function (res) { setTimeout(function () { res(f(params || {})); }, 120); });
    }
  };
})();
