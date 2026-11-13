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
    const finishSuccess = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
      } else {
        gisPromise = null;
        reject(new Error('Google Identity Services loaded without accounts API'));
      }
    };
    const finishFailure = () => {
      gisPromise = null;
      reject(new Error('Failed to load Google Identity Services'));
    };

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
      } else {
        existing.addEventListener('load', finishSuccess, { once: true });
        existing.addEventListener('error', finishFailure, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = finishSuccess;
    script.onerror = finishFailure;
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

/**
 * Content signature of a saved set: name plus, per track IN ORDER, the
 * identity and every substantive field that defines this revision:
 * version/mix tag, recording identity (ISRC), tempo/key values, evidence
 * status, confidence (including user overrides) and review flags. Array
 * order is part of the signature, so a reordered set is a new revision; a
 * re-save after enrichment, an override or a review-flag change differs and
 * is kept as its own entry. Two saves with the same signature are the same
 * revision and the repeat is skipped.
 */
function trackSignatureIdentity(t) {
  if (!t || typeof t !== 'object') return '';
  // Stable recording identity: never the per-import generated id, which
  // changes on every import and would defeat duplicate detection across
  // sessions. Artist + title (or name) identify the track; version/mix tag, ISRC and
  // Spotify id (as available) remain separate signature fields below so
  // distinct recordings of the same song stay distinct revisions.
  const title = t.title || t.name || '';
  const artist = t.artist || '';
  const artistTitle = [artist, title].map(v => (v || '').trim()).filter(Boolean).join(' - ');
  return artistTitle || t.id || '';
}

function setSignature(name, tracks) {
  return JSON.stringify([
    name,
    (tracks || []).map(t => [
      trackSignatureIdentity(t),
      t.version ?? null,
      t.isrc ?? null,
      t.spotifyId ?? t.spotify_id ?? t.sourceSpotifyId ?? null,
      t.bpm ?? null,
      t.key ?? null,
      t.camelot ?? null,
      t.status ?? null,
      t.confidence ?? null,
      t.recordingNeedsReview === true,
      t.tempoNeedsReview === true
    ])
  ]);
}

export function saveSetToHistory(setRecord, accountKey = 'anonymous', { onError } = {}) {
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

    // Identical repeat saves (e.g. a double autosave of the same revision)
    // must not multiply entries. The existing entry already holds this exact
    // revision, so nothing is lost by skipping the duplicate. Existing
    // duplicates are left untouched - no destructive cleanup.
    const sig = setSignature(entry.name, entry.tracks);
    if (current.some(s => setSignature(s.name, s.tracks) === sig)) {
      return current;
    }

    // Keep up to 50 sets in history per account
    const updated = [entry, ...current.slice(0, 49)];
    try {
      localStorage.setItem(`${CRATE_HISTORY_PREFIX}${accountKey}`, JSON.stringify(updated));
      return updated;
    } catch (quotaErr) {
      // Storage full (or write blocked): never delete the user's existing
      // saved sets to make room. Leave history untouched and surface the
      // failure so the user can free space themselves.
      console.warn('Could not save set to history (storage full or blocked):', quotaErr);
      if (typeof onError === 'function') onError(quotaErr);
      return current;
    }
  } catch (err) {
    console.warn('Could not save set to history:', err);
    return getCrateHistory(accountKey);
  }
}

export function clearCrateHistory(accountKey = 'anonymous') {
  localStorage.removeItem(`${CRATE_HISTORY_PREFIX}${accountKey}`);
}

/**
 * Removes one saved set by id, preserving every other set for the account.
 * Returns the updated history array; unknown ids are a no-op.
 */
export function removeSetFromHistory(setId, accountKey = 'anonymous') {
  try {
    const current = getCrateHistory(accountKey);
    const updated = current.filter(s => s.id !== setId);
    if (updated.length !== current.length) {
      localStorage.setItem(`${CRATE_HISTORY_PREFIX}${accountKey}`, JSON.stringify(updated));
    }
    return updated;
  } catch (err) {
    console.warn('Could not remove set from history:', err);
    return getCrateHistory(accountKey);
  }
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

/** Update one explicit document identity. Never merge or trim other saved sets. */
export function updateActiveSet(setRecord, accountKey = 'anonymous', { onError } = {}) {
  const current = getCrateHistory(accountKey);
  try {
    if (!setRecord.id) throw new Error('Active set identity is required');
    const previous = current.find(s => s.id === setRecord.id);
    const entry = {
      ...previous, ...setRecord,
      timestamp: previous?.timestamp || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: setRecord.name || 'Untitled Set',
      trackCount: setRecord.tracks?.length || 0,
      smoothPct: setRecord.evaluation?.smoothPct ?? 0,
      totalCost: setRecord.evaluation?.totalCost ?? 0
    };
    const updated = previous ? current.map(s => s.id === entry.id ? entry : s) : [entry, ...current];
    localStorage.setItem(`${CRATE_HISTORY_PREFIX}${accountKey}`, JSON.stringify(updated));
    return { history: updated, saved: true };
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    return { history: current, saved: false };
  }
}
