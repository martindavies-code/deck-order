import crypto from 'node:crypto';
import { auditLogger } from './auditLogger.js';

/**
 * Spotify Safe Playlist Writer
 * Enforces:
 * - Preview / Dry run verification
 * - Non-destructive writes (creates NEW private playlist, NEVER alters source)
 * - Manifest tracking with unique operation ID
 * - Ordered batches of max 100 URIs
 * - Reconciliation on failure before resuming missing suffix
 * - Redacted audit logging
 */
export class SafePlaylistWriter {
  constructor(spotifyClient) {
    this.client = spotifyClient;
  }

  /**
   * Generates a preview dry-run manifest before any write occurs
   */
  generatePreviewManifest(sourcePlaylist, orderedTracks) {
    const operationId = `op_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const targetName = `${sourcePlaylist.name || 'Custom Playlist'} - DJ sequence`;
    const targetDescription = `Sequenced by Deck Order on ${new Date().toLocaleDateString()} for harmonic mixing.`;

    const uris = orderedTracks
      .map(t => t.uri)
      .filter(uri => Boolean(uri && uri.startsWith('spotify:track:')));

    return {
      operationId,
      sourceSnapshot: {
        id: sourcePlaylist.id || null,
        name: sourcePlaylist.name || 'Manual Source',
        snapshotId: sourcePlaylist.snapshotId || null,
        itemCount: sourcePlaylist.itemCount || orderedTracks.length
      },
      targetPlaylist: {
        name: targetName,
        isPublic: false,
        description: targetDescription
      },
      totalTracks: orderedTracks.length,
      validUrisCount: uris.length,
      urisManifest: uris,
      isDryRun: true,
      previewSummary: `This will create playlist "${targetName}" with ${uris.length} tracks in this order.`
    };
  }

  /**
   * Reconciles already added items against the intended manifest.
   * Compares by exact ordered prefix, honoring track multiplicities.
   * Returns the missing suffix of URIs to resume.
   */
  async reconcileAndFindMissingSuffix(playlistId, expectedUris) {
    auditLogger.log('RECONCILIATION_START', { playlistId, expectedCount: expectedUris.length });
    const currentItems = await this.client.getPlaylistItems(playlistId);
    const existingUris = currentItems.map(item => item.uri);

    // Verify exact prefix match
    let prefixLength = 0;
    while (
      prefixLength < existingUris.length &&
      prefixLength < expectedUris.length &&
      existingUris[prefixLength] === expectedUris[prefixLength]
    ) {
      prefixLength++;
    }

    if (prefixLength !== existingUris.length) {
      auditLogger.log('RECONCILIATION_PREFIX_MISMATCH', {
        playlistId,
        matchedPrefix: prefixLength,
        existingCount: existingUris.length
      });
      throw new Error(`Playlist reconciliation failure: Existing items in playlist ${playlistId} do not match the expected prefix at index ${prefixLength}. Halting to prevent duplicate or corrupted orders.`);
    }

    const missingSuffix = expectedUris.slice(prefixLength);
    auditLogger.log('RECONCILIATION_COMPLETED', {
      playlistId,
      alreadyPresentCount: prefixLength,
      missingSuffixCount: missingSuffix.length
    });

    return {
      alreadyPresentCount: prefixLength,
      missingSuffix
    };
  }

  /**
   * Executes the creation and safe batched item write.
   * Requires explicit user confirmation flag (isConfirmed: true).
   */
  async executeSave(manifest, isConfirmed = false) {
    if (!isConfirmed) {
      throw new Error('Save aborted: Safety constraint requires explicit user confirmation.');
    }

    auditLogger.log('PLAYLIST_SAVE_STARTED', {
      operationId: manifest.operationId,
      sourceSnapshot: manifest.sourceSnapshot,
      targetPlaylist: manifest.targetPlaylist,
      uriCount: manifest.urisManifest.length
    });

    // 1. Create NEW private playlist (POST /me/playlists)
    const createPayload = {
      name: manifest.targetPlaylist.name,
      public: false,
      description: manifest.targetPlaylist.description
    };

    const newPlaylist = await this.client.request('/me/playlists', {
      method: 'POST',
      body: createPayload
    });

    const playlistId = newPlaylist.id;
    const playlistUrl = newPlaylist.external_urls?.spotify;

    auditLogger.log('PLAYLIST_CREATED_SUCCESS', {
      operationId: manifest.operationId,
      newPlaylistId: playlistId,
      spotifyUrl: playlistUrl
    });

    // 2. Batched addition of items: max 100 URIs per request
    const uris = manifest.urisManifest;
    const batchSize = 100;
    let addedCount = 0;

    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(uris.length / batchSize);

      try {
        await this.client.request(`/playlists/${playlistId}/items`, {
          method: 'POST',
          body: { uris: batch }
        });

        addedCount += batch.length;
        auditLogger.log('BATCH_ITEMS_ADDED', {
          operationId: manifest.operationId,
          playlistId,
          batchNumber,
          totalBatches,
          batchSize: batch.length,
          totalAddedSoFar: addedCount
        });
      } catch (err) {
        auditLogger.log('BATCH_WRITE_FAILED_ATTEMPTING_RECONCILIATION', {
          operationId: manifest.operationId,
          playlistId,
          error: err.message,
          failedAtBatch: batchNumber
        });

        // Reconcile before retrying
        const { missingSuffix } = await this.reconcileAndFindMissingSuffix(playlistId, uris);
        if (missingSuffix.length > 0) {
          // Re-attempt remaining missing suffix
          for (let m = 0; m < missingSuffix.length; m += batchSize) {
            const subBatch = missingSuffix.slice(m, m + batchSize);
            await this.client.request(`/playlists/${playlistId}/items`, {
              method: 'POST',
              body: { uris: subBatch }
            });
          }
        }
        break;
      }
    }

    auditLogger.log('PLAYLIST_SAVE_COMPLETE', {
      operationId: manifest.operationId,
      playlistId,
      totalItemsExpected: uris.length,
      spotifyUrl: playlistUrl
    });

    return {
      success: true,
      operationId: manifest.operationId,
      playlistId,
      spotifyUrl: playlistUrl,
      itemsWritten: uris.length,
      playlistName: manifest.targetPlaylist.name
    };
  }
}

/**
 * Text and CSV export formatters (Phase 5.4)
 */
export function generatePlainTextTracklist(orderedTracks) {
  return orderedTracks
    .map(t => `${t.artist} - ${t.title}${t.version && t.version !== 'Original Mix' ? ` (${t.version})` : ''}`)
    .join('\n');
}

export function generateCSVExport(orderedTracks, evaluation) {
  const transitions = evaluation?.transitions || [];
  const headers = ['Order', 'Artist', 'Title', 'Version', 'BPM', 'Key', 'Camelot', 'Energy', 'Source', 'Status', 'Transition Grade', 'Transition Relation'];
  const rows = [headers.join(',')];

  orderedTracks.forEach((t, idx) => {
    const tr = transitions[idx];
    const grade = tr?.grade || (idx === orderedTracks.length - 1 ? 'END' : 'N/A');
    const relation = tr?.relation ? `"${tr.relation.replace(/"/g, '""')}"` : 'N/A';
    const energy = t.energy !== null && t.energy !== undefined ? t.energy : '';

    rows.push([
      idx + 1,
      `"${(t.artist || '').replace(/"/g, '""')}"`,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.version || '').replace(/"/g, '""')}"`,
      t.bpm || '',
      `"${(t.key || '').replace(/"/g, '""')}"`,
      `"${t.camelot || ''}"`,
      energy,
      `"${(t.source || '').replace(/"/g, '""')}"`,
      `"${t.status || ''}"`,
      `"${grade}"`,
      relation
    ].join(','));
  });

  return rows.join('\n');
}
