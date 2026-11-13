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
