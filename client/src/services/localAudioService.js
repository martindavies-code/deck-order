import { TARGET_SAMPLE_RATE, downmixToMono } from './audioAnalysisCore.js';
import {
  getAudioFileCacheKey,
  getCachedAnalysis,
  setCachedAnalysis
} from './audioCache.js';
import {
  parseEmbeddedAudioTags,
  extractAudioFileIdentity
} from './audioMatcher.js';

let sharedWorker = null;
let nextRequestId = 1;
const pendingRequests = new Map();
let sharedAudioCtx = null;

function getOrCreateWorker() {
  if (sharedWorker) return sharedWorker;
  if (typeof Worker === 'undefined') return null;

  const worker = new Worker(
    new URL('../workers/essentiaWorker.js', import.meta.url),
    { type: 'module' }
  );

  worker.addEventListener('message', (event) => {
    const { id, ok, result, error } = event.data || {};
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error || 'Audio worker extraction failed'));
    }
  });

  worker.addEventListener('error', (err) => {
    for (const [, pending] of pendingRequests.entries()) {
      pending.reject(new Error(err?.message || 'Audio worker crashed'));
    }
    pendingRequests.clear();
    sharedWorker = null;
  });

  sharedWorker = worker;
  return sharedWorker;
}

export function terminateAudioWorker() {
  if (sharedWorker) {
    sharedWorker.terminate();
    sharedWorker = null;
  }
  for (const [, pending] of pendingRequests.entries()) {
    pending.reject(new Error('Audio analysis cancelled.'));
  }
  pendingRequests.clear();
}

async function runExtractionInWorker(monoPcm, sampleRate, durationSec) {
  const worker = getOrCreateWorker();
  if (!worker) {
    // Fallback for Node test environments where Web Worker is not present
    const { runEssentiaExtraction } = await import('../workers/essentiaWorker.js');
    return runEssentiaExtraction(monoPcm, sampleRate, durationSec);
  }

  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    // Transfer the underlying ArrayBuffer to the worker (zero-copy)
    const transferable = monoPcm.buffer.byteLength === monoPcm.byteLength
      ? monoPcm
      : monoPcm.slice();
    worker.postMessage(
      {
        id,
        type: 'ANALYSE_PCM',
        monoPcm: transferable,
        sampleRate,
        durationSec
      },
      [transferable.buffer]
    );
  });
}

function getAudioContext() {
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    return sharedAudioCtx;
  }
  const Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
  if (!Ctor) return null;
  sharedAudioCtx = new Ctor();
  return sharedAudioCtx;
}

/**
 * Decodes an audio file ArrayBuffer using the browser's native Web Audio API
 * and downmixes/resamples to 44.1 kHz mono Float32Array.
 */
export async function decodeAudioBufferToMono(arrayBuffer) {
  const audioCtx = getAudioContext();
  if (!audioCtx) {
    throw new Error('Web Audio API is not supported in this browser environment.');
  }

  // decodeAudioData detaches its input buffer in some browsers, so pass a slice if needed
  const bufferCopy = arrayBuffer.slice(0);
  const decoded = await audioCtx.decodeAudioData(bufferCopy);
  const numChannels = decoded.numberOfChannels || 1;
  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(decoded.getChannelData(c));
  }

  const monoPcm = downmixToMono(channels, decoded.sampleRate, TARGET_SAMPLE_RATE);
  return {
    monoPcm,
    sampleRate: TARGET_SAMPLE_RATE,
    durationSec: decoded.duration
  };
}

/**
 * Analyses a single File object (checking IndexedDB cache first, then decoding
 * via Web Audio API and extracting BPM/key/energyCurve in the Essentia Web Worker).
 */
export async function analyseAudioFile(file, options = {}) {
  if (!file) {
    return {
      ok: false,
      status: 'unsupported',
      fileName: 'Unknown file',
      error: 'No file provided.'
    };
  }

  const fileName = file.name || 'Untitled Audio';
  const fileSize = typeof file.size === 'number' ? file.size : 0;

  if (fileSize === 0) {
    return {
      ok: false,
      status: 'unsupported',
      fileName,
      fileSize: 0,
      error: 'File is empty (0 bytes).'
    };
  }

  try {
    const cacheKey = await getAudioFileCacheKey(file);
    if (!options.skipCache) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached && cached.bpm && cached.camelot) {
        const identity = extractAudioFileIdentity({
          fileName,
          embeddedTags: cached.embeddedTags || null
        });
        return {
          ok: true,
          status: 'analysed',
          cached: true,
          cacheKey,
          fileName,
          fileSize,
          ...cached,
          identity
        };
      }
    }

    const arrayBuffer = typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();

    const embeddedTags = parseEmbeddedAudioTags(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 262144)));
    const identity = extractAudioFileIdentity({ fileName, embeddedTags });

    const decodeFn = options.decodeFn || decodeAudioBufferToMono;
    let decoded;
    try {
      decoded = await decodeFn(arrayBuffer, file);
    } catch {
      return {
        ok: false,
        status: 'unsupported',
        fileName,
        fileSize,
        identity,
        error: 'Unsupported format or undecodable audio stream (supported: MP3, WAV, FLAC, AIFF, M4A/AAC).'
      };
    }

    if (!decoded?.monoPcm || decoded.monoPcm.length === 0) {
      return {
        ok: false,
        status: 'unsupported',
        fileName,
        fileSize,
        identity,
        error: 'Decoded audio contained 0 samples.'
      };
    }

    const extracted = await runExtractionInWorker(
      decoded.monoPcm,
      decoded.sampleRate || TARGET_SAMPLE_RATE,
      decoded.durationSec || 0
    );

    const fullRecord = {
      ...extracted,
      embeddedTags
    };

    await setCachedAnalysis(cacheKey, fullRecord);

    return {
      ok: true,
      status: 'analysed',
      cached: false,
      cacheKey,
      fileName,
      fileSize,
      ...fullRecord,
      identity
    };
  } catch (err) {
    return {
      ok: false,
      status: 'unsupported',
      fileName,
      fileSize,
      error: err?.message || 'Failed to analyse audio file.'
    };
  }
}

/**
 * Analyses a batch of local audio files sequentially with per-file progress
 * callbacks and cancellation support via AbortSignal.
 */
export async function analyseAudioBatch(files, { onProgress, signal, decodeFn, skipCache = false } = {}) {
  const fileList = Array.from(files || []);
  const results = [];
  const succeeded = [];
  const unsupported = [];
  let cachedCount = 0;
  let cancelled = false;

  const onAbort = () => terminateAudioWorker();
  if (signal) {
    if (signal.aborted) {
      terminateAudioWorker();
      return { results, succeeded, unsupported, cachedCount, cancelled: true };
    }
    signal.addEventListener?.('abort', onAbort, { once: true });
  }

  try {
    for (let i = 0; i < fileList.length; i++) {
      if (signal?.aborted) {
        cancelled = true;
        terminateAudioWorker();
        break;
      }

      const file = fileList[i];
      onProgress?.({
        stage: 'audio',
        phase: 'analysing',
        current: i + 1,
        total: fileList.length,
        fileName: file.name || `File ${i + 1}`,
        completedCount: i,
        cachedCount,
        unsupportedCount: unsupported.length
      });

      const res = await analyseAudioFile(file, { decodeFn, skipCache });
      if (signal?.aborted) {
        cancelled = true;
        terminateAudioWorker();
        break;
      }

      results.push(res);
      if (res.ok) {
        succeeded.push(res);
        if (res.cached) cachedCount++;
      } else {
        unsupported.push(res);
      }

      onProgress?.({
        stage: 'audio',
        phase: res.ok ? (res.cached ? 'cached' : 'done') : 'unsupported',
        current: i + 1,
        total: fileList.length,
        fileName: file.name || `File ${i + 1}`,
        completedCount: i + 1,
        cachedCount,
        unsupportedCount: unsupported.length,
        lastResult: res
      });
    }
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }

  return {
    results,
    succeeded,
    unsupported,
    cachedCount,
    cancelled
  };
}
