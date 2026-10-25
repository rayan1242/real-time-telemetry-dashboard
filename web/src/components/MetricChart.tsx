import type { Metric, Robot } from "../telemetry";
import { timeLabel } from "../telemetry";

export default function MetricChart({ points, metric }: { points: Robot[]; metric: Metric }) {
  const values = points.map(point => point[metric]);
  if (!values.length) return <div className="chart-empty">No historical readings yet.</div>;

  const width = 720;
  const height = 220;
  const left = 44;
  const right = 14;
  const top = 18;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minimum = metric === "battery" ? 0 : Math.floor(Math.min(...values) - 2);
  const maximum = metric === "battery" ? 100 : Math.ceil(Math.max(...values) + 2);
  const span = Math.max(1, maximum - minimum);
  const x = (index: number) => left + (values.length === 1 ? plotWidth / 2 : index * plotWidth / (values.length - 1));
  const y = (value: number) => top + (maximum - value) / span * plotHeight;
  const coordinates = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const fillPath = `M ${x(0)} ${y(values[0])} ${values.slice(1).map((value, index) => `L ${x(index + 1)} ${y(value)}`).join(" ")} L ${x(values.length - 1)} ${top + plotHeight} L ${x(0)} ${top + plotHeight} Z`;
  const ticks = [0, 0.5, 1];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} over the last ${points.length} readings`}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={metric === "temperature" ? "#60e0c1" : "#81a9ff"} stopOpacity=".3" />
            <stop offset="100%" stopColor={metric === "temperature" ? "#60e0c1" : "#81a9ff"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map(tick => {
          const value = minimum + tick * span;
          const position = y(value);
          return <g key={tick}>
            <line x1={left} x2={width - right} y1={position} y2={position} stroke="#30435a" strokeDasharray="4 5" />
            <text x={left - 9} y={position + 4} fill="#a6b6ce" textAnchor="end" fontSize="12">{value.toFixed(0)}</text>
          </g>;
        })}
        <path d={fillPath} fill={`url(#fill-${metric})`} />
        <polyline points={coordinates} fill="none" stroke={metric === "temperature" ? "#60e0c1" : "#81a9ff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="4" fill={metric === "temperature" ? "#60e0c1" : "#81a9ff"} />
        <text x={left} y={height - 7} fill="#a6b6ce" fontSize="12">{timeLabel(points[0].timestamp)}</text>
        <text x={width - right} y={height - 7} fill="#a6b6ce" fontSize="12" textAnchor="end">{timeLabel(points[points.length - 1].timestamp)}</text>
      </svg>
    </div>
  );
}

