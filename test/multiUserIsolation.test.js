import test from 'node:test';
import assert from 'node:assert/strict';

// Create browser-like Web Storage polyfill for Node.js test environment
class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return Array.from(this.store.keys())[index] || null;
  }
}

globalThis.localStorage = new MockStorage();
globalThis.sessionStorage = new MockStorage();

const {
  getAccountKey,
  getCrateHistory,
  saveSetToHistory,
  clearCrateHistory,
  forgetThisDevice
} = await import('../client/src/services/googleAuth.js');

test('Multi-User Data Isolation: Two Accounts on One Browser (Fix 6)', async (t) => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  const userA = {
    id: 'user_a_123',
    sub: 'user_a_123',
    name: 'DJ Alice',
    email: 'alice@deckorder.test'
  };

  const userB = {
    id: 'user_b_456',
    sub: 'user_b_456',
    name: 'DJ Bob',
    email: 'bob@deckorder.test'
  };

  await t.test('Account A signs in and saves a set', () => {
    const keyA = getAccountKey(userA, null);
    assert.equal(keyA, 'google_user_a_123');

    const historyAInitial = getCrateHistory(keyA);
    assert.equal(historyAInitial.length, 0);

    const savedA = saveSetToHistory({
      name: 'Alice Summer Festival Set',
      tracks: [{ title: 'Bicep - Glue', bpm: 130, camelot: '8A' }],
      evaluation: { smoothPct: 100, totalCost: 0 }
    }, keyA);

    assert.equal(savedA.length, 1);
    assert.equal(savedA[0].name, 'Alice Summer Festival Set');
    assert.equal(getCrateHistory(keyA).length, 1);
  });

  await t.test('Switch to Account B: confirms zero history from Account A is visible', () => {
    const keyB = getAccountKey(userB, null);
    assert.equal(keyB, 'google_user_b_456');

    const historyB = getCrateHistory(keyB);
    assert.equal(historyB.length, 0, "Account B must not see any of Account A's saved sets");
  });

  await t.test('Account B saves its own distinct set', () => {
    const keyB = getAccountKey(userB, null);
    const savedB = saveSetToHistory({
      name: 'Bob Warehouse Techno',
      tracks: [{ title: 'Overmono - Good Lies', bpm: 134, camelot: '4A' }],
      evaluation: { smoothPct: 90, totalCost: 2 }
    }, keyB);

    assert.equal(savedB.length, 1);
    assert.equal(savedB[0].name, 'Bob Warehouse Techno');

    // Confirm Account A's history remains untouched and isolated
    const keyA = getAccountKey(userA, null);
    const historyA = getCrateHistory(keyA);
    assert.equal(historyA.length, 1);
    assert.equal(historyA[0].name, 'Alice Summer Festival Set');
  });

  await t.test('Sign out of both: anonymous session sees no private sets', () => {
    const anonKey = getAccountKey(null, null);
    assert.equal(anonKey, 'anonymous');

    const anonHistory = getCrateHistory(anonKey);
    assert.equal(anonHistory.length, 0, 'Anonymous visitor must not see sets from either authenticated account');
  });

  await t.test('Never auto-link identities because emails match', () => {
    // Both share email 'shared@example.com'
    const googleIdentity = { sub: 'google_id_777', email: 'shared@example.com' };
    const spotifyIdentity = { id: 'spotify_user_888', email: 'shared@example.com' };

    const keyGoogle = getAccountKey(googleIdentity, null);
    const keySpotify = getAccountKey(null, spotifyIdentity);

    assert.notEqual(keyGoogle, keySpotify, 'Identities with identical emails must never be conflated');
    assert.equal(keyGoogle, 'google_google_id_777');
    assert.equal(keySpotify, 'spotify_spotify_user_888');
  });

  await t.test('Forget This Device wipes all local data and tokens', () => {
    // Put fake tokens in localStorage and sessionStorage
    globalThis.localStorage.setItem('spotify_access_token', 'token_secret_123');
    globalThis.sessionStorage.setItem('spotify_code_verifier', 'verifier_xyz');

    assert.ok(globalThis.localStorage.length > 0);
    assert.ok(globalThis.sessionStorage.length > 0);

    forgetThisDevice();

    assert.equal(globalThis.localStorage.length, 0, 'All deck_order_* and spotify_* keys must be removed');
    assert.equal(globalThis.sessionStorage.length, 0, 'All session tokens must be purged');
  });
});
