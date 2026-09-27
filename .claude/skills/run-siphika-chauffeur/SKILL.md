---
name: run-siphika-chauffeur
description: Build, run, and drive the Siphika Chauffeur web app (the Vite dev server behind its Cordova hybrid shell). Use when asked to start the app, take a screenshot of its UI, register a test user, book a ride, test the PayFast payment flow, or check a booking's status in Firestore.
---

Siphika Chauffeur is a Vite-built web app (also packaged as a Cordova
hybrid app for Android/iOS, but this skill drives it as a plain web
app — the fastest path to a real browser session). Drive it via the
Playwright driver at `.claude/skills/run-siphika-chauffeur/driver.mjs`
— no `chromium-cli` was available in this environment, so this is a
plain Node script instead.

All paths below are relative to the repo root
(`C:\Projects\CV-Projects\siphika-chauffeur`).

## Prerequisites

Windows, no `xvfb` needed — headless Chromium launches directly.

```bash
cd .claude/skills/run-siphika-chauffeur
npm install
```

This installs `playwright` and `firebase-admin` **only inside this
skill directory** — the app itself has no browser-automation
dependency, so these are kept out of the app's own `package.json`.
`npm install` also fetches the Chromium binary into Playwright's
shared cache on first run (works even without a separate
`playwright install` step, but run that explicitly if `npm install`
alone didn't populate the cache).

The app also needs, in the **project root** (not this skill
directory): a working `.env.local` with `VITE_MAPS_KEY` (Google Maps
billing must be enabled on that key — `driver.mjs book-and-pay` draws
a real route and will hang waiting for a fare if this isn't set up),
and the Cloud Functions (`createBooking`, `createPayfastPayment`,
`payfastNotify`, etc.) already deployed with `allUsers` granted the
Cloud Run Invoker role — otherwise every callable function call fails
with what looks like a CORS error in the browser console.

## Run (agent path)

```bash
# From the project root, in the background:
npm run dev &
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'

cd .claude/skills/run-siphika-chauffeur
node driver.mjs smoke              # register a fresh user, reach home, screenshot
node driver.mjs book-and-pay       # full booking + PayFast sandbox payment
node driver.mjs check <bookingId>  # read a booking straight from Firestore
```

Screenshots land in `.claude/skills/run-siphika-chauffeur/shots/`.

`check` needs a service-account key:

```bash
GOOGLE_APPLICATION_CREDENTIALS="C:\Projects\Dev\firebasekey\siphika-chauffeur-5232e-key.json" \
  node driver.mjs check <bookingId>
```

This env var does **not** persist between separate shell/tool
invocations in this environment — set it inline on every `check` call,
don't assume an earlier `export` is still in effect.

Stop the dev server when done. This is Windows, not Linux — `lsof`
doesn't exist here. From Git Bash:

```bash
netstat -ano | grep ":5173" | grep LISTENING   # find the PID in the last column
taskkill //F //PID <pid>
```

Or from PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

(`npm run dev`'s own process doesn't forward signals to the Vite
server it spawns — killing the port's listener is what actually frees
it.)

| command | what it does |
|---|---|
| `smoke` | Register a brand-new account through the real UI, reach the home screen, screenshot each step. |
| `book-and-pay` | Full flow: register, fill in a real pickup/destination, wait for the route + fare to draw, confirm the booking, complete a PayFast sandbox payment, print the booking ref. |
| `check <bookingId>` | Print a booking document straight from Firestore (needs `GOOGLE_APPLICATION_CREDENTIALS`) — the only way to confirm `payment.status` actually flipped to `"paid"`, since nothing in the UI displays it. |

## Run (human path)

```bash
npm run dev   # opens http://localhost:5173 for manual testing. Ctrl-C to stop.
```

## Gotchas

- **Every screen stays in the DOM forever.** `goTo()` in `src/main.js`
  toggles a `.active` class on the current screen rather than
  removing/re-adding screens. An unscoped text selector like
  `button:has-text("Next")` will happily match a **stale, hidden**
  button from a screen you already left — several screens reuse the
  same button text ("Next" appears on three separate onboarding
  screens). Every selector in `driver.mjs` is scoped to `.screen.active`
  for exactly this reason; do the same in any selector you add.
- **No shared test account exists.** The reliable way to get a signed-in
  session is to register a brand-new account through the real UI each
  run (`registerFreshUser()` in the driver) — a fresh, unique email per
  run, since registration creates a real Firebase Auth user + Firestore
  doc every time.
- **Booking the ref by eye from a screenshot is a trap.** `l`/`I`/`1`
  and `O`/`0` look identical in this app's font. Always read
  `[data-bind="booking.ref"]`'s `textContent` via `page.evaluate`
  instead — a hand-transcribed ID sent a Firestore lookup on a wild
  goose chase for several minutes during development of this skill.
- **The "Pay online" checkout popup is not always reliable in a plain
  browser.** Selecting "Pay online" and confirming calls two Cloud
  Functions (`createBooking`, then `createPayfastPayment`) before
  doing `window.open()` on the PayFast checkout URL. Real Chromium's
  popup blocker intermittently blocks that `window.open()` call —
  observed in roughly 2 of 5 runs during development — likely because
  enough time elapsed across the two awaited network round-trips for
  the click to no longer count as a trusted gesture. This is a browser
  quirk of the *plain-web-app* fallback path only; the real Cordova app
  uses `cordova-plugin-inappbrowser` instead, which isn't subject to
  this restriction. `driver.mjs book-and-pay` treats a missing popup as
  non-fatal and continues (the booking itself always succeeds either
  way) — don't "fix" this by making it fatal.
- **A benign console error appears on every fresh page load:**
  `TypeError: google.maps.Map is not a constructor` inside
  `initMapsDirect`, thrown from `bootApp()`'s first `initGoogleMaps()`
  call. This is a startup race between the async Google Maps script tag
  and `bootApp()` running on `DOMContentLoaded`; the map re-initializes
  successfully once you actually navigate to the booking screen. Ignore
  it — it doesn't affect anything downstream.
- **`firebase functions:log --only <name>` fails outright** in this
  environment with a generic `Failed to retrieve log entries from
  Google Cloud` — every time, regardless of which function name was
  passed. Fetching *without* `--only` works fine; redirect the
  (fairly large) unfiltered output to a file and grep it instead:
  ```bash
  npx firebase-tools functions:log --project siphika-chauffeur-5232e > /tmp/fn-logs.txt
  grep -v "google.cloud.audit.AuditLog" /tmp/fn-logs.txt   # drop deploy/IAM audit noise
  ```
  The ITN webhook's own `console.warn`/`console.error` lines (e.g. a
  PayFast signature mismatch) show up clearly once the audit-log noise
  is filtered out.
- **PayFast's ITN webhook is asynchronous.** After clicking "Complete
  Payment" in the sandbox, `payment.status` doesn't flip immediately —
  it took roughly 8–15 seconds in testing for PayFast to POST its ITN
  notification and for `payfastNotify` to process it. `driver.mjs
  book-and-pay` does not wait for this itself; run `check <bookingId>`
  a few seconds after it finishes.

## Troubleshooting

- **Browser console shows a CORS error on a Cloud Function call**
  (e.g. `createBooking`), but the function's code looks fine: check the
  Cloud Run service's IAM permissions, not CORS config. Firebase
  callable/HTTP functions (2nd gen) run on Cloud Run and need `allUsers`
  granted `roles/run.invoker` to be reachable from a browser at all —
  without it, Cloud Run rejects the request before it ever reaches the
  function (visible in `functions:log` as `"The request was not
  authenticated... Empty Authorization header value"`), and the browser
  reports that rejection as a CORS failure since no CORS headers get
  attached to a request Cloud Run blocked outright.
- **A booking's `payment.status` stays `"unpaid"` long after
  completing the sandbox payment:** check the `payfastNotify` logs (see
  the log-fetching Gotcha above) for `"ITN signature mismatch"`. This
  usually means the signature algorithm in `functions/index.js`
  (`pfSignature`) doesn't exactly match what PayFast computed —
  compare field-by-field against the raw ITN body rather than guessing;
  temporarily logging the raw body, the received signature, and the
  locally computed one inside `payfastNotify` (then removing it once
  found) is the fastest way to pin down an exact mismatch.
