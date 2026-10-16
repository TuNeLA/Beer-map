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

The Android app is a Trusted Web Activity (TWA). It opens the live site in Chrome, so location, offline mode and push notifications work.

Install:

1. On your phone, open https://github.com/TuNeLA/Beer-map/releases/latest
2. Download `olnu.apk`.
3. When Android asks, allow "Install unknown apps" for Chrome.
4. Open the file and tap Install.

Notes:

- The APK is built by GitHub Actions (`.github/workflows/android.yml`) when `android/**` changes. You can also start it by hand (Actions > Android APK > Run workflow).
- **Test key:** the APK is signed with `android/olnu-test.keystore`. Its password is in the workflow file. This key is public. Use it for sideloading only. Make a new private key (kept as a GitHub secret) before any Play Store release, and update `docs/.well-known/assetlinks.json` with the new SHA-256 fingerprint.
- Test key SHA-256: `C5:59:91:C6:3F:67:3A:BF:31:06:14:73:27:DF:A7:F2:B9:E6:C8:63:1B:25:3C:97:D4:E1:64:EB:AF:80:07:19`
- **Thin URL bar:** the app shows a thin URL bar at the top. The reason: Android looks for `assetlinks.json` at the domain root (`https://tunela.github.io/.well-known/assetlinks.json`). This repo only puts it at `/Beer-map/.well-known/`. To fix it, make a repo `TuNeLA.github.io` with `.well-known/assetlinks.json` (copy from `docs/.well-known/`), or use a custom domain.
