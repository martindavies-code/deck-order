import { test } from 'node:test';
import assert from 'node:assert/strict';

const { evaluateSequence } = await import('../server/core/costMatrix.js');
const { DJSequencer } = await import('../server/core/solver.js');
const { evaluateCurrentOrder, generateCSVExport } = await import('../client/src/services/clientSequencer.js');
const { transitionDisplay } = await import('../client/src/utils/trackBadges.js');

const reviewTrack = (over = {}) => ({
  id: 'r1', artist: 'Claptone, Mylo, Purple Disco Machine', title: 'Drop The Pressure',
  version: 'Purple Disco Machine Remix Edit', isrc: 'GBENL2802692',
  bpm: 123.1, workingBpm: 123.1, key: 'E-Minor', camelot: '9A',
  status: 'single_source', recordingNeedsReview: true,
  recordingMismatch: { suppliedIsrc: 'GBENL2802692', matchedIsrc: 'GBENL2002692' },
  ...over
});
const clean = (id, bpm, camelot) => ({ id, artist: 'A', title: id, bpm, workingBpm: bpm, camelot, status: 'corroborated' });

test('recordingNeedsReview transitions are UNVERIFIED and excluded from graded metrics', () => {
  const tracks = [clean('a', 124, '8A'), reviewTrack(), clean('c', 122, '10B')];
  const ev = evaluateSequence(tracks);
  assert.equal(ev.transitions.length, 2);
  assert.ok(ev.transitions.every(t => t.grade === 'UNVERIFIED'), 'every review-adjacent transition is UNVERIFIED');
  assert.ok(ev.transitions.every(t => t.relation.includes('recording needs review')), 'relation carries the review note');
  assert.ok(ev.transitions.every(t => t.bpmChange === null), 'no confident BPM delta on unconfirmed values');
  assert.equal(ev.unverifiedCount, 2);
  assert.equal(ev.gradedCount, 0);
  assert.equal(ev.smoothPct, null, 'review transitions never inflate smooth percentage');
  assert.equal(ev.clashCount, 0, 'review transitions are never reported as clashes');
});

test('clean transitions still grade normally beside a review track set', () => {
  const tracks = [clean('a', 124, '8A'), clean('b', 123, '8A'), reviewTrack()];
  const ev = evaluateSequence(tracks);
  assert.equal(ev.transitions[0].grade, 'SMOOTH');
  assert.equal(ev.transitions[1].grade, 'UNVERIFIED');
  assert.equal(ev.gradedCount, 1);
  assert.equal(ev.unverifiedCount, 1);
  assert.equal(ev.smoothPct, 100, 'smoothPct is computed over graded transitions only');
});

test('tempo and recording review notes combine in the relation', () => {
  const tracks = [clean('a', 124, '8A'), reviewTrack({ tempoNeedsReview: true })];
  const ev = evaluateSequence(tracks);
  assert.ok(ev.transitions[0].relation.includes('tempo needs review'));
  assert.ok(ev.transitions[0].relation.includes('recording needs review'));
});

test('transitionDisplay, evaluation and CSV export agree for the displayed order', () => {
  // User-kept order differs from what the optimiser would pick; every channel
  // must describe the DISPLAYED order and carry the review state.
  const displayed = [reviewTrack(), clean('b', 123, '8A'), clean('c', 124, '8A')];
  const ev = evaluateCurrentOrder(displayed);
  // UI helper reads the same evaluation + track flags
  const td = transitionDisplay(ev.transitions[0], displayed[0], displayed[1]);
  assert.equal(td.tone, 'review');
  assert.equal(td.text, 'Needs review - unconfirmed tempo/key');
  // Export reflects the same displayed order and review state
  const csv = generateCSVExport(displayed, ev);
  const rows = csv.split('\n');
  assert.ok(rows[1].startsWith('1,"Claptone, Mylo, Purple Disco Machine"'), 'export row 1 is the displayed first track');
  assert.ok(rows[1].includes('"UNVERIFIED"'), 'export grades the review transition UNVERIFIED');
  assert.ok(rows[1].includes('recording needs review'), 'export relation carries the review note');
  assert.ok(rows[2].includes('"SMOOTH"'), 'clean transition in the displayed order still grades');
  assert.ok(!csv.includes('Drop The Pressure"",124'), 'no phantom reordering in export');
});

test('solver result evaluation describes the solved order, never the displayed one', () => {
  // Optimiser reorders this fixture; its evaluation must describe ITS order,
  // while evaluateCurrentOrder grades the user's kept order. Both carry the
  // review state on every boundary touching the review track.
  const input = [clean('b', 121, '8A'), reviewTrack(), clean('d', 126, '10B'), clean('a', 124, '8A')];
  const result = new DJSequencer({ seed: 42 }).solve(input);
  const solvedIds = result.orderedTracks.map(t => t.id);
  assert.equal(result.evaluation.transitions.length, solvedIds.length - 1);
  result.evaluation.transitions.forEach((tr, i) => {
    assert.equal(tr.fromId, solvedIds[i], 'solver evaluation follows the solved order');
    assert.equal(tr.toId, solvedIds[i + 1]);
  });
  const kept = input; // user keeps imported order
  const evKept = evaluateCurrentOrder(kept);
  evKept.transitions.forEach((tr, i) => {
    assert.equal(tr.fromId, kept[i].id, 'displayed-order evaluation follows the displayed order');
    assert.equal(tr.toId, kept[i + 1].id);
  });
  const reviewAdjKept = evKept.transitions.filter((tr, i) => kept[i].recordingNeedsReview || kept[i + 1].recordingNeedsReview);
  assert.ok(reviewAdjKept.length > 0 && reviewAdjKept.every(t => t.grade === 'UNVERIFIED'));
});

test('readiness inputs: mixed set reports graded plus unverified counts', () => {
  // The readiness dock reads gradedCount/unverifiedCount: a set with one
  // review boundary and one clean boundary must report both, driving
  // "Draft order built - N transitions need review before grading."
  const tracks = [clean('a', 124, '8A'), clean('b', 121, '8A'), reviewTrack()];
  const ev = evaluateSequence(tracks);
  assert.equal(ev.gradedCount, 1);
  assert.equal(ev.unverifiedCount, 1);
  const allReview = evaluateSequence([clean('a', 124, '8A'), reviewTrack()]);
  assert.equal(allReview.gradedCount, 0, 'fully unconfirmed set reports no graded transitions');
  assert.equal(allReview.unverifiedCount, 1);
});

// --- Corroborated-but-flagged. Intermediate state: the proven-foreign-ISRC
// blocking tests land after the costMatrix change. Edition-level caution
// (no supplied ISRC) keeps the 2026-11-14 softening.

const corroboratedFlagged = (id, bpm, camelot, over = {}) => ({
  id, artist: 'A', title: id, bpm, workingBpm: bpm, camelot,
  status: 'corroborated', recordingNeedsReview: true,
  recordingMismatch: { suppliedIsrc: 'GBCFB2000044', matchedIsrc: 'GBCFB2000045' },
  ...over
});
const corroboratedEditionFlagged = (id, bpm, camelot, over = {}) => ({
  id, artist: 'A', title: id, bpm, workingBpm: bpm, camelot,
  status: 'corroborated', recordingNeedsReview: true,
  recordingMismatch: { matchedIsrc: null, reason: 'Matched record carries no ISRC; edition-level caution only.' },
  ...over
});




test('corroborated + edition-level flag (no supplied ISRC) still grades normally', () => {
  const tracks = [clean('a', 124, '8A'), corroboratedEditionFlagged('b', 129, '2A'), clean('c', 122, '10B')];
  const ev = evaluateSequence(tracks);
  assert.ok(ev.transitions.every(t => t.grade !== 'UNVERIFIED'), 'edition-level caution does not blank cross-confirmed values');
  assert.equal(ev.unverifiedCount, 0);
  assert.equal(ev.gradedCount, 2);
});

test('server-status verified + recordingNeedsReview also grades (worker vocabulary)', () => {
  const verifiedFlagged = { id: 'v', artist: 'A', title: 'v', bpm: 124, workingBpm: 124, camelot: '8A', status: 'verified', recordingNeedsReview: true };
  const ev = evaluateSequence([clean('a', 124, '8A'), verifiedFlagged]);
  assert.notEqual(ev.transitions[0].grade, 'UNVERIFIED');
});

test('single_source + recordingNeedsReview still blanks the fit (unchanged conservative case)', () => {
  const a = clean('a', 124, '8A');
  const b = reviewTrack();
  const ev = evaluateSequence([a, b]);
  const td = transitionDisplay(ev.transitions[0], a, b);
  assert.equal(td.text, 'Needs review - unconfirmed tempo/key');
});

test('corroborated-flagged track with tempoNeedsReview still blanks the fit', () => {
  const a = clean('a', 124, '8A');
  const b = corroboratedFlagged('b', 124, '8A', { tempoNeedsReview: true });
  const ev = evaluateSequence([a, b]);
  const td = transitionDisplay(ev.transitions[0], a, b);
  assert.equal(td.text, 'Needs review - unconfirmed tempo/key');
});

test('PR20 predicate rollout: corroborated-but-flagged tracks stay usable in badges, issues and follow-ups', async () => {
  const { trackValueState, listIssueIndices, findCompatibleSetTracks } = await import('../client/src/utils/trackBadges.js');
  // Edition-level caution only (no supplied ISRC): cross-confirmed values
  // stay usable. A proven foreign ISRC (suppliedIsrc present) blocks even
  // when corroborated - covered by the suite above (2026-11-15 finding 6a).
  const corroboratedFlagged = {
    ...reviewTrack(),
    status: 'corroborated',
    recordingMismatch: { matchedIsrc: null, reason: 'Matched record carries no ISRC; edition-level caution only.' }
  };
  const blockingFlagged = reviewTrack(); // single_source + flag: still blocks

  // trackValueState: confirmed values render 'ok', not amber 'review'
  assert.equal(trackValueState(corroboratedFlagged, 'bpm'), 'ok');
  assert.equal(trackValueState(corroboratedFlagged, 'camelot'), 'ok');
  assert.equal(trackValueState(blockingFlagged, 'bpm'), 'review');

  // listIssueIndices: a real CLASH adjacent to a corroborated-flagged track is no longer hidden
  const clasher = { id: 'clash', artist: 'A', title: 'Clash', bpm: 128, workingBpm: 128, camelot: '3B', status: 'corroborated' };
  const { calculateTransitionCost } = await import('../server/core/costMatrix.js');
  const tr = calculateTransitionCost(corroboratedFlagged, clasher);
  assert.equal(tr.grade, 'CLASH');
  const issues = listIssueIndices([corroboratedFlagged, clasher], [tr]);
  assert.deepEqual(issues.clashIndices, [0]);
  // ...while a grading-blocking flag still suppresses the transition grade
  const tr2 = calculateTransitionCost(blockingFlagged, clasher);
  const issues2 = listIssueIndices([blockingFlagged, clasher], [tr2]);
  assert.deepEqual(issues2.clashIndices, []);
  assert.deepEqual(issues2.reviewIndices, [0]);

  // findCompatibleSetTracks: corroborated-flagged tracks are eligible follow-ups again
  const follow = { id: 'follow', artist: 'A', title: 'Follow', bpm: 123, workingBpm: 123, camelot: '9A', status: 'corroborated' };
  const matches = findCompatibleSetTracks(corroboratedFlagged, 0, [corroboratedFlagged, follow]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].track.id, 'follow');
  const none = findCompatibleSetTracks(blockingFlagged, 0, [blockingFlagged, follow]);
  assert.equal(none.length, 0);
});
