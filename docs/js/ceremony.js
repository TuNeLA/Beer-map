/* Öl Nu v27 — MEDALJCEREMONIN (CONTRACT "v27 MORGONEN EFTER", migration 0050_ceremony.sql).
   The morning after a night (06:00–18:00 Europe/Stockholm) the group members who were out vote in 9 categories
   (Kvällens hjälte, Kvällens clown, Bästa citat, Ankaret, Dansgolvets general, Kvällens filosof, Kebabgeneralen,
   Stilikonen, Comebacken). One vote per category, never yourself. Results when everyone has voted, or at 18:00.
   Winners get a ceremony card and a group medal (user_medals "cer_<cat>", stacks ×N) shown in the uniform.
   Entry points: one "🎖️ Ceremoni" tile on the group page (groupItem), ONE HUD chip "🎖️ Rösta!" while voting is
   open and you have not voted everything. No new map buttons. In-app only (no push).
   Hooks (app.js mods): init, onAuthed, onPoll, groupItem, hudChipsHTML, hudClick, applyText.
   A missing RPC (old database) = everything hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = false, poll = null, pollAt = 0, busy = false, view = null;
  var SEEN_KEY = "olnu.cerSeen";

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function spick(seed, a) { return a && a.length ? a[hash(seed) % a.length] : ""; }

  /* ---------- Categories (ids = SQL olnu_cer_cats(); keep the order) ---------- */
  // [id, emoji, sv name, en name, sv blurb, en blurb, medal line]
  var CATS = [
    ["hjalte", "🦸", "Kvällens hjälte", "Hero of the night", "Räddade kvällen – eller åtminstone stämningen.", "Saved the night – or at least the mood.",
      "Truppen röstade fram dig som kvällens hjälte. Mantel ingår int'."],
    ["clown", "🤡", "Kvällens clown", "Clown of the night", "Fick hela bordet att gapskratta.", "Had the whole table in tears.",
      "Kvällens clown! Skratten ekar fortfarande i Dalarna."],
    ["citat", "💬", "Bästa citat", "Best quote", "Sa dä som alla citerar i dag.", "Said the line everyone quotes today.",
      "Bästa citatet. Det kommer tryckas på t-shirts."],
    ["ankaret", "⚓", "Ankaret", "The Anchor", "Fick hem alla. Ett riktigt ankare.", "Got everyone home. A true anchor.",
      "Ankaret! Du fick hem truppen. Generalstaben bugar."],
    ["dansgolv", "🕺", "Dansgolvets general", "General of the dance floor", "Ledde anfallet på dansgolvet.", "Led the charge on the dance floor.",
      "Dansgolvets general. Fötterna har fått medalj, resten av dig oxå."],
    ["filosof", "🧠", "Kvällens filosof", "Philosopher of the night", "Djupaste snacket klockan ett.", "Deepest talk at 1 a.m.",
      "Kvällens filosof. Ingen förstod, alla nickade."],
    ["kebab", "🌯", "Kebabgeneralen", "Kebab general", "Hittade käket när magen skrek.", "Found the food when bellies screamed.",
      "Kebabgeneralen! Truppen marscherar på magen – och du ledde den."],
    ["stil", "😎", "Stilikonen", "Style icon", "Snyggast i strid, hela kvällen.", "Sharpest in battle, all night.",
      "Stilikonen. Uniformen satt som en smäck."],
    ["comeback", "🔄", "Comebacken", "The comeback", "Var nere för räkning – reste sig igen.", "Was down for the count – got up again.",
      "Comebacken! Nere för räkning, uppe igen. Dalregementet ä stolt."]
  ];
  var BY = {}; CATS.forEach(function (c, i) { BY[c[0]] = { id: c[0], e: c[1], name: L(c[2], c[3]), sv: c[2], en: c[3], blurb: c[4], blurbEn: c[5], line: c[6], i: i }; });
  function cat(id) { var c = BY[id]; if (!c) return { id: id, e: "🎖️", name: id, blurb: "" }; return { id: c.id, e: c.e, name: L(c.sv, c.en), blurb: L(c.blurb, c.blurbEn), line: c.line }; }

  var T = {
    open: ["🎖️ Medaljceremonin ä öppen! Rösta fram gårdagens hjältar i {grupp}.", "🎖️ Uppställning! Ceremonin för {grupp} har börjat.",
      "🎖️ Givakt! Dags att dela ut gårdagens medaljer i {grupp}.", "🎖️ Ceremonin väntar. Vem va kvällens clown i {grupp}?",
      "🎖️ Morgonens viktigaste uppdrag: rösta i ceremonin för {grupp}.", "🎖️ Medaljerna ä putsade. Rösta i {grupp} före kl 18."],
    won: ["🏅 Du vann {cat} i {grupp}! Medaljen sitter på uniformen.", "🏅 Truppen har talat: du ä {cat} i {grupp}!",
      "🏅 {cat}! {grupp} röstade fram dig. Bocka och tacka.", "🏅 Ny ceremonimedalj: {cat} ({grupp}). Ära åt dig!"],
    done: ["🎖️ Ceremonin i {grupp} ä klar. Se vem som vann!", "🎖️ Resultaten från {grupp} ä här. Trumvirvel…",
      "🎖️ Medaljerna ä utdelade i {grupp}. Kolla in vinnarna."],
    voted: ["✅ Rösten ä lagd.", "✅ Noterat, soldat.", "✅ Rösten ä i lådan.", "✅ Ordern ä mottagen.", "✅ Klart. Nästa kategori!"],
    allMine: ["🎖️ Du har röstat i alla kategorier. Tack, soldat!", "🎖️ Alla röster lagda! Nu väntar vi på resten av truppen.",
      "🎖️ Fullt röstat. Generalstaben tackar."],
    allIn: ["Alla har röstat – medaljerna delas ut!", "Hela truppen har röstat. Trumvirvel!"],
    nobody: ["Ingen fick några röster. Truppen sov nog fortfarande.", "Tomt i röstlådan. Medaljerna ligger kvar i lådan till nästa gång."]
  };
  var ERR = {
    not_member: ["Du ä int' med i gruppen.", "You are not in this group."],
    not_open: ["Ceremonin ä int' öppen just nu (06–18 dagen efter).", "The ceremony is not open now (06–18 the day after)."],
    ceremony_done: ["Ceremonin ä redan klar.", "The ceremony is already over."],
    not_out: ["Bara de som var ute igår får rösta.", "Only those who were out last night can vote."],
    self_vote: ["Snyggt försök – men du kan int' rösta på dig själv.", "Nice try – you cannot vote for yourself."],
    invalid_member: ["Den personen ä int' med i ceremonin.", "That person is not in the ceremony."],
    invalid_cat: ["Okänd kategori.", "Unknown category."],
    slow_down: ["Lugn nu, du har ändrat dig många gånger.", "Easy, you changed your mind a lot."],
    error: ["Det gick int'. Försök igen.", "That did not work. Try again."]
  };
  function errText(e) { var c = U.errCode(e); var x = ERR[c] || ERR.error; return L(x[0], x[1]); }

  /* ---------- Server ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off = true; r.off = true; try { A.updateCounts(); } catch (e) {} }
      return r;
    });
  }
  function load(force) {
    if (!A || !A.LIVE || off || busy || !A.authed()) return Promise.resolve(poll);
    var gap = view ? 20000 : 90000;
    if (!force && Date.now() - pollAt < gap) return Promise.resolve(poll);
    busy = true; pollAt = Date.now();
    return call("ceremony_poll").then(function (r) {
      busy = false;
      if (r.error) return poll;
      var prev = poll; poll = A.parseData(r.data);
      notes(prev);
      try { A.updateCounts(); } catch (e) {}
      return poll;
    });
  }
  function groupOf(gid) { return poll && (poll.groups || []).filter(function (x) { return x.group_id === gid; })[0]; }
  function needsVote(g) { return g && g.phase === "open" && g.eligible && !g.my_done; }

  /* ---------- Toasts (once per group and night) ---------- */
  function seen(key) {
    var s = U.ls.getJSON(SEEN_KEY, {}) || {}, n = poll ? String(poll.night || "") : "";
    if (s._n !== n) s = { _n: n };
    if (s[key]) return true;
    s[key] = 1; U.ls.setJSON(SEEN_KEY, s); return false;
  }
  function notes() {
    if (!poll) return;
    var shown = 0;
    (poll.groups || []).forEach(function (g) {
      if (shown >= 1) return;
      var gn = g.group_name || L("gruppen", "the group");
      if (needsVote(g) && !seen("open:" + g.group_id)) {
        shown++;
        A.toast(fill(pick(T.open), { grupp: gn }), { action: { label: L("🎖️ Rösta", "🎖️ Vote"), fn: function () { openSheet(g.group_id, gn); } }, ms: 9000 });
      } else if (g.phase === "done" && g.eligible && !seen("done:" + g.group_id)) {
        shown++;
        var w = (g.my_wins || [])[0];
        A.toast(w ? fill(pick(T.won), { cat: cat(w).e + " " + cat(w).name, grupp: gn }) : fill(pick(T.done), { grupp: gn }),
          { action: { label: L("🎖️ Visa", "🎖️ Show"), fn: function () { openSheet(g.group_id, gn); } }, ms: 9000, cls: w ? "skal" : "" });
        if (w) { try { window.FX.vibrate([30, 60, 30]); } catch (e) {} try { if (window.MEDALS) setTimeout(function () { window.MEDALS.award(null, true); }, 1500); } catch (e) {} }
      }
    });
  }

  /* ---------- Times ---------- */
  function hm(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    try { return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }); } catch (e) { return d.toTimeString().slice(0, 5); }
  }
  function dayLabel(ev) {
    var d = new Date(String(ev || "").slice(0, 10) + "T12:00:00"); if (isNaN(d)) return "";
    var wd = sv() ? ["sön", "mån", "tis", "ons", "tors", "fre", "lör"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return wd[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
  }

  /* ---------- Group page tile ---------- */
  function tileSub(g) {
    if (!g) return "";
    if (g.phase === "open") return g.eligible ? (g.my_done ? L("✓ röstat · ", "✓ voted · ") + g.done_n + "/" + g.voters_n : L("Rösta! ", "Vote! ") + (g.my_n | 0) + "/" + CATS.length)
      : L("pågår · ", "voting · ") + g.done_n + "/" + g.voters_n;
    if (g.phase === "done") return (g.my_wins && g.my_wins.length ? "🏅 " + g.my_wins.map(function (c) { return cat(c).e; }).join("") + " · " : "") + L("resultat", "results");
    if (g.phase === "before") return L("öppnar 06:00", "opens 06:00");
    return L("efter nästa kväll ute", "after the next night out");
  }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || off || !g || !g.id) return;
    var pg = groupOf(g.id);
    var b = A.el("button", { type: "button", class: "btn btn-small btn-block cer-gbtn" + (needsVote(pg) ? " cer-hot" : "") }, [
      A.el("span", { class: "cer-gl", text: L("🎖️ Ceremoni", "🎖️ Ceremony") }),
      A.el("span", { class: "cer-gs", text: tileSub(pg) })
    ]);
    b.addEventListener("click", function () { openSheet(g.id, g.name); });
    wrap.appendChild(A.el("div", { class: "cer-gi" }, [b]));
    if (!poll) load(true);
  }

  /* ---------- HUD chip (ONE, only while voting is open and I still have votes left) ---------- */
  function chipTarget() { return poll ? (poll.groups || []).filter(needsVote)[0] : null; }
  function chipHTML() {
    var g = chipTarget(); if (!g) return "";
    return '<button type="button" class="hx-chip cer-chip" data-hx="cer" aria-label="' + esc(L("Medaljceremonin: rösta", "Medal ceremony: vote")) + '">' +
      esc(L("🎖️ Rösta!", "🎖️ Vote!")) + "</button>";
  }

  /* ---------- Sheet ---------- */
  function openSheet(gid, gname) {
    view = { gid: gid, name: gname, d: null, t: null };
    A.openSheet(L("🎖️ Medaljceremonin", "🎖️ Medal ceremony"), function (body) {
      var root = A.el("div", { id: "cer-root", class: "cer" }, [A.el("p", { class: "muted", text: "…" })]);
      body.appendChild(root);
    }, { onClose: function () { stop(); } });
    refresh();
    stop(); view.t = setInterval(function () { if (!alive()) { stop(); return; } if (!document.hidden) refresh(); }, 15000);
  }
  function stop() { if (view && view.t) { clearInterval(view.t); view.t = null; } }
  function alive() { return !!(view && document.getElementById("cer-root")); }
  function refresh() {
    if (!view) return;
    var gid = view.gid;
    call("ceremony_group", { p_group_id: gid }).then(function (r) {
      if (!alive() || view.gid !== gid) return;
      if (r.error) { render(null, errText(r.error)); return; }
      view.d = A.parseData(r.data); render(view.d);
    });
  }
  function render(d, err) {
    var root = document.getElementById("cer-root"); if (!root) return;
    var el = A.el;
    root.innerHTML = "";
    if (!d) { root.appendChild(el("p", { class: "muted", text: err || L("Det gick int'.", "Failed.") })); return; }
    var gn = d.group_name || view.name || "";
    root.appendChild(el("div", { class: "cer-head" }, [
      el("div", { class: "cer-kick", text: L("Gårdagens kväll · ", "Last night · ") + dayLabel(d.evening) }),
      el("div", { class: "cer-gname", text: gn }),
      el("div", { class: "cer-phase", text: phaseLine(d) })
    ]));
    if (d.phase === "done") { renderResults(root, d); return; }
    if (d.phase === "none") {
      root.appendChild(el("p", { class: "cer-note", text: L("Minst två ur gruppen måste ha varit ute igår för en ceremoni. Ses efter nästa kväll ute!",
        "At least two members must have been out last night. See you after the next night out!") }));
      return;
    }
    if (d.phase === "before") {
      root.appendChild(el("p", { class: "cer-note", text: L("Ceremonin öppnar kl 06:00. Sov på saken, soldat.", "The ceremony opens at 06:00. Sleep on it, soldier.") }));
      return;
    }
    // open
    var others = (d.members || []).filter(function (m) { return !m.is_me; });
    if (!d.eligible) {
      root.appendChild(el("p", { class: "cer-note", text: L("Du va int' ute igår, så du får titta på när truppen röstar. Nästa gång!",
        "You were not out last night, so you can watch the squad vote. Next time!") }));
    } else {
      root.appendChild(el("div", { class: "cer-prog", role: "status" }, [
        el("b", { text: (d.my_n | 0) + "/" + CATS.length }), " ", L("kategorier röstade", "categories voted")
      ]));
    }
    var list = el("div", { class: "cer-cats" });
    (d.cats || CATS.map(function (c) { return c[0]; })).forEach(function (id) {
      var c = cat(id), mine = (d.my_votes || {})[id];
      var card = el("div", { class: "cer-cat" + (mine ? " cer-voted" : "") }, [
        el("div", { class: "cer-ct" }, [el("span", { class: "cer-ce", "aria-hidden": "true", text: c.e }),
          el("span", {}, [el("b", { text: c.name }), el("small", { text: c.blurb })])])
      ]);
      if (d.eligible) {
        var chips = el("div", { class: "cer-chips", role: "group", "aria-label": c.name });
        others.forEach(function (m) {
          var on = mine === m.k;
          var b = el("button", { type: "button", class: "chip-btn cer-pick" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", text: m.name || L("Någon", "Someone") });
          b.addEventListener("click", function () { vote(id, m.k, b); });
          chips.appendChild(b);
        });
        card.appendChild(chips);
      }
      list.appendChild(card);
    });
    root.appendChild(list);
    var names = d.done_names || [];
    root.appendChild(el("p", { class: "cer-who muted", text: (d.done_n | 0) + "/" + (d.voters_n | 0) + L(" har röstat klart", " finished voting") + (names.length ? ": " + names.join(", ") : "") }));
    root.appendChild(el("p", { class: "cer-fine muted", text: L("En röst per kategori. Du kan ändra dig tills resultatet kommer (när alla röstat, senast 18:00).",
      "One vote per category. You can change your mind until the results (when all have voted, at the latest 18:00).") }));
  }
  function phaseLine(d) {
    if (d.phase === "open") return L("Röstningen stänger ", "Voting closes ") + hm(d.closes_at) + " · " + (d.voters_n | 0) + L(" var ute", " were out");
    if (d.phase === "done") return d.how === "all" ? spick(d.night + "all", T.allIn) : L("Röstningen stängde ", "Voting closed ") + hm(d.closes_at);
    if (d.phase === "before") return L("Öppnar ", "Opens ") + hm(d.opens_at);
    return L("Ingen ceremoni i dag", "No ceremony today");
  }
  var voting = false;
  function vote(id, k, b) {
    if (voting || !view) return;
    voting = true; b.disabled = true;
    var prevN = view.d ? view.d.my_n | 0 : 0;
    call("ceremony_vote", { p_group_id: view.gid, p_cat: id, p_k: k }).then(function (r) {
      voting = false; b.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); refresh(); return; }
      var d = A.parseData(r.data);
      try { window.FX.vibrate(15); } catch (e) {}
      if (d.phase === "done") A.toast(pick(T.allIn), { cls: "skal" });
      else if (d.my_done && prevN < CATS.length) A.toast(pick(T.allMine), { cls: "skal" });
      else A.toast(pick(T.voted), { ms: 1600 });
      if (alive()) { view.d = d; render(d); }
      load(true);
    });
  }
  function renderResults(root, d) {
    var el = A.el, res = d.results || [], mine = res.filter(function (r) { return (r.winners || []).some(function (w) { return w.is_me; }); });
    if (mine.length) {
      var card = el("div", { class: "cer-card", role: "group", "aria-label": L("Ditt ceremonikort", "Your ceremony card") }, [
        el("div", { class: "cer-card-k", text: L("CEREMONIKORT", "CEREMONY CARD") }),
        el("div", { class: "cer-card-m", "aria-hidden": "true", text: mine.map(function (r) { return cat(r.cat).e; }).join(" ") }),
        el("div", { class: "cer-card-t", text: L("Du belönas med ", "You are awarded ") + mine.map(function (r) { return cat(r.cat).name; }).join(", ") }),
        el("div", { class: "cer-card-l", text: sv() ? (BY[mine[0].cat] || {}).line || "" : L("", "Your squad voted for you. The medal is on your uniform.") }),
        el("div", { class: "cer-card-f", text: (d.group_name || "") + " · " + dayLabel(d.evening) })
      ]);
      root.appendChild(card);
      if (window.MEDALS && window.MEDALS.showMine) root.appendChild(el("div", { class: "row", style: "margin:8px 0 4px" }, [
        A.btn(L("🎖️ Se uniformen", "🎖️ See the uniform"), "btn-small", function () { window.MEDALS.showMine(); })]));
    }
    if (!res.length) { root.appendChild(el("p", { class: "cer-note", text: spick(d.night, T.nobody) })); return; }
    var list = el("div", { class: "cer-cats cer-res" });
    res.forEach(function (r) {
      var c = cat(r.cat), ws = r.winners || [];
      list.appendChild(el("div", { class: "cer-cat cer-win" + (ws.some(function (w) { return w.is_me; }) ? " cer-me" : "") }, [
        el("div", { class: "cer-ct" }, [el("span", { class: "cer-ce", "aria-hidden": "true", text: c.e }),
          el("span", {}, [el("b", { text: c.name }), el("small", { text: ws.map(function (w) { return w.is_me ? L("Du", "You") : (w.name || L("Någon", "Someone")); }).join(" & ") +
            " · " + (r.votes | 0) + L(r.votes === 1 ? " röst" : " röster", r.votes === 1 ? " vote" : " votes") })])])
      ]));
    });
    root.appendChild(list);
  }

  /* ---------- Medal catalog entries (uniform) ---------- */
  function addMedals() {
    var M = window.MEDALS; if (!M || !M.CAT || M.CAT.__cer) return;
    CATS.forEach(function (c) {
      M.CAT.push(["cer_" + c[0], c[1], c[2], c[6], "Vinn " + c[2] + " på medaljceremonin morgonen efter.", 1]);
    });
    M.CAT.__cer = 1;
  }

  window.CEREMONY = {
    CATS: CATS, cat: cat, data: function () { return poll; }, open: openSheet, refresh: function () { return load(true); },
    init: function (api) {
      A = api; addMedals();
      document.addEventListener("visibilitychange", function () { if (!document.hidden) load(false); });
    },
    onAuthed: function () { addMedals(); load(true); },
    onPoll: function () { load(false); },
    applyText: function () { BY = {}; CATS.forEach(function (c, i) { BY[c[0]] = { id: c[0], e: c[1], sv: c[2], en: c[3], blurb: c[4], blurbEn: c[5], line: c[6], i: i }; }); },
    groupItem: function (g, wrap) { groupItem(g, wrap); },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (action) { if (action !== "cer") return; var g = chipTarget(); if (g) openSheet(g.group_id, g.group_name); }
  };
})();
