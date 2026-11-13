/* Öl Nu — 🧰 UXFIX (owner 2026-11-07, Android feedback items 5, 7, 8, 9). No new floating button.
   5. Grupper: "Mina grupper" (the list) comes first; "📨 Kvällens event" (evchat.js .evc-sec) moves right under it.
      (groupsSheet hook; the name + "Byt namn" row is gone from Grupper, app.js patch ux3/01 — the name lives in 👤 Profil.)
   7. Group chat: the "Gruppen sparar chatten efter 05…" note and the 💾 keep-history toggle leave the chat body.
      A small ⚙️ next to ← in the chat head opens "Chattinställningar" (in place; Android back closes it).
      social.js calls UXFIX.chatSettings(g, topRow, note, keepBox) (patch ux3/02). Event chats and 1:1 chats keep their note.
   8. Day separators in every chat list (ul.chat-list > li.chat-msg[data-at]): "Idag", "Igår", "Fre 6 nov" (other year:
      "Fre 6 nov 2025"). A tap on a time shows the full date + time for 4 s (and sets its title).
   9. Bar sheet: when I am checked in at THIS bar, "🚪 Checka ut" (button .ci-out[data-ciout], drawn by app.js
      checkinBtnHTML, patch ux3/01). RPC check_out() (migration 0162) ends the check-in now; old server → a toast.
   Hooks (app.js mods): init, groupsSheet. Public: window.UXFIX = { chatSettings, days, checkOut, dayLabel }. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, outOff = false;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var last = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === last[k]) i = (i + 1) % a.length; last[k] = i; return a[i]; }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- 5. Grupper: my groups first ---------- */
  function groupsSheet(body) {
    var list = body.querySelector(".glist"), sec = body.querySelector(".evc-sec");
    if (!list || !sec || !list.parentNode) return;
    list.parentNode.insertBefore(sec, list.nextSibling);
    sec.classList.add("ux-evc-after");
  }

  /* ---------- 7. chat settings behind ⚙️ ---------- */
  function chatSettings(g, topRow, note, keepBox) {
    if (!topRow || !note || g.ev || g.dm) return;
    var panel = h("div", { class: "ux-cset", hidden: "", role: "region", "aria-label": L("Chattinställningar", "Chat settings") });
    panel.appendChild(h("div", { class: "ux-cset-h" }, [h("b", { text: L("Chattinställningar", "Chat settings") })]));
    if (keepBox) panel.appendChild(keepBox);
    note.classList.add("ux-cset-note");
    panel.appendChild(note);
    var done = null;
    var cog = h("button", { type: "button", class: "btn btn-small ux-cog", "aria-label": L("Chattinställningar", "Chat settings"), "aria-expanded": "false", title: L("Chattinställningar", "Chat settings") });
    cog.innerHTML = window.PNI ? window.PNI.svg("gear") : "⚙️";   // ds54: the redrawn gear, a 44 px round button
    function show(on) {
      panel.hidden = !on; cog.setAttribute("aria-expanded", String(on)); cog.classList.toggle("on", on);
      if (on && window.SHEETNAV) done = window.SHEETNAV.sub(function () { done = null; show(false); });
      if (!on && done) { var d = done; done = null; d(); }
    }
    cog.addEventListener("click", function () { show(panel.hidden); });
    topRow.classList.add("ux-chat-top");
    topRow.parentNode.insertBefore(panel, topRow.nextSibling);
    // I-62 (lane menufix): the gear sits in the sheet header row (next to ✕), not in a row of its own, so the messages get the height.
    // It leaves the header with the chat (another sheet / chat → removed). No header (old markup) → the old place in the top row.
    var head = document.querySelector("#sheet .sheet-head"), x = document.getElementById("sheet-close");
    if (head && x && x.parentNode === head && window.MutationObserver) {
      [].forEach.call(head.querySelectorAll(".ux-cog"), function (o) { o.remove(); });
      cog.classList.add("ux-cog-head"); head.insertBefore(cog, x);
      var bodyEl = document.getElementById("sheet-body"), sheetEl = document.getElementById("sheet");
      var mo = new MutationObserver(function () { if (!panel.isConnected || (sheetEl && sheetEl.hidden)) { mo.disconnect(); if (done) show(false); cog.remove(); } });
      if (bodyEl) mo.observe(bodyEl, { childList: true });
      if (sheetEl) mo.observe(sheetEl, { attributes: true, attributeFilter: ["hidden"] });
    } else topRow.appendChild(cog);
  }

  /* ---------- 8. day separators ---------- */
  var DAYS_SV = ["Sön", "Mån", "Tis", "Ons", "Tors", "Fre", "Lör"], DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON_SV = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayKey(d) { return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function dayLabel(t, now) {
    var d = new Date(t); if (isNaN(d)) return "";
    now = now ? new Date(now) : new Date();
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return L("Idag", "Today");
    if (dayKey(d) === dayKey(y)) return L("Igår", "Yesterday");
    var s = (sv() ? DAYS_SV : DAYS_EN)[d.getDay()] + " " + d.getDate() + " " + (sv() ? MON_SV : MON_EN)[d.getMonth()];
    return d.getFullYear() !== now.getFullYear() ? s + " " + d.getFullYear() : s;
  }
  function fullDate(t) {
    var d = new Date(t); if (isNaN(d)) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return (sv() ? DAYS_SV : DAYS_EN)[d.getDay()] + " " + d.getDate() + " " + (sv() ? MON_SV : MON_EN)[d.getMonth()] + " " + d.getFullYear() + " · " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function days(list) {
    if (!list) return;
    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    var kids = [].slice.call(list.children), prev = null, changed = false;
    kids.forEach(function (li) {
      if (li.classList.contains("ux-day")) { li.__ux = 1; return; }
      var at = li.getAttribute("data-at"); if (!at) return;
      var d = new Date(at); if (isNaN(d)) return;
      var k = dayKey(d);
      var sep = li.previousElementSibling && li.previousElementSibling.classList.contains("ux-day") ? li.previousElementSibling : null;
      if (k !== prev) {
        var lab = dayLabel(at);
        if (!sep) { sep = h("li", { class: "ux-day", role: "separator", "aria-label": lab }, [h("span", { text: lab })]); list.insertBefore(sep, li); changed = true; }
        else if (sep.textContent !== lab) { sep.firstChild.textContent = lab; sep.setAttribute("aria-label", lab); }
        sep.__keep = 1;
      }
      prev = k;
      var tm = li.querySelector(".cm-time"); if (tm && !tm.title) { tm.title = fullDate(at); tm.classList.add("ux-tap"); }
    });
    [].slice.call(list.querySelectorAll(":scope > .ux-day")).forEach(function (s) { if (!s.__keep) { s.remove(); changed = true; } s.__keep = 0; });
    if (changed && nearBottom) list.scrollTop = list.scrollHeight;
  }
  var dirty = [], raf = 0;
  function queue(list) {
    if (dirty.indexOf(list) < 0) dirty.push(list);
    if (!raf) raf = (window.requestAnimationFrame || setTimeout)(function () { raf = 0; var d = dirty; dirty = []; d.forEach(function (l) { if (document.body.contains(l)) days(l); }); });
  }
  function watchChats() {
    var b = document.getElementById("sheet-body"); if (!b || !window.MutationObserver) return;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        var t = m.target;
        if (t && t.classList && t.classList.contains("chat-list")) {
          for (var i = 0; i < m.addedNodes.length; i++) { var n = m.addedNodes[i]; if (n.classList && n.classList.contains("chat-msg")) { queue(t); return; } }
        }
      });
    }).observe(b, { childList: true, subtree: true });
    // A tap on a time: the full date for 4 s.
    document.addEventListener("click", function (e) {
      var tm = e.target && e.target.closest ? e.target.closest(".chat-msg .cm-time") : null; if (!tm) return;
      var li = tm.closest(".chat-msg"), at = li && li.getAttribute("data-at"); if (!at) return;
      e.stopPropagation();
      if (tm.__full) return;
      var old = tm.textContent; tm.__full = 1; tm.textContent = fullDate(at); tm.classList.add("ux-full");
      setTimeout(function () { tm.textContent = old; tm.__full = 0; tm.classList.remove("ux-full"); }, 4000);
    }, true);
  }

  /* ---------- 9. check out ---------- */
  var OUT_OK = [
    "🚪 Utcheckad från {0}. Tack för i kväll, soldat.", "🚪 Du ä utcheckad från {0}. Ut ur zonen – snyggt jobbat.",
    "🚪 {0}: utcheckad. Gänget ser att du dragit vidare.", "🚪 Lämnat {0}. Uppdraget fortsätter nån annanstans?",
    "🚪 Utcheckad. {0} får klara sig utan dig ett tag."];
  var OUT_EN = ["🚪 Checked out of {0}.", "🚪 Out of {0}. Nice work, soldier."];
  function checkOut(btn) {
    if (!A || !A.LIVE) return;
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = L("🚪 Checkar ut…", "🚪 Checking out…"); }
    var me = A.myCheckin ? A.myCheckin() : null, name = me && me.name || L("krogen", "the bar");
    var fin = function (ok) {
      if (ok) {
        try { U.ls.del("olnu.checkin"); } catch (e) {}
        A.toast(pick("out", sv() ? OUT_OK : OUT_EN).replace("{0}", name), { ms: 4500 });
        try { window.FX.vibrate(15); } catch (e) {}
        if (btn) btn.textContent = L("✅ Utcheckad", "✅ Checked out");
        try { if (A.map && A.map.closePopup) A.map.closePopup(); } catch (e) {}
        try { A.updateCounts(); } catch (e) {}
        try { A.refresh(); } catch (e) {}
      } else if (btn) { btn.disabled = false; btn.textContent = L("🚪 Checka ut", "🚪 Check out"); }
    };
    if (outOff) { A.toast(L("Utcheckning funkar int' än – servern ä gammal.", "Check-out is not available yet."), { err: true }); fin(false); return; }
    A.rpc("check_out").then(function (r) {
      if (r.error) {
        if (U.missing && U.missing(r.error)) { outOff = true; A.toast(L("Utcheckning funkar int' än – servern ä gammal.", "Check-out is not available yet."), { err: true }); }
        else A.toast(L("Kunde int' checka ut. Försök igen.", "Could not check out. Try again."), { err: true });
        fin(false); return;
      }
      fin(true);   // ok=false = nothing active on the server: the phone forgets it too
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ciout]") : null; if (!b) return;
    e.preventDefault(); e.stopPropagation(); checkOut(b);
  }, true);

  window.UXFIX = {
    init: function (api) { A = api; watchChats(); },
    groupsSheet: function (body) { try { groupsSheet(body); } catch (e) {} },
    chatSettings: chatSettings, days: days, checkOut: checkOut, dayLabel: dayLabel, fullDate: fullDate
  };
})();
