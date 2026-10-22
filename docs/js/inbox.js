/* Öl Nu — 🔔 INKORG (social2; migration 0124 my_inbox). Discord "Notifications" pattern: everything that waits for
   ME in one list, with the answer buttons right in the row:
     🤝 friend requests · 📨 event invites (✅ / 🤔 / ❌) · ✅ RSVPs to my events · 📸 lägesrapport to answer ·
     🪖 call-outs (✅ Kommer / ❌) · ⚔️ duel challenges (Anta / Nej) · 👥 a group link I opened but did not join yet.
   Entry point (no new map button): a third tab "🔔 Inkorg" in the bottom Grupper sheet (next to Grupper | Vänner)
   and a small red count on the EXISTING Grupper button (#btn-groups). Opening the tab marks everything as seen;
   seen rows stay but fade (Discord: "read items fade, no clearing").
   The buttons use each module's own path where it exists (INVITE.open(id, answer), RALLY.openLink(id, "yes"),
   CHIEF.openStatusLink(id)), so pushes, toasts and ETA chips stay exactly as before.
   Hooks (app.js mods, after INVITE): init, onAuthed, onPoll, groupsSheet, applyText.
   Public: INBOX.open(), INBOX.count(), INBOX.refresh(). Missing RPC (old server) → tab and badge hide. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, openSeen = null, items = [], loadedAt = 0, busy = null, wantTab = false, pane = null, srvSkew = 0;
  var SEEN = "olnu.ibSeen", TAB = "olnu.ibTab", POLL_MS = 60000, OPEN_MS = 20000;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 864e5);
    if (day === 0) return L("ikväll ", "tonight ") + hm;
    if (day === 1) return L("i morgon ", "tomorrow ") + hm;
    var wd = sv() ? ["sön", "mån", "tis", "ons", "tors", "fre", "lör"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return wd[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1) + " " + hm;
  }
  function ago(iso) {
    var m = Math.round((Date.now() - srvSkew - Date.parse(iso)) / 60000);
    if (!isFinite(m)) return "";
    if (m < 1) return L("nyss", "just now");
    if (m < 60) return m + " min";
    if (m < 24 * 60) return Math.round(m / 60) + L(" tim", " h");
    return Math.round(m / 1440) + L(" d", " d");
  }

  /* ---------- texts ---------- */
  var EMPTY = [["📭 Inget som väntar. Lugnt i leden.", "📭 Nothing waiting. All quiet."], ["📭 Tom inkorg. Ingen behöver dig – just nu.", "📭 Empty. Nobody needs you – right now."],
    ["📭 Inga order från högkvarteret.", "📭 No orders from HQ."], ["📭 Postlådan ä tom. Gå ut och skapa nåt!", "📭 The mailbox is empty. Go make something happen!"]];
  var HEAD = [["Allt som väntar på dig. Svara direkt här.", "Everything waiting for you. Answer right here."], ["Order, förfrågningar och inkallelser – på ett ställe.", "Orders, requests and call-outs – in one place."]];
  function P(a) { var x = pick(a[0][0], a); return sv() ? x[0] : x[1]; }

  /* ---------- data ---------- */
  function seenAt() { return +ls(SEEN, "0") || 0; }
  function localItems() {
    var out = [];
    var c = (U.cleanCode ? U.cleanCode(ls("olnu.jn.pending", "")) : "");
    if (c && c.length === 6 && ls("olnu.jn.done", "") !== c) {
      var at = +ls("olnu.jn.pendingAt", "0"); if (!at) { at = Date.now(); lsSet("olnu.jn.pendingAt", String(at)); }
      out.push({ k: "join:" + c, type: "join", code: c, at: new Date(at + srvSkew).toISOString(), local: true });
    }
    return out;
  }
  function all() { return localItems().concat(items); }
  function unseen() { var s = seenAt(); return all().filter(function (x) { return (Date.parse(x.at) || 0) - srvSkew > s; }).length; }
  function load(force) {
    if (off || !A || !A.LIVE || !A.authed || !A.authed()) return Promise.resolve();
    var gap = pane && document.body.contains(pane) && !pane.hidden ? OPEN_MS : POLL_MS;
    if (!force && Date.now() - loadedAt < gap) return Promise.resolve();
    if (busy) return busy;
    loadedAt = Date.now();
    busy = A.rpc("my_inbox").then(function (r) {
      busy = null;
      if (r.error) { if (U.missing && U.missing(r.error)) { off = true; paintBadge(); hideTab(); } return; }
      var d = A.parseData(r.data) || {};
      if (d.now) srvSkew = Date.parse(d.now) - Date.now();
      items = Array.isArray(d.items) ? d.items : [];
      paintBadge();
      if (pane && document.body.contains(pane) && !pane.hidden) render(pane, false);
    });
    return busy;
  }

  /* ---------- badge on the existing Grupper button + the tab ---------- */
  function paintBadge() {
    var n = off ? 0 : unseen();
    var b = document.getElementById("btn-groups");
    var nb = n; try { if (window.DM && window.DM.unread) nb += window.DM.unread() | 0; } catch (e) {}   // 💬 unread DMs join the count
    if (b) {
      var s = document.getElementById("ib-badge");
      if (!s) { s = h("span", { id: "ib-badge", class: "ib-badge", "aria-hidden": "true" }); b.appendChild(s); }
      s.textContent = nb > 9 ? "9+" : String(nb); s.hidden = !nb;
      b.classList.toggle("ib-has", !!nb);
      if (nb) b.setAttribute("data-ib", String(nb)); else b.removeAttribute("data-ib");
    }
    document.querySelectorAll(".ib-tabn").forEach(function (x) { x.textContent = n ? String(n > 9 ? "9+" : n) : ""; x.hidden = !n; });
  }
  function hideTab() { document.querySelectorAll(".ib-tab").forEach(function (x) { x.hidden = true; }); }

  /* ---------- rows ---------- */
  function row(x, old) {
    var li = h("li", { class: "ib-item ib-" + x.type + (old ? " ib-old" : ""), "data-k": x.k });
    var ico = "", title = "", sub = "", acts = [], tap = null;
    var name = x.name || x.from || "?";
    function act(label, cls, fn) { return h("button", { type: "button", class: "btn btn-small ib-b " + (cls || ""), text: label, onclick: function (e) { e.stopPropagation(); fn(e.currentTarget); } }); }
    if (x.type === "friend") {
      ico = "🤝"; title = L(name + " vill bli din vän", name + " wants to be your friend");
      sub = x.home_town && window.HOMETOWN && window.HOMETOWN.label ? window.HOMETOWN.label(x.home_town) : L("Vänförfrågan", "Friend request");
      acts = [act(L("✅ Ja", "✅ Yes"), "btn-green", function (b) { friend(x, true, b); }), act("✕", "ib-x", function (b) { friend(x, false, b); })];
    } else if (x.type === "inv") {
      ico = "📨"; title = x.title || L("Inbjudan", "Invite");
      sub = (x.from ? L("Från ", "From ") + x.from + " · " : "") + when(x.starts_at) + (x.place ? " · " + x.place : "");
      tap = function () { openInv(x.id); };
      acts = [act(L("✅ Kommer", "✅ Going"), "btn-green", function () { openInv(x.id, "yes"); }), act("🤔", "", function () { openInv(x.id, "maybe"); }),
        act("❌", "ib-x", function () { openInv(x.id, "no"); })];
    } else if (x.type === "rsvp") {
      ico = x.answer === "yes" ? "✅" : "🤔";
      title = x.answer === "yes" ? L(name + " kommer!", name + " is coming!") : L(name + " kanske kommer", name + " might come");
      sub = (x.title || "") + " · " + when(x.starts_at);
      tap = function () { openInv(x.id); };
    } else if (x.type === "status") {
      ico = "📸"; title = L("Lägesrapport! " + (x.from || L("Chefen", "The chief")) + " vill se läget", "Status report! " + (x.from || "The chief") + " wants a photo");
      sub = (x.group_name || "") + " · " + L("svara mä ett foto", "answer with a photo");
      acts = [act(L("📸 Svara", "📸 Answer"), "btn-amber", function () { if (window.CHIEF && window.CHIEF.openStatusLink) window.CHIEF.openStatusLink(x.id); })];
    } else if (x.type === "rally") {
      ico = "🪖"; title = (x.name || "?") + ": " + (x.body || L("Kom hit!", "Come here!"));
      sub = (x.group_name || "") + (x.place ? " · 📍 " + x.place : "") + (x.yes ? " · " + L(x.yes + " på väg", x.yes + " on the way") : "");
      tap = function () { if (window.RALLY && window.RALLY.openLink) window.RALLY.openLink(x.id); };
      acts = [act(L("✅ Kommer", "✅ Coming"), "btn-green", function () { if (window.RALLY && window.RALLY.openLink) window.RALLY.openLink(x.id, "yes"); else rally(x, "yes"); }),
        act("❌", "ib-x", function (b) { rally(x, "no", b); })];
    } else if (x.type === "duel") {
      ico = "⚔️"; title = L((x.opp || "?") + " utmanar " + (x.group_name || "er") + "!", (x.opp || "?") + " challenges " + (x.group_name || "you") + "!");
      sub = L("Flest drinkar till kl 05 vinner", "Most drinks by 05:00 wins");
      acts = [act(L("⚔️ Anta", "⚔️ Accept"), "btn-amber", function (b) { duel(x, true, b); }), act(L("Nej", "No"), "ib-x", function (b) { duel(x, false, b); })];
    } else if (x.type === "join") {
      ico = "👥"; title = L("Du blev inbjuden till en grupp", "You were invited to a group");
      sub = L("Kod ", "Code ") + x.code;
      acts = [act(L("✅ Gå med", "✅ Join"), "btn-green", function (b) { joinCode(x, b); })];
    }
    var main = h("div", { class: "ib-main" }, [h("b", { class: "ib-t", text: title }), h("small", { class: "ib-s muted", text: sub })]);
    li.appendChild(h("span", { class: "ib-ico", "aria-hidden": "true", text: ico }));
    li.appendChild(main);
    li.appendChild(h("small", { class: "ib-ago muted", text: ago(x.at) }));
    if (acts.length) li.appendChild(h("div", { class: "ib-acts" }, acts));
    if (tap) { main.setAttribute("role", "button"); main.setAttribute("tabindex", "0"); main.addEventListener("click", tap); main.addEventListener("keydown", function (e) { if (e.key === "Enter") tap(); }); }
    return li;
  }
  function gone(x) { items = items.filter(function (y) { return y.k !== x.k; }); paintBadge(); if (pane) render(pane, false); setTimeout(function () { load(true); }, 1500); }
  function err(r) { A.toast(A.errMsg ? A.errMsg(r.error) : L("Dä gick int'. Försök igen.", "That failed. Try again."), { err: true }); }
  function friend(x, yes, b) {
    b.disabled = true;
    A.rpc("friend_answer", { p_id: +x.id, p_accept: !!yes, p_name: A.getName ? A.getName() || null : null }).then(function (r) {
      if (r.error) { b.disabled = false; err(r); return; }
      A.toast(yes ? L(pick("fy", ["🤝 Nu ä ni vänner, " + (x.name || "") + " och du!", "🤝 Vänskap bekräftad. Skål på't!", "🤝 Ny kamrat i leden!"]), "🤝 You are friends now!") : L("Okej, nej tack.", "Okay, declined."), { id: "ib" });
      gone(x);
    });
  }
  function openInv(id, ans) { if (window.INVITE && window.INVITE.open) { window.INVITE.open(id, ans); setTimeout(function () { load(true); }, 2500); } }
  function rally(x, ans, b) {
    if (b) b.disabled = true;
    A.rpc("answer_rally", { p_rally_id: +x.id, p_answer: ans }).then(function (r) {
      if (r.error) { if (b) b.disabled = false; err(r); return; }
      if (ans === "yes") A.invoke("notify-group", { event: "rally_yes", rally_id: +x.id });
      gone(x);
    });
  }
  function duel(x, yes, b) {
    b.disabled = true;
    A.rpc("duel_answer", { p_duel_id: +x.id, p_accept: !!yes }).then(function (r) {
      if (r.error) { b.disabled = false; err(r); return; }
      A.toast(yes ? L(pick("dy", ["⚔️ Duellen ä igång! Drick för gruppens ära.", "⚔️ Utmaningen antagen. Nu kör vi!", "⚔️ Krig! Varje öl räknas till kl 05."]), "⚔️ The duel is on!") : L("Duellen avböjd.", "Duel declined."), { id: "ib" });
      gone(x);
    });
  }
  function joinCode(x, b) {
    b.disabled = true;
    A.withName(function () {
      A.rpc("join_group", { p_code: x.code, p_display_name: A.getName() }).then(function (r) {
        b.disabled = false;
        if (r.error) { lsSet("olnu.jn.pending", null); err(r); render(pane, false); return; }
        var g = A.parseData(r.data) || {};
        lsSet("olnu.jn.done", x.code); lsSet("olnu.jn.pending", null);
        A.toast(L("✅ Du ä med i " + (g.name || "gruppen") + "!", "✅ You're in " + (g.name || "the group") + "!"), { id: "ib" });
        try { A.refresh(); } catch (e) {}
        A.showGroups();
      });
    });
  }

  function render(box, markSeen) {
    var before = openSeen != null ? openSeen : seenAt();   // rows seen before this opening fade
    box.innerHTML = "";
    var list = all().slice().sort(function (a, b) { return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0); });
    box.appendChild(h("p", { class: "ib-head muted", text: P(HEAD) }));
    if (!list.length) { box.appendChild(h("p", { class: "ib-empty", text: P(EMPTY) })); }
    else {
      var ul = h("ul", { class: "ib-list" });
      list.forEach(function (x) { ul.appendChild(row(x, (Date.parse(x.at) || 0) - srvSkew <= before)); });
      box.appendChild(ul);
    }
    if (markSeen) {
      var mx = 0; list.forEach(function (x) { mx = Math.max(mx, (Date.parse(x.at) || 0) - srvSkew); });
      lsSet(SEEN, String(Math.max(before, mx, Date.now() - 1000)));
      paintBadge();
    }
  }

  /* ---------- the tab (inside INVITE's Grupper | Vänner sheet) ---------- */
  function groupsSheet(body) {
    if (off || !A || !A.LIVE) return;
    var bar = body.querySelector(".inv-tabs");
    if (!bar) return;
    pane = h("div", { class: "inv-pane ib-pane", id: "inv-pane-i", role: "tabpanel", hidden: true });
    var n = h("span", { class: "ib-tabn", hidden: true });
    var tab = h("button", { type: "button", role: "tab", class: "ib-tab", "data-t": "i", "aria-controls": "inv-pane-i", "aria-selected": "false" }, [L("🔔 Inkorg", "🔔 Inbox"), n]);
    function others() { return [].slice.call(body.querySelectorAll(".inv-pane")).filter(function (p) { return p !== pane; }); }
    function show() {
      others().forEach(function (p) { p.hidden = true; });
      pane.hidden = false;
      openSeen = seenAt();
      [].slice.call(bar.querySelectorAll("button")).forEach(function (b) { b.setAttribute("aria-selected", String(b === tab)); });
      lsSet(TAB, "1");
      render(pane, true);
      load(true).then(function () { if (!pane.hidden) render(pane, true); });
    }
    tab.addEventListener("click", show);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b && b !== tab && bar.contains(b)) { pane.hidden = true; tab.setAttribute("aria-selected", "false"); lsSet(TAB, "0"); }
    }, true);
    bar.appendChild(tab);
    bar.classList.add("ib-3");
    body.appendChild(pane);
    paintBadge();
    if (wantTab || ls(TAB, "0") === "1") { wantTab = false; show(); }
  }
  function open() {
    if (!A || !A.LIVE || !A.showGroups) return false;
    wantTab = true; A.showGroups(); return true;
  }

  window.INBOX = {
    init: function (api) {
      A = api;
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
    },
    onAuthed: function () { load(true); },
    onPoll: function () { load(false); },
    groupsSheet: function (body) { try { groupsSheet(body); } catch (e) { try { console.warn("olnu inbox", e); } catch (x) {} } },
    applyText: function () { paintBadge(); },
    open: open, paint: paintBadge, count: function () { return off ? 0 : unseen(); }, refresh: function () { return load(true); },
    _items: function () { return all(); }
  };
})();
