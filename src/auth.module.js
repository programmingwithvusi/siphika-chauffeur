/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Authentication Engine Module
══════════════════════════════════════════════════════════ */

//This module encapsulates Firebase Authentication runtime flows and state changes.
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, googleProvider } from './firebase.config.js';

const linkReferralFn = httpsCallable(functions, 'linkReferral');

let stopProfileSync = null;

export function listenToAuth(onUserLoaded) {
  onAuthStateChanged(auth, (user) => {
    if (stopProfileSync) stopProfileSync();
    stopProfileSync = null;
    if (!user) {
      renderProfile(null);
      if (onUserLoaded) onUserLoaded(null);
      return;
    }
    stopProfileSync = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        renderProfile(data);
        if (onUserLoaded) onUserLoaded(data);
      },
      (err) => console.error('[Siphika] Profile sync failed:', err),
    );
  });
}

function renderProfile(data) {
  const name = data?.name || data?.email?.split('@')[0] || 'Guest';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  document
    .querySelectorAll('.user-name')
    .forEach((el) => (el.textContent = name));
  document
    .querySelectorAll('.avatar, .profile-avatar-lg')
    .forEach((el) => (el.textContent = initials));
  document
    .querySelectorAll('.profile-name')
    .forEach((el) => (el.textContent = name));
  document
    .querySelectorAll('.profile-email')
    .forEach((el) => (el.textContent = data?.email || ''));

  const tier = data?.tier || 'standard';
  const fill = (key, text) =>
    document
      .querySelectorAll(`[data-bind="${key}"]`)
      .forEach((el) => (el.textContent = text));
  fill('user.tier', `✦ ${tier[0].toUpperCase()}${tier.slice(1)} Member`);
  fill('user.totalRides', data?.totalRides ?? 0);
  fill('user.rating', data?.rating ? Number(data.rating).toFixed(1) : '—');
}

export async function doRegister() {
  const name = document.getElementById('reg-name')?.value.trim();
  const email = document.getElementById('reg-email')?.value.trim();
  const phone = document.getElementById('reg-phone')?.value.trim();
  const pass = document.getElementById('reg-pass')?.value;
  const referralInput = document.getElementById('reg-referral')?.value.trim();

  if (!name || !email || !phone || !pass) {
    return window.showToast('Please fill all fields');
  }
  if (pass.length < 8) {
    return window.showToast('Password min 8 characters');
  }
  if (!email.includes('@')) {
    return window.showToast('Please enter a valid email');
  }

  const btn = document.querySelector('#register .btn');
  if (btn) {
    btn.textContent = 'Creating account...';
    btn.disabled = true;
  }

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, pass);
    const referralCode = user.uid.slice(0, 8).toUpperCase();
    await setDoc(doc(db, 'users', user.uid), {
      name,
      email,
      phone,
      referralCode,
      tier: 'standard',
      totalRides: 0,
      rating: 0,
      createdAt: serverTimestamp(),
    });
    if (referralInput) {
      // Awaited so it survives the user closing the app right after signing
      // up — still best-effort: an invalid/unknown code doesn't block
      // registration, it's just one network round-trip slower now.
      await linkReferralFn({ code: referralInput.toUpperCase() }).catch((err) =>
        console.warn('[Siphika] Referral link failed:', err),
      );
    }
    window.showToast('Welcome to Siphika ✦');
    window.goTo('home');
  } catch (err) {
    window.showToast(firebaseErrorMessage(err.code));
  } finally {
    if (btn) {
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  }
}

export async function doLogin() {
  const email = document.getElementById('l-email')?.value.trim();
  const pass = document.getElementById('l-pass')?.value;

  if (!email || !pass) {
    return window.showToast('Please fill all fields');
  }

  const btn = document.querySelector('#login .btn');
  if (btn) {
    btn.textContent = 'Signing in...';
    btn.disabled = true;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    window.showToast('Welcome back ✦');
    window.goTo('home');
  } catch (err) {
    window.showToast(firebaseErrorMessage(err.code));
  } finally {
    if (btn) {
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  }
}

export async function doGoogleSignIn() {
  if (window.cordova) {
    return window.showToast(
      'Google sign-in is not available in the app yet — use email',
    );
  }
  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        name: user.displayName,
        email: user.email,
        phone: user.phoneNumber || '',
        photoURL: user.photoURL,
        tier: 'standard',
        totalRides: 0,
        rating: 0,
        createdAt: serverTimestamp(),
      });
    }
    window.goTo('home');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      window.showToast(firebaseErrorMessage(err.code));
    }
  }
}

export async function saveProfile() {
  const name = document.getElementById('ep-name')?.value.trim();
  const phone = document.getElementById('ep-phone')?.value.trim();
  if (!name) return window.showToast('Name cannot be empty');
  const btn = document.querySelector('#edit-profile .btn-primary');
  if (btn) {
    btn.textContent = 'Saving...';
    btn.disabled = true;
  }
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), { name, phone });
    window.showToast('Profile updated');
    window.goBack();
  } catch (err) {
    console.error('[Siphika] Profile update failed:', err);
    window.showToast('Could not save changes');
  } finally {
    if (btn) {
      btn.textContent = 'Save Changes';
      btn.disabled = false;
    }
  }
}

export async function doSignOut() {
  if (!confirm('Sign out?')) return;
  await signOut(auth);
  window.goTo('splash');
}

function firebaseErrorMessage(code) {
  console.warn('[Siphika] Firebase auth error code:', code);
  const messages = {
    'auth/email-already-in-use': 'Email already registered — sign in instead',
    'auth/invalid-email': 'Invalid email address',
    'auth/weak-password': 'Password is too weak — use at least 8 characters',
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/too-many-requests': 'Too many attempts — try again later',
    'auth/network-request-failed': 'No internet connection',
    'auth/invalid-credential': 'Invalid email or password',
  };
  return messages[code] || 'Something went wrong — please try again';
}
