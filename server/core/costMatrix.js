import { evaluateHarmonicTransition } from './camelot.js';

/**
 * Evaluates directed transition cost from trackA to trackB (A -> B).
 * Cost function is DIRECTED: C(A -> B) != C(B -> A)
 * 
 * Total Cost = Harmonic Cost + Tempo Cost + Energy Cost
 */
export function calculateTransitionCost(trackA, trackB, options = {}) {
  const {
    enableEnergy = false,
    maxTempoDropPenalty = true,
    energyDropThreshold = 0.15
  } = options;

  // 1. Harmonic Cost
  const harmEval = evaluateHarmonicTransition(trackA.camelot, trackB.camelot);
  const harmonicCost = harmEval.cost !== null ? harmEval.cost : 4.0; // penalty if unverified harmonic

  // 2. Tempo Cost
  // An unconfirmed octave suggestion is NOT trusted tempo: grade it like
  // unverified data instead of confidently scoring the raw/suggested jump.
  const tempoUnconfirmed = !!(trackA.tempoNeedsReview || trackB.tempoNeedsReview);
  const bpmA = trackA.workingBpm || trackA.bpm;
  const bpmB = trackB.workingBpm || trackB.bpm;

  let tempoCost = 0;
  let tempoDiffPct = 0;
  let bpmChange = 0;

  if (tempoUnconfirmed) {
    tempoCost = 3; // unconfirmed tempo penalty
  } else if (bpmA && bpmB) {
    bpmChange = Math.round((bpmB - bpmA) * 10) / 10;
    tempoDiffPct = Math.abs(bpmB - bpmA) / bpmA * 100;

    if (tempoDiffPct <= 3.0) {
      tempoCost = 0;
    } else if (tempoDiffPct <= 6.0) {
      tempoCost = 1;
    } else if (tempoDiffPct <= 10.0) {
      tempoCost = 3;
    } else {
      tempoCost = 12; // heavy penalty for > 10% tempo jump
    }

    // Directional tempo asymmetry:
    // DJs prefer steady or rising BPM. Sudden late tempo drops are penalized more than gradual rises.
    if (bpmB < bpmA && tempoDiffPct > 4.0 && maxTempoDropPenalty) {
      tempoCost += 1.5;
    }
  } else {
    tempoCost = 3; // unverified tempo penalty
  }

  const hasTempo = !tempoUnconfirmed &&
    typeof trackA.bpm === 'number' && typeof trackB.bpm === 'number' &&
    !isNaN(trackA.bpm) && !isNaN(trackB.bpm);

  // 3. Energy Cost (evaluated ONLY if both tracks provide real energy)
  let energyCost = 0;
  const hasRealEnergy = enableEnergy &&
    typeof trackA.energy === 'number' &&
    typeof trackB.energy === 'number' &&
    !isNaN(trackA.energy) &&
    !isNaN(trackB.energy);

  if (hasRealEnergy) {
    const energyDelta = trackB.energy - trackA.energy;
    if (energyDelta >= -0.05) {
      // Steady or rising energy
      energyCost = 0;
    } else {
      const drop = Math.abs(energyDelta);
      if (drop <= energyDropThreshold) {
        energyCost = 0.5;
      } else {
        // Significant drop penalized unless intentional reset
        energyCost = Math.min(8, 2 + drop * 10);
      }
    }
  }

  const totalCost = Math.round((harmonicCost + tempoCost + energyCost) * 10) / 10;

  // Grade classification:
  // UNVERIFIED: harmonic data missing or invalid (cost null) - never shown as a clash
  // SMOOTH: total cost <= 2.0
  // STRETCH: 3.0 <= total cost <= 5.0
  // CLASH: total cost > 5.0
  let grade;
  if (tempoUnconfirmed || harmEval.cost === null || harmEval.grade === 'UNVERIFIED') {
    grade = 'UNVERIFIED';
  } else {
    grade = 'SMOOTH';
    if (totalCost > 5.0) {
      grade = 'CLASH';
    } else if (totalCost > 2.0) {
      grade = 'STRETCH';
    }
  }

  return {
    fromId: trackA.id,
    toId: trackB.id,
    fromTrack: `${trackA.artist} - ${trackA.title}`,
    toTrack: `${trackB.artist} - ${trackB.title}`,
    harmonicCost,
    tempoCost,
    energyCost,
    totalCost,
    grade,
    bpmChange: hasTempo ? bpmChange : null,
    tempoDiffPct: hasTempo ? Math.round(tempoDiffPct * 10) / 10 : null,
    relation: tempoUnconfirmed ? `${harmEval.relation}; tempo needs review` : harmEval.relation,
    harmEval
  };
}

/**
 * Computes transition costs for an entire sequence of tracks.
 * Returns array of transitions and summary metrics.
 */
export function evaluateSequence(tracks, options = {}) {
  if (!tracks || tracks.length < 2) {
    return {
      transitions: [],
      totalCost: 0,
      averageCost: 0,
      smoothCount: 0,
      stretchCount: 0,
      clashCount: 0,
      unverifiedCount: 0,
      gradedCount: 0,
      smoothPct: null,
      bpmRange: { min: 0, max: 0, delta: 0 },
      keyCoverage: []
    };
  }

  const transitions = [];
  let totalCost = 0;
  let smoothCount = 0;
  let stretchCount = 0;
  let clashCount = 0;
  let gradedCount = 0;
  let unverifiedCount = 0;
  let objectiveCost = 0;

  const bpms = [];
  const keysFound = new Set();

  for (let i = 0; i < tracks.length - 1; i++) {
    const tA = tracks[i];
    const tB = tracks[i + 1];

    if (tA.bpm) bpms.push(tA.bpm);
    if (tA.camelot) keysFound.add(tA.camelot);

    const costObj = calculateTransitionCost(tA, tB, options);
    transitions.push(costObj);

    // Unverified pairs carry synthetic penalty costs for the solver only;
    // never count them as clashes or smooth in user-facing metrics.
    objectiveCost += costObj.totalCost;
    if (costObj.grade === 'UNVERIFIED') {
      unverifiedCount++;
      continue;
    }
    gradedCount++;
    totalCost += costObj.totalCost;

    if (costObj.grade === 'SMOOTH') smoothCount++;
    else if (costObj.grade === 'STRETCH') stretchCount++;
    else clashCount++;
  }

  const lastTrack = tracks[tracks.length - 1];
  if (lastTrack.bpm) bpms.push(lastTrack.bpm);
  if (lastTrack.camelot) keysFound.add(lastTrack.camelot);

  const totalTransitions = transitions.length;
  // smoothPct is computed over graded transitions only; unverified pairs are
  // reported separately, never counted as clashes or smooth.
  const smoothPct = gradedCount > 0 ? Math.round((smoothCount / gradedCount) * 100) : null;
  const minBpm = bpms.length > 0 ? Math.min(...bpms) : 0;
  const maxBpm = bpms.length > 0 ? Math.max(...bpms) : 0;

  return {
    transitions,
    totalCost: Math.round(totalCost * 10) / 10,
    // objectiveCost includes synthetic unverified-tempo/harmonic penalties:
    // this is the quantity the solver minimizes. totalCost is graded-only
    // and can move the other way when ungraded transitions are consolidated.
    objectiveCost: Math.round(objectiveCost * 10) / 10,
    averageCost: gradedCount > 0 ? Math.round((totalCost / gradedCount) * 10) / 10 : null,
    smoothCount,
    stretchCount,
    clashCount,
    unverifiedCount,
    gradedCount,
    smoothPct,
    bpmRange: { min: minBpm, max: maxBpm, delta: Math.round((maxBpm - minBpm) * 10) / 10 },
    keyCoverage: Array.from(keysFound)
  };
}
