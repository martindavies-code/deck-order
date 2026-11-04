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
  if (index < 0 || index >= tracks.length) return { tracks, removed: null, index: -1 };
  const updated = tracks.filter((_, i) => i !== index);
  return { tracks: updated, removed: tracks[index], index };
}

/**
 * Restore a previously removed track at its original index (clamped to the
 * list bounds so a stale undo can never corrupt the order).
 */
export function restoreTrackAt(tracks, track, index) {
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
 * Otherwise the solver's own relation and BPM change pass through unchanged.
 */
export function transitionDisplay(transition, fromTrack, toTrack) {
  const needsReview = !!(fromTrack?.recordingNeedsReview || fromTrack?.tempoNeedsReview
    || toTrack?.recordingNeedsReview || toTrack?.tempoNeedsReview);
  if (needsReview) {
    return { text: 'Needs review - unconfirmed tempo/key', tone: 'review', showBpmChange: false };
  }
  return {
    text: transition?.relation || 'Key match',
    tone: transition?.grade || 'none',
    showBpmChange: typeof transition?.bpmChange === 'number'
  };
}
