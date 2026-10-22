/* Öl Nu — GRUPPSIDAN 2 (social2, owner-approved research items 15–19; migration 0123 group_now).
   WhatsApp/Discord pattern: the group page opens on ONE calm screen:
     header (name ›, ⋯)  ·  🟢 NU strip (who is out, where, the newest beer/check-in)  ·  anything LIVE (call-outs,
     a running skåltimme, a new film roll)  ·  💬 the chat (last messages + a quick reply)  ·  [ + ]  [ 🍺 ÖL! ]
   Everything else is ≤ 2 taps away:
     [ + ]  = actions: the polish2 sections Ikväll · Spel & kul (visible) and Dagen efter · Gruppen · Mer… (one fold),
              plus module items from the `groupActions` hook.
     [ ⋯ ]  = info: 👥 Medlemmar & roller, gruppchef, helgstreak, nätter tillsammans, kod + bjud in, Lämna.
   ONE system: polish2.js still sorts every tile into its section (data-gp + order). This file only adds data-gm
   (home | plus | info) to each child and a data-gv view on the wrapper; CSS shows one view. The DOM order is not changed,
   every module keeps its own tile and listeners. polish2.js calls GPAGE.sorted(wrap) after each sort.
   groupActions hook: any window module with groupActions(g) → item or array of
     { icon, label, sub?, onClick(g), sect? (1 Ikväll default, 2 Spel, 3 Dagen efter, 4 Gruppen), id?, hot? }.
   Register by being a global object (window.FOO.groupActions) or by pushing to window.OLNU_GA.
   Hooks (app.js mods, GPAGE is already in the list): init, groupItem, onPoll, applyText.
   Public: GPAGE.sorted(wrap), GPAGE.view(wrap, v), GPAGE.menuOf(child), GPAGE.actions(g).
   Missing RPC (old server) → the Nu strip hides, the chat block hides; tiles still reachable in + / ⋯. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, offNow = false, offChat = false;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v;
      else if (k === "class") e.className = v; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function hm(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!isFinite(m)) return "";
    if (m < 1) return L("nyss", "just now");
    if (m < 60) return m + " min";
    return hm(iso);
  }

  /* ---------- texts (dalmål "ä" for é) ---------- */
  var TX = {
    none: [["Ingen ute än. Bli först, pojk!", "Nobody out yet. Be the first!"], ["Tyst i leden. Nån måste börja.", "All quiet. Someone has to start."],
      ["Kasernen sover. Väck den mä en öl.", "The barracks sleep. Wake them with a beer."], ["Inga soldater i fält ikväll – än.", "No troops in the field tonight – yet."],
      ["Lugnt läge. Dä ä du som bestämmer när dä smäller.", "Calm. You decide when it kicks off."]],
    beer: ["🍺 ÖL!", "🍺 ÖL!"], beerSub: [["jag ä ute", "I'm out"], ["syns för gänget", "the gang sees you"], ["anmäl dig i fält", "report for duty"]],
    plus: ["＋", "＋"], plusAria: ["Mer att göra", "More to do"], moreAria: ["Info om gruppen", "Group info"],
    chatH: ["💬 Chatten", "💬 Chat"], chatOpen: ["Öppna ›", "Open ›"], chatPh: ["Skriv till gänget…", "Message the gang…"],
    chatEmpty: [["Tyst i radion. Säg nåt!", "Radio silence. Say something!"], ["Ingen har sagt nåt än ikväll.", "Nobody said anything yet tonight."]],
    send: ["Skicka", "Send"], you: ["Du", "You"],
    back: ["‹ Tillbaka", "‹ Back"], plusH: ["➕ Gör nåt", "➕ Do something"], infoH: ["ℹ️ Om gruppen", "ℹ️ About the group"],
    fold: ["Mer… ", "More… "], foldLess: ["Mindre ▴", "Less ▴"],
    members: ["👥 Medlemmar & roller", "👥 Members & roles"], code: ["🔑 Kod", "🔑 Code"], copied: ["📋 Koden ä kopierad", "📋 Code copied"],
    invite: ["➕ Bjud in", "➕ Invite"], status: ["📸 Begär lägesrapport", "📸 Ask for a status report"], statusSub: ["gruppchefen", "the chief"],
    event: ["📨 Skapa event", "📨 Make an event"], eventSub: ["bjud in gänget", "invite the gang"],
    out1: ["{n} ute nu", "{n} out now"], last: ["Senast:", "Latest:"], at: ["på", "at"],
    ci: ["checkade in", "checked in"], fail: ["Kunde int' skicka. Försök igen.", "Could not send. Try again."],
    slow: ["Lugn i stormen – vänta nån sekund.", "Easy – wait a few seconds."]
  };
  function T(k) { var v = TX[k]; if (!v) return ""; if (Array.isArray(v[0])) v = pick(k, v); return sv() ? v[0] : v[1]; }

  /* ---------- menu membership: home | plus | info ---------- */
  var INFO_CLS = ["chief-gi", "hs-gline", "nr-tile", "g-acts", "g-foot", "confirm", "gpg-info"];
  function hot(c) {
    var k = c.classList;
    if (k.contains("rl-group-item") || k.contains("rl-gi-yes")) return true;
    return !!c.querySelector(".live, .new, .cer-hot");
  }
  function menuOf(c) {
    var k = c.classList;
    if (k.contains("gmain")) return "home info";
    if (k.contains("gpg-now") || k.contains("gpg-chat") || k.contains("gpg-bar") || k.contains("gpg-dots")) return "home";
    if (k.contains("gpg-ph")) return "plus info";
    if (k.contains("gpg-ga") || k.contains("gpg-fold")) return "plus";
    if (k.contains("gp-more")) return "none";
    if (k.contains("gp-h")) return "plus";
    if (k.contains("chief-gi") && c.querySelector(".live")) return "home info";   // a running lägesrapport stays on the page
    for (var i = 0; i < INFO_CLS.length; i++) if (k.contains(INFO_CLS[i])) return "info";
    if (k.contains("row") && /💬/.test(c.textContent || "") && !c.querySelector(".jam-host")) return "none";   // the old 💬 Chatt button (chat is on the page now)
    if (hot(c)) return "home";
    return "plus";
  }

  /* ---------- groupActions hook ---------- */
  function sources() {
    var list = [], seen = [];
    function add(m) { if (m && typeof m.groupActions === "function" && seen.indexOf(m) < 0) { seen.push(m); list.push(m); } }
    (window.OLNU_GA || []).forEach(add);
    try { Object.keys(window).forEach(function (k) { if (/^[A-Z][A-Z0-9_]{2,}$/.test(k)) { var m = window[k]; if (m && typeof m === "object") add(m); } }); } catch (e) {}
    return list;
  }
  function actions(g) {
    var out = [];
    sources().forEach(function (m) {
      try {
        var r = m.groupActions(g);
        (Array.isArray(r) ? r : r ? [r] : []).forEach(function (x) { if (x && x.label && typeof x.onClick === "function") out.push(x); });
      } catch (e) { try { console.warn("olnu groupActions", e); } catch (x) {} }
    });
    return out;
  }
  // Built-in items (only where no tile exists for them).
  var SELF = {
    groupActions: function (g) {
      var r = [];
      if (window.INVITE && window.INVITE.openCreate) r.push({ id: "gpg-ev", icon: "📨", label: T("event").replace(/^📨 /, ""), sub: T("eventSub"), sect: 1,
        onClick: function () { try { window.INVITE.openCreate({}); } catch (e) {} } });
      return r;
    }
  };
  (window.OLNU_GA = window.OLNU_GA || []).push(SELF);

  /* ---------- view switch ---------- */
  function view(wrap, v) {
    if (!wrap) return;
    wrap.setAttribute("data-gv", v);
    var sb = document.getElementById("sheet-body");
    if (sb && sb.contains(wrap)) {
      var top = wrap.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop - 8;
      if (v !== "home" || sb.scrollTop > top) sb.scrollTop = Math.max(0, top);
    }
    if (v === "home") paintChat(wrap);
    var f = v === "plus" ? wrap.querySelector(".gpg-ph .gpg-back") : v === "info" ? wrap.querySelector(".gpg-ph .gpg-back") : wrap.querySelector(".gpg-plus");
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- sorted: called by polish2 after each sort ---------- */
  // 📸 Begär lägesrapport lives in the chief tile (⋯); a + tile mirrors it for the chief (taps the real button).
  function syncProxies(wrap) {
    var rq = wrap.querySelector(".chief-gi .chief-req"), t = wrap.querySelector(".gpg-rq");
    if (rq && !t) {
      var b = h("button", { type: "button", class: "btn" }, [h("span", { class: "gpg-gl" }), h("span", { class: "gpg-gs", text: T("statusSub") })]);
      b.addEventListener("click", function () {
        var r2 = wrap.querySelector(".chief-gi .chief-req");
        if (r2 && !r2.disabled) r2.click(); else if (r2 && A) A.toast(r2.textContent, { id: "gpg" });
      });
      t = h("div", { class: "gpg-ga gpg-rq", "data-gs": "1", "data-gp": "1", "data-ga": "status" }, [b]);
      t.style.order = "15";
      wrap.appendChild(t);
    }
    if (t) {
      t.hidden = !rq;
      var lbl = rq ? String(rq.textContent || "").trim() : "";
      var gl = t.querySelector(".gpg-gl");
      if (gl && gl.textContent !== lbl) gl.textContent = lbl;
      t.classList.toggle("off", !!(rq && rq.disabled));
    }
  }
  function sorted(wrap) {
    if (!wrap || !wrap.__gpg || wrap.__gpgBusy) return;
    wrap.__gpgBusy = true;
    try { syncProxies(wrap); sortedInner(wrap); } finally { wrap.__gpgBusy = false; }
  }
  function sortedInner(wrap) {
    var foldN = 0;
    [].slice.call(wrap.children).forEach(function (c) {
      var m = menuOf(c);
      c.setAttribute("data-gm", m);
      var s = +(c.getAttribute("data-gp") || 0);
      if (/\bplus\b/.test(m) && !c.classList.contains("gp-h") && !c.classList.contains("gpg-ph") && (s >= 3 || c.hasAttribute("data-gpg-fold"))) {
        c.setAttribute("data-gpg-fold", "1"); foldN++;
      }
      if (c.classList.contains("gp-h")) {
        var hs = +(c.getAttribute("data-s") || 0);
        if (hs >= 3) c.setAttribute("data-gpg-fold", "1");
        // a head shows in + only when its section has a + item
        var has = wrap.querySelector('[data-gp="' + hs + '"][data-gm="plus"]:not(.gp-h)') || wrap.querySelector('.gpg-ga[data-gs="' + hs + '"]');
        c.setAttribute("data-gm", has ? "plus" : "none");
      }
    });
    var fb = wrap.querySelector(".gpg-fold");
    if (fb) {
      fb.hidden = !foldN;
      var ft = wrap.classList.contains("gpg-open") ? T("foldLess") : T("fold") + "(" + foldN + ") ▾";
      if (fb.textContent !== ft) fb.textContent = ft;
    }
    if (!wrap.hasAttribute("data-gv")) wrap.setAttribute("data-gv", "home");
  }

  /* ---------- the parts ---------- */
  function faceEls(list, cls) {
    return list.slice(0, 5).map(function (p, i) {
      return h("span", { class: "gpg-face " + (cls || "") + (p.me ? " me" : ""), style: "--i:" + i, "aria-hidden": "true", text: p.i || (p.name || "?").charAt(0).toUpperCase() });
    });
  }
  function barName(p) {
    if (p.place) return p.place;
    try { if (p.bar_id && window.BARS && window.BARS.byId) { var b = window.BARS.byId(p.bar_id); if (b && b.name) return b.name; } } catch (e) {}
    return "";
  }
  function paintNow(wrap, d) {
    var box = wrap.querySelector(".gpg-now"); if (!box) return;
    box.hidden = false; box.innerHTML = "";
    var out = (d && d.out) || [];
    var places = []; out.forEach(function (p) { var b = barName(p); if (b && places.indexOf(b) < 0) places.push(b); });
    var head = h("div", { class: "gpg-now-h" }, [h("span", { class: "gpg-dot" + (out.length ? " on" : ""), "aria-hidden": "true" }), h("b", { text: L("NU", "NOW") })]);
    var faces = h("div", { class: "gpg-faces" }, faceEls(out, "on"));
    var line = out.length
      ? T("out1").replace("{n}", out.length) + (places.length ? " · " + places.slice(0, 2).join(", ") + (places.length > 2 ? " +" + (places.length - 2) : "") : "")
      : T("none");
    var main = h("div", { class: "gpg-now-main" }, [h("div", { class: "gpg-now-l", text: line })]);
    if (d && d.last) {
      var x = d.last, who = x.me ? T("you") : (x.name || "?");
      var what = x.kind === "checkin" ? "📍 " + who + " " + T("ci") : (x.kind === "other" ? "🥃 " : "🍺 ") + who;
      main.appendChild(h("div", { class: "gpg-now-s muted", text: T("last") + " " + what + (x.place ? " · " + x.place : "") + " · " + ago(x.at) }));
    }
    box.appendChild(head);
    if (out.length) box.appendChild(faces);
    box.appendChild(main);
    box.setAttribute("aria-label", line);
    box.__out = out;
  }
  function loadNow(wrap, g) {
    if (offNow || !A || !A.LIVE || !g || !g.id) { var b0 = wrap.querySelector(".gpg-now"); if (b0) b0.hidden = true; return; }
    A.rpc("group_now", { p_group_id: g.id }).then(function (r) {
      if (!document.body.contains(wrap)) return;
      if (r.error) { if (U.missing && U.missing(r.error)) offNow = true; var b = wrap.querySelector(".gpg-now"); if (b && !b.__out) b.hidden = true; return; }
      paintNow(wrap, A.parseData(r.data));
    });
  }
  function nowTap(wrap, g) {
    var out = (wrap.querySelector(".gpg-now") || {}).__out || [];
    if (!A || !A.map) return;
    if (g && !wrap.__hfAll && window.HITTA && window.HITTA.nowSheet) {
      try { if (window.HITTA.nowSheet(g, out, function () { wrap.__hfAll = true; try { nowTap(wrap, g); } finally { wrap.__hfAll = false; } })) return; } catch (e) {}
    }
    var names = {}; out.forEach(function (p) { if (p.name) names[p.name] = 1; });
    var pts = (A.beers() || []).filter(function (b) { return (b.friend_name && names[b.friend_name]) || (b.is_mine && out.some(function (p) { return p.me; })); })
      .map(function (b) { return [b.lat, b.lng]; });
    A.closeSheet();
    if (pts.length === 1) A.map.flyTo(pts[0], 16, { duration: 0.8 });
    else if (pts.length > 1) A.map.flyToBounds(pts, { padding: [60, 60], maxZoom: 16, duration: 0.8 });
  }

  // chat preview: last 3 messages + quick reply (full chat = social.js openChat)
  function chatRow(m) {
    var nm = m.is_me ? T("you") : (m.name || L("Någon", "Someone"));
    var body = String(m.body || "").replace(/^⁣/, "");
    return h("li", { class: "gpg-msg" + (m.is_me ? " me" : "") }, [h("b", { text: nm + " " }), h("span", { text: body }), h("small", { class: "muted", text: " " + hm(m.created_at) })]);
  }
  function paintChat(wrap) {
    var st = wrap.__chat; if (!st) return;
    var ul = wrap.querySelector(".gpg-msgs"); if (!ul) return;
    ul.innerHTML = "";
    var last = st.msgs.slice(-3);
    if (!last.length) ul.appendChild(h("li", { class: "gpg-msg muted gpg-empty", text: T("chatEmpty") }));
    last.forEach(function (m) { ul.appendChild(chatRow(m)); });
  }
  function loadChat(wrap, g) {
    var st = wrap.__chat; if (!st || offChat || st.busy || !A || !A.LIVE) return;
    if (document.visibilityState === "hidden") return;
    st.busy = true;
    A.rpc("group_msgs", { p_group_id: g.id, p_after_id: st.lastId }).then(function (r) {
      st.busy = false;
      if (!document.body.contains(wrap)) return;
      if (r.error) {
        if (U.missing && U.missing(r.error)) { offChat = true; var c = wrap.querySelector(".gpg-chat"); if (c) c.hidden = true; }
        return;
      }
      var rows = (r.data || []).slice().sort(function (a, b) { return a.id - b.id; });
      rows.forEach(function (m) { if (m.id > st.lastId) { st.lastId = m.id; st.msgs.push(m); } });
      if (st.msgs.length > 20) st.msgs = st.msgs.slice(-20);
      if (rows.length || !st.painted) { st.painted = true; paintChat(wrap); }
    });
  }
  function send(wrap, g, inp, btn) {
    var text = String(inp.value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!text || !A) return;
    if (text.length > 140) text = text.slice(0, 140);
    btn.disabled = true;
    try { if (window.olnuGroupBump) window.olnuGroupBump(g.id, 3); } catch (e) {}
    A.rpc("post_group_msg", { p_group_id: g.id, p_body: text }).then(function (r) {
      btn.disabled = false;
      if (r.error) { A.toast(U.errCode && U.errCode(r.error) === "slow_down" ? T("slow") : T("fail"), { err: true }); return; }
      inp.value = "";
      A.invoke("notify-group", { event: "msg", group_id: g.id });
      try { if (window.EXTRAS && window.EXTRAS.award) window.EXTRAS.award("chat"); } catch (e) {}
      loadChat(wrap, g);
    });
  }
  function openChat(g) { try { if (window.SOCIAL && window.SOCIAL.openChat) window.SOCIAL.openChat(g); } catch (e) {} }

  function beerTap() {
    if (!A) return;
    A.closeSheet();
    setTimeout(function () { var b = document.getElementById("btn-beer"); if (b && !b.disabled) b.click(); }, 260);
  }

  function copy(text, done) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () {}); return; } } catch (e) {}
    try { if (A && A.copyText) { A.copyText(text); done(); } } catch (e) {}
  }

  /* ---------- build (groupItem hook) ---------- */
  function build(g, wrap, main) {
    if (!A || !wrap || wrap.__gpg) return;
    wrap.__gpg = true; wrap.__g = g;
    wrap.classList.add("gpg");
    wrap.setAttribute("data-gv", "home");

    // ⋯ (info) top right of the header
    var dots = h("button", { type: "button", class: "gpg-dots", "aria-label": T("moreAria"), text: "⋯", onclick: function () { view(wrap, "info"); } });

    // Nu strip
    var now = h("button", { type: "button", class: "gpg-now", hidden: true, onclick: function () { nowTap(wrap, g); } });

    // chat block
    var chat = null;
    if (window.SOCIAL && window.SOCIAL.openChat) {
      var inp = h("input", { class: "inp gpg-inp", maxlength: "140", enterkeyhint: "send", autocomplete: "off", placeholder: T("chatPh"), "aria-label": T("chatPh") });
      var sb = h("button", { type: "button", class: "btn btn-amber gpg-send", "aria-label": T("send"), text: "➤" });
      sb.addEventListener("click", function () { send(wrap, g, inp, sb); });
      inp.addEventListener("keydown", function (e) { window.OLNU_CHAT_AT = Date.now(); if (e.key === "Enter") send(wrap, g, inp, sb); });
      chat = h("div", { class: "gpg-chat" }, [
        h("button", { type: "button", class: "gpg-chat-h", onclick: function () { openChat(g); } }, [h("b", { text: T("chatH") }), h("span", { class: "gpg-chat-o", text: T("chatOpen") })]),
        h("ul", { class: "gpg-msgs", role: "button", tabindex: "0", "aria-label": T("chatH"), onclick: function () { openChat(g); } }),
        h("div", { class: "gpg-qr" }, [inp, sb])
      ]);
      wrap.__chat = { msgs: [], lastId: 0, busy: false, painted: false };
    }

    // bottom bar: + and the ONE main action
    var plus = h("button", { type: "button", class: "gpg-plus", "aria-label": T("plusAria"), onclick: function () { view(wrap, "plus"); } }, [h("span", { "aria-hidden": "true", text: "+" })]);
    var beer = h("button", { type: "button", class: "btn gpg-beer", onclick: beerTap }, [h("b", { text: T("beer") }), h("small", { text: T("beerSub") })]);
    var bar = h("div", { class: "gpg-bar" }, [plus, beer]);

    // + / ⋯ panel head
    var ph = h("div", { class: "gpg-ph" }, [
      h("button", { type: "button", class: "gpg-back", text: T("back"), onclick: function () { view(wrap, "home"); } }),
      h("b", { class: "gpg-ph-t gpg-ph-plus", text: T("plusH") }), h("b", { class: "gpg-ph-t gpg-ph-info", text: T("infoH") })
    ]);

    // info rows (⋯): members, code + invite
    var info = h("div", { class: "gpg-info" });
    var mem = h("button", { type: "button", class: "gpg-row", onclick: function () { main.click(); } }, [h("span", { text: T("members") }), h("small", { class: "muted", text: (g.member_count | 0) + " ›" })]);
    info.appendChild(mem);
    if (g.code) {
      var code = U.cleanCode ? U.cleanCode(g.code) : g.code;
      var cr = h("div", { class: "gpg-row gpg-code" }, [
        h("button", { type: "button", class: "gpg-code-b", "aria-label": T("code") + " " + code, onclick: function () { copy(code, function () { A.toast(T("copied"), { id: "gpg" }); }); } },
          [h("span", { text: T("code") + " " }), h("b", { class: "gpg-code-v", text: code })]),
        h("button", { type: "button", class: "btn btn-small btn-amber gpg-inv", text: T("invite"), onclick: function () { if (window.JOIN && window.JOIN.openGroup) window.JOIN.openGroup(g, false); } })
      ]);
      info.appendChild(cr);
    }

    // fold button in + (Dagen efter · Gruppen · Mer…)
    var fold = h("button", { type: "button", class: "gpg-fold", "aria-expanded": "false", onclick: function () {
      var open = !wrap.classList.contains("gpg-open"); wrap.classList.toggle("gpg-open", open); fold.setAttribute("aria-expanded", String(open));
      try { localStorage.setItem("olnu.gpgOpen", open ? "1" : "0"); } catch (e) {}
      sorted(wrap);
    } });
    try { if (localStorage.getItem("olnu.gpgOpen") === "1") { wrap.classList.add("gpg-open"); fold.setAttribute("aria-expanded", "true"); } } catch (e) {}

    [dots, now, chat, bar, ph, info, fold].forEach(function (x) { if (x) wrap.appendChild(x); });

    // module actions (groupActions) as + tiles
    actions(g).forEach(function (x, i) {
      var s = Math.max(1, Math.min(4, x.sect | 0 || 1));
      var b = h("button", { type: "button", class: "btn" }, [h("span", { class: "gpg-gl", text: (x.icon ? x.icon + " " : "") + x.label }), x.sub ? h("span", { class: "gpg-gs", text: x.sub }) : null]);
      b.addEventListener("click", function () { try { x.onClick(g, b); } catch (e) {} });
      var tile = h("div", { class: "gpg-ga", "data-gs": String(s), "data-gp": String(s), "data-ga": x.id || "" }, [b]);
      tile.style.order = String(s * 10 + 6);
      if (s >= 3) tile.setAttribute("data-gpg-fold", "1");
      wrap.appendChild(tile);
    });

    loadNow(wrap, g);
    if (chat) loadChat(wrap, g);
    var tick = 0;
    var tm = setInterval(function () {
      if (!document.body.contains(wrap)) { clearInterval(tm); return; }
      if (wrap.getAttribute("data-gv") !== "home") return;
      tick++;
      if (chat) loadChat(wrap, g);
      if (tick % 3 === 0) loadNow(wrap, g);
    }, 10000);
    // Tiles change inside (a skåltimme goes live, the chief tile fills in): re-check hot / proxies, debounced.
    if (window.MutationObserver) {
      var mt = null;
      new MutationObserver(function () {
        if (wrap.__gpgBusy) return;
        clearTimeout(mt); mt = setTimeout(function () { if (document.body.contains(wrap)) sorted(wrap); }, 120);
      }).observe(wrap, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "disabled"] });
    }
    // polish2 may have sorted already: sort again now that the parts exist
    setTimeout(function () { if (window.POLISH2 && window.POLISH2.sortGroup) window.POLISH2.sortGroup(wrap); else sorted(wrap); }, 0);
  }

  window.GPAGE = {
    init: function (api) { A = api; },
    groupItem: function (g, wrap, main) { try { build(g, wrap, main); } catch (e) { try { console.warn("olnu gpage", e); } catch (x) {} } },
    applyText: function () {},
    sorted: sorted, view: view, menuOf: menuOf, actions: actions
  };
})();
