/* PintsNow — 📍 STÄLLEN NÄRA DIG (nf 2026-11-07). Bars AND restaurants / cafés / fast food near the user, nearest first.
   Owner: "his friend opened a prompt about places nearby and saw no restaurants". Cause: the restaurant tiles
   (docs/places/*.json) are loaded only for the map VIEW (the map starts in Ludvika); BARS.nearby() is synchronous, so the
   first "Var dricker du?" sheet away from the map view had bars only, and restaurants only within 150 m (max 4).
   Fix: BARS.ensurePlacesP() waits (max ~1–2.5 s) for the tiles around the spot, BARS.around() scans any radius.
   ONE swappable data function: NEARPLACES.setSource(fn(lat, lng, maxM) → Promise<[{id,name,lat,lng,kind,type,d}]>)
   — the map agent can plug a Mapbox source here; default = window.MAPNEAR.nearby if present, else js/bars.js.
   UI: NEARPLACES.open() = sheet (Alla / Barer / Mat & fika, 2 km → "Visa fler" 5 km → 10 km), NEARPLACES.inline(box, lat,
   lng, pick) = the same rows inside another sheet (app.js "Var dricker du?": "Fler ställen nära"). Deep link ?nara=1.
   Position: the app's last own position; else ONE button asks (never an automatic prompt); else the map centre (noted).
   Hooks (app.js mods): init. CSS: nearplaces.css (tokens --np-*). Swedish only. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, source = null;
  var KIND = {
    pub: ["🍻", "Pub"], bar: ["🍺", "Bar"], nightclub: ["🪩", "Klubb"], biergarten: ["🌳", "Ölträdgård"],
    restaurant: ["🍽️", "Restaurang"], cafe: ["☕", "Café"], fast_food: ["🍔", "Snabbmat"], arena: ["🏟️", "Arena"]
  };
  var STEPS = [2000, 5000, 10000];
  function kindOf(o) { return o.place ? (o.type || "restaurant") : (o.type || "bar"); }
  function isFood(k) { return k === "restaurant" || k === "cafe" || k === "fast_food"; }
  function dist(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (Math.round(m / 100) / 10).toString().replace(".", ",") + " km"; }

  /* ---------- Data (swappable) ---------- */
  function barsSource(lat, lng, maxM) {
    var B = window.BARS;
    if (!B || !B.around) return Promise.resolve([]);
    var wait = B.ensurePlacesP ? B.ensurePlacesP(lat, lng, Math.min(12, maxM / 1000 + 0.5), 2500) : Promise.resolve();
    return wait.then(function () {
      var r = B.around(lat, lng, maxM);
      return r.bars.concat(r.places).map(function (x) {
        var o = x.bar, k = kindOf(o);
        return { id: String(o.id), name: o.name, lat: o.lat, lng: o.lng, kind: isFood(k) ? "food" : "bar", type: k, d: x.d, spot: o };
      });
    });
  }
  function find(lat, lng, maxM) {
    var f = source || (window.MAPNEAR && typeof window.MAPNEAR.nearby === "function" ? window.MAPNEAR.nearby : barsSource);
    var p;
    try { p = Promise.resolve(f(lat, lng, maxM)); } catch (e) { p = Promise.resolve([]); }
    return p.then(function (l) {
      return (Array.isArray(l) ? l : []).filter(function (x) { return x && x.name && isFinite(x.d) && x.d <= maxM; })
        .sort(function (a, b) { return a.d - b.d; });
    }, function () { return []; });
  }

  /* ---------- Position ---------- */
  function here() {
    try { var l = A && A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return { lat: l.lat, lng: l.lng, own: true }; } catch (e) {}
    return null;
  }
  function mapCentre() {
    try { var c = A.map.getCenter(); if (c && isFinite(c.lat)) return { lat: c.lat, lng: c.lng, own: false }; } catch (e) {}
    return null;
  }
  function askPos() {
    var g = A && A.getPosition ? A.getPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }) : Promise.reject({ code: 2 });
    return g.then(function (p) {
      var la = p.coords.latitude, ln = p.coords.longitude;
      try { if (A.setLastLoc) A.setLastLoc(la, ln); } catch (e) {}
      return { lat: la, lng: ln, own: true };
    }, function (err) { try { if (A.locError) A.locError(err); } catch (e) {} return null; });
  }

  /* ---------- Rows ---------- */
  function rowsInto(list, items, onPick) {
    var el = A.el;
    items.forEach(function (x) {
      var k = KIND[x.type] || (x.kind === "food" ? KIND.restaurant : KIND.bar);
      var b = el("button", { type: "button", class: "np-row np-" + x.kind }, [
        el("span", { class: "np-ic", "aria-hidden": "true", text: k[0] }),
        el("span", { class: "np-t" }, [el("span", { class: "np-n", text: x.name }), el("small", { class: "np-k", text: k[1] })]),
        el("span", { class: "np-d", text: dist(x.d) })
      ]);
      b.addEventListener("click", function () { onPick(x); });
      list.appendChild(b);
    });
  }
  function emptyInto(list, step, more) {
    var el = A.el, km = STEPS[step] / 1000;
    var box = el("div", { class: "np-empty" }, [el("p", { class: "np-empty-t", text: "Inga ställen inom " + km + " km" })]);
    if (step + 1 < STEPS.length) box.appendChild(A.btn("Visa fler (" + STEPS[step + 1] / 1000 + " km)", "btn-small np-more", more));
    else box.appendChild(el("p", { class: "muted np-empty-s", text: "Flytta kartan till en stad och försök igen." }));
    list.appendChild(box);
  }

  /* ---------- Sheet ---------- */
  function open(opts) {
    if (!A) return;
    opts = opts || {};
    var el = A.el;
    A.openSheet("📍 Ställen nära dig", function (body) {
      body.classList.add("np-sheet");
      var note = el("p", { class: "muted np-note" });
      var seg = el("div", { class: "np-seg", role: "tablist", "aria-label": "Visa" });
      var list = el("div", { class: "np-list", "aria-live": "polite" });
      body.appendChild(note); body.appendChild(seg);
      // uxfix P1-4: Systembolaget chip (nearest store card + opening hours; js/systemet-pins.js)
      var SBm = window.SYSTEMET;
      if (SBm && SBm.openNearest) body.appendChild(el("div", { class: "np-chips" }, [el("button", { type: "button", class: "np-chip np-sb",
        html: (SBm.icon ? SBm.icon(20) : "") + "<span>Systembolaget</span><small>öppettider</small>",
        onclick: function () { var p = pos && pos.own ? pos : null; A.closeSheet(); setTimeout(function () { SBm.openNearest(p); }, 320); } })]));
      body.appendChild(list);
      var filter = opts.filter || "all", step = 0, pos = here(), all = null, seq = 0;
      [["all", "Alla"], ["bar", "Barer"], ["food", "Mat & fika"]].forEach(function (f) {
        var b = el("button", { type: "button", class: "np-seg-b" + (f[0] === filter ? " on" : ""), role: "tab", "aria-selected": String(f[0] === filter), text: f[1] });
        b.addEventListener("click", function () {
          filter = f[0];
          seg.querySelectorAll(".np-seg-b").forEach(function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); });
          paint();
        });
        seg.appendChild(b);
      });
      function paint() {
        list.innerHTML = "";
        if (!all) { list.appendChild(el("p", { class: "muted np-wait", text: "Letar ställen…" })); return; }
        var items = all.filter(function (x) { return filter === "all" || x.kind === filter; }).slice(0, 40);
        if (!items.length) { emptyInto(list, step, function () { step++; load(); }); return; }
        rowsInto(list, items, function (x) { A.closeSheet(); A.openBar(x.spot || x); });
        if (items.length < 6 && step + 1 < STEPS.length) list.appendChild(el("div", { class: "np-foot" }, [A.btn("Visa fler (" + STEPS[step + 1] / 1000 + " km)", "btn-small np-more", function () { step++; load(); })]));
      }
      function load() {
        all = null; paint();
        var my = ++seq;
        find(pos.lat, pos.lng, STEPS[step]).then(function (l) { if (my !== seq || !document.body.contains(list)) return; all = l; paint(); });
      }
      function start() {
        note.textContent = pos.own ? "Närmast först, inom " + STEPS[step] / 1000 + " km." : "Visar nära kartans mitt. Tryck 📍 för din plats.";
        load();
      }
      if (pos) { start(); return; }
      // No own position: ONE button asks. Meanwhile the map centre.
      var ask = A.btn("📍 Använd min plats", "btn-amber btn-block np-ask", function () {
        ask.disabled = true;
        askPos().then(function (p) { ask.disabled = false; if (p) { pos = p; ask.remove(); step = 0; start(); } });
      });
      body.insertBefore(ask, seg);
      pos = mapCentre();
      if (pos) start(); else { note.textContent = "Tryck på knappen så visar vi ställen nära dig."; list.innerHTML = ""; }
    });
  }

  /* ---------- Inline (inside "Var dricker du?") ---------- */
  function inline(box, lat, lng, onPick, skipIds) {
    var el = A.el, skip = {};
    (skipIds || []).forEach(function (id) { skip[String(id)] = 1; });
    box.innerHTML = "";
    box.appendChild(el("p", { class: "muted np-wait", text: "Letar ställen…" }));
    return find(lat, lng, 1000).then(function (l) {
      box.innerHTML = "";
      var items = l.filter(function (x) { return !skip[x.id]; }).slice(0, 15);
      var list = el("div", { class: "np-list np-inline" });
      if (!items.length) list.appendChild(el("div", { class: "np-empty" }, [el("p", { class: "np-empty-t", text: "Inga fler ställen inom 1 km" })]));
      else rowsInto(list, items, function (x) { onPick(x.spot || x); });
      box.appendChild(list);
      return items.length;
    });
  }

  window.NEARPLACES = {
    find: find, open: open, inline: inline,
    setSource: function (fn) { source = typeof fn === "function" ? fn : null; },
    init: function (api) {
      A = api;
      try { if (/[?&]nara=1\b/.test(location.search)) setTimeout(function () { open(); }, 1800); } catch (e) {}
    }
  };
})();
