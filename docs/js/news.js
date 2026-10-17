/* LIVE ticker as a funny TV news feed. Builds headlines from the live beer rows.
   Privacy: strangers are always anonymous. Only friends (friend_name) and "Du" are named.
   A single stranger never gets an exact place; a bar name is used only when 2+ people are at that bar. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t;
  var REC_KEY = "olnu.records", MAX_NIGHTS = 14, MAX_ITEMS = 6, NEAR_M = 5000;

  /* ---------- Personal records (per phone, localStorage) ---------- */
  // Night key = the date of the 05:00 Stockholm expiry that ends this night, e.g. "2026-10-18".
  function nightKey(d) {
    var x = U.next5am(d || new Date());
    try {
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
    } catch (e) { return x.toISOString().slice(0, 10); }
  }
  function prevNightKey(now) { return nightKey(new Date((now || new Date()).getTime() - 86400e3)); }
  function loadRec() {
    var r = U.ls.getJSON(REC_KEY, null);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  }
  function recId(b) { return b.is_mine ? "me" : b.friend_name ? "f:" + b.friend_name : null; }
  // Store the max beer_count seen tonight for "me" and each named friend. Keep the newest 14 nights.
  function update(beers, now) {
    try {
      var rec = loadRec(), key = nightKey(now), night = rec[key] && typeof rec[key] === "object" ? rec[key] : {};
      (beers || []).forEach(function (b) {
        var id = recId(b); if (!id) return;
        var n = b.beer_count | 0;
        if (n > (night[id] | 0)) night[id] = n;
      });
      rec[key] = night;
      var keys = Object.keys(rec).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort();
      Object.keys(rec).forEach(function (k) { if (keys.indexOf(k) < 0) delete rec[k]; });
      while (keys.length > MAX_NIGHTS) delete rec[keys.shift()];
      U.ls.setJSON(REC_KEY, rec);
    } catch (e) {}
  }
  // {last: max on the previous night, best: max over stored nights before tonight}
  function stats(id, now) {
    var rec = loadRec(), key = nightKey(now), prev = prevNightKey(now), best = 0, last = 0;
    try {
      Object.keys(rec).forEach(function (k) {
        if (k === key || !rec[k]) return;
        var v = rec[k][id] | 0;
        if (v > best) best = v;
        if (k === prev) last = v;
      });
    } catch (e) {}
    return { last: last, best: best };
  }

  /* ---------- Helpers ---------- */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function hourNow(now) {
    try {
      var h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(now);
      return parseInt(h, 10) % 24;
    } catch (e) { return now.getHours(); }
  }
  function townAt(lat, lng) { var c = window.CITIES && window.CITIES.nearest(lat, lng); return c ? c.name : null; }

  /* ---------- Build one cycle ---------- */
  // ctx: {center:{lat,lng}, now:Date, prev:[texts of last cycle]}
  // Returns [{text, cls}] — max 6, shuffled, no text twice, first item never the last cycle's last item.
  function build(beers, ctx) {
    ctx = ctx || {};
    beers = beers || [];
    var now = ctx.now || new Date(), prev = ctx.prev || [];
    var tpl = t("news") || [], byKind = {};
    tpl.forEach(function (x) { (byKind[x.k] = byKind[x.k] || []).push(x.f); });
    var cand = [];   // {k, d, imp, cls}
    function add(k, d, imp, cls) { if (byKind[k]) cand.push({ k: k, d: d || {}, imp: imp | 0, cls: cls || "" }); }
    var anon = t("newsAnon") || ["?"];

    // Bars with 2+ people (same assignment as the map: precise pins within 75 m).
    var per = window.BARS ? window.BARS.assign(beers).perBar : {}, busyBar = {}, bars = [];
    Object.keys(per).forEach(function (id) {
      var a = per[id];
      if (a.beers.length < 2 || !a.bar.name) return;
      bars.push(a);
      a.beers.forEach(function (b) { busyBar[b.id] = a.bar.name; });
    });
    // Place phrase for a hot/med alert. Named people: the normal place text. Strangers: busy bar or town only.
    function whereFor(b) {
      if (b.is_mine || b.friend_name) {
        var d = window.BARS ? window.BARS.describe(b) : { kind: "unknown" };
        return d.kind === "unknown" ? "" : " " + t("where_" + d.kind, d.name);
      }
      if (busyBar[b.id]) return " " + t("where_at", busyBar[b.id]);
      var tw = townAt(b.lat, b.lng);
      return tw ? " " + t("where_town", tw) : "";
    }
    function whoFor(b) { return b.is_mine ? t("you") : b.friend_name || pick(anon); }

    // Streak alerts (important). Highest first, max 3.
    beers.filter(function (b) { return U.level(b.beer_count) > 0; })
      .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })
      .slice(0, 3)
      .forEach(function (b) {
        var med = U.level(b.beer_count) === 2;
        add(med ? "med" : "hot", { who: whoFor(b), where: whereFor(b), n: b.beer_count | 0 }, 3,
          (med ? "tk-med" : "tk-hot") + (b.friend_name ? " tk-friend" : ""));
      });

    // Named people: records, near a streak, skål.
    var me = null, friends = [];
    beers.forEach(function (b) { if (b.is_mine) me = b; else if (b.friend_name) friends.push(b); });
    friends.forEach(function (b) {
      var n = b.beer_count | 0, s = stats(recId(b), now), d = { name: b.friend_name, n: n };
      if (s.best >= 1 && n > s.best) add("recNew", d, 2, "tk-friend");
      else if (s.last >= 2 && s.last > n) {
        var k = s.last - n;
        add(k <= 3 && Math.random() < 0.5 ? "recClose" : "recChase", { name: b.friend_name, n: n, rek: s.last, k: k }, 2, "tk-friend");
      }
      if (n === 4) add("hotClose", d, 2, "tk-friend");
      if (n === 9) add("medClose", d, 2, "tk-friend");
      if (n >= 1 && n <= 3) add("friendOut", d, 0, "tk-friend");
      var sk = b.skal_count | 0;
      if (sk >= 1) add("skal", { name: b.friend_name, s: sk }, 1, "tk-friend");
    });
    if (me) {
      var mn = me.beer_count | 0, ms = stats("me", now);
      if (ms.best >= 1 && mn > ms.best) add("meRecNew", { n: mn }, 2, "tk-me");
      else if (ms.last >= 2 && ms.last > mn) add("meRec", { n: mn, rek: ms.last }, 1, "tk-me");
      if (mn === 4) add("meHotClose", {}, 2, "tk-me");
      if (mn === 9) add("meMedClose", {}, 2, "tk-me");
      add("meN", { n: mn }, 0, "tk-me");
      if ((me.skal_count | 0) >= 1) add("meSkal", { s: me.skal_count | 0 }, 1, "tk-me");
      var ahead = friends.filter(function (b) { return (b.beer_count | 0) > mn; })
        .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })[0];
      if (ahead) add("meBehind", { name: ahead.friend_name, k: (ahead.beer_count | 0) - mn }, 1, "tk-me");
      else if (friends.length && mn > 0) add("meLead", {}, 1, "tk-me");
    }

    // Bars with 2+ people.
    bars.sort(function (a, b) { return b.beers.length - a.beers.length; }).slice(0, 2).forEach(function (a) {
      add("barReport", { bar: a.bar.name, k: a.beers.length }, 0);
      var str = a.beers.filter(function (b) { return !b.is_mine && !b.friend_name; })
        .sort(function (x, y) { return (y.beer_count | 0) - (x.beer_count | 0); })[0];
      if (str) add("barStranger", { bar: a.bar.name, n: str.beer_count | 0, anon: pick(anon) }, 0);
    });

    // A stranger with a few beers, in a town (never a place for one person).
    var lone = beers.filter(function (b) { return !b.is_mine && !b.friend_name && !busyBar[b.id] && (b.beer_count | 0) >= 2 && U.level(b.beer_count) === 0; });
    if (lone.length) {
      var lb = pick(lone), lt = townAt(lb.lat, lb.lng);
      if (lt) add("anon", { anon: pick(anon), stad: lt, n: lb.beer_count | 0 }, 0);
    }

    // Country, local town, forecast, time of day.
    if (beers.length) add("total", { n: beers.length }, 0);
    var c = ctx.center, stad = (c && townAt(c.lat, c.lng)) || t("newsTown");
    var near = c ? beers.filter(function (b) { return U.haversine(c.lat, c.lng, b.lat, b.lng) <= NEAR_M; }) : beers;
    var hotNear = near.filter(function (b) { return U.level(b.beer_count) > 0; }).length;
    if (near.length < 3 && !hotNear) add("calm", { stad: stad }, beers.length ? 0 : 1, "tk-quiet");
    if (near.length >= 1) add("forecast", { stad: stad, n: near.length, p: Math.min(99, near.length * 9 + hotNear * 10) }, 0);
    var h = hourNow(now), tk = h >= 5 && h < 20 ? "t1" : h >= 20 && h < 23 ? "t2" : h >= 23 || h < 1 ? "t3" : h < 3 ? "t4" : "t5";
    add(tk, { hh: ("0" + h).slice(-2) }, 0);

    // Turn candidates into texts. One random template per candidate. Drop duplicates.
    var seen = {}, items = [];
    cand.forEach(function (x) {
      var fs = byKind[x.k].slice(), text = "";
      // Prefer a template text that was not on screen last cycle.
      shuffle(fs);
      for (var i = 0; i < fs.length; i++) {
        try { text = String(fs[i](x.d)); } catch (e) { text = ""; }
        if (text && prev.indexOf(text) < 0) break;
      }
      if (!text || seen[text]) return;
      seen[text] = true;
      items.push({ text: text, cls: x.cls, imp: x.imp, old: prev.indexOf(text) >= 0, r: Math.random() });
    });
    // Mix: max 2 streak alerts, max 2 named highlights, the rest from the other news (new texts before old ones).
    items.sort(function (a, b) { return b.imp - a.imp || (a.old - b.old) || a.r - b.r; });
    var out = [], cap = { 3: 2, 2: 2 }, used = {}, rest = [];
    items.forEach(function (x) {
      if (cap[x.imp] && (used[x.imp] | 0) < cap[x.imp]) { used[x.imp] = (used[x.imp] | 0) + 1; out.push(x); }
      else rest.push(x);
    });
    rest.sort(function (a, b) { return (a.old - b.old) || a.r - b.r; });
    out = out.concat(rest).slice(0, MAX_ITEMS);
    shuffle(out);
    var lastText = prev.length ? prev[prev.length - 1] : null;
    if (out.length > 1 && out[0].text === lastText) out.push(out.shift());
    return out.map(function (x) { return { text: x.text, cls: x.cls }; });
  }

  window.NEWS = { build: build, update: update, stats: stats, nightKey: nightKey, prevNightKey: prevNightKey };
})();
