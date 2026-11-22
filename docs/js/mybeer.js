/* PintsNow — MYBEER (lane mybeer, owner I-146 + I-147, 22 Nov 2026; options P1 + Q1 from lane d-beerpin). window.MYBEER.
   The beer I picked ("Vilken sort?" strip after ÖL!, or "Jag dricker den här" on a beer page) is "my beer now":
   - I-147 Q1: the ÖL! button takes that beer's colour with a foam head and still bubbles, and its short name ("BLANC") takes the
     place of "ÖL!". During the wait the glass fills with that colour. Text = dark or foam ink, the one with the higher contrast
     (>= 4.5:1, js/mybeer-look.js inkFor). No motion and no extra effect: the same look in store builds (no celebration).
     The beer colour wins over the season colours; the GLÖGG word and mug step back while a beer is set; hats stay on top.
     LÄSK! (js/lask.js, "Jag kör ikväll") wins over the beer: a driver's button is never a beer.
   - It stays after the next ÖL! until 06:00 (local) or until I change it. Ways back to plain ÖL!: "Vanlig ÖL!" in the strip,
     a plain kind of another sort in the strip, the beer page button again, or 06:00.
   - I-146 P1: a drawn mini bottle / can in that beer's 2 colours beside my person pin (js/mapart.js personHTML o.beer) and beside a
     group mate's pin. Strangers never (their pin id rotates; the server answers only for the caller's group mates, under the
     beer privacy of beerlib: alla / vanner / spoke). Clusters and bars show no beer.
   Server (supabase/migrations/0533_beer_now.sql): set_beer_lib(p_beer) (my live pin row; null = take it away) and
   beer_lib_pins(p_ids) (rides the poll bundle, at most once a minute, only while group mates' pins are on the map).
   An old server (PGRST202): my own beer still shows on my button and my pin; no friend beers; no errors, no retries.
   Data on this phone: localStorage olnu.beer.now = { id, n, t, at, sn, pk, c1, c2, liq, sv } (lane beerux started it with
   { id, n, t, at }; an old copy gets its look here). olnu.beer.looks = the looks of friends' beers (max 40), so a friend pin
   does not load the beer library every time. Styles: docs/mybeer.css. Tests: tests/e2e/mybeer-pw.js, tests/unit/mybeer.test.mjs. */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "olnu.beer.now", LOOKS = "olnu.beer.looks", ID = /^[0-9A-Za-z_-]{1,40}$/, PIN = /^[0-9]{1,18}$/;
  var A = null, wrote = "", writing = false, fitKey = "", srv = { set: false, pins: false };
  var pins = {}, pinSig = "", pinAt = 0, pinBusy = false, looks = null, libP = null, redrawT = 0;

  function L() { return W.MYBEER_LOOK; }
  function $(id) { return D.getElementById(id); }
  function en() { return !!(W.I18N && W.I18N.lang === "en"); }
  function tl(sv, e) { return en() ? e : sv; }
  function lsGet(k) { try { return JSON.parse(W.localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { W.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { W.localStorage.removeItem(k); } catch (e) {} }
  function api() { if (A) return A; try { var P = W.PNDS; return P && P._A ? P._A() : null; } catch (e) { return null; } }
  function live() { var a = api(); return !!(a && a.LIVE); }
  function authed() { var a = api(); try { return !!(a && a.LIVE && a.authed && a.authed()); } catch (e) { return false; } }
  function driving() { try { return !!(W.SKJUTS && W.SKJUTS.driving && W.SKJUTS.driving()); } catch (e) { return false; } }
  function missing(err) { return /PGRST202|Could not find the function/i.test(String(err && ((err.code || "") + " " + (err.message || "")))); }
  function parse(d) { var a = api(); try { return a && a.parseData ? a.parseData(d) : d; } catch (e) { return d; } }
  function beerWord() { try { var a = api(); if (a && a.t) return a.t("beer"); } catch (e) {} return en() ? "BEER!" : "ÖL!"; }

  // ---------- my beer now ----------
  // the end of the night of a pick: the next 06:00 local time after it
  function nightEnd(at) { var d = new Date(at); if (d.getHours() >= 6) d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d.getTime(); }
  function current() {
    var x = lsGet(KEY), lk = L();
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID.test(x.id) || !lk) return null;
    var at = +x.at, now = Date.now();
    if (!(at > 0) || at > now + 60e3 || now >= nightEnd(at)) { lsDel(KEY); return null; }   // 06:00: back to plain ÖL!
    var look = lk.clean(x) || lk.look({ name: String(x.n || "") }, null, x.t);
    return { id: x.id, n: String(x.n || "").slice(0, 60), t: typeof x.t === "string" ? x.t : "", at: at, sv: x.sv || "", look: look };
  }
  // x = { id, n name, t strip kind, look | (br brewery, st style id, liq style colour) }
  function pick(x) {
    var lk = L(); if (!x || !lk || typeof x.id !== "string" || !ID.test(x.id)) return null;
    var look = lk.clean(x.look) || lk.look({ name: x.n, brewery: x.br, style: x.st }, x.liq, x.t);
    var o = { id: x.id, n: String(x.n || "").slice(0, 60), t: x.t || "", at: Date.now(), sn: look.sn, pk: look.pk, c1: look.c1, c2: look.c2, liq: look.liq };
    lsSet(KEY, o);
    sync(); redraw(0);
    push(x.id);
    return current();
  }
  function clear() {
    var had = !!lsGet(KEY);
    lsDel(KEY); sync(); redraw(0);
    if (had) push(null);
  }
  // the server copy (for group mates' pins). No live pin yet (no ÖL! tonight) = "no_beer": sent again after the next accepted ÖL!
  function nightKey() { try { var a = api(), m = a && a.myNight && a.myNight(); return m && m.expires ? String(m.expires) : ""; } catch (e) { return ""; } }
  function push(id) {
    if (srv.set || !authed()) return;
    api().rpc("set_beer_lib", { p_beer: id }).then(function (r) {
      if (r && r.error) { if (missing(r.error)) srv.set = true; return; }
      var x = lsGet(KEY); if (id && x && x.id === id) { x.sv = nightKey() || "1"; lsSet(KEY, x); }
    }, function () {});
  }

  // ---------- I-147: the ÖL! button ----------
  function ready(b) { return !b.classList.contains("cooldown") && !b.classList.contains("soon"); }
  var VARS = ["--mb-liq", "--mb-hi", "--mb-lo", "--mb-ink", "--mb-foam", "--mb-fs"], varKey = "";
  function paintVars(b, look) {
    var k = look ? look.liq : "";
    if (k === varKey) return; varKey = k;
    if (!look) { VARS.forEach(function (v) { b.style.removeProperty(v); }); fitKey = ""; return; }
    var ik = L().inkFor(look.liq);
    b.style.setProperty("--mb-liq", ik.fill); b.style.setProperty("--mb-hi", ik.hi); b.style.setProperty("--mb-lo", ik.lo);
    b.style.setProperty("--mb-ink", ik.ink); b.style.setProperty("--mb-foam", L().FOAM);
  }
  // the short name fits inside the round button: one measure, then the size that fits (font width grows with the size)
  function fit(b, l) {
    var key = l.textContent + "|" + b.clientWidth;
    if (key === fitKey || !b.clientWidth) return; fitKey = key;
    var room = b.clientWidth * 0.86, start = b.clientWidth >= 100 ? 30 : 27;
    b.style.setProperty("--mb-fs", start + "px");
    var w = 0; try { var r = D.createRange(); r.selectNodeContents(l); w = r.getBoundingClientRect().width; } catch (e) {}
    if (w > room) b.style.setProperty("--mb-fs", Math.max(11, Math.floor(start * room / w)) + "px");
  }
  function aria(b, c, on) {
    var mine = b.getAttribute("data-mb-aria") === "1";
    if (on) {
      var s = tl("Logga en öl (", "Log a beer (") + c.n + ")";
      if (b.getAttribute("aria-label") !== s) b.setAttribute("aria-label", s);
      b.setAttribute("data-mb-aria", "1");
    } else if (mine) { b.removeAttribute("data-mb-aria"); if (/^(Logga en öl|Log a beer) \(/.test(b.getAttribute("aria-label") || "")) b.removeAttribute("aria-label"); }
  }
  function sync() {
    var b = $("btn-beer"), l = $("beer-label"); if (!b || !l || writing) return;
    var c = current(), on = !!c && live() && !driving();
    if (D.body.classList.contains("pn-mybeer") !== on) D.body.classList.toggle("pn-mybeer", on);
    if (b.classList.contains("mb-on") !== on) b.classList.toggle("mb-on", on);
    paintVars(b, on ? c.look : null);
    var atRest = on && ready(b) && !b.classList.contains("undo"), sn = atRest ? c.look.sn : "";
    writing = true;
    try {
      if (sn) { if (l.textContent !== sn) l.textContent = sn; wrote = sn; fit(b, l); }
      else if (wrote && l.textContent === wrote && ready(b) && !b.classList.contains("undo")) { l.textContent = beerWord(); wrote = ""; }
      aria(b, c, !!sn);
    } finally { writing = false; }
  }

  // ---------- I-146: the mini bottle / can on a pin ----------
  function lookOf(id) {
    if (!looks) { var o = lsGet(LOOKS); looks = o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
    var x = looks[id]; return x ? L().clean(x) : null;
  }
  function keepLook(id, look) {
    lookOf(id); var ks = Object.keys(looks);
    if (ks.length >= 40) delete looks[ks[0]];
    looks[id] = look; lsSet(LOOKS, looks);
  }
  // app-pins.js beerIcon: "" or the html of the mini bottle for this pin (me, or a group mate the server let me see)
  function forPin(b) {
    if (!b || !L()) return "";
    var look = null;
    if (b.is_mine) { var c = current(); look = c && !driving() ? c.look : null; }
    else if (b.friend_name && PIN.test(String(b.id))) { var id = pins[String(b.id)]; look = id ? lookOf(id) : null; }
    var s = look ? L().svg(look) : "";
    return s ? '<i class="pn-beer pn-beer-' + look.pk + '" aria-hidden="true">' + s + "</i>" : "";
  }
  function redraw(ms) {
    clearTimeout(redrawT);
    redrawT = setTimeout(function () { try { var a = api(); if (a && a.render) a.render(); } catch (e) {} }, ms == null ? 300 : ms);
  }
  // the looks of beers that are not on this phone yet: the beer library (lazy file, once), then kept in olnu.beer.looks
  function resolve(ids) {
    var need = ids.filter(function (id) { return !lookOf(id); });
    if (!need.length) return Promise.resolve();
    if (!libP) {
      libP = Promise.resolve().then(function () { return W.PN && PN.beerlib ? PN.beerlib() : null; })
        .then(function (B) { return B && B.load ? B.load().then(function (d) { return { B: B, d: d }; }) : null; })
        .catch(function () { libP = null; return null; });
    }
    return libP.then(function (x) {
      if (!x || !x.d || !x.d.byId) return;
      need.forEach(function (id) {
        var row = x.d.byId[id]; if (!row) return;
        var st = null; try { st = x.B.h && x.B.h.beerStyle ? x.B.h.beerStyle(row) : null; } catch (e) {}
        keepLook(id, L().look(row, st && st.hex, x.B._kind ? x.B._kind(row) : ""));
      });
    });
  }
  function friendIds() {
    var a = api(), l = []; try { l = (a && a.beers && a.beers()) || []; } catch (e) {}
    var ids = [];
    l.forEach(function (b) { if (b && b.friend_name && !b.is_mine && PIN.test(String(b.id))) ids.push(+b.id); });
    return ids.sort(function (x, y) { return x - y; }).slice(0, 200);
  }
  function pollPins() {
    if (srv.pins || pinBusy || !authed()) return;
    var ids = friendIds(), sig = ids.join(",");
    if (!ids.length) { if (Object.keys(pins).length) { pins = {}; redraw(); } pinSig = ""; return; }
    if (sig === pinSig && Date.now() - pinAt < 60000) return;
    pinBusy = true; pinSig = sig; pinAt = Date.now();
    api().rpc("beer_lib_pins", { p_ids: ids }).then(function (r) {
      pinBusy = false;
      if (r && r.error) { if (missing(r.error)) { srv.pins = true; if (Object.keys(pins).length) { pins = {}; redraw(); } } return; }   // one silent fall-back
      var rows = parse(r && r.data), next = {};
      (Array.isArray(rows) ? rows : []).forEach(function (x) {
        if (x && PIN.test(String(x.id)) && typeof x.beer === "string" && ID.test(x.beer) && ids.indexOf(+x.id) >= 0) next[String(x.id)] = x.beer;
      });
      var was = JSON.stringify(pins), now = JSON.stringify(next);
      pins = next;
      var want = Object.keys(next).map(function (k) { return next[k]; });
      resolve(want).then(function () { if (was !== now || want.length) redraw(); });
    }, function () { pinBusy = false; });
  }

  // ---------- start ----------
  function start() {
    var l = $("beer-label"), b = $("btn-beer");
    if (W.MutationObserver && l && b) {
      new MutationObserver(function () { if (!writing) sync(); }).observe(l, { childList: true, characterData: true, subtree: true });
      new MutationObserver(function () { if (!writing) sync(); }).observe(b, { attributes: true, attributeFilter: ["class", "disabled", "aria-label"] });
    }
    sync();
    try { if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { fitKey = ""; sync(); }); } catch (e) {}
    W.addEventListener("resize", function () { fitKey = ""; sync(); });
    // 06:00 and the driving switch: a cheap read once a minute (PN.idle sleeps while the map is out of sight)
    if (W.PN && PN.idle && PN.idle.every) PN.idle.every(sync, 60000); else setInterval(sync, 60000);
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible") sync(); });
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();

  W.MYBEER = {
    init: function (api0) { A = api0; setTimeout(sync, 0); },
    onPoll: function () { sync(); pollPins(); },
    // an accepted ÖL!: the server copy of my beer goes to tonight's pin row once (a beer picked before the first ÖL!)
    onBeerAccepted: function () { var c = current(); if (c && c.sv !== (nightKey() || "1")) setTimeout(function () { push(c.id); }, 1500); },
    current: current, pick: pick, clear: clear, forPin: forPin, sync: sync,
    label: function () { var c = current(); return c && c.look.sn ? c.look.sn : ""; },
    _state: function () { return { pins: pins, srv: srv, wrote: wrote, fitKey: fitKey }; }   // tests
  };
  if (W.PN) PN.mod("MYBEER");
})();
