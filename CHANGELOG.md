# Changelog

## 2026-09-21 — 2026-09-27: Prod-readiness pass, PayFast payments, device fixes

The app started this stretch full of mock/placeholder data (fake bookings,
a hardcoded chauffeur, a fake `530` fare, `alert()` stubs on every profile
menu item) and ended it with a real Firebase backend, a working payment
gateway, and a verified Cordova build pipeline.

### Removed mock data, added a real backend

- Deleted the hardcoded chauffeur, fake ride history, fake fares, and the
  fake booking reference (`SPK-20241215-0042`) from `src/index.html` and
  `src/main.js`.
- `createBooking` and `cancelBooking` Cloud Functions now own fare
  calculation and booking state — the client never computes or sends a
  trusted fare.
- `src/rides.module.js` (new) renders real ride history and the home
  screen's "Recent Rides" from a live Firestore listener, replacing
  hardcoded cards.
- `src/tracking.module.js` now reads pickup, destination, distance, ETA,
  and fare from the real booking document instead of static markup.
- Rewrote `scripts/seed-firestore.js` to match the real schema (it had
  drifted to an old relational `drivers`/`vehicles` model that no longer
  matches how the app reads bookings).

### PayFast payments

- New Cloud Functions: `createPayfastPayment` (builds and signs the
  checkout URL from the booking's own stored fare — never a client-
  supplied amount), `payfastNotify` (verifies the ITN webhook's
  signature and re-confirms with PayFast's own `/validate` endpoint
  before marking a booking paid), `paymentReturn`, `paymentCancel`.
- `src/main.js` opens checkout via `cordova-plugin-inappbrowser` on
  device, falling back to `window.open()` in a plain browser for testing.
- Found and fixed two real bugs during verification:
  - Two of the three PayFast secrets had a trailing newline baked in
    from being set via `echo | firebase functions:secrets:set` — fixed
    by resetting them with `printf` instead.
  - `pfSignature` excluded blank fields from the hash, which broke ITN
    validation (PayFast's own signature includes blanks) and had a
    latent bug on the checkout side too.
- Verified end-to-end with a real sandbox payment: signature accepted,
  checkout completed, ITN received, `payment.status` flipped to `paid`.

### Cordova / device readiness

- Fixed a real crash: `platforms/*/cordova/*.js` are CommonJS, but the
  root `package.json`'s `"type": "module"` made Node try to load them as
  ESM. Fixed with a self-healing `hooks/before_prepare/` script that
  forces CommonJS in every platform folder, so it survives a fresh
  `cordova platform add`.
- Confirmed the existing Cordova scaffold (icons, permissions, plugins,
  `.gitignore`) was already in good shape.

### Google Maps

- Diagnosed and fixed the Maps billing error (linked the correct
  Google Cloud project/billing account, created a properly-scoped API
  key with Maps JavaScript API + Places API + Routes API).
- Map/route failures now show a generic message to users instead of
  internal details ("check Cloud Console"), with the real cause still
  logged to the console for developers.
- Fixed the CSP to allow `*.cloudfunctions.net` (Cloud Functions calls)
  and `blob:` workers (Vite's dev HMR), both of which were silently
  blocked.

### Profile menu — replaced every `alert()` stub

- **Personal Information**: real edit screen, writes to `users/{uid}`.
- **Saved Locations**: new `src/locations.module.js` + Firestore rules
  for a per-user subcollection; add/list/remove all live.
- **Refer & Earn**: real per-user referral codes, linked at signup via
  a new `linkReferral` Cloud Function. Credit/reward payout is
  deliberately deferred (see `BACKLOG.md`) until the business terms are
  decided.
- **Help & Support**: real `mailto:` link (placeholder address for now).
- **Payment Methods**: honest static explanation instead of a fake
  saved-card list — real card tokenization needs a separate PayFast
  API this project doesn't use yet.
- Fixed the Sign Out button, which previously just navigated to the
  splash screen without actually calling Firebase's `signOut()`.

### Other real bugs found and fixed along the way

- `goTo()` never reset scroll position, so revisiting a screen (e.g. the
  booking form) after scrolling down could make fields appear "missing"
  — they were just off-screen.
- The home screen's "Schedule" button called `goTo('schedule')`, but no
  `#schedule` screen exists — a dead button. Pointed it at the existing
  `schedule()` function instead.
- Extras (Champagne, WiFi, etc.) and booking notes were collected in the
  UI but never sent to `createBooking` — now validated server-side and
  stored.

### Infrastructure

- Migrated all Cloud Functions from the `us-central1` default to
  `africa-south1` (Johannesburg) — meaningfully lower latency for
  South African users, and fixed a real payment-page loading problem
  observed on `us-central1`.
- Added `firestore.rules` and `firebase.json` for the security rules
  and Functions region/config that didn't exist before.
- Added `.claude/skills/run-siphika-chauffeur/` — a Playwright-based
  driver skill that can register a test user, book a ride, complete a
  PayFast sandbox payment, and verify Firestore state, so future
  sessions don't have to rebuild this tooling from scratch.
- Added `CLAUDE.md` (corrected: this is plain JavaScript + Cordova +
  Firebase, not React) and `BACKLOG.md` for deferred work.

### Deferred (see `BACKLOG.md` for details)

- TypeScript migration, formal Playwright test suite.
- Actually running the app on a real Android device/emulator (only
  browser-based testing has been done so far).
- Native Google Sign-In on-device; the browser popup flow is also
  currently blocked by CSP.
- iOS build (needs a Mac with Xcode).
- Referral credit payout, real payment-method tokenization.
