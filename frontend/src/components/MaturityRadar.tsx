"use client";

import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { BRAND } from "@/lib/colors";
import type { Results } from "@/lib/types";

export default function MaturityRadar({ results }: { results: Results }) {
  const { min, max } = results.framework.scale;
  const data = results.domains.map((d) => ({
    domain: d.name,
    Current: d.current ?? min,
    Target: d.target,
  }));
  return (
    <div className="h-[340px] w-full" data-testid="radar-chart">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="62%" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <PolarGrid stroke={BRAND.line} />
          <PolarAngleAxis dataKey="domain" tick={{ fill: "#1D1D1F", fontSize: 11 }}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
          <PolarRadiusAxis domain={[min, max]} tickCount={Math.min(6, max - min + 1)} angle={90}
            tick={{ fill: BRAND.muted, fontSize: 10 }} axisLine={false} />
          <Radar name="Target" dataKey="Target" stroke={BRAND.black} strokeWidth={2} strokeDasharray="5 4"
            fill="transparent" dot={false} isAnimationActive={false} />
          <Radar name="Current" dataKey="Current" stroke={BRAND.green6} strokeWidth={2} fill={BRAND.green}
            fillOpacity={0.35} dot={{ r: 4, fill: BRAND.green6, stroke: "#fff", strokeWidth: 2 }} />
          <Tooltip
            formatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            contentStyle={{ borderRadius: 12, border: `1px solid ${BRAND.line}`, fontSize: 13 }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: "#1D1D1F" }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
