/* Öl Nu v16 EFTERÅT (omgång 3: efteråt, socialt och krogar). window.AFTER, called through mods() in app.js.
   1 Kom hem säkert (✅ hemma in the group view + morning card)   2 🚑 "Jag kollar" (MEDEVAC buddy check)
   3 🤕 Bakisrapporten (morning, share image)                     4 🎁 Öl Wrapped (month / year story)
   5 🎉 Högtidsläge (theme, ticker lines, medals)                 6 🎙️ Röstskål in the group chat
   7 🏙️ Stad mot stad (weekly town league, poäng, never beers)    8 📲 Krog-QR (qr.html + ?checkin=1&bar=)
   9 👑 Stammis-krona (most NIGHTS at a bar, 30 days)            10 🌯 Kebab-radar (open late-night food)
   Server: migration 0018_after.sql. Every RPC may be missing on an older database: that feature hides quietly.
   Text content: js/after-content.js (window.AFTER_CONTENT). Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null;
  var off = {};
  function C() { return window.AFTER_CONTENT || {}; }
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function fill(tpl, v) { return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  function $(id) { return document.getElementById(id); }
  function call(name, params) {
    if (!A || !A.LIVE || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; }
      return r;
    });
  }
  function codeOf(e) { return U.errCode(e); }
  function rows(r) { return r && Array.isArray(r.data) ? r.data : []; }
  function invoke(body) { try { if (A && A.PUSH_ON) A.invoke("notify-group", body); } catch (e) {} }

  /* ---------- Time (Europe/Stockholm) ---------- */
  var DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  function sthlm(d) {
    d = d || new Date();
    try {
      var o = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, min: +o.minute, dow: DOW[o.weekday] || 1 };
    } catch (e) {
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes(), dow: d.getDay() || 7 };
    }
  }
  function ymd(y, m, d) { return y + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2); }
  function addDays(o, n) { var t = new Date(Date.UTC(o.y, o.m - 1, o.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() || 7 }; }
  // Evening date: before 05:00 the night still belongs to yesterday.
  function evening(now) { var s = sthlm(now); return s.h < 5 ? addDays(s, -1) : { y: s.y, m: s.m, d: s.d, dow: s.dow }; }
  function hm(iso) { var t = Date.parse(iso); if (!isFinite(t)) return ""; var s = sthlm(new Date(t)); return ("0" + s.h).slice(-2) + ":" + ("0" + s.min).slice(-2); }
  function dateLabel(iso) {
    var t = Date.parse(String(iso || "") + "T12:00:00Z"); if (!isFinite(t)) return String(iso || "");
    try { return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(t)); } catch (e) { return String(iso); }
  }
  function monthLabel(iso) {
    var t = Date.parse(String(iso || "") + "T12:00:00Z"); if (!isFinite(t)) return "";
    try { return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(t)); } catch (e) { return ""; }
  }

  /* ---------- 5. Högtidsläge ---------- */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mo = Math.floor((h + l - 7 * m + 114) / 31), dy = ((h + l - 7 * m + 114) % 31) + 1;
    return { y: y, m: mo, d: dy };
  }
  function dayNum(o) { return Math.round(Date.UTC(o.y, o.m - 1, o.d) / 86400000); }
  // Same rules as SQL olnu_holiday(). Returns a key of AFTER_CONTENT.holidays or null.
  function holidayOf(o) {
    var md = ("0" + o.m).slice(-2) + "-" + ("0" + o.d).slice(-2), dow = addDays(o, 0).dow, n = dayNum(o), es = dayNum(easter(o.y));
    if (md === "12-24") return "julafton";
    if (md === "12-31") return "nyarsafton";
    if (md === "12-13") return "lucia";
    if (md === "04-30") return "valborg";
    if (md === "10-31") return "halloween";
    if (dow === 5 && md >= "06-19" && md <= "06-25") return "midsommar";
    if (n >= es - 2 && n <= es) return "pask";
    if (n === es - 47) return "fettisdagen";
    var d3 = { y: o.y, m: 12, d: 3 }, adv = dayNum(d3) - (addDays(d3, 0).dow % 7);
    if (n === adv) return "forstaAdvent";
    if (dow === 5 && o.d === 13) return "fredag13";
    if (dow === 5 && o.m === 8) return "kraftskiva";
    return null;
  }
  var holKey = null;
  function holidayNow() {
    var force = null;
    try { force = new URLSearchParams(location.search).get("hol") || sessionStorage.getItem("olnu.hol"); } catch (e) {}
    if (force && C().holidays && C().holidays[force]) { try { sessionStorage.setItem("olnu.hol", force); } catch (e) {} return force; }
    return holidayOf(evening());
  }
  function applyHoliday() {
    var k = holidayNow(), h = k && C().holidays ? C().holidays[k] : null;
    holKey = h ? k : null;
    var root = document.documentElement;
    document.body.classList.toggle("af-hol", !!h);
    var wrap = document.querySelector(".beer-wrap"), badge = $("af-hol-e");
    if (!h) { if (badge) badge.remove(); root.style.removeProperty("--af-hol"); return; }
    root.style.setProperty("--af-hol", h.theme && h.theme.color || "#f5a623");
    if (wrap && !badge) { badge = document.createElement("span"); badge.id = "af-hol-e"; badge.className = "af-hol-e"; wrap.appendChild(badge); }
    if (badge) {
      badge.textContent = (h.theme && h.theme.emoji) || "🎉";
      badge.setAttribute("role", "img"); badge.setAttribute("aria-label", h.name || "");
      badge.title = h.name || "";
    }
  }
  // Medal names for the medals 0018 adds (the server ids are stable).
  var MEDALS_V16 = [
    ["jul", "🎄", "Julsoldaten", "Ute på julafton. Tomten tog ledigt, du tog en öl.", "Var ute på julafton.", 1],
    ["fettis", "🧁", "Semmelsoldaten", "Fettisdag i tjänst. Grädde på mustaschen.", "Var ute på fettisdagen.", 1],
    ["pask", "🐣", "Påskpatrullen", "Ute i påsk. Påskharen har sett dig.", "Var ute under påskhelgen.", 1],
    ["advent", "⭐", "Adventsvakten", "Första advent i fält. Ett ljus tänt, en öl tagen.", "Var ute på första advent.", 1],
    ["fredag13", "🐈‍⬛", "Svarta katten", "Fredag den 13:e och du gick ändå ut. Modigt.", "Var ute en fredag den 13:e.", 1],
    ["halloween", "🎃", "Pumpapatrullen", "Ute på halloween. Det mest skrämmande var kön.", "Var ute på halloween (31 okt).", 1],
    ["kraftskiva", "🦞", "Kräftkaptenen", "Kräftskiva i augusti. Hatten satt, visan satt.", "Var ute en fredag i augusti.", 1],
    ["kompisvakt", "💚", "Kompisvakten", "Du kollade läget med en kompis på MEDEVAC. Finaste sortens soldat.", "Tryck ”🚑 Jag kollar” när en kompis behöver det.", 1]
  ];
  function addMedalNames() {
    var M = window.MEDALS; if (!M || !Array.isArray(M.CAT)) return;
    MEDALS_V16.forEach(function (c) {
      for (var i = 0; i < M.CAT.length; i++) if (M.CAT[i][0] === c[0]) return;
      // Before the secret "Varit med om" rows (they stay last).
      var at = M.CAT.length; for (var j = 0; j < M.CAT.length; j++) if (M.CAT[j][6]) { at = j; break; }
      M.CAT.splice(at, 0, c);
    });
  }

  /* ---------- Shared: canvas card + share row ---------- */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var p = Promise.all(['64px "Black Ops One"', '40px "Share Tech Mono"', '700 40px "Chakra Petch"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function cardBase(c, W, H, accent) {
    c.fillStyle = "#0a0f1c"; c.fillRect(0, 0, W, H);
    var g = c.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, W * 0.7);
    g.addColorStop(0, hexA(accent, 0.24)); g.addColorStop(1, hexA(accent, 0));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = hexA(accent, 0.07); c.lineWidth = 2;
    for (var x = 0; x <= W; x += 54) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (var y = 0; y <= H; y += 54) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = accent; c.lineWidth = 8;
    [[40, 40, 1, 1], [W - 40, 40, -1, 1], [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1]].forEach(function (k) {
      c.beginPath(); c.moveTo(k[0], k[1] + 70 * k[3]); c.lineTo(k[0], k[1]); c.lineTo(k[0] + 70 * k[2], k[1]); c.stroke();
    });
    c.textBaseline = "alphabetic";
    c.fillStyle = accent; c.font = '56px "Black Ops One", Impact, sans-serif'; c.textAlign = "left";
    c.fillText("ÖL NU", 90, 140);
  }
  function hexA(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return "rgba(245,166,35," + a + ")";
    var n = parseInt(m[1], 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function wrapText(c, text, x, y, maxW, lh, maxLines) {
    var words = String(text || "").split(/\s+/), line = "", n = 0;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, y + n * lh); n++; line = words[i];
        if (maxLines && n >= maxLines - 1) { line = words.slice(i).join(" "); break; }
      } else line = test;
    }
    if (line) {
      while (maxLines && c.measureText(line).width > maxW && line.length > 4) line = line.slice(0, -2);
      c.fillText(line, x, y + n * lh); n++;
    }
    return n;
  }
  function statBoxes(c, W, y, stats, accent) {
    var bw = (W - 180 - (stats.length - 1) * 24) / stats.length;
    stats.forEach(function (st, i) {
      var bx = 90 + i * (bw + 24);
      c.fillStyle = "rgba(16,24,38,.92)"; c.fillRect(bx, y, bw, 170);
      c.strokeStyle = hexA(accent, 0.45); c.lineWidth = 3; c.strokeRect(bx, y, bw, 170);
      c.fillStyle = "#9aa3a0"; c.font = '28px "Share Tech Mono", monospace'; c.textAlign = "center";
      c.fillText(String(st[0]).toUpperCase(), bx + bw / 2, y + 52);
      c.fillStyle = "#ece6d6"; c.font = (String(st[1]).length > 6 ? "700 36px" : "700 62px") + ' "Chakra Petch", sans-serif';
      c.fillText(String(st[1]), bx + bw / 2, y + 132);
    });
  }
  function shareRow(cv, row, fname, text) {
    var blobP = new Promise(function (res) { try { cv.toBlob(function (b) { res(b); }, "image/png"); } catch (e) { res(null); } });
    blobP.then(function (blob) {
      if (!document.body.contains(row)) return;
      var file = null;
      try { if (blob && typeof File === "function") file = new File([blob], fname, { type: "image/png" }); } catch (e) { file = null; }
      var canFiles = false;
      try { canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canFiles = false; }
      if (canFiles) row.appendChild(A.btn(L("📤 Dela bild", "📤 Share image"), "btn-amber", function () { navigator.share({ files: [file], text: text, title: "Öl Nu" }).catch(function () {}); }));
      else if (blob) row.appendChild(A.btn(L("💾 Spara bild", "💾 Save image"), "btn-amber", function () {
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }));
      row.appendChild(A.btn(L("📋 Kopiera text", "📋 Copy text"), "", function () { A.copyText(text); }));
    });
  }
  // Run fn when no sheet is open (waits up to maxMs; then gives up quietly).
  function whenSheetFree(fn, maxMs) {
    var t0 = Date.now();
    (function tick() {
      if (!A.sheetOpen()) { fn(); return; }
      if (Date.now() - t0 > (maxMs || 120000)) return;
      setTimeout(tick, 800);
    })();
  }

  /* ---------- 1. Kom hem säkert ---------- */
  var homeCache = null, homeAt = 0, homeP = null;
  function loadHome(force) {
    if (off.home_status) return Promise.resolve(null);
    if (!force && homeCache && Date.now() - homeAt < 20000) return Promise.resolve(homeCache);
    if (homeP) return homeP;
    homeP = call("home_status", { p_last: false }).then(function (r) {
      homeP = null;
      if (r.error) return homeCache;
      homeCache = rows(r); homeAt = Date.now();
      return homeCache;
    });
    return homeP;
  }
  function statusRow(g, m, row) {
    if (!A || !A.LIVE || off.home_status) return;
    loadHome(false).then(function (list) {
      if (!list || !document.body.contains(row)) return;
      var hit = null;
      list.forEach(function (x) {
        if (String(x.group_id) !== String(g.id)) return;
        if ((m.is_me && x.is_me) || (!m.is_me && !x.is_me && x.name === m.name)) hit = x;
      });
      if (!hit || row.querySelector(".af-home")) return;
      var txt = hit.home ? "✅ " + L("hemma", "home") + (hit.home_at ? " " + hm(hit.home_at) : "") :
        hit.was_out && !hit.live ? "🌙 " + L("ej hemma än", "not home yet") : "";
      if (!txt) return;
      var main = row.querySelector(".st-main") || row;
      main.appendChild(A.el("span", { class: "af-home" + (hit.home ? " ok" : ""), text: txt }));
    });
  }
  function markHome() {
    call("mark_home").then(function (r) { if (!r.error) { homeCache = null; } });
  }
  // Morning (after 05:00, first open): mates who were out last night but never pressed "Jag är hemma".
  function missingMates() {
    if (off.home_status) return Promise.resolve([]);
    return call("home_status", { p_last: true }).then(function (r) {
      var names = [];
      rows(r).forEach(function (x) { if (!x.is_me && x.was_out && !x.home && x.name && names.indexOf(x.name) < 0) names.push(x.name); });
      return names;
    });
  }
  function joinNames(n) {
    if (n.length <= 1) return n.join("");
    return n.slice(0, -1).join(", ") + L(" och ", " and ") + n[n.length - 1];
  }

  /* ---------- 2. "🚑 Jag kollar" ---------- */
  // Owner 2026-10-18: crew hype, not warnings. The "Jag kollar" button (buddy check) stays as a tool.
  var MED_ASK = [
    "🦅 {name} har gått in i legendläge! Vem i truppen hänger med hen?",
    "🎖️ {name} ä kvällens legend. Vem går dit och gör honnör?",
    "💚 {name} ä i legendläge. Ingen lämnas kvar – vem ä wingman?",
    "🦅 Truppen kallar: {name} behöver en wingman. Vem tar uppdraget?",
    "🫂 {name} skriver historia ikväll. Vem ä med i kapitlet?",
    "⚡ {name} ä i toppform. Vem i gänget kollar in och hyllar?"
  ];
  var MED_SEEN_KEY = "olnu.afMedSeen";
  var medPins = [], checks = [], checksAt = 0, checksBusy = false, checkSeen = {};
  function medSeen() { var o = U.ls.getJSON(MED_SEEN_KEY, {}) || {}; return typeof o === "object" ? o : {}; }
  function checkFor(beerId) {
    for (var i = 0; i < checks.length; i++) if (String(checks[i].beer_id) === String(beerId)) return checks[i];
    return null;
  }
  function loadChecks(force) {
    if (off.medevac_checks || checksBusy) return Promise.resolve(checks);
    if (!force && Date.now() - checksAt < (medPins.length ? 25000 : 120000)) return Promise.resolve(checks);
    checksBusy = true; checksAt = Date.now();
    return call("medevac_checks").then(function (r) {
      checksBusy = false;
      if (r.error) return checks;
      checks = rows(r);
      var seen = U.ls.getJSON("olnu.afChkSeen", {}) || {}, dirty = false, now = Date.now();
      checks.forEach(function (c) {
        if (seen[c.id] || c.checker_is_me) return;
        seen[c.id] = now; dirty = true;
        if (Date.now() - (Date.parse(c.created_at) || 0) > 30 * 60000) return;
        A.toast(c.target_is_me ? L("💚 " + (c.checker_name || "En kompis") + " ä din wingman ikväll. Truppen håller ihop. 🫡", "💚 " + (c.checker_name || "A friend") + " is checking on you.")
          : L("💚 " + (c.checker_name || "En kompis") + " kollar på " + (c.target_name || "kompisen") + ".", "💚 " + (c.checker_name || "A friend") + " is checking on " + (c.target_name || "your mate") + "."), { cls: "water", ms: 6000 });
      });
      Object.keys(seen).forEach(function (k) { if (now - seen[k] > 2 * 86400000) { delete seen[k]; dirty = true; } });
      if (dirty) U.ls.setJSON("olnu.afChkSeen", seen);
      A.updateCounts();
      return checks;
    });
  }
  function scanMedevac(beers) {
    medPins = (beers || []).filter(function (b) { return b && b.friend_name && !b.is_mine && (b.beer_count | 0) >= 10 && /^\d+$/.test(String(b.id)); });
    if (off.claim_medevac || !medPins.length) return;
    loadChecks(false).then(function () {
      var seen = medSeen(), dirty = false, now = Date.now();
      medPins.forEach(function (b) {
        var k = String(b.id);
        if (seen[k] || checkFor(b.id)) return;
        seen[k] = now; dirty = true;
        A.toast(fill(pick(MED_ASK), { name: b.friend_name }), { cls: "med", ms: 12000,
          action: { label: L("🚑 Jag kollar", "🚑 I'll check"), fn: function () { claim(b); } } });
        window.FX && window.FX.vibrate && window.FX.vibrate([40, 60, 40]);
      });
      Object.keys(seen).forEach(function (k) { if (now - seen[k] > 2 * 86400000) { delete seen[k]; dirty = true; } });
      if (dirty) U.ls.setJSON(MED_SEEN_KEY, seen);
      A.updateCounts();
    });
  }
  function openMed() {
    for (var i = 0; i < medPins.length; i++) if (!checkFor(medPins[i].id)) return medPins[i];
    return null;
  }
  function claim(b, button) {
    if (!b || off.claim_medevac) return;
    if (button) button.disabled = true;
    call("claim_medevac", { p_beer_id: +b.id }).then(function (r) {
      if (button) button.disabled = false;
      if (r.error) {
        var c = codeOf(r.error);
        A.toast(c === "beer_not_found" ? L("Pinnen finns inte längre. Bra tecken, kanske.", "That pin is gone.") : L("Det gick inte just nu. Försök igen.", "Could not do that now."), { err: true });
        return;
      }
      var d = A.parseData(r.data);
      if (d.ok) {
        A.toast(L("💚 Bra. Du kollar på " + b.friend_name + ". Ta med ett glas vatten.", "💚 Good. You're checking on " + b.friend_name + "."), { cls: "water", ms: 6000 });
        window.FX && window.FX.sound && window.FX.sound.clink && window.FX.sound.clink();
        invoke({ event: "medevac_check", check_id: d.id });
        setTimeout(function () { if (window.MEDALS && window.MEDALS.award) window.MEDALS.award(null, true); }, 1500);
      } else if (d.mine) A.toast(L("Du kollar redan på " + b.friend_name + ". 💚", "You're already on it. 💚"));
      else A.toast(L("💚 " + (d.checker || "En kompis") + " kollar redan på " + b.friend_name + ".", "💚 " + (d.checker || "A friend") + " is already on it."));
      loadChecks(true).then(function () { A.render(); });
    });
  }
  function medPopupHTML(b) {
    if (!b || !b.friend_name || b.is_mine || (b.beer_count | 0) < 10 || off.claim_medevac || !/^\d+$/.test(String(b.id))) return "";
    var c = checkFor(b.id);
    if (c) return '<div class="af-med ok">💚 ' + esc((c.checker_is_me ? L("Du", "You") : c.checker_name || L("En kompis", "A friend")) + L(" kollar läget", " is checking")) + "</div>";
    return '<button type="button" class="af-med-btn" data-afmed="' + esc(String(b.id)) + '">' + esc(L("🚑 Jag kollar läget", "🚑 I'll check on them")) + "</button>";
  }

  /* ---------- 3. Bakisrapporten ---------- */
  var BAKIS_KEY = "olnu.afBakis";
  var TYPE_SV = { lager: "Lager", pilsner: "Pilsner", ipa: "IPA", apa: "APA", stout: "Stout", vete: "Veteöl", ale: "Ale", sour: "Sour", alkfri: "Alkoholfri", annan: "Annan" };
  function bakisData() {
    if (off.my_night_report) return Promise.resolve(null);
    return call("my_night_report", { p_last: true }).then(function (r) { return r.error ? null : A.parseData(r.data); });
  }
  function bakisVars(d) {
    return { beers: d.beers | 0, bars: d.bars | 0, others: d.others | 0, skal: (d.skal_given | 0) + (d.skal_got | 0),
      home: d.home_at ? hm(d.home_at) : d.home ? L("✓", "✓") : L("okänd tid", "unknown") };
  }
  function drawBakis(cv, d, head, tip) {
    var W = 1080, H = 1350, c = cv.getContext("2d"), acc = "#5ec8ff";
    cv.width = W; cv.height = H;
    cardBase(c, W, H, acc);
    c.fillStyle = "#cfefff"; c.font = '100px "Black Ops One", Impact, sans-serif'; c.textAlign = "left";
    c.fillText(L("BAKIS-", "HANGOVER"), 90, 270);
    c.fillText(L("RAPPORTEN", "REPORT"), 90, 375);
    c.fillStyle = "#9aa3a0"; c.font = '38px "Share Tech Mono", monospace';
    c.fillText(dateLabel(d.evening).toUpperCase(), 94, 435);
    var v = bakisVars(d);
    statBoxes(c, W, 500, [[L("Öl", "Beers"), String(v.beers)], [L("Krogar", "Bars"), String(v.bars)], [L("Skål", "Cheers"), String(v.skal)]], acc);
    statBoxes(c, W, 700, [[L("Sidospår", "Other"), v.others + " 🥃"], [L("Hemma", "Home"), v.home]], acc);
    c.textAlign = "left"; c.fillStyle = "#ece6d6"; c.font = '600 40px "Chakra Petch", sans-serif';
    var n = wrapText(c, head, 90, 960, W - 180, 52, 3);
    c.fillStyle = "#3ddc84"; c.font = '36px "Chakra Petch", sans-serif';
    wrapText(c, tip, 90, 960 + n * 52 + 40, W - 180, 48, 3);
    c.fillStyle = "#6f7d4f"; c.font = '30px "Share Tech Mono", monospace'; c.textAlign = "center";
    c.fillText("💧 " + L("Drick vatten. Ta det lugnt idag.", "Drink water. Take it easy today."), W / 2, H - 80);
  }
  function showBakis(d, missing) {
    var hl = (C().hangover || {}), head = fill(pick(hl.headline), bakisVars(d)), tip = pick(hl.tips);
    A.openSheet(L("🤕 Bakisrapporten", "🤕 Hangover report"), function (body) {
      var el = A.el;
      if (missing && missing.length) body.appendChild(missingBox(missing));
      body.appendChild(el("p", { class: "af-lead", text: head }));
      var cv = el("canvas", { class: "night-card af-card-cv", width: "1080", height: "1350", role: "img", "aria-label": head });
      body.appendChild(cv);
      body.appendChild(el("p", { class: "af-tip", text: tip }));
      var row = el("div", { class: "row", style: "margin-top:10px;flex-wrap:wrap" });
      body.appendChild(row);
      fontsReady().then(function () {
        try { drawBakis(cv, d, head, tip); } catch (e) {}
        shareRow(cv, row, "olnu-bakis.png", head + " " + tip);
      });
    });
  }
  function missingBox(names) {
    var line = fill(pick((C().safeHome || {}).missing), { names: joinNames(names) });
    return A.el("div", { class: "af-missing hud-panel" }, [
      A.el("div", { class: "af-missing-t", text: line }),
      A.el("div", { class: "muted", text: L("Skicka ett sms eller ring. Bättre en gång för mycket.", "Send a text or call. Better once too often.") })
    ]);
  }
  function morning() {
    if (!A || !A.LIVE || !A.authed()) return Promise.resolve(false);
    var s = sthlm();
    if (s.h < 5 || s.h >= 15) return Promise.resolve(false);
    var key = ymd(s.y, s.m, s.d);
    if (U.ls.get(BAKIS_KEY, "") === key) return Promise.resolve(false);
    return Promise.all([bakisData(), missingMates()]).then(function (res) {
      var d = res[0], miss = res[1] || [];
      if (U.ls.get(BAKIS_KEY, "") === key) return false;
      var out = !!(d && d.out);
      if (!out && !miss.length) {
        // A quiet day after a week with nights out: one gentle line, max once a week.
        if (d && (d.nights_week_before | 0) > 0 && s.dow >= 6) {
          var wk = U.ls.get("olnu.afStayed", "");
          if (!wk || Date.now() - (+wk || 0) > 6 * 86400000) {
            U.ls.set("olnu.afStayed", String(Date.now()));
            U.ls.set(BAKIS_KEY, key);
            setTimeout(function () { A.toast(pick((C().hangover || {}).stayedHome), { cls: "water", ms: 6000 }); }, 2500);
          }
        }
        return false;
      }
      U.ls.set(BAKIS_KEY, key);
      var show = function () { if (out) showBakis(d, miss); else showMissing(miss); };
      if (A.sheetOpen()) {
        // Another morning card (Din kväll) is open: offer ours as a toast, never on top of it.
        whenSheetFree(function () {
          A.toast(out ? L("🤕 Bakisrapporten är klar.", "🤕 Your hangover report is ready.") : fill(pick((C().safeHome || {}).missing), { names: joinNames(miss) }),
            { ms: 12000, action: { label: L("Visa", "Show"), fn: show } });
        }, 10 * 60000);
      } else show();
      return true;
    });
  }
  // From settings: last night's report (or tonight's, before 05:00 it is the same night).
  function openBakis() {
    bakisData().then(function (d) {
      if (!d) { A.toast(L("Kunde inte hämta rapporten.", "Could not load the report."), { err: true }); return; }
      if (!d.out) { A.toast(pick((C().hangover || {}).stayedHome) || L("Ingen utekväll igår.", "No night out yesterday."), { cls: "water", ms: 5000 }); return; }
      showBakis(d, null);
    });
  }
  function showMissing(names) {
    A.openSheet(L("🌅 Kom alla hem?", "🌅 Did everyone get home?"), function (body) {
      body.appendChild(missingBox(names));
      body.appendChild(A.el("div", { class: "row", style: "margin-top:12px" }, [A.btn(L("👥 Öppna grupperna", "👥 Open groups"), "btn-block", function () { A.showGroups(); })]));
    });
  }

  /* ---------- 4. Öl Wrapped ---------- */
  var WRAP_KEY = "olnu.afWrapped";
  function wrapLine(keys, v) {
    var all = C().wrapped || [], ok = all.filter(function (s) {
      var ph = String(s).match(/\{\w+\}/g) || [];
      if (!ph.length) return false;
      for (var i = 0; i < ph.length; i++) if (keys.indexOf(ph[i].slice(1, -1)) < 0) return false;
      return true;
    });
    return fill(pick(ok.length ? ok : all.filter(function (s) { return !/\{/.test(s); })), v);
  }
  function wrapCards(d) {
    var v = { favBar: d.fav_bar_name || L("en hemlig krog", "a secret bar"), nights: d.nights | 0, topType: TYPE_SV[d.top_type] || d.top_type || "",
      bestNight: d.best_evening ? dateLabel(d.best_evening) : "", total: d.beers | 0, rank: d.title || "" };
    var per = d.kind === "year" ? String(String(d.from || "").slice(0, 4)) : monthLabel(d.from);
    var cards = [
      { e: "🌙", big: String(v.nights), small: L(v.nights === 1 ? "utekväll" : "utekvällar", "nights out"), line: wrapLine(["nights", "total"], v),
        extra: L((d.home_nights | 0) + " hemma säkert · " + (d.bars | 0) + " krogar", (d.home_nights | 0) + " home safe · " + (d.bars | 0) + " bars") },
      d.fav_bar_id ? { e: "🏠", big: v.favBar, small: L((d.fav_bar_nights | 0) + " kvällar där", (d.fav_bar_nights | 0) + " nights there"), line: wrapLine(["favBar"], v), extra: "" }
        : { e: "🗺️", big: String(d.bars | 0), small: L("krogar", "bars"), line: L("Ingen stamkrog än. Kartan ligger öppen.", "No regular bar yet."), extra: "" },
      d.best_evening ? { e: "⭐", big: v.bestNight, small: L("bästa kvällen", "best night"), line: wrapLine(["bestNight"], v),
        extra: L((d.best_bars | 0) + " krogar den kvällen", (d.best_bars | 0) + " bars that night") }
        : { e: "⭐", big: "–", small: L("bästa kvällen", "best night"), line: "", extra: "" },
      d.top_type ? { e: "🍺", big: v.topType, small: L("favoritsort", "favourite type"), line: wrapLine(["topType"], v), extra: "" }
        : { e: "🍻", big: String((d.skal_given | 0) + (d.skal_got | 0)), small: L("skål", "cheers"), line: L("Skålen flög. Det ä det som räknas.", "Cheers flew."), extra: "" },
      { e: "🎖️", big: v.rank || "–", small: L("din grad", "your rank"), line: wrapLine(["rank", "total", "nights"], v),
        extra: L(v.total + " öl loggade. Statistik, inte tävling.", v.total + " beers logged. Stats, not a contest.") }
    ];
    return { per: per, cards: cards, v: v };
  }
  function drawWrap(cv, d, w) {
    var W = 1080, H = 1350, c = cv.getContext("2d"), acc = "#c77dff";
    cv.width = W; cv.height = H;
    cardBase(c, W, H, acc);
    c.fillStyle = "#ecd9ff"; c.font = '96px "Black Ops One", Impact, sans-serif'; c.textAlign = "left";
    c.fillText("ÖL WRAPPED", 90, 270);
    c.fillStyle = "#9aa3a0"; c.font = '40px "Share Tech Mono", monospace';
    c.fillText(String(w.per).toUpperCase(), 94, 335);
    var y = 420;
    w.cards.forEach(function (k) {
      c.fillStyle = "rgba(16,24,38,.92)"; c.fillRect(90, y, W - 180, 150);
      c.strokeStyle = hexA(acc, 0.45); c.lineWidth = 3; c.strokeRect(90, y, W - 180, 150);
      c.font = "72px sans-serif"; c.textAlign = "left"; c.fillStyle = "#fff"; c.fillText(k.e, 115, y + 100);
      c.fillStyle = "#9aa3a0"; c.font = '28px "Share Tech Mono", monospace'; c.fillText(String(k.small).toUpperCase(), 220, y + 52);
      c.fillStyle = "#ece6d6"; c.font = '700 50px "Chakra Petch", sans-serif';
      var t = String(k.big); while (c.measureText(t).width > W - 340 && t.length > 4) t = t.slice(0, -2);
      c.fillText(t, 220, y + 115);
      y += 172;
    });
    c.fillStyle = "#6f7d4f"; c.font = '30px "Share Tech Mono", monospace'; c.textAlign = "center";
    c.fillText("💧 " + L("Lagom ä ett fint svenskt ord.", "Moderation is a fine word."), W / 2, H - 80);
  }
  function openWrapped(kind, offset) {
    if (!A || !A.LIVE || off.my_wrapped) return;
    call("my_wrapped", { p_kind: kind || "month", p_offset: offset == null ? 1 : offset }).then(function (r) {
      if (r.error) { if (!r.off) A.toast(L("Wrapped gick inte att hämta.", "Could not load Wrapped."), { err: true }); return; }
      showWrapped(A.parseData(r.data));
    });
  }
  function showWrapped(d) {
    var w = wrapCards(d);
    A.openSheet("🎁 Öl Wrapped · " + w.per, function (body) {
      var el = A.el;
      if (!(d.nights | 0)) {
        body.appendChild(el("p", { class: "af-lead", text: L("Ingen utekväll den här perioden. Soffan tackar för sällskapet.", "No nights out in this period.") }));
        return;
      }
      var story = el("div", { class: "af-story", role: "list" }), dots = el("div", { class: "af-dots", "aria-hidden": "true" });
      w.cards.forEach(function (k, i) {
        story.appendChild(el("div", { class: "af-scard hud-panel", role: "listitem", "aria-label": (i + 1) + "/" + w.cards.length }, [
          el("div", { class: "af-sn", text: (i + 1) + "/" + w.cards.length }),
          el("div", { class: "af-se", text: k.e }),
          el("div", { class: "af-sbig", text: k.big }),
          el("div", { class: "af-ssmall", text: k.small }),
          k.line ? el("p", { class: "af-sline", text: k.line }) : null,
          k.extra ? el("div", { class: "af-sextra", text: k.extra }) : null
        ]));
        dots.appendChild(el("span", { class: i ? "" : "on" }));
      });
      story.addEventListener("scroll", U.debounce(function () {
        var i = Math.round(story.scrollLeft / Math.max(1, story.clientWidth));
        Array.prototype.forEach.call(dots.children, function (x, j) { x.className = j === i ? "on" : ""; });
      }, 60));
      body.appendChild(story); body.appendChild(dots);
      body.appendChild(el("p", { class: "muted af-swipe", text: L("👉 Svep för nästa kort", "👉 Swipe for the next card") }));
      var cv = el("canvas", { class: "night-card af-card-cv", width: "1080", height: "1350", role: "img", "aria-label": "Öl Wrapped " + w.per });
      var row = el("div", { class: "row", style: "margin-top:10px;flex-wrap:wrap" });
      body.appendChild(row);
      var text = "🎁 Öl Wrapped " + w.per + ": " + w.cards.map(function (k) { return k.e + " " + k.big; }).join(" · ");
      fontsReady().then(function () { try { drawWrap(cv, d, w); } catch (e) {} shareRow(cv, row, "olnu-wrapped.png", text); });
    });
  }
  // Automatic: once on the 1st–3rd of a month (January: the year).
  function autoWrapped() {
    if (!A || !A.LIVE || off.my_wrapped || A.sheetOpen()) return;
    var s = sthlm(); if (s.d > 3 || s.h < 5) return;
    var key = s.y + "-" + s.m;
    if (U.ls.get(WRAP_KEY, "") === key) return;
    var kind = s.m === 1 ? "year" : "month";
    call("my_wrapped", { p_kind: kind, p_offset: 1 }).then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data);
      U.ls.set(WRAP_KEY, key);
      if (!(d.nights | 0)) return;
      whenSheetFree(function () {
        A.toast(L("🎁 Din Öl Wrapped för " + (kind === "year" ? String(d.from).slice(0, 4) : monthLabel(d.from)) + " är klar!", "🎁 Your Öl Wrapped is ready!"),
          { cls: "promo", ms: 15000, action: { label: L("Öppna", "Open"), fn: function () { showWrapped(d); } } });
      }, 10 * 60000);
    });
  }

  /* ---------- 6. Röstskål in the group chat ---------- */
  var VOICE_MAX_MS = 5000, VOICE_MAX_BYTES = 60 * 1024;
  var audioUrls = {};
  function recOK() { return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function pickMime() {
    var list = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm", "audio/aac"];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return "";
  }
  function canPlay(mime) {
    try { var a = document.createElement("audio"); return !!(a.canPlayType && (a.canPlayType(mime) || a.canPlayType(String(mime).split(";")[0]))); } catch (e) { return true; }
  }
  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function voiceRow(v, ctx) {
    var el = A.el, col = v.is_me ? null : (ctx.color ? ctx.color(v.name || "") : null);
    var secs = Math.max(1, Math.round((v.dur_ms | 0) / 100) / 10);
    var play = el("button", { type: "button", class: "af-play", "data-afv": String(v.id), "data-mime": v.mime || "",
      "aria-label": L("Spela röstskål", "Play voice cheers") }, [el("span", { text: "▶️" }), el("span", { text: L("Röstskål", "Voice cheers") + " · " + String(secs).replace(".", ",") + " s" })]);
    var name = el("span", { class: "cm-name", text: (v.name || (v.is_me ? L("Du", "You") : L("Någon", "Someone"))) });
    if (col) name.style.color = col;
    return el("li", { class: "chat-msg af-voice" + (v.is_me ? " me" : ""), style: col ? "border-left-color:" + col : "", "data-at": String(v.created_at || ""), "data-afvid": String(v.id) }, [
      el("div", { class: "cm-head" }, [name, el("span", { class: "cm-time", text: U.timeHM(v.created_at) })]),
      el("div", { class: "cm-body" }, [play])
    ]);
  }
  function insertSorted(list, li) {
    var at = Date.parse(li.getAttribute("data-at")) || 0, kids = list.children;
    var empty = list.querySelector(".chat-empty"); if (empty) empty.remove();
    for (var i = 0; i < kids.length; i++) {
      var t = Date.parse(kids[i].getAttribute("data-at") || "") || 0;
      if (t && t > at) { list.insertBefore(li, kids[i]); return; }
    }
    list.appendChild(li);
  }
  function playVoice(btn) {
    var id = btn.getAttribute("data-afv"), mime = btn.getAttribute("data-mime") || "";
    if (mime && !canPlay(mime)) { A.toast(L("🔇 Den här telefonen kan inte spela det ljudformatet.", "🔇 This phone can't play that format."), { err: true }); return; }
    var go = function (url) {
      try {
        var a = new Audio(url);
        btn.classList.add("on");
        a.onended = a.onerror = function () { btn.classList.remove("on"); };
        var p = a.play(); if (p && p.catch) p.catch(function () { btn.classList.remove("on"); A.toast(L("Kunde inte spela upp.", "Could not play."), { err: true }); });
      } catch (e) { A.toast(L("Kunde inte spela upp.", "Could not play."), { err: true }); }
    };
    if (audioUrls[id]) { go(audioUrls[id]); return; }
    btn.disabled = true;
    call("voice_audio", { p_id: +id }).then(function (r) {
      btn.disabled = false;
      if (r.error) { A.toast(codeOf(r.error) === "voice_not_found" ? L("Röstskålen har gått ut (05:00).", "The voice message expired.") : L("Kunde inte hämta ljudet.", "Could not load audio."), { err: true }); return; }
      var d = A.parseData(r.data);
      try {
        var bin = atob(String(d.b64 || "")), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        audioUrls[id] = URL.createObjectURL(new Blob([arr], { type: String(d.mime || mime).split(";")[0] }));
        go(audioUrls[id]);
      } catch (e) { A.toast(L("Kunde inte spela upp.", "Could not play."), { err: true }); }
    });
  }
  function chatOpen(g, ctx) {
    if (!A || !A.LIVE || off.group_voices || !ctx || !ctx.list) return;
    var list = ctx.list, lastId = 0, seen = {}, timer = null, busy = false;
    list.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".af-play"); if (b && !b.disabled) playVoice(b);
    });
    function load() {
      if (!ctx.alive()) { clearInterval(timer); return; }
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      call("group_voices", { p_group_id: g.id, p_after_id: lastId }).then(function (r) {
        busy = false;
        if (r.error) { if (r.off) { clearInterval(timer); if (mic) mic.remove(); } return; }
        rows(r).forEach(function (v) {
          if (v.id > lastId) lastId = v.id;
          if (seen[v.id]) return; seen[v.id] = 1;
          insertSorted(list, voiceRow(v, ctx));
        });
        if (rows(r).length) list.scrollTop = list.scrollHeight;
      });
    }
    timer = setInterval(load, 10000);
    setTimeout(load, 300);
    // Hold-to-record mic button (max 5 s).
    var mic = null;
    if (!recOK() || !ctx.input) return;
    mic = A.el("button", { type: "button", class: "af-mic", "aria-label": L("Håll inne för röstskål (max 5 s)", "Hold to record a voice cheers (max 5 s)"), title: L("Håll inne: röstskål", "Hold: voice cheers"), text: "🎙️" });
    ctx.input.insertBefore(mic, ctx.input.lastChild);
    var rec = null, stream = null, chunks = [], t0 = 0, stopT = null, holding = false, ring = null;
    function cleanup() {
      clearTimeout(stopT); stopT = null; mic.classList.remove("rec");
      if (ring) { ring.remove(); ring = null; }
      if (stream) { try { stream.getTracks().forEach(function (x) { x.stop(); }); } catch (e) {} stream = null; }
    }
    function start(e) {
      if (e) e.preventDefault();
      if (rec || mic.disabled) return;
      holding = true;
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
        stream = s;
        if (!holding) { cleanup(); A.toast(L("🎙️ Mikrofonen ä redo. Håll inne knappen och prata.", "🎙️ Mic ready. Hold the button and talk.")); return; }
        var mime = pickMime(), opts = { audioBitsPerSecond: 32000 };
        if (mime) opts.mimeType = mime;
        try { rec = new MediaRecorder(s, opts); } catch (x) { rec = new MediaRecorder(s); }
        chunks = [];
        rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.onstop = function () { var r0 = rec; rec = null; finish(r0); };
        t0 = Date.now(); rec.start();
        mic.classList.add("rec");
        ring = A.el("span", { class: "af-rec-t", text: "5" }); mic.appendChild(ring);
        var tick = setInterval(function () { if (!ring) { clearInterval(tick); return; } ring.textContent = String(Math.max(0, Math.ceil((VOICE_MAX_MS - (Date.now() - t0)) / 1000))); }, 200);
        stopT = setTimeout(stop, VOICE_MAX_MS);
        window.FX && window.FX.vibrate && window.FX.vibrate(15);
      }, function () { holding = false; A.toast(L("🎙️ Ingen mikrofon. Tillåt mikrofonen i webbläsarens inställningar.", "🎙️ No microphone access."), { err: true }); });
    }
    function stop() { holding = false; if (rec && rec.state !== "inactive") { try { rec.stop(); } catch (e) { cleanup(); } } }
    function finish(r0) {
      var dur = Date.now() - t0, mime = String((r0 && r0.mimeType) || pickMime() || "audio/webm").toLowerCase().replace(/\s+/g, "");
      cleanup();
      if (dur < 500) { A.toast(L("Håll inne knappen medan du pratar.", "Hold the button while you talk.")); return; }
      var blob = new Blob(chunks, { type: mime });
      if (blob.size > VOICE_MAX_BYTES) { A.toast(L("För långt ljud. Max 5 sekunder.", "Too long. Max 5 seconds."), { err: true }); return; }
      if (blob.size < 100) { A.toast(L("Inget ljud kom med. Försök igen.", "No sound. Try again."), { err: true }); return; }
      mic.disabled = true;
      blobB64(blob).then(function (b64) {
        return call("post_voice", { p_group_id: g.id, p_mime: mime, p_b64: b64, p_dur_ms: Math.min(6000, dur) });
      }).then(function (r) {
        mic.disabled = false;
        if (r.error) {
          var c = codeOf(r.error);
          A.toast(c === "voice_limit" ? L("Max 10 röstskål per kväll. Skriv istället!", "Max 10 voice messages per night.") :
            c === "slow_down" ? L("Lugn i stormen. Vänta några sekunder.", "Slow down a little.") :
            c === "not_member" ? L("Du är inte med i gruppen längre.", "You're not in this group.") :
            L("Röstskålen gick inte att skicka.", "Could not send."), { err: true });
          return;
        }
        var d = A.parseData(r.data);
        A.toast(L("🎙️ Röstskål skickad!", "🎙️ Voice cheers sent!") + ((d.left | 0) <= 3 ? L(" (" + Math.max(0, d.left | 0) + " kvar ikväll)", " (" + Math.max(0, d.left | 0) + " left)") : ""), { cls: "skal" });
        invoke({ event: "voice", voice_id: d.id });
        load();
      }, function () { mic.disabled = false; A.toast(L("Röstskålen gick inte att skicka.", "Could not send."), { err: true }); });
    }
    mic.addEventListener("pointerdown", start);
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { mic.addEventListener(ev, function () { if (holding || rec) stop(); }); });
    mic.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    mic.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !rec) start(e); });
    mic.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") stop(); });
  }

  /* ---------- 7. Stad mot stad ---------- */
  var league = null, leagueAt = 0;
  function loadLeague(force) {
    if (off.city_league) return Promise.resolve(null);
    if (!force && league && Date.now() - leagueAt < 30 * 60000) return Promise.resolve(league);
    leagueAt = Date.now();
    return call("city_league", { p_week_offset: 0 }).then(function (r) { if (!r.error) league = rows(r); return league; });
  }
  function leagueBox(body) {
    if (!A || !A.LIVE || off.city_league) return;
    var el = A.el, sec = el("section", { class: "af-league" }), list = el("ol", { class: "top-list af-llist" });
    sec.appendChild(el("h3", { text: L("🏙️ Stad mot stad · veckan", "🏙️ Town vs town · this week") }));
    sec.appendChild(list);
    sec.appendChild(el("p", { class: "muted af-lnote", text: L("Poäng per aktiv soldat: utekvällar + hemma säkert + incheckningar + skål. Aldrig antal öl. Minst 3 soldater per stad.",
      "Points per active user: nights out + home safe + check-ins + cheers. Never number of beers. Min 3 users per town.") }));
    body.appendChild(sec);
    list.appendChild(el("li", { class: "muted top-empty", text: "…" }));
    loadLeague(true).then(function (rs) {
      if (!document.body.contains(list)) return;
      list.innerHTML = "";
      if (!rs) { if (off.city_league) sec.remove(); else list.appendChild(el("li", { class: "muted top-empty", text: L("Kunde inte hämta.", "Could not load.") })); return; }
      if (!rs.length) { list.appendChild(el("li", { class: "muted top-empty", text: L("Ingen stad har poäng än den här veckan.", "No town has points yet.") })); return; }
      rs.forEach(function (x) {
        list.appendChild(el("li", {}, [el("div", { class: "top-row af-lrow" + (x.is_mine ? " mine" : "") }, [
          el("span", { class: "top-rank", text: x.rank ? String(x.rank).padStart(2, "0") : "–" }),
          el("span", { class: "top-main" }, [el("span", { class: "top-name", text: x.town + (x.is_mine ? L(" · din stad", " · your town") : "") }),
            el("span", { class: "top-sub", text: x.rank ? L((x.users | 0) + " soldater · " + (x.nights | 0) + " kvällar · " + (x.home | 0) + " hemma säkert", (x.users | 0) + " users · " + (x.nights | 0) + " nights")
              : L("för få soldater för tabellen (" + (x.users | 0) + "/3)", "too few users (" + (x.users | 0) + "/3)") })]),
          el("span", { class: "top-n", text: (x.points | 0) + L(" poäng", " pts") })
        ])]));
      });
    });
  }

  /* ---------- 8. Krog-QR + ?checkin=1&bar=<id> ---------- */
  var pendingCi = null;
  (function () {
    try {
      var p = new URLSearchParams(location.search);
      if (p.get("checkin") === "1" && p.get("bar")) {
        pendingCi = { id: String(p.get("bar")).slice(0, 80), at: Date.now() };
        p.delete("checkin");   // app.js removes ?bar= itself (and opens that bar's popup)
        var qs = p.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      }
    } catch (e) {}
  })();
  function runPendingCheckin() {
    var pc = pendingCi; if (!pc) return;
    pendingCi = null;
    var tries = 0;
    (function wait() {
      var b = document.querySelector('.ci-btn[data-ci="' + pc.id.replace(/["\\]/g, "") + '"]');
      var bar = window.BARS && window.BARS.byId(pc.id);
      if (!b || !bar) { if (++tries < 40) setTimeout(wait, 500); else A.toast(L("Hittade inte krogen. Tryck på den på kartan och checka in.", "Bar not found."), { err: true }); return; }
      if (b.disabled) return;   // already checked in here
      A.getPosition().then(function (pos) {
        var d = U.haversine(pos.coords.latitude, pos.coords.longitude, bar.lat, bar.lng);
        if (d > 300) { A.toast(L("📍 Du ä " + Math.round(d / 10) * 10 + " m bort. Kom närmare (300 m) för att checka in via QR.", "📍 You're " + Math.round(d) + " m away (max 300 m)."), { ms: 6000 }); return; }
        var btn = document.querySelector('.ci-btn[data-ci="' + pc.id.replace(/["\\]/g, "") + '"]') || b;
        if (!btn.disabled) btn.click();
      }, function (err) { A.locError(err); });
    })();
  }
  function qrHref(bar) {
    return "qr.html?bar=" + encodeURIComponent(String(bar.id)) + "&n=" + encodeURIComponent(String(bar.name || "").slice(0, 60));
  }

  /* ---------- 9. Stammis-krona ---------- */
  var regs = {}, regsBusy = {};
  function stamHTML(id) {
    var r = regs[id]; if (!r || !r.rows) return "";
    var top = null, me = null;
    r.rows.forEach(function (x) { if ((x.rank | 0) === 1 && (x.nights | 0) >= 2) top = x; if (x.is_me) me = x; });
    var h = "";
    if (top) h += '<div class="af-stam-l">👑 ' + esc(top.is_me ? L("Du ä stammis här", "You're the regular here") : L("Stammis: ", "Regular: ") + (top.name || L("en hemlig agent", "a secret agent"))) +
      " (" + esc(String(top.nights | 0) + L(" kvällar", " nights")) + ")</div>";
    if (me && !(top && top.is_me)) h += '<div class="af-stam-me muted">🪑 ' + esc(L("Du: " + (me.nights | 0) + (me.nights === 1 ? " kväll" : " kvällar") + " här senaste 30 dagarna", "You: " + (me.nights | 0) + " nights here (30 days)")) + "</div>";
    return h;
  }
  function loadRegs(id) {
    if (off.bar_regulars || regsBusy[id]) return;
    var r = regs[id]; if (r && Date.now() - r.at < 5 * 60000) return;
    regsBusy[id] = true;
    call("bar_regulars", { p_bar_id: id }).then(function (res) {
      regsBusy[id] = false;
      if (res.error) return;
      regs[id] = { at: Date.now(), rows: rows(res) };
      document.querySelectorAll('.af-stam[data-afstam="' + id.replace(/["\\]/g, "") + '"]').forEach(function (x) { x.innerHTML = stamHTML(id); });
    });
  }

  /* ---------- 10. Kebab-radar ---------- */
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var kebabCache = null;
  var DAYS = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };
  function mins(s) { var m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s); if (!m) return null; var h = +m[1], mi = +(m[2] || 0); if (h > 48 || mi > 59) return null; return h * 60 + mi; }
  // Simple OSM opening_hours: "24/7", "Mo-Th 11:00-23:00; Fr,Sa 11:00-03:00; Su off", "11-22". true/false, null = unknown.
  function openNow(oh, now) {
    oh = String(oh || "").trim(); if (!oh) return null;
    if (/^24\/7$/.test(oh)) return true;
    var s = now || sthlm(), cur = s.h * 60 + s.min, today = s.dow, yday = today === 1 ? 7 : today - 1;
    var rules = oh.split(";").map(function (x) { return x.trim(); }).filter(Boolean), perDay = {};
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i].replace(/\s+/g, " "), m = /^((?:[A-Za-z]{2}(?:-[A-Za-z]{2})?)(?:,[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)?\s*(.*)$/.exec(r);
      if (!m) return null;
      var dsel = m[1], rest = m[2].trim(), days = [];
      if (/^(PH|SH)/i.test(r)) continue;
      if (dsel) {
        var parts = dsel.split(",");
        for (var j = 0; j < parts.length; j++) {
          var ab = parts[j].toLowerCase().split("-"), a = DAYS[ab[0]], b = ab[1] ? DAYS[ab[1]] : a;
          if (!a || !b) return null;
          for (var k = a, n = 0; n < 7; n++) { days.push(k); if (k === b) break; k = k === 7 ? 1 : k + 1; }
        }
      } else days = [1, 2, 3, 4, 5, 6, 7];
      var ranges = [];
      if (/^(off|closed)$/i.test(rest)) ranges = [];
      else {
        if (!rest) return null;
        var segs = rest.split(",");
        for (var q = 0; q < segs.length; q++) {
          var tm = /^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\+?$/.exec(segs[q].trim());
          if (!tm) return null;
          var st = mins(tm[1]), en = mins(tm[2]); if (st == null || en == null) return null;
          ranges.push([st, en]);
        }
      }
      days.forEach(function (d) { perDay[d] = ranges; });
    }
    var any = false, td = perDay[today], yd = perDay[yday];
    if (td) { any = true; for (var x = 0; x < td.length; x++) { var a1 = td[x][0], b1 = td[x][1]; if (b1 <= a1) b1 += 1440; if (cur >= a1 && cur < b1) return true; } }
    if (yd) { any = true; for (var y = 0; y < yd.length; y++) { var a2 = yd[y][0], b2 = yd[y][1]; if (b2 <= a2 || b2 > 1440) { var e2 = b2 <= a2 ? b2 : b2 - 1440; if (cur < e2) return true; } } }
    return any ? false : null;
  }
  function here() {
    var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return l;
    var c = A.center && A.center(); return c && isFinite(c.lat) ? c : null;
  }
  function fetchKebab(p) {
    if (kebabCache && Date.now() - kebabCache.at < 10 * 60000 && U.haversine(p.lat, p.lng, kebabCache.lat, kebabCache.lng) < 500) return Promise.resolve(kebabCache.list);
    var q = '[out:json][timeout:10];(node["amenity"~"^(fast_food|restaurant)$"](around:2500,' + p.lat.toFixed(5) + "," + p.lng.toFixed(5) + ');way["amenity"~"^(fast_food|restaurant)$"](around:2500,' +
      p.lat.toFixed(5) + "," + p.lng.toFixed(5) + "););out center tags 120;";
    function tryUrl(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error("overpass"));
      var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
      return fetch(OVERPASS[i], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .catch(function () { clearTimeout(tm); return tryUrl(i + 1); });
    }
    return tryUrl(0).then(function (j) {
      var list = (j && j.elements || []).map(function (e) {
        var tg = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, ln = e.lon != null ? e.lon : e.center && e.center.lon;
        if (!isFinite(la) || !isFinite(ln) || !tg.name) return null;
        return { name: tg.name, lat: +la, lng: +ln, fast: tg.amenity === "fast_food", oh: tg.opening_hours || "", cuisine: tg.cuisine || "" };
      }).filter(Boolean);
      kebabCache = { at: Date.now(), lat: p.lat, lng: p.lng, list: list };
      return list;
    }, function () {
      // Fallback: docs/places.json (fast food only, no opening hours).
      return fetch("./places.json", { cache: "force-cache" }).then(function (r) { return r.ok ? r.json() : []; }).then(function (arr) {
        return (Array.isArray(arr) ? arr : []).filter(function (x) { return x && x[3] === "f" && U.haversine(p.lat, p.lng, x[1], x[2]) <= 2500; })
          .map(function (x) { return { name: x[0], lat: +x[1], lng: +x[2], fast: true, oh: "", cuisine: "" }; });
      }).catch(function () { return []; });
    });
  }
  function showKebab() {
    var p = here();
    A.openSheet(L("🌯 Öppet nu", "🌯 Open now"), function (body) {
      var el = A.el, list = el("ul", { class: "af-kebab" });
      body.appendChild(el("p", { class: "muted", text: L("Mat nära dig (2,5 km) från OpenStreetMap. Öppettider kan vara fel: ring om du ä osäker.", "Food near you (2.5 km) from OpenStreetMap.") }));
      body.appendChild(list);
      if (!p) { list.appendChild(el("li", { class: "muted", text: L("Ingen position. Tryck 📍 först.", "No position yet.") })); return; }
      list.appendChild(el("li", { class: "muted", text: "…" }));
      fetchKebab(p).then(function (all) {
        if (!document.body.contains(list)) return;
        list.innerHTML = "";
        var s = sthlm(), items = all.map(function (x) { return { x: x, open: openNow(x.oh, s), d: U.haversine(p.lat, p.lng, x.lat, x.lng) }; })
          .filter(function (o) { return o.open === true || (o.open === null && o.x.fast); })
          .sort(function (a, b) { return (b.open === true) - (a.open === true) || (b.x.fast - a.x.fast) || a.d - b.d; }).slice(0, 25);
        if (!items.length) { list.appendChild(el("li", { class: "muted", text: L("Inget öppet ställe hittat nära dig. Kylskåpet ä din vän.", "Nothing open found nearby.") })); return; }
        items.forEach(function (o) {
          var kebab = /kebab|pizza|burger|falafel|grill/i.test(o.x.cuisine + " " + o.x.name);
          list.appendChild(el("li", {}, [el("button", { type: "button", class: "af-krow", onclick: function () { A.closeSheet(); A.flyTo(o.x.lat, o.x.lng, 17, null); } }, [
            el("span", { class: "af-ke", text: kebab ? "🌯" : o.x.fast ? "🍔" : "🍽️" }),
            el("span", { class: "af-kmain" }, [el("span", { class: "af-kname", text: o.x.name }),
              el("span", { class: "af-ksub" + (o.open ? " open" : ""), text: (o.open ? L("Öppet nu", "Open now") : L("öppettider okända", "hours unknown")) + (o.x.oh ? " · " + o.x.oh.slice(0, 50) : "") })]),
            el("span", { class: "af-kd", text: o.d < 1000 ? Math.round(o.d / 10) * 10 + " m" : (o.d / 1000).toFixed(1).replace(".", ",") + " km" })
          ])]));
        });
        kebabCount = items.filter(function (o) { return o.open === true; }).length;
      });
    });
  }
  var kebabCount = 0;
  function lateNight() { var h = sthlm().h; return h >= 23 || h < 4; }

  /* ---------- Ticker (window.NEWS) ---------- */
  var KEBAB_NEWS = [
    "🌯 Kebabradarn ä på: tryck 🚕 och 🌯 Öppet nu för mat nära dig.",
    "🌯 Klockan ä mycket. Kebaben ringer. Svara.",
    "🍔 Nattmat-rapport: grillen ä varm nånstans nära dig. Kolla 🌯 Öppet nu.",
    "🌯 Underrättelse: en falafel har setts i närheten. Öppet nu-listan vet mer."
  ];
  function newsTemplates() {
    var out = [];
    var hols = C().holidays || {};
    Object.keys(hols).forEach(function (k) {
      (hols[k].lines || []).forEach(function (line) { out.push({ k: "afHol_" + k, f: function () { return line; } }); });
    });
    (C().cityVsCity || []).forEach(function (line) { out.push({ k: "afCity", f: function (d) { return /\{rival\}/.test(line) && !d.rival ? "" : fill(line, d); } }); });
    KEBAB_NEWS.forEach(function (line) { out.push({ k: "afKebab", f: function () { return line; } }); });
    return out;
  }
  function newsCands() {
    var out = [];
    if (holKey) { out.push({ k: "afHol_" + holKey, d: {}, imp: 1 }); out.push({ k: "afHol_" + holKey, d: {}, imp: 0 }); }
    if (league && league.length) {
      var ranked = league.filter(function (x) { return x.rank; });
      if (ranked.length) {
        var top = ranked[0], rival = ranked[1] || null;
        out.push({ k: "afCity", d: { town: top.town, n: top.points | 0, rival: rival ? rival.town : "", avg: ((top.points | 0) / 10).toFixed(1).replace(".", ",") }, imp: 0 });
      }
    }
    if (lateNight() && A && A.myBeer && A.myBeer()) out.push({ k: "afKebab", d: {}, imp: 0 });
    return out;
  }
  // news.js (v12) only asks window.BARSPLUS. Until news.js also asks window.AFTER, ride along on BARSPLUS.
  function hookNews() {
    var N = window.NEWS, bp = window.BARSPLUS;
    if (N && /AFTER/.test(String(N.build))) return;   // news.js knows us
    if (!bp || bp._afWrapped) return;
    var t0 = bp.newsTemplates, c0 = bp.newsCands;
    bp.newsTemplates = function () { var a = []; try { a = t0 ? t0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsTemplates()); };
    bp.newsCands = function (ctx) { var a = []; try { a = c0 ? c0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsCands(ctx)); };
    bp._afWrapped = true;
  }

  /* ---------- Taxi sheet: add "🌯 Öppet nu" (extras.js showTaxi has no hook) ---------- */
  function watchTaxiSheet() {
    var body = $("sheet-body"), title = $("sheet-title"); if (!body || !window.MutationObserver) return;
    new MutationObserver(function () {
      if ($("sheet").hidden || body.querySelector(".af-kebab-btn")) return;
      var tt = I.t("taxiTitle");
      if (title.textContent !== tt || !body.querySelector(".taxi-row")) return;
      body.appendChild(kebabBtn());
    }).observe(body, { childList: true });
  }
  function kebabBtn() {
    return A.el("div", { class: "row af-kebab-btn", style: "margin-top:10px" }, [A.btn(L("🌯 Öppet nu: mat nära dig", "🌯 Open now: food nearby"), "btn-block", showKebab)]);
  }

  /* ---------- Public hooks (called from app.js through mods()) ---------- */
  window.AFTER = {
    holidayOf: holidayOf, openNow: openNow, openWrapped: openWrapped, showKebab: showKebab, newsTemplates: newsTemplates, newsCands: newsCands,
    chatOpen: chatOpen, statusRow: statusRow,
    init: function (api) {
      A = api;
      addMedalNames();
      applyHoliday();
      setInterval(applyHoliday, 10 * 60000);
      hookNews();
      setTimeout(hookNews, 0);
      watchTaxiSheet();
      A.map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement && e.popup.getElement();
        if (!root) return;
        root.querySelectorAll(".af-stam[data-afstam]").forEach(function (x) { loadRegs(x.getAttribute("data-afstam")); });
        if (root._olnuAf) return;
        root._olnuAf = true;
        root.addEventListener("click", function (ev) {
          var b = ev.target && ev.target.closest && ev.target.closest(".af-med-btn"); if (!b) return;
          ev.preventDefault(); ev.stopPropagation();
          var id = b.getAttribute("data-afmed"), pin = null;
          A.beers().forEach(function (x) { if (String(x.id) === id) pin = x; });
          if (pin) claim(pin, b);
        });
      });
    },
    onAuthed: function () {
      loadLeague(false).then(function () { A.renderTicker(); });
      loadChecks(true);
      if (pendingCi) setTimeout(runPendingCheckin, 600);
      setTimeout(function () { if (!A.sheetOpen()) autoWrapped(); else whenSheetFree(autoWrapped, 5 * 60000); }, 4000);
    },
    onReadyShow: function () {
      // Morning card is async; it waits for any other sheet (Din kväll) and never stacks on top of it.
      var s = sthlm();
      if (!A.LIVE || s.h < 5 || s.h >= 15 || U.ls.get(BAKIS_KEY, "") === ymd(s.y, s.m, s.d)) return "";
      morning();
      return "1";
    },
    onPoll: function (beers) {
      scanMedevac(beers);
      if (Date.now() - leagueAt > 30 * 60000) loadLeague(false);
      if (homeCache && Date.now() - homeAt > 60000) homeCache = null;
    },
    onStopped: function (kind) { if (kind === "home") markHome(); },
    hudChipsHTML: function (ctx) {
      if (!A || !A.LIVE) return "";
      var m = openMed();
      if (m) return '<button type="button" class="hx-chip af-chip-med" data-hx="afmed" aria-label="' + esc(fill(MED_ASK[0], { name: m.friend_name })) + '">🚑 ' + esc(m.friend_name) + "</button>";
      if (lateNight() && (ctx && ctx.n | 0) >= 1) return '<button type="button" class="hx-chip af-chip-kebab" data-hx="afkebab" aria-label="' + esc(L("Öppet nu: mat nära dig", "Open now: food nearby")) + '">🌯 ' + esc(L("Mat nu", "Food now")) + '</button>';
      return "";
    },
    hudClick: function (action) {
      if (action === "afkebab") showKebab();
      else if (action === "afmed") {
        var m = openMed(); if (!m) return;
        A.openSheet(L("🚑 Kompisvakt", "🚑 Buddy check"), function (body) {
          body.appendChild(A.el("p", { class: "af-lead", text: fill(pick(MED_ASK), { name: m.friend_name }) }));
          body.appendChild(A.el("p", { class: "muted", text: L("Gå dit, ta ett snack, bjud på vatten. Den som trycker först har koll. Gruppen får veta.", "Go there, talk, bring water. First to tap owns it.") }));
          body.appendChild(A.el("div", { class: "row", style: "margin-top:10px" }, [
            A.btn(L("🚑 Jag kollar", "🚑 I'll check"), "btn-green btn-block", function () { A.closeSheet(); claim(m); })]));
          body.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [
            A.btn(L("📍 Visa på kartan", "📍 Show on map"), "btn-block", function () { A.closeSheet(); A.flyTo(m.lat, m.lng, 17, m.id); })]));
          if (window.EXTRAS && window.EXTRAS.taxiHTML) body.appendChild(A.el("div", { html: window.EXTRAS.taxiHTML("btn btn-small taxi-btn") }));
        });
      }
    },
    beerPopupHTML: function (b) { return medPopupHTML(b); },
    medevacExtraHTML: function () { return ""; },
    barPopupHTML: function (bar) {
      if (!A || !A.LIVE || !bar || bar.id == null) return "";
      var id = String(bar.id), h = "";
      if (!off.bar_regulars) h += '<div class="af-stam" data-afstam="' + esc(id) + '">' + stamHTML(id) + "</div>";
      h += '<a class="af-qr" href="' + esc(qrHref(bar)) + '" target="_blank" rel="noopener">' + esc(L("🖨️ Skriv ut QR-affisch", "🖨️ Print QR poster")) + "</a>";
      return h;
    },
    topSheet: function (body) { leagueBox(body); },
    stopSheet: function (body) {
      if (!A || !A.LIVE) return;
      body.appendChild(kebabBtn());
    },
    settingsSheet: function (body) {
      if (!A || !A.LIVE || off.my_wrapped) return;
      body.appendChild(A.el("h3", { text: "🎁 Öl Wrapped" }));
      body.appendChild(A.el("div", { class: "row", style: "flex-wrap:wrap" }, [
        A.btn(L("Förra månaden", "Last month"), "btn-small", function () { openWrapped("month", 1); }),
        A.btn(L("Den här månaden", "This month"), "btn-small", function () { openWrapped("month", 0); }),
        A.btn(L("Året", "This year"), "btn-small", function () { openWrapped("year", 0); })
      ]));
      if (!off.my_night_report) body.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [
        A.btn(L("🤕 Senaste bakisrapporten", "🤕 Last hangover report"), "btn-small", openBakis)]));
    }
  };
})();
