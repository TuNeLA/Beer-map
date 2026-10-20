/* Öl Nu v26 — 🔗 LÄNKKORT (link previews; CONTRACT "v26 LÄNKKORT", migration 0060, edge function `card`).
   A shared link shows a card in WhatsApp / Messenger / iMessage: "TPM · 3 ute nu", "Inkallelse: Pitchers – 2 på väg",
   "Duell: TPM 28–19 Vänner". GitHub Pages is static, so the link goes to the edge function `card`
   (<SUPABASE_URL>/functions/v1/card?t=<kind>&id=<id>): crawlers get og: tags + a PNG, people get a 302 to the app.
   window.CARDS, called through app.js mods(): init. Used directly by app.js (invite, group code), duel.js (invite,
   score), rally.js (rally sheet) and gang.js (Morgontidningen) through small patches; every caller has a fallback
   to the plain app link, so a missing module or server = the old behaviour.
   - Sync kinds (no server call): invite, join (group code), duelinv (duel token).
   - Minted kinds (share_card RPC -> random 10-char token that expires): group, rally, duel, paper.
     prep() is called when a sheet renders, so the tap can share at once (iOS needs navigator.share inside the tap).
   OLNU_CONFIG.CARD_URL may override the card base URL (own domain + proxy later). No new floating buttons. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var off = false;                       // share_card missing on this server: minted kinds fall back
  var KEY = "olnu.cards", MAX = 40;
  var cache = null, inflight = {};

  function sv() { return !I || I.lang !== "en"; }
  var S = {
    sv: { rally: "📤 Dela inkallelsen", duel: "📤 Dela ställningen", wait: "Gör länken…", copied: "📋 Länken ä kopierad",
      rallyText: ["🪖 Inkallelse! Häng med:", "🪖 Alla man till pumparna:", "🪖 Uppställning, nu:"],
      duelText: ["⚔️ Duellen pågår:", "⚔️ Läget i duellen:", "⚔️ Så här ligger vi till:"],
      paperText: ["📰 Nattens tidning:", "📰 Morgontidningen ä här:"] },
    en: { rally: "📤 Share call-out", duel: "📤 Share the score", wait: "Making the link…", copied: "📋 Link copied",
      rallyText: ["🪖 Call-out! Join us:", "🪖 All hands on deck:"],
      duelText: ["⚔️ The duel is on:", "⚔️ Duel score:"],
      paperText: ["📰 Last night's paper:", "📰 The morning paper is out:"] }
  };
  function T(k) { var s = S[sv() ? "sv" : "en"]; return s[k] != null ? s[k] : S.sv[k]; }
  function one(k) { var l = T(k); return Array.isArray(l) ? l[Math.floor(Math.random() * l.length)] : l; }

  function base() {
    var c = window.OLNU_CONFIG || {};
    if (c.CARD_URL) return String(c.CARD_URL);
    return c.SUPABASE_URL ? String(c.SUPABASE_URL).replace(/\/+$/, "") + "/functions/v1/card" : "";
  }
  function clean(id, n) { return String(id || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n); }
  function url(kind, id) {
    var b = base(); if (!b) return "";
    return b + "?t=" + kind + (id ? "&id=" + encodeURIComponent(id) : "") + (sv() ? "" : "&l=en");
  }

  // ---- token cache (per viewer convenience; lost cache = one more share_card call) ----
  function load() {
    if (cache) return cache;
    cache = {};
    try { var o = U.ls.getJSON(KEY, {}); if (o && typeof o === "object") cache = o; } catch (e) { cache = {}; }
    return cache;
  }
  function save() {
    try {
      var c = load(), now = Date.now(), keys = Object.keys(c).filter(function (k) { return c[k] && c[k].e > now; });
      keys.sort(function (a, b) { return c[b].e - c[a].e; });
      var out = {}; keys.slice(0, MAX).forEach(function (k) { out[k] = c[k]; });
      cache = out; U.ls.setJSON(KEY, out);
    } catch (e) {}
  }
  function keyOf(kind, gid, ref) { return kind + ":" + gid + ":" + (ref == null ? "" : ref); }
  // Cached card URL for a minted kind, or "" (not made yet / expired / server without cards).
  function link(kind, gid, ref) {
    if (!gid) return "";
    var c = load()[keyOf(kind, gid, ref)];
    return c && c.t && c.e > Date.now() + 600000 ? url(kind, c.t) : "";
  }
  // Make (or reuse) the token. Resolves to the card URL or "".
  function prep(kind, gid, ref) {
    if (!A || !A.LIVE || off || !gid || !base()) return Promise.resolve("");
    var have = link(kind, gid, ref); if (have) return Promise.resolve(have);
    var k = keyOf(kind, gid, ref);
    if (inflight[k]) return inflight[k];
    var p = { p_kind: kind, p_group_id: gid };
    if (ref != null) p.p_ref = +ref;
    inflight[k] = A.rpc("share_card", p).then(function (r) {
      delete inflight[k];
      if (r.error) { if (U.missing && U.missing(r.error)) off = true; return ""; }
      var d = A.parseData(r.data), tok = clean(d.token, 10);
      if (tok.length !== 10) return "";
      var e = Date.parse(d.expires_at) || (Date.now() + 3600e3);
      load()[k] = { t: tok, e: e }; save();
      return url(kind, tok);
    }, function () { delete inflight[k]; return ""; });
    return inflight[k];
  }
  // Share sheet (inside the tap) or copy. Never throws.
  function share(text, link) {
    if (!link) return;
    try {
      if (navigator.share) { navigator.share({ title: "Öl Nu", text: text, url: link }).catch(function () {}); return; }
    } catch (e) {}
    if (A && A.copyText) A.copyText(text + " " + link);
  }
  // A small share button: the token is made when the button is drawn; the tap shares at once.
  function shareBtn(label, kind, gid, ref, textKey) {
    var b = A.btn(label, "btn-small btn-block cd-share", function () {
      var l = link(kind, gid, ref);
      if (l) { share(one(textKey), l); return; }
      b.disabled = true; b.textContent = T("wait");
      prep(kind, gid, ref).then(function (u) {
        b.disabled = false; b.textContent = label;
        if (u) { if (A.copyText) A.copyText(one(textKey) + " " + u); }
        else if (A.toast) A.toast(sv() ? "Kunde int’ göra länken. Försök igen." : "Could not make the link. Try again.", { err: true });
      });
    });
    prep(kind, gid, ref);
    return b;
  }

  window.CARDS = {
    on: function () { return !!base(); },
    init: function (api) { A = api; },
    url: url,
    prep: prep,
    link: link,
    inviteUrl: function () { return url("invite", ""); },
    joinUrl: function (code) { var c = clean(code, 6); return c.length === 6 ? url("join", c) : ""; },
    duelInvUrl: function (tok) { var c = clean(tok, 8); return c.length === 8 ? url("duelinv", c) : ""; },
    // text + card link when the token is ready, else the text alone (Morgontidningen shares the image anyway).
    withLink: function (kind, gid, text, ref) { var l = link(kind, gid, ref); return l ? text + " " + l : text; },
    // Rally sheet (rally.js fillDetail): one small button under the answers.
    rallyRow: function (body, c) {
      if (!A || !A.LIVE || off || !base() || !c || !c.rallies || !c.rallies.length) return;
      var r0 = c.rallies[0], gid = r0.group_id || c.group_id;
      if (!gid || !/^\d{1,18}$/.test(String(r0.id))) return;
      body.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [shareBtn(T("rally"), "rally", gid, String(r0.id), "rallyText")]));
    },
    // Duel card (duel.js card): live or finished duel.
    duelRow: function (d) {
      var holder = document.createElement("div");
      if (!A || !A.LIVE || off || !base() || !d || !d.group || !d.group.id || !/^\d{1,18}$/.test(String(d.id))) return holder;
      holder.className = "du-row cd-row";
      holder.appendChild(shareBtn(T("duel"), "duel", d.group.id, String(d.id), "duelText"));
      return holder;
    },
    paperText: function () { return one("paperText"); }
  };
})();
