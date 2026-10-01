# Backlog / Future Plans

- ~~Finish the TypeScript migration~~ — done. `functions/` and all of
  `src/` (8 client modules plus `main.ts`) are now TypeScript, strict
  mode, verified via `npm run typecheck` and real Playwright runs.
- Formalize Playwright as the project's test/E2E framework. The
  one-off driver at `.claude/skills/run-siphika-chauffeur/driver.mjs`
  is a working starting point, but isn't a real test suite yet.

## Cordova / Device

- ~~Maps referrer blocking on-device bookings~~ — fixed by adding
  `https://localhost/*` to the Maps API key's allowed referrers in
  Google Cloud Console. Confirmed on the real device: Places
  Autocomplete, the interactive map, and real Routes API fares all
  work correctly now, and the pickup/destination inputs are fillable
  again.
- ~~Drive the full booking + payment flow on the emulator/device~~ —
  done, on both the `Pixel_6_Pro_API_34` emulator and a real device
  (Samsung SM-G990E, connected over wireless adb): registration,
  login, the splash "Sign In" fix, a real non-hourly booking with a
  real resolved route/fare, and a full PayFast payment through
  `cordova-plugin-inappbrowser` (see below) all verified end-to-end.
- ~~Verify the PayFast checkout flow through
  `cordova-plugin-inappbrowser`~~ — done, and it surfaced a real bug:
  `pfEncode` used JS's `encodeURIComponent`, which leaves `! ~ * ' ( )`
  unescaped, while PayFast's PHP backend's `urlencode()` escapes all
  of those — so any field containing one (e.g. a real resolved
  address like "Airport (JNB)") broke the outgoing signature with a
  400 from PayFast. Fixed in `functions/src/index.ts` and redeployed;
  confirmed on-device with the exact address that triggered it,
  payment completed and the ITN webhook marked it `paid`.
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
