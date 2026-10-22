/* Öl Nu — 🏠 FÖLJ MIG HEM (CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS", migration 0141, notify-group v26).
   window.HEMFOLJ, in app.js mods(): init, onAuthed, onPoll, hudChipsHTML, hudClick, openWalkLink + groupActions (gpage.js "+").
   Entry points (no new map button): 🚕 Taxi hem sheet (rundan.js → HEMFOLJ.taxiNode) and the group page "+" ("🏠 Följ mig hem").
   - Walker: picks friends / whole groups (friend_list = friends + group-mates only), needs the 🏠 Hemzon home point
     (homezone.js, phone only). walk_start → push {event:"walk"} to the chosen people. GPS watchPosition (high accuracy) while
     the app is open: walk_ping when moved ≥ 10 m or every 15 s. Screen Wake Lock when the browser has it. Inside 60–150 m of
     the exact home point (2 fixes in a row) → walk_end('home') = "✅ Anton ä hemma! 🏠" in the group chat + push {event:"walk_home"}.
     Ends by itself after 2 h (server). A bottom banner (one at a time with the other banners, hidden while the beer-type strip
     is up) shows "🏠 FÖLJ MIG HEM · 1,2 km kvar · 👀 2 följer" + ✅ Hemma + ✕.
   - PWA limit (said in the UI): a web app gets no GPS in the background. iPhone stops at once, Android soon after. Keep the
     app open with the screen on; we keep the screen awake when we can.
   - Viewers: walk_poll (on auth, app poll ≥ 60 s, every 10 s while a walk is live) → moving pin (initial + 🚶), dashed 🏠 line to the
     rounded home point (±100 m, a faint circle), ONE toast per new walk ("📍 Följ"), "✅ Lisa ä hemma!" once, a calm Ikväll chip
     "🏠 Lisa går hem · 800 m kvar" → fly there. No history: the server keeps one position per walk and clears it at the end.
   - Deep link ?walk=<id> (push tap) → fly to the walk. A missing RPC (old server) = every part hides. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, P = null, pollAt = 0, pollBusy = false, tick = null;
  var mine = null, track = null, layers = {}, seenNew = {}, seenHome = {}, wantFly = null;
  var LS_SEEN = "olnu.walkSeen", LS_MINE = "olnu.walkMine", POLL_MS = 60000, FAST_MS = 10000, PING_MS = 15000, MOVE_M = 10;
  var CODES = ["no_viewers", "too_many", "invalid_home", "slow_down", "walk_not_found", "invalid_position", "not_member", "not_authenticated"];
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  var T = {
    start: ["🏠 Hemmarschen ä igång! {n} kompisar har koll på dig.", "🏠 Eskorten ä på plats: {n} följer dig hem.",
      "🏠 Operation Hemfärd startad. Håll appen öppen, soldat!", "🏠 Nu går vi hem. {n} st vakar över dig.", "🏠 Marsch hemåt! Radion ä på, {n} lyssnar."],
    homeMsg: ["✅ {n} ä hemma! 🏠", "✅ {n} ä hemma. Uppdraget slutfört 🏠", "✅ {n} har nått basen. Godnatt! 🏠", "✅ {n} ä hemma i tofflorna 🏠",
      "✅ Hemma! {n} ä i säkerhet. Över och ut 🏠", "✅ {n} ä hemma. Tack för eskorten! 🏠", "✅ {n} ä hemma. Dörren ä låst, skorna ä av 🏠"],
    homeMe: ["✅ Hemma! Bra marscherat, soldat.", "✅ Framme vid basen. Drick ett glas vatten!", "✅ Hemma! Gänget har fått beskedet.",
      "✅ Uppdraget slutfört. Sov gott!", "✅ Hemma. Eskorten ä avlöst – tack för ikväll."],
    newWalk: ["🏠 {n} går hem och vill att du har koll.", "🏠 {n} ä på väg hem – du ä eskort.", "🏠 Bevakning: {n} går hem nu.", "🏠 {n} har startat hemmarschen. Håll ett öga!"],
    homeOther: ["✅ {n} ä hemma! 🏠", "✅ {n} har landat hemma.", "✅ {n} ä i säkerhet. Bra eskortat!", "✅ {n} ä hemma. Du kan sova lugnt."],
    stop: ["🏁 Delningen ä avslutad. Ingen ser dig längre.", "🏁 Eskorten avlöst.", "🏁 Hemmarschen avbruten – positionen ä raderad."],
    err: { no_viewers: ["Välj minst en kompis.", "Pick at least one friend."], too_many: ["Max 30 personer.", "Max 30 people."],
      invalid_home: ["Spara din hemadress först (🏠 Hemzon).", "Save your home first."], slow_down: ["Lugn – vänta lite och försök igen.", "Slow down – try again soon."] }
  };
  function codeOf(err) { var m = String((err && (err.message || err.details || err.hint)) || ""); for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i]; return "error"; }
  function errText(c) { var x = T.err[c]; return x ? x[sv() ? 0 : 1] : L("Nåt gick fel. Försök igen.", "Something went wrong."); }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off = true; r.off = true; } return r; });
  }
  function push(body) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", body); } catch (e) {} }
  function home() { try { return window.HOMEZONE && window.HOMEZONE.home ? window.HOMEZONE.home() : U.ls.getJSON("olnu.home", null); } catch (e) { return null; } }
  function dist(d) { return d == null ? "–" : d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1).replace(".", sv() ? "," : ".") + " km"; }
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function afterStrip(f) { if (window.OLNU_STRIP && window.OLNU_STRIP.after) window.OLNU_STRIP.after(f); else f(); }

  /* ---------- poll ---------- */
  function poll(force) {
    if (off || pollBusy || !A || !A.LIVE || !A.authed() || document.hidden) return;
    var live = (mine && mine.live) || (P && (P.watching || []).some(function (w) { return w.live; }));
    if (!force && Date.now() - pollAt < (live ? FAST_MS - 500 : POLL_MS)) return;
    pollBusy = true; pollAt = Date.now();
    call("walk_poll", {}).then(function (r) {
      pollBusy = false;
      if (r.error) return;
      P = A.parseData(r.data);
      onMine(P.mine || null);
      draw(); notify(); banner();
      try { A.updateCounts(); } catch (e) {}
      if (wantFly) { var w = byId(wantFly); if (w) { wantFly = null; fly(w); } }
      timer();
    });
  }
  function timer() {
    var live = (mine && mine.live) || (P && (P.watching || []).some(function (w) { return w.live; }));
    if (live && !tick) tick = setInterval(function () { poll(false); banner(); }, FAST_MS);
    if (!live && tick) { clearInterval(tick); tick = null; }
  }
  function byId(id) { return P ? (P.watching || []).filter(function (w) { return String(w.id) === String(id); })[0] : null; }
  function seenGet() { return U.ls.getJSON(LS_SEEN, {}) || {}; }
  function seenSet(k) { var s = seenGet(); s[k] = Date.now(); Object.keys(s).forEach(function (x) { if (Date.now() - s[x] > 86400000) delete s[x]; }); U.ls.setJSON(LS_SEEN, s); }

  /* ---------- viewer: map ---------- */
  function initial(n) { var s = String(n || "?").trim(); return (s[0] || "?").toUpperCase(); }
  function draw() {
    var Lf = window.L; if (!Lf || !A.map) return;
    var live = {};
    ((P && P.watching) || []).forEach(function (w) {
      if (!w.live || w.lat == null || w.lng == null) return;
      live[w.id] = 1;
      var g = layers[w.id], pos = [w.lat, w.lng], hm = w.home_lat != null ? [w.home_lat, w.home_lng] : null, stale = (w.age_s | 0) > 180;
      if (!g) {
        g = layers[w.id] = { grp: Lf.layerGroup().addTo(A.map) };
        if (hm) {
          g.homeC = Lf.circle(hm, { radius: 110, color: "#7fd1ff", weight: 1, opacity: 0.6, fillColor: "#7fd1ff", fillOpacity: 0.08, interactive: false }).addTo(g.grp);
          g.homeM = Lf.marker(hm, { interactive: false, keyboard: false, icon: Lf.divIcon({ className: "hf-home", html: "🏠", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(g.grp);
          g.line = Lf.polyline([pos, hm], { color: "#7fd1ff", weight: 3, opacity: 0.85, dashArray: "6 8", interactive: false }).addTo(g.grp);
        }
        g.pin = Lf.marker(pos, { keyboard: false, zIndexOffset: 900, title: w.name,
          icon: Lf.divIcon({ className: "hf-pin", html: '<b>' + esc(initial(w.name)) + '</b><i aria-hidden="true">🚶</i>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(g.grp);
        g.pin.on("click", function () { info(w.id); });
      } else {
        g.pin.setLatLng(pos);
        if (g.line && hm) g.line.setLatLngs([pos, hm]);
      }
      var el = g.pin.getElement && g.pin.getElement();
      if (el) el.classList.toggle("hf-stale", stale);
    });
    Object.keys(layers).forEach(function (id) { if (!live[id]) { try { layers[id].grp.remove(); } catch (e) {} delete layers[id]; } });
  }
  function left(w) { return w && w.lat != null && w.home_lat != null ? U.haversine(w.lat, w.lng, w.home_lat, w.home_lng) : null; }
  function info(id) {
    var w = byId(id); if (!w) return;
    var age = w.age_s | 0;
    A.toast((age > 180 ? L("📡 Tappad signal – senast för " + Math.round(age / 60) + " min sen. ", "📡 Signal lost – " + Math.round(age / 60) + " min ago. ") : "") +
      "🏠 " + w.name + L(" går hem · ", " walking home · ") + dist(left(w)) + L(" kvar", " left"), { id: "hf-info", ms: 5000 });
  }
  function fly(w) {
    if (!w || w.lat == null || !A.map) return;
    try { A.closeSheet(); } catch (e) {}
    var pts = [[w.lat, w.lng]]; if (w.home_lat != null) pts.push([w.home_lat, w.home_lng]);
    if (pts.length > 1) A.map.flyToBounds(pts, { padding: [70, 70], maxZoom: 17, duration: 0.9 }); else A.map.flyTo(pts[0], 16, { duration: 0.9 });
  }
  function notify() {
    var s = seenGet();
    ((P && P.watching) || []).forEach(function (w) {
      var kn = "n" + w.id, kh = "h" + w.id;
      if (w.live && !s[kn] && !seenNew[kn]) {
        seenNew[kn] = 1; seenSet(kn);
        afterStrip(function () {
          A.toast(sv() ? fill(pick("nw", T.newWalk), { n: w.name }) : "🏠 " + w.name + " is walking home – keep an eye out.", { id: "hf-new-" + w.id, ms: 9000,
            action: { label: L("📍 Följ", "📍 Follow"), fn: function () { fly(byId(w.id) || w); } } });
        });
      }
      if (!w.live && w.end_reason === "home" && !s[kh] && !seenHome[kh]) {
        seenHome[kh] = 1; seenSet(kh); seenSet(kn);
        afterStrip(function () { A.toast(sv() ? fill(pick("ho", T.homeOther), { n: w.name }) : "✅ " + w.name + " is home! 🏠", { id: "hf-home-" + w.id, ms: 7000 }); });
      }
    });
  }

  /* ---------- walker ---------- */
  function onMine(m) {
    mine = m;
    if (m && m.live) { U.ls.setJSON(LS_MINE, { id: m.id, at: Date.now() }); if (!track) startTrack(); }
    else {
      if (track) {
        var why = m && m.end_reason;
        stopTrack();
        if (why === "timeout") A.toast(L("⏱️ 2 timmar gick – delningen slutade av sig själv.", "⏱️ 2 hours passed – sharing ended."), { ms: 7000 });
      }
      U.ls.del(LS_MINE);
    }
  }
  function startTrack() {
    if (track || !navigator.geolocation) return;
    track = { watch: null, fix: null, sent: null, sentAt: 0, near: 0, timer: null, lock: null };
    try {
      track.watch = navigator.geolocation.watchPosition(function (p) {
        if (!track) return;
        track.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
        maybePing(false); arrivedCheck(); banner();
      }, function () { banner(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } catch (e) {}
    track.timer = setInterval(function () { maybePing(true); }, PING_MS);
    // never over the beer-type strip: hide the banner the moment the strip shows
    track.sTimer = setInterval(function () { if (!track) return; var su = stripUp(); if (su !== track.su) { track.su = su; banner(); } }, 500);
    wake();
    banner();
  }
  function stopTrack() {
    if (!track) return;
    try { if (track.watch != null) navigator.geolocation.clearWatch(track.watch); } catch (e) {}
    if (track.timer) clearInterval(track.timer);
    if (track.sTimer) clearInterval(track.sTimer);
    try { if (track.lock) track.lock.release(); } catch (e) {}
    track = null; banner();
    try { A.updateCounts(); } catch (e) {}
  }
  function wake() {
    if (!track || !navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      navigator.wakeLock.request("screen").then(function (l) {
        if (!track) { try { l.release(); } catch (e) {} return; }
        track.lock = l; banner();
        l.addEventListener("release", function () { if (track && track.lock === l) { track.lock = null; banner(); } });
      }).catch(function () {});
    } catch (e) {}
  }
  function maybePing(timerTick) {
    if (!track || !mine || !mine.live || !track.fix) return;
    var f = track.fix, s = track.sent, now = Date.now();
    var moved = s ? U.haversine(s.lat, s.lng, f.lat, f.lng) : 1e9;
    if (now - track.sentAt < 3000) return;
    if (!(moved >= MOVE_M || now - track.sentAt >= PING_MS - 500)) return;
    if (timerTick && now - track.sentAt < PING_MS - 500 && moved < MOVE_M) return;
    track.sent = { lat: f.lat, lng: f.lng }; track.sentAt = now;
    call("walk_ping", { p_id: mine.id, p_lat: f.lat, p_lng: f.lng, p_acc: f.acc }).then(function (r) {
      if (r.error) { if (codeOf(r.error) === "walk_not_found") onMine(null); return; }
      var d = A.parseData(r.data);
      mine = Object.assign({}, mine, d);
      if (d.ok === false) { poll(true); return; }
      banner();
    });
  }
  function arrivedCheck() {
    var h = home(), f = track && track.fix; if (!h || !f || !mine || !mine.live) return;
    var d = U.haversine(f.lat, f.lng, h.lat, h.lng), r = Math.max(60, Math.min(150, (f.acc || 0) + 25));
    if (d <= r) track.near++; else track.near = 0;
    if (track.near >= 2) arrive(true);
  }
  function arrive(auto) {
    if (!mine || !mine.live || mine._ending) return;
    mine._ending = true;
    var id = mine.id;
    call("walk_end", { p_id: id, p_reason: "home", p_line: sv() ? pick("hm", T.homeMsg) : "✅ {n} is home! 🏠" }).then(function (r) {
      if (mine) mine._ending = false;
      if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
      push({ event: "walk_home", walk_id: id });
      onMine(A.parseData(r.data));
      A.toast((sv() ? pick("hme", T.homeMe) : "✅ Home! Well marched.") + (auto ? "" : ""), { cls: "skal", ms: 6000 });
      try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) {}
      poll(true);
    });
  }
  function stopWalk() {
    if (!mine || !mine.live) return;
    call("walk_end", { p_id: mine.id, p_reason: "stop" }).then(function (r) {
      if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
      onMine(A.parseData(r.data));
      A.toast(sv() ? pick("st", T.stop) : "🏁 Sharing ended.");
      poll(true);
    });
  }

  /* ---------- banner (walker) ---------- */
  var box = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div"); box.id = "hf-banner"; box.className = "hf-banner"; box.hidden = true; box.setAttribute("role", "status");
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-home")) arrive(false);
      else if (b.hasAttribute("data-stop")) confirmStop(b);
      else if (b.hasAttribute("data-open")) walkSheet();
    });
    return box;
  }
  function confirmStop(b) {
    if (b.getAttribute("data-sure") === "1") { stopWalk(); return; }
    b.setAttribute("data-sure", "1"); b.textContent = L("Avsluta?", "End?");
    setTimeout(function () { if (b && b.isConnected) { b.removeAttribute("data-sure"); b.textContent = "✕"; } }, 4000);
  }
  function banner() {
    if (!A) return;
    var b = ensureBox(), on = !!(mine && mine.live), show = on && !stripUp();
    b.hidden = !show; document.body.classList.toggle("hf-on", show);
    if (!show) return;
    var h = home(), f = track && track.fix, d = h && f ? U.haversine(f.lat, f.lng, h.lat, h.lng) : null;
    var sub = (d != null ? dist(d) + L(" kvar", " left") : L("📡 Söker GPS…", "📡 Getting GPS…")) + " · 👀 " + (mine.watching | 0) + "/" + (mine.n | 0) +
      " · " + (track && track.lock ? L("🔆 skärmen hålls vaken", "🔆 screen kept on") : L("📱 håll appen öppen", "📱 keep the app open"));
    var html = '<button type="button" class="hf-b-txt" data-open="1"><b>🏠 ' + esc(L("FÖLJ MIG HEM", "WALK ME HOME")) + '</b><span class="hf-b-sub">' + esc(sub) + "</span></button>" +
      '<button type="button" class="hf-b-go" data-home="1">' + esc(L("✅ Hemma", "✅ Home")) + "</button>" +
      '<button type="button" class="hf-b-x" data-stop="1" aria-label="' + esc(L("Avsluta", "End")) + '">✕</button>';
    if (b.getAttribute("data-html") !== html && !b.querySelector('[data-sure="1"]')) { b.innerHTML = html; b.setAttribute("data-html", html); }
  }
  function walkSheet() {
    if (!mine || !mine.live) return;
    A.openSheet(L("🏠 Följ mig hem", "🏠 Walk me home"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { text: L("👀 " + (mine.watching | 0) + " av " + (mine.n | 0) + " tittar just nu" + (mine.group_name ? " · ✅ Hemma! skickas till " + mine.group_name : ""),
        "👀 " + (mine.watching | 0) + " of " + (mine.n | 0) + " watching") }));
      body.appendChild(el("p", { class: "hf-warn", text: L("📱 Håll appen öppen med skärmen på hela vägen. En webbapp får ingen GPS i bakgrunden – iPhone stänger av direkt, Android efter en stund.",
        "📱 Keep the app open with the screen on. A web app gets no GPS in the background.") }));
      body.appendChild(el("p", { class: "muted", text: L("Slutar av sig själv när du ä hemma, eller efter 2 timmar (" + new Date(mine.ends_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) + ").",
        "Ends by itself at home or after 2 hours.") }));
      body.appendChild(el("div", { class: "row" }, [A.btn(L("✅ Jag ä hemma", "✅ I'm home"), "btn-amber btn-block", function () { A.closeSheet(); arrive(false); })]));
      body.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [A.btn(L("🏁 Avsluta delningen", "🏁 Stop sharing"), "btn-block", function () { A.closeSheet(); stopWalk(); })]));
    });
  }

  /* ---------- start sheet ---------- */
  function openStart(opts) {
    opts = opts || {};
    if (!A || !A.LIVE) return;
    if (mine && mine.live) { walkSheet(); return; }
    var h = home();
    A.openSheet(L("🏠 Följ mig hem", "🏠 Walk me home"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "hf-lead", text: L("Dina valda kompisar ser dig röra dig på kartan tills du ä hemma. Når du hemzonen skickas \"✅ Hemma!\" och delningen slutar av sig själv (max 2 timmar).",
        "The friends you pick see you move on the map until you are home. At home a \"✅ Home!\" goes out and sharing stops (max 2 hours).") }));
      if (!h) {
        body.appendChild(el("p", { class: "hf-warn", text: L("🏠 Du har ingen hemadress sparad än. Den behövs för att veta när du ä framme (sparas bara på telefonen).",
          "🏠 No home saved yet. It is needed to know when you arrive (kept on this phone).") }));
        body.appendChild(el("div", { class: "row" }, [A.btn(L("🏠 Spara hemadress", "🏠 Save home"), "btn-amber btn-block", function () {
          if (window.HOMEZONE && window.HOMEZONE.open) window.HOMEZONE.open(); })]));
        return;
      }
      body.appendChild(el("p", { class: "hf-warn", text: L("📱 Håll appen öppen med skärmen på hela vägen hem. En webbapp får ingen GPS i bakgrunden (iPhone stänger av direkt, Android efter en stund)." +
        (navigator.wakeLock ? " Vi håller skärmen vaken åt dig." : " Sätt skärmlåset på \"Aldrig\" en stund."),
        "📱 Keep the app open with the screen on all the way. A web app gets no GPS in the background." + (navigator.wakeLock ? " We keep the screen awake." : "")) }));
      var pickBox = el("div", { class: "hf-pick" }, [el("p", { class: "muted", text: "…" })]);
      body.appendChild(el("h3", { class: "hf-h", text: L("Vem ska ha koll på dig?", "Who should keep an eye on you?") }));
      body.appendChild(pickBox);
      var go = A.btn(L("🏠 Starta – följ mig hem", "🏠 Start – walk me home"), "btn-amber btn-block hf-go", function () { start(); });
      go.disabled = true;
      var gLine = el("p", { class: "muted hf-gline", text: "" });
      body.appendChild(gLine);
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [go]));
      body.appendChild(el("p", { class: "muted hf-priv", text: L("🔒 Bara de du väljer ser dig. Hemmet visas ungefär (±100 m). Ingen historik sparas – positionen raderas när du ä hemma.",
        "🔒 Only the people you pick. Home is shown roughly (±100 m). No history is kept.") }));
      var sel = {}, people = [], groups = [], postG = opts.group ? opts.group.id : null, chips = {};
      function count() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
      function refresh() {
        var n = count(); go.disabled = n === 0;
        go.textContent = n ? L("🏠 Starta – " + n + " följer dig hem", "🏠 Start – " + n + " will follow") : L("🏠 Välj minst en", "🏠 Pick at least one");
        var gn = null; groups.forEach(function (g) { if (g.id === postG) gn = g.name; });
        gLine.textContent = gn ? L("✅ Hemma! skickas till gruppen " + gn + ".", "✅ Home! goes to " + gn + ".") : "";
        pickBox.querySelectorAll("input[data-k]").forEach(function (c) { c.checked = !!sel[c.getAttribute("data-k")]; });
        Object.keys(chips).forEach(function (gid) {
          var all = people.filter(function (p) { return (p.groups || []).some(function (g) { return g.id === gid; }); });
          chips[gid].classList.toggle("on", all.length > 0 && all.every(function (p) { return sel[p.key]; }));
        });
      }
      call("friend_list", { p_name: (A.getName && A.getName()) || null }).then(function (r) {
        pickBox.innerHTML = "";
        if (r.error) { pickBox.appendChild(el("p", { class: "muted", text: errText("error") })); return; }
        var d = A.parseData(r.data); people = d.people || []; groups = d.groups || [];
        if (!people.length) { pickBox.appendChild(el("p", { class: "muted", text: L("Du har inga vänner eller gruppkompisar än. Gå med i en grupp först.", "No friends or group-mates yet.") })); return; }
        if (groups.length) {
          var cr = el("div", { class: "hf-chips" });
          groups.forEach(function (g) {
            var c = A.btn("👥 " + L("Hela ", "All of ") + g.name + " (" + Math.max(0, (g.n | 0) - 1) + ")", "btn-small hf-chip", function () {
              var all = people.filter(function (p) { return (p.groups || []).some(function (x) { return x.id === g.id; }); });
              var on = !all.every(function (p) { return sel[p.key]; });
              all.forEach(function (p) { sel[p.key] = on; });
              if (on) postG = g.id; else if (postG === g.id && !opts.group) postG = null;
              refresh();
            });
            chips[g.id] = c; cr.appendChild(c);
          });
          pickBox.appendChild(cr);
        }
        var ul = el("ul", { class: "hf-people" });
        people.forEach(function (p) {
          var cb = el("input", { type: "checkbox", "data-k": p.key, id: "hf-p-" + p.key });
          cb.addEventListener("change", function () { sel[p.key] = cb.checked; if (cb.checked && !postG && p.groups && p.groups[0]) postG = p.groups[0].id; refresh(); });
          ul.appendChild(el("li", {}, [el("label", { for: "hf-p-" + p.key }, [cb, el("span", { class: "hf-nm", text: (p.out ? "🟢 " : "") + p.name }),
            el("small", { class: "muted", text: (p.groups || []).map(function (g) { return g.name; }).slice(0, 2).join(", ") || (p.friend ? L("vän", "friend") : "") })])]));
        });
        pickBox.appendChild(ul);
        if (opts.group) people.forEach(function (p) { if ((p.groups || []).some(function (g) { return g.id === opts.group.id; })) sel[p.key] = true; });
        refresh();
      });
      function start() {
        var keys = Object.keys(sel).filter(function (k) { return sel[k]; });
        if (!keys.length) return;
        go.disabled = true; go.textContent = L("📡 Startar…", "📡 Starting…");
        var begin = function (pos) {
          var c = pos && pos.coords;
          call("walk_start", { p_home_lat: h.lat, p_home_lng: h.lng, p_keys: keys, p_group_ids: [], p_group_id: postG,
            p_lat: c ? c.latitude : null, p_lng: c ? c.longitude : null, p_acc: c ? c.accuracy : null, p_name: (A.getName && A.getName()) || null }).then(function (r) {
            if (r.error) { go.disabled = false; refresh(); A.toast(errText(codeOf(r.error)), { err: true }); return; }
            var m = A.parseData(r.data);
            A.closeSheet();
            onMine(m);
            if (track && c) { track.fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, at: Date.now() }; track.sent = { lat: c.latitude, lng: c.longitude }; track.sentAt = Date.now(); }
            push({ event: "walk", walk_id: m.id });
            A.toast(sv() ? fill(pick("s", T.start), { n: m.n | 0 }) : "🏠 Walk home started – " + (m.n | 0) + " following.", { cls: "skal", ms: 6000 });
            banner(); poll(true);
          });
        };
        try { A.getPosition().then(begin, function () { begin(null); }); } catch (e) { begin(null); }
      }
    });
  }

  /* ---------- hooks ---------- */
  window.HEMFOLJ = {
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) return;
        poll(true);
        if (track) { wake(); maybePing(true); }
      });
    },
    onAuthed: function () {
      poll(true);
      try {
        var q = new URLSearchParams(location.search), w = q.get("walk");
        if (w) { wantFly = w; q.delete("walk"); var s = q.toString(); history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash); }
      } catch (e) {}
    },
    onPoll: function () { poll(false); },
    openWalkLink: function (id) { wantFly = String(id); poll(true); },
    hudChipsHTML: function () {
      if (!P || off) return "";
      var w = (P.watching || []).filter(function (x) { return x.live && x.lat != null; })[0];
      if (!w) return "";
      var d = left(w);
      return '<button type="button" class="hx-chip hx-walk" data-hx="walkw:' + esc(String(w.id)) + '">🏠 ' + esc(w.name + L(" går hem", " walking home") + (d != null ? " · " + dist(d) + L(" kvar", " left") : "")) + "</button>";
    },
    hudClick: function (a) { if (String(a || "").indexOf("walkw:") === 0) fly(byId(a.slice(6))); },
    groupActions: function (g) {
      if (!A || !A.LIVE || off || !g || !g.id || g.dm) return null;
      var on = mine && mine.live;
      return { id: "hf-ga", icon: "🏠", label: on ? L("Följ mig hem: på", "Walk me home: on") : L("Följ mig hem", "Walk me home"),
        sub: on ? L("👀 " + (mine.watching | 0) + " följer", (mine.watching | 0) + " watching") : L("Kompisarna ser dig tills du ä hemma", "Friends see you until you're home"), sect: 1,
        onClick: function () { openStart({ group: g }); } };
    },
    taxiNode: function () {
      if (!A || !A.LIVE || off) return null;
      var on = mine && mine.live;
      var b = A.btn(on ? L("🏠 Följ mig hem: på · visa", "🏠 Walk me home: on") : L("🏠 Följ mig hem – kompisarna ser dig tills du ä hemma", "🏠 Walk me home – friends see you until you're home"),
        "btn-block hf-taxi", function () { openStart({}); });
      return A.el("div", { class: "row hf-taxi-row", style: "margin:4px 0 10px" }, [b]);
    },
    open: openStart,
    // tests
    _poll: function () { return P; }, _mine: function () { return mine; }, _arrive: arrive, _track: function () { return track; }
  };
})();
