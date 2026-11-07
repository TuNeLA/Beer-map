/* PintsNow — 🚚 address move (handover). CONTRACT "PINTSNOW MOVE", migration 0175.
   localStorage (the anonymous account) belongs to ONE origin. The app moves from https://tunela.github.io/Beer-map/docs/
   to https://pintsnow.com (OLNU_CONFIG.APP_ORIGIN). This file loads right after config.js, before app.js.

   NEW origin (location.origin === APP_ORIGIN):
   - bounce: first start in a browser tab with no account → once to BRIDGE_URL (old origin, TuNeLA/tunela.github.io repo).
     That page reads the old account and comes back with #pn=<secret> (or #flytt=<code> as a fallback, or #bridge=none).
     Never in a home-screen app (iOS: other storage, and leaving the scope opens Safari), never twice (olnu.bridgeTried).
   - boot(api) (called by app.js flyttBoot, before anonymous sign-in): #pn=<secret> in the URL, or the pn_ho cookie that iOS
     copies from Safari into a new home-screen app → handover_take → AES-GCM decrypt → app.js importFlytt (same user id).
   - homeCookie(): iPhone Safari "Gör klart för hemskärmen" also makes a ticket in a first-party cookie (iOS 17+ copies
     cookies, not localStorage, into the new home-screen app). The clipboard flyttkod stays as the fallback.
   OLD origin: listens for the service worker message "olnu-moved" (sw.js saw GitHub redirect the app to the new origin)
     → reload, so the service worker shows flytta.html (the in-app move page) instead of the old app.
   Secret = 32 random bytes: id = first 16 (server keeps sha256), AES key = last 16 (never sent to the server).
   Public: window.HANDOVER = { boot, homeCookie, mint, take, pending, isNew }. */
(function () {
  "use strict";
  var c = window.OLNU_CONFIG || {};
  var APP = String(c.APP_ORIGIN || "").replace(/\/+$/, ""), BRIDGE = String(c.BRIDGE_URL || "");
  var isNew = !!APP && location.origin === APP;
  var SEARCH0 = String(location.search || "");   // before app.js strips deep links (?join= …): kept through the import reload
  c.__SB = c.SUPABASE_URL;   // the guards below may blank SUPABASE_URL (app.js then makes no account); REST keeps the real one
  var ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }
  function g(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function s(k, v) { try { if (ls) ls.setItem(k, v); } catch (e) {} }
  function standalone() {
    try { return window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); } catch (e) { return false; }
  }
  function hasAccount() { var a = g("olnu.auth"); return !!(a && a.indexOf("refresh_token") >= 0); }
  var SEC_RE = /^[A-Za-z0-9_-]{43}$/;
  function cookieSecret() {
    try { var m = String(document.cookie || "").match(/(?:^|;\s*)pn_ho=([A-Za-z0-9_-]{43})(?:;|$)/); return m ? m[1] : null; } catch (e) { return null; }
  }
  function hashSecret() { var m = String(location.hash || "").match(/[#&]pn=([A-Za-z0-9_-]{43})(?=&|$)/); return m ? m[1] : null; }
  function pending() {
    var h = hashSecret(); if (h) return { secret: h, from: "url" };
    var k = cookieSecret(); if (k && k !== g("olnu.hoOwn")) return { secret: k, from: "cookie" };
    return null;
  }
  function clearCookie() { try { document.cookie = "pn_ho=; Max-Age=0; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) {} }
  function stripHash() {
    try {
      var h = String(location.hash || "").replace(/[#&]pn=[A-Za-z0-9_-]*/, "");
      if (h === "#" || h === "&") h = ""; else if (h && h.charAt(0) !== "#") h = "#" + h.replace(/^&/, "");
      history.replaceState(history.state, "", location.pathname + location.search + h);
    } catch (e) {}
  }

  /* ---------- 0. The new address over plain http (GitHub before "Enforce HTTPS") ---------- */
  // No secure context = no service worker, no WebCrypto, other storage. Never make a throwaway account there:
  // the app runs without the server, and goes to https as soon as the certificate works.
  try {
    if (/^https:/.test(APP) && location.protocol === "http:" && location.hostname === new URL(APP).hostname) {
      c.SUPABASE_URL = "";
      fetch(APP + "/manifest.webmanifest", { mode: "no-cors", cache: "no-store" }).then(function () {
        location.replace(APP + location.pathname + location.search + location.hash);
      }, function () {});
    }
  } catch (e) {}

  /* ---------- 1. Bounce (new origin, first start, no account) ---------- */
  if (isNew && BRIDGE && ls) {
    try {
      var hh = String(location.hash || ""), qq = String(location.search || "");
      if (/[#&]bridge=/.test(hh)) {
        s("olnu.bridgeTried", String(Date.now()));
        history.replaceState(null, "", location.pathname + qq + hh.replace(/[#&]bridge=[a-z]*/, "").replace(/^#$/, ""));
      } else if (/[?#&](flytt|pn)=/.test(qq + hh) || cookieSecret()) {
        s("olnu.bridgeTried", String(Date.now()));              // a code is here: app.js imports it
      } else if (!hasAccount() && !g("olnu.bridgeTried") && !standalone() && !/bot|crawl|spider|preview/i.test(navigator.userAgent || "")) {
        s("olnu.bridgeTried", String(Date.now()));
        c.SUPABASE_URL = "";                                     // keep app.js from making a throwaway account before we leave
        location.replace(BRIDGE + "?to=" + encodeURIComponent(location.href.split("#")[0]));
      }
    } catch (e) { /* storage blocked: the app starts as normal */ }
  }

  /* ---------- 2. Old origin: the service worker saw the move ---------- */
  // sw.js marks the move (cache "olnu-pending" ./__moved) and posts "olnu-moved". A reload then gets flytta.html.
  // The mark is also checked directly (a message can come before this page listens). Max 2 reloads per minute.
  if (!isNew && APP && "serviceWorker" in navigator) {
    var reloadOnce = function () {
      try {
        var n = JSON.parse(sessionStorage.getItem("olnu.movedReload") || "[]").filter(function (t) { return Date.now() - t < 60000; });
        if (n.length >= 2) return;
        n.push(Date.now()); sessionStorage.setItem("olnu.movedReload", JSON.stringify(n));
      } catch (x) {}
      try { location.reload(); } catch (x) {}
    };
    var checkMark = function () {
      try {
        if (!navigator.serviceWorker.controller || !window.caches) return;
        caches.open("olnu-pending").then(function (cc) { return cc.match("./__moved"); }).then(function (r) { if (r) reloadOnce(); }, function () {});
      } catch (x) {}
    };
    try {
      navigator.serviceWorker.addEventListener("message", function (e) { if (e && e.data && e.data.type === "olnu-moved") reloadOnce(); });
      [2500, 7000, 15000].forEach(function (ms) { setTimeout(checkMark, ms); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(checkMark, 1500); });
    } catch (e) {}
  }

  /* ---------- crypto + REST ---------- */
  function b64(bytes) {
    var str = ""; for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(t) {
    t = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
    var raw = atob(t), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function subtle() { return window.crypto && window.crypto.subtle && window.crypto.getRandomValues ? window.crypto.subtle : null; }
  function rest(fn, body, bearer) {
    if (!c.SUPABASE_URL && !c.__SB) return Promise.reject({ code: "net" });
    var url = String(c.__SB || c.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/rpc/" + fn;
    var ac = typeof AbortController === "function" ? new AbortController() : null;
    var tm = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} }, 12000);
    return fetch(url, { method: "POST", signal: ac ? ac.signal : undefined, headers: { "Content-Type": "application/json", apikey: c.SUPABASE_ANON_KEY, Authorization: "Bearer " + (bearer || c.SUPABASE_ANON_KEY) }, body: JSON.stringify(body) })
      .then(function (r) {
        clearTimeout(tm);
        return r.text().then(function (txt) {
          var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
          if (!r.ok) throw { code: /handover_gone/.test(txt) ? "gone" : r.status >= 500 ? "net" : "bad", status: r.status };
          return j;
        });
      }, function () { clearTimeout(tm); throw { code: "net" }; });
  }
  // payload → secret (string). auth = the session object from olnu.auth (needs a valid access token).
  function mint(payload, auth, src) {
    var sub = subtle();
    if (!sub || !auth || !auth.access_token) return Promise.reject({ code: "bad" });
    var sec = window.crypto.getRandomValues(new Uint8Array(32)), iv = window.crypto.getRandomValues(new Uint8Array(12));
    var id = b64(sec.slice(0, 16));
    return sub.importKey("raw", sec.slice(16), { name: "AES-GCM" }, false, ["encrypt"]).then(function (key) {
      return sub.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    }).then(function (ct) {
      var box = new Uint8Array(12 + ct.byteLength); box.set(iv, 0); box.set(new Uint8Array(ct), 12);
      return rest("handover_put", { p_id: id, p_box: b64(box), p_src: src || "" }, auth.access_token);
    }).then(function () { return b64(sec); });
  }
  // secret → {payload, u, id}. Rejects {code: "gone" | "net" | "bad"}.
  function take(secret) {
    var sub = subtle();
    if (!sub || !SEC_RE.test(String(secret || ""))) return Promise.reject({ code: "bad" });
    var sec = unb64(secret), id = b64(sec.slice(0, 16)), u = null;
    return rest("handover_take", { p_id: id }).then(function (r) {
      if (!r || !r.box) throw { code: "gone" };
      u = String(r.u || "");
      var box = unb64(r.box);
      return sub.importKey("raw", sec.slice(16), { name: "AES-GCM" }, false, ["decrypt"]).then(function (key) {
        return sub.decrypt({ name: "AES-GCM", iv: box.slice(0, 12) }, key, box.slice(12));
      });
    }).then(function (plain) {
      var p = JSON.parse(new TextDecoder().decode(plain));
      if (!p || p.v !== 1 || typeof p.rt !== "string" || p.rt.length < 6 || p.rt.length > 600 || (p.u && String(p.u) !== u)) throw { code: "bad" };
      return { payload: p, u: u, id: id };
    }, function (e) { throw e && e.code ? e : { code: "bad" }; });
  }

  /* ---------- 3. New origin boot (called by app.js flyttBoot) ---------- */
  // api: { importFlytt(p) → "ok"|"same"|"tried"|"bad"|"net", storedUid(), rpc(name, params), reload(p), toast(msg, opts) }
  function boot(api) {
    var ho = pending();
    if (!ho || !api || !api.importFlytt) return Promise.resolve();
    var strip = function () { if (ho.from === "url") stripHash(); else clearCookie(); };
    var toast = function (m, o) { try { api.toast(m, o); } catch (e) {} };
    return take(ho.secret).then(function (r) {
      if (api.storedUid() && api.storedUid() === r.u) { strip(); return; }
      return api.importFlytt(r.payload).then(function (res) {
        if (res === "ok") {
          strip(); clearCookie();
          var p = r.payload;
          try {
            s("olnu.movedIn", JSON.stringify({ at: Date.now(), src: String(p.src || ho.from), sa: p.sa ? 1 : 0, os: String(p.os || ""), via: ho.from }));
            if (p.pe && /^https:\/\//.test(p.pe)) s("olnu.oldPush", String(p.pe));
          } catch (e) {}
          var done = Promise.race([Promise.resolve(api.rpc("handover_done", { p_id: r.id })).catch(function () {}), new Promise(function (ok) { setTimeout(ok, 3000); })]);
          return done.then(function () {
            // Like app.js reloadAfterImport, but keep the original deep link (?join= / ?ev= …) for after the reload.
            try { sessionStorage.setItem("olnu.flyttOk", (p.name && String(p.name).slice(0, 40)) || "-"); } catch (e) {}
            var q = SEARCH0.replace(/([?&])(flytt|pn)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
            try { location.replace(location.pathname + q + String(location.hash || "").replace(/[#&]pn=[A-Za-z0-9_-]*/, "").replace(/^#$/, "")); }
            catch (e) { api.reload(p); }
            return new Promise(function () {});   // page reloads
          });
        }
        strip();
        if (res === "net") toast("📶 Kunde inte flytta kontot just nu. Öppna länken igen när du har nät.", { err: true, ms: 9000, id: "flytt" });
        else if (res === "bad") toast("🚚 Flyttlänken funkar inte längre. Öppna appen på den gamla adressen och försök igen.", { err: true, ms: 9000, id: "flytt" });
      });
    }, function (e) {
      if (e && e.code === "net") {
        toast("📶 Ingen kontakt. Kontot flyttas när du har nät.", { err: true, ms: 0, id: "flytt", action: { label: "Försök igen", fn: function () { location.reload(); } } });
        return;
      }
      strip();
      if (ho.from === "url") toast("🚚 Flyttlänken har gått ut eller är redan använd.", { err: true, ms: 8000, id: "flytt" });
    });
  }

  /* ---------- 4. iPhone Safari → new home-screen app: ticket in a cookie ---------- */
  // code = the flyttkod app.js just made (prepareExport "home"); auth = olnu.auth object. Best effort, never throws.
  function homeCookie(code, auth) {
    try {
      if (!isNew && !/^https?:/.test(location.protocol)) return Promise.resolve(false);
      var t = String(code || "").replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
      var p = JSON.parse(decodeURIComponent(escape(atob(t))));
      if (!auth || !auth.expires_at || auth.expires_at * 1000 - Date.now() < 90000) return Promise.resolve(false);
      p.src = "home"; p.sa = 0; p.os = "ios";
      var once = function () { return mint(p, auth, "home"); };
      return once().catch(function () { return new Promise(function (ok) { setTimeout(ok, 2000); }).then(once); }).then(function (sec) {
        s("olnu.hoOwn", sec);
        document.cookie = "pn_ho=" + sec + "; Max-Age=1800; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
        return true;
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  window.HANDOVER = { boot: boot, homeCookie: homeCookie, mint: mint, take: take, pending: pending, isNew: function () { return isNew; }, app: APP };
})();
