import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SafePlaylistWriter, generatePlainTextTracklist, generateCSVExport } from '../server/spotify/safeWriter.js';

describe('Safe Playlist Writer & Export Tests', () => {

  const sampleTracks = [
    { id: 't1', uri: 'spotify:track:1111', artist: 'Bicep', title: 'Glue', version: 'Original Mix', bpm: 130, camelot: '8A', key: '8A', status: 'verified', source: 'Manual' },
    { id: 't2', uri: 'spotify:track:2222', artist: 'Four Tet', title: 'Baby', version: 'Original Mix', bpm: 126, camelot: '4A', key: 'F minor', status: 'verified', source: 'Manual' },
    { id: 't3', uri: 'spotify:track:1111', artist: 'Bicep', title: 'Glue', version: 'Original Mix', bpm: 130, camelot: '8A', key: '8A', status: 'verified', source: 'Manual' } // intentional repeat
  ];

  test('Dry run manifest generation creates valid preview without writes', () => {
    const writer = new SafePlaylistWriter(null);
    const manifest = writer.generatePreviewManifest(
      { id: 'src_123', name: 'My House Set', snapshotId: 'snap_abc', itemCount: 3 },
      sampleTracks
    );

    assert.ok(manifest.operationId.startsWith('op_'));
    assert.equal(manifest.targetPlaylist.name, 'My House Set - DJ sequence');
    assert.equal(manifest.isDryRun, true);
    assert.equal(manifest.urisManifest.length, 3);
    assert.equal(manifest.urisManifest[0], 'spotify:track:1111');
    assert.equal(manifest.urisManifest[2], 'spotify:track:1111'); // honors intentional repeat
    assert.match(manifest.previewSummary, /My House Set - DJ sequence/);
  });

  test('Save throws if explicit user confirmation is false', async () => {
    const writer = new SafePlaylistWriter(null);
    const manifest = writer.generatePreviewManifest({ name: 'Set' }, sampleTracks);

    await assert.rejects(
      async () => writer.executeSave(manifest, false),
      /Safety constraint requires explicit user confirmation/
    );
  });

  test('Executes save with mock client in batches of 100 without altering source', async () => {
    const createdPlaylists = [];
    const addedBatches = [];

    const mockClient = {
      request: async (endpoint, options) => {
        if (endpoint === '/me/playlists' && options.method === 'POST') {
          const body = options.body;
          const newId = 'pl_new_999';
          createdPlaylists.push(body);
          return { id: newId, external_urls: { spotify: `https://open.spotify.com/playlist/${newId}` } };
        }
        if (endpoint.startsWith('/playlists/pl_new_999/items') && options.method === 'POST') {
          addedBatches.push(options.body.uris);
          return { snapshot_id: 'snap_new_1' };
        }
        throw new Error(`Unexpected call: ${endpoint}`);
      }
    };

    const writer = new SafePlaylistWriter(mockClient);
    const manifest = writer.generatePreviewManifest({ name: 'Warehouse Rave' }, sampleTracks);

    const result = await writer.executeSave(manifest, true);

    assert.equal(result.success, true);
    assert.equal(result.playlistId, 'pl_new_999');
    assert.equal(result.itemsWritten, 3);
    assert.equal(createdPlaylists.length, 1);
    assert.equal(createdPlaylists[0].public, false);
    assert.equal(addedBatches.length, 1);
    assert.deepEqual(addedBatches[0], ['spotify:track:1111', 'spotify:track:2222', 'spotify:track:1111']);
  });

  test('Plain-text export produces clean Artist - Title list for TuneMyMusic', () => {
    const text = generatePlainTextTracklist(sampleTracks);
    const lines = text.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'Bicep - Glue');
    assert.equal(lines[1], 'Four Tet - Baby');
    assert.equal(lines[2], 'Bicep - Glue');
  });

  test('CSV export generates valid structured headers and quoted fields', () => {
    const csv = generateCSVExport(sampleTracks, {
      transitions: [
        { grade: 'SMOOTH', relation: '8A to 4A' },
        { grade: 'SMOOTH', relation: '4A to 8A' }
      ]
    });

    const lines = csv.split('\n');
    assert.equal(lines.length, 4); // header + 3 rows
    assert.match(lines[0], /Order,Artist,Title,Version,BPM,Key,Camelot/);
    assert.match(lines[1], /"Bicep","Glue","Original Mix",130,"8A","8A"/);
    assert.match(lines[3], /"END"/);
  });
});
