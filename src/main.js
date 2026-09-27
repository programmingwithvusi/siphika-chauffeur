/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Master Main Core Orchestrator
══════════════════════════════════════════════════════════ */

import { startLiveTripSync, stopLiveTripSync } from './tracking.module.js';
import {
  initGoogleMaps,
  drawRoute,
  swapLocations,
  useMyLocation,
  initMapsDirect,
  mapState,
} from './maps.module.js';
import {
  doRegister,
  doLogin,
  doGoogleSignIn,
  doSignOut,
  saveProfile,
  listenToAuth,
} from './auth.module.js';
import { initTheme, toggleTheme } from './theme.module.js';
import { initRides } from './rides.module.js';
import { initSavedLocations, addSavedLocation } from './locations.module.js';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase.config.js';

const createBookingFn = httpsCallable(functions, 'createBooking');
const cancelBookingFn = httpsCallable(functions, 'cancelBooking');
const createPayfastPaymentFn = httpsCallable(functions, 'createPayfastPayment');

// Dynamically load cordova.js ONLY if running on an actual mobile hybrid device container platform
if (
  window.location.protocol === 'file:' ||
  navigator.userAgent.match(/(iPhone|iPod|iPad|Android|BlackBerry|IEMobile)/)
) {
  const cordovaScript = document.createElement('script');
  cordovaScript.src = 'cordova.js';
  document.head.appendChild(cordovaScript);
}
// Pricing config: single source of truth. Move to Firestore later without touching UI logic.
const PRICING = {
  surcharge: 80,
  returnMultiplier: 1.8,
  hourlyRate: 350,
  vehicles: {
    'Executive Sedan': { base: 450, perKm: 14 },
    'Business Class': { base: 680, perKm: 20 },
    'Luxury SUV': { base: 950, perKm: 28 },
    'Stretch Limousine': { base: 1800, perKm: 55 },
  },
};

const formatRand = (n) => `R${Number(n).toLocaleString()}`;
const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};
const setConf = (key, text) =>
  document
    .querySelectorAll(`[data-conf="${key}"]`)
    .forEach((el) => (el.textContent = text));

// Shared by the confirm-screen preview and the actual booking payload.
function getCheckedExtras() {
  return [...document.querySelectorAll('.extra-toggle input:checked')];
}

function renderPrices() {
  document.querySelectorAll('[data-price]').forEach((el) => {
    const v = PRICING.vehicles[el.dataset.price];
    if (!v) return;
    const amount = formatRand(v.base);
    el.textContent = el.classList.contains('fleet-price')
      ? `From ${amount}`
      : amount;
  });
}

const state = {
  history: ['splash'],
  currentScreen: 'splash',
  selectedVehicle: {
    name: 'Executive Sedan',
    price: PRICING.vehicles['Executive Sedan'].base,
  },
  selectedTripType: 'one-way',
  paymentMethod: 'online', // 'online' | 'cash' — matches the default-selected option in index.html
  fareMultiplier: 1,
  currentFare: 0,
  _backPressedOnce: false,
  user: null,
};

// ─── TRANSITIONAL VIEW MANAGER ───────────────────────────
function goTo(id) {
  const current = document.getElementById(state.currentScreen);
  const next = document.getElementById(id);
  if (!next || id === state.currentScreen) return;

  current.classList.add('exit');
  current.classList.remove('active');

  setTimeout(() => {
    current.classList.remove('exit');
    next.classList.add('active');
    next.scrollTop = 0;
    next
      .querySelectorAll('[class*="-scroll"]')
      .forEach((el) => (el.scrollTop = 0));
    state.history.push(id);
    state.currentScreen = id;
    onScreenEnter(id);
  }, 280);
}

function goBack() {
  if (state.history.length <= 1) return;
  state.history.pop();
  const prev = state.history[state.history.length - 1];
  goTo(prev);
  setTimeout(() => {
    state.history.pop();
  }, 300);
}

function onScreenEnter(id) {
  // Tear down live monitoring context if transitioning out of active tracking layouts
  if (id !== 'tracking') {
    stopLiveTripSync();
  }

  switch (id) {
    case 'home':
      updateGreeting();
      break;
    case 'confirm':
      updateConfirmDetails();
      break;
    case 'edit-profile':
      document.getElementById('ep-name').value = state.user?.name || '';
      document.getElementById('ep-email').value = state.user?.email || '';
      document.getElementById('ep-phone').value = state.user?.phone || '';
      break;
    case 'refer': {
      const code =
        state.user?.referralCode ||
        auth.currentUser?.uid.slice(0, 8).toUpperCase() ||
        '—';
      document
        .querySelectorAll('[data-bind="referral.code"]')
        .forEach((el) => (el.textContent = code));
      break;
    }
    case 'tracking':
      // Start real-time sync only for a real booking created in confirmBooking()
      if (!state.activeBookingRef) {
        showToast('No active booking to track');
        break;
      }
      startLiveTripSync(state.activeBookingRef);
      break;
    case 'book':
      setDefaultDateTime();
      if (mapState.initialized) {
        drawRoute();
      } else {
        initGoogleMaps();
      }
      break;
    case 'booked':
      triggerSuccessAnimation();
      break;
  }
}

// ─── INTERACTION & FARE CALCULATION MECHANICS ────────────
function updateGreeting() {
  const hour = new Date().getHours();
  const greetEl = document.querySelector('.greeting');
  if (!greetEl) return;
  if (hour < 12) greetEl.textContent = 'Good morning,';
  else if (hour < 17) greetEl.textContent = 'Good afternoon,';
  else greetEl.textContent = 'Good evening,';
}

function selectFleet(el, name) {
  document
    .querySelectorAll('.fleet-card')
    .forEach((c) => c.classList.remove('active-fleet'));
  el.classList.add('active-fleet');
  showToast(`${name} selected`);
}

function selectVehicle(el, name) {
  document
    .querySelectorAll('.vehicle-option')
    .forEach((v) => v.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedVehicle = {
    name,
    price: PRICING.vehicles[name].base,
  };
  updateFareSummary();
  if (mapState.routeDrawn && document.getElementById('route-distance')) {
    const activeDistance = parseFloat(
      document.getElementById('route-distance').textContent,
    );
    if (!isNaN(activeDistance)) updateFareFromDistance(activeDistance);
  }
}

function setTripType(el, type) {
  document
    .querySelectorAll('.trip-type')
    .forEach((t) => t.classList.remove('active-type'));
  el.classList.add('active-type');
  state.selectedTripType = type;

  if (type === 'return') {
    state.fareMultiplier = PRICING.returnMultiplier;
    showToast('Return trip: 80% off second leg');
  } else if (type === 'hourly') {
    state.fareMultiplier = null;
    showToast(`Hourly rate: R${PRICING.hourlyRate}/hr minimum 2hr`);
    const cashOpt = document.querySelector('.payment-opt[data-method="cash"]');
    if (cashOpt) selectPayment(cashOpt);
  } else {
    state.fareMultiplier = 1;
  }
  updateFareSummary();
}

function updateFareSummary() {
  if (state.selectedTripType === 'hourly') {
    const totalEl = document.getElementById('fare-total');
    if (totalEl) totalEl.textContent = 'Hourly Rate Appears';
    return;
  }
  const base = state.selectedVehicle.price;
  const surcharge = PRICING.surcharge;
  let total = Math.round(base * state.fareMultiplier) + surcharge;
  setText('fare-base', formatRand(Math.round(base * state.fareMultiplier)));
  setText('fare-surcharge', formatRand(surcharge));

  const totalEl = document.getElementById('fare-total');
  if (totalEl) {
    totalEl.textContent = `R${total.toLocaleString()}`;
    totalEl.style.color = 'var(--gold)';
    totalEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.12)', color: '#E8C96B' },
        { transform: 'scale(1)' },
      ],
      { duration: 300 },
    );
  }
  state.currentFare = total;
}

function updateFareFromDistance(distKm) {
  const vehicleName = state.selectedVehicle?.name || 'Executive Sedan';
  const vehicle =
    PRICING.vehicles[vehicleName] ?? PRICING.vehicles['Executive Sedan'];
  const base = vehicle.base;
  const distanceFare = Math.round(distKm * vehicle.perKm);
  const surcharge = PRICING.surcharge;
  const tripFare = Math.max(base, distanceFare);
  const mult =
    state.selectedTripType === 'return' ? PRICING.returnMultiplier : 1;
  const total = Math.round(tripFare * mult) + surcharge;

  state.currentFare = total;
  document.getElementById('route-fare').textContent =
    `R${total.toLocaleString()}`;
  document.getElementById('fare-total').textContent =
    `R${total.toLocaleString()}`;

  setText('fare-base', formatRand(Math.round(tripFare * mult)));
  setText('fare-surcharge', formatRand(surcharge));
}

window.addEventListener('siphika:route-updated', (e) => {
  if (e.detail && e.detail.distance) updateFareFromDistance(e.detail.distance);
});

// Ride cards ask to track a booking; main owns navigation and state.
window.addEventListener('siphika:track-booking', (e) => {
  state.activeBookingRef = e.detail.id;
  goTo('tracking');
});

function setDefaultDateTime() {
  const dateInput = document.getElementById('book-date');
  if (dateInput && !dateInput.value)
    dateInput.value = new Date().toISOString().split('T')[0];
}

function updateConfirmDetails() {
  const dateEl = document.getElementById('conf-dt');
  if (!dateEl) return;
  const date =
    document.getElementById('book-date')?.value ||
    new Date().toISOString().split('T')[0];
  const time = document.getElementById('book-time')?.value || '08:00';
  const formatted =
    new Date(date + 'T' + time).toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) +
    ', ' +
    time;
  dateEl.textContent = formatted;

  const val = (id) => document.getElementById(id)?.value.trim() || '—';
  setConf('pickup', val('book-pickup'));
  setConf('destination', val('book-dest'));
  setConf('vehicle', state.selectedVehicle.name);
  const extras = getCheckedExtras().map((cb) =>
    cb.nextElementSibling.textContent.trim(),
  );
  setConf('extras', extras.length ? extras.join(', ') : 'None');
  setConf(
    'total',
    state.selectedTripType === 'hourly'
      ? 'Quoted on assignment'
      : formatRand(state.currentFare),
  );

  const confirmBtn = document.querySelector('#confirm .btn-primary');
  if (confirmBtn && state.currentFare)
    confirmBtn.textContent = `Confirm & Pay R${state.currentFare.toLocaleString()}`;
}

async function shareReferralCode() {
  const code =
    document.querySelector('[data-bind="referral.code"]')?.textContent || '';
  const text = `Join me on Siphika Chauffeur! Use my referral code ${code} when you sign up.`;
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Referral message copied');
  } catch {
    showToast(`Your code: ${code}`);
  }
}

async function launchPayfastCheckout(bookingId) {
  let url;
  try {
    const { data } = await createPayfastPaymentFn({ bookingId });
    url = data.url;
  } catch (err) {
    console.error('[Siphika Payment] createPayfastPayment failed:', err);
    showToast('Could not start payment — you can pay later from Rides');
    return;
  }

  if (window.cordova?.InAppBrowser) {
    await new Promise((resolve) => {
      const ref = cordova.InAppBrowser.open(
        url,
        '_blank',
        'location=yes,toolbar=yes',
      );
      const finish = () => {
        ref.removeEventListener('loadstart', onLoadStart);
        ref.removeEventListener('exit', finish);
        resolve();
      };
      const onLoadStart = (event) => {
        if (/\/(paymentReturn|paymentCancel)\b/.test(event.url || ''))
          ref.close();
      };
      ref.addEventListener('loadstart', onLoadStart);
      ref.addEventListener('exit', finish);
    });
    showToast('Payment submitted — confirming…');
  } else {
    // Browser dev fallback: no InAppBrowser here. Final status still arrives
    // via the Firestore listener regardless of how the tab is closed.
    window.open(url, '_blank');
    showToast('Complete payment in the new tab — status updates automatically');
  }
}

async function confirmBooking() {
  if (!auth.currentUser) return showToast('Please sign in to book');
  const isHourly = state.selectedTripType === 'hourly';
  const distanceKm = parseFloat(
    document.getElementById('route-distance')?.textContent,
  );
  if (!isHourly && !(distanceKm > 0)) return showToast('Select a route first');

  const btn = document.querySelector('#confirm .btn-primary');
  if (btn) {
    btn.textContent = 'Processing...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

  try {
    const { data } = await createBookingFn({
      pickup: document.getElementById('book-pickup')?.value ?? '',
      destination: document.getElementById('book-dest')?.value ?? '',
      date: document.getElementById('book-date')?.value ?? '',
      time: document.getElementById('book-time')?.value ?? '',
      tripType: state.selectedTripType,
      vehicle: state.selectedVehicle.name,
      distanceKm: isHourly ? null : distanceKm,
      extras: getCheckedExtras().map((cb) => cb.dataset.extra),
      notes: document.getElementById('book-notes')?.value.trim() ?? '',
    });
    state.activeBookingRef = data.bookingId;
    state.currentFare = data.fare;
    document
      .querySelectorAll('[data-bind="booking.ref"]')
      .forEach((el) => (el.textContent = data.bookingId));
    if (state.paymentMethod === 'online' && !isHourly) {
      if (btn) btn.textContent = 'Redirecting to secure payment…';
      await launchPayfastCheckout(data.bookingId);
    }
    goTo('booked');
  } catch (err) {
    console.error('[Siphika Booking] create failed:', err);
    showToast('Booking failed. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      updateConfirmDetails();
    }
  }
}

async function cancelRide() {
  if (!state.activeBookingRef) return showToast('No active booking to cancel');
  if (!window.confirm('Cancel this ride?')) return;
  try {
    await cancelBookingFn({ bookingId: state.activeBookingRef });
    state.activeBookingRef = null;
    showToast('Ride cancelled');
    goTo('home');
  } catch (err) {
    console.error('[Siphika Booking] cancel failed:', err);
    showToast(
      err.code === 'functions/failed-precondition'
        ? 'This ride can no longer be cancelled'
        : 'Could not cancel. Please try again.',
    );
  }
}

function triggerSuccessAnimation() {
  const icon = document.querySelector('.success-icon');
  if (!icon) return;
  icon.animate(
    [
      { transform: 'scale(0)', opacity: 0 },
      { transform: 'scale(1.15)', opacity: 1 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 500, easing: 'cubic-bezier(0.34,1.56,0.64,1)' },
  );
}

function selectPayment(el) {
  document
    .querySelectorAll('.payment-opt')
    .forEach((p) => p.classList.remove('selected'));
  el.classList.add('selected');
  state.paymentMethod = el.dataset.method;
}

function filterRides(el, status) {
  document
    .querySelectorAll('.filter-tab')
    .forEach((t) => t.classList.remove('active-tab'));
  el.classList.add('active-tab');

  document.querySelectorAll('.history-card').forEach((card) => {
    if (status === 'all') {
      card.style.display = 'flex';
    } else {
      const cardStatus = card.dataset.status;
      const match =
        (status === 'upcoming' && cardStatus === 'in-progress') ||
        (status === 'completed' && cardStatus === 'completed') ||
        (status === 'cancelled' && cardStatus === 'cancelled');
      card.style.display = match ? 'flex' : 'none';
    }
    if (card.style.display !== 'none') {
      card.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 220, fill: 'forwards' },
      );
    }
  });
}

function markAllRead() {
  document.querySelectorAll('.notif-item.unread').forEach((n) => {
    n.classList.remove('unread');
    const dot = n.querySelector('.notif-dot');
    if (dot) dot.remove();
  });
  const badge = document.querySelector('.notif-badge');
  if (badge) badge.style.display = 'none';
  showToast('All notifications marked as read');
}

function schedule() {
  goTo('book');
  setTimeout(() => {
    document.getElementById('book-date')?.focus();
  }, 400);
}

let toastTimer = null;
export function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
window.showToast = showToast;

// ─── LIFECYCLE PLATFORM BOOTSTRAP ───────────────────────
function bootApp() {
  initTheme();
  renderPrices();
  initRides();
  initSavedLocations();
  setDefaultDateTime();
  updateGreeting();

  document.querySelectorAll('.extra-toggle input').forEach((cb) => {
    cb.addEventListener('change', () => updateFareSummary());
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.animate(
            [
              { opacity: 0, transform: 'translateY(16px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 360, fill: 'forwards', easing: 'ease-out' },
          );
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 },
  );
  document
    .querySelectorAll(
      '.hero-card, .fleet-card, .ride-card, .history-card, .vehicle-option, .book-step, .promo-banner',
    )
    .forEach((el) => observer.observe(el));

  if (window.StatusBar) {
    StatusBar.styleBlackTranslucent();
    StatusBar.backgroundColorByHexString('#0A0A0C');
  }

  document.addEventListener(
    'backbutton',
    (e) => {
      e.preventDefault();
      if (
        state.history.length <= 1 ||
        ['home', 'onboard-1', 'onboard-2', 'onboard-3'].includes(
          state.currentScreen,
        )
      ) {
        if (state._backPressedOnce) {
          if (navigator.app) navigator.app.exitApp();
        } else {
          state._backPressedOnce = true;
          showToast('Press back again to exit');
          setTimeout(() => {
            state._backPressedOnce = false;
          }, 2000);
        }
      } else {
        goBack();
      }
    },
    false,
  );
  initGoogleMaps();
  listenToAuth((profile) => {
    state.user = profile;
  });
}
if (window.cordova) document.addEventListener('deviceready', bootApp, false);
else document.addEventListener('DOMContentLoaded', bootApp);
// Swiping gestures
let touchStartX = 0,
  touchStartY = 0;
document.addEventListener(
  'touchstart',
  (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dx > 0) {
      if (document.querySelector(`#${state.currentScreen} .back-btn`)) goBack();
    }
  },
  { passive: true },
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (state.currentScreen === 'register') doRegister();
    else if (state.currentScreen === 'login') doLogin();
  }
});

// ─── GLOBAL DELEGATE ROUTER ATTACHMENTS ──────────────────
window.initMapsDirect = initMapsDirect;
window.goTo = goTo;
window.goBack = goBack;
window.doRegister = doRegister;
window.doLogin = doLogin;
window.doGoogleSignIn = doGoogleSignIn;
window.doSignOut = doSignOut;
window.saveProfile = saveProfile;
window.addSavedLocation = addSavedLocation;
window.shareReferralCode = shareReferralCode;
window.selectFleet = selectFleet;
window.selectVehicle = selectVehicle;
window.setTripType = setTripType;
window.confirmBooking = confirmBooking;
window.cancelRide = cancelRide;
window.selectPayment = selectPayment;
window.filterRides = filterRides;
window.markAllRead = markAllRead;
window.schedule = schedule;
window.swapLocations = swapLocations;
window.drawRoute = drawRoute;
window.useMyLocation = useMyLocation;
window.toggleTheme = toggleTheme;
