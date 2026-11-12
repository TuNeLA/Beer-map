/* PintsNow — shared address / place search (I-07). One helper for Hemzon and the ride destination.
   Why: Nominatim with limit=1 and no viewbox jumped "Storgatan 5" to a random town. Now:
   - results near the map centre / my position come first (bounded viewbox, then an unbounded fallback), SE only, sv;
   - a list of up to 5 "Gata 5 · Ort" under the field; nothing moves until the user picks one; Enter = the first result;
   - cache in memory (10 min), one request at a time (an older answer never overwrites a newer one).
   Engines (OLNU_CONFIG.placeSearch or window.PN_CFG.placeSearch):
   - "nominatim" (default): the usage policy forbids search-as-you-type, so it searches only on Sök / Enter.
   - "mapbox": Geocoding v6 TEMPORARY (autocomplete=true), live suggestions, debounce 300 ms. Terms: search-as-you-type is
     allowed for temporary geocoding; free 100 000 requests/month; the results may NOT be stored → memory cache only.
     Falls back to nominatim when there is no pk token or Mapbox answers with an error.
   API: PN.placeSearch.query(q, {center}) → Promise<hit[]>;  PN.placeSearch.attach({input, button, host, center, onPick, subOf, state}) → ctl.
   hit = {title, sub, lat, lng, addr (raw Nominatim address or null), src}. */
(function () {
  "use strict";
  var NOM = "https://nominatim.openstreetmap.org/search", MB = "https://api.mapbox.com/search/geocode/v6/forward";
  var cache = {}, cacheN = 0, TTL = 10 * 60e3, MAXC = 60;
  function cfg() { var c = window.PN_CFG || window.OLNU_CONFIG || {}; return c; }
  function engine() {
    var c = window.PN_CFG && window.PN_CFG.placeSearch || window.OLNU_CONFIG && window.OLNU_CONFIG.placeSearch;
    return c === "mapbox" && token() ? "mapbox" : "nominatim";
  }
  function token() {
    var t = ""; try { t = (window.OLNU_CONFIG && window.OLNU_CONFIG.MAPBOX_TOKEN) || localStorage.getItem("olnu.mbToken") || ""; } catch (e) {}
    return /^pk\./.test(t) ? t : "";
  }
  function ok(c) { return c && isFinite(c.lat) && isFinite(c.lng) ? { lat: +c.lat, lng: +c.lng } : null; }
  function dist(a, b) { var r = Math.PI / 180, x = (b.lng - a.lng) * Math.cos((a.lat + b.lat) * r / 2), y = b.lat - a.lat; return Math.sqrt(x * x + y * y) * 111.2; }   // km, flat is enough
  function town(a) { a = a || {}; return a.city || a.town || a.village || a.municipality || a.suburb || a.hamlet || a.county || ""; }
  function fromNom(x) {
    var a = x.address || {}, la = +x.lat, lo = +x.lon, road = a.road || a.pedestrian || a.footway || "", nr = a.house_number || "";
    var street = road ? road + (nr ? " " + nr : "") : "";
    var poi = x.name && x.name !== road && x.name !== street ? String(x.name) : "";
    var t = town(a), title = poi || street || String(x.display_name || "").split(",")[0] || "";
    var sub = poi ? [street, t].filter(Boolean).join(", ") : t;
    return { title: title.slice(0, 60), sub: sub.slice(0, 80), lat: la, lng: lo, addr: a, src: "nom" };
  }
  function fromMb(f) {
    var p = f.properties || {}, g = f.geometry && f.geometry.coordinates || [], c = p.context || {};
    var t = c.place && c.place.name || c.locality && c.locality.name || c.district && c.district.name || "";
    var title = p.name_preferred || p.name || "", sub = p.feature_type === "place" ? (c.region && c.region.name || "") : t;
    if (p.feature_type === "address" && p.address) title = p.address;
    return { title: String(title).slice(0, 60), sub: String(sub).slice(0, 80), lat: +g[1], lng: +g[0], addr: null, src: "mb" };
  }
  function getJSON(url, signal) { return fetch(url, { signal: signal, credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); }); }
  function viewbox(c) { return [(c.lng - 0.6).toFixed(3), (c.lat + 0.3).toFixed(3), (c.lng + 0.6).toFixed(3), (c.lat - 0.3).toFixed(3)].join(","); }
  function nominatim(q, c, signal) {
    var base = NOM + "?format=jsonv2&limit=5&addressdetails=1&countrycodes=se&accept-language=sv&q=" + encodeURIComponent(q);
    function go(extra) { return getJSON(base + extra, signal).then(function (j) { return Array.isArray(j) ? j.map(fromNom) : []; }); }
    if (!c) return go("");
    // 1) only inside the viewbox around the map centre / me  2) if that gives < 5, everywhere in Sweden but still ranked toward the viewbox
    return go("&viewbox=" + viewbox(c) + "&bounded=1").then(function (near) {
      if (near.length >= 5) return near;
      return go("&viewbox=" + viewbox(c)).then(function (all) { return merge(near, all, c); }, function () { return near; });
    });
  }
  function merge(near, all, c) {
    var out = near.slice(), seen = {};
    out.forEach(function (h) { seen[h.lat.toFixed(4) + "," + h.lng.toFixed(4)] = 1; });
    all.slice().sort(function (a, b) { return dist(c, a) - dist(c, b); }).forEach(function (h) { var k = h.lat.toFixed(4) + "," + h.lng.toFixed(4); if (!seen[k]) { seen[k] = 1; out.push(h); } });
    return out.slice(0, 5);
  }
  function mapbox(q, c, signal) {
    var u = MB + "?q=" + encodeURIComponent(q) + "&autocomplete=true&country=se&language=sv&limit=5&types=address,street,place,locality,neighborhood&access_token=" + token();
    if (c) u += "&proximity=" + c.lng.toFixed(4) + "," + c.lat.toFixed(4);
    return getJSON(u, signal).then(function (j) { return ((j && j.features) || []).map(fromMb); });
  }
  function clean(l) { return (l || []).filter(function (h) { return isFinite(h.lat) && isFinite(h.lng) && h.title; }).slice(0, 5); }
  function query(q, o) {
    o = o || {}; q = String(q || "").trim(); if (q.length < 3) return Promise.resolve([]);
    var c = ok(o.center), eng = o.engine || engine(), key = eng + "|" + q.toLowerCase() + "|" + (c ? c.lat.toFixed(2) + "," + c.lng.toFixed(2) : ""), e = cache[key];
    if (e && Date.now() - e.at < TTL) return Promise.resolve(e.list);
    var run = eng === "mapbox" ? mapbox(q, c, o.signal).catch(function () { return nominatim(q, c, o.signal); }) : nominatim(q, c, o.signal);
    return run.then(function (l) {
      l = clean(l);
      if (l.length) { if (cacheN >= MAXC) { cache = {}; cacheN = 0; } cache[key] = { at: Date.now(), list: l }; cacheN++; }
      return l;
    });
  }
  var CSS = ".ps-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:4px}.ps-list[hidden],.ps-msg[hidden]{display:none}" +
    ".ps-hit{display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:48px;padding:4px 12px;border:0;border-radius:12px;background:var(--ds-card,#222);color:var(--ds-text,#fff);text-align:left;cursor:pointer;box-sizing:border-box;font:inherit}" +
    ".ps-hit:focus-visible{outline:2px solid var(--ds-amber-t,#f5a623)}.ps-t{font:600 16px/22px var(--ds-sans,system-ui);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".ps-s{font:400 12px/16px var(--ds-sans,system-ui);color:var(--ds-muted,#aaa)}.ps-msg{margin:0 0 8px;font:400 14px/20px var(--ds-sans,system-ui);color:var(--ds-muted,#aaa)}";
  try { var st0 = document.createElement("style"); st0.textContent = CSS; document.head.appendChild(st0); } catch (e) {}
  function sv() { return !window.I18N || window.I18N.lang !== "en"; }
  function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  /* attach to a text field. o.input, o.button (optional "Sök"), o.host (the list is inserted after it), o.center() → {lat,lng},
     o.onPick(hit), o.subOf(hit) (optional label), o.state {q, hits} (survives a re-render), o.onBusy(bool) */
  function attach(o) {
    var input = o.input, st = o.state || {}, ul = mk("ul", "ps-list"), msg = mk("p", "ps-msg"), seq = 0, timer = 0, ctl = null, lastQ = "";
    ul.setAttribute("role", "listbox"); msg.setAttribute("role", "status"); ul.hidden = true; msg.hidden = true;
    if (o.host && o.host.parentNode) { o.host.parentNode.insertBefore(msg, o.host.nextSibling); o.host.parentNode.insertBefore(ul, msg.nextSibling); }
    function paint() {
      ul.innerHTML = ""; var l = st.hits || [];
      l.forEach(function (h) {
        var li = mk("li"), b = mk("button", "ps-hit"); b.type = "button"; b.setAttribute("role", "option");
        b.appendChild(mk("b", "ps-t", h.title)); var s = o.subOf ? o.subOf(h) : h.sub; if (s) b.appendChild(mk("small", "ps-s", s));
        b.addEventListener("click", function () { pick(h); }); li.appendChild(b); ul.appendChild(li);
      });
      ul.hidden = !l.length;
    }
    function say(t) { msg.textContent = t || ""; msg.hidden = !t; }
    function pick(h) { st.hits = null; paint(); say(""); if (o.onPick) o.onPick(h); }
    function run(q, live) {
      q = String(q || "").trim(); if (q.length < 3) return Promise.resolve([]);
      var my = ++seq; lastQ = q; st.q = q; if (o.onBusy) o.onBusy(true); say(live ? "" : (sv() ? "Söker …" : "Searching …"));
      var c = null; try { c = o.center && o.center(); } catch (e) {}
      return query(q, { center: c }).then(function (l) {
        if (my !== seq) return l; if (o.onBusy) o.onBusy(false);
        st.hits = l; paint(); say(l.length ? "" : (sv() ? "Hittade inget. Skriv gatan och orten." : "Nothing found. Add the town."));
        return l;
      }, function () { if (my !== seq) return []; if (o.onBusy) o.onBusy(false); st.hits = null; paint(); say(sv() ? "Sökningen gick int'. Försök igen." : "Search failed. Try again."); return []; });
    }
    function submit() {   // Sök / Enter: a list already shown for this text → the first result; else search
      var q = String(input.value || "").trim();
      if (st.hits && st.hits.length && q === lastQ) { pick(st.hits[0]); return; }
      clearTimeout(timer);
      run(q, false).then(function (l) { if (engine() === "mapbox" && l.length && String(input.value || "").trim() === q) pick(l[0]); });   // live engine: Enter = the first result
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    input.addEventListener("input", function () {
      if (String(input.value || "").trim() !== lastQ) { st.hits = null; paint(); }
      if (engine() !== "mapbox") return;   // Nominatim: never search-as-you-type (usage policy)
      clearTimeout(timer); timer = setTimeout(function () { run(input.value, true); }, 300);
    });
    if (o.button) o.button.addEventListener("click", function () { submit(); });
    if (st.q && !input.value) input.value = st.q;
    if (st.hits) { lastQ = st.q || ""; paint(); }
    ctl = { run: run, submit: submit, pick: pick, clear: function () { st.hits = null; paint(); say(""); }, destroy: function () { clearTimeout(timer); ul.remove(); msg.remove(); } };
    return ctl;
  }
  window.PN = window.PN || {}; window.PN.placeSearch = { query: query, attach: attach, engine: engine, _clear: function () { cache = {}; cacheN = 0; } };
})();
