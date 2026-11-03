/**
 * API client with seamless in-browser fallback for static GitHub Pages hosting.
 * When hosted on GitHub Pages or offline, executes pure mathematical algorithms
 * (Camelot mapping, 2-opt solver, CSV parsing, export) directly in the client.
 */

import {
  parseTracklistCSV,
  DJSequencer,
  generatePlainTextTracklist,
  generateCSVExport
} from './clientSequencer.js';

const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');

export async function fetchStatus() {
  if (isGitHubPages) {
    return {
      success: true,
      spotifyEligibility: {
        isConfigured: false,
        clientIdProvided: false,
        mode: 'Static Web Mode (GitHub Pages)',
        quotaNote: 'Running 100% client-side in browser. Connect via local proxy for Spotify writes.',
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
    return await res.json();
  } catch {
    return {
      success: true,
      spotifyEligibility: {
        isConfigured: false,
        clientIdProvided: false,
        mode: 'In-Browser Mode (Proxy Offline)',
        quotaNote: 'Running in browser. Start local server with `npm start` for Spotify sync.',
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
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchPlaylists(token) {
  const res = await fetch('/api/spotify/playlists', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchPlaylistItems(token, playlistId) {
  const res = await fetch(`/api/spotify/playlists/${playlistId}/items`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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

export async function verifyTracklist(tracks) {
  try {
    const res = await fetch('/api/pipeline/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return await res.json();
  } catch {
    // In-browser fallback
  }

  // Pure client-side verification
  let verified = 0;
  let unverified = 0;
  const processed = tracks.map(t => {
    const isV = Boolean(t.bpm && t.camelot);
    if (isV) verified++; else unverified++;
    return {
      ...t,
      status: isV ? 'verified' : 'unverified',
      confidence: isV ? 'manual' : 'none'
    };
  });

  return {
    success: true,
    tracks: processed,
    report: {
      total: tracks.length,
      verified,
      singleSource: 0,
      disputed: 0,
      unverified,
      summaryText: `Verified ${verified}/${tracks.length}, Disputed 0, Unverified ${unverified}`,
      disputedTracks: [],
      unverifiedTracks: []
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
  const res = await fetch('/api/spotify/save/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePlaylist, orderedTracks })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function confirmSavePlaylist(token, manifest) {
  const res = await fetch('/api/spotify/save/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ manifest, isConfirmed: true })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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
