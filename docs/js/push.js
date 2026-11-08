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
  var CAPS = [[5, "5"], [10, "10"], [0, "15 (standard)"], [20, "20"], [99, "Obegränsat"]];
  function mk(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function prefsSection(body, rpc, toast) {
    var box = mk("div", { class: "push-prefs", hidden: "" });
    body.appendChild(box);
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
        if (k[2]) lab.appendChild(mk("small", { class: "muted", style: "display:block;font-size:13px", text: k[2] }));
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
      box.appendChild(mk("p", { class: "muted", style: "font-size:13px;margin:6px 0 0", text: "🆘 SOS, medevac-koll och Följ mig hem kommer alltid." }));
      var qs = mk("select", { class: "inp", "aria-label": "Nattro", "data-pref": "quiet" });
      QUIET.forEach(function (o) { var op = mk("option", { value: o[0], text: o[1] }); if (o[0] === st.quiet) op.selected = true; qs.appendChild(op); });
      qs.addEventListener("change", function () { st.quiet = qs.value; save(); });
      box.appendChild(mk("h3", { text: "🌙 Nattro" }));
      box.appendChild(mk("p", { class: "muted", style: "font-size:13px;margin:0 0 6px", text: "Inga notiser de här timmarna (svensk tid). Säkerhetsnotiser kommer ändå." }));
      box.appendChild(qs);
      var cs = mk("select", { class: "inp", "aria-label": "Max per kväll", "data-pref": "cap" });
      CAPS.forEach(function (o) { var op = mk("option", { value: String(o[0]), text: o[1] }); if (o[0] === (st.cap || 0)) op.selected = true; cs.appendChild(op); });
      cs.addEventListener("change", function () { st.cap = +cs.value || 0; save(); });
      box.appendChild(mk("h3", { text: "🍺 Max per kväll" }));
      box.appendChild(mk("p", { class: "muted", style: "font-size:13px;margin:0 0 6px",
        text: (hasFilm ? "Gäller vänner ute, kaos, krogar, befordringar och engångskameran." : "Gäller vänner ute, kaos, krogar och befordringar.") +
          " Chatt och planer räknas inte." + (d.tonight ? " Ikväll: " + d.tonight + " st." : "") }));
      box.appendChild(cs);
      box.hidden = false;
    }
    rpc("my_push_prefs").then(function (r) {
      if (!r || r.error) return;                               // old database without 0190: no section
      var d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
      if (d && typeof d === "object") draw(d);
    }).catch(function () {});
    return { box: box, saved: function () { return saving || Promise.resolve(); } };
  }
  window.PUSH = { supported: supported, current: current, enable: enable, disable: disable, resync: resync, want: want, setLocation: setLocation, urlBase64ToUint8Array: urlBase64ToUint8Array,
    prefsSection: prefsSection, clearBadge: clearBadge };
})();
