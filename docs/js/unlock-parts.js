/* PintsNow — UNLOCK PARTS (lane unlocks, 13 Nov 2026; owner: "real achievements … you unlock outfits, hats and so on").
   Data only + art. Logic and screens are in js/unlocks.js.
   - CAT = 37 achievements. Each one = a server medal "u_*" (SQL 0508 olnu_unlock_list + olnu_unlock_counts, wired by 0509)
     and ONE reward item. Store rule (owner): nothing counts drinks. The keys count bars, towns, län, nights WITH friends,
     events, games, price reports, check-ins, safe walks home, rides, water / läsk, Skåltimmen, photos and seasons.
   - NEW = 12 new avatar items, drawn here in the avatar style (viewBox 0 0 100 100, one light from the top left: H.cel).
     The index of each item is FIXED (= SQL 0508 olnu_avatar_max / olnu_avatar_locks4): hw 44-47, up 31-32, nk 16-17,
     gl 30, fr 11-12, bg 39. A new item in avatar.js must start after these numbers.
   - The other 25 rewards are old locked items: the achievement is ONE MORE way to open them (AVATAR.addPath; the old lock
     still works). Same list as SQL olnu_avatar_locks4.
   - Medal cards: the 37 medals go into MEDALS.CAT (like gw.js / golden.js). Their medal emoji is borrowed from a related
     old medal (no new emoji in this file).
   Public: PN.unlockData = { CAT, NEW, TIER, ready() }. */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};

  /* ---------- Catalog: [id, key, need, tier 1-3, reward "slot:index", PNI icon, emoji from medal, sv name, en name, sv how, en how, sv line] ---------- */
  var ROWS = [
    ["u_pass5", "pass", 5, 1, "bg:36", "passport", "b5", "Stämpelsamlaren", "Stamp collector", "Samla 5 krogar i Ölpasset.", "Collect 5 bars in the passport.", "Fem stämplar i passet. Resan har börjat."],
    ["u_pass10", "pass", 10, 2, "fr:11", "passport", "b15", "Passjägaren", "Passport hunter", "Samla 10 krogar i Ölpasset.", "Collect 10 bars in the passport.", "Tio krogar. Passet ser världsvant ut."],
    ["u_pass25", "pass", 25, 3, "hw:44", "passport", "b40", "Upptäckaren", "The explorer", "Samla 25 krogar i Ölpasset.", "Collect 25 bars in the passport.", "25 krogar. Livingstone hade varit avundsjuk."],
    ["u_town2", "town", 2, 1, "hw:27", "map", "faltresa", "Utflykten", "Day trip", "Var ute i 2 olika orter.", "Go out in 2 different towns.", "Två orter. Du har lämnat hemmaplan."],
    ["u_town5", "town", 5, 2, "up:27", "map", "riksturne", "Turnén", "On tour", "Var ute i 5 olika orter.", "Go out in 5 different towns.", "Fem orter. Bandet är på turné."],
    ["u_town10", "town", 10, 3, "up:31", "globe", "riksturne", "Rikstäckande", "Nationwide", "Var ute i 10 olika orter.", "Go out in 10 different towns.", "Tio orter. Du är rikstäckande nu."],
    ["u_lan3", "lan", 3, 2, "nk:5", "compass", "faltresa", "Dialektjägaren", "Dialect hunter", "Checka in i 3 olika län.", "Check in in 3 different counties.", "Tre län. Snart förstår du alla dialekter."],
    ["u_lan8", "lan", 8, 3, "fr:12", "compass", "riksturne", "Landsvägsriddaren", "Knight of the road", "Checka in i 8 olika län.", "Check in in 8 different counties.", "Åtta län. Sverige är ditt vardagsrum."],
    ["u_gang1", "gang", 1, 1, "nk:8", "users", "samman", "Gänget samlat", "The gang's here", "Var ute en kväll med en kompis nära dig.", "Be out one night with a friend close by.", "Första kvällen med gänget. Så börjar det."],
    ["u_gang5", "gang", 5, 2, "nk:17", "users", "samman", "Trogna gänget", "Loyal gang", "Var ute med gänget 5 kvällar.", "Be out with the gang 5 nights.", "Fem kvällar ihop. Ni är ett gäng nu."],
    ["u_gang20", "gang", 20, 3, "up:32", "users", "samman", "Laget", "The team", "Var ute med gänget 20 kvällar.", "Be out with the gang 20 nights.", "Tjugo kvällar. Ni behöver lagtröjor."],
    ["u_event1", "event", 1, 1, "bg:34", "calendar", "inryckt", "På plats", "Showed up", "Svara ja på en inbjudan från en kompis.", "Say yes to a friend's invite.", "Du sa ja. Det är halva jobbet."],
    ["u_event5", "event", 5, 2, "up:15", "calendar", "alltid", "Evenemangsvan", "Event regular", "Svara ja på 5 inbjudningar.", "Say yes to 5 invites.", "Fem ja. Du är alltid med."],
    ["u_host", "host", 1, 2, "hw:26", "megaphone", "trumslag", "Värden", "The host", "Gör en inbjudan som 3 kompisar säger ja till.", "Make an invite that 3 friends say yes to.", "Tre ja på din inbjudan. Kaptenen har talat."],
    ["u_play1", "play", 1, 1, "gl:19", "game", "lekledare", "Spelsugen", "Game on", "Spela ett partyspel.", "Play a party game.", "Första spelet. Fler kommer."],
    ["u_play10", "play", 10, 2, "bg:35", "game", "lekledare", "Spelkvällen", "Game night", "Spela 10 partyspel.", "Play 10 party games.", "Tio spel. Discokulan snurrar."],
    ["u_win5", "win", 5, 3, "gl:30", "trophy", "orakel", "Spelkungen", "Game king", "Vinn 5 partyspel.", "Win 5 party games.", "Fem vinster. Ingen vill möta dig nu."],
    ["u_price1", "price", 1, 1, "gl:10", "tag", "kospanare", "Prisspanaren", "Price scout", "Rapportera ett pris på en krog. Det hjälper alla.", "Report a price at a bar. It helps everyone.", "Ett pris rapporterat. Stan tackar."],
    ["u_price10", "price", 10, 2, "hw:25", "tag", "kospanare", "Prisguiden", "Price guide", "Rapportera 10 priser.", "Report 10 prices.", "Tio priser. Du är stans prisguide."],
    ["u_ci1", "ci", 1, 1, "bg:24", "pin", "b5", "Incheckad", "Checked in", "Checka in på en krog.", "Check in at a bar.", "Första incheckningen. Välkommen in."],
    ["u_ci25", "ci", 25, 2, "up:14", "pin", "stammis", "Stamgästen", "The regular", "Checka in 25 gånger (en per krog och kväll).", "Check in 25 times (one per bar and night).", "25 incheckningar. Dörren öppnar sig själv."],
    ["u_home1", "home", 1, 1, "nk:16", "walk", "hemmarsch", "Hemma säkert", "Home safe", "Gå hem med Följ mig hem tills appen säger Hemma.", "Walk home with Follow me home until the app says Home.", "Hemma säkert. Så ska det se ut."],
    ["u_home10", "home", 10, 2, "hw:45", "walk", "hemmarsch", "Trygghetsproffset", "Safety pro", "Kom hem säkert med Följ mig hem 10 gånger.", "Get home safe with Follow me home 10 times.", "Tio gånger hemma säkert. Pannlampan är din."],
    ["u_escort3", "escort", 3, 2, "nk:13", "eye", "eskort", "Kompisvakten", "Buddy watch", "Följ 3 kompisar hem med Följ mig hem.", "Watch 3 friends get home with Follow me home.", "Tre kompisar hemma. Du har koll."],
    ["u_buddy3", "buddy", 3, 2, "hw:42", "heart", "faltskar", "Omtanken", "Looking out", "Kolla läget med en kompis 3 gånger.", "Check on a friend 3 times.", "Du kollar läget. Det märks."],
    ["u_ride1", "ride", 1, 1, "up:30", "taxi", "raddare", "Skjutsen", "The lift", "Svara Jag kommer när en kompis ber om Hämta mig.", "Answer I'm coming when a friend asks for a pickup.", "Du hämtade en kompis. Hjälte."],
    ["u_ride5", "ride", 5, 3, "hw:46", "taxi", "raddare", "Nattens chaufför", "Night driver", "Hämta kompisar 5 gånger.", "Pick up friends 5 times.", "Fem hämtningar. Mössan är din."],
    ["u_driver3", "driver", 3, 2, "gl:5", "taxi", "chauffor", "Nykter förare", "Sober driver", "Slå på Jag kör ikväll 3 kvällar.", "Turn on I'm driving tonight 3 nights.", "Tre kvällar bakom ratten. Respekt."],
    ["u_water5", "water", 5, 1, "bg:39", "drink", "vatten", "Vattenkamraten", "Water buddy", "Tryck Druckit vatten 5 kvällar.", "Tap Had water on 5 nights.", "Vatten fem kvällar. Kroppen tackar."],
    ["u_lask5", "lask", 5, 2, "hi:16", "drink", "vatten", "Läskkungen", "Soda king", "Logga läsk som chaufför 5 kvällar.", "Log a soda as the driver on 5 nights.", "Fem läskkvällar. Kung av bubblorna."],
    ["u_skal1", "skal", 1, 1, "mt:21", "cheers", "sg10", "Skåltimmen", "Toast hour", "Var med i Skåltimmen med gruppen.", "Join the group's toast hour.", "Med i Skåltimmen. Jubel!"],
    ["u_skal10", "skal", 10, 2, "fr:6", "cheers", "sg100", "Skåltimmens hjälte", "Toast hour hero", "Var med i Skåltimmen 10 gånger.", "Join the toast hour 10 times.", "Tio Skåltimmar. Lagerkransen är din."],
    ["u_photo10", "photo", 10, 1, "hi:10", "camera", "krigsfoto", "Kvällens fotograf", "Night photographer", "Skicka 10 bilder i gruppchatten.", "Send 10 photos in the group chat.", "Tio bilder. Albumet tackar."],
    ["u_lucia", "lucia", 1, 2, "hw:19", "star", "lucia", "Lucia med gänget", "Lucia with the gang", "Var ute med gänget på Lucia (13 dec).", "Be out with the gang on Lucia (13 Dec).", "Lucia med gänget. Kronan är din året runt."],
    ["u_jul", "jul", 1, 2, "hw:47", "sparkle", "lucia", "Julbordet", "Christmas table", "Var ute med gänget 1–24 dec.", "Be out with the gang 1–24 Dec.", "Jul med gänget. Pepparkakskronan är din."],
    ["u_nyar", "nyar", 1, 2, "hw:35", "sparkle", "nyar", "Tolvslaget", "Midnight", "Var ute med gänget på nyårsafton.", "Be out with the gang on New Year's Eve.", "Tolvslaget med gänget. Gott nytt!"],
    ["u_mids", "mids", 1, 2, "hw:18", "sun", "midsommar", "Midsommargänget", "Midsummer gang", "Var ute med gänget på midsommarafton.", "Be out with the gang on Midsummer Eve.", "Midsommar med gänget. Kransen är din året runt."]
  ];
  var CAT = ROWS.map(function (r) {
    return { id: r[0], key: r[1], need: r[2], tier: r[3], reward: r[4], icon: r[5], from: r[6], name: [r[7], r[8]], how: [r[9], r[10]], line: r[11] };
  });
  var TIER = [null, ["Vanlig", "Common"], ["Sällsynt", "Rare"], ["Episk", "Epic"]];

  /* ---------- 12 new items. svg(s, H, o): s = the spec (clamped), H = avatar.js drawing helpers, o = {r, skin} ---------- */
  function topCol(s, H) { return H.hexOf(s.ux) || H.TOPC[s.uc] || "#2f6fb8"; }
  function body(H, c) { return H.cel(H.SHOULDERS, c, { w: [2.6, 1.6], v: [1, 1] }); }
  var NEW = [
    // hw 44 Upptäckarhatt (pith helmet) — 25 bars
    ["hw", 44, ["Upptäckarhatt", "Explorer hat"], { clip: 33.5 }, function (s, H) {
      var k = "#d8c49a";
      return H.cel("M27.6,37 C27,16 39,9.6 50,9.6 C61,9.6 73,16 72.4,37Z", k) + H.P("M19,37.4 C27,31 73,31 81,37.4 C73,42.4 27,42.4 19,37.4Z", H.shade(k, -0.16)) +
        H.R(27.8, 31.2, 44.4, 4.2, 0, "#6b5a3a") + H.S("M50,12.4 L50,31", H.shade(k, -0.25), 0.8, ' opacity=".6"') + H.C(50, 10.2, 1.9, H.shade(k, -0.12)) +
        (H.lite() ? "" : H.S("M33,26 C36,18 42,14.6 47,13.8", "#fff", 1, ' opacity=".35"'));
    }],
    // hw 45 Pannlampa (headlamp) — safe home 10 times
    ["hw", 45, ["Pannlampa", "Headlamp"], {}, function (s, H) {
      return H.S("M30.4,33.4 C31,19 69,19 69.6,33.4", "#2b2f36", 2.4) + H.P("M26.6,35.6 C34,31 66,31 73.4,35.6 L73.4,39.6 C66,35 34,35 26.6,39.6Z", "#2b2f36") +
        (H.lite() ? "" : H.C(50, 34.6, 8, "#fff3a6", ' opacity=".35"')) + H.cel(H.dR(42.6, 29.6, 14.8, 9.6, 3), "#ffb020", { w: [0.8, 0.6], v: [0.5, 0.5] }) +
        H.C(50, 34.4, 3.3, "#fffbe6") + H.C(49, 33.4, 1, "#fff");
    }],
    // hw 46 Chaufförsmössa (chauffeur cap) — 5 rides
    ["hw", 46, ["Chaufförsmössa", "Chauffeur cap"], { clip: 33 }, function (s, H) {
      var c = "#1d2433", g = "#ffc24d";
      return H.cel("M28.6,35 C27.6,21 38,16 50,16 C62,16 72.4,21 71.4,35Z", c) + H.R(28.8, 29.6, 42.4, 5.4, 1, "#11151f") +
        H.P("M29.6,35 C40,32.8 60,32.8 70.4,35 C64,41 36,41 29.6,35Z", "#0b0d12") + H.S("M31,30.6 L69,30.6", g, 0.9) +
        '<circle cx="50" cy="23.6" r="3.4" fill="none" stroke="' + g + '" stroke-width="1.1"/>' + H.S("M50,23.6 L50,20.6 M50,23.6 L47.4,25.2 M50,23.6 L52.6,25.2", g, 0.8) + H.C(50, 23.6, 0.9, g);
    }],
    // hw 47 Pepparkakskrona (gingerbread crown) — Julbordet
    ["hw", 47, ["Pepparkakskrona", "Gingerbread crown"], {}, function (s, H) {
      var b = "#b8692e", w = "#fff8ee", heart = function (x, y, r) { return "M" + x + "," + (y + r * 0.9) + " C" + (x - r * 1.6) + "," + (y - r * 0.2) + " " + (x - r * 0.8) + "," + (y - r * 1.4) + " " + x + "," + (y - r * 0.5) + " C" + (x + r * 0.8) + "," + (y - r * 1.4) + " " + (x + r * 1.6) + "," + (y - r * 0.2) + " " + x + "," + (y + r * 0.9) + "Z"; };
      var h = "";
      [[37, 24, 4.4], [50, 19.6, 5.4], [63, 24, 4.4]].forEach(function (q) { h += H.cel(heart(q[0], q[1], q[2]), b, { w: [0.8, 0.6], v: [0.5, 0.5] }) + H.S(heart(q[0], q[1], q[2] * 0.72), w, 0.6); });
      return h + H.cel(H.dR(30, 27.6, 40, 6, 1.4), b, { w: [0.8, 0.6], v: [0.5, 0.5] }) + H.S("M31.6,30.6 l2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6 2.6,-1.6 2.6,1.6", w, 0.7) +
        H.C(37, 24.4, 0.9, "#c8202a") + H.C(50, 20, 1.1, "#1fa45c") + H.C(63, 24.4, 0.9, "#c8202a");
    }],
    // up 31 Resejacka (jacket with travel patches) — 10 towns
    ["up", 31, ["Resejacka", "Travel jacket"], {}, function (s, H) {
      var c = "#3d5a80", d = H.shade(c, -0.25);
      return body(H, c) + H.P("M40,75 L50,90 L44,92 L36,76Z", d) + H.P("M60,75 L50,90 L56,92 L64,76Z", d) + H.S("M50,90 L50,100", d, 1) +
        H.C(24, 90, 4.2, "#e8b93a") + H.P(H.star(24, 90, 2.6, 0.45), "#c8202a") + H.cel(H.dR(66, 86, 9, 7, 1.4), "#1fa45c", { w: [0.6, 0.5], v: [0.4, 0.4] }) +
        H.P("M67.4,92 L70.5,87.6 L73.6,92Z", "#f4f2ec") + H.C(34, 96, 2.6, "#f4f2ec") + H.C(34, 96, 1.3, "#c8202a") + H.C(53.6, 94, 0.9, "#c9ced6") + H.C(53.6, 98, 0.9, "#c9ced6");
    }],
    // up 32 Lagtröja (team shirt in your top colour, number 1) — 20 nights with the gang
    ["up", 32, ["Lagtröja", "Team shirt"], {}, function (s, H) {
      var c = topCol(s, H), w = "#f4f2ec";
      return body(H, c) + H.P("M8,92 C10,86 14,83 20,81 L22,86 C16,88 12,91 10,95Z", w) + H.P("M92,92 C90,86 86,83 80,81 L78,86 C84,88 88,91 90,95Z", w) +
        H.P("M41,75 L50,83.6 L59,75 L56,75 L50,80.4 L44,75Z", w) + H.S("M47,86.6 L51,84.2 L51,97.4 M47.6,97.4 L54.4,97.4", w, 2.2) + H.P(H.star(64, 84, 2.2, 0.45), "#ffc24d");
    }],
    // nk 16 Reflexhänge (Swedish reflector pendant) — first safe walk home
    ["nk", 16, ["Reflexhänge", "Reflector pendant"], { tuck: 1 }, function (s, H) {
      return H.S("M40,75.6 Q50,86 60,75.6", "#c9ced6", 0.9, ' stroke-dasharray="1.2 .7"') + H.C(50, 88.6, 5.6, "#dfe6ef") +
        '<circle cx="50" cy="88.6" r="4.2" fill="none" stroke="#9fb0c4" stroke-width=".7"/><circle cx="50" cy="88.6" r="2.6" fill="none" stroke="#9fb0c4" stroke-width=".7"/>' +
        H.S("M50,83.6 L50,93.6 M45,88.6 L55,88.6", "#b8c6d6", 0.5) + (H.lite() ? "" : H.P(H.star(47.4, 86.2, 1.6, 0.3), "#fff"));
    }],
    // nk 17 Gänghalsduk (knitted gang scarf, two tails, fringe) — 5 nights with the gang
    ["nk", 17, ["Gänghalsduk", "Gang scarf"], { tuck: 1 }, function (s, H) {
      var r = "#8a1f2b", w = "#f2e8d6", o = { w: [1, 1], v: [0.6, 0.6] };
      return H.cel("M37.4,70.4 C44,75 56,75 62.6,70.4 L64.6,78.8 C56,83 44,83 35.4,78.8Z", r, o) + H.S("M37,74.6 C44,79 56,79 63.4,74.6", w, 1.2) +
        H.cel("M55,78.4 L61.6,77.6 L62.6,97 L55.6,97.6Z", r, o) + H.cel("M58.6,78.4 L65,79 L67,96 L60.6,96.6Z", H.shade(r, -0.06), o) +
        H.P("M55.3,84 L61.9,83.4 L62,86 L55.4,86.6Z", w) + H.P("M55.5,90 L62.2,89.4 L62.3,92 L55.6,92.6Z", w) +
        H.S("M56,97.6 L55.8,100 M58,97.4 L58,100 M60,97.2 L60.2,100 M61.8,97 L62.2,99.8 M64,96.6 L64.4,99.4 M66,96.2 L66.6,99", w, 0.6);
    }],
    // gl 30 Spelvisir (gamer visor) — 5 party game wins
    ["gl", 30, ["Spelvisir", "Game visor"], {}, function (s, H) {
      return H.R(27.6, 42, 4.4, 6.4, 1.6, "#7a3cff") + H.R(68, 42, 4.4, 6.4, 1.6, "#7a3cff") +
        H.P("M31,40.6 C40,38.2 60,38.2 69,40.6 L68,50 C60,52.2 40,52.2 32,50Z", "#2de1ff", ' opacity=".7" stroke="#7a3cff" stroke-width="1.4"') +
        H.S("M35,43 L41,43 M58.6,46.6 L64.6,46.6", "#fff", 0.9, ' opacity=".8"') + (H.lite() ? "" : H.S("M44,48 L46,48 M48,48 L50,48 M52,48 L54,48", "#ff4fd8", 0.9));
    }],
    // fr 11 Passtämpelram (passport stamp ring) — 10 bars
    ["fr", 11, ["Passtämpelram", "Passport stamp ring"], {}, function (s, H) {
      var h = '<circle cx="50" cy="50" r="47.4" fill="none" stroke="#8a5a2b" stroke-width="4.4"/><circle cx="50" cy="50" r="47.4" fill="none" stroke="#e8d5b0" stroke-width="1" stroke-dasharray="2.4 2.4"/>';
      [[16, 22, -18, "#c8202a"], [84, 22, 16, "#2f6fb8"], [14, 78, 14, "#1fa45c"], [86, 78, -12, "#e8b93a"]].forEach(function (q) {
        h += '<g transform="rotate(' + q[2] + " " + q[0] + " " + q[1] + ')">' + H.R(q[0] - 5, q[1] - 3.6, 10, 7.2, 1.2, "#f6efe0", ' stroke="' + q[3] + '" stroke-width="1"') + H.S("M" + (q[0] - 3) + "," + q[1] + " L" + (q[0] + 3) + "," + q[1], q[3], 1) + "</g>";
      });
      return h;
    }],
    // fr 12 Kompassring (compass ring) — 8 län
    ["fr", 12, ["Kompassring", "Compass ring"], {}, function (s, H) {
      var n = H.nid();
      return "<defs>" + H.grad(n, 0, 0, 100, 100, [[0, "#fff1a8"], [0.45, "#d9b25c"], [1, "#8a6a1c"]]) + '</defs><circle cx="50" cy="50" r="47.6" fill="none" stroke="url(#' + n + ')" stroke-width="4.4"/>' +
        H.P("M50,0.6 L53.4,8 L46.6,8Z", "#c8202a") + H.P("M50,99.4 L53.4,92 L46.6,92Z", "#f4f2ec") + H.P("M0.6,50 L8,46.6 L8,53.4Z", "#f4f2ec") + H.P("M99.4,50 L92,46.6 L92,53.4Z", "#f4f2ec") +
        (H.lite() ? "" : H.S("M17,17 L19.6,19.6 M83,17 L80.4,19.6 M17,83 L19.6,80.4 M83,83 L80.4,80.4", "#fff1a8", 1));
    }],
    // bg 39 Bubbelvatten (sparkling water) — water on 5 nights
    ["bg", 39, ["Bubbelvatten", "Sparkling water"], {}, function (s, H) {
      var n = H.nid(), h = "<defs>" + H.grad(n, 0, 0, 0, 100, [[0, "#d6f3ff"], [1, "#4aa8dc"]]) + '</defs><rect x="0" y="0" width="100" height="100" fill="url(#' + n + ')"/>';
      [[14, 80, 4], [24, 60, 2.4], [18, 36, 3], [30, 18, 1.8], [82, 76, 3.6], [74, 52, 2.2], [86, 30, 3], [70, 14, 1.6], [8, 54, 1.6], [92, 56, 1.8]].forEach(function (b) {
        h += '<circle cx="' + b[0] + '" cy="' + b[1] + '" r="' + b[2] + '" fill="#fff" fill-opacity=".28" stroke="#fff" stroke-opacity=".75" stroke-width=".7"/>';
      });
      return h + (H.lite() ? "" : H.P("M78,92 A12,12 0 0 1 98,82 L98,100 L78,100Z", "#f5e66b", ' opacity=".55"'));
    }]
  ];

  var done = false;
  function ready() {
    if (done) return true;
    var AV = window.AVATAR, M = window.MEDALS;
    if (!AV || !AV.addPart || !AV.addPath) return false;
    done = true;
    var by = {}, isNew = {};
    CAT.forEach(function (c) { by[c.reward] = c; });
    NEW.forEach(function (p) {
      var key = p[0] + ":" + p[1], c = by[key], o = p[3];
      isNew[key] = 1;
      var ok = AV.addPart(p[0], p[1], { name: p[2], svg: p[4], lock: c ? { m: c.id } : null, rare: c ? c.tier : 1, clip: o.clip, tuck: o.tuck });
      if (!ok && window.console) console.warn("unlock-parts: slot taken", key);
    });
    // old items: the achievement is one more way to open them (the old lock still works)
    CAT.forEach(function (c) { if (!isNew[c.reward]) AV.addPath(c.reward, { m: c.id }); });
    if (M && M.CAT) CAT.forEach(function (c) {
      if (M.CAT.some(function (x) { return x[0] === c.id; })) return;
      var e = ""; try { e = M.info(c.from).e || ""; } catch (x) {}
      M.CAT.push([c.id, e, c.name[0], c.line, c.how[0], c.key === "lucia" || c.key === "jul" || c.key === "nyar" || c.key === "mids" ? 1 : 0]);
    });
    return true;
  }
  ready();
  PN.unlockData = { CAT: CAT, NEW: NEW, TIER: TIER, ready: ready };
})();
