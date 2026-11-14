import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';
import { crossCheckTrackIdentity, withSingleflight } from './matchGuard.js';

const CAMELOT_RE = /^([1-9]|1[0-2])[AB]$/;

/**
 * Sonovault API client (https://sonovault.now)
 * Powered by Lexicon DJ's analysis engines.
 * Free tier: 1,000 requests/month, 20 req/min burst, no credit card required.
 * Paid tiers exist from ~EUR 29/month - NEVER auto-upgrade.
 *
 * Real API shape (verified against the live service 2026-11-14):
 *   Base: https://api.sonovault.now/v1
 *   Auth: x-api-key request header
 *   GET /tracks/isrc/:isrc           exact-recording lookup
 *   GET /tracks/search?artist=&title=  name search (returns { results: [...] })
 * Records carry bpm, key_alphanumeric (already Camelot), key_musical
 * (e.g. "Cm"), isrc, duration (seconds), artists[] and releases[].
 * No energy/loudness fields exist on the service.
 */
export class SonovaultProvider {
  constructor(apiKey = process.env.SONOVAULT_API_KEY, options = {}) {
    this.apiKey = apiKey || null;
    this.name = 'Sonovault';
    this.baseUrl = options.baseUrl || 'https://api.sonovault.now/v1';
    this.cache = options.cache || providerCache;
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
    this._inFlight = new Map();
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async _call(pathAndQuery) {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        signal: this.requestTimeoutMs > 0 ? AbortSignal.timeout(this.requestTimeoutMs) : undefined
      });
    } catch (err) {
      return { success: false, reason: `provider_unreachable:${err.message}` };
    }
    if (!res.ok) {
      if (res.status === 429) {
        return { success: false, reason: 'Monthly free quota or burst limit reached (1,000 req/month, 20 req/min). Paid tiers start at ~EUR 29/mo.' };
      }
      if (res.status === 401 || res.status === 403) {
        return { success: false, reason: `provider_http_${res.status} (API key rejected)` };
      }
      return { success: false, reason: `provider_http_${res.status}` };
    }
    try {
      return { success: true, json: await res.json() };
    } catch {
      return { success: false, reason: 'provider_bad_json' };
    }
  }

  /**
   * Maps a Sonovault track record to the pipeline's source shape.
   * Returns null when the record lacks a usable tempo or key.
   */
  _toResult(rec, source) {
    const camelotParsed = parseKey(rec.key_alphanumeric || '');
    const camelot = camelotParsed.camelot && CAMELOT_RE.test(camelotParsed.camelot)
      ? camelotParsed.camelot
      : null;
    const bpm = typeof rec.bpm === 'number' && rec.bpm > 0 && rec.bpm <= 350
      ? Math.round(rec.bpm * 10) / 10
      : null;
    if (!bpm || !camelot) return null;
    const primary = Array.isArray(rec.artists)
      ? (rec.artists.find(a => a && a.is_primary) || rec.artists[0])
      : null;
    return {
      provider: this.name,
      bpm,
      key: rec.key_musical || camelot,
      camelot,
      energy: null, // Sonovault does not provide energy or loudness
      isrc: rec.isrc || null,
      matchedArtist: primary?.name || null,
      matchedTitle: rec.title || null,
      version: null, // mix/version info is embedded in the record title
      durationMs: typeof rec.duration === 'number' ? rec.duration * 1000 : null,
      source: source || 'sonovault_api',
      confidence: 'provider_api'
    };
  }

  async lookupTrack({ artist, title, isrc, version }) {
    if (!this.isConfigured()) {
      return { success: false, reason: 'API key not configured' };
    }

    const queryKey = { artist, title, isrc, version };
    const cached = this.cache.get(this.name, queryKey);
    if (cached) {
      return { success: true, data: cached.data, cached: true };
    }

    const flightKey = this.cache.buildKey(this.name, queryKey);
    return await withSingleflight(this._inFlight, flightKey, async () => {
      // 1) Exact-recording path when an ISRC is available.
      if (isrc && typeof isrc === 'string' && isrc.trim()) {
        const r = await this._call(`/tracks/isrc/${encodeURIComponent(isrc.trim().toUpperCase())}`);
        if (r.success && r.json && r.json.bpm) {
          const exactRecording = typeof r.json.isrc === 'string' && r.json.isrc.toUpperCase() === isrc.trim().toUpperCase();
          const identity = crossCheckTrackIdentity(
            { artist, title, isrc, version },
            { artist_name: r.json.artists?.find(a => a && a.is_primary)?.name || r.json.artists?.[0]?.name, track_name: r.json.title },
            { skipVersion: exactRecording, requireFields: false }
          );
          if (identity.ok) {
            const data = this._toResult(r.json, 'sonovault_isrc');
            if (data) {
              this.cache.set(this.name, queryKey, data);
              return { success: true, data, cached: false };
            }
          }
          // Identity veto or unusable record: fall through to name search.
        } else if (!r.success && r.reason && !/^provider_http_404/.test(r.reason)) {
          // Hard failures (quota, unreachable, 5xx) abort the lookup; a 404
          // just means the ISRC is unknown and the name search may still hit.
          return r;
        }
      }

      // 2) Name search.
      const q = `/tracks/search?artist=${encodeURIComponent(artist || '')}&title=${encodeURIComponent(title || '')}`;
      const r = await this._call(q);
      if (!r.success) return r;
      const results = Array.isArray(r.json?.results) ? r.json.results : [];
      if (!results.length) {
        return { success: false, reason: 'Track not found' };
      }

      for (const rec of results) {
        const identity = crossCheckTrackIdentity(
          { artist, title, isrc, version },
          { artist_name: rec.artists?.find(a => a && a.is_primary)?.name || rec.artists?.[0]?.name, track_name: rec.title },
          { requireFields: true }
        );
        if (!identity.ok) continue;
        const data = this._toResult(rec, 'sonovault_search');
        if (data) {
          this.cache.set(this.name, queryKey, data);
          return { success: true, data, cached: false };
        }
      }
      return { success: false, reason: 'Identity cross-check rejected search candidates' };
    });
  }
}
