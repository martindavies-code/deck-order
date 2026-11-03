import React from 'react';
import { X, ShieldCheck, Check, Disc3 } from 'lucide-react';

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
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Commit to Spotify (No Takebacks at 3 AM)
            </h3>
            <p className="text-xs text-slate-400">
              Audit Batch ID: <code className="font-mono text-cyan-400">{manifest.operationId}</code>
            </p>
          </div>
        </div>

        <div className="bg-[#0b0d14] rounded-xl p-4 my-4 border border-[#23293e] space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Target Playlist Name:</span>
            <span className="text-emerald-400 font-bold font-mono">
              {manifest.targetPlaylist.name}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Privacy Status:</span>
            <span className="text-slate-200 font-semibold">
              Private (Safe from public scrutiny)
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Sequenced Banger Count:</span>
            <span className="text-white font-bold font-mono tabular-nums">
              {manifest.validUrisCount} tracks
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Source Heritage:</span>
            <span className="text-slate-300 truncate max-w-[200px]">
              {manifest.sourceSnapshot.name}
            </span>
          </div>
        </div>

        {/* Safety Guarantee */}
        <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-start gap-2.5 mb-6">
          <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
          <div className="space-y-1">
            <strong className="block font-semibold text-emerald-200">
              Strict Non-Destructive Invariant:
            </strong>
            <p className="text-emerald-300/90 leading-relaxed text-[11px]">
              A brand new private playlist will be created. Your source playlist remains entirely unmolested, un-reordered, and as chaotic as you originally left it.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="deck-btn-secondary text-xs"
          >
            Abort Mission
          </button>
          <button
            onClick={onConfirmSave}
            disabled={isSaving}
            className="deck-btn-primary text-xs"
          >
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Disc3 className="w-4 h-4 animate-spin" />
                Writing Batches to Spotify...
              </span>
            ) : (
              'Confirm & Manufacture Playlist'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
