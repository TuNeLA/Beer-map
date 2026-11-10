/* PintsNow — 📋 KVÄLLSRAPPORTEN (A2, lane after, owner OK 10 Nov). window.AFTER2.
   The morning report of one group: swipe cards (one fact per card, Wrapped style) that end on a 9:16 share card for the
   group chat. Data: ONE RPC after_report2(p_group_id, p_night) (migration 0450). Old server (missing RPC) → off: after.js
   keeps the old Bakisrapporten exactly as before.
   Rules (owner 10 Nov + research A1):
   - Every person gets exactly ONE award, from data, ties → the earliest time. Nothing counts drinks: no "Snabbaste pinten",
     no drink numbers anywhere (store rule 1.4.3 / alkohollagen).
   - Ghost (Spökläge) nights are never in the data (server). Home = the time only; home AREAS are ~500 m rings on the share
     card, never a point. No join code on the card (only pintsnow.com).
   - All copy = DIALEKT keys (after-content.js, AFTER_R2.t). PNI icons only. Tokens only (after2.css, prefix a2-).
   Ways in: the morning toast + the HUD chip (after.js asks morning()/chipHTML()), the push /?after=<gid> (cold start and
   the service-worker message), groupCard(g) for the group page, openFor(gid). Never breaks the map. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, off = false, root = null, st = null, cache = {}, pending = null, deep = null;
  var TZ = "Europe/Stockholm", SEEN = "olnu.a2Seen", DAY = "olnu.a2Day";   // DAY = "<ymd>|seen" or "<ymd>|none": one RPC per morning
  var COL = ["--ds-amber", "--ds-green", "--ds-blue", "--ds-red-t", "--ds-amber-t", "--ds-green-t", "--ds-blue-t"];
  function T(k, v) { return window.AFTER_R2 ? window.AFTER_R2.t(k, v) : k; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function pni(n, cls) { try { return window.PNI ? window.PNI.svg(n, cls || "") : ""; } catch (e) { return ""; } }
  function ts(x) { var t = Date.parse(x || ""); return isFinite(t) ? t : null; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function missing(e) { try { return U.missing ? U.missing(e) : /PGRST202|42883|does not exist/.test(JSON.stringify(e)); } catch (x) { return false; } }
  function hm(t) {
    if (t == null) return "";
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t)); } catch (e) { return ""; }
  }
  function dayLabel(ev) {   // "fre 7 nov"
    var t = Date.parse(String(ev || "") + "T12:00:00Z"); if (!isFinite(t)) return "";
    try { return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(t)).replace(/\./g, ""); } catch (e) { return String(ev); }
  }
  function today() { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return ""; } }
  function hashN(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function colOf(k) { return COL[hashN(String(k || "")) % COL.length]; }
  function initial(n) { var s = String(n || "?").trim(); return (s.charAt(0) || "?").toUpperCase(); }
  function km(a, b) {
    var R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLn = (b.lng - a.lng) * r;
    var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLn / 2) * Math.sin(dLn / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function dec1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace(".", ","); }
  function dur(ms) {
    var m = Math.max(1, Math.round(Math.abs(ms) / 60000));
    if (m < 60) return T("after.r2.min", { n: m });
    return T("after.r2.hm", { h: Math.floor(m / 60), m: m % 60 });
  }
  function names(list) {
    var n = list.map(function (p) { return p.name; });
    if (n.length <= 1) return n.join("");
    return n.slice(0, -1).join(", ") + T("after.r2.and") + n[n.length - 1];
  }
  // clock minutes of a night (12:00 = 0), so 01:10 is "later" than 23:40 (only to compare two nights)
  function nightMin(t) {
    var s = hm(t); if (!s) return null;
    var h = +s.slice(0, 2), m = +s.slice(3, 5);
    return ((h + 12) % 24) * 60 + m;
  }

  /* ---------- the model ---------- */
  function people(d) {
    var right = {};
    (d.bets || []).forEach(function (b) { (b.picks || []).forEach(function (p) { if (p && p.right) right[p.k] = (right[p.k] || 0) + 1; }); });
    return (d.people || []).map(function (p, i) {
      return { k: String(p.k || i), name: String(p.name || "").trim() || T("after.r2.anon"), me: !!p.is_me, i: i,
        first: ts(p.first_at), last: ts(p.last_at), home: ts(p.home_at), said: ts(p.said_at), saidUte: !!p.said_ute,
        place: p.first_place || "", bars: p.bars | 0, skal: p.skal | 0, driver: !!p.driver, out: p.out !== false && ts(p.first_at) != null,
        right: right[String(p.k)] | 0, aw: null };
    });
  }
  // Every person exactly one award. Order = priority. A title goes to its true winner; a winner with a title already keeps
  // the higher one and the next title goes to the best person WITHOUT one (its fact line is always true for that person).
  function awards(ps) {
    var out = ps.filter(function (p) { return p.out; });
    function free(list) { return list.filter(function (p) { return !p.aw; }); }
    function best(list, score) {   // highest score, ties → earliest first time, then list order
      var b = null;
      list.forEach(function (p) { var s = score(p); if (s == null) return; if (!b || s > b.s || (s === b.s && (p.first || 9e15) < (b.p.first || 9e15))) b = { p: p, s: s }; });
      return b ? b.p : null;
    }
    function give(p, id, icon, v) { p.aw = { id: id, icon: icon, v: v || {} }; }
    var firstP = best(out, function (p) { return -p.first; });
    var homes = out.filter(function (p) { return p.home != null; });
    var lastP = homes.length ? best(homes, function (p) { return p.home; }) : best(out, function (p) { return p.last; });
    if (firstP && lastP && firstP === lastP && out.length >= 2) give(firstP, "jarn", "medal", { a: hm(firstP.first), b: hm(firstP.home || firstP.last) });
    else {
      if (firstP) give(firstP, "kapten", "flag", { t: hm(firstP.first), place: firstP.place });
      if (lastP && !lastP.aw && out.length >= 2) give(lastP, "sist", "moon", { t: hm(lastP.home || lastP.last), real: lastP.home != null });
    }
    var h = best(free(out), function (p) { return p.bars >= 2 ? p.bars : null; });
    if (h) give(h, "hopp", "map", { n: h.bars });
    var o = best(free(ps), function (p) { return p.right >= 1 ? p.right : null; });
    if (o) give(o, "orakel", "sparkle", { n: o.right });
    free(ps).filter(function (p) { return p.driver; }).forEach(function (p) { give(p, "chauf", "taxi", {}); });
    var s = best(free(out), function (p) { return p.skal >= 1 ? p.skal : null; });
    if (s) give(s, "skal", "cheers", { n: s.skal });
    if (out.length >= 3) {
      var k = best(free(out).filter(function (p) { return p.home != null; }), function (p) { return -p.home; });
      if (k) give(k, "klok", "home", { t: hm(k.home) });
    }
    free(ps).filter(function (p) { return !p.out && p.saidUte; }).forEach(function (p) { give(p, "spoke", "eye-off", { t: p.said ? hm(p.said) : "" }); });
    free(ps).forEach(function (p, j) { give(p, "lugn", "shield", { n: j % 3 }); });   // the fallback names take turns
    ps.forEach(function (p) {
      var a = p.aw, id = a.id, v = a.v;
      v._seed = p.i;
      a.name = T("after.aw." + id + ".name" + (id === "lugn" && v.n ? v.n : ""), { _seed: p.i });
      a.fact = id === "kapten" ? T(v.place ? "after.aw.kapten.fact" : "after.aw.kapten.fact0", v)
        : id === "sist" ? T(v.real ? "after.aw.sist.fact" : "after.aw.sist.fact0", v)
        : id === "spoke" ? T(v.t ? "after.aw.spoke.fact" : "after.aw.spoke.fact0", v)
        : T("after.aw." + id + ".fact", v);
      a.line = T("after.aw." + id + ".line", { _seed: p.i });
    });
    return ps;
  }
  // The gang's route: bars in the order the gang first arrived (one stop per bar).
  function route(stops) {
    var seen = {}, out = [];
    (stops || []).slice().sort(function (a, b) { return (ts(a.at) || 0) - (ts(b.at) || 0); }).forEach(function (s) {
      var id = String(s.bar_id || s.name || ""); if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, name: String(s.name || ""), at: ts(s.at), lat: +s.lat, lng: +s.lng, ok: isFinite(+s.lat) && isFinite(+s.lng) && s.lat != null && s.lng != null });
    });
    return out;
  }
  function routeKm(r) {
    var sum = 0, prev = null;
    r.forEach(function (s) { if (!s.ok) return; if (prev) sum += km(prev, s); prev = s; });
    return sum;
  }
  function story(ps, stops) {
    var ev = [], byK = {}, firstK = null, prevBar = {}, grp = null;
    ps.forEach(function (p) { byK[p.k] = p; });
    var first = ps.filter(function (p) { return p.out; }).sort(function (a, b) { return a.first - b.first; })[0];
    if (first) { firstK = first.k; ev.push({ t: first.first, icon: "flag", text: first.place ? T("after.r2.story.first", { name: first.name, place: first.place }) : T("after.r2.story.first0", { name: first.name }) }); }
    // bar arrivals grouped per bar within 20 min: "Lisa och Oskar drog vidare till Lobbybaren" / "Nisse anslöt på Pitchers"
    function flush() {
      if (!grp) return;
      var who = grp.who.map(function (k) { return byK[k]; }).filter(Boolean);
      if (who.length) ev.push({ t: grp.t, icon: "pin", text: T(grp.moved ? "after.r2.story.move" : "after.r2.story.join", { names: names(who), place: grp.name }) });
      grp = null;
    }
    (stops || []).slice().sort(function (a, b) { return (ts(a.at) || 0) - (ts(b.at) || 0); }).forEach(function (s) {
      var id = String(s.bar_id || s.name || ""), t = ts(s.at), k = String(s.k);
      if (!id || t == null || !byK[k]) return;
      if (k === firstK && prevBar[k] == null && Math.abs(t - first.first) < 3 * 60000) { prevBar[k] = id; return; }   // the opening line says it
      var moved = prevBar[k] != null;
      prevBar[k] = id;
      if (grp && grp.id === id && t - grp.t < 20 * 60000) { if (grp.who.indexOf(k) < 0) grp.who.push(k); grp.moved = grp.moved || moved; return; }
      flush();
      grp = { id: id, name: String(s.name || ""), t: t, who: [k], moved: moved };
    });
    flush();
    var homes = ps.filter(function (p) { return p.home != null; }).sort(function (a, b) { return a.home - b.home; });
    homes.forEach(function (p, i) {
      var last = i === homes.length - 1 && homes.length > 1;
      ev.push({ t: p.home, icon: last ? "moon" : "home", text: T(last ? "after.r2.story.last" : "after.r2.story.home", { name: p.name }) });
    });
    return ev.sort(function (a, b) { return a.t - b.t; });
  }
  function compare(m, prev) {
    if (!prev) return null;
    var lines = [], d;
    var lastNow = m.lastHome, lastPrev = ts(prev.last_home);
    if (lastNow != null && lastPrev != null) {
      d = (nightMin(lastNow) - nightMin(lastPrev)) * 60000;
      if (Math.abs(d) >= 10 * 60000) lines.push(T(d < 0 ? "after.r2.cmp.earlier" : "after.r2.cmp.later", { d: dur(d) }));
    }
    var pb = prev.bars | 0;
    if (m.bars !== pb && (m.bars || pb)) lines.push(T(m.bars > pb ? "after.r2.cmp.moreBars" : "after.r2.cmp.fewerBars", { n: m.bars, p: pb }));
    var pn = prev.n_out | 0;
    if (m.nOut !== pn && pn) lines.push(T(m.nOut > pn ? "after.r2.cmp.morePpl" : "after.r2.cmp.fewerPpl", { n: m.nOut, p: pn }));
    if (!lines.length) lines.push(T("after.r2.cmp.same"));
    return { date: dayLabel(prev.evening), lines: lines.slice(0, 3) };
  }
  function model(d) {
    var ps = awards(people(d));
    var out = ps.filter(function (p) { return p.out; });
    var r = route(d.stops);
    var firstT = null, endT = null, lastHome = null, allHome = out.length > 0;
    out.forEach(function (p) {
      if (firstT == null || p.first < firstT) firstT = p.first;
      var e = p.home != null ? p.home : p.last;
      if (e != null && (endT == null || e > endT)) endT = e;
      if (p.home != null) { if (lastHome == null || p.home > lastHome) lastHome = p.home; } else allHome = false;
    });
    var m = { d: d, gid: d.group && d.group.id, group: (d.group && d.group.name) || "", night: d.night, date: dayLabel(d.evening),
      people: ps, out: out, nOut: out.length, route: r, km: routeKm(r), bars: r.length, skal: ps.reduce(function (s, p) { return s + p.skal; }, 0),
      hours: firstT != null && endT != null ? Math.max(0, (endT - firstT) / 3600000) : 0, lastHome: lastHome, allHome: allHome && lastHome != null,
      homes: (d.homes || []).filter(function (h) { return h && isFinite(+h.lat) && isFinite(+h.lng); }).map(function (h) { return { lat: +h.lat, lng: +h.lng }; }),
      ghostMe: !!d.ghost_me, groups: d.groups || [], bets: d.bets || [], missions: d.missions || [], agent: d.agent || null };
    m.story = story(ps, d.stops);
    m.cmp = compare(m, d.prev);
    m.cards = cards(m);
    return m;
  }
  function cards(m) {
    var c = [], ps = m.people;
    function hero(p) {
      var extra = "";
      if (p.aw.id === "kapten" || p.aw.id === "jarn") {
        var next = m.out.filter(function (x) { return x !== p; }).sort(function (a, b) { return a.first - b.first; })[0];
        if (next && next.first - p.first >= 5 * 60000) extra = T("after.r2.later", { d: dur(next.first - p.first) });
      }
      return { type: "hero", p: p, kick: p.aw.name, title: p.name, sub: p.aw.fact, line: extra, punch: p.aw.line, icon: p.aw.icon };
    }
    c.push({ type: "intro", kick: T("after.r2.intro.kick"), title: m.group, sub: T("after.r2.intro.sub", { n: m.nOut, date: m.date }),
      line: T("after.r2.intro.head"), punch: m.ghostMe ? T("after.r2.ghost") : T("after.r2.intro.line"), icon: "moon" });
    var top = ps.filter(function (p) { return p.aw.id === "jarn" || p.aw.id === "kapten"; })[0];
    if (top) c.push(hero(top));
    c.push({ type: "num", kick: T("after.r2.num.kick"), icon: "walk",
      stats: [[String(m.bars), T("after.r2.num.bars")], [dec1(m.km), T("after.r2.num.km")], [dec1(m.hours), T("after.r2.num.h")], [String(m.skal), T("after.r2.num.skal")]],
      punch: m.km >= 0.1 ? T("after.r2.num.line", { km: dec1(m.km) }) : T("after.r2.num.line0") });
    var sist = ps.filter(function (p) { return p.aw.id === "sist"; })[0];
    if (sist) c.push(hero(sist));
    var spoke = ps.filter(function (p) { return p.aw.id === "spoke"; })[0];
    var other = spoke || ps.filter(function (p) { return /^(hopp|orakel|chauf|skal)$/.test(p.aw.id); })[0];
    if (other) c.push(hero(other));
    if (window.MOMENTS && window.MOMENTS.reportCards) { try { (window.MOMENTS.reportCards(m) || []).forEach(function (x) { if (x) c.push(x); }); } catch (e) {} }
    if (m.cmp) c.push({ type: "cmp", kick: T("after.r2.cmp.kick"), sub: T("after.r2.cmp.sub", { date: m.cmp.date }), lines: m.cmp.lines, icon: "history" });
    if (m.story.length >= 2) c.push({ type: "story", kick: T("after.r2.story.kick"), items: m.story, icon: "clock" });
    c.push({ type: "end", kick: T("after.r2.end.kick"), icon: "medal" });
    return c;
  }

  /* ---------- data ---------- */
  function load(gid, night, force) {
    if (off || !A) return Promise.resolve(null);
    var key = (gid || "") + "|" + (night || "");
    var c = cache[key];
    if (!force && c && Date.now() - c.at < 60000) return Promise.resolve(c.d);
    var args = {}; if (gid) args.p_group_id = gid; if (night) args.p_night = night;
    return A.rpc("after_report2", args).then(function (r) {
      if (r.error) { if (missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data); cache[key] = { at: Date.now(), d: d }; return d;
    }, function () { return null; });
  }
  // the gang's report: 2+ people, and I was in it (a ghost night: I see the gang, never myself, with a note)
  function usable(d) { return !!(d && !d.empty && d.people && d.people.length >= 2 && (d.ghost_me || d.people.some(function (p) { return p.is_me; }))); }

  /* ---------- the overlay ---------- */
  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "a2"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    var sx = null, sy = null;
    root.addEventListener("pointerdown", function (e) { if (e.target.closest && e.target.closest(".a2-sh")) return; sx = e.clientX; sy = e.clientY; });
    root.addEventListener("pointerup", function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { root._swiped = Date.now(); go(dx < 0 ? 1 : -1); }
    });
    document.addEventListener("keydown", function (e) {
      if (!st || root.hidden) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") { if (st.sh) closeShare(); else close(); }
    });
    window.addEventListener("popstate", function () {
      if (!st || root.hidden) return;
      if (st.sh) { closeShare(true); try { history.pushState({ a2: 1 }, ""); } catch (e) {} return; }
      close(true);
    });
    return root;
  }
  function onClick(e) {
    var t = e.target;
    if (root._swiped && Date.now() - root._swiped < 400) return;
    var b = t.closest && t.closest("[data-a2]");
    if (b) {
      var act = b.getAttribute("data-a2");
      if (act === "x") close();
      else if (act === "prev") go(-1);
      else if (act === "next") go(1);
      else if (act === "share1") shareCard(st.i);
      else if (act === "shareAll") openShare();
      else if (act === "shx") closeShare();
      else if (act === "send") sendShare(false);
      else if (act === "save") sendShare(true);
      else if (act === "own") { close(); setTimeout(function () { if (window.AFTER && window.AFTER.openBakis) window.AFTER.openBakis(); else if (window.NIGHTLOG) window.NIGHTLOG.open(null); }, 260); }
      else if (act === "grp") { var g = b.getAttribute("data-g"); if (g && st && g !== st.m.gid) openFor(g, st.night, true); }
      else if (act === "sw") { var k = b.getAttribute("data-k"); st.opt[k] = !st.opt[k]; b.setAttribute("aria-checked", String(st.opt[k])); drawPreview(); }
      return;
    }
    if (st && st.sh) return;
    if (t.closest && t.closest(".a2-stage")) {
      var r = root.getBoundingClientRect();
      go(e.clientX < r.left + r.width * 0.3 ? -1 : 1);
    }
  }
  function open(m) {
    ensureRoot();
    var first = !st;
    st = { m: m, i: 0, night: m.night, opt: { names: true, route: true }, sh: null };
    root.setAttribute("aria-label", T("after.r2.title") + " · " + m.group);
    if (first || root.hidden) {
      try { if (A && A.sheetOpen && A.sheetOpen()) A.closeSheet("after2"); } catch (e) {}
      root.hidden = false;
      document.documentElement.classList.add("a2-on");
      try { history.pushState({ a2: 1 }, ""); } catch (e) {}
    }
    lsSet(SEEN, String(m.night)); lsSet(DAY, today() + "|seen");
    pending = null;
    try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}
    try { if (window.PNLOG) window.PNLOG.event("after2.open", { n: m.nOut, c: m.cards.length }); } catch (e) {}
    paint();
  }
  function close(fromPop) {
    if (!st) return;
    if (!fromPop) { try { if (history.state && history.state.a2) { var s0 = st; history.back(); setTimeout(function () { if (st === s0) close(true); }, 400); return; } } catch (e) {} }
    st = null;
    if (root) { root.hidden = true; root.innerHTML = ""; }
    document.documentElement.classList.remove("a2-on");
  }
  function go(n) {
    if (!st || st.sh) return;
    var i = st.i + n;
    if (i < 0) return;
    if (i >= st.m.cards.length) return;
    st.dir = n; st.i = i; paint();
  }
  function avatar(p, big) {
    return '<span class="a2-av' + (big ? " a2-av-big" : "") + '" style="--a2-c:var(' + colOf(p.k) + ')" aria-hidden="true">' + esc(initial(p.name)) + "</span>";
  }
  function cardHTML(c, m) {
    var h = '<div class="a2-art" aria-hidden="true">' + pni(c.icon || "moon", "a2-art-i") + "</div>";
    if (c.kick) h += '<div class="a2-kick">' + esc(c.kick) + "</div>";
    if (c.type === "intro") {
      h += '<h2 class="a2-title">' + esc(c.title) + "</h2>" + '<div class="a2-sub">' + esc(c.sub) + "</div>" +
        '<p class="a2-line">' + esc(c.line) + "</p>" + '<p class="a2-punch">' + esc(c.punch) + "</p>";
      if (m.groups.length > 1) {
        h += '<div class="a2-grps" role="group">' + m.groups.slice(0, 4).map(function (g) {
          var on = String(g.id) === String(m.gid);
          return '<button type="button" class="a2-grp' + (on ? " on" : "") + '" data-a2="grp" data-g="' + esc(g.id) + '" aria-pressed="' + on + '">' + esc(g.name) + "</button>";
        }).join("") + "</div>";
      }
    } else if (c.type === "hero") {
      h += '<div class="a2-who">' + avatar(c.p, true) + '<div class="a2-whot"><h2 class="a2-name">' + esc(c.title) + '</h2><div class="a2-sub">' + esc(c.sub) + "</div></div></div>";
      if (c.line) h += '<p class="a2-line">' + esc(c.line) + "</p>";
      h += '<p class="a2-punch">' + esc(c.punch) + "</p>";
    } else if (c.type === "num") {
      h += '<div class="a2-stats">' + c.stats.map(function (s) { return '<div class="a2-stat"><b>' + esc(s[0]) + "</b><span>" + esc(s[1]) + "</span></div>"; }).join("") + "</div>" +
        '<p class="a2-punch">' + esc(c.punch) + "</p>";
    } else if (c.type === "cmp") {
      h += '<div class="a2-sub">' + esc(c.sub) + '</div><ul class="a2-cmp">' + c.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
    } else if (c.type === "story") {
      var it = c.items.slice(0, 8);
      h += '<ol class="a2-story">' + it.map(function (e) {
        return '<li><span class="a2-st-t">' + esc(hm(e.t)) + '</span><span class="a2-st-i">' + pni(e.icon) + '</span><span class="a2-st-x">' + esc(e.text) + "</span></li>";
      }).join("") + "</ol>";
      if (c.items.length > 8) h += '<div class="a2-sub">' + esc(T("after.r2.story.more", { n: c.items.length - 8 })) + "</div>";
    } else if (c.type === "bets" || c.type === "list") {
      h += (c.sub ? '<div class="a2-sub">' + esc(c.sub) + "</div>" : "") + '<ul class="a2-cmp">' + (c.lines || []).map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
      if (c.punch) h += '<p class="a2-punch">' + esc(c.punch) + "</p>";
    } else if (c.type === "end") {
      h += '<ul class="a2-aws">' + m.people.map(function (p) {
        return '<li class="a2-aw">' + avatar(p) + '<span class="a2-aw-x"><b>' + esc(p.aw.name) + "</b><span>" + esc(p.name) + '</span></span><span class="a2-aw-i">' + pni(p.aw.icon) + "</span></li>";
      }).join("") + "</ul>" +
        '<button type="button" class="a2-own" data-a2="own">' + pni("user") + "<span>" + esc(T("after.r2.own")) + "</span>" + pni("chev-right", "a2-chev") + "</button>" +
        '<p class="a2-foot-note">' + esc(T("after.r2.end.foot")) + "</p>";
    }
    return h;
  }
  function paint() {
    if (!st || !root) return;
    var m = st.m, c = m.cards[st.i], n = m.cards.length, last = c.type === "end";
    var bars = "";
    for (var i = 0; i < n; i++) bars += '<span class="a2-seg' + (i < st.i ? " done" : i === st.i ? " on" : "") + '"></span>';
    root.innerHTML =
      '<div class="a2-top"><div class="a2-bars" aria-hidden="true">' + bars + "</div>" +
      '<div class="a2-head"><span class="a2-brand">PintsNow · ' + esc(m.group) + "</span>" +
      '<button type="button" class="a2-x" data-a2="x" aria-label="' + esc(T("after.r2.close")) + '">' + pni("x") + "</button></div></div>" +
      '<div class="a2-stage"><article class="a2-card a2-t-' + c.type + (st.dir ? (st.dir > 0 ? " a2-in-r" : " a2-in-l") : "") + '" aria-live="polite">' + cardHTML(c, m) + "</article></div>" +
      '<div class="a2-foot">' +
      (last ? '<div class="a2-row"><button type="button" class="a2-btn a2-pri" data-a2="shareAll">' + pni("share") + "<span>" + esc(T("after.r2.shareAll")) + "</span></button></div>"
        : '<button type="button" class="a2-btn" data-a2="share1">' + pni("share") + "<span>" + esc(T("after.r2.share1")) + "</span></button>") +
      '<div class="a2-nav"><button type="button" class="a2-nb" data-a2="prev" aria-label="' + esc(T("after.r2.prev")) + '"' + (st.i ? "" : " disabled") + ">" + pni("chev-left") + "</button>" +
      '<span class="a2-hint">' + esc(T("after.r2.tap", { i: st.i + 1, n: n })) + "</span>" +
      '<button type="button" class="a2-nb" data-a2="next" aria-label="' + esc(T("after.r2.next")) + '"' + (last ? " disabled" : "") + ">" + pni("chev-right") + "</button></div></div>";
    st.dir = 0;
  }

  /* ---------- share: canvas 1080 × 1920 (9:16) ---------- */
  var W = 1080, H = 1920;
  function tok(name, def) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); if (v && /^(#|rgb)/.test(v)) return v; } catch (e) {}
    return def;
  }
  function pal() {
    return { bg: tok("--ds-bg", "#0a0f1c"), card: tok("--ds-card", "#19233a"), raised: tok("--ds-raised", "#222e48"), text: tok("--ds-text", "#eef0ec"),
      text2: tok("--ds-text-2", "#c9d0cd"), muted: tok("--ds-muted", "#a7b0ac"), amber: tok("--ds-amber", "#f5a623"), amberT: tok("--ds-amber-t", "#ffc24d"),
      onAmber: tok("--ds-on-amber", "#241300"), green: tok("--ds-green", "#3ddc84"), blue: tok("--ds-blue", "#4aa3ff") };
  }
  var F_UI = '"Chakra Petch", system-ui, sans-serif', F_ST = '"Black Ops One", Impact, sans-serif';
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var p = Promise.all(['80px "Black Ops One"', '600 40px "Chakra Petch"', '700 40px "Chakra Petch"', '400 40px "Chakra Petch"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  // PNI icon on a canvas (same parts as pnicons.js: M path, c circle, C dot, r rect, d dashed circle)
  function icon(c, name, x, y, size, color, lw) {
    var I = window.PNI && window.PNI._I, parts = I && I[name]; if (!parts) return;
    c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = lw || 2; c.lineCap = "round"; c.lineJoin = "round";
    parts.forEach(function (p) {
      var a = p.split(/\s+/);
      try {
        if (p.charAt(0) === "M") { c.stroke(new Path2D(p)); }
        else if (a[0] === "c" || a[0] === "C" || a[0] === "d") {
          c.beginPath(); c.arc(+a[1], +a[2], +a[3], 0, Math.PI * 2);
          if (a[0] === "C") c.fill(); else { if (a[0] === "d") c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]); }
        } else if (a[0] === "r") {
          c.beginPath(); if (c.roundRect) c.roundRect(+a[1], +a[2], +a[3], +a[4], +(a[5] || 0)); else c.rect(+a[1], +a[2], +a[3], +a[4]); c.stroke();
        }
      } catch (e) {}
    });
    c.restore();
  }
  function wrap(c, text, x, y, maxW, lh, maxLines) {
    var words = String(text || "").split(/\s+/), line = "", n = 0;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (c.measureText(test).width > maxW && line) {
        if (maxLines && n >= maxLines - 1) { while (c.measureText(line + "…").width > maxW && line.length > 2) line = line.slice(0, -1); c.fillText(line + "…", x, y + n * lh); return n + 1; }
        c.fillText(line, x, y + n * lh); n++; line = words[i];
      } else line = test;
    }
    if (line) { c.fillText(line, x, y + n * lh); n++; }
    return n;
  }
  function fit(c, text, maxW, size, face, weight) {
    var s = size;
    do { c.font = (weight ? weight + " " : "") + s + "px " + face; if (c.measureText(text).width <= maxW) break; s -= 4; } while (s > 28);
    return s;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function base(c, P, m) {
    c.fillStyle = P.bg; c.fillRect(0, 0, W, H);
    var g = c.createRadialGradient(W * 0.9, 0, 40, W * 0.9, 0, W * 1.1);
    g.addColorStop(0, "rgba(245,166,35,.22)"); g.addColorStop(1, "rgba(245,166,35,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillStyle = P.text2; c.font = "600 34px " + F_UI;
    c.fillText(("PintsNow · " + m.group).slice(0, 44), 72, 120);
    c.fillStyle = P.muted; c.textAlign = "right"; c.fillText(m.date, W - 72, 120); c.textAlign = "left";
    c.fillStyle = P.amberT; c.font = "700 34px " + F_UI; c.textAlign = "right"; c.fillText("pintsnow.com", W - 72, H - 80); c.textAlign = "left";
    c.fillStyle = P.amber; c.font = "44px " + F_ST; c.fillText("PintsNow", 72, H - 78);
  }
  function drawCard(cv, card, m) {
    var c = cv.getContext("2d"), P = pal();
    cv.width = W; cv.height = H;
    base(c, P, m);
    icon(c, card.icon || "moon", W - 520, H - 760, 480, "rgba(255,255,255,.06)", 1.6);
    var y = 640;
    c.fillStyle = P.amberT; c.font = "700 44px " + F_UI; c.fillText(String(card.kick || ""), 72, y); y += 40;
    if (card.type === "hero") {
      c.fillStyle = tok(colOf(card.p.k), P.amber); c.beginPath(); c.arc(72 + 90, y + 110, 90, 0, Math.PI * 2); c.fill();
      c.fillStyle = P.bg; c.font = "96px " + F_ST; c.textAlign = "center"; c.fillText(initial(card.p.name), 72 + 90, y + 145); c.textAlign = "left";
      c.fillStyle = P.text; var s = fit(c, card.title, W - 72 - 300, 110, F_ST); c.fillText(card.title, 300, y + 110);
      c.fillStyle = P.text2; c.font = "400 40px " + F_UI; wrap(c, card.sub, 300, y + 170, W - 372, 50, 2);
      y += 320; void s;
    } else if (card.type === "intro") {
      c.fillStyle = P.text; c.font = "120px " + F_ST; y += 110 + (wrap(c, card.title, 72, y + 110, W - 144, 128, 3) - 1) * 128;
      c.fillStyle = P.text2; c.font = "400 44px " + F_UI; c.fillText(card.sub, 72, y + 50); y += 130;
    } else if (card.type === "num") {
      y += 40;
      card.stats.forEach(function (s, i) {
        var bw = (W - 144 - 24) / 2, bx = 72 + (i % 2) * (bw + 24), by = y + Math.floor(i / 2) * 230;
        rr(c, bx, by, bw, 206, 24); c.fillStyle = P.card; c.fill();
        c.fillStyle = P.text; c.font = "96px " + F_ST; c.fillText(s[0], bx + 32, by + 118);
        c.fillStyle = P.muted; c.font = "400 38px " + F_UI; c.fillText(s[1], bx + 32, by + 172);
      });
      y += 500;
    } else if (card.type === "story") {
      y += 30;
      card.items.slice(0, 8).forEach(function (e) {
        c.fillStyle = P.amberT; c.font = "700 38px " + F_UI; c.fillText(hm(e.t), 72, y + 40);
        icon(c, e.icon, 200, y + 6, 40, P.text2, 2);
        c.fillStyle = P.text; c.font = "400 38px " + F_UI; var n = wrap(c, e.text, 264, y + 40, W - 336, 48, 2);
        y += 40 + n * 48 + 18;
      });
    } else if (card.lines) {
      y += 20;
      if (card.sub) { c.fillStyle = P.muted; c.font = "400 38px " + F_UI; c.fillText(card.sub, 72, y + 30); y += 70; }
      card.lines.forEach(function (l) { c.fillStyle = P.text; c.font = "600 50px " + F_UI; y += wrap(c, l, 72, y + 50, W - 144, 64, 3) * 64 + 30; });
    }
    if (card.line) { c.fillStyle = P.text; c.font = "600 52px " + F_UI; y += wrap(c, card.line, 72, y + 50, W - 144, 66, 3) * 66 + 30; }
    if (card.punch) {
      c.fillStyle = P.amber; c.fillRect(72, y + 6, 8, 64);
      c.fillStyle = P.text2; c.font = "400 46px " + F_UI; wrap(c, card.punch, 108, y + 54, W - 180, 60, 3);
    }
  }
  // The full share card (mock 3): group, route line between the bars, fuzzy home rings, 3 stats, every award.
  function drawShare(cv, m, opt) {
    var c = cv.getContext("2d"), P = pal();
    cv.width = W; cv.height = H;
    base(c, P, m);
    c.fillStyle = P.amberT; c.font = "700 40px " + F_UI; c.fillText(T("after.r2.intro.kick"), 72, 210);
    c.fillStyle = P.text; var gs = fit(c, m.group, W - 144, 120, F_ST); c.fillText(m.group, 72, 210 + gs + 10);
    c.fillStyle = P.text2; c.font = "400 44px " + F_UI;
    c.fillText(m.allHome ? T("after.r2.sh.allHome", { n: m.nOut, t: hm(m.lastHome) }) : T("after.r2.sh.out", { n: m.nOut }), 72, 210 + gs + 80);
    var top = 470, mh = 700, pts = m.route.filter(function (s) { return s.ok; });
    if (opt.route && pts.length) drawMap(c, P, m, pts, 0, top, W, mh);
    else { c.fillStyle = "rgba(255,255,255,.03)"; c.fillRect(0, top, W, mh); icon(c, "map", W / 2 - 120, top + mh / 2 - 120, 240, "rgba(255,255,255,.08)", 1.6); }
    var y = top + mh + 40, bw = (W - 144 - 48) / 3;
    [[String(m.bars), T("after.r2.num.bars")], [dec1(m.km), T("after.r2.num.km")], [String(m.skal), T("after.r2.num.skal")]].forEach(function (s, i) {
      var bx = 72 + i * (bw + 24);
      rr(c, bx, y, bw, 180, 24); c.strokeStyle = P.raised; c.lineWidth = 3; c.stroke();
      c.fillStyle = P.text; c.font = "84px " + F_ST; c.fillText(s[0], bx + 28, y + 100);
      c.fillStyle = P.muted; c.font = "400 34px " + F_UI; c.fillText(s[1], bx + 28, y + 150);
    });
    y += 240;
    var rows = m.people.slice(0, 8), rh = Math.min(64, Math.floor((H - 200 - y) / Math.max(1, rows.length)));
    rows.forEach(function (p) {
      icon(c, p.aw.icon, 72, y, 44, P.amber, 2.2);
      c.fillStyle = P.text; c.font = "700 " + Math.min(40, rh - 18) + "px " + F_UI; c.fillText(p.aw.name, 140, y + 36);
      if (opt.names) { c.fillStyle = P.text2; c.font = "400 " + Math.min(40, rh - 18) + "px " + F_UI; c.textAlign = "right"; c.fillText(p.name.slice(0, 18), W - 72, y + 36); c.textAlign = "left"; }
      y += rh;
    });
  }
  function drawMap(c, P, m, pts, x0, y0, w, h) {
    c.save();
    c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    c.fillStyle = "rgba(255,255,255,.025)"; c.fillRect(x0, y0, w, h);
    c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 2;
    for (var gx = x0; gx <= x0 + w; gx += 90) { c.beginPath(); c.moveTo(gx, y0); c.lineTo(gx, y0 + h); c.stroke(); }
    for (var gy = y0; gy <= y0 + h; gy += 90) { c.beginPath(); c.moveTo(x0, gy); c.lineTo(x0 + w, gy); c.stroke(); }
    // bounding box: the bars, plus home rings within 5 km of a bar
    var mid = { lat: pts.reduce(function (s, p) { return s + p.lat; }, 0) / pts.length, lng: pts.reduce(function (s, p) { return s + p.lng; }, 0) / pts.length };
    var homes = m.homes.filter(function (hh) { return km(mid, hh) < 2; });
    var all = pts.concat(homes), la0 = 90, la1 = -90, ln0 = 180, ln1 = -180;
    all.forEach(function (p) { la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); ln0 = Math.min(ln0, p.lng); ln1 = Math.max(ln1, p.lng); });
    var kx = Math.cos((la0 + la1) / 2 * Math.PI / 180), pad = 150;
    var spanX = Math.max((ln1 - ln0) * kx, 0.004), spanY = Math.max(la1 - la0, 0.004);
    var sc = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    var cx = (ln0 + ln1) / 2, cy = (la0 + la1) / 2;
    function px(p) { return { x: x0 + w / 2 + (p.lng - cx) * kx * sc, y: y0 + h / 2 - (p.lat - cy) * sc }; }
    var ringR = Math.max(36, Math.min(160, 0.00225 * sc));   // 250 m radius (~500 m across)
    homes.forEach(function (hh) {
      var q = px(hh);
      c.beginPath(); c.arc(q.x, q.y, ringR, 0, Math.PI * 2); c.fillStyle = "rgba(74,163,255,.10)"; c.fill();
      c.setLineDash([10, 10]); c.strokeStyle = "rgba(140,198,255,.45)"; c.lineWidth = 3; c.stroke(); c.setLineDash([]);
    });
    // the soft route line (bars only, they are public places)
    var q0 = pts.map(px);
    c.lineCap = "round"; c.lineJoin = "round";
    c.strokeStyle = "rgba(245,166,35,.18)"; c.lineWidth = 26; c.beginPath(); q0.forEach(function (q, i) { if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.stroke();
    c.setLineDash([2, 22]); c.strokeStyle = P.amber; c.lineWidth = 12; c.beginPath(); q0.forEach(function (q, i) { if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.stroke(); c.setLineDash([]);
    // markers first, then each label at the first free spot (below, above, right, left) so labels never overlap
    var used = q0.map(function (q) { return { x: q.x - 32, y: q.y - 32, w: 64, h: 64 }; });
    function hit(r) { return used.some(function (u) { return r.x < u.x + u.w && r.x + r.w > u.x && r.y < u.y + u.h && r.y + r.h > u.y; }); }
    q0.forEach(function (q, i) {
      c.beginPath(); c.arc(q.x, q.y, 30, 0, Math.PI * 2); c.fillStyle = P.amber; c.fill();
      c.fillStyle = P.onAmber; c.font = "700 32px " + F_UI; c.textAlign = "center"; c.fillText(String(i + 1), q.x, q.y + 11); c.textAlign = "left";
    });
    q0.forEach(function (q, i) {
      var lab = (pts[i].name || "").slice(0, 20) + (pts[i].at ? " " + hm(pts[i].at) : "");
      c.font = "700 32px " + F_UI;
      var lw = c.measureText(lab).width + 32, lh = 50, best = null;
      [[q.x - lw / 2, q.y + 42], [q.x - lw / 2, q.y - 42 - lh], [q.x + 42, q.y - lh / 2], [q.x - 42 - lw, q.y - lh / 2],
       [q.x - lw / 2, q.y + 42 + 60], [q.x - lw / 2, q.y - 102 - lh]].some(function (o) {
        var r = { x: Math.max(x0 + 16, Math.min(x0 + w - lw - 16, o[0])), y: Math.max(y0 + 12, Math.min(y0 + h - 60, o[1])), w: lw, h: lh };
        if (!best) best = r;
        if (!hit(r)) { best = r; return true; }
        return false;
      });
      used.push(best);
      rr(c, best.x, best.y, lw, lh, 12); c.fillStyle = "rgba(10,15,28,.9)"; c.fill();
      c.fillStyle = P.text; c.fillText(lab, best.x + 16, best.y + 36);
    });
    c.restore();
    if (homes.length) { c.fillStyle = P.muted; c.font = "400 28px " + F_UI; c.fillText(T("after.r2.sh.rings"), x0 + 24, y0 + h - 22); }
  }
  function toBlob(cv) { return new Promise(function (res) { try { cv.toBlob(function (b) { res(b); }, "image/png"); } catch (e) { res(null); } }); }
  function deliver(cv, fname, text, saveOnly) {
    return toBlob(cv).then(function (blob) {
      if (!blob) { if (A) A.toast(T("after.r2.fail"), { err: true }); return "fail"; }
      var file = null;
      try { if (typeof File === "function") file = new File([blob], fname, { type: "image/png" }); } catch (e) { file = null; }
      var can = false;
      try { can = !saveOnly && !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { can = false; }
      try { if (window.PNLOG) window.PNLOG.event("after2.share", { how: can ? "share" : "save" }); } catch (e) {}
      if (can) return navigator.share({ files: [file], text: text, title: "PintsNow" }).then(function () { return "shared"; }, function () { return "cancel"; });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (!saveOnly && A && A.copyText) A.copyText(text);
      return "saved";
    });
  }
  function shareText(m) { return T("after.r2.sh.text", { group: m.group }); }
  function shareCard(i) {
    if (!st) return;
    var m = st.m, card = m.cards[i], cv = document.createElement("canvas");
    fontsReady().then(function () {
      try { if (card.type === "end") drawShare(cv, m, st ? st.opt : { names: true, route: true }); else drawCard(cv, card, m); } catch (e) {}
      deliver(cv, "pintsnow-kvallen-" + (i + 1) + ".png", shareText(m), false);
    });
  }
  function openShare() {
    if (!st) return;
    var box = document.createElement("div");
    box.className = "a2-sh";
    box.innerHTML = '<div class="a2-sh-card" role="dialog" aria-label="' + esc(T("after.r2.shareAll")) + '">' +
      '<div class="a2-sh-head"><span>' + esc(T("after.r2.sh.lead")) + '</span><button type="button" class="a2-x" data-a2="shx" aria-label="' + esc(T("after.r2.close")) + '">' + pni("x") + "</button></div>" +
      '<canvas class="a2-sh-cv" width="1080" height="1920" role="img" aria-label="' + esc(T("after.r2.title")) + '"></canvas>' +
      '<div class="a2-sw-list">' +
      ["names", "route"].map(function (k) {
        return '<button type="button" class="a2-sw-row" role="switch" data-a2="sw" data-k="' + k + '" aria-checked="' + !!st.opt[k] + '"><span>' + esc(T("after.r2.sh." + k)) + '</span><i class="a2-sw" aria-hidden="true"></i></button>';
      }).join("") + "</div>" +
      '<div class="a2-row"><button type="button" class="a2-btn a2-pri" data-a2="send">' + pni("share") + "<span>" + esc(T("after.r2.shareAll")) + "</span></button>" +
      '<button type="button" class="a2-btn a2-sq" data-a2="save" aria-label="' + esc(T("after.r2.save")) + '">' + pni("download") + "</button></div></div>";
    root.appendChild(box);
    st.sh = box;
    drawPreview();
  }
  function drawPreview() {
    if (!st || !st.sh) return;
    var cv = st.sh.querySelector(".a2-sh-cv"); if (!cv) return;
    fontsReady().then(function () { if (st && st.sh) { try { drawShare(cv, st.m, st.opt); } catch (e) {} } });
  }
  function closeShare() { if (st && st.sh) { st.sh.remove(); st.sh = null; } }
  function sendShare(saveOnly) {
    if (!st || !st.sh) return;
    var cv = st.sh.querySelector(".a2-sh-cv"), m = st.m;
    fontsReady().then(function () { try { drawShare(cv, m, st.opt); } catch (e) {} return deliver(cv, "pintsnow-kvallsrapport.png", shareText(m), saveOnly); });
  }

  /* ---------- ways in ---------- */
  function openFor(gid, night, keep) {
    return load(gid || null, night || null).then(function (d) {
      if (!d) { if (A && !off) A.toast(T("after.r2.fail"), { err: true }); return false; }
      if (!usable(d)) { if (A) A.toast(T("after.r2.empty"), { cls: "water", ms: 5000 }); return false; }
      var m = model(d);
      if (keep && st) { st.m = m; st.i = 0; st.night = m.night; paint(); return true; }
      open(m); return true;
    });
  }
  // after.js onReadyShow: the morning (05–18 Stockholm). true = the report is there (after.js then skips the auto Bakis sheet).
  function morning() {
    if (off || !A || !A.LIVE || !A.authed || !A.authed()) return Promise.resolve(false);
    var h = +(hm(Date.now()).slice(0, 2));
    if (!(h >= 5 && h < 18)) return Promise.resolve(false);
    var day = String(lsGet(DAY) || "");
    if (day === today() + "|seen") return Promise.resolve(true);   // seen this morning: no RPC, no Bakis sheet
    if (day === today() + "|none") return Promise.resolve(false);  // no report today: the old morning card
    return load(null, null).then(function (d) {
      if (!d) return false;
      if (!usable(d)) { lsSet(DAY, today() + "|none"); return false; }
      pending = { gid: d.group.id, night: d.night, group: d.group.name };
      if (lsGet(SEEN) === String(d.night)) { pending = null; return true; }
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
      var say = function () {
        A.toast(T("after.r2.ready", { group: d.group.name }), { ms: 12000, action: { label: T("after.r2.show"), fn: function () { openFor(d.group.id, d.night); } } });
      };
      if (A.sheetOpen && A.sheetOpen()) { var t0 = Date.now(); (function tick() { if (!A.sheetOpen()) say(); else if (Date.now() - t0 < 10 * 60000) setTimeout(tick, 1500); })(); }
      else setTimeout(say, 1200);
      return true;
    });
  }
  function chipHTML() {
    if (!pending || off || st) return "";
    var h = +(hm(Date.now()).slice(0, 2)); if (!(h >= 5 && h < 18)) return "";
    return '<button type="button" class="hx-chip a2-chip" data-hx="a2" aria-label="' + esc(T("after.r2.ready", { group: pending.group })) + '">' + pni("medal", "pi-lead") + esc(T("after.r2.chip")) + "</button>";
  }
  // For the group page (social lane places it): one row "Kvällsrapporten · fre 7 nov", tap = the cards. null when nothing.
  function groupCard(g) {
    if (off || !A || !g || !g.id) return null;
    var row = document.createElement("button");
    row.type = "button"; row.className = "a2-gcard"; row.hidden = true;
    load(g.id, null).then(function (d) {
      if (!usable(d) || String(d.group.id) !== String(g.id)) { row.remove(); return; }
      var m = model(d), cap = m.people.filter(function (p) { return p.aw.id === "kapten" || p.aw.id === "jarn"; })[0];
      row.innerHTML = '<span class="a2-gc-i">' + pni("medal") + '</span><span class="a2-gc-x"><b>' + esc(T("after.r2.title") + " · " + m.date) + "</b><span>" +
        esc(T("after.r2.sh.out", { n: m.nOut }) + (cap ? " · " + cap.aw.name + ": " + cap.name : "")) + "</span></span>" + pni("chev-right", "a2-chev");
      row.hidden = false;
      row.onclick = function () { open(m); };
    });
    return row;
  }
  function route0(url) {
    var q; try { q = new URL(url, location.href).searchParams; } catch (e) { return false; }
    var g = q.get("after"); if (!g || !/^[0-9a-f-]{36}$/i.test(g)) return false;
    var n = q.get("night");
    setTimeout(function () { openFor(g, n && isFinite(Date.parse(n)) ? n : null); }, 150);
    return true;
  }
  try {
    var q0 = new URLSearchParams(location.search), g0 = q0.get("after");
    if (g0 && /^[0-9a-f-]{36}$/i.test(g0)) {
      deep = { g: g0, n: q0.get("night") };
      q0.delete("after"); q0.delete("night");
      var qs = q0.toString(); history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }
  } catch (e) {}
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) {
    var d = e.data || {}; if (d.type === "olnu-open" && d.url) route0(d.url);
  });

  window.AFTER2 = {
    open: openFor, openFor: openFor, morning: morning, chipHTML: chipHTML, groupCard: groupCard, off: function () { return off; },
    hudClick: function () { if (pending) openFor(pending.gid, pending.night); },
    init: function (api) { A = api; },
    onAuthed: function () { if (deep) { var x = deep; deep = null; setTimeout(function () { openFor(x.g, x.n); }, 600); } },
    // test hooks
    _model: model, _awards: function (ps) { return awards(people({ people: ps })).map(function (p) { return { k: p.k, id: p.aw.id, name: p.aw.name }; }); },
    _drawShare: drawShare, _drawCard: drawCard, _st: function () { return st; }
  };
})();
