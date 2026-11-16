/* PintsNow — SEASON CLOCK (lane seasons, owner 15 Nov 2026, I-115 / I-117: "it makes it unique every time you open the app").
   window.PNSeason. The one place that says WHICH season, holiday and weather it is. Pure date maths in Europe/Stockholm.
   Calendar (audit/maplook3 sheet 13, accepted by the owner):
   - Christmas  1 Dec – 13 Jan: tree + light strings on the map, Christmas taps, Santa hat, the Christmas button colour.
                GLÖGG on the ÖL! button 1 – 26 Dec (only the look: it is still one drink, exactly as before).
   - Advent     candles at the churches: Advent 1 (the Sunday 3 weeks before the Sunday on or before 24 Dec) to 26 Dec,
                1-4 lit = Advent Sundays passed. Lucia 13 Dec: the Lucia crown in place of the candles.
   - New Year   31 Dec 18:00 – 1 Jan 03:00: New Year taps, party hat, colour. Fireworks on the map from 00:00.
   - Valborg    30 Apr (all day): Valborg taps, student cap, colour. Fires on the map 18:00 – 01:00.
   - Spring     1 Apr – 31 May (not Valborg): fresh green parks; normal taps + 3 spring ones.
   - Midsummer  Midsummer Eve (the Friday in 19-25 June) + the Saturday: poles, flowers, taps, flower crown, colour.
   - Autumn     October: leaves, autumn parks, taps, leaves + acorn, colour.
   - Winter     14 Jan – 31 Mar: normal taps (+ the snowflake burst when it snows).  All other days: normal (5).
   Weather (open-meteo, already read by js/ute.js; no new call): snow 71 73 75 77 85 86, rain 51-67 80-82 95-99, fog 45 48,
   "snow has fallen" = snow depth over 2 cm. Northern lights: NOAA SWPC planetary K index (public, no key), fetched at most
   every 3 hours, cached in localStorage; only asked for while it is dark and clear and Levande karta is on.
   Rules: nothing here depends on how much anyone drank. Store builds get map decorations, never tap effects (seasontap.js).
   Test hook (test builds only: local, staging config, /test/ or PN_DEV): ?season=xmas|lucia|newyear|fireworks|valborg|spring|
   midsummer|autumn|winter|normal, ?date=2026-12-13T20:00 (Stockholm time; the clock then runs on from it), ?wx=snow|snow1|snow3|
   rain|rain3|fog|clear|snowfall (depth), ?kp=6. PNSeason._force({...}) does the same from a test. */
(function () {
  "use strict";
  var W = window, D = W.document;
  var TZ = "Europe/Stockholm", LIVE_REF = "wcdskpcevbhouvbytkhv", KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
  var KP_KEY = "pn_season_kp", KP_TTL = 3 * 3600e3;

  /* ---------- pure date maths (unit tests: tests/unit/seasons.test.mjs) ---------- */
  var fmt = null;
  function parts(ms) {   // Stockholm wall clock: { y, mo (1-12), d, h, mi, dow (0 = Sunday) }
    try {
      if (!fmt) fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      var o = {}; fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
      var y = +o.year, mo = +o.month, d = +o.day;
      return { y: y, mo: mo, d: d, h: (+o.hour) % 24, mi: +o.minute, dow: dowOf(y, mo, d) };
    } catch (e) { var x = new Date(ms); return { y: x.getFullYear(), mo: x.getMonth() + 1, d: x.getDate(), h: x.getHours(), mi: x.getMinutes(), dow: x.getDay() }; }
  }
  function dowOf(y, mo, d) { return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); }
  function key(mo, d) { return mo * 100 + d; }   // 1224 = 24 Dec
  // the first Sunday of Advent: Advent 4 = the Sunday on or before 24 Dec, Advent 1 = 21 days earlier. → { mo, d }
  function advent1(y) {
    var a4 = 24 - dowOf(y, 12, 24), a1 = a4 - 21;
    return a1 > 0 ? { mo: 12, d: a1 } : { mo: 11, d: 30 + a1 };
  }
  // Advent Sundays passed on this day (0-4). Candles from Advent 1 to 26 Dec.
  function adventN(y, mo, d) {
    var a = advent1(y), k = key(mo, d), k1 = key(a.mo, a.d);
    if (k < k1 || k > 1226) return 0;
    var day = (Date.UTC(y, mo - 1, d) - Date.UTC(y, a.mo - 1, a.d)) / 864e5;
    return Math.min(4, 1 + Math.floor(day / 7));
  }
  // Midsummer Eve: the Friday in 19-25 June → day of June
  function midsummerEve(y) { for (var d = 19; d <= 25; d++) if (dowOf(y, 6, d) === 5) return d; return 19; }

  // The season of a moment (ms) → what to show. No weather here (see wxOf); the tap family can grow with the weather.
  function at(ms) {
    var p = parts(ms), k = key(p.mo, p.d), h = p.h, ms0 = midsummerEve(p.y);
    var s = { key: "normal", tap: "normal", dress: "", color: "", glogg: false,
      map: { tree: false, lights: false, advent: 0, lucia: false, fireworks: false, fwStart: 0, fire: false, midsummer: false, autumn: false, spring: false } };
    var M = s.map, xmas = k >= 1201 || k <= 113, ny = (k === 1231 && h >= 18) || (k === 101 && h < 3);
    M.advent = adventN(p.y, p.mo, p.d);
    if (xmas) { s.key = "xmas"; s.tap = "xmas"; s.dress = "santa"; s.color = "xmas"; M.tree = M.lights = true; s.glogg = k >= 1201 && k <= 1226; }
    if (k === 1213) { M.lucia = true; s.key = "lucia"; }
    if (ny) {
      s.key = "newyear"; s.tap = "newyear"; s.dress = "party"; s.color = "newyear"; s.glogg = false;
      if (k === 101) { M.fireworks = true; M.fwStart = ms - ((h * 60 + p.mi) * 60e3) - (new Date(ms).getSeconds() * 1000 + new Date(ms).getMilliseconds()); }
    }
    if (p.mo === 4 || p.mo === 5) { s.key = "spring"; s.tap = "spring"; M.spring = true; }
    if (k === 430) { s.key = "valborg"; s.tap = "valborg"; s.dress = "cap"; s.color = "valborg"; }
    if ((k === 430 && h >= 18) || (k === 501 && h < 1)) M.fire = true;
    if (p.mo === 6 && (p.d === ms0 || p.d === ms0 + 1)) { s.key = "midsummer"; s.tap = "midsummer"; s.dress = "crown"; s.color = "midsummer"; M.midsummer = true; }
    if (p.mo === 10) { s.key = "autumn"; s.tap = "autumn"; s.dress = "leaves"; s.color = "autumn"; M.autumn = true; }
    if (!xmas && !ny && (p.mo <= 3)) s.key = "winter";
    s.p = p;
    return s;
  }

  /* ---------- weather (js/ute.js data) ---------- */
  var SNOW = { 71: 1, 77: 1, 85: 1, 73: 2, 75: 3, 86: 3 };
  var RAIN = { 51: 1, 53: 1, 56: 1, 61: 1, 66: 1, 80: 1, 55: 2, 57: 2, 63: 2, 81: 2, 65: 3, 67: 3, 82: 3, 95: 3, 96: 3, 99: 3 };
  // d = UTE.current().d: { code, cloud, day, sd (snow depth, cm) } → { snow 0-3, rain 0-3, fog, clear, fallen }
  function wxOf(d) {
    var o = { snow: 0, rain: 0, fog: false, clear: false, fallen: false, code: -1 };
    if (!d) return o;
    var c = d.code | 0; o.code = c;
    o.snow = SNOW[c] || 0; o.rain = RAIN[c] || 0; o.fog = c === 45 || c === 48;
    o.clear = (d.cloud | 0) < 30 && !d.day && c <= 3;
    o.fallen = +d.sd > 2;
    return o;
  }
  // the aurora rule: Kp 5+ (4 north of 62°N, 3 north of 65°N), dark, clear
  function auroraOK(kp, lat, wx) { var need = lat >= 65 ? 3 : lat >= 62 ? 4 : 5; return +kp >= need && !!(wx && wx.clear); }

  /* ---------- test hook (test builds only) ---------- */
  function testBuild() {
    try {
      if (W.PN_DEV === true) return true;
      var h = (W.location && W.location.hostname) || "", path = (W.location && W.location.pathname) || "";
      if (/^(localhost|127\.0\.0\.1|\[?::1\]?|192\.168\.[\d.]+|10\.[\d.]+)$/.test(h) || /\/test\//.test(path)) return true;
      var c = W.OLNU_CONFIG || {}; if (c.SUPABASE_URL && String(c.SUPABASE_URL).indexOf(LIVE_REF) < 0) return true;   // the staging config
    } catch (e) {}
    return false;
  }
  var NAMED = { xmas: "2026-12-06T20:00", lucia: "2026-12-13T20:00", newyear: "2026-12-31T21:00", fireworks: "2027-01-01T00:00", valborg: "2027-04-30T21:00",
    spring: "2027-05-12T20:00", midsummer: "2027-06-25T21:00", autumn: "2026-10-16T20:00", winter: "2027-02-12T20:00", normal: "2026-11-20T20:00" };
  // "2026-12-13T20:00" in Stockholm wall time → ms (1-2 h offset found by one correction step)
  function sthlmMs(iso) {
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?$/.exec(String(iso || "")); if (!m) return NaN;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 20), +(m[5] || 0), +(m[6] || 0));
    for (var i = 0; i < 2; i++) { var p = parts(guess), got = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); guess += Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 20), +(m[5] || 0)) - got; }
    return guess;
  }
  var force = { off: 0, wx: null, kp: null, set: false };
  function readQuery() {
    if (!testBuild()) return;
    var q = {}; try { (W.location.search || "").replace(/^\?/, "").split("&").forEach(function (kv) { var a = kv.split("="); if (a[0]) q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ""); }); } catch (e) {}
    var o = {};
    if (q.date) o.date = q.date; else if (q.season && NAMED[q.season]) o.date = NAMED[q.season];
    if (q.wx) o.wx = q.wx;
    if (q.kp) o.kp = +q.kp;
    if (o.date || o.wx || o.kp != null) setForce(o);
  }
  function wxPreset(s) {
    var P = { snow: { code: 73, cloud: 100, day: false, sd: 0 }, snow1: { code: 71, cloud: 100, day: false, sd: 0 }, snow3: { code: 75, cloud: 100, day: false, sd: 6 },
      snowfall: { code: 3, cloud: 90, day: false, sd: 8 }, rain: { code: 61, cloud: 100, day: false, sd: 0 }, rain3: { code: 65, cloud: 100, day: false, sd: 0 },
      fog: { code: 45, cloud: 100, day: false, sd: 0 }, clear: { code: 0, cloud: 5, day: false, sd: 0 }, none: { code: 2, cloud: 60, day: false, sd: 0 } };
    var x = P[String(s).replace(/\+.*/, "")] || null;
    if (x && /\+fallen/.test(s)) x = Object.assign({}, x, { sd: 8 });
    return x;
  }
  function setForce(o) {
    if (!testBuild()) return false;
    if (o.date) { var t = sthlmMs(o.date); if (isFinite(t)) force.off = t - Date.now(); }
    if (o.season && NAMED[o.season] && !o.date) force.off = sthlmMs(NAMED[o.season]) - Date.now();
    if (o.wx !== undefined) force.wx = o.wx ? wxPreset(o.wx) : null;
    if (o.kp !== undefined) force.kp = o.kp;
    force.set = true; check(true);
    return true;
  }

  /* ---------- live state ---------- */
  function now() { return Date.now() + force.off; }
  function wxNow() {
    if (force.wx) return wxOf(force.wx);
    try { var c = W.UTE && W.UTE.current ? W.UTE.current() : null; return wxOf(c && c.d); } catch (e) { return wxOf(null); }
  }
  function kpNow() {
    if (force.kp != null) return force.kp;
    try { var c = JSON.parse(W.localStorage.getItem(KP_KEY) || "null"); return c && Date.now() - c.at < KP_TTL ? c.kp : 0; } catch (e) { return 0; }
  }
  var kpBusy = false;
  // NOAA SWPC Kp, at most once per 3 hours (cache in localStorage), only when the caller says it is dark and clear
  function loadKp() {
    if (force.kp != null || kpBusy || D.hidden || !W.fetch) return;
    try { var c = JSON.parse(W.localStorage.getItem(KP_KEY) || "null"); if (c && Date.now() - c.at < KP_TTL) return; } catch (e) {}
    kpBusy = true;
    W.fetch(KP_URL, { credentials: "omit", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var kp = 0;
      if (j && j.length) { var last = j[j.length - 1]; kp = +(Array.isArray(last) ? last[1] : last.Kp != null ? last.Kp : last.kp_index) || 0; }
      try { W.localStorage.setItem(KP_KEY, JSON.stringify({ at: Date.now(), kp: kp })); } catch (e) {}
      check(true);
    }).catch(function () { try { W.localStorage.setItem(KP_KEY, JSON.stringify({ at: Date.now(), kp: 0 })); } catch (e) {} })
      .then(function () { kpBusy = false; });
  }
  var cur = null, sig = "", subs = [];
  function state() {
    var t = now(), s = at(t), wx = wxNow();
    s.now = t; s.wx = wx; s.kp = kpNow();
    // the weather grows the tap family and the dress (sheet 13: "Normal + snowflake burst when it snows", "Snow cap when it snows")
    s.snowcap = wx.snow > 0;
    s.forced = force.set;
    return s;
  }
  function check(loud) {
    var s = state(), g = [s.key, s.tap, s.dress, s.color, s.glogg, s.snowcap, s.wx.snow, s.wx.rain, s.wx.fog, s.wx.fallen, s.wx.clear, s.kp, s.map.advent, s.map.fireworks, s.map.fire, s.p.h].join("|");
    cur = s;
    if (g !== sig || loud) { sig = g; subs.slice().forEach(function (f) { try { f(s); } catch (e) {} }); try { D.dispatchEvent(new CustomEvent("pnseason:change", { detail: s })); } catch (e) {} }
    return s;
  }

  /* ---------- switches shared by the season modules ---------- */
  function reduced() { try { return W.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function alive() { try { return W.localStorage.getItem("pn_alive_off") !== "1"; } catch (e) { return true; } }   // "Levande karta" (js/alive.js)
  // the light version for weak phones: little memory, Data Saver, few cores, or ?light=1
  function light() {
    try {
      var n = W.navigator, c = n.connection;
      if (/[?&]light=1(&|$)/.test(W.location.search)) return true;
      if (/[?&]light=0(&|$)/.test(W.location.search) || W.__PN_LIGHT === false) return false;   // pictures / tests: the full version
      return !!((c && c.saveData) || (n.deviceMemory && n.deviceMemory < 4) || (n.hardwareConcurrency && n.hardwareConcurrency < 4));
    } catch (e) { return false; }
  }
  function off() {   // kill switch: PN.CFG.seasons === false or ?seasons=0
    try { if (/[?&]seasons=0(&|$)/.test(W.location.search)) return true; var c = (W.PN && W.PN.CFG) || W.OLNU_CONFIG || {}; return c.seasons === false || c.seasons === 0; } catch (e) { return false; }
  }

  W.PNSeason = {
    now: function () { return cur || check(false); },
    on: function (f) { if (typeof f === "function") subs.push(f); },
    check: function () { return check(false); },
    clock: now,
    loadKp: loadKp, auroraOK: auroraOK,
    reduced: reduced, alive: alive, light: light, off: off, store: function () { return !!W.OLNU_STORE; },
    testBuild: testBuild,
    _force: setForce,
    _at: at, _parts: parts, _advent1: advent1, _adventN: adventN, _midsummerEve: midsummerEve, _wxOf: wxOf, _sthlmMs: sthlmMs
  };
  readQuery();
  check(false);
  // the clock moves on: once a minute (the minute-exact things, e.g. fireworks at 00:00, ask PNSeason.clock() themselves)
  try { W.setInterval(function () { if (!D.hidden) check(false); }, 60000); D.addEventListener("visibilitychange", function () { if (!D.hidden) check(false); }); } catch (e) {}
})();
