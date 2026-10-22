/* Öl Nu — 🏷️ TIERS: Airbnb-style pin tiers for the bar markers (CONTRACT "PIN-NIVÅER").
   window.TIERS. No hooks, no RPC, no new buttons, no new markers. app.js calls TIERS.apply() after it draws its bar markers
   (render, renderPlainBars) and on moveend / popupopen / popupclose; the same marker elements only get a class:
   - .cm-full = the full pill: type icon + "5 🍺" + crowd word (Lugnt / Livligt / Packat) + name label (+ 👑 🏰 🚪 🪖 badges).
   - .cm-dot  = a small type-coloured dot (the ICONS glyph at ~19 px, scale .8), no pill, no label, no badge. Nothing is removed:
                the dot is still a 44 × 44 px tap target and opens the normal bar sheet.
   Who gets the full pill (in view only; markers off screen keep their tier until they come into view):
     1. the selected bar (its sheet / popup is open) always;
     2. then by priority: friends / me / call-out here > crowd (pins × 10 + check-ins × 4) > 👑 crown > 📅 event tonight > rest;
        same priority: the one that was full before, then the one nearer the centre (no flicker on small pans);
     3. at most capFor(zoom) per view: z ≤ 12: 6 · z13: 12 · z15: 25 · z17+: 40 (linear in between);
     4. a full pill may not overlap a full pill with higher priority (box ≈ icon + count pill, 48 × 48 px) → it becomes a dot;
     5. eligible: bars with people / check-ins / call-outs from zoom 11; 👑 / 📅 bars from zoom 13; empty bars from zoom 16;
        never under the HUD (top bar, ticker, round buttons on the right): there it stays a dot (owner: "piles up under the buttons").
   Zoom ≥ 16 (.tz-hi): a clear centred disc (full 32 px, dot 28 px) with every badge in a fixed slot around it.
   Zoom rules (CSS here): z < 12.5 (olnu-zxlo) dots are hidden (only heat + the few top pills); z13 icons back, empty dots
   hidden; z ≥ 14 every dot shows. Tier changes fade / scale in 160 ms (none with prefers-reduced-motion).
   Cost: no DOM reads (projected points only), class writes only on change. TIERS.stats = {n, ms, last, full, dot}. */
(function () {
  "use strict";
  var stats = { n: 0, ms: 0, last: 0, max: 0, full: 0, dot: 0, inView: 0 };
  var tierById = {};   // bar id -> "f" | "d" (last tier, so a re-created marker starts in it: no flash on the 30 s poll)
  var BOX_W = 48, BOX_H = 48, MARGIN = 40;
  var CSS =
    // dot: icon scaled to ~19 px, everything else faded out (visibility so it is not tappable / not read by screen readers)
    ".cm .bar-ico{transition:transform .16s ease-out,opacity .16s ease-out}" +
    ".cm.cm-dot .bar-ico{transform:translate(-50%,-50%) scale(.8)}" +
    ".cm.cm-dot.cm-empty .bar-ico{opacity:.82}" +
    ".cm .pill,.cm .cm-rally,.cm .cm-ci,.cm .cm-b,.cm .cm-lbl,.cm .bi-tag,.cm .bi-ev,.cm .bi-flag,.cm .bi-q{transition:opacity .16s ease-out,visibility 0s linear 0s}" +
    ".cm.cm-dot .pill,.cm.cm-dot .cm-rally,.cm.cm-dot .cm-ci,.cm.cm-dot .cm-b,.cm.cm-dot .cm-lbl,.cm.cm-dot .bi-tag,.cm.cm-dot .bi-ev,.cm.cm-dot .bi-flag,.cm.cm-dot .bi-q" +
      "{opacity:0;visibility:hidden;transition:opacity .16s ease-out,visibility 0s linear .16s}" +
    ".cm.cm-dot .cm-rally{animation:none}" +
    // full: the name label shows at every zoom (collision pass in app.js placeLabels still hides one that would touch)
    ".cm.cm-full .cm-lbl,.olnu-zlo .cm.cm-full .cm-lbl{display:block}" +
    ".cm.cm-dot .cm-lbl{display:block}" +
    ".cm.cm-full .bar-ico.ic-mk{box-shadow:0 0 0 1px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.55)}" +
    ".cm.cm-full.cm-hot .bar-ico.ic-mk{box-shadow:0 0 0 2px var(--amber-2,#ffb43a),0 2px 7px rgba(0,0,0,.6)}" +
    // zoom 13: icons back for the town view (app.js olnu-zlo hid them below 14); empty dots still hidden
    ".olnu-zlo:not(.olnu-zxlo) .cm .bar-ico{display:grid}" +
    ".olnu-zlo .cm.cm-dot.cm-empty{opacity:0;pointer-events:none}" +
    // town view (z ≤ 12): only heat + the top pills
    ".olnu-zxlo .cm.cm-dot{opacity:0;pointer-events:none}" +
    ".leaflet-marker-icon.cm{transition:opacity .16s ease-out}" +
    // zoom ≥ 16 (.tz-hi): a clear centred disc (full 32 px, dot 28 px) and every badge in a fixed slot around it:
    // 👑 top-left · 🪖 top-right · 🎤/📅 event top-left on the disc · price tag top-right · 🚪 left · 🏰 right · pill below · name under it
    ".tz-hi .cm .bar-ico{width:32px;height:32px}" +
    ".tz-hi .cm .bar-ico.ic-mk>svg.ic{width:18px;height:18px}" +
    ".tz-hi .cm.cm-dot .bar-ico{transform:translate(-50%,-50%) scale(.875)}" +
    ".tz-hi .cm.cm-dot.cm-empty .bar-ico{opacity:.92}" +
    ".tz-hi .cm .bi-ev{left:-7px;top:-7px;font-size:13px}" +
    ".tz-hi .cm .cm-king{left:-4px;top:-6px;font-size:14px}" +
    ".tz-hi .cm .cm-rally{left:calc(50% + 11px);top:-8px}" +
    ".tz-hi .cm .cm-ci{right:calc(50% + 20px);top:50%;transform:translateY(-50%)}" +
    ".tz-hi .cm .cm-flag{left:calc(50% + 17px);top:calc(50% - 8px)}" +
    ".tz-hi .cm .pill{top:calc(50% + 30px)}" +
    ".tz-hi .cm .cm-lbl{top:calc(50% + 19px)}" +
    ".tz-hi .cm .cm-lbl.below{top:calc(50% + 43px)}" +
    "@media (prefers-reduced-motion:reduce){.cm .bar-ico,.cm .pill,.cm .cm-rally,.cm .cm-ci,.cm .cm-b,.cm .cm-lbl,.cm .bi-tag,.cm .bi-ev,.cm .bi-flag,.cm .bi-q," +
      ".cm.cm-dot .pill,.cm.cm-dot .cm-rally,.cm.cm-dot .cm-ci,.cm.cm-dot .cm-b,.cm.cm-dot .cm-lbl,.cm.cm-dot .bi-tag,.cm.cm-dot .bi-ev,.cm.cm-dot .bi-flag,.cm.cm-dot .bi-q," +
      ".leaflet-marker-icon.cm{transition:none}}";
  function style() {
    if (document.getElementById("tiers-css") || !document.head) return;
    var s = document.createElement("style"); s.id = "tiers-css"; s.textContent = CSS; document.head.appendChild(s);
  }
  if (document.head) style(); else document.addEventListener("DOMContentLoaded", style);

  // Full pills per view.
  function capFor(z) {
    if (z < 13) return 6;
    if (z < 15) return Math.round(12 + (z - 13) / 2 * 13);
    if (z < 17) return Math.round(25 + (z - 15) / 2 * 15);
    return 40;
  }
  // c = app.js composite {bar, beers, rallies, cis, tk: {king, ev}}. Returns {s: score, el: minimum zoom}.
  function rank(c) {
    var beers = c.beers || [], cis = c.cis || [], tk = c.tk || {};
    var fr = (c.rallies && c.rallies.length) || beers.some(function (b) { return b.friend_name || b.is_mine; }) ||
      cis.some(function (x) { return x.is_friend || x.is_mine; });
    var crowd = Math.min(5000, beers.length * 10 + cis.length * 4);
    var s = (fr ? 1e8 : 0) + crowd * 1e4 + (tk.king ? 2000 : 0) + (tk.ev ? 1000 : 0);
    var el = fr || crowd ? 0 : tk.king || tk.ev ? 13 : 16;
    return { s: s, el: el };
  }
  function setTier(m, ic, full, sel) {
    var t = full ? "f" : "d";
    // full pills above dots in the same pane; the selected marker keeps app.js's 30000
    var zi = m.options.olnuPrio != null ? 1000 + m.options.olnuPrio + (full ? 10000 : 0) : null;
    if (zi != null && !sel && m.options.zIndexOffset !== zi) m.setZIndexOffset(zi);
    if (m._olnuTier === t && ic._olnuTier === t) return false;
    m._olnuTier = t; ic._olnuTier = t;
    ic.classList.toggle("cm-full", full); ic.classList.toggle("cm-dot", !full);
    var id = m.options.olnuC && m.options.olnuC.bar && m.options.olnuC.bar.id;
    if (id != null) tierById[id] = t;
    return true;
  }
  // A new marker element (app.js addComposite "add"): start in the tier it had, so a poll redraw does not flash.
  function onAdd(m) {
    var ic = m.getElement && m.getElement(); if (!ic) return;
    var c = m.options.olnuC, id = c && c.bar && c.bar.id;
    var t = id != null && tierById[id] ? tierById[id] : "d";
    m._olnuTier = t; ic._olnuTier = t;
    ic.classList.toggle("cm-full", t === "f"); ic.classList.toggle("cm-dot", t !== "f");
    if (c && !(c.beers && c.beers.length) && !(c.rallies && c.rallies.length) && !(c.cis && c.cis.length)) ic.classList.add("cm-empty");
  }
  // HUD zones (top bar, ticker, streak chip, right-hand round buttons): a full pill there would be half hidden → it stays a dot.
  // Rects are read at most every 2 s (or after a resize), never on each pan.
  var HUD_SEL = ".topbar, .ticker, .hud-left, #btn-heat, #btn-ghostpins, #btn-taxi, #btn-evs, #btn-locate, #chaos, #rally";
  var hud = [], hudAt = 0, hudW = 0, hudH = 0;
  function hudZones(map, W, H) {
    var now = Date.now();
    if (now - hudAt < 2000 && W === hudW && H === hudH) return hud;
    hudAt = now; hudW = W; hudH = H; hud = [];
    try {
      var cr = map.getContainer().getBoundingClientRect();
      document.querySelectorAll(HUD_SEL).forEach(function (e) {
        if (e.hidden) return; var r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
        hud.push({ l: r.left - cr.left - 4, t: r.top - cr.top - 4, r: r.right - cr.left + 4, b: r.bottom - cr.top + 4 });
      });
    } catch (e) {}
    return hud;
  }
  function underHud(zs, x, y) {
    // full-pill box: icon + pill (x ± 24, y − 14 … y + 36)
    for (var i = 0; i < zs.length; i++) { var z = zs[i]; if (x + 24 > z.l && x - 24 < z.r && y + 36 > z.t && y - 14 < z.b) return true; }
    return false;
  }
  function apply(map, layers) {
    if (!map || !layers) return;
    var t0 = performance.now();
    var cont0 = map.getContainer(), hi = map.getZoom() >= 16;
    if (cont0.classList.contains("tz-hi") !== hi) cont0.classList.toggle("tz-hi", hi);
    var z = map.getZoom(), size = map.getSize(), W = size.x, H = size.y, cx = W / 2, cy = H / 2, diag = Math.sqrt(cx * cx + cy * cy) || 1;
    var cand = [], nf = 0, nd = 0, zs = hudZones(map, W, H);
    for (var li = 0; li < layers.length; li++) {
      var ly = layers[li]; if (!ly || !ly.eachLayer) continue;
      ly.eachLayer(function (m) {
        var ic = m.getElement && m.getElement(), c = m.options && m.options.olnuC; if (!ic || !c) return;
        var p = map.latLngToContainerPoint(m.getLatLng());
        if (p.x < -MARGIN || p.y < -MARGIN || p.x > W + MARGIN || p.y > H + MARGIN) return;   // off screen: keep its tier
        var r = rank(c), sel = (m.isPopupOpen && m.isPopupOpen()) || ic.classList.contains("cm-sel");
        var dx = p.x - cx, dy = p.y - cy, near = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / diag);
        cand.push({ m: m, ic: ic, x: p.x, y: p.y, sel: sel, ok: sel || (z >= r.el && !underHud(zs, p.x, p.y)), s: (sel ? 1e12 : 0) + r.s + (m._olnuTier === "f" ? 500 : 0) + near * 400 });
      });
    }
    cand.sort(function (a, b) { return b.s - a.s; });
    var cap = capFor(z), kept = [], full = 0;
    for (var i = 0; i < cand.length; i++) {
      var x = cand[i], want = false;
      if (x.ok && (x.sel || full < cap)) {
        want = true;
        for (var k = 0; k < kept.length; k++) if (Math.abs(kept[k].x - x.x) < BOX_W && Math.abs(kept[k].y - x.y) < BOX_H) { want = x.sel; break; }
      }
      if (want) { kept.push(x); full++; }
      setTier(x.m, x.ic, want, x.sel);
      if (want) nf++; else nd++;
    }
    var ms = performance.now() - t0;
    stats.n++; stats.ms += ms; stats.last = ms; if (ms > stats.max) stats.max = ms; stats.full = nf; stats.dot = nd; stats.inView = cand.length;
  }
  /* ---------- label + badge collision pass (replaces app.js placeLabels while TIERS is loaded; same rules) ----------
     Highest-priority marker first; a badge (🪖 👑 🏰 🚪 crowd word, queue) or a name label that would touch a kept one, or
     another marker's icon / pill, gets .lbl-hide. Icons and people pills are never hidden. Labels: full pills at every zoom,
     every non-dot marker at zoom ≥ 16 (.cm-labels). A dot never blocks a label or badge (lowest tier, drawn under them).
     Speed: every part's box is measured ONCE per marker state (class + zoom class) relative to its marker point and cached;
     a pan then needs no layout read at all (positions = Leaflet's _leaflet_pos), and class writes only where a state changes.
     A part measured while it animates (tier fade / select scale) is measured again next time. */
  var rel = typeof WeakMap === "function" ? new WeakMap() : null, lstats = { n: 0, last: 0, measured: 0 };
  try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", function () { if (rel) rel = new WeakMap(); }); } catch (e) {}
  // a tier fade / select scale still running (CSS transitions only: the endless streak pulses on pills do not move boxes)
  var CT = typeof CSSTransition === "function" ? CSSTransition : null;
  function animating(ic) {
    try { return !!(CT && ic.getAnimations) && ic.getAnimations({ subtree: true }).some(function (a) { return a instanceof CT; }); } catch (e) { return false; }
  }
  function labels(map, BADGES, badgeRank) {
    var t0 = performance.now(), z = map.getZoom(), on = z >= 16, cont = map.getContainer();
    if (cont.classList.contains("cm-labels") !== on) cont.classList.toggle("cm-labels", on);
    var zk = (cont.classList.contains("olnu-zxlo") ? "x" : "") + (cont.classList.contains("tz-hi") ? "h" : "");   // town view: icon hidden; z16+: big disc
    var size = map.getSize(), W = size.x, H = size.y, FAR = 200;
    var icons = cont.querySelectorAll(".leaflet-marker-icon"), items = [], todo = [], i, j, k;
    for (i = 0; i < icons.length; i++) {
      var ic = icons[i], lp = ic._leaflet_pos; if (!lp) continue;
      var p = map.layerPointToContainerPoint(lp);
      if (p.x < -FAR || p.y < -FAR || p.x > W + FAR || p.y > H + FAR) continue;   // far off screen: no effect on the view
      // box keys: only what moves a part — the select scale (cm-sel), and for the icon also its tier scale and the town view
      var dot = ic.classList.contains("cm-dot"), sk = (ic.classList.contains("cm-sel") ? "s" : "") + zk, prio = +(ic.getAttribute("data-prio") || 0);
      var it = { ic: ic, p: p, obs: [], bad: [], lb: null };
      // a dot is the lowest tier: labels and badges of full pills may sit over it (they are drawn above it)
      var ob = dot ? [] : ic.querySelectorAll(".bar-ico, .pill, .rl-pin");
      for (j = 0; j < ob.length; j++) it.obs.push({ el: ob[j], k: ob[j].classList.contains("bar-ico") ? sk + (dot ? "d" : "f") : sk });
      if (!dot) { var bd = ic.querySelectorAll(BADGES); for (j = 0; j < bd.length; j++) it.bad.push({ el: bd[j], k: sk, p: prio * 10 + badgeRank(bd[j]) }); }
      var lb = ic.querySelector(".cm-lbl");
      if (lb && !dot && (on || ic.classList.contains("cm-full"))) it.lb = { el: lb, k: sk, p: prio };
      var parts = it.obs.concat(it.bad); if (it.lb) parts.push(it.lb);
      var anim = null;
      for (j = 0; j < parts.length; j++) {
        var c = rel && rel.get(parts[j].el);
        if (c && c.k === parts[j].k) parts[j].r = c;
        else { if (anim === null) anim = animating(ic); todo.push({ part: parts[j], it: it, key: parts[j].k, anim: anim }); }
      }
      items.push(it);
    }
    // measure what is new (one layout for all of them; hidden ones shown first so their box is real)
    if (todo.length) {
      for (k = 0; k < todo.length; k++) if (todo[k].part.el.classList.contains("lbl-hide")) todo[k].part.el.classList.remove("lbl-hide");
      var cr = cont.getBoundingClientRect();
      for (k = 0; k < todo.length; k++) {
        var tq = todo[k], rr = tq.part.el.getBoundingClientRect(), ox = cr.left + tq.it.p.x, oy = cr.top + tq.it.p.y;
        var box = { k: tq.key, l: rr.left - ox, t: rr.top - oy, r: rr.right - ox, b: rr.bottom - oy, w: rr.width, h: rr.height };
        tq.part.r = box;
        if (rel && !tq.anim) rel.set(tq.part.el, box);
      }
      lstats.measured += todo.length;
    }
    var abs = function (part, p) { var r = part.r; return { left: p.x + r.l, right: p.x + r.r, top: p.y + r.t, bottom: p.y + r.b, w: r.w }; };
    var obstacles = [], badges = [], labs = [];
    items.forEach(function (it) {
      it.obs.forEach(function (o) { if (o.r.w || o.r.h) obstacles.push({ ic: it.ic, r: abs(o, it.p) }); });
      it.bad.forEach(function (x) { x.ic = it.ic; x.a = abs(x, it.p); badges.push(x); });
      if (it.lb) { it.lb.ic = it.ic; it.lb.a = abs(it.lb, it.p); labs.push(it.lb); }
    });
    badges.sort(function (a, b) { return b.p - a.p; });
    labs.sort(function (a, b) { return b.p - a.p; });
    var hit = function (a, b) { return a.left < b.right + 2 && a.right > b.left - 2 && a.top < b.bottom + 1 && a.bottom > b.top - 1; };
    var kept = [], hide = [], show = [];
    var blocked = function (x) {
      for (var q = 0; q < kept.length; q++) if (hit(x.a, kept[q])) return true;
      for (q = 0; q < obstacles.length; q++) if (obstacles[q].ic !== x.ic && hit(x.a, obstacles[q].r)) return true;
      return false;
    };
    badges.forEach(function (x) { if (!x.a.w) return; if (blocked(x)) hide.push(x.el); else { kept.push(x.a); show.push(x.el); } });
    labs.forEach(function (x) {
      var a = x.a;
      if (a.right < 0 || a.left > W || a.bottom < 0 || a.top > H) { show.push(x.el); return; }   // off screen: keep, costs nothing
      if (blocked(x)) hide.push(x.el); else { kept.push(a); show.push(x.el); }
    });
    for (k = 0; k < show.length; k++) if (show[k].classList.contains("lbl-hide")) show[k].classList.remove("lbl-hide");
    for (k = 0; k < hide.length; k++) if (!hide[k].classList.contains("lbl-hide")) hide[k].classList.add("lbl-hide");
    lstats.n++; lstats.last = performance.now() - t0; lstats.items = items.length; lstats.todo = todo.length; lstats.parts = obstacles.length + badges.length + labs.length;
    return true;
  }
  window.TIERS = { apply: apply, onAdd: onAdd, capFor: capFor, rank: rank, labels: labels, stats: stats, lstats: lstats, _byId: tierById };
})();
