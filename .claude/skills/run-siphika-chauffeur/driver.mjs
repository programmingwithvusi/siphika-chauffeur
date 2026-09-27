#!/usr/bin/env node
// Driver for the Siphika Chauffeur web app (Vite dev server + Cordova hybrid
// shell, driven here as a plain web app). Windows-friendly: no xvfb needed.
//
// Usage (run from anywhere; paths below are relative to this file):
//   node driver.mjs smoke                 # register + reach home, screenshot
//   node driver.mjs book-and-pay          # full booking + PayFast sandbox payment
//   node driver.mjs check <bookingId>     # read a booking doc from Firestore
//
// See SKILL.md in this same directory for prerequisites and gotchas.
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(HERE, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

let shotN = 0;
async function shot(page, name) {
  const f = path.join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  console.log('screenshot:', f);
  return f;
}

// This app keeps EVERY screen in the DOM permanently and just toggles a
// `.active` class on the current one via JS (never removes/re-adds screens).
// An unscoped text selector like `button:has-text("Next")` will therefore
// match a STALE button from a screen you already left — several screens
// reuse the same button text ("Next", "Confirm", ...). Every selector here
// is scoped to `.screen.active` for that reason; do the same in any new
// commands you add.
const active = (sel) => `.screen.active ${sel}`;
async function clickActive(page, sel, opts) {
  const s = active(sel);
  await page.waitForSelector(s, { state: 'visible', timeout: 10000 });
  await page.click(s, opts);
}

/** Registers a brand-new account (no shared test credentials exist) and
 * lands on the authenticated home screen. Returns { email, pass }. */
async function registerFreshUser(page) {
  const email = `driver-test-${Date.now()}@example.com`;
  const pass = 'TestPass123!';

  await page.goto(APP_URL);
  await page.waitForSelector('text=SIPHIKA', { timeout: 15000 });
  await shot(page, 'splash');

  await clickActive(page, 'button:has-text("Begin Your Journey")');
  await clickActive(page, 'button:has-text("Next")'); // onboard-1 -> onboard-2
  await clickActive(page, 'button:has-text("Next")'); // onboard-2 -> onboard-3
  await clickActive(page, 'button:has-text("Get Started")'); // -> register
  await page.waitForSelector(active('#reg-name'), { state: 'visible' });
  await shot(page, 'register');

  await page.fill(active('#reg-name'), 'Driver Test');
  await page.fill(active('#reg-email'), email);
  await page.fill(active('#reg-phone'), '+27 71 000 0000');
  await page.fill(active('#reg-pass'), pass);
  console.log('Registering as', email);
  await clickActive(page, 'button:has-text("Create Account")').catch(async () => {
    await clickActive(page, '#register .btn-primary');
  });
  await page.waitForSelector('text=WHERE TO?', { timeout: 15000 });
  await shot(page, 'home');
  return { email, pass };
}

/** Books a one-way ride with a real drawn route (needs Maps billing enabled
 * on the project — see SKILL.md) and lands on the confirm screen. */
async function fillBookingForm(page) {
  await clickActive(page, 'button:has-text("Book Now")');
  await page.waitForSelector(active('#book-pickup'), { state: 'visible', timeout: 10000 });
  await shot(page, 'book-empty');

  // Typing + blurring is enough to draw the route — no need to pick a
  // Places Autocomplete suggestion from the dropdown.
  await page.fill(active('#book-pickup'), 'OR Tambo International Airport, Kempton Park');
  await page.keyboard.press('Escape'); // dismiss the autocomplete dropdown
  await page.fill(active('#book-dest'), 'Sandton City, Sandton');
  await page.keyboard.press('Escape');
  await page.locator(active('.app-topbar, .screen-title')).first().click(); // blur -> fires 'change'

  console.log('Waiting for route to draw...');
  await page.waitForFunction(
    () => document.getElementById('route-fare')?.textContent?.startsWith('R'),
    { timeout: 20000 },
  );
  await shot(page, 'route-drawn');
  console.log('Route fare shown:', await page.textContent('#route-fare'));

  await clickActive(page, 'button:has-text("Confirm Booking")');
  await page.waitForSelector('text=Booking Summary', { timeout: 10000 });
  await shot(page, 'confirm');
}

async function cmdSmoke() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
  try {
    await registerFreshUser(page);
    console.log('DONE_OK');
  } finally {
    await browser.close();
  }
}

async function cmdBookAndPay() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });

  try {
    await registerFreshUser(page);
    await fillBookingForm(page);

    const selectedPayment = await page.evaluate(
      () => document.querySelector('.payment-opt.selected')?.dataset.method,
    );
    console.log('Selected payment method:', selectedPayment); // expect "online"

    // Confirming with "Pay online" selected opens PayFast's checkout via
    // window.open() in a plain browser (Cordova's InAppBrowser is only used
    // on-device). Real Chromium's popup blocker has intermittently blocked
    // this — seen 2 failures out of ~5 runs in testing — apparently because
    // two chained awaited network calls (createBooking, then
    // createPayfastPayment) happen between the click and the window.open()
    // call, which can be enough for the browser to stop treating it as
    // gesture-triggered. This is NOT fatal: the booking itself still
    // succeeds either way. Don't abort the whole run if no popup appears —
    // just skip the payment-completion steps and report it.
    let popup = null;
    try {
      [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 20000 }),
        clickActive(page, 'button:has-text("Confirm & Pay")'),
      ]);
    } catch (e) {
      console.log('NO_POPUP (browser may have blocked window.open):', e.message);
    }

    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 20000 });
      console.log('PayFast checkout URL:', popup.url());
      await popup.waitForTimeout(1500);
      const checkoutShot = path.join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-payfast-checkout.png`);
      await popup.screenshot({ path: checkoutShot });
      console.log('screenshot:', checkoutShot);
    }

    await page.waitForSelector('text=Booking Confirmed', { timeout: 15000 });
    // Read the ref via JS — never transcribe it by eye from a screenshot,
    // l/I/1 and O/0 are too easy to misread.
    const bookingRef = await page.evaluate(
      () => document.querySelector('[data-bind="booking.ref"]')?.textContent || null,
    );
    console.log('BOOKING_REF:', bookingRef);
    await shot(page, 'booked');

    if (popup) {
      console.log('Clicking Complete Payment in the PayFast sandbox popup...');
      await popup.click('button:has-text("Complete Payment")');
      await popup.waitForTimeout(4000);
      const afterShot = path.join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-payfast-after-complete.png`);
      await popup.screenshot({ path: afterShot });
      console.log('screenshot:', afterShot);
      console.log(
        'PayFast page text after completing:',
        (await popup.evaluate(() => document.body.innerText)).slice(0, 400),
      );
      console.log(
        `\nPayFast's ITN webhook lands asynchronously (~8-15s observed).` +
          ` Verify with: node driver.mjs check ${bookingRef}`,
      );
    }
    console.log('DONE_OK');
  } finally {
    await browser.close();
  }
}

/** Reads one booking doc straight from Firestore via the Admin SDK — the
 * only reliable way to confirm the PayFast ITN webhook actually flipped
 * payment.status, since the UI has no visible payment-status indicator. */
async function cmdCheck(bookingId) {
  if (!bookingId) {
    console.error('Usage: node driver.mjs check <bookingId>');
    process.exit(1);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: 'siphika-chauffeur-5232e' });
  const snap = await getFirestore().collection('bookings').doc(bookingId).get();
  console.log(snap.exists ? JSON.stringify(snap.data(), null, 2) : 'NOT_FOUND');
}

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case 'smoke':
    await cmdSmoke();
    break;
  case 'book-and-pay':
    await cmdBookAndPay();
    break;
  case 'check':
    await cmdCheck(arg);
    break;
  default:
    console.log('Usage: node driver.mjs <smoke|book-and-pay|check> [bookingId]');
    process.exit(1);
}
