/* Öl Nu v28 — map long-press menu + ➕ "Lägg till ställe här" (CONTRACT "v28 INBJUDNINGAR", migration 0082).
   Long-press the map (~600 ms, touch or mouse, finger/mouse still within 10 px) → a small menu at that point:
     "📨 Skapa event här"  → INVITE.openCreate({lat, lng, custom}) — a PRIVATE event: only the invited see it
     "📍 Bjud in hit"       → INVITE.openCreate({lat, lng}) — place label = nearest named spot ≤ 60 m, else "Hemma hos <namn>"
     "➕ Lägg till ställe här" → form (name ≤ 60, type, note) → suggest_place(); warns "Finns redan: X?" for a similar
        name ≤ 80 m. The place shows at once for the sender ("⏳ väntar på godkännande"); the owner approves in stats.html.
   Never on a marker, a popup, a control or during a pinch (2+ pointers); not while a sheet / bar sheet is open.
   The click after the long-press is swallowed so Leaflet does not close the menu. No other map long-press exists
   (delight.js long-press = the ÖL! button, the logo tap is separate).
   Hooks: init, onAuthed, barPopupHTML. Public: MAPMENU.open(latlng), MAPMENU.addPlace(lat, lng). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = {}, LP_MS = 600, MOVE_PX = 10;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length; lastPick[key] = i; return a[i]; }
  var TYPES = [["bar", "🍺 Bar", "🍺 Bar"], ["pub", "🍻 Pub", "🍻 Pub"], ["restaurant", "🍽️ Restaurang", "🍽️ Restaurant"], ["cafe", "☕ Café", "☕ Café"],
    ["nightclub", "🕺 Nattklubb", "🕺 Nightclub"], ["other", "📍 Annat", "📍 Other"]];
  var OK = ["➕ Tack! Stället syns för dig nu och för alla när generalen godkänt.", "➕ Inrapporterat till kartografen. Väntar på godkännande.",
    "➕ Ny plätt på kartan – för dig direkt, för alla efter godkännande.", "➕ Spaningen mottagen. Lantmäteriet i Ludvika granskar."];

  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; } return r; });
  }

  /* ---------- long-press ---------- */
  var pts = {}, tm = null, start = null, swallowUntil = 0;
  function cancel() { if (tm) { clearTimeout(tm); tm = null; } }
  function blocked(t) {
    if (!t || !t.closest) return true;
    if (t.closest(".leaflet-marker-icon, .leaflet-marker-pane, .leaflet-popup, .leaflet-control, .leaflet-interactive, button, a, input, select, textarea, label")) return true;
    if (document.body.classList.contains("barsheet-open")) return true;
    if (document.body.classList.contains("ba-edit")) return true;   // ✏️ BAREA editor: taps place corners
    try { if (A.sheetOpen && A.sheetOpen()) return true; } catch (e) {}
    return false;
  }
  function hook() {
    var c = A.map.getContainer();
    c.addEventListener("pointerdown", function (e) {
      pts[e.pointerId] = 1;
      if (Object.keys(pts).length > 1) { cancel(); return; }   // pinch
      if (!A.LIVE || (e.pointerType === "mouse" && e.button !== 0) || blocked(e.target)) return;
      var r = c.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, cx: e.clientX - r.left, cy: e.clientY - r.top };
      cancel();
      tm = setTimeout(function () {
        tm = null;
        if (Object.keys(pts).length > 1) return;
        swallowUntil = Date.now() + 900;
        try { window.FX.vibrate(20); } catch (x) {}
        open(A.map.containerPointToLatLng(window.L.point(start.cx, start.cy)));
      }, LP_MS);
    });
    c.addEventListener("pointermove", function (e) {
      if (!tm || !start) return;
      if (Math.abs(e.clientX - start.x) > MOVE_PX || Math.abs(e.clientY - start.y) > MOVE_PX) cancel();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      c.addEventListener(ev, function (e) { delete pts[e.pointerId]; if (ev !== "pointerleave" || e.pointerType === "mouse") cancel(); });
    });
    A.map.on("zoomstart movestart", cancel);
    // Swallow the click / contextmenu that ends the long-press (Leaflet would close the menu).
    ["click", "contextmenu", "mouseup"].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (Date.now() > swallowUntil || !c.contains(e.target) || (e.target.closest && e.target.closest(".leaflet-popup"))) return;
        if (ev === "contextmenu") e.preventDefault();
        if (ev !== "mouseup") e.stopPropagation();
        if (ev === "click") swallowUntil = 0;
      }, true);
    });
    c.addEventListener("contextmenu", function (e) { if (Date.now() <= swallowUntil || tm) e.preventDefault(); });
  }
  var pop = null;
  function open(ll) {
    if (!ll || !window.L) return;
    var nn = null; try { nn = window.BARS.nearestNamed ? window.BARS.nearestNamed(ll.lat, ll.lng, 60) : null; } catch (e) {}
    var head = nn && nn.spot && nn.spot.name ? "📍 " + nn.spot.name : L("📍 Här", "📍 Here");
    var h = '<div class="lp-menu" role="menu"><div class="lp-h">' + esc(head) + "</div>" +
      '<button type="button" class="btn btn-small lp-b" role="menuitem" data-lp="event">' + esc(L("📨 Skapa event här", "📨 Create an event here")) + "</button>" +
      '<button type="button" class="btn btn-small lp-b" role="menuitem" data-lp="invite">' + esc(L("📍 Bjud in hit", "📍 Invite here")) + "</button>" +
      '<button type="button" class="btn btn-small lp-b" role="menuitem" data-lp="place">' + esc(L("➕ Lägg till ställe här", "➕ Add a place here")) + "</button>" +
      '<div class="lp-note">' + esc(L("🔒 Event och inbjudningar ä privata: bara de inbjudna ser dom.", "🔒 Events and invites are private.")) + "</div></div>";
    pop = window.L.popup({ className: "olnu-lp", closeButton: true, autoPan: true, offset: window.L.point(0, -4), maxWidth: 260 }).setLatLng(ll).setContent(h).openOn(A.map);
    var el = pop.getElement();
    if (el) el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-lp]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var k = b.getAttribute("data-lp");
      A.map.closePopup();
      if (k === "place") { addPlace(ll.lat, ll.lng); return; }
      if (!window.INVITE) return;
      window.INVITE.openCreate({ lat: ll.lat, lng: ll.lng, custom: k === "event" });
    });
  }

  /* ---------- ➕ Lägg till ställe här ---------- */
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(the|pub|bar|restaurang|restaurant|cafe|kafe)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
  function similar(a, b) {
    var x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return true;
    var fx = x.split(" ")[0], fy = y.split(" ")[0];
    return fx.length >= 3 && fx === fy;
  }
  function dupOf(lat, lng, name) {
    var list = [];
    try { list = window.BARS.nearby(lat, lng, 80, 12, { places: true, placeM: 80, maxPlaces: 8 }); } catch (e) {}
    for (var i = 0; i < list.length; i++) if (list[i].bar && similar(list[i].bar.name, name)) return list[i].bar;
    return null;
  }
  function addPlace(lat, lng) {
    if (!A || !A.LIVE) return;
    A.openSheet(L("➕ Lägg till ställe här", "➕ Add a place here"), function (body) {
      var el = A.el, type = "";
      body.appendChild(el("p", { class: "muted", text: L("Saknas en krog, restaurang eller ett café på kartan? Lägg till den här. Den syns för dig direkt och för alla när ägaren godkänt.",
        "Missing a bar, restaurant or café? It shows for you now and for everyone once approved.") }));
      var name = el("input", { class: "inp", maxlength: "60", placeholder: L("Namn, t.ex. Pitchers", "Name"), "aria-label": L("Namn", "Name") });
      body.appendChild(el("label", { class: "ev-l", text: L("Namn", "Name") })); body.appendChild(name);
      var chips = el("div", { class: "ev-kinds" });
      TYPES.forEach(function (k) {
        chips.appendChild(el("button", { type: "button", class: "chip ev-k", "aria-pressed": "false", text: L(k[1], k[2]), onclick: function (ev) {
          type = k[0]; chips.querySelectorAll(".ev-k").forEach(function (x) { x.setAttribute("aria-pressed", String(x === ev.currentTarget)); }); upd();
        } }));
      });
      body.appendChild(el("label", { class: "ev-l", text: L("Typ", "Type") })); body.appendChild(chips);
      var note = el("input", { class: "inp", maxlength: "200", placeholder: L("Kort notering (valfri), t.ex. ”ingång från gården”", "Note (optional)"), "aria-label": L("Notering", "Note") });
      body.appendChild(el("label", { class: "ev-l", text: L("Notering", "Note") })); body.appendChild(note);
      var warn = el("div", { class: "pl-warn", hidden: "" });
      body.appendChild(warn);
      var go = A.btn(L("📤 Skicka", "📤 Send"), "btn-green btn-block", function () { send(false); });
      body.appendChild(go);
      body.appendChild(el("p", { class: "muted ev-legal", text: L("Max 5 om dan. Bara riktiga ställen – ägaren kollar varje förslag.", "Max 5 a day. Real places only.") }));
      function upd() { go.disabled = !(type && name.value.trim().length >= 2); }
      name.addEventListener("input", function () { warn.hidden = true; upd(); });
      upd();
      function send(force) {
        var nm = name.value.trim();
        if (!force) {
          var d = dupOf(lat, lng, nm);
          if (d) {
            warn.innerHTML = ""; warn.hidden = false;
            warn.appendChild(el("p", {}, [el("b", { text: L("Finns redan: ", "Already here: ") + d.name + "?" })]));
            warn.appendChild(el("div", { class: "row" }, [
              A.btn(L("👍 Ja, dä ä den", "👍 Yes, that one"), "btn-small", function () { A.closeSheet(); if (A.openBar) A.openBar(d); }),
              A.btn(L("➕ Nej, lägg till ändå", "➕ No, add anyway"), "btn-small btn-amber", function () { send(true); })]));
            return;
          }
        }
        go.disabled = true;
        call("suggest_place", { p_name: nm, p_type: type, p_lat: lat, p_lng: lng, p_note: note.value.trim() || null }).then(function (r) {
          go.disabled = false;
          if (r.error) {
            var m = String(r.error.message || "");
            A.toast(r.off ? L("Servern kan int' ta emot ställen än.", "Not on the server yet.") : /slow_down/.test(m) ? L("Lugn – max 5 ställen om dan.", "Max 5 a day.") :
              /invalid_place/.test(m) ? L("Kolla namnet (2–60 tecken, inga länkar).", "Check the name.") : L("Dä gick int'. Försök igen.", "That did not work."), { err: true });
            return;
          }
          var j = A.parseData(r.data);
          addOne({ id: j.bar_id, name: j.name || nm, type: j.type || type, lat: lat, lng: lng, pending: true, mine: true });
          A.closeSheet();
          A.toast(sv() ? pick("ok", OK) : "➕ Thanks! It shows for you now, for everyone after approval.");
        });
      }
      setTimeout(function () { name.focus(); }, 60);
    }, { now: true });
  }
  function addOne(p) {
    if (!p || !p.id || !isFinite(p.lat) || !isFinite(p.lng)) return;
    var b = { id: String(p.id), name: String(p.name || ""), lat: +p.lat, lng: +p.lng, type: p.type === "other" ? "bar" : p.type, user: true, pending: !!p.pending };
    try { if (window.BARS.addUser) window.BARS.addUser(b); } catch (e) {}
  }
  function loadPlaces() {
    var c = null; try { c = A.map.getCenter(); } catch (e) {}
    call("user_places", c ? { p_lat: c.lat, p_lng: c.lng } : {}).then(function (r) {
      if (r.error) return;
      var list = A.parseData(r.data);
      if (Array.isArray(list)) list.forEach(addOne);
    });
  }

  window.MAPMENU = {
    open: open, addPlace: addPlace,
    init: function (api) { A = api; try { hook(); } catch (e) {} },
    onAuthed: function () { setTimeout(loadPlaces, 2500); },
    barPopupHTML: function (bar) {
      if (!bar || !bar.pending) return "";
      return '<div class="ev-line pl-pend"><span class="ev-l-t">' + esc(L("⏳ Väntar på godkännande · syns bara för dig", "⏳ Waiting for approval · only you see it")) + "</span></div>";
    }
  };
})();
