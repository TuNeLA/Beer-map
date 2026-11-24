# Öl Nu 🍺

Live beer map of Sweden. Tap **ÖL!** and your beer goes on the map. Everybody sees it.

- No login. Your callsign stays on your phone. Only your groups see it.
- Join a group with a 6-letter code or a QR code. Friends' beers have a green ring.
- 15 minutes between beers. The server checks it.
- 5+ beers = 🔥 HOT STREAK. 10+ beers = 🚁 MEDEVAC.
- Your group gets a push notification at beer 1, 5 and 10.
- Bars from OpenStreetMap. Beers within 75 m of a bar count for that bar.
- Pins stay until 05:00. Then the night resets.
- Works on Android and iPhone (add to home screen).

**Live site:** https://tunela.github.io/Beer-map/

<img src=".github/screenshot-demo.png" width="260"> <img src=".github/screenshot-medevac.png" width="260">

## Try it

The site has **no fake data**. It needs two things to work:

1. **Keys in `docs/config.js`** (see "Make it live" below). Without `SUPABASE_URL`, the site shows **"Startar snart / Coming soon"**: the map and the real bars work, but the ÖL! button is off.
2. **The bars workflow** (`.github/workflows/bars.yml`). It makes `docs/bars.json` (all bars in Sweden) and commits it to `main`. It runs every week, and when you start it by hand: **Actions → Bars (OpenStreetMap) → Run workflow**. Until `bars.json` exists, the app asks OpenStreetMap for bars near you when you zoom in, and keeps them on the phone for 7 days.

Run it on your computer:

```
cd docs
python -m http.server 8000
```

Open http://localhost:8000. The map starts at your location (if you allow it) or at Ludvika.

## Make it live

You need about 30 minutes. All parts are free.

### 1. Make the database (Supabase)

1. Go to https://supabase.com. Make a free account and a new project. Pick region **Stockholm (eu-north-1)**.
2. Open **SQL Editor**. Paste all of `supabase/migrations/0001_olnu.sql`. Click **Run**.
3. Open **Authentication → Sign In / Providers**. Turn ON **Allow anonymous sign-ins**.
4. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

### 2. Make push keys

```
npx web-push generate-vapid-keys
```

Keep both keys. The private key is secret. Never put it in `docs/`.

### 3. Send the notification function

Install the Supabase CLI (https://supabase.com/docs/guides/cli). Then:

```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
supabase functions deploy notify-group
```

More details: `supabase/config-notes.md`.

### 4. Fill in the config

Edit `docs/config.js`:

```js
window.OLNU_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
  VAPID_PUBLIC_KEY: "B..."
};
```

The anon key is safe to share. The database only allows the app's own functions.

### 5. Get all bars in Sweden

Run the workflow **Actions → Bars (OpenStreetMap) → Run workflow** once. It also runs every Monday.
Or run it on your computer: `node scripts/fetch-bars.mjs` (Node 20). Both make `docs/bars.json`.

Push notifications are optional. If `VAPID_PUBLIC_KEY` is empty, the app hides the notification switch. Everything else works.

### 6. Put it online (GitHub Pages)

The repo is https://github.com/TuNeLA/Beer-map. GitHub Pages serves the `docs/` folder.
The app is at https://tunela.github.io/Beer-map/. Push to `main` to update it.

### 7. Install on the phone

- **Android (Chrome):** open the link. Tap **Install** (or menu → Add to home screen).
- **iPhone (Safari):** open the link. Tap **Share → Add to Home Screen**. Open Öl Nu from the home screen. Notifications on iPhone work only this way (iOS 16.4 or newer).

## Before a big launch

- Turn on CAPTCHA and rate limits for anonymous sign-ins in Supabase. This stops spam bots.
- Map tiles are from Esri (free for non-commercial use). If the app makes money, get a free CARTO key and add `CARTO_KEY: "..."` to `config.js`.
- "Exact spot" pins show the real location to everybody. "Area only" pins are rounded to about 500 m.
- Test one real push on Android and one on iPhone.

## Files

- `docs/` — the app (HTML, CSS, JS, service worker, icons)
- `supabase/migrations/0001_olnu.sql` — database, rules and functions
- `supabase/functions/notify-group/` — push notifications to groups
- `scripts/fetch-bars.mjs` — downloads Swedish bars from OpenStreetMap
- `.github/workflows/bars.yml` — runs the bar download every week and commits `docs/bars.json`
- `CONTRACT.md` — the full spec


## Android app

The Android store app is a Capacitor shell in `android-cap/` (package `se.tunela.pintsnow`, targetSdk 36, minSdk 24). It carries a copy of `docs/` with the store flag on (`window.OLNU_STORE = true`). Full details: `android-cap/README.md`. The old TWA (`android/`, `.github/workflows/android.yml`, the public sideload test key) was removed on 19 Nov 2026 (C23). Its old commits stay in the git history.

### Build the APK (debug, to sideload)

On GitHub (no tools needed on your computer):

1. Actions > "Android store build (Capacitor)" > Run workflow.
2. When it is green, open the run and download the artifact `pintsnow-debug-apk`.
3. On the phone: open the `.apk`, allow "Install unknown apps" when Android asks, tap Install.

On your own computer (Node 22, JDK 21, Android SDK platform 36 + build-tools 35):

```
cd android-cap
npm ci
node scripts/prepare-www.mjs        # docs/ -> android-cap/www (store flag on, usage logging stripped)
npx cap sync android
cd android && ./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

The workflow starts by itself on a push that changes `android-cap/**` (branches main, big-update, ci/**). `versionCode` = 100 + the run number.

### Signed release (AAB for Play Console)

Run the workflow with "release" ticked. It needs 4 repository secrets (Settings > Secrets and variables > Actions). Names only; the values stay in the owner's password manager and never go into git, a log or a commit message:

- `ANDROID_UPLOAD_KEYSTORE_B64` (the upload keystore `.jks`, base64 in one line)
- `ANDROID_UPLOAD_STORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

The workflow turns them into the variables `PN_UPLOAD_KEYSTORE_FILE`, `PN_UPLOAD_STORE_PASSWORD`, `PN_UPLOAD_KEY_ALIAS`, `PN_UPLOAD_KEY_PASSWORD` for Gradle, and deletes the keystore file after the build. No secrets = an unsigned release; debug builds always work. The artifact is `pintsnow-release-aab`. Steps to make the key: `android-cap/README.md`, section "Signing".

## Secret scan (gitleaks)

`.github/workflows/secrets.yml` runs gitleaks (v8.21.2, full history, redacted output) and `scripts/check-jwt-roles.py` on every push to main / big-update. The config is `.gitleaks.toml`: the default rules plus these exceptions, each with a reason:

- JWT-shaped strings: the Supabase ANON keys are public by design (`docs/config.js` and others). gitleaks cannot tell an anon key from a `service_role` key. So the JWT match is allowed there, and `scripts/check-jwt-roles.py` decodes every JWT and FAILS on any role but `anon`. A service key in git is still caught.
- `rt-abcdef-123`: a fake refresh token in unit tests (a generic-api-key false positive).
- The path `.github/workflows/android.yml`: the old TWA workflow held the public sideload TEST key password. The file is gone, but gitleaks scans the whole history, so the exception stays. That test key is never used for the Play Store.

Do not add a new exception to make a scan pass without a reason. If gitleaks finds a real key: rotate the key first, then clean up.
