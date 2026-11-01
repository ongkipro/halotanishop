import { useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChevronRight, CircleCheck, CreditCard, GitCompareArrows, PackageCheck, RefreshCw } from "lucide-react";
import { FilterSelect } from "./filter-bar";
import { ADMIN_DEFAULT_DATE_FILTER, resolveAdminDateSelection } from "../../lib/admin-date-filter";
import { AdminDateRangeFilter, type AdminDateSelection } from "./AdminDateRangeFilter";

/**
 * The dashboard (layout by Paduka, 2026-11-01): the period and its comparison
 * sit in one toolbar; six KPI cards; the revenue chart with the comparison
 * drawn inside it beside a compact "Action needed" list, so the chart is on
 * the first screen; then the funnel, the payment mix and the top lists.
 * Metric names are English (Revenue, AOV, Conversion rate, Funnel); the
 * sentences around them stay Indonesian.
 *
 * The dashboard charts every day in the period and aggregates across it, so
 * it reports on a shorter window than the order lists and hides the presets
 * that would exceed it.
 */
const DASHBOARD_MAX_RANGE_DAYS = 31;
const DASHBOARD_HIDDEN_PRESETS = ["90d", "180d"] as const;
const ATTENTION_REFRESH_MS = 60_000;

type CompareMode = "previous" | "week" | "month";
type CompareChoice = "auto" | CompareMode;
const COMPARE_LABELS: Record<CompareChoice, string> = {
  auto: "Compare: otomatis",
  week: "vs same day last week",
  month: "vs same dates last month",
  previous: "vs previous period",
};

type Trend = { date: string; revenue: number; orders: number };
type AnalyticsData = {
  total_revenue: number;
  collected_revenue: number;
  cod_revenue: number;
  prepaid_revenue: number;
  total_orders: number;
  live_orders: number;
  online_orders: number;
  average_order_value: number;
  lead_conversion_rate: number;
  lead_base: number;
  conversion_rate: number;
  rts_rate: number;
  rts_base: number;
  payment_methods: {
    total: number;
    cod: PaymentMethodBucket;
    manual_transfer: PaymentMethodBucket;
    virtual_account: PaymentMethodBucket;
    qris: PaymentMethodBucket;
    unknown_count: number;
  };
  period: { start_date: string | null; end_date: string | null; interval: "hour" | "day" };
  trends: Trend[];
  funnel: { leads: number; orders: number; handed_over: number; delivered: number; returned: number };
  previous: {
    mode: CompareMode;
    start_date: string;
    end_date: string;
    partial: boolean;
    total_revenue: number;
    live_orders: number;
    average_order_value: number;
    lead_conversion_rate: number;
    lead_base: number;
    conversion_rate: number;
    online_orders: number;
    rts_rate: number;
    rts_base: number;
    trends: Trend[];
  } | null;
};

/** The counts read from a bounded row set; the other two are whole-table sums. */
const CAPPED_KEYS = new Set(["confirm", "ready_push", "push_problem", "needs_waybill", "needs_pickup", "needs_drop_off"]);
type AttentionItem = { key: string; label: string; hint: string; count: number; stale?: number; href: string; tone: "info" | "warn" | "bad" };
type RankingRow = { label: string; revenue: number; orders?: number; units?: number };
type PaymentMethodBucket = { count: number; percentage: number };

const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format;
/** Axis ticks: "Rp1,2jt", "Rp450rb", "Rp0" — never five identical labels. */
const compactRupiah = (value: number) => {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `Rp${m.toLocaleString("id-ID", { maximumFractionDigits: m < 10 ? 1 : 0 })}jt`;
  }
  if (value >= 1_000) return `Rp${Math.round(value / 1_000)}rb`;
  return `Rp${Math.round(value)}`;
};
/** Phone size for a KPI value by length: 13 characters ("Rp 12.345.678") at 16px is the most a 360px half-width card holds. */
const kpiValueSize = (value: string) => (value.length <= 13 ? "text-base" : value.length <= 14 ? "text-sm" : "text-xs");
const percentage = (value: number) => `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const dmy = (value: string) => value.split("-").reverse().join("/");
const num = (value: unknown) => Number(value) || 0;

/**
 * The change against the comparison. Money and counts move in percent; a
 * rate already is one, so it moves in points. Nothing when there is no
 * comparison or it was empty (a percentage of zero is not actionable).
 */
function Delta({ current, previous, kind, invert = false }: { current: number; previous: number | undefined; kind: "percent" | "points"; invert?: boolean }) {
  // Every card carries a chip, so the row reads the same whatever the data:
  // a change, "baru" when the comparison was empty and this period is not, or
  // a muted dash when neither has anything to compare.
  if (previous === undefined || (kind === "percent" && previous <= 0)) {
    if (kind === "percent" && previous !== undefined && current > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700" title="Pembanding kosong; periode ini sudah ada isinya">
          <span aria-hidden="true">▲</span>baru
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-400" title="Belum ada data pembanding">
        —<span className="sr-only">Belum ada data pembanding</span>
      </span>
    );
  }
  const change = kind === "percent" ? ((current - previous) / previous) * 100 : current - previous;
  const rounded = Math.round(change * 10) / 10;
  if (!Number.isFinite(rounded)) return null;
  const good = invert ? rounded < 0 : rounded > 0;
  const tone = rounded === 0 ? "text-slate-500 bg-slate-100" : good ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  const sign = rounded > 0 ? "▲" : rounded < 0 ? "▼" : "•";
  const value = `${Math.abs(rounded).toLocaleString("id-ID", { maximumFractionDigits: 1 })}${kind === "percent" ? "%" : " pt"}`;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      <span aria-hidden="true">{sign}</span>
      {value}
      <span className="sr-only">{rounded > 0 ? "naik" : rounded < 0 ? "turun" : "tetap"} dibanding pembanding</span>
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-label="Memuat dashboard" aria-busy="true">
      <Skeleton className="h-11 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function AnalyticsDashboard({
  showPaymentsLink = false,
  showAttention = false,
  showInsights = false,
}: {
  showPaymentsLink?: boolean;
  /** Roles that work the order list see "Action needed" (its endpoint is theirs). */
  showAttention?: boolean;
  /** Roles that may read the Analitik menu see its top products and pages. */
  showInsights?: boolean;
}) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [dateSelection, setDateSelection] = useState<AdminDateSelection>({ filter: ADMIN_DEFAULT_DATE_FILTER, start: "", end: "" });
  const [compare, setCompare] = useState<CompareChoice>("auto");
  const [attention, setAttention] = useState<{ items: AttentionItem[]; capped: boolean; at: number } | null>(null);
  const [attentionError, setAttentionError] = useState("");
  const [rankings, setRankings] = useState<{ products: RankingRow[]; pages: RankingRow[] } | null>(null);
  const [, setTick] = useState(0);
  const requestSequence = useRef(0);

  const loadAnalytics = useCallback(
    async (selection: AdminDateSelection, compareChoice: CompareChoice, showLoading = false) => {
      const sequence = ++requestSequence.current;
      if (showLoading) setLoading(true);
      else setRefreshing(true);
      setError("");
      // One resolver for every period, named or explicit. A period this
      // surface cannot answer for is reported, not quietly swapped (REQ-157).
      const resolved = resolveAdminDateSelection(selection.filter, {
        customRange: { start: selection.start, end: selection.end },
        maxCustomRangeDays: DASHBOARD_MAX_RANGE_DAYS,
      });
      if (!resolved.ok) {
        setError(resolved.reason);
        if (showLoading) setLoading(false);
        else setRefreshing(false);
        return;
      }
      const { start, end, interval } = resolved;
      const query = new URLSearchParams({ preset: selection.filter });
      if (start && end) {
        query.set("startDate", start);
        query.set("endDate", end);
        query.set("interval", interval);
      }
      if (compareChoice !== "auto") query.set("compare", compareChoice);

      try {
        const response = await fetch(`/api/admin/analytics?${query}`, { headers: { Accept: "application/json" } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || "Dashboard gagal dimuat.");
        if (sequence !== requestSequence.current) return;
        const source = payload.data ?? {};
        const payments = source.payment_methods ?? {};
        const bucket = (value: unknown): PaymentMethodBucket => {
          const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
          return { count: num(item.count), percentage: num(item.percentage) };
        };
        const trends = (value: unknown): Trend[] =>
          Array.isArray(value) ? value.map((row: Record<string, unknown>) => ({ date: String(row.date), revenue: num(row.revenue), orders: num(row.orders) })) : [];
        const before = source.previous && typeof source.previous === "object" ? source.previous : null;
        setData({
          total_revenue: num(source.total_revenue),
          collected_revenue: num(source.collected_revenue),
          cod_revenue: num(source.cod_revenue),
          prepaid_revenue: num(source.prepaid_revenue),
          total_orders: num(source.total_orders),
          live_orders: num(source.live_orders),
          online_orders: num(source.online_orders),
          average_order_value: num(source.average_order_value),
          lead_conversion_rate: num(source.lead_conversion_rate),
          lead_base: num(source.lead_base),
          conversion_rate: num(source.conversion_rate),
          rts_rate: num(source.rts_rate),
          rts_base: num(source.rts_base),
          payment_methods: {
            total: num(payments.total),
            cod: bucket(payments.cod),
            manual_transfer: bucket(payments.manual_transfer),
            virtual_account: bucket(payments.virtual_account),
            qris: bucket(payments.qris),
            unknown_count: num(payments.unknown_count),
          },
          period: {
            start_date: typeof source.period?.start_date === "string" ? source.period.start_date : null,
            end_date: typeof source.period?.end_date === "string" ? source.period.end_date : null,
            interval: source.period?.interval === "hour" ? "hour" : "day",
          },
          trends: trends(source.trends),
          funnel: {
            leads: num(source.funnel?.leads),
            orders: num(source.funnel?.orders),
            handed_over: num(source.funnel?.handed_over),
            delivered: num(source.funnel?.delivered),
            returned: num(source.funnel?.returned),
          },
          previous: before
            ? {
                mode: before.mode === "week" || before.mode === "month" ? before.mode : "previous",
                start_date: String(before.start_date || ""),
                end_date: String(before.end_date || ""),
                partial: Boolean(before.partial),
                total_revenue: num(before.total_revenue),
                live_orders: num(before.live_orders),
                average_order_value: num(before.average_order_value),
                lead_conversion_rate: num(before.lead_conversion_rate),
                lead_base: num(before.lead_base),
                conversion_rate: num(before.conversion_rate),
                online_orders: num(before.online_orders),
                rts_rate: num(before.rts_rate),
                rts_base: num(before.rts_base),
                trends: trends(before.trends),
              }
            : null,
        });
        // The Analitik menu's own rankings over the same days, not awaited:
        // the cards paint first, and a failure hides this card only.
        if (showInsights && start && end) {
          const rangeQuery = `date_filter=custom&date_start=${start}&date_end=${end}`;
          const read = async (path: string) => {
            const res = await fetch(`/api/admin/insights/${path}?${rangeQuery}`, { headers: { Accept: "application/json" } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !Array.isArray(body?.data?.rows)) throw new Error(body?.error || "Ranking gagal dimuat.");
            return body.data.rows as Array<Record<string, unknown>>;
          };
          void Promise.all([read("products"), read("landing")])
            .then(([products, pages]) => {
              if (sequence !== requestSequence.current) return;
              setRankings({
                products: products.slice(0, 5).map((row) => ({ label: String(row.label ?? ""), revenue: num(row.revenue), units: num(row.units) })),
                pages: pages.filter((row) => row.kind !== "none").slice(0, 5).map((row) => ({ label: String(row.label ?? ""), revenue: num(row.revenue), orders: num(row.orders) })),
              });
            })
            .catch((reason) => {
              if (sequence !== requestSequence.current) return;
              console.error("dashboard-rankings", reason);
              setRankings(null);
            });
        } else {
          setRankings(null);
        }
      } catch (reason) {
        if (sequence !== requestSequence.current) return;
        setError(reason instanceof Error ? reason.message : "Dashboard gagal dimuat.");
      } finally {
        if (sequence === requestSequence.current) {
          if (showLoading) setLoading(false);
          else setRefreshing(false);
        }
      }
    },
    [showInsights],
  );

  // Open work is not tied to the period; it refreshes on its own every minute
  // while the tab is visible, and with the refresh button.
  const loadAttention = useCallback(async () => {
    if (!showAttention) return;
    setAttentionError("");
    try {
      const response = await fetch("/api/admin/orders/attention", { headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || "Daftar tindakan gagal dimuat.");
      setAttention({ items: Array.isArray(body.data?.items) ? body.data.items : [], capped: Boolean(body.data?.capped), at: Date.now() });
    } catch (reason) {
      setAttentionError(reason instanceof Error ? reason.message : "Daftar tindakan gagal dimuat.");
    }
  }, [showAttention]);

  useEffect(() => {
    void loadAnalytics(dateSelection, compare, true);
  }, [loadAnalytics, dateSelection, compare]);

  useEffect(() => {
    void loadAttention();
    if (!showAttention) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAttention();
      setTick((value) => value + 1);
    }, ATTENTION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadAttention, showAttention]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center" role="alert">
        <h2 className="text-base font-semibold text-rose-950">Dashboard tidak dapat dimuat</h2>
        <p className="mt-1.5 text-xs text-rose-700">{error}</p>
        <Button onClick={() => void loadAnalytics(dateSelection, compare, true)} size="lg" className="mt-4">Coba lagi</Button>
      </section>
    );
  }
  if (!data) return null;

  const prev = data.previous;
  const compareCaption = prev
    ? `vs ${prev.start_date === prev.end_date ? dmy(prev.start_date) : `${dmy(prev.start_date)}–${dmy(prev.end_date)}`}${prev.partial ? " (sampai jam yang sama)" : ""}`
    : "";

  const metrics = [
    {
      label: "Revenue",
      value: currency(data.total_revenue),
      note: `COD ${compactRupiah(data.cod_revenue)} · Non-COD ${compactRupiah(data.prepaid_revenue)}`,
      title: `Nilai ${data.live_orders} order aktif. Sudah dibayar ${currency(data.collected_revenue)}; uang COD masuk setelah paket diterima.`,
      delta: <Delta current={data.total_revenue} previous={prev?.total_revenue} kind="percent" />,
      tone: "text-emerald-700",
    },
    {
      label: "Orders",
      value: data.live_orders.toLocaleString("id-ID"),
      note: data.total_orders === data.live_orders ? "Order aktif" : `${data.total_orders - data.live_orders} batal/gagal/retur`,
      title: `${data.total_orders} order masuk pada periode ini.`,
      delta: <Delta current={data.live_orders} previous={prev?.live_orders} kind="percent" />,
      tone: "text-slate-950",
    },
    {
      label: "AOV",
      value: data.live_orders > 0 ? currency(data.average_order_value) : "–",
      note: "Average order value",
      title: "Revenue dibagi order aktif.",
      delta: <Delta current={data.average_order_value} previous={prev?.average_order_value} kind="percent" />,
      tone: "text-slate-950",
    },
    {
      label: "Lead conversion",
      value: data.lead_base > 0 ? percentage(data.lead_conversion_rate) : "–",
      note: `Dari ${data.lead_base} lead + order`,
      title: "Order dibagi (lead belum checkout + order) pada periode ini.",
      delta: <Delta current={data.lead_conversion_rate} previous={prev && prev.lead_base > 0 && data.lead_base > 0 ? prev.lead_conversion_rate : undefined} kind="points" />,
      tone: "text-slate-950",
    },
    {
      label: "Online payment rate",
      value: data.online_orders > 0 ? percentage(data.conversion_rate) : "–",
      note: `Online lunas dari ${data.online_orders} non-COD`,
      title: "Order online (QRIS/VA/transfer) yang sudah dibayar. COD tidak dihitung.",
      delta: <Delta current={data.conversion_rate} previous={prev && prev.online_orders > 0 && data.online_orders > 0 ? prev.conversion_rate : undefined} kind="points" />,
      tone: "text-slate-950",
    },
    {
      label: "RTS rate",
      value: data.rts_base > 0 ? percentage(data.rts_rate) : "–",
      note: data.rts_base > 0 ? `Dari ${data.rts_base} kiriman selesai` : "Belum ada kiriman selesai",
      title: "Retur dibagi kiriman yang sudah selesai (diterima + retur).",
      delta: <Delta current={data.rts_rate} previous={prev && prev.rts_base > 0 && data.rts_base > 0 ? prev.rts_rate : undefined} kind="points" invert />,
      tone: data.rts_rate > 10 ? "text-rose-700" : "text-slate-950",
    },
  ];

  // The chart: bars for the period, a dashed line for the comparison, bucket
  // against bucket. A single day reads hour by hour and cumulatively, so the
  // question "ahead of last Friday so far?" has a one-glance answer; the
  // current line stops at the present hour.
  const hourly = data.period.interval === "hour";
  const currentHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }).format(new Date()));
  const isToday = data.period.end_date === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  let runCurrent = 0;
  let runPrevious = 0;
  const chartData = data.trends.map((point, index) => {
    const before = prev?.trends[index];
    if (!hourly) return { date: point.date, revenue: point.revenue, compare: before ? before.revenue : null };
    runCurrent += point.revenue;
    runPrevious += before?.revenue ?? 0;
    const future = isToday && index > currentHour;
    return { date: point.date, revenue: future ? null : runCurrent, compare: before ? runPrevious : null };
  });

  const payments = [
    { name: "COD", ...data.payment_methods.cod, bar: "bg-blue-600", detail: "Bayar saat barang diterima" },
    { name: "Transfer manual", ...data.payment_methods.manual_transfer, bar: "bg-emerald-600", detail: "Ke rekening seller" },
    { name: "Virtual Account", ...data.payment_methods.virtual_account, bar: "bg-violet-600", detail: "AutoLaris" },
    { name: "QRIS", ...data.payment_methods.qris, bar: "bg-slate-500", detail: "AutoLaris" },
  ];

  const funnel = data.funnel;
  const share = (value: number, base: number) => (base > 0 ? percentage((value / base) * 100) : "–");
  const periodQuery = data.period.start_date && data.period.end_date ? `date_filter=custom&date_start=${data.period.start_date}&date_end=${data.period.end_date}` : "";
  const funnelSteps: Array<{ label: string; value: number; note: string; href?: string }> = [
    { label: "Leads", value: funnel.leads, note: "Belum checkout" },
    { label: "Orders", value: funnel.orders, note: `${share(funnel.orders, funnel.leads + funnel.orders)} conversion`, href: `/admin/orders${periodQuery ? `?${periodQuery}` : ""}` },
    { label: "Shipped", value: funnel.handed_over, note: `${share(funnel.handed_over, funnel.orders)} dari orders` },
    { label: "Delivered", value: funnel.delivered, note: funnel.delivered + funnel.returned > 0 ? `${share(funnel.returned, funnel.delivered + funnel.returned)} RTS` : "Belum ada" },
  ];

  const toneClass: Record<AttentionItem["tone"], string> = { info: "text-blue-700", warn: "text-amber-700", bad: "text-rose-700" };
  const openItems = attention?.items.filter((item) => item.count > 0) ?? [];
  const doneCount = (attention?.items.length ?? 0) - openItems.length;
  const minutesAgo = attention ? Math.floor((Date.now() - attention.at) / 60_000) : 0;

  const attentionCard = showAttention && (
    <Card aria-labelledby="attention-heading" className="min-w-0 border-slate-200 shadow-none">
      <CardHeader className="flex-row items-center justify-between border-b border-slate-100 pb-3">
        <CardTitle as="h3" id="attention-heading" className="text-sm font-semibold text-slate-950 md:text-base">Action needed</CardTitle>
        {attention && (
          <span className="text-xs text-slate-400" title="Diperbarui otomatis tiap menit">
            {minutesAgo < 1 ? "baru saja" : `${minutesAgo} mnt lalu`}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-2">
        {attentionError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 p-2 text-xs text-rose-700">
            {attentionError}
            <Button variant="outline" size="sm" onClick={() => void loadAttention()}>Coba lagi</Button>
          </div>
        ) : !attention ? (
          <div className="space-y-1 p-1" aria-busy="true" aria-label="Memuat daftar tindakan">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-9 rounded-md" />)}
          </div>
        ) : openItems.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-sm text-emerald-800">
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" /> Semua beres.
          </p>
        ) : (
          <ul>
            {openItems.map((item) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  title={item.hint}
                  className="group flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-800">{item.label}</span>
                  {(item.stale ?? 0) > 0 && (
                    <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-rose-700" title="Menunggu lebih dari 24 jam">
                      {item.stale} &gt;24j
                    </span>
                  )}
                  <span className={`w-10 shrink-0 text-right text-base font-semibold tabular-nums ${toneClass[item.tone]}`}>
                    {item.count.toLocaleString("id-ID")}{attention.capped && CAPPED_KEYS.has(item.key) ? "+" : ""}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-slate-500" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {attention && openItems.length > 0 && doneCount > 0 && (
          <p className="px-2 pb-1 pt-2 text-xs text-slate-400">
            <CircleCheck className="mr-1 inline size-3.5 text-emerald-600" aria-hidden="true" />
            {doneCount} antrean lain beres
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* One toolbar: the period, what it is compared with, refresh. */}
      <section className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" aria-label="Date range dan pembanding">
        <AdminDateRangeFilter
          value={dateSelection}
          onChange={setDateSelection}
          disabled={loading || refreshing}
          hiddenPresets={DASHBOARD_HIDDEN_PRESETS}
          maxCustomRangeDays={DASHBOARD_MAX_RANGE_DAYS}
          className="w-full sm:w-56"
        />
        <div className="flex gap-2">
          {/* The same filter control as every other admin list (DESIGN-SYSTEM §7.1). */}
          <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
            <FilterSelect
              id="dashboard-compare"
              icon={GitCompareArrows}
              ariaLabel="Pembanding"
              value={compare}
              onValueChange={setCompare}
              disabled={loading || refreshing}
              options={(Object.keys(COMPARE_LABELS) as CompareChoice[]).map((value) => ({ value, label: COMPARE_LABELS[value] }))}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void loadAnalytics(dateSelection, compare);
              void loadAttention();
            }}
            disabled={refreshing}
            aria-label="Perbarui dashboard"
            aria-busy={refreshing}
            className="shrink-0"
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          </Button>
        </div>
        {compareCaption && <p className="text-xs text-slate-500 sm:ml-1">{compareCaption}</p>}
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800" role="alert">
          {error} Data terakhir yang berhasil dimuat tetap ditampilkan.
        </div>
      )}

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6" aria-label="KPI">
        {metrics.map((metric) => (
          <Card key={metric.label} className="overflow-hidden border-slate-200 shadow-none" title={metric.title}>
            <CardContent className="p-3.5 sm:p-4">
              <p className="text-xs font-medium text-slate-500">{metric.label}</p>
              {/* Never truncated: a cut money figure hides digits. On a phone the
                  size steps down with the figure's length so even
                  "Rp 1.234.567.890" fits a 360px half-width card. */}
              <p className={`mt-1.5 whitespace-nowrap font-semibold tabular-nums tracking-tight sm:text-xl ${kpiValueSize(metric.value)} ${metric.tone}`}>{metric.value}</p>
              <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {metric.delta}
                <span className="line-clamp-2 text-xs leading-4 text-slate-500">{metric.note}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Row 2: the chart and the payment mix; open work sits below them
          (Paduka, 2026-11-01), so the top of the page stays the numbers. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <Card aria-labelledby="trend-heading" className="min-w-0 border-slate-200 shadow-none">
          <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
            <CardTitle as="h3" id="trend-heading" className="text-sm font-semibold text-slate-950 md:text-base">
              Revenue {hourly ? "(kumulatif per jam)" : "per hari"}
            </CardTitle>
            {prev && (
              <CardDescription className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--admin-accent)]" aria-hidden="true" />Periode ini</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-slate-400" aria-hidden="true" />{COMPARE_LABELS[prev.mode].replace(/^vs /, "")}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="px-2 pb-3 pt-4 sm:px-4">
            {chartData.length === 0 ? (
              <div className="grid h-[240px] place-items-center rounded-xl bg-slate-50 text-center">
                <div>
                  <PackageCheck className="mx-auto size-6 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-slate-700">Belum ada data periode ini</p>
                </div>
              </div>
            ) : (
              <div className="h-[240px] w-full sm:h-[260px]">
                <ChartContainer
                  config={{
                    revenue: { label: "Periode ini", color: "var(--admin-accent)" },
                    compare: { label: prev ? COMPARE_LABELS[prev.mode].replace(/^vs /, "") : "Pembanding", color: "#94a3b8" },
                  }}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
                      <YAxis width={72} tickFormatter={(value) => compactRupiah(Number(value))} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                      <ChartTooltip cursor={{ fill: "rgba(148,163,184,0.06)" }} content={<ChartTooltipContent />} />
                      {hourly ? (
                        <Line dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2.5} dot={false} connectNulls={false} />
                      ) : (
                        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[5, 5, 0, 0]} maxBarSize={34} />
                      )}
                      {prev && <Line dataKey="compare" type="monotone" stroke="var(--color-compare)" strokeWidth={2} strokeDasharray="5 4" dot={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card aria-labelledby="payment-mix-heading" className="min-w-0 border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle as="h3" id="payment-mix-heading" className="text-sm font-semibold text-slate-950 md:text-base">Payment mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5 p-4">
            {data.payment_methods.total === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
                <CreditCard className="mx-auto size-5 text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-slate-800">Belum ada order pada periode ini.</p>
              </div>
            ) : (
              payments.map((item) => (
                <div key={item.name} title={item.detail}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-slate-800">{item.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-950">{item.count} · {percentage(item.percentage)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${item.bar}`} style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }} aria-hidden="true" />
                  </div>
                </div>
              ))
            )}
            {data.payment_methods.unknown_count > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                {data.payment_methods.unknown_count} order memakai metode legacy yang belum dipetakan.
              </p>
            )}
            {showPaymentsLink && (
              <a href="/admin/payments" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>Kelola payment</a>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {attentionCard}
        <Card aria-labelledby="funnel-heading" className="min-w-0 border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle as="h3" id="funnel-heading" className="text-sm font-semibold text-slate-950 md:text-base">Sales funnel</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {/* Only "Orders" links: the order list is the one list that takes this period. */}
            <ol className="grid grid-cols-2 gap-2">
              {funnelSteps.map((step) => {
                const body = (
                  <>
                    <span className="text-xs font-medium text-slate-500">{step.label}</span>
                    <span className="mt-0.5 text-lg font-semibold tabular-nums text-slate-950">{step.value.toLocaleString("id-ID")}</span>
                    <span className="text-xs text-slate-500">{step.note}</span>
                  </>
                );
                const frame = "flex h-full flex-col rounded-lg border border-slate-200 px-3 py-2";
                return (
                  <li key={step.label}>
                    {step.href ? (
                      <a href={step.href} className={`${frame} transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}>{body}</a>
                    ) : (
                      <div className={frame}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>


        {showInsights && rankings && (
          <Card aria-labelledby="top-heading" className="min-w-0 border-slate-200 shadow-none">
            <CardHeader className="border-b border-slate-100 pb-3">
              <CardTitle as="h3" id="top-heading" className="text-sm font-semibold text-slate-950 md:text-base">Top products & landing pages</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 xl:grid-cols-1">
              {[
                { title: "Products", rows: rankings.products, href: "/admin/analytics/products", unit: (row: RankingRow) => `${row.units ?? 0} unit` },
                { title: "Landing pages", rows: rankings.pages, href: "/admin/analytics/landing", unit: (row: RankingRow) => `${row.orders ?? 0} order` },
              ].map((list) => (
                <div key={list.title} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-500">{list.title}</p>
                    <a href={list.href} className="text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">Semua</a>
                  </div>
                  {list.rows.length === 0 ? (
                    <p className="mt-1.5 text-xs text-slate-400">Belum ada data.</p>
                  ) : (
                    <ol className="mt-1.5 space-y-1">
                      {list.rows.map((row, index) => (
                        <li key={`${row.label}-${index}`} className="flex items-baseline justify-between gap-3 text-sm" title={`${row.label} · ${list.unit(row)}`}>
                          <span className="min-w-0 truncate text-slate-800">
                            <span className="mr-1.5 tabular-nums text-slate-400">{index + 1}</span>{row.label}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-950">{compactRupiah(row.revenue)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
