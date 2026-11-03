import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  unwrapPlaylistItem,
  mapSpotifyTrackToItem,
  isValidSpotifyNextUrl,
  fetchPlaylistItems,
  formatPlaylistLoadToast
} from '../client/src/services/api.js';

describe('Spotify Playlist Items Import & Modern Schema Compliance', () => {

  test('Fixture matching modern /items shape (items[].item with type track): every entry maps through', () => {
    const rawBatch = [
      {
        added_at: '2026-02-15T12:00:00Z',
        added_by: { id: 'dj_user' },
        is_local: false,
        item: {
          type: 'track',
          id: 'track_01',
          name: 'Electro Sunset',
          uri: 'spotify:track:track_01',
          duration_ms: 320000,
          artists: [{ name: 'Bicep' }],
          album: { name: 'Isles', images: [{ url: 'https://img.spotify.com/1.jpg' }] },
          external_ids: { isrc: 'GBBKS2000001' }
        }
      },
      {
        added_at: '2026-02-15T12:05:00Z',
        added_by: { id: 'dj_user' },
        is_local: false,
        item: {
          type: 'track',
          id: 'track_02',
          name: 'Disco Science',
          uri: 'spotify:track:track_02',
          duration_ms: 245000,
          artists: [{ name: 'Mirwais' }],
          album: { name: 'Production', images: [{ url: 'https://img.spotify.com/2.jpg' }] },
          external_ids: { isrc: 'FRZ030000002' }
        }
      }
    ];

    const mapped = [];
    for (const entry of rawBatch) {
      const { track, status } = unwrapPlaylistItem(entry);
      assert.equal(status, 'valid');
      assert.ok(track);
      mapped.push(mapSpotifyTrackToItem(track));
    }

    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].id, 'track_01');
    assert.equal(mapped[0].title, 'Electro Sunset');
    assert.equal(mapped[0].artist, 'Bicep');
    assert.equal(mapped[0].album, 'Isles');
    assert.equal(mapped[0].albumArt, 'https://img.spotify.com/1.jpg');
    assert.equal(mapped[0].durationSec, 320);

    assert.equal(mapped[1].id, 'track_02');
    assert.equal(mapped[1].title, 'Disco Science');
    assert.equal(mapped[1].artist, 'Mirwais');
  });

  test('Fixture with explicit null item and episode: both skipped and counted by reason, null not resurrected', () => {
    const rawBatch = [
      {
        added_at: '2026-02-15T12:00:00Z',
        is_local: false,
        item: null // unavailable / deleted track in playlist
      },
      {
        added_at: '2026-02-15T12:01:00Z',
        is_local: true,
        item: null // local MP3 file
      },
      {
        added_at: '2026-02-15T12:02:00Z',
        is_local: false,
        item: {
          type: 'episode',
          id: 'ep_101',
          name: 'Resident Advisor Podcast 800'
        }
      },
      {
        added_at: '2026-02-15T12:03:00Z',
        is_local: false,
        item: {
          type: 'track',
          id: 'track_valid',
          name: 'Glue',
          artists: [{ name: 'Bicep' }]
        }
      }
    ];

    const validTracks = [];
    const skipped = { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 };

    for (const entry of rawBatch) {
      const { track, status } = unwrapPlaylistItem(entry);
      if (status === 'valid') {
        validTracks.push(mapSpotifyTrackToItem(track));
      } else {
        skipped.total++;
        if (status === 'episode') skipped.episodes++;
        else if (status === 'local_file') skipped.localFiles++;
        else if (status === 'unavailable') skipped.unavailable++;
        else skipped.unsupported++;
      }
    }

    assert.equal(validTracks.length, 1);
    assert.equal(validTracks[0].id, 'track_valid');
    assert.equal(validTracks[0].title, 'Glue');

    // Confirm null item was NOT resurrected into the wrapper object
    assert.equal(skipped.total, 3);
    assert.equal(skipped.unavailable, 1);
    assert.equal(skipped.localFiles, 1);
    assert.equal(skipped.episodes, 1);
  });

  test('Legacy shape fallback: entries with track field unwrap correctly', () => {
    const legacyEntry = {
      added_at: '2025-01-01',
      track: {
        type: 'track',
        id: 'legacy_01',
        name: 'Legacy Sound',
        artists: [{ name: 'Daft Punk' }]
      }
    };
    const { track, status } = unwrapPlaylistItem(legacyEntry);
    assert.equal(status, 'valid');
    assert.equal(track.id, 'legacy_01');
    assert.equal(track.name, 'Legacy Sound');
  });

  test('A next URL pointing off api.spotify.com: rejected, no request made', () => {
    assert.equal(isValidSpotifyNextUrl('https://api.spotify.com/v1/playlists/123/items?offset=50&limit=50'), true);
    assert.equal(isValidSpotifyNextUrl('https://evil.com/v1/playlists/123/items?offset=50'), false);
    assert.equal(isValidSpotifyNextUrl('http://api.spotify.com/v1/playlists/123/items?offset=50'), false);
    assert.equal(isValidSpotifyNextUrl('https://api.spotify.com/v2/playlists/123/items'), false);
    assert.equal(isValidSpotifyNextUrl('https://accounts.spotify.com/api/token'), false);
    assert.equal(isValidSpotifyNextUrl(''), false);
    assert.equal(isValidSpotifyNextUrl(null), false);
  });
});

describe('fetchPlaylistItems Pagination & Proxy Fallback Live Mock Tests', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('Two-page fixture: 67-track playlist fetches all pages and returns 67 tracks', async () => {
    const requestedUrls = [];

    // Helper to generate tracks
    const makeBatch = (count, startIdx) => {
      return Array.from({ length: count }, (_, i) => ({
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
    };

    globalThis.fetch = async (url, options) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);

      // Proxy request fails with network error (server offline)
      if (urlStr.startsWith('/api/spotify/playlists/')) {
        throw new TypeError('Failed to fetch: Connection refused');
      }

      // Page 1
      if (urlStr.includes('/playlists/electro_disco/items?limit=50')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: makeBatch(50, 1),
            next: 'https://api.spotify.com/v1/playlists/electro_disco/items?offset=50&limit=50',
            total: 67
          })
        };
      }

      // Page 2
      if (urlStr.includes('offset=50')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: makeBatch(17, 51),
            next: null,
            total: 67
          })
        };
      }

      throw new Error(`Unexpected request to: ${urlStr}`);
    };

    const result = await fetchPlaylistItems('mock_token', 'electro_disco');
    assert.equal(result.success, true);
    assert.equal(result.items.length, 67);
    assert.equal(result.totalItems, 67);
    assert.equal(result.skipped.total, 0);
    assert.equal(result.items[0].id, 'track_1');
    assert.equal(result.items[66].id, 'track_67');
    assert.equal(requestedUrls.length, 3); // 1 proxy attempt + 2 Spotify pages
  });

  test('All-or-error pagination: a failing second page fails the whole load', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.startsWith('/api/spotify/playlists/')) {
        throw new TypeError('Failed to fetch');
      }

      // Page 1 succeeds
      if (urlStr.includes('limit=50') && !urlStr.includes('offset=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ item: { type: 'track', id: 't1', name: 'Track 1' } }],
            next: 'https://api.spotify.com/v1/playlists/fail_playlist/items?offset=50&limit=50'
          })
        };
      }

      // Page 2 fails with HTTP 500
      if (urlStr.includes('offset=50')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: 'Spotify internal service error' } })
        };
      }

      throw new Error(`Unexpected url: ${urlStr}`);
    };

    await assert.rejects(
      async () => {
        await fetchPlaylistItems('mock_token', 'fail_playlist');
      },
      (err) => {
        assert.ok(err.message.includes('Spotify internal service error') || err.message.includes('500'));
        return true;
      }
    );
  });

  test('Untrusted next URL: rejected without sending bearer token to destination', async () => {
    const visitedUrls = [];

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      visitedUrls.push(urlStr);

      if (urlStr.startsWith('/api/spotify/playlists/')) {
        throw new TypeError('Failed to fetch');
      }

      // Page 1 attempts to point off to an external domain
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ item: { type: 'track', id: 't1', name: 'Track 1' } }],
          next: 'https://attacker.evil/v1/steal-tokens'
        })
      };
    };

    await assert.rejects(
      async () => {
        await fetchPlaylistItems('mock_secret_token_never_leak', 'untrusted_pl');
      },
      (err) => {
        assert.ok(err.message.includes('untrusted next URL'));
        return true;
      }
    );

    // Confirm that the attacker URL was NEVER contacted
    assert.equal(visitedUrls.some(u => u.includes('attacker.evil')), false);
  });

  test('Page cap enforcement: playlist exceeding 20 pages throws error without returning partial result', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.startsWith('/api/spotify/playlists/')) throw new TypeError('Failed to fetch');

      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ item: { type: 'track', id: `t_${callCount}`, name: `Track ${callCount}` } }],
          // Infinite next url generator
          next: `https://api.spotify.com/v1/playlists/giant/items?offset=${callCount * 50}&limit=50`
        })
      };
    };

    await assert.rejects(
      async () => {
        await fetchPlaylistItems('mock_token', 'giant');
      },
      (err) => {
        assert.ok(err.message.includes('exceeds supported size limit'));
        return true;
      }
    );
  });

  test('Proxy error classification: HTTP 403, 401, 429, 500 surfaced honestly instead of falling back', async () => {
    // 403 Forbidden from proxy
    globalThis.fetch = async (url) => {
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'User not on developer allowlist' } })
      };
    };

    await assert.rejects(
      async () => {
        await fetchPlaylistItems('mock_token', 'pl_403');
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.ok(err.message.includes('User not on developer allowlist'));
        return true;
      }
    );

    // 429 Rate Limit from proxy
    globalThis.fetch = async (url) => {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Quota exceeded' } })
      };
    };

    await assert.rejects(
      async () => {
        await fetchPlaylistItems('mock_token', 'pl_429');
      },
      (err) => {
        assert.equal(err.status, 429);
        return true;
      }
    );
  });
});

describe('handleSelectPlaylist Notification & Feedback Rules', () => {

  test('handleSelectPlaylist with items returned but none usable: warning toast naming reason, NOT success', () => {
    const pl = { id: 'ep_only', name: 'Podcast Only Playlist', itemCount: 3 };
    const loadedCount = 0;
    const totalReturned = 3;
    const skipped = { episodes: 2, localFiles: 1, unavailable: 0, unsupported: 0, total: 3 };

    const toast = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

    assert.equal(toast.isSuccess, false);
    assert.equal(toast.type, 'warning');
    assert.ok(toast.text.includes('No usable tracks found'));
    assert.ok(toast.text.includes('2 podcast episodes'));
    assert.ok(toast.text.includes('1 local file'));
    assert.equal(toast.text.includes('Loaded 0 tracks'), false);
  });

  test('handleSelectPlaylist with 0 items returned on Spotify: warning toast, never green success', () => {
    const pl = { id: 'empty_pl', name: 'Empty Crate', itemCount: 0 };
    const loadedCount = 0;
    const totalReturned = 0;
    const skipped = { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 };

    const toast = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

    assert.equal(toast.isSuccess, false);
    assert.equal(toast.type, 'warning');
    assert.ok(toast.text.includes('contains no items on Spotify'));
    assert.equal(toast.text.includes('Loaded 0 tracks'), false);
  });

  test('Clean 67-track load (e.g. Electrodiscohousemusic): returns success toast', () => {
    const pl = { id: 'electro', name: 'Electrodiscohousemusic', itemCount: 67 };
    const loadedCount = 67;
    const totalReturned = 67;
    const skipped = { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 };

    const toast = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

    assert.equal(toast.isSuccess, true);
    assert.equal(toast.type, 'success');
    assert.equal(toast.text, 'Loaded 67 tracks from "Electrodiscohousemusic".');
  });

  test('Partial load with skipped items: success with warning breakdown of reasons', () => {
    const pl = { id: 'mixed', name: 'Mixed Set', itemCount: 50 };
    const loadedCount = 47;
    const totalReturned = 50;
    const skipped = { episodes: 2, localFiles: 1, unavailable: 0, unsupported: 0, total: 3 };

    const toast = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

    assert.equal(toast.isSuccess, true);
    assert.equal(toast.type, 'warning');
    assert.ok(toast.text.includes('Loaded 47 tracks from "Mixed Set"'));
    assert.ok(toast.text.includes('3 skipped: 2 episodes, 1 local'));
  });

  test('Item count drift warning: informs user heuristic drift without failing', () => {
    const pl = { id: 'drift', name: 'Drift Set', itemCount: 25 };
    const loadedCount = 20;
    const totalReturned = 20;
    const skipped = { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 };

    const toast = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

    assert.equal(toast.isSuccess, true);
    assert.ok(toast.text.includes('Loaded 20 tracks from "Drift Set" (playlist reported 25 items).'));
  });
});

