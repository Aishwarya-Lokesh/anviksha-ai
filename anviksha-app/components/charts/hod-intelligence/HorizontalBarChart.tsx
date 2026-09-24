"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { SEVERITY_HEX, Severity } from "./severity";

export interface HorizontalBarDatum {
  label: string;
  value: number;
  severity: Severity;
}

/**
 * The one genuinely new chart type Part D2 calls for that Charts.tsx didn't
 * already have: a ranked horizontal bar, used only for pass-rate outliers.
 * Still Recharts (layout="vertical" swaps the bar direction) — no new
 * charting library.
 */
export function HorizontalBarChart({ data, referenceLabel, referenceValue }: { data: HorizontalBarDatum[]; referenceLabel?: string; referenceValue?: number }) {
  const height = Math.max(160, data.length * 46);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 12, fill: "#12141F" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #F0F0F5", fontSize: 13 }}
          formatter={(value: any) => [`${value}%`, referenceLabel ? `Pass rate (dept avg ${referenceValue}%)` : "Pass rate"]}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={800}>
          {data.map((d, i) => <Cell key={i} fill={SEVERITY_HEX[d.severity]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
