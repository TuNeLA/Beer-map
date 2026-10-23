/* Öl Nu — 🎞️ VISNINGSLÄGE (window.DEMO; CONTRACT "VISNINGSLÄGE"). A client-side simulation of a big night out in Sweden:
   ~100 people at 15:00, ~1000 more per hour through the evening, a surge 21–01, peak ≈ 23 673 around 01:30–02:00,
   then a slow fall until 05:00. Stockholm 45 %, Göteborg 25 %, Malmö 15 %, 14 smaller towns 15 %. NEVER Ludvika / Smedjebacken.
   - Deterministic per night (seed = the Swedish night date, Swedish wall time via Intl): every phone shows the same story.
   - Owner decision (2026-10-23): ON for every user, no label anywhere. Fake people look like real strangers.
     Global kill switch without a deploy: public_config().visning ("on" | "off", table app_public_flags, migration 0159).
     Missing field (old server) = on. Per-device override for tests: ?visning=1 / ?visning=0 (localStorage "olnu.visning").
     ⚠️ The owner must turn it OFF before any public launch or Play Store release.
   - Nothing is ever sent to the server: no RPC writes, nothing in meriter / top lists / leagues / morning paper / push /
     real bar stats. The fake people only exist in this file and are fed to app.js through small hooks:
       DEMO.bars(comp, get, z)   render(): people (+ a few check-ins) per bar → pills, tiers, crowd words, bar sheet
       DEMO.heat(out)            heatData(): bar points weighted by people × drinks
       DEMO.total()              the world counter (real + simulated)
       DEMO.popup(b) / skal(btn) a fake row's card (stranger look) and its 🍻 (local only)
       DEMO.cisAt(bar) / crowd() check-ins list and "Visa alla" crowd list
       NEWS.build is wrapped: a few ticker lines from the simulation (dalmål).
   - People sit at bars; on a slow per-bar timer (value noise, ~40 min) they drift to other bars nearby, so counts rise and fall.
     ~10 % are "between bars" (in no count). Strangers are never single pins (the app's privacy model), so there are NO
     individual fake pins: only bar counts, crowd words, heat, the world counter and ticker lines. A fake person exists only as
     a row in a bar sheet's "Folk här" list (shown like a real stranger, "Någon"); its 🍻 is counted locally.
   - Perf: one normal composite marker per bar; only bars in view (+30–50 %) get people, top 12 (z < 12.5) / 50 (z < 14) /
     90 (z ≥ 14). Below zoom 11 one cluster-style pill per town (merged when close on screen). Counts every 10 s; bar markers
     redrawn at most every 20 s and when a pan leaves the drawn box.
   - Real users' own pins, friends and groups are untouched and draw on top (tiers priority). */
(function () {
  "use strict";
  var KEY = "olnu.visning", SRV = "olnu.visning.srv";
  var PEAK = 23673, WALK = 0.10, HOT_ZOOM = 11;   // WALK: share between bars (in no count)
  var A = null, offset = 0;
  function now() { return Date.now() + offset; }
  function mono() { return window.performance && performance.now ? performance.now() : Date.now(); }   // throttles (a frozen test clock must not stop them)
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- on / off ---------- */
  (function urlOverride() {
    try {
      var m = /[?&]visning=([01])\b/.exec(location.search || "");
      if (!m) return;
      lsSet(KEY, m[1]);
      var q = location.search.replace(/([?&])visning=[01]&?/, "$1").replace(/[?&]$/, "");
      history.replaceState(history.state, "", location.pathname + q + location.hash);
    } catch (e) {}
  })();
  var srvOn = lsGet(SRV) !== "off";
  function devOverride() { var v = lsGet(KEY); return v === "1" ? true : v === "0" ? false : null; }
  function on() { if (!A || !A.live) return false; var d = devOverride(); return d != null ? d : srvOn; }
  function fetchFlag() {
    var CFG = window.OLNU_CONFIG || {};
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.fetch) return;
    fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/public_config", { method: "POST", credentials: "omit",
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || typeof d !== "object" || Array.isArray(d) || !("visning" in d)) return;   // old server: keep the default (on)
        var v = String(d.visning || "").toLowerCase() !== "off";
        lsSet(SRV, v ? "on" : "off");
        if (v !== srvOn) { srvOn = v; changed(); }
      })
      .catch(function () {});
  }

  /* ---------- deterministic noise ---------- */
  function h32(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mix(a, b) {
    var h = Math.imul((a ^ (b + 0x9e3779b9)) | 0, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ (a >>> 7), 0x27d4eb2d); h ^= h >>> 15; return h >>> 0;
  }
  function u(a, b) { return mix(a, b) / 4294967296; }
  function vn(seed, x) { var i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return u(seed, i) * (1 - s) + u(seed, i + 1) * s; }
  function gauss(seed) { var a = Math.max(1e-9, u(seed, 11)), b = u(seed, 12); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
  function km(a, b, c, d) { var x = (d - b) * Math.cos((a + c) * Math.PI / 360), y = c - a; return 111.2 * Math.sqrt(x * x + y * y); }

  /* ---------- Swedish wall time → night + minutes since 15:00 ---------- */
  var fmt = null;
  try { fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch (e) { fmt = null; }
  var clockCache = { at: -1 };
  function clock(ms) {
    var mm = Math.floor(ms / 60000);
    if (clockCache.at !== mm) {
      var y, mo, d, h, mi;
      if (fmt) {
        var p = {}; fmt.formatToParts(new Date(mm * 60000)).forEach(function (x) { p[x.type] = x.value; });
        y = +p.year; mo = +p.month; d = +p.day; h = +p.hour % 24; mi = +p.minute;
      } else { var dt = new Date(mm * 60000); y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate(); h = dt.getHours(); mi = dt.getMinutes(); }
      if (h < 12) { var pv = new Date(Date.UTC(y, mo - 1, d - 1)); y = pv.getUTCFullYear(); mo = pv.getUTCMonth() + 1; d = pv.getUTCDate(); }
      var night = y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d;
      clockCache = { at: mm, night: night, m: (h - 15) * 60 + mi + (h < 12 ? 1440 : 0) };
    }
    return { night: clockCache.night, m: clockCache.m + (ms - mm * 60000) / 60000 };   // m: −180 … 1260 (12:00 → 12:00)
  }

  /* ---------- the night's curve (minutes −180 … 1260 from 15:00) ---------- */
  var curve = null;
  function buildCurve(night) {
    var NS = h32("olnu-visning|" + night), T = new Float64Array(1441), peakM = 620 + Math.floor(u(NS, 1) * 40);
    var P = PEAK + Math.round((u(NS, 2) - 0.5) * 240), holdEnd = 665 + Math.floor(u(NS, 3) * 25), cum = [0], c = 0, m;
    function rate(x) {
      if (x < 120) return 7;                                  // 15–17
      if (x < 360) return 17;                                 // 17–21 (~1000 / h)
      if (x < 600) return 30 + (x - 360) / 240 * 45;          // 21–01 surge
      return 50 - (x - 600) / Math.max(1, peakM - 600) * 35;  // 01 → peak: taper
    }
    for (m = 0; m < peakM; m++) { c += rate(m) * (0.45 + 1.1 * u(NS, 100 + m)) * (0.8 + 0.4 * vn(NS ^ 7, m / 30)); cum.push(c); }
    for (m = 0; m <= peakM; m++) T[m + 180] = 100 + (P - 100) * cum[m] / c;
    for (m = peakM + 1; m <= holdEnd; m++) T[m + 180] = P + (m - peakM) * 0.4;
    var top = T[holdEnd + 180];
    for (m = holdEnd + 1; m <= 840; m++) T[m + 180] = top * (1 - 0.2 * (m - holdEnd) / (840 - holdEnd)) * (1 + 0.006 * (vn(NS ^ 9, m / 7) - 0.5));
    var v5 = T[840 + 180];
    for (m = 841; m <= 960; m++) T[m + 180] = v5 + (0.25 * P - v5) * (m - 840) / 120;
    for (m = 961; m <= 1260; m++) T[m + 180] = 0.25 * P + (60 - 0.25 * P) * (m - 960) / 300;
    for (m = -180; m < 0; m++) T[m + 180] = 30 + 70 * (m + 180) / 180;
    return { night: night, NS: NS, T: T, P: P, peakM: peakM };
  }
  function curveFor(night) { if (!curve || curve.night !== night) { curve = buildCurve(night); } return curve; }
  function totalAt(ms) {
    var c = clock(ms), cv = curveFor(c.night), x = Math.max(-180, Math.min(1260, c.m)) + 180, i = Math.floor(x), f = x - i;
    return cv.T[i] + ((cv.T[Math.min(1440, i + 1)] || cv.T[i]) - cv.T[i]) * f;
  }

  /* ---------- towns ---------- */
  // [name, lat, lng, radius km, share, centres [[lat, lng, weight, area name]]]
  var SMALL = 0.15;
  var TOWNS = [
    ["Stockholm", 59.3326, 18.0649, 5, 0.45, [[59.3355, 18.0737, 1, "Stureplan"], [59.3326, 18.0649, 0.8, "City"], [59.3143, 18.0735, 0.8, "Söder"], [59.3247, 18.0704, 0.5, "Gamla stan"]]],
    ["Göteborg", 57.7065, 11.9670, 4, 0.25, [[57.7010, 11.9750, 1, "Avenyn"], [57.7065, 11.9670, 0.7, "Centrum"], [57.6990, 11.9530, 0.5, "Linné"]]],
    ["Malmö", 55.6050, 13.0038, 3.5, 0.15, [[55.6047, 12.9997, 1, "Lilla torg"], [55.5900, 13.0080, 0.8, "Möllan"]]],
    ["Uppsala", 59.8586, 17.6389, 2.5, 10], ["Västerås", 59.6099, 16.5448, 2, 6], ["Örebro", 59.2741, 15.2066, 2, 6],
    ["Linköping", 58.4108, 15.6214, 2, 6], ["Norrköping", 58.5877, 16.1924, 2, 5], ["Umeå", 63.8258, 20.2630, 2, 5],
    ["Sundsvall", 62.3908, 17.3069, 2, 3.5], ["Gävle", 60.6749, 17.1413, 2, 4], ["Falun", 60.6065, 15.6355, 2, 2.5],
    ["Borlänge", 60.4858, 15.4371, 2, 2.5], ["Karlstad", 59.3793, 13.5036, 2, 4], ["Jönköping", 57.7826, 14.1618, 2.5, 5],
    ["Helsingborg", 56.0465, 12.6945, 2, 5.5], ["Lund", 55.7047, 13.1910, 1.8, 5]
  ];
  // the owner's friends use these for real: never simulate near them
  var NO_GO = [[60.1496, 15.1878, 30], [60.1406, 15.4125, 15]];
  function noGo(lat, lng) { for (var i = 0; i < NO_GO.length; i++) if (km(lat, lng, NO_GO[i][0], NO_GO[i][1]) < NO_GO[i][2]) return true; return false; }
  var STAR = /spy bar|sturecompagniet|berns|riche|kharma|trädgården|debaser|marie laveau|hell'?s kitchen|nefertiti|valand|park lane|kulturbolaget|slagthuset|babel|tyrolen|stora tornet/i;
  var CAP = { nightclub: 950, bar: 320, pub: 260, biergarten: 200 };

  var cities = null, citiesAt = 0;
  function buildCities() {
    var B = window.BARS, small = 0;
    TOWNS.forEach(function (t) { if (!t[5]) small += t[4]; });
    var out = TOWNS.map(function (t, ix) {
      var c = { ix: ix, name: t[0], lat: t[1], lng: t[2], r: t[3], share: t[5] ? t[4] : SMALL * t[4] / small, centres: t[5] || [[t[1], t[2], 1, t[0]]],
        seed: h32("town|" + t[0]), bars: [], w0sum: 0 };
      c.box = [c.lat - c.r / 111.2, c.lng - c.r / (111.2 * Math.cos(c.lat * Math.PI / 180)), c.lat + c.r / 111.2, c.lng + c.r / (111.2 * Math.cos(c.lat * Math.PI / 180))];
      if (noGo(c.lat, c.lng)) return c;
      var list = [];
      try { list = B && B.inBounds && window.L ? B.inBounds(L.latLngBounds([c.box[0], c.box[1]], [c.box[2], c.box[3]])) : []; } catch (e) { list = []; }
      list.forEach(function (b) {
        if (!b || !b.name || b.arena || b.place || noGo(b.lat, b.lng) || km(c.lat, c.lng, b.lat, b.lng) > c.r) return;
        var bs = h32("bar|" + b.id), cw = 0.2, area = null, best = 1e9;
        c.centres.forEach(function (z) { var d = km(z[0], z[1], b.lat, b.lng); cw += z[2] * Math.exp(-d / 1.1); if (d < 0.6 && d < best) { best = d; area = z[3]; } });
        var w0 = Math.exp(0.8 * gauss(bs)) * cw * (STAR.test(b.name) ? 2.5 : 1);
        c.bars.push({ bar: b, bs: bs, w0: w0, type: CAP[b.type] ? b.type : "bar", area: area, nb: null, n: 0 });
      });
      c.bars.sort(function (a, b) { return String(a.bar.id) < String(b.bar.id) ? -1 : 1; });   // same order on every phone
      c.bars.forEach(function (x) { c.w0sum += x.w0; });
      c.bars.forEach(function (x, i) {
        x.nb = [];
        c.bars.forEach(function (y, j) { if (km(x.bar.lat, x.bar.lng, y.bar.lat, y.bar.lng) <= 0.7) x.nb.push(j); });
      });
      return c;
    });
    return out;
  }
  // Built from BARS once its bars are loaded; once more 15 s later (extras / closed list may have changed the set).
  var triedAt = 0;
  function getCities() {
    var t = mono(), nBars = cities ? cities.nBars : -1;
    if ((!cities || (!nBars && t - triedAt > 3000) || (citiesAt && !cities.second && t - citiesAt > 15000))) {
      triedAt = t;
      var nc = buildCities(); nc.nBars = nc.reduce(function (s, c) { return s + c.bars.length; }, 0);
      if (cities && citiesAt) nc.second = true;
      if (nc.nBars && !citiesAt) citiesAt = t;
      cities = nc; countsAt = -1e15;
    }
    return cities;
  }

  /* ---------- counts ---------- */
  var counts = {}, cityN = [], tot = 0, countsAt = -1e15, byId = {};
  function typeW(type, m) {
    if (type === "nightclub") return m < 300 ? 0.08 : m < 480 ? 0.08 + (m - 300) / 180 * 4.9 : 5;
    if (type === "pub") return m < 480 ? 2.2 : Math.max(1.4, 2.2 - (m - 480) / 120 * 0.8);
    if (type === "biergarten") return m < 360 ? 1.4 : 0.3;
    return m < 480 ? 1.5 + Math.max(0, m - 240) / 240 * 0.8 : 2.3;
  }
  function compute(force) {
    var t = now();
    if (!force && Math.abs(t - countsAt) < 10000) return;
    countsAt = t;
    var cs = getCities(), c0 = clock(t), cv = curveFor(c0.night), m = c0.m;
    if (!cs) return;
    tot = Math.round(totalAt(t));
    var shares = cs.map(function (c) { return c.share * (1 + 0.08 * (u(cv.NS ^ c.seed, 1) - 0.5)) * (1 + 0.1 * (vn(cv.NS ^ c.seed, m / 90) - 0.5)); });
    var ssum = shares.reduce(function (s, x) { return s + x; }, 0);
    counts = {}; byId = {};
    cityN = cs.map(function (c, i) {
      var n = Math.round(tot * shares[i] / ssum), atBars = n * (1 - WALK), W = 0;
      c.n = n;
      if (!c.bars.length) return n;
      c.bars.forEach(function (x) { x.w = x.w0 * typeW(x.type, m) * (0.55 + 0.9 * vn(x.bs ^ cv.NS, m / 40)); W += x.w; });
      c.bars.forEach(function (x) {
        var k = Math.floor(atBars * x.w / W + u(x.bs, Math.floor(m / 3)));
        x.n = Math.max(0, Math.min(CAP[x.type] || 300, k));
        if (x.n) { counts[x.bar.id] = x.n; byId[x.bar.id] = x; }
      });
      return n;
    });
  }

  /* ---------- fake people ---------- */
  var NAMES = ["Erik", "Lars", "Karl", "Anders", "Johan", "Per", "Nils", "Lena", "Anna", "Maria", "Karin", "Sara", "Emma", "Elin", "Ida", "Linnea",
    "Frida", "Julia", "Hanna", "Moa", "Wilma", "Alva", "Ebba", "Saga", "Oscar", "Viktor", "Axel", "Gustav", "Filip", "Emil", "Hugo", "Elias",
    "Albin", "Isak", "Leo", "Ludvig", "Jonas", "Mattias", "Fredrik", "Henrik", "Sofia", "Malin", "Jenny", "Therese", "Josefin", "Amanda",
    "Matilda", "Tove", "Klara", "Agnes", "Stina", "Kalle", "Pelle", "Olle", "Nisse", "Ville", "Simon", "Rasmus", "Jesper", "Linus",
    "Sebastian", "Adam", "Ali", "Mohammed", "Yasmin", "Leila", "Noah", "Liam", "Maja", "Astrid", "Signe", "Greta", "Ellen", "Felicia",
    "Kevin", "Dennis", "Robin", "Jimmy", "Petra", "Camilla", "Åsa", "Märta", "Göran", "Bosse", "Kjell", "Ulla", "Birgitta", "Sven"];
  var pools = {}, ciPools = {}, people = {};
  function drinksFor(ps, m) {
    var u1 = u(ps, 1), out = Math.max(15, Math.min(m - 90 * u1 - 60, 60 + u1 * 300));
    var n = 1 + Math.floor(out / 60 * (0.7 + 0.9 * u(ps, 2)) * (u(ps, 3) < 0.05 ? 1.8 : 1));
    return { n: Math.max(1, Math.min(16, n)), out: out };
  }
  function person(id, ps, lat, lng, barId) {
    var p = people[id];
    if (!p) {
      p = people[id] = { id: id, lat: lat, lng: lng, precise: true, beer_count: 1, other_count: 0, shot_count: 0, is_mine: false, friend_name: null,
        skal_count: u(ps, 4) < 0.3 ? 1 + Math.floor(u(ps, 5) * 3) : 0, i_skaled: false, created_at: null, _demo: true, _ps: ps,
        _name: NAMES[mix(ps, 6) % NAMES.length] };
      if (barId != null) p.bar_id = barId;
    }
    return p;
  }
  function refreshPerson(p, m, t) {
    var d = drinksFor(p._ps, m);
    if (p.beer_count !== d.n || !p.created_at || p._m !== Math.floor(m)) { p.beer_count = d.n; p._m = Math.floor(m); p.created_at = new Date(t - d.out * 60000).toISOString(); }
    return p;
  }
  function peopleAt(x, m, t) {
    var id = x.bar.id, pool = pools[id] || (pools[id] = []);
    for (var i = pool.length; i < x.n; i++) pool.push(person("dm" + x.bs.toString(36) + "_" + i, mix(x.bs, i + 1), x.bar.lat, x.bar.lng, id));
    var out = pool.slice(0, x.n);
    for (var k = 0; k < out.length; k++) refreshPerson(out[k], m, t);
    return out;
  }
  function cisFor(x) {
    var k = Math.min(30, Math.floor(x.n * 0.08)), id = x.bar.id, pool = ciPools[id] || (ciPools[id] = []), cv = curve;
    for (var i = pool.length; i < k; i++) {
      var ps = mix(x.bs ^ 0x5bd1e995, i + 1);
      pool.push({ bar_id: id, bar_name: x.bar.name, lat: x.bar.lat, lng: x.bar.lng, name: NAMES[ps % NAMES.length], is_mine: false, is_friend: false,
        created_at: new Date(now() - (10 + u(ps, 1) * 120) * 60000).toISOString(), _demo: true });
    }
    return pool.slice(0, k);
  }

  /* ---------- view helpers ---------- */
  function viewCities(pad) {
    var cs = getCities(); if (!cs || !A) return [];
    var b; try { b = A.map.getBounds().pad(pad == null ? 0.5 : pad); } catch (e) { return []; }
    return cs.filter(function (c) { return c.n > 0 && !(c.box[2] < b.getSouth() || c.box[0] > b.getNorth() || c.box[3] < b.getWest() || c.box[1] > b.getEast()); });
  }
  var lastBarsAt = 0, lastViewKey = "";
  function viewKey() { return viewCities().map(function (c) { return c.ix; }).join(","); }

  /* ---------- hooks for app.js ---------- */
  // Perf: only bars in (or near) the view get people markers, and fewer when zoomed out (tiers shows 6–12 pills there anyway):
  // z < 12.5: top 12 · z < 14: top 50 · z ≥ 14: top 90. A pan out of the drawn box redraws (see attach).
  var lastBox = null;
  function bars(comp, get, z) {
    if (!on()) return;
    lastBarsAt = mono(); lastViewKey = viewKey(); lastBox = null;
    if (z < HOT_ZOOM) return;
    compute();
    var t = now(), m = clock(t).m, max = z < 12.5 ? 12 : z < 14 ? 50 : 90, box, list = [];
    try { box = A.map.getBounds().pad(z < 14 ? 0.3 : 0.5); } catch (e) { return; }
    viewCities(1).forEach(function (c) { c.bars.forEach(function (x) { if (x.n && box.contains([x.bar.lat, x.bar.lng])) list.push(x); }); });
    list.sort(function (a, b) { return b.n - a.n; });
    list.slice(0, max).forEach(function (x) {
      var cc = get(x.bar.id, x.bar);
      cc.beers = cc.beers.concat(peopleAt(x, m, t));
      var ci = cisFor(x); if (ci.length) cc.cis = cc.cis.concat(ci);
    });
    lastBox = box;
  }
  function heat(out) {
    if (!on()) return;
    compute();
    (getCities() || []).forEach(function (c) {
      if (!c.n) return;
      if (!c.bars.length) { out.push([c.lat, c.lng, c.n * 2.5]); return; }
      c.bars.forEach(function (x) { if (x.n) out.push([x.bar.lat, x.bar.lng, x.n * 2.6]); });
    });
  }
  function total() { if (!on()) return 0; compute(); return tot; }
  function cisAt(bar) {
    if (!on() || !bar) return [];
    compute();
    var x = byId[bar.id]; return x ? cisFor(x) : [];
  }
  function crowd(id, agg) {
    if (!on()) return agg;
    compute();
    var x = byId[id]; if (!x) return agg;
    var t = now(), list = peopleAt(x, clock(t).m, t);
    return { bar: agg ? agg.bar : x.bar, beers: (agg ? agg.beers : []).concat(list) };
  }
  function esc(s) { return window.U ? window.U.esc(s) : String(s); }
  function T(k, a) { try { return window.I18N.t(k, a); } catch (e) { return ""; } }
  // A fake person's card: looks like a stranger's pin card + a first name. No module hooks (reactions etc. would call the server).
  function popup(b) {
    var n = window.U ? window.U.drinks(b) : b.beer_count, done = !!b.i_skaled, sk = b.skal_count | 0;
    var lv = n >= 10 ? "🚁 " + T("medevac") : n >= 5 ? "🔥 " + T("hot") : "", all = window.LEVELS_SV, best = null;
    if (Array.isArray(all) && (!window.I18N || window.I18N.lang === "sv")) {   // same Swedish level names as app.js (one per person)
      for (var i = 0; i < all.length; i++) if (n >= all[i].at && (!best || all[i].at > best.at)) best = all[i];
      lv = best && best.names && best.names.length ? best.emoji + " " + best.names[mix(b._ps, best.at) % best.names.length] : lv;
    }
    return '<div class="pp-title">' + esc(T("beerNo", n)) + "</div>" +
      '<div class="pp-data">' + esc(T("since", window.U ? window.U.timeHM(b.created_at) : "")) + "</div>" +
      (lv ? '<div class="pp-level">' + esc(lv) + "</div>" : "") +
      '<button type="button" class="skal-btn' + (sk > 0 ? " has" : "") + '" data-skal="' + esc(b.id) + '"' + (done ? " disabled" : "") + ">" +
      esc(done ? T("skaled", sk) : sk > 0 ? T("skal", sk) : T("skalDone")) + "</button>";
  }
  // 🍻 on a fake person: counted here only, never sent.
  function skal(button) {
    var id = button && button.getAttribute("data-skal"), p = id && people[id];
    if (!p) return false;
    if (p.i_skaled || button.disabled) return true;
    p.skal_count = (p.skal_count | 0) + 1; p.i_skaled = true;
    document.querySelectorAll('.skal-btn[data-skal="' + String(id).replace(/["\\]/g, "") + '"]').forEach(function (x) { x.disabled = true; x.textContent = T("skaled", p.skal_count); });
    try { window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate([18, 40, 18]); } catch (e) {}
    button.classList.add("pop");
    return true;
  }

  /* ---------- zoomed out (< 11): one cluster-style pill per town, merged when close ---------- */
  var pillLayer = null, pillKey = "";
  function updatePills(force) {
    if (!A) return;
    var map = A.map, z = map.getZoom();
    var show = on() && z < HOT_ZOOM && z >= 4;
    if (!show) { if (pillLayer) { pillLayer.clearLayers(); pillKey = ""; } return; }
    compute();
    var cs = (getCities() || []).filter(function (c) { return c.n > 0; }).map(function (c) { return { c: [c], n: c.n, p: map.project([c.lat, c.lng], z), lat: c.lat, lng: c.lng }; });
    cs.sort(function (a, b) { return b.n - a.n; });
    var groups = [];
    cs.forEach(function (g) {
      for (var i = 0; i < groups.length; i++) if (groups[i].p.distanceTo(g.p) < 70) { groups[i].n += g.n; groups[i].c = groups[i].c.concat(g.c); return; }
      groups.push(g);
    });
    var m = clock(now()).m, lvl = m > 420 ? 2 : m > 240 ? 1 : 0;
    var key = z + "|" + groups.map(function (g) { return g.c[0].ix + ":" + g.n; }).join(",");
    if (!force && key === pillKey) return;
    pillKey = key;
    if (!pillLayer) pillLayer = L.layerGroup().addTo(map);
    pillLayer.clearLayers();
    groups.forEach(function (g) {
      var mk = L.marker([g.lat, g.lng], { icon: L.divIcon({ html: U.pillHTML(g.n, lvl, { noEmoji: true, cls: "p-cl" }), className: "olnu-cl", iconSize: [0, 0], iconAnchor: [0, 0] }), keyboard: false });
      mk.on("click", function () { map.setView([g.lat, g.lng], g.c.length > 1 ? Math.min(HOT_ZOOM, z + 2) : 13); });
      mk.addTo(pillLayer);
    });
  }

  /* ---------- ticker lines (dalmål) ---------- */
  var SV = [
    "{place}: {n} st på {bar} – kön går runt hela kvarteret, dä",
    "{bar} i {city} ä packat: {n} pers å ingen ä nykter",
    "Läget i {city}: {c} ute just nu. Förstärkning ä på väg",
    "Underrättelse: {n} personer intagna på {bar}. Positionen hålls",
    "{city} brinner: {c} ute å {bar} leder med {n}",
    "Rapport från {bar}: {n} st å dansgolvet bågnar",
    "Hela {city} ä ute ikväll – {c} st. Nu ä dä fest, dä",
    "Spaning: {bar} har {n} gäster. Vakterna ser trötta ut",
    "{n} på {bar}! Sånt har int setts sen Vasaloppet",
    "Kvällens hetaste: {bar} i {city}, {n} st å fler på väg",
    "Sverigeläget: {w} ute just nu. Dä ä int klokt",
    "{place}: {n} trängs på {bar}. Ta på dä hjälmen",
    "Order från högkvarteret: alla till {bar}. {n} redan på plats",
    "Ny topp i {city}: {bar} med {n} st",
    "Patrullen meddelar: {c} ute i {city}, baren på {bar} går varm",
    "{bar} ({city}): {n} gäster, bartendern har slutat räkna"
  ];
  var EN = [
    "{place}: {n} people at {bar} – the queue goes round the block",
    "{bar} in {city} is packed: {n} people",
    "{city} right now: {c} out tonight",
    "Hottest spot: {bar} in {city} with {n}",
    "Sweden right now: {w} out drinking"
  ];
  var used = [], NF = null;
  try { NF = new Intl.NumberFormat("sv-SE"); } catch (e) { NF = null; }
  function nf(n) { return NF ? NF.format(n) : String(n); }
  function newsLines(k) {
    compute();
    var cs = (getCities() || []).filter(function (c) { return c.bars.length && c.n > 0; });
    if (!cs.length) return [];
    var en = window.I18N && window.I18N.lang === "en", tpl = en ? EN : SV, out = [];
    for (var i = 0; i < k; i++) {
      var r = Math.random() * cs.reduce(function (s, c) { return s + c.n; }, 0), c = cs[0];
      for (var j = 0, acc = 0; j < cs.length; j++) { acc += cs[j].n; if (acc >= r) { c = cs[j]; break; } }
      var top = c.bars.filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
      if (!top.length) continue;
      var x = top[Math.floor(Math.random() * top.length)];
      var free = tpl.map(function (s, ix) { return ix; }).filter(function (ix) { return used.indexOf((en ? "e" : "s") + ix) < 0; });
      if (!free.length) { used = []; free = tpl.map(function (s, ix) { return ix; }); }
      var ix = free[Math.floor(Math.random() * free.length)];
      used.push((en ? "e" : "s") + ix); if (used.length > Math.min(10, tpl.length - 1)) used.shift();
      var text = tpl[ix].replace("{place}", x.area || c.name).replace("{bar}", x.bar.name).replace("{city}", c.name)
        .replace("{n}", nf(x.n)).replace("{c}", nf(c.n)).replace("{w}", nf(tot + (realN | 0)));
      out.push({ text: ["📡", "🔥", "🍻", "🪖", "📣"][Math.floor(Math.random() * 5)] + " " + text, cls: "", k: "visning" });
    }
    return out;
  }
  function wrapNews() {
    var N = window.NEWS; if (!N || N._visning || typeof N.build !== "function") return;
    var orig = N.build; N._visning = true;
    N.build = function (b, ctx) {
      var items = orig.apply(this, arguments) || [];
      if (!on()) return items;
      try {
        var add = newsLines(items.length >= 4 ? 2 : 3);
        if (!items.length) return add;
        add.forEach(function (x, i) { items.splice(Math.min(items.length, 1 + i * 3), 0, x); });
        return items.slice(0, 8);
      } catch (e) { return items; }
    };
  }

  /* ---------- world counter (between app renders) ---------- */
  var realN = null;
  function counter(real) {
    if (typeof real === "number") realN = real;
    if (!on() || realN == null) return real;
    return nf((realN | 0) + total());
  }
  function paintCounter() {
    var el = document.getElementById("live-count");
    if (!el || realN == null || !on()) return;
    var html = T("live", nf((realN | 0) + total()));
    if (html && el.innerHTML !== html) el.innerHTML = html;
  }

  /* ---------- loop ---------- */
  var tickN = 0, timer = 0, wasOn = false, seenBars = 0;
  function changed() {
    var o = on();
    if (!o) { if (pillLayer) pillLayer.clearLayers(); pillKey = ""; }
    if (A && o !== wasOn) { wasOn = o; try { A.render(); } catch (e) {} }
    if (o) { updatePills(true); }
  }
  function popupOpen() { try { return !!(A.map._popup && A.map._popup.isOpen && A.map._popup.isOpen()); } catch (e) { return false; } }
  function tick() {
    if (!A) return;
    var o = on();
    if (o !== wasOn) { changed(); return; }
    if (!o || document.visibilityState === "hidden") return;
    tickN++;
    var z = A.map.getZoom(), cs = getCities(), nb = cs ? cs.nBars : 0;
    if (nb !== seenBars) { seenBars = nb; compute(true); updatePills(true); if (nb && z >= HOT_ZOOM && viewCities().length) { A.render(); return; } }
    if (tickN % 5 === 0) paintCounter();
    if (tickN % 10 === 0) { compute(true); updatePills(); }
    if (tickN % 20 === 0 && viewCities().length && !A.map._animatingZoom) {
      if (z >= HOT_ZOOM && mono() - lastBarsAt > 19000 && !popupOpen()) A.render();
      else if (z < HOT_ZOOM && tickN % 30 === 0) A.renderHeat();
    }
  }

  window.DEMO = {
    // app.js: DEMO.attach({ map, live, render, renderHeat, beerIcon, real }) once, after its render functions exist
    attach: function (api) {
      A = api; wrapNews(); wasOn = on();
      fetchFlag(); setInterval(fetchFlag, 15 * 60000);
      A.map.on("zoomend", function () { updatePills(); });
      A.map.on("moveend", function () {
        updatePills();
        var moved = function () { var b = A.map.getBounds(); return viewKey() !== lastViewKey || (lastBox && !lastBox.contains(b)); };
        if (on() && A.map.getZoom() >= HOT_ZOOM && moved()) setTimeout(function () { if (moved() && !A.map._animatingZoom) A.render(); }, 250);
      });
      if (!timer) timer = setInterval(tick, 1000);
      setTimeout(function () { if (on()) { compute(true); updatePills(true); } }, 1500);
    },
    on: on, bars: bars, heat: heat, total: total, counter: counter, cisAt: cisAt, crowd: crowd, popup: popup, skal: skal,
    // tests / perf
    _setNow: function (ms) { offset = ms - Date.now(); countsAt = -1e15; compute(true); pillKey = ""; updatePills(true); if (A && on()) A.render(); },
    _state: function () {
      compute();
      var cs = getCities() || [];
      return { on: on(), total: tot, night: curve && curve.night, m: clock(now()).m, peak: curve && curve.P,
        cities: cs.map(function (c) { return { name: c.name, n: c.n, bars: c.bars.length, atBars: c.bars.reduce(function (s, x) { return s + x.n; }, 0) }; }),
        pills: pillLayer ? pillLayer.getLayers().length : 0 };
    },
    _totalAt: totalAt, _noGo: noGo
  };
})();
