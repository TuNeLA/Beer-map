/* Öl Nu — domain move bridge (new address side). OFF unless docs/config.js has APP_ORIGIN and BRIDGE_URL
   (10-domain-switch.py sets them) AND this page runs on APP_ORIGIN.
   localStorage belongs to one origin, so after the move to an own domain the old anonymous account stays at
   https://tunela.github.io. On the FIRST start at the new address with no account, this file sends the browser
   once to the bridge page on the old origin (TuNeLA/tunela.github.io repo, olnu-flytt.html). The bridge reads the
   old account, makes a normal flyttkod and comes back with #flytt=<code> (or #bridge=none). app.js then imports
   the code with its existing flytt flow (importFlytt). Must load right after config.js, before app.js. */
(function () {
  "use strict";
  var c = window.OLNU_CONFIG || {};
  if (!c.APP_ORIGIN || !c.BRIDGE_URL || location.origin !== c.APP_ORIGIN) return;
  try {
    var ls = window.localStorage;
    var q = location.search || "", h = location.hash || "";
    if (/[?#&]flytt=/.test(q + h)) { ls.setItem("olnu.bridgeTried", String(Date.now())); return; }   // a code is here: app.js imports it
    if (/[#&]bridge=/.test(h)) {
      ls.setItem("olnu.bridgeTried", String(Date.now()));
      history.replaceState(null, "", location.pathname + q + h.replace(/[#&]bridge=[a-z]*/, "").replace(/^#$/, ""));
      return;
    }
    var a = ls.getItem("olnu.auth");
    if (a && a.indexOf("refresh_token") >= 0) return;          // this address already has an account
    if (ls.getItem("olnu.bridgeTried")) return;                 // once per browser
    ls.setItem("olnu.bridgeTried", String(Date.now()));
    // Leaving now: keep app.js from making a throwaway anonymous account in the few ms before we go.
    c.SUPABASE_URL = "";
    location.replace(c.BRIDGE_URL + "?to=" + encodeURIComponent(location.href.split("#")[0]));
  } catch (e) { /* storage blocked: the app starts as normal */ }
})();
