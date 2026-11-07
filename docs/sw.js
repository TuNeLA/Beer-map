/* Öl Nu service worker. */
var VERSION = "olnu-44c82b9cfb";
// Shell files that index.html does not name. The local scripts and stylesheets (with their ?v=<file hash>)
// are read from index.html itself at install, so the precache uses the same URLs as the page (no double download).
// app.js forceUpdate() also reads this list.
var SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./favicon.ico", "./flytta.html",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"
];
var CDN_CACHE = "olnu-cdn", DATA_CACHE = "olnu-data", TILE_CACHE = "olnu-tiles";
var KEEP = [CDN_CACHE, DATA_CACHE, TILE_CACHE, "olnu-pending"];   // olnu-pending: notificationclick parks the target there
var CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
var TILE_HOST = /(^|\.)(arcgisonline\.com|basemaps\.cartocdn\.com|tiles\.openfreemap\.org)$/;
// 🗺️ Kartstil beta: OpenFreeMap style + TileJSON change weekly (network first); vector tiles are bigger than PNGs (byte cap).
var TILE_META = /^\/(styles\/[^/]+|planet)\/?$/, TILE_BYTES = 40 * 1024 * 1024;
var TILE_MAX = 300, TILE_MAX_AGE = 14 * 86400e3, NAV_TIMEOUT_MS = 4000;
var SHELL_MAX_AGE = 3 * 86400e3;   // smooth: cached index.html younger than this opens the app at once
var DATA_RE = /\/(bars(-extra|-closed)?\.json|arenas\.json|hours\.json|systembolaget\.json|places\.json|places\/[^/]+\.json|buildings(3d)?\/[^/]+\.json|zones\/[^/]+\.json)$/;

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
    }).then(function (fromIndex) {   // ⚡ SPEED: no file may fail (index.html, the shell, every ./js + ./css file it names)
      var list = SHELL.filter(function (u) { return u !== "./" && u !== "./index.html"; }).concat(fromIndex);
      return Promise.all(list.map(function (u) {
        // A file with ?v=<hash> that an older version already has is the same file: copy it, do not download it again.
        var copy = /[?&]v=/.test(u) ? caches.match(u) : Promise.resolve(null);
        return copy.then(function (hit) {
          return hit ? c.put(u, hit) : c.add(new Request(u, { cache: "reload" }));
        });
      }));
    });
  }).then(function () { return self.skipWaiting(); }, function (err) {
    // the new version is not complete: drop it, keep the old worker + cache (install is retried on the next update check)
    return caches.delete(VERSION).then(function () { throw err; });
  }));
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

// 🚚 PintsNow move: the app page (scope root or index.html) answered with a redirect to ANOTHER origin = the app moved.
function appNav(req) {
  try {
    if (req.mode !== "navigate") return false;
    var p = new URL(req.url).pathname, sp = new URL(self.registration.scope).pathname;
    return p === sp || p === sp + "index.html";
  } catch (err) { return false; }
}
function otherOrigin(u) { try { return new URL(u).origin !== self.location.origin; } catch (err) { return false; } }
function isMoved() { return caches.open("olnu-pending").then(function (c) { return c.match("./__moved"); }).then(function (r) { return !!r; }).catch(function () { return false; }); }
function setMoved(on) {
  return isMoved().then(function (was) {
    if (was === on) return;
    return caches.open("olnu-pending").then(function (c) { return on ? c.put("./__moved", new Response(String(Date.now()))) : c.delete("./__moved"); }).then(function () {
      if (!on) return;
      return self.clients.matchAll({ type: "window" }).then(function (list) { list.forEach(function (cl) { try { cl.postMessage({ type: "olnu-moved" }); } catch (err) {} }); });
    });
  }).catch(function () {});
}
// The in-app move page (precached). Without it: follow the redirect like a normal browser.
function movedPage(req) {
  return caches.match("./flytta.html").then(function (r) { return r || fetch(req); });
}
function isMovePage(res) { return !!(res && /\/flytta\.html$/.test(res.url || "")); }

// index.html: network first (no-cache), cached copy when offline or when the network is slower than NAV_TIMEOUT_MS.
function networkFirst(req, e) {
  // no-cache: always ask the server (304 is cheap). Else the HTTP cache (max-age=600) can give an
  // old index.html next to a new app.js, and the app crashes on missing elements.
  var fresh = req;
  try { fresh = req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : new Request(req, { cache: "no-cache" }); } catch (err) {}
  var net = fetch(fresh).then(function (res) {
    // A redirected response cannot answer a navigation: use the normal request then.
    if (fresh !== req && res && res.redirected && req.mode === "navigate") {
      if (appNav(req) && otherOrigin(res.url)) return setMoved(true).then(function () { return movedPage(req); });   // 🚚 olnu-moved
      return fetch(req);
    }
    if (res && res.ok && appNav(req)) keep(e, setMoved(false));
    return res;
  }, function (err) {
    // CORS may hide a cross-origin redirect: ask once more without following it.
    if (!appNav(req)) throw err;
    return fetch(new Request(req.url, { redirect: "manual", cache: "no-cache", credentials: "same-origin" })).then(function (r) {
      if (r && r.type === "opaqueredirect") return setMoved(true).then(function () { return movedPage(req); });
      throw err;
    });
  }).then(function (res) {
    if (res && res.ok && !isMovePage(res)) keep(e, put(VERSION, req, res.clone()));
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
// smooth: app shell first. The page for this version is in the VERSION cache with the same ?v= scripts, so it always
// fits the cached code. Answer it at once and refresh it in the background (stale-while-revalidate).
function shellFirst(req, e) {
  if (appNav(req)) {
    // 🚚 moved: show the move page at once; the network check in the background clears the mark after a rollback.
    return isMoved().then(function (m) {
      if (!m) return shellFirst0(req, e);
      keep(e, networkFirst(req, e).catch(function () {}));
      return movedPage(req);
    });
  }
  return shellFirst0(req, e);
}
function shellFirst0(req, e) {
  return caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) { return hit || c.match("./index.html"); }).then(function (hit) {
      var at = hit ? Date.parse(hit.headers.get("date") || "") : NaN;
      if (!hit || !(Date.now() - at < SHELL_MAX_AGE)) return networkFirst(req, e);
      keep(e, networkFirst(req, e).catch(function () {}));   // refresh the cached page for the next start
      return hit;
    });
  }).catch(function () { return networkFirst(req, e); });
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
      var drop = extra > 0 ? keys.slice(0, extra) : [], rest = extra > 0 ? keys.slice(extra) : keys;
      // Byte cap: newest first, keep until TILE_BYTES (size from x-olnu-size; older entries without it count 20 kB).
      return Promise.all(rest.map(function (k) { return c.match(k).then(function (r) { return r ? +r.headers.get("x-olnu-size") || 20480 : 0; }); })).then(function (sz) {
        var sum = 0;
        for (var i = rest.length - 1; i >= 0; i--) { sum += sz[i]; if (sum > TILE_BYTES) drop.push(rest[i]); }
        return drop.length ? Promise.all(drop.map(function (k) { return c.delete(k); })) : null;
      });
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
              return c.put(url, new Response(b, { status: 200, headers: { "Content-Type": type, "x-olnu-at": String(Date.now()), "x-olnu-size": String(b.size) } }));
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

// Basemap style / TileJSON: network first (4 s), the cached copy when offline or slow.
function tileMetaFirst(req, e) {
  var url = req.url;
  return caches.open(TILE_CACHE).then(function (c) {
    var net = fetch(new Request(url, { mode: "cors", credentials: "omit" })).then(function (res) {
      if (res && res.ok) keep(e, c.put(url, res.clone()).catch(function () {}));
      return res;
    });
    var slow = new Promise(function (resolve) { setTimeout(function () { c.match(url).then(function (h) { if (h) resolve(h); }); }, NAV_TIMEOUT_MS); });
    var first = net.then(function (res) { return res && res.ok ? res : c.match(url).then(function (h) { return h || res; }); },
      function () { return c.match(url).then(function (h) { return h || Response.error(); }); });
    keep(e, net.catch(function () {}));
    return Promise.race([first, slow]);
  }).catch(function () { return fetch(req); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) {
    if (url.hostname === "tiles.openfreemap.org" && TILE_META.test(url.pathname)) { e.respondWith(tileMetaFirst(req, e)); return; }
    if (TILE_HOST.test(url.hostname)) { e.respondWith(tileFirst(req, e)); return; }
    if (CDN_HOSTS.indexOf(url.hostname) >= 0) { e.respondWith(cdnFirst(req)); return; }
    return;   // Supabase, Overpass and anything else: browser default.
  }
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0) return;
  if (/\/bars-closed\.json$/.test(url.pathname)) { e.respondWith(networkFirst(req, e)); return; }   // calm: a closed place goes at once
  if (DATA_RE.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // Self-hosted fonts never change under the same name: keep them across app versions.
  if (/\/fonts\/[^/]+\.woff2$/.test(url.pathname)) { e.respondWith(cdnFirst(req)); return; }
  if (req.mode === "navigate") { e.respondWith(shellFirst(req, e)); return; }
  if (/\.html?$/.test(url.pathname) || url.pathname === scopePath) { e.respondWith(networkFirst(req, e)); return; }
  // config.js without ?v= (not stamped yet): network first, it holds the server address.
  if (/\/config\.js$/.test(url.pathname) && !url.searchParams.has("v")) { e.respondWith(networkFirst(req, e)); return; }
  e.respondWith(cacheFirst(req, VERSION));
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "🍺 PintsNow";
  var opts = {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
    tag: d.tag || d.url || "olnu",
    requireInteraction: !!(d.requireInteraction || d.sos),
    data: { url: d.url || "./", rally_id: d.rally_id != null ? String(d.rally_id) : null, at: Date.now() }
  };
  // Rally/invite pushes carry buttons ("✅ Jag kommer" / "❌ Kan inte"). v27: a button may carry its own url
  // ("💬 Svara", "🍺 Kommer!", "🍻 Skåla"); iOS shows no buttons, a plain tap still opens `url`.
  if (Array.isArray(d.actions) && d.actions.length) {
    var acts = d.actions.filter(function (a) { return a && a.action && a.title; }).slice(0, 2);
    opts.actions = acts.map(function (a) { return { action: String(a.action), title: String(a.title) }; });
    opts.data.acts = {};
    acts.forEach(function (a) { if (typeof a.url === "string" && a.url.charAt(0) === "/") opts.data.acts[String(a.action)] = a.url; });
  }
  // v27 🔔: fold chat pushes with the same tag into one notice ("💬 3 nya i Gänget" + the last lines). Buzz again only
  // when the last buzz is > 60 s old, so a busy chat stays one quiet, updating notice.
  var show = Promise.resolve().then(function () {
    if (!d.stack || !d.stack.line || !self.registration.getNotifications) return;
    return self.registration.getNotifications({ tag: opts.tag }).then(function (list) {
      var old = list && list.length ? list[list.length - 1] : null, od = (old && old.data) || {};
      var lines = (od.lines || (old ? [String(od.line || old.body || "")] : [])).concat([String(d.stack.line)]).slice(-6);
      var n = (od.n || (old ? 1 : 0)) + 1;
      opts.data.lines = lines; opts.data.n = n; opts.data.line = String(d.stack.line);
      opts.data.buzz = od.buzz || 0;
      if (n > 1 && d.stack.title) { title = String(d.stack.title).replace("{n}", n); opts.body = lines.join("\n"); }
    }).catch(function () {});
  }).then(function () {
    if (d.renotify && opts.tag) {
      var last = opts.data.buzz || 0;
      opts.renotify = !last || Date.now() - last > 60000;
      opts.silent = !opts.renotify;
      if (opts.renotify) opts.data.buzz = Date.now();
    }
    return self.registration.showNotification(title, opts);
  });
  // v27: app icon badge = pushes since the app was last open (push.js clears it when the app is visible).
  var badge = caches.open("olnu-pending").then(function (cc) {
    return cc.match("./__badge").then(function (r) { return r ? r.text() : "0"; }).then(function (t) {
      var c = (parseInt(t, 10) || 0) + 1;
      return cc.put("./__badge", new Response(String(c))).then(function () {
        if (self.navigator && self.navigator.setAppBadge) return self.navigator.setAppBadge(c);
      });
    });
  }).catch(function () {});
  e.waitUntil(Promise.all([show, badge]));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {}, raw = data.url || "./";
  // v27: a button with its own url ("💬 Svara" → chat, "🍺 Kommer!" / "🍻 Skåla" → the pin with &act=…).
  if (e.action && data.acts && typeof data.acts[e.action] === "string") raw = data.acts[e.action];
  // Rally buttons: open the rally and answer it ("&answer=yes|no").
  if ((e.action === "yes" || e.action === "no") && (data.rally_id || /[?&]rally=/.test(raw))) {
    if (!/[?&]rally=/.test(raw)) raw = "/?rally=" + encodeURIComponent(data.rally_id);
    raw += (raw.indexOf("?") >= 0 ? "&" : "?") + "answer=" + e.action;
  }
  // v28: invite buttons → "/?inv=<id>&ans=yes|no" (app.js routeOpen → invite.js answers it).
  if ((e.action === "yes" || e.action === "no" || e.action === "maybe") && /[?&]inv=/.test(raw) && !/[?&]ans=/.test(raw)) raw += "&ans=" + e.action;
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
