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

test('pipeline single-source unconfirmed octave: raw stays raw, suggestion flagged', async () => {
  const halfTime = { ...GOOD_REC, bpm: 62.5 };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': halfTime }) } });
  const { tracks, report } = await pipe.processPlaylist([{ id: 't1', artist: 'Bicep', title: 'Glue', version: 'Original Mix' }]);
  assert.equal(tracks[0].status, 'single_source');
  assert.equal(tracks[0].bpm, 62.5);
  assert.equal(tracks[0].rawBpm, 62.5);
  assert.equal(tracks[0].workingBpm, 62.5);
  assert.equal(tracks[0].isNormalized, false);
  assert.equal(tracks[0].tempoNeedsReview, true);
  assert.equal(tracks[0].tempoSuggestion.bpm, 125);
  assert.equal(tracks[0].tempoSuggestion.kind, 'doubled');
  assert.equal(report.isReadyForSequencing, false);
  assert.equal(report.tempoReviewTracks.length, 1);
});

test('pipeline single-source octave corroborated by supplied bpm: normalized, trusted', async () => {
  const halfTime = { ...GOOD_REC, bpm: 62.5 };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': halfTime }) } });
  const { tracks, report } = await pipe.processPlaylist([{ id: 't1', artist: 'Bicep', title: 'Glue', bpm: 124, version: 'Original Mix' }]);
  assert.equal(tracks[0].isNormalized, true);
  assert.equal(tracks[0].bpm, 125);
  assert.equal(tracks[0].workingBpm, 125);
  assert.equal(tracks[0].tempoNeedsReview, false);
  assert.equal(report.isReadyForSequencing, true);
});

test('pipeline single-source supplied bpm confirms raw: no normalization', async () => {
  const halfTime = { ...GOOD_REC, bpm: 62.5 };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': halfTime }) } });
  const { tracks } = await pipe.processPlaylist([{ id: 't1', artist: 'Bicep', title: 'Glue', bpm: 63, version: 'Original Mix' }]);
  assert.equal(tracks[0].isNormalized, false);
  assert.equal(tracks[0].bpm, 62.5);
  assert.equal(tracks[0].tempoNeedsReview, false);
});

test('pipeline single-source supplied bpm matches neither: disputed', async () => {
  const halfTime = { ...GOOD_REC, bpm: 62.5 };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': halfTime }) } });
  const { tracks, report } = await pipe.processPlaylist([{ id: 't1', artist: 'Bicep', title: 'Glue', bpm: 100, version: 'Original Mix' }]);
  assert.equal(tracks[0].status, 'disputed');
  assert.equal(report.isReadyForSequencing, false);
});

test('freqblog version cross-check: club mix does not match radio mix record', async () => {
  const rec = { ...GOOD_REC, mix_name: 'Radio Mix' };
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': rec }) });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Club Mix' });
  assert.equal(r.success, false);
  assert.match(r.reason, /version_mismatch/);
});


test('ISRC exact-identifier match: version veto skipped when provider record carries the same ISRC', async () => {
  // Catalogue record for the requested recording, but with no mix metadata.
  const rec = { ...GOOD_REC, isrc: 'GBENL2802692', mix_name: '', remixer: '', track_name: 'Drop The Pressure', artist_name: 'Claptone & Mylo' };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: rec }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({
    artist: 'Claptone, Mylo, Purple Disco Machine',
    title: 'Drop The Pressure',
    version: 'Purple Disco Machine Remix Edit',
    isrc: 'GBENL2802692'
  });
  assert.equal(r.success, true);
  assert.equal(r.data.bpm, 130);
  assert.equal(r.data.source, 'freqblog_isrc_bulk');
  assert.equal(calls.length, 1, 'accepted on the ISRC path alone, no name-search fallback');
});

test('Different record ISRC keeps the conservative version veto', async () => {
  // Provider found A recording, but not the exact one (different ISRC):
  // version tokens must still be vetted and reject unknown versions.
  const rec = { ...GOOD_REC, isrc: 'GBCFB1700229', mix_name: 'Original Mix', track_name: 'Glue', artist_name: 'Bicep' };
  const fetchImpl = async (url) => {
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: rec }] }) };
    if (url.includes('/lookup')) return { ok: true, json: async () => GOOD_REC };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Babert Remix', isrc: 'GBBKS2000001' });
  assert.equal(r.success, false);
  // Both paths reject on the version veto: the /bulk record has a different
  // ISRC (no identity proof) and the name-search record has no identity at all.
  assert.match(r.reason, /version_mismatch/);
});

test('ISRC-exact match with a genuinely conflicting mix on the record still accepts (same recording)', async () => {
  // Same ISRC = same recording even if the catalogue mix label disagrees;
  // the pipeline's cross-source version comparison remains responsible for flagging it.
  const rec = { ...GOOD_REC, isrc: 'GBENL2802692', mix_name: 'Original Mix' };
  const fetchImpl = async (url) => {
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: rec }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Club Mix', isrc: 'GBENL2802692' });
  assert.equal(r.success, true);
  assert.equal(r.data.version, 'Original Mix', 'real record version exposed for downstream mismatch detection');
});
