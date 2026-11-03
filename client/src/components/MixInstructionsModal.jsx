import React, { useEffect } from 'react';
import { X, ExternalLink, Check, Sliders } from 'lucide-react';

export function MixInstructionsModal({
  saveResult,
  onClose
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!saveResult) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-success-title">
      <div className="deck-panel max-w-lg w-full p-6 relative bg-[#1B1F19] border-[#394133] shadow-2xl space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#BAC2B3] hover:text-[#F3F0E6] min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[rgba(74,222,128,0.12)] text-[#86EFAC] flex items-center justify-center shrink-0 border border-[rgba(74,222,128,0.3)]">
            <Check className="w-5 h-5" />
          </div>
          <div>
            <h3 id="save-success-title" className="text-base font-bold text-[#F3F0E6]">
              New playlist created.
            </h3>
            <p className="text-xs text-[#BAC2B3]">
              {saveResult.itemsWritten} tracks saved in the chosen sequence.
            </p>
          </div>
        </div>

        {/* Mix Instructions Box */}
        <div className="bg-[#10120F] border border-[#394133] rounded-lg p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#D6FC55]">
            <Sliders className="w-4 h-4" />
            <span>Playback in Spotify</span>
          </div>

          <blockquote className="text-xs text-[#F3F0E6] leading-relaxed italic border-l-2 border-[#D6FC55] pl-3">
            "Open your new playlist in the Spotify app. If your Premium account and app version include the Mix feature, tap Mix, then Auto to apply transitions, and tap any transition to customize them. Mix shows each track's BPM and key so you can sanity-check the order."
          </blockquote>

          <p className="text-[11px] text-[#7E8876] leading-relaxed">
            Deck Order arranges the tracks. Spotify handles playback. Mix availability depends on your account and app version.
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          {saveResult.spotifyUrl ? (
            <a
              href={saveResult.spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="deck-btn-primary text-xs"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open in Spotify</span>
            </a>
          ) : <div />}

          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
