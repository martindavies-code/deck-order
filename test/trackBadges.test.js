import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  camelotHue,
  camelotBadgeColors,
  trackValueState,
  removeTrackAt,
  restoreTrackAt
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
