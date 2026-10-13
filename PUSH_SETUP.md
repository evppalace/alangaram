# Push notifications - what works now and the one-time setup for closed-app push

## Works right now (no setup)
- In the app: the bell, pop-up toast and a phone notification (Android app) when something new
  happens while the app is open or recently used: vehicle left / arrived, late, QC failed,
  wastage update, client escalation, feedback, replies, notice-board posts.
- Every notification carries a REFERENCE number: ESC-001 (escalation), FB-001 (feedback),
  ML-1310-TEL-LUN (a meal/trip: day-month, counter, meal).

## To get alerts when the app is CLOSED (real push) - one-time, about 15 minutes
1. Firebase Console -> project evp-crm -> Project settings -> "Add app" -> Android.
   Package name:  com.evp.onebyte.production   (nickname: OneByte Production). Download
   `google-services.json`.
2. Upload that file to the GitHub repo at:  production-android/google-services.json
   (the next APK build detects it, adds the push plugin and wires it in automatically).
3. Upgrade the Firebase project to the Blaze (pay-as-you-go) plan (Cloud Functions need it;
   at your volume the bill is normally 0). Then on any computer with Node 20:
       npm install -g firebase-tools
       firebase login
       cd prod-functions && npm install
       firebase deploy --only functions --project evp-crm
4. Install the new APK, log in once on each phone (this registers the phone for push).
5. Add the prod_push rule from FIREBASE_RULES_prod.md.

If you skip steps 1-3 the app still works exactly as described in "Works right now".
