import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer } from '../server/core/solver.js';
import { calculateTransitionCost, evaluateSequence } from '../server/core/costMatrix.js';

const missingTrack = (id) => ({
  id, artist: `A_${id}`, title: `T_${id}`,
  bpm: null, camelot: null, key: null, energy: null,
  status: 'missing', confidence: 'unverified'
});

const knownTrack = (id, bpm, camelot) => ({
  id, artist: `A_${id}`, title: `T_${id}`,
  bpm, camelot, key: camelot, energy: null,
  status: 'verified', confidence: 'corroborated'
});

test('Unverified-only playlist: solve returns both orderedTracks and originalTracks in original order', () => {
  const tracks = Array.from({ length: 5 }, (_, i) => missingTrack(`t${i}`));
  const res = new DJSequencer({ unverifiedStrategy: 'keep_relative_position' }).solve(tracks);
  assert.equal(res.orderedTracks.length, 5);
  assert.ok(Array.isArray(res.originalTracks), 'originalTracks must be defined');
  assert.equal(res.originalTracks.length, 5);
  assert.deepEqual(res.orderedTracks.map(t => t.id), tracks.map(t => t.id));
  assert.deepEqual(res.originalTracks.map(t => t.id), tracks.map(t => t.id));
  assert.equal(res.unverifiedCount, 5);
});

test('Unverified transition is graded UNVERIFIED, never CLASH, with null bpmChange', () => {
  const a = missingTrack('a');
  const b = missingTrack('b');
  const t = calculateTransitionCost(a, b);
  assert.equal(t.grade, 'UNVERIFIED');
  assert.equal(t.bpmChange, null);
  assert.equal(t.tempoDiffPct, null);
});

test('evaluateSequence excludes unverified pairs from clash/smooth metrics', () => {
  const tracks = Array.from({ length: 4 }, (_, i) => missingTrack(`t${i}`));
  const ev = evaluateSequence(tracks);
  assert.equal(ev.clashCount, 0);
  assert.equal(ev.smoothCount, 0);
  assert.equal(ev.unverifiedCount, 3);
  assert.equal(ev.gradedCount, 0);
  assert.equal(ev.smoothPct, null);
  assert.equal(ev.averageCost, null);
});

test('Graded transitions still classify and count normally', () => {
  const tracks = [knownTrack('a', 120, '8A'), knownTrack('b', 121, '8A'), knownTrack('c', 122, '9A')];
  const ev = evaluateSequence(tracks);
  assert.equal(ev.unverifiedCount, 0);
  assert.equal(ev.gradedCount, 2);
  assert.equal(ev.clashCount, 0);
  assert.ok(ev.smoothPct > 0);
  assert.equal(ev.transitions[0].bpmChange, 1);
});

test('Mixed set: unverified track keeps position and does not corrupt graded metrics', () => {
  const tracks = [knownTrack('a', 120, '8A'), missingTrack('u'), knownTrack('b', 121, '8A')];
  const res = new DJSequencer({ unverifiedStrategy: 'keep_relative_position' }).solve(tracks);
  assert.equal(res.orderedTracks[1].id, 'u');
  assert.equal(res.evaluation.transitions.length, 2);
  assert.equal(res.evaluation.unverifiedCount, 2);
  assert.equal(res.evaluation.clashCount, 0);
});

test('Missing key alone does not suppress a known tempo delta (grade UNVERIFIED, bpmChange kept)', () => {
  const a = { id: 'a', artist: 'A', title: 'A', bpm: 120, camelot: null, key: null, status: 'partially_verified' };
  const b = { id: 'b', artist: 'B', title: 'B', bpm: 124, camelot: null, key: null, status: 'partially_verified' };
  const t = calculateTransitionCost(a, b);
  assert.equal(t.grade, 'UNVERIFIED');
  assert.equal(t.bpmChange, 4);
});

test('Missing tempo alone does not suppress harmonic grading (grade from key, bpmChange null)', () => {
  const a = { id: 'a', artist: 'A', title: 'A', bpm: null, camelot: '8A', key: 'A minor', status: 'partially_verified' };
  const b = { id: 'b', artist: 'B', title: 'B', bpm: null, camelot: '8A', key: 'A minor', status: 'partially_verified' };
  const t = calculateTransitionCost(a, b);
  assert.notEqual(t.grade, 'UNVERIFIED');
  assert.equal(t.grade, 'STRETCH'); // harmonic 0 + tempo penalty 3
  assert.equal(t.bpmChange, null);
});

test('CSV parser keeps title for two-token "Artist, Title" rows (no tempo/key)', async () => {
  const { parseTracklistCSV } = await import('../server/providers/csvParser.js');
  const rows = parseTracklistCSV('Discotron, September - Nu Disco Mix\nMinistry Of Funk, Lovely Day');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].artist, 'Discotron');
  assert.equal(rows[0].title, 'September - Nu Disco Mix');
  assert.equal(rows[0].bpm, null);
  assert.equal(rows[1].title, 'Lovely Day');
});
