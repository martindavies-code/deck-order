import { providerCache } from '../providers/cache.js';
import { auditLogger } from './auditLogger.js';

/**
 * Spotify Web API Client (Conforming to 2026 Developer Platform Specs)
 * 
 * STRICT COMPLIANCE:
 * - Zero deprecated or removed audio inspection endpoints used.
 * - Modern endpoints:
 *   - Read items: GET /playlists/{id}/items
 *   - List playlists: GET /me/playlists
 *   - Create playlist: POST /me/playlists
 *   - Add items: POST /playlists/{id}/items
 *   - Search: GET /search (limit <= 10)
 *   - Single track: GET /tracks/{id}
 */
export class SpotifyClient {
  constructor(options = {}) {
    this.accessToken = options.accessToken || null;
    this.refreshToken = options.refreshToken || null;
    this.clientId = options.clientId || process.env.SPOTIFY_CLIENT_ID || null;
    this.clientSecret = options.clientSecret || process.env.SPOTIFY_CLIENT_SECRET || null;
    this.baseUrl = 'https://api.spotify.com/v1';
    this.tokenUrl = 'https://accounts.spotify.com/api/token';
  }

  isReady() {
    return Boolean(this.accessToken);
  }

  setTokens(accessToken, refreshToken = null) {
    this.accessToken = accessToken;
    if (refreshToken) this.refreshToken = refreshToken;
  }

  /**
   * Safe fetch with token refresh, rate-limit retry, and eligibility error reporting
   */
  async request(endpoint, options = {}, isRetryAfterRefresh = false) {
    if (!this.accessToken) {
      throw new Error('Spotify client unauthenticated: Missing access token');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof URLSearchParams)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    try {
      const res = await fetch(url, { ...options, headers });

      // Handle 401 Unauthorized -> Refresh token once
      if (res.status === 401 && !isRetryAfterRefresh && this.refreshToken) {
        auditLogger.log('AUTH_REFRESH_ATTEMPT', { endpoint });
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return this.request(endpoint, options, true);
        }
        throw new Error('Spotify session expired (401). Please re-authenticate.');
      }

      // Handle 403 Forbidden -> Eligibility or Scope failure
      if (res.status === 403) {
        const errText = await res.text();
        auditLogger.log('API_403_FORBIDDEN', { endpoint, error: errText });
        throw new Error(`Spotify API 403 Forbidden: Missing required scope or developer eligibility check failed. Details: ${errText}`);
      }

      // Handle 429 Rate Limit / Quota Exceeded
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        const errJson = await res.json().catch(() => ({}));
        auditLogger.log('API_429_RATE_LIMIT', { endpoint, retryAfter, reason: errJson.error?.message });

        if (errJson.error?.message?.includes('QUOTA_EXCEEDED') || errJson.error?.reason === 'QUOTA_EXCEEDED') {
          throw new Error('Spotify Development Mode quota limit exceeded (429 QUOTA_EXCEEDED). Request halted to protect developer account.');
        }

        // Honor Retry-After
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.request(endpoint, options, isRetryAfterRefresh);
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Spotify HTTP ${res.status}: ${errBody}`);
      }

      // 204 No Content
      if (res.status === 204) return null;

      return await res.json();
    } catch (err) {
      auditLogger.log('API_REQUEST_ERROR', { endpoint, error: err.message });
      throw err;
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) return false;

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', this.refreshToken);
      if (this.clientId) params.append('client_id', this.clientId);
      if (this.clientSecret) params.append('client_secret', this.clientSecret);

      const res = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      if (!res.ok) {
        this.accessToken = null;
        return false;
      }

      const data = await res.json();
      this.accessToken = data.access_token;
      if (data.refresh_token) this.refreshToken = data.refresh_token;
      auditLogger.log('AUTH_TOKEN_REFRESHED_SUCCESS', { hasNewRefreshToken: Boolean(data.refresh_token) });
      return true;
    } catch (err) {
      auditLogger.log('AUTH_REFRESH_FAILED', { error: err.message });
      return false;
    }
  }

  /**
   * Get Current User Profile
   */
  async getMe() {
    return this.request('/me');
  }

  extractNextEndpoint(nextUrl) {
    let base;
    let parsed;
    try {
      base = new URL(this.baseUrl);
      parsed = new URL(nextUrl);
    } catch {
      throw new Error('Spotify returned an invalid pagination URL.');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Spotify returned an untrusted pagination URL.');
    }
    if (parsed.protocol !== base.protocol || parsed.host !== base.host) {
      throw new Error('Spotify returned an untrusted pagination URL.');
    }
    const basePrefix = `${base.pathname.replace(/\/$/, '')}/`;
    if (!parsed.pathname.startsWith(basePrefix)) {
      throw new Error('Spotify returned an untrusted pagination URL.');
    }
    return `${parsed.pathname.slice(basePrefix.length - 1)}${parsed.search}`;
  }

  /**
   * List Current User's Playlists
   * Only returns user's OWN playlists per Phase 0.3
   */
  async getMyPlaylists(limit = 50) {
    const MAX_PLAYLIST_PAGES = 50;
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
    const me = await this.getMe();
    const myId = me.id;

    const seenEndpoints = new Set();
    const seenIds = new Set();
    const playlists = [];
    let nextEndpoint = `/me/playlists?limit=${cappedLimit}`;
    let page = 0;

    while (nextEndpoint) {
      if (page >= MAX_PLAYLIST_PAGES) {
        throw new Error(`Playlist list exceeded safety limit (${MAX_PLAYLIST_PAGES} pages).`);
      }
      if (seenEndpoints.has(nextEndpoint)) {
        throw new Error('Spotify returned a repeated playlist pagination cursor.');
      }
      seenEndpoints.add(nextEndpoint);
      page += 1;

      const data = await this.request(nextEndpoint);
      const items = Array.isArray(data.items) ? data.items : [];

      // Filter to playlists owned by current user across every page
      for (const p of items) {
        if (!p || !p.id) continue;
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
          images: p.images || [],
          uri: p.uri
        });
      }

      nextEndpoint = data.next ? this.extractNextEndpoint(data.next) : null;
    }

    return playlists;
  }

  /**
   * Read Playlist Contents
   * Endpoint: GET /playlists/{id}/items (post-Feb 2026 standard)
   */
  async getPlaylistItems(playlistId) {
    const cached = providerCache.get('spotify_playlist_items', { isrc: playlistId });
    if (cached) return cached.data;

    let items = [];
    let nextUrl = `/playlists/${playlistId}/items?limit=50`;

    while (nextUrl) {
      const data = await this.request(nextUrl);
      const batch = data.items || [];

      for (const item of batch) {
        const track = item.track || item.item;
        if (track && track.type === 'track') {
          items.push({
            id: track.id,
            uri: track.uri,
            artist: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
            title: track.name,
            version: 'Original Mix',
            isrc: track.external_ids?.isrc || null,
            duration_ms: track.duration_ms,
            album: track.album?.name,
            albumArt: track.album?.images?.[0]?.url,
            spotifyUrl: track.external_urls?.spotify,
            bpm: null, // intentionally null (forbidden endpoint not used)
            camelot: null,
            key: null,
            energy: null,
            status: 'unverified',
            confidence: 'none',
            sources: []
          });
        }
      }

      nextUrl = data.next ? this.extractNextEndpoint(data.next) : null;
    }

    providerCache.set('spotify_playlist_items', { isrc: playlistId }, items);
    return items;
  }

  /**
   * Search tracks (limit max 10 per post-Feb 2026 specs)
   */
  async searchArtistTracks(artistName, limit = 5) {
    const cappedLimit = Math.min(10, Math.max(1, limit));
    const q = encodeURIComponent(`artist:${artistName}`);
    const data = await this.request(`/search?q=${q}&type=track&limit=${cappedLimit}`);
    const tracks = data.tracks?.items || [];

    return tracks.map(t => ({
      id: t.id,
      uri: t.uri,
      artist: t.artists?.map(a => a.name).join(', '),
      title: t.name,
      isrc: t.external_ids?.isrc || null,
      duration_ms: t.duration_ms,
      spotifyUrl: t.external_urls?.spotify
    }));
  }
}
