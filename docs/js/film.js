/* Öl Nu v27 — ENGÅNGSKAMERAN (disposable camera; CONTRACT "v27", migrations 0040 + 0042 + 0043). window.FILM.
   - Group page tile "📸 Engångskamera" → a viewfinder-style camera (file input, capture=environment) with a shot
     counter ("7 bilder kvar"). 10 shots per member per group per night (max 60 per group). No preview: the shot goes
     straight on the film (film_shoot) – it is hidden from EVERYONE, also the one who took it, until 10:00 the next
     morning. The camera shows only a thumbnail-less film counter.
   - 10:00: the first member whose app polls (film_poll) claims the roll and sends notify-group {event:"film"}:
     "Filmen är framkallad! 📸" as push; in the app a banner. The roll opens as a film-strip gallery with names and
     times; members react (one emoji each per photo).
   - Morgontidningen: FILM.addToStory(gid, evening, story) adds film_story().camera_photos to the story json, and
     gang.js prefers them for the front photo and the photo strip (FILM._url(id) loads a developed photo).
   - Photos: same photo.js pipeline and byte limits as chat photos. They expire 7 days after 10:00 (30 days when the
     group keeps its chat).
   Hooks (app.js mods): init, onAuthed, onPoll, onReadyShow, groupItem, openFilmLink(group id) (routeOpen ?film=). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = {}, state = "unknown", P = null, pollAt = 0, busy = false, linkDone = false, skew = 0;
  var stCache = {};
  var SEEN_KEY = "olnu.filmSeen", PUSH_KEY = "olnu.filmPushed", HIDE_KEY = "olnu.filmHidden", LINE_KEY = "olnu.filmLines";
  var EMOJIS = ["🔥", "😂", "😍", "🍻", "💀", "👑", "🫡", "🥴"];
  var CODES = ["not_member", "invalid_photo", "slow_down", "film_empty", "film_full", "photo_not_found", "invalid_emoji", "not_authenticated"];

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function spick(seed, a) { return a && a.length ? a[hash(seed) % a.length] : ""; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function pick(key, a) {
    if (!a || !a.length) return "";
    var mem = U.ls.getJSON(LINE_KEY, {}) || {}, used = Array.isArray(mem[key]) ? mem[key] : [];
    var free = []; for (var i = 0; i < a.length; i++) if (used.indexOf(i) < 0) free.push(i);
    if (!free.length) { used = []; free = a.map(function (x, j) { return j; }); }
    var idx = free[Math.floor(Math.random() * free.length)];
    used.push(idx); mem[key] = used.slice(-Math.min(12, a.length - 1)); U.ls.setJSON(LINE_KEY, mem);
    return a[idx];
  }
  var DEV = "Filmen är framkallad! 📸";
  var T = {
    click: ["📸 Klick! Bilden ä på filmen.", "📸 Knäpp! Ingen ser den förrän kl 10.", "📸 Fångad. Mörkrummet tar hand om resten.",
      "📸 Klick-klick! Rullen snurrar vidare.", "📸 Bilden ä i lådan. Int' ens du får se den nu.", "📸 Säkrad på filmen. Spänning till i morron!",
      "📸 Knäpp! Dä där blir en klassiker.", "📸 Klick. Sanningen kommer kl 10.", "📸 Ett bevis till på rullen.",
      "📸 Fotolabbet tackar för bidraget.", "📸 Knäpp! Hoppas tummen int' va' framför.", "📸 Klick. Minnet ä sparat, du får glömma nu."],
    last: ["🎞️ Sista bilden! Filmen ä slut för ikväll.", "🎞️ Rullen ä full. Framkallas kl 10.", "🎞️ Tio av tio. Du ä en riktig krigsfotograf."],
    empty: ["🎞️ Filmen ä slut! Framkallas kl 10:00.", "🎞️ Inga bilder kvar ikväll. Vänta på framkallningen.", "🎞️ Slut på film. Nu får du minnas med huvudet."],
    full: ["🎞️ Gänget har fyllt hela rullen (60 bilder). Imponerande.", "🎞️ Gruppens film ä full. Framkallas kl 10."],
    hint: ["Ingen förhandsvisning. Som förr i tiden.", "Det du fotar ser ingen förrän kl 10 – int' ens du.", "Tio bilder. Välj med hjärtat.",
      "Varje knäpp ä en överraskning i morron.", "Dalarnas modernaste engångskamera.", "Tummen bort från linsen, soldat."],
    devBody: ["{n} bilder från igår väntar.", "Mörkrummet ä klart. {n} bilder.", "Gårdagens bevis ä framkallade.", "Kom och se vad ni gjorde i natt.",
      "Fotolabbet har jobbat hela natten.", "{n} bilder. Ingen kan förneka nåt nu.", "Rullen ä tillbaka från framkallningen."],
    rollHead: ["🎞️ Gårdagens rulle", "🎞️ Från mörkrummet", "🎞️ Framkallat & klart", "🎞️ Bildbevisen", "🎞️ Kvällen i bilder"],
    waiting: ["⏳ Filmen ligger i framkallningen. Kl 10:00 ser ni allt.", "⏳ Mörkrummet jobbar. Kom tillbaka kl 10.", "⏳ Ingen tjuvkik! Klockan 10 vet ni."],
    none: ["Inga framkallade filmer än. Ta första bilden ikväll!", "Rullen ä tom. Någon måste börja knäppa."],
    gone: "{n} st har redan gått ut."
  };
  var ERR = {
    not_member: ["Du ä int' med i gruppen.", "You are not in this group."],
    invalid_photo: ["Bilden gick int' att läsa. Ta en ny.", "Could not read the photo."],
    slow_down: ["Lugn, fotografen. Vänta en sekund.", "Easy. Wait a second."],
    film_empty: ["Filmen ä slut! Framkallas kl 10.", "Out of film. Developed at 10:00."],
    film_full: ["Gruppens film ä full för ikväll (60 bilder).", "The group's roll is full."],
    photo_not_found: ["Bilden ä borta.", "The photo is gone."],
    invalid_emoji: ["Den reaktionen finns int'.", "Unknown reaction."],
    error: ["Det gick int'. Försök igen.", "That did not work. Try again."]
  };
  function errText(c) { var e = ERR[c] || ERR.error; return L(e[0], e[1]); }
  function codeOf(e) {
    var m = String((e && (e.message || e.details || e.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; if (name === "film_poll" || name === "film_state") { state = "missing"; render(); } }
      return r;
    });
  }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function list(key) { var h = U.ls.getJSON(key, []); return Array.isArray(h) ? h : []; }
  function once(key, v) { var s = list(key); if (s.indexOf(v) >= 0) return true; s.push(v); U.ls.setJSON(key, s.slice(-60)); return false; }
  function has(key, v) { return list(key).indexOf(v) >= 0; }
  function rollKey(gid, night) { return gid + "@" + String(Date.parse(night) || night); }
  function fx(p) { try { window.FX.unlock(); window.FX.vibrate(p || 25); } catch (e) {} }
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function hm(iso) { return U.timeHM(iso); }
  function dayLbl(ev) {
    var d = new Date(String(ev).slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return String(ev || "");
    var days = sv() ? ["sön", "mån", "tis", "ons", "tors", "fre", "lör"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
  }

  /* ---------- Poll + "Filmen är framkallad!" ---------- */
  function load(force) {
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    if (busy || (!force && Date.now() - pollAt < 45000)) return Promise.resolve();
    if (document.visibilityState === "hidden" && !force) return Promise.resolve();
    busy = true; pollAt = Date.now();
    return call("film_poll").then(function (r) {
      busy = false;
      if (r.error) return;
      P = A.parseData(r.data) || {};
      var s = Date.parse(P.now); if (isFinite(s)) skew = s - Date.now();
      state = "on";
      (P.rolls || []).forEach(function (x) {
        var k = rollKey(x.group_id, x.night);
        if (x.push_mine && !once(PUSH_KEY, k) && A.PUSH_ON) A.invoke("notify-group", { event: "film", group_id: x.group_id, night: x.night });
      });
      render(); hud();   // 0195 📸 chip
    }, function () { busy = false; });
  }
  function fresh() {
    // Developed rolls (last 20 h) that this phone has not opened or hidden yet.
    return ((P && P.rolls) || []).filter(function (x) { var k = rollKey(x.group_id, x.night); return !has(SEEN_KEY, k) && !has(HIDE_KEY, k); });
  }
  var box = null;
  function render() {
    if (!A) return;
    if (!box) {
      box = document.createElement("div");
      box.id = "fm-banner"; box.className = "fm-banner"; box.hidden = true; box.setAttribute("role", "status");
      document.body.appendChild(box);
      box.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        var x = box._roll; if (!x) return;
        if (b.hasAttribute("data-hide")) { once(HIDE_KEY, rollKey(x.group_id, x.night)); render(); }
        else openRoll({ id: x.group_id, name: x.group_name }, x.night);
      });
    }
    var x = state === "on" ? fresh()[0] : null, show = !!x && !stripUp();
    box.hidden = !show;
    document.body.classList.toggle("fm-on", show);
    if (show) {
      box._roll = x;
      box.innerHTML = "";
      box.appendChild(el("button", { type: "button", class: "fm-b-txt" }, [
        el("b", { text: L(DEV, "The film is developed! 📸") }),
        el("span", { class: "fm-b-sub", text: fill(spick(rollKey(x.group_id, x.night), T.devBody), { n: x.n }) + " · " + (x.group_name || "") })
      ]));
      box.appendChild(el("button", { type: "button", class: "fm-b-go", text: L("🎞️ Visa", "🎞️ Show") }));
      box.appendChild(el("button", { type: "button", class: "fm-b-x", "data-hide": "1", "aria-label": L("Dölj", "Hide"), text: "✕" }));
    }
    if (stripUp() && x && window.OLNU_STRIP.after) window.OLNU_STRIP.after(render);
  }

  /* ---------- Group page tile ---------- */
  function groupOf(gid) { var gs = (P && P.groups) || []; for (var i = 0; i < gs.length; i++) if (gs[i].group_id === gid) return gs[i]; return null; }
  function freshOf(gid) { var f = fresh(); for (var i = 0; i < f.length; i++) if (f[i].group_id === gid) return f[i]; return null; }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || state === "missing" || off.film_state || !g || !g.id) return;
    var sub = el("span", { class: "fm-gs" });
    var b = el("button", { type: "button", class: "btn btn-small btn-block fm-gbtn" }, [el("span", { class: "fm-gl", text: L("📸 Engångskamera", "📸 Disposable camera") }), sub]);
    wrap.appendChild(el("div", { class: "fm-gi" }, [b]));
    function paint() {
      var fr = freshOf(g.id), pg = groupOf(g.id);
      b.classList.toggle("new", !!fr);
      var tn = !fr && pg && (pg.group_n | 0) > 0 && (pg.left | 0) > 0 && !nightOver();   // 0195
      b.classList.toggle("fm-tonight", !!tn);
      if (fr) sub.textContent = L("🎞️ Ny film! " + fr.n + " bilder", "🎞️ New roll! " + fr.n);
      else if (tn) sub.textContent = L("🔴 Gänget fotar ikväll · " + pg.left + " kvar för dig", "🔴 Shooting tonight · " + pg.left + " left for you");
      else if (pg) sub.textContent = pg.left > 0 ? L(pg.left + " bilder kvar", pg.left + " shots left") : L("Filmen slut · kl 10", "Out of film · 10:00");
      else sub.textContent = L("10 bilder per kväll", "10 shots per night");
    }
    paint();
    if (!P) load(true).then(paint);
    b.addEventListener("click", function () {
      var fr = freshOf(g.id);
      if (fr) openRoll(g, fr.night); else openCam(g);
    });
  }

  /* ---------- Camera ---------- */
  function camState(gid, force) {
    var c = stCache[gid];
    if (!force && c && Date.now() - c.at < 15000) return Promise.resolve(c.d);
    return call("film_state", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var d = normState(A.parseData(r.data)); stCache[gid] = { at: Date.now(), d: d };   // cm: unknown count ≠ 0 (ux2)
      return d;
    });
  }
  var fileInp = null, camG = null, camRoot = null;
  function pickFile(cb) {
    if (!fileInp) {
      fileInp = document.createElement("input");
      fileInp.type = "file"; fileInp.accept = "image/*"; fileInp.setAttribute("capture", "environment");
      fileInp.className = "ph-file sk-file"; fileInp.tabIndex = -1; fileInp.setAttribute("aria-hidden", "true");
      document.body.appendChild(fileInp);
      fileInp.addEventListener("change", function () {
        var f = fileInp.files && fileInp.files[0], fn = fileInp._cb;
        try { localStorage.removeItem("olnu.fmPick"); } catch (e) {}
        if (!f || !fn) return;
        if (f.type && !/^image\//.test(f.type)) { A.toast(errText("invalid_photo"), { err: true }); return; }
        fn(f);
      });
    }
    fileInp._cb = cb; fileInp.value = "";
    try { if (camG && camG.id) localStorage.setItem("olnu.fmPick", JSON.stringify({ g: camG.id, n: camG.name || "", t: Date.now() })); } catch (e) {}   // review2
    fileInp.click();
  }
  function openCam(g) {
    camG = g;
    try { stockOf(g.id, true); } catch (e) {}   // cm: the film, in parallel with film_state
    A.openSheet(L("📸 Engångskamera", "📸 Disposable camera"), function (body) {
      var root = el("div", { class: "fm-sheet" });
      body.appendChild(root);
      root.appendChild(el("p", { class: "muted", text: L("Laddar filmen…", "Loading the film…") }));
      camState(g.id, true).then(function (d) {
        if (!document.body.contains(root)) return;
        if (!d) { root.innerHTML = ""; root.appendChild(el("p", { class: "muted", text: errText("error") })); return; }
        drawCam(root, g, d);
      });
    });
  }
  function drawCam(root, g, d) {
    root.innerHTML = "";
    camRoot = { root: root, g: g, d: d };
    var left = d.left | 0, max = d.max | 0 || 10, used = max - left;
    var frames = el("div", { class: "fm-frames", "aria-hidden": "true" });
    for (var i = 0; i < max; i++) frames.appendChild(el("span", { class: "fm-fr" + (i < used ? " used" : "") }));
    var lcd = el("div", { class: "fm-lcd", "aria-label": left + L(" bilder kvar", " shots left") }, [el("b", { text: ("0" + left).slice(-2) })]);
    var shutter = el("button", { type: "button", class: "fm-shutter", "aria-label": L("Ta en bild", "Take a photo") }, [el("span", { text: "" })]);
    var vf = el("div", { class: "fm-vf" }, [
      el("span", { class: "fm-c tl" }), el("span", { class: "fm-c tr" }), el("span", { class: "fm-c bl" }), el("span", { class: "fm-c br" }),
      el("div", { class: "fm-vf-t", text: left > 0 ? L("Rikta. Andas. Knäpp.", "Aim. Breathe. Click.") : L("FILMEN SLUT", "OUT OF FILM") }),
      el("div", { class: "fm-vf-s", text: spick(g.id + d.night, T.hint) })
    ]);
    var cam = el("div", { class: "fm-cam" + (left > 0 ? "" : " empty") }, [
      el("div", { class: "fm-top" }, [el("span", { class: "fm-brand", text: "PINTSNOW · ENGÅNGS 27" }), el("span", { class: "fm-flash", text: "⚡" })]),
      vf,
      el("div", { class: "fm-bottom" }, [lcd, el("div", { class: "fm-count" }, [
        el("b", { class: "fm-left", text: left > 0 ? left + L(" bilder kvar", " shots left") : L("Filmen ä slut", "Out of film") }),
        frames]), shutter])
    ]);
    root.appendChild(cam);
    try { filmRow(root, g, d, cam); } catch (e) {}   // cm
    root.appendChild(el("p", { class: "fm-dev", text: L("🔒 Ingen ser bilderna – int' ens du – förrän kl 10:00 i morron. Då framkallas filmen.",
      "🔒 Nobody sees the photos – not even you – until 10:00 tomorrow.") }));
    root.appendChild(el("p", { class: "fm-grp muted", text: L("Gänget har tagit " + (d.group_n | 0) + " bilder ikväll" + ((d.shooters | 0) ? " (" + d.shooters + " fotografer)" : "") + ".",
      "The group took " + (d.group_n | 0) + " shots tonight.") }));
    shutter.disabled = left <= 0 || (d.group_n | 0) >= (d.group_max | 0 || 60);
    var busy2 = false, inl = null;
    // owner 2026-10-23: the live camera shows right here in the sheet's viewfinder (no extra taps)
    try { if (window.FILMCAM && window.FILMCAM.inline) inl = window.FILMCAM.inline({ g: g, d: d, vf: vf, shutter: shutter, lcd: lcd.firstChild, leftEl: cam.querySelector(".fm-left"), frames: frames, max: max }); } catch (e) { inl = null; }
    shutter.addEventListener("click", function () {
      if (shutter.disabled || busy2) return;
      if (inl) { inl.shoot(); return; }
      if (window.FILMCAM && window.FILMCAM.open) { window.FILMCAM.open(g, d); return; }   // film2: in-app camera
      if (!window.PHOTO || !window.PHOTO._shrink) { A.toast(errText("error"), { err: true }); return; }
      pickFile(function (file) {
        busy2 = true; cam.classList.add("busy");
        window.PHOTO._shrink(file).then(function (s) {
          return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { var x = String(fr.result || ""); res({ b64: x.slice(x.indexOf(",") + 1), s: s }); }; fr.onerror = rej; fr.readAsDataURL(s.blob); });
        }).then(function (o) {
          return call("film_shoot", { p_group_id: g.id, p_b64: o.b64, p_w: o.s.w, p_h: o.s.h });
        }).then(function (r) {
          busy2 = false; cam.classList.remove("busy");
          if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
          var x = A.parseData(r.data) || {};
          flash(cam); fx([15, 30, 15]);
          A.toast((x.left | 0) === 0 ? pick("last", T.last) : pick("click", T.click), { cls: "skal", ms: 3500 });
          var nd = Object.assign({}, d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 });
          stCache[g.id] = { at: Date.now(), d: nd };
          var pg = groupOf(g.id); if (pg) { pg.left = x.left | 0; pg.group_n = x.group_n | 0; }
          shotDone(g.id, x);   // 0195
          if (document.body.contains(root)) drawCam(root, g, nd);
        }, function () { busy2 = false; cam.classList.remove("busy"); A.toast(errText("invalid_photo"), { err: true }); });
      });
    });
    try { if (window.FILMCAM && window.FILMCAM.note) root.appendChild(window.FILMCAM.note(g)); } catch (e) {}
    if (left <= 0) root.appendChild(el("p", { class: "fm-empty", text: spick(g.id + d.night, T.empty) }));
    // Developed rolls
    var rolls = d.rolls || [];
    root.appendChild(el("h3", { class: "fm-h", text: L("🎞️ Framkallade filmer", "🎞️ Developed rolls") }));
    if (!rolls.length) root.appendChild(el("p", { class: "muted", text: spick(g.id, T.none) }));
    rolls.forEach(function (x) {
      root.appendChild(A.btn("🎞️ " + dayLbl(x.evening) + " · " + (x.alive | 0) + L(" bilder", " photos") + ((x.alive | 0) < (x.n | 0) ? L(" (resten utgångna)", " (rest expired)") : ""),
        "btn-block fm-roll-btn" + (has(SEEN_KEY, rollKey(g.id, x.night)) ? "" : " new"), function () { openRoll(g, x.night); }));
    });
    root.appendChild(el("p", { class: "fm-note muted", text: d.keeps ? L("💾 Gruppen sparar chatten: filmerna ligger kvar i 30 dar.", "💾 Kept 30 days.")
      : L("Filmerna ligger kvar i 7 dar efter framkallningen.", "Rolls stay 7 days after developing.") }));
  }
  function flash(cam) {
    try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    var f = el("div", { class: "fm-flashfx" });
    cam.appendChild(f);
    setTimeout(function () { f.remove(); }, 400);
  }

  /* ---------- Developed roll: film-strip gallery ---------- */
  function openRoll(g, night) {
    A.openSheet(L("🎞️ Engångskameran", "🎞️ Disposable camera"), function (body) {
      var root = el("div", { class: "fm-sheet" });
      body.appendChild(root);
      root.appendChild(el("p", { class: "muted", text: L("Hämtar från mörkrummet…", "Fetching from the darkroom…") }));
      call("film_roll", { p_group_id: g.id, p_night: night || null }).then(function (r) {
        if (!document.body.contains(root)) return;
        root.innerHTML = "";
        if (r.error) { root.appendChild(el("p", { class: "muted", text: errText(codeOf(r.error)) })); return; }
        var d = A.parseData(r.data) || {};
        if (d.night) { once(SEEN_KEY, rollKey(g.id, d.night)); render(); }
        drawRoll(root, g, d);
      });
    }, { now: true });
  }
  function drawRoll(root, g, d) {
    if (!d.developed) {
      root.appendChild(el("div", { class: "fm-wait" }, [el("b", { text: "⏳" }), el("p", { text: d.night ? spick(g.id + d.night, T.waiting) : spick(g.id, T.none) })]));
      root.appendChild(A.btn(L("📸 Till kameran", "📸 To the camera"), "btn-block", function () { openCam(g); }));
      return;
    }
    var photos = d.photos || [];
    root.appendChild(el("div", { class: "fm-dev-head" }, [
      el("div", { class: "fm-dev-k", text: spick(g.id + d.night, T.rollHead) + " · " + (g.name || "") }),
      el("div", { class: "fm-dev-t", text: L(DEV, "The film is developed! 📸") }),
      el("div", { class: "fm-dev-s", text: dayLbl(d.evening) + " · " + photos.length + L(" bilder", " photos") +
        ((d.gone | 0) ? " · " + fill(L(T.gone, "{n} expired."), { n: d.gone }) : "") })
    ]));
    if (!photos.length) { root.appendChild(el("p", { class: "muted", text: L("Alla bilder har gått ut.", "All photos expired.") })); return; }
    var cmSave = function () { try { saveCard(root, g, d); } catch (e) {} };   // cm: after the strip (needs the frame edges)
    var strip = el("div", { class: "fm-strip" });
    photos.forEach(function (p, i) {
      var fr = el("div", { class: "fm-shot loading", style: "aspect-ratio:" + Math.max(1, p.w | 0) + "/" + Math.max(1, p.h | 0) }, [el("span", { class: "fm-spin", text: "🎞️" })]);
      var frame = el("figure", { class: "fm-frame" }, [
        el("div", { class: "fm-edge", text: (i + 1) + "A ▸ PINTSNOW 400" }),
        fr,
        el("figcaption", { class: "fm-cap" }, [el("b", { text: p.is_me ? L("Du", "You") : p.name }), el("small", { text: hm(p.at) })]),
        reactBar(p)
      ]);
      fr.addEventListener("click", function () { viewer(p.id); });
      strip.appendChild(frame);
      lazy(fr, p.id);
    });
    root.appendChild(strip);
    cmSave();
    if (d.expires_at) root.appendChild(el("p", { class: "fm-note muted", text: L("Filmen försvinner ", "The roll expires ") + dayLbl(String(new Date(d.expires_at).toISOString())) + "." }));
  }
  function reactBar(p) {
    var bar = el("div", { class: "fm-reacts" });
    function draw() {
      bar.innerHTML = "";
      var counts = {}; (p.reacts || []).forEach(function (x) { counts[x.e] = x.n; });
      EMOJIS.forEach(function (e) {
        var b = el("button", { type: "button", class: "fm-r" + (p.my === e ? " on" : ""), "aria-pressed": String(p.my === e), "aria-label": e }, [
          document.createTextNode(e), counts[e] ? el("small", { text: String(counts[e]) }) : null]);
        b.addEventListener("click", function () {
          bar.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          call("film_react", { p_photo_id: +p.id, p_emoji: e }).then(function (r) {
            if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); draw(); return; }
            var np = A.parseData(r.data) || {};
            p.reacts = np.reacts; p.my = np.my; p.n = np.n;
            try { window.FX.vibrate(10); } catch (x) {}
            draw();
          });
        });
        bar.appendChild(b);
      });
    }
    draw();
    return bar;
  }
  var io = null;
  function lazy(fr, id) {
    function go() {
      photoUrl(id).then(function (u) { fr.classList.remove("loading"); fr.innerHTML = ""; fr.appendChild(el("img", { class: "fm-img", src: u, alt: "", draggable: "false" })); },
        function () { fr.classList.remove("loading"); fr.textContent = L("🎞️ borta", "🎞️ gone"); });
    }
    if (!("IntersectionObserver" in window)) { go(); return; }
    if (!io) io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); if (e.target._go) e.target._go(); } }); }, { rootMargin: "300px" });
    fr._go = go; io.observe(fr);
  }
  var urls = {}, loading = {}, blobs = {};   // cm: blobs = EXIF-stripped bytes (Spara alla)
  function photoUrl(id) {
    id = String(id);
    if (urls[id]) return Promise.resolve(urls[id]);
    if (loading[id]) return loading[id];
    loading[id] = call("film_photo", { p_photo_id: +id }).then(function (r) {
      delete loading[id];
      if (r.error) throw new Error(codeOf(r.error));
      var x = A.parseData(r.data), bin = atob(x.b64), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      try { if (window.FILMFX) a = window.FILMFX.stripJpeg(a); } catch (e) {}   // cm
      blobs[id] = new Blob([a], { type: x.mime || "image/jpeg" });
      urls[id] = URL.createObjectURL(blobs[id]);
      return urls[id];
    }, function (e) { delete loading[id]; throw e; });
    return loading[id];
  }
  function viewer(id) {
    var o = el("div", { class: "ph-ov ph-view fm-view", role: "dialog", "aria-modal": "true" });
    var img = el("img", { class: "ph-big", alt: L("Bild", "Photo"), draggable: "false" });
    var save = el("a", { class: "btn btn-amber ph-save", text: L("💾 Spara", "💾 Save"), download: "olnu-film-" + id + ".jpg", href: "#" });
    var x = el("button", { type: "button", class: "btn ph-x", "aria-label": L("Stäng", "Close"), text: "✕" });
    o.appendChild(el("div", { class: "ph-stage" }, [img]));
    o.appendChild(el("div", { class: "ph-bar" }, [save, x]));
    function close() { o.remove(); document.removeEventListener("keydown", k); }
    function k(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", k);
    x.addEventListener("click", close);
    o.addEventListener("click", function (e) { if (e.target === o || e.target.classList.contains("ph-stage")) close(); });
    try { viewerSave(save, id, close); } catch (e) {}   // cm
    photoUrl(id).then(function (u) { img.src = u; save.href = u; }, function () { close(); A.toast(errText("photo_not_found"), { err: true }); });
    document.body.appendChild(o);
  }

  /* cm FILMRULLAR START */
  /* ---------- cm: Filmrullar (one film per group per night, FILMFX) + "Spara alla" (migration 0345) ----------
     - Camera sheet: a "Film ikväll" card under the camera. "Byt film" opens the picker (6 films, small previews made
       from the live camera frame, or a sample scene when the camera is off). ONE amber: "Ladda <film>". Locked after the
       first photo of the night (server: film_locked).
     - Album: the film name under the title and on the frame edges; the save card "Bilderna från igår är framkallade 📸 –
       vill du spara dem?" + "Spara alla". All photos are fetched first (share needs the tap), then: iPhone = share sheet
       ("Spara N bilder" → Bilder, 10 per tap), Android = downloads (Download/ → Galleriet), computer = one ZIP.
       Only what film_save_list returns (alive, author still in the group, nobody blocked either way, not hidden).
     - Deep link ?film=<gid>&cam=save (push hook for the 10:00 "Filmen är framkallad" push) → album, save card in focus.
     - pnlog: cam.film_set {film}, cam.save {count, method}. */
  var stocks = {}, wantSave = null, SAVED_KEY = "olnu.filmSaved";
  // ux2 review: "Filmen slut · 00" with 0 photos. The camera read d.left | 0 from an answer that had no counter (a test
  // mock answered [] ; an old or broken answer can do the same) → 0 → "out of film". A missing count is UNKNOWN, not 0
  // (DESIGN ds19): show the full roll (max − mine, else 10) and let the server say film_empty if it is really empty.
  function normState(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
    var num = function (v) { return typeof v === "number" && isFinite(v); };
    var max = num(d.max) && d.max > 0 ? d.max | 0 : 10, o = Object.assign({}, d, { max: max });
    if (!num(d.left)) { o.left = num(d.mine) ? Math.max(0, max - (d.mine | 0)) : max; o.unknown = true; }
    if (!num(d.group_max) || d.group_max <= 0) o.group_max = 60;
    if (!num(d.group_n)) o.group_n = 0;
    if (!Array.isArray(d.rolls)) o.rolls = [];
    return o;
  }
  function FX() { return window.FILMFX || null; }
  function filmName(id) { var F = FX(); return F ? F.name(id || F.DEFAULT) : "PintsNow 400"; }
  function plog(n, p) { try { if (window.PNLOG) window.PNLOG.event(n, p || {}); } catch (e) {} }
  function icon(n, cls) { var s = el("span", { class: "fm-ic " + (cls || ""), "aria-hidden": "true" }); try { if (window.PNI && window.PNI.has(n)) s.innerHTML = window.PNI.svg(n); } catch (e) {} return s; }
  var stockP = {};
  function stockOf(gid, force) {
    var c = stocks[gid];
    if (!force && c && Date.now() - c.at < 15000) return Promise.resolve(c.d);
    if (!force && stockP[gid]) return stockP[gid];
    return (stockP[gid] = call("film_stock", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data) || {}; stocks[gid] = { at: Date.now(), d: d };
      try { if (FX()) FX().setRoll(gid, d.film); } catch (e) {}
      return d;
    }).then(function (d) { stockP[gid] = null; return d; }, function () { stockP[gid] = null; return null; }));
  }
  function nightFilm(st, night) {
    var t = Date.parse(night), n = (st && st.nights) || [];
    for (var i = 0; i < n.length; i++) if (Date.parse(n[i].night) === t) return n[i].film;
    return null;
  }
  function filmRow(root, g, d, cam) {
    var F = FX(); if (!F) return;
    var box = el("section", { class: "fm-film", "aria-label": L("Film ikväll", "Tonight's film") });
    var nm = el("b", { class: "fm-film-n", text: filmName(F.rollOf(g.id)) });
    var sub = el("span", { class: "fm-film-s", text: L("Laddar…", "Loading…") });
    var btn = el("button", { type: "button", class: "btn btn-ghost btn-small fm-film-b", hidden: "" }, [document.createTextNode(L("Byt film", "Change film"))]);
    box.appendChild(el("div", { class: "fm-film-row" }, [icon("film", "fm-film-ic"), el("div", { class: "fm-film-t" }, [el("small", { text: L("Film ikväll", "Tonight's film") }), nm, sub]), btn]));
    var panel = el("div", { class: "fm-pick", hidden: "" });
    box.appendChild(panel);
    root.insertBefore(box, cam.nextSibling);
    var brand = cam.querySelector(".fm-brand");
    function paint(st) {
      var film = st && F.has(st.film) ? st.film : F.DEFAULT;
      F.setRoll(g.id, film);
      nm.textContent = filmName(film);
      if (brand) brand.textContent = "PintsNow · " + filmName(film);
      var locked = !st || !!st.locked || (d.group_n | 0) > 0;
      sub.textContent = !st ? F.line(film) : locked ? L("Låst. Gänget har börjat fota.", "Locked. The group has started.") : (st.film ? F.line(film) : L("Standard. Byt innan första bilden.", "Default. Change it before the first photo."));
      btn.hidden = locked || off.film_set_stock;
      box.classList.toggle("locked", locked); box.setAttribute("data-st", st ? "ok" : "wait");
      // Developed rolls in this sheet: add the film name.
      try {
        var rs = d.rolls || [], bs = root.querySelectorAll(".fm-roll-btn");
        rs.forEach(function (x, i) { var b = bs[i]; if (!b || b._fm) return; b._fm = 1; b.appendChild(el("span", { class: "fm-roll-f", text: " · " + filmName(nightFilm(st, x.night) || F.DEFAULT) })); });
      } catch (e) {}
    }
    btn.addEventListener("click", function () { if (panel.hidden) openPicker(); else panel.hidden = true; });
    function openPicker() {
      var st = (stocks[g.id] || {}).d || {}, cur = F.has(st.film) ? st.film : F.DEFAULT, sel = cur;
      panel.innerHTML = ""; panel.hidden = false;
      panel.appendChild(el("h3", { class: "fm-pick-h", text: L("Välj kvällens film", "Pick tonight's film") }));
      panel.appendChild(el("p", { class: "fm-pick-p", text: L("En film för hela gänget. Ingen ser resultatet förrän bilderna är framkallade.", "One film for the whole group. Nobody sees the result until the photos are developed.") }));
      var grid = el("div", { class: "fm-stocks", role: "radiogroup", "aria-label": L("Filmer", "Films") });
      var vid = root.querySelector(".fm-vf video"), src = null;
      try { if (vid && vid.videoWidth) { src = document.createElement("canvas"); var k = 320 / Math.max(vid.videoWidth, vid.videoHeight); src.width = Math.round(vid.videoWidth * k); src.height = Math.round(vid.videoHeight * k); src.getContext("2d").drawImage(vid, 0, 0, src.width, src.height); } } catch (e) { src = null; }
      if (!src) src = F.sample(320, 240, "kvall");
      var items = [];
      F.STOCKS.forEach(function (s, i) {
        var cv = null;
        try { cv = F.render(src, s.id, { max: 320, seed: 7 + i * 3, at: Date.now() }); cv.className = "fm-st-pv"; cv.setAttribute("aria-hidden", "true"); } catch (e) { cv = el("span", { class: "fm-st-pv" }); }
        var b = el("button", { type: "button", class: "fm-st", role: "radio", "data-film": s.id, "aria-checked": String(s.id === sel) }, [cv,
          el("span", { class: "fm-st-t" }, [el("b", { text: filmName(s.id) }), el("small", { text: F.line(s.id) })]), icon("check", "fm-st-ok")]);
        b.addEventListener("click", function () { sel = s.id; items.forEach(function (x) { x.setAttribute("aria-checked", String(x.getAttribute("data-film") === sel)); }); go.textContent = L("Ladda ", "Load ") + filmName(sel); });
        items.push(b); grid.appendChild(b);
      });
      panel.appendChild(grid);
      var go = el("button", { type: "button", class: "btn btn-amber btn-block fm-pick-go", text: L("Ladda ", "Load ") + filmName(sel) });
      var no = el("button", { type: "button", class: "btn btn-ghost btn-block fm-pick-no", text: L("Avbryt", "Cancel") });
      panel.appendChild(el("div", { class: "fm-pick-btns" }, [go, no]));
      no.addEventListener("click", function () { panel.hidden = true; });
      go.addEventListener("click", function () {
        if (go.disabled) return;
        if (sel === ((stocks[g.id] || {}).d || {}).film) { panel.hidden = true; return; }
        go.disabled = true;
        call("film_set_stock", { p_group_id: g.id, p_film: sel }).then(function (r) {
          go.disabled = false;
          if (r.error) {
            var c = codeOf(r.error), m = String((r.error && r.error.message) || "");
            if (/film_locked/.test(m)) A.toast(L("Någon hann ta första bilden. Filmen är låst för ikväll.", "Someone took the first photo. The film is locked."), { err: true, cls: "fm-own" });
            else A.toast(errText(c), { err: true, cls: "fm-own" });
            stockOf(g.id, true).then(paint); panel.hidden = true; return;
          }
          var x = A.parseData(r.data) || {};
          var st2 = Object.assign({}, (stocks[g.id] || {}).d || {}, { film: x.film || sel, locked: false });
          stocks[g.id] = { at: Date.now(), d: st2 };
          plog("cam.film_set", { film: st2.film });
          fx(15); panel.hidden = true; paint(st2);
          A.toast(L("Filmen är laddad: ", "Film loaded: ") + filmName(st2.film), { ms: 2600, cls: "fm-own" });
        });
      });
      try { panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}
    }
    paint(null);
    stockOf(g.id).then(function (st) { if (box.isConnected) paint(st); });   // openCam asked already (parallel to film_state)
  }

  // ---- Album: film name + save card ----
  function savedList() { return list(SAVED_KEY); }
  function rollFilm(root, g, d) {
    var F = FX(), sub = root.querySelector(".fm-dev-s");
    var line2 = el("div", { class: "fm-dev-f" }, [icon("film", "fm-dev-fi"), el("span", { class: "fm-dev-fn", text: filmName(F ? F.DEFAULT : "") })]);
    if (sub) sub.parentNode.insertBefore(line2, sub.nextSibling);
    return function (film) {
      var n = filmName(film || (F && F.DEFAULT));
      line2.lastChild.textContent = L("Film: ", "Film: ") + n;
      root.querySelectorAll(".fm-edge").forEach(function (e, i) { e.textContent = (i + 1) + "A ▸ " + n; });
    };
  }
  // Public: FILM.albumExtra(fn) → unregister(). fn(ctx) runs each time a developed album draws; ctx = { slot (a <div> near
  // the top of the album, under the save card), g {id, name}, night, evening, photos [{id, name, is_me, at, w, h}],
  // url(id) → Promise<blob URL>, blob(id) → Promise<Blob> }. A module that loads before film.js pushes fn into
  // window.FILM_EXTRAS (same effect). A failing fn never breaks the album.
  var extras = window.FILM_EXTRAS = window.FILM_EXTRAS || [];
  function albumExtra(fn) { if (typeof fn === "function" && extras.indexOf(fn) < 0) extras.push(fn); return function () { var i = extras.indexOf(fn); if (i >= 0) extras.splice(i, 1); }; }
  function runExtras(root, g, d) {
    if (!extras.length) return;
    var head = root.querySelector(".fm-dev-head"), slot = el("div", { class: "fm-extra" });
    root.insertBefore(slot, head ? head.nextSibling : root.firstChild);
    var ctx = { slot: slot, g: { id: g.id, name: g.name || "" }, night: d.night, evening: d.evening, photos: (d.photos || []).map(function (p) { return { id: p.id, name: p.name, is_me: !!p.is_me, at: p.at, w: p.w, h: p.h }; }),
      url: function (id) { return photoUrl(id); }, blob: function (id) { return photoBlob(id); } };
    extras.slice().forEach(function (fn) { try { fn(ctx); } catch (e) {} });
  }
  function saveCard(root, g, d) {
    try { runExtras(root, g, d); } catch (e) {}
    var setFilm = rollFilm(root, g, d), F = FX();
    var rep = list(REP_KEY), frames = root.querySelectorAll(".fm-frame");
    (d.photos || []).forEach(function (p, i) { meta[String(p.id)] = { p: p, fr: frames[i] || null, g: g }; if (rep.indexOf(String(p.id)) >= 0 && frames[i]) frames[i].hidden = true; });
    var photos = (d.photos || []).filter(function (p) { return rep.indexOf(String(p.id)) < 0; }); if (!photos.length || !F) return;
    var key = rollKey(g.id, d.night), done = has(SAVED_KEY, key);
    var card = el("section", { class: "fm-save" + (done ? " done" : ""), id: "fm-save", "aria-label": L("Spara bilderna", "Save the photos") });
    var t = el("p", { class: "fm-save-t", text: done ? L("Du har sparat bilderna från den här kvällen.", "You saved the photos from this night.") : L("Bilderna från igår är framkallade 📸 – vill du spara dem?", "Last night's photos are developed 📸 – do you want to save them?") });
    var main = el("button", { type: "button", class: "btn btn-block fm-save-all " + (done ? "btn-ghost" : "btn-amber"), disabled: "" }, [icon("download"), el("span", { class: "fm-save-l", text: L("Förbereder bilderna…", "Getting the photos ready…") })]);
    var alt = el("button", { type: "button", class: "btn btn-ghost btn-block fm-save-alt", hidden: "" });
    var hint = el("p", { class: "fm-save-s", text: "" });
    card.appendChild(t); card.appendChild(main); card.appendChild(alt); card.appendChild(hint);
    var head = root.querySelector(".fm-dev-head");
    root.insertBefore(card, head ? head.nextSibling : root.firstChild);
    var files = [], rest = null, evening = d.evening, gname = g.name || "";
    function lbl(s) { main.lastChild.textContent = s; }
    function method() { return F.saveMethod(files.slice(0, 2).map(function (f) { return new File([f.blob], f.name, { type: "image/jpeg" }); })); }
    function ready() {
      if (!files.length) { lbl(L("Inga bilder att spara", "No photos to save")); main.disabled = true; return; }
      var m = method(), n = rest ? rest.length : files.length;
      main.disabled = false;
      if (rest && rest.length) lbl(L("Spara nästa " + Math.min(F.SHARE_MAX, n) + " (" + (files.length - n + 1) + "–" + Math.min(files.length, files.length - n + F.SHARE_MAX) + ")", "Save the next " + Math.min(F.SHARE_MAX, n)));
      else lbl((done ? L("Spara igen", "Save again") : L("Spara alla", "Save all")) + " (" + files.length + ")");
      hint.textContent = m === "share" ? L("Välj ”Spara " + Math.min(F.SHARE_MAX, n) + " bilder” så hamnar de i Bilder." + (n > F.SHARE_MAX ? " Max " + F.SHARE_MAX + " åt gången." : ""), "Pick “Save images” to put them in Photos.")
        : m === "files" ? L("Bilderna laddas ner. De syns i Galleriet (mappen Download).", "The photos download. They show in your Gallery (Download folder).")
        : L("Laddas ner som en ZIP-fil.", "Downloads as one ZIP file.");
      var canAlt = F.canShareFiles(files.slice(0, 1).map(function (f) { return new File([f.blob], f.name, { type: "image/jpeg" }); }));
      alt.hidden = !(m === "files" && canAlt);
      alt.innerHTML = ""; alt.appendChild(icon("share")); alt.appendChild(el("span", { text: L("Dela till en app istället", "Share to an app instead") }));
    }
    function run(m) {
      var list2 = rest && rest.length ? rest : files;
      main.disabled = true;
      F.save(list2, m, "PintsNow_" + String(evening || "").slice(0, 10) + ".zip").then(function (r) {
        main.disabled = false;
        if (r.method === "cancel") { ready(); return; }
        plog("cam.save", { count: r.n, method: r.method });
        rest = r.rest && r.rest.length ? r.rest : null;
        if (!rest) { once(SAVED_KEY, key); done = true; card.classList.add("done"); main.classList.remove("btn-amber"); main.classList.add("btn-ghost");
          t.textContent = L("Klart! " + files.length + " bilder sparade.", "Done! " + files.length + " photos saved."); fx(20); }
        ready();
      }, function (e) {
        main.disabled = false;
        plog("cam.save", { count: 0, method: "fail", err: String((e && e.name) || "error").slice(0, 24) });
        A.toast(L("Det gick int' att spara. Prova igen – eller spara en bild i taget.", "Could not save. Try again, or save one photo at a time."), { err: true, ms: 6000 });
        ready();
      });
    }
    main.addEventListener("click", function () { if (!main.disabled) run(rest && rest.length ? "share" : method()); });
    alt.addEventListener("click", function () { run("share"); });
    // Which photos may be saved (server: alive, still a member, not blocked, not hidden), then fetch them all.
    call("film_save_list", { p_group_id: g.id, p_night: d.night }).then(function (r) {
      var x = r && !r.error ? (A.parseData(r.data) || {}) : null;
      if (x) { setFilm(x.film); evening = x.evening || evening; gname = x.group_name || gname; }
      else { stockOf(g.id).then(function (st) { setFilm(nightFilm(st, d.night)); }); }
      var ok = {}; ((x && x.photos) || photos).forEach(function (p) { ok[String(p.id)] = 1; });
      var todo = photos.filter(function (p) { return ok[String(p.id)]; }), got = 0, slots = [];
      if (!todo.length) { ready(); return; }
      var q = todo.slice(), live = 0;
      function next() {
        while (live < 3 && q.length) {
          (function (p, i) {
            live++;
            photoBlob(p.id).then(function (b) {   // bytes are EXIF-stripped in photoUrl (FILMFX.stripJpeg)
              var nm = F.fileName(evening, gname, i + 1);
              slots[i] = { name: nm, blob: b, id: p.id }; names[String(p.id)] = nm;
            }, function () {}).then(function () {
              live--; got++;
              if (got < todo.length) { lbl(L("Förbereder bilderna… ", "Getting the photos ready… ") + got + "/" + todo.length); next(); }
              else { files = slots.filter(Boolean); ready(); }
            });
          })(q.shift(), todo.length - q.length - 1);
        }
      }
      next();
    });
    if (wantSave === g.id) {
      wantSave = null;
      setTimeout(function () { try { card.scrollIntoView({ block: "start", behavior: "smooth" }); card.classList.add("focus"); } catch (e) {} }, 300);
    }
  }
  var names = {}, meta = {}, REP_KEY = "olnu.filmRep";
  // Viewer: "Ta bort" (my own photo, for everyone) or "Anmäl" (someone else's: hidden for me at once, for all at 2 reports).
  function viewerActions(bar, id, closeV) {
    var m = meta[String(id)]; if (!m) return;
    var mine = !!m.p.is_me;
    var b = el("button", { type: "button", class: "btn btn-ghost fm-v-act " + (mine ? "fm-v-rm" : "fm-v-rep"), "aria-label": mine ? L("Ta bort bilden", "Remove the photo") : L("Anmäl bilden", "Report the photo") }, [icon(mine ? "trash" : "flag")]);
    bar.insertBefore(b, bar.firstChild);
    b.addEventListener("click", function () { mine ? askRemove(id, closeV) : askReport(id, closeV); });
  }
  function miniSheet(title, text, rows) {
    var ov = el("div", { class: "fc-rules fm-mini" }), card = el("div", { class: "fc-r-card", role: "dialog", "aria-modal": "true", "aria-label": title });
    card.appendChild(el("h2", { class: "fc-r-t", text: title }));
    if (text) card.appendChild(el("p", { class: "fm-mini-p", text: text }));
    var btns = el("div", { class: "fc-r-btns" });
    rows.forEach(function (r) { var x = el("button", { type: "button", class: "btn btn-block " + (r.cls || "btn-ghost"), text: r.label }); x.addEventListener("click", function () { ov.remove(); if (r.fn) r.fn(); }); btns.appendChild(x); });
    card.appendChild(btns); ov.appendChild(card);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }
  function gone(id, closeV) {
    var m = meta[String(id)]; if (m && m.fr) m.fr.hidden = true;
    try { closeV(); } catch (e) {}
  }
  function askRemove(id, closeV) {
    miniSheet(L("Ta bort bilden?", "Remove the photo?"), L("Den försvinner för hela gänget. Det går int' att ångra.", "It goes for the whole group. You cannot undo this."), [
      { label: L("Ta bort för alla", "Remove for everyone"), cls: "btn-danger", fn: function () {
        call("film_remove", { p_photo_id: +id }).then(function (r) {
          if (r.error) { A.toast(errText(codeOf(r.error)), { err: true, cls: "fm-own" }); return; }
          plog("cam.remove", {}); gone(id, closeV); A.toast(L("Bilden är borttagen.", "The photo is removed."), { cls: "fm-own" });
        });
      } },
      { label: L("Avbryt", "Cancel") }]);
  }
  function askReport(id, closeV) {
    var send = function (why) {
      call("film_report", { p_photo_id: +id, p_reason: why }).then(function (r) {
        if (r.error) { A.toast(errText(codeOf(r.error)), { err: true, cls: "fm-own" }); return; }
        once(REP_KEY, String(id)); plog("cam.report", { reason: why });
        gone(id, closeV); A.toast(L("Tack. Bilden är dold för dig. Vi tittar på den.", "Thanks. The photo is hidden for you."), { cls: "fm-own", ms: 5000 });
      });
    };
    miniSheet(L("Anmäl bilden", "Report the photo"), L("Vad är fel? Den du anmäler får int' veta att det var du.", "What is wrong? The person does not learn it was you."), [
      { label: L("Naket eller sexuellt", "Nude or sexual"), fn: function () { send("sex"); } },
      { label: L("Hot eller kränkning", "Threat or abuse"), fn: function () { send("hot"); } },
      { label: L("Någon under 18", "Someone under 18"), fn: function () { send("minor"); } },
      { label: L("Personen vill int' vara med", "The person does not want to be in it"), fn: function () { send("annat"); } },
      { label: L("Avbryt", "Cancel") }]);
  }
  function photoBlob(id) { id = String(id); return blobs[id] ? Promise.resolve(blobs[id]) : photoUrl(id).then(function () { return blobs[id]; }); }
  // Viewer: one photo. iPhone: the share sheet ("Spara bild" → Bilder). Else a download with the PintsNow name.
  function viewerSave(save, id, closeV) {
    try { if (save.parentNode) viewerActions(save.parentNode, id, closeV); } catch (e) {}
    save.download = names[String(id)] || ("PintsNow_" + id + ".jpg");
    save.addEventListener("click", function (e) {
      var F = FX(), b = blobs[String(id)]; if (!F || !b) return;
      e.preventDefault();
      // No await before share(): iOS needs the tap. The bytes were stripped when the photo loaded.
      var f = { name: save.download, blob: b }, m = F.saveMethod([new File([b], f.name, { type: "image/jpeg" })]);
      F.save([f], m === "zip" ? "files" : m).then(function (r) { if (r && r.method !== "cancel") plog("cam.save", { count: 1, method: r.method === "files" ? "single" : r.method }); }, function () {
        A.toast(L("Det gick int' att spara bilden.", "Could not save the photo."), { err: true });
      });
    });
  }
  /* cm FILMRULLAR END */
  /* ---------- Morgontidningen helper (gang.js) ---------- */
  function addToStory(gid, evening, st) {
    if (!st || !A || off.film_story) return Promise.resolve(st);
    return call("film_story", { p_group_id: gid, p_night: evening || null }).then(function (r) {
      if (r.error) return st;
      var d = A.parseData(r.data) || {};
      st.camera_photos = Array.isArray(d.camera_photos) ? d.camera_photos : [];
      st.film = { n: d.n | 0, developed: !!d.developed, develop_at: d.develop_at, skal_n: d.skal_n | 0 };
      return st;
    }, function () { return st; });
  }

  /* ---------- Deep link ?film=<group id> ---------- */
  var linkCam = "";
  function openFilmLink(gid, cam) {
    if (!/^[0-9a-f-]{36}$/i.test(String(gid || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      if (cam === "save") wantSave = gid;   // cm: ?film=<gid>&cam=save (10:00 push) → album + save card
      if (cam === "1") { load(true).then(function () { var pg = groupOf(gid); openCam({ id: gid, name: pg ? gName(pg) : "" }); }); return; }   // 0195 filmstart push
      load(true).then(function () {
        var fr = ((P && P.rolls) || []).filter(function (x) { return x.group_id === gid; })[0];
        openRoll({ id: gid, name: fr ? fr.group_name : "" }, fr ? fr.night : null);
      });
    })();
  }
  function linkFromUrl() {
    if (linkDone) return null;
    var id = null;
    try { id = new URLSearchParams(location.search).get("film"); linkCam = new URLSearchParams(location.search).get("cam") || ""; } catch (e) {}
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    linkDone = true;
    try { var ps = new URLSearchParams(location.search); ps.delete("film"); ps.delete("cam"); history.replaceState(null, "", location.pathname + (ps.toString() ? "?" + ps : "") + location.hash); } catch (e) {}
    return id;
  }

  /* ---------- 0195 📸 "Gänget fotar ikväll": ONE HUD chip + the film_start push ---------- */
  var START_KEY = "olnu.filmStartPushed";
  function nightOver() { if (!P || !P.night) return false; var e = Date.parse(P.night); return isFinite(e) && Date.now() + skew >= e; }
  function liveGroups() {
    if (state !== "on" || !P || nightOver()) return [];
    return (P.groups || []).filter(function (x) { return (x.group_n | 0) > 0 && (x.left | 0) > 0 && (x.group_n | 0) < 60; })
      .sort(function (a, b) { return (Date.parse(b.first_at) || 0) - (Date.parse(a.first_at) || 0); });
  }
  function gName(x) { return (x && x.group_name) || L("Gänget", "The gang"); }
  function chipHTML() {
    var lg = liveGroups(); if (!lg.length) return "";
    var esc = U.esc, x = lg[0], one = lg.length === 1;
    var txt = one ? L("Gänget fotar", "The gang shoots") : L(lg.length + " gäng fotar", lg.length + " groups shoot");   // short: the one chip slot is narrow
    var aria = L("Engångskameran: ", "Disposable camera: ") + (one ? L(gName(x) + " fotar ikväll", gName(x) + " is shooting tonight") : L(lg.length + " gäng fotar ikväll", lg.length + " groups are shooting tonight")) + (one ? L(". Du har " + (x.left | 0) + " bilder kvar. Tryck för att fota.", ". You have " + (x.left | 0) + " shots left. Tap to shoot.")
      : L(". Tryck för att välja grupp.", ". Tap to pick a group."));
    return '<button type="button" class="hx-chip fm-chip" data-hx="film" aria-label="' + esc(aria) + '"><span aria-hidden="true">📸</span><span class="fm-cn" aria-hidden="true">' +
      esc(txt) + "</span>" + (one ? '<b class="fm-ck" aria-hidden="true">' + (x.left | 0) + "</b>" : "") + "</button>";
  }
  function chipTap() {
    var lg = liveGroups(); if (!lg.length) return;
    if (lg.length === 1) { openCam({ id: lg[0].group_id, name: gName(lg[0]) }); return; }
    A.openSheet(L("📸 Vem fotar ikväll?", "📸 Who is shooting tonight?"), function (body) {
      lg.forEach(function (x) {
        body.appendChild(A.btn("📸 " + gName(x) + " · " + (x.group_n | 0) + L(" bilder · ", " shots · ") + (x.left | 0) + L(" kvar för dig", " left for you"),
          "btn-block fm-pick", function () { openCam({ id: x.group_id, name: gName(x) }); }));
      });
    });
  }
  function hud() { try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {} }
  // My first shot tonight in a group → notify-group tells the others. The server sends only when I really was first
  // (film_starts.started_by), once per group per night; this phone asks once per group per night.
  function startPush(gid, x) {
    if (!A || !A.PUSH_ON || !gid || !x || (x.mine | 0) !== 1 || (x.group_n | 0) > 3) return;
    var k = gid + "@" + String(Date.parse(x.night || (P && P.night) || "") || new Date().toDateString());
    if (once(START_KEY, k)) return;
    A.invoke("notify-group", { event: "film_start", group_id: gid });
  }
  function shotDone(gid, x) {
    var pg = groupOf(gid);
    if (pg && x && x.night && P && P.night && x.night !== P.night && Date.parse(x.night) !== Date.parse(P.night)) pg = null;
    if (pg && (pg.group_n | 0) <= 1 && !pg.first_at) { pg.first_at = new Date().toISOString(); pg.first_me = true; }
    startPush(gid, x); hud();
  }

  window.FILM = {
    state: function () { return state; },
    data: function () { return P; },
    _shot: function (gid, x) {
      x = x || {}; var c = stCache[gid], pg = groupOf(gid);
      if (pg) { pg.left = x.left | 0; pg.group_n = x.group_n | 0; }
      if (c && c.d) { c.d = Object.assign({}, c.d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 }); c.at = Date.now(); }
      shotDone(gid, x);   // 0195
      if (camRoot && camRoot.g.id === gid && document.body.contains(camRoot.root)) drawCam(camRoot.root, camRoot.g, Object.assign({}, camRoot.d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 }));
    },
    openCam: openCam, openRoll: openRoll, albumExtra: albumExtra,   // cm: albumExtra (Kvällsrepris tile)
    openFilmLink: openFilmLink, addToStory: addToStory, _url: photoUrl, _texts: T,
    init: function (api) {
      A = api;
      try { if (window.FILMCAM) window.FILMCAM.init(api); } catch (e) {}
      /* ⚡ SPEED: no own resume poll (app.js polls once after the session refresh; onPoll does the rest) */
    },
    onAuthed: function () {
      load(true); var id = linkFromUrl(); if (id) { openFilmLink(id, linkCam); return; }
      if (window.FILMCAM && window.FILMCAM.onAuthed) { try { window.FILMCAM.onAuthed(); } catch (e) {} return; }
      var p = null; try { p = JSON.parse(localStorage.getItem("olnu.fmPick") || "null"); localStorage.removeItem("olnu.fmPick"); } catch (e) {}
      if (p && p.g && Date.now() - (p.t || 0) < 5 * 60e3) { setTimeout(function () { openCam({ id: String(p.g), name: String(p.n || "") }); }, 800); setTimeout(function () { A.toast(L('📷 Telefonen startade om appen medan kameran var öppen. Försök igen – eller ta bilden först och välj den sen.', '📷 The phone restarted the app while the camera was open. Try again – or take the photo first and pick it after.'), { ms: 8000, urgent: true }); }, 1500); }
    },
    onReadyShow: function () { var id = linkFromUrl(); if (id) { openFilmLink(id, linkCam); return "film"; } return ""; },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (a) { if (a === "film") chipTap(); },
    onPoll: function () { load(false); },
    applyText: function () { render(); },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
