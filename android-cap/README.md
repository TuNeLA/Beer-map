# android-cap: the PintsNow Android store app (F1)

Capacitor 8 shell. Package `se.tunela.pintsnow` (FINAL: it can never change after the first Play upload).
compileSdk 36, targetSdk 36, minSdk 24. The old TWA in `android/` (targetSdk 34, `se.tunela.olnu`) is not used for Play.

## What is in the app
- The web files from `docs/`, copied at build time to `www/` (not in git) by `scripts/prepare-www.mjs`:
  - `config.js`: the store flag is forced on (`window.OLNU_STORE = true`), so every store rule holds.
  - `scripts/strip-logging.py`: crash reports only (owner decision 8 Nov 2026), sw.js VERSION ends with `-store`.
- The web view runs at `https://app.pintsnow.com` (a local name; nothing is fetched from there).
  Why: the Mapbox token's URL list allows `pintsnow.com` and its sub-domains, and `js/handover.js` does not bounce
  a store start to the old-address bridge (that only happens on the exact APP_ORIGIN).
- Permissions: internet, coarse + fine location, camera. Never background location.
  The web view asks for each one only when the user taps a feature that needs it.

## Build on your own computer
Needs Node 22, JDK 21 and the Android SDK (platform 36, build-tools 35).
```
cd android-cap
npm ci
node scripts/prepare-www.mjs
npx cap sync android
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

## Build on GitHub
Workflow `.github/workflows/android-cap.yml` (Actions → "Android store build (Capacitor)" → Run workflow).
Always a debug APK. Tick "release" for the signed AAB for Play Console.

## Signing (the owner does this once; never put a key or password in git)
1. Make an upload key on your own computer (Android Studio → Build → Generate Signed Bundle, or `keytool -genkeypair
   -v -keystore pintsnow-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`). Keep the file and the
   passwords in your password manager. Play App Signing keeps the real app key; this is only the upload key.
2. GitHub → TuNeLA/Beer-map → Settings → Secrets and variables → Actions → New repository secret, 4 times:
   - `ANDROID_UPLOAD_KEYSTORE_B64`: the .jks file as base64 in one line
     (Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("pintsnow-upload.jks"))`)
   - `ANDROID_UPLOAD_STORE_PASSWORD`: the keystore password
   - `ANDROID_UPLOAD_KEY_ALIAS`: the alias (for example `upload`)
   - `ANDROID_UPLOAD_KEY_PASSWORD`: the key password
3. Run the workflow with "release" ticked. Download the artifact `pintsnow-release-aab`.
4. Play Console → create the app → Test and release → Internal testing (then Closed testing) → upload the .aab.
   Accept Play App Signing.

Gradle reads `PN_UPLOAD_KEYSTORE_FILE`, `PN_UPLOAD_STORE_PASSWORD`, `PN_UPLOAD_KEY_ALIAS`, `PN_UPLOAD_KEY_PASSWORD`
from the environment (the workflow sets them). No variables = an unsigned release; debug builds always work.

## Not in this first build (follow-ups)
- Native push (FCM, `@capacitor/push-notifications`): web push does not work in a web view.
- Deep links / App Links for pintsnow.com (needs `@capacitor/app` + a new assetlinks.json entry with the new key's SHA-256).
- `navigator.share`: the Android web view probably has no Web Share (check on a phone; fix: `@capacitor/share`).
