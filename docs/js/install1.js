/* Öl Nu — 📲 INSTALL1: the first visit in a browser tab shows how to install on THIS device (owner 2026-11-07:
   "a QR code on the same phone is useless"). Main action = install. A small "Använd utan att installera" link in the
   corner. The app tour (intro + age check) waits until the card is closed, so the tour is shown in the app.
     Android  beforeinstallprompt → ONE button "📲 Installera Öl Nu" (prompt() in the tap). No event yet → 3 steps with
              drawn pictures (Chrome ⋮ → Installera app → Installera; Samsung Internet ≡ → Lägg till sida på → Startskärm);
              a later event switches to the button. Installed → "✅ Klart! Öppna Öl Nu från hemskärmen."
     iOS      Dela ⬆️ (iOS 26: ⋯ → Dela) → Lägg till på hemskärmen ➕ → Lägg till, with drawn pictures.
     In-app   (Instagram, Messenger …) → open in Safari/Chrome + 📋 Kopiera länk.
     Desktop  the QR code of the app link (scan with the phone) — here it is useful.
   Shown once per browser, only when: not standalone, intro not done, no join/invite card (JOIN.handled), no ?flytt=.
   app.js waits for INSTALL1.gate() after JOIN.gate() (patch ux3/01). Uses join.css .jn-pic pictures + ux3.css.
   localStorage: olnu.inst1 (time the card was closed). Public: window.INSTALL1 = { gate, kind, show }. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var KEY = "olnu.inst1";
  var prompt = null, installed = false, root = null, act = null, resolveGate = null;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function ua() { return navigator.userAgent || ""; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function standalone() { try { return U && U.isStandalone ? U.isStandalone() : false; } catch (e) { return false; } }
  function isIOS() { try { return U && U.isIOS ? U.isIOS() : /iPad|iPhone|iPod/.test(ua()); } catch (e) { return false; } }
  function inApp() { return /FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|Messenger|TikTok|musical_ly|LinkedInApp|Twitter|; wv\)/i.test(ua()); }
  function kind() {
    if (inApp()) return "inapp";
    if (isIOS()) return "ios";
    if (/Android/i.test(ua())) return "android";
    if (/Mobi/i.test(ua())) return "android";
    return "desktop";
  }
  function appLink() { return location.origin + location.pathname; }
  window.addEventListener("beforeinstallprompt", function (e) { try { e.preventDefault(); } catch (x) {} prompt = e; if (root) render(); });
  window.addEventListener("appinstalled", function () { installed = true; prompt = null; if (root) render(); });

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function step(n, html, pic) { return h("li", { class: "ui-step" }, [h("span", { class: "ui-n", text: String(n) }), h("div", { class: "ui-st" }, [h("p", { html: html }), pic || null])]); }
  // Drawn pictures (no images to load). Same look as join.js.
  function picBar(hot, url, left) {
    return h("div", { class: "jn-pic jn-pic-bar", "aria-hidden": "true" }, [left ? h("span", { text: left }) : null, h("span", { class: "jn-pic-url", text: url }), h("span", { class: "jn-pic-hot", text: hot })]);
  }
  function picMenu(rows, hotIx) {
    return h("div", { class: "jn-pic jn-pic-menu", "aria-hidden": "true" }, rows.map(function (t, i) { return h("span", { class: i === hotIx ? "jn-pic-hot" : "", text: t }); }));
  }
  function picDlg(title, ok) {
    return h("div", { class: "jn-pic jn-pic-dlg", "aria-hidden": "true" }, [h("b", { text: title }),
      h("div", {}, [h("span", { text: L("Avbryt", "Cancel") }), h("span", { class: "jn-pic-hot", text: ok })])]);
  }
  function host() { return location.host || "tunela.github.io"; }
  function bigBtn(text, fn) { return h("button", { type: "button", class: "btn btn-amber btn-block ds-btn ds-btn-primary ui-big", text: text, onclick: fn }); }

  function render() {
    if (!act) return;
    act.innerHTML = "";
    var k = kind();
    if (installed) {
      act.appendChild(h("div", { class: "ui-done" }, [h("b", { text: L("✅ Klart! Öl Nu ligger på hemskärmen.", "✅ Done! Öl Nu is on your home screen.") }),
        h("p", { text: L("Öppna appen från hemskärmen 🍺 Du kan stänga den här fliken.", "Open the app from the home screen 🍺 You can close this tab.") })]));
      return;
    }
    if (k === "android" && prompt) {
      act.appendChild(bigBtn(L("📲 Installera Öl Nu", "📲 Install Öl Nu"), function () {
        var p = prompt; if (!p) return;
        try { p.prompt(); } catch (e) {}
        Promise.resolve(p.userChoice).catch(function () {}).then(function (c) {
          prompt = null;
          if (c && c.outcome === "accepted") installed = true;
          render();
        });
      }));
      act.appendChild(h("p", { class: "ui-sub muted", text: L("Ett tryck. Sen ligger den på hemskärmen som en vanlig app.", "One tap. Then it sits on your home screen like a normal app.") }));
      return;
    }
    var ol = h("ol", { class: "ui-steps" });
    if (k === "android") {
      var sam = /SamsungBrowser/i.test(ua());
      if (sam) {
        ol.appendChild(step(1, L("Tryck <b>≡</b> nere till höger", "Tap <b>≡</b> at the bottom right"), picBar("≡", host())));
        ol.appendChild(step(2, L("Tryck <b>Lägg till sida på</b> → <b>Startskärm</b>", "Tap <b>Add page to</b> → <b>Home screen</b>"),
          picMenu([L("Bokmärken", "Bookmarks"), L("➕ Lägg till sida på", "➕ Add page to"), L("Startskärm", "Home screen")], 2)));
        ol.appendChild(step(3, L("Tryck <b>Lägg till</b>. Öppna sen <b>Öl Nu</b> från startskärmen 🍺", "Tap <b>Add</b>. Then open <b>Öl Nu</b> from the home screen 🍺"), picDlg(L("Lägg till på startskärmen?", "Add to home screen?"), L("Lägg till", "Add"))));
      } else {
        ol.appendChild(step(1, L("Tryck <b>⋮</b> uppe till höger", "Tap <b>⋮</b> at the top right"), picBar("⋮", "🔒 " + host())));
        ol.appendChild(step(2, L("Tryck <b>Installera app</b> (eller <b>Lägg till på startskärmen</b>)", "Tap <b>Install app</b> (or <b>Add to Home screen</b>)"),
          picMenu([L("Ny flik", "New tab"), L("Bokmärken", "Bookmarks"), L("📲 Installera app", "📲 Install app")], 2)));
        ol.appendChild(step(3, L("Tryck <b>Installera</b>. Öppna sen <b>Öl Nu</b> från startskärmen 🍺", "Tap <b>Install</b>. Then open <b>Öl Nu</b> from the home screen 🍺"), picDlg(L("Installera Öl Nu?", "Install Öl Nu?"), L("Installera", "Install"))));
      }
      act.appendChild(ol);
    } else if (k === "ios") {
      var v26 = /OS 26_|Version\/26/.test(ua());
      ol.appendChild(step(1, v26 ? L("Tryck <b>⋯</b> nere till höger, sen <b>Dela</b> ⬆️", "Tap <b>⋯</b> at the bottom right, then <b>Share</b> ⬆️")
        : L("Tryck <b>Dela</b> ⬆️ nere i mitten", "Tap <b>Share</b> ⬆️ at the bottom"), v26 ? picBar("⋯", host(), "‹") : h("div", { class: "jn-pic jn-pic-bar jn-pic-ios", "aria-hidden": "true" }, [h("span", { text: "‹ ›" }), h("span", { class: "jn-pic-hot", text: "⬆️" }), h("span", { text: "📖 ⧉" })])));
      ol.appendChild(step(2, L("Scrolla ner och tryck <b>Lägg till på hemskärmen</b> ➕", "Scroll down and tap <b>Add to Home Screen</b> ➕"),
        picMenu([L("Kopiera", "Copy"), L("Lägg till bokmärke", "Add Bookmark"), L("➕ Lägg till på hemskärmen", "➕ Add to Home Screen")], 2)));
      ol.appendChild(step(3, L("Tryck <b>Lägg till</b> uppe till höger. Öppna sen <b>Öl Nu</b> från hemskärmen 🍺", "Tap <b>Add</b> at the top right. Then open <b>Öl Nu</b> from the home screen 🍺"),
        h("div", { class: "jn-pic jn-pic-bar", "aria-hidden": "true" }, [h("span", { text: L("Avbryt", "Cancel") }), h("span", { class: "jn-pic-url", text: "🍺 Öl Nu" }), h("span", { class: "jn-pic-hot", text: L("Lägg till", "Add") })])));
      act.appendChild(ol);
      act.appendChild(h("div", { class: "ui-arrow" + (v26 ? " ui-arrow-r" : ""), "aria-hidden": "true", text: "⬇" }));
    } else if (k === "inapp") {
      var and = /Android/i.test(ua());
      act.appendChild(h("p", { class: "ui-sub", text: L("Den här appen kan int' installera Öl Nu. Öppna länken i " + (and ? "Chrome" : "Safari") + ":", "This app can't install Öl Nu. Open the link in " + (and ? "Chrome" : "Safari") + ":") }));
      ol.appendChild(step(1, L("Tryck <b>⋯</b> eller <b>⋮</b> uppe i hörnet", "Tap <b>⋯</b> or <b>⋮</b> in the top corner")));
      ol.appendChild(step(2, L("Välj <b>Öppna i webbläsaren</b>", "Choose <b>Open in browser</b>")));
      act.appendChild(ol);
      act.appendChild(bigBtn(L("📋 Kopiera länk", "📋 Copy link"), function (e) {
        var b = e.currentTarget;
        try { navigator.clipboard.writeText(appLink()).then(function () { b.textContent = L("📋 Kopierad!", "📋 Copied!"); }, function () {}); } catch (x) {}
      }));
    } else {
      act.appendChild(h("p", { class: "ui-sub", text: L("Öl Nu ä gjord för mobilen. Skanna koden med mobilkameran 📷", "Öl Nu is made for your phone. Scan the code with the camera 📷") }));
      var qb = h("div", { class: "qr ui-qr", "aria-hidden": "true" });
      act.appendChild(h("div", { class: "ui-qr-wrap" }, [qb]));
      try { if (window.QRCode) new window.QRCode(qb, { text: appLink(), width: 220, height: 220, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) {}
      act.appendChild(h("p", { class: "ui-sub muted", text: L("Funkar på iPhone och Android.", "Works on iPhone and Android.") }));
    }
  }
  function close() {
    lsSet(KEY, String(Date.now()));
    lsSet("olnu.guideSeen", String(Date.now()));   // the install sheet does not come right after
    if (root) { root.remove(); root = null; act = null; }
    var r = resolveGate; resolveGate = null; if (r) r();
  }
  function show() {
    if (root) return;
    var k = kind();
    root = h("div", { id: "ux-inst", class: "ui-wrap ui-" + k, role: "dialog", "aria-modal": "true", "aria-label": L("Installera Öl Nu", "Install Öl Nu") });
    var skip = h("button", { type: "button", class: "ui-skip", text: L("Använd utan att installera", "Use without installing"), onclick: close });
    act = h("div", { class: "ui-act" });
    var card = h("div", { class: "ui-card" }, [
      h("div", { class: "ui-logo", text: "Öl Nu" }),
      h("h2", { class: "ui-h", text: k === "desktop" ? L("Öl Nu bor i mobilen", "Öl Nu lives on your phone") : L("Lägg Öl Nu på hemskärmen", "Put Öl Nu on your home screen") }),
      h("p", { class: "ui-p", text: L("Då startar den som en riktig app, och du får push när gänget drar ut. Tar 10 sekunder.", "Then it starts like a real app, and you get a push when the gang heads out. Takes 10 seconds.") }),
      act
    ]);
    root.appendChild(skip); root.appendChild(card);
    document.body.appendChild(root);
    try { var ib = document.getElementById("install-banner"); if (ib) ib.hidden = true; } catch (e) {}
    render();
  }
  function want() {
    if (standalone()) return false;
    if (lsGet("olnu.intro") === "1" || lsGet(KEY)) return false;
    if (window.JOIN && window.JOIN.handled && window.JOIN.handled()) return false;
    if (/[?&](flytt|chat|sos)=/.test(location.search)) return false;
    return true;
  }
  function gate() {
    if (!want()) return Promise.resolve();
    return new Promise(function (r) { resolveGate = r; show(); });
  }
  window.INSTALL1 = { gate: gate, kind: kind, show: show, _close: close };
})();
