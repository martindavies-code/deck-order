/**
 * Pure Spotify Mix recipe generator derived from transition cost components.
 * Spotify Mix applies un-synced volume/EQ/filter curves over bars (no beatmatch or key shift),
 * so recommendations depend directly on tempo gap, beat drift, harmonic fit, and loudness delta.
 */

import { evaluateSequence } from '../../../server/core/costMatrix.js';
import { annotateEnergyResets } from '../../../server/core/energyArc.js';

export const PHRASE_GUIDANCE =
  "Start the incoming track on a phrase boundary - use Mix's waveform view to line up the 1.";

export const MIX_CAVEAT =
  'Caveat: Spotify Mix transitions require a supported Spotify Premium app and do not apply over Spotify Connect or on the free tier.';

/**
 * Resolves the saved tracks in the exact URI order of `urisManifest`,
 * preserving duplicate occurrences and excluding tracks omitted from the manifest.
 */
export function resolveManifestTracks(orderedTracks = [], urisManifest = null) {
  const sourceTracks = Array.isArray(orderedTracks) ? orderedTracks : [];
  if (!Array.isArray(urisManifest)) {
    return [...sourceTracks];
  }

  const queuesByUri = new Map();
  const firstByUri = new Map();
  for (const track of sourceTracks) {
    const uri = track?.uri || track?.spotifyUri;
    if (!uri) continue;
    if (!queuesByUri.has(uri)) {
      queuesByUri.set(uri, []);
      firstByUri.set(uri, track);
    }
    queuesByUri.get(uri).push(track);
  }

  return urisManifest.map((uri, idx) => {
    const queue = queuesByUri.get(uri);
    if (queue && queue.length > 0) {
      return queue.shift();
    }
    if (firstByUri.has(uri)) {
      return firstByUri.get(uri);
    }
    return {
      id: `manifest_${idx}_${uri}`,
      uri,
      artist: 'Unknown Artist',
      title: uri
    };
  });
}

function evaluateMixTracks(tracks, enableEnergy = true) {
  const evaluation = evaluateSequence(tracks, { enableEnergy: Boolean(enableEnergy) });
  annotateEnergyResets(evaluation.transitions);
  return evaluation;
}

/**
 * Freezes the exact tracks actually included in a Spotify save manifest and
 * recomputes transition evaluations on that filtered order.
 */
export function buildSavedMixSnapshot(orderedTracks = [], manifest = null, options = {}) {
  const savedTracks = resolveManifestTracks(orderedTracks, manifest?.urisManifest).map(t => ({ ...t }));
  const enableEnergy = options.enableEnergy !== undefined ? Boolean(options.enableEnergy) : true;
  const savedEvaluation = evaluateMixTracks(savedTracks, enableEnergy);
  const savedName = (manifest?.targetPlaylist?.name || options.setName || 'Deck Order Set').toString().trim() || 'Deck Order Set';

  return {
    orderedTracks: savedTracks,
    evaluation: savedEvaluation,
    urisManifest: Array.isArray(manifest?.urisManifest) ? [...manifest.urisManifest] : null,
    setName: savedName
  };
}

export function recommendMixSetting(transition, fromTrack, toTrack) {
  const needsReview = !!(
    fromTrack?.recordingNeedsReview ||
    fromTrack?.tempoNeedsReview ||
    toTrack?.recordingNeedsReview ||
    toTrack?.tempoNeedsReview
  );

  if (
    !transition ||
    needsReview ||
    transition.grade === 'UNVERIFIED' ||
    transition.harmEval?.grade === 'UNVERIFIED' ||
    transition.bpmChange === null ||
    !Number.isFinite(transition.tempoDiffPct)
  ) {
    return {
      preset: 'short 2-4 bar fade or manual cue (verify tempo/key first)',
      badge: 'Verify first',
      tone: 'review'
    };
  }

  const harmClash = transition.harmEval?.grade === 'CLASH' || (typeof transition.harmonicCost === 'number' && transition.harmonicCost > 2);
  const tempoPct = transition.tempoDiffPct;

  // Harmonic clash or large (> 4% / > 5%) tempo jump where beats will gallop or keys fight: cut cleanly.
  if (harmClash || tempoPct > 4.0) {
    const basePreset = transition.isDeliberateReset
      ? '2-bar cut or echo-out, do not blend (deliberate chapter reset)'
      : '2-bar cut or echo-out, do not blend';
    return {
      preset: basePreset,
      badge: '2-bar cut / echo-out',
      tone: 'CLASH'
    };
  }

  // Moderate tempo gap (~1.7% to 4.0%) with compatible keys: keep blend brief before drift builds up.
  if (tempoPct > 1.6) {
    return {
      preset: 'short 4-8 bar fade, consider a low-pass sweep on the outgoing track',
      badge: '4-8 bar fade + LPF',
      tone: 'STRETCH'
    };
  }

  // Tightly matched BPM (<= 1.6%) and harmonically compatible (<= 2 steps / relative): full phrase blend works cleanly.
  return {
    preset: '16-bar blend, Auto preset is fine',
    badge: '16-bar Auto blend',
    tone: 'SMOOTH'
  };
}

export function buildMixRecipe(orderedTracks = [], evaluation = null, setName = 'Deck Order Set', options = {}) {
  const hasManifest = Array.isArray(options?.urisManifest);
  const tracks = hasManifest
    ? resolveManifestTracks(orderedTracks, options.urisManifest)
    : (Array.isArray(orderedTracks) ? orderedTracks : []);
  const effectiveEval = hasManifest
    ? evaluateMixTracks(tracks, options?.enableEnergy !== undefined ? options.enableEnergy : true)
    : evaluation;
  const transitions = Array.isArray(effectiveEval?.transitions) ? effectiveEval.transitions : [];
  const title = (setName || 'Deck Order Set').toString().trim() || 'Deck Order Set';

  const items = tracks.map((track, idx) => {
    const nextTrack = idx < tracks.length - 1 ? tracks[idx + 1] : null;
    const transition = nextTrack ? (transitions[idx] || null) : null;
    const rec = nextTrack ? recommendMixSetting(transition, track, nextTrack) : null;

    const needsReview = !!(
      track?.recordingNeedsReview ||
      track?.tempoNeedsReview ||
      nextTrack?.recordingNeedsReview ||
      nextTrack?.tempoNeedsReview
    );
    const isUnverified = needsReview ||
      !transition ||
      transition.grade === 'UNVERIFIED' ||
      transition.harmEval?.grade === 'UNVERIFIED' ||
      !transition.grade;

    const loudnessWarning = !isUnverified && transition?.loudnessRisk
      ? (transition.loudnessWarning || 'volume dip risk - trim in Mix')
      : null;

    const energyBoost = !isUnverified && transition?.harmEval?.directedStep === 2;
    const driftBeats = !isUnverified && typeof transition?.driftBeats === 'number' && Number.isFinite(transition.driftBeats)
      ? transition.driftBeats
      : null;
    const bpmChange = !isUnverified && typeof transition?.bpmChange === 'number' && Number.isFinite(transition.bpmChange)
      ? transition.bpmChange
      : null;
    const tempoDiffPct = !isUnverified && typeof transition?.tempoDiffPct === 'number' && Number.isFinite(transition.tempoDiffPct)
      ? transition.tempoDiffPct
      : null;

    const fullInstruction = rec
      ? `${rec.preset}${loudnessWarning ? `; ${loudnessWarning}` : ''}`
      : null;

    return {
      position: idx + 1,
      id: track.id,
      artist: track.artist || 'Unknown Artist',
      title: track.title || track.name || 'Untitled Track',
      version: track.version && track.version !== 'Original Mix' ? track.version : '',
      bpm: typeof track.bpm === 'number' && track.bpm > 0 ? track.bpm : null,
      camelot: track.camelot || null,
      loudness: typeof track.loudness === 'number' && Number.isFinite(track.loudness) ? track.loudness : null,
      isLast: !nextTrack,
      transition: nextTrack ? {
        toPosition: idx + 2,
        toArtist: nextTrack.artist || 'Unknown Artist',
        toTitle: nextTrack.title || nextTrack.name || 'Untitled Track',
        grade: isUnverified ? 'UNVERIFIED' : (transition?.grade || 'UNVERIFIED'),
        relation: needsReview ? 'Needs review - unconfirmed tempo/key' : (transition?.relation || ''),
        bpmChange,
        tempoDiffPct,
        driftBeats,
        energyBoost,
        isDeliberateReset: !isUnverified && Boolean(transition?.isDeliberateReset),
        loudnessChange: !isUnverified && typeof transition?.loudnessChange === 'number' ? transition.loudnessChange : null,
        loudnessDiffDb: !isUnverified && typeof transition?.loudnessDiffDb === 'number' ? transition.loudnessDiffDb : null,
        loudnessWarning,
        preset: rec.preset,
        badge: rec.badge,
        tone: rec.tone,
        instruction: fullInstruction
      } : null
    };
  });

  const lines = [
    `DECK ORDER — SPOTIFY MIX RECIPE: ${title} (${tracks.length} tracks)`,
    '',
    `Phrase timing: ${PHRASE_GUIDANCE}`,
    MIX_CAVEAT,
    ''
  ];

  items.forEach((item) => {
    const meta = [
      item.bpm ? `${item.bpm} BPM` : 'BPM ?',
      item.camelot || 'Key ?'
    ].join(' | ');
    const ver = item.version ? ` (${item.version})` : '';
    lines.push(`${String(item.position).padStart(2, '0')}. ${item.artist} - ${item.title}${ver} [${meta}]`);

    if (item.transition) {
      const tr = item.transition;
      const details = [];
      if (tr.bpmChange !== null) {
        details.push(`${tr.bpmChange > 0 ? '+' : ''}${tr.bpmChange} BPM${tr.tempoDiffPct !== null ? ` (${tr.tempoDiffPct}%)` : ''}`);
      }
      if (tr.driftBeats !== null) {
        details.push(`~${tr.driftBeats} beats drift / 16 bars`);
      }
      if (tr.energyBoost) {
        details.push('Energy boost (+2 Camelot)');
      }
      if (tr.loudnessChange !== null) {
        details.push(`${tr.loudnessChange > 0 ? '+' : ''}${tr.loudnessChange} dB`);
      }
      const suffix = details.length > 0 ? ` [${details.join(', ')}]` : '';
      lines.push(`    -> Mix to #${String(tr.toPosition).padStart(2, '0')}: ${tr.instruction}${suffix}`);
    }
  });

  return {
    title,
    phraseGuidance: PHRASE_GUIDANCE,
    caveat: MIX_CAVEAT,
    items,
    plainText: lines.join('\n')
  };
}
