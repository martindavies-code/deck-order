import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.jsx';
import { SourcePicker } from './components/SourcePicker.jsx';
import { CoverageReport } from './components/CoverageReport.jsx';
import { SequencedTable } from './components/SequencedTable.jsx';
import { removeTrackAt, restoreTrackAt } from './utils/trackBadges.js';
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
  formatPlaylistLoadToast,
  parseCsvText,
  verifyTracklist,
  computeCoverageCounts,
  requestSavePreview,
  confirmSavePlaylist,
  copyTracklistText,
  triggerCsvDownload,
  refreshSpotifyToken,
  SPOTIFY_403_MSG
} from './services/api.js';
import { applyManualOverride, revertManualOverride, replaceTrackById } from './utils/manualOverride.js';
import { evaluateCurrentOrder, DJSequencer } from './services/clientSequencer.js';
import {
  initiateSpotifyLogin,
  saveStaySignedInPreference,
  getStoredCodeVerifier,
  clearStoredCodeVerifier,
  verifyAndClearAuthState,
  getSpotifyRedirectUri,
  getStoredSpotifyTokens,
  saveSpotifyTokens,
  clearSpotifyTokens
} from './services/spotifyPkce.js';
import {
  getStoredGoogleUser,
  logoutGoogle,
  getAccountKey,
  getCrateHistory,
  updateActiveSet,
  clearCrateHistory,
  removeSetFromHistory,
  forgetThisDevice
} from './services/googleAuth.js';
import { Copy, Download, Disc, Check, ArrowLeft, Edit2, AlertCircle } from 'lucide-react';

export function App() {
  const [status, setStatus] = useState(null);
  const [initialTokens] = useState(() => getStoredSpotifyTokens());
  const [authToken, setAuthToken] = useState(initialTokens.accessToken);
  const [refreshToken, setRefreshToken] = useState(initialTokens.refreshToken);
  const [staySignedIn, setStaySignedIn] = useState(initialTokens.staySignedIn);
  const [authUser, setAuthUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistLoadProgress, setPlaylistLoadProgress] = useState(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);

  // Set name and sample flag
  const [setName, setSetName] = useState('Untitled Set');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSampleSet, setIsSampleSet] = useState(false);

  // Google Auth & Crate History (Keyed by account per Fix 6)
  const [googleUser, setGoogleUser] = useState(() => getStoredGoogleUser());
  const accountKey = getAccountKey(googleUser, authUser);
  const [crateHistory, setCrateHistory] = useState(() => getCrateHistory(accountKey));
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [activeSetId, setActiveSetId] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const newSetIdentity = () => {
    const id = `set_${crypto.randomUUID()}`;
    setActiveSetId(id); setSaveError(false);
  };

  // Tracks & Sequencing State
  const [tracks, setTracks] = useState([]);
  const [orderedTracks, setOrderedTracks] = useState([]);
  const [originalTracks, setOriginalTracks] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [originalEvaluation, setOriginalEvaluation] = useState(null);
  const [coverageReport, setCoverageReport] = useState(null);
  const metadataSourceLabel = (() => {
    const names = [...new Set(tracks.flatMap(t => (t.sources || []).map(src => src.name || src.provider)).filter(Boolean))];
    if (names.length) return `Metadata: ${names.join(', ')}`;
    // No provider metadata on any track: say what actually happened.
    if (tracks.some(t => (typeof t.bpm === 'number' && t.bpm > 0) || t.camelot)) return 'Supplied metadata';
    if (coverageReport?.providerUnreachable || coverageReport?.providerPartialFailure) return 'Metadata check incomplete';
    return 'No tempo/key metadata';
  })();

  // Active track selection for Inspector
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(null);
  // Last track removed from the working set, kept for one-step undo. Removal
  // only ever touches the local working set (orderedTracks) - never the
  // source Spotify playlist.
  const [lastRemoved, setLastRemoved] = useState(null);

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
  const [showRedoConfirm, setShowRedoConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Real loading progress for the import UI: { stage: 'fetch'|'verify'|'parse', fetched, total }
  const [loadProgress, setLoadProgress] = useState(null);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState(null);

  // Every edit belongs to one document identity, including reorder/removal/name.
  useEffect(() => {
    if (!activeSetId || !tracks.length || prevAccountKeyRef.current !== accountKey) return;
    const result = updateActiveSet({
      id: activeSetId, name: setName, tracks: orderedTracks, originalTracks,
      evaluation: evaluateCurrentOrder(orderedTracks, { enableEnergy })
    }, accountKey);
    setCrateHistory(result.history);
    setSaveError(!result.saved);
  }, [activeSetId, orderedTracks, originalTracks, setName, enableEnergy, accountKey]);

  useEffect(() => {
    if (!saveError) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveError]);

  // Load Status on startup
  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(err => console.error('Error fetching backend status:', err));
  }, []);

  // Isolate crate history by account and clear in-progress set on account switch (Fix 6)
  const prevAccountKeyRef = useRef(accountKey);
  useEffect(() => {
    if (prevAccountKeyRef.current !== accountKey) {
      prevAccountKeyRef.current = accountKey;
      setCrateHistory(getCrateHistory(accountKey));
      setActiveSetId(null); setSaveError(false);
      setTracks([]);
      setOrderedTracks([]);
      setOriginalTracks([]);
      setEvaluation(null);
      setOriginalEvaluation(null);
      setCoverageReport(null);
      setSelectedPlaylist(null);
      setSelectedTrackIndex(null);
      setIsSampleSet(false);
    }
  }, [accountKey]);

  // Handle PKCE Callback with CSRF state verification (Fix 3 & Fix 4)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const verifier = getStoredCodeVerifier();

    if (code) {
      if (!verifier) {
        showToast('Spotify authorization error: missing code verifier session.', 5000);
        return;
      }

      const isStateValid = verifyAndClearAuthState(state);
      if (!isStateValid) {
        clearStoredCodeVerifier();
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('Spotify authorization rejected: state mismatch (potential CSRF).', 5000);
        return;
      }

      setIsLoading(true);
      const redirectUri = getSpotifyRedirectUri();

      exchangeAuthCode(code, verifier, redirectUri)
        .then(tokenData => {
          setAuthToken(tokenData.access_token);
          if (tokenData.refresh_token) {
            setRefreshToken(tokenData.refresh_token);
          }
          saveSpotifyTokens(tokenData, staySignedIn);
          clearStoredCodeVerifier();
          window.history.replaceState({}, document.title, window.location.pathname);
          showToast('Spotify account connected.');
        })
        .catch(err => {
          showToast(`Spotify connection error: ${err.message}`, 5000);
          clearStoredCodeVerifier();
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .finally(() => setIsLoading(false));
    }
  }, [staySignedIn]);

  const handleRefreshPlaylists = () => {
    if (!authToken) return;
    setPlaylistRefreshTick(t => t + 1);
  };

  // Fetch all owned playlists and user profile when authenticated with silent refresh & honest 403 handling
  useEffect(() => {
    if (!authToken) {
      setPlaylists([]);
      setPlaylistsLoading(false);
      setPlaylistLoadProgress(null);
      return;
    }

    const controller = new AbortController();
    let keepLoadingForRetry = false;
    setPlaylistsLoading(true);
    setPlaylistLoadProgress(null);

    fetchPlaylists(authToken, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted) {
          setPlaylistLoadProgress(progress);
        }
      }
    })
      .then(data => {
        if (controller.signal.aborted) return;
        setPlaylists(data.playlists || []);
        if (data.user) {
          setAuthUser({
            id: data.user.id,
            display_name: data.user.display_name || data.playlists?.[0]?.ownerName || 'Spotify User',
            images: data.user.images
          });
        } else if (data.playlists?.[0]) {
          setAuthUser({
            id: data.playlists[0].ownerId || 'spotify_user',
            display_name: data.playlists[0].ownerName || 'Spotify User'
          });
        }
      })
      .catch(async (err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        console.warn('Could not fetch playlists:', err);
        if (err.status === 401 || err.message?.includes('401')) {
          // Attempt silent token refresh if refresh_token exists
          if (refreshToken) {
            const refreshed = await refreshSpotifyToken(refreshToken);
            if (!controller.signal.aborted && refreshed?.access_token) {
              keepLoadingForRetry = true;
              setAuthToken(refreshed.access_token);
              if (refreshed.refresh_token) setRefreshToken(refreshed.refresh_token);
              saveSpotifyTokens(refreshed, staySignedIn);
              return;
            }
          }
          if (controller.signal.aborted) return;
          setAuthToken(null);
          setAuthUser(null);
          clearSpotifyTokens();
          showToast('Spotify session expired. Please reconnect.', 4000);
        } else if (err.status === 403 || err.message?.includes('403')) {
          showToast(SPOTIFY_403_MSG, 6000);
        } else if (err.status === 429) {
          showToast(err.message || 'Spotify rate limit reached. Please try again shortly.', 6000);
        } else {
          showToast(`Could not load Spotify playlists: ${err.message}`, 5000);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && !keepLoadingForRetry) {
          setPlaylistsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [authToken, refreshToken, staySignedIn, playlistRefreshTick]);

  const showToast = (msg, duration = 3000, type = 'success') => {
    const text = typeof msg === 'string' ? msg : msg?.text || msg?.message || String(msg);
    const toastType = typeof msg === 'object' && msg?.type ? msg.type : type;
    setToastMessage({ text, type: toastType });
    setTimeout(() => setToastMessage(null), duration);
  };

  // Persist the stay-signed-in choice immediately so it survives the OAuth
  // redirect (component state is lost when the page navigates to Spotify).
  const handleToggleStaySignedIn = (value) => {
    setStaySignedIn(value);
    saveStaySignedInPreference(value);
  };

  const handleConnectSpotify = async () => {
    try {
      await initiateSpotifyLogin();
    } catch (err) {
      showToast(err.message, 5000);
    }
  };

  const handleDisconnectSpotify = () => {
    setAuthToken(null);
    setRefreshToken(null);
    setAuthUser(null);
    setPlaylists([]);
    clearSpotifyTokens();
    showToast('Spotify account disconnected.');
  };

  const handleLoginGoogle = (user) => {
    setGoogleUser(user);
    showToast(`Signed in as ${user.name}`);
  };

  const handleLogoutGoogle = () => {
    logoutGoogle();
    setGoogleUser(null);
    showToast('Signed out of Google account.');
  };

  const handleForgetDevice = () => {
    forgetThisDevice();
    setAuthToken(null);
    setRefreshToken(null);
    setAuthUser(null);
    setGoogleUser(null);
    setPlaylists([]);
    setCrateHistory([]);
    handleStartFresh();
    showToast('All local data and session tokens wiped from this device.');
  };

  const handleLoadHistoricalSet = (historicalSet) => {
    if (saveError && !window.confirm('Your latest changes are not saved. Load another set and discard those changes?')) return false;
    const loadedId = historicalSet.id || `set_${crypto.randomUUID()}`;
    setActiveSetId(loadedId); setSaveError(false);
    setOrderedTracks(historicalSet.tracks || []);
    setLastRemoved(null);
    setOriginalTracks(historicalSet.originalTracks || historicalSet.tracks || []);
    setTracks(historicalSet.tracks || []);
    setEvaluation(evaluateCurrentOrder(historicalSet.tracks || [], { enableEnergy }));
    setOriginalEvaluation(evaluateCurrentOrder(historicalSet.originalTracks || historicalSet.tracks || [], { enableEnergy }));
    setSelectedPlaylist({ name: historicalSet.name, id: null, itemCount: historicalSet.tracks?.length || 0 });
    setSetName(historicalSet.name || 'Saved Set');
    setIsSampleSet(false);
    setViewMode('sequenced');
    setSelectedTrackIndex(0);
    setShowHistoryDrawer(false);
    showToast(`Loaded "${historicalSet.name}".`);
    return true;
  };

  const handleClearHistory = () => {
    if (!window.confirm('Delete all saved sets? The open set will stay in this session.')) return;
    setActiveSetId(null);
    clearCrateHistory(accountKey);
    setCrateHistory([]);
    showToast('Saved sets cleared.');
  };

  const handleDeleteSet = (setId) => {
    if (setId === activeSetId) { setActiveSetId(null); }
    const updated = removeSetFromHistory(setId, accountKey);
    setCrateHistory(updated);
    showToast('Set deleted. Your other saved sets are untouched.');
  };

  // Ingest Spotify Playlist
  const handleSelectPlaylist = async (pl) => {
    setIsLoading(true);
    setLoadingPlaylistId(pl.id);
    setLoadProgress({ stage: 'fetch', fetched: 0, total: pl.itemCount || null });
    setSelectedPlaylist(pl);
    setSetName(pl.name);
    setIsSampleSet(false);
    try {
      const data = await fetchPlaylistItems(authToken, pl.id, setLoadProgress);
      setLoadProgress({ stage: 'verify', fetched: 0, total: data.items.length || null });
      const verifyRes = await verifyTracklist(data.items, false, setLoadProgress);
      const loadedCount = verifyRes.tracks.length;
      const totalReturned = data.totalItems ?? loadedCount;
      const skipped = data.skipped || { episodes: 0, localFiles: 0, unavailable: 0, unsupported: 0, total: 0 };

      const toastInfo = formatPlaylistLoadToast(pl, loadedCount, totalReturned, skipped);

      if (loadedCount === 0) {
        setTracks([]);
        setCoverageReport(null);
        setOrderedTracks([]);
        setEvaluation(null);
        setSelectedTrackIndex(null);
        showToast(toastInfo.text, 6000, toastInfo.type);
        return;
      }

      newSetIdentity();
      setTracks(verifyRes.tracks);
      setCoverageReport({ ...verifyRes.report, ...computeCoverageCounts(verifyRes.tracks) });
      // Show the imported order immediately so the playlist never "disappears";
      // "Build my running order" re-sequences from here.
      setOrderedTracks(verifyRes.tracks);
      setLastRemoved(null);
      setOriginalTracks(verifyRes.tracks);
      setEvaluation(null);
      setOriginalEvaluation(null);
      setViewMode('original');
      setSelectedTrackIndex(null);
      const rep = verifyRes.report || {};
      if (rep.providerUnreachable) {
        showToast(`Loaded ${loadedCount} tracks, but the tempo/key check did not finish - the metadata provider did not respond. Reload the playlist to try again.`, 7000, 'warning');
      } else if (rep.providerPartialFailure) {
        showToast(`Loaded ${loadedCount} tracks. Tempo/key checked for ${rep.checkedCount} of ${rep.total}; ${rep.uncheckedCount} still missing - reload the playlist to retry.`, 7000, 'warning');
      } else {
        showToast(toastInfo.text, toastInfo.type === 'warning' ? 5000 : 3000, toastInfo.type);
      }
    } catch (err) {
      if (err.status === 403 || err.message?.includes('403')) {
        showToast(SPOTIFY_403_MSG, 6000, 'error');
      } else if (err.status === 401) {
        showToast('Spotify session expired (401). Please reconnect.', 5000, 'error');
      } else {
        showToast(`Could not read playlist: ${err.message}`, 5000, 'error');
      }
    } finally {
      setIsLoading(false);
      setLoadProgress(null);
      setLoadingPlaylistId(null);
    }
  };

  // Ingest CSV / Demo Tracklist
  const handleParseCsv = async (csvContent, isSample = false) => {
    setIsLoading(true);
    setLoadProgress({ stage: 'parse', fetched: 0, total: null });
    setIsSampleSet(isSample);
    const title = isSample ? 'Demo Electronic Set' : 'Imported Tracklist';
    setSelectedPlaylist({ name: title, id: null, itemCount: 0 });
    setSetName(title);

    try {
      const parsed = await parseCsvText(csvContent);
      setLoadProgress({ stage: 'verify', fetched: 0, total: parsed.tracks.length || null });
      const verifyRes = await verifyTracklist(parsed.tracks, isSample, setLoadProgress);
      newSetIdentity();
      setTracks(verifyRes.tracks);
      setCoverageReport({ ...verifyRes.report, ...computeCoverageCounts(verifyRes.tracks) });
      // Show the imported order immediately; "Build my running order" re-sequences.
      setOrderedTracks(verifyRes.tracks);
      setLastRemoved(null);
      setOriginalTracks(verifyRes.tracks);
      setEvaluation(null);
      setOriginalEvaluation(null);
      setViewMode('original');
      setSelectedTrackIndex(null);
      const rep = verifyRes.report || {};
      if (rep.providerUnreachable) {
        showToast('Tempo/key check did not finish - the metadata provider did not respond. Showing your supplied values.', 6000, 'warning');
      } else if (rep.providerPartialFailure) {
        showToast(`Loaded ${verifyRes.tracks.length} tracks. Tempo/key check incomplete for ${rep.uncheckedCount} track${rep.uncheckedCount === 1 ? '' : 's'} - re-import to retry.`, 6000, 'warning');
      } else {
        showToast(`Loaded ${verifyRes.tracks.length} tracks.`);
      }
    } catch (err) {
      showToast(`Import issue: ${err.message}`, 5000);
    } finally {
      setIsLoading(false);
      setLoadProgress(null);
    }
  };

  // Run Sequencer
  const handleRunSequencer = () => {
    if (orderedTracks.length > 0) setShowRedoConfirm(true);
  };

  const handleConfirmRedo = async () => {
    setShowRedoConfirm(false);
    if (orderedTracks.length === 0) return;
    setIsLoading(true);

    try {
      const solver = new DJSequencer({
        seed: 42,
        enableEnergy,
        unverifiedStrategy
      });

      const res = solver.solve(orderedTracks);
      setOrderedTracks(res.orderedTracks);
      setLastRemoved(null);
      setEvaluation(res.evaluation);
      setOriginalEvaluation(evaluateCurrentOrder(originalTracks, { enableEnergy }));
      setViewMode('sequenced');
      setSelectedTrackIndex(0);

      // Suggestions refer to old positions; do not keep stale placement advice.
      setBridgeSuggestions([]);
      setBonusTunes([]);

      const gradedPairs = res.evaluation?.gradedCount ?? 0;
      showToast(gradedPairs > 0
        ? ((res.evaluation?.unverifiedCount ?? 0) > 0
          ? `Draft order built - ${res.evaluation.unverifiedCount} transitions need review.` : 'Running order built.')
        : 'Order preserved as imported - insufficient metadata to grade transitions.');
    } catch (err) {
      showToast(`Couldn't build the order. Your tracks are still here.`, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Reorder Tracks (drag-drop or keyboard move)
  const handleReorderTracks = async (newOrderedList) => {
    setOrderedTracks(newOrderedList);
    // Grade the displayed order, not a re-optimised one: the solver's own
    // evaluation describes its returned order, which is not what is on screen.
    setEvaluation(evaluateCurrentOrder(newOrderedList, { enableEnergy }));
  };

  // Remove one track from the working set (undoable; source playlist untouched)
  const handleRemoveTrack = async (track, index) => {
    const { tracks: updated, removed, index: removedIndex } = removeTrackAt(orderedTracks, index);
    if (!removed) return;
    setOrderedTracks(updated);
    setLastRemoved({ track: removed, index: removedIndex });
    setSelectedTrackIndex(null);
    // Grade the surviving displayed order; never re-optimise on removal.
    setEvaluation(evaluateCurrentOrder(updated, { enableEnergy }));
    showToast(`Removed "${removed.title || removed.name || 'track'}" from this set. The original playlist is untouched.`, 4000);
  };

  // Undo the last removal, restoring the track at its original position
  const handleUndoRemove = async () => {
    if (!lastRemoved) return;
    const restored = restoreTrackAt(orderedTracks, lastRemoved.track, lastRemoved.index);
    setOrderedTracks(restored);
    setLastRemoved(null);
    // Grade the restored displayed order; never re-optimise on undo.
    setEvaluation(evaluateCurrentOrder(restored, { enableEnergy }));
    showToast(`Restored "${lastRemoved.track.title || lastRemoved.track.name || 'track'}".`);
  };

  // Restore Original Order
  const handleRestoreOriginal = () => {
    if (originalTracks.length === 0) return;
    setOrderedTracks([...originalTracks]);
    setEvaluation(originalEvaluation);
    setViewMode('original');
    showToast('Restored original track order.');
  };

  // Change working metadata locally. No provider calls, remote writes or re-optimisation.
  const commitTrackValue = (trackId, replacement, message) => {
    const updatedTracks = replaceTrackById(tracks, trackId, replacement);
    const updatedOrdered = replaceTrackById(orderedTracks, trackId, replacement);
    const updatedOriginal = replaceTrackById(originalTracks, trackId, replacement);
    const updatedEvaluation = evaluateCurrentOrder(updatedOrdered, { enableEnergy });
    setTracks(updatedTracks);
    setOrderedTracks(updatedOrdered);
    setOriginalTracks(updatedOriginal);
    setEvaluation(updatedEvaluation);
    setOriginalEvaluation(evaluateCurrentOrder(updatedOriginal, { enableEnergy }));
    setCoverageReport(previous => previous ? ({
      ...previous,
      ...computeCoverageCounts(updatedTracks),
      tempoReviewTracks: (previous.tempoReviewTracks || []).filter(t => t.id !== trackId)
        .concat(replacement.tempoNeedsReview ? [replacement] : []),
      recordingReviewTracks: (previous.recordingReviewTracks || []).filter(t => t.id !== trackId)
        .concat(replacement.recordingNeedsReview ? [replacement] : [])
    }) : null);
    showToast(message);
  };

  const handleApplyOverride = (trackId, overrideData) => {
    try {
      const track = (viewMode === 'original' ? originalTracks : orderedTracks).find(t => t.id === trackId);
      if (!track) throw new Error('This track is no longer in the working set.');
      commitTrackValue(trackId, applyManualOverride(track, overrideData), 'Custom value applied.');
      return true;
    } catch (err) {
      showToast(`Could not apply value: ${err.message}`, 5000, 'warning');
      return false;
    }
  };

  const handleRevertOverride = (trackId) => {
    const track = orderedTracks.find(t => t.id === trackId);
    if (track) commitTrackValue(trackId, revertManualOverride(track), 'Reset to source value.');
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
      setSaveResult(result);
      showToast(`New playlist "${result.name}" created with ${result.trackCount} tracks.`);
    } catch (err) {
      if (err.status === 403 || err.message?.includes('403')) {
        showToast(SPOTIFY_403_MSG, 6000);
      } else {
        showToast(`Spotify haven't confirmed whether the save finished. Check the playlist before trying again.`, 6000);
      }
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
    if (saveError && !window.confirm('Your latest changes could not be saved. Start a new set and discard them?')) return false;
    setActiveSetId(null); setSaveError(false);
    setSetName('Untitled Set');
    setTracks([]);
    setOrderedTracks([]);
    setOriginalTracks([]);
    setEvaluation(null);
    setOriginalEvaluation(null);
    setCoverageReport(null);
    setSelectedPlaylist(null);
    setSelectedTrackIndex(null);
    setIsSampleSet(false);
    setShowRedoConfirm(false);
    return true;
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
          className={`fixed top-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-50 bg-[#1B1F19] border ${
            toastMessage.type === 'error'
              ? 'border-[#EF4444]'
              : toastMessage.type === 'warning'
              ? 'border-[#F59E0B]'
              : 'border-[#D6FC55]'
          } text-[#F3F0E6] px-4 py-2.5 rounded-md text-xs font-semibold shadow-2xl flex items-center gap-2`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-[#EF4444]" />
          ) : toastMessage.type === 'warning' ? (
            <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
          ) : (
            <Check className="w-4 h-4 text-[#D6FC55]" />
          )}
          <span>{toastMessage.text || toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <Header
        status={status}
        authUser={authUser}
        googleUser={googleUser}
        historyCount={crateHistory.length}
        staySignedIn={staySignedIn}
        onToggleStaySignedIn={handleToggleStaySignedIn}
        onConnectSpotify={handleConnectSpotify}
        onDisconnectSpotify={handleDisconnectSpotify}
        onLoginGoogle={handleLoginGoogle}
        onLogoutGoogle={handleLogoutGoogle}
        onForgetDevice={handleForgetDevice}
        onOpenHistory={() => setShowHistoryDrawer(true)}
      />

      {saveError && <div role="alert" className="sticky top-20 z-40 mx-4 mt-4 p-3 bg-[#1B1F19] border border-[#F59E0B] rounded text-sm text-[#FDE047]">
        Changes are active in this session, but could not be saved. Your previous saved set is untouched. Free browser storage before leaving.
        <button type="button" className="deck-btn-secondary ml-3 text-xs" onClick={() => {
          if (!activeSetId) newSetIdentity();
          else {
            const result = updateActiveSet({ id: activeSetId, name: setName, tracks: orderedTracks, originalTracks, evaluation }, accountKey);
            setCrateHistory(result.history); setSaveError(!result.saved);
          }
        }}>Retry save</button>
      </div>}
      <main className="flex-1 max-w-[1480px] w-full mx-auto px-4 pt-5 sm:px-6 sm:pt-6 lg:px-10 lg:pt-8 space-y-6 lg:space-y-8 pb-36 sm:pb-40">
        {!isSetLoaded ? (
          /* Composition A: Before a Set is Loaded */
          <SourcePicker
            spotifyConnected={Boolean(authToken)}
            playlists={playlists}
            playlistsLoading={playlistsLoading}
            playlistLoadProgress={playlistLoadProgress}
            onRefreshPlaylists={handleRefreshPlaylists}
            onSelectPlaylist={handleSelectPlaylist}
            onParseCsv={handleParseCsv}
            onConnectSpotify={handleConnectSpotify}
            isLoading={isLoading}
            loadProgress={loadProgress}
            loadingPlaylistId={loadingPlaylistId}
            staySignedIn={staySignedIn}
            onToggleStaySignedIn={handleToggleStaySignedIn}
          />
        ) : (
          /* Composition B: With a Set Loaded (Workbench) */
          <div className="space-y-6 lg:space-y-8">
            {/* Workspace Bar: Set Name, Back Button, Status Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#394133] pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={handleStartFresh}
                  className="deck-btn-ghost text-xs sm:text-sm flex items-center gap-1.5 text-[#BAC2B3] hover:text-[#F3F0E6] p-1.5 sm:px-2.5 sm:py-2"
                  title="Return to track import"
                  aria-label="New set"
                >
                  <ArrowLeft className="w-4 h-4" /> New set
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
                        className="deck-input text-base font-bold py-0.5 px-2 w-64"
                      />
                    ) : (
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="text-lg sm:text-xl lg:text-2xl font-bold text-[#F3F0E6] truncate hover:text-[#D6FC55] flex items-center gap-2 group text-left"
                        title="Click to rename set"
                      >
                        <span>{setName}</span>
                        <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#7E8876] group-hover:text-[#D6FC55]" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-[#BAC2B3] font-mono">
                    {tracks.length} tracks · {isSampleSet ? 'Sample dataset' : metadataSourceLabel}
                  </p>
                </div>
              </div>

              {/* Sample Data Banner */}
              {isSampleSet && (
                <div className="text-[11px] sm:text-xs font-mono text-[#FFB08E] bg-[rgba(255,136,87,0.12)] border border-[rgba(255,136,87,0.3)] px-3 py-1.5 rounded flex items-center gap-2">
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

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleRunSequencer} disabled={isLoading || !orderedTracks.length} className="deck-btn-secondary text-xs sm:text-sm min-h-[44px]">Redo order</button>
              {!activeSetId && <button className="deck-btn-secondary text-xs sm:text-sm min-h-[44px]" onClick={newSetIdentity}>Save as new set</button>}
              <p className="text-xs sm:text-sm text-[#BAC2B3]">Recalculate using your latest track info. You'll confirm before the current order changes.</p>
            </div>

            {/* Comparison Overview (Original vs Suggested) */}
            {evaluation && originalEvaluation && (
              <ComparisonView
                originalEvaluation={originalEvaluation}
                sequencedEvaluation={evaluation}
                hasPartialData={!!coverageReport && (coverageReport.missingTempo < coverageReport.total || coverageReport.missingKey < coverageReport.total)}
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              {/* Left Column: Running Order (8 cols = ~66%) */}
              <div className="lg:col-span-8 space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs sm:text-sm font-mono uppercase tracking-wider text-[#BAC2B3]">
                    {viewMode === 'sequenced' ? 'Your set, taking shape' : 'Original imported order'}
                  </h3>
                  <span className="text-xs sm:text-sm text-[#7E8876] font-mono tabular-nums">
                    {currentDisplayTracks.length} tracks
                  </span>
                </div>

                {lastRemoved && viewMode === 'sequenced' && (
                  <div
                    role="status"
                    className="deck-panel px-4 py-2.5 mb-3 flex items-center justify-between gap-3 border-[#F59E0B]"
                  >
                    <span className="text-xs text-[#BAC2B3]">
                      Removed <span className="font-bold text-[#F3F0E6]">{lastRemoved.track.title || lastRemoved.track.name || 'track'}</span> from this set.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleUndoRemove}
                        className="deck-btn-secondary text-xs"
                      >
                        Undo
                      </button>
                      <button
                        onClick={() => setLastRemoved(null)}
                        className="text-[#7E8876] hover:text-[#F3F0E6] text-xs px-2 py-1"
                        aria-label="Dismiss undo"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                <SequencedTable
                  tracks={currentDisplayTracks}
                  transitions={currentDisplayTransitions}
                  selectedTrackId={activeTrack?.id}
                  onReorderTracks={viewMode === 'sequenced' ? handleReorderTracks : undefined}
                  onSelectTrack={(t, idx) => setSelectedTrackIndex(idx)}
                  onRemoveTrack={viewMode === 'sequenced' ? handleRemoveTrack : undefined}
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
            <div className="max-w-[1480px] mx-auto px-0 lg:px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[#BAC2B3] hidden sm:flex">
                <span className="w-2 h-2 rounded-full bg-[#D6FC55]" />
                <span>
                  {evaluation
                    ? ((evaluation.gradedCount ?? 0) > 0
                      ? ((evaluation.unverifiedCount ?? 0) > 0
                        ? `Draft order built - ${evaluation.unverifiedCount} transition${evaluation.unverifiedCount > 1 ? 's' : ''} need${evaluation.unverifiedCount > 1 ? '' : 's'} review before grading.`
                        : 'Running order ready.')
                      : 'Order preserved as imported - no graded transitions yet.')
                    : 'Original order loaded - not yet sequenced.'}
                </span>
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

      {showRedoConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={() => setShowRedoConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="redo-title" className="deck-panel p-5 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()} onKeyDown={e => {
            if (e.key === 'Escape') setShowRedoConfirm(false);
            if (e.key === 'Tab') {
              const buttons = e.currentTarget.querySelectorAll('button');
              if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
              else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0].focus(); }
            }
          }}>
            <h2 id="redo-title" className="text-lg font-bold text-[#F3F0E6]">Replace the current order?</h2>
            <p className="text-sm text-[#BAC2B3]">This will recalculate and replace your current running order using the latest track info. Your track edits stay, removed tracks stay out, and the original playlist is untouched.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus onClick={() => setShowRedoConfirm(false)} className="deck-btn-secondary min-h-[44px]">Cancel</button>
              <button type="button" onClick={handleConfirmRedo} className="deck-btn-primary min-h-[44px]">Yes, redo order</button>
            </div>
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      <HistoryDrawer
        isOpen={showHistoryDrawer}
        history={crateHistory}
        activeSetId={activeSetId}
        saveError={saveError}
        onNewSet={() => { if (handleStartFresh() !== false) setShowHistoryDrawer(false); }}
        googleUser={googleUser}
        onClose={() => setShowHistoryDrawer(false)}
        onLoadSet={handleLoadHistoricalSet}
        onClearHistory={handleClearHistory}
        onDeleteSet={handleDeleteSet}
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
