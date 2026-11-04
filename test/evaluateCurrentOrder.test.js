import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer } from '../server/core/solver.js';
import { evaluateCurrentOrder } from '../client/src/services/clientSequencer.js';

// The handlers for manual reorder, track removal and undo keep the user's
// displayed order and must grade THAT order. DJSequencer.solve() evaluates
// its own re-optimised order - taking result.evaluation from a solve run
// graded a sequence that was never on screen (the release-blocking bug this
// pins). evaluateCurrentOrder is the exact function those handlers call.

const t = (id, bpm, camelot) => ({ id, title: id, artist: 'X', bpm, camelot, status: 'single_source' });

test('evaluation grades the displayed order, not the optimiser order', () => {
  const manual = [t('B', 121, '9A'), t('A', 120, '8A'), t('C', 122, '8A'), t('D', 124, '10B')];

  // Fixture sanity: the optimiser genuinely reorders this input.
  const solved = new DJSequencer({ seed: 42 }).solve(manual);
  assert.notDeepEqual(
    solved.orderedTracks.map(x => x.id),
    manual.map(x => x.id),
    'fixture must be one where the optimiser order differs from the displayed order'
  );
  // ...and its evaluation grades that other order (the old buggy source).
  assert.equal(solved.evaluation.transitions[0].relation, '8A to 8A - same key');

  // The handler path grades the displayed order, pair by pair.
  const ev = evaluateCurrentOrder(manual);
  assert.equal(ev.transitions.length, manual.length - 1);
  assert.equal(ev.transitions[0].relation, '9A to 8A - one step down');
  assert.equal(ev.transitions[1].relation, '8A to 8A - same key');
  assert.equal(ev.transitions[2].relation, '8A to 10B - harmonic clash (2 steps + mode change)');

  // No reorder, no mutation of the user's list.
  assert.deepEqual(manual.map(x => x.id), ['B', 'A', 'C', 'D']);
});

test('post-removal surviving order is graded at its new length', () => {
  const surviving = [t('C', 122, '8A'), t('D', 124, '10B'), t('B', 121, '9A')];
  const ev = evaluateCurrentOrder(surviving);
  assert.equal(ev.transitions.length, 2, 'transitions match the surviving order length');
  assert.equal(ev.transitions[0].relation, '8A to 10B - harmonic clash (2 steps + mode change)');
  assert.equal(ev.transitions[1].relation, '10B to 9A - diagonal transition (+/-1 and mode change)');
  assert.deepEqual(surviving.map(x => x.id), ['C', 'D', 'B']);
});

test('empty and single-track orders grade honestly', () => {
  assert.equal(evaluateCurrentOrder([]).transitions.length, 0);
  assert.equal(evaluateCurrentOrder([t('A', 120, '8A')]).transitions.length, 0);
});
