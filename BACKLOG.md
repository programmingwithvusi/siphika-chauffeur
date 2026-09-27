# Backlog / Future Plans

- Migrate the codebase to TypeScript (both `src/` and `functions/`),
  including `tsconfig.json` setup and updating the Vite and Cloud
  Functions build steps accordingly.
- Formalize Playwright as the project's test/E2E framework. The
  one-off driver at `.claude/skills/run-siphika-chauffeur/driver.mjs`
  is a working starting point, but isn't a real test suite yet.

## Cordova / Device

- Actually build and run the app on a real Android device or emulator.
  Everything this session was verified in a headless browser via
  Playwright — the app has never been launched through Cordova itself
  (`npm run android` / `npm run device`).
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
- iOS build and testing. `config.xml` has iOS platform config, but
  only `android` and `browser` are added under `cordova.platforms` in
  `package.json` — iOS needs a Mac with Xcode, which hasn't been
  available in any session so far.
