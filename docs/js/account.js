/* Öl Nu — 🔐 SPARA KONTOT + 🔑 TAPPAT DITT KONTO? (CONTRACT "KONTO"; migrations 0130 account_config, 0131 account_merge).
   Why: every user is a Supabase ANONYMOUS user; the session lives only in localStorage "olnu.auth". iPhone: the home-screen
   app and Safari have separate storage; in-app browsers (Messenger, Snapchat, Instagram) too; a cleared browser = gone.
   E-mail + 6-digit code only. NEVER a password (owner rule). Codes are typed in the app (no magic link), so it works inside
   the home-screen app and in-app browsers.
   ONE field for e-mail, the flow finds out itself (no separate "sign up" / "log in"):
     · this device has an unsaved account → updateUser({ email }) → verifyOtp(type "email_change"): the SAME user id becomes
       permanent, nothing moves. If the e-mail already has a saved account → it switches to logging in to that one.
     · login (fresh home-screen app, new phone, "🔑 Tappat ditt konto?") → signInWithOtp({ shouldCreateUser: false }) →
       verifyOtp(type "email") → that account on this device, then a clean reload (like a flytt import).
       No saved account on that e-mail → a soft message + "Spara det här kontot mä e-posten istället" (or, with no account
       at all on the device, "Starta ett nytt konto": signInAnonymously → save with that e-mail).
     · the device's unsaved account has groups → "Vilket konto vill du ha kvar?" (default: the saved one) + "Ta mä grupperna"
       (0131: account_merge_ticket() as the old anonymous user BEFORE the code, account_merge_claim() after it).
     · ⚙️ saved: "Inloggad som a•••@gmail.com" · ✉️ Byt e-post (secure change: a code to the new AND the old address) ·
       🚪 Logga ut (warns hard if not saved; signOut scope local; then a fresh start).
   Code step: masked e-mail, "📬 Öppna Gmail/Outlook/Mail" (googlegmail:// · ms-outlook:// · message:// on iOS, intents on
   Android; never in in-app browsers), ONE real <input autocomplete="one-time-code" inputmode="numeric"> drawn as 6 boxes
   (paste / iOS autofill / typing all fill it; auto-submit on the 6th digit), "Skicka ny kod" with a 60 s cooldown,
   "Fel e-post? Ändra". A pending code survives a reload / the app being killed while the user is in the mail app
   (olnu.acct.pend, 20 min). Success moment: "✅ Kontot ä sparat".
   Google (optional, hidden): only when account_config().google AND /auth/v1/settings says google is on; never in in-app
   browsers or the iOS home-screen app. linkIdentity (save) / signInWithOAuth (login); the implicit-flow return hash is
   turned into a ?flytt= import before app.js boots (this file runs first).
   Nudge: one sheet, once ever, at a high-value moment (3rd night in olnu.nights, or in a group), never at first launch,
   never over a sheet / intro / the beer-type strip.
   Hidden until account_config().email is true (needs custom SMTP). OLNU_CONFIG.ACCOUNT_EMAIL / ACCOUNT_GOOGLE force on.
   Public: ACCOUNT.entry(container, where, opts) · on() · saved() · openSave() · openLogin() · openChange() · logout().
   Hooks: init, onAuthed, onPoll, groupItem, settingsSheet. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, A = null;
  var CFG = window.OLNU_CONFIG || {};
  var LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var AUTH_KEY = "olnu.auth", CFG_KEY = "olnu.acct.cfg", NUDGE_KEY = "olnu.acct.nudged", GROUP_KEY = "olnu.acct.grp", PEND_KEY = "olnu.acct.pend";
  var CFG_TTL = 3 * 3600e3, TIMEOUT = 15000, RESEND_S = 60, PEND_MS = 20 * 60e3, CODE_LEN = 6, EXPIRED_AFTER = 15 * 60e3;
  function sv() { return !I || I.lang !== "en"; }
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function b64urlEnc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function jwtClaims(tok) {
    try { var p = String(tok).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(decodeURIComponent(escape(atob(p)))); } catch (e) { return null; }
  }
  function ua() { return navigator.userAgent || ""; }
  function inApp() { var u = ua(); return /FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|Messenger|TikTok|musical_ly|LinkedInApp|Twitter|BytedanceWebview/i.test(u) || (/Android/i.test(u) && /; wv\)/.test(u)); }
  function isIOS() { return U && U.isIOS ? U.isIOS() : /iPhone|iPad|iPod/.test(ua()); }
  function standalone() { return U && U.isStandalone ? U.isStandalone() : false; }
  function appUrl() { return location.origin + location.pathname; }

  /* ---------- Google return (runs at eval, before app.js reads ?flytt=) ---------- */
  var oauthErr = null;
  (function () {
    try {
      var h = String(location.hash || "");
      if (!/(^#|&)(refresh_token|error_description|error_code)=/.test(h)) return;
      var q = new URLSearchParams(h.slice(1)), clean = location.pathname + location.search;
      if (q.get("refresh_token")) {
        var c = jwtClaims(q.get("access_token")) || {}, md = c.user_metadata || {};
        var p = { v: 1, rt: q.get("refresh_token"), u: c.sub || null, name: md.olnu_name || null, ls: {} };
        var ps = new URLSearchParams(location.search); ps.set("flytt", b64urlEnc(JSON.stringify(p)));
        clean = location.pathname + "?" + ps.toString();
        try { sessionStorage.setItem("olnu.acct.oauth", "1"); } catch (e) {}
      } else oauthErr = { code: q.get("error_code") || q.get("error") || "", msg: q.get("error_description") || "" };
      history.replaceState(null, "", clean);
    } catch (e) {}
  })();

  /* ---------- texts (sv dalmål + spec-ops; en fallback) ---------- */
  var TX = {
    sv: {
      sect: "🔐 Ditt konto",
      saveBtn: "🔐 Spara ditt konto",
      saveWhy: ["Just nu bor kontot bara i den här webbläsaren. Rensar du den, byter lur eller öppnar hemskärmsappen ä allt borta. Spara mä e-post så hittar du alltid tillbaka.",
        "Kontot sitter bara fast i den här webbläsaren. Koppla en e-post så kan du logga in igen var som helst – grupper, medaljer å historik följer mä."],
      lostBtn: "🔑 Tappat ditt konto? Logga in mä e-post",
      signedAs: "Inloggad som {0}",
      signedHelp: "Samma e-post i hemskärmsappen eller på en ny lur = samma konto. Ingen kod behövs här igen.",
      changeBtn: "✉️ Byt e-post",
      logoutBtn: "🚪 Logga ut",
      entryHave: "Har du redan ett konto? Logga in mä e-post",
      entryLost: "🔑 Tappat ditt konto? Logga in mä e-post",
      googleSave: "G  Fortsätt mä Google",
      googleLogin: "G  Logga in mä Google",
      saveTitle: "🔐 Spara kontot",
      loginTitle: "🔑 Logga in",
      changeTitle: "✉️ Byt e-post",
      email: "Din e-post",
      emailNew: "Ny e-post",
      emailPh: "namn@exempel.se",
      sendCode: "📨 Skicka kod",
      sending: "Skickar…",
      oneField: "En kod till mejlen – inga lösenord, inga länkar. Har e-posten redan ett konto loggar du in på det.",
      loginWhy: "Skriv e-posten du sparade kontot mä. Du får en kod – inga lösenord, inga länkar att klicka.",
      codeSent: "Vi har skickat en kod till {0}. Skriv in koden här.",
      codeSentNew: "Steg 1 av 2: koden som kom till den NYA adressen {0}.",
      codeSentOld: "Steg 2 av 2: nu koden som kom till din gamla adress {0}.",
      codeSpam: "Syns int mejlet? Kolla skräpposten.",
      code: "Koden från mejlet",
      checking: "Kollar…",
      verify: "✅ Klart",
      resend: "Skicka ny kod",
      resendIn: "Ny kod om {0} s",
      changeEmail: "Fel e-post? Ändra",
      back: "← Tillbaka",
      openMail: "📬 Öppna {0}",
      privacy: "Vi sparar bara e-posten för inloggning. Inga utskick, ingen reklam. Den syns int för nån annan.",
      loginReplace: "⚠️ Kontot på den här enheten ä int sparat. Loggar du in på ett annat lämnar du det här.",
      choiceTitle: "Vilket konto vill du ha kvar?",
      choiceText: "{0} har ett sparat konto. Den här telefonen har också ett osparat konto mä {1}.",
      choiceSaved: "🔑 Mitt sparade konto (rekommenderas)",
      choiceThis: "📱 Behåll det här kontot istället",
      merge: "Ta mä grupperna hit: {0}",
      mergeOk: " {0} grupp(er) följde mä.",
      mergeFail: " Grupperna gick int att flytta – gå mä igen mä koden.",
      okSavedH: "✅ Kontot ä sparat",
      okSavedP: ["Samma konto, nu kopplat till {0}. Logga in mä den i hemskärmsappen eller på en ny lur – då ä du här direkt.",
        "Basen ä säkrad, soldat. {0} ä din nyckel – på vilken lur som helst."],
      okChangedH: "✅ E-posten ä bytt",
      okChangedP: "Nu loggar du in mä {0}.",
      okBtn: "Klart",
      okLogin: ["🔑 Välkommen tillbaka{0}! Kontot ä på plats.", "🔑 Inloggad{0}. Truppen ä samlad igen.", "🔑 Där ä du ju{0}! Allt ä kvar."],
      eExists: "Den e-posten hör redan till ett Öl Nu-konto. Vi skickar en kod så du kan logga in på det.",
      eRate: "För många försök på kort tid. Vänta {0} å försök igen.",
      eRateNoS: "en stund",
      eWrong: "Fel kod – kolla siffrorna i mejlet å försök igen.",
      eExpired: "Koden har gått ut. Tryck Skicka ny kod.",
      eNoUser: "Vi hittade inget sparat konto på {0}. Kolla stavningen – eller spara det här kontot mä den.",
      eNoUserNew: "Vi hittade inget sparat konto på {0}. Kolla stavningen – eller starta ett nytt konto mä den.",
      saveInstead: "🔐 Spara det här kontot mä {0} istället",
      startNew: "🔐 Starta ett nytt konto mä {0}",
      eBadEmail: "Det där ser int ut som en e-post.",
      eSameEmail: "Det ä ju redan din e-post.",
      eOff: "Inloggning mä e-post ä int påslagen än.",
      eNet: "Ingen kontakt mä servern. Kolla nätet å försök igen.",
      eNoSession: "Vänta tills appen har loggat in, å försök igen.",
      eFail: "Nåt gick snett. Försök igen om en stund.",
      eGoogleTaken: "Det Google-kontot hör redan till ett annat Öl Nu-konto. Logga in mä Google istället?",
      eGoogle: "Google-inloggningen blev int av. Försök igen, eller använd e-post.",
      googleOk: "✅ Google ä kopplat. Kontot ä sparat!",
      logoutTitle: "🚪 Logga ut",
      logoutSaved: "Du loggas ut på den här enheten. Logga in igen när du vill mä {0}.",
      logoutUnsaved: "⚠️ Kontot ä INT sparat. Loggar du ut ä grupper, medaljer å historik borta för alltid – ingen kan få tillbaka dem.",
      logoutGo: "🚪 Logga ut",
      logoutAnyway: "Logga ut ändå",
      logoutSaveFirst: "🔐 Spara kontot först",
      cancel: "Avbryt",
      nudgeTitle: ["🔐 Säkra kontot, soldat", "🔐 Dags att säkra basen", "🔐 Int tappa bort dig nu"],
      nudgeNights: "Du har {0} kvällar i loggen. ",
      nudgeGroup: "Du ä mä i en grupp nu. ",
      nudgeBody: ["Just nu bor kontot bara i den här webbläsaren – rensar du den eller byter till hemskärmsappen ä allt borta. Spara mä e-post på 30 sekunder.",
        "Kompisar har tappat sina konton när de bytt lur eller öppnat hemskärmsappen. Koppla en e-post så kommer du alltid tillbaka."],
      nudgeGo: "🔐 Spara nu",
      nudgeLater: "Sen"
    },
    en: {
      sect: "🔐 Your account",
      saveBtn: "🔐 Save your account",
      saveWhy: ["Right now the account lives only in this browser. Clear it, switch phones or open the home-screen app and it is gone. Save it with your e-mail and you can always get back.",
        "The account is stuck in this browser. Add an e-mail and you can log in again anywhere – groups, medals and history come along."],
      lostBtn: "🔑 Lost your account? Log in with e-mail",
      signedAs: "Signed in as {0}",
      signedHelp: "The same e-mail in the home-screen app or on a new phone = the same account.",
      changeBtn: "✉️ Change e-mail",
      logoutBtn: "🚪 Log out",
      entryHave: "Already have an account? Log in with e-mail",
      entryLost: "🔑 Lost your account? Log in with e-mail",
      googleSave: "G  Continue with Google",
      googleLogin: "G  Log in with Google",
      saveTitle: "🔐 Save account",
      loginTitle: "🔑 Log in",
      changeTitle: "✉️ Change e-mail",
      email: "Your e-mail",
      emailNew: "New e-mail",
      emailPh: "name@example.com",
      sendCode: "📨 Send code",
      sending: "Sending…",
      oneField: "A code to your e-mail – no passwords, no links. If the e-mail already has an account you log in to it.",
      loginWhy: "Type the e-mail you saved the account with. You get a code – no passwords, no links to tap.",
      codeSent: "We sent a code to {0}. Type the code here.",
      codeSentNew: "Step 1 of 2: the code sent to the NEW address {0}.",
      codeSentOld: "Step 2 of 2: now the code sent to your old address {0}.",
      codeSpam: "No e-mail? Check spam.",
      code: "The code from the e-mail",
      checking: "Checking…",
      verify: "✅ Done",
      resend: "Send a new code",
      resendIn: "New code in {0} s",
      changeEmail: "Wrong e-mail? Change",
      back: "← Back",
      openMail: "📬 Open {0}",
      privacy: "We keep the e-mail only for logging in. No mailings, no ads. Nobody else sees it.",
      loginReplace: "⚠️ The account on this device is not saved. If you log in to another one you leave this one.",
      choiceTitle: "Which account do you want to keep?",
      choiceText: "{0} has a saved account. This phone also has an unsaved account with {1}.",
      choiceSaved: "🔑 My saved account (recommended)",
      choiceThis: "📱 Keep this account instead",
      merge: "Bring the groups along: {0}",
      mergeOk: " {0} group(s) came along.",
      mergeFail: " The groups could not be moved – join again with the code.",
      okSavedH: "✅ Your account is saved",
      okSavedP: ["Same account, now linked to {0}. Log in with it in the home-screen app or on a new phone and you are back at once.",
        "Base secured, soldier. {0} is your key – on any phone."],
      okChangedH: "✅ E-mail changed",
      okChangedP: "Now you log in with {0}.",
      okBtn: "Done",
      okLogin: ["🔑 Welcome back{0}! Your account is here.", "🔑 Logged in{0}. The squad is together again.", "🔑 There you are{0}! Everything is still here."],
      eExists: "That e-mail already belongs to an Öl Nu account. We send a code so you can log in to it.",
      eRate: "Too many tries in a short time. Wait {0} and try again.",
      eRateNoS: "a while",
      eWrong: "Wrong code – check the digits in the e-mail and try again.",
      eExpired: "The code has expired. Tap Send a new code.",
      eNoUser: "We found no saved account on {0}. Check the spelling – or save this account with it.",
      eNoUserNew: "We found no saved account on {0}. Check the spelling – or start a new account with it.",
      saveInstead: "🔐 Save this account with {0} instead",
      startNew: "🔐 Start a new account with {0}",
      eBadEmail: "That does not look like an e-mail.",
      eSameEmail: "That is already your e-mail.",
      eOff: "E-mail login is not switched on yet.",
      eNet: "No contact with the server. Check the network and try again.",
      eNoSession: "Wait until the app has signed in, then try again.",
      eFail: "Something went wrong. Try again in a while.",
      eGoogleTaken: "That Google account already belongs to another Öl Nu account. Log in with Google instead?",
      eGoogle: "The Google login did not finish. Try again, or use e-mail.",
      googleOk: "✅ Google is linked. Your account is saved!",
      logoutTitle: "🚪 Log out",
      logoutSaved: "You are logged out on this device. Log in again any time with {0}.",
      logoutUnsaved: "⚠️ The account is NOT saved. If you log out, groups, medals and history are gone for good – nobody can get them back.",
      logoutGo: "🚪 Log out",
      logoutAnyway: "Log out anyway",
      logoutSaveFirst: "🔐 Save the account first",
      cancel: "Cancel",
      nudgeTitle: ["🔐 Secure your account, soldier", "🔐 Time to secure the base", "🔐 Don't get lost now"],
      nudgeNights: "You have {0} nights in the log. ",
      nudgeGroup: "You are in a group now. ",
      nudgeBody: ["Right now the account lives only in this browser – clear it or switch to the home-screen app and it is gone. Save it with e-mail in 30 seconds.",
        "Friends lost their accounts when they changed phones or opened the home-screen app. Add an e-mail and you always get back."],
      nudgeGo: "🔐 Save now",
      nudgeLater: "Later"
    }
  };
  function T(k) {
    var v = (sv() ? TX.sv : TX.en)[k]; if (v == null) v = TX.sv[k];
    if (Array.isArray(v)) v = pick(v);
    var args = Array.prototype.slice.call(arguments, 1);
    return String(v).replace(/\{(\d)\}/g, function (m, i) { return args[+i] != null ? args[+i] : ""; });
  }

  /* ---------- feature flags ---------- */
  var cfg = (function () { var c = lsJSON(CFG_KEY); return c && typeof c === "object" ? c : { email: false, google: false, gOn: false, at: 0 }; })();
  var cfgP = null, cfgWait = [];
  function forced(k) { return CFG[k] === true; }
  function loadCfg(force) {
    if (!LIVE || !window.fetch) return Promise.resolve(cfg);
    if (cfgP) return cfgP;
    if (!force && cfg.at && Date.now() - cfg.at < CFG_TTL) return Promise.resolve(cfg);
    var H = { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
    var one = fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/account_config", { method: "POST", credentials: "omit", headers: H, body: "{}" })
      .then(function (r) { if (!r.ok) throw new Error("cfg " + r.status); return r.json(); });
    var two = fetch(CFG.SUPABASE_URL + "/auth/v1/settings", { credentials: "omit", headers: { apikey: CFG.SUPABASE_ANON_KEY } })
      .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
    cfgP = Promise.all([one, two]).then(function (x) {
      var d = x[0] || {}, s = x[1] && x[1].external ? x[1].external : null;
      cfg = { email: d.email === true && (!s || s.email !== false), google: d.google === true, gOn: !!(s && s.google), at: Date.now() };
      try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
      return cfg;
    }).catch(function () { return cfg; }).then(function (c) {
      cfgP = null; var w = cfgWait; cfgWait = []; w.forEach(function (f) { try { f(); } catch (e) {} }); return c;
    });
    return cfgP;
  }
  function on() { return LIVE && (forced("ACCOUNT_EMAIL") || cfg.email === true); }
  function googleOn() {
    if (!on() || inApp() || (isIOS() && standalone())) return false;
    return forced("ACCOUNT_GOOGLE") || (cfg.google === true && cfg.gOn === true);
  }
  if (LIVE) loadCfg(false);

  /* ---------- session state (sync, from storage) ---------- */
  function stored() { var a = lsJSON(AUTH_KEY); return a && typeof a === "object" && a.refresh_token ? a : null; }
  function user() { var a = stored(); return a && a.user ? a.user : null; }
  function saved() { var u = user(); return !!(u && u.is_anonymous === false); }
  function savedEmail() { var u = user(); return (u && u.email) || ""; }
  function mask(e) {
    var m = String(e || "").match(/^([^@]+)@(.+)$/); if (!m) return e || "";
    return m[1].slice(0, Math.min(m[1].length > 3 ? 2 : 1, m[1].length)) + "•••@" + m[2];
  }
  function client() { return A && A.client ? A.client() : null; }
  function myName() { return (ls("olnu.name", "") || "").trim().slice(0, 30); }

  /* ---------- errors ---------- */
  function kind(e) {
    if (!e) return "fail";
    var c = String(e.code || e.error_code || ""), m = String(e.message || e.msg || ""), s = e.status | 0;
    if (c === "timeout" || /timeout/i.test(m)) return "net";
    if (e.name === "AuthRetryableFetchError" || (s === 0 && /fetch|network|load failed/i.test(m)) || navigator.onLine === false) return "net";
    if (e.name === "AuthSessionMissingError" || c === "session_not_found" || /session missing/i.test(m)) return "nosession";
    if (c === "email_exists" || c === "user_already_exists" || /already (been )?registered|already exists/i.test(m)) return "exists";
    if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || s === 429 || /rate limit|security purposes/i.test(m)) return "rate";
    if (c === "otp_expired" || c === "otp_invalid" || /expired|invalid.*(otp|token)|token.*invalid/i.test(m)) return "badcode";
    if (c === "otp_disabled" || /signups not allowed/i.test(m)) return "nouser";
    if (c === "email_address_invalid" || c === "validation_failed" || /invalid.*email|validate email|email.*invalid/i.test(m)) return "bademail";
    if (c === "email_provider_disabled" || /email logins are disabled|provider.*disabled/i.test(m)) return "off";
    return "fail";
  }
  function errText(e, ctx) {
    var k = kind(e);
    if (k === "rate") { var s = String((e && (e.message || e.msg)) || "").match(/(\d+)\s*sec/); return T("eRate", s ? s[1] + " s" : T("eRateNoS")); }
    if (k === "badcode") return ctx && ctx.sentAt && Date.now() - ctx.sentAt > EXPIRED_AFTER ? T("eExpired") : T("eWrong");
    return T({ net: "eNet", nosession: "eNoSession", exists: "eExists", nouser: "eWrong", bademail: "eBadEmail", off: "eOff", fail: "eFail" }[k] || "eFail");
  }
  // Any auth call / rpc → {data, error}; never rejects, never hangs longer than TIMEOUT.
  function call(fn) {
    return new Promise(function (resolve) {
      var done = false, tm = setTimeout(function () { done = true; resolve({ data: null, error: { code: "timeout", message: "timeout" } }); }, TIMEOUT);
      var fin = function (r) { if (done) return; done = true; clearTimeout(tm); resolve(r || { data: null, error: null }); };
      try { Promise.resolve(fn()).then(fin, function (e) { fin({ data: null, error: e || { message: "error" } }); }); } catch (e) { fin({ data: null, error: e }); }
    });
  }
  function rpc(name, params) { return A && A.rpc ? A.rpc(name, params) : Promise.resolve({ data: null, error: { message: "no_api" } }); }
  function okEmail(s) { s = String(s || "").trim().toLowerCase(); return /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : ""; }

  /* ---------- pending code (survives a reload / the app being killed while the user reads the mail) ---------- */
  function pendGet() { var p = lsJSON(PEND_KEY); return p && p.at && Date.now() - p.at < PEND_MS && p.email ? p : null; }
  function pendSet(p) { if (!p) { lsSet(PEND_KEY, null); return; } try { localStorage.setItem(PEND_KEY, JSON.stringify(p)); } catch (e) {} }

  /* ---------- DOM helpers (sheets AND the #intro card) ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function btn(label, cls, fn) { return el("button", { type: "button", class: "btn " + (cls || ""), text: label, onclick: fn }); }
  function link(label, fn, cls) { return el("button", { type: "button", class: "acct-link" + (cls ? " " + cls : ""), text: label, onclick: fn }); }
  function msg(box, text, err) { box.innerHTML = ""; box.textContent = text || ""; box.className = "acct-msg" + (err ? " err" : ""); box.hidden = !text; }
  function toast(m, o) { if (A && A.toast) A.toast(m, o || {}); }

  // "📬 Öppna Gmail" — only on phones, never in in-app browsers (they block custom schemes).
  function mailApp(email) {
    if (inApp()) return null;
    var d = (String(email).split("@")[1] || "").toLowerCase(), and = /Android/i.test(ua()), ios = isIOS();
    if (/^(gmail|googlemail)\.com$/.test(d)) {
      if (ios) return { name: "Gmail", href: "googlegmail://" };
      if (and) return { name: "Gmail", href: "intent://#Intent;package=com.google.android.gm;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end" };
      return { name: "Gmail", href: "https://mail.google.com/mail/u/0/#inbox", web: true };
    }
    if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) {
      if (ios) return { name: "Outlook", href: "ms-outlook://" };
      if (and) return { name: "Outlook", href: "intent://#Intent;package=com.microsoft.office.outlook;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end" };
      return { name: "Outlook", href: "https://outlook.live.com/mail/", web: true };
    }
    if (/^(icloud|me|mac)\.com$/.test(d) && ios) return { name: "Mail", href: "message://" };
    if (and) return { name: sv() ? "mejlappen" : "mail app", href: "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end" };
    return null;
  }

  // ONE real input (autofill + paste + typing) drawn as 6 boxes. onFull(code) fires on the 6th digit.
  function codeInput(onFull) {
    var inp = el("input", { class: "acct-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]*",
      maxlength: "10", enterkeyhint: "done", "aria-label": T("code"), spellcheck: "false", autocorrect: "off" });
    var cells = el("div", { class: "acct-cells", "aria-hidden": "true" });
    for (var i = 0; i < CODE_LEN; i++) cells.appendChild(el("span", { class: "acct-cell" }));
    var wrap = el("div", { class: "acct-otp" }, [cells, inp]);
    var lastFull = "";
    function draw() {
      var v = inp.value, f = document.activeElement === inp;
      Array.prototype.forEach.call(cells.children, function (c, i) {
        c.textContent = v[i] || "";
        c.className = "acct-cell" + (v[i] ? " full" : "") + (f && (i === Math.min(v.length, CODE_LEN - 1)) ? " on" : "");
      });
    }
    function clean() {
      var v = inp.value.replace(/\D/g, "").slice(0, CODE_LEN);
      if (v !== inp.value) inp.value = v;
      draw();
      if (v.length === CODE_LEN && v !== lastFull) { lastFull = v; onFull(v); }
      if (v.length < CODE_LEN) lastFull = "";
    }
    inp.addEventListener("input", clean);
    inp.addEventListener("paste", function () { setTimeout(clean, 0); });
    ["focus", "blur", "keyup", "click"].forEach(function (ev) { inp.addEventListener(ev, draw); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var v = inp.value.replace(/\D/g, ""); if (v.length === CODE_LEN) onFull(v); } });
    draw();
    return { wrap: wrap, input: inp, value: function () { return inp.value.replace(/\D/g, ""); },
      clear: function () { inp.value = ""; lastFull = ""; draw(); }, focus: function () { try { inp.focus(); } catch (e) {} draw(); },
      bad: function () { wrap.classList.remove("bad"); void wrap.offsetWidth; wrap.classList.add("bad"); } };
  }

  /* ---------- the flow ----------
     mode: "auto" (save this device's account; e-mail taken → log in to it) · "login" · "change" (saved account, new e-mail)
     opts: { onBack, onDone, query (kept over the reload after a login), resume (a pending code) } */
  function flow(box, mode, opts) {
    opts = opts || {};
    var st = { mode: mode, email: "", sentAt: 0, ticket: null, groups: null, step: "", old: "", q: opts.query || "" }, timer = 0;
    function clear() { if (timer) { clearInterval(timer); timer = 0; } box.innerHTML = ""; }
    function frame(step) { clear(); st.step = step; var w = el("div", { class: "acct-flow", "data-step": step, "data-mode": st.mode }); box.appendChild(w); return w; }
    function persist(kind) { pendSet({ m: kind, email: st.email, at: st.sentAt || Date.now(), ticket: st.ticket, old: st.old, q: st.q, step: st.step }); }

    /* step: e-mail */
    function stepEmail(prefill, note) {
      var w = frame("email");
      var login = st.mode === "login", change = st.mode === "change";
      w.appendChild(el("p", { class: "acct-p", text: change ? T("signedAs", mask(savedEmail())) : login ? T("loginWhy") : T("oneField") }));
      if (login && stored() && !saved()) w.appendChild(el("p", { class: "acct-warn", text: T("loginReplace") }));
      var inp = el("input", { class: "inp acct-email", type: "email", inputmode: "email", autocomplete: "email", autocapitalize: "off",
        autocorrect: "off", spellcheck: "false", enterkeyhint: "send", maxlength: "254", placeholder: T("emailPh"), "aria-label": change ? T("emailNew") : T("email"), value: prefill || st.email || "" });
      var m = el("p", { class: "acct-msg", hidden: true, role: "alert" });
      var go = btn(T("sendCode"), "btn-amber btn-block acct-send", send);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
      w.appendChild(el("label", { class: "acct-lbl", text: change ? T("emailNew") : T("email") }));
      w.appendChild(inp); w.appendChild(m); w.appendChild(go);
      if (!change && googleOn()) w.appendChild(btn(login || !stored() ? T("googleLogin") : T("googleSave"), "btn-block acct-google", function () { google(login || !stored() ? "login" : "save", m); }));
      w.appendChild(el("p", { class: "acct-priv", text: T("privacy") }));
      if (opts.onBack) w.appendChild(link(T("back"), function () { clear(); opts.onBack(); }, "acct-back"));
      if (note) msg(m, note.text, note.err);
      setTimeout(function () { try { if (!inp.value) inp.focus(); } catch (e) {} }, 60);
      function busy(b) { go.disabled = b; go.textContent = b ? T("sending") : T("sendCode"); }
      function send() {
        var e = okEmail(inp.value);
        if (!e) { msg(m, T("eBadEmail"), true); return; }
        if (change && e === String(savedEmail()).toLowerCase()) { msg(m, T("eSameEmail"), true); return; }
        if (!client()) { msg(m, T("eNet"), true); return; }
        st.email = e; busy(true); msg(m, "");
        var save = st.mode === "change" || (st.mode === "auto" && stored() && !saved());
        (save ? sendSave() : sendLogin()).then(function (res) {
          busy(false);
          if (res.err) {
            var k = kind(res.err);
            if (k === "exists" && st.mode === "auto") { st.mode = "login"; busy(true); msg(m, T("eExists")); return sendLogin().then(afterLogin); }
            if (k === "nouser") return noUser(m);
            msg(m, errText(res.err, st), true); return;
          }
          if (save) {
            // "Confirm email" off on the server: the e-mail is set at once (no code).
            if (res.data && res.data.user && res.data.user.is_anonymous === false && res.data.user.email === e && st.mode !== "change") return doneSave();
            stepCode(st.mode === "change" ? "new" : "save");
          } else afterLogin(res);
        });
        function afterLogin(res) {
          busy(false);
          if (res && res.err) { if (kind(res.err) === "nouser") return noUser(m); msg(m, errText(res.err, st), true); return; }
          // The phone's own unsaved account has groups → ask which account to keep.
          if (stored() && !saved()) return groupsOfThis().then(function (g) { if (g.length) stepChoice(g); else stepCode("login"); });
          stepCode("login");
        }
      }
    }
    function noUser(m) {
      var e = st.email, canSave = stored() && !saved();
      msg(m, T(canSave ? "eNoUser" : "eNoUserNew", e), true);
      m.appendChild(el("br"));
      m.appendChild(btn(canSave ? T("saveInstead", e) : T("startNew", e), "btn-small acct-instead", function () {
        st.mode = "auto";
        var start = canSave ? Promise.resolve({}) : call(function () { return client().auth.signInAnonymously(); });
        start.then(function (r) {
          if (r && r.error) { msg(m, errText(r.error), true); return; }
          if (!canSave) st.q = st.q || "";   // a brand-new account: reload after the code like a login
          st.freshAnon = !canSave;
          sendSave().then(function (res) { if (res.err) { msg(m, errText(res.err, st), true); return; } stepCode("save"); });
        });
      }));
    }
    function sendSave() {
      var c = client(), data = {}; if (myName()) data.olnu_name = myName();
      if (st.mode === "change") st.old = savedEmail();
      return call(function () { return c.auth.updateUser(st.mode === "change" ? { email: st.email } : { email: st.email, data: data }); })
        .then(function (r) { if (!r.error) st.sentAt = Date.now(); return { err: r.error, data: r.data }; });
    }
    function sendLogin() {
      var c = client();
      return call(function () { return c.auth.signInWithOtp({ email: st.email, options: { shouldCreateUser: false } }); })
        .then(function (r) { if (!r.error) st.sentAt = Date.now(); return { err: r.error, data: r.data }; });
    }
    function groupsOfThis() {
      if (st.groups) return Promise.resolve(st.groups);
      if (!A || !A.authed || !A.authed()) return Promise.resolve([]);
      return rpc("my_groups").then(function (r) { st.groups = r && !r.error && Array.isArray(r.data) ? r.data.map(function (g) { return g.name; }).filter(Boolean) : []; return st.groups; });
    }

    /* step: which account to keep (this phone's unsaved account has groups) */
    function stepChoice(groups) {
      var w = frame("choice");
      var names = groups.slice(0, 3).join(", ") + (groups.length > 3 ? " +" + (groups.length - 3) : "");
      w.appendChild(el("h3", { class: "acct-h3", text: T("choiceTitle") }));
      w.appendChild(el("p", { class: "acct-p", text: T("choiceText", mask(st.email), groups.length + (sv() ? (groups.length === 1 ? " grupp (" : " grupper (") : (groups.length === 1 ? " group (" : " groups (")) + names + ")") }));
      var cb = el("input", { type: "checkbox", id: "acct-merge", checked: true });
      var m = el("p", { class: "acct-msg", hidden: true, role: "alert" });
      w.appendChild(btn(T("choiceSaved"), "btn-amber btn-block acct-keep-saved", function () {
        if (!cb.checked) { stepCode("login"); return; }
        this.disabled = true;
        // While still signed in as this phone's account: a one-use ticket to move its groups after the code.
        rpc("account_merge_ticket").then(function (r) {
          var d = r && !r.error && r.data ? (typeof r.data === "string" ? JSON.parse(r.data) : r.data) : null;
          st.ticket = d && d.ticket ? String(d.ticket) : null; st.mergeTried = true;
          stepCode("login");
        });
      }));
      w.appendChild(el("label", { class: "acct-check", for: "acct-merge" }, [cb, el("span", { text: T("merge", names) })]));
      w.appendChild(m);
      w.appendChild(btn(T("choiceThis"), "btn-block btn-small acct-keep-this", function () { st.mode = "auto"; st.email = ""; stepEmail("", null); }));
    }

    /* step: code (kind "save" | "login" | "new" | "old") */
    function stepCode(kind) {
      var w = frame("code-" + kind);
      persist(kind);
      var who = kind === "old" ? st.old : st.email;
      var txt = kind === "new" ? T("codeSentNew", "\u0001") : kind === "old" ? T("codeSentOld", "\u0001") : T("codeSent", "\u0001");
      w.appendChild(el("p", { class: "acct-p", html: esc(txt).replace("\u0001", "<b class=\"acct-to\">" + esc(mask(who)) + "</b>") }));
      var ci = codeInput(verify);
      var m = el("p", { class: "acct-msg", hidden: true, role: "alert" });
      w.appendChild(ci.wrap); w.appendChild(m);
      var go = btn(T("verify"), "btn-green btn-block acct-verify", function () { verify(ci.value()); });
      w.appendChild(go);
      var app = mailApp(who);
      if (app) w.appendChild(el("a", { class: "btn btn-block acct-mailapp", href: app.href, target: app.web ? "_blank" : null, rel: app.web ? "noopener" : null, text: T("openMail", app.name) }));
      w.appendChild(el("p", { class: "acct-priv", text: T("codeSpam") }));
      var again = el("button", { type: "button", class: "acct-link acct-resend", disabled: true });
      var row = el("div", { class: "acct-row" }, [again]);
      if (kind !== "old") row.appendChild(link(T("changeEmail"), function () { pendSet(null); if (st.mode === "login" && !opts.forceLogin && stored() && !saved() && !st.ticket) st.mode = "auto"; stepEmail(st.email); }, "acct-change"));
      w.appendChild(row);
      var left = Math.max(0, RESEND_S - Math.round((Date.now() - (st.sentAt || Date.now())) / 1000));
      function tick() {
        if (left > 0) { again.disabled = true; again.textContent = T("resendIn", left); left--; }
        else { again.disabled = false; again.textContent = T("resend"); if (timer) { clearInterval(timer); timer = 0; } }
      }
      tick(); timer = setInterval(tick, 1000);
      again.onclick = function () {
        if (again.disabled) return;
        again.disabled = true; msg(m, "");
        (kind === "login" ? sendLogin() : sendSave()).then(function (r) {
          if (r.err) { msg(m, errText(r.err, st), true); again.disabled = false; return; }
          persist(kind); ci.clear(); ci.focus();
          left = RESEND_S; tick(); if (!timer) timer = setInterval(tick, 1000);
        });
      };
      setTimeout(ci.focus, 80);
      var busyNow = false;
      function verify(code) {
        if (busyNow) return;
        code = String(code || "").replace(/\D/g, "");
        if (code.length !== CODE_LEN) { msg(m, T("eWrong"), true); ci.bad(); return; }
        var c = client(); if (!c) { msg(m, T("eNet"), true); return; }
        busyNow = true; go.disabled = true; go.textContent = T("checking"); msg(m, "");
        var prev = kind === "login" && stored() && !saved() ? ls(AUTH_KEY, null) : null;
        var type = kind === "login" ? "email" : "email_change";
        call(function () { return c.auth.verifyOtp({ email: who, token: code, type: type }); }).then(function (r) {
          busyNow = false; go.disabled = false; go.textContent = T("verify");
          if (r.error) { msg(m, errText(r.error, st), true); ci.bad(); ci.clear(); ci.focus(); return; }
          var d = r.data || {}, u = d.user || (d.session && d.session.user);
          if (kind === "new" && !d.session) { stepCode("old"); return; }   // secure e-mail change: the old address must confirm too
          pendSet(null);
          if (kind === "login") {
            if (prev && u && prev.indexOf(String(u.id)) < 0) lsSet("olnu.acct.prev", prev);   // the left anonymous session, this device only
            claimThenLogin(u);
          } else if (kind === "save" && st.freshAnon) doneLogin(u, "");
          else if (kind === "new" || kind === "old") { if (!d.session) call(function () { return c.auth.refreshSession(); }); doneSave(true); }
          else { if (!d.session) call(function () { return c.auth.refreshSession(); }); doneSave(false); }
        });
      }
    }
    function claimThenLogin(u) {
      if (!st.ticket) { doneLogin(u, st.mergeTried ? T("mergeFail") : ""); return; }
      rpc("account_merge_claim", { p_ticket: st.ticket }).then(function (r) {
        var d = r && !r.error && r.data ? (typeof r.data === "string" ? JSON.parse(r.data) : r.data) : null;
        doneLogin(u, d ? (d.moved > 0 ? T("mergeOk", d.moved) : "") : T("mergeFail"));
      });
    }
    function doneSave(changed) {
      var w = frame("done");
      lsSet(NUDGE_KEY, String(Date.now()));
      w.classList.add("acct-done");
      w.appendChild(el("div", { class: "acct-big", "aria-hidden": "true", text: "✅" }));
      w.appendChild(el("div", { class: "acct-done-h", role: "status", text: (changed ? T("okChangedH") : T("okSavedH")).replace(/^✅\s*/, "") }));   // the big ✅ is above
      w.appendChild(el("p", { class: "acct-p", text: changed ? T("okChangedP", mask(st.email)) : T("okSavedP", mask(st.email)) }));
      w.appendChild(btn(T("okBtn"), "btn-amber btn-block acct-ok-btn", function () { clear(); if (opts.onDone) opts.onDone("saved"); else if (A && A.closeSheet) A.closeSheet(); }));
      try { if (window.FX && window.FX.vibrate) window.FX.vibrate([20, 40, 20]); } catch (x) {}
      try { if (window.FX && window.FX.sound && window.FX.sound.clink && !(window.FX.muted && window.FX.muted())) window.FX.sound.clink(); } catch (x) {}
    }
    function doneLogin(u, extra) { finishLogin(u, extra, st.q); }

    // start
    var p = opts.resume;
    if (p) {
      st.email = p.email; st.sentAt = p.at; st.ticket = p.ticket || null; st.old = p.old || ""; st.q = p.q || st.q;
      st.mode = p.m === "login" ? "login" : (p.m === "new" || p.m === "old") ? "change" : "auto";
      stepCode(p.m);
    } else stepEmail("");
    return { stop: clear };
  }

  // A good login: this device now holds the saved account. Start clean, like a flytt import (every module re-reads).
  function finishLogin(u, extra, q) {
    var md = (u && u.user_metadata) || {};
    if (md.olnu_name && String(md.olnu_name).trim()) lsSet("olnu.name", String(md.olnu_name).trim().slice(0, 30));
    if (u && u.id) lsSet("olnu.uid", String(u.id));
    ["olnu.moved", "olnu.movedTo", "olnu.movedU", "olnu.flyttPending", GROUP_KEY].forEach(function (k) { lsSet(k, null); });
    lsSet("olnu.flyttAsked", "1"); lsSet("olnu.intro", "1"); lsSet("olnu.age18", "1"); lsSet(NUDGE_KEY, String(Date.now()));
    try { sessionStorage.setItem("olnu.acct.welcome", JSON.stringify({ n: md.olnu_name ? String(md.olnu_name).slice(0, 30) : "", x: extra || "" })); } catch (e) {}
    var ps = new URLSearchParams(location.search); ps.delete("flytt");
    String(q || "").split("&").forEach(function (kv) { var a = kv.split("="); if (a[0] && /^(join|invite)$/.test(a[0])) ps.set(a[0], decodeURIComponent(a[1] || "")); });
    var qs = ps.toString();
    location.replace(location.pathname + (qs ? "?" + qs : ""));
  }
  function google(mode, m) {
    var c = client(); if (!c) { if (m) msg(m, T("eNet"), true); return; }
    var o = { provider: "google", options: { redirectTo: appUrl() } };
    call(function () { return mode === "save" && stored() && !saved() ? c.auth.linkIdentity(o) : c.auth.signInWithOAuth(o); }).then(function (r) {
      if (r && r.error && m) msg(m, T(kind(r.error) === "net" ? "eNet" : "eGoogle"), true);
    });
  }

  /* ---------- sheets ---------- */
  function sheet(title, mode, o) { if (!A || !on()) return; A.openSheet(title, function (body) { flow(body, mode, o || {}); }, { now: true }); }
  function openSave() { sheet(T("saveTitle"), stored() && !saved() ? "auto" : "login"); }
  function openLogin() { sheet(T("loginTitle"), "login", { forceLogin: true }); }
  function openChange() { if (saved()) sheet(T("changeTitle"), "change"); }
  function logout() {
    if (!A) return;
    var isSaved = saved();
    A.openSheet(T("logoutTitle"), function (body) {
      body.appendChild(el("p", { class: isSaved ? "acct-p" : "acct-warn acct-logout-warn", text: isSaved ? T("logoutSaved", mask(savedEmail())) : T("logoutUnsaved") }));
      var row = el("div", { class: "row", style: "margin-top:12px" });
      if (isSaved) row.appendChild(btn(T("cancel"), "", function () { A.closeSheet(); }));
      else if (on()) row.appendChild(btn(T("logoutSaveFirst"), "btn-amber", function () { body.innerHTML = ""; flow(body, "auto", {}); }));
      row.appendChild(btn(isSaved ? T("logoutGo") : T("logoutAnyway"), isSaved ? "btn-amber acct-logout-go" : "btn-danger btn-small acct-logout-go", doLogout));
      body.appendChild(row);
    }, { now: true });
  }
  function doLogout() {
    var c = client();
    var unsub = window.PUSH && window.PUSH.supported && window.PUSH.supported() && A && A.PUSH_ON
      ? Promise.race([Promise.resolve(window.PUSH.disable(A.rpc)).catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })]) : Promise.resolve();
    unsub.then(function () { return c ? call(function () { return c.auth.signOut({ scope: "local" }); }) : null; }).then(function () {
      [AUTH_KEY, AUTH_KEY + "-user", AUTH_KEY + "-code-verifier", "olnu.uid", "olnu.acct.prev", PEND_KEY, GROUP_KEY, NUDGE_KEY].forEach(function (k) { lsSet(k, null); });
      lsSet("olnu.flyttAsked", "1");
      location.replace(location.pathname);
    });
  }

  /* ---------- entry link (intro card, name sheet, flytt cards, reauth sheet) ---------- */
  // A tap swaps the container's content for the login flow, "Tillbaka" puts it back. opts.query: kept over the reload.
  function entry(container, where, eo) {
    if (!LIVE || !container) return;
    eo = eo || {};
    var slot = el("div", { class: "acct-entry-slot", "data-where": where || "" });
    container.appendChild(slot);
    function open(resume) {
      var kids = Array.prototype.slice.call(container.children);
      kids.forEach(function (k) { k.setAttribute("data-acct-hid", k.hidden ? "1" : "0"); k.hidden = true; });
      var box = el("div", { class: "acct-inline" });
      box.appendChild(el("h2", { class: /^(reauth|name)$/.test(where) ? "acct-h3" : "intro-h", text: T("loginTitle") }));
      var inner = el("div"); box.appendChild(inner);
      container.appendChild(box);
      flow(inner, "login", { query: eo.query || "", resume: resume, forceLogin: true, onBack: function () {
        pendSet(null); box.remove();
        kids.forEach(function (k) { k.hidden = k.getAttribute("data-acct-hid") === "1"; k.removeAttribute("data-acct-hid"); });
      } });
    }
    function fill() {
      if (!on() || slot.firstChild) return;
      var lost = /^(flytt|reauth|moved)$/.test(where);
      slot.appendChild(el("button", { type: "button", class: "acct-entry", text: lost ? T("entryLost") : T("entryHave"), onclick: function () { open(null); } }));
      // Back from the mail app with a pending login code (the page may have been reloaded): straight to the code.
      var p = pendGet(); if (p && p.m === "login" && !resumed) { resumed = true; open(p); }
    }
    if (on()) fill(); else cfgWait.push(fill);
  }
  var resumed = false;
  function resumeSheet() {
    var p = pendGet();
    if (resumed || !p || !A || !on() || (A.sheetOpen && A.sheetOpen()) || ($("intro") && !$("intro").hidden)) return;
    if ((p.m === "save" && saved()) || ((p.m === "new" || p.m === "old") && !saved())) { pendSet(null); return; }
    resumed = true;
    A.openSheet(p.m === "login" ? T("loginTitle") : p.m === "save" ? T("saveTitle") : T("changeTitle"), function (body) { flow(body, p.m, { resume: p }); }, { now: true });
  }

  /* ---------- ⚙️ settings ---------- */
  function settingsSheet(body) {
    if (!LIVE || !on()) return;
    var sec = el("div", { class: "acct-sect" });
    sec.appendChild(el("h3", { text: T("sect") }));
    if (saved()) {
      sec.appendChild(el("p", { class: "acct-ok", html: "✅ " + esc(T("signedAs", "\u0001")).replace("\u0001", "<b>" + esc(mask(savedEmail()) || "e-post") + "</b>") }));
      sec.appendChild(el("p", { class: "muted acct-why", text: T("signedHelp") }));
      sec.appendChild(el("div", { class: "row" }, [btn(T("changeBtn"), "btn-small acct-change-btn", openChange), btn(T("logoutBtn"), "btn-small acct-logout", logout)]));
    } else {
      sec.appendChild(el("p", { class: "muted acct-why", text: T("saveWhy") }));
      sec.appendChild(el("div", { class: "row" }, [btn(T("saveBtn"), "btn-amber btn-block acct-save", openSave)]));
      sec.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [btn(T("lostBtn"), "btn-block btn-small acct-login", openLogin)]));
      if (stored()) sec.appendChild(el("div", { class: "acct-row" }, [link(T("logoutBtn"), logout, "acct-logout")]));
    }
    body.appendChild(sec);
  }

  /* ---------- nudge (once ever, at a high-value moment) ---------- */
  var groupsAsked = false, shownThisSession = false;
  function nights() { var l = lsJSON("olnu.nights"); return Array.isArray(l) ? l.length : 0; }
  function nudgeCandidate() { return on() && !saved() && !!stored() && !ls(NUDGE_KEY, "") && !pendGet(); }
  function nudgeReason() {
    if (!nudgeCandidate()) return null;
    if (nights() >= 3) return "nights";
    if (ls(GROUP_KEY, "") === "1") return "group";
    return null;
  }
  function tryNudge() {
    var why = nudgeReason();
    if (!why || shownThisSession || !A || !A.authed || !A.authed()) return;
    if (document.hidden || (A.sheetOpen && A.sheetOpen()) || ($("intro") && !$("intro").hidden)) return;
    if (window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up()) return;   // never over the beer-type strip
    shownThisSession = true;
    lsSet(NUDGE_KEY, String(Date.now()));
    A.openSheet(T("nudgeTitle"), function (body) {
      body.classList.add("acct-nudge");
      var lead = why === "nights" ? T("nudgeNights", nights()) : T("nudgeGroup");
      body.appendChild(el("p", { class: "acct-p", text: lead + T("nudgeBody") }));
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [btn(T("nudgeLater"), "", function () { A.closeSheet(); }),
        btn(T("nudgeGo"), "btn-amber", function () { body.innerHTML = ""; flow(body, "auto", {}); })]));
    });
  }
  function checkGroups() {
    if (groupsAsked || !A || ls(GROUP_KEY, "") === "1" || !nudgeCandidate()) return;
    groupsAsked = true;
    rpc("my_groups").then(function (r) { if (r && !r.error && Array.isArray(r.data) && r.data.length) { lsSet(GROUP_KEY, "1"); tryNudge(); } });
  }

  /* ---------- styles (own block; app tokens with fallbacks) ---------- */
  function css() {
    if ($("acct-css")) return;
    var s = document.createElement("style"); s.id = "acct-css";
    s.textContent = [
      ".acct-flow{display:flex;flex-direction:column;gap:8px;text-align:left}",
      ".acct-flow .inp{width:100%;box-sizing:border-box}",
      ".acct-lbl{font-size:13px;color:var(--muted,#9aa4b8);margin-top:4px}",
      ".acct-p{margin:0 0 4px;line-height:1.45}",
      ".acct-to{white-space:nowrap}",
      ".acct-warn{margin:0;padding:8px 10px;border-radius:10px;background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.4);font-size:14px;line-height:1.4}",
      ".acct-msg{margin:0;font-size:14px;line-height:1.4}.acct-msg.err{color:var(--red,#ff6b6b)}",
      ".acct-msg .btn{margin-top:8px}",
      ".acct-priv{margin:2px 0 0;font-size:12px;color:var(--muted,#9aa4b8)}",
      ".acct-row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}",
      ".acct-link{background:none;border:0;color:var(--amber,#f5a623);font:inherit;font-size:14px;padding:10px 2px;min-height:44px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
      ".acct-link[disabled]{color:var(--muted,#9aa4b8);text-decoration:none;cursor:default}",
      ".acct-entry{display:block;width:100%;background:none;border:0;color:var(--amber,#f5a623);font:inherit;font-size:14px;padding:12px 4px;min-height:44px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
      ".acct-inline{text-align:left}.acct-inline .intro-h{text-align:center}",
      ".acct-h3{font-size:18px;margin:2px 0 6px}",
      ".acct-ok{margin:0 0 4px;line-height:1.45}.acct-why{margin:0 0 8px}",
      ".acct-otp{position:relative;height:60px;margin:2px 0}",
      ".acct-cells{position:absolute;inset:0;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;pointer-events:none}",
      ".acct-cell{display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid var(--hair-2,rgba(255,255,255,.18));background:var(--s0,#0b1220);font:700 26px/1 var(--hud,ui-monospace,monospace);color:var(--text,#fff)}",
      ".acct-cell.full{border-color:rgba(245,166,35,.55)}",
      ".acct-cell.on{border-color:var(--amber,#f5a623);box-shadow:0 0 0 3px rgba(245,166,35,.22)}",
      ".acct-code{position:absolute;inset:0;width:100%;height:100%;opacity:.01;color:transparent;caret-color:transparent;background:transparent;border:0;font-size:16px;letter-spacing:1em;padding:0 8px;box-sizing:border-box}",
      ".acct-otp.bad .acct-cell{border-color:var(--red,#ff6b6b)}",
      "@media (prefers-reduced-motion:no-preference){.acct-otp.bad{animation:acct-shake .35s ease-in-out 1}}",
      "@keyframes acct-shake{0%,100%{transform:none}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}",
      ".acct-mailapp{display:flex;align-items:center;justify-content:center;text-decoration:none}",
      ".acct-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4;padding:6px 2px;cursor:pointer}",
      ".acct-check input{width:22px;height:22px;flex:0 0 auto;accent-color:var(--amber,#f5a623)}",
      ".acct-done{align-items:center;text-align:center}.acct-big{font-size:52px;line-height:1.1}",
      ".acct-done-h{font:800 22px/1.2 var(--display,inherit);color:var(--text,#fff);margin:2px 0 4px}"
    ].join("\n");
    document.head.appendChild(s);
  }

  window.ACCOUNT = {
    init: function (api) {
      A = api; css();
      try {
        var w = sessionStorage.getItem("olnu.acct.welcome");
        if (w) {
          sessionStorage.removeItem("olnu.acct.welcome");
          var o = {}; try { o = JSON.parse(w) || {}; } catch (e) { o = { n: w === "-" ? "" : w }; }
          setTimeout(function () { toast(T("okLogin", o.n ? ", " + o.n : "") + (o.x || ""), { ms: 7000, cls: "skal", id: "acct", keep: true }); }, 1200);   // keep: shown at once, outside the boot toast queue
        }
      } catch (e) {}
      if (oauthErr) {
        var taken = /identity_already_exists|already linked/i.test(oauthErr.code + " " + oauthErr.msg);
        setTimeout(function () {
          toast(taken ? T("eGoogleTaken") : T("eGoogle"), { err: true, ms: 9000, id: "acct", action: taken ? { label: T("googleLogin"), fn: function () { google("login", null); } } : null });
        }, 800);
        oauthErr = null;
      }
    },
    onAuthed: function () {
      var c = client(); if (!c) return;
      var oauth = false; try { oauth = sessionStorage.getItem("olnu.acct.oauth") === "1"; sessionStorage.removeItem("olnu.acct.oauth"); } catch (e) {}
      if (oauth) call(function () { return c.auth.refreshSession(); }).then(function (r) {
        var u = r && r.data && r.data.user; if (u && u.is_anonymous === false) { lsSet(NUDGE_KEY, String(Date.now())); toast(T("googleOk"), { id: "acct", ms: 5000 }); }
      });
      if (saved()) {
        var u = user() || {}, md = u.user_metadata || {}, n = myName();
        if (!n && md.olnu_name) lsSet("olnu.name", String(md.olnu_name).slice(0, 30));
        else if (n && md.olnu_name !== n) setTimeout(function () { call(function () { return c.auth.updateUser({ data: { olnu_name: n } }); }); }, 8000);
      }
      loadCfg(false).then(function () {
        setTimeout(resumeSheet, 1500);
        setTimeout(function () { checkGroups(); tryNudge(); }, 20000);
      });
    },
    onPoll: function () { if (nudgeCandidate()) tryNudge(); },
    groupItem: function () { if (ls(GROUP_KEY, "") !== "1") lsSet(GROUP_KEY, "1"); },
    profileSheet: settingsSheet,   // 👤 Profil (was settingsSheet)
    entry: entry,
    on: on, saved: saved,
    openSave: openSave, openLogin: openLogin, openChange: openChange, logout: logout,
    _flow: flow, _kind: kind, _cfg: function () { return cfg; }, _mask: mask
  };
})();
