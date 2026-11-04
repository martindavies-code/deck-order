# Deck Order - Agent Instructions

Read HANDOVER.md in this repository root before editing anything. It records the current state: what changed recently, what is actually tested, and the unresolved problems. Update it when you finish a piece of work.

## Layout and commands

- `client/` - React + Vite + Tailwind UI (GitHub Pages)
- `server/` - Cloudflare Worker API (catalogue BPM/Camelot lookups)
- `test/` - node:test / vitest suite - run `npm test` from the repo root
- Client build: `cd client && npm run build`
- Security check: `npm run verify:security`

## Working rules

- Never commit directly to `main`. Work on a branch, keep changes small and coherent, and get review before merge or deploy.
- Sync safely: check branch, upstream and working tree (including untracked files) before starting; only fast-forward a clean, non-diverged checkout; stop and report dirty, ahead or diverged state instead of resetting, stashing or overwriting.
- Metadata matching strictness is deliberate: a title/version match is not proof of an exact recording. Records with a differing ISRC stay flagged for review. Keep unknown BPM/key values unknown; never invent or silently normalise them.
- The catalogue provider has a limited request quota. Avoid uncached probes; add retries only where idempotency or in-flight deduplication makes them quota-safe.
- Never mutate live user data while testing: no changes to real Spotify playlists, saved sets, production storage or accounts.
- For UI changes, verify actual desktop and mobile rendering, not just DOM state.
- Finish with the full test suite, client build and security check passing, and report exact commands and results, what remains untested, and any live flows not exercised.
