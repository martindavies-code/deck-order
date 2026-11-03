import React, { useState } from 'react';
import { ListMusic, FileText, Upload, Sparkles, Music2, ArrowRight } from 'lucide-react';

const DEMO_ELECTRONIC_CSV = `Artist,Title,Version,BPM,Key,ISRC
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
  playlists,
  onSelectPlaylist,
  onParseCsv,
  isLoading
}) {
  const [activeTab, setActiveTab] = useState(spotifyConnected ? 'spotify' : 'csv');
  const [csvInput, setCsvInput] = useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setCsvInput(text);
          onParseCsv(text);
        }
      };
      reader.readAsText(file);
    }
  };

  const loadDemoPlaylist = () => {
    setCsvInput(DEMO_ELECTRONIC_CSV);
    onParseCsv(DEMO_ELECTRONIC_CSV);
  };

  return (
    <section className="deck-card p-4 sm:p-6 mb-6">
      {/* Responsive Segmented Control (Prevents Mobile Cut-Off Trap) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-[#0c0e16] rounded-lg border border-[#1b1f2e] mb-5">
        <button
          onClick={() => setActiveTab('spotify')}
          disabled={!spotifyConnected}
          className={`flex items-center justify-center gap-2 min-h-[44px] px-3 font-semibold text-xs rounded-md transition-all ${
            activeTab === 'spotify'
              ? 'bg-[#181d2c] text-emerald-400 border border-emerald-500/30 shadow-sm'
              : spotifyConnected
              ? 'text-slate-400 hover:text-slate-200'
              : 'text-slate-600 cursor-not-allowed opacity-60'
          }`}
        >
          <ListMusic className="w-4 h-4 shrink-0" />
          <span>My Spotify Playlists {spotifyConnected ? `(${playlists.length})` : '(Connect First)'}</span>
        </button>

        <button
          onClick={() => setActiveTab('csv')}
          className={`flex items-center justify-center gap-2 min-h-[44px] px-3 font-semibold text-xs rounded-md transition-all ${
            activeTab === 'csv'
              ? 'bg-[#181d2c] text-emerald-400 border border-emerald-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span>Manual CSV / Tracklist (Offline Mode)</span>
        </button>
      </div>

      {/* Spotify Playlists Picker */}
      {activeTab === 'spotify' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Select user-owned playlist:
            </h3>
            <span className="text-xs text-slate-500">
              Only owned playlists return items under post-Feb 2026 Web API policy
            </span>
          </div>

          {playlists.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs bg-[#0c0e15] rounded-lg border border-[#1a1e2b]">
              No owned playlists found. Create one in Spotify or switch to CSV mode.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => onSelectPlaylist(pl)}
                  className="bg-[#131622] hover:bg-[#181c2b] border border-[#202538] hover:border-emerald-500/50 rounded-lg p-3 flex items-center gap-3 cursor-pointer transition-all group min-h-[56px]"
                >
                  {pl.images?.[0]?.url ? (
                    <img
                      src={pl.images[0].url}
                      alt={pl.name}
                      className="w-11 h-11 rounded object-cover bg-slate-800 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                      <Music2 className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-slate-200 truncate group-hover:text-emerald-400 transition-colors">
                      {pl.name}
                    </h4>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {pl.itemCount} tracks
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSV / Paste Mode */}
      {activeTab === 'csv' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Format: <code className="text-cyan-400 font-mono">Artist, Title, BPM, Key</code> (or exports from Rekordbox, Tunebat, Mixed In Key):
            </p>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={loadDemoPlaylist}
                className="deck-btn-secondary text-xs flex-1 sm:flex-none justify-center"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Load 12-Track Demo</span>
              </button>

              <label className="deck-btn-secondary text-xs cursor-pointer flex-1 sm:flex-none justify-center">
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                <span>Upload CSV</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <textarea
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            placeholder="Artist, Title, BPM, Key&#10;Bicep, Glue, 130, 8A&#10;Four Tet, Baby, 126, F minor&#10;Overmono, Good Lies, 134, 4A"
            rows={5}
            className="w-full bg-[#0c0e15] border border-[#202538] rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
          />

          <div className="flex justify-end">
            <button
              onClick={() => onParseCsv(csvInput)}
              disabled={isLoading || !csvInput.trim()}
              className="deck-btn-primary text-xs w-full sm:w-auto"
            >
              Parse & Verify Tracklist
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
