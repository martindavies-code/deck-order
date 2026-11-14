import { calculateTransitionCost } from '../../../server/core/costMatrix.js';

/**
 * Per-track data badges (colour-coded Camelot + BPM) and working-set
 * removal helpers. Pure functions so the test suite can pin them without a
 * DOM; SequencedTable and App wire them into the UI.
 */

/**
 * Hue for a Camelot code: 24 keys spaced around the wheel, so adjacent keys
 * get adjacent hues (1A red -> 12A/B back around). null for unknown codes.
 */
export function camelotHue(camelot) {
  const m = /^(\d{1,2})\s*([AB])$/i.exec((camelot || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 12) return null;
  return (n - 1) * 30;
}

/**
 * Inline style for a colour-coded Camelot badge. Minor (A) keys render
 * slightly dimmer than major (B) at the same hue, mirroring the wheel.
 */
export function camelotBadgeColors(camelot) {
  const hue = camelotHue(camelot);
  if (hue === null) return null;
  const minor = /([AB])$/i.exec((camelot || '').trim())[1].toUpperCase() === 'A';
  const lightness = minor ? 68 : 76;
  return {
    backgroundColor: `hsl(${hue} 45% 13%)`,
    borderColor: `hsl(${hue} 60% 40%)`,
    color: `hsl(${hue} 85% ${lightness}%)`
  };
}

/**
 * Honesty state for one track's tempo/key values:
 * - 'missing': no usable value - never imply one.
 * - 'review': value present but flagged (octave suggestion or recording
 *   mismatch) - shown amber until the user confirms it.
 * - 'ok': present and unflagged.
 */
export function trackValueState(track, field) {
  const value = field === 'bpm' ? track?.bpm : track?.camelot;
  if (value === null || value === undefined || value === '') return 'missing';
  if (track?.tempoNeedsReview || track?.recordingNeedsReview) return 'review';
  return 'ok';
}

/**
 * Remove the track at index from the working set. Returns the updated list
 * and the removed entry with its position so an undo can restore it exactly.
 * Pure: the caller owns state. Removal from the working set never touches the
 * source playlist (Spotify) - that list is client-side only.
 */
export function removeTrackAt(tracks, index) {
  if (!Array.isArray(tracks) || index < 0 || index >= tracks.length) {
    return { tracks: Array.isArray(tracks) ? tracks : [], removed: null, index: -1 };
  }
  const updated = tracks.filter((_, i) => i !== index);
  return { tracks: updated, removed: tracks[index], index };
}

/**
 * Restore a previously removed track at its original index (clamped to the
 * list bounds so a stale undo can never corrupt the order).
 */
export function restoreTrackAt(tracks, track, index) {
  if (!Array.isArray(tracks)) return track ? [track] : [];
  if (!track) return [...tracks];
  const updated = [...tracks];
  updated.splice(Math.max(0, Math.min(index, updated.length)), 0, track);
  return updated;
}

/**
 * Single source of truth for the evidence-status badge (label + class) so the
 * desktop table and the mobile card strip can never drift apart. Unknown or
 * absent statuses honestly render as Missing.
 */
const EVIDENCE_BADGES = {
  sample: { label: 'Sample', cls: 'badge-status-sample' },
  corroborated: { label: 'Corroborated', cls: 'badge-status-corroborated' },
  single_source: { label: 'Single source', cls: 'badge-status-single' },
  reference: { label: 'Reference', cls: 'badge-status-single' },
  supplied: { label: 'Supplied', cls: 'badge-status-supplied' },
  disputed: { label: 'Disputed', cls: 'badge-status-disputed' },
  missing: { label: 'Missing', cls: 'badge-status-missing' },
  unverified: { label: 'Missing', cls: 'badge-status-missing' }
};

export function evidenceBadge(status) {
  return EVIDENCE_BADGES[status] || EVIDENCE_BADGES.missing;
}

/**
 * Honest transition display. A confident relation ("8A to 8A - same key")
 * must never be shown when either side's tempo/key is flagged for review
 * (recording mismatch or tempo doubt) - the grading input is unconfirmed.
 * Otherwise key and tempo colours use their own costs, not the overall grade.
 */
export function transitionDisplay(transition, fromTrack, toTrack) {
  const needsReview = !!(fromTrack?.recordingNeedsReview || fromTrack?.tempoNeedsReview
    || toTrack?.recordingNeedsReview || toTrack?.tempoNeedsReview);
  if (needsReview) {
    return {
      text: 'Needs review - unconfirmed tempo/key',
      tone: 'review',
      tempoTone: 'review',
      showBpmChange: false,
      driftBeats: null,
      driftLabel: null,
      isEnergyBoost: false,
      energyBoostLabel: null,
      loudnessRisk: false,
      loudnessWarning: null,
      loudnessChange: null
    };
  }
  const isUnverified = !transition || transition.grade === 'UNVERIFIED' || transition.harmEval?.grade === 'UNVERIFIED' || !transition.grade;
  const showBpmChange = typeof transition?.bpmChange === 'number' && Number.isFinite(transition.bpmChange);
  const driftBeats = !isUnverified && showBpmChange && typeof transition?.driftBeats === 'number' && Number.isFinite(transition.driftBeats)
    ? transition.driftBeats
    : null;
  const driftLabel = driftBeats !== null
    ? (driftBeats === 0 ? '0 beats drift / 16b' : `~${driftBeats} beats drift / 16b`)
    : null;
  const isEnergyBoost = !isUnverified && transition?.harmEval?.directedStep === 2;
  const loudnessRisk = !isUnverified && Boolean(transition?.loudnessRisk);
  return {
    text: transition?.relation || 'Key match',
    // The relation describes keys, so never colour it from the combined grade.
    tone: transition?.harmEval?.grade || 'none',
    // Use the existing tempo cost, including its directional-drop penalty.
    // Suppress tempo colour on unverified transitions so missing-key rows never show a green tempo badge.
    tempoTone: !isUnverified && showBpmChange && Number.isFinite(transition?.tempoCost)
      ? (transition.tempoCost > 5 ? 'CLASH' : transition.tempoCost > 2 ? 'STRETCH' : 'SMOOTH')
      : 'none',
    showBpmChange,
    driftBeats,
    driftLabel,
    isEnergyBoost,
    energyBoostLabel: isEnergyBoost ? 'Energy boost' : null,
    loudnessRisk,
    loudnessWarning: loudnessRisk ? (transition.loudnessWarning || 'volume dip risk - trim in Mix') : null,
    loudnessChange: !isUnverified && typeof transition?.loudnessChange === 'number' && Number.isFinite(transition.loudnessChange)
      ? transition.loudnessChange
      : null
  };
}

/** Shared by desktop connectors and mobile previews. */
export function transitionToneClass(tone) {
  return tone === 'review' ? 'text-[#F59E0B] font-semibold' :
    tone === 'SMOOTH' ? 'text-[#86EFAC] font-semibold' :
    tone === 'STRETCH' ? 'text-[#FDE047]' :
    tone === 'CLASH' ? 'text-[#FCA5A5]' : 'text-[#BAC2B3]';
}

/**
 * Summarizes problem locations in the current running order so DJs can step
 * directly between Clash, Stretch, and Needs-review tracks in large sets.
 */
export function listIssueIndices(tracks, transitions) {
  const list = Array.isArray(tracks) ? tracks : [];
  const trans = Array.isArray(transitions) ? transitions : [];
  const clashIndices = [];
  const stretchIndices = [];
  const reviewIndices = [];
  const issueSet = new Set();

  list.forEach((track, idx) => {
    const tr = idx < list.length - 1 ? trans[idx] : null;
    const nextTrack = idx < list.length - 1 ? list[idx + 1] : null;
    const trackReview = Boolean(track?.recordingNeedsReview || track?.tempoNeedsReview);
    const pairReview = Boolean(trackReview || nextTrack?.recordingNeedsReview || nextTrack?.tempoNeedsReview);

    if (trackReview) {
      reviewIndices.push(idx);
      issueSet.add(idx);
    }
    if (tr && !pairReview) {
      if (tr.grade === 'CLASH') {
        clashIndices.push(idx);
        issueSet.add(idx);
      } else if (tr.grade === 'STRETCH') {
        stretchIndices.push(idx);
        issueSet.add(idx);
      }
    }
  });

  return {
    clashIndices,
    stretchIndices,
    reviewIndices,
    allIssueIndices: [...issueSet].sort((a, b) => a - b)
  };
}

/**
 * Finds other tracks in the loaded set that mix smoothly out of `activeTrack`.
 * Never alters values; skips unconfirmed review tracks or missing BPM/Camelot.
 */
export function findCompatibleSetTracks(activeTrack, activeIndex, tracks, limit = 4) {
  if (!activeTrack || !activeTrack.bpm || !activeTrack.camelot || activeTrack.recordingNeedsReview || activeTrack.tempoNeedsReview) {
    return [];
  }
  if (!Array.isArray(tracks) || tracks.length < 2) return [];

  const matches = [];
  tracks.forEach((cand, idx) => {
    if (idx === activeIndex || !cand) return;
    if (!cand.bpm || !cand.camelot || cand.recordingNeedsReview || cand.tempoNeedsReview) return;
    const res = calculateTransitionCost(activeTrack, cand);
    if (res.grade === 'SMOOTH' || res.totalCost <= 4.5) {
      matches.push({
        track: cand,
        index: idx,
        grade: res.grade,
        relation: res.relation,
        bpmChange: res.bpmChange,
        totalCost: res.totalCost
      });
    }
  });

  matches.sort((a, b) => a.totalCost - b.totalCost);
  return matches.slice(0, limit);
}
