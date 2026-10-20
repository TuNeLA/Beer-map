/* Öl Nu v21 BILDER: photos in the group chat. window.PHOTO.
   - 📷 button next to the chat input → pick or take a photo → preview with caption → "Skicka" / "Avbryt".
   - The phone makes the file small: max 1024 px long side, JPEG, about 120 KB, no EXIF (canvas re-encode),
     orientation from EXIF (createImageBitmap imageOrientation:'from-image').
   - Server: migration 0028_chat_photos.sql. post_photo() also adds a normal chat row "📷 <caption>", so the
     photo sits in order in the chat and old apps see only that text. group_photos() = list (no bytes),
     group_photo(id) = the bytes as base64. Missing RPC (old database) = no 📷 button, no error.
   - Chat rows are drawn by social.js. This file finds the "📷" rows and puts the image in them
     (by data-mid when social.js sets it, else by created_at). Images load only when scrolled into view,
     and stay in memory + IndexedDB for the session.
   - Tap = full-screen viewer (pinch / double-tap zoom, 💾 Spara). Long-press / double-tap = the normal reactions.
   Hooks: init(api) and chatOpen(g, ctx) (same ctx as AFTER.chatOpen: {list, input, alive, color}). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, inited = false, off = {};
  var MAX_SIDE = 1024, TARGET = 120 * 1024, HARD_MAX = 158 * 1024, CAP_MAX = 138;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  var CODES = ["group_photo_limit", "photo_limit", "invalid_photo", "photo_not_found", "not_member", "invalid_msg", "slow_down"];
  function codeOf(e) {
    var m = String((e && (e.message || e.details || e.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return U && U.errCode ? U.errCode(e) : m;
  }
  function call(name, params) {
    if (!A || !A.LIVE || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; }
      return r;
    });
  }
  function el(tag, attrs, kids) {
    if (A && A.el) return A.el(tag, attrs, kids);
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function toast(msg, opts) { try { A.toast(msg, opts); } catch (e) {} }

  /* ---------- Texts ---------- */
  var SENT = [
    "📷 Bild skickad. Bevis säkrat, soldat.",
    "📷 Bilden ä ute. Truppen ser'n nu.",
    "📸 Klick! Det där glömmer ingen förrän kl 05.",
    "📷 Underrättelse skickad till plutonen.",
    "📷 Fotospaning klar. Rapport inlämnad.",
    "📸 Bilden flög iväg som en kapsyl.",
    "📷 Skickat! Nu ä det dokumenterat, int' bara snack.",
    "📷 Spaningsbild levererad. Bra jobbat, menig.",
    "📸 Bilden ä framme. Ingen kan säga att det int' hände.",
    "📷 Fotot ä hos gänget. Det försvinner kl 05, som allt annat.",
    "📷 Bildbevis i lådan. Snyggt, korpral.",
    "📸 Där satt'n! Plutonen tackar.",
    "📷 Skickat. Kameran ä varm, gänget ä glatt.",
    "📸 Bilden ä på väg genom skogen till gruppen.",
    "📷 Ögonvittne registrerat. Över och ut."
  ];
  var SENT_EN = ["📷 Photo sent. Evidence secured.", "📷 Photo is out. The squad can see it.", "📸 Click! The squad has it."];
  function errText(c) {
    if (c === "not_member") return L("Du ä int' med i gruppen längre.", "You're not in this group.");
    if (c === "invalid_photo") return L("Bilden gick int' att läsa. Ta en ny.", "Could not read the photo. Try another.");
    if (c === "invalid_msg") return L("Texten ä för lång (max " + CAP_MAX + " tecken).", "Caption too long (max " + CAP_MAX + ").");
    if (c === "slow_down") return L("Lugn i stormen. Vänta 15 sekunder mellan bilderna.", "Slow down. Wait 15 s between photos.");
    if (c === "photo_limit") return L("📷 Max 10 bilder per kväll. Spara lite till i morron!", "📷 Max 10 photos per night.");
    if (c === "group_photo_limit") return L("📷 Gruppen har skickat 60 bilder ikväll. Albumet ä fullt till kl 05.", "📷 The group sent 60 photos tonight. Full until 05:00.");
    return L("Bilden gick int' att skicka. Försök igen.", "Could not send the photo.");
  }

  /* ---------- Cache: memory + IndexedDB (this session only) ---------- */
  var urls = {}, blobs = {}, loading = {}, db = null, dbTried = false, SESSION = "s" + Date.now();
  function openDb() {
    if (dbTried) return Promise.resolve(db);
    dbTried = true;
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("olnu-photos", 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore("p"); } catch (e) {} };
        rq.onsuccess = function () {
          db = rq.result;
          // Photo bytes never change for an id: keep them across starts (saves egress), drop entries older than 7 days.
          try {
            var old = Date.now() - 7 * 86400e3, cur = db.transaction("p", "readwrite").objectStore("p").openCursor();
            cur.onsuccess = function () {
              var c = cur.result; if (!c) return;
              var v = c.value; if (!v || typeof v.s !== "number" || v.s < old) c.delete();
              c.continue();
            };
          } catch (e) {}
          res(db);
        };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function dbGet(id) {
    return openDb().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try { var r = d.transaction("p").objectStore("p").get(String(id)); r.onsuccess = function () { res(r.result && typeof r.result.s === "number" && r.result.b ? r.result.b : null); }; r.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    });
  }
  function dbPut(id, blob) {
    openDb().then(function (d) { if (!d) return; try { d.transaction("p", "readwrite").objectStore("p").put({ s: Date.now(), b: blob }, String(id)); } catch (e) {} });
  }
  function remember(id, blob) {
    id = String(id);
    blobs[id] = blob;
    if (!urls[id]) urls[id] = URL.createObjectURL(blob);
    dbPut(id, blob);
    return urls[id];
  }
  function b64Blob(b64, mime) {
    var bin = atob(String(b64 || "")), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || "image/jpeg" });
  }
  // Promise of an object URL for photo id (memory → IndexedDB → server).
  function photoUrl(id) {
    id = String(id);
    if (urls[id]) return Promise.resolve(urls[id]);
    if (loading[id]) return loading[id];
    loading[id] = dbGet(id).then(function (b) {
      if (b) { delete loading[id]; blobs[id] = b; return (urls[id] = URL.createObjectURL(b)); }
      return call("group_photo", { p_photo_id: +id }).then(function (r) {
        delete loading[id];
        if (r.error) throw new Error(codeOf(r.error) || "error");
        var d = A.parseData(r.data);
        return remember(id, b64Blob(d.b64, d.mime));
      });
    }, function () { delete loading[id]; throw new Error("error"); });
    return loading[id];
  }

  /* ---------- Make the file small ---------- */
  function decode(file) {
    // createImageBitmap applies the EXIF orientation; the canvas re-encode drops all EXIF (GPS, phone model ...).
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return imgDecode(file); });
    }
    return imgDecode(file);
  }
  function imgDecode(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { res(im); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); };
      im.src = u;
    });
  }
  function toBlob(canvas, q) {
    return new Promise(function (res) {
      if (canvas.toBlob) canvas.toBlob(function (b) { res(b); }, "image/jpeg", q);
      else { try { var d = canvas.toDataURL("image/jpeg", q); res(b64Blob(d.slice(d.indexOf(",") + 1), "image/jpeg")); } catch (e) { res(null); } }
    });
  }
  // Resize to max 1024 px, JPEG q 0.7; lower quality, then size, until ≤ 120 KB.
  function shrink(file) {
    return decode(file).then(function (src) {
      var sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
      if (!sw || !sh) throw new Error("decode");
      var side = Math.min(MAX_SIDE, Math.max(sw, sh)), q = 0.7, tries = 0;
      function round() {
        var k = side / Math.max(sw, sh), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var x = c.getContext("2d");
        x.fillStyle = "#000"; x.fillRect(0, 0, w, h);   // transparent PNG → black, not "garbage"
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
        x.drawImage(src, 0, 0, w, h);
        return toBlob(c, q).then(function (b) {
          c.width = c.height = 0;   // review: free this round's pixels now (up to 12 rounds)
          tries++;
          if (!b) throw new Error("encode");
          if (b.size <= TARGET || tries >= 12) {
            if (b.size > HARD_MAX) throw new Error("too_big");
            try { if (src.close) src.close(); } catch (e) {}
            return { blob: b, w: w, h: h, q: q };
          }
          if (q > 0.45) q = Math.round((q - 0.1) * 100) / 100;
          else { side = Math.round(side * 0.82); q = 0.6; }
          return round();
        });
      }
      return round().catch(function (e) { try { if (src.close) src.close(); } catch (x) {} throw e; });
    });
  }
  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------- Overlays (above the chat sheet; never replaces it) ---------- */
  var escFn = null;
  function overlay(cls) {
    var o = el("div", { class: "ph-ov " + cls, role: "dialog", "aria-modal": "true" });
    document.body.appendChild(o);
    return o;
  }
  function onEsc(fn) {
    if (escFn) window.removeEventListener("keydown", escFn, true);
    escFn = fn ? function (e) { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); fn(); } } : null;
    if (escFn) window.addEventListener("keydown", escFn, true);
  }

  // Preview: image + caption + privacy line + Skicka / Avbryt.
  function preview(g, file, ctx, done) {
    var o = overlay("ph-pick"), closed = false, shot = null, busy = false;
    var img = el("img", { class: "ph-prev", alt: L("Förhandsvisning", "Preview") });
    var wait = el("div", { class: "ph-wait", text: L("📷 Gör bilden liten…", "📷 Making it small…") });
    var cap = el("input", { class: "inp ph-cap", maxlength: String(CAP_MAX), placeholder: L("Text till bilden (valfritt)", "Caption (optional)"),
      "aria-label": L("Text till bilden", "Caption"), autocomplete: "off", enterkeyhint: "send" });
    var info = el("p", { class: "ph-info muted", text: "" });
    var priv = el("p", { class: "ph-priv", text: L("🔒 Bilden syns bara för gruppen och försvinner kl 05.", "🔒 Only the group sees the photo. It is gone at 05:00.") });
    var keeps = false;
    // 0029: a group that keeps its chat keeps photos too. Missing RPC = the 05:00 rule.
    call("group_keep_history", { p_group_id: g.id }).then(function (r) {
      if (r.error || closed || r.data !== true) return;
      keeps = true;
      priv.textContent = L("🔒 Bilden syns bara för gruppen. Gruppen sparar chatten, så bilden ligger kvar.", "🔒 Only the group sees the photo. This group keeps its chat, so the photo stays.");
    });
    var send = el("button", { type: "button", class: "btn btn-amber ph-send", text: L("📤 Skicka", "📤 Send") });
    var cancel = el("button", { type: "button", class: "btn ph-cancel", text: L("Avbryt", "Cancel") });
    send.disabled = true;
    o.appendChild(el("div", { class: "ph-card" }, [
      el("h3", { class: "ph-title", text: L("📷 Skicka bild", "📷 Send photo") }),
      el("div", { class: "ph-prev-box" }, [img, wait]),
      cap,
      priv,
      info,
      el("div", { class: "ph-row" }, [cancel, send])
    ]));
    function close() {
      if (closed) return; closed = true; onEsc(null);
      if (img.src) { try { URL.revokeObjectURL(img.src); } catch (e) {} }
      o.remove(); if (done) done();
    }
    onEsc(close);
    cancel.addEventListener("click", close);
    o.addEventListener("click", function (e) { if (e.target === o && !busy) close(); });
    cap.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    shrink(file).then(function (s) {
      if (closed) return;
      shot = s; img.src = URL.createObjectURL(s.blob); wait.remove(); send.disabled = false;
      info.textContent = s.w + "×" + s.h + " · " + Math.round(s.blob.size / 1024) + " KB";
    }, function () {
      if (closed) return;
      wait.textContent = L("Bilden gick int' att öppna. Prova en annan.", "Could not open the photo.");
    });
    function go() {
      if (!shot || busy) return;
      var text = String(cap.value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      if (text.length > CAP_MAX) { toast(errText("invalid_msg"), { err: true }); return; }
      busy = true; send.disabled = true; send.textContent = L("Skickar…", "Sending…");
      blobB64(shot.blob).then(function (b64) {
        return call("post_photo", { p_group_id: g.id, p_b64: b64, p_w: shot.w, p_h: shot.h, p_caption: text || null });
      }).then(function (r) {
        busy = false;
        if (r.error) {
          send.disabled = false; send.textContent = L("📤 Skicka", "📤 Send");
          if (r.off) { toast(errText(""), { err: true }); close(); if (ctx && ctx.btn) ctx.btn.remove(); return; }
          toast(errText(codeOf(r.error)), { err: true });
          return;
        }
        var d = A.parseData(r.data);
        remember(d.id, shot.blob);
        if (ctx && ctx.known) ctx.known({ id: d.id, msg_id: d.msg_id, w: shot.w, h: shot.h, created_at: d.created_at, is_me: true });
        var left = d.left | 0;
        toast((sv() ? pick(keeps ? SENT.filter(function (x) { return x.indexOf("05") < 0; }) : SENT) : pick(SENT_EN)) + (left <= 3 ? L(" (" + Math.max(0, left) + " kvar ikväll)", " (" + Math.max(0, left) + " left)") : ""), { cls: "skal" });
        try { window.FX && window.FX.vibrate && window.FX.vibrate(15); } catch (e) {}
        // Push: none from here yet (wanted: notify-group {event:"photo", photo_id}).
        close();
      }, function () {
        busy = false; send.disabled = false; send.textContent = L("📤 Skicka", "📤 Send");
        toast(errText(""), { err: true });
      });
    }
    send.addEventListener("click", go);
  }

  // Full-screen viewer with pinch / double-tap zoom and 💾 Spara.
  function viewer(id) {
    var o = overlay("ph-view"), closed = false;
    var img = el("img", { class: "ph-big", alt: L("Bild", "Photo"), draggable: "false" });
    var save = el("a", { class: "btn btn-amber ph-save", text: L("💾 Spara", "💾 Save"), download: "olnu-bild-" + id + ".jpg", href: "#" });
    var x = el("button", { type: "button", class: "btn ph-x", "aria-label": L("Stäng", "Close"), text: "✕" });
    var stage = el("div", { class: "ph-stage" }, [img]);
    o.appendChild(stage);
    o.appendChild(el("div", { class: "ph-bar" }, [save, x]));
    function close() { if (closed) return; closed = true; onEsc(null); o.remove(); }
    onEsc(close);
    x.addEventListener("click", close);
    photoUrl(id).then(function (u) {
      if (closed) return;
      img.src = u; save.href = u;
    }, function (e) {
      if (closed) return;
      stage.appendChild(el("p", { class: "ph-gone", text: String(e && e.message) === "photo_not_found" ? L("Bilden har gått ut (05:00).", "The photo expired.") : L("Kunde int' hämta bilden.", "Could not load the photo.") }));
    });
    save.addEventListener("click", function (e) {
      var b = blobs[String(id)];
      if (!b) { e.preventDefault(); return; }
      // iOS: the share sheet has "Spara bild". Elsewhere the download link does the job.
      try {
        var f = new File([b], "olnu-bild-" + id + ".jpg", { type: b.type || "image/jpeg" });
        if (/iP(hone|ad|od)/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [f] })) {
          e.preventDefault(); navigator.share({ files: [f] }).catch(function () {});
        }
      } catch (x2) {}
    });
    // Zoom: 2 fingers = pinch, 1 finger = pan when zoomed, double-tap = 1x / 2.5x. Tap on the dark area = close.
    var s = 1, tx = 0, ty = 0, pts = {}, start = null, lastTap = 0, moved = false;
    function apply() {
      if (s <= 1.01) { s = 1; tx = 0; ty = 0; }
      img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
    }
    function list() { return Object.keys(pts).map(function (k) { return pts[k]; }); }
    stage.addEventListener("pointerdown", function (e) {
      try { stage.setPointerCapture(e.pointerId); } catch (x3) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = false;
      var p = list();
      if (p.length === 2) start = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, s: s, tx: tx, ty: ty };
      else start = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, s: s };
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !start) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      if (p.length >= 2 && start.d) {
        s = Math.max(1, Math.min(5, start.s * (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / start.d))); moved = true; apply();
      } else if (p.length === 1 && start.x != null) {
        var dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (s > 1) { tx = start.tx + dx; ty = start.ty + dy; apply(); }
      }
    });
    function up(e) {
      var wasTarget = e.target;
      delete pts[e.pointerId];
      var p = list();
      if (p.length === 1) start = { x: p[0].x, y: p[0].y, tx: tx, ty: ty, s: s };
      else if (!p.length) {
        start = null;
        if (moved || e.type === "pointercancel") return;
        var now = Date.now();
        if (now - lastTap < 300) { s = s > 1 ? 1 : 2.5; apply(); lastTap = 0; return; }
        lastTap = now;
        if (wasTarget === stage && s === 1) setTimeout(function () { if (lastTap === now) close(); }, 310);
      }
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", function (e) { e.preventDefault(); s = Math.max(1, Math.min(5, s * (e.deltaY < 0 ? 1.15 : 0.87))); apply(); }, { passive: false });
  }

  /* ---------- Chat ---------- */
  function hasPhotoBody(li) {
    var b = li.querySelector(".cm-body");
    return !!(b && /^📷( |$)/.test(String(b.textContent || "")));
  }
  function chatOpen(g, ctx) {
    if (!A || !A.LIVE || off.group_photos || off.post_photo || !g || !g.id || !ctx || !ctx.list) return;
    var list = ctx.list;
    if (list._olnuPhoto) return;   // called once per chat (social.js line and the AFTER wrapper may both call)
    list._olnuPhoto = true;
    var byMsg = {}, byAt = [], lastId = 0, timer = null, busy = false, btn = null, input = null, io = null;
    var minId = 0, olderDone = false, olderBusy = false, PAGE = 100;   // older chat pages (groups that keep their chat)
    function alive() { return ctx.alive ? ctx.alive() : document.body.contains(list); }
    function known(p) {
      if (!p || !p.id) return;
      keep(p);
      scan();
    }
    function findFor(li) {
      var mid = li.getAttribute("data-mid") || li.getAttribute("data-id");
      if (mid && byMsg[mid]) return byMsg[mid];
      var at = Date.parse(li.getAttribute("data-at") || ""); if (!isFinite(at)) return null;
      var me = li.classList.contains("me"), best = null;
      byAt.forEach(function (p) {
        if (p.used) return;
        var d = Math.abs((Date.parse(p.created_at) || 0) - at);
        if (d <= 2 && !!p.is_me === me && (!best || d < best.d)) best = { p: p, d: d };
      });
      return best ? best.p : null;
    }
    function scan() {
      if (!alive()) return;
      var missed = 0;
      list.querySelectorAll(".chat-msg:not([data-ph]):not(.af-voice)").forEach(function (li) {
        if (!hasPhotoBody(li)) return;
        var p = findFor(li); if (!p) { missed++; return; }
        p.used = true; attach(li, p);
      });
      if (missed && !olderDone && minId > 1) older();
    }
    // A "📷" row we cannot match may be older than the photos we have: ask for the page before them.
    function older() {
      if (olderBusy) return;
      olderBusy = true;
      call("group_photos", { p_group_id: g.id, p_after_id: 0, p_before_id: minId }).then(function (r) {
        var rs = r.error ? [] : (Array.isArray(r.data) ? r.data : []);
        if (r.error || rs.length < PAGE) olderDone = true;
        rs.forEach(keep);
        setTimeout(function () { olderBusy = false; if (rs.length) scan(); }, 1500);
      });
    }
    function keep(p) {
      if (p.id > lastId) lastId = p.id;
      if (!minId || p.id < minId) minId = p.id;
      if (p.msg_id && byMsg[String(p.msg_id)]) return;
      if (p.msg_id) byMsg[String(p.msg_id)] = p;
      byAt.push(p);
    }
    function attach(li, p) {
      li.setAttribute("data-ph", String(p.id));
      li.classList.add("ph-msg");
      var body = li.querySelector(".cm-body");
      var capText = String(body.textContent || "").replace(/^📷 ?/, "");
      var ratio = p.w > 0 && p.h > 0 ? p.w / p.h : 4 / 3;
      // Box keeps its size before the image loads (no jump while scrolling). Max height 260 px.
      var hgt = Math.min(260, Math.round(220 / ratio)), wid = Math.round(hgt * ratio);
      if (wid > 240) { wid = 240; hgt = Math.round(240 / ratio); }
      var frame = el("div", { class: "ph-frame loading", "data-phid": String(p.id), role: "img", "aria-label": L("Bild", "Photo") + (capText ? ": " + capText : "") });
      frame.style.width = wid + "px"; frame.style.height = hgt + "px";
      frame.appendChild(el("span", { class: "ph-spin", "aria-hidden": "true", text: "📷" }));
      body.textContent = capText;
      if (!capText) body.classList.add("ph-nocap");
      body.parentNode.insertBefore(frame, body);
      if (io) io.observe(frame); else load(frame);
    }
    function load(frame) {
      var id = frame.getAttribute("data-phid");
      if (frame._started) return; frame._started = true;
      photoUrl(id).then(function (u) {
        var im = el("img", { class: "ph-img", alt: "", draggable: "false" });
        im.onload = function () { frame.classList.remove("loading"); var sp = frame.querySelector(".ph-spin"); if (sp) sp.remove(); };
        im.src = u;
        frame.appendChild(im);
      }, function (e) {
        frame.classList.remove("loading"); frame.classList.add("gone");
        var sp = frame.querySelector(".ph-spin");
        if (sp) sp.textContent = String(e && e.message) === "photo_not_found" ? L("📷 Bilden har gått ut", "📷 Photo expired") : L("📷 Kunde int' hämta", "📷 Could not load");
        if (String(e && e.message) !== "photo_not_found") setTimeout(function () { frame._started = false; }, 15000);
      });
    }
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (x) { if (x.isIntersecting) { io.unobserve(x.target); load(x.target); } });
      }, { root: list, rootMargin: "200px 0px" });
    }
    // Tap → viewer. Not after a long-press (reactions) and not on a double-tap (social.js opens the picker).
    var downAt = 0, downXY = null, tapT = null;
    list.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest(".ph-frame")) { downAt = Date.now(); downXY = { x: e.clientX, y: e.clientY }; }
    }, true);
    list.addEventListener("click", function (e) {
      var f = e.target.closest && e.target.closest(".ph-frame");
      if (!f || f.classList.contains("gone")) return;
      if (Date.now() - downAt > 420) return;
      if (downXY && Math.abs(e.clientX - downXY.x) + Math.abs(e.clientY - downXY.y) > 12) return;
      if (list.querySelector(".cm-picker")) return;
      var id = f.getAttribute("data-phid");
      clearTimeout(tapT);
      tapT = setTimeout(function () { if (!list.querySelector(".cm-picker")) viewer(id); }, 280);
    });
    list.addEventListener("dblclick", function () { clearTimeout(tapT); });
    // social.js adds rows on its own poll: watch the list and put the image in new "📷" rows.
    try { new MutationObserver(function () { scan(); }).observe(list, { childList: true }); } catch (e) {}
    function poll() {
      if (!alive()) { clearInterval(timer); if (io) io.disconnect(); return; }
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      call("group_photos", { p_group_id: g.id, p_after_id: lastId }).then(function (r) {
        busy = false;
        if (r.error) {
          if (r.off) { clearInterval(timer); if (btn) btn.remove(); }
          return;
        }
        var rs = Array.isArray(r.data) ? r.data : [];
        if (!lastId && rs.length < PAGE) olderDone = true;   // first page holds everything
        rs.forEach(keep);
        if (!btn) addButton();
        scan();
      });
    }
    function addButton() {
      if (btn || !ctx.input || off.post_photo) return;
      btn = el("button", { type: "button", class: "ph-btn", title: L("Skicka bild", "Send photo"), "aria-label": L("Skicka bild", "Send photo"), text: "📷" });
      input = el("input", { type: "file", accept: "image/*", class: "ph-file", tabindex: "-1", "aria-hidden": "true" });
      // Android can close the page while the camera/gallery is open (low memory). Remember the chat,
      // so the app opens it again after the restart and tells what happened (onAuthed below).
      btn.addEventListener("click", function () {
        try { localStorage.setItem("olnu.phPick", JSON.stringify({ g: g.id, t: Date.now() })); } catch (e) {}
        input.value = ""; input.click();
      });
      input.addEventListener("change", function () {
        try { localStorage.removeItem("olnu.phPick"); } catch (e) {}
        var f = input.files && input.files[0];
        if (!f) return;
        if (f.type && !/^image\//.test(f.type)) { toast(errText("invalid_photo"), { err: true }); return; }
        btn.disabled = true;
        preview(g, f, { known: known, btn: btn }, function () { btn.disabled = false; });
      });
      // Before the send button (and next to 🎙️ when it is there).
      ctx.input.insertBefore(btn, ctx.input.lastChild);
      ctx.input.appendChild(input);
    }
    // The first list call also checks the server: a missing RPC = no 📷 button at all.
    // review2: quiet chat (social.js window.OLNU_CHAT_AT older than 60 s) -> every 18 s.
    var qTick = 0;
    timer = setInterval(function () { qTick++; if (Date.now() - (window.OLNU_CHAT_AT || 0) < 60000 || qTick % 3 === 0) poll(); }, 6000);
    setTimeout(poll, 200);
    ctx.btnFor = function () { return btn; };
  }

  /* ---------- Public ---------- */
  function init(api) {
    if (inited) return;
    inited = true; A = api;
  }
  // The page was restarted while the photo picker was open: open the chat again and explain.
  function onAuthed() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem("olnu.phPick") || "null"); localStorage.removeItem("olnu.phPick"); } catch (e) {}
    if (!p || !p.g || Date.now() - (p.t || 0) > 5 * 60e3) return;
    setTimeout(function () {
      try { if (window.SOCIAL && window.SOCIAL.openChatLink) window.SOCIAL.openChatLink(p.g); } catch (e) {}
      toast(L("📷 Telefonen startade om appen medan kameran var öppen. Ta bilden först, välj den sen från Galleriet med 📷.",
        "📷 The phone restarted the app while the camera was open. Take the photo first, then pick it from the Gallery with 📷."), { ms: 9000, urgent: true });
    }, 1200);
  }
  window.PHOTO = { init: init, onAuthed: onAuthed, chatOpen: chatOpen, _shrink: shrink, _viewer: viewer, _url: photoUrl, _remember: remember };   // _url/_remember: chief.js

  // Until app.js lists window.PHOTO in mods() and social.js calls PHOTO.chatOpen, ride along with the
  // existing AFTER hooks (after.js loads before this file). Both paths are safe together (guards above).
  try {
    var AF = window.AFTER;
    if (AF && !AF._olnuPhoto) {
      AF._olnuPhoto = true;
      var oInit = AF.init, oChat = AF.chatOpen;
      if (typeof oInit === "function") AF.init = function (api) { try { init(api); } catch (e) {} return oInit.apply(this, arguments); };
      if (typeof oChat === "function") AF.chatOpen = function (g, ctx) {
        var r = oChat.apply(this, arguments);
        try { chatOpen(g, ctx); } catch (e) {}
        return r;
      };
    }
  } catch (e) {}
})();
