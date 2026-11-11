/* PintsNow TEST MODE core (testenv/testenv.js). Loaded FIRST (sync, in <head>) ONLY by the staging test build
   (pintsnow-beta /test/, beta/transform.py --mode staging). Never in docs/ (live) and never in the normal beta.
   1. Own storage: the test build shares the origin tunela.github.io with the beta (live server). The app keeps its
      session in localStorage "olnu.auth", so without this the test build would overwrite the owner's beta account.
      Here localStorage, sessionStorage, IndexedDB names, BroadcastChannel names, Web Lock names and cookies get the
      prefix "pnt<slot>:". ?slot=2 (a new tab) = a second, separate test account on the same device.
      If the browser does not let us swap localStorage, the page STOPS (it never touches the beta keys).
   2. Fake clock (Date / Date.now + an offset), fake position (navigator.geolocation + permissions), fake "no signal".
   3. Registers the signed-in test user with the staging test kit (zz_test_join) so flags / clock / moments work.
   Public: window.PNTEST (used by testenv/testbar.js). */
(function () {
  "use strict";
  var W = window, RD = Date, realLS = null, realSS = null;
  try { realLS = W.localStorage; realSS = W.sessionStorage; } catch (e) {}

  // ---------- slot (one test account per slot; ?slot=N, kept for this tab) ----------
  var slot = "1";
  try {
    var q = /[?&]slot=([1-9])\b/.exec(location.search || "");
    if (q) { slot = q[1]; realSS && realSS.setItem("pnt.slot", slot); }
    else if (realSS && /^[1-9]$/.test(realSS.getItem("pnt.slot") || "")) slot = realSS.getItem("pnt.slot");
  } catch (e) {}
  var PFX = "pnt" + slot + ":";

  function block(why) {
    try {
      document.documentElement.innerHTML = '<body style="font:16px system-ui;background:#0a0f1c;color:#fff;padding:24px">' +
        "<h2>TESTLÄGE kan inte starta</h2><p>" + why + "</p><p>Öppna sidan i Chrome eller Safari (inte i privat läge).</p></body>";
    } catch (e) {}
    throw new Error("PNTEST blocked: " + why);
  }

  // ---------- 1. storage shim ----------
  function shim(real, pfx) {
    function keys() {
      var a = [];
      for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(pfx) === 0) a.push(k.slice(pfx.length)); }
      return a;
    }
    var api = {
      getItem: function (k) { return real.getItem(pfx + k); },
      setItem: function (k, v) { real.setItem(pfx + k, String(v)); },
      removeItem: function (k) { real.removeItem(pfx + k); },
      clear: function () { keys().forEach(function (k) { real.removeItem(pfx + k); }); },
      key: function (i) { var a = keys(); return i >= 0 && i < a.length ? a[i] : null; }
    };
    var own = function (p) { return Object.prototype.hasOwnProperty.call(api, p); };
    return new Proxy(api, {
      get: function (t, p) {
        if (p === "length") return keys().length;
        if (typeof p === "symbol" || own(p)) return t[p];
        var v = real.getItem(pfx + p); return v === null ? undefined : v;
      },
      set: function (t, p, v) { if (typeof p === "symbol" || own(p)) return false; real.setItem(pfx + p, String(v)); return true; },
      deleteProperty: function (t, p) { if (!own(p)) real.removeItem(pfx + p); return true; },
      has: function (t, p) { return own(p) || p === "length" || real.getItem(pfx + String(p)) !== null; },
      ownKeys: function () { return keys(); },
      getOwnPropertyDescriptor: function (t, p) {
        var v = real.getItem(pfx + String(p));
        return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
      }
    });
  }
  if (!realLS) block("Webbläsaren ger ingen lagring (localStorage).");
  var LS = shim(realLS, PFX), SS = realSS ? shim(realSS, PFX) : null;
  try {
    Object.defineProperty(W, "localStorage", { configurable: true, enumerable: true, get: function () { return LS; } });
    if (SS) Object.defineProperty(W, "sessionStorage", { configurable: true, enumerable: true, get: function () { return SS; } });
  } catch (e) {}
  if (W.localStorage !== LS) block("Den här webbläsaren låter inte testläget ha egen lagring, så betans konto skulle skrivas över.");

  try {   // IndexedDB (photo queues), BroadcastChannel + Web Locks (Supabase auth sync between tabs), cookies (handover)
    if (W.indexedDB) {
      var idb = W.indexedDB, o1 = idb.open, o2 = idb.deleteDatabase;
      idb.open = function (n, v) { return v === undefined ? o1.call(idb, PFX + n) : o1.call(idb, PFX + n, v); };
      idb.deleteDatabase = function (n) { return o2.call(idb, PFX + n); };
    }
  } catch (e) {}
  try {
    if (W.BroadcastChannel) {
      var RBC = W.BroadcastChannel;
      var BC = function (name) { return new RBC(PFX + name); };
      BC.prototype = RBC.prototype;
      W.BroadcastChannel = BC;
    }
  } catch (e) {}
  try {
    if (navigator.locks && navigator.locks.request) {
      var lk = navigator.locks, rq = lk.request;
      lk.request = function (name) { var a = Array.prototype.slice.call(arguments); a[0] = PFX + name; return rq.apply(lk, a); };
    }
  } catch (e) {}
  try {
    var cd = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (cd && cd.get && cd.set) {
      var CP = "pnt" + slot + "_";
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () {
          return String(cd.get.call(document) || "").split(/;\s*/).filter(function (c) { return c.indexOf(CP) === 0; })
            .map(function (c) { return c.slice(CP.length); }).join("; ");
        },
        set: function (v) { cd.set.call(document, CP + String(v)); }
      });
    }
  } catch (e) {}

  function jget(k, d) { try { var v = JSON.parse(LS.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { if (v == null) LS.removeItem(k); else LS.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- 2a. fake clock ----------
  var clock = jget("pnt.clock", { off: 0 }), OFF = +clock.off || 0;
  if (OFF) {
    var FD = function () {
      if (!new.target) return new RD(RD.now() + OFF).toString();
      var a = Array.prototype.slice.call(arguments);
      return Reflect.construct(RD, a.length ? a : [RD.now() + OFF], new.target);
    };
    FD.prototype = RD.prototype;
    Object.setPrototypeOf(FD, RD);
    FD.now = function () { return RD.now() + OFF; };
    FD.parse = RD.parse; FD.UTC = RD.UTC;
    try { Object.defineProperty(RD.prototype, "constructor", { value: FD, configurable: true, writable: true }); } catch (e) {}
    W.Date = FD;
  }

  // ---------- 2b. fake position ----------
  var geo = jget("pnt.geo", null), watchers = {}, wn = 0;
  function fakeOn() { return !!(geo && geo.on && isFinite(geo.lat) && isFinite(geo.lng)); }
  function pos() {
    var acc = geo.acc || 12, j = function () { return (Math.random() - 0.5) * 0.00002; };
    return { coords: { latitude: geo.lat + j(), longitude: geo.lng + j(), accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
             timestamp: Date.now() };
  }
  try {
    var G = navigator.geolocation;
    if (G) {
      var rGet = G.getCurrentPosition.bind(G), rWatch = G.watchPosition.bind(G), rClear = G.clearWatch.bind(G);
      G.getCurrentPosition = function (ok, err, o) {
        if (fakeOn()) { setTimeout(function () { try { ok(pos()); } catch (e) {} }, 60); return; }
        return rGet(ok, err, o);
      };
      G.watchPosition = function (ok, err, o) {
        var id = ++wn, w = watchers[id] = { ok: ok, err: err, real: null };
        if (!fakeOn()) {
          try { w.real = rWatch(function (p) { if (!fakeOn()) ok(p); }, function (e) { if (!fakeOn() && err) err(e); }, o); } catch (e) {}
        } else setTimeout(function () { if (watchers[id]) try { ok(pos()); } catch (e) {} }, 60);
        return id;
      };
      G.clearWatch = function (id) { var w = watchers[id]; if (w && w.real != null) try { rClear(w.real); } catch (e) {} delete watchers[id]; };
      setInterval(function () { if (fakeOn()) Object.keys(watchers).forEach(function (id) { try { watchers[id].ok(pos()); } catch (e) {} }); }, 8000);
    }
    if (navigator.permissions && navigator.permissions.query) {
      var pq = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (d) {
        if (d && d.name === "geolocation" && fakeOn()) return Promise.resolve({ state: "granted", name: "geolocation", onchange: null, addEventListener: function () {}, removeEventListener: function () {} });
        return pq(d);
      };
    }
  } catch (e) {}

  // ---------- 2c. fake "no signal" + 3. register the test user ----------
  var nosig = false, token = null, joined = {}, listeners = [];
  try {
    var onl = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    if (onl && onl.get) Object.defineProperty(navigator, "onLine", { configurable: true, get: function () { return nosig ? false : onl.get.call(navigator); } });
  } catch (e) {}
  var rFetch = W.fetch && W.fetch.bind(W);
  function cfg() { return W.OLNU_CONFIG || {}; }
  function isSb(u) { var b = cfg().SUPABASE_URL; return !!(b && String(u).indexOf(b) === 0); }
  if (rFetch) {
    W.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || String(input);
      if (nosig && (isSb(url) || /^https?:/.test(url) && url.indexOf(location.origin) !== 0)) {
        return new Promise(function (res, rej) { setTimeout(function () { rej(new TypeError("Failed to fetch")); }, 300); });
      }
      if (isSb(url)) {
        try {
          var h = (init && init.headers) || (input && input.headers), a = null;
          if (h) a = typeof h.get === "function" ? h.get("Authorization") : (h.Authorization || h.authorization);
          var t = a && /^Bearer (.+)$/.exec(a);
          if (t && t[1] !== cfg().SUPABASE_ANON_KEY && t[1] !== token) { token = t[1]; setTimeout(onToken, 0); }
        } catch (e) {}
      }
      // fixMo N-06: the fake clock moves the app, never the login. The auth server's expires_at is real time, and supabase-js
      // compares it with Date.now() (fake): with the clock > 1 h ahead every call saw an expired token (a refresh ~1/s).
      // So the session's expires_at is shifted by the same offset: the expiry stays consistent with the fake clock, the JWT
      // itself is unchanged (the server checks it in real time). Only /auth/v1/ answers with a session, only while OFF.
      if (OFF && isSb(url) && /\/auth\/v1\//.test(url)) return rFetch(input, init).then(shiftAuth);
      return rFetch(input, init);
    };
  }
  var OFF_S = Math.round(OFF / 1000);
  function shiftAuth(res) {
    try {
      if (!res || !res.ok || !/json/.test(res.headers.get("content-type") || "")) return res;
      return res.clone().json().then(function (j) {
        var sess = j && j.access_token ? j : j && j.session && j.session.access_token ? j.session : null;
        if (!sess || !isFinite(+sess.expires_at)) return res;
        sess.expires_at = +sess.expires_at + OFF_S;
        PNA.shifts++;
        var h = new Headers(res.headers); h.delete("content-length"); h.delete("content-encoding");
        return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: h });
      }, function () { return res; });
    } catch (e) { return res; }
  }
  var PNA = { shifts: 0 };
  // the stored session was written under another offset (a clock jump, or before this fix): shift it by the difference, so the
  // first start after a jump does not see a token that is hours "old" (or hours "young")
  try {
    var st0 = JSON.parse(LS.getItem("olnu.auth") || "null"), was = +(LS.getItem("pnt.authOff") || 0) || 0;
    if (st0 && isFinite(+st0.expires_at) && st0.expires_at > 1 && was !== OFF_S) { st0.expires_at = +st0.expires_at + (OFF_S - was); LS.setItem("olnu.auth", JSON.stringify(st0)); }
    if (was !== OFF_S) { if (OFF_S) LS.setItem("pnt.authOff", String(OFF_S)); else LS.removeItem("pnt.authOff"); }
  } catch (e) {}
  function sub() { try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub; } catch (e) { return null; } }
  function rpc(name, args) {
    if (!token || !rFetch) return Promise.reject(new Error("no_session"));
    return rFetch(cfg().SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST", headers: { apikey: cfg().SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args || {})
    }).then(function (r) { return r.text().then(function (t) { var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; } if (!r.ok) throw d || { message: String(r.status) }; return d; }); });
  }
  function label() { return LS.getItem("pnt.device") || ("Test " + slot); }
  var stateP = null;
  function onToken() {
    var u = sub(); if (!u || joined[u]) return;
    joined[u] = true;
    stateP = rpc("zz_test_join", { p_label: label(), p_bot: false }).then(function (s) { PN.state = s; emit("state", s); return s; },
      function (e) { PN.err = e; emit("state", null); return null; });
    emit("auth", u);
  }
  function emit(k, v) { listeners.slice().forEach(function (f) { try { f(k, v); } catch (e) {} }); }

  var PN = W.PNTEST = {
    slot: slot, prefix: PFX, realLocalStorage: realLS,
    on: function (f) { listeners.push(f); },
    uid: sub, token: function () { return token; }, rpc: rpc, state: null, err: null, auth: PNA,
    ready: function () { return stateP || Promise.resolve(null); },
    label: label,
    setLabel: function (s) { LS.setItem("pnt.device", String(s || "").slice(0, 24)); if (token) rpc("zz_test_join", { p_label: label() }).then(function (st) { PN.state = st; emit("state", st); }, function () {}); },
    clock: { off: function () { return OFF; }, real: function () { return RD.now(); },
      set: function (offMs) { jset("pnt.clock", offMs ? { off: Math.round(offMs) } : null); } },
    geo: { get: function () { return geo; }, on: fakeOn,
      set: function (g) {
        geo = g ? { on: true, lat: +g.lat, lng: +g.lng, acc: +g.acc || 12, name: g.name || "" } : null; jset("pnt.geo", geo);
        if (fakeOn()) Object.keys(watchers).forEach(function (id) { try { watchers[id].ok(pos()); } catch (e) {} });
      } },
    nosig: function (v) {
      if (v === undefined) return nosig;
      nosig = !!v;
      try { W.dispatchEvent(new Event(nosig ? "offline" : "online")); } catch (e) {}
      emit("nosig", nosig);
      return nosig;
    },
    slotUrl: function (n) { var u = new URL(location.href); u.searchParams.set("slot", String(n)); return u.toString(); },
    wipeSlot: function () { LS.clear(); if (SS) SS.clear(); },
    // the auth session refreshes on the next start (after a clock jump the stored expiry would be wrong)
    expireSession: function () {
      try { var s = JSON.parse(LS.getItem("olnu.auth") || "null"); if (s && s.expires_at) { s.expires_at = 1; LS.setItem("olnu.auth", JSON.stringify(s)); } } catch (e) {}
    }
  };
  try { document.documentElement.classList.add("pn-test"); } catch (e) {}
})();
