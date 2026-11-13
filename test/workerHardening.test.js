import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker, { QuotaCounter } from '../worker/src/index.js';

function createMockDOState() {
  const map = new Map();
  return {
    storage: {
      async transaction(fn) {
        return await fn();
      },
      async get(keys) {
        const res = new Map();
        for (const k of keys) {
          if (map.has(k)) res.set(k, map.get(k));
        }
        return res;
      },
      async put(entries) {
        for (const [k, v] of Object.entries(entries)) {
          map.set(k, v);
        }
      }
    }
  };
}

function createWorkerEnv(overrides = {}) {
  const kvStore = new Map();
  const doState = createMockDOState();
  const counter = new QuotaCounter(doState, { ADMIN_TOKEN: overrides.ADMIN_TOKEN });
  return {
    FREQBLOG_API_KEY: 'test-key',
    ADMIN_TOKEN: 'super-secret-admin',
    FREQBLOG_KV: {
      async get(k, type) {
        const raw = kvStore.get(k);
        if (!raw) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(k, val) {
        kvStore.set(k, val);
      }
    },
    QUOTA: {
      idFromName(name) { return name; },
      get() {
        return {
          fetch: (input, init) => counter.fetch(input instanceof Request ? input : new Request(input, init))
        };
      }
    },
    ...overrides,
    _kvStore: kvStore,
    _counter: counter
  };
}

describe('Worker Security, CORS, Quota & Singleflight Hardening', () => {
  test('CORS allows exact production/localhost origins and rejects subdomain/prefix lookalikes', async () => {
    const env = createWorkerEnv();

    const allowedProd = await worker.fetch(
      new Request('https://worker.example/api/status', { headers: { Origin: 'https://martindavies-code.github.io' } }),
      env
    );
    assert.equal(allowedProd.headers.get('Access-Control-Allow-Origin'), 'https://martindavies-code.github.io');
    assert.equal(allowedProd.headers.get('Vary'), 'Origin');

    const allowedLocal = await worker.fetch(
      new Request('https://worker.example/api/status', { headers: { Origin: 'http://localhost:5173' } }),
      env
    );
    assert.equal(allowedLocal.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');

    const evilSubdomain = await worker.fetch(
      new Request('https://worker.example/api/status', { headers: { Origin: 'https://attacker.github.io' } }),
      env
    );
    assert.equal(evilSubdomain.headers.get('Access-Control-Allow-Origin'), 'https://martindavies-code.github.io');

    const evilPrefix = await worker.fetch(
      new Request('https://worker.example/api/status', { headers: { Origin: 'http://localhost.attacker.com' } }),
      env
    );
    assert.equal(evilPrefix.headers.get('Access-Control-Allow-Origin'), 'https://martindavies-code.github.io');

    const preflight = await worker.fetch(
      new Request('https://worker.example/api/status', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4173' } }),
      env
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4173');
  });

  test('/api/admin/quota and QuotaCounter /set enforce ADMIN_TOKEN and monotonic integer counts', async () => {
    const env = createWorkerEnv({ ADMIN_TOKEN: 'admin-token-123' });

    const unauthorized = await worker.fetch(
      new Request('https://worker.example/api/admin/quota', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'wrong-token' },
        body: JSON.stringify({ monthKey: '2026-11', count: 10 })
      }),
      env
    );
    assert.equal(unauthorized.status, 403);

    const noTokenEnv = createWorkerEnv({ ADMIN_TOKEN: '' });
    const blockedWhenUnset = await worker.fetch(
      new Request('https://worker.example/api/admin/quota', {
        method: 'POST',
        headers: { 'X-Admin-Token': '' },
        body: JSON.stringify({ monthKey: '2026-11', count: 10 })
      }),
      noTokenEnv
    );
    assert.equal(blockedWhenUnset.status, 403);

    const badCount = await worker.fetch(
      new Request('https://worker.example/api/admin/quota', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'admin-token-123' },
        body: JSON.stringify({ monthKey: '2026-11', count: -5 })
      }),
      env
    );
    assert.equal(badCount.status, 400);

    const okRes = await worker.fetch(
      new Request('https://worker.example/api/admin/quota', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'admin-token-123' },
        body: JSON.stringify({ monthKey: '2026-11', count: 42 })
      }),
      env
    );
    assert.equal(okRes.status, 200);
    const data = await okRes.json();
    assert.equal(data.monthCount, 42);

    // Direct DO check rejects unconfigured ADMIN_TOKEN even if caller passes "undefined"
    const unconfiguredCounter = new QuotaCounter(createMockDOState(), {});
    const spoofedRes = await unconfiguredCounter.fetch(
      new Request('https://quota.internal/set', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'undefined' },
        body: JSON.stringify({ monthKey: '2026-11', count: 999 })
      })
    );
    assert.equal(spoofedRes.status, 403);
  });

  test('QuotaCounter /reserve rejects invalid reservation amounts and enforces per-IP/monthly limits', async () => {
    const state = createMockDOState();
    const counter = new QuotaCounter(state, { ADMIN_TOKEN: 'tok' });

    for (const bad of [0, -1, 1.5, 101, 'one']) {
      const res = await counter.fetch(
        new Request('https://quota.internal/reserve', {
          method: 'POST',
          body: JSON.stringify({ n: bad, ip: '1.2.3.4' })
        })
      );
      assert.equal(res.status, 400);
    }

    const okRes = await counter.fetch(
      new Request('https://quota.internal/reserve', {
        method: 'POST',
        body: JSON.stringify({ n: 60, ip: '1.2.3.4' })
      })
    );
    assert.equal((await okRes.json()).allowed, true);

    const okRes2 = await counter.fetch(
      new Request('https://quota.internal/reserve', {
        method: 'POST',
        body: JSON.stringify({ n: 60, ip: '1.2.3.4' })
      })
    );
    assert.equal((await okRes2.json()).allowed, true);

    const overIpCap = await counter.fetch(
      new Request('https://quota.internal/reserve', {
        method: 'POST',
        body: JSON.stringify({ n: 1, ip: '1.2.3.4' })
      })
    );
    const overJson = await overIpCap.json();
    assert.equal(overJson.allowed, false);
    assert.equal(overJson.reason, 'per_ip_hourly_cap');
  });

  test('/api/pipeline/verify validates configuration/payload, handles 404, and redacts 502 error details', async () => {
    const noKeyEnv = createWorkerEnv({ FREQBLOG_API_KEY: '' });
    const unconfigured = await worker.fetch(
      new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: JSON.stringify({ tracks: [{ artist: 'A', title: 'B' }] })
      }),
      noKeyEnv
    );
    assert.equal(unconfigured.status, 503);

    const env = createWorkerEnv();
    const invalidJson = await worker.fetch(
      new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: '{bad'
      }),
      env
    );
    assert.equal(invalidJson.status, 400);

    const nonObjectTracks = await worker.fetch(
      new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: JSON.stringify({ tracks: [null, 'bad', 123] })
      }),
      env
    );
    assert.equal(nonObjectTracks.status, 400);

    const notFound = await worker.fetch(
      new Request('https://worker.example/api/nonexistent'),
      env
    );
    assert.equal(notFound.status, 404);

    // Verify singleflight deduplication & 502 error redaction
    const originalFetch = global.fetch;
    try {
      let upstreamHits = 0;
      global.fetch = async (url) => {
        if (String(url).includes('freqblog') || String(url).includes('audio-analysis') || String(url).includes('lookup')) {
          upstreamHits++;
          await new Promise(r => setTimeout(r, 20));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              track_name: 'Hardening Worker Track',
              artist_name: 'Worker Artist',
              bpm: 126,
              key: 'A minor',
              camelot: '8A'
            })
          };
        }
        throw new Error(`Unexpected upstream ${url}`);
      };

      const reqPayload = JSON.stringify({ tracks: [{ artist: 'Worker Artist', title: 'Hardening Worker Track' }] });
      const [r1, r2] = await Promise.all([
        worker.fetch(new Request('https://worker.example/api/pipeline/verify', { method: 'POST', body: reqPayload }), env),
        worker.fetch(new Request('https://worker.example/api/pipeline/verify', { method: 'POST', body: reqPayload }), env)
      ]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      const j1 = await r1.json();
      assert.equal(j1.success, true);
      assert.equal(upstreamHits, 1, 'Concurrent identical verify requests share singleflight upstream fetch');

      // Simulate unexpected quota stub exception -> redacted 502 pipeline_error
      const throwingEnv = {
        ...env,
        QUOTA: {
          idFromName: () => 'global',
          get: () => ({
            fetch: async () => { throw new Error('SENSITIVE_INTERNAL_SECRET_STRING'); }
          })
        }
      };
      const errRes = await worker.fetch(
        new Request('https://worker.example/api/pipeline/verify', {
          method: 'POST',
          body: JSON.stringify({ tracks: [{ artist: 'Unique', title: 'Throw502' }] })
        }),
        throwingEnv
      );
      assert.equal(errRes.status, 502);
      const errJson = await errRes.json();
      assert.equal(errJson.error, 'pipeline_error');
      assert.equal(JSON.stringify(errJson).includes('SENSITIVE_INTERNAL_SECRET_STRING'), false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
