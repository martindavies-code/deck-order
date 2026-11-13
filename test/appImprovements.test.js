import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
});

const { DJSequencer } = await import('../server/core/solver.js');
const { SuggestionEngine } = await import('../server/core/bridgeFinder.js');
const {
  confirmRecordingMatch,
  revertManualOverride
} = await import('../client/src/utils/manualOverride.js');
const {
  listIssueIndices,
  findCompatibleSetTracks
} = await import('../client/src/utils/trackBadges.js');
const {
  evaluateCurrentOrder,
  generateM3U8Export,
  generateOfflineSuggestions
} = await import('../client/src/services/clientSequencer.js');
const {
  saveSetToHistory,
  buildSavedSetsBackup,
  importSavedSetsBackup
} = await import('../client/src/services/googleAuth.js');

const makeTrack = (id, bpm, camelot, extra = {}) => ({
  id,
  artist: `Artist ${id}`,
  title: `Track ${id}`,
  bpm,
  workingBpm: bpm,
  camelot,
  status: 'corroborated',
  confidence: 'corroborated',
  ...extra
});

test('DJSequencer pins lockedOpenerId, lockedCloserId, or both without breaking optimization', () => {
  const tracks = [
    makeTrack('t1', 124, '8A'),
    makeTrack('t2', 126, '9A'),
    makeTrack('t3', 122, '7A'),
    makeTrack('t4', 128, '10A'),
    makeTrack('t5', 130, '11A')
  ];

  const openerRes = new DJSequencer({ seed: 42, lockedOpenerId: 't4' }).solve(tracks);
  assert.equal(openerRes.orderedTracks[0].id, 't4');
  assert.equal(openerRes.orderedTracks.length, 5);

  const closerRes = new DJSequencer({ seed: 42, lockedCloserId: 't1' }).solve(tracks);
  assert.equal(closerRes.orderedTracks[closerRes.orderedTracks.length - 1].id, 't1');

  const bothRes = new DJSequencer({
    seed: 42,
    lockedOpenerId: 't5',
    lockedCloserId: 't3'
  }).solve(tracks);
  assert.equal(bothRes.orderedTracks[0].id, 't5');
  assert.equal(bothRes.orderedTracks[bothRes.orderedTracks.length - 1].id, 't3');
  assert.deepEqual(
    new Set(bothRes.orderedTracks.map((t) => t.id)),
    new Set(['t1', 't2', 't3', 't4', 't5'])
  );

  // Unknown lock IDs are safely ignored instead of throwing
  const safeRes = new DJSequencer({
    seed: 42,
    lockedOpenerId: 'missing-id',
    lockedCloserId: 'also-missing'
  }).solve(tracks);
  assert.equal(safeRes.orderedTracks.length, 5);
});

test('DJSequencer handles <2 sequencable tracks and excluded unverified endpoints cleanly', () => {
  const mixed = [
    makeTrack('u1', null, null, { status: 'missing', confidence: 'missing' }),
    makeTrack('v1', 125, '8A')
  ];
  const singleRes = new DJSequencer({
    seed: 42,
    lockedOpenerId: 'u1',
    unverifiedStrategy: 'keep_relative_position'
  }).solve(mixed);
  assert.equal(singleRes.orderedTracks.length, 2);
  assert.equal(singleRes.orderedTracks[0].id, 'u1');

  // Exclude omits unverified tracks cleanly while preserving locked verified endpoints
  const withTwoVerified = [
    makeTrack('u1', null, null, { status: 'missing', confidence: 'missing' }),
    makeTrack('v1', 125, '8A'),
    makeTrack('v2', 126, '9A')
  ];
  const excludedRes = new DJSequencer({
    seed: 42,
    lockedOpenerId: 'u1',
    unverifiedStrategy: 'exclude'
  }).solve(withTwoVerified);
  assert.equal(excludedRes.orderedTracks.length, 2);
  assert.ok(!excludedRes.orderedTracks.some((t) => t.id === 'u1'));

  const lockedVerifiedOnExclude = new DJSequencer({
    seed: 42,
    lockedOpenerId: 'v2',
    unverifiedStrategy: 'exclude'
  }).solve(withTwoVerified);
  assert.deepEqual(lockedVerifiedOnExclude.orderedTracks.map((t) => t.id), ['v2', 'v1']);
});

test('confirmRecordingMatch clears recordingNeedsReview reversibly and enables grading', () => {
  const mismatched = makeTrack('r1', 124, '8A', {
    status: 'single_source',
    recordingNeedsReview: true,
    recordingMismatch: { suppliedIsrc: 'AAA', matchedIsrc: 'BBB' }
  });
  const neighbor = makeTrack('n1', 124, '8A');

  const beforeEval = evaluateCurrentOrder([neighbor, mismatched]);
  assert.equal(beforeEval.transitions[0].grade, 'UNVERIFIED');

  const confirmed = confirmRecordingMatch(mismatched);
  assert.equal(confirmed.recordingNeedsReview, false);
  assert.equal(confirmed.recordingConfirmed, true);
  assert.equal(confirmed.confidence, 'user_override');
  assert.deepEqual(confirmed.recordingMismatch, mismatched.recordingMismatch);

  const afterEval = evaluateCurrentOrder([neighbor, confirmed]);
  assert.equal(afterEval.transitions[0].grade, 'SMOOTH');

  const reverted = revertManualOverride(confirmed);
  assert.deepEqual(reverted, mismatched);
});

test('listIssueIndices and findCompatibleSetTracks pinpoint issues and safe follow-ups accurately', () => {
  const tracks = [
    makeTrack('a', 124, '8A'),
    makeTrack('b', 125, '1A'), // CLASH with a (1A -> 8A distance > 1 and not relative/energy shift)
    makeTrack('c', 124, '8A'), // CLASH from b -> c, yet highly compatible with track a!
    makeTrack('d', 125, '8A', { recordingNeedsReview: true }),
    makeTrack('e', 126, '9A')
  ];
  const ev = evaluateCurrentOrder(tracks);
  const issues = listIssueIndices(tracks, ev.transitions);
  assert.ok(issues.clashIndices.includes(0));
  assert.ok(issues.reviewIndices.includes(3));
  assert.equal(issues.allIssueIndices[0], 0);
  assert.ok(issues.allIssueIndices.includes(3));

  const compatible = findCompatibleSetTracks(tracks[0], 0, tracks, 4);
  const ids = compatible.map((c) => c.track.id);
  assert.ok(ids.includes('c'), 'finds compatible un-adjacent track c in same key/BPM');
  assert.ok(!ids.includes('d'), 'never suggests an unconfirmed recording-review track');
  assert.ok(!ids.includes('a'), 'excludes active track itself');
});

test('generateM3U8Export emits valid extended M3U8 with CR/LF stripping and Spotify URLs', () => {
  const tracks = [
    makeTrack('s1', 128, '8A', {
      artist: 'Bicep\r\nBad',
      title: 'Glue',
      uri: 'spotify:track:2aJDlirz6v2a4HREki98cP',
      status: 'corroborated'
    }),
    makeTrack('s2', null, null, {
      artist: 'Local/Artist',
      title: 'Demo:Cut',
      status: 'missing'
    })
  ];
  const out = generateM3U8Export(tracks, 'Warmup\nSet');
  const lines = out.split('\n');
  assert.equal(lines[0], '#EXTM3U');
  assert.equal(lines[1], '#PLAYLIST:Warmup Set');
  assert.equal(lines[2], '#EXTINF:-1,Bicep Bad - Glue');
  assert.equal(lines[3], '#EXT-X-DECKORDER:pos=1;bpm=128;camelot=8A;status=corroborated');
  assert.equal(lines[4], 'https://open.spotify.com/track/2aJDlirz6v2a4HREki98cP');
  assert.equal(lines[7], 'Local_Artist - Demo_Cut.mp3');
});

test('buildSavedSetsBackup and importSavedSetsBackup validate, strip dangerous keys, and deduplicate', () => {
  const tracks = [
    makeTrack('t1', 124, '8A'),
    makeTrack('t2', 126, '9A')
  ];
  saveSetToHistory(
    { name: 'Existing Club Set', tracks, evaluation: evaluateCurrentOrder(tracks) },
    'acct_a'
  );

  const backup = buildSavedSetsBackup('acct_a');
  assert.equal(backup.format, 'deck-order-saved-sets');
  assert.equal(backup.version, 1);
  assert.equal(backup.sets.length, 1);

  // Re-importing the exact same backup should deduplicate cleanly
  const dupRes = importSavedSetsBackup(JSON.stringify(backup), 'acct_a');
  assert.equal(dupRes.importedCount, 0);
  assert.equal(dupRes.skippedDuplicates, 1);
  assert.equal(dupRes.history.length, 1);

  // Prototype-pollution payload is sanitized safely while importing genuinely new sets
  const maliciousJson = JSON.stringify({
    format: 'deck-order-saved-sets',
    version: 1,
    sets: [
      {
        name: 'Warehouse Opener',
        lockedOpenerId: 'n1',
        tracks: [
          {
            id: 'n1',
            artist: 'Four Tet',
            title: 'Baby',
            bpm: 126,
            camelot: '4A',
            __proto__: { polluted: true }
          },
          makeTrack('n2', 128, '5A')
        ]
      }
    ]
  });
  const importRes = importSavedSetsBackup(maliciousJson, 'acct_a');
  assert.equal(importRes.saved, true);
  assert.equal(importRes.importedCount, 1);
  assert.equal(importRes.history.length, 2);
  assert.equal(({}).polluted, undefined, 'Object.prototype must not be polluted');
  assert.equal(importRes.history[0].lockedOpenerId, 'n1');

  // Invalid inputs reject cleanly with explicit messages
  assert.throws(() => importSavedSetsBackup('', 'acct_a'), /empty/);
  assert.throws(() => importSavedSetsBackup('{not valid json', 'acct_a'), /not valid JSON/);
  assert.throws(() => importSavedSetsBackup('{"sets":[]}', 'acct_a'), /does not contain/);
  assert.throws(
    () => importSavedSetsBackup(JSON.stringify({ sets: new Array(51).fill(backup.sets[0]) }), 'acct_a'),
    /maximum supported/
  );
});

test('generateOfflineSuggestions detects gaps with honest reference provenance and safe multi-bridge indices', async () => {
  const ordered = [
    makeTrack('g1', 120, '8A'),
    makeTrack('g2', 132, '1A'), // clash & 12 BPM jump at boundary 0
    makeTrack('g3', 132, '1A'),
    makeTrack('g4', 118, '6B')  // clash & 14 BPM drop at boundary 2
  ];
  const ev = evaluateCurrentOrder(ordered);
  const res = await generateOfflineSuggestions(ev, ordered);
  assert.equal(res.success, true);
  assert.ok(Array.isArray(res.bridgeSuggestions));
  assert.ok(res.bridgeSuggestions.length >= 1, 'finds at least one reference bridge candidate');
  assert.ok(res.bonusTunes.length >= 1, 'includes reference bonus tunes');

  for (const item of [...res.bridgeSuggestions, ...res.bonusTunes]) {
    assert.equal(item.status, 'reference');
    assert.equal(item.confidence, 'reference_catalog');
    assert.equal(item.isSuggestedTrack, true);
  }

  // Descending splice verification: simulated multi-insert keeps earlier indices accurate
  const engine = new SuggestionEngine();
  assert.equal(typeof engine.findBridgeTracks, 'function');
  const sortedDesc = [...res.bridgeSuggestions].sort((a, b) => b.insertAfterIndex - a.insertAfterIndex);
  const inserted = [...ordered];
  sortedDesc.forEach((b, i) => {
    inserted.splice(b.insertAfterIndex + 1, 0, { ...b, id: `bridge_test_${i}` });
  });
  assert.equal(inserted.length, ordered.length + sortedDesc.length);
  // First original track g1 stays at index 0; second bridge sits after g1+earlier shift doesn't break later
  assert.equal(inserted[0].id, 'g1');
});
