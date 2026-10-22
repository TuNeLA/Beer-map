/* Öl Nu — 👋 DU KANSKE KÄNNER (social2; migration 0126 friend_suggest). Snapchat Quick Add / BeReal pattern.
   In the Vänner tab, under "Mina vänner": up to 8 people who share a group with one of your friends, or who are friends
   with your friends (ranked up when you were at the same bar the same night, with a mutual friend).
   Privacy (server): only a FIRST name + "N gemensamma vänner". Never a place, a bar, a time or an id.
   Row: initial · name · "2 gemensamma vänner" · [➕ Lägg till] [✕ Dölj]. ✕ hides that person for good.
   Hooks (app.js mods, after INVITE): init, groupsSheet. Missing RPC (old server) → the section never shows. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, cache = null, cacheAt = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  var SENT = ["📨 Förfrågan skickad till {n}. Nu väntar vi.", "📨 {n} har fått en vänförfrågan. Håll tummarna!", "📨 Skickat! {n} får svara när hen vill.",
    "📨 Rekryteringsbrev till {n} ä postat."];
  var SENT_EN = ["📨 Request sent to {n}.", "📨 {n} got your friend request."];
  function mutualText(n) { return n === 1 ? L("1 gemensam vän", "1 mutual friend") : L(n + " gemensamma vänner", n + " mutual friends"); }

  function load(force) {
    if (off || !A || !A.LIVE) return Promise.resolve(null);
    if (!force && cache && Date.now() - cacheAt < 60000) return Promise.resolve(cache);
    return A.rpc("friend_suggest").then(function (r) {
      if (r.error) { if (U.missing && U.missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data) || {};
      cache = Array.isArray(d.people) ? d.people : []; cacheAt = Date.now();
      return cache;
    });
  }
  function row(p, box) {
    var add = h("button", { type: "button", class: "btn btn-small btn-amber sg-add", text: L("➕ Lägg till", "➕ Add") });
    var hide = h("button", { type: "button", class: "btn btn-small sg-x", "aria-label": L("Dölj ", "Hide ") + (p.name || ""), text: "✕" });
    var li = h("li", { class: "sg-row" }, [
      h("span", { class: "sg-face", "aria-hidden": "true", text: (p.name || "?").charAt(0).toUpperCase() }),
      h("span", { class: "sg-main" }, [h("b", { text: p.name || "?" }), h("small", { class: "muted", text: p.group ? "👥 " + p.group + ((p.mutual | 0) ? " · " + mutualText(p.mutual | 0) : "") : mutualText(p.mutual | 0) })]),
      add, hide
    ]);
    add.addEventListener("click", function () {
      add.disabled = true; hide.disabled = true;
      A.rpc("friend_suggest_add", { p_k: p.k, p_name: A.getName ? A.getName() || null : null }).then(function (r) {
        if (r.error) {
          add.disabled = false; hide.disabled = false;
          var c = U.errCode ? U.errCode(r.error) : "";
          A.toast(c === "slow_down" ? L("Lugn i stormen. Vänta en stund.", "Easy. Wait a while.") : c === "invalid_target" ? L("Dä gick int' längre.", "Not possible any more.") : L("Kunde int' skicka. Försök igen.", "Could not send."), { err: true });
          if (c === "invalid_target") li.remove();
          return;
        }
        var d = A.parseData(r.data) || {};
        A.toast((sv() ? pick("sg", SENT) : pick("sge", SENT_EN)).replace("{n}", d.name || p.name || ""), { id: "sg" });
        add.textContent = L("⏳ Skickad", "⏳ Sent"); add.classList.remove("btn-amber");
        hide.remove();
        cache = (cache || []).filter(function (x) { return x.k !== p.k; });
      });
    });
    hide.addEventListener("click", function () {
      hide.disabled = true;
      A.rpc("friend_suggest_hide", { p_k: p.k }).then(function (r) {
        if (r.error) { hide.disabled = false; return; }
        cache = (cache || []).filter(function (x) { return x.k !== p.k; });
        li.classList.add("sg-gone");
        setTimeout(function () { li.remove(); if (!box.querySelector(".sg-row")) box.hidden = true; }, 220);
      });
    });
    return li;
  }
  function fill(box) {
    load(false).then(function (list) {
      if (!document.body.contains(box)) return;
      box.innerHTML = "";
      if (!list || !list.length) { box.hidden = true; return; }
      box.hidden = false;
      box.appendChild(h("h3", { class: "sg-h", text: L("👋 Du kanske känner", "👋 People you may know") }));
      var ul = h("ul", { class: "sg-list" });
      list.forEach(function (p) { ul.appendChild(row(p, box)); });
      box.appendChild(ul);
      box.appendChild(h("p", { class: "sg-note muted", text: L("🔒 Folk från dina grupper och kompisars kompisar. Bara förnamn – aldrig var nån ä.", "🔒 People from your groups and friends of friends. First names only – never where anyone is.") }));
    });
  }
  // The Vänner pane is built on the first tab tap (near.js). Put the box right after the friend list.
  function place(pane) {
    if (!pane || pane.querySelector(".sg-box")) return true;
    var list = pane.querySelector(".nr-flist");
    if (!list) return false;
    var box = h("div", { class: "sg-box", hidden: true });
    list.parentNode.insertBefore(box, list.nextSibling);
    fill(box);
    return true;
  }
  function groupsSheet() {
    if (off || !A || !A.LIVE) return;
    setTimeout(function () {
      var pane = document.getElementById("inv-pane-f");
      if (!pane || place(pane) || !window.MutationObserver) return;
      var mo = new MutationObserver(function () { if (!document.body.contains(pane) || place(pane)) mo.disconnect(); });
      mo.observe(pane, { childList: true, subtree: true });
    }, 0);
  }

  window.SUGGEST = {
    init: function (api) { A = api; },
    groupsSheet: function (body) { try { groupsSheet(body); } catch (e) {} },
    refresh: function () { return load(true); }
  };
})();
