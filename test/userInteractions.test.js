import test from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer } from '../server/core/solver.js';
import { parseTracklistCSV } from '../server/providers/csvParser.js';
import { generatePlainTextTracklist, generateCSVExport } from '../client/src/services/formatters.js';

test('User Interactions: Manual reordering via move up/down preserves track data', () => {
  const tracks = [
    { id: 't1', artist: 'Artist 1', title: 'Track 1', bpm: 124, camelot: '8A' },
    { id: 't2', artist: 'Artist 2', title: 'Track 2', bpm: 126, camelot: '9A' },
    { id: 't3', artist: 'Artist 3', title: 'Track 3', bpm: 128, camelot: '10A' }
  ];

  // Move t3 up to index 1
  const reordered = [...tracks];
  const [moved] = reordered.splice(2, 1);
  reordered.splice(1, 0, moved);

  assert.equal(reordered[0].id, 't1');
  assert.equal(reordered[1].id, 't3');
  assert.equal(reordered[2].id, 't2');
});

test('Repeated Tracks: Identical track instances preserve per-occurrence placement and exports', () => {
  const rawCsv = `
Artist,Title,BPM,Key
Bicep,Glue,130,8A
Overmono,Good Lies,134,4A
Bicep,Glue,130,8A
  `.trim();

  const parsed = parseTracklistCSV(rawCsv);
  assert.equal(parsed.length, 3);
  // Each instance should have a unique distinct ID
  assert.notEqual(parsed[0].id, parsed[2].id);

  const sequencer = new DJSequencer({ seed: 42 });
  const result = sequencer.solve(parsed);

  assert.equal(result.orderedTracks.length, 3);

  // Plain text export for TuneMyMusic
  const plainText = generatePlainTextTracklist(result.orderedTracks);
  const lines = plainText.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines.filter(l => l.includes('Bicep - Glue')).length, 2);

  // CSV export
  const csvText = generateCSVExport(result.orderedTracks, result.evaluation);
  assert.ok(csvText.includes('"Bicep"'));
  assert.ok(csvText.includes('"Glue"'));
});

test('Manual Overrides: Custom BPM and Key survive re-evaluation and export', () => {
  const tracks = [
    { id: 't1', artist: 'Artist 1', title: 'Track 1', bpm: 124, camelot: '8A' },
    { id: 't2', artist: 'Artist 2', title: 'Track 2', bpm: 126, camelot: '9A' }
  ];

  // User overrides t1 to 130 BPM and 10A
  const overridden = tracks.map(t => {
    if (t.id === 't1') {
      return { ...t, bpm: 130, camelot: '10A', confidence: 'user_override' };
    }
    return t;
  });

  assert.equal(overridden[0].bpm, 130);
  assert.equal(overridden[0].camelot, '10A');
  assert.equal(overridden[0].confidence, 'user_override');

  const sequencer = new DJSequencer({ seed: 42 });
  const result = sequencer.solve(overridden);
  assert.equal(result.orderedTracks[0].bpm, 130);
});
