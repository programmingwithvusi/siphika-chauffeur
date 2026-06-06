/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — App Logic
   Navigation · Interactions · State Management
══════════════════════════════════════════════════════════ */

// ─── GOOGLE MAPS STATE ───────────────────────────────────
const mapState = {
  map:                 null,
  routesClient:        null,   // Routes API v2 client
  routePolyline:       null,   // google.maps.Polyline for the drawn route
  AdvancedMarker:      null,   // AdvancedMarkerElement constructor ref
  pickupAutocomplete:  null,
  destAutocomplete:    null,
  initialized:         false,
  routeDrawn:          false,
  _markerA:            null,   // gold pickup marker
  _markerB:            null,   // white destination marker
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
async function initGoogleMaps() {
  const mapEl = document.getElementById('booking-map');
  if (!mapEl) return;

  // Wait for google.maps to be available (script tag may still be loading)
  if (typeof google === 'undefined' || !google.maps) {
    console.warn('[Siphika] Google Maps not loaded — check API key and script tag');
    return;
  }

  // importLibrary requires the bootstrap loader pattern.
  // If not available (old script tag format), fall back gracefully.
  if (typeof google.maps.importLibrary !== 'function') {
    console.warn('[Siphika] importLibrary not available — check script tag uses bootstrap loader (no libraries= param)');
    // Try direct instantiation as fallback
    try { await initMapsDirect(); } catch (e) { console.error(e); }
    return;
  }

  try {
    // Load libraries via importLibrary (bootstrap loader pattern)
    // Do NOT load 'routes' — it has no usable browser classes;
    // route requests go via fetch() to routes.googleapis.com directly.
    const [mapsLib, placesLib, markerLib] = await Promise.all([
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('places'),
      google.maps.importLibrary('marker'),
    ]);

    // ── Map ──────────────────────────────────────────────
    // NOTE: mapId and styles are mutually exclusive.
    // We use styles (local JSON) so dark/light theme switching works.
    // AdvancedMarkerElement works without a mapId via DEMO_MAP_ID.
    mapState.map = new mapsLib.Map(mapEl, {
      center:           { lat: -26.2041, lng: 28.0473 },
      zoom:             11,
      styles:           getMapStyle(),   // local dark or light theme
      disableDefaultUI: true,
      gestureHandling:  'cooperative',
      zoomControl:      true,
      // mapId intentionally omitted — conflicts with styles property
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER,
      },
    });

    // ── Polyline for the route drawn from Routes API response ──
    mapState.routePolyline = new google.maps.Polyline({
      map:           mapState.map,
      strokeColor:   '#C9A84C',
      strokeWeight:  4,
      strokeOpacity: 0.9,
    });

    // ── Store AdvancedMarkerElement ref ───────────────────
    mapState.AdvancedMarker = markerLib.AdvancedMarkerElement;

    // ── Autocomplete ──────────────────────────────────────
    const pickupInput = document.getElementById('book-pickup');
    const destInput   = document.getElementById('book-dest');

    const acOptions = {
      componentRestrictions: { country: 'za' },
      fields:       ['formatted_address', 'geometry', 'name'],
      strictBounds: false,
    };

    mapState.pickupAutocomplete = new placesLib.Autocomplete(pickupInput, acOptions);
    mapState.destAutocomplete   = new placesLib.Autocomplete(destInput,   acOptions);

    mapState.pickupAutocomplete.addListener('place_changed', () => drawRoute());
    mapState.destAutocomplete.addListener('place_changed',   () => drawRoute());

    pickupInput.addEventListener('change', debounce(drawRoute, 600));
    destInput.addEventListener('change',   debounce(drawRoute, 600));

    mapState.initialized = true;
    drawRoute();

  } catch (err) {
    console.error('[Siphika] Google Maps failed to initialise:', err);
    showMapError();
  }
}

/** Fallback initialisation for when importLibrary is unavailable */
async function initMapsDirect() {
  const mapEl = document.getElementById('booking-map');
  mapState.map = new google.maps.Map(mapEl, {
    center:           { lat: -26.2041, lng: 28.0473 },
    zoom:             11,
    styles:           getMapStyle(),
    disableDefaultUI: true,
    gestureHandling:  'cooperative',
  });
  mapState.routePolyline = new google.maps.Polyline({
    map: mapState.map, strokeColor: '#C9A84C',
    strokeWeight: 4, strokeOpacity: 0.9,
  });
  const pickupInput = document.getElementById('book-pickup');
  const destInput   = document.getElementById('book-dest');
  const acOptions   = { componentRestrictions: { country: 'za' } };
  mapState.pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, acOptions);
  mapState.destAutocomplete   = new google.maps.places.Autocomplete(destInput,   acOptions);
  mapState.pickupAutocomplete.addListener('place_changed', () => drawRoute());
  mapState.destAutocomplete.addListener('place_changed',   () => drawRoute());
  mapState.AdvancedMarker     = null; // fall back to legacy Marker
  mapState.initialized        = true;
  drawRoute();
}

function showMapError() {
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
       <small>Check API key · Enable Routes API + Maps JS API in Cloud Console</small></p>`;
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
async function drawRoute() {
  const pickup = document.getElementById('book-pickup')?.value.trim();
  const dest   = document.getElementById('book-dest')?.value.trim();

  if (!pickup || !dest)          return;
  if (!mapState.initialized)     return;
  if (!mapState.routePolyline)   return;

  showMapLoading(true);
  hideRouteError();

  // Extract the API key from the Maps script src
  const apiKey = getApiKey();
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
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
          'Content-Type':         'application/json',
          'X-Goog-Api-Key':       apiKey,
          // Field mask — only request what we need (controls billing)
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,' +
            'routes.polyline.encodedPolyline,' +
            'routes.legs.startLocation,routes.legs.endLocation,' +
            'routes.legs.startAddress,routes.legs.endAddress',
        },
        body: JSON.stringify({
          origin: {
            address: pickup,
          },
          destination: {
            address: dest,
          },
          travelMode:         'DRIVE',
          routingPreference:  'TRAFFIC_AWARE',
          computeAlternativeRoutes: false,
          languageCode:       'en-ZA',
          regionCode:         'ZA',
          units:              'METRIC',
        }),
      }
    );

    showMapLoading(false);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('[Siphika] Routes API error:', errBody);
      showRouteError(errBody?.error?.status || 'HTTP_' + response.status);
      return;
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      showRouteError('ZERO_RESULTS');
      return;
    }

    const route      = data.routes[0];
    const leg        = route.legs?.[0];
    const distMeters = route.distanceMeters;             // e.g. 32400
    const distKm     = distMeters / 1000;                // e.g. 32.4
    const distText   = distKm.toFixed(1) + ' km';
    const durSec     = parseInt(route.duration);         // seconds
    const durText    = durSec >= 3600
      ? Math.floor(durSec / 3600) + 'h ' + Math.round((durSec % 3600) / 60) + ' min'
      : Math.round(durSec / 60) + ' mins';

    // ── Decode and draw the polyline ─────────────────────
    const encoded   = route.polyline.encodedPolyline;
    const path      = decodePolyline(encoded);
    mapState.routePolyline.setPath(path);

    // Fit map bounds to the route
    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    mapState.map.fitBounds(bounds, { top: 60, right: 30, bottom: 20, left: 30 });

    // ── Custom gold markers ───────────────────────────────
    if (leg) {
      const startLat = leg.startLocation?.latLng?.latitude;
      const startLng = leg.startLocation?.latLng?.longitude;
      const endLat   = leg.endLocation?.latLng?.latitude;
      const endLng   = leg.endLocation?.latLng?.longitude;

      if (startLat && endLat) {
        placeCustomMarkers(
          { lat: startLat, lng: startLng },
          { lat: endLat,   lng: endLng   },
          leg.startAddress || pickup,
          leg.endAddress   || dest
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
    updateFareFromDistance(distKm);

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
    if (typeof mapState._markerA.setMap === 'function') mapState._markerA.setMap(null);
    else mapState._markerA.map = null;
  }
  if (mapState._markerB) {
    if (typeof mapState._markerB.setMap === 'function') mapState._markerB.setMap(null);
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
      map:      mapState.map,
      title:    startTitle,
      content:  pinA,
    });

    const pinB = document.createElement('div');
    pinB.style.cssText = `width:18px;height:18px;border-radius:50%;
      background:#F0EDE4;border:2.5px solid #C9A84C;
      box-shadow:0 2px 8px rgba(201,168,76,0.4);`;

    mapState._markerB = new AdvancedMarker({
      position: endPos,
      map:      mapState.map,
      title:    endTitle,
      content:  pinB,
    });

  } else {
    // ── Legacy Marker fallback ────────────────────────────
    const sym = (color, stroke) => ({
      path:         google.maps.SymbolPath.CIRCLE,
      scale:        9,
      fillColor:    color,
      fillOpacity:  1,
      strokeColor:  stroke,
      strokeWeight: 2.5,
    });

    mapState._markerA = new google.maps.Marker({
      position: startPos, map: mapState.map,
      icon: sym('#C9A84C', '#0A0A0C'), title: startTitle, zIndex: 10,
    });
    mapState._markerB = new google.maps.Marker({
      position: endPos, map: mapState.map,
      icon: sym('#F0EDE4', '#C9A84C'), title: endTitle, zIndex: 10,
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
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    points.push(new google.maps.LatLng(lat / 1e5, lng / 1e5));
  }
  return points;
}

/** Extract the API key from the Maps script src at runtime */
function getApiKey() {
  const scripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
  for (const s of scripts) {
    const match = s.src.match(/[?&]key=([^&]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Recalculate fare from actual route distance.
 * Base rate: R14/km for Executive, scaled for other vehicles.
 * Minimum fare: vehicle base price.
 */
function updateFareFromDistance(distKm) {
  const ratePerKm = {
    'Executive Sedan':   14,
    'Business Class':    20,
    'Luxury SUV':        28,
    'Stretch Limousine': 55,
  };

  const vehicleName  = state.selectedVehicle?.name || 'Executive Sedan';
  const base         = state.selectedVehicle?.price || 450;
  const rate         = ratePerKm[vehicleName] ?? 14;
  const distanceFare = Math.round(distKm * rate);
  const surcharge    = 80;
  const total        = Math.max(base, distanceFare) + surcharge;

  // Update fare fields
  state.currentFare = total;
  document.getElementById('route-fare').textContent  = `R${total.toLocaleString()}`;
  document.getElementById('fare-total').textContent  = `R${total.toLocaleString()}`;

  // Keep the base fare row accurate too
  const baseRow = document.querySelector('.fare-row span:last-child');
  if (baseRow) baseRow.textContent = `R${Math.max(base, distanceFare).toLocaleString()}`;
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
    NOT_FOUND:              'One or both addresses could not be found.',
    ZERO_RESULTS:           'No driving route found between these locations.',
    INVALID_ARGUMENT:       'Invalid address — please check pickup and destination.',
    RESOURCE_EXHAUSTED:     'API quota exceeded — please try again shortly.',
    PERMISSION_DENIED:      'API key invalid or Routes API not enabled in Cloud Console.',
    UNAUTHENTICATED:        'API key missing or not authorised.',
    NETWORK_ERROR:          'Network error — check your internet connection.',
    // Extra guards
    NO_KEY:                 'No API key set — add your key to the Maps script tag.',
    HTTP_403:               'Routes API not enabled — check Google Cloud Console.',
    HTTP_400:               'Bad request — check pickup and destination addresses.',
  };
  el.innerHTML = `<span>⚠️</span> ${msgs[status] || 'Could not calculate route ('+status+').'}`;
}

function hideRouteError() {
  document.getElementById('route-error')?.classList.add('hidden');
}

/** Swap pickup ↔ destination then redraw */
function swapLocations() {
  const p = document.getElementById('book-pickup');
  const d = document.getElementById('book-dest');
  if (!p || !d) return;
  const tmp = p.value;
  p.value   = d.value;
  d.value   = tmp;
  showToast('Locations swapped');
  drawRoute();
}

/** Simple debounce utility */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}


const state = {
  history: ['splash'],
  currentScreen: 'splash',
  selectedVehicle: { name: 'Executive Sedan', price: 450 },
  selectedTripType: 'one-way',
  _backPressedOnce: false,
  user: { name: 'Thabo Nkosi', email: 'thabo.nkosi@email.com', initials: 'TN' }
};

// ─── THEME SYSTEM ─────────────────────────────────────────
// Persisted in localStorage under 'siphika-theme'.
// Applied as data-theme="dark"|"light" on <html>.
// All components react via CSS [data-theme="light"] overrides.
// Maps style also recomputes when theme changes.
const THEME_KEY  = 'siphika-theme';
let currentTheme = 'dark';

function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') currentTheme = saved;
  } catch (_) {}
  applyTheme(false);
}

function applyTheme(animate = true) {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const icon = currentTheme === 'dark' ? '🌙' : '☀️';
  const label = currentTheme === 'dark'
    ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });
  // Restyle Google Maps if initialised
  if (mapState.map && window.google?.maps) {
    mapState.map.setOptions({ styles: getMapStyle() });
  }
  if (animate) showToast(currentTheme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode');
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, currentTheme); } catch (_) {}
  applyTheme(true);
}

// Returns the correct Google Maps style array for the active theme
function getMapStyle() {
  if (currentTheme === 'dark') {
    return [
      { elementType: 'geometry',           stylers: [{ color: '#0D0F14' }] },
      { elementType: 'labels.text.fill',   stylers: [{ color: '#8A8580' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0C' }] },
      { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#1C1C24' }] },
      { featureType: 'road.highway',       elementType: 'geometry',         stylers: [{ color: '#2A2420' }] },
      { featureType: 'road.highway',       elementType: 'labels.text.fill', stylers: [{ color: '#C9A84C' }] },
      { featureType: 'poi',                elementType: 'geometry',         stylers: [{ color: '#111115' }] },
      { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#0A0D14' }] },
      { featureType: 'landscape',          elementType: 'geometry',         stylers: [{ color: '#0D0D10' }] },
    ];
  }
  return [
    { elementType: 'geometry',           stylers: [{ color: '#EDE8DE' }] },
    { elementType: 'labels.text.fill',   stylers: [{ color: '#6B6560' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#FAF8F4' }] },
    { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#FFFFFF' }] },
    { featureType: 'road.highway',       elementType: 'geometry',         stylers: [{ color: '#F5EDD8' }] },
    { featureType: 'road.highway',       elementType: 'labels.text.fill', stylers: [{ color: '#9E7B2A' }] },
    { featureType: 'poi',                elementType: 'geometry',         stylers: [{ color: '#E8E2D6' }] },
    { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#C8D8E8' }] },
    { featureType: 'landscape',          elementType: 'geometry',         stylers: [{ color: '#EDE8DE' }] },
  ];
}

// ─── NAVIGATION ──────────────────────────────────────────
function goTo(id) {
  const current = document.getElementById(state.currentScreen);
  const next = document.getElementById(id);
  if (!next || id === state.currentScreen) return;

  // Exit animation on current
  current.classList.add('exit');
  current.classList.remove('active');

  // Small delay then activate next
  setTimeout(() => {
    current.classList.remove('exit');
    next.classList.add('active');
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
  // Fix: remove the extra push goTo adds
  setTimeout(() => {
    state.history.pop(); // remove duplicate
  }, 300);
}

function onScreenEnter(id) {
  switch (id) {
    case 'home':
      updateGreeting();
      break;
    case 'confirm':
      updateConfirmDetails();
      break;
    case 'book':
      setDefaultDateTime();
      // Re-draw route if Maps is already initialized (e.g. user navigates back to book)
      if (mapState.initialized) {
        drawRoute();
      } else {
        // Maps not ready yet — try initialising now (handles slow network on device)
        initGoogleMaps();
      }
      break;
    case 'booked':
      triggerSuccessAnimation();
      break;
  }
}

// ─── GREETING ────────────────────────────────────────────
function updateGreeting() {
  const hour = new Date().getHours();
  const greetEl = document.querySelector('.greeting');
  if (!greetEl) return;
  if (hour < 12) greetEl.textContent = 'Good morning,';
  else if (hour < 17) greetEl.textContent = 'Good afternoon,';
  else greetEl.textContent = 'Good evening,';
}

// ─── REGISTRATION ────────────────────────────────────────
function registerUser() {
  const name  = document.getElementById('reg-name')?.value.trim();
  const email = document.getElementById('reg-email')?.value.trim();
  const phone = document.getElementById('reg-phone')?.value.trim();
  const pass  = document.getElementById('reg-pass')?.value;

  if (!name || !email || !phone || !pass) {
    showToast('Please fill in all fields');
    return;
  }
  if (pass.length < 8) {
    showToast('Password must be at least 8 characters');
    return;
  }
  if (!email.includes('@')) {
    showToast('Please enter a valid email');
    return;
  }

  // Update state with user name
  state.user.name = name;
  state.user.initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  showToast('Account created! Welcome to Siphika ✦');
  setTimeout(() => goTo('home'), 800);
}

// ─── FLEET SELECTION (HOME) ──────────────────────────────
function selectFleet(el, name) {
  document.querySelectorAll('.fleet-card').forEach(c => c.classList.remove('active-fleet'));
  el.classList.add('active-fleet');
  showToast(`${name} selected`);
}

// ─── VEHICLE SELECTION (BOOK) ────────────────────────────
function selectVehicle(el, name, price) {
  document.querySelectorAll('.vehicle-option').forEach(v => v.classList.remove('selected'));
  el.classList.add('selected');
  const priceNum = parseInt(price.replace(/[^0-9]/g, ''));
  state.selectedVehicle = { name, price: priceNum };
  updateFareSummary();
}

// ─── TRIP TYPE ───────────────────────────────────────────
function setTripType(el, type) {
  document.querySelectorAll('.trip-type').forEach(t => t.classList.remove('active-type'));
  el.classList.add('active-type');
  state.selectedTripType = type;

  // Adjust fare for return trips
  if (type === 'return') {
    state.fareMultiplier = 1.8;
    showToast('Return trip: 80% off second leg');
  } else if (type === 'hourly') {
    state.fareMultiplier = null; // hourly
    showToast('Hourly rate: R350/hr minimum 2hr');
  } else {
    state.fareMultiplier = 1;
  }
  updateFareSummary();
}

function updateFareSummary() {
  const base = state.selectedVehicle.price;
  const surcharge = 80;
  let total = base + surcharge;

  if (state.fareMultiplier && state.fareMultiplier !== 1) {
    total = Math.round(base * state.fareMultiplier) + surcharge;
  }

  const totalEl = document.getElementById('fare-total');
  if (totalEl) {
    totalEl.textContent = `R${total.toLocaleString()}`;
    totalEl.style.color = 'var(--gold)';
    // Flash animation
    totalEl.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.12)', color: '#E8C96B' },
      { transform: 'scale(1)' }
    ], { duration: 300 });
  }
  state.currentFare = total;
}

// ─── DATE TIME ───────────────────────────────────────────
function setDefaultDateTime() {
  const dateInput = document.getElementById('book-date');
  const now = new Date();
  if (dateInput && !dateInput.value) {
    dateInput.value = now.toISOString().split('T')[0];
  }
}

// ─── CONFIRM SCREEN DETAILS ──────────────────────────────
function updateConfirmDetails() {
  const dateEl = document.getElementById('conf-dt');
  if (!dateEl) return;
  const dateInput = document.getElementById('book-date');
  const timeInput = document.getElementById('book-time');
  const date = dateInput?.value || new Date().toISOString().split('T')[0];
  const time = timeInput?.value || '08:00';
  const d = new Date(date + 'T' + time);
  const formatted = d.toLocaleDateString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short'
  }) + ', ' + time;
  dateEl.textContent = formatted;

  // Update confirm button with fare
  const confirmBtn = document.querySelector('#confirm .btn-primary');
  if (confirmBtn && state.currentFare) {
    confirmBtn.textContent = `Confirm & Pay R${state.currentFare.toLocaleString()}`;
  }
}

// ─── CONFIRM BOOKING ─────────────────────────────────────
function confirmBooking() {
  const btn = document.querySelector('#confirm .btn-primary');
  if (btn) {
    btn.textContent = 'Processing...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }

  // Haptic feedback on confirm (Cordova vibration plugin)
  hapticConfirm();

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
    goTo('booked');
  }, 1400);
}

// ─── SUCCESS ANIMATION ───────────────────────────────────
function triggerSuccessAnimation() {
  const icon = document.querySelector('.success-icon');
  if (!icon) return;
  icon.animate([
    { transform: 'scale(0)', opacity: 0 },
    { transform: 'scale(1.15)', opacity: 1 },
    { transform: 'scale(1)', opacity: 1 }
  ], { duration: 500, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
}

// ─── PAYMENT SELECTION ───────────────────────────────────
function selectPayment(el) {
  document.querySelectorAll('.payment-opt').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

// ─── RIDES FILTER ────────────────────────────────────────
function filterRides(el, status) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active-tab'));
  el.classList.add('active-tab');

  const cards = document.querySelectorAll('.history-card');
  cards.forEach(card => {
    if (status === 'all') {
      card.style.display = 'flex';
    } else {
      const cardStatus = card.dataset.status;
      const match =
        (status === 'upcoming'  && cardStatus === 'in-progress') ||
        (status === 'completed' && cardStatus === 'completed')   ||
        (status === 'cancelled' && cardStatus === 'cancelled');
      card.style.display = match ? 'flex' : 'none';
    }
    // Animate in
    if (card.style.display !== 'none') {
      card.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 220, fill: 'forwards' });
    }
  });
}

// ─── NOTIFICATIONS ───────────────────────────────────────
function markAllRead() {
  document.querySelectorAll('.notif-item.unread').forEach(n => {
    n.classList.remove('unread');
    const dot = n.querySelector('.notif-dot');
    if (dot) dot.remove();
  });
  // Clear badge
  const badge = document.querySelector('.notif-badge');
  if (badge) {
    badge.style.display = 'none';
  }
  showToast('All notifications marked as read');
}

// ─── SCHEDULE ────────────────────────────────────────────
function schedule() {
  goTo('book');
  setTimeout(() => {
    const dateInput = document.getElementById('book-date');
    if (dateInput) dateInput.focus();
  }, 400);
}

// ─── TOAST ───────────────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ─── LIVE CAR ANIMATION ON TRACKING ──────────────────────
function startTrackingSimulation() {
  // Already handled by CSS animation
  // Could add live ETA countdown here
  const etaChip = document.querySelector('.map-eta-chip');
  if (!etaChip) return;

  let minutes = 8;
  let seconds = 0;
  const interval = setInterval(() => {
    seconds -= 5;
    if (seconds <= 0) {
      minutes--;
      seconds = 55;
    }
    if (minutes <= 0) {
      clearInterval(interval);
      etaChip.textContent = 'Arriving now!';
      showToast('🚗 Your chauffeur has arrived!');
      return;
    }
    etaChip.textContent = `${minutes} min away`;
  }, 5000);
}

// ─── EXTRAS CHECKBOX INTERACTION ─────────────────────────
function initExtrasInteraction() {
  document.querySelectorAll('.extra-toggle input').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      updateFareSummary();
    });
  });
}

// ─── SWIPE NAVIGATION ────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Only trigger for horizontal swipes (not scrolls)
  if (absDx > 60 && absDx > absDy * 1.5) {
    if (dx > 0) {
      // Swipe right = go back
      const backBtn = document.querySelector(`#${state.currentScreen} .back-btn`);
      if (backBtn) goBack();
    }
  }
}, { passive: true });

// ─── KEYBOARD: ENTER KEY ON FORMS ────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const screen = state.currentScreen;
    if (screen === 'register') registerUser();
    else if (screen === 'login') goTo('home');
  }
});

// ─── ONBOARDING AUTO-PROGRESS (optional) ─────────────────
// Uncomment to auto-advance onboarding after 4s
// setInterval(() => {
//   if (state.currentScreen === 'onboard-1') goTo('onboard-2');
//   else if (state.currentScreen === 'onboard-2') goTo('onboard-3');
// }, 4000);

// ─── SMOOTH SCROLL REVEAL ────────────────────────────────
function initScrollReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.animate([
          { opacity: 0, transform: 'translateY(16px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 360, fill: 'forwards', easing: 'ease-out' });
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(
    '.hero-card, .fleet-card, .ride-card, .history-card, .vehicle-option, .book-step, .promo-banner'
  ).forEach(el => observer.observe(el));
}

// ─── CORDOVA DEVICE READY ────────────────────────────────
// Cordova requires all initialisation to happen inside the
// 'deviceready' event. DOMContentLoaded fires before native
// plugins are available; deviceready fires after both the DOM
// and all native bridges are ready.
//
// On a plain browser (npm run dev) document will already be
// loaded when this runs, so we fall back gracefully.
function bootApp() {
  // Initialise theme first — sets data-theme on <html> before any paint
  initTheme();

  // Set initial date for booking
  setDefaultDateTime();

  // Init extras checkboxes
  initExtrasInteraction();

  // Greeting based on time of day
  updateGreeting();

  // Scroll-reveal animations
  initScrollReveal();

  // Set initial fare
  state.currentFare = 530;

  // ── Cordova plugin setup ──────────────────────────────

  // 1. StatusBar — dark background, light icons
  if (window.StatusBar) {
    StatusBar.styleBlackTranslucent();
    StatusBar.backgroundColorByHexString('#0A0A0C');
  }

  // 2. Android hardware back button
  document.addEventListener('backbutton', onBackButton, false);

  // 3. Network information — show/hide offline banner
  initNetworkMonitor();

  // 4. Safe area insets (iPhone notch / Android cutout)
  applySafeAreaInsets();

  // 5. Google Maps — init after deviceready so the WebView
  //    network stack is fully ready before Maps API calls
  initGoogleMaps();

  // ── Entry animation ───────────────────────────────────
  const splashContent = document.querySelector('.splash-content');
  if (splashContent) {
    splashContent.animate([
      { opacity: 0, transform: 'translateY(20px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 800, delay: 200, fill: 'forwards', easing: 'ease-out' });
  }
  const splashFooter = document.querySelector('.splash-footer');
  if (splashFooter) {
    splashFooter.animate([
      { opacity: 0, transform: 'translateY(20px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 600, delay: 700, fill: 'forwards', easing: 'ease-out' });
  }

  console.log('%cSIPHIKA CHAUFFEUR ✦', 'color:#C9A84C;font-size:20px;font-weight:bold;');
  console.log('%cArrive in Excellence', 'color:#8A8580;font-size:12px;');
}

// Fire on deviceready (native) or DOMContentLoaded (browser dev)
if (window.cordova) {
  document.addEventListener('deviceready', bootApp, false);
} else {
  document.addEventListener('DOMContentLoaded', bootApp);
}

// ─── ANDROID BACK BUTTON ─────────────────────────────────
// Mirrors the swipe-back gesture. On the splash/login screens
// it exits the app (navigator.app.exitApp). Elsewhere it goes back.
function onBackButton(e) {
  e.preventDefault();
  const noExitScreens = ['home', 'onboard-1', 'onboard-2', 'onboard-3'];

  if (state.history.length <= 1 || noExitScreens.includes(state.currentScreen)) {
    // Show a "press again to exit" toast, then exit on second press
    if (state._backPressedOnce) {
      if (navigator.app) navigator.app.exitApp();
    } else {
      state._backPressedOnce = true;
      showToast('Press back again to exit');
      setTimeout(() => { state._backPressedOnce = false; }, 2000);
    }
  } else {
    goBack();
  }
}

// ─── NETWORK MONITOR ─────────────────────────────────────
// Uses cordova-plugin-network-information to show an offline
// banner when the device loses connectivity (Maps won't work).
function initNetworkMonitor() {
  // navigator.connection exists in both browsers (Network Information API)
  // and Cordova (cordova-plugin-network-information).
  // However, the Connection.NONE constant is Cordova-only — never defined
  // in the browser — so we must guard every reference to it.
  if (!navigator.connection) return;

  function updateNetworkUI() {
    let offline = false;

    if (typeof Connection !== 'undefined') {
      // Cordova WebView — use the plugin's typed constant
      offline = (navigator.connection.type === Connection.NONE);
    } else {
      // Browser fallback — 'none' is the string value when offline,
      // or check navigator.onLine as a final safety net
      const type = navigator.connection.type;
      offline = (type === 'none') || (!navigator.onLine);
    }

    let banner = document.getElementById('offline-banner');

    if (offline) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.innerHTML = '📡 No internet connection — map & booking unavailable';
        Object.assign(banner.style, {
          position:        'fixed',
          top:             '0',
          left:            '0',
          right:           '0',
          background:      'rgba(200,75,75,0.92)',
          color:           '#fff',
          fontSize:        '12px',
          padding:         'calc(10px + var(--safe-top, 0px)) 16px 10px',
          textAlign:       'center',
          zIndex:          '9999',
          backdropFilter:  'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        });
        document.body.appendChild(banner);
      }
    } else {
      if (banner) banner.remove();
    }
  }

  document.addEventListener('offline', updateNetworkUI, false);
  document.addEventListener('online',  updateNetworkUI, false);
  updateNetworkUI(); // check immediately on boot
}

// ─── SAFE AREA INSETS ────────────────────────────────────
// Pushes the bottom nav above the iPhone home indicator and
// the top bar below the status bar on notched devices.
// Uses CSS env() where supported; falls back to JS measurement.
function applySafeAreaInsets() {
  const root = document.documentElement;

  // env() support check
  const testEl = document.createElement('div');
  testEl.style.paddingTop = 'env(safe-area-inset-top)';
  document.body.appendChild(testEl);
  const hasEnv = getComputedStyle(testEl).paddingTop !== '0px';
  document.body.removeChild(testEl);

  if (hasEnv) {
    // CSS env() is supported — the stylesheet already handles this via
    // the padding-bottom on .bottom-nav and padding-top on .sbar
    root.style.setProperty('--safe-top',    'env(safe-area-inset-top)');
    root.style.setProperty('--safe-bottom', 'env(safe-area-inset-bottom)');
  } else {
    // Android older fallback — estimate from screen dimensions
    const statusH = window.screen.height - window.innerHeight > 24 ? 24 : 0;
    root.style.setProperty('--safe-top',    statusH + 'px');
    root.style.setProperty('--safe-bottom', '0px');
  }
}

// ─── GEOLOCATION: USE MY LOCATION ────────────────────────
// Called by the "Use my location" button on the booking map.
// Uses cordova-plugin-geolocation (falls back to browser API).
function useMyLocation() {
  const btn = document.getElementById('geolocate-btn');
  if (btn) { btn.textContent = '📡'; btn.disabled = true; }

  const success = (position) => {
    const { latitude, longitude } = position.coords;
    if (btn) { btn.textContent = '📍'; btn.disabled = false; }

    // Reverse-geocode using Google Maps Geocoder
    if (window.google?.maps) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
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
      });
    } else {
      // Maps not loaded yet — just fill coordinates
      const pickupInput = document.getElementById('book-pickup');
      if (pickupInput) pickupInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };

  const error = (err) => {
    if (btn) { btn.textContent = '📍'; btn.disabled = false; }
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

// ─── VIBRATION: BOOKING CONFIRMATION HAPTIC ──────────────
// cordova-plugin-vibration — gives a short haptic on confirm.
function hapticConfirm() {
  if (navigator.vibrate) {
    // Pattern: 60ms buzz, 40ms gap, 60ms buzz
    navigator.vibrate([60, 40, 60]);
  }
}


// ─── HANDLE TRACKING SCREEN ──────────────────────────────
const trackingObserver = new MutationObserver(() => {
  if (state.currentScreen === 'tracking') {
    startTrackingSimulation();
  }
});
trackingObserver.observe(document.body, { attributes: true, subtree: true });

// ─── EXPOSE FUNCTIONS TO GLOBAL SCOPE ────────────────────
// Required because type="module" scopes functions away from
// inline onclick="" handlers in HTML. Attach them to window.
window.goTo           = goTo;
window.goBack         = goBack;
window.registerUser   = registerUser;
window.selectFleet    = selectFleet;
window.selectVehicle  = selectVehicle;
window.setTripType    = setTripType;
window.confirmBooking = confirmBooking;
window.selectPayment  = selectPayment;
window.filterRides    = filterRides;
window.markAllRead    = markAllRead;
window.schedule       = schedule;
window.swapLocations  = swapLocations;
window.drawRoute      = drawRoute;
window.useMyLocation  = useMyLocation;
window.hapticConfirm  = hapticConfirm;
window.toggleTheme    = toggleTheme;
