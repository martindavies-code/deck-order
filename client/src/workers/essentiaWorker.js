import {
  TARGET_SAMPLE_RATE,
  selectRepresentativeSlice,
  computeEnergyCurveFromPcm,
  formatExtractedFeatures
} from '../services/audioAnalysisCore.js';

let essentiaInstance = null;
let initPromise = null;

async function getEssentia() {
  if (essentiaInstance) return essentiaInstance;
  if (!initPromise) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.__dirname === 'undefined') {
      globalThis.__dirname = '.';
    }
    initPromise = Promise.all([
      import('essentia.js/dist/essentia-wasm.es.js'),
      import('essentia.js/dist/essentia.js-core.es.js')
    ]).then(([wasmMod, coreMod]) => {
      const EssentiaWASM = wasmMod.EssentiaWASM || wasmMod.default?.EssentiaWASM || wasmMod.default;
      const Essentia = coreMod.default || coreMod.Essentia || coreMod;
      essentiaInstance = new Essentia(EssentiaWASM);
      return essentiaInstance;
    });
  }
  return initPromise;
}

export async function runEssentiaExtraction(monoPcm, sampleRate = TARGET_SAMPLE_RATE, durationSec = 0) {
  const essentia = await getEssentia();
  const effectiveDurationSec = durationSec > 0
    ? durationSec
    : (monoPcm.length / (sampleRate || TARGET_SAMPLE_RATE));

  // 1. Compute full-track per-section energy curve (0..1) and whole-track scalar energy
  const { energyCurve, energy } = computeEnergyCurveFromPcm(monoPcm, sampleRate);

  // 2. Select representative active slice (up to 60s) for rhythm & harmonic extraction
  const slice = selectRepresentativeSlice(monoPcm, sampleRate);
  const signalVec = essentia.arrayToVector(slice);

  let bpm = null;
  let bpmConfidence = 0;
  let key = null;
  let scale = null;
  let keyStrength = 0;

  try {
    // Use RhythmExtractor2013 multifeature when slice is at least 3 seconds long
    if (slice.length >= sampleRate * 3) {
      const rhythm = essentia.RhythmExtractor2013(signalVec, 208, 'multifeature', 50);
      bpm = rhythm?.bpm ?? null;
      bpmConfidence = rhythm?.confidence ?? 0;
      if (typeof rhythm?.ticks?.delete === 'function') rhythm.ticks.delete();
      if (typeof rhythm?.estimates?.delete === 'function') rhythm.estimates.delete();
      if (typeof rhythm?.bpmIntervals?.delete === 'function') rhythm.bpmIntervals.delete();
    }

    // Fallback to PercivalBpmEstimator for very short clips or if RhythmExtractor2013 returned 0
    if (!bpm || !Number.isFinite(bpm) || bpm <= 0) {
      const percival = essentia.PercivalBpmEstimator(
        signalVec, 1024, 2048, 128, 128, 210, 50, sampleRate
      );
      bpm = percival?.bpm ?? null;
      bpmConfidence = bpm ? 1.8 : 0;
    }

    // Extract musical key & scale using EDMA profile (Electronic Dance Music)
    const keyRes = essentia.KeyExtractor(
      signalVec,
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      'edma',
      sampleRate
    );
    key = keyRes?.key || null;
    scale = keyRes?.scale || null;
    keyStrength = keyRes?.strength ?? 0;
  } finally {
    if (typeof signalVec?.delete === 'function') {
      signalVec.delete();
    }
  }

  return formatExtractedFeatures({
    bpm,
    bpmConfidence,
    key,
    scale,
    keyStrength,
    energyCurve,
    energy,
    durationSec: effectiveDurationSec
  });
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async (event) => {
    const { id, type, monoPcm, sampleRate, durationSec } = event.data || {};
    if (type !== 'ANALYSE_PCM') return;

    try {
      const pcm = monoPcm instanceof Float32Array ? monoPcm : new Float32Array(monoPcm || 0);
      const result = await runEssentiaExtraction(pcm, sampleRate || TARGET_SAMPLE_RATE, durationSec || 0);
      self.postMessage({ id, ok: true, result });
    } catch (err) {
      self.postMessage({
        id,
        ok: false,
        error: err?.message || 'Audio analysis worker failed to extract features.'
      });
    }
  });
}
