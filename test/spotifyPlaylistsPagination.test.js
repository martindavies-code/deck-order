import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlaylists } from '../client/src/services/api.js';
import { SpotifyClient } from '../server/spotify/client.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

describe('Spotify Playlists Pagination & Security Guardrails', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('Client fetchPlaylists paginates across multiple pages, filters owned playlists, and deduplicates IDs', async () => {
    const calls = [];
    const progressEvents = [];

    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers });

      if (String(url) === '/api/spotify/playlists') {
        throw new Error('ECONNREFUSED');
      }
      if (String(url) === 'https://api.spotify.com/v1/me') {
        return jsonResponse({ id: 'dj_martin', display_name: 'Martin' });
      }
      if (String(url) === 'https://api.spotify.com/v1/me/playlists?limit=50') {
        return jsonResponse({
          total: 105,
          items: [
            { id: 'pl_1', name: 'Owned 1', owner: { id: 'dj_martin', display_name: 'Martin' }, items: { total: 12 }, uri: 'spotify:playlist:pl_1' },
            { id: 'pl_followed', name: 'Followed Playlist', owner: { id: 'other_user' }, items: { total: 40 } },
            { id: 'pl_2', name: 'Owned 2', owner: { id: 'dj_martin', display_name: 'Martin' }, tracks: { total: 8 } }
          ],
          next: 'https://api.spotify.com/v1/users/dj_martin/playlists?offset=50&limit=50'
        });
      }
      if (String(url) === 'https://api.spotify.com/v1/users/dj_martin/playlists?offset=50&limit=50') {
        return jsonResponse({
          total: 105,
          items: [
            { id: 'pl_2', name: 'Owned 2 (Duplicate Across Shift)', owner: { id: 'dj_martin' }, items: { total: 8 } },
            { id: 'pl_3', name: 'Owned 3 (Page 2)', owner: { id: 'dj_martin', display_name: 'Martin' }, items: { total: 64 } },
            null
          ],
          next: 'https://api.spotify.com/v1/me/playlists?offset=100&limit=50'
        });
      }
      if (String(url) === 'https://api.spotify.com/v1/me/playlists?offset=100&limit=50') {
        return jsonResponse({
          total: 105,
          items: [
            { id: 'pl_4', name: 'Owned 4 (Page 3)', owner: { id: 'dj_martin' }, items: { total: 19 } },
            { id: 'pl_followed_2', name: 'Followed 2', owner: { id: 'spotify' }, items: { total: 100 } }
          ],
          next: null
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await fetchPlaylists('tok_test_123', {
      onProgress: (ev) => progressEvents.push(ev)
    });

    assert.equal(result.success, true);
    assert.equal(result.user.id, 'dj_martin');
    assert.deepEqual(
      result.playlists.map(p => ({ id: p.id, itemCount: p.itemCount })),
      [
        { id: 'pl_1', itemCount: 12 },
        { id: 'pl_2', itemCount: 8 },
        { id: 'pl_3', itemCount: 64 },
        { id: 'pl_4', itemCount: 19 }
      ]
    );
    assert.equal(progressEvents.length, 3);
    assert.deepEqual(
      progressEvents.map(e => ({ page: e.page, ownedCount: e.ownedCount })),
      [
        { page: 1, ownedCount: 2 },
        { page: 2, ownedCount: 3 },
        { page: 3, ownedCount: 4 }
      ]
    );
  });

  test('Client fetchPlaylists rejects untrusted next pagination URL without sending token', async () => {
    const requestedUrls = [];
    globalThis.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url) === '/api/spotify/playlists') return new Response('proxy down', { status: 502 });
      if (String(url) === 'https://api.spotify.com/v1/me') return jsonResponse({ id: 'dj_martin' });
      if (String(url) === 'https://api.spotify.com/v1/me/playlists?limit=50') {
        return jsonResponse({
          items: [{ id: 'pl_1', name: 'Safe', owner: { id: 'dj_martin' }, items: { total: 5 } }],
          next: 'https://evil.example/v1/me/playlists?offset=50'
        });
      }
      throw new Error(`Token leaked to unexpected URL: ${url}`);
    };

    await assert.rejects(
      () => fetchPlaylists('secret_token'),
      /untrusted playlist pagination URL/i
    );
    assert.equal(requestedUrls.some(u => u.includes('evil.example')), false);
  });

  test('Client fetchPlaylists detects repeated cursor loop', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === '/api/spotify/playlists') throw new Error('offline');
      if (String(url) === 'https://api.spotify.com/v1/me') return jsonResponse({ id: 'dj_martin' });
      return jsonResponse({
        items: [{ id: 'pl_1', name: 'Loop', owner: { id: 'dj_martin' }, items: { total: 1 } }],
        next: 'https://api.spotify.com/v1/me/playlists?limit=50'
      });
    };

    await assert.rejects(
      () => fetchPlaylists('tok_loop'),
      /repeated playlist pagination cursor/i
    );
  });

  test('Client fetchPlaylists aborts at MAX_PLAYLIST_PAGES cap (50)', async () => {
    let pageCounter = 0;
    globalThis.fetch = async (url) => {
      if (String(url) === '/api/spotify/playlists') throw new Error('offline');
      if (String(url) === 'https://api.spotify.com/v1/me') return jsonResponse({ id: 'dj_martin' });
      pageCounter += 1;
      return jsonResponse({
        items: [{ id: `pl_${pageCounter}`, name: `P${pageCounter}`, owner: { id: 'dj_martin' }, items: { total: 1 } }],
        next: `https://api.spotify.com/v1/me/playlists?offset=${pageCounter * 50}&limit=50`
      });
    };

    await assert.rejects(
      () => fetchPlaylists('tok_cap'),
      /safety limit \(50 pages\)/i
    );
    assert.equal(pageCounter, 50);
  });

  test('Client fetchPlaylists surfaces proxy 401/403/429 honestly without falling back to /me', async () => {
    for (const { status, expectedStatus, headers } of [
      { status: 401, expectedStatus: 401 },
      { status: 403, expectedStatus: 403 },
      { status: 429, expectedStatus: 429, headers: { 'Retry-After': '12' } }
    ]) {
      const urls = [];
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        return jsonResponse({ error: 'blocked' }, status, headers);
      };

      await assert.rejects(
        () => fetchPlaylists('tok_proxy'),
        (err) => err.status === expectedStatus && (status !== 429 || err.message.includes('12s'))
      );
      assert.deepEqual(urls, ['/api/spotify/playlists']);
    }
  });

  test('Server SpotifyClient.getMyPlaylists paginates all owned playlists across pages and clamps limit', async () => {
    const requestedUrls = [];
    globalThis.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url) === 'https://api.spotify.com/v1/me') {
        return jsonResponse({ id: 'dj_owner', display_name: 'Owner' });
      }
      if (String(url) === 'https://api.spotify.com/v1/me/playlists?limit=50') {
        return jsonResponse({
          items: [
            { id: 's1', name: 'Set 1', owner: { id: 'dj_owner', display_name: 'Owner' }, items: { total: 10 }, uri: 'u1' },
            { id: 'other', name: 'Not Owned', owner: { id: 'someone_else' }, items: { total: 20 } }
          ],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50'
        });
      }
      if (String(url) === 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50') {
        return jsonResponse({
          items: [
            { id: 's1', name: 'Set 1 dup', owner: { id: 'dj_owner' }, items: { total: 10 } },
            { id: 's2', name: 'Set 2', owner: { id: 'dj_owner', display_name: 'Owner' }, tracks: { total: 35 }, uri: 'u2' }
          ],
          next: null
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new SpotifyClient({ accessToken: 'srv_tok' });
    const result = await client.getMyPlaylists(999);

    assert.deepEqual(result.map(p => ({ id: p.id, itemCount: p.itemCount })), [
      { id: 's1', itemCount: 10 },
      { id: 's2', itemCount: 35 }
    ]);
    assert.equal(requestedUrls.includes('https://api.spotify.com/v1/me/playlists?limit=50'), true);
    assert.equal(requestedUrls.includes('https://api.spotify.com/v1/me/playlists?offset=50&limit=50'), true);
  });

  test('Server SpotifyClient.extractNextEndpoint rejects untrusted hosts, protocols, userinfo, and paths', () => {
    const client = new SpotifyClient({ accessToken: 'srv_tok' });

    assert.equal(
      client.extractNextEndpoint('https://api.spotify.com/v1/me/playlists?offset=50&limit=50'),
      '/me/playlists?offset=50&limit=50'
    );

    for (const bad of [
      'https://evil.com/v1/me/playlists?offset=50',
      'http://api.spotify.com/v1/me/playlists?offset=50',
      'https://user:pass@api.spotify.com/v1/me/playlists?offset=50',
      'https://api.spotify.com/v2/me/playlists?offset=50',
      'not-a-url'
    ]) {
      assert.throws(() => client.extractNextEndpoint(bad), /pagination URL/i);
    }
  });
});
