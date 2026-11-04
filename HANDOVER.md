# Deck Order - Handover Notes

Date: 2026-11-04
Branch: `harden-code-resilience` (created from updated `main` at `8f1e0cb`)

## App layout

- `client/` - React + Vite + Tailwind UI, deployed to GitHub Pages: https://martindavies-code.github.io/deck-order/
- `server/` - Cloudflare Worker API: https://deck-order-api.martin-davies.workers.dev (BPM/Camelot lookups against the FreqBlog catalogue)
- `test/` - Node test suite covering server provider/pipeline logic, security middleware, and client utilities

## What changed on this branch

### 1. In-flight Request Deduplication (Singleflight) & Stopword Matching
- **`server/providers/freqblog.js`**: Added in-flight request coalescing (`_inFlight` Map) to deduplicate concurrent requests for the same track query, preventing redundant network roundtrips and preserving provider quota.
- Fixed an artist cross-check bug in `_crossCheck` where leading stopwords ("the", "a", "of") produced false-positive matches (e.g. "The Prodigy" matching "The Who").
- **`worker/src/index.js`**: Added isolate-level `inFlightBatches` singleflight map to coalesce identical concurrent batch requests and prevent concurrent cache misses from racing.
- **`test/freqblogProvider.test.js`**: Added unit tests verifying stopword false-positives are rejected and singleflight deduplication coalesces 5 concurrent requests into 1 fetch and 1 quota reservation.

### 2. Client Cancellation & Truthful Report Propagation
- **`client/src/services/api.js`**:
  - Added `signal` (`AbortSignal`) support to `verifyTracklist` with `AbortSignal.any` timeout/caller composition. When aborted, `verifyTracklist` immediately throws `AbortError` without silently swallowing cancellation or misreporting it as provider unavailability.
  - Corrected `verifyTracklist` report objects across provider, sample data, and offline fallback paths to include `recordingReviewTracks` and `tempoReviewTracks`.

### 3. Progressive Quota Eviction & Flexible Track Signatures
- **`client/src/services/googleAuth.js`**:
  - Updated `trackSignatureIdentity` to support `t.title || t.name`, ensuring tracks formatted with `name` (e.g. Spotify items or certain CSV formats) maintain distinct identity without losing title context.
  - Hardened `saveSetToHistory` against browser `QuotaExceededError`: if `localStorage` is full, it progressively evicts the oldest historical sets (pruning in batches of 5 down to minimum 5) before failing, ensuring active set persistence succeeds.

### 4. Defensive Component & Utility Guards
- **`client/src/utils/trackBadges.js`**: Defensively guarded `removeTrackAt` and `restoreTrackAt` against non-array and null inputs.
- **`client/src/App.jsx`**: Updated removal toast, undo toast, and undo status banner to fall back cleanly to `removed.title || removed.name || 'track'`.
- **`server/spotify/auditLogger.js`**: Fixed payload spreading bug in `AuditLogger.log` so primitive strings and non-object payloads are wrapped in `{ payload: cleanPayload }` rather than being expanded into character index properties (`{"0":"s",...}`).
- **`server/providers/cache.js`**: Hardened `ProviderCache.buildKey` against null/undefined query objects and whitespace-only ISRCs, with fallback to `query.title || query.name`.

### 5. Regression Test Suite
- **`test/resilienceOverrides.test.js`**: Created 7 unit tests covering:
  - Primitive payload handling in audit logging.
  - Safe cache key generation for null queries and whitespace ISRCs.
  - Defensive array safety in track removal/restoration.
  - `t.name` fallback in track signatures.
  - Progressive storage quota eviction in saved-set history.
  - Exposure of `recordingReviewTracks` and `tempoReviewTracks` in `verifyTracklist` reports.
  - Truthful cancellation with `AbortError` propagation.

## Verification & Metrics

- **Tests**: 163/163 tests pass across 18 test suites (`npm test`):
  - 17 existing suites (156 tests) + 1 new resilience suite (7 tests).
  - 0 failed, 0 skipped, 0 cancelled.
- **Code Coverage** (`node --experimental-test-coverage --test test/*.test.js`):
  - Lines: 67.68% (baseline: 67.36%)
  - Branches: 77.17% (baseline: 76.76%)
  - Functions: 67.70% (baseline: 67.41%)
  - Key hardened modules: `trackBadges.js` (100% line, 95.24% branch), `freqblog.js` (97.03% line, 77.23% branch), `auditLogger.js` (89.77% line, 69.57% branch), `cache.js` (86.21% line, 74.29% branch).
- **Client Production Build**: `cd client && npm run build` succeeded cleanly in 2.88s (385.34 kB bundle, 114.84 kB gzip).
- **Security Audit**: `npm run verify:security` passed with 0 forbidden Spotify endpoints across 49 files and 0 secret leaks in client bundle across 26 files.
- **Dependency Audit**: `npm audit` returned 0 vulnerabilities in root, `client/`, and `worker/`.

## Unresolved / Known Limits

- **Worker In-Memory Singleflight Scope**: The worker's `inFlightBatches` singleflight map is in-memory per isolate. In multi-region deployments with multiple Cloudflare Worker isolates, deduplication operates within each isolate; cross-isolate caching relies on the KV cache.
- **Spotify End-to-End Live Writes**: End-to-end playlist creation has been verified through unit tests, dry-run previews, and mock schemas; live write flows against production Spotify user accounts require interactive OAuth consent and remain unexercised in automated CI.
- **Google Identity Services Origin Configuration**: GIS token client requires `https://martindavies-code.github.io` and local dev URLs under **Authorised JavaScript origins** in Google Cloud Console. If configured solely under **Authorised redirect URIs**, browser GIS popups will reject the origin header.
- **Provider Quota**: Live FreqBlog lookups use paid provider quotas; unit tests strictly use stubs and mock implementations to avoid spending quota.

## Commands

- `npm test` - Run full test suite
- `node --experimental-test-coverage --test test/*.test.js` - Run test suite with coverage
- `cd client && npm run build` - Client production build
- `npm run verify:security` - Run static security and secret leak audit
