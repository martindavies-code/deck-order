import React, { useState } from 'react';
import { X, AlertTriangle, Check, SlidersHorizontal } from 'lucide-react';

export function DisputeModal({ disputedTracks, onClose, onApplyOverride }) {
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [customBpm, setCustomBpm] = useState('');
  const [customKey, setCustomKey] = useState('');

  if (!disputedTracks || disputedTracks.length === 0) return null;

  const current = disputedTracks[activeTrackIndex];
  const details = current?.details;
  const sA = details?.sourceA;
  const sB = details?.sourceB;

  const handleSelectSource = (src) => {
    onApplyOverride(current.id, {
      bpm: src.rawBpm || src.bpm,
      key: src.key || src.camelot,
      camelot: src.camelot
    });
    if (activeTrackIndex < disputedTracks.length - 1) {
      setActiveTrackIndex(activeTrackIndex + 1);
    } else {
      onClose();
    }
  };

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    if (!customBpm && !customKey) return;
    onApplyOverride(current.id, {
      bpm: customBpm ? parseFloat(customBpm) : (sA?.bpm || 124),
      key: customKey || (sA?.key || '8A')
    });
    setCustomBpm('');
    setCustomKey('');
    if (activeTrackIndex < disputedTracks.length - 1) {
      setActiveTrackIndex(activeTrackIndex + 1);
    } else {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="deck-card max-w-xl w-full p-6 relative bg-[#0f121d] border-[#293047] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">
              A Disagreement Over What Song This Actually Is
            </h3>
            <p className="text-xs text-slate-400">
              Track {activeTrackIndex + 1} of {disputedTracks.length}: Two algorithms, zero consensus.
            </p>
          </div>
        </div>

        <div className="bg-[#080a10] rounded-xl p-4 my-4 border border-[#1e2436]">
          <h4 className="text-xs font-extrabold text-white mb-1.5 font-mono">
            {current.name}
          </h4>
          <div className="text-xs text-amber-300 font-mono space-y-1">
            {details?.disputeReasons?.map((r, i) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-3 font-semibold">
          Choose which database you believe, or intervene before an auditory tragedy occurs:
        </p>

        {/* Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {/* Source A */}
          <div className="bg-[#141826] border border-[#23293e] rounded-xl p-3 flex flex-col justify-between hover:border-emerald-500/60 transition-all">
            <div>
              <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                {sA?.provider || sA?.name || 'Database A'}
              </span>
              <div className="mt-2 text-sm font-bold text-slate-100 font-mono">
                {sA?.workingBpm || sA?.bpm} BPM
              </div>
              <div className="text-xs font-mono text-cyan-400 font-bold">
                {sA?.camelot} ({sA?.key || 'Key'})
              </div>
            </div>
            <button
              onClick={() => handleSelectSource(sA)}
              className="deck-btn-secondary text-xs mt-3 w-full justify-center text-emerald-400 border-emerald-800/40 hover:bg-emerald-950/40"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Trust {sA?.provider || 'Database A'}</span>
            </button>
          </div>

          {/* Source B */}
          <div className="bg-[#141826] border border-[#23293e] rounded-xl p-3 flex flex-col justify-between hover:border-emerald-500/60 transition-all">
            <div>
              <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                {sB?.provider || sB?.name || 'Database B'}
              </span>
              <div className="mt-2 text-sm font-bold text-slate-100 font-mono">
                {sB?.workingBpm || sB?.bpm} BPM
              </div>
              <div className="text-xs font-mono text-cyan-400 font-bold">
                {sB?.camelot} ({sB?.key || 'Key'})
              </div>
            </div>
            <button
              onClick={() => handleSelectSource(sB)}
              className="deck-btn-secondary text-xs mt-3 w-full justify-center text-emerald-400 border-emerald-800/40 hover:bg-emerald-950/40"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Trust {sB?.provider || 'Database B'}</span>
            </button>
          </div>
        </div>

        {/* Custom manual override input */}
        <form onSubmit={handleCustomSubmit} className="pt-3 border-t border-[#1e2436] flex flex-col sm:flex-row items-center gap-2">
          <input
            type="number"
            step="0.1"
            placeholder="Custom BPM"
            value={customBpm}
            onChange={(e) => setCustomBpm(e.target.value)}
            className="bg-[#080a10] border border-[#22283a] rounded-lg px-3 py-2 text-xs text-slate-200 w-full sm:w-28 font-mono focus:border-emerald-500 min-h-[44px]"
          />
          <input
            type="text"
            placeholder="Custom Key (e.g. 8A)"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            className="bg-[#080a10] border border-[#22283a] rounded-lg px-3 py-2 text-xs text-slate-200 flex-1 font-mono focus:border-emerald-500 w-full min-h-[44px]"
          />
          <button
            type="submit"
            className="deck-btn-primary text-xs whitespace-nowrap w-full sm:w-auto"
          >
            I Have Real Ears
          </button>
        </form>
      </div>
    </div>
  );
}
