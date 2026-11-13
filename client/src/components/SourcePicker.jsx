import React, { useState, useRef } from 'react';
import { ListMusic, FileText, Upload, Sparkles, Disc, Music, ArrowRight, X, Check, Search, RefreshCw, Loader2 } from 'lucide-react';
import { formatLoadProgress } from '../services/api.js';

export const DEMO_ELECTRONIC_CSV = `Artist,Title,Version,BPM,Key
Bicep,Glue,Original Mix,130,8A
Four Tet,Baby,Original Mix,126,F minor
Barry Can't Swim,Sunsleeper,Original Mix,128,11A
Floating Points,LesAlpx,Original Mix,128,C# minor
Overmono,Good Lies,Original Mix,134,4A
Peggy Gou,(It Goes Like) Nanana,Club Edit,130,7A
Fred again..,Danielle (smile on my face),Original Mix,134,8A
Mall Grab,Liverpool Street In The Rain,Original Mix,125,5A
Ross from Friends,The Daisy,Original Mix,128,10A
Bonobo,Rosewood,Original Mix,125,6A
Joy Orbison,flight fm,Original Mix,136,8A
Daphni,Sizzling,Club Mix,128,9A`;

export function SourcePicker({
  spotifyConnected,
  playlists = [],
  playlistsLoading = false,
  playlistLoadProgress = null,
  onRefreshPlaylists,
  onSelectPlaylist,
  onParseCsv,
  onConnectSpotify,
  isLoading,
  loadProgress = null,
  loadingPlaylistId = null,
  staySignedIn = false,
  onToggleStaySignedIn
}) {
  const [activeTab, setActiveTab] = useState(spotifyConnected ? 'spotify' : 'paste');
  const [playlistQuery, setPlaylistQuery] = useState('');
  const [csvInput, setCsvInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const fileInputRef = useRef(null);
  const spotifyClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

  const trimmedPlaylistQuery = playlistQuery.trim().toLowerCase();
  const visiblePlaylists = trimmedPlaylistQuery
    ? playlists.filter(pl =>
        (pl.name || '').toLowerCase().includes(trimmedPlaylistQuery) ||
        (pl.description || '').toLowerCase().includes(trimmedPlaylistQuery)
      )
    : playlists;

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setCsvInput(text);
          setRowErrors([]);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setCsvInput('');
    setRowErrors([]);
  };

  const handleRunImport = () => {
    if (!csvInput.trim()) return;
    // Validate rows for user feedback
    const lines = csvInput.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
    const errors = [];
    lines.forEach((line, idx) => {
      if (idx === 0 && line.toLowerCase().includes('artist')) return; // Header line
      const parts = line.split(/[,\t;]/);
      if (parts.length < 2 && !line.includes(' - ')) {
        errors.push(`Row ${idx + 1}: Expected at least Artist and Title.`);
      }
    });

    if (errors.length > 0 && errors.length === lines.length) {
      setRowErrors(errors.slice(0, 3));
      return;
    }

    setRowErrors([]);
    onParseCsv(csvInput, false);
  };

  const handleDemoSet = () => {
    setCsvInput(DEMO_ELECTRONIC_CSV);
    setSelectedFile(null);
    setRowErrors([]);
    onParseCsv(DEMO_ELECTRONIC_CSV, true);
  };

  return (
    <div className="space-y-8 lg:space-y-10">
      {/* Two-Column Intro: 5 cols Editorial / 7 cols Import Console on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left Column: Editorial & Artwork (5 cols on large screens) */}
        <div className="lg:col-span-5 space-y-6 pt-2 lg:pt-4">
          <div className="space-y-3 sm:space-y-4">
            <span className="text-[11px] sm:text-xs font-mono uppercase tracking-widest text-[#FF8857] font-semibold">
              SET PLANNING
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-[52px] font-extrabold text-[#F3F0E6] tracking-tight leading-[1.06] font-sans">
              Good tracks.<br />Better order.
            </h2>
            <p className="text-sm sm:text-base lg:text-lg text-[#BAC2B3] max-w-lg leading-relaxed">
              Turn your playlist into a set that builds. Check tempo and key, spot awkward handovers, then shape the running order your way.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              onClick={handleDemoSet}
              className="deck-btn-secondary text-xs sm:text-sm flex items-center gap-2 sm:px-4 sm:py-2.5"
              title="Load a 12-track demo set with sample metadata"
            >
              <Sparkles className="w-4 h-4 text-[#D6FC55]" />
              <span>Try a demo set</span>
            </button>
            <span className="text-xs sm:text-sm text-[#7E8876] leading-snug">
              Your original playlist stays untouched.
              <br />Audio analysis by FreqBlog (freqblog.com)
            </span>
          </div>

          {/* Original Vinyl / Cue Artwork (Static, aria-hidden) */}
          <div className="relative pt-4 hidden sm:block" aria-hidden="true">
            <div className="w-48 h-48 lg:w-56 lg:h-56 rounded-full bg-[#171A15] border border-[#394133] relative flex items-center justify-center shadow-inner">
              {/* Concentric record grooves */}
              <div className="absolute inset-2 rounded-full border border-[#252B22]" />
              <div className="absolute inset-5 rounded-full border border-[#252B22]" />
              <div className="absolute inset-8 rounded-full border border-[#252B22]" />
              <div className="absolute inset-12 rounded-full border border-[#2B3327]" />
              {/* Center label */}
              <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-[#252B22] border border-[#394133] flex flex-col items-center justify-center text-center p-1">
                <span className="text-[8px] lg:text-[9px] font-mono text-[#D6FC55] font-bold tracking-tighter uppercase">DECK</span>
                <span className="text-[7px] lg:text-[8px] font-mono text-[#BAC2B3] uppercase">ORDER</span>
                {/* Spindle hole */}
                <div className="w-3 h-3 rounded-full bg-[#10120F] border border-[#394133] mt-0.5" />
              </div>
              {/* Cue-marker line */}
              <div className="absolute top-2 w-[2px] h-6 bg-[#D6FC55] rounded-full shadow-sm" />
            </div>
          </div>
        </div>

        {/* Right Column: Bring Your Tracks Console (7 cols on large screens) */}
        <div className="lg:col-span-7">
          <div className="deck-panel p-5 sm:p-6 lg:p-7 space-y-4 sm:space-y-5">
            <div className="flex items-center justify-between border-b border-[#394133] pb-3.5">
              <h3 className="text-sm sm:text-base lg:text-lg font-bold text-[#F3F0E6] uppercase tracking-wide font-sans">
                Bring your tracks
              </h3>
              <span className="text-[11px] sm:text-xs text-[#7E8876] font-mono">
                Step 1 of 3
              </span>
            </div>

            {/* Segmented Source Tabs */}
            <div className="grid grid-cols-2 gap-1.5 bg-[#10120F] p-1 rounded-md border border-[#394133]">
              <button
                onClick={() => setActiveTab('spotify')}
                className={`flex items-center justify-center gap-2 py-2 sm:py-2.5 px-3 text-xs sm:text-sm font-semibold rounded transition-colors ${
                  activeTab === 'spotify'
                    ? 'bg-[#252B22] text-[#D6FC55] border border-[#394133]'
                    : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
                }`}
              >
                <Disc className="w-4 h-4" />
                <span>Spotify</span>
              </button>
              <button
                onClick={() => setActiveTab('paste')}
                className={`flex items-center justify-center gap-2 py-2 sm:py-2.5 px-3 text-xs sm:text-sm font-semibold rounded transition-colors ${
                  activeTab === 'paste'
                    ? 'bg-[#252B22] text-[#D6FC55] border border-[#394133]'
                    : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Paste or upload</span>
              </button>
            </div>

            {/* Spotify Tab Content */}
            {activeTab === 'spotify' && (
              <div className="space-y-3 sm:space-y-4 pt-1">
                {spotifyConnected ? (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-[#BAC2B3] mb-2.5">
                      <span>Choose a playlist you own:</span>
                      <div className="flex items-center gap-2.5">
                        {playlistsLoading ? (
                          <span className="font-mono text-xs text-[#D6FC55] inline-flex items-center gap-1.5" role="status" aria-live="polite">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span>
                              {playlistLoadProgress
                                ? `Loading… (${playlistLoadProgress.ownedCount} owned)`
                                : 'Loading playlists…'}
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs sm:text-[13px] tabular-nums">
                            {trimmedPlaylistQuery
                              ? `${visiblePlaylists.length} of ${playlists.length} playlists`
                              : `${playlists.length} playlists`}
                          </span>
                        )}
                        {onRefreshPlaylists && (
                          <button
                            type="button"
                            onClick={onRefreshPlaylists}
                            disabled={isLoading || playlistsLoading}
                            className="inline-flex items-center gap-1 text-xs font-mono text-[#BAC2B3] hover:text-[#D6FC55] px-2 py-1 rounded border border-[#394133] hover:border-[#D6FC55] bg-[#10120F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Refresh owned Spotify playlists"
                            aria-label="Refresh playlists"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${playlistsLoading ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">Refresh</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {(playlists.length > 0 || playlistQuery) && (
                      <div className="relative mb-3">
                        <Search className="w-4 h-4 text-[#7E8876] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={playlistQuery}
                          onChange={(e) => setPlaylistQuery(e.target.value)}
                          placeholder="Filter playlists..."
                          aria-label="Filter playlists"
                          className="deck-input w-full pl-9 pr-8 py-2 sm:py-2.5 text-xs sm:text-sm"
                        />
                        {playlistQuery && (
                          <button
                            type="button"
                            onClick={() => setPlaylistQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7E8876] hover:text-[#F3F0E6] p-0.5"
                            title="Clear playlist filter"
                            aria-label="Clear playlist filter"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {playlistsLoading && playlists.length === 0 ? (
                      <div className="text-center py-10 text-xs sm:text-sm text-[#BAC2B3] bg-[#10120F] rounded border border-[#394133] p-5 flex flex-col items-center gap-2.5" role="status" aria-live="polite">
                        <Loader2 className="w-5 h-5 animate-spin text-[#D6FC55]" />
                        <span>
                          {playlistLoadProgress
                            ? `Fetching your owned Spotify playlists (${playlistLoadProgress.ownedCount} found so far)…`
                            : 'Loading your owned Spotify playlists…'}
                        </span>
                      </div>
                    ) : playlists.length === 0 ? (
                      <div className="text-center py-8 text-xs sm:text-sm text-[#BAC2B3] bg-[#10120F] rounded border border-[#394133] p-5">
                        No playlists found in your account. You can create one in Spotify or use paste/upload.
                      </div>
                    ) : visiblePlaylists.length === 0 ? (
                      <div className="text-center py-8 text-xs sm:text-sm text-[#BAC2B3] bg-[#10120F] rounded border border-[#394133] p-5 space-y-2.5">
                        <p>No playlists match &ldquo;{playlistQuery.trim()}&rdquo;.</p>
                        <button
                          type="button"
                          onClick={() => setPlaylistQuery('')}
                          className="deck-btn-secondary text-xs"
                        >
                          Clear filter
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-2.5 max-h-[420px] md:max-h-[520px] lg:max-h-[580px] overflow-y-auto pr-1">
                        {visiblePlaylists.map((pl) => {
                          const isThisLoading = loadingPlaylistId === pl.id;
                          return (
                            <button
                              key={pl.id}
                              onClick={() => onSelectPlaylist(pl)}
                              disabled={isLoading}
                              aria-busy={isThisLoading}
                              className="w-full text-left p-3 sm:p-3.5 lg:p-4 rounded bg-[#10120F] hover:bg-[#252B22] border border-[#394133] hover:border-[#D6FC55] flex items-center justify-between gap-3 transition-colors group disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-[#10120F] disabled:hover:border-[#394133] min-h-[56px]"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs sm:text-sm lg:text-[15px] font-bold text-[#F3F0E6] truncate group-hover:text-[#D6FC55]">
                                  {pl.name}
                                </p>
                                <p className="text-[11px] sm:text-xs text-[#7E8876] font-mono mt-0.5 tabular-nums">
                                  {isThisLoading ? 'Loading…' : `${pl.itemCount} tracks`}
                                </p>
                              </div>
                              {isThisLoading ? (
                                <Disc className="w-4 h-4 animate-spin text-[#D6FC55] shrink-0" />
                              ) : (
                                <ArrowRight className="w-4 h-4 text-[#7E8876] group-hover:text-[#D6FC55] shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 bg-[#10120F] p-4 rounded border border-[#394133]">
                    <div className="flex items-start gap-2.5">
                      <Disc className="w-4 h-4 text-[#4ADE80] mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-[#F3F0E6]">
                          Connect your Spotify account
                        </p>
                        <p className="text-xs text-[#BAC2B3] leading-relaxed">
                          Deck Order reads the tracks in your chosen playlist and can save your finished running order as a new private playlist.
                        </p>
                      </div>
                    </div>

                    {!spotifyClientId ? (
                      <div className="space-y-2">
                        <button
                          disabled
                          className="deck-btn-primary w-full text-xs justify-center opacity-50 cursor-not-allowed"
                        >
                          <span>Connect Spotify</span>
                        </button>
                        <p className="text-xs text-[#FF8857] leading-relaxed">
                          Spotify isn't configured for this deployment. Paste or upload a tracklist instead.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <button
                          onClick={onConnectSpotify}
                          className="deck-btn-primary w-full text-xs justify-center"
                        >
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
                        <p className="text-[11px] text-[#7E8876] leading-tight">
                          Under current Spotify Web API policy, only playlists you own return track items. Or switch to paste/upload to work offline.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Paste or Upload Tab Content */}
            {activeTab === 'paste' && (
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="tracklist-textarea" className="text-xs font-semibold text-[#F3F0E6]">
                      Paste a tracklist
                    </label>
                    {selectedFile ? (
                      <div className="flex items-center gap-1.5 text-xs text-[#D6FC55] bg-[#252B22] px-2 py-0.5 rounded border border-[#394133]">
                        <span className="truncate max-w-[140px] font-mono text-[11px]">{selectedFile.name}</span>
                        <button
                          onClick={handleRemoveFile}
                          className="hover:text-[#EF4444] p-0.5"
                          title="Remove uploaded file"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="text-[11px] text-[#BAC2B3] hover:text-[#D6FC55] cursor-pointer flex items-center gap-1 font-mono">
                        <Upload className="w-3 h-3" />
                        <span>Upload CSV</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  <textarea
                    id="tracklist-textarea"
                    rows={8}
                    value={csvInput}
                    onChange={(e) => {
                      setCsvInput(e.target.value);
                      if (rowErrors.length > 0) setRowErrors([]);
                    }}
                    placeholder={`Bicep, Glue, 130, 8A\nFour Tet, Baby, 126, F minor\nOvermono, Good Lies, 134, 4A`}
                    className="deck-textarea text-xs sm:text-sm font-mono min-h-[180px] sm:min-h-[240px] lg:min-h-[280px] leading-relaxed"
                  />

                  <p className="text-[11px] sm:text-xs text-[#7E8876] mt-1.5 leading-relaxed">
                    Start with Artist, Title, BPM and Key. Add Version and ISRC if you have them. Missing values stay unknown.
                  </p>
                </div>

                {/* Row Errors if any */}
                {rowErrors.length > 0 && (
                  <div className="p-2.5 rounded bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-xs text-[#FCA5A5] space-y-1">
                    <p className="font-semibold">Check column format:</p>
                    {rowErrors.map((err, i) => (
                      <p key={i} className="text-[11px] font-mono">{err}</p>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={handleDemoSet}
                    type="button"
                    className="text-xs sm:text-sm text-[#BAC2B3] hover:text-[#F3F0E6] underline decoration-[#394133]"
                  >
                    Load sample data
                  </button>

                  <button
                    onClick={handleRunImport}
                    disabled={isLoading || !csvInput.trim()}
                    className="deck-btn-primary text-xs sm:text-sm sm:px-4 sm:py-2.5"
                  >
                    <span>Check track details</span>
                  </button>
                </div>
              </div>
            )}

            {/* Real loading progress: visible immediately on click, driven by
                actual fetch/verify signals - never a fabricated percentage. */}
            {loadProgress && (
              <LoadProgressIndicator progress={loadProgress} />
            )}
          </div>
        </div>
      </div>

      {/* Slim Three-Step Line */}
      <div className="border-t border-[#394133] pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold">1</span>
          <span>Bring your tracks</span>
        </div>
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold">2</span>
          <span>Check the details</span>
        </div>
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold">3</span>
          <span>Shape your set</span>
        </div>
      </div>
    </div>
  );
}

function LoadProgressIndicator({ progress }) {
  const info = formatLoadProgress(progress);
  if (!info) return null;
  const pct = info.determinate ? Math.round(info.ratio * 100) : null;
  return (
    <div className="pt-1 space-y-1.5" role="status" aria-live="polite">
      <p className="text-[11px] font-mono text-[#BAC2B3]">{info.text}</p>
      <div
        className="deck-progress"
        {...(info.determinate
          ? { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': info.text }
          : {})}
      >
        <div
          className={`deck-progress-fill${info.determinate ? '' : ' deck-progress-indeterminate'}`}
          style={info.determinate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
