/* Öl Nu v29 — 💬 EVENTCHATT (CONTRACT "v29 EVENTCHATT", migrations 0084–0085).
   Owner: "When I make an invitation for specific friends, it creates a chat for that event, or a temporary group."
   Every invite (invite.js) gets a temporary group on the server (temp_groups). Nobody is a group member of it, so it never
   shows in Grupper lists, friend lists, pins, duels, leagues, boards or meriter. Chat access comes from the invite:
   creator + ✅ Kommer + 🤔 Kanske can write; invited without an answer (or ❌) can read and join by answering.
   Open until start + 12 h, then "🗄️ Arkiverad" (read-only) for 7 days, then hidden. Cancelled = read-only at once.
   The chat itself is the normal group chat (social.js openChat with g.ev set): text, 📷 photo.js, 🎙️ after.js,
   reactions, push (notify-group "msg"/"voice" → /?chat=<group_id>). System lines (body starts with U+2063) are drawn
   centred by sysLi(). Entry points (no new map buttons): a big "💬 Chatt" button in the invite sheet (inviteBox, called
   by invite.js drawInvite) and a small "📨 Kvällens event" section at the top of Grupper (groupsSheet hook; EVCHAT is
   before INVITE in app.js mods(), so the section lands in the Grupper pane).
   Hooks (app.js mods): init, onAuthed, onPoll, groupsSheet. Called by social.js: chatOpen(g, ctx), sysLi(m), openById(id, fail).
   Called by invite.js: inviteBox(box, invite). A missing RPC (old server, PGRST202) → everything hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, CH = [], at = 0, busy = null;
  var SEEN = "olnu.evSeen", MARK = "⁣";

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  var T = {
    ro: ["🗄️ Arkiverad. Chatten ä stängd för nya meddelanden – men minnena finns kvar ett tag.",
      "🗄️ Arkiverad. Kriget ä över, nu ä dä bara krigshistorier kvar.",
      "🗄️ Arkiverad. Läs gärna, men nu ä dä tyst i leden.",
      "🗄️ Arkiverad. Generalen har stängt mässen."],
    cx: ["🚫 Eventet ä inställt. Chatten ä låst.", "🚫 Inställt. Truppen ä hemförlovad, chatten ä låst.",
      "🚫 Eventet ä inställt. Hä blev int' nå den här gången."],
    join: ["👀 Du ä inbjuden. Svara ✅ eller 🤔 så kan du skriva.", "👀 Du läser som inbjuden. Ett ✅ eller 🤔 så ä du mä i snacket.",
      "👀 Smygläser du? Svara ✅ eller 🤔 å hoppa in i chatten."],
    joined: ["💬 Välkommen in i chatten, soldat!", "💬 Nu ä du mä i snacket. Skriv nåt kul.", "💬 In i leden! Chatten ä din."]
  };

  /* ---------- data ---------- */
  function seenMap() { var o = null; try { o = U.ls.getJSON(SEEN, {}); } catch (e) {} return o && typeof o === "object" ? o : {}; }
  function markSeen(gid, id) {
    if (!gid || !(id > 0)) return;
    var o = seenMap(); if ((o[gid] | 0) >= id) return;
    o[gid] = id;
    // Keep it small: only the chats we still know.
    var keep = {}; CH.forEach(function (c) { if (o[c.group_id]) keep[c.group_id] = o[c.group_id]; }); keep[gid] = id;
    try { U.ls.setJSON(SEEN, keep); } catch (e) {}
    CH.forEach(function (c) { if (c.group_id === gid) c.unread = 0; });
    paintAll();
  }
  function rows() { return CH; }
  function invites() { try { return (window.INVITE && window.INVITE._list && window.INVITE._list()) || []; } catch (e) { return []; } }
  function byGid(id) { id = String(id || "").toLowerCase(); return CH.filter(function (c) { return String(c.group_id).toLowerCase() === id; })[0] || null; }
  function byInv(id) { return CH.filter(function (c) { return String(c.invite_id) === String(id); })[0] || null; }
  function poll(force) {
    if (!A || !A.LIVE || off || !A.authed || !A.authed()) return Promise.resolve(CH);
    if (busy) return busy;
    if (!force && Date.now() - at < 25000) return Promise.resolve(CH);
    if (!force && document.hidden) return Promise.resolve(CH);
    // Quiet users: no event chat known and no invite at all -> no extra call (onAuthed and the sheets force one).
    if (!force && !CH.length && !invites().length) return Promise.resolve(CH);
    at = Date.now();
    busy = A.rpc("my_event_chats", { p_seen: seenMap() }).then(function (r) {
      busy = null;
      if (r.error) { if (U.missing(r.error)) { off = true; paintAll(); } return CH; }
      var d = A.parseData(r.data);
      CH = (d.chats || []).filter(function (c) { return c && c.group_id; });
      paintAll();
      return CH;
    }, function () { busy = null; return CH; });
    return busy;
  }

  /* ---------- time texts ---------- */
  var TZ = "Europe/Stockholm";
  function hhmm(iso) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } }
  function day(iso) {
    try {
      var f = function (t) { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t - 5 * 3600e3)); };
      var a = f(Date.parse(iso)), b = f(Date.now()), dd = Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
      if (dd === 0) return L("ikväll", "tonight");
      if (dd === 1) return L("i morgon", "tomorrow");
      if (dd === -1) return L("i går", "yesterday");
      return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" }).format(new Date(iso));
    } catch (e) { return ""; }
  }
  function until(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return L("nu", "now");
    if (m < 60) return m + " min";
    if (m < 1440) return Math.max(1, Math.floor(m / 60)) + L(" tim", " h");
    var d = Math.floor(m / 1440); return d + (sv() ? (d === 1 ? " dag" : " dagar") : (d === 1 ? " day" : " days"));
  }
  function state(c) {
    if (!c) return "none";
    if (c.state === "cancelled") return "cancelled";
    if (c.state === "archived" || Date.now() >= Date.parse(c.open_until)) return "archived";
    return "open";
  }
  function canWrite(c) { return !!c && state(c) === "open" && !!c.can_write; }
  function statusText(c) {
    var s = state(c);
    if (s === "cancelled") return L("🚫 Inställt", "🚫 Cancelled");
    if (s === "archived") return L("🗄️ Arkiverad", "🗄️ Archived");
    var dt = Date.parse(c.starts_at) - Date.now();
    return dt > 0 ? L("⏳ om ", "⏳ in ") + until(dt) : L("🍻 pågår nu", "🍻 on now");
  }
  function whenLine(c) { return day(c.starts_at) + " " + hhmm(c.starts_at); }

  /* ---------- open the chat (normal group chat) ---------- */
  function open(c) {
    if (!c || !window.SOCIAL || !window.SOCIAL.openChat) return false;
    window.SOCIAL.openChat({ id: c.group_id, name: c.title || c.name, ev: c });
    return true;
  }
  function openById(id, fail) {
    var go = function () { var c = byGid(id); if (c && state(c) !== "none") open(c); else if (fail) fail(); };
    if (byGid(id)) { go(); poll(true); return; }
    poll(true).then(go);
  }
  function openInvite(id) { try { if (window.INVITE && window.INVITE.open) window.INVITE.open(id); } catch (e) {} }

  function answer(c, a, btn) {
    if (btn) btn.disabled = true;
    A.rpc("invite_answer", { p_id: +c.invite_id, p_answer: a }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { A.toast(L("Hä gick int'. Försök igen.", "That failed. Try again."), { err: true }); return; }
      var d = A.parseData(r.data);
      try { if (d.push_yes && A.PUSH_ON && A.invoke) A.invoke("notify-group", { event: "invite_yes", invite_id: +c.invite_id }); } catch (e) {}
      try { window.FX.vibrate([20, 40, 20]); } catch (e) {}
      try { if (window.INVITE && window.INVITE._poll) window.INVITE._poll(true); } catch (e) {}
      A.toast(sv() ? pick("joined", T.joined) : "💬 You're in the chat!", { cls: "skal" });
      poll(true).then(function () { var n = byInv(c.invite_id); if (n) open(n); });
    });
  }

  /* ---------- social.js: inside the chat sheet ---------- */
  function chatOpen(g, ctx) {
    if (!g || !g.ev || !ctx || !ctx.list) return;
    var c = byGid(g.id) || g.ev, list = ctx.list, el = A.el;
    var head = el("div", { class: "evc-head" });
    var line = el("div", { class: "evc-line" }, [el("b", { text: whenLine(c) }), el("span", { class: "evc-st", text: statusText(c) })]);
    head.appendChild(line);
    var acts = el("div", { class: "evc-acts" });
    acts.appendChild(A.btn(L("📨 Inbjudan", "📨 Invite"), "btn-small", function () { openInvite(c.invite_id); }));
    acts.appendChild(el("span", { class: "evc-n muted", text: "✅ " + (c.members | 0) + " · 📨 " + (c.invited | 0) }));
    head.appendChild(acts);
    list.parentNode.insertBefore(head, list);
    var lock = el("div", { class: "evc-lock", hidden: "" });
    if (ctx.input && ctx.input.parentNode) ctx.input.parentNode.insertBefore(lock, ctx.input.nextSibling);
    var done = false;
    function show(x, on) { if (x) x.style.display = on ? "" : "none"; }
    function paint() {
      c = byGid(g.id) || c;
      line.lastChild.textContent = statusText(c);
      if (canWrite(c)) { lock.hidden = true; show(ctx.input, true); show(ctx.note, true); return; }
      show(ctx.input, false); show(ctx.note, false);
      lock.hidden = false;
      var s = state(c), key = s + ":" + (c.my_answer || "");
      if (lock.getAttribute("data-k") === key) return;
      lock.setAttribute("data-k", key); lock.innerHTML = "";
      if (s === "open") {
        lock.appendChild(el("p", { class: "evc-lock-t", text: sv() ? pick("join", T.join) : "👀 You are invited. Answer ✅ or 🤔 to write." }));
        lock.appendChild(el("div", { class: "row evc-join" }, [
          A.btn(L("✅ Kommer", "✅ Coming"), "btn-amber", function (ev) { answer(c, "yes", ev.currentTarget); }),
          A.btn(L("🤔 Kanske", "🤔 Maybe"), "btn", function (ev) { answer(c, "maybe", ev.currentTarget); })]));
      } else {
        var left = Date.parse(c.hide_at) - Date.now();
        lock.appendChild(el("p", { class: "evc-lock-t", text: (s === "cancelled" ? (sv() ? pick("cx", T.cx) : "🚫 The event is cancelled. The chat is locked.") : (sv() ? pick("ro", T.ro) : "🗄️ Archived. The chat is read-only.")) }));
        if (left > 0) lock.appendChild(el("p", { class: "muted evc-lock-s", text: L("Försvinner ur listan om ", "Leaves the list in ") + until(left) + "." }));
      }
    }
    paint();
    function maxId() {
      var m = 0;
      list.querySelectorAll("[data-mid]").forEach(function (x) { var v = +x.getAttribute("data-mid"); if (v > m) m = v; });
      return m;
    }
    var tm = setInterval(function () {
      if (done) return;
      if (!(ctx.alive ? ctx.alive() : document.body.contains(list))) { done = true; clearInterval(tm); return; }
      markSeen(c.group_id, maxId());
      paint();
    }, 3000);
    setTimeout(function () { markSeen(c.group_id, Math.max(maxId(), c.last_id | 0)); }, 1500);
  }
  // A system line ("📨 TuNe skapade eventet") instead of a normal chat row.
  function sysLi(m) {
    var b = String(m && m.body || "");
    if (b.charAt(0) !== MARK) return null;
    return A.el("li", { class: "evc-sys", "data-at": String(m.created_at || ""), "data-mid": String(m.id) }, [
      A.el("span", { text: b.slice(1).replace(/⁣/g, "") }),
      A.el("span", { class: "evc-sys-t", text: U.timeHM ? U.timeHM(m.created_at) : "" })]);
  }

  /* ---------- invite.js: big "💬 Chatt" button in the invite sheet ---------- */
  function badge(n) { return n > 0 ? '<span class="evc-badge" aria-label="' + n + L(" nya", " new") + '">' + (n > 9 ? "9+" : n) + "</span>" : ""; }
  function inviteBox(box, j) {
    if (off || !j || !j.id || !box) return;
    var wrap = A.el("div", { class: "evc-inv", "data-inv": String(j.id) });
    box.appendChild(wrap);
    paintInv(wrap);
    poll(true);   // answers / adds change the access: always refresh (the invite sheet redraws after each)
  }
  function paintInv(wrap) {
    var c = byInv(wrap.getAttribute("data-inv"));
    wrap.innerHTML = "";
    if (!c) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var s = state(c);
    var b = A.el("button", { type: "button", class: "btn btn-block evc-big" + (s === "open" ? " btn-amber" : ""),
      html: U.esc(L("💬 Chatt", "💬 Chat")) + badge(c.unread | 0) +
        '<small class="evc-big-s">' + U.esc(s === "open" ? (c.can_write ? L("Snacka mä truppen", "Talk to the crew") : L("Läs mä – svara för att skriva", "Read along – answer to write")) : statusText(c)) + "</small>" });
    b.addEventListener("click", function () { open(c); });
    wrap.appendChild(b);
  }

  /* ---------- Grupper: "📨 Kvällens event" ---------- */
  function groupsSheet(body) {
    if (!A || !A.LIVE || off) return;
    var sec = A.el("section", { class: "evc-sec", hidden: "" });
    var h3 = body.querySelector("h3");
    if (h3) body.insertBefore(sec, h3); else body.insertBefore(sec, body.firstChild);
    paintSec(sec);
    poll(true);
  }
  function paintSec(sec) {
    var list = CH.filter(function (c) { return state(c) !== "none"; });
    var openOnes = list.filter(function (c) { return state(c) === "open"; }).sort(function (a, b) { return Date.parse(a.starts_at) - Date.parse(b.starts_at); });
    var old = list.filter(function (c) { return state(c) !== "open"; }).slice(0, 3);
    sec.innerHTML = "";
    if (!openOnes.length && !old.length) { sec.hidden = true; return; }
    sec.hidden = false;
    sec.appendChild(A.el("h3", { class: "evc-h", text: L("📨 Kvällens event", "📨 Tonight's events") }));
    var ul = A.el("ul", { class: "evc-list" });
    openOnes.concat(old).forEach(function (c) {
      var s = state(c), n = c.unread | 0;
      var li = A.el("li", { class: "evc-row" + (s !== "open" ? " evc-old" : ""), role: "button", tabindex: "0", "aria-label": c.title + ", " + statusText(c) + (n ? ", " + n + L(" nya", " new") : "") }, [
        A.el("span", { class: "evc-row-i", "aria-hidden": "true", text: "💬" }),
        A.el("span", { class: "evc-row-t" }, [A.el("b", { text: c.title }), A.el("small", { text: whenLine(c) + " · " + statusText(c) + (s === "open" ? " · ✅ " + (c.members | 0) : "") })]),
        A.el("span", { class: "evc-row-v", html: badge(n) + '<span class="ds-chev" aria-hidden="true"></span>' })
      ]);
      var go = function () { open(c); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      ul.appendChild(li);
    });
    sec.appendChild(ul);
  }
  function paintAll() {
    document.querySelectorAll(".evc-sec").forEach(paintSec);
    document.querySelectorAll(".evc-inv").forEach(paintInv);
  }

  window.EVCHAT = {
    T: T, open: open, openById: openById, chatOpen: chatOpen, sysLi: sysLi, inviteBox: inviteBox, list: rows,
    byInvite: byInv, _poll: poll, _state: state,
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(false); });
      setInterval(function () { if (document.querySelector(".evc-sec:not([hidden]), .evc-inv")) poll(false); }, 30000);
    },
    onAuthed: function () { poll(true); },
    onPoll: function () { poll(false); },
    groupsSheet: function (body) { groupsSheet(body); }
  };
})();
