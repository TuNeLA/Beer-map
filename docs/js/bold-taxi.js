/* PintsNow — Hem-läge taxi numbers (agent bold). window.BOLD_TAXI = the VERIFIED rows of js/taxi-data.js (one source of truth,
   bd09): rows with a source (src + url) and not marked unverified. Hem-läge never shows an unchecked number: no verified row
   within 30 km → a map search "taxi" at your position. Before bd09 is merged (old taxi-data.js without sources) the list is
   empty, so Hem-läge shows the map search everywhere. */
(function () {
  "use strict";
  try {
    Object.defineProperty(window, "BOLD_TAXI", { configurable: true, get: function () {
      var d = window.TAXI_DATA, t = d && Array.isArray(d.towns) ? d.towns : [];
      return t.filter(function (x) { return x && x.src && x.url && !x.unverified && /^\+46\d{6,11}$/.test(String(x.tel || "")) && isFinite(x.lat) && isFinite(x.lng); });
    } });
  } catch (e) {}
})();
