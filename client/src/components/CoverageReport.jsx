import React from 'react';
import { CheckCircle2, AlertTriangle, Play, ShieldAlert, Sparkles } from 'lucide-react';

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
    <section className="deck-card p-5 mb-6 bg-gradient-to-r from-[#10131e] to-[#121624] border-l-4 border-l-emerald-500 shadow-xl">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        {/* Metric Pills */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-extrabold text-white tracking-tight uppercase font-mono">
              Pre-Flight Track Inspection
            </h3>
            <span className="text-xs text-slate-400">
              ({report.total} tracks submitted for algorithmic judgment)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Verified */}
            <div className="flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 px-3 py-1 rounded-lg text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mathematically Approved: {report.verified}</span>
            </div>

            {/* Single Source */}
            {report.singleSource > 0 && (
              <div className="flex items-center gap-1.5 bg-cyan-950/60 border border-cyan-700/60 text-cyan-300 px-3 py-1 rounded-lg text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Single Opinion: {report.singleSource}</span>
              </div>
            )}

            {/* Disputed */}
            {report.disputed > 0 && (
              <button
                onClick={onOpenDisputes}
                className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-600/70 text-amber-300 hover:bg-amber-900/80 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm shadow-amber-500/20"
                title="Resolve disputes between disagreement sources"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>DJs In Heated Argument: {report.disputed} (Review)</span>
              </button>
            )}

            {/* Unverified */}
            {report.unverified > 0 && (
              <div className="flex items-center gap-1.5 bg-rose-950/60 border border-rose-700/60 text-rose-300 px-3 py-1 rounded-lg text-xs font-semibold">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>GarageBand Suspects: {report.unverified}</span>
              </div>
            )}
          </div>
        </div>

        {/* Options & Sequencer Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
          {/* Strategy selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Unverified Track Fate:
            </label>
            <select
              value={unverifiedStrategy}
              onChange={(e) => onChangeStrategy(e.target.value)}
              className="bg-[#0a0c14] border border-[#22283a] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 min-h-[44px]"
            >
              <option value="keep_relative_position">Keep relative position (Cross fingers & pray)</option>
              <option value="cluster_at_start">Cluster at start (Get the weird stuff out of the way)</option>
              <option value="cluster_at_end">Cluster at end (When everyone wants their coats)</option>
              <option value="exclude">Exclude completely (Pretend this track never existed)</option>
            </select>
          </div>

          {/* Solve button */}
          <button
            onClick={onRunSequencer}
            disabled={isLoading}
            className="deck-btn-primary px-6 py-3 self-end sm:self-auto justify-center w-full sm:w-auto"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isLoading ? 'Crunching Camelot Math...' : 'Compute The Holy Sequence'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
