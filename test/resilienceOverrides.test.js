import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditLogger } from '../server/spotify/auditLogger.js';
import { ProviderCache } from '../server/providers/cache.js';
import { removeTrackAt, restoreTrackAt } from '../client/src/utils/trackBadges.js';
import { verifyTracklist } from '../client/src/services/api.js';

function makeStorage(options = {}) {
  const m = new Map();
  let failOnSize = options.failOnSize || Infinity;
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const str = String(v);
      if (str.length > failOnSize) {
        const err = new Error('QuotaExceededError: storage is full');
        err.name = 'QuotaExceededError';
        throw err;
      }
      m.set(k, str);
    },
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    setFailOnSize(n) { failOnSize = n; }
  };
}

let mockStorage;
beforeEach(() => {
  mockStorage = makeStorage();
  globalThis.localStorage = mockStorage;
  globalThis.sessionStorage = makeStorage();
});

const googleAuth = await import('../client/src/services/googleAuth.js');

test('auditLogger logs primitive strings under payload without character index spreading', () => {
  const testLogPath = './logs/test_write_audit.log';
  if (fs.existsSync(testLogPath)) fs.unlinkSync(testLogPath);

  auditLogger.logFilePath = path.resolve(testLogPath);
  auditLogger.log('START_RECONCILIATION', 'operation_id_12345');

  assert.ok(fs.existsSync(testLogPath));
  const line = fs.readFileSync(testLogPath, 'utf8').trim();
  const parsed = JSON.parse(line);

  assert.equal(parsed.action, 'START_RECONCILIATION');
  assert.equal(parsed.payload, 'operation_id_12345');
  assert.equal(parsed['0'], undefined, 'Must not spread characters into numeric properties');

  if (fs.existsSync(testLogPath)) fs.unlinkSync(testLogPath);
});

test('cache.buildKey handles null, whitespace isrc, and name-based queries safely', () => {
  const cache = new ProviderCache({ cacheFilePath: './cache/test_cache_keys.json' });

  assert.equal(cache.buildKey('freqblog', null), 'freqblog:invalid');
  assert.equal(cache.buildKey('freqblog', undefined), 'freqblog:invalid');

  // Whitespace-only ISRC should fall back to query
  const keyWhitespaceIsrc = cache.buildKey('freqblog', {
    isrc: '   ',
    artist: 'Bicep',
    title: 'Glue'
  });
  assert.equal(keyWhitespaceIsrc, 'freqblog:query:bicep:::glue:::');

  // Query with name instead of title
  const keyName = cache.buildKey('freqblog', {
    artist: 'Orbital',
    name: 'Belfast',
    version: 'Original Mix'
  });
  assert.equal(keyName, 'freqblog:query:orbital:::belfast:::original mix');
});

test('trackBadges removeTrackAt and restoreTrackAt guard against non-array and null inputs', () => {
  // removeTrackAt
  const remNull = removeTrackAt(null, 0);
  assert.deepEqual(remNull, { tracks: [], removed: null, index: -1 });

  const remUndef = removeTrackAt(undefined, 2);
  assert.deepEqual(remUndef, { tracks: [], removed: null, index: -1 });

  // restoreTrackAt
  const resNullTracks = restoreTrackAt(null, { title: 'T' }, 0);
  assert.deepEqual(resNullTracks, [{ title: 'T' }]);

  const resNullTrack = restoreTrackAt([{ title: 'A' }], null, 0);
  assert.deepEqual(resNullTrack, [{ title: 'A' }]);
});

test('googleAuth trackSignatureIdentity supports t.name when t.title is absent', () => {
  // Two different sets where tracks have name instead of title
  const set1 = {
    name: 'Set 1',
    tracks: [{ artist: 'Artist A', name: 'Track 1' }]
  };
  const set2 = {
    name: 'Set 2',
    tracks: [{ artist: 'Artist A', name: 'Track 2' }]
  };

  let h = googleAuth.saveSetToHistory(set1, 'user1');
  assert.equal(h.length, 1);

  h = googleAuth.saveSetToHistory(set2, 'user1');
  assert.equal(h.length, 2, 'Distinct tracks identified by name must not be treated as duplicates');
});

test('googleAuth saveSetToHistory preserves existing sets and reports failure on QuotaExceededError', () => {
  // First, populate history with 10 sets
  for (let i = 0; i < 10; i++) {
    googleAuth.saveSetToHistory({
      name: `Set ${i}`,
      tracks: [{ artist: 'Artist', title: `Track ${i}` }]
    }, 'user_quota');
  }

  const initial = googleAuth.getCrateHistory('user_quota');
  assert.equal(initial.length, 10);

  // Simulate storage nearing quota so the next write fails
  mockStorage.setFailOnSize(1400);

  let reported = null;
  const updated = googleAuth.saveSetToHistory({
    name: 'Set 11 (Newest)',
    tracks: [{ artist: 'Artist', title: 'Track 11' }]
  }, 'user_quota', { onError: (err) => { reported = err; } });

  assert.ok(reported, 'Save failure must be reported to the caller');
  const after = googleAuth.getCrateHistory('user_quota');
  assert.equal(after.length, 10, 'Existing saved sets must never be deleted to make room');
  assert.deepEqual(after.map(st => st.name), initial.map(st => st.name), 'Existing history order and content preserved');
  assert.equal(updated.length, 10, 'Unchanged history is returned when the save fails');
});

test('verifyTracklist exposes recordingReviewTracks and tempoReviewTracks in report', async () => {
  // Sample data path
  const sampleTracks = [{ id: 's1', artist: 'A', title: 'T', bpm: 120, camelot: '8A', isSampleData: true }];
  const sampleRes = await verifyTracklist(sampleTracks, true);
  assert.ok(Array.isArray(sampleRes.report.recordingReviewTracks), 'Sample report must contain recordingReviewTracks array');
  assert.ok(Array.isArray(sampleRes.report.tempoReviewTracks), 'Sample report must contain tempoReviewTracks array');

  // Offline/no-provider path
  const userTracks = [{ id: 'u1', artist: 'B', title: 'X', bpm: 125, camelot: '9A' }];
  const offlineRes = await verifyTracklist(userTracks, false);
  assert.ok(Array.isArray(offlineRes.report.recordingReviewTracks), 'Offline report must contain recordingReviewTracks array');
  assert.ok(Array.isArray(offlineRes.report.tempoReviewTracks), 'Offline report must contain tempoReviewTracks array');
});

test('verifyTracklist throws AbortError when AbortSignal is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await verifyTracklist([{ artist: 'A', title: 'T' }], false, null, { signal: controller.signal });
    },
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});
