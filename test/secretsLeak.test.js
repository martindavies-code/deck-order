import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 0 Compliance: Zero Secret Leaks in Frontend Bundle Verification', () => {

  const FORBIDDEN_CLIENT_ENV_KEYS = [
    'VITE_SPOTIFY_CLIENT_SECRET',
    'VITE_GETSONGBPM_API_KEY',
    'VITE_SONOVAULT_API_KEY',
    'VITE_SOUNDNET_API_KEY',
    'SPOTIFY_CLIENT_SECRET',
    'GETSONGBPM_API_KEY',
    'SONOVAULT_API_KEY',
    'SOUNDNET_API_KEY'
  ];

  function scanClientDir(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
          scanClientDir(fullPath, fileList);
        }
      } else if (entry.isFile()) {
        if (/\.(js|ts|jsx|tsx|html|json|css|env)$/.test(entry.name)) {
          fileList.push(fullPath);
        }
      }
    }
    return fileList;
  }

  test('Grep scan proves ZERO secrets or backend provider keys in client directory', () => {
    const clientDir = path.resolve('./client');
    const filesToScan = scanClientDir(clientDir);
    const violations = [];

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const secretKey of FORBIDDEN_CLIENT_ENV_KEYS) {
        if (content.includes(secretKey)) {
          violations.push({
            file: path.relative(clientDir, filePath),
            secretKey
          });
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Detected sensitive secret keys in frontend client code: ${JSON.stringify(violations, null, 2)}`
    );
  });
});
