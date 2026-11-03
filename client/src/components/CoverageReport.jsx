import React from 'react';
import { CheckCircle2, AlertTriangle, HelpCircle, Play, Settings2, ShieldAlert } from 'lucide-react';

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
    <div className="deck-card p-6 mb-6 bg-gradient-to-r from-[#121420] to-[#151928] border-l-4 border-l-emerald-500">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        {/* Metric Pills */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white tracking-tight">
              Pre-Flight Track Verification
            </h3>
            <span className="text-xs font-mono text-slate-400">
              ({report.total} tracks total)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Verified */}
            <div className="flex items-center gap-1.5 bg-emerald-950/50 border border-emerald-700/50 text-emerald-400 px-3 py-1 rounded-lg text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Verified: {report.verified}</span>
            </div>

            {/* Single Source */}
            {report.singleSource > 0 && (
              <div className="flex items-center gap-1.5 bg-cyan-950/50 border border-cyan-700/50 text-cyan-400 px-3 py-1 rounded-lg text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Single Source: {report.singleSource}</span>
              </div>
            )}

            {/* Disputed */}
            {report.disputed > 0 && (
              <button
                onClick={onOpenDisputes}
                className="flex items-center gap-1.5 bg-amber-950/60 border border-amber-600/60 text-amber-300 hover:bg-amber-900/60 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm shadow-amber-500/10"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Disputed: {report.disputed} (Tap to Review)</span>
              </button>
            )}

            {/* Unverified */}
            {report.unverified > 0 && (
              <div className="flex items-center gap-1.5 bg-rose-950/50 border border-rose-700/50 text-rose-300 px-3 py-1 rounded-lg text-xs font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Unverified: {report.unverified}</span>
              </div>
            )}
          </div>
        </div>

        {/* Options & Sequencer Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
          {/* Strategy selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Unverified Placement:
            </label>
            <select
              value={unverifiedStrategy}
              onChange={(e) => onChangeStrategy(e.target.value)}
              className="bg-[#0e1018] border border-[#262c40] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="keep_relative_position">Keep relative original position (Default)</option>
              <option value="cluster_at_start">Cluster at beginning of set</option>
              <option value="cluster_at_end">Cluster at end of set</option>
              <option value="exclude">Exclude from harmonic sequence</option>
            </select>
          </div>

          {/* Solve button */}
          <button
            onClick={onRunSequencer}
            disabled={isLoading}
            className="deck-btn-primary px-6 py-3 self-end sm:self-auto justify-center"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isLoading ? 'Sequencing...' : 'Sequence Tracks (DJ Brain)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
