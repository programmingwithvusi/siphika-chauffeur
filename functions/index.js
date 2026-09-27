const {
  onCall,
  onRequest,
  HttpsError,
} = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const crypto = require('crypto');
const { onInit } = require('firebase-functions/v2/core');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Closer to South Africa than the us-central1 default — cuts round-trip
// latency for every callable/HTTP function below.
setGlobalOptions({ region: 'africa-south1' });

// Deferred: this must NOT run at module load time. getFirestore() needs to
// auto-detect project/credentials, which stalls for many seconds outside a
// real GCP runtime and blows the 10s deploy-discovery timeout. onInit()
// runs on first actual invocation in Cloud Run instead, where that
// detection is instant.
let db;
onInit(() => {
  initializeApp();
  db = getFirestore();
});

// Authoritative pricing. Keep in sync with PRICING in src/main.js (display only).
const PRICING = {
  surcharge: 80,
  returnMultiplier: 1.8,
  vehicles: {
    'Executive Sedan': { base: 450, perKm: 14 },
    'Business Class': { base: 680, perKm: 20 },
    'Luxury SUV': { base: 950, perKm: 28 },
    'Stretch Limousine': { base: 1800, perKm: 55 },
  },
};
const TRIP_TYPES = ['one-way', 'return', 'hourly'];
const KNOWN_EXTRAS = [
  'Champagne',
  'Flowers',
  'WiFi',
  'Newspaper',
  'Cold Drinks',
  'Music',
];

function resolveExtras(data) {
  if (data.extras == null) return [];
  if (!Array.isArray(data.extras))
    throw new HttpsError('invalid-argument', 'Invalid extras.');
  return [...new Set(data.extras.filter((e) => KNOWN_EXTRAS.includes(e)))];
}
// Statuses a customer may cancel from. Later statuses (chauffeur assigned, arrived,
// completed) need a cancellation-fee policy first.
const CANCELLABLE = ['pending', 'confirmed'];

// TODO(maps-billing): once Maps billing is on, compute this server-side with the
// Routes API from pickup/destination instead of trusting the client value.
function resolveDistanceKm(data) {
  const km = Number(data.distanceKm);
  if (!Number.isFinite(km) || km <= 0 || km > 2000) {
    throw new HttpsError('invalid-argument', 'Valid route distance required.');
  }
  return km;
}

function computeFare(vehicle, tripType, distanceKm) {
  if (tripType === 'hourly') return null; // hourly is quoted later
  const v = PRICING.vehicles[vehicle];
  const trip = Math.max(v.base, Math.round(distanceKm * v.perKm));
  const mult = tripType === 'return' ? PRICING.returnMultiplier : 1;
  return Math.round(trip * mult) + PRICING.surcharge;
}

const str = (v, max = 200) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

// ─── PayFast ────────────────────────────────────────────────────────────
// Merchant credentials are Functions secrets, never hardcoded. Set them with:
//   firebase functions:secrets:set PAYFAST_MERCHANT_ID
//   firebase functions:secrets:set PAYFAST_MERCHANT_KEY
//   firebase functions:secrets:set PAYFAST_PASSPHRASE
// Register a free sandbox merchant account at sandbox.payfast.co.za/register
// to get sandbox values for the first two before testing.
const PAYFAST_MERCHANT_ID = defineSecret('PAYFAST_MERCHANT_ID');
const PAYFAST_MERCHANT_KEY = defineSecret('PAYFAST_MERCHANT_KEY');
const PAYFAST_PASSPHRASE = defineSecret('PAYFAST_PASSPHRASE');
const PAYFAST_SANDBOX = defineString('PAYFAST_SANDBOX', { default: 'true' });
// Must match this project's actual deployed Functions region if that ever changes.
const RETURN_BASE =
  'https://africa-south1-siphika-chauffeur-5232e.cloudfunctions.net';

function payfastHost() {
  return PAYFAST_SANDBOX.value() === 'false'
    ? 'www.payfast.co.za'
    : 'sandbox.payfast.co.za';
}

// PayFast requires '+' for spaces (not %20).
function pfEncode(v) {
  return encodeURIComponent(v).replace(/%20/g, '+');
}

// Field order here follows PayFast's own documented table (merchant details,
// then buyer details, then transaction details) — NOT alphabetical. This is
// the one detail I couldn't fully verify from official docs; if PayFast
// rejects the signature during sandbox testing, this order is the first
// thing to recheck.
function pfSignature(fields, passphrase) {
  const pairs = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${pfEncode(String(v))}`);
  if (passphrase) pairs.push(`passphrase=${pfEncode(passphrase)}`);
  return crypto.createHash('md5').update(pairs.join('&')).digest('hex');
}

exports.createBooking = onCall(async (request) => {
  if (!request.auth)
    throw new HttpsError('unauthenticated', 'Sign in to book.');
  const d = request.data || {};
  const pickup = str(d.pickup);
  const destination = str(d.destination);
  const date = str(d.date, 10);
  const time = str(d.time, 5);
  if (!pickup || !destination || !date || !time)
    throw new HttpsError('invalid-argument', 'Missing booking details.');
  if (!TRIP_TYPES.includes(d.tripType) || !PRICING.vehicles[d.vehicle])
    throw new HttpsError('invalid-argument', 'Invalid trip type or vehicle.');

  const distanceKm = d.tripType === 'hourly' ? null : resolveDistanceKm(d);
  const fare = computeFare(d.vehicle, d.tripType, distanceKm);
  const extras = resolveExtras(d);
  const notes = str(d.notes, 500) || '';

  const ref = await db.collection('bookings').add({
    userId: request.auth.uid,
    status: 'pending',
    pickup,
    destination,
    date,
    time,
    tripType: d.tripType,
    vehicle: d.vehicle,
    distanceKm,
    fare,
    extras,
    notes,
    payment: { status: 'unpaid' }, // TODO: payment gateway
    createdAt: FieldValue.serverTimestamp(),
  });
  return { bookingId: ref.id, fare };
});

exports.cancelBooking = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const bookingId = str(request.data?.bookingId, 128);
  if (!bookingId) throw new HttpsError('invalid-argument', 'Missing booking.');

  const ref = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Same error for "missing" and "not yours" so IDs can't be probed.
    if (!snap.exists || snap.data().userId !== request.auth.uid)
      throw new HttpsError('not-found', 'Booking not found.');
    if (!CANCELLABLE.includes(snap.data().status))
      throw new HttpsError(
        'failed-precondition',
        'This booking can no longer be cancelled.',
      );
    // TODO: refund/void payment here once a payment gateway exists.
    tx.update(ref, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

exports.linkReferral = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const code = str(request.data?.code, 32);
  if (!code) return { linked: false };

  const q = await db
    .collection('users')
    .where('referralCode', '==', code)
    .limit(1)
    .get();
  if (q.empty) return { linked: false };

  const referrerId = q.docs[0].id;
  if (referrerId === request.auth.uid) return { linked: false }; // can't refer yourself

  // TODO: award referral credit here once the business terms are decided
  // (amount, whether it's on signup or the friend's first completed ride,
  // and how a credit actually reduces a fare — nothing in the fare model
  // supports discounts yet).
  await db.collection('users').doc(request.auth.uid).update({ referredBy: referrerId });
  return { linked: true };
});

exports.createPayfastPayment = onCall(
  { secrets: [PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE] },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Sign in first.');
    const bookingId = str(request.data?.bookingId, 128);
    if (!bookingId)
      throw new HttpsError('invalid-argument', 'Missing booking.');

    const bookingRef = db.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists || snap.data().userId !== request.auth.uid)
      throw new HttpsError('not-found', 'Booking not found.');
    const booking = snap.data();
    if (booking.payment?.status === 'paid')
      throw new HttpsError(
        'failed-precondition',
        'This booking is already paid.',
      );
    if (booking.fare == null)
      throw new HttpsError(
        'failed-precondition',
        'This booking needs a quote before payment.',
      );

    // Fare comes from our own stored booking, never from the client —
    // this is what stops someone paying whatever amount they choose.
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const [nameFirst, ...rest] = (userData.name || 'Guest').trim().split(/\s+/);

    const fields = {
      merchant_id: PAYFAST_MERCHANT_ID.value(),
      merchant_key: PAYFAST_MERCHANT_KEY.value(),
      return_url: `${RETURN_BASE}/paymentReturn`,
      cancel_url: `${RETURN_BASE}/paymentCancel`,
      notify_url: `${RETURN_BASE}/payfastNotify`,
      name_first: nameFirst,
      name_last: rest.join(' '),
      email_address: userData.email || '',
      m_payment_id: bookingId,
      amount: Number(booking.fare).toFixed(2),
      item_name: `Siphika Chauffeur — ${booking.vehicle}`,
      item_description: `${booking.pickup} to ${booking.destination}`,
    };
    fields.signature = pfSignature(fields, PAYFAST_PASSPHRASE.value());

    const query = Object.entries(fields)
      .map(([k, v]) => `${k}=${pfEncode(String(v))}`)
      .join('&');
    return { url: `https://${payfastHost()}/eng/process?${query}` };
  },
);

exports.payfastNotify = onRequest(
  { secrets: [PAYFAST_PASSPHRASE] },
  async (req, res) => {
    try {
      const body = req.body || {};
      const received = body.signature;
      const check = { ...body };
      delete check.signature;
      const expected = pfSignature(check, PAYFAST_PASSPHRASE.value());

      if (received !== expected) {
        console.warn('[Siphika PayFast] ITN signature mismatch — ignoring.');
        return res.status(200).send('OK');
      }

      // Never trust ITN on signature match alone — confirm with PayFast directly.
      const confirm = await fetch(
        `https://${payfastHost()}/eng/query/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        },
      );
      if ((await confirm.text()).trim() !== 'VALID') {
        console.warn('[Siphika PayFast] ITN failed PayFast validation.');
        return res.status(200).send('OK');
      }

      const bookingRef = db.collection('bookings').doc(body.m_payment_id || '');
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        console.warn(
          '[Siphika PayFast] ITN for unknown booking:',
          body.m_payment_id,
        );
        return res.status(200).send('OK');
      }

      const expectedAmount = Number(bookingSnap.data().fare);
      const paidAmount = parseFloat(body.amount_gross);
      const amountOk = Math.abs(paidAmount - expectedAmount) < 0.01;

      if (body.payment_status === 'COMPLETE' && amountOk) {
        await bookingRef.update({
          'payment.status': 'paid',
          'payment.pfPaymentId': body.pf_payment_id || null,
          'payment.confirmedAt': FieldValue.serverTimestamp(),
        });
      } else {
        console.warn(
          '[Siphika PayFast] Not COMPLETE or amount mismatch:',
          body.payment_status,
          paidAmount,
          expectedAmount,
        );
        await bookingRef.update({
          'payment.lastItnStatus': body.payment_status || 'unknown',
        });
      }
      res.status(200).send('OK');
    } catch (err) {
      console.error('[Siphika PayFast] ITN handler error:', err);
      res.status(500).send('ERROR'); // let PayFast retry on our own failures
    }
  },
);

// Minimal pages the InAppBrowser briefly shows before main.js closes it.
function simplePage(message) {
  return `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:40px"><p>${message}</p><p>You can close this window.</p></body></html>`;
}
exports.paymentReturn = onRequest((req, res) =>
  res.status(200).send(simplePage('Payment received — confirming…')),
);
exports.paymentCancel = onRequest((req, res) =>
  res.status(200).send(simplePage('Payment cancelled.')),
);
