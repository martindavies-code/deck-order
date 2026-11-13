import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSavePreview } from '../client/src/services/api.js';
import { insertSuggestionsIntoOrder } from '../client/src/services/clientSequencer.js';
import { SuggestionEngine, isTrackInSet } from '../server/core/bridgeFinder.js';

// ---- Save preview: tracks-to-add counts (live issue 2026-11-13) ----

test('Save preview: demo set with no Spotify URIs reports 0 to add and flags sample data', async () => {
  const demoTracks = [
    { id: 'a', artist: 'Bicep', title: 'Glue', bpm: 130, camelot: '8A', isSampleData: true },
    { id: 'b', artist: 'Four Tet', title: 'Baby', bpm: 126, camelot: '4A', isSampleData: true }
  ];
  const res = await requestSavePreview({ name: 'Demo Electronic Set', id: null }, demoTracks);
  assert.equal(res.success, true);
  assert.equal(res.manifest.validUrisCount, 0);
  assert.equal(res.manifest.totalTracks, 2);
  assert.equal(res.manifest.skippedCount, 2);
  assert.equal(res.manifest.isSampleData, true);
});

test('Save preview: set loaded from Spotify keeps every track savable', async () => {
  const spotifyTracks = [
    { id: 'x', artist: 'A', title: 'One', uri: 'spotify:track:1111111111111111111111' },
    { id: 'y', artist: 'B', title: 'Two', spotifyUri: 'spotify:track:2222222222222222222222' }
  ];
  const res = await requestSavePreview({ name: 'Real Set', id: 'pl1' }, spotifyTracks);
  assert.equal(res.manifest.validUrisCount, 2);
  assert.equal(res.manifest.skippedCount, 0);
  assert.equal(res.manifest.isSampleData, false);
});

test('Save preview: mixed set counts only Spotify-linked tracks as addable', async () => {
  const mixed = [
    { id: 'x', artist: 'A', title: 'One', uri: 'spotify:track:1111111111111111111111' },
    { id: 's', artist: 'Overmono', title: 'So U Kno', isSuggestedTrack: true },
    { id: 'y', artist: 'B', title: 'Two', uri: 'spotify:track:2222222222222222222222' }
  ];
  const res = await requestSavePreview({ name: 'Mixed', id: 'pl2' }, mixed);
  assert.equal(res.manifest.validUrisCount, 2);
  assert.equal(res.manifest.skippedCount, 1);
  assert.equal(res.manifest.isSampleData, false);
});

// ---- Suggestion insertion placement (live issue 2026-11-13) ----

test('Insert: a bridge lands right after its gap track, not at the start or end', () => {
  const order = [
    { id: 't0', title: 'T0' }, { id: 't1', title: 'T1' }, { id: 't2', title: 'T2' }, { id: 't3', title: 'T3' }
  ];
  const bridges = [{ id: 'b1', title: 'Bridge', insertAfterIndex: 2, selected: true }];
  const out = insertSuggestionsIntoOrder(order, bridges, [], 1000);
  assert.deepEqual(out.map(t => t.title), ['T0', 'T1', 'T2', 'Bridge', 'T3']);
});

test('Insert: several bridges for the same gap keep the order they were shown in', () => {
  const order = [{ id: 't0', title: 'T0' }, { id: 't1', title: 'T1' }];
  const bridges = [
    { id: 'b1', title: 'First', insertAfterIndex: 0, selected: true },
    { id: 'b2', title: 'Second', insertAfterIndex: 0, selected: true }
  ];
  const out = insertSuggestionsIntoOrder(order, bridges, [], 1000);
  assert.deepEqual(out.map(t => t.title), ['T0', 'First', 'Second', 'T1']);
});

test('Insert: bridges without a gap index and bonus tunes append at the end', () => {
  const order = [{ id: 't0', title: 'T0' }];
  const bridges = [{ id: 'b1', title: 'Loose Bridge', selected: true }];
  const bonus = [{ id: 'x1', title: 'Bonus', selected: true }];
  const out = insertSuggestionsIntoOrder(order, bridges, bonus, 1000);
  assert.deepEqual(out.map(t => t.title), ['T0', 'Loose Bridge', 'Bonus']);
});

test('Insert: input list is never mutated', () => {
  const order = [{ id: 't0', title: 'T0' }, { id: 't1', title: 'T1' }];
  const bridges = [{ id: 'b1', title: 'Bridge', insertAfterIndex: 0, selected: true }];
  insertSuggestionsIntoOrder(order, bridges, [], 1000);
  assert.equal(order.length, 2);
});

// ---- Already-in-set exclusion (live issue 2026-11-13) ----

test('Exclusion: exact title+artist match is excluded', () => {
  const set = [{ artist: 'Overmono', title: 'So U Kno' }];
  assert.equal(isTrackInSet(set, { artist: 'Overmono', title: 'So U Kno', isrc: 'GBBKS2100222' }), true);
});

test('Exclusion: same recording via ISRC is excluded even when the title differs', () => {
  const set = [{ artist: 'Overmono', title: 'So U Kno (Extended)', isrc: 'GBBKS2100222' }];
  assert.equal(isTrackInSet(set, { artist: 'Overmono', title: 'So U Kno', isrc: 'GBBKS2100222' }), true);
});

test('Exclusion: same title by a different artist is NOT excluded', () => {
  const set = [{ artist: 'Someone Else', title: 'Baby' }];
  assert.equal(isTrackInSet(set, { artist: 'Four Tet', title: 'Baby', isrc: 'GBBKS2300188' }), false);
});

test('Suggestions: a catalogue track added to the set is not suggested again', async () => {
  // Median-BPM-matching set plus the catalogue track already added.
  const set = [
    { artist: 'A', title: 'One', bpm: 128, camelot: '8A' },
    { artist: 'B', title: 'Two', bpm: 128, camelot: '5A' },
    { artist: 'Bicep', title: 'Apricots', bpm: 128, camelot: '8A', isrc: 'GBBKS2000244' }
  ];
  const engine = new SuggestionEngine(null);
  const bonus = await engine.findBonusTunes(set);
  assert.ok(!bonus.some(s => s.title === 'Apricots'), 'added track must not be re-suggested');
});
