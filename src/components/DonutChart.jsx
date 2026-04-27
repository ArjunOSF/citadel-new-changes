import React from "react";

/**
 * A simple SVG donut chart that renders two slices:
 *   - completed  (green)
 *   - notCompleted (grey/yellow)
 *
 * Props:
 *   - completed:     number
 *   - notCompleted:  number
 *   - size:          px (default 180)
 *   - stroke:        px (default 22)
 */
export default function DonutChart({ completed = 0, notCompleted = 0, size = 180, stroke = 22 }) {
  const total = completed + notCompleted;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? completed / total : 0;
  const dash = pct * circumference;
  const rest = circumference - dash;

  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* full ring = not-completed slice (shown as base) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#f1c453"
          strokeWidth={stroke}
        />
        {/* completed arc overlays the base */}
        {total > 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#2fb47c"
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${rest}`}
            strokeDashoffset={circumference / 4}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: "stroke-dasharray 400ms ease" }}
          />
        ) : null}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="donut-center-pct"
        >
          {total > 0 ? `${Math.round(pct * 100)}%` : "—"}
        </text>
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          className="donut-center-lbl"
        >
          Complete
        </text>
      </svg>
      <div className="donut-legend">
        <div className="legend-row">
          <span className="legend-swatch" style={{ background: "#2fb47c" }} />
          <span>Completed</span>
          <span className="legend-val">{completed}</span>
        </div>
        <div className="legend-row">
          <span className="legend-swatch" style={{ background: "#f1c453" }} />
          <span>Not completed</span>
          <span className="legend-val">{notCompleted}</span>
        </div>
      </div>
    </div>
  );
}
