import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, RotateCcw, Sliders, ExternalLink } from 'lucide-react';
import { transitionDisplay, transitionToneClass } from '../utils/trackBadges.js';

export function InspectorRail({
  track,
  position,
  totalTracks,
  transitionBefore,
  transitionAfter,
  onClose,
  onApplyOverride,
  onRevertOverride
}) {
  const [overrideBpm, setOverrideBpm] = useState(track?.bpm || '');
  const [overrideKey, setOverrideKey] = useState(track?.key || track?.camelot || '');
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  useEffect(() => {
    if (track) {
      setOverrideBpm(track.bpm || '');
      setOverrideKey(track.key || track.camelot || '');
      setShowOverrideForm(false);
    }
  }, [track]);

  if (!track) {
    return (
      <div className="deck-panel p-5 lg:p-6 text-center text-xs sm:text-sm text-[#7E8876] hidden lg:block">
        <p className="font-semibold text-[#BAC2B3] mb-1">Track Inspector</p>
        <p>Select any track in the running order to check source evidence, disagreements or apply custom values.</p>
      </div>
    );
  }

  const handleSave = (e) => {
    e.preventDefault();
    if (!overrideBpm && !overrideKey) return;
    const applied = onApplyOverride(track.id, {
      bpm: overrideBpm,
      key: overrideKey
    });
    if (applied) setShowOverrideForm(false);
  };

  const isOverridden = track.confidence === 'user_override';

  return (
    <div className="deck-panel p-5 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[#394133] pb-3">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] sm:text-xs font-mono text-[#FF8857] uppercase tracking-wider font-semibold">
            Track #{position} of {totalTracks}
          </span>
          <h4 className="text-sm sm:text-base lg:text-lg font-bold text-[#F3F0E6] truncate">
            {track.title}
          </h4>
          <p className="text-xs sm:text-sm text-[#BAC2B3] truncate">
            {track.artist}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-[#7E8876] hover:text-[#F3F0E6] p-1 -mr-1 shrink-0"
          title="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Exact Recording Details */}
      <div className="space-y-2.5 text-xs sm:text-[13px] bg-[#10120F] p-3 sm:p-3.5 rounded border border-[#394133]">
        <div className="flex justify-between gap-3">
          <span className="text-[#7E8876] shrink-0">Version:</span>
          <span className="text-[#F3F0E6] font-medium truncate min-w-0 text-right">{track.version || 'Original Mix'}</span>
        </div>
        {track.isrc && (
          <div className="flex justify-between font-mono">
            <span className="text-[#7E8876]">ISRC:</span>
            <span className="text-[#BAC2B3]">{track.isrc}</span>
          </div>
        )}
        <div className="flex justify-between font-mono">
          <span className="text-[#7E8876]">Tempo:</span>
          <span className="text-[#F3F0E6] font-bold tabular-nums">
            {track.bpm ? `${track.bpm} BPM` : 'Unknown'}
          </span>
        </div>
        {track.tempoNeedsReview && track.tempoSuggestion && (
          <div className="space-y-2">
            <span className="text-[#7E8876] block">Suggested tempo:</span>
            <span className="font-mono text-amber-400">
              {track.tempoSuggestion.bpm} BPM ({track.tempoSuggestion.kind} - needs review)
            </span>
            <button type="button" onClick={() => onApplyOverride(track.id, { bpm: track.tempoSuggestion.bpm })}
              className="deck-btn-primary text-xs min-h-[40px] w-full justify-center">
              <Check className="w-3.5 h-3.5" /> Use suggested
            </button>
          </div>
        )}
        {track.manualOverride && (
          <div className="space-y-1 text-[#BAC2B3]">
            <p className="text-[#D6FC55]">Your value is active. Provider evidence is unchanged.</p>
            <p>Source tempo: {track.manualOverride.sourceTrack.bpm ?? 'Unknown'} BPM</p>
            <p>Source key: {track.manualOverride.sourceTrack.camelot || track.manualOverride.sourceTrack.key || 'Unknown'}</p>
          </div>
        )}
        {track.isNormalized && track.rawBpm && !track.tempoNeedsReview && (
          <div className="flex justify-between">
            <span className="text-[#7E8876]">Source tempo:</span>
            <span className="font-mono text-[#F3F0E6]">
              {track.rawBpm} BPM (doubled/halved, corroborated)
            </span>
          </div>
        )}
        <div className="flex justify-between font-mono">
          <span className="text-[#7E8876]">Key / Camelot:</span>
          <span className="text-[#D6FC55] font-bold">
            {track.camelot || track.key || 'Unknown'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#7E8876]">Evidence:</span>
          <span className="font-mono capitalize text-[#BAC2B3]">
            {track.status === 'sample' ? 'Sample data' :
             track.status === 'corroborated' ? 'Corroborated' :
             track.status === 'single_source' ? 'Single source' :
             track.status === 'supplied' ? 'Supplied by you' :
             track.status === 'disputed' ? 'Sources disagree' : 'Missing data'}
          </span>
        </div>
      </div>

      {/* Recording identity uncertainty: matched record carries a different ISRC */}
      {track.recordingNeedsReview && track.recordingMismatch && (
        <div className="p-3 rounded bg-[rgba(234,179,8,0.1)] border border-[rgba(234,179,8,0.3)] space-y-2 text-xs text-[#FDE047]">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-3.5 h-3.5 text-[#EAB308]" />
            <span>Recording match needs review</span>
          </div>
          <p className="text-[11px] text-[#BAC2B3]">
            The matched record's ISRC ({track.recordingMismatch.matchedIsrc}) differs from this track's
            ({track.recordingMismatch.suppliedIsrc}). Tempo and key shown are from that record -
            confirm they belong to this recording before trusting them for sequencing.
          </p>
        </div>
      )}

      {/* Disagreements if any */}
      {track.status === 'disputed' && (
        <div className="p-3 rounded bg-[rgba(234,179,8,0.1)] border border-[rgba(234,179,8,0.3)] space-y-2 text-xs text-[#FDE047]">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-3.5 h-3.5 text-[#EAB308]" />
            <span>Sources Disagree</span>
          </div>
          <p className="text-[11px] text-[#BAC2B3]">
            Different analysis providers reported conflicting values for this track recording.
          </p>
        </div>
      )}

      {/* Placement Reason in Running Order */}
      <div className="space-y-2 text-xs sm:text-[13px]">
        <span className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-[#7E8876] block">
          Placement in set
        </span>
        {[['Incoming', 'From previous track', transitionBefore], ['Outgoing', 'To next track', transitionAfter]].map(([label, direction, transition]) => {
          if (!transition) return null;
          const td = transitionDisplay(transition, track, null);
          return (
            <div key={label} className="rounded border border-[#394133] bg-[#10120F]/50 p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-xs sm:text-[13px] font-semibold text-[#F3F0E6]">{label}</h4>
                <span className="text-[11px] sm:text-xs text-[#7E8876]">{direction}</span>
              </div>
              <p className={`text-xs sm:text-[13px] leading-relaxed ${transitionToneClass(td.tone)}`}>{td.text}</p>
              {td.showBpmChange && (
                <div className="flex items-center gap-2 text-[11px] sm:text-xs">
                  <span className="text-[#7E8876]">Tempo change</span>
                  <span className={`font-mono tabular-nums whitespace-nowrap ${transitionToneClass(td.tempoTone)}`}>
                    {transition.bpmChange > 0 ? `+${transition.bpmChange}` : transition.bpmChange} BPM
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {!transitionBefore && !transitionAfter && (
          <p className="text-[11px] sm:text-xs text-[#7E8876]">Single track in current selection.</p>
        )}
      </div>

      {/* Manual Override Controls */}
      <div className="border-t border-[#394133] pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs sm:text-[13px] font-semibold text-[#F3F0E6]">
            {isOverridden ? 'Manual override active' : 'Adjust values'}
          </span>
          {isOverridden ? (
            <button
              onClick={() => onRevertOverride && onRevertOverride(track.id)}
              className="text-[11px] sm:text-xs text-[#BAC2B3] hover:text-[#EF4444] flex items-center gap-1 font-mono"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          ) : null}
            <button
              onClick={() => setShowOverrideForm(!showOverrideForm)}
              className="text-[11px] sm:text-xs text-[#D6FC55] hover:underline font-mono"
            >
              {showOverrideForm ? 'Cancel' : 'Use my value'}
            </button>
        </div>

        {showOverrideForm && (
          <form onSubmit={handleSave} className="space-y-2.5 bg-[#10120F] p-3 rounded border border-[#394133]">
            <div>
              <label className="text-[10px] font-mono text-[#BAC2B3] block mb-1">
                Tempo (BPM)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="400"
                value={overrideBpm}
                onChange={(e) => setOverrideBpm(e.target.value)}
                placeholder="e.g. 128"
                className="deck-input text-xs font-mono py-1.5"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-[#BAC2B3] block mb-1">
                Key or Camelot (e.g. 8A, A minor)
              </label>
              <input
                type="text"
                value={overrideKey}
                onChange={(e) => setOverrideKey(e.target.value)}
                placeholder="e.g. 8A or C major"
                className="deck-input text-xs font-mono py-1.5"
              />
            </div>
            <button
              type="submit"
              className="deck-btn-primary w-full text-xs min-h-[36px] justify-center"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply value</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
