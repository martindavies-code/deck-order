import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REMOTE_PORT = 9224;

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function verifyGoogleButton() {
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${REMOTE_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1200));

  try {
    const list = await fetchJson(`http://127.0.0.1:${REMOTE_PORT}/json/list`);
    const pageTarget = list.find(t => t.type === 'page') || list[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (evt) => {
          const parsed = JSON.parse(evt.data);
          if (parsed.id === id) {
            ws.removeEventListener('message', handler);
            resolve(parsed.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'https://martindavies-code.github.io/deck-order/' });
    await new Promise(r => setTimeout(r, 3000));

    // Find and click the Account button in the header
    const clickAccountBtn = await send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const accountBtn = buttons.find(b => b.innerText.includes('Account'));
        if (accountBtn) {
          accountBtn.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true
    });

    console.log('Account Button Clicked:', clickAccountBtn.result.value);

    // Wait 2 seconds for GIS iframe / button to load into container
    await new Promise(r => setTimeout(r, 2000));

    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
        return {
          hasHistorySync: text.includes('Set History Sync'),
          notConfiguredWarning: text.includes("Google sign-in isn't configured"),
          gisIframes: iframes.filter(src => src.includes('accounts.google.com/gsi'))
        };
      })()`,
      returnByValue: true
    });

    console.log('Account Menu State:', check.result.value);

    ws.close();
  } finally {
    chromeProc.kill();
  }
}

verifyGoogleButton().catch(console.error);
