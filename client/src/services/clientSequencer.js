/**
 * In-browser Fallback Engine for GitHub Pages (Static Hosting)
 * Enables 100% full sequencing, Camelot wheel analysis, CSV parsing,
 * and TuneMyMusic export directly in the browser without requiring a backend.
 */

import { parseKey, evaluateHarmonicTransition } from '../../../server/core/camelot.js';
import { calculateTransitionCost, evaluateSequence } from '../../../server/core/costMatrix.js';
import { DJSequencer } from '../../../server/core/solver.js';
import { annotateEnergyResets } from '../../../server/core/energyArc.js';
import { SuggestionEngine } from '../../../server/core/bridgeFinder.js';
import { parseTracklistCSV } from '../../../server/providers/csvParser.js';
import { generatePlainTextTracklist, generateCSVExport, generateM3U8Export } from './formatters.js';

/**
 * Grade the order the user actually sees. DJSequencer.solve() evaluates its
 * own re-optimised order, so handlers that keep the user's current order
 * (manual reorder, track removal, undo) must NOT take result.evaluation from
 * a solve run - it would grade a sequence that is not on screen. This runs
 * the same grading the solver uses, but on the given order, and never
 * reorders or mutates the input.
 */
export function evaluateCurrentOrder(tracks, options = {}) {
  const evaluation = evaluateSequence(tracks || [], { enableEnergy: Boolean(options.enableEnergy) });
  annotateEnergyResets(evaluation.transitions);
  return evaluation;
}

export async function generateOfflineSuggestions(evaluation, orderedTracks) {
  if (!Array.isArray(orderedTracks) || orderedTracks.length === 0) {
    return { success: true, gaps: [], bridgeSuggestions: [], bonusTunes: [] };
  }
  const engine = new SuggestionEngine(null);
  const effectiveEval = evaluation || evaluateCurrentOrder(orderedTracks);
  const bridgeData = await engine.findBridgeTracks(effectiveEval, orderedTracks, null);
  const bonusTunes = await engine.findBonusTunes(orderedTracks);
  return {
    success: true,
    gaps: bridgeData.gaps,
    bridgeSuggestions: bridgeData.suggestions,
    bonusTunes
  };
}

export {
  parseKey,
  evaluateHarmonicTransition,
  calculateTransitionCost,
  evaluateSequence,
  DJSequencer,
  SuggestionEngine,
  parseTracklistCSV,
  generatePlainTextTracklist,
  generateCSVExport,
  generateM3U8Export
};
