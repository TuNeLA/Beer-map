/* Öl Nu v14 — privacy & law (CONTRACT "v14 CLIENT"):
   🔒 Integritet page, 🗑️ Radera allt om mig (RPC delete_my_data, migration 0016), 🏠 Hemzon (local only),
   plus the v14 strings (undo, sheets, worldwide, all drinks). window.PRIVACY, called by app.js.
   Nothing here breaks the map: a missing RPC only shows a toast. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  var REPO = "https://github.com/TuNeLA/Beer-map/issues";
  var HOME_KEY = "olnu.home", HOME_R = 300;

  I.add({
    sv: {
      // Worldwide + all drinks (owner decisions G, H)
      live: function (n) { return "<b>" + n + "</b> dricker i världen just nu"; },
      outsideServer: "Servern tar int' emot öl utanför Sverige än – snart!",
      tonight: "Ikväll", beerNo: function (n) { return n + " 🍺 ikväll"; },
      lvlN: function (n) { return n >= 10 ? "Nr " + n + " ikväll. Ta ett glas vatten nu, kompis." : "Nr " + n + " ikväll. Skål!"; },
      // Undo
      undoBtn: "ÅNGRA", undoBusy: "Ångrar…",
      undoReported: function (n) { return "🍺 Nr " + n + " rapporterad"; },
      undoToasts: ["↩️ Ölen ä ogjord. Ölguden låtsas att han int' såg.", "↩️ Spolat tillbaka. Den ölen fanns aldrig.",
        "↩️ Ångrat! Kapsylen sitter på igen.", "↩️ Okej, vi säger att du bara höll i den åt en kompis.",
        "↩️ Borta. Bartendern har redan glömt den.", "↩️ Felklick? Inga problem, soldat. Ölen ä struken.",
        "↩️ Tidsmaskinen funkar. Ölen ä tillbaka i kylen.", "↩️ Struken ur protokollet. Ingen såg nåt.",
        "↩️ Ölen avbokad. Glaset ä fullt igen – i teorin.", "↩️ Backat! Räkneverket står där det stod."],
      undoTooLate: "För sent att ångra – ölen ä redan i historieböckerna.",
      undoLimit: "Max 3 ångra per kväll. Den här får stå kvar.",
      undoNone: "Det finns ingen öl att ångra.", undoFail: "Kunde inte ångra. Försök igen.",
      // Var dricker du?
      whereCancel: "Ingen öl rapporterad.", wherePlaces: "🍽️ Restauranger & caféer",
      whereArea: "📍 Bara område (ingen krog)", whereExact: "📌 Exakt här",
      homeNote: "🏠 Hemzon: ungefärlig plats",
      // Own pin
      hidePin: "🙈 Göm min pin",
      placeTypes: { restaurant: "Restaurang", fast_food: "Snabbmat", cafe: "Café" },
      // Session repair
      reauthTitle: "Din inloggning gick ut",
      reauthText: "Appen kan inte nå ditt konto. Om du fortsätter får du ett nytt, tomt konto och tappar dina grupper och din statistik. Har du en flyttkod från en annan app/telefon? Klistra in den i stället.",
      reauthNew: "Fortsätt med nytt konto", reauthFlytt: "📥 Jag har en flyttkod", reauthRetry: "🔄 Försök igen",
      // 18+
      ageTitle: "En sak till", ageText: "Öl Nu handlar om alkohol. Appen ä bara för dig som ä 18 år eller äldre.",
      // Privacy page
      privBtn: "🔒 Integritet", privTitle: "🔒 Integritet",
      privIntro: "Kort och ärligt: det här sparar Öl Nu, vem som ser det och hur länge.",
      privWhatH: "Vad sparas på servern?",
      privWhat: ["Ett anonymt konto-id. Ingen e-post, inget telefonnummer, inget lösenord.",
        "Ditt namn – bara när du skapar eller går med i en grupp. Bara dina grupper ser det.",
        "Dina öl och andra drycker: antal, tid och plats.",
        "Incheckningar (krog och tid), gruppchatt, inkallelser, kö-rapporter, tips och ölsorter.",
        "Notiser: din notis-adress och ett område på ~1 km (bara om du slår på notiser).",
        "Fakta för medaljer och statistik: öl per vecka och kväll, vilka krogar, ett område på ~50 km.",
        "Anonyma värmepunkter (utan konto-id)."],
      privSeeH: "Vem ser vad?",
      privSee: ["Din grupp: ditt namn, din exakta pin, dina öl, din incheckning och chatten.",
        "Alla andra: bara krogen du ä på eller ett område på ~500 m. Inget namn. Tiden avrundas till 15 min och pinnen byter id var 10:e minut, så ingen kan följa dig.",
        "👻 Spökläge: ölen räknas men ingen ser din pin.",
        "🏠 Hemzon: öl inom 300 m från ditt hem visas bara som område (sparas bara på din telefon)."],
      privLongH: "Hur länge?",
      privLong: ["Pins, chatt, incheckningar och inkallelser försvinner från kartan kl 05:00. Raderna ligger kvar i databasen tills en automatisk städning finns (den ä int' byggd än).",
        "Medaljer och statistik sparas så länge kontot finns.",
        "Anonyma värmepunkter: ungefär 10 dagar."],
      privNoH: "Det gör vi int'",
      privNo: ["Ingen reklam. Ingen spårning. Vi säljer ingen data.",
        "Kartbilder kommer från Esri och teckensnitt från Google Fonts – de ser din IP-adress när de skickar bilderna. Servern ä Supabase, appen ligger på GitHub Pages."],
      privDelH: "Radera",
      privDel: "Under ⚙️ Inställningar → \"🗑️ Radera allt om mig\": du lämnar dina grupper, notiserna stängs av och allt som ä kopplat till dig blir anonymt (det går int' att koppla till dig igen). Anonyma siffror i totalerna finns kvar. Sen rensas telefonen.",
      privAge: "🔞 Appen ä för dig som ä 18 år eller äldre. Drick lagom.",
      privContactH: "Frågor?",
      privContact: "Skriv ett ärende på GitHub:",
      // Delete all
      delBtn: "🗑️ Radera allt om mig",
      delQ1: "Vill du radera allt om dig?",
      delInfo: "Du lämnar alla grupper, notiserna stängs av, din pin försvinner och allt som ä kopplat till ditt konto blir anonymt. Din telefon rensas och appen startar om som ny.",
      delYes1: "Ja, radera", delQ2: "Helt säker? Det går int' att ångra.", delYes2: "🗑️ Radera nu",
      delBusy: "Raderar…", delDone: "🗑️ Allt om dig ä raderat. Appen startar om.",
      delMissing: "Servern kan int' radera än. Försök igen senare.", delFail: "Det gick int' att radera. Försök igen.",
      // Home zone
      homeH: "🏠 Min hemzon",
      homeInfo: "Öl inom 300 m från hemmet visas alltid som ungefärlig plats (om du int' väljer en krog). Sparas bara på din telefon.",
      homeSet: "📍 Sätt hemzon här", homeClear: "Ta bort hemzonen", homeSaved: "🏠 Hemzonen ä sparad.",
      homeCleared: "Hemzonen ä borttagen.", homeIsOn: "🏠 Hemzon på (300 m)", homeIsOff: "Ingen hemzon satt."
    },
    en: {
      live: function (n) { return "<b>" + n + "</b> drinking in the world now"; },
      outsideServer: "The server does not take beers outside Sweden yet – soon!",
      tonight: "Tonight", beerNo: function (n) { return n + " 🍺 tonight"; },
      lvlN: function (n) { return "No. " + n + " tonight. Cheers!"; },
      undoBtn: "UNDO", undoBusy: "Undoing…",
      undoReported: function (n) { return "🍺 No. " + n + " reported"; },
      undoToasts: ["↩️ Beer undone. The beer god pretends he did not see.", "↩️ Rewound. That beer never happened.",
        "↩️ Undone! The cap is back on.", "↩️ Fine, you were just holding it for a friend.",
        "↩️ Gone. The bartender already forgot it.", "↩️ Mis-tap? No problem, soldier. Beer removed.",
        "↩️ The time machine works. The beer is back in the fridge.", "↩️ Struck from the record. Nobody saw a thing.",
        "↩️ Beer cancelled. The glass is full again – in theory.", "↩️ Reversed! The counter is back where it was."],
      undoTooLate: "Too late to undo – that beer is history.",
      undoLimit: "Max 3 undos per night. This one stays.",
      undoNone: "There is no beer to undo.", undoFail: "Could not undo. Try again.",
      whereCancel: "No beer reported.", wherePlaces: "🍽️ Restaurants & cafés",
      whereArea: "📍 Area only (no bar)", whereExact: "📌 Exactly here",
      homeNote: "🏠 Home zone: approximate spot",
      hidePin: "🙈 Hide my pin",
      placeTypes: { restaurant: "Restaurant", fast_food: "Fast food", cafe: "Café" },
      reauthTitle: "Your sign-in expired",
      reauthText: "The app cannot reach your account. If you continue you get a new, empty account and lose your groups and stats. Do you have a move code from another app/phone? Paste it instead.",
      reauthNew: "Continue with a new account", reauthFlytt: "📥 I have a move code", reauthRetry: "🔄 Try again",
      ageTitle: "One more thing", ageText: "Öl Nu is about alcohol. The app is only for people who are 18 or older.",
      privBtn: "🔒 Privacy", privTitle: "🔒 Privacy",
      privIntro: "Short and honest: what Öl Nu keeps, who sees it and for how long.",
      privWhatH: "What is stored on the server?",
      privWhat: ["An anonymous account id. No e-mail, no phone number, no password.",
        "Your name – only when you create or join a group. Only your groups see it.",
        "Your beers and other drinks: count, time and place.",
        "Check-ins (bar and time), group chat, call-outs, queue reports, tips and beer types.",
        "Notifications: your push address and a ~1 km area (only if you turn notifications on).",
        "Facts for medals and stats: beers per week and night, which bars, a ~50 km region.",
        "Anonymous heat points (no account id)."],
      privSeeH: "Who sees what?",
      privSee: ["Your group: your name, your exact pin, your beers, your check-in and the chat.",
        "Everybody else: only the bar you are at or a ~500 m area. No name. The time is rounded to 15 min and the pin gets a new id every 10 minutes, so nobody can follow you.",
        "👻 Ghost mode: the beer counts but nobody sees your pin.",
        "🏠 Home zone: beers within 300 m of your home show only as an area (kept on your phone only)."],
      privLongH: "For how long?",
      privLong: ["Pins, chat, check-ins and call-outs leave the map at 05:00. The rows stay in the database until an automatic cleanup exists (not built yet).",
        "Medals and stats are kept as long as the account exists.",
        "Anonymous heat points: about 10 days."],
      privNoH: "What we do not do",
      privNo: ["No ads. No tracking. We do not sell data.",
        "Map images come from Esri and fonts from Google Fonts – they see your IP address when they send them. The server is Supabase, the app is on GitHub Pages."],
      privDelH: "Delete",
      privDel: "In ⚙️ Settings → \"🗑️ Delete everything about me\": you leave your groups, notifications turn off and everything linked to you becomes anonymous (it can never be linked to you again). Anonymous numbers in the totals stay. Then the phone is cleared.",
      privAge: "🔞 The app is for people who are 18 or older. Drink responsibly.",
      privContactH: "Questions?",
      privContact: "Open an issue on GitHub:",
      delBtn: "🗑️ Delete everything about me",
      delQ1: "Delete everything about you?",
      delInfo: "You leave all groups, notifications turn off, your pin goes away and everything linked to your account becomes anonymous. Your phone is cleared and the app starts again as new.",
      delYes1: "Yes, delete", delQ2: "Completely sure? This cannot be undone.", delYes2: "🗑️ Delete now",
      delBusy: "Deleting…", delDone: "🗑️ Everything about you is deleted. The app restarts.",
      delMissing: "The server cannot delete yet. Try again later.", delFail: "Could not delete. Try again.",
      homeH: "🏠 My home zone",
      homeInfo: "Beers within 300 m of home always show as an approximate spot (unless you pick a bar). Kept on your phone only.",
      homeSet: "📍 Set home zone here", homeClear: "Remove home zone", homeSaved: "🏠 Home zone saved.",
      homeCleared: "Home zone removed.", homeIsOn: "🏠 Home zone on (300 m)", homeIsOff: "No home zone set."
    }
  });

  /* ---------- 🏠 Hemzon (local only) ---------- */
  function home() {
    var h = U.ls.getJSON(HOME_KEY, null);
    return h && isFinite(h.lat) && isFinite(h.lng) ? h : null;
  }
  function inHome(lat, lng) {
    var h = home();
    return !!(h && isFinite(lat) && isFinite(lng) && U.haversine(lat, lng, h.lat, h.lng) <= (h.r || HOME_R));
  }
  function homeBlock(body) {
    var el = A.el;
    body.appendChild(el("h3", { text: t("homeH") }));
    body.appendChild(el("p", { class: "muted", style: "margin-top:0", text: t("homeInfo") }));
    var st = el("p", { class: "home-state", text: home() ? t("homeIsOn") : t("homeIsOff") });
    body.appendChild(st);
    var row = el("div", { class: "row" });
    var set = A.btn(t("homeSet"), "btn-small", function () {
      set.disabled = true;
      A.getPosition().then(function (pos) {
        U.ls.setJSON(HOME_KEY, { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), r: HOME_R, at: Date.now() });
        st.textContent = t("homeIsOn"); clr.hidden = false;
        A.toast(t("homeSaved"));
      }, A.locError).then(function () { set.disabled = false; });
    });
    var clr = A.btn(t("homeClear"), "btn-small btn-ghost", function () {
      U.ls.del(HOME_KEY); st.textContent = t("homeIsOff"); clr.hidden = true; A.toast(t("homeCleared"));
    });
    clr.hidden = !home();
    row.appendChild(set); row.appendChild(clr);
    body.appendChild(row);
  }

  /* ---------- 🔒 Integritet ---------- */
  function fillPrivacy(body, back) {
    var el = A.el;
    var ul = function (items) { return el("ul", { class: "priv-list" }, (items || []).map(function (x) { return el("li", { text: x }); })); };
    if (back) body.appendChild(el("div", { class: "row", style: "margin-bottom:6px" }, [A.btn(t("back"), "btn-small", back)]));
    body.appendChild(el("p", { text: t("privIntro") }));
    body.appendChild(el("h3", { text: t("privWhatH") })); body.appendChild(ul(t("privWhat")));
    body.appendChild(el("h3", { text: t("privSeeH") })); body.appendChild(ul(t("privSee")));
    body.appendChild(el("h3", { text: t("privLongH") })); body.appendChild(ul(t("privLong")));
    body.appendChild(el("h3", { text: t("privNoH") })); body.appendChild(ul(t("privNo")));
    body.appendChild(el("h3", { text: t("privDelH") })); body.appendChild(el("p", { text: t("privDel") }));
    body.appendChild(el("p", { text: t("privAge") }));
    body.appendChild(el("h3", { text: t("privContactH") }));
    body.appendChild(el("p", {}, [t("privContact") + " ", el("a", { href: REPO, target: "_blank", rel: "noopener noreferrer", text: "github.com/TuNeLA/Beer-map" })]));
  }
  function showPrivacy(back) {
    A.openSheet(t("privTitle"), function (body) { fillPrivacy(body, back); }, { now: true });
  }

  /* ---------- 🗑️ Radera allt om mig ---------- */
  function showDelete() {
    var el = A.el;
    A.openSheet(t("delBtn"), function (body) {
      body.appendChild(el("p", { html: "<b>" + esc(t("delQ1")) + "</b>" }));
      body.appendChild(el("p", { class: "muted", text: t("delInfo") }));
      var box = el("div");
      var first = A.btn(t("delYes1"), "btn-danger", function () {
        first.disabled = true;
        box.appendChild(el("div", { class: "confirm" }, [
          el("p", { html: "<b>" + esc(t("delQ2")) + "</b>" }),
          el("div", { class: "row" }, [
            A.btn(t("cancel"), "btn-small", function () { A.closeSheet(); }),
            A.btn(t("delYes2"), "btn-small btn-danger", function (ev) { runDelete(ev.currentTarget); })
          ])
        ]));
      });
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [A.btn(t("cancel"), "", function () { A.closeSheet(); }), first]));
      body.appendChild(box);
    }, { now: true });
  }
  var deleting = false;
  function runDelete(button) {
    if (deleting) return;
    if (!A.authed()) { A.toast(t("connecting")); return; }
    deleting = true;
    if (button) { button.disabled = true; button.textContent = t("delBusy"); }
    // This phone's push subscription goes first (max 3 s); the server removes all of them anyway.
    var unsub = window.PUSH && window.PUSH.supported() ? Promise.race([window.PUSH.disable(A.rpc).catch(function () {}),
      new Promise(function (r) { setTimeout(r, 3000); })]) : Promise.resolve();
    unsub.then(function () { return A.rpc("delete_my_data"); }).then(function (r) {
      if (r.error) {
        deleting = false;
        if (button) { button.disabled = false; button.textContent = t("delYes2"); }
        A.toast(U.missing(r.error) ? t("delMissing") : t("delFail"), { err: true, ms: 7000 });
        return;
      }
      A.toast(t("delDone"), { ms: 0 });
      var cl = A.client();
      var out = cl && cl.auth ? Promise.race([Promise.resolve(cl.auth.signOut()).catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })]) : Promise.resolve();
      out.then(function () {
        try {
          var ks = [];
          for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("olnu") === 0) ks.push(k); }
          ks.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        setTimeout(function () { location.replace(location.pathname); }, 1200);
      });
    });
  }

  window.PRIVACY = {
    init: function (api) { A = api; },
    showPrivacy: showPrivacy,
    fillPrivacy: function (body, back) { fillPrivacy(body, back); },
    showDelete: showDelete,
    homeBlock: function (body) { homeBlock(body); },
    inHome: inHome,
    home: home
  };
})();
