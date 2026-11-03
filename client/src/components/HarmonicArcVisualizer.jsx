import React from 'react';
import { Activity, Flame, Zap } from 'lucide-react';

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
  const height = 120;
  const padX = 40;
  const padY = 24;

  const points = tracks.map((t, idx) => {
    const x = padX + (idx / (tracks.length - 1)) * (width - 2 * padX);
    const bpm = t.bpm || minBpm;
    const y = height - padY - ((bpm - minBpm) / bpmRange) * (height - 2 * padY);
    return { x, y, track: t, bpm };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - 10} L ${points[0].x.toFixed(1)} ${height - 10} Z`;

  // Peak zone boundary (60% to 80%)
  const peakStartX = padX + 0.60 * (width - 2 * padX);
  const peakEndX = padX + 0.80 * (width - 2 * padX);

  return (
    <section className="deck-card p-4 sm:p-5 mb-6 bg-gradient-to-b from-[#0f121c] to-[#0a0c13] border-[#1d2235] shadow-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-2 border-b border-[#181d2c] gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-100 font-mono">
              The Mathematical Trajectory of Human Euphoria
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 italic">
            "A strictly controlled tempo arc designed to peak when someone buys a round of drinks."
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-slate-400">
            Tempo Ramp: <strong className="text-slate-200 tabular-nums">{minBpm.toFixed(1)} → {maxBpm.toFixed(1)} BPM</strong>
          </span>
          <span className="text-emerald-300 bg-emerald-950/70 border border-emerald-700/60 px-2 py-0.5 rounded text-[11px] font-bold">
            {evaluation.smoothPct}% Butter
          </span>
        </div>
      </div>

      {/* Illuminated CDJ-style Waveform Area */}
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-28 sm:h-32 overflow-visible select-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="tempoAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="peakGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Peak Zone Shading */}
          <rect
            x={peakStartX}
            y={8}
            width={peakEndX - peakStartX}
            height={height - 20}
            fill="url(#peakGradient)"
            rx="6"
            stroke="rgba(245, 158, 11, 0.3)"
            strokeDasharray="4 3"
          />
          <text
            x={(peakStartX + peakEndX) / 2}
            y={20}
            fill="#fbbf24"
            fontSize="9"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
            fontWeight="bold"
            letterSpacing="0.06em"
          >
            PEAK DROPS ZONE (60–80%)
          </text>

          {/* Gridlines */}
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#1b2033" strokeDasharray="3 3" />
          <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="#1b2033" strokeDasharray="3 3" />

          {/* Area fill */}
          <path d={areaPath} fill="url(#tempoAreaGradient)" />

          {/* Glowing Tempo Line */}
          <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Camelot Nodes */}
          {points.map((p, i) => {
            const trans = evaluation.transitions[i];
            const nodeColor = trans?.grade === 'CLASH' ? '#f43f5e' :
                              trans?.grade === 'STRETCH' ? '#f59e0b' : '#10b981';

            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="5"
                  fill="#080a10"
                  stroke={nodeColor}
                  strokeWidth="2.5"
                />
                <text
                  x={p.x}
                  y={p.y - 8}
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {p.track.camelot || '?'}
                </text>
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

      {/* Satirical Arc Timeline Milestones */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-[#151928] font-mono">
        <span>01 Polite Head Nodding</span>
        <span className="text-amber-400/90 font-medium hidden sm:inline">The Hands-In-The-Air Phase</span>
        <span>Looking For Coat {tracks.length.toString().padStart(2, '0')}</span>
      </div>
    </section>
  );
}
