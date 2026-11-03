import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.jsx';
import { SourcePicker } from './components/SourcePicker.jsx';
import { CoverageReport } from './components/CoverageReport.jsx';
import { SequencedTable } from './components/SequencedTable.jsx';
import { ComparisonView } from './components/ComparisonView.jsx';
import { SuggestionsDrawer } from './components/SuggestionsDrawer.jsx';
import { DisputeModal } from './components/DisputeModal.jsx';
import { DryRunModal } from './components/DryRunModal.jsx';
import { MixInstructionsModal } from './components/MixInstructionsModal.jsx';
import {
  fetchStatus,
  exchangeAuthCode,
  fetchPlaylists,
  fetchPlaylistItems,
  parseCsvText,
  verifyTracklist,
  submitOverride,
  runSequencer,
  fetchSuggestions,
  requestSavePreview,
  confirmSavePlaylist,
  copyTracklistText,
  triggerCsvDownload
} from './services/api.js';
import {
  initiateSpotifyLogin,
  getStoredCodeVerifier,
  clearStoredCodeVerifier
} from './services/spotifyPkce.js';
import { Save, Copy, Download, Sliders, Check, Disc } from 'lucide-react';

export function App() {
  const [status, setStatus] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('spotify_access_token'));
  const [authUser, setAuthUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);

  // Tracks & Sequencing State
  const [tracks, setTracks] = useState([]);
  const [orderedTracks, setOrderedTracks] = useState([]);
  const [originalTracks, setOriginalTracks] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [originalEvaluation, setOriginalEvaluation] = useState(null);
  const [coverageReport, setCoverageReport] = useState(null);

  // Settings
  const [unverifiedStrategy, setUnverifiedStrategy] = useState('keep_relative_position');
  const [enableEnergy, setEnableEnergy] = useState(false);
  const [viewMode, setViewMode] = useState('sequenced'); // 'sequenced' | 'original'

  // Suggestions & Modals
  const [bridgeSuggestions, setBridgeSuggestions] = useState([]);
  const [bonusTunes, setBonusTunes] = useState([]);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [saveManifest, setSaveManifest] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load Status on startup
  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(err => console.error('Error fetching backend status:', err));
  }, []);

  // Handle PKCE Callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const verifier = getStoredCodeVerifier();

    if (code && verifier) {
      setIsLoading(true);
      exchangeAuthCode(code, verifier, window.location.origin)
        .then(tokenData => {
          setAuthToken(tokenData.access_token);
          localStorage.setItem('spotify_access_token', tokenData.access_token);
          clearStoredCodeVerifier();
          window.history.replaceState({}, document.title, window.location.pathname);
          showToast('Spotify account connected successfully!');
        })
        .catch(err => {
          showToast(`Spotify Auth Error: ${err.message}`, 5000);
          clearStoredCodeVerifier();
        })
        .finally(() => setIsLoading(false));
    }
  }, []);

  // Fetch playlists when authenticated
  useEffect(() => {
    if (authToken) {
      fetchPlaylists(authToken)
        .then(data => {
          setPlaylists(data.playlists || []);
          if (data.playlists?.[0]) {
            setAuthUser({ display_name: data.playlists[0].ownerName || 'Connected' });
          }
        })
        .catch(err => {
          console.warn('Could not fetch playlists:', err);
          if (err.message?.includes('401')) {
            setAuthToken(null);
            localStorage.removeItem('spotify_access_token');
          }
        });
    }
  }, [authToken]);

  const showToast = (msg, duration = 3000) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), duration);
  };

  const handleConnectSpotify = async () => {
    const clientId = status?.spotifyEligibility?.clientIdProvided ? status?.spotifyEligibility?.clientId : null;
    try {
      await initiateSpotifyLogin(clientId || prompt('Enter Spotify Client ID:'));
    } catch (err) {
      showToast(err.message, 5000);
    }
  };

  const handleDisconnectSpotify = () => {
    setAuthToken(null);
    setAuthUser(null);
    setPlaylists([]);
    localStorage.removeItem('spotify_access_token');
    showToast('Spotify disconnected. Offline CSV mode active.');
  };

  // Ingest Spotify Playlist
  const handleSelectPlaylist = async (pl) => {
    setIsLoading(true);
    setSelectedPlaylist(pl);
    try {
      const data = await fetchPlaylistItems(authToken, pl.id);
      const verifyRes = await verifyTracklist(data.items);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);
      setOrderedTracks([]);
      setEvaluation(null);
      showToast(`Loaded ${verifyRes.tracks.length} tracks from "${pl.name}"`);
    } catch (err) {
      showToast(`Error reading playlist: ${err.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Ingest CSV Tracklist
  const handleParseCsv = async (csvContent) => {
    setIsLoading(true);
    setSelectedPlaylist({ name: 'Manual Tracklist', id: null, itemCount: 0 });
    try {
      const parsed = await parseCsvText(csvContent);
      const verifyRes = await verifyTracklist(parsed.tracks);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);
      setOrderedTracks([]);
      setEvaluation(null);
      showToast(`Parsed ${verifyRes.tracks.length} tracks via CSV parser.`);
    } catch (err) {
      showToast(`CSV error: ${err.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Run Sequencer
  const handleRunSequencer = async () => {
    if (tracks.length === 0) return;
    setIsLoading(true);

    try {
      const seqRes = await runSequencer(tracks, {
        seed: 42,
        enableEnergy,
        unverifiedStrategy
      });

      const res = seqRes.result;
      setOrderedTracks(res.orderedTracks);
      setOriginalTracks(res.originalTracks);
      setEvaluation(res.evaluation);
      setOriginalEvaluation(res.originalEvaluation);
      setViewMode('sequenced');

      // Fetch bridge & bonus suggestions
      try {
        const sugRes = await fetchSuggestions(res.evaluation, res.orderedTracks, authToken);
        setBridgeSuggestions(sugRes.bridgeSuggestions || []);
        setBonusTunes(sugRes.bonusTunes || []);
      } catch (sugErr) {
        console.warn('Suggestions error:', sugErr);
      }

      showToast(`DJ Sequenced! Flow improved from ${res.originalEvaluation.smoothPct}% to ${res.evaluation.smoothPct}% smooth.`);
    } catch (err) {
      showToast(`Sequencer error: ${err.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Drag-and-drop Reorder -> dynamic re-evaluation!
  const handleReorderTracks = async (newOrderedList) => {
    setOrderedTracks(newOrderedList);
    try {
      // Re-run evaluation on the newly manually ordered tracks
      const seqRes = await runSequencer(newOrderedList, {
        seed: 42,
        enableEnergy,
        unverifiedStrategy: 'keep_relative_position'
      });
      setEvaluation(seqRes.result.evaluation);
      showToast('Transition grades dynamically recalculated.');
    } catch (err) {
      console.warn('Re-evaluation error:', err);
    }
  };

  // Apply user manual override for a track
  const handleApplyOverride = async (trackId, overrideData) => {
    try {
      await submitOverride(trackId, overrideData);
      const verifyRes = await verifyTracklist(tracks);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);
      showToast('Manual override saved. Recalculating...');

      if (orderedTracks.length > 0) {
        const seqRes = await runSequencer(verifyRes.tracks, {
          seed: 42,
          enableEnergy,
          unverifiedStrategy
        });
        setOrderedTracks(seqRes.result.orderedTracks);
        setEvaluation(seqRes.result.evaluation);
      }
    } catch (err) {
      showToast(`Override error: ${err.message}`, 5000);
    }
  };

  // Toggle Suggestion Checkbox
  const handleToggleSuggestion = (id) => {
    setBridgeSuggestions(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
    setBonusTunes(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  };

  // Insert Selected Suggestions into Running Order
  const handleApplySelectedSuggestions = () => {
    const selectedBridges = bridgeSuggestions.filter(s => s.selected);
    const selectedBonus = bonusTunes.filter(s => s.selected);
    const allSelected = [...selectedBridges, ...selectedBonus];

    if (allSelected.length === 0) return;

    let updatedList = [...orderedTracks];
    for (const item of allSelected) {
      const insertIdx = item.insertAfterIndex !== undefined ? item.insertAfterIndex + 1 : updatedList.length;
      updatedList.splice(insertIdx, 0, item);
    }

    handleReorderTracks(updatedList);
    // Uncheck after applying
    setBridgeSuggestions(prev => prev.map(s => ({ ...s, selected: false })));
    setBonusTunes(prev => prev.map(s => ({ ...s, selected: false })));
    showToast(`Inserted ${allSelected.length} track(s) into your set!`);
  };

  // Save Flow
  const handleOpenDryRun = async () => {
    if (!selectedPlaylist || orderedTracks.length === 0) return;
    try {
      const preview = await requestSavePreview(selectedPlaylist, orderedTracks);
      setSaveManifest(preview.manifest);
    } catch (err) {
      showToast(`Preview error: ${err.message}`, 5000);
    }
  };

  const handleConfirmSave = async () => {
    if (!saveManifest || !authToken) {
      showToast('Connect Spotify to save directly to your account.', 4000);
      return;
    }
    setIsSaving(true);
    try {
      const result = await confirmSavePlaylist(authToken, saveManifest);
      setSaveManifest(null);
      setSaveResult(result.result);
      showToast('Playlist successfully saved to Spotify!');
    } catch (err) {
      showToast(`Save error: ${err.message}`, 6000);
    } finally {
      setIsSaving(false);
    }
  };

  // Export handlers
  const handleCopyText = async () => {
    if (orderedTracks.length === 0) return;
    try {
      const text = await copyTracklistText(orderedTracks);
      await navigator.clipboard.writeText(text);
      showToast('Tracklist copied to clipboard (TuneMyMusic format)!');
    } catch (err) {
      showToast('Failed to copy text', 3000);
    }
  };

  const handleDownloadCsv = async () => {
    if (orderedTracks.length === 0) return;
    try {
      await triggerCsvDownload(orderedTracks, evaluation);
      showToast('CSV export downloaded!');
    } catch (err) {
      showToast('Failed to download CSV', 3000);
    }
  };

  const currentDisplayTracks = viewMode === 'original' ? originalTracks : orderedTracks;
  const currentDisplayTransitions = viewMode === 'original' ? originalEvaluation?.transitions : evaluation?.transitions;

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0d14]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-[#161a29] border border-emerald-500/50 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <Header
        status={status}
        authUser={authUser}
        onConnectSpotify={handleConnectSpotify}
        onDisconnectSpotify={handleDisconnectSpotify}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Source Picker (Spotify vs CSV) */}
        <SourcePicker
          spotifyConnected={Boolean(authToken)}
          playlists={playlists}
          onSelectPlaylist={handleSelectPlaylist}
          onParseCsv={handleParseCsv}
          isLoading={isLoading}
        />

        {/* Coverage Report */}
        {coverageReport && (
          <CoverageReport
            report={coverageReport}
            unverifiedStrategy={unverifiedStrategy}
            onChangeStrategy={setUnverifiedStrategy}
            onOpenDisputes={() => setShowDisputeModal(true)}
            onRunSequencer={handleRunSequencer}
            isLoading={isLoading}
            enableEnergy={enableEnergy}
            onToggleEnergy={() => setEnableEnergy(!enableEnergy)}
          />
        )}

        {/* Comparison View */}
        {evaluation && originalEvaluation && (
          <ComparisonView
            originalEvaluation={originalEvaluation}
            sequencedEvaluation={evaluation}
            viewMode={viewMode}
            onToggleViewMode={setViewMode}
          />
        )}

        {/* Sequencer Table (The Deck) */}
        {currentDisplayTracks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-300">
                {viewMode === 'sequenced' ? '🎧 DJ Running Order (Drag to Reorder)' : '📑 Original Playlist Order'}
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                {currentDisplayTracks.length} tracks • {evaluation?.smoothPct || 0}% smooth transitions
              </span>
            </div>

            <SequencedTable
              tracks={currentDisplayTracks}
              transitions={currentDisplayTransitions}
              onReorderTracks={handleReorderTracks}
              onOpenOverride={(t) => {
                setShowDisputeModal(true);
              }}
            />
          </div>
        )}

        {/* Suggestions Drawer (Bridge & Bonus) */}
        {orderedTracks.length > 0 && (bridgeSuggestions.length > 0 || bonusTunes.length > 0) && (
          <SuggestionsDrawer
            bridgeSuggestions={bridgeSuggestions}
            bonusTunes={bonusTunes}
            onToggleSuggestion={handleToggleSuggestion}
            onApplySelectedSuggestions={handleApplySelectedSuggestions}
          />
        )}

        {/* Action Bar (Save, Copy, CSV) */}
        {orderedTracks.length > 0 && (
          <div className="deck-card p-4 bg-[#121522] border-[#252c42] flex flex-wrap items-center justify-between gap-4 sticky bottom-6 shadow-2xl z-20">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Ready to save or export. Writes are always non-destructive.</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Copy Plain Text for TuneMyMusic */}
              <button
                onClick={handleCopyText}
                className="deck-btn-secondary text-xs"
                title="Copy Artist - Title list for TuneMyMusic / Soundiiz"
              >
                <Copy className="w-3.5 h-3.5 text-cyan-400" />
                Copy Tracklist (TuneMyMusic)
              </button>

              {/* Download CSV */}
              <button
                onClick={handleDownloadCsv}
                className="deck-btn-secondary text-xs"
                title="Download full CSV with BPM, Camelot, and transition metrics"
              >
                <Download className="w-3.5 h-3.5 text-purple-400" />
                Download CSV
              </button>

              {/* Save to Spotify */}
              <button
                onClick={handleOpenDryRun}
                disabled={!authToken}
                className="deck-btn-primary text-xs"
                title={authToken ? 'Preview and save as new private Spotify playlist' : 'Connect Spotify to save directly'}
              >
                <Save className="w-4 h-4" />
                Save as New Spotify Playlist
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer & Compliance Backlink */}
      <footer className="border-t border-[#181c2b] py-6 px-6 text-center text-xs text-slate-500 space-y-2 mt-auto">
        <p>
          BPM and musical key data verified via{' '}
          <a
            href="https://getsongbpm.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline"
          >
            GetSongBPM
          </a>
          ,{' '}
          <a
            href="https://sonovault.now"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline"
          >
            Sonovault
          </a>
          , and manual DJ analysis.
        </p>
        <p className="text-[11px] text-slate-600">
          Deck Order operates strictly within 2026 Spotify Web API development mode constraints. Audio transitions executed within Spotify Mix.
        </p>
      </footer>

      {/* Modals */}
      {showDisputeModal && (
        <DisputeModal
          disputedTracks={coverageReport?.disputedTracks || []}
          onClose={() => setShowDisputeModal(false)}
          onApplyOverride={handleApplyOverride}
        />
      )}

      {saveManifest && (
        <DryRunModal
          manifest={saveManifest}
          onClose={() => setSaveManifest(null)}
          onConfirmSave={handleConfirmSave}
          isSaving={isSaving}
        />
      )}

      {saveResult && (
        <MixInstructionsModal
          saveResult={saveResult}
          onClose={() => setSaveResult(null)}
        />
      )}
    </div>
  );
}
export default App;
