import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.jsx';
import { SourcePicker } from './components/SourcePicker.jsx';
import { CoverageReport } from './components/CoverageReport.jsx';
import { SequencedTable } from './components/SequencedTable.jsx';
import { ComparisonView } from './components/ComparisonView.jsx';
import { HarmonicArcVisualizer } from './components/HarmonicArcVisualizer.jsx';
import { InspectorRail } from './components/InspectorRail.jsx';
import { SuggestionsDrawer } from './components/SuggestionsDrawer.jsx';
import { DisputeModal } from './components/DisputeModal.jsx';
import { DryRunModal } from './components/DryRunModal.jsx';
import { MixInstructionsModal } from './components/MixInstructionsModal.jsx';
import { HistoryDrawer } from './components/HistoryDrawer.jsx';
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
import {
  getStoredGoogleUser,
  promptGoogleLogin,
  logoutGoogle,
  getCrateHistory,
  saveSetToHistory,
  clearCrateHistory
} from './services/googleAuth.js';
import { Copy, Download, Disc, Check, ArrowLeft, Edit2, AlertCircle } from 'lucide-react';

export function App() {
  const [status, setStatus] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('spotify_access_token'));
  const [authUser, setAuthUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);

  // Set name and sample flag
  const [setName, setSetName] = useState('Untitled Set');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSampleSet, setIsSampleSet] = useState(false);

  // Google Auth & Crate History
  const [googleUser, setGoogleUser] = useState(() => getStoredGoogleUser());
  const [crateHistory, setCrateHistory] = useState(() => getCrateHistory());
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  // Tracks & Sequencing State
  const [tracks, setTracks] = useState([]);
  const [orderedTracks, setOrderedTracks] = useState([]);
  const [originalTracks, setOriginalTracks] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [originalEvaluation, setOriginalEvaluation] = useState(null);
  const [coverageReport, setCoverageReport] = useState(null);

  // Active track selection for Inspector
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(null);

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
          showToast('Spotify account connected.');
        })
        .catch(err => {
          showToast(`Spotify connection error: ${err.message}`, 5000);
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
            setAuthUser({ display_name: data.playlists[0].ownerName || 'Spotify User' });
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
    showToast('Spotify account disconnected.');
  };

  const handleLoginGoogle = () => {
    const user = promptGoogleLogin();
    setGoogleUser(user);
    showToast(`Signed in as ${user.name}`);
  };

  const handleLogoutGoogle = () => {
    logoutGoogle();
    setGoogleUser(null);
    showToast('Signed out of Google account.');
  };

  const handleLoadHistoricalSet = (historicalSet) => {
    setOrderedTracks(historicalSet.tracks || []);
    setOriginalTracks(historicalSet.tracks || []);
    setTracks(historicalSet.tracks || []);
    setEvaluation(historicalSet.evaluation || null);
    setSelectedPlaylist({ name: historicalSet.name, id: null, itemCount: historicalSet.tracks?.length || 0 });
    setSetName(historicalSet.name || 'Saved Set');
    setIsSampleSet(false);
    setViewMode('sequenced');
    setSelectedTrackIndex(0);
    setShowHistoryDrawer(false);
    showToast(`Loaded "${historicalSet.name}".`);
  };

  const handleClearHistory = () => {
    clearCrateHistory();
    setCrateHistory([]);
    showToast('Saved sets cleared.');
  };

  // Ingest Spotify Playlist
  const handleSelectPlaylist = async (pl) => {
    setIsLoading(true);
    setSelectedPlaylist(pl);
    setSetName(pl.name);
    setIsSampleSet(false);
    try {
      const data = await fetchPlaylistItems(authToken, pl.id);
      const verifyRes = await verifyTracklist(data.items, false);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);
      setOrderedTracks([]);
      setEvaluation(null);
      setSelectedTrackIndex(null);
      showToast(`Loaded ${verifyRes.tracks.length} tracks from "${pl.name}".`);
    } catch (err) {
      showToast(`Could not read playlist: ${err.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Ingest CSV / Demo Tracklist
  const handleParseCsv = async (csvContent, isSample = false) => {
    setIsLoading(true);
    setIsSampleSet(isSample);
    const title = isSample ? 'Demo Electronic Set' : 'Imported Tracklist';
    setSelectedPlaylist({ name: title, id: null, itemCount: 0 });
    setSetName(title);

    try {
      const parsed = await parseCsvText(csvContent);
      const verifyRes = await verifyTracklist(parsed.tracks, isSample);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);
      setOrderedTracks([]);
      setEvaluation(null);
      setSelectedTrackIndex(null);
      showToast(`Loaded ${verifyRes.tracks.length} tracks.`);
    } catch (err) {
      showToast(`Import issue: ${err.message}`, 5000);
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
      setSelectedTrackIndex(0);

      // Auto-save set to history
      const updatedHistory = saveSetToHistory({
        name: setName || 'My Set',
        tracks: res.orderedTracks,
        evaluation: res.evaluation
      });
      setCrateHistory(updatedHistory);

      // Fetch bridge & bonus suggestions if available
      try {
        const sugRes = await fetchSuggestions(res.evaluation, res.orderedTracks, authToken);
        setBridgeSuggestions(sugRes.bridgeSuggestions || []);
        setBonusTunes(sugRes.bonusTunes || []);
      } catch (sugErr) {
        console.warn('Suggestions note:', sugErr);
      }

      showToast(`Running order built.`);
    } catch (err) {
      showToast(`Couldn't build the order. Your tracks are still here.`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Reorder Tracks (drag-drop or keyboard move)
  const handleReorderTracks = async (newOrderedList) => {
    setOrderedTracks(newOrderedList);
    try {
      const seqRes = await runSequencer(newOrderedList, {
        seed: 42,
        enableEnergy,
        unverifiedStrategy: 'keep_relative_position'
      });
      setEvaluation(seqRes.result.evaluation);
    } catch (err) {
      console.warn('Re-evaluation note:', err);
    }
  };

  // Restore Original Order
  const handleRestoreOriginal = () => {
    if (originalTracks.length === 0) return;
    setOrderedTracks([...originalTracks]);
    setEvaluation(originalEvaluation);
    setViewMode('original');
    showToast('Restored original track order.');
  };

  // Apply user manual override for a track
  const handleApplyOverride = async (trackId, overrideData) => {
    try {
      await submitOverride(trackId, overrideData);
      const verifyRes = await verifyTracklist(tracks, isSampleSet);
      setTracks(verifyRes.tracks);
      setCoverageReport(verifyRes.report);

      // Also update currently ordered tracks
      const updatedOrdered = orderedTracks.map(t => {
        if (t.id === trackId) {
          return {
            ...t,
            bpm: overrideData.bpm || t.bpm,
            key: overrideData.key || t.key,
            confidence: 'user_override'
          };
        }
        return t;
      });
      setOrderedTracks(updatedOrdered);

      if (updatedOrdered.length > 0) {
        const seqRes = await runSequencer(updatedOrdered, {
          seed: 42,
          enableEnergy,
          unverifiedStrategy
        });
        setEvaluation(seqRes.result.evaluation);
      }
      showToast('Custom value applied.');
    } catch (err) {
      showToast(`Could not apply value: ${err.message}`, 5000);
    }
  };

  const handleRevertOverride = (trackId) => {
    const original = tracks.find(t => t.id === trackId);
    if (!original) return;
    handleApplyOverride(trackId, {
      bpm: original.rawBpm || original.bpm,
      key: original.rawKey || original.key
    });
    showToast('Reset to source value.');
  };

  // Suggestion actions
  const handleToggleSuggestion = (id) => {
    setBridgeSuggestions(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
    setBonusTunes(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  };

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
    setBridgeSuggestions(prev => prev.map(s => ({ ...s, selected: false })));
    setBonusTunes(prev => prev.map(s => ({ ...s, selected: false })));
    showToast(`Added ${allSelected.length} suggestion(s) to running order.`);
  };

  // Save Flow
  const handleOpenDryRun = async () => {
    if (!selectedPlaylist || orderedTracks.length === 0) return;
    try {
      const preview = await requestSavePreview(
        { ...selectedPlaylist, name: setName },
        orderedTracks
      );
      setSaveManifest(preview.manifest);
    } catch (err) {
      showToast(`Could not prepare save preview: ${err.message}`, 5000);
    }
  };

  const handleConfirmSave = async () => {
    if (!saveManifest || !authToken) {
      showToast('Connect Spotify account to create a playlist.', 4000);
      return;
    }
    setIsSaving(true);
    try {
      const result = await confirmSavePlaylist(authToken, saveManifest);
      setSaveManifest(null);
      setSaveResult(result.result);
      showToast('New playlist created.');
    } catch (err) {
      showToast(`Spotify haven't confirmed whether the save finished. Check the playlist before trying again.`, 6000);
    } finally {
      setIsSaving(false);
    }
  };

  // Export handlers
  const handleCopyText = async () => {
    if (orderedTracks.length === 0) return;
    try {
      const text = await copyTracklistText(orderedTracks);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast('Tracklist copied. Ready to take it elsewhere.');
    } catch {
      showToast('Could not copy tracklist. Try downloading CSV instead.', 4000);
    }
  };

  const handleDownloadCsv = async () => {
    if (orderedTracks.length === 0) return;
    try {
      await triggerCsvDownload(orderedTracks, evaluation);
      showToast('CSV export downloaded.');
    } catch {
      showToast('Could not download CSV.', 3000);
    }
  };

  // Reset to home state
  const handleStartFresh = () => {
    setTracks([]);
    setOrderedTracks([]);
    setOriginalTracks([]);
    setEvaluation(null);
    setOriginalEvaluation(null);
    setCoverageReport(null);
    setSelectedPlaylist(null);
    setSelectedTrackIndex(null);
    setIsSampleSet(false);
  };

  const currentDisplayTracks = viewMode === 'original' ? originalTracks : orderedTracks;
  const currentDisplayTransitions = viewMode === 'original' ? originalEvaluation?.transitions : evaluation?.transitions;

  const isSetLoaded = tracks.length > 0;
  const activeTrack = selectedTrackIndex !== null ? currentDisplayTracks[selectedTrackIndex] : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#10120F] text-[#F3F0E6]">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-50 bg-[#1B1F19] border border-[#D6FC55] text-[#F3F0E6] px-4 py-2.5 rounded-md text-xs font-semibold shadow-2xl flex items-center gap-2"
        >
          <Check className="w-4 h-4 text-[#D6FC55]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <Header
        status={status}
        authUser={authUser}
        googleUser={googleUser}
        historyCount={crateHistory.length}
        onConnectSpotify={handleConnectSpotify}
        onDisconnectSpotify={handleDisconnectSpotify}
        onLoginGoogle={handleLoginGoogle}
        onLogoutGoogle={handleLogoutGoogle}
        onOpenHistory={() => setShowHistoryDrawer(true)}
      />

      <main className="flex-1 max-w-[1240px] w-full mx-auto p-4 sm:p-6 space-y-6 pb-28">
        {!isSetLoaded ? (
          /* Composition A: Before a Set is Loaded */
          <SourcePicker
            spotifyConnected={Boolean(authToken)}
            playlists={playlists}
            onSelectPlaylist={handleSelectPlaylist}
            onParseCsv={handleParseCsv}
            onConnectSpotify={handleConnectSpotify}
            isLoading={isLoading}
          />
        ) : (
          /* Composition B: With a Set Loaded (Workbench) */
          <div className="space-y-6">
            {/* Workspace Bar: Set Name, Back Button, Status Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#394133] pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={handleStartFresh}
                  className="deck-btn-ghost text-xs flex items-center gap-1.5 text-[#BAC2B3] hover:text-[#F3F0E6] p-1.5"
                  title="Return to track import"
                  aria-label="Return to import"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isEditingName ? (
                      <input
                        type="text"
                        value={setName}
                        onChange={(e) => setSetName(e.target.value)}
                        onBlur={() => setIsEditingName(false)}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                        autoFocus
                        className="deck-input text-base font-bold !py-0.5 !px-2 w-64"
                      />
                    ) : (
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="text-lg font-bold text-[#F3F0E6] truncate hover:text-[#D6FC55] flex items-center gap-2 group text-left"
                        title="Click to rename set"
                      >
                        <span>{setName}</span>
                        <Edit2 className="w-3.5 h-3.5 text-[#7E8876] group-hover:text-[#D6FC55]" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-[#BAC2B3] font-mono">
                    {tracks.length} tracks · {isSampleSet ? 'Sample dataset' : 'Supplied metadata'}
                  </p>
                </div>
              </div>

              {/* Sample Data Banner */}
              {isSampleSet && (
                <div className="text-[11px] font-mono text-[#FFB08E] bg-[rgba(255,136,87,0.12)] border border-[rgba(255,136,87,0.3)] px-3 py-1.5 rounded flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF8857]" />
                  <span>Demo set · sample metadata. Use it to explore the app, not verify these recordings.</span>
                </div>
              )}
            </div>

            {/* Coverage / Verification Summary */}
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

            {/* Comparison Overview (Original vs Suggested) */}
            {evaluation && originalEvaluation && (
              <ComparisonView
                originalEvaluation={originalEvaluation}
                sequencedEvaluation={evaluation}
                viewMode={viewMode}
                onToggleViewMode={setViewMode}
                onRestoreOriginal={handleRestoreOriginal}
              />
            )}

            {/* Visual Harmonic Arc & Waveform Timeline */}
            {evaluation && currentDisplayTracks.length > 1 && (
              <HarmonicArcVisualizer
                tracks={currentDisplayTracks}
                evaluation={viewMode === 'original' ? originalEvaluation : evaluation}
                onSelectTrack={(t) => {
                  const idx = currentDisplayTracks.findIndex(item => item.id === t.id);
                  setSelectedTrackIndex(idx !== -1 ? idx : 0);
                }}
              />
            )}

            {/* Main Workbench Layout: 2/3 Running Order, 1/3 Inspector Rail */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Running Order (8 cols = ~66%) */}
              <div className="lg:col-span-8 space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-[#BAC2B3]">
                    {viewMode === 'sequenced' ? 'Your set, taking shape' : 'Original imported order'}
                  </h3>
                  <span className="text-xs text-[#7E8876] font-mono tabular-nums">
                    {currentDisplayTracks.length} tracks
                  </span>
                </div>

                <SequencedTable
                  tracks={currentDisplayTracks}
                  transitions={currentDisplayTransitions}
                  selectedTrackId={activeTrack?.id}
                  onReorderTracks={handleReorderTracks}
                  onSelectTrack={(t, idx) => setSelectedTrackIndex(idx)}
                />

                {/* Suggestions Drawer (Bridge & Bonus) */}
                {orderedTracks.length > 0 && (bridgeSuggestions.length > 0 || bonusTunes.length > 0) && (
                  <SuggestionsDrawer
                    bridgeSuggestions={bridgeSuggestions}
                    bonusTunes={bonusTunes}
                    onToggleSuggestion={handleToggleSuggestion}
                    onApplySelectedSuggestions={handleApplySelectedSuggestions}
                  />
                )}
              </div>

              {/* Right Column: Track Inspector Rail (4 cols = ~33%) */}
              <div className="lg:col-span-4 lg:sticky lg:top-20 space-y-4">
                <InspectorRail
                  track={activeTrack}
                  position={selectedTrackIndex !== null ? selectedTrackIndex + 1 : 1}
                  totalTracks={currentDisplayTracks.length}
                  transitionBefore={selectedTrackIndex > 0 ? currentDisplayTransitions?.[selectedTrackIndex - 1] : null}
                  transitionAfter={selectedTrackIndex !== null ? currentDisplayTransitions?.[selectedTrackIndex] : null}
                  onClose={() => setSelectedTrackIndex(null)}
                  onApplyOverride={handleApplyOverride}
                  onRevertOverride={handleRevertOverride}
                />
              </div>
            </div>
          </div>
        )}

        {/* Restrained Bottom Action Dock (Sticky at bottom) */}
        {orderedTracks.length > 0 && (
          <aside
            aria-label="Export and save actions"
            className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-[#1B1F19]/95 backdrop-blur-md border-t border-[#394133] z-30 shadow-2xl"
          >
            <div className="max-w-[1240px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[#BAC2B3] hidden sm:flex">
                <span className="w-2 h-2 rounded-full bg-[#D6FC55]" />
                <span>Running order ready.</span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                <button
                  onClick={handleCopyText}
                  className="deck-btn-secondary text-xs flex-1 sm:flex-none"
                  title="Copy plain-text tracklist for TuneMyMusic or notes"
                >
                  <Copy className="w-3.5 h-3.5 text-[#BAC2B3]" />
                  <span>Copy tracklist</span>
                </button>

                <button
                  onClick={handleDownloadCsv}
                  className="deck-btn-secondary text-xs flex-1 sm:flex-none"
                  title="Download full CSV with BPM, Camelot, and transition grades"
                >
                  <Download className="w-3.5 h-3.5 text-[#BAC2B3]" />
                  <span>Download CSV</span>
                </button>

                <button
                  onClick={handleOpenDryRun}
                  disabled={!authToken}
                  className="deck-btn-primary text-xs w-full sm:w-auto"
                  title={authToken ? 'Review details before creating playlist' : 'Connect Spotify to create playlist'}
                >
                  <Disc className="w-4 h-4" />
                  <span>Review Spotify save</span>
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#394133] py-6 px-4 sm:px-6 text-center text-xs text-[#7E8876] space-y-2 mt-auto">
        <p>
          A running-order tool, not an audio mixer. Source details stay with each track.
        </p>
        <p className="text-[11px] text-[#7E8876]">
          BPM and musical key data verified via{' '}
          <a
            href="https://getsongbpm.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#BAC2B3] hover:underline"
          >
            GetSongBPM
          </a>{' '}
          and{' '}
          <a
            href="https://sonovault.now"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#BAC2B3] hover:underline"
          >
            Sonovault
          </a>{' '}
          where configured, or supplied by you.
        </p>
      </footer>

      {/* Modals & Drawers */}
      <HistoryDrawer
        isOpen={showHistoryDrawer}
        history={crateHistory}
        googleUser={googleUser}
        onClose={() => setShowHistoryDrawer(false)}
        onLoadSet={handleLoadHistoricalSet}
        onClearHistory={handleClearHistory}
      />

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
