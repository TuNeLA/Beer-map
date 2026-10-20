/* Öl Nu v27 — SKÅLTIMMEN (BeReal for the group; CONTRACT "v27", migrations 0040 + 0041). window.SKAL.
   - The 🎖️ gruppchef, the 👑 owner or a 🎗️ vice taps "🍻 Skåltimmen!" on the group page → skal_start() +
     notify-group {event:"skal_hour", hour_id}. Or the group switches on "🎲 Slumpad skåltimme": the server picks one
     secret moment per night between 20:00 and 01:00 and the first member poll after it fires it (skal_poll().fired →
     this app sends the push).
   - Everyone gets a push + an in-app banner "SKÅLTIMMEN! 3 min – visa din dricka!" and has 3 minutes to send a
     photo of the drink (camera, photo.js pipeline: ≤ 1024 px JPEG ≈ 120 KB, no EXIF) → skal_post().
   - You see the others' photos only after you post your own; before that: blurred tiles with names.
   - Result card: first in, late, "saknas i strid". In time = +5 meriter (skal_hour_posts.pts, counted by meriter).
   - Limits (server): 1 per 30 min per group, 4 per night. Late posts until 60 min after the start.
   Hooks (app.js mods): init, onAuthed, onPoll, onReadyShow, applyText, groupItem, hudChipsHTML, hudClick,
   openSkalLink(id) (routeOpen ?skal=<id>). Missing RPC (old database) → everything hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = {}, state = "unknown";            // "unknown" | "on" | "missing"
  var hours = [], skew = 0, pollAt = 0, busy = false, tick = null, linkDone = false;
  var stCache = {};                                     // group id → {at, d}
  var SEEN_KEY = "olnu.skalSeen", HIDE_KEY = "olnu.skalHidden", PUSH_KEY = "olnu.skalPushed", LINE_KEY = "olnu.skalLines";
  var CODES = ["not_member", "not_allowed", "skal_slow", "skal_limit", "skal_not_found", "skal_closed", "skal_posted",
    "skal_locked", "invalid_photo", "photo_not_found", "slow_down", "not_authenticated"];

  /* ---------- Texts (dalmål + military, ä for é; English fallback) ---------- */
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function spick(seed, a) { return a && a.length ? a[hash(seed) % a.length] : ""; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  // Random line that this phone has not shown lately (per list, remembers up to 12 per list).
  function pick(key, a) {
    if (!a || !a.length) return "";
    var mem = U.ls.getJSON(LINE_KEY, {}) || {}, used = Array.isArray(mem[key]) ? mem[key] : [];
    var free = []; for (var i = 0; i < a.length; i++) if (used.indexOf(i) < 0) free.push(i);
    if (!free.length) { used = []; free = a.map(function (x, j) { return j; }); }
    var idx = free[Math.floor(Math.random() * free.length)];
    used.push(idx); mem[key] = used.slice(-Math.min(12, a.length - 1)); U.ls.setJSON(LINE_KEY, mem);
    return a[idx];
  }
  var ALERT = "SKÅLTIMMEN! 3 min – visa din dricka!";
  var T = {
    sub: ["Glaset i kameran, soldat!", "Höj glaset och tryck av.", "Visa vad som står på bordet. Inget fusk.",
      "Klockan tickar. Bildbevis på drickan!", "Plutonen höjer glasen – var ä du?", "Dricka fram, kamera upp.",
      "Ett glas, ett foto, en legend.", "Först fota, sen skåla. I den ordningen.", "Radion sprakar: skåltimme, över!",
      "Visa din dricka, sen får du se dom andras.", "Spaningsorder: vad dricker du just nu?", "Skålgeneralen kallar till uppställning!",
      "Int' tänka. Bara fota.", "Vattenglas räknas också. Bevis ä bevis.", "Tre minuter. Dalregementet väntar.",
      "Sätt ner allt utom glaset.", "Ingen pose. Det som ä, ä.", "Fram med kameran, ut med sanningen."],
    subEn: ["Glass in the camera, soldier!", "Raise the glass and snap it.", "Show what is on the table. No cheating.",
      "The clock is ticking. Photo proof of your drink!", "Show yours, then you see theirs."],
    autoHead: ["🎲 Slumpen slog till!", "🎲 Ingen bad om det. Slumpen gjorde det.", "🎲 Hemlig order från högkvarteret!",
      "🎲 Servern blev törstig.", "🎲 Skålroboten vaknade.", "🎲 Överraskningsanfall!", "🎲 Ödet har talat.", "🎲 Klockan slog skål."],
    startOk: ["🍻 Skåltimmen ä igång! Truppen har 3 min.", "🍻 Skålpipan ä blåst. 3 minuter, gå!", "🍻 Larmet går. Alla glas i kameran!",
      "🍻 Order utskickad: visa drickan.", "🍻 Klockan tickar för hela truppen.", "🍻 Skåltimme beordrad. Ta själv en bild också!",
      "🍻 Nu ä dä allvar. 3 min.", "🍻 Truppen ä larmad. Du ä också med, chefen."],
    first: ["🥇 Först in! Snabbaste glaset i Dalarna.", "🥇 Ettan! Du hann före skummet la sig.", "🥇 Blixtsnabbt. Guldmedalj i skålfoto.",
      "🥇 Först på plats. Truppen bugar.", "🥇 Snabbare än en bartender på fredag.", "🥇 Först! Dä kallas beredskap, dä."],
    inTime: ["🍻 Inne i tid! +5 meriter.", "🍻 Bildbevis säkrat. +5 meriter.", "🍻 Snyggt glas, soldat. +5 meriter.",
      "🍻 Rapporterat! Generalstaben nickar. +5", "🍻 I tid! Nu får du se dom andras.", "🍻 Klart! Ditt glas ä med i rullan. +5",
      "🍻 Godkänt av skålkommittén. +5 meriter.", "🍻 Fint fångat! +5 meriter.", "🍻 Dricka dokumenterad. +5",
      "🍻 Mottaget. Lås upp och kika på dom andra.", "🍻 Glaset ä inrapporterat. +5 meriter.", "🍻 Snabbt och snyggt. +5"],
    late: ["⏰ Sent, men in! Bättre sent än saknad i strid.", "⏰ Efter gonggongen. Inga meriter, men ära.", "⏰ För sent för medalj, int' för skål.",
      "⏰ Tåget gick, men du sprang ikapp.", "⏰ Sen, men glaset räknas i hjärtat.", "⏰ Kom in i sista vagnen. Nu ser du dom andras.",
      "⏰ Skålpolisen noterar: sen men glad.", "⏰ Bättre sent än aldrig, säger farbror i Grangärde."],
    missing: ["Saknas i strid. Sist sedd i baren.", "Saknas i strid. Glaset ä kvar, soldaten ä borta.", "Saknas i strid. Radion svarar int'.",
      "Saknas i strid. Antagligen i kön till toan.", "Saknas i strid. Kanske på dansgolvet, kanske i en taxi.",
      "Saknas i strid. Mobilen ligger säkert i jackan.", "Saknas i strid. Spårhunden ä utskickad.", "Saknas i strid. Upptagen med att ha kul.",
      "Saknas i strid. Brevduvan ä på väg.", "Saknas i strid. Troligen mitt i en djup diskussion.", "Saknas i strid. Sågs senast vid korvkiosken.",
      "Saknas i strid. Skålen ekade tom.", "Saknas i strid. Kameran va' visst i fickan.", "Saknas i strid. Hemvärnet söker.",
      "Saknas i strid. Ingen fara – nästa skåltimme kommer.", "Saknas i strid. Fast vi saknar dig ändå."],
    allIn: ["🎖️ Hela truppen i tid! Dalregementet ä stolt.", "🎖️ Alla glas i rutan. Sånt ser man sällan.", "🎖️ Fullt hus! Skålgeneralen fäller en tår.",
      "🎖️ Ingen saknas. Ni ä en riktig pluton.", "🎖️ Hundra procent närvaro. Lumpen va' sämre."],
    noneIn: ["📭 Ingen hann. Truppen ä för upptagen med att ha kul.", "📭 Tyst i leden. Nästa gång, soldater.", "📭 Inga glas. Kanske va' alla i kön.",
      "📭 Tomt i rullan. Skålpipan får blåsa igen."],
    locked: ["🔒 Visa din dricka först – sen ser du dom andras.", "🔒 Inga tjuvkikar! Skicka ditt glas först.", "🔒 Bilderna ä låsta tills du har postat.",
      "🔒 BeReal-regeln: ingen bild, ingen titt.", "🔒 Ditt glas ä nyckeln. Fota för att låsa upp."],
    resHead: ["📋 Skålrapport", "📋 Kvällens glasparad", "📋 Uppställning i bild", "📋 Skålprotokollet", "📋 Glasinspektionen", "📋 Truppens dricka"],
    tileIdle: ["Blås i skålpipan", "Larma truppen", "Alla visar glaset", "3 min, alla fotar"],
    who: ["Bara 🎖️ chefen, 👑 ägaren och 🎗️ vice kan blåsa i skålpipan.", "Skåltimmen startas av 🎖️ chefen, 👑 ägaren eller en 🎗️ vice."],
    random: "Servern väljer en hemlig tid mellan 20 och 01, en gång per kväll. Ingen vet när – int' ens chefen.",
    blurWait: ["Fotar…", "Letar glaset…", "Väntar…", "Skummar…"]
  };
  var ERR = {
    not_member: ["Du ä int' med i gruppen.", "You are not in this group."],
    not_allowed: ["Bara 🎖️ chefen, 👑 ägaren och 🎗️ vice kan starta skåltimmen.", "Only the chief, the owner or a vice can start it."],
    skal_slow: ["Lugn! Max en skåltimme per 30 min.", "Easy! Max one per 30 min."],
    skal_limit: ["Max 4 skåltimmar per kväll. Låt glasen vila.", "Max 4 per night."],
    skal_not_found: ["Skåltimmen finns int' längre.", "That cheers hour is gone."],
    skal_closed: ["För sent – skåltimmen ä stängd (60 min).", "Too late – it is closed."],
    skal_posted: ["Du har redan visat ditt glas. Skål!", "You already posted."],
    skal_locked: ["Visa ditt glas först.", "Post yours first."],
    invalid_photo: ["Bilden gick int' att läsa. Ta en ny.", "Could not read the photo."],
    photo_not_found: ["Bilden ä borta.", "The photo is gone."],
    slow_down: ["Lugn, lugn. Prova igen om en stund.", "Easy. Try again soon."],
    error: ["Det gick int'. Försök igen.", "That did not work. Try again."]
  };
  function errText(c) { var e = ERR[c] || ERR.error; return L(e[0], e[1]); }
  function codeOf(e) {
    var m = String((e && (e.message || e.details || e.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }

  /* ---------- Helpers ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) {
        off[name] = true; r.off = true;
        if (name === "skal_poll" || name === "skal_state") { state = "missing"; hours = []; render(); }
      }
      return r;
    });
  }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function now() { return Date.now() + skew; }
  function msLeft(h) { return Date.parse(h.ends_at) - now(); }
  function lateLeft(h) { return Date.parse(h.late_until || h.ends_at) - now(); }
  function setSkew(d) { var s = d && Date.parse(d.now); if (isFinite(s)) skew = s - Date.now(); }
  function list(key) { var h = U.ls.getJSON(key, []); return Array.isArray(h) ? h : []; }
  function once(key, v) { var s = list(key); if (s.indexOf(v) >= 0) return true; s.push(v); U.ls.setJSON(key, s.slice(-60)); return false; }
  function secTxt(s) { s = s | 0; return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function who(x) { return x.is_me ? L("Du", "You") : (x.name || L("Någon", "Someone")); }
  function fx(big) { try { window.FX.unlock(); window.FX.vibrate(big ? [60, 80, 60, 80, 120] : [30, 50, 30]); } catch (e) {} }
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function afterStrip(fn) { if (stripUp() && window.OLNU_STRIP.after) window.OLNU_STRIP.after(fn); else fn(); }
  function byId(id) { for (var i = 0; i < hours.length; i++) if (String(hours[i].id) === String(id)) return hours[i]; return null; }
  // The live skåltimme that wants MY photo (newest first).
  function todo(skipHidden) {
    var h = list(HIDE_KEY);
    for (var i = 0; i < hours.length; i++) {
      var x = hours[i];
      if (!x.mine && msLeft(x) > 0 && (!skipHidden || h.indexOf(String(x.id)) < 0)) return x;
    }
    return null;
  }
  function headOf(h) { return h.auto ? spick("a" + h.id, T.autoHead) : "🍻 " + (h.by_me ? L("Du", "You") : (h.by || "?")) + L(" blåste i skålpipan", " called it"); }

  /* ---------- Poll ---------- */
  function load(force) {
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    // review2: 20 s while a skåltimme is live or the sheet is open, else 40 s.
    var gapMs = view || hours.some(function (h) { return lateLeft(h) > 0; }) ? 20000 : 40000;
    if (busy || (!force && Date.now() - pollAt < gapMs)) return Promise.resolve();
    if (document.visibilityState === "hidden" && !force) return Promise.resolve();
    busy = true; pollAt = Date.now();
    return call("skal_poll").then(function (r) {
      busy = false;
      if (r.error) return;
      var d = A.parseData(r.data) || {};
      setSkew(d);
      var was = state; state = "on";
      hours = Array.isArray(d.hours) ? d.hours : [];
      // A random skåltimme fired by MY poll: this phone sends the push (once per id).
      (d.fired || []).forEach(function (id) {
        if (once(PUSH_KEY, String(id))) return;
        if (A.PUSH_ON) A.invoke("notify-group", { event: "skal_hour", hour_id: +id });
      });
      notify();
      render();
      if (was !== "on") A.updateCounts();
    }, function () { busy = false; });
  }
  function notify() {
    hours.forEach(function (h) {
      if (!h.mine && !h.by_me && msLeft(h) > 0 && !once(SEEN_KEY, "h" + h.id)) {
        afterStrip(function () {
          fx(true);
          // The banner says it on the map; over an open sheet (banner hidden behind it) a toast says it once.
          var sheetUp = false; try { sheetUp = A.sheetOpen(); } catch (e) {}
          if (sheetUp) A.toast("🍻 " + ALERT + " · " + (h.group_name || ""), { ms: 9000, urgent: true, cls: "sk-toast",
            action: { label: L("📸 Visa", "📸 Show"), fn: function () { shoot(byId(h.id) || h); } } });
        });
      }
      if ((h.done || msLeft(h) <= 0) && (h.mine || h.by_me) && !once(SEEN_KEY, "d" + h.id)) {
        A.toast(spick("r" + h.id, T.resHead) + L(" ä klar", " is ready") + " · " + (h.group_name || ""),
          { ms: 7000, action: { label: L("Visa", "Show"), fn: function () { openHour(h.id); } } });
      }
    });
  }

  /* ---------- Banner + HUD chip ---------- */
  var box = null, bannerSub = {};
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "sk-banner"; box.className = "sk-banner"; box.hidden = true;
    box.setAttribute("role", "status");
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var id = box.getAttribute("data-id"), h = byId(id); if (!h) return;
      if (b.hasAttribute("data-shoot")) shoot(h);
      else if (b.hasAttribute("data-hide")) { once(HIDE_KEY, String(id)); render(); }
      else if (b.hasAttribute("data-open")) openHour(id);
    });
    return box;
  }
  function render() {
    if (!A) return;
    var b = ensureBox(), h = state === "on" ? todo(true) : null, show = !!h && !stripUp();
    b.hidden = !show;
    document.body.classList.toggle("sk-on", show);
    if (h && show) {
      if (!bannerSub[h.id]) bannerSub[h.id] = sv() ? spick("s" + h.id, T.sub) : spick("s" + h.id, T.subEn);
      b.setAttribute("data-id", String(h.id));
      b.innerHTML = '<button type="button" class="sk-b-txt" data-open="1"><b>🍻 ' + esc(L(ALERT, "CHEERS HOUR! 3 min – show your drink!")) + "</b>" +
        '<span class="sk-b-sub">' + esc(bannerSub[h.id] + " · " + (h.group_name || "")) + "</span></button>" +
        '<b class="sk-cd" data-skcd="' + esc(String(Date.parse(h.ends_at))) + '">' + U.mmss(msLeft(h)) + "</b>" +
        '<button type="button" class="sk-b-go" data-shoot="1">' + esc(L("📸 Visa", "📸 Show")) + "</button>" +
        '<button type="button" class="sk-b-x" data-hide="1" aria-label="' + esc(L("Dölj", "Hide")) + '">✕</button>';
    }
    startTick();
  }
  function startTick() {
    var need = !!todo(false) || !!document.querySelector("[data-skcd]");
    if (need && !tick) tick = setInterval(onTick, 1000);
    if (!need && tick) { clearInterval(tick); tick = null; }
  }
  var lastKey = "", stripWas = false;
  function onTick() {
    document.querySelectorAll("[data-skcd]").forEach(function (x) {
      var left = +x.getAttribute("data-skcd") - now();
      x.textContent = U.mmss(left);
      x.classList.toggle("sk-low", left < 60000);
    });
    var t = todo(false), key = t ? "t" + t.id : "", su = stripUp();
    if (key !== lastKey || su !== stripWas) {
      var ended = lastKey && !key;
      lastKey = key; stripWas = su; render();
      try { A.updateCounts(); } catch (e) {}
      if (ended) setTimeout(function () { load(true); }, 1500);
    }
  }
  function chipHTML() {
    if (state !== "on") return "";
    var h = todo(false);
    if (!h) return "";
    return '<button type="button" class="hx-chip hx-urgent hx-skal" data-hx="skal" aria-label="' + esc(L("Skåltimmen: visa din dricka", "Cheers hour: show your drink")) + '">🍻 <b data-skcd="' +
      esc(String(Date.parse(h.ends_at))) + '">' + U.mmss(msLeft(h)) + "</b></button>";
  }

  /* ---------- Post a photo ---------- */
  var fileInp = null;
  function shoot(h) {
    if (!h) return;
    if (!window.PHOTO || !window.PHOTO._shrink) { A.toast(errText("error"), { err: true }); return; }
    if (!fileInp) {
      fileInp = document.createElement("input");
      fileInp.type = "file"; fileInp.accept = "image/*"; fileInp.setAttribute("capture", "environment");
      fileInp.className = "ph-file sk-file"; fileInp.tabIndex = -1; fileInp.setAttribute("aria-hidden", "true");
      document.body.appendChild(fileInp);
      fileInp.addEventListener("change", function () {
        var f = fileInp.files && fileInp.files[0], hh = fileInp._hour;
        try { localStorage.removeItem("olnu.skPick"); } catch (e) {}
        if (!f || !hh) return;
        if (f.type && !/^image\//.test(f.type)) { A.toast(errText("invalid_photo"), { err: true }); return; }
        preview(hh, f);
      });
    }
    fileInp._hour = h; fileInp.value = "";
    try { localStorage.setItem("olnu.skPick", JSON.stringify({ id: h.id, t: Date.now() })); } catch (e) {}   // review2: discard restore
    fileInp.click();
  }
  function preview(h, file) {
    var o = el("div", { class: "ph-ov ph-pick sk-ov", role: "dialog", "aria-modal": "true" }), closed = false, shot = null, busy2 = false;
    var img = el("img", { class: "ph-prev", alt: L("Din dricka", "Your drink") });
    var wait = el("div", { class: "ph-wait", text: L("🍻 Gör bilden liten…", "🍻 Making it small…") });
    var cd = el("b", { class: "sk-cd", "data-skcd": String(Date.parse(h.ends_at)), text: U.mmss(msLeft(h)) });
    var send = el("button", { type: "button", class: "btn sk-send", text: L("🍻 Skicka", "🍻 Send") });
    var again = el("button", { type: "button", class: "btn btn-small", text: L("🔄 Ta om", "🔄 Retake") });
    var cancel = el("button", { type: "button", class: "btn btn-small ph-cancel", text: L("Avbryt", "Cancel") });
    send.disabled = true;
    o.appendChild(el("div", { class: "ph-card sk-card" }, [
      el("h3", { class: "sk-title" }, [document.createTextNode(L("🍻 SKÅLTIMMEN ", "🍻 CHEERS HOUR ")), cd]),
      el("div", { class: "ph-prev-box sk-prevbox" }, [img, wait]),
      el("p", { class: "ph-priv", text: msLeft(h) > 0 ? L("🔒 Bara gruppen ser bilden – och bara dom som själva har postat.", "🔒 Only group members who posted see it.")
        : L("⏰ Klockan har gått. Bilden räknas som sen (inga meriter).", "⏰ Time is up. It counts as late.") }),
      el("div", { class: "ph-row" }, [cancel, again, send])
    ]));
    document.body.appendChild(o);
    function close() { if (closed) return; closed = true; if (img.src) { try { URL.revokeObjectURL(img.src); } catch (e) {} } o.remove(); }
    cancel.addEventListener("click", close);
    again.addEventListener("click", function () { close(); shoot(h); });
    o.addEventListener("click", function (e) { if (e.target === o && !busy2) close(); });
    window.PHOTO._shrink(file).then(function (s) {
      if (closed) return;
      shot = s; img.src = URL.createObjectURL(s.blob); wait.remove(); send.disabled = false;
    }, function () { if (!closed) wait.textContent = L("Bilden gick int' att öppna. Prova igen.", "Could not open the photo."); });
    startTick();
    function go() {
      if (!shot || busy2) return;
      busy2 = true; send.disabled = true; send.textContent = L("Skickar…", "Sending…");
      blobB64(shot.blob).then(function (b64) {
        return call("skal_post", { p_hour_id: +h.id, p_b64: b64, p_w: shot.w, p_h: shot.h });
      }).then(function (res) {
        busy2 = false;
        if (res.error) {
          send.disabled = false; send.textContent = L("🍻 Skicka", "🍻 Send");
          var c = codeOf(res.error);
          A.toast(errText(c), { err: true });
          if (c === "skal_posted" || c === "skal_closed" || c === "skal_not_found") { close(); load(true); }
          return;
        }
        var d = A.parseData(res.data) || {};
        if (d.photo_id) urls[d.photo_id] = URL.createObjectURL(shot.blob);
        var nh = d.hour; if (nh) { var i = hours.indexOf(byId(nh.id)); if (i >= 0) hours[i] = nh; else hours.unshift(nh); }
        else { var hh = byId(h.id); if (hh) hh.mine = true; }
        A.toast(!d.in_time ? pick("late", T.late) : (d.rank | 0) === 1 ? pick("first", T.first) : pick("in", T.inTime), { cls: "skal", ms: 5000 });
        fx(false); close(); render(); A.updateCounts();
        openHour(h.id, nh);
      }, function () {
        busy2 = false; send.disabled = false; send.textContent = L("🍻 Skicka", "🍻 Send");
        A.toast(errText("error"), { err: true });
      });
    }
    send.addEventListener("click", go);
  }
  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  var urls = {}, loading = {};
  function photoUrl(id) {
    if (urls[id]) return Promise.resolve(urls[id]);
    if (loading[id]) return loading[id];
    loading[id] = call("skal_photo", { p_photo_id: +id }).then(function (r) {
      delete loading[id];
      if (r.error) throw new Error(codeOf(r.error));
      var x = A.parseData(r.data), bin = atob(x.b64), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      urls[id] = URL.createObjectURL(new Blob([a], { type: x.mime || "image/jpeg" }));
      return urls[id];
    }, function (e) { delete loading[id]; throw e; });
    return loading[id];
  }
  function viewer(id) {
    var o = el("div", { class: "ph-ov ph-view sk-view", role: "dialog", "aria-modal": "true" });
    var img = el("img", { class: "ph-big", alt: L("Bild", "Photo"), draggable: "false" });
    var x = el("button", { type: "button", class: "btn ph-x", "aria-label": L("Stäng", "Close"), text: "✕" });
    o.appendChild(el("div", { class: "ph-stage" }, [img]));
    o.appendChild(el("div", { class: "ph-bar" }, [x]));
    function close() { o.remove(); document.removeEventListener("keydown", esc2); }
    function esc2(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc2);
    x.addEventListener("click", close);
    o.addEventListener("click", function (e) { if (e.target === o || e.target.classList.contains("ph-stage")) close(); });
    photoUrl(id).then(function (u) { img.src = u; }, function () { close(); A.toast(errText("photo_not_found"), { err: true }); });
    document.body.appendChild(o);
  }

  /* ---------- Hour sheet (live view + results card) ---------- */
  var view = null;
  function openHour(id, first) {
    if (!A) return;
    A.openSheet(L("🍻 Skåltimmen", "🍻 Cheers hour"), function (body) {
      var root = el("div", { class: "sk-sheet" });
      body.appendChild(root);
      view = { id: String(id), body: root, timer: null };
      if (first) drawHour(root, first);
      else root.appendChild(el("p", { class: "muted", text: L("Laddar…", "Loading…") }));
      refreshHour(true);
    }, { now: true });
  }
  function refreshHour(firstCall) {
    if (!view || !document.body.contains(view.body)) { if (view && view.timer) clearInterval(view.timer); view = null; return; }
    var v = view;
    call("skal_hour", { p_hour_id: +v.id }).then(function (res) {
      if (view !== v || !document.body.contains(v.body)) return;
      if (res.error) { v.body.innerHTML = ""; v.body.appendChild(el("p", { class: "muted", text: errText(codeOf(res.error)) })); return; }
      var h = A.parseData(res.data);
      setSkew(h);
      var i = hours.indexOf(byId(h.id)); if (i >= 0) hours[i] = h;
      drawHour(v.body, h);
      if (firstCall && !v.timer) v.timer = setInterval(function () { if (!view || view !== v) { clearInterval(v.timer); return; } refreshHour(false); }, 5000);
      if (h.done && lateLeft(h) <= 0 && v.timer) { clearInterval(v.timer); v.timer = null; }
    });
  }
  function drawHour(body, h) {
    var scr = body.parentNode, sc = scr ? scr.scrollTop : 0;
    body.innerHTML = "";
    var live = msLeft(h) > 0 && !h.done, posts = h.posts || [], missing = h.missing || [];
    var inTime = posts.filter(function (p) { return p.in_time; }), late = posts.filter(function (p) { return !p.in_time; });
    body.appendChild(el("div", { class: "sk-hero" + (live ? " live" : " done") }, [
      el("div", { class: "sk-hero-k", text: headOf(h) }),
      el("div", { class: "sk-hero-t", text: live ? L("SKÅLTIMMEN!", "CHEERS HOUR!") : spick("r" + h.id, T.resHead) }),
      live ? el("div", { class: "sk-hero-cd" }, [el("b", { class: "sk-cd", "data-skcd": String(Date.parse(h.ends_at)), text: U.mmss(msLeft(h)) })])
        : el("div", { class: "sk-hero-s", text: (h.group_name || "") + " · " + U.timeHM(h.created_at) }),
      el("div", { class: "sk-hero-n", text: (h.posted | 0) + "/" + (h.needed | 0) + L(" i tid", " in time") })
    ]));
    if (!h.mine && lateLeft(h) > 0) {
      body.appendChild(A.btn(live ? L("📸 Visa din dricka", "📸 Show your drink") : L("📸 Skicka ändå (sent)", "📸 Send anyway (late)"),
        "btn-block sk-shoot" + (live ? " sk-shoot-live" : ""), function () { shoot(byId(h.id) || h); }));
    }
    if (!h.mine && posts.length) body.appendChild(el("p", { class: "sk-lock", text: spick("l" + h.id, T.locked) }));
    // Tiles: real photos after I posted, blurred tiles with names before
    var grid = el("div", { class: "sk-grid" });
    posts.forEach(function (p) {
      var badge = p.in_time && p.rank === 1 ? "🥇" : !p.in_time ? "⏰" : "";
      var cell = el("button", { type: "button", class: "sk-cell" + (p.in_time ? "" : " late") + (p.photo_id ? "" : " blur"), "aria-label": who(p) + " +" + secTxt(p.sec) });
      var fr = el("div", { class: "sk-ph" + (p.photo_id ? " loading" : "") }, [el("span", { class: "sk-ph-i", text: p.photo_id ? "🍻" : (h.mine ? "📷" : "🔒") })]);
      cell.appendChild(fr);
      cell.appendChild(el("div", { class: "sk-cap" }, [el("b", { text: (badge ? badge + " " : "") + who(p) }), el("small", { text: "+" + secTxt(p.sec) })]));
      if (p.photo_id) {
        photoUrl(p.photo_id).then(function (u) { fr.classList.remove("loading"); fr.innerHTML = ""; fr.appendChild(el("img", { class: "sk-img", src: u, alt: "", draggable: "false" })); },
          function () { fr.classList.remove("loading"); fr.textContent = L("📷 borta", "📷 gone"); });
        cell.addEventListener("click", function () { viewer(p.photo_id); });
      } else if (!h.mine) {
        cell.addEventListener("click", function () { A.toast(spick("l" + h.id, T.locked), { ms: 3500 }); });
      }
      grid.appendChild(cell);
    });
    if (live) missing.forEach(function (m) {
      grid.appendChild(el("div", { class: "sk-cell wait", "aria-label": who(m) }, [
        el("div", { class: "sk-ph" }, [el("span", { class: "sk-ph-i", text: "⏳" })]),
        el("div", { class: "sk-cap" }, [el("b", { text: who(m) }), el("small", { text: spick("w" + h.id + m.k, T.blurWait) })])
      ]));
    });
    if (grid.children.length) body.appendChild(grid);
    else body.appendChild(el("p", { class: "sk-empty muted", text: live ? L("Inga glas än. Truppen letar efter kameran…", "No drinks yet…") : spick("n" + h.id, T.noneIn) }));
    // Results card
    if (!live) {
      var card = el("div", { class: "sk-res" });
      card.appendChild(el("h4", { text: spick("r" + h.id, T.resHead) }));
      if (inTime.length) {
        card.appendChild(el("p", { class: "sk-l gold", text: "🥇 " + L("Först in: ", "First in: ") + who(inTime[0]) + " (+" + secTxt(inTime[0].sec) + ")" }));
        if (inTime.length > 1) card.appendChild(el("p", { class: "sk-l", text: "🐢 " + L("Sist in (men in): ", "Last in: ") + who(inTime[inTime.length - 1]) + " (+" + secTxt(inTime[inTime.length - 1].sec) + ")" }));
        card.appendChild(el("p", { class: "sk-l ok", text: "🎖️ +5 " + L("meriter: ", "merits: ") + inTime.map(who).join(", ") }));
      }
      if (late.length) card.appendChild(el("p", { class: "sk-l late", text: "⏰ " + L("Sent: ", "Late: ") + late.map(function (p) { return who(p) + " (+" + secTxt(p.sec) + ")"; }).join(", ") }));
      missing.forEach(function (m) { card.appendChild(el("p", { class: "sk-l miss", text: "🫥 " + who(m) + ": " + spick(h.id + ":" + m.k, T.missing) })); });
      if (!missing.length && !late.length && (h.needed | 0) > 0) card.appendChild(el("p", { class: "sk-l ok", text: spick("a" + h.id, T.allIn) }));
      body.appendChild(card);
    } else if (missing.length) {
      body.appendChild(el("p", { class: "sk-l muted", text: L("Väntar på: ", "Waiting for: ") + missing.map(who).join(", ") }));
    }
    body.appendChild(el("p", { class: "sk-note muted", text: L("Bilderna syns bara i gruppen och försvinner kl 12 dan efter. Ingen straffas för en missad skål.",
      "Photos stay in the group and vanish at noon the day after.") }));
    if (scr) scr.scrollTop = sc;
    startTick();
  }

  /* ---------- Group page tile + group sheet ---------- */
  function skState(gid, force) {
    var c = stCache[gid];
    if (!force && c && Date.now() - c.at < 20000) return Promise.resolve(c.d);
    return call("skal_state", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data); setSkew(d);
      stCache[gid] = { at: Date.now(), d: d };
      return d;
    });
  }
  function liveOf(gid) { for (var i = 0; i < hours.length; i++) if (hours[i].group_id === gid && msLeft(hours[i]) > 0) return hours[i]; return null; }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || state === "missing" || off.skal_state || !g || !g.id) return;
    var lab = el("span", { class: "sk-gl", text: L("🍻 Skåltimmen!", "🍻 Cheers hour!") });
    var sub = el("span", { class: "sk-gs", text: "" });
    var b = el("button", { type: "button", class: "btn btn-small btn-block sk-gbtn" }, [lab, sub]);
    var row = el("div", { class: "sk-gi" }, [b]);
    wrap.appendChild(row);
    function paint(d) {
      var h = liveOf(g.id) || (d && d.hour && msLeft(d.hour) > 0 ? d.hour : null);
      b.classList.toggle("live", !!h);
      if (h) { sub.innerHTML = '<span class="sk-dot"></span>LIVE <b data-skcd="' + esc(String(Date.parse(h.ends_at))) + '">' + U.mmss(msLeft(h)) + "</b>" + (h.mine ? " ✓" : ""); startTick(); return; }
      if (!d) { sub.textContent = spick(g.id, T.tileIdle); return; }
      var parts = [];
      if (d.hour) parts.push("📋 " + U.timeHM(d.hour.created_at));
      parts.push((d.used | 0) + "/" + (d.max | 0 || 4) + L(" ikväll", " tonight"));
      if (d.random_on) parts.push("🎲");
      sub.textContent = parts.join(" · ");
    }
    paint(null);
    b.addEventListener("click", function () {
      var h = liveOf(g.id);
      if (h) { openHour(h.id); return; }
      openGroup(g);
    });
    skState(g.id).then(function (d) { if (d === null && off.skal_state) { row.remove(); return; } paint(d); });
  }
  function openGroup(g) {
    A.openSheet(L("🍻 Skåltimmen", "🍻 Cheers hour"), function (body) {
      var root = el("div", { class: "sk-sheet" });
      body.appendChild(root);
      root.appendChild(el("p", { class: "muted", text: L("Laddar…", "Loading…") }));
      skState(g.id, true).then(function (d) { if (d) drawGroup(root, g, d); else { root.innerHTML = ""; root.appendChild(el("p", { class: "muted", text: errText("error") })); } });
    });
  }
  function drawGroup(root, g, d) {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "sk-hero idle" }, [
      el("div", { class: "sk-hero-k", text: g.name || "" }),
      el("div", { class: "sk-hero-t", text: L("SKÅLTIMMEN!", "CHEERS HOUR!") }),
      el("div", { class: "sk-hero-s", text: L("Alla får en push och 3 minuter att visa sin dricka. Man ser dom andras glas först när man har postat sitt eget.",
        "Everyone gets a push and 3 minutes to show their drink. You see the others only after you post.") })
    ]));
    var h = d.hour;
    if (h) {
      var live = msLeft(h) > 0;
      root.appendChild(A.btn((live ? "🔴 LIVE · " : "📋 ") + L("Skåltimmen ", "Cheers hour ") + U.timeHM(h.created_at) + " · " + (h.posted | 0) + "/" + (h.needed | 0),
        "btn-block sk-last" + (live ? " live" : ""), function () { openHour(h.id); }));
    }
    if (d.can_start) {
      var wait = Date.parse(d.next_at) - now(), used = d.used | 0, max = d.max | 0 || 4;
      var label = used >= max ? L("🍻 Max " + max + " skåltimmar ikväll", "🍻 Max " + max + " tonight")
        : wait > 1000 ? L("🍻 Nästa skåltimme om " + Math.ceil(wait / 60000) + " min", "🍻 Next in " + Math.ceil(wait / 60000) + " min")
        : L("🍻 SKÅLTIMMEN! Larma truppen", "🍻 CHEERS HOUR! Alert the squad");
      var go = A.btn(label, "btn-block sk-start" + (used >= max || wait > 1000 ? "" : " ready"), function () { start(g, go, root); });
      go.disabled = used >= max || wait > 1000;
      root.appendChild(go);
      root.appendChild(el("p", { class: "sk-help muted", text: used + "/" + max + L(" ikväll · max en per 30 min", " tonight · max one per 30 min") }));
    } else {
      root.appendChild(el("p", { class: "sk-help", text: spick(g.id, T.who) }));
    }
    // 🎲 random mode
    var sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!!d.random_on), "aria-label": L("Slumpad skåltimme", "Random cheers hour") });
    sw.disabled = !d.can_start;
    var rnd = el("div", { class: "sk-rnd" }, [
      el("div", { class: "sk-rnd-t" }, [el("b", { text: L("🎲 Slumpad skåltimme", "🎲 Random cheers hour") }),
        el("small", { text: L(T.random, "The server picks a secret time between 20 and 01, once per night.") })]),
      sw
    ]);
    sw.addEventListener("click", function () {
      if (sw.disabled) return;
      var on = sw.getAttribute("aria-checked") !== "true";
      sw.disabled = true;
      call("skal_set_random", { p_group_id: g.id, p_on: on }).then(function (r) {
        sw.disabled = false;
        if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
        var nd = A.parseData(r.data); stCache[g.id] = { at: Date.now(), d: nd };
        sw.setAttribute("aria-checked", String(!!nd.random_on));
        A.toast(nd.random_on ? L("🎲 Slumpad skåltimme ä på. Ingen vet när. Var beredd!", "🎲 Random cheers hour is on.")
          : L("🎲 Slumpen ä avstängd. Chefen bestämmer igen.", "🎲 Random mode off."), { cls: "skal", ms: 4500 });
        load(true);
      });
    });
    root.appendChild(rnd);
    if (!d.can_start) root.appendChild(el("p", { class: "sk-help muted", text: d.random_on ? L("🎲 Slumpen ä på i den här gruppen.", "🎲 Random mode is on.") : L("🎲 Slumpen ä av.", "🎲 Random mode is off.") }));
  }
  function start(g, b, root) {
    if (b.disabled) return;
    b.disabled = true;
    call("skal_start", { p_group_id: g.id }).then(function (r) {
      if (r.error) {
        b.disabled = false; A.toast(errText(codeOf(r.error)), { err: true });
        skState(g.id, true).then(function (d) { if (d && document.body.contains(root)) drawGroup(root, g, d); });
        return;
      }
      var h = A.parseData(r.data); setSkew(h);
      once(PUSH_KEY, String(h.id)); once(SEEN_KEY, "h" + h.id);
      if (A.PUSH_ON) A.invoke("notify-group", { event: "skal_hour", hour_id: +h.id });
      A.toast(pick("start", T.startOk), { ms: 5000, cls: "skal" });
      fx(true);
      hours = [h].concat(hours.filter(function (x) { return String(x.id) !== String(h.id); }));
      delete stCache[g.id];
      render(); A.updateCounts();
      openHour(h.id, h);
    });
  }

  /* ---------- Deep link ?skal=<id> ---------- */
  function openSkalLink(id) {
    if (!/^\d{1,18}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load(true).then(function () {
        var h = byId(id);
        if (h && !h.mine && lateLeft(h) > 0 && msLeft(h) > 0) openHour(id, h);
        else openHour(id);
      });
    })();
  }
  function linkFromUrl() {
    if (linkDone) return null;
    var id = null;
    try { id = new URLSearchParams(location.search).get("skal"); } catch (e) {}
    if (!id || !/^\d{1,18}$/.test(id)) return null;
    linkDone = true;
    try { var ps = new URLSearchParams(location.search); ps.delete("skal"); history.replaceState(null, "", location.pathname + (ps.toString() ? "?" + ps : "") + location.hash); } catch (e) {}
    return id;
  }

  window.SKAL = {
    state: function () { return state; },
    data: function () { return hours.slice(); },
    openHour: openHour, openSkalLink: openSkalLink, _texts: T, _url: photoUrl,
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
    },
    onAuthed: function () {
      load(true); var id = linkFromUrl(); if (id) { openSkalLink(id); return; }
      // review2: the tab was killed while the camera was open -> back to the skåltimme
      var p = null; try { p = JSON.parse(localStorage.getItem("olnu.skPick") || "null"); localStorage.removeItem("olnu.skPick"); } catch (e) {}
      if (p && p.id && Date.now() - (p.t || 0) < 5 * 60e3) { openSkalLink(String(p.id)); setTimeout(function () { A.toast(L('📷 Telefonen startade om appen medan kameran var öppen. Försök igen – eller ta bilden först och välj den sen.', '📷 The phone restarted the app while the camera was open. Try again – or take the photo first and pick it after.'), { ms: 8000, urgent: true }); }, 1500); }
    },
    onReadyShow: function () { var id = linkFromUrl(); if (id) { openSkalLink(id); return "skal"; } return ""; },
    onPoll: function () { load(false); },
    applyText: function () { bannerSub = {}; render(); },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (action) { if (action !== "skal") return; var h = todo(false); if (h) shoot(h); },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
