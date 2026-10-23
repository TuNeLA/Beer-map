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
      render();
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
      if (fr) sub.textContent = L("🎞️ Ny film! " + fr.n + " bilder", "🎞️ New roll! " + fr.n);
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
      var d = A.parseData(r.data); stCache[gid] = { at: Date.now(), d: d };
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
      el("div", { class: "fm-top" }, [el("span", { class: "fm-brand", text: "ÖL NU · ENGÅNGS 27" }), el("span", { class: "fm-flash", text: "⚡" })]),
      vf,
      el("div", { class: "fm-bottom" }, [lcd, el("div", { class: "fm-count" }, [
        el("b", { class: "fm-left", text: left > 0 ? left + L(" bilder kvar", " shots left") : L("Filmen ä slut", "Out of film") }),
        frames]), shutter])
    ]);
    root.appendChild(cam);
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
    var strip = el("div", { class: "fm-strip" });
    photos.forEach(function (p, i) {
      var fr = el("div", { class: "fm-shot loading", style: "aspect-ratio:" + Math.max(1, p.w | 0) + "/" + Math.max(1, p.h | 0) }, [el("span", { class: "fm-spin", text: "🎞️" })]);
      var frame = el("figure", { class: "fm-frame" }, [
        el("div", { class: "fm-edge", text: (i + 1) + "A ▸ ÖL NU 400" }),
        fr,
        el("figcaption", { class: "fm-cap" }, [el("b", { text: p.is_me ? L("Du", "You") : p.name }), el("small", { text: hm(p.at) })]),
        reactBar(p)
      ]);
      fr.addEventListener("click", function () { viewer(p.id); });
      strip.appendChild(frame);
      lazy(fr, p.id);
    });
    root.appendChild(strip);
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
  var urls = {}, loading = {};
  function photoUrl(id) {
    id = String(id);
    if (urls[id]) return Promise.resolve(urls[id]);
    if (loading[id]) return loading[id];
    loading[id] = call("film_photo", { p_photo_id: +id }).then(function (r) {
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
    photoUrl(id).then(function (u) { img.src = u; save.href = u; }, function () { close(); A.toast(errText("photo_not_found"), { err: true }); });
    document.body.appendChild(o);
  }

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
  function openFilmLink(gid) {
    if (!/^[0-9a-f-]{36}$/i.test(String(gid || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load(true).then(function () {
        var fr = ((P && P.rolls) || []).filter(function (x) { return x.group_id === gid; })[0];
        openRoll({ id: gid, name: fr ? fr.group_name : "" }, fr ? fr.night : null);
      });
    })();
  }
  function linkFromUrl() {
    if (linkDone) return null;
    var id = null;
    try { id = new URLSearchParams(location.search).get("film"); } catch (e) {}
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    linkDone = true;
    try { var ps = new URLSearchParams(location.search); ps.delete("film"); history.replaceState(null, "", location.pathname + (ps.toString() ? "?" + ps : "") + location.hash); } catch (e) {}
    return id;
  }

  window.FILM = {
    state: function () { return state; },
    data: function () { return P; },
    _shot: function (gid, x) {
      x = x || {}; var c = stCache[gid], pg = groupOf(gid);
      if (pg) { pg.left = x.left | 0; pg.group_n = x.group_n | 0; }
      if (c && c.d) { c.d = Object.assign({}, c.d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 }); c.at = Date.now(); }
      if (camRoot && camRoot.g.id === gid && document.body.contains(camRoot.root)) drawCam(camRoot.root, camRoot.g, Object.assign({}, camRoot.d, { left: x.left | 0, mine: x.mine | 0, group_n: x.group_n | 0 }));
    },
    openCam: openCam, openRoll: openRoll, openFilmLink: openFilmLink, addToStory: addToStory, _url: photoUrl, _texts: T,
    init: function (api) {
      A = api;
      try { if (window.FILMCAM) window.FILMCAM.init(api); } catch (e) {}
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
    },
    onAuthed: function () {
      load(true); var id = linkFromUrl(); if (id) { openFilmLink(id); return; }
      if (window.FILMCAM && window.FILMCAM.onAuthed) { try { window.FILMCAM.onAuthed(); } catch (e) {} return; }
      var p = null; try { p = JSON.parse(localStorage.getItem("olnu.fmPick") || "null"); localStorage.removeItem("olnu.fmPick"); } catch (e) {}
      if (p && p.g && Date.now() - (p.t || 0) < 5 * 60e3) { setTimeout(function () { openCam({ id: String(p.g), name: String(p.n || "") }); }, 800); setTimeout(function () { A.toast(L('📷 Telefonen startade om appen medan kameran var öppen. Försök igen – eller ta bilden först och välj den sen.', '📷 The phone restarted the app while the camera was open. Try again – or take the photo first and pick it after.'), { ms: 8000, urgent: true }); }, 1500); }
    },
    onReadyShow: function () { var id = linkFromUrl(); if (id) { openFilmLink(id); return "film"; } return ""; },
    onPoll: function () { load(false); },
    applyText: function () { render(); },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
