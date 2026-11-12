/* PintsNow seasonal themes (I-46). Lazy module (text/x-lazy), runs after the map is ready. One small engine, one JSON per theme (docs/themes/).
   One theme at a time (highest priority). Date windows are computed in Europe/Stockholm (Easter and 1st Advent are calculated, not stored).
   A theme may only set: allow-listed colour tokens, its own CSS (every rule under [data-theme="id"]), <= 12 decorative sprites in ONE
   pointer-events:none layer, one decoration on the OL! button, ticker lines (theme.<id>.tick, read through DIALEKT.t). No sound, no map API.
   Any error = no theme (data-theme removed, layer removed). Off: Installningar "Sasongstema" (localStorage pn_theme_off=1).
   Debug: ?theme=jul previews (also with the switch off); ?theme=off forces none. Public: PN.themes = { settingsRow(), active(), ... }. */
(function () {
  "use strict";
  var PN = window.PN, W = window, D = W.document, TZ = "Europe/Stockholm", LS = "pn_theme_off", cur = null, seq = 0, warned = 0, css, layer, hat, rows = [];
  var KEYS = ["id", "name", "tokens", "css", "sprites", "count", "btn", "tick"];
  var BASE = ".pn-th-layer{position:fixed;inset:0;z-index:449;pointer-events:none;overflow:hidden}" +
    ".pn-th-s{position:absolute;left:var(--l);top:calc(var(--y)*1%);width:var(--w);opacity:.55;will-change:transform;animation:pnThF var(--t) ease-in-out var(--d) infinite alternate}" +
    ".pn-th-s>svg{display:block;width:100%;height:auto}" +
    ".pn-th-hat{position:absolute;left:6px;top:-2px;width:44px;height:40px;pointer-events:none;z-index:5}" +
    "@keyframes pnThF{to{transform:translate3d(var(--x),22px,0) rotate(40deg)}}" +
    "@keyframes pnThFall{from{transform:translate3d(0,-8vh,0)}to{transform:translate3d(var(--x),108vh,0)}}" +
    ".pn-th-p .pn-th-s{animation-play-state:paused}" +
    "@media (prefers-reduced-motion:reduce){.pn-th-s{animation:none!important;top:calc(var(--y)*1%)!important}}";

  /* ---- dates (pure) ---- */
  function dn(y, m, d) { return Date.UTC(y, m - 1, d) / 864e5; }
  function easter(y) {
    var a = y % 19, b = (y / 100) | 0, c = y % 100, d = (b / 4) | 0, f = ((b + 8) / 25) | 0, g = ((b - f + 1) / 3) | 0, h = (19 * a + b - d - g + 15) % 30,
      k = c % 4, l = (32 + 2 * (b % 4) + 2 * ((c / 4) | 0) - h - k) % 7, m = ((a + 11 * h + 22 * l) / 451) | 0, t = h + l - 7 * m + 114;
    return dn(y, (t / 31) | 0, t % 31 + 1);
  }
  function advent1(y) { return dn(y, 12, 24) - new Date(Date.UTC(y, 11, 24)).getUTCDay() - 21; }   // 4th Sunday before 25 Dec = the Sunday on or before 24 Dec, minus 3 weeks
  // "MM-DD" | "advent1[+-n]" | "easter[+-n]"  ->  day number of year y
  function at(s, y) {
    var m = /^(\d\d)-(\d\d)$/.exec(s); if (m) return dn(y, +m[1], +m[2]);
    m = /^(advent1|easter)([+-]\d+)?$/.exec(s); if (!m) throw new Error("bad date rule");
    return (m[1] === "easter" ? easter(y) : advent1(y)) + (m[2] ? +m[2] : 0);
  }
  function iso(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  function sto(ms) {   // the Stockholm calendar day of a moment: [y, m, d]
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms).split("-").map(Number);
  }
  function night(ms) { return sto((ms == null ? Date.now() : ms) - 5 * 36e5).join("-"); }   // 05:00 night rule, like DIALEKT
  // list = [{id, from, to, p}]; the active entry with the highest p wins, a tie goes to the later start
  function pick(list, ms) {
    var t = sto(ms == null ? Date.now() : ms), today = dn(t[0], t[1], t[2]), best = null;
    list.forEach(function (e) {
      for (var y = t[0] - 1; y <= t[0]; y++) {
        var a = at(e.from, y), b = at(e.to, y); if (b < a) b = at(e.to, y + 1);
        if (today >= a && today <= b && (!best || e.p > best.p || (e.p === best.p && a > best.a))) best = { id: e.id, p: e.p, a: a };
      }
    });
    return best && best.id;
  }

  /* ---- theme file check: unknown keys, tokens and risky CSS are refused ---- */
  function lum(h) { var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function ok(j, bg) {
    if (!j || typeof j !== "object" || !/^[a-z]{2,12}$/.test(j.id || "")) return false;
    if (Object.keys(j).some(function (k) { return KEYS.indexOf(k) < 0; })) return false;
    var t = j.tokens || {}, s = JSON.stringify(j.sprites || []) + (j.btn || "");
    if (Object.keys(t).some(function (k) { return !/^--(pn-theme-[a-z0-9-]+|ds-amber-t)$/.test(k) || !/^#[0-9a-f]{6}$/i.test(t[k]); })) return false;
    if (t["--ds-amber-t"] && ratio(t["--ds-amber-t"], bg || "#0a0f1c") < 4.5) return false;   // text colour: keep 4.5:1
    if (/@import|javascript:|expression\(|url\(\s*["']?https?:|<script|\son\w+\s*=|href\s*=/i.test((j.css || "") + s)) return false;
    return !(j.count > 12 || (j.sprites && !Array.isArray(j.sprites)));
  }

  /* ---- apply / clear ---- */
  function lang() { return W.I18N && W.I18N.lang === "en" ? "en" : "sv"; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mix(out) {   // ticker: about 30 % of the slots, never 2 theme lines within 3 slots, a real event or a quiet line stays
    var j = cur.j, n = night(), key = "theme." + j.id + ".tick", L = (j.tick && (j.tick[lang()] || j.tick.sv)) || [], hit = 0, last = -9;
    if (!L.length) return out;
    function line(i) { var T = W.DIALEKT; return { text: T && T.t ? T.t(key, { _seed: i }, L) : L[hash(n + i) % L.length], cls: "tk-theme", k: "theme." + j.id }; }
    var r = out.map(function (x, i) {
      if (/tk-real|tk-quiet/.test(x.cls || "") || i - last < 3 || hash(j.id + n + i) % 100 >= 30) return x;
      last = i; hit++; return line(i);
    });
    if (!hit && r.length > 3) { var i = hash(j.id + n) % r.length; if (!/tk-real|tk-quiet/.test(r[i].cls || "")) r[i] = line(i); }
    return r;
  }
  function wrapNews() {
    var N = W.NEWS; if (!N || !N.build || N.__th) return; var b0 = N.build; N.__th = 1;
    N.build = function (beers, ctx) { var o = b0.call(N, beers, ctx); try { return cur ? mix(o) : o; } catch (e) { return o; } };
  }
  function sprites(j) {
    var n = Math.min(12, j.count | 0), s = j.sprites || [], d = D.createElement("div");
    d.className = "pn-th-layer"; d.setAttribute("aria-hidden", "true");
    for (var i = 0; i < n && s.length; i++) {
      var e = D.createElement("i"); e.className = "pn-th-s"; e.innerHTML = s[i % s.length];
      e.style.cssText = "--l:" + ((i * 37 + 11) % 97) + "%;--y:" + ((i * 53 + 7) % 90) + ";--w:" + (10 + (i * 7) % 9) + "px;--t:" + (9 + (i * 5) % 7) + "s;--d:-" + ((i * 3) % 11) + "s;--x:" + (i % 2 ? 18 : -18) + "px";
      d.appendChild(e);
    }
    return d;
  }
  function clear() {
    seq++;
    var r = D.documentElement;
    r.removeAttribute("data-theme");
    if (cur) Object.keys(cur.j.tokens || {}).forEach(function (k) { r.style.removeProperty(k); });
    [css, layer, hat].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    css = layer = hat = null; cur = null;
  }
  function fail(e) { clear(); if (!warned++) try { console.warn("themes off:", e && e.message || e); } catch (x) {} sync(); }
  function apply(j, preview) {
    var bg = ""; try { bg = getComputedStyle(D.documentElement).getPropertyValue("--ds-bg").trim(); } catch (e) {}
    if (!ok(j, /^#[0-9a-f]{6}$/i.test(bg) ? bg : "")) throw new Error("theme file refused");
    clear(); var r = D.documentElement, c = navigator.connection, lite = (c && c.saveData) || (!preview && (navigator.hardwareConcurrency || 8) <= 4);
    cur = { j: j };
    Object.keys(j.tokens || {}).forEach(function (k) { r.style.setProperty(k, j.tokens[k]); });
    css = D.createElement("style"); css.id = "pn-th-css"; css.textContent = BASE + (j.css || ""); D.head.appendChild(css);
    if (!lite && j.count) { layer = sprites(j); D.body.appendChild(layer); layer.classList.toggle("pn-th-p", D.hidden); }
    var w = D.querySelector(".beer-wrap");
    if (w && j.btn) { hat = D.createElement("span"); hat.className = "pn-th-hat"; hat.setAttribute("aria-hidden", "true"); hat.innerHTML = j.btn; w.appendChild(hat); }
    r.setAttribute("data-theme", j.id); wrapNews(); sync();
    try { W.dispatchEvent(new CustomEvent("dialekt:change", { detail: { theme: j.id } })); } catch (e) {}   // the ticker rebuilds on this event
  }
  function get(u) { return fetch(u, { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function want() {   // -> Promise of a theme id or null
    var q = /[?&]theme=([a-z]{1,12})(&|#|$)/.exec(W.location.search);
    if (q) return Promise.resolve(q[1] === "off" ? null : q[1]);
    if (isOff()) return Promise.resolve(null);
    return get("./themes/index.json").then(function (l) { return pick(l); });
  }
  function run(quiet) {   // quiet (a tab came back): a failed check keeps the theme that runs
    var my = ++seq;
    return want().then(function (id) {
      if (my !== seq) return;
      if (!id) { if (cur) clear(); return sync(); }
      if (cur && cur.j.id === id) return;
      return get("./themes/" + id + ".json").then(function (j) { if (my === seq) apply(j, /[?&]theme=/.test(W.location.search)); });
    }).catch(function (e) { if (!(quiet && cur)) fail(e); });
  }

  /* ---- Installningar row ---- */
  function isOff() { try { return W.localStorage.getItem(LS) === "1"; } catch (e) { return false; } }
  function sync() { rows = rows.filter(function (r) { return r.isConnected; }); rows.forEach(paint); }
  function paint(row) {
    {
      var on = !isOff(), sw = row.querySelector(".pn-th-sw"), sub = row.querySelector(".pn-th-sub"), sv = lang() === "sv";
      sw.setAttribute("aria-checked", String(on)); sw.querySelector(".switch").setAttribute("aria-checked", String(on));
      sub.textContent = !on ? (sv ? "Av" : "Off") : cur ? (sv ? "På · " : "On · ") + (cur.j.name || cur.j.id) : (sv ? "På · inget tema just nu" : "On · no theme right now");
    }
  }
  function settingsRow() {
    if (!D.getElementById("pn-th-set-css")) {
      var s = D.createElement("style"); s.id = "pn-th-set-css";
      s.textContent = ".pn-th-set .pn-th-sub{display:block;font-size:var(--ds-fs-14,14px);line-height:var(--ds-lh-14,20px);font-weight:400;color:var(--ds-muted,#9aa6bd)}.pn-th-set .pn-sw-l{display:flex;flex-direction:column;min-width:0;text-align:left}";
      D.head.appendChild(s);
    }
    var ic = ""; try { ic = W.PNI ? W.PNI.svg("sparkle", "pi-lead") : ""; } catch (e) {}
    var row = D.createElement("div"), b = D.createElement("button");
    row.className = "row pn-th-set"; b.type = "button"; b.className = "btn btn-block pn-swb pn-th-sw"; b.setAttribute("role", "switch");
    b.innerHTML = ic + '<span class="pn-sw-l">' + (lang() === "sv" ? "Säsongstema" : "Seasonal theme") + '<small class="pn-th-sub"></small></span><span class="switch" aria-hidden="true"></span>';
    b.addEventListener("click", function () { try { if (isOff()) W.localStorage.removeItem(LS); else W.localStorage.setItem(LS, "1"); } catch (e) {} sync(); run(); });
    row.appendChild(b); rows.push(row); paint(row); return row;
  }

  var api = { settingsRow: settingsRow, active: function () { return cur && cur.j.id; }, off: isOff,
    _at: function (s, y) { return iso(at(s, y)); }, _pick: pick, _ok: ok, _night: night, _mix: function (o, j) { var c = cur; cur = { j: j }; try { return mix(o); } finally { cur = c; } }, _run: run };
  if (PN.put) PN.put({ themes: api }); else PN.themes = api;
  if (!D || !W.fetch) return;
  D.addEventListener("visibilitychange", function () { if (layer) layer.classList.toggle("pn-th-p", D.hidden); if (!D.hidden) run(1); });
  // after the map is ready and idle (never before first paint); a fallback timer starts it anyway
  var go = (function () { var done = 0; return function () { if (!done++) run(); }; })(), m = PN.map, gl = m && m._gl;
  try {
    if (gl && gl.once && gl.loaded && !gl.loaded()) gl.once("idle", go);
    else if (m && m.whenReady && !m._loaded) m.whenReady(function () { setTimeout(go, 300); });
    else (W.requestIdleCallback || setTimeout)(go, 1500);
  } catch (e) { go(); }
  setTimeout(go, 9000);
})();
