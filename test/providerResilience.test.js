import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCore, crossCheckTrackIdentity } from '../server/providers/matchGuard.js';
import { FreqBlogProvider } from '../server/providers/freqblog.js';
import { SonovaultProvider } from '../server/providers/sonovault.js';
import { VerificationPipeline, classifyProviderOutcome } from '../server/core/pipeline.js';
import { ProviderCache } from '../server/providers/cache.js';

// Reproduction of the live 2026-11-14 regression: Peggy Gou - "(It Goes Like)
// Nanana" came back bare on the live app although FreqBlog has the record.

const NANANA_REC = {
  track_name: '(It Goes Like) Nanana', artist_name: 'Peggy Gou', bpm: 129.8,
  key: 'C-Minor', camelot: '5A', energy: 0.6335, isrc: 'GBBKS2300081',
  mix_name: null, source: 'freqblog_lookup', bpm_confidence: 2.9, key_confidence: 0.83
};

function mapCache() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); },
    _map: m
  };
}

test('titleCore survives titles beginning with a parenthesised segment', () => {
  assert.equal(titleCore('(It Goes Like) Nanana'), 'it goes like nanana');
  assert.equal(titleCore('Glue'), 'glue');
  assert.equal(titleCore('Glue (Club Dub)'), 'glue');
});

test('identity cross-check accepts a leading-parenthesis title match', () => {
  const check = crossCheckTrackIdentity(
    { artist: 'Peggy Gou', title: '(It Goes Like) Nanana' },
    NANANA_REC
  );
  assert.equal(check.ok, true, check.reason);
});

test('FreqBlog resolves a leading-parenthesis title instead of vetoing it', async () => {
  const p = new FreqBlogProvider('k', {
    fetchImpl: async () => ({ ok: true, json: async () => NANANA_REC })
  });
  const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(r.success, true);
  assert.equal(r.data.bpm, 129.8);
  assert.equal(r.data.camelot, '5A');
});

test('stale last-known-good record is served when the provider goes quiet', async () => {
  const store = mapCache();
  const p = new FreqBlogProvider('k', {
    cache: store,
    fetchImpl: async () => ({ ok: true, json: async () => NANANA_REC })
  });
  const first = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(first.success, true);
  // Simulate primary-entry expiry (30d) while the stale shadow (180d)
  // survives, and the provider now failing transiently.
  const staleOnly = {
    async get(k) { return k.endsWith(':stale') ? store.get(k) : null; },
    async set(k, v) { return store.set(k, v); }
  };
  const p2 = new FreqBlogProvider('k', {
    cache: staleOnly,
    fetchImpl: async () => { throw new Error('connect timeout'); }
  });
  const second = await p2.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(second.success, true);
  assert.equal(second.stale, true);
  assert.equal(second.data.stale, true);
  assert.equal(second.data.bpm, 129.8);
  assert.equal(second.liveReason.startsWith('provider_unreachable:'), true);
});

test('stale record never overrides an identity veto', async () => {
  const store = mapCache();
  const p = new FreqBlogProvider('k', {
    cache: store,
    fetchImpl: async () => ({ ok: true, json: async () => NANANA_REC })
  });
  const first = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(first.success, true);
  // Primary entry 'expired'; the provider now answers with a record that
  // fails the identity cross-check. A veto is a definitive answer about the
  // catalogue, not an outage, so the stale shadow must stay on the shelf.
  const staleOnly = {
    async get(k) { return k.endsWith(':stale') ? store.get(k) : null; },
    async set(k, v) { return store.set(k, v); }
  };
  const p2 = new FreqBlogProvider('k', {
    cache: staleOnly,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ...NANANA_REC, artist_name: 'Completely Different Artist' })
    })
  });
  const second = await p2.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(second.success, false);
  assert.equal(second.stale, undefined);
  assert.match(second.reason, /artist_mismatch/);
});

test('classifyProviderOutcome separates hits, catalogue misses and provider errors', () => {
  assert.equal(classifyProviderOutcome({ success: true, data: { bpm: 128 } }), 'hit');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'no_match' }), 'miss');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'Track not found' }), 'miss');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'artist_mismatch: wanted "A"' }), 'miss');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'provider_http_429' }), 'error');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'provider_monthly_quota_exhausted' }), 'error');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'provider_unreachable:x' }), 'error');
  assert.equal(classifyProviderOutcome({ success: false, reason: 'anything unexpected' }), 'error');
});

test('pipeline preserves supplied values and flags providerError on outage', async () => {
  const pipeline = new VerificationPipeline({
    freqblogKey: 'k',
    freqblogOptions: { fetchImpl: async () => { throw new Error('down'); } }
  });
  const t = await pipeline.processTrack({
    id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana',
    bpm: 130, camelot: '7A', key: 'C Minor'
  });
  assert.equal(t.status, 'unverified');
  assert.equal(t.bpm, 130);
  assert.equal(t.camelot, '7A');
  assert.equal(t.providerError, true);
  assert.match(t.reason, /temporarily unavailable/);
  assert.equal(t.providerOutcomes.length, 1);
  assert.equal(t.providerOutcomes[0].provider, 'FreqBlog');
  assert.equal(t.providerOutcomes[0].outcome, 'error');
});

test('pipeline reports a true catalogue gap without providerError', async () => {
  const pipeline = new VerificationPipeline({
    freqblogKey: 'k',
    freqblogOptions: {
      fetchImpl: async () => ({ ok: true, json: async () => ({ ...NANANA_REC, artist_name: 'Someone Else' }) })
    }
  });
  const t = await pipeline.processTrack({ id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(t.status, 'unverified');
  assert.equal(t.providerError, false);
  assert.equal(t.bpm, null);
  assert.match(t.reason, /No external BPM or musical key/);
});

// Sonovault provider against the REAL API shape (verified live 2026-11-14:
// api.sonovault.now/v1, x-api-key header, /tracks/search + /tracks/isrc/:isrc).

const SONO_NANANA = {
  id: 304589305, title: '(It Goes Like) Nanana',
  artists: [{ id: 3293131, name: 'Peggy Gou', is_primary: true }],
  isrc: 'GBBKS2300080', duration: 232, bpm: 130,
  key_alphanumeric: '5A', key_musical: 'Cm'
};

test('Sonovault resolves the Nanana track via name search (live API shape)', async () => {
  const calls = [];
  const p = new SonovaultProvider('k', {
    cache: new ProviderCache({ persistToDisk: false }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return { ok: true, json: async () => ({ results: [SONO_NANANA] }) };
    }
  });
  const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(r.success, true);
  assert.equal(r.data.bpm, 130);
  assert.equal(r.data.camelot, '5A');
  assert.equal(r.data.key, 'Cm');
  assert.equal(r.data.isrc, 'GBBKS2300080');
  assert.equal(r.data.durationMs, 232000);
  assert.match(calls[0].url, /^https:\/\/api\.sonovault\.now\/v1\/tracks\/search\?/);
  assert.equal(calls[0].headers['x-api-key'], 'k');
});

test('Sonovault uses the exact-recording ISRC path when an ISRC is present', async () => {
  const calls = [];
  const p = new SonovaultProvider('k', {
    cache: new ProviderCache({ persistToDisk: false }),
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => SONO_NANANA };
    }
  });
  const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300080' });
  assert.equal(r.success, true);
  assert.equal(r.data.camelot, '5A');
  assert.equal(calls.length, 1, 'ISRC hit needs no name search');
  assert.match(calls[0], /\/tracks\/isrc\/GBBKS2300080$/);
});

test('Sonovault ISRC 404 falls back to name search; quota error aborts', async () => {
  const p = new SonovaultProvider('k', {
    cache: new ProviderCache({ persistToDisk: false }),
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/tracks/isrc/')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({ results: [SONO_NANANA] }) };
    }
  });
  const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBDUW0000053' });
  assert.equal(r.success, true);

  const p2 = new SonovaultProvider('k', {
    cache: new ProviderCache({ persistToDisk: false }),
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  });
  const r2 = await p2.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(r2.success, false);
  assert.match(r2.reason, /quota|burst/i);
  assert.equal(classifyProviderOutcome(r2), 'error');
});

test('Sonovault rejects identity mismatches and unusable records', async () => {
  const p = new SonovaultProvider('k', {
    cache: new ProviderCache({ persistToDisk: false }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ results: [
        { title: 'Totally Different', artists: [{ name: 'Someone Else', is_primary: true }], bpm: 130, key_alphanumeric: '5A' },
        { title: '(It Goes Like) Nanana', artists: [{ name: 'Peggy Gou', is_primary: true }], bpm: 500, key_alphanumeric: '5A' }
      ] })
    })
  });
  const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
  assert.equal(r.success, false);
  assert.match(r.reason, /cross-check rejected/);
  assert.equal(classifyProviderOutcome(r), 'miss');
});

test('coverage report aggregates provider errors and per-provider outcomes', async () => {
  const pipeline = new VerificationPipeline({
    freqblogKey: 'k',
    freqblogOptions: { fetchImpl: async () => { throw new Error('down'); } }
  });
  const { report } = await pipeline.processPlaylist([
    { id: 'a', artist: 'A', title: 'One' },
    { id: 'b', artist: 'B', title: 'Two' }
  ]);
  assert.equal(report.providerErrors, 2);
  assert.equal(report.providerErrorTracks.length, 2);
  assert.equal(report.providerOutcomeSummary.FreqBlog.error, 2);
});
