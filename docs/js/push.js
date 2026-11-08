/* Web push helpers. */
(function () {
  "use strict";
  function urlBase64ToUint8Array(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function bufToB64url(buf) {
    if (!buf) return "";
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function current() {
    if (!supported()) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  function keysOf(sub) {
    var p256dh = "", auth = "";
    try { p256dh = bufToB64url(sub.getKey && sub.getKey("p256dh")); auth = bufToB64url(sub.getKey && sub.getKey("auth")); } catch (e) {}
    if (!p256dh || !auth) {
      var j = sub.toJSON ? sub.toJSON() : {};
      p256dh = p256dh || (j.keys && j.keys.p256dh) || "";
      auth = auth || (j.keys && j.keys.auth) || "";
    }
    return { p256dh: p256dh, auth: auth };
  }
  // Returns "on" | "denied" | "unsupported" | "nokey" ; rejects on other errors.
  function enable(rpc, vapidKey) {
    ntfRpc(rpc, vapidKey);   // ntf v2
    if (!supported()) return Promise.resolve("unsupported");
    if (!vapidKey) return Promise.resolve("nokey");
    var askP = Notification.permission === "granted" ? Promise.resolve("granted") :
      new Promise(function (res) {
        var r = Notification.requestPermission(res);
        if (r && r.then) r.then(res);
      });
    return askP.then(function (perm) {
      if (perm !== "granted") return "denied";
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
        });
      }).then(function (sub) {
        var k = keysOf(sub);
        return rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth })
          .then(function (r) { if (r.error) throw r.error; want("1"); return "on"; });
      });
    });
  }
  // "1" = the user turned notifications on, "0" = the user turned them off. Unset = not known (older version).
  function want(v) { try { if (v != null) localStorage.setItem("olnu.pushWant", v); return localStorage.getItem("olnu.pushWant"); } catch (e) { return null; } }
  function disable(rpc) {
    want("0");
    return current().then(function (sub) {
      if (!sub) return "off";
      var ep = sub.endpoint;
      return sub.unsubscribe().catch(function () {}).then(function () {
        return rpc("delete_push_subscription", { p_endpoint: ep });
      }).then(function () { return "off"; });
    });
  }
  // Re-save an existing subscription for the current (maybe new) anonymous user. Errors ignored.
  // Self-heal: if the subscription is gone (browser dropped it, old "Uppdatera nu" removed the service
  // worker) but permission is still granted and the user did not turn it off, subscribe again silently.
  function resync(rpc, vapidKey) {
    ntfRpc(rpc, vapidKey);   // ntf v2: log drain, faces, Ikväll? answer
    if (!supported() || Notification.permission !== "granted") return Promise.resolve();
    return current().then(function (sub) {
      if (!sub && vapidKey && want() !== "0") {
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
        }).then(function (nsub) {
          var nk = keysOf(nsub);
          return rpc("save_push_subscription", { p_endpoint: nsub.endpoint, p_p256dh: nk.p256dh, p_auth: nk.auth })
            .then(function (r) { if (!r.error) want("1"); });
        });
      }
      if (!sub) return;
      var k = keysOf(sub), stamp = "", uid = "";
      try { uid = localStorage.getItem("olnu.uid") || ""; stamp = uid + "|" + sub.endpoint; } catch (e) {}
      var last = null;
      try { last = JSON.parse(localStorage.getItem("olnu.pushSaved") || "null"); } catch (e) {}
      if (uid && last && last.s === stamp && Date.now() - (last.t || 0) < 12 * 3600e3) return;   // review: same row, saved recently
      return rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth }).then(function (r) {
        if (r && !r.error && uid) { try { localStorage.setItem("olnu.pushSaved", JSON.stringify({ s: stamp, t: Date.now() })); } catch (e) {} }
      });
    }).catch(function () {});
  }
  // Save the approximate area (server rounds to ~1 km) so "KAOS I STAN" pushes reach people nearby.
  // Throttled to once per 6 h per ~1 km cell. Errors ignored (old database without the RPC is fine).
  function setLocation(rpc, lat, lng, force) {
    if (!supported() || Notification.permission !== "granted") return Promise.resolve();
    if (!isFinite(lat) || !isFinite(lng)) return Promise.resolve();
    var cell = Math.round(lat * 100) + "," + Math.round(lng * 100), now = Date.now(), last = {};
    try { last = JSON.parse(localStorage.getItem("olnu.pushLoc") || "{}") || {}; } catch (e) {}
    if (!force && last.c === cell && now - (last.t || 0) < 6 * 3600 * 1000) return Promise.resolve();
    return current().then(function (sub) {
      if (!sub) return;
      return rpc("set_push_location", { p_lat: lat, p_lng: lng }).then(function (r) {
        if (r && !r.error) { try { localStorage.setItem("olnu.pushLoc", JSON.stringify({ c: cell, t: now })); } catch (e) {} }
      });
    }).catch(function () {});
  }
  // ---- v27 🔔 NOTISKOLL ----
  // App icon badge: the service worker counts pushes since the app was last open; clear it when the app is visible.
  function clearBadge() {
    if (document.hidden) return;
    try { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {}); } catch (e) {}
    try { if (window.caches) caches.open("olnu-pending").then(function (cc) { return cc.put("./__badge", new Response("0")); }).catch(function () {}); } catch (e) {}
  }
  document.addEventListener("visibilitychange", clearBadge);
  setTimeout(clearBadge, 1200);
  // Kinds (same as olnu_push_cats). SOS, medevac-koll, Följ mig hem and "letar efter dig" are always on.
  var KINDS = [
    ["ute", "🍺 Vänner går ut", "Första ölen, incheckning, Kom hit, ETA"],
    ["chat", "💬 Gruppchatt", "Samlas i en notis per grupp"],
    ["dm", "🔒 Privata meddelanden", ""],
    ["plan", "📅 Inbjudningar och inkallelser", "Svar, påminnelser, lägesrapport, skåltimmen"],
    ["vanner", "🤝 Vänförfrågningar", ""],
    ["bar", "🏰 Krogtips och övertag", ""],
    ["kaos", "🔥 Kaos i stan", "Max en per kväll"],
    ["kul", "⬆️ Befordringar, helgstreak, film", ""],
    ["film", "📸 Engångskameran", "När gänget börjar fota, och när filmen är framkallad"]   // 0195 (only when the server lists it)
  ];
  var QUIET = [["", "Av"], ["23-8", "23–08"], ["0-9", "00–09"], ["1-10", "01–10"], ["2-11", "02–11"], ["3-12", "03–12"], ["8-17", "08–17 (jobbtid)"]];
  var CAPS = [[0, "4 (standard)"], [5, "5"], [10, "10"], [20, "20"], [99, "Obegränsat"]];   // gw: v28 default 4 per night
  function mk(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function prefsSection(body, rpc, toast) {
    ntfRpc(rpc);   // ntf v2
    var box = mk("div", { class: "push-prefs", hidden: "" });
    body.appendChild(box);
    watchCount(box);   // ux: live "x av y på", "Av" when push is off
    var st = null, saving = null;
    function save() {
      if (!st) return;
      var q = (st.quiet || "").split("-");
      var p = { p_off: st.off, p_quiet_from: q.length === 2 ? +q[0] : null, p_quiet_to: q.length === 2 ? +q[1] : null, p_cap: st.cap };
      saving = rpc("set_push_prefs", p).then(function (r) {
        if (r && r.error) { if (toast) toast("Kunde inte spara notisvalen. Försök igen.", { err: true }); return; }
        try { localStorage.setItem("olnu.pushPrefs", JSON.stringify(st)); } catch (e) {}
      });
    }
    function draw(d) {
      st = { off: (d.off || []).slice(), quiet: d.quiet_from != null && d.quiet_to != null ? d.quiet_from + "-" + d.quiet_to : "", cap: d.cap || 0 };
      box.innerHTML = "";
      box.appendChild(mk("h3", { text: "🔔 Välj notiser" }));
      var hasFilm = Array.isArray(d.cats) && d.cats.indexOf("film") >= 0;   // 0195: own 📸 row, kul without film
      KINDS.forEach(function (k) {
        if (k[0] === "film" && !hasFilm) return;
        var lbl = k[0] === "kul" && hasFilm ? "⬆️ Befordringar och helgstreak" : k[1];
        var on = st.off.indexOf(k[0]) < 0;
        var sw = mk("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": lbl, "data-kind": k[0] });
        var lab = mk("span", {}, [document.createTextNode(lbl)]);
        if (k[2]) lab.appendChild(mk("small", { class: "muted", style: "display:block;font-size:var(--fs-14)", text: k[2] }));
        var row = mk("div", { class: "toggle-row" }, [lab, sw]);
        // ds.js forwards a tap on the row to the switch, so listen on the switch only.
        sw.addEventListener("click", function () {
          var now = sw.getAttribute("aria-checked") !== "true";
          sw.setAttribute("aria-checked", String(now));
          st.off = st.off.filter(function (x) { return x !== k[0]; });
          if (!now) st.off.push(k[0]);
          save();
        });
        box.appendChild(row);
      });
      box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:6px 0 0", text: "🆘 SOS, medevac-koll och Följ mig hem kommer alltid." }));
      var qs = mk("select", { class: "inp", "aria-label": "Nattro", "data-pref": "quiet" });
      QUIET.forEach(function (o) { var op = mk("option", { value: o[0], text: o[1] }); if (o[0] === st.quiet) op.selected = true; qs.appendChild(op); });
      qs.addEventListener("change", function () { st.quiet = qs.value; save(); });
      box.appendChild(mk("h3", { text: "🌙 Nattro" }));
      box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:0 0 6px", text: "Inga notiser de här timmarna (svensk tid). Säkerhetsnotiser kommer ändå." }));
      box.appendChild(qs);
      var cs = mk("select", { class: "inp", "aria-label": "Max per kväll", "data-pref": "cap" });
      CAPS.forEach(function (o) { var op = mk("option", { value: String(o[0]), text: o[1] }); if (o[0] === (st.cap || 0)) op.selected = true; cs.appendChild(op); });
      cs.addEventListener("change", function () { st.cap = +cs.value || 0; save(); });
      box.appendChild(mk("h3", { text: "🍺 Max per kväll" }));
      box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:0 0 6px",
        text: (hasFilm ? "Gäller vänner ute, kaos, krogar, befordringar och engångskameran." : "Gäller vänner ute, kaos, krogar och befordringar.") +
          " Chatt och planer räknas inte." + (d.tonight ? " Ikväll: " + d.tonight + " st." : "") }));
      box.appendChild(cs);
      box.hidden = false;
    }
    rpc("my_push_prefs").then(function (r) {
      if (!r || r.error) return;                               // old database without 0190: no section
      var d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
      if (d && typeof d === "object") { if (v2Cats(d)) drawV2(box, d, rpc, toast, function (p) { saving = p; }); else draw(d); }   // ntf v2
    }).catch(function () {});
    return { box: box, saved: function () { return saving || Promise.resolve(); } };
  }
  // ---- ntf v2 🔔 NOTISER v2 (agent ntf 2026-11-08, migration 0390) ----
  // A. Log: the service worker queues push.shown / push.open / push.action {k kind, v variant, a button} in the Cache API
  //    (it has no PNLOG). drainLog() moves them to PNLOG.event(...) and sends opens to push_seen() (open rate per kind and
  //    hour: auto-mute + send time on the server). Runs when the app is visible and after resync().
  // B. Deep links the main router does not know while the app is open: ?ikvall=1[&st=ute|kanske], ?pickup=<id>, ?hemfard=1.
  //    Cold start: gw.js opens Ikväll? (?ikvall=1); the answer (&st=) is sent here once the session is ready.
  // C. Faces: the group mates' avatars (AVATAR caches) as 96 px PNG data URLs in Cache "olnu-pending" ./__face/<k>, so the
  //    service worker can use the sender's face as the notification icon (payload `face` = the same k). Never a user id.
  // D. prime(): one-line ask after the first group join ("pn:group-joined" event or PUSH.prime()), never on load.
  // E. feedCard(): in-app list of what push did not deliver (my_ntf_feed); auto card when push is off.
  // F. Settings v2 (server with 0390: cats has "gang"): 5 rows + Mer + "Färre notiser".
  var NR = { rpc: null, key: "", pendSt: null, drainAt: 0, faceAt: 0 };
  function ntfRpc(rpc, key) {
    if (typeof rpc === "function") NR.rpc = rpc;
    if (key) NR.key = key;
    if (NR.rpc && NR.pendSt) { var st = NR.pendSt; NR.pendSt = null; ikvAnswer(st); }
    setTimeout(drainLog, 400);
    setTimeout(cacheFaces, 4000);
  }
  function stoHour() {
    try { return +new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()); } catch (e) { return new Date().getHours(); }
  }
  function drainLog() {
    if (!window.caches || document.hidden || Date.now() - NR.drainAt < 1500) return Promise.resolve(0);
    NR.drainAt = Date.now();
    return caches.open("olnu-pending").then(function (cc) {
      return cc.match("./__pnq").then(function (r) { return r ? r.text() : "[]"; }).then(function (t) {
        var q = []; try { q = JSON.parse(t) || []; } catch (e) { q = []; }
        if (!q.length) return 0;
        return cc.put("./__pnq", new Response("[]")).then(function () {
          var seen = [];
          q.forEach(function (x) {
            if (!x || !/^push\.(shown|open|action)$/.test(x.n)) return;
            try { if (window.PNLOG) window.PNLOG.event(x.n, { k: x.k, v: x.v, a: x.a || "" }); } catch (e) {}
            if (x.n !== "push.shown" && x.k) seen.push({ e: x.n === "push.action" ? "action" : "open", k: x.k, h: x.h != null ? x.h : stoHour() });
          });
          if (seen.length && NR.rpc) NR.rpc("push_seen", { p_items: seen.slice(-20) }).catch(function () {});
          return q.length;
        });
      });
    }).catch(function () { return 0; });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { drainLog(); autoFeed(); } });

  /* ---------- B. deep links while the app is open ---------- */
  function W(n) { return window[n] || null; }
  function ikvAnswer(st) {
    if (!/^(ute|kanske)$/.test(st || "")) return;
    if (!NR.rpc) { NR.pendSt = st; return; }
    NR.rpc("ikvall_set", { p_st: st }).then(function (r) {
      if (r && r.error) return;
      try { if (W("PNUI") && W("PNUI").openIkvall) W("PNUI").openIkvall(); } catch (e) {}
    }).catch(function () {});
  }
  // The main router (app.js routeOpen) closes any open sheet first, in the same message event: open ours after it.
  function later(fn) { return new Promise(function (res) { setTimeout(function () { try { res(fn()); } catch (e) { res(null); } }, 120); }); }
  // Returns true when this module handled the url (the main router ignores these params).
  function ntfRoute(url) {
    var q; try { q = new URL(url, location.href).searchParams; } catch (e) { return false; }
    if (q.get("ikvall") === "1") {
      var st = q.get("st");
      if (st) ikvAnswer(st);
      if (!st) later(function () { if (W("PNUI") && W("PNUI").openIkvall) W("PNUI").openIkvall(); });
      return true;
    }
    var pk = q.get("pickup");
    if (pk && /^\d{1,18}$/.test(pk) && W("SKJUTS")) {
      var S = W("SKJUTS");
      later(function () { return S._force ? S._force() : null; }).then(function (P) {
        P = P || (S._poll && S._poll()) || {};
        if (P.mine && String(P.mine.id) === pk) S.hudClick("pk-mine"); else S.hudClick("pk-in:" + pk);
      }).catch(function () {});
      return true;
    }
    var rp = q.get("replay");   // bold §3.7: "▶ Spela" while the app is open (cold start: bold-replay.js reads ?replay=)
    if (rp && /^[0-9a-f-]{36}$/i.test(rp) && W("BOLD_REPLAY") && W("BOLD_REPLAY").start) { later(function () { W("BOLD_REPLAY").start(rp); }); return true; }
    if (q.get("hemfard") === "1" && W("OPPET") && W("OPPET").hemfardSheet) { later(function () { W("OPPET").hemfardSheet(null); }); return true; }
    return false;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type !== "olnu-open" || !d.url) return;
    ntfRoute(d.url);
    setTimeout(drainLog, 300);
  });
  // cold start with ?replay=<gid> (bold "▶ Spela"): start the replay once the bold module is there (max 20 s)
  try {
    var rp0 = new URLSearchParams(location.search).get("replay");
    if (rp0 && /^[0-9a-f-]{36}$/i.test(rp0)) (function wait(n) {
      if (W("BOLD_REPLAY") && W("BOLD_REPLAY").start) { if (!W("BOLD_REPLAY").__ntfStarted) { W("BOLD_REPLAY").__ntfStarted = 1; try { W("BOLD_REPLAY").start(rp0); } catch (e) {} } return; }
      if (n < 40) setTimeout(function () { wait(n + 1); }, 500);
    })(0);
  } catch (e) {}
  // cold start with &st= (the ✅ button on the Ikväll? push opened a new window)
  try { var q0 = new URLSearchParams(location.search); if (q0.get("ikvall") === "1" && q0.get("st")) NR.pendSt = q0.get("st"); } catch (e) {}

  /* ---------- C. faces for the notification icon ---------- */
  function cacheFaces() {
    var AV = W("AVATAR");
    if (!AV || !AV._caches || !AV.svg || !window.caches || Date.now() - NR.faceAt < 10 * 60e3) return Promise.resolve(0);
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return Promise.resolve(0);
    NR.faceAt = Date.now();
    var people = [];
    try { AV._caches().forEach(function (c) { Object.keys(c.byK || {}).forEach(function (k) { var p = c.byK[k]; if (p && p.a && /^[0-9a-f]{12,16}$/.test(k)) people.push({ k: k, a: p.a }); }); }); } catch (e) {}
    if (!people.length) return Promise.resolve(0);
    return caches.open("olnu-pending").then(function (cc) {
      var n = 0;
      return people.slice(0, 80).reduce(function (p, x) {
        return p.then(function () {
          return cc.match("./__face/" + x.k).then(function (hit) {
            if (hit) return;
            return facePng(AV, x.a).then(function (u) { if (u) { n++; return cc.put("./__face/" + x.k, new Response(u)); } });
          });
        });
      }, Promise.resolve()).then(function () { return n; });
    }).catch(function () { return 0; });
  }
  function facePng(AV, spec) {
    return new Promise(function (res) {
      var svg = ""; try { svg = AV.svg(spec, { size: 96 }); } catch (e) { res(null); return; }
      if (!/^<svg/.test(svg)) { res(null); return; }
      if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      var img = new Image(), done = false;
      img.onload = function () {
        try {
          var c = document.createElement("canvas"); c.width = c.height = 96;
          var g = c.getContext("2d"); g.beginPath(); g.arc(48, 48, 48, 0, Math.PI * 2); g.clip(); g.drawImage(img, 0, 0, 96, 96);
          done = true; res(c.toDataURL("image/png"));
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      setTimeout(function () { if (!done) res(null); }, 3000);
    });
  }

  /* ---------- D0. one prompt per session (ux review): notification ask, install card … share this guard ---------- */
  var PNPROMPT = window.PNPROMPT || {
    can: function () { try { return !sessionStorage.getItem("pn.prompted"); } catch (e) { return !PNPROMPT._m; } },
    mark: function (kind) { PNPROMPT._m = kind || "x"; try { sessionStorage.setItem("pn.prompted", kind || "x"); } catch (e) {} }
  };
  window.PNPROMPT = PNPROMPT;
  /* ---------- D. permission priming ---------- */
  var PRIME = "olnu.pushPrime";
  function primeState() { try { return JSON.parse(localStorage.getItem(PRIME) || "{}") || {}; } catch (e) { return {}; } }
  function prime(o) {
    o = o || {};
    if (!supported() || Notification.permission !== "default" || want() === "0") return false;
    var s = primeState();
    if (!o.force && ((s.n || 0) >= 3 || Date.now() < (s.until || 0))) return false;
    if (document.querySelector(".pn-prime")) return false;
    if (!o.force && !PNPROMPT.can()) return false;   // another prompt (install card …) was shown this session
    var rpc = o.rpc || NR.rpc, key = o.key || NR.key || ((window.OLNU_CONFIG || {}).VAPID_PUBLIC_KEY) || "";
    if (!rpc) return false;
    css();
    var g = o.group ? String(o.group).slice(0, 40) : "";
    var box = mk("div", { class: "pn-prime", role: "dialog", "aria-label": "Notiser" }, [
      mk("div", { class: "pn-prime-t", text: "🔔 Vet när " + (g || "gänget") + " drar ut" }),
      mk("div", { class: "pn-prime-s", text: "Max 4 notiser per kväll. Aldrig mitt i natten." })
    ]);
    var yes = mk("button", { type: "button", class: "ds-btn ds-btn-primary", "data-prime": "yes", text: "Slå på" });
    var no = mk("button", { type: "button", class: "ds-btn ds-btn-ghost", "data-prime": "no", text: "Inte nu" });
    box.appendChild(mk("div", { class: "pn-prime-b" }, [no, yes]));
    function close(snooze) {
      s = primeState(); s.n = (s.n || 0) + 1; if (snooze) s.until = Date.now() + 7 * 864e5;
      try { localStorage.setItem(PRIME, JSON.stringify(s)); } catch (e) {}
      box.remove();
      try { if (window.PNLOG) window.PNLOG.event("push.prime", { a: snooze ? "later" : "yes" }); } catch (e) {}
    }
    no.addEventListener("click", function () { close(true); });
    yes.addEventListener("click", function () {
      close(false);
      enable(rpc, key).then(function (r) { if (o.done) o.done(r); }).catch(function () {});
    });
    document.body.appendChild(box);
    PNPROMPT.mark("push");
    try { if (window.PNLOG) window.PNLOG.event("push.prime", { a: "shown" }); } catch (e) {}
    return true;
  }
  document.addEventListener("pn:group-joined", function (e) {
    var d = (e && e.detail) || {};
    setTimeout(function () { prime({ group: d.name || "" }); }, 1200);
  });

  /* ---------- E. in-app feed (what push did not deliver) ---------- */
  function feedCard(container, rpc, o) {
    o = o || {};
    rpc = rpc || NR.rpc;
    if (!rpc || !container) return Promise.resolve(null);
    return rpc("my_ntf_feed").then(function (r) {
      var d = r && r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
      var items = (d && Array.isArray(d.items) ? d.items : []).filter(function (x) { return !o.unseen || !x.seen; });
      if (!items.length) return null;
      css();
      var card = mk("div", { class: "pn-feed", role: "region", "aria-label": "Missade notiser" });
      card.appendChild(mk("div", { class: "pn-feed-h", text: "🔔 Medan du var borta" }));
      items.slice(0, o.max || 5).forEach(function (x) {
        var t = new Date(x.at), hm = isFinite(t) ? ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) : "";
        var row = mk("button", { type: "button", class: "pn-feed-r", "data-url": String(x.url || "/") }, [
          mk("span", { class: "pn-feed-tt", text: String(x.title || "") }),
          mk("span", { class: "pn-feed-sb", text: [String(x.body || ""), hm].filter(Boolean).join(" · ") })
        ]);
        row.addEventListener("click", function () {
          if (o.onOpen) o.onOpen();
          var u = String(x.url || "/");
          if (!ntfRoute(u)) {
            try { navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: new URL(u.charAt(0) === "/" ? "." + u : u, location.href).href } })); } catch (e) {}
          }
          try { if (window.PNLOG) window.PNLOG.event("push.feed", { k: x.kind, a: "open" }); } catch (e) {}
        });
        card.appendChild(row);
      });
      if (items.some(function (x) { return x.why === "nosub"; })) {
        var on = mk("button", { type: "button", class: "ds-btn ds-btn-secondary pn-feed-on", text: "🔔 Slå på notiser" });
        on.addEventListener("click", function () { prime({ force: true, rpc: rpc }); if (o.onOpen) o.onOpen(); });
        if (supported() && Notification.permission === "default") card.appendChild(on);
      }
      container.appendChild(card);
      rpc("ntf_feed_seen").catch(function () {});
      return card;
    }).catch(function () { return null; });
  }
  var FEED_AT = "olnu.feedAt";
  function autoFeed() {
    if (!NR.rpc || document.hidden || document.querySelector(".pn-feed-pop")) return;
    var last = 0; try { last = +localStorage.getItem(FEED_AT) || 0; } catch (e) {}
    if (Date.now() - last < 6 * 3600e3) return;
    current().then(function (sub) {
      if (sub) return;   // push works: nothing to show here
      var pop = mk("div", { class: "pn-feed-pop" });
      var x = mk("button", { type: "button", class: "pn-feed-x", "aria-label": "Stäng", text: "✕" });
      x.addEventListener("click", function () { pop.remove(); });
      pop.appendChild(x);
      return feedCard(pop, NR.rpc, { unseen: true, max: 3, onOpen: function () { pop.remove(); } }).then(function (card) {
        if (!card) return;
        try { localStorage.setItem(FEED_AT, String(Date.now())); } catch (e) {}
        document.body.appendChild(pop);
      });
    }).catch(function () {});
  }
  var cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    var s = document.createElement("style"); s.id = "pn-ntf-css";
    s.textContent = ".pn-prime,.pn-feed-pop{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:1200;" +
      "max-width:460px;margin:0 auto;background:var(--ds-raised,#222e48);color:var(--ds-text,#eef0ec);border:1px solid var(--ds-border-2,rgba(255,255,255,.16));" +
      "border-radius:16px;padding:14px 14px 12px;box-shadow:0 12px 32px rgba(0,0,0,.45);font-family:var(--ds-sans,system-ui)}" +
      ".pn-prime-t{font-weight:700;font-size:var(--ds-fs-16,16px);line-height:1.3}.pn-prime-s{color:var(--ds-muted,#a7b0ac);font-size:var(--ds-fs-14,14px);margin-top:4px}" +
      ".pn-prime-b{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.pn-prime-b .ds-btn{min-height:44px;padding:0 18px}" +
      ".pn-feed{display:flex;flex-direction:column;gap:2px}.pn-feed-h{font-weight:700;font-size:var(--ds-fs-14,14px);color:var(--ds-amber-t,#ffc24d);margin:0 0 6px}" +
      ".pn-feed-r{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:2px;min-height:48px;width:100%;padding:8px 10px;border-radius:10px;" +
      "background:transparent;border:0;color:inherit;font:inherit;cursor:pointer}.pn-feed-r:active,.pn-feed-r:hover{background:var(--ds-card,#19233a)}" +
      ".pn-feed-tt{font-weight:600;font-size:var(--ds-fs-16,16px)}.pn-feed-sb{color:var(--ds-muted,#a7b0ac);font-size:var(--ds-fs-14,14px)}" +
      ".pn-feed-on{margin-top:8px;min-height:44px}.pn-feed-x{position:absolute;top:6px;right:6px;width:44px;height:44px;border:0;background:transparent;color:var(--ds-muted,#a7b0ac);font-size:18px}" +
      ".push-prefs .pn-np-auto{display:block;color:var(--ds-amber-t,#ffc24d);font-size:var(--fs-14,14px)}" +
      ".push-prefs>details.pn-np-more>summary{padding:0 var(--pn-row-px,16px);list-style:none;border-top:1px solid var(--ds-border,rgba(255,255,255,.1))}" +
      ".push-prefs>details.pn-np-more>summary::-webkit-details-marker{display:none}.push-prefs>details.pn-np-more>summary::after{content:' ›';}" +
      ".push-prefs>details.pn-np-more>.toggle-row{padding:var(--pn-row-py,10px) var(--pn-row-px,16px);border-top:1px solid var(--ds-border,rgba(255,255,255,.1))}";
    document.head.appendChild(s);
  }

  /* ---------- G. the "Välj notiser" row counter (ux review): live, and "Av" when push itself is off ---------- */
  function countText(box) {
    var sw = box.querySelectorAll(".switch[data-kind]"), on = [].filter.call(sw, function (x) { return x.getAttribute("aria-checked") === "true"; }).length;
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var home = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    if (ios && !home) return Promise.resolve("Av – kräver att appen läggs på hemskärmen");   // ux: iPhone Safari has no web push
    if (!supported() || Notification.permission !== "granted" || want() === "0") return Promise.resolve("Av");
    var t = new Promise(function (res) { setTimeout(function () { res(undefined); }, 1500); });
    return Promise.race([current(), t]).then(function (sub) {
      return sub === null ? "Av" : on + " av " + sw.length + " på";   // undefined (slow) = trust the permission
    });
  }
  function watchCount(box) {
    var host = document.getElementById("sheet-body") || document.body, t = 0;
    function apply() {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!box.isConnected) return;
        var n = (box.closest("#sheet-body") || document).querySelector(".pn-fold-n");
        if (!n || !box.querySelector(".switch[data-kind]")) return;
        countText(box).then(function (x) { if (n.textContent !== x) n.textContent = x; });
      }, 80);
    }
    var mo = new MutationObserver(function () { if (!box.isConnected) { mo.disconnect(); return; } apply(); });
    mo.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-checked"] });
    if (!host.__pnCount) {
      host.__pnCount = true;
      host.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".switch")) setTimeout(function () { var b = host.querySelector(".push-prefs"); if (b && b.__apply) b.__apply(); }, 1500);
      });
    }
    box.__apply = apply;
    apply();
  }

  /* ---------- F. settings v2: 5 rows + Mer + Färre notiser ---------- */
  var ROWS2 = [
    ["ute", "🍺 Vänner ute", "När en vän drar ut eller checkar in. En notis per kväll som uppdateras.", ["ute"]],
    ["ikvall", "🌙 Ikväll?", "Fre och lör, när minst två i gänget ska ut. Max en i veckan.", ["ikvall"]],
    ["film", "📸 Bilder", "När gänget börjar fota och när filmen är framkallad.", ["film"]],
    ["plan", "📅 Event och planer", "Inbjudningar, påminnelse en timme innan, skjuts och stängning.", ["plan"]],
    ["gang", "👥 Gänget", "Helger i rad, krogar ni tar över och befordringar.", ["gang", "kul", "bar"]]
  ];
  var MORE2 = [
    ["chat", "💬 Meddelanden", "Gruppchatt och privata. Samlas i en notis.", ["chat", "dm"]],
    ["vanner", "🤝 Vänförfrågningar", "", ["vanner"]],
    ["kaos", "🔥 Kaos i stan", "Max en per kväll.", ["kaos"]]
  ];
  function v2Cats(d) { return d && Array.isArray(d.cats) && d.cats.indexOf("gang") >= 0; }
  function drawV2(box, d, rpc, toast, onSaved) {
    var st = { off: (d.off || []).slice(), quiet: d.quiet_from != null && d.quiet_to != null ? d.quiet_from + "-" + d.quiet_to : "", cap: d.cap || 0,
      mode: d.mode === "farre" ? "farre" : "normal" };
    var auto = Array.isArray(d.auto_muted) ? d.auto_muted : [];
    function save() {
      var q = (st.quiet || "").split("-");
      var p = rpc("set_push_prefs", { p_off: st.off, p_quiet_from: q.length === 2 ? +q[0] : null, p_quiet_to: q.length === 2 ? +q[1] : null, p_cap: st.cap }).then(function (r) {
        if (r && r.error) { if (toast) toast("Kunde inte spara notisvalen. Försök igen.", { err: true }); return; }
        try { localStorage.setItem("olnu.pushPrefs", JSON.stringify(st)); } catch (e) {}
      });
      onSaved(p);
      return p;
    }
    function saveMode() { onSaved(rpc("set_push_mode", { p_mode: st.mode }).then(function (r) { if (r && r.error && toast) toast("Kunde inte spara. Försök igen.", { err: true }); })); }
    function row(k) {
      var on = k[3].every(function (c) { return st.off.indexOf(c) < 0; });
      var paused = on && k[3].some(function (c) { return auto.indexOf(c) >= 0; });
      var sw = mk("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on && !paused), "aria-label": k[1], "data-kind": k[0], "data-cats": k[3].join(",") });
      var lab = mk("span", {}, [document.createTextNode(k[1])]);
      if (k[2]) lab.appendChild(mk("small", { class: "muted", style: "display:block;font-size:var(--fs-14)", text: k[2] }));
      if (paused) lab.appendChild(mk("small", { class: "pn-np-auto", text: "Pausad: du öppnade dem aldrig. Slå på igen?" }));
      sw.addEventListener("click", function () {
        var now = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", String(now));
        st.off = st.off.filter(function (x) { return k[3].indexOf(x) < 0; });
        if (!now) st.off = st.off.concat(k[3]);
        save();
        if (now && paused) { saveMode(); auto = auto.filter(function (c) { return k[3].indexOf(c) < 0; }); var a = lab.querySelector(".pn-np-auto"); if (a) a.remove(); }
      });
      return mk("div", { class: "toggle-row" }, [lab, sw]);
    }
    box.innerHTML = "";
    box.classList.add("push-prefs-v2");
    var few = mk("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(st.mode === "farre"), "aria-label": "Färre notiser", "data-pref": "farre" });
    var fewLab = mk("span", {}, [document.createTextNode("🔕 Färre notiser"),
      mk("small", { class: "muted", style: "display:block;font-size:var(--fs-14)", text: "Max 2 per kväll. Bara vänner ute, Ikväll?, event och bilder." })]);
    few.addEventListener("click", function () {
      var now = few.getAttribute("aria-checked") !== "true";
      few.setAttribute("aria-checked", String(now));
      st.mode = now ? "farre" : "normal"; saveMode();
      if (toast) toast(now ? "🔕 Färre notiser: max 2 per kväll." : "🔔 Vanliga notiser igen.");
    });
    box.appendChild(mk("h3", { text: "🔔 Välj notiser" }));
    box.appendChild(mk("div", { class: "toggle-row" }, [fewLab, few]));
    ROWS2.forEach(function (k) { box.appendChild(row(k)); });
    var more = mk("details", { class: "pn-np-more" }, [mk("summary", { class: "muted", style: "min-height:44px;display:flex;align-items:center;cursor:pointer", text: "Mer: meddelanden, vänförfrågningar, kaos" })]);
    MORE2.forEach(function (k) { more.appendChild(row(k)); });
    box.appendChild(more);
    box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:6px 0 0", text: "🆘 SOS, Hämta mig, medevac-koll och Följ mig hem kommer alltid." }));
    var qs = mk("select", { class: "inp", "aria-label": "Nattro", "data-pref": "quiet" });
    QUIET.forEach(function (o) { var op = mk("option", { value: o[0], text: o[1] }); if (o[0] === st.quiet) op.selected = true; qs.appendChild(op); });
    qs.addEventListener("change", function () { st.quiet = qs.value; save(); });
    box.appendChild(mk("h3", { text: "🌙 Nattro" }));
    box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:0 0 6px", text: "Inga notiser de här timmarna (svensk tid). Säkerhetsnotiser kommer ändå." }));
    box.appendChild(qs);
    var cs = mk("select", { class: "inp", "aria-label": "Max per kväll", "data-pref": "cap" });
    CAPS.forEach(function (o) { var op = mk("option", { value: String(o[0]), text: o[1] }); if (o[0] === (st.cap || 0)) op.selected = true; cs.appendChild(op); });
    cs.addEventListener("change", function () { st.cap = +cs.value || 0; save(); });
    box.appendChild(mk("h3", { text: "🍺 Max per kväll" }));
    box.appendChild(mk("p", { class: "muted", style: "font-size:var(--fs-14);margin:0 0 6px",
      text: "Gäller vänner ute, Ikväll?, bilder och gänget. Chatt och planer räknas inte. Den sista platsen sparas till det viktigaste." + (d.tonight ? " Ikväll: " + d.tonight + " st." : "") }));
    box.appendChild(cs);
    box.hidden = false;
    css();
  }
  window.PUSH = { supported: supported, current: current, enable: enable, disable: disable, resync: resync, want: want, setLocation: setLocation, urlBase64ToUint8Array: urlBase64ToUint8Array,
    prefsSection: prefsSection, clearBadge: clearBadge,
    prime: prime, feedCard: feedCard, drainLog: drainLog, cacheFaces: cacheFaces, route: ntfRoute };   // ntf v2
})();
