/* PintsNow — privacy start state for a NEW install (OWNER-INPUTS B3 / PLAN B8, owner default 24 Nov 2026).
   A new user starts with: area position (olnu.prec = "area", never an exact pin), visible to friends and groups only
   (olnu.visMode = "vanner"; the server side is migration 0534 + one set_visibility(true) from js/pnvis.js), and the
   position log off (olnu.logLoc = "0", js/pnlog.js). Existing users keep their settings: a phone that already has any
   app state (age answer, intro, account, name, a night, or one of these settings) is marked "old" and nothing changes.
   Runs once per phone, before the app reads the settings (index.html: right after pn.js).
   PN.privStart = { state() -> "new" | "old", isNew(), needSync(), synced() } (no new window global). */
(function () {
  "use strict";
  var K = "olnu.privStart", SYNC = "olnu.privSync";
  // any of these = the phone was used before this file shipped (or before this run): keep what it has
  var OLD = ["olnu.intro", "olnu.age18", "olnu.auth", "olnu.name", "olnu.night", "olnu.checkin", "olnu.prec",
    "olnu.visMode", "olnu.ghostMode", "olnu.logLoc", "olnu.logEv", "olnu.logCons", "olnu.title"];
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function start() {
    if (get(K)) return get(K);
    var old = false;
    for (var i = 0; i < OLD.length; i++) if (get(OLD[i]) !== null) { old = true; break; }
    if (old) { set(K, "old"); return "old"; }
    set("olnu.prec", "area");     // Bara område: never an exact pin
    set("olnu.logLoc", "0");      // Spara position: av
    set("olnu.visMode", "vanner"); // Bara vänner (friends + groups)
    set(SYNC, "1");               // tell the server once (pnvis.js), for a server without 0534
    set(K, "new");
    return "new";
  }
  var st = start();
  var PN = window.PN = window.PN || {};
  PN.privStart = {
    state: function () { return get(K) || st; },
    isNew: function () { return (get(K) || st) === "new"; },
    needSync: function () { return get(SYNC) === "1"; },
    synced: function () { set(SYNC, null); }
  };
})();
