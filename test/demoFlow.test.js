import test from 'node:test';
import assert from 'node:assert/strict';
import { DJSequencer } from '../server/core/solver.js';
import { parseTracklistCSV } from '../server/providers/csvParser.js';
import { evaluateHarmonicTransition } from '../server/core/camelot.js';

test('Browser Runtime Safety: DJSequencer executes without process.memoryUsage', () => {
  // Simulate browser environment where process.memoryUsage is undefined
  const originalMemoryUsage = process.memoryUsage;
  delete process.memoryUsage;

  try {
    const rawDemo = `
Artist,Title,BPM,Key
Bicep,Glue,130,8A
Four Tet,Baby,126,F minor
Overmono,Good Lies,134,4A
Joy Orbison,flight fm,136,8A
    `.trim();

    const tracks = parseTracklistCSV(rawDemo);
    const sequencer = new DJSequencer({ seed: 42 });
    
    // Should NOT throw "process is not defined" or "process.memoryUsage is not a function"
    const result = sequencer.solve(tracks);

    assert.ok(result);
    assert.equal(result.orderedTracks.length, 4);
    assert.ok(result.evaluation);
    assert.equal(result.stats.memoryDeltaBytes, null, 'Memory delta should be null when not in Node');
    assert.ok(typeof result.stats.runtimeMs === 'number');
  } finally {
    process.memoryUsage = originalMemoryUsage;
  }
});

test('Trust Labels & Sample Data: Sample tracks correctly separated from verified data', () => {
  const tracks = [
    { id: '1', artist: 'Artist A', title: 'Track A', bpm: 128, camelot: '8A', status: 'sample', isSampleData: true },
    { id: '2', artist: 'Artist B', title: 'Track B', bpm: 128, camelot: '9A', status: 'supplied' },
    { id: '3', artist: 'Artist C', title: 'Track C', bpm: null, camelot: null, status: 'missing' }
  ];

  const sequencer = new DJSequencer({ unverifiedStrategy: 'keep_relative_position' });
  const result = sequencer.solve(tracks);

  assert.equal(result.orderedTracks.length, 3);
  assert.equal(result.unverifiedCount, 1);
  // Missing track remains at its relative index
  assert.equal(result.orderedTracks[2].id, '3');
});
