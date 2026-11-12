/* PintsNow — PLACECARD: what a restaurant / café / bar serves, its hours, price level and links (lane placesdata, 13 Nov).
   PN.placecard = { render(place, el), popupHTML(place), lineHTML, moreHTML, info, price, init(api) }. No window global, no hook module:
   the bar sheet calls PN.placecard.popupHTML(bar) (ONE line in app-pins.js barPopup, see the lane DONE.md).
   - Data: docs/placeinfo/ (scripts/build-placeinfo.mjs, weekly "Bars (OpenStreetMap)" Action): index.json (tile tree, same format as
     docs/places/) + one small tile per area, loaded only when a card opens. Row [h, c, f, u, p, s] (see scripts/placeinfo.mjs):
     h hours "Mo|Tu|…" (day = "660-1320,…"), c cuisine "pizza;kebab", f flags, u website, p phone, s fields from Overture Maps.
   - Hours: js/oppet.js parser (OPPET.status). Bars / late food: OPPET.barStatus (hours.json + tonight's user report) wins.
     "Öppet nu · stänger 22:00" / "Stängt · öppnar 11:00". The bar sheet line of js/barinfo.js already shows bar hours: the popup
     line here adds hours only when barinfo has none (restaurants), so nothing is shown twice. render() always shows them.
   - $ / $$ / $$$ (bars only): OUR OWN signal. Crowd-reported "stor stark" price of this bar (bar_prices_in, as js/barinfo.js) vs the
     median of the priced bars around it (one RPC per 0.2° × 0.4° cell, box ±0.2° × ±0.4° around the cell centre ≈ the town and
     its region; cached 10 min). Needs ≥ 5 priced bars there. ≤ 0.9 × median = $, ≥ 1.1 × = $$$, else $$. No open data source has a
     legal price level (Foursquare "price" = Premium tier only; Overture and OSM have none; Google Places may not be shown on a
     non-Google map). Restaurants get no $ until we have data.
     LEGAL (Alkohollagen 7 kap.): neutral info on ONE card. No ranking, no "cheapest" list, no filter, no push.
   - popupHTML: (1) an .ev-line under the title "[food] Pizza · Kebab · $$ · Öppet nu · stänger 22:00" and (2) a block for the
     Info fold: chips (Avhämtning, Uteservering, diet, wheelchair), website / phone buttons (PNI icons), source line
     "Data: © OpenStreetMap" (+ "· Overture Maps" when a field came from there). A tile not loaded yet = the parts fill in a moment later.
   - API for RPC: PN.rpc / PN.parseData / PN.LIVE / PN.s.authed (app-core), or init(api) with the app api.
   Missing files / RPC = the card hides quietly. Never breaks the map. Classes: plc-* (pc-* belongs to js/profilecard.js). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, ix = null, ixP = null, tiles = {}, tileP = {}, prices = {}, priceP = {}, off = {};
  var DRINK = { bar: 1, pub: 1, nightclub: 1, biergarten: 1 };
  var PRICE_MIN_BARS = 5, PRICE_TTL = 600000;
  var DSV = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"], DEN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // OSM cuisine value → [sv, en]
  var CU = {
    pizza: ["Pizza", "Pizza"], burger: ["Hamburgare", "Burgers"], sushi: ["Sushi", "Sushi"], kebab: ["Kebab", "Kebab"],
    coffee: ["Kafé", "Café"], thai: ["Thai", "Thai"], regional: ["Husman", "Local food"], swedish: ["Svensk husman", "Swedish"],
    asian: ["Asiatiskt", "Asian"], italian: ["Italienskt", "Italian"], sandwich: ["Smörgåsar", "Sandwiches"], indian: ["Indiskt", "Indian"],
    salad: ["Sallad", "Salads"], japanese: ["Japanskt", "Japanese"], chinese: ["Kinesiskt", "Chinese"], ice_cream: ["Glass", "Ice cream"],
    pasta: ["Pasta", "Pasta"], greek: ["Grekiskt", "Greek"], cake: ["Bakverk", "Cakes"], international: ["Internationellt", "International"],
    steak_house: ["Kött & grill", "Steakhouse"], fish: ["Fisk & skaldjur", "Seafood"], vietnamese: ["Vietnamesiskt", "Vietnamese"],
    grill: ["Grill", "Grill"], tapas: ["Tapas", "Tapas"], mexican: ["Mexikanskt", "Mexican"], falafel: ["Falafel", "Falafel"],
    american: ["Amerikanskt", "American"], chicken: ["Kyckling", "Chicken"], barbecue: ["BBQ", "BBQ"], lebanese: ["Libanesiskt", "Lebanese"],
    sausage: ["Korv", "Hot dogs"], french: ["Franskt", "French"], breakfast: ["Frukost", "Breakfast"], turkish: ["Turkiskt", "Turkish"],
    ramen: ["Ramen", "Ramen"], noodle: ["Nudlar", "Noodles"], middle_eastern: ["Mellanöstern", "Middle Eastern"], korean: ["Koreanskt", "Korean"],
    lunch: ["Lunch", "Lunch"], persian: ["Persiskt", "Persian"], dessert: ["Dessert", "Desserts"], tea: ["Te", "Tea"], spanish: ["Spanskt", "Spanish"],
    pancake: ["Pannkakor", "Pancakes"], arab: ["Arabiskt", "Arabic"], fine_dining: ["Fine dining", "Fine dining"], mediterranean: ["Medelhavsmat", "Mediterranean"],
    bakery: ["Bageri", "Bakery"], pastry: ["Bakverk", "Pastries"], diner: ["Diner", "Diner"], soup: ["Soppa", "Soup"], crepe: ["Crêpes", "Crêpes"],
    waffle: ["Våfflor", "Waffles"], bistro: ["Bistro", "Bistro"], poke: ["Poké", "Poké"], brunch: ["Brunch", "Brunch"], german: ["Tyskt", "German"],
    balkan: ["Balkan", "Balkan"], ethiopian: ["Etiopiskt", "Ethiopian"], juice: ["Juice", "Juice"], european: ["Europeiskt", "European"],
    meat: ["Kött", "Meat"], fries: ["Pommes", "Fries"], bagel: ["Bagels", "Bagels"], vegan: ["Veganskt", "Vegan"],
    vegetarian: ["Vegetariskt", "Vegetarian"], buffet: ["Buffé", "Buffet"], afghan: ["Afghanskt", "Afghan"], nepalese: ["Nepalesiskt", "Nepalese"],
    dumplings: ["Dumplings", "Dumplings"], chocolate: ["Choklad", "Chocolate"], hawaiian: ["Hawaiiskt", "Hawaiian"], peruvian: ["Peruanskt", "Peruvian"]
  };
  var FL = {
    t: ["Avhämtning", "Takeaway"], T: ["Bara avhämtning", "Takeaway only"], d: ["Hemleverans", "Delivery"],
    o: ["Uteservering", "Outdoor seating"], v: ["Vegetariskt", "Vegetarian"], V: ["Helt vegetariskt", "All vegetarian"],
    n: ["Veganskt", "Vegan"], N: ["Helt veganskt", "All vegan"], g: ["Glutenfritt", "Gluten free"], h: ["Halal", "Halal"],
    w: ["Rullstolsvänligt", "Wheelchair access"], l: ["Delvis tillgängligt", "Limited access"]
  };

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function O() { return window.OPPET || null; }
  function ico(n, cls) { try { return window.PNI && PNI.svg ? PNI.svg(n, "plc-i" + (cls ? " " + cls : "")) : ""; } catch (e) { return ""; } }
  // the app api: init(api) wins; else the app parts' exports on PN (app-core / app-net)
  function app() {
    if (A) return A;
    var P = window.PN;
    if (!P || !P.rpc) return null;
    return { LIVE: !!P.LIVE, rpc: P.rpc, parseData: P.parseData, authed: function () { return !!(P.s && P.s.authed); } };
  }
  function isDrink(p) { return !!(p && DRINK[p.type] && !p.place); }

  /* ---------- pure logic (unit tests: tests/unit/placeinfo.test.mjs) ---------- */
  function rowObj(r) {
    if (!Array.isArray(r)) return null;
    return { h: r[0] || "", c: r[1] || "", f: r[2] || "", u: r[3] || "", p: r[4] || "", s: r[5] || "" };
  }
  // "pizza;kebab" → "Pizza · Kebab" (max 3; an unknown value is shown as written, "_" → space)
  function cuisineLabel(c, max) {
    var out = [];
    String(c || "").split(";").forEach(function (k) {
      k = k.trim(); if (!k || out.length >= (max || 3)) return;
      var d = CU[k], t = d ? (sv() ? d[0] : d[1]) : k.replace(/_/g, " ").replace(/^./, function (x) { return x.toUpperCase(); });
      if (out.indexOf(t) < 0) out.push(t);
    });
    return out.length ? out.join(" · ") : "";
  }
  function median(a) {
    var s = a.filter(function (x) { return typeof x === "number" && isFinite(x) && x > 0; }).sort(function (x, y) { return x - y; });
    if (!s.length) return null;
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // kr = this bar's price, area = prices of the priced bars around (each bar once, may include this one) → {lvl 1..3, sym, med, n} | null
  function priceLevel(kr, area) {
    if (!(kr > 0) || !Array.isArray(area)) return null;
    var med = median(area), n = area.filter(function (x) { return x > 0; }).length;
    if (!med || n < PRICE_MIN_BARS) return null;
    var r = kr / med, lvl = r <= 0.9 ? 1 : r >= 1.1 ? 3 : 2;
    return { lvl: lvl, sym: ["$", "$$", "$$$"][lvl - 1], med: Math.round(med), n: n };
  }
  // OPPET.status result → "Öppet nu · stänger 22:00" / "Stängt · öppnar 11:00" (+ class)
  function hoursText(st) {
    if (!st || !st.known) return null;
    if (st.closedTonight) return { cls: "oh-shut", t: L("Stängt ikväll (rapporterat)", "Closed tonight (reported)") };
    if (st.open && st.always) return { cls: "oh-open", t: L("Öppet dygnet runt", "Open 24/7") };
    if (st.open) return { cls: st.closeIn <= 30 ? "oh-soon" : "oh-open", t: L("Öppet nu · stänger ", "Open now · closes ") + st.closeAt };
    if (st.opensAt == null) return { cls: "oh-shut", t: L("Stängt", "Closed") };
    var when = st.opensDay === 0 || (st.opensDay === 1 && st.opensIn < 720) ? st.opensAt :
      st.opensDay === 1 ? L("i morgon ", "tomorrow ") + st.opensAt : (sv() ? DSV : DEN)[st.opensDow] + " " + st.opensAt;
    return { cls: "oh-shut", t: L("Stängt · öppnar ", "Closed · opens ") + when };
  }
  function statusFor(place, info, ms) {
    var o = O(); if (!o) return null;
    var st = null;
    try { st = o.barStatus ? o.barStatus(place, ms) : null; } catch (e) { st = null; }
    if (!st && info && info.h) { var w = info.h.split("|"); if (w.length === 7) st = o.status(w, ms); }
    return st;
  }
  function webHref(u) { return !u ? "" : /^https?:\/\//i.test(u) ? u : "https://" + u; }
  function telHref(p) { return p ? "tel:" + String(p).replace(/[^\d+]/g, "") : ""; }

  /* ---------- data ---------- */
  function leafKey(lat, lng) {
    if (!ix || !ix.t || !Array.isArray(ix.b)) return null;
    var BL = ix.b[0], BW = ix.b[1], y = Math.floor(lat / BL), x = Math.floor(lng / BW), k = y + "_" + x, node = ix.t[k];
    var s = y * BL, w = x * BW, h = BL, wd = BW;
    for (var d = 0; d < 12 && Array.isArray(node); d++) {
      h /= 2; wd /= 2;
      var i = (lat >= s + h ? 2 : 0) + (lng >= w + wd ? 1 : 0);
      if (i >= 2) s += h;
      if (i % 2) w += wd;
      k += "-" + i; node = node[i];
    }
    return node === 1 ? k : null;
  }
  function getJSON(url, opt) { return fetch(url, opt).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); }
  function loadIndex() {
    if (!ixP) ixP = getJSON("./placeinfo/index.json", { cache: "no-cache" }).then(function (d) { ix = d; return d; }, function () { ix = null; return null; });
    return ixP;
  }
  function infoSync(place) {
    if (!place || !ix || !isFinite(place.lat)) return undefined;
    var k = leafKey(place.lat, place.lng);
    if (!k) return null;
    if (!tiles[k]) return undefined;
    return rowObj(tiles[k][String(place.id)]);
  }
  // → Promise<info | null>
  function info(place) {
    if (!place || !isFinite(place.lat) || !isFinite(place.lng)) return Promise.resolve(null);
    return loadIndex().then(function () {
      var k = leafKey(place.lat, place.lng);
      if (!k) return null;
      if (!tileP[k]) tileP[k] = getJSON("./placeinfo/" + k + ".json").then(function (d) { tiles[k] = d || {}; }, function () { tiles[k] = {}; });
      return tileP[k].then(function () { return rowObj(tiles[k][String(place.id)]); });
    });
  }
  var call = U.rpcCall(app, off, { authed: true, safe: true });   // missing RPC → off (util.js)
  function priceBox(p) { return Math.floor(p.lat / 0.2) + "_" + Math.floor(p.lng / 0.4); }
  function priceSync(place) {
    var b = prices[priceBox(place)]; if (!b) return null;
    var kr = b.byId[String(place.id)];
    return kr ? priceLevel(kr, b.list) : null;
  }
  // bar_prices_in around the bar (same RPC and rule as js/barinfo.js price tags; authed). → Promise<level | null>
  function price(place) {
    var a = app();
    if (!isDrink(place) || !a || !a.LIVE || off.bar_prices_in || !a.authed() || !isFinite(place.lat)) return Promise.resolve(null);
    var k = priceBox(place), b = prices[k];
    if (b && Date.now() - b.at < PRICE_TTL) return Promise.resolve(priceSync(place));
    if (!priceP[k]) {
      var c = { lat: Math.floor(place.lat / 0.2) * 0.2 + 0.1, lng: Math.floor(place.lng / 0.4) * 0.4 + 0.2 };
      priceP[k] = call("bar_prices_in", { p_s: c.lat - 0.2, p_w: c.lng - 0.4, p_n: c.lat + 0.2, p_e: c.lng + 0.4 }).then(function (r) {
        delete priceP[k];
        if (!r || r.error) { prices[k] = { at: Date.now(), byId: {}, list: [] }; return; }
        var list = a.parseData ? a.parseData(r.data) : r.data, byId = {}, krs = [];
        (Array.isArray(list) ? list : []).forEach(function (x) { if (x && x.bar_id != null && x.kr > 0) { byId[String(x.bar_id)] = +x.kr; krs.push(+x.kr); } });
        prices[k] = { at: Date.now(), byId: byId, list: krs };
      }, function () { delete priceP[k]; });
    }
    return priceP[k].then(function () { return priceSync(place); });
  }

  /* ---------- HTML ---------- */
  var DOT = '<i class="plc-dot" aria-hidden="true">·</i>';
  function cuisineHTML(i) {
    var c = i && cuisineLabel(i.c);
    return c ? '<span class="plc-cui">' + ico("food") + "<span>" + esc(c) + "</span></span>" : "";
  }
  function priceHTML(lv) {
    if (!lv) return "";
    var tip = L("Prisnivå: stor stark jämfört med orten (snitt ", "Price level: large beer vs the town (median ") + lv.med + " kr)";
    return '<span class="plc-pr plc-pr' + lv.lvl + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + lv.sym + "</span>";
  }
  function hoursHTML(ht) { return ht ? '<span class="plc-oh ' + ht.cls + '">' + ico("clock") + "<span>" + esc(ht.t) + "</span></span>" : ""; }
  function chipsHTML(place, i) {
    if (!i || !i.f) return "";
    var out = [];
    i.f.split("").forEach(function (c) {
      if (!FL[c] || (c === "o" && place && place.outdoor)) return;   // a bar with outdoor = js/ute.js shows it already
      out.push('<span class="plc-chip" data-f="' + c + '">' + esc(sv() ? FL[c][0] : FL[c][1]) + "</span>");
    });
    return out.length ? '<div class="plc-chips">' + out.join("") + "</div>" : "";
  }
  function btnsHTML(i) {
    if (!i || (!i.u && !i.p)) return "";
    var b = "";
    if (i.u) b += '<a class="btn plc-btn plc-web" href="' + esc(webHref(i.u)) + '" target="_blank" rel="noopener nofollow">' + ico("globe") + "<span>" + esc(L("Webbplats", "Website")) + "</span></a>";
    if (i.p) b += '<a class="btn plc-btn plc-tel" href="' + esc(telHref(i.p)) + '">' + ico("phone") + "<span>" + esc(L("Ring ", "Call ") + i.p) + "</span></a>";
    return '<div class="plc-btns">' + b + "</div>";
  }
  function srcHTML(i) {
    return '<div class="plc-src">Data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>' +
      (i && i.s ? ' · <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noopener">Overture Maps</a>' : "") + "</div>";
  }
  // The popup line under the title. withHours: false when js/barinfo.js shows the hours already.
  function lineInner(place, i, lv, withHours) {
    return [cuisineHTML(i), priceHTML(lv), withHours ? hoursHTML(hoursText(statusFor(place, i))) : ""].filter(Boolean).join(DOT);
  }
  function barinfoHasHours(place) { try { var o = O(); return !!(o && o.barStatus && o.barStatus(place)); } catch (e) { return false; } }
  function lineHTML(place, i, lv) {
    var inner = lineInner(place, i, lv, !barinfoHasHours(place));
    return '<div class="ev-line plc-line" data-plc-line="' + esc(place.id) + '"' + (inner ? "" : " hidden") + ">" + inner + "</div>";
  }
  function moreInner(place, i) { return i ? chipsHTML(place, i) + btnsHTML(i) + srcHTML(i) : ""; }
  function moreHTML(place, i) {
    var inner = moreInner(place, i);
    return '<div class="plc-more" data-plc-more="' + esc(place.id) + '"' + (inner ? "" : " hidden") + ">" + inner + "</div>";
  }
  // Full card (any container): cuisine + $ / hours row + chips + buttons + source.
  function cardInner(place, i, lv) {
    var top = [cuisineHTML(i), priceHTML(lv)].filter(Boolean).join(DOT), oh = hoursHTML(hoursText(statusFor(place, i)));
    if (!top && !oh && !i) return "";
    return (top ? '<div class="plc-top">' + top + "</div>" : "") + (oh ? '<div class="plc-hours">' + oh + "</div>" : "") + moreInner(place, i);
  }
  function each(sel, fn) { try { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); } catch (e) {} }
  function attr(id) { return '"' + String(id).replace(/["\\]/g, "") + '"'; }
  function fill(place, i, lv) {
    each("[data-plc-line=" + attr(place.id) + "]", function (el) { var h = lineInner(place, i, lv, !barinfoHasHours(place)); el.innerHTML = h; el.hidden = !h; });
    each("[data-plc-more=" + attr(place.id) + "]", function (el) { var h = moreInner(place, i); el.innerHTML = h; el.hidden = !h; });
  }

  /* ---------- API ---------- */
  function load(place) {
    return Promise.all([info(place), price(place)]).then(function (r) { return { info: r[0], price: r[1] }; }, function () { return { info: null, price: null }; });
  }
  // render(place, el): fills el with the full card (async; resolves with the data). place = {id, lat, lng, type, place?, outdoor?}
  function render(place, el) {
    if (!el || !place) return Promise.resolve(null);
    css();
    el.classList.add("plc-card");
    return load(place).then(function (d) {
      var h = cardInner(place, d.info, d.price);
      el.innerHTML = h; el.hidden = !h;
      return d;
    });
  }
  // popupHTML(bar): the bar sheet parts (sync); a tile / price not loaded yet fills the same nodes a moment later.
  function popupHTML(place) {
    if (!place || place.id == null || place.arena || !(place.place || DRINK[place.type])) return "";
    css();
    var i = infoSync(place), lv = priceSync(place), a = app();
    if (i === undefined || (isDrink(place) && a && a.LIVE && !prices[priceBox(place)])) load(place).then(function (d) { fill(place, d.info, d.price); });
    return lineHTML(place, i || null, lv) + moreHTML(place, i || null);
  }
  var CSS = ".plc-line{justify-content:flex-start;flex-wrap:wrap;gap:4px 6px;font-size:var(--fs-14,14px);line-height:1.3}" +
    ".plc-line[hidden],.plc-more[hidden],.plc-card[hidden]{display:none}.plc-dot{font-style:normal;opacity:.5}" +
    ".plc-i{width:16px;height:16px;flex:0 0 16px;vertical-align:-3px}.plc-cui,.plc-oh{display:inline-flex;align-items:center;gap:4px}" +
    ".plc-pr{font-weight:700;letter-spacing:1px;color:var(--ds-amber-t,#ffd23f)}.plc-oh.oh-open{color:var(--ds-green,#7bd88f)}" +
    ".plc-oh.oh-soon{color:var(--ds-amber-t,#ffd23f)}.plc-oh.oh-shut{color:var(--ds-muted,#a7b0ac)}" +
    ".plc-top,.plc-hours{font-size:var(--fs-14,14px);line-height:1.4;margin:0 0 6px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}" +
    ".plc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.plc-chip{font-size:13px;line-height:1.2;padding:4px 10px;border-radius:var(--ds-r-pill,999px);" +
    "border:1px solid var(--ds-border,rgba(255,255,255,.12));background:var(--ds-raised,rgba(255,255,255,.04));color:var(--ds-text-2,#dfe3e0)}" +
    ".plc-btns{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.plc-btn{flex:1 1 auto;min-height:44px;display:inline-flex;align-items:center;" +
    "justify-content:center;gap:6px;text-decoration:none;margin:0;overflow-wrap:anywhere}.plc-btn .plc-i{width:18px;height:18px}" +
    ".plc-src{font-size:12px;color:var(--ds-muted,#a7b0ac);margin-top:4px}.plc-src a{color:inherit}";
  function css() {
    try {
      if (!document.head || document.getElementById("placecard-css")) return;
      var st = document.createElement("style"); st.id = "placecard-css"; st.textContent = CSS; document.head.appendChild(st);
    } catch (e) {}
  }

  if (window.PN) PN.placecard = {
    render: render, popupHTML: function (bar) { try { return popupHTML(bar); } catch (e) { return ""; } },
    lineHTML: lineHTML, moreHTML: moreHTML, info: info, price: price,
    init: function (api) { A = api || null; },
    // pure helpers (tests)
    cuisineLabel: cuisineLabel, priceLevel: priceLevel, hoursText: hoursText, median: median, rowObj: rowObj, webHref: webHref, telHref: telHref,
    _leafKey: function (lat, lng, index) { if (index) ix = index; return leafKey(lat, lng); },
    _reset: function () { A = null; ix = null; ixP = null; tiles = {}; tileP = {}; prices = {}; priceP = {}; off = {}; }
  };
})();
