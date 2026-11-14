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
  const enableEnergy = options.enableEnergy !== undefined ? Boolean(options.enableEnergy) : true;
  const evaluation = evaluateSequence(tracks || [], { enableEnergy });
  annotateEnergyResets(evaluation.transitions);
  return evaluation;
}

/**
 * Insert selected bridge/bonus suggestions into the running order.
 * Bridges land right after the track their gap starts on (insertAfterIndex),
 * bonus tunes append at the end. When several bridges target the same gap,
 * they keep the order the user saw them in (no reversal). Pure: returns a
 * new list, never mutates the inputs.
 */
export function insertSuggestionsIntoOrder(orderedTracks, selectedBridges, selectedBonus, stamp = Date.now()) {
  const updatedList = [...orderedTracks];
  const groups = new Map(); // insertAfterIndex (or null) -> items in displayed order
  for (const item of selectedBridges) {
    const key = item.insertAfterIndex === undefined || item.insertAfterIndex === null ? null : item.insertAfterIndex;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const positionsDesc = [...groups.keys()].sort(
    (a, b) => (b === null ? updatedList.length : b) - (a === null ? updatedList.length : a)
  );
  let seq = 0;
  for (const pos of positionsDesc) {
    const items = groups.get(pos);
    const targetAfter = pos === null ? updatedList.length : Math.min(updatedList.length, pos + 1);
    const inserts = items.map(item => ({
      ...item,
      id: `bridge_${stamp}_${seq++}_${item.id || 'track'}`,
      selected: false
    }));
    updatedList.splice(targetAfter, 0, ...inserts);
  }
  selectedBonus.forEach((item, idx) => {
    updatedList.push({
      ...item,
      id: `bonus_${stamp}_${idx}_${item.id || 'track'}`,
      selected: false
    });
  });
  return updatedList;
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
