import { parseKey } from '../core/camelot.js';
import {
  normalizeText as norm,
  titleCore,
  versionTokens,
  crossCheckTrackIdentity,
  withSingleflight
} from './matchGuard.js';

const DEFAULT_BASE = 'https://api.freqblog.com';
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i;
const TRANSIENT_REASON_RE = /^(provider_unreachable:|provider_http_429$|provider_http_5\d{2}$|provider_monthly_quota_exhausted$|provider_bad_json$|analysis_queued_or_missing$)/;

function isTransientOutcome(out) {
  return !out?.success && TRANSIENT_REASON_RE.test(out?.reason || '');
}

/**
 * Search term for provider queries. A separate version tag is search evidence
 * too: the catalogue indexes mix names, so a bare-title search can only ever
 * return the primary record (e.g. the original mix), which the version
 * cross-check then rightly rejects. Appending the version text makes the
 * matching mix record reachable; every cross-check still applies to the
 * result. Skipped when the title already carries the distinguishing tokens
 * (e.g. Spotify-style "Title - Remix Edit" names) to avoid double decoration.
 */
function withVersion(title, version) {
  const t = norm(title);
  const missing = versionTokens(version || '').filter(tok => !t.includes(tok));
  return missing.length ? `${title} (${version})` : title;
}

/**
 * FreqBlog music metadata provider (https://api.freqblog.com).
 * Returns raw provider values plus match provenance; the pipeline's
 * normalizeTempo marks (never silently rewrites) octave normalization.
 */
export class FreqBlogProvider {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey || null;
    this.baseUrl = options.baseUrl || DEFAULT_BASE;
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.cache = options.cache || null;               // { async get(k), async set(k, v, ttlSeconds) }
    this.reserveQuota = options.reserveQuota || null; // async (n) => boolean
    this.cacheTtlSeconds = options.cacheTtlSeconds || 30 * 24 * 3600;
    this.missCacheTtlSeconds = options.missCacheTtlSeconds || 24 * 3600;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 25000;
    this._inFlight = new Map();                       // In-flight singleflight request deduplication
  }

  isConfigured() { return Boolean(this.apiKey); }

  async _call(pathAndQuery, body = null) {
    if (this.reserveQuota) {
      const ok = await this.reserveQuota(1);
      if (!ok) return { success: false, reason: 'provider_monthly_quota_exhausted' };
    }
    let res;
    try {
      const init = {
        headers: { 'X-Api-Key': this.apiKey },
        signal: this.requestTimeoutMs > 0 ? AbortSignal.timeout(this.requestTimeoutMs) : undefined
      };
      if (body) {
        init.method = 'POST';
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      res = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, init);
    } catch (err) {
      return { success: false, reason: `provider_unreachable:${err.message}` };
    }
    if (!res.ok) return { success: false, reason: `provider_http_${res.status}` };
    try {
      return { success: true, json: await res.json() };
    } catch {
      return { success: false, reason: 'provider_bad_json' };
    }
  }

  _crossCheck(query, rec, { skipVersion = false } = {}) {
    return crossCheckTrackIdentity(query, rec, { skipVersion, requireFields: true });
  }

  _toResult(rec, source) {
    const parsedKey = parseKey(rec.key || '');
    const camelot = rec.camelot || parsedKey.camelot || null;
    const bpm = typeof rec.bpm === 'number' && rec.bpm > 0 ? Math.round(rec.bpm * 10) / 10 : null;
    if (!bpm || !camelot) return null;
    return {
      provider: 'FreqBlog',
      bpm,
      key: rec.key || (parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : null),
      camelot,
      energy: typeof rec.energy === 'number' ? rec.energy : null,
      isrc: rec.isrc || null,
      matchedArtist: rec.artist_name || null,
      matchedTitle: rec.track_name || null,
      mixName: rec.mix_name || null,
      // Expose the matched record's version so cross-source version
      // comparison (detectVersionMismatch) sees the real tag, not just the
      // query's. Null when the catalogue record has no version tag.
      version: rec.mix_name || null,
      source: source || rec.source || 'freqblog_catalog',
      bpmConfidence: typeof rec.bpm_confidence === 'number' ? rec.bpm_confidence : null,
      keyConfidence: typeof rec.key_confidence === 'number' ? rec.key_confidence : null,
      confidence: 'single_source'
    };
  }

  async lookupTrack(query) {
    if (!this.isConfigured()) return { success: false, reason: 'API key not configured' };
    // Include a separate version tag in the search terms (see withVersion):
    // it only widens WHICH records the search can reach; it never relaxes the
    // cross-checks applied to whatever comes back.
    const searchTitle = withVersion(query.title, query.version);
    // Only version-decorated searches changed behavior: they use a fresh v3
    // key so misses cached before this fix cannot mask it. Every unchanged
    // query shape keeps its v2 key and its safe cached entries.
    const cacheKey = `freqblog:${searchTitle !== query.title ? 'v3' : 'v2'}:${norm(query.artist)}|${titleCore(query.title)}|${(query.isrc || '').toUpperCase()}|${norm(query.version)}`;
    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit && !isTransientOutcome(hit)) return hit;
    }

    return await withSingleflight(this._inFlight, cacheKey, async () => {
      let result = null;
      let lastReason = 'no_match';

      // 1) ISRC exact-identifier path via /bulk (when present), then artist/title/version cross-check
      if (query.isrc && ISRC_RE.test(query.isrc)) {
        const item = { track: searchTitle, artist: query.artist, isrc: query.isrc.toUpperCase() };
        const r = await this._call('/bulk', [item]);
        const row = r.success && r.json && Array.isArray(r.json.results) ? r.json.results[0] : null;
        const rec = row && row.found ? row.result : null;
        // The version veto is skipped ONLY when the provider record carries the
        // exact same ISRC as the query: an identical recording identifier proves
        // this IS the requested recording, so missing mix metadata on the
        // catalogue record must not veto it. A different/absent record ISRC
        // keeps the full conservative cross-check, including version.
        const exactRecording = Boolean(
          rec && typeof rec.isrc === 'string' && rec.isrc.toUpperCase() === query.isrc.toUpperCase()
        );
        if (rec && rec.bpm) {
          const check = this._crossCheck(query, rec, { skipVersion: exactRecording });
          if (check.ok) {
            result = this._toResult(rec, 'freqblog_isrc_bulk');
          } else {
            lastReason = check.reason;
          }
        }
      }

      // 2) Name search with inline on-demand analysis wait
      if (!result) {
        const q = `/lookup?track=${encodeURIComponent(searchTitle)}&artist=${encodeURIComponent(query.artist)}&wait=15`;
        const r = await this._call(q);
        if (!r.success) {
          lastReason = r.reason;
        } else if (r.json && r.json.bpm) {
          const check = this._crossCheck(query, r.json);
          if (check.ok) result = this._toResult(r.json, r.json.source || 'freqblog_lookup');
          else lastReason = check.reason;
        } else {
          lastReason = 'analysis_queued_or_missing';
        }
      }

      const out = result ? { success: true, data: result } : { success: false, reason: lastReason };
      // Never poison persistent cache with transient network/5xx/quota errors or queued analysis.
      if (this.cache && !isTransientOutcome(out)) {
        const ttl = out.success ? this.cacheTtlSeconds : this.missCacheTtlSeconds;
        await this.cache.set(cacheKey, out, ttl);
      }
      return out;
    });
  }
}
