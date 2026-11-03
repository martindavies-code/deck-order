import { Router } from 'express';
import { VerificationPipeline } from '../core/pipeline.js';
import { DJSequencer } from '../core/solver.js';
import { SuggestionEngine } from '../core/bridgeFinder.js';
import { SpotifyClient } from '../spotify/client.js';
import { SafePlaylistWriter, generatePlainTextTracklist, generateCSVExport } from '../spotify/safeWriter.js';
import { parseTracklistCSV } from '../providers/csvParser.js';
import { auditLogger } from '../spotify/auditLogger.js';

export function createApiRouter(config = {}) {
  const router = Router();

  const pipeline = new VerificationPipeline({
    minBpm: config.minBpm || 90,
    maxBpm: config.maxBpm || 180,
    getSongBpmKey: config.getSongBpmKey,
    sonovaultKey: config.sonovaultKey,
    soundNetKey: config.soundNetKey
  });

  const suggestionEngine = new SuggestionEngine(pipeline);

  // Status & Eligibility
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      spotifyEligibility: {
        isConfigured: Boolean(config.spotifyClientId),
        clientIdProvided: Boolean(config.spotifyClientId),
        hasClientSecret: Boolean(config.spotifyClientSecret),
        mode: 'Development Mode (Max 5 allowlisted users, requires Spotify Premium)',
        quotaNote: 'Aggressive multi-tier caching enabled to stay well within shared development quotas.',
        mixFeatureNote: 'Spotify Mix audio transitions require Spotify Premium and compatible app version.'
      },
      providers: {
        getSongBPM: {
          name: 'GetSongBPM',
          isConfigured: pipeline.getSongBPM.isConfigured(),
          quota: 'Free tier (~3000 req/hr)',
          condition: 'Visible backlink required in app'
        },
        sonovault: {
          name: 'Sonovault',
          isConfigured: pipeline.sonovault.isConfigured(),
          quota: 'Free tier (1,000 req/month, Lexicon DJ engine)',
          upgradePolicy: 'Paid tiers exist (~EUR 29/mo) - NEVER auto-upgraded'
        },
        soundNet: {
          name: 'SoundNet Track Analysis (RapidAPI)',
          isConfigured: pipeline.soundNet.isConfigured(),
          quota: 'Free evaluation tier: 5 req/day. Usable tier starts at USD 9.99/month.',
          paidNotice: 'Requires explicit user opt-in and key'
        },
        manualCsv: {
          name: 'Manual CSV / Plain Text Import',
          isConfigured: true,
          status: 'Always available (Source 4 guaranteed fallback)'
        }
      }
    });
  });

  // Spotify Auth Code PKCE Exchange
  router.post('/auth/token', async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;
    if (!code || !code_verifier || !redirect_uri) {
      return res.status(400).json({ error: 'Missing code, code_verifier, or redirect_uri' });
    }

    try {
      const params = new URLSearchParams();
      params.append('client_id', config.spotifyClientId);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirect_uri);
      params.append('code_verifier', code_verifier);

      if (config.spotifyClientSecret) {
        params.append('client_secret', config.spotifyClientSecret);
      }

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      const data = await tokenRes.json();
      if (!tokenRes.ok) {
        auditLogger.log('AUTH_TOKEN_EXCHANGE_ERROR', { error: data });
        return res.status(tokenRes.status).json(data);
      }

      auditLogger.log('AUTH_TOKEN_EXCHANGE_SUCCESS', {
        expires_in: data.expires_in,
        hasRefreshToken: Boolean(data.refresh_token)
      });

      res.json(data);
    } catch (err) {
      auditLogger.log('AUTH_TOKEN_EXCHANGE_EXCEPTION', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Spotify Playlists
  router.get('/spotify/playlists', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Spotify authorization header' });

    const token = authHeader.replace('Bearer ', '');
    const client = new SpotifyClient({
      accessToken: token,
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret
    });

    try {
      const playlists = await client.getMyPlaylists();
      res.json({ success: true, playlists });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Spotify Playlist Items
  router.get('/spotify/playlists/:id/items', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Spotify authorization header' });

    const token = authHeader.replace('Bearer ', '');
    const client = new SpotifyClient({
      accessToken: token,
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret
    });

    try {
      const items = await client.getPlaylistItems(req.params.id);
      res.json({ success: true, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Parse CSV
  router.post('/pipeline/parse-csv', (req, res) => {
    const { csvContent } = req.body;
    if (!csvContent) return res.status(400).json({ error: 'Missing csvContent' });
    const tracks = parseTracklistCSV(csvContent);
    res.json({ success: true, tracks, count: tracks.length });
  });

  // Process & Verify Playlist
  router.post('/pipeline/verify', async (req, res) => {
    const { tracks } = req.body;
    if (!Array.isArray(tracks)) return res.status(400).json({ error: 'Tracks array is required' });

    try {
      const { tracks: verifiedTracks, report } = await pipeline.processPlaylist(tracks);
      res.json({ success: true, tracks: verifiedTracks, report });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual User Override
  router.post('/pipeline/override', (req, res) => {
    const { trackId, override } = req.body;
    if (!trackId || !override) return res.status(400).json({ error: 'trackId and override data required' });

    pipeline.setManualOverride(trackId, override);
    res.json({ success: true, trackId, override: pipeline.getManualOverride(trackId) });
  });

  // Solve & Sequence Tracks
  router.post('/pipeline/sequence', (req, res) => {
    const { tracks, seed, enableEnergy, unverifiedStrategy } = req.body;
    if (!Array.isArray(tracks)) return res.status(400).json({ error: 'Tracks array required' });

    try {
      const sequencer = new DJSequencer({
        seed: seed || 42,
        enableEnergy: Boolean(enableEnergy),
        unverifiedStrategy: unverifiedStrategy || 'keep_relative_position'
      });

      const result = sequencer.solve(tracks);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bridge & Bonus Track Suggestions
  router.post('/pipeline/suggestions', async (req, res) => {
    const { evaluation, orderedTracks } = req.body;
    if (!evaluation || !Array.isArray(orderedTracks)) {
      return res.status(400).json({ error: 'evaluation and orderedTracks required' });
    }

    try {
      let spotifyClient = null;
      const authHeader = req.headers.authorization;
      if (authHeader) {
        spotifyClient = new SpotifyClient({
          accessToken: authHeader.replace('Bearer ', ''),
          clientId: config.spotifyClientId
        });
      }

      const bridgeData = await suggestionEngine.findBridgeTracks(evaluation, orderedTracks, spotifyClient);
      const bonusTunes = await suggestionEngine.findBonusTunes(orderedTracks);

      res.json({
        success: true,
        gaps: bridgeData.gaps,
        bridgeSuggestions: bridgeData.suggestions,
        bonusTunes
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dry Run Preview for Saving
  router.post('/spotify/save/preview', (req, res) => {
    const { sourcePlaylist, orderedTracks } = req.body;
    if (!sourcePlaylist || !Array.isArray(orderedTracks)) {
      return res.status(400).json({ error: 'sourcePlaylist and orderedTracks required' });
    }

    const writer = new SafePlaylistWriter(null);
    const manifest = writer.generatePreviewManifest(sourcePlaylist, orderedTracks);
    res.json({ success: true, manifest });
  });

  // Confirm and Execute Save
  router.post('/spotify/save/confirm', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Spotify authorization header' });

    const { manifest, isConfirmed } = req.body;
    if (!manifest || isConfirmed !== true) {
      return res.status(400).json({ error: 'Valid manifest and explicit isConfirmed: true required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const client = new SpotifyClient({
      accessToken: token,
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret
    });

    const writer = new SafePlaylistWriter(client);

    try {
      const result = await writer.executeSave(manifest, isConfirmed);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Plain Text Export for TuneMyMusic
  router.post('/export/text', (req, res) => {
    const { orderedTracks } = req.body;
    if (!Array.isArray(orderedTracks)) return res.status(400).json({ error: 'orderedTracks required' });

    const text = generatePlainTextTracklist(orderedTracks);
    res.json({ success: true, text });
  });

  // CSV Export
  router.post('/export/csv', (req, res) => {
    const { orderedTracks, evaluation } = req.body;
    if (!Array.isArray(orderedTracks)) return res.status(400).json({ error: 'orderedTracks required' });

    const csv = generateCSVExport(orderedTracks, evaluation);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="deck_order_sequenced.csv"');
    res.send(csv);
  });

  return router;
}
