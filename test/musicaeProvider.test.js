import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MusicaeProvider } from '../server/providers/musicae.js';
import { VerificationPipeline, classifyProviderOutcome } from '../server/core/pipeline.js';
import { ProviderCache } from '../server/providers/cache.js';

// Musicae response fixture mirroring the REAL API shape (verified live
// 2026-11-14 against /v2/audio-analysis/GBBKS2300081 on the DJ Track Audio
// Analysis API): track.ids, rhythm.bpm, harmony.camelot/note, score.energy.
const MUS_NANANA = {
  track: {
    ids: { spotify: '5Hijdt7rmbj9fUJdXEs6Nz', isrc: 'GBBKS2300081' },
    name: '(It Goes Like) Nanana',
    duration_ms: 367614,
    loudness_db: -6.16
  },
  rhythm: { tempo: '130.00 BPM', bpm: 130.0, time_signature: '4/4' },
  harmony: { key: 7, mode: 'minor', camelot: '6A', note: 'Gm' },
  score: { danceability: 0.676, energy: 0.83 }
};

function makeProvider(fetchImpl, cache = new ProviderCache({ persistToDisk: false })) {
  return new MusicaeProvider('k', { cache, fetchImpl });
}

describe('Musicae provider', () => {

  test('maps the live ISRC lookup response to the pipeline source shape', async () => {
    const calls = [];
    const p = makeProvider(async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return { ok: true, json: async () => MUS_NANANA };
    });
    const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    assert.equal(r.success, true);
    assert.equal(r.data.provider, 'Musicae');
    assert.equal(r.data.bpm, 130);
    assert.equal(r.data.camelot, '6A');
    assert.equal(r.data.key, 'Gm');
    assert.equal(r.data.energy, 0.83);
    assert.equal(r.data.loudness, -6.2);
    assert.equal(r.data.durationMs, 367614);
    assert.equal(r.data.isrc, 'GBBKS2300081');
    assert.equal(r.data.source, 'musicae_isrc');
    assert.match(calls[0].url, /\/v2\/audio-analysis\/GBBKS2300081$/);
    assert.equal(calls[0].headers['x-rapidapi-key'], 'k');
    assert.equal(calls[0].headers['x-rapidapi-host'], 'dj-track-audio-analysis-api.p.rapidapi.com');
  });

  test('requires an ISRC and never calls the API without one', async () => {
    let called = false;
    const p = makeProvider(async () => { called = true; return { ok: true, json: async () => MUS_NANANA }; });
    const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
    assert.equal(r.success, false);
    assert.equal(called, false);
    assert.match(r.reason, /ISRC/);
    assert.equal(classifyProviderOutcome(r), 'miss');
  });

  test('unconfigured key never calls the API', async () => {
    let called = false;
    const p = new MusicaeProvider('', { fetchImpl: async () => { called = true; } });
    const r = await p.lookupTrack({ artist: 'A', title: 'B', isrc: 'GBBKS2300081' });
    assert.equal(r.success, false);
    assert.equal(called, false);
    assert.match(r.reason, /key not configured/);
  });

  test('429 surfaces a quota reason classified as error', async () => {
    const p = makeProvider(async () => ({ ok: false, status: 429 }));
    const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    assert.equal(r.success, false);
    assert.match(r.reason, /quota/i);
    assert.equal(classifyProviderOutcome(r), 'error');
  });

  test('404 is a catalogue miss, not an error', async () => {
    const p = makeProvider(async () => ({ ok: false, status: 404 }));
    const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBXX00000000' });
    assert.equal(r.success, false);
    assert.equal(classifyProviderOutcome(r), 'miss');
  });

  test('identity cross-check vetoes a mismatched title', async () => {
    const wrong = JSON.parse(JSON.stringify(MUS_NANANA));
    wrong.track.name = 'Completely Different Song';
    const p = makeProvider(async () => ({ ok: true, json: async () => wrong }));
    const r = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    assert.equal(r.success, false);
    assert.match(r.reason, /mismatch/i);
  });

  test('429 marks the quota exhausted and short-circuits later lookups', async () => {
    let calls = 0;
    const p = makeProvider(async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; });
    const r1 = await p.lookupTrack({ artist: 'Overmono', title: 'Good Lies', isrc: 'GBBKS2200249' });
    assert.equal(r1.success, false);
    assert.match(r1.reason, /Daily quota reached/);
    assert.equal(await p.isQuotaExhausted(), true);
    const r2 = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    assert.equal(r2.success, false);
    assert.match(r2.reason, /Daily quota reached/);
    assert.equal(calls, 1, 'second lookup is short-circuited, not another burned request');
  });

  test('caches by ISRC so repeats never burn the daily quota', async () => {
    let calls = 0;
    const p = makeProvider(async () => { calls++; return { ok: true, json: async () => MUS_NANANA }; });
    const first = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    const second = await p.lookupTrack({ artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' });
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  });
});

describe('Musicae pipeline policy (tiebreaker/fallback only)', () => {

  const STUB_HIT = (provider, bpm, camelot, key, isrc) => ({
    provider, bpm, camelot, key, isrc: isrc || null, energy: null, source: 'stub', confidence: 'provider_api'
  });

  function makePipeline({ primaryHits, musicaeData, musicaeFails, musicaeByIsrc }) {
    const pipeline = new VerificationPipeline({});
    const stubProvider = (hit) => ({
      isConfigured: () => true,
      lookupTrack: async () => hit
        ? { success: true, data: hit }
        : { success: false, reason: 'Track not found' }
    });
    pipeline.getSongBPM = stubProvider(primaryHits[0] || null);
    pipeline.sonovault = stubProvider(primaryHits[1] || null);
    pipeline.soundNet = { isConfigured: () => false };
    pipeline.freqblog = { isConfigured: () => false };
    let musicaeCalls = 0;
    const queriedIsrcs = [];
    pipeline.musicae = {
      isConfigured: () => true,
      name: 'Musicae',
      lookupTrack: async (q) => {
        musicaeCalls++;
        queriedIsrcs.push(q && q.isrc ? String(q.isrc).toUpperCase() : null);
        if (musicaeFails) return { success: false, reason: 'Daily quota reached (10 req/day free tier).' };
        if (musicaeByIsrc) {
          const hit = musicaeByIsrc[queriedIsrcs[queriedIsrcs.length - 1]];
          return hit ? { success: true, data: hit } : { success: false, reason: 'Track not found' };
        }
        return { success: true, data: musicaeData };
      }
    };
    return { pipeline, musicaeCalls: () => musicaeCalls, queriedIsrcs };
  }

  const QUERY = { id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' };

  test('agreeing priority pair never consults Musicae', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 130, '5A', 'Cm')],
      musicaeData: STUB_HIT('Musicae', 130, '6A', 'Gm')
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'two_sources_agreed');
    assert.equal(musicaeCalls(), 0);
  });

  test('disputed priority pair is resolved by a Musicae tiebreak', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(musicaeCalls(), 1);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'tiebreaker_resolved');
    assert.equal(t.camelot, '5A');
    assert.match(t.reason, /Musicae tiebreak corroborated GetSongBPM/);
    assert.ok(t.sources.some(s => s.provider === 'Musicae'));
  });

  test('dispute stands when Musicae corroborates neither side', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeData: STUB_HIT('Musicae', 96, '2A', 'Ebm')
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(musicaeCalls(), 1);
    assert.equal(t.status, 'disputed');
    assert.match(t.reason, /corroborated neither side/);
  });

  test('dispute stands with a note when Musicae is unavailable', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeFails: true
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(musicaeCalls(), 1);
    assert.equal(t.status, 'disputed');
    assert.match(t.reason, /tiebreak unavailable/);
  });

  test('tiebreak-unavailable note carries the underlying cause (quota vs not-found)', async () => {
    const { pipeline } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeFails: true
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(t.status, 'disputed');
    assert.match(t.reason, /Musicae tiebreak unavailable - Daily quota reached/);
  });

  test('fallback: a single priority hit is verified against Musicae', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('Sonovault', 130, '5A', 'Cm'), null],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(musicaeCalls(), 1);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'two_sources_agreed');
    assert.equal(t.camelot, '5A');
  });

  test('fallback: Musicae alone yields a single-source result', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [null, null],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(musicaeCalls(), 1);
    assert.equal(t.status, 'single_source');
    assert.equal(t.camelot, '5A');
  });

  test('no ISRC anywhere (query or matched records) means Musicae stays silent even when sources disagree', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack({ id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
    assert.equal(musicaeCalls(), 0);
    assert.equal(t.status, 'disputed');
    assert.ok(!/tiebreak unavailable/.test(t.reason));
  });

  test('no-ISRC query: tiebreak fires using the matched records\' ISRCs', async () => {
    const { pipeline, musicaeCalls, queriedIsrcs } = makePipeline({
      primaryHits: [
        STUB_HIT('GetSongBPM', 130, '7A', 'Dm', 'GBAHS2300020'),
        STUB_HIT('Sonovault', 130, '7B', 'F', 'GBAHS2201033')
      ],
      musicaeData: STUB_HIT('Musicae', 130, '7B', 'F', 'GBAHS2300020')
    });
    const t = await pipeline.processTrack({ id: 'x', artist: 'Fred again..', title: 'Danielle (smile on my face)' });
    assert.equal(musicaeCalls(), 1);
    assert.deepEqual(queriedIsrcs, ['GBAHS2300020']);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'tiebreaker_resolved');
    assert.equal(t.camelot, '7B');
    assert.match(t.reason, /Musicae tiebreak corroborated Sonovault/);
  });

  test('no-ISRC query: tries each matched ISRC until Musicae answers', async () => {
    const { pipeline, musicaeCalls, queriedIsrcs } = makePipeline({
      primaryHits: [
        STUB_HIT('GetSongBPM', 130, '7A', 'Dm', 'GBAHS2300020'),
        STUB_HIT('Sonovault', 130, '7B', 'F', 'GBAHS2201033')
      ],
      musicaeByIsrc: { 'GBAHS2201033': STUB_HIT('Musicae', 130, '7B', 'F', 'GBAHS2201033') }
    });
    const t = await pipeline.processTrack({ id: 'x', artist: 'Fred again..', title: 'Danielle (smile on my face)' });
    assert.equal(musicaeCalls(), 2);
    assert.deepEqual(queriedIsrcs, ['GBAHS2300020', 'GBAHS2201033']);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'tiebreaker_resolved');
    assert.match(t.reason, /Musicae tiebreak corroborated Sonovault/);
  });

  test('fallback stays addressed by the query ISRC only: a lone matched ISRC is not used', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('Sonovault', 130, '5A', 'Cm', 'GBBKS2300081'), null],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack({ id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
    assert.equal(musicaeCalls(), 0);
    assert.equal(t.status, 'single_source');
  });

  test('unconfigured Musicae leaves prior behavior unchanged', async () => {
    const pipeline = new VerificationPipeline({});
    pipeline.getSongBPM = {
      isConfigured: () => true,
      lookupTrack: async () => ({ success: true, data: STUB_HIT('GetSongBPM', 130, '5A', 'Cm') })
    };
    pipeline.sonovault = {
      isConfigured: () => true,
      lookupTrack: async () => ({ success: true, data: STUB_HIT('Sonovault', 128, '8A', 'Am') })
    };
    pipeline.soundNet = { isConfigured: () => false };
    pipeline.freqblog = { isConfigured: () => false };
    pipeline.musicae = { isConfigured: () => false };
    const t = await pipeline.processTrack(QUERY);
    assert.equal(t.status, 'disputed');
    assert.ok(!/Musicae/.test(t.reason));
  });

  test('two providers agreeing on a foreign ISRC still flag recording review (#7)', async () => {
    const { pipeline } = makePipeline({
      primaryHits: [
        STUB_HIT('GetSongBPM', 130, '5A', 'Cm', 'GBXEXTENDED01'),
        STUB_HIT('Sonovault', 130, '5A', 'Cm', 'GBXEXTENDED01')
      ],
      musicaeData: null
    });
    const t = await pipeline.processTrack(QUERY); // QUERY.isrc = GBBKS2300081
    assert.equal(t.status, 'verified');
    assert.equal(t.recordingNeedsReview, true);
    assert.equal(t.recordingMismatch.matchedIsrc, 'GBXEXTENDED01');
    assert.equal(t.recordingMismatch.suppliedIsrc, 'GBBKS2300081');
    assert.match(t.reason, /differs from this track/);
  });

  test('tiebreak won on a candidate ISRC flags recording review against the track ISRC (#6)', async () => {
    const candidate = STUB_HIT('Sonovault', 128, '8A', 'Am', 'GBXCANDIDATE2');
    const { pipeline } = makePipeline({
      primaryHits: [
        STUB_HIT('GetSongBPM', 130, '5A', 'Cm', 'GBXCANDIDATE1'),
        candidate
      ],
      musicaeByIsrc: {
        // The track's own ISRC misses on Musicae; the candidate's ISRC hits
        // and sides with the candidate record.
        GBBKS2300081: null,
        GBXCANDIDATE2: STUB_HIT('Musicae', 128, '8A', 'Am', 'GBXCANDIDATE2')
      }
    });
    const t = await pipeline.processTrack(QUERY);
    assert.equal(t.status, 'verified');
    assert.equal(t.confidence, 'tiebreaker_resolved');
    assert.equal(t.recordingNeedsReview, true);
    assert.equal(t.recordingMismatch.matchedIsrc, 'GBXCANDIDATE2');
  });
});


test('providerOutcomes ride along on verified and single-source tracks, not just unverified ones', async () => {
  const STUB_HIT2 = (provider, bpm, camelot, key, isrc) => ({
    provider, bpm, camelot, key, isrc: isrc || null, energy: null, source: 'stub', confidence: 'provider_api'
  });
  const Q = { id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana', isrc: 'GBBKS2300081' };
  const mk = (primaryHits) => {
    const pipeline = new VerificationPipeline({});
    const stub = (hit) => ({
      isConfigured: () => true,
      lookupTrack: async () => hit ? { success: true, data: hit } : { success: false, reason: 'Track not found' }
    });
    pipeline.getSongBPM = stub(primaryHits[0] || null);
    pipeline.sonovault = stub(primaryHits[1] || null);
    pipeline.soundNet = { isConfigured: () => false };
    pipeline.freqblog = { isConfigured: () => false };
    pipeline.musicae = { isConfigured: () => false, name: 'Musicae' };
    return pipeline;
  };

  // Case A: two priority providers agree -> verified, outcomes attached
  const a = await mk([STUB_HIT2('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT2('Sonovault', 130, '5A', 'Cm')]).processTrack(Q);
  assert.equal(a.status, 'verified');
  assert.ok(Array.isArray(a.providerOutcomes), 'verified track carries providerOutcomes');
  assert.deepEqual(a.providerOutcomes.map(o => [o.provider, o.outcome]), [['GetSongBPM', 'hit'], ['Sonovault', 'hit']]);

  // Case B: one hit, one miss -> single_source, outcomes still attached
  const b = await mk([STUB_HIT2('GetSongBPM', 130, '5A', 'Cm'), null]).processTrack(Q);
  assert.equal(b.status, 'single_source');
  assert.ok(Array.isArray(b.providerOutcomes), 'single-source track carries providerOutcomes');
  assert.equal(b.providerOutcomes.find(o => o.provider === 'Sonovault').outcome, 'miss');
  assert.equal(b.providerError, false);
});
