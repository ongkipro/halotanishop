import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import { insightsMoney, insightsNumber } from '../../lib/insights-view';

export default function InsightsChart({ series, metric }: {
  series: Array<{ date: string; orders: number; leads: number; revenue: number }>;
  metric: 'orders' | 'leads' | 'revenue';
}) {
  const label = { orders: 'Pesanan', leads: 'Lead', revenue: 'Omset' }[metric];
  return <ChartContainer config={{ [metric]: { label, color: 'var(--chart-1)' } }} className="h-64 w-full">
    <LineChart data={series} accessibilityLayer>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} minTickGap={30} />
      <YAxis width={65} domain={[0, 'auto']} tickFormatter={(value: number) => metric === 'revenue' ? new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(value) : insightsNumber(value)} />
      <ChartTooltip content={<ChartTooltipContent formatter={(value) => metric === 'revenue' ? insightsMoney(Number(value)) : insightsNumber(Number(value))} />} />
      <Line dataKey={metric} name={label} type="linear" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
    </LineChart>
  </ChartContainer>;
}
