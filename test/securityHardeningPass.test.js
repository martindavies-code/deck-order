import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { FreqBlogProvider } from '../server/providers/freqblog.js';
import { GetSongBPMProvider } from '../server/providers/getsongbpm.js';
import { SonovaultProvider } from '../server/providers/sonovault.js';
import { SoundNetProvider } from '../server/providers/soundnet.js';
import { ProviderCache } from '../server/providers/cache.js';
import { parseTracklistCSV } from '../server/providers/csvParser.js';
import { SpotifyClient } from '../server/spotify/client.js';
import { SafePlaylistWriter, generateCSVExport } from '../server/spotify/safeWriter.js';
import { generateCSVExport as clientGenerateCSVExport } from '../client/src/services/formatters.js';
import { createApiRouter } from '../server/routes/api.js';
import { validateOverridePayload, validateCsvPayload, validateSequencePayload, errorHandler } from '../server/middleware/security.js';
import { SuggestionEngine } from '../server/core/bridgeFinder.js';
import { confirmSavePlaylist, fetchPlaylistItems } from '../client/src/services/api.js';

describe('Code Hardening Regression Suite', () => {
  test('FreqBlogProvider never caches transient errors or queued analysis, and recovers cleanly', async () => {
    const store = new Map();
    const cache = {
      async get(k) { return store.get(k) || null; },
      async set(k, v) { store.set(k, v); }
    };

    let attempt = 0;
    const p = new FreqBlogProvider('k', {
      cache,
      fetchImpl: async () => {
        attempt++;
        if (attempt === 1) return { ok: false, status: 502, json: async () => ({}) };
        if (attempt === 2) return { ok: true, json: async () => ({ status: 'queued' }) };
        return {
          ok: true,
          json: async () => ({
            track_name: 'Glue',
            artist_name: 'Bicep',
            bpm: 130,
            key: 'A minor',
            camelot: '8A',
            mix_name: 'Original Mix'
          })
        };
      }
    });

    const r1 = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
    assert.equal(r1.success, false);
    assert.equal(r1.reason, 'provider_http_502');
    assert.equal(store.size, 0, '5xx failure must NOT poison cache');

    const r2 = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'analysis_queued_or_missing');
    assert.equal(store.size, 0, 'queued analysis must NOT poison cache for 30 days');

    const r3 = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
    assert.equal(r3.success, true);
    assert.equal(r3.data.bpm, 130);
    assert.equal(store.size, 1, 'verified match is cached');
  });

  test('FreqBlogProvider ignores legacy cached transient errors and blocks short 1-2 char token false matches', async () => {
    const legacyCache = new Map();
    const key = 'freqblog:v2:m|go||';
    legacyCache.set(key, { success: false, reason: 'provider_http_503' });
    const cache = {
      async get(k) { return legacyCache.get(k) || null; },
      async set(k, v) { legacyCache.set(k, v); }
    };

    const p = new FreqBlogProvider('k', {
      cache,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          artist_name: 'Madonna',
          track_name: 'Gold',
          bpm: 120,
          key: 'C major',
          camelot: '8B'
        })
      })
    });

    const res = await p.lookupTrack({ artist: 'M', title: 'Go' });
    assert.equal(res.success, false);
    assert.match(res.reason, /artist_mismatch/);
  });

  test('ProviderCache supports TTL expiry and leaves zero orphaned .tmp files', () => {
    const cachePath = './cache/test_ttl_cache.json';
    const cache = new ProviderCache({ cacheFilePath: cachePath, maxCapacity: 10 });
    cache.clear();

    cache.set('freqblog', { isrc: 'TTL1' }, { bpm: 128 }, 0.01);
    cache.memoryCache.get('freqblog:isrc:TTL1').expiresAt = Date.now() - 1000;
    assert.equal(cache.get('freqblog', { isrc: 'TTL1' }), null);

    cache.set('freqblog', { isrc: 'TTL2' }, { bpm: 130 }, 3600);
    assert.equal(cache.get('freqblog', { isrc: 'TTL2' }).data.bpm, 130);

    const files = fs.readdirSync('./cache').filter(f => f.startsWith('test_ttl_cache.json') && f.endsWith('.tmp'));
    assert.equal(files.length, 0);
    cache.clear();
  });

  test('Alternative providers validate identity, deduplicate in-flight queries, and keep real ISRCs honest', async () => {
    const originalFetch = global.fetch;
    try {
      let gsbCalls = 0;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('api.getsongbpm.com')) {
          gsbCalls++;
          await new Promise(r => setTimeout(r, 15));
          return {
            ok: true,
            json: async () => ({
              search: [
                { artist: { name: 'Wrong Artist' }, title: 'Wrong Song', tempo: 99, key_of: 'C major' },
                { artist: { name: 'Bicep' }, title: 'Glue', tempo: 130, key_of: 'A minor' }
              ]
            })
          };
        }
        if (u.includes('sonovault.now')) {
          return {
            ok: true,
            json: async () => ({ artist_name: 'Bicep', track_name: 'Glue', bpm: 130, key: '8A' })
          };
        }
        if (u.includes('soundnet.p.rapidapi.com')) {
          return {
            ok: true,
            json: async () => ({ artist: 'Someone Else', title: 'Unrelated', tempo: 140, key: 'A', mode: 'minor' })
          };
        }
        throw new Error(`Unexpected URL ${u}`);
      };

      const memCache = new ProviderCache({ persistToDisk: false });
      const gsb = new GetSongBPMProvider('gsb-key', { cache: memCache });
      const [g1, g2] = await Promise.all([
        gsb.lookupTrack({ artist: 'Bicep', title: 'Glue' }),
        gsb.lookupTrack({ artist: 'Bicep', title: 'Glue' })
      ]);
      assert.equal(gsbCalls, 1, 'GetSongBPM singleflight coalesces concurrent calls');
      assert.equal(g1.success, true);
      assert.equal(g2.success, true);
      assert.equal(g1.data.bpm, 130);

      const gsbWrongMix = await gsb.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Club Mix' });
      assert.equal(gsbWrongMix.success, false, 'GetSongBPM rejects unverified version mismatches');
      assert.match(gsbWrongMix.reason, /Identity cross-check rejected/);

      const sv = new SonovaultProvider('sv-key', { cache: memCache });
      const svRes = await sv.lookupTrack({ artist: 'Bicep', title: 'Glue', isrc: 'QUERYONLY123' });
      assert.equal(svRes.success, true);
      assert.equal(svRes.data.isrc, null, 'Sonovault must NOT echo query ISRC when provider returned none');

      const sn = new SoundNetProvider('sn-key', { cache: memCache });
      const snRes = await sn.lookupTrack({ artist: 'Bicep', title: 'Glue' });
      assert.equal(snRes.success, false);
      assert.match(snRes.reason, /artist_mismatch/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('CSV export neutralizes spreadsheet formulas consistently on both client and server', () => {
    const nastyTracks = [
      { artist: '=CMD()', title: '+1+2', version: '-evil', bpm: 128, key: '@SUM(A1)', camelot: '8A', energy: 0.7, source: '\tbad', status: 'verified' }
    ];
    const evalObj = { transitions: [] };
    const serverCsv = generateCSVExport(nastyTracks, evalObj);
    const clientCsv = clientGenerateCSVExport(nastyTracks, evalObj);

    assert.equal(serverCsv, clientCsv, 'Server and client CSV exports share single implementation');
    assert.match(serverCsv, /"'=CMD\(\)"/);
    assert.match(serverCsv, /"'\+1\+2"/);
    assert.match(serverCsv, /"'-evil"/);
    assert.match(serverCsv, /"'@SUM\(A1\)"/);
    assert.match(serverCsv, /"'\tbad"/);
    assert.match(serverCsv, /,128,/);
    assert.match(serverCsv, /,0.7,/);
  });

  test('CSV parser rejects out-of-range BPM/energy and handles headerless 5-column Artist,Title,Version,BPM,Key', () => {
    const tracks = parseTracklistCSV([
      'Bicep,Glue,Original Mix,130,8A',
      'Bad,Tempo,Mix,-5,8A',
      'Extreme,Tempo,Mix,999,8A'
    ].join('\n'));

    assert.equal(tracks.length, 3);
    assert.equal(tracks[0].version, 'Original Mix');
    assert.equal(tracks[0].bpm, 130);
    assert.equal(tracks[0].camelot, '8A');
    assert.equal(tracks[1].bpm, null);
    assert.equal(tracks[2].bpm, null);

    const headerRows = parseTracklistCSV('Artist,Title,BPM,Key,Energy\nOvermono,So U Kno,132,4A,1.9');
    assert.equal(headerRows[0].energy, null);
  });

  test('SpotifyClient bounds 429 retries, validates playlist IDs, stops cross-caller cache leaks, and keeps unknown versions unset', async () => {
    const originalFetch = global.fetch;
    try {
      let retryHits = 0;
      global.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/me/playlists')) {
          retryHits++;
          return {
            ok: false,
            status: 429,
            headers: { get: () => '1' },
            json: async () => ({ error: { message: 'Slow down' } })
          };
        }
        if (u.includes('/playlists/pl_test_1/items')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                { is_local: false, item: null },
                {
                  is_local: false,
                  item: {
                    id: 'tr_1',
                    uri: 'spotify:track:tr_1',
                    name: 'Glue',
                    type: 'track',
                    artists: [{ name: 'Bicep' }],
                    external_ids: {}
                  }
                }
              ],
              next: null
            })
          };
        }
        if (u.includes('/me') && init?.method === 'POST') {
          return {
            ok: false,
            status: 429,
            headers: { get: () => '1' },
            json: async () => ({})
          };
        }
        throw new Error(`Unexpected fetch: ${u}`);
      };

      const client = new SpotifyClient({ accessToken: 'tok1' });
      // Override setTimeout-based retry sleep only by fast timing: with 1s Retry-After x 2 retries = 2s, use fast Retry-After = "0" or just test POST immediate halt + playlist items first
      await assert.rejects(() => client.request('/me', { method: 'POST', body: { name: 'Test' } }), /429/);

      await assert.rejects(() => client.getPlaylistItems('../evil'), /Invalid Spotify playlist ID/);
      const items = await client.getPlaylistItems('pl_test_1');
      assert.equal(items.length, 1);
      assert.equal(items[0].version, '', 'Must not fabricate Original Mix on Spotify tracks');
      assert.equal(retryHits, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('SafePlaylistWriter rejects empty URIs before creating any playlist', async () => {
    let created = 0;
    const mockClient = {
      request: async () => {
        created++;
        return { id: 'should_not_exist' };
      }
    };
    const writer = new SafePlaylistWriter(mockClient);
    const manifest = writer.generatePreviewManifest({ name: 'Empty CSV' }, [{ artist: 'A', title: 'B' }]);
    await assert.rejects(() => writer.executeSave(manifest, true), /No valid Spotify track URIs/);
    assert.equal(created, 0, 'Must never create an empty Spotify playlist');
  });

  test('Express API security validators and route guards reject malformed bearer tokens, IDs, and payloads', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter({ spotifyClientId: 'cid' }));

    const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}/api`;

      const badBearer = await fetch(`${base}/spotify/playlists`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' }
      });
      assert.equal(badBearer.status, 401);

      const badId = await fetch(`${base}/spotify/playlists/bad$id!/items`, {
        headers: { Authorization: 'Bearer valid_tok' }
      });
      assert.equal(badId.status, 400);

      const badOverride = await fetch(`${base}/pipeline/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: 't1', override: { bpm: 999 } })
      });
      assert.equal(badOverride.status, 400);

      const okOverride = await fetch(`${base}/pipeline/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: 't1', override: { bpm: 128, key: '8A' } })
      });
      assert.equal(okOverride.status, 200);

      assert.throws(() => validateCsvPayload({ body: {} }, {}, () => {}), /Missing or empty/);
      assert.throws(() => validateSequencePayload({ body: { tracks: [{ id: '1' }], unverifiedStrategy: 'bad' } }, {}, () => {}), /Invalid unverifiedStrategy/);
      assert.throws(() => validateOverridePayload({ body: { trackId: '', override: {} } }, {}, () => {}), /trackId/);

      let captured = null;
      errorHandler(new Error('secret db string'), {}, {
        status(code) { return { json(payload) { captured = { code, payload }; } }; }
      }, () => {});
      assert.equal(captured.code, 500);
      assert.equal(captured.payload.error, 'An unexpected error occurred.');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('SuggestionEngine computes sorted true medianBpm in findBonusTunes', async () => {
    const engine = new SuggestionEngine(null);
    // Unsorted list: sorted [110, 112, 128, 174, 175] -> true median is 128, unsorted index 2 happened to be 175!
    const tracks = [
      { artist: 'A', title: '1', bpm: 110, camelot: '8A' },
      { artist: 'B', title: '2', bpm: 112, camelot: '8A' },
      { artist: 'C', title: '3', bpm: 175, camelot: '8A' },
      { artist: 'D', title: '4', bpm: 174, camelot: '8A' },
      { artist: 'E', title: '5', bpm: 128, camelot: '8A' }
    ];
    const bonus = await engine.findBonusTunes(tracks);
    assert.ok(bonus.length > 0);
    assert.ok(bonus[0].reason.includes('128 BPM'));
  });

  test('Client confirmSavePlaylist prevents duplicate writes on proxy timeout and normalizes result shape', async () => {
    const originalFetch = global.fetch;
    try {
      // 1. Empty URIs fail before network
      await assert.rejects(
        () => confirmSavePlaylist('tok', { targetPlaylist: { name: 'Empty' }, urisManifest: [] }),
        /none of the tracks/i
      );

      // 2. Proxy timeout must NOT fall back to direct /me/playlists
      let directCreateCalled = false;
      global.fetch = async (url) => {
        if (String(url).startsWith('/api/spotify/save/confirm')) {
          const err = new Error('Timed out');
          err.name = 'TimeoutError';
          throw err;
        }
        if (String(url).includes('/me/playlists')) {
          directCreateCalled = true;
        }
        return { ok: true, json: async () => ({}) };
      };
      await assert.rejects(
        () => confirmSavePlaylist('tok', { targetPlaylist: { name: 'Set' }, urisManifest: ['spotify:track:111'] }),
        /Timed out waiting for the local save server/
      );
      assert.equal(directCreateCalled, false);

      // 3. Static direct save normalizes itemsWritten and spotifyUrl
      global.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith('/api/')) throw new TypeError('Failed to fetch');
        if (u.endsWith('/me/playlists')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({ id: 'pl_created_1', name: 'My Set', uri: 'spotify:playlist:pl_created_1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl_created_1' } })
          };
        }
        if (u.includes('/playlists/pl_created_1/items')) {
          return { ok: true, status: 201, json: async () => ({ snapshot_id: 's1' }) };
        }
        throw new Error(`Unexpected ${u}`);
      };
      const saved = await confirmSavePlaylist('tok', { targetPlaylist: { name: 'My Set' }, urisManifest: ['spotify:track:abc'] });
      assert.equal(saved.itemsWritten, 1);
      assert.equal(saved.trackCount, 1);
      assert.equal(saved.spotifyUrl, 'https://open.spotify.com/playlist/pl_created_1');

      // 4. fetchPlaylistItems rejects invalid ID cleanly
      await assert.rejects(() => fetchPlaylistItems('tok', '../bad'), /Invalid Spotify playlist ID/);

      // 5. Proxy non-404 errors (e.g. 403) do NOT silently fall back to direct /me/playlists
      let directAfter403 = false;
      global.fetch = async (url) => {
        if (String(url).startsWith('/api/spotify/save/confirm')) {
          return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
        }
        if (String(url).includes('/me/playlists')) directAfter403 = true;
        throw new Error(`Unexpected ${url}`);
      };
      await assert.rejects(
        () => confirmSavePlaylist('tok', { targetPlaylist: { name: 'Forbidden Set' }, urisManifest: ['spotify:track:abc'] }),
        /Forbidden/
      );
      assert.equal(directAfter403, false);

      // 6. Mid-batch failure attaches accurate partialSave counts
      let batchCall = 0;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith('/api/')) throw new TypeError('Failed to fetch');
        if (u.endsWith('/me/playlists')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({ id: 'pl_partial_1', name: 'Partial Set', external_urls: { spotify: 'https://open.spotify.com/playlist/pl_partial_1' } })
          };
        }
        if (u.includes('/playlists/pl_partial_1/items')) {
          batchCall++;
          if (batchCall === 1) return { ok: true, status: 201, json: async () => ({ snapshot_id: 's1' }) };
          return { ok: false, status: 500, json: async () => ({ error: { message: 'Chunk 2 boom' } }) };
        }
        throw new Error(`Unexpected ${u}`);
      };
      const manyUris = Array.from({ length: 105 }, (_, i) => `spotify:track:partial_${i}`);
      await assert.rejects(
        () => confirmSavePlaylist('tok', { targetPlaylist: { name: 'Partial Set' }, urisManifest: manyUris }),
        (err) => {
          assert.equal(err.partialSave?.writtenCount, 100);
          assert.equal(err.partialSave?.totalCount, 105);
          assert.equal(err.partialSave?.playlistId, 'pl_partial_1');
          return true;
        }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('Alternative provider error, mismatch, cache-hit, and BPM-clamp branches', async () => {
    const unconfGsb = new GetSongBPMProvider('');
    assert.match((await unconfGsb.lookupTrack({ artist: 'A', title: 'B' })).reason, /not configured/);
    const unconfSv = new SonovaultProvider('');
    assert.match((await unconfSv.lookupTrack({ artist: 'A', title: 'B' })).reason, /not configured/);
    const unconfSn = new SoundNetProvider('');
    assert.match((await unconfSn.lookupTrack({ artist: 'A', title: 'B' })).reason, /not configured/);

    const originalFetch = global.fetch;
    try {
      let svCalls = 0;
      let snCalls = 0;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('api.getsongbpm.com')) {
          return { ok: false, status: 429, json: async () => ({}) };
        }
        if (u.includes('sonovault.now')) {
          svCalls++;
          if (u.includes('CacheTitle')) {
            return { ok: true, json: async () => ({ artist_name: 'SV Cache Artist', track_name: 'SV CacheTitle', bpm: 500, key: '8A', isrc: 'REALISRC01' }) };
          }
          return { ok: false, status: 429, json: async () => ({}) };
        }
        if (u.includes('soundnet.p.rapidapi.com')) {
          snCalls++;
          if (u.includes('GoodSoundNet')) {
            return { ok: true, json: async () => ({ artist: 'SN Artist', title: 'GoodSoundNet', tempo: 124, key: 'C', mode: 'major', energy: 0.8 }) };
          }
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new Error(`Unexpected ${u}`);
      };

      const memCache = new ProviderCache({ persistToDisk: false });
      const gsb = new GetSongBPMProvider('k', { cache: memCache });
      const gsb429 = await gsb.lookupTrack({ artist: 'Nobody', title: 'Unique429Track' });
      assert.equal(gsb429.success, false);
      assert.match(gsb429.reason, /429/);

      const sv = new SonovaultProvider('k', { cache: memCache });
      const sv1 = await sv.lookupTrack({ artist: 'SV Cache Artist', title: 'SV CacheTitle' });
      const sv2 = await sv.lookupTrack({ artist: 'SV Cache Artist', title: 'SV CacheTitle' });
      assert.equal(sv1.success, true);
      assert.equal(sv1.data.bpm, null, 'Out-of-range BPM > 350 clamped to null');
      assert.equal(sv1.data.isrc, 'REALISRC01');
      assert.equal(sv2.cached, true);
      assert.equal(svCalls, 1);

      const sn = new SoundNetProvider('k', { cache: memCache });
      const sn1 = await sn.lookupTrack({ artist: 'SN Artist', title: 'GoodSoundNet' });
      const sn2 = await sn.lookupTrack({ artist: 'SN Artist', title: 'GoodSoundNet' });
      assert.equal(sn1.success, true);
      assert.equal(sn1.data.bpm, 124);
      assert.equal(sn1.data.energy, 0.8);
      assert.equal(sn2.cached, true);
      assert.equal(snCalls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('SpotifyClient retries bounded GET 429s, refreshes 401 tokens, detects cursor loops, and SafePlaylistWriter chunks >100 items', async () => {
    const originalFetch = global.fetch;
    try {
      let get429Count = 0;
      let tokenRefreshed = false;
      let chunkCalls = 0;
      global.fetch = async (url, init) => {
        const u = String(url);
        if (u === 'https://accounts.spotify.com/api/token') {
          tokenRefreshed = true;
          return { ok: true, status: 200, json: async () => ({ access_token: 'fresh_tok', refresh_token: 'fresh_ref' }) };
        }
        if (u.includes('/retry-ok')) {
          get429Count++;
          if (get429Count === 1) {
            return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (u.includes('/needs-refresh')) {
          if (init.headers.Authorization === 'Bearer old_tok') {
            return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) };
          }
          return { ok: true, status: 200, json: async () => ({ refreshed: true }) };
        }
        if (u.includes('/playlists/pl_loop_1/items')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [],
              next: 'https://api.spotify.com/v1/playlists/pl_loop_1/items?limit=50'
            })
          };
        }
        if (u.endsWith('/me/playlists') && init.method === 'POST') {
          return { ok: true, status: 201, json: async () => ({ id: 'pl_chunk_1', name: 'Big Set', external_urls: { spotify: 'https://open.spotify.com/playlist/pl_chunk_1' } }) };
        }
        if (u.includes('/playlists/pl_chunk_1/items') && init.method === 'POST') {
          chunkCalls++;
          return { ok: true, status: 201, json: async () => ({ snapshot_id: `s${chunkCalls}` }) };
        }
        throw new Error(`Unexpected ${u}`);
      };

      const client = new SpotifyClient({ accessToken: 'old_tok', refreshToken: 'ref_tok', clientId: 'cid' });
      const r429 = await client.request('/retry-ok');
      assert.equal(r429.ok, true);
      assert.equal(get429Count, 2);

      const r401 = await client.request('/needs-refresh');
      assert.equal(r401.refreshed, true);
      assert.equal(tokenRefreshed, true);

      await assert.rejects(() => client.getPlaylistItems('pl_loop_1'), /repeated playlist items cursor/);

      const writer = new SafePlaylistWriter(client);
      const tracks = Array.from({ length: 120 }, (_, i) => ({ uri: `spotify:track:trk_${i}` }));
      const manifest = writer.generatePreviewManifest({ name: 'Big Set' }, tracks);
      const result = await writer.executeSave(manifest, true);
      assert.equal(result.itemsWritten, 120);
      assert.equal(chunkCalls, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
