import React, { useEffect, useState } from 'react';
import { X, Clock, Play, Trash2, Bookmark } from 'lucide-react';

export function HistoryDrawer({
  isOpen,
  onClose,
  history = [],
  onLoadSet,
  onClearHistory,
  onDeleteSet,
  googleUser
}) {
  // Two-tap inline confirm guards accidental deletion of a single set.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) setConfirmDeleteId(null);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="saved-sets-title">
      <div className="deck-panel max-w-xl w-full p-6 relative bg-[#1B1F19] border-[#394133] shadow-2xl max-h-[85vh] flex flex-col space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#BAC2B3] hover:text-[#F3F0E6] min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[rgba(214,252,85,0.12)] text-[#D6FC55] flex items-center justify-center shrink-0 border border-[rgba(214,252,85,0.25)]">
            <Bookmark className="w-5 h-5" />
          </div>
          <div>
            <h3 id="saved-sets-title" className="text-base font-bold text-[#F3F0E6]">
              Saved sets
            </h3>
            <p className="text-xs text-[#BAC2B3]">
              {googleUser ? `Synced with ${googleUser.email}` : 'Stored locally in browser'}
            </p>
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2">
          {history.length === 0 ? (
            <div className="text-center py-10 text-xs text-[#7E8876] bg-[#10120F] rounded border border-[#394133] p-4">
              No saved sets yet. When you sequence a tracklist, it will be saved here so you can revisit it later.
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="bg-[#10120F] border border-[#394133] hover:border-[#D6FC55] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-[#F3F0E6] truncate">
                    {item.name}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] font-mono text-[#BAC2B3]">
                    <span className="flex items-center gap-1 text-[#7E8876]">
                      <Clock className="w-3 h-3" />
                      {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>{item.trackCount} tracks</span>
                    {typeof item.smoothPct === 'number' && (
                      <span className="text-[#86EFAC] tabular-nums">
                        {item.smoothPct}% smooth
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto flex-wrap justify-end">
                  <button
                    onClick={() => {
                      onLoadSet(item);
                      onClose();
                    }}
                    className="deck-btn-secondary text-xs min-h-[36px] py-1 px-3"
                    title="Load this set into the workspace"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Load set</span>
                  </button>

                  {onDeleteSet && (
                    confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            onDeleteSet(item.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-[11px] font-semibold text-[#EF4444] border border-[rgba(239,68,68,0.4)] rounded px-2 min-h-[36px] hover:bg-[rgba(239,68,68,0.12)] transition-colors"
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-[#BAC2B3] px-2 min-h-[36px] hover:text-[#F3F0E6] transition-colors"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(item.id)}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7E8876] hover:text-[#EF4444] transition-colors"
                        aria-label={`Delete saved set ${item.name}`}
                        title="Delete this saved set (others are kept)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[#394133] mt-auto">
          {history.length > 0 ? (
            <button
              onClick={onClearHistory}
              className="text-xs text-[#EF4444] hover:underline flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear saved sets</span>
            </button>
          ) : <div />}

          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
