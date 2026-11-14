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
    this.enableEnergy = options.enableEnergy !== undefined ? Boolean(options.enableEnergy) : true;
    this.maxIterations = options.maxIterations || 1500;
    this.unverifiedStrategy = options.unverifiedStrategy || 'keep_relative_position';
    this.lockedOpenerId = options.lockedOpenerId || null;
    this.lockedCloserId = options.lockedCloserId && options.lockedCloserId !== options.lockedOpenerId
      ? options.lockedCloserId
      : null;
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
  buildGreedyTour(startIndex, tracks, costMatrix, reservedEndIndex = null) {
    const n = tracks.length;
    const visited = new Uint8Array(n);
    const tour = [startIndex];
    visited[startIndex] = 1;
    const reserveEnd = reservedEndIndex !== null && reservedEndIndex !== startIndex && reservedEndIndex >= 0 && reservedEndIndex < n;
    if (reserveEnd) {
      visited[reservedEndIndex] = 1;
    }

    const innerSteps = reserveEnd ? n - 1 : n;
    for (let step = 1; step < innerSteps; step++) {
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

    if (reserveEnd) {
      tour.push(reservedEndIndex);
    }

    return tour;
  }

  /**
   * Directed 2-Opt local search optimizer.
   * STRICT: Reversing segment [i...j] reverses every directed internal edge (k -> k+1)
   * to (k+1 -> k). The exact directed delta is computed for all affected edges.
   */
  optimizeDirected2Opt(initialTour, costMatrix, tracks, { pinStart = false, pinEnd = false } = {}) {
    const n = initialTour.length;
    if (n < 4) return initialTour;

    const tour = [...initialTour];
    let improved = true;
    let iteration = 0;
    const minI = pinStart ? 1 : 0;
    const maxJ = pinEnd ? n - 2 : n - 1;

    while (improved && iteration < this.maxIterations) {
      improved = false;
      iteration++;

      for (let i = minI; i <= maxJ - 1; i++) {
        for (let j = i + 1; j <= maxJ; j++) {
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

    const pinLockedEndpoints = (list) => {
      if (this.unverifiedStrategy === 'exclude' || (!this.lockedOpenerId && !this.lockedCloserId)) {
        return list;
      }
      const next = [...list];
      if (this.lockedOpenerId) {
        const idx = next.findIndex(t => t.id === this.lockedOpenerId);
        if (idx > 0) {
          const [opener] = next.splice(idx, 1);
          next.unshift(opener);
        }
      }
      if (this.lockedCloserId && next.length > 1) {
        const idx = next.findIndex(t => t.id === this.lockedCloserId);
        if (idx !== -1 && idx < next.length - 1 && next[idx].id !== this.lockedOpenerId) {
          const [closer] = next.splice(idx, 1);
          next.push(closer);
        }
      }
      return next;
    };

    // If fewer than 2 sequencable tracks, honor locked anchors if any and evaluate
    if (sequencable.length < 2) {
      const anchoredRaw = pinLockedEndpoints(this.unverifiedStrategy === 'exclude'
        ? sequencable.map(s => s.track) : rawTracks);
      const evaluation = evaluateSequence(anchoredRaw, { enableEnergy: this.enableEnergy });
      return {
        orderedTracks: anchoredRaw,
        originalTracks: rawTracks,
        evaluation,
        originalEvaluation: evaluateSequence(rawTracks, { enableEnergy: this.enableEnergy }),
        unverifiedCount: unverified.length,
        stats: { runtimeMs: performance.now() - startTime, memoryDeltaBytes: 0, iterations: 0 }
      };
    }

    const seqTracksOnly = sequencable.map(s => s.track);
    const costMatrix = this.buildCostMatrix(seqTracksOnly);

    // 2. Multi-start greedy warm-up (with optional anchored opener/closer endpoints)
    const seqOpenerIdx = this.lockedOpenerId ? seqTracksOnly.findIndex(t => t.id === this.lockedOpenerId) : -1;
    const seqCloserIdx = this.lockedCloserId ? seqTracksOnly.findIndex(t => t.id === this.lockedCloserId) : -1;
    const pinStart = seqOpenerIdx !== -1;
    const pinEnd = seqCloserIdx !== -1 && seqCloserIdx !== seqOpenerIdx;
    const reservedEnd = pinEnd ? seqCloserIdx : null;

    const warmUpCandidates = selectWarmUpCandidates(seqTracksOnly, 4);
    let bestTour = null;
    let bestTourCost = Infinity;

    const considerTour = (tour) => {
      let tourCost = 0;
      for (let k = 0; k < tour.length - 1; k++) {
        tourCost += costMatrix[tour[k]][tour[k + 1]];
      }
      if (tourCost < bestTourCost) {
        bestTourCost = tourCost;
        bestTour = tour;
      }
    };

    const startIndices = pinStart
      ? [seqOpenerIdx]
      : warmUpCandidates
          .map(cand => seqTracksOnly.indexOf(cand))
          .filter(idx => idx !== -1 && idx !== reservedEnd);
    if (startIndices.length === 0) {
      const fallbackStart = seqTracksOnly.findIndex((_, idx) => idx !== reservedEnd);
      if (fallbackStart !== -1) startIndices.push(fallbackStart);
    }

    for (const startIndex of startIndices) {
      const greedyTour = this.buildGreedyTour(startIndex, seqTracksOnly, costMatrix, reservedEnd);
      considerTour(this.optimizeDirected2Opt(greedyTour, costMatrix, seqTracksOnly, { pinStart, pinEnd }));
    }

    // Always consider the user's imported order as a candidate (respecting any pinned endpoints)
    const baseIndices = seqTracksOnly.map((_, i) => i).filter(i => i !== (pinStart ? seqOpenerIdx : -1) && i !== (pinEnd ? seqCloserIdx : -1));
    const anchoredOriginalTour = [
      ...(pinStart ? [seqOpenerIdx] : []),
      ...baseIndices,
      ...(pinEnd ? [seqCloserIdx] : [])
    ];
    considerTour(this.optimizeDirected2Opt(anchoredOriginalTour, costMatrix, seqTracksOnly, { pinStart, pinEnd }));

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

    finalTracks = pinLockedEndpoints(finalTracks);

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
