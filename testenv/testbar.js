/* PintsNow TEST TOOLBAR (testenv/testbar.js + testbar.css). ONLY in the staging test build (beta/transform.py
   --mode staging puts it right before app.js). Needs testenv/testenv.js (window.PNTEST) loaded first in <head>.
   PC (wide screen): a docked side panel on the right (fold it with the tab). Phone: a small ⚙ button that opens the
   panel as a bottom sheet. Everything here talks to STAGING only (the build has no live address in it).
   Sections: this device · Testgänget · position · clock · flags · jump to · moments · bots · dialect · other. */
(function () {
  "use strict";
  var PN = window.PNTEST;
  if (!PN) return;
  var A = null, gang = null, flags = {}, pickMode = false, box = null, fab = null;
  var LS = window.localStorage;

  // the app gives every module its api in init(): take it from one module (DM loads before this file)
  ["DM", "INBOX", "SPEL", "PARTY", "BOLD"].some(function (n) {
    var m = window[n];
    if (!m || typeof m.init !== "function") return false;
    var o = m.init;
    m.init = function (a) { A = a; try { setTimeout(onApi, 0); } catch (e) {} return o.apply(this, arguments); };
    return true;
  });

  var PLACES = [
    { k: "pitchers", name: "Pitchers", lat: 60.14997, lng: 15.18679 },
    { k: "lobby", name: "Lobbybaren", lat: 60.15098, lng: 15.18663 },
    { k: "ludvika", name: "Ludvika centrum", lat: 60.1496, lng: 15.1878 },
    { k: "home", name: "Hemma", lat: 60.1440, lng: 15.1700 },
    { k: "borlange", name: "Borlänge", lat: 60.4858, lng: 15.4371 },
    { k: "sodermalm", name: "Stockholm Södermalm", lat: 59.3149, lng: 18.0716 }
  ];
  var FLAGS = [
    ["moments", "Moment (spel som kommer till dig)"], ["moment_push", "Moment-push"], ["game_push", "Spel-push"],
    ["morning_push", "Morgonrapport-push"], ["ride_v2", "Ride v2 (Hämta mig)"], ["ride_v2_more", "Ride v2 extra (Fråga fler, taxi)"],
    ["bold_hemlage", "Hem-läge"], ["bold_krog", "Kvällens krog"], ["bold_skal_v2", "Skåltimmen v2"], ["bold_replay", "Kvällsrepris 2.0"],
    ["bold_bump", "Skål! bump"], ["ntf_v2", "Notiser v2"], ["email_login", "E-postinloggning"]
  ];
  var REGIONS = [["sv-neutral", "Neutral"], ["sv-dalarna", "Dalarna"], ["sv-sthlm", "Stockholm"], ["sv-syd", "Syd"], ["sv-vast", "Väst"],
    ["sv-norr", "Norrland"], ["sv-smaland", "Småland"], ["sv-varmland", "Värmland"], ["sv-norr-ovre", "Övre Norrland"],
    ["sv-norr-mitt", "Mitt-Norrland"], ["sv-gotland", "Gotland"]];
  var BOTCMD = [["kom till Pitchers", "Kom till Pitchers"], ["kom till Lobbybaren", "Kom till Lobbybaren"], ["spela", "Spela (Hellre)"],
    ["spela vem", "Spela (Vem)"], ["skjuts", "Bot ber om skjuts"], ["kör inte", "Bot-Erik kör int'"], ["kör", "Bot-Erik kör"], ["vänner", "Visa vänkoder"], ["ute", "Alla ute"], ["hem", "Gå hem"],
    ["tyst", "Tyst"], ["prata", "Prata igen"], ["status", "Status"], ["stopp", "Stoppa bots"]];

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "on") Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function b(label, fn, cls) { return h("button", { type: "button", class: "tb-b" + (cls ? " " + cls : ""), on: { click: function (ev) { ev.preventDefault(); run(fn, label); } } }, [label]); }
  function run(fn, label) {
    try { var r = fn(); if (r && r.then) r.then(null, function (e) { say("✖ " + label + ": " + errText(e), true); }); }
    catch (e) { say("✖ " + label + ": " + errText(e), true); }
  }
  function errText(e) { return String((e && (e.message || e.code)) || e || "fel").slice(0, 120); }
  function say(t, bad) {
    var s = box && box.querySelector(".tb-say"); if (s) { s.textContent = t; s.className = "tb-say" + (bad ? " tb-bad" : ""); }
    if (A && A.toast) try { A.toast(t, { id: "pntest", err: !!bad }); } catch (e) {}
  }
  function sect(title, open, kids) {
    var d = h("details", { class: "tb-sec" }, [h("summary", { text: title })].concat(kids));
    if (open) d.open = true;
    return d;
  }
  function row(kids) { return h("div", { class: "tb-row" }, kids); }
  function reload(ms) { setTimeout(function () { location.reload(); }, ms || 500); }
  function gid() { return gang && gang.member ? gang.group_id : null; }
  function needGang() { if (!gid()) throw new Error("gå med i Testgänget först"); return gid(); }

  /* ---------- clock ---------- */
  function stockholmParts(ms) {
    var f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    var o = {}; f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; }); return o;
  }
  // real ms for a Stockholm wall time (y-m-d h:m)
  function fromStockholm(y, mo, d, hh, mm) {
    var guess = Date.UTC(y, mo - 1, d, hh, mm);
    for (var i = 0; i < 3; i++) {
      var p = stockholmParts(guess), asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      guess += Date.UTC(y, mo - 1, d, hh, mm) - asUtc;
    }
    return guess;
  }
  function target(kind) {   // presets, relative to the REAL date
    var now = PN.clock.real(), p = stockholmParts(now), y = +p.year, mo = +p.month, d = +p.day;
    var dayMs = 864e5;
    if (kind === "18") return fromStockholm(y, mo, d, 18, 0);
    if (kind === "21") return fromStockholm(y, mo, d, 21, 0);
    if (kind === "22") return fromStockholm(y, mo, d, 22, 0);
    if (kind === "0501") { var t = new Date(now + dayMs); var q = stockholmParts(t.getTime()); return fromStockholm(+q.year, +q.month, +q.day, 5, 1); }
    if (kind === "fri") {
      var dow = new Date(fromStockholm(y, mo, d, 12, 0)).getUTCDay(), add = (5 - dow + 7) % 7;
      var f = stockholmParts(now + add * dayMs); return fromStockholm(+f.year, +f.month, +f.day, 22, 0);
    }
    return now;
  }
  function setClock(ms) {
    var off = ms == null ? 0 : ms - PN.clock.real();
    if (Math.abs(off) < 60000) off = 0;
    var mins = Math.round(off / 60000);
    PN.clock.set(off);
    PN.expireSession();
    say("⏱️ Klockan ändras… laddar om");
    var p = PN.token() ? PN.rpc("zz_test_set", { p_offset_min: mins }) : Promise.resolve();
    return p.then(function () { reload(400); }, function () { reload(400); });
  }
  function clockText() {
    var off = PN.clock.off(), p = stockholmParts(Date.now());
    return (off ? "⏱️ Testtid " : "Riktig tid ") + p.weekday + " " + p.day + "/" + p.month + " " + p.hour + ":" + p.minute + (off ? " (" + (off > 0 ? "+" : "") + Math.round(off / 60000) + " min)" : "");
  }

  /* ---------- position ---------- */
  function setPos(g) {
    PN.geo.set(g);
    say(g ? "📍 Testplats: " + (g.name || (g.lat.toFixed(4) + ", " + g.lng.toFixed(4))) : "📍 Riktig GPS (laddar om)");
    if (!g) return reload(400);
    try { if (A && A.setLastLoc) A.setLastLoc(g.lat, g.lng); if (A && A.flyTo) A.flyTo(g.lat, g.lng, 15); } catch (e) {}
    paintStatus();
  }
  function pickOnMap() {
    if (!A || !A.map || !A.map.on) throw new Error("kartan ä int' redo");
    pickMode = true;
    say("👆 Tryck på kartan där du vill vara");
    var once = function (e) {
      if (!pickMode) return;
      pickMode = false;
      try { A.map.off && A.map.off("click", once); } catch (x) {}
      var ll = e.lngLat || e.latlng; if (!ll) return;
      setPos({ lat: ll.lat, lng: ll.lng, name: "vald på kartan" });
    };
    A.map.on("click", once);
    if (isPhone()) close();
  }

  /* ---------- flags ---------- */
  function loadFlags() {
    if (!PN.token()) return Promise.resolve();
    return Promise.all(["after_flags_get", "ride_flags_get", "bold_flags_get", "push_v2_flags_get", "account_config"].map(function (f) {
      return PN.rpc(f).then(function (r) { return r; }, function () { return null; });
    })).then(function (rs) {
      var all = {};
      rs.forEach(function (r, i) {
        if (!r) return;
        var o = i === 0 ? (r.flags || {}) : i === 4 ? { email_login: !!r.email } : r;
        Object.keys(o).forEach(function (k) { if (typeof o[k] === "boolean") all[k] = o[k]; });
      });
      flags = all; paintFlags();
    });
  }
  function setFlag(k, v) {
    var o = {}; o[k] = v;
    say("⚑ " + k + " = " + (v ? "på" : "av") + " (för hela testgänget) … laddar om");
    return PN.rpc("zz_test_set", { p_flags: o }).then(function () { reload(600); });
  }
  function paintFlags() {
    var w = box && box.querySelector(".tb-flags"); if (!w) return;
    w.innerHTML = "";
    FLAGS.forEach(function (f) {
      var cb = h("input", { type: "checkbox" });
      cb.checked = !!flags[f[0]];
      cb.addEventListener("change", function () { run(function () { return setFlag(f[0], cb.checked); }, f[0]); });
      w.appendChild(h("label", { class: "tb-flag" }, [cb, h("span", { text: f[1] }), h("code", { text: f[0] })]));
    });
  }

  /* ---------- jumps ---------- */
  function g() { return gang && gang.member ? { id: gang.group_id, name: gang.label } : null; }
  function nightEnd() {   // the end of tonight's night (05:00 Stockholm, real time) = after_report2 p_night for "tonight"
    var now = Date.now(), p = stockholmParts(now), t = fromStockholm(+p.year, +p.month, +p.day, 5, 0);
    if (t <= now) { var q = stockholmParts(now + 864e5); t = fromStockholm(+q.year, +q.month, +q.day, 5, 0); }
    return new Date(Math.min(t, PN.clock.real() + 864e5)).toISOString();
  }
  function need(name) { var m = window[name]; if (!m) throw new Error(name + " finns int' i den här versionen"); return m; }
  var JUMPS = [
    ["Grupper", function () { A.showGroups(); }],
    ["🎉 Spel (hubben)", function () { need("SPEL").open(g()); }],
    ["🥳 Party", function () { need("PARTY").open(g() ? { group: g() } : {}); }],
    ["💬 DM", function () { need("DM").open(); }],
    ["📥 Inkorg", function () { need("INBOX").open(); }],
    ["📋 Kvällsrapport (ikväll)", function () { return need("AFTER2").openFor(needGang(), nightEnd()); }],
    ["📋 Kvällsrapport (i går)", function () { return need("AFTER2").openFor(needGang()); }],
    ["🚗 Hämta mig", function () { need("RIDE").open(); }],
    ["🧑‍🎨 Avatar", function () { need("AVWIZ").open(); }],
    ["🌙 Nattlogg", function () { need("NIGHTLOG").open(); }],
    ["🗓️ Helg", function () { need("HELG").open(); }],
    ["🛂 Pass", function () { need("PASSPORT").open(); }],
    ["🪖 Gänget", function () { need("GANG").openGang(g()); }],
    ["📲 Installera-guide", function () { need("INSTALL1").show(); }],
    ["🔐 Spara konto", function () { need("ACCOUNT").openSave(); }]
  ];

  /* ---------- bots ---------- */
  function botSay(cmd) {
    var id = needGang();
    return PN.rpc("post_group_msg", { p_group_id: id, p_body: "bots: " + cmd }).then(function () { say("🤖 skickat: bots: " + cmd + " (bots svarar om de kör)"); });
  }
  function moment(kind) {
    var id = needGang();
    return PN.rpc("zz_test_moment", { p_group_id: id, p_kind: kind }).then(function (r) {
      say("🎲 Moment " + kind + " öppnat (#" + (r && r.id) + "). Kortet kommer vid nästa koll (eller ladda om).");
      if (!flags.moments) say("🎲 Moment öppnat, men flaggan moments ä AV. Slå på den under Flaggor.", true);
      try { A && A.refresh && A.refresh(); } catch (e) {}
    });
  }
  function waitToken(ms) {
    return new Promise(function (res, rej) {
      var t0 = Date.now(); (function tick() {
        if (PN.token()) return res(PN.token());
        if (Date.now() - t0 > (ms || 20000)) return rej(new Error("ingen inloggning (tryck ÖL! eller Grupper en gång)"));
        setTimeout(tick, 300);
      })();
    });
  }
  // the app is in "public mode" until the first action: make the account the app's own way, then join by code
  function account() {
    if (PN.token()) return Promise.resolve();
    if (!A || !A.ensureAccount) return Promise.reject(new Error("appen startar fortfarande"));
    return Promise.resolve(A.ensureAccount()).then(function () { return waitToken(20000); });
  }
  function joinGang() {
    var name = (A && A.getName && A.getName()) || PN.label();
    say("👥 Går med i Testgänget…");
    return account().then(function () { return PN.rpc("zz_test_group_get", { p_label: "Testgänget" }); }).then(function (gg) {
      if (!gg || !gg.code) throw new Error("ingen Testgänget-kod än (starta bots en gång)");
      return PN.rpc("join_group", { p_code: gg.code, p_display_name: name });
    }).then(function () {
      say("✅ Med i Testgänget");
      return refreshState().then(function () { loadFlags(); try { A && A.refresh && A.refresh(); } catch (e) {} });
    });
  }

  /* ---------- other ---------- */
  function resetFirstRun() {
    var keep = /^(olnu\.auth|olnu\.name|olnu\.uid|pnt\.)/;
    var rx = /intro|age18|inst|guide|seen|nudge|asked|tour|tip|hint|onb|welcome|first/i, n = 0;
    Object.keys(LS).forEach(function (k) { if (!keep.test(k) && rx.test(k)) { LS.removeItem(k); n++; } });
    say("🧹 " + n + " första-gången-nycklar borta… laddar om");
    reload(700);
  }
  function freshAccount() {
    var used = {}, real = PN.realLocalStorage;
    for (var i = 0; i < real.length; i++) { var m = /^pnt([1-9]):/.exec(real.key(i) || ""); if (m) used[m[1]] = 1; }
    var n = 1; while (used[n] && n < 9) n++;
    window.open(PN.slotUrl(n), "_blank");
    say("➕ Nytt konto öppnas i en ny flik (plats " + n + ")");
  }
  function wipe() {
    if (!confirm("Nollställ testkontot på plats " + PN.slot + "? (Bara testläget. Betan rörs int'.)")) return;
    PN.wipeSlot(); reload(200);
  }

  /* ---------- state ---------- */
  function refreshState() {
    if (!PN.token()) return Promise.resolve();
    return PN.rpc("zz_test_state").then(function (s) { PN.state = s; onState(s); }, function () {});
  }
  function onState(s) {
    if (!s) return;
    gang = (s.groups || []).filter(function (x) { return x.label === "Testgänget"; })[0] || null;
    paintStatus();
  }
  function paintStatus() {
    if (!box) return;
    var s = PN.state || {}, uid = PN.uid();
    var st = box.querySelector(".tb-status");
    if (st) st.textContent = PN.label() + " · plats " + PN.slot + " · " + (uid ? "id " + uid.slice(0, 8) : "ej inloggad") +
      (s.mates ? " · " + s.mates.length + " i gänget" : "");
    var gs = box.querySelector(".tb-gang");
    if (gs) gs.textContent = gang ? ("Kod: " + gang.code + (gang.member ? " · du ä med ✅" : " · du ä int' med")) :
      PN.token() ? "Ingen Testgänget än (starta bots en gång)" : "Tryck Gå med (appen gör ett testkonto först)";
    var ck = box.querySelector(".tb-clock"); if (ck) ck.textContent = clockText();
    var gp = box.querySelector(".tb-geo"), geo = PN.geo.get();
    if (gp) gp.textContent = geo && geo.on ? "📍 " + (geo.name || "") + " " + (+geo.lat).toFixed(4) + ", " + (+geo.lng).toFixed(4) : "📍 Riktig GPS";
    var ns = box.querySelector(".tb-nosig"); if (ns) ns.textContent = PN.nosig() ? "📶 Täckning tillbaka" : "📵 Ingen täckning (fejk)";
    if (fab) fab.classList.toggle("tb-warn", !!(PN.clock.off() || (geo && geo.on) || PN.nosig()));
  }
  function onApi() { refreshState(); loadFlags(); }

  /* ---------- UI ---------- */
  function isPhone() { return window.matchMedia("(max-width: 899px)").matches; }
  function open() { box.classList.add("tb-open"); document.documentElement.classList.add("tb-shown"); try { LS.setItem("pnt.tb", "1"); } catch (e) {} paintStatus(); }
  function close() { box.classList.remove("tb-open"); document.documentElement.classList.remove("tb-shown"); try { LS.setItem("pnt.tb", "0"); } catch (e) {} }
  function build() {
    var latlng = h("input", { type: "text", class: "tb-in", placeholder: "60.1500, 15.1868", inputmode: "decimal" });
    var dt = h("input", { type: "datetime-local", class: "tb-in" });
    var nameIn = h("input", { type: "text", class: "tb-in", value: PN.label(), maxlength: "24" });
    box = h("aside", { class: "tb", "aria-label": "Testpanel" }, [
      h("div", { class: "tb-head" }, [h("b", { text: "🧪 TESTLÄGE · staging" }), h("button", { type: "button", class: "tb-x", "aria-label": "Stäng", on: { click: close } }, ["✕"])]),
      h("div", { class: "tb-status" }), h("div", { class: "tb-say", text: "Allt här gäller bara testmiljön." }),
      sect("📱 Den här enheten", true, [
        row([nameIn, b("Spara namn", function () { PN.setLabel(nameIn.value); paintStatus(); say("✅ Enheten heter " + PN.label()); })]),
        row([b("➕ Nytt konto (ny flik)", freshAccount), b("🧹 Nollställ kontot", wipe, "tb-danger")])
      ]),
      sect("👥 Testgänget", true, [h("div", { class: "tb-gang tb-note" }), row([b("Gå med i Testgänget", joinGang), b("Uppdatera", refreshState)])]),
      sect("📍 Plats", false, [h("div", { class: "tb-geo tb-note" }),
        row(PLACES.map(function (p) { return b(p.name, function () { setPos(p); }); })),
        row([b("👆 Välj på kartan", pickOnMap)]),
        row([latlng, b("Sätt", function () {
          var m = /(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/.exec(latlng.value || "");
          if (!m) throw new Error("skriv lat, lng"); setPos({ lat: +m[1], lng: +m[2], name: "egen" });
        })]),
        row([b("Riktig GPS", function () { setPos(null); })])]),
      sect("⏱️ Tid", false, [h("div", { class: "tb-clock tb-note" }),
        row([b("Ikväll 18:00", function () { return setClock(target("18")); }), b("21:00 Halvtid", function () { return setClock(target("21")); }),
             b("22:00", function () { return setClock(target("22")); }), b("Fredag 22:00", function () { return setClock(target("fri")); }),
             b("05:01 morgonrapport", function () { return setClock(target("0501")); })]),
        row([dt, b("Sätt tid", function () {
          var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(dt.value || ""); if (!m) throw new Error("välj datum + tid");
          return setClock(fromStockholm(+m[1], +m[2], +m[3], +m[4], +m[5]));
        })]),
        row([b("Riktig tid", function () { return setClock(null); })]),
        h("div", { class: "tb-note", text: "Appens klocka + momentklockan på servern flyttas. Öl och incheckningar sparas ändå med riktig tid." })]),
      sect("⚑ Flaggor (testgänget)", false, [h("div", { class: "tb-flags" }), h("div", { class: "tb-note", text: "Gäller dig, dina andra testkonton och bots i samma gäng. Sidan laddar om." })]),
      sect("🧭 Hoppa till", false, [row(JUMPS.map(function (j) { return b(j[0], j[1]); }))]),
      sect("🎲 Moment nu", false, [row([["vad", "Kvällens vad"], ["halvtid", "Halvtid"], ["bord", "Uppdrag vid bordet"], ["agent", "Hemlig agent"]].map(function (m) {
        return b(m[1], function () { return moment(m[0]); });
      }))]),
      sect("🤖 Bots", false, [row(BOTCMD.map(function (c) { return b(c[1], function () { return botSay(c[0]); }); })),
        h("div", { class: "tb-note", text: "Knapparna skriver \"bots: …\" i Testgänget. Bots måste köra (GitHub → Actions → bots → Run workflow)." })]),
      sect("🗣️ Dialekt (förhandsvisning)", false, [row(REGIONS.map(function (r) {
        return b(r[1], function () { need("DIALEKT").preview(r[0]); say("🗣️ Dialekt: " + r[1]); try { A && A.render && A.render(); } catch (e) {} });
      }).concat([b("Auto (riktig)", function () { need("DIALEKT").preview(null); say("🗣️ Dialekt: auto"); })]))]),
      sect("🛠️ Övrigt", false, [row([h("button", { type: "button", class: "tb-b tb-nosig", on: { click: function () { PN.nosig(!PN.nosig()); paintStatus(); say(PN.nosig() ? "📵 Ingen täckning (fejk) — allt nät stoppas" : "📶 Täckning tillbaka"); } } }),
        b("🧹 Första gången igen", resetFirstRun), b("↻ Ladda om", function () { location.reload(); })])])
    ]);
    fab = h("button", { type: "button", class: "tb-fab", "aria-label": "Testpanel", on: { click: function () { if (box.classList.contains("tb-open")) close(); else open(); } } }, ["⚙"]);
    document.body.appendChild(box);
    document.body.appendChild(fab);
    var pref = null; try { pref = LS.getItem("pnt.tb"); } catch (e) {}
    if (pref === "1" || (pref == null && !isPhone())) open();
    paintFlags(); paintStatus();
    setInterval(function () { var ck = box.querySelector(".tb-clock"); if (ck) ck.textContent = clockText(); }, 30000);
  }

  PN.on(function (k, v) { if (k === "state") onState(v); if (k === "auth") setTimeout(function () { refreshState(); loadFlags(); }, 1500); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.PNTESTBAR = { open: open, close: close, refresh: refreshState };
})();
