/**
 * API client with seamless in-browser fallback for static GitHub Pages hosting.
 * When hosted on GitHub Pages or offline, executes pure mathematical algorithms
 * (Camelot mapping, 2-opt solver, CSV parsing, export) directly in the client,
 * and interacts directly with Spotify Web API and Google Identity Services.
 */

import {
  parseTracklistCSV,
  DJSequencer,
  generateOfflineSuggestions,
  generatePlainTextTracklist,
  generateCSVExport,
  generateM3U8Export
} from './clientSequencer.js';

const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');
const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/+$/, '');

/**
 * Whether this deployment can reach a metadata provider for tempo/key checks:
 * the local server in dev, or the deployed metadata worker when VITE_API_BASE
 * was baked into a static (GitHub Pages) build.
 */
export const METADATA_PROVIDER_CONFIGURED = Boolean(API_BASE) || !isGitHubPages;

/** Batch sizing for provider verification: one request per batch keeps each
 * call inside its timeout (the worker processes tracks serially) and produces
 * real per-batch progress for the UI. */
export const VERIFY_BATCH_SIZE = 10;
// The worker analyzes uncached tracks serially on demand; a measured cold
// 10-track batch of niche tracks took >120s server-side. The per-batch
// timeout must comfortably exceed that so the client never aborts a batch
// mid-analysis. No automatic retry: the provider KV-caches only COMPLETED
// per-track results (no in-flight dedup), so a blind retry while the first
// attempt is still running would start duplicate provider jobs and consume
// duplicate quota. Recovery is instead honest partial state plus a natural
// manual re-run, which is served from the warmed cache.
export const VERIFY_BATCH_TIMEOUT_MS = 300000;
const VERIFY_MAX_CONSECUTIVE_FAILURES = 2;

export const SPOTIFY_403_MSG =
  "Spotify refused this request. If this app is in Development Mode, only accounts on its allowlist can use it - paste or upload a tracklist instead.";

const SPOTIFY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SPOTIFY_TRACK_URI_RE = /^spotify:track:[A-Za-z0-9_-]{1,64}$/;

/**
 * Direct Spotify Web API helper for static mode.
 * Handles 401 (session expired), 403 (honest allowlist explanation), 429 rate limits, and timeouts.
 */
async function spotifyApiFetch(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
  const reqSig = createProxyRequestSignal(options.timeoutMs ?? 15000, options.signal);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: reqSig.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...(options.headers || {})
      }
    });
  } finally {
    reqSig.cleanup();
  }

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

  if (res.status === 429) {
    const retryAfter = res.headers?.get?.('Retry-After');
    const err = new Error(retryAfter
      ? `Spotify rate limit hit (429). Retry after ${retryAfter}s.`
      : 'Spotify rate limit hit (429).');
    err.status = 429;
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

  // Static hosting still uses the deployed metadata worker when VITE_API_BASE is set.
  if (isGitHubPages && !API_BASE) {
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
    body: params,
    signal: AbortSignal.timeout(10000)
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
      body: params,
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Silent token refresh failed:', err);
  }
  return null;
}

function createProxyRequestSignal(timeoutMs, externalSignal) {
  if (!externalSignal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const err = new Error('Request timed out');
    err.name = 'TimeoutError';
    controller.abort(err);
  }, timeoutMs);
  const onAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };
}

export async function fetchUserProfile(token, options = {}) {
  return await spotifyApiFetch('/me', token, options.signal ? { signal: options.signal } : {});
}

const MAX_PLAYLIST_PAGES = 50;

export async function fetchPlaylists(token, options = {}) {
  const { signal, onProgress } = options;

  if (!isGitHubPages) {
    const reqSig = createProxyRequestSignal(15000, signal);
    let proxyRes = null;
    try {
      proxyRes = await fetch('/api/spotify/playlists', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: reqSig.signal
      });
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
    } finally {
      reqSig.cleanup();
    }

    if (proxyRes) {
      if (proxyRes.ok) return await proxyRes.json();
      if (proxyRes.status === 401) {
        const err = new Error('Spotify session expired (401).');
        err.status = 401;
        throw err;
      }
      if (proxyRes.status === 403) {
        const err = new Error('Spotify access restricted (403). Your account may need to be added to the Spotify Developer Dashboard allowlist.');
        err.status = 403;
        throw err;
      }
      if (proxyRes.status === 429) {
        const retryAfter = proxyRes.headers?.get?.('Retry-After');
        const err = new Error(retryAfter
          ? `Spotify rate limit hit (429). Retry after ${retryAfter}s.`
          : 'Spotify rate limit hit (429).');
        err.status = 429;
        throw err;
      }
    }
  }

  // Direct Web API call in static mode (or when local proxy is unavailable)
  const me = await fetchUserProfile(token, { signal });
  const myId = me.id;

  const seenUrls = new Set();
  const seenIds = new Set();
  const playlists = [];
  let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
  let page = 0;

  while (nextUrl) {
    if (signal?.aborted) {
      const err = new Error('Playlist loading cancelled.');
      err.name = 'AbortError';
      throw err;
    }
    if (page >= MAX_PLAYLIST_PAGES) {
      throw new Error(`Playlist list exceeded safety limit (${MAX_PLAYLIST_PAGES} pages).`);
    }
    if (seenUrls.has(nextUrl)) {
      throw new Error('Spotify returned a repeated playlist pagination cursor.');
    }
    seenUrls.add(nextUrl);
    page += 1;

    const data = await spotifyApiFetch(nextUrl, token, signal ? { signal } : {});
    const items = Array.isArray(data.items) ? data.items : [];
    for (const p of items) {
      if (!p || !p.id) continue;
      // Filter to user's OWN playlists per Phase 0.3 constraints
      if (!p.owner || p.owner.id !== myId) continue;
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      playlists.push({
        id: p.id,
        name: p.name,
        description: p.description,
        ownerId: p.owner?.id,
        ownerName: p.owner?.display_name,
        itemCount: p.items?.total ?? p.tracks?.total ?? 0,
        snapshotId: p.snapshot_id,
        uri: p.uri
      });
    }

    if (typeof onProgress === 'function') {
      onProgress({
        page,
        ownedCount: playlists.length,
        total: typeof data.total === 'number' ? data.total : null
      });
    }

    if (data.next) {
      if (!isValidSpotifyNextUrl(data.next)) {
        throw new Error('Spotify returned an untrusted playlist pagination URL.');
      }
      nextUrl = data.next;
    } else {
      nextUrl = null;
    }
  }

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
 * Formats the in-progress loading state for the import UI.
 * Only real signals are shown: Spotify page fetching (fetched of total) and
 * provider verification batches (checked of total). Where no total exists the
 * indicator is indeterminate - never a fabricated percentage.
 */
export function formatLoadProgress(progress) {
  if (!progress || !progress.stage) return null;
  const fetched = Math.max(0, progress.fetched || 0);
  const total = typeof progress.total === 'number' && progress.total > 0 ? progress.total : null;

  if (progress.stage === 'fetch') {
    if (total) {
      return {
        text: `Loading tracks from Spotify - ${Math.min(fetched, total)} of ${total}`,
        determinate: true,
        ratio: Math.min(fetched / total, 1)
      };
    }
    return {
      text: fetched > 0 ? `Loading tracks from Spotify - ${fetched} so far` : 'Loading tracks from Spotify…',
      determinate: false,
      ratio: null
    };
  }

  if (progress.stage === 'verify') {
    if (total && progress.phase === 'start' && progress.batch) {
      return {
        text: `Checking tempo and key - batch ${progress.batch} of ${progress.batches}, ${Math.min(fetched, total)} of ${total} done`,
        determinate: true,
        ratio: Math.min(fetched / total, 1)
      };
    }
    if (total) {
      return {
        text: `Checking tempo and key - ${Math.min(fetched, total)} of ${total}`,
        determinate: true,
        ratio: Math.min(fetched / total, 1)
      };
    }
    return { text: 'Checking tempo and key…', determinate: false, ratio: null };
  }

  return { text: 'Reading tracklist…', determinate: false, ratio: null };
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

export async function fetchPlaylistItems(token, playlistId, progressOrOptions, extraOptions = {}) {
  if (!SPOTIFY_ID_RE.test(String(playlistId || ''))) {
    throw new Error('Invalid Spotify playlist ID.');
  }

  let onProgress = null;
  let signal = extraOptions?.signal || null;
  if (typeof progressOrOptions === 'function') {
    onProgress = progressOrOptions;
  } else if (progressOrOptions && typeof progressOrOptions === 'object') {
    onProgress = progressOrOptions.onProgress || null;
    signal = progressOrOptions.signal || signal;
  }

  if (!isGitHubPages) {
    let proxyRes = null;
    const reqSig = createProxyRequestSignal(15000, signal);
    try {
      proxyRes = await fetch(`/api/spotify/playlists/${encodeURIComponent(playlistId)}/items`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: reqSig.signal
      });
    } catch (netErr) {
      if (signal?.aborted || netErr?.name === 'AbortError') throw netErr;
      // Network failure (server likely not running) - fall back quietly with a console.warn
      console.warn('Local proxy server unreachable, falling back to direct Spotify Web API:', netErr.message);
    } finally {
      reqSig.cleanup();
    }

    if (proxyRes) {
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const items = proxyData.items || [];
        const totalItems = proxyData.totalItems ?? items.length;
        if (typeof onProgress === 'function') {
          onProgress({ stage: 'fetch', fetched: items.length, total: totalItems });
        }
        return {
          success: true,
          items,
          totalItems,
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
  const seenUrls = new Set();
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
    if (signal?.aborted) {
      const err = new Error('Playlist loading cancelled.');
      err.name = 'AbortError';
      throw err;
    }
    if (seenUrls.has(nextUrl)) {
      throw new Error('Spotify returned a repeated playlist items cursor.');
    }
    seenUrls.add(nextUrl);
    pageCount++;
    if (pageCount > MAX_PAGES) {
      throw new Error(`Playlist exceeds supported size limit (maximum ${MAX_PAGES} pages / 1,000 tracks).`);
    }

    const data = await spotifyApiFetch(nextUrl, token, signal ? { signal } : {});
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

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'fetch',
        fetched: totalRawItems,
        total: typeof data.total === 'number' && data.total > 0 ? data.total : null
      });
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

export async function verifyTracklist(tracks, isSampleData = false, onProgress, options = {}) {
  let opts = options;
  let sampleFlag = isSampleData;
  let progressFn = onProgress;
  if (typeof isSampleData === 'object' && isSampleData !== null) {
    opts = isSampleData;
    sampleFlag = Boolean(opts.isSampleData);
    progressFn = opts.onProgress || onProgress;
  }
  const signal = opts?.signal;
  // If the tracks are from the sample/demo set, mark them explicitly as SAMPLE DATA
  if (sampleFlag || tracks.some(t => t.isSampleData)) {
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
        unverifiedTracks: processed.filter(t => t.status === 'missing'),
        tempoReviewTracks: [],
        recordingReviewTracks: [],
        providerConfigured: METADATA_PROVIDER_CONFIGURED,
        providerUnreachable: false,
        providerPartialFailure: false
      }
    };
  }

  const total = tracks.length;

  // Per-track client-side marking used when the provider cannot be reached.
  // Honest: these tracks were NOT checked against a provider.
  const markUnchecked = (t, reason) => {
    const hasData = Boolean(t.bpm && t.camelot);
    return {
      ...t,
      status: hasData ? 'supplied' : 'missing',
      confidence: hasData ? 'supplied' : 'none',
      ...(reason && !hasData ? { reason } : {})
    };
  };

  if (METADATA_PROVIDER_CONFIGURED && total > 0) {
    // Batched provider verification: the worker processes tracks serially, so
    // one request per batch stays inside the timeout and yields real progress.
    const batches = [];
    for (let i = 0; i < total; i += VERIFY_BATCH_SIZE) {
      batches.push(tracks.slice(i, i + VERIFY_BATCH_SIZE));
    }

    const processedAll = new Array(total).fill(null);
    const merged = {
      corroborated: 0, singleSource: 0, disputed: 0, missing: 0,
      disputedTracks: [], unverifiedTracks: [], tempoReviewTracks: [], recordingReviewTracks: []
    };
    let checkedCount = 0;
    let consecutiveFailures = 0;
    let providerFailed = false;

    for (let b = 0; b < batches.length; b++) {
      if (signal?.aborted) {
        const err = new Error('Verification cancelled');
        err.name = 'AbortError';
        throw err;
      }
      if (consecutiveFailures >= VERIFY_MAX_CONSECUTIVE_FAILURES) break;
      const batch = batches[b];
      // Real progress while a (possibly cold, multi-minute) batch is in flight:
      // the UI shows which batch is being analyzed, never a fake percent.
      if (typeof progressFn === 'function') {
        progressFn({ stage: 'verify', phase: 'start', batch: b + 1, batches: batches.length, fetched: checkedCount, total });
      }
      let batchErr = null;
      try {
        const res = await fetch(`${API_BASE}/api/pipeline/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: batch }),
          // Cold batches can take minutes; the timeout must exceed worst-case
          // server-side analysis so the client never aborts mid-analysis.
          signal: (typeof AbortSignal.any === 'function' && signal)
            ? AbortSignal.any([signal, AbortSignal.timeout(VERIFY_BATCH_TIMEOUT_MS)])
            : (signal || AbortSignal.timeout(VERIFY_BATCH_TIMEOUT_MS))
        });
        if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.tracks)) throw new Error('Malformed provider response');

        data.tracks.forEach((t, idx) => {
          let status = t.status;
          if (status === 'verified') status = 'corroborated';
          processedAll[b * VERIFY_BATCH_SIZE + idx] = { ...t, status };
        });
        const r = data.report || {};
        merged.corroborated += r.verified || 0;
        merged.singleSource += r.singleSource || 0;
        merged.disputed += r.disputed || 0;
        merged.missing += r.unverified || 0;
        merged.disputedTracks.push(...(r.disputedTracks || []));
        merged.unverifiedTracks.push(...(r.unverifiedTracks || []));
        merged.tempoReviewTracks.push(...(r.tempoReviewTracks || []));
        merged.recordingReviewTracks.push(...(r.recordingReviewTracks || []));
        checkedCount += batch.length;
        consecutiveFailures = 0;
        if (typeof progressFn === 'function') {
          progressFn({ stage: 'verify', fetched: checkedCount, total });
        }
      } catch (err) {
        batchErr = err;
      }
      if (batchErr) {
        // Only a caller-initiated abort is rethrown. A batch timeout
        // (TimeoutError, or AbortError on older engines) keeps the
        // partial-failure handling below.
        if (signal?.aborted) {
          throw batchErr;
        }
        consecutiveFailures++;
        providerFailed = true;
        console.warn(`Verification batch ${b + 1}/${batches.length} failed:`, batchErr.message);
      }
    }

    // Any track the provider never processed is marked honestly as unchecked.
    let fallbackSupplied = 0;
    let fallbackMissing = 0;
    for (let i = 0; i < total; i++) {
      if (processedAll[i]) continue;
      const marked = markUnchecked(tracks[i], 'Tempo/key check did not finish - the metadata provider did not respond.');
      if (marked.status === 'supplied') fallbackSupplied++; else fallbackMissing++;
      processedAll[i] = marked;
    }
    const uncheckedCount = total - checkedCount;

    return {
      success: true,
      tracks: processedAll,
      report: {
        total,
        corroborated: merged.corroborated,
        singleSource: merged.singleSource,
        supplied: fallbackSupplied,
        sample: 0,
        disputed: merged.disputed,
        missing: merged.missing + fallbackMissing,
        unverified: merged.missing + fallbackMissing,
        checkedCount,
        uncheckedCount,
        providerConfigured: true,
        providerUnreachable: providerFailed && checkedCount === 0,
        providerPartialFailure: providerFailed && checkedCount > 0 && uncheckedCount > 0,
        summaryText: providerFailed
          ? `Checked ${checkedCount}/${total} via provider; ${uncheckedCount} unchecked (provider did not respond)`
          : `Provider check complete (${total} tracks)`,
        disputedTracks: merged.disputedTracks,
        unverifiedTracks: merged.unverifiedTracks,
        tempoReviewTracks: merged.tempoReviewTracks,
        recordingReviewTracks: merged.recordingReviewTracks
      }
    };
  }

  // No provider configured on this deployment: pure client-side marking.
  let supplied = 0;
  let missing = 0;
  const processed = tracks.map(t => {
    const marked = markUnchecked(t);
    if (marked.status === 'supplied') supplied++; else missing++;
    return marked;
  });

  return {
    success: true,
    tracks: processed,
    report: {
      total,
      corroborated: 0,
      singleSource: 0,
      supplied,
      sample: 0,
      disputed: 0,
      missing,
      unverified: missing,
      checkedCount: 0,
      uncheckedCount: 0,
      providerConfigured: false,
      providerUnreachable: false,
      providerPartialFailure: false,
      summaryText: `User supplied (${supplied} valid, ${missing} missing)`,
      disputedTracks: [],
      unverifiedTracks: processed.filter(t => t.status === 'missing'),
      tempoReviewTracks: [],
      recordingReviewTracks: []
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
        unverifiedStrategy: options.unverifiedStrategy || 'keep_relative_position',
        lockedOpenerId: options.lockedOpenerId || null,
        lockedCloserId: options.lockedCloserId || null
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
    unverifiedStrategy: options.unverifiedStrategy || 'keep_relative_position',
    lockedOpenerId: options.lockedOpenerId || null,
    lockedCloserId: options.lockedCloserId || null
  });

  const result = sequencer.solve(tracks);
  return { success: true, result };
}

export async function fetchSuggestions(evaluation, orderedTracks, token = null) {
  if (!isGitHubPages) {
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
      // Fall back to curated in-browser matcher
    }
  }

  return await generateOfflineSuggestions(evaluation, orderedTracks);
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

  const skippedCount = orderedTracks.length - uris.length;
  const isSampleData = orderedTracks.length > 0 && orderedTracks.every(t => t.isSampleData);

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
    skippedCount,
    isSampleData,
    urisManifest: uris,
    isDryRun: true,
    previewSummary: `This will create playlist "${targetName}" with ${uris.length} tracks in this order.`
  };

  return { success: true, manifest };
}

export async function confirmSavePlaylist(token, manifest) {
  const uris = Array.isArray(manifest?.urisManifest) ? manifest.urisManifest : [];
  if (uris.length === 0) {
    throw new Error('Cannot save playlist: none of the tracks in this set have a valid Spotify track URI.');
  }
  if (!uris.every(uri => typeof uri === 'string' && SPOTIFY_TRACK_URI_RE.test(uri))) {
    throw new Error('Cannot save playlist: manifest contains an invalid Spotify track URI.');
  }

  if (!isGitHubPages) {
    let proxyRes = null;
    try {
      proxyRes = await fetch('/api/spotify/save/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ manifest, isConfirmed: true }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (err) {
      // Only fall back to direct Web API if the local proxy could not be reached at all.
      // Never blindly replay a write request after a timeout.
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error('Timed out waiting for the local save server; check Spotify before retrying so you do not create a duplicate playlist.');
      }
    }

    if (proxyRes) {
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const saved = proxyData?.result || proxyData;
        return {
          ...saved,
          success: true,
          name: saved.playlistName || saved.name || manifest.targetPlaylist?.name || 'Deck Order Sequence',
          playlistName: saved.playlistName || saved.name || manifest.targetPlaylist?.name || 'Deck Order Sequence',
          trackCount: saved.itemsWritten ?? saved.trackCount ?? uris.length,
          itemsWritten: saved.itemsWritten ?? saved.trackCount ?? uris.length
        };
      }
      // Fall back to direct mode only when Vite/dev proxy returns 404 (no backend mounted)
      if (proxyRes.status !== 404) {
        const errBody = await proxyRes.json().catch(() => ({}));
        const err = new Error(errBody.error?.message || errBody.error || `Proxy server HTTP ${proxyRes.status}`);
        err.status = proxyRes.status;
        throw err;
      }
    }
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

  const playlistId = created?.id;
  if (!SPOTIFY_ID_RE.test(String(playlistId || ''))) {
    throw new Error('Spotify did not return a valid playlist ID.');
  }
  const spotifyUrl = created.external_urls?.spotify || null;

  // Add items in batches of 100
  let writtenCount = 0;
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    try {
      await spotifyApiFetch(`/playlists/${playlistId}/items`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: chunk })
      });
      writtenCount += chunk.length;
    } catch (batchErr) {
      batchErr.partialSave = { playlistId, spotifyUrl, writtenCount, totalCount: uris.length };
      batchErr.message = `Created "${created.name || target.name}" (${writtenCount} of ${uris.length} tracks written) before stopping: ${batchErr.message}`;
      throw batchErr;
    }
  }

  return {
    success: true,
    playlistId,
    name: created.name || target.name,
    playlistName: created.name || target.name,
    spotifyUrl,
    uri: created.uri,
    itemsWritten: writtenCount,
    trackCount: writtenCount
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

export function triggerM3U8Download(orderedTracks, setName = 'Deck Order Set') {
  const m3u8String = generateM3U8Export(orderedTracks, setName);
  const blob = new Blob([m3u8String], { type: 'audio/x-mpegurl;charset=utf-8' });
  const safeBase = String(setName || 'deck_order').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'deck_order';
  downloadBlob(blob, `${safeBase}_${Date.now()}.m3u8`);
}

function downloadBlob(blob, filename = `deck_order_sequenced_${Date.now()}.csv`) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
