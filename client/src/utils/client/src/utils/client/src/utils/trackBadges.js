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
