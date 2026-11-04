# Deck Order - Handover Notes

Date: 2026-11-04
Release: `freqblog-version-search-fix` reviewed and squash-merged to `main` on 2026-11-04; client published via the GitHub Pages Actions workflow, worker deployed to Cloudflare from released `main`.

## App layout

- `client/` - React + Vite + Tailwind UI, deployed to GitHub Pages: https://martindavies-code.github.io/deck-order/
- `server/` - Cloudflare Worker API: https://deck-order-api.martin-davies.workers.dev (BPM/Camelot lookups against the FreqBlog catalogue)
- `test/` - vitest suite covering server provider/pipeline logic and client utilities

## What changed on this branch

### 1. Catalogue matching fix for separate version tags (server/providers/freqblog.js, server/core/pipeline.js, client/src/services/api.js)

Tracks imported with the mix/version name in a separate field (the CSV import shape) previously searched the catalogue by bare title only. The catalogue then returned the original-mix record, which failed the version cross-check, leaving the track unverified.

The search term is now decorated with the version text when it is not already present in the title. Decoration is skipped when the title already carries the version tokens (the Spotify import shape), so that path is unchanged.

Cache semantics: lookup cache keys move to v3 only for version-decorated queries. Undecorated queries keep their v2 keys, so previously cached Spotify-shape results are not invalidated. v2 entries for decorated queries are simply never read again and expire naturally.

Recording-mismatch surfacing: the catalogue matches by name/version content, not strictly by ISRC, so a matched record can carry a different ISRC than the query. These matches are now flagged (`recordingNeedsReview`), surfaced in the Inspector panel review flow, and excluded from confident sequencing until confirmed. Records with a different ISRC are never silently treated as the same recording.

### 2. Remove track from working set, with undo (client/src/App.jsx, client/src/components/SequencedTable.jsx)

Per-row remove control on the sequenced working set only. Removal, undo and manual reorder never re-optimise the order: they keep the user's current surviving order exactly and recompute the evaluation for the DISPLAYED order via `evaluateCurrentOrder` (client/src/services/clientSequencer.js). Note: DJSequencer.solve() evaluates its own re-optimised order, so its result.evaluation must only be paired with result.orderedTracks - never applied to a user-kept order. Removal lives in the ordered working set, so reorder, CSV export and the Spotify save preview all inherit the exclusion (same state object). The original Spotify playlist is never touched. An undo banner restores the track at its original position; wholesale loads (new import, saved-set load) clear the pending undo.

### 3. Colour-coded BPM / Camelot badges (client/src/utils/trackBadges.js, client/src/components/SequencedTable.jsx)

Each track shows BPM and Camelot key pills, with the key pill colour derived consistently from the Camelot value. Amber pills mark values that need review; dashed grey pills mark missing or unverified data. Badges render inline in the desktop table and in the mobile card data strip. The evidence-status label (Corroborated / Single source / Missing / ...) comes from one shared selector used by both the desktop table and the mobile strip. A transition whose either side is flagged for review no longer shows a confident relation or BPM delta - it renders "Needs review - unconfirmed tempo/key" until confirmed.

### 4. Saved-set duplication prevention (client/src/services/googleAuth.js)

Root cause of duplicate Saved-set entries: the sequencer autosaved a new history entry with a fresh id on every run, even when nothing changed. `saveSetToHistory` now computes a signature over the set name plus, per track in order: id (or artist-title), version, ISRC, bpm, key, camelot, status, confidence (including user overrides) and review flags. A save whose signature matches an existing entry is skipped; reorders, enrichment, overrides and review-flag changes are genuine revisions and kept as separate entries. No existing saved entries are merged or deleted.

## What is verified

- 146/146 vitest tests pass, including new regression tests for version decoration, recording-mismatch flagging, remove/undo, badge states, and saved-set dedup.
- Client production build passes; security audit script passes.
- Live worker probes (2026-11-04): the Spotify-shape lookup for "Drop The Pressure - Purple Disco Machine Remix Edit" returns 123.1 BPM / 9A; the CSV shape with a separate version field resolves the same remix record.
- Desktop (1280px) and mobile (390px) renders of the new UI states were visually checked.

## Unresolved / known limits

- Cold catalogue processing can exceed 120s; the worker has no singleflight, so concurrent cold jobs can duplicate work. There is no guaranteed completion within a single client attempt - the client batches 10 tracks per attempt and reports honest partial state.
- The end-to-end Spotify playlist save route has not been tested against a live Spotify account; the pending save flow is unverified.
- Single-provider matches carry single_source confidence by design; corroboration needs a second provider.
- Recording-mismatch flags are surfaced, not auto-resolved; the user confirms them in the review flow.
- Duplicate saved sets created before the dedup fix are preserved untouched; no cleanup has been performed. The released dedup keyed its signature on per-import track ids, so identical saves across separate imports still duplicated (found in live post-release verification). Fixed in PR #7 (squash-merged to main after gate review): the signature now uses stable recording identity (artist/title + version/ISRC/Spotify id as available), keeping distinct mixes distinct.
- recordingNeedsReview previously changed only the table UI text; costMatrix/evaluateSequence still graded those transitions numerically, so the CSV export, summary metrics and the "Running order ready." dock overstated confidence (found in live post-release verification). Fixed in PR #7 (squash-merged to main after gate review): review-adjacent transitions are UNVERIFIED end to end - excluded from graded metrics, shown as Ungraded in the summary, marked in the export, and the readiness dock reports them as needing review.
- The FreqBlog catalogue has a limited request quota; avoid unnecessary uncached probes.

## Branch: harden-code-resilience (2026-11-04, reviewed with corrections)

Resilience hardening on top of the PR #7 release, authored by Antigravity, reviewed and corrected before release:

- In-flight singleflight dedup of identical concurrent catalogue lookups (`server/providers/freqblog.js` `_inFlight`, per provider instance) and of identical concurrent verification batches (`worker/src/index.js` `inFlightBatches`, per Worker isolate only - cross-isolate dedup still relies on the KV cache). One fetch and one quota unit per unique in-flight query.
- `_crossCheck` artist match no longer keys on a leading stopword ("The Prodigy" vs "The Who" false positive fixed); primary artist token is now stopword-free and matched token-wise.
- `verifyTracklist` accepts a caller `AbortSignal` (AbortSignal.any composed with the per-batch timeout, with fallback). Only a caller-initiated abort (`signal.aborted`) is rethrown as AbortError; a batch timeout keeps the honest partial-failure path even on engines that name timeouts "AbortError". Note: no UI passes a signal yet - this is a dormant capability.
- `verifyTracklist` report objects now expose `recordingReviewTracks` and `tempoReviewTracks` on the success, sample-data and offline-fallback paths.
- `trackSignatureIdentity` falls back to `t.title || t.name`. This also fixes a latent false-duplicate: name-only tracks previously collapsed to an artist-only identity, so different songs by one artist could dedupe as repeats. Title-based signatures are unchanged, so PR #7 dedup semantics and existing saved sets are unaffected.
- Storage-full save handling, CORRECTED IN REVIEW: the branch originally evicted the user's oldest saved sets silently on QuotaExceededError. That was rejected. On a failed save, existing sets are left untouched, the caller is notified via an `onError` callback, and the app shows a persistent warning toast: "Running order built, but could not save this set - browser storage is full. Your saved sets are untouched; delete older saved sets to free space." The failure toast must be the LAST toast shown in the run handler - a plain success toast after it overwrites it within milliseconds (caught in review with headless-Chrome screenshots). A failed save returns the unchanged history. Verified visually (desktop 1440px + mobile 390px) with a stubbed QuotaExceededError: toast readable and unclipped, seeded history byte-identical before/after.
- Defensive guards: `removeTrackAt`/`restoreTrackAt` tolerate non-array/null inputs; audit logger wraps primitive payloads instead of character-spreading them; provider cache `buildKey` tolerates null queries and whitespace-only ISRCs.
- Removal/undo toasts fall back to `track.title || track.name || 'track'`.

Verified on this branch (independent re-run, node v22): `npm test` 164/164 pass (154 from released main + 2 freqblog singleflight/stopword tests + 8 resilience tests - one rewritten in review to pin no-eviction, one added to pin that an AbortError-named batch failure is NOT treated as caller abort); client production build clean; `npm run verify:security` ALL PASS. Coverage percentages vary by invocation; treat exact figures as indicative only.

Known limits added by this branch: worker singleflight is per-isolate memory; live Spotify playlist writes remain untested against a real account; provider quota is preserved by tests using stubs only; a storage-full save requires the user to free space (no automatic cleanup by design).

## Commands

- `npm test` (repo root) - Node test-runner suite (`node --test test/*.test.js`); needs root AND client dependencies installed (`jose` comes from client/)
- `cd client && npm run build` - client production build
- `npm run verify:security` - static security and secret-leak audit
- Worker deploy to Cloudflare is gated on review of this branch.
