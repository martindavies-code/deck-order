import { providerCache } from './cache.js';
import { parseKey } from '../core/camelot.js';

/**
 * SoundNet Track Analysis API (RapidAPI)
 * Provides key, mode, tempo, camelot, energy, danceability, happiness, loudness.
 * Free tier: only 5 requests/day (evaluation only).
 * Usable tiers start at USD 9.99/month.
 * STRICT: DO NOT auto-sign up. Requires explicit user opt-in and manual key provision.
 */
export class SoundNetProvider {
  constructor(apiKey = process.env.SOUNDNET_API_KEY) {
    this.apiKey = apiKey || null;
    this.name = 'SoundNet';
    this.costNotice = 'Free tier limited to 5 req/day. Paid tier starts at $9.99/month.';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async lookupTrack({ artist, title, isrc, version }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        reason: `SoundNet API key not configured. (${this.costNotice})`
      };
    }

    const queryKey = { artist, title, isrc, version };
    const cached = providerCache.get(this.name, queryKey);
    if (cached) {
      return { success: true, data: cached.data, cached: true };
    }

    try {
      const url = new URL('https://soundnet.p.rapidapi.com/analyze');
      url.searchParams.set('artist', artist);
      url.searchParams.set('title', title);

      const res = await fetch(url.toString(), {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'soundnet.p.rapidapi.com',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        if (res.status === 429) {
          return { success: false, reason: 'Daily quota reached (5 req/day limit on free tier). Paid tier: $9.99/mo.' };
        }
        return { success: false, reason: `HTTP ${res.status}` };
      }

      const json = await res.json();
      const rawTempo = parseFloat(json.tempo || json.bpm);
      const rawKey = json.key;
      const rawMode = json.mode; // 'major' | 'minor'
      const parsedKey = parseKey(rawKey, rawMode);

      const data = {
        provider: this.name,
        bpm: !isNaN(rawTempo) && rawTempo > 0 ? Math.round(rawTempo * 10) / 10 : null,
        rawKey: rawKey || null,
        camelot: parsedKey.camelot,
        key: parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : (parsedKey.camelot || rawKey),
        energy: typeof json.energy === 'number' ? Math.round(json.energy * 100) / 100 : null,
        danceability: typeof json.danceability === 'number' ? json.danceability : null,
        confidence: 'provider_api'
      };

      providerCache.set(this.name, queryKey, data);
      return { success: true, data, cached: false };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }
}
