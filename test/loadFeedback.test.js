import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFY_BATCH_TIMEOUT_MS,
  formatLoadProgress,
  fetchPlaylistItems,
  verifyTracklist,
  VERIFY_BATCH_SIZE
} from '../client/src/services/api.js';
import { removeSetFromHistory, saveSetToHistory, getCrateHistory } from '../client/src/services/googleAuth.js';

describe('formatLoadProgress: honest text from real signals only', () => {
  test('fetch stage with total: determinate ratio and "N of M" text', () => {
    const info = formatLoadProgress({ stage: 'fetch', fetched: 50, total: 67 });
    assert.equal(info.text, 'Loading tracks from Spotify - 50 of 67');
    assert.equal(info.determinate, true);
    assert.ok(Math.abs(info.ratio - 50 / 67) < 1e-9);
  });

  test('fetch stage without total: indeterminate, count so far, no fabricated percent', () => {
    const info = formatLoadProgress({ stage: 'fetch', fetched: 30, total: null });
    assert.equal(info.text, 'Loading tracks from Spotify - 30 so far');
    assert.equal(info.determinate, false);
    assert.equal(info.ratio, null);
  });

  test('fetch stage at click time (nothing fetched yet): indeterminate', () => {
    const info = formatLoadProgress({ stage: 'fetch', fetched: 0, total: null });
    assert.equal(info.text, 'Loading tracks from Spotify…');
    assert.equal(info.determinate, false);
  });

  test('verify stage: determinate checked-of-total', () => {
    const info = formatLoadProgress({ stage: 'verify', fetched: 20, total: 51 });
    assert.equal(info.text, 'Checking tempo and key - 20 of 51');
    assert.equal(info.determinate, true);
  });

  test('parse stage and null input', () => {
    assert.equal(formatLoadProgress({ stage: 'parse' }).text, 'Reading tracklist…');
    assert.equal(formatLoadProgress(null), null);
  });

  test('ratio never exceeds 1 when fetched overshoots total', () => {
    const info = formatLoadProgress({ stage: 'fetch', fetched: 80, total: 67 });
    assert.equal(info.ratio, 1);
    assert.equal(info.text, 'Loading tracks from Spotify - 67 of 67');
  });
});

describe('fetchPlaylistItems progress callbacks', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  const makeBatch = (count, startIdx) =>
    Array.from({ length: count }, (_, i) => ({
      added_at: '2026-02-15T12:00:00Z',
      item: {
        type: 'track',
        id: `track_${startIdx + i}`,
        name: `Track ${startIdx + i}`,
        uri: `spotify:track:track_${startIdx + i}`,
        duration_ms: 200000,
        artists: [{ name: 'Artist' }],
        album: { name: 'Album' }
      }
    }));

  test('reports fetched-of-total after every page', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.startsWith('/api/spotify/playlists/')) {
        throw new TypeError('Failed to fetch: Connection refused');
      }
      if (urlStr.includes('offset=50')) {
        return { ok: true, status: 200, json: async () => ({ items: makeBatch(17, 51), next: null, total: 67 }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: makeBatch(50, 1), next: 'https://api.spotify.com/v1/playlists/pl/items?offset=50&limit=50', total: 67 }) };
    };
    const events = [];
    const result = await fetchPlaylistItems('tok', 'pl', (p) => events.push(p));
    assert.equal(result.items.length, 67);
    assert.deepEqual(events, [
      { stage: 'fetch', fetched: 50, total: 67 },
      { stage: 'fetch', fetched: 67, total: 67 }
    ]);
  });

  test('no onProgress passed: still works (backwards compatible)', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.startsWith('/api/spotify/playlists/')) throw new TypeError('no local server');
      return { ok: true, status: 200, json: async () => ({ items: makeBatch(3, 1), next: null, total: 3 }) };
    };
    const result = await fetchPlaylistItems('tok', 'pl');
    assert.equal(result.items.length, 3);
  });
});

describe('verifyTracklist batched provider verification', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  const makeTracks = (n) => Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Song ${i}`, artist: 'DJ Test', bpm: null, camelot: null
  }));

  const providerResponseFor = (batch) => ({
    tracks: batch.map(t => ({ ...t, bpm: 128, camelot: '8A', status: 'verified' })),
    report: {
      total: batch.length, verified: batch.length, singleSource: 0, disputed: 0,
      unverified: 0, disputedTracks: [], unverifiedTracks: [], tempoReviewTracks: [],
      summaryText: ''
    }
  });

  test('23 tracks: 3 batches, per-batch progress, order preserved, merged report', async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.tracks.map(t => t.id));
      return { ok: true, status: 200, json: async () => providerResponseFor(body.tracks) };
    };
    const events = [];
    const res = await verifyTracklist(makeTracks(23), false, (p) => events.push(p));
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(c => c.length), [VERIFY_BATCH_SIZE, VERIFY_BATCH_SIZE, 3]);
    assert.deepEqual(events.filter(e => e.phase !== 'start'), [
      { stage: 'verify', fetched: 10, total: 23 },
      { stage: 'verify', fetched: 20, total: 23 },
      { stage: 'verify', fetched: 23, total: 23 }
    ]);
    assert.deepEqual(res.tracks.map(t => t.id), makeTracks(23).map(t => t.id), 'original order preserved');
    assert.equal(res.report.corroborated, 23);
    assert.equal(res.report.missing, 0);
    assert.equal(res.report.checkedCount, 23);
    assert.equal(res.report.uncheckedCount, 0);
    assert.equal(res.report.providerConfigured, true);
    assert.equal(res.report.providerUnreachable, false);
    assert.equal(res.tracks[0].status, 'corroborated', 'verified renamed to corroborated');
  });

  test('total provider failure: honest unchecked marking, never a fake provider result', async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const res = await verifyTracklist(makeTracks(7), false, () => {});
    assert.equal(res.report.providerUnreachable, true);
    assert.equal(res.report.providerPartialFailure, false);
    assert.equal(res.report.checkedCount, 0);
    assert.equal(res.report.uncheckedCount, 7);
    assert.equal(res.report.missing, 7);
    assert.ok(res.tracks.every(t => t.status === 'missing'));
    assert.match(res.tracks[0].reason, /did not finish/);
  });

  test('stops after 2 consecutive batch failures; remaining tracks unchecked', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 502, json: async () => ({}) }; };
    const res = await verifyTracklist(makeTracks(45), false, () => {});
    assert.equal(calls, 2, 'fail-fast: later batches never attempted');
    assert.equal(res.report.providerUnreachable, true);
    assert.equal(res.report.uncheckedCount, 45);
  });

  test('partial failure: checked tracks keep provider results, rest honestly marked', async () => {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      if (calls === 2) throw new TypeError('provider timeout');
      return { ok: true, status: 200, json: async () => providerResponseFor(body.tracks) };
    };
    const events = [];
    const res = await verifyTracklist(makeTracks(25), false, (p) => events.push(p));
    assert.equal(calls, 3);
    assert.equal(res.report.providerPartialFailure, true);
    assert.equal(res.report.providerUnreachable, false);
    // Batch 1 (10 tracks) and batch 3 (5 tracks) succeeded; batch 2 failed.
    assert.equal(res.report.checkedCount, 15);
    assert.equal(res.report.uncheckedCount, 10);
    assert.equal(res.report.corroborated, 15);
    assert.equal(res.report.missing, 10);
    assert.equal(res.tracks[0].status, 'corroborated');
    assert.equal(res.tracks[10].status, 'missing');
    assert.equal(res.tracks[19].status, 'missing');
    assert.equal(res.tracks[20].status, 'corroborated');
    assert.deepEqual(events.filter(e => e.phase !== 'start').map(e => e.fetched), [10, 15]);
  });

  test('tracks carrying their own bpm/key stay "supplied" even when provider fails', async () => {
    globalThis.fetch = async () => { throw new TypeError('down'); };
    const tracks = [{ id: 'a', title: 'X', artist: 'Y', bpm: 128, camelot: '8A' }];
    const res = await verifyTracklist(tracks, false, () => {});
    assert.equal(res.tracks[0].status, 'supplied');
    assert.equal(res.report.supplied, 1);
    assert.equal(res.report.providerUnreachable, true);
  });

  test('sample data path unchanged by batching', async () => {
    let called = 0;
    globalThis.fetch = async () => { called++; throw new Error('should not be called'); };
    const res = await verifyTracklist([{ id: 's1', title: 'S', artist: 'A', bpm: 128, camelot: '8A' }], true);
    assert.equal(called, 0);
    assert.equal(res.tracks[0].status, 'sample');
    assert.equal(res.report.sample, 1);
  });
});

describe('removeSetFromHistory: per-set deletion', () => {
  const store = new Map();
  const originalLS = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: () => null,
    get length() { return store.size; }
  };

  test('removes only the targeted set and preserves the others', () => {
    store.clear();
    const acct = 'test_acct_perset';
    saveSetToHistory({ name: 'Set One', tracks: [{}] }, acct);
    saveSetToHistory({ name: 'Set Two', tracks: [{}, {}] }, acct);
    saveSetToHistory({ name: 'Set Three', tracks: [{}] }, acct);
    const before = getCrateHistory(acct);
    assert.equal(before.length, 3);

    const updated = removeSetFromHistory(before[1].id, acct);
    assert.equal(updated.length, 2);
    assert.deepEqual(updated.map(s => s.name), ['Set Three', 'Set One']);
    // Persisted, not just in-memory
    assert.deepEqual(getCrateHistory(acct).map(s => s.name), ['Set Three', 'Set One']);
  });

  test('unknown id is a no-op and leaves storage untouched', () => {
    const acct = 'test_acct_perset';
    const before = getCrateHistory(acct);
    const after = removeSetFromHistory('set_does_not_exist', acct);
    assert.equal(after.length, before.length);
    assert.deepEqual(after.map(s => s.id), before.map(s => s.id));
  });

  test('other accounts are not affected', () => {
    const acctA = 'test_acct_a';
    const acctB = 'test_acct_b';
    saveSetToHistory({ name: 'A1', tracks: [] }, acctA);
    saveSetToHistory({ name: 'B1', tracks: [] }, acctB);
    const aSets = getCrateHistory(acctA);
    removeSetFromHistory(aSets[0].id, acctA);
    assert.equal(getCrateHistory(acctA).length, 0);
    assert.equal(getCrateHistory(acctB).length, 1);
    assert.equal(getCrateHistory(acctB)[0].name, 'B1');
  });

  test('cleanup: restore localStorage', () => {
    if (originalLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLS;
    assert.ok(true);
  });
});

describe('verifyTracklist: no blind automatic retry', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  const makeTracks = (n) => Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Song ${i}`, artist: 'DJ Test', bpm: null, camelot: null
  }));

  test('a failed batch gets exactly ONE attempt - no duplicate provider jobs from a blind retry', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('The operation timed out'); };
    const res = await verifyTracklist(makeTracks(10), false, () => {});
    assert.equal(calls, 1, 'single attempt; the provider KV-caches only completed work, so a retry while the first attempt is mid-analysis would duplicate provider jobs');
    assert.equal(res.report.providerUnreachable, true);
    assert.equal(res.report.uncheckedCount, 10);
  });

  test('per-batch timeout exceeds the measured cold-batch server time (>120s for 10 niche tracks)', () => {
    assert.ok(VERIFY_BATCH_TIMEOUT_MS >= 240000,
      `timeout ${VERIFY_BATCH_TIMEOUT_MS}ms must comfortably exceed the measured >120s cold-batch analysis so the client never aborts mid-analysis`);
  });

  test('a slow batch that completes inside the timeout succeeds with exactly one request', async () => {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      await new Promise(r => setTimeout(r, 150)); // slow but well inside the timeout
      return { ok: true, status: 200, json: async () => ({
        tracks: body.tracks.map(t => ({ ...t, bpm: 128, camelot: '8A', status: 'verified' })),
        report: { total: body.tracks.length, verified: body.tracks.length, singleSource: 0, disputed: 0, unverified: 0, disputedTracks: [], unverifiedTracks: [], tempoReviewTracks: [], summaryText: '' }
      }) };
    };
    const events = [];
    const res = await verifyTracklist(makeTracks(10), false, (p) => events.push(p));
    assert.equal(calls, 1);
    assert.equal(res.report.checkedCount, 10);
    assert.equal(res.report.providerUnreachable, false);
    // batch-start event announces batch 1 before the completed-count event
    assert.deepEqual(events.filter(e => e.stage === 'verify').map(e => e.phase === 'start' ? `start:${e.batch}` : `done:${e.fetched}`),
      ['start:1', 'done:10']);
  });
});

describe('integrated 51-track route: Spotify paging + batched verify', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('full deterministic pipeline: pages, batches, progress order, no duplicates', async () => {
    const makePage = (count, startIdx) =>
      Array.from({ length: count }, (_, i) => ({
        added_at: '2026-02-15T12:00:00Z',
        item: {
          type: 'track',
          id: `sp_${startIdx + i}`,
          name: `Tune ${startIdx + i}`,
          uri: `spotify:track:sp_${startIdx + i}`,
          duration_ms: 300000,
          artists: [{ name: 'Artist' }],
          album: { name: 'Album' }
        }
      }));

    const verifyCalls = [];
    let verifyAttempts = 0;
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      // No local proxy server
      if (urlStr.startsWith('/api/spotify/playlists/')) throw new TypeError('connection refused');
      // Spotify paging: 50 + 1
      if (urlStr.includes('offset=50')) {
        return { ok: true, status: 200, json: async () => ({ items: makePage(1, 51), next: null, total: 51 }) };
      }
      if (urlStr.includes('/playlists/nu_disko/items')) {
        return { ok: true, status: 200, json: async () => ({ items: makePage(50, 1), next: 'https://api.spotify.com/v1/playlists/nu_disko/items?offset=50&limit=50', total: 51 }) };
      }
      // Provider verify: all batches succeed
      if (urlStr.endsWith('/api/pipeline/verify')) {
        verifyAttempts++;
        const body = JSON.parse(options.body);
        verifyCalls.push(body.tracks.map(t => t.id));
        return {
          ok: true, status: 200,
          json: async () => ({
            tracks: body.tracks.map(t => ({ ...t, bpm: 122, camelot: '3B', status: 'single_source' })),
            report: { total: body.tracks.length, verified: 0, singleSource: body.tracks.length, disputed: 0, unverified: 0, disputedTracks: [], unverifiedTracks: [], tempoReviewTracks: [], summaryText: '' }
          })
        };
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    };

    const events = [];
    const data = await fetchPlaylistItems('tok', 'nu_disko', (p) => events.push(p));
    assert.equal(data.items.length, 51);
    const res = await verifyTracklist(data.items, false, (p) => events.push(p));

    assert.deepEqual(
      events.filter(e => e.stage === 'fetch').map(e => `${e.fetched}/${e.total}`),
      ['50/51', '51/51']
    );
    const verifyDone = events.filter(e => e.stage === 'verify' && e.phase !== 'start');
    assert.deepEqual(verifyDone.map(e => e.fetched), [10, 20, 30, 40, 50, 51]);
    const verifyStarts = events.filter(e => e.stage === 'verify' && e.phase === 'start');
    assert.deepEqual(verifyStarts.map(e => e.batch), [1, 2, 3, 4, 5, 6], 'each batch announced before it runs');
    assert.equal(res.tracks.length, 51);
    assert.deepEqual(res.tracks.map(t => t.id), data.items.map(t => t.id), 'order preserved end to end');
    assert.equal(res.report.singleSource, 51);
    assert.equal(res.report.missing, 0);
    assert.equal(res.report.checkedCount, 51);
    assert.equal(res.report.providerUnreachable, false);
    assert.equal(res.report.providerPartialFailure, false);
    assert.equal(verifyCalls.length, 6, 'exactly one request per batch, no retries');
    const allIds = verifyCalls.flat();
    assert.equal(new Set(allIds).size, 51, 'each track verified exactly once across batches');
  });

  test('one cold batch timing out yields honest partial state, not an all-missing wipeout or wrong copy', async () => {
    const makePage = (count, startIdx) =>
      Array.from({ length: count }, (_, i) => ({
        added_at: '2026-02-15T12:00:00Z',
        item: {
          type: 'track',
          id: `sp_${startIdx + i}`,
          name: `Tune ${startIdx + i}`,
          uri: `spotify:track:sp_${startIdx + i}`,
          duration_ms: 300000,
          artists: [{ name: 'Artist' }],
          album: { name: 'Album' }
        }
      }));

    let verifyCalls = 0;
    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      if (urlStr.startsWith('/api/spotify/playlists/')) throw new TypeError('connection refused');
      if (urlStr.includes('offset=50')) {
        return { ok: true, status: 200, json: async () => ({ items: makePage(1, 51), next: null, total: 51 }) };
      }
      if (urlStr.includes('/playlists/nu_disko/items')) {
        return { ok: true, status: 200, json: async () => ({ items: makePage(50, 1), next: 'https://api.spotify.com/v1/playlists/nu_disko/items?offset=50&limit=50', total: 51 }) };
      }
      if (urlStr.endsWith('/api/pipeline/verify')) {
        verifyCalls++;
        const body = JSON.parse(options.body);
        if (verifyCalls === 2) throw new Error('The operation timed out'); // batch 2 dies mid-analysis
        return {
          ok: true, status: 200,
          json: async () => ({
            tracks: body.tracks.map(t => ({ ...t, bpm: 122, camelot: '3B', status: 'single_source' })),
            report: { total: body.tracks.length, verified: 0, singleSource: body.tracks.length, disputed: 0, unverified: 0, disputedTracks: [], unverifiedTracks: [], tempoReviewTracks: [], summaryText: '' }
          })
        };
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    };

    const data = await fetchPlaylistItems('tok', 'nu_disko', () => {});
    const res = await verifyTracklist(data.items, false, () => {});

    assert.equal(verifyCalls, 6, 'batch 2 got one attempt; later batches still ran');
    assert.equal(res.report.checkedCount, 41);
    assert.equal(res.report.missing, 10);
    assert.equal(res.report.providerPartialFailure, true);
    assert.equal(res.report.providerUnreachable, false);
    const missing = res.tracks.filter(t => t.status === 'missing');
    assert.equal(missing.length, 10);
    assert.match(missing[0].reason, /did not finish/, 'honest reason, never the "no provider configured" copy');
    assert.deepEqual(missing.map(t => t.id), data.items.slice(10, 20).map(t => t.id), 'exactly batch 2 tracks are missing');
  });
});
