/* PintsNow — 🏠 AUTO HEMMA (ds38, owner 2026-11-08). When you come home after a night out, the app says so for you:
   checks you out of the bar, sets Ikväll to "Hemma", and ends Följ mig hem with the normal "Hemma ✓" to the watchers.
   Home = the existing home zone (homezone.js, localStorage "olnu.home" {lat, lng, r}): ON THIS PHONE ONLY. The exact home is
   never sent anywhere; the server only gets what it gets today (check_out, ikvall_set "hemma", walk_end "home").
   Rule: a home is set + the setting is on (default on once a home is set) + not spökläge + the night had activity (a
   check-in or a drink tonight) → GPS readings from AUTOCI.listen("fix") with accuracy ≤ 50 m, inside the home point's circle
   (min(home r, 200 m) + accuracy/2, max 250 m), ≥ 2 readings ≥ 10 min apart (any reading outside resets) → act, ONCE per
   night. One calm toast "Välkommen hem 🏠 — vi satte dig som Hemma" + "Ångra" (back: the check-in and the old status; a
   Följ mig hem that ended stays ended). Pin-follow (pinfolj.js) already stops inside the home zone.
   Log: PNLOG.event("home", {act, d (distance bucket "<50" / "<100" / "<200" / ">200"), n}) — never a coordinate.
   Web limit: only while the app is open and visible (AUTOCI samples once a minute then). Native plan: an OS geofence on the
   home point (iOS CLCircularRegion / Android GeofencingClient, enter + 10 min dwell) calls the same act() through the app.
   Public: window.AUTOHOME = { on(), setOn(b), state(), settingsRows(body, el), _fix(r), _skew(ms) (tests) }. */
(function () {
  "use strict";
  var U = window.U, KEY = "olnu.autoHome", DONE = "olnu.autoHomeNight", ACT = "olnu.nightAct";
  var ACC = 50, R_MAX = 200, DWELL = 10 * 60e3, N_MIN = 2;
  var st = { run: null, last: null, why: "", busy: false, undo: null }, skew = 0, hooked = false;
  function now() { return Date.now() + skew; }
  function api() { try { return window.PNDS && window.PNDS._A ? window.PNDS._A() : null; } catch (e) { return null; } }
  function home() { try { var h = window.HOMEZONE && window.HOMEZONE.home ? window.HOMEZONE.home() : U.ls.getJSON("olnu.home", null); return h && isFinite(h.lat) && isFinite(h.lng) ? h : null; } catch (e) { return null; } }
  function on() { try { return !!home() && U.ls.get(KEY, "1") !== "0"; } catch (e) { return false; } }
  function setOn(b) { try { U.ls.set(KEY, b ? "1" : "0"); } catch (e) {} }
  function ghost() { try { return U.ls.get("olnu.ghostMode", "0") === "1" || !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()); } catch (e) { return false; } }
  function nightKey(A) { try { return String(A && A.nightEnd ? A.nightEnd() : ""); } catch (e) { return ""; } }
  function myCi(A) { try { return A && A.myCheckin ? A.myCheckin() : null; } catch (e) { return null; } }
  function active(A) {   // the night had a check-in or a drink (seen by this phone)
    var nk = nightKey(A); if (!nk) return false;
    var seen = false;
    try { if (myCi(A) || (A.myBeer && A.myBeer())) seen = true; } catch (e) {}
    try { var n = U.ls.getJSON("olnu.night", null); if (n && (n.count | 0) > 0 && (+n.expires || 0) > Date.now()) seen = true; } catch (e) {}
    if (seen) { try { U.ls.set(ACT, nk); } catch (e) {} return true; }
    try { return U.ls.get(ACT, "") === nk; } catch (e) { return false; }
  }
  function bucket(d) { return d < 50 ? "<50" : d < 100 ? "<100" : d < 200 ? "<200" : ">200"; }
  function log(act, x) { try { if (window.PNLOG && window.PNLOG.event) window.PNLOG.event("home", Object.assign({ act: act }, x || {})); } catch (e) {} }
  function ikvMine() { try { var k = window.PNUI && window.PNUI._ikvRaw && window.PNUI._ikvRaw(); return k && k.d ? k.d.mine || null : null; } catch (e) { return null; } }
  function setIkv(stv) {   // pnui setIkv toggles: only call when it changes to the wanted value
    try { var P = window.PNUI; if (!P || !P.setIkv) return; if (stv) { if (ikvMine() !== stv) P.setIkv(stv); } else { var m = ikvMine(); if (m) P.setIkv(m); } } catch (e) {}
  }

  function onFix(r) {
    var A = api(); st.last = r;
    if (!A || !A.LIVE) { st.why = "off"; return; }
    var h = home(); if (!h) { st.run = null; st.why = "no_home"; return; }
    if (!on()) { st.run = null; st.why = "setting"; return; }
    if (ghost()) { st.run = null; st.why = "ghost"; return; }
    if (!(r.acc <= ACC)) { st.why = "accuracy"; return; }
    var nk = nightKey(A);
    if (U.ls.get(DONE, "") === nk && nk) { st.why = "done"; return; }
    if (!active(A)) { st.run = null; st.why = "no_activity"; return; }
    var d = U.haversine(r.lat, r.lng, h.lat, h.lng), rad = Math.min(250, Math.min(+h.r || 300, R_MAX) + Math.min(r.acc, ACC) / 2);
    if (d > rad) { if (st.run) log("left", { d: bucket(d), n: st.run.n }); st.run = null; st.why = "away"; return; }
    var t = r.t || now();
    if (!st.run) { st.run = { t0: t, n: 1 }; st.why = "first"; log("first", { d: bucket(d) }); return; }
    st.run.n++;
    if (st.run.n < N_MIN || t - st.run.t0 < DWELL) { st.why = "dwell"; return; }
    act(A, d, nk);
  }
  function act(A, d, nk) {
    if (st.busy) return;
    st.busy = true; st.why = "act";
    try { U.ls.set(DONE, nk); } catch (e) {}
    var ci = myCi(A), prevSt = ikvMine(), walk = null, done = [];
    try { var m = window.HEMFOLJ && window.HEMFOLJ._mine && window.HEMFOLJ._mine(); if (m && m.live) walk = m; } catch (e) {}
    st.undo = { ci: ci ? { id: String(ci.id), name: ci.name, lat: +ci.lat, lng: +ci.lng, at: ci.at } : null, st: prevSt };
    var steps = [];
    if (ci && A.rpc) steps.push(A.rpc("check_out").then(function (res) {
      if (res && res.error) return;
      try { U.ls.del("olnu.checkin"); } catch (e) {}
      done.push("co");
      try { A.updateCounts(); A.refresh(); } catch (e) {}
    }, function () {}));
    if (prevSt !== "hemma") { setIkv("hemma"); done.push("ikv"); }
    if (walk) { try { window.HEMFOLJ._arrive(true); done.push("walk"); } catch (e) {} }   // the normal "Hemma ✓" to the watchers
    Promise.all(steps).then(function () {
      st.busy = false; st.run = null;
      log("auto", { d: bucket(d), n: done.join(","), ci: ci ? 1 : 0 });
      try { A.toastClear && A.toastClear("ah-home"); } catch (e) {}
      A.toast("Välkommen hem 🏠 — vi satte dig som Hemma", { id: "ah-home", ms: 10000, cls: "ah-toast", action: { label: "Ångra", fn: undo } });
    });
  }
  function undo() {
    var A = api(), u = st.undo; if (!A || !u) return;
    st.undo = null;
    log("undo", {});
    if (u.st !== "hemma") setIkv(u.st || null);
    if (u.ci && A.rpc) {
      A.rpc("check_in", { p_bar_id: u.ci.id, p_bar_name: String(u.ci.name || "Krogen").slice(0, 60), p_lat: u.ci.lat, p_lng: u.ci.lng }).then(function (r) {
        if (r && !r.error) {
          try { U.ls.setJSON("olnu.checkin", { id: u.ci.id, name: u.ci.name, lat: u.ci.lat, lng: u.ci.lng, at: u.ci.at || Date.now(), until: A.nightEnd() }); } catch (e) {}
          try { A.updateCounts(); A.refresh(); } catch (e) {}
        }
      });
    }
    A.toast("Ångrat. Du är kvar ute.", { id: "ah-home", ms: 3000 });
  }

  /* ---------- settings (inside the auto check-in section, js/autoci.js) ---------- */
  function settingsRows(body, el) {
    var A = api(); if (!A || !A.LIVE || !el) return;
    var ic = function (n) { try { return window.PNI ? window.PNI.svg(n, "pi-lead") : ""; } catch (e) { return ""; } };
    if (!home()) {
      var s = el("button", { type: "button", class: "btn btn-block pn-swb ah-set" });
      s.innerHTML = ic("home") + '<span class="pn-sw-l">Ställ in hem</span>';
      s.addEventListener("click", function () { try { window.HOMEZONE.open({ then: function () { try { A.toast("Hemmet är sparat. Auto hemma är på.", { id: "ah-set", ms: 3500 }); } catch (e) {} } }); } catch (e) {} });
      body.appendChild(el("div", { class: "row ah-row" }, [s]));
      body.appendChild(el("p", { class: "muted ah-hint", text: "Tryck på kartan där du bor, eller ”Använd nuvarande plats”. Sparas bara på telefonen." }));
      return;
    }
    var v = on(), b = el("button", { type: "button", class: "btn btn-block pn-swb ah-row", role: "switch", "aria-checked": String(v) });
    b.innerHTML = ic("home") + '<span class="pn-sw-l">Sätt mig som hemma automatiskt</span><span class="switch" aria-hidden="true" aria-checked="' + v + '"></span>';
    b.addEventListener("click", function () {
      var nv = b.getAttribute("aria-checked") !== "true"; setOn(nv); b.setAttribute("aria-checked", String(nv));
      var dot = b.querySelector(".switch"); if (dot) dot.setAttribute("aria-checked", String(nv));
      A.toast(nv ? "Auto hemma på. Bara när appen är öppen." : "Auto hemma av.", { id: "ah-set", ms: 3000 });
    });
    body.appendChild(el("div", { class: "row ah-set" }, [b]));
    body.appendChild(el("p", { class: "muted ah-hint", text: "10 min hemma efter en kväll ute: utcheckad, Hemma, Följ mig hem klar. Hemmet stannar på telefonen." }));
  }

  function hook() {
    if (hooked || !window.AUTOCI || !window.AUTOCI.listen) return;
    hooked = true;
    window.AUTOCI.listen(function (type, x) { if (type === "fix" && x) onFix({ lat: +x.lat, lng: +x.lng, acc: +x.acc, t: now() }); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
  setTimeout(hook, 2000);
  window.AUTOHOME = { on: on, setOn: setOn, settingsRows: settingsRows,
    state: function () { return { run: st.run, why: st.why, home: !!home(), on: on(), undo: !!st.undo }; },
    _fix: function (r) { onFix(Object.assign({ t: now() }, r)); }, _skew: function (ms) { skew += ms; return skew; }, _undo: undo };
})();
