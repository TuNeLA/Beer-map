/* Öl Nu — 👤 AVPINS: the friend's / group-mate's own character (js/avatar.js) inside their people pin on the map.
   window.AVPINS. No RPC of its own except my_groups (max once per 10 min, only while friend pins are on the map).
   - app.js beerIcon(b) calls AVPINS.img(b): a 26 px round face at the left of the pill "😀 3 🍺" (green ring = friend / group-mate,
     gold = me), or "" = today's pin (no spec loaded yet, avatars off, old server).
   - Light: each character is drawn ONCE (AVATAR.svg → an SVG data URL, cached per person + spec), the browser decodes each
     image once and every pin re-uses it. No inline SVG in the pins (hundreds of nodes per pin), no work per zoom frame.
   - Specs: AVATAR.forFriends() (me + friends) and AVATAR.forGroup(gid) for my groups, looked up by display name. When new
     specs arrive the pins are redrawn once (app render), debounced.
   - People pins are Leaflet DOM markers above the GL map (KARTSTIL 5), so this is plain HTML; nothing in GL. */
(function () {
  "use strict";
  var A = null, urls = {}, nUrls = 0, groupsAt = 0, gids = [], want = false, redrawT = 0, sig = "", loadAt = 0;
  var CSS = ".pill>.bm-av{width:26px;height:26px;border-radius:50%;margin:0 1px 0 -10px;flex:0 0 26px;display:block;" +
    "box-shadow:0 0 0 2px var(--green,#3ddc84),0 1px 4px rgba(0,0,0,.6);background:#1c2742}" +
    ".pill.pm>.bm-av{box-shadow:0 0 0 2px var(--gold,#ffc24d),0 1px 4px rgba(0,0,0,.6)}" +
    ".pill:has(>.bm-av){padding-left:6px}" +
    ".pill.p-cl>.bm-av{width:22px;height:22px;flex-basis:22px;margin-left:-9px}.pill.p-cl>.bm-av+.bm-av{margin-left:-12px}";
  function av() { var x = window.AVATAR; return x && x.on && x.on() ? x : null; }
  function caches() {   // AVATAR's own caches (same page): friends + every group loaded so far
    var out = [], x = av(); if (!x || !x._caches) return out;
    try { return x._caches(); } catch (e) { return out; }
  }
  function person(b) {
    var x = av(); if (!x) return null;
    if (b.is_mine) { var me = x.me && x.me(); return me ? { a: me.spec, seed: me.seed, r: me.facts ? me.facts.r : 1, k: "me" } : null; }
    var nm = b.friend_name; if (!nm) return null;
    var cs = caches();
    for (var i = 0; i < cs.length; i++) { var p = cs[i] && cs[i].byName && cs[i].byName[nm]; if (p && !p.is_me) return p; }
    return null;
  }
  function url(p) {
    var spec = p.a || null, key = JSON.stringify([spec, p.seed || "", p.r | 0]);
    if (!spec) return "";   // mbx / avwiz: a person without a saved character keeps the normal pin
    var u = urls[key]; if (u) return u;
    var x = av(), svg = "";
    try { svg = x.svg(spec || x.defaultSpec(p.seed || "x", p.r), { r: p.r, md: [] }); } catch (e) { return ""; }
    if (!svg) return "";
    if (nUrls > 300) { urls = {}; nUrls = 0; }
    u = urls[key] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); nUrls++;
    return u;
  }
  function load() {
    var x = av(); if (!x || !A) return;
    var ps = [];
    try { ps.push(x.forFriends()); } catch (e) {}
    if (Date.now() - groupsAt > 600000 && A.rpc) {
      groupsAt = Date.now();
      ps.push(A.rpc("my_groups").then(function (r) {
        gids = ((r && r.data) || []).map(function (g) { return g && g.id; }).filter(Boolean).slice(0, 8);
        return Promise.all(gids.map(function (g) { try { return x.forGroup(g); } catch (e) { return null; } }));
      }).catch(function () { groupsAt = 0; }));
    } else gids.forEach(function (g) { try { ps.push(x.forGroup(g)); } catch (e) {} });
    Promise.all(ps).then(redraw, redraw);
  }
  // load specs now if the app API and AVATAR are ready; else stay "not loaded" so the next pin / poll / init tries again
  function kick() { if (!A || !av()) { loadAt = 0; return; } loadAt = Date.now(); load(); }
  function redraw() {   // once, only when a spec we can now draw was missing
    var s = caches().map(function (c) { return c && c.at; }).join(",");
    if (s === sig) return; sig = s;
    clearTimeout(redrawT); redrawT = setTimeout(function () { try { if (A && A.render) A.render(); } catch (e) {} }, 300);
  }
  window.AVPINS = {
    init: function (api) {
      A = api; if (want) setTimeout(kick, 0);
      if (!document.getElementById("avpins-css")) { var st = document.createElement("style"); st.id = "avpins-css"; st.textContent = CSS; document.head.appendChild(st); }
    },
    // app.js beerIcon: "" or the <img> for this pin
    img: function (b) {
      if (!b || !(b.friend_name || b.is_mine)) return "";
      want = true;
      if (!loadAt) { loadAt = 1; setTimeout(kick, 0); }   // the first friend pin: load specs now
      var p = person(b); if (!p) return "";
      var u = url(p); if (!u) return "";
      return '<img class="bm-av" alt="" aria-hidden="true" decoding="async" src="' + u + '">';
    },
    // a cluster chip: up to max faces (me first, then friends with a loaded character), "" = the plain number chip
    faces: function (list, max) {
      var out = "", n = 0, seen = {};
      (list || []).slice().sort(function (a, b) { return (b && b.is_mine ? 1 : 0) - (a && a.is_mine ? 1 : 0); }).forEach(function (b) {
        if (n >= (max || 2) || !b || !(b.friend_name || b.is_mine)) return;
        var k = b.is_mine ? "me" : "f:" + b.friend_name; if (seen[k]) return; seen[k] = 1;
        var h = window.AVPINS.img(b); if (h) { out += h; n++; }
      });
      return out;
    },
    // specs change rarely: at most one refresh per 5 min while friend pins are on the map (the first one at once)
    onPoll: function () { if (want && (!loadAt || Date.now() - loadAt > 300000)) kick(); },
    onAuthed: function () { if (want) setTimeout(kick, 1500); },
    _urls: function () { return nUrls; }
  };
})();
