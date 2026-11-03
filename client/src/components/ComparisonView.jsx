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
    <div className="deck-card p-5 mb-6 bg-[#111420] border-[#22273d]">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Comparison Metrics */}
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Harmonic Flow (Smooth %)
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-mono text-slate-400">
                {originalEvaluation.smoothPct}%
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-base font-mono font-extrabold text-emerald-400">
                {sequencedEvaluation.smoothPct}%
              </span>
              {smoothDelta > 0 && (
                <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                  +{smoothDelta}%
                </span>
              )}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-[#22273d] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Total Transition Cost
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-mono text-slate-400">
                {originalEvaluation.totalCost}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-base font-mono font-extrabold text-cyan-400">
                {sequencedEvaluation.totalCost}
              </span>
              {costDelta > 0 && (
                <span className="text-[11px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
                  -{costDelta}
                </span>
              )}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-[#22273d] hidden sm:block" />

          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Harmonic Clashes
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-mono text-rose-400 font-bold">
                {originalEvaluation.clashCount}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-base font-mono font-extrabold text-emerald-400">
                {sequencedEvaluation.clashCount}
              </span>
            </div>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center bg-[#0d0f17] p-1 rounded-xl border border-[#23293e]">
          <button
            onClick={() => onToggleViewMode('sequenced')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'sequenced'
                ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            DJ Sequence
          </button>
          <button
            onClick={() => onToggleViewMode('original')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'original'
                ? 'bg-slate-700 text-white shadow-md'
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
