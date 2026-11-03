import { ValidationError, AppError } from '../core/errors.js';

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
  const { manifest, isConfirmed } = req.body;
  if (!isConfirmed) {
    throw new ValidationError('Safety constraint: Save requires explicit isConfirmed: true.');
  }

  if (!manifest || typeof manifest !== 'object') {
    throw new ValidationError('Missing save manifest.');
  }

  if (!Array.isArray(manifest.urisManifest) || manifest.urisManifest.length === 0) {
    throw new ValidationError('Save manifest contains zero valid Spotify track URIs.');
  }

  // Verify format of Spotify URIs
  for (const uri of manifest.urisManifest) {
    if (typeof uri !== 'string' || !uri.startsWith('spotify:track:')) {
      throw new ValidationError(`Invalid Spotify URI in manifest: ${uri}`);
    }
  }

  next();
}

/**
 * Central Error Handler Middleware
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';

  // Do not expose stack traces or raw errors in production
  res.status(statusCode).json({
    success: false,
    error: err.message || 'An unexpected error occurred.',
    code,
    details: err.details || null
  });
}
