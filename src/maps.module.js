import { getMapStyle } from './theme.module.js';

// showToast — defined in main.js, exposed on window for cross-module use
// We use window.showToast to avoid a circular import (main → maps → main)
const showToast = (msg) => window.showToast?.(msg);

// ─── GOOGLE MAPS STATE ───────────────────────────────────
export const mapState = {
  map: null,
  routesClient: null, // Routes API v2 client
  routePolyline: null, // google.maps.Polyline for the drawn route
  AdvancedMarker: null, // AdvancedMarkerElement constructor ref
  pickupAutocomplete: null,
  destAutocomplete: null,
  initialized: false,
  routeDrawn: false,
  unavailable: false, // true once Google rejects the key or billing is off
  _markerA: null, // gold pickup marker
  _markerB: null, // white destination marker
};

// Google calls this global when the key is rejected or billing isn't enabled.
window.gm_authFailure = () => {
  mapState.unavailable = true;
  showMapError('gm_authFailure: invalid key or billing not enabled');
};

/**
 * initGoogleMaps — called from bootApp() after deviceready.
 *
 * Three fixes applied here:
 *
 * Fix 1 — importLibrary not a function:
 *   google.maps.importLibrary() requires the bootstrap loader. When the
 *   script tag pre-loads libraries via `libraries=places,routes,marker`,
 *   importLibrary may not be wired up. Solution: use the bootstrap loader
 *   (no `libraries=` param on the script tag) and call importLibrary()
 *   to load each library on demand. The script tag only sets the API key.
 *
 * Fix 2 — styles vs mapId conflict:
 *   `mapId` and `styles` are mutually exclusive. mapId delegates styling
 *   to Cloud Console; styles uses local JSON. We need local dark/light
 *   theme switching → remove mapId, keep styles.
 *   AdvancedMarkerElement works without mapId using DEMO_MAP_ID fallback.
 *
 * Fix 3 — RoutesClient is not a constructor:
 *   RoutesClient is a Node.js server-side class (from @googlemaps/routing).
 *   It does not exist in the browser Maps JS API. The routes library in the
 *   browser only adds the google.maps.routes namespace for type definitions.
 *   Actual route requests go via fetch() to the REST endpoint.
 */

export async function initGoogleMaps() {
  const mapEl = document.getElementById('booking-map');
  if (!mapEl) return;

  // Wait for google.maps to be available (script tag may still be loading)
  if (typeof google === 'undefined' || !google.maps) {
    console.warn(
      '[Siphika] Google Maps not loaded — check API key and script tag',
    );
    return;
  }

  // importLibrary requires the bootstrap loader pattern.
  // If not available (old script tag format), fall back gracefully.
  if (typeof google.maps.importLibrary !== 'function') {
    console.warn(
      '[Siphika] importLibrary not available — check script tag uses bootstrap loader (no libraries= param)',
    );
    // Try direct instantiation as fallback
    try {
      await initMapsDirect();
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    // Load libraries via importLibrary (bootstrap loader pattern)
    // Do NOT load 'routes' — it has no usable browser classes;
    // route requests go via fetch() to routes.googleapis.com directly.
    // 'marker' is still loaded: it defines the legacy google.maps.Marker.
    const [mapsLib, placesLib] = await Promise.all([
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('places'),
      google.maps.importLibrary('marker'),
    ]);

    // ── Map ──────────────────────────────────────────────
    // NOTE: mapId and styles are mutually exclusive.
    // We use styles (local JSON) so dark/light theme switching works.
    mapState.map = new mapsLib.Map(mapEl, {
      center: { lat: -26.2041, lng: 28.0473 },
      zoom: 11,
      styles: getMapStyle(), // local dark or light theme
      disableDefaultUI: true,
      gestureHandling: 'cooperative',
      zoomControl: true,
      // mapId intentionally omitted — conflicts with styles property
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER,
      },
    });

    // ── Polyline for the route drawn from Routes API response ──
    mapState.routePolyline = new google.maps.Polyline({
      map: mapState.map,
      strokeColor: '#C9A84C',
      strokeWeight: 4,
      strokeOpacity: 0.9,
    });

    // AdvancedMarkerElement needs a mapId, which disables local `styles`
    // (dark/light theme). Keep it null so legacy google.maps.Marker is used.
    mapState.AdvancedMarker = null;

    // ── Autocomplete ──────────────────────────────────────
    const pickupInput = document.getElementById('book-pickup');
    const destInput = document.getElementById('book-dest');

    const acOptions = {
      componentRestrictions: { country: 'za' },
      fields: ['formatted_address', 'geometry', 'name'],
      strictBounds: false,
    };

    mapState.pickupAutocomplete = new placesLib.Autocomplete(
      pickupInput,
      acOptions,
    );
    mapState.destAutocomplete = new placesLib.Autocomplete(
      destInput,
      acOptions,
    );

    mapState.pickupAutocomplete.addListener('place_changed', () => drawRoute());
    mapState.destAutocomplete.addListener('place_changed', () => drawRoute());

    pickupInput.addEventListener('change', debounce(drawRoute, 600));
    destInput.addEventListener('change', debounce(drawRoute, 600));

    mapState.initialized = true;
    drawRoute();
  } catch (err) {
    console.error('[Siphika] Google Maps failed to initialise:', err);
    showMapError(err?.message || 'init failed');
  }
}

/** Fallback initialisation for when importLibrary is unavailable */
export async function initMapsDirect() {
  const mapEl = document.getElementById('booking-map');
  mapState.map = new google.maps.Map(mapEl, {
    center: { lat: -26.2041, lng: 28.0473 },
    zoom: 11,
    styles: getMapStyle(),
    disableDefaultUI: true,
    gestureHandling: 'cooperative',
  });
  mapState.routePolyline = new google.maps.Polyline({
    map: mapState.map,
    strokeColor: '#C9A84C',
    strokeWeight: 4,
    strokeOpacity: 0.9,
  });
  const pickupInput = document.getElementById('book-pickup');
  const destInput = document.getElementById('book-dest');
  const acOptions = { componentRestrictions: { country: 'za' } };
  mapState.pickupAutocomplete = new google.maps.places.Autocomplete(
    pickupInput,
    acOptions,
  );
  mapState.destAutocomplete = new google.maps.places.Autocomplete(
    destInput,
    acOptions,
  );
  mapState.pickupAutocomplete.addListener('place_changed', () => drawRoute());
  mapState.destAutocomplete.addListener('place_changed', () => drawRoute());
  mapState.AdvancedMarker = null; // fall back to legacy Marker
  mapState.initialized = true;
  drawRoute();
}

function showMapError(reason) {
  console.error(
    `[Siphika] Map unavailable (${reason}). Dev: check billing, key restrictions, and that Maps JS + Routes APIs are enabled.`,
  );
  const placeholder = document.getElementById('map-placeholder-msg');
  if (!placeholder) return;
  placeholder.classList.remove('hidden');
  placeholder.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
         stroke="var(--gold)" stroke-width="1.4">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
    <p>Map unavailable<br/>
       <small>Please try again later</small></p>`;
}

/**
 * drawRoute — calls the Routes API (New) to draw a driving route.
 *
 * Routes API replaces the legacy Directions API.
 * Uses the REST endpoint via fetch() — avoids the JS client
 * library dependency and works identically in browser and Cordova WebView.
 *
 * Required in Google Cloud Console:
 *   ✅ Routes API  (NOT "Directions API" — that is the legacy one)
 *
 * Field mask controls billing — we only request what we need:
 *   routes.duration, routes.distanceMeters, routes.polyline.encodedPolyline
 */
export async function drawRoute() {
  const pickup = document.getElementById('book-pickup')?.value.trim();
  const dest = document.getElementById('book-dest')?.value.trim();

  if (!pickup || !dest) return;
  if (!mapState.initialized) return;
  if (!mapState.routePolyline) return;

  showMapLoading(true);
  hideRouteError();

  // Extract the API key from the Maps script src
  const apiKey = getApiKey();
  if (!apiKey || apiKey === 'MISSING_KEY') {
    showMapLoading(false);
    showRouteError('NO_KEY');
    return;
  }

  try {
    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          // Field mask — only request what we need (controls billing)
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,' +
            'routes.polyline.encodedPolyline,' +
            'routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify({
          origin: {
            address: pickup,
          },
          destination: {
            address: dest,
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          computeAlternativeRoutes: false,
          languageCode: 'en-ZA',
          regionCode: 'ZA',
          units: 'METRIC',
        }),
      },
    );

    showMapLoading(false);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('[Siphika] Routes API error:', JSON.stringify(errBody));
      const msg = errBody?.error?.message || '';
      showRouteError(
        /billing/i.test(msg)
          ? 'BILLING_DISABLED'
          : errBody?.error?.status || 'HTTP_' + response.status,
      );
      return;
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      showRouteError('ZERO_RESULTS');
      return;
    }

    const route = data.routes[0];
    const leg = route.legs?.[0];
    const distMeters = route.distanceMeters; // e.g. 32400
    const distKm = distMeters / 1000; // e.g. 32.4
    const distText = distKm.toFixed(1) + ' km';
    const durSec = parseInt(route.duration); // seconds
    const durText =
      durSec >= 3600
        ? Math.floor(durSec / 3600) +
          'h ' +
          Math.round((durSec % 3600) / 60) +
          ' min'
        : Math.round(durSec / 60) + ' mins';

    // ── Decode and draw the polyline ─────────────────────
    const encoded = route.polyline.encodedPolyline;
    const path = decodePolyline(encoded);
    mapState.routePolyline.setPath(path);

    // Fit map bounds to the route
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    mapState.map.fitBounds(bounds, {
      top: 60,
      right: 30,
      bottom: 20,
      left: 30,
    });

    // ── Custom gold markers ───────────────────────────────
    if (leg) {
      const startLat = leg.startLocation?.latLng?.latitude;
      const startLng = leg.startLocation?.latLng?.longitude;
      const endLat = leg.endLocation?.latLng?.latitude;
      const endLng = leg.endLocation?.latLng?.longitude;

      if (startLat && endLat) {
        placeCustomMarkers(
          { lat: startLat, lng: startLng },
          { lat: endLat, lng: endLng },
          pickup,
          dest,
        );
      }
    }

    // ── Route info bar ────────────────────────────────────
    document.getElementById('map-placeholder-msg')?.classList.add('hidden');
    document.getElementById('route-distance').textContent = distText;
    document.getElementById('route-duration').textContent = durText;
    document.getElementById('route-info').classList.remove('hidden');
    mapState.routeDrawn = true;

    // ── Live fare from real distance ──────────────────────
    window.dispatchEvent(
      new CustomEvent('siphika:route-updated', { detail: { distance: distKm } }),
    );
  } catch (err) {
    showMapLoading(false);
    console.error('[Siphika] drawRoute error:', err);
    showRouteError('NETWORK_ERROR');
  }
}

/**
 * Place gold pickup (A) and white destination (B) markers.
 * Uses AdvancedMarkerElement (new) — Marker is deprecated.
 */
function placeCustomMarkers(startPos, endPos, startTitle, endTitle) {
  // Remove old markers cleanly (AdvancedMarker uses .map = null, legacy uses .setMap(null))
  if (mapState._markerA) {
    if (typeof mapState._markerA.setMap === 'function')
      mapState._markerA.setMap(null);
    else mapState._markerA.map = null;
  }
  if (mapState._markerB) {
    if (typeof mapState._markerB.setMap === 'function')
      mapState._markerB.setMap(null);
    else mapState._markerB.map = null;
  }

  const AdvancedMarker = mapState.AdvancedMarker;

  if (AdvancedMarker) {
    // ── AdvancedMarkerElement (new API) ───────────────────
    const pinA = document.createElement('div');
    pinA.style.cssText = `width:18px;height:18px;border-radius:50%;
      background:#C9A84C;border:2.5px solid #0A0A0C;
      box-shadow:0 2px 8px rgba(201,168,76,0.6);`;

    mapState._markerA = new AdvancedMarker({
      position: startPos,
      map: mapState.map,
      title: startTitle,
      content: pinA,
    });

    const pinB = document.createElement('div');
    pinB.style.cssText = `width:18px;height:18px;border-radius:50%;
      background:#F0EDE4;border:2.5px solid #C9A84C;
      box-shadow:0 2px 8px rgba(201,168,76,0.4);`;

    mapState._markerB = new AdvancedMarker({
      position: endPos,
      map: mapState.map,
      title: endTitle,
      content: pinB,
    });
  } else {
    // ── Legacy Marker fallback ────────────────────────────
    const sym = (color, stroke) => ({
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: stroke,
      strokeWeight: 2.5,
    });

    mapState._markerA = new google.maps.Marker({
      position: startPos,
      map: mapState.map,
      icon: sym('#C9A84C', '#0A0A0C'),
      title: startTitle,
      zIndex: 10,
    });
    mapState._markerB = new google.maps.Marker({
      position: endPos,
      map: mapState.map,
      icon: sym('#F0EDE4', '#C9A84C'),
      title: endTitle,
      zIndex: 10,
    });
  }
}

/**
 * Decode a Google encoded polyline string into an array of LatLng objects.
 * Implements the standard polyline encoding algorithm.
 * Avoids importing the geometry library for a single utility function.
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0,
    lat = 0,
    lng = 0;

  while (index < encoded.length) {
    let shift = 0,
      result = 0,
      byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push(new google.maps.LatLng(lat / 1e5, lng / 1e5));
  }
  return points;
}

/** Extract the API key from the Maps script src at runtime */
function getApiKey() {
  const scripts = document.querySelectorAll(
    'script[src*="maps.googleapis.com"]',
  );
  for (const s of scripts) {
    const match = s.src.match(/[?&]key=([^&]+)/);
    if (match) return match[1];
  }
  return null;
}

// ── Map UI helpers ──────────────────────────────────────
function showMapLoading(show) {
  let spinner = document.getElementById('map-spinner-overlay');
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.id = 'map-spinner-overlay';
    spinner.className = 'map-loading';
    spinner.innerHTML = '<div class="map-spinner"></div>';
    document.getElementById('booking-map')?.appendChild(spinner);
  }
  spinner.classList.toggle('hidden', !show);
}

function showRouteError(status) {
  const el = document.getElementById('route-error');
  if (!el) return;
  el.classList.remove('hidden');
  const msgs = {
    // Routes API v2 status codes
    NOT_FOUND: 'One or both addresses could not be found.',
    ZERO_RESULTS: 'No driving route found between these locations.',
    INVALID_ARGUMENT: 'Invalid address — please check pickup and destination.',
    RESOURCE_EXHAUSTED: 'API quota exceeded — please try again shortly.',
    BILLING_DISABLED:
      'Route pricing is temporarily unavailable. Please try again later.',
    PERMISSION_DENIED: 'Route service is temporarily unavailable.',
    UNAUTHENTICATED: 'Route service is temporarily unavailable.',
    NETWORK_ERROR: 'Network error — check your internet connection.',
    // Extra guards
    NO_KEY: 'Route service is temporarily unavailable.',
    HTTP_403: 'Route service is temporarily unavailable.',
    HTTP_400: 'Bad request — check pickup and destination addresses.',
  };
  console.warn('[Siphika] Route error:', status);
  const icon = document.createElement('span');
  icon.textContent = '⚠️';
  el.replaceChildren(icon, ` ${msgs[status] || 'Could not calculate route.'}`);
}

function hideRouteError() {
  document.getElementById('route-error')?.classList.add('hidden');
}

/** Swap pickup ↔ destination then redraw */
export function swapLocations() {
  const p = document.getElementById('book-pickup');
  const d = document.getElementById('book-dest');
  if (!p || !d) return;
  const tmp = p.value;
  p.value = d.value;
  d.value = tmp;
  showToast('Locations swapped');
  drawRoute();
}

// ─── GEOLOCATION: USE MY LOCATION ────────────────────────
// Called by the "Use my location" button on the booking map.
// Uses cordova-plugin-geolocation (falls back to browser API).
export function useMyLocation() {
  const btn = document.getElementById('geolocate-btn');
  if (btn) {
    btn.textContent = '📡';
    btn.disabled = true;
  }

  const success = (position) => {
    const { latitude, longitude } = position.coords;
    if (btn) {
      btn.textContent = '📍';
      btn.disabled = false;
    }

    // Reverse-geocode using Google Maps Geocoder
    if (window.google?.maps) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode(
        { location: { lat: latitude, lng: longitude } },
        (results, status) => {
          if (status === 'OK' && results[0]) {
            const addr = results[0].formatted_address;
            const pickupInput = document.getElementById('book-pickup');
            if (pickupInput) {
              pickupInput.value = addr;
              drawRoute();
              showToast('📍 Location set');
            }
          } else {
            showToast('Could not resolve address');
          }
        },
      );
    } else {
      // Maps not loaded yet — just fill coordinates
      const pickupInput = document.getElementById('book-pickup');
      if (pickupInput)
        pickupInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };

  const error = (err) => {
    if (btn) {
      btn.textContent = '📍';
      btn.disabled = false;
    }
    const msgs = {
      1: 'Location permission denied',
      2: 'Location unavailable',
      3: 'Location request timed out',
    };
    showToast(msgs[err.code] || 'Could not get location');
  };

  const opts = { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 };

  // cordova-plugin-geolocation exposes the same API as browser navigator.geolocation
  navigator.geolocation.getCurrentPosition(success, error, opts);
}

/** Simple debounce utility */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
