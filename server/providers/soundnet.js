import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';
import { crossCheckTrackIdentity, withSingleflight } from './matchGuard.js';

/**
 * SoundNet Track Analysis API (RapidAPI)
 * Provides key, mode, tempo, camelot, energy, danceability, happiness, loudness.
 * Free tier: only 5 requests/day (evaluation only).
 * Usable tiers start at USD 9.99/month.
 * STRICT: DO NOT auto-sign up. Requires explicit user opt-in and manual key provision.
 */
export function parseSoundNetLoudness(rawLoudness) {
  if (typeof rawLoudness === 'number' && Number.isFinite(rawLoudness) && rawLoudness >= -60 && rawLoudness <= 10) {
    return Math.round(rawLoudness * 10) / 10;
  }
  if (typeof rawLoudness === 'string') {
    const parsed = parseFloat(rawLoudness);
    if (Number.isFinite(parsed) && parsed >= -60 && parsed <= 10) {
      return Math.round(parsed * 10) / 10;
    }
  }
  return null;
}

export class SoundNetProvider {
  constructor(apiKey = process.env.SOUNDNET_API_KEY, options = {}) {
    this.apiKey = apiKey || null;
    this.name = 'SoundNet';
    this.costNotice = 'Free tier limited to 5 req/day. Paid tier starts at $9.99/month.';
    this.cache = options.cache || providerCache;
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.cacheTtlSeconds = options.cacheTtlSeconds || 30 * 24 * 3600;
    this.missCacheTtlSeconds = options.missCacheTtlSeconds || 24 * 3600;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this._inFlight = new Map();
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  _buildCacheKey(queryKey) {
    if (this.cache && typeof this.cache.buildKey === 'function') {
      return this.cache.buildKey(this.name, queryKey);
    }
    const cleanIsrc = typeof queryKey.isrc === 'string' ? queryKey.isrc.trim().toUpperCase() : '';
    if (cleanIsrc) return `soundnet:v1:isrc:${cleanIsrc}`;
    const artist = (typeof queryKey.artist === 'string' ? queryKey.artist : '').toLowerCase().trim();
    const title = (typeof queryKey.title === 'string' ? queryKey.title : '').toLowerCase().trim();
    const version = (typeof queryKey.version === 'string' ? queryKey.version : '').toLowerCase().trim();
    return `soundnet:v1:query:${artist}:::${title}:::${version}`;
  }

  async lookupTrack({ artist, title, isrc, version }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        reason: `SoundNet API key not configured. (${this.costNotice})`
      };
    }

    const queryKey = { artist, title, isrc, version };
    const isProviderCache = this.cache && typeof this.cache.buildKey === 'function';
    const flightKey = this._buildCacheKey(queryKey);

    if (this.cache) {
      try {
        const cached = isProviderCache
          ? await this.cache.get(this.name, queryKey)
          : await this.cache.get(flightKey);
        if (cached) {
          if (cached.data) return { success: true, data: cached.data, cached: true };
          if (cached.success === false && !cached.transient) return { ...cached, cached: true };
        }
      } catch {
        // Ignore cache read failures so optional SoundNet enrichment never aborts lookup.
      }
    }

    return await withSingleflight(this._inFlight, flightKey, async () => {
      try {
        const url = new URL('https://soundnet.p.rapidapi.com/analyze');
        url.searchParams.set('artist', artist);
        url.searchParams.set('title', title);

        const res = await this.fetchImpl(url.toString(), {
          headers: {
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': 'soundnet.p.rapidapi.com',
            'Accept': 'application/json'
          },
          signal: this.requestTimeoutMs > 0 ? AbortSignal.timeout(this.requestTimeoutMs) : undefined
        });

        if (!res.ok) {
          if (res.status === 429) {
            return { success: false, reason: 'Daily quota reached (5 req/day limit on free tier). Paid tier: $9.99/mo.' };
          }
          return { success: false, reason: `HTTP ${res.status}` };
        }

        const json = await res.json();
        const identity = crossCheckTrackIdentity(
          { artist, title, isrc, version },
          json,
          { requireFields: false }
        );
        if (!identity.ok) {
          const out = { success: false, reason: identity.reason };
          if (this.cache && !isProviderCache) {
            try { await this.cache.set(flightKey, out, this.missCacheTtlSeconds); } catch { /* ignore cache errors */ }
          }
          return out;
        }

        const rawTempo = parseFloat(json.tempo || json.bpm);
        const rawKey = json.key;
        const rawMode = json.mode; // 'major' | 'minor'
        const parsedKey = parseKey(rawKey, rawMode);

        const data = {
          provider: this.name,
          bpm: !isNaN(rawTempo) && rawTempo > 0 && rawTempo <= 350 ? Math.round(rawTempo * 10) / 10 : null,
          rawKey: rawKey || null,
          camelot: parsedKey.camelot,
          key: parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : (parsedKey.camelot || rawKey),
          energy: typeof json.energy === 'number' && json.energy >= 0 && json.energy <= 1 ? Math.round(json.energy * 100) / 100 : null,
          loudness: parseSoundNetLoudness(json.loudness),
          danceability: typeof json.danceability === 'number' ? json.danceability : null,
          confidence: 'provider_api'
        };

        if (this.cache) {
          try {
            if (isProviderCache) {
              this.cache.set(this.name, queryKey, data);
            } else {
              await this.cache.set(flightKey, { success: true, data }, this.cacheTtlSeconds);
            }
          } catch {
            // Ignore cache write errors for optional enrichment.
          }
        }
        return { success: true, data, cached: false };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });
  }
}
