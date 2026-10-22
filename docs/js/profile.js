/* Öl Nu — 👤 PROFIL (owner 2026-10-22: "put Ölpass and more of the things in settings into a Profile tab that shows
   everything for your profile"). The ⚙️ sheet has two tabs: "👤 Profil | ⚙️ Inställningar" (app.js showSettings).
   This file draws only the hero card at the top of Profil (hook profileHead): initial, name, hemstad (demonym),
   rank + progress to the next rank, a stat grid (drinks, nights this year, bars in the passport, weekend streak,
   medals, friends), the regular bar this year, the medal ribbon and my groups. Every number comes from data other
   modules already hold (SOCIAL.stats, MERITER.cur, PASSPORT.data, HELG.data, MEDALS.mine, HOMETOWN.mine) plus three
   reads on open, cached 60 s: my_wrapped('year', 0), my_groups, my_friends. No new RPC, no migration, no button on
   the map. The rows below the hero are the modules' own "profileSheet" hooks (moved from "settingsSheet", not
   copied): Ölpasset, Vänner & Hitta (+ Låt mig hittas), Konto, Swish, Spökläge, Topplistan, Wrapped, SOS.
   A missing module or RPC hides its tile. Styles: profile.css. Public: window.PROFIL. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, cache = { at: 0, year: null, groups: null, friends: null }, offY = false, offF = false, lastLine = -1;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  function W(n) { return window[n] || null; }
  function safe(fn, d) { try { var v = fn(); return v === undefined ? d : v; } catch (e) { return d; } }

  // Dalmål one-liners under the name (no two opens in a row the same).
  var LINES_SV = [
    "Agent i tjänst sen första kapsylen.",
    "Dä ä du, dä. Kartans stoltaste prick.",
    "Hemlig agent. Öppen plånbok. Ibland.",
    "Uppdraget: en till. Sen hem. Kanske.",
    "Rapporterar från fronten, ä allt lugnt?",
    "Bärs i blodet, Dalarna i hjärtat.",
    "Specialstyrka: hittar baren i mörker.",
    "Kodnamn hemligt. Törsten ä int' dä.",
    "Lagom ä bäst. Fast int' ikväll.",
    "Fältuniformen sitter. Glaset med."
  ];
  var LINES_EN = ["Agent on duty since the first bottle cap.", "That's you. The proudest dot on the map.", "Secret agent. Open wallet. Sometimes.",
    "Mission: one more. Then home. Maybe.", "Special skill: finds the bar in the dark."];
  function line() {
    var a = sv() ? LINES_SV : LINES_EN, i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastLine) i = (i + 1) % a.length;
    lastLine = i;
    return a[i];
  }

  function call(fn, p) {
    return A.rpc(fn, p).then(function (r) {
      var e = r && r.error, code = e && (e.code || ""), msg = e && (e.message || "");
      return { data: r ? r.data : null, error: e, off: !!e && (code === "PGRST202" || /Could not find the function|does not exist/i.test(msg)) };
    });
  }
  function load(force) {
    if (!A || !A.LIVE || !A.authed || !A.authed()) return Promise.resolve();
    if (!force && Date.now() - cache.at < 60000) return Promise.resolve();
    cache.at = Date.now();
    var name = A.getName ? A.getName() : "";
    return Promise.all([
      offY ? null : call("my_wrapped", { p_kind: "year", p_offset: 0 }).then(function (r) { if (r.off) offY = true; if (!r.error) cache.year = A.parseData(r.data); }),
      call("my_groups").then(function (r) { if (!r.error && Array.isArray(r.data)) cache.groups = r.data; }),
      offF ? null : call("my_friends", { p_name: name }).then(function (r) { if (r.off) offF = true; if (!r.error) cache.friends = A.parseData(r.data); })
    ]).catch(function () {});
  }

  /* ---------- data from other modules ---------- */
  function rank() {
    var c = safe(function () { return W("MERITER") && W("MERITER").on() ? W("MERITER").cur() : null; }, null);
    if (c) return { title: c.title, m: c.m, pct: c.nextAt ? Math.max(0, Math.min(100, Math.round(100 * (c.m - c.at) / Math.max(1, c.nextAt - c.at)))) : 100,
      next: safe(function () { return W("MERITER").nextText(c); }, ""), idx: c.idx, n: c.n, mer: true };
    var s = safe(function () { return W("SOCIAL").stats(); }, null);
    if (!s || !s.title) return null;
    var v = s.meriter != null ? s.meriter : s.total;
    return { title: s.title, m: v, pct: s.nextAt ? Math.max(0, Math.min(100, Math.round(100 * v / Math.max(1, s.nextAt)))) : 100,
      next: safe(function () { return W("SOCIAL").titleProgress(); }, ""), mer: s.meriter != null };
  }
  function demonym() {
    var t = safe(function () { return W("HOMETOWN").mine(); }, null);
    if (!t) return null;
    var lb = safe(function () { return W("HOMETOWN").label(t); }, "");
    return { town: t, label: sv() && lb ? lb : (sv() ? "från " : "from ") + t };
  }
  function medals() { return safe(function () { return W("MEDALS") && W("MEDALS").on() ? W("MEDALS").mine() : null; }, null); }

  /* ---------- drawing ---------- */
  function tile(k, big, small, act) {
    return '<button type="button" class="pf-tile" data-pf="' + k + '"' + (act ? "" : " disabled") + '><b>' + esc(big) + "</b><span>" + esc(small) + "</span></button>";
  }
  function paint(box) {
    var name = (A.getName && A.getName()) || L("Okänd agent", "Unknown agent");
    var st = safe(function () { return W("SOCIAL").stats(); }, null);
    var r = rank(), dm = demonym(), md = medals(), ps = safe(function () { return W("PASSPORT").data(); }, null);
    var hs = safe(function () { return W("HELG").data(); }, null), y = cache.year, fr = cache.friends, gs = cache.groups;
    var saved = safe(function () { return W("ACCOUNT") && W("ACCOUNT").on() ? W("ACCOUNT").saved() : null; }, null);
    var initial = (Array.from(name.trim())[0] || "?").toUpperCase();
    var h = '<div class="pf-top"><div class="pf-av" aria-hidden="true">' + esc(initial) + "</div>" +
      '<div class="pf-who"><div class="pf-name">' + esc(name) + "</div>" +
      '<button type="button" class="pf-town" data-pf="town">' + (dm ? "📍 " + esc(dm.label) : esc(L("📍 Välj hemstad", "📍 Pick home town"))) + "</button>" +
      '<div class="pf-line">' + esc(line()) + "</div></div>" +
      (saved === null ? "" : '<button type="button" class="pf-acct' + (saved ? " ok" : "") + '" data-pf="acct" aria-label="' + esc(saved ? L("Kontot ä sparat", "Account saved") : L("Kontot ä int' sparat", "Account not saved")) + '">' +
        (saved ? "🔐 " + esc(L("Sparat", "Saved")) : "⚠️ " + esc(L("Int' sparat", "Not saved"))) + "</button>") + "</div>";
    if (r) h += '<button type="button" class="pf-rank" data-pf="rank"><span class="pf-rank-t">🎖️ ' + esc(r.title) + "</span>" +
      '<span class="pf-rank-m">' + esc(r.m + (r.mer ? L(" meriter", " merits") : L(" öl", " beers")) + (r.idx ? " · " + L("grad ", "rank ") + r.idx + "/" + r.n : "")) + "</span>" +
      '<span class="pf-bar" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>' +
      '<span class="pf-rank-n">' + esc(r.next) + "</span></button>";
    var nMed = md ? Object.keys(md).length : null;
    var streak = hs && hs.me ? hs.me.streak | 0 : null;
    var nFr = fr && Array.isArray(fr.friends) ? fr.friends.length : null;
    var tiles = [];
    if (st) tiles.push(tile("total", String(st.total | 0), L("drycker totalt", "drinks total"), true));
    if (y) tiles.push(tile("year", String(y.nights | 0), L("kvällar i år", "nights this year"), true));
    if (ps) tiles.push(tile("pass", String((ps.bars || []).length), L("krogar i passet", "bars in passport"), true));
    if (streak != null) tiles.push(tile("streak", "🔥 " + streak, L("helger i rad", "weekends in a row"), true));
    if (nMed != null) tiles.push(tile("medals", String(nMed), L("medaljer", "medals"), true));
    if (nFr != null) tiles.push(tile("friends", String(nFr), nFr === 1 ? L("vän", "friend") : L("vänner", "friends"), true));
    if (tiles.length) h += '<div class="pf-grid' + (tiles.length === 2 || tiles.length === 4 ? " pf-g2" : "") + '">' + tiles.join("") + "</div>";
    if (y && y.fav_bar_name) h += '<p class="pf-fav">🪑 ' + esc(L("Stamkrog i år: ", "Regular bar this year: ")) + "<b>" + esc(y.fav_bar_name) + "</b>" +
      (y.fav_bar_nights ? " · " + (y.fav_bar_nights | 0) + L(" kvällar", " nights") : "") + "</p>";
    if (md && nMed) {
      var row = safe(function () { return W("MEDALS").medalRowHTML(md, 7, true); }, "");
      if (row) h += '<button type="button" class="pf-medals" data-pf="medals" aria-label="' + esc(L("Mina medaljer", "My medals")) + '">' + row + "</button>";
    }
    if (gs && gs.length) {
      h += '<div class="pf-groups"><span class="pf-sub">' + esc(L("👥 Mina grupper", "👥 My groups")) + "</span>" +
        gs.slice(0, 6).map(function (g) { return '<button type="button" class="pf-chip" data-pf="groups">' + esc(g.name || "?") + "</button>"; }).join("") +
        (gs.length > 6 ? '<span class="pf-chip pf-more">+' + (gs.length - 6) + "</span>" : "") + "</div>";
    }
    box.innerHTML = h;
  }
  function act(k) {
    var go = function (fn) { try { fn(); } catch (e) {} };
    if (k === "town") go(function () { W("HOMETOWN").open(); });
    else if (k === "acct") go(function () { var a = W("ACCOUNT"); if (a.saved()) document.querySelector(".acct-sect") && document.querySelector(".acct-sect").scrollIntoView({ block: "center", behavior: "smooth" }); else a.openSave(); });
    else if (k === "rank" || k === "medals" || k === "total") go(function () { W("MEDALS").showMine(); });
    else if (k === "pass") go(function () { W("PASSPORT").open(); });
    else if (k === "streak") go(function () { W("HELG").open(); });
    else if (k === "year") go(function () { if (W("AFTER") && W("AFTER").openWrapped) W("AFTER").openWrapped("year", 0); else W("MEDALS").showMine(); });
    else if (k === "friends") go(function () { W("NEAR").openFriends(); });
    else if (k === "groups") go(function () { A.showGroups(); });
  }
  function head(body) {
    if (!A || !A.el) return;
    var box = A.el("div", { class: "pf-hero ds-keep" });
    body.appendChild(box);
    paint(box);
    box.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("[data-pf]");
      if (b && !b.disabled) act(b.getAttribute("data-pf"));
    });
    load(false).then(function () { if (document.body.contains(box)) paint(box); });
  }

  window.PROFIL = {
    init: function (api) { A = api; },
    profileHead: head,
    refresh: function () { cache.at = 0; return load(true); },
    _cache: function () { return cache; }
  };
})();
