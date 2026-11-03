import React, { useState } from 'react';
import { Plus, Check, Music } from 'lucide-react';

export function SuggestionsDrawer({
  bridgeSuggestions = [],
  bonusTunes = [],
  onToggleSuggestion,
  onApplySelectedSuggestions
}) {
  const [activeTab, setActiveTab] = useState('bridge');

  const hasSuggestions = bridgeSuggestions.length > 0 || bonusTunes.length > 0;
  if (!hasSuggestions) return null;

  const selectedCount = [...bridgeSuggestions, ...bonusTunes].filter(t => t.selected).length;

  return (
    <div className="deck-panel p-5 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-[#394133] gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#F3F0E6] uppercase tracking-wide font-sans">
            Find the missing link
          </h3>
          <p className="text-xs text-[#BAC2B3]">
            Bridge tracks to smooth awkward joins in your set. Preview before adding.
          </p>
        </div>

        {selectedCount > 0 && (
          <button
            onClick={onApplySelectedSuggestions}
            className="deck-btn-primary text-xs w-full sm:w-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Insert {selectedCount} track{selectedCount > 1 ? 's' : ''} into order</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-[#394133] text-xs">
        <button
          onClick={() => setActiveTab('bridge')}
          className={`pb-2 font-semibold border-b-2 transition-colors ${
            activeTab === 'bridge'
              ? 'border-[#D6FC55] text-[#D6FC55]'
              : 'border-transparent text-[#BAC2B3] hover:text-[#F3F0E6]'
          }`}
        >
          Bridge suggestions ({bridgeSuggestions.length})
        </button>
        {bonusTunes.length > 0 && (
          <button
            onClick={() => setActiveTab('bonus')}
            className={`pb-2 font-semibold border-b-2 transition-colors ${
              activeTab === 'bonus'
                ? 'border-[#D6FC55] text-[#D6FC55]'
                : 'border-transparent text-[#BAC2B3] hover:text-[#F3F0E6]'
            }`}
          >
            Additional suggestions ({bonusTunes.length})
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        {activeTab === 'bridge' && (
          bridgeSuggestions.length === 0 ? (
            <p className="text-xs text-[#7E8876] py-3">No bridge tracks required for current set.</p>
          ) : (
            bridgeSuggestions.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleSuggestion(item.id)}
                className={`p-3 rounded-lg border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  item.selected
                    ? 'bg-[#252B22] border-[#D6FC55]'
                    : 'bg-[#10120F] border-[#394133] hover:border-[#4F5A47]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={Boolean(item.selected)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-[#D6FC55] bg-[#10120F] border-[#394133]"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#F3F0E6] truncate">
                        {item.artist} - {item.title}
                      </span>
                      {item.camelot && (
                        <span className="badge-camelot">
                          {item.camelot}
                        </span>
                      )}
                      {item.bpm && (
                        <span className="text-xs font-mono text-[#BAC2B3] tabular-nums">
                          {item.bpm} BPM
                        </span>
                      )}
                    </div>
                    {item.reason && (
                      <p className="text-[11px] text-[#BAC2B3] mt-0.5 truncate">
                        {item.reason}
                      </p>
                    )}
                  </div>
                </div>

                <span className="text-[10px] font-mono uppercase bg-[#1B1F19] text-[#7E8876] px-2 py-0.5 rounded shrink-0 border border-[#394133]">
                  {item.source || 'Suggested'}
                </span>
              </div>
            ))
          )
        )}

        {activeTab === 'bonus' && (
          bonusTunes.length === 0 ? (
            <p className="text-xs text-[#7E8876] py-3">No additional recommendations found.</p>
          ) : (
            bonusTunes.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleSuggestion(item.id)}
                className={`p-3 rounded-lg border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  item.selected
                    ? 'bg-[#252B22] border-[#D6FC55]'
                    : 'bg-[#10120F] border-[#394133] hover:border-[#4F5A47]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={Boolean(item.selected)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-[#D6FC55] bg-[#10120F] border-[#394133]"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#F3F0E6] truncate">
                        {item.artist} - {item.title}
                      </span>
                      {item.camelot && (
                        <span className="badge-camelot">
                          {item.camelot}
                        </span>
                      )}
                      {item.bpm && (
                        <span className="text-xs font-mono text-[#BAC2B3] tabular-nums">
                          {item.bpm} BPM
                        </span>
                      )}
                    </div>
                    {item.reason && (
                      <p className="text-[11px] text-[#BAC2B3] mt-0.5 truncate">
                        {item.reason}
                      </p>
                    )}
                  </div>
                </div>

                <span className="text-[10px] font-mono uppercase bg-[#1B1F19] text-[#7E8876] px-2 py-0.5 rounded shrink-0 border border-[#394133]">
                  {item.source || 'Suggested'}
                </span>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
