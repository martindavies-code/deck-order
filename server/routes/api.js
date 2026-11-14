import { Router } from 'express';
import { VerificationPipeline } from '../core/pipeline.js';
import { DJSequencer } from '../core/solver.js';
import { SuggestionEngine } from '../core/bridgeFinder.js';
import { SpotifyClient } from '../spotify/client.js';
import { SafePlaylistWriter, generatePlainTextTracklist, generateCSVExport } from '../spotify/safeWriter.js';
import { parseTracklistCSV } from '../providers/csvParser.js';
import { auditLogger } from '../spotify/auditLogger.js';
import {
  createRateLimiter,
  extractBearerToken,
  isValidSpotifyId,
  validateVerifyPayload,
  validateCsvPayload,
  validateSequencePayload,
  validateSaveConfirmPayload,
  validateOverridePayload,
  errorHandler
} from '../middleware/security.js';
import { ValidationError, SpotifyAuthError } from '../core/errors.js';

export function createApiRouter(config = {}) {
  const router = Router();

  // Rate Limiting Middleware
  router.use(createRateLimiter({ windowMs: 60 * 1000, maxRequests: 120 }));

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
        musicae: {
          name: 'Musicae',
          isConfigured: pipeline.musicae.isConfigured(),
          quota: 'Free tier (10 req/day, RapidAPI)',
          condition: 'Tiebreaker/fallback only, ISRC-addressable, ISRC-cached'
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
  router.post('/auth/token', async (req, res, next) => {
    const { code, code_verifier, redirect_uri } = req.body;
    if (!code || !code_verifier || !redirect_uri) {
      return next(new ValidationError('Missing code, code_verifier, or redirect_uri'));
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
        body: params,
        signal: AbortSignal.timeout(8000)
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
      next(err);
    }
  });

  // Spotify Playlists
  router.get('/spotify/playlists', async (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next(new SpotifyAuthError('Missing or malformed Spotify authorization header'));

    const client = new SpotifyClient({
      accessToken: token,
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret
    });

    try {
      const playlists = await client.getMyPlaylists();
      res.json({ success: true, playlists });
    } catch (err) {
      next(err);
    }
  });

  // Spotify Playlist Items
  router.get('/spotify/playlists/:id/items', async (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next(new SpotifyAuthError('Missing or malformed Spotify authorization header'));
    if (!isValidSpotifyId(req.params.id)) {
      return next(new ValidationError('Invalid Spotify playlist ID format.'));
    }

    const client = new SpotifyClient({
      accessToken: token,
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret
    });

    try {
      const items = await client.getPlaylistItems(req.params.id);
      res.json({ success: true, items });
    } catch (err) {
      next(err);
    }
  });

  // Parse CSV (Validated)
  router.post('/pipeline/parse-csv', validateCsvPayload, (req, res) => {
    const { csvContent } = req.body;
    const tracks = parseTracklistCSV(csvContent);
    res.json({ success: true, tracks, count: tracks.length });
  });

  // Process & Verify Playlist (Validated)
  router.post('/pipeline/verify', validateVerifyPayload, async (req, res, next) => {
    const { tracks } = req.body;
    try {
      const { tracks: verifiedTracks, report } = await pipeline.processPlaylist(tracks);
      res.json({ success: true, tracks: verifiedTracks, report });
    } catch (err) {
      next(err);
    }
  });

  // Manual User Override (validated without mutating shared multi-tenant pipeline singleton)
  router.post('/pipeline/override', validateOverridePayload, (req, res) => {
    const { trackId, override } = req.body;
    res.json({
      success: true,
      trackId,
      override: {
        bpm: override.bpm ?? null,
        key: override.key ?? null,
        camelot: override.camelot ?? null
      }
    });
  });

  // Solve & Sequence Tracks (Validated)
  router.post('/pipeline/sequence', validateSequencePayload, (req, res, next) => {
    const { tracks, seed, enableEnergy, unverifiedStrategy, lockedOpenerId, lockedCloserId } = req.body;

    try {
      const sequencer = new DJSequencer({
        seed: seed || 42,
        enableEnergy: enableEnergy !== undefined ? Boolean(enableEnergy) : true,
        unverifiedStrategy: unverifiedStrategy || 'keep_relative_position',
        lockedOpenerId: typeof lockedOpenerId === 'string' && lockedOpenerId.length <= 128 ? lockedOpenerId : null,
        lockedCloserId: typeof lockedCloserId === 'string' && lockedCloserId.length <= 128 ? lockedCloserId : null
      });

      const result = sequencer.solve(tracks);
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  });

  // Bridge & Bonus Track Suggestions
  router.post('/pipeline/suggestions', async (req, res, next) => {
    const { evaluation, orderedTracks } = req.body || {};
    if (!evaluation || !Array.isArray(orderedTracks) || orderedTracks.length > 1000) {
      return next(new ValidationError('Valid evaluation and orderedTracks (max 1000) required'));
    }

    try {
      let spotifyClient = null;
      const token = extractBearerToken(req.headers.authorization);
      if (token) {
        spotifyClient = new SpotifyClient({
          accessToken: token,
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
      next(err);
    }
  });

  // Dry Run Preview for Saving
  router.post('/spotify/save/preview', (req, res, next) => {
    const { sourcePlaylist, orderedTracks } = req.body || {};
    if (!sourcePlaylist || typeof sourcePlaylist !== 'object' || !Array.isArray(orderedTracks) || orderedTracks.length > 1000) {
      return next(new ValidationError('Valid sourcePlaylist and orderedTracks (max 1000) required'));
    }

    const writer = new SafePlaylistWriter(null);
    const manifest = writer.generatePreviewManifest(sourcePlaylist, orderedTracks);
    res.json({ success: true, manifest });
  });

  // Confirm and Execute Save (Validated)
  router.post('/spotify/save/confirm', validateSaveConfirmPayload, async (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next(new SpotifyAuthError('Missing or malformed Spotify authorization header'));

    const { manifest, isConfirmed } = req.body;

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
      next(err);
    }
  });

  // Plain Text Export for TuneMyMusic
  router.post('/export/text', (req, res, next) => {
    const { orderedTracks } = req.body || {};
    if (!Array.isArray(orderedTracks) || orderedTracks.length > 1000) {
      return next(new ValidationError('orderedTracks array (max 1000) required'));
    }

    const text = generatePlainTextTracklist(orderedTracks);
    res.json({ success: true, text });
  });

  // CSV Export
  router.post('/export/csv', (req, res, next) => {
    const { orderedTracks, evaluation } = req.body || {};
    if (!Array.isArray(orderedTracks) || orderedTracks.length > 1000) {
      return next(new ValidationError('orderedTracks array (max 1000) required'));
    }

    const csv = generateCSVExport(orderedTracks, evaluation);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deck_order_sequenced.csv"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  });

  // Error Handler
  router.use(errorHandler);

  return router;
}
