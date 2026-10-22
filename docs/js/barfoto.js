/* Öl Nu — 📸 KROGBILDER: a small photo strip on the bar sheet (CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS",
   migration 0140). window.BARFOTO, in app.js mods(): init, barPopupHTML. No new button, no push.
   - The server tags a group-chat photo, a lägesrapport photo (= chat photo) or an engångskamera shot to a bar when the
     photographer was checked in there or had a precise pin within 60 m (never "Bara område", ghost, DM or event chats,
     never a skåltimme photo). bar_photos(bar_id) gives:
       group  = photos of MY groups taken at this bar (last 8 days, while the photo itself is alive; film after 10:00);
       public = photos a photographer chose to "🌍 Dela med alla på krogen" (7 days, no name, no group).
   - Bar sheet: one ".ev-line.bf-line" under the title (hidden when there are no photos): "📸 Gänget här · 3" + up to 8
     thumbnails (🌍 badge = public). Tap = viewer: who / when (group) or "🌍 Delad av en gäst", and
       own photo   → "🌍 Dela med alla på krogen" (confirm: 7 days, no name, think about who is in the picture) / "🔒 Sluta dela";
       public photo → "🚩 Anmäl / dölj" (hidden for me at once; 3 reports hide it for everyone; owner moderates in stats.html).
   - Images are fetched one by one (bar_photo) and kept as blob URLs for this page life. A missing RPC = nothing shows. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, cache = {}, busy = {}, imgs = {}, imgBusy = {}, TTL = 60000, MAX = 8;
  var CODES = ["photo_not_found", "not_allowed", "own_photo", "slow_down", "invalid_bar", "not_authenticated"];
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  var T = {
    shared: ["🌍 Delad med alla på krogen i 7 dar. Inget namn syns.", "🌍 Ute i världen! Bilden syns på krogen i en vecka, utan namn.",
      "🌍 Uppladdat till krogens anslagstavla. Anonymt, 7 dar.", "🌍 Nu kan alla på krogen se den. Ditt namn stannar hemma."],
    unshared: ["🔒 Bilden ä privat igen. Bara gänget ser den.", "🔒 Indragen! Nu ser bara gruppen den.", "🔒 Tillbaka i kassaskåpet."],
    reported: ["🚩 Tack! Bilden ä dold för dig. Generalen tittar på den.", "🚩 Anmäld och dold. Vi tar hand om det.",
      "🚩 Borta ur din vy. Tre anmälningar så försvinner den för alla."],
    err: { photo_not_found: ["Bilden finns int' kvar.", "Photo is gone."], not_allowed: ["Den bilden får int' delas.", "This photo can't be shared."],
      own_photo: ["Din egen bild – använd Sluta dela.", "Your own photo – use Stop sharing."], slow_down: ["Lugn i stormen – för många på kort tid.", "Too many – try later."] }
  };
  function errText(c) { var x = T.err[c]; return x ? x[sv() ? 0 : 1] : L("Nåt gick fel. Försök igen.", "Something went wrong."); }

  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off = true; r.off = true; } return r; });
  }
  function load(id, force) {
    var c = cache[id];
    if (busy[id] || off) return;
    if (!force && c && Date.now() - c.at < TTL) return;
    busy[id] = true;
    call("bar_photos", { p_bar_id: id }).then(function (r) {
      busy[id] = false;
      if (r.error) return;
      var d = A.parseData(r.data);
      cache[id] = { at: Date.now(), d: { group: d.group || [], public: d.public || [] } };
      paint(id);
    });
  }
  function items(id) {
    var c = cache[id]; if (!c) return [];
    return c.d.group.map(function (x) { x.pub = false; return x; }).concat(c.d.public.map(function (x) { x.pub = true; return x; })).slice(0, 24);
  }
  function hm(ts) {
    var d = new Date(ts); if (!isFinite(d)) return "";
    var t = d.toLocaleTimeString(sv() ? "sv-SE" : "en-GB", { hour: "2-digit", minute: "2-digit" });
    var age = Date.now() - d.getTime();
    if (age < 14 * 3600000) return L("ikväll ", "tonight ") + t;
    if (age < 38 * 3600000) return L("i går ", "yesterday ") + t;
    return d.toLocaleDateString(sv() ? "sv-SE" : "en-GB", { weekday: "short" }) + " " + t;
  }
  function stripHTML(id) {
    var list = items(id), g = list.filter(function (x) { return !x.pub; }).length;
    if (!list.length) return '<div class="ev-line bf-line" data-bf="' + esc(id) + '" hidden></div>';
    var head = g ? L("📸 Gänget här", "📸 Your crew here") : L("🌍 Gästernas bilder", "🌍 Guests' photos");
    var th = list.slice(0, MAX).map(function (x) {
      var u = imgs[x.key];
      return '<button type="button" class="bf-th' + (x.pub ? " bf-pub" : "") + (x.shared ? " bf-shared" : "") + '"' + (x.is_me ? ' data-bfme="1"' : "") + ' data-bfk="' + esc(x.key) + '" data-bfb="' + esc(id) + '" aria-label="' +
        esc((x.pub ? L("Delad bild", "Shared photo") : (x.by || "?")) + " " + hm(x.at)) + '">' +
        (u ? '<img alt="" src="' + esc(u) + '">' : '<span class="bf-sh" aria-hidden="true"></span>') +
        (x.pub || x.shared ? '<i class="bf-b" aria-hidden="true">🌍</i>' : "") + "</button>";
    }).join("");
    var more = list.length > MAX ? '<span class="bf-more">+' + (list.length - MAX) + "</span>" : "";
    return '<div class="ev-line bf-line" data-bf="' + esc(id) + '"><span class="bf-h">' + esc(head) + " · " + list.length + "</span>" +
      '<div class="bf-strip">' + th + more + "</div></div>";
  }
  function paint(id) {
    var sel = '.bf-line[data-bf="' + String(id).replace(/["\\]/g, "") + '"]', html = null;
    document.querySelectorAll(sel).forEach(function (x) { if (html == null) html = stripHTML(id); x.outerHTML = html; });
    items(id).slice(0, MAX).forEach(function (x) { fetchImg(x.key, id); });
  }
  var q = [], qRun = 0;
  function fetchImg(key, id) {
    if (imgs[key] || imgBusy[key]) return;
    imgBusy[key] = true; q.push([key, id]); pump();
  }
  function pump() {
    if (qRun >= 2 || !q.length) return;
    var j = q.shift(); qRun++;
    call("bar_photo", { p_key: j[0] }).then(function (r) {
      qRun--;
      if (!r.error && r.data) {
        var d = A.parseData(r.data);
        try {
          var bin = atob(d.b64 || ""), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          imgs[j[0]] = URL.createObjectURL(new Blob([arr], { type: d.mime || "image/jpeg" }));
          document.querySelectorAll('.bf-th[data-bfk="' + j[0] + '"]').forEach(function (b) {
            var sh = b.querySelector(".bf-sh"); if (sh) sh.remove();
            if (!b.querySelector("img")) { var im = document.createElement("img"); im.alt = ""; im.src = imgs[j[0]]; b.insertBefore(im, b.firstChild); }
          });
          var v = document.querySelector('.bf-view[data-bfk="' + j[0] + '"] img'); if (v && !v.src) v.src = imgs[j[0]];
        } catch (e) {}
      }
      imgBusy[j[0]] = false;
      pump();
    });
    pump();
  }

  /* ---------- viewer ---------- */
  var view = null;
  function close() { if (view) { view.remove(); view = null; document.removeEventListener("keydown", onKey, true); } }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function openView(key, id) {
    var x = items(id).filter(function (y) { return y.key === key; })[0]; if (!x) return;
    close();
    var el = A.el;
    var img = el("img", { alt: "" }); if (imgs[key]) img.src = imgs[key]; else fetchImg(key, id);
    var who = x.pub ? L("🌍 Delad av en gäst · ", "🌍 Shared by a guest · ") + hm(x.at)
      : "📸 " + (x.is_me ? L("Du", "You") : (x.by || "?")) + (x.group_name ? " · " + x.group_name : "") + " · " + hm(x.at) + (x.kind === "film" ? " · 🎞️" : "");
    var acts = el("div", { class: "bf-acts" });
    var note = el("p", { class: "bf-note muted", text: x.pub ? L("Delad med alla på krogen. Inget namn visas.", "Shared with everyone at this bar. No name shown.")
      : x.shared ? L("🌍 Du delar den med alla på krogen till ", "🌍 Shared with the bar until ") + new Date(x.public_until).toLocaleDateString(sv() ? "sv-SE" : "en-GB", { weekday: "short", day: "numeric", month: "numeric" }) + "."
      : L("🔒 Syns bara för gruppen.", "🔒 Only your group sees this.") });
    if (!x.pub && x.is_me && x.can_share) {
      if (x.shared) acts.appendChild(A.btn(L("🔒 Sluta dela", "🔒 Stop sharing"), "btn-small", function (e) { share(x, id, false, e.target); }));
      else acts.appendChild(A.btn(L("🌍 Dela med alla på krogen", "🌍 Share with everyone at the bar"), "btn-small btn-amber", function () { confirmShare(x, id, acts); }));
    }
    if (x.pub && !x.is_me) acts.appendChild(A.btn(L("🚩 Anmäl / dölj", "🚩 Report / hide"), "btn-small", function () { confirmReport(x, id, acts); }));
    if (x.pub && x.is_me) acts.appendChild(A.btn(L("🔒 Sluta dela", "🔒 Stop sharing"), "btn-small", function (e) { share(x, id, false, e.target); }));
    acts.appendChild(A.btn("✕", "btn-small bf-x", close));
    view = el("div", { class: "bf-view", role: "dialog", "aria-modal": "true", "aria-label": L("Bild", "Photo"), "data-bfk": key }, [
      el("div", { class: "bf-card" }, [el("div", { class: "bf-img" }, [img]), el("div", { class: "bf-who", text: who }), note, acts])]);
    view.addEventListener("click", function (e) { if (e.target === view) close(); });
    document.body.appendChild(view);
    document.addEventListener("keydown", onKey, true);
  }
  function confirmShare(x, id, acts) {
    acts.innerHTML = "";
    var el = A.el;
    acts.appendChild(el("p", { class: "bf-warn", text: L("Alla som öppnar krogen ser bilden i 7 dar – utan ditt namn och utan gruppen. Dela bara om alla på bilden ä okej med dä.",
      "Everyone who opens this bar sees the photo for 7 days – without your name or group. Only share if everyone in it is fine with that.") }));
    acts.appendChild(A.btn(L("🌍 Ja, dela", "🌍 Yes, share"), "btn-small btn-amber", function (e) { share(x, id, true, e.target); }));
    acts.appendChild(A.btn(L("Avbryt", "Cancel"), "btn-small", function () { openView(x.key, id); }));
  }
  function confirmReport(x, id, acts) {
    acts.innerHTML = "";
    [["🙈 " + L("Olämplig", "Inappropriate"), "olamplig"], ["👤 " + L("Jag ä med på bilden", "I'm in this photo"), "jag"], ["🗑️ " + L("Spam / fel krog", "Spam / wrong bar"), "spam"]].forEach(function (r) {
      acts.appendChild(A.btn(r[0], "btn-small", function (e) {
        e.target.disabled = true;
        call("bar_photo_report", { p_key: x.key, p_reason: r[1] }).then(function (res) {
          if (res.error) { A.toast(errText(codeOf(res.error)), { err: true }); e.target.disabled = false; return; }
          A.toast(sv() ? pick("r", T.reported) : "🚩 Thanks – hidden for you.");
          close(); load(id, true);
        });
      }));
    });
    acts.appendChild(A.btn(L("Avbryt", "Cancel"), "btn-small", function () { openView(x.key, id); }));
  }
  function share(x, id, on, b) {
    if (b) b.disabled = true;
    call("bar_photo_share", { p_key: x.key, p_on: on }).then(function (r) {
      if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); if (b) b.disabled = false; return; }
      A.toast(sv() ? pick(on ? "s" : "u", on ? T.shared : T.unshared) : (on ? "🌍 Shared with the bar for 7 days." : "🔒 Private again."));
      close(); load(id, true);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".bf-th") : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openView(b.getAttribute("data-bfk"), b.getAttribute("data-bfb"));
  }, true);

  window.BARFOTO = {
    init: function (api) { A = api; },
    barPopupHTML: function (bar) {
      if (!A || !A.LIVE || off || !bar || bar.id == null || bar.type === "arena") return "";
      var id = String(bar.id);
      setTimeout(function () { load(id, false); }, 0);
      return stripHTML(id);
    },
    // tests
    _cache: cache, _open: openView, _load: load, _openBar: function (bar) { if (A && bar) A.openBar(bar); }
  };
})();
