import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../server/index.js';

let server;
let baseUrl;

before(async () => {
  await new Promise(resolve => {
    // Start on test port 3099 to avoid collision
    server = app.listen(3099, () => {
      baseUrl = 'http://localhost:3099/api';
      resolve();
    });
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('Express Proxy & API Endpoints Live Test', () => {

  test('GET /api/status returns eligibility and provider states', async () => {
    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.spotifyEligibility);
    assert.ok(data.providers.manualCsv.isConfigured);
  });

  test('POST /api/pipeline/parse-csv correctly parses tracklist text', async () => {
    const csvContent = 'Bicep,Glue,130,8A\nFour Tet,Baby,126,F minor';
    const res = await fetch(`${baseUrl}/pipeline/parse-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.tracks.length, 2);
    assert.equal(data.tracks[0].camelot, '8A');
    assert.equal(data.tracks[1].camelot, '4A');
  });

  test('POST /api/pipeline/sequence computes DJ running order and annotations', async () => {
    const tracks = [
      { id: '1', artist: 'Bicep', title: 'Glue', bpm: 130, camelot: '8A', status: 'verified' },
      { id: '2', artist: 'Four Tet', title: 'Baby', bpm: 126, camelot: '4A', status: 'verified' },
      { id: '3', artist: 'Overmono', title: 'Good Lies', bpm: 134, camelot: '4A', status: 'verified' }
    ];

    const res = await fetch(`${baseUrl}/pipeline/sequence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks, seed: 42 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.result.orderedTracks.length, 3);
    assert.ok(data.result.evaluation.transitions.length === 2);
  });

  test('POST /api/spotify/save/preview returns dry-run manifest with operation ID', async () => {
    const orderedTracks = [
      { id: '1', uri: 'spotify:track:test1', artist: 'Bicep', title: 'Glue' }
    ];

    const res = await fetch(`${baseUrl}/spotify/save/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePlaylist: { id: 'p1', name: 'Rave Mix', itemCount: 1 },
        orderedTracks
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.manifest.operationId.startsWith('op_'));
    assert.equal(data.manifest.targetPlaylist.name, 'Rave Mix - DJ sequence');
  });

  test('POST /api/export/text returns formatted text for TuneMyMusic', async () => {
    const orderedTracks = [
      { artist: 'Bicep', title: 'Glue' },
      { artist: 'Overmono', title: 'Good Lies' }
    ];

    const res = await fetch(`${baseUrl}/export/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedTracks })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, 'Bicep - Glue\nOvermono - Good Lies');
  });
});
