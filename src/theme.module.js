/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Theme Engine Module
══════════════════════════════════════════════════════════ */
import { mapState } from './maps.module.js';

const THEME_KEY = 'siphika-theme';
let currentTheme = 'dark';

export function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') currentTheme = saved;
  } catch (_) {}
  applyTheme(false);
}

export function applyTheme(animate = true) {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const icon = currentTheme === 'dark' ? '🌙' : '☀️';
  const label =
    currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });

  if (mapState.map && window.google?.maps) {
    mapState.map.setOptions({ styles: getMapStyle() });
  }
  if (animate)
    window.showToast(
      currentTheme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode',
    );
}

export function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, currentTheme);
  } catch (_) {}
  applyTheme(true);
}

export function getMapStyle() {
  if (currentTheme === 'dark') {
    return [
      { elementType: 'geometry', stylers: [{ color: '#0D0F14' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#8A8580' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0C' }] },
      {
        featureType: 'road',
        elementType: 'geometry',
        stylers: [{ color: '#1C1C24' }],
      },
      {
        featureType: 'road.highway',
        elementType: 'geometry',
        stylers: [{ color: '#2A2420' }],
      },
      {
        featureType: 'road.highway',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#C9A84C' }],
      },
      {
        featureType: 'poi',
        elementType: 'geometry',
        stylers: [{ color: '#111115' }],
      },
      {
        featureType: 'water',
        elementType: 'geometry',
        stylers: [{ color: '#0A0D14' }],
      },
      {
        featureType: 'landscape',
        elementType: 'geometry',
        stylers: [{ color: '#0D0D10' }],
      },
    ];
  }
  return [
    { elementType: 'geometry', stylers: [{ color: '#EDE8DE' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#6B6560' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#FAF8F4' }] },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#FFFFFF' }],
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#F5EDD8' }],
    },
    {
      featureType: 'road.highway',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9E7B2A' }],
    },
    {
      featureType: 'poi',
      elementType: 'geometry',
      stylers: [{ color: '#E8E2D6' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#C8D8E8' }],
    },
    {
      featureType: 'landscape',
      elementType: 'geometry',
      stylers: [{ color: '#EDE8DE' }],
    },
  ];
}
