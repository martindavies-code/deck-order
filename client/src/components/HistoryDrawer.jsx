import React from 'react';
import { X, Clock, Play, Trash2, Disc3, ShieldCheck } from 'lucide-react';

export function HistoryDrawer({
  isOpen,
  onClose,
  history,
  onLoadSet,
  onClearHistory,
  googleUser
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="deck-card max-w-xl w-full p-6 relative bg-[#0e111a] border-[#252b3e] shadow-2xl max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Drawer Header */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Disc3 className="w-5 h-5 animate-spin-slow" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">
              The Crate Vault (Your Set History)
            </h3>
            <p className="text-xs text-slate-400">
              {googleUser ? `Synced to Google: ${googleUser.email}` : 'Local browser memory'}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-400 italic mb-4 border-l-2 border-cyan-500/60 pl-3 py-0.5">
          "The Archives of Marginal Improvement: Past sets that saved approximately four seconds of awkward silence."
        </p>

        {/* History List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 my-2">
          {history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs bg-[#090a10] rounded-xl border border-[#1a1e2d]">
              Your vault is currently empty. Sequence a playlist and it will be preserved for posterity here.
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="bg-[#121522] border border-[#1e2438] hover:border-cyan-500/50 rounded-xl p-3 flex items-center justify-between gap-3 transition-all group"
              >
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-200 truncate group-hover:text-cyan-400 transition-colors">
                    {item.name}
                  </h4>
                  <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>{item.trackCount} tracks</span>
                    <span className="text-emerald-400 font-bold tabular-nums">
                      {item.smoothPct}% Smooth
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onLoadSet(item);
                    onClose();
                  }}
                  className="deck-btn-primary text-xs shrink-0 !min-h-[36px] py-1 px-3"
                  title="Reload this set to the decks"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Reload</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-[#1a1f30] mt-auto">
          {history.length > 0 ? (
            <button
              onClick={onClearHistory}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          ) : <div />}

          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Close Vault
          </button>
        </div>
      </div>
    </div>
  );
}
