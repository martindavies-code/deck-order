import { spawn } from 'node:child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const liveUrl = 'https://martindavies-code.github.io/deck-order/';

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

async function testLiveWeb() {
  console.log('================================================================================');
  console.log('TESTING LIVE GITHUB PAGES DEPLOYMENT: ' + liveUrl);
  console.log('================================================================================\n');

  // 1. HTTP fetch check
  const httpRes = await fetch(liveUrl);
  console.log(`[HTTP Status] ${httpRes.status} ${httpRes.statusText}`);
  const html = await httpRes.text();
  console.log(`[HTML Bundle check] Length: ${html.length} bytes`);

  const cssMatch = html.match(/href="([^"]+\.css)"/);
  if (cssMatch) {
    const cssUrl = new URL(cssMatch[1], liveUrl).href;
    const cssRes = await fetch(cssUrl);
    console.log(`[CSS Status] ${cssRes.status} (${cssUrl})`);
    const cssText = await cssRes.text();
    console.log(`[CSS Size] ${cssText.length} bytes - contains tailwind utilities: ${cssText.includes('--border-subtle') || cssText.includes('flex')}`);
  }

  // 2. Terminal Headless Chrome Interactive Verification
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--window-size=1440,900',
    liveUrl
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9223/json/list');
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

    if (!wsUrl) throw new Error('Could not connect to Chrome CDP on port 9223');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');

    // Wait for initial render
    await new Promise(r => setTimeout(r, 1500));

    // Check opening screen elements
    const openingCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasWordmark: /deck order/i.test(text),
          hasHeadline: /good tracks/i.test(text) && /better order/i.test(text),
          hasConsole: /bring your tracks/i.test(text),
          hasDemoBtn: /try a demo set/i.test(text),
          hasUntouched: /your original playlist stays untouched/i.test(text)
        };
      })()`,
      returnByValue: true
    });

    console.log('\n[Opening Screen Render Check]');
    console.log(openingCheck.result?.value);

    // Click "Try a demo set"
    console.log('\n[User Action] Clicking "Try a demo set"...');
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => /try a demo set/i.test(b.textContent));
        if (btn) { btn.click(); return true; }
        return false;
      })()`
    });

    await new Promise(r => setTimeout(r, 1000));

    // Check pre-flight inspection
    const preFlightCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasCoverage: /know what you're working with/i.test(text),
          hasSampleTag: /sample data/i.test(text),
          hasSequenceBtn: /build my running order/i.test(text)
        };
      })()`,
      returnByValue: true
    });

    console.log('[Pre-Flight Verification State]');
    console.log(preFlightCheck.result?.value);

    // Click "Build my running order" (executes client-side 2-opt solver in browser!)
    console.log('\n[User Action] Clicking "Build my running order"...');
    await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => /build my running order/i.test(b.textContent));
        if (btn) { btn.click(); return true; }
        return false;
      })()`
    });

    await new Promise(r => setTimeout(r, 1200));

    // Check workbench state
    const workbenchCheck = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        return {
          hasChart: /the shape of your set/i.test(text),
          hasRunningOrder: /your set, taking shape/i.test(text),
          hasSuggestedFit: /suggested fit:/i.test(text),
          hasInspector: /track #1 of 12/i.test(text) || /track inspector/i.test(text),
          hasDock: /copy tracklist/i.test(text) && /download csv/i.test(text)
        };
      })()`,
      returnByValue: true
    });

    console.log('[Loaded Workbench State]');
    console.log(workbenchCheck.result?.value);

    ws.close();

    const isAllOk =
      Object.values(openingCheck.result?.value || {}).every(Boolean) &&
      Object.values(preFlightCheck.result?.value || {}).every(Boolean) &&
      Object.values(workbenchCheck.result?.value || {}).every(Boolean);

    console.log('\n================================================================================');
    if (isAllOk) {
      console.log('✅ LIVE WEB VERSION IS WORKING 100% AS EXPECTED!');
    } else {
      console.log('❌ LIVE WEB VERSION VERIFICATION FAILED');
      process.exit(1);
    }
    console.log('================================================================================');
  } finally {
    chrome.kill();
  }
}

testLiveWeb().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
