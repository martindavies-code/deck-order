import fs from 'node:fs';
import path from 'node:path';

/**
 * Bounded LRU Cache with Atomic File Persistence
 * - Enforces strict capacity limits to eliminate memory leaks.
 * - Writes to disk atomically via temporary file replacement to prevent corruption.
 */
export class ProviderCache {
  constructor(options = {}) {
    this.cacheFilePath = path.resolve(options.cacheFilePath || './cache/provider_cache.json');
    this.maxCapacity = options.maxCapacity || 5000;
    this.memoryCache = new Map();
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          if (this.memoryCache.size < this.maxCapacity) {
            this.memoryCache.set(k, v);
          }
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

      // Atomic persistence: write to temp file then rename
      const tempPath = `${this.cacheFilePath}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
      const obj = Object.fromEntries(this.memoryCache);
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(tempPath, this.cacheFilePath);
    } catch (err) {
      console.warn('[Cache] Could not persist to disk atomically:', err.message);
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
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    // Refresh LRU position by re-inserting
    this.memoryCache.delete(key);
    this.memoryCache.set(key, entry);
    return entry;
  }

  set(provider, query, data) {
    const key = this.buildKey(provider, query);

    // Evict oldest entry if at capacity
    if (this.memoryCache.size >= this.maxCapacity && !this.memoryCache.has(key)) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(key, {
      data,
      timestamp: Date.now()
    });
    this.saveToDisk();
  }

  size() {
    return this.memoryCache.size;
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
