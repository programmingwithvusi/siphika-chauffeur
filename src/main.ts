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

// ─── AMBIENT GLOBALS THIS MODULE OWNS ────────────────────
// Every window.* assignment in the "GLOBAL DELEGATE ROUTER ATTACHMENTS"
// section below needs a matching signature here — main.ts is the only
// module that performs these assignments, so this is the right place to
// declare them. Globals main.ts does NOT assign (window.cordova,
// window.StatusBar, gm_authFailure, navigator.app) live in global.d.ts.
declare global {
  interface Window {
    showToast(message: string): void;
    goTo(id: string): void;
    goBack(): void;
    initMapsDirect(): Promise<void>;
    doRegister(): Promise<void>;
    doLogin(): Promise<void>;
    doGoogleSignIn(): Promise<void>;
    doSignOut(): Promise<void>;
    saveProfile(): Promise<void>;
    addSavedLocation(): Promise<void>;
    shareReferralCode(): Promise<void>;
    selectFleet(el: HTMLElement, name: string): void;
    selectVehicle(el: HTMLElement, name: string): void;
    setTripType(el: HTMLElement, type: string): void;
    confirmBooking(): Promise<void>;
    cancelRide(): Promise<void>;
    selectPayment(el: HTMLElement): void;
    filterRides(el: HTMLElement, status: string): void;
    markAllRead(): void;
    schedule(): void;
    swapLocations(): void;
    drawRoute(): Promise<void>;
    useMyLocation(): void;
    toggleTheme(): void;
  }
}

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

interface VehicleTier {
  base: number;
  perKm: number;
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
  } as Record<string, VehicleTier>,
};

const formatRand = (n: number): string => `R${Number(n).toLocaleString()}`;
const setText = (id: string, text: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};
const setConf = (key: string, text: string) =>
  document
    .querySelectorAll(`[data-conf="${key}"]`)
    .forEach((el) => (el.textContent = text));

// Shared by the confirm-screen preview and the actual booking payload.
function getCheckedExtras(): HTMLInputElement[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>('.extra-toggle input:checked'),
  ];
}

function renderPrices() {
  document.querySelectorAll<HTMLElement>('[data-price]').forEach((el) => {
    const key = el.dataset.price;
    if (!key) return;
    const v = PRICING.vehicles[key];
    if (!v) return;
    const amount = formatRand(v.base);
    el.textContent = el.classList.contains('fleet-price')
      ? `From ${amount}`
      : amount;
  });
}

interface SessionUser {
  name?: string;
  email?: string;
  phone?: string;
  referralCode?: string;
}

interface SelectedVehicle {
  name: string;
  price: number;
}

interface AppState {
  history: string[];
  currentScreen: string;
  selectedVehicle: SelectedVehicle;
  selectedTripType: string;
  paymentMethod: string;
  fareMultiplier: number | null;
  currentFare: number;
  _backPressedOnce: boolean;
  user: SessionUser | null;
  activeBookingRef?: string | null;
}

const state: AppState = {
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
function goTo(id: string) {
  const current = document.getElementById(state.currentScreen);
  const next = document.getElementById(id);
  if (!next || id === state.currentScreen) return;

  current?.classList.add('exit');
  current?.classList.remove('active');

  setTimeout(() => {
    current?.classList.remove('exit');
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

function onScreenEnter(id: string) {
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
    case 'edit-profile': {
      const nameInput = document.getElementById('ep-name') as HTMLInputElement | null;
      const emailInput = document.getElementById('ep-email') as HTMLInputElement | null;
      const phoneInput = document.getElementById('ep-phone') as HTMLInputElement | null;
      if (nameInput) nameInput.value = state.user?.name || '';
      if (emailInput) emailInput.value = state.user?.email || '';
      if (phoneInput) phoneInput.value = state.user?.phone || '';
      break;
    }
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

function selectFleet(el: HTMLElement, name: string) {
  document
    .querySelectorAll('.fleet-card')
    .forEach((c) => c.classList.remove('active-fleet'));
  el.classList.add('active-fleet');
  showToast(`${name} selected`);
}

function selectVehicle(el: HTMLElement, name: string) {
  document
    .querySelectorAll('.vehicle-option')
    .forEach((v) => v.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedVehicle = {
    name,
    price: PRICING.vehicles[name].base,
  };
  updateFareSummary();
  const distanceEl = document.getElementById('route-distance');
  if (mapState.routeDrawn && distanceEl) {
    const activeDistance = parseFloat(distanceEl.textContent ?? '');
    if (!isNaN(activeDistance)) updateFareFromDistance(activeDistance);
  }
}

function setTripType(el: HTMLElement, type: string) {
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
    const cashOpt = document.querySelector<HTMLElement>(
      '.payment-opt[data-method="cash"]',
    );
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
  // fareMultiplier is only ever null while selectedTripType === 'hourly',
  // which already returned above — the ?? 1 just satisfies strict null
  // checking for that invariant.
  const mult = state.fareMultiplier ?? 1;
  const total = Math.round(base * mult) + surcharge;
  setText('fare-base', formatRand(Math.round(base * mult)));
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

function updateFareFromDistance(distKm: number) {
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
  const routeFareEl = document.getElementById('route-fare');
  if (routeFareEl) routeFareEl.textContent = `R${total.toLocaleString()}`;
  const fareTotalEl = document.getElementById('fare-total');
  if (fareTotalEl) fareTotalEl.textContent = `R${total.toLocaleString()}`;

  setText('fare-base', formatRand(Math.round(tripFare * mult)));
  setText('fare-surcharge', formatRand(surcharge));
}

window.addEventListener('siphika:route-updated', (e) => {
  const detail = (e as CustomEvent<{ distance?: number }>).detail;
  if (detail?.distance) updateFareFromDistance(detail.distance);
});

// Ride cards ask to track a booking; main owns navigation and state.
window.addEventListener('siphika:track-booking', (e) => {
  state.activeBookingRef = (e as CustomEvent<{ id: string }>).detail.id;
  goTo('tracking');
});

function setDefaultDateTime() {
  const dateInput = document.getElementById('book-date') as HTMLInputElement | null;
  if (dateInput && !dateInput.value)
    dateInput.value = new Date().toISOString().split('T')[0];
}

function updateConfirmDetails() {
  const dateEl = document.getElementById('conf-dt');
  if (!dateEl) return;
  const dateInputEl = document.getElementById('book-date') as HTMLInputElement | null;
  const timeInputEl = document.getElementById('book-time') as HTMLInputElement | null;
  const date = dateInputEl?.value || new Date().toISOString().split('T')[0];
  const time = timeInputEl?.value || '08:00';
  const formatted =
    new Date(date + 'T' + time).toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) +
    ', ' +
    time;
  dateEl.textContent = formatted;

  const val = (id: string): string => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    return input?.value.trim() || '—';
  };
  setConf('pickup', val('book-pickup'));
  setConf('destination', val('book-dest'));
  setConf('vehicle', state.selectedVehicle.name);
  const extras = getCheckedExtras().map(
    (cb) => cb.nextElementSibling?.textContent?.trim() ?? '',
  );
  setConf('extras', extras.length ? extras.join(', ') : 'None');
  setConf(
    'total',
    state.selectedTripType === 'hourly'
      ? 'Quoted on assignment'
      : formatRand(state.currentFare),
  );

  const confirmBtn = document.querySelector<HTMLElement>('#confirm .btn-primary');
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
      if ((err as { name?: string }).name === 'AbortError') return; // user cancelled the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Referral message copied');
  } catch {
    showToast(`Your code: ${code}`);
  }
}

interface PayfastPaymentResult {
  url: string;
}

async function launchPayfastCheckout(bookingId: string) {
  let url: string;
  try {
    const { data } = await createPayfastPaymentFn({ bookingId });
    url = (data as PayfastPaymentResult).url;
  } catch (err) {
    console.error('[Siphika Payment] createPayfastPayment failed:', err);
    showToast('Could not start payment — you can pay later from Rides');
    return;
  }

  const inAppBrowser = window.cordova?.InAppBrowser;
  if (inAppBrowser) {
    await new Promise<void>((resolve) => {
      const ref = inAppBrowser.open(url, '_blank', 'location=yes,toolbar=yes');
      const finish = () => {
        ref.removeEventListener('loadstart', onLoadStart);
        ref.removeEventListener('exit', finish);
        resolve();
      };
      const onLoadStart = (event: CordovaInAppBrowserEvent) => {
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

interface CreateBookingResult {
  bookingId: string;
  fare: number;
}

async function confirmBooking() {
  if (!auth.currentUser) return showToast('Please sign in to book');
  const isHourly = state.selectedTripType === 'hourly';
  const distanceEl = document.getElementById('route-distance');
  const distanceKm = parseFloat(distanceEl?.textContent ?? '');
  if (!isHourly && !(distanceKm > 0)) return showToast('Select a route first');

  const btn = document.querySelector<HTMLButtonElement>('#confirm .btn-primary');
  if (btn) {
    btn.textContent = 'Processing...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

  try {
    const pickupInput = document.getElementById('book-pickup') as HTMLInputElement | null;
    const destInput = document.getElementById('book-dest') as HTMLInputElement | null;
    const dateInput = document.getElementById('book-date') as HTMLInputElement | null;
    const timeInput = document.getElementById('book-time') as HTMLInputElement | null;
    const notesInput = document.getElementById('book-notes') as HTMLInputElement | null;

    const { data } = await createBookingFn({
      pickup: pickupInput?.value ?? '',
      destination: destInput?.value ?? '',
      date: dateInput?.value ?? '',
      time: timeInput?.value ?? '',
      tripType: state.selectedTripType,
      vehicle: state.selectedVehicle.name,
      distanceKm: isHourly ? null : distanceKm,
      extras: getCheckedExtras().map((cb) => cb.dataset.extra),
      notes: notesInput?.value.trim() ?? '',
    });
    const result = data as CreateBookingResult;
    state.activeBookingRef = result.bookingId;
    state.currentFare = result.fare;
    document
      .querySelectorAll('[data-bind="booking.ref"]')
      .forEach((el) => (el.textContent = result.bookingId));
    if (state.paymentMethod === 'online' && !isHourly) {
      if (btn) btn.textContent = 'Redirecting to secure payment…';
      await launchPayfastCheckout(result.bookingId);
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
      (err as { code?: string }).code === 'functions/failed-precondition'
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

function selectPayment(el: HTMLElement) {
  document
    .querySelectorAll('.payment-opt')
    .forEach((p) => p.classList.remove('selected'));
  el.classList.add('selected');
  state.paymentMethod = el.dataset.method ?? state.paymentMethod;
}

function filterRides(el: HTMLElement, status: string) {
  document
    .querySelectorAll('.filter-tab')
    .forEach((t) => t.classList.remove('active-tab'));
  el.classList.add('active-tab');

  document.querySelectorAll<HTMLElement>('.history-card').forEach((card) => {
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
  const badge = document.querySelector<HTMLElement>('.notif-badge');
  if (badge) badge.style.display = 'none';
  showToast('All notifications marked as read');
}

function schedule() {
  goTo('book');
  setTimeout(() => {
    document.getElementById('book-date')?.focus();
  }, 400);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string) {
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

  document
    .querySelectorAll<HTMLInputElement>('.extra-toggle input')
    .forEach((cb) => {
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
    window.StatusBar.styleBlackTranslucent();
    window.StatusBar.backgroundColorByHexString('#0A0A0C');
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
