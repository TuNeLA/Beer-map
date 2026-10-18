/* Öl Nu service worker. */
var VERSION = "olnu-52c0f3c9c9";
// Shell files that index.html does not name. The local scripts and stylesheets (with their ?v=<file hash>)
// are read from index.html itself at install, so the precache uses the same URLs as the page (no double download).
// app.js forceUpdate() also reads this list.
var SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./favicon.ico",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"
];
var CDN_CACHE = "olnu-cdn", DATA_CACHE = "olnu-data", TILE_CACHE = "olnu-tiles";
var KEEP = [CDN_CACHE, DATA_CACHE, TILE_CACHE, "olnu-pending"];   // olnu-pending: notificationclick parks the target there
var CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
var TILE_HOST = /(^|\.)(arcgisonline\.com|basemaps\.cartocdn\.com)$/;
var TILE_MAX = 300, TILE_MAX_AGE = 14 * 86400e3, NAV_TIMEOUT_MS = 4000;
var DATA_RE = /\/(bars(-extra|-closed)?\.json|places\.json|places\/[^/]+\.json)$/;

function shellFromIndex(html) {
  var out = [], re = /<(?:script|link)\b[^>]*?\s(?:src|href)="(\.\/[^"]+?\.(?:js|css)(?:\?[^"]*)?)"/g, m;
  while ((m = re.exec(html))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // cache: "reload" skips the browser HTTP cache (GitHub Pages sends max-age=600),
    // so a new version never stores an older app.js next to a newer index.html.
    return fetch(new Request("./index.html", { cache: "reload" })).then(function (res) {
      if (!res.ok) throw new Error("index " + res.status);
      return res.clone().text().then(function (html) {
        return Promise.all([c.put("./index.html", res.clone()), c.put("./", res)]).then(function () { return shellFromIndex(html); });
      });
    }).catch(function () { return []; }).then(function (fromIndex) {
      var list = SHELL.filter(function (u) { return u !== "./" && u !== "./index.html"; }).concat(fromIndex);
      return Promise.all(list.map(function (u) {
        // A file with ?v=<hash> that an older version already has is the same file: copy it, do not download it again.
        var copy = /[?&]v=/.test(u) ? caches.match(u) : Promise.resolve(null);
        return copy.then(function (hit) {
          return hit ? c.put(u, hit) : c.add(new Request(u, { cache: "reload" }));
        }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && KEEP.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function keep(e, p) { try { e.waitUntil(p); } catch (err) {} return p; }
function put(cacheName, req, res) {
  return caches.open(cacheName).then(function (c) { return c.put(req, res); }).catch(function () {});
}
function fromCache(req) {
  return caches.match(req).then(function (r) { return r || Response.error(); });
}

// index.html: network first (no-cache), cached copy when offline or when the network is slower than NAV_TIMEOUT_MS.
function networkFirst(req, e) {
  // no-cache: always ask the server (304 is cheap). Else the HTTP cache (max-age=600) can give an
  // old index.html next to a new app.js, and the app crashes on missing elements.
  var fresh = req;
  try { fresh = req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : new Request(req, { cache: "no-cache" }); } catch (err) {}
  var net = fetch(fresh).then(function (res) {
    // A redirected response cannot answer a navigation: use the normal request then.
    if (fresh !== req && res && res.redirected && req.mode === "navigate") return fetch(req);
    return res;
  }).then(function (res) {
    if (res && res.ok) keep(e, put(VERSION, req, res.clone()));
    return res;
  });
  function cached() {
    return caches.match(req).then(function (r) {
      if (r || req.mode !== "navigate") return r;
      return caches.match("./index.html").then(function (h) { return h || caches.match("./"); });
    });
  }
  var timer;
  var slow = new Promise(function (resolve) {
    timer = setTimeout(function () { cached().then(function (r) { if (r) resolve(r); }); }, NAV_TIMEOUT_MS);
  });
  var first = net.then(function (res) { clearTimeout(timer); return res; }, function () {
    clearTimeout(timer);
    return cached().then(function (r) { return r || Response.error(); });
  });
  keep(e, net.catch(function () {}));
  return Promise.race([first, slow]);
}
// Code and styles: cache first (the URLs carry ?v=<hash>, so a new file has a new URL).
function cacheFirst(req, cacheName) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) put(cacheName, req, res.clone());
      return res;
    });
  });
}
// CDN files (versioned URLs): long-lived cache that survives app updates. Fetched with CORS when the
// CDN allows it, so the cache stores a real (not opaque, not padded) response.
function cdnFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    var corsReq = null;
    try { corsReq = req.mode === "no-cors" ? new Request(req.url, { mode: "cors", credentials: "omit" }) : null; } catch (err) {}
    var get = corsReq ? fetch(corsReq).then(function (r) { if (!r.ok) throw new Error("cors " + r.status); return r; }).catch(function () { return fetch(req); }) : fetch(req);
    return get.then(function (res) {
      if (res && (res.ok || res.type === "opaque")) put(CDN_CACHE, req, res.clone());
      return res;
    });
  });
}
// Data (bars, places tiles): answer from the cache at once and refresh it in the background.
function staleWhileRevalidate(req, e) {
  return caches.open(DATA_CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) return c.put(req.url.split("?")[0], res.clone()).catch(function () {}).then(function () { return res; });
        return res;
      });
      if (hit) { keep(e, net.catch(function () {})); return hit; }
      return net;
    });
  });
}
// Map tiles: cache first, at most TILE_MAX tiles (oldest out), refetched after TILE_MAX_AGE.
// The stored copy gets its own x-olnu-at time (a CORS response does not show its Date header).
var tilePuts = 0;
function trimTiles() {
  return caches.open(TILE_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - TILE_MAX;
      return extra > 0 ? Promise.all(keys.slice(0, extra).map(function (k) { return c.delete(k); })) : null;
    });
  }).catch(function () {});
}
function tileFirst(req, e) {
  var url = req.url;
  return caches.open(TILE_CACHE).then(function (c) {
    return c.match(url).then(function (hit) {
      var age = hit ? Date.now() - (+hit.headers.get("x-olnu-at") || 0) : Infinity;
      if (hit && age < TILE_MAX_AGE) return hit;
      // CORS (Esri and CARTO allow it) so the stored tile is not opaque; plain request as the fallback.
      return fetch(new Request(url, { mode: "cors", credentials: "omit" })).then(function (res) {
        if (res && res.ok) {
          var type = res.headers.get("content-type") || "image/png";
          keep(e, res.clone().blob().then(function (b) {
            return c.delete(url).then(function () {
              return c.put(url, new Response(b, { status: 200, headers: { "Content-Type": type, "x-olnu-at": String(Date.now()) } }));
            });
          }).then(function () { if (++tilePuts % 20 === 0) return trimTiles(); }).catch(function () {}));
        }
        return res;
      }).catch(function () {
        return hit || fetch(req);
      });
    });
  }).catch(function () { return fetch(req); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) {
    if (TILE_HOST.test(url.hostname)) { e.respondWith(tileFirst(req, e)); return; }
    if (CDN_HOSTS.indexOf(url.hostname) >= 0) { e.respondWith(cdnFirst(req)); return; }
    return;   // Supabase, Overpass and anything else: browser default.
  }
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0) return;
  if (DATA_RE.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // Self-hosted fonts never change under the same name: keep them across app versions.
  if (/\/fonts\/[^/]+\.woff2$/.test(url.pathname)) { e.respondWith(cdnFirst(req)); return; }
  if (req.mode === "navigate" || /\.html?$/.test(url.pathname) || url.pathname === scopePath) { e.respondWith(networkFirst(req, e)); return; }
  // config.js without ?v= (not stamped yet): network first, it holds the server address.
  if (/\/config\.js$/.test(url.pathname) && !url.searchParams.has("v")) { e.respondWith(networkFirst(req, e)); return; }
  e.respondWith(cacheFirst(req, VERSION));
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "🍺 Öl Nu";
  var opts = {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
    tag: d.tag || d.url || "olnu",
    requireInteraction: !!(d.requireInteraction || d.sos),
    data: { url: d.url || "./", rally_id: d.rally_id != null ? String(d.rally_id) : null }
  };
  // Rally pushes carry buttons ("✅ Jag kommer" / "❌ Kan inte").
  if (Array.isArray(d.actions) && d.actions.length) {
    opts.actions = d.actions.filter(function (a) { return a && a.action && a.title; }).slice(0, 2)
      .map(function (a) { return { action: String(a.action), title: String(a.title) }; });
  }
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {}, raw = data.url || "./";
  // Rally buttons: open the rally and answer it ("&answer=yes|no").
  if ((e.action === "yes" || e.action === "no") && (data.rally_id || /[?&]rally=/.test(raw))) {
    if (!/[?&]rally=/.test(raw)) raw = "/?rally=" + encodeURIComponent(data.rally_id);
    raw += (raw.indexOf("?") >= 0 ? "&" : "?") + "answer=" + e.action;
  }
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
        // The app is already open: tell it what to show (chat, rally, bar, pin). No reload needed.
        // Old app versions ignore the message, so navigate as a fallback when nobody answers.
        var client = c;
        // Also park the target in the Cache API: a frozen background page reads it when it becomes visible.
        var park = caches.open("olnu-pending").then(function (cc) { return cc.put("./__pending_open", new Response(target)); }).catch(function () {});
        return park.then(function () { return client.focus(); }).then(function (fc) {
          fc = fc || client;
          return new Promise(function (resolve) {
            var done = false, ch = new MessageChannel();
            ch.port1.onmessage = function () { done = true; resolve(fc); };
            try { fc.postMessage({ type: "olnu-open", url: target }, [ch.port2]); } catch (err) {}
            setTimeout(function () {
              if (done) return;
              if (fc.navigate) fc.navigate(target).then(resolve, function () { resolve(fc); }); else resolve(fc);
            }, 2500);
          });
        });
      }
    }
    return self.clients.openWindow(target);
  }));
});
