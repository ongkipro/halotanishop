import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";

/**
 * The dashboard's revenue chart, its own module so `AnalyticsDashboard`
 * loads it lazily: Recharts is the admin's largest chunk (330 KB, 97 KB
 * gzipped), and the KPI cards and "Action needed" used to wait for it.
 */
export default function DashboardRevenueChart({
  data,
  hourly,
  compareLabel,
  formatValue,
}: {
  data: Array<{ date: string; revenue: number | null; compare?: number | null }>;
  hourly: boolean;
  /** The comparison line's legend label; absent when nothing is compared. */
  compareLabel?: string;
  formatValue: (value: number) => string;
}) {
  return (
    <ChartContainer
      config={{
        revenue: { label: "Periode ini", color: "var(--admin-accent)" },
        compare: { label: compareLabel ?? "Pembanding", color: "#94a3b8" },
      }}
      className="h-full w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => {
              const text = String(value);
              if (text.includes(":")) return text.split(" ")[1].substring(0, 2);
              const [year, month, day] = text.slice(0, 10).split("-");
              return year && month && day ? `${Number(day)}/${Number(month)}` : text;
            }}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#64748b" }}
            dy={8}
            minTickGap={8}
          />
          {/* 72px: "Rp1,4jt" and "Rp700rb" clipped at Recharts' default 60. */}
          <YAxis width={72} tickFormatter={(value) => formatValue(Number(value))} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#64748b" }} />
          <ChartTooltip cursor={{ fill: "rgba(148,163,184,0.06)" }} content={<ChartTooltipContent />} />
          {hourly ? (
            <Line dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2.5} dot={false} connectNulls={false} />
          ) : (
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[5, 5, 0, 0]} maxBarSize={34} />
          )}
          {compareLabel && <Line dataKey="compare" type="monotone" stroke="var(--color-compare)" strokeWidth={2} strokeDasharray="5 4" dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
