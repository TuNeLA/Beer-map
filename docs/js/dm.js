/* Öl Nu — 💬 MEDDELANDEN (1:1 private chats; CONTRACT "💬 MEDDELANDEN", migrations 0136–0138).
   Owner: "Can I PM a friend?" A DM is a hidden 2-person group on the server (like the event chats): nobody is a
   group member, so it never shows as a group, in pickers, duels, squad, meriter or friend lists. The chat itself is
   the normal group chat (social.js openChat with g.dm set): text, 📷 photo.js, 🎙️ after.js, 🍻 reactions.
   Only friends (accepted friend or a shared group) can be messaged. 🚫 Blockera stops messages both ways.
   Pattern (Instagram / Messenger "simple"): a thread list, last message + time + unread dot, "Sett" under MY last
   message when the other has seen it. No typing dots (they cost a poll per second; not worth it here).
   Entry points (no new map buttons):
     · 💬 on every row of the Vänner list (invite.js friendsMore → DM.friendBtn)
     · "💬 Skriv" in the member panel (social.js showStatus → DM.memberPanel)
     · "💬 Skriv till X" in a friend's map pin popup (beerPopupHTML hook)
     · "💬 Meddelanden" box at the top of the Vänner tab (groupsSheet hook); unread joins the red count on the
       existing Grupper button (inbox.js paintBadge adds DM.unread()) and a small count on the Vänner tab.
   Push: the chat sends notify-group {event:"msg", group_id}; the function sees a DM and sends "💬 Anton: text…"
   (url /?chat=<group_id> → social.js openChatLink → DM.openById). 📷 photos in a DM send the same event.
   Hooks (app.js mods, after SUGGEST): init, onAuthed, onPoll, groupsSheet, beerPopupHTML, applyText.
   Public: DM.open(t), DM.openWith(params, name), DM.openById(id, fail), DM.unread(), DM.friendBtn(p),
   DM.memberPanel(g, m, panel, openU), DM.chatOpen(g, ctx) (social.js). Missing RPC (old server) → all hides. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, TH = [], total = 0, at = 0, busy = null, first = true, openGid = null, onState = null, blkN = 0;
  var TOAST = "olnu.dmToast", POLL_MS = 30000, PANE_MS = 12000;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
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
  function myName() { try { return (A.getName && A.getName()) || null; } catch (e) { return null; } }
  function codeOf(err) { try { return U.errCode(err); } catch (e) { return ""; } }
  function missing(err) { try { return U.missing(err); } catch (e) { return false; } }
  function hm(iso) { try { return U.timeHM(iso); } catch (e) { return ""; } }
  function ago(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return L("nyss", "now");
    if (m < 60) return m + " min";
    if (m < 24 * 60 && new Date(t).getDate() === new Date().getDate()) return hm(iso);
    if (m < 48 * 60) return L("i går", "yesterday");
    var wd = sv() ? ["sön", "mån", "tis", "ons", "tors", "fre", "lör"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return wd[new Date(t).getDay()];
  }

  /* ---------- texts (dalmål + spec-ops, many variants) ---------- */
  var T = {
    empty: ["👋 Säg hej till {namn}! Bara ni två ser dä här.", "📡 Säker linje till {namn} uppkopplad. Skriv nåt.",
      "🤫 Hemlig kanal mä {namn}. Ingen annan i truppen ser nåt.", "✉️ Tomt än så länge. Skicka en bärs-inbjudan till {namn}?",
      "🪖 Privat radio till {namn}. Över.", "👀 Ingen har sagt nå än. Bryt tystnaden, soldat!"],
    note: ["🔒 Bara ni två ser chatten. Sparas i 7 dagar.", "🔒 Privat linje. Försvinner efter 7 dagar.",
      "🔒 Ingen annan ser dä här. Meddelanden lever i 7 dagar."],
    // fixS T-23: the blocked side sees exactly what happened (the chat is closed), no "just nu" that promises it opens again
    blockedMe: ["Chatten är stängd. Du kan inte skriva till {namn} här."],
    notFriends: ["Ni är inte vänner längre, så chatten är stängd.", "Ingen gemensam grupp eller vänskap längre. Du kan bara läsa."],
    // fixS T-01/T-23: plain copy (sv-neutral), the same facts on both sides. "Blockera" = the full block (block_user):
    // vänskapen tas bort, ingen pin, inget "ute nu", ingen chatt. "Stäng bara chatten" = the old DM-only block (dm_block).
    iBlocked: ["Du har blockerat {namn}. Ingen av er kan skriva här."],
    iClosed: ["Du har stängt chatten med {namn}. Ingen av er kan skriva här."],
    blockQ: ["Blockera {namn}?"],
    blockLi: ["Ni ser inte varandra på kartan, i Vänner eller i chattar.", "Vänskapen tas bort. Ni kan inte skriva till varandra.",
      "{namn} får ingen notis. Hen ser bara att chatten är stängd.", "Ångra under Inställningar → Blockerade."],
    blocked: ["{namn} är blockerad."],
    closed: ["Chatten med {namn} är stängd."],
    unblocked: ["{namn} är inte blockerad längre. Vänskapen kommer inte tillbaka av sig själv."],
    reopened: ["Chatten med {namn} är öppen igen."],
    muted: ["Notiser av för {namn}."],
    unmuted: ["Notiser på för {namn}."],
    toast: ["💬 {namn}: {text}", "💬 Nytt från {namn}: {text}", "📨 {namn} skriver: {text}", "📡 Privat från {namn}: {text}"],
    notFriend: ["Ni måste va vänner eller i samma grupp för att skriva.", "Bara vänner och gruppkompisar kan få meddelanden."],
    fail: ["Hä gick int'. Försök igen.", "Signalen bröts. Försök igen."]
  };
  function P(key, o) { return fill(pick(key, T[key]), o || {}); }
  // fixS: the block / safety lines are plain Swedish on purpose (no dialect: they must say exactly what happens)
  function DV(key, def, o) { return fill(def, o || {}); }

  /* ---------- data ---------- */
  function rpc(name, params) {
    if (!A || !A.rpc) return Promise.resolve({ error: { message: "no_api" } });
    return A.rpc(name, params).then(function (r) {
      if (r && r.error && missing(r.error)) { off = true; paintAll(); }
      return r || {};
    });
  }
  function byGid(id) { id = String(id || "").toLowerCase(); return TH.filter(function (t) { return String(t.group_id).toLowerCase() === id; })[0] || null; }
  function paneOpen() { var p = document.getElementById("inv-pane-f"); return !!(p && !p.hidden && document.body.contains(p)); }
  function poll(force) {
    if (!A || !A.LIVE || off || !A.authed || !A.authed()) return Promise.resolve(TH);
    if (busy) return busy;
    if (!force && Date.now() - at < (paneOpen() ? PANE_MS : POLL_MS)) return Promise.resolve(TH);
    if (!force && document.hidden) return Promise.resolve(TH);
    at = Date.now();
    busy = rpc("my_dms").then(function (r) {
      busy = null;
      if (r.error) return TH;
      var d = A.parseData(r.data) || {};
      TH = (Array.isArray(d.threads) ? d.threads : []).filter(function (t) { return t && t.group_id; });
      if (openGid) TH.forEach(function (t) { if (String(t.group_id) === String(openGid)) t.unread = 0; });
      total = TH.reduce(function (s, t) { return s + (t.unread | 0); }, 0);
      notify();
      first = false;
      paintAll();
      return TH;
    }, function () { busy = null; return TH; });
    return busy;
  }
  // A toast once per new incoming message while the chat is not open (never on the first poll, never old ones).
  function notify() {
    var seen = {}; try { seen = U.ls.getJSON(TOAST, {}) || {}; } catch (e) {}
    var changed = false;
    TH.forEach(function (t) {
      if (!t.last_id || t.last_me || !(t.unread > 0) || String(t.group_id) === String(openGid)) return;
      if ((seen[t.group_id] | 0) >= t.last_id) return;
      seen[t.group_id] = t.last_id; changed = true;
      if (first || Date.now() - Date.parse(t.last_at) > 10 * 60000) return;
      var text = String(t.last_body || "").slice(0, 60);
      A.toast(P("toast", { namn: t.name || "?", text: text }), { id: "dm-" + t.group_id, ms: 6000,
        action: { label: L("Svara", "Reply"), fn: function () { open(t); } } });
    });
    if (changed) { var keep = {}; TH.forEach(function (t) { if (seen[t.group_id]) keep[t.group_id] = seen[t.group_id]; }); try { U.ls.setJSON(TOAST, keep); } catch (e) {} }
  }

  /* ---------- open ---------- */
  function open(t) {
    if (!t || !t.group_id || !window.SOCIAL || !window.SOCIAL.openChat) return false;
    window.SOCIAL.openChat({ id: t.group_id, name: t.name || "?", dm: t });
    return true;
  }
  function errText(c) {
    if (c === "not_friends" || c === "invalid_target") return pick("notFriend", T.notFriend);
    if (c === "blocked") return L("Blockerad. Ni kan inte skriva till varandra.", "Blocked. You cannot message each other.");
    if (c === "slow_down") return L("Lugn i stormen! Vänta en stund.", "Slow down a bit.");
    return pick("fail", T.fail);
  }
  function openWith(params, name, btn) {
    if (off || !A) return;
    if (btn) btn.disabled = true;
    var p = {}; Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    p.p_name = myName();
    var go = function () {
      rpc("dm_open", p).then(function (r) {
        if (btn) btn.disabled = false;
        if (r.error) { A.toast(off ? L("Meddelanden finns int' på servern än.", "Messages are not on the server yet.") : errText(codeOf(r.error)), { err: true }); return; }
        var t = A.parseData(r.data);
        if (!t || !t.group_id) { A.toast(pick("fail", T.fail), { err: true }); return; }
        var have = byGid(t.group_id);
        if (have) Object.keys(t).forEach(function (k) { have[k] = t[k]; }); else TH.unshift(t);
        open(have || t);
      });
    };
    if (A.withName) A.withName(go); else go();
  }
  function openById(id, fail) {
    var go = function () {
      var t = byGid(id);
      if (t) { open(t); return; }
      if (off) { if (fail) fail(); return; }
      rpc("dm_seen", { p_group_id: id, p_last_id: 0 }).then(function (r) {
        var d = r.error ? null : A.parseData(r.data);
        if (d && d.group_id) open(d); else if (fail) fail();
      });
    };
    if (byGid(id)) go(); else poll(true).then(go);
  }

  /* ---------- entry points ---------- */
  function friendBtn(p) {
    if (off || !A || !A.LIVE || !p || !p.key) return null;
    var b = h("button", { type: "button", class: "btn btn-small dm-fb", text: "💬", title: L("Skriv", "Message"),
      "aria-label": L("Skriv till ", "Message ") + (p.name || "") });
    b.addEventListener("click", function (e) { e.stopPropagation(); openWith({ p_key: p.key }, p.name, b); });
    return b;
  }
  function memberPanel(g, m, panel, openU) {
    if (off || !A || !A.LIVE || !g || !m || m.is_me || !m.k) return panel;
    var box = panel, row;
    if (!box) {
      box = h("li", { class: "st-act" }); row = h("div", { class: "row" });
      if (openU) row.appendChild(A.btn(L("🎖️ Uniform", "🎖️ Uniform"), "btn-small", openU));
      box.appendChild(row);
    } else row = box.querySelector(".row") || box;
    var b = A.btn(L("💬 Skriv", "💬 Message"), "btn-small dm-mb", function () { openWith({ p_group_id: g.id, p_k: m.k }, m.name, b); });
    row.insertBefore(b, row.firstChild ? row.firstChild.nextSibling : null);
    return box;
  }
  function beerPopupHTML(b) {
    if (off || !A || !A.LIVE || !b || b.is_mine || !b.friend_name) return "";
    return '<button type="button" class="btn btn-small btn-block dm-pin" data-dmpin="' + U.esc(String(b.id)) + '" data-dmname="' + U.esc(b.friend_name) + '">' +
      U.esc(L("💬 Skriv till ", "💬 Message ") + b.friend_name) + "</button>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-dmpin]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    try { if (A && A.map) A.map.closePopup(); } catch (x) {}
    openWith({ p_pin: b.getAttribute("data-dmpin") }, b.getAttribute("data-dmname"), null);
  }, true);

  /* ---------- 💬 Meddelanden box (top of the Vänner tab) ---------- */
  var showAll = false;
  function saIc(n, c) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n, c) : ""; } catch (e) { return ""; } }   // social-a
  function initial(n) { var s = String(n || "?").trim(); return s ? s.charAt(0).toUpperCase() : "?"; }
  function preview(t) {
    if (t.blocked_by_me) return L("Blockerad", "Blocked");
    if (!t.last_id) return L("Inga meddelanden än", "No messages yet");
    var b = String(t.last_body || "");
    if (/^📷/.test(b)) b = L("📷 Bild", "📷 Photo") + b.slice(2);
    return (t.last_me ? L("Du: ", "You: ") : "") + b;
  }
  function row(t) {
    var n = t.unread | 0;
    var li = h("li", { class: "dm-row" + (n ? " dm-new" : "") + (t.blocked_by_me ? " dm-off" : ""), role: "button", tabindex: "0",
      "aria-label": (t.name || "?") + ", " + preview(t) + (n ? ", " + n + L(" olästa", " unread") : "") }, [
      h("span", { class: "dm-av" + (t.out ? " out" : ""), "aria-hidden": "true", text: initial(t.name) }),
      h("span", { class: "dm-main" }, [
        h("span", { class: "dm-top" }, [h("b", { text: t.name || "?" }), h("small", { class: "dm-time", text: ago(t.at || t.last_at) })]),
        h("span", { class: "dm-prev", text: preview(t) })]),
      n ? h("span", { class: "dm-badge", text: n > 9 ? "9+" : String(n) }) : h("span", { class: "ds-chev", "aria-hidden": "true" })
    ]);
    var go = function () { open(t); };
    li.addEventListener("click", go);
    li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return li;
  }
  function paintBox(box) {
    box.innerHTML = "";
    var list = off ? [] : TH;
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(h("h3", { class: "dm-h" }, [L("💬 Meddelanden", "💬 Messages"), total ? h("span", { class: "dm-hn", text: String(total) }) : null]));
    var ul = h("ul", { class: "dm-list" });
    var max = showAll ? 50 : 4;
    list.slice(0, max).forEach(function (t) { ul.appendChild(row(t)); });
    box.appendChild(ul);
    if (list.length > max) box.appendChild(A.btn(L("Visa alla (", "Show all (") + list.length + ")", "btn-small btn-ghost dm-more", function () { showAll = true; paintBox(box); }));
  }
  function paintTab() {
    document.querySelectorAll('.inv-tabs button[data-t="f"]').forEach(function (b) {
      var s = b.querySelector(".dm-tabn");
      if (!s) { s = h("span", { class: "dm-tabn", hidden: true }); b.appendChild(s); }
      s.textContent = total > 9 ? "9+" : String(total); s.hidden = !total || off;
    });
  }
  function paintAll() {
    document.querySelectorAll(".dm-box").forEach(paintBox);
    paintTab();
    try { if (window.INBOX && window.INBOX.paint) window.INBOX.paint(); } catch (e) {}
  }
  function place(pane) {
    if (!pane || pane.querySelector(".dm-box")) return true;
    if (!pane.firstChild) return false;
    var box = h("section", { class: "dm-box", hidden: true });
    var top = pane.querySelector(":scope > .sa-vtop");   // social-a G1: the two add actions stay first
    pane.insertBefore(box, top ? top.nextSibling : pane.firstChild);
    paintBox(box);
    return true;
  }
  /* ---------- b1people I-01: "Blockerade (N)" row at the bottom of the friends list ---------- */
  // Unblock lives where the block happened (Vänner / Meddelanden). Settings → Trygghet has a link to the same list (safety.js).
  function blkRowEl() {
    var ic = saIc("block", "");
    var b = h("button", { type: "button", class: "ds-row pn-row dm-blk-b", "aria-label": L("Blockerade personer", "Blocked people") }, [
      h("span", { class: "ds-row-i", "aria-hidden": "true", html: ic }),
      h("span", { class: "ds-row-t" }, [h("span", { class: "dm-blk-t", text: L("Blockerade", "Blocked") + " (" + blkN + ")" }),
        h("small", { text: L("Avblockera här", "Unblock here") })]),
      h("span", { class: "ds-chev", "aria-hidden": "true" })]);
    b.addEventListener("click", function () { try { if (window.SAFETY && window.SAFETY.blocked) window.SAFETY.blocked(); } catch (e) {} });
    return h("section", { class: "ds-section dm-blk", hidden: !blkN }, [h("div", { class: "ds-list" }, [b])]);
  }
  function paintBlk(pane) {
    pane = pane || document.getElementById("inv-pane-f"); if (!pane) return;
    var sec = pane.querySelector(":scope > .dm-blk");
    if (sec) sec.remove();
    sec = blkRowEl(); pane.appendChild(sec);
  }
  function loadBlk(pane) {
    if (!A || !A.LIVE || !A.rpc || !A.authed || !A.authed()) return;
    A.rpc("my_blocks").then(function (r) {
      var d = r && !r.error ? A.parseData(r.data) : null;
      blkN = d && Array.isArray(d.blocks) ? d.blocks.length : 0;
      paintBlk(pane);
    });
  }
  function placeBlk(pane) {
    if (!pane || pane.__blk) return;
    pane.__blk = 1; paintBlk(pane); loadBlk(pane);
    if (window.MutationObserver) {   // the friends list is built later / rebuilt: the row stays the LAST child
      var mo = new MutationObserver(function () {
        if (!document.body.contains(pane)) { mo.disconnect(); return; }
        var sec = pane.querySelector(":scope > .dm-blk");
        if (!sec || pane.lastElementChild !== sec) paintBlk(pane);
      });
      mo.observe(pane, { childList: true });
    }
  }
  // Settings → Blockerade → Avblockera: the DM of that person opens again at once. With migration 0470 the server ends the
  // DM-only block too; before it (or on a server without it) the client ends it here, so there is no second tap.
  function afterUnblock(name) {
    var work = TH.filter(function (t) { return t.blocked_by_me && (!name || t.name === name); });
    blkN = Math.max(0, blkN - 1);
    Promise.all(work.map(function (t) { return rpc("dm_block", { p_group_id: t.group_id, p_on: false }); })).then(function () {
      return poll(true);
    }).then(function () { if (onState) onState(); paintBlk(); loadBlk(); });
  }
  function groupsSheet() {
    if (off || !A || !A.LIVE) return;
    setTimeout(function () {
      paintTab();
      var pane = document.getElementById("inv-pane-f");
      if (!pane) return;
      placeBlk(pane);
      if (!place(pane) && window.MutationObserver) {
        var mo = new MutationObserver(function () { if (!document.body.contains(pane) || place(pane)) mo.disconnect(); });
        mo.observe(pane, { childList: true });
      }
      poll(true);
    }, 0);
  }
  // Refresh while the Vänner tab is on screen.
  U.vInterval(function () { if (A && !off && paneOpen() && !document.hidden) poll(false); }, PANE_MS);

  /* ---------- inside the chat (social.js openChat with g.dm) ---------- */
  // s1speed (PN.chatLive, flag dmLive): while the live socket is up the server nudges 's' when the other has seen, and a new
  // line changes maxId: dm_seen goes then (and every 30 s as a safety net), not every 4 s. No socket = every 4 s as before.
  function liveDue(g, o) {   // o = { at, max, off, done, sync, maxId } of one open DM chat
    var L = window.PN && window.PN.chatLive; if (!L || !L.up || !L.up(g.id)) return true;
    if (!o.off && L.onSeen) o.off = L.onSeen(g.id, function () { if (!o.done && Date.now() - o.at > 1500) o.sync(); });
    return o.maxId() !== o.max || Date.now() - o.at >= 30000;
  }
  function chatOpen(g, ctx) {
    if (!g || !g.dm || !ctx || !ctx.list || !A) return;
    var t = byGid(g.id) || g.dm, list = ctx.list, nm = t.name || g.name || "?";
    var body = list.parentNode, done = false, st = t, pushed = {}, base = 0, busyS = false, lv = { at: 0, max: -1, off: null, done: false, sync: sync, maxId: maxId };   // s1speed lv: liveDue
    openGid = g.id;
    if (byGid(g.id)) byGid(g.id).unread = 0;
    total = TH.reduce(function (s, x) { return s + (x.unread | 0); }, 0); paintAll();
    // Back → the Vänner tab (where the thread list lives).
    var back = body.querySelector(".row > .btn");
    if (back && back.parentNode) {
      var nb = A.btn(L("← Tillbaka", "← Back"), "btn-small", function () {
        if (!(window.INVITE && window.INVITE.openFriendsTab && window.INVITE.openFriendsTab())) A.showGroups();
      });
      nb.textContent = back.textContent;
      back.parentNode.replaceChild(nb, back);
    }
    // Header: 🔒 private + 🔕 + 🚫
    var head = h("div", { class: "dm-chead" });
    // social-a: name + "Bara ni två" (lock icon) never cut at 360 px: the two actions are 44 px icon buttons (PNI)
    var priv = h("small", { class: "muted dm-cpriv" }); priv.innerHTML = saIc("lock", "dm-cpriv-i") + "<span>" + U.esc(L("Bara ni två", "Just you two")) + "</span>";
    // c3chat I-39: the same avatar component as the chat rows (data-avk g|group|n|name), so the real picture shows here too
    var hav = h("span", { class: "av av-face dm-av sm", "aria-hidden": "true", "data-avk": "g|" + g.id + "|n|" + nm, "data-avi": initial(nm), text: initial(nm) });
    try { if (window.AVATAR) { if (window.AVATAR.forGroup) window.AVATAR.forGroup(g.id); if (window.AVATAR.repaint) window.AVATAR.repaint(); } } catch (e) {}
    var who = h("span", { class: "dm-cwho" }, [hav,
      h("span", {}, [h("b", { text: nm }), priv])]);
    var muteB = A.btn("", "btn-small btn-ghost dm-mute sa-dm-ib", function () { toggleMute(); });
    var blockB = A.btn("", "btn-small btn-ghost dm-block sa-dm-ib", function () { askBlock(); });
    head.appendChild(who); head.appendChild(h("span", { class: "dm-cacts" }, [muteB, blockB]));
    body.insertBefore(head, list);
    var ask = h("div", { class: "dm-ask", hidden: true });
    body.insertBefore(ask, list);
    var lock = h("div", { class: "dm-lock", hidden: true });
    if (ctx.input && ctx.input.parentNode) ctx.input.parentNode.insertBefore(lock, ctx.input.nextSibling);
    if (ctx.note) ctx.note.textContent = pick("note", T.note);
    var emptyText = P("empty", { namn: nm });
    // social.js draws "Tyst i leden…" for an empty chat: say hej to the friend instead.
    function fixEmpty() {
      var em = list.querySelector(".chat-empty"), std = "";
      try { std = I.t("chatEmpty"); } catch (e) {}
      if (em && std && em.textContent === std) em.textContent = emptyText;
    }
    function show(x, on) { if (x) x.style.display = on ? "" : "none"; }
    function paint() {
      // b1people I-04: the bell shows the STATE (bell = notifications on, crossed bell = muted), a tap toggles, aria-pressed = muted
      var mu = !!st.muted;
      muteB.innerHTML = saIc(mu ? "bell-off" : "bell");
      muteB.classList.toggle("on", mu); muteB.setAttribute("aria-pressed", String(mu));
      muteB.setAttribute("aria-label", L("Notiser från ", "Notifications from ") + nm);
      muteB.title = mu ? L("Notiser av. Tryck för att slå på.", "Notifications off. Tap to turn on.") : L("Notiser på. Tryck för att tysta.", "Notifications on. Tap to mute.");
      // blocked: the button says "Avblockera" in words (not only an icon)
      var bl = !!st.blocked_by_me;
      blockB.innerHTML = saIc("block") + (bl ? '<span class="dm-unb-t">' + U.esc(L("Avblockera", "Unblock")) + "</span>" : "");
      blockB.classList.toggle("on", bl);
      blockB.setAttribute("aria-label", bl ? L("Avblockera ", "Unblock ") + nm : L("Blockera ", "Block ") + nm);
      blockB.title = blockB.getAttribute("aria-label");
      fixEmpty();
      if (st.can_write !== false) { lock.hidden = true; show(ctx.input, true); }
      else {
        show(ctx.input, false);
        lock.hidden = false;
        var key = (st.blocked_by_me ? "me" : st.blocked_me ? "them" : "nf");
        if (lock.getAttribute("data-k") !== key) {
          lock.setAttribute("data-k", key); lock.innerHTML = "";
          lock.appendChild(h("p", { class: "dm-lock-t", text: st.blocked_by_me ? (isFull() ? P("iBlocked", { namn: nm }) : P("iClosed", { namn: nm })) : st.blocked_me ? P("blockedMe", { namn: nm }) : pick("notFriends", T.notFriends) }));
          if (st.blocked_by_me) lock.appendChild(A.btn(isFull() ? L("Avblockera ", "Unblock ") + nm : L("Öppna chatten igen", "Open the chat again"), "btn-small dm-unb", function () { setBlock(false); }));
        }
      }
      paintSeen();
    }
    function lastRow() {
      var rows = list.querySelectorAll("li[data-mid]");
      return rows.length ? rows[rows.length - 1] : null;
    }
    function maxId() { var r = lastRow(); return r ? +r.getAttribute("data-mid") || 0 : 0; }
    var seenEl = h("li", { class: "dm-seen", "aria-live": "polite" });
    function paintSeen() {
      var r = lastRow();
      if (!r || !r.classList.contains("me") || st.blocked_by_me || st.blocked_me) { if (seenEl.parentNode) seenEl.remove(); return; }
      var mid = +r.getAttribute("data-mid") || 0;
      var seen = (st.other_seen_id | 0) >= mid && mid > 0;
      // ownerfix 9c: PNI icons, no emoji in the chrome
      var pi = function (n) { return window.PNI && window.PNI.svg ? window.PNI.svg(n, "pi-lead") : ""; };
      seenEl.innerHTML = seen ? pi("eye") + U.esc(L("Sett ", "Seen ") + hm(st.other_seen_at)) : pi("check") + U.esc(L("Skickat", "Sent"));
      seenEl.classList.toggle("on", seen);
      if (r.nextSibling !== seenEl) list.insertBefore(seenEl, r.nextSibling);
    }
    function sync() {
      if (busyS || done) return;
      busyS = true; lv.at = Date.now(); lv.max = maxId();
      rpc("dm_seen", { p_group_id: g.id, p_last_id: maxId() }).then(function (r) {
        busyS = false;
        if (r.error || done) return;
        var d = A.parseData(r.data); if (!d || !d.group_id) return;
        st = d;
        var x = byGid(g.id); if (x) { Object.keys(d).forEach(function (k) { x[k] = d[k]; }); x.unread = 0; }
        paint();
      });
    }
    onState = function () { if (!done) sync(); };   // b1people I-03: Settings → Blockerade → Avblockera refreshes this chat at once
    function toggleMute() {
      muteB.disabled = true;
      rpc("dm_mute", { p_group_id: g.id, p_on: !st.muted }).then(function (r) {
        muteB.disabled = false;
        if (r.error) { A.toast(pick("fail", T.fail), { err: true }); return; }
        st = A.parseData(r.data) || st; paint();
        A.toast(st.muted ? P("muted", { namn: nm }) : P("unmuted", { namn: nm }));
      });
    }
    // fixS T-01: the main choice is the FULL block (block_user: user_blocks + the friendship ends, so no pin, no "ute nu",
    // no friend-of-friend names, no DM); "Stäng bara chatten" is the old DM-only block (dm_block) as the 2nd choice.
    // dm_block is also set on a full block so this thread knows "blocked by me" before migration 0470 is live.
    function askBlock() {
      if (st.blocked_by_me) { setBlock(false); return; }
      ask.innerHTML = ""; ask.hidden = false;
      ask.appendChild(h("p", { class: "dm-ask-h" }, [h("b", { text: DV("dm.blockQ", T.blockQ[0], { namn: nm }) })]));
      ask.appendChild(h("ul", { class: "dm-ask-l" }, T.blockLi.map(function (x, i) { return h("li", { text: DV("dm.blockLi" + i, x, { namn: nm }) }); })));
      var yes = A.btn(L("Blockera ", "Block ") + nm, "btn-small btn-block dm-yes", function () { ask.hidden = true; setBlock(true, true); });
      try { if (window.PNI && window.PNI.has("block")) yes.insertAdjacentHTML("afterbegin", window.PNI.svg("block", "pi-lead")); } catch (e) {}
      ask.appendChild(h("div", { class: "dm-ask-acts" }, [yes,
        A.btn(L("Stäng bara chatten", "Only close the chat"), "btn-small btn-block dm-close-only", function () { ask.hidden = true; setBlock(true, false); }),
        A.btn(L("Avbryt", "Cancel"), "btn-small btn-block btn-ghost dm-no", function () { ask.hidden = true; })]));
    }
    var fullBlock = !!t.full_block;
    function isFull() { return fullBlock || !!st.full_block; }   // st.full_block: server 0470 (olnu_dm_json)
    function setBlock(on, full) {
      if (blockB.disabled) return;
      if (!on) full = isFull();
      blockB.disabled = true;
      // on + full: block_user first (the person), then the thread flag. off: both off (a full block made here or elsewhere).
      var first = full ? rpc("block_user", { p_kind: "person", p_ref: null, p_group: g.id, p_k: null, p_on: !!on }) : Promise.resolve({});
      first.then(function (r0) {
        if (on && full && r0 && r0.error) { blockB.disabled = false; A.toast(missing(r0.error) ? L("Blockera finns inte på servern än.", "Block is not on the server yet.") : errText(codeOf(r0.error)), { err: true }); return; }
        rpc("dm_block", { p_group_id: g.id, p_on: on }).then(function (r) {
          blockB.disabled = false;
          if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
          fullBlock = !!(on && full); t.full_block = fullBlock; st.full_block = fullBlock; loadBlk();
          st = A.parseData(r.data) || st; lock.removeAttribute("data-k"); paint();
          var x = byGid(g.id); if (x) { Object.keys(st).forEach(function (k) { x[k] = st[k]; }); x.full_block = fullBlock; }
          A.toast(on ? (full ? DV("dm.blocked", T.blocked[0], { namn: nm }) : DV("dm.closed", T.closed[0], { namn: nm })) : full ? DV("dm.unblocked", T.unblocked[0], { namn: nm }) : DV("dm.reopened", T.reopened[0], { namn: nm }), { id: "dm-block", ms: 4500 });
          try { window.FX.vibrate(on ? [30, 40, 30] : 15); } catch (e) {}
          if (full) { try { if (window.WARM && window.WARM.clear) window.WARM.clear(); } catch (e) {} }
          if (on && full) { try { if (A.refresh) setTimeout(function () { A.refresh(); }, 300); } catch (e) {} try { if (window.SUGGEST && window.SUGGEST.refresh) window.SUGGEST.refresh(); } catch (e) {} }
        });
      });
    }
    // 📷 photos do not push by themselves: send the DM push for my new photo rows.
    function watchPhotos() {
      if (!window.MutationObserver) return;
      var mo = new MutationObserver(function () {
        if (!alive()) { mo.disconnect(); return; }
        list.querySelectorAll("li.chat-msg.me[data-mid]").forEach(function (li) {
          var id = +li.getAttribute("data-mid") || 0;
          if (id <= base || pushed[id]) return;
          var b = li.querySelector(".cm-body");
          if (!b || !/^📷/.test(String(b.textContent || "").trim())) return;
          pushed[id] = 1;
          try { if (A.invoke) A.invoke("notify-group", { event: "msg", group_id: g.id }); } catch (e) {}
        });
        paintSeen(); fixEmpty();
      });
      mo.observe(list, { childList: true });
    }
    function alive() { return ctx.alive ? ctx.alive() : document.body.contains(list); }
    base = Infinity;
    paint(); watchPhotos();
    // Old photo rows never push: the base is the newest id once the first page is drawn.
    var baseTries = 0;
    (function setBase() { if (!alive() && ++baseTries > 6) return; if (list.querySelector("li[data-mid], .chat-empty")) { base = maxId(); sync(); } else setTimeout(setBase, 800); })();
    var tm = setInterval(function () {
      if (!alive()) { done = lv.done = true; clearInterval(tm); onState = null; if (lv.off) lv.off(); if (String(openGid) === String(g.id)) openGid = null; poll(true); return; }
      if (!document.hidden && liveDue(g, lv)) sync();
    }, 4000);
  }

  window.DM = {
    T: T, open: open, openWith: openWith, openById: openById, friendBtn: friendBtn, memberPanel: memberPanel, chatOpen: chatOpen,
    afterUnblock: afterUnblock, blockedCount: function () { return blkN; },
    unread: function () { return off ? 0 : total; }, list: function () { return TH; }, _poll: poll,
    init: function (api) {
      A = api;
      /* ⚡ SPEED: no own resume poll (app.js polls once after the session refresh; onPoll does the rest) */
    },
    onAuthed: function () { poll(true); },
    onPoll: function () { poll(false); },
    groupsSheet: function (body) { try { groupsSheet(body); } catch (e) { try { console.warn("olnu dm", e); } catch (x) {} } },
    beerPopupHTML: function (b) { try { return beerPopupHTML(b); } catch (e) { return ""; } },
    applyText: function () { paintAll(); }
  };
})();
