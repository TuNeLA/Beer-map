/* Öl Nu — 👤 PROFIL (owner 2026-10-22: "put Ölpass and more of the things in settings into a Profile tab that shows
   everything for your profile"). The ⚙️ sheet has two tabs: "👤 Profil | ⚙️ Inställningar" (app.js showSettings).
   This file draws only the hero card at the top of Profil (hook profileHead): initial, name, hemstad (demonym),
   rank icon + rank + progress to the next rank in MERITS (js/rankico.js), a stat grid (drinks, nights this year, bars in the passport, weekend streak,
   medals, friends), the regular bar this year, the medal ribbon and my groups. Every number comes from data other
   modules already hold (SOCIAL.stats, MERITER.cur, PASSPORT.data, HELG.data, MEDALS.mine, HOMETOWN.mine) plus three
   reads on open, cached 60 s: my_wrapped('year', 0), my_groups, my_friends. No new RPC, no migration, no button on
   the map. The rows below the hero are the modules' own "profileSheet" hooks (moved from "settingsSheet", not
   copied): Ölpasset, Vänner & Hitta (+ Låt mig hittas), Konto, Swish, Spökläge, Topplistan, Wrapped, SOS.
   A missing module or RPC hides its tile. Styles: profile.css. Public: window.PROFIL.
   d-profile (I-114, 06): PROFIL.visSection() = the "Vem ser mig" group (js/pnui.js shapeProfil puts it right under the hero).
   I-132 (lane beerui): "Mina favoritöl" (max 3) comes first in that wrapper: hero, favourites, Vem ser mig. js/beerlib.js favCard()
   fills it (loaded on demand by PN.beerlib()); it follows Synlighet (friends + groups / friends only / ghost = only me). */
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
  // d-profile (I-114, 06): the rank comes from ONE place (js/rankico.js RANKICO.mine(): by merits; Min uniform uses the same).
  // text = "8 meriter till <next rank>" (merits, information only). An old server without merits: the title only.
  function rank() {
    var R = W("RANKICO"), r = R ? safe(function () { return R.mine(); }, null) : null;
    if (!r || !r.title) return null;
    r.text = safe(function () { return R.progText(r); }, "");
    r.ico = safe(function () { return R.svg(r.idx, 28); }, "");
    return r;
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
    var h = '<div class="pf-top">' + (safe(function () { return W("AVATAR").profileAv(initial); }, null) || '<div class="pf-av" aria-hidden="true">' + esc(initial) + "</div>") +
      '<div class="pf-who"><div class="pf-name">' + esc(name) + "</div>" +
      '<button type="button" class="pf-town" data-pf="town">' + (dm ? "📍 " + esc(dm.label) : esc(L("📍 Välj hemstad", "📍 Pick home town"))) + "</button>" +
      '<div class="pf-line">' + esc(line()) + "</div></div>" +
      (saved === null ? "" : '<button type="button" class="pf-acct' + (saved ? " ok" : "") + '" data-pf="acct" aria-label="' + esc(saved ? L("Kontot ä sparat", "Account saved") : L("Kontot ä int' sparat", "Account not saved")) + '">' +
        (saved ? "🔐 " + esc(L("Sparat", "Saved")) : "⚠️ " + esc(L("Int' sparat", "Not saved"))) + "</button>") + "</div>";
    if (r) h += '<button type="button" class="pf-rank" data-pf="rank" aria-label="' + esc(L("Grad: ", "Rank: ") + r.title + (r.text ? ". " + r.text : "")) + '">' +
      '<span class="pf-rank-t">' + r.ico + "<span>" + esc(r.title) + "</span></span>" +
      (r.mer && r.next ? '<span class="pf-bar" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>' : "") +
      (r.text ? '<span class="pf-rank-n">' + esc(r.text) + "</span>" : "") + "</button>";
    var nMed = md ? Object.keys(md).length : null;
    var streak = hs && hs.me ? hs.me.streak | 0 : null;
    var nFr = fr && Array.isArray(fr.friends) ? fr.friends.length : null;
    var tiles = [];
    // fixJ T-22: the label follows the number (1 dryck / 1 kväll / 1 krog)
    if (st) tiles.push(tile("total", String(st.total | 0), (st.total | 0) === 1 ? L("dryck totalt", "drink total") : L("drycker totalt", "drinks total"), true));
    if (y) tiles.push(tile("year", String(y.nights | 0), (y.nights | 0) === 1 ? L("kväll i år", "night this year") : L("kvällar i år", "nights this year"), true));
    if (ps) tiles.push(tile("pass", String((ps.bars || []).length), (ps.bars || []).length === 1 ? L("krog i passet", "bar in passport") : L("krogar i passet", "bars in passport"), true));
    if (streak != null) tiles.push(tile("streak", "🔥 " + streak, L("helger i rad", "weekends in a row"), true));
    if (nMed != null) tiles.push(tile("medals", String(nMed), L("medaljer", "medals"), true));
    if (nFr != null) tiles.push(tile("friends", String(nFr), nFr === 1 ? L("vän", "friend") : L("vänner", "friends"), true));
    if (tiles.length) h += '<div class="pf-grid' + (tiles.length === 2 || tiles.length === 4 ? " pf-g2" : "") + '">' + tiles.join("") + "</div>";
    if (y && y.fav_bar_name) h += '<p class="pf-fav">🪑 ' + esc(L("Stamkrog i år: ", "Regular bar this year: ")) + "<b>" + esc(y.fav_bar_name) + "</b>" +
      (y.fav_bar_nights ? " · " + L(U.pl(y.fav_bar_nights, "kväll", "kvällar"), (y.fav_bar_nights | 0) + " nights") : "") + "</p>";
    if (md && nMed) {
      var row = safe(function () { return W("MEDALS").medalRowHTML(md, 7, false); }, "");
      if (row) h += '<button type="button" class="pf-medals" data-pf="medals" aria-label="' + esc(L("Mina medaljer", "My medals")) + '">' + row + "</button>";
    }
    if (gs && gs.length) {
      h += '<div class="pf-groups"><span class="pf-sub">' + esc(L("👥 Mina grupper", "👥 My groups")) + "</span>" +
        gs.slice(0, 6).map(function (g) { return '<button type="button" class="pf-chip" data-pf="groups">' + esc(g.name || "?") + "</button>"; }).join("") +
        (gs.length > 6 ? '<span class="pf-chip pf-more">+' + (gs.length - 6) + "</span>" : "") + "</div>";
    }
    box.innerHTML = h;
    // social-a (misc F4): "Grundare" badge next to the name; MISC.founderBadge() stays hidden until the owner sets the cutoff
    try {
      var nm = box.querySelector(".pf-name");
      if (nm && window.MISC && window.MISC.founderBadge) { var fb = window.MISC.founderBadge(); if (fb) { nm.classList.add("sa-pf-name"); nm.appendChild(fb); } }
    } catch (e) {}
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

  /* d-profile (I-114, 06): "Vem ser mig" right under the identity card. The rows are the REAL settings, not copies:
       Synlighet    → Inställningar › Integritet (the Alla | Bara vänner | Spöke control); the row shows the value
       Spökläge     = PNVIS.setMode() in place (a switch)
       Exakt plats  = the app's own precision control (#prec-seg → PN.s.prec, olnu.prec) in place (a switch)
       Hemzon       → the Hemzon sheet; the row shows På / Av
     The values are read again on every paint (after a tap, and when the sheet body changes). */
  function pni(n) { return safe(function () { return W("PNI").svg(n); }, "") || ""; }
  function h(tag, attrs, kids) { return A.el(tag, attrs, (kids || []).filter(Boolean)); }
  function ls(k, d) { return U.ls.get(k, d); }
  function visRow(icon, title, sub, cls, sw) {
    var kids = [h("span", { class: "ds-row-i", "aria-hidden": "true", html: pni(icon) }),
      h("span", { class: "ds-row-t" }, [h("span", { text: title }), sub ? h("small", { text: sub }) : null]),
      sw ? h("span", { class: "switch", "aria-hidden": "true", "aria-checked": "false" }) : h("span", { class: "pn-row-v" }),
      sw ? null : h("span", { class: "ds-chev", "aria-hidden": "true" })];
    var b = h("button", { type: "button", class: "ds-row pn-row " + cls }, kids);
    if (sw) { b.setAttribute("role", "switch"); b.setAttribute("aria-checked", "false"); }
    return b;
  }
  function visSection() {
    var V = W("PNVIS");
    if (!A || !A.LIVE || !V || !V.mode || !V.setMode) return null;
    var NAME = { alla: L("Alla", "Everyone"), vanner: L("Bara vänner", "Friends only"), spoke: L("Spöke", "Ghost") };
    var sec = h("section", { class: "ds-section pn-vsm" }, [h("h3", { class: "ds-section-h", text: L("Vem ser mig", "Who sees me") })]);
    var list = h("div", { class: "ds-list" }); sec.appendChild(list);
    var prec = function () { var P = W("PN"); return P && P.s && P.s.prec ? P.s.prec : ls("olnu.prec", "exact") === "area" ? "area" : "exact"; };
    var setSw = function (b, on) { b.setAttribute("aria-checked", String(on)); b.querySelector(".switch").setAttribute("aria-checked", String(on)); };
    var rVis = visRow("eye", L("Synlighet", "Visibility"), "", "pn-vsm-vis", false);
    var sGhost = visRow("eye-off", L("Spökläge", "Ghost mode"), L("Ingen ser dig på kartan", "Nobody sees you on the map"), "pn-vsm-ghost", true);
    var sExact = visRow("pin", L("Exakt plats", "Exact place"), " ", "pn-vsm-exact", true);
    var rHome = W("HOMEZONE") && W("HOMEZONE").open ? visRow("home", L("Hemzon", "Home zone"), L("Hemma syns bara ett område", "At home only an area shows"), "pn-vsm-home", false) : null;
    function paint() {
      var m = safe(function () { return V.mode(); }, "alla"), hz = safe(function () { return W("HOMEZONE").home(); }, null);
      var v = rVis.querySelector(".pn-row-v"), t = NAME[m] || NAME.alla; if (v.textContent !== t) v.textContent = t;
      setSw(sGhost, m === "spoke"); setSw(sExact, prec() === "exact");
      // the sub line says what the CURRENT state does (it said "Av: …" while the switch was on)
      var es = sExact.querySelector(".ds-row-t > small"), et = prec() === "exact" ? L("Nya öl visar din exakta plats", "New beers show your exact place") : L("Nya öl visar bara området", "New beers show only the area");
      if (es && es.textContent !== et) es.textContent = et;
      if (rHome) { var hv = rHome.querySelector(".pn-row-v"), ht = hz ? L("På", "On") : L("Av", "Off"); if (hv.textContent !== ht) hv.textContent = ht; }
    }
    rVis.addEventListener("click", function () { var P = W("PN"); if (P && P.showSettings) P.showSettings("s", "synl"); else safe(function () { V.open(); }); });
    sGhost.addEventListener("click", function () {
      var on = safe(function () { return V.mode(); }, "alla") !== "spoke";
      safe(function () { V.setMode(on ? "spoke" : ls("olnu.visMode", "") === "vanner" ? "vanner" : "alla"); });
      paint();
    });
    sExact.addEventListener("click", function () {
      var b = document.getElementById(prec() === "exact" ? "prec-area" : "prec-exact"); if (b) b.click();   // the real control (app-map.js)
      paint();
    });
    if (rHome) rHome.addEventListener("click", function () { safe(function () { W("HOMEZONE").open(); }); });
    [rVis, sGhost, sExact, rHome].forEach(function (r) { if (r) list.appendChild(r); });
    paint();
    // a wrapper, not a section of the body: the Profil fold hides the body's own sections (pnui.css), and unlocks.js puts its
    // "Garderob" row in the first list inside .pn-pf (that stays the "Mitt" list)
    return h("div", { class: "pn-vsm-w ds-keep" }, [favSection(), sec]);
  }
  /* I-132: "Mina favoritöl". inst-pw.js rule: nothing may pop in after the sheet showed. So the card is drawn AT ONCE from the
     view this phone saved last time (olnu.beer.favView: 3 tiles + the privacy line; first time = 3 empty tiles) with its CSS here
     (not in the lazy beerlib.css). js/beerlib.js favCard() then asks the server and repaints only on a real change (paint = same
     HTML -> no DOM write). A missing beer library (load error) leaves the card as it is. */
  var FAV_VIEW = "olnu.beer.favView";
  var FAV_CSS = ".bl-fav,.bl-fav *{box-sizing:border-box}" +
    ".bl-fav{color:var(--ds-text);font-family:var(--ds-sans)}" +
    ".bl-fav .bl-pic{display:grid;place-items:center;overflow:hidden;border-radius:var(--r-md);background:var(--ds-raised);flex:none}" +
    ".bl-fav .bl-pic img{width:100%;height:100%;object-fit:contain;display:block}" +
    ".bl-fav .bl-pic.ph{background:var(--bl-photo-bg,#f3f1ea)}" +
    ".bl-fav .bl-pic.ph img{padding:2px}" +
    ".bl-fav{margin:var(--sp-5) 0 var(--sp-5)}" +
    ".bl-fav-h{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);margin-bottom:var(--sp-2)}" +
    "#sheet-body .bl-fav-h h3{margin:0 !important;padding:0 !important;color:var(--ds-muted);font:400 var(--fs-14)/44px var(--ds-sans) !important}" +
    ".bl-fav-h button{min-height:44px;padding:0 var(--sp-2);background:none;border:0;color:var(--ds-amber-t);font:600 var(--fs-14)/20px var(--ds-sans);cursor:pointer}" +
    ".bl-fav-g{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-2)}" +
    ".bl-ft{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:var(--sp-3) var(--sp-2);border-radius:var(--r-lg);border:1px solid var(--ds-border);min-width:0; background:radial-gradient(80% 60% at 50% 30%,var(--bl-glow,rgba(232,144,42,.26)) 0,transparent 75%),var(--ds-card);text-align:center;color:inherit;font:inherit;min-height:44px;cursor:pointer}" +
    ".bl-ft .bl-pic{width:56px;height:80px;margin-bottom:var(--sp-1)}" +
    ".bl-ft b{font:600 var(--fs-14)/20px var(--ds-sans);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}" +
    ".bl-ft small{color:var(--ds-text-2);font-size:var(--fs-12);line-height:16px}" +
    ".bl-ft .n{position:absolute;top:var(--sp-2);left:var(--sp-2);width:22px;height:22px;border-radius:var(--r-pill);display:grid;place-items:center;background:var(--ds-raised);color:var(--ds-amber-t);font:600 var(--fs-12)/1 var(--ds-sans)}" +
    ".bl-ft.empty{justify-content:center;border-style:dashed;background:var(--ds-card);color:var(--ds-text-2);min-height:150px}" +
    ".bl-ft.empty svg{width:24px;height:24px;color:var(--ds-amber-t)}" +
    ".bl-priv{display:flex;align-items:center;gap:var(--sp-2);color:var(--ds-muted);font-size:var(--fs-12);line-height:16px;margin-top:var(--sp-2)}" +
    ".bl-priv svg{width:16px;height:16px;flex:none}";
  function favCss() {
    if (document.getElementById("pf-fav-css")) return;
    var st = document.createElement("style"); st.id = "pf-fav-css"; st.textContent = FAV_CSS; document.head.appendChild(st);
  }
  function favView() { try { var v = JSON.parse(localStorage.getItem(FAV_VIEW) || "null"); return v && Array.isArray(v.t) ? v : null; } catch (e) { return null; } }
  function favPriv() {
    var m = safe(function () { return W("PNVIS").mode(); }, "alla");
    return m === "spoke" ? L("Spökläge: bara du ser dem.", "Ghost mode: only you see them.") : m === "vanner" ? L("Syns bara för dina vänner.", "Seen by your friends only.") :
      L("Syns för dina vänner och grupper.", "Seen by your friends and groups.");
  }
  function favTile(t, i) {
    if (!t || !t.id) return '<button type="button" class="bl-ft empty" data-bl-find="1">' + pni("plus") + "<b>" + esc(L("Välj", "Pick")) + "</b><small>" + esc(L("Favorit ", "Favourite ") + (i + 1)) + "</small></button>";
    var pic = t.img ? '<span class="bl-pic' + (t.ph ? " ph" : "") + '"><img src="' + esc(t.img) + '" alt="" loading="lazy" decoding="async"></span>' : '<span class="bl-pic" aria-hidden="true">' + pni("beer") + "</span>";
    return '<button type="button" class="bl-ft" data-bl-beer="' + esc(t.id) + '"><span class="n" aria-hidden="true">' + (i + 1) + "</span>" + pic + "<b>" + esc(t.n || "") + "</b><small>" + esc(t.s || "") + "</small></button>";
  }
  function favPaint(sec, v) {
    var t = v && Array.isArray(v.t) ? v.t : [];
    var html = '<div class="bl-fav-h"><h3>' + esc(L("Mina favoritöl", "My favourite beers")) + '</h3><button type="button" data-bl-find="1">' + esc(L("Ändra", "Edit")) + "</button></div>" +
      '<div class="bl-fav-g">' + [0, 1, 2].map(function (i) { return favTile(t[i], i); }).join("") + '</div><div class="bl-priv">' + pni("eye") + "<span>" + esc((v && v.p) || favPriv()) + "</span></div>";
    if (sec.__h === html) return false;
    sec.__h = html; sec.innerHTML = html;
    return true;
  }
  function favSection() {
    var P = W("PN"); if (!P || !P.beerlib) return null;
    favCss();
    var fav = h("section", { class: "bl bl-fav ds-keep", "aria-label": L("Mina favoritöl", "My favourite beers") });
    favPaint(fav, favView());
    fav.__blPaint = function (v) { try { localStorage.setItem(FAV_VIEW, JSON.stringify(v)); } catch (e) {} return favPaint(fav, v); };
    fav.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b = t.closest("[data-bl-beer]"), id = b && b.getAttribute("data-bl-beer");
      if (id) { P.beerlib().then(function (B) { B.beer(id); }, function () {}); return; }
      if (t.closest("[data-bl-find]")) safe(function () { if (P.closeSheet) P.closeSheet(); setTimeout(function () { W("BARSEARCH").open("beer"); }, 60); });
    });
    P.beerlib().then(function (B) { if (B && B.favCard) B.favCard(fav); }, function () {});
    return fav;
  }

  window.PROFIL = {
    init: function (api) { A = api; },
    profileHead: head,
    visSection: visSection,
    refresh: function () { cache.at = 0; return load(true); },
    _cache: function () { return cache; }
  };
})();
