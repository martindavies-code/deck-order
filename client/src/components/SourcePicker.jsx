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
    <div className="deck-card p-6 mb-6">
      <div className="flex border-b border-[#212638] mb-6 gap-2">
        <button
          onClick={() => setActiveTab('spotify')}
          disabled={!spotifyConnected}
          className={`flex items-center gap-2 pb-3 px-4 font-semibold text-sm border-b-2 transition-all ${
            activeTab === 'spotify'
              ? 'border-emerald-500 text-emerald-400'
              : spotifyConnected
              ? 'border-transparent text-slate-400 hover:text-slate-200'
              : 'border-transparent text-slate-600 cursor-not-allowed'
          }`}
        >
          <ListMusic className="w-4 h-4" />
          My Spotify Playlists {spotifyConnected ? `(${playlists.length})` : '(Connect First)'}
        </button>

        <button
          onClick={() => setActiveTab('csv')}
          className={`flex items-center gap-2 pb-3 px-4 font-semibold text-sm border-b-2 transition-all ${
            activeTab === 'csv'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          Paste Tracklist / CSV Import (Offline)
        </button>
      </div>

      {/* Spotify Playlists Picker */}
      {activeTab === 'spotify' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300">
              Select one of your owned playlists:
            </h3>
            <span className="text-xs text-slate-500">
              Only owned playlists return items (Spotify 2026 specs)
            </span>
          </div>

          {playlists.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No owned playlists found. Create one in Spotify or switch to CSV mode.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-2">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => onSelectPlaylist(pl)}
                  className="bg-[#161926] hover:bg-[#1d2235] border border-[#262c40] hover:border-emerald-500/50 rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all group"
                >
                  {pl.images?.[0]?.url ? (
                    <img
                      src={pl.images[0].url}
                      alt={pl.name}
                      className="w-12 h-12 rounded-lg object-cover bg-slate-800"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500">
                      <Music2 className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-slate-200 truncate group-hover:text-emerald-400 transition-colors">
                      {pl.name}
                    </h4>
                    <p className="text-xs text-slate-400">
                      {pl.itemCount} tracks
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSV / Paste Mode */}
      {activeTab === 'csv' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Paste tracklist lines (<code className="text-cyan-400">Artist, Title, BPM, Key</code>) or upload an export from Rekordbox, Mixed In Key, Tunebat, or Beatport:
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={loadDemoPlaylist}
                className="deck-btn-secondary text-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Load 12-Track House/Techno Demo
              </button>

              <label className="deck-btn-secondary text-xs cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                Upload CSV
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
            className="w-full bg-[#0d0f17] border border-[#252b3e] rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
          />

          <div className="flex justify-end">
            <button
              onClick={() => onParseCsv(csvInput)}
              disabled={isLoading || !csvInput.trim()}
              className="deck-btn-primary text-xs"
            >
              Parse & Verify Tracklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
