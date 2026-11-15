import { GetSongBPMProvider } from '../providers/getsongbpm.js';
import { SonovaultProvider } from '../providers/sonovault.js';
import { SoundNetProvider } from '../providers/soundnet.js';
import { FreqBlogProvider } from '../providers/freqblog.js';
import { MusicaeProvider } from '../providers/musicae.js';

/**
 * Normalizes BPM into target working tempo band (default 90-180 BPM).
 * Resolves half-time / double-time ambiguities explicitly while tracking
 * provenance and marking whether the value was normalized.
 */
const BPM_TOLERANCE_PCT = 2; // percent tolerance for tempo agreement
function bpmWithin(a, b, tolPct = BPM_TOLERANCE_PCT) {
  if (typeof a !== 'number' || typeof b !== 'number' || a <= 0 || b <= 0) return false;
  return (Math.abs(a - b) / ((a + b) / 2)) * 100 <= tolPct;
}

export function normalizeTempo(rawBpm, minBpm = 90, maxBpm = 180) {
  if (typeof rawBpm !== 'number' || isNaN(rawBpm) || rawBpm <= 0) {
    return {
      rawBpm: null,
      workingBpm: null,
      isNormalized: false,
      multiplier: 1
    };
  }

  let workingBpm = rawBpm;
  let multiplier = 1;
  let isNormalized = false;

  // If tempo is below lower bound, test doubling
  if (workingBpm < minBpm) {
    if (workingBpm * 2 >= minBpm && workingBpm * 2 <= maxBpm) {
      workingBpm = workingBpm * 2;
      multiplier = 2;
      isNormalized = true;
    }
  } else if (workingBpm > maxBpm) {
    // If tempo is above upper bound, test halving
    if (workingBpm / 2 >= minBpm && workingBpm / 2 <= maxBpm) {
      workingBpm = workingBpm / 2;
      multiplier = 0.5;
      isNormalized = true;
    }
  }

  return {
    rawBpm: Math.round(rawBpm * 10) / 10,
    workingBpm: Math.round(workingBpm * 10) / 10,
    isNormalized,
    multiplier
  };
}

/**
 * Evaluates whether two sources disagree because of a version mismatch
 * (e.g. Club Mix vs Radio Edit, or mismatched ISRCs / durations)
 */
export function detectVersionMismatch(sourceA, sourceB) {
  // If both have ISRCs and they differ -> definitely different recordings
  if (sourceA.isrc && sourceB.isrc && sourceA.isrc !== sourceB.isrc) {
    return {
      isMismatch: true,
      reason: `ISRC mismatch: ${sourceA.isrc} vs ${sourceB.isrc}`
    };
  }

  // Version/remix tag check
  const verA = (sourceA.version || '').toLowerCase().trim();
  const verB = (sourceB.version || '').toLowerCase().trim();
  if (verA && verB && verA !== verB) {
    return {
      isMismatch: true,
      reason: `Remix/version label mismatch: "${verA}" vs "${verB}"`
    };
  }

  // Duration check (tolerance: 12 seconds)
  if (sourceA.durationMs && sourceB.durationMs) {
    const diffSec = Math.abs(sourceA.durationMs - sourceB.durationMs) / 1000;
    if (diffSec > 12) {
      return {
        isMismatch: true,
        reason: `Duration difference of ${Math.round(diffSec)}s suggests different edits`
      };
    }
  }

  return { isMismatch: false, reason: null };
}

/**
 * Classifies a provider lookup outcome so a provider OUTAGE is never
 * reported as 'track not found'. Reasons vary per provider; anything that
 * is not an explicit miss/veto is treated as an error (transient or
 * unknown), so the UI never asserts absence it cannot prove.
 */
const PROVIDER_MISS_RE = /no_match|not found|mismatch|rejected/i;
export function classifyProviderOutcome(result) {
  if (result?.success && result.data) return 'hit';
  const reason = String(result?.reason || '');
  if (PROVIDER_MISS_RE.test(reason)) return 'miss';
  return 'error';
}

export function isAudioAnalysisSource(s) {
  if (!s) return false;
  const src = String(s.source || '').toLowerCase();
  const name = String(s.name || s.provider || '').toLowerCase();
  return src === 'audio_analysis' || name === 'audio analysis';
}

function evaluateManualCsvVsAudio(audioHit, manualSources, minBpm = 90, maxBpm = 180) {
  if (!audioHit || !Array.isArray(manualSources) || manualSources.length === 0) return null;
  const manual = manualSources.find(s => s && (typeof s.bpm === 'number' || s.camelot));
  if (!manual) return null;

  const rawAudioBpm = audioHit.rawBpm || audioHit.bpm;
  const normA = normalizeTempo(rawAudioBpm, minBpm, maxBpm);
  const workingAudioBpm = normA.workingBpm || rawAudioBpm;
  const suppliedBpm = typeof manual.bpm === 'number' && manual.bpm > 0 ? manual.bpm : null;
  const suppliedCamelot = manual.camelot || null;

  const disputeReasons = [];
  if (suppliedBpm && workingAudioBpm && !bpmWithin(suppliedBpm, workingAudioBpm) && !bpmWithin(suppliedBpm, rawAudioBpm)) {
    const avg = (workingAudioBpm + suppliedBpm) / 2;
    const diffPct = (Math.abs(workingAudioBpm - suppliedBpm) / avg) * 100;
    disputeReasons.push(
      `BPM discrepancy: Audio Analysis has ${workingAudioBpm} BPM, Manual CSV has ${suppliedBpm} BPM (diff ${diffPct.toFixed(1)}% > 2%)`
    );
  }
  if (suppliedCamelot && audioHit.camelot && suppliedCamelot !== audioHit.camelot) {
    disputeReasons.push(
      `Key discrepancy: Audio Analysis has ${audioHit.camelot} (${audioHit.key || 'unknown'}), Manual CSV has ${suppliedCamelot} (${manual.key || 'unknown'})`
    );
  }
  if (disputeReasons.length === 0) return null;

  return {
    reason: disputeReasons.join('; '),
    disputeDetails: {
      sourceA: { ...audioHit, workingBpm: workingAudioBpm, isNormalized: normA.isNormalized },
      sourceB: {
        ...manual,
        provider: manual.provider || manual.name || 'Manual CSV',
        workingBpm: suppliedBpm,
        isNormalized: false
      },
      disputeReasons
    }
  };
}

function mergeOptionalMetric(valA, valB, scale) {
  const hasA = typeof valA === 'number' && Number.isFinite(valA);
  const hasB = typeof valB === 'number' && Number.isFinite(valB);
  if (hasA && hasB) {
    return Math.round(((valA + valB) / 2) * scale) / scale;
  }
  if (hasA) return valA;
  if (hasB) return valB;
  return null;
}

/**
 * Compares two external provider results according to DJ verification rules:
 * - Tempo within 2% of normalized working BPM
 * - Identical Camelot key
 */
export function evaluateTwoSources(recA, recB, options = {}) {
  const { minBpm = 90, maxBpm = 180 } = options;

  // 1. Check for version mismatch. A mismatch flags the recording identity
  // for review, but it no longer invalidates the comparison by itself: when
  // tempo and key still agree across both independent sources, the values are
  // corroborated and stay visible pending recording review (same treatment as
  // the single-source ISRC-mismatch case).
  const mismatch = detectVersionMismatch(recA, recB);

  // 2. Normalize tempos
  const normA = normalizeTempo(recA.bpm, minBpm, maxBpm);
  const normB = normalizeTempo(recB.bpm, minBpm, maxBpm);
  const audioRec = isAudioAnalysisSource(recA) ? recA : (isAudioAnalysisSource(recB) ? recB : null);
  const audioNorm = audioRec ? (audioRec === recA ? normA : normB) : null;

  if (!normA.workingBpm || !normB.workingBpm || !recA.camelot || !recB.camelot) {
    // Incomplete pair (e.g. a provider hit plus a BPM-only CSV row): the
    // comparison cannot verify, but the values that DO exist must survive -
    // returning them under the standard field names keeps the Case A mapping
    // from wiping both the provider hit and the user-supplied data.
    const chosenBpm = audioNorm?.workingBpm || normA.workingBpm || normB.workingBpm || null;
    const chosenCamelot = audioRec?.camelot || recA.camelot || recB.camelot || null;
    const hasCompleteAudio = Boolean(audioRec && audioNorm?.workingBpm && audioRec.camelot);
    return {
      status: hasCompleteAudio ? 'analysed' : 'unverified',
      confidence: hasCompleteAudio ? (audioRec.confidence || 'audio_analysis') : 'incomplete_data',
      reason: hasCompleteAudio
        ? 'Analysed directly from local audio file in your browser; second source lacked complete tempo or key.'
        : 'One or both sources lack verified tempo or musical key/mode.',
      bpm: chosenBpm,
      rawBpm: audioRec?.rawBpm || audioRec?.bpm || recA.rawBpm || recA.bpm || recB.rawBpm || recB.bpm || null,
      workingBpm: chosenBpm,
      isNormalized: normA.isNormalized || normB.isNormalized,
      camelot: chosenCamelot,
      key: audioRec?.key || recA.key || recB.key || chosenCamelot,
      energy: (audioRec && typeof audioRec.energy === 'number' && Number.isFinite(audioRec.energy))
        ? audioRec.energy
        : mergeOptionalMetric(recA.energy, recB.energy, 100),
      loudness: mergeOptionalMetric(recA.loudness, recB.loudness, 10),
      sources: [recA, recB],
      recordingNeedsReview: mismatch.isMismatch,
      recordingMismatch: mismatch.isMismatch
        ? { reason: mismatch.reason, suppliedIsrc: recA.isrc || null, matchedIsrc: recB.isrc || null }
        : null,
      disputeDetails: null
    };
  }

  // Check tempo agreement: within 2%
  const avgBpm = (normA.workingBpm + normB.workingBpm) / 2;
  const bpmDiffPercent = (Math.abs(normA.workingBpm - normB.workingBpm) / avgBpm) * 100;
  const tempoAgrees = bpmDiffPercent <= 2.0;

  // Check key agreement: identical Camelot value
  const keyAgrees = recA.camelot === recB.camelot;

  const energy = (audioRec && typeof audioRec.energy === 'number' && Number.isFinite(audioRec.energy))
    ? audioRec.energy
    : mergeOptionalMetric(recA.energy, recB.energy, 100);
  const loudness = mergeOptionalMetric(recA.loudness, recB.loudness, 10);

  if (tempoAgrees && keyAgrees) {
    // When one of the agreeing sources is local audio analysis, audio has the
    // strongest provenance (actual audio bytes) so its values stay primary.
    const agreedBpm = audioNorm ? audioNorm.workingBpm : Math.round(avgBpm * 10) / 10;
    const agreedRawBpm = audioRec ? (audioRec.rawBpm || audioRec.bpm) : (recA.rawBpm || recA.bpm);
    const agreedCamelot = audioRec ? audioRec.camelot : recA.camelot;
    const agreedKey = audioRec ? (audioRec.key || audioRec.camelot) : (recA.key || recA.camelot);
    return {
      status: 'verified',
      confidence: 'two_sources_agreed',
      bpm: agreedBpm,
      rawBpm: agreedRawBpm,
      workingBpm: agreedBpm,
      isNormalized: audioNorm ? audioNorm.isNormalized : (normA.isNormalized || normB.isNormalized),
      camelot: agreedCamelot,
      key: agreedKey,
      energy,
      loudness,
      sources: [recA, recB],
      recordingNeedsReview: mismatch.isMismatch,
      recordingMismatch: mismatch.isMismatch
        ? { reason: mismatch.reason, suppliedIsrc: recA.isrc || null, matchedIsrc: recB.isrc || null }
        : null,
      reason: mismatch.isMismatch
        ? `Potential version mismatch (${mismatch.reason}); tempo and key still agree across both sources - values shown, recording identity needs review.`
        : null,
      disputeDetails: null
    };
  }

  // They disagree! Mark as DISPUTED. When local audio analysis is present, keep
  // audio as the primary source (sourceA) and default working values.
  const primaryRec = audioRec || recA;
  const secondaryRec = primaryRec === recA ? recB : recA;
  const primaryNorm = primaryRec === recA ? normA : normB;
  const secondaryNorm = primaryRec === recA ? normB : normA;

  const disputeReasons = [];
  if (mismatch.isMismatch) {
    disputeReasons.push(`Potential version mismatch: ${mismatch.reason}`);
  }
  if (!tempoAgrees) {
    disputeReasons.push(`BPM discrepancy: ${primaryRec.provider || 'Source A'} has ${primaryNorm.workingBpm} BPM, ${secondaryRec.provider || 'Source B'} has ${secondaryNorm.workingBpm} BPM (diff ${bpmDiffPercent.toFixed(1)}% > 2%)`);
  }
  if (!keyAgrees) {
    disputeReasons.push(`Key discrepancy: ${primaryRec.provider || 'Source A'} has ${primaryRec.camelot} (${primaryRec.key || 'unknown'}), ${secondaryRec.provider || 'Source B'} has ${secondaryRec.camelot} (${secondaryRec.key || 'unknown'})`);
  }

  return {
    status: 'disputed',
    confidence: 'disputed',
    reason: disputeReasons.join('; '),
    bpm: primaryNorm.workingBpm, // default view, pending user override
    rawBpm: primaryRec.rawBpm || primaryRec.bpm,
    workingBpm: primaryNorm.workingBpm,
    isNormalized: primaryNorm.isNormalized,
    camelot: primaryRec.camelot,
    key: primaryRec.key,
    energy,
    loudness,
    sources: [primaryRec, secondaryRec],
    disputeDetails: {
      sourceA: { ...primaryRec, workingBpm: primaryNorm.workingBpm, isNormalized: primaryNorm.isNormalized },
      sourceB: { ...secondaryRec, workingBpm: secondaryNorm.workingBpm, isNormalized: secondaryNorm.isNormalized },
      disputeReasons
    }
  };
}

/**
 * Data pipeline manager coordinating providers, caching, and dispute evaluation.
 */
export class VerificationPipeline {
  constructor(options = {}) {
    this.minBpm = options.minBpm || 90;
    this.maxBpm = options.maxBpm || 180;
    this.getSongBPM = new GetSongBPMProvider(options.getSongBpmKey, options.getSongBpmOptions || {});
    this.sonovault = new SonovaultProvider(options.sonovaultKey, options.sonovaultOptions || {});
    this.soundNet = new SoundNetProvider(options.soundNetKey, options.soundNetOptions || {});
    this.freqblog = new FreqBlogProvider(options.freqblogKey, options.freqblogOptions || {});
    this.musicae = new MusicaeProvider(options.rapidApiKey, options.musicaeOptions || {});
  }

  /**
   * Process a single track through providers and verification rules
   */
  async processTrack(track) {
    const trackId = track.id || `${track.artist}-${track.title}`;

    // 2. If track already came from Manual CSV without additional sources to compare
    if (track.source === 'manual_csv' && track.status === 'verified' && (!track.sources || track.sources.length < 2)) {
      const rawBpm = track.rawBpm || track.bpm;
      const norm = normalizeTempo(rawBpm, this.minBpm, this.maxBpm);
      // The supplied value stays raw. An octave-adjusted value is only a
      // flagged suggestion, never silently trusted for grading/sequencing.
      let tempoSuggestion = null;
      let tempoNeedsReview = false;
      if (norm.isNormalized) {
        tempoSuggestion = {
          bpm: norm.workingBpm,
          kind: norm.workingBpm > rawBpm ? 'doubled' : 'halved',
          basis: `${this.minBpm}-${this.maxBpm} BPM working-range heuristic`
        };
        tempoNeedsReview = true;
      }
      return {
        ...track,
        bpm: rawBpm,
        rawBpm,
        workingBpm: rawBpm,
        isNormalized: false,
        tempoSuggestion,
        tempoNeedsReview,
        // User-supplied values are exactly that - supplied. They must not
        // keep the parser's 'verified' status, which the client badges as
        // 'Corroborated (2+ sources agree)'.
        status: 'supplied',
        confidence: 'manual'
      };
    }

    // 3. Query external independent providers
    const trackQuery = {
      artist: track.artist,
      title: track.title,
      isrc: track.isrc,
      version: track.version,
      durationMs: track.duration_ms ?? track.durationMs ?? null
    };

    const configuredProviders = [];
    if (this.getSongBPM.isConfigured()) configuredProviders.push(['GetSongBPM', this.getSongBPM]);
    if (this.sonovault.isConfigured()) configuredProviders.push(['Sonovault', this.sonovault]);
    if (this.soundNet.isConfigured()) configuredProviders.push(['SoundNet', this.soundNet]);
    if (this.freqblog.isConfigured()) configuredProviders.push(['FreqBlog', this.freqblog]);

    const results = await Promise.all(configuredProviders.map(([, p]) => p.lookupTrack(trackQuery)));
    const providerOutcomes = results.map((r, i) => ({
      provider: configuredProviders[i][0],
      outcome: classifyProviderOutcome(r),
      reason: r?.success ? null : String(r?.reason || 'unknown')
    }));
    const successfulHits = results
      .filter(r => r.success && r.data && r.data.bpm && r.data.camelot)
      .map(r => r.data);

    // If manual sources were already attached to track (e.g. from CSV or previous lookup)
    const manualSources = [];
    if (track.sources && track.sources.length > 0) {
      for (const s of track.sources) {
        // A manual/CSV entry with no tempo or key is an empty placeholder,
        // not evidence: it must not count as a corroborating source.
        if (!(s && (s.bpm || s.camelot))) continue;
        // User-supplied values ('Manual CSV') are not catalogue evidence at
        // all: they are cross-checked via the supplied-BPM comparisons, never
        // counted toward 2-source corroboration or Musicae tie-breaking.
        // Otherwise a partially supplied CSV row plus ONE provider response
        // would read as two agreeing sources. They still ride along in the
        // returned sources list so the provenance stays visible.
        if (s.name === 'Manual CSV') {
          manualSources.push(s);
          continue;
        }
        // Local browser audio analysis is a first-class, highest-provenance
        // evidence source. Normalize its identity and place it first so it
        // serves as primary provenance (sourceA) in comparisons and disputes.
        if (isAudioAnalysisSource(s)) {
          const audioBpm = s.bpm ?? track.bpm;
          const audioCamelot = s.camelot ?? track.camelot;
          if (audioBpm && audioCamelot && !successfulHits.some(h => isAudioAnalysisSource(h))) {
            successfulHits.unshift({
              ...s,
              name: 'Audio Analysis',
              provider: 'Audio Analysis',
              source: 'audio_analysis',
              bpm: audioBpm,
              rawBpm: s.rawBpm ?? audioBpm,
              workingBpm: s.workingBpm ?? audioBpm,
              key: s.key ?? track.key ?? audioCamelot,
              camelot: audioCamelot,
              energy: s.energy ?? track.energy ?? null,
              durationMs: s.durationMs ?? track.durationMs ?? track.duration_ms ?? null,
              confidence: s.confidence ?? track.audioConfidence ?? 'audio_analysis'
            });
          }
          continue;
        }
        if (!successfulHits.some(h => h.provider === s.name)) {
          successfulHits.push(s);
        }
      }
    }

    if (
      track.source === 'audio_analysis' &&
      track.bpm &&
      track.camelot &&
      !successfulHits.some(h => isAudioAnalysisSource(h))
    ) {
      successfulHits.unshift({
        name: 'Audio Analysis',
        provider: 'Audio Analysis',
        source: 'audio_analysis',
        bpm: track.bpm,
        rawBpm: track.rawBpm ?? track.bpm,
        workingBpm: track.workingBpm ?? track.bpm,
        key: track.key ?? track.camelot,
        camelot: track.camelot,
        energy: track.energy ?? null,
        durationMs: track.durationMs ?? track.duration_ms ?? null,
        confidence: track.audioConfidence ?? track.confidence ?? 'audio_analysis'
      });
    }

    // Musicae consultation policy (owner decision 2026-11-14, extended
    // 2026-11-15): providers are consulted in descending lookup allowance -
    // GetSongBPM (~3,000/hr), then Sonovault (1,000/mo) and the other
    // configured sources in parallel - and Musicae (10/day, ISRC-addressable
    // only) is consulted ONLY as (a) a tiebreaker when the two priority
    // sources disagree, or (b) a fallback when fewer than two priority
    // sources respond. Its responses are cached by ISRC, so repeats never
    // burn the daily quota. When the query itself carries no ISRC, a
    // tiebreak may address Musicae by the ISRC(s) on the matched priority
    // records instead (owner decision 2026-11-15): the records' recording
    // identity is exactly what the dispute is about.
    const musicaeConfigured = this.musicae.isConfigured();
    let musicaeConsulted = false;
    let musicaeLastReason = null;
    const consultMusicae = async (isrcCandidates) => {
      if (!musicaeConfigured || musicaeConsulted) return null;
      const candidates = [...new Set((isrcCandidates || [])
        .filter(v => typeof v === 'string' && v.trim().length > 0)
        .map(v => v.trim().toUpperCase()))];
      if (candidates.length === 0) return null;
      musicaeConsulted = true;
      for (const isrc of candidates) {
        const r = await this.musicae.lookupTrack({ ...trackQuery, isrc });
        providerOutcomes.push({
          provider: this.musicae.name,
          outcome: classifyProviderOutcome(r),
          reason: r?.success ? null : String(r?.reason || 'unknown')
        });
        if (r && r.success && r.data && r.data.bpm && r.data.camelot) return r.data;
        if (r && !r.success) musicaeLastReason = String(r.reason || 'unknown');
      }
      return null;
    };

    // Fallback: fewer than two corroborating sources - Musicae may supply the
    // missing second source (or the only one). Addressed by the query's own
    // ISRC only: without a dispute to settle, matched-record ISRCs stay
    // untouched so routine single-source misses never burn the daily quota.
    if (successfulHits.length < 2) {
      const hit = await consultMusicae([trackQuery.isrc]);
      if (hit && !successfulHits.some(h => h.provider === hit.provider)) {
        successfulHits.push(hit);
      }
    }

    // Case A: 2 or more independent sources found
    if (successfulHits.length >= 2) {
      let evaluation = evaluateTwoSources(successfulHits[0], successfulHits[1], {
        minBpm: this.minBpm,
        maxBpm: this.maxBpm
      });

      // Tiebreak: the priority pair disagrees and Musicae has not spoken yet.
      if (evaluation.status === 'disputed' && !successfulHits.some(h => h.provider === this.musicae.name)) {
        const tiebreakCandidates = [trackQuery.isrc, successfulHits[0].isrc, successfulHits[1].isrc];
        const tiebreak = await consultMusicae(tiebreakCandidates);
        if (tiebreak) {
          const normM = normalizeTempo(tiebreak.bpm, this.minBpm, this.maxBpm);
          const agreesWith = (rec) => {
            const normR = normalizeTempo(rec.bpm, this.minBpm, this.maxBpm);
            return Boolean(normM.workingBpm && normR.workingBpm
              && bpmWithin(normM.workingBpm, normR.workingBpm)
              && rec.camelot && tiebreak.camelot === rec.camelot);
          };
          const agreesA = agreesWith(successfulHits[0]);
          const agreesB = agreesWith(successfulHits[1]);
          successfulHits.push(tiebreak);
          if (agreesA !== agreesB) {
            const winner = agreesA ? successfulHits[0] : successfulHits[1];
            const loser = agreesA ? successfulHits[1] : successfulHits[0];
            // Never silently overwrite local audio analysis with a catalogue
            // tiebreak: when the user's actual audio file disagrees with
            // catalogue records, keep the dispute visible with audio primary.
            if (isAudioAnalysisSource(loser)) {
              evaluation = {
                ...evaluation,
                reason: `${evaluation.reason} Musicae tiebreak corroborated ${winner.provider}, which conflicts with local audio analysis; dispute stands.`
              };
            } else {
              const resolved = evaluateTwoSources(winner, tiebreak, {
                minBpm: this.minBpm,
                maxBpm: this.maxBpm
              });
              evaluation = {
                ...resolved,
                confidence: resolved.status === 'verified' ? 'tiebreaker_resolved' : resolved.confidence,
                reason: `Priority sources ${successfulHits[0].provider} and ${successfulHits[1].provider} disagreed; Musicae tiebreak corroborated ${winner.provider} over ${loser.provider}.`
                  + (resolved.reason ? ` ${resolved.reason}` : ''),
                disputeDetails: evaluation.disputeDetails
              };
            }
          } else {
            evaluation = {
              ...evaluation,
              reason: `${evaluation.reason} Musicae tiebreak ${agreesA ? 'agreed with both sides within tolerance' : 'corroborated neither side'}; dispute stands.`
            };
          }
        } else if (musicaeConfigured && tiebreakCandidates.some(v => typeof v === 'string' && v.trim().length > 0)) {
          evaluation = {
            ...evaluation,
            reason: `${evaluation.reason} Musicae tiebreak unavailable${musicaeLastReason ? ` - ${musicaeLastReason}` : ''}.`
          };
        }
      }

      // If local audio analysis agreed with a catalogue source, still cross-check
      // against any user-supplied Manual CSV values so CSV-vs-audio discrepancies
      // are surfaced rather than silently dropped.
      if (evaluation.status !== 'disputed' && isAudioAnalysisSource(successfulHits[0])) {
        const csvConflict = evaluateManualCsvVsAudio(successfulHits[0], manualSources, this.minBpm, this.maxBpm);
        if (csvConflict) {
          evaluation = {
            ...evaluation,
            status: 'disputed',
            confidence: 'disputed',
            disputeDetails: csvConflict.disputeDetails,
            reason: evaluation.reason ? `${evaluation.reason}; ${csvConflict.reason}` : csvConflict.reason
          };
        }
      }

      // Cross-check the matched records against the track's own ISRC: two
      // providers agreeing about a DIFFERENT recording (or a tiebreak won on
      // a candidate ISRC that is not this track's) is not corroboration of
      // this recording's values. detectVersionMismatch only compares the two
      // matched records with each other, so this check must happen here.
      // Runs whenever the track carries an ISRC, not only on 'verified': a
      // single-source or incomplete_data outcome built from a foreign-ISRC
      // record needs the same recording-identity flag.
      if (track.isrc && !evaluation.recordingNeedsReview) {
        const trackIsrc = String(track.isrc).toUpperCase();
        const foreign = (evaluation.sources || []).find(s => s.isrc && String(s.isrc).toUpperCase() !== trackIsrc);
        if (foreign) {
          const note = `Matched record ISRC ${foreign.isrc} differs from this track's ${track.isrc}: tempo/key come from that record and need confirmation.`;
          evaluation = {
            ...evaluation,
            recordingNeedsReview: true,
            recordingMismatch: {
              reason: note,
              suppliedIsrc: track.isrc,
              matchedIsrc: foreign.isrc
            },
            reason: evaluation.reason ? `${evaluation.reason} ${note}` : note
          };
        }
      }

      return {
        ...track,
        bpm: evaluation.bpm,
        rawBpm: evaluation.rawBpm,
        workingBpm: evaluation.workingBpm,
        isNormalized: evaluation.isNormalized,
        key: evaluation.key,
        camelot: evaluation.camelot,
        energy: evaluation.energy ?? track.energy ?? null,
        loudness: evaluation.loudness ?? track.loudness ?? null,
        status: evaluation.status,
        confidence: evaluation.confidence,
        disputeDetails: evaluation.disputeDetails,
        recordingNeedsReview: evaluation.recordingNeedsReview || false,
        recordingMismatch: evaluation.recordingMismatch || null,
        reason: evaluation.reason,
        sources: [...successfulHits, ...manualSources],
        // Per-provider outcomes ride along on every path, not just Case C,
        // so the coverage report can show who hit, missed and errored.
        providerError: providerOutcomes.some(o => o.outcome === 'error'),
        providerOutcomes
      };
    }

    // Case B: Exactly 1 source found
    if (successfulHits.length === 1) {
      const hit = successfulHits[0];
      const isAudioHit = isAudioAnalysisSource(hit);
      const rawBpm = hit.rawBpm || hit.bpm;
      const norm = normalizeTempo(rawBpm, this.minBpm, this.maxBpm);
      const manualCsvWithBpm = manualSources.find(s => typeof s?.bpm === 'number' && s.bpm > 0);
      const suppliedBpm = isAudioHit
        ? (manualCsvWithBpm ? manualCsvWithBpm.bpm : null)
        : (typeof track.bpm === 'number' && track.bpm > 0 ? track.bpm : null);
      // A generic placeholder version (e.g. parser default 'Original Mix')
      // is not real version identity: show the matched record's tag instead.
      const trackVersion = (track.version || '').toLowerCase().trim();
      const genericVersion = !trackVersion || trackVersion === 'original mix' || trackVersion === 'original';
      const matchedVersion = hit.version || hit.mixName || null;
      // A matched record whose ISRC differs from the track's own ISRC is a
      // name/version match, not a proven recording: keep the values visible
      // but flag the recording identity for review and keep the track out of
      // confident grading until confirmed.
      const recordingMismatch = track.isrc && hit.isrc
        && String(hit.isrc).toUpperCase() !== String(track.isrc).toUpperCase()
        ? { suppliedIsrc: track.isrc, matchedIsrc: hit.isrc }
        : null;

      let bpm = rawBpm;
      let workingBpm = rawBpm;
      let isNormalized = false;
      let tempoSuggestion = null;
      let tempoNeedsReview = false;
      let status = isAudioHit ? 'analysed' : 'single_source';
      let disputeDetails = null;
      let reason = isAudioHit
        ? 'Analysed directly from local audio file in your browser.'
        : 'Only one source available. Can be cross-checked via CSV or confirmed.';

      if (norm.isNormalized) {
        const kind = norm.workingBpm > rawBpm ? 'doubled' : 'halved';
        if (suppliedBpm && bpmWithin(suppliedBpm, norm.workingBpm)) {
          // Supplied BPM corroborates the octave-adjusted value within 2%:
          // explicit sourced comparison, normalization may be trusted.
          bpm = norm.workingBpm;
          workingBpm = norm.workingBpm;
          isNormalized = true;
          reason = `Tempo ${kind} from raw ${rawBpm} BPM, corroborated by supplied ${suppliedBpm} BPM within 2%.`;
        } else if (suppliedBpm && bpmWithin(suppliedBpm, rawBpm)) {
          // Supplied BPM confirms the raw measurement; no normalization.
          bpm = rawBpm;
          workingBpm = rawBpm;
          isNormalized = false;
        } else if (suppliedBpm) {
          // Supplied BPM matches neither raw nor octave-adjusted: conflict.
          status = 'disputed';
          reason = `Supplied ${suppliedBpm} BPM matches neither the raw ${rawBpm} BPM nor the octave-adjusted ${norm.workingBpm} BPM.`;
          const suppliedSource = {
            provider: 'Supplied',
            bpm: suppliedBpm,
            workingBpm: suppliedBpm,
            camelot: manualCsvWithBpm?.camelot || track.camelot || null,
            key: manualCsvWithBpm?.key || track.key || null
          };
          const hitSource = { ...hit, bpm: rawBpm, workingBpm: norm.workingBpm, isNormalized: true };
          disputeDetails = {
            type: 'bpm_conflict',
            supplied: suppliedBpm,
            raw: rawBpm,
            suggested: norm.workingBpm,
            // The dispute modal renders sourceA/sourceB cards: an octave
            // conflict between the supplied value and one provider record is
            // still a two-sided dispute and must populate both. When the hit is
            // local audio analysis, audio stays sourceA (primary provenance).
            sourceA: isAudioHit ? hitSource : suppliedSource,
            sourceB: isAudioHit ? suppliedSource : hitSource,
            disputeReasons: [reason]
          };
        } else {
          // Unconfirmed octave: keep the raw measurement raw and offer the
          // adjusted value only as a visibly flagged suggestion, excluded
          // from confident grading/sequencing until the user confirms.
          tempoSuggestion = {
            bpm: norm.workingBpm,
            kind,
            basis: `${this.minBpm}-${this.maxBpm} BPM working-range heuristic`
          };
          tempoNeedsReview = true;
          reason = `Raw tempo ${rawBpm} BPM is outside the ${this.minBpm}-${this.maxBpm} BPM working range. Suggested ${kind} value ${norm.workingBpm} BPM needs review before it is trusted.`;
        }
      }

      if (status !== 'disputed' && isAudioHit) {
        const csvConflict = evaluateManualCsvVsAudio(hit, manualSources, this.minBpm, this.maxBpm);
        if (csvConflict) {
          status = 'disputed';
          disputeDetails = csvConflict.disputeDetails;
          reason = csvConflict.reason;
        }
      }

      if (recordingMismatch) {
        recordingMismatch.reason = `Matched record ISRC ${recordingMismatch.matchedIsrc} differs from this track's ${recordingMismatch.suppliedIsrc}: tempo/key come from that record and need confirmation.`;
        reason += ` ${recordingMismatch.reason}`;
      }

      return {
        ...track,
        version: genericVersion && matchedVersion ? matchedVersion : (track.version || matchedVersion || null),
        bpm,
        rawBpm,
        workingBpm,
        isNormalized,
        tempoSuggestion,
        tempoNeedsReview,
        recordingNeedsReview: Boolean(recordingMismatch),
        recordingMismatch,
        key: hit.key,
        camelot: hit.camelot,
        energy: hit.energy ?? results.find(r => r.success && typeof r.data?.energy === 'number')?.data?.energy ?? track.energy ?? null,
        loudness: hit.loudness ?? results.find(r => r.success && typeof r.data?.loudness === 'number')?.data?.loudness ?? track.loudness ?? null,
        status,
        confidence: status === 'disputed' ? 'disputed' : (hit.confidence || (isAudioHit ? 'audio_analysis' : 'single_source')),
        disputeDetails,
        sources: [...successfulHits, ...manualSources],
        providerError: providerOutcomes.some(o => o.outcome === 'error'),
        providerOutcomes,
        reason
      };
    }

    // Case C: No verified sources found. Distinguish "no provider has this
    // track" from "a provider failed": an outage must not be reported as a
    // catalogue gap, and values the track already carried (CSV/manual) are
    // preserved rather than stripped bare.
    const providerError = providerOutcomes.some(o => o.outcome === 'error');
    return {
      ...track,
      bpm: track.bpm ?? null,
      workingBpm: track.workingBpm ?? track.bpm ?? null,
      key: track.key ?? null,
      camelot: track.camelot ?? null,
      energy: track.energy ?? null,
      loudness: track.loudness ?? null,
      status: 'unverified',
      confidence: 'none',
      // Manual CSV provenance survives even with no catalogue hit.
      sources: manualSources,
      providerError,
      providerOutcomes,
      reason: providerError
        ? 'Metadata provider temporarily unavailable or rate-limited; this is not a confirmed catalogue gap. Any values shown are previously supplied, not freshly verified - try again shortly.'
        : 'No external BPM or musical key found in configured providers.'
    };
  }

  /**
   * Process an entire playlist and return coverage report
   */
  async processPlaylist(tracks) {
    const verifiedTracks = [];
    for (const t of tracks) {
      const processed = await this.processTrack(t);
      verifiedTracks.push(processed);
    }

    const report = this.generateCoverageReport(verifiedTracks);
    return {
      tracks: verifiedTracks,
      report
    };
  }

  /**
   * Generates summary: 'verified X/Y, disputed Z, unverified W' with names
   */
  generateCoverageReport(tracks) {
    let verified = 0;
    let analysed = 0;
    let singleSource = 0;
    let supplied = 0;
    let disputed = 0;
    let unverified = 0;

    const analysedList = [];
    const disputedList = [];
    const suppliedList = [];
    const unverifiedList = [];
    const tempoReviewList = [];
    const recordingReviewList = [];
    const providerErrorList = [];
    const providerOutcomeSummary = {};

    for (const t of tracks) {
      if (Array.isArray(t.providerOutcomes)) {
        for (const o of t.providerOutcomes) {
          const bucket = providerOutcomeSummary[o.provider] || (providerOutcomeSummary[o.provider] = { hit: 0, miss: 0, error: 0 });
          bucket[o.outcome] = (bucket[o.outcome] || 0) + 1;
        }
      }
      if (t.providerError) {
        providerErrorList.push({ id: t.id, name: `${t.artist} - ${t.title}` });
      }
      if (t.recordingNeedsReview) {
        recordingReviewList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`,
          suppliedIsrc: t.recordingMismatch?.suppliedIsrc || null,
          matchedIsrc: t.recordingMismatch?.matchedIsrc || null
        });
      }
      if (t.tempoNeedsReview) {
        tempoReviewList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`,
          suggestion: t.tempoSuggestion || null,
          rawBpm: t.rawBpm ?? t.bpm ?? null
        });
      }
      if (t.status === 'verified') {
        verified++;
      } else if (t.status === 'analysed') {
        analysed++;
        analysedList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`
        });
      } else if (t.status === 'single_source') {
        singleSource++;
      } else if (t.status === 'supplied') {
        supplied++;
        suppliedList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`
        });
      } else if (t.status === 'disputed') {
        disputed++;
        disputedList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`,
          details: t.disputeDetails
        });
      } else {
        unverified++;
        unverifiedList.push({
          id: t.id,
          name: `${t.artist} - ${t.title}`,
          reason: t.reason
        });
      }
    }

    const total = tracks.length;
    return {
      total,
      verified,
      analysed,
      singleSource,
      supplied,
      disputed,
      unverified,
      providerErrors: providerErrorList.length,
      providerErrorTracks: providerErrorList,
      providerOutcomeSummary,
      summaryText: `Verified ${verified}/${total}${analysed > 0 ? `, Analysed ${analysed}` : ''}, Single-source ${singleSource}, Disputed ${disputed}, Unverified ${unverified}`,
      analysedTracks: analysedList,
      disputedTracks: disputedList,
      suppliedTracks: suppliedList,
      unverifiedTracks: unverifiedList,
      tempoReviewTracks: tempoReviewList,
      recordingReviewTracks: recordingReviewList,
      isReadyForSequencing: unverified === 0 && disputed === 0 && tempoReviewList.length === 0 && recordingReviewList.length === 0
    };
  }
}
