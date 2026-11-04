import test from 'node:test';
import assert from 'node:assert/strict';
import { applyManualOverride, revertManualOverride, replaceTrackById } from '../client/src/utils/manualOverride.js';
import { evaluateCurrentOrder, parseKey } from '../client/src/services/clientSequencer.js';
import { generateCSVExport } from '../client/src/services/formatters.js';

const track = { id: 'fixture-sylvester', title: 'You Make Me Feel (Mighty Real)', artist: 'Sylvester, Michael Gray', version: 'Michael Gray Remix', isrc: 'USC4R1906927', bpm: 62.5, rawBpm: 62.5, workingBpm: 62.5, key: 'F minor', camelot: '4A', tempoNeedsReview: true, tempoSuggestion: { bpm: 125, kind: 'doubled' }, confidence: 'single_source', status: 'single_source', sources: [{ name: 'fixture-provider', bpm: 62.5 }] };
const neighbor = { id: 'fixture-neighbor', bpm: 125, workingBpm: 125, camelot: '4A' };

test('manual exact-case 125 / F-Minor changes working values and grading without reordering', () => {
  const before = structuredClone(track);
  const changed = applyManualOverride(track, { bpm: '125', key: 'F-Minor' });
  assert.equal(changed.bpm, 125);
  assert.equal(changed.workingBpm, 125);
  assert.equal(changed.camelot, '4A');
  assert.equal(changed.tempoNeedsReview, false);
  assert.equal(changed.tempoSuggestion, null);
  assert.equal(changed.rawBpm, 62.5);
  assert.equal(changed.status, 'single_source');
  assert.deepEqual(changed.sources, before.sources);
  assert.deepEqual(track, before);
  const order = replaceTrackById([neighbor, track, { ...neighbor, id: 'last' }], track.id, changed);
  assert.deepEqual(order.map(t => t.id), [neighbor.id, track.id, 'last']);
  assert.equal(evaluateCurrentOrder(order).gradedCount, 2);
  assert.match(generateCSVExport(order, evaluateCurrentOrder(order)), /125,"F-Minor","4A"/);
  assert.deepEqual(revertManualOverride(JSON.parse(JSON.stringify(changed))), track);
});

test('Use suggested changes only tempo, retaining recording review and missing key', () => {
  const missing = { ...track, camelot: null, key: null, recordingNeedsReview: true, recordingMismatch: { matchedIsrc: 'fixture-other' } };
  const changed = applyManualOverride(missing, { bpm: 125 });
  assert.equal(changed.camelot, null);
  assert.equal(changed.key, null);
  assert.equal(changed.recordingNeedsReview, true);
  assert.deepEqual(changed.recordingMismatch, missing.recordingMismatch);
  assert.equal(evaluateCurrentOrder([neighbor, changed]).unverifiedCount, 1);
});

test('repeated edits reset to original source and leave other tracks untouched', () => {
  const first = applyManualOverride(track, { bpm: 125 });
  const second = applyManualOverride(first, { key: 'G major' });
  assert.equal(second.camelot, '9B');
  assert.equal(second.bpm, 125);
  assert.deepEqual(revertManualOverride(second), track);
  assert.equal(replaceTrackById([neighbor, track], track.id, second)[0], neighbor);
});

test('strict manual validation accepts explicit hyphen modes but never guesses ambiguous keys', () => {
  for (const key of ['F-Minor', 'F minor', 'Fm', '4a']) assert.equal(applyManualOverride(track, { key }).camelot, '4A');
  assert.equal(applyManualOverride(track, { key: 'F-Major' }).camelot, '7B');
  for (const key of ['F', 'F mystery', '13A', 'nonsense']) assert.throws(() => applyManualOverride(track, { key }), /Camelot/);
  for (const bpm of ['125garbage', -1, 0, Infinity, 401]) assert.throws(() => applyManualOverride(track, { bpm }), /tempo/);
  assert.throws(() => applyManualOverride(track, { bpm: '', key: '' }), /Enter/);
  assert.equal(applyManualOverride({ id: 'unknown', bpm: null, camelot: null }, { key: '4A' }).bpm, null);
});

test('key-only override keeps unknown tempo unknown in transition metrics', () => {
  const changed = applyManualOverride({ id: 'missing-tempo', bpm: null, key: null, camelot: null }, { key: '4A' });
  assert.equal(changed.bpm, null);
  assert.equal(evaluateCurrentOrder([neighbor, changed]).transitions[0].bpmChange, null);
});
