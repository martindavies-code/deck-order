import React, { useState } from 'react';
import { Sparkles, Plus, Check, Music2, ArrowUpRight } from 'lucide-react';

export function SuggestionsDrawer({
  bridgeSuggestions = [],
  bonusTunes = [],
  onToggleSuggestion,
  onApplySelectedSuggestions
}) {
  const [activeTab, setActiveTab] = useState('bridge');

  const selectedCount = [...bridgeSuggestions, ...bonusTunes].filter(t => t.selected).length;

  return (
    <div className="deck-card p-6 mb-6 bg-[#111420] border-[#252b40]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-[#21263a] gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              Bridge & Bonus Track Recommendations
            </h3>
            <p className="text-xs text-slate-400">
              Real verified tracks to smooth awkward joins (Off by default — tick to include)
            </p>
          </div>
        </div>

        {selectedCount > 0 && (
          <button
            onClick={onApplySelectedSuggestions}
            className="deck-btn-primary text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Insert {selectedCount} Selected Track{selectedCount > 1 ? 's' : ''} into Set
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-[#1c2030] mb-4">
        <button
          onClick={() => setActiveTab('bridge')}
          className={`pb-2 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'bridge'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Bridge Suggestions ({bridgeSuggestions.length})
        </button>
        <button
          onClick={() => setActiveTab('bonus')}
          className={`pb-2 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'bonus'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          More Huge Tunes ({bonusTunes.length})
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {activeTab === 'bridge' && (
          bridgeSuggestions.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">
              No stretch or clash gaps detected, or no bridge tracks required!
            </div>
          ) : (
            bridgeSuggestions.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleSuggestion(item.id)}
                className={`p-3 rounded-xl border flex items-center justify-between gap-4 cursor-pointer transition-all ${
                  item.selected
                    ? 'bg-amber-950/30 border-amber-500/60'
                    : 'bg-[#151926] border-[#242a3e] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={Boolean(item.selected)}
                    onChange={() => {}} // handled by parent onClick
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-0 bg-slate-900 border-slate-700"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        {item.artist} - {item.title}
                      </span>
                      <span className="badge-camelot bg-cyan-950 text-cyan-300 border border-cyan-800/40 text-[10px]">
                        {item.camelot}
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {item.bpm} BPM
                      </span>
                    </div>
                    <p className="text-xs text-amber-300/80 mt-0.5 truncate">
                      💡 {item.reason}
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-400 px-2 py-0.5 rounded whitespace-nowrap">
                  {item.source}
                </span>
              </div>
            ))
          )
        )}

        {activeTab === 'bonus' && (
          bonusTunes.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">
              No bonus tunes available for this tempo and key distribution.
            </div>
          ) : (
            bonusTunes.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleSuggestion(item.id)}
                className={`p-3 rounded-xl border flex items-center justify-between gap-4 cursor-pointer transition-all ${
                  item.selected
                    ? 'bg-emerald-950/30 border-emerald-500/60'
                    : 'bg-[#151926] border-[#242a3e] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={Boolean(item.selected)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-0 bg-slate-900 border-slate-700"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        {item.artist} - {item.title}
                      </span>
                      <span className="badge-camelot bg-cyan-950 text-cyan-300 border border-cyan-800/40 text-[10px]">
                        {item.camelot}
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {item.bpm} BPM
                      </span>
                    </div>
                    <p className="text-xs text-emerald-300/80 mt-0.5 truncate">
                      ✨ {item.reason}
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-400 px-2 py-0.5 rounded whitespace-nowrap">
                  {item.source}
                </span>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
