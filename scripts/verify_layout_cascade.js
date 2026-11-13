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

async function testViewport(width, height) {
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9230',
    `--window-size=${width},${height}`,
    testUrl
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9230/json/list');
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

    if (!wsUrl) throw new Error('Could not connect to Chrome CDP on port 9230');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await new Promise(r => setTimeout(r, 1200));

    const evalResult = await sendCdp(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const docWidth = document.documentElement.clientWidth;
        const main = document.querySelector('main');
        const headerInner = document.querySelector('header > div');
        const header = document.querySelector('header');
        const mainRect = main.getBoundingClientRect();
        const headerRect = headerInner.getBoundingClientRect();
        const mainStyle = window.getComputedStyle(main);
        const headerStyle = window.getComputedStyle(headerInner);
        const headerStyleOuter = window.getComputedStyle(header);

        return {
          viewportWidth: window.innerWidth,
          clientWidth: docWidth,
          viewportHeight: window.innerHeight,
          main: {
            width: mainRect.width,
            left: mainRect.left,
            right: mainRect.right,
            paddingLeft: mainStyle.paddingLeft,
            paddingRight: mainStyle.paddingRight,
            paddingTop: mainStyle.paddingTop,
            paddingBottom: mainStyle.paddingBottom,
            marginLeft: mainStyle.marginLeft,
            marginRight: mainStyle.marginRight
          },
          header: {
            width: headerRect.width,
            left: headerRect.left,
            right: headerRect.right,
            marginLeft: headerStyle.marginLeft,
            marginRight: headerStyle.marginRight,
            paddingLeft: headerStyleOuter.paddingLeft
          }
        };
      })()`,
      returnByValue: true
    });

    ws.close();
    return evalResult.result?.value;
  } finally {
    chrome.kill();
    await new Promise(r => setTimeout(r, 500));
  }
}

async function run() {
  console.log('================================================================================');
  console.log('FIX 5 CASCADE ACCEPTANCE VERIFICATION (1280px, 1920px, 390px)');
  console.log('================================================================================\n');

  let allOk = true;
  const viewports = [
    { w: 1280, h: 800 },
    { w: 1920, h: 1080 },
    { w: 390, h: 844 }
  ];

  for (const vp of viewports) {
    const res = await testViewport(vp.w, vp.h);
    console.log(`[Viewport ${vp.w}x${vp.h}]`);
    console.log('  Main Rect:', JSON.stringify(res.main));
    console.log('  Header Inner Rect:', JSON.stringify(res.header));

    if (res.clientWidth > 1480) {
      // Should be horizontally centered: left > 0 and approx (clientWidth - width) / 2
      const expectedLeft = (res.clientWidth - res.main.width) / 2;
      const leftDelta = Math.abs(res.main.left - expectedLeft);
      const isCentered = res.main.left > 0 && leftDelta < 2; // within 2px subpixel rounding
      const hasPadding = parseFloat(res.main.paddingLeft) > 0 && parseFloat(res.main.paddingRight) > 0;

      // Header inner is centered within header or viewport
      const headerOuterPadding = parseFloat(res.header.paddingLeft) || 0;
      const headerAvailableWidth = res.clientWidth - headerOuterPadding * 2;
      let headerIsCentered = false;
      if (headerAvailableWidth >= 1480) {
        const headerExpectedLeft = (res.clientWidth - res.header.width) / 2;
        headerIsCentered = Math.abs(res.header.left - headerExpectedLeft) < 2;
      } else {
        // Fits container width within padding
        headerIsCentered = Math.abs(res.header.left - headerOuterPadding) < 2;
      }

      console.log(`  -> Main is centered (left=${res.main.left.toFixed(1)}px, expected=${expectedLeft.toFixed(1)}px): ${isCentered}`);
      console.log(`  -> Main has non-zero computed padding (${res.main.paddingLeft}): ${hasPadding}`);
      console.log(`  -> Header inner is properly aligned/centered (left=${res.header.left.toFixed(1)}px): ${headerIsCentered}`);

      if (!isCentered || !hasPadding || !headerIsCentered) {
        allOk = false;
        console.error('  ❌ FAILED CENTERING OR PADDING CHECK');
      } else {
        console.log('  ✅ PASSED');
      }
    } else {
      // 390px mobile check
      const hasPadding = parseFloat(res.main.paddingLeft) > 0;
      console.log(`  -> Mobile 390px padding active (${res.main.paddingLeft}): ${hasPadding}`);
      if (!hasPadding) {
        allOk = false;
        console.error('  ❌ FAILED MOBILE PADDING CHECK');
      } else {
        console.log('  ✅ PASSED');
      }
    }
    console.log('');
  }

  console.log('================================================================================');
  if (allOk) {
    console.log('✅ ALL VIEWPORT LAYOUT & CASCADE CHECKS PASSED PERFECTLY!');
  } else {
    console.error('❌ LAYOUT CHECKS FAILED');
    process.exit(1);
  }
  console.log('================================================================================');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
