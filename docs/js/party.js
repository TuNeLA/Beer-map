/* Öl Nu — 🎲 PARTYSPEL (CONTRACT "PARTYSPEL"). Live party games in one room: every player on their own phone,
   the host phone is the shared big screen (Jackbox style). Games: Imposter, Östra lägret, Namn i hatten, Flocken, Vågen.
   This file is the small always-loaded part: the group page tile "🎲 Partyspel" (hook groupItem, data-gsec="spel"),
   the Lek-sheet button (games.js calls PARTY.lekButton(g)), the ?party=CODE join link (QR) and the "back to your room"
   toast after a reload. Everything else is lazy: js/party-ui.js (window.PARTY_UI) + js/party-content.js
   (window.PARTY_CONTENT) are type="text/x-lazy" scripts and party.css is <link rel="x-lazy-css">, loaded on the first open.
   Server: 0070–0072 (party_create, party_join, party_state, party_act, party_group, party_mine). A missing RPC
   (old database, PGRST202) = the tile hides. Hooks (app.js mods): init, onAuthed, groupItem. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, loading = null, cssDone = false, deep = null, off = false, resumeShown = false;
  try {
    var q = new URLSearchParams(location.search), c = q.get("party");
    if (c) deep = String(c).replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || null;
  } catch (e) {}

  var S = {
    sv: { tile: "🎲 Partyspel", tileSub: "Imposter, Östra lägret, Namn i hatten… alla på sin egen lur",
      live: "🎲 Partyspel pågår · {0}", liveSub: "{0} ä värd · {1} med · Tryck för att hoppa in",
      lek: "🎲 Partyspel (alla på sin lur)", load: "Laddar partyspelen…", fail: "Partyspelen kunde int' laddas. Kolla nätet.",
      resume: "🎲 Du ä med i partyrum {0}", back: "Tillbaka" },
    en: { tile: "🎲 Party games", tileSub: "Imposter, Survivor, Names in the hat… everyone on their own phone",
      live: "🎲 Party game on · {0}", liveSub: "{0} is host · {1} in · Tap to jump in",
      lek: "🎲 Party games (own phones)", load: "Loading the party games…", fail: "Could not load the party games. Check the network.",
      resume: "🎲 You are in party room {0}", back: "Back" }
  };
  function T(k) {
    var v = (I && I.lang === "en" && S.en[k] != null) ? S.en[k] : S.sv[k];
    var a = Array.prototype.slice.call(arguments, 1);
    return String(v).replace(/\{(\d)\}/g, function (m, i) { return a[i] != null ? a[i] : ""; });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function missing(err) { try { return U && U.missing ? U.missing(err) : !!(err && (err.code === "PGRST202" || /could not find the function/i.test(err.message || ""))); } catch (e) { return false; } }

  /* ---------- lazy files ---------- */
  function lazySrc(re, sel, attr) {
    var n = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (x) { return re.test(x.getAttribute(attr) || ""); })[0];
    return n ? n.getAttribute(attr) : null;
  }
  function ensureCss() {
    if (cssDone) return; cssDone = true;
    var href = lazySrc(/party\.css/, 'link[rel="x-lazy-css"]', "href") || "./party.css";
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    document.head.appendChild(el("link", { rel: "stylesheet", href: href }));
  }
  function loadScript(re, def, test) {
    if (test()) return Promise.resolve();
    var src = lazySrc(re, 'script[type="text/x-lazy"]', "src") || def;
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { if (test()) resolve(); else reject(new Error("empty")); };
      s.onerror = function () { s.remove(); reject(new Error("load")); };
      document.head.appendChild(s);
    });
  }
  function ensure() {
    ensureCss();
    if (window.PARTY_UI && window.PARTY_CONTENT) return Promise.resolve();
    if (loading) return loading;
    loading = Promise.all([
      loadScript(/party-content\.js/, "./js/party-content.js", function () { return !!window.PARTY_CONTENT; }),
      loadScript(/party-ui\.js/, "./js/party-ui.js", function () { return !!window.PARTY_UI; })
    ]).then(function () { loading = null; }, function (e) { loading = null; throw e; });
    return loading;
  }

  /* ---------- open ---------- */
  // opts: {group:{id,name}} | {code:"ABCD"} | {room:"uuid"}
  function open(opts) {
    if (off || !A) return;
    if (window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up()) { window.OLNU_STRIP.after(function () { open(opts); }); return; }
    var t0 = setTimeout(function () { try { A.toast(T("load"), { id: "party-load", ms: 2500 }); } catch (e) {} }, 400);
    ensure().then(function () {
      clearTimeout(t0); try { A.toastClear("party-load"); } catch (e) {}
      try { if (A.sheetOpen && A.sheetOpen()) A.closeSheet("party"); } catch (e) {}
      window.PARTY_UI.open(A, opts || {});
    }, function () {
      clearTimeout(t0);
      try { A.toast(T("fail"), { err: true, id: "party-load" }); } catch (e) {}
    });
  }

  /* ---------- group page tile ---------- */
  var BSTY = "display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;height:auto;min-height:48px;padding:8px 12px";
  var SSTY = "font-size:12px;opacity:.75;font-weight:400;white-space:normal;line-height:1.3";
  function tile(g, cls) {
    var row = el("div", { class: "pt-gi " + (cls || ""), "data-gsec": "spel" });
    // inline styles: party.css is lazy, the tile must look right before the first open
    var b = el("button", { type: "button", class: "btn btn-small btn-block pt-gbtn", style: BSTY }, [
      el("span", { class: "pt-gl", style: "font-weight:700", text: T("tile") }), el("span", { class: "pt-gs", style: SSTY, text: T("tileSub") })
    ]);
    var go = function (r) {
      if (r) open({ room: r.is_in ? r.id : null, code: r.is_in ? null : r.code, group: { id: g.id, name: g.name || "" } });
      else open({ group: { id: g.id, name: g.name || "" } });
    };
    b.addEventListener("click", function () {
      // the tile may be older than the room: ask again on tap (max 2.5 s, then use what we have)
      if (!A || !A.rpc) { go(row._room); return; }
      var done = false, t = setTimeout(function () { if (!done) { done = true; go(row._room); } }, 2500);
      A.rpc("party_group", { p_group_id: g.id }).then(function (r) {
        if (done) return; done = true; clearTimeout(t);
        var d = r && !r.error ? (A.parseData ? A.parseData(r.data) : r.data) : null;
        go(d ? d.room : row._room);
      });
    });
    row.appendChild(b);
    if (A && A.rpc && A.LIVE !== false) {
      A.rpc("party_group", { p_group_id: g.id }).then(function (r) {
        if (r && r.error) { if (missing(r.error)) { off = true; row.remove(); } return; }
        var d = A.parseData ? A.parseData(r && r.data) : (r && r.data) || {};
        var room = d && d.room;
        if (!room) return;
        row._room = room;
        row.classList.add("live");
        b.style.borderColor = "#ffc24d"; b.style.background = "rgba(245,166,35,.16)";
        b.innerHTML = "";
        b.appendChild(el("span", { class: "pt-gl", style: "font-weight:700", text: T("live", room.code) }));
        b.appendChild(el("span", { class: "pt-gs", style: SSTY, text: T("liveSub", room.host_name || "?", room.n | 0) }));
      });
    }
    return row;
  }
  function groupItem(g, wrap) {
    if (off || !g || !g.id || !wrap) return;
    wrap.appendChild(tile(g));
  }
  function lekButton(g) {
    var b = el("button", { type: "button", class: "btn btn-small btn-block pt-lek", style: "margin-top:8px", text: T("lek") });
    b.addEventListener("click", function () { open(g && g.id ? { group: { id: g.id, name: g.name || "" } } : {}); });
    return b;
  }

  /* ---------- join link + resume ---------- */
  function whenIntroDone(fn, n) {
    var intro = document.getElementById("intro");
    if (intro && !intro.hidden && (n | 0) < 600) { setTimeout(function () { whenIntroDone(fn, (n | 0) + 1); }, 500); return; }
    fn();
  }
  function onAuthed() {
    if (!A || A.LIVE === false) return;
    if (deep) {
      var code = deep; deep = null;
      try { var u = new URL(location.href); u.searchParams.delete("party"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch (e) {}
      whenIntroDone(function () { setTimeout(function () { open({ code: code }); }, 300); });
      return;
    }
    if (resumeShown) return;
    resumeShown = true;
    setTimeout(function () {
      A.rpc("party_mine").then(function (r) {
        if (!r || r.error) { if (r && missing(r.error)) off = true; return; }
        var d = A.parseData ? A.parseData(r.data) : r.data;
        var room = d && d.room;
        if (!room || (window.PARTY_UI && window.PARTY_UI.isOpen && window.PARTY_UI.isOpen())) return;
        A.toast(T("resume", room.code), { id: "party-resume", ms: 9000, action: { label: T("back"), fn: function () { open({ room: room.id }); } } });
      });
    }, 4000);
  }

  window.PARTY = {
    open: open, lekButton: lekButton,
    init: function (api) { A = api; },
    onAuthed: function () { onAuthed(); },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
