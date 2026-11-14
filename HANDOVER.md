# Deck Order - Handover Notes

Date: 2026-11-14
Branch: `transition-quality-overhaul` (unmerged; branched from `main`)

## What changed on this branch

### 1. Un-synced renderer tempo tiers & grade thresholds (`server/core/costMatrix.js`)

Spotify Mix (Auto) applies crossfade/EQ/filter curves without beatmatching or time-stretching, so raw adjacent BPM difference dictates whether percussion flams over a 16-bar blend.
- Re-tiered tempo costs in `calculateTransitionCost`: `<= 0.8%` = `0`, `<= 1.6%` = `1`, `<= 3.0%` = `4`, `<= 5.0%` = `8`, `> 5.0%` = `16`, retaining the `+1.5` directional penalty for sudden BPM drops (`tempoDiffPct > 4.0`) and the deliberate energy-reset escape hatch in `server/core/energyArc.js`.
- Enforced grade threshold so any adjacent transition with `tempoDiffPct > 2.0` cannot grade `SMOOTH` (`SMOOTH` requires `totalCost <= 2.0` and `tempoDiffPct <= 2.0`; `STRETCH` up to `totalCost <= 5.0`; `CLASH` for `totalCost > 5.0`).

### 2. Per-transition beat-drift metric & loudness dip warning (`server/core/costMatrix.js`, `client/src/utils/trackBadges.js`, `client/src/components/SequencedTable.jsx`, `client/src/components/InspectorRail.jsx`)

- Added `blendBeats` (default `64`, i.e., 16 bars in 4/4), `driftFraction` (`|bpmB - bpmA| / bpmA`), and `driftBeats` (rounded to 0.1 beats) on each transition, plus `maxDriftBeats` and `loudnessRiskCount` in `evaluateSequence`.
- Surfaced `~X.X beats drift / 16b` in `SequencedTable` (desktop + mobile) and `InspectorRail` (Placement in set), suppressed cleanly on unconfirmed/needs-review tracks (`needsReview`).
- Added loudness delta calculation (`loudnessChange`, `loudnessDiffDb`, `loudnessRisk`, `loudnessWarning`: `'volume dip risk - trim in Mix'` for `>= 3.5 dB` difference when both tracks carry loudness values).

### 3. Energy-aware costing default ON & "+2 Energy boost" (`server/core/costMatrix.js`, `server/core/camelot.js`, `server/core/solver.js`, `server/routes/api.js`, `client/src/services/clientSequencer.js`, `client/src/components/CoverageReport.jsx`, `client/src/App.jsx`)

- Defaulted `enableEnergy` to `true` across solver, API route, client state, and evaluation (keeping explicit `false` support and adding the `#energy-aware-toggle` `"Energy-aware costing"` toggle in `CoverageReport`). Unknown energy remains `null` and never fabricates scores.
- Labelled `+2` Camelot step moves as `'two steps up (+2 energy boost)'` in `camelot.js` and rendered an `'Energy boost'` badge in the workbench table, inspector rail, and Mix recipe.

### 4. Post-save Mix recipe export (`client/src/utils/mixRecipe.js`, `client/src/components/MixInstructionsModal.jsx`, `client/src/App.jsx`)

- Added `buildMixRecipe` / `recommendMixSetting` and rendered the per-transition Mix recipe inside `MixInstructionsModal` (snapshotting `orderedTracks`, `evaluation`, and `setName` at save time).
- Presets derive from transition components: compatible key + `<= 1.6%` BPM -> `"16-bar blend, Auto preset is fine"`; `1.6%–4.0%` tempo gap -> `"short 4-8 bar fade, consider a low-pass sweep on the outgoing track"`; harmonic clash or `> 4.0%` jump -> `"2-bar cut or echo-out, do not blend"`, appending `; volume dip risk - trim in Mix` when flagged.
- Includes one-click `"Copy Mix recipe"`, phrase timing guidance (`"Start the incoming track on a phrase boundary - use Mix's waveform view to line up the 1."`), and the Spotify Connect / free-tier caveat.

### 5. SoundNet wiring in Worker & reliability/limitation notes (`server/providers/soundnet.js`, `server/core/pipeline.js`, `worker/src/index.js`, `server/providers/csvParser.js`)

- Updated `SoundNetProvider` to parse numeric or `"dB"` loudness strings (`[-60, 10]`), accept Worker KV cache adapters and custom `fetchImpl`, and fail cleanly on non-OK/429 responses without throwing or consuming FreqBlog logic.
- Passed `soundNetOptions` in `VerificationPipeline` and preserved `loudness` alongside `energy` across verified/disputed/single-source results without changing cross-provider verification or recording-review flags.
- Wired optional `env.SOUNDNET_API_KEY` + `{ cache: kvCache }` into `worker/src/index.js` (`/api/status` and `/api/pipeline/verify`).
- **SoundNet reliability caveat**: RapidAPI SoundNet free tier allows only 5 requests/day; without `SOUNDNET_API_KEY` set as a Worker secret (or when SoundNet hits 429/errors), the Worker cleanly continues returning FreqBlog BPM/key/review results (leaving energy/loudness `null` unless supplied via CSV `Energy` / `Loudness` / `LUFS` columns).
- **Accepted limitation**: Beatgrid timestamps and phrase/structure annotations are not provided by any integrated metadata API, so Deck Order cannot auto-align downbeats or phrase bars for Spotify Mix.

### 6. Audit follow-up fixes on `570f792` (`transition-quality-overhaul`)

- **Post-save Mix recipe manifest filtering & frozen snapshot (`client/src/utils/mixRecipe.js`, `client/src/App.jsx`, `client/src/components/MixInstructionsModal.jsx`)**: Added `resolveManifestTracks` and `buildSavedMixSnapshot` so the post-save Mix recipe is built strictly from the tracks in `manifest.urisManifest` (exact URI order, preserving duplicate occurrences, excluding missing-URI tracks) with transition evaluations recomputed on that filtered order. `App.jsx` freezes `savePreview = { manifest, snapshot }` at preview time and passes `saveResult` directly to `MixInstructionsModal` without reading live UI state at confirm time.
- **Branch CI workflow (`.github/workflows/ci.yml`)**: Added a read-only `CI` workflow triggered on `push` to non-`main` branches (`'**'`, `'!main'`) and all `pull_request` events running `npm test`, `npm run verify:security`, and `cd client && npm run build`. Pages deployment in `.github/workflows/deploy.yml` remains restricted to `main` and `workflow_dispatch`.
- **Disputed two-provider energy preservation (`server/core/pipeline.js`)**: Extracted `mergeOptionalMetric` and preserved sourced `energy` alongside `loudness` on disputed `evaluateTwoSources` outcomes while keeping `status: 'disputed'`, `confidence: 'disputed'`, and all review flags intact.
- **Unverified transition badge suppression (`client/src/utils/trackBadges.js`, `client/src/utils/mixRecipe.js`)**: Suppressed `tempoTone` (`'none'`), `driftBeats`/`driftLabel`, `loudnessRisk`/`loudnessWarning`/`loudnessChange`, and `isEnergyBoost`/`energyBoostLabel` on any `UNVERIFIED` transition (such as missing-key tracks with known BPM/loudness) in both `transitionDisplay` and `buildMixRecipe`.

## Tested (transition-quality-overhaul)

- Updated `test/trackBadges.test.js` (`tempoTone: 'none'` on missing-key `UNVERIFIED` transitions + assertions for suppressed drift/loudness/Energy boost) and added regression tests in `test/transitionOverhaul.test.js` covering missing-URI manifest filtering with duplicates/snapshot freezing, disputed two-provider energy preservation, and generic `UNVERIFIED` Mix recipe suppression.
- Commands run after final edits:
  - `npm test`: pass (231/231 tests across 21 suites green)
  - `npm --prefix client run build`: pass (`client/dist` production bundle built cleanly)
  - `npm run verify:security`: pass (`52` production code files, `28` client files checked)
  - Headless Chrome CDP UI verification across `1440x900` (desktop) and `390x844` (mobile) against `client/dist` (fixture saved set with a missing-URI track between valid tracks + a missing-key track with known BPM/loudness, mocked Spotify Web API save): verified unverified connector suppresses drift/loudness/Energy boost and green tempo styling, `DryRunModal` reports `3 tracks` / `1 track will be skipped`, and `MixInstructionsModal` renders only the 3 saved tracks (`2 blends`) with the recomputed `A -> C` cut + loudness warning and zero horizontal overflow.

## Not covered / live flows unexercised

- Live Cloudflare Worker deployment with a real `SOUNDNET_API_KEY` secret against live RapidAPI SoundNet (only mocked KV/fetch Worker tests were run).
- Live Spotify OAuth / real playlist write / live Spotify Premium `Mix (Auto)` audio playback (never mutate live Spotify data during automated testing).
- Requires review before merge to `main` or deploying to GitHub Pages / Cloudflare Workers.

---

Date: 2026-11-13
Release: `fix/save-dialog-suggestions` - fixes from Martin's live testing on 2026-11-13 (voice notes). Branch, full local gates (npm test 220/220, client build, verify:security), then one merge to main; verified on the live Pages app afterwards.

## What changed on this branch

### 1. Save review dialog on sets with no Spotify tracks (client/src/services/api.js, client/src/components/DryRunModal.jsx)

Martin hit "Tracks to add: 0 tracks" on the Demo Electronic Set. That count was CORRECT - demo/CSV tracks carry no `spotify:track:` URI, so nothing can be written - but the dialog said nothing and still offered "Create private playlist". The manifest now carries `skippedCount` and `isSampleData`; at 0 addable tracks the dialog explains why (demo set: sample data, not real Spotify tracks; pasted list: not Spotify-linked) and the Create button becomes a disabled "Nothing to save". Partial sets get a "N tracks will be skipped" note (e.g. tracks added from suggestions have no Spotify identity).

### 2. Dead "Create private playlist" click (client/src/App.jsx)

Root cause: toasts render at z-50, the modal backdrop at z-index 100, so every error toast fired while a modal was open (save failures, "Connect Spotify account") appeared BEHIND the dimmed backdrop - a click with no visible response. Toast z raised to z-[110]. Verified pre-fix on live with elementFromPoint: toast existed, covered by .modal-backdrop.

### 3. Suggestion insertion order (client/src/services/clientSequencer.js, client/src/App.jsx)

Applying several bridge suggestions for the SAME gap spliced them one by one at the same index, reversing their displayed order. Insertion is extracted to pure `insertSuggestionsIntoOrder` (grouped per gap, displayed order preserved, bridges after their gap track, bonus tunes at the end, input never mutated). Note: placement at the TOP of the demo set's running order was correct - its only STRETCH gap is the first transition - not a bug.

### 4. Stale suggestions after adding tracks (client/src/App.jsx, server/core/bridgeFinder.js)

Applying suggestions cleared the panel and left it to the user to re-run Find bridges. Now the orderedTracks-change effect re-runs the finder silently right after an apply (pendingSuggestionRefreshRef), so the panel always reflects the current running order. Catalogue exclusion is hardened from exact-title-only to ISRC-or-normalised-artist+title (`isTrackInSet`), so title variants of an added recording are not re-suggested, while a same-title track by a different artist is no longer wrongly excluded.

## Tested

- `npm test` (root, with client deps installed): 220/220 pass, including 12 new cases in test/liveIssues20261113.test.js (preview counts, insertion placement, exclusion).
- `cd client && npm run build`: pass. `npm run verify:security`: pass.
- Pre-fix live repro evidence: 0-tracks dialog on demo set; hidden-toast dead click (DOM: toast under backdrop); reversed insertion at #02/#03.
- Post-fix live verification steps are recorded in the PR report.

## Not covered / follow-ups

- Saving a real Spotify playlist end-to-end still needs Martin's real-playlist test (his demo-set attempt could never have written anything - that path was unreachable by design).
- Six root-level test files fail ONLY when client dependencies are not installed (`jose` import) - install both root and client deps before `npm test`, same as CI.

## Previous handover (2026-11-04)

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

## Branch: fix-manual-values (2026-11-04)

- Fixed Inspector Apply value: it used to POST an override endpoint unavailable on Pages, re-verify the old track list, leave `workingBpm`/Camelot/review flags stale, and attach a newly optimised order's evaluation to the unchanged displayed order. It now validates and applies metadata locally, updates imported/original/working state consistently, and grades each actual displayed order with `evaluateCurrentOrder`. No provider lookup or Spotify write occurs. Manual notation accepts `F-Minor` as well as `F minor`/`4A`; ambiguous bare keys and invalid tempos leave the form open with an error.
- Provider sources, evidence status, raw values and recording review remain intact. A serialisable `manualOverride` stores the exact source snapshot and fields the user chose, so Reset restores the source even after save/reload. Only explicit tempo confirmation clears tempo review. Missing values stay missing. Manual choices do not create corroboration.
- Added **Use suggested** beside a pending tempo suggestion. It confirms that tempo only; it does not confirm the key or a mismatched recording.
- Value changes create a saved-set revision without modifying the older saved entry. A failed local save leaves the value active in this session and warns that persistence failed. Saved-set load now recomputes both original and working evaluations.
- Moved the labelled **Remove track** control under each row's metadata badges, also on mobile. It uses the existing working-set remove/undo path. Enlarged up/down targets to 40x40px on desktop and 44x44px on mobile, with 20px arrows. Neither removal nor reorder touches the source Spotify playlist.
- Verified: `npm test` 169/169; `npm --prefix client run build`; `npm run verify:security`. Actual production-build App tests at 1440px and 390px load a synthetic 51-track saved set with the screenshot's Sylvester/Michael Gray track at #2 (ISRC USC4R1906927). Manual 125 / F-Minor and Use suggested both show 125 BPM / 4A, clear tempo review and grade the displayed neighboring transitions. Provider evidence/source 62.5 remains visible. Checked Reset, repeat edit, invalid-input persistence, saved revision/reload, original-view consistency, actual CSV download, storage-full warning with stored history byte-identical, unchanged IDs/order, remove/undo and up/down targets. No outbound request occurs during value application. Baseline App reproduction showed stale review state and unnecessary override/verify/sequence requests; it did not reproduce every delayed transient from the user's screenshot.
- Browser test: install Playwright separately (`npm install --no-save playwright`), build the client, then `CHROME_PATH=/path/to/chrome node scripts/verify_manual_override.mjs` (Python 3 serves the isolated build; Playwright's bundled Chromium is used if CHROME_PATH is omitted). Optional baseline: `BASELINE_DIST=/path/to/old/client/dist ... --before`. All external requests are stubbed; storage is an isolated browser context, not user data. Screenshots are written to `/downloads` for local inspection, not uploaded by this script.
- No Worker code changed and no Worker deployment is required. Live Spotify save remains untested. Existing harmonic-only grading when tempo is missing is unchanged; missing tempo is still shown as unknown with no BPM delta.

## Branch: fix-transition-colours (2026-11-04)

Martin clarified that a matching key should be green and the large BPM delta should be red, rather than colouring the key relation by the overall grade. Desktop connectors previously coloured the relation by the combined grade and left tempo neutral; mobile connectors left both neutral. Both now share the harmonic-grade colour for the key relation and the existing tempo-cost severity colour for the BPM delta. Tempo cost <=2 is green, >2 to5 amber, >5 red, using the same classification boundaries as the combined cost; the directional tempo-drop penalty is retained. No solver, cost, threshold, order, history or export semantics changed. Missing key remains neutral; missing tempo has no delta; review flags still suppress confident relation and tempo display.

Verified 170/170 tests, client production build, security check, and existing full manual-override App regression at1440/390. New scripts/verify_transition_colours.mjs loads isolated synthetic106BPM4A -> Sylvester manual125/F-Minor -> synthetic125BPM10B in the production App: key relation green, +19BPM red, combinedCLASH/tempo cost12 unchanged, IDs/order unchanged, zero override requests. Screenshots inspected at both widths. No user storage, provider, Spotify or account mutation. npm ci at repository root fails on a pre-existing package/lock mismatch; dependencies installed locally with --package-lock=false, no dependency files changed.


Latest scope also adds Redo order with an explicit confirmation (Cancel, Escape and backdrop dismiss without changes). Yes recalculates locally from surviving working tracks with current metadata, replaces only the working order, retains the original import reference, and saves through the existing history path. No provider/account request is made; stale bridge/bonus placement suggestions are cleared. Original view is read-only for drag/arrow changes. Existing two-view/history semantics remain unchanged; the superseded three-view proposal was not implemented. Placement in set now has separate Incoming/Outgoing cards with direction labels, key relation and tempo change lines, using the same colours as the row connectors. Mobile deltas do not break into a narrow vertical column.

New App regression covers confirmed redo vs cancel, removal exclusion, override preservation, original-view retention, CSV output and reloading the new saved revision at desktop/mobile. Existing full manual override regression passes at both widths. This is isolated synthetic fixture testing, not Martin's actual playlist. No Worker changes required.


Later explicit user request supersedes per-edit history revisions: the active set is one document until New set. App now uses updateActiveSet with an explicit stable identity, preserving all other entries byte-for-byte as values, never merging old duplicates or trimming old history. Import creates an identity; loading an existing entry retains it; metadata, reorder, removal/undo, redo and rename autosave into that identity. Original import order is stored alongside Current for new saves; legacy entries fall back to their saved order. Existing saveSetToHistory remains for legacy callers, but App no longer calls it. Currently editing identifies the open document; New set clears workspace only, leaving saved entries intact. Local storage failure leaves the prior bytes untouched and the edit active, shows a persistent alert, offers retry and guards New/load/browser unload. Deleting the active saved entry detaches its identity and offers Save as new set rather than silently recreating it. Saved dates use an unambiguous UK date and24-hour time. The drawer truthfully labels storage as local even if Google sign-in is present.

Final local checks:173 tests pass, client build/security pass. Updated full override App regression checks same-document saving (not a new entry), failure alert and cancelling New after save failure. New App regression checks same ID/count after redo/removal/rename, active indicator, New preserving history, reload, original reference, CSV and unchanged grades at1440/390. Dependency files and Worker source unchanged. No production account/storage/provider writes.

Failure-state refinement: the save-failure alert is sticky while working lower in the page, rather than above the fold. App regression now waits for the temporary success toast to disappear before capturing it, tests cancelled Load as well as cancelled New, verifies a still-blocked Retry changes no stored bytes, then restores the isolated storage stub and verifies successful Retry saves126BPM to the same ID/count and removes the warning. Passed1440/390.

## Branch: fix-arc-chart (2026-11-04, pending review)

User-reported legibility and honesty problems with the set-shape chart on a dense (50-51 track) set. Rework in client/src/components/HarmonicArcVisualizer.jsx:

- Crowding: the fixed 800px viewBox was stretched with preserveAspectRatio="none", squashing key labels into each other and into the TARGET PEAK caption. The chart now gives every track a fixed 18-unit slot, keeps its aspect ratio and scrolls horizontally on narrow screens. Labels sit above nodes, moving below a node only when it reaches the reserved top band, so they cannot hit the caption.
- Target peak honesty: the shaded band now matches the solver's actual arc window (65-85% of the set - calculateArcPositionPenalty in server/core/energyArc.js) instead of the old 60-80% decoration. A legend explains it in words: the sequencer nudges faster tracks toward the zone and slower tracks out of it. It is a target, not a measurement of the current set.
- Energy view honesty: the y-axis now labels the real 0-1 catalogue energy scale (it previously showed BPM numbers while plotting energy). Tracks without a catalogue energy score show a neutral dashed marker below the line instead of an unexplained red "?" - this was the reported inspector-vs-chart mismatch: BPM/key supplied by hand do not add an energy score, because energy comes from the metadata catalogue only. The legend states this. Energy values clamp to 0-1.
- Node ring colours now distinguish UNVERIFIED transitions (grey) from SMOOTH (green); the legend covers every state. The tempo-needs-review node now uses the standard label placement (its long "review" label collided with neighbours on dense sets).
- Legend wording names the solver's actual absolute BPM thresholds (under 124 BPM discouraged inside the band, over 132 BPM discouraged in the first 20%) and states in Energy view that the band is a tempo-based target, not an energy target.
- Fixed bottom dock clearance: the dock is 121px tall at 390px but main only had pb-28 (112px), and sm:p-6 silently overrode pb-28 at >=640px width, so end-of-page content could hide behind the dock. main now pads pb-36 sm:pb-36 and the chart section carries scroll-mb-40.
- scripts/verify_arc_chart.mjs: isolated production-App regression at 1440/390 - axis units per metric, band geometry, no-data marker count, legend text and thresholds, dock clearance assertions, zero external API requests, screenshot capture.

Verified: 173/173 tests, client build, security check, verify_transition_colours.mjs (released regression) unchanged pass, arc chart script passes at both widths. Synthetic data only; no user storage, account or provider calls.

Limits: horizontal scroll on narrow screens is the chosen density trade-off; live Spotify save remains untested; energy remains catalogue-only (no manual entry).

## Branch: playlists-and-desktop-scale (2026-11-13, pending review)

Fixes truncated owned Spotify playlists past the first page and scales the UI up for large desktop screens while keeping mobile (`320px`/`390px`) responsive:

- **Full owned Spotify playlist pagination & URL guardrails (`client/src/services/api.js`, `server/spotify/client.js`, `client/src/App.jsx`)**:
  - `fetchPlaylists` and `SpotifyClient.getMyPlaylists` now paginate through every `/me/playlists?limit=50` page using `data.next` (up to `MAX_PLAYLIST_PAGES = 50` with repeated-cursor loop detection), deduplicate by playlist ID across pages (`seenIds`), and filter strictly to `owner.id === myId` on each page.
  - Added `SpotifyClient.extractNextEndpoint` (origin, protocol, credentials, and base-path validation) for both `getMyPlaylists` and `getPlaylistItems`, matching `isValidSpotifyNextUrl` on the client.
  - `fetchPlaylists` classifies proxy `401`/`403`/`429` responses instead of swallowing them, increases proxy timeout to `15000ms`, accepts `{ signal, onProgress }`, and surfaces `playlistsLoading`, `playlistLoadProgress`, Refresh control, and `AbortController` cleanup in `App.jsx` (plus resetting playlist state on logout and surfacing `429` toast messages).
- **Desktop sizing & playlist picker overhaul (`client/src/App.jsx`, `client/src/components/Header.jsx`, `client/src/components/SourcePicker.jsx`, `client/src/components/SequencedTable.jsx`, `client/src/components/InspectorRail.jsx`, `client/src/components/CoverageReport.jsx`, `client/src/components/ComparisonView.jsx`, `client/src/components/HistoryDrawer.jsx`, `client/src/components/DisputeModal.jsx`, `client/src/components/DryRunModal.jsx`, `client/src/components/MixInstructionsModal.jsx`, `client/src/components/SuggestionsDrawer.jsx`, `scripts/verify_layout_cascade.js`)**:
  - Widened `<header>`, `<main>`, and bottom `<aside>` dock containers from `max-w-[1240px]` to `max-w-[1480px]` (threshold updated in `scripts/verify_layout_cascade.js`). Used `lg:pt-8` rather than `lg:py-8` on `<main>` so `pb-36 sm:pb-40` dock clearance (`160px` desktop/tablet, `144px` mobile) is not overridden at `>=1024px`.
  - Flipped `SourcePicker` desktop columns (`lg:col-span-5` editorial / `lg:col-span-7` import console), added live playlist search (`Filter playlists...` on name/description), loading status, Refresh button, 2-column desktop/tablet playlist grid (`grid-cols-1 md:grid-cols-2`, `max-h-[420px] md:max-h-[520px] lg:max-h-[580px]`), and taller CSV textarea (`min-h-[180px] sm:min-h-[240px] lg:min-h-[280px]`).
  - Scaled `sm:`/`lg:` typography across workbench tables, cards, inspector, and modals; switched `SequencedTable` desktop Track `<td>` to `w-full max-w-0` and `InspectorRail` header/version to flex `min-w-0 flex-1` truncation; adjusted mobile `<header>`, toast framing (`left-4 right-4 sm:left-auto sm:max-w-md`), and mobile card flex (`min-w-0 flex-1`) for `320px`/`390px` fit.
- **Verified**:
  - `npm test`: `180/180` pass (`18` suites, including `7` new tests in `test/spotifyPlaylistsPagination.test.js`).
  - `npm --prefix client run build`: passes cleanly.
  - `npm run verify:security`: ALL PASS (`50` files checked, `27` client files checked).
  - Headless Chrome CDP verification against `client/dist` with isolated mock API (`68` owned playlists + `51`-track workbench): `0` horizontal overflow, live search (`2 of 68 playlists`), single-row header, and bottom dock clearance passed across `1920x1080`, `1440x900`, `768x1024`, `390x844`, and `320x640`; screenshots inspected visually.
- **Limits**:
  - Live Spotify multi-page pagination (>50 real owned playlists), Refresh against live OAuth, and live Spotify playlist writes remain untested against a real Spotify account. Standalone `scripts/verify_layout_cascade.js` threshold was updated (`1240` -> `1480`) without re-running that separate Express-server script directly (viewport centering and layout bounds were verified via our isolated Chrome CDP run).

## Branch: harden-code-pass (2026-11-13, pending review)

Code hardening pass branched from `playlists-and-desktop-scale` (`940f380`), focused on Worker security/CORS/quota bounds, metadata identity matching, provider resilience, Spotify write safety, CSV export sanitization, and branch test coverage:

- **Worker CORS, auth, quota validation, and redacted errors (`worker/src/index.js`)**:
  - Replaced loose CORS origin prefix/suffix checks with an exact origin URL allowlist (`https://martindavies-code.github.io` and loopback HTTP `localhost`/`127.0.0.1` without userinfo) plus `Vary: Origin`.
  - Enforced constant-time string comparison (`timingSafeEqualStrings`) and non-empty `ADMIN_TOKEN` validation on `/api/admin/quota` and `QuotaCounter` `/set`, bounded `/reserve` batch sizes to integer `[1, 100]` with capped `ip` keys, filtered invalid non-object entries in `/api/pipeline/verify`, and redacted internal error details (`'pipeline_error'` on HTTP `502`).
- **Shared metadata identity guard, singleflight deduplication, and cache hygiene (`server/providers/matchGuard.js`, `server/providers/freqblog.js`, `server/providers/cache.js`, `server/providers/getsongbpm.js`, `server/providers/sonovault.js`, `server/providers/soundnet.js`, `server/providers/csvParser.js`, `server/core/bridgeFinder.js`)**:
  - Extracted `crossCheckTrackIdentity` (requiring token length `>= 3` for substring fallback) and `withSingleflight` into `matchGuard.js`; applied to `FreqBlogProvider`, `GetSongBPMProvider`, `SonovaultProvider`, and `SoundNetProvider`.
  - Added `25000ms` timeouts on FreqBlog fetches, stopped caching transient network/`429`/`5xx`/quota/`queued` errors (ignoring any legacy cached transient errors and bounding legitimate non-transient miss caching via `missCacheTtlSeconds = 86400`), added `ttlSeconds` expiry and `.tmp` cleanup plus `persistToDisk: false` isolation in `ProviderCache`, prevented `SonovaultProvider` from echoing query ISRCs, clamped out-of-range BPM (`<= 350`) / energy (`[0, 1]`) across providers and `csvParser.js`, handled headerless 5-column `Artist, Title, Version, BPM, Key` rows in `csvParser.js`, and fixed numeric sorting before `medianBpm` selection in `SuggestionEngine.findBonusTunes`.
- **Spotify API, Express API, CSV export, and client save/auth hardening (`server/spotify/client.js`, `server/spotify/safeWriter.js`, `server/middleware/security.js`, `server/routes/api.js`, `client/src/services/formatters.js`, `client/src/services/api.js`, `client/src/services/googleAuth.js`, `client/src/App.jsx`, `client/index.html`)**:
  - Removed `SpotifyClient.getPlaylistItems`'s cross-caller global cache leak, removed hardcoded `'Original Mix'` version fabrication (now `''`), shared `SPOTIFY_ID_RE` (`[A-Za-z0-9_-]{1,64}`) validation, bounded `getPlaylistItems` pagination (`MAX_ITEM_PAGES = 20`) with repeated-cursor detection, cloned `fetchOptions`, added request timeouts (`15000ms`/`8000ms`), and capped `429` retries (`MAX_429_RETRIES = 2`, `MAX_RETRY_AFTER_SEC = 10`, GET/HEAD only).
  - Hardened `extractBearerToken`, `validateSaveConfirmPayload`, `validateOverridePayload`, Express error redaction, CSV formula-injection escaping (`^[=+\-@\t\r]` prefixed with `'` via shared `formatters.js`), empty-URI write guards in `SafePlaylistWriter.executeSave` and `confirmSavePlaylist`, timeout/non-404 no-fallback protection, mid-batch `partialSave` reporting, unified save response shape, GIS retry recovery, `<meta name="referrer" content="no-referrer" />`, stale OAuth query cleanup, toast timer cleanup, and sequence evaluation memoization.
- **Verified (on final branch state)**:
  - `npm test`: `197/197` pass (`20` suites), including new suites [test/workerHardening.test.js](file:///C:/Users/Martin/Projects/DJ%20Assistant/test/workerHardening.test.js) and [test/securityHardeningPass.test.js](file:///C:/Users/Martin/Projects/DJ%20Assistant/test/securityHardeningPass.test.js).
  - `node --test --experimental-test-coverage test/*.test.js`: `197/197` pass; overall coverage increased from baseline (`70.09%` lines / `77.33%` branches / `69.83%` funcs across `180` tests) to `77.85%` lines / `78.87%` branches / `77.86%` funcs (notably `worker/src/index.js`: `0% -> 94.78%` lines / `79.81%` branches; `server/providers/csvParser.js`: `44.90% -> 80.39%` branches; `server/spotify/client.js`: `58.33% -> 72.53%` branches; `server/spotify/safeWriter.js`: `58.33% -> 73.08%` branches).
  - `npm run verify:security`: ALL PASS (`51` production files checked, `27` client files checked).
  - `npm --prefix client run build`: passes cleanly (`vite v6.4.5`, `dist/assets/index-Cy1m6J8I.js`).
  - `npm audit --omit=dev` (root, `client/`, and `worker/`): `0 vulnerabilities`.
- **Remaining limits / untested live flows**:
  - Live Spotify OAuth/429/write flows, live FreqBlog/GetSongBPM/Sonovault/SoundNet quota calls, and live Cloudflare Worker deployment were not executed against production accounts/services.
  - Headless browser rendering was verified on the parent commit `playlists-and-desktop-scale` (`940f380`) and not re-run on `harden-code-pass` because no CSS, markup layout, or component geometry changed (only `<meta name="referrer">` and client service/state guards).
  - Lower coverage remains on Express route glue (`server/routes/api.js` `47.62%` branches, `server/index.js` `25.00%` branches), browser-only OAuth PKCE/Google token flows (`spotifyPkce.js`, `googleAuth.js` DOM script injection), and untouched `gapDetector.js` (`9.33%` lines).

## Branch: app-improvements (2026-11-13, ready to merge)

Implements the 5 workflow and export improvements approved in the hardening/improvement plan on top of `harden-code-pass`:

- **Bridge & Bonus Suggestions UI (`client/src/components/SuggestionsDrawer.jsx`, `client/src/services/api.js`, `client/src/services/clientSequencer.js`, `server/core/bridgeFinder.js`, `client/src/App.jsx`)**:
  - Wired `"Find bridges"` workbench action via `fetchSuggestions` with offline `generateOfflineSuggestions` fallback on static GitHub Pages builds, honest `Reference catalogue` / `status: 'reference'` provenance (`confidence: 'reference_catalog'`, never claiming external Beatport/Rekordbox live fetches), dismiss control (`onClose`), unique inserted IDs, and descending `insertAfterIndex` splice order so multi-bridge insertion never shifts earlier gap indices.
- **Reversible Recording-Mismatch Confirmation (`client/src/utils/manualOverride.js`, `client/src/components/InspectorRail.jsx`, `client/src/App.jsx`)**:
  - Added `confirmRecordingMatch(track)` (`recordingNeedsReview: false`, `recordingConfirmed: true`, preserving `sourceTrack` and `recordingMismatch` for `revertManualOverride`) with `"Confirm match applies to this recording"` button inside the Inspector review alert.
- **DJ `.m3u8` Export & Saved-Set JSON Backup/Restore (`client/src/services/formatters.js`, `client/src/services/api.js`, `client/src/services/googleAuth.js`, `client/src/components/HistoryDrawer.jsx`, `client/src/App.jsx`)**:
  - Added `generateM3U8Export` / `triggerM3U8Download` (Extended `#EXTM3U` with CR/LF stripping, `#EXT-X-DECKORDER`, Spotify web URLs or sanitized `.mp3` fallback) and `"Download M3U8"` button in the bottom dock.
  - Added `buildSavedSetsBackup` and `importSavedSetsBackup` (5 MB limit, JSON validation, `__proto__`/`constructor`/`prototype` key stripping, `setSignature` deduplication, non-destructive prepend) with `"Export JSON"` / `"Import JSON"` controls in `HistoryDrawer`.
- **Sequencing Flow & Navigation Helpers (`server/core/solver.js`, `server/routes/api.js`, `client/src/utils/trackBadges.js`, `client/src/components/SequencedTable.jsx`, `client/src/components/InspectorRail.jsx`, `client/src/App.jsx`)**:
  - Added `"Next issue (N)"` stepper (`listIssueIndices`, scrolling to the visible `[data-track-row-idx]` element across desktop rows and mobile cards), `"Good follow-ups in this set"` (`findCompatibleSetTracks`), and persistent `lockedOpenerId` / `lockedCloserId` anchoring (`Pin as opener` / `Pin as closer` + `Opener`/`Closer` table pills + `DJSequencer` endpoint pinning).
- **Landing Polish (`client/src/components/SourcePicker.jsx`, `client/src/App.jsx`)**:
  - Added playlist sort toggles (`Spotify order` | `Name A-Z` | `Most tracks`) and a `"Continue a recent set"` quick-resume card listing the top 3 saved sets on the landing screen; fixed `320px` narrow-mobile header title wrapping and dock bottom clearance (`pb-48 sm:pb-40`).
- **Verified**:
  - `npm test` and `node --test --experimental-test-coverage test/*.test.js` pass (`test/appImprovements.test.js` added), `npm run verify:security` passes, `npm --prefix client run build` builds cleanly, `npm audit --omit=dev` (root, `client/`, `worker/`) reports `0` vulnerabilities, and headless Chrome CDP checks verified desktop (`1440x900`), mobile (`390x844`), and narrow mobile (`320x640`) layouts with zero console/page errors, zero external API calls, and zero horizontal overflow.
- **Remaining limits**:
  - Live Spotify OAuth PKCE, live Spotify playlist fetch/write, live Worker/FreqBlog lookups, and physical Rekordbox/Serato `.m3u8` hardware import were not exercised against live accounts.


## Independent app-improvements review (13 November 2026)

Follow-up to f68be53, scoped fixes on review-app-improvements:
- Suggestion advice is invalidated on working-order/metadata/account changes, including late async responses. This prevents inserting a bridge at an old gap after reorder/removal/override. Narrow 320px suggestions now wrap without horizontal overflow.
- JSON restore preserves nested source evidence and reset-to-source data instead of silently nulling it below depth 4. Excessive nesting and malformed metadata fail before storage changes. Backup deduplication includes endpoint locks, original order and manual choices. Restore supports 51+ document-style saved sets (bounded at 1000 sets and 5 MB).
- Exclude-unverified applies consistently when zero or one tracks can be sequenced, not only for larger sets.
- Root package-lock.json matches package.json again, so clean npm ci works. No dependency major upgrades.
- Added five unit regressions and scripts/verify_review.mjs for isolated synthetic desktop/mobile/narrow UI and stale-advice regression. Playwright is optional verification tooling, not a production dependency.

Verified locally: 209 unit tests, security check, client production build, clean root/client npm ci; arc-chart regression at 1440/390; new suggestion/edit regression at 1440/390/320 with no page errors or horizontal overflow. Screenshots inspected. Synthetic fixtures only, no live account, Spotify writes or catalogue quota used. Live Spotify save remains unverified, and M3U8 export contains Spotify web references or filename hints, not audio files or proof of DJ-software compatibility. Worker hardening from fd92953 still needs a separate Cloudflare deployment; Pages deployment does not publish the Worker.
