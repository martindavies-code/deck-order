import React from 'react';
import { Disc3, LogOut, Radio, Archive, Sparkles } from 'lucide-react';

export function Header({
  status,
  authUser,
  googleUser,
  historyCount,
  onConnectSpotify,
  onDisconnectSpotify,
  onLoginGoogle,
  onLogoutGoogle,
  onOpenHistory
}) {
  const isSpotifyConfigured = status?.spotifyEligibility?.isConfigured;

  return (
    <header className="border-b border-[#1b1f2e] bg-[#090b12] px-4 sm:px-6 py-4 shadow-xl">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand & Turntable Platter */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative w-12 h-12 rounded-full bg-gradient-to-tr from-[#161a28] to-[#0c0e16] border-2 border-[#2b334d] flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10 shrink-0">
            {/* Vinyl grooved rings */}
            <div className="absolute inset-1 rounded-full border border-slate-800/80 pointer-events-none" />
            <div className="absolute inset-2 rounded-full border border-slate-800/60 pointer-events-none" />
            <Disc3 className="w-6 h-6 animate-spin-slow text-emerald-400" />
            <div className="absolute w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white uppercase font-mono">
                Deck Order
              </h1>
              <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded font-bold">
                DJ Sequencer
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              Replacing 15 years of club DJ experience with a simple math formula
            </p>
          </div>
        </div>

        {/* Center: The Crowd Indifference VU Meter */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c0e16] border border-[#1a1f30]">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
              Crowd Indifference
            </span>
            <span className="text-[10px] font-mono text-emerald-400 font-bold">
              0.0 dB
            </span>
          </div>

          {/* Dancing LED segments */}
          <div className="vu-meter-bar">
            <div className="vu-segment bg-emerald-500 h-2 animate-pulse" />
            <div className="vu-segment bg-emerald-500 h-3" />
            <div className="vu-segment bg-emerald-500 h-4" />
            <div className="vu-segment bg-emerald-500 h-4" />
            <div className="vu-segment bg-emerald-400 h-3" />
            <div className="vu-segment bg-amber-500 h-2" />
            <div className="vu-segment bg-rose-500 h-1 opacity-50" />
          </div>
        </div>

        {/* Right side: Spotify & Google Authentication Actions */}
        <div className="flex items-center gap-2.5 flex-wrap justify-end w-full md:w-auto">
          {/* Crate History Vault Button */}
          <button
            onClick={onOpenHistory}
            className="deck-btn-secondary text-xs !min-h-[40px] px-3 py-1.5"
            title="Browse your saved sets and sequencing history"
          >
            <Archive className="w-3.5 h-3.5 text-cyan-400" />
            <span>Vault ({historyCount})</span>
          </button>

          {/* Google Login / Profile */}
          {googleUser ? (
            <div className="flex items-center gap-2 bg-[#121624] border border-[#232a3f] px-2.5 py-1 rounded-lg text-xs">
              <img
                src={googleUser.picture}
                alt={googleUser.name}
                className="w-5 h-5 rounded-full border border-cyan-400/50"
              />
              <span className="text-slate-200 font-medium truncate max-w-[100px]">
                {googleUser.name}
              </span>
              <button
                onClick={onLogoutGoogle}
                className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                title="Sign out of Google"
              >
                <LogOut className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLoginGoogle}
              className="deck-btn-secondary text-xs !min-h-[40px] px-3 py-1.5 border-slate-700/60 hover:border-slate-500"
              title="Sign in with Google to persist your set history and custom BPM overrides"
            >
              {/* Google G icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Sign in with Google</span>
            </button>
          )}

          {/* Spotify Connection */}
          {authUser ? (
            <div className="flex items-center gap-2 bg-[#0d1712] border border-emerald-800/50 px-3 py-1.5 rounded-lg text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 font-semibold truncate max-w-[110px]">
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
          ) : (
            <button
              onClick={onConnectSpotify}
              className="deck-btn-primary text-xs !min-h-[40px] px-3.5 py-1.5"
            >
              <Disc3 className="w-4 h-4" />
              <span>Connect Spotify</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
