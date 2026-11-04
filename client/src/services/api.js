/**
 * API client with seamless in-browser fallback for static GitHub Pages hosting.
 * When hosted on GitHub Pages or offline, executes pure mathematical algorithms
 * (Camelot mapping, 2-opt solver, CSV parsing, export) directly in the client,
 * and interacts directly with Spotify Web API and Google Identity Services.
 */

import {
  parseTracklistCSV,
  DJSequencer,
  generatePlainTextTracklist,
  generateCSVExport
} from './clientSequencer.js';

const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');
const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/+$/, '');

export const SPOTIFY_403_MSG =
  "Spotify refused this request. If this app is in Development Mode, only accounts on its allowlist can use it - paste or upload a tracklist instead.";

/**
 * Direct Spotify Web API helper for static mode.
 * Handles 401 (session expired) and 403 (honest allowlist explanation).
 */
async function spotifyApiFetch(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  });

  if (res.status === 401) {
    const err = new Error('Spotify session expired (401).');
    err.status = 401;
    throw err;
  }

  if (res.status === 403) {
    const err = new Error(SPOTIFY_403_MSG);
    err.status = 403;
    throw err;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error?.message || `Spotify HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return await res.json();
}

export async function fetchStatus() {
  const spotifyClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || null;
  const isSpotifyConfigured = Boolean(spotifyClientId);

  if (isGitHubPages) {
    return {
      success: true,
      spotifyEligibility: {
        isConfigured: isSpotifyConfigured,
        clientIdProvided: isSpotifyConfigured,
        clientId: spotifyClientId,
        mode: 'Static Web Mode (GitHub Pages)',
        quotaNote: 'Running 100% client-side in browser with PKCE authorization.',
        mixFeatureNote: 'Spotify Mix audio transitions require Spotify Premium.'
      },
      providers: {
        getSongBPM: { isConfigured: false, name: 'GetSongBPM (Requires Local Proxy)' },
        sonovault: { isConfigured: false, name: 'Sonovault (Requires Local Proxy)' },
        soundNet: { isConfigured: false, name: 'SoundNet' },
        manualCsv: { isConfigured: true, name: 'Manual CSV / Tracklist', status: 'Active (In-Browser Engine)' }
      },
      isStaticMode: true
    };
  }

  try {
    const res = await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      ...data,
      spotifyEligibility: {
        ...data.spotifyEligibility,
        isConfigured: isSpotifyConfigured || data.spotifyEligibility?.isConfigured,
        clientIdProvided: isSpotifyConfigured || data.spotifyEligibility?.clientIdProvided,
        clientId: spotifyClientId || data.spotifyEligibility?.clientId
      }
    };
  } catch {
    return {
      success: true,
      spotifyEligibility: {
        isConfigured: isSpotifyConfigured,
        clientIdProvided: isSpotifyConfigured,
        clientId: spotifyClientId,
        mode: 'In-Browser Mode (Proxy Offline)',
        quotaNote: 'Running in browser. Start local server with `npm start` for Spotify proxy.',
        mixFeatureNote: 'Spotify Mix audio transitions require Spotify Premium.'
      },
      providers: {
        manualCsv: { isConfigured: true, name: 'Manual CSV / Tracklist', status: 'Active' }
      },
      isStaticMode: true
    };
  }
}

export async function exchangeAuthCode(code, codeVerifier, redirectUri) {
  // Try proxy first if not on GitHub Pages
  if (!isGitHubPages) {
    try {
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return await res.json();
    } catch {
      // Fall through to direct browser exchange
    }
  }

  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("Spotify isn't configured for this deployment. Paste or upload a tracklist instead.");
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || `HTTP ${res.status}`);
  }

  return await res.json();
}

export async function refreshSpotifyToken(refreshToken) {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!refreshToken || !clientId) return null;

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Silent token refresh failed:', err);
  }
  return null;
}

export async function fetchUserProfile(token) {
  return await spotifyApiFetch('/me', token);
}

export async function fetchPlaylists(token) {
  if (!isGitHubPages) {
    try {
      const res = await fetch('/api/spotify/playlists', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return await res.json();
    } catch {}
  }

  // Direct Web API call in static mode
  const me = await fetchUserProfile(token);
  const myId = me.id;

  const data = await spotifyApiFetch('/me/playlists?limit=50', token);
  const items = data.items || [];
  // Filter to user's OWN playlists per Phase 0.3 constraints
  const owned = items.filter(p => p.owner && p.owner.id === myId);

  const playlists = owned.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.owner?.id,
    ownerName: p.owner?.display_name,
    itemCount: p.items?.total ?? p.tracks?.total ?? 0,
    snapshotId: p.snapshot_id,
    uri: p.uri
  }));

  return { success: true, playlists, user: me };
}

export function isValidSpotifyNextUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'api.spotify.com' &&
      parsed.pathname.startsWith('/v1/')
    );
  } catch {
    return false;
  }
}

/**
 * Unwraps a Spotify playlist item entry conforming to Feb 2026+ specifications.
 * Uses field-existence checking ('item' in entry) to prevent resurrecting explicit null items.
 */
export function unwrapPlaylistItem(entry) {
  if (!entry || typeof entry !== 'object') {
    return { track: null, status: 'null_entry' };
  }

  // 1. Field-existence unwrap, not a || chain
  const raw = 'item' in entry ? entry.item : ('track' in entry ? entry.track : null);

  // If explicit null item (local file, unavailable content), keep it null
  if (!raw) {
    if (entry.is_local) {
      return { track: null, status: 'local_file' };
    }
    return { track: null, status: 'unavailable' };
  }

  // 2. Type guard: keep only track && track.type === 'track'
  if (raw.type === 'episode') {
    return { track: null, status: 'episode' };
  }

  if (raw.type !== 'track') {
    return { track: null, status: 'unsupported_type', type: raw.type };
  }

  if (!raw.id || !raw.name) {
    return { track: null, status: 'missing_metadata' };
  }

  return { track: raw, status: 'valid' };
}

export function mapSpotifyTrackToItem(t) {
  return {
    id: t.id,
    title: t.name,
    artist: t.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: t.album?.name || null,
    albumArt: t.album?.images?.[0]?.url || null,
    durationMs: t.duration_ms || null,
    durationSec: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
    bpm: null,
    key: null,
    camelot: null,
    energy: null,
    confidence: 'unverified',
    status: 'unverified',
    isrc: t.external_ids?.isrc || null,
    spotifyUri: t.uri,
    uri: t.uri
  };
}

/**
 * Formats user-facing toast notifications for playlist loading.
 * Guarantees zero usable tracks NEVER shows a success notification.
 */
export function formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped = {}) {
  const plName = pl?.name || 'Playlist';
  const expectedCount = pl?.itemCount;
  const total = totalReturned ?? loadedCount;
  const sk = {
    episodes: skipped.episodes || 0,
    localFiles: skipped.localFiles || 0,
    unavailable: skipped.unavailable || 0,
    unsupported: skipped.unsupported || 0,
    total: skipped.total || 0
  };

  if (loadedCount === 0) {
    if (total === 0) {
      return {
        text: `Playlist "${plName}" contains no items on Spotify.`,
        type: 'warning',
        isSuccess: false
      };
    }
    const breakdown = [];
    if (sk.episodes) breakdown.push(`${sk.episodes} podcast episode${sk.episodes > 1 ? 's' : ''}`);
    if (sk.localFiles) breakdown.push(`${sk.localFiles} local file${sk.localFiles > 1 ? 's' : ''}`);
    if (sk.unavailable) breakdown.push(`${sk.unavailable} unavailable track${sk.unavailable > 1 ? 's' : ''}`);
    if (sk.unsupported) breakdown.push(`${sk.unsupported} unsupported item${sk.unsupported > 1 ? 's' : ''}`);
    const reasonStr = breakdown.length > 0 ? ` (${breakdown.join(', ')})` : '';
    return {
      text: `No usable tracks found in "${plName}": all ${total} item${total > 1 ? 's were' : ' was'} skipped${reasonStr}.`,
      type: 'warning',
      isSuccess: false
    };
  }

  // Loaded > 0
  const breakdown = [];
  if (sk.episodes) breakdown.push(`${sk.episodes} episode${sk.episodes > 1 ? 's' : ''}`);
  if (sk.localFiles) breakdown.push(`${sk.localFiles} local`);
  if (sk.unavailable) breakdown.push(`${sk.unavailable} unavailable`);
  if (sk.unsupported) breakdown.push(`${sk.unsupported} unsupported`);
  const skipDetail = breakdown.length > 0 ? `: ${breakdown.join(', ')}` : '';

  if (sk.total > 0) {
    if (expectedCount && expectedCount !== loadedCount) {
      return {
        text: `Loaded ${loadedCount} tracks from "${plName}" (expected about ${expectedCount}, ${sk.total} skipped${skipDetail}).`,
        type: 'warning',
        isSuccess: true
      };
    }
    return {
      text: `Loaded ${loadedCount} tracks from "${plName}" (${sk.total} skipped${skipDetail}).`,
      type: 'warning',
      isSuccess: true
    };
  }

  if (expectedCount && Math.abs(expectedCount - loadedCount) > 0) {
    return {
      text: `Loaded ${loadedCount} tracks from "${plName}" (playlist reported ${expectedCount} items).`,
      type: 'success',
      isSuccess: true
    };
  }

  return {
    text: `Loaded ${loadedCount} tracks from "${plName}".`,
    type: 'success',
    isSuccess: true
  };
}

export async function fetchPlaylistItems(token, playlistId) {
  if (!isGitHubPages) {
    let proxyRes = null;
    try {
      proxyRes = await fetch(`/api/spotify/playlists/${playlistId}/items`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
    } catch (netErr) {
      // Network failure (server likely not running) - fall back quietly with a console.warn
      console.warn('Local proxy server unreachable, falling back to direct Spotify Web API:', netErr.message);
    }

    if (proxyRes) {
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const items = proxyData.items || [];
        return {
          success: true,
          items,
          totalItems: proxyData.totalItems ?? items.length,
          skipped: proxyData.skipped ?? { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 }
        };
      }

      // HTTP Error statuses (401, 403, 429, 5xx) surfaced honestly without leaking tokens
      const errBody = await proxyRes.json().catch(() => ({}));
      const message = errBody.error?.message || errBody.message || `Proxy server HTTP ${proxyRes.status}`;
      const err = new Error(message);
      err.status = proxyRes.status;
      throw err;
    }
  }

  // Direct Web API call with safe pagination loop
  const MAX_PAGES = 20; // Up to 1,000 tracks (20 pages * 50)
  let nextUrl = `/playlists/${playlistId}/items?limit=50`;
  let pageCount = 0;
  let totalRawItems = 0;
  const items = [];
  const skipped = {
    episodes: 0,
    localFiles: 0,
    unavailable: 0,
    unsupported: 0,
    total: 0
  };

  while (nextUrl) {
    pageCount++;
    if (pageCount > MAX_PAGES) {
      throw new Error(`Playlist exceeds supported size limit (maximum ${MAX_PAGES} pages / 1,000 tracks).`);
    }

    const data = await spotifyApiFetch(nextUrl, token);
    const rawBatch = data.items || [];
    totalRawItems += rawBatch.length;

    for (const entry of rawBatch) {
      const { track, status } = unwrapPlaylistItem(entry);
      if (status === 'valid') {
        items.push(mapSpotifyTrackToItem(track));
      } else {
        skipped.total++;
        if (status === 'episode') {
          skipped.episodes++;
        } else if (status === 'local_file') {
          skipped.localFiles++;
        } else if (status === 'unavailable' || status === 'null_entry' || status === 'missing_metadata') {
          skipped.unavailable++;
        } else {
          skipped.unsupported++;
        }
      }
    }

    if (data.next) {
      if (!isValidSpotifyNextUrl(data.next)) {
        throw new Error(`Spotify pagination rejected: untrusted next URL "${data.next}".`);
      }
      nextUrl = data.next;
    } else {
      nextUrl = null;
    }
  }

  return {
    success: true,
    items,
    totalItems: totalRawItems,
    skipped
  };
}

export async function parseCsvText(csvContent) {
  try {
    const res = await fetch('/api/pipeline/parse-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return await res.json();
  } catch {
    // In-browser fallback
  }

  const tracks = parseTracklistCSV(csvContent);
  return { success: true, tracks, count: tracks.length };
}

/**
 * Per-dimension coverage: a handover can only be graded when both tracks
 * carry both tempo and Camelot key.
 */
export function computeCoverageCounts(tracks) {
  const total = tracks.length;
  const missingTempo = tracks.filter(t => !(typeof t.bpm === 'number' && !isNaN(t.bpm) && t.bpm > 0)).length;
  const missingKey = tracks.filter(t => !t.camelot).length;
  return { total, missingTempo, missingKey };
}

export async function verifyTracklist(tracks, isSampleData = false) {
  // If the tracks are from the sample/demo set, mark them explicitly as SAMPLE DATA
  if (isSampleData || tracks.some(t => t.isSampleData)) {
    const processed = tracks.map(t => ({
      ...t,
      status: (t.bpm && t.camelot) ? 'sample' : 'missing',
      confidence: 'sample',
      isSampleData: true
    }));
    const sampleCount = processed.filter(t => t.status === 'sample').length;
    const missingCount = processed.filter(t => t.status === 'missing').length;
    return {
      success: true,
      tracks: processed,
      report: {
        total: tracks.length,
        corroborated: 0,
        singleSource: 0,
        supplied: 0,
        sample: sampleCount,
        disputed: 0,
        missing: missingCount,
        unverified: missingCount,
        summaryText: `Sample data (${tracks.length} tracks)`,
        disputedTracks: [],
        unverifiedTracks: processed.filter(t => t.status === 'missing')
      }
    };
  }

  try {
    const res = await fetch(`${API_BASE}/api/pipeline/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const processed = data.tracks.map(t => {
        let status = t.status;
        if (status === 'verified') status = 'corroborated';
        return { ...t, status };
      });
      return {
        ...data,
        tracks: processed,
        report: {
          ...data.report,
          corroborated: data.report.verified || 0,
          supplied: 0,
          sample: 0,
          missing: data.report.unverified || 0
        }
      };
    }
  } catch {
    // In-browser fallback
  }

  // Pure client-side verification for user-supplied CSV
  let supplied = 0;
  let missing = 0;
  const processed = tracks.map(t => {
    const hasData = Boolean(t.bpm && t.camelot);
    if (hasData) supplied++; else missing++;
    return {
      ...t,
      status: hasData ? 'supplied' : 'missing',
      confidence: hasData ? 'supplied' : 'none'
    };
  });

  return {
    success: true,
    tracks: processed,
    report: {
      total: tracks.length,
      corroborated: 0,
      singleSource: 0,
      supplied,
      sample: 0,
      disputed: 0,
      missing,
      unverified: missing,
      summaryText: `User supplied (${supplied} valid, ${missing} missing)`,
      disputedTracks: [],
      unverifiedTracks: processed.filter(t => t.status === 'missing')
    }
  };
}

export async function submitOverride(trackId, override) {
  try {
    const res = await fetch('/api/pipeline/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, override }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return await res.json();
  } catch {
    // In-browser fallback
  }
  return { success: true, trackId, override };
}

export async function runSequencer(tracks, options = {}) {
  try {
    const res = await fetch('/api/pipeline/sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracks,
        seed: options.seed || 42,
        enableEnergy: options.enableEnergy || false,
        unverifiedStrategy: options.unverifiedStrategy || 'keep_relative_position'
      }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return await res.json();
  } catch {
    // In-browser fallback
  }

  // Pure client-side 2-opt solver
  const sequencer = new DJSequencer({
    seed: options.seed || 42,
    enableEnergy: Boolean(options.enableEnergy),
    unverifiedStrategy: options.unverifiedStrategy || 'keep_relative_position'
  });

  const result = sequencer.solve(tracks);
  return { success: true, result };
}

export async function fetchSuggestions(evaluation, orderedTracks, token = null) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/pipeline/suggestions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ evaluation, orderedTracks }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return await res.json();
  } catch {
    // Graceful fallback
  }

  return { success: true, gaps: [], bridgeSuggestions: [], bonusTunes: [] };
}

export async function requestSavePreview(sourcePlaylist, orderedTracks) {
  if (!isGitHubPages) {
    try {
      const res = await fetch('/api/spotify/save/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePlaylist, orderedTracks }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return await res.json();
    } catch {}
  }

  // Pure client-side dry-run manifest generation
  const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const targetName = `${sourcePlaylist?.name || 'Custom Playlist'} - DJ sequence`;
  const targetDescription = `Sequenced by Deck Order on ${new Date().toLocaleDateString()} for harmonic mixing.`;

  const uris = orderedTracks
    .map(t => t.uri || t.spotifyUri)
    .filter(uri => Boolean(uri && uri.startsWith('spotify:track:')));

  const manifest = {
    operationId,
    sourceSnapshot: {
      id: sourcePlaylist?.id || null,
      name: sourcePlaylist?.name || 'Manual Source',
      snapshotId: sourcePlaylist?.snapshotId || null,
      itemCount: sourcePlaylist?.itemCount || orderedTracks.length
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

  return { success: true, manifest };
}

export async function confirmSavePlaylist(token, manifest) {
  if (!isGitHubPages) {
    try {
      const res = await fetch('/api/spotify/save/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ manifest, isConfirmed: true }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) return await res.json();
    } catch {}
  }

  // Direct Web API creation in static mode
  const target = manifest.targetPlaylist || { name: 'Deck Order Sequence', isPublic: false, description: '' };
  const created = await spotifyApiFetch('/me/playlists', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: target.name,
      description: target.description || 'Sequenced by Deck Order',
      public: Boolean(target.isPublic)
    })
  });

  const playlistId = created.id;
  const uris = manifest.urisManifest || [];

  // Add items in batches of 100
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await spotifyApiFetch(`/playlists/${playlistId}/items`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: chunk })
    });
  }

  return {
    success: true,
    playlistId,
    name: created.name,
    uri: created.uri,
    trackCount: uris.length
  };
}

export async function copyTracklistText(orderedTracks) {
  try {
    const res = await fetch('/api/export/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedTracks }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      return data.text;
    }
  } catch {
    // Fallback
  }
  return generatePlainTextTracklist(orderedTracks);
}

export async function triggerCsvDownload(orderedTracks, evaluation) {
  try {
    const res = await fetch('/api/export/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedTracks, evaluation }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const blob = await res.blob();
      downloadBlob(blob);
      return;
    }
  } catch {
    // Fallback
  }

  const csvString = generateCSVExport(orderedTracks, evaluation);
  const blob = new Blob([csvString], { type: 'text/csv' });
  downloadBlob(blob);
}

function downloadBlob(blob) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deck_order_sequenced_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
