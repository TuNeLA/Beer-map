/* PintsNow — 📍 PINNEN FÖLJER MED (pf01, owner 2026-11-08: "his last beer was at my friend's place, then he was at the bar for
   3–4 hours, but the map still showed him at my friend's home"). window.PINFOLJ, in app.js mods(): init, onAuthed, settingsSheet.
   - NO GPS of its own: every reading comes from the auto check-in sampler (js/autoci.js AUTOCI.listen "fix": one
     getCurrentPosition per minute, only while the app is visible and the location permission is already granted; one at
     once on resume). No watchPosition (in Chromium it blocks the other GPS calls).
   - Rule: I have a live pin tonight (>= 1 drink, not hidden, not spökläge) + the setting is on + not in my home zone.
     A reading with accuracy <= 50 m that is > 150 m from where my friends see my pin starts a "moved" run; a 2nd such
     reading >= 2 min after the first → pin_follow(lat, lng, acc, area) (migration 0320). At most 1 call per 2 min (the
     server checks it too). A run older than 30 min (app hidden) starts again.
   - Server: stores a separate friend-visible point (pin_follow table). Checked in at a bar and <= 80 m from it = the bar's
     point. "Bara område" = the rounded area. Strangers / the public map keep the old point (0321 reads it for me + friends).
   - The next beer moves the pin as before (a newer beer always wins).
   - Web limit: nothing happens while the app is closed or hidden (no GPS for web apps in the background).
   Stored on this phone: olnu.pinFolj ("0" = off; default on), olnu.pinFolj.last (the last point sent tonight). */
(function () {
  "use strict";
  var U = window.U;
  var A = null, KEY = "olnu.pinFolj", LAST = "olnu.pinFolj.last";
  var FAR_M = 150, ACC_M = 50, GAP_MS = 2 * 60e3, SEND_GAP_MS = 2 * 60e3, RUN_MAX_MS = 30 * 60e3;
  var st = { run: null, sentAt: 0, off: false, busy: false, sent: 0, last: null, why: "" };

  function on() { try { return U.ls.get(KEY, "1") !== "0"; } catch (e) { return true; } }
  function setOn(b) { try { if (b) U.ls.del(KEY); else U.ls.set(KEY, "0"); } catch (e) {} st.run = null; }
  function ghost() { try { return !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()); } catch (e) { return false; } }
  function atHome(la, ln) { try { return !!(window.PRIVACY && window.PRIVACY.inHome && window.PRIVACY.inHome(la, ln)); } catch (e) { return false; } }
  function area() { try { return A.prec && A.prec() === "area"; } catch (e) { return false; } }
  function ready() { return !!(A && A.LIVE && A.authed && A.authed()); }
  function ic(name) { try { return window.PNI && window.PNI.svg ? window.PNI.svg(name, "pi-lead") : ""; } catch (e) { return ""; } }
  function lastSent() { try { return U.ls.getJSON(LAST, null); } catch (e) { return null; } }

  // Where my friends see my pin now: my last follow point (same night, newer than my last beer), else the poll's pin.
  function pinNow() {
    var me = A.me ? A.me() : null, mine = null, night = null;
    try { mine = A.myBeer ? A.myBeer() : null; } catch (e) { mine = null; }
    try { night = A.myNight ? A.myNight() : null; } catch (e) { night = null; }
    var nk, beerAt, base;
    if (me && me.id) {
      if (((me.beer_count | 0) + (me.other_count | 0)) < 1 || me.hidden || me.ghost) return null;
      var exp = Date.parse(me.expires_at || ""); if (isFinite(exp) && exp < Date.now()) return null;
      nk = String(me.expires_at || ""); beerAt = Date.parse(me.beer_at || "") || 0;
      base = mine && isFinite(+mine.lat) ? { lat: +mine.lat, lng: +mine.lng } : { lat: +me.lat, lng: +me.lng };
    } else if (mine && night) {   // old poll (no "me" block): my own pin + this phone's night
      nk = String(night.expires || ""); beerAt = +night.lastTap || 0; base = { lat: +mine.lat, lng: +mine.lng };
    } else return null;
    var ls = lastSent();
    if (ls && ls.night === nk && ls.at > beerAt && isFinite(ls.lat)) return { lat: ls.lat, lng: ls.lng, night: nk };
    if (!isFinite(base.lat) || !isFinite(base.lng)) return null;
    base.night = nk;
    return base;
  }
  function skip(why) { st.run = null; st.why = why; }
  function onReading(r) {
    st.last = r;
    if (st.off || !ready() || document.hidden) return skip("off");
    if (!on()) return skip("setting");
    if (!(r.acc <= ACC_M)) { st.why = "accuracy"; return; }   // a poor fix is not counted (the run stays)
    if (ghost()) return skip("ghost");
    if (atHome(r.lat, r.lng)) return skip("home");
    var pin = pinNow(); if (!pin) return skip("no_pin");
    var d = U.haversine(r.lat, r.lng, pin.lat, pin.lng);
    if (d <= FAR_M) return skip("near");
    var run = st.run;
    if (!run || r.t - run.last > RUN_MAX_MS) { st.run = { t0: r.t, last: r.t, n: 1 }; st.why = "first"; return; }
    run.n++; run.last = r.t;
    if (r.t - run.t0 < GAP_MS) { st.why = "wait_gap"; return; }
    if (r.t - st.sentAt < SEND_GAP_MS || st.busy) { st.why = "rate"; return; }
    send(r, pin);
  }
  function send(r, pin) {
    st.busy = true; st.sentAt = r.t; st.why = "sent";
    A.rpc("pin_follow", { p_lat: r.lat, p_lng: r.lng, p_acc: Math.round(r.acc * 10) / 10, p_area: area() }).then(function (res) {
      st.busy = false;
      if (!res || res.error) {
        var m = String((res && res.error && (res.error.code || "") + " " + (res.error.message || "")) || "");
        if (/PGRST202|42883|does not exist|Could not find the function/i.test(m)) st.off = true;   // old server: stay quiet
        return;
      }
      var d = A.parseData(res.data) || {};
      if (d.ok && d.moved) {
        st.sent++; st.run = null;
        try { U.ls.setJSON(LAST, { lat: +d.lat, lng: +d.lng, at: Date.now(), night: pin.night }); } catch (e) {}
        var nk = String(pin.night || "");
        if (U.ls.get("olnu.pinFolj.told", "") !== nk) {   // one short note per night, the first time
          U.ls.set("olnu.pinFolj.told", nk);
          A.toast("Din pin flyttade med dig. Bara vänner och gänget ser det.", { id: "pf-moved", ms: 4000 });
        }
        try { A.refresh(); } catch (e) {}
      } else if (d.ok) st.run = null;                                            // the server sees it as near
      else if (d.reason === "wait") st.sentAt = r.t - SEND_GAP_MS + (d.wait_seconds | 0) * 1000;
      else if (d.reason === "no_pin") st.run = null;
    }, function () { st.busy = false; });
  }

  function settingsSheet(body) {
    if (!A || !A.LIVE) return;
    var el = A.el, v0 = on();
    var b = el("button", { type: "button", class: "btn btn-block pn-swb pf-row", role: "switch", "aria-checked": String(v0) });
    b.innerHTML = ic("pin") + '<span class="pn-sw-l">Pinnen följer med dig</span><span class="switch" aria-hidden="true" aria-checked="' + v0 + '"></span>';
    b.addEventListener("click", function () {
      var v = b.getAttribute("aria-checked") !== "true";
      setOn(v); b.setAttribute("aria-checked", String(v));
      var dot = b.querySelector(".switch"); if (dot) dot.setAttribute("aria-checked", String(v));
      A.toast(v ? "Pinnen följer med dig när appen ä öppen." : "Pinnen stannar där du loggade senast.", { id: "pf-set", ms: 3000 });
    });
    // under the auto check-in row (same "Karta – incheckning" group) when it is there
    var ac = body.querySelector(".ac-hint");
    var row = el("div", { class: "row pf-set" }, [b]), hint = el("p", { class: "muted pf-hint", text: "Bara vänner och gänget ser var du ä nu. Andra ser samma område som förut. Aldrig i spökläge eller hemma." });
    if (ac && ac.parentNode === body) { ac.after(row); row.after(hint); } else { body.appendChild(row); body.appendChild(hint); }
  }

  var hooked = false;
  // AUTOCI.listen (lg-patches/02): type "fix" = each reading autoci uses ({lat, lng, acc}). The time is autoci's own clock
  // (state().last.t: the same reading), so its test clock (_skew) also drives the 2-minute rules here.
  function hook() {
    var AC = window.AUTOCI;
    if (hooked || !AC || !AC.listen) return;
    hooked = true;
    AC.listen(function (type, x) {
      if (type !== "fix" || !x || !isFinite(x.lat) || !isFinite(x.lng)) return;
      var l = null; try { l = AC.state().last; } catch (e) { l = null; }
      var t = l && l.lat === x.lat && l.lng === x.lng && isFinite(l.t) ? l.t : Date.now();
      onReading({ lat: +x.lat, lng: +x.lng, acc: isFinite(x.acc) ? +x.acc : 9999, t: t });
    });
  }
  window.PINFOLJ = {
    init: function (api) { A = api; hook(); },
    onAuthed: function () { hook(); },
    settingsSheet: settingsSheet,
    on: on, setOn: setOn,
    state: function () { return { run: st.run, sentAt: st.sentAt, off: st.off, sent: st.sent, why: st.why, last: st.last, hooked: hooked, pin: A ? pinNow() : null }; },
    _reading: onReading   // tests
  };
})();
