import { calculateTransitionCost, evaluateSequence } from './costMatrix.js';
import {
  selectWarmUpCandidates,
  calculateArcPositionPenalty,
  annotateEnergyResets,
  isTrackConfirmedForSequencing
} from './energyArc.js';

export const DEFAULT_BEAM_WIDTH = 50;
export const DEFAULT_MAX_ITERATIONS = 1500;
const IMPROVE_EPSILON = 1e-4;

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
 * Sequencer solving DJ track ordering via greedy + beam-search warm-start
 * and directed 2-opt + Or-opt (1-track and 2-track relocate) local search.
 */
export class DJSequencer {
  constructor(options = {}) {
    this.seed = options.seed || 42;
    this.enableEnergy = options.enableEnergy !== undefined ? Boolean(options.enableEnergy) : true;
    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.beamWidth = options.beamWidth !== undefined
      ? Math.max(1, Math.floor(Number(options.beamWidth)) || DEFAULT_BEAM_WIDTH)
      : DEFAULT_BEAM_WIDTH;
    this.enableBeamSearch = options.enableBeamSearch !== undefined ? Boolean(options.enableBeamSearch) : true;
    this.enableOrOpt = options.enableOrOpt !== undefined ? Boolean(options.enableOrOpt) : true;
    this.includePositionPenalty = options.includePositionPenalty !== undefined
      ? Boolean(options.includePositionPenalty)
      : true;
    this.unverifiedStrategy = options.unverifiedStrategy || 'keep_relative_position';
    this.lockedOpenerId = options.lockedOpenerId || null;
    this.lockedCloserId = options.lockedCloserId && options.lockedCloserId !== options.lockedOpenerId
      ? options.lockedCloserId
      : null;
    // 'keep_relative_position' | 'cluster_at_end' | 'cluster_at_start' | 'exclude'
  }

  /**
   * Builds precomputed directed cost matrix C[u][v] = C(track_u -> track_v).
   * Fast O(1) table lookup for beam search, directed 2-opt, and Or-opt evaluations.
   */
  buildCostMatrix(tracks) {
    const n = tracks.length;
    const matrix = Array.from({ length: n }, () => new Float64Array(n));

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
   * Builds precomputed arc-position penalty matrix P[u][pos] = penalty(track_u at pos of n).
   */
  buildPositionPenaltyMatrix(tracks) {
    const n = tracks.length;
    const matrix = Array.from({ length: n }, () => new Float64Array(n));
    for (let u = 0; u < n; u++) {
      for (let pos = 0; pos < n; pos++) {
        matrix[u][pos] = calculateArcPositionPenalty(tracks[u], pos, n);
      }
    }
    return matrix;
  }

  /**
   * Evaluates the full solver objective for a candidate index tour:
   * sum of directed transition costs + sum of arc-position penalties.
   */
  evaluateTourObjective(
    tour,
    costMatrix,
    tracks = null,
    posPenaltyMatrix = null,
    includePositionPenalty = this.includePositionPenalty
  ) {
    const n = tour.length;
    if (n === 0) return 0;

    let total = 0;
    for (let k = 0; k < n - 1; k++) {
      total += costMatrix[tour[k]][tour[k + 1]];
    }

    if (includePositionPenalty) {
      if (posPenaltyMatrix) {
        for (let k = 0; k < n; k++) {
          total += posPenaltyMatrix[tour[k]][k];
        }
      } else if (tracks) {
        for (let k = 0; k < n; k++) {
          total += calculateArcPositionPenalty(tracks[tour[k]], k, n);
        }
      }
    }

    return total;
  }

  /**
   * Greedy nearest-neighbour tour from a specific starting track index
   */
  buildGreedyTour(startIndex, tracks, costMatrix, reservedEndIndex = null, posPenaltyMatrix = null) {
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
          const posPen = this.includePositionPenalty
            ? (posPenaltyMatrix ? posPenaltyMatrix[cand][step] : calculateArcPositionPenalty(tracks[cand], step, n))
            : 0;
          const cost = costMatrix[current][cand] + posPen;
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
   * Beam-search warm start over partial orders.
   * Expands up to `beamWidth` best partial tours step-by-step using the precomputed
   * directed cost matrix and arc-position penalty, respecting locked opener/closer pins
   * and pruning dominated states that share identical (lastTrack, visitedSet) via
   * deterministic Zobrist hashing.
   */
  buildBeamTours(
    tracks,
    costMatrix,
    {
      pinStart = false,
      pinEnd = false,
      openerIndex = -1,
      closerIndex = -1,
      beamWidth = this.beamWidth,
      maxReturnedTours = 4,
      posPenaltyMatrix = null
    } = {}
  ) {
    const n = tracks.length;
    if (n === 0) return [];
    if (n === 1) return [[0]];

    const bw = Math.max(1, Math.floor(Number(beamWidth)) || DEFAULT_BEAM_WIDTH);
    const penMatrix = this.includePositionPenalty
      ? (posPenaltyMatrix || this.buildPositionPenaltyMatrix(tracks))
      : null;

    const hasValidOpener = pinStart && openerIndex >= 0 && openerIndex < n;
    const reserveEnd = pinEnd && closerIndex >= 0 && closerIndex < n && (!hasValidOpener || closerIndex !== openerIndex);
    const reservedEnd = reserveEnd ? closerIndex : -1;

    // Deterministic Zobrist hashes for O(1) visited-set dominance pruning
    const prng = createPrng(this.seed);
    const zobristHi = new Uint32Array(n);
    const zobristLo = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      zobristHi[i] = Math.floor(prng() * 0x100000000) >>> 0;
      zobristLo[i] = Math.floor(prng() * 0x100000000) >>> 0;
    }

    let startIndices = [];
    if (hasValidOpener) {
      startIndices = [openerIndex];
    } else {
      const warmUps = selectWarmUpCandidates(tracks, Math.min(n, bw));
      const seenStarts = new Set();
      for (const cand of warmUps) {
        const idx = tracks.indexOf(cand);
        if (idx !== -1 && idx !== reservedEnd && !seenStarts.has(idx)) {
          seenStarts.add(idx);
          startIndices.push(idx);
        }
      }
      for (let idx = 0; idx < n && startIndices.length < bw; idx++) {
        if (idx !== reservedEnd && !seenStarts.has(idx)) {
          seenStarts.add(idx);
          startIndices.push(idx);
        }
      }
    }

    const innerSteps = reserveEnd ? n - 1 : n;
    let beam = [];

    for (const startIdx of startIndices.slice(0, bw)) {
      const visited = new Uint8Array(n);
      visited[startIdx] = 1;
      if (reserveEnd) visited[reservedEnd] = 1;

      let cost = penMatrix ? penMatrix[startIdx][0] : 0;
      let tour = [startIdx];

      if (innerSteps === 1 && reserveEnd) {
        cost += costMatrix[startIdx][reservedEnd] + (penMatrix ? penMatrix[reservedEnd][n - 1] : 0);
        tour = [startIdx, reservedEnd];
      }

      beam.push({
        tour,
        visited,
        cost,
        hashHi: zobristHi[startIdx],
        hashLo: zobristLo[startIdx]
      });
    }

    for (let step = 1; step < innerSteps; step++) {
      const isLastInnerStep = step === innerSteps - 1;
      const candidates = [];

      for (let p = 0; p < beam.length; p++) {
        const state = beam[p];
        const visited = state.visited;
        const last = state.tour[state.tour.length - 1];
        const baseCost = state.cost;
        const row = costMatrix[last];

        for (let cand = 0; cand < n; cand++) {
          if (visited[cand]) continue;
          let nextCost = baseCost + row[cand] + (penMatrix ? penMatrix[cand][step] : 0);
          if (isLastInnerStep && reserveEnd) {
            nextCost += costMatrix[cand][reservedEnd] + (penMatrix ? penMatrix[reservedEnd][n - 1] : 0);
          }
          candidates.push({
            parentIdx: p,
            cand,
            cost: nextCost,
            hashHi: (state.hashHi ^ zobristHi[cand]) >>> 0,
            hashLo: (state.hashLo ^ zobristLo[cand]) >>> 0
          });
        }
      }

      candidates.sort((a, b) => a.cost - b.cost || a.parentIdx - b.parentIdx || a.cand - b.cand);

      const nextBeam = [];
      const seenStates = new Set();

      for (let c = 0; c < candidates.length && nextBeam.length < bw; c++) {
        const item = candidates[c];
        const domKey = `${item.cand}:${item.hashHi}:${item.hashLo}`;
        if (seenStates.has(domKey)) continue;
        seenStates.add(domKey);

        const parent = beam[item.parentIdx];
        const nextVisited = new Uint8Array(parent.visited);
        nextVisited[item.cand] = 1;
        const nextTour = isLastInnerStep && reserveEnd
          ? [...parent.tour, item.cand, reservedEnd]
          : [...parent.tour, item.cand];

        nextBeam.push({
          tour: nextTour,
          visited: nextVisited,
          cost: item.cost,
          hashHi: item.hashHi,
          hashLo: item.hashLo
        });
      }

      beam = nextBeam;
    }

    const limit = Math.max(1, maxReturnedTours);
    return beam.slice(0, limit).map(b => b.tour);
  }

  /**
   * Convenience wrapper returning the single best beam-search tour.
   */
  buildBeamTour(tracks, costMatrix, options = {}) {
    const tours = this.buildBeamTours(tracks, costMatrix, { ...options, maxReturnedTours: 1 });
    return tours[0] || [];
  }

  /**
   * Directed 2-Opt + Or-Opt local search optimizer.
   * - 2-Opt: Reverses segment [i...j], computing the exact directed delta across
   *   boundary edges, all reversed internal edges (k+1 -> k vs k -> k+1), and
   *   exact arc-position penalty changes over positions [i...j].
   * - Or-Opt: Relocates a contiguous run of 1 or 2 tracks to the position that
   *   most reduces total directed edge cost + arc-position penalty without
   *   inverting the intermediate chain.
   * Iterates both move families until no strictly improving move exists or
   * `this.maxIterations` is reached, keeping locked opener/closer pins fixed.
   */
  optimizeDirected2Opt(
    initialTour,
    costMatrix,
    tracks,
    {
      pinStart = false,
      pinEnd = false,
      enableOrOpt = this.enableOrOpt,
      includePositionPenalty = this.includePositionPenalty,
      posPenaltyMatrix = null
    } = {}
  ) {
    const n = initialTour.length;
    if (n < 2) return [...initialTour];

    const tour = [...initialTour];
    const minI = pinStart ? 1 : 0;
    const maxJ = pinEnd ? n - 2 : n - 1;
    if (maxJ - minI < 1) return tour;

    const penMatrix = includePositionPenalty && tracks
      ? (posPenaltyMatrix || this.buildPositionPenaltyMatrix(tracks))
      : null;

    let improved = true;
    let iteration = 0;

    while (improved && iteration < this.maxIterations) {
      improved = false;
      iteration++;

      // Phase 1: Directed 2-Opt (segment reversal)
      // Running prefix sums for internal reversed edges and old segment position penalty
      // make each (i, j) check O(1) instead of O(j - i), reducing a pass from O(n^3) to O(n^2).
      for (let i = minI; i <= maxJ - 1; i++) {
        const p_i_minus_1 = i > 0 ? tour[i - 1] : null;
        const p_i = tour[i];
        const entryOldCost = p_i_minus_1 !== null ? costMatrix[p_i_minus_1][p_i] : 0;

        let internalEdgeDelta = 0;
        let oldSegPen = penMatrix !== null ? penMatrix[p_i][i] : 0;

        for (let j = i + 1; j <= maxJ; j++) {
          const prev = tour[j - 1];
          const p_j = tour[j];

          // Update running internal reversed-edge delta for the newly included edge (prev -> p_j)
          internalEdgeDelta += costMatrix[p_j][prev] - costMatrix[prev][p_j];
          if (penMatrix !== null) {
            oldSegPen += penMatrix[p_j][j];
          }

          if (i === 0 && j === n - 1) continue;

          const p_j_plus_1 = j < n - 1 ? tour[j + 1] : null;
          let edgeDelta = internalEdgeDelta;

          // 1. Entry edge delta: (p_{i-1} -> p_j) vs (p_{i-1} -> p_i)
          if (p_i_minus_1 !== null) {
            edgeDelta += costMatrix[p_i_minus_1][p_j] - entryOldCost;
          }

          // 2. Exit edge delta: (p_i -> p_{j+1}) vs (p_j -> p_{j+1})
          if (p_j_plus_1 !== null) {
            edgeDelta += costMatrix[p_i][p_j_plus_1] - costMatrix[p_j][p_j_plus_1];
          }

          // 3. Exact arc-position penalty delta across reversed positions [i...j].
          // Since newSegPen >= 0, total delta = edgeDelta + newSegPen - oldSegPen >= edgeDelta - oldSegPen.
          if (edgeDelta - oldSegPen >= -IMPROVE_EPSILON) continue;

          let delta = edgeDelta - oldSegPen;
          if (penMatrix !== null) {
            let newSegPen = 0;
            for (let k = i; k <= j; k++) {
              newSegPen += penMatrix[tour[i + j - k]][k];
            }
            delta += newSegPen;
          }

          if (delta < -IMPROVE_EPSILON) {
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
            break;
          }
        }
        if (improved) break;
      }

      if (improved || !enableOrOpt) continue;

      // Phase 2: Directed Or-Opt (relocate a contiguous segment of length 1 or 2)
      for (let segLen = 1; segLen <= 2; segLen++) {
        if (maxJ - minI + 1 <= segLen) continue;

        for (let i = minI; i <= maxJ - segLen + 1; i++) {
          const sFirst = tour[i];
          const sLast = tour[i + segLen - 1];
          const prev = i > 0 ? tour[i - 1] : -1;
          const next = (i + segLen < n) ? tour[i + segLen] : -1;

          // Edge delta of excising segment [i .. i + segLen - 1]
          let removeEdgeDelta = 0;
          if (prev !== -1) removeEdgeDelta -= costMatrix[prev][sFirst];
          if (next !== -1) removeEdgeDelta -= costMatrix[sLast][next];
          if (prev !== -1 && next !== -1) removeEdgeDelta += costMatrix[prev][next];

          let bestDelta = -IMPROVE_EPSILON;
          let bestIns = -1;

          // 2a. Leftward relocations: target start index `ins` from i - 1 down to minI
          let shiftPosDelta = 0;
          for (let ins = i - 1; ins >= minI; ins--) {
            if (penMatrix !== null) {
              const shiftedTrack = tour[ins];
              shiftPosDelta += penMatrix[shiftedTrack][ins + segLen] - penMatrix[shiftedTrack][ins];
            }

            const u = ins > 0 ? tour[ins - 1] : -1;
            const v = tour[ins];
            let insertEdgeDelta = costMatrix[sLast][v];
            if (u !== -1) {
              insertEdgeDelta += costMatrix[u][sFirst] - costMatrix[u][v];
            }

            let segPosDelta = 0;
            if (penMatrix !== null) {
              for (let r = 0; r < segLen; r++) {
                const segTrack = tour[i + r];
                segPosDelta += penMatrix[segTrack][ins + r] - penMatrix[segTrack][i + r];
              }
            }

            const totalDelta = removeEdgeDelta + insertEdgeDelta + shiftPosDelta + segPosDelta;
            if (totalDelta < bestDelta) {
              bestDelta = totalDelta;
              bestIns = ins;
            }
          }

          // 2b. Rightward relocations: target start index `ins` from i + 1 up to maxJ - segLen + 1
          shiftPosDelta = 0;
          for (let ins = i + 1; ins <= maxJ - segLen + 1; ins++) {
            const newlyShiftedIdx = ins + segLen - 1;
            if (penMatrix !== null) {
              const shiftedTrack = tour[newlyShiftedIdx];
              shiftPosDelta += penMatrix[shiftedTrack][newlyShiftedIdx - segLen] - penMatrix[shiftedTrack][newlyShiftedIdx];
            }

            const u = tour[newlyShiftedIdx];
            const v = (ins + segLen < n) ? tour[ins + segLen] : -1;
            let insertEdgeDelta = costMatrix[u][sFirst];
            if (v !== -1) {
              insertEdgeDelta += costMatrix[sLast][v] - costMatrix[u][v];
            }

            let segPosDelta = 0;
            if (penMatrix !== null) {
              for (let r = 0; r < segLen; r++) {
                const segTrack = tour[i + r];
                segPosDelta += penMatrix[segTrack][ins + r] - penMatrix[segTrack][i + r];
              }
            }

            const totalDelta = removeEdgeDelta + insertEdgeDelta + shiftPosDelta + segPosDelta;
            if (totalDelta < bestDelta) {
              bestDelta = totalDelta;
              bestIns = ins;
            }
          }

          if (bestIns !== -1) {
            const segment = tour.splice(i, segLen);
            tour.splice(bestIns, 0, ...segment);
            improved = true;
            break;
          }
        }

        if (improved) break;
      }
    }

    return tour;
  }

  /**
   * Main solve routine.
   * Handles unconfirmed/unverified separation, greedy + beam-search warm-ups,
   * directed 2-opt + Or-opt local search with arc-position penalties,
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

    // 1. Separate confirmed sequencable tracks from unverified / review-blocked tracks
    const sequencable = [];
    const unverified = [];

    rawTracks.forEach((t, origIdx) => {
      if (isTrackConfirmedForSequencing(t)) {
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
    const posPenaltyMatrix = this.includePositionPenalty
      ? this.buildPositionPenaltyMatrix(seqTracksOnly)
      : null;

    // 2. Warm-up + local improvement (with optional anchored opener/closer endpoints)
    const seqOpenerIdx = this.lockedOpenerId ? seqTracksOnly.findIndex(t => t.id === this.lockedOpenerId) : -1;
    const seqCloserIdx = this.lockedCloserId ? seqTracksOnly.findIndex(t => t.id === this.lockedCloserId) : -1;
    const pinStart = seqOpenerIdx !== -1;
    const pinEnd = seqCloserIdx !== -1 && seqCloserIdx !== seqOpenerIdx;
    const reservedEnd = pinEnd ? seqCloserIdx : null;

    const warmUpCandidates = selectWarmUpCandidates(seqTracksOnly, 4);
    let bestTour = null;
    let bestTourCost = Infinity;

    const considerTour = (tour) => {
      if (!tour || tour.length !== seqTracksOnly.length) return;
      const tourCost = this.evaluateTourObjective(
        tour,
        costMatrix,
        seqTracksOnly,
        posPenaltyMatrix,
        this.includePositionPenalty
      );
      if (tourCost < bestTourCost - 1e-9) {
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

    // 2a. Multi-start greedy nearest-neighbour warm-ups
    for (const startIndex of startIndices) {
      const greedyTour = this.buildGreedyTour(startIndex, seqTracksOnly, costMatrix, reservedEnd, posPenaltyMatrix);
      considerTour(greedyTour);
      considerTour(this.optimizeDirected2Opt(greedyTour, costMatrix, seqTracksOnly, {
        pinStart,
        pinEnd,
        posPenaltyMatrix
      }));
    }

    // 2b. Beam-search warm start
    if (this.enableBeamSearch) {
      const beamTours = this.buildBeamTours(seqTracksOnly, costMatrix, {
        pinStart,
        pinEnd,
        openerIndex: seqOpenerIdx,
        closerIndex: seqCloserIdx,
        beamWidth: this.beamWidth,
        maxReturnedTours: 4,
        posPenaltyMatrix
      });
      const toursToRefine = [];
      for (const beamTour of beamTours) {
        considerTour(beamTour);
        if (toursToRefine.length === 0) {
          toursToRefine.push(beamTour);
        } else if (toursToRefine.length < 2) {
          let diffPositions = 0;
          const primary = toursToRefine[0];
          for (let k = 0; k < beamTour.length; k++) {
            if (beamTour[k] !== primary[k]) diffPositions++;
          }
          if (diffPositions >= Math.max(2, Math.floor(beamTour.length * 0.25))) {
            toursToRefine.push(beamTour);
          }
        }
      }
      for (const beamTour of toursToRefine) {
        considerTour(this.optimizeDirected2Opt(beamTour, costMatrix, seqTracksOnly, {
          pinStart,
          pinEnd,
          posPenaltyMatrix
        }));
      }
    }

    // 2c. Always consider the user's imported order as a candidate (respecting any pinned endpoints)
    const baseIndices = seqTracksOnly
      .map((_, i) => i)
      .filter(i => i !== (pinStart ? seqOpenerIdx : -1) && i !== (pinEnd ? seqCloserIdx : -1));
    const anchoredOriginalTour = [
      ...(pinStart ? [seqOpenerIdx] : []),
      ...baseIndices,
      ...(pinEnd ? [seqCloserIdx] : [])
    ];
    considerTour(anchoredOriginalTour);
    considerTour(this.optimizeDirected2Opt(anchoredOriginalTour, costMatrix, seqTracksOnly, {
      pinStart,
      pinEnd,
      posPenaltyMatrix
    }));

    // Map best tour back to tracks
    const sequencedTracks = bestTour.map(idx => sequencable[idx].track);

    // 3. Integrate unverified tracks based on user-chosen strategy
    const assembleTracks = (seqList) => {
      let assembled = [];
      if (unverified.length === 0 || this.unverifiedStrategy === 'exclude') {
        assembled = seqList;
      } else if (this.unverifiedStrategy === 'cluster_at_start') {
        assembled = [...unverified.map(u => u.track), ...seqList];
      } else if (this.unverifiedStrategy === 'cluster_at_end') {
        assembled = [...seqList, ...unverified.map(u => u.track)];
      } else {
        // Default: 'keep_relative_position'
        // Preserves original indices of unverified tracks, interleaving sequenced tracks
        assembled = new Array(rawTracks.length);
        const unverifiedIndices = new Set(unverified.map(u => u.originalIndex));

        for (const u of unverified) {
          assembled[u.originalIndex] = u.track;
        }

        let seqPtr = 0;
        for (let i = 0; i < rawTracks.length; i++) {
          if (!unverifiedIndices.has(i) && seqPtr < seqList.length) {
            assembled[i] = seqList[seqPtr++];
          }
        }
      }
      return pinLockedEndpoints(assembled);
    };

    let finalTracks = assembleTracks(sequencedTracks);

    // 4. Evaluate new and original sequence
    let evaluation = evaluateSequence(finalTracks, { enableEnergy: this.enableEnergy });
    const originalEvaluation = evaluateSequence(rawTracks, { enableEnergy: this.enableEnergy });

    // If keeping relative positions of unverified tracks split a contiguous edge in a way
    // that regressed the assembled objective vs the anchored imported order, keep the anchored imported order.
    if (
      unverified.length > 0 &&
      this.unverifiedStrategy === 'keep_relative_position'
    ) {
      const anchoredOriginalTracks = assembleTracks(anchoredOriginalTour.map(idx => sequencable[idx].track));
      const anchoredEval = evaluateSequence(anchoredOriginalTracks, { enableEnergy: this.enableEnergy });
      let finalTotalObj = evaluation.objectiveCost;
      let anchoredTotalObj = anchoredEval.objectiveCost;
      if (this.includePositionPenalty) {
        for (let k = 0; k < finalTracks.length; k++) {
          finalTotalObj += calculateArcPositionPenalty(finalTracks[k], k, finalTracks.length);
          anchoredTotalObj += calculateArcPositionPenalty(anchoredOriginalTracks[k], k, anchoredOriginalTracks.length);
        }
      }
      if (anchoredTotalObj < finalTotalObj - 1e-9) {
        finalTracks = anchoredOriginalTracks;
        evaluation = anchoredEval;
      }
    }

    annotateEnergyResets(evaluation.transitions);
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
