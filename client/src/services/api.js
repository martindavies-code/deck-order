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
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
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

export async function fetchPlaylistItems(token, playlistId) {
  if (!isGitHubPages) {
    try {
      const res = await fetch(`/api/spotify/playlists/${playlistId}/items`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return await res.json();
    } catch {}
  }

  // Direct Web API call in static mode
  const data = await spotifyApiFetch(`/playlists/${playlistId}/items?limit=50`, token);
  const rawItems = data.items || [];

  const items = rawItems
    .map(i => i.track || i)
    .filter(t => t && t.id && t.name)
    .map(t => ({
      id: t.id,
      title: t.name,
      artist: t.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: t.album?.name,
      durationMs: t.duration_ms,
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
    }));

  return { success: true, items };
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
    const res = await fetch('/api/pipeline/verify', {
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
