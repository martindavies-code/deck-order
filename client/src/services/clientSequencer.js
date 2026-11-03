/**
 * In-browser Fallback Engine for GitHub Pages (Static Hosting)
 * Enables 100% full sequencing, Camelot wheel analysis, CSV parsing,
 * and TuneMyMusic export directly in the browser without requiring a backend.
 */

import { parseKey, evaluateHarmonicTransition } from '../../../server/core/camelot.js';
import { calculateTransitionCost, evaluateSequence } from '../../../server/core/costMatrix.js';
import { DJSequencer } from '../../../server/core/solver.js';
import { parseTracklistCSV } from '../../../server/providers/csvParser.js';
import { generatePlainTextTracklist, generateCSVExport } from './formatters.js';

export {
  parseKey,
  evaluateHarmonicTransition,
  calculateTransitionCost,
  evaluateSequence,
  DJSequencer,
  parseTracklistCSV,
  generatePlainTextTracklist,
  generateCSVExport
};
