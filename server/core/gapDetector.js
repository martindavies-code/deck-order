import { getWheelDistance } from './camelot.js';

/**
 * Identifies and ranks harmonic and tempo gaps in a sequence.
 * Every STRETCH or CLASH transition is a candidate gap.
 */
export function detectGaps(evaluation, orderedTracks) {
  if (!evaluation || !evaluation.transitions || evaluation.transitions.length === 0) {
    return [];
  }

  const gaps = [];

  evaluation.transitions.forEach((trans, idx) => {
    if (trans.grade === 'STRETCH' || trans.grade === 'CLASH') {
      const trackA = orderedTracks[idx];
      const trackB = orderedTracks[idx + 1];

      if (!trackA || !trackB) return;

      const bpmA = trackA.bpm || 124;
      const bpmB = trackB.bpm || 124;
      const camA = trackA.camelot;
      const camB = trackB.camelot;

      // Identify ideal bridge criteria
      const minBpm = Math.min(bpmA, bpmB);
      const maxBpm = Math.max(bpmA, bpmB);
      const targetBpm = Math.round(((bpmA + bpmB) / 2) * 10) / 10;

      // Candidate intermediate keys
      const candidateKeys = [];
      if (camA && camB) {
        const numA = parseInt(camA.slice(0, -1), 10);
        const letterA = camA.slice(-1);
        const numB = parseInt(camB.slice(0, -1), 10);
        const letterB = camB.slice(-1);

        // If same mode and step difference == 2, the midpoint key is the exact bridge
        const { stepDiff, directedStep } = getWheelDistance(numA, numB);
        if (letterA === letterB && stepDiff === 2) {
          const midNum = directedStep === 2
            ? (numA === 11 ? 12 : (numA === 12 ? 1 : (numA + 1)))
            : (numA === 2 ? 1 : (numA === 1 ? 12 : (numA - 1)));
          candidateKeys.push(`${midNum}${letterA}`);
        } else {
          // Both endpoint keys work as harmonic bridges if tempo is the primary gap
          candidateKeys.push(camA, camB);
        }
      }

      gaps.push({
        gapIndex: idx,
        trackAIndex: idx,
        trackBIndex: idx + 1,
        trackA: `${trackA.artist} - ${trackA.title}`,
        trackB: `${trackB.artist} - ${trackB.title}`,
        grade: trans.grade,
        totalCost: trans.totalCost,
        bpmChange: trans.bpmChange,
        relation: trans.relation,
        bridgeCriteria: {
          minBpm,
          maxBpm,
          targetBpm,
          candidateKeys: Array.from(new Set(candidateKeys))
        }
      });
    }
  });

  // Sort worst gaps first (highest total cost)
  gaps.sort((a, b) => b.totalCost - a.totalCost);
  return gaps;
}
