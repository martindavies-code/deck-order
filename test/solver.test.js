import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer, DEFAULT_BEAM_WIDTH } from '../server/core/solver.js';
import { calculateTransitionCost } from '../server/core/costMatrix.js';
import { selectWarmUpCandidates, calculateArcPositionPenalty } from '../server/core/energyArc.js';

describe('Sequencer & Directed 2-Opt Solver Tests', () => {

  test('Directed transition cost asymmetry: C(A -> B) != C(B -> A) when tempo drops', () => {
    // Track A: 124 BPM, 8A
    // Track B: 132 BPM, 8A
    const trackA = { id: 'A', artist: 'A', title: 'A', bpm: 124, camelot: '8A' };
    const trackB = { id: 'B', artist: 'B', title: 'B', bpm: 132, camelot: '8A' };

    // Rising tempo (124 -> 132): +6.5% rise
    const costAToB = calculateTransitionCost(trackA, trackB);
    // Dropping tempo (132 -> 124): -6.1% drop, directional penalty applies
    const costBToA = calculateTransitionCost(trackB, trackA);

    assert.ok(
      costBToA.totalCost > costAToB.totalCost,
      `Directed cost must penalize sudden tempo drops more than rises: A->B=${costAToB.totalCost}, B->A=${costBToA.totalCost}`
    );
  });

  test('Solver optimizes a scrambled playlist into a harmonically coherent order', () => {
    // 6 tracks in harmonic progression: 8A -> 9A -> 10A -> 11A -> 12A -> 1A
    const harmonicCircle = [
      { id: '1', artist: 'T1', title: 'T1', bpm: 124, camelot: '8A', status: 'verified' },
      { id: '2', artist: 'T2', title: 'T2', bpm: 125, camelot: '9A', status: 'verified' },
      { id: '3', artist: 'T3', title: 'T3', bpm: 126, camelot: '10A', status: 'verified' },
      { id: '4', artist: 'T4', title: 'T4', bpm: 127, camelot: '11A', status: 'verified' },
      { id: '5', artist: 'T5', title: 'T5', bpm: 128, camelot: '12A', status: 'verified' },
      { id: '6', artist: 'T6', title: 'T6', bpm: 129, camelot: '1A', status: 'verified' }
    ];

    // Deliberately scramble order: [1A, 8A, 11A, 9A, 12A, 10A]
    const scrambled = [
      harmonicCircle[5],
      harmonicCircle[0],
      harmonicCircle[3],
      harmonicCircle[1],
      harmonicCircle[4],
      harmonicCircle[2]
    ];

    const sequencer = new DJSequencer({ seed: 42 });
    const result = sequencer.solve(scrambled);

    // Optimized sequence must have higher smooth percentage and lower cost than scrambled
    assert.ok(result.evaluation.totalCost <= result.originalEvaluation.totalCost);
    assert.ok(result.evaluation.smoothPct >= result.originalEvaluation.smoothPct);
  });

  test('Unverified track placement strategy: keep_relative_position', () => {
    const mixed = [
      { id: 'v1', artist: 'V1', title: 'V1', bpm: 124, camelot: '8A', status: 'verified' },
      { id: 'u1', artist: 'U1', title: 'U1', bpm: null, camelot: null, status: 'unverified' },
      { id: 'v2', artist: 'V2', title: 'V2', bpm: 125, camelot: '9A', status: 'verified' },
      { id: 'v3', artist: 'V3', title: 'V3', bpm: 126, camelot: '10A', status: 'verified' }
    ];

    const sequencer = new DJSequencer({ unverifiedStrategy: 'keep_relative_position' });
    const result = sequencer.solve(mixed);

    assert.equal(result.orderedTracks.length, 4);
    assert.equal(result.orderedTracks[1].id, 'u1', 'Unverified track must retain index 1');
  });

  test('Benchmark: 200-track worst-case synthetic playlist performance measurement', () => {
    const keys = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
                  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B'];

    // Generate 200 synthetic tracks with random tempos and keys
    const synthetic200 = [];
    for (let i = 0; i < 200; i++) {
      const bpm = 120 + Math.floor((i * 37) % 18); // tempos 120-137
      const camelot = keys[(i * 7) % keys.length];
      synthetic200.push({
        id: `synth_${i}`,
        artist: `DJ Artist ${i}`,
        title: `Synthetic Track ${i}`,
        bpm,
        camelot,
        status: 'verified'
      });
    }

    const sequencer = new DJSequencer({ seed: 1337, maxIterations: 1000 });
    const res = sequencer.solve(synthetic200);

    console.log(`\n  [200-Track Benchmark] Runtime: ${res.stats.runtimeMs} ms, Heap Delta: ${(res.stats.memoryDeltaBytes / 1024 / 1024).toFixed(2)} MB`);
    assert.equal(res.orderedTracks.length, 200);
    // 200 tracks must solve in under 2000ms easily (usually < 200ms)
    assert.ok(res.stats.runtimeMs < 2000, `Expected < 2000ms, took ${res.stats.runtimeMs}ms`);
  });

  test('Or-opt + Beam Search escapes a plain 2-opt local minimum to find the strictly cheaper tour', () => {
    // 1. Single-track relocate (Or-opt L=1) & Greedy/2-opt trap:
    // Opener t0 (8A, E=0.15) is followed by a 3-step rising 8A chain t1(0.45) -> t2(0.75) -> t3(0.95),
    // a low-energy relative-major track t4 (8B, E=0.15), and closer t5 (8A, E=0.95).
    // - Greedy from t0 greedily takes 0-cost edges t0->t1->t2->t3, painting itself into a corner where
    //   t4(8B, 0.15) is left until index 4 after t3(0.95) (incurring a -0.80 energy drop = 8.0, total 10.0).
    // - In [t0, t1, t2, t3, t4, t5] (cost 10.0), every 2-opt reversal [i..j] has delta >= 0:
    //   reversing [3..4] swaps t3(0.95)->t4(0.15) for t2(0.75)->t4(0.15) (both capped at 8.0 drop, delta = 0),
    //   and reversing [1..4] or [2..4] inverts the rising 8A chain (creating two energy drops = 9.0, total 11.0).
    // - Or-opt(L=1) relocates t4 from index 4 to index 1 (and Beam Search finds [t0, t4, t1, t2, t3, t5] directly),
    //   cutting total cost from 10.0 down to 2.0.
    const barrierSet = [
      { id: 't0', artist: 'A', title: 'T0', bpm: 125, camelot: '8A', energy: 0.15, status: 'verified' },
      { id: 't1', artist: 'A', title: 'T1', bpm: 125, camelot: '8A', energy: 0.45, status: 'verified' },
      { id: 't2', artist: 'A', title: 'T2', bpm: 125, camelot: '8A', energy: 0.75, status: 'verified' },
      { id: 't3', artist: 'A', title: 'T3', bpm: 125, camelot: '8A', energy: 0.95, status: 'verified' },
      { id: 't4', artist: 'A', title: 'T4', bpm: 125, camelot: '8B', energy: 0.15, status: 'verified' },
      { id: 't5', artist: 'A', title: 'T5', bpm: 125, camelot: '8A', energy: 0.95, status: 'verified' }
    ];

    const seqPlain2Opt = new DJSequencer({
      seed: 42,
      enableOrOpt: false,
      enableBeamSearch: false,
      lockedOpenerId: 't0',
      lockedCloserId: 't5'
    });
    const seqUpgraded = new DJSequencer({
      seed: 42,
      lockedOpenerId: 't0',
      lockedCloserId: 't5'
    });

    const costMatrix = seqUpgraded.buildCostMatrix(barrierSet);
    const initialTour = [0, 1, 2, 3, 4, 5];
    const tour2OptOnly = seqPlain2Opt.optimizeDirected2Opt(initialTour, costMatrix, barrierSet, {
      pinStart: true,
      pinEnd: true,
      enableOrOpt: false
    });
    const tourWithOrOpt = seqUpgraded.optimizeDirected2Opt(initialTour, costMatrix, barrierSet, {
      pinStart: true,
      pinEnd: true,
      enableOrOpt: true
    });

    const cost2OptOnly = seqPlain2Opt.evaluateTourObjective(tour2OptOnly, costMatrix, barrierSet);
    const costWithOrOpt = seqUpgraded.evaluateTourObjective(tourWithOrOpt, costMatrix, barrierSet);

    assert.deepEqual(tour2OptOnly, [0, 1, 2, 3, 4, 5], 'Plain 2-opt gets stranded in a suboptimal local minimum');
    assert.deepEqual(tourWithOrOpt, [0, 4, 1, 2, 3, 5], 'Or-opt(L=1) relocates the trapped track to find the global optimum');
    assert.equal(cost2OptOnly, 10, 'Plain 2-opt is stranded at cost 10.0');
    assert.equal(costWithOrOpt, 2, 'Or-opt(L=1) reaches the global optimum cost 2.0');

    // 2. Adjacent-pair relocate (Or-opt L=2):
    // A 2-track 8A high-energy pair [p1(0.95), p2(0.95)] sits at the start before a rising 8B chain
    // t2(0.15) -> t3(0.45) -> t4(0.75) and closer t5(8A, 0.95).
    // Moving only one of p1/p2 (L=1) still leaves the other 0.95 track dropping into t2(0.15) (cost 10.0),
    // and 2-opt reversals invert the rising 8B chain. Or-opt(L=2) relocates [p1, p2] together after t4,
    // dropping total cost from 10.0 down to 2.0.
    const pairStrandedSet = [
      { id: 't0', artist: 'A', title: 'T0', bpm: 125, camelot: '8A', energy: 0.15, status: 'verified' },
      { id: 'p1', artist: 'A', title: 'P1', bpm: 125, camelot: '8A', energy: 0.95, status: 'verified' },
      { id: 'p2', artist: 'A', title: 'P2', bpm: 125, camelot: '8A', energy: 0.95, status: 'verified' },
      { id: 't2', artist: 'A', title: 'T2', bpm: 125, camelot: '8B', energy: 0.15, status: 'verified' },
      { id: 't3', artist: 'A', title: 'T3', bpm: 125, camelot: '8B', energy: 0.45, status: 'verified' },
      { id: 't4', artist: 'A', title: 'T4', bpm: 125, camelot: '8B', energy: 0.75, status: 'verified' },
      { id: 't5', artist: 'A', title: 'T5', bpm: 125, camelot: '8A', energy: 0.95, status: 'verified' }
    ];
    const pairCostMatrix = seqUpgraded.buildCostMatrix(pairStrandedSet);
    const pairInitTour = [0, 1, 2, 3, 4, 5, 6];
    const pair2OptOnly = seqPlain2Opt.optimizeDirected2Opt(pairInitTour, pairCostMatrix, pairStrandedSet, {
      pinStart: true,
      pinEnd: true,
      enableOrOpt: false
    });
    const pairOrOpt = seqUpgraded.optimizeDirected2Opt(pairInitTour, pairCostMatrix, pairStrandedSet, {
      pinStart: true,
      pinEnd: true,
      enableOrOpt: true
    });
    const pairCost2Opt = seqPlain2Opt.evaluateTourObjective(pair2OptOnly, pairCostMatrix, pairStrandedSet);
    const pairCostOrOpt = seqUpgraded.evaluateTourObjective(pairOrOpt, pairCostMatrix, pairStrandedSet);
    assert.deepEqual(pair2OptOnly, [0, 1, 2, 3, 4, 5, 6], 'Plain 2-opt cannot move the 2-track pair across the rising chain');
    assert.deepEqual(pairOrOpt, [0, 3, 4, 5, 1, 2, 6], 'Or-opt(L=2) relocates the adjacent pair [p1, p2] together');
    assert.equal(pairCost2Opt, 10);
    assert.equal(pairCostOrOpt, 2);

    // 3. Full solve() end-to-end comparison on the barrier fixture
    const resPlain = seqPlain2Opt.solve(barrierSet);
    const resUpgraded = seqUpgraded.solve(barrierSet);
    assert.equal(resPlain.evaluation.totalCost, 10);
    assert.equal(resUpgraded.evaluation.totalCost, 2);
    assert.deepEqual(
      resUpgraded.orderedTracks.map(t => t.id),
      ['t0', 't4', 't1', 't2', 't3', 't5']
    );
  });

  test('Beam search warm-start respects locked opener and closer pins and DEFAULT_BEAM_WIDTH', () => {
    assert.equal(DEFAULT_BEAM_WIDTH, 50);

    const tracks = [
      { id: 't0', artist: 'A', title: 'T0', bpm: 122, camelot: '8A', status: 'verified' },
      { id: 't1', artist: 'A', title: 'T1', bpm: 123, camelot: '9A', status: 'verified' },
      { id: 't2', artist: 'A', title: 'T2', bpm: 124, camelot: '10A', status: 'verified' },
      { id: 't3', artist: 'A', title: 'T3', bpm: 125, camelot: '11A', status: 'verified' },
      { id: 't4', artist: 'A', title: 'T4', bpm: 126, camelot: '12A', status: 'verified' },
      { id: 't5', artist: 'A', title: 'T5', bpm: 127, camelot: '1A', status: 'verified' }
    ];

    const seq = new DJSequencer({ seed: 42, lockedOpenerId: 't3', lockedCloserId: 't1' });
    const costMatrix = seq.buildCostMatrix(tracks);
    const beamTours = seq.buildBeamTours(tracks, costMatrix, {
      pinStart: true,
      pinEnd: true,
      openerIndex: 3,
      closerIndex: 1
    });

    assert.ok(beamTours.length > 0, 'Beam search must return candidate tours');
    for (const tour of beamTours) {
      assert.equal(tour.length, tracks.length);
      assert.equal(tour[0], 3, 'Every beam tour must start with locked opener index');
      assert.equal(tour[tour.length - 1], 1, 'Every beam tour must end with locked closer index');
      assert.equal(new Set(tour).size, tracks.length, 'Every beam tour must visit each track exactly once');
    }

    const solved = seq.solve(tracks);
    assert.equal(solved.orderedTracks[0].id, 't3');
    assert.equal(solved.orderedTracks[solved.orderedTracks.length - 1].id, 't1');
  });

  test('Determinism: same seed produces identical order across repeated runs', () => {
    const keys = ['8A', '9A', '10A', '8B', '9B', '7A', '6A', '11A'];
    const tracks = Array.from({ length: 24 }, (_, i) => ({
      id: `det_${i}`,
      artist: `Artist ${i}`,
      title: `Track ${i}`,
      bpm: 120 + (i % 15),
      camelot: keys[i % keys.length],
      energy: 0.35 + ((i * 13) % 60) / 100,
      status: 'verified'
    }));

    const runA = new DJSequencer({ seed: 909 }).solve(tracks);
    const runB = new DJSequencer({ seed: 909 }).solve(tracks);

    assert.deepEqual(
      runA.orderedTracks.map(t => t.id),
      runB.orderedTracks.map(t => t.id),
      'Identical seed must yield the exact same track sequence'
    );
    assert.equal(runA.evaluation.totalCost, runB.evaluation.totalCost);
  });

  test('Arc-position penalty in improvement loop prevents placing >132 BPM track in first 20%', () => {
    // 6-track set: index 0 has progress = 0 / 5 = 0.0 (< 0.20 warm-up zone), while index >= 1 has progress >= 0.20.
    // Track `fast` has BPM 132.5 (> 132 BPM -> +0.8 arc penalty at index 0) and energy 0.60.
    // Track `warm` has BPM 132.0 (<= 132 BPM -> 0 arc penalty at index 0) and energy 0.70.
    // Putting `fast` at index 0 before `warm` avoids a -0.10 energy dip (saving 0.5 in edge cost),
    // but incurs +0.8 in arc-position penalty (net +0.3 worse).
    // When position penalty is ignored in local search, 2-opt reverses [warm, fast] to [fast, warm]
    // and places the >132 BPM track at index 0. With position penalty folded into 2-opt/Or-opt,
    // `warm` stays at index 0 and `fast` is kept out of the first 20%.
    const arcFixture = [
      { id: 'fast', artist: 'A', title: 'Fast Track', bpm: 132.5, camelot: '8A', energy: 0.60, status: 'verified' },
      { id: 'warm', artist: 'A', title: 'Warm Opener', bpm: 132.0, camelot: '8A', energy: 0.70, status: 'verified' },
      { id: 'mid1', artist: 'A', title: 'Mid 1', bpm: 132.5, camelot: '8A', energy: 0.75, status: 'verified' },
      { id: 'mid2', artist: 'A', title: 'Mid 2', bpm: 132.5, camelot: '8A', energy: 0.80, status: 'verified' },
      { id: 'mid3', artist: 'A', title: 'Mid 3', bpm: 132.5, camelot: '8A', energy: 0.85, status: 'verified' },
      { id: 'peak', artist: 'A', title: 'Peak', bpm: 132.5, camelot: '8A', energy: 0.90, status: 'verified' }
    ];

    const withoutPosPenalty = new DJSequencer({ seed: 42, includePositionPenalty: false }).solve(arcFixture);
    assert.equal(
      withoutPosPenalty.orderedTracks[0].id,
      'fast',
      'Without arc-position penalty in local search, >132 BPM track is placed in the first 20% for a 0.5 edge gain'
    );

    const withPosPenalty = new DJSequencer({ seed: 42 }).solve(arcFixture);
    assert.notEqual(
      withPosPenalty.orderedTracks[0].id,
      'fast',
      'With arc-position penalty folded into improvement objective, >132 BPM track is kept out of the first 20%'
    );
    assert.ok(
      withPosPenalty.orderedTracks[0].bpm <= 132,
      `Opener in first 20% must have BPM <= 132, got ${withPosPenalty.orderedTracks[0].bpm}`
    );
    assert.equal(
      calculateArcPositionPenalty(withPosPenalty.orderedTracks[0], 0, withPosPenalty.orderedTracks.length),
      0
    );
  });

  test('Unconfirmed tracks (tempoNeedsReview or recordingBlocksGrading) stay gated out per missing-data strategy in every phase', () => {
    const confirmedA = { id: 'c1', artist: 'A', title: 'C1', bpm: 124, camelot: '8A', status: 'corroborated' };
    const confirmedB = { id: 'c2', artist: 'A', title: 'C2', bpm: 125, camelot: '9A', status: 'corroborated' };
    const confirmedC = { id: 'c3', artist: 'A', title: 'C3', bpm: 126, camelot: '10A', status: 'corroborated' };
    // Corroborated + recordingNeedsReview does NOT block grading (cross-confirmed across 2 sources)
    const corroboratedFlagged = {
      id: 'c4', artist: 'A', title: 'C4', bpm: 125, camelot: '9A',
      status: 'corroborated', recordingNeedsReview: true
    };
    // Unconfirmed half-time BPM (would look like the lowest BPM 64 if not gated out of selectWarmUpCandidates!)
    const unconfirmedTempo = {
      id: 'u_tempo', artist: 'A', title: 'UTempo', bpm: 64, workingBpm: 64, camelot: '8A',
      status: 'single_source', tempoNeedsReview: true, tempoSuggestion: { bpm: 128, kind: 'doubled' }
    };
    // Single-source with recordingNeedsReview (recordingBlocksGrading === true)
    const unconfirmedRecording = {
      id: 'u_rec', artist: 'A', title: 'URec', bpm: 122, workingBpm: 122, camelot: '8A',
      status: 'single_source', recordingNeedsReview: true
    };

    const pool = [unconfirmedTempo, confirmedC, unconfirmedRecording, confirmedA, corroboratedFlagged, confirmedB];

    // 1. selectWarmUpCandidates must ignore unconfirmed BPMs
    const warmUps = selectWarmUpCandidates(pool, 3);
    assert.ok(
      warmUps.every(t => t.id !== 'u_tempo' && t.id !== 'u_rec'),
      'selectWarmUpCandidates must ignore tempoNeedsReview and recordingBlocksGrading tracks'
    );

    // 2. exclude strategy drops both unconfirmed tracks while keeping corroboratedFlagged
    const resExclude = new DJSequencer({ seed: 42, unverifiedStrategy: 'exclude' }).solve(pool);
    const excludeIds = resExclude.orderedTracks.map(t => t.id);
    assert.equal(resExclude.unverifiedCount, 2);
    assert.ok(!excludeIds.includes('u_tempo'), 'exclude must omit tempoNeedsReview track');
    assert.ok(!excludeIds.includes('u_rec'), 'exclude must omit single_source + recordingNeedsReview track');
    assert.ok(excludeIds.includes('c4'), 'corroborated + recordingNeedsReview track must remain sequencable');

    // 3. cluster_at_end places both unconfirmed tracks at the tail of the set
    const resEnd = new DJSequencer({ seed: 42, unverifiedStrategy: 'cluster_at_end' }).solve(pool);
    assert.deepEqual(
      resEnd.orderedTracks.slice(-2).map(t => t.id),
      ['u_tempo', 'u_rec'],
      'cluster_at_end must place unconfirmed tracks at the end'
    );

    // 4. cluster_at_start places both unconfirmed tracks at the start of the set
    const resStart = new DJSequencer({ seed: 42, unverifiedStrategy: 'cluster_at_start' }).solve(pool);
    assert.deepEqual(
      resStart.orderedTracks.slice(0, 2).map(t => t.id),
      ['u_tempo', 'u_rec'],
      'cluster_at_start must place unconfirmed tracks at the start'
    );

    // 5. keep_relative_position preserves their exact original slots (indices 0 and 2)
    const resKeep = new DJSequencer({ seed: 42, unverifiedStrategy: 'keep_relative_position' }).solve(pool);
    assert.equal(resKeep.orderedTracks[0].id, 'u_tempo');
    assert.equal(resKeep.orderedTracks[2].id, 'u_rec');
  });

  test('Performance sanity: 60-track synthetic set solves quickly client-side (< 250ms)', () => {
    const keys = [
      '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
      '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B'
    ];
    const synthetic60 = Array.from({ length: 60 }, (_, i) => ({
      id: `s60_${i}`,
      artist: `Artist ${i}`,
      title: `Track ${i}`,
      bpm: 118 + ((i * 19) % 19),
      camelot: keys[(i * 5) % keys.length],
      energy: 0.30 + ((i * 17) % 65) / 100,
      status: 'verified'
    }));

    const seq = new DJSequencer({ seed: 42 });
    const res = seq.solve(synthetic60);

    console.log(`  [60-Track Sanity] Runtime: ${res.stats.runtimeMs} ms`);
    assert.equal(res.orderedTracks.length, 60);
    assert.ok(res.stats.runtimeMs < 250, `Expected 60-track solve < 250ms, took ${res.stats.runtimeMs}ms`);
    assert.ok(
      res.evaluation.objectiveCost < res.originalEvaluation.objectiveCost,
      'Solved 60-track set must improve upon scrambled objective cost'
    );
  });
});
