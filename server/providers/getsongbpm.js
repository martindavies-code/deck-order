import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';
import { crossCheckTrackIdentity, versionTokens, withSingleflight } from './matchGuard.js';

/**
 * GetSongBPM API client (https://getsongbpm.com/api)
 * Condition: Visible backlink in app UI.
 * Quota: ~3000 req/hour with free API key.
 */
export class GetSongBPMProvider {
  constructor(apiKey = process.env.GETSONGBPM_API_KEY, options = {}) {
    this.apiKey = apiKey || null;
    this.name = 'GetSongBPM';
    // api.getsong.co is the documented host (getsongbpm.com/api); the
    // api.getsongbpm.com alias sits behind a bot interstitial that breaks
    // non-browser clients (verified 2026-11-14).
    this.baseUrl = 'https://api.getsong.co';
    this.cache = options.cache || providerCache;
    this.missCacheTtlSeconds = options.missCacheTtlSeconds || 24 * 3600;
    // Brief circuit breaker after a 429 instead of re-hitting the API per track.
    this.quotaCooldownSeconds = options.quotaCooldownSeconds || 15 * 60;
    this._inFlight = new Map();
  }

  static QUOTA_COOLDOWN_QUERY = { artist: '__quota_cooldown__', title: '', isrc: null, version: null };

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async lookupTrack({ artist, title, isrc, version }) {
    if (!this.isConfigured()) {
      return { success: false, reason: 'API key not configured' };
    }

    const queryKey = { artist, title, isrc, version };
    try {
      const cooldown = await this.cache.get(this.name, GetSongBPMProvider.QUOTA_COOLDOWN_QUERY);
      if (cooldown && cooldown.data) {
        return { success: false, reason: cooldown.data.reason || 'Rate limit reached (cooldown).', cached: true };
      }
    } catch { /* cooldown read failures never block a lookup */ }
    const cached = await this.cache.get(this.name, queryKey);
    if (cached) {
      // Negative caching: known misses stay misses instead of burning quota
      // on every re-verify of the same playlist.
      if (cached.data && cached.data.miss) {
        return { success: false, reason: cached.data.reason || 'Track not found (cached)', cached: true };
      }
      return { success: true, data: cached.data, cached: true };
    }

    const flightKey = this.cache.buildKey(this.name, queryKey);
    return await withSingleflight(this._inFlight, flightKey, async () => {
      try {
        // Search by song and artist
        const searchUrl = new URL(`${this.baseUrl}/search/`);
        searchUrl.searchParams.set('api_key', this.apiKey);
        searchUrl.searchParams.set('type', 'both');
        const versionSuffix = version && versionTokens(version).length > 0 ? ` ${version}` : '';
        searchUrl.searchParams.set('lookup', `${artist} ${title}${versionSuffix}`);

        const res = await fetch(searchUrl.toString(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) {
          if (res.status === 429) {
            const reason = 'Rate limit reached (429)';
            try {
              await this.cache.set(this.name, GetSongBPMProvider.QUOTA_COOLDOWN_QUERY, { miss: true, quota: true, reason }, this.quotaCooldownSeconds);
            } catch { /* marker failures never block the response */ }
            return { success: false, reason };
          }
          return { success: false, reason: `HTTP ${res.status}` };
        }

        const json = await res.json();
        const results = json.search || json.results || [];
        if (!Array.isArray(results) || results.length === 0) {
          try { await this.cache.set(this.name, queryKey, { miss: true, reason: 'Track not found' }, this.missCacheTtlSeconds); } catch { /* ignore cache errors */ }
          return { success: false, reason: 'Track not found' };
        }

        const query = { artist, title, isrc, version };
        const hit = results.find(candidate =>
          crossCheckTrackIdentity(query, candidate, { requireFields: true }).ok
        );
        if (!hit) {
          try { await this.cache.set(this.name, queryKey, { miss: true, reason: 'Identity cross-check rejected search candidates' }, this.missCacheTtlSeconds); } catch { /* ignore cache errors */ }
          return { success: false, reason: 'Identity cross-check rejected search candidates' };
        }

        const rawTempo = parseFloat(hit.tempo || hit.bpm);
        const rawKey = hit.key_of || hit.key;
        const parsedKey = parseKey(rawKey);

        const data = {
          provider: this.name,
          bpm: !isNaN(rawTempo) && rawTempo > 0 && rawTempo <= 350 ? Math.round(rawTempo * 10) / 10 : null,
          rawKey: rawKey || null,
          camelot: parsedKey.camelot,
          key: parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : (parsedKey.camelot || rawKey),
          energy: null, // GetSongBPM does not provide energy
          sourceId: hit.id || null,
          url: hit.song_url || null,
          confidence: 'provider_api'
        };

        await this.cache.set(this.name, queryKey, data);
        return { success: true, data, cached: false };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });
  }

  /**
   * Search for songs in a target BPM range and musical key (for bridge suggestions)
   */
  async findCandidatesByTempoAndKey({ minBpm, maxBpm, camelot }) {
    if (!this.isConfigured()) return [];

    try {
      const url = new URL(`${this.baseUrl}/tempo/`);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('bpm', Math.round((minBpm + maxBpm) / 2));

      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) return [];
      const json = await res.json();
      const songs = json.tempo || json.songs || [];

      const filtered = [];
      for (const s of songs) {
        const bpm = parseFloat(s.tempo || s.bpm);
        const parsedKey = parseKey(s.key_of || s.key);
        if (bpm >= minBpm && bpm <= maxBpm && (!camelot || parsedKey.camelot === camelot)) {
          filtered.push({
            artist: s.artist?.name || s.artist_name || 'Various',
            title: s.title || s.song_title,
            bpm,
            camelot: parsedKey.camelot,
            key: parsedKey.camelot || s.key_of,
            source: this.name
          });
        }
      }
      return filtered;
    } catch {
      return [];
    }
  }
}
