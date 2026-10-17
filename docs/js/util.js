(function () {
  "use strict";
  var U = {};
  U.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"'`]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c];
    });
  };
  U.ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
    getJSON: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    setJSON: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  U.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  };
  var R = 6371000, rad = Math.PI / 180;
  U.haversine = function (lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  U.timeHM = function (iso) {
    try {
      return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
    } catch (e) {
      var d = new Date(iso); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    }
  };
  // Wall-clock parts in Europe/Stockholm for one instant.
  var sthlmFmt = null;
  function sthlmParts(ms) {
    if (!sthlmFmt) sthlmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    var p = {};
    sthlmFmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  // Stockholm UTC offset (ms) at one instant.
  function sthlmOffset(ms) {
    var p = sthlmParts(ms);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  }
  // Next 05:00 Europe/Stockholm after "from". DST-safe: the offset is taken at the target instant
  // (two passes), not at "from" (2026-10-24 22:00 → 2026-10-25 05:00 CET, not 04:00).
  // Prefer the server's expires_at when there is one (it uses the same rule).
  U.next5am = function (from) {
    from = from || new Date();
    var t0 = from.getTime(), p;
    try { p = sthlmParts(t0); } catch (e) { return new Date(t0 + 6 * 3600e3); }
    var day = Date.UTC(+p.year, +p.month - 1, +p.day + ((+p.hour % 24) >= 5 ? 1 : 0), 5, 0, 0);   // 05:00 wall clock, as if UTC
    var guess = day - sthlmOffset(day);
    guess = day - sthlmOffset(guess);
    return new Date(guess);
  };
  // Total drinks on a pin (owner decision: all drinks count for levels, numbers and sorting).
  U.drinks = function (b) { return b ? Math.max(0, b.beer_count | 0) + Math.max(0, b.other_count | 0) : 0; };
  // A position that any map/server can use (worldwide).
  U.validPos = function (lat, lng) { return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180; };
  U.isIOS = function () {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  };
  U.isStandalone = function () {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  };
  // Streak level: 0 normal, 1 HOT STREAK (5–9), 2 MEDEVAC (10+).
  U.level = function (n) { n = n | 0; return n >= 10 ? 2 : n >= 5 ? 1 : 0; };
  // Client-side fallbacks only. The server's wait_seconds is always the authority.
  U.COOLDOWN_MS = 10 * 60 * 1000;        // beers: 10 min
  U.mmss = function (ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
  U.CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  U.cleanCode = function (s) {
    return String(s || "").toUpperCase().split("").filter(function (c) { return U.CODE_ALPHABET.indexOf(c) >= 0; }).join("").slice(0, 6);
  };
  U.errCode = function (err) {
    var m = (err && (err.message || err.details || err.hint || String(err))) || "";
    var codes = ["outside_sweden", "invalid_name", "group_not_found", "not_authenticated", "invalid_subscription", "code_generation_failed", "own_beer", "beer_not_found",
      "not_member", "invalid_msg", "slow_down", "invalid_emoji", "invalid_kind"];
    for (var i = 0; i < codes.length; i++) if (m.indexOf(codes[i]) >= 0) return codes[i];
    if (/jwt|401|not authenticated/i.test(m)) return "not_authenticated";
    return "error";
  };
  // v9: the RPC does not exist on this (older) database → that feature is off.
  U.missing = function (err) {
    if (!err) return false;
    var m = String((err.code || "") + " " + (err.message || "") + " " + (err.details || "") + " " + (err.hint || ""));
    return /PGRST202|could not find the function|does not exist|\b404\b/i.test(m) || err.status === 404;
  };
  // Hour 0–23 in Europe/Stockholm.
  U.hourSthlm = function (d) {
    d = d || new Date();
    try { return parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(d), 10) % 24; }
    catch (e) { return d.getHours(); }
  };
  U.GLASS_SVG ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h10v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6Z" fill="#fff3d6"/>' +
    '<path d="M16 9h2.2A1.8 1.8 0 0 1 20 10.8v3.4a1.8 1.8 0 0 1-1.8 1.8H16" fill="none" stroke="#fff3d6" stroke-width="2"/>' +
    '<path d="M6 7.5a2.5 2.5 0 0 1 2-4 3 3 0 0 1 4.6-.4A2.6 2.6 0 0 1 16 5.5V8H6Z" fill="#ffffff"/></svg>';
  U.GLASS_OUTLINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h10v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5Z" fill="none" stroke="#f5a623" stroke-width="2.4"/>' +
    '<path d="M16 9h2.2A1.8 1.8 0 0 1 20 10.8v3.4a1.8 1.8 0 0 1-1.8 1.8H16" fill="none" stroke="#f5a623" stroke-width="2.4"/></svg>';
  // Compact count pill used for bar badges, single pins and clusters: "10 🍺".
  // Streak is shown ONLY by the border class: p0 normal (thin amber), p1 HOT STREAK (flame glow), p2 MEDEVAC (red/white pulse).
  // Friend present = green inner ring + green dot. No icon circle inside.
  U.pillHTML = function (n, lvl, o) {
    o = o || {};
    lvl = lvl === 2 ? 2 : lvl === 1 ? 1 : 0;
    var cls = "pill p" + lvl + (o.friend ? " pf" : "") + (o.mine ? " pm" : "") + (o.approx ? " pa" : "") + (o.cls ? " " + o.cls : "");
    n = Math.max(0, n | 0);
    var body = '<span class="pn">' + n + "</span>" + (o.noEmoji ? "" : '<span class="pe" aria-hidden="true">🍺</span>');
    // v9: other drinks (sidospår). "2 🍺 · 1 🥃", or "🥃 1" when there is no beer.
    var oc = Math.max(0, o.other | 0);
    if (oc && !o.noEmoji) {
      body = n > 0 ? body + '<span class="po">· ' + oc + '<span aria-hidden="true">🥃</span></span>'
        : '<span class="pe" aria-hidden="true">🥃</span><span class="pn">' + oc + "</span>";
    }
    return '<div class="' + cls + '">' + body +
      (o.friend ? '<span class="pfd" aria-hidden="true"></span>' : "") +
      (o.label || "") + "</div>";
  };
  window.U = U;
})();
