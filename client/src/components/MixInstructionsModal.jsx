import React, { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Check, Sliders, Copy, AlertTriangle, Sparkles } from 'lucide-react';
import { buildMixRecipe } from '../utils/mixRecipe.js';

export function MixInstructionsModal({
  saveResult,
  orderedTracks = [],
  evaluation = null,
  setName = '',
  onClose
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const snapshotTracks = saveResult?.orderedTracks || orderedTracks;
  const snapshotEvaluation = saveResult?.evaluation || evaluation;
  const snapshotName = saveResult?.playlistName || saveResult?.name || saveResult?.setName || setName || 'Deck Order Set';
  const shouldFilterByManifest = !saveResult?.orderedTracks && Array.isArray(saveResult?.urisManifest);

  const recipe = useMemo(
    () => buildMixRecipe(
      snapshotTracks,
      snapshotEvaluation,
      snapshotName,
      shouldFilterByManifest ? { urisManifest: saveResult.urisManifest } : undefined
    ),
    [snapshotTracks, snapshotEvaluation, snapshotName, shouldFilterByManifest, saveResult?.urisManifest]
  );

  if (!saveResult) return null;

  const handleCopyRecipe = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(recipe.plainText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = recipe.plainText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const badgeToneClass = (tone) => {
    if (tone === 'SMOOTH') return 'bg-[rgba(74,222,128,0.12)] text-[#86EFAC] border-[rgba(74,222,128,0.3)]';
    if (tone === 'STRETCH') return 'bg-[rgba(250,204,21,0.12)] text-[#FDE047] border-[rgba(250,204,21,0.3)]';
    if (tone === 'CLASH') return 'bg-[rgba(248,113,113,0.12)] text-[#FCA5A5] border-[rgba(248,113,113,0.3)]';
    return 'bg-[rgba(245,158,11,0.12)] text-[#F59E0B] border-[rgba(245,158,11,0.3)]';
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-success-title">
      <div className="deck-panel max-w-2xl w-full max-h-[90vh] flex flex-col p-4 sm:p-6 relative bg-[#1B1F19] border-[#394133] shadow-2xl space-y-3 sm:space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#BAC2B3] hover:text-[#F3F0E6] min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 pr-8 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-[rgba(74,222,128,0.12)] text-[#86EFAC] flex items-center justify-center shrink-0 border border-[rgba(74,222,128,0.3)]">
            <Check className="w-5 h-5" />
          </div>
          <div>
            <h3 id="save-success-title" className="text-base sm:text-lg font-bold text-[#F3F0E6]">
              New playlist created.
            </h3>
            <p className="text-xs sm:text-sm text-[#BAC2B3]">
              {saveResult.itemsWritten} tracks saved in the chosen sequence.
            </p>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 pr-1 space-y-3 sm:space-y-4">
          {/* Mix Instructions Box */}
          <div className="bg-[#10120F] border border-[#394133] rounded-lg p-3 sm:p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#D6FC55]">
              <Sliders className="w-4 h-4" />
              <span>Playback in Spotify</span>
            </div>

            <blockquote className="text-xs sm:text-sm text-[#F3F0E6] leading-relaxed italic border-l-2 border-[#D6FC55] pl-3">
              "Open your new playlist in the Spotify app. If your Premium account and app version include the Mix feature, tap Mix, then Auto to apply transitions, and tap any transition to customize them. Mix shows each track's BPM and key so you can sanity-check the order."
            </blockquote>

            <div className="text-xs text-[#E2E8DC] leading-relaxed space-y-1.5 pt-1">
              <p>
                <span className="font-semibold text-[#D6FC55]">Phrase timing:</span> {recipe.phraseGuidance}
              </p>
              <p className="text-[#BAC2B3] text-[11px] sm:text-xs">
                {recipe.caveat}
              </p>
            </div>
          </div>

          {/* Per-Transition Mix Recipe */}
          {recipe.items.length > 0 && (
            <div className="bg-[#10120F] border border-[#394133] rounded-lg p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-[#F3F0E6] uppercase tracking-wide">
                    Mix recipe
                  </h4>
                  <p className="text-[11px] text-[#7E8876]">
                    Recommended Spotify Mix settings per transition ({Math.max(0, recipe.items.length - 1)} blends)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyRecipe}
                  className="deck-btn-secondary text-xs min-h-[38px]"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#86EFAC]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied Mix recipe' : 'Copy Mix recipe'}</span>
                </button>
              </div>

              <ol className="space-y-2">
                {recipe.items.map((item) => (
                  <li key={`${item.id || 't'}_${item.position}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#1B1F19] border border-[#2C3327]">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-[11px] font-mono text-[#7E8876] w-5 shrink-0">
                          {String(item.position).padStart(2, '0')}
                        </span>
                        <span className="text-xs sm:text-[13px] text-[#F3F0E6] font-medium truncate">
                          {item.artist} — {item.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] text-[#BAC2B3]">
                        <span>{item.bpm ? `${item.bpm}` : '—'} BPM</span>
                        <span>·</span>
                        <span>{item.camelot || '—'}</span>
                      </div>
                    </div>

                    {item.transition && (
                      <div className="ml-4 pl-3 border-l-2 border-[#394133] py-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${badgeToneClass(item.transition.tone)}`}>
                            {item.transition.badge}
                          </span>
                          <span className="text-xs text-[#F3F0E6]">
                            {item.transition.preset}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-[#7E8876]">
                          {item.transition.bpmChange !== null && (
                            <span className="tabular-nums">
                              {item.transition.bpmChange > 0 ? `+${item.transition.bpmChange}` : item.transition.bpmChange} BPM
                              {item.transition.tempoDiffPct !== null ? ` (${item.transition.tempoDiffPct}%)` : ''}
                            </span>
                          )}
                          {item.transition.driftBeats !== null && (
                            <span>· ~{item.transition.driftBeats} beats drift / 16b</span>
                          )}
                          {item.transition.energyBoost && (
                            <span className="inline-flex items-center gap-1 text-[#D6FC55]">
                              <Sparkles className="w-3 h-3" />
                              Energy boost
                            </span>
                          )}
                          {item.transition.loudnessWarning && (
                            <span className="inline-flex items-center gap-1 text-[#FBBF24]">
                              <AlertTriangle className="w-3 h-3" />
                              {item.transition.loudnessWarning}
                              {item.transition.loudnessChange !== null ? ` (${item.transition.loudnessChange > 0 ? '+' : ''}${item.transition.loudnessChange} dB)` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 shrink-0">
          {saveResult.spotifyUrl ? (
            <a
              href={saveResult.spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="deck-btn-primary text-xs"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open in Spotify</span>
            </a>
          ) : <div />}

          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
