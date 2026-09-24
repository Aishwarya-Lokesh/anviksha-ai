"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend, LabelList,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

const COLORS = ["#5B3FD9", "#3B82F6", "#1F9D55", "#E8A93B", "#E5484D", "#9b8afb"];

export function TrendLineChart({
  data,
  lines,
  xKey = "label",
  highlightExtremes = true,
}: {
  data: any[];
  lines: { key: string; color?: string }[];
  xKey?: string;
  highlightExtremes?: boolean;
}) {
  // Real callouts, computed from the actual data passed in — never hardcoded:
  // marks the real highest and lowest point of the first line so the trend
  // is obvious at a glance instead of requiring the viewer to scan values.
  const primaryKey = lines[0]?.key;
  const values = primaryKey ? data.map((d) => d[primaryKey]).filter((v) => v != null) : [];
  const maxVal = values.length ? Math.max(...values) : null;
  const minVal = values.length ? Math.min(...values) : null;

  const makeDot = (color: string) => (props: any) => {
    const { cx, cy, value, index } = props;
    if (highlightExtremes && value === maxVal && value !== minVal) {
      return (
        <g key={`dot-max-${index}`}>
          <circle cx={cx} cy={cy} r={6} fill="#1F9D55" stroke="#fff" strokeWidth={2} />
          <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1F9D55">{value}</text>
        </g>
      );
    }
    if (highlightExtremes && value === minVal && value !== maxVal) {
      return (
        <g key={`dot-min-${index}`}>
          <circle cx={cx} cy={cy} r={6} fill="#E5484D" stroke="#fff" strokeWidth={2} />
          <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontWeight={700} fill="#E5484D">{value}</text>
        </g>
      );
    }
    return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={color} />;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 24, right: 16, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #F0F0F5", boxShadow: "0 8px 24px rgba(15,18,41,0.12)", fontSize: 13 }}
        />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l, i) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            stroke={l.color || COLORS[i % COLORS.length]}
            strokeWidth={2.5}
            dot={i === 0 ? makeDot(l.color || COLORS[i % COLORS.length]) : { r: 3 }}
            activeDot={{ r: 6 }}
            isAnimationActive
            animationDuration={1000}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StudentRadarChart({
  data,
}: {
  data: { metric: string; value: number; fullMark: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="75%">
        <PolarGrid stroke="#E5E7EB" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#6B7280" }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: "#9CA3AF" }} />
        <Radar dataKey="value" stroke="#5B3FD9" fill="#5B3FD9" fillOpacity={0.35} isAnimationActive animationDuration={900} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #F0F0F5", fontSize: 13 }} formatter={(v: any, n: any, p: any) => [`${v} / 100`, p.payload.metric]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color?: string }[];
  centerLabel?: string;
  centerValue?: string | number;
}) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color || COLORS[i % COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #F0F0F5", fontSize: 13 }} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: -8 }}>
          <div className="text-2xl font-extrabold font-display text-ink">{centerValue}</div>
          {centerLabel && <div className="text-xs text-muted">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}

export function SimpleBarChart({
  data, xKey = "label", barKey = "value", color = "#5B3FD9",
  xLabel, yLabel, valueSuffix = "", showValues = false,
}: any) {
  const manyBars = data.length > 6;
  return (
    <ResponsiveContainer width="100%" height={manyBars ? 300 : 240}>
      <BarChart data={data} margin={{ top: showValues ? 22 : 10, right: 10, left: yLabel ? 6 : -20, bottom: manyBars ? 70 : xLabel ? 22 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: "#6B7280" }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={manyBars ? -40 : 0}
          textAnchor={manyBars ? "end" : "middle"}
          height={manyBars ? 80 : 30}
          label={xLabel ? { value: xLabel, position: "insideBottom", offset: -14, style: { fontSize: 11, fill: "#6B7280" } } : undefined}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#6B7280" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6B7280", textAnchor: "middle" } } : undefined}
        />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #F0F0F5", fontSize: 13 }}
          formatter={(value: any) => [`${value}${valueSuffix}`, yLabel || barKey]}
        />
        <Bar dataKey={barKey} fill={color} radius={[6, 6, 0, 0]} isAnimationActive animationDuration={800}>
          {showValues && (
            <LabelList
              dataKey={barKey}
              position="top"
              style={{ fontSize: 11, fill: "#111827", fontWeight: 600 }}
              formatter={(v: any) => `${v}${valueSuffix}`}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { COLORS };
