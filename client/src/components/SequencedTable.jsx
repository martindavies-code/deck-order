import React, { useState } from 'react';
import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Music,
  ArrowRight,
  Sliders,
  AlertTriangle,
  Check,
  HelpCircle,
  X
} from 'lucide-react';
import { camelotBadgeColors, trackValueState, evidenceBadge, transitionDisplay, transitionToneClass } from '../utils/trackBadges.js';

/**
 * Colour-coded per-track data badges: Camelot pill keyed to wheel hue, BPM
 * pill in brand neutral. Missing values show as grey dashes (never implied),
 * values flagged for review render amber until the user confirms them.
 */
function TrackDataBadges({ track }) {
  const bpmState = trackValueState(track, 'bpm');
  const keyState = trackValueState(track, 'camelot');
  const keyColors = camelotBadgeColors(track.camelot);
  const base = {
    display: 'inline-flex', alignItems: 'center', fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700, fontSize: '0.7rem', padding: '0.15rem 0.45rem',
    borderRadius: 'var(--radius-tag)', border: '1px solid var(--border-subtle)',
    backgroundColor: '#171A15', color: 'var(--chalk)'
  };
  const review = { borderColor: '#F59E0B', color: '#FDE047' };
  const missing = { borderColor: 'var(--border-subtle)', color: '#7E8876', borderStyle: 'dashed' };
  return (
    <span className="flex items-center gap-1.5 mt-1 flex-wrap">
      <span
        style={{ ...base, ...(bpmState === 'missing' ? missing : bpmState === 'review' ? review : {}) }}
        title={bpmState === 'review' ? 'Tempo needs review - confirm before trusting' : bpmState === 'missing' ? 'No tempo data' : 'Tempo'}
      >
        {bpmState === 'missing' ? '\u2014 BPM' : `${track.bpm} BPM`}
      </span>
      <span
        style={{ ...base, ...(keyState === 'missing' ? missing : keyState === 'review' ? review : (keyColors || {})) }}
        title={keyState === 'review' ? 'Recording/key match needs review - confirm before trusting' : keyState === 'missing' ? 'No key data' : `Camelot ${track.camelot}`}
      >
        {keyState === 'missing' ? '\u2014' : track.camelot}
      </span>
    </span>
  );
}

export function SequencedTable({
  tracks = [],
  transitions = [],
  selectedTrackId,
  onReorderTracks,
  onSelectTrack,
  onRemoveTrack
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  if (!tracks || tracks.length === 0) {
    return (
      <div className="deck-panel p-8 text-center text-xs text-[#7E8876]">
        No tracks in this view.
      </div>
    );
  }

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e, index) => {
    if (!onReorderTracks) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (!onReorderTracks || draggedIndex === null || draggedIndex === targetIndex) {
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

  // Keyboard / Touch Move handlers
  const moveTrack = (currentIndex, direction) => {
    if (!onReorderTracks) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;

    const reordered = [...tracks];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    onReorderTracks(reordered);
  };

  return (
    <div className="space-y-2">
      {/* 1. Desktop & Tablet Table (Hidden on Phone < 640px) */}
      <div className="hidden sm:block deck-panel overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#394133] bg-[#10120F] text-[11px] font-mono uppercase tracking-wider text-[#7E8876]">
              <th className="py-2.5 px-3 w-12 text-center">#</th>
              <th className="py-2.5 px-3 w-14 text-center">Order</th>
              <th className="py-2.5 px-4 text-left">Track</th>
              <th className="py-2.5 px-3 w-32 text-left">Evidence</th>
              <th className="py-2.5 px-3 w-20 text-center">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252B22]">
            {tracks.map((track, idx) => {
              const transition = transitions?.[idx];
              const isSelected = selectedTrackId === track.id;
              const isDragging = draggedIndex === idx;
              const isOver = dragOverIndex === idx;

              // Unique key for repeated tracks: use stable index + track id
              const rowKey = `${track.id || 't'}_${idx}`;

              return (
                <React.Fragment key={rowKey}>
                  <tr
                    draggable={!!onReorderTracks}
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onSelectTrack && onSelectTrack(track, idx)}
                    className={`cursor-pointer transition-colors group ${
                      isSelected ? 'bg-[#252B22]' : 'hover:bg-[#1B1F19]'
                    } ${isOver ? 'border-t-2 border-[#D6FC55]' : ''} ${
                      isDragging ? 'opacity-40' : ''
                    }`}
                  >
                    {/* Position */}
                    <td className="py-3 px-3 text-center font-mono text-xs text-[#7E8876] tabular-nums">
                      {(idx + 1).toString().padStart(2, '0')}
                    </td>

                    {/* Drag Handle & Move buttons */}
                    <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <span
                          className="cursor-grab active:cursor-grabbing text-[#7E8876] hover:text-[#D6FC55] p-1"
                          title="Drag to reorder"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => moveTrack(idx, -1)}
                            disabled={!onReorderTracks || idx === 0}
                            className="text-[#7E8876] hover:text-[#F3F0E6] disabled:opacity-20 inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded border border-[#394133]"
                            title="Move up"
                            aria-label={`Move track ${idx + 1} up`}
                          >
                            <ChevronUp className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => moveTrack(idx, 1)}
                            disabled={!onReorderTracks || idx === tracks.length - 1}
                            className="text-[#7E8876] hover:text-[#F3F0E6] disabled:opacity-20 inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded border border-[#394133]"
                            title="Move down"
                            aria-label={`Move track ${idx + 1} down`}
                          >
                            <ChevronDown className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Track Title, Artist, Exact Version */}
                    <td className="py-3 px-4 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded bg-[#10120F] border border-[#394133] flex items-center justify-center text-[#7E8876] shrink-0">
                          <Music className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#F3F0E6] truncate group-hover:text-[#D6FC55] transition-colors">
                            {track.title}
                          </p>
                          <p className="text-[11px] text-[#BAC2B3] truncate">
                            {track.artist}
                            {track.version && (
                              <span className="text-[#7E8876] ml-1.5 font-mono text-[10px]">
                                · {track.version}
                              </span>
                            )}
                          </p>
                          <TrackDataBadges track={track} />
                          {onRemoveTrack && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveTrack(track, idx); }}
                              className="mt-2 inline-flex items-center gap-1.5 rounded border border-[#394133] px-2 text-[11px] text-[#BAC2B3] hover:text-[#FCA5A5] min-h-[40px]"
                              title="Remove from this set (undoable; original playlist untouched)"
                              aria-label={`Remove ${track.title} from this set`}>
                              <X className="w-3.5 h-3.5" /> Remove track
                            </button>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Evidence Status (shared selector with the mobile strip) */}
                    <td className="py-3 px-3 text-left">
                      <span className={`badge-status ${evidenceBadge(track.status).cls} text-[11px]`}>
                        {evidenceBadge(track.status).label}
                      </span>
                    </td>

                    {/* Detail action + remove from working set */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTrack && onSelectTrack(track, idx);
                          }}
                          className="text-[#7E8876] hover:text-[#D6FC55] p-1"
                          title="Inspect track details"
                          aria-label={`Inspect ${track.title}`}
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>

                      </div>
                    </td>
                  </tr>

                  {/* Transition connector between tracks */}
                  {transition && idx < tracks.length - 1 && (
                    <tr className="bg-[#10120F]/60">
                      <td colSpan={5} className="py-1 px-4 text-[10px] font-mono text-[#7E8876]">
                        <div className="flex items-center gap-3 pl-8">
                          <span className="text-[#394133]">↳</span>
                          <span>Suggested fit:</span>
                          {(() => {
                            const td = transitionDisplay(transition, track, tracks[idx + 1]);
                            return (
                              <>
                                <span className={transitionToneClass(td.tone)}>
                                  {td.text}
                                </span>
                                {td.showBpmChange && (
                                  <>
                                    <span>•</span>
                                    <span className={`tabular-nums whitespace-nowrap shrink-0 ${transitionToneClass(td.tempoTone)}`}>
                                      {transition.bpmChange > 0 ? `+${transition.bpmChange}` : transition.bpmChange} BPM
                                    </span>
                                  </>
                                )}
                              </>
                            );
                          })()}
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

      {/* 2. Mobile Cards (Visible ONLY on Phone < 640px) */}
      <div className="block sm:hidden space-y-3">
        {tracks.map((track, idx) => {
          const transition = transitions?.[idx];
          const isSelected = selectedTrackId === track.id;
          const rowKey = `m_${track.id || 't'}_${idx}`;

          return (
            <div
              key={rowKey}
              onClick={() => onSelectTrack && onSelectTrack(track, idx)}
              className={`deck-panel p-3.5 space-y-2.5 transition-colors cursor-pointer ${
                isSelected ? 'border-[#D6FC55] bg-[#252B22]' : ''
              }`}
            >
              {/* Card Header: Position, Reorder buttons, Title */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="text-xs font-mono font-bold text-[#7E8876] tabular-nums mt-0.5">
                    {(idx + 1).toString().padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#F3F0E6] truncate">
                      {track.title}
                    </p>
                    <p className="text-[11px] text-[#BAC2B3] truncate">
                      {track.artist} {track.version ? `· ${track.version}` : ''}
                    </p>
                  </div>
                </div>

                {/* Move buttons for touch + remove from working set */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => moveTrack(idx, -1)}
                    disabled={!onReorderTracks || idx === 0}
                    className="p-1.5 rounded bg-[#10120F] text-[#BAC2B3] disabled:opacity-20 min-h-[44px] min-w-[44px] flex items-center justify-center border border-[#394133]"
                    aria-label={`Move track ${idx + 1} up`}
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => moveTrack(idx, 1)}
                    disabled={!onReorderTracks || idx === tracks.length - 1}
                    className="p-1.5 rounded bg-[#10120F] text-[#BAC2B3] disabled:opacity-20 min-h-[44px] min-w-[44px] flex items-center justify-center border border-[#394133]"
                    aria-label={`Move track ${idx + 1} down`}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Data strip: colour-coded BPM + Camelot badges, Evidence */}
              <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-[#252B22]">
                <TrackDataBadges track={track} />
                <div>
                  <span className={`badge-status ${evidenceBadge(track.status).cls} text-[10px] uppercase`}>
                    {evidenceBadge(track.status).label}
                  </span>
                </div>
              </div>

              {onRemoveTrack && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveTrack(track, idx); }}
                  className="inline-flex items-center gap-1.5 rounded border border-[#394133] px-3 text-xs text-[#BAC2B3] hover:text-[#FCA5A5] min-h-[44px]"
                  title="Remove from this set (undoable; original playlist untouched)"
                  aria-label={`Remove ${track.title} from this set`}>
                  <X className="w-3.5 h-3.5" /> Remove track
                </button>
              )}

              {/* Transition to next preview */}
              {transition && idx < tracks.length - 1 && (
                <div className="text-[11px] font-mono text-[#7E8876] pt-1 border-t border-[#252B22]/60 flex flex-wrap items-center gap-2">
                  <span className="text-[#394133]">↳</span>
                  {(() => {
                    const td = transitionDisplay(transition, track, tracks[idx + 1]);
                    return (
                      <>
                        <span className={transitionToneClass(td.tone)}>
                          {td.text}
                        </span>
                        {td.showBpmChange && (
                          <>
                            <span>•</span>
                            <span className={`tabular-nums whitespace-nowrap shrink-0 ${transitionToneClass(td.tempoTone)}`}>
                              {transition.bpmChange > 0 ? `+${transition.bpmChange}` : transition.bpmChange} BPM
                            </span>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
