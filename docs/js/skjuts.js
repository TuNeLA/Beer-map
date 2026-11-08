/* PintsNow — 🆘 HÄMTA MIG · 🚗 JAG KÖR IKVÄLL · 🚗 SKJUTS? (owner-approved 2026-11-07; migration 0250; push = notify-group
   {event:"pickup"|"pickup_yes", req_id}, owner deploys). window.SKJUTS, in app.js mods(): init, onAuthed, onPoll, groupItem,
   hudChipsHTML, hudClick + groupActions (gpage.js "+"), statusRow (social.js Medlemmar), ikvNode (pnui.js Ikväll? sheet).
   Research (Life360 / Snap Map live location / Watcher / Circle of 6): one tap, pick who gets it, live position for a fixed
   time with a clear stop, a visible answer ("Jag kommer"), and the emergency number always on screen.
   - 🆘 Hämta mig: picks friends / whole groups (friend_list), position for 30 / 60 / 90 min (default 60) or until ⏹ Stoppa.
     "📞 Ring 112" is always first in the sheet. Rate-limited by the server (60 s between, max 6 per 12 h). While it is live
     and the app is open, the position is updated every 30 s (no history: one position, cleared at the end).
   - Receivers: one calm alarm toast per new request, a HUD chip, a sheet with 🗺️ Visa på kartan, 🧭 Vägbeskrivning and
     🙋 Jag kommer / ✋ Kan int'. The asker sees who answered.
   - 🚗 Jag kör ikväll: a status for tonight (resets 05:00). Group page shows "🚗 Kör ikväll: …" + "Skjuts?" per driver,
     Medlemmar shows 🚗 at the name. Never counted as drinking (no beers / drink_log / meriter).
   - A missing RPC (old server) = every part hides. Swedish only. Styles: skjuts.css. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, off = false, P = null, pollAt = 0, busy = false, fastT = 0, pingAt = 0, want = null;
  var drv = {}, rows = [], groupWraps = [];
  var POLL_MS = 45000, FAST_MS = 10000, PING_MS = 30000;
  var ERR = {
    no_viewers: "Välj minst en kompis eller grupp.", too_many: "Max 30 personer åt gången.",
    slow_down: "Vänta en liten stund innan du frågar igen.", not_driving: "Hen kör int' längre ikväll.",
    ended: "Förfrågan ä redan avslutad.", not_found: "Förfrågan finns int' längre.", not_member: "Du ä int' med i gruppen.",
    invalid_answer: "Välj ett svar."
  };
  function esc(s) { return U.esc(s); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function missing(e) { var m = String((e && (e.code || "")) + " " + (e && e.message || "")); return /PGRST202|42883|does not exist|Could not find the function/i.test(m); }
  function codeOf(e) { var m = String((e && e.message) || ""), x = m.match(/(no_viewers|too_many|slow_down|not_driving|ended|not_found|not_member|invalid_answer)/); return x ? x[1] : ""; }
  function errText(e) { return ERR[codeOf(e)] || "Det gick int'. Försök igen."; }
  function call(name, params) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, error: { message: "no_api" } });
    return A.rpc(name, params || {}).then(function (r) { r = r || { error: { message: "error" } }; if (r.error && missing(r.error)) off = true; return r; });
  }
  function data(r) { return r && !r.error ? A.parseData(r.data) : null; }
  function push(body) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", body); } catch (e) {} }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function hm(iso) { var d = new Date(iso); return isNaN(d) ? "" : ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function ago(iso) { var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !isFinite(m) ? "" : m < 1 ? "nyss" : m < 60 ? m + " min sen" : hm(iso); }
  function myName() { try { return (A.getName && A.getName()) || null; } catch (e) { return null; } }
  function sheetOpen() { try { return A.sheetOpen && A.sheetOpen(); } catch (e) { return false; } }
  // Position: a fresh GPS fix (max 8 s), else the last known one, else none (the request still goes out).
  function fix(ms) {
    return new Promise(function (res) {
      var done = false, fin = function (v) { if (!done) { done = true; res(v); } };
      setTimeout(function () { var l = null; try { l = A.lastLoc && A.lastLoc(); } catch (e) {} fin(l && isFinite(l.lat) ? { lat: l.lat, lng: l.lng, acc: null } : null); }, ms || 8000);
      try {
        navigator.geolocation.getCurrentPosition(function (p) { fin({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
          function () { var l = null; try { l = A.lastLoc && A.lastLoc(); } catch (e) {} fin(l && isFinite(l.lat) ? { lat: l.lat, lng: l.lng, acc: null } : null); },
          { enableHighAccuracy: true, timeout: (ms || 8000) - 500, maximumAge: 20000 });
      } catch (e) { fin(null); }
    });
  }
  function sos112(body) { try { if (window.SAFETY && window.SAFETY.sos112) { window.SAFETY.sos112(body); return; } } catch (e) {}
    body.appendChild(h("div", { class: "sf-112" }, [h("a", { class: "btn btn-danger btn-block sf-112-btn", href: "tel:112", text: "📞 Ring 112" }),
      h("p", { class: "sf-112-note", text: "Appen larmar inte själv." })])); }

  /* ---------- poll ---------- */
  function mineLive() { return P && P.mine && P.mine.live ? P.mine : null; }
  function incomingLive() { return P ? (P.incoming || []).filter(function (x) { return x.live; }) : []; }
  function poll(force) {
    if (off || !A || !A.LIVE || busy) return Promise.resolve(P);
    try { if (!A.authed()) return Promise.resolve(P); } catch (e) {}
    if (!force && Date.now() - pollAt < POLL_MS) return Promise.resolve(P);
    busy = true;
    return call("pickup_poll").then(function (r) {
      busy = false; pollAt = Date.now();
      var d = data(r); if (!d) return P;
      var prev = P; P = d;
      announce(prev);
      fastLoop();
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
      repaintOpen();
      if (want) {   // ?pickup=<id> (push tap): a request to me, or my own (answer push)
        var w = (P.incoming || []).filter(function (x) { return String(x.id) === want; })[0];
        if (w) { want = null; incomingSheet(w); } else if (P.mine && String(P.mine.id) === want) { want = null; liveSheet(); }
      }
      return P;
    });
  }
  function fastLoop() {
    clearTimeout(fastT); fastT = 0;
    if (!mineLive() && !incomingLive().length) return;
    fastT = setTimeout(function () {
      if (document.hidden) { fastLoop(); return; }
      poll(true).then(function () { maybePing(); });
    }, FAST_MS);
  }
  function maybePing() {
    var m = mineLive(); if (!m || m.kind !== "hamta" || document.hidden || Date.now() - pingAt < PING_MS) return;
    pingAt = Date.now();
    fix(6000).then(function (p) { if (p && mineLive()) call("pickup_ping", { p_id: m.id, p_lat: p.lat, p_lng: p.lng, p_acc: p.acc }); });
  }
  // One alarm per new request (seen per id, kept 2 days), "🙋 Lisa kommer!" once per answer for the asker.
  function announce(prev) {
    var seen = lsGet("olnu.pkSeen", {}) || {}, now = Date.now(), ch = false;
    Object.keys(seen).forEach(function (k) { if (now - seen[k] > 2 * 86400000) { delete seen[k]; ch = true; } });
    incomingLive().forEach(function (x) {
      if (seen["i" + x.id]) return; seen["i" + x.id] = now; ch = true;
      if (x.my_ans) return;
      var txt = x.kind === "skjuts" ? "🚗 " + x.name + " undrar: Skjuts?" : "🆘 " + x.name + ": Kan nån hämta mig?";
      A.toast(txt, { id: "pk-in-" + x.id, ms: 12000, urgent: true, cls: "pk-toast", action: { label: "Visa", fn: function () { incomingSheet(x); } } });
      try { if (window.FX && window.FX.vibrate) window.FX.vibrate([30, 60, 30]); } catch (e) {}
    });
    var m = P && P.mine;
    if (m && m.live) (m.answers || []).forEach(function (a) {
      var key = "a" + m.id + ":" + a.name + ":" + a.ans; if (seen[key]) return; seen[key] = now; ch = true;
      if (a.ans === "kommer") A.toast("🙋 " + a.name + " kommer" + (m.kind === "skjuts" ? " och kör dig!" : " och hämtar dig!"), { id: "pk-ans", ms: 8000, urgent: true });
      else if (m.kind === "skjuts") A.toast("✋ " + a.name + " kan int' köra just nu.", { id: "pk-ans", ms: 6000 });
    });
    if (ch) lsSet("olnu.pkSeen", seen);
  }

  /* ---------- 🆘 Hämta mig: start ---------- */
  function openPickup(opts) {
    opts = opts || {};
    if (off || !A || !A.LIVE) return;
    if (mineLive() && mineLive().kind === "hamta") { liveSheet(); return; }
    A.openSheet("🆘 Hämta mig", function (body) {
      var box = h("div", { class: "pk" });
      body.appendChild(box);
      sos112(box);
      box.appendChild(h("p", { class: "pk-lead", text: "Skickar \"Kan nån hämta mig?\" och var du ä till dem du väljer. De kan svara \"Jag kommer\"." }));
      box.appendChild(h("h3", { class: "pk-h", text: "Vem ska få frågan?" }));
      var pick = h("div", { class: "pk-pick" }, [h("p", { class: "pk-muted", text: "…" })]);
      box.appendChild(pick);
      box.appendChild(h("h3", { class: "pk-h", text: "Dela min position i" }));
      var mins = 60, seg = h("div", { class: "pk-seg", role: "radiogroup", "aria-label": "Hur länge" });
      [30, 60, 90].forEach(function (m) {
        var b = h("button", { type: "button", role: "radio", class: "pk-segb", "aria-checked": String(m === mins), text: m + " min" });
        b.addEventListener("click", function () { mins = m; seg.querySelectorAll(".pk-segb").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
        seg.appendChild(b);
      });
      box.appendChild(seg);
      var go = h("button", { type: "button", class: "btn btn-amber btn-block pk-go", text: "🆘 Välj minst en", disabled: true });
      box.appendChild(go);
      box.appendChild(h("p", { class: "pk-muted pk-priv", text: "🔒 Bara de du väljer ser var du ä. Positionen raderas när du stoppar eller när tiden ä slut." }));
      var sel = {}, people = [], groups = [];
      if (opts.group) sel["g:" + opts.group.id] = true;
      function n() {
        var set = {};
        groups.forEach(function (g) { if (sel["g:" + g.id]) people.forEach(function (p) { if ((p.groups || []).some(function (x) { return x.id === g.id; })) set[p.key] = 1; }); });
        people.forEach(function (p) { if (sel[p.key]) set[p.key] = 1; });
        return Object.keys(set).length;
      }
      function refresh() {
        var k = n(); go.disabled = !k;
        go.textContent = k ? "🆘 Skicka – " + k + (k === 1 ? " får" : " får") + " frågan" : "🆘 Välj minst en";
        pick.querySelectorAll("[data-sel]").forEach(function (b) { b.setAttribute("aria-pressed", String(!!sel[b.getAttribute("data-sel")])); });
      }
      call("friend_list", { p_name: myName() }).then(function (r) {
        pick.innerHTML = "";
        var d = data(r); if (!d) { pick.appendChild(h("p", { class: "pk-muted", text: "Kunde int' hämta dina kompisar." })); return; }
        people = d.people || []; groups = d.groups || [];
        if (!people.length) { pick.appendChild(h("p", { class: "pk-muted", text: "Du har inga vänner eller gruppkompisar än. Gå med i en grupp först." })); return; }
        if (groups.length) {
          var gr = h("div", { class: "pk-chips" });
          groups.forEach(function (g) { gr.appendChild(h("button", { type: "button", class: "pk-chip pk-gchip", "data-sel": "g:" + g.id, "aria-pressed": "false", text: "👥 " + g.name,
            onclick: function () { sel["g:" + g.id] = !sel["g:" + g.id]; refresh(); } })); });
          pick.appendChild(gr);
        }
        var pr = h("div", { class: "pk-chips" });
        people.slice(0, 60).forEach(function (p) { pr.appendChild(h("button", { type: "button", class: "pk-chip", "data-sel": p.key, "aria-pressed": "false", text: p.name,
          onclick: function () { sel[p.key] = !sel[p.key]; refresh(); } })); });
        pick.appendChild(pr);
        refresh();
      });
      go.addEventListener("click", function () {
        if (go.disabled) return;
        go.disabled = true; go.textContent = "📡 Hämtar din position…";
        var keys = people.filter(function (p) { return sel[p.key]; }).map(function (p) { return p.key; });
        var gids = groups.filter(function (g) { return sel["g:" + g.id]; }).map(function (g) { return g.id; });
        fix(8000).then(function (p) {
          go.textContent = "Skickar…";
          return call("pickup_start", { p_lat: p ? p.lat : null, p_lng: p ? p.lng : null, p_acc: p ? p.acc : null, p_keys: keys, p_group_ids: gids, p_minutes: mins, p_name: myName() });
        }).then(function (r) {
          if (r.error) { A.toast(errText(r.error), { err: true }); refresh(); return; }
          var m = data(r); P = P || { incoming: [] }; P.mine = m;
          push({ event: "pickup", req_id: m.id });
          pingAt = Date.now();
          A.toast("🆘 Skickat till " + (m.n | 0) + ". Håll appen öppen så ser du svaren.", { ms: 5000 });
          liveSheet(); fastLoop();
        });
      });
    });
  }
  function answersEl(m) {
    var ul = h("ul", { class: "pk-ans" });
    var a = m.answers || [];
    if (!a.length) ul.appendChild(h("li", { class: "pk-muted", text: "⏳ Väntar på svar…" }));
    a.forEach(function (x) { ul.appendChild(h("li", { class: x.ans === "kommer" ? "yes" : "no", text: (x.ans === "kommer" ? "🙋 " : "✋ ") + x.name + (x.ans === "kommer" ? ": Jag kommer" : ": Kan int'") + " · " + ago(x.at) })); });
    return ul;
  }
  var openBox = null;
  function liveSheet() {
    var m = P && P.mine; if (!m) return;
    A.openSheet(m.kind === "skjuts" ? "🚗 Skjuts?" : "🆘 Hämta mig", function (body) {
      openBox = { kind: "mine", el: h("div", { class: "pk" }) };
      body.appendChild(openBox.el); paintLive();
    });
  }
  function paintLive() {
    var box = openBox && openBox.kind === "mine" ? openBox.el : null; if (!box || !document.body.contains(box)) return;
    var m = P && P.mine; box.innerHTML = "";
    if (!m) return;
    sos112(box);
    if (m.live) {
      box.appendChild(h("p", { class: "pk-lead", text: m.kind === "skjuts" ? "🚗 Du har frågat " + (m.driver || "föraren") + " om skjuts." : "🆘 Din fråga ä skickad till " + (m.n | 0) + (m.n === 1 ? " person." : " personer.") }));
      box.appendChild(h("p", { class: "pk-muted", text: (m.has_pos ? "📍 Din position delas till " : "Gäller till ") + hm(m.ends_at) + "." }));
      box.appendChild(answersEl(m));
      box.appendChild(h("button", { type: "button", class: "btn btn-block pk-stop", text: m.kind === "skjuts" ? "⏹ Avbryt frågan" : "⏹ Stoppa – jag har skjuts nu", onclick: function (e) { stop(e.currentTarget); } }));
      box.appendChild(h("p", { class: "pk-muted pk-priv", text: "📱 Håll appen öppen så uppdateras din position och du ser svaren." }));
    } else {
      box.appendChild(h("p", { class: "pk-lead", text: "✅ Avslutad. Positionen ä raderad." }));
      box.appendChild(answersEl(m));
    }
  }
  function stop(btn) {
    var m = mineLive(); if (!m) return;
    if (btn) btn.disabled = true;
    call("pickup_stop", { p_id: m.id }).then(function (r) {
      if (r.error) { if (btn) btn.disabled = false; A.toast(errText(r.error), { err: true }); return; }
      m.live = false; m.has_pos = false; paintLive(); fastLoop();
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
      A.toast("⏹ Stoppat. Ingen ser din position längre.", { ms: 3500 });
    });
  }

  /* ---------- receiver ---------- */
  function incomingSheet(x) {
    A.openSheet(x.kind === "skjuts" ? "🚗 " + x.name + " undrar: Skjuts?" : "🆘 " + x.name + " vill bli hämtad", function (body) {
      openBox = { kind: "in", id: x.id, el: h("div", { class: "pk" }) };
      body.appendChild(openBox.el); paintIncoming();
    });
  }
  function paintIncoming() {
    var box = openBox && openBox.kind === "in" ? openBox.el : null; if (!box || !document.body.contains(box)) return;
    var x = (P && P.incoming || []).filter(function (y) { return y.id === openBox.id; })[0]; if (!x) return;
    box.innerHTML = "";
    if (!x.live) { box.appendChild(h("p", { class: "pk-lead", text: "✅ " + x.name + " har stoppat frågan." })); return; }
    box.appendChild(h("p", { class: "pk-lead", text: x.kind === "skjuts" ? x.name + " undrar om du kan köra. Svara så ser hen det direkt." : x.name + " frågar om nån kan hämta. Svara så ser hen det direkt." }));
    if (x.lat != null) {
      box.appendChild(h("p", { class: "pk-muted", text: "📍 Position " + (x.pos_at ? ago(x.pos_at) : "") + (x.acc ? " · ±" + x.acc + " m" : "") }));
      box.appendChild(h("div", { class: "pk-row" }, [
        h("button", { type: "button", class: "btn pk-map", text: "🗺️ Visa på kartan", onclick: function () { try { A.flyTo(x.lat, x.lng, 17); } catch (e) {} } }),
        h("a", { class: "btn pk-dir", href: "https://www.google.com/maps/dir/?api=1&destination=" + (+x.lat).toFixed(5) + "," + (+x.lng).toFixed(5), target: "_blank", rel: "noopener", text: "🧭 Vägen dit" })]));
    } else box.appendChild(h("p", { class: "pk-muted", text: "Ingen position skickad. Skriv till " + x.name + " i chatten." }));
    if ((x.coming | 0) > 0) box.appendChild(h("p", { class: "pk-coming", text: "🙋 " + x.coming + (x.coming === 1 ? " kommer redan" : " kommer redan") }));
    var yes = h("button", { type: "button", class: "btn btn-amber pk-yes" + (x.my_ans === "kommer" ? " on" : ""), "aria-pressed": String(x.my_ans === "kommer"), text: "🙋 Jag kommer" });
    var no = h("button", { type: "button", class: "btn pk-no" + (x.my_ans === "kan_inte" ? " on" : ""), "aria-pressed": String(x.my_ans === "kan_inte"), text: "✋ Kan int'" });
    yes.addEventListener("click", function () { answer(x, "kommer", yes); });
    no.addEventListener("click", function () { answer(x, "kan_inte", no); });
    box.appendChild(h("div", { class: "pk-row pk-answer" }, [yes, no]));
    box.appendChild(h("p", { class: "pk-muted", text: "Gäller till " + hm(x.ends_at) + "." }));
    sos112(box);
  }
  function answer(x, ans, btn) {
    btn.disabled = true;
    call("pickup_answer", { p_id: x.id, p_ans: ans }).then(function (r) {
      btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      x.my_ans = ans; if (ans === "kommer") { x.coming = (x.coming | 0) + 1; push({ event: "pickup_yes", req_id: x.id }); }
      paintIncoming();
      A.toast(ans === "kommer" ? "🙋 " + x.name + " ser att du kommer. Kör försiktigt!" : "Okej, " + x.name + " ser ditt svar.", { ms: 3500 });
    });
  }
  function repaintOpen() { if (!openBox) return; if (openBox.kind === "mine") paintLive(); else paintIncoming(); }

  /* ---------- 🚗 Jag kör ikväll ---------- */
  function driving() { return !!(P && P.driving); }
  function setDriver(on, btn) {
    if (btn) btn.disabled = true;
    call("driver_set", { p_on: !!on }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      P = P || { incoming: [] }; P.driving = !!on;
      drv = {};   // group lists reload
      A.toast(on ? "🚗 Du kör ikväll. Gänget ser 🚗 vid ditt namn." : "🚗 Av. Du kör int' ikväll.", { ms: 3500 });
      paintIkv(); refreshGroups();
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
    });
  }
  var ikvEl = null;
  function ikvNode() {
    if (off || !A || !A.LIVE) return null;
    ikvEl = h("div", { class: "ds-card pk-ikv" });
    paintIkv();
    if (!P) poll(true);
    return ikvEl;
  }
  function paintIkv() {
    if (!ikvEl) return;
    var on = driving();
    ikvEl.innerHTML = "";
    var sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": "Jag kör ikväll" });
    sw.addEventListener("click", function () { setDriver(!driving(), sw); });
    ikvEl.appendChild(h("div", { class: "toggle-row pk-ikv-row" }, [h("span", { class: "pk-ikv-t" }, [h("b", { text: "🚗 Jag kör ikväll" }),
      h("small", { text: "Gänget ser 🚗 vid ditt namn och kan fråga om skjuts. Räknas aldrig som dryck. Nollställs kl 05." })]), sw]));
  }

  /* ---------- group page + Medlemmar ---------- */
  function loadDrivers(g) {
    if (off || !g || !g.id || g.dm || g.ev || g.evg) return Promise.resolve(null);
    var c = drv[g.id];
    if (c && c.p) return c.p;
    if (c && Date.now() - c.at < 60000) return Promise.resolve(c.list);
    c = drv[g.id] = { at: 0, list: c ? c.list : null, p: null };
    c.p = call("drivers_for", { p_group_id: g.id }).then(function (r) {
      c.p = null; c.at = Date.now();
      var d = data(r); c.list = d ? d.drivers || [] : c.list || [];
      paintRows(g.id); paintGroupTiles();
      return c.list;
    });
    return c.p;
  }
  function rideAsk(g, d, btn) {
    if (btn) btn.disabled = true;
    fix(5000).then(function (p) {
      return call("ride_ask", { p_group_id: g.id, p_k: d.k, p_lat: p ? p.lat : null, p_lng: p ? p.lng : null, p_name: myName() });
    }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      var m = data(r); P = P || { incoming: [] }; P.mine = m;
      push({ event: "pickup", req_id: m.id });
      A.toast("🚗 Du har frågat " + d.name + " om skjuts. Svaret syns här.", { ms: 5000, action: { label: "Visa", fn: liveSheet } });
      fastLoop();
    });
  }
  function groupItem(g, wrap) {
    if (off || !A || !A.LIVE || !g || !g.id || g.dm || g.ev || g.evg || !wrap) return;
    var t = wrap.querySelector(":scope > .skj-gi");
    if (!t) {
      t = h("div", { class: "skj-gi", "data-gp": "1", hidden: true });
      t.style.order = "12";
      wrap.appendChild(t);
    }
    t.__g = g;
    if (groupWraps.indexOf(t) < 0) groupWraps.push(t);
    loadDrivers(g).then(function () { paintGroupTiles(); });
  }
  function paintGroupTiles() {
    groupWraps = groupWraps.filter(function (t) { return document.body.contains(t); });
    groupWraps.forEach(function (t) {
      var g = t.__g, c = drv[g.id], list = (c && c.list) || [];
      t.innerHTML = "";
      if (!list.length) { t.hidden = true; return; }
      t.hidden = false;
      var row = h("div", { class: "skj-card live" }, [h("span", { class: "skj-ic", "aria-hidden": "true", text: "🚗" }),
        h("span", { class: "skj-txt" }, [h("b", { text: "Kör ikväll" }), h("small", { text: list.map(function (d) { return d.is_me ? "du" : d.name; }).join(", ") })])]);
      var btns = h("span", { class: "skj-btns" });
      list.filter(function (d) { return !d.is_me; }).slice(0, 3).forEach(function (d) {
        btns.appendChild(h("button", { type: "button", class: "btn btn-small skj-ask", text: list.filter(function (x) { return !x.is_me; }).length > 1 ? "Skjuts? " + d.name.split(" ")[0] : "Skjuts?", "aria-label": "Fråga " + d.name + " om skjuts",
          onclick: function (e) { e.stopPropagation(); rideAsk(g, d, e.currentTarget); } }));
      });
      row.appendChild(btns);
      t.appendChild(row);
    });
  }
  function refreshGroups() { groupWraps.forEach(function (t) { if (t.__g) loadDrivers(t.__g); }); }
  function statusRow(g, m, row) {
    if (off || !g || !g.id || !m || !row) return;
    rows.push({ g: g.id, m: m, row: row });
    if (rows.length > 300) rows = rows.slice(-150);
    paintRow(g.id, m, row);
    loadDrivers(g);
  }
  function paintRows(gid) { rows = rows.filter(function (x) { return document.body.contains(x.row); }); rows.forEach(function (x) { if (x.g === gid) paintRow(x.g, x.m, x.row); }); }
  function paintRow(gid, m, row) {
    var c = drv[gid], list = (c && c.list) || [];
    var d = list.filter(function (x) { return (m.is_me && x.is_me) || (m.k && x.k === m.k); })[0];
    var tag = row.querySelector(".skj-tag");
    if (!d) { if (tag) tag.remove(); return; }
    if (tag) return;
    var nm = row.querySelector(".st-name") || row;
    tag = h("span", { class: "skj-tag" }, [h("span", { text: "🚗 kör" })]);
    if (!m.is_me) {
      var b = h("button", { type: "button", class: "skj-ask-s", text: "Skjuts?", "aria-label": "Fråga " + (m.name || "") + " om skjuts" });
      b.addEventListener("click", function (e) { e.stopPropagation(); rideAsk({ id: gid }, d, b); });
      b.addEventListener("keydown", function (e) { e.stopPropagation(); });
      tag.appendChild(b);
    }
    nm.parentNode.insertBefore(tag, nm.nextSibling);
  }

  /* ---------- HUD chip ---------- */
  function chip() {
    if (off || !P) return "";
    var inc = incomingLive().filter(function (x) { return x.my_ans !== "kan_inte"; })[0];
    if (inc) return '<button type="button" class="hx-chip pk-chip-hud" data-hx="pk-in:' + esc(String(inc.id)) + '">' + esc((inc.kind === "skjuts" ? "🚗 " + inc.name + ": Skjuts?" : "🆘 " + inc.name + " vill bli hämtad") + (inc.my_ans === "kommer" ? " · du kommer" : "")) + "</button>";
    var m = mineLive();
    if (m) { var y = (m.answers || []).filter(function (a) { return a.ans === "kommer"; }).length;
      return '<button type="button" class="hx-chip pk-chip-hud" data-hx="pk-mine">' + esc((m.kind === "skjuts" ? "🚗 Skjuts? · " : "🆘 Hämta mig · ") + (y ? y + " kommer" : "väntar på svar")) + "</button>"; }
    return "";
  }

  window.SKJUTS = {
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(true); });
      try { var q = new URLSearchParams(location.search).get("pickup"); if (q && /^\d{1,18}$/.test(q)) want = q; } catch (e) {}
    },
    onAuthed: function () { poll(true); },
    onPoll: function () { poll(false); },
    hudChipsHTML: function () { try { return chip(); } catch (e) { return ""; } },
    hudClick: function (a) {
      a = String(a || "");
      if (a === "pk-mine") liveSheet();
      else if (a.indexOf("pk-in:") === 0) { var x = (P && P.incoming || []).filter(function (y) { return String(y.id) === a.slice(6); })[0]; if (x) incomingSheet(x); }
    },
    groupItem: groupItem,
    groupActions: function (g) {
      if (off || !A || !A.LIVE || !g || !g.id || g.dm) return null;
      var on = driving(), live = mineLive() && mineLive().kind === "hamta";
      var out = [{ id: "pk-ga", icon: "🆘", label: live ? "Hämta mig: skickad" : "Hämta mig", sub: live ? "Se vem som kommer" : "Kan nån hämta mig?", sect: 1,
        onClick: function () { openPickup({ group: g }); } }];
      if (!g.ev && !g.evg) out.push({ id: "pk-drv", icon: "🚗", label: "Jag kör ikväll", sub: on ? "Gänget ser att du kör" : "Visa gänget att du kör", sect: 1,
        onClick: function (gg, b) { setDriver(!driving(), b); } });
      return out;
    },
    statusRow: statusRow,
    ikvNode: ikvNode,
    openPickup: openPickup, setDriver: setDriver, driving: driving,
    // tests
    _poll: function () { return P; }, _force: function () { return poll(true); }
  };
})();
