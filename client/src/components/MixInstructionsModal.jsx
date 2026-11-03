import React from 'react';
import { X, ExternalLink, Sparkles, CheckCircle2, Sliders } from 'lucide-react';

export function MixInstructionsModal({
  saveResult,
  onClose
}) {
  if (!saveResult) return null;

  return (
    <div className="modal-backdrop">
      <div className="deck-card max-w-lg w-full p-6 relative bg-[#131622] border-[#2c334d] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Playlist Successfully Created!
            </h3>
            <p className="text-xs text-slate-400">
              {saveResult.itemsWritten} tracks saved in optimal harmonic order
            </p>
          </div>
        </div>

        {/* The Final Step — Exact required text */}
        <div className="bg-[#0c0e18] border border-cyan-800/40 rounded-xl p-4 my-4 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider">
            <Sliders className="w-4 h-4" />
            <span>The Final Step: Spotify Mix Transitions</span>
          </div>

          <blockquote className="text-xs text-slate-200 leading-relaxed italic border-l-2 border-cyan-500 pl-3">
            "Open your new playlist in the Spotify app. If your Premium account and app version include the Mix feature, tap Mix, then Auto to apply transitions, and tap any transition to customize them. Mix shows each track's BPM and key so you can sanity-check the order."
          </blockquote>

          <p className="text-[11px] text-slate-400">
            Note: Mix has been rolling out to Premium users on mobile and desktop through 2025–2026; availability depends on account and app version. The app sets the running order; ears are the final judge!
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          {saveResult.spotifyUrl ? (
            <a
              href={saveResult.spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="deck-btn-primary text-xs"
            >
              <ExternalLink className="w-4 h-4" />
              Open Playlist in Spotify
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
