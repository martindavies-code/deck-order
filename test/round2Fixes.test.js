import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { crossCheckTrackIdentity, titleCore } = await import('../server/providers/matchGuard.js');
const { parseTracklistCSV } = await import('../server/providers/csvParser.js');
const { applyManualOverride } = await import('../client/src/utils/manualOverride.js');
const { evidenceBadge } = await import('../client/src/utils/trackBadges.js');
const { DJSequencer } = await import('../server/core/solver.js');
const { selectWarmUpCandidates } = await import('../server/core/energyArc.js');
const { VerificationPipeline } = await import('../server/core/pipeline.js');
const { SonovaultProvider } = await import('../server/providers/sonovault.js');
const { ProviderCache } = await import('../server/providers/cache.js');

// Regression coverage for the 2026-11-15 adversarial audit round 2.

describe('finding 10: identity matching tokenization', () => {
  test('titleCore strips bracketed version tags', () => {
    assert.equal(titleCore('Go [Club Mix]'), 'go');
    assert.equal(titleCore('Go [Extended]'), 'go');
  });

  test('stopword-led artist exact-matches itself but not substring lookalikes', () => {
    const theThe = { artist_name: 'The The', track_name: 'Uncertain Smile' };
    const ok = crossCheckTrackIdentity({ artist: 'The The', title: 'Uncertain Smile' }, theThe);
    assert.equal(ok.ok, true);
    const breathe = crossCheckTrackIdentity({ artist: 'The The', title: 'Uncertain Smile' },
      { artist_name: 'Breathe', track_name: 'Uncertain Smile' });
    assert.equal(breathe.ok, false);
    assert.match(breathe.reason, /artist_mismatch/);
  });

  test('leading stopword does not key the match ("The Prodigy" vs "The Who")', () => {
    const r = crossCheckTrackIdentity({ artist: 'The Prodigy', title: 'Glue' },
      { artist_name: 'The Who', track_name: 'Glue' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /artist_mismatch/);
  });
});

describe('finding 10: CSV version detection', () => {
  test('recognises vip, extended, instrumental, acoustic, live, rework, bootleg, remaster and brackets', () => {
    const csv = 'Artist,Title\nAlpha,"Rush (VIP Mix)"\nBeta,"Skyline [Extended Mix]"\nGamma,"Fall (Acoustic Version)"\nDelta,"Run - Bootleg Remix"';
    const rows = parseTracklistCSV(csv);
    const versions = rows.map(r => (r.version || '').toLowerCase());
    assert.match(versions[0], /vip/);
    assert.match(versions[1], /extended/);
    assert.match(versions[2], /acoustic/);
    assert.match(versions[3], /bootleg/);
  });
});

describe('finding 3: manual override null guards', () => {
  test('null bpm/key are treated as not provided, never coerced', () => {
    const track = { id: 't', artist: 'A', title: 'T', bpm: 128, workingBpm: 128, camelot: '8A', key: 'A minor', status: 'corroborated' };
    assert.throws(() => applyManualOverride(track, { bpm: null, key: null }), /Enter a tempo or key first/);
    const out = applyManualOverride(track, { bpm: null, key: '9A' });
    assert.equal(out.bpm, 128, 'null bpm leaves the track value untouched');
    assert.equal(out.camelot, '9A');
  });
});

describe('finding 7: legacy verified status badge', () => {
  test("older saves' 'verified' status renders the Corroborated badge, not Missing", () => {
    const badge = evidenceBadge('verified');
    assert.equal(badge.label, 'Corroborated');
    assert.equal(badge.cls, 'badge-status-corroborated');
  });
});

describe('finding 5: review-gated tracks stay out of sequencing and arc anchors', () => {
  const base = (id, over = {}) => ({ id, artist: 'A', title: id, bpm: 124, workingBpm: 124, camelot: '8A', status: 'corroborated', ...over });

  test('solver excludes tempoNeedsReview tracks from the running order under exclude strategy', () => {
    const flagged = base('flagged', { tempoNeedsReview: true });
    const solver = new DJSequencer({ seed: 1, unverifiedStrategy: 'exclude' });
    const res = solver.solve([base('x', { camelot: '8A' }), flagged, base('y', { camelot: '9A' }), base('z', { camelot: '8A' })]);
    assert.ok(!res.orderedTracks.some(t => t.id === 'flagged'), 'review-gated track is not sequenced');
  });

  test('solver excludes corroborated tracks on a proven foreign ISRC', () => {
    const foreign = base('foreign', {
      recordingNeedsReview: true,
      recordingMismatch: { suppliedIsrc: 'GBCFB2000044', matchedIsrc: 'GBCFB2000045' }
    });
    const solver = new DJSequencer({ seed: 1, unverifiedStrategy: 'exclude' });
    const res = solver.solve([base('x'), foreign, base('y', { camelot: '9A' }), base('z')]);
    assert.ok(!res.orderedTracks.some(t => t.id === 'foreign'), 'foreign-ISRC values are not sequenced');
  });

  test('warm-up arc candidates skip review-gated tracks', () => {
    const flagged = base('flagged', { bpm: 100, tempoNeedsReview: true });
    const picks = selectWarmUpCandidates([base('x'), base('y', { camelot: '9A' }), flagged], 2);
    assert.ok(!picks.some(t => t.id === 'flagged'), 'unconfirmed tempo cannot anchor the arc');
  });
});

describe('finding 2: Case B octave conflict dispute details', () => {
  test('bpm_conflict dispute populates sourceA, sourceB and disputeReasons for the modal', async () => {
    const pipeline = new VerificationPipeline();
    pipeline.freqblog = {
      isConfigured: () => true,
      lookupTrack: async () => ({
        success: true,
        data: { provider: 'FreqBlog', bpm: 70, rawBpm: 70, camelot: '8A', key: 'A minor' }
      })
    };
    const processed = await pipeline.processTrack({
      id: 'd1', artist: 'A', title: 'T', bpm: 130,
      sources: [{ name: 'Manual CSV', bpm: 130, confidence: 'manual' }]
    });
    assert.equal(processed.status, 'disputed');
    const dd = processed.disputeDetails;
    assert.equal(dd.type, 'bpm_conflict');
    assert.ok(dd.sourceA && dd.sourceA.provider === 'Supplied' && dd.sourceA.workingBpm === 130);
    assert.ok(dd.sourceB && dd.sourceB.provider === 'FreqBlog');
    assert.ok(Array.isArray(dd.disputeReasons) && dd.disputeReasons.length > 0);
  });
});

describe('finding 9: provider negative caching and quota cooldowns', () => {
  test('sonovault miss is cached: second lookup does not re-hit the API', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    };
    const cache = new ProviderCache({ persistToDisk: false });
    const p = new SonovaultProvider('k', { cache, fetchImpl });
    const q = { artist: 'Nobody', title: 'Nothing' };
    const first = await p.lookupTrack(q);
    assert.equal(first.success, false);
    const second = await p.lookupTrack(q);
    assert.equal(second.success, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1, 'cached miss avoids the repeat request');
  });

  test('sonovault 429 arms a cooldown that short-circuits later lookups', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: false, status: 429, json: async () => ({}) };
    };
    const cache = new ProviderCache({ persistToDisk: false });
    const p = new SonovaultProvider('k', { cache, fetchImpl });
    const first = await p.lookupTrack({ artist: 'A', title: 'One' });
    assert.equal(first.success, false);
    assert.match(first.reason, /quota|429|burst/i);
    const second = await p.lookupTrack({ artist: 'B', title: 'Two' });
    assert.equal(second.success, false);
    assert.equal(second.cached, true, 'cooldown serves from cache');
    assert.equal(calls, 1, 'no second request during cooldown');
  });
});
