import React from 'react';
import { Activity, Flame, ShieldAlert, Zap } from 'lucide-react';

export function HarmonicArcVisualizer({ tracks, evaluation }) {
  if (!tracks || tracks.length < 2 || !evaluation || !evaluation.transitions) {
    return null;
  }

  const bpms = tracks.map(t => t.bpm || 124);
  const minBpm = Math.min(...bpms);
  const maxBpm = Math.max(...bpms);
  const bpmRange = Math.max(6, maxBpm - minBpm);

  // SVG dimensions
  const width = 800;
  const height = 110;
  const padX = 35;
  const padY = 22;

  const points = tracks.map((t, idx) => {
    const x = padX + (idx / (tracks.length - 1)) * (width - 2 * padX);
    const bpm = t.bpm || minBpm;
    // Invert Y so higher BPM is higher on chart
    const y = height - padY - ((bpm - minBpm) / bpmRange) * (height - 2 * padY);
    return { x, y, track: t, bpm };
  });

  // Construct SVG path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - 8} L ${points[0].x.toFixed(1)} ${height - 8} Z`;

  // Peak zone boundary (60% to 80%)
  const peakStartX = padX + 0.60 * (width - 2 * padX);
  const peakEndX = padX + 0.80 * (width - 2 * padX);

  return (
    <div className="deck-card p-4 sm:p-5 mb-6 bg-gradient-to-b from-[#111420] to-[#0d0f18] border-[#1e2336]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-2 border-b border-[#1b2030] gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Set Progression Arc: Tempo & Harmonic Trajectory
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-400">
            Span: <strong className="text-slate-200 tabular-nums">{minBpm.toFixed(1)} → {maxBpm.toFixed(1)} BPM</strong>
          </span>
          <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded text-[11px] font-bold">
            {evaluation.smoothPct}% Smooth
          </span>
        </div>
      </div>

      {/* Responsive SVG Container */}
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-24 sm:h-28 overflow-visible select-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="tempoAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="peakGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Peak Zone Shading (60% to 80%) */}
          <rect
            x={peakStartX}
            y={8}
            width={peakEndX - peakStartX}
            height={height - 16}
            fill="url(#peakGradient)"
            rx="4"
          />
          <text
            x={(peakStartX + peakEndX) / 2}
            y={18}
            fill="#fbbf24"
            fontSize="9"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
            fontWeight="bold"
            letterSpacing="0.05em"
          >
            PEAK ZONE (60–80%)
          </text>

          {/* Baseline gridlines */}
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#1f2438" strokeDasharray="3 3" />
          <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="#1f2438" strokeDasharray="3 3" />

          {/* Area fill */}
          <path d={areaPath} fill="url(#tempoAreaGradient)" />

          {/* Tempo line */}
          <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Transition connecting lines and Nodes */}
          {points.map((p, i) => {
            const nextP = points[i + 1];
            const trans = evaluation.transitions[i];

            return (
              <g key={i}>
                {/* Track Node circle */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="5"
                  fill="#0b0d14"
                  stroke={
                    trans?.grade === 'CLASH' ? '#f43f5e' :
                    trans?.grade === 'STRETCH' ? '#f59e0b' : '#10b981'
                  }
                  strokeWidth="2.5"
                />

                {/* Camelot Badge label */}
                <text
                  x={p.x}
                  y={p.y - 8}
                  fill="#94a3b8"
                  fontSize="9"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {p.track.camelot || '?'}
                </text>

                {/* BPM label underneath */}
                <text
                  x={p.x}
                  y={height - 2}
                  fill="#64748b"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                >
                  {p.bpm.toFixed(0)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-[#171b29] font-mono">
        <span>01 Warm-up Opener</span>
        <span className="text-amber-400/90 font-medium">Build & Peak Climax</span>
        <span>Resolution Outro {tracks.length.toString().padStart(2, '0')}</span>
      </div>
    </div>
  );
}
