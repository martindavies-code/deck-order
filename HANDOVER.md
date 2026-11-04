# Deck Order - Handover Notes

Date: 2026-11-04
Branch: `freqblog-version-search-fix` (pending review before merge to `main`)

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

Per-row remove control on the sequenced working set only. Removal lives in the ordered working set, so reorder and export inherit the exclusion. The original Spotify playlist is never touched. An undo banner restores the track at its original position; wholesale loads (new import, saved-set load) clear the pending undo.

### 3. Colour-coded BPM / Camelot badges (client/src/utils/trackBadges.js, client/src/components/SequencedTable.jsx)

Each track shows BPM and Camelot key pills, with the key pill colour derived consistently from the Camelot value. Amber pills mark values that need review; dashed grey pills mark missing or unverified data. Badges render inline in the desktop table and in the mobile card data strip. The evidence-status label (Corroborated / Single source / Missing / ...) comes from one shared selector used by both the desktop table and the mobile strip. A transition whose either side is flagged for review no longer shows a confident relation or BPM delta - it renders "Needs review - unconfirmed tempo/key" until confirmed.

### 4. Saved-set duplication prevention (client/src/services/googleAuth.js)

Root cause of duplicate Saved-set entries: the sequencer autosaved a new history entry with a fresh id on every run, even when nothing changed. `saveSetToHistory` now computes a signature over the set name plus, per track in order: id (or artist-title), version, ISRC, bpm, key, camelot, status, confidence (including user overrides) and review flags. A save whose signature matches an existing entry is skipped; reorders, enrichment, overrides and review-flag changes are genuine revisions and kept as separate entries. No existing saved entries are merged or deleted.

## What is verified

- 141/141 vitest tests pass, including new regression tests for version decoration, recording-mismatch flagging, remove/undo, badge states, and saved-set dedup.
- Client production build passes; security audit script passes.
- Live worker probes (2026-11-04): the Spotify-shape lookup for "Drop The Pressure - Purple Disco Machine Remix Edit" returns 123.1 BPM / 9A; the CSV shape with a separate version field resolves the same remix record.
- Desktop (1280px) and mobile (390px) renders of the new UI states were visually checked.

## Unresolved / known limits

- Cold catalogue processing can exceed 120s; the worker has no singleflight, so concurrent cold jobs can duplicate work. There is no guaranteed completion within a single client attempt - the client batches 10 tracks per attempt and reports honest partial state.
- The end-to-end Spotify playlist save route has not been tested against a live Spotify account; the pending save flow is unverified.
- Single-provider matches carry single_source confidence by design; corroboration needs a second provider.
- Recording-mismatch flags are surfaced, not auto-resolved; the user confirms them in the review flow.
- Duplicate saved sets created before the dedup fix are preserved untouched; no cleanup has been performed.
- The FreqBlog catalogue has a limited request quota; avoid unnecessary uncached probes.

## Commands

- `npm test` (repo root) - vitest suite
- `cd client && npm run build` - client production build
- Worker deploy to Cloudflare is gated on review of this branch.
