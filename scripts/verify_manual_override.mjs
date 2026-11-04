// Isolated App regression. No real accounts, provider traffic or user storage.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { evaluateCurrentOrder } from '../client/src/services/clientSequencer.js';
const before = process.argv.includes('--before');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = before ? process.env.BASELINE_DIST : resolve(root, 'client/dist');
if (!directory) throw new Error('--before requires BASELINE_DIST pointing at the baseline client build.');
const server = spawn('python3', ['-m', 'http.server', '8765', '--directory', directory], { stdio: 'ignore' });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-sandbox'] });
const source = { id: 'fixture-sylvester', title: 'You Make Me Feel (Mighty Real)', artist: 'Sylvester, Michael Gray', version: 'Michael Gray Remix', isrc: 'USC4R1906927', bpm: 62.5, rawBpm: 62.5, workingBpm: 62.5, key: 'F minor', camelot: '4A', tempoNeedsReview: true, tempoSuggestion: { bpm: 125, kind: 'doubled' }, confidence: 'single_source', status: 'single_source', sources: [{ name: 'fixture-provider', bpm: 62.5 }] };
// Only the screenshot track is real; neighbors are explicit synthetic fixtures.
const tracks = Array.from({ length: 51 }, (_, i) => i === 1 ? source : ({ id: `fixture-${i}`, title: `Synthetic neighbor ${i}`, artist: 'Test fixture', bpm: 125, workingBpm: 125, key: 'F minor', camelot: '4A', status: 'supplied' }));
const original = { id: 'fixture-set', name: 'Isolated override test', timestamp: '2026-11-04T13:00:00Z', tracks, trackCount: 51, evaluation: evaluateCurrentOrder(tracks) };
const key = 'deck_order_crate_history_anonymous';
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const requests = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
        requests.push(url.pathname);
        return route.fulfill({ status: 503, body: '{}' });
      }
      return route.continue();
    });
    await context.addInitScript(({ key, original }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([original])); }, { key, original });
    // Python serves the dist at root; Vite base assets are routed to the same dist.
    await page.route('**/deck-order/assets/**', route => route.continue({ url: route.request().url().replace('/deck-order/assets/', '/assets/') }));
    await page.goto('http://127.0.0.1:8765/');
    await page.getByRole('button', { name: /Saved sets/ }).click();
    await page.getByRole('button', { name: 'Load set', exact: true }).click();
    await page.locator(':is(p,h4):visible').filter({ hasText: source.title }).first().click();
    const inspector = page.locator('.deck-panel').filter({ hasText: 'TRACK #2 OF 51' });
    // Case-insensitive rendered text matching is separate from CSS text content.
    const rail = page.locator('.deck-panel').filter({ has: page.getByText('Track #2 of 51', { exact: true }) });
    await rail.getByRole('button', { name: 'Use my value', exact: true }).click();
    await rail.locator('input[type=number]').fill('125');
    await rail.locator('input[type=text]').fill('F-Minor');
    const startRequests = requests.length;
    await rail.getByRole('button', { name: 'Apply value', exact: true }).click();
    await page.getByText('Custom value applied.', { exact: true }).waitFor();
    await rail.scrollIntoViewIfNeeded();
    await rail.screenshot({ path: `/downloads/override-${before ? 'before' : 'after'}-${width}.png` });
    console.log(JSON.stringify({ before, width, text: await rail.innerText(), newRequests: requests.slice(startRequests) }));
    if (before) { await context.close(); continue; }
    assert.match(await rail.innerText(), /125 BPM/);
    assert.match(await rail.innerText(), /Manual override active/);
    assert.doesNotMatch(await rail.innerText(), /needs review/);
    assert.deepEqual(requests.slice(startRequests), []);
    let history = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(history[0].tracks[1].bpm, 125);
    assert.equal(history[0].tracks[1].workingBpm, 125);
    assert.equal(history[0].tracks[1].camelot, '4A');
    assert.deepEqual(history[0].tracks.map(t => t.id), tracks.map(t => t.id));
    assert.deepEqual(history[1], original);
    assert.equal(history[0].evaluation.gradedCount, 50);
    await rail.getByRole('button', { name: 'Reset', exact: true }).click();
    await rail.getByRole('button', { name: 'Use suggested', exact: true }).waitFor();
    await rail.screenshot({ path: `/downloads/use-suggested-${width}.png` });
    await rail.getByRole('button', { name: 'Use suggested', exact: true }).click();
    await page.getByText('Custom value applied.', { exact: true }).waitFor();
    await rail.screenshot({ path: `/downloads/suggested-applied-${width}.png` });
    history = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(history[0].tracks[1].bpm, 125);
    assert.equal(history[0].tracks[1].key, 'F minor');
    // Reload and use the persisted revised set through the real history UI.
    await page.reload();
    await page.getByRole('button', { name: /Saved sets/ }).click();
    await page.getByRole('button', { name: 'Load set', exact: true }).first().click();
    await page.locator(':is(p,h4):visible').filter({ hasText: source.title }).first().click();
    assert.match(await rail.innerText(), /125 BPM/);
    // Invalid key remains editable and does not mutate history.
    await rail.getByRole('button', { name: 'Use my value', exact: true }).click();
    await rail.locator('input[type=text]').fill('F');
    const snapshot = await page.evaluate(key => localStorage.getItem(key), key);
    await rail.getByRole('button', { name: 'Apply value', exact: true }).click();
    await page.getByText(/Could not apply value: Enter a Camelot/).waitFor();
    assert.equal(await rail.locator('input[type=text]').inputValue(), 'F');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), snapshot);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Real row controls: larger targets, remove in place, one-step undo.
    const remove = page.getByRole('button', { name: `Remove ${source.title} from this set`, exact: true }).filter({ visible: true });
    const up = page.getByRole('button', { name: 'Move track 2 up', exact: true }).filter({ visible: true });
    const down = page.getByRole('button', { name: 'Move track 2 down', exact: true }).filter({ visible: true });
    for (const control of [up, down]) {
      const box = await control.boundingBox();
      assert.ok(box.width >= 40 && box.height >= 40);
    }
    const row = width >= 640 ? remove.locator('xpath=ancestor::tr') : remove.locator('xpath=ancestor::div[contains(@class,"deck-panel")][1]');
    await row.screenshot({ path: `/downloads/row-controls-${width}.png` });
    await remove.click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Move track 2 up', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Move track 1 down', exact: true }).filter({ visible: true }).click();
    // Order is back to the same sequence; selected track still uses saved override.
    await page.locator(':is(p,h4):visible').filter({ hasText: source.title }).first().click();
    assert.match(await rail.innerText(), /TRACK #2 OF 51/);
    assert.match(await rail.innerText(), /125 BPM/);
    console.log(`PASS width=${width}: manual, suggested, reset, history reload, invalid input, remove/undo, reorder targets`);
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
  await new Promise(resolve => server.once('exit', resolve));
}
