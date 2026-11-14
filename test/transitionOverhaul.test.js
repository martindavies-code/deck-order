import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTransitionCost, evaluateSequence } from '../server/core/costMatrix.js';
import { DJSequencer } from '../server/core/solver.js';
import { evaluateHarmonicTransition } from '../server/core/camelot.js';
import { evaluateCurrentOrder } from '../client/src/services/clientSequencer.js';
import { transitionDisplay } from '../client/src/utils/trackBadges.js';
import { buildMixRecipe, recommendMixSetting, PHRASE_GUIDANCE, MIX_CAVEAT } from '../client/src/utils/mixRecipe.js';
import { SoundNetProvider, parseSoundNetLoudness } from '../server/providers/soundnet.js';
import { VerificationPipeline } from '../server/core/pipeline.js';
import { parseTracklistCSV } from '../server/providers/csvParser.js';
import { SuggestionEngine } from '../server/core/bridgeFinder.js';
import worker, { QuotaCounter } from '../worker/src/index.js';

function createWorkerTestEnv(overrides = {}) {
  const kvStore = new Map();
  const doMap = new Map();
  const counter = new QuotaCounter({
    storage: {
      async transaction(fn) { return await fn(); },
      async get(keys) {
        const res = new Map();
        for (const k of keys) if (doMap.has(k)) res.set(k, doMap.get(k));
        return res;
      },
      async put(entries) {
        for (const [k, v] of Object.entries(entries)) doMap.set(k, v);
      }
    }
  }, {});
  return {
    FREQBLOG_API_KEY: 'fb-key',
    FREQBLOG_KV: {
      async get(k, type) {
        const raw = kvStore.get(k);
        if (!raw) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(k, v) { kvStore.set(k, v); }
    },
    QUOTA: {
      idFromName: (n) => n,
      get: () => ({ fetch: (req, init) => counter.fetch(req instanceof Request ? req : new Request(req, init)) })
    },
    ...overrides,
    _kvStore: kvStore
  };
}

describe('Deck Order Transition-Quality Overhaul', () => {
  test('Tempo cost tiers match un-synced renderer tolerances and >2% never grades SMOOTH', () => {
    const base = { id: 'a', artist: 'A', title: 'Base', bpm: 125, camelot: '8A', status: 'verified' };

    // <= 0.8% -> cost 0, SMOOTH
    const t08 = calculateTransitionCost(base, { id: 'b1', artist: 'B', title: '0.8%', bpm: 126, camelot: '8A' });
    assert.equal(t08.tempoCost, 0);
    assert.equal(t08.grade, 'SMOOTH');

    // <= 1.6% -> cost 1, SMOOTH (harmonic 0 + tempo 1 = 1)
    const t16 = calculateTransitionCost(base, { id: 'b2', artist: 'B', title: '1.6%', bpm: 127, camelot: '8A' });
    assert.equal(t16.tempoCost, 1);
    assert.equal(t16.grade, 'SMOOTH');

    // 1.6% < diff <= 3.0% -> cost 4, STRETCH (never SMOOTH even on same key)
    const t24 = calculateTransitionCost(base, { id: 'b3', artist: 'B', title: '2.4%', bpm: 128, camelot: '8A' });
    assert.equal(t24.tempoCost, 4);
    assert.equal(t24.grade, 'STRETCH');
    assert.notEqual(t24.grade, 'SMOOTH');

    // 3.0% < diff <= 5.0% -> cost 8, CLASH
    const t40 = calculateTransitionCost(base, { id: 'b4', artist: 'B', title: '4.0%', bpm: 130, camelot: '8A' });
    assert.equal(t40.tempoCost, 8);
    assert.equal(t40.grade, 'CLASH');

    // > 5.0% -> cost 16, CLASH
    const t56 = calculateTransitionCost(base, { id: 'b5', artist: 'B', title: '5.6%', bpm: 132, camelot: '8A' });
    assert.equal(t56.tempoCost, 16);
    assert.equal(t56.grade, 'CLASH');

    // Boundary check just over 2%: even with +0 harmonic cost, > 2% cannot grade SMOOTH
    const t21 = calculateTransitionCost(base, { id: 'b6', artist: 'B', title: '2.08%', bpm: 127.6, camelot: '8A' });
    assert.ok(t21.tempoDiffPct > 2.0);
    assert.notEqual(t21.grade, 'SMOOTH');
  });

  test('Per-transition beat-drift metric computes |bpmB - bpmA| / bpmA * blendBeats and hides on unconfirmed tracks', () => {
    const a = { id: 'a', artist: 'A', title: 'A', bpm: 125, camelot: '8A' };
    const b = { id: 'b', artist: 'B', title: 'B', bpm: 128.75, camelot: '8A' }; // exactly 3.0% diff

    const tr = calculateTransitionCost(a, b);
    assert.equal(tr.blendBeats, 64);
    assert.equal(tr.driftFraction, 0.03);
    assert.equal(tr.driftBeats, 1.9); // 0.03 * 64 = 1.92 -> 1.9 beats

    const customBlend = calculateTransitionCost(a, b, { blendBeats: 32 });
    assert.equal(customBlend.driftBeats, 1.0); // 0.03 * 32 = 0.96 -> 1.0 beat

    const td = transitionDisplay(tr, a, b);
    assert.equal(td.driftLabel, '~1.9 beats drift / 16b');

    const flagged = { ...b, recordingNeedsReview: true };
    const trFlagged = calculateTransitionCost(a, flagged);
    assert.equal(trFlagged.driftBeats, null);
    assert.equal(transitionDisplay(trFlagged, a, flagged).driftLabel, null);
  });

  test('Energy-aware costing defaults ON when both tracks carry energy and labels +2 Camelot as Energy boost', () => {
    const seqDefault = new DJSequencer({ seed: 42 });
    assert.equal(seqDefault.enableEnergy, true);

    const high = { id: '1', artist: 'A', title: 'High', bpm: 126, camelot: '8A', energy: 0.9, status: 'verified' };
    const low = { id: '2', artist: 'B', title: 'Low', bpm: 126, camelot: '10A', energy: 0.3, status: 'verified' };
    const noEnergy = { id: '3', artist: 'C', title: 'NoEnergy', bpm: 126, camelot: '8A', status: 'verified' };

    const withEnergyOn = calculateTransitionCost(high, low);
    assert.ok(withEnergyOn.energyCost > 0, 'energy drop cost applies by default when both tracks carry real energy');

    const withEnergyOff = calculateTransitionCost(high, low, { enableEnergy: false });
    assert.equal(withEnergyOff.energyCost, 0);

    const partialEnergy = calculateTransitionCost(high, noEnergy);
    assert.equal(partialEnergy.energyCost, 0, 'energy cost stays 0 when either track lacks real energy');

    const evalDefault = evaluateCurrentOrder([high, low]);
    assert.ok(evalDefault.transitions[0].energyCost > 0);
    const evalDisabled = evaluateCurrentOrder([high, low], { enableEnergy: false });
    assert.equal(evalDisabled.transitions[0].energyCost, 0);

    const plusTwo = evaluateHarmonicTransition('8A', '10A');
    assert.match(plusTwo.relation, /\+2 energy boost/);
    assert.match(plusTwo.relation, /two steps up/);
    assert.equal(transitionDisplay(plusTwo ? calculateTransitionCost({ ...high, camelot: '8A' }, { ...noEnergy, camelot: '10A' }) : null, high, noEnergy).energyBoostLabel, 'Energy boost');
  });

  test('Loudness deltas >= 3.5 dB flag "volume dip risk - trim in Mix" cleanly without inventing missing values', () => {
    const loud = { id: '1', artist: 'A', title: 'Loud', bpm: 126, camelot: '8A', loudness: -5.2 };
    const quiet = { id: '2', artist: 'B', title: 'Quiet', bpm: 126, camelot: '8A', loudness: -10.0 };
    const normal = { id: '3', artist: 'C', title: 'Normal', bpm: 126, camelot: '8A', loudness: -6.5 };
    const missing = { id: '4', artist: 'D', title: 'Missing', bpm: 126, camelot: '8A' };

    const risky = calculateTransitionCost(loud, quiet);
    assert.equal(risky.loudnessRisk, true);
    assert.equal(risky.loudnessDiffDb, 4.8);
    assert.equal(risky.loudnessChange, -4.8);
    assert.equal(risky.loudnessWarning, 'volume dip risk - trim in Mix');

    const safe = calculateTransitionCost(loud, normal);
    assert.equal(safe.loudnessRisk, false);
    assert.equal(safe.loudnessWarning, null);

    const absent = calculateTransitionCost(loud, missing);
    assert.equal(absent.loudnessRisk, false);
    assert.equal(absent.loudnessDiffDb, null);
    assert.equal(absent.loudnessWarning, null);

    const td = transitionDisplay(risky, loud, quiet);
    assert.equal(td.loudnessWarning, 'volume dip risk - trim in Mix');
  });

  test('Mix recipe derives exact per-transition presets, phrase guidance, caveat, and loudness warnings', () => {
    const tracks = [
      { id: '1', artist: 'Bicep', title: 'Glue', bpm: 128, camelot: '8A', loudness: -5.0 },
      { id: '2', artist: 'Four Tet', title: 'Parallel', bpm: 129, camelot: '10A', loudness: -9.5 }, // 0.8% +2 boost + 4.5 dB drop
      { id: '3', artist: 'Overmono', title: 'Bby', bpm: 132.5, camelot: '10A', loudness: -8.0 },     // 2.7% gap compatible key
      { id: '4', artist: 'Objekt', title: 'Theme', bpm: 132.5, camelot: '4B', loudness: -7.5 }     // harmonic clash
    ];
    const evaluation = evaluateSequence(tracks);
    const recipe = buildMixRecipe(tracks, evaluation, 'Friday Club Set');

    assert.equal(recipe.items.length, 4);
    assert.equal(recipe.phraseGuidance, PHRASE_GUIDANCE);
    assert.equal(recipe.caveat, MIX_CAVEAT);
    assert.match(recipe.plainText, /phrase boundary/i);
    assert.match(recipe.plainText, /Spotify Connect/i);
    assert.match(recipe.plainText, /free tier/i);

    assert.equal(recipe.items[0].transition.preset, '16-bar blend, Auto preset is fine');
    assert.equal(recipe.items[0].transition.energyBoost, true);
    assert.equal(recipe.items[0].transition.loudnessWarning, 'volume dip risk - trim in Mix');
    assert.match(recipe.items[0].transition.instruction, /volume dip risk - trim in Mix/);

    assert.equal(
      recipe.items[1].transition.preset,
      'short 4-8 bar fade, consider a low-pass sweep on the outgoing track'
    );

    assert.equal(recipe.items[2].transition.preset, '2-bar cut or echo-out, do not blend');
    assert.equal(recipe.items[3].transition, null);

    // >5% jump also recommends 2-bar cut
    const fastJump = recommendMixSetting(
      calculateTransitionCost(tracks[0], { ...tracks[0], id: '5', bpm: 136 }),
      tracks[0],
      tracks[0]
    );
    assert.equal(fastJump.preset, '2-bar cut or echo-out, do not blend');
  });

  test('Determinism, pin-as-opener/closer, bridge finder, and re-sequencing keep pairs <= 2% (unless deliberate reset)', async () => {
    const realisticSet = [
      { id: 'r01', artist: 'Bicep', title: 'Atlas', bpm: 130, camelot: '7A', energy: 0.72, loudness: -5.4, status: 'verified' },
      { id: 'r02', artist: 'Four Tet', title: 'Baby', bpm: 126, camelot: '4A', energy: 0.58, loudness: -6.8, status: 'verified' },
      { id: 'r03', artist: 'Peggy Gou', title: 'Starry Night', bpm: 126, camelot: '6A', energy: 0.70, loudness: -6.1, status: 'verified' },
      { id: 'r04', artist: 'Barry Can\'t Swim', title: 'Kimbara', bpm: 126, camelot: '5A', energy: 0.74, loudness: -10.5, status: 'verified' },
      { id: 'r05', artist: 'Mall Grab', title: 'Liverpool St', bpm: 125, camelot: '5A', energy: 0.65, loudness: -6.0, status: 'verified' },
      { id: 'r06', artist: 'Ross from Friends', title: 'Daisy', bpm: 127, camelot: '6A', energy: 0.68, loudness: -6.4, status: 'verified' },
      { id: 'r07', artist: 'Overmono', title: 'Good Lies', bpm: 131, camelot: '4A', energy: 0.84, loudness: -5.2, status: 'verified' },
      { id: 'r08', artist: 'Daphni', title: 'Sizzling', bpm: 128, camelot: '8A', energy: 0.75, loudness: -6.3, status: 'verified' },
      { id: 'r09', artist: 'Bonobo', title: 'Otomo', bpm: 128, camelot: '7A', energy: 0.78, loudness: -5.8, status: 'verified' },
      { id: 'r10', artist: 'Caribou', title: 'Honey', bpm: 129, camelot: '8A', energy: 0.82, loudness: -5.5, status: 'verified' },
      { id: 'r11', artist: 'Floating Points', title: 'LesAlpx', bpm: 129, camelot: '7A', energy: 0.80, loudness: -5.9, status: 'verified' },
      { id: 'r12', artist: 'Fred again..', title: 'Delilah', bpm: 132, camelot: '5A', energy: 0.88, loudness: -4.9, status: 'verified' },
      { id: 'r13', artist: 'Khruangbin', title: 'Time', bpm: 124, camelot: '5A', energy: 0.50, loudness: -8.0, status: 'verified' },
      { id: 'r14', artist: 'Kiasmos', title: 'Blurred', bpm: 125, camelot: '4A', energy: 0.54, loudness: -7.5, status: 'verified' },
      { id: 'r15', artist: 'DJ Koze', title: 'Pick Up', bpm: 127, camelot: '7A', energy: 0.66, loudness: -6.2, status: 'verified' },
      { id: 'r16', artist: 'Romy', title: 'Enjoy Your Life', bpm: 131, camelot: '5A', energy: 0.85, loudness: -5.3, status: 'verified' }
    ];

    const run1 = new DJSequencer({ seed: 42 }).solve(realisticSet);
    const run2 = new DJSequencer({ seed: 42 }).solve(realisticSet);

    assert.deepEqual(
      run1.orderedTracks.map(t => t.id),
      run2.orderedTracks.map(t => t.id),
      'Same input and seed must produce the identical order twice'
    );
    assert.equal(run1.evaluation.totalCost, run2.evaluation.totalCost);

    const overTwoPctNonReset = run1.evaluation.transitions.filter(t => t.tempoDiffPct > 2.0 && !t.isDeliberateReset);
    assert.equal(
      overTwoPctNonReset.length,
      0,
      `Expected no adjacent transition >2% BPM diff unless deliberate reset, got ${JSON.stringify(overTwoPctNonReset)}`
    );

    // Pin opener and closer still work
    const pinned = new DJSequencer({ seed: 42, lockedOpenerId: 'r12', lockedCloserId: 'r13' }).solve(realisticSet);
    assert.equal(pinned.orderedTracks[0].id, 'r12');
    assert.equal(pinned.orderedTracks[pinned.orderedTracks.length - 1].id, 'r13');

    // Mix recipe renders sensible recommendation for every transition
    const recipe = buildMixRecipe(run1.orderedTracks, run1.evaluation, 'Overhaul Demo');
    const transitionItems = recipe.items.slice(0, -1);
    assert.equal(transitionItems.length, realisticSet.length - 1);
    transitionItems.forEach((item) => {
      assert.ok(item.transition.preset && item.transition.preset.length > 0);
    });
    assert.ok(transitionItems.some(i => i.transition.loudnessWarning === 'volume dip risk - trim in Mix'));

    // Bridge finder keeps working seamlessly
    const bridgeEngine = new SuggestionEngine(null);
    const gapped = [realisticSet[0], { ...realisticSet[6], bpm: 138, camelot: '11B' }];
    const gappedEval = evaluateSequence(gapped);
    const bridges = await bridgeEngine.findBridgeTracks(gappedEval, gapped);
    assert.ok(Array.isArray(bridges.gaps));
  });

  test('SoundNet loudness parsing, CSV Loudness column, pipeline enrichment, and Cloudflare Worker wiring + 429 fallback', async () => {
    assert.equal(parseSoundNetLoudness('-5.4 dB'), -5.4);
    assert.equal(parseSoundNetLoudness(-8), -8);
    assert.equal(parseSoundNetLoudness(99), null);

    const csvRows = parseTracklistCSV('Artist,Title,BPM,Key,Energy,Loudness\nBicep,Glue,130,8A,0.75,-5.2 dB');
    assert.equal(csvRows[0].loudness, -5.2);
    assert.equal(csvRows[0].energy, 0.75);

    const envWithSoundNet = createWorkerTestEnv({ SOUNDNET_API_KEY: 'sn-secret' });
    const statusRes = await worker.fetch(new Request('https://worker.example/api/status'), envWithSoundNet);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.providers.freqblog.isConfigured, true);
    assert.equal(statusJson.providers.soundnet.isConfigured, true);

    const originalFetch = global.fetch;
    let snCalls = 0;
    try {
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('freqblog')) {
          return {
            ok: true,
            json: async () => ({
              track_name: u.includes('QuotaHit') ? 'QuotaHit' : 'Atlas',
              artist_name: 'Bicep',
              bpm: 128,
              key: 'D minor',
              camelot: '7A'
            })
          };
        }
        if (u.includes('soundnet.p.rapidapi.com')) {
          snCalls++;
          if (u.includes('QuotaHit')) {
            return { ok: false, status: 429, json: async () => ({}) };
          }
          return {
            ok: true,
            json: async () => ({ artist: 'Bicep', title: 'Atlas', tempo: 128, key: 'D', mode: 'minor', energy: 0.78, loudness: '-5.6 dB' })
          };
        }
        throw new Error(`Unexpected ${u}`);
      };

      // Happy path: FreqBlog + SoundNet agree and populate energy + loudness in Worker KV cache
      const r1 = await worker.fetch(new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: JSON.stringify({ tracks: [{ id: '1', artist: 'Bicep', title: 'Atlas' }] })
      }), envWithSoundNet);
      assert.equal(r1.status, 200);
      const j1 = await r1.json();
      assert.equal(j1.tracks[0].status, 'verified');
      assert.equal(j1.tracks[0].energy, 0.78);
      assert.equal(j1.tracks[0].loudness, -5.6);

      // Re-run uses Worker KV cache for SoundNet (no second external SoundNet call)
      await worker.fetch(new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: JSON.stringify({ tracks: [{ id: '1', artist: 'Bicep', title: 'Atlas' }] })
      }), envWithSoundNet);
      assert.equal(snCalls, 1, 'Worker caches SoundNet hits in KV to protect 5 req/day quota');

      // 429 fallback path: SoundNet hits daily limit, FreqBlog result succeeds without error
      const r429 = await worker.fetch(new Request('https://worker.example/api/pipeline/verify', {
        method: 'POST',
        body: JSON.stringify({ tracks: [{ id: '2', artist: 'Bicep', title: 'QuotaHit' }] })
      }), envWithSoundNet);
      assert.equal(r429.status, 200);
      const j429 = await r429.json();
      assert.equal(j429.tracks[0].bpm, 128);
      assert.equal(j429.tracks[0].loudness, null);
    } finally {
      global.fetch = originalFetch;
    }

    // Pipeline unit check: Case B single-source also keeps optional loudness if present
    const pipe = new VerificationPipeline({
      freqblogKey: 'fb',
      freqblogOptions: {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ track_name: 'Solo', artist_name: 'Art', bpm: 126, key: 'A minor', camelot: '8A' })
        })
      },
      soundNetKey: 'sn',
      soundNetOptions: {
        cache: { async get() { return null; }, async set() {} },
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ artist: 'Art', title: 'Solo', tempo: null, key: null, energy: 0.7, loudness: '-7.2 dB' })
        })
      }
    });
    const soloRes = await pipe.processPlaylist([{ id: 's1', artist: 'Art', title: 'Solo' }]);
    assert.equal(soloRes.tracks[0].status, 'single_source');
    assert.equal(soloRes.tracks[0].energy, 0.7);
    assert.equal(soloRes.tracks[0].loudness, -7.2);
  });
});
