import { parseKey } from '../../../server/core/camelot.js';

export const TARGET_SAMPLE_RATE = 44100;
export const DEFAULT_ENERGY_WINDOW_SEC = 10;
export const MAX_RHYTHM_SLICE_SEC = 60;

/**
 * Normalizes half-time (< 90 BPM) or double-time (> 180 BPM) tempo into the
 * working DJ range while preserving rawBpm.
 */
export function normalizeTempo(rawBpm, minBpm = 90, maxBpm = 180) {
  if (!rawBpm || typeof rawBpm !== 'number' || rawBpm <= 0) {
    return { rawBpm: null, workingBpm: null, isNormalized: false };
  }
  let working = rawBpm;
  let isNormalized = false;
  if (working < minBpm && working * 2 <= maxBpm) {
    working = Math.round(working * 2 * 10) / 10;
    isNormalized = true;
  } else if (working > maxBpm && working / 2 >= minBpm) {
    working = Math.round((working / 2) * 10) / 10;
    isNormalized = true;
  }
  return { rawBpm, workingBpm: working, isNormalized };
}

/**
 * Downmixes one or more channel Float32Arrays to mono and resamples to
 * targetSampleRate (default 44100 Hz) using linear interpolation when the
 * hardware AudioContext sampleRate differs (e.g. 48000 Hz on Windows WASAPI).
 */
export function downmixToMono(channelArrays, sourceSampleRate = TARGET_SAMPLE_RATE, targetSampleRate = TARGET_SAMPLE_RATE) {
  if (!Array.isArray(channelArrays) || channelArrays.length === 0) {
    return new Float32Array(0);
  }
  const length = channelArrays[0]?.length || 0;
  if (length === 0) return new Float32Array(0);

  let mono;
  if (channelArrays.length === 1) {
    mono = channelArrays[0] instanceof Float32Array
      ? channelArrays[0]
      : Float32Array.from(channelArrays[0]);
  } else {
    mono = new Float32Array(length);
    const numChannels = channelArrays.length;
    const inv = 1 / numChannels;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = channelArrays[ch];
      for (let i = 0; i < length; i++) {
        mono[i] += (data[i] || 0) * inv;
      }
    }
  }

  if (!sourceSampleRate || !targetSampleRate || sourceSampleRate === targetSampleRate) {
    return mono;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outLength = Math.max(1, Math.round(length / ratio));
  const resampled = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    resampled[i] = mono[idx0] * (1 - frac) + mono[idx1] * frac;
  }
  return resampled;
}

/**
 * Selects a representative contiguous slice of mono PCM (up to maxSeconds) for
 * rhythm & key extraction so beatless intros/outros on 6-8 minute club mixes
 * do not skew tempo/key estimation and worker runtime stays fast.
 * Full-track energy curve is still computed over 100% of monoPcm.
 */
export function selectRepresentativeSlice(monoPcm, sampleRate = TARGET_SAMPLE_RATE, maxSeconds = MAX_RHYTHM_SLICE_SEC) {
  if (!(monoPcm instanceof Float32Array) || monoPcm.length === 0) {
    return new Float32Array(0);
  }
  const maxSamples = Math.floor(sampleRate * maxSeconds);
  if (monoPcm.length <= maxSamples) {
    return monoPcm;
  }

  // Search candidate windows inside [15%, 85%] of the track by highest RMS energy
  const startBound = Math.floor(monoPcm.length * 0.15);
  const endBound = Math.max(startBound + maxSamples, Math.floor(monoPcm.length * 0.85));
  const stepSamples = Math.max(sampleRate * 5, Math.floor((endBound - startBound - maxSamples) / 8));

  let bestStart = startBound;
  let bestEnergy = -1;

  for (let offset = startBound; offset + maxSamples <= endBound; offset += stepSamples) {
    let sumSq = 0;
    // Stride by 16 samples for fast energy estimation
    for (let i = offset; i < offset + maxSamples; i += 16) {
      const v = monoPcm[i];
      sumSq += v * v;
    }
    if (sumSq > bestEnergy) {
      bestEnergy = sumSq;
      bestStart = offset;
    }
  }

  return monoPcm.subarray(bestStart, Math.min(monoPcm.length, bestStart + maxSamples));
}

/**
 * Computes a per-section energy curve [{ t, energy }] over fixed windows and a
 * derived whole-track scalar energy (0..1) from mono PCM samples.
 *
 * Uses a blend of absolute perceptual loudness (dBFS relative to full scale)
 * and intra-track relative contrast so both overall track intensity and
 * intro/peak/outro dynamics are faithfully represented in [0, 1].
 */
export function computeEnergyCurveFromPcm(monoPcm, sampleRate = TARGET_SAMPLE_RATE, windowSec = DEFAULT_ENERGY_WINDOW_SEC) {
  if (!monoPcm || monoPcm.length === 0 || !sampleRate || sampleRate <= 0) {
    return { energyCurve: [], energy: null };
  }

  const totalSec = monoPcm.length / sampleRate;
  // Ensure at least 2 windows even on very short audio clips (< 2 * windowSec)
  const effectiveWindowSec = totalSec < windowSec * 2
    ? Math.max(0.5, totalSec / Math.max(2, Math.min(8, Math.ceil(totalSec))))
    : windowSec;
  const windowSamples = Math.max(1, Math.round(effectiveWindowSec * sampleRate));

  const rawWindows = [];
  let maxRms = 0;
  let minRms = Infinity;

  for (let start = 0; start < monoPcm.length; start += windowSamples) {
    const end = Math.min(monoPcm.length, start + windowSamples);
    const count = end - start;
    // Ignore tiny trailing fragments (< 25% of a window) if we already have >= 4 windows
    if (count < windowSamples * 0.25 && rawWindows.length >= 4) {
      break;
    }
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = monoPcm[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / count);
    if (rms > maxRms) maxRms = rms;
    if (rms < minRms) minRms = rms;
    rawWindows.push({
      t: Math.round((start / sampleRate) * 10) / 10,
      rms
    });
  }

  if (rawWindows.length === 0 || maxRms <= 1e-7) {
    const silentCurve = rawWindows.map(w => ({ t: w.t, energy: 0 }));
    return { energyCurve: silentCurve, energy: 0 };
  }

  // Convert each window's RMS into [0, 1] combining:
  // - Absolute dBFS mapping (-42 dBFS -> 0, -3 dBFS -> 1)
  // - Relative track dynamic range (minRms..maxRms -> 0..1) when dynamic range is meaningful
  const dynSpan = maxRms - minRms;
  const hasDynamicContrast = dynSpan > maxRms * 0.08;

  let energySum = 0;
  const energyCurve = rawWindows.map(w => {
    const db = 20 * Math.log10(Math.max(w.rms, 1e-6));
    const absNorm = Math.min(1, Math.max(0, (db + 42) / 39));
    const relNorm = hasDynamicContrast
      ? Math.min(1, Math.max(0, (w.rms - minRms) / dynSpan))
      : absNorm;
    const blended = hasDynamicContrast ? (absNorm * 0.55 + relNorm * 0.45) : absNorm;
    const energy = Math.round(Math.min(1, Math.max(0, blended)) * 1000) / 1000;
    energySum += energy;
    return { t: w.t, energy };
  });

  // Whole-track scalar energy weighted toward the main body (excluding quietest 20% windows)
  const sortedEnergies = energyCurve.map(pt => pt.energy).sort((a, b) => a - b);
  const trimStart = sortedEnergies.length >= 5 ? Math.floor(sortedEnergies.length * 0.2) : 0;
  const activeSlice = sortedEnergies.slice(trimStart);
  const scalarEnergy = activeSlice.length > 0
    ? Math.round((activeSlice.reduce((a, b) => a + b, 0) / activeSlice.length) * 100) / 100
    : Math.round((energySum / energyCurve.length) * 100) / 100;

  return {
    energyCurve,
    energy: scalarEnergy
  };
}

/**
 * Normalizes Essentia RhythmExtractor2013 multifeature confidence (0..~5.3)
 * into a 0..1 score and a discrete confidence tier.
 */
export function normalizeBpmConfidence(rawConfidence) {
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence) || rawConfidence <= 0) {
    return { score: 0, tier: 'low' };
  }
  const score = Math.round(Math.min(1, Math.max(0, rawConfidence / 3.5)) * 100) / 100;
  const tier = score >= 0.65 ? 'high' : score >= 0.35 ? 'medium' : 'low';
  return { score, tier };
}

/**
 * Formats raw Essentia extraction output + energy curve into Deck Order's
 * canonical analysis object using parseKey and normalizeTempo.
 */
export function formatExtractedFeatures({
  bpm,
  rawBpm: inputRawBpm,
  bpmConfidence = 0,
  key = null,
  scale = null,
  keyStrength = 0,
  energyCurve = [],
  energy = null,
  durationSec = 0
}) {
  const effectiveBpm = bpm ?? inputRawBpm;
  const rawBpm = typeof effectiveBpm === 'number' && Number.isFinite(effectiveBpm) && effectiveBpm > 0
    ? Math.round(effectiveBpm * 10) / 10
    : null;
  const norm = rawBpm ? normalizeTempo(rawBpm) : { rawBpm: null, workingBpm: null, isNormalized: false };
  const rawKeyStr = key && scale ? `${key} ${scale}` : (key || null);
  const parsedKey = rawKeyStr ? parseKey(key, scale) : { camelot: null, pitch: null, mode: null };
  const camelot = parsedKey?.camelot || null;
  const formattedKey = rawKeyStr || (parsedKey?.pitch && parsedKey?.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : null);
  const conf = normalizeBpmConfidence(bpmConfidence);
  const roundedKeyStrength = typeof keyStrength === 'number' && Number.isFinite(keyStrength)
    ? Math.round(Math.min(1, Math.max(0, keyStrength)) * 100) / 100
    : null;
  const validDurationSec = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
    ? Math.round(durationSec * 10) / 10
    : null;
  const durationMs = validDurationSec ? Math.round(validDurationSec * 1000) : null;

  return {
    bpm: rawBpm,
    rawBpm,
    workingBpm: norm.workingBpm || rawBpm,
    isNormalized: norm.isNormalized,
    bpmConfidence: conf.score,
    confidenceTier: conf.tier,
    key: formattedKey,
    camelot,
    keyStrength: roundedKeyStrength,
    energy: typeof energy === 'number' && Number.isFinite(energy) ? energy : null,
    energyCurve: Array.isArray(energyCurve) ? energyCurve : [],
    durationSec: validDurationSec,
    durationMs
  };
}
