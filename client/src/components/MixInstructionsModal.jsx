import React from 'react';
import { X, ExternalLink, Sliders, CheckCircle2 } from 'lucide-react';

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
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Playlist Successfully Manufactured
            </h3>
            <p className="text-xs text-slate-400">
              {saveResult.itemsWritten} tracks arranged in harmonic perfection
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

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Note: Spotify will now blend your audio. During playback, please remember to occasionally touch an unassigned knob on your desk and stare into the middle distance with intense concentration so the room assumes you are doing something difficult.
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
              Open In Spotify App
            </a>
          ) : <div />}

          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
}
