# Backlog / Future Plans

- ~~Finish the TypeScript migration~~ — done. `functions/` and all of
  `src/` (8 client modules plus `main.ts`) are now TypeScript, strict
  mode, verified via `npm run typecheck` and real Playwright runs.
- Formalize Playwright as the project's test/E2E framework. The
  one-off driver at `.claude/skills/run-siphika-chauffeur/driver.mjs`
  is a working starting point, but isn't a real test suite yet.

## Cordova / Device

- **Blocked, worse than first thought:** the Google Maps API key's
  HTTP referrer allowlist doesn't include `https://localhost` — the
  fixed origin every Cordova WebView runs at — so Maps fails on-device
  with `RefererNotAllowedMapError` (confirmed via logcat, on both the
  emulator and a real device). Fix: add `https://localhost/*` to the
  key's allowed referrers in Google Cloud Console. Beyond just
  blocking route/distance (the "Select a route first" guard), on a
  real device the pickup/destination `<input>` fields became
  completely untappable once Maps failed — taps on them didn't focus
  the field at all, instead jumping the page to the bottom of the
  screen. This points to Google's own Places `Autocomplete` error
  decoration (visually seen as a tiled "Sorry! Something went wrong"
  overlay on top of both inputs) intercepting touches on the
  elements it wraps. Until the referrer is fixed, pickup/destination
  may not be fillable on-device at all, by typing or otherwise —
  not just their route/autocomplete functionality.
- Drive the full booking + payment flow on the emulator/device.
  Confirmed on both the `Pixel_6_Pro_API_34` emulator and a real
  device (Samsung SM-G990E, connected over wireless adb): the app
  boots into the real UI, registration (Firebase Auth + Firestore
  write) and login both work end-to-end, the splash "Sign In" fix
  works, and `confirmBooking()`'s `createBooking` Cloud Function
  round-trip reaches the backend correctly (returned a real
  validation error for a test submission missing pickup/destination).
  Not yet reached on-device: a successfully completed booking, or any
  PayFast payment — both need the Maps referrer fix above first.
- Verify the PayFast checkout flow specifically through
  `cordova-plugin-inappbrowser` on-device. Only the plain-browser
  `window.open()` fallback path (used when `window.cordova` is
  undefined) has been tested. Also blocked by the Maps referrer issue
  above: hourly bookings force cash and skip PayFast entirely (see
  `setTripType()`), so reaching a real online-payment booking
  on-device needs a route, which needs Maps working.
- Build real Google Sign-In support on-device. `doGoogleSignIn()`
  currently just shows "not available in the app yet — use email"
  when running under Cordova, since Firebase's `signInWithPopup`
  doesn't work inside a WebView. Needs a native plugin
  (e.g. `cordova-plugin-googleplus` or Firebase's native Google
  Sign-In SDK via a plugin bridge).
  The browser/dev-testing path is also currently broken: the CSP's
  `script-src` blocks `https://apis.google.com`, which Firebase's
  popup-based Google sign-in needs to load
  (`auth/internal-error` in the console). Fixing that CSP gap is
  lower priority than the native plugin above, since this flow only
  runs in plain-browser testing, not the real Cordova app.
- Remove startup dependence on remote resources: the 3 Unsplash
  onboarding images and the Google Fonts stylesheet delay the page
  load event, and Cordova aborts with "Application Error" if that
  exceeds `LoadUrlTimeoutValue` (now 60s). Bundle them locally.
- Remove the unused `cordova-plugin-file` (nothing in `src/` uses it;
  it adds an `onFileSystemPathsReady` startup step).
- `apis.google.com` CSP refusal also appears in the on-device console
  at startup, not only when clicking Google sign-in.
- iOS build and testing. `config.xml` has iOS platform config, but
  only `android` and `browser` are added under `cordova.platforms` in
  `package.json` — iOS needs a Mac with Xcode, which hasn't been
  available in any session so far.
