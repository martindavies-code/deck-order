import { parseKey } from './camelot.js';
import { GetSongBPMProvider } from '../providers/getsongbpm.js';
import { SonovaultProvider } from '../providers/sonovault.js';
import { SoundNetProvider } from '../providers/soundnet.js';
import { FreqBlogProvider } from '../providers/freqblog.js';

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

  // 1. Check for version mismatch
  const mismatch = detectVersionMismatch(recA, recB);
  if (mismatch.isMismatch) {
    return {
      status: 'unverified',
      confidence: 'version_mismatch',
      reason: `Potential version mismatch (${mismatch.reason}). Cross-source comparison invalidated.`,
      disputeDetails: null,
      chosenBpm: recA.bpm || recB.bpm,
      chosenCamelot: recA.camelot || recB.camelot
    };
  }

  // 2. Normalize tempos
  const normA = normalizeTempo(recA.bpm, minBpm, maxBpm);
  const normB = normalizeTempo(recB.bpm, minBpm, maxBpm);

  if (!normA.workingBpm || !normB.workingBpm || !recA.camelot || !recB.camelot) {
    return {
      status: 'unverified',
      confidence: 'incomplete_data',
      reason: 'One or both sources lack verified tempo or musical key/mode.',
      chosenBpm: normA.workingBpm || normB.workingBpm,
      chosenCamelot: recA.camelot || recB.camelot
    };
  }

  // Check tempo agreement: within 2%
  const avgBpm = (normA.workingBpm + normB.workingBpm) / 2;
  const bpmDiffPercent = (Math.abs(normA.workingBpm - normB.workingBpm) / avgBpm) * 100;
  const tempoAgrees = bpmDiffPercent <= 2.0;

  // Check key agreement: identical Camelot value
  const keyAgrees = recA.camelot === recB.camelot;

  const energy = mergeOptionalMetric(recA.energy, recB.energy, 100);
  const loudness = mergeOptionalMetric(recA.loudness, recB.loudness, 10);

  if (tempoAgrees && keyAgrees) {
    return {
      status: 'verified',
      confidence: 'two_sources_agreed',
      bpm: Math.round(avgBpm * 10) / 10,
      rawBpm: recA.rawBpm || recA.bpm,
      workingBpm: Math.round(avgBpm * 10) / 10,
      isNormalized: normA.isNormalized || normB.isNormalized,
      camelot: recA.camelot,
      key: recA.key || recA.camelot,
      energy,
      loudness,
      sources: [recA, recB],
      disputeDetails: null
    };
  }

  // They disagree! Mark as DISPUTED
  const disputeReasons = [];
  if (!tempoAgrees) {
    disputeReasons.push(`BPM discrepancy: ${recA.provider || 'Source A'} has ${normA.workingBpm} BPM, ${recB.provider || 'Source B'} has ${normB.workingBpm} BPM (diff ${bpmDiffPercent.toFixed(1)}% > 2%)`);
  }
  if (!keyAgrees) {
    disputeReasons.push(`Key discrepancy: ${recA.provider || 'Source A'} has ${recA.camelot} (${recA.key || 'unknown'}), ${recB.provider || 'Source B'} has ${recB.camelot} (${recB.key || 'unknown'})`);
  }

  return {
    status: 'disputed',
    confidence: 'disputed',
    reason: disputeReasons.join('; '),
    bpm: normA.workingBpm, // default view, pending user override
    workingBpm: normA.workingBpm,
    isNormalized: normA.isNormalized,
    camelot: recA.camelot,
    key: recA.key,
    energy,
    loudness,
    sources: [recA, recB],
    disputeDetails: {
      sourceA: { ...recA, workingBpm: normA.workingBpm, isNormalized: normA.isNormalized },
      sourceB: { ...recB, workingBpm: normB.workingBpm, isNormalized: normB.isNormalized },
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
    this.getSongBPM = new GetSongBPMProvider(options.getSongBpmKey);
    this.sonovault = new SonovaultProvider(options.sonovaultKey);
    this.soundNet = new SoundNetProvider(options.soundNetKey, options.soundNetOptions || {});
    this.freqblog = new FreqBlogProvider(options.freqblogKey, options.freqblogOptions || {});
    this.userOverrides = new Map(); // trackId -> { bpm, key, camelot, energy }
  }

  setManualOverride(trackId, overrideData) {
    const parsedKey = overrideData.key ? parseKey(overrideData.key) : null;
    this.userOverrides.set(trackId, {
      bpm: overrideData.bpm ? parseFloat(overrideData.bpm) : undefined,
      key: overrideData.key || undefined,
      camelot: parsedKey?.camelot || overrideData.camelot,
      energy: overrideData.energy !== undefined ? parseFloat(overrideData.energy) : undefined,
      timestamp: Date.now()
    });
  }

  getManualOverride(trackId) {
    return this.userOverrides.get(trackId) || null;
  }

  clearManualOverride(trackId) {
    this.userOverrides.delete(trackId);
  }

  /**
   * Process a single track through providers and verification rules
   */
  async processTrack(track) {
    const trackId = track.id || `${track.artist}-${track.title}`;

    // 1. Check for user manual override (User override ALWAYS wins)
    const override = this.getManualOverride(trackId);
    if (override) {
      const norm = normalizeTempo(override.bpm, this.minBpm, this.maxBpm);
      return {
        ...track,
        bpm: norm.workingBpm,
        rawBpm: override.bpm,
        workingBpm: norm.workingBpm,
        isNormalized: norm.isNormalized,
        key: override.key || track.key,
        camelot: override.camelot,
        energy: override.energy !== undefined ? override.energy : (track.energy ?? null),
        status: 'verified',
        confidence: 'user_override',
        provenance: 'Manual user override applied',
        sources: [
          ...(track.sources || []),
          { name: 'User Override', bpm: override.bpm, camelot: override.camelot, key: override.key }
        ]
      };
    }

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
        confidence: 'manual'
      };
    }

    // 3. Query external independent providers
    const trackQuery = {
      artist: track.artist,
      title: track.title,
      isrc: track.isrc,
      version: track.version,
      durationMs: track.duration_ms
    };

    const providerPromises = [];
    if (this.getSongBPM.isConfigured()) {
      providerPromises.push(this.getSongBPM.lookupTrack(trackQuery));
    }
    if (this.sonovault.isConfigured()) {
      providerPromises.push(this.sonovault.lookupTrack(trackQuery));
    }
    if (this.soundNet.isConfigured()) {
      providerPromises.push(this.soundNet.lookupTrack(trackQuery));
    }
    if (this.freqblog.isConfigured()) {
      providerPromises.push(this.freqblog.lookupTrack(trackQuery));
    }

    const results = await Promise.all(providerPromises);
    const successfulHits = results
      .filter(r => r.success && r.data && r.data.bpm && r.data.camelot)
      .map(r => r.data);

    // If manual sources were already attached to track (e.g. from CSV or previous lookup)
    if (track.sources && track.sources.length > 0) {
      for (const s of track.sources) {
        // A manual/CSV entry with no tempo or key is an empty placeholder,
        // not evidence: it must not count as a corroborating source.
        if (!(s && (s.bpm || s.camelot))) continue;
        if (!successfulHits.some(h => h.provider === s.name)) {
          successfulHits.push(s);
        }
      }
    }

    // Case A: 2 or more independent sources found
    if (successfulHits.length >= 2) {
      const evaluation = evaluateTwoSources(successfulHits[0], successfulHits[1], {
        minBpm: this.minBpm,
        maxBpm: this.maxBpm
      });

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
        reason: evaluation.reason,
        sources: successfulHits
      };
    }

    // Case B: Exactly 1 source found
    if (successfulHits.length === 1) {
      const hit = successfulHits[0];
      const rawBpm = hit.rawBpm || hit.bpm;
      const norm = normalizeTempo(rawBpm, this.minBpm, this.maxBpm);
      const suppliedBpm = typeof track.bpm === 'number' && track.bpm > 0 ? track.bpm : null;
      // A generic placeholder version (e.g. parser default 'Original Mix')
      // is not real version identity: show the matched record's tag instead.
      const trackVersion = (track.version || '').toLowerCase().trim();
      const genericVersion = !trackVersion || trackVersion === 'original mix' || trackVersion === 'original';
      const matchedVersion = hit.version || hit.mixName || null;
      // A matched record whose ISRC differs from the track's own ISRC is a
      // name/version match, not a proven recording: keep the values visible
      // but flag the recording identity for review and keep the track out of
      // confident grading until confirmed.
      const recordingMismatch = track.isrc && hit.isrc && hit.isrc !== track.isrc
        ? { suppliedIsrc: track.isrc, matchedIsrc: hit.isrc }
        : null;

      let bpm = rawBpm;
      let workingBpm = rawBpm;
      let isNormalized = false;
      let tempoSuggestion = null;
      let tempoNeedsReview = false;
      let status = 'single_source';
      let disputeDetails = null;
      let reason = 'Only one source available. Can be cross-checked via CSV or confirmed.';

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
          disputeDetails = {
            type: 'bpm_conflict',
            supplied: suppliedBpm,
            raw: rawBpm,
            suggested: norm.workingBpm
          };
          reason = `Supplied ${suppliedBpm} BPM matches neither the raw ${rawBpm} BPM nor the octave-adjusted ${norm.workingBpm} BPM.`;
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

      if (recordingMismatch) {
        reason += ` Matched record ISRC ${recordingMismatch.matchedIsrc} differs from this track's ${recordingMismatch.suppliedIsrc}: tempo/key come from that record and need confirmation.`;
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
        confidence: hit.confidence || 'single_source',
        disputeDetails,
        sources: successfulHits,
        reason
      };
    }

    // Case C: No verified sources found
    return {
      ...track,
      bpm: null,
      workingBpm: null,
      key: null,
      camelot: null,
      energy: null,
      loudness: null,
      status: 'unverified',
      confidence: 'none',
      sources: [],
      reason: 'No external BPM or musical key found in configured providers.'
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
    let singleSource = 0;
    let disputed = 0;
    let unverified = 0;

    const disputedList = [];
    const unverifiedList = [];
    const tempoReviewList = [];
    const recordingReviewList = [];

    for (const t of tracks) {
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
      } else if (t.status === 'single_source') {
        singleSource++;
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
      singleSource,
      disputed,
      unverified,
      summaryText: `Verified ${verified}/${total}, Single-source ${singleSource}, Disputed ${disputed}, Unverified ${unverified}`,
      disputedTracks: disputedList,
      unverifiedTracks: unverifiedList,
      tempoReviewTracks: tempoReviewList,
      recordingReviewTracks: recordingReviewList,
      isReadyForSequencing: unverified === 0 && disputed === 0 && tempoReviewList.length === 0 && recordingReviewList.length === 0
    };
  }
}
