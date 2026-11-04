import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreqBlogProvider } from '../server/providers/freqblog.js';
import { VerificationPipeline } from '../server/core/pipeline.js';

const GOOD_REC = {
  track_name: 'Glue', artist_name: 'Bicep', bpm: 130.04, key: 'A-Minor', camelot: '8A',
  energy: 0.6, isrc: 'GBCFB1700229', mix_name: 'Original Mix', source: 'freqblog_catalog',
  bpm_confidence: 3.2, key_confidence: 0.91
};

function stubFetch(routes) {
  return async (url) => {
    for (const [suffix, payload] of Object.entries(routes)) {
      if (url.includes(suffix)) return { ok: true, json: async () => payload };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('name lookup match returns raw bpm + camelot with provenance', async () => {
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': GOOD_REC }) });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Original Mix' });
  assert.equal(r.success, true);
  assert.equal(r.data.bpm, 130);
  assert.equal(r.data.camelot, '8A');
  assert.equal(r.data.confidence, 'single_source');
  assert.equal(r.data.keyConfidence, 0.91);
});

test('version mismatch stays unresolved (no silent acceptance)', async () => {
  const rec = { ...GOOD_REC, mix_name: 'Club Dub', track_name: 'Glue (Club Dub)' };
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': rec }) });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Babert Remix' });
  assert.equal(r.success, false);
  assert.match(r.reason, /version_mismatch/);
});

test('ISRC path is cross-checked and falls back to name on identity mismatch', async () => {
  const wrongRec = { ...GOOD_REC, artist_name: 'Someone Else', track_name: 'Different Track', mix_name: '' };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ track: 'Glue', artist: 'Bicep', isrc: 'GBBKS1700282', found: true, result: wrongRec }] }) };
    if (url.includes('/lookup')) return { ok: true, json: async () => GOOD_REC };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', isrc: 'GBBKS1700282', version: 'Original Mix' });
  assert.equal(r.success, true);
  assert.equal(r.data.camelot, '8A');
  assert.ok(calls.some(u => u.includes('/lookup')), 'falls back to name lookup');
  assert.equal(calls.length, 2);
});

test('artist mismatch rejects result', async () => {
  const rec = { ...GOOD_REC, artist_name: 'Totally Other' };
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': rec }) });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
  assert.equal(r.success, false);
  assert.match(r.reason, /artist_mismatch/);
});

test('queued analysis is not treated as data', async () => {
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': { status: 'queued' } }) });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
  assert.equal(r.success, false);
  assert.equal(r.reason, 'analysis_queued_or_missing');
});

test('quota reserve failure blocks outgoing calls', async () => {
  let called = 0;
  const p = new FreqBlogProvider('k', {
    fetchImpl: async () => { called++; return { ok: true, json: async () => GOOD_REC }; },
    reserveQuota: async () => false
  });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
  assert.equal(r.success, false);
  assert.equal(r.reason, 'provider_monthly_quota_exhausted');
  assert.equal(called, 0);
});

test('pipeline single-source path keeps raw bpm and marks octave normalization', async () => {
  const halfTime = { ...GOOD_REC, bpm: 62.5 };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': halfTime }) } });
  const { tracks } = await pipe.processPlaylist([{ id: 't1', artist: 'Bicep', title: 'Glue', version: 'Original Mix' }]);
  assert.equal(tracks[0].status, 'single_source');
  assert.equal(tracks[0].rawBpm, 62.5);
  assert.equal(tracks[0].isNormalized, true);
  assert.equal(tracks[0].workingBpm, 125);
});
