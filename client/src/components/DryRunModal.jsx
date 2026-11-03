import React from 'react';
import { X, ShieldCheck, AlertCircle, Play, Check } from 'lucide-react';

export function DryRunModal({
  manifest,
  onClose,
  onConfirmSave,
  isSaving
}) {
  if (!manifest) return null;

  return (
    <div className="modal-backdrop">
      <div className="deck-card max-w-lg w-full p-6 relative bg-[#131622] border-[#2c334d] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Dry Run Save Preview
            </h3>
            <p className="text-xs text-slate-400">
              Operation ID: <code className="font-mono text-cyan-400">{manifest.operationId}</code>
            </p>
          </div>
        </div>

        <div className="bg-[#0b0d14] rounded-xl p-4 my-4 border border-[#23293e] space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Target Playlist:</span>
            <span className="text-emerald-400 font-bold font-mono">
              {manifest.targetPlaylist.name}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Visibility:</span>
            <span className="text-slate-200 font-semibold">
              Private (public: false)
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Total Sequenced Tracks:</span>
            <span className="text-white font-bold font-mono">
              {manifest.validUrisCount}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Source Playlist:</span>
            <span className="text-slate-300">
              {manifest.sourceSnapshot.name}
            </span>
          </div>
        </div>

        {/* Safety Notice */}
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-start gap-2 mb-6">
          <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
          <span>
            <strong>Non-destructive write guaranteed:</strong> A brand new private playlist will be created. Your source playlist is never modified, reordered, or deleted.
          </span>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Cancel
          </button>
          <button
            onClick={onConfirmSave}
            disabled={isSaving}
            className="deck-btn-primary text-xs"
          >
            {isSaving ? 'Writing Batches...' : 'Confirm & Create Spotify Playlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
