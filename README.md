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

**Live demo:** https://tunela.github.io/beer-map/

<img src=".github/screenshot-demo.png" width="260"> <img src=".github/screenshot-medevac.png" width="260">

## Try it now (demo mode)

The app runs in demo mode with fake data when `docs/config.js` is empty.

```
cd docs
python -m http.server 8000
```

Open http://localhost:8000. In demo mode, the "DEBUG: hoppa över väntan" button skips the 15 min wait.

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

### 5. Get all bars in Sweden (optional, recommended)

```
node scripts/fetch-bars.mjs
```

This makes `docs/bars.json`. Without it, the app asks OpenStreetMap for bars when you zoom in.

### 6. Put it online (GitHub Pages)

The repo is https://github.com/TuNeLA/beer-map. GitHub Pages serves the `docs/` folder.
The app is at https://tunela.github.io/beer-map/. Push to `main` to update it.

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
- `CONTRACT.md` — the full spec
