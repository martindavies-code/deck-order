import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';
import { crossCheckTrackIdentity, withSingleflight } from './matchGuard.js';
import { parseSoundNetLoudness } from './soundnet.js';

const CAMELOT_RE = /^([1-9]|1[0-2])[AB]$/;

/**
 * Musicae DJ Track Audio Analysis API (RapidAPI)
 * https://api.musicae.io/docs/ - GET /v2/audio-analysis/{spotifyId-or-ISRC}
 * Free tier: 10 requests/day, no card.
 *
 * Consultation policy (owner decision 2026-11-14): ISRC-addressable ONLY, and
 * consulted ONLY as (a) tiebreaker when the two priority sources disagree, or
 * (b) fallback when fewer than two priority sources respond - the daily quota
 * is too small for primary consultation or bulk backfill. Responses are cached
 * by ISRC (30-day TTL on KV / indefinite in-memory) so repeats cost nothing.
 *
 * Real API shape (verified against the live service 2026-11-14):
 *   Base: https://dj-track-audio-analysis-api.p.rapidapi.com
 *   Auth: x-rapidapi-key + x-rapidapi-host headers (shared RapidAPI key)
 *   GET /v2/audio-analysis/:isrc   exact-recording lookup
 * Response carries track.ids.isrc, track.name, track.duration_ms,
 * track.loudness_db, rhythm.bpm, harmony.camelot/note/mode and score.energy /
 * score.danceability. No artist name field exists on the record, so identity
 * is anchored on the exact ISRC plus a title cross-check.
 */
export class MusicaeProvider {
  constructor(apiKey = process.env.RAPIDAPI_KEY, options = {}) {
    this.apiKey = apiKey || null;
    this.name = 'Musicae';
    this.costNotice = 'Free tier limited to 10 req/day; consulted only as tiebreaker or fallback.';
    this.baseUrl = options.baseUrl || 'https://dj-track-audio-analysis-api.p.rapidapi.com';
    this.host = options.host || 'dj-track-audio-analysis-api.p.rapidapi.com';
    this.cache = options.cache || providerCache;
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.cacheTtlSeconds = options.cacheTtlSeconds || 30 * 24 * 3600;
    this.missCacheTtlSeconds = options.missCacheTtlSeconds || 24 * 3600;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
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
    if (cleanIsrc) return `musicae:v1:isrc:${cleanIsrc}`;
    const artist = (typeof queryKey.artist === 'string' ? queryKey.artist : '').toLowerCase().trim();
    const title = (typeof queryKey.title === 'string' ? queryKey.title : '').toLowerCase().trim();
    const version = (typeof queryKey.version === 'string' ? queryKey.version : '').toLowerCase().trim();
    return `musicae:v1:query:${artist}:::${title}:::${version}`;
  }

  _toResult(json) {
    const track = json?.track || {};
    const rhythm = json?.rhythm || {};
    const harmony = json?.harmony || {};
    const score = json?.score || {};
    const camelotParsed = parseKey(harmony.camelot || '');
    const camelot = camelotParsed.camelot && CAMELOT_RE.test(camelotParsed.camelot)
      ? camelotParsed.camelot
      : (parseKey(harmony.note || '').camelot || null);
    const bpm = typeof rhythm.bpm === 'number' && rhythm.bpm > 0 && rhythm.bpm <= 350
      ? Math.round(rhythm.bpm * 10) / 10
      : null;
    if (!bpm || !camelot) return null;
    return {
      provider: this.name,
      bpm,
      key: harmony.note || camelot,
      camelot,
      energy: typeof score.energy === 'number' && score.energy >= 0 && score.energy <= 1
        ? Math.round(score.energy * 100) / 100
        : null,
      loudness: parseSoundNetLoudness(track.loudness_db),
      danceability: typeof score.danceability === 'number' ? score.danceability : null,
      isrc: track.ids?.isrc || null,
      matchedArtist: track.artists?.[0]?.name || null,
      matchedTitle: track.name || null,
      version: null, // ISRC-exact lookup: recording identity comes from the ISRC itself
      durationMs: typeof track.duration_ms === 'number' ? track.duration_ms : null,
      source: 'musicae_isrc',
      confidence: 'provider_api'
    };
  }

  async lookupTrack({ artist, title, isrc, version }) {
    if (!this.isConfigured()) {
      return { success: false, reason: `RapidAPI key not configured. (${this.costNotice})` };
    }
    const cleanIsrc = typeof isrc === 'string' ? isrc.trim().toUpperCase() : '';
    if (!cleanIsrc) {
      return { success: false, reason: 'no_match: Musicae lookups require an ISRC' };
    }

    const queryKey = { artist, title, isrc: cleanIsrc, version };
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
        // Ignore cache read failures so optional enrichment never aborts lookup.
      }
    }

    return await withSingleflight(this._inFlight, flightKey, async () => {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v2/audio-analysis/${encodeURIComponent(cleanIsrc)}`, {
          headers: {
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': this.host,
            'Accept': 'application/json'
          },
          signal: this.requestTimeoutMs > 0 ? AbortSignal.timeout(this.requestTimeoutMs) : undefined
        });

        if (!res.ok) {
          if (res.status === 429) {
            return { success: false, reason: 'Daily quota reached (10 req/day free tier). Resets with the RapidAPI billing day.' };
          }
          if (res.status === 401 || res.status === 403) {
            return { success: false, reason: `provider_http_${res.status} (API key rejected)` };
          }
          if (res.status === 404) {
            const out = { success: false, reason: 'Track not found' };
            if (this.cache && !isProviderCache) {
              try { await this.cache.set(flightKey, out, this.missCacheTtlSeconds); } catch { /* ignore cache errors */ }
            }
            return out;
          }
          return { success: false, reason: `provider_http_${res.status}` };
        }

        const json = await res.json();
        if (!json || !json.track) {
          return { success: false, reason: 'Track not found' };
        }

        const returnedIsrc = typeof json.track.ids?.isrc === 'string' ? json.track.ids.isrc.toUpperCase() : null;
        const exactRecording = returnedIsrc === cleanIsrc;
        const identity = crossCheckTrackIdentity(
          { artist, title, isrc: cleanIsrc, version },
          { artist_name: json.track.artists?.[0]?.name, track_name: json.track.name },
          { skipVersion: exactRecording, requireFields: false }
        );
        if (!identity.ok) {
          const out = { success: false, reason: identity.reason };
          if (this.cache && !isProviderCache) {
            try { await this.cache.set(flightKey, out, this.missCacheTtlSeconds); } catch { /* ignore cache errors */ }
          }
          return out;
        }

        const data = this._toResult(json);
        if (!data) {
          return { success: false, reason: 'Track not found (record lacks usable tempo or key)' };
        }

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
        return { success: false, reason: `provider_unreachable:${err.message}` };
      }
    });
  }
}
