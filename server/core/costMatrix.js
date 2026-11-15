import { evaluateHarmonicTransition } from './camelot.js';

/**
 * Evaluates directed transition cost from trackA to trackB (A -> B).
 * Cost function is DIRECTED: C(A -> B) != C(B -> A)
 * 
 * Total Cost = Harmonic Cost + Tempo Cost + Energy Cost
 */
// A recording-identity caution (recordingNeedsReview) blocks tempo/key
// grading only while the values themselves lack two-source confirmation.
// Since 2026-11-14 the pipeline can return verified (client: corroborated)
// WITH the flag - the matched records are different edits, but tempo and key
// agree across sources - so those values are confirmed and transitions grade
// normally; the identity caution stays at row level.
const CROSS_CONFIRMED_STATUSES = new Set(['verified', 'corroborated', 'analysed']);
export function recordingBlocksGrading(track) {
  if (!track || !track.recordingNeedsReview) return false;
  // A recordingMismatch carrying the track's own ISRC means the matched
  // record is proven to be a DIFFERENT recording: the confirmed values are
  // that record's, not this track's, so they block grading even when two
  // providers agreed on them. Without a supplied ISRC, cross-confirmed
  // values are only edition-level cautions and grade normally.
  if (track.recordingMismatch && track.recordingMismatch.suppliedIsrc) return true;
  return !CROSS_CONFIRMED_STATUSES.has(track.status);
}

/**
 * Checks whether a track carries a usable per-section energyCurve array
 * produced by local browser audio analysis.
 */
export function hasValidEnergyCurve(track) {
  return Boolean(
    track &&
    Array.isArray(track.energyCurve) &&
    track.energyCurve.length >= 2 &&
    track.energyCurve.every(pt => pt && typeof pt.energy === 'number' && Number.isFinite(pt.energy))
  );
}

/**
 * Extracts opening-section (intro) energy from track.energyCurve (first ~20%,
 * up to 3 windows), falling back to scalar track.energy when no curve exists.
 */
export function getIntroEnergy(track) {
  if (!hasValidEnergyCurve(track)) {
    return typeof track?.energy === 'number' && Number.isFinite(track.energy) ? track.energy : null;
  }
  const curve = track.energyCurve;
  const windowCount = Math.max(1, Math.min(3, Math.ceil(curve.length * 0.2)));
  let sum = 0;
  for (let i = 0; i < windowCount; i++) {
    sum += curve[i].energy;
  }
  return Math.round((sum / windowCount) * 1000) / 1000;
}

/**
 * Extracts final-section (outro) energy from track.energyCurve (last ~20%,
 * up to 3 windows), falling back to scalar track.energy when no curve exists.
 */
export function getOutroEnergy(track) {
  if (!hasValidEnergyCurve(track)) {
    return typeof track?.energy === 'number' && Number.isFinite(track.energy) ? track.energy : null;
  }
  const curve = track.energyCurve;
  const windowCount = Math.max(1, Math.min(3, Math.ceil(curve.length * 0.2)));
  let sum = 0;
  for (let i = curve.length - windowCount; i < curve.length; i++) {
    sum += curve[i].energy;
  }
  return Math.round((sum / windowCount) * 1000) / 1000;
}

/**
 * Computes transition energy delta (A -> B). When both tracks carry a valid
 * per-section energyCurve, compares outgoing trackA's outro energy against
 * incoming trackB's intro energy. Otherwise falls back to whole-track scalar
 * energy (trackB.energy - trackA.energy).
 */
export function computeTransitionEnergyDelta(trackA, trackB) {
  if (hasValidEnergyCurve(trackA) && hasValidEnergyCurve(trackB)) {
    const outroA = getOutroEnergy(trackA);
    const introB = getIntroEnergy(trackB);
    if (outroA !== null && introB !== null) {
      return introB - outroA;
    }
  }
  if (
    typeof trackA?.energy === 'number' && Number.isFinite(trackA.energy) &&
    typeof trackB?.energy === 'number' && Number.isFinite(trackB.energy)
  ) {
    return trackB.energy - trackA.energy;
  }
  return null;
}

export function calculateTransitionCost(trackA, trackB, options = {}) {
  const {
    enableEnergy = true,
    maxTempoDropPenalty = true,
    energyDropThreshold = 0.15,
    loudnessDeltaThreshold = 3.5,
    blendBeats = 64
  } = options;

  // 1. Harmonic Cost
  const harmEval = evaluateHarmonicTransition(trackA.camelot, trackB.camelot);
  const harmonicCost = harmEval.cost !== null ? harmEval.cost : 4.0; // penalty if unverified harmonic

  // 2. Tempo Cost
  // An unconfirmed octave suggestion is NOT trusted tempo: grade it like
  // unverified data instead of confidently scoring the raw/suggested jump.
  // Same for an unconfirmed recording match: when the matched record is a
  // different recording than supplied (recordingNeedsReview) and the values
  // are not cross-confirmed by two sources, its tempo AND key values are
  // unconfirmed, so the transition is never graded on them.
  const tempoUnconfirmed = !!(trackA.tempoNeedsReview || trackB.tempoNeedsReview);
  const recordingUnconfirmed = recordingBlocksGrading(trackA) || recordingBlocksGrading(trackB);
  const valuesUnconfirmed = tempoUnconfirmed || recordingUnconfirmed;
  const bpmA = trackA.workingBpm || trackA.bpm;
  const bpmB = trackB.workingBpm || trackB.bpm;

  let tempoCost = 0;
  let tempoDiffPct = 0;
  let bpmChange = 0;

  if (valuesUnconfirmed) {
    tempoCost = 3; // unconfirmed tempo/recording penalty
  } else if (bpmA && bpmB) {
    bpmChange = Math.round((bpmB - bpmA) * 10) / 10;
    tempoDiffPct = Math.abs(bpmB - bpmA) / bpmA * 100;

    if (tempoDiffPct <= 0.8) {
      tempoCost = 0;
    } else if (tempoDiffPct <= 1.6) {
      tempoCost = 1;
    } else if (tempoDiffPct <= 3.0) {
      tempoCost = 4;
    } else if (tempoDiffPct <= 5.0) {
      tempoCost = 8;
    } else {
      tempoCost = 16; // heavy penalty for > 5% tempo jump without beatmatch
    }

    // Directional tempo asymmetry:
    // DJs prefer steady or rising BPM. Sudden late tempo drops are penalized more than gradual rises.
    if (bpmB < bpmA && tempoDiffPct > 4.0 && maxTempoDropPenalty) {
      tempoCost += 1.5;
    }
  } else {
    tempoCost = 3; // unverified tempo penalty
  }

  const hasTempo = !valuesUnconfirmed &&
    typeof bpmA === 'number' && typeof bpmB === 'number' &&
    !isNaN(bpmA) && !isNaN(bpmB) && bpmA > 0 && bpmB > 0;
  const validBlendBeats = Number.isFinite(blendBeats) && blendBeats > 0 ? blendBeats : 64;
  const driftFraction = hasTempo ? Math.abs(bpmB - bpmA) / bpmA : null;
  const driftBeats = hasTempo ? Math.round(driftFraction * validBlendBeats * 10) / 10 : null;

  // 3. Energy Cost (evaluated ONLY if both tracks provide real energy or energyCurve)
  let energyCost = 0;
  const energyDelta = enableEnergy ? computeTransitionEnergyDelta(trackA, trackB) : null;
  const hasRealEnergy = typeof energyDelta === 'number' && Number.isFinite(energyDelta);

  if (hasRealEnergy) {
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

  // 4. Loudness Delta Risk (when real loudness dB values are available on both sides)
  const hasRealLoudness = !valuesUnconfirmed &&
    typeof trackA.loudness === 'number' && Number.isFinite(trackA.loudness) &&
    typeof trackB.loudness === 'number' && Number.isFinite(trackB.loudness);
  const loudnessChange = hasRealLoudness
    ? Math.round((trackB.loudness - trackA.loudness) * 10) / 10
    : null;
  const loudnessDiffDb = hasRealLoudness
    ? Math.round(Math.abs(trackB.loudness - trackA.loudness) * 10) / 10
    : null;
  const loudnessRisk = hasRealLoudness && loudnessDiffDb >= loudnessDeltaThreshold;
  const loudnessWarning = loudnessRisk ? 'volume dip risk - trim in Mix' : null;

  const totalCost = Math.round((harmonicCost + tempoCost + energyCost) * 10) / 10;

  const reviewNotes = [
    tempoUnconfirmed && 'tempo needs review',
    recordingUnconfirmed && 'recording needs review'
  ].filter(Boolean);

  // Grade classification:
  // UNVERIFIED: harmonic data missing or invalid (cost null), or either
  // track's tempo/key values are unconfirmed (tempo or recording review) -
  // never shown as a clash
  // SMOOTH: total cost <= 2.0 AND tempoDiffPct <= 2.0 (un-synced renderer tolerates ~<=2% without audible flam)
  // STRETCH: 2.0 < total cost <= 5.0 (or > 2% tempo delta within <= 5 total cost)
  // CLASH: total cost > 5.0
  let grade;
  if (valuesUnconfirmed || harmEval.cost === null || harmEval.grade === 'UNVERIFIED') {
    grade = 'UNVERIFIED';
  } else {
    grade = 'SMOOTH';
    if (totalCost > 5.0) {
      grade = 'CLASH';
    } else if (totalCost > 2.0 || (hasTempo && tempoDiffPct > 2.0)) {
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
    blendBeats: hasTempo ? validBlendBeats : null,
    driftFraction: hasTempo ? Math.round(driftFraction * 10000) / 10000 : null,
    driftBeats,
    loudnessChange,
    loudnessDiffDb,
    loudnessRisk,
    loudnessWarning,
    relation: reviewNotes.length > 0 ? `${harmEval.relation}; ${reviewNotes.join('; ')}` : harmEval.relation,
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
      loudnessRiskCount: 0,
      maxDriftBeats: null,
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
  let loudnessRiskCount = 0;
  let maxDriftBeats = null;
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

    if (costObj.loudnessRisk) loudnessRiskCount++;
    if (typeof costObj.driftBeats === 'number') {
      maxDriftBeats = maxDriftBeats === null ? costObj.driftBeats : Math.max(maxDriftBeats, costObj.driftBeats);
    }

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
    loudnessRiskCount,
    maxDriftBeats,
    smoothPct,
    bpmRange: { min: minBpm, max: maxBpm, delta: Math.round((maxBpm - minBpm) * 10) / 10 },
    keyCoverage: Array.from(keysFound)
  };
}
