/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Firestore sample-data seeder

   Usage:   npm run seed -- --uid <Firebase Auth UID>
   Needs:   GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key
            JSON (Firebase Console → Project settings → Service accounts).
            Keep that key OUTSIDE the repo — it has full admin access.

   Writes two bookings shaped exactly like functions/src/index.ts's
   createBooking output, so the app's own screens (tracking, ride history)
   render them without any special-casing for test data:
     - seed-active-ride: status 'confirmed', with a live tracking snapshot.
       Flip status to 'arrived' in the console to test the arrival toast.
     - seed-completed-ride: status 'completed', plus a matching review.

   Chauffeur/vehicle detail is denormalized straight into the booking's
   `tracking` field, same as the real app does — there are no separate
   drivers/ or vehicles/ collections, since firestore.rules blocks client
   access to both and nothing in the app reads them.

   Safe to re-run: fixed doc IDs are overwritten, not duplicated.
   `users` is not seeded; the app creates it at registration.
══════════════════════════════════════════════════════════ */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'siphika-chauffeur-5232e';

function getUid() {
  const i = process.argv.indexOf('--uid');
  const uid = i !== -1 ? process.argv[i + 1] : undefined;
  if (!uid || uid.startsWith('--')) {
    console.error(
      'Missing --uid. Usage: npm run seed -- --uid <Firebase Auth UID>\n' +
        'Find it in Firebase Console → Authentication → Users.',
    );
    process.exit(1);
  }
  return uid;
}

async function main() {
  const uid = getUid();
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at your ' +
        'service-account key JSON (stored outside the repo).',
    );
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();

  // Active ride: confirmed, chauffeur en route.
  // Fare = max(base, distanceKm * perKm) + surcharge for Executive Sedan
  // (450 base, 14/km) over 32.4 km: max(450, 454) + 80 = 534.
  batch.set(db.doc('bookings/seed-active-ride'), {
    userId: uid,
    status: 'confirmed', // pending | confirmed | arrived | completed | cancelled
    pickup: 'OR Tambo International Airport, Kempton Park',
    destination: 'Sandton City, Sandton',
    date: '2026-09-23',
    time: '08:00',
    tripType: 'one-way',
    vehicle: 'Executive Sedan',
    distanceKm: 32.4,
    fare: 534,
    payment: { status: 'paid' },
    tracking: {
      chauffeurName: 'James Mokoena',
      vehicleDetails: 'Mercedes E220 · GP 123-456',
      etaMinutes: 6,
      currentLocation: { lat: -26.1952, lng: 28.034 },
    },
    createdAt: now,
  });

  // Completed ride, so the review below is legitimate.
  // Fare for Business Class (680 base, 20/km) over 12 km:
  // max(680, 240) + 80 = 760.
  batch.set(db.doc('bookings/seed-completed-ride'), {
    userId: uid,
    status: 'completed',
    pickup: 'Sandton City, Sandton',
    destination: 'Rosebank, Johannesburg',
    date: '2026-09-20',
    time: '18:15',
    tripType: 'one-way',
    vehicle: 'Business Class',
    distanceKm: 12,
    fare: 760,
    payment: { status: 'paid' },
    createdAt: now,
  });

  batch.set(db.doc('reviews/seed-review-001'), {
    bookingId: 'seed-completed-ride',
    userId: uid,
    rating: 5,
    comment: 'Punctual and professional.',
    createdAt: now,
  });

  await batch.commit();
  console.log(
    'Seeded bookings/seed-active-ride, bookings/seed-completed-ride, ' +
      'reviews/seed-review-001',
  );
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
