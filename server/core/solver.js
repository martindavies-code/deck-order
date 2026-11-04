import { calculateTransitionCost, evaluateSequence } from './costMatrix.js';
import { selectWarmUpCandidates, calculateArcPositionPenalty, annotateEnergyResets } from './energyArc.js';

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 * Ensures reproducible sequencing results for a given seed.
 */
function createPrng(seed = 1337) {
  let s = Math.floor(seed);
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const getHeapUsed = () => (typeof process !== 'undefined' && typeof process?.memoryUsage === 'function')
  ? process.memoryUsage().heapUsed
  : null;

/**
 * Sequencer solving DJ track ordering via greedy warm-start and directed 2-opt.
 */
export class DJSequencer {
  constructor(options = {}) {
    this.seed = options.seed || 42;
    this.enableEnergy = options.enableEnergy || false;
    this.maxIterations = options.maxIterations || 1500;
    this.unverifiedStrategy = options.unverifiedStrategy || 'keep_relative_position';
    // 'keep_relative_position' | 'cluster_at_end' | 'cluster_at_start' | 'exclude'
  }

  /**
   * Builds precomputed directed cost matrix C[u][v] = C(track_u -> track_v).
   * Fast O(1) table lookup for directed 2-opt evaluations.
   */
  buildCostMatrix(tracks) {
    const n = tracks.length;
    const matrix = Array.from({ length: n }, () => new Float32Array(n));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = Infinity;
        } else {
          const res = calculateTransitionCost(tracks[i], tracks[j], {
            enableEnergy: this.enableEnergy
          });
          matrix[i][j] = res.totalCost;
        }
      }
    }
    return matrix;
  }

  /**
   * Greedy nearest-neighbour tour from a specific starting track index
   */
  buildGreedyTour(startIndex, tracks, costMatrix) {
    const n = tracks.length;
    const visited = new Uint8Array(n);
    const tour = [startIndex];
    visited[startIndex] = 1;

    for (let step = 1; step < n; step++) {
      const current = tour[tour.length - 1];
      let bestNext = -1;
      let lowestCost = Infinity;

      for (let cand = 0; cand < n; cand++) {
        if (!visited[cand]) {
          const cost = costMatrix[current][cand] + calculateArcPositionPenalty(tracks[cand], step, n);
          if (cost < lowestCost) {
            lowestCost = cost;
            bestNext = cand;
          }
        }
      }

      if (bestNext !== -1) {
        tour.push(bestNext);
        visited[bestNext] = 1;
      }
    }

    return tour;
  }

  /**
   * Directed 2-Opt local search optimizer.
   * STRICT: Reversing segment [i...j] reverses every directed internal edge (k -> k+1)
   * to (k+1 -> k). The exact directed delta is computed for all affected edges.
   */
  optimizeDirected2Opt(initialTour, costMatrix, tracks) {
    const n = initialTour.length;
    if (n < 4) return initialTour;

    const tour = [...initialTour];
    let improved = true;
    let iteration = 0;

    while (improved && iteration < this.maxIterations) {
      improved = false;
      iteration++;

      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          // Reversing segment from i to j
          // Segment must have at least 2 tracks (i.e. j >= i + 1)
          if (i === 0 && j === n - 1) continue; // reversing entire tour changes nothing

          const p_i_minus_1 = i > 0 ? tour[i - 1] : null;
          const p_i = tour[i];
          const p_j = tour[j];
          const p_j_plus_1 = j < n - 1 ? tour[j + 1] : null;

          let delta = 0;

          // 1. Entry edge delta: (p_{i-1} -> p_j) vs (p_{i-1} -> p_i)
          if (p_i_minus_1 !== null) {
            delta += costMatrix[p_i_minus_1][p_j] - costMatrix[p_i_minus_1][p_i];
          }

          // 2. Exit edge delta: (p_i -> p_{j+1}) vs (p_j -> p_{j+1})
          if (p_j_plus_1 !== null) {
            delta += costMatrix[p_i][p_j_plus_1] - costMatrix[p_j][p_j_plus_1];
          }

          // 3. Directed internal edges delta:
          // In old tour: (p_k -> p_{k+1}) for k in i..j-1
          // In new reversed tour: (p_{k+1} -> p_k)
          for (let k = i; k < j; k++) {
            const u = tour[k];
            const v = tour[k + 1];
            // Old was u -> v, new is v -> u
            delta += costMatrix[v][u] - costMatrix[u][v];
          }

          // If delta is negative, the reversal yields a strictly lower directed cost!
          if (delta < -1e-4) {
            // Apply reversal of subarray between i and j
            let left = i;
            let right = j;
            while (left < right) {
              const temp = tour[left];
              tour[left] = tour[right];
              tour[right] = temp;
              left++;
              right--;
            }
            improved = true;
            break; // restart scan
          }
        }
        if (improved) break;
      }
    }

    return tour;
  }

  /**
   * Main solve routine.
   * Handles unverified separation, multi-start greedy warmup, directed 2-opt,
   * unverified re-integration according to user choice, and metrics evaluation.
   */
  solve(rawTracks) {
    const startTime = performance.now();
    const memBefore = getHeapUsed();

    if (!rawTracks || rawTracks.length === 0) {
      return {
        orderedTracks: [],
        originalTracks: [],
        evaluation: evaluateSequence([]),
        originalEvaluation: evaluateSequence([]),
        unverifiedCount: 0,
        stats: { runtimeMs: 0, memoryDeltaBytes: null, iterations: 0 }
      };
    }

    // 1. Separate verified/disputed (sequencable) from unverified tracks
    const sequencable = [];
    const unverified = [];

    rawTracks.forEach((t, origIdx) => {
      // Must have BPM and Camelot for harmonic sequencing
      if (t.bpm && t.camelot && t.status !== 'unverified' && t.status !== 'missing') {
        sequencable.push({ track: t, originalIndex: origIdx });
      } else {
        unverified.push({ track: t, originalIndex: origIdx });
      }
    });

    // If fewer than 2 sequencable tracks, return as-is
    if (sequencable.length < 2) {
      const evaluation = evaluateSequence(rawTracks, { enableEnergy: this.enableEnergy });
      return {
        orderedTracks: rawTracks,
        originalTracks: rawTracks,
        evaluation,
        originalEvaluation: evaluation,
        unverifiedCount: unverified.length,
        stats: { runtimeMs: performance.now() - startTime, memoryDeltaBytes: 0, iterations: 0 }
      };
    }

    const seqTracksOnly = sequencable.map(s => s.track);
    const costMatrix = this.buildCostMatrix(seqTracksOnly);

    // 2. Multi-start greedy warm-up
    const warmUpCandidates = selectWarmUpCandidates(seqTracksOnly, 4);
    let bestTour = null;
    let bestTourCost = Infinity;

    for (const cand of warmUpCandidates) {
      const startIndex = seqTracksOnly.indexOf(cand);
      if (startIndex === -1) continue;

      const greedyTour = this.buildGreedyTour(startIndex, seqTracksOnly, costMatrix);
      const optimizedTour = this.optimizeDirected2Opt(greedyTour, costMatrix, seqTracksOnly);

      // Evaluate tour cost
      let tourCost = 0;
      for (let k = 0; k < optimizedTour.length - 1; k++) {
        tourCost += costMatrix[optimizedTour[k]][optimizedTour[k + 1]];
      }

      if (tourCost < bestTourCost) {
        bestTourCost = tourCost;
        bestTour = optimizedTour;
      }
    }

    // Map best tour back to tracks
    const sequencedTracks = bestTour.map(idx => sequencable[idx].track);

    // 3. Integrate unverified tracks based on user-chosen strategy
    let finalTracks = [];
    if (unverified.length === 0 || this.unverifiedStrategy === 'exclude') {
      finalTracks = sequencedTracks;
    } else if (this.unverifiedStrategy === 'cluster_at_start') {
      finalTracks = [...unverified.map(u => u.track), ...sequencedTracks];
    } else if (this.unverifiedStrategy === 'cluster_at_end') {
      finalTracks = [...sequencedTracks, ...unverified.map(u => u.track)];
    } else {
      // Default: 'keep_relative_position'
      // Preserves original indices of unverified tracks, interleaving sequenced tracks
      finalTracks = new Array(rawTracks.length);
      const unverifiedIndices = new Set(unverified.map(u => u.originalIndex));

      for (const u of unverified) {
        finalTracks[u.originalIndex] = u.track;
      }

      let seqPtr = 0;
      for (let i = 0; i < rawTracks.length; i++) {
        if (!unverifiedIndices.has(i) && seqPtr < sequencedTracks.length) {
          finalTracks[i] = sequencedTracks[seqPtr++];
        }
      }
    }

    // 4. Evaluate new and original sequence
    const evaluation = evaluateSequence(finalTracks, { enableEnergy: this.enableEnergy });
    annotateEnergyResets(evaluation.transitions);

    const originalEvaluation = evaluateSequence(rawTracks, { enableEnergy: this.enableEnergy });
    annotateEnergyResets(originalEvaluation.transitions);

    const memAfter = getHeapUsed();
    const runtimeMs = Math.round((performance.now() - startTime) * 100) / 100;
    const memoryDeltaBytes = (memBefore !== null && memAfter !== null)
      ? Math.max(0, memAfter - memBefore)
      : null;

    return {
      orderedTracks: finalTracks,
      originalTracks: rawTracks,
      evaluation,
      originalEvaluation,
      unverifiedCount: unverified.length,
      stats: {
        runtimeMs,
        memoryDeltaBytes,
        trackCount: rawTracks.length,
        sequencableCount: sequencable.length
      }
    };
  }
}
