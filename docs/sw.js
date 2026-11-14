/* PintsNow service worker. */
var VERSION = "olnu-7f4715c49b";
// Shell files that index.html does not name. The local scripts and stylesheets (with their ?v=<file hash>)
// are read from index.html itself at install, so the precache uses the same URLs as the page (no double download).
// app.js forceUpdate() also reads this list.
var SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./favicon.ico", "./flytta.html",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"
];
var CDN_CACHE = "olnu-cdn", DATA_CACHE = "olnu-data", TILE_CACHE = "olnu-tiles";
var KEEP = [CDN_CACHE, DATA_CACHE, TILE_CACHE, "olnu-pending", "olnu-beta"];   // olnu-pending: notificationclick parks the target there
var CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
var TILE_HOST = /(^|\.)(arcgisonline\.com|basemaps\.cartocdn\.com|tiles\.openfreemap\.org)$/;
// 🗺️ Kartstil beta: OpenFreeMap style + TileJSON change weekly (network first); vector tiles are bigger than PNGs (byte cap).
var TILE_META = /^\/(styles\/[^/]+|planet)\/?$/, TILE_BYTES = 40 * 1024 * 1024;
var TILE_MAX = 300, TILE_MAX_AGE = 14 * 86400e3, NAV_TIMEOUT_MS = 4000;
var SHELL_MAX_AGE = 3 * 86400e3;   // smooth: cached index.html younger than this opens the app at once
var DATA_RE = /\/(bars(-extra|-closed)?\.json|arenas\.json|hours\.json|systembolaget\.json|places\.json|places\/[^/]+\.json|buildings(3d)?\/[^/]+\.json|zones\/[^/]+\.json|data\/dialekt-kommun\.json|js\/dialekt-packs\/(?![a-z]{2}-neutral(-lek)?\.js)[a-z]{2}-[a-z-]+\.js)$/;

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
        var copy = /[?&]v=[0-9a-f]{8,}(&|$)/.test(u) ? caches.match(u) : Promise.resolve(null);   // pnds: only a real content hash is "the same file"
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

/* ---------- 🧪 Betaversion: this worker is the launcher (CONTRACT "BETAKANAL", js/kanal.js) ----------
   The page stores {ch: "beta", url: <BETA_URL>} in olnu-pending ./__kanal and posts "pn-kanal-set". While the channel is
   "beta", every same-origin GET in this scope (not sw.js, not manifest.webmanifest) is answered with the same path from the
   beta build: CORS fetch (GitHub Pages sends Access-Control-Allow-Origin: *), so it also works from pintsnow.com. Beta files
   live in their own cache (olnu-beta). Supabase, map tiles and CDNs are not touched: same storage, same account.
   Safety net: a beta page must post "pn-kanal-ok" (app.js started its modules) within KANAL_BOOT_MS ("pn-kanal-alive"
   gives it KANAL_SLOW_MS). No ok while the page is visible = back to stable at once, the page is reloaded, and the stable
   app shows a toast. A beta start that never answered (worker stopped meanwhile) counts as a crash: 2 crashes = stable.
   ?kanal=stabil in a page URL forces stable. The beta build's own copy of this worker never launches (its own scope). */
var KANAL_KEY = "./__kanal", BETA_CACHE = "olnu-beta", KANAL_BOOT_MS = 12000, KANAL_SLOW_MS = 25000;
var kanal = null, kanalBoots = {};
function kanalRead() {
  return caches.open("olnu-pending").then(function (c) { return c.match(KANAL_KEY); })
    .then(function (r) { return r ? r.json() : null; }).catch(function () { return null; })
    .then(function (k) { kanal = k && typeof k === "object" ? k : { ch: "stable" }; return kanal; });
}
function kanalSave(k) {
  kanal = k;
  return caches.open("olnu-pending").then(function (c) { return c.put(KANAL_KEY, new Response(JSON.stringify(k), { headers: { "Content-Type": "application/json" } })); }).catch(function () {});
}
// Only real PintsNow hosts (https), or a local test build when this worker runs on localhost. Never this worker's own scope.
function kanalBase(k) {
  try {
    if (!k || k.ch !== "beta" || !k.url) return null;
    var u = new URL(String(k.url)), local = /^(localhost|127\.0\.0\.1)$/.test(self.location.hostname);
    var okHost = u.protocol === "https:" && /^(tunela\.github\.io|(?:[a-z0-9-]+\.)?pintsnow\.com)$/.test(u.hostname);
    if (!okHost && !(local && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    var base = u.href.split("#")[0].split("?")[0]; if (base.charAt(base.length - 1) !== "/") base += "/";
    var scope = self.registration.scope;
    if (scope.indexOf(base) === 0 || base.indexOf(scope) === 0) return null;
    return base;
  } catch (err) { return null; }
}
function kanalStable(why, extra) {
  var k = { ch: "stable", at: Date.now(), by: why };
  if (extra) for (var x in extra) k[x] = extra[x];
  kanalBoots = {};
  return Promise.all([kanalSave(k), caches.delete(BETA_CACHE).catch(function () {})]);
}
// Safety net: beta did not start → stable, reload the open app pages.
function kanalFall(why) {
  var was = kanal && kanal.url;
  return kanalStable(why, { fell: Date.now(), was: was || "" }).then(function () {
    return self.clients.matchAll({ type: "window" }).then(function (list) {
      list.forEach(function (cl) {
        if (cl.url.indexOf(self.registration.scope) !== 0) return;
        try { cl.postMessage({ type: "pn-kanal-fell" }); } catch (err) {}
        try { if (cl.navigate) cl.navigate(cl.url).catch(function () {}); } catch (err) {}
      });
    });
  });
}
function kanalWatch(id, e) {
  var at = Date.now();
  kanalBoots[id] = { at: at, alive: false, ok: false };
  var p = new Promise(function (done) {
    (function tick() {
      var b = kanalBoots[id];
      if (!b || b.ok) { done(); return; }
      if (Date.now() - at < (b.alive ? KANAL_SLOW_MS : KANAL_BOOT_MS)) { setTimeout(tick, 500); return; }
      // too slow: only a page that is still open and visible counts (a phone put away during start is not a crash)
      (id ? self.clients.get(id) : Promise.resolve(null)).then(function (cl) {
        if (!kanalBoots[id] || kanalBoots[id].ok) return;
        if (id && (!cl || cl.visibilityState === "hidden")) return;
        return kanalFall("timeout");
      }).catch(function () {}).then(done);
    })();
  });
  keep(e, p);
}
function kanalWrap(res, type) {
  var h = new Headers(res.headers);
  if (type) h.set("Content-Type", type);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
function kanalFetch(burl, nav) {
  return fetch(new Request(burl, { mode: "cors", credentials: "omit", cache: nav ? "no-cache" : "default" }));
}
// The beta page: network first (no-cache, NAV_TIMEOUT_MS), the cached copy offline. Keeps the stable manifest link.
function kanalPage(burl, e) {
  var net = kanalFetch(burl, true).then(function (res) {
    if (!res || !res.ok) throw new Error("beta " + (res && res.status));
    keep(e, caches.open(BETA_CACHE).then(function (c) { return c.put(burl, res.clone()); }).catch(function () {}));
    return res;
  });
  var cached = function () { return caches.open(BETA_CACHE).then(function (c) { return c.match(burl); }); };
  var timer, slow = new Promise(function (ok) { timer = setTimeout(function () { cached().then(function (r) { if (r) ok(r); }); }, NAV_TIMEOUT_MS); });
  keep(e, net.catch(function () {}));
  return Promise.race([net.then(function (r) { clearTimeout(timer); return r; }, function () { clearTimeout(timer); return cached(); }), slow]).then(function (res) {
    if (!res) return null;
    return res.text().then(function (html) {
      if (!/rel="manifest"/.test(html)) html = html.replace(/<\/head>/i, '<link rel="manifest" href="./manifest.webmanifest">\n</head>');
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    });
  });
}
// Other beta files: ?v=<hash> = cache first; the rest network first with the cached copy as the fallback.
function kanalFile(burl, e) {
  return caches.open(BETA_CACHE).then(function (c) {
    var hashed = /[?&]v=[0-9a-f]{8,}(&|$)/.test(burl);
    var net = function () {
      return kanalFetch(burl, false).then(function (res) {
        if (res && res.ok) keep(e, c.put(burl, res.clone()).catch(function () {}));
        return res;
      });
    };
    if (hashed) return c.match(burl).then(function (hit) { return hit || net(); });
    return net().then(function (res) { return res && res.ok ? res : c.match(burl).then(function (h) { return h || res; }); },
      function () { return c.match(burl); });
  });
}
function kanalRoute(req, e, url, scopePath, route) {
  var stable = function () {
    var out = null;
    try { route({ request: req, __stable: 1, respondWith: function (p) { out = p; }, waitUntil: function (p) { try { e.waitUntil(p); } catch (err) {} } }); } catch (err) {}
    return out ? Promise.resolve(out) : fetch(req);
  };
  var nav = req.mode === "navigate";
  if (nav && /[?&]kanal=stabil\b/.test(url.search)) return kanalStable("url").then(stable);
  var rel = url.pathname.slice(scopePath.length);
  if (rel === "sw.js" || rel === "manifest.webmanifest") return stable();
  return (nav || !kanal ? kanalRead() : Promise.resolve(kanal)).then(function (k) {
    var base = kanalBase(k);
    if (!base) return stable();
    var burl = base + rel + url.search;
    if (nav || /\.html?$/.test(rel) || rel === "") {
      var crash = Promise.resolve(false);
      if (nav && appNav(req)) {
        // the last beta start never said ok (the worker was stopped before it could check): a crash
        if (k.pend && Date.now() - k.pend > KANAL_BOOT_MS) { k.fails = (k.fails || 0) + 1; }
        if ((k.fails || 0) >= 2) crash = kanalFall("crash").then(function () { return true; });
        else { k.pend = Date.now(); keep(e, kanalSave(k)); }
      }
      return crash.then(function (fell) {
        if (fell) return stable();
        return kanalPage(burl, e).then(function (res) {
          if (!res) return stable();   // beta not reachable and not cached: the stable app (the choice stays)
          if (nav && appNav(req)) kanalWatch(e.resultingClientId || "", e);
          return res;
        }, stable);
      });
    }
    return kanalFile(burl, e).then(function (res) {
      if (!res || res.status === 404 || (!res.ok && res.type !== "opaque")) return stable();
      return kanalWrap(res);
    }, stable);
  });
}
self.addEventListener("message", function (e) {
  var d = e.data || {}, id = e.source && e.source.id, reply = function () { try { if (e.ports && e.ports[0]) e.ports[0].postMessage("ok"); } catch (err) {} };
  var all = function (f) { for (var b in kanalBoots) if (!id || b === id || !b) kanalBoots[b][f] = true; };   // Safari may not give resultingClientId
  if (d.type === "pn-kanal-alive") { all("alive"); reply(); return; }
  if (d.type === "pn-kanal-ok") {
    all("ok");
    keep(e, kanalRead().then(function (k) {
      if (k.ch !== "beta" || (!k.pend && !k.fails)) return;
      k.pend = 0; k.fails = 0; if (d.sha) k.sha = String(d.sha).slice(0, 12);
      return kanalSave(k);
    }).then(reply, reply));
    return;
  }
  if (d.type === "pn-kanal-set" && d.rec && typeof d.rec === "object") {
    var r = d.rec, k = r.ch === "beta" ? { ch: "beta", url: String(r.url || ""), at: Date.now(), by: String(r.by || "") } : { ch: "stable", at: Date.now(), by: String(r.by || "") };
    if (k.ch === "beta" && !kanalBase(k)) { keep(e, kanalStable("bad-url").then(function () {}, function () {})); return; }   // no reply: the page undoes
    if (k.ch === "stable") { if (r.fell) k.fell = +r.fell || 0; if (r.fellShown) k.fellShown = +r.fellShown || 0; }
    keep(e, (k.ch === "stable" ? kanalStable(k.by, k) : kanalSave(k).then(function () { kanalBoots = {}; return caches.delete(BETA_CACHE).catch(function () {}); })).then(reply, reply));
  }
});

self.addEventListener("fetch", function route(e) {
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
  if (!e.__stable) { e.respondWith(kanalRoute(req, e, url, scopePath, route)); return; }   // 🧪 Betaversion launcher
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

// ntf v2 (agent ntf 2026-11-08): log queue + avatar icon. The service worker has no PNLOG: push.shown / push.open /
// push.action {k kind, v variant, a button, h Stockholm hour} wait in Cache "olnu-pending" ./__pnq (max 60) until the app
// is visible (push.js drainLog → PNLOG + push_seen). Never skip showNotification (iOS revokes the subscription).
function ntfHour() {
  try { return +new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()); } catch (err) { return new Date().getHours(); }
}
function ntfLog(n, data, a) {
  data = data || {};
  if (!data.k) return Promise.resolve();
  return caches.open("olnu-pending").then(function (cc) {
    return cc.match("./__pnq").then(function (r) { return r ? r.text() : "[]"; }).then(function (t) {
      var q = []; try { q = JSON.parse(t) || []; } catch (err) { q = []; }
      q.push({ n: n, k: String(data.k).slice(0, 16), v: String(data.v || "").slice(0, 24), a: String(a || "").slice(0, 16), h: ntfHour(), t: Date.now() });
      return cc.put("./__pnq", new Response(JSON.stringify(q.slice(-60))));
    });
  }).catch(function () {});
}
// The sender's avatar (push.js caches group mates' faces as PNG data URLs under ./__face/<k>); else the app icon.
function ntfFace(d, opts) {
  if (!d || typeof d.face !== "string" || !/^[0-9a-f]{12,16}$/.test(d.face)) return Promise.resolve();
  return caches.open("olnu-pending").then(function (c) { return c.match("./__face/" + d.face); }).then(function (r) {
    if (!r) return;
    return r.text().then(function (u) { if (/^data:image\/png;base64,/.test(u) && u.length < 200000) opts.icon = u; });
  }).catch(function () {});
}

// 📊 PNLOG (lgx): count pushes / clicks / closes per kind for the app log (js/pnlog-hooks.js reads + clears it).
// kind = the NAME of the first url parameter (rally, inv, chat …) or the tag prefix; never a value, never text.
function pnKind(d) { var m = String(d && d.url || "").match(/[?&]([a-z_]{2,12})=/); if (m) return m[1]; var t = String(d && d.tag || "").match(/^[a-z_]{2,12}/); return t ? t[0] : "other"; }
function pnNtf(w, k, a) {
  return caches.open("olnu-pending").then(function (c) {
    return c.match("./__pnlog_ntf").then(function (r) { return r ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) {
      j = j && typeof j === "object" ? j : {};
      var o = j[w] = j[w] || {};
      if (o[k] || Object.keys(o).length < 30) o[k] = (o[k] || 0) + 1;
      if (a) { var x = j.act = j.act || {}; x[a] = (x[a] || 0) + 1; }
      if (w === "clk") j.lastClk = { k: k, at: Date.now() };
      return c.put("./__pnlog_ntf", new Response(JSON.stringify(j), { headers: { "Content-Type": "application/json" } }));
    });
  }).catch(function () {});
}
self.addEventListener("notificationclose", function (e) {
  var n = e.notification || {};
  keep(e, pnNtf("x", pnKind({ url: n.data && n.data.url, tag: n.tag })));
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "PintsNow 🍺";
  // nf 2026-11-07: ?v=c1 = the C1 icon (navy tile, amber mug) and the white monochrome badge, never an old cached copy.
  var opts = {
    body: d.body || "",
    icon: "./icons/icon-192.png?v=c1",
    badge: "./icons/badge-96.png?v=c1",
    tag: d.tag || d.url || "olnu",
    requireInteraction: !!(d.requireInteraction || d.sos),
    data: { url: d.url || "./", rally_id: d.rally_id != null ? String(d.rally_id) : null, at: Date.now() }
  };
  // ntf v2: kind + variant (log), event time, a picture for film (only our own ./icons/*.png), one updating notice per night.
  opts.data.k = String(d.k || "").slice(0, 16); opts.data.v = String(d.v || "").slice(0, 24);
  if (typeof d.image === "string" && /^\.\/icons\/[\w.-]+\.png(\?v=\w+)?$/.test(d.image)) opts.image = d.image;
  if (isFinite(d.ts) && +d.ts > 0) opts.timestamp = +d.ts;
  if (d.fold && d.fold.key && d.fold.line) {
    opts.tag = "olnu-fold-" + String(d.fold.key).replace(/[^\w-]/g, "").slice(0, 40);
    d.stack = { title: String(d.fold.title || "{n} nya"), line: String(d.fold.line) }; d.renotify = true;
  }
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
  var show = ntfFace(d, opts).then(function () {   // ntf v2: the sender's face as the icon
    if (!d.stack || !d.stack.line || !self.registration.getNotifications) return;
    return self.registration.getNotifications({ tag: opts.tag }).then(function (list) {
      var old = list && list.length ? list[list.length - 1] : null, od = (old && old.data) || {};
      var lines = (od.lines || (old ? [String(od.line || old.body || "")] : [])).concat([String(d.stack.line)]).slice(-6);
      var n = (od.n || (old ? 1 : 0)) + 1;
      opts.data.lines = lines; opts.data.n = n; opts.data.line = String(d.stack.line);
      opts.data.buzz = od.buzz || 0;
      if (n > 1 && d.stack.title) { title = String(d.stack.title).replace("{n}", n); opts.body = lines.join("\n"); }
      if (n > 1 && d.fold) { opts.data.url = "/"; opts.actions = []; opts.data.acts = {}; }   // ntf v2: a folded night opens the map
    }).catch(function () {});
  }).then(function () {
    if (d.renotify && opts.tag) {
      var last = opts.data.buzz || 0;
      opts.renotify = !last || Date.now() - last > 60000;
      opts.silent = !opts.renotify;
      if (opts.renotify) opts.data.buzz = Date.now();
    }
    return self.registration.showNotification(title, opts).then(function () { return ntfLog("push.shown", opts.data, ""); });   // ntf v2
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
  e.waitUntil(Promise.all([show, badge, pnNtf("rx", pnKind(d))]));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {}, raw = data.url || "./";
  keep(e, pnNtf("clk", pnKind({ url: raw, tag: e.notification.tag }), e.action ? String(e.action).replace(/[^a-z_]/g, "").slice(0, 12) : ""));
  try { e.waitUntil(ntfLog(e.action ? "push.action" : "push.open", data, e.action || "")); } catch (err) {}   // ntf v2
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
        return park.then(function () { return client.focus().catch(function () { return client; }); }).then(function (fc) {   // ntf v2: focus may be refused; still tell the page
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
