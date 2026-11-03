import React from 'react';
import { Disc3, CheckCircle2, AlertTriangle, ShieldCheck, LogOut, Radio } from 'lucide-react';

export function Header({ status, authUser, onConnectSpotify, onDisconnectSpotify }) {
  const isSpotifyConfigured = status?.spotifyEligibility?.isConfigured;

  return (
    <header className="border-b border-[#1f2333] bg-[#0c0e17] px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand & Turntable */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-cyan-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
            <Disc3 className="w-6 h-6 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-white">Deck Order</h1>
              <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-400 border border-emerald-700/50 px-2 py-0.5 rounded font-bold">
                DJ Sequencer
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Harmonic mixing & tempo sequencing with multi-source verification
            </p>
          </div>
        </div>

        {/* Status badges & Spotify Auth button */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {/* CSV Mode always available badge */}
          <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-[#161926] border border-[#262c42] px-3 py-1.5 rounded-lg">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>CSV Offline Mode: <strong className="text-cyan-400">Ready</strong></span>
          </div>

          {/* Spotify Connection */}
          {authUser ? (
            <div className="flex items-center gap-2 bg-[#141824] border border-[#252c42] px-3 py-1.5 rounded-lg text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-200 font-medium">
                {authUser.display_name || 'Spotify Premium'}
              </span>
              <button
                onClick={onDisconnectSpotify}
                className="text-slate-400 hover:text-rose-400 ml-1 transition-colors"
                title="Disconnect Spotify"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : isSpotifyConfigured ? (
            <button
              onClick={onConnectSpotify}
              className="deck-btn-primary text-xs"
            >
              <Disc3 className="w-4 h-4" />
              Connect Spotify
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-3 py-1.5 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Spotify Keyless (CSV Mode Active)</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
