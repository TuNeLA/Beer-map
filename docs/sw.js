/* Öl Nu service worker. */
var VERSION = "olnu-v6";
var SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./app.js", "./bars-extra.json",
  "./js/i18n.js", "./js/util.js", "./js/bars.js", "./js/push.js", "./js/fx.js", "./js/cities.js",
  "./manifest.webmanifest", "./favicon.ico",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"
];
var CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) {
      if (r || req.mode !== "navigate") return r || Response.error();
      return caches.match("./index.html").then(function (h) { return h || caches.match("./"); });
    }).then(function (r) { return r || Response.error(); });
  });
}
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  // Supabase, Overpass, map tiles and anything else: browser default.
  if (!sameOrigin && CDN_HOSTS.indexOf(url.hostname) < 0) return;
  if (sameOrigin) {
    var scopePath = new URL(self.registration.scope).pathname;
    if (url.pathname.indexOf(scopePath) !== 0) return;
    if (/\/bars(-extra)?\.json$/.test(url.pathname) || /\/config\.js$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
    if (req.mode === "navigate" || /\.html?$/.test(url.pathname) || url.pathname === scopePath) { e.respondWith(networkFirst(req)); return; }
  }
  e.respondWith(cacheFirst(req));
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "🍺 Öl Nu";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
    tag: d.tag || d.url || "olnu",
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var raw = (e.notification.data && e.notification.data.url) || "./";
  // Payload urls like "/?focus=12" are resolved against the scope so they work under a sub-path.
  var target;
  try {
    var rel = raw.charAt(0) === "/" ? "." + raw : raw;
    target = new URL(rel, self.registration.scope).href;
  } catch (err) { target = self.registration.scope; }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
        return c.focus().then(function (fc) { return fc && fc.navigate ? fc.navigate(target).catch(function () { return fc; }) : fc; });
      }
    }
    return self.clients.openWindow(target);
  }));
});
