/* Öl Nu — ENGÅNGSKAMERAN 2: the in-app camera + a shot queue that never loses a photo. window.FILMCAM.
   Why: the old camera (film.js) used <input type=file capture>. That hands the phone over to the camera app; Android
   (Samsung Internet / Chrome PWA) often kills the page meanwhile, so the result never comes back ("it opened the
   camera app and the photo was not added"). Server logs showed exactly that: film_state, a full cold start, no film_shoot.
   - FILMCAM.open(g, d): full-screen viewfinder with getUserMedia (rear camera, 🔄 flip, big red shutter, LCD counter,
     "7 av 10 kvar"). No preview of the result: a white click-flash and a short "film winding" pause, like the real thing.
     First time: a dalmål pre-prompt explains why the app asks for the camera. Denied / no camera / no getUserMedia
     → a card with the old file input as fallback (and how to allow the camera).
   - Every shot (in-app or file) goes into an IndexedDB queue FIRST ("olnu-film-q"), then up with film_shoot (same RPC,
     same size rules as chat photos: PHOTO._shrink). It leaves the queue only when the server took it or answered with a
     final error (film_empty / film_full / not_member / invalid_photo) — then the user gets a clear toast. Network errors:
     kept, retried (backoff, on 'online', on visible, on app start) and shown with a "Försök igen" button.
   - File fallback: pending state in localStorage (olnu.fmPick) before the picker opens. When the phone restarted the page
     meanwhile (the file is gone – the web can not get it back), the app reopens the camera sheet and offers
     "Välj bilden från Galleriet" (no capture = no camera app) or the in-app camera.
   - The camera stream stops on close, when the app goes to the background (visibilitychange/pagehide) and comes back on return.
   Hooks: init(api) and onAuthed() are called from film.js (FILM.init / FILM.onAuthed); film.js gives FILM._shot(gid, x)
   (server answer → counters) and FILM.openCam(g). note(g) = a small "bilder väntar" line for the camera sheet. */
(function () {
  "use strict";
  var I = window.I18N;
  var A = null, inited = false;
  var PICK_KEY = "olnu.fmPick", OK_KEY = "olnu.fmCamOk", FAC_KEY = "olnu.fmFacing";
  var FINAL = ["film_empty", "film_full", "not_member", "invalid_photo"];
  var CODES = ["not_member", "invalid_photo", "slow_down", "film_empty", "film_full", "not_authenticated"];
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(m, o) { try { A.toast(m, o); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function reduced() { try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function vib(p) { try { window.FX.vibrate(p); } catch (e) {} }
  var used = {};
  function pick(key, a) {
    var u = used[key] || [], free = [];
    for (var i = 0; i < a.length; i++) if (u.indexOf(i) < 0) free.push(i);
    if (!free.length) { u = []; free = a.map(function (x, j) { return j; }); }
    var idx = free[Math.floor(Math.random() * free.length)];
    u.push(idx); used[key] = u.slice(-Math.max(1, a.length - 1));
    return a[idx];
  }

  /* ---------- Texts (dalmål + spec-ops) ---------- */
  var T = {
    preT: ["📸 Kameran behöver lov", "📸 Linsen vill ha tillstånd", "📸 Fotografen behöver papper"],
    pre: ["Engångskameran knäpper bilderna här inne i appen. Då behöver Öl Nu få använda kameran – telefonen frågar strax, tryck Tillåt.",
      "För att du int' ska bli utkastad till kameraappen (där bilderna försvinner) tar vi bilden här i appen. Telefonen frågar om lov – tryck Tillåt.",
      "Kameran öppnas bara när du själv trycker på den, och bilden går rakt in på gruppens film. Telefonen frågar strax – tryck Tillåt."],
    preSub: "🔒 Ingen ser bilderna – int' ens du – förrän kl 10. Kameran stängs när du stänger.",
    starting: ["Laddar filmen…", "Vevar fram linsen…", "Putsar linsen…"],
    click: ["📸 Klick! Bilden ä på filmen.", "📸 Knäpp! Ingen ser den förrän kl 10.", "📸 Fångad. Mörkrummet tar hand om resten.",
      "📸 Klick-klick! Rullen snurrar vidare.", "📸 I lådan. Int' ens du får se den nu.", "📸 Säkrad på filmen. Spänning till i morron!",
      "📸 Knäpp! Dä där blir en klassiker.", "📸 Klick. Sanningen kommer kl 10.", "📸 Ett bevis till på rullen.",
      "📸 Fotolabbet tackar för bidraget.", "📸 Knäpp! Hoppas tummen int' va' framför.", "📸 Klick. Minnet ä sparat, du får glömma nu."],
    sent: ["📸 Bilden ä på rullen. Framkallas kl 10.", "📸 Säkrad på filmen, soldat. Kl 10 får ni se.", "📸 Bilden kom fram. Mörkrummet har'n nu.",
      "📸 Inlämnad till fotolabbet. Över och ut.", "📸 På filmen! Ingen tjuvkik förrän kl 10."],
    wind: ["▸▸ vevar filmen…", "▸▸ rullen snurrar…", "▸▸ klick… vev… vev…"],
    last: ["🎞️ Sista bilden! Filmen ä slut för ikväll.", "🎞️ Rullen ä full. Framkallas kl 10.", "🎞️ Tio av tio. Du ä en riktig krigsfotograf."],
    empty: "FILMEN SLUT",
    hint: ["Rikta. Andas. Knäpp.", "Ingen förhandsvisning. Som förr i tiden.", "Tummen bort från linsen, soldat.", "Tio bilder. Välj med hjärtat.",
      "Ingen ser bilden förrän kl 10 – int' ens du.", "Dalarnas modernaste engångskamera."],
    denT: "📵 Kameran ä avstängd för Öl Nu",
    den: ["Telefonen säger nej till kameran. Slå på den så här:", "Kameran ä spärrad. Så här låser du upp'n:"],
    denHow: "Android: tryck på 🔒 / ⓘ vid adressen (eller håll på app-ikonen → Appinfo) → Behörigheter → Kamera → Tillåt.\niPhone: Inställningar → Safari → Kamera → Fråga/Tillåt (hemskärmsappen frågar igen nästa gång).",
    errT: "📷 Kameran ville int' starta",
    err: ["Linsen krånglar. Prova igen – eller ta bilden med telefonens kamera.", "Kameran svarar int'. Kanske upptagen av en annan app? Stäng den och prova igen."],
    restT: "📷 Telefonen stängde appen",
    rest: ["Telefonen stängde Öl Nu medan kameraappen va öppen, så bilden kom int' fram. Den ligger nog i Galleriet – välj den här.",
      "Mitt i knäppet la telefonen ner appen. Bilden ä int' på filmen än – men den finns nog i Galleriet."],
    restSub: "Tips: använd appens egen kamera, så händer det int' igen.",
    old: "🎞️ Den bilden ä för gammal. Engångskameran tar bara kvällens bilder.",
    lost: "⚠️ {n} från engångskameran hann int' fram innan natten tog slut.",
    waitN: "⏳ {n} skickas…",
    failN: "⚠️ {n} väntar på täckning",
    retry: "🔁 Försök igen",
    resume: "📸 {n} från engångskameran skickas nu…"
  };
  var ERR = {
    not_member: ["Du ä int' med i gruppen längre. Bilden slängdes.", "You are not in this group. The photo was dropped."],
    invalid_photo: ["Bilden gick int' att läsa. Ta en ny.", "Could not read the photo. Take a new one."],
    film_empty: ["🎞️ Filmen ä slut! Bilden fick int' plats (framkallas kl 10).", "Out of film. The photo did not fit."],
    film_full: ["🎞️ Gruppens film ä full för ikväll (60 bilder).", "The group's roll is full."]
  };
  function errText(c) { var e = ERR[c] || ["Det gick int'. Försök igen.", "That did not work. Try again."]; return L(e[0], e[1]); }
  function codeOf(e) {
    var m = String((e && (e.message || e.details || e.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function fillN(s, n) { return String(s).replace("{n}", n + (sv() ? (n === 1 ? " bild" : " bilder") : (n === 1 ? " photo" : " photos"))); }

  /* ---------- Queue: IndexedDB "olnu-film-q" (memory fallback when IndexedDB is blocked) ---------- */
  var db = null, dbP = null, memQ = {}, info = {};   // info[k] = {gid, state: "wait"|"fail"}
  function openDb() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
      try {
        var rq = indexedDB.open("olnu-film-q", 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore("q"); } catch (e) {} };
        rq.onsuccess = function () { db = rq.result; res(db); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbP;
  }
  function tx(mode, fn) {
    return openDb().then(function (d) {
      if (!d) return fn(null);
      return new Promise(function (res) {
        try { var st = d.transaction("q", mode).objectStore("q"); fn(st, res); } catch (e) { res(fn(null)); }
      });
    });
  }
  function qPut(e) {
    memQ[e.k] = e;
    return tx("readwrite", function (st, res) {
      if (!st) return true;
      var r = st.put(e, e.k); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); };
    });
  }
  function qDel(k) {
    delete memQ[k]; delete info[k];
    return tx("readwrite", function (st, res) {
      if (!st) return true;
      var r = st["delete"](k); r.onsuccess = function () { res(true); }; r.onerror = function () { res(false); };
    });
  }
  function qAll() {
    return tx("readonly", function (st, res) {
      if (!st) return Object.keys(memQ).map(function (k) { return memQ[k]; });
      var out = [], c = st.openCursor();
      c.onsuccess = function () { var x = c.result; if (!x) { res(out); return; } out.push(x.value); x["continue"](); };
      c.onerror = function () { res(Object.keys(memQ).map(function (k) { return memQ[k]; })); };
    }).then(function (rows) {
      // Rows in memory but not in IndexedDB (put failed) count too.
      var seen = {}; (rows || []).forEach(function (r) { seen[r.k] = 1; });
      Object.keys(memQ).forEach(function (k) { if (!seen[k]) rows.push(memQ[k]); });
      return rows.sort(function (a, b) { return a.t - b.t; });
    });
  }
  function pendingFor(gid) { var n = 0; Object.keys(info).forEach(function (k) { if (!gid || info[k].gid === gid) n++; }); return n; }
  function failedFor(gid) { var n = 0; Object.keys(info).forEach(function (k) { if ((!gid || info[k].gid === gid) && info[k].state === "fail") n++; }); return n; }
  var subs = [];
  function changed() { subs = subs.filter(function (f) { try { return f() !== false; } catch (e) { return false; } }); }

  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  // reserve(g) at the click (the counter drops at once), enqueue(g, shot, key) when the photo is small.
  function reserve(g) {
    var k = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    info[k] = { gid: g.id, state: "prep" }; changed();
    return k;
  }
  function unreserve(k) { delete info[k]; changed(); }
  function enqueue(g, s, k) {
    var e = { k: k || reserve(g), gid: g.id, gname: g.name || "", blob: s.blob, w: s.w, h: s.h, t: Date.now() };
    info[e.k] = { gid: g.id, state: "wait" };
    changed();
    return qPut(e).then(function () { flush(); return e; });
  }

  /* ---------- Uploader (one at a time, ≥ 3.3 s apart: the server says slow_down within 3 s) ---------- */
  var flushing = false, lastUp = 0, retryT = null, backoff = 0;
  function authed() { return !!(A && A.LIVE && A.authed && A.authed()); }
  function flush() {
    if (flushing || !A) return;
    if (!authed()) return;
    flushing = true; clearTimeout(retryT);
    qAll().then(function (rows) {
      rows.forEach(function (r) { if (!info[r.k]) info[r.k] = { gid: r.gid, state: "wait" }; });
      if (!rows.length) { flushing = false; changed(); return; }
      // A shot older than 20 h belongs to a roll that is already developed: say so, never drop it silently.
      var now = Date.now(), old = rows.filter(function (r) { return now - r.t > 20 * 3600e3; });
      if (old.length) { old.forEach(function (r) { qDel(r.k); }); toast(fillN(L(T.lost, "⚠️ {n} from the camera did not reach the server in time."), old.length), { err: true, ms: 8000 }); }
      var r = rows.filter(function (x) { return now - x.t <= 20 * 3600e3; })[0];
      if (!r) { flushing = false; changed(); return; }
      var wait = Math.max(0, 3300 - (Date.now() - lastUp));
      setTimeout(function () { upload(r); }, wait);
    }, function () { flushing = false; });
  }
  function upload(r) {
    info[r.k] = { gid: r.gid, state: "wait" }; changed();
    blobB64(r.blob).then(function (b64) {
      return A.rpc("film_shoot", { p_group_id: r.gid, p_b64: b64, p_w: r.w, p_h: r.h });
    }).then(function (res) {
      lastUp = Date.now();
      if (res && res.error) {
        var c = codeOf(res.error);
        if (c === "slow_down") { flushing = false; retryT = setTimeout(flush, 3500); return; }
        if (FINAL.indexOf(c) >= 0) {
          return qDel(r.k).then(function () { flushing = false; toast(errText(c), { err: true, ms: 6000 }); changed(); flush(); });
        }
        throw new Error(c);
      }
      var x = (A.parseData ? A.parseData(res.data) : res.data) || {};
      backoff = 0;
      return qDel(r.k).then(function () {
        flushing = false;
        if (cur && cur.g && cur.g.id === r.gid) cur.d = Object.assign({}, cur.d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 });
        try { if (window.FILM && window.FILM._shot) window.FILM._shot(r.gid, x); } catch (e) {}
        if (!camOpen()) toast((x.left | 0) === 0 ? pick("last", T.last) : pick("sent", T.sent), { cls: "skal", ms: 3500 });
        changed(); flush();
      });
    })["catch"](function () {
      flushing = false;
      info[r.k] = { gid: r.gid, state: "fail" }; changed();
      backoff = Math.min(4, backoff + 1);
      retryT = setTimeout(flush, [0, 5000, 15000, 40000, 90000][backoff]);
    });
  }
  function retryNow() { backoff = 0; Object.keys(info).forEach(function (k) { info[k].state = "wait"; }); changed(); if (!flushing) { clearTimeout(retryT); flush(); } }

  /* ---------- Permission ---------- */
  function hasGum() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false; }
  function permState() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        return navigator.permissions.query({ name: "camera" }).then(function (p) { return p.state; }, function () { return "unknown"; });
      }
    } catch (e) {}
    return Promise.resolve("unknown");
  }

  /* ---------- Overlay ---------- */
  var ov = null, stream = null, video = null, cur = null, facing = lsGet(FAC_KEY) === "user" ? "user" : "environment", starting = false;
  function camOpen() { return !!(ov && document.body.contains(ov)); }
  function stopStream() {
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    stream = null;
    if (video) { try { video.srcObject = null; } catch (e) {} }
  }
  function close() {
    stopStream();
    if (ov) { ov.remove(); ov = null; }
    cur = null; video = null;
    window.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) { if (e.key === "Escape" && camOpen()) { e.stopPropagation(); e.preventDefault(); close(); } }
  function shell(cls) {
    if (ov) close();
    ov = el("div", { class: "fc-ov " + (cls || ""), role: "dialog", "aria-modal": "true", "aria-label": L("Engångskamera", "Disposable camera") });
    document.body.appendChild(ov);
    window.addEventListener("keydown", onKey, true);
    return ov;
  }
  function card(title, texts, buttons, sub) {
    var o = shell("fc-cardmode");
    var c = el("div", { class: "fc-card" }, [
      el("h3", { class: "fc-card-t", text: title })
    ]);
    texts.forEach(function (t) { c.appendChild(el("p", { class: "fc-card-p", text: t })); });
    if (sub) c.appendChild(el("p", { class: "fc-card-sub", text: sub }));
    var row = el("div", { class: "fc-card-btns" });
    buttons.forEach(function (b) { if (!b) return; var x = el("button", { type: "button", class: "btn btn-block " + (b.cls || ""), text: b.label }); x.addEventListener("click", b.fn); row.appendChild(x); });
    c.appendChild(row);
    o.appendChild(c);
    o.addEventListener("click", function (e) { if (e.target === o) close(); });
    return o;
  }

  // Entry from film.js (the red shutter in the camera sheet).
  function open(g, d) {
    if (!g || !g.id) return;
    cur = { g: g, d: d || {} };
    var c = cur;
    if (!hasGum()) { fallbackCard(c, "nogum"); return; }
    permState().then(function (st) {
      if (cur !== c) return;
      if (st === "granted") { view(c); return; }
      // "denied": still try once – a blocked camera rejects at once (no prompt), and some browsers report the state wrong.
      if (st === "denied") { view(c); return; }
      if (st === "unknown" && lsGet(OK_KEY) === "1") { view(c); return; }
      preCard(c);
    });
  }
  function preCard(c) {
    card(pick("preT", T.preT), [pick("pre", T.pre)], [
      { label: L("📸 Slå på kameran", "📸 Turn on the camera"), cls: "btn-amber fc-go", fn: function () { view(c); } },
      { label: L("📷 Använd telefonens kameraapp istället", "📷 Use the phone's camera app instead"), cls: "btn-ghost fc-alt", fn: function () { close(); pickFile(c.g, false); } },
      { label: L("Avbryt", "Cancel"), cls: "btn-ghost fc-no", fn: close }
    ], L(T.preSub, "🔒 Nobody sees the photos until 10:00. The camera stops when you close it."));
    cur = c;
  }
  function deniedCard(c) {
    card(L(T.denT, "📵 The camera is blocked for Öl Nu"), [pick("den", T.den)], [
      { label: L("🔁 Prova igen", "🔁 Try again"), cls: "btn-amber fc-go", fn: function () { view(c); } },
      { label: L("📷 Använd telefonens kameraapp", "📷 Use the phone's camera app"), cls: "btn-ghost fc-alt", fn: function () { close(); pickFile(c.g, false); } },
      { label: L("🖼️ Välj från Galleriet", "🖼️ Pick from the Gallery"), cls: "btn-ghost fc-gal", fn: function () { close(); pickFile(c.g, true); } },
      { label: L("Avbryt", "Cancel"), cls: "btn-ghost fc-no", fn: close }
    ], L(T.denHow, "Android: tap 🔒/ⓘ by the address (or long-press the app icon → App info) → Permissions → Camera → Allow. iPhone: Settings → Safari → Camera."));
    cur = c;
  }
  function fallbackCard(c, why) {
    card(L(T.errT, "📷 The camera did not start"), [why === "nogum" ? L("Den här webbläsaren kan int' öppna kameran inne i appen. Ta bilden med telefonens kamera.", "This browser cannot open the camera inside the app.") : pick("err", T.err)], [
      why === "nogum" ? null : { label: L("🔁 Prova igen", "🔁 Try again"), cls: "btn-amber fc-go", fn: function () { view(c); } },
      { label: L("📷 Använd telefonens kameraapp", "📷 Use the phone's camera app"), cls: (why === "nogum" ? "btn-amber " : "btn-ghost ") + "fc-alt", fn: function () { close(); pickFile(c.g, false); } },
      { label: L("Avbryt", "Cancel"), cls: "btn-ghost fc-no", fn: close }
    ], L("Bilden sparas i appen tills den ä uppe på filmen.", "The photo stays in the app until it is on the roll."));
    cur = c;
  }

  /* ---------- Viewfinder ---------- */
  function leftOf(c) { return Math.max(0, (c.d.left | 0) - pendingFor(c.g.id)); }
  function view(c) {
    var o = shell("fc-viewmode");
    cur = c;
    var max = c.d.max | 0 || 10;
    video = el("video", { class: "fc-video", playsinline: "", muted: "", autoplay: "", "aria-hidden": "true" });
    video.muted = true; video.playsInline = true;
    var msg = el("div", { class: "fc-msg", text: pick("starting", T.starting) });
    var wind = el("div", { class: "fc-wind", "aria-hidden": "true" }, [el("span", { text: "" })]);
    var vf = el("div", { class: "fc-vf" }, [video,
      el("span", { class: "fc-c tl" }), el("span", { class: "fc-c tr" }), el("span", { class: "fc-c bl" }), el("span", { class: "fc-c br" }),
      el("span", { class: "fc-cross", "aria-hidden": "true" }), msg, wind]);
    var x = el("button", { type: "button", class: "fc-x", "aria-label": L("Stäng kameran", "Close the camera"), text: "✕" });
    var lcd = el("b", { class: "fc-lcd-n", text: "00" });
    var leftT = el("div", { class: "fc-left", "aria-live": "polite" });
    var frames = el("div", { class: "fc-frames", "aria-hidden": "true" });
    var status = el("div", { class: "fc-status hint", role: "status", "aria-live": "polite", text: pick("hint", T.hint) });
    var pend = el("div", { class: "fc-pend" });
    var flip = el("button", { type: "button", class: "fc-flip", "aria-label": L("Byt kamera", "Switch camera"), text: "🔄" });
    var shutter = el("button", { type: "button", class: "fc-shutter", "aria-label": L("Ta en bild", "Take a photo") }, [el("span", {})]);
    var body = el("div", { class: "fc-body" }, [
      el("div", { class: "fc-top" }, [el("span", { class: "fc-brand", text: "ÖL NU · ENGÅNGS 27" }), el("span", { class: "fc-grp", text: c.g.name || "" }), x]),
      vf,
      el("div", { class: "fc-info" }, [el("div", { class: "fc-lcd", "aria-hidden": "true" }, [lcd]), el("div", { class: "fc-count" }, [leftT, frames])]),
      status,
      el("div", { class: "fc-ctrl" }, [flip, shutter, el("span", { class: "fc-sp" })]),
      pend
    ]);
    o.appendChild(body);
    var winding = false, alive = true;
    function paint() {
      if (!alive || !document.body.contains(o)) { alive = false; return false; }
      var left = leftOf(c), used = max - left;
      lcd.textContent = ("0" + left).slice(-2);
      leftT.textContent = left > 0 ? L(left + " av " + max + " kvar", left + " of " + max + " left") : L(T.empty, "OUT OF FILM");
      frames.innerHTML = "";
      for (var i = 0; i < max; i++) frames.appendChild(el("span", { class: "fc-fr" + (i < used ? " used" : "") }));
      var full = (c.d.group_n | 0) + pendingFor(c.g.id) >= (c.d.group_max | 0 || 60);
      shutter.disabled = winding || !stream || left <= 0 || full;
      o.classList.toggle("empty", left <= 0);
      var p = pendingFor(c.g.id), f = failedFor(c.g.id);
      pend.innerHTML = "";
      if (f) {
        var rb = el("button", { type: "button", class: "btn btn-small fc-retry", text: L(T.retry, "🔁 Retry") });
        rb.addEventListener("click", retryNow);
        pend.appendChild(el("span", { text: fillN(L(T.failN, "⚠️ {n} waiting for signal"), f) })); pend.appendChild(rb);
      } else if (p) pend.appendChild(el("span", { text: fillN(L(T.waitN, "⏳ sending {n}…"), p) }));
      return true;
    }
    subs.push(paint);
    paint();
    x.addEventListener("click", close);
    flip.addEventListener("click", function () {
      facing = facing === "user" ? "environment" : "user"; lsSet(FAC_KEY, facing);
      start();
    });
    function start() {
      if (!alive || starting) return;
      starting = true; stopStream();
      msg.hidden = false; msg.textContent = pick("starting", T.starting); paint();
      var want = { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1600 }, height: { ideal: 1200 } } };
      navigator.mediaDevices.getUserMedia(want)["catch"](function (e) {
        if (e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "AbortError" && /denied/i.test(e.message || ""))) throw e;
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true });   // simpler constraints (one camera, odd sizes)
      }).then(function (s) {
        starting = false;
        if (!alive || !camOpen() || cur !== c) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        if (document.visibilityState === "hidden") { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; lsSet(OK_KEY, "1");
        var st = (s.getVideoTracks()[0] || {}).getSettings ? s.getVideoTracks()[0].getSettings() : {};
        vf.classList.toggle("mirror", st.facingMode === "user" || (!st.facingMode && facing === "user"));
        video.srcObject = s;
        var pl = video.play(); if (pl && pl["catch"]) pl["catch"](function () {});
        var ready = function () { msg.hidden = true; paint(); };
        if (video.readyState >= 2) ready(); else video.addEventListener("loadeddata", ready, { once: true });
        flip.hidden = false;
      }, function (e) {
        starting = false;
        if (!alive || cur !== c) return;
        alive = false;
        if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) { lsSet(OK_KEY, null); deniedCard(c); }
        else fallbackCard(c, "err");
      });
    }
    o._start = start;
    o._stop = function () { stopStream(); msg.hidden = false; msg.textContent = L("⏸ Kameran vilar", "⏸ Camera paused"); paint(); };
    // Only one camera? Hide the flip button.
    try {
      navigator.mediaDevices.enumerateDevices().then(function (ds) {
        var n = ds.filter(function (d) { return d.kind === "videoinput"; }).length;
        if (n === 1) flip.classList.add("one");
      }, function () {});
    } catch (e) {}
    shutter.addEventListener("click", function () {
      if (shutter.disabled || !stream || !video.videoWidth) return;
      var shot = grab(video, vf);
      if (!shot) { status.textContent = errText("invalid_photo"); return; }
      winding = true; paint();
      vib([15, 30, 15]);
      if (!reduced()) { var f = el("div", { class: "fc-flashfx" }); vf.appendChild(f); setTimeout(function () { f.remove(); }, 260); }
      wind.firstChild.textContent = pick("wind", T.wind);
      o.classList.add("winding");
      status.classList.remove("hint"); status.textContent = pick("click", T.click);
      var key = reserve(c.g);
      if ((c.d.left | 0) - pendingFor(c.g.id) <= 0) status.textContent = pick("last", T.last);
      shot.then(function (s) { return enqueue(c.g, s, key); }).then(null, function () { unreserve(key); status.textContent = errText("invalid_photo"); });
      setTimeout(function () { winding = false; o.classList.remove("winding"); paint(); }, reduced() ? 400 : 900);
    });
    start();
  }
  // Capture what the viewfinder shows (center crop to its aspect), long side ≤ 1600, then the chat-photo rules (PHOTO._shrink).
  function grab(v, box) {
    try {
      var vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh) return null;
      var ar = box.clientWidth && box.clientHeight ? box.clientWidth / box.clientHeight : 3 / 4;
      var sw = vw, sh = vh;
      if (vw / vh > ar) sw = Math.round(vh * ar); else sh = Math.round(vw / ar);
      var sx = Math.round((vw - sw) / 2), sy = Math.round((vh - sh) / 2);
      var k = Math.min(1, 1600 / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      var cx = cv.getContext("2d");
      cx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) {
          cv.width = cv.height = 0;   // free the pixels now
          if (!b) { rej(new Error("encode")); return; }
          if (window.PHOTO && window.PHOTO._shrink) window.PHOTO._shrink(b).then(res, rej);
          else res({ blob: b, w: w, h: h });
        }, "image/jpeg", 0.9);
      });
    } catch (e) { return null; }
  }

  /* ---------- File fallback (with the restart path) ---------- */
  var fileInp = null;
  function pickFile(g, gallery) {
    if (!fileInp) {
      fileInp = document.createElement("input");
      fileInp.type = "file"; fileInp.accept = "image/*";
      fileInp.className = "sk-file fc-file"; fileInp.tabIndex = -1; fileInp.setAttribute("aria-hidden", "true");
      document.body.appendChild(fileInp);
      fileInp.addEventListener("change", function () {
        var f = fileInp.files && fileInp.files[0], gg = fileInp._g;
        lsSet(PICK_KEY, null);
        if (!f || !gg) return;
        if (f.type && !/^image\//.test(f.type)) { toast(errText("invalid_photo"), { err: true }); return; }
        if (fileInp._gal && f.lastModified && Date.now() - f.lastModified > 12 * 3600e3) { toast(L(T.old, "🎞️ That photo is too old. Tonight's photos only."), { err: true, ms: 6000 }); return; }
        toast(L("📸 Framkallar… nä, skickar bara.", "📸 Saving the shot…"), { ms: 2500 });
        (window.PHOTO && window.PHOTO._shrink ? window.PHOTO._shrink(f) : Promise.reject(new Error("no")))
          .then(function (s) { return enqueue(gg, s); }, function () { toast(errText("invalid_photo"), { err: true }); });
      });
    }
    fileInp._g = g; fileInp._gal = !!gallery; fileInp.value = "";
    if (gallery) fileInp.removeAttribute("capture"); else fileInp.setAttribute("capture", "environment");
    // Android can kill the page while the camera app is open: remember it, so the next start can help (restore()).
    lsSet(PICK_KEY, JSON.stringify({ g: g.id, n: g.name || "", t: Date.now(), gal: !!gallery }));
    fileInp.click();
  }
  function restore() {
    var p = null;
    try { p = JSON.parse(lsGet(PICK_KEY) || "null"); } catch (e) {}
    lsSet(PICK_KEY, null);
    if (!p || !p.g || Date.now() - (p.t || 0) > 10 * 60e3) return false;
    var g = { id: String(p.g), name: String(p.n || "") };
    setTimeout(function () {
      try { if (window.FILM && window.FILM.openCam) window.FILM.openCam(g); } catch (e) {}
      setTimeout(function () {
        cur = { g: g, d: {} };
        card(L(T.restT, "📷 The phone closed the app"), [pick("rest", T.rest)], [
          { label: L("🖼️ Välj bilden från Galleriet", "🖼️ Pick the photo from the Gallery"), cls: "btn-amber fc-gal", fn: function () { close(); pickFile(g, true); } },
          hasGum() ? { label: L("📸 Använd appens kamera", "📸 Use the app's camera"), cls: "btn-ghost fc-go", fn: function () { close(); openFresh(g); } } : null,
          { label: L("Avbryt", "Cancel"), cls: "btn-ghost fc-no", fn: close }
        ], hasGum() ? L(T.restSub, "Tip: use the app's own camera, then this does not happen.") : null);
      }, 700);
    }, 800);
    return true;
  }
  // Open the viewfinder with a fresh film_state (counter).
  function openFresh(g) {
    if (!A) return;
    A.rpc("film_state", { p_group_id: g.id }).then(function (r) {
      var d = r && !r.error ? (A.parseData ? A.parseData(r.data) : r.data) : null;
      open(g, d || { left: 10, max: 10 });
    });
  }

  /* ---------- Sheet note (film.js drawCam) ---------- */
  function note(g) {
    var box = el("div", { class: "fc-note", role: "status" });
    function paint() {
      if (box.isConnected) box._seen = true;
      else if (box._seen) return false;
      var p = pendingFor(g.id), f = failedFor(g.id);
      box.innerHTML = ""; box.hidden = !p;
      if (f) {
        box.appendChild(el("span", { text: fillN(L(T.failN, "⚠️ {n} waiting for signal"), f) }));
        var b = el("button", { type: "button", class: "btn btn-small fc-retry", text: L(T.retry, "🔁 Retry") });
        b.addEventListener("click", retryNow); box.appendChild(b);
      } else if (p) box.appendChild(el("span", { text: fillN(L(T.waitN, "⏳ sending {n}…"), p) }));
      return true;
    }
    paint();
    subs.push(paint);
    return box;
  }

  /* ---------- Background / foreground ---------- */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { if (camOpen() && ov._stop) ov._stop(); }
    else { if (camOpen() && ov._start) ov._start(); flush(); }
  });
  window.addEventListener("pagehide", function () { stopStream(); });
  window.addEventListener("online", function () { retryNow(); });

  function init(api) {
    if (inited) return; inited = true; A = api;
  }
  function onAuthed() {
    qAll().then(function (rows) {
      rows.forEach(function (r) { if (!info[r.k]) info[r.k] = { gid: r.gid, state: "wait" }; });
      if (rows.length) toast(fillN(L(T.resume, "📸 Sending {n} from the camera…"), rows.length), { ms: 4000 });
      changed(); flush();
    });
    return restore();
  }

  window.FILMCAM = {
    init: init, onAuthed: onAuthed, open: open, note: note, flush: flush, retry: retryNow, close: close,
    pending: pendingFor, _pick: pickFile, _queue: qAll, _texts: T
  };
})();
