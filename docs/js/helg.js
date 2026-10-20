/* Öl Nu v27 — HELGSTREAK (CONTRACT "v27 MORGONEN EFTER", migration 0051_helg_streak.sql).
   Personal weekly streak: a week counts when you were out at least one night Friday–Sunday (a drink or a
   check-in both count). 2 freeze passes (🧊) per person; a missed week uses one automatically; one comes back
   every 4 weeks. Group streak: a group week counts when 3+ members were out that weekend.
   Shown in the 🏆 sheet (topSheet) and as one line on the group page (groupItem). Deep link ?helg=1 (push).
   Friday 17:00+ (Europe/Stockholm): the app calls notify-group {event:"helg_remind"} once per week; the server
   pushes a gentle reminder to group-mates whose streak would break (max 1 per person per week). The caller
   gets an in-app toast instead when the own streak is at risk.
   Hooks (app.js mods): init, onAuthed, onPoll, topSheet, groupItem. Missing RPC = feature hidden. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = false, st = null, at = 0, busy = false, linkDone = false;
  var CALL_KEY = "olnu.helgCall", TOAST_KEY = "olnu.helgToast";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function veckor(n) { return sv() ? (n === 1 ? "vecka" : "veckor") : (n === 1 ? "week" : "weeks"); }

  var T = {
    risk: ["🔥 Din helgstreak på {n} {v} hänger på en tråd. En incheckning fre–sön räcker!",
      "🧊 Inga frysbiljetter kvar. En kväll ute i helgen så lever streaken ({n} {v}).",
      "🫡 Streaken ({n} {v}) står i givakt och väntar på helgen. Ingen press – en incheckning räcker."],
    freeze: ["🧊 Ingen fara: missar du helgen tar en frysbiljett smällen.", "🧊 Du har frysbiljetter. Streaken klarar en vilohelg."],
    done: ["✅ Helgen ä räddad! Streaken lever: {n} {v}.", "✅ Veckan ä bokad i streaken. {n} {v} i rad!", "✅ Snyggt, soldat. {n} {v} i rad."],
    zero: ["Ingen streak än. En kväll ute fre–sön startar den.", "Streaken börjar nästa helg. En incheckning räcker."],
    groupDone: ["✅ {n} ute – gruppveckan räknas!", "✅ Truppen har ställt upp: {n} ute."],
    groupNeed: ["{n}/3 ute denna helg", "{n} av 3 ute i helgen"]
  };

  function call(name, params) {
    if (!A || !A.LIVE || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off = true; r.off = true; } return r; });
  }
  function load(force) {
    if (!A || !A.LIVE || off || busy || !A.authed()) return Promise.resolve(st);
    if (!force && Date.now() - at < 10 * 60000) return Promise.resolve(st);
    busy = true; at = Date.now();
    return call("helg_state").then(function (r) {
      busy = false;
      if (!r.error) { st = A.parseData(r.data); after(); }
      return st;
    });
  }
  // Stockholm clock (weekday 1–7, hour) for the Friday reminder.
  function sthlm() {
    try {
      var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      var wd = "", h = 0; p.forEach(function (x) { if (x.type === "weekday") wd = x.value; if (x.type === "hour") h = +x.value; });
      return { wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1, h: h };
    } catch (e) { var d = new Date(); return { wd: d.getDay() || 7, h: d.getHours() }; }
  }
  function after() {
    if (!st || !st.me) return;
    var me = st.me, wk = String(st.week || ""), s = sthlm();
    var fri = st.friday_evening || (s.wd === 5 && s.h >= 17);
    if (fri && U.ls.get(CALL_KEY, "") !== wk) {
      U.ls.set(CALL_KEY, wk);
      try { if (A.PUSH_ON) A.invoke("notify-group", { event: "helg_remind" }); } catch (e) {}
    }
    var weekend = s.wd >= 5 || (s.wd === 1 && s.h < 5);
    if (weekend && me.at_risk && !me.done && U.ls.get(TOAST_KEY, "") !== wk && (s.wd > 5 || s.h >= 17)) {
      U.ls.set(TOAST_KEY, wk);
      setTimeout(function () { A.toast(fill(pick(T.risk), { n: me.streak, v: veckor(me.streak) }), { ms: 7000, action: { label: L("🔥 Visa", "🔥 Show"), fn: openSheet } }); }, 4000);
    }
  }

  /* ---------- Drawing ---------- */
  function weekDots(weeks, kind) {
    var list = (weeks || []).slice(-8);
    while (list.length < 8) list.unshift({ s: "none" });
    return '<div class="hs-dots" role="img" aria-label="' + esc(L("Senaste 8 veckorna", "Last 8 weeks")) + '">' + list.map(function (w) {
      var s = kind === "group" ? (w.now ? (w.n >= 3 ? "now_out" : "now") : (w.n >= 3 ? "out" : (w.n == null ? "none" : "miss"))) : w.s;
      var tip = s === "out" || s === "now_out" ? L("ute", "out") : s === "frozen" ? L("frysbiljett", "freeze") : s === "now" ? L("denna helg", "this weekend") : "";
      return '<span class="hs-dot hs-' + esc(s) + '" title="' + esc(tip) + '">' + (s === "frozen" ? "🧊" : "") + "</span>";
    }).join("") + "</div>";
  }
  function passes(n) {
    var h = ""; for (var i = 0; i < 2; i++) h += '<span class="hs-pass' + (i < n ? "" : " used") + '" aria-hidden="true">🧊</span>';
    return h;
  }
  function meHTML(me) {
    var n = me.streak | 0, line;
    if (me.done) line = fill(pick(T.done), { n: n, v: veckor(n) });
    else if (!n) line = pick(T.zero);
    else if (me.at_risk) line = fill(pick(T.risk), { n: n, v: veckor(n) });
    else line = pick(T.freeze);
    return '<div class="hs-me' + (me.at_risk ? " hs-risk" : "") + (me.done ? " hs-ok" : "") + '">' +
      '<div class="hs-big"><b>' + n + '</b><span>' + esc(veckor(n)) + "<br>" + esc(L("i rad", "in a row")) + "</span></div>" +
      '<div class="hs-side">' + weekDots(me.weeks, "me") +
      '<div class="hs-passes">' + passes(me.freezes | 0) + ' <small>' + esc(L("frysbiljetter", "freeze passes")) + " " + (me.freezes | 0) + "/2" +
      (me.next_freeze_in ? " · " + esc(L("ny om " + me.next_freeze_in + " v", "next in " + me.next_freeze_in + " wk")) : "") + "</small></div>" +
      '<div class="hs-best muted">' + esc(L("Bästa: ", "Best: ") + (me.best | 0) + " " + veckor(me.best | 0)) + "</div></div></div>" +
      '<p class="hs-line">' + esc(line) + "</p>";
  }
  function groupRowHTML(g) {
    var n = g.this_week | 0;
    return '<li class="hs-grow"><div class="hs-gn"><b>' + esc(g.name || "") + "</b><small>" +
      esc(g.done ? fill(T.groupDone[0], { n: n }) : fill(T.groupNeed[0], { n: n })) + "</small></div>" +
      weekDots(g.weeks, "group") + '<div class="hs-gs"><b>' + (g.streak | 0) + "</b><small>" + esc(L("v", "wk")) + "</small></div></li>";
  }
  function renderInto(box) {
    box.innerHTML = "";
    if (!st || !st.me) { box.appendChild(A.el("p", { class: "muted", text: "…" })); return; }
    var h = meHTML(st.me);
    var gs = (st.groups || []).filter(function (g) { return (g.members | 0) >= 2; });
    if (gs.length) h += '<h4 class="hs-h4">' + esc(L("👥 Gruppstreak (3+ ute en helg)", "👥 Group streak (3+ out on a weekend)")) + '</h4><ul class="hs-groups">' + gs.map(groupRowHTML).join("") + "</ul>";
    h += '<details class="hs-how"><summary>' + esc(L("Så funkar det", "How it works")) + "</summary><p>" +
      esc(L("En vecka räknas när du varit ute minst en kväll fredag–söndag – en öl eller en incheckning räcker. Missar du en helg tar en frysbiljett smällen (du har 2, och får tillbaka en var fjärde vecka). Gruppen får en vecka när minst 3 ur gruppen varit ute samma helg. Vila ä oxå bra – streaken ä bara på skoj.",
        "A week counts when you were out at least one night Friday–Sunday – one beer or a check-in is enough. Miss a weekend and a freeze pass takes the hit (you have 2 and get one back every 4 weeks). The group gets a week when 3+ members were out the same weekend. Rest is fine too – it is just for fun.")) + "</p></details>";
    box.innerHTML = h;
  }
  function openSheet() {
    A.openSheet(L("🔥 Helgstreak", "🔥 Weekend streak"), function (body) {
      var box = A.el("div", { class: "hs", id: "hs-root" }); body.appendChild(box); renderInto(box);
      load(true).then(function () { var b = document.getElementById("hs-root"); if (b) renderInto(b); });
    });
  }

  /* ---------- Hooks ---------- */
  function topSheet(body) {
    if (!A || !A.LIVE || off) return;
    var sec = A.el("section", { class: "hs-top" }, [A.el("h3", { text: L("🔥 Helgstreak", "🔥 Weekend streak") })]);
    var box = A.el("div", { class: "hs" }); sec.appendChild(box); renderInto(box);
    body.appendChild(sec);
    load(true).then(function () { if (off) { sec.remove(); return; } if (box.isConnected) renderInto(box); });
  }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || off || !g || !g.id) return;
    var gs = st && (st.groups || []).filter(function (x) { return x.id === g.id; })[0];
    if (!gs) { if (!st) load(true); return; }
    var me = st.me || {};
    var line = A.el("button", { type: "button", class: "hs-gline", "aria-label": L("Helgstreak", "Weekend streak") }, [
      A.el("span", { text: "🔥 " + L("Helgstreak ", "Streak ") }),
      A.el("b", { text: (gs.streak | 0) + " " + L("v", "wk") }),
      A.el("span", { class: "muted", text: " · " + (gs.done ? fill(T.groupDone[0], { n: gs.this_week | 0 }) : fill(T.groupNeed[0], { n: gs.this_week | 0 })) +
        " · " + L("du: ", "you: ") + (me.streak | 0) + " " + L("v", "wk") })
    ]);
    line.addEventListener("click", openSheet);
    wrap.appendChild(line);
  }
  function linkFromUrl() {
    if (linkDone) return false;
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return false; }
    if (q.get("helg") !== "1") return false;
    linkDone = true;
    try { q.delete("helg"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); } catch (e) {}
    return true;
  }

  window.HELG = {
    data: function () { return st; }, open: openSheet, refresh: function () { return load(true); },
    init: function (api) { A = api; },
    onAuthed: function () { load(true).then(function () { if (linkFromUrl() && !off) setTimeout(openSheet, 1200); }); },
    onPoll: function () { load(false); },
    topSheet: topSheet,
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
