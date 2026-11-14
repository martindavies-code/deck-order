import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 0 Compliance: Zero Forbidden Endpoints Verification', () => {

  const FORBIDDEN_STRINGS = [
    'audio-features',
    'audio-analysis',
    '/recommendations',
    'related-artists',
    'featured-playlists',
    'browse/categories'
  ];

  // Documented exemptions: strings that match a forbidden Spotify path
  // fragment but belong to a different, permitted service.
  // - server/providers/musicae.js: Musicae's own RapidAPI endpoint is
  //   /v2/audio-analysis/{id} on dj-track-audio-analysis-api.p.rapidapi.com -
  //   it is not Spotify's deprecated /v1/audio-analysis endpoint.
  const ALLOWLIST = {
    'server/providers/musicae.js': ['audio-analysis']
  };

  function scanDirectory(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'cache', 'logs'].includes(entry.name)) {
          scanDirectory(fullPath, fileList);
        }
      } else if (entry.isFile()) {
        // Only inspect code files, exclude this test file and docs
        if (
          /\.(js|ts|jsx|tsx|json|html|css)$/.test(entry.name) &&
          entry.name !== 'forbiddenEndpoints.test.js'
        ) {
          fileList.push(fullPath);
        }
      }
    }
    return fileList;
  }

  test('Grep scan proves ZERO forbidden Spotify endpoints exist in codebase', () => {
    const rootDir = path.resolve('.');
    const serverFiles = scanDirectory(path.resolve('./server'));
    const clientFiles = scanDirectory(path.resolve('./client'));
    const filesToScan = [...serverFiles, ...clientFiles];
    const violations = [];

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const forbidden of FORBIDDEN_STRINGS) {
        const rel = path.relative(rootDir, filePath);
        if ((ALLOWLIST[rel] || []).includes(forbidden)) continue;
        if (content.includes(forbidden)) {
          violations.push({
            file: path.relative(rootDir, filePath),
            forbidden
          });
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Detected calls to forbidden Spotify endpoints: ${JSON.stringify(violations, null, 2)}`
    );
  });
});
