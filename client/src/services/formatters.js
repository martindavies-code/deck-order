/**
 * Pure Browser-Safe Export Formatters (No Node.js dependencies)
 */

export function generatePlainTextTracklist(orderedTracks) {
  return orderedTracks
    .map(t => `${t.artist} - ${t.title}${t.version && t.version !== 'Original Mix' ? ` (${t.version})` : ''}`)
    .join('\n');
}

export function generateCSVExport(orderedTracks, evaluation) {
  const transitions = evaluation?.transitions || [];
  const headers = ['Order', 'Artist', 'Title', 'Version', 'BPM', 'Key', 'Camelot', 'Energy', 'Source', 'Status', 'Transition Grade', 'Transition Relation'];
  const rows = [headers.join(',')];

  orderedTracks.forEach((t, idx) => {
    const tr = transitions[idx];
    const grade = tr?.grade || (idx === orderedTracks.length - 1 ? 'END' : 'N/A');
    const relation = tr?.relation ? `"${tr.relation.replace(/"/g, '""')}"` : 'N/A';
    const energy = t.energy !== null && t.energy !== undefined ? t.energy : '';

    rows.push([
      idx + 1,
      `"${(t.artist || '').replace(/"/g, '""')}"`,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.version || '').replace(/"/g, '""')}"`,
      t.bpm || '',
      `"${(t.key || '').replace(/"/g, '""')}"`,
      `"${t.camelot || ''}"`,
      energy,
      `"${(t.source || '').replace(/"/g, '""')}"`,
      `"${t.status || ''}"`,
      `"${grade}"`,
      relation
    ].join(','));
  });

  return rows.join('\n');
}
