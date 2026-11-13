/* PintsNow — misc lane: account deletion with 7 days to undo (X4), Grundare / founders (F4), moderation hooks (X5).
   window.MISC. Server: migrations 0400–0403 (owner-run at release). A missing RPC = that part is off and the old
   behaviour stays (old server → the old instant "Radera mitt konto" flow in v14.js).
   Hooks: wraps window.PRIVACY (v14.js) init / onAuthed / showDelete, the same way safety.js gets its hooks, so the
   app.js mods() list needs no new entry. The existing Inställningar button (app.js → PRIVACY.showDelete) opens the
   new sheet.
   API (for the lanes that own the screens):
   - MISC.deleteAccountRow()          a .ds-row "Radera mitt konto" (sub line in the 7 days: "Raderas om N dagar …").
   - MISC.openDelete()                the sheet: confirm step → request_account_deletion; in the 7 days: Ångra.
   - MISC.deletionState()             Promise → { pending, due_at, days_left } | null (old server).
   - MISC.isFounder()                 Promise → true / false (my_founder, 0401).
   - MISC.founderBadge({ always })    a small "Grundare" badge; shows once the owner has set the launch cutoff
                                      (always: true = show now too). Fills in when my_founder answers.
   - MISC.reportMenu(msg)             🚩 / 🚫 menu for a chat item: msg = { id, name, photo_id?, voice_id? } (safety.js).
   - MISC.blockFilmAuthor(id, done)   confirm, then film_block (0400): block the person who took a film photo.
   - MISC.filmReportRow(id, done)     a row for film.js's report sheet ("Blockera den som tog bilden").
   Swedish only (like safety.js). Classes: mm-*. */
(function () {
  "use strict";
  var A = null, off = {}, del = null, delAt = 0, founder = null, founderP = null;
  var rows = [], badges = [], origShowDelete = null;
  var TOAST_SS = "olnu.mmDelToast", SUPPORT = "support@pintsnow.com";

  function rpc(fn, p) { return A && A.rpc ? A.rpc(fn, p || {}) : Promise.resolve({ data: null, error: { message: "no_app" } }); }
  function data(r) { return A && A.parseData ? A.parseData(r && r.data) : r && r.data; }
  function missing(e) { return !!(e && window.U && window.U.missing && window.U.missing(e)); }
  function code(e) { var m = String((e && (e.message || e.details || e.hint)) || ""); var x = /(slow_down|own_content|photo_not_found|not_member|not_authenticated)/.exec(m); return x ? x[1] : "error"; }
  function authed() { try { return !!(A && A.authed && A.authed()); } catch (e) { return false; } }
  function icon(n) { try { return window.PNI ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function toast(m, o) { if (A && A.toast) A.toast(m, o || {}); }
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

  /* ---------- 🗑️ Radera kontot: 7 days to undo (0402) ---------- */
  function daysTxt(n) { n = n | 0; return n <= 0 ? "i natt" : n === 1 ? "om 1 dag" : "om " + n + " dagar"; }
  function dayTxt(iso) {
    try { return new Intl.DateTimeFormat("sv-SE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Stockholm" }).format(new Date(iso)); }
    catch (e) { return ""; }
  }
  function loadDel(force) {
    if (off.del || !authed()) return Promise.resolve(off.del ? null : del);
    if (!force && del && Date.now() - delAt < 60000) return Promise.resolve(del);
    return rpc("my_account_deletion").then(function (r) {
      if (r.error) { if (missing(r.error)) off.del = true; return off.del ? null : del; }
      var d = data(r);
      if (d && d.v === 1) { del = d; delAt = Date.now(); paintRows(); }
      return del;
    });
  }
  function setDel(d) { if (d && d.v === 1) { del = d; delAt = Date.now(); paintRows(); } }
  function oldFlow() { if (A && A.closeSheet) A.closeSheet(); if (origShowDelete) origShowDelete(); }

  function openDelete() {
    if (!A || !A.openSheet) return;
    if (off.del) { if (origShowDelete) origShowDelete(); return; }
    var opened = false;
    var go = function () {
      if (opened) return; opened = true;
      if (off.del) { if (origShowDelete) origShowDelete(); return; }
      A.openSheet("Radera kontot", function (body) { fillDelete(body); }, { now: true });
    };
    if (del && Date.now() - delAt < 60000) { go(); return; }
    setTimeout(go, 2500);   // slow network: open with the last known state
    loadDel(true).then(go, go);
  }
  function fillDelete(body) {
    body.textContent = "";
    var box = h("div", { class: "mm-del" });
    body.appendChild(box);
    if (del && del.pending) {
      box.appendChild(h("div", { class: "mm-del-state", role: "status" }, [
        h("span", { class: "mm-del-ic", html: icon("clock") }),
        h("div", { class: "mm-del-st" }, [
          h("b", { text: "Kontot raderas " + daysTxt(del.days_left) }),
          h("small", { text: (del.due_at ? "Senast natten efter " + dayTxt(del.due_at) + ". " : "") + "Fram till dess funkar appen som vanligt." })
        ])
      ]));
      var undo = h("button", { type: "button", class: "btn btn-amber btn-block mm-del-undo", text: "Ångra – behåll kontot" });
      undo.addEventListener("click", function () { doCancel(undo, body); });
      box.appendChild(undo);
      box.appendChild(h("button", { type: "button", class: "mm-del-now", text: "Radera direkt istället", onclick: oldFlow }));
      return;
    }
    box.appendChild(h("p", { class: "mm-del-lead", text: "Vi raderar allt om dig om 7 dagar. Ångrar du dig innan dess räcker det med ett tryck på Ångra." }));
    box.appendChild(h("ul", { class: "mm-del-list" }, [
      "Namn, avatar och e-post",
      "Chatt, bilder, röstklipp och meddelanden",
      "Platser, notiser och Swish-nummer",
      "Du lämnar alla grupper. En grupp du skapat blir kvar för de andra."
    ].map(function (x) { return h("li", { text: x }); })));
    var step = h("div", { class: "mm-del-step" });
    var first = h("button", { type: "button", class: "btn btn-danger btn-block mm-del-go", text: "Radera kontot" });
    first.addEventListener("click", function () {
      step.textContent = "";
      step.appendChild(h("p", { class: "mm-del-q", role: "alert", text: "Säker? Om 7 dagar ä allt borta för gott." }));
      var no = h("button", { type: "button", class: "btn btn-ghost mm-del-no", text: "Avbryt" });
      var yes = h("button", { type: "button", class: "btn btn-danger mm-del-yes", text: "Ja, radera" });
      no.addEventListener("click", function () { fillDelete(body); });
      yes.addEventListener("click", function () { doRequest(yes, body); });
      step.appendChild(h("div", { class: "mm-del-two" }, [no, yes]));
      try { no.focus({ preventScroll: true }); } catch (e) {}   // focus the safe choice, never the destructive one
    });
    step.appendChild(first);
    box.appendChild(step);
    box.appendChild(h("button", { type: "button", class: "mm-del-now", text: "Radera direkt, utan ångertid", onclick: oldFlow }));
  }
  function doRequest(b, body) {
    if (b.disabled) return;
    b.disabled = true;
    rpc("request_account_deletion").then(function (r) {
      if (r.error) {
        b.disabled = false;
        if (missing(r.error)) { off.del = true; oldFlow(); return; }
        toast(code(r.error) === "slow_down" ? "Lugn, soldat. Vänta en stund och försök igen." : "Det gick int' att radera. Försök igen, eller mejla " + SUPPORT + ".", { err: true });
        return;
      }
      setDel(data(r));
      toast("Kontot raderas " + daysTxt(del && del.days_left) + ". Ångra under Inställningar → Konto.", { ms: 6000 });
      if (body && body.isConnected) fillDelete(body);
    });
  }
  function doCancel(b, body) {
    if (b && b.disabled) return;
    if (b) b.disabled = true;
    rpc("cancel_account_deletion").then(function (r) {
      if (r.error) {
        if (b) b.disabled = false;
        toast("Det gick int' att ångra. Försök igen, eller mejla " + SUPPORT + ".", { err: true });
        return;
      }
      setDel(data(r));
      toast("Skönt! Kontot ä kvar.", { ms: 4000 });
      if (body && body.isConnected) fillDelete(body);
    });
  }
  function deleteAccountRow() {
    var row = h("button", { type: "button", class: "ds-row mm-del-row", "data-mm": "del" });
    row.innerHTML = '<span class="ds-row-i mm-del-i">' + icon("trash") + '</span><span class="ds-row-t"><span class="mm-del-rt">Radera mitt konto</span><small class="mm-del-sub" hidden></small></span>';
    row.addEventListener("click", openDelete);
    rows.push(row); paintRows();
    if (!del) loadDel();
    return row;
  }
  function paintRows() {
    rows = rows.filter(function (r) { return r.isConnected || !r.__mmSeen; });
    rows.forEach(function (r) {
      r.__mmSeen = r.__mmSeen || r.isConnected;
      var s = r.querySelector(".mm-del-sub"); if (!s) return;
      var p = !!(del && del.pending);
      s.hidden = !p; s.textContent = p ? "Raderas " + daysTxt(del.days_left) + " · tryck för att ångra" : "";
      r.classList.toggle("mm-pending", p);
    });
  }
  // Once per app start in the 7 days: a reminder with Ångra (the person may have forgotten, or a friend did it).
  function remind() {
    if (!del || !del.pending || ss(TOAST_SS) === "1") return;
    ss(TOAST_SS, "1");
    toast("Ditt konto raderas " + daysTxt(del.days_left) + ".", { ms: 10000, cls: "mm-del-toast", action: { label: "Ångra", fn: function () { doCancel(null, null); } } });
  }

  /* ---------- ⭐ Grundare (0401) ---------- */
  function loadFounder() {
    if (founderP) return founderP;
    if (off.founder || !authed()) return Promise.resolve(founder);
    founderP = rpc("my_founder").then(function (r) {
      founderP = null;
      if (r.error) { if (missing(r.error)) off.founder = true; return founder; }
      var d = data(r);
      if (d && d.v === 1) { founder = d; paintBadges(); }
      return founder;
    });
    return founderP;
  }
  function isFounder() { return (founder ? Promise.resolve(founder) : loadFounder()).then(function (f) { return !!(f && f.founder); }); }
  function founderBadge(o) {
    var b = h("span", { class: "mm-founder", hidden: true, title: "Grundare: med från början. Premium för alltid." });
    b.innerHTML = icon("star") + '<span class="mm-founder-t">Grundare</span>';
    badges.push({ el: b, always: !!(o && o.always) });
    paintBadges();
    if (!founder) loadFounder();
    return b;
  }
  function paintBadges() {
    badges = badges.filter(function (x) { return x.el.isConnected || !x.seen; });
    badges.forEach(function (x) {
      x.seen = x.seen || x.el.isConnected;
      x.el.hidden = !(founder && founder.founder && (founder.final || x.always));
    });
  }

  /* ---------- 🚩 / 🚫 moderation hooks (X5) ---------- */
  function reportMenu(msg) {
    var S = window.SAFETY; if (!S || !S.actions || !msg) return false;
    var t = msg.voice_id ? { kind: "voice", ref: String(msg.voice_id), what: "röstklippet" }
      : msg.photo_id ? { kind: "photo", ref: String(msg.photo_id), what: "bilden" }
      : { kind: "msg", ref: String(msg.id), what: "meddelandet" };
    t.name = msg.name || "";
    S.actions(t);
    return true;
  }
  var ovEl = null;
  function closeOv() { if (ovEl && ovEl.parentNode) ovEl.parentNode.removeChild(ovEl); ovEl = null; }
  function blockFilmAuthor(photoId, done) {
    closeOv();
    var card = h("div", { class: "mm-card", role: "dialog", "aria-modal": "true", "aria-label": "Blockera" });
    ovEl = h("div", { class: "mm-ov" }, [card]);
    ovEl.addEventListener("click", function (e) { if (e.target === ovEl) closeOv(); });
    card.appendChild(h("h2", { class: "mm-card-t", text: "Blockera den som tog bilden?" }));
    card.appendChild(h("p", { class: "mm-card-p", text: "Ni ser int' varandra i gänget, chatten, Ikväll eller på kartan. Personen får int' veta det. Ångra under Inställningar → Integritet & synlighet → Blockerade." }));
    var yes = h("button", { type: "button", class: "btn btn-danger btn-block mm-block-yes", text: "Blockera" });
    var no = h("button", { type: "button", class: "btn btn-ghost btn-block mm-block-no", text: "Avbryt", onclick: closeOv });
    yes.addEventListener("click", function () {
      if (yes.disabled) return; yes.disabled = true;
      rpc("film_block", { p_photo_id: +photoId }).then(function (r) {
        if (r.error) {
          yes.disabled = false;
          var c = code(r.error);
          toast(missing(r.error) ? "Blockera finns int' på servern än." : c === "own_content" ? "Dä ä din egen bild, kompis." :
            c === "photo_not_found" ? "Bilden finns int' kvar." : "Det gick int' att blockera. Försök igen.", { err: true });
          return;
        }
        closeOv();
        var d = data(r) || {};
        toast("Blockerad" + (d.name ? ": " + d.name : "") + ". Ni ser int' varandra längre.", { ms: 4500 });
        try { if (done) done(d); } catch (e) {}
        if (A && A.refresh) setTimeout(function () { A.refresh(); }, 300);
      });
    });
    card.appendChild(h("div", { class: "mm-card-btns" }, [yes, no]));
    document.body.appendChild(ovEl);
    try { no.focus({ preventScroll: true }); } catch (e) {}   // the safe choice
  }
  function filmReportRow(id, done) { return { label: "Blockera den som tog bilden", cls: "btn-ghost mm-film-block", fn: function () { blockFilmAuthor(id, done); } }; }

  /* ---------- hooks through window.PRIVACY (v14.js) ---------- */
  function onAuthed() { loadDel().then(remind); }
  function hook() {
    var P = window.PRIVACY;
    if (!P) return false;
    if (P.__mm) return true;
    P.__mm = 1;
    var i0 = P.init, a0 = P.onAuthed;
    origShowDelete = P.showDelete;
    P.init = function (api) { A = api; return i0 ? i0.apply(this, arguments) : undefined; };
    P.onAuthed = function () { var r = a0 ? a0.apply(this, arguments) : undefined; setTimeout(onAuthed, 1200); return r; };
    P.showDelete = function () { openDelete(); };
    return true;
  }
  if (!hook()) document.addEventListener("DOMContentLoaded", hook);

  window.MISC = {
    deleteAccountRow: deleteAccountRow, openDelete: openDelete,
    deletionState: function () { return loadDel(true); },
    isFounder: isFounder, founderBadge: founderBadge,
    reportMenu: reportMenu, blockFilmAuthor: blockFilmAuthor, filmReportRow: filmReportRow,
    _api: function (api) { if (api) A = api; return A; }   // tests only
  };
})();
