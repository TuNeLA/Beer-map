/* Öl Nu — ➕ BJUD IN + 📲 ETT-TRYCKS-INSTALLATION (CONTRACT "JOIN"; migration 0086 join_preview, edge function card v3).
   1. One invite flow. Group page: a big primary "➕ Bjud in till <grupp>" right under 💬 Chatt (polish2 sectOf → section 0).
      Grupper list cards: "➕ Bjud in". Vänner tab: "➕ Bjud in en ny kompis till appen". ⚙️ / old showInvite / showCode
      (after "Skapa grupp") all open the SAME sheet: big QR · 📤 Dela länk (navigator.share with the link card, else copy) ·
      📋 Kopiera länk · the 6-character code as a small fallback · "Kompisen öppnar länken → appen frågar om hemskärmen → klart."
      Links carry &by=<my name> (the card function forwards it), so the friend sees who invited them. Old "Visa kod" tile is gone.
   2. Arrival. A ?join=CODE / ?invite=1 link (also after the card 302) opened OUTSIDE the installed app shows ONE full-screen
      welcome card before anything else ("Välkommen! TuNe har bjudit in dig till TPM 🍺"), per platform:
        android  beforeinstallprompt → ONE button "📲 Installera Öl Nu" (prompt() inside the tap). No event within 3 s →
                 3 steps with pictures (a later event switches back to the button). Chrome and the installed app share
                 storage on Android (WebAPK uses the Chrome profile), so the browser joins the group itself: at once when
                 the name is known, else when typed, else the installed app finishes it (olnu.jn.pending) after asking the name.
        ios      no install API: ONE tap "📲 Gör klart för hemskärmen" = name + join + flyttkod (prepareExport, ?flytt= in the
                 URL, link on the clipboard), then an animated arrow at Safari's ⋯ / Dela button and 3 steps.
        inapp    Instagram / Messenger / Snapchat / TikTok / Android WebView: "Öppna i Chrome/Safari" + 📋 Kopiera länk
                 (+ an intent:// try for Chrome on Android; Instagram may block it, so copy is the main path). No join here.
        desktop  QR code of the same link to scan with the phone.
        standalone  no card.
      "Fortsätt i webbläsaren" (small link) closes it; app.js then runs its normal start (intro, join sheet unless joined).
   Hooks (app.js mods, JOIN before INVITE): init, onAuthed, groupItem, groupCard (new), groupsSheet.
   Public: JOIN.gate() (promise, app.js waits with the intro), JOIN.joined(code), JOIN.handled(), JOIN.openGroup(g, isNew),
   JOIN.openApp(). Read at eval (before app.js strips the query). No new map buttons, nothing over the beer-type strip
   (the card only exists on a fresh link visit, before the map is used). Motion ≤ 1 Hz, none with prefers-reduced-motion. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, A = null;
  function sv() { return !I || I.lang !== "en"; }
  function L(a, b) { return sv() ? a : b; }
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- arrival (read before app.js strips the query) ---------- */
  function cleanBy(s) { return String(s || "").replace(/[<>"'&\\\/]/g, "").replace(/\s+/g, " ").trim().slice(0, 24); }
  var ARR = null, BY = "";
  try {
    var q = new URLSearchParams(location.search);
    BY = cleanBy(q.get("by"));
    if (q.has("join")) { var c0 = U.cleanCode(q.get("join") || ""); if (c0.length === 6) ARR = { kind: "join", code: c0 }; }
    else if (q.has("invite")) ARR = { kind: "invite" };
    if (q.has("by")) { q.delete("by"); var qs0 = q.toString(); history.replaceState(history.state, "", location.pathname + (qs0 ? "?" + qs0 : "") + location.hash); }
  } catch (e) {}

  function ua() { return navigator.userAgent || ""; }
  function inAppName() {
    var u = ua();
    if (/Instagram/i.test(u)) return "Instagram";
    if (/FBAN\/Messenger|MessengerForiOS|FB_IAB\/MESSENGER|Messenger/i.test(u)) return "Messenger";
    if (/FBAN|FBAV|FB_IAB/i.test(u)) return "Facebook";
    if (/Snapchat/i.test(u)) return "Snapchat";
    if (/TikTok|musical_ly|BytedanceWebview/i.test(u)) return "TikTok";
    if (/LinkedInApp|Line\/|Twitter/i.test(u)) return L("appen", "the app");
    if (/Android/i.test(u) && /; wv\)/.test(u)) return L("appen", "the app");
    return "";
  }
  function platform() {
    if (U.isStandalone()) return "standalone";
    if (inAppName()) return "inapp";
    if (U.isIOS()) return "ios";
    if (/Android/i.test(ua())) return "android";
    return "desktop";
  }
  function iosVer() { var m = ua().match(/OS (\d+)_/); return m ? +m[1] : 0; }
  function appBase() { return location.origin + location.pathname; }
  function plainLink(kind, code, by) {
    var q = kind === "join" ? "?join=" + encodeURIComponent(code) : "?invite=1";
    return appBase() + q + (by ? "&by=" + encodeURIComponent(by) : "");
  }
  function withBy(u, by) { return u && by ? u + (u.indexOf("?") >= 0 ? "&" : "?") + "by=" + encodeURIComponent(by) : u; }
  function myName() { return cleanBy((A && A.getName && A.getName()) || ls("olnu.name", "")); }

  /* ---------- tiny DOM helpers (the card exists before app.js has started) ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v;
      else if (k === "class") e.className = v; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function bigBtn(label, cls, fn) { return h("button", { type: "button", class: "btn ds-btn ds-btn-block jn-btn " + (cls || ""), text: label, onclick: fn }); }
  function copy(text, done) {
    var ok = function () { if (done) done(); };
    var fb = function () {
      try {
        var t = h("textarea", { readonly: true, style: "position:fixed;top:-100px;opacity:0" }); t.value = text; document.body.appendChild(t);
        t.select(); t.setSelectionRange(0, text.length); var r = document.execCommand("copy"); t.remove(); if (r) ok();
      } catch (e) {}
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fb); return; } } catch (e) {}
    fb();
  }
  function qr(box, text, size) {
    try {
      if (!window.QRCode) { box.remove(); return; }
      new window.QRCode(box, { text: text, width: size, height: size, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
    } catch (e) { box.remove(); }
  }
  function say(msg, err) {
    if (A && A.toast) A.toast(msg, { id: "jn", err: !!err });
  }

  /* ---------- 1. the invite sheet (one flow for group + app) ---------- */
  var SHARE_G = [
    "🍺 Häng med i {g} på Öl Nu! Tryck på länken:",
    "🪖 Inkallelse till {g}! Tryck här så ä du med:",
    "🍻 {g} behöver förstärkning. Gå med här:",
    "📡 {g} söker rekryter. Ett tryck så ä du inne:"
  ];
  var SHARE_A = [
    "🍺 Kolla Öl Nu – live-ölkartan för oss. Häng med:",
    "🪖 Rekrytering pågår! Öl Nu, ölkartan för gänget:",
    "🍻 Se var kompisarna tar en öl just nu. Öl Nu:"
  ];
  function openInvite(g, isNew) {
    if (!A) return;
    var isG = !!(g && g.code);
    var code = isG ? U.cleanCode(g.code) : "";
    var by = myName();
    var plain = isG ? plainLink("join", code, by) : plainLink("invite", "", by);
    var cards = window.CARDS;
    var card = cards && cards.on && cards.on() ? (isG ? cards.joinUrl(code) : cards.inviteUrl()) : "";
    var shareUrl = withBy(card, by) || plain;
    var text = isG ? pick(SHARE_G).replace("{g}", g.name || "") : pick(SHARE_A);
    A.openSheet(L("➕ Bjud in", "➕ Invite"), function (body) {
      body.classList.add("jn-sheet-body");
      var box = h("div", { class: "jn-inv" });
      box.appendChild(h("p", { class: "jn-to", text: isG ? L("Bjud in till " + (g.name || ""), "Invite to " + (g.name || "")) : L("Bjud in en kompis till Öl Nu", "Invite a friend to Öl Nu") }));
      if (isNew) box.appendChild(h("div", { class: "ds-card jn-new", html: "<b>🎉 " + esc(L("Gruppen " + (g.name || "") + " ä skapad!", (g.name || "") + " is ready!")) + "</b><br>" +
        esc(L("Nu fixar vi gänget. Visa koden eller skicka länken.", "Now get the gang in. Show the code or send the link.")) }));
      var qbox = h("div", { class: "qr jn-qr", id: "qr", "aria-hidden": "true" });
      box.appendChild(h("div", { class: "jn-qr-wrap" }, [qbox]));
      box.appendChild(h("p", { class: "jn-qr-cap muted", text: L("📷 Kompisen bredvid dig? Låt hen skanna koden.", "📷 Friend next to you? Let them scan it.") }));
      var share = bigBtn(L("📤 Dela länk", "📤 Share link"), "btn-amber ds-btn-primary jn-share", function () {
        var copied = function () { say(L("📋 Länken ä kopierad – klistra in den i chatten", "📋 Link copied – paste it in the chat")); };
        if (navigator.share) {
          try {
            navigator.share({ title: "Öl Nu", text: text, url: shareUrl }).catch(function (e) {
              if (!e || e.name !== "AbortError") copy(text + " " + shareUrl, copied);
            });
            return;
          } catch (e) {}
        }
        copy(text + " " + shareUrl, copied);
      });
      var cp = bigBtn(L("📋 Kopiera länk", "📋 Copy link"), "ds-btn-secondary jn-copy", function () {
        copy(shareUrl, function () { say(L("📋 Länken ä kopierad", "📋 Link copied")); });
      });
      box.appendChild(share); box.appendChild(cp);
      box.appendChild(h("p", { class: "jn-how", text: L("Kompisen öppnar länken → appen frågar om hemskärmen → klart.", "Your friend opens the link → the app asks about the home screen → done.") }));
      if (isG) {
        var cb = h("button", { type: "button", class: "jn-code", "aria-label": L("Kopiera koden ", "Copy the code ") + code, onclick: function () {
          copy(code, function () { say(L("📋 Koden ä kopierad", "📋 Code copied")); });
        } }, [h("span", { class: "muted", text: L("Länken krånglar? Koden: ", "Link not working? Code: ") }), h("b", { class: "jn-code-v", text: code })]);
        box.appendChild(cb);
        box.appendChild(h("p", { class: "jn-code-help muted", text: L("Grupper → Gå med → skriv koden.", "Groups → Join → type the code.") }));
      }
      body.appendChild(box);
      qr(qbox, plain, 232);   // the QR keeps the plain app link (no card hop for a camera)
    });
  }

  /* ---------- 2. arrival card ---------- */
  var plat = platform();
  var root = null, act = null, subEl = null, memEl = null, statEl = null, nameInp = null;
  var state = "", bip = null, waitT = null, gname = "", members = 0;
  var joined = false, joining = false, handledFlag = false, iosPrepped = false;
  var gateRes = null, gate = Promise.resolve();
  var CARD_ON = !!ARR && plat !== "standalone";

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); bip = e;
    if (root && (state === "wait" || state === "manual" || state === "dismissed")) setState("bip");
  });
  window.addEventListener("appinstalled", function () { if (root && plat === "android") setState("installed"); });

  function subText() {
    var g = gname, inv = ARR && ARR.kind === "invite";
    if (inv) return BY ? L(BY + " har bjudit in dig till Öl Nu 🍺", BY + " invited you to Öl Nu 🍺") : L("Du ä inbjuden till Öl Nu 🍺", "You're invited to Öl Nu 🍺");
    if (BY && g) return L(BY + " har bjudit in dig till " + g + " 🍺", BY + " invited you to " + g + " 🍺");
    if (BY) return L(BY + " har bjudit in dig till gänget 🍺", BY + " invited you to the gang 🍺");
    if (g) return L("Du ä inbjuden till " + g + " 🍺", "You're invited to " + g + " 🍺");
    return L("Du ä inbjuden till ett gäng på Öl Nu 🍺", "You're invited to a gang on Öl Nu 🍺");
  }
  function needName() { return ARR && ARR.kind === "join" && !myName(); }
  function typedName() {
    if (!nameInp) return myName();
    var v = String(nameInp.value || "").trim().slice(0, 30);
    if (v) { lsSet("olnu.name", v); return v; }
    return myName();
  }
  function status(txt, kind) {
    if (!statEl) return;
    statEl.textContent = txt || ""; statEl.hidden = !txt;
    statEl.className = "jn-stat" + (kind ? " " + kind : "");
  }
  function joinable() { return ARR && ARR.kind === "join" && (plat === "android" || plat === "ios"); }
  function tryJoin() {
    if (!joinable() || joined || joining) return;
    var n = typedName(); if (!n) return;
    if (!A || !A.LIVE || !A.authed || !A.authed()) { lsSet("olnu.jn.pending", ARR.code); return; }
    joining = true;
    status(L("⏳ Skriver in dig i " + (gname || "gruppen") + "…", "⏳ Adding you to " + (gname || "the group") + "…"));
    A.rpc("join_group", { p_code: ARR.code, p_display_name: n }).then(function (r) {
      joining = false;
      if (r.error) {
        var m = A.errMsg ? A.errMsg(r.error) : "";
        status(/group_not_found/.test(JSON.stringify(r.error)) ? L("🤷 Koden funkar int'. Be om en ny länk.", "🤷 That code doesn't work. Ask for a new link.") : (m || L("Kunde int' gå med. Försök igen.", "Could not join. Try again.")), "err");
        return;
      }
      var g = A.parseData(r.data) || {};
      if (g.name) { gname = g.name; if (subEl) subEl.textContent = subText(); }
      joined = true; lsSet("olnu.jn.done", ARR.code); lsSet("olnu.jn.pending", null);
      status(L("✅ Du ä med i " + (gname || "gruppen") + "!", "✅ You're in " + (gname || "the group") + "!"), "ok");
      try { A.refresh(); } catch (e) {}
    });
  }
  function preview() {
    if (!ARR || ARR.kind !== "join" || !A || !A.LIVE || joined) return;
    A.rpc("join_preview", { p_code: ARR.code }).then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data) || {};
      if (!d.ok) { if (d.why === "group_not_found") status(L("🤷 Koden funkar int'. Be om en ny länk.", "🤷 That code doesn't work. Ask for a new link."), "err"); return; }
      gname = d.name || gname; members = d.members | 0;
      if (subEl) subEl.textContent = subText();
      if (memEl && members) { memEl.textContent = L("👥 " + members + " i gänget redan", "👥 " + members + " in the gang already"); memEl.hidden = false; }
    });
  }

  function step(n, html, pic) {
    return h("li", { class: "jn-step" }, [h("span", { class: "jn-step-n", "aria-hidden": "true", text: String(n) }),
      h("div", { class: "jn-step-b" }, [h("p", { html: html }), pic || null])]);
  }
  // Small drawn pictures of what the friend will see (no images to load).
  function picMenuDots(samsung) {
    return h("div", { class: "jn-pic jn-pic-bar", "aria-hidden": "true" }, samsung
      ? [h("span", { class: "jn-pic-url", text: "tunela.github.io" }), h("span", { class: "jn-pic-hot", text: "≡" })]
      : [h("span", { class: "jn-pic-url", text: "🔒 tunela.github.io" }), h("span", { class: "jn-pic-hot", text: "⋮" })]);
  }
  function picMenu(samsung) {
    var rows = samsung ? [L("Bokmärken", "Bookmarks"), L("➕ Lägg till sida på", "➕ Add page to"), L("Startskärm", "Home screen")]
      : [L("Ny flik", "New tab"), L("Bokmärken", "Bookmarks"), L("📲 Installera app", "📲 Install app")];
    return h("div", { class: "jn-pic jn-pic-menu", "aria-hidden": "true" }, rows.map(function (t, i) {
      return h("span", { class: i === rows.length - 1 || (samsung && i === 1) ? "jn-pic-hot" : "", text: t });
    }));
  }
  function picDialog() {
    return h("div", { class: "jn-pic jn-pic-dlg", "aria-hidden": "true" }, [h("b", { text: L("Installera Öl Nu?", "Install Öl Nu?") }),
      h("div", {}, [h("span", { text: L("Avbryt", "Cancel") }), h("span", { class: "jn-pic-hot", text: L("Installera", "Install") })])]);
  }
  function picIos(v26) {
    return h("div", { class: "jn-pic jn-pic-bar jn-pic-ios", "aria-hidden": "true" }, v26
      ? [h("span", { text: "‹" }), h("span", { class: "jn-pic-url", text: "tunela.github.io" }), h("span", { class: "jn-pic-hot", text: "⋯" })]
      : [h("span", { text: "‹ ›" }), h("span", { class: "jn-pic-hot", text: "⬆️" }), h("span", { text: "📖 ⧉" })]);
  }

  function setState(s) { state = s; if (root) renderAct(); }
  function renderAct() {
    if (!act) return;
    act.innerHTML = "";
    document.querySelectorAll(".jn-arrow").forEach(function (a) { a.remove(); });
    var samsung = /SamsungBrowser/i.test(ua());
    if (state === "bip") {
      act.appendChild(bigBtn(L("📲 Installera Öl Nu", "📲 Install Öl Nu"), "btn-amber ds-btn-primary jn-install", install));
      act.appendChild(h("p", { class: "jn-then", text: L("Sen öppnar du Öl Nu från hemskärmen. Klart!", "Then open Öl Nu from your home screen. Done!") }));
    } else if (state === "wait") {
      act.appendChild(h("p", { class: "jn-wait", role: "status", text: L("📲 Gör i ordning appen…", "📲 Getting the app ready…") }));
    } else if (state === "dismissed" || state === "manual") {
      if (state === "dismissed") act.appendChild(h("p", { class: "jn-then", text: L("Ingen fara! Gör så här när du ä redo:", "No worries! Do this when you're ready:") }));
      act.appendChild(h("ol", { class: "jn-steps" }, [
        step(1, samsung ? L("Tryck <b>≡</b> längst ner", "Tap <b>≡</b> at the bottom") : L("Tryck <b>⋮</b> uppe till höger", "Tap <b>⋮</b> at the top right"), picMenuDots(samsung)),
        step(2, samsung ? L("<b>Lägg till sida på</b> → <b>Startskärm</b>", "<b>Add page to</b> → <b>Home screen</b>") : L("Tryck <b>Installera app</b> (eller <b>Lägg till på startskärmen</b>)", "Tap <b>Install app</b> (or <b>Add to Home screen</b>)"), picMenu(samsung)),
        step(3, L("Tryck <b>Installera</b>. Öppna sen <b>Öl Nu</b> från hemskärmen 🍺", "Tap <b>Install</b>. Then open <b>Öl Nu</b> from the home screen 🍺"), picDialog())
      ]));
    } else if (state === "installed") {
      act.appendChild(h("div", { class: "jn-done" }, [h("div", { class: "jn-big", "aria-hidden": "true", text: "✅" }),
        h("p", { class: "jn-done-h", text: L("Klart! Öl Nu ligger på hemskärmen.", "Done! Öl Nu is on your home screen.") }),
        h("p", { class: "jn-then", text: L("Öppna appen från hemskärmen 🍺 Du kan stänga den här fliken.", "Open the app from the home screen 🍺 You can close this tab.") })]));
    } else if (state === "ios") {
      var v26 = iosVer() >= 26 || iosVer() === 0;
      var withGroup = ARR.kind === "join" && A && A.LIVE;
      if (withGroup && !iosPrepped) {
        var ready = A && A.authed && A.authed() && A.hasAccount && A.hasAccount();
        var pb = bigBtn(ready ? L("📲 Gör klart för hemskärmen", "📲 Get ready for the home screen") : L("⏳ Laddar…", "⏳ Loading…"), "btn-amber ds-btn-primary jn-iosprep", iosPrep);
        pb.disabled = !ready;
        act.appendChild(pb);
        act.appendChild(h("p", { class: "jn-then", text: L("Ett tryck: du går med i gruppen och den följer med till appen.", "One tap: you join the group and it comes along to the app.") }));
      } else if (withGroup) {
        act.appendChild(h("p", { class: "jn-then jn-okline", text: L("✅ Klart! Nu tre tryck i Safari:", "✅ Done! Now three taps in Safari:") }));
      }
      var ol = h("ol", { class: "jn-steps" + (withGroup && !iosPrepped ? " jn-dim" : "") }, [
        step(1, v26 ? L("Tryck <b>⋯</b> nere till höger", "Tap <b>⋯</b> at the bottom right") : L("Tryck <b>Dela</b> ⬆️ nere i mitten", "Tap <b>Share</b> ⬆️ at the bottom"), picIos(v26)),
        step(2, v26 ? L("<b>Dela</b> → <b>Lägg till på hemskärmen</b> ➕", "<b>Share</b> → <b>Add to Home Screen</b> ➕") : L("Scrolla ner → <b>Lägg till på hemskärmen</b> ➕", "Scroll down → <b>Add to Home Screen</b> ➕")),
        step(3, L("Låt <b>Öppna som webbapp</b> vara <b>på</b> → <b>Lägg till</b>", "Keep <b>Open as Web App</b> <b>on</b> → <b>Add</b>"))
      ]);
      if (withGroup) ol.appendChild(step(4, L("Öppna <b>Öl Nu</b> från hemskärmen → <b>📋 Klistra in flyttkod</b>. Då följer gruppen med.", "Open <b>Öl Nu</b> from the home screen → <b>📋 Paste transfer code</b>. The group comes along.")));
      act.appendChild(ol);
      if (!withGroup || iosPrepped) {
        var ar = h("div", { class: "jn-arrow" + (v26 ? " jn-arrow-r" : ""), "aria-hidden": "true", text: "⬇" });
        document.body.appendChild(ar);
      }
    } else if (state === "inapp") {
      var app = inAppName(), link = plainLink(ARR.kind, ARR.code, BY), and = /Android/i.test(ua());
      act.appendChild(h("p", { class: "jn-then", text: L(app + " kan int' lägga appar på hemskärmen. Öppna länken i " + (and ? "Chrome" : "Safari") + " i stället:",
        app + " can't put apps on the home screen. Open the link in " + (and ? "Chrome" : "Safari") + " instead:") }));
      act.appendChild(h("ol", { class: "jn-steps" }, [
        step(1, L("Tryck <b>⋯</b> eller <b>⋮</b> uppe i hörnet", "Tap <b>⋯</b> or <b>⋮</b> in the top corner")),
        step(2, L("Välj <b>Öppna i webbläsaren</b> (eller <b>Öppna i " + (and ? "Chrome" : "Safari") + "</b>)", "Choose <b>Open in browser</b> (or <b>Open in " + (and ? "Chrome" : "Safari") + "</b>)"))
      ]));
      act.appendChild(bigBtn(L("📋 Kopiera länk", "📋 Copy link"), "btn-amber ds-btn-primary jn-iacopy", function () {
        copy(link, function () { status(L("📋 Kopierad! Klistra in den i " + (and ? "Chrome" : "Safari") + ".", "📋 Copied! Paste it in " + (and ? "Chrome" : "Safari") + "."), "ok"); });
      }));
      if (and) {
        var u = new URL(link);
        var intent = "intent://" + u.host + u.pathname + u.search + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(link) + ";end";
        act.appendChild(h("a", { class: "btn ds-btn ds-btn-secondary ds-btn-block jn-btn jn-intent", href: intent, text: L("🌐 Försök öppna i Chrome", "🌐 Try to open in Chrome") }));
      }
    } else if (state === "desktop") {
      var dl = plainLink(ARR.kind, ARR.code, BY);
      act.appendChild(h("p", { class: "jn-then", text: L("Öl Nu ä gjord för mobilen. Skanna koden med kameran 📷", "Öl Nu is made for your phone. Scan the code with the camera 📷") }));
      var qb = h("div", { class: "qr jn-qr", "aria-hidden": "true" });
      act.appendChild(h("div", { class: "jn-qr-wrap" }, [qb]));
      qr(qb, dl, 220);
      act.appendChild(h("p", { class: "jn-then muted", text: L("Funkar på iPhone och Android.", "Works on iPhone and Android.") }));
    }
  }
  function install() {
    var e = bip;
    if (!e) { setState("manual"); return; }
    bip = null;
    try { e.prompt(); } catch (x) { setState("manual"); return; }   // first thing in the tap (user gesture)
    if (ARR.kind === "join") { if (typedName()) tryJoin(); else lsSet("olnu.jn.pending", ARR.code); }
    Promise.resolve(e.userChoice).catch(function () { return {}; }).then(function (c) {
      setState(c && c.outcome === "accepted" ? "installed" : (bip ? "bip" : "dismissed"));
    });
  }
  function iosPrep() {
    var n = typedName();
    if (needName() && !n) { nameHint(); return; }
    if (n) tryJoin();
    try {
      if (A && A.LIVE && A.hasAccount && A.hasAccount()) {
        var code = A.prepareExport("home");
        if (code) {
          try { history.replaceState(null, "", location.pathname + "?flytt=" + code + location.hash); } catch (e) {}
          A.copyFlytt(A.flyttLink(code));   // inside the tap: iOS allows the clipboard only here
        }
      }
    } catch (e) {}
    iosPrepped = true; renderAct();
  }
  function nameHint() {
    if (!nameInp) return;
    nameInp.focus();
    var w = nameInp.parentNode; w.classList.remove("jn-need"); void w.offsetWidth; w.classList.add("jn-need");
    status(L("👆 Skriv ditt namn först", "👆 Type your name first"), "err");
  }
  function close() {
    if (!root) return;
    handledFlag = true;
    if (nameInp) typedName();
    root.remove(); root = null;
    document.querySelectorAll(".jn-arrow").forEach(function (a) { a.remove(); });
    document.body.classList.remove("jn-on");
    clearTimeout(waitT);
    if (gateRes) { var r = gateRes; gateRes = null; r(); }
    if (joined && A && A.toast) A.toast(L("✅ Du ä med i " + (gname || "gruppen"), "✅ You're in " + (gname || "the group")), { id: "jn" });
  }
  function build() {
    gate = new Promise(function (r) { gateRes = r; });
    document.body.classList.add("jn-on");
    subEl = h("p", { class: "jn-sub", id: "jn-sub", text: subText() });
    memEl = h("p", { class: "jn-mem muted", hidden: true });
    statEl = h("p", { class: "jn-stat", role: "status", "aria-live": "polite", hidden: true });
    act = h("div", { class: "jn-act" });
    var nameBox = null;
    if (needName() && plat !== "inapp" && plat !== "desktop") {
      nameInp = h("input", { class: "inp jn-name", id: "jn-name", maxlength: "30", autocomplete: "nickname", enterkeyhint: "done",
        placeholder: L("Ditt namn, t.ex. Kalle", "Your name, e.g. Sam") });
      nameInp.addEventListener("keydown", function (e) { if (e.key === "Enter") { nameInp.blur(); } });
      nameInp.addEventListener("change", function () { if (typedName()) { status(""); tryJoin(); } });
      nameBox = h("div", { class: "jn-namebox" }, [h("label", { class: "fld", for: "jn-name", text: L("Vad ska gänget kalla dig?", "What should the gang call you?") }), nameInp]);
    }
    root = h("div", { id: "jn-wel", class: "jn-wel", role: "dialog", "aria-modal": "true", "aria-labelledby": "jn-h", "data-plat": plat }, [
      h("div", { class: "jn-card" }, [
        h("div", { class: "jn-kick", text: L("📨 INBJUDAN", "📨 INVITE") }),
        h("div", { class: "jn-big", "aria-hidden": "true", text: "🍺" }),
        h("h2", { class: "jn-h", id: "jn-h", text: L("Välkommen!", "Welcome!") }),
        subEl, memEl, nameBox, act, statEl,
        h("button", { type: "button", class: "jn-skip", text: L("Fortsätt i webbläsaren", "Continue in the browser"), onclick: close }),
        h("p", { class: "jn-18 muted", text: L("🔞 Bara för dig som fyllt 18.", "🔞 18+ only.") })
      ])
    ]);
    document.body.appendChild(root);
    if (plat === "android") {
      if (bip) setState("bip");
      else { setState("wait"); waitT = setTimeout(function () { if (state === "wait") setState("manual"); }, 3000); }
    } else setState(plat);
    // iOS: Safari back after the user opened the home-screen app ≥ 10 s: app.js finishes the flytt and shows its notice.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !root) return;
      setTimeout(function () { if (root && ls("olnu.moved", "")) close(); }, 400);
    });
  }
  if (CARD_ON) { try { build(); } catch (e) { root = null; document.body.classList.remove("jn-on"); } }

  // The installed app (Android shares storage with Chrome): finish a join the card could not do (no name yet).
  function pendingJoin() {
    var c = U.cleanCode(ls("olnu.jn.pending", ""));
    if (c.length !== 6 || root || !A || !A.LIVE || joining) return;
    if (ls("olnu.jn.done", "") === c) { lsSet("olnu.jn.pending", null); return; }
    var tries = 0;
    (function waitIntro() {
      var intro = document.getElementById("intro");
      if ((intro && !intro.hidden) || (A.sheetOpen && A.sheetOpen())) { if (++tries < 90) setTimeout(waitIntro, 1000); return; }
      A.withName(function () {
        joining = true;
        A.rpc("join_group", { p_code: c, p_display_name: A.getName() }).then(function (r) {
          joining = false;
          if (r.error) { lsSet("olnu.jn.pending", null); return; }
          var g = A.parseData(r.data) || {};
          lsSet("olnu.jn.done", c); lsSet("olnu.jn.pending", null);
          A.toast(L("✅ Du ä med i " + (g.name || "gruppen") + "!", "✅ You're in " + (g.name || "the group") + "!"), { id: "jn" });
          try { A.refresh(); } catch (e) {}
        });
      });
    })();
  }

  /* ---------- hooks ---------- */
  function onAuthed() {
    if (root) {
      preview();
      if (!needName() || (nameInp && String(nameInp.value || "").trim())) tryJoin();
      if (state === "ios") renderAct();   // the one-tap button is ready now
    } else pendingJoin();
  }
  window.JOIN = {
    init: function (api) {
      A = api;
      if (!root) return;
      if (state === "ios") renderAct();
      if (A.authed && A.authed()) onAuthed();
    },
    onAuthed: onAuthed,
    applyText: function () {},
    gate: function () { return gate; },
    joined: function (code) { return !!code && joined && ARR && ARR.code === U.cleanCode(code); },
    handled: function () { return handledFlag || !!root; },
    openGroup: function (g, isNew) { openInvite(g, isNew); },
    openApp: function () { openInvite(null, false); },
    // Group page: big primary tile right under 💬 Chatt (polish2 sectOf: .jn-gtile → section 0). Old "Visa kod" goes.
    groupItem: function (g, wrap) {
      if (!A || !A.LIVE || !g || !g.code || !wrap) return;
      var old = wrap.querySelector(".g-acts"); if (old) old.remove();
      var b = h("button", { type: "button", class: "btn ds-btn ds-btn-primary btn-amber jn-big-btn", onclick: function () { openInvite(g, false); } },
        [h("span", { class: "jn-gl", text: L("➕ Bjud in till ", "➕ Invite to ") + (g.name || "") })]);
      wrap.appendChild(h("div", { class: "jn-gtile" }, [b]));
    },
    groupCard: function (g, li) {
      if (!A || !A.LIVE || !g || !g.code || !li) return;
      var b = h("button", { type: "button", class: "jn-cardbtn", "aria-label": L("Bjud in till ", "Invite to ") + (g.name || ""), html: '<span aria-hidden="true">➕</span><span class="jn-cb-t"> ' + L("Bjud in", "Invite") + "</span>",
        onclick: function (e) { e.stopPropagation(); openInvite(g, false); } });
      b.addEventListener("keydown", function (e) { e.stopPropagation(); });
      li.insertBefore(b, li.querySelector(".gcard-go"));
    },
    groupsSheet: function () {
      if (!A || !A.LIVE) return;
      setTimeout(function () {
        var f = document.getElementById("inv-pane-f");
        if (!f || f.querySelector(".jn-app")) return;
        var b = bigBtn(L("➕ Bjud in en ny kompis till appen", "➕ Invite a new friend to the app"), "ds-btn-secondary jn-app", function () { openInvite(null, false); });
        f.insertBefore(b, f.firstChild);
      }, 0);
    },
    _state: function () { return { plat: plat, state: state, joined: joined, arr: ARR, by: BY, gname: gname }; }
  };
})();
