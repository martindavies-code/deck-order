/**
 * DJ Energy Arc & Set Structure Modeler
 * 
 * Classic DJ narrative arc:
 * 1. Warm-up / Groove establish (0 - 20%): Lower/moderate tempo, establishes mood.
 * 2. Build-up (20 - 60%): Gradual energy and tempo progression.
 * 3. Peak Zone (60 - 80%): Climax tracks, highest tempo, peak energy.
 * 4. Resolution / Outro (80 - 100%): Powerful closing tracks, cooldown, or single reset.
 */

export function selectWarmUpCandidates(tracks, count = 3) {
  if (!tracks || tracks.length === 0) return [];

  // Filter to tracks with verified BPM
  const valid = tracks.filter(t => t.bpm);
  if (valid.length === 0) return tracks.slice(0, count);

  // Score candidates: lower BPM + lower energy + original track 0 bonus
  const scored = valid.map((t, originalIdx) => {
    let score = (t.bpm || 124);
    if (typeof t.energy === 'number') {
      score += t.energy * 20;
    }
    if (originalIdx === 0) {
      score -= 5; // slight preference for the user's intended opener
    }
    return { track: t, score };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map(s => s.track);
}

/**
 * Calculates arc penalty for track placement relative to playlist progression.
 * Target: tempo/energy builds toward 65-80% of the set.
 */
export function calculateArcPositionPenalty(track, positionIndex, totalTracks) {
  if (totalTracks <= 2 || !track.bpm) return 0;

  const progress = positionIndex / (totalTracks - 1); // 0.0 to 1.0

  // Peak zone target is 0.65 to 0.80
  // Early tracks (progress < 0.25) should not be the absolute highest BPM
  // Late tracks (progress > 0.60) should not be the absolute lowest BPM
  let penalty = 0;

  // Modest biasing penalty so harmonic mixing remains the primary driver
  if (progress < 0.20 && track.bpm > 132) {
    penalty += 0.8;
  }
  if (progress > 0.65 && progress < 0.85 && track.bpm < 124) {
    penalty += 0.8;
  }

  return penalty;
}

/**
 * Detects deliberate energy resets in a sequence (at most one labelled in output)
 */
export function annotateEnergyResets(transitions) {
  if (!transitions || transitions.length === 0) return;

  let maxDropIdx = -1;
  let maxDropAmount = 0;

  transitions.forEach((tr, idx) => {
    tr.isDeliberateReset = false;
    // Check for drop in BPM > 4 BPM or significant energy drop
    if (tr.bpmChange < -4.0) {
      const drop = Math.abs(tr.bpmChange);
      if (drop > maxDropAmount) {
        maxDropAmount = drop;
        maxDropIdx = idx;
      }
    }
  });

  // Label at most one deliberate energy reset if significant drop occurs after the midpoint
  if (maxDropIdx >= Math.floor(transitions.length * 0.45) && maxDropAmount >= 4.0) {
    transitions[maxDropIdx].isDeliberateReset = true;
    transitions[maxDropIdx].resetLabel = 'Deliberate Energy Reset (Set Chapter Change)';
  }
}
