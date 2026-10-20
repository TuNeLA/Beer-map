/* Öl Nu v22 — GRUPPCHEF + LÄGESRAPPORT (CONTRACT "v22 GRUPPCHEF", migration 0030_chief_status.sql).
   - Every group has one 🎖️ gruppchef (default: the creator). The creator or the chief can hand the role on.
   - The chief taps "📸 Begär lägesrapport": request_status() + notify-group {event:"status_req", req_id}.
     Every member gets a push (tap → ?status=<id>) and, in the app, a banner + urgent HUD chip with a 10:00 countdown:
     "Lägesrapport! Ta ett foto på vad som händer – 10 min".
   - Members answer with a photo (photo.js pipeline: ≤ 1024 px JPEG ≈ 120 KB, no EXIF) → answer_status(): the photo
     lands in the group chat as "📷 🎖️ Lägesrapport[: text]" and in the report.
   - After 10 min (or when all have answered) the group sees the report card: photo grid, who was in time, who was
     late, who is "saknas i strid", first in / last in. No penalty for a missed report – only a fun line.
   - Limits (server): 1 request per 20 min per group, 6 per night. Answers taken until 60 min after the start.
   Hooks (app.js mods): init, onAuthed, onPoll, applyText, groupItem, hudChipsHTML, hudClick, onReadyShow,
   openStatusLink(id) (routeOpen ?status=<id>). Missing RPCs (old database) → everything hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = {}, state = "unknown";      // "unknown" | "on" | "missing"
  var reqs = [], skew = 0, pollAt = 0, busy = false, tick = null, linkDone = false;
  var chiefCache = {};                              // group id → {at, d}
  var HIDE_KEY = "olnu.chiefHidden", SEEN_KEY = "olnu.chiefSeen";
  var CODES = ["not_member", "not_chief", "not_allowed", "invalid_member", "status_slow", "status_limit", "status_not_found",
    "status_closed", "status_answered", "invalid_photo", "invalid_msg", "cannot_remove_creator", "cannot_remove_self",
    "slow_down", "not_authenticated"];

  /* ---------- Texts (dalmål, ä for é) ---------- */
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    if (!a || !a.length) return "";
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function spick(seed, a) { return a && a.length ? a[hash(seed) % a.length] : ""; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  var T = {
    banner: ["Lägesrapport! Ta ett foto på vad som händer", "Gruppchefen vill se läget. Fota nu", "Spaningsorder: en bild på läget",
      "Radion sprakar: lägesbild, över", "Uppställning! Bildbevis på läget", "Högkvarteret väntar på din bild",
      "Fotospaning beordrad. Klicka av läget", "Lägesrapport begärd. Visa vad som händer", "Kameran fram, soldat. Läget, tack",
      "Order från chefen: fota där du ä"],
    bannerEn: ["Status report! Take a photo of what is happening", "The chief wants to see the scene. Snap it", "Recon order: one photo of the scene"],
    chiefWait: ["📋 Rapporterna droppar in: {n}/{m}", "📋 Truppen rapporterar: {n}/{m}", "📋 Inkommet hittills: {n}/{m}"],
    sent1: ["🥇 Först in! Snabbaste kameran i Dalarna.", "🥇 Först på plats. Gruppchefen ä imponerad.", "🥇 Blixtsnabbt, soldat. Guldmedalj i fotospaning.",
      "🥇 Först! Du hann före ölen hann bli varm.", "🥇 Ettan in. Dä kallas beredskap."],
    sent: ["📸 Rapport inlämnad. Över och ut.", "📸 Bilden ä hos chefen. Snyggt, menig.", "📸 Lägesbild mottagen. Truppen tackar.",
      "📸 Inrapporterat! Generalstaben nickar.", "📸 Spaningen klar. Bra jobbat, korpral.", "📸 Bildbevis säkrat. Ingen kan säga emot nu.",
      "📸 Rapporten ä inne. Medalj kanske, i morron.", "📸 Bilden flög iväg. Chefen ser'n nu."],
    late: ["⏰ Sent, men in. Bättre sent än saknad i strid.", "⏰ Rapporten kom efter gonggongen. Den räknas ändå i hjärtat.",
      "⏰ För sent för medalj, int' för ära.", "⏰ Efter klockan, men chefen ä glad ändå."],
    missing: ["Saknas i strid. Sist sedd nära korvkiosken.", "Saknas i strid. Antagligen i kön till toaletten.",
      "Saknas i strid. Radion svarar int'.", "Saknas i strid. Spårhunden ä utskickad.", "Saknas i strid. Troligen mitt i en bra diskussion.",
      "Saknas i strid. Mobilen ligger säkert i jackan.", "Saknas i strid. Kanske på dansgolvet, kanske i en taxi.",
      "Saknas i strid. Ingen fara – vi kollar läget sen.", "Saknas i strid. Antagligen upptagen med att ha kul.",
      "Saknas i strid. Brevduvan ä på väg."],
    allIn: ["🎖️ Hela truppen rapporterade i tid. Dalregementet ä stolt!", "🎖️ Alla i tid! Sånt ser man sällan utanför lumpen.",
      "🎖️ Fullt hus. Gruppchefen fäller en tår."],
    noneIn: ["📭 Ingen rapport. Truppen ä för upptagen med att ha kul.", "📭 Tyst på radion. Det får man tolka som gott läge.",
      "📭 Inga bilder. Högkvarteret antar att allt ä lugnt."],
    reqOk: ["📸 Lägesrapport begärd! Truppen har 10 min.", "📸 Ordern ä ute. Klockan tickar: 10 min.", "📸 Spaningsorder skickad till truppen."],
    first: "🥇 Först in", last: "🐢 Sist in (men in)", fastest: "Snabbast: {name} på {t}"
  };
  var ERR = {
    not_member: ["Du ä int' med i gruppen.", "You are not in this group."],
    not_chief: ["Bara gruppchefen och vice gruppchefer kan begära lägesrapport.", "Only the chief and vice chiefs can ask for a status report."],
    not_allowed: ["Det får du int'. Bara 👑 ägaren styr roller, och bara ägaren kan plocka ut chefen eller en vice.", "Not allowed. Only the 👑 owner sets roles and can remove the chief or a vice."],
    cannot_remove_creator: ["👑 Ägaren kan ingen plocka ut. Det ä ju hens grupp.", "Nobody can remove the 👑 owner."],
    cannot_remove_self: ["Du kan int' plocka ut dig själv. Använd Lämna i stället.", "You cannot remove yourself. Use Leave."],
    slow_down: ["Lugn nu. Max 20 utplockningar i timmen.", "Easy. Max 20 removals per hour."],
    invalid_member: ["Den personen ä int' med i gruppen längre.", "That person left the group."],
    status_slow: ["Lugn, chefen. Max en lägesrapport per 20 min.", "Easy, chief. Max one report per 20 min."],
    status_limit: ["Max 6 lägesrapporter per kväll. Låt truppen ha kul.", "Max 6 status reports per night."],
    status_not_found: ["Lägesrapporten finns int' längre.", "The status report is gone."],
    status_closed: ["För sent – rapporten ä stängd (60 min).", "Too late – the report is closed."],
    status_answered: ["Du har redan rapporterat. Bra jobbat!", "You already reported."],
    invalid_photo: ["Bilden gick int' att läsa. Ta en ny.", "Could not read the photo."],
    invalid_msg: ["Texten ä för lång (max 100 tecken).", "Text too long (max 100)."],
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
        if (name === "my_status" || name === "chief_state") { state = "missing"; reqs = []; render(); }
      }
      return r;
    });
  }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function now() { return Date.now() + skew; }
  function msLeft(r) { return Date.parse(r.ends_at) - now(); }
  function lateLeft(r) { return Date.parse(r.late_until || r.ends_at) - now(); }
  function setSkew(d) { var s = d && Date.parse(d.now); if (isFinite(s)) skew = s - Date.now(); }
  function hiddenList() { var h = U.ls.getJSON(HIDE_KEY, []); return Array.isArray(h) ? h : []; }
  function hideReq(id) { var h = hiddenList(); if (h.indexOf(String(id)) < 0) h.push(String(id)); U.ls.setJSON(HIDE_KEY, h.slice(-30)); }
  function seenOnce(key) { var s = U.ls.getJSON(SEEN_KEY, []) || []; if (s.indexOf(key) >= 0) return true; s.push(key); U.ls.setJSON(SEEN_KEY, s.slice(-60)); return false; }
  function fx() { try { window.FX.unlock(); window.FX.vibrate([30, 50, 30]); } catch (e) {} }
  function secTxt(s) { s = s | 0; return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function who(x) { return x.is_me ? L("Du", "You") : (x.name || L("Någon", "Someone")); }
  // The request that wants MY photo now (newest first), or the chief's running one.
  function todo() {
    var h = hiddenList();
    for (var i = 0; i < reqs.length; i++) { var r = reqs[i]; if (!r.by_me && !r.mine && msLeft(r) > 0 && h.indexOf(String(r.id)) < 0) return r; }
    return null;
  }
  function todoAny() {
    for (var i = 0; i < reqs.length; i++) { var r = reqs[i]; if (!r.by_me && !r.mine && msLeft(r) > 0) return r; }
    return null;
  }
  function running() {
    for (var i = 0; i < reqs.length; i++) { var r = reqs[i]; if (r.by_me && !r.done && msLeft(r) > 0) return r; }
    return null;
  }

  /* ---------- v25: "seen" ping (12 h acting-vice rule) + "you were removed" notice ---------- */
  var seenAt = 0, removedAt = 0;
  var REMOVED = [
    "🚪 Du ä utplockad ur {grupp}. Har du koden kan du gå med igen.",
    "🚪 {grupp} har skickat hem dig från fronten. Koden tar dig tillbaka, om de vill.",
    "🚪 Avmönstrad ur {grupp}. Ingen fara – fråga efter koden om det va' ett misstag."];
  function pingSeen() {
    if (!A || !A.LIVE || !A.authed() || document.visibilityState === "hidden") return;
    var now = Date.now();
    if (now - seenAt > 5 * 60000) { seenAt = now; call("mark_seen"); }
    if (now - removedAt > 5 * 60000) {
      removedAt = now;
      call("my_removals").then(function (r) {
        if (r.error) return;
        var list = A.parseData(r.data);
        if (!Array.isArray(list) || !list.length) return;
        list.forEach(function (x) {
          A.toast(sv() ? fill(pick("rm", REMOVED), { grupp: x.group_name || "gruppen" }) : "🚪 You were removed from " + (x.group_name || "a group") + ". Rejoin with the code.", { ms: 9000, urgent: true,
            action: { label: L("👥 Grupper", "👥 Groups"), fn: function () { try { A.showGroups(); } catch (e) {} } } });
        });
        try { A.updateCounts(); } catch (e) {}
      });
    }
  }

  /* ---------- Poll ---------- */
  function load(force) {
    pingSeen();
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    if (busy || (!force && Date.now() - pollAt < 20000)) return Promise.resolve();
    if (document.visibilityState === "hidden" && !force) return Promise.resolve();
    busy = true; pollAt = Date.now();
    return call("my_status").then(function (r) {
      busy = false;
      if (r.error) return;
      var d = A.parseData(r.data), list = Array.isArray(d) ? d : [];
      if (list[0]) setSkew(list[0]);
      var was = state; state = "on";
      var prev = reqs; reqs = list;
      notify(prev);
      render();
      if (was !== "on") A.updateCounts();
    }, function () { busy = false; });
  }
  function notify(prev) {
    reqs.forEach(function (r) {
      // A new request while the app is open: say it once (the push may not show in the foreground).
      if (!r.by_me && !r.mine && msLeft(r) > 0 && !seenOnce("req:" + r.id)) {
        fx();
        A.toast("📸 " + (r.by || L("Gruppchefen", "The chief")) + ": " + (sv() ? pick("b", T.banner) : pick("be", T.bannerEn)) + " · " + (r.group_name || ""),
          { ms: 8000, action: { label: L("📸 Foto", "📸 Photo"), fn: function () { shoot(r); } } });
      }
      // The report is ready: once per request for everyone in the group.
      if (r.done && (r.by_me || r.mine) && !seenOnce("done:" + r.id)) {
        A.toast(L("📋 Lägesrapporten ä klar", "📋 The status report is ready") + " · " + (r.group_name || ""),
          { ms: 8000, action: { label: L("Visa", "Show"), fn: function () { openReport(r.id); } } });
      }
    });
  }

  /* ---------- Banner + HUD chip (countdown) ---------- */
  var box = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "chief-banner"; box.className = "chief-banner"; box.hidden = true;
    box.setAttribute("role", "status");
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var id = box.getAttribute("data-id"), r = reqById(id); if (!r) return;
      if (b.hasAttribute("data-shoot")) shoot(r);
      else if (b.hasAttribute("data-hide")) { hideReq(id); render(); }
      else if (b.hasAttribute("data-open")) openReport(id);
    });
    return box;
  }
  function reqById(id) { for (var i = 0; i < reqs.length; i++) if (String(reqs[i].id) === String(id)) return reqs[i]; return null; }
  var bannerLine = {};
  function render() {
    if (!A) return;
    var b = ensureBox(), r = state === "on" ? todo() : null;
    b.hidden = !r;
    document.body.classList.toggle("chief-on", !!r);
    if (r) {
      if (!bannerLine[r.id]) bannerLine[r.id] = sv() ? spick("b" + r.id, T.banner) : spick("b" + r.id, T.bannerEn);
      b.setAttribute("data-id", String(r.id));
      b.innerHTML = '<button type="button" class="cb-txt" data-open="1"><b>📸 ' + esc(bannerLine[r.id]) + "</b>" +
        '<span class="cb-sub">' + esc((r.by || "") + " · " + (r.group_name || "")) + "</span></button>" +
        '<b class="cb-cd" data-cd="' + esc(String(Date.parse(r.ends_at))) + '">' + U.mmss(msLeft(r)) + "</b>" +
        '<button type="button" class="btn btn-amber cb-go" data-shoot="1">' + esc(L("📸 Foto", "📸 Photo")) + "</button>" +
        '<button type="button" class="cb-x" data-hide="1" aria-label="' + esc(L("Dölj", "Hide")) + '">✕</button>';
    }
    startTick();
  }
  function startTick() {
    var need = !!(todoAny() || running());
    if (need && !tick) tick = setInterval(onTick, 1000);
    if (!need && tick) { clearInterval(tick); tick = null; }
  }
  var lastChipKey = "";
  function onTick() {
    document.querySelectorAll("[data-cd]").forEach(function (x) {
      var left = +x.getAttribute("data-cd") - now();
      x.textContent = U.mmss(left);
      x.classList.toggle("cb-low", left < 60000);
    });
    // Countdown over (or a new state): redraw the banner, the chip and an open report.
    var key = (todoAny() ? "t" + todoAny().id : "") + (running() ? "r" + running().id : "");
    if (key !== lastChipKey) { lastChipKey = key; render(); try { A.updateCounts(); } catch (e) {} if (!key) setTimeout(function () { load(true); }, 1500); }
  }
  function chipHTML() {
    if (state !== "on") return "";
    var r = todoAny();
    if (r) return '<button type="button" class="hx-chip hx-urgent hx-chief" data-hx="chief" aria-label="' + esc(L("Lägesrapport: skicka foto", "Status report: send photo")) + '">📸 <b data-cd="' +
      esc(String(Date.parse(r.ends_at))) + '">' + U.mmss(msLeft(r)) + "</b></button>";
    var m = running();
    if (m) return '<button type="button" class="hx-chip hx-chief" data-hx="chief" aria-label="' + esc(L("Lägesrapport pågår", "Status report running")) + '">📋 ' + (m.answered | 0) + "/" + (m.needed | 0) +
      ' <b data-cd="' + esc(String(Date.parse(m.ends_at))) + '">' + U.mmss(msLeft(m)) + "</b></button>";
    return "";
  }

  /* ---------- Answer with a photo ---------- */
  var fileInp = null;
  function shoot(r) {
    if (!window.PHOTO || !window.PHOTO._shrink) { A.toast(errText("error"), { err: true }); return; }
    if (!fileInp) {
      fileInp = document.createElement("input");
      fileInp.type = "file"; fileInp.accept = "image/*"; fileInp.className = "ph-file"; fileInp.tabIndex = -1;
      fileInp.setAttribute("aria-hidden", "true");
      document.body.appendChild(fileInp);
      fileInp.addEventListener("change", function () {
        var f = fileInp.files && fileInp.files[0], rr = fileInp._req;
        if (!f || !rr) return;
        if (f.type && !/^image\//.test(f.type)) { A.toast(errText("invalid_photo"), { err: true }); return; }
        preview(rr, f);
      });
    }
    fileInp._req = r; fileInp.value = "";
    fileInp.click();
  }
  function preview(r, file) {
    var o = el("div", { class: "ph-ov ph-pick chief-ov", role: "dialog", "aria-modal": "true" }), closed = false, shot = null, busy2 = false;
    var img = el("img", { class: "ph-prev", alt: L("Förhandsvisning", "Preview") });
    var wait = el("div", { class: "ph-wait", text: L("📷 Gör bilden liten…", "📷 Making it small…") });
    var cap = el("input", { class: "inp ph-cap", maxlength: "100", placeholder: L("Text (valfritt)", "Text (optional)"), "aria-label": L("Text till bilden", "Caption"), autocomplete: "off", enterkeyhint: "send" });
    var cd = el("b", { class: "cb-cd", "data-cd": String(Date.parse(r.ends_at)), text: U.mmss(msLeft(r)) });
    var send = el("button", { type: "button", class: "btn btn-amber ph-send", text: L("📤 Rapportera", "📤 Report") });
    var cancel = el("button", { type: "button", class: "btn ph-cancel", text: L("Avbryt", "Cancel") });
    send.disabled = true;
    o.appendChild(el("div", { class: "ph-card" }, [
      el("h3", { class: "ph-title" }, [document.createTextNode(L("🎖️ Lägesrapport ", "🎖️ Status report ")), cd]),
      el("div", { class: "ph-prev-box" }, [img, wait]), cap,
      el("p", { class: "ph-priv", text: L("🔒 Bilden hamnar i gruppchatten och syns bara för gruppen.", "🔒 The photo goes to the group chat. Only the group sees it.") }),
      el("div", { class: "ph-row" }, [cancel, send])
    ]));
    document.body.appendChild(o);
    function close() { if (closed) return; closed = true; if (img.src) { try { URL.revokeObjectURL(img.src); } catch (e) {} } o.remove(); }
    cancel.addEventListener("click", close);
    o.addEventListener("click", function (e) { if (e.target === o && !busy2) close(); });
    cap.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    window.PHOTO._shrink(file).then(function (s) {
      if (closed) return;
      shot = s; img.src = URL.createObjectURL(s.blob); wait.remove(); send.disabled = false;
    }, function () { if (!closed) wait.textContent = L("Bilden gick int' att öppna. Prova en annan.", "Could not open the photo."); });
    startTick();
    function go() {
      if (!shot || busy2) return;
      var text = String(cap.value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      if (text.length > 100) { A.toast(errText("invalid_msg"), { err: true }); return; }
      busy2 = true; send.disabled = true; send.textContent = L("Skickar…", "Sending…");
      blobB64(shot.blob).then(function (b64) {
        return call("answer_status", { p_req_id: +r.id, p_b64: b64, p_w: shot.w, p_h: shot.h, p_caption: text || null });
      }).then(function (res) {
        busy2 = false;
        if (res.error) {
          send.disabled = false; send.textContent = L("📤 Rapportera", "📤 Report");
          var c = codeOf(res.error);
          A.toast(errText(c), { err: true });
          if (c === "status_answered" || c === "status_closed" || c === "status_not_found") { close(); load(true); }
          return;
        }
        var d = A.parseData(res.data);
        try { if (window.PHOTO._remember && d.photo_id) window.PHOTO._remember(d.photo_id, shot.blob); } catch (e) {}
        r.mine = true;
        A.toast(!d.in_time ? pick("l", T.late) : (d.rank | 0) === 1 ? pick("s1", T.sent1) : pick("s", T.sent), { cls: "skal", ms: 5000 });
        fx(); close(); render(); A.updateCounts();
        setTimeout(function () { load(true); }, 600);
      }, function () {
        busy2 = false; send.disabled = false; send.textContent = L("📤 Rapportera", "📤 Report");
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

  /* ---------- Report screen ---------- */
  var view = null;   // {id, body, timer}
  function openReport(id) {
    if (!A) return;
    A.openSheet(L("📋 Lägesrapport", "📋 Status report"), function (body) {
      // Own root: when another sheet replaces the content, the root leaves the page and the refresh stops.
      var root = el("div", { class: "chief-sheet" });
      body.appendChild(root);
      view = { id: String(id), body: root, timer: null };
      root.appendChild(el("p", { class: "muted", text: L("Laddar…", "Loading…") }));
      refreshReport(true);
    }, { now: true });
  }
  function refreshReport(first) {
    if (!view || !document.body.contains(view.body)) { if (view && view.timer) clearInterval(view.timer); view = null; return; }
    var v = view;
    call("status_report", { p_req_id: +v.id }).then(function (res) {
      if (view !== v || !document.body.contains(v.body)) return;
      if (res.error) { v.body.innerHTML = ""; v.body.appendChild(el("p", { class: "muted", text: errText(codeOf(res.error)) })); return; }
      var r = A.parseData(res.data);
      setSkew(r);
      var mine = reqById(r.id); if (mine) { mine.mine = r.mine; mine.answered = r.answered; mine.done = r.done; }
      drawReport(v.body, r);
      if (first && !v.timer) v.timer = setInterval(function () { if (!view || view !== v) { clearInterval(v.timer); return; } refreshReport(false); }, 6000);
      if (r.done && lateLeft(r) <= 0 && v.timer) { clearInterval(v.timer); v.timer = null; }
    });
  }
  function drawReport(body, r) {
    var scr = body.parentNode, sc = scr ? scr.scrollTop : 0;
    body.innerHTML = "";
    var done = !!r.done, answers = r.answers || [], missing = r.missing || [];
    var inTime = answers.filter(function (a) { return a.in_time; }), late = answers.filter(function (a) { return !a.in_time; });
    var head = el("div", { class: "cr-head" + (done ? " done" : "") }, [
      el("div", { class: "cr-g", text: (r.group_name || "") + " · " + L("begärd av ", "asked by ") + (r.by_me ? L("dig", "you") : (r.by || "?")) + " " + U.timeHM(r.created_at) }),
      done ? el("div", { class: "cr-state", text: L("🎖️ Rapporten ä klar", "🎖️ Report complete") })
        : el("div", { class: "cr-state" }, [document.createTextNode(L("⏱️ Tid kvar ", "⏱️ Time left ")), el("b", { class: "cb-cd", "data-cd": String(Date.parse(r.ends_at)), text: U.mmss(msLeft(r)) })]),
      el("div", { class: "cr-n", text: fill(spick("w" + r.id, T.chiefWait), { n: r.answered | 0, m: r.needed | 0 }) })
    ]);
    body.appendChild(head);
    if (!r.mine && !r.by_me && lateLeft(r) > 0) {
      body.appendChild(A.btn(msLeft(r) > 0 ? L("📸 Skicka min rapport", "📸 Send my report") : L("📸 Skicka ändå (sent)", "📸 Send anyway (late)"), "btn-amber btn-block cr-shoot", function () { shoot(reqById(r.id) || r); }));
    } else if (!r.mine && r.by_me && lateLeft(r) > 0) {
      body.appendChild(A.btn(L("📸 Chefen rapporterar också", "📸 Chief reports too"), "btn-small btn-block cr-shoot", function () { shoot(reqById(r.id) || r); }));
    }
    // Photo grid
    if (answers.length) {
      var grid = el("div", { class: "cr-grid" });
      answers.forEach(function (a, i) {
        var badge = a.in_time && a.rank === 1 ? "🥇" : a.in_time && i === inTime.length - 1 && inTime.length > 1 && done ? "🐢" : !a.in_time ? "⏰" : "";
        var cell = el("button", { type: "button", class: "cr-cell" + (a.in_time ? "" : " late"), "aria-label": who(a) + " +" + secTxt(a.sec) });
        var fr = el("div", { class: "cr-ph loading" }, [el("span", { class: "cr-spin", text: "📷" })]);
        cell.appendChild(fr);
        cell.appendChild(el("div", { class: "cr-cap" }, [
          el("b", { text: (badge ? badge + " " : "") + who(a) }),
          el("small", { text: "+" + secTxt(a.sec) })
        ]));
        if (a.photo_id) {
          loadThumb(a.photo_id, fr);
          cell.addEventListener("click", function () { try { window.PHOTO._viewer(a.photo_id); } catch (e) {} });
        }
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    } else {
      body.appendChild(el("p", { class: "cr-empty muted", text: done ? spick("n" + r.id, T.noneIn) : L("Inga bilder än. Truppen letar efter kameran…", "No photos yet. The squad is finding the camera…") }));
    }
    // Lists
    if (done) {
      var lines = el("div", { class: "cr-lines" });
      if (inTime.length) {
        lines.appendChild(el("p", { class: "cr-l ok", text: "✅ " + L("I tid: ", "In time: ") + inTime.map(who).join(", ") }));
        lines.appendChild(el("p", { class: "cr-l", text: T.first + ": " + who(inTime[0]) + " (+" + secTxt(inTime[0].sec) + ")" }));
        if (inTime.length > 1) lines.appendChild(el("p", { class: "cr-l", text: T.last + ": " + who(inTime[inTime.length - 1]) + " (+" + secTxt(inTime[inTime.length - 1].sec) + ")" }));
      }
      if (late.length) lines.appendChild(el("p", { class: "cr-l late", text: "⏰ " + L("Kom sent: ", "Late: ") + late.map(who).join(", ") }));
      if (missing.length) {
        missing.forEach(function (m) {
          lines.appendChild(el("p", { class: "cr-l miss", text: "🫥 " + who(m) + ": " + spick(r.id + ":" + m.k, T.missing) }));
        });
      } else if ((r.needed | 0) > 0 && !late.length) lines.appendChild(el("p", { class: "cr-l ok", text: spick("a" + r.id, T.allIn) }));
      body.appendChild(lines);
    } else if (missing.length) {
      body.appendChild(el("p", { class: "cr-l muted", text: L("Väntar på: ", "Waiting for: ") + missing.map(who).join(", ") }));
    }
    body.appendChild(el("p", { class: "cr-note muted", text: L("Ingen straffas för en missad rapport. Bilderna ligger i gruppchatten.", "Nobody is punished for a missed report. The photos are in the group chat.") }));
    if (scr) scr.scrollTop = sc;
    startTick();
  }
  var thumbs = {};
  function loadThumb(id, fr) {
    var P = window.PHOTO;
    var put = function (u) { fr.classList.remove("loading"); fr.innerHTML = ""; fr.appendChild(el("img", { class: "cr-img", src: u, alt: "", draggable: "false" })); };
    if (thumbs[id]) { put(thumbs[id]); return; }
    if (P && P._url) {
      P._url(id).then(function (u) { thumbs[id] = u; put(u); }, function () { fr.classList.remove("loading"); fr.classList.add("gone"); fr.textContent = L("📷 borta", "📷 gone"); });
      return;
    }
    call("group_photo", { p_photo_id: +id }).then(function (res) {
      if (res.error) { fr.classList.remove("loading"); fr.textContent = "📷"; return; }
      var d = A.parseData(res.data);
      thumbs[id] = "data:" + (d.mime || "image/jpeg") + ";base64," + d.b64; put(thumbs[id]);
    });
  }

  /* ---------- Groups sheet: chief row ---------- */
  function chiefState(gid, force) {
    var c = chiefCache[gid];
    if (!force && c && Date.now() - c.at < 30000) return Promise.resolve(c.d);
    return call("chief_state", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data); setSkew(d);
      chiefCache[gid] = { at: Date.now(), d: d };
      return d;
    });
  }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || state === "missing" || off.chief_state || !g || !g.id) return;
    var box2 = el("div", { class: "chief-gi" });
    wrap.appendChild(box2);
    chiefState(g.id).then(function (d) { if (d) fillGroup(box2, g, d); else box2.remove(); });
  }
  /* ---------- v25 roles: badges, group page, member actions ---------- */
  function homeLbl(t) { try { return t && window.HOMETOWN ? window.HOMETOWN.label(t) : ""; } catch (e) { return ""; } }
  // Role badges of a member row (chief_state members[] or group_status_v2 rows).
  function badges(m) {
    var out = [];
    if (!m) return out;
    if (m.is_owner) out.push({ c: "owner", t: L("👑 Ägare", "👑 Owner") });
    if (m.is_chief) out.push({ c: "chief", t: L("🎖️ Chef", "🎖️ Chief") });
    if (m.is_vice) out.push({ c: "vice", t: L("🎗️ Vice", "🎗️ Vice") });
    if (m.is_acting) out.push({ c: "acting", t: L("🎗️ Tjänstgörande chef", "🎗️ Acting chief") });
    return out;
  }
  function badgeEls(m) { return badges(m).map(function (b) { return el("span", { class: "role-b " + b.c, text: b.t }); }); }
  function nm(m) { return m.is_me ? L("Du", "You") : (m.name || L("Någon", "Someone")); }
  function fillGroup(box2, g, d) {
    box2.innerHTML = "";
    var mem = d.members || [];
    var chief = null; mem.forEach(function (m) { if (m.is_chief) chief = m; });
    var chiefHome = homeLbl(d.chief_home);
    var top = el("div", { class: "chief-line" }, [
      el("span", { class: "chief-badge", text: "🎖️" }),
      el("span", { class: "chief-name", text: L("Gruppchef: ", "Chief: ") + (d.is_chief ? L("Du", "You") : (d.chief_name || "?")) }),
      chiefHome ? el("span", { class: "ht-tag", text: chiefHome }) : null
    ]);
    if (d.can_hand && mem.length > 1) {
      top.appendChild(el("button", { type: "button", class: "chief-hand", text: L("Roller", "Roles"), onclick: function () { handSheet(g, d); } }));
    }
    box2.appendChild(top);
    // 👑 owner + 🎗️ vices (v25 fields; an old server sends none and this line stays away)
    var parts = [];
    if (d.owner_name && !(chief && chief.is_owner)) parts.push(el("span", {}, [document.createTextNode(L("👑 Ägare: ", "👑 Owner: ")), el("b", { text: d.is_owner ? L("Du", "You") : d.owner_name })]));
    else if (d.owner_name) parts.push(el("span", {}, [document.createTextNode(L("👑 Ägare + chef", "👑 Owner + chief"))]));
    var vices = d.vices || [];
    if (vices.length) parts.push(el("span", {}, [document.createTextNode(L("🎗️ Vice: ", "🎗️ Vice: ")), el("b", { text: vices.map(nm).join(", ") })]));
    if (d.acting_name) parts.push(el("span", { class: "chief-acting" }, [document.createTextNode(L("🎗️ ", "🎗️ ")), el("b", { text: d.is_acting ? L("Du", "You") : d.acting_name }),
      document.createTextNode(L(" tjänstgör som chef (chefen har varit borta 12 h)", " is acting chief (chief away 12 h)"))]));
    if (parts.length) box2.appendChild(el("div", { class: "chief-roles" }, parts));
    var rq = d.req;
    if (rq) {
      var live = !rq.done && msLeft(rq) > 0;
      var line = el("button", { type: "button", class: "chief-rq" + (live ? " live" : ""), onclick: function () { openReport(rq.id); } }, [
        document.createTextNode((live ? "📸 " : "📋 ") + L("Lägesrapport ", "Status report ") + U.timeHM(rq.created_at) + " · " + (rq.answered | 0) + "/" + (rq.needed | 0) + " "),
        live ? el("b", { class: "cb-cd", "data-cd": String(Date.parse(rq.ends_at)), text: U.mmss(msLeft(rq)) }) : el("span", { text: L("· Visa", "· Show") })
      ]);
      box2.appendChild(line);
      if (live && !rq.mine && !rq.by_me) box2.appendChild(A.btn(L("📸 Skicka min rapport", "📸 Send my report"), "btn-small btn-amber btn-block", function () { shoot(rq); }));
    }
    if (d.can_req != null ? d.can_req : d.is_chief) {
      var wait = Date.parse(d.next_at) - now(), used = d.used | 0, max = d.max | 0 || 6;
      var label = used >= max ? L("📸 Max " + max + " rapporter ikväll", "📸 Max " + max + " reports tonight")
        : wait > 1000 ? L("📸 Nästa lägesrapport om " + Math.ceil(wait / 60000) + " min", "📸 Next report in " + Math.ceil(wait / 60000) + " min")
        : L("📸 Begär lägesrapport", "📸 Ask for status report");
      var b = A.btn(label, "btn-small btn-block chief-req" + (used >= max || wait > 1000 ? "" : " btn-amber"), function () { request(g, b, box2); });
      b.disabled = used >= max || wait > 1000;
      box2.appendChild(b);
      box2.appendChild(el("p", { class: "chief-help muted", text: L("Alla får en push och 10 min att skicka ett foto. " + used + "/" + max + " ikväll" + (d.is_vice ? " (delas med chefen)." : "."),
        "Everyone gets a push and 10 min to send a photo. " + used + "/" + max + " tonight.") }));
    }
  }
  function request(g, b, box2) {
    if (b.disabled) return;
    b.disabled = true;
    call("request_status", { p_group_id: g.id }).then(function (r) {
      if (r.error) { b.disabled = false; A.toast(errText(codeOf(r.error)), { err: true }); chiefState(g.id, true).then(function (d) { if (d) fillGroup(box2, g, d); }); return; }
      var d = A.parseData(r.data); setSkew(d);
      A.invoke("notify-group", { event: "status_req", req_id: +d.id });
      A.toast(pick("rq", T.reqOk), { ms: 5000, cls: "skal" });
      fx();
      seenOnce("req:" + d.id);
      reqs = [d].concat(reqs.filter(function (x) { return String(x.id) !== String(d.id); }));
      delete chiefCache[g.id];
      render(); A.updateCounts();
      openReport(d.id);
    });
  }
  // Owner only (owner powers): choose the chief and the vices.
  function handSheet(g, d) {
    A.openSheet(L("👑 Roller", "👑 Roles"), function (body) {
      var cur = d;
      function draw() {
        body.innerHTML = "";
        body.appendChild(el("p", { class: "muted", text: L("Du ä 👑 ägare i " + g.name + ". Bara du kan välja chef och vice. Chefen och vice kan begära lägesrapport och plocka ut vanliga medlemmar.",
          "You are the 👑 owner of " + g.name + ". Only you pick the chief and the vices.") }));
        body.appendChild(el("h3", { text: L("🎖️ Gruppchef", "🎖️ Chief") }));
        var list = el("div", { class: "chips chief-pick" });
        (cur.members || []).forEach(function (m) {
          var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(!!m.is_chief), text: (m.is_chief ? "🎖️ " : "") + (m.is_me ? L("Du", "You") + " (" + m.name + ")" : m.name) });
          c.addEventListener("click", function () {
            if (m.is_chief) return;
            body.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
            call("set_chief", { p_group_id: g.id, p_k: m.k }).then(function (r) {
              body.querySelectorAll("button").forEach(function (x) { x.disabled = false; });
              if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
              cur = A.parseData(r.data); chiefCache[g.id] = { at: Date.now(), d: cur };
              A.toast(L("🎖️ " + (m.is_me ? "Du" : m.name) + " ä ny gruppchef. Givakt!", "🎖️ " + (m.is_me ? "You are" : m.name + " is") + " the new chief."), { cls: "skal" });
              draw();
            });
          });
          list.appendChild(c);
        });
        body.appendChild(list);
        if (cur.vices === undefined) return;   // old server: no vices
        body.appendChild(el("h3", { text: L("🎗️ Vice gruppchefer", "🎗️ Vice chiefs") }));
        var vl = el("div", { class: "chips chief-pick" });
        (cur.members || []).forEach(function (m) {
          if (m.is_owner || m.is_chief) return;
          var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(!!m.is_vice), text: (m.is_vice ? "🎗️ " : "＋ ") + (m.is_me ? L("Du", "You") : m.name) });
          c.addEventListener("click", function () { setVice(g, m, !m.is_vice, function (nd) { if (nd) { cur = nd; draw(); } }); });
          vl.appendChild(c);
        });
        if (!vl.children.length) vl.appendChild(el("p", { class: "muted", text: L("Bjud in fler först.", "Invite more people first.") }));
        body.appendChild(vl);
        body.appendChild(A.btn(L("Klar", "Done"), "btn-block", function () { A.closeSheet(); try { A.showGroups(); } catch (e) {} }));
      }
      draw();
    });
  }
  function setVice(g, m, on, done) {
    call("set_vice", { p_group_id: g.id, p_k: m.k, p_on: on }).then(function (r) {
      if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); if (done) done(null); return; }
      var nd = A.parseData(r.data); chiefCache[g.id] = { at: Date.now(), d: nd };
      A.toast(on ? L("🎗️ " + nm(m) + " ä vice gruppchef. Givakt!", "🎗️ " + nm(m) + " is now vice chief.")
        : L("🎗️ " + nm(m) + " ä int' vice längre.", "🎗️ " + nm(m) + " is no longer vice."), { cls: "skal" });
      try { window.FX.vibrate(15); } catch (e) {}
      if (done) done(nd);
    });
  }
  var REMOVE_OK = ["🚪 {namn} ä utplockad ur {grupp}. Ordning i leden.", "🚪 {namn} har lämnat {grupp}. Avmönstrad.",
    "🚪 Klart. {namn} ä int' med i {grupp} längre."];
  // Action panel for one member row in the "Medlemmar" list (social.js). rows = all group_status_v2 rows.
  // Returns an element, or null when the caller has no action for that member.
  function memberPanel(g, m, rows, onDone, onUniform) {
    if (!m || !m.k || m.is_me) return null;
    var me = null, ownerIn = false;
    (rows || []).forEach(function (x) { if (x.is_me) me = x; if (x.is_owner) ownerIn = true; });
    var powers = !!(me && (me.is_owner || (!ownerIn && me.is_chief)));
    var acts = [];
    if (powers && !m.is_chief) acts.push(A.btn(L("🎖️ Gör till chef", "🎖️ Make chief"), "btn-small", function () { doChief(); }));
    if (powers && !m.is_owner && !m.is_chief) {
      acts.push(A.btn(m.is_vice ? L("🎗️ Ta bort vice", "🎗️ Remove vice") : L("🎗️ Gör till vice", "🎗️ Make vice"), "btn-small", function () {
        setVice(g, m, !m.is_vice, function (nd) { if (nd) { delete chiefCache[g.id]; if (onDone) onDone(); } });
      }));
    }
    if (m.can_remove) acts.push(A.btn(L("🚪 Ta bort ur gruppen", "🚪 Remove from group"), "btn-small btn-danger", function () { ask(); }));
    if (!acts.length) return null;
    var box = el("li", { class: "st-act" });
    var row = el("div", { class: "row" });
    if (onUniform) row.appendChild(A.btn(L("🎖️ Uniform", "🎖️ Uniform"), "btn-small", onUniform));
    acts.forEach(function (b) { row.appendChild(b); });
    box.appendChild(row);
    function doChief() {
      row.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
      call("set_chief", { p_group_id: g.id, p_k: m.k }).then(function (r) {
        row.querySelectorAll("button").forEach(function (x) { x.disabled = false; });
        if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
        delete chiefCache[g.id];
        A.toast(L("🎖️ " + nm(m) + " ä ny gruppchef. Givakt!", "🎖️ " + nm(m) + " is the new chief."), { cls: "skal" });
        if (onDone) onDone();
      });
    }
    function ask() {
      if (box.querySelector(".confirm")) return;
      var yes = A.btn(L("🚪 Ja, ut", "🚪 Yes, remove"), "btn-small btn-danger st-rm-yes", function () {
        yes.disabled = true;
        call("remove_member", { p_group_id: g.id, p_user_id: m.k }).then(function (r) {
          yes.disabled = false;
          if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); return; }
          var d = A.parseData(r.data);
          if (d.state) chiefCache[g.id] = { at: Date.now(), d: d.state }; else delete chiefCache[g.id];
          A.toast(sv() ? fill(pick("rmok", REMOVE_OK), { namn: d.name || m.name || "Någon", grupp: d.group_name || g.name || "gruppen" })
            : "🚪 " + (d.name || m.name) + " was removed from " + (d.group_name || g.name) + ".", { cls: "skal", ms: 5000 });
          try { window.FX.vibrate([20, 40, 20]); } catch (e) {}
          if (onDone) onDone();
        });
      });
      var c = el("div", { class: "confirm" }, [
        el("p", {}, [el("b", { text: L("Säker? " + (m.name || "Personen") + " åker ut ur " + (g.name || "gruppen"), "Sure? " + (m.name || "This person") + " leaves " + (g.name || "the group")) })]),
        el("p", { class: "muted st-act-note", text: L("Hen kan bara komma tillbaka med gruppkoden.", "They can only come back with the group code.") }),
        el("div", { class: "row" }, [A.btn(L("Avbryt", "Cancel"), "btn-small", function () { c.remove(); }), yes])
      ]);
      box.appendChild(c);
    }
    return box;
  }

  /* ---------- Deep link ?status=<id> ---------- */
  function openStatusLink(id) {
    if (!/^\d{1,18}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load(true).then(function () { openReport(id); });
    })();
  }
  function linkFromUrl() {
    if (linkDone) return null;
    var id = null;
    try { id = new URLSearchParams(location.search).get("status"); } catch (e) {}
    if (!id || !/^\d{1,18}$/.test(id)) return null;
    linkDone = true;
    try { var ps = new URLSearchParams(location.search); ps.delete("status"); history.replaceState(null, "", location.pathname + (ps.toString() ? "?" + ps : "") + location.hash); } catch (e) {}
    return id;
  }

  window.CHIEF = {
    state: function () { return state; },
    data: function () { return reqs.slice(); },
    openReport: openReport, openStatusLink: openStatusLink,
    badges: badges, memberPanel: memberPanel, invalidate: function (gid) { delete chiefCache[gid]; },
    _texts: T,
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
    },
    onAuthed: function () {
      load(true);
      var id = linkFromUrl(); if (id) openStatusLink(id);
    },
    onReadyShow: function () {
      var id = linkFromUrl(); if (id) { openStatusLink(id); return "chief"; }
      return "";
    },
    onPoll: function () { load(false); },
    applyText: function () { bannerLine = {}; render(); },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (action) {
      if (action !== "chief") return;
      var r = todoAny(); if (r) { shoot(r); return; }
      var m = running(); if (m) openReport(m.id);
    },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
