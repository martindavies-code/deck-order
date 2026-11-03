import React, { useState } from 'react';
import { GripVertical, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles, SlidersHorizontal, ArrowDown } from 'lucide-react';

export function SequencedTable({
  tracks,
  transitions,
  onReorderTracks,
  onOpenOverride
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  if (!tracks || tracks.length === 0) {
    return (
      <div className="deck-card p-12 text-center text-slate-500 text-sm">
        No tracks loaded. Select a Spotify playlist or paste a tracklist to begin.
      </div>
    );
  }

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...tracks];
    const [moved] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    setDraggedIndex(null);
    setDragOverIndex(null);
    onReorderTracks(reordered);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="deck-card overflow-hidden mb-6">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#212638] bg-[#0e1019] text-[11px] font-mono uppercase tracking-wider text-slate-400">
              <th className="py-3 px-3 w-12 text-center">#</th>
              <th className="py-3 px-4">Track Title & Artist</th>
              <th className="py-3 px-3 w-28">Tempo (BPM)</th>
              <th className="py-3 px-3 w-32">Camelot & Key</th>
              <th className="py-3 px-3 w-28">Energy</th>
              <th className="py-3 px-3 w-28">Verification</th>
              <th className="py-3 px-3 w-16 text-center">Tweak</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#171a28]">
            {tracks.map((track, idx) => {
              const transitionToNext = transitions?.[idx];
              const isDragging = draggedIndex === idx;
              const isOver = dragOverIndex === idx;

              // Harmonic chip color
              let camelotChipStyle = 'bg-cyan-950/60 text-cyan-300 border-cyan-800/40';
              if (idx > 0 && transitions?.[idx - 1]) {
                const prevGrade = transitions[idx - 1].grade;
                if (prevGrade === 'SMOOTH') {
                  camelotChipStyle = 'bg-emerald-950/70 text-emerald-300 border-emerald-600/50';
                } else if (prevGrade === 'STRETCH') {
                  camelotChipStyle = 'bg-amber-950/70 text-amber-300 border-amber-600/50';
                } else if (prevGrade === 'CLASH') {
                  camelotChipStyle = 'bg-rose-950/70 text-rose-300 border-rose-600/50';
                }
              }

              return (
                <React.Fragment key={track.id || `${track.artist}-${track.title}-${idx}`}>
                  {/* Track Row */}
                  <tr
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`transition-colors group cursor-grab active:cursor-grabbing ${
                      isDragging ? 'opacity-40 bg-[#1e2337]' : isOver ? 'bg-[#1b2033]' : 'hover:bg-[#131622]'
                    }`}
                  >
                    {/* Position & Handle */}
                    <td className="py-3 px-3 text-center text-xs font-mono text-slate-400">
                      <div className="flex items-center justify-center gap-1">
                        <GripVertical className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                        <span>{(idx + 1).toString().padStart(2, '0')}</span>
                      </div>
                    </td>

                    {/* Track Details */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-white truncate">
                          {track.title}
                        </span>
                        <span className="text-xs text-slate-400 truncate">
                          {track.artist} {track.version && track.version !== 'Original Mix' && `• ${track.version}`}
                        </span>
                      </div>
                    </td>

                    {/* BPM */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono font-bold text-slate-200">
                          {track.bpm ? track.bpm : '—'}
                        </span>
                        {track.isNormalized && (
                          <span className="text-[10px] font-mono px-1 py-0.2 bg-purple-950 text-purple-400 border border-purple-800/40 rounded" title="Working tempo normalized into house/techno band">
                            norm
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Camelot & Key */}
                    <td className="py-3 px-3">
                      {track.camelot ? (
                        <div className="flex items-center gap-2">
                          <span className={`badge-camelot border ${camelotChipStyle}`}>
                            {track.camelot}
                          </span>
                          <span className="text-xs text-slate-400 truncate font-mono">
                            {track.key}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-rose-400 font-mono">Missing Mode</span>
                      )}
                    </td>

                    {/* Energy Bar */}
                    <td className="py-3 px-3">
                      {typeof track.energy === 'number' ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full"
                              style={{ width: `${Math.round(track.energy * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-slate-400">
                            {Math.round(track.energy * 100)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3">
                      {track.status === 'verified' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" />
                          Verified
                        </span>
                      )}
                      {track.status === 'single_source' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" />
                          1 Source
                        </span>
                      )}
                      {track.status === 'disputed' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" />
                          Disputed
                        </span>
                      )}
                      {track.status === 'unverified' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-950/40 border border-rose-800/40 px-2 py-0.5 rounded">
                          <ShieldAlert className="w-3 h-3" />
                          Unverified
                        </span>
                      )}
                    </td>

                    {/* Override Button */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => onOpenOverride(track)}
                        className="text-slate-500 hover:text-cyan-400 p-1 rounded transition-colors"
                        title="Tweak BPM or Key"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>

                  {/* Transition Chip Interstitial Row */}
                  {transitionToNext && (
                    <tr className="bg-[#090b12] border-none select-none">
                      <td colSpan={7} className="py-1 px-4">
                        <div className="flex items-center gap-3 py-1">
                          <div className="w-6 flex justify-center text-slate-700">
                            <ArrowDown className="w-3 h-3" />
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Transition Grade Badge */}
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${
                                transitionToNext.grade === 'SMOOTH'
                                  ? 'chip-smooth'
                                  : transitionToNext.grade === 'STRETCH'
                                  ? 'chip-stretch'
                                  : 'chip-clash'
                              }`}
                            >
                              {transitionToNext.grade}
                            </span>

                            {/* Harmonic Relation */}
                            <span className="text-xs text-slate-300 font-mono">
                              {transitionToNext.relation}
                            </span>

                            {/* Tempo Change */}
                            <span className="text-xs text-slate-400 font-mono">
                              ({transitionToNext.bpmChange >= 0 ? `+${transitionToNext.bpmChange}` : transitionToNext.bpmChange} BPM)
                            </span>

                            {/* Deliberate Reset Flag */}
                            {transitionToNext.isDeliberateReset && (
                              <span className="text-[10px] font-bold uppercase bg-purple-950 text-purple-300 border border-purple-700/60 px-2 py-0.5 rounded">
                                {transitionToNext.resetLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
