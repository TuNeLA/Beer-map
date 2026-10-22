/* Öl Nu — 🔗 EVENTLÄNK (social2; migration 0125 ev_link / ev_preview / ev_join, card kind "ev").
   Partiful rule: an event link works WITHOUT the app. A participant taps "🔗 Dela länk" in the invite sheet →
   <card>?t=ev&id=<6-char code>&by=<name> (rich preview: title, time, "3 kommer", faces) → the app link ?ev=CODE.
   - In the browser (not installed): join.js shows the welcome card with the event and ✅ Jag kommer / 🤔 Kanske
     (name only), then the gentle install guide. The answer is saved on the server at once (ev_join).
   - In the installed app (or after "Fortsätt i webbläsaren" without an answer): a sheet with the same answer buttons.
   - The 6-char code is also typed in Grupper → Gå med: app.js showJoin asks EVLINK.tryCode() when it is no group code.
   Hooks (app.js mods, after INVITE): init, onAuthed. Called by invite.js drawInvite: EVLINK.inviteBox(box, invite).
   Called by join.js: EVLINK.answerLines(). Public: EVLINK.open(code), EVLINK.tryCode(code) → Promise<bool>.
   Missing RPC (old server) → no share button, the code fallback says "no group". */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, tokens = {};
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function clean(c) { return String(c || "").toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, "").slice(0, 6); }
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

  // ?ev=CODE (join.js read it already for the welcome card; strip it so a reload does not ask again)
  var LINK = null;
  try {
    var q = new URLSearchParams(location.search), c0 = clean(q.get("ev"));
    if (c0.length === 6) LINK = c0;
    if (q.has("ev")) { q.delete("ev"); var qs = q.toString(); history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash); }
  } catch (e) {}

  var SHARE = ["🍺 Häng med! Tryck på länken och svara – ingen app behövs:", "📨 Du ä bjuden! Ett tryck så ä du med:",
    "🪖 Uppställning! Svara här (funkar direkt i mobilen):", "🍻 Kom med! Säg ja här, appen kan du fixa sen:"];
  var SHARE_EN = ["🍺 Join us! Tap the link and answer – no app needed:", "📨 You're invited! One tap and you're in:"];
  var YES = ["✅ Du ä mä! Vi ses där.", "✅ Anmäld till fronten. Bra jobbat, soldat!", "✅ Klart! Gänget vet att du kommer.", "✅ Noterat i loggboken: du kommer."];
  var MAYBE = ["🤔 Kanske, alltså. Vi håller en plats varm.", "🤔 Okej, en kanske. Bättre än ett nej!"];
  function answerLine(a) { return a === "yes" ? pick("y", YES) : a === "maybe" ? pick("m", MAYBE) : L("❌ Okej, nästa gång!", "❌ Okay, next time!"); }

  /* ---------- share (invite sheet) ---------- */
  function link(tok) {
    var by = A && A.getName ? String(A.getName() || "").replace(/[<>"'&\\\/]/g, "").trim().slice(0, 24) : "";
    var card = window.CARDS && window.CARDS.on && window.CARDS.on() ? window.CARDS.url("ev", tok) : "";
    var base = card || (location.origin + location.pathname + "?ev=" + tok);
    return base + (by ? "&by=" + encodeURIComponent(by) : "");
  }
  function prep(id) {
    if (tokens[id]) return Promise.resolve(tokens[id]);
    return A.rpc("ev_link", { p_id: +id }).then(function (r) {
      if (r.error) { if (U.missing && U.missing(r.error)) off = true; return ""; }
      var d = A.parseData(r.data) || {}, t = clean(d.token);
      if (t.length === 6) tokens[id] = t;
      return tokens[id] || "";
    });
  }
  function copy(text, done) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { if (A.copyText) { A.copyText(text); done(); } }); return; } } catch (e) {}
    if (A.copyText) { A.copyText(text); done(); }
  }
  function inviteBox(box, inv) {
    if (off || !A || !A.LIVE || !inv || !inv.id || inv.live === false || inv.my_answer === "no") return;
    var wrap = h("div", { class: "evl-box" });
    var codeEl = h("button", { type: "button", class: "evl-code", hidden: true });
    var b = h("button", { type: "button", class: "btn btn-block evl-share", text: L("🔗 Dela länk – funkar utan appen", "🔗 Share link – works without the app") });
    b.addEventListener("click", function () {
      var t = tokens[inv.id];
      if (!t) { b.disabled = true; prep(inv.id).then(function (x) { b.disabled = false; if (x) b.click(); else A.toast(L("Kunde int' göra länken.", "Could not make the link."), { err: true }); }); return; }
      var u = link(t), text = (sv() ? pick("s", SHARE) : pick("se", SHARE_EN)) + " " + (inv.title || "");
      var copied = function () { A.toast(L("📋 Länken ä kopierad – klistra in den i chatten", "📋 Link copied"), { id: "evl" }); };
      if (navigator.share) {
        try { navigator.share({ title: inv.title || "Öl Nu", text: text, url: u }).catch(function (e) { if (!e || e.name !== "AbortError") copy(text + " " + u, copied); }); return; } catch (e) {}
      }
      copy(text + " " + u, copied);
    });
    codeEl.addEventListener("click", function () { var t = tokens[inv.id]; if (t) copy(t, function () { A.toast(L("📋 Koden ä kopierad", "📋 Code copied"), { id: "evl" }); }); });
    wrap.appendChild(b); wrap.appendChild(codeEl);
    box.appendChild(wrap);
    prep(inv.id).then(function (t) {   // made when the sheet renders: navigator.share must run inside the tap
      if (!document.body.contains(wrap)) return;
      if (!t) { wrap.remove(); return; }
      codeEl.hidden = false;
      codeEl.innerHTML = "";
      codeEl.appendChild(h("span", { class: "muted", text: L("Kod: ", "Code: ") }));
      codeEl.appendChild(h("b", { text: t }));
      codeEl.appendChild(h("span", { class: "muted", text: L(" · skriv den under Grupper → Gå med", " · type it in Groups → Join") }));
    });
  }

  /* ---------- open (in the app) ---------- */
  function faces(list) { return h("span", { class: "evl-faces", "aria-hidden": "true" }, (list || []).slice(0, 4).map(function (x) { return h("span", { class: "gpg-face on", text: x }); })); }
  function sheet(code, d) {
    A.openSheet(L("📨 Inbjudan", "📨 Invite"), function (body) {
      var card = h("div", { class: "evl-card" }, [
        h("div", { class: "evl-kick", text: (d.from ? d.from + L(" bjuder in dig", " invites you") : L("Du ä bjuden", "You're invited")) }),
        h("h3", { class: "evl-title", text: d.title || "" }),
        h("p", { class: "evl-when", text: "🕗 " + when(d.starts_at) + (d.place ? " · 📍 " + d.place : "") }),
        h("p", { class: "evl-who" }, [faces(d.faces), document.createTextNode(" " + L((d.yes | 0) + " kommer", (d.yes | 0) + " going") + ((d.maybe | 0) ? L(" · " + d.maybe + " kanske", " · " + d.maybe + " maybe") : ""))])
      ]);
      body.appendChild(card);
      var st = h("p", { class: "evl-st", role: "status", "aria-live": "polite" });
      if (d.live === false) { body.appendChild(h("p", { class: "muted", text: L("Eventet ä över eller inställt.", "The event is over or cancelled.") })); return; }
      var row = h("div", { class: "row evl-ans" });
      [["yes", L("✅ Jag kommer", "✅ I'm going"), "btn-green"], ["maybe", L("🤔 Kanske", "🤔 Maybe"), ""], ["no", L("❌ Kan int'", "❌ Can't"), ""]].forEach(function (x) {
        var b = h("button", { type: "button", class: "btn " + x[2] + (d.my_answer === x[0] ? " on" : ""), "aria-pressed": String(d.my_answer === x[0]), text: x[1] });
        b.addEventListener("click", function () { answer(code, x[0], b, st); });
        row.appendChild(b);
      });
      body.appendChild(row);
      body.appendChild(st);
      if (d.member && d.id && window.INVITE && window.INVITE.open) body.appendChild(A.btn(L("📨 Öppna eventet ›", "📨 Open the event ›"), "btn-block", function () { window.INVITE.open(d.id); }));
    });
  }
  function answer(code, a, b, st) {
    A.withName(function () {
      b.disabled = true;
      A.rpc("ev_join", { p_token: code, p_answer: a, p_name: A.getName() || null }).then(function (r) {
        b.disabled = false;
        if (r.error) {
          var c = U.errCode ? U.errCode(r.error) : "";
          st.textContent = c === "invite_over" ? L("Eventet ä över.", "The event is over.") : c === "too_many" ? L("Fullt! Max 60 personer.", "Full! Max 60 people.")
            : c === "slow_down" ? L("Lugn – vänta en stund.", "Easy – wait a bit.") : L("Kunde int' svara. Försök igen.", "Could not answer. Try again.");
          return;
        }
        var d = A.parseData(r.data) || {};
        if (d.push_yes && d.id) A.invoke("notify-group", { event: "invite_yes", invite_id: +d.id });
        A.toast(answerLine(a), { id: "evl" });
        try { if (window.INBOX && window.INBOX.refresh) window.INBOX.refresh(); } catch (e) {}
        if (d.id && window.INVITE && window.INVITE.open) window.INVITE.open(d.id); else A.closeSheet();
      });
    });
  }
  function open(code) {
    code = clean(code);
    if (!A || !A.LIVE || code.length !== 6) return Promise.resolve(false);
    return A.rpc("ev_preview", { p_token: code }).then(function (r) {
      if (r.error) { if (U.missing && U.missing(r.error)) off = true; return false; }
      var d = A.parseData(r.data) || {};
      if (!d.ok) { if (d.why === "slow_down") A.toast(L("För många fel koder. Vänta 10 min.", "Too many wrong codes. Wait 10 min."), { err: true }); return false; }
      sheet(code, d);
      return true;
    });
  }

  window.EVLINK = {
    init: function (api) { A = api; },
    onAuthed: function () {
      if (!LINK) return;
      var code = LINK; LINK = null;
      var gate = window.JOIN && window.JOIN.gate ? window.JOIN.gate() : Promise.resolve();
      Promise.resolve(gate).then(function () {
        if (window.JOIN && window.JOIN.evDone && window.JOIN.evDone(code)) return;   // answered on the welcome card
        var tries = 0;
        (function wait() {
          var intro = document.getElementById("intro");
          if ((intro && !intro.hidden) || (A.sheetOpen && A.sheetOpen() && tries < 20)) { if (++tries < 60) setTimeout(wait, 700); return; }
          open(code);
        })();
      });
    },
    inviteBox: function (box, inv) { try { inviteBox(box, inv); } catch (e) {} },
    open: open,
    tryCode: function (code) { return off ? Promise.resolve(false) : open(code); },
    answerLine: answerLine, when: when
  };
})();
