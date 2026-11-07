/* PintsNow v14 — privacy & law (CONTRACT "v14 CLIENT", rewritten by SAFE 2026-11-07):
   🔒 Integritet (true text: e-mail login, Swish, speed data, 30-day location retention, processors, contact),
   🗑️ Radera mitt konto (RPC delete_my_data_v2, migration 0209; falls back to delete_my_data), 🏠 Hemzon (local only),
   plus the v14 strings (undo, sheets, worldwide, all drinks). window.PRIVACY, called by app.js.
   window.PRIVACY also forwards init / onAuthed / settingsSheet to window.SAFETY (js/safety.js), so the app.js
   mods() list needs no new entry. Swedish only. Nothing here breaks the map: a missing RPC only shows a toast. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  var SUPPORT = "support@pintsnow.com", DEL_PAGE = "https://pintsnow.com/radera.html", POLICY = "https://pintsnow.com/integritet.html";
  var HOME_KEY = "olnu.home", HOME_R = 300;

  I.add({
    sv: {
      // Worldwide + all drinks (owner decisions G, H)
      live: function (n) { return "<b>" + n + "</b> ute i världen just nu"; },
      outsideServer: "Servern tar int' emot öl utanför Sverige än – snart!",
      tonight: "Ikväll", beerNo: function (n) { return n + " 🍺 ikväll"; },
      lvlN: function (n) { return "Nr " + n + " ikväll. Skål!"; },
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
      ageTitle: "En sak till", ageText: "PintsNow ä en app för kvällar ute med kompisar. Den ä bara för dig som ä 18 år eller äldre.",
      // Privacy page (SAFE 2026-11-07: must be true – e-mail login, Swish, speed data, retention, processors, contact)
      privBtn: "🔒 Integritet", privTitle: "🔒 Integritet",
      privIntro: "Kort och ärligt: vad PintsNow sparar, varför, vem som ser det och hur länge. PintsNow drivs av en privatperson i Ludvika (Anton Larsson, TuNeLA).",
      privWhatH: "Vad sparas?",
      privWhat: ["Ett konto-id. Kontot ä anonymt tills du själv sparar det med e-post (frivilligt, inloggning med engångskod).",
        "E-post – bara om du sparar kontot. Den används bara för inloggning, aldrig för reklam.",
        "Ditt namn och din avatar, när du sätter dem eller går med i en grupp.",
        "Ålder: bara att du ä 18+ och datumet du svarade. Inte födelseåret.",
        "Drycker: antal, tid och plats (krogen eller ett område).",
        "Plats: din pin, incheckningar och – bara när du startar dem – \"Följ mig hem\" och \"Hitta kompis\".",
        "Det du skickar: chatt, bilder, röstklipp, direktmeddelanden, event, tips och önskemål.",
        "Swish-nummer – bara om du själv lägger in det för att dela notan. Alla i gruppen ser numret.",
        "Notiser: din notis-adress och ett område på ~1 km (bara om du slår på notiser).",
        "Snabbhetsdata: telefonmodell, webbläsare, appversion, laddtid och fel. För att hitta buggar.",
        "Anmälningar och blockeringar som du gör, och anmälningar om dina inlägg."],
      privSeeH: "Vem ser vad?",
      privSee: ["Dina grupper: ditt namn, din avatar, din exakta pin, hur många du loggat ikväll, din incheckning och chatten.",
        "Alla andra: bara krogen eller ett område på ~500 m. Inget namn och inget antal. Tiden avrundas till 15 min och pinnen byter id var 10:e minut, så ingen kan följa dig.",
        "👻 Spökläge: ingen ser din pin. 🏠 Hemzon: nära hemmet visas bara ett område (hemzonen sparas bara på telefonen).",
        "🚫 Blockerar du nån ser ni int' varandras chatt, bilder, röstklipp eller pin."],
      privWhyH: "Varför får vi spara det?",
      privWhy: ["Kartan, grupperna och chatten: för att ge dig tjänsten du bett om (avtal, GDPR art. 6.1 b).",
        "E-post, notiser, Swish-nummer, bilder och röst: bara när du själv lägger in eller skickar dem (samtycke, art. 6.1 a). Du kan ta bort dem när du vill.",
        "Snabbhetsdata, anmälningar och blockeringar: för att appen ska fungera och vara trygg (berättigat intresse, art. 6.1 f)."],
      privLongH: "Hur länge?",
      privLong: ["Pins, chatt, bilder, röstklipp och incheckningar försvinner ur appen kl 05:00 (en grupp kan välja att spara sin chatt).",
        "Exakta platser tas bort ur databasen efter 30 dagar. Kvar blir bara ett grovt område (~5 km) för statistik och medaljer. Varför 30 dagar: \"Mina kvällar\" visar 30 dagar bakåt, och vi behöver tid att hantera anmälningar.",
        "Telefonmodell och webbläsare tas bort efter 30 dagar.",
        "Medaljer, meriter och kvällsstatistik finns kvar så länge kontot finns.",
        "Raderar du kontot försvinner allt om dig direkt (se nedan)."],
      privWhoH: "Vilka hjälper oss?",
      privWho: ["Supabase – databas och inloggning (servrar i EU, Paris).",
        "Mapbox – kartan. Mapbox ser din IP-adress och vilket kartområde du tittar på (USA, EU-avtal om dataöverföring).",
        "GitHub Pages – visar själva appen och ser din IP-adress.",
        "Google Workspace – e-posten till och från " + SUPPORT + ".",
        "Push-tjänsterna i din telefon (Google, Apple, Mozilla) – bara om du slår på notiser. Reservkartan (Esri/Carto) och Google Fonts ser din IP-adress."],
      privNoH: "Det gör vi int'",
      privNo: ["Ingen reklam. Ingen spårning mellan appar. Vi säljer ingen data."],
      privDelH: "Radera",
      privDel: "⚙️ Inställningar → \"🗑️ Radera mitt konto\": namn, avatar, e-post, chatt, bilder, röstklipp, meddelanden, Swish-nummer, platser, notiser och själva kontot raderas. Delade saker, som en grupp du skapat, blir kvar för de andra – utan dig. Har du tappat appen? Gå till pintsnow.com/radera.",
      privAge: "🔞 PintsNow ä för dig som ä 18 år eller äldre.",
      privContactH: "Frågor?",
      privContact: "Vill du se din data, rätta den eller klaga? Mejla " + SUPPORT + ". Du kan också klaga hos Integritetsskyddsmyndigheten (imy.se).",
      // Delete all (v2: real deletion, 0209)
      delBtn: "🗑️ Radera mitt konto",
      delQ1: "Vill du radera ditt konto och allt om dig?",
      delInfo: "Allt om dig raderas: namn, avatar, e-post, chatt, bilder, röstklipp, meddelanden, Swish-nummer, platser, notiser och kontot. Du lämnar alla grupper. Det går int' att ångra. Telefonen rensas och appen startar om som ny.",
      delYes1: "Ja, radera", delQ2: "Helt säker? Det går int' att ångra.", delYes2: "🗑️ Radera nu",
      delBusy: "Raderar…", delDone: "🗑️ Ditt konto ä raderat. Appen startar om.",
      delMissing: "Servern kan int' radera än. Mejla " + SUPPORT + " så raderar vi åt dig.", delFail: "Det gick int' att radera. Försök igen, eller mejla " + SUPPORT + ".",
      // Home zone
      homeH: "🏠 Min hemzon",
      homeInfo: "Öl inom 300 m från hemmet visas alltid som ungefärlig plats (om du int' väljer en krog). Sparas bara på din telefon.",
      homeSet: "📍 Sätt hemzon här", homeClear: "Ta bort hemzonen", homeSaved: "🏠 Hemzonen ä sparad.",
      homeCleared: "Hemzonen ä borttagen.", homeIsOn: "🏠 Hemzon på (300 m)", homeIsOff: "Ingen hemzon satt."
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
    if (window.HOMEZONE && window.HOMEZONE.ready) return;   // v28: ⚙️ "🏠 Hemzon" under the name (js/homezone.js)
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
    body.appendChild(el("h3", { text: t("privWhyH") })); body.appendChild(ul(t("privWhy")));
    body.appendChild(el("h3", { text: t("privLongH") })); body.appendChild(ul(t("privLong")));
    body.appendChild(el("h3", { text: t("privWhoH") })); body.appendChild(ul(t("privWho")));
    body.appendChild(el("h3", { text: t("privNoH") })); body.appendChild(ul(t("privNo")));
    body.appendChild(el("h3", { text: t("privDelH") })); body.appendChild(el("p", { text: t("privDel") }));
    body.appendChild(el("p", { text: t("privAge") }));
    body.appendChild(el("h3", { text: t("privContactH") }));
    body.appendChild(el("p", { text: t("privContact") }));
    body.appendChild(el("p", {}, [el("a", { href: "mailto:" + SUPPORT, text: "✉️ " + SUPPORT }), " · ",
      el("a", { href: POLICY, target: "_blank", rel: "noopener noreferrer", text: "pintsnow.com/integritet" }), " · ",
      el("a", { href: DEL_PAGE, target: "_blank", rel: "noopener noreferrer", text: "pintsnow.com/radera" })]));
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
    // v2 (0209) really deletes, also the login. Old server (PGRST202) → v1 (anonymises).
    unsub.then(function () { return A.rpc("delete_my_data_v2"); }).then(function (r) {
      if (r.error && U.missing(r.error)) return A.rpc("delete_my_data");
      var d = A.parseData(r.data) || {};
      if (!r.error && d.ok === false) return { data: null, error: { message: "delete_incomplete" } };
      return r;
    }).then(function (r) {
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
        try { if (window.indexedDB) indexedDB.deleteDatabase("olnu-photos"); } catch (e) {}
        setTimeout(function () { location.replace(location.pathname); }, 1200);
      });
    });
  }

  // 🛡️ js/safety.js gets its hooks through PRIVACY (already in the app.js mods() list).
  function fw(fn, a, b) { var S = window.SAFETY; if (S && typeof S[fn] === "function") { try { return S[fn](a, b); } catch (e) { try { console.warn("olnu safety " + fn, e); } catch (x) {} } } }
  window.PRIVACY = {
    init: function (api) { A = api; fw("init", api); },
    onAuthed: function (a) { fw("onAuthed", a); },
    settingsSheet: function (body) { fw("settingsSheet", body); },
    showPrivacy: showPrivacy,
    fillPrivacy: function (body, back) { fillPrivacy(body, back); },
    showDelete: showDelete,
    homeBlock: function (body) { homeBlock(body); },
    inHome: inHome,
    home: home
  };
})();
