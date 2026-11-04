import { parseKey } from '../../../server/core/camelot.js';

// Manual choices are local working metadata, never provider observations.
export function applyManualOverride(track, values) {
  const sourceTrack = track.manualOverride?.sourceTrack || track;
  const updated = { ...track };
  const fields = { ...track.manualOverride?.fields };
  if (Object.hasOwn(values, 'bpm') && String(values.bpm).trim() !== '') {
    const bpm = Number(values.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) {
      throw new Error('Enter a tempo above 0 and no more than 400 BPM.');
    }
    updated.bpm = bpm;
    updated.workingBpm = bpm;
    updated.tempoNeedsReview = false;
    updated.tempoSuggestion = null;
    updated.isNormalized = false;
    fields.bpm = bpm;
  }
  if (Object.hasOwn(values, 'key') && String(values.key).trim() !== '') {
    const key = String(values.key).trim();
    const parsed = parseKey(key.replace(/^([A-Ga-g][#b]?)\s*[-–]\s*(?=major$|minor$|maj$|min$)/i, '$1 '));
    if (!parsed.camelot) throw new Error('Enter a Camelot code or a key with major/minor, e.g. 4A or F minor.');
    updated.key = key;
    updated.camelot = parsed.camelot;
    fields.key = key;
  }
  if (!Object.keys(fields).length) throw new Error('Enter a tempo or key first.');
  // Do not clear recording identity uncertainty or change provider status/sources.
  updated.manualOverride = { sourceTrack, fields };
  updated.confidence = 'user_override';
  return updated;
}

export function revertManualOverride(track) {
  return track.manualOverride?.sourceTrack || track;
}

export function replaceTrackById(tracks, id, replacement) {
  return tracks.map(track => track.id === id ? replacement : track);
}
