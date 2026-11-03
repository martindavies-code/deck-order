import fs from 'node:fs';
import path from 'node:path';

/**
 * Multi-tier cache for external provider calls & track metadata
 * Ensures zero unnecessary external network calls and safeguards quota.
 */
class ProviderCache {
  constructor(cacheFilePath = './cache/provider_cache.json') {
    this.cacheFilePath = path.resolve(cacheFilePath);
    this.memoryCache = new Map();
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this.memoryCache.set(k, v);
        }
      }
    } catch (err) {
      console.warn('[Cache] Could not load disk cache, starting empty:', err.message);
    }
  }

  saveToDisk() {
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj = Object.fromEntries(this.memoryCache);
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Cache] Could not persist to disk:', err.message);
    }
  }

  buildKey(provider, query) {
    if (query.isrc) {
      return `${provider}:isrc:${query.isrc.trim().toUpperCase()}`;
    }
    const artist = (query.artist || '').toLowerCase().trim();
    const title = (query.title || '').toLowerCase().trim();
    const version = (query.version || '').toLowerCase().trim();
    return `${provider}:query:${artist}:::${title}:::${version}`;
  }

  get(provider, query) {
    const key = this.buildKey(provider, query);
    return this.memoryCache.get(key) || null;
  }

  set(provider, query, data) {
    const key = this.buildKey(provider, query);
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now()
    });
    this.saveToDisk();
  }

  clear() {
    this.memoryCache.clear();
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        fs.unlinkSync(this.cacheFilePath);
      }
    } catch (err) {
      // ignore
    }
  }
}

export const providerCache = new ProviderCache();
