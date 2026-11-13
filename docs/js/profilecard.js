/* PintsNow — small profile card (b1people I-12). One card for a person, wherever a person is shown in a group:
   big avatar / character, name, tonight's status + count (only when the caller knows it), buttons: friend, message, mute, block.
   Opened from: the "Gänget ikväll" strip on the group page (gpage.js) and the names in a group chat (social.js).
   PROFCARD.open({ g, name, k, is_me, live, n, back })   g = {id, name}; k = the member key of group_status_v3 (looked up when missing).
   The card is a small dialog above the sheet (no sheet navigation step): ✕, Esc and a tap outside close it.
   Missing server functions only hide the button that needs them. */
(function () {
  "use strict";
  var I = window.I18N, A = null, cur = null;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function ic(n, c) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n, c || "pi-lead") : ""; } catch (e) { return ""; } }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(m, o) { try { if (A && A.toast) A.toast(m, o); } catch (e) {} }
  function close() {
    if (!cur) return;
    var c = cur; cur = null;
    document.removeEventListener("keydown", c.key, true);
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    try { if (c.opener && c.opener.focus && document.body.contains(c.opener)) c.opener.focus(); } catch (e) {}
  }
  // The member key of a person in this group (group_status_v3 has it; a chat line only has the name).
  function keyOf(o) {
    if (o.k) return Promise.resolve(o.k);
    if (!A || !A.rpc || !o.g || !o.g.id) return Promise.resolve(null);
    return A.rpc("avatars_for", { p_group_id: o.g.id }).then(function (r) {
      var d = r && !r.error ? A.parseData(r.data) : null, hit = d && (d.people || []).filter(function (p) { return !p.is_me && p.name === o.name; })[0];
      if (hit && hit.k) o.k = hit.k;
      return o.k || null;
    }, function () { return null; });
  }
  function dmThread(name) {
    try { var l = window.DM && window.DM.list ? window.DM.list() : []; return l.filter(function (t) { return t && t.name === name; })[0] || null; } catch (e) { return null; }
  }
  function act(icon, label, fn, cls) {
    var b = h("button", { type: "button", class: "pc-act" + (cls ? " " + cls : "") }, [h("span", { class: "pc-act-i", "aria-hidden": "true", html: ic(icon, "") }), h("span", { class: "pc-act-t", text: label })]);
    b.addEventListener("click", fn);
    return b;
  }
  function open(o) {
    if (!o || !A) return false;
    close();
    var g = o.g || null, name = o.name || L("Någon", "Someone"), me = !!o.is_me, opener = document.activeElement;
    var av = h("span", { class: "av av-face pc-av" + (o.live ? " on" : ""), "aria-hidden": "true", "data-avk": me ? "me" : g && g.id ? "g|" + g.id + "|n|" + name : "", "data-avi": name.charAt(0).toUpperCase(), text: name.charAt(0).toUpperCase() });
    var status = null;
    if (o.live != null || o.n != null) {
      var n = Math.max(0, o.n | 0), parts = [];
      parts.push(o.live ? L("Ute nu", "Out now") : L("Inte ute nu", "Not out now"));
      if (o.n != null) parts.push(n ? n + " " + L(n === 1 ? "dryck ikväll" : "drycker ikväll", n === 1 ? "drink tonight" : "drinks tonight") : L("Inga drycker ikväll", "No drinks tonight"));
      status = h("p", { class: "pc-status" + (o.live ? " on" : ""), "data-live": o.live ? "1" : "0" }, [h("span", { class: "pc-dot", "aria-hidden": "true" }), h("span", { text: parts.join(" · ") })]);
    }
    var acts = h("div", { class: "pc-acts" });
    var card = h("div", { class: "pc-card", role: "dialog", "aria-modal": "true", "aria-label": name }, [
      h("button", { type: "button", class: "pc-x", "aria-label": L("Stäng", "Close"), html: ic("x", ""), onclick: close }),
      av, h("h2", { class: "pc-name", text: me ? name + " (" + L("du", "you") + ")" : name }), status, acts]);
    var ov = h("div", { class: "pc-ov" }, [card]);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    var key = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", key, true);
    document.body.appendChild(ov);
    cur = { el: ov, key: key, opener: opener };
    try { if (window.AVATAR && window.AVATAR.repaint) window.AVATAR.repaint(); } catch (e) {}
    // Uniform / medals (the old card of a name in a chat): one more button
    if (window.MEDALS && window.MEDALS.openMember && g && g.id) {
      acts.appendChild(act("medal", L("Uniform och medaljer", "Uniform and medals"), function () {
        close(); window.MEDALS.openMember(g, { name: name, is_me: me, k: o.k || null }, o.back || null);
      }, "pc-uni"));
    }
    if (!me && g && g.id && A.LIVE) {
      var friendSlot = h("div", { class: "pc-friend" });
      acts.insertBefore(friendSlot, acts.firstChild);
      keyOf(o).then(function (k) {
        if (cur && cur.el !== ov) return;
        if (!k) { friendSlot.remove(); if (blk) blk.disabled = true; return; }
        try { if (window.FRIENDS2 && window.FRIENDS2.statusRow) window.FRIENDS2.statusRow(g, { k: k, name: name }, friendSlot); } catch (e) {}
        if (dm) dm.disabled = false;
      });
      var dm = o.noMsg ? null : act("chat", L("Skriv", "Message"), function () {   // c3chat I-40: inside the DM itself there is no "Skriv"
        keyOf(o).then(function (k) { if (!k || !window.DM || !window.DM.openWith) return; close(); window.DM.openWith({ p_group_id: g.id, p_k: k }, name, null); });
      }, "pc-dm");
      if (dm) acts.appendChild(dm);
      var t = dmThread(name);
      if (t) {
        var mu = act(t.muted ? "bell-off" : "bell", L("Notiser", "Notifications"), function () {
          var on = mu.getAttribute("aria-pressed") !== "true";
          mu.disabled = true;
          A.rpc("dm_mute", { p_group_id: t.group_id, p_on: on }).then(function (r) {
            mu.disabled = false;
            if (r && r.error) { toast(L("Det gick inte. Försök igen.", "That failed. Try again."), { err: true }); return; }
            t.muted = on; mu.setAttribute("aria-pressed", String(on)); mu.classList.toggle("on", on);
            mu.querySelector(".pc-act-i").innerHTML = ic(on ? "bell-off" : "bell", "");
            toast(on ? L("Notiser av för ", "Notifications off for ") + name + "." : L("Notiser på för ", "Notifications on for ") + name + ".");
          });
        }, "pc-mute" + (t.muted ? " on" : ""));
        mu.setAttribute("aria-pressed", String(!!t.muted));
        mu.setAttribute("aria-label", L("Notiser från ", "Notifications from ") + name);
        acts.appendChild(mu);
      }
      var blk = act("block", L("Blockera", "Block"), function () {
        keyOf(o).then(function (k) {
          if (!window.SAFETY || !window.SAFETY.block) return;
          close(); window.SAFETY.block({ kind: "person", group: g.id, k: k, name: name });
        });
      }, "pc-block");
      acts.appendChild(blk);
    }
    try { card.querySelector(".pc-x").focus(); } catch (e) {}
    return true;
  }
  window.PROFCARD = {
    open: open, close: close, isOpen: function () { return !!cur; },
    init: function (api) { A = api; },
    onAuthed: function () {}
  };
  if (window.PN) PN.mod("PROFCARD");
})();
