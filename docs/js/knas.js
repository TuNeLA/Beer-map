/* PintsNow — "Något knas?" (X6, lane main, 10 Nov). One tap from the ⋯ menu (Mer på kartan) or Inställningar → Om appen:
   a picture of the screen you came from, the last 200 log lines and the beta id go to the owner (table "feedback", 0410).
     - log: a ring of the last 200 lines from this start: console warn / error / info / log, page errors, failed promises,
       RPC calls (name, ms, ok; never the arguments) and screen changes. Text only, 200 chars a line.
     - picture: the open sheet closes first, then html2canvas (cdnjs, loaded on demand) copies the page; the Mapbox canvas is
       read in its own render frame and put into the copy. Small JPEG (≤ 480 px wide). No picture when it fails / offline.
     - the user sees the picture and can switch picture and log off before "Skicka"; the text is needed (3+ characters).
     - max 5 per day: the server says slow_down (0410 submit_knas); the phone also counts, so the 6th try says it at once.
     - before 0410 runs (old server): the text goes through submit_feedback (0215, kind bug) without picture and log.
   Copy: DIALEKT keys "knas.*" (sv-neutral). Styles: pnds.css "lane:main" (.mn-knas). Loaded right after pnlog.js so the log
   starts early. Public: window.KNAS = { open(from), moreRow(), settingsRow(), lines(), _shot() }. */
(function () {
  "use strict";
  var P = {
    "knas.title": "Något knas?", "knas.row": "Något knas?", "knas.rowSub": "Skicka en skärmbild och loggen till oss",
    "knas.lead": "Berätta vad som hände. Vi får skärmbilden och loggen, så hittar vi felet snabbare.",
    "knas.what": "Vad hände?", "knas.ph": "T.ex. Checka in gjorde inget på Pitchers.",
    "knas.shot": "Skicka med skärmbilden", "knas.log": "Skicka med loggen",
    "knas.noshot": "Ingen skärmbild den här gången.", "knas.send": "Skicka", "knas.short": "Skriv vad som hände.",
    "knas.thanks": "Tack! Vi kollar på det.", "knas.limit": "Max 5 om dagen. Tack för hjälpen, soldat!", "knas.fail": "Det gick int' att skicka. Försök igen.",
    "knas.taking": "Tar en bild av skärmen …", "knas.left": "{n} kvar idag"
  };
  try { if (window.DIALEKT && window.DIALEKT.register) window.DIALEKT.register("sv-neutral", P); } catch (e) {}
  function T(k, v) { try { if (window.DIALEKT && window.DIALEKT.t) return window.DIALEKT.t(k, v || {}, P[k]); } catch (e) {} return String(P[k] || k).replace(/\{(\w+)\}/g, function (m, n) { return v && v[n] != null ? v[n] : ""; }); }
  var H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  var H2C_SRI = "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H";   // A17
  var MAX = 200, LOG = [], t0 = Date.now(), DAY = "olnu.knasDay";

  /* ---------- the log ring (from the start of this page) ---------- */
  function str(x) { try { if (x instanceof Error) return x.name + ": " + x.message; if (typeof x === "object") return JSON.stringify(x); return String(x); } catch (e) { return "?"; } }
  function add(kind, txt) {
    var s = ((Date.now() - t0) / 1000).toFixed(1);
    LOG.push("+" + s + "s " + kind + " " + String(txt).replace(/\s+/g, " ").slice(0, 200));
    if (LOG.length > MAX) LOG.splice(0, LOG.length - MAX);
  }
  ["error", "warn", "info", "log"].forEach(function (k) {
    var c = window.console && console[k]; if (typeof c !== "function") return;
    console[k] = function () { try { add(k, [].slice.call(arguments).map(str).join(" ")); } catch (e) {} return c.apply(console, arguments); };
  });
  window.addEventListener("error", function (e) { add("pageerror", (e && e.message || "") + (e && e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno : "")); });
  window.addEventListener("unhandledrejection", function (e) { add("reject", str(e && e.reason)); });
  var hooked = false, lastScr = "";
  function hook() {
    if (hooked || !window.PNLOG || !window.PNLOG.onRpc) return;
    hooked = true;
    window.PNLOG.onRpc(function (fn, params, d, ok, ms) { add("rpc", fn + " " + (ok ? "ok" : "FEL") + " " + Math.round(ms || 0) + "ms"); });
  }
  setInterval(function () {
    hook();
    try { var s = window.PNLOG && window.PNLOG.screen ? window.PNLOG.screen() : ""; if (s && s !== lastScr) { lastScr = s; add("screen", s); } } catch (e) {}
  }, 1000);
  add("start", location.pathname + (location.search ? " ?" + location.search.slice(1, 60) : ""));

  /* ---------- helpers ---------- */
  function api() { try { var D = window.PNDS; return D && D._A ? D._A() : null; } catch (e) { return null; } }
  function ic(n, c) { try { return window.PNI ? window.PNI.svg(n, c || "") : ""; } catch (e) { return ""; } }
  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function dayKey() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function sent() { try { var o = JSON.parse(localStorage.getItem(DAY) || "null"); return o && o.k === dayKey() ? o.n | 0 : 0; } catch (e) { return 0; } }
  function count() { try { localStorage.setItem(DAY, JSON.stringify({ k: dayKey(), n: sent() + 1 })); } catch (e) {} }
  function beta() { try { return window.KANAL && window.KANAL.sha ? window.KANAL.sha() || "" : ""; } catch (e) { return ""; } }
  function ver() { try { var s = [].slice.call(document.scripts).map(function (x) { return x.src || ""; }).filter(function (x) { return /app\.js/.test(x); })[0]; return (/[?&]v=([^&]+)/.exec(s || "") || [])[1] || ""; } catch (e) { return ""; } }
  function standalone() { try { return !!(window.U && window.U.isStandalone && window.U.isStandalone()); } catch (e) { return false; } }
  function sheetOpen() { var s = document.getElementById("sheet"); return !!(s && !s.hidden); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = H2C; s.async = true; s.crossOrigin = "anonymous"; s.integrity = H2C_SRI;
      s.onload = function () { window.html2canvas ? res(window.html2canvas) : rej(new Error("no html2canvas")); };
      s.onerror = function () { s.remove(); rej(new Error("load html2canvas")); };
      document.head.appendChild(s);
    });
  }
  // the Mapbox GL canvas is only readable inside its own render frame (no preserveDrawingBuffer): grab it there
  function glFrame() {
    return new Promise(function (res) {
      var g = null; try { var m = (api() || {}).map; g = m && m.getMapboxMap ? m.getMapboxMap() : null; } catch (e) {}
      if (!g || !g.getCanvas) { res(null); return; }
      var done = false, fin = function (v) { if (!done) { done = true; res(v); } };
      try { g.once("render", function () { try { fin(g.getCanvas().toDataURL("image/jpeg", 0.7)); } catch (e) { fin(null); } }); g.triggerRepaint(); } catch (e) { fin(null); }
      setTimeout(function () { fin(null); }, 1200);
    });
  }
  function shot() {
    var w = Math.min(480, innerWidth), scale = w / innerWidth;
    return Promise.all([loadH2C(), glFrame()]).then(function (r) {
      var h2c = r[0], gl = r[1];
      return h2c(document.body, { backgroundColor: "#0a0f1c", scale: scale, useCORS: true, logging: false, width: innerWidth, height: innerHeight,
        x: window.scrollX, y: window.scrollY, windowWidth: innerWidth, windowHeight: innerHeight,
        ignoreElements: function (el) { return el.id === "toasts" || el.classList && (el.classList.contains("mn-knas-skip")); },
        onclone: function (doc) {
          if (!gl) return;
          [].forEach.call(doc.querySelectorAll(".mapboxgl-canvas"), function (c) { var img = doc.createElement("img"); img.src = gl; img.style.cssText = c.style.cssText; img.width = c.width; img.height = c.height; img.className = c.className; c.parentNode.replaceChild(img, c); });
        } });
    }).then(function (cv) {
      var q = 0.6, url = cv.toDataURL("image/jpeg", q);
      while (url.length > 400000 && q > 0.25) { q -= 0.15; url = cv.toDataURL("image/jpeg", q); }
      return /^data:image\/jpeg;base64,/.test(url) && url.length <= 600000 ? url : null;
    }).catch(function (e) { add("knas", "no shot: " + str(e)); return null; });
  }
  function meta(from) {
    var scr = ""; try { scr = window.PNLOG && window.PNLOG.screen ? window.PNLOG.screen() : ""; } catch (e) {}
    return { v: ver(), beta: beta(), ua: navigator.userAgent.slice(0, 200), screen: String(scr || "").slice(0, 60), w: String(innerWidth), h: String(innerHeight),
      standalone: String(standalone()), from: from || "", net: navigator.onLine === false ? "off" : ((navigator.connection || {}).effectiveType || "") };
  }

  /* ---------- the sheet ---------- */
  var busy = false;
  function open(from) {
    var A = api(); if (!A || !A.openSheet || busy) return;
    if (sent() >= 5) { A.toast(T("knas.limit"), { id: "mn-knas" }); return; }
    busy = true;
    var go = function () {
      A.toast(T("knas.taking"), { id: "mn-knas", ms: 1500 });
      return wait(120).then(shot).then(function (url) { busy = false; A.toastClear && A.toastClear("mn-knas"); sheet(url, from || ""); });
    };
    if (sheetOpen()) { try { A.closeSheet(); } catch (e) {} wait(380).then(go); } else go();
  }
  function sw(label, on) {
    var b = h("button", "ds-row mn-knas-sw"); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on));
    var t = h("span", "ds-row-t"); t.appendChild(h("span", null, label)); b.appendChild(t);
    var s = h("span", "switch"); s.setAttribute("aria-hidden", "true"); s.setAttribute("aria-checked", String(on)); b.appendChild(s);
    b.addEventListener("click", function () { var v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); s.setAttribute("aria-checked", String(v)); });
    return b;
  }
  function sheet(url, from) {
    var A = api(); if (!A) return;
    var lines = LOG.slice(-MAX), m = meta(from);
    A.openSheet(T("knas.title"), function (body) {
      body.classList.add("mn-knas");
      body.appendChild(h("p", "mn-knas-lead", T("knas.lead")));
      body.appendChild(h("label", "fld mn-knas-l", T("knas.what"))).setAttribute("for", "mn-knas-ta");
      var ta = h("textarea", "inp pn-ta mn-knas-ta"); ta.id = "mn-knas-ta"; ta.rows = 4; ta.maxLength = 1000; ta.placeholder = T("knas.ph");
      body.appendChild(ta);
      var card = h("div", "mn-knas-card");
      if (url) { var im = h("img", "mn-knas-img"); im.src = url; im.alt = "Skärmbild"; card.appendChild(im); }
      else card.appendChild(h("p", "mn-knas-none", T("knas.noshot")));
      var opts = h("div", "mn-knas-opts");
      var s1 = url ? sw(T("knas.shot"), true) : null, s2 = sw(T("knas.log"), true);
      if (s1) opts.appendChild(s1); opts.appendChild(s2);
      card.appendChild(opts); body.appendChild(card);
      body.appendChild(h("p", "mn-knas-meta", ["Version " + (m.v || "–"), m.beta ? "beta " + m.beta : "", lines.length + " loggrader"].filter(Boolean).join(" · ")));
      var b = h("button", "ds-btn ds-btn-primary ds-btn-block mn-knas-go", T("knas.send")); b.type = "button";
      b.addEventListener("click", function () {
        var t = String(ta.value || "").trim();
        if (t.length < 3) { A.toast(T("knas.short"), { err: true, id: "mn-knas" }); try { ta.focus(); } catch (e) {} return; }
        if (sent() >= 5) { A.toast(T("knas.limit"), { id: "mn-knas" }); return; }
        b.disabled = true;
        var withShot = !!(s1 && s1.getAttribute("aria-checked") === "true"), withLog = s2.getAttribute("aria-checked") === "true";
        A.rpc("submit_knas", { p_text: t, p_shot: withShot ? url : null, p_logs: withLog ? lines : [], p_meta: m }).then(function (r) {
          var e = r && r.error, code = e ? String(e.code || "") + " " + String(e.message || "") : "";
          if (e && /PGRST202|42883|not find|does not exist/i.test(code)) {   // 0410 not run yet: the old feedback path, text only
            return A.rpc("submit_feedback", { p_kind: "bug", p_text: (m.beta ? "[beta " + m.beta + "] " : "") + "[knas] " + t, p_meta: { v: m.v, ua: m.ua, screen: m.screen, w: m.w, h: m.h, standalone: m.standalone } });
          }
          return r;
        }).then(function (r) {
          b.disabled = false;
          var e = r && r.error;
          if (e && /slow_down/.test(String(e.message || ""))) { try { localStorage.setItem(DAY, JSON.stringify({ k: dayKey(), n: 5 })); } catch (x) {} A.toast(T("knas.limit"), { id: "mn-knas" }); A.closeSheet(); return; }
          if (e) { A.toast(T("knas.fail"), { err: true, id: "mn-knas" }); return; }
          count(); A.closeSheet(); A.toast(T("knas.thanks"), { id: "mn-knas", ms: 3500 });
        });
      });
      body.appendChild(b);
      var left = 5 - sent(); if (left < 5) body.appendChild(h("p", "mn-knas-left", T("knas.left", { n: left })));
    });
  }

  /* ---------- the entries ---------- */
  function row(cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = "ds-row pn-row " + cls;
    b.innerHTML = '<span class="ds-row-i" aria-hidden="true">' + ic("bug") + '</span><span class="ds-row-t"><span></span><small></small></span><span class="ds-chev" aria-hidden="true"></span>';
    b.querySelector(".ds-row-t > span").textContent = T("knas.row"); b.querySelector(".ds-row-t > small").textContent = T("knas.rowSub");
    return b;
  }
  function moreRow() { var b = row("mn-knas-more"); b.addEventListener("click", function () { open("mer"); }); return b; }
  function settingsRow() { var b = row("mn-knas-row"); b.addEventListener("click", function () { open("installningar"); }); return b; }
  window.KNAS = { open: open, moreRow: moreRow, settingsRow: settingsRow, lines: function () { return LOG.slice(); }, _shot: shot };
})();
