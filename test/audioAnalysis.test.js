import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  downmixToMono,
  selectRepresentativeSlice,
  computeEnergyCurveFromPcm,
  normalizeBpmConfidence,
  formatExtractedFeatures
} from '../client/src/services/audioAnalysisCore.js';

import {
  AUDIO_CACHE_VERSION,
  computeAudioContentHash,
  getAudioFileCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
  clearAudioCache
} from '../client/src/services/audioCache.js';

import {
  parseEmbeddedAudioTags,
  parseAudioFilename,
  splitTitleAndVersion,
  matchAudioFilesToTracks,
  attachAudioAnalysisToTrack,
  buildTrackFromAudioFile
} from '../client/src/services/audioMatcher.js';

import {
  hasValidEnergyCurve,
  getIntroEnergy,
  getOutroEnergy,
  computeTransitionEnergyDelta,
  calculateTransitionCost
} from '../server/core/costMatrix.js';

import {
  VerificationPipeline,
  evaluateTwoSources
} from '../server/core/pipeline.js';

import {
  setSignature,
  validateBackupTracks
} from '../client/src/services/googleAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function buildSyntheticId3v2Buffer({ title, artist, isrc, utf16 = false }) {
  const frames = [];
  function makeTextFrame(id, value) {
    if (!value) return;
    let payload;
    if (utf16) {
      const strBuf = Buffer.from(value, 'utf16le');
      payload = Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), strBuf]);
    } else {
      payload = Buffer.concat([Buffer.from([0x03]), Buffer.from(value, 'utf8')]);
    }
    const header = Buffer.alloc(10);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32BE(payload.length, 4);
    header.writeUInt16BE(0, 8);
    frames.push(header, payload);
  }
  makeTextFrame('TIT2', title);
  makeTextFrame('TPE1', artist);
  makeTextFrame('TSRC', isrc);

  const body = Buffer.concat(frames);
  const tagHeader = Buffer.alloc(10);
  tagHeader.write('ID3', 0, 3, 'ascii');
  tagHeader[3] = 3; // v2.3
  tagHeader[4] = 0;
  tagHeader[5] = 0;
  const size = body.length;
  tagHeader[6] = (size >> 21) & 0x7f;
  tagHeader[7] = (size >> 14) & 0x7f;
  tagHeader[8] = (size >> 7) & 0x7f;
  tagHeader[9] = size & 0x7f;

  const full = Buffer.concat([tagHeader, body, Buffer.alloc(64)]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}

test('embedded ID3v2 parser extracts UTF-8 and UTF-16LE title, artist, and ISRC tags', () => {
  const utf8Buf = buildSyntheticId3v2Buffer({
    title: 'Strobe (Extended Mix)',
    artist: 'deadmau5',
    isrc: 'USUS11000356',
    utf16: false
  });
  const tags8 = parseEmbeddedAudioTags(utf8Buf);
  assert.equal(tags8.title, 'Strobe (Extended Mix)');
  assert.equal(tags8.artist, 'deadmau5');
  assert.equal(tags8.isrc, 'USUS11000356');

  const utf16Buf = buildSyntheticId3v2Buffer({
    title: 'Demo Track 1',
    artist: 'Loopmasters',
    isrc: 'GBAAA2400001',
    utf16: true
  });
  const tags16 = parseEmbeddedAudioTags(utf16Buf);
  assert.equal(tags16.title, 'Demo Track 1');
  assert.equal(tags16.artist, 'Loopmasters');
  assert.equal(tags16.isrc, 'GBAAA2400001');
});

test('filename parser strips track numbers, extensions, and splits Artist - Title cleanly', () => {
  const p1 = parseAudioFilename('01 - Bicep - Glue (Original Mix).flac');
  assert.equal(p1.artist, 'Bicep');
  assert.equal(p1.title, 'Glue (Original Mix)');

  const p2 = parseAudioFilename('04. Four Tet - Baby.mp3');
  assert.equal(p2.artist, 'Four Tet');
  assert.equal(p2.title, 'Baby');

  const p3 = parseAudioFilename('Peggy Gou - (It Goes Like) Nanana (Edit).wav');
  assert.equal(p3.artist, 'Peggy Gou');
  assert.equal(p3.title, '(It Goes Like) Nanana (Edit)');
  const split = splitTitleAndVersion(p3.title);
  assert.equal(split.version, 'Edit');
  assert.equal(split.titleCore, '(It Goes Like) Nanana');
});

test('file-to-track matching: auto-matches exact tracks, separates VIP vs Extended versions, disambiguates by duration, and flags ambiguous/unmatched', () => {
  const tracks = [
    { id: 't1', artist: 'Bicep', title: 'Glue', durationMs: 269000, status: 'unverified' },
    { id: 't2', artist: 'Sub Focus', title: 'Desire (VIP)', durationMs: 215000, status: 'unverified' },
    { id: 't3', artist: 'Sub Focus', title: 'Desire (Extended Mix)', durationMs: 278000, status: 'unverified' },
    { id: 't4', artist: 'Disclosure', title: 'Latch', durationMs: 256000, status: 'unverified' },
    { id: 't5', artist: 'Unmatched Artist', title: 'Missing Song', durationMs: 200000, status: 'unverified' }
  ];

  const analysedFiles = [
    {
      fileId: 'f1',
      fileName: '01 - Bicep - Glue.mp3',
      durationMs: 269200,
      bpm: 130,
      camelot: '4A',
      key: 'F minor',
      energy: 0.72,
      energyCurve: [{ t: 0, energy: 0.4 }, { t: 120, energy: 0.9 }, { t: 250, energy: 0.3 }]
    },
    {
      fileId: 'f2',
      fileName: 'Sub Focus - Desire (Extended Mix).wav',
      durationMs: 278100,
      bpm: 174,
      camelot: '9A',
      key: 'E minor',
      energy: 0.85,
      energyCurve: [{ t: 0, energy: 0.5 }, { t: 200, energy: 0.95 }]
    },
    {
      fileId: 'f3',
      fileName: 'Latch_render_master.wav',
      embeddedTags: { title: 'Latch', artist: '' },
      durationMs: 255500,
      bpm: 122,
      camelot: '4A',
      key: 'F minor',
      energy: 0.65,
      energyCurve: [{ t: 0, energy: 0.5 }, { t: 200, energy: 0.7 }]
    },
    {
      fileId: 'f4',
      fileName: 'Random_Unknown_Loop_128.wav',
      durationMs: 15000,
      bpm: 128,
      camelot: '8A',
      key: 'A minor',
      energy: 0.6,
      energyCurve: [{ t: 0, energy: 0.6 }]
    }
  ];

  const result = matchAudioFilesToTracks(analysedFiles, tracks);

  // f1 -> t1 (autoMatched) and f2 -> t3 (Extended Mix, NOT t2 VIP)
  const autoIds = new Map(result.autoMatched.map((m) => [m.file.fileId, m.trackId]));
  assert.equal(autoIds.get('f1'), 't1');
  assert.equal(autoIds.get('f2'), 't3', 'Extended Mix file must match Extended Mix track and not VIP');

  // f3 has title 'Latch' and matching duration but no artist -> ambiguous candidate for user confirmation
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].file.fileId, 'f3');
  assert.equal(result.ambiguous[0].proposedTrackId, 't4');

  // f4 has no plausible match -> unmatchedFiles
  assert.equal(result.unmatchedFiles.length, 1);
  assert.equal(result.unmatchedFiles[0].file.fileId, 'f4');

  // t2 (VIP), t4 (Latch, only ambiguous), and t5 remain unmatched tracks
  const unmatchedTrackIds = result.unmatchedTracks.map((t) => t.id);
  assert.ok(unmatchedTrackIds.includes('t2'));
  assert.ok(unmatchedTrackIds.includes('t5'));
});

test('key + scale to Camelot conversion across major, minor, sharps, and flats', () => {
  const cases = [
    { key: 'A', scale: 'minor', expectedCamelot: '8A', expectedKey: 'A minor' },
    { key: 'C', scale: 'major', expectedCamelot: '8B', expectedKey: 'C major' },
    { key: 'F#', scale: 'minor', expectedCamelot: '11A', expectedKey: 'F# minor' },
    { key: 'Eb', scale: 'major', expectedCamelot: '5B', expectedKey: 'Eb major' },
    { key: 'Ab', scale: 'minor', expectedCamelot: '1A', expectedKey: 'Ab minor' },
    { key: 'B', scale: 'major', expectedCamelot: '1B', expectedKey: 'B major' },
    { key: 'Db', scale: 'minor', expectedCamelot: '12A', expectedKey: 'Db minor' }
  ];

  for (const c of cases) {
    const out = formatExtractedFeatures({
      rawBpm: 126.0,
      bpmConfidence: 3.2,
      key: c.key,
      scale: c.scale,
      keyStrength: 0.78,
      energy: 0.68,
      energyCurve: [{ t: 0, energy: 0.5 }, { t: 10, energy: 0.8 }],
      durationSec: 210
    });
    assert.equal(out.camelot, c.expectedCamelot, `Failed Camelot for ${c.key} ${c.scale}`);
    assert.equal(out.key, c.expectedKey);
    assert.equal(out.bpm, 126);
    assert.equal(out.confidenceTier, 'high');
  }
});

test('energy curve computation normalizes per-window RMS to 0..1 and derives scalar energy', () => {
  const sampleRate = 1000;
  // 30 seconds: first 10s quiet (amp 0.1), middle 10s loud (amp 0.9), last 10s medium (amp 0.4)
  const pcm = new Float32Array(30 * sampleRate);
  for (let i = 0; i < 10 * sampleRate; i++) pcm[i] = (i % 2 === 0 ? 1 : -1) * 0.1;
  for (let i = 10 * sampleRate; i < 20 * sampleRate; i++) pcm[i] = (i % 2 === 0 ? 1 : -1) * 0.9;
  for (let i = 20 * sampleRate; i < 30 * sampleRate; i++) pcm[i] = (i % 2 === 0 ? 1 : -1) * 0.4;

  const { energyCurve, energy } = computeEnergyCurveFromPcm(pcm, sampleRate, 10);
  assert.equal(energyCurve.length, 3);
  assert.equal(energyCurve[0].t, 0);
  assert.equal(energyCurve[1].t, 10);
  assert.equal(energyCurve[2].t, 20);

  // Peak window (index 1) is normalized to 1.0; first window is lowest; last window is intermediate
  assert.equal(energyCurve[1].energy, 1);
  assert.ok(energyCurve[0].energy < energyCurve[2].energy);
  assert.ok(energyCurve[2].energy < energyCurve[1].energy);
  assert.ok(energy > 0.3 && energy < 0.9);
});

test('costMatrix uses outro-to-intro energyCurve boundary delta when both tracks have curves, and falls back to scalar energy otherwise', () => {
  // Both tracks have identical average scalar energy (0.6), but trackA ends at high energy (0.95)
  // while trackB starts at very low energy (0.15) -> boundary drop of -0.80 (> 0.3 cliff penalty)
  const trackAWithCurve = {
    id: 'a',
    bpm: 126,
    camelot: '8A',
    status: 'analysed',
    energy: 0.6,
    energyCurve: [
      { t: 0, energy: 0.25 },
      { t: 60, energy: 0.60 },
      { t: 120, energy: 0.95 },
      { t: 180, energy: 0.95 }
    ]
  };
  const trackBWithCurve = {
    id: 'b',
    bpm: 126,
    camelot: '8A',
    status: 'analysed',
    energy: 0.6,
    energyCurve: [
      { t: 0, energy: 0.15 },
      { t: 60, energy: 0.15 },
      { t: 120, energy: 0.75 },
      { t: 180, energy: 0.90 }
    ]
  };

  assert.equal(hasValidEnergyCurve(trackAWithCurve), true);
  assert.ok(getOutroEnergy(trackAWithCurve) > 0.85);
  assert.ok(getIntroEnergy(trackBWithCurve) < 0.25);

  const deltaCurve = computeTransitionEnergyDelta(trackAWithCurve, trackBWithCurve);
  assert.ok(deltaCurve < -0.5, `Expected steep negative boundary delta, got ${deltaCurve}`);

  const costWithCurves = calculateTransitionCost(trackAWithCurve, trackBWithCurve);
  assert.ok(costWithCurves.energyCost >= 6, 'Steep outro-to-intro cliff should trigger energy cliff penalty');

  // If trackB lacks energyCurve, fall back to scalar energy (0.6 - 0.6 = 0 -> penalty 0)
  const trackBScalarOnly = {
    id: 'b2',
    bpm: 126,
    camelot: '8A',
    status: 'single_source',
    energy: 0.6
  };
  const deltaFallback = computeTransitionEnergyDelta(trackAWithCurve, trackBScalarOnly);
  assert.equal(deltaFallback, 0);
  const costScalarFallback = calculateTransitionCost(trackAWithCurve, trackBScalarOnly);
  assert.equal(costScalarFallback.energyCost, 0);
});

test('IndexedDB / memory audio cache hashes content deterministically and invalidates on version bump', async () => {
  await clearAudioCache();
  const bytesA = new Uint8Array(4096);
  for (let i = 0; i < bytesA.length; i++) bytesA[i] = (i * 31) & 0xff;

  const hash1 = computeAudioContentHash(bytesA.byteLength, bytesA, AUDIO_CACHE_VERSION);
  const hash2 = computeAudioContentHash(bytesA.byteLength, bytesA, AUDIO_CACHE_VERSION);
  assert.equal(hash1, hash2, 'Same bytes and version must yield identical cache key');

  const hashNewVer = computeAudioContentHash(bytesA.byteLength, bytesA, AUDIO_CACHE_VERSION + 1);
  assert.notEqual(hash1, hashNewVer, 'Version bump must invalidate cache key');

  const key = await getAudioFileCacheKey(bytesA.buffer, AUDIO_CACHE_VERSION);
  assert.equal(await getCachedAnalysis(key), null);

  const sampleEntry = {
    bpm: 128,
    rawBpm: 128,
    workingBpm: 128,
    camelot: '8A',
    key: 'A minor',
    energy: 0.74,
    energyCurve: [{ t: 0, energy: 0.5 }, { t: 10, energy: 0.9 }],
    durationMs: 180000
  };
  await setCachedAnalysis(key, sampleEntry);
  const loaded = await getCachedAnalysis(key);
  assert.equal(loaded.bpm, 128);
  assert.equal(loaded.camelot, '8A');
  assert.equal(loaded.energyCurve.length, 2);
});

test('VerificationPipeline with audio_analysis: alone -> analysed, agreeing provider -> corroborated keeping audio values, disagreeing provider or CSV -> disputed', async () => {
  const baseAudioFile = {
    fileId: 'audio-1',
    fileName: 'Bicep - Glue.wav',
    bpm: 130,
    rawBpm: 130,
    workingBpm: 130,
    bpmConfidence: 3.8,
    confidenceTier: 'high',
    key: 'F minor',
    camelot: '4A',
    energy: 0.76,
    energyCurve: [{ t: 0, energy: 0.4 }, { t: 60, energy: 0.9 }, { t: 180, energy: 0.5 }],
    durationMs: 269000
  };

  const unconfigured = { isConfigured: () => false, lookupTrack: async () => ({ success: false }) };
  function createMockPipeline(freqblogOverride = unconfigured) {
    const p = new VerificationPipeline();
    p.getSongBPM = unconfigured;
    p.sonovault = unconfigured;
    p.soundNet = unconfigured;
    p.freqblog = freqblogOverride;
    p.musicae = unconfigured;
    return p;
  }

  // 1. Audio analysis alone (no catalogue hits) -> status 'analysed'
  const pipelineNoCatalogue = createMockPipeline();
  const trackAlone = attachAudioAnalysisToTrack(
    { id: 't1', artist: 'Bicep', title: 'Glue', status: 'unverified', sources: [] },
    baseAudioFile
  );
  const resAlone = await pipelineNoCatalogue.processTrack(trackAlone);
  assert.equal(resAlone.status, 'analysed');
  assert.equal(resAlone.source, 'audio_analysis');
  assert.equal(resAlone.bpm, 130);
  assert.equal(resAlone.camelot, '4A');
  assert.equal(resAlone.energyCurve.length, 3);

  const reportAlone = pipelineNoCatalogue.generateCoverageReport([resAlone]);
  assert.equal(reportAlone.analysed, 1);
  assert.equal(reportAlone.unverified, 0, 'analysed track must not be counted as unverified');

  // 2. Audio analysis + agreeing catalogue provider -> status 'verified' (client 'corroborated'), keeping audio's exact BPM/key/energy
  const pipelineAgreeing = createMockPipeline({
    isConfigured: () => true,
    lookupTrack: async () => ({
      success: true,
      data: {
        provider: 'FreqBlog',
        bpm: 130.8, // within 2% tolerance of 130
        key: 'F minor',
        camelot: '4A',
        energy: 0.55 // different scalar energy, audio should win
      }
    })
  });
  const trackAgree = attachAudioAnalysisToTrack(
    { id: 't2', artist: 'Bicep', title: 'Glue', status: 'unverified', sources: [] },
    baseAudioFile
  );
  const resAgree = await pipelineAgreeing.processTrack(trackAgree);
  assert.equal(resAgree.status, 'verified');
  assert.equal(resAgree.source, 'audio_analysis');
  assert.equal(resAgree.bpm, 130, 'Audio Analysis exact BPM must be kept over catalogue rounding');
  assert.equal(resAgree.energy, 0.76, 'Audio Analysis energy must be kept');

  // 3. Audio analysis + disagreeing catalogue provider -> status 'disputed', keeping audio's working values as sourceA
  const pipelineDisagreeing = createMockPipeline({
    isConfigured: () => true,
    lookupTrack: async () => ({
      success: true,
      data: {
        provider: 'FreqBlog',
        bpm: 140, // >2% disagreement
        key: 'A minor',
        camelot: '8A'
      }
    })
  });
  const trackDisagree = attachAudioAnalysisToTrack(
    { id: 't3', artist: 'Bicep', title: 'Glue', status: 'unverified', sources: [] },
    baseAudioFile
  );
  const resDisagree = await pipelineDisagreeing.processTrack(trackDisagree);
  assert.equal(resDisagree.status, 'disputed');
  assert.equal(resDisagree.bpm, 130, 'Audio working BPM stays default when disputed');
  assert.equal(resDisagree.camelot, '4A', 'Audio working Camelot stays default when disputed');
  assert.equal(resDisagree.disputeDetails.sourceA.provider, 'Audio Analysis');
  assert.equal(resDisagree.disputeDetails.sourceB.provider, 'FreqBlog');
  assert.ok(resDisagree.disputeDetails.disputeReasons.length >= 2);

  // 4. Audio analysis + disagreeing Manual CSV (no catalogue hit) -> status 'disputed'
  const trackCsvDisagree = attachAudioAnalysisToTrack(
    {
      id: 't4',
      artist: 'Bicep',
      title: 'Glue',
      bpm: 122,
      camelot: '9A',
      source: 'manual_csv',
      status: 'supplied',
      sources: [{ name: 'Manual CSV', provider: 'Manual CSV', bpm: 122, camelot: '9A', key: 'E minor' }]
    },
    baseAudioFile
  );
  const resCsvDisagree = await pipelineNoCatalogue.processTrack(trackCsvDisagree);
  assert.equal(resCsvDisagree.status, 'disputed', 'Audio disagreeing with CSV-supplied values must surface dispute');
  assert.equal(resCsvDisagree.bpm, 130);
  assert.equal(resCsvDisagree.disputeDetails.sourceA.provider, 'Audio Analysis');
  assert.equal(resCsvDisagree.disputeDetails.sourceB.provider, 'Manual CSV');

  // 5. Regression check: manual_csv alone still does NOT count as catalogue evidence
  const csvOnlyTrack = {
    id: 't5',
    artist: 'Some Artist',
    title: 'CSV Track',
    bpm: 125,
    camelot: '8A',
    source: 'manual_csv',
    status: 'verified',
    sources: [{ name: 'Manual CSV', bpm: 125, camelot: '8A' }]
  };
  const resCsvOnly = await pipelineNoCatalogue.processTrack(csvOnlyTrack);
  assert.equal(resCsvOnly.status, 'supplied');
  assert.notEqual(resCsvOnly.status, 'analysed');
  assert.notEqual(resCsvOnly.status, 'single_source');
});

test('saved-set persistence preserves source, status: analysed, and energyCurve across validateBackupTracks and setSignature', () => {
  const track = buildTrackFromAudioFile({
    fileId: 'f-persist',
    fileName: 'Four Tet - Baby.wav',
    bpm: 126,
    rawBpm: 126,
    workingBpm: 126,
    key: 'A minor',
    camelot: '8A',
    energy: 0.71,
    energyCurve: [{ t: 0, energy: 0.35 }, { t: 60, energy: 0.88 }],
    durationMs: 240000
  });

  const validated = validateBackupTracks([track]);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].status, 'analysed');
  assert.equal(validated[0].source, 'audio_analysis');
  assert.equal(validated[0].energyCurve.length, 2);

  const sigBefore = setSignature('My Set', [track]);
  const sigWithoutCurve = setSignature('My Set', [{ ...track, energyCurve: undefined }]);
  assert.notEqual(sigBefore, sigWithoutCurve, 'setSignature must reflect energyCurve presence');
});

test('real Essentia.js WASM extraction runs in Node and extracts BPM, Camelot key, and energyCurve', async () => {
  const { runEssentiaExtraction } = await import('../client/src/workers/essentiaWorker.js');

  // Synthesize 12 seconds of 44.1kHz mono audio with a clear 128 BPM kick pulse + A minor (220 Hz / 261.63 Hz / 329.63 Hz) pad
  const sampleRate = 44100;
  const durationSec = 12;
  const totalSamples = sampleRate * durationSec;
  const pcm = new Float32Array(totalSamples);
  const beatIntervalSec = 60 / 128; // 0.46875s

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const beatPhase = (t % beatIntervalSec) / beatIntervalSec;
    // Percussive transient at start of each beat
    const env = beatPhase < 0.12 ? Math.exp(-beatPhase * 35) : 0;
    const kick = env * Math.sin(2 * Math.PI * 65 * t) * 0.85;
    // A minor triad harmonic bed
    const padGain = t < 6 ? 0.15 : 0.35; // second half louder so energyCurve has variation
    const pad =
      padGain *
      (Math.sin(2 * Math.PI * 220 * t) +
        0.7 * Math.sin(2 * Math.PI * 261.63 * t) +
        0.7 * Math.sin(2 * Math.PI * 329.63 * t));
    pcm[i] = Math.max(-1, Math.min(1, kick + pad));
  }

  const extracted = await runEssentiaExtraction(pcm, sampleRate, durationSec);
  assert.ok(extracted.bpm >= 125 && extracted.bpm <= 131, `Expected ~128 BPM, got ${extracted.bpm}`);
  assert.ok(extracted.camelot, `Expected valid Camelot code, got ${extracted.camelot}`);
  assert.ok(Array.isArray(extracted.energyCurve) && extracted.energyCurve.length >= 2);
  assert.ok(extracted.energy > 0 && extracted.energy <= 1);
});

test('privacy invariant: audio analysis modules contain zero network calls (no fetch, XHR, sendBeacon, or WebSocket)', () => {
  const audioModules = [
    'client/src/services/audioAnalysisCore.js',
    'client/src/services/audioCache.js',
    'client/src/services/audioMatcher.js',
    'client/src/services/localAudioService.js',
    'client/src/workers/essentiaWorker.js'
  ];

  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bsendBeacon\b/,
    /\bnew\s+WebSocket\b/
  ];

  for (const relPath of audioModules) {
    const fullPath = path.join(REPO_ROOT, relPath);
    const src = fs.readFileSync(fullPath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(src),
        false,
        `Forbidden network call matching ${pattern} found in ${relPath}`
      );
    }
  }
});
