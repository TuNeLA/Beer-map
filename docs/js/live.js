/* PintsNow — ⚡ LIVE CHAT (lane s1speed, server 0507). Owner 12 Nov: "a DM takes a couple of seconds to reach them - make it quicker".
   Before: the other phone saw a new line only at its next chat tick (social.js: 7 s, then 15 s, then 30 s when quiet).
   Now (flag ON): while a chat is open and on screen, this module joins ONE private Supabase Realtime Broadcast channel
   'pnc:<group id>'. The server (0507 trigger) sends a tiny nudge {i: <msg id>} when a line is saved, and {s: 1} when the
   other person has seen a DM. No text, no name over the socket: on 'm' the chat reads itself with its normal group_msgs
   call (ctx.reload = social.js tick now), on 's' dm.js asks dm_seen once. Polling stays as the fallback: no socket,
   a failed join or an old server = the app works exactly as before.
   Sender: the line shows at once as a "Skickar…" bubble, "✓" when the server saved it; the real row replaces it.
   Flag: OLNU_CONFIG.dmLive or window.PN_CFG.dmLive: true = DM chats, "all" = every chat (group + event chats too).
   Test phone: localStorage "olnu.dmLive" = "1" / "all". Default OFF.
   Budget: 0 extra requests per tick. +1 group_msgs read per incoming line (it shows at once), dm_seen 4 s → 30 s while the
   socket is up (plus one per 's' nudge). The socket closes 20 s after the app is hidden and when the chat closes.
   Public (no new window global: PN.chatLive): .chat(g, ctx) (social.js openChat hook: ctx = {list, input, alive, reload}), .up(gid), .onSeen(gid, fn),
   .enabled(g). Test seam: PN.chatLive._transport = function (gid, on) -> { leave() } (on.msg(payload), on.seen(), on.state(s)). */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  var HIDE_MS = 20000, RETRY_MS = 1500, MAX_FAIL = 3, BAD_KEY = "olnu.liveBad", BAD_MS = 10 * 60e3;
  var rooms = {};   // gid -> { gid, h (transport handle), up, fails, subs: [chat], seen: [fn], hideT }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function flag() {
    var c = window.PN_CFG || {}, o = window.OLNU_CONFIG || {};
    var v = c.dmLive != null ? c.dmLive : o.dmLive != null ? o.dmLive : lsGet("olnu.dmLive");
    if (v === "1" || v === 1) return true;
    if (v === "0" || v === 0 || v === "false") return false;
    return v === "all" ? "all" : !!v;
  }
  function enabled(g) {
    var f = flag(); if (!f || !g || !g.id) return false;
    if (+(ssGet(BAD_KEY) || 0) > Date.now()) return false;   // the server said no (no 0507 yet): poll only, try again in 10 min
    return !!g.dm || f === "all";
  }
  function client() { try { return window.PN && window.PN.s && window.PN.s.client || null; } catch (e) { return null; } }

  /* ---------- transport: Supabase Realtime private broadcast ---------- */
  function sbTransport(gid, on) {
    var c = client(), ch = null, gone = false;
    if (!c || !c.channel || !c.realtime) { setTimeout(function () { on.state("off"); }, 0); return { leave: function () {} }; }
    Promise.resolve(c.auth && c.auth.getSession ? c.auth.getSession() : null).then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      if (gone) return;
      if (!tok) { on.state("off"); return; }
      try { c.realtime.setAuth(tok); } catch (e) {}
      ch = c.channel("pnc:" + gid, { config: { private: true } });
      ch.on("broadcast", { event: "m" }, function (m) { on.msg(m && m.payload || {}); })
        .on("broadcast", { event: "s" }, function () { on.seen(); })
        .subscribe(function (s, err) { if (!gone) on.state(s === "SUBSCRIBED" ? "up" : s === "CLOSED" ? "closed" : "err", err); });
    }).catch(function () { on.state("err"); });
    return { leave: function () { gone = true; if (ch) { try { c.removeChannel(ch); } catch (e) {} ch = null; } } };
  }
  function transport() { return typeof CL._transport === "function" ? CL._transport : sbTransport; }

  function join(r) {
    if (r.h) return;
    r.h = transport()(r.gid, {
      msg: function (p) { r.subs.forEach(function (s) { s.nudge(p); }); },
      seen: function () { r.seen.slice().forEach(function (f) { try { f(); } catch (e) {} }); },
      state: function (s, err) {
        var was = r.up;
        r.up = s === "up";
        if (r.up) { r.fails = 0; if (r.ever) r.subs.forEach(function (x) { x.catchUp(); }); r.ever = true; return; }   // a re-join: lines that came while the socket was down
        if (s === "closed" || !was && s !== "err") return;
        if (s === "off" || ++r.fails >= MAX_FAIL || /unauthor|denied|forbidden/i.test(String(err && err.message || err || ""))) {
          if (s !== "off") ssSet(BAD_KEY, String(Date.now() + BAD_MS));
          leave(r); r.dead = true;   // polling only for this chat
        }
      }
    });
  }
  function leave(r) { if (r.h) { try { r.h.leave(); } catch (e) {} r.h = null; } r.up = false; }
  function drop(r) { leave(r); clearTimeout(r.hideT); if (rooms[r.gid] === r) delete rooms[r.gid]; }
  document.addEventListener("visibilitychange", function () {
    Object.keys(rooms).forEach(function (k) {
      var r = rooms[k];
      if (document.hidden) { clearTimeout(r.hideT); r.hideT = setTimeout(function () { leave(r); }, HIDE_MS); }   // iOS kills it anyway; save battery
      else { clearTimeout(r.hideT); if (!r.h && !r.dead) join(r); }   // social.js ticks at once on return (catch-up)
    });
  });

  /* ---------- the sender: the bubble shows at once ---------- */
  function clean(v) { return String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim(); }
  function sv() { var I = window.I18N; return !(I && I.lang === "en"); }
  function optimistic(ctx, sub) {
    var box = ctx.input, list = ctx.list;
    var inp = box && box.querySelector("input.chat-inp, input"), btn = box && box.querySelector(".chat-send, button.btn-amber");
    if (!inp || !btn || !list) return;
    var pend = [];
    function mk(text) {
      var li = document.createElement("li"), b = document.createElement("div"), s = document.createElement("span");
      li.className = "chat-msg me pn-pend"; li.setAttribute("aria-busy", "true");
      b.className = "pn-pend-b"; b.textContent = text;
      s.className = "pn-pend-s"; s.textContent = sv() ? "Skickar…" : "Sending…";
      li.appendChild(b); li.appendChild(s);
      return { li: li, s: s, text: text, st: "send", at: Date.now() };
    }
    function rm(p) { var i = pend.indexOf(p); if (i >= 0) pend.splice(i, 1); if (p.li.parentNode) p.li.remove(); }
    function start() {
      if (btn.disabled) return;
      var text = clean(inp.value);
      if (!text || text.length > 140 || pend.some(function (p) { return p.text === text && p.st === "send"; })) return;
      var p = mk(text), near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      pend.push(p); list.appendChild(p.li);
      if (near) list.scrollTop = list.scrollHeight;
      setTimeout(function () { if (p.st === "send" && !btn.disabled) rm(p); }, 60);   // social.js did not start a send
      setTimeout(function () { rm(p); }, 20000);   // never stuck: the poll draws the real row anyway
    }
    box.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".chat-send, button.btn-amber") === btn) start(); }, true);
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target === inp) start(); }, true);
    new MutationObserver(function () {
      if (btn.disabled) return;
      pend.forEach(function (p) {
        if (p.st !== "send") return;
        if (clean(inp.value) === p.text) { rm(p); return; }   // failed or "Int' nu": the text is still in the box (social.js toasts)
        p.st = "ok"; p.s.textContent = "✓"; p.li.removeAttribute("aria-busy"); sub.sentAt = Date.now();
      });
    }).observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        [].forEach.call(m.addedNodes, function (n) {
          if (!n.classList || !n.classList.contains("me") || !n.hasAttribute("data-mid")) return;
          var b = n.querySelector(".cm-body"), t = b ? b.textContent : null;
          var p = pend.filter(function (x) { return x.text === t; })[0];
          if (p) rm(p);
        });
      });
    }).observe(list, { childList: true });
    sub.sending = function () { return pend.some(function (p) { return p.st === "send"; }) || Date.now() - (sub.sentAt || 0) < 1500; };
  }

  /* ---------- one open chat ---------- */
  function chat(g, ctx) {
    if (!enabled(g) || !ctx || !ctx.list || typeof ctx.alive !== "function") return null;
    var gid = String(g.id).toLowerCase();
    var r = rooms[gid] || (rooms[gid] = { gid: gid, h: null, up: false, fails: 0, subs: [], seen: [], hideT: 0 });
    r.dead = false;
    var rt = 0, tries = 0, waitId = 0;
    var sub = {
      nudge: function (p) {
        var id = +(p && p.i) || 0;
        if (sub.sending()) return;   // my own line: social.js post() reads it already
        if (id && ctx.list.querySelector('li[data-mid="' + id + '"]')) return;
        waitId = Math.max(waitId, id); tries = 0; go();
      },
      catchUp: function () { waitId = 0; go(); }
    };
    function go() {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (!ctx.alive()) return;
        try { if (ctx.reload) ctx.reload(); } catch (e) {}
        // the tick may have been busy (social.js load() skips while one is in flight): look again, at most twice
        if (waitId && tries++ < 2) rt = setTimeout(function () { if (ctx.alive() && !ctx.list.querySelector('li[data-mid="' + waitId + '"]')) go(); }, RETRY_MS);
      }, 40);
    }
    try { optimistic(ctx, sub); } catch (e) {}
    r.subs.push(sub);
    if (!r.h && !document.hidden) join(r);
    var watch = setInterval(function () {
      if (ctx.alive()) return;
      clearInterval(watch); clearTimeout(rt);
      r.subs = r.subs.filter(function (s) { return s !== sub; });
      if (!r.subs.length) drop(r);
    }, 2000);
    return sub;
  }

  var st = document.createElement("style");
  st.textContent = ".chat-list .pn-pend{opacity:.72}.chat-list .pn-pend .pn-pend-b{white-space:pre-wrap;word-break:break-word}" +
    ".chat-list .pn-pend .pn-pend-s{display:block;text-align:right;font-size:var(--fs-12,12px);opacity:.8}";
  (document.head || document.documentElement).appendChild(st);

  var CL = PN.chatLive = {
    chat: function (g, ctx) { try { return chat(g, ctx); } catch (e) { return null; } },
    up: function (gid) { var r = rooms[String(gid || "").toLowerCase()]; return !!(r && r.up); },
    onSeen: function (gid, fn) {
      var r = rooms[String(gid || "").toLowerCase()]; if (!r || typeof fn !== "function") return function () {};
      r.seen.push(fn);
      return function () { r.seen = r.seen.filter(function (f) { return f !== fn; }); };
    },
    enabled: enabled, _rooms: function () { return rooms; }, _transport: null
  };
})();
