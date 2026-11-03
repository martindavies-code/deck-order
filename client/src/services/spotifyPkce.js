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

export async function initiateSpotifyLogin(clientId, redirectUri = window.location.origin) {
  if (!clientId) {
    throw new Error('Spotify Client ID not provided. Set SPOTIFY_CLIENT_ID or use CSV mode.');
  }

  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlencode(hashed);

  window.sessionStorage.setItem('spotify_code_verifier', codeVerifier);

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
