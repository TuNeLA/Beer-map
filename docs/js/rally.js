/* Öl Nu — Inkallelse (rally / call-out), CONTRACT "v9 INKALLELSE".
   A member calls the group ("🪖 Behöver män till skyttegraven!"). Others answer yes / maybe / no.
   Banner under the HUD from my_rallies() (polled with the normal poll). Missing RPCs → feature off, UI hidden. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  var state = "unknown";          // "unknown" | "on" | "off"
  var rallies = [];               // newest first (my_rallies)
  var HIDE_KEY = "olnu.rallyHidden", ANS_KEY = "olnu.rallyAnsweredAt", FLAG_MS = 60 * 60 * 1000;
  var loading = false;
  function $(id) { return document.getElementById(id); }

  function call(name, params) {
    if (!A || !A.LIVE || state === "off") return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { state = "off"; r.off = true; rallies = []; renderBanner(); A.updateCounts(); }
      return r;
    });
  }
  function code(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    var list = ["not_member", "invalid_msg", "slow_down", "invalid_answer", "rally_not_found"];
    for (var i = 0; i < list.length; i++) if (m.indexOf(list[i]) >= 0) return list[i];
    return U.errCode(err);
  }
  function load() {
    if (!A || !A.authed() || state === "off" || loading) return Promise.resolve();
    loading = true;
    return call("my_rallies").then(function (r) {
      loading = false;
      if (r.error) return;
      var was = state;
      state = "on";
      rallies = (r.data || []).filter(function (x) { return x && x.id != null; });
      renderBanner(); drawFlags();
      if (was !== "on") A.updateCounts();
      refreshOpenSheet();
    });
  }
  // v13 poll_v2 carries the my_rallies rows: no extra call per poll.
  var fromPoll = false;
  function fromPollData(d) {
    if (!d || !Array.isArray(d.rallies)) { fromPoll = false; return; }
    fromPoll = true;
    var was = state;
    state = "on";
    rallies = d.rallies.filter(function (x) { return x && x.id != null; });
    renderBanner(); drawFlags();
    if (was !== "on") A.updateCounts();
    refreshOpenSheet();
  }
  function hidden() { var h = U.ls.getJSON(HIDE_KEY, []); return Array.isArray(h) ? h : []; }
  function hide(id) { var h = hidden(); if (h.indexOf(String(id)) < 0) h.push(String(id)); U.ls.setJSON(HIDE_KEY, h.slice(-50)); }
  function byId(id) { for (var i = 0; i < rallies.length; i++) if (String(rallies[i].id) === String(id)) return rallies[i]; return null; }

  /* ---------- Banner ---------- */
  function setH() {
    var b = $("rally"), h = b.hidden ? 0 : b.offsetHeight + 6;
    document.documentElement.style.setProperty("--rally-h", h + "px");
    requestAnimationFrame(padPopups);
  }
  // Keep map popups clear of the whole top HUD (ticker, kaos + rally banners, HUD lines).
  function padPopups() {
    try {
      var hl = document.querySelector(".hud-left"), bottom = hl ? hl.getBoundingClientRect().bottom : 0;
      var top = Math.max(150, Math.round(bottom + 8));
      if (top > window.innerHeight * 0.5) top = Math.round(window.innerHeight * 0.5);
      L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, top);
    } catch (e) {}
  }
  function lineOf(r) {
    return "🪖 " + (r.is_mine ? t("you") : r.name || t("someone")) + ": " + (r.body || t("rallyDefault")) +
      (r.place ? " · 📍 " + r.place : "") + " — " + t("rallyOnWay", r.yes | 0);
  }
  function renderBanner() {
    var box = $("rally"); if (!box) return;
    var h = hidden(), r = null;
    for (var i = 0; i < rallies.length; i++) if (h.indexOf(String(rallies[i].id)) < 0) { r = rallies[i]; break; }
    box.hidden = !r;
    if (r) {
      var btns = r.is_mine ? "" : ["yes", "maybe", "no"].map(function (a) {
        return '<button type="button" class="rl-a rl-' + a + (r.my_answer === a ? " on" : "") + '" data-ans="' + a + '" aria-pressed="' + (r.my_answer === a) + '">' +
          esc(t(a === "yes" ? "rallyYes" : a === "maybe" ? "rallyMaybe" : "rallyNo")) + "</button>";
      }).join("");
      box.setAttribute("data-id", String(r.id));
      box.innerHTML = '<button type="button" class="rl-txt" data-open="1">' + esc(lineOf(r)) + "</button>" +
        '<button type="button" class="rl-x" data-hide="1" aria-label="' + esc(t("rallyHide")) + '">✕</button>' +
        (btns ? '<div class="rl-btns">' + btns + "</div>" : "");
    }
    setH();
  }

  /* ---------- Answer ---------- */
  function answer(id, ans, quiet) {
    var r = byId(id);
    return call("answer_rally", { p_rally_id: +id, p_answer: ans }).then(function (res) {
      if (res.error) {
        var c = code(res.error);
        A.toast(c === "rally_not_found" ? t("rallyGone") : c === "not_member" ? t("chatNotMember") : t("rallyFail"), { err: true });
        if (c === "rally_not_found") load();
        return false;
      }
      var d = A.parseData(res.data);
      if (r) { r.yes = d.yes | 0; r.no = d.no | 0; r.maybe = d.maybe | 0; r.my_answer = d.mine || ans; }
      if ((d.mine || ans) === "yes") A.invoke("notify-group", { event: "rally_yes", rally_id: +id });
      if (!quiet) {
        A.toast(t(ans === "yes" ? "rallyYesToast" : ans === "maybe" ? "rallyMaybeToast" : "rallyNoToast"));
        window.FX.vibrate(ans === "yes" ? [30, 40, 30] : 20);
      }
      renderBanner(); refreshOpenSheet();
      // After an answer the banner goes away. The flag stays on the map (1 h after the answer).
      if (!quiet && r) {
        hide(id); renderBanner();
        var marks = U.ls.getJSON(ANS_KEY, {}) || {}; marks[String(id)] = Date.now(); U.ls.setJSON(ANS_KEY, marks);
        drawFlags();
        var w = whereOf(r);
        if (w && ans !== "no") {
          if (openId == null) { A.closeSheet(); A.map.flyTo([w.lat, w.lng], 16, { duration: 1 }); }
          A.toast(t("rallyFlagHint"), { ms: 6000 });
        }
      }
      setTimeout(load, 800);   // fresh yes_names
      return true;
    });
  }

  /* ---------- Detail sheet ---------- */
  var openId = null, openBody = null, flagLayer = null;
  function refreshOpenSheet() {
    if (openId == null || !openBody || !document.body.contains(openBody)) { openId = null; openBody = null; return; }
    var r = byId(openId);
    if (r) fillDetail(openBody, r);
  }
  function fillDetail(body, r) {
    var el = A.el;
    body.innerHTML = "";
    body.appendChild(el("div", { class: "rl-head" }, [
      el("div", { class: "rl-who", text: (r.is_mine ? t("rallyMine") : (r.name || t("someone"))) + (r.group_name ? " · " + t("rallyIn", r.group_name) : "") }),
      el("div", { class: "rl-body", text: r.body || t("rallyDefault") }),
      r.place ? el("div", { class: "rl-place", text: "📍 " + r.place }) : null,
      el("div", { class: "rl-time muted", text: U.timeHM(r.created_at) })
    ]));
    body.appendChild(el("div", { class: "rl-big", text: t("rallyOnWay", r.yes | 0) }));
    body.appendChild(el("p", { class: "muted", text: t("rallyCounts", r.yes | 0, r.maybe | 0, r.no | 0) }));
    var names = Array.isArray(r.yes_names) ? r.yes_names.filter(Boolean) : [];
    body.appendChild(el("p", { class: "rl-names", text: names.length ? t("rallyGoing", names.join(", ")) : t("rallyNobody") }));
    if (!r.is_mine) {
      var row = el("div", { class: "row rl-ans-row" });
      ["yes", "maybe", "no"].forEach(function (a) {
        var b = A.btn(t(a === "yes" ? "rallyYes" : a === "maybe" ? "rallyMaybe" : "rallyNo"), "btn-small rl-ans" + (r.my_answer === a ? " on" : ""), function () { answer(r.id, a); });
        b.setAttribute("aria-pressed", String(r.my_answer === a));
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    var wh = whereOf(r);
    if (wh) {
      // Walking directions in the phone's own map app (Apple Maps on iPhone, Google Maps elsewhere).
      if (!r.is_mine) {
        var go = el("a", { class: "btn btn-block rl-route" + (r.my_answer === "yes" ? " btn-green" : ""), href: dirUrl(wh),
          target: "_blank", rel: "noopener noreferrer", text: t("rallyRoute") });
        body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [go]));
        var dist = el("p", { class: "muted rl-dist", text: "" });
        body.appendChild(dist);
        distTo(wh, function (txt) { dist.textContent = txt; });
      }
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("rallyShowMap"), "btn-block", function () { showFlag(r, wh); })]));
    }
    if (r.is_mine) {
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("rallyClose"), "btn-danger btn-block", function () {
        call("close_rally", { p_rally_id: +r.id }).then(function (res) {
          if (res.error) { A.toast(code(res.error) === "rally_not_found" ? t("rallyGone") : t("rallyFail"), { err: true }); return; }
          A.toast(t("rallyClosed")); A.closeSheet();
          rallies = rallies.filter(function (x) { return String(x.id) !== String(r.id); }); renderBanner(); load();
        });
      })]));
    }
  }
  function dirUrl(r) {
    var ll = (+r.lat).toFixed(5) + "," + (+r.lng).toFixed(5);
    return U.isIOS() ? "https://maps.apple.com/?daddr=" + ll + "&dirflg=w"
      : "https://www.google.com/maps/dir/?api=1&destination=" + ll + "&travelmode=walking";
  }
  // "ca 650 m · ca 8 min att gå" from the phone's last known position (no new GPS prompt if it fails).
  function distTo(r, cb) {
    try {
      navigator.geolocation.getCurrentPosition(function (p) {
        var m = U.haversine(p.coords.latitude, p.coords.longitude, +r.lat, +r.lng);
        cb(t("rallyDist", m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km",
          Math.max(1, Math.round(m * 1.25 / 80))));
      }, function () {}, { maximumAge: 300000, timeout: 8000, enableHighAccuracy: false });
    } catch (e) {}
  }
  // Where is the call-out? Its own coords, else a known bar/place whose name matches the place text
  // (nearest one to the map centre, within 60 km). Returns {lat, lng} or null.
  var placeCache = {};
  function whereOf(r) {
    if (r.lat != null && r.lng != null && isFinite(r.lat) && isFinite(r.lng)) return { lat: +r.lat, lng: +r.lng };
    var name = String(r.place || "").trim().toLowerCase();
    if (name.length < 3 || !window.BARS || !window.BARS.inBounds || !window.L) return null;
    if (placeCache[name] !== undefined) return placeCache[name];
    var c = A.map.getCenter(), best = null, bestD = 60000;
    var all = window.BARS.inBounds(L.latLngBounds([[c.lat - 0.6, c.lng - 1.2], [c.lat + 0.6, c.lng + 1.2]]), 5000);
    all.forEach(function (b) {
      var n = String(b.name || "").toLowerCase(); if (!n) return;
      if (n === name || n.indexOf(name) === 0 || name.indexOf(n) === 0 || n.indexOf(" " + name) >= 0) {
        var d = U.haversine(c.lat, c.lng, b.lat, b.lng);
        if (d < bestD) { bestD = d; best = { lat: b.lat, lng: b.lng }; }
      }
    });
    placeCache[name] = best;
    return best;
  }
  // Every active call-out with a place stays on the map as a flag: "🪖 Ström · 3 på väg" (+ ✅ if I come).
  var flagsLayer = null, flagZoomHooked = false;
  function drawFlags() {
    if (!A || !A.map || !window.L) return;
    if (!flagsLayer) flagsLayer = L.layerGroup().addTo(A.map);
    flagsLayer.clearLayers();
    if (!flagZoomHooked) {
      flagZoomHooked = true;
      var zc = function () { var el = A.map.getContainer(); el.classList.toggle("rl-zoomed", A.map.getZoom() >= 16); };
      A.map.on("zoomend", zc); zc();
    }
    var marks = U.ls.getJSON(ANS_KEY, {}) || {}, nowMs = Date.now();
    rallies.forEach(function (r) {
      var w = whereOf(r); if (!w) return;
      // Answered "no": no flag. Answered yes/maybe: flag for 1 h after the answer. Not answered: while active.
      if (r.my_answer === "no") return;
      var at = marks[String(r.id)];
      if (at && nowMs - at > FLAG_MS && !r.is_mine) return;
      var who = r.is_mine ? t("you") : (r.name || t("someone"));
      var me = r.my_answer === "yes" ? " ✅" : r.my_answer === "maybe" ? " 🤔" : "";
      var m = L.marker([w.lat, w.lng], { keyboard: false, zIndexOffset: 3500,
        icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
          // Small pin: 🪖 + people on the way. The name/place only shows when zoomed in close (≥ 16).
          html: '<div class="rl-pin' + (r.my_answer === "yes" ? " me" : "") + '"><span>🪖</span><i>' + (r.yes | 0) + me +
            '</i><b class="rl-pin-lbl">' + esc(who + (r.place ? " · " + r.place : "")) + "</b></div>" }) });
      m.on("click", function () { openRally(byId(r.id) || r); });
      flagsLayer.addLayer(m);
    });
  }
  function openRally(r) {
    A.openSheet(t("rallyTitle"), function (body) { openId = r.id; openBody = body; fillDetail(body, r); });
  }
  function showFlag(r, w) {
    w = w || whereOf(r); if (!w) return;
    A.closeSheet();
    if (flagLayer) A.map.removeLayer(flagLayer);
    flagLayer = L.marker([w.lat, w.lng], { keyboard: false, zIndexOffset: 4000,
      icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
        html: '<div class="rl-flag"><span>🪖</span><b>' + esc(r.place || r.body || t("rallyTitle")) + "</b></div>" }) }).addTo(A.map);
    flagLayer.on("click", function () { if (flagLayer) { A.map.removeLayer(flagLayer); flagLayer = null; } });
    A.map.flyTo([w.lat, w.lng], 16, { duration: 1 });
  }

  /* ---------- Create form ---------- */
  function startCreate(group) {
    A.withName(function () {
      if (group) { form([group], group); return; }
      A.rpc("my_groups").then(function (res) {
        var gs = (res && res.data) || [];
        if (res.error) { A.toast(t("fail"), { err: true }); return; }
        if (!gs.length) { A.toast(t("noGroup"), { err: true }); return; }
        form(gs, gs[0]);
      });
    });
  }
  function form(groups, sel) {
    var el = A.el, mine = A.myBeer(), bar = null;
    if (mine && mine.precise) { var b = window.BARS.nearest(mine.lat, mine.lng); if (b && b.name) bar = b.name; }
    A.openSheet(t("rallyTitle"), function (body) {
      var gid = sel.id, place = bar || null, useLoc = false, sending = false;
      if (groups.length > 1) {
        body.appendChild(el("label", { class: "fld", text: t("rallyGroup") }));
        var gr = el("div", { class: "chips" });
        groups.forEach(function (g) {
          var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(g.id === gid), text: g.name });
          c.addEventListener("click", function () { gid = g.id; gr.querySelectorAll(".chip-btn").forEach(function (x) { x.setAttribute("aria-pressed", String(x === c)); }); });
          gr.appendChild(c);
        });
        body.appendChild(gr);
      }
      body.appendChild(el("label", { class: "fld", for: "rally-inp", text: t("rallyWhat") }));
      var inp = el("input", { class: "inp rl-inp", id: "rally-inp", maxlength: "100", enterkeyhint: "send", autocomplete: "off", placeholder: t("rallyPh") });
      body.appendChild(inp);
      body.appendChild(el("label", { class: "fld", text: t("rallyPlace") }));
      var pr = el("div", { class: "chips" });
      var other = el("input", { class: "inp rl-inp", maxlength: "60", autocomplete: "off", placeholder: t("rallyPlacePh"), "aria-label": t("rallyPlace") });
      other.hidden = true;
      var loc = el("input", { type: "checkbox", id: "rally-loc" });
      var opts = [], spot = null, cen = A.lastLoc && A.lastLoc() || A.map.getCenter();
      if (bar) opts.push(["bar", t("rallyBarX", bar), bar]);
      // Bars near me (or the map centre): picking one sends its exact spot, so everyone gets the route.
      var near = window.BARS && window.BARS.nearby ? window.BARS.nearby(cen.lat, cen.lng, 3000, 6) : [];
      near.forEach(function (x) { if (x.bar.name !== bar) opts.push(["spot", "🍺 " + x.bar.name, x.bar.name, x.bar]); });
      opts.push(["home", t("rallyHome"), t("rallyHomeVal")]);
      opts.push(["other", t("rallyOther"), null]);
      opts.forEach(function (o, i) {
        var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(i === 0 && !!bar), text: o[1] });
        c.addEventListener("click", function () {
          var on = c.getAttribute("aria-pressed") !== "true";
          pr.querySelectorAll(".chip-btn").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          c.setAttribute("aria-pressed", String(on));
          other.hidden = !(on && o[0] === "other");
          place = on ? o[2] : null;
          spot = on && o[3] ? o[3] : null;
          if (o[0] === "bar" && on && mine) spot = { lat: mine.lat, lng: mine.lng };
          // "Hemma hos mig" needs my position, else nobody can find the way.
          if (o[0] === "home") { loc.checked = on; useLoc = on; }
          if (!other.hidden) setTimeout(function () { other.focus(); }, 30);
        });
        pr.appendChild(c);
      });
      body.appendChild(pr);
      body.appendChild(other);
      loc.addEventListener("change", function () { useLoc = loc.checked; });
      body.appendChild(el("label", { class: "age-row rl-loc", for: "rally-loc" }, [loc, el("span", { text: t("rallyUseLoc") })]));
      var go = A.btn(t("rallySend"), "btn-amber btn-block", function () {
        if (sending) return;
        var text = String(inp.value || "").trim(), pl = !other.hidden ? String(other.value || "").trim() : place;
        if (text.length > 100 || (pl && pl.length > 60)) { A.toast(t("rallyInvalid"), { err: true }); return; }
        sending = true; go.disabled = true;
        var posP = useLoc ? A.getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }).then(function (p) {
          return { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 };
        }, function (err) { A.locError(err); return null; }) : Promise.resolve(null);
        posP.then(function (pos) {
          var params = { p_group_id: gid, p_body: text || t("rallyDefault"), p_place: pl || null };
          if (pos) { params.p_lat = pos.lat; params.p_lng = pos.lng; }
          else if (spot && isFinite(spot.lat)) { params.p_lat = +(+spot.lat).toFixed(5); params.p_lng = +(+spot.lng).toFixed(5); }
          return call("create_rally", params).then(function (res) {
            sending = false; go.disabled = false;
            if (res.error) {
              var c = code(res.error);
              A.toast(c === "slow_down" ? t("rallySlow") : c === "invalid_msg" ? t("rallyInvalid") : c === "not_member" ? t("chatNotMember") : t("rallyFail"), { err: true });
              return;
            }
            var d = A.parseData(res.data);
            if (d.id != null) A.invoke("notify-group", { event: "rally", rally_id: +d.id });
            A.toast(t("rallySent"), { ms: 5000 });
            window.FX.unlock(); window.FX.sound.hot(); window.FX.vibrate([40, 60, 40]);
            A.closeSheet();
            load();
          });
        });
      });
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [go]));
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  /* ---------- Deep link ?rally=<id>[&answer=…] ---------- */
  function openLink(id, ans) {
    if (!/^\d{1,18}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (state === "off") return;
      if (!A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load().then(function () {
        if (state !== "on") { if (state === "unknown" && tries++ < 60) setTimeout(step, 700); return; }
        var r = byId(id);
        if (!r) { A.toast(t("rallyGone"), { err: true }); return; }
        var h = hidden().filter(function (x) { return x !== String(id); }); U.ls.setJSON(HIDE_KEY, h);
        renderBanner();
        var a = String(ans || "").toLowerCase();
        if (["yes", "no", "maybe"].indexOf(a) >= 0 && !r.is_mine) answer(r.id, a).then(function () { openRally(byId(id) || r); });
        else openRally(r);
      });
    })();
  }

  window.RALLY = {
    on: function () { return state === "on"; },
    init: function (api) {
      A = api;
      var box = $("rally");
      box.addEventListener("click", function (e) {
        var id = box.getAttribute("data-id"), b = e.target.closest("button"); if (!b || !id) return;
        if (b.hasAttribute("data-ans")) answer(id, b.getAttribute("data-ans"));
        else if (b.hasAttribute("data-hide")) { hide(id); renderBanner(); }
        else if (b.hasAttribute("data-open")) { var r = byId(id); if (r) openRally(r); }
      });
      window.addEventListener("resize", U.debounce(setH, 150));
    },
    applyText: function () { renderBanner(); },
    onAuthed: function () {},   // v14: the first poll brings the rallies (poll_v2) or onPoll loads them
    onPollData: function (d) { if (A && state !== "off") fromPollData(d); else fromPoll = false; },
    onPoll: function () { if (!fromPoll) load(); padPopups(); },
    hudChipsHTML: function () {
      return state === "on" ? '<button type="button" class="hx-chip hx-rally" data-hx="rally">' + esc(t("rallyBtn")) + "</button>" : "";
    },
    hudClick: function (action) { if (action === "rally") startCreate(null); },
    groupItem: function (g, wrap) {
      if (state !== "on") return;
      // Active call-outs of this group, tap → details (route, who comes).
      rallies.filter(function (r) { return String(r.group_id) === String(g.id); }).forEach(function (r) {
        var who = r.is_mine ? t("you") : (r.name || t("someone"));
        var mine = r.my_answer === "yes" ? " · ✅" : r.my_answer === "maybe" ? " · 🤔" : "";
        wrap.appendChild(A.el("button", { type: "button", class: "rl-group-item",
          text: "🪖 " + who + ": " + (r.body || t("rallyDefault")) + (r.place ? " · 📍 " + r.place : "") + " — " + t("rallyOnWay", r.yes | 0) + mine,
          onclick: function () { openRally(byId(r.id) || r); } }));
      });
      wrap.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("rallyBtn"), "btn-small btn-block", function () { startCreate(g); })]));
    },
    openLink: openLink
  };
})();
