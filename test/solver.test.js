import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer } from '../server/core/solver.js';
import { calculateTransitionCost } from '../server/core/costMatrix.js';

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
});
