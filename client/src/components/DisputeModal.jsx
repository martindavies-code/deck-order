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
      <div className="deck-card max-w-xl w-full p-6 relative bg-[#131622] border-[#2c334d] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Disputed Track Data</h3>
            <p className="text-xs text-slate-400">
              Track {activeTrackIndex + 1} of {disputedTracks.length} with differing opinions
            </p>
          </div>
        </div>

        <div className="bg-[#0b0d14] rounded-xl p-4 my-4 border border-[#21273b]">
          <h4 className="text-sm font-extrabold text-white mb-1">
            {current.name}
          </h4>
          <div className="text-xs text-amber-400 font-mono space-y-1">
            {details?.disputeReasons?.map((r, i) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-3 font-semibold">
          Select which independent provider opinion you trust, or enter a manual value:
        </p>

        {/* Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {/* Source A */}
          <div className="bg-[#181c2b] border border-[#2a3149] rounded-xl p-3 flex flex-col justify-between hover:border-emerald-500/60 transition-all">
            <div>
              <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                {sA?.provider || sA?.name || 'Source A'}
              </span>
              <div className="mt-2 text-sm font-bold text-slate-100">
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
              Accept {sA?.provider || 'Source A'}
            </button>
          </div>

          {/* Source B */}
          <div className="bg-[#181c2b] border border-[#2a3149] rounded-xl p-3 flex flex-col justify-between hover:border-emerald-500/60 transition-all">
            <div>
              <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                {sB?.provider || sB?.name || 'Source B'}
              </span>
              <div className="mt-2 text-sm font-bold text-slate-100">
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
              Accept {sB?.provider || 'Source B'}
            </button>
          </div>
        </div>

        {/* Custom manual override input */}
        <form onSubmit={handleCustomSubmit} className="pt-3 border-t border-[#23293e] flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            placeholder="Custom BPM"
            value={customBpm}
            onChange={(e) => setCustomBpm(e.target.value)}
            className="bg-[#0b0d14] border border-[#282f46] rounded-lg px-3 py-1.5 text-xs text-slate-200 w-28 font-mono focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="Custom Key (e.g. 8A)"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            className="bg-[#0b0d14] border border-[#282f46] rounded-lg px-3 py-1.5 text-xs text-slate-200 flex-1 font-mono focus:border-emerald-500"
          />
          <button
            type="submit"
            className="deck-btn-primary text-xs whitespace-nowrap"
          >
            Apply Manual Override
          </button>
        </form>
      </div>
    </div>
  );
}
