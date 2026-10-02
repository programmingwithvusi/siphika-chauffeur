/* ══════════════════════════════════════════════════════════
   SIPHIKA CHAUFFEUR — Authentication Engine Module
══════════════════════════════════════════════════════════ */

//This module encapsulates Firebase Authentication runtime flows and state changes.
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, googleProvider } from './firebase.config.js';

const linkReferralFn = httpsCallable(functions, 'linkReferral');

let stopProfileSync: Unsubscribe | null = null;

interface UserProfile {
  name?: string;
  email?: string;
  phone?: string;
  photoURL?: string;
  referralCode?: string;
  referredBy?: string;
  tier?: string;
  totalRides?: number;
  rating?: number;
  createdAt?: unknown;
}

function inputValue(id: string, trim = true): string | undefined {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return trim ? el?.value.trim() : el?.value;
}

export function listenToAuth(onUserLoaded?: (profile: UserProfile | null) => void) {
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
        const data = snap.data() as UserProfile;
        renderProfile(data);
        if (onUserLoaded) onUserLoaded(data);
      },
      (err) => console.error('[Siphika] Profile sync failed:', err),
    );
  });
}

function renderProfile(data: UserProfile | null) {
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
  const fill = (key: string, text: string) =>
    document
      .querySelectorAll(`[data-bind="${key}"]`)
      .forEach((el) => (el.textContent = text));
  fill('user.tier', `✦ ${tier[0].toUpperCase()}${tier.slice(1)} Member`);
  fill('user.totalRides', String(data?.totalRides ?? 0));
  fill('user.rating', data?.rating ? Number(data.rating).toFixed(1) : '—');
}

export async function doRegister() {
  const name = inputValue('reg-name');
  const email = inputValue('reg-email');
  const phone = inputValue('reg-phone');
  const pass = inputValue('reg-pass', false);
  const referralInput = inputValue('reg-referral');

  if (!name || !email || !phone || !pass) {
    return window.showToast('Please fill all fields');
  }
  if (pass.length < 8) {
    return window.showToast('Password min 8 characters');
  }
  if (!email.includes('@')) {
    return window.showToast('Please enter a valid email');
  }

  const btn = document.querySelector<HTMLButtonElement>('#register .btn');
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
    window.showToast(firebaseErrorMessage((err as { code?: string }).code));
  } finally {
    if (btn) {
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  }
}

export async function doLogin() {
  const email = inputValue('l-email');
  const pass = inputValue('l-pass', false);

  if (!email || !pass) {
    return window.showToast('Please fill all fields');
  }

  const btn = document.querySelector<HTMLButtonElement>('#login .btn');
  if (btn) {
    btn.textContent = 'Signing in...';
    btn.disabled = true;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    window.showToast('Welcome back ✦');
    window.goTo('home');
  } catch (err) {
    window.showToast(firebaseErrorMessage((err as { code?: string }).code));
  } finally {
    if (btn) {
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  }
}

// Shared by both the browser (signInWithPopup) and native
// (signInWithCredential) Google sign-in paths below.
async function upsertGoogleProfile(user: User) {
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
}

export async function doGoogleSignIn() {
  if (window.cordova) return doGoogleSignInNative();
  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    await upsertGoogleProfile(user);
    window.goTo('home');
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/popup-closed-by-user') {
      window.showToast(firebaseErrorMessage((err as { code?: string }).code));
    }
  }
}

// cordova-plugin-google-signin: a native sign-in sheet that returns a
// Google ID token, which we exchange for a Firebase credential — signInWithPopup
// doesn't work inside a WebView, so this is the real Cordova equivalent.
async function doGoogleSignInNative() {
  const plugin = window.cordova?.plugins?.GoogleSignInPlugin;
  if (!plugin) {
    return window.showToast('Google sign-in is not available on this device');
  }
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      plugin.signIn(resolve, reject);
    });
    const result = JSON.parse(raw) as GoogleSignInResult;
    const idToken = result.message?.id_token;
    if (!idToken) throw new Error('No ID token returned from native sign-in');
    const { user } = await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(idToken),
    );
    await upsertGoogleProfile(user);
    window.goTo('home');
  } catch (err) {
    console.error('[Siphika] Native Google sign-in failed:', err);
    window.showToast('Google sign-in failed — please try again or use email');
  }
}

export async function saveProfile() {
  if (!auth.currentUser) return window.showToast('Please sign in');
  const name = inputValue('ep-name');
  const phone = inputValue('ep-phone');
  if (!name) return window.showToast('Name cannot be empty');
  const btn = document.querySelector<HTMLButtonElement>('#edit-profile .btn-primary');
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
  // Also disconnect the native Google client — plain signOut() only clears
  // its session; the next "Continue with Google" tap would still silently
  // re-select the same account via Android's own account-chooser memory.
  // disconnect() fully revokes consent, which actually brings the picker
  // back.
  const plugin = window.cordova?.plugins?.GoogleSignInPlugin;
  if (plugin) {
    await new Promise<void>((resolve) => {
      plugin.disconnect(
        () => resolve(),
        (err) => {
          console.warn('[Siphika] Native Google disconnect failed:', err);
          resolve();
        },
      );
    });
  }
  await signOut(auth);
  window.goTo('splash');
}

function firebaseErrorMessage(code?: string): string {
  console.warn('[Siphika] Firebase auth error code:', code);
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Email already registered — sign in instead',
    'auth/invalid-email': 'Invalid email address',
    'auth/weak-password': 'Password is too weak — use at least 8 characters',
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/too-many-requests': 'Too many attempts — try again later',
    'auth/network-request-failed': 'No internet connection',
    'auth/invalid-credential': 'Invalid email or password',
  };
  return (code && messages[code]) || 'Something went wrong — please try again';
}
