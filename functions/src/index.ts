import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createHash } from 'crypto';
import { onInit } from 'firebase-functions/v2/core';
import { initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

// Closer to South Africa than the us-central1 default — cuts round-trip
// latency for every callable/HTTP function below.
setGlobalOptions({ region: 'africa-south1' });

// Deferred: this must NOT run at module load time. getFirestore() needs to
// auto-detect project/credentials, which stalls for many seconds outside a
// real GCP runtime and blows the 10s deploy-discovery timeout. onInit()
// runs on first actual invocation in Cloud Run instead, where that
// detection is instant.
let db: Firestore;
onInit(() => {
  initializeApp();
  db = getFirestore();
});

// Authoritative pricing. Keep in sync with PRICING in src/main.js (display only).
const PRICING: {
  surcharge: number;
  returnMultiplier: number;
  vehicles: Record<string, { base: number; perKm: number }>;
} = {
  surcharge: 80,
  returnMultiplier: 1.8,
  vehicles: {
    'Executive Sedan': { base: 450, perKm: 14 },
    'Business Class': { base: 680, perKm: 20 },
    'Luxury SUV': { base: 950, perKm: 28 },
    'Stretch Limousine': { base: 1800, perKm: 55 },
  },
};
const TRIP_TYPES = ['one-way', 'return', 'hourly'] as const;
type TripType = (typeof TRIP_TYPES)[number];
const isTripType = (v: unknown): v is TripType =>
  TRIP_TYPES.includes(v as TripType);
const KNOWN_EXTRAS: readonly string[] = [
  'Champagne',
  'Flowers',
  'WiFi',
  'Newspaper',
  'Cold Drinks',
  'Music',
];

function resolveExtras(data: { extras?: unknown }): string[] {
  if (data.extras == null) return [];
  if (!Array.isArray(data.extras))
    throw new HttpsError('invalid-argument', 'Invalid extras.');
  return [
    ...new Set<string>(data.extras.filter((e) => KNOWN_EXTRAS.includes(e))),
  ];
}
// Statuses a customer may cancel from. Later statuses (chauffeur assigned, arrived,
// completed) need a cancellation-fee policy first.
const CANCELLABLE: readonly string[] = ['pending', 'confirmed'];

// TODO(maps-billing): once Maps billing is on, compute this server-side with the
// Routes API from pickup/destination instead of trusting the client value.
function resolveDistanceKm(data: { distanceKm?: unknown }): number {
  const km = Number(data.distanceKm);
  if (!Number.isFinite(km) || km <= 0 || km > 2000) {
    throw new HttpsError('invalid-argument', 'Valid route distance required.');
  }
  return km;
}

function computeFare(
  vehicle: string,
  tripType: TripType,
  distanceKm: number | null,
): number | null {
  if (tripType === 'hourly' || distanceKm == null) return null; // hourly is quoted later
  const v = PRICING.vehicles[vehicle];
  const trip = Math.max(v.base, Math.round(distanceKm * v.perKm));
  const mult = tripType === 'return' ? PRICING.returnMultiplier : 1;
  return Math.round(trip * mult) + PRICING.surcharge;
}

const str = (v: unknown, max = 200): string | null =>
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

function payfastHost(): string {
  return PAYFAST_SANDBOX.value() === 'false'
    ? 'www.payfast.co.za'
    : 'sandbox.payfast.co.za';
}

// PayFast requires '+' for spaces (not %20), and its PHP backend's
// urlencode() escapes a few characters JS's encodeURIComponent leaves
// raw (! ~ * ' ( )) — without this, any field containing one of those
// (e.g. a resolved address like "Airport (JNB)") breaks the signature.
function pfEncode(v: string): string {
  return encodeURIComponent(v)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Field order here follows PayFast's own documented table (merchant details,
// then buyer details, then transaction details) — NOT alphabetical. This is
// the one detail I couldn't fully verify from official docs; if PayFast
// rejects the signature during sandbox testing, this order is the first
// thing to recheck.
function pfSignature(
  fields: Record<string, unknown>,
  passphrase?: string,
): string {
  const pairs = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${pfEncode(String(v))}`);
  if (passphrase) pairs.push(`passphrase=${pfEncode(passphrase)}`);
  return createHash('md5').update(pairs.join('&')).digest('hex');
}

interface CreateBookingData {
  pickup?: unknown;
  destination?: unknown;
  date?: unknown;
  time?: unknown;
  tripType?: unknown;
  vehicle?: unknown;
  distanceKm?: unknown;
  extras?: unknown;
  notes?: unknown;
}

export const createBooking = onCall(async (request) => {
  if (!request.auth)
    throw new HttpsError('unauthenticated', 'Sign in to book.');
  const d: CreateBookingData = request.data || {};
  const pickup = str(d.pickup);
  const destination = str(d.destination);
  const date = str(d.date, 10);
  const time = str(d.time, 5);
  if (!pickup || !destination || !date || !time)
    throw new HttpsError('invalid-argument', 'Missing booking details.');
  if (
    !isTripType(d.tripType) ||
    typeof d.vehicle !== 'string' ||
    !PRICING.vehicles[d.vehicle]
  )
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

export const cancelBooking = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  const bookingId = str(request.data?.bookingId, 128);
  if (!bookingId) throw new HttpsError('invalid-argument', 'Missing booking.');

  const ref = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const booking = snap.data();
    // Same error for "missing" and "not yours" so IDs can't be probed.
    if (!booking || booking.userId !== uid)
      throw new HttpsError('not-found', 'Booking not found.');
    if (!CANCELLABLE.includes(booking.status))
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

export const linkReferral = onCall(async (request) => {
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

export const createPayfastPayment = onCall(
  { secrets: [PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE] },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Sign in first.');
    const bookingId = str(request.data?.bookingId, 128);
    if (!bookingId)
      throw new HttpsError('invalid-argument', 'Missing booking.');

    const bookingRef = db.collection('bookings').doc(bookingId);
    const booking = (await bookingRef.get()).data();
    if (!booking || booking.userId !== request.auth.uid)
      throw new HttpsError('not-found', 'Booking not found.');
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
    const userData = userSnap.data() ?? {};
    const [nameFirst, ...rest] = (userData.name || 'Guest').trim().split(/\s+/);

    const fields: Record<string, string> = {
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

export const payfastNotify = onRequest(
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
        res.status(200).send('OK');
        return;
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
        res.status(200).send('OK');
        return;
      }

      const bookingRef = db.collection('bookings').doc(body.m_payment_id || '');
      const booking = (await bookingRef.get()).data();
      if (!booking) {
        console.warn(
          '[Siphika PayFast] ITN for unknown booking:',
          body.m_payment_id,
        );
        res.status(200).send('OK');
        return;
      }

      const expectedAmount = Number(booking.fare);
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
function simplePage(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:40px"><p>${message}</p><p>You can close this window.</p></body></html>`;
}
export const paymentReturn = onRequest((_req, res) => {
  res.status(200).send(simplePage('Payment received — confirming…'));
});
export const paymentCancel = onRequest((_req, res) => {
  res.status(200).send(simplePage('Payment cancelled.'));
});
