import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Check } from 'lucide-react';

export function DisputeModal({ disputedTracks, onClose, onApplyOverride }) {
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [customBpm, setCustomBpm] = useState('');
  const [customKey, setCustomKey] = useState('');

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dispute-title">
      <div className="deck-panel max-w-lg w-full p-6 relative bg-[#1B1F19] border-[#394133] shadow-2xl space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#BAC2B3] hover:text-[#F3F0E6] min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[rgba(234,179,8,0.12)] text-[#EAB308] flex items-center justify-center shrink-0 border border-[rgba(234,179,8,0.3)]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 id="dispute-title" className="text-base font-bold text-[#F3F0E6]">
              Review source disagreement
            </h3>
            <p className="text-xs text-[#BAC2B3]">
              Track {activeTrackIndex + 1} of {disputedTracks.length}: Conflicting values reported.
            </p>
          </div>
        </div>

        {/* Track Title & Disagreement Note */}
        <div className="bg-[#10120F] rounded-lg p-3.5 border border-[#394133] space-y-1.5">
          <h4 className="text-xs font-bold text-[#F3F0E6]">
            {current.name || `${current.artist} - ${current.title}`}
          </h4>
          <div className="text-[11px] text-[#FDE047] font-mono space-y-0.5">
            {details?.disputeReasons?.map((r, i) => (
              <p key={i}>• {r}</p>
            ))}
          </div>
        </div>

        <p className="text-xs text-[#BAC2B3]">
          Select which source to use, or enter your own value:
        </p>

        {/* Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Source A */}
          <div className="bg-[#10120F] border border-[#394133] rounded-lg p-3 flex flex-col justify-between hover:border-[#D6FC55] transition-colors">
            <div>
              <span className="text-[10px] font-mono uppercase bg-[#252B22] text-[#BAC2B3] px-2 py-0.5 rounded border border-[#394133]">
                {sA?.provider || sA?.name || 'Source A'}
              </span>
              <div className="mt-2 text-sm font-bold text-[#F3F0E6] font-mono tabular-nums">
                {sA?.workingBpm || sA?.bpm} BPM
              </div>
              <div className="text-xs font-mono text-[#D6FC55]">
                {sA?.camelot} {sA?.key ? `(${sA.key})` : ''}
              </div>
            </div>
            <button
              onClick={() => handleSelectSource(sA)}
              className="deck-btn-secondary text-xs mt-3 w-full justify-center"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Use this value</span>
            </button>
          </div>

          {/* Source B */}
          <div className="bg-[#10120F] border border-[#394133] rounded-lg p-3 flex flex-col justify-between hover:border-[#D6FC55] transition-colors">
            <div>
              <span className="text-[10px] font-mono uppercase bg-[#252B22] text-[#BAC2B3] px-2 py-0.5 rounded border border-[#394133]">
                {sB?.provider || sB?.name || 'Source B'}
              </span>
              <div className="mt-2 text-sm font-bold text-[#F3F0E6] font-mono tabular-nums">
                {sB?.workingBpm || sB?.bpm} BPM
              </div>
              <div className="text-xs font-mono text-[#D6FC55]">
                {sB?.camelot} {sB?.key ? `(${sB.key})` : ''}
              </div>
            </div>
            <button
              onClick={() => handleSelectSource(sB)}
              className="deck-btn-secondary text-xs mt-3 w-full justify-center"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Use this value</span>
            </button>
          </div>
        </div>

        {/* Custom manual override input */}
        <form onSubmit={handleCustomSubmit} className="pt-3 border-t border-[#394133] space-y-2">
          <label className="text-[11px] font-semibold text-[#BAC2B3] block">
            Or provide a manual value:
          </label>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <input
              type="number"
              step="0.1"
              placeholder="BPM (e.g. 128)"
              value={customBpm}
              onChange={(e) => setCustomBpm(e.target.value)}
              className="deck-input text-xs font-mono w-full sm:w-32 !min-h-[44px]"
            />
            <input
              type="text"
              placeholder="Key (e.g. 8A or A minor)"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              className="deck-input text-xs font-mono flex-1 w-full !min-h-[44px]"
            />
            <button
              type="submit"
              className="deck-btn-primary text-xs w-full sm:w-auto"
            >
              Use my value
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
