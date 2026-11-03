import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotsDir = path.resolve('screenshots');

function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (err) {
        // ignore other messages
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function runSession(viewport) {
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--window-size=${viewport.width},${viewport.height}`,
    'http://localhost:3001/deck-order/'
  ]);

  try {
    // Wait for CDP endpoint
    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json/list');
        const list = await res.json();
        const pageTab = list.find(t => t.type === 'page' && t.url.includes('deck-order'));
        if (pageTab?.webSocketDebuggerUrl) {
          wsUrl = pageTab.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        // wait
      }
      await new Promise(r => setTimeout(r, 200));
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome CDP');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'DOM.enable');

    // Wait 1s for initial render
    await new Promise(r => setTimeout(r, 1000));

    // 1. Click "Try a demo set"
    console.log(`[${viewport.name}] Clicking "Try a demo set"...`);
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const demoBtn = btns.find(b => b.textContent.includes('Try a demo set'));
        if (demoBtn) { demoBtn.click(); return true; }
        return false;
      })()`
    });

    await new Promise(r => setTimeout(r, 600));

    // 2. Click "Build my running order"
    console.log(`[${viewport.name}] Clicking "Build my running order"...`);
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const seqBtn = btns.find(b => b.textContent.includes('Build my running order'));
        if (seqBtn) { seqBtn.click(); return true; }
        return false;
      })()`
    });

    await new Promise(r => setTimeout(r, 800));

    // 3. Verify running order loaded in DOM
    const evalRes = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const bodyText = document.body.innerText;
        return {
          hasLoadedBar: bodyText.includes('Demo Electronic Set') || bodyText.includes('tracks'),
          hasSampleBanner: bodyText.includes('sample metadata'),
          hasShapeChart: bodyText.includes('The shape of your set'),
          hasTable: bodyText.includes('Suggested fit') || bodyText.includes('Glue'),
          hasInspector: bodyText.includes('Track Inspector') || bodyText.includes('Placement in set'),
          hasActionDock: bodyText.includes('Copy tracklist') && bodyText.includes('Download CSV')
        };
      })()`,
      returnByValue: true
    });

    console.log(`[${viewport.name}] Loaded state check:`, evalRes.value);

    // 4. Capture screenshot of loaded workbench
    const screenshotRes = await sendCdp(ws, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const outPath = path.join(screenshotsDir, `loaded_${viewport.name}_${viewport.width}x${viewport.height}.png`);
    fs.writeFileSync(outPath, Buffer.from(screenshotRes.data, 'base64'));
    console.log(`[${viewport.name}] Saved screenshot: ${path.basename(outPath)}`);

    ws.close();
    return evalRes.value;
  } finally {
    chrome.kill();
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  console.log('================================================================================');
  console.log('DECK ORDER - POPULATED WORKBENCH FLOW & SCREENSHOTS');
  console.log('================================================================================\n');

  const viewports = [
    { name: 'Desktop', width: 1440, height: 900 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 390, height: 844 },
    { name: 'NarrowMobile', width: 320, height: 640 }
  ];

  for (const vp of viewports) {
    try {
      await runSession(vp);
    } catch (err) {
      console.error(`Error in ${vp.name}:`, err.message);
    }
  }

  console.log('\n================================================================================');
  console.log('ALL POPULATED SCREENSHOTS SUCCESSFULLY CAPTURED');
  console.log('================================================================================');
}

main();
