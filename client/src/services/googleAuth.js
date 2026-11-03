/**
 * Google Identity & Crate History Service
 *
 * Implements real Google Sign-In via Google Identity Services (GIS)
 * with in-browser JWT verification against Google's public JWKS.
 *
 * ARCHITECTURAL BOUNDARY:
 * In-browser verification establishes a verified Google identity FOR THIS BROWSER
 * with a client-side trust boundary. It enables local personalisation (keyed crate history),
 * not a cross-device server-side account system.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_USER_KEY = 'deck_order_google_user';
const CRATE_HISTORY_PREFIX = 'deck_order_crate_history_';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let remoteJWKS = null;
function getGoogleJWKS() {
  if (!remoteJWKS) {
    remoteJWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }
  return remoteJWKS;
}

/**
 * Verifies a Google ID Token against Google's public JWKS.
 * Checks signature, issuer ('accounts.google.com' or 'https://accounts.google.com'),
 * audience (Client ID), and expiration.
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  if (!idToken) throw new Error('Missing ID token');
  if (!clientId) throw new Error('Missing Google Client ID for verification');

  const jwks = getGoogleJWKS();
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ['accounts.google.com', 'https://accounts.google.com'],
    audience: clientId
  });

  return payload;
}

/**
 * Dynamically loads Google Identity Services (GIS) library if not already present
 */
let gisPromise = null;
export function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (gisPromise) return gisPromise;

  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
      } else {
        existing.addEventListener('load', () => resolve(window.google?.accounts?.id));
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google?.accounts?.id);
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });

  return gisPromise;
}

/**
 * Handles the credential response from GIS and returns a verified user object
 */
export async function handleGoogleCredentialResponse(response, clientId) {
  if (!response?.credential) {
    throw new Error('No credential received from Google Identity Services');
  }

  const payload = await verifyGoogleIdToken(response.credential, clientId);
  const user = {
    id: payload.sub,
    sub: payload.sub,
    name: payload.name || payload.email,
    email: payload.email,
    picture: payload.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(payload.email || payload.sub)}`,
    signedInAt: new Date().toISOString()
  };

  saveGoogleUser(user);
  return user;
}

export function getStoredGoogleUser() {
  try {
    const raw = localStorage.getItem(GOOGLE_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGoogleUser(user) {
  if (!user) {
    localStorage.removeItem(GOOGLE_USER_KEY);
  } else {
    localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(user));
  }
}

export function logoutGoogle() {
  saveGoogleUser(null);
}

/**
 * Resolves the storage key for an account:
 * - Google sub if signed in with Google
 * - Spotify user ID if Spotify connected without Google
 * - 'anonymous' for guest session
 * Never links accounts automatically based on email matching.
 */
export function getAccountKey(googleUser, authUser) {
  if (googleUser?.sub) return `google_${googleUser.sub}`;
  if (googleUser?.id) return `google_${googleUser.id}`;
  if (authUser?.id) return `spotify_${authUser.id}`;
  return 'anonymous';
}

export function getCrateHistory(accountKey = 'anonymous') {
  try {
    const raw = localStorage.getItem(`${CRATE_HISTORY_PREFIX}${accountKey}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSetToHistory(setRecord, accountKey = 'anonymous') {
  try {
    const current = getCrateHistory(accountKey);
    const entry = {
      id: `set_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      name: setRecord.name || 'Untitled Rave Experience',
      trackCount: setRecord.tracks?.length || 0,
      smoothPct: setRecord.evaluation?.smoothPct ?? 0,
      totalCost: setRecord.evaluation?.totalCost ?? 0,
      tracks: setRecord.tracks || [],
      evaluation: setRecord.evaluation || null,
      source: setRecord.source || 'Manual CSV'
    };

    // Keep up to 50 sets in history per account
    const updated = [entry, ...current.slice(0, 49)];
    localStorage.setItem(`${CRATE_HISTORY_PREFIX}${accountKey}`, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Could not save set to history:', err);
    return getCrateHistory(accountKey);
  }
}

export function clearCrateHistory(accountKey = 'anonymous') {
  localStorage.removeItem(`${CRATE_HISTORY_PREFIX}${accountKey}`);
}

/**
 * Forget This Device:
 * Permanently removes all local storage and session storage data associated
 * with Deck Order and Spotify sessions so a shared-device visitor leaves no trace.
 */
export function forgetThisDevice() {
  if (typeof localStorage !== 'undefined') {
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('deck_order_') || key.startsWith('spotify_'))) {
        localKeys.push(key);
      }
    }
    localKeys.forEach(k => localStorage.removeItem(k));
  }

  if (typeof sessionStorage !== 'undefined') {
    const sessionKeys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('deck_order_') || key.startsWith('spotify_'))) {
        sessionKeys.push(key);
      }
    }
    sessionKeys.forEach(k => sessionStorage.removeItem(k));
  }
}
