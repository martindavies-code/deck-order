import React, { useState } from 'react';
import { ListMusic, FileText, Upload, Sparkles, Disc, Music, ArrowRight, X, Check } from 'lucide-react';

export const DEMO_ELECTRONIC_CSV = `Artist,Title,Version,BPM,Key,ISRC
Bicep,Glue,Original Mix,130,8A,GBBKS1700282
Four Tet,Baby,Original Mix,126,F minor,GBBKS2000001
Barry Can't Swim,Sunsleeper,Original Mix,128,11A,GBBKS2200104
Floating Points,LesAlpx,Original Mix,128,C# minor,GBBKS1900140
Overmono,Good Lies,Original Mix,134,4A,GBBKS2300055
Peggy Gou,(It Goes Like) Nanana,Club Edit,130,7A,DEUM72301982
Fred again..,Danielle (smile on my face),Original Mix,134,8A,GBAHS2200902
Mall Grab,Liverpool Street In The Rain,Original Mix,125,5A,AUMG21800001
Ross from Friends,The Daisy,Original Mix,128,10A,GBBKS2100312
Bonobo,Rosewood,Original Mix,125,6A,GBBKS2100415
Joy Orbison,flight fm,Original Mix,136,8A,GBBKS2400011
Daphni,Sizzling,Club Mix,128,9A,CAJ421900001`;

export function SourcePicker({
  spotifyConnected,
  playlists = [],
  onSelectPlaylist,
  onParseCsv,
  onConnectSpotify,
  isLoading
}) {
  const [activeTab, setActiveTab] = useState(spotifyConnected ? 'spotify' : 'paste');
  const [csvInput, setCsvInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);

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
    <div className="space-y-8">
      {/* Two-Column Intro: 55% Editorial / 45% Import Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Editorial & Artwork (55% = 7 cols) */}
        <div className="lg:col-span-7 space-y-6 pt-2">
          <div className="space-y-3">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#FF8857] font-semibold">
              SET PLANNING
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#F3F0E6] tracking-tight leading-[1.08] font-sans">
              Good tracks.<br />Better order.
            </h2>
            <p className="text-sm sm:text-base text-[#BAC2B3] max-w-xl leading-relaxed">
              Turn your playlist into a set that builds. Check tempo and key, spot awkward handovers, then shape the running order your way.
            </p>
          </div>

          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={handleDemoSet}
              className="deck-btn-secondary text-xs flex items-center gap-2"
              title="Load a 12-track demo set with sample metadata"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D6FC55]" />
              <span>Try a demo set</span>
            </button>
            <span className="text-xs text-[#7E8876]">
              Your original playlist stays untouched.
            </span>
          </div>

          {/* Original Vinyl / Cue Artwork (Static, aria-hidden) */}
          <div className="relative pt-4" aria-hidden="true">
            <div className="w-48 h-48 rounded-full bg-[#171A15] border border-[#394133] relative flex items-center justify-center shadow-inner">
              {/* Concentric record grooves */}
              <div className="absolute inset-2 rounded-full border border-[#252B22]" />
              <div className="absolute inset-5 rounded-full border border-[#252B22]" />
              <div className="absolute inset-8 rounded-full border border-[#252B22]" />
              <div className="absolute inset-12 rounded-full border border-[#2B3327]" />
              {/* Center label */}
              <div className="w-16 h-16 rounded-full bg-[#252B22] border border-[#394133] flex flex-col items-center justify-center text-center p-1">
                <span className="text-[8px] font-mono text-[#D6FC55] font-bold tracking-tighter uppercase">DECK</span>
                <span className="text-[7px] font-mono text-[#BAC2B3] uppercase">ORDER</span>
                {/* Spindle hole */}
                <div className="w-3 h-3 rounded-full bg-[#10120F] border border-[#394133] mt-0.5" />
              </div>
              {/* Cue-marker line */}
              <div className="absolute top-2 w-[2px] h-6 bg-[#D6FC55] rounded-full shadow-sm" />
            </div>
          </div>
        </div>

        {/* Right Column: Bring Your Tracks Console (45% = 5 cols) */}
        <div className="lg:col-span-5">
          <div className="deck-panel p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#394133] pb-3">
              <h3 className="text-sm font-bold text-[#F3F0E6] uppercase tracking-wide font-sans">
                Bring your tracks
              </h3>
              <span className="text-[11px] text-[#7E8876] font-mono">
                Step 1 of 3
              </span>
            </div>

            {/* Segmented Source Tabs */}
            <div className="grid grid-cols-2 gap-1 bg-[#10120F] p-1 rounded-md border border-[#394133]">
              <button
                onClick={() => setActiveTab('spotify')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded transition-colors ${
                  activeTab === 'spotify'
                    ? 'bg-[#252B22] text-[#D6FC55] border border-[#394133]'
                    : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
                }`}
              >
                <Disc className="w-3.5 h-3.5" />
                <span>Spotify</span>
              </button>
              <button
                onClick={() => setActiveTab('paste')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded transition-colors ${
                  activeTab === 'paste'
                    ? 'bg-[#252B22] text-[#D6FC55] border border-[#394133]'
                    : 'text-[#BAC2B3] hover:text-[#F3F0E6]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste or upload</span>
              </button>
            </div>

            {/* Spotify Tab Content */}
            {activeTab === 'spotify' && (
              <div className="space-y-3 pt-1">
                {spotifyConnected ? (
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#BAC2B3] mb-2">
                      <span>Choose a playlist you own:</span>
                      <span className="font-mono text-[11px]">{playlists.length} playlists</span>
                    </div>

                    {playlists.length === 0 ? (
                      <div className="text-center py-6 text-xs text-[#BAC2B3] bg-[#10120F] rounded border border-[#394133] p-4">
                        No playlists found in your account. You can create one in Spotify or use paste/upload.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {playlists.map((pl) => (
                          <button
                            key={pl.id}
                            onClick={() => onSelectPlaylist(pl)}
                            className="w-full text-left p-2.5 rounded bg-[#10120F] hover:bg-[#252B22] border border-[#394133] hover:border-[#D6FC55] flex items-center justify-between gap-3 transition-colors group"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-[#F3F0E6] truncate group-hover:text-[#D6FC55]">
                                {pl.name}
                              </p>
                              <p className="text-[11px] text-[#7E8876] font-mono">
                                {pl.itemCount} tracks
                              </p>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-[#7E8876] group-hover:text-[#D6FC55] shrink-0" />
                          </button>
                        ))}
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

                    <button
                      onClick={onConnectSpotify}
                      className="deck-btn-primary w-full text-xs justify-center"
                    >
                      <span>Connect Spotify</span>
                    </button>

                    <p className="text-[11px] text-[#7E8876] leading-tight">
                      Under current Spotify Web API policy, only playlists you own return track items. Or switch to paste/upload to work offline.
                    </p>
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
                    rows={6}
                    value={csvInput}
                    onChange={(e) => {
                      setCsvInput(e.target.value);
                      if (rowErrors.length > 0) setRowErrors([]);
                    }}
                    placeholder={`Bicep, Glue, 130, 8A\nFour Tet, Baby, 126, F minor\nOvermono, Good Lies, 134, 4A`}
                    className="deck-textarea text-xs font-mono !min-h-[160px] leading-relaxed"
                  />

                  <p className="text-[11px] text-[#7E8876] mt-1.5 leading-relaxed">
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
                    className="text-xs text-[#BAC2B3] hover:text-[#F3F0E6] underline decoration-[#394133]"
                  >
                    Load sample data
                  </button>

                  <button
                    onClick={handleRunImport}
                    disabled={isLoading || !csvInput.trim()}
                    className="deck-btn-primary text-xs"
                  >
                    <span>Check track details</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slim Three-Step Line */}
      <div className="border-t border-[#394133] pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] font-bold">1</span>
          <span>Bring your tracks</span>
        </div>
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] font-bold">2</span>
          <span>Check the details</span>
        </div>
        <div className="flex items-center gap-2.5 text-[#BAC2B3]">
          <span className="w-5 h-5 rounded-full bg-[#1B1F19] border border-[#394133] text-[#F3F0E6] flex items-center justify-center font-mono text-[10px] font-bold">3</span>
          <span>Shape your set</span>
        </div>
      </div>
    </div>
  );
}
