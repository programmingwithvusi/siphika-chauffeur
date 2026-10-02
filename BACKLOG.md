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
- ~~Build real Google Sign-In support on-device~~ — done, via
  `cordova-plugin-google-signin` (`cordova-plugin-googleplus`, the
  originally-planned option, has been archived/dead since 2023).
  Needed a real `google-services.json` at the project root (gitignored,
  copied into `platforms/android/app/` on every prepare by the new
  `hooks/before_prepare/020-copy-google-services.cjs` hook — the
  plugin applies Google's Gradle plugin, which hard-requires that
  file and has no way to place it itself), the debug keystore's SHA-1
  registered against the `za.co.siphika.chauffeur` app specifically
  (a stale `com.siphika.sihphikachauffeur` app already existed in the
  same Firebase project and had to be told apart from the real one),
  and two local patches to the plugin itself (installed from a git
  clone, not npm, since it's not published there): its JS wrapper
  never parses the JSON string Cordova's bridge delivers, and its
  native Android code routed the sign-in through a second, separate
  native FirebaseAuth session and hands back *that* session's Firebase
  ID token — not the raw Google ID token this app's JS/web Firebase
  SDK needs for `signInWithCredential()`. Verified signed in on the
  real device, landing on Home with the real Google profile name
  and photo initials.
  The browser/dev-testing path is still broken separately: the CSP's
  `script-src` blocks `https://apis.google.com`, which Firebase's
  popup-based Google sign-in needs to load
  (`auth/internal-error` in the console). Low priority — it only
  affects plain-browser dev testing, not the real Cordova app, which
  now has its own working native path above.
- Remove startup dependence on remote resources: the 3 Unsplash
  onboarding images and the Google Fonts stylesheet delay the page
  load event, and Cordova aborts with "Application Error" if that
  exceeds `LoadUrlTimeoutValue` (now 60s). Bundle them locally.
- Remove the unused `cordova-plugin-file` (nothing in `src/` uses it;
  it adds an `onFileSystemPathsReady` startup step).
- iOS build and testing. `config.xml` has iOS platform config, but
  only `android` and `browser` are added under `cordova.platforms` in
  `package.json` — iOS needs a Mac with Xcode, which hasn't been
  available in any session so far.
