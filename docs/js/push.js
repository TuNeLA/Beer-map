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
  window.PUSH = { supported: supported, current: current, enable: enable, disable: disable, resync: resync, want: want, setLocation: setLocation, urlBase64ToUint8Array: urlBase64ToUint8Array };
})();
