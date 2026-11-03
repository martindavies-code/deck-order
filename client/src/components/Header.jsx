import React, { useState, useRef, useEffect } from 'react';
import { Bookmark, User, LogOut, Check, ChevronDown, Disc, Trash2, Shield } from 'lucide-react';
import { loadGoogleIdentityServices, handleGoogleCredentialResponse } from '../services/googleAuth.js';

export function Header({
  status,
  authUser,
  googleUser,
  historyCount = 0,
  staySignedIn = false,
  onToggleStaySignedIn,
  onConnectSpotify,
  onDisconnectSpotify,
  onLoginGoogle,
  onLogoutGoogle,
  onForgetDevice,
  onOpenHistory
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const googleBtnContainerRef = useRef(null);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const spotifyClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

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

  // Initialize and render Google Identity Services button when menu opens
  useEffect(() => {
    if (menuOpen && !googleUser && googleClientId && googleBtnContainerRef.current) {
      let isCancelled = false;
      loadGoogleIdentityServices()
        .then(idService => {
          if (isCancelled || !idService || !googleBtnContainerRef.current) return;
          try {
            idService.initialize({
              client_id: googleClientId,
              callback: async (res) => {
                try {
                  const user = await handleGoogleCredentialResponse(res, googleClientId);
                  onLoginGoogle(user);
                  setMenuOpen(false);
                } catch (err) {
                  console.error('Google verification error:', err);
                }
              },
              ux_mode: 'popup'
            });

            googleBtnContainerRef.current.innerHTML = '';
            idService.renderButton(googleBtnContainerRef.current, {
              theme: 'outline',
              size: 'medium',
              type: 'standard',
              shape: 'rectangular',
              text: 'signin_with',
              width: 250
            });
          } catch (err) {
            console.warn('GIS initialization note:', err);
          }
        })
        .catch(err => console.warn('GIS loading note:', err));

      return () => {
        isCancelled = true;
      };
    }
  }, [menuOpen, googleUser, googleClientId]);

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

        {/* Saved Sets & Account Controls Right */}
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
              className="deck-btn-secondary text-xs min-h-[36px] py-1 px-2.5 flex items-center gap-2"
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <div className="flex items-center gap-1.5">
                {isSpotifyConnected ? (
                  <span className="w-2 h-2 rounded-full bg-[#4ADE80]" title="Spotify connected" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#7E8876]" title="No Spotify connection" />
                )}
                <span className="text-xs text-[#F3F0E6] font-medium hidden sm:inline truncate max-w-[120px]">
                  {authUser?.display_name || googleUser?.name || 'Account'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#BAC2B3]" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-lg bg-[#1B1F19] border border-[#394133] shadow-2xl p-3 z-50 space-y-3">
                {/* Spotify Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#BAC2B3]">
                    <span>Spotify Connection</span>
                    {isSpotifyConnected ? (
                      <span className="text-[#4ADE80] font-bold">Connected</span>
                    ) : (
                      <span className="text-[#7E8876]">Not linked</span>
                    )}
                  </div>

                  {!spotifyClientId ? (
                    <p className="text-[11px] text-[#7E8876] leading-tight">
                      Spotify isn't configured for this deployment.
                    </p>
                  ) : isSpotifyConnected ? (
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
                    <div className="space-y-1.5">
                      <button
                        onClick={() => {
                          onConnectSpotify();
                          setMenuOpen(false);
                        }}
                        className="deck-btn-secondary w-full text-xs min-h-[36px] justify-center"
                      >
                        <Disc className="w-3.5 h-3.5 text-[#4ADE80]" />
                        <span>Connect Spotify</span>
                      </button>
                      <label className="flex items-center gap-2 text-[11px] text-[#BAC2B3] cursor-pointer pt-0.5">
                        <input
                          type="checkbox"
                          checked={staySignedIn}
                          onChange={(e) => onToggleStaySignedIn && onToggleStaySignedIn(e.target.checked)}
                          className="rounded border-[#394133] bg-[#10120F] text-[#D6FC55] focus:ring-0"
                        />
                        <span>Stay signed in on this device</span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="h-[1px] bg-[#394133]" />

                {/* Google Sync Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#BAC2B3]">
                    <span>Set History Sync</span>
                    {googleUser && <span className="text-[#4ADE80] font-bold">Active</span>}
                  </div>

                  {!googleClientId ? (
                    <p className="text-[11px] text-[#7E8876] leading-tight">
                      Google sign-in isn't configured for this deployment.
                    </p>
                  ) : googleUser ? (
                    <div className="flex items-center justify-between bg-[#10120F] p-2 rounded border border-[#394133]">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <img
                          src={googleUser.picture}
                          alt=""
                          className="w-5 h-5 rounded-full border border-[#394133]"
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-[#F3F0E6] truncate font-medium">
                            {googleUser.name}
                          </p>
                          <p className="text-[10px] text-[#BAC2B3] truncate">
                            {googleUser.email}
                          </p>
                        </div>
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
                    <div className="pt-1 flex flex-col items-center">
                      <div ref={googleBtnContainerRef} className="min-h-[40px] flex items-center justify-center w-full" />
                    </div>
                  )}
                </div>

                <div className="h-[1px] bg-[#394133]" />

                {/* Forget This Device Action */}
                <div>
                  <button
                    onClick={() => {
                      onForgetDevice();
                      setMenuOpen(false);
                    }}
                    className="text-[11px] text-[#BAC2B3] hover:text-[#EF4444] transition-colors flex items-center gap-1.5 w-full py-1 text-left"
                    title="Wipe all local and session tokens and saved history from this browser"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#7E8876] hover:text-[#EF4444]" />
                    <span>Forget this device</span>
                  </button>
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
