import React, { useState } from 'react';
import { Sliders } from 'lucide-react';

export function HarmonicArcVisualizer({ tracks, evaluation, onSelectTrack }) {
  const [metric, setMetric] = useState('tempo'); // 'tempo' | 'energy'

  if (!tracks || tracks.length < 2 || !evaluation || !evaluation.transitions) {
    return null;
  }

  // Check if energy data actually exists
  const hasEnergyData = tracks.some(t => typeof t.energy === 'number' && !isNaN(t.energy));

  // Extract valid BPMs
  const validBpms = tracks.map(t => t.bpm).filter(b => typeof b === 'number' && !isNaN(b));
  const minBpm = validBpms.length > 0 ? Math.min(...validBpms) : 120;
  const maxBpm = validBpms.length > 0 ? Math.max(...validBpms) : 130;
  const bpmRange = Math.max(6, maxBpm - minBpm);

  // SVG coordinates
  const width = 800;
  const height = 140;
  const padLeft = 50;
  const padRight = 30;
  const padTop = 24;
  const padBottom = 28;

  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  // Build points with truthful gaps
  const points = tracks.map((t, idx) => {
    const x = padLeft + (idx / (tracks.length - 1)) * innerWidth;
    const val = metric === 'energy' ? t.energy : t.bpm;
    const hasValue = typeof val === 'number' && !isNaN(val);

    let y = null;
    if (hasValue) {
      if (metric === 'energy') {
        // Energy scaled 0 to 1
        y = padTop + (1 - val) * innerHeight;
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
            Tempo is one part of the story. Listen for phrasing, vocals and room to mix.
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

      {/* Responsive Visualizer SVG */}
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-32 select-none"
          preserveAspectRatio="none"
          aria-label="Set tempo and key progression chart"
        >
          {/* Target Zone Shading: Target peak zone (60-80% of set) */}
          <rect
            x={padLeft + 0.60 * innerWidth}
            y={padTop}
            width={0.20 * innerWidth}
            height={innerHeight}
            fill="rgba(214, 252, 85, 0.05)"
            stroke="rgba(214, 252, 85, 0.2)"
            strokeDasharray="3 3"
            rx="4"
          />
          <text
            x={padLeft + 0.70 * innerWidth}
            y={padTop + 14}
            fill="#D6FC55"
            fontSize="9"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
            letterSpacing="0.05em"
          >
            TARGET PEAK
          </text>

          {/* Gridlines & Y-Axis Labels */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + 4} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {maxBpm.toFixed(0)}
          </text>

          <line x1={padLeft} y1={padTop + innerHeight / 2} x2={width - padRight} y2={padTop + innerHeight / 2} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + innerHeight / 2 + 3} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {((maxBpm + minBpm) / 2).toFixed(0)}
          </text>

          <line x1={padLeft} y1={padTop + innerHeight} x2={width - padRight} y2={padTop + innerHeight} stroke="#252B22" strokeDasharray="2 2" />
          <text x={padLeft - 8} y={padTop + innerHeight + 3} fill="#7E8876" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
            {minBpm.toFixed(0)}
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
                               trans?.grade === 'STRETCH' ? '#EAB308' : '#D6FC55';

            if (!p.hasValue) {
              // Missing value indicated as gap marker at baseline
              return (
                <g key={i} className="cursor-pointer" onClick={() => onSelectTrack && onSelectTrack(p.track)}>
                  <circle
                    cx={p.x}
                    cy={padTop + innerHeight}
                    r="3"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                  <text
                    x={p.x}
                    y={padTop + innerHeight + 14}
                    fill="#EF4444"
                    fontSize="8"
                    fontFamily="JetBrains Mono"
                    textAnchor="middle"
                  >
                    ?
                  </text>
                </g>
              );
            }

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
                  y={p.y - 7}
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
                  y={height - 6}
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

      {/* Axis Footer */}
      <div className="flex items-center justify-between text-[11px] text-[#7E8876] font-mono pt-1 border-t border-[#394133]">
        <span>Track 01</span>
        <span>Order Axis →</span>
        <span>Track {tracks.length.toString().padStart(2, '0')}</span>
      </div>
    </section>
  );
}
