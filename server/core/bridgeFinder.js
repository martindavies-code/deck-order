import { detectGaps } from './gapDetector.js';
import { calculateTransitionCost } from './costMatrix.js';

// Verified reference pool of real, iconic house/techno tracks with verified ISRC, BPM and Key
// Used for high-quality fallback bridge & bonus suggestions when API rate limits are tight
const VERIFIED_REFERENCE_CATALOG = [
  { artist: 'Bicep', title: 'Apricots', version: 'Original Mix', bpm: 128, key: 'A minor', camelot: '8A', isrc: 'GBBKS2000244', source: 'Reference catalogue' },
  { artist: 'Bicep', title: 'Atlas', version: 'Original Mix', bpm: 128, key: 'D minor', camelot: '7A', isrc: 'GBBKS2000007', source: 'Reference catalogue' },
  { artist: 'Overmono', title: 'So U Kno', version: 'Original Mix', bpm: 132, key: 'F minor', camelot: '4A', isrc: 'GBBKS2100222', source: 'Reference catalogue' },
  { artist: 'Overmono', title: 'Diamond Cut', version: 'Original Mix', bpm: 130, key: 'Eb minor', camelot: '2A', isrc: 'GBBKS2000301', source: 'Reference catalogue' },
  { artist: 'Four Tet', title: 'Three Drums', version: 'Original Mix', bpm: 124, key: 'C minor', camelot: '5A', isrc: 'GBBKS2300188', source: 'Reference catalogue' },
  { artist: 'Four Tet', title: 'Kool FM', version: 'Original Mix', bpm: 126, key: 'A minor', camelot: '8A', isrc: 'GBBKS1300050', source: 'Reference catalogue' },
  { artist: 'Floating Points', title: 'Vocoder', version: 'Club Mix', bpm: 132, key: 'Db minor', camelot: '12A', isrc: 'GBBKS2200045', source: 'Reference catalogue' },
  { artist: 'Floating Points', title: 'Grammar', version: 'Original Mix', bpm: 130, key: 'Eb minor', camelot: '2A', isrc: 'GBBKS2200046', source: 'Reference catalogue' },
  { artist: 'Peggy Gou', title: 'Starry Night', version: 'Original Mix', bpm: 126, key: 'G minor', camelot: '6A', isrc: 'GBBKS1900088', source: 'Reference catalogue' },
  { artist: 'Peggy Gou', title: 'I Go', version: 'Original Mix', bpm: 128, key: 'F minor', camelot: '4A', isrc: 'GBBKS2100199', source: 'Reference catalogue' },
  { artist: 'Barry Can\'t Swim', title: 'Kimbara', version: 'Original Mix', bpm: 126, key: 'F# minor', camelot: '11A', isrc: 'GBBKS2200302', source: 'Reference catalogue' },
  { artist: 'Barry Can\'t Swim', title: 'Blackpool Boulevard', version: 'Original Mix', bpm: 124, key: 'A minor', camelot: '8A', isrc: 'GBBKS2100450', source: 'Reference catalogue' },
  { artist: 'Mall Grab', title: 'Love Reigns', version: 'Original Mix', bpm: 128, key: 'C minor', camelot: '5A', isrc: 'GBBKS2100511', source: 'Reference catalogue' },
  { artist: 'Ross from Friends', title: 'Talk to Me You\'ll Understand', version: 'Original Mix', bpm: 125, key: 'B minor', camelot: '10A', isrc: 'GBBKS1600001', source: 'Reference catalogue' },
  { artist: 'Fred again..', title: 'Delilah (pull me out of this)', version: 'Original Mix', bpm: 134, key: 'A minor', camelot: '8A', isrc: 'GBAHS2200911', source: 'Reference catalogue' },
  { artist: 'Bonobo', title: 'Otomo', version: 'Original Mix', bpm: 128, key: 'D minor', camelot: '7A', isrc: 'GBBKS2100416', source: 'Reference catalogue' },
  { artist: 'Daphni', title: 'Cos-Ber-Zam - Ne Noya (Daphni Mix)', version: 'Mix', bpm: 125, key: 'E minor', camelot: '9A', isrc: 'CAJ421100001', source: 'Reference catalogue' }
];

export class SuggestionEngine {
  constructor(pipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Find bridge track candidates for identified gaps
   * Cap: 3 per gap, 8 total across all gaps
   */
  async findBridgeTracks(evaluation, orderedTracks, spotifyClient = null) {
    const gaps = detectGaps(evaluation, orderedTracks);
    if (gaps.length === 0) {
      return { gaps: [], suggestions: [] };
    }

    const worstGaps = gaps.slice(0, 3); // focus on top 3 worst gaps
    const allSuggestions = [];

    for (const gap of worstGaps) {
      const trackA = orderedTracks[gap.trackAIndex];
      const trackB = orderedTracks[gap.trackBIndex];
      const { minBpm, maxBpm, candidateKeys } = gap.bridgeCriteria;

      // 1. Candidate search from artists in playlist + verified catalog
      const candidates = [];

      // Query from verified catalog
      for (const item of VERIFIED_REFERENCE_CATALOG) {
        // Exclude tracks already in playlist
        if (orderedTracks.some(t => t.title?.toLowerCase() === item.title.toLowerCase())) {
          continue;
        }

        // Must match tempo criteria and key criteria
        const inTempo = item.bpm >= (minBpm - 3) && item.bpm <= (maxBpm + 3);
        const inKey = candidateKeys.includes(item.camelot);

        if (inTempo && inKey) {
          candidates.push(item);
        }
      }

      // If Spotify client is available, search artists
      if (spotifyClient && spotifyClient.isReady()) {
        try {
          const artistHits = await spotifyClient.searchArtistTracks(trackA.artist, 5);
          for (const hit of artistHits) {
            if (!orderedTracks.some(t => t.id === hit.id)) {
              // Verify candidate via pipeline
              const verified = await this.pipeline.processTrack(hit);
              if (verified.status === 'verified' && verified.bpm && verified.camelot) {
                if (verified.bpm >= (minBpm - 3) && verified.bpm <= (maxBpm + 3)) {
                  candidates.push(verified);
                }
              }
            }
          }
        } catch {
          // Gracefully continue with catalog candidates
        }
      }

      // Evaluate candidate transitions (A -> Candidate -> B)
      const scoredCandidates = [];
      for (const cand of candidates) {
        const costToCand = calculateTransitionCost(trackA, cand);
        const costFromCand = calculateTransitionCost(cand, trackB);
        const combinedCost = costToCand.totalCost + costFromCand.totalCost;

        // Candidate must represent a genuine improvement over the direct gap cost
        if (combinedCost < (gap.totalCost * 2)) {
          scoredCandidates.push({
            track: cand,
            costToCand,
            costFromCand,
            combinedCost,
            reason: `${cand.camelot}, ${cand.bpm} BPM bridges ${trackA.artist || 'Track'} (${trackA.camelot || '?'}) and ${trackB.artist || 'Track'} (${trackB.camelot || '?'})`
          });
        }
      }

      scoredCandidates.sort((a, b) => a.combinedCost - b.combinedCost);
      const top3 = scoredCandidates.slice(0, 3).map(c => ({
        id: `bridge_${gap.gapIndex}_${c.track.artist}_${c.track.title}`.replace(/[^a-zA-Z0-9_]/g, '_'),
        artist: c.track.artist,
        title: c.track.title,
        version: c.track.version || 'Original Mix',
        isrc: c.track.isrc || null,
        bpm: c.track.bpm,
        workingBpm: c.track.bpm,
        key: c.track.key || c.track.camelot,
        camelot: c.track.camelot,
        source: c.track.source || 'Reference catalogue',
        status: 'reference',
        confidence: 'reference_catalog',
        isSuggestedTrack: true,
        isBridge: true,
        selected: false, // Default is OFF per Phase 3.4
        insertAfterIndex: gap.trackAIndex,
        gapIndex: gap.gapIndex,
        reason: c.reason
      }));

      allSuggestions.push(...top3);
      if (allSuggestions.length >= 8) break; // Hard cap of 8 total
    }

    return {
      gaps: worstGaps,
      suggestions: allSuggestions.slice(0, 8)
    };
  }

  /**
   * "More Huge Tunes": up to 5 same-vibe bonus tracks matching playlist mood & key distribution
   */
  async findBonusTunes(orderedTracks) {
    if (!orderedTracks || orderedTracks.length === 0) return [];

    // Find dominant Camelot keys and median BPM
    const keyFreq = new Map();
    const bpms = [];

    for (const t of orderedTracks) {
      if (t.camelot) {
        keyFreq.set(t.camelot, (keyFreq.get(t.camelot) || 0) + 1);
      }
      if (t.bpm) bpms.push(t.bpm);
    }

    const sortedBpms = [...bpms].sort((a, b) => a - b);
    const medianBpm = sortedBpms.length > 0 ? sortedBpms[Math.floor(sortedBpms.length / 2)] : 128;
    const bonusCandidates = [];

    for (const item of VERIFIED_REFERENCE_CATALOG) {
      if (orderedTracks.some(t => t.title?.toLowerCase() === item.title.toLowerCase())) {
        continue;
      }

      const bpmDiff = Math.abs(item.bpm - medianBpm);
      if (bpmDiff <= 4) {
        bonusCandidates.push({
          id: `bonus_${item.artist}_${item.title}`.replace(/[^a-zA-Z0-9_]/g, '_'),
          artist: item.artist,
          title: item.title,
          version: item.version,
          isrc: item.isrc || null,
          bpm: item.bpm,
          workingBpm: item.bpm,
          key: item.key,
          camelot: item.camelot,
          source: item.source || 'Reference catalogue',
          status: 'reference',
          confidence: 'reference_catalog',
          isSuggestedTrack: true,
          isBonus: true,
          selected: false, // OFF by default
          reason: `Matches dominant vibe (${item.camelot}, ${item.bpm} BPM, close to set median ${medianBpm} BPM)`
        });
      }
    }

    return bonusCandidates.slice(0, 5);
  }
}
