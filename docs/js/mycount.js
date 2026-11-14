/* PintsNow — 🍺 MYCOUNT (I-102, owner 14 Nov 2026 18:19: "my friend says it's hard to see how many beers you've drunk";
   owner picked B + D from I-102-options.png). window.MYCOUNT.
   B  #pn-mine: a rail button under ⋯ Mer with tonight's count ("🍺 3"). Only while the count is > 0. Tap = 📊 Min kväll
      (NIGHTLOG.open). app-hud.js updateCounts() calls MYCOUNT.set(n) (n = all drinks tonight, the same number as Ikväll).
   D  the count burst: my ÖL! is accepted → the new number slams in at the middle of the map (ring + foam/bubble burst,
      the old number rolls away), then flies into #pn-mine and the button bumps. aria-hidden: the tap toast (with ÅNGRA)
      stays the one text answer to the tap (POPUP-RULES 1–2). Not for outbox beers, not when a 5/10/15 takeover plays.
      8+ = calm (number only, no burst). Reduced motion = a short fade, no fly.
   SAFE / store: a number only. No goal, no "next", no "more" (I-100). Store builds (OLNU_STORE): B stays (information),
   D is OFF (same policy as alive2: no drinking celebration in the store apps). */
(function () {
  "use strict";
  var W = window, D = document, PN = W.PN;
  var shown = -1, want = 0, hold = false;
  function $(id) { return D.getElementById(id); }
  function sv() { return !W.I18N || W.I18N.lang !== "en"; }
  function reduced() { try { return W.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /* ---------- B: the rail button ---------- */
  function btn() {
    var b = $("pn-mine"); if (b) return b;
    var more = $("btn-more"); if (!more || !more.parentNode) return null;
    b = D.createElement("button"); b.type = "button"; b.id = "pn-mine"; b.className = "pn-rail pn-mine"; b.hidden = true;
    b.innerHTML = '<span class="pm-e" aria-hidden="true"></span><b class="pm-n">0</b>';   // the mug is CSS (mycount.css)
    b.addEventListener("click", function () { try { if (W.NIGHTLOG && W.NIGHTLOG.open) W.NIGHTLOG.open(null); } catch (e) {} });
    more.parentNode.insertBefore(b, more.nextSibling);
    return b;
  }
  function paint(n) {
    var b = btn(); if (!b) return;
    if (n === shown) return;
    shown = n;
    b.hidden = !n;
    var t = n > 99 ? "99+" : String(n);
    b.querySelector(".pm-n").textContent = t;
    b.classList.toggle("pm-wide", t.length > 1);
    var l = sv() ? "Ikväll: " + n + " – visa min kväll" : "Tonight: " + n + " – show my night";
    b.setAttribute("aria-label", l); b.title = l;
  }
  function set(n) {
    want = Math.max(0, n | 0);
    if (!hold) paint(want);
  }

  /* ---------- D: the count burst ---------- */
  function crossed(prev, n) { return [5, 10, 15].some(function (k) { return prev < k && n >= k; }); }
  function burst(n, prev) {
    var calm = reduced() || n >= 8;
    var host = D.createElement("div");
    host.className = "pm-burst" + (calm ? " pm-calm" : "") + (reduced() ? " pm-rm" : "");
    host.setAttribute("aria-hidden", "true");
    var h = (calm ? "" : '<div class="pm-edge"></div>') + '<div class="pm-ring"></div><div class="pm-ring pm-r2"></div><div class="pm-num">' +
      (prev > 0 ? '<span class="pm-old">' + prev + "</span>" : "") + '<span class="pm-new">' + n + "</span></div>" +
      '<div class="pm-sub">' + (sv() ? "ikväll" : "tonight") + "</div>";
    if (!calm) {
      for (var i = 0; i < 22; i++) {
        var a = (i / 22) * 360 + (Math.random() * 14 - 7), d = 120 + Math.random() * 110;
        h += '<i class="pm-p" style="--a:' + a.toFixed(0) + "deg;--d:" + d.toFixed(0) + "px;--s:" + (0.8 + Math.random() * 0.8).toFixed(2) +
          ";--t:" + (i % 3) * 40 + 'ms" data-k="' + (i % 6) + '"></i>';   // the bits (mug, bubbles, sparkles) are CSS
      }
    }
    host.innerHTML = h;
    D.body.appendChild(host);
    hold = true;
    var done = false;
    function land() {
      if (done) return; done = true;
      hold = false; paint(want);
      var b = $("pn-mine");
      if (b && !reduced()) { b.classList.remove("pm-bump"); void b.offsetWidth; b.classList.add("pm-bump"); setTimeout(function () { b.classList.remove("pm-bump"); }, 700); }
      if (host.parentNode) host.parentNode.removeChild(host);
    }
    setTimeout(function () {
      var b = $("pn-mine"), num = host.querySelector(".pm-num");
      if (reduced() || !b || !num) { host.classList.add("pm-out"); setTimeout(land, 260); return; }
      if (b.hidden) { b.hidden = false; }   // first beer of the night: the button is the landing spot
      var r = b.getBoundingClientRect(), q = num.getBoundingClientRect();
      host.style.setProperty("--fx", (r.left + r.width / 2 - (q.left + q.width / 2)).toFixed(0) + "px");
      host.style.setProperty("--fy", (r.top + r.height / 2 - (q.top + q.height / 2)).toFixed(0) + "px");
      host.classList.add("pm-fly");
      setTimeout(land, 480);
    }, calm ? 900 : 1150);
    setTimeout(land, 3000);   // never stuck
    return host;
  }
  // I-104: the count + burst at the TAP (before the server answer). early(n) = the expected total; the server answer
  // (onBeerAccepted) then only confirms it (no 2nd burst). settle() after the answer: not confirmed (refused, no signal →
  // outbox, error) → the number goes back quietly.
  var early = 0, earlyPrev = 0, earlyHost = null;
  function earlyBurst(n) {
    early = 0; earlyHost = null;
    n = n | 0; if (n < 1) return;
    var prev = shown > 0 ? shown : Math.max(0, n - 1);
    earlyPrev = Math.max(0, shown);
    if (crossed(prev, n)) { early = n; want = n; if (!hold) paint(n); return; }   // 5/10/15: the takeover comes with the answer
    early = n; want = n;
    if (W.OLNU_STORE || D.querySelector(".fx-takeover,.takeover:not([hidden])")) { if (!hold) paint(n); return; }
    earlyHost = burst(n, prev);
  }
  function settle() {
    if (!early) return;
    early = 0;
    if (earlyHost && earlyHost.parentNode) earlyHost.parentNode.removeChild(earlyHost);
    earlyHost = null;
    hold = false; want = earlyPrev; paint(earlyPrev);
  }
  function onBeer(d, info) {
    info = info || {};
    if (early && !info.queued) { early = 0; earlyHost = null; return; }   // already shown at the tap
    if (info.queued || W.OLNU_STORE) return;
    var n = info.total | 0, prev = shown > 0 ? shown : Math.max(0, n - 1);
    if (n < 1 || crossed(prev, n)) return;
    if (D.querySelector(".fx-takeover,.takeover:not([hidden])")) return;
    burst(n, prev);
  }

  W.MYCOUNT = {
    set: set,
    onBeerAccepted: function (d, info) { try { onBeer(d, info); } catch (e) {} },
    early: function (n) { try { earlyBurst(n); } catch (e) {} },
    settle: function () { try { settle(); } catch (e) {} },
    _burst: function (n, prev) { burst(n | 0, prev | 0); },
    _state: function () { return { shown: shown, want: want, hold: hold }; }
  };
  if (PN && PN.mod) PN.mod("MYCOUNT");
})();
