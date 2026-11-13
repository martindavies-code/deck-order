import { ValidationError, AppError } from '../core/errors.js';

export const SPOTIFY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SPOTIFY_TRACK_URI_RE = /^spotify:track:[A-Za-z0-9_-]{1,64}$/;

export function extractBearerToken(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

export function isValidSpotifyId(id) {
  return typeof id === 'string' && SPOTIFY_ID_RE.test(id);
}

/**
 * In-memory sliding window rate limiter
 * Protects against quota exhaustion and denial-of-service attempts.
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute
  const maxRequests = options.maxRequests || 120; // 120 req/min
  const clients = new Map();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let record = clients.get(ip);
    if (!record || now - record.startTime > windowMs) {
      record = { startTime: now, count: 1 };
      clients.set(ip, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        error: 'Too Many Requests: Rate limit exceeded. Please wait a moment.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

    // Periodic cleanup of stale client records (every ~200 requests)
    if (Math.random() < 0.005) {
      for (const [k, v] of clients.entries()) {
        if (now - v.startTime > windowMs) {
          clients.delete(k);
        }
      }
    }

    next();
  };
}

/**
 * Validates tracklist verification request
 */
export function validateVerifyPayload(req, res, next) {
  const { tracks } = req.body;
  if (!Array.isArray(tracks)) {
    throw new ValidationError('Tracks payload must be a JSON array of track objects.');
  }

  if (tracks.length === 0) {
    throw new ValidationError('Tracks array cannot be empty.');
  }

  if (tracks.length > 500) {
    throw new ValidationError(`Tracks array exceeds maximum capacity of 500 tracks (received ${tracks.length}).`);
  }

  // Validate individual tracks
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (typeof t !== 'object' || t === null) {
      throw new ValidationError(`Track at index ${i} is invalid.`);
    }

    if (t.bpm !== undefined && t.bpm !== null) {
      const bpmNum = Number(t.bpm);
      if (isNaN(bpmNum) || bpmNum <= 0 || bpmNum > 350) {
        throw new ValidationError(`Track at index ${i} has invalid BPM value: ${t.bpm}`);
      }
    }
  }

  next();
}

/**
 * Validates CSV text ingestion request
 */
export function validateCsvPayload(req, res, next) {
  const { csvContent } = req.body;
  if (typeof csvContent !== 'string' || csvContent.trim().length === 0) {
    throw new ValidationError('Missing or empty csvContent payload.');
  }

  // Maximum 2MB text payload
  if (csvContent.length > 2 * 1024 * 1024) {
    throw new ValidationError('CSV content exceeds maximum size of 2MB.');
  }

  next();
}

/**
 * Validates sequencing request
 */
export function validateSequencePayload(req, res, next) {
  const { tracks, unverifiedStrategy } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new ValidationError('Tracks array is required for sequencing.');
  }

  if (tracks.length > 500) {
    throw new ValidationError('Exceeded maximum sequencing batch size of 500 tracks.');
  }

  const validStrategies = ['keep_relative_position', 'cluster_at_start', 'cluster_at_end', 'exclude'];
  if (unverifiedStrategy && !validStrategies.includes(unverifiedStrategy)) {
    throw new ValidationError(`Invalid unverifiedStrategy "${unverifiedStrategy}". Allowed: ${validStrategies.join(', ')}`);
  }

  next();
}

/**
 * Validates save confirmation request
 */
export function validateSaveConfirmPayload(req, res, next) {
  const { manifest, isConfirmed } = req.body || {};
  if (isConfirmed !== true) {
    throw new ValidationError('Safety constraint: Save requires explicit isConfirmed: true.');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ValidationError('Missing save manifest.');
  }

  if (!Array.isArray(manifest.urisManifest) || manifest.urisManifest.length === 0) {
    throw new ValidationError('Save manifest contains zero valid Spotify track URIs.');
  }

  if (manifest.urisManifest.length > 1000) {
    throw new ValidationError(`Save manifest exceeds maximum allowed track count of 1000 (received ${manifest.urisManifest.length}).`);
  }

  const targetName = manifest.targetPlaylist?.name;
  if (targetName !== undefined && (typeof targetName !== 'string' || !targetName.trim() || targetName.length > 200)) {
    throw new ValidationError('Invalid target playlist name.');
  }

  // Verify format of Spotify URIs
  for (const uri of manifest.urisManifest) {
    if (typeof uri !== 'string' || !SPOTIFY_TRACK_URI_RE.test(uri)) {
      throw new ValidationError(`Invalid Spotify URI in manifest: ${uri}`);
    }
  }

  next();
}

export function validateOverridePayload(req, res, next) {
  const { trackId, override } = req.body || {};
  if (typeof trackId !== 'string' || !trackId.trim() || trackId.length > 128) {
    throw new ValidationError('Valid trackId string is required.');
  }
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    throw new ValidationError('Valid override object is required.');
  }
  if (override.bpm !== undefined && override.bpm !== null && String(override.bpm).trim() !== '') {
    const bpmNum = Number(override.bpm);
    if (!Number.isFinite(bpmNum) || bpmNum <= 0 || bpmNum > 400) {
      throw new ValidationError(`Invalid override BPM: ${override.bpm}`);
    }
  }
  if (override.key !== undefined && override.key !== null && (typeof override.key !== 'string' || override.key.length > 64)) {
    throw new ValidationError('Invalid override key value.');
  }
  next();
}

/**
 * Central Error Handler Middleware
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const isPublicError = err instanceof AppError || statusCode < 500;

  if (!isPublicError) {
    console.error('[API Error]', err?.message || err);
  }

  // Never expose unhandled internal error messages in 500 responses
  res.status(statusCode).json({
    success: false,
    error: isPublicError ? (err.message || 'Request failed.') : 'An unexpected error occurred.',
    code,
    details: isPublicError ? (err.details || null) : null
  });
}
