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
          .then(function (r) { if (r.error) throw r.error; return "on"; });
      });
    });
  }
  function disable(rpc) {
    return current().then(function (sub) {
      if (!sub) return "off";
      var ep = sub.endpoint;
      return sub.unsubscribe().catch(function () {}).then(function () {
        return rpc("delete_push_subscription", { p_endpoint: ep });
      }).then(function () { return "off"; });
    });
  }
  // Re-save an existing subscription for the current (maybe new) anonymous user. Errors ignored.
  function resync(rpc) {
    if (!supported() || Notification.permission !== "granted") return Promise.resolve();
    return current().then(function (sub) {
      if (!sub) return;
      var k = keysOf(sub);
      return rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth });
    }).catch(function () {});
  }
  window.PUSH = { supported: supported, current: current, enable: enable, disable: disable, resync: resync, urlBase64ToUint8Array: urlBase64ToUint8Array };
})();
