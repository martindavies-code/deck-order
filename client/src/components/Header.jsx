import React, { useState, useRef, useEffect } from 'react';
import { Bookmark, User, LogOut, Check, ChevronDown, SlidersHorizontal, Disc } from 'lucide-react';

export function Header({
  status,
  authUser,
  googleUser,
  historyCount = 0,
  onConnectSpotify,
  onDisconnectSpotify,
  onLoginGoogle,
  onLogoutGoogle,
  onOpenHistory
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSpotifyConnected = Boolean(authUser);

  return (
    <header className="border-b border-[#394133] bg-[#10120F] px-4 sm:px-6 py-3 sticky top-0 z-40">
      <div className="max-w-[1240px] mx-auto flex items-center justify-between gap-4">
        {/* Brand Wordmark Left */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D6FC55] inline-block shrink-0" aria-hidden="true" />
            <span className="text-base sm:text-lg font-extrabold tracking-tight text-[#F3F0E6] uppercase font-sans">
              Deck Order
            </span>
          </div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#BAC2B3] bg-[#1B1F19] px-2 py-0.5 rounded border border-[#394133]">
            Set Planner
          </span>
        </div>

        {/* Saved Sets & Quiet Account Controls Right */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Saved Sets Button */}
          <button
            onClick={onOpenHistory}
            className="deck-btn-ghost text-xs flex items-center gap-1.5 px-2.5 py-1.5 text-[#BAC2B3] hover:text-[#F3F0E6]"
            title="Open saved sets"
          >
            <Bookmark className="w-3.5 h-3.5 text-[#D6FC55]" />
            <span>Saved sets</span>
            {historyCount > 0 && (
              <span className="text-[10px] font-mono bg-[#252B22] text-[#F3F0E6] px-1.5 py-0.2 rounded border border-[#394133] tabular-nums">
                {historyCount}
              </span>
            )}
          </button>

          {/* Account & Settings Dropdown Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="deck-btn-secondary text-xs !min-h-[36px] py-1 px-2.5 flex items-center gap-2"
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <div className="flex items-center gap-1.5">
                {isSpotifyConnected ? (
                  <span className="w-2 h-2 rounded-full bg-[#4ADE80]" title="Spotify connected" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#7E8876]" title="No Spotify connection" />
                )}
                <span className="text-xs text-[#F3F0E6] font-medium hidden sm:inline">
                  {authUser?.display_name || googleUser?.name || 'Account'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#BAC2B3]" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-lg bg-[#1B1F19] border border-[#394133] shadow-2xl p-3 z-50 space-y-3">
                {/* Spotify Section */}
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#BAC2B3] mb-1.5">
                    <span>Spotify Connection</span>
                    {isSpotifyConnected ? (
                      <span className="text-[#4ADE80] font-bold">Connected</span>
                    ) : (
                      <span className="text-[#7E8876]">Not linked</span>
                    )}
                  </div>
                  {isSpotifyConnected ? (
                    <div className="flex items-center justify-between bg-[#10120F] p-2 rounded border border-[#394133]">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-semibold text-[#F3F0E6] truncate">
                          {authUser.display_name}
                        </p>
                        <p className="text-[10px] text-[#BAC2B3] truncate">
                          Ready to save new playlists
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          onDisconnectSpotify();
                          setMenuOpen(false);
                        }}
                        className="text-xs text-[#BAC2B3] hover:text-[#EF4444] p-1 transition-colors"
                        title="Disconnect Spotify"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        onConnectSpotify();
                        setMenuOpen(false);
                      }}
                      className="deck-btn-secondary w-full text-xs !min-h-[36px] justify-center"
                    >
                      <Disc className="w-3.5 h-3.5 text-[#4ADE80]" />
                      <span>Connect Spotify</span>
                    </button>
                  )}
                </div>

                <div className="h-[1px] bg-[#394133]" />

                {/* Google Sync Section */}
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#BAC2B3] mb-1.5">
                    <span>Set History Sync</span>
                    {googleUser && <span className="text-[#4ADE80] font-bold">Active</span>}
                  </div>
                  {googleUser ? (
                    <div className="flex items-center justify-between bg-[#10120F] p-2 rounded border border-[#394133]">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <img
                          src={googleUser.picture}
                          alt=""
                          className="w-5 h-5 rounded-full border border-[#394133]"
                        />
                        <span className="text-xs text-[#F3F0E6] truncate">
                          {googleUser.name}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          onLogoutGoogle();
                          setMenuOpen(false);
                        }}
                        className="text-xs text-[#BAC2B3] hover:text-[#EF4444] p-1 transition-colors"
                        title="Sign out of Google"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        onLoginGoogle();
                        setMenuOpen(false);
                      }}
                      className="deck-btn-ghost w-full text-xs justify-start px-2 py-1.5 text-[#BAC2B3] hover:text-[#F3F0E6]"
                    >
                      <User className="w-3.5 h-3.5 text-[#BAC2B3]" />
                      <span>Sign in with Google to sync sets</span>
                    </button>
                  )}
                </div>

                <div className="h-[1px] bg-[#394133]" />

                {/* Runtime Mode Notice */}
                <div className="text-[10px] text-[#7E8876] font-mono leading-tight">
                  Deck Order running in {status?.isStaticMode ? 'browser mode' : 'local server mode'}.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
