# Backlog / Future Plans

- Finish the TypeScript migration: `functions/` is done; the client
  modules in `src/` (plus `tsconfig.json` and the Vite build step)
  remain, smallest first, `main.js` last.
- Formalize Playwright as the project's test/E2E framework. The
  one-off driver at `.claude/skills/run-siphika-chauffeur/driver.mjs`
  is a working starting point, but isn't a real test suite yet.

## Cordova / Device

- Drive the full booking + payment flow on the emulator/device. The
  app builds and boots on the `Pixel_6_Pro_API_34` emulator (splash
  renders, `deviceready` fires), but only that boot has been checked
  on-device; everything else was verified in a browser via Playwright.
- Verify the PayFast checkout flow specifically through
  `cordova-plugin-inappbrowser` on-device. Only the plain-browser
  `window.open()` fallback path (used when `window.cordova` is
  undefined) has been tested.
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
