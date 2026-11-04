import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
});

const googleAuth = await import('../client/src/services/googleAuth.js');

const setA = () => ({
  name: 'Nu Disko',
  tracks: [
    { id: 't1', artist: 'X', title: 'One', bpm: 123, camelot: '8A', status: 'single_source' },
    { id: 't2', artist: 'Y', title: 'Two', bpm: null, camelot: null, status: 'unverified' }
  ],
  evaluation: { smoothPct: 50, totalCost: 3 }
});

test('identical repeat save is skipped (no duplicate entries)', () => {
  let h = googleAuth.saveSetToHistory(setA(), 'anonymous');
  assert.equal(h.length, 1);
  h = googleAuth.saveSetToHistory(setA(), 'anonymous');
  assert.equal(h.length, 1, 'same revision must not multiply');
});

test('genuinely different revision (enriched metadata) is kept as its own entry', () => {
  let h = googleAuth.saveSetToHistory(setA(), 'anonymous');
  const enriched = setA();
  enriched.tracks = enriched.tracks.map(t => ({ ...t, bpm: t.bpm ?? 120, camelot: t.camelot ?? '9A', status: 'single_source' }));
  h = googleAuth.saveSetToHistory(enriched, 'anonymous');
  assert.equal(h.length, 2, 'a real revision is retained, not deduped away');
});

test('different order or removal is a different revision', () => {
  let h = googleAuth.saveSetToHistory(setA(), 'anonymous');
  const reordered = setA();
  reordered.tracks = [...reordered.tracks].reverse();
  h = googleAuth.saveSetToHistory(reordered, 'anonymous');
  assert.equal(h.length, 2);
  const oneRemoved = setA();
  oneRemoved.tracks = oneRemoved.tracks.slice(1);
  h = googleAuth.saveSetToHistory(oneRemoved, 'anonymous');
  assert.equal(h.length, 3);
});

test('existing history is never destructively cleaned', () => {
  // Pre-existing duplicates stay put; only NEW identical saves are skipped.
  let h = googleAuth.saveSetToHistory(setA(), 'anonymous');
  const older = setA();
  older.tracks = [...older.tracks].reverse();
  h = googleAuth.saveSetToHistory(older, 'anonymous');
  assert.equal(h.length, 2);
  h = googleAuth.saveSetToHistory(setA(), 'anonymous'); // identical to entry 2
  assert.equal(h.length, 2, 'repeat of an older revision also skipped');
  assert.equal(h[0].tracks[0].id, 't2', 'newer distinct revision still first');
});
