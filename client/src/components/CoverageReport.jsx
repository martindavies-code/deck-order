import React from 'react';
import { Check, AlertTriangle, Play, HelpCircle } from 'lucide-react';

export function CoverageReport({
  report,
  unverifiedStrategy,
  onChangeStrategy,
  onOpenDisputes,
  onRunSequencer,
  isLoading,
  enableEnergy,
  onToggleEnergy
}) {
  if (!report) return null;

  return (
    <section className="deck-panel p-5 space-y-4">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        {/* Metric Overview */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#F3F0E6] uppercase tracking-wide font-sans">
              Know what you're working with
            </h3>
            <span className="text-xs text-[#7E8876] font-mono">
              ({report.total} tracks)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Corroborated */}
            {report.corroborated > 0 && (
              <span className="badge-status badge-status-corroborated">
                <Check className="w-3.5 h-3.5 text-[#86EFAC]" />
                <span>Corroborated ({report.corroborated})</span>
              </span>
            )}

            {/* Single Source */}
            {report.singleSource > 0 && (
              <span className="badge-status badge-status-single">
                <span>Single source ({report.singleSource})</span>
              </span>
            )}

            {/* Supplied by user */}
            {report.supplied > 0 && (
              <span className="badge-status badge-status-supplied">
                <span>Supplied by you ({report.supplied})</span>
              </span>
            )}

            {/* Sample data */}
            {report.sample > 0 && (
              <span className="badge-status badge-status-sample">
                <span>Sample data ({report.sample})</span>
              </span>
            )}

            {/* Sources disagree */}
            {report.disputed > 0 && (
              <button
                onClick={onOpenDisputes}
                className="badge-status badge-status-disputed hover:border-[#EAB308] cursor-pointer transition-colors"
                title="Review track metadata disagreements"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-[#FDE047]" />
                <span>Sources disagree ({report.disputed})</span>
              </button>
            )}

            {/* Missing data */}
            {(report.missing > 0 || report.unverified > 0) && (
              <span className="badge-status badge-status-missing">
                <HelpCircle className="w-3.5 h-3.5 text-[#FCA5A5]" />
                <span>Missing data ({report.missing || report.unverified})</span>
              </span>
            )}
          </div>

          {/* Per-dimension coverage: grading needs tempo AND key on both tracks of a handover */}
          {report.total > 0 && (report.missing || report.unverified || 0) > 0 && (report.sample || 0) === 0 && (
            <p className="text-[11px] text-[#BAC2B3] max-w-xl leading-relaxed">
              {typeof report.missingTempo === 'number' && typeof report.missingKey === 'number'
                ? (report.missingTempo >= report.total && report.missingKey >= report.total
                  ? 'No tempo or key data for these tracks, so handovers cannot be graded yet. Spotify does not share BPM or key, and no metadata provider is configured on this static deployment. '
                  : `Tempo known for ${report.total - report.missingTempo} of ${report.total} tracks; key known for ${report.total - report.missingKey} of ${report.total}. A handover can only be graded when both tracks have both values. `)
                : 'Some tracks are missing tempo or key data; a handover can only be graded when both tracks have both values. '}
              You can paste a tracklist with BPM and key columns (for example an export from your DJ
              software), set custom values per track in the inspector, or run the local server with
              metadata providers configured.
            </p>
          )}
        </div>

        {/* Options & Sequencer Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 w-full lg:w-auto">
          {/* Strategy selector */}
          <div className="space-y-1">
            <label htmlFor="unverified-strategy-select" className="text-xs font-semibold text-[#BAC2B3] block">
              Tracks with missing data
            </label>
            <select
              id="unverified-strategy-select"
              value={unverifiedStrategy}
              onChange={(e) => onChangeStrategy(e.target.value)}
              className="deck-select text-xs min-h-[44px] sm:w-64"
            >
              <option value="keep_relative_position">Keep their relative order</option>
              <option value="cluster_at_start">Place at start of set</option>
              <option value="cluster_at_end">Place at end of set</option>
              <option value="exclude">Exclude from running order</option>
            </select>
          </div>

          {/* Sequence Action button */}
          <button
            onClick={onRunSequencer}
            disabled={isLoading}
            className="deck-btn-primary text-xs px-5 sm:w-auto justify-center"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isLoading ? 'Building running order...' : 'Build my running order'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
