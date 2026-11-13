import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';
import { crossCheckTrackIdentity, withSingleflight } from './matchGuard.js';

/**
 * Sonovault API client (https://sonovault.now)
 * Powered by Lexicon DJ's analysis engines.
 * Free tier: 1,000 requests/month, no credit card required.
 * Paid tiers exist from ~EUR 29/month - NEVER auto-upgrade.
 */
export class SonovaultProvider {
  constructor(apiKey = process.env.SONOVAULT_API_KEY, options = {}) {
    this.apiKey = apiKey || null;
    this.name = 'Sonovault';
    this.baseUrl = 'https://sonovault.now/api/v1';
    this.cache = options.cache || providerCache;
    this._inFlight = new Map();
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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
      try {
        const url = new URL(`${this.baseUrl}/tracks/lookup`);
        if (isrc) url.searchParams.set('isrc', isrc);
        url.searchParams.set('artist', artist);
        url.searchParams.set('title', title);
        if (version) url.searchParams.set('version', version);

        const res = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) {
          if (res.status === 429) {
            return { success: false, reason: 'Monthly free quota exhausted (1,000 req limit). Paid tiers start at ~EUR 29/mo.' };
          }
          return { success: false, reason: `HTTP ${res.status}` };
        }

        const json = await res.json();
        if (!json || (!json.bpm && !json.tempo && !json.key)) {
          return { success: false, reason: 'Track not found' };
        }

        const exactIsrcMatch = Boolean(isrc && typeof json.isrc === 'string' && json.isrc.toUpperCase() === isrc.toUpperCase());
        const identity = crossCheckTrackIdentity(
          { artist, title, isrc, version },
          json,
          { skipVersion: exactIsrcMatch, requireFields: false }
        );
        if (!identity.ok) {
          return { success: false, reason: identity.reason };
        }

        const rawTempo = parseFloat(json.bpm || json.tempo);
        const rawKey = json.key || json.musical_key;
        const parsedKey = parseKey(rawKey);

        const data = {
          provider: this.name,
          bpm: !isNaN(rawTempo) && rawTempo > 0 && rawTempo <= 350 ? Math.round(rawTempo * 10) / 10 : null,
          rawKey: rawKey || null,
          camelot: parsedKey.camelot,
          key: parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : (parsedKey.camelot || rawKey),
          energy: typeof json.energy === 'number' && json.energy >= 0 && json.energy <= 1 ? json.energy : null,
          // Preserve only the provider's observed ISRC; never echo the query ISRC as proof.
          isrc: json.isrc || null,
          confidence: 'provider_api'
        };

        this.cache.set(this.name, queryKey, data);
        return { success: true, data, cached: false };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });
  }
}
