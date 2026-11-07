/* Öl Nu — 📊 MIN KVÄLL (CONTRACT "📊 MIN KVÄLL", migration 0165). My own timeline of tonight (and past nights):
   every drink with time, kind (öl / cider / drink / shot …) and place (bar name or area), my check-ins, and small stats
   (first / last drink, drinks per hour, bars, a per-hour bar chart). Only I see it (my_night_log reads my own rows).
   Data: drink_log (from 7/11 2026, written by triggers on beers + checkins, so every beer RPC is unchanged). Older nights show
   what exists: drink times (duel_log), check-ins (crew_tracks) and the night total (medal_nights) — kind and place unknown.
   Ways in (no new map button): a quiet chip "📊 Min kväll" in the Ikväll panel (hudChipsHTML, only when I drank tonight),
   👤 Profil (profileSheet), and a button on the morning 🤕 Bakisrapporten (after.js calls NIGHTLOG.button(row)).
   Hooks (app.js mods): init, hudChipsHTML, hudClick, profileSheet. Public: window.NIGHTLOG.open(night?), .button(row).
   A missing RPC (old server, PGRST202) → the chip and rows hide quietly. Styles: evx.css (.nl-*). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, cache = {}, lastLine = {};
  var TZ = "Europe/Stockholm";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastLine[key]) i = (i + 1) % a.length;
    lastLine[key] = i; return a[i];
  }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function missing(e) { try { return U.missing ? U.missing(e) : /PGRST202|42883|does not exist/.test(JSON.stringify(e)); } catch (x) { return false; } }

  var KIND = {
    beer: ["🍺", "Öl", "Beer"], cider: ["🍏", "Cider", "Cider"], drink: ["🍸", "Drink", "Cocktail"], shot: ["🥃", "Shot", "Shot"],
    vin: ["🍷", "Vin", "Wine"], rom: ["🏴‍☠️", "Rom", "Rum"], whisky: ["🥃", "Whisky", "Whisky"], grogg: ["🍹", "Grogg", "Highball"],
    bubbel: ["🍾", "Bubbel", "Bubbly"], annat: ["🥤", "Annat", "Other"], unknown: ["🍻", "Dryck", "Drink"], checkin: ["🚪", "Incheckning", "Check-in"]
  };
  function kname(k) { var x = KIND[k] || KIND.unknown; return sv() ? x[1] : x[2]; }
  function kemo(k) { return (KIND[k] || KIND.unknown)[0]; }

  var TX = {
    empty: [["Inga drycker loggade ikväll. Kasernen ä tyst – än så länge.", "No drinks logged tonight. Quiet barracks – so far."],
      ["Tomt i loggboken. Tryck ÖL! så börjar rapporten.", "The log is empty. Tap ÖL! to start the report."],
      ["Ingen aktivitet i fält. Vilodag för levern?", "No activity in the field. Rest day for the liver?"],
      ["Nollrapport, chefen. Inte en droppe.", "Zero report, sir. Not a drop."]],
    head: [["Fältrapport: {n} drycker.", "Field report: {n} drinks."], ["Loggboken säger {n}. Den ljuger int'.", "The log says {n}. It doesn't lie."],
      ["{n} i kroppen, noll i ångern.", "{n} down, zero regrets."], ["Uppdraget pågår: {n} avklarade.", "Mission running: {n} done."],
      ["Spaningsrapport: {n} drycker sen start.", "Recon report: {n} drinks so far."]],
    legacy: ["Äldre kväll: bara tiderna finns sparade. Sort och ställe loggas från 7/11.", "Older night: only the times are saved. Kind and place are logged from 7 Nov."],
    ghost: ["👻 = spökläge (bara du ser)", "👻 = ghost mode (only you see it)"]
  };
  function tx(key, v) {
    var a = TX[key], s = Array.isArray(a[0]) ? pick(key, a) : a;
    s = sv() ? s[0] : s[1];
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; });
  }
  function hm(iso) {
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; }
  }
  function eveNow() {   // the evening date of "now" (00–05 belongs to the day before), as YYYY-MM-DD
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 5 * 3600e3)); } catch (e) { return ""; }
  }
  function dayLabel(n, tonight) {
    if (tonight) return L("Ikväll", "Tonight");
    try {
      var d = new Date(Date.parse(n.night) - 6 * 3600e3);
      var wd = new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: "short" }).format(d).replace(".", "");
      var dm = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "numeric" }).format(d);
      return wd.charAt(0).toUpperCase() + wd.slice(1) + " " + dm;
    } catch (e) { return String(n.evening || ""); }
  }

  function load(night) {
    var key = night || "now", c = cache[key];
    if (c && Date.now() - c.at < 30000) return Promise.resolve(c.d);
    return A.rpc("my_night_log", night ? { p_night: night } : {}).then(function (r) {
      if (r.error) { if (missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data); cache[key] = { at: Date.now(), d: d }; return d;
    });
  }

  /* ---------- the sheet ---------- */
  function open(night) {
    if (!A || off) return;
    A.openSheet(L("📊 Min kväll", "📊 My night"), function (body) {
      var root = el("div", { class: "nl" }, [el("p", { class: "muted", text: "…" })]);
      body.appendChild(root);
      draw(root, night || null);
    }, { now: true });
  }
  function draw(root, night) {
    load(night).then(function (d) {
      if (!document.body.contains(root)) return;
      root.innerHTML = "";
      if (!d) { root.appendChild(el("p", { class: "muted", text: L("Kunde int' hämta loggen. Kolla nätet.", "Could not load the log. Check the network.") })); return; }
      var s = d.stats || {}, items = d.items || [], nights = d.nights || [];
      // night chips (one scroll row)
      var curNight = String(d.night);
      var has = nights.some(function (n) { return Date.parse(n.night) === Date.parse(curNight); });
      if (!has) nights = [{ night: d.night, evening: d.evening, drinks: s.drinks | 0 }].concat(nights);
      if (nights.length > 1 || !d.tonight) {
        var row = el("div", { class: "nl-nights", role: "tablist", "aria-label": L("Kvällar", "Nights") });
        nights.slice(0, 30).forEach(function (n) {
          var on = Date.parse(n.night) === Date.parse(curNight);
          var tonight = String(n.evening || "").slice(0, 10) === eveNow();
          var b = el("button", { type: "button", role: "tab", class: "nl-night" + (on ? " on" : ""), "aria-selected": String(on) }, [
            el("span", { text: dayLabel(n, tonight) }), (n.drinks | 0) ? el("b", { text: String(n.drinks | 0) }) : null]);
          b.addEventListener("click", function () { if (!on) { root.innerHTML = '<p class="muted">…</p>'; draw(root, n.night); } });
          row.appendChild(b);
        });
        root.appendChild(row);
        setTimeout(function () { var x = row.querySelector(".on"); if (x && x.scrollIntoView) try { x.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) {} }, 30);
      }
      var n = s.drinks | 0;
      root.appendChild(el("p", { class: "nl-lead", text: n ? tx("head", { n: n }) : tx("empty") }));
      // stats grid
      var span = s.first_at ? hm(s.first_at) : "–", last = s.last_at && s.last_at !== s.first_at ? hm(s.last_at) : "";
      var grid = el("div", { class: "nl-grid" });
      [[String(n), L("drycker", "drinks")], [s.per_hour != null ? String(s.per_hour).replace(".", sv() ? "," : ".") : "–", L("per timme", "per hour")],
        [span, last ? L("sista ", "last ") + last : L("första", "first")], [String(s.bars | 0), L("ställen", "places")]].forEach(function (x) {
        grid.appendChild(el("div", { class: "nl-stat" }, [el("b", { class: x[0].length > 6 ? "nl-sm" : "", text: x[0] }), el("span", { text: x[1] })]));
      });
      root.appendChild(grid);
      // kinds
      var kinds = s.kinds || {}, kk = Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; });
      if (kk.length) {
        var kr = el("div", { class: "nl-kinds" });
        kk.forEach(function (k) { kr.appendChild(el("span", { class: "ds-chip nl-kind", text: kemo(k) + " " + kinds[k] + " " + kname(k).toLowerCase() })); });
        root.appendChild(kr);
      }
      // per-hour bars
      var hrs = s.hours || [];
      if (hrs.length >= 2) {
        var max = 1; hrs.forEach(function (h) { if (h.n > max) max = h.n; });
        var ch = el("div", { class: "nl-hours", role: "img", "aria-label": hrs.map(function (h) { return h.h + ":00 " + h.n; }).join(", ") });
        hrs.forEach(function (h) {
          ch.appendChild(el("div", { class: "nl-hcol" }, [el("i", { style: "height:" + Math.max(8, Math.round(h.n / max * 100)) + "%" }), el("b", { text: String(h.n) }), el("span", { text: h.h })]));
        });
        root.appendChild(ch);
      }
      // timeline
      if (items.length) {
        root.appendChild(el("h3", { class: "nl-h", text: L("Tidslinje", "Timeline") }));
        var ul = el("ul", { class: "nl-list" }), ghost = false;
        items.forEach(function (it, i) {
          var place = it.bar || it.area || "";
          if (it.ghost) ghost = true;
          var label = it.kind === "checkin" ? L("Checkade in", "Checked in") + (place ? (sv() ? " på " : " at ") + place : "") : kname(it.kind);
          var nth = 0; for (var j = 0; j <= i; j++) if (items[j].kind !== "checkin") nth++;
          ul.appendChild(el("li", { class: "nl-it" + (it.kind === "checkin" ? " nl-ci" : "") }, [
            el("span", { class: "nl-t", text: hm(it.at) }),
            el("span", { class: "nl-e", "aria-hidden": "true", text: kemo(it.kind) }),
            el("span", { class: "nl-x" }, [el("b", { text: label + (it.ghost ? " 👻" : "") }),
              it.kind !== "checkin" && place ? el("small", { text: "📍 " + place }) : null]),
            it.kind !== "checkin" ? el("span", { class: "nl-n", text: "#" + nth }) : null
          ]));
        });
        root.appendChild(ul);
        if (ghost) root.appendChild(el("p", { class: "muted nl-note", text: tx("ghost") }));
      }
      if (d.source === "legacy") root.appendChild(el("p", { class: "muted nl-note", text: tx("legacy") }));
      if (d.source === "none" && n > 0) root.appendChild(el("p", { class: "muted nl-note", text: L("Bara summan finns sparad för den här kvällen.", "Only the total is saved for this night.") }));
    });
  }

  function button(row) {
    if (!A || off || !row) return;
    row.appendChild(A.btn(L("📊 Min kväll", "📊 My night"), "btn-small", function () { open(null); }));
  }

  window.NIGHTLOG = {
    open: open, button: button, _load: load,
    init: function (api) { A = api; },
    hudChipsHTML: function (ctx) {
      if (!A || off || !A.LIVE || !ctx || !(ctx.n > 0)) return "";
      return '<button type="button" class="hx-chip nl-chip" data-hx="nightlog" aria-label="' + U.esc(L("Min kväll: tidslinje och statistik", "My night: timeline and stats")) + '">📊 ' +
        U.esc(L("Min kväll", "My night")) + "</button>";
    },
    hudClick: function (action) { if (action === "nightlog") open(null); },
    profileSheet: function (body) {
      if (!A || off || !A.LIVE) return;
      body.appendChild(el("h3", { text: L("📊 Min kväll", "📊 My night") }));
      body.appendChild(el("p", { class: "muted", style: "margin:0 0 8px", text: L("Varje dryck mä tid, sort och ställe. Bara du ser den.", "Every drink with time, kind and place. Only you see it.") }));
      body.appendChild(el("div", { class: "row" }, [A.btn(L("📊 Visa kvällen", "📊 Show the night"), "btn-small", function () { open(null); })]));
    }
  };
})();
