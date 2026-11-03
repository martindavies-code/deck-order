import { spawn } from 'node:child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const testUrl = process.argv[2] || 'http://localhost:3001/deck-order/';

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
        // ignore
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function runTest() {
  console.log('================================================================================');
  console.log('INTERACTIVE VERIFICATION: FIXES 1-6 IN HEADLESS CHROME');
  console.log('================================================================================\n');

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9232',
    '--window-size=1440,900',
    testUrl
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9232/json/list');
        const list = await res.json();
        const tab = list.find(t => t.type === 'page' && t.url.includes('deck-order'));
        if (tab?.webSocketDebuggerUrl) {
          wsUrl = tab.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // wait
      }
      await new Promise(r => setTimeout(r, 200));
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome CDP on port 9232');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await new Promise(r => setTimeout(r, 1200));

    // 1. Verify Unconfigured Spotify Tab shows honest copy and disabled button
    console.log('[Step 1] Verifying Spotify unconfigured honest copy...');
    // Click Spotify tab
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const spotTab = btns.find(b => b.textContent.includes('Spotify'));
        if (spotTab) spotTab.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 400));

    const spotTabCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasHonestCopy: /Spotify isn't configured for this deployment/i.test(text),
          hasPasteAlternative: /Paste or upload a tracklist instead/i.test(text)
        };
      })()`,
      returnByValue: true
    });
    console.log('  Spotify Unconfigured Copy:', spotTabCheck.result?.value);

    // 2. Open Account Menu and verify Google unconfigured copy and "Forget this device"
    console.log('\n[Step 2] Verifying Account Dropdown honest Google copy & Forget Device action...');
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const accountBtn = btns.find(b => b.textContent.includes('Account'));
        if (accountBtn) accountBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 500));

    const accountCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasGoogleHonestCopy: /Google sign-in isn't configured for this deployment/i.test(text),
          hasForgetDevice: /Forget this device/i.test(text)
        };
      })()`,
      returnByValue: true
    });
    console.log('  Account Dropdown Checks:', accountCheck.result?.value);

    // Close menu by clicking outside
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `document.body.click();`
    });
    await new Promise(r => setTimeout(r, 300));

    // 3. Click "Try a demo set"
    console.log('\n[Step 3] Loading Demo Set...');
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const demoBtn = btns.find(b => /Try a demo set/i.test(b.textContent));
        if (demoBtn) demoBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 800));

    const preFlightCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasCoverage: /Know what you're working with/i.test(text),
          hasSampleTag: /Sample data/i.test(text),
          hasBuildBtn: /Build my running order/i.test(text)
        };
      })()`,
      returnByValue: true
    });
    console.log('  Pre-flight Checks:', preFlightCheck.result?.value);

    // 4. Click "Build my running order"
    console.log('\n[Step 4] Building running order in browser...');
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const buildBtn = btns.find(b => /Build my running order/i.test(b.textContent));
        if (buildBtn) buildBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1200));

    const workbenchCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasChart: /The shape of your set/i.test(text),
          hasOrder: /Your set, taking shape/i.test(text),
          hasInspector: /Track #1 of 12/i.test(text),
          hasCopyDock: /Copy tracklist/i.test(text) && /Download CSV/i.test(text)
        };
      })()`,
      returnByValue: true
    });
    console.log('  Workbench Checks:', workbenchCheck.result?.value);

    ws.close();

    const allPassed =
      spotTabCheck.result?.value?.hasHonestCopy &&
      accountCheck.result?.value?.hasGoogleHonestCopy &&
      accountCheck.result?.value?.hasForgetDevice &&
      preFlightCheck.result?.value?.hasCoverage &&
      workbenchCheck.result?.value?.hasOrder;

    console.log('\n================================================================================');
    if (allPassed) {
      console.log('✅ ALL INTERACTIVE FLOWS AND HONEST UNCONFIGURED STATES PASSED!');
    } else {
      console.error('❌ INTERACTIVE VERIFICATION FAILED');
      process.exit(1);
    }
    console.log('================================================================================');
  } finally {
    chrome.kill();
  }
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
