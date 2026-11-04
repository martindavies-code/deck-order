import React from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';

export function ComparisonView({
  originalEvaluation,
  sequencedEvaluation,
  viewMode,
  onToggleViewMode,
  onRestoreOriginal,
  hasPartialData = false
}) {
  if (!originalEvaluation || !sequencedEvaluation) return null;

  const costDelta = Math.round((originalEvaluation.totalCost - sequencedEvaluation.totalCost) * 10) / 10;
  const smoothDelta = (sequencedEvaluation.smoothPct ?? 0) - (originalEvaluation.smoothPct ?? 0);
  const fmtPct = (v) => (typeof v === 'number' ? `${v}%` : 'n/a');
  const fmtScore = (ev) => ((ev.gradedCount ?? 0) > 0 ? ev.totalCost.toFixed(1) : 'n/a');
  const fmtJumps = (ev) => ((ev.gradedCount ?? 0) > 0 ? ev.clashCount : 'n/a');
  const origGraded = (originalEvaluation.gradedCount ?? 0) > 0;
  const seqGraded = (sequencedEvaluation.gradedCount ?? 0) > 0;

  return (
    <div className="deck-panel p-4 sm:p-5 space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Comparison Metrics with Tabular Numbers */}
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap text-xs">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#7E8876]">
              Smooth handovers
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[#BAC2B3] tabular-nums">
                {fmtPct(originalEvaluation.smoothPct)}
              </span>
              <ArrowRight className="w-3 h-3 text-[#7E8876]" />
              <span className="font-mono font-bold text-[#F3F0E6] tabular-nums">
                {fmtPct(sequencedEvaluation.smoothPct)}
              </span>
              {smoothDelta > 0 && (
                <span className="text-[10px] font-mono text-[#86EFAC] bg-[rgba(74,222,128,0.12)] px-1.5 py-0.2 rounded border border-[rgba(74,222,128,0.25)] tabular-nums">
                  +{smoothDelta}%
                </span>
              )}
            </div>
          </div>

          <div className="h-7 w-[1px] bg-[#394133] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#7E8876]">
              Transition score
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[#BAC2B3] tabular-nums">
                {fmtScore(originalEvaluation)}
              </span>
              <ArrowRight className="w-3 h-3 text-[#7E8876]" />
              <span className="font-mono font-bold text-[#D6FC55] tabular-nums">
                {fmtScore(sequencedEvaluation)}
              </span>
              {origGraded && seqGraded && costDelta > 0 && (
                <span className="text-[10px] font-mono text-[#D6FC55] bg-[rgba(214,252,85,0.1)] px-1.5 py-0.2 rounded border border-[rgba(214,252,85,0.25)] tabular-nums">
                  -{costDelta.toFixed(1)}
                </span>
              )}
            </div>
          </div>

          <div className="h-7 w-[1px] bg-[#394133] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#7E8876]">
              Key step jumps
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[#FCA5A5] tabular-nums">
                {fmtJumps(originalEvaluation)}
              </span>
              <ArrowRight className="w-3 h-3 text-[#7E8876]" />
              <span className="font-mono font-bold text-[#F3F0E6] tabular-nums">
                {fmtJumps(sequencedEvaluation)}
              </span>
            </div>
          </div>

          {sequencedEvaluation.unverifiedCount > 0 && (
            <>
              <div className="h-7 w-[1px] bg-[#394133] hidden sm:block" />
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#7E8876]">
                  {hasPartialData ? 'Ungraded (incomplete data)' : 'Ungraded (no data)'}
                </span>
                <div className="font-mono font-bold text-[#BAC2B3] tabular-nums mt-0.5">
                  {sequencedEvaluation.unverifiedCount}
                </div>
              </div>
            </>
          )}
        </div>

        {/* View Toggle & Reset */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          {onRestoreOriginal && (
            <button
              onClick={onRestoreOriginal}
              className="deck-btn-ghost text-xs text-[#BAC2B3] hover:text-[#F3F0E6]"
              title="Reset order back to the original imported sequence"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-1 bg-[#10120F] p-1 rounded-md border border-[#394133] flex-1 sm:flex-none">
            <button
              onClick={() => onToggleViewMode('sequenced')}
              className={`min-h-[36px] px-3 py-1 rounded text-xs font-semibold transition-colors flex items-center justify-center ${
                viewMode === 'sequenced'
                  ? 'bg-[#252B22] text-[#D6FC55] border border-[#394133]'
                  : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
              }`}
            >
              Suggested order
            </button>
            <button
              onClick={() => onToggleViewMode('original')}
              className={`min-h-[36px] px-3 py-1 rounded text-xs font-semibold transition-colors flex items-center justify-center ${
                viewMode === 'original'
                  ? 'bg-[#252B22] text-[#F3F0E6] border border-[#394133]'
                  : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
              }`}
            >
              Original order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
