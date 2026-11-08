/* PintsNow — 🍺 "Nytt i appen" (one time) + the steps after the address move. CONTRACT "PINTSNOW MOVE".
   Swedish only (owner decision). Hooks (app.js mods): init(api), onAuthed.
   - News: once per account (olnu.newsPn = "1", moves with the account), only for users who did the intro before, and only
     when the user has not tapped yet in this start and no sheet/card is open (else: next start). Never over another sheet.
   - After a move (olnu.movedIn, written by js/handover.js): "Kontot flyttade med" + the steps that fit this phone:
     iPhone Safari that came from an old home-screen icon → put PintsNow on the home screen (flyttkod + cookie ticket),
     Android tab that came from an old installed app → install the new one; 🔔 turn notifications on again (permission
     belongs to the address, so the phone asks once). Then the old push subscription (olnu.oldPush) is removed on the
     server, so nobody gets double notifications. Until then the old one keeps working.
   Public: window.PNMOVE = { open() }. Styles: pnmove.css (.pn-*), ds.css tokens. */
(function () {
  "use strict";
  var U = window.U, A = null, shown = false, bip = null, tries = 0;
  var NEWS = "olnu.newsPn", MOVED = "olnu.movedIn", OLDPUSH = "olnu.oldPush";
  var touched = false;   // the user already tapped / typed in this start: do not interrupt, show it at the next start
  try {
    window.addEventListener("beforeinstallprompt", function (e) { bip = e; });
    ["pointerdown", "keydown"].forEach(function (k) { window.addEventListener(k, function () { touched = true; }, { capture: true, passive: true }); });
  } catch (e) {}
  function cfg() { return window.OLNU_CONFIG || {}; }
  function app() { return String(cfg().APP_ORIGIN || "").replace(/\/+$/, ""); }
  function onNew() { return !!app() && location.origin === app(); }
  function host() { return app().replace(/^https?:\/\//, ""); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function movedIn() { try { var m = JSON.parse(get(MOVED) || "null"); return m && !m.ack ? m : null; } catch (e) { return null; } }
  function ack() { var m = movedIn(); if (m) { m.ack = Date.now(); set(MOVED, JSON.stringify(m)); } }
  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function ios() { return U && U.isIOS ? U.isIOS() : /iPhone|iPad|iPod/.test(navigator.userAgent || ""); }
  function sa() { return U && U.isStandalone ? U.isStandalone() : false; }
  function android() { return /Android/.test(navigator.userAgent || ""); }
  function pushOk() { return !!(A && A.PUSH_ON && window.PUSH && window.PUSH.supported()); }

  var NEWS_ITEMS = [
    ["📅", "Event blir grupper", "Gå med i ett event så får du en egen eventgrupp med chatt."],
    ["📊", "Min kväll", "Din kväll timme för timme: drycker, barer och skål."],
    ["🧑‍🎨", "Skapa din gubbe", "Din karaktär syns i chatten, bland medlemmarna och i NU-listan."],
    ["🎉", "Spel", "Skämskort, Vem i gänget?, Jag har aldrig och Hellre eller? – alla spelar på sin egen telefon."],
    ["🗺️", "Ny karta", "Skarpare och snabbare karta med Skymning och Natt."],
    ["👆", "Smidigare", "Tillbaka-knappen tar ett steg i taget. Dra ner för att stänga."]
  ];

  // Old push subscription (old address) → removed on the server once this address has its own.
  function retireOldPush() {
    var old = get(OLDPUSH);
    if (!old || !pushOk() || Notification.permission !== "granted") return Promise.resolve();
    return window.PUSH.current().then(function (sub) {
      if (!sub || !sub.endpoint || sub.endpoint === old) return;
      return A.rpc("delete_push_subscription", { p_endpoint: old }).then(function (r) { if (r && !r.error) del(OLDPUSH); });
    }).catch(function () {});
  }

  function steps(list) {
    var ol = h("ol", "pn-steps");
    list.forEach(function (s, i) { var li = h("li"); li.appendChild(h("span", "pn-n", String(i + 1))); var t = h("span"); t.innerHTML = s; li.appendChild(t); ol.appendChild(li); });
    return ol;
  }
  function moveSection(body, m) {
    var box = h("section", "pn-sect pn-moved");
    box.appendChild(h("h3", "pn-h", "✅ Ditt konto flyttade med"));
    box.appendChild(h("p", "pn-p", "Namn, grupper, vänner och meriter finns kvar. Adressen är nu " + host() + "."));
    // 🔔 permission belongs to the address: ask once more, inside a tap.
    if (pushOk() && Notification.permission === "default") {
      var pb = A.btn("🔔 Slå på notiser igen", "btn-amber btn-block ds-btn-primary pn-push", function () {
        pb.disabled = true;
        window.PUSH.enable(A.rpc, cfg().VAPID_PUBLIC_KEY).then(function (r) {
          if (r === "on") { pb.textContent = "✅ Notiser på"; retireOldPush(); }
          else { pb.disabled = false; pb.textContent = r === "denied" ? "🔕 Notiser blockerade (ändra i telefonens inställningar)" : "🔔 Försök igen"; }
        }, function () { pb.disabled = false; });
      });
      box.appendChild(h("p", "pn-p pn-muted", "Telefonen frågar en gång till, eftersom adressen är ny."));
      box.appendChild(pb);
    }
    if (ios() && !sa() && m.sa && A.prepareExport) {
      box.appendChild(h("h3", "pn-h", "📲 Lägg PintsNow på hemskärmen"));
      var st = steps(["Tryck <b>Gör klart</b> här nedanför.", "Tryck <b>Dela ⬆️</b> (eller <b>⋯</b>) → <b>Lägg till på hemskärmen</b> → <b>Lägg till</b>.",
        "Öppna <b>PintsNow</b> från hemskärmen. Kontot följer med. Står det <b>Klistra in flyttkod</b>? Tryck på den.", "Ta bort den gamla <b>Öl Nu</b>-ikonen."]);
      var prep = A.btn("📋 Gör klart för hemskärmen", "btn-amber btn-block ds-btn-primary", function () {
        var code = A.prepareExport("home");
        if (!code) return;
        try { history.replaceState(null, "", location.pathname + "?flytt=" + code + location.hash); } catch (e) {}
        A.copyFlytt(A.flyttLink(code));   // inside the tap: iOS allows the clipboard only here
        prep.disabled = true; prep.textContent = "✅ Klart – gör steg 2";
      });
      box.appendChild(st); box.appendChild(prep);
    } else if (android() && !sa() && m.sa) {
      box.appendChild(h("h3", "pn-h", "📲 Installera nya PintsNow"));
      if (bip) {
        var ib = A.btn("📲 Installera PintsNow", "btn-amber btn-block ds-btn-primary", function () {
          var e = bip; bip = null; if (!e) return;
          try { e.prompt(); Promise.resolve(e.userChoice).then(function (c) { ib.textContent = c && c.outcome === "accepted" ? "✅ Installerad" : "📲 Installera PintsNow"; ib.disabled = !!(c && c.outcome === "accepted"); }); } catch (x) {}
        });
        box.appendChild(ib);
      } else box.appendChild(steps(["Tryck på menyn <b>⋮</b> i Chrome (eller <b>≡</b> i Samsung Internet).", "Tryck <b>Installera app</b> eller <b>Lägg till på startskärmen</b>."]));
      box.appendChild(h("p", "pn-p pn-muted", "Sen kan du ta bort den gamla Öl Nu-ikonen: håll fingret på den → Avinstallera."));
    } else if (sa() && m.via === "cookie") {
      box.appendChild(h("p", "pn-p", "📲 Klart! Du kan ta bort den gamla Öl Nu-ikonen från hemskärmen."));
    }
    body.appendChild(box);
  }
  function newsSection(body) {
    var hero = h("section", "pn-hero");
    hero.appendChild(h("div", "pn-logo", "PintsNow"));
    hero.appendChild(h("h2", "pn-title", "Öl Nu heter nu PintsNow 🍺"));
    hero.appendChild(h("p", "pn-p", onNew() ? "Samma app, samma konto, samma gäng. Ny adress: " + host() + "."
      : app() ? "Samma app, samma konto, samma gäng. Snart flyttar vi till " + host() + " – ditt konto följer med av sig självt." : "Samma app, samma konto, samma gäng."));
    body.appendChild(hero);
    var sec = h("section", "pn-sect");
    sec.appendChild(h("h3", "pn-h", "Nytt i appen"));
    var ul = h("ul", "pn-list");
    NEWS_ITEMS.forEach(function (it) {
      var li = h("li", "pn-it");
      li.appendChild(h("span", "pn-e", it[0]));
      var t = h("div", "pn-t"); t.appendChild(h("b", null, it[1])); t.appendChild(h("span", null, it[2]));
      li.appendChild(t); ul.appendChild(li);
    });
    sec.appendChild(ul);
    body.appendChild(sec);
    // 🔒 Safety net before the move: save the account with e-mail (only when e-mail login is on and it is not saved yet).
    var AC = window.ACCOUNT;
    try {
      if (!onNew() && AC && AC.on && AC.on() && AC.saved && !AC.saved() && AC.openSave) {
        var sv = h("section", "pn-sect pn-save");
        sv.appendChild(h("h3", "pn-h", "🔒 Spara ditt konto"));
        sv.appendChild(h("p", "pn-p", "Spara kontot med din e-post innan vi flyttar. Då kan du alltid logga in igen, även på en ny telefon."));
        sv.appendChild(A.btn("🔒 Spara med e-post", "btn-amber btn-block ds-btn-primary", function () { A.closeSheet(); setTimeout(function () { AC.openSave(); }, 250); }));
        body.appendChild(sv);
      }
    } catch (e) {}
  }
  function open(force) {
    if (!A) return false;
    var m = movedIn(), news = force || get(NEWS) !== "1";
    if (!m && !news) return false;
    shown = true;
    if (news) set(NEWS, "1");
    if (m) ack();
    A.openSheet(m && !news ? "🚚 Välkommen till PintsNow" : "🍺 Nytt i appen", function (outer) {
      var body = h("div", "pn-sheet"); outer.appendChild(body);
      if (news) newsSection(body); else if (m) { var hh = h("section", "pn-hero"); hh.appendChild(h("div", "pn-logo", "PintsNow")); body.appendChild(hh); }
      if (m) moveSection(body, m);
      body.appendChild(A.btn("Kör! 🍻", "btn-block pn-go", function () { A.closeSheet(); }));
    });
    return true;
  }
  function blocked() {
    var intro = document.getElementById("intro");
    return (A.sheetOpen && A.sheetOpen()) || (intro && !intro.hidden) || !!document.getElementById("ux-inst") || !!document.querySelector(".jn-wrap:not([hidden])");
  }
  function tryShow() {
    if (shown || !A) return;
    var m = movedIn();
    // News only for people who used the app before (the intro is done); brand-new users get the normal tour.
    if (!m && (get(NEWS) === "1" || get("olnu.intro") !== "1")) return;
    // The move steps matter right now (after a move); the news can wait for a calm start.
    if (!m && touched) return;
    if (blocked()) { if (m && ++tries < 20) setTimeout(tryShow, 3000); return; }
    open(false);
  }
  window.PNMOVE = {
    init: function (api) { A = api; },
    onAuthed: function () {
      retireOldPush();
      if (!shown) setTimeout(tryShow, movedIn() ? 1500 : 3500);
    },
    open: function () { return open(true); }
  };
})();
