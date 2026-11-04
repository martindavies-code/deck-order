import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  camelotHue,
  camelotBadgeColors,
  trackValueState,
  removeTrackAt,
  restoreTrackAt,
  evidenceBadge,
  transitionDisplay
} from '../client/src/utils/trackBadges.js';

test('camelot hue: 12 positions spaced 30 degrees, adjacent keys adjacent hues', () => {
  assert.equal(camelotHue('1A'), 0);
  assert.equal(camelotHue('2A'), 30);
  assert.equal(camelotHue('12B'), 330);
  assert.equal(camelotHue('8a'), 210); // case-insensitive
});

test('camelot hue: invalid codes return null (no invented colour)', () => {
  assert.equal(camelotHue(null), null);
  assert.equal(camelotHue(''), null);
  assert.equal(camelotHue('13A'), null);
  assert.equal(camelotHue('0B'), null);
  assert.equal(camelotHue('C#m'), null);
  assert.equal(camelotBadgeColors('wibble'), null);
});

test('camelot badge colours: minor dimmer than major at the same hue', () => {
  const a = camelotBadgeColors('8A');
  const b = camelotBadgeColors('8B');
  assert.ok(a.color.includes('210'));
  assert.ok(b.color.includes('210'));
  assert.notEqual(a.color, b.color);
});

test('value state: missing never implied, review flagged, ok plain', () => {
  assert.equal(trackValueState({ bpm: null, camelot: null }, 'bpm'), 'missing');
  assert.equal(trackValueState({ bpm: 123, camelot: '8A' }, 'bpm'), 'ok');
  assert.equal(trackValueState({ bpm: 123, tempoNeedsReview: true }, 'bpm'), 'review');
  assert.equal(trackValueState({ camelot: '8A', recordingNeedsReview: true }, 'camelot'), 'review');
  // review flag must not invent a missing value
  assert.equal(trackValueState({ camelot: null, recordingNeedsReview: true }, 'camelot'), 'missing');
});

test('remove + undo restores the exact original order', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { tracks: updated, removed, index } = removeTrackAt(tracks, 1);
  assert.deepEqual(updated.map(t => t.id), ['a', 'c']);
  assert.equal(removed.id, 'b');
  assert.equal(index, 1);
  // removal does not mutate the source list
  assert.equal(tracks.length, 3);
  const restored = restoreTrackAt(updated, removed, index);
  assert.deepEqual(restored.map(t => t.id), ['a', 'b', 'c']);
});

test('removal survives a later reorder (exclusion preserved)', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const { tracks: afterRemove } = removeTrackAt(tracks, 1); // remove b
  // user then reorders: move d to the front
  const reordered = [afterRemove[2], afterRemove[0], afterRemove[1]];
  assert.deepEqual(reordered.map(t => t.id), ['d', 'a', 'c']);
  assert.ok(!reordered.some(t => t.id === 'b'), 'removed track stays removed after reorder');
});

test('remove out of bounds is a no-op; stale undo clamps safely', () => {
  const tracks = [{ id: 'a' }];
  const noop = removeTrackAt(tracks, 5);
  assert.equal(noop.removed, null);
  assert.equal(noop.tracks, tracks);
  const clamped = restoreTrackAt([], { id: 'z' }, 42);
  assert.deepEqual(clamped.map(t => t.id), ['z']);
});

test('evidence badge: one shared selector for desktop and mobile (regression: mobile dropped single_source)', () => {
  assert.deepEqual(evidenceBadge('single_source'), { label: 'Single source', cls: 'badge-status-single' });
  assert.deepEqual(evidenceBadge('corroborated').label, 'Corroborated');
  assert.deepEqual(evidenceBadge('sample').label, 'Sample');
  assert.deepEqual(evidenceBadge('supplied').label, 'Supplied');
  assert.deepEqual(evidenceBadge('disputed').label, 'Disputed');
  assert.deepEqual(evidenceBadge('unverified').label, 'Missing');
  assert.deepEqual(evidenceBadge('missing').label, 'Missing');
  assert.deepEqual(evidenceBadge(undefined).label, 'Missing');
  assert.deepEqual(evidenceBadge('some_future_status').label, 'Missing', 'unknown statuses honestly render Missing');
});

test('transition display: review-flagged side suppresses confident relation and BPM change', () => {
  const smooth = { grade: 'SMOOTH', relation: '8A to 8A - same key', bpmChange: -3.1 };
  const flagged = { id: 'a', bpm: 121, camelot: '8A', recordingNeedsReview: true };
  const clean = { id: 'b', bpm: 125.4, camelot: '9A' };
  const r1 = transitionDisplay(smooth, flagged, clean);
  assert.equal(r1.text, 'Needs review - unconfirmed tempo/key');
  assert.equal(r1.tone, 'review');
  assert.equal(r1.showBpmChange, false, 'no confident BPM delta next to a review flag');
  const r2 = transitionDisplay(smooth, clean, { ...clean, tempoNeedsReview: true });
  assert.equal(r2.tone, 'review', 'flag on either side triggers review');
  const ok = transitionDisplay(smooth, clean, { id: 'c', bpm: 122, camelot: '10B' });
  assert.equal(ok.text, '8A to 8A - same key');
  assert.equal(ok.tone, 'SMOOTH');
  assert.equal(ok.showBpmChange, true, 'clean transitions keep solver output unchanged');
  const unverified = transitionDisplay({ grade: null, relation: 'Unknown / Unverified harmonic data', bpmChange: null }, clean, { id: 'd', bpm: null, camelot: null });
  assert.equal(unverified.text, 'Unknown / Unverified harmonic data');
  assert.equal(unverified.showBpmChange, false);
});
