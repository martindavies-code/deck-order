import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal Web Storage mocks (Map-backed, with key(i)/length for enumeration)
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

let localStore, sessionStore;
beforeEach(() => {
  localStore = makeStorage();
  sessionStore = makeStorage();
  globalThis.localStorage = localStore;
  globalThis.sessionStorage = sessionStore;
  globalThis.window = { localStorage: localStore, sessionStorage: sessionStore };
});

const pkce = await import('../client/src/services/spotifyPkce.js');
const googleAuth = await import('../client/src/services/googleAuth.js');

test('stay-signed-in preference persists across simulated OAuth redirect (fresh storage read)', () => {
  pkce.saveStaySignedInPreference(true);
  // simulate full page reload: component state gone, storage persists
  const tokens = pkce.getStoredSpotifyTokens();
  assert.equal(tokens.staySignedIn, true);
});

test('stay-signed-in preference off clears the flag', () => {
  pkce.saveStaySignedInPreference(true);
  pkce.saveStaySignedInPreference(false);
  assert.equal(localStore.getItem('deck_order_stay_signed_in'), null);
  assert.equal(pkce.getStoredSpotifyTokens().staySignedIn, false);
});

test('tokens save to localStorage when staying signed in, sessionStorage otherwise', () => {
  pkce.saveSpotifyTokens({ access_token: 'a1', refresh_token: 'r1' }, true);
  assert.equal(localStore.getItem('spotify_access_token'), 'a1');
  assert.equal(localStore.getItem('spotify_refresh_token'), 'r1');
  assert.equal(sessionStore.getItem('spotify_access_token'), null);

  pkce.saveSpotifyTokens({ access_token: 'a2', refresh_token: 'r2' }, false);
  assert.equal(sessionStore.getItem('spotify_access_token'), 'a2');
  assert.equal(localStore.getItem('spotify_access_token'), null);
  assert.equal(localStore.getItem('deck_order_stay_signed_in'), null);
});

test('clearSpotifyTokens wipes both stores and the preference (logout)', () => {
  pkce.saveSpotifyTokens({ access_token: 'a', refresh_token: 'r' }, true);
  pkce.clearSpotifyTokens();
  assert.equal(localStore.getItem('spotify_access_token'), null);
  assert.equal(localStore.getItem('spotify_refresh_token'), null);
  assert.equal(localStore.getItem('deck_order_stay_signed_in'), null);
  assert.equal(sessionStore.getItem('spotify_access_token'), null);
});

test('forgetThisDevice wipes every deck_order_* and spotify_* key', () => {
  pkce.saveSpotifyTokens({ access_token: 'a', refresh_token: 'r' }, true);
  localStore.setItem('deck_order_google_user', '{"id":"g1"}');
  localStore.setItem('deck_order_crate_history_google_g1', '[]');
  sessionStore.setItem('spotify_code_verifier', 'v');
  googleAuth.forgetThisDevice();
  assert.equal(localStore.length, 0);
  assert.equal(sessionStore.length, 0);
});

test('account isolation keys: google sub, google id, spotify id, anonymous are distinct', () => {
  assert.equal(googleAuth.getAccountKey({ sub: 'g1' }, null), 'google_g1');
  assert.equal(googleAuth.getAccountKey({ id: 'g2' }, null), 'google_g2');
  assert.equal(googleAuth.getAccountKey(null, { id: 's1' }), 'spotify_s1');
  assert.equal(googleAuth.getAccountKey(null, null), 'anonymous');
  assert.notEqual(googleAuth.getAccountKey({ sub: 'x' }, { id: 'x' }), googleAuth.getAccountKey(null, { id: 'x' }));
});

test('refresh-failure path: no refresh token stored means no silent recovery data', () => {
  pkce.saveSpotifyTokens({ access_token: 'a' }, true); // no refresh_token
  assert.equal(localStore.getItem('spotify_refresh_token'), null);
  assert.equal(pkce.getStoredSpotifyTokens().refreshToken, null);
});
