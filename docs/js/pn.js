/* PintsNow namespace + module hook order (A2). Loads right after config.js, before every module. */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  // The hook order that app.js mods() had on 12 Nov 2026. FROZEN: never edit, never re-order. 85 names.
  var BASE = [
  "DIALEKT", "SOCIAL", "CALM", "EXTRAS", "GONE", "PLACEPINS", "RALLY", "BARSPLUS", "PRIVACY", "GAMES", "AFTER",
  "BOARDS", "DELIGHT", "GANG", "PHOTO", "CREW", "CHIEF", "DUEL", "WISH", "HOMETOWN", "CEREMONY", "HELG", "PASSPORT",
  "KODEN", "MERITER", "FORFEST", "PARTY", "SPEL", "NEAR", "EVENTS", "GOLDEN", "DELIGHT_MORE", "SKAL", "FILM",
  "GPAGE", "CARDS", "MAPMENU", "HOMEZONE", "EVCHAT", "JOIN", "INVITE", "INBOX", "SUGGEST", "DM", "FRIENDS2",
  "EVLINK", "BASEMAP", "BARLIT", "SPORT", "EVSHEET", "BAREA", "ARENAPIN", "MAP3D", "RUNDAN", "OPPET", "BARINFO",
  "UTE", "BARFOTO", "HEMFOLJ", "SKJUTS", "HITTA", "ACCOUNT", "PROFIL", "AVATAR", "AVWIZ", "AVPINS", "MYPINS",
  "VITALS", "SHEETNAV", "UXFIX", "EVGROUP", "NIGHTLOG", "PNMOVE", "ZONES", "SPEED", "PNUI", "PNDS", "NEARPLACES",
  "KANAL", "WARM", "AUTOCI", "PINFOLJ", "GW", "PNLOG", "BOLD"
  ];
  var extra = [];
  // A NEW module: one line after its window.NAME = ...   ->   if (window.PN) PN.mod("NAME");
  PN.mod = function (name) { if (BASE.indexOf(name) < 0 && extra.indexOf(name) < 0) extra.push(name); };
  PN.hookNames = function () { return BASE.concat(extra); };
  // Same as the old literal list: window[name] is read at EVERY call (late modules; FILM and PNLOG are set by 2 files).
  // A missing module gives undefined, like before. mods() skips it.
  PN.hookList = function () { var out = [], n = BASE.concat(extra); for (var i = 0; i < n.length; i++) out.push(window[n[i]]); return out; };
  // Names that PN.put (app-core.js) must never overwrite: they belong to pn.js (mod, hookNames, hookList, reserved, putBad),
  // boot.js (load) or app-core.js (s, put, link). putBad(name) is called by PN.put for such a name:
  // dev/test (localhost, private LAN, or window.PN_DEV = true) throws; prod logs console.error and PN.put skips the name.
  PN.reserved = ["mod", "hookNames", "hookList", "reserved", "putBad", "s", "put", "link", "load"];
  PN.putBad = function (name) {
    var msg = "PN.put: reserved name '" + name + "' (rename the export)";
    var h = (window.location && window.location.hostname) || "";
    if (window.PN_DEV === true || /^(localhost|127\.0\.0\.1|\[?::1\]?|192\.168\.[\d.]+|10\.[\d.]+)$/.test(h)) throw new Error(msg);
    if (window.console && console.error) console.error(msg);
  };
})();
