# OneByte Production — Play Store & App Store release guide

App id / bundle id: `com.evp.onebyte.production` · Name: **OneByte Production**
Both stores need accounts you own (I can't create them): Google Play Console ($25 one-time) and Apple Developer Program ($99/year).

IMPORTANT: this is an internal staff + client app that needs a login. Both stores accept that, but you must give the reviewers a demo login (see "Review notes"). If you only want your own people to have it, use **Play: Closed/Internal testing or Managed Google Play private app**, and **Apple: TestFlight or "Unlisted App Distribution"** — much faster approval, no public listing.

## A. Google Play (Android)
1. **Create the upload key (once, on any computer with Java):**
   `keytool -genkeypair -v -keystore upload.keystore -alias onebyte -keyalg RSA -keysize 2048 -validity 10000`
   Keep `upload.keystore` and its passwords safe forever (lose it = painful reset).
   Convert: `base64 -w0 upload.keystore` (Mac: `base64 -i upload.keystore`).
   In GitHub repo → Settings → Secrets → Actions add: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (onebyte), `ANDROID_KEY_PASSWORD`.
2. GitHub → Actions → **Build OneByte Production Play Store bundle (AAB)** → Run workflow → download `app-release.aab` from the run's artifacts.
3. Play Console → Create app → fill listing from `LISTING.md`, upload icon/feature graphic/screenshots from `store/assets/`, privacy policy URL (host `privacy-policy.html`, e.g. GitHub Pages or kalyanasapadu.com/privacy).
4. Production (or Internal testing) → Create release → upload the AAB (accept Play App Signing).
5. Complete App content: Data safety (answers in LISTING.md), **Background location declaration** (+ a short screen-recording of attendance sign-in showing the tracking notice — reuse `OneByte-Demo-*.mp4`), Target audience 18+, Ads: none, App access: provide demo logins.
6. New personal developer accounts must run a 12-tester closed test for 14 days before production. An organisation account (D-U-N-S) skips this.

## B. Apple App Store (iOS)
1. Enrol in the Apple Developer Program (as organisation needs a D-U-N-S number).
2. developer.apple.com → Identifiers → register `com.evp.onebyte.production` (enable Push Notifications, Background Modes).
3. Certificates → create an **Apple Distribution** certificate; export as .p12 (Keychain Access) → base64 → secret `IOS_CERT_P12_B64`, password → `IOS_CERT_PASSWORD`.
4. Profiles → create **App Store** provisioning profile for that id → base64 → `IOS_PROFILE_B64`.
5. App Store Connect → Users and Access → Integrations → create an API key (App Manager) → `ASC_KEY_ID`, `ASC_ISSUER_ID`, `.p8` base64 → `ASC_KEY_P8_B64`.
6. App Store Connect → New App (same bundle id). Fill listing from `LISTING.md`, privacy policy URL, App Privacy answers, age rating 4+/12+, upload screenshots.
7. GitHub → Actions → **Build OneByte Production iOS** → Run. It builds on a Mac runner and uploads to TestFlight. Then pick the build in App Store Connect → Submit for review.
8. Closed-app push on iOS also needs: Firebase console → add iOS app → upload APNs key, and add `GoogleService-Info.plist` to `production-android/` (tell me and I'll wire it in).

## Review notes (paste into both stores)
Internal operations app, login required. Demo logins (read-only demo data) — create one Admin and one Aggregator login for reviewers and put them here. Location (incl. background) is used only for signed-in staff attendance and delivery-trip tracking; the app shows a persistent notification while tracking. Microphone/camera used for chat voice notes and work photos.
