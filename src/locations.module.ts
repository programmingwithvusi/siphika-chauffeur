/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Saved pickup/drop-off locations
══════════════════════════════════════════════════════════ */
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase.config.js';

let stopSync: Unsubscribe | null = null;

interface SavedLocation {
  label?: string;
  address?: string;
}

// Reuses the .history-card / .hc-* classes already styled for ride
// history, and .empty-state — no new CSS needed.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function locationCard(id: string, data: SavedLocation) {
  const card = el('div', 'history-card');
  const top = el('div', 'hc-top');
  top.append(el('span', 'ride-badge completed', data.label || 'Location'));
  const removeBtn = el('button', 'btn-outline sm', 'Remove');
  removeBtn.addEventListener('click', () => deleteSavedLocation(id));
  card.append(top, el('div', 'hc-route', data.address || ''), removeBtn);
  return card;
}

function render(locations: { id: string; data: SavedLocation }[]) {
  const host = document.getElementById('saved-locations-list');
  if (!host) return;
  host.replaceChildren(
    ...(locations.length
      ? locations.map(({ id, data }) => locationCard(id, data))
      : [el('p', 'empty-state', 'No saved locations yet.')]),
  );
}

export function initSavedLocations() {
  onAuthStateChanged(auth, (user) => {
    if (stopSync) stopSync();
    stopSync = null;
    if (!user) return render([]);
    stopSync = onSnapshot(
      collection(db, 'users', user.uid, 'savedLocations'),
      (snap) => render(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
      (err) => console.error('[Siphika Locations] sync failed:', err),
    );
  });
}

export async function addSavedLocation() {
  if (!auth.currentUser) return window.showToast('Please sign in');
  const labelInput = document.getElementById(
    'loc-label',
  ) as HTMLInputElement | null;
  const addressInput = document.getElementById(
    'loc-address',
  ) as HTMLInputElement | null;
  const label = labelInput?.value.trim();
  const address = addressInput?.value.trim();
  if (!label || !address)
    return window.showToast('Enter a label and address');
  try {
    await addDoc(collection(db, 'users', auth.currentUser.uid, 'savedLocations'), {
      label,
      address,
    });
    if (labelInput) labelInput.value = '';
    if (addressInput) addressInput.value = '';
    window.showToast('Location saved');
  } catch (err) {
    console.error('[Siphika Locations] add failed:', err);
    window.showToast('Could not save location');
  }
}

export async function deleteSavedLocation(id: string) {
  if (!auth.currentUser) return;
  try {
    await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'savedLocations', id));
    window.showToast('Location removed');
  } catch (err) {
    console.error('[Siphika Locations] delete failed:', err);
    window.showToast('Could not remove location');
  }
}
