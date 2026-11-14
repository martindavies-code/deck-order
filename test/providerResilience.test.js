import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCore, crossCheckTrackIdentity } from '../server/providers/matchGuard.js';
import { FreqBlogProvider } from '../server/providers/freqblog.js';
import { VerificationPipeline, classifyProviderOutcome } from '../server/core/pipeline.js';

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
