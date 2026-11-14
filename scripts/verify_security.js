import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_ENDPOINTS = [
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
const ENDPOINT_ALLOWLIST = {
  'server/providers/musicae.js': ['audio-analysis']
};

const FORBIDDEN_CLIENT_SECRETS = [
  'VITE_SPOTIFY_CLIENT_SECRET',
  'VITE_GETSONGBPM_API_KEY',
  'VITE_SONOVAULT_API_KEY',
  'VITE_SOUNDNET_API_KEY',
  'SPOTIFY_CLIENT_SECRET',
  'GETSONGBPM_API_KEY',
  'SONOVAULT_API_KEY',
  'SOUNDNET_API_KEY'
];

function scanDir(dir, filterExts) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'cache', 'logs'].includes(e.name)) {
        files.push(...scanDir(full, filterExts));
      }
    } else if (e.isFile() && filterExts.some(ext => e.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

console.log('================================================================================');
console.log('DECK ORDER - SECURITY & PLATFORM CONSTRAINTS GREP VERIFICATION');
console.log('================================================================================\n');

// 1. Verify Zero Forbidden Endpoints
const allCodeFiles = scanDir('.', ['.js', '.jsx', '.ts', '.tsx', '.json', '.html'])
  .filter(f => !f.includes('test') && !f.includes('scripts') && !f.includes('verify_security'));

let endpointViolations = 0;
for (const file of allCodeFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = file.startsWith('./') ? file.slice(2) : file;
  for (const forbidden of FORBIDDEN_ENDPOINTS) {
    if ((ENDPOINT_ALLOWLIST[rel] || []).includes(forbidden)) continue;
    if (content.includes(forbidden)) {
      console.error(`❌ VIOLATION in ${file}: forbidden endpoint "${forbidden}" found!`);
      endpointViolations++;
    }
  }
}

if (endpointViolations === 0) {
  console.log(`✅ ZERO forbidden Spotify endpoints found across ${allCodeFiles.length} production code files.`);
} else {
  console.error(`❌ Found ${endpointViolations} forbidden endpoint calls.`);
  process.exit(1);
}

// 2. Verify Zero Secret Leaks in Client Directory
const clientFiles = scanDir('./client', ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.env']);
let secretViolations = 0;
for (const file of clientFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const secret of FORBIDDEN_CLIENT_SECRETS) {
    if (content.includes(secret)) {
      console.error(`❌ VIOLATION in ${file}: secret token "${secret}" found in client!`);
      secretViolations++;
    }
  }
}

if (secretViolations === 0) {
  console.log(`✅ ZERO backend provider secrets or secret env keys found in client directory (${clientFiles.length} files checked).`);
} else {
  console.error(`❌ Found ${secretViolations} secret leaks in client!`);
  process.exit(1);
}

console.log('\n================================================================================');
console.log('SECURITY VERIFICATION RESULT: ALL PASS');
console.log('================================================================================');
