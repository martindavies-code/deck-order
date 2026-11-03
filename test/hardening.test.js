import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderCache } from '../server/providers/cache.js';
import { createRateLimiter, validateVerifyPayload, validateSaveConfirmPayload } from '../server/middleware/security.js';
import { ValidationError, QuotaExceededError, ReconciliationError } from '../server/core/errors.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Hardening & Resilience Unit Tests', () => {

  test('Bounded LRU Cache: evicts oldest entry when max capacity is reached', () => {
    const testCachePath = './cache/test_lru_cache.json';
    const cache = new ProviderCache({
      cacheFilePath: testCachePath,
      maxCapacity: 3
    });
    cache.clear();

    cache.set('test', { isrc: 'A' }, { val: 1 });
    cache.set('test', { isrc: 'B' }, { val: 2 });
    cache.set('test', { isrc: 'C' }, { val: 3 });

    assert.equal(cache.size(), 3);
    assert.ok(cache.get('test', { isrc: 'A' }));

    // Add 4th item -> should evict oldest (B, since A was refreshed by get())
    cache.set('test', { isrc: 'D' }, { val: 4 });

    assert.equal(cache.size(), 3);
    assert.ok(cache.get('test', { isrc: 'A' }), 'A was refreshed, should still be present');
    assert.ok(cache.get('test', { isrc: 'D' }), 'D is newest, should be present');
    assert.equal(cache.get('test', { isrc: 'B' }), null, 'B was oldest unrefreshed, should be evicted');

    cache.clear();
  });

  test('Atomic Disk Persistence: creates valid JSON on disk without corruption', () => {
    const testCachePath = './cache/test_atomic_cache.json';
    const cache = new ProviderCache({ cacheFilePath: testCachePath, maxCapacity: 10 });
    cache.clear();

    cache.set('atomic_test', { isrc: 'ATOM1' }, { data: 'safe_value' });

    assert.ok(fs.existsSync(testCachePath));
    const content = JSON.parse(fs.readFileSync(testCachePath, 'utf8'));
    assert.ok(content['atomic_test:isrc:ATOM1']);
    assert.equal(content['atomic_test:isrc:ATOM1'].data.data, 'safe_value');

    cache.clear();
  });

  test('Input Validation: Rejects invalid, empty, or out-of-bounds payloads', () => {
    // Empty tracks array
    assert.throws(
      () => validateVerifyPayload({ body: { tracks: [] } }, {}, () => {}),
      ValidationError
    );

    // Non-array tracks
    assert.throws(
      () => validateVerifyPayload({ body: { tracks: 'not_an_array' } }, {}, () => {}),
      ValidationError
    );

    // Negative BPM
    assert.throws(
      () => validateVerifyPayload({ body: { tracks: [{ artist: 'A', title: 'T', bpm: -10 }] } }, {}, () => {}),
      ValidationError
    );

    // Insanely high BPM (>350)
    assert.throws(
      () => validateVerifyPayload({ body: { tracks: [{ artist: 'A', title: 'T', bpm: 999 }] } }, {}, () => {}),
      ValidationError
    );

    // Valid track passes
    let passed = false;
    validateVerifyPayload(
      { body: { tracks: [{ artist: 'Bicep', title: 'Glue', bpm: 130 }] } },
      {},
      () => { passed = true; }
    );
    assert.equal(passed, true);
  });

  test('Save Validation: Rejects unconfirmed saves or corrupted Spotify URIs', () => {
    // isConfirmed: false
    assert.throws(
      () => validateSaveConfirmPayload({ body: { isConfirmed: false } }, {}, () => {}),
      ValidationError
    );

    // Invalid non-Spotify URI
    assert.throws(
      () => validateSaveConfirmPayload({
        body: {
          isConfirmed: true,
          manifest: { urisManifest: ['https://youtube.com/watch?v=123'] }
        }
      }, {}, () => {}),
      ValidationError
    );

    // Valid URI manifest passes
    let passed = false;
    validateSaveConfirmPayload({
      body: {
        isConfirmed: true,
        manifest: { urisManifest: ['spotify:track:6UelLqGlWMcVH1E5c4H77Y'] }
      }
    }, {}, () => { passed = true; });
    assert.equal(passed, true);
  });

  test('Rate Limiter: Blocks excessive requests exceeding threshold', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 5 });
    const mockReq = { ip: '127.0.0.1', socket: {} };
    let responseStatus = null;
    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return { json: () => {} };
      }
    };

    // First 5 requests should pass
    for (let i = 0; i < 5; i++) {
      limiter(mockReq, mockRes, () => {});
    }
    assert.equal(responseStatus, null);

    // 6th request should be blocked with 429
    limiter(mockReq, mockRes, () => {});
    assert.equal(responseStatus, 429);
  });

  test('Custom Error Hierarchy: retains status codes and failure types', () => {
    const valErr = new ValidationError('Invalid key');
    assert.equal(valErr.statusCode, 400);
    assert.equal(valErr.code, 'VALIDATION_ERROR');

    const quotaErr = new QuotaExceededError('Dev quota hit');
    assert.equal(quotaErr.statusCode, 429);
    assert.equal(quotaErr.code, 'QUOTA_EXCEEDED_ERROR');

    const recErr = new ReconciliationError('Prefix mismatch');
    assert.equal(recErr.statusCode, 409);
    assert.equal(recErr.code, 'RECONCILIATION_ERROR');
  });
});
