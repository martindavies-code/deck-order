import { parseKey } from '../core/camelot.js';

/**
 * Robust CSV and plain-text tracklist parser.
 * Supports exports from Rekordbox, Tunebat, Lexicon DJ, Mixed In Key, Beatport,
 * or simple copy-pasted lines.
 */
export function parseTracklistCSV(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') {
    return [];
  }

  const lines = csvContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return [];

  // Inspect first line for header
  const firstLine = lines[0];
  const firstTokens = parseCSVLine(firstLine);
  const headerMap = detectHeaders(firstTokens);

  const tracks = [];
  const startIndex = headerMap ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    const tokens = parseCSVLine(rawLine);
    if (tokens.length === 0) continue;

    let artist = '';
    let title = '';
    let rawBpm = null;
    let rawKey = null;
    let isrc = null;
    let energy = null;
    let version = '';

    if (headerMap) {
      artist = (tokens[headerMap.artist] || '').trim();
      title = (tokens[headerMap.title] || '').trim();
      rawBpm = tokens[headerMap.bpm] ? parseFloat(tokens[headerMap.bpm]) : null;
      rawKey = (tokens[headerMap.key] || '').trim();
      if (headerMap.isrc !== undefined) isrc = (tokens[headerMap.isrc] || '').trim();
      if (headerMap.energy !== undefined && tokens[headerMap.energy]) {
        energy = parseFloat(tokens[headerMap.energy]);
      }
      if (headerMap.version !== undefined) version = (tokens[headerMap.version] || '').trim();
    } else {
      // Positional fallback:
      // Case A: 5+ tokens [Artist, Title, Version, BPM, Key] when tokens[2] is non-numeric and tokens[3] is numeric
      // Case B: 4+ tokens [Artist, Title, BPM, Key, (ISRC)]
      // Case C: 3 tokens [Artist - Title, BPM, Key] or [Artist, Title, BPM/Key]
      // Case D: 2 tokens [Artist - Title, BPM] or [Artist, Title]
      if (tokens.length >= 5 && isNaN(parseFloat(tokens[2])) && !isNaN(parseFloat(tokens[3]))) {
        artist = tokens[0].trim();
        title = tokens[1].trim();
        version = tokens[2].trim();
        rawBpm = parseFloat(tokens[3]);
        rawKey = tokens[4].trim();
        if (tokens.length >= 6 && tokens[5]) isrc = tokens[5].trim();
      } else if (tokens.length >= 4) {
        artist = tokens[0].trim();
        title = tokens[1].trim();
        rawBpm = parseFloat(tokens[2]);
        rawKey = tokens[3].trim();
        if (tokens.length >= 5 && tokens[4]) isrc = tokens[4].trim();
      } else if (tokens.length === 3) {
        // Check if first token contains " - "
        if (tokens[0].includes(' - ')) {
          const parts = tokens[0].split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else {
          artist = tokens[0].trim();
          title = tokens[1].trim();
        }
        rawBpm = parseFloat(tokens[1]) || parseFloat(tokens[2]);
        rawKey = isNaN(parseFloat(tokens[1])) ? tokens[2].trim() : tokens[1].trim();
      } else if (tokens.length === 2) {
        if (tokens[0].includes(' - ')) {
          const parts = tokens[0].split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
          rawBpm = parseFloat(tokens[1]);
        } else if (!isNaN(parseFloat(tokens[1]))) {
          // [Artist, BPM] - no title given
          artist = tokens[0].trim();
          title = 'Unknown';
          rawBpm = parseFloat(tokens[1]);
        } else {
          // [Artist, Title] - no tempo/key given
          artist = tokens[0].trim();
          title = tokens[1].trim();
          rawBpm = null;
        }
      }
    }

    if (!artist && !title) continue;

    // Detect remix/version in title if not given
    if (!version && title) {
      const match = title.match(/\((.*?mix|.*?edit|.*?remix|.*?dub|.*?version)\)/i);
      if (match) {
        version = match[1];
      }
    }

    // Parse Camelot key
    const parsedKey = parseKey(rawKey);

    // Validate BPM & energy strictly within musical bounds
    const bpm = (Number.isFinite(rawBpm) && rawBpm > 0 && rawBpm <= 350)
      ? Math.round(rawBpm * 10) / 10
      : null;
    const validEnergy = (typeof energy === 'number' && Number.isFinite(energy) && energy >= 0 && energy <= 1)
      ? energy
      : null;

    tracks.push({
      id: `manual_${i}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      artist: artist || 'Unknown Artist',
      title: title || 'Unknown Title',
      version: version || '',
      isrc: isrc || null,
      rawBpm: bpm,
      bpm: bpm,
      rawKey: rawKey || null,
      key: parsedKey.pitch && parsedKey.mode ? `${parsedKey.pitch} ${parsedKey.mode}` : (parsedKey.camelot || rawKey || null),
      camelot: parsedKey.camelot,
      energy: validEnergy,
      source: 'manual_csv',
      sources: [{
        name: 'Manual CSV',
        bpm,
        key: rawKey,
        camelot: parsedKey.camelot,
        confidence: 'manual'
      }],
      status: (bpm && parsedKey.camelot) ? 'verified' : (bpm || parsedKey.camelot ? 'partially_verified' : 'unverified'),
      confidence: 'manual'
    });
  }

  return tracks;
}

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === ',' || c === '\t' || c === ';') && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function detectHeaders(tokens) {
  const norm = tokens.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (keywords) => {
    for (let i = 0; i < norm.length; i++) {
      if (keywords.some(k => norm[i].includes(k))) return i;
    }
    return undefined;
  };

  const artistIdx = find(['artist', 'creator', 'performer']);
  const titleIdx = find(['title', 'track', 'song', 'name']);
  const bpmIdx = find(['bpm', 'tempo']);
  const keyIdx = find(['key', 'tonality', 'camelot', 'musicalkey']);

  if (artistIdx !== undefined && (titleIdx !== undefined || bpmIdx !== undefined)) {
    return {
      artist: artistIdx,
      title: titleIdx !== undefined ? titleIdx : (artistIdx === 0 ? 1 : 0),
      bpm: bpmIdx,
      key: keyIdx,
      isrc: find(['isrc']),
      energy: find(['energy']),
      version: find(['version', 'remix', 'mix'])
    };
  }
  return null;
}
