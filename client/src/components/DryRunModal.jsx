import React, { useEffect } from 'react';
import { X, Check, Disc, Shield } from 'lucide-react';

export function DryRunModal({
  manifest,
  onClose,
  onConfirmSave,
  isSaving
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSaving]);

  if (!manifest) return null;

  const nothingToSave = (manifest.validUrisCount ?? 0) === 0;
  const skippedCount = manifest.skippedCount ?? ((manifest.totalTracks ?? 0) - (manifest.validUrisCount ?? 0));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-review-title">
      <div className="deck-panel max-w-lg sm:max-w-xl w-full p-6 relative bg-[#1B1F19] border-[#394133] shadow-2xl space-y-4">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="absolute top-4 right-4 text-[#BAC2B3] hover:text-[#F3F0E6] min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 disabled:opacity-30"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[rgba(214,252,85,0.12)] text-[#D6FC55] flex items-center justify-center shrink-0 border border-[rgba(214,252,85,0.25)]">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 id="save-review-title" className="text-base sm:text-lg font-bold text-[#F3F0E6]">
              A new playlist. Your original stays put.
            </h3>
            <p className="text-xs sm:text-sm text-[#BAC2B3]">
              Review the details before creating the playlist in your account.
            </p>
          </div>
        </div>

        {/* Breakdown Panel */}
        <div className="bg-[#10120F] rounded-lg p-3.5 sm:p-4 border border-[#394133] space-y-2.5 text-xs sm:text-sm">
          <div className="flex justify-between">
            <span className="text-[#7E8876]">New playlist name:</span>
            <span className="text-[#D6FC55] font-semibold font-mono">
              {manifest.targetPlaylist.name}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-[#7E8876]">Visibility:</span>
            <span className="text-[#F3F0E6]">
              Private playlist (only you can see it)
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-[#7E8876]">Tracks to add:</span>
            <span className="text-[#F3F0E6] font-mono tabular-nums">
              {manifest.validUrisCount} tracks
            </span>
          </div>

          {nothingToSave ? (
            <p className="text-[11px] sm:text-xs text-[#F59E0B] leading-relaxed pt-1">
              {manifest.isSampleData
                ? 'Nothing to save: this is the demo set - its tracks are sample data, not real tracks in your Spotify account. Load one of your own playlists to save a sequence.'
                : 'Nothing to save: none of the tracks in this set are linked to a Spotify track, so there is nothing Deck Order can write. Load the set from Spotify (not a pasted list) to save it.'}
            </p>
          ) : skippedCount > 0 ? (
            <p className="text-[11px] sm:text-xs text-[#BAC2B3] leading-relaxed pt-1">
              {skippedCount} track{skippedCount === 1 ? '' : 's'} will be skipped - {skippedCount === 1 ? 'it has' : 'they have'} no Spotify track link (for example tracks added from suggestions).
            </p>
          ) : null}

          <div className="flex justify-between">
            <span className="text-[#7E8876]">Source playlist:</span>
            <span className="text-[#BAC2B3] truncate max-w-[200px]">
              {manifest.sourceSnapshot.name}
            </span>
          </div>

          {manifest.operationId && (
            <div className="flex justify-between font-mono text-[10px] pt-1 border-t border-[#252B22]">
              <span className="text-[#7E8876]">Batch ID:</span>
              <span className="text-[#7E8876]">{manifest.operationId}</span>
            </div>
          )}
        </div>

        {/* Protection Note */}
        <div className="p-3 rounded bg-[#252B22] border border-[#394133] text-xs text-[#BAC2B3] flex items-start gap-2">
          <Check className="w-4 h-4 text-[#86EFAC] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Your original playlist will remain unchanged. Deck Order creates a fresh private playlist and writes the newly arranged sequence in batches.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="deck-btn-secondary text-xs"
          >
            Cancel
          </button>
          <button
            onClick={onConfirmSave}
            disabled={isSaving || nothingToSave}
            className="deck-btn-primary text-xs"
            title={nothingToSave ? 'No Spotify tracks to write' : undefined}
          >
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Disc className="w-4 h-4 animate-spin text-[#10120F]" />
                Creating your playlist...
              </span>
            ) : nothingToSave ? (
              'Nothing to save'
            ) : (
              'Create private playlist'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
