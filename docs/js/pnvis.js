/* PintsNow — Synlighet (ds42, ux3 #8): ONE control for who sees you on the map, on the rail button (was a Spökläge toggle):
     Alla      = everyone sees your area (or your bar); friends see your pin (as before)
     Bara vänner = friends + group mates see you; strangers see nothing (server: set_visibility, migration 0340, owner-run)
     Spöke     = nobody sees you; your drinks still count (the existing spökläge: olnu.ghostMode + post_beer_v2 p_hidden)
   The "Bara vänner" option shows only when the server has it (my_visibility answers); else Alla / Spöke as before.
   Same pattern as the system location choices (one short label, the current state on the button, one tap to change, the
   explanation under the choice once). Tap the rail button = a small menu with the segmented control. window.PNVIS. */
(function () {
  "use strict";
  var KEY = "olnu.visMode", menu = null, srv = null, asked = false;
  function W(n) { return window[n] || null; }
  function api() { try { return W("PNDS") && W("PNDS")._A ? W("PNDS")._A() : null; } catch (e) { return null; } }
  function ic(n) { try { return W("PNI") ? W("PNI").svg(n, "") : ""; } catch (e) { return ""; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function ghost() { return ls("olnu.ghostMode") === "1"; }
  function mode() { return ghost() ? "spoke" : ls(KEY) === "vanner" && srv !== false ? "vanner" : "alla"; }
  var TXT = { alla: ["Alla", "eye", "Alla ser ditt område (eller din krog). Vänner ser din pin."],
    vanner: ["Bara vänner", "users", "Vänner och gänget ser dig. Andra ser ingenting."],
    spoke: ["Spöke", "eye-off", "Ingen ser dig på kartan. Dina öl räknas ändå."] };
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
    var m = mode(), t = TXT[m];
    if (b.getAttribute("data-vis") !== m) {
      b.setAttribute("data-vis", m);
      var dot = b.querySelector(".pn-rail-dot"); b.innerHTML = ic(t[1]); if (dot) b.appendChild(dot);
    }
    b.setAttribute("aria-label", "Synlighet: " + t[0] + ". Ändra"); b.title = "Synlighet: " + t[0];
    b.setAttribute("aria-pressed", String(m !== "alla")); b.setAttribute("aria-haspopup", "menu");
  }
  function fill() {
    var m = mode(), opts = srv === false ? ["alla", "spoke"] : ["alla", "vanner", "spoke"];
    menu.innerHTML = '<p class="pn-ikm-h">Vem ser dig?</p>';
    var seg = document.createElement("div"); seg.className = "gm-seg pn-vis-seg"; seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", "Synlighet");
    opts.forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === m)); b.setAttribute("data-vis", k);
      b.innerHTML = ic(TXT[k][1]) + "<span>" + TXT[k][0] + "</span>"; b.addEventListener("click", function (e) { e.stopPropagation(); setMode(k); });
      seg.appendChild(b);
    });
    menu.appendChild(seg);
    var p = document.createElement("p"); p.className = "pn-vis-note"; p.textContent = TXT[m][2]; menu.appendChild(p);
  }
  function open() {
    var b = document.getElementById("pn-ghost"); if (!b || menu) return;
    probe();
    menu = document.createElement("div"); menu.className = "pn-ikm pn-vis"; menu.id = "pn-vis"; menu.setAttribute("role", "menu");
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(menu); fill();
    var r = b.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
    menu.style.width = w + "px"; menu.style.top = Math.round(r.top) + "px"; menu.style.left = Math.round(Math.max(12, r.left - 8 - w)) + "px";
    b.setAttribute("aria-expanded", "true");
    setTimeout(function () { document.addEventListener("click", out, true); document.addEventListener("keydown", esc); }, 0);
  }
  function close() {
    if (!menu) return; var m = menu; menu = null; m.classList.add("pn-out"); setTimeout(function () { m.remove(); }, 160);
    var b = document.getElementById("pn-ghost"); if (b) b.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", out, true); document.removeEventListener("keydown", esc);
  }
  function out(e) { var b = document.getElementById("pn-ghost"); if (menu && !menu.contains(e.target) && !(b && b.contains(e.target))) close(); }
  function esc(e) { if (e.key === "Escape") close(); }
  // the rail button keeps its id/place (pnds ds05); its own toggle is replaced by the menu (capture: runs first)
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("#pn-ghost") : null; if (!b) return;
    e.stopImmediatePropagation(); e.preventDefault(); menu ? close() : open();
  }, true);
  setInterval(function () { paint(); probe(); }, 1500);
  window.PNVIS = { mode: mode, setMode: setMode, open: open, close: close, _srv: function () { return srv; } };
})();
