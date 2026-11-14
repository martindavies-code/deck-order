/**
 * Pure Browser-Safe Export Formatters (No Node.js dependencies)
 */

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/**
 * Neutralizes CSV/spreadsheet formula prefixes (`=`, `+`, `-`, `@`, tab, CR)
 * and safely double-quotes text cells.
 */
export function escapeCsvStringCell(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_TRIGGER_RE.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function generatePlainTextTracklist(orderedTracks) {
  return (orderedTracks || [])
    .map(t => `${t.artist || ''} - ${t.title || ''}${t.version && t.version !== 'Original Mix' ? ` (${t.version})` : ''}`)
    .join('\n');
}

export function generateM3U8Export(orderedTracks, setName = 'Deck Order Set') {
  const cleanSetName = String(setName || 'Deck Order Set').replace(/[\r\n]+/g, ' ').trim() || 'Deck Order Set';
  const lines = ['#EXTM3U', `#PLAYLIST:${cleanSetName}`];

  (orderedTracks || []).forEach((t, idx) => {
    const artist = String(t.artist || 'Unknown Artist').replace(/[\r\n]+/g, ' ').trim();
    const title = String(t.title || t.name || 'Untitled Track').replace(/[\r\n]+/g, ' ').trim();
    const version = t.version && t.version !== 'Original Mix'
      ? ` (${String(t.version).replace(/[\r\n]+/g, ' ').trim()})`
      : '';
    const display = `${artist} - ${title}${version}`.replace(/,/g, ' ');
    const bpm = typeof t.bpm === 'number' && Number.isFinite(t.bpm) ? t.bpm : '';
    const camelot = t.camelot ? String(t.camelot).replace(/[\r\n;]+/g, '') : '';
    const status = t.status ? String(t.status).replace(/[\r\n;]+/g, '') : '';

    lines.push(`#EXTINF:-1,${display}`);
    if (bpm || camelot || status) {
      lines.push(`#EXT-X-DECKORDER:pos=${idx + 1};bpm=${bpm};camelot=${camelot};status=${status}`);
    }
    const uriMatch = /^spotify:track:([A-Za-z0-9_-]{1,64})$/.exec(t.uri || '');
    const spotifyId = uriMatch?.[1] || (/^[A-Za-z0-9_-]{1,64}$/.test(t.spotifyId || '') ? t.spotifyId : null);
    if (spotifyId) {
      lines.push(`https://open.spotify.com/track/${spotifyId}`);
    } else {
      const safeFile = `${artist} - ${title}`.replace(/[\\/:*?"<>|]/g, '_');
      lines.push(`${safeFile}.mp3`);
    }
  });

  return lines.join('\n');
}

export { buildMixRecipe, recommendMixSetting, PHRASE_GUIDANCE, MIX_CAVEAT } from '../utils/mixRecipe.js';

export function generateCSVExport(orderedTracks, evaluation) {
  const list = orderedTracks || [];
  const transitions = evaluation?.transitions || [];
  const headers = ['Order', 'Artist', 'Title', 'Version', 'BPM', 'Key', 'Camelot', 'Energy', 'Source', 'Status', 'Transition Grade', 'Transition Relation'];
  const rows = [headers.join(',')];

  list.forEach((t, idx) => {
    const tr = transitions[idx];
    const grade = tr?.grade || (idx === list.length - 1 ? 'END' : 'N/A');
    const relation = tr?.relation ? escapeCsvStringCell(tr.relation) : 'N/A';
    const energy = typeof t.energy === 'number' && Number.isFinite(t.energy) ? t.energy : '';
    const bpm = typeof t.bpm === 'number' && Number.isFinite(t.bpm) && t.bpm > 0 ? t.bpm : '';

    rows.push([
      idx + 1,
      escapeCsvStringCell(t.artist || ''),
      escapeCsvStringCell(t.title || ''),
      escapeCsvStringCell(t.version || ''),
      bpm,
      escapeCsvStringCell(t.key || ''),
      escapeCsvStringCell(t.camelot || ''),
      energy,
      escapeCsvStringCell(t.source || ''),
      escapeCsvStringCell(t.status || ''),
      escapeCsvStringCell(grade),
      relation
    ].join(','));
  });

  return rows.join('\n');
}
