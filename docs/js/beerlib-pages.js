/* PintsNow — BEERLIB pages (I-132, lane beerui): the style page, the beer page and "Tipsa en vän". Needs js/beerlib.js first
   (PN.beerlib() loads both, in order). Sheets open with PN.openSheet (SHEETNAV gives them the back step).
   Beer page: photo + credit, brewery, style (a guess says so), ABV only when plausible, the style's taste tags, "Tipsa en vän"
   (the ONE amber button), Favorit (1 of 3), Mitt betyg 1–5, Andra betyg (the PintsNow average only from 5 ratings, A27),
   Omdömen with a report flag (3 reports hide a review, A26; strangers see a first name only, A25: the server decides the name).
   No Untappd line yet (no API key): BEERLIB.untappd is a hook. "Sök på Systembolaget" is behind BEERLIB.flags.systembolaget (OFF).
   Without the server tables: favourite + my rating stay on this phone, reviews and the average are not shown.
   Lane beer2: "Stil (gissning)" label, the "Om data" page (about), "Tipsa en vän" also to my groups. */
(function () {
  "use strict";
  var W = window, D = document, B = W.BEERLIB;
  if (!B) return;
  var H = B.h, tl = H.tl, esc = H.esc, ic = H.ic, MAX_REV = 280;

  function sheet(title, build) {
    if (!W.PN || !PN.openSheet) return;
    PN.openSheet(title, function (body) { var d = H.mk("div", "bl"); body.appendChild(d); build(d, body); }, { now: true });
  }
  function colourWord(st) {
    var s = st.srm, v = s ? (s[0] + s[1]) / 2 : null;
    if (v == null) return tl("Varierar", "Varies");
    return v <= 4 ? tl("Ljus", "Pale") : v <= 7 ? tl("Gyllene", "Golden") : v <= 14 ? tl("Bärnsten", "Amber") : v <= 25 ? tl("Mörk", "Dark") : tl("Svart", "Black");
  }
  function range(r, unit) { return r ? H.numT(r[0]) + "–" + H.numT(r[1]) + unit.replace(" ", "\u00a0") : "–"; }
  function meter(label, val, max, txt, cssVar) {
    var v = val == null ? 0 : Math.max(1, Math.min(5, Math.round(val / max * 5))), u = "";
    for (var i = 1; i <= 5; i++) u += "<u" + (i <= v && val != null ? ' class="on"' : "") + "></u>";
    return '<div class="bl-meter" style="--c:' + cssVar + '"><span>' + esc(label) + '</span><i aria-hidden="true">' + u + "</i><em>" + esc(txt) + "</em></div>";
  }
  function mid(r) { return r ? (r[0] + r[1]) / 2 : null; }

  /* ---------- style page ---------- */
  function stylePage(id) {
    B.load().then(function (d) {
      var st = d.st[id]; if (!st) return;
      var name = H.en() ? st.en : st.sv, fam = d.fam[st.fam], gl = st.glass && d.glasses[st.glass];
      sheet(name, function (el) {
        var beers = d.beers.filter(function (b) { return b.style === id; }), n = 20;
        beers = beers.filter(function (b) { return b.photo && !b.nn; }).concat(beers.filter(function (b) { return !b.photo || b.nn; }));   // beer2: a photo + a real name first
        var sim = d.styles.filter(function (s) { return s.fam === st.fam && s.id !== id; }).slice(0, 6);
        var tags = st.tags.map(function (t) { var g = null; H.FL.forEach(function (f) { if (f[4].indexOf(t) >= 0) g = f[0]; });
          var tt = d.tags[t]; return '<span class="bl-tag">' + (g ? H.dot(g) : "") + esc(tt ? (H.en() ? tt.en : tt.sv) : t) + "</span>"; }).join("");
        var colVar = st.hex && /^#[0-9a-fA-F]{3,8}$/.test(st.hex) ? st.hex : "var(--ds-amber-t)";
        var h = '<div class="bl-sh">' + H.styleImg(st.id, "") + "<div>" + (fam ? '<span class="fam">' + esc(H.en() ? fam.en : fam.sv) + "</span>" : "") + "<p>" + esc(H.oneLine(st)) + "</p></div></div>" +
          '<div class="bl-facts"><div class="bl-fact"><small>' + esc(tl("Styrka", "Strength")) + "</small><b>" + esc(range(st.abv, " %")) + "</b></div>" +
          '<div class="bl-fact"><small>' + esc(tl("Färg", "Colour")) + '</small><b><i class="bl-sw" style="--c:' + colVar + '" aria-hidden="true"></i>' + esc(colourWord(st)) + "</b></div>" +
          '<div class="bl-fact"><small>' + esc(tl("Glas", "Glass")) + "</small><b>" + esc(gl ? (H.en() ? gl.en : gl.sv) : "–") + "</b></div></div>" +
          '<h3 class="bl-h">' + esc(tl("Smaken", "The taste")) + '</h3><div class="bl-card">' +
          meter(tl("Beska", "Bitterness"), mid(st.ibu), 80, st.ibu ? range(st.ibu, " IBU") : tl("varierar", "varies"), "var(--bl-f-bitter)") +
          meter(tl("Färg", "Colour"), mid(st.srm), 40, st.srm ? range(st.srm, " SRM") : tl("varierar", "varies"), colVar) +
          meter(tl("Styrka", "Strength"), mid(st.abv), 12, range(st.abv, " %"), "var(--ds-amber-t)") +
          (tags ? '<div class="bl-tags" style="margin-top:var(--sp-3)">' + tags + "</div>" : "") + "</div>" +
          '<h3 class="bl-h">' + esc(tl("Bra att veta", "Good to know")) + '</h3><div class="bl-card"><p>' + esc(H.en() ? st.text_en : st.text_sv) + "</p>" +
          (st.serve ? "<p>" + esc(tl("Serveras ", "Serve at ")) + esc(range(st.serve, " °C")) + "</p>" : "") +
          ((H.en() ? st.food_en : st.food_sv) ? "<p>" + esc(tl("Passar till: ", "Goes with: ") + (H.en() ? st.food_en : st.food_sv)) + "</p>" : "") + "</div>" +
          '<h3 class="bl-h">' + esc(tl("Öl i stilen", "Beers in this style")) + "<b>" + beers.length + "</b></h3>" +
          (beers.length ? '<div class="bl-list bl-sb"></div><button type="button" class="bl-more" data-bl-more="beer" hidden>' + esc(tl("Visa fler öl", "Show more beers")) + "</button>" :
            '<p class="bl-msg">' + esc(tl("Vi har inga öl i den här stilen än.", "We have no beers in this style yet.")) + "</p>") +
          (sim.length ? '<h3 class="bl-h">' + esc(tl("Liknande", "Similar")) + '</h3><div class="bl-chips">' + sim.map(function (s) {
            return '<button type="button" class="bl-chip" data-bl-style="' + esc(s.id) + '">' + esc(H.en() ? s.en : s.sv) + "</button>"; }).join("") + "</div>" : "") +
          '<p class="bl-note">' + esc(tl("Siffror: ", "Numbers: ") + (st.ref || "–") + (st.est ? tl(" (ungefär)", " (rough)") : "") + tl(". Stilen på en öl är ofta en gissning.", ". The style of a beer is often a guess.")) + "</p>" + H.aboutLink();
        el.innerHTML = h;
        var list = el.querySelector(".bl-sb"), more = el.querySelector("[data-bl-more]");
        function paint() { if (!list) return; list.innerHTML = beers.slice(0, n).map(H.rowHTML).join(""); more.hidden = beers.length <= n; H.fixPics(list); }
        paint();
        H.wire(el, { more: function () { n += 40; paint(); } });
      });
    });
  }

  /* ---------- beer page ---------- */
  function heroHTML(b, st) {
    var groups = st ? H.styleGroups(st).slice(0, 3) : [];
    // beer2: the label says when the style is a guess ("Stil (gissning)"); all OFF styles are guesses today (no "high" confidence)
    var lab = st ? (b.conf < 3 ? tl("Stil (gissning)", "Style (a guess)") : tl("Stil", "Style")) : "";
    return '<div class="bl-bh">' + H.pic(b, "bl-big") + "<div>" + (b.brewery ? '<div class="who">' + esc(b.brewery) + "</div>" : "") +
      (lab ? '<div class="bl-stl">' + esc(lab) + "</div>" : "") +
      '<div class="big">' + (st ? '<button type="button" class="bl-slink" data-bl-style="' + esc(st.id) + '">' + esc(H.styleName(st.id)) + "</button>" : esc(tl("Stil okänd", "Style unknown"))) +
      (H.abvText(b) ? " · " + esc(H.abvText(b)) : "") + "</div>" +
      (groups.length ? '<div class="meta">' + groups.map(function (g) { return '<span class="bl-tag">' + H.dot(g) + esc(H.flName(g)) + "</span>"; }).join("") + "</div>" +
        '<div class="bl-note" style="margin:0">' + esc(tl("Typiskt för stilen", "Typical of the style")) + "</div>" : "") + "</div></div>" + H.credit(b);
  }
  function favBtn(b) {
    var s = B.favSlot(b.id);
    return '<button type="button" class="bl-btn' + (s ? " on" : "") + '" data-bl-fav="1" aria-pressed="' + !!s + '">' + ic("heart") +
      esc(s ? tl("Favorit " + s + " av 3", "Favourite " + s + " of 3") : tl("Favorit", "Favourite")) + "</button>";
  }
  // lane mybeer (I-147): "Jag dricker den här" = my beer now (the ÖL! button + my pin until 06:00). Again = back to plain ÖL!.
  // fixC P-26: the button shows the app's beer icon (the drawn bottle / can is on the ÖL! button and the pin). Only when js/mybeer.js is there.
  function nowBtn(b) {
    var M = W.MYBEER, lk = B.lookOf ? B.lookOf(b) : null; if (!M || !lk) return "";
    var c = M.current(), on = !!(c && c.id === b.id), pic = ic("beer");   // fixC P-26: the app icon like the other buttons here (the drawn can stays on the ÖL! button + pin)
    return '<button type="button" class="bl-btn mb-now' + (on ? " on" : "") + '" data-bl-now="1" aria-pressed="' + on + '">' + pic +
      esc(on ? tl("Min öl nu", "My beer now") : tl("Jag dricker den här", "I'm drinking this")) + "</button>";
  }
  function rateHTML(n, local) {
    return '<h3 class="bl-h">' + esc(tl("Mitt betyg", "My rating")) + '</h3><div class="bl-card"><div class="bl-rate">' + H.starsHTML(n) +
      '<span class="v">' + (n ? esc(n + tl(" av 5", " of 5")) : "") + "</span></div>" +
      '<p class="bl-note">' + esc(tl("Bara ett betyg per öl. Du kan ändra det.", "One rating per beer. You can change it.") +
        (local ? tl(" Sparas bara på den här telefonen tills vidare.", " Saved on this phone only for now.") : "")) + "</p></div>";
  }
  function othersHTML(info) {
    var row = info && info.avg != null && (info.n | 0) >= 5 ?
      "<b>PintsNow " + esc(H.num(info.avg) + tl(" av 5", " of 5")) + "</b><small>" + esc(tl(info.n + " betyg i appen", info.n + " ratings in the app")) + "</small>" :
      null;
    // fixC P-26: no average yet = an empty state, not a list row that looks like a rating ("PintsNow — Snittet visas från 5 betyg.")
    var n = info ? info.n | 0 : 0;
    if (!row) return '<h3 class="bl-h">' + esc(tl("Andra betyg", "Other ratings")) + '</h3><div class="bl-card bl-none"><p class="bl-none-t">' +
      esc(n > 0 ? tl(n + " betyg än. ", n + (n === 1 ? " rating" : " ratings") + " so far. ") : tl("Inga betyg än. ", "No ratings yet. ")) + esc(tl("Snittet visas från 5 betyg.", "The average shows from 5 ratings.")) + "</p>" +
      '<div class="bl-ext bl-ut" data-bl-untappd hidden></div></div>';
    return '<h3 class="bl-h">' + esc(tl("Andra betyg", "Other ratings")) + '</h3><div class="bl-card"><div class="bl-ext"><span class="ico">' + ic("users") + '</span><span class="tx">' + row + "</span></div>" +
      '<div class="bl-ext bl-ut" data-bl-untappd hidden></div></div>';
  }
  function sbHTML(b) {
    if (!B.flags.systembolaget) return "";
    var q = encodeURIComponent(b.name);
    return '<a class="bl-link" href="https://www.systembolaget.se/sortiment/?q=' + q + '" target="_blank" rel="noopener noreferrer">' + ic("search") + esc(tl("Sök på Systembolaget", "Search on Systembolaget")) + "</a>" +
      '<p class="bl-note" style="margin-top:0">' + esc(tl("Öppnar Systembolagets egen sök. Vi vet inte vad som finns i butik.", "Opens Systembolaget's own search. We do not know what is in store.")) + "</p>";
  }
  function ago(iso) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var d = Math.floor((Date.now() - t) / 864e5);
    if (d < 1) return tl("i dag", "today"); if (d < 2) return tl("i går", "yesterday");
    return H.dayText(iso);
  }
  function revHTML(r) {
    var nm = r.name || tl("Någon", "Someone"), ini = (Array.from(String(nm).trim())[0] || "?").toUpperCase();
    var state = r.status === "hidden" ? '<p class="st">' + esc(tl("Dold i väntan på granskning.", "Hidden until we have checked it.")) + "</p>" : "";
    return '<div class="bl-rev" data-bl-rev="' + esc(r.id) + '"><span class="bl-av' + (r.known ? " fr" : "") + '" aria-hidden="true">' + esc(ini) + "</span><div>" +
      '<div class="nm">' + esc(nm) + " " + (r.stars ? H.starsHTML(r.stars | 0, true) : "") + "<small>" + esc(ago(r.at)) + "</small></div><p>" + esc(r.body) + "</p>" + state +
      (r.mine ? '<button type="button" class="bl-slink" data-bl-rm="' + esc(r.id) + '">' + esc(tl("Ta bort mitt omdöme", "Remove my review")) + "</button>" : "") + "</div>" +
      (r.mine ? "<span></span>" : '<button type="button" class="bl-flag" data-bl-flag="' + esc(r.id) + '" aria-label="' + esc(tl("Anmäl omdöme", "Report review")) + '">' + ic("flag") + "</button>") + "</div>";
  }
  function reviewsHTML(info) {
    var l = (info && Array.isArray(info.reviews) ? info.reviews : []), mine = l.some(function (r) { return r.mine; });
    return '<h3 class="bl-h" id="bl-revs">' + esc(tl("Omdömen", "Reviews")) + "<b>" + l.length + "</b></h3>" +
      (l.length ? '<div class="bl-card bl-revs">' + l.map(revHTML).join("") + "</div>" : '<p class="bl-msg">' + esc(tl("Inga omdömen än.", "No reviews yet.")) + "</p>") +
      (mine ? "" : '<button type="button" class="bl-write" data-bl-write="1">' + ic("edit") + esc(tl("Skriv ett omdöme", "Write a review")) + "</button>") +
      '<div class="bl-wbox" hidden></div>' +
      '<p class="bl-note">' + esc(tl("Var schysst. Tryck på flaggan för att anmäla. Anmälda omdömen döljs tills vi har kollat.", "Be kind. Tap the flag to report. Reported reviews are hidden until we check them.")) + "</p>";
  }
  function beerPage(id) {
    B.load().then(function (d) {
      var b = d.byId[String(id)]; if (!b) return;
      sheet(b.name, function (el) { fillBeer(el, b, d); });
    });
  }
  function fillBeer(el, b, d) {
    var st = H.beerStyle(b), info = null, stars = 0;
    function paint() {
      var on = B.online();
      el.innerHTML = heroHTML(b, st) +
        '<div class="bl-acts"><button type="button" class="bl-btn p" data-bl-tip="1">' + ic("send") + esc(tl("Tipsa en vän", "Tell a friend")) + "</button>" + favBtn(b) + nowBtn(b) + "</div>" +
        rateHTML(stars, !on) + (on ? othersHTML(info) : "") + sbHTML(b) + (on ? reviewsHTML(info) : "") +
        // fixC P-26: ONE data line with the "Om data" link in it (the photo keeps its own credit under the picture)
        '<p class="bl-note bl-src">' + esc(tl("Data: Open Food Facts (ODbL).", "Data: Open Food Facts (ODbL).")) + " " + H.aboutLink() + "</p>";
      H.fixPics(el);
      untappd();
    }
    function untappd() {
      var slot = el.querySelector("[data-bl-untappd]"); if (!slot || typeof B.untappd !== "function") return;
      Promise.resolve(B.untappd(b)).then(function (u) {
        if (!u || u.rating == null || !el.isConnected) return;
        slot.innerHTML = '<span class="ico">' + ic("star") + '</span><span class="tx"><b>Untappd ' + esc(H.num(u.rating) + tl(" av 5", " of 5")) + "</b><small>" +
          esc(tl((u.count || 0) + " betyg · Data från Untappd", (u.count || 0) + " ratings · Data from Untappd")) + "</small></span>";
        slot.hidden = false;
      }, function () {});
    }
    function refresh() {
      return B.call("beerlib_beer_get", { p_beer: b.id }).then(function (r) {
        if (r.off) { stars = B.localRate(b.id); } else if (!r.error && r.data) { info = r.data; stars = info.my_stars | 0; }
        if (el.isConnected) paint();
      });
    }
    stars = B.localRate(b.id);
    paint();
    B.favs().then(function () { if (el.isConnected) paint(); });
    refresh();
    H.wire(el, { beer: beerPage, style: stylePage });
    el.addEventListener("click", function (e) { onBeerClick(e, el, b, { refresh: refresh, paint: paint, setStars: function (n) { stars = n; }, stars: function () { return stars; },
      stats: function (r) { if (info && r && r.n != null) { info.n = r.n; info.avg = r.avg; } } }); });
  }
  function nowTap(b) {
    var M = W.MYBEER, c = M && M.current(); if (!M) return;
    if (c && c.id === b.id) { M.clear(); H.toast(tl("ÖL!-knappen är vanlig igen.", "The BEER! button is plain again.")); return; }
    var n = M.pick({ id: b.id, n: b.name, t: B._kind(b), look: B.lookOf(b) });
    var sn = n && n.look && n.look.sn;
    H.toast(sn ? tl("ÖL!-knappen visar nu " + sn + ".", "The BEER! button now shows " + sn + ".") : tl("Sparat som din öl nu.", "Saved as your beer now."));
  }
  function onBeerClick(e, el, b, ctl) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var x;
    if ((x = t.closest("[data-bl-tip]"))) { tipSheet(b.id); return; }
    if ((x = t.closest("[data-bl-fav]"))) { x.disabled = true; B.toggleFav(b.id).then(ctl.paint); return; }
    if ((x = t.closest("[data-bl-now]"))) { nowTap(b); ctl.paint(); return; }
    if ((x = t.closest("[data-bl-star]"))) {
      var n = +x.getAttribute("data-bl-star"); if (n === ctl.stars()) n = 0;
      B.rate(b.id, n).then(function (r) { if (r) { ctl.setStars(r.stars | 0); ctl.stats(r); ctl.paint(); } });
      return;
    }
    if ((x = t.closest("[data-bl-write]"))) { writeBox(el, b, ctl); return; }
    if ((x = t.closest("[data-bl-flag]"))) { reportRow(x, ctl); return; }
    if ((x = t.closest("[data-bl-rep]"))) {
      var id = x.getAttribute("data-bl-rid"), why = x.getAttribute("data-bl-rep");
      B.call("beerlib_review_report", { p_id: +id, p_reason: why }).then(function (r) {
        H.toast(r.error ? tl("Anmälan gick inte fram. Försök igen.", "The report did not go through. Try again.") : tl("Tack. Vi kollar det.", "Thank you. We will check it."), r.error ? { err: true } : {});
        if (!r.error) ctl.refresh();
      });
      return;
    }
    if ((x = t.closest("[data-bl-rm]"))) {
      B.call("beerlib_review_remove", { p_id: +x.getAttribute("data-bl-rm") }).then(function (r) { if (r.error) H.toast(tl("Det gick inte. Försök igen.", "That did not work. Try again."), { err: true }); else ctl.refresh(); });
    }
  }
  function reportRow(btn, ctl) {
    var rev = btn.closest("[data-bl-rev]"); if (!rev || rev.querySelector(".bl-rep")) return;
    var id = rev.getAttribute("data-bl-rev"), row = H.mk("div", "bl-rep");
    row.innerHTML = '<span class="bl-note" style="margin:0">' + esc(tl("Varför?", "Why?")) + "</span>" + [["spam", "Spam", "Spam"], ["rude", "Elakt", "Rude"], ["wrong", "Fel öl", "Wrong beer"], ["other", "Annat", "Other"]].map(function (r) {
      return '<button type="button" class="bl-chip" data-bl-rep="' + r[0] + '" data-bl-rid="' + esc(id) + '">' + esc(tl(r[1], r[2])) + "</button>"; }).join("");
    rev.appendChild(row);
  }
  function badText(s) { return /(https?:\/\/|www\.|\.(se|com|nu|net|org)\b)/i.test(s) || /(\d[\s-]?){8,}/.test(s); }
  function writeBox(el, b, ctl) {
    var box = el.querySelector(".bl-wbox"), w = el.querySelector("[data-bl-write]"); if (!box) return;
    if (w) w.hidden = true;
    box.hidden = false;
    box.innerHTML = '<textarea class="bl-ta" maxlength="' + MAX_REV + '" aria-label="' + esc(tl("Ditt omdöme", "Your review")) + '" placeholder="' + esc(tl("Hur smakade den?", "How did it taste?")) + '"></textarea>' +
      '<div class="bl-cnt"><span class="bl-err" role="status"></span><span class="bl-n">0/' + MAX_REV + '</span></div><button type="button" class="bl-btn full" data-bl-send="1">' + esc(tl("Skicka omdömet", "Send the review")) + "</button>";
    var ta = box.querySelector("textarea"), n = box.querySelector(".bl-n"), err = box.querySelector(".bl-err"), send = box.querySelector("[data-bl-send]");
    ta.addEventListener("input", function () { n.textContent = ta.value.length + "/" + MAX_REV; err.textContent = ""; });
    try { ta.focus(); } catch (e) {}
    send.addEventListener("click", function () {
      var txt = String(ta.value || "").replace(/\s+/g, " ").trim();
      if (txt.length < 2) { err.textContent = tl("Skriv några ord först.", "Write a few words first."); return; }
      if (badText(txt)) { err.textContent = tl("Inga länkar eller telefonnummer.", "No links or phone numbers."); return; }
      var gate = W.SAFETY && W.SAFETY.ensureTerms ? W.SAFETY.ensureTerms() : Promise.resolve(true);
      send.disabled = true;
      Promise.resolve(gate).then(function (ok) {
        if (!ok) { send.disabled = false; return; }
        B.call("beerlib_review_post", { p_beer: b.id, p_body: txt, p_stars: ctl.stars() || null }).then(function (r) {
          send.disabled = false;
          if (r.error) { err.textContent = /slow_down/.test(String(r.error.message || "")) ? tl("Lugn i stormen. Vänta en stund.", "Slow down a bit.") : /bad_text/.test(String(r.error.message || "")) ? tl("Inga länkar eller telefonnummer.", "No links or phone numbers.") : tl("Det gick inte. Försök igen.", "That did not work. Try again."); return; }
          ctl.refresh();
        });
      });
    });
  }

  /* ---------- beer2: "Om data" (LEGAL.md (c): name the licences in the app). Plain facts, no value words. ---------- */
  var ODBL = "https://opendatacommons.org/licenses/odbl/1-0/", OFF = "https://world.openfoodfacts.org", OFF_TERMS = "https://world.openfoodfacts.org/terms-of-use";
  function ext(href, sv, en) { return '<a class="bl-alink" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + ic("link") + "<span>" + esc(tl(sv, en)) + "</span></a>"; }
  function sec(head, rows, links) {
    return '<h3 class="bl-h">' + esc(head) + '</h3><div class="bl-card bl-about-c">' + rows.map(function (r) { return "<p>" + esc(r) + "</p>"; }).join("") +
      (links ? '<div class="bl-alinks">' + links + "</div>" : "") + "</div>";
  }
  function about() {
    sheet(tl("Om data", "About the data"), function (el) {
      el.innerHTML = '<p class="bl-lead">' + esc(tl("Så här kommer ölen, bilderna och texterna till PintsNow.", "This is where the beers, photos and texts in PintsNow come from.")) + "</p>" +
        sec(tl("Öl och bilder", "Beers and photos"), [
          tl("Namn, bryggeri och styrka kommer från Open Food Facts. Det är en öppen databas. Alla kan rätta i den.", "Names, breweries and strength come from Open Food Facts. It is an open database. Anyone can correct it."),
          tl("Databasen har licensen ODbL. Vår bearbetade öllista delas under samma licens.", "The database has the ODbL licence. Our edited beer list is shared under the same licence."),
          tl("Bilderna har licensen CC BY-SA. Vid varje bild står vem som tog den, med en länk till produkten.", "The photos have the CC BY-SA licence. Each photo names who took it, with a link to the product."),
          tl("Etiketter och loggor på bilderna tillhör bryggerierna.", "Labels and logos in the photos belong to the breweries."),
          tl("Vi visar styrkan bara när den verkar rimlig.", "We show the strength only when it looks right.")],
          ext(OFF, "Open Food Facts", "Open Food Facts") + ext(ODBL, "Licensen ODbL", "The ODbL licence") + ext(OFF_TERMS, "Villkor för bilderna (CC BY-SA)", "Terms for the photos (CC BY-SA)") +
          '<a class="bl-alink" href="./data/beer/beers.json" download="pintsnow-beers.json">' + ic("download") + "<span>" + esc(tl("Vår öllista (ODbL)", "Our beer list (ODbL)")) + "</span></a>") +
        sec(tl("Stilar", "Styles"), [
          tl("Texterna, bilderna och tipsen om glas, temperatur och mat skriver vi själva.", "We write the texts, pictures and the tips about glass, temperature and food ourselves."),
          tl("Siffrorna för beska, färg och styrka kommer från BJCP 2021 och Brewers Association.", "The numbers for bitterness, colour and strength come from BJCP 2021 and the Brewers Association."),
          tl("Stilen på en enskild öl är oftast en gissning. Då står det \u201dStil (gissning)\u201d.", "The style of a single beer is mostly a guess. Then it says \u201cStyle (a guess)\u201d.")]) +
        sec(tl("Betyg och omdömen", "Ratings and reviews"), [
          tl("Betyg och omdömen kommer från dem som använder PintsNow. Snittet visas först från 5 betyg.", "Ratings and reviews come from the people who use PintsNow. The average shows from 5 ratings.")]) +
        sec(tl("Andra källor", "Other sources"), [
          tl("Untappd: vi använder inte Untappd än.", "Untappd: We do not use Untappd yet."),
          tl("Systembolaget: vi samarbetar inte med Systembolaget och visar inte deras logga. Vi vet inte vad som finns i butik.", "Systembolaget: we do not work with Systembolaget and do not show their logo. We do not know what is in store.")]) +
        '<p class="bl-note">' + esc(tl("Ser du ett fel i en öl? Rätta det på Open Food Facts via länken vid bilden.", "See a mistake in a beer? Correct it on Open Food Facts with the link at the photo.")) + "</p>";
    });
  }

  /* ---------- Tipsa en vän (the send itself: DM.tipBeer in js/dm.js) ---------- */
  function targets() {
    var out = [], seen = {}, DM = W.DM;
    try { (DM && DM.list ? DM.list() : []).forEach(function (t) { if (t && t.group_id && t.can_write !== false && !t.blocked_me && !t.blocked_by_me) { out.push({ group_id: t.group_id, name: t.name || "?" }); seen[String(t.name || "").toLowerCase()] = 1; } }); } catch (e) {}
    try {
      var c = W.PROFIL && W.PROFIL._cache ? W.PROFIL._cache() : null, fr = c && c.friends && Array.isArray(c.friends.friends) ? c.friends.friends : [];
      fr.forEach(function (f) { if (f && f.key && !seen[String(f.name || "").toLowerCase()]) out.push({ key: f.key, name: f.name || "?" }); });
    } catch (e) {}
    return out;
  }
  // beer2: my groups too (the tip lands in the group chat as the same card). The sheet opens at once with the friends; the groups
  // come at the END of the list when my_groups answers (rows above never move; a slow phone still gets them; picks + text are kept).
  function myGroups() {
    if (!W.PN || !PN.rpc || !PN.LIVE) return Promise.resolve([]);
    return PN.rpc("my_groups").then(function (x) {
      var l = x && !x.error ? (PN.parseData ? PN.parseData(x.data) : x.data) : [];
      return (Array.isArray(l) ? l : []).filter(function (g) { return g && g.id && !g.dm && !g.ev; }).slice(0, 10).map(function (g) { return { group_id: g.id, name: g.name || "?", grp: true }; });
    }, function () { return []; });
  }
  function tipSheet(id) {
    var d = B.data(), b = d && d.byId[String(id)]; if (!b) return;
    sheet(tl("Tipsa en vän", "Tell a friend"), function (el) {
      var friends = targets();
      tipPaint(el, b, friends);
      myGroups().then(function (gs) { if (el.isConnected && gs.length) tipPaint(el, b, friends.concat(gs)); });
    });
  }
  function pickHTML(t, i) {
    var ini = (Array.from(String(t.name).trim())[0] || "?").toUpperCase();
    return '<button type="button" class="bl-pick" role="checkbox" aria-checked="false" data-i="' + i + '"' + (t.grp ? ' data-g="1"' : "") + '><span class="bl-av' + (t.grp ? " grp" : " fr") + '" aria-hidden="true">' +
      (t.grp ? ic("users") : esc(ini)) + "</span><span><b>" + esc(t.name) + "</b><small>" + esc(t.grp ? tl("Grupp", "Group") : tl("Vän", "Friend")) + '</small></span><span class="bl-ck">' + ic("check") + "</span></button>";
  }
  function tipPaint(el, b, list) {
    var DM = W.DM, canSend = !!(DM && DM.tipBeer);
    var on = [].map.call(el.querySelectorAll('.bl-pick[aria-checked="true"]'), function (p) { return p.getAttribute("data-i"); }), ta0 = el.querySelector("textarea");
    var line = ta0 ? ta0.value : "";
    el.__list = list;
    var h = '<div class="bl-cm">' + H.pic(b) + "<span><b>" + esc(b.name) + "</b><small>" + esc([b.brewery, H.styleLine(b)].filter(Boolean).join(" · ")) + "</small></span></div>";
    if (!canSend || !list.length) {
      h += '<p class="bl-msg">' + esc(tl("Du kan tipsa vänner när du har lagt till några. Gå till Grupper › Vänner.", "You can tip friends once you have added some. Go to Groups › Friends.")) + "</p>";
      el.innerHTML = h; H.fixPics(el); return;
    }
    h += '<h3 class="bl-h">' + esc(tl("Till", "To")) + '</h3><div class="bl-list" role="group">' + list.map(pickHTML).join("") + "</div>" +
      '<h3 class="bl-h">' + esc(tl("En rad (valfritt)", "A line (optional)")) + '</h3><textarea class="bl-ta" maxlength="70" aria-label="' + esc(tl("En rad (valfritt)", "A line (optional)")) + '"></textarea>' +
      '<div style="margin-top:var(--sp-4)"><button type="button" class="bl-btn p full" data-bl-go="1" disabled>' + ic("send") + esc(tl("Skicka tips", "Send tip")) + "</button></div>" +
      '<p class="bl-note">' + esc(tl("Tipset kommer i chatten som ett kort. Inget mer.", "The tip shows in the chat as a card. Nothing more.")) + "</p>";
    el.innerHTML = h; H.fixPics(el);
    var go = el.querySelector("[data-bl-go]");
    el.querySelector("textarea").value = line;
    on.forEach(function (i) { var p = el.querySelector('.bl-pick[data-i="' + i + '"]'); if (p) p.setAttribute("aria-checked", "true"); });
    go.disabled = !on.length;
    if (el.__tipW) return;
    el.__tipW = 1;
    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var p = t.closest(".bl-pick"), g = t.closest("[data-bl-go]"), btn = el.querySelector("[data-bl-go]");
      if (p) { p.setAttribute("aria-checked", String(p.getAttribute("aria-checked") !== "true")); btn.disabled = !el.querySelector('.bl-pick[aria-checked="true"]'); return; }
      if (!g || g.disabled) return;
      var sel = [].map.call(el.querySelectorAll('.bl-pick[aria-checked="true"]'), function (x) { return el.__list[+x.getAttribute("data-i")]; }).filter(Boolean);
      if (!sel.length) return;
      g.disabled = true;
      W.DM.tipBeer(sel, B.tipText(b, el.querySelector("textarea").value)).then(function (r) {
        g.disabled = false;
        if (r && r.sent) { H.toast(r.failed ? tl("Tipset gick till " + r.sent + " av " + (r.sent + r.failed) + ".", "The tip went to " + r.sent + " of " + (r.sent + r.failed) + ".") : tl("Tipset är skickat.", "The tip is sent.")); try { if (PN.closeSheet) PN.closeSheet(); } catch (e2) {} }
        else if (r && !r.cancel) H.toast(tl("Tipset gick inte fram. Försök igen.", "The tip did not go through. Try again."), { err: true });
      });
    });
  }

  B.style = stylePage; B.beer = beerPage; B.tip = tipSheet; B.about = about;
  B._badText = badText;
})();
