/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Ride history (bookings for the signed-in user)
══════════════════════════════════════════════════════════ */
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase.config.js';

let stopSync: Unsubscribe | null = null;

interface Booking {
  status?: string;
  date?: string;
  vehicle?: string;
  fare?: number | null;
  pickup: string;
  destination: string;
  createdAt?: Timestamp | null;
}

interface Row {
  id: string;
  data: Booking;
}

const formatRand = (n: number) => `R${Number(n).toLocaleString()}`;
const fareText = (b: Booking) => (b.fare != null ? formatRand(b.fare) : 'Quoted');

function statusInfo(status?: string) {
  if (status === 'completed')
    return { filter: 'completed', label: 'Completed', badge: 'completed' };
  if (status === 'cancelled')
    return { filter: 'cancelled', label: 'Cancelled', badge: 'cancelled' };
  const label = status ? status[0].toUpperCase() + status.slice(1) : 'Pending';
  return { filter: 'in-progress', label, badge: 'in-progress' };
}

function formatDate(date?: string): string {
  const d = new Date(`${date}T00:00`);
  return Number.isNaN(d.getTime())
    ? date || ''
    : d.toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

// textContent only: pickup/destination are user-entered, so never innerHTML.
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

function openTracking(id: string) {
  window.dispatchEvent(
    new CustomEvent('siphika:track-booking', { detail: { id } }),
  );
}

function historyCard({ id, data: b }: Row) {
  const s = statusInfo(b.status);
  const card = el('div', 'history-card');
  card.dataset.status = s.filter;
  const top = el('div', 'hc-top');
  top.append(
    el('span', `ride-badge ${s.badge}`, s.label),
    el('span', 'hc-date', formatDate(b.date)),
  );
  const bottom = el('div', 'hc-bottom');
  bottom.append(
    el('span', 'hc-car', b.vehicle || ''),
    el('span', 'hc-price', fareText(b)),
  );
  card.append(top, el('div', 'hc-route', `${b.pickup} → ${b.destination}`), bottom);
  if (s.filter === 'in-progress') {
    const btn = el('button', 'btn-outline sm', 'Track');
    btn.addEventListener('click', () => openTracking(id));
    card.append(btn);
  }
  return card;
}

function recentCard({ id, data: b }: Row) {
  const s = statusInfo(b.status);
  const active = s.filter === 'in-progress';
  const card = el('div', 'ride-card');
  const info = el('div', 'ride-info');
  info.append(
    el('p', 'ride-from', b.pickup),
    el('p', 'ride-arrow', '→'),
    el('p', 'ride-to', b.destination),
  );
  const meta = el('div', 'ride-meta');
  meta.append(
    el('span', `ride-badge ${s.badge}`, s.label),
    el('p', 'ride-price', fareText(b)),
  );
  card.append(el('div', `ride-status-dot ${active ? 'active' : 'done'}`), info, meta);
  card.addEventListener('click', () =>
    active ? openTracking(id) : window.goTo('rides'),
  );
  return card;
}

function render(bookings: Row[]) {
  const fill = (id: string, cards: HTMLElement[], emptyText: string) => {
    const host = document.getElementById(id);
    if (host)
      host.replaceChildren(
        ...(cards.length ? cards : [el('p', 'empty-state', emptyText)]),
      );
  };
  fill('rides-list', bookings.map(historyCard), 'No rides yet.');
  fill(
    'recent-rides',
    bookings.slice(0, 3).map(recentCard),
    'No rides yet. Book your first ride above.',
  );
  document.querySelector<HTMLElement>('.filter-tab.active-tab')?.click(); // reapply current filter
}

export function initRides() {
  onAuthStateChanged(auth, (user) => {
    if (stopSync) stopSync();
    stopSync = null;
    if (!user) return render([]);
    stopSync = onSnapshot(
      query(collection(db, 'bookings'), where('userId', '==', user.uid)),
      (snap) => {
        const rows: Row[] = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as Booking,
        }));
        const t = (r: Row) => r.data.createdAt?.toMillis?.() ?? 0;
        render(rows.sort((a, b) => t(b) - t(a)));
      },
      (err) => console.error('[Siphika Rides] sync failed:', err),
    );
  });
}
