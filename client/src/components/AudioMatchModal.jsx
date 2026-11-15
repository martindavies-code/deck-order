import React, { useState } from 'react';
import { Check, AlertTriangle, X, Music, HelpCircle } from 'lucide-react';

export function AudioMatchModal({
  matchSummary,
  tracks = [],
  unsupportedFiles = [],
  onConfirm,
  onCancel
}) {
  const {
    autoMatched = [],
    ambiguous = [],
    unmatchedFiles = [],
    unmatchedTracks = []
  } = matchSummary || {};

  // Map fileIndex -> chosen target ('__skip__' | '__add_new__' | track.id)
  const [decisions, setDecisions] = useState(() => {
    const init = {};
    for (const item of ambiguous) {
      init[item.fileIndex] = item.proposedTrackId || '__skip__';
    }
    for (const item of unmatchedFiles) {
      init[item.fileIndex] = '__skip__';
    }
    return init;
  });

  if (!matchSummary) return null;

  const handleDecisionChange = (fileIndex, value) => {
    setDecisions(prev => ({ ...prev, [fileIndex]: value }));
  };

  const handleApply = () => {
    onConfirm?.(decisions);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-match-modal-title"
    >
      <div className="deck-panel-raised w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-[#394133]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#394133] flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3
              id="audio-match-modal-title"
              className="text-base font-bold text-[#F3F0E6] flex items-center gap-2"
            >
              <Music className="w-4 h-4 text-[#7DD3FC]" />
              <span>Review audio file matches</span>
            </h3>
            <p className="text-xs text-[#BAC2B3]">
              Confirm how analysed audio files should attach to your tracklist before verification.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="deck-btn-ghost p-1.5 text-[#BAC2B3] hover:text-[#F3F0E6]"
            aria-label="Close match review"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {/* Status summary pills */}
          <div className="flex flex-wrap gap-2">
            {autoMatched.length > 0 && (
              <span className="badge-status badge-status-corroborated">
                <Check className="w-3.5 h-3.5" />
                <span>{autoMatched.length} high-confidence {autoMatched.length === 1 ? 'match' : 'matches'} ready</span>
              </span>
            )}
            {ambiguous.length > 0 && (
              <span className="badge-status badge-status-disputed">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{ambiguous.length} {ambiguous.length === 1 ? 'needs' : 'need'} confirmation</span>
              </span>
            )}
            {unmatchedFiles.length > 0 && (
              <span className="badge-status badge-status-supplied">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{unmatchedFiles.length} unmatched {unmatchedFiles.length === 1 ? 'file' : 'files'}</span>
              </span>
            )}
            {unsupportedFiles.length > 0 && (
              <span className="badge-status badge-status-missing">
                <span>{unsupportedFiles.length} unsupported/undecodable</span>
              </span>
            )}
          </div>

          {/* Auto-matched collapsible summary */}
          {autoMatched.length > 0 && (
            <div className="p-3 rounded bg-[#10120F] border border-[#252B22] space-y-1.5">
              <p className="font-semibold text-[#86EFAC]">
                Auto-matched ({autoMatched.length})
              </p>
              <ul className="space-y-1 text-[11px] font-mono text-[#BAC2B3] max-h-28 overflow-y-auto">
                {autoMatched.map((m) => (
                  <li key={m.fileIndex} className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.file.fileName}</span>
                    <span className="text-[#7E8876] shrink-0">→</span>
                    <span className="truncate text-[#F3F0E6]">
                      {m.track.artist} - {m.track.title} ({m.file.workingBpm ?? m.file.bpm} BPM · {m.file.camelot})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ambiguous matches needing user confirmation */}
          {ambiguous.length > 0 && (
            <div className="space-y-2.5">
              <h4 className="font-bold text-[#FDE047] uppercase tracking-wider text-[11px]">
                Confirm ambiguous matches ({ambiguous.length})
              </h4>
              {ambiguous.map((item) => (
                <div
                  key={item.fileIndex}
                  className="p-3 rounded bg-[#10120F] border border-[rgba(234,179,8,0.35)] space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#F3F0E6] break-all">
                      {item.file.fileName}
                    </span>
                    <span className="font-mono text-[#7DD3FC] tabular-nums">
                      {item.file.workingBpm ?? item.file.bpm ?? '?'} BPM · {item.file.camelot || item.file.key || '?'}
                    </span>
                  </div>
                  {item.reasons?.length > 0 && (
                    <p className="text-[11px] text-[#BAC2B3]">
                      {item.reasons.join(' · ')}
                    </p>
                  )}
                  <div className="space-y-1">
                    <label
                      htmlFor={`audio-match-select-${item.fileIndex}`}
                      className="block text-[11px] text-[#7E8876]"
                    >
                      Pair with track:
                    </label>
                    <select
                      id={`audio-match-select-${item.fileIndex}`}
                      value={decisions[item.fileIndex] || '__skip__'}
                      onChange={(e) => handleDecisionChange(item.fileIndex, e.target.value)}
                      className="deck-select text-xs min-h-[40px]"
                    >
                      {tracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.artist} - {t.title}{t.version && t.version !== 'Original Mix' ? ` (${t.version})` : ''}
                        </option>
                      ))}
                      <option value="__add_new__">+ Add as new track to set</option>
                      <option value="__skip__">Skip this file (do not attach)</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unmatched audio files */}
          {unmatchedFiles.length > 0 && (
            <div className="space-y-2.5">
              <h4 className="font-bold text-[#BAC2B3] uppercase tracking-wider text-[11px]">
                Unmatched audio files ({unmatchedFiles.length})
              </h4>
              {unmatchedFiles.map((item) => (
                <div
                  key={item.fileIndex}
                  className="p-3 rounded bg-[#10120F] border border-[#394133] space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#F3F0E6] break-all">
                      {item.file.fileName}
                    </span>
                    <span className="font-mono text-[#7DD3FC] tabular-nums">
                      {item.file.workingBpm ?? item.file.bpm ?? '?'} BPM · {item.file.camelot || item.file.key || '?'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#7E8876]">{item.reason}</p>
                  <div className="space-y-1">
                    <label
                      htmlFor={`audio-unmatched-select-${item.fileIndex}`}
                      className="block text-[11px] text-[#7E8876]"
                    >
                      Action for this file:
                    </label>
                    <select
                      id={`audio-unmatched-select-${item.fileIndex}`}
                      value={decisions[item.fileIndex] || '__skip__'}
                      onChange={(e) => handleDecisionChange(item.fileIndex, e.target.value)}
                      className="deck-select text-xs min-h-[40px]"
                    >
                      <option value="__skip__">Leave unattached (skip file)</option>
                      <option value="__add_new__">+ Add as new track to set</option>
                      {tracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          Pair manually: {t.artist} - {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unsupported files */}
          {unsupportedFiles.length > 0 && (
            <div className="p-3 rounded bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] space-y-1">
              <p className="font-bold text-[#FCA5A5]">
                Unsupported or undecodable files ({unsupportedFiles.length})
              </p>
              <ul className="space-y-1 text-[11px] font-mono text-[#BAC2B3]">
                {unsupportedFiles.map((u, idx) => (
                  <li key={idx}>
                    <strong className="text-[#F3F0E6]">{u.fileName}:</strong> {u.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tracks in set with no matched audio file */}
          {unmatchedTracks.length > 0 && (
            <div className="p-3 rounded bg-[#10120F] border border-[#252B22] space-y-1">
              <p className="text-[#BAC2B3] font-semibold">
                Tracks without a matched audio file ({unmatchedTracks.length})
              </p>
              <p className="text-[11px] text-[#7E8876]">
                These tracks will still be checked against the metadata catalogue:
              </p>
              <p className="text-[11px] font-mono text-[#BAC2B3] line-clamp-3">
                {unmatchedTracks.map(t => `${t.artist} - ${t.title}`).join(' · ')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-[#394133] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="deck-btn-secondary text-xs justify-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="deck-btn-primary text-xs justify-center"
          >
            <Check className="w-4 h-4" />
            <span>Apply audio analysis & verify</span>
          </button>
        </div>
      </div>
    </div>
  );
}
