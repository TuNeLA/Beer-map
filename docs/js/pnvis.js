/* PintsNow — Synlighet (ds42, ux3 #8): ONE control for who sees you on the map, on the rail button (was a Spökläge toggle):
     Alla      = everyone sees your area (or your bar); friends see your pin (as before)
     Bara vänner = friends + group mates see you; strangers see nothing (server: set_visibility, migration 0340, owner-run)
     Spöke     = nobody sees you; your drinks still count (the existing spökläge: olnu.ghostMode + post_beer_v2 p_hidden)
   The "Bara vänner" option shows only when the server has it (my_visibility answers); else Alla / Spöke as before.
   Same pattern as the system location choices (one short label, the current state on the button, one tap to change, the
   explanation under the choice once). Tap the rail button = a small menu with the segmented control.
   S2 (lane main, 10 Nov; owner: "Göm pin, Spökläge, SOS and Hemzon get quick access in the right rail, the full settings
   live in Inställningar"): under the control, the same rows as the Ikväll menu (.pn-ikm-list): Göm min pin (only with a pin
   tonight → app.js showStopSheet), Hemzon (state in the sub line → homezone.js), SOS till gänget (only when SOS works →
   the existing social.js block with Ring 112, in a small sheet), Alla inställningar (→ the Inställningar tab).
   R1-12: the menu never covers the rail (width = min(320, rail left − 8 − 12)).
   Rail label (first nights, js/pnds.js ds05 rail): the word under the eye follows the state (Synlig / Vänner / Spöke).
   window.PNVIS = { mode, setMode, open, close, label, settingsBlock, _srv }. Copy: DIALEKT keys "vis.*" (sv-neutral). */
(function () {
  "use strict";
  var KEY = "olnu.visMode", menu = null, srv = null, asked = false;
  var P = {
    "vis.head": "Vem ser dig?",
    "vis.alla": "Alla", "vis.vanner": "Bara vänner", "vis.spoke": "Spöke",
    "vis.allaNote": "Alla ser ditt område (eller din krog). Vänner ser din pin.",
    "vis.vannerNote": "Vänner och gänget ser dig. Andra ser ingenting.",
    "vis.spokeNote": "Ingen ser dig på kartan. Dina öl räknas ändå.",
    "vis.lblAlla": "Synlig", "vis.lblVanner": "Vänner", "vis.lblSpoke": "Spöke",
    "vis.hide": "Göm min pin", "vis.hideSub": "Ta bort pinnen från kartan ikväll",
    "vis.home": "Hemzon", "vis.homeOn": "På · {r} m · hemma syns bara ett område", "vis.homeOff": "Av · sätt ditt hem",
    "vis.sos": "SOS till gänget", "vis.sosSub": "Skicka din exakta plats till gruppen",
    "vis.sosTitle": "SOS", "vis.sosLead": "Bara när något är fel. Vid fara: ring 112.",
    "vis.all": "Alla inställningar", "vis.allSub": "Integritet, plats och trygghet",
    "vis.setHead": "Synlighet & trygghet"
  };
  try { if (window.DIALEKT && window.DIALEKT.register) window.DIALEKT.register("sv-neutral", P); } catch (e) {}
  function T(k, v) { try { if (window.DIALEKT && window.DIALEKT.t) return window.DIALEKT.t(k, v || {}, P[k]); } catch (e) {} return String(P[k] || k).replace(/\{(\w+)\}/g, function (m, n) { return v && v[n] != null ? v[n] : ""; }); }
  function W(n) { return window[n] || null; }
  function api() { try { return W("PNDS") && W("PNDS")._A ? W("PNDS")._A() : null; } catch (e) { return null; } }
  function ic(n, c) { try { return W("PNI") ? W("PNI").svg(n, c || "") : ""; } catch (e) { return ""; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function ghost() { return ls("olnu.ghostMode") === "1"; }
  function mode() { return ghost() ? "spoke" : ls(KEY) === "vanner" && srv !== false ? "vanner" : "alla"; }
  var TXT = { alla: ["vis.alla", "eye", "vis.allaNote", "vis.lblAlla"],
    vanner: ["vis.vanner", "users", "vis.vannerNote", "vis.lblVanner"],
    spoke: ["vis.spoke", "eye-off", "vis.spokeNote", "vis.lblSpoke"] };
  function label() { return T(TXT[mode()][3]); }
  function probe() {
    if (asked) return; var A = api(); if (!A || !A.rpc || !A.LIVE) return; asked = true;
    A.rpc("my_visibility").then(function (r) {
      if (r && r.error) { srv = false; return; }
      var d = A.parseData ? A.parseData(r.data) : r.data; srv = true;
      if (d && d.friends_only && !ghost()) ls(KEY, "vanner");
      paint();
    }, function () { srv = false; });
  }
  function setMode(m) {
    var A = api(), prev = mode(); if (m === prev) return;
    if (m === "spoke") ls("olnu.ghostMode", "1"); else ls("olnu.ghostMode", "0");
    if (m !== "spoke") ls(KEY, m);
    if (srv && A && A.rpc) A.rpc("set_visibility", { p_friends_only: m === "vanner" }).then(function (r) {
      if (r && r.error) { ls(KEY, prev === "vanner" ? "vanner" : "alla"); paint(); try { A.toast("Det gick int' att ändra. Försök igen.", { err: true }); } catch (e) {} }
    });
    try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}
    try { if (A && A.toast) A.toast(m === "spoke" ? "Spöke: ingen ser dig. Ölen räknas ändå." : m === "vanner" ? "Bara vänner ser dig nu." : "Alla ser ditt område igen.", { id: "pn-vis", ms: 3000 }); } catch (e) {}
    paint(); if (menu) fill();
  }
  function paint() {
    var b = document.getElementById("pn-ghost"); if (!b) return;
    var m = mode(), t = TXT[m], name = T(t[0]);
    if (b.getAttribute("data-vis") !== m) {
      b.setAttribute("data-vis", m);
      var dot = b.querySelector(".pn-rail-dot"), lb = b.querySelector(".mn-rail-l"); b.innerHTML = ic(t[1]); if (dot) b.appendChild(dot); if (lb) b.appendChild(lb);
    }
    var l = b.querySelector(".mn-rail-l"); if (l && l.textContent !== T(t[3])) l.textContent = T(t[3]);
    b.setAttribute("aria-label", "Synlighet: " + name + ". Ändra"); b.title = "Synlighet: " + name;
    b.setAttribute("aria-pressed", String(m !== "alla")); b.setAttribute("aria-haspopup", "menu");
  }

  /* ---------- S2 quick rows (same look as the Ikväll menu rows, .pn-ikm-row) ---------- */
  function row(icon, title, sub, onClick, cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = "pn-ikm-row mn-vis-row" + (cls ? " " + cls : "");
    b.innerHTML = ic(icon, "pn-ikm-i") + '<span class="pn-ikm-l"><b>' + esc(title) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span>" + ic("chev-right", "pn-ikm-c");
    b.addEventListener("click", function (e) { e.stopPropagation(); onClick(e); }); return b;
  }
  function myPin() { var A = api(); try { return !!(A && A.LIVE && A.myBeer && A.myBeer() && A.showStopSheet); } catch (e) { return false; } }
  function homeSub() { var H = W("HOMEZONE"), h = null; try { h = H && H.home ? H.home() : null; } catch (e) {} return h ? T("vis.homeOn", { r: h.r || 300 }) : T("vis.homeOff"); }
  function sosOk() {   // social.js draws nothing when SOS is off (not live / old server): then no row
    var S = W("SOCIAL"); if (!S || !S.sosBlock) return false;
    var d = document.createElement("div"); try { S.sosBlock(d); } catch (e) { return false; }
    return !!d.querySelector(".sos-block");
  }
  function openSos() {
    var A = api(), S = W("SOCIAL"); if (!A || !A.openSheet || !S) return;
    A.openSheet(T("vis.sosTitle"), function (body) {
      var p = document.createElement("p"); p.className = "muted mn-vis-sos-p"; p.textContent = T("vis.sosLead"); body.appendChild(p);
      try { S.sosBlock(body); } catch (e) {}
    });
  }
  function openSettings() {
    var b = document.getElementById("btn-settings"); if (!b) return;
    b.click();
    setTimeout(function () { var t = document.querySelector('#sheet-body [role="tab"][data-pf="s"]'); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }, 60);
  }
  function quickRows(opts) {
    opts = opts || {}; var out = [];
    if (myPin()) out.push(row("pin", T("vis.hide"), T("vis.hideSub"), function () { close(); try { api().showStopSheet(); } catch (e) {} }, "mn-vis-hide"));
    if (W("HOMEZONE") && W("HOMEZONE").open && (api() || {}).LIVE) out.push(row("home", T("vis.home"), homeSub(), function () { close(); try { W("HOMEZONE").open(); } catch (e) {} }, "mn-vis-home"));
    if (sosOk()) out.push(row("sos", T("vis.sos"), T("vis.sosSub"), function () { close(); openSos(); }, "mn-vis-sos"));
    if (!opts.noAll) out.push(row("gear", T("vis.all"), T("vis.allSub"), function () { close(); openSettings(); }, "mn-vis-all"));
    return out;
  }
  function seg(m, opts) {
    var s = document.createElement("div"); s.className = "gm-seg pn-vis-seg"; s.setAttribute("role", "radiogroup"); s.setAttribute("aria-label", "Synlighet");
    opts.forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === m)); b.setAttribute("data-vis", k);
      b.innerHTML = ic(TXT[k][1]) + "<span>" + esc(T(TXT[k][0])) + "</span>"; b.addEventListener("click", function (e) { e.stopPropagation(); setMode(k); if (s.__fill) s.__fill(); });
      s.appendChild(b);
    });
    return s;
  }
  function fill() {
    var m = mode(), opts = srv === false ? ["alla", "spoke"] : ["alla", "vanner", "spoke"];
    menu.innerHTML = '<p class="pn-ikm-h">' + esc(T("vis.head")) + "</p>";
    menu.appendChild(seg(m, opts));
    var p = document.createElement("p"); p.className = "pn-vis-note"; p.textContent = T(TXT[m][2]); menu.appendChild(p);
    var rows = quickRows();
    if (rows.length) { var list = document.createElement("div"); list.className = "pn-ikm-list mn-vis-list"; rows.forEach(function (r) { list.appendChild(r); }); menu.appendChild(list); }
  }
  function place() {
    var b = document.getElementById("pn-ghost"); if (!b || !menu) return;
    var r = b.getBoundingClientRect(), w = Math.max(200, Math.min(320, r.left - 8 - 12));   // R1-12: never over the rail
    menu.style.width = w + "px"; menu.style.top = Math.round(r.top) + "px"; menu.style.left = Math.round(Math.max(12, r.left - 8 - w)) + "px";
    menu.style.maxHeight = Math.max(160, Math.round(innerHeight - r.top - 12)) + "px";
  }
  function open() {
    var b = document.getElementById("pn-ghost"); if (!b || menu) return;
    probe();
    menu = document.createElement("div"); menu.className = "pn-ikm pn-vis"; menu.id = "pn-vis"; menu.setAttribute("role", "menu");
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(menu); fill(); place();
    b.setAttribute("aria-expanded", "true");
    setTimeout(function () { document.addEventListener("click", out, true); document.addEventListener("keydown", esc2); addEventListener("resize", place); }, 0);
  }
  function close() {
    if (!menu) return; var m = menu; menu = null; m.classList.add("pn-vis-out"); setTimeout(function () { m.remove(); }, 160);   // ui1 B6: own class (.pn-out = the "Ute ikväll" card style made the menu jump)
    var b = document.getElementById("pn-ghost"); if (b) b.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", out, true); document.removeEventListener("keydown", esc2); removeEventListener("resize", place);
  }
  function out(e) { var b = document.getElementById("pn-ghost"); if (menu && !menu.contains(e.target) && !(b && b.contains(e.target))) close(); }
  function esc2(e) { if (e.key === "Escape") close(); }
  // Inställningar (social-b places it): the same control + rows as one section. Returns a section element.
  function settingsBlock() {
    var sec = document.createElement("section"); sec.className = "ds-section mn-vis-set";
    var hd = document.createElement("h3"); hd.className = "ds-section-h"; hd.textContent = T("vis.setHead"); sec.appendChild(hd);
    var box = document.createElement("div"); box.className = "ds-list mn-vis-setl"; sec.appendChild(box);
    var paintSet = function () {
      probe();
      var m = mode(), opts = srv === false ? ["alla", "spoke"] : ["alla", "vanner", "spoke"];
      box.innerHTML = "";
      var top = document.createElement("div"); top.className = "mn-vis-settop";
      var s = seg(m, opts); s.__fill = function () { setTimeout(paintSet, 0); }; top.appendChild(s);
      var p = document.createElement("p"); p.className = "pn-vis-note"; p.textContent = T(TXT[m][2]); top.appendChild(p);
      box.appendChild(top);
      quickRows({ noAll: true }).forEach(function (r) { box.appendChild(r); });
    };
    paintSet();
    return sec;
  }
  // Inställningar (lane main batch 2, owner: "full settings live in Inställningar"): top-level elements for account.js'
  // settingsSheet hook. ds.js puts each in "Integritet & säkerhet" (secOf .mn-vis-set / .mn-vis-srow), pnds ds20 ranks them
  // first there. Same functions as the rail menu, but ds rows (the Inställningar look), so no card in a card.
  function srow(icon, title, sub, fn, cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = "ds-row pn-row mn-vis-srow " + cls;
    b.innerHTML = '<span class="ds-row-i" aria-hidden="true">' + ic(icon) + '</span><span class="ds-row-t"><span>' + esc(title) + "</span><small>" + esc(sub) + '</small></span><span class="ds-chev" aria-hidden="true"></span>';
    b.addEventListener("click", function () { fn(); }); return b;
  }
  function settingsRows() {
    var top = document.createElement("div"); top.className = "mn-vis-set";
    var paintTop = function () {
      probe();
      var m = mode(), opts = srv === false ? ["alla", "spoke"] : ["alla", "vanner", "spoke"];
      top.innerHTML = '<span class="mn-vis-set-l">' + ic("eye", "pi-lead") + "<span>" + esc(T("vis.head")) + "</span></span>";
      var sg = seg(m, opts); sg.__fill = function () { setTimeout(paintTop, 0); }; top.appendChild(sg);
      var p = document.createElement("small"); p.className = "pn-vis-note mn-vis-set-n"; p.textContent = T(TXT[m][2]); top.appendChild(p);
    };
    paintTop();
    var out = [top];
    if (myPin()) out.push(srow("pin", T("vis.hide"), T("vis.hideSub"), function () { try { api().showStopSheet(); } catch (e) {} }, "mn-vis-hide"));
    if (W("HOMEZONE") && W("HOMEZONE").open && (api() || {}).LIVE) out.push(srow("home", T("vis.home"), homeSub(), function () { try { W("HOMEZONE").open(); } catch (e) {} }, "mn-vis-home"));
    if (sosOk()) out.push(srow("sos", T("vis.sos"), T("vis.sosSub"), openSos, "mn-vis-sos"));
    return out;
  }
  // the rail button keeps its id/place (pnds ds05); its own toggle is replaced by the menu (capture: runs first)
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("#pn-ghost") : null; if (!b) return;
    e.stopImmediatePropagation(); e.preventDefault(); menu ? close() : open();
  }, true);
  setInterval(function () { paint(); probe(); }, 1500);
  window.PNVIS = { mode: mode, setMode: setMode, open: open, close: close, label: label, settingsBlock: settingsBlock, settingsRows: settingsRows, _srv: function () { return srv; } };
})();
