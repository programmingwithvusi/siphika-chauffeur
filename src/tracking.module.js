/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Real-Time Firestore Tracking Module
══════════════════════════════════════════════════════════ */
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.config.js';
import { mapState } from './maps.module.js';

let activeTrackingListener = null;
let activeChauffeurMarker = null;
let lastStatus = null;

/**
 * Initializes a real-time Firestore database synchronization channel for an active trip.
 * @param {string} bookingId - The document index identification string within Firestore.
 */
export function startLiveTripSync(bookingId) {
  // Clear any existing active subscription streams first to prevent connection leaks
  if (activeTrackingListener) {
    activeTrackingListener();
    activeTrackingListener = null;
  }

  console.log(`[Siphika Tracking] Synchronizing trip stream: ${bookingId}`);
  lastStatus = null;

  activeTrackingListener = onSnapshot(
    doc(db, 'bookings', bookingId),
    (snapshot) => {
      if (!snapshot.exists()) {
        console.warn('[Siphika Tracking] Active booking document not found.');
        return;
      }

      const tripData = snapshot.data();
      updateLiveTrackingUI(tripData);
    },
    (error) => {
      console.error('[Siphika Tracking] Data stream sync failure:', error);
    },
  );
}

/**
 * Clean up active synchronization loops when exiting the tracking interface view panel.
 */
export function stopLiveTripSync() {
  if (activeTrackingListener) {
    activeTrackingListener();
    activeTrackingListener = null;
    console.log('[Siphika Tracking] Live sync detached safely.');
  }
  if (activeChauffeurMarker) {
    if (typeof activeChauffeurMarker.setMap === 'function')
      activeChauffeurMarker.setMap(null);
    else activeChauffeurMarker.map = null;
    activeChauffeurMarker = null;
  }
}

/**
 * Dynamically re-maps application screens based on background server telemetry variables.
 */
function updateLiveTrackingUI(data) {
  const { status, pickup, destination, distanceKm, fare } = data;
  const { chauffeurName, etaMinutes, vehicleDetails, currentLocation } =
    data.tracking || {};

  const setTrack = (key, text) =>
    document
      .querySelectorAll(`[data-track="${key}"]`)
      .forEach((el) => (el.textContent = text));
  setTrack('pickup', pickup || '—');
  setTrack('destination', destination || '—');
  setTrack(
    'distance',
    distanceKm != null ? `${Number(distanceKm).toFixed(1)} km` : '—',
  );
  setTrack('eta', etaMinutes != null ? `${etaMinutes} min` : '—');
  setTrack(
    'fare',
    fare != null ? `R${Number(fare).toLocaleString()}` : 'Quoted',
  );

  // 1. Text Component Overlays Update
  const etaChip = document.querySelector('.map-eta-chip');
  if (etaChip) {
    etaChip.textContent =
      status === 'arrived'
        ? 'Arriving now!'
        : etaMinutes != null
          ? `${etaMinutes} min away`
          : 'Updating…';
  }

  const nameEl = document.querySelector('.chauffeur-name');
  const vehicleEl = document.querySelector('.chauffeur-car');
  if (nameEl) nameEl.textContent = chauffeurName || 'Assigning chauffeur…';
  if (vehicleEl) vehicleEl.textContent = vehicleDetails || '';

  // 2. Real-Time Physical Vehicle Positioning Map Calculations
  if (currentLocation && mapState.map && mapState.initialized) {
    const newPos = new google.maps.LatLng(
      currentLocation.lat,
      currentLocation.lng,
    );

    if (!activeChauffeurMarker) {
      // Build visual pin node representing the vehicle structure dynamically
      const carPin = document.createElement('div');
      carPin.style.cssText = `
        width: 24px; height: 24px; background: #C9A84C; 
        border: 2px solid #FFF; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size: 12px;
      `;
      carPin.textContent = '🚗';

      if (mapState.AdvancedMarker) {
        activeChauffeurMarker = new mapState.AdvancedMarker({
          position: newPos,
          map: mapState.map,
          content: carPin,
          title: 'Your Chauffeur',
        });
      } else {
        activeChauffeurMarker = new google.maps.Marker({
          position: newPos,
          map: mapState.map,
          title: 'Your Chauffeur',
        });
      }
    } else {
      // Smoothly update location position markers
      if (typeof activeChauffeurMarker.setPosition === 'function') {
        activeChauffeurMarker.setPosition(newPos);
      } else {
        activeChauffeurMarker.position = newPos;
      }
    }

    // Pan map camera framing wrapper to lock focused perspective coordinates cleanly
    mapState.map.panTo(newPos);
  }

  // 3. Fire local toast alert prompts depending on structural context state anomalies
  if (status === 'arrived' && lastStatus !== 'arrived') {
    window.showToast('🚗 Your chauffeur has arrived!');
  }
  lastStatus = status;
}
