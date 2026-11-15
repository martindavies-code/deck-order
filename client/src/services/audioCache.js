export const AUDIO_CACHE_VERSION = 'essentia_v1';
const DB_NAME = 'deck_order_audio_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'analyses';
const SAMPLE_CHUNK_BYTES = 16384; // 16 KB x 3 (head, mid, tail) = 48 KB max sampled for cache key

// In-memory mirror/fallback so cache hits work in Node tests and restricted contexts
const memoryCache = new Map();

/**
 * Pure deterministic content hash over file size, sampled byte array (head/mid/tail),
 * and the analysis pipeline version tag. Changing version invalidates old entries.
 */
export function computeAudioContentHash(fileSize, sampledBytes, version = AUDIO_CACHE_VERSION) {
  const safeSize = typeof fileSize === 'number' && Number.isFinite(fileSize) && fileSize >= 0
    ? Math.floor(fileSize)
    : 0;
  const bytes = sampledBytes instanceof Uint8Array
    ? sampledBytes
    : (sampledBytes instanceof ArrayBuffer ? new Uint8Array(sampledBytes) : new Uint8Array(0));

  // Dual 32-bit FNV-1a accumulators for a 64-bit collision-resistant digest
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  const mixByte = (b) => {
    h1 ^= b & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ((b & 0xff) ^ 0x5a);
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  };

  // Mix file size into hash
  mixByte(safeSize & 0xff);
  mixByte((safeSize >>> 8) & 0xff);
  mixByte((safeSize >>> 16) & 0xff);
  mixByte((safeSize >>> 24) & 0xff);

  for (let i = 0; i < bytes.length; i++) {
    mixByte(bytes[i]);
  }

  const hex1 = h1.toString(16).padStart(8, '0');
  const hex2 = h2.toString(16).padStart(8, '0');
  return `${version}:${safeSize}:${hex1}${hex2}`;
}

/**
 * Samples up to 48 KB (head, middle, tail) from a File/Blob or ArrayBuffer/Uint8Array
 * so cache lookup never needs to read or decode a full 60 MB WAV/FLAC file on hit.
 */
export async function sampleFileBytes(input) {
  if (!input) return new Uint8Array(0);

  if (input instanceof Uint8Array) {
    return sampleFromUint8(input);
  }
  if (input instanceof ArrayBuffer) {
    return sampleFromUint8(new Uint8Array(input));
  }

  const size = typeof input.size === 'number' ? input.size : 0;
  if (size <= 0) return new Uint8Array(0);

  if (typeof input.slice === 'function') {
    if (size <= SAMPLE_CHUNK_BYTES * 3) {
      const buf = await readBlobAsArrayBuffer(input);
      return new Uint8Array(buf);
    }
    const midOffset = Math.floor((size - SAMPLE_CHUNK_BYTES) / 2);
    const tailOffset = Math.max(0, size - SAMPLE_CHUNK_BYTES);
    const [headBuf, midBuf, tailBuf] = await Promise.all([
      readBlobAsArrayBuffer(input.slice(0, SAMPLE_CHUNK_BYTES)),
      readBlobAsArrayBuffer(input.slice(midOffset, midOffset + SAMPLE_CHUNK_BYTES)),
      readBlobAsArrayBuffer(input.slice(tailOffset, size))
    ]);
    const head = new Uint8Array(headBuf);
    const mid = new Uint8Array(midBuf);
    const tail = new Uint8Array(tailBuf);
    const combined = new Uint8Array(head.length + mid.length + tail.length);
    combined.set(head, 0);
    combined.set(mid, head.length);
    combined.set(tail, head.length + mid.length);
    return combined;
  }

  if (typeof input.arrayBuffer === 'function') {
    const buf = await input.arrayBuffer();
    return sampleFromUint8(new Uint8Array(buf));
  }

  return new Uint8Array(0);
}

function sampleFromUint8(u8) {
  if (u8.length <= SAMPLE_CHUNK_BYTES * 3) {
    return u8;
  }
  const midOffset = Math.floor((u8.length - SAMPLE_CHUNK_BYTES) / 2);
  const tailOffset = Math.max(0, u8.length - SAMPLE_CHUNK_BYTES);
  const combined = new Uint8Array(SAMPLE_CHUNK_BYTES * 3);
  combined.set(u8.subarray(0, SAMPLE_CHUNK_BYTES), 0);
  combined.set(u8.subarray(midOffset, midOffset + SAMPLE_CHUNK_BYTES), SAMPLE_CHUNK_BYTES);
  combined.set(u8.subarray(tailOffset, u8.length), SAMPLE_CHUNK_BYTES * 2);
  return combined;
}

function readBlobAsArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file slice'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function getAudioFileCacheKey(fileOrBuffer, version = AUDIO_CACHE_VERSION) {
  const size = typeof fileOrBuffer?.size === 'number'
    ? fileOrBuffer.size
    : (fileOrBuffer?.byteLength ?? fileOrBuffer?.length ?? 0);
  const sampled = await sampleFileBytes(fileOrBuffer);
  return computeAudioContentHash(size, sampled, version);
}

function openCacheDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedAnalysis(cacheKey) {
  if (!cacheKey) return null;
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }
  const db = await openCacheDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => {
        const val = req.result ? req.result.data : null;
        if (val) memoryCache.set(cacheKey, val);
        resolve(val || null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedAnalysis(cacheKey, analysisData) {
  if (!cacheKey || !analysisData) return false;
  const payload = {
    bpm: analysisData.bpm ?? null,
    rawBpm: analysisData.rawBpm ?? analysisData.bpm ?? null,
    workingBpm: analysisData.workingBpm ?? analysisData.bpm ?? null,
    isNormalized: Boolean(analysisData.isNormalized),
    bpmConfidence: analysisData.bpmConfidence ?? null,
    confidenceTier: analysisData.confidenceTier ?? null,
    key: analysisData.key ?? null,
    camelot: analysisData.camelot ?? null,
    keyStrength: analysisData.keyStrength ?? null,
    energy: analysisData.energy ?? null,
    energyCurve: Array.isArray(analysisData.energyCurve) ? analysisData.energyCurve : [],
    durationMs: analysisData.durationMs ?? null,
    durationSec: analysisData.durationSec ?? null,
    embeddedTags: analysisData.embeddedTags ?? null,
    cachedAt: Date.now()
  };

  memoryCache.set(cacheKey, payload);
  const db = await openCacheDb();
  if (!db) return true;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ cacheKey, data: payload, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function clearAudioCache() {
  memoryCache.clear();
  const db = await openCacheDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
