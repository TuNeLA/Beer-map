/* PintsNow — PNI set 2 (lane icons, 2026-11-13): 25 more own icons + a better emoji → icon map. Same rules as pnicons.js:
   grid 24 × 24, live area 2…22, stroke 2, round caps + joins, no fill (small dots filled), colour = currentColor.
   Part format: "M…" path, "c x y r" circle, "C x y r" filled dot, "r x y w h rx" rect, "d x y r" dashed circle.
   It adds to PNI._I (so PNI.svg / has / names work for them) and fixes emoji that shared one icon for two meanings.
   No global of its own. Loads right after pnicons.js (defer order). */
(function () {
  "use strict";
  var P = window.PNI; if (!P || !P._I) return;
  var N = {
    // ---- status / system ----
    "warn": ["M12 3.5L2.5 20h19z", "M12 10v4.5", "C12 17.4 1.2"],                       // ⚠ triangle (was: no icon, toasts showed "info")
    "siren": ["M7 18v-5a5 5 0 0 1 10 0v5", "M4.5 18h15", "M5 21h14", "M12 3v2", "M4.2 6.2l1.4 1.4", "M19.8 6.2l-1.4 1.4"],   // 🚨 alarm light
    "stop": ["M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z", "M8.5 12h7"],                      // 🛑
    "hourglass": ["M6.5 3h11", "M6.5 21h11", "M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9", "M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9"],   // ⏳ waiting
    "undo": ["M9 7L4.5 11.5 9 16", "M4.5 11.5H15a5 5 0 0 1 0 10h-3"],                      // ↩ the Ångra step
    "save": ["M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M8 4v5h7V4", "M8 20v-6h8v6"],   // 💾
    "age18": ["c 12 12 9", "M7.5 10.2l2-1.2V15.5", "c 14.5 10.6 1.7", "c 14.5 14.2 2"],   // 🔞 18+
    "signal": ["M4.5 19.5v-3", "M9.5 19.5v-6", "M14.5 19.5v-10", "M19.5 19.5V4.5"],         // 📶 network
    "speaker-off": ["M4 9.5h3.5L12 5.5v13l-4.5-4H4z", "M16 9.5l5 5", "M21 9.5l-5 5"],      // 🔇
    // ---- people / night ----
    "ghost": ["M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.33-2-2.34 2-2.33-2-2.33 2-2.34-2z", "C9.5 11 1.2", "C14.5 11 1.2"],   // 👻 ghost mode
    "spy": ["M3 12h18", "M7 12l1-5.5A2 2 0 0 1 10 4.8h4a2 2 0 0 1 2 1.7L17 12", "c 8.5 17 2.5", "c 15.5 17 2.5", "M11 16.6h2"],   // 🕵 hat + glasses
    "party": ["M4 21l4.5-12.5 8 8z", "M13 4.5v2", "M17.5 8.5l1.5-1.5", "M19 13.5h2", "M16 3.5l.5 1", "C20 4.5 .9"],   // 🎉 party popper
    "gift": ["r 4 10 16 11 1.5", "r 3 7 18 3 1", "M12 7v14", "M12 7C9.5 7 8 6 8 4.8S9 3.5 10 3.5c1.7 0 2 2 2 3.5z", "M12 7c2.5 0 4-1 4-2.2S15 3.5 14 3.5c-1.7 0-2 2-2 3.5z"],   // 🎁
    "bandage": ["M8.1 3.2l12.7 12.7-4.9 4.9L3.2 8.1z", "M10.5 13.5l3-3"],                  // 🤕 🩹 hangover / first aid
    "palette": ["M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z", "C7.5 11 1.1", "C9.5 7.3 1.1", "C14.5 7.3 1.1"],   // 🎨
    // ---- places / things ----
    "vote": ["r 3.5 13 17 7.5 1.5", "M7.5 13V4.5h9V13", "M10 8.5l1.5 1.5L14.5 7"],          // 🗳 poll
    "news": ["M4 5.5A1.5 1.5 0 0 1 5.5 4h10A1.5 1.5 0 0 1 17 5.5V20H6a2 2 0 0 1-2-2z", "M17 9h2.5a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H17", "M7.5 8h6", "M7.5 12h6", "M7.5 16h4"],   // 📰 Kvällens tidning
    "radio": ["r 3 8 18 12 2.5", "M7 8l10-5", "c 9 14 2.6", "M15 12.5h3", "M15 15.5h3"],     // 📻
    "scales": ["M12 4v16", "M8 20h8", "M5 7h14", "M5 7l-2.7 6.5a3 3 0 0 0 5.4 0z", "M19 7l-2.7 6.5a3 3 0 0 0 5.4 0z"],   // ⚖ fair
    "truck": ["M2.5 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9.5h-11z", "M13.5 9.5h4l3 3.5v3.5h-7", "c 7 17.8 2", "c 17 17.8 2"],   // 🚚 move
    "sunrise": ["M6.5 16.5a5.5 5.5 0 0 1 11 0", "M3 16.5h18", "M6 20.5h12", "M12 5v2.5", "M5.2 9.2l1.6 1.6", "M18.8 9.2l-1.6 1.6"],   // 🌅 morning after
    "cloud": ["M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 11.5 3.75 3.75 0 0 1 17.25 19z"],    // ☁ weather
    "music": ["M9 18V5l11-2v13", "c 6.5 18 2.5", "c 17.5 16 2.5"],                         // 🎵 🎸 🎺 🥁
    "cards": ["r 3 8 12 13 1.5", "M7.5 4.5h12A1.5 1.5 0 0 1 21 6v11.5", "M9 11.8l2.2 3-2.2 3-2.2-3z"],   // 🃏 card games
    "ball": ["c 12 12 9", "M12 8.2l3.6 2.6-1.4 4.2H9.8l-1.4-4.2z", "M12 3v5.2", "M15.6 10.8L21 9.2", "M14.2 15l3.3 4.3", "M9.8 15l-3.3 4.3", "M8.4 10.8L3 9.2"]   // ⚽ sport
  };
  Object.keys(N).forEach(function (k) { if (!P._I[k]) P._I[k] = N[k]; });
  // emoji → icon. Fixes: ⚽/🏒 were "tv", 🃏 was "game", 👻 was "history", 🎁/🎉 were "sparkle", ⚠ had none.
  var E = {
    "⚠": "warn", "🚨": "siren", "🛑": "stop", "⏳": "hourglass", "⌛": "hourglass", "↩": "undo", "💾": "save", "🔞": "age18", "📶": "signal", "🔇": "speaker-off",
    "👻": "ghost", "🕵": "spy", "🎉": "party", "🥳": "party", "🎊": "party", "🎁": "gift", "🤕": "bandage", "🩹": "bandage", "🎨": "palette",
    "🗳": "vote", "📰": "news", "📻": "radio", "⚖": "scales", "🚚": "truck", "🌅": "sunrise", "🌇": "sunrise",
    "☁": "cloud", "🌥": "cloud", "⛅": "cloud", "🌤": "cloud", "🌦": "cloud", "🌧": "cloud", "🌫": "cloud",
    "🎵": "music", "🎶": "music", "🎸": "music", "🎺": "music", "🥁": "music", "🎻": "music", "🃏": "cards", "⚽": "ball", "🏀": "ball",
    // old icons that existed but had no emoji
    "⚔": "swords", "✏": "edit", "🎞": "film", "⚡": "flash", "⏸": "pause", "✖": "x", "💚": "heart", "💛": "heart", "💙": "heart", "💖": "heart"
  };
  // drinks: one silhouette per drink (the a2ui kinds), only when that icon exists
  var D = { "🍷": "k-vin", "🥃": "k-whisky", "🍸": "k-drink", "🍹": "k-grogg", "🍾": "k-bubbel" };
  Object.keys(D).forEach(function (k) { if (P.has(D[k])) E[k] = D[k]; });
  Object.keys(E).forEach(function (k) {
    var v = E[k]; if (!P.has(v)) return;
    P.EMOJI[k] = v; P.EMOJI[k + "️"] = v;
  });
})();
