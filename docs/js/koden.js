/* Öl Nu v27 — KVÄLLSKODEN (CONTRACT "v27 MORGONEN EFTER", migration 0053_night_code.sql).
   A Wordle-style emoji line of your night, to copy into any chat:
     "Öl Nu 18/10 🍺🍺🍺🔥 📍3 🪖1 🍻9 🏠✅"
   🍺 = drinks (1–4 one each; 5+ = 🍺🍺🍺🔥; 10+ = 🍺🍺🍺🚁) · 📍 bars · 🪖 call-outs sent/answered yes ·
   🍻 skål given + got · 💧 water · 🎖️ medals · 🏠✅ "Jag är hemma" pressed (🏠❔ not).
   No place names, no towns, no times: only counts that say nothing about where you were.
   Buttons: KODEN.button(container) is called from the morning report (after.js showBakis) and the morning paper
   sheet (gang.js renderPaper). Pure helper KODEN.text(d) for tests. No hooks needed (window.KODEN init only). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, cache = null, cacheAt = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }

  function rep(s, n) { var o = ""; for (var i = 0; i < n; i++) o += s; return o; }
  function text(d) {
    d = d || {};
    var ev = String(d.evening || "").slice(0, 10).split("-");
    var date = ev.length === 3 ? (+ev[2]) + "/" + (+ev[1]) : "";
    var head = "Öl Nu" + (date ? " " + date : "");
    var n = d.drinks | 0;
    if (!d.out && !n && !(d.checkins | 0) && !(d.bars | 0)) return head + " 🛋️ " + L("Vilokväll", "Night off");
    var parts = [];
    parts.push(n <= 0 ? "🫗" : n < 5 ? rep("🍺", n) : n < 10 ? "🍺🍺🍺🔥" : "🍺🍺🍺🚁");
    var bars = Math.max(d.bars | 0, 0);
    if (bars) parts.push("📍" + bars);
    var r = (d.rallies_sent | 0) + (d.rallies_yes | 0);
    if (r) parts.push("🪖" + r);
    var sk = d.skal != null ? d.skal | 0 : (d.skal_given | 0) + (d.skal_got | 0);
    if (sk) parts.push("🍻" + sk);
    if (d.water | 0) parts.push("💧" + (d.water | 0));
    if (d.medals | 0) parts.push("🎖️" + (d.medals | 0));
    parts.push(d.home ? "🏠✅" : "🏠❔");
    return head + " " + parts.join(" ");
  }

  function call() {
    if (!A || !A.LIVE || off) return Promise.resolve(null);
    if (cache && Date.now() - cacheAt < 60000) return Promise.resolve(cache);
    return A.rpc("my_night_code", { p_last: true }).then(function (r) {
      if (r.error) { if (U.missing(r.error)) off = true; return null; }
      cache = A.parseData(r.data); cacheAt = Date.now(); return cache;
    });
  }
  // Own clipboard call (for the funny toast); falls back to the app's copyText (it toasts by itself).
  function copy(s) {
    var fb = function () { try { if (A && A.copyText) A.copyText(s); } catch (e) {} return Promise.reject(new Error("fallback")); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).then(null, fb); } catch (e) {}
    return fb();
  }
  var COPIED = ["📋 Kvällskoden ä kopierad. Klistra in i chatten!", "📋 Kopierat! Nu kan gänget gissa resten.", "📋 Koden ä i urklippet. Skicka till truppen."];
  function button(container, opts) {
    if (!A || !A.LIVE || off || !container || container.querySelector(".kd-btn")) return null;
    opts = opts || {};
    var b = A.btn(L("🟨 Kvällskoden", "🟨 Night code"), "btn-small kd-btn", function () { show(); });
    b.setAttribute("aria-label", L("Kopiera kvällskoden – en emojirad om kvällen utan platser", "Copy the night code – an emoji line without places"));
    container.appendChild(b);
    var box = null;
    function show() {
      b.disabled = true;
      call().then(function (d) {
        b.disabled = false;
        if (!d) { A.toast(L("Kvällskoden gick int' att hämta.", "Could not get the night code."), { err: true }); return; }
        var s = text(d);
        if (!box) {
          box = A.el("div", { class: "kd-box", role: "group", "aria-label": L("Kvällskoden", "Night code") });
          var after = opts.below || container;
          if (after.parentNode && after !== container) after.parentNode.insertBefore(box, after.nextSibling); else container.parentNode.insertBefore(box, container.nextSibling);
        }
        box.innerHTML = "";
        var codeEl = A.el("div", { class: "kd-code", "aria-label": s });
        // Each emoji + number stays on one line when the text wraps (the copied text is the plain line).
        s.split(" ").forEach(function (tk, i) { if (i) codeEl.appendChild(document.createTextNode(" ")); codeEl.appendChild(A.el("span", { class: "kd-tk", text: tk })); });
        box.appendChild(codeEl);
        box.appendChild(A.el("div", { class: "kd-note muted", text: L("Inga platser, inga tider – bara kvällen i emojis.", "No places, no times – just the night in emojis.") }));
        var row = A.el("div", { class: "row kd-row" });
        row.appendChild(A.btn(L("📋 Kopiera", "📋 Copy"), "btn-small btn-amber", function () {
          copy(s).then(function () { A.toast(COPIED[Math.floor(Math.random() * COPIED.length)], { ms: 2600 }); }, function () {});
        }));
        if (navigator.share) row.appendChild(A.btn(L("↗️ Dela", "↗️ Share"), "btn-small", function () {
          try { navigator.share({ text: s }).catch(function () {}); } catch (e) {}
        }));
        box.appendChild(row);
        copy(s).then(function () { A.toast(COPIED[Math.floor(Math.random() * COPIED.length)], { ms: 2600 }); }, function () {});
      });
    }
    return b;
  }

  window.KODEN = {
    text: text, button: button,
    init: function (api) { A = api; },
    onBeerAccepted: function () { cache = null; }
  };
})();
