let fs = null;
let path = null;
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  ({ default: fs } = await import('node:fs'));
  ({ default: path } = await import('node:path'));
}

/**
 * Bounded LRU Cache with Atomic File Persistence
 * - Enforces strict capacity limits to eliminate memory leaks.
 * - Writes to disk atomically via temporary file replacement to prevent corruption.
 */
export class ProviderCache {
  constructor(options = {}) {
    const shouldPersist = options.persistToDisk !== false && options.cacheFilePath !== null;
    this.cacheFilePath = (shouldPersist && path) ? path.resolve(options.cacheFilePath || './cache/provider_cache.json') : null;
    this.maxCapacity = options.maxCapacity || 5000;
    this.memoryCache = new Map();
    this.loadFromDisk();
  }

  loadFromDisk() {
    if (!fs || !this.cacheFilePath) return;
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
    if (!fs || !this.cacheFilePath) return;
    let tempPath = null;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic persistence: write to temp file then rename
      tempPath = `${this.cacheFilePath}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
      const obj = Object.fromEntries(this.memoryCache);
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(tempPath, this.cacheFilePath);
      tempPath = null;
    } catch (err) {
      console.warn('[Cache] Could not persist to disk atomically:', err.message);
    } finally {
      if (tempPath) {
        try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  buildKey(provider, query) {
    if (!query || typeof query !== 'object') {
      return `${provider || 'unknown'}:invalid`;
    }
    const cleanIsrc = typeof query.isrc === 'string' ? query.isrc.trim().toUpperCase() : '';
    if (cleanIsrc) {
      return `${provider}:isrc:${cleanIsrc}`;
    }
    const artist = (typeof query.artist === 'string' ? query.artist : '').toLowerCase().trim();
    const rawTitle = typeof query.title === 'string' ? query.title : (typeof query.name === 'string' ? query.name : '');
    const title = rawTitle.toLowerCase().trim();
    const version = (typeof query.version === 'string' ? query.version : '').toLowerCase().trim();
    return `${provider}:query:${artist}:::${title}:::${version}`;
  }

  get(provider, query) {
    const key = this.buildKey(provider, query);
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (typeof entry.expiresAt === 'number' && Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    // Refresh LRU position by re-inserting
    this.memoryCache.delete(key);
    this.memoryCache.set(key, entry);
    return entry;
  }

  set(provider, query, data, ttlSeconds = null) {
    const key = this.buildKey(provider, query);

    // Evict oldest entry if at capacity
    if (this.memoryCache.size >= this.maxCapacity && !this.memoryCache.has(key)) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    const now = Date.now();
    const entry = { data, timestamp: now };
    if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
      entry.expiresAt = now + ttlSeconds * 1000;
    }

    this.memoryCache.set(key, entry);
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
