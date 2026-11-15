const VERSION_KEYWORD_RE = /\b(mix|edit|remix|dub|version|vip|extended|instrumental|acoustic|live|rework|bootleg|remaster)\b/i;
const AUDIO_EXT_RE = /\.(mp3|wav|flac|aiff|aif|m4a|aac|ogg|opus|webm)$/i;
const LEADING_TRACK_NUM_RE = /^\s*(?:[A-D]\d+|\d{1,3})(?:\s*[-._)\]]\s*|\s+(?=[A-Za-z]))/;

/**
 * Normalizes a text string for fuzzy comparison: lowercase, strips diacritics,
 * collapses punctuation and whitespace.
 */
export function normalizeMatchToken(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Strips featuring credits ("feat. X", "ft. X") and splits artist strings into
 * normalized token sets so "Artist A & Artist B" matches "Artist A, Artist B".
 */
export function normalizeArtistTokens(artist) {
  if (!artist || typeof artist !== 'string') return [];
  const cleaned = artist
    .replace(/\b(?:feat|ft|featuring)\.?\s+[^()[\]-]+/gi, ' ')
    .replace(/\b(?:vs|x)\b/gi, ' ');
  const norm = normalizeMatchToken(cleaned);
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/**
 * Extracts titleCore and version tag using the same version keywords as csvParser.js.
 */
export function splitTitleAndVersion(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return { title: '', titleCore: '', version: null };
  }
  const title = rawTitle.trim();
  let titleCore = title;
  let version = null;

  // Check parenthetical or bracketed suffix/segment containing a version keyword
  const parenMatches = [...title.matchAll(/([([][^()[\]]+[)\]])/g)];
  for (let i = parenMatches.length - 1; i >= 0; i--) {
    const fullMatch = parenMatches[i][1];
    const inner = fullMatch.slice(1, -1).trim();
    if (VERSION_KEYWORD_RE.test(inner)) {
      version = inner;
      titleCore = (title.slice(0, parenMatches[i].index) + title.slice(parenMatches[i].index + fullMatch.length))
        .replace(/\s+/g, ' ')
        .trim();
      break;
    }
  }

  // Also check trailing " - Extended Mix" / " - VIP" style suffix in title
  if (!version) {
    const dashParts = titleCore.split(/\s+[-–—]\s+/);
    if (dashParts.length > 1 && VERSION_KEYWORD_RE.test(dashParts[dashParts.length - 1])) {
      version = dashParts.pop().trim();
      titleCore = dashParts.join(' - ').trim();
    }
  }

  return {
    title,
    titleCore: titleCore || title,
    version
  };
}

export function normalizeVersionTag(version) {
  if (!version || typeof version !== 'string') return '';
  const norm = normalizeMatchToken(version);
  if (!norm || norm === 'original mix' || norm === 'original') return '';
  return norm;
}

/**
 * Parses an audio filename (e.g. "01 - Bicep - Glue (Original Mix).mp3" or
 * "Peggy_Gou_-_(It_Goes_Like)_Nanana.wav") into artist, title, titleCore, version.
 */
export function parseAudioFilename(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return { artist: '', title: '', titleCore: '', version: null };
  }
  // Strip any directory prefix and file extension
  const baseName = fileName
    .replace(/^.*[/\\]/, '')
    .replace(AUDIO_EXT_RE, '')
    .trim();

  // If filename uses underscores instead of spaces, normalize underscores to spaces
  const deUnderscored = !baseName.includes(' ') && baseName.includes('_')
    ? baseName.replace(/_+/g, ' ')
    : baseName.replace(/_{2,}/g, ' - ').replace(/_/g, ' ');

  const withoutTrackNum = deUnderscored.replace(LEADING_TRACK_NUM_RE, '').trim();

  const dashParts = withoutTrackNum.split(/\s+[-–—]\s+/);
  let artist = '';
  let rawTitle = withoutTrackNum;

  if (dashParts.length >= 2) {
    artist = dashParts[0].trim();
    rawTitle = dashParts.slice(1).join(' - ').trim();
  }

  const { title, titleCore, version } = splitTitleAndVersion(rawTitle);
  return {
    artist,
    title: title || withoutTrackNum,
    titleCore: titleCore || withoutTrackNum,
    version
  };
}

/**
 * Lightweight pure-JS parser for embedded ID3v2 (v2.2, v2.3, v2.4), FLAC
 * Vorbis comments, and MP4/M4A ilst atoms from the first bytes of an ArrayBuffer.
 * Never performs any network I/O.
 */
export function parseEmbeddedAudioTags(buffer) {
  const empty = { title: null, artist: null, album: null, isrc: null, bpm: null, key: null };
  if (!buffer) return empty;
  const u8 = buffer instanceof Uint8Array
    ? buffer
    : (buffer instanceof ArrayBuffer ? new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 262144)) : null);
  if (!u8 || u8.length < 10) return empty;

  // 1. Check ID3v2 header ("ID3")
  if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
    return parseId3v2Tags(u8);
  }

  // 2. Check FLAC header ("fLaC")
  if (u8[0] === 0x66 && u8[1] === 0x4C && u8[2] === 0x61 && u8[3] === 0x43) {
    return parseFlacVorbisTags(u8);
  }

  // 3. Check MP4/M4A ("ftyp" at offset 4)
  if (u8.length >= 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    return parseMp4Atoms(u8);
  }

  return empty;
}

function decodeId3Text(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const encoding = bytes[0];
  const payload = bytes.subarray(1);
  if (payload.length === 0) return null;

  let text = '';
  try {
    if (encoding === 0) {
      // ISO-8859-1 / Latin-1
      for (let i = 0; i < payload.length; i++) {
        if (payload[i] === 0) break;
        text += String.fromCharCode(payload[i]);
      }
    } else if (encoding === 1) {
      // UTF-16 with BOM
      let offset = 0;
      let littleEndian = true;
      if (payload.length >= 2) {
        if (payload[0] === 0xff && payload[1] === 0xfe) {
          littleEndian = true;
          offset = 2;
        } else if (payload[0] === 0xfe && payload[1] === 0xff) {
          littleEndian = false;
          offset = 2;
        }
      }
      const decoder = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be');
      text = decoder.decode(payload.subarray(offset));
    } else if (encoding === 2) {
      // UTF-16BE without BOM
      text = new TextDecoder('utf-16be').decode(payload);
    } else {
      // UTF-8 (encoding === 3 or fallback)
      text = new TextDecoder('utf-8').decode(payload);
    }
  } catch {
    return null;
  }

  const cleaned = text.replace(/\0+/g, '').trim();
  return cleaned || null;
}

function parseId3v2Tags(u8) {
  const result = { title: null, artist: null, album: null, isrc: null, bpm: null, key: null };
  const versionMajor = u8[3]; // 2, 3, or 4
  const flags = u8[5];
  const tagSize = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
  const limit = Math.min(u8.length, 10 + tagSize);

  let pos = 10;
  // Skip extended header if present (bit 6 of flags in v2.3/v2.4)
  if ((flags & 0x40) !== 0 && pos + 4 <= limit) {
    const extSize = versionMajor === 4
      ? (((u8[pos] & 0x7f) << 21) | ((u8[pos + 1] & 0x7f) << 14) | ((u8[pos + 2] & 0x7f) << 7) | (u8[pos + 3] & 0x7f))
      : ((u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3]);
    pos += versionMajor === 4 ? extSize : (extSize + 4);
  }

  const headerLen = versionMajor === 2 ? 6 : 10;
  while (pos + headerLen <= limit) {
    if (u8[pos] === 0) break; // Padding reached
    let frameId;
    let frameSize;
    if (versionMajor === 2) {
      frameId = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2]);
      frameSize = (u8[pos + 3] << 16) | (u8[pos + 4] << 8) | u8[pos + 5];
    } else {
      frameId = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
      if (versionMajor === 4) {
        frameSize = ((u8[pos + 4] & 0x7f) << 21) | ((u8[pos + 5] & 0x7f) << 14) | ((u8[pos + 6] & 0x7f) << 7) | (u8[pos + 7] & 0x7f);
      } else {
        frameSize = ((u8[pos + 4] << 24) >>> 0) + (u8[pos + 5] << 16) + (u8[pos + 6] << 8) + u8[pos + 7];
      }
    }

    if (frameSize <= 0 || pos + headerLen + frameSize > limit) break;
    const content = u8.subarray(pos + headerLen, pos + headerLen + frameSize);

    if (frameId === 'TIT2' || frameId === 'TT2') {
      result.title = decodeId3Text(content) || result.title;
    } else if (frameId === 'TPE1' || frameId === 'TP1') {
      result.artist = decodeId3Text(content) || result.artist;
    } else if (frameId === 'TALB' || frameId === 'TAL') {
      result.album = decodeId3Text(content) || result.album;
    } else if (frameId === 'TSRC' || frameId === 'TRC') {
      result.isrc = decodeId3Text(content) || result.isrc;
    } else if (frameId === 'TBPM' || frameId === 'TBP') {
      const num = parseFloat(decodeId3Text(content) || '');
      if (Number.isFinite(num) && num > 0) result.bpm = num;
    } else if (frameId === 'TKEY' || frameId === 'TKE') {
      result.key = decodeId3Text(content) || result.key;
    }

    pos += headerLen + frameSize;
  }

  return result;
}

function parseFlacVorbisTags(u8) {
  const result = { title: null, artist: null, album: null, isrc: null, bpm: null, key: null };
  let pos = 4;
  while (pos + 4 <= u8.length) {
    const isLast = (u8[pos] & 0x80) !== 0;
    const blockType = u8[pos] & 0x7f;
    const blockLen = (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3];
    pos += 4;
    if (pos + blockLen > u8.length) break;

    if (blockType === 4) {
      // Vorbis comment block (little-endian lengths)
      const dv = new DataView(u8.buffer, u8.byteOffset + pos, blockLen);
      let cPos = 0;
      if (cPos + 4 <= blockLen) {
        const vendorLen = dv.getUint32(cPos, true);
        cPos += 4 + vendorLen;
        if (cPos + 4 <= blockLen) {
          const count = dv.getUint32(cPos, true);
          cPos += 4;
          const decoder = new TextDecoder('utf-8');
          for (let i = 0; i < count && cPos + 4 <= blockLen; i++) {
            const len = dv.getUint32(cPos, true);
            cPos += 4;
            if (cPos + len > blockLen) break;
            const entry = decoder.decode(u8.subarray(pos + cPos, pos + cPos + len));
            cPos += len;
            const eq = entry.indexOf('=');
            if (eq > 0) {
              const k = entry.slice(0, eq).trim().toUpperCase();
              const v = entry.slice(eq + 1).trim();
              if (k === 'TITLE' && v) result.title = v;
              else if (k === 'ARTIST' && v) result.artist = v;
              else if (k === 'ALBUM' && v) result.album = v;
              else if (k === 'ISRC' && v) result.isrc = v;
            }
          }
        }
      }
      break;
    }

    pos += blockLen;
    if (isLast) break;
  }
  return result;
}

function parseMp4Atoms(u8) {
  const result = { title: null, artist: null, album: null, isrc: null, bpm: null, key: null };
  const decoder = new TextDecoder('utf-8');
  // Scan for ©nam (0xA9 0x6E 0x61 0x6D) and ©ART (0xA9 0x41 0x52 0x54)
  for (let i = 4; i + 24 < u8.length; i++) {
    if (u8[i] === 0xa9) {
      const tag = String.fromCharCode(u8[i + 1], u8[i + 2], u8[i + 3]);
      if (tag === 'nam' || tag === 'ART') {
        const atomSize = ((u8[i - 4] << 24) >>> 0) + (u8[i - 3] << 16) + (u8[i - 2] << 8) + u8[i - 1];
        if (atomSize > 16 && atomSize < 4096 && i - 4 + atomSize <= u8.length) {
          // Inside atom: 4-byte data size, 'data' (0x64 0x61 0x74 0x61), 4-byte type, 4-byte locale, then UTF-8 string
          const dataPos = i + 4;
          if (
            u8[dataPos + 4] === 0x64 &&
            u8[dataPos + 5] === 0x61 &&
            u8[dataPos + 6] === 0x74 &&
            u8[dataPos + 7] === 0x61
          ) {
            const dataSize = ((u8[dataPos] << 24) >>> 0) + (u8[dataPos + 1] << 16) + (u8[dataPos + 2] << 8) + u8[dataPos + 3];
            const strStart = dataPos + 16;
            const strEnd = Math.min(u8.length, dataPos + dataSize);
            if (strEnd > strStart) {
              const val = decoder.decode(u8.subarray(strStart, strEnd)).replace(/\0+/g, '').trim();
              if (val) {
                if (tag === 'nam') result.title = val;
                if (tag === 'ART') result.artist = val;
              }
            }
          }
        }
      }
    }
  }
  return result;
}

/**
 * Combines embedded ID3/Vorbis/MP4 metadata with filename parsing to build
 * the normalized track identity for an audio file.
 */
export function extractAudioFileIdentity({ fileName = '', embeddedTags = null }) {
  const fromName = parseAudioFilename(fileName);
  const embeddedTitle = embeddedTags?.title ? String(embeddedTags.title).trim() : '';
  const embeddedArtist = embeddedTags?.artist ? String(embeddedTags.artist).trim() : '';
  const embeddedIsrc = embeddedTags?.isrc ? String(embeddedTags.isrc).trim().toUpperCase() : null;

  const chosenArtist = embeddedArtist || fromName.artist || '';
  const chosenRawTitle = embeddedTitle || fromName.title || '';
  const splitChosen = splitTitleAndVersion(chosenRawTitle);

  // If embedded title lacked a version tag (e.g. "Glue") but the filename had
  // one (e.g. "Bicep - Glue (VIP).mp3"), preserve the filename's version tag!
  const version = splitChosen.version || fromName.version || null;
  const titleCore = splitChosen.titleCore || fromName.titleCore || chosenRawTitle;
  const displayTitle = version && !chosenRawTitle.toLowerCase().includes(version.toLowerCase())
    ? `${titleCore} (${version})`
    : (chosenRawTitle || fileName.replace(AUDIO_EXT_RE, ''));

  return {
    artist: chosenArtist,
    title: displayTitle,
    titleCore,
    version,
    isrc: embeddedIsrc,
    fromName,
    hasEmbeddedIdentity: Boolean(embeddedTitle || embeddedArtist)
  };
}

function tokenJaccard(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Scores a single analysed audio file against a single tracklist entry.
 * Returns { score, confidence, reasons, versionConflict, durationConflict }.
 */
export function scoreFileToTrack(analysedFile, track) {
  if (!analysedFile || !track) {
    return { score: 0, reasons: [], versionConflict: false, durationConflict: false };
  }

  const fileId = analysedFile.identity || extractAudioFileIdentity({
    fileName: analysedFile.fileName || '',
    embeddedTags: analysedFile.embeddedTags || null
  });
  const trackSplit = splitTitleAndVersion(track.title || '');
  const trackTitleCore = normalizeMatchToken(track.titleCore || trackSplit.titleCore || track.title || '');
  const fileTitleCore = normalizeMatchToken(fileId.titleCore || fileId.title || '');
  const fileNameTitleCore = normalizeMatchToken(fileId.fromName?.titleCore || '');

  const reasons = [];
  let versionConflict = false;
  let durationConflict = false;

  // 1. Exact ISRC match is definitive recording proof
  if (fileId.isrc && track.isrc && String(fileId.isrc).toUpperCase() === String(track.isrc).toUpperCase()) {
    return {
      score: 0.99,
      reasons: [`Exact ISRC match (${fileId.isrc})`],
      versionConflict: false,
      durationConflict: false
    };
  }

  // 2. Title core similarity (compare both primary identity and filename fallback)
  let titleScore = 0;
  const bestFileTitle = (fileTitleCore && fileTitleCore === trackTitleCore)
    ? fileTitleCore
    : (fileNameTitleCore && fileNameTitleCore === trackTitleCore ? fileNameTitleCore : fileTitleCore);

  if (bestFileTitle && trackTitleCore) {
    if (bestFileTitle === trackTitleCore) {
      titleScore = 1.0;
      reasons.push('Exact title match');
    } else {
      const fileTokens = bestFileTitle.split(' ').filter(Boolean);
      const trackTokens = trackTitleCore.split(' ').filter(Boolean);
      const jaccard = tokenJaccard(fileTokens, trackTokens);
      if (jaccard >= 0.75) {
        titleScore = jaccard;
        reasons.push('Close title match');
      } else if (
        bestFileTitle.length >= 4 &&
        trackTitleCore.length >= 4 &&
        (bestFileTitle.includes(trackTitleCore) || trackTitleCore.includes(bestFileTitle))
      ) {
        titleScore = 0.78;
        reasons.push('Partial title match');
      } else {
        titleScore = jaccard;
      }
    }
  }

  if (titleScore < 0.35) {
    return { score: 0, reasons: [], versionConflict: false, durationConflict: false };
  }

  // 3. Artist similarity
  const fileArtistTokens = normalizeArtistTokens(fileId.artist || fileId.fromName?.artist || '');
  const trackArtistTokens = normalizeArtistTokens(track.artist || '');
  let artistScore = 0;
  let hasFileArtist = fileArtistTokens.length > 0;

  if (hasFileArtist && trackArtistTokens.length > 0) {
    const fileArtistNorm = fileArtistTokens.join(' ');
    const trackArtistNorm = trackArtistTokens.join(' ');
    if (fileArtistNorm === trackArtistNorm) {
      artistScore = 1.0;
      reasons.push('Exact artist match');
    } else {
      const jaccard = tokenJaccard(fileArtistTokens, trackArtistTokens);
      const sharedAny = fileArtistTokens.some(t => t.length >= 3 && trackArtistTokens.includes(t));
      if (jaccard >= 0.5) {
        artistScore = Math.max(0.75, jaccard);
        reasons.push('Artist match');
      } else if (sharedAny) {
        artistScore = 0.65;
        reasons.push('Primary artist token match');
      }
    }
  }

  // Combine title and artist into base score
  let score = hasFileArtist
    ? (titleScore * 0.62 + artistScore * 0.38)
    : (titleScore * 0.74); // Title-only filename caps below auto-match threshold (0.82) -> goes to confirmation

  if (!hasFileArtist && titleScore >= 0.95) {
    reasons.push('Title matches (filename has no artist)');
  }

  // 4. Version tag check (VIP, Extended Mix, Remix, Dub, Edit, etc.)
  const fileVer = normalizeVersionTag(fileId.version || fileId.fromName?.version);
  const trackVer = normalizeVersionTag(track.version || trackSplit.version);
  if (fileVer && trackVer) {
    if (fileVer === trackVer || fileVer.includes(trackVer) || trackVer.includes(fileVer)) {
      score += 0.08;
      reasons.push(`Version match (${fileId.version || track.version})`);
    } else {
      score -= 0.25;
      versionConflict = true;
      reasons.push(`Version tag differs: file "${fileId.version}" vs track "${track.version || trackSplit.version}"`);
    }
  } else if (fileVer !== trackVer && (fileVer || trackVer)) {
    // One side specifies a remix/VIP/edit and the other is the original/unspecified
    const nonGeneric = fileVer || trackVer;
    if (/\b(vip|remix|dub|bootleg|rework|instrumental|acoustic|live)\b/i.test(nonGeneric)) {
      score -= 0.15;
      versionConflict = true;
      reasons.push(`Edition caution: "${fileId.version || 'Original'}" vs "${track.version || trackSplit.version || 'Original'}"`);
    }
  }

  // 5. Duration proximity check (tolerance 12s)
  const fileDurMs = analysedFile.durationMs ?? (analysedFile.durationSec ? analysedFile.durationSec * 1000 : null);
  const trackDurMs = track.durationMs ?? track.duration_ms ?? null;
  if (typeof fileDurMs === 'number' && fileDurMs > 0 && typeof trackDurMs === 'number' && trackDurMs > 0) {
    const diffSec = Math.abs(fileDurMs - trackDurMs) / 1000;
    if (diffSec <= 4) {
      score += 0.05;
      reasons.push('Duration matches within 4s');
    } else if (diffSec <= 12) {
      score += 0.02;
      reasons.push(`Duration within ${Math.round(diffSec)}s`);
    } else if (diffSec > 15) {
      score -= 0.16;
      durationConflict = true;
      reasons.push(`Duration differs by ${Math.round(diffSec)}s (possible different edit)`);
    }
  }

  const clampedScore = Math.round(Math.min(0.99, Math.max(0, score)) * 1000) / 1000;
  return {
    score: clampedScore,
    reasons,
    versionConflict,
    durationConflict
  };
}

/**
 * Matches a batch of analysed audio files against a tracklist.
 * Returns:
 * - autoMatched: [{ fileIndex, file, trackId, track, score, reasons }]
 * - ambiguous:   [{ fileIndex, file, proposedTrackId, score, reasons, candidates }]
 * - unmatchedFiles: [{ fileIndex, file, reason }]
 * - unmatchedTracks: [track, ...]
 */
export function matchAudioFilesToTracks(analysedFiles = [], tracks = []) {
  const validFiles = Array.isArray(analysedFiles) ? analysedFiles : [];
  const validTracks = Array.isArray(tracks) ? tracks : [];

  if (validTracks.length === 0) {
    return {
      autoMatched: [],
      ambiguous: [],
      unmatchedFiles: validFiles.map((file, fileIndex) => ({
        fileIndex,
        file,
        reason: 'No tracklist loaded yet.'
      })),
      unmatchedTracks: []
    };
  }

  // Score every (file, track) pair
  const fileCandidates = validFiles.map((file, fileIndex) => {
    const scored = [];
    for (const track of validTracks) {
      const evaluation = scoreFileToTrack(file, track);
      if (evaluation.score >= 0.38) {
        scored.push({
          trackId: track.id,
          track,
          score: evaluation.score,
          reasons: evaluation.reasons,
          versionConflict: evaluation.versionConflict,
          durationConflict: evaluation.durationConflict
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { fileIndex, file, candidates: scored };
  });

  // Check if multiple files claim the same top track
  const topClaimCounts = new Map();
  for (const fc of fileCandidates) {
    if (fc.candidates.length > 0) {
      const topId = fc.candidates[0].trackId;
      const list = topClaimCounts.get(topId) || [];
      list.push({ fileIndex: fc.fileIndex, score: fc.candidates[0].score });
      topClaimCounts.set(topId, list);
    }
  }

  const autoMatched = [];
  const ambiguous = [];
  const unmatchedFiles = [];
  const claimedTrackIds = new Set();

  for (const fc of fileCandidates) {
    const { fileIndex, file, candidates } = fc;
    if (candidates.length === 0) {
      unmatchedFiles.push({
        fileIndex,
        file,
        reason: 'No matching track title or artist found in the current set.'
      });
      continue;
    }

    const top = candidates[0];
    const runnerUp = candidates[1] || null;
    const margin = runnerUp ? (top.score - runnerUp.score) : 1.0;
    const competingFiles = (topClaimCounts.get(top.trackId) || [])
      .filter(c => c.fileIndex !== fileIndex && c.score >= top.score - 0.12);

    const isUnambiguousAuto =
      top.score >= 0.82 &&
      !top.versionConflict &&
      !top.durationConflict &&
      margin >= 0.14 &&
      competingFiles.length === 0 &&
      !claimedTrackIds.has(top.trackId);

    if (isUnambiguousAuto) {
      claimedTrackIds.add(top.trackId);
      autoMatched.push({
        fileIndex,
        file,
        trackId: top.trackId,
        track: top.track,
        score: top.score,
        reasons: top.reasons
      });
    } else {
      const ambiguityReasons = [...top.reasons];
      if (runnerUp && margin < 0.14) {
        ambiguityReasons.push(`Close alternative match: "${runnerUp.track.artist} - ${runnerUp.track.title}"`);
      }
      if (competingFiles.length > 0) {
        ambiguityReasons.push('Multiple audio files match this track');
      }
      claimedTrackIds.add(top.trackId);
      ambiguous.push({
        fileIndex,
        file,
        proposedTrackId: top.trackId,
        proposedTrack: top.track,
        score: top.score,
        reasons: ambiguityReasons,
        candidates: candidates.slice(0, 6)
      });
    }
  }

  const unmatchedTracks = validTracks.filter(t => !claimedTrackIds.has(t.id));

  return {
    autoMatched,
    ambiguous,
    unmatchedFiles,
    unmatchedTracks
  };
}

/**
 * Attaches local audio analysis results to an existing track object, setting
 * source: 'audio_analysis', status: 'analysed', energyCurve, and updating the
 * track.sources array while preserving any 'Manual CSV' provenance for dispute
 * cross-checking.
 */
export function attachAudioAnalysisToTrack(track, analysedFile) {
  if (!track || !analysedFile) return track;

  const existingSources = Array.isArray(track.sources) ? [...track.sources] : [];
  // If track came from manual_csv with a supplied BPM or key, ensure Manual CSV
  // provenance is preserved in sources so pipeline.js can cross-check it against audio.
  const hasManualCsvEntry = existingSources.some(s => s?.name === 'Manual CSV');
  if (
    !hasManualCsvEntry &&
    track.source === 'manual_csv' &&
    (typeof track.bpm === 'number' || track.camelot)
  ) {
    existingSources.push({
      name: 'Manual CSV',
      provider: 'Manual CSV',
      bpm: track.bpm ?? null,
      rawBpm: track.rawBpm ?? track.bpm ?? null,
      workingBpm: track.workingBpm ?? track.bpm ?? null,
      key: track.key ?? track.camelot ?? null,
      camelot: track.camelot ?? null
    });
  }

  const bpm = analysedFile.workingBpm ?? analysedFile.bpm ?? null;
  const rawBpm = analysedFile.rawBpm ?? analysedFile.bpm ?? null;
  const camelot = analysedFile.camelot ?? null;
  const key = analysedFile.key ?? camelot ?? null;
  const durationMs = analysedFile.durationMs ?? track.durationMs ?? track.duration_ms ?? null;

  const audioSource = {
    name: 'Audio Analysis',
    provider: 'Audio Analysis',
    source: 'audio_analysis',
    bpm,
    rawBpm,
    workingBpm: bpm,
    key,
    camelot,
    energy: analysedFile.energy ?? null,
    durationMs,
    confidence: analysedFile.bpmConfidence ?? 'audio_analysis',
    confidenceTier: analysedFile.confidenceTier ?? null,
    fileName: analysedFile.fileName || null
  };

  const filteredOtherSources = existingSources.filter(
    s => s && s.source !== 'audio_analysis' && s.name !== 'Audio Analysis' && s.provider !== 'Audio Analysis'
  );

  return {
    ...track,
    source: 'audio_analysis',
    status: 'analysed',
    confidence: analysedFile.confidenceTier ? `audio_${analysedFile.confidenceTier}` : 'audio_analysis',
    bpm,
    rawBpm,
    workingBpm: bpm,
    isNormalized: Boolean(analysedFile.isNormalized),
    key,
    camelot,
    energy: analysedFile.energy ?? track.energy ?? null,
    energyCurve: Array.isArray(analysedFile.energyCurve) ? analysedFile.energyCurve : [],
    durationMs,
    duration_ms: durationMs,
    audioFileName: analysedFile.fileName || null,
    audioConfidence: analysedFile.bpmConfidence ?? null,
    reason: 'Analysed directly from local audio file in your browser.',
    sources: [audioSource, ...filteredOtherSources]
  };
}

/**
 * Builds a complete tracklist entry directly from an analysed audio file when
 * the user drops/selects audio files without a separate text/CSV tracklist.
 */
export function buildTrackFromAudioFile(analysedFile, index = 0) {
  const identity = analysedFile.identity || extractAudioFileIdentity({
    fileName: analysedFile.fileName || `Track ${index + 1}`,
    embeddedTags: analysedFile.embeddedTags || null
  });

  const baseTrack = {
    id: `audio_track_${index + 1}_${Date.now().toString(36)}`,
    artist: identity.artist || 'Unknown Artist',
    title: identity.title || analysedFile.fileName || `Track ${index + 1}`,
    titleCore: identity.titleCore || identity.title || '',
    version: identity.version || 'Original Mix',
    isrc: identity.isrc || null,
    durationMs: analysedFile.durationMs ?? null,
    duration_ms: analysedFile.durationMs ?? null,
    sources: []
  };

  return attachAudioAnalysisToTrack(baseTrack, analysedFile);
}
