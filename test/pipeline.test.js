import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTempo,
  detectVersionMismatch,
  evaluateTwoSources,
  VerificationPipeline
} from '../server/core/pipeline.js';
import { parseTracklistCSV } from '../server/providers/csvParser.js';

describe('Data Pipeline & Verification Tests', () => {

  test('Tempo Normalization: keeps tempos in 90-180 band and flags normalized', () => {
    // Normal 124 BPM house
    const normal = normalizeTempo(124, 90, 180);
    assert.equal(normal.workingBpm, 124);
    assert.equal(normal.isNormalized, false);
    assert.equal(normal.multiplier, 1);

    // Half-time 64 BPM -> doubled to 128 BPM
    const half = normalizeTempo(64, 90, 180);
    assert.equal(half.workingBpm, 128);
    assert.equal(half.isNormalized, true);
    assert.equal(half.multiplier, 2);

    // Double-time 260 BPM -> halved to 130 BPM
    const dbl = normalizeTempo(260, 90, 180);
    assert.equal(dbl.workingBpm, 130);
    assert.equal(dbl.isNormalized, true);
    assert.equal(dbl.multiplier, 0.5);

    // Out of band even after half/double (e.g. 35 BPM -> 70 BPM is still < 90)
    const outOfBand = normalizeTempo(35, 90, 180);
    assert.equal(outOfBand.isNormalized, false);
  });

  test('Version Mismatch Detection: catches ISRC, remix tag, and duration differences', () => {
    // Different ISRCs
    const isrcDiff = detectVersionMismatch(
      { isrc: 'GBBKS2000001', version: 'Original Mix' },
      { isrc: 'GBBKS2000002', version: 'Original Mix' }
    );
    assert.equal(isrcDiff.isMismatch, true);
    assert.match(isrcDiff.reason, /ISRC mismatch/);

    // Different remix tags
    const remixDiff = detectVersionMismatch(
      { isrc: 'GBBKS2000001', version: 'Extended Mix' },
      { isrc: 'GBBKS2000001', version: 'Radio Edit' }
    );
    assert.equal(remixDiff.isMismatch, true);
    assert.match(remixDiff.reason, /label mismatch/);

    // Substantial duration difference
    const durDiff = detectVersionMismatch(
      { durationMs: 360000 }, // 6:00
      { durationMs: 195000 }  // 3:15
    );
    assert.equal(durDiff.isMismatch, true);
    assert.match(durDiff.reason, /Duration difference/);

    // Matching versions
    const matching = detectVersionMismatch(
      { isrc: 'USRC12345678', version: 'Original Mix', durationMs: 300000 },
      { isrc: 'USRC12345678', version: 'Original Mix', durationMs: 302000 }
    );
    assert.equal(matching.isMismatch, false);
  });

  test('Two-source Evaluation: Agreement within 2% and same Camelot = verified', () => {
    const sourceA = {
      provider: 'GetSongBPM',
      bpm: 126.0,
      camelot: '8A',
      key: 'A minor'
    };
    const sourceB = {
      provider: 'Sonovault',
      bpm: 126.5, // ~0.4% diff (< 2%)
      camelot: '8A',
      key: 'A minor'
    };

    const result = evaluateTwoSources(sourceA, sourceB);
    assert.equal(result.status, 'verified');
    assert.equal(result.confidence, 'two_sources_agreed');
    assert.equal(result.camelot, '8A');
    assert.equal(result.bpm, 126.3); // averaged
  });

  test('Two-source Evaluation: ISRC mismatch with agreeing tempo/key verifies but flags recording review', () => {
    // Regression: the ISRC veto used to invalidate corroborated values and
    // leave the track bare. Agreement across two independent sources is
    // still evidence - show the values, flag the recording identity.
    const sourceA = {
      provider: 'FreqBlog',
      bpm: 129.8,
      camelot: '5A',
      key: 'C minor',
      isrc: 'GBBKS2300081'
    };
    const sourceB = {
      provider: 'Sonovault',
      bpm: 130.0,
      camelot: '5A',
      key: 'C minor',
      isrc: 'GBBKS2300080'
    };

    const result = evaluateTwoSources(sourceA, sourceB);
    assert.equal(result.status, 'verified');
    assert.equal(result.confidence, 'two_sources_agreed');
    assert.equal(result.camelot, '5A');
    assert.equal(result.bpm, 129.9);
    assert.equal(result.recordingNeedsReview, true);
    assert.match(result.reason, /version mismatch/i);
  });

  test('Two-source Evaluation: Disagreement > 2% BPM marks DISPUTED', () => {
    const sourceA = {
      provider: 'GetSongBPM',
      bpm: 124.0,
      camelot: '8A',
      key: 'A minor'
    };
    const sourceB = {
      provider: 'Sonovault',
      bpm: 130.0, // 4.7% diff (> 2%)
      camelot: '8A',
      key: 'A minor'
    };

    const result = evaluateTwoSources(sourceA, sourceB);
    assert.equal(result.status, 'disputed');
    assert.ok(result.disputeDetails);
    assert.match(result.reason, /BPM discrepancy/);
  });

  test('Two-source Evaluation: Disagreement on Key marks DISPUTED', () => {
    const sourceA = {
      provider: 'GetSongBPM',
      bpm: 125.0,
      camelot: '8A',
      key: 'A minor'
    };
    const sourceB = {
      provider: 'Sonovault',
      bpm: 125.0,
      camelot: '9A', // different key!
      key: 'E minor'
    };

    const result = evaluateTwoSources(sourceA, sourceB);
    assert.equal(result.status, 'disputed');
    assert.ok(result.disputeDetails);
    assert.match(result.reason, /Key discrepancy/);
  });

  test('Manual User Override always wins and persists', async () => {
    const pipeline = new VerificationPipeline();
    const track = {
      id: 'test_track_1',
      artist: 'Bicep',
      title: 'Glue',
      bpm: 120,
      camelot: '8A',
      sources: []
    };

    pipeline.setManualOverride('test_track_1', {
      bpm: 130,
      key: 'B minor', // maps to 10A
      camelot: '10A'
    });

    const processed = await pipeline.processTrack(track);
    assert.equal(processed.status, 'verified');
    assert.equal(processed.confidence, 'user_override');
    assert.equal(processed.bpm, 130);
    assert.equal(processed.camelot, '10A');
  });

  test('CSV Parsing: extracts artist, title, bpm, key, camelot accurately', () => {
    const csvData = `
Artist,Title,BPM,Key
Bicep,Glue,130,8A
Overmono,Gunk,134,4A
Four Tet,Baby,126,F minor
Floating Points,LesAlpx,128,C# minor
    `.trim();

    const tracks = parseTracklistCSV(csvData);
    assert.equal(tracks.length, 4);

    assert.equal(tracks[0].artist, 'Bicep');
    assert.equal(tracks[0].title, 'Glue');
    assert.equal(tracks[0].bpm, 130);
    assert.equal(tracks[0].camelot, '8A');
    assert.equal(tracks[0].status, 'verified');

    assert.equal(tracks[1].artist, 'Overmono');
    assert.equal(tracks[1].camelot, '4A');

    // "F minor" -> 4A
    assert.equal(tracks[2].camelot, '4A');

    // "C# minor" -> 12A
    assert.equal(tracks[3].camelot, '12A');
  });

  test('Coverage report summarizes accurately', () => {
    const pipeline = new VerificationPipeline();
    const mockTracks = [
      { id: '1', artist: 'A', title: '1', status: 'verified' },
      { id: '2', artist: 'B', title: '2', status: 'verified' },
      { id: '3', artist: 'C', title: '3', status: 'disputed', disputeDetails: {} },
      { id: '4', artist: 'D', title: '4', status: 'unverified', reason: 'Not found' }
    ];

    const report = pipeline.generateCoverageReport(mockTracks);
    assert.equal(report.total, 4);
    assert.equal(report.verified, 2);
    assert.equal(report.disputed, 1);
    assert.equal(report.unverified, 1);
    assert.equal(report.isReadyForSequencing, false);
    assert.match(report.summaryText, /Verified 2\/4, Single-source 0, Disputed 1, Unverified 1/);
  });
});

test('Sequencer objective: suggested order never worse than original than original under solver objective', async () => {
  const { DJSequencer } = await import('../server/core/solver.js');
  const T = (id, bpm, camelot, extra = {}) => ({ id, artist: 'A', title: id, bpm, workingBpm: bpm, camelot, key: 'x', status: 'single_source', ...extra });
  // Unconfirmed-octave track mid-set: graded-only score can look worse while
  // the solver objective (incl. unverified-edge penalties) must never regress.
  const tracks = [
    T('t1', 124, '11B'),
    T('t2', 62.5, '4A', { tempoNeedsReview: true, tempoSuggestion: { bpm: 125, kind: 'doubled' } }),
    T('t3', 126, '8A'),
    T('t4', 122, '8B'),
    T('t5', 122, '2B')
  ];
  const r = new DJSequencer({}).solve(tracks);
  assert.ok(
    r.evaluation.objectiveCost <= r.originalEvaluation.objectiveCost + 1e-9,
    `objective regression: ${r.originalEvaluation.objectiveCost} -> ${r.evaluation.objectiveCost}`
  );
});
