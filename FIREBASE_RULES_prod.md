# Firebase rules for the OneByte Production app (prod_* paths)

Project: evp-crm  ->  Realtime Database  ->  Rules

IMPORTANT: this database is shared with your other apps (CRM etc.). Do NOT replace
the whole rules file. Open the existing rules and only ADD the `prod_*` block below
inside "rules": { ... }, keeping everything already there.

Step 1 - Firebase Console -> Authentication -> Sign-in method -> "Anonymous" must be ON
         (you already did this; the app signs in anonymously automatically).
Step 2 - Add this block to the rules (it now includes the aggregator, photo and push paths):

    "prod_users":       { ".read": "auth != null", ".write": "auth != null" },
    "prod_sites":       { ".read": "auth != null", ".write": "auth != null" },
    "prod_items":       { ".read": "auth != null", ".write": "auth != null" },
    "prod_basins":      { ".read": "auth != null", ".write": "auth != null" },
    "prod_ledger":      { ".read": "auth != null", ".write": "auth != null", ".indexOn": ["ts"] },
    "prod_notices":     { ".read": "auth != null", ".write": "auth != null" },
    "prod_sessions":    { ".read": "auth != null", ".write": "auth != null" },
    "prod_settings":    { ".read": "auth != null", ".write": "auth != null" },
    "prod_recipes":     { ".read": "auth != null", ".write": "auth != null" },
    "prod_trips":       { ".read": "auth != null", ".write": "auth != null" },
    "prod_ratings":     { ".read": "auth != null", ".write": "auth != null" },
    "prod_feedback":    { ".read": "auth != null", ".write": "auth != null" },
    "prod_escalations": { ".read": "auth != null", ".write": "auth != null" },
    "prod_photos":      { ".read": "auth != null", ".write": "auth != null" },
    "prod_push":        { ".read": "auth != null", ".write": "auth != null" },
    "prod_pushlock":    { ".read": "auth != null", ".write": "auth != null" },
    "prod_aggs":        { ".read": "auth != null", ".write": "auth != null" },
    "prod_attendance":  { ".read": "auth != null", ".write": "auth != null" },
    "prod_attendtrack": { ".read": "auth != null", ".write": "auth != null" },
    "prod_chat":        { ".read": "auth != null", ".write": "auth != null" }

If you do NOT add rules for the new paths and your database default is locked, the
rating / feedback / escalation / photo / push features will silently fail to save.

Effect: only devices that opened the app can read/write prod data - random internet
users cannot. Role limits inside the app (who sees what) remain app-level.
Note: passwords are stored as readable text in prod_users, so this lock matters.
Photos are stored (compressed, ~100-150 KB each) under prod_photos; the free Realtime
Database allows 1 GB, which is thousands of photos. Delete old photos from the viewer.


## Added in the latest versions (REQUIRED)
The block above now also includes prod_aggs, prod_attendance, prod_attendtrack, prod_chat and prod_pushlock.
Without prod_attendance / prod_chat the Attendance and Chat features will not save if your database is locked.

## Cloud Functions added (deploy once)
    cd prod-functions && firebase deploy --only functions --project evp-crm
- onChatMessage  - chat push when the app is closed
- dailySummary   - 9:30 pm IST push to Admin/Ops/Production: meals, cooked, delivered, attendance, open escalations
- nightlyBackup  - 1:30 am IST copy of all production data to Cloud Storage `backups/onebyte-YYYY-MM-DD.json` (last 30 kept).
                   Needs Firebase Storage switched on (Build -> Storage -> Get started). Scheduled functions need the Blaze plan.
To restore a backup: Firebase console -> Realtime Database -> the prod_ nodes -> Import JSON (per node from the file).
