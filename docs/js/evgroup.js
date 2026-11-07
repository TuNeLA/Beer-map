/* Öl Nu — 📨 EVENTGRUPPEN (CONTRACT "📨 EVENTGRUPPEN", migration 0166). Every user-made event (invite + its temp group, 0084)
   is a full temporary group for that night:
     · the event page (EVGROUP.open): when / where / who comes, a big 💬 Chatt (the event chat, as before), 📨 Inbjudan, and the
       group page "+" actions that fit one night: 🎉 Förfest (forfest.js, players = the people who come), 🎲 Partyspel
       (party.js; party_create/party_group/party_join accept the event's people), 💸 Kvällens nota + 🎲 Vem bjuder? (rundan.js;
       rnd_* accept the event's people). Only creator + ✅ + 🤔 may play / pay (= chat write access); invited people see a hint.
     · still NOT a group: no group_members row, so friend lists, duels, leagues, boards, crew, gang, skål … are unchanged.
     · after the night it is saved like a night out: "🗂️ Tidigare event" (Grupper fold + 👤 Profil) → the recap
       (EVGROUP.recap): who came, drinks, places, chat quotes, photos, and the same 📰 Morgontidningen as a group night
       (event_story = group_night_story json → GANG._storyModel / _drawStory).
   Ways in (no new map buttons): the "📨 Kvällens event" rows in Grupper and the invite sheet (evchat.js patches call
   EVGROUP.open), a "🎉 Eventgruppen" button in the event chat header, Tidigare event in Grupper / Profil.
   Hooks (app.js mods): init, groupsSheet, profileSheet. Public: open(c), openById(gid), recap(gid, back), pastBox(body, n).
   A missing RPC (old server) → the page falls back to the chat; the lists hide. Styles: evx.css (.evg-*). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = {}, past = null, pastAt = 0, lastPick = {};
  var TZ = "Europe/Stockholm";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(key, a) {
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function el(t, a, k) { return A.el(t, a, k); }
  function missing(e) { try { return U.missing ? U.missing(e) : /PGRST202/.test(JSON.stringify(e)); } catch (x) { return false; } }
  function call(name, p) {
    if (!A || off[name]) return Promise.resolve({ error: { message: "off" }, off: true });
    return A.rpc(name, p || {}).then(function (r) { if (r.error && missing(r.error)) { off[name] = true; r.off = true; } return r; });
  }
  function hm(iso) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } }
  function dayOf(iso) {
    try {
      var f = function (t) { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t - 5 * 3600e3)); };
      var t = Date.parse(iso), d = f(t), now = f(Date.now()), tm = f(Date.now() + 864e5), yd = f(Date.now() - 864e5);
      if (d === now) return L("ikväll", "tonight");
      if (d === tm) return L("i morgon", "tomorrow");
      if (d === yd) return L("igår", "yesterday");
      var wd = new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(t - 5 * 3600e3)).replace(".", "");
      return wd + " " + new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "numeric" }).format(new Date(t - 5 * 3600e3));
    } catch (e) { return ""; }
  }
  var KEMO = { quiz: "🧠", live: "🎸", dj: "🎧", karaoke: "🎤", sport: "⚽", standup: "🎭", party: "🎉" };

  var TX = {
    note: [["Eventgruppen ä tillfällig: den syns int' i vänlistor, dueller eller ligor. Efteråt sparas kvällen under 🗂️ Tidigare event.",
      "The event group is temporary: not in friend lists, duels or leagues. Afterwards the night is saved under 🗂️ Past events."]],
    playH: [["🎉 Förfest & spel", "🎉 Pre-party & games"], ["🎉 Uppladdning inför kvällen", "🎉 Warm-up before the night"],
      ["🎉 Laddar inför strid", "🎉 Gearing up"]],
    locked: [["Svara ✅ eller 🤔 i inbjudan så ä du mä på förfesten, spelen och notan.", "Answer ✅ or 🤔 in the invite to join the pre-party, games and tab."],
      ["Inte anmäld än, soldat. ✅ eller 🤔 – sen får du lira mä.", "Not signed up yet. ✅ or 🤔 – then you can play."]],
    over: [["🗄️ Kvällen ä över. Förfesten ä stängd – men minnena finns i tidningen.", "🗄️ The night is over. Pre-party closed – the memories are in the paper."],
      ["🗄️ Uppdraget avslutat. Läs rapporten i tidningen.", "🗄️ Mission complete. Read the report in the paper."]],
    pastEmpty: [["Inga tidigare event än. Skapa ett mä lång tryck på kartan!", "No past events yet. Create one with a long press on the map!"]],
    recapThin: [["Tunn kväll i arkivet – inte nog för en hel tidning. Här ä vad som finns.", "A thin night in the archive – not enough for a full paper. Here is what there is."],
      ["Lite krut i loggen. Ingen förstasida ikväll, men här ä fakta.", "Not much in the log. No front page, but here are the facts."]]
  };
  function tx(k) { var s = pick(k, TX[k]); return sv() ? s[0] : s[1]; }

  /* ---------- the event page ---------- */
  function chatObj(c, d) {
    var ch = null;
    try { ch = window.EVCHAT && window.EVCHAT.list ? window.EVCHAT.list().filter(function (x) { return String(x.group_id) === String(d.group_id); })[0] : null; } catch (e) {}
    return ch || c || { group_id: d.group_id, invite_id: d.invite_id, title: d.title, starts_at: d.starts_at, hide_at: d.hide_at, open_until: d.open_until,
      state: d.state, can_write: d.can_write, my_answer: d.my_answer, members: (d.people || []).length, invited: d.invited };
  }
  function openChat(c, d) {
    var x = chatObj(c, d);
    if (window.EVCHAT && window.EVCHAT.open) window.EVCHAT.open(x);
  }
  function openById(gid) { open({ group_id: gid }); }
  function open(c) {
    if (!A || !c || !c.group_id) return;
    if (off.event_group) { openChat(c, c); return; }
    A.openSheet((c.title || L("Eventet", "The event")), function (body) {
      var root = el("div", { class: "evg" }, [el("p", { class: "muted", text: "…" })]);
      body.appendChild(root);
      call("event_group", { p_group_id: c.group_id }).then(function (r) {
        if (!document.body.contains(root)) return;
        if (r.error) {
          if (r.off) { openChat(c, c); return; }
          root.innerHTML = ""; root.appendChild(el("p", { class: "muted", text: L("Hittade int' eventet. Det kanske ä borta.", "Could not find the event. It may be gone.") }));
          return;
        }
        page(root, c, A.parseData(r.data));
      });
    }, { now: true });
  }
  function page(root, c, d) {
    root.innerHTML = "";
    var people = d.people || [], yes = people.filter(function (p) { return p.answer === "yes" || p.creator; }).length,
      maybe = people.filter(function (p) { return p.answer === "maybe" && !p.creator; }).length;
    var st = d.state === "cancelled" ? L("🚫 Inställt", "🚫 Cancelled") : d.past ? L("🗄️ Över", "🗄️ Over") : d.state === "archived" ? L("🗄️ Arkiverad", "🗄️ Archived") : "";
    // head card
    root.appendChild(el("div", { class: "ds-card evg-head" }, [
      el("span", { class: "evg-ico", "aria-hidden": "true", text: KEMO[d.kind] || "📨" }),
      el("div", { class: "evg-ht" }, [
        el("b", { text: d.title }),
        el("small", { text: dayOf(d.starts_at) + " " + hm(d.starts_at) + (d.place ? " · " + d.place : "") + (st ? " · " + st : "") }),
        el("small", { class: "evg-cnt", text: "✅ " + yes + (maybe ? " · 🤔 " + maybe : "") + " · 📨 " + (d.invited | 0) })
      ])
    ]));
    // people
    if (people.length) {
      var pr = el("div", { class: "evg-people", "aria-label": L("Vilka kommer", "Who is coming") });
      people.forEach(function (p) {
        pr.appendChild(el("span", { class: "evg-p" + (p.is_me ? " me" : "") + (p.answer === "maybe" && !p.creator ? " maybe" : "") }, [
          el("i", { "aria-hidden": "true", text: (String(p.name || "?").trim().charAt(0) || "?").toUpperCase() }),
          el("span", { text: (p.is_me ? L("Du", "You") : p.name) + (p.creator ? " ⭐" : "") + (p.answer === "maybe" && !p.creator ? " 🤔" : "") + (p.out ? " 🍺" : "") })
        ]));
      });
      root.appendChild(pr);
    }
    // chat + recap
    var ch = chatObj(c, d), n = ch && ch.unread | 0;
    var chatBtn = el("button", { type: "button", class: "btn btn-block evg-chat" + (d.state === "open" && !d.past ? " btn-amber" : ""),
      html: U.esc(L("💬 Chatt", "💬 Chat")) + (n ? ' <span class="evc-badge">' + (n > 9 ? "9+" : n) + "</span>" : "") });
    chatBtn.addEventListener("click", function () { openChat(c, d); });
    if (d.past && d.state !== "cancelled") {
      var rb = el("button", { type: "button", class: "btn btn-block btn-amber evg-recap-btn", text: L("📰 Kvällens tidning", "📰 The night's paper") });
      rb.addEventListener("click", function () { recap(d.group_id, function () { open(c); }); });
      root.appendChild(rb);
    }
    root.appendChild(chatBtn);
    root.appendChild(el("div", { class: "row evg-small" }, [
      A.btn(L("📨 Inbjudan", "📨 Invite"), "btn-small", function () { try { window.INVITE.open(d.invite_id); } catch (e) {} })]));
    // + actions
    var sec = el("section", { class: "evg-play" });
    root.appendChild(sec);
    if (d.can_play) {
      sec.appendChild(el("h3", { class: "evg-h", text: tx("playH") }));
      var wrap = el("div", { class: "evg-tiles" });
      sec.appendChild(wrap);
      var g = { id: d.group_id, name: d.title, evg: true, member_count: people.length, active_count: people.filter(function (p) { return p.out; }).length };
      seedNames(d.group_id, people);
      ["FORFEST", "PARTY", "RUNDAN"].forEach(function (k) {
        try { var m = window[k]; if (m && m.groupItem) m.groupItem(g, wrap); } catch (e) { try { console.warn("evgroup " + k, e); } catch (x) {} }
      });
    } else if (d.state === "open" && !d.past) {
      sec.appendChild(el("p", { class: "evg-lock", text: tx("locked") }));
    } else {
      sec.appendChild(el("p", { class: "evg-lock", text: tx("over") }));
    }
    root.appendChild(el("p", { class: "muted evg-note", text: tx("note") }));
  }
  // 🎉 Förfest players = the people who come (forfest.js reads olnu.ffNames[gid]; group_status answers not_member for a temp group)
  function seedNames(gid, people) {
    try {
      var m = U.ls.getJSON("olnu.ffNames", {}) || {};
      m[gid] = people.map(function (p) { return String(p.name || "").slice(0, 24); }).filter(Boolean).slice(0, 40);
      U.ls.setJSON("olnu.ffNames", m);
    } catch (e) {}
  }

  /* ---------- 🗂️ Tidigare event ---------- */
  function loadPast(force) {
    if (!force && past && Date.now() - pastAt < 60000) return Promise.resolve(past);
    return call("my_past_events", { p_limit: 20 }).then(function (r) {
      if (r.error) return past || null;
      past = (A.parseData(r.data) || {}).events || []; pastAt = Date.now(); return past;
    });
  }
  function pastRow(e, back) {
    var li = el("li", { class: "evg-prow", role: "button", tabindex: "0", "aria-label": e.title }, [
      el("span", { class: "evg-pi", "aria-hidden": "true", text: KEMO[e.kind] || "🗂️" }),
      el("span", { class: "evg-pt" }, [el("b", { text: e.title }),
        el("small", { text: dayOf(e.starts_at) + " · 👥 " + (e.people | 0) + ((e.drinks | 0) ? " · 🍺 " + e.drinks : "") + ((e.photos | 0) ? " · 📷 " + e.photos : "") })]),
      el("span", { class: "ds-chev", "aria-hidden": "true" })
    ]);
    var go = function () { recap(e.group_id, back); };
    li.addEventListener("click", go);
    li.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
    return li;
  }
  function pastBox(body, max, back, folded) {
    var sec = el("section", { class: "evg-past", hidden: "" });
    body.appendChild(sec);
    loadPast(false).then(function (list) {
      if (!document.body.contains(sec) || !list || !list.length) return;
      sec.hidden = false;
      var ul = el("ul", { class: "evg-plist" });
      list.slice(0, max || 20).forEach(function (e) { ul.appendChild(pastRow(e, back)); });
      if (folded) {
        var det = el("details", { class: "evg-fold" }, [el("summary", { text: L("🗂️ Tidigare event", "🗂️ Past events") + " (" + list.length + ")" }), ul]);
        sec.appendChild(det);
      } else {
        sec.appendChild(el("h3", { text: L("🗂️ Tidigare event", "🗂️ Past events") }));
        sec.appendChild(ul);
        if (list.length > (max || 20)) sec.appendChild(el("div", { class: "row" }, [A.btn(L("Visa alla", "Show all"), "btn-small", function () { allPast(); })]));
      }
    });
    return sec;
  }
  function allPast() {
    A.openSheet(L("🗂️ Tidigare event", "🗂️ Past events"), function (body) {
      var sec = pastBox(body, 50, allPast, false);
      loadPast(false).then(function (l) { if (!l || !l.length) { sec.hidden = false; sec.appendChild(el("p", { class: "muted", text: tx("pastEmpty") })); } });
    }, { now: true });
  }

  /* ---------- 📰 the recap ---------- */
  function photoUrl(id) {
    return call("night_story_photo", { p_photo_id: +id }).then(function (r) {
      if (r.error) return null;
      var x = A.parseData(r.data), bin = atob(x.b64), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([a], { type: x.mime || "image/jpeg" }));
    }, function () { return null; });
  }
  function gangReady() {
    if (window.GANG_CONTENT || !window.OLNU_LAZY) return Promise.resolve();
    try { window.OLNU_LAZY_NOW(); } catch (e) {}
    return Promise.race([window.OLNU_LAZY, new Promise(function (r) { setTimeout(r, 4000); })]);
  }
  function recap(gid, back) {
    if (!A) return;
    A.openSheet(L("📰 Kvällens tidning", "📰 The night's paper"), function (body) {
      if (back) body.appendChild(el("button", { type: "button", class: "g-back", text: L("‹ Tillbaka", "‹ Back"), onclick: back }));
      var root = el("div", { class: "evg evg-recap" }, [el("p", { class: "muted", text: L("Trycker tidningen…", "Printing the paper…") })]);
      body.appendChild(root);
      call("event_story", { p_group_id: gid }).then(function (r) {
        if (!document.body.contains(root)) return;
        root.innerHTML = "";
        if (r.error) { root.appendChild(el("p", { class: "muted", text: L("Kunde int' hämta kvällen.", "Could not load the night.") })); return; }
        drawRecap(root, gid, A.parseData(r.data));
      });
    }, { now: true });
  }
  function drawRecap(root, gid, s) {
    var ev = s.event || {}, mem = s.members || [], dr = s.drinks || {}, chat = s.chat || {};
    root.appendChild(el("div", { class: "ds-card evg-head" }, [
      el("span", { class: "evg-ico", "aria-hidden": "true", text: KEMO[ev.kind] || "📰" }),
      el("div", { class: "evg-ht" }, [el("b", { text: ev.title || s.group_name }),
        el("small", { text: dayOf(ev.starts_at) + " " + hm(ev.starts_at) + (ev.place ? " · " + ev.place : "") })])
    ]));
    var bars = {}; (s.arrivals || []).forEach(function (a) { bars[a.bar_id || a.bar] = 1; });
    var grid = el("div", { class: "nl-grid evg-grid" });
    [[String(mem.length), L("kom", "came")], [String(dr.total | 0), L("drycker", "drinks")], [String(Object.keys(bars).length), L("ställen", "places")],
      [String(s.photos_n | 0), L("bilder", "photos")]].forEach(function (x) { grid.appendChild(el("div", { class: "nl-stat" }, [el("b", { text: x[0] }), el("span", { text: x[1] })])); });
    root.appendChild(grid);
    // the paper (same drawing as the group's Morgontidningen)
    var paper = el("div", { class: "evg-paper" });
    root.appendChild(paper);
    var G = window.GANG;
    if (s.ready && G && G._storyModel && G._drawStory && G._paperModel) {
      paper.appendChild(el("p", { class: "muted", text: L("Trycker förstasidan…", "Printing the front page…") }));
      gangReady().then(function () {
        var g = { id: gid, name: ev.title || s.group_name };
        var base = { night: s.night, town: s.town, group_name: ev.title || s.group_name, members: [] };
        var sm = null;
        try { var pm = G._paperModel(base, g); sm = G._storyModel(s, base, g, pm); } catch (e) { sm = null; }
        if (!sm) { paper.innerHTML = ""; paper.appendChild(el("p", { class: "muted", text: tx("recapThin") })); return; }
        return G._drawStory(sm).then(function (cv) {
          if (!document.body.contains(paper)) return;
          paper.innerHTML = "";
          paper.appendChild(el("img", { class: "evg-pimg", alt: sm.alt || sm.big, src: cv.toDataURL("image/png") }));
          var row = el("div", { class: "row", style: "flex-wrap:wrap;margin-top:8px" });
          if (navigator.share && navigator.canShare) row.appendChild(A.btn(L("📤 Dela", "📤 Share"), "btn-amber btn-small", function () { share(cv, sm.big); }));
          row.appendChild(A.btn(L("💾 Spara", "💾 Save"), "btn-small", function () { save(cv); }));
          paper.appendChild(row);
        });
      }).catch(function () { paper.innerHTML = ""; });
    } else {
      paper.appendChild(el("p", { class: "muted", text: tx("recapThin") }));
    }
    // who came
    if (mem.length) {
      root.appendChild(el("h3", { class: "evg-h", text: L("👥 Vilka kom", "👥 Who came") }));
      var ul = el("ul", { class: "evg-who" });
      mem.slice().sort(function (a, b) { return (b.drinks | 0) - (a.drinks | 0); }).forEach(function (m) {
        ul.appendChild(el("li", {}, [el("span", { text: (m.is_me ? L("Du", "You") : m.name) + (m.creator ? " ⭐" : "") }),
          el("small", { text: ((m.drinks | 0) ? "🍺 " + m.drinks : L("ingen dryck loggad", "no drinks logged")) + ((m.bars | 0) ? " · 📍 " + m.bars : "") +
            (m.first_at ? " · " + L("första ", "first ") + hm(m.first_at) : "") + (m.home_at ? " · 🏠 " + hm(m.home_at) : "") })]));
      });
      root.appendChild(ul);
    }
    // chat highlights
    var top = (chat.top || []).filter(function (q) { return q.body && q.body.length <= 140; }).slice(0, 3);
    if (top.length) {
      root.appendChild(el("h3", { class: "evg-h", text: L("💬 Snackisar", "💬 Chat highlights") }));
      top.forEach(function (q) {
        root.appendChild(el("blockquote", { class: "evg-q" }, [el("p", { text: "”" + q.body + "”" }),
          el("small", { text: "– " + q.name + " " + hm(q.at) + ((q.reacts | 0) ? " · " + (q.emoji || "❤️") + " " + q.reacts : "") })]));
      });
    }
    // photos
    var ph = s.photos || [];
    if (ph.length) {
      root.appendChild(el("h3", { class: "evg-h", text: L("📷 Bilder", "📷 Photos") }));
      var strip = el("div", { class: "evg-photos" });
      root.appendChild(strip);
      ph.forEach(function (p) {
        var fig = el("figure", { class: "evg-ph" }, [el("figcaption", { text: p.by + " " + hm(p.at) })]);
        strip.appendChild(fig);
        photoUrl(p.id).then(function (u) {
          if (!u) { fig.remove(); return; }
          fig.insertBefore(el("img", { src: u, alt: L("Bild från ", "Photo by ") + p.by, loading: "lazy" }), fig.firstChild);
        });
      });
    }
  }
  function blob(cv) { return new Promise(function (r) { if (cv.toBlob) cv.toBlob(function (b) { r(b); }, "image/png"); else r(null); }); }
  function share(cv, text) {
    blob(cv).then(function (b) {
      if (!b) { save(cv); return; }
      var f = new File([b], "kvallsposten-event.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f], text: text }).catch(function () {});
      else save(cv);
    });
  }
  function save(cv) {
    blob(cv).then(function (b) {
      var a = document.createElement("a"); a.download = "kvallsposten-event.png"; a.href = b ? URL.createObjectURL(b) : cv.toDataURL("image/png");
      document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 2000);
    });
  }

  window.EVGROUP = {
    open: open, openById: openById, recap: recap, pastBox: pastBox, allPast: allPast, _loadPast: loadPast,
    init: function (api) { A = api; },
    onAuthed: function () { loadPast(true); },
    groupsSheet: function (body) {
      if (!A || !A.LIVE || off.my_past_events) return;
      pastBox(body, 20, function () { A.showGroups(); }, true);
    },
    profileSheet: function (body) {
      if (!A || !A.LIVE || off.my_past_events) return;
      pastBox(body, 5, null, false);
    }
  };
})();
