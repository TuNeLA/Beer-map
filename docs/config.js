window.OLNU_CONFIG = {
  // 🚚 PintsNow move (CONTRACT "PINTSNOW MOVE"): the new address, and the old-origin bridge page (TuNeLA/tunela.github.io repo).
  APP_ORIGIN: "https://pintsnow.com",
  BRIDGE_URL: "https://tunela.github.io/olnu-flytt.html",
  // 🧪 Betaversion (CONTRACT "BETAKANAL"): the beta build (TuNeLA/pintsnow-beta, made from big-update). The switch in
  // Inställningar makes sw.js load the app code from here. Empty = no switch.
  BETA_URL: "https://tunela.github.io/pintsnow-beta/",
  SUPABASE_URL: "https://wcdskpcevbhouvbytkhv.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZHNrcGNldmJob3V2Ynl0a2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjA1NTUsImV4cCI6MjEwNzczNjU1NX0.-47HqgBAL6yobVf-XKmlIw1xzII3KrpIMgX0vo56Pj8",
  // Mapbox PUBLIC token (pk.*): safe in client code. URL-restricted in the Mapbox account to the app's site
  // (https://tunela.github.io/Beer-map). Used only by the opt-in "Mapbox natt (beta)" map style and docs/karta3d.html.
  MAPBOX_TOKEN: "",   // leave empty: basemap.js reads the pk token from the public_config() RPC (GitHub push protection blocks it in git)
  VAPID_PUBLIC_KEY: "BMtX3rVi1PuU-ytEsnt0udIaBKBWAELrLEUdCaWW54ltwFfISOPqqkN7DLVXbXsgMNfNxx6yWo8gnNuin8zRAtc"
};
// 🏪 SAFE: store build flag (store-compliance C). The Android TWA starts with ?app=android (and/or has an
// android-app:// referrer); the iOS shell is Capacitor. Kept for this session so in-app links keep it.
// Store builds hide what is web-only: the "Klassiskt" penalty pack (spel.js) and user drink deals (safety.css).
(function () {
  var s = false;
  try {
    s = !!(/[?&]app=(android|ios)\b/.test(location.search || "") || window.Capacitor || /^android-app:\/\//.test(document.referrer || "") ||
      sessionStorage.getItem("olnu.store") === "1" || localStorage.getItem("olnu.store") === "1");
    if (s) sessionStorage.setItem("olnu.store", "1");
  } catch (e) {}
  window.OLNU_STORE = s;
  if (s) document.documentElement.classList.add("olnu-store");
})();
