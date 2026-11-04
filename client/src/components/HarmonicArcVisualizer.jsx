import React, { useState } from 'react';

// Chart semantics, kept honest with the solver (server/core/energyArc.js):
// - Tempo view plots BPM by set position.
// - Energy view plots the catalogue's 0-1 energy score by set position. Energy
//   comes from the metadata provider only; manual BPM/key entries never add one.
// - The shaded band is the arc model's target peak zone. The solver's
//   calculateArcPositionPenalty discourages slow tracks inside 65-85% of the set
//   and very fast tracks inside the first 20%, so the band marks where the
//   sequencer wants the peak to land. It is a target, not a measurement.
// - A dashed marker below the baseline means "no value for this view" (e.g. no
//   catalogue energy score in Energy view); it never invents a value.

const PEAK_ZONE_START = 0.65;
const PEAK_ZONE_END = 0.85;

export function HarmonicArcVisualizer({ tracks, evaluation, onSelectTrack }) {
  const [metric, setMetric] = useState('tempo'); // 'tempo' | 'energy'

  if (!tracks || tracks.length < 2 || !evaluation || !evaluation.transitions) {
    return null;
  }

  // Check if energy data actually exists
  const hasEnergyData = tracks.some(t => typeof t.energy === 'number' && !isNaN(t.energy));

  // Extract valid BPMs
  const validBpms = tracks.map(t => t.bpm).filter(b => typeof b === 'number' && !isNaN(b));
  const hasTempoData = validBpms.length > 0;
  const minBpm = hasTempoData ? Math.min(...validBpms) : 120;
  const maxBpm = hasTempoData ? Math.max(...validBpms) : 130;
  const bpmRange = Math.max(6, maxBpm - minBpm);
  const metricHasData = metric === 'energy' ? hasEnergyData : hasTempoData;

  // SVG coordinates: one fixed slot per track so dense sets keep legible labels.
  // The SVG keeps its aspect ratio and scrolls horizontally on narrow screens
  // instead of squashing labels together.
  const perTrack = 18;
  const height = 150;
  const padLeft = 48;
  const padRight = 28;
  const padTop = 40;
  const padBottom = 32;
  const innerWidth = Math.max(752, perTrack * (tracks.length - 1));
  const width = padLeft + innerWidth + padRight;
  const innerHeight = height - padTop - padBottom;

  const peakX = padLeft + PEAK_ZONE_START * innerWidth;
  const peakWidth = (PEAK_ZONE_END - PEAK_ZONE_START) * innerWidth;

  // Y-axis tick labels match the selected metric
  const yLabels = metric === 'energy'
    ? { top: '1.0', mid: '0.5', bottom: '0.0' }
    : {
        top: maxBpm.toFixed(0),
        mid: ((maxBpm + minBpm) / 2).toFixed(0),
        bottom: minBpm.toFixed(0)
      };

  // Build points with truthful gaps
  const points = tracks.map((t, idx) => {
    const x = padLeft + (idx / (tracks.length - 1)) * innerWidth;
    const val = metric === 'energy' ? t.energy : t.bpm;
    const hasValue = typeof val === 'number' && !isNaN(val);

    let y = null;
    if (hasValue) {
      if (metric === 'energy') {
        // Energy scaled 0 to 1, clamped so an out-of-range record cannot escape the plot
        const clamped = Math.min(1, Math.max(0, val));
        y = padTop + (1 - clamped) * innerHeight;
      } else {
        y = padTop + (1 - ((val - minBpm) / bpmRange)) * innerHeight;
      }
    }

    return { x, y, track: t, val, hasValue, index: idx };
  });

  // Build SVG path segments (respecting gaps for missing data)
  const segments = [];
  let currentSegment = [];

  points.forEach((p) => {
    if (p.hasValue) {
      currentSegment.push(p);
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
  });
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return (
    <section className="deck-panel p-4 sm:p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-[#394133] gap-2">
        <div>
          <h3 className="text-sm font-bold text-[#F3F0E6] uppercase tracking-wide font-sans">
            The shape of your set
          </h3>
          <p className="text-xs text-[#BAC2B3]">
            {metric === 'energy'
              ? "Energy is the catalogue's 0-1 intensity score. Tempo is one part of the story; listen for phrasing, vocals and room to mix."
              : 'Tempo is one part of the story. Listen for phrasing, vocals and room to mix.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {hasEnergyData && (
            <div className="grid grid-cols-2 gap-1 bg-[#10120F] p-0.5 rounded border border-[#394133] text-xs">
              <button
                onClick={() => setMetric('tempo')}
                className={`px-2.5 py-1 rounded transition-colors font-mono ${
                  metric === 'tempo' ? 'bg-[#252B22] text-[#D6FC55]' : 'text-[#BAC2B3]'
                }`}
              >
                Tempo
              </button>
              <button
                onClick={() => setMetric('energy')}
                className={`px-2.5 py-1 rounded transition-colors font-mono ${
                  metric === 'energy' ? 'bg-[#252B22] text-[#D6FC55]' : 'text-[#BAC2B3]'
                }`}
              >
                Energy
              </button>
            </div>
          )}

          {validBpms.length > 0 && metric === 'tempo' && (
            <span className="text-xs font-mono text-[#BAC2B3] tabular-nums">
              Span: <strong className="text-[#F3F0E6]">{minBpm.toFixed(0)} → {maxBpm.toFixed(0)} BPM</strong>
            </span>
          )}
        </div>
      </div>

      {/* Responsive Visualizer SVG - honest empty state when the metric has no data */}
      {!metricHasData ? (
        <div className="border border-dashed border-[#394133] rounded p-6 text-center text-xs font-mono text-[#7E8876]">
          No {metric === 'energy' ? 'energy' : 'tempo'} data for these tracks yet - add BPM/key values to see the shape of the set.
        </div>
      ) : (
      <>
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `max(100%, ${width}px)`, height: 'auto', display: 'block' }}
          className="select-none"
          aria-label={metric === 'energy'
            ? 'Catalogue energy score (0 to 1) across the set, with the target peak zone marked'
            : 'Tempo in BPM across the set, with the target peak zone marked'}
        >
          {/* Target peak zone: the arc model's 65-85% peak target (see energyArc.js) */}
          <rect
            x={peakX}
            y={padTop}
            width={peakWidth}
            height={innerHeight}
            fill="rgba(214, 252, 85, 0.05)"
            stroke="rgba(214, 252, 85, 0.2)"
            strokeDasharray="3 3"
            rx="4"
          />
          {/* Caption sits in the reserved band above the plot, clear of node labels */}
          <text
            x={peakX + peakWidth / 2}
            y={padTop - 6}
            fill="#D6FC55"
            fontSize="9"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
            letterSpacing="0.05em"
          >
            TARGET PEAK
          </text>

          {/* Gridlines & Y-Axis Labels - labelled in the selected metric's units */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + 4} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {yLabels.top}
          </text>

          <line x1={padLeft} y1={padTop + innerHeight / 2} x2={width - padRight} y2={padTop + innerHeight / 2} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + innerHeight / 2 + 3} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {yLabels.mid}
          </text>

          <line x1={padLeft} y1={padTop + innerHeight} x2={width - padRight} y2={padTop + innerHeight} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + innerHeight + 3} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {yLabels.bottom}
          </text>

          {/* Connected segments (with truthful gaps when data is missing) */}
          {segments.map((seg, sIdx) => {
            const linePath = seg.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
            return (
              <path
                key={sIdx}
                d={linePath}
                fill="none"
                stroke="#D6FC55"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Track Nodes */}
          {points.map((p, i) => {
            const trans = evaluation.transitions[i];
            const nodeStroke = trans?.grade === 'CLASH' ? '#EF4444' :
                               trans?.grade === 'STRETCH' ? '#EAB308' :
                               trans?.grade === 'UNVERIFIED' ? '#7E8876' : '#D6FC55';

            if (p.hasValue && p.track.tempoNeedsReview) {
              // Unconfirmed octave suggestion: amber dashed ring, never a trusted point.
              // Label matches the normal node placement so dense sets stay legible;
              // the legend explains the ring.
              const reviewLabelY = p.y - 9 >= padTop + 6 ? p.y - 9 : p.y + 17;
              return (
                <g key={i} className="cursor-pointer" onClick={() => onSelectTrack && onSelectTrack(p.track)}>
                  <circle cx={p.x} cy={p.y} r="5" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 2" />
                  <text x={p.x} y={reviewLabelY} fill="#F59E0B" fontSize="9" fontFamily="JetBrains Mono" textAnchor="middle" fontWeight="bold">
                    {p.track.camelot || ''}
                  </text>
                  <text x={p.x} y={height - 8} fill="#7E8876" fontSize="8" fontFamily="JetBrains Mono" textAnchor="middle">
                    {i + 1}
                  </text>
                </g>
              );
            }

            if (!p.hasValue) {
              // No value for this view: neutral dashed marker below the plot baseline
              // (never on a data line, never an invented value).
              return (
                <g key={i} className="cursor-pointer" onClick={() => onSelectTrack && onSelectTrack(p.track)}>
                  <circle
                    cx={p.x}
                    cy={padTop + innerHeight + 9}
                    r="3.5"
                    fill="none"
                    stroke="#7E8876"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                  <text
                    x={p.x}
                    y={padTop + innerHeight + 24}
                    fill="#7E8876"
                    fontSize="8"
                    fontFamily="JetBrains Mono"
                    textAnchor="middle"
                  >
                    ?
                  </text>
                </g>
              );
            }

            // Labels sit above the node, or below it when the node reaches the
            // reserved caption band at the top of the plot.
            const labelY = p.y - 9 >= padTop + 6 ? p.y - 9 : p.y + 17;

            return (
              <g
                key={i}
                className="cursor-pointer group"
                tabIndex={0}
                role="button"
                aria-label={`Track ${i + 1}: ${p.track.title}, ${p.track.bpm} BPM, key ${p.track.camelot || 'unknown'}`}
                onClick={() => onSelectTrack && onSelectTrack(p.track)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectTrack && onSelectTrack(p.track);
                  }
                }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="4"
                  fill="#10120F"
                  stroke={nodeStroke}
                  strokeWidth="2"
                />
                <text
                  x={p.x}
                  y={labelY}
                  fill="#BAC2B3"
                  fontSize="9"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {p.track.camelot || ''}
                </text>
                <text
                  x={p.x}
                  y={height - 8}
                  fill="#7E8876"
                  fontSize="8"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend: what the band, units and markers actually mean */}
      <div className="space-y-1 text-[10px] font-mono text-[#7E8876] leading-relaxed">
        <p>
          Shaded band: target peak zone ({Math.round(PEAK_ZONE_START * 100)}-{Math.round(PEAK_ZONE_END * 100)}% through the set) -
          the sequencer nudges faster tracks toward it and slower tracks out of it.
        </p>
        <p>
          {metric === 'energy'
            ? 'Energy score (0-1) comes from the metadata catalogue; tracks without one are skipped and manual BPM/key entries do not add one. '
            : ''}
          Ring colour grades the transition into the next track: green smooth, amber stretch, red clash, grey unverified.
          A dashed amber ring flags a tempo that still needs review; a dashed marker below the line means no value for this view.
        </p>
      </div>

      {/* Axis Footer */}
      <div className="flex items-center justify-between text-[11px] text-[#7E8876] font-mono pt-1 border-t border-[#394133]">
        <span>Track 01</span>
        <span>Order Axis →</span>
        <span>Track {tracks.length.toString().padStart(2, '0')}</span>
      </div>
      </>
      )}
    </section>
  );
}
