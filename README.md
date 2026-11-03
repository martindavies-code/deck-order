# Deck Order 🎧
> **A Spotify playlist DJ sequencer with verified BPM, Camelot harmonic mixing, and safe writes.**

"Deck Order" connects to your Spotify account or ingests manual CSV tracklists, resolves and verifies the BPM and musical key of every track from real independent external data sources (GetSongBPM, Sonovault, Beatport/Rekordbox), works out the order an experienced DJ would play them in, and — only when you explicitly confirm — writes the result as a **new private playlist** on your Spotify account.

---

## ⚡ Quick Start

### 1. Install & Run
```bash
# Install dependencies
npm install
npm --prefix client install

# Build client production bundle
npm --prefix client run build

# Start the proxy server (serves API & UI at http://localhost:3001)
npm start
```

Open your browser to `http://localhost:3001` (or run `npm run client` for Vite hot-reload on `http://localhost:5173`).

---

## 🔒 Phase 0: Platform Constraints & Eligibility (Spotify Web API 2026)

This project strictly adheres to the current Spotify Web API policies and restrictions (verified post-February 2026):

1. **Development Mode Quotas & Eligibility**:
   - Newly registered Spotify developer apps run in **Development Mode**, restricted to the app owner and up to 5 allowlisted Spotify users.
   - The listening account must have a **Spotify Premium** subscription to use Spotify's **Mix** feature.
   - Development-mode apps share quota buckets (`429 QUOTA_EXCEEDED`). Deck Order includes an aggressive multi-tier in-memory and disk cache (`cache/provider_cache.json`) for playlist items, track metadata, and provider lookups so runs stay well under quota.
2. **Zero Forbidden Endpoints**:
   - Spotify removed `/audio-features`, `/audio-analysis`, `/recommendations`, and `/related-artists` for apps registered after Nov 2024. Deck Order makes **ZERO** calls to these forbidden endpoints (enforced by automated grep unit tests).
3. **Current Post-February 2026 Endpoint Names**:
   - Read playlist items: `GET /playlists/{id}/items` (old `/tracks` is removed; field is `items`).
   - Create playlist: `POST /me/playlists` (old `/users/{id}/playlists` is removed).
   - Add items: `POST /playlists/{playlist_id}/items` (max 100 per request, URIs in JSON body).
   - Search: `GET /search` (limit capped at 10, default 5).
4. **Secrets Protected**:
   - Provider API keys and Spotify client secret **never** ship in the client bundle. All credentials remain on your local proxy server in `.env`. Spotify authentication uses OAuth 2.0 PKCE (Proof Key for Code Exchange) in the browser.
5. **No Playback Mixing Control**:
   - The app computes the **running order**. Audio crossfades and transitions are executed natively by Spotify Mix.

---

## 📊 Phase 1: Verified BPM & Key Data Pipeline

BPM and musical key are sourced from real, citable records at the individual track-version level — never guessed or hallucinated.

### 1. Camelot Wheel Mapping Table
- **Major keys (B)**: `B=1B, F#=2B, C#=3B, Ab=4B, Eb=5B, Bb=6B, F=7B, C=8B, G=9B, D=10B, A=11B, E=12B`
- **Minor keys (A)**: `G#=1A, Eb=2A, Bb=3A, F=4A, C=5A, G=6A, D=7A, A=8A, E=9A, B=10A, F#=11A, C#=12A`
- **Enharmonics**: Normalized to identical values (`C# major = Db major = 3B`, `D# minor = Eb minor = 2A`).
- **12 <-> 1 Wrap**: 12 and 1 are adjacent (1 step apart on the circle). Adjacency logic wraps across 12 and 1.
- **Strict Mode Enforcement**: Mode (major/minor) is strictly required. A bare note name without mode (`C`, `F#`) stays `null` and is marked `unverified` for harmonic scoring.
- **Missing Energy**: Stays `null`; never backfilled from BPM or genre.

### 2. Multi-Source Verification & Dispute Resolution
- Every track is cross-checked against **two independent sources**:
  - **Agreement**: Working BPM within 2% and identical Camelot key = `✅ VERIFIED`.
  - **Version Mismatch Check**: Before flagging a dispute, ISRC, remix label (e.g. Club Mix vs Radio Edit), and duration are compared to ensure two different edits aren't mistakenly compared.
  - **Disagreement**: Flagged as `⚠️ DISPUTED`. Provenance and both source values are preserved. The UI displays a one-tap override modal; your manual decision is stored and always wins.
  - **Unverified Bucket**: Tracks missing key or tempo are isolated and clearly badged. You choose how unverified tracks are handled in the final order: keep relative positions (default), cluster at beginning/end, or exclude.

### 3. External Providers & Costs
1. **GetSongBPM API** (`https://getsongbpm.com/api`): Free tier (~3,000 req/hr) with free API key. Condition: visible backlink in app (included in UI header/footer).
2. **Sonovault** (`https://sonovault.now`): Free tier (1,000 req/month, no credit card required). Powered by Lexicon DJ's analysis engine. Paid tiers exist (~€29/mo) — Deck Order will **never** auto-sign up.
3. **SoundNet Track Analysis** (RapidAPI): Key, mode, tempo, camelot, energy. Free tier is only 5 req/day. Usable tiers start at **$9.99/month**. Requires explicit user opt-in and manual key provision.
4. **Manual CSV Import (Guaranteed Fallback)**: Always available with zero keys. Upload or paste a CSV of `artist, title, bpm, key` from Rekordbox, Tunebat, Mixed In Key, or Beatport.

---

## 🧠 Phase 2: The DJ Sequencer Algorithm

Deck Order computes an order a real DJ would defend using a **directed 2-opt local search optimizer** with multi-start greedy warmup:

1. **Directed Transition Cost Matrix**:
   - $C(A \to B) \neq C(B \to A)$: Reversing transitions in DJ sets has asymmetric costs (e.g. tempo drops are penalized more than gradual rises).
   - **Harmonic Cost**: Same key = `0`; relative major/minor = `1`; adjacent (+/-1 step) = `1`; +/-2 steps = `2` (energy lift); diagonal = `3`; jump = `5+`.
   - **Tempo Cost**: $\le 3\% = 0$; $\le 6\% = 1$; $\le 10\% = 3$; $> 10\% = 12$ (heavy penalty). Directional penalty for sudden BPM drops.
   - **Energy Cost**: Evaluated only when real energy data is present; penalizes drops $> 0.15$ unless part of an intentional chapter reset.
2. **True Delta Directed 2-Opt**:
   - When a 2-opt move reverses segment $[i \dots j]$, every internal edge $(k \to k+1)$ is reversed to $(k+1 \to k)$. The solver evaluates the true directed edge delta.
   - Deterministic PRNG seed (default: 42) ensures reruns match.
   - **Performance Benchmark**: 200 synthetic tracks (40,000 directed edge pairs) solve in **~185 ms** with only **0.8 MB** heap delta!
3. **Energy Arc**:
   - Biases set to open warm, build tempo, peak around 60–80% of the set, and flag at most one deliberate energy reset.

---

## 🌉 Phase 3: Bridge & Bonus Track Recommendations

- **Gap Detection**: Identifies transitions graded `STRETCH` (cost 3–5) or `CLASH` (cost > 5).
- **Bridge Suggestions**: Searches for verified tracks sitting between the neighbours' BPMs and Camelot keys.
- **More Huge Tunes**: Up to 5 bonus tracks matching the set's median tempo and vibe.
- **Verification Requirement**: Every suggestion must pass the Phase 1 verification pipeline with verified BPM and key. Unverified tracks are discarded; track names are never fabricated.
- **Strict User Control**: Suggestions are **OFF by default** for the saved playlist. You explicitly check which ones to include.

---

## 💾 Phase 5: Non-Destructive Safe Writes & Export

1. **Dry Run by Default**:
   - Clicking "Save" generates a dry-run preview with a unique operation ID, target playlist name (`<source> - DJ sequence`), and track manifest.
   - A real write occurs **only when you explicitly click Confirm**.
2. **Safe Write Engine**:
   - Creates a **NEW PRIVATE** playlist with `POST /me/playlists`.
   - Adds items with `POST /playlists/{id}/items` in ordered batches of 100 URIs.
   - **Never modifies, reorders, or deletes the source playlist**.
   - **Reconciliation**: On connection timeouts, fetches candidate playlist items and verifies the exact ordered prefix (counting track multiplicities) before resuming only the missing suffix.
   - **Redacted Audit Logging**: Every write request and response is logged to `logs/write_audit.log` with all tokens, auth codes, and secrets redacted.
3. **Fallback Exports**:
   - **Copy Tracklist Text**: One-click plain text `Artist - Title` format ready to paste into TuneMyMusic or Soundiiz.
   - **Download CSV**: Full CSV export with order, artist, title, version, BPM, key, Camelot, energy, source, status, and transition grades.

---

## 🎚️ The Final Step (In Spotify)

After Deck Order saves your playlist, open it in Spotify:
> *"Open your new playlist in the Spotify app. If your Premium account and app version include the Mix feature, tap Mix, then Auto to apply transitions, and tap any transition to customize them. Mix shows each track's BPM and key so you can sanity-check the order."*

---

## 🧪 Automated Tests & Phase Gates

Run the test suite and gate runners:
```bash
# Run all 32 unit & integration tests
npm test

# Run Phase 1 Gate (12-track real pipeline verification)
npm run gate1

# Run Phase 2 Gate (12-track DJ sequence + 200-track benchmark)
npm run gate2

# Verify Zero Forbidden Endpoints & Zero Secrets in Client
npm run verify:security
```
