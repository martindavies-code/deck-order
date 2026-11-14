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

  const STUB_HIT = (provider, bpm, camelot, key) => ({
    provider, bpm, camelot, key, energy: null, source: 'stub', confidence: 'provider_api'
  });

  function makePipeline({ primaryHits, musicaeData, musicaeFails }) {
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
    pipeline.musicae = {
      isConfigured: () => true,
      name: 'Musicae',
      lookupTrack: async () => {
        musicaeCalls++;
        if (musicaeFails) return { success: false, reason: 'Daily quota reached (10 req/day free tier).' };
        return { success: true, data: musicaeData };
      }
    };
    return { pipeline, musicaeCalls: () => musicaeCalls };
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

  test('no ISRC means Musicae stays silent even when sources disagree', async () => {
    const { pipeline, musicaeCalls } = makePipeline({
      primaryHits: [STUB_HIT('GetSongBPM', 130, '5A', 'Cm'), STUB_HIT('Sonovault', 128, '8A', 'Am')],
      musicaeData: STUB_HIT('Musicae', 130, '5A', 'Cm')
    });
    const t = await pipeline.processTrack({ id: 'x', artist: 'Peggy Gou', title: '(It Goes Like) Nanana' });
    assert.equal(musicaeCalls(), 0);
    assert.equal(t.status, 'disputed');
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
});
