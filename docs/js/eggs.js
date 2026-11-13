/* 7 eggs, no network. Webdriver: off unless olnu.egg.test=1 or ?eggs=1 */
(function () {
  "use strict";
  var D = document, PN = window.PN, I = window.I18N, K = "olnu.egg.", now = function () { return new Date(); }, clock = now;
  if (!PN || !I) return;
  try { if (navigator.webdriver && ls("test") !== "1" && !/[?&]eggs=1/.test(location.search)) return; } catch (e) { return; }
  var IDS = ["logo", "water", "swipe", "world", "glenn", "dawn", "credits"];
  I.add({
    sv: { egT: "Byggd i Ludvika av TuNeLA", egC: function (n) { return "Hittade " + n + " av 7 ägg, sparas bara här"; },
      eg_logo: "Ölguden har sett dig.", eg_water: "Ölguden säger: vatten och macka gör kvällen bättre.", eg_swipe: "Kartans hemliga kod! Den gör inget.",
      eg_world: "Ludvika: världens mittpunkt", eg_glenn: "Tjena Glenn!", eg_dawn: "Morgonrapport: byn sover. Kaffe?",
      eg_credits: "Byggd i Ludvika" },
    en: { egT: "Built in Ludvika by TuNeLA", egC: function (n) { return "Found " + n + " of 7 eggs, saved here only"; },
      eg_logo: "The Beer God has seen you.", eg_water: "The Beer God says: water and a snack make the night better.", eg_swipe: "The secret map code! It does nothing.",
      eg_world: "Ludvika: centre of the world", eg_glenn: "Hey Glenn!", eg_dawn: "Morning report: the village sleeps. Coffee?",
      eg_credits: "Built in Ludvika" }
  });
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(K + k); localStorage.setItem(K + k, v); } catch (e) {} return null; }
  function day() { var d = clock(); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function found() { try { return JSON.parse(ls("f")) || []; } catch (e) { return []; } }
  function busy() { try { return D.body.classList.contains("hf-on") || !!(window.RIDE && RIDE.live()); } catch (e) {} }
  function sheetUp() { var s = D.getElementById("sheet"); return s && !s.hidden; }
  function fire(id, show, again) {
    if (busy() || (ls("d" + id) === day() && !again)) return;
    ls("d" + id, day());
    var f = found(); if (f.indexOf(id) < 0) { f.push(id); ls("f", JSON.stringify(f)); }
    try { show(); } catch (e) {}
  }
  function toast(k, el) {
    try { PN.toast(I.t("eg_" + k), { ms: 4000 }); if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) foam(el); } catch (e) {}
  }
  function foam(el) {
    var r = el.getBoundingClientRect();
    for (var i = 0; i < 9; i++) {
      var b = D.createElement("i"), a = Math.PI * (1 + (i + 0.5) / 9), d = 36;
      b.style.cssText = "position:fixed;width:10px;height:10px;border-radius:50%;background:var(--foam);pointer-events:none;z-index:900;left:" + (r.left + r.width / 2) + "px;top:" + (r.top + r.height / 2) + "px"; D.body.appendChild(b);
      b.animate([{ opacity: 1 }, { transform: "translate(" + Math.cos(a) * d + "px," + (Math.sin(a) * -d + 30) + "px)", opacity: 0 }], 800);
      setTimeout(b.remove.bind(b), 850);
    }
  }
  function taps(sel, n, go) {
    var c = 0, last = 0;
    D.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest(sel), b = t && e.target.closest("button,a,input");
      if (!t || (b && t.contains(b))) return;
      var now = Date.now(); c = now - last > 2500 ? 1 : c + 1; last = now;
      if (c >= n) { c = 0; go(t); }
    }, true);
  }
  function credits() {
    PN.openSheet && PN.openSheet(I.t("egT"), function (body) {
      var f = found(), p = D.createElement("p"), ul = D.createElement("ul");
      p.textContent = I.t("egC", f.length); body.appendChild(p);
      IDS.forEach(function (id) { var li = ul.appendChild(D.createElement("li")); li.textContent = f.indexOf(id) < 0 ? "???" : I.t("eg_" + id); });
      body.appendChild(ul);
    });
  }
  function watchMap(map) {
    var seq = "", at = 0, from = null;
    map.on("dragstart", function () { from = map.project(map.getCenter()); });
    map.on("dragend", function () {
      if (!from || busy() || sheetUp()) return;
      var to = map.project(map.getCenter()), dx = to.x - from.x, dy = to.y - from.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
      var d = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "U" : "D") : (dx > 0 ? "L" : "R"), now = Date.now();
      seq = (now - at > 6000 ? "" : seq) + d; at = now; seq = seq.slice(-6);
      if (seq === "UUDDLR") { seq = ""; fire("swipe", function () { toast("swipe"); }); }
    });
    map.on("zoomend", function () {
      if (sheetUp() || map.getZoom() > map.getMinZoom()) return;
      fire("world", function () { var c = D.createElement("div"); c.role = "status"; c.style.cssText = "position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:900;pointer-events:none;background:var(--pn-float-2);color:var(--foam);border-radius:var(--r-pill);padding:var(--sp-2) var(--sp-4)"; c.textContent = I.t("eg_world");
        D.body.appendChild(c); setTimeout(c.remove.bind(c), 3000); });
    });
    function dawn() {
      var d = clock(), c = map.getCenter(), L = PN.LUDVIKA;
      if (d.getHours() === 5 && d.getMinutes() < 10 && !sheetUp() && Math.abs(c.lat - L[0]) < 0.15 && Math.abs(c.lng - L[1]) < 0.3) fire("dawn", function () { toast("dawn"); });
    }
    map.on("moveend", dawn); setTimeout(dawn, 4000);
  }
  function start() {
    taps(".brand-name", 7, function (t) { fire("logo", function () { toast("logo", t); }); });
    taps("#live-count", 5, function () { fire("water", function () { toast("water"); }); });
    taps(".ds-ver .toggle-row", 5, function () { fire("credits", credits, found().indexOf("credits") >= 0); });
    D.addEventListener("input", function (e) {
      if (e.target.id !== "chat-inp" || !/\bglenn\b/i.test(e.target.value)) return;
      try { if (window.DIALEKT.region() === "sv-vast") fire("glenn", function () { toast("glenn"); }); } catch (x) {}
    }, true);
    var n = 0, w = setInterval(function () { if (PN.map && PN.put) { watchMap(PN.map); PN.put({ eggs: { found: found, clock: function (f) { clock = f || now; } } }); } if (PN.map || ++n > 60) clearInterval(w); }, 500);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
