/**
 * Spotify PKCE (Proof Key for Code Exchange) Helper
 * Standard OAuth 2.0 PKCE flow - completely secretless in the browser.
 */

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values).map(x => possible[x % possible.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(a) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Returns the exact Spotify redirect URI conforming to 2026 Spotify policies:
 * - Production on GitHub Pages: https://martindavies-code.github.io/deck-order/
 * - Local Dev: http://127.0.0.1:5173/deck-order/ (Spotify forbids 'localhost')
 */
export function getSpotifyRedirectUri() {
  let origin = window.location.origin;
  // Spotify forbids localhost redirect URIs - normalize to 127.0.0.1 loopback IP
  if (origin.includes('localhost')) {
    origin = origin.replace('localhost', '127.0.0.1');
  }

  const base = import.meta.env.BASE_URL || '/';
  const baseNorm = base.startsWith('/') ? base : `/${base}`;
  const uri = `${origin}${baseNorm}`;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/**
 * Initiates Spotify PKCE Authorization Code flow using build-time Client ID.
 * Never prompts the user for a Client ID.
 */
export async function initiateSpotifyLogin() {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("Spotify isn't configured for this deployment. Paste or upload a tracklist instead.");
  }

  const redirectUri = getSpotifyRedirectUri();
  const codeVerifier = generateRandomString(64);
  const state = generateRandomString(16);

  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlencode(hashed);

  window.sessionStorage.setItem('spotify_code_verifier', codeVerifier);
  window.sessionStorage.setItem('spotify_auth_state', state);

  const scope = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public'
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', codeChallenge);

  window.location.href = authUrl.toString();
}

export function getStoredCodeVerifier() {
  return window.sessionStorage.getItem('spotify_code_verifier');
}

export function clearStoredCodeVerifier() {
  window.sessionStorage.removeItem('spotify_code_verifier');
}

export function verifyAndClearAuthState(incomingState) {
  const expectedState = window.sessionStorage.getItem('spotify_auth_state');
  window.sessionStorage.removeItem('spotify_auth_state');
  if (!expectedState || !incomingState || expectedState !== incomingState) {
    return false;
  }
  return true;
}

/**
 * Token Storage Management:
 * By default, stores tokens in sessionStorage (dies with browser session).
 * Persists to localStorage only if explicit staySignedIn flag is passed.
 */
export function getStoredSpotifyTokens() {
  if (typeof window === 'undefined') return { accessToken: null, refreshToken: null };
  const staySignedIn = localStorage.getItem('deck_order_stay_signed_in') === 'true';
  const accessToken = sessionStorage.getItem('spotify_access_token') || localStorage.getItem('spotify_access_token');
  const refreshToken = sessionStorage.getItem('spotify_refresh_token') || localStorage.getItem('spotify_refresh_token');
  return { accessToken, refreshToken, staySignedIn };
}

export function saveSpotifyTokens({ access_token, refresh_token }, staySignedIn = false) {
  if (staySignedIn) {
    localStorage.setItem('spotify_access_token', access_token);
    if (refresh_token) localStorage.setItem('spotify_refresh_token', refresh_token);
    localStorage.setItem('deck_order_stay_signed_in', 'true');
    sessionStorage.removeItem('spotify_access_token');
    sessionStorage.removeItem('spotify_refresh_token');
  } else {
    sessionStorage.setItem('spotify_access_token', access_token);
    if (refresh_token) sessionStorage.setItem('spotify_refresh_token', refresh_token);
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('deck_order_stay_signed_in');
  }
}

export function clearSpotifyTokens() {
  sessionStorage.removeItem('spotify_access_token');
  sessionStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('deck_order_stay_signed_in');
}
