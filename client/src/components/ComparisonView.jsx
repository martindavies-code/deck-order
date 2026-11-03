import React from 'react';
import { ArrowRight, Sparkles, TrendingUp, BarChart3 } from 'lucide-react';

export function ComparisonView({
  originalEvaluation,
  sequencedEvaluation,
  viewMode,
  onToggleViewMode
}) {
  if (!originalEvaluation || !sequencedEvaluation) return null;

  const costDelta = Math.round((originalEvaluation.totalCost - sequencedEvaluation.totalCost) * 10) / 10;
  const smoothDelta = sequencedEvaluation.smoothPct - originalEvaluation.smoothPct;

  return (
    <div className="deck-card p-4 sm:p-5 mb-6 bg-[#10131d] border-[#1e2336]">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Comparison Metrics */}
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Harmonic Flow (Smooth %)
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {originalEvaluation.smoothPct}%
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-sm font-mono font-extrabold text-emerald-400 tabular-nums">
                {sequencedEvaluation.smoothPct}%
              </span>
              {smoothDelta > 0 && (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-800/40 tabular-nums">
                  +{smoothDelta}%
                </span>
              )}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-[#1e2336] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Total Transition Cost
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {originalEvaluation.totalCost.toFixed(1)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-sm font-mono font-extrabold text-cyan-400 tabular-nums">
                {sequencedEvaluation.totalCost.toFixed(1)}
              </span>
              {costDelta > 0 && (
                <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-800/40 tabular-nums">
                  -{costDelta.toFixed(1)}
                </span>
              )}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-[#1e2336] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Harmonic Clashes
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-rose-400 font-bold tabular-nums">
                {originalEvaluation.clashCount}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-sm font-mono font-extrabold text-emerald-400 tabular-nums">
                {sequencedEvaluation.clashCount}
              </span>
            </div>
          </div>
        </div>

        {/* View Toggle (Responsive Grid on Mobile) */}
        <div className="grid grid-cols-2 gap-1 w-full sm:w-auto bg-[#0a0c14] p-1 rounded-lg border border-[#1d2235]">
          <button
            onClick={() => onToggleViewMode('sequenced')}
            className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-bold transition-all text-center flex items-center justify-center ${
              viewMode === 'sequenced'
                ? 'bg-emerald-500 text-black shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            DJ Sequence
          </button>
          <button
            onClick={() => onToggleViewMode('original')}
            className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-bold transition-all text-center flex items-center justify-center ${
              viewMode === 'original'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Original Order
          </button>
        </div>
      </div>
    </div>
  );
}
