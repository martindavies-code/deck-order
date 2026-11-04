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

// --- Version text belongs in the provider search term (CSV-route fix) ---
// Live evidence 2026-11-04: with a clean title + separate version field, the
// catalogue's /bulk and /lookup only ever returned the original-mix record
// (different ISRC), which the version cross-check rightly vetoed. Decorating
// the search term with the version text reached the remix record, which then
// passed the full conservative cross-checks. These tests pin that behavior
// and prove no check was relaxed to get it.

const REMIX_REC = {
  track_name: 'Drop The Pressure (Purple Disco Machine Remix Edit)',
  artist_name: 'Claptone', bpm: 123.1, key: 'A-Minor', camelot: '8A',
  energy: 0.7, isrc: 'GBENL2002692', mix_name: 'Purple Disco Machine Remix Edit',
  source: 'freqblog_catalog', bpm_confidence: 3.1, key_confidence: 0.9
};

test('version tag is included in /bulk and /lookup search terms', async () => {
  const seen = { bulkTrack: null, lookupUrl: null };
  const fetchImpl = async (url, init) => {
    if (url.includes('/bulk')) {
      seen.bulkTrack = JSON.parse(init.body)[0].track;
      return { ok: true, json: async () => ({ results: [{ found: true, result: REMIX_REC }] }) };
    }
    if (url.includes('/lookup')) {
      seen.lookupUrl = url;
      return { ok: true, json: async () => REMIX_REC };
    }
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
  assert.equal(r.data.bpm, 123.1);
  assert.ok(seen.bulkTrack.includes('Purple Disco Machine Remix Edit'), 'bulk search term carries the version');
  if (seen.lookupUrl) assert.ok(seen.lookupUrl.includes(encodeURIComponent('Purple Disco Machine Remix Edit')));
});

test('different-ISRC remix record passes full cross-checks - the ISRC relax does NOT fire', async () => {
  // The matched record carries its own ISRC, different from the query's:
  // not a proven exact recording. It is accepted only because artist, title
  // AND version tokens all match; the record's own ISRC stays visible as
  // provenance for downstream comparison.
  const fetchImpl = async (url) => {
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: REMIX_REC }] }) };
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
  assert.equal(r.data.isrc, 'GBENL2002692', "record's own ISRC preserved, never overwritten by the query's");
  assert.equal(r.data.mixName, 'Purple Disco Machine Remix Edit');
  assert.equal(r.data.confidence, 'single_source');
});

test('decorated search still vetoes a record missing the version tokens (no relaxation)', async () => {
  // Original-mix record: different ISRC, no mix metadata. Even with the
  // version text in the search term, this record must still be rejected.
  const origRec = { ...GOOD_REC, isrc: 'GBENL1902665', mix_name: '', remixer: '', track_name: 'Drop the Pressure', artist_name: 'Claptone & Mylo' };
  const fetchImpl = async (url) => {
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: origRec }] }) };
    if (url.includes('/lookup')) return { ok: true, json: async () => origRec };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({
    artist: 'Claptone, Mylo, Purple Disco Machine',
    title: 'Drop The Pressure',
    version: 'Purple Disco Machine Remix Edit',
    isrc: 'GBENL2802692'
  });
  assert.equal(r.success, false);
  assert.match(r.reason, /version_mismatch/);
});

test('title already carrying the version tokens is not double-decorated', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('/lookup')) return { ok: true, json: async () => REMIX_REC };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  await p.lookupTrack({
    artist: 'Claptone, Mylo, Purple Disco Machine',
    title: 'Drop The Pressure - Purple Disco Machine Remix Edit',
    version: 'Purple Disco Machine Remix Edit'
  });
  const lookupUrl = seen.find(u => u.includes('/lookup'));
  assert.ok(lookupUrl, 'name search ran');
  assert.ok(!lookupUrl.includes('%28'), 'no parenthesised version appended');
  assert.ok(lookupUrl.includes(encodeURIComponent('Drop The Pressure - Purple Disco Machine Remix Edit')));
});

test('no version tag: search term stays the bare title', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('/lookup')) return { ok: true, json: async () => GOOD_REC };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const p = new FreqBlogProvider('k', { fetchImpl });
  const r = await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
  assert.equal(r.success, true);
  const lookupUrl = seen.find(u => u.includes('/lookup'));
  assert.ok(lookupUrl.includes('track=Glue&'), 'bare title unchanged');
});

test('pipeline: CSV-shaped track (clean title + version) reaches the mix record, provenance kept', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/bulk')) return { ok: true, json: async () => ({ results: [{ found: true, result: REMIX_REC }] }) };
    if (url.includes('/lookup')) return { ok: true, json: async () => REMIX_REC };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl } });
  const { tracks, report } = await pipe.processPlaylist([{
    id: 'c1', artist: 'Claptone, Mylo, Purple Disco Machine', title: 'Drop The Pressure',
    version: 'Purple Disco Machine Remix Edit', isrc: 'GBENL2802692'
  }]);
  assert.equal(tracks[0].status, 'single_source');
  assert.equal(tracks[0].bpm, 123.1);
  assert.equal(tracks[0].isrc, 'GBENL2802692', "track keeps the query's ISRC");
  assert.equal(tracks[0].sources[0].isrc, 'GBENL2002692', "matched record's differing ISRC stays visible");
  // Different-ISRC match is not a proven recording: flagged for review and
  // excluded from confident grading until confirmed.
  assert.equal(tracks[0].recordingNeedsReview, true);
  assert.deepEqual(tracks[0].recordingMismatch, { suppliedIsrc: 'GBENL2802692', matchedIsrc: 'GBENL2002692' });
  assert.match(tracks[0].reason, /GBENL2002692/);
  assert.equal(report.recordingReviewTracks.length, 1);
  assert.equal(report.recordingReviewTracks[0].matchedIsrc, 'GBENL2002692');
  assert.equal(report.isReadyForSequencing, false);
});

test('pipeline: matching ISRC on the record is NOT flagged for recording review', async () => {
  const sameIsrcRec = { ...REMIX_REC, isrc: 'GBENL2802692' };
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': sameIsrcRec }) } });
  const { tracks, report } = await pipe.processPlaylist([{
    id: 'c2', artist: 'Claptone, Mylo, Purple Disco Machine', title: 'Drop The Pressure',
    version: 'Purple Disco Machine Remix Edit', isrc: 'GBENL2802692'
  }]);
  assert.equal(tracks[0].recordingNeedsReview, false);
  assert.equal(tracks[0].recordingMismatch, null);
  assert.equal(report.recordingReviewTracks.length, 0);
  assert.equal(report.isReadyForSequencing, true);
});

test('pipeline: track without ISRC is NOT flagged (nothing to diverge from)', async () => {
  const pipe = new VerificationPipeline({ freqblogKey: 'k', freqblogOptions: { fetchImpl: stubFetch({ '/lookup': REMIX_REC }) } });
  const { tracks, report } = await pipe.processPlaylist([{
    id: 'c3', artist: 'Claptone, Mylo, Purple Disco Machine', title: 'Drop The Pressure',
    version: 'Purple Disco Machine Remix Edit'
  }]);
  assert.equal(tracks[0].status, 'single_source');
  assert.equal(tracks[0].recordingNeedsReview, false);
  assert.equal(report.recordingReviewTracks.length, 0);
});

test('cache key: only version-decorated searches move to v3, unchanged shapes keep v2', async () => {
  const keys = [];
  const cache = {
    get: async () => null,
    set: async (k) => { keys.push(k); }
  };
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': GOOD_REC }), cache });
  await p.lookupTrack({ artist: 'Bicep', title: 'Glue' });
  await p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Club Mix' });
  await p.lookupTrack({ artist: 'Bicep', title: 'Glue - Club Mix', version: 'Club Mix' });
  assert.match(keys[0], /^freqblog:v2:/, 'no version tag: unchanged shape keeps v2');
  assert.match(keys[1], /^freqblog:v3:/, 'separate version tag: decorated search gets a fresh v3 key');
  assert.match(keys[2], /^freqblog:v2:/, 'version already in the title: undecorated, keeps v2');
});


test('artist mismatch rejects leading stopword false positives ("The Prodigy" vs "The Who")', async () => {
  const rec = { ...GOOD_REC, artist_name: 'The Who', track_name: 'Glue' };
  const p = new FreqBlogProvider('k', { fetchImpl: stubFetch({ '/lookup': rec }) });
  const r = await p.lookupTrack({ artist: 'The Prodigy', title: 'Glue' });
  assert.equal(r.success, false);
  assert.match(r.reason, /artist_mismatch/);
});

test('in-flight request deduplication (singleflight) coalesces concurrent calls into single fetch and quota unit', async () => {
  let networkCalls = 0;
  let quotaCalls = 0;
  const delayedFetch = async () => {
    networkCalls++;
    await new Promise(r => setTimeout(r, 20));
    return { ok: true, json: async () => GOOD_REC };
  };
  const reserveQuota = async (n) => {
    quotaCalls += n;
    return true;
  };
  const p = new FreqBlogProvider('k', { fetchImpl: delayedFetch, reserveQuota });

  // Fire 5 concurrent requests for the exact same track
  const promises = Array.from({ length: 5 }, () =>
    p.lookupTrack({ artist: 'Bicep', title: 'Glue', version: 'Original Mix' })
  );
  const results = await Promise.all(promises);

  assert.equal(networkCalls, 1, 'Only one outgoing network call made for 5 concurrent lookups');
  assert.equal(quotaCalls, 1, 'Only one quota unit reserved for 5 concurrent lookups');
  assert.equal(results.length, 5);
  for (const res of results) {
    assert.equal(res.success, true);
    assert.equal(res.data.bpm, 130);
  }
});
