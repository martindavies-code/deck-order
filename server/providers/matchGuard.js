const GENERIC_VERSION_TOKENS = new Set([
  'mix', 'edit', 'version', 'feat', 'featuring', 'the', 'a', 'of'
]);

export function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleCore(s) {
  return normalizeText((s || '').split('(')[0]);
}

export function versionTokens(s) {
  return normalizeText(s)
    .split(' ')
    .filter(t => t && !GENERIC_VERSION_TOKENS.has(t));
}

function tokenMatches(haystack, needleTokens, fallbackNeedle) {
  if (!fallbackNeedle) return false;
  const hayTokens = new Set(haystack.split(' ').filter(Boolean));
  const primary = needleTokens[0] || fallbackNeedle.split(' ')[0];
  if (!primary) return false;
  if (hayTokens.has(primary)) return true;
  // Require length >= 3 for substring fallback so 1-2 char artist tokens cannot match unrelated names.
  return primary.length >= 3 && haystack.includes(primary);
}

/**
 * Verifies that a provider metadata record corresponds to the queried artist, title, and mix/version.
 */
export function crossCheckTrackIdentity(query, rec, { skipVersion = false, requireFields = true } = {}) {
  const recArtist = rec?.artist_name || rec?.artist?.name || rec?.artist || '';
  const recTitle = rec?.track_name || rec?.song_title || rec?.title || '';
  const recMix = rec?.mix_name || rec?.remixer || rec?.version || '';

  if (requireFields || recArtist) {
    const artistTokens = normalizeText(query?.artist).split(' ').filter(t => t && !GENERIC_VERSION_TOKENS.has(t));
    const gotArtist = normalizeText(recArtist);
    if (!tokenMatches(gotArtist, artistTokens, normalizeText(query?.artist))) {
      return { ok: false, reason: `artist_mismatch: wanted "${query?.artist || ''}", provider has "${recArtist}"` };
    }
  }

  if (requireFields || recTitle) {
    const wantTitle = titleCore(query?.title);
    const gotTitle = titleCore(recTitle);
    const matches = Boolean(
      wantTitle && gotTitle && (
        gotTitle === wantTitle ||
        (wantTitle.length >= 3 && gotTitle.includes(wantTitle)) ||
        (gotTitle.length >= 3 && wantTitle.includes(gotTitle))
      )
    );
    if (!matches) {
      return { ok: false, reason: `title_mismatch: wanted "${query?.title || ''}", provider has "${recTitle}"` };
    }
  }

  const wantVersion = skipVersion ? [] : versionTokens(query?.version || '');
  if (wantVersion.length) {
    const hay = `${normalizeText(recMix)} ${normalizeText(recTitle)}`;
    if (!requireFields && !hay.trim()) {
      return { ok: true };
    }
    const missing = wantVersion.filter(t => !hay.includes(t));
    if (missing.length) {
      return { ok: false, reason: `version_mismatch: wanted "${query?.version}", provider has "${recMix || recTitle}"` };
    }
  }

  return { ok: true };
}

/**
 * Coalesces concurrent asynchronous calls sharing the same in-flight key.
 */
export async function withSingleflight(inFlightMap, key, fn) {
  if (inFlightMap.has(key)) {
    return await inFlightMap.get(key);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlightMap.delete(key);
    }
  })();
  inFlightMap.set(key, promise);
  return await promise;
}
