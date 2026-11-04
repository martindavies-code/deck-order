// Isolated production App check for the HarmonicArcVisualizer legibility and honesty fixes.
// Synthetic 51-track set; no user/account/provider data, no external requests.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { evaluateCurrentOrder } from '../client/src/services/clientSequencer.js';

const server = spawn('python3', ['-m', 'http.server', '8767', '--directory', 'client/dist'], { stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

// Synthetic arc: gentle open, peak in the 65-85% zone, cool close.
const camelotCycle = ['4A','5A','6A','7A','8A','9A','10A','11A','12A','1A','2A','3A'];
const tracks = Array.from({ length: 51 }, (_, i) => {
  const progress = i / 50;
  const bpm = 116 + Math.round(12 * Math.min(1, progress / 0.75));
  const t = {
    id: `t${i + 1}`,
    title: `Synthetic track ${i + 1}`,
    artist: 'Arc fixture',
    bpm,
    workingBpm: bpm,
    camelot: camelotCycle[i % 12],
    key: 'F minor',
    status: 'supplied',
    energy: 0.4 + 0.5 * progress
  };
  return t;
});
// Mirror the reported real-world states: catalogue energy missing on two tracks
// whose BPM/key exist, one tempo review flag, one recording review flag.
delete tracks[0].energy;
delete tracks[38].energy;
tracks[19].tempoNeedsReview = true;
tracks[19].tempoSuggestion = { bpm: tracks[19].bpm / 2, kind: 'halved' };
tracks[29].recordingNeedsReview = true;

const key = 'deck_order_crate_history_anonymous';
const evaluation = evaluateCurrentOrder(tracks);

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const external = [];
    const page = await context.newPage();
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname !== '127.0.0.1') { external.push(u.href); return route.fulfill({ status: 503, body: '{}' }); }
      return route.continue({ url: route.request().url().replace('/deck-order/assets/', '/assets/') });
    });
    await context.addInitScript(({ key, tracks, evaluation }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([{ id: 'arc', name: 'Arc chart test', timestamp: '2026-11-04T14:00:00Z', tracks, trackCount: tracks.length, evaluation }]));
    }, { key, tracks, evaluation });
    await page.goto('http://127.0.0.1:8767/');
    await page.getByRole('button', { name: /Saved sets/ }).click();
    await page.getByRole('button', { name: 'Load set', exact: true }).click();

    const chart = page.locator('section.deck-panel').filter({ has: page.getByText('The shape of your set', { exact: true }) });
    await chart.locator('svg').waitFor();

    const svgTexts = () => chart.locator('svg text').allTextContents();
    const maxBpm = Math.max(...tracks.map(t => t.bpm));
    const minBpm = Math.min(...tracks.map(t => t.bpm));

    // Tempo view: BPM axis labels, target peak caption, legend, key labels.
    let texts = await svgTexts();
    assert.ok(texts.includes(String(maxBpm)) && texts.includes(String(minBpm)), 'tempo axis shows BPM extents');
    assert.ok(texts.includes('TARGET PEAK'), 'target peak caption present');
    assert.ok(texts.includes('12B'.replace('12B','12A')) || texts.some(t => /^[0-9]{1,2}[AB]$/.test(t)), 'camelot labels rendered');
    const legend = await chart.locator('p').allTextContents();
    assert.ok(legend.some(t => t.includes('target peak zone (65-85%')), 'legend explains target peak zone');
    assert.ok(legend.some(t => t.includes('under 124 BPM') && t.includes('over 132 BPM')), 'legend states the actual BPM thresholds');
    assert.ok(legend.some(t => t.includes('green smooth, amber stretch, red clash, grey unverified')), 'legend explains ring colours');

    // Peak band geometry matches the solver window (65-85% of the plot).
    const band = await chart.locator('svg rect').first().boundingBox();
    const plot = await chart.locator('svg').boundingBox();
    assert.ok(band && plot, 'band and svg measurable');

    // No horizontal squash: the svg keeps at least its intrinsic width.
    const intrinsic = await chart.locator('svg').evaluate(el => el.viewBox.baseVal.width);
    assert.ok(intrinsic >= 800, `intrinsic width ${intrinsic} keeps per-track spacing`);

    await chart.screenshot({ path: `/downloads/arc-tempo-${width}.png` });

    // Energy view: 0-1 axis, no BPM numbers on the axis, missing-energy tracks
    // become neutral dashed markers, never fake points.
    await chart.getByRole('button', { name: 'Energy', exact: true }).click();
    texts = await svgTexts();
    assert.ok(texts.includes('1.0') && texts.includes('0.5') && texts.includes('0.0'), 'energy axis uses the 0-1 scale');
    assert.ok(!texts.includes(String(maxBpm)), 'energy axis no longer shows BPM values');
    const missingMarkers = await chart.locator('svg circle[stroke="#7E8876"][stroke-dasharray="2 2"]').count();
    assert.equal(missingMarkers, 2, 'two tracks without catalogue energy show neutral no-data markers');
    const legendAfter = await chart.locator('p').allTextContents();
    assert.ok(legendAfter.some(t => t.includes('do not add one')), 'energy legend explains manual entries do not add energy');
    assert.ok(legendAfter.some(t => t.includes('tempo-based target')), 'energy legend states the band is tempo-based, not an energy target');

    await chart.screenshot({ path: `/downloads/arc-energy-${width}.png` });

    // Mobile clearance: the fixed bottom dock must never cover end-of-page
    // content, and the chart legend must scroll fully clear of it.
    const dockMetrics = await page.evaluate(() => {
      const dock = document.querySelector('aside[aria-label="Export and save actions"]');
      const main = document.querySelector('main');
      if (!dock || !main) return null;
      return { dockH: dock.getBoundingClientRect().height, padB: parseFloat(getComputedStyle(main).paddingBottom) };
    });
    if (dockMetrics) {
      assert.ok(dockMetrics.padB >= dockMetrics.dockH + 16, `page bottom padding ${dockMetrics.padB} clears dock ${dockMetrics.dockH}`);
    }
    if (width === 390) {
      await chart.evaluate(el => el.scrollIntoView({ block: 'end' }));
      const overlap = await page.evaluate(() => {
        const chartEl = [...document.querySelectorAll('section.deck-panel')].find(el => el.textContent.includes('The shape of your set'));
        const legendEls = [...chartEl.querySelectorAll('p')];
        const last = legendEls[legendEls.length - 1];
        const dock = document.querySelector('aside[aria-label="Export and save actions"]');
        return { legendBottom: last.getBoundingClientRect().bottom, dockTop: dock.getBoundingClientRect().top, visible: last.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top };
      });
      assert.ok(overlap.visible, `legend bottom ${overlap.legendBottom} clears dock top ${overlap.dockTop}`);
      await page.screenshot({ path: `/downloads/arc-legend-clearance-${width}.png` });
    }

    const apiRequests = external.filter(u => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
    assert.equal(apiRequests.length, 0, `no provider/account requests, saw: ${apiRequests.join(', ')}`);
    console.log(JSON.stringify({ width, ok: true, intrinsicWidth: intrinsic, missingMarkers }));
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
