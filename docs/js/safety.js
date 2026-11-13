/* PintsNow 🛡️ SAFETY — store-safe + trust & safety (store-compliance A1–A9, owner decisions 2026-11-07).
   window.SAFETY. Hooks reach it through window.PRIVACY (js/v14.js forwards init / onAuthed / settingsSheet), so the
   app.js mods() list is not touched. Server: migrations 0205–0211 (a missing RPC = that part is off, no error).
   What it does:
   - 🔞 Age gate: birth-year picker (intro + a one-time sheet for existing users). The server keeps only age_ok + date.
   - 📜 Regler: accepted once before the first post (chat, photo, voice, event, invite, offer …). Own overlay, so the
     open chat sheet stays. The post goes on after "Jag godkänner".
   - 🚩 Anmäl / 🚫 Blockera: added to the chat long-press menu (text, photo), a long-press on voice clips, the
     member card (MEDALS.openMember), invites, events and offers. Server hides a blocked person's chat, photos,
     voice, avatar and map pin both ways.
   - 📞 Ring 112 first in SOS and Följ mig hem, plus "Appen larmar inte själv."
   - Strangers' drink numbers are never shown (maskPins: own group and own pin keep their count).
   - DSA art. 17 notices ("why was this removed") from safety_state.
   Swedish only. */
(function () {
  "use strict";
  var U = window.U;
  var A = null;
  var SUPPORT = "support@pintsnow.com", TERMS_VER = 1;
  var TERMS_KEY = "olnu.terms", AGE_KEY = "olnu.age18", AGE_NO = "olnu.ageNo", AGE_PEND = "olnu.agePend", AGE_SRV = "olnu.ageSrv", AGE_ANS = "olnu.ageAns";
  var off = {};            // RPC missing on this server → that feature is off
  var stateCache = null;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  // uxfix P1-1: the pending answer stays in localStorage until set_age_ok says OK (sessionStorage was lost on a reopen,
  // so the sheet asked again). An old sessionStorage value is still read once.
  function pend(v) { if (v === undefined) return ls(AGE_PEND) || ss(AGE_PEND); ls(AGE_PEND, v); ss(AGE_PEND, null); return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function esc(s) { return U.esc(s); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(msg, o) { if (A && A.toast) A.toast(msg, o || {}); }
  // followups: PNI icons in this module's own overlay + buttons (no 🚩 / 🚫 emoji as icons). kpi (ds12): no emoji in labels, headings or toasts either
  function ic(n, cls) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n, cls == null ? "pi-lead" : cls) : ""; } catch (e) { return ""; } }
  function icT(n, t) { return ic(n) + esc(t); }
  function missing(err) { return !!(err && U && U.missing && U.missing(err)); }
  function code(err) { var m = String((err && (err.message || err.details || err.hint)) || ""); var x = /(slow_down|invalid_target|own_content|need_birthday|age_locked|invalid_year|not_found|invalid_kind)/.exec(m); return x ? x[1] : "error"; }
  function data(r) { return A && A.parseData ? A.parseData(r && r.data) : r && r.data; }
  function rpc(fn, p) { return A ? A.rpc(fn, p || {}) : Promise.resolve({ data: null, error: { message: "no_app" } }); }

  /* ---------- 🏪 store build flag (config.js sets window.OLNU_STORE; this is the fallback) ---------- */
  function store() {
    try {
      if (window.OLNU_STORE != null) return !!window.OLNU_STORE;
      return !!window.Capacitor || /[?&]app=(android|ios)\b/.test(location.search) || /^android-app:/.test(document.referrer || "") || ls("olnu.store") === "1";
    } catch (e) { return false; }
  }

  /* ---------- overlay (above sheets, toasts and the intro) ---------- */
  var ovEl = null;
  function overlay(build, opts) {
    closeOverlay();
    opts = opts || {};
    var card = h("div", { class: "sf-card", role: "dialog", "aria-modal": "true", "aria-label": opts.label || "PintsNow" });
    ovEl = h("div", { class: "sf-ov" + (opts.hard ? " sf-hard" : "") + (opts.block ? " sf-block" : "") }, [card]);
    if (!opts.hard) ovEl.addEventListener("click", function (e) { if (e.target === ovEl) { closeOverlay(); if (opts.onCancel) opts.onCancel(); } });
    document.body.appendChild(ovEl);
    build(card);
    var f = card.querySelector("button, select, input"); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
    return card;
  }
  function closeOverlay() { if (ovEl && ovEl.parentNode) ovEl.parentNode.removeChild(ovEl); ovEl = null; }

  /* ---------- 🔞 age ---------- */
  function thisYear() { try { return +new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric" }).format(new Date()); } catch (e) { return new Date().getFullYear(); } }
  // The widget drives a hidden checkbox (the intro's old "Jag är 18" box), so app.js keeps its own flow.
  function ageWidget(cb) {
    var Y = thisYear(), box = h("div", { class: "sf-age" });
    var sel = h("select", { class: "sf-age-sel", id: "sf-age-year", "aria-label": "Födelseår" });
    sel.appendChild(h("option", { value: "", text: "Välj år" }));
    sel.appendChild(h("option", { value: String(Y - 17), text: (Y - 17) + " eller senare" }));   // polishB P3-1: an 18+ app lists (year − 18) and older; younger = this one choice (the under-18 path)
    for (var y = Y - 18; y >= 1930; y--) sel.appendChild(h("option", { value: String(y), text: String(y) }));
    var bday = h("div", { class: "sf-age-bd", hidden: true }, [
      h("span", { text: "Har du fyllt år i år?" }),
      h("button", { type: "button", class: "btn btn-small", "data-bd": "1", text: "Ja" }),
      h("button", { type: "button", class: "btn btn-small", "data-bd": "0", text: "Nej, inte än" })
    ]);
    var msg = h("p", { class: "sf-age-msg", "aria-live": "polite" });
    box.appendChild(h("label", { class: "sf-age-l", for: "sf-age-year", text: "Vilket år är du född?" }));
    box.appendChild(sel); box.appendChild(bday); box.appendChild(msg);
    box.appendChild(h("p", { class: "sf-age-note muted", text: "Vi sparar bara att du är 18 år eller äldre, inte födelseåret." }));
    function set(ok) { if (cb) { cb.checked = !!ok; cb.dispatchEvent(new Event("change")); } }
    function decide(year, had) {
      var d = Y - year;
      if (d === 18 && had == null) { bday.hidden = false; msg.textContent = ""; set(false); return; }
      var ok = d > 18 || (d === 18 && had);
      bday.hidden = d !== 18;
      if (ok) {
        msg.className = "sf-age-msg ok"; msg.innerHTML = icT("check", "Välkommen in.");
        ls(AGE_KEY, "1"); ls(AGE_NO, null); ls(AGE_ANS, "1");
        pend(JSON.stringify({ y: year, b: d === 18 ? !!had : null }));
        set(true);
        flushAge();
      } else {
        msg.className = "sf-age-msg no"; msg.textContent = "";
        ls(AGE_NO, String(Date.now())); ls(AGE_KEY, null);
        pend(JSON.stringify({ y: year, b: d === 18 ? !!had : null }));
        set(false);
        flushAge();
        setTimeout(showUnder18, 150);
      }
    }
    sel.addEventListener("change", function () { if (sel.value) decide(+sel.value, null); else set(false); });
    bday.addEventListener("click", function (e) { var b = e.target.closest("[data-bd]"); if (b && sel.value) decide(+sel.value, b.getAttribute("data-bd") === "1"); });
    if (cb) { cb.checked = false; cb.hidden = true; }
    return box;
  }
  function under18() { var t = +ls(AGE_NO) || 0; return t > 0 && Date.now() - t < 24 * 3600e3; }
  function showUnder18() {
    overlay(function (c) {
      c.appendChild(h("div", { class: "sf-big", text: "🧃" }));
      c.appendChild(h("h2", { text: "Du behöver vara 18 år" }));
      c.appendChild(h("p", { text: "PintsNow är bara för dig som har fyllt 18. Välkommen tillbaka när du har fyllt 18." }));
      c.appendChild(h("p", { class: "muted", text: "Valde du fel år? Du kan försöka igen i morgon." }));
    }, { hard: true, block: true, label: "Bara 18+" });
  }
  // Send a pending answer (from the intro or the sheet) once there is a session. The year is then forgotten.
  var ageBusy = false;
  function flushAge() {
    var p = null; try { p = JSON.parse(pend() || "null"); } catch (e) { p = null; }
    if (!p || !A || !A.authed || !A.authed() || ageBusy || off.age) return Promise.resolve(null);
    ageBusy = true;
    return rpc("set_age_ok", { p_birth_year: p.y, p_had_birthday: p.b }).then(function (r) {
      ageBusy = false;
      if (r.error) {
        if (missing(r.error)) { off.age = true; pend(null); }
        else if (code(r.error) === "age_locked") { pend(null); ls(AGE_NO, String(Date.now())); showUnder18(); }
        return null;
      }
      pend(null);
      var d = data(r) || {};
      ls(AGE_SRV, d.age_ok ? "1" : "0");
      if (stateCache) stateCache.age_ok = !!d.age_ok;
      if (d.age_ok === false) { ls(AGE_NO, String(Date.now())); ls(AGE_KEY, null); showUnder18(); }
      return d;
    });
  }
  // Ask only when nothing is pending, the server has no answer, and the intro (which has its own picker) is closed.
  function maybeAskAge() {
    var intro = document.getElementById("intro");
    if ((intro && !intro.hidden) || ls("olnu.intro") !== "1") { setTimeout(maybeAskAge, 1500); return; }   // new user: the intro asks
    // uxfix P1-1: answered with the year picker in this install (join card, intro or this sheet) = never a 2nd sheet.
    // The upgrade case (old 18+ box only: olnu.age18 = "1" but no olnu.ageAns) still gets the sheet ONCE.
    if (ls(AGE_KEY) === "1" && ls(AGE_ANS) === "1") return;
    if (pend() || ls(AGE_SRV) === "1" || (stateCache && stateCache.age_ok != null) || ovEl) return;
    askAgeOnce();
  }
  // Existing users who only ticked the old 18+ box: one sheet, once.
  function askAgeOnce() {
    overlay(function (c) {
      var cb = h("input", { type: "checkbox", hidden: true });
      var go = h("button", { type: "button", class: "btn btn-amber btn-block", disabled: true, text: "Kör!" });
      cb.addEventListener("change", function () { go.disabled = !cb.checked; });
      go.addEventListener("click", function () { if (cb.checked) closeOverlay(); });
      c.appendChild(h("div", { class: "sf-big", text: "🎂" }));
      c.appendChild(h("h2", { text: "En snabb kontroll" }));
      c.appendChild(h("p", { text: "Appbutikerna kräver att vi frågar en gång. Svara, så behöver vi inte fråga igen." }));
      c.appendChild(ageWidget(cb));
      c.appendChild(go);
    }, { hard: true, label: "Ålder" });
  }

  /* ---------- 📜 Regler ---------- */
  var RULES = [
    "Inga trakasserier, hot eller hat. Mot någon.",
    "Ingen nakenhet och inget sexuellt.",
    "Inga droger. Ingen försäljning av alkohol eller annat.",
    "Inget om minderåriga och alkohol. PintsNow är för dig som är 18 år eller äldre.",
    "Dela inte andras bilder, röst eller plats utan att de vill.",
    "Inget spam, inga bluffar, inga falska konton."
  ];
  function rulesBody(c) {
    c.appendChild(h("h2", { html: icT("rules", "Regler i PintsNow") }));
    c.appendChild(h("p", { text: "Kort och tydligt. Det här gäller chatt, bilder, röstklipp, namn, avatarer, event och tips:" }));
    c.appendChild(h("ul", { class: "sf-rules" }, RULES.map(function (r) { return h("li", { text: r }); })));
    c.appendChild(h("p", { text: "Ser du något som bryter mot reglerna? Tryck på inlägget → Anmäl, eller Blockera personen. Vi läser varje anmälan inom 24 timmar och tar bort det som bryter mot reglerna. Den som bryter mot dem flera gånger kan stängas av." }));
    var cl = h("p", { class: "muted", html: "Frågor? <a href=\"#\" class=\"sf-ct-link\">Skriv till oss i appen</a> · eller mejla <a href=\"mailto:" + SUPPORT + "\">" + SUPPORT + "</a>" });   // ownerfix 6
    cl.querySelector(".sf-ct-link").addEventListener("click", function (e) { e.preventDefault(); closeOverlay(); contactSheet("fraga"); });
    c.appendChild(cl);
  }
  // Unknown server state (old server, offline, first second after start) = no gate; the server answer decides.
  var termsMem = false;   // left T-05b: accepted in this page life (also when localStorage is blocked: never ask twice for one post)
  function termsOk() { return termsMem || !stateCache || ls(TERMS_KEY) === String(TERMS_VER) || (stateCache.terms_ver | 0) >= TERMS_VER; }
  var termsWait = null;
  function ensureTerms() {
    if (termsOk() || off.terms) return Promise.resolve(true);
    if (termsWait) return termsWait;
    termsWait = new Promise(function (resolve) {
      overlay(function (c) {
        rulesBody(c);
        var yes = h("button", { type: "button", class: "btn btn-amber btn-block sf-accept", html: icT("check", "Jag godkänner") });
        var no = h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Inte nu" });
        yes.addEventListener("click", function () {
          yes.disabled = true;
          termsMem = true; ls(TERMS_KEY, String(TERMS_VER));
          (origRpc ? origRpc("accept_terms", { p_ver: TERMS_VER }) : Promise.resolve(null)).then(function () {}, function () {});
          closeOverlay(); termsWait = null; resolve(true);
        });
        no.addEventListener("click", function () { closeOverlay(); termsWait = null; resolve(false); });
        c.appendChild(yes); c.appendChild(no);
      }, { label: "Regler", onCancel: function () { termsWait = null; resolve(false); } });
    });
    return termsWait;
  }
  function showRules() { overlay(function (c) { rulesBody(c); c.appendChild(h("button", { type: "button", class: "btn btn-block", text: "Stäng", onclick: closeOverlay })); }, { label: "Regler" }); }

  // Gate the post RPCs on the Supabase client (app.js and every module call client.rpc). Reads are never gated.
  var POST_FNS = { post_group_msg: 1, post_photo: 1, post_voice: 1, invite_create: 1, add_offer: 1, submit_event: 1, skal_photo: 1,
    film_photo: 1, film_shoot: 1, bar_photo_share: 1, create_rally: 1, send_tip: 1, add_quote: 1, submit_wish: 1, set_board_optin: 1 };
  var origRpc = null;
  (function wrapClient() {
    var sb = window.supabase;
    if (!sb || typeof sb.createClient !== "function" || sb.createClient.__sf) return;
    var make = sb.createClient;
    sb.createClient = function () {
      var c = make.apply(this, arguments);
      try {
        var raw = c.rpc.bind(c);
        origRpc = raw;
        c.rpc = function (fn, args, o) {
          if (!POST_FNS[fn] || termsOk() || off.terms) return raw(fn, args, o);
          return ensureTerms().then(function (ok) {
            return ok ? raw(fn, args, o) : { data: null, error: { message: "terms_needed", code: "terms_needed" } };
          });
        };
      } catch (e) {}
      return c;
    };
    sb.createClient.__sf = 1;
  })();

  /* ---------- 🚩 report + 🚫 block ---------- */
  var REASONS = [["hat", "Hat eller kränkning"], ["hot", "Hot eller trakasserier"], ["sex", "Sexuellt eller naket"],
    ["minor", "Minderårig"], ["drog", "Droger eller försäljning"], ["spam", "Spam eller bluff"], ["annat", "Annat"]];
  // t = { kind, ref?, group?, k?, name?, what? }
  function reportSheet(t) {
    if (off.report) { mailFallback(t); return; }
    overlay(function (c) {
      var reason = "";
      c.appendChild(h("h2", { html: icT("flag", "Anmäl " + (t.what || "inlägget")) }));
      c.appendChild(h("p", { class: "muted", text: "Vad är fel? Den du anmäler får inte veta att det var du." }));
      var chips = h("div", { class: "sf-chips", role: "radiogroup", "aria-label": "Orsak" });
      REASONS.forEach(function (r) {
        chips.appendChild(h("button", { type: "button", class: "sf-chip", role: "radio", "aria-checked": "false", "data-r": r[0], text: r[1] }));
      });
      chips.addEventListener("click", function (e) {
        var b = e.target.closest("[data-r]"); if (!b) return;
        reason = b.getAttribute("data-r");
        chips.querySelectorAll("[data-r]").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        send.disabled = false;
      });
      c.appendChild(chips);
      var note = h("textarea", { class: "sf-note", maxlength: "300", rows: "2", placeholder: "Vill du lägga till något? (frivilligt)" });
      c.appendChild(note);
      var also = null;
      if (t.kind !== "event") {
        also = h("input", { type: "checkbox", id: "sf-also" });
        c.appendChild(h("label", { class: "sf-also", for: "sf-also" }, [also, h("span", { text: "Blockera personen också" })]));
      }
      var send = h("button", { type: "button", class: "btn btn-danger btn-block", disabled: true, html: icT("flag", "Skicka anmälan") });
      send.addEventListener("click", function () {
        send.disabled = true;
        rpc("report_content", { p_kind: t.kind, p_ref: t.ref == null ? null : String(t.ref), p_group: t.group || null, p_k: t.k || null, p_reason: reason, p_note: note.value || null })
          .then(function (r) {
            if (r.error) {
              send.disabled = false;
              if (missing(r.error)) { off.report = true; closeOverlay(); mailFallback(t); return; }
              var c2 = code(r.error);
              toast(c2 === "slow_down" ? "Du har skickat många anmälningar på kort tid. Vänta en stund." : c2 === "own_content" ? "Det här är ditt eget inlägg." :
                c2 === "invalid_target" ? "Det gick inte att hitta inlägget. Det kan redan vara borttaget." : "Anmälan gick inte iväg. Försök igen.", { err: true });
              return;
            }
            closeOverlay();
            var d = data(r) || {};
            toast(d.hidden ? "Tack! Inlägget är dolt tills vi har kollat." : "Tack! Vi kollar inom 24 timmar.", { ms: 4500 });
            if (also && also.checked) doBlock(t);
          });
      });
      c.appendChild(send);
      c.appendChild(h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Avbryt", onclick: closeOverlay }));
    }, { label: "Anmäl" });
  }
  function mailFallback(t) {
    var body = "Hej! Jag vill anmäla " + (t.what || "ett inlägg") + (t.name ? " från " + t.name : "") + " i PintsNow.%0A%0AVad hände:%0A";
    location.href = "mailto:" + SUPPORT + "?subject=" + encodeURIComponent("Anmälan i PintsNow") + "&body=" + body;
  }
  function blockSheet(t) {
    var who = t.name ? t.name : "personen";
    overlay(function (c) {
      c.appendChild(h("h2", { html: icT("block", "Blockera " + who + "?") }));
      c.appendChild(h("ul", { class: "sf-rules" }, [
        // fixS T-01/T-23: the same facts as the DM block sheet (dm.js), plain Swedish
        h("li", { text: "Ni ser inte varandra på kartan, i Vänner eller i chattar, bilder och röstklipp." }),
        h("li", { text: "Vänskapen tas bort. Ni kan inte skriva till varandra." }),
        h("li", { text: "Hen får ingen notis. Hen ser bara att chatten är stängd." }),
        h("li", { text: "Ångra under Inställningar → Integritet & synlighet → Blockerade." })
      ]));
      c.appendChild(h("button", { type: "button", class: "btn btn-danger btn-block", html: icT("block", "Blockera"), onclick: function () { closeOverlay(); doBlock(t); } }));
      c.appendChild(h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Avbryt", onclick: closeOverlay }));
    }, { label: "Blockera" });
  }
  function doBlock(t) {
    rpc("block_user", { p_kind: t.kind === "event" ? "person" : t.kind, p_ref: t.ref == null ? null : String(t.ref), p_group: t.group || null, p_k: t.k || null, p_on: true })
      .then(function (r) {
        if (r.error) {
          if (missing(r.error)) { toast("Blockera finns inte på servern än.", { err: true }); return; }
          toast(code(r.error) === "slow_down" ? "Vänta en minut och försök igen." : "Det gick inte att blockera. Försök igen.", { err: true });
          return;
        }
        var d = data(r) || {};
        toast((d.name || t.name || "Personen") + " är blockerad.", { ms: 4500 });   // fixS: same line as the DM block
        // rows already on screen go now; the server leaves them out from the next load
        var nm = d.name || t.name || "";
        if (nm) document.querySelectorAll(".chat-msg:not(.me)").forEach(function (x) { if (authorOf(x) === nm) x.remove(); });
        try { if (window.WARM && window.WARM.clear) window.WARM.clear(); } catch (e) {}   // fixS T-01: no cached read shows the person again
        if (A && A.refresh) setTimeout(function () { A.refresh(); }, 300);
        try { if (window.SUGGEST && window.SUGGEST.refresh) window.SUGGEST.refresh(); } catch (e) {}   // fixS T-01: "Du kanske känner" again
        try { if (typeof t.onDone === "function") t.onDone(d); } catch (e) { try { console.warn("olnu safety onDone", e); } catch (x) {} }
      });
  }
  // One small action menu (report + block) for any target.
  function actions(t) {
    overlay(function (c) {
      c.appendChild(h("h2", { text: t.title || "Vad vill du göra?" }));
      c.appendChild(h("button", { type: "button", class: "btn btn-block", html: icT("flag", "Anmäl " + (t.what || "")), onclick: function () { closeOverlay(); reportSheet(t); } }));
      if (t.kind !== "event") c.appendChild(h("button", { type: "button", class: "btn btn-block", html: icT("block", "Blockera " + (t.name || "personen")), onclick: function () { closeOverlay(); blockSheet(t); } }));
      c.appendChild(h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Avbryt", onclick: closeOverlay }));
    }, { label: "Åtgärder" });
  }

  /* ---------- hooks into other modules' DOM (no edits in their files) ---------- */
  // The chat head may carry a rank before the name ("🎖️ Korpral Korkskruv Lisa"): the last word is the name.
  // group_status_v3 adds the merits after it ("🎖️ Skumsergeant Oskar · 40 meriter", social.js headText): drop that first,
  // else the menu says "Blockera meriter" and a block leaves the rows on screen.
  function authorOf(li) { var n = li && li.querySelector(".cm-name"); var x = n ? String(n.textContent || "").trim().replace(/\s+·\s+\d+\s+(meriter|merits)$/, "") : ""; return /^🎖️/.test(x) ? x.split(/\s+/).pop() : x; }
  // Chat long-press menu (social.js .cm-picker): add 🚩 / 🚫 for other people's messages and photos.
  function onPicker(pk) {
    if (pk.__sf) return; pk.__sf = 1;
    var li = pk.closest(".chat-msg"); if (!li || li.classList.contains("me")) return;
    var ph = li.getAttribute("data-ph"), mid = li.getAttribute("data-mid");
    var t = ph ? { kind: "photo", ref: ph, what: "bilden" } : mid ? { kind: "msg", ref: mid, what: "meddelandet" } : null;
    if (!t) return;
    t.name = authorOf(li);
    var close = function () { if (pk.parentNode) pk.parentNode.removeChild(pk); };
    var rep = h("button", { type: "button", class: "cm-pick sf-pick", role: "menuitem", title: "Anmäl", "aria-label": "Anmäl", html: ic("flag", "") || "!" });
    var blk = h("button", { type: "button", class: "cm-pick sf-pick", role: "menuitem", title: "Blockera", "aria-label": "Blockera " + (t.name || "personen"), html: ic("block", "") || "×" });
    rep.addEventListener("click", function (e) { e.stopPropagation(); close(); reportSheet(t); });
    blk.addEventListener("click", function (e) { e.stopPropagation(); close(); blockSheet(t); });
    pk.appendChild(rep); pk.appendChild(blk);
  }
  // Voice clips (after.js .af-voice) and photo rows have no picker: a long-press (550 ms) opens the action menu.
  var lpT = null;
  function lpStart(e) {
    var li = e.target.closest && e.target.closest(".chat-msg.af-voice:not(.me), .chat-msg[data-ph]:not(.me)");
    if (!li || e.target.closest("button, a, audio, input")) return;
    clearTimeout(lpT);
    lpT = setTimeout(function () {
      if (li.querySelector(".cm-picker")) return;   // social.js picker opened: it has 🚩 / 🚫 already
      var v = li.getAttribute("data-afvid");
      var t = v ? { kind: "voice", ref: v, what: "röstklippet" } : { kind: "photo", ref: li.getAttribute("data-ph"), what: "bilden" };
      t.name = authorOf(li);
      actions(t);
    }, 550);
  }
  function lpStop() { clearTimeout(lpT); }
  // Invites (invite.js .inv-view[data-id]), events (evsheet.js .evs-detail[data-evid]), offers (barsplus .bp-of).
  function decorate(root) {
    (root.querySelectorAll ? root : document).querySelectorAll(".inv-view[data-id]:not([data-sf])").forEach(function (v) {
      v.setAttribute("data-sf", "1");
      v.appendChild(h("button", { type: "button", class: "sf-mini", html: icT("flag", "Anmäl inbjudan"), onclick: function () { reportSheet({ kind: "invite", ref: v.getAttribute("data-id"), what: "inbjudan" }); } }));
    });
    (root.querySelectorAll ? root : document).querySelectorAll(".evs-detail[data-evid]").forEach(function (v) {
      if (v.querySelector(".sf-mini")) return;
      v.appendChild(h("button", { type: "button", class: "sf-mini", html: icT("flag", "Anmäl eventet"), onclick: function () { reportSheet({ kind: "event", ref: v.getAttribute("data-evid"), what: "eventet" }); } }));
    });
    if (!store()) (root.querySelectorAll ? root : document).querySelectorAll(".bp-of:not([data-sf])").forEach(function (o) {
      o.setAttribute("data-sf", "1");
      var b = o.querySelector("[data-of]"); if (!b || b.disabled) return;   // own offer: vote buttons are disabled
      var id = b.getAttribute("data-of");
      var v = o.querySelector(".bp-of-v") || o;
      v.appendChild(h("button", { type: "button", class: "bp-v sf-of", "aria-label": "Anmäl tipset", title: "Anmäl", html: ic("flag", "") || "!",
        onclick: function (e) { e.stopPropagation(); reportSheet({ kind: "offer", ref: id, what: "tipset" }); } }));
    });
  }
  function watch() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var add = list[i].addedNodes;
        for (var j = 0; j < add.length; j++) {
          var n = add[j]; if (n.nodeType !== 1) continue;
          if (n.classList.contains("cm-picker")) onPicker(n);
          else if (n.querySelector) { var p = n.querySelector(".cm-picker"); if (p) onPicker(p); }
          if (n.matches && (n.matches(".inv-view, .evs-detail, .bp-of") || n.querySelector(".inv-view, .evs-detail, .bp-of"))) decorate(n.parentNode || document);
          else if (n.closest && n.closest(".evs-detail")) decorate(n.closest(".evs-detail").parentNode);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", lpStart, true);
    ["pointerup", "pointercancel", "pointermove", "scroll"].forEach(function (k) { document.addEventListener(k, function (e) { if (k !== "pointermove" || (e.movementX * e.movementX + e.movementY * e.movementY) > 36) lpStop(); }, true); });
  }

  // Member card (medals.js openMember): 🚩 / 🚫 for someone else. m = { name, k?, is_me }, g = group.
  function personActions(body, g, m) {
    if (!body || !m || m.is_me || !g || !g.id) return;
    var row = h("div", { class: "row sf-person" });
    var t = { kind: "person", group: g.id, k: m.k || null, name: m.name || "", what: m.name ? m.name + " (namn/bild)" : "personen" };
    function need() {
      if (t.k) return Promise.resolve(t);
      return rpc("avatars_for", { p_group_id: g.id }).then(function (r) {
        var d = data(r) || {}, hit = (d.people || []).filter(function (p) { return !p.is_me && p.name === m.name; })[0];
        if (hit && hit.k) t.k = hit.k;
        return t;
      });
    }
    row.appendChild(h("button", { type: "button", class: "btn btn-small", html: icT("flag", "Anmäl"), onclick: function () { need().then(reportSheet); } }));
    row.appendChild(h("button", { type: "button", class: "btn btn-small", html: icT("block", "Blockera"), onclick: function () { need().then(blockSheet); } }));
    body.appendChild(row);
  }

  /* ---------- 📞 SOS / Följ mig hem ---------- */
  function sos112(container) {
    if (!container || container.querySelector(".sf-112")) return;
    var box = h("div", { class: "sf-112" }, [
      h("a", { class: "btn btn-danger btn-block sf-112-btn", href: "tel:112", html: icT("phone", "Ring 112") }),
      h("p", { class: "sf-112-note", text: "Appen larmar inte själv." })
    ]);
    container.insertBefore(box, container.firstChild);
  }
  function wrapSos() {
    var S = window.SOCIAL;
    if (S && typeof S.sosBlock === "function" && !S.sosBlock.__sf) {
      var o = S.sosBlock;
      S.sosBlock = function (c) { var r = o.apply(this, arguments); var w = c && c.querySelector && c.querySelector(".sos-block"); if (w) sos112(w); return r; };
      S.sosBlock.__sf = 1;
    }
  }

  /* ---------- 🔢 own group sees counts; strangers never see a number ---------- */
  function maskPins(list) {
    if (!Array.isArray(list)) return list;
    list.forEach(function (p) {
      if (!p || p.is_mine || p.friend_name || p._demo) return;
      var n = (p.beer_count | 0) + (p.other_count | 0);
      p._nc = 1; p.beer_count = n > 0 ? 1 : 0; p.other_count = 0; p.other_kind = null;
    });
    return list;
  }

  /* ---------- server state: age (existing users), notices (DSA art. 17), terms ---------- */
  function loadState() {
    if (off.state) return;
    flushAge().then(function () {
      return rpc("safety_state", { p_seen: false });
    }).then(function (r) {
      if (!r) return;
      if (r.error) { if (missing(r.error)) off.state = true; return; }
      var d = data(r);
      if (!d || typeof d !== "object" || Array.isArray(d) || d.v !== 1) return;   // old server / mock
      stateCache = d;
      if ((d.terms_ver | 0) >= TERMS_VER) ls(TERMS_KEY, String(TERMS_VER));
      if (d.age_ok === false) { ls(AGE_NO, String(Date.now())); showUnder18(); return; }
      if (d.age_ok == null) maybeAskAge();
      if (d.age_ok) ls(AGE_SRV, "1");
      var nn = Array.isArray(d.notices) ? d.notices : [];
      if (nn.length) {
        overlay(function (c) {
          c.appendChild(h("h2", { html: icT("megaphone", "Från PintsNow") }));
          nn.forEach(function (x) { c.appendChild(h("p", { text: String(x.text || "") })); });
          var cn = h("p", { class: "muted", html: "Tycker du att det blev fel? <a href=\"#\" class=\"sf-ct-link\">Skriv till oss</a> · eller mejla <a href=\"mailto:" + SUPPORT + "\">" + SUPPORT + "</a>." });   // ownerfix 6
          cn.querySelector(".sf-ct-link").addEventListener("click", function (e) { e.preventDefault(); closeOverlay(); rpc("safety_state", { p_seen: true }); contactSheet("annat"); });
          c.appendChild(cn);
          c.appendChild(h("button", { type: "button", class: "btn btn-amber btn-block", text: "Uppfattat", onclick: function () { closeOverlay(); rpc("safety_state", { p_seen: true }); } }));
        }, { label: "Meddelande" });
      }
    });
  }

  /* ---------- ⚙️ settings: one line + Regler, Blockerade, kontakt ---------- */
  function blockedSheet() {
    overlay(function (c) {
      c.appendChild(h("h2", { html: icT("shield", "Blockerade") }));
      var ul = h("ul", { class: "sf-blist" }, [h("li", { class: "muted", text: "…" })]);
      c.appendChild(ul);
      c.appendChild(h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Stäng", onclick: closeOverlay }));
      rpc("my_blocks").then(function (r) {
        ul.innerHTML = "";
        var d = r.error ? null : data(r), list = d && Array.isArray(d.blocks) ? d.blocks : [];
        if (!list.length) { ul.appendChild(h("li", { class: "muted", text: r.error && missing(r.error) ? "Finns inte på servern än." : "Du har inte blockerat någon." })); return; }
        list.forEach(function (b) {
          var li = h("li", {}, [h("span", { html: icT("block", b.name || "?") })]);
          li.appendChild(h("button", { type: "button", class: "btn btn-small sf-unb", text: "Avblockera", "aria-label": "Avblockera " + (b.name || "personen"), onclick: function (e) {
            var btn = e.currentTarget; btn.disabled = true;
            rpc("unblock_user", { p_id: b.id }).then(function (x) {
              if (x.error) { btn.disabled = false; toast("Det gick inte. Försök igen.", { err: true }); return; }
              li.remove(); toast((b.name || "Personen") + " är inte blockerad längre.");
              if (!ul.children.length) ul.appendChild(h("li", { class: "muted", text: "Du har inte blockerat någon." }));
              try { if (window.DM && window.DM.afterUnblock) window.DM.afterUnblock(b.name || ""); } catch (e2) {}   // b1people I-03: the DM opens again at once
              if (A && A.refresh) A.refresh();
            });
          } }));
          ul.appendChild(li);
        });
      });
    }, { label: "Blockerade" });
  }
  /* ---------- ownerfix 6: ✉️ Kontakt = an in-app form (was a mailto link) ---------- */
  var TOPICS = [["fraga", "Fråga"], ["anmalan", "Anmälan"], ["fel", "Fel i appen"], ["annat", "Annat"]];
  var MAIL_RX = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
  function contactSheet(pre) {
    var topic = pre || "fraga";
    if (!(A && A.LIVE)) { location.href = "mailto:" + SUPPORT; return; }   // demo / no server: the mail app as before
    overlay(function (c) {
      c.classList.add("sf-ct");
      c.appendChild(h("h2", { html: icT("mail", "Kontakta oss") }));
      c.appendChild(h("p", { class: "muted", text: "Skriv här, vi läser allt. Vill du ha svar? Lämna din e-post." }));
      var hint = h("p", { class: "muted sf-ct-hint", hidden: true, text: "Gäller det ett inlägg, en bild eller en person? Tryck på det i appen → Anmäl, så hamnar det rätt direkt." });
      var chips = h("div", { class: "sf-chips sf-ct-chips", role: "radiogroup", "aria-label": "Ämne" });
      TOPICS.forEach(function (x) { chips.appendChild(h("button", { type: "button", class: "sf-chip", role: "radio", "aria-checked": String(x[0] === topic), "data-t": x[0], text: x[1] })); });
      chips.addEventListener("click", function (e) {
        var b = e.target.closest("[data-t]"); if (!b) return;
        topic = b.getAttribute("data-t");
        chips.querySelectorAll("[data-t]").forEach(function (y) { y.setAttribute("aria-checked", String(y === b)); });
        hint.hidden = topic !== "anmalan";
      });
      c.appendChild(chips); c.appendChild(hint); hint.hidden = topic !== "anmalan";
      var ta = h("textarea", { class: "sf-note sf-ct-text", maxlength: "800", rows: "4", placeholder: "Vad vill du säga?", "aria-label": "Meddelande" });
      c.appendChild(ta);
      var mail = h("input", { class: "inp sf-ct-mail", type: "email", inputmode: "email", autocomplete: "email", maxlength: "120", placeholder: "Din e-post (frivilligt, för svar)", "aria-label": "Din e-post (frivilligt)" });
      c.appendChild(mail);
      var send = h("button", { type: "button", class: "btn btn-amber btn-block sf-ct-send", html: icT("mail", "Skicka") });
      send.addEventListener("click", function () {
        var t = String(ta.value || "").trim(), m = String(mail.value || "").trim();
        if (t.length < 3) { toast("Skriv lite mer först.", { err: true }); try { ta.focus(); } catch (e) {} return; }
        if (m && !MAIL_RX.test(m)) { toast("Kolla e-posten, den ser konstig ut.", { err: true }); try { mail.focus(); } catch (e) {} return; }
        var lab = (TOPICS.filter(function (x) { return x[0] === topic; })[0] || TOPICS[0])[1];
        var body = "[kontakt · " + lab + "] " + t + (m ? " · svar till: " + m : "");
        var v = ""; try { var sc = [].slice.call(document.scripts).map(function (x) { return x.src || ""; }).filter(function (x) { return /app\.js/.test(x); })[0]; v = ((/[?&]v=([^&]+)/.exec(sc || "") || [])[1] || "").slice(0, 40); } catch (e) {}   // same as knas.js ver()
        send.disabled = true;
        rpc("submit_knas", { p_text: body, p_shot: null, p_logs: [], p_meta: { from: "kontakt", v: v } }).then(function (r) {
          if (r && r.error && missing(r.error)) return rpc("submit_feedback", { p_kind: topic === "fel" ? "bug" : "wish", p_text: body, p_meta: { v: v } });   // 0410 not run yet
          return r;
        }).then(function (r) {
          send.disabled = false;
          var e = r && r.error, msg = e ? String(e.message || "") : "";
          if (e && /slow_down/.test(msg)) { toast("Du har skickat många meddelanden i dag. Försök igen i morgon.", { err: true, ms: 5000 }); return; }
          if (e) { toast("Det gick inte att skicka. Försök igen, eller mejla oss.", { err: true, ms: 5000 }); return; }
          closeOverlay();
          toast(m ? "Tack! Vi svarar till " + m + "." : "Tack! Meddelandet har kommit fram.", { ms: 4500 });
        });
      });
      c.appendChild(send);
      c.appendChild(h("button", { type: "button", class: "btn btn-block btn-ghost", text: "Avbryt", onclick: closeOverlay }));
      c.appendChild(h("p", { class: "muted sf-ct-mailto", html: "Fungerar inte formuläret? Mejla <a href=\"mailto:" + SUPPORT + "\">" + SUPPORT + "</a>" }));
    }, { label: "Kontakt" });
  }
  function settingsSheet(body) {
    if (!body || body.querySelector(".sf-set")) return;
    var box = h("div", { class: "sf-set" });
    box.appendChild(h("h3", { html: icT("shield", "Trygghet") }));
    box.appendChild(h("p", { class: "sf-line", text: "Vi räknar kvällar och kompisar, inte glas." }));
    var row = h("div", { class: "row sf-set-row" });
    row.appendChild(h("button", { type: "button", class: "btn btn-small", html: icT("rules", "Regler"), onclick: showRules }));
    if (A && A.LIVE && A.authed && A.authed()) row.appendChild(h("button", { type: "button", class: "btn btn-small", html: icT("block", "Blockerade"), onclick: blockedSheet }));
    row.appendChild(h("button", { type: "button", class: "btn btn-small sf-ct-open", html: icT("mail", "Kontakt"), onclick: function () { contactSheet(); } }));   // ownerfix 6
    box.appendChild(row);
    body.appendChild(box);
  }

  window.SAFETY = {
    init: function (api) {
      A = api;
      if (store()) document.documentElement.classList.add("olnu-store");
      watch(); wrapSos();
      if (under18()) setTimeout(showUnder18, 50);
    },
    onAuthed: function () { wrapSos(); loadState(); },
    settingsSheet: settingsSheet,
    ageWidget: ageWidget, ensureTerms: ensureTerms, showRules: showRules, rulesBody: rulesBody,
    report: reportSheet, block: blockSheet, contact: contactSheet, actions: actions, personActions: personActions,
    blocked: blockedSheet, sos112: sos112, maskPins: maskPins, store: store, SUPPORT: SUPPORT, _state: function () { return stateCache; },
    // left T-05b: true = this post RPC (or any post, fn empty) must wait for Regler first (app.js rpcNet1 + the post buttons ask ensureTerms())
    needTerms: function (fn) { return (!fn || !!POST_FNS[fn]) && !termsOk() && !off.terms; },
    _beers: function () { return A && A.beers ? A.beers() : []; }   // tests only
  };
})();
