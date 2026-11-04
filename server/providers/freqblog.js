import { parseKey } from '../core/camelot.js';

const DEFAULT_BASE = 'https://api.freqblog.com';
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i;
// Version words that carry no remix/edit identity on their own.
const GENERIC_VERSION_TOKENS = new Set(['mix', 'edit', 'remix', 'extended', 'club', 'original', 'radio', 'dub', 'version', 'feat', 'featuring', 'the', 'a', 'of']);

function norm(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function titleCore(s) {
  return norm((s || '').split('(')[0]);
}
function versionTokens(s) {
  return norm(s).split(' ').filter(t => t && !GENERIC_VERSION_TOKENS.has(t));
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
  }

  isConfigured() { return Boolean(this.apiKey); }

  async _call(pathAndQuery, body = null) {
    if (this.reserveQuota) {
      const ok = await this.reserveQuota(1);
      if (!ok) return { success: false, reason: 'provider_monthly_quota_exhausted' };
    }
    let res;
    try {
      const init = { headers: { 'X-Api-Key': this.apiKey } };
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

  _crossCheck(query, rec) {
    const artistToken = norm(query.artist).split(' ')[0];
    const gotArtist = norm(rec.artist_name);
    if (!artistToken || !gotArtist.includes(artistToken)) {
      return { ok: false, reason: `artist_mismatch: wanted "${query.artist}", provider has "${rec.artist_name}"` };
    }
    const wantTitle = titleCore(query.title);
    const gotTitle = titleCore(rec.track_name);
    if (!wantTitle || !(gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) {
      return { ok: false, reason: `title_mismatch: wanted "${query.title}", provider has "${rec.track_name}"` };
    }
    const wantVersion = versionTokens(query.version || '');
    if (wantVersion.length) {
      const hay = `${norm(rec.mix_name)} ${norm(rec.remixer)} ${norm(rec.track_name)}`;
      const missing = wantVersion.filter(t => !hay.includes(t));
      if (missing.length) {
        return { ok: false, reason: `version_mismatch: wanted "${query.version}", provider has "${rec.mix_name || rec.track_name}"` };
      }
    }
    return { ok: true };
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
    const cacheKey = `freqblog:${norm(query.artist)}|${titleCore(query.title)}|${(query.isrc || '').toUpperCase()}|${norm(query.version)}`;
    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) return hit;
    }

    let result = null;
    let lastReason = 'no_match';

    // 1) ISRC exact-identifier path via /bulk (when present), then artist/title/version cross-check
    if (query.isrc && ISRC_RE.test(query.isrc)) {
      const item = { track: query.title, artist: query.artist, isrc: query.isrc.toUpperCase() };
      const r = await this._call('/bulk', [item]);
      const row = r.success && r.json && Array.isArray(r.json.results) ? r.json.results[0] : null;
      const rec = row && row.found ? row.result : null;
      if (rec && rec.bpm && this._crossCheck(query, rec).ok) {
        result = this._toResult(rec, 'freqblog_isrc_bulk');
      } else if (rec && rec.bpm) {
        lastReason = this._crossCheck(query, rec).reason;
      }
    }

    // 2) Name search with inline on-demand analysis wait
    if (!result) {
      const q = `/lookup?track=${encodeURIComponent(query.title)}&artist=${encodeURIComponent(query.artist)}&wait=15`;
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
    if (this.cache) await this.cache.set(cacheKey, out, this.cacheTtlSeconds);
    return out;
  }
}
