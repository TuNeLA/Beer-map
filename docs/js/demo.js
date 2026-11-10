/* PintsNow — 🎞️ VISNINGSLÄGE is GONE (map lane M4, 2026-11-10; owner: "remove the simulated crowd").
   The old file simulated a big night out (fake people at bars in Stockholm, Göteborg, Malmö and 14 towns, fake ticker
   lines). It was client side only: nothing was ever written to the server. This stub keeps the old API so the hooks in
   app.js / gw.js / safety.js stay valid: on() is always false and every hook returns the real value unchanged.
   The server flag public_config().visning (app_public_flags) is ignored. Coordinator: the <script> tag can go from index.html. */
(function () {
  "use strict";
  function same(v) { return v; }
  window.DEMO = {
    removed: true,
    attach: function () {}, on: function () { return false; },
    bars: function () {}, heat: function () {}, total: function () { return 0; }, counter: same,
    cisAt: function () { return []; }, crowd: function (id, agg) { return agg; }, popup: function () { return ""; }, skal: function () { return false; }
  };
  try { localStorage.removeItem("olnu.visning"); localStorage.removeItem("olnu.visning.srv"); } catch (e) {}
})();
