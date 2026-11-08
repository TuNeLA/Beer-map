/* PintsNow — 🏠 HEM-LÄGE (agent bold, owner OK 2026-11-08, flag bold_hemlage). window.BOLD_HEM.
   One calm, dark, full-screen view for late at night: Följ mig hem · Ring taxi · a sober friend (Skjuts?) · Hämta mig ·
   Nattmat (when open ≤ 1 km) · Ring 112 small at the bottom. Big targets in the lower part (thumb zone), little text.
   No logic of its own: HEMFOLJ.open, SKJUTS.openPickup / loadDrivers / rideAsk, OPPET.nmNear, verified taxi numbers in
   js/bold-taxi.js (BOLD_TAXI; none within 30 km = a map search "taxi" at your position, never an unchecked number).
   Ways in: the Ikväll chip menu (PNIKV row), the 🚕 Hemfärd sheet and the "krogen stänger" toast (oppet.js opens us
   instead), and the auto-suggest: ONE calm card per night "Hem nu?" when (a) it is 01:00–05:00 and I was out tonight and
   the app is in front, or (b) after 23:30 I left my last bar (checked out, or 2 fixes ≥ 2 min apart > 150 m from it).
   Never when: Följ mig hem is on, Ikväll = Hemma, auto-hemma fired, I am in my home zone, Jag kör is on, a sheet / camera /
   banner is up. "Inte nu" = not again tonight. Offline: Följ mig hem / Skjuts? / Hämta mig are grey ("Ingen täckning");
   taxi and 112 still work (no server needed). Driving myself: title "Kör försiktigt", only Följ mig hem + 112.
   Public: BOLD_HEM = { open(o) → true when shown (flag on), close(), menuRow(rowFn, closeMenu), _suggest(force), _state() }. */
(function () {
  "use strict";
  var U = window.U;
  var KEY = "bold_hemlage", SUG_KEY = "olnu.bhSug", NEAR_M = 30000, LEFT_M = 150, LEFT_GAP = 2 * 60e3;
  var A = null, ov = null, sug = null, groups = null, groupsAt = 0, lastCi = null, far = null;
  var lines = { sub: ["Ta det lugnt.", "Ett glas vatten innan du går?", "Basen väntar. Ingen brådska.", "Lugnt och fint hela vägen."] };

  function W(n) { return window[n] || null; }
  function on() { try { return !!(W("BOLD") && W("BOLD").on(KEY)); } catch (e) { return false; } }
  function ic(n, c) { try { return W("PNI") ? W("PNI").svg(n, c || "") : ""; } catch (e) { return ""; } }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function log(name, p) { try { if (W("PNLOG") && W("PNLOG").event) W("PNLOG").event("bh." + name, p || {}); } catch (e) {} }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function wall(ms) {
    try { if (W("OPPET") && W("OPPET").wall) return W("OPPET").wall(ms == null ? Date.now() : ms); } catch (e) {}
    var d = new Date(ms == null ? Date.now() : ms); return { dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() };
  }
  function evening() { var d = new Date(Date.now() - 6 * 3600e3); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function hhmm() { var m = wall().min; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function pos() { var c = null; try { c = (A && A.lastLoc && A.lastLoc()) || null; } catch (e) {} return c && isFinite(c.lat) && isFinite(c.lng) ? c : null; }
  function dist(a, b) { return U.haversine(a.lat, a.lng, b.lat, b.lng); }
  function online() { return navigator.onLine !== false; }
  function driving() { try { return !!(W("SKJUTS") && W("SKJUTS").driving && W("SKJUTS").driving()); } catch (e) { return false; } }
  function walk() { try { var m = W("HEMFOLJ") && W("HEMFOLJ")._mine && W("HEMFOLJ")._mine(); return m && m.live ? m : null; } catch (e) { return null; } }
  function ikv() { try { var k = W("PNUI") && W("PNUI")._ikvRaw && W("PNUI")._ikvRaw(); return k && k.d ? k.d.mine || null : null; } catch (e) { return null; } }
  function inHome(c) { try { return !!(c && W("PRIVACY") && W("PRIVACY").inHome && W("PRIVACY").inHome(c.lat, c.lng)); } catch (e) { return false; } }
  function autoHomed() { try { var s = W("AUTOHOME") && W("AUTOHOME").state && W("AUTOHOME").state(); return !!(s && (s.done || s.acted)); } catch (e) { return false; } }
  function outTonight() {
    try {
      if (A.myBeer && A.myBeer()) return true;
      if (A.myCheckin && A.myCheckin()) return true;
      var n = A.myNight && A.myNight(); if (n && (n.count | 0) > 0 && (!n.expires || n.expires > Date.now())) return true;
    } catch (e) {}
    return !!lastCi;
  }
  function busyScreen() {
    if (ov) return true;
    try { if (A.sheetOpen && A.sheetOpen()) return true; } catch (e) {}
    return !!document.querySelector(".fm-ov, .ph-ov, .sk-ov, .pn-ikm, #sk-banner:not([hidden])");
  }

  /* ---------- taxi (verified only) ---------- */
  function taxi() {
    var c = pos(), best = null, bd = NEAR_M;
    if (c) (W("BOLD_TAXI") || []).forEach(function (t) { var d = U.haversine(c.lat, c.lng, t.lat, t.lng); if (d <= bd) { bd = d; best = t; } });
    if (best) return { kind: "tel", href: "tel:" + best.tel, name: best.name, text: best.text };
    var q = c ? "@" + (+c.lat).toFixed(5) + "," + (+c.lng).toFixed(5) + ",14z" : "";
    return { kind: "map", href: "https://www.google.com/maps/search/taxi/" + q, name: "Hitta taxi nära dig", text: "Öppnar kartan med taxibolag här" };
  }
  function townName() {
    var c = pos(), best = null, bd = NEAR_M;
    if (!c) return "";
    var list = [].concat(W("BOLD_TAXI") || [], (W("TAXI_DATA") && W("TAXI_DATA").towns) || []);
    list.forEach(function (t) { var d = U.haversine(c.lat, c.lng, t.lat, t.lng); if (d <= bd) { bd = d; best = t; } });
    return best ? String(best.town).replace(/\s*\(.*\)$/, "") : "";
  }

  /* ---------- sober friends (Jag kör) ---------- */
  function loadGroups() {
    if (groups && Date.now() - groupsAt < 5 * 60e3) return Promise.resolve(groups);
    return A.rpc("my_groups").then(function (r) {
      groups = (r && !r.error && Array.isArray(r.data)) ? r.data.filter(function (g) { return g && g.id && !g.dm && !g.ev && !g.evg; }) : (groups || []);
      groupsAt = Date.now(); return groups;
    }, function () { return groups || []; });
  }
  function drivers() {
    var S = W("SKJUTS");
    if (!S || !S.loadDrivers || !A || !A.rpc) return Promise.resolve([]);
    return loadGroups().then(function (gs) {
      gs = gs.slice().sort(function (a, b) { return (b.active_count | 0) - (a.active_count | 0); }).slice(0, 6);
      return Promise.all(gs.map(function (g) { return Promise.resolve(S.loadDrivers(g)).then(function (l) { return (l || []).map(function (d) { return { g: g, d: d }; }); }, function () { return []; }); }));
    }).then(function (all) {
      var seen = {}, out = [];
      all.forEach(function (l) { l.forEach(function (x) { if (!x.d || x.d.is_me) return; var k = (x.d.name || "") + "|" + x.g.id; if (seen[x.d.name]) return; seen[x.d.name] = 1; seen[k] = 1; out.push(x); }); });
      return out.slice(0, 2);
    });
  }

  /* ---------- the screen ---------- */
  function btn(cls, icon, title, sub, onClick, href) {
    var b = el(href ? "a" : "button", "bh-b " + (cls || ""),
      ic(icon, "bh-i") + '<span class="bh-l"><b>' + esc(title) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span>");
    if (href) { b.href = href; if (/^https?:/.test(href)) { b.target = "_blank"; b.rel = "noopener noreferrer"; } }
    else b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function then(fn) { return function (e) { if (e) e.preventDefault(); close(); setTimeout(function () { try { fn(); } catch (x) {} }, 120); }; }
  function paint() {
    if (!ov) return;
    var box = ov.querySelector(".bh-box"), net = online(), drv = driving(), w = walk(), town = townName();
    box.innerHTML = "";
    var head = el("div", "bh-head");
    head.appendChild(el("h2", "bh-t", esc(drv ? "Kör försiktigt" : "Hem nu?")));
    head.appendChild(el("p", "bh-s", esc(hhmm() + (town ? " · " + town : "") + ". " + (drv ? "Du kör ikväll. Ingen brådska." : ov.__sub))));
    var x = el("button", "bh-x", ic("x", "")); x.type = "button"; x.setAttribute("aria-label", "Stäng Hem-läge"); x.addEventListener("click", function () { close(); });
    head.appendChild(x);
    box.appendChild(head);
    box.appendChild(el("div", "bh-gap"));
    var list = el("div", "bh-list");
    var hasH = W("HEMFOLJ") && W("HEMFOLJ").open;
    if (hasH) {
      var fb = btn("bh-pri", "home", w ? "Följ mig hem: på" : "Följ mig hem", !net ? "Ingen täckning just nu" : w ? (w.watching | 0) + " följer dig" : "Gänget ser dig tills du ä hemma",
        then(function () { W("HEMFOLJ").open({}); }));
      if (!net) fb.disabled = true;
      list.appendChild(fb);
    }
    if (!drv) {
      var tx = taxi();
      list.appendChild(btn("bh-taxi" + (tx.kind === "map" ? " bh-map" : ""), "taxi", tx.kind === "tel" ? "Ring taxi" : tx.name,
        tx.kind === "tel" ? tx.name + " · " + tx.text : tx.text, function () { log("taxi", { k: tx.kind }); }, tx.href));
      var drvBox = el("div", "bh-drv-box"); list.appendChild(drvBox);
      if (net) drivers().then(function (ds) {
        if (!ov || !document.body.contains(drvBox)) return;
        ds.forEach(function (x) {
          var row = el("div", "bh-drv", ic("taxi", "bh-i") + '<span class="bh-l"><b>' + esc((x.d.name || "?") + " kör ikväll") + "</b><small>" + esc("Nykter · " + (x.g.name || "gänget")) + "</small></span>");
          var ask = el("button", "bh-ask", "Skjuts?"); ask.type = "button"; ask.setAttribute("aria-label", "Fråga " + (x.d.name || "") + " om skjuts");
          ask.addEventListener("click", function () { log("ride"); try { W("SKJUTS").rideAsk(x.g, x.d, ask); } catch (e) {} });
          row.appendChild(ask); drvBox.appendChild(row);
        });
      });
      if (W("SKJUTS") && W("SKJUTS").openPickup) {
        var pb = btn("", "sos", "Hämta mig", net ? "Skicka var du ä till gänget" : "Ingen täckning just nu", then(function () { W("SKJUTS").openPickup({}); }));
        if (!net) pb.disabled = true;
        list.appendChild(pb);
      }
      try {
        var O = W("OPPET"), c = pos();
        if (O && O.nightMode && O.nightMode() && O.nmNear && c) {
          var nm = (O.nmNear(c, 1) || [])[0];
          if (nm && nm.d <= 1000) list.appendChild(btn("bh-small", "food", "Nattmat öppet: " + (nm.n && nm.n.name || "nära"), Math.round(nm.d / 10) * 10 + " m bort",
            then(function () { O.hudClick("aio-nm"); })));
        }
      } catch (e) {}
    }
    box.appendChild(list);
    var sos = el("div", "bh-sos", '<span>Appen larmar inte själv.</span>');
    var a = el("a", "bh-112", ic("phone", "") + "<span>Ring 112</span>"); a.href = "tel:112";
    sos.appendChild(a); box.appendChild(sos);
  }
  function onNet() { paint(); }
  var ownBack = 0, popOn = false;   // popstate events caused by our own history.back() in close()
  function onPop(e) { if (ownBack > 0) { ownBack--; return; } if (ov && !(e.state && e.state.bh)) close(true); }
  function open(o) {
    if (!on() || !A) return false;
    o = o || {};
    var sheet = false; try { sheet = !!(A.sheetOpen && A.sheetOpen()); } catch (e) {}
    if (sheet) {   // the sheet's own history step must finish first (sheetnav goes back async), then we push ours
      try { A.closeSheet(); } catch (e) {}
      setTimeout(function () { show(o); }, 320);
      return true;
    }
    show(o);
    return true;
  }
  function show(o) {
    hideSug();
    if (ov) { paint(); return; }
    ov = el("div", "bh-ov"); ov.id = "bh-ov";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Hem-läge");
    ov.__sub = pick(lines.sub); ov.__at = Date.now();
    ov.appendChild(el("div", "bh-box"));
    document.body.appendChild(ov); document.body.classList.add("bh-on");
    paint();
    // taxi-data.js is a lazy content file: load it now if the app has not yet, then repaint (verified taxi row)
    try { if (!window.TAXI_DATA && window.OLNU_LAZY_NOW) window.OLNU_LAZY_NOW().then(function () { if (ov) paint(); }); } catch (e) {}
    try { var st = history.state || {}; history.pushState({ bh: 1, olnuNav: typeof st.olnuNav === "number" ? st.olnuNav : 0 }, ""); ov.__hist = true; } catch (e) {}
    if (!popOn) { popOn = true; addEventListener("popstate", onPop); }
    addEventListener("online", onNet); addEventListener("offline", onNet);
    document.addEventListener("keydown", onKey);
    ov.tabIndex = -1; try { ov.focus({ preventScroll: true }); } catch (e) {}   // screen readers start in the dialog; no ring on a button
    log("open", { via: o.via || "menu" });
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function close(fromPop) {
    if (!ov) return;
    var o = ov; ov = null;
    removeEventListener("online", onNet); removeEventListener("offline", onNet);
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("bh-on");
    o.id = ""; o.classList.add("bh-out"); setTimeout(function () { o.remove(); }, 200);
    if (!fromPop && o.__hist) { try { if (history.state && history.state.bh) { ownBack++; history.back(); } } catch (e) { ownBack = 0; } }
  }

  /* ---------- auto-suggest (once per night) ---------- */
  function suggested() { try { return localStorage.getItem(SUG_KEY) === evening(); } catch (e) { return false; } }
  function markSuggested() { try { localStorage.setItem(SUG_KEY, evening()); } catch (e) {} }
  function blocked() {
    if (!on() || !A || !A.LIVE) return "off";
    try { if (A.authed && !A.authed()) return "auth"; } catch (e) {}
    if (suggested()) return "done";
    if (walk()) return "walk";
    if (ikv() === "hemma") return "hemma";
    if (autoHomed()) return "autohome";
    if (driving()) return "driving";
    if (inHome(pos())) return "home";
    if (!outTonight()) return "not_out";
    return "";
  }
  function why() {
    var m = wall().min;
    if (m >= 60 && m < 300) return "late";
    if (m >= 23 * 60 + 30 || m < 300) {
      var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
      if (lastCi && !ci) return "left";
      if (far && far.n >= 2) return "left";
    }
    return "";
  }
  function trackCi() {
    var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
    if (ci) { lastCi = { lat: ci.lat, lng: ci.lng, id: ci.id, at: Date.now() }; far = null; }
  }
  function onFix(type, x) {
    if (type !== "fix" || !x || !lastCi || !isFinite(x.lat)) return;
    var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
    if (ci) return;
    if (dist(x, lastCi) <= LEFT_M) { far = null; return; }
    if (!far) far = { at: Date.now(), n: 1 };
    else if (Date.now() - far.at >= LEFT_GAP) far.n = 2;
    check();
  }
  function hideSug() { if (sug) { var s = sug; sug = null; s.classList.add("bh-out"); setTimeout(function () { s.remove(); }, 200); } }
  function showSug(reason) {
    if (sug) return;
    markSuggested();
    sug = el("div", "bh-sug"); sug.setAttribute("role", "status");
    sug.innerHTML = ic("home", "bh-i") + '<span class="bh-l"><b>Hem nu?</b><small>' + esc(reason === "left" ? "Du har lämnat krogen. Allt du behöver på ett ställe." : "Sent ute. Allt för hemvägen på ett ställe.") + "</small></span>";
    var go = el("button", "bh-sug-go", "Öppna"); go.type = "button";
    go.addEventListener("click", function () { hideSug(); open({ via: "suggest" }); });
    var no = el("button", "bh-sug-no", "Inte nu"); no.type = "button";
    no.addEventListener("click", function () { log("sug_no"); hideSug(); });
    var row = el("span", "bh-sug-btns"); row.appendChild(no); row.appendChild(go); sug.appendChild(row);
    document.body.appendChild(sug);
    log("sug", { why: reason });
  }
  function check(force) {
    if (sug || ov || document.hidden) return;
    trackCi();
    if (!force && blocked()) return;
    var r = force ? "late" : why();
    if (!r || busyScreen()) return;
    showSug(r);
  }

  /* ---------- Ikväll chip menu row (js/pnikv.js) ---------- */
  function menuRow(rowFn, closeMenu) {
    if (!on() || typeof rowFn !== "function") return null;
    var m = wall().min;
    if (!(m >= 23 * 60 || m < 300)) return null;   // after 23:00 only
    return rowFn("home", "Hem-läge", "Taxi, skjuts och hemvägen", function () { try { closeMenu(); } catch (e) {} open({ via: "ikv" }); });
  }

  var feat = {
    key: KEY,
    init: function (api) {
      A = api;
      try { if (W("AUTOCI") && W("AUTOCI").listen) W("AUTOCI").listen(onFix); } catch (e) {}
      document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(check, 1500); });
    },
    onPoll: function () { check(); },
    onFlags: function () { if (!on()) { hideSug(); close(); } },
    menuRow: function (rowFn, closeMenu) { return menuRow(rowFn, closeMenu); }
  };
  window.BOLD_HEM = { open: open, close: close, menuRow: menuRow, _suggest: check, _state: function () { return { blocked: blocked(), why: why(), lastCi: lastCi, far: far, open: !!ov, sug: !!sug }; } };
  if (W("BOLD")) W("BOLD").add(feat);
})();
