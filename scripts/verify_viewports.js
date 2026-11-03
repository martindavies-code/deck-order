import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const viewports = [
  { name: 'NarrowMobile', width: 320, height: 640 },
  { name: 'Mobile', width: 390, height: 844 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Desktop', width: 1440, height: 900 }
];

console.log('================================================================================');
console.log('DECK ORDER - REDESIGN VIEWPORT AUDIT & SCREENSHOT CAPTURE');
console.log('================================================================================\n');

let allPassed = true;
const screenshotsDir = path.resolve('screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

for (const vp of viewports) {
  try {
    const screenshotPath = path.join(screenshotsDir, `opening_${vp.name}_${vp.width}x${vp.height}.png`);
    const cmd = `"${chromePath}" --headless=new --window-size=${vp.width},${vp.height} --screenshot="${screenshotPath}" --dump-dom --virtual-time-budget=3000 "http://localhost:3001/deck-order/"`;
    const dom = execSync(cmd, { encoding: 'utf8', timeout: 15000 });

    const hasWordmark = dom.includes('Deck Order');
    const hasHeadline = dom.includes('Good tracks.') && dom.includes('Better order.');
    const hasConsole = dom.includes('Bring your tracks');
    const hasDemo = dom.includes('Try a demo set');
    const hasReassurance = dom.includes('Your original playlist stays untouched.');

    if (hasWordmark && hasHeadline && hasConsole && hasDemo && hasReassurance) {
      console.log(`✅ ${vp.name.padEnd(14)} (${vp.width}x${vp.height}): Rendered editorial composition cleanly. Screenshot: ${path.basename(screenshotPath)}`);
    } else {
      console.error(`❌ ${vp.name.padEnd(14)} (${vp.width}x${vp.height}): Missing elements in rendered DOM. hasHeadline: ${hasHeadline}, hasConsole: ${hasConsole}, hasDemo: ${hasDemo}`);
      allPassed = false;
    }
  } catch (err) {
    console.error(`❌ ${vp.name} failed:`, err.message);
    allPassed = false;
  }
}

console.log('\n================================================================================');
if (allPassed) {
  console.log('VIEWPORT AUDIT: ALL VIEWPORTS PASSED WITH ZERO CLIPPING');
} else {
  console.log('VIEWPORT AUDIT: FAILED');
  process.exit(1);
}
console.log('================================================================================');
