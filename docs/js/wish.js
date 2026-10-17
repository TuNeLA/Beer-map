/* Öl Nu v23 — 💡 ÖNSKA EN FEATURE (CONTRACT "v23 ÖNSKELISTAN + GRUPPDUELLEN", migration 0031).
   window.WISH, called through app.js mods(): init, settingsSheet, topSheet, hudChipsHTML, hudClick.
   Sheet: free text (max 500), optional category chips, optional name, and the most-wished list with
   "👍 Jag vill också" (+1 toggle). Server: submit_wish, vote_wish, top_wishes. A missing RPC (old database)
   = the whole feature hides quietly. Styles: docs/duel.css (section "Önska"). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var off = false;                  // top_wishes/submit_wish missing on this server
  var HUD_ALWAYS = true;            // the "💡 Önska" chip in the Ikväll panel (false = only when the panel already shows)
  var SEEN_KEY = "olnu.wishSeen";
  var CATS = ["kartan", "grupper", "chatt", "lek", "texter", "annat"];

  function sv() { return !I || I.lang !== "en"; }
  var S = {
    sv: {
      btn: "💡 Önska en feature", chip: "💡 Önska", chipAria: "Önska en ny funktion", title: "💡 Önska en feature",
      intro: "Vad saknar du i Öl Nu? Skriv det här. Ägaren läser allt och bygger det som flest vill ha.",
      label: "Din önskan", ph: "T.ex. \"Ett läge där man ser vilka krogar som har uteservering\"",
      cat: "Vad gäller det? (valfritt)", cats: { kartan: "🗺️ Kartan", grupper: "👥 Grupper", chatt: "💬 Chatt", lek: "🎲 Lek", texter: "✍️ Texter", annat: "✨ Annat" },
      showName: "Visa mitt namn ({0})", send: "💡 Skicka önskan", top: "🔥 Mest önskat", empty: "Inga önskningar än. Bli först!",
      me2: "👍 Jag vill också", me2on: "👍 Du vill också", mine: "din", left: "Du kan skicka {0} till idag.", noneLeft: "Max 5 önskningar per dag. Kom tillbaka imorgon!",
      need: "Skriv minst 3 tecken.", load: "Kunde int’ hämta listan.", fail: "Nåt gick fel. Försök igen.",
      status: { ny: "", planerad: "📌 Planerad", byggs: "🔨 Byggs", klar: "✅ Klar", nej: "🚫 Blir int’", dold: "🙈 Dold" },
      dup: "Nån har redan önskat samma sak – din röst ä tillagd! 👍",
      voteOn: ["👍 Noterat! En röst till.", "👍 Röst lagd. Stark i flocken.", "👍 Ni blir fler. Ägaren ser det.", "👍 Plus ett, dä!", "👍 Räknat och klart."],
      voteOff: ["Rösten ä borttagen.", "Okej, du ångrade dig. Inga problem."],
      errs: { invalid_wish: "Skriv 3–500 tecken. Inga länkar.", invalid_category: "Välj en av kategorierna.", slow_down: "Lugn i stormen! Max 5 önskningar per dag, och vänta en stund mellan.",
        wish_not_found: "Önskan finns int’ längre.", not_authenticated: "Du ä int’ inloggad än. Försök igen om en stund." }
    },
    en: {
      btn: "💡 Wish for a feature", chip: "💡 Wish", chipAria: "Wish for a new feature", title: "💡 Wish for a feature",
      intro: "What is missing in Öl Nu? Write it here. The owner reads everything and builds what most people want.",
      label: "Your wish", ph: "E.g. \"Show which bars have outdoor seating\"",
      cat: "What is it about? (optional)", cats: { kartan: "🗺️ Map", grupper: "👥 Groups", chatt: "💬 Chat", lek: "🎲 Games", texter: "✍️ Texts", annat: "✨ Other" },
      showName: "Show my name ({0})", send: "💡 Send wish", top: "🔥 Most wanted", empty: "No wishes yet. Be the first!",
      me2: "👍 Me too", me2on: "👍 You too", mine: "yours", left: "You can send {0} more today.", noneLeft: "Max 5 wishes per day. Come back tomorrow!",
      need: "Write at least 3 characters.", load: "Could not load the list.", fail: "Something went wrong. Try again.",
      status: { ny: "", planerad: "📌 Planned", byggs: "🔨 Building", klar: "✅ Done", nej: "🚫 Not planned", dold: "🙈 Hidden" },
      dup: "Someone already wished for that – your vote is added! 👍",
      voteOn: ["👍 Noted! One more vote.", "👍 Vote added."], voteOff: ["Vote removed."],
      errs: { invalid_wish: "Write 3–500 characters. No links.", invalid_category: "Pick one of the categories.", slow_down: "Easy! Max 5 wishes per day.",
        wish_not_found: "That wish is gone.", not_authenticated: "Not signed in yet. Try again soon." }
    }
  };
  // Thank-you toasts (dalmål: "ä" for "är"/"é"). Never the same as last time.
  var THANKS_SV = [
    "💡 Tack ska du ha! Önskan ä inskickad till högkvarteret.",
    "🪖 Önskan mottagen, soldat. Generalen läser den vid morgonsamlingen.",
    "📨 Skickat! Nu ligger den i ägarens ryggsäck.",
    "🙌 Tack! Sånt här ä guld värt för oss.",
    "💡 Bra tänkt, dä! Den hamnar på listan.",
    "🦉 Klok önskan. Ugglan i Ludvika nickar gillande.",
    "🛠️ Inskickat. Verktygslådan ä redan framme.",
    "📯 Önskan ä framblåst till hela staben!",
    "🍻 Tack! Om den blir av så bjuder vi på en skål (i appen).",
    "🗺️ Noterat på kartan över framtiden.",
    "🎖️ Tack för insatsen! Du ä nu officiell idéofficer.",
    "📬 Pling! Ägaren fick precis brev från dig.",
    "🚀 Uppskickad. Den svävar nu mot bygglistan.",
    "🧠 Smart. Hjärnan i Dalarna jobbar visst ikväll.",
    "💌 Tack! Vi läser allt, även det som ä skrivet efter tolv.",
    "🌲 Inskickat från skogen till skärmen. Tack!",
    "🪵 En ny planka i bygget. Tack ska du ha!",
    "🫡 Mottaget och kvitterat. Stå lätt.",
    "🐎 Önskan rider nu i galopp mot ägaren.",
    "✨ Tack! Fler röster = snabbare bygge. Tipsa gänget!"
  ];
  var THANKS_EN = ["💡 Thanks! Your wish is sent.", "📨 Sent! The owner reads everything.", "🙌 Thank you – great idea.", "🫡 Received. At ease."];

  function T(k) { var o = sv() ? S.sv : S.en; return o[k] != null ? o[k] : S.sv[k]; }
  function F(s) { var a = arguments; return String(s).replace(/\{(\d)\}/g, function (m, i) { return a[+i + 1] != null ? a[+i + 1] : ""; }); }
  function pick(list, key) {
    var last = +U.ls.get(key, "-1"), i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === last) i = (i + 1) % list.length;
    U.ls.set(key, String(i));
    return list[i];
  }
  function errText(err) {
    var m = String((err && (err.message || err.details)) || "");
    var e = T("errs");
    for (var k in e) if (m.indexOf(k) >= 0) return e[k];
    return T("fail");
  }
  function call(name, params) {
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off = true; }
      return r;
    });
  }
  function el(tag, attrs, kids) {
    var n = A.el(tag, attrs);
    (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  function ready() { return A && A.LIVE && !off && A.authed && A.authed(); }

  /* ---------- Sheet ---------- */
  function openWish() {
    if (!ready()) return;
    var cat = null;
    A.openSheet(T("title"), function (body) {
      var root = el("div", { class: "ws" });
      root.appendChild(el("p", { class: "ws-intro", text: T("intro") }));
      var ta = el("textarea", { class: "inp ws-ta", id: "ws-ta", maxlength: "500", rows: "3", placeholder: T("ph") });
      var cnt = el("span", { class: "ws-cnt", text: "0/500" });
      ta.addEventListener("input", function () { cnt.textContent = (ta.value || "").length + "/500"; });
      root.appendChild(el("label", { class: "ws-l", for: "ws-ta", text: T("label") }));
      root.appendChild(ta); root.appendChild(cnt);
      root.appendChild(el("div", { class: "ws-l", text: T("cat") }));
      var chips = el("div", { class: "ws-chips", role: "group", "aria-label": T("cat") });
      CATS.forEach(function (c) {
        var b = el("button", { type: "button", class: "ws-chip", "data-cat": c, "aria-pressed": "false", text: T("cats")[c] });
        b.addEventListener("click", function () {
          cat = cat === c ? null : c;
          chips.querySelectorAll(".ws-chip").forEach(function (x) {
            var on = x.getAttribute("data-cat") === cat; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on));
          });
        });
        chips.appendChild(b);
      });
      root.appendChild(chips);
      var name = A.getName ? A.getName() : "";
      var nameBox = null;
      if (name) {
        nameBox = el("input", { type: "checkbox", id: "ws-name" });
        root.appendChild(el("label", { class: "ws-name", for: "ws-name" }, [nameBox, " " + F(T("showName"), name)]));
      }
      var send = el("button", { type: "button", class: "btn btn-amber btn-block ws-send", text: T("send") });
      var leftNote = el("p", { class: "ws-left", text: "" });
      send.addEventListener("click", function () {
        var txt = (ta.value || "").trim();
        if (txt.length < 3) { A.toast(T("need"), { err: true }); ta.focus(); return; }
        send.disabled = true;
        call("submit_wish", { p_text: txt, p_category: cat, p_name: nameBox && nameBox.checked ? name : null }).then(function (r) {
          send.disabled = false;
          if (r.error) { A.toast(off ? T("fail") : errText(r.error), { err: true }); return; }
          var d = A.parseData(r.data);
          ta.value = ""; cnt.textContent = "0/500";
          A.toast(d.dup ? T("dup") : sv() ? pick(THANKS_SV, "olnu.wishThx") : pick(THANKS_EN, "olnu.wishThx"), { ms: 5000 });
          leftNote.textContent = (d.left_today | 0) > 0 ? F(T("left"), d.left_today | 0) : T("noneLeft");
          U.ls.set(SEEN_KEY, String(Date.now()));
          loadList(list);
        });
      });
      root.appendChild(send); root.appendChild(leftNote);
      root.appendChild(el("h3", { class: "ws-h", text: T("top") }));
      var list = el("ol", { class: "ws-list", "aria-live": "polite" });
      root.appendChild(list);
      body.appendChild(root);
      loadList(list);
    });
  }
  function loadList(list) {
    list.textContent = "";
    list.appendChild(el("li", { class: "ws-muted", text: "…" }));
    call("top_wishes", { p_limit: 30 }).then(function (r) {
      list.textContent = "";
      if (r.error) { list.appendChild(el("li", { class: "ws-muted", text: T("load") })); return; }
      var rows = Array.isArray(r.data) ? r.data : [];
      if (!rows.length) { list.appendChild(el("li", { class: "ws-muted", text: T("empty") })); return; }
      rows.forEach(function (w) { list.appendChild(row(w)); });
    });
  }
  function row(w) {
    var li = el("li", { class: "ws-item" + (w.is_mine ? " mine" : "") });
    var meta = [];
    if (w.category && T("cats")[w.category]) meta.push(T("cats")[w.category]);
    if (w.name) meta.push(w.name);
    if (w.is_mine) meta.push(T("mine"));
    var st = T("status")[w.status] || "";
    li.appendChild(el("div", { class: "ws-body", text: w.body }));
    var foot = el("div", { class: "ws-foot" });
    foot.appendChild(el("span", { class: "ws-meta", text: (st ? st + " · " : "") + meta.join(" · ") }));
    var b = el("button", { type: "button", class: "ws-vote" + (w.mine ? " on" : ""), "aria-pressed": String(!!w.mine) });
    function paint(n, on) {
      b.textContent = (on ? T("me2on") : T("me2")) + " · " + (n | 0);
      b.classList.toggle("on", !!on); b.setAttribute("aria-pressed", String(!!on));
    }
    paint(w.votes, w.mine);
    b.addEventListener("click", function () {
      b.disabled = true;
      call("vote_wish", { p_wish_id: w.id }).then(function (r) {
        b.disabled = false;
        if (r.error) { A.toast(errText(r.error), { err: true }); return; }
        var d = A.parseData(r.data);
        paint(d.votes, d.mine);
        A.toast(d.mine ? pick(T("voteOn"), "olnu.wishVo") : pick(T("voteOff"), "olnu.wishVf"), { ms: 2500 });
      });
    });
    foot.appendChild(b);
    li.appendChild(foot);
    return li;
  }

  function entryButton(extraCls) {
    return el("button", { type: "button", class: "btn btn-block ws-entry " + (extraCls || ""), text: T("btn"), onclick: openWish });
  }

  window.WISH = {
    open: openWish,
    _thanks: THANKS_SV,
    init: function (api) { A = api; },
    settingsSheet: function (body) {
      if (!ready()) return;
      body.appendChild(el("h3", { text: T("btn") }));
      body.appendChild(entryButton("ws-entry-set"));
    },
    topSheet: function (body) {
      if (!ready()) return;
      body.appendChild(el("div", { class: "ws-topfoot" }, [entryButton("btn-small")]));
    },
    hudChipsHTML: function (ctx) {
      if (!ready()) return "";
      if (!HUD_ALWAYS && !(ctx && ctx.n > 0)) return "";
      return '<button type="button" class="hx-chip ws-hchip" data-hx="wish" aria-label="' + U.esc(T("chipAria")) + '">' + U.esc(T("chip")) + "</button>";
    },
    hudClick: function (action) { if (action === "wish") openWish(); }
  };
})();
