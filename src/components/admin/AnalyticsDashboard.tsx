import { useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  CircleCheck,
  CircleCheckBig,
  CreditCard,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  ADMIN_DEFAULT_DATE_FILTER,
  resolveAdminDateSelection,
} from "../../lib/admin-date-filter";
import {
  AdminDateRangeFilter,
  type AdminDateSelection,
} from "./AdminDateRangeFilter";

/**
 * The dashboard charts every day in the period and aggregates across it, so it
 * reports on a shorter window than the order and shipping lists do, and hides
 * the presets that would exceed it.
 */
const DASHBOARD_MAX_RANGE_DAYS = 31;
const DASHBOARD_HIDDEN_PRESETS = ["90d", "180d"] as const;

type AnalyticsData = {
  total_revenue: number;
  collected_revenue: number;
  total_orders: number;
  live_orders: number;
  online_orders: number;
  conversion_rate: number;
  rts_rate: number;
  rts_base: number;
  cod_percentage: number;
  transfer_percentage: number;
  qris_percentage: number;
  payment_methods: {
    total: number;
    cod: PaymentMethodBucket;
    manual_transfer: PaymentMethodBucket;
    virtual_account: PaymentMethodBucket;
    qris: PaymentMethodBucket;
    unknown_count: number;
  };
  period: {
    start_date: string | null;
    end_date: string | null;
    timezone: string;
    basis: string;
    interval: "hour" | "day";
  };
  trends: Array<{ date: string; revenue: number; orders: number }>;
  funnel: { leads: number; orders: number; handed_over: number; delivered: number; returned: number };
  previous: {
    start_date: string;
    end_date: string;
    /** The period runs to today, so the earlier one is cut at the same time of day. */
    partial: boolean;
    total_revenue: number;
    live_orders: number;
    conversion_rate: number;
    online_orders: number;
    rts_rate: number;
    rts_base: number;
  } | null;
};

/** The counts read from a bounded row set; the other two are whole-table sums. */
const CAPPED_KEYS = new Set(["confirm", "ready_push", "push_problem", "needs_waybill", "needs_pickup", "needs_drop_off"]);

type AttentionItem = { key: string; label: string; hint: string; count: number; href: string; tone: "info" | "warn" | "bad" };
type RankingRow = { label: string; revenue: number; orders?: number; units?: number };

type PaymentMethodBucket = { count: number; percentage: number };

const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format;
/** Axis ticks: "Rp1,2jt", "Rp450rb", "Rp0" — never five identical labels. */
const compactRupiah = (value: number) => {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `Rp${m.toLocaleString("id-ID", { maximumFractionDigits: m < 10 ? 1 : 0 })}jt`;
  }
  if (value >= 1_000) return `Rp${Math.round(value / 1_000)}rb`;
  return `Rp${Math.round(value)}`;
};
const percentage = (value: number) =>
  `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

/**
 * The change against the period just before. Money and counts move in
 * percent; a rate already is one, so it moves in points. Nothing is shown
 * when there is no earlier period or it was empty (a percentage of zero is
 * not a number anyone can act on).
 */
function Delta({ current, previous, kind, invert = false }: {
  current: number;
  previous: number | undefined;
  kind: "percent" | "points";
  invert?: boolean;
}) {
  if (previous === undefined) return null;
  if (kind === "percent" && previous <= 0) return null;
  const change = kind === "percent" ? ((current - previous) / previous) * 100 : current - previous;
  const rounded = Math.round(change * 10) / 10;
  if (!Number.isFinite(rounded)) return null;
  const good = invert ? rounded < 0 : rounded > 0;
  const tone = rounded === 0 ? "text-slate-500 bg-slate-100" : good ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  const sign = rounded > 0 ? "▲" : rounded < 0 ? "▼" : "•";
  const value = `${Math.abs(rounded).toLocaleString("id-ID", { maximumFractionDigits: 1 })}${kind === "percent" ? "%" : " poin"}`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`} title="Dibanding periode sebelumnya dengan panjang yang sama">
      <span aria-hidden="true">{sign}</span>
      {value}
      <span className="sr-only">{rounded > 0 ? "naik" : rounded < 0 ? "turun" : "tetap"} dibanding periode sebelumnya</span>
    </span>
  );
}

function LoadingState() {
  return (
    <div
      className="space-y-6"
      aria-label="Memuat ringkasan analitik"
      aria-busy="true"
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
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
  /** Roles that work the order list see "Perlu tindakan" (its endpoint is theirs). */
  showAttention?: boolean;
  /** Roles that may read the Analitik menu see its top products and pages. */
  showInsights?: boolean;
}) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [attention, setAttention] = useState<{ items: AttentionItem[]; capped: boolean } | null>(null);
  const [attentionError, setAttentionError] = useState("");
  const [rankings, setRankings] = useState<{ products: RankingRow[]; pages: RankingRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [dateSelection, setDateSelection] = useState<AdminDateSelection>({
    filter: ADMIN_DEFAULT_DATE_FILTER,
    start: "",
    end: "",
  });
  const requestSequence = useRef(0);

  const loadAnalytics = useCallback(
    async (selection: AdminDateSelection, showLoading = false) => {
      const sequence = ++requestSequence.current;
      if (showLoading) setLoading(true);
      else setRefreshing(true);
      setError("");

      // One resolver for every period, named or explicit. A period this
      // surface cannot answer for is reported, not quietly swapped for the
      // default (REQ-157).
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

      let url = "/api/admin/analytics";
      if (start && end) {
        url += `?startDate=${start}&endDate=${end}&interval=${interval}`;
      }

      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success)
          throw new Error(payload.error || "Ringkasan analitik gagal dimuat.");
        if (sequence !== requestSequence.current) return;
        const source = payload.data ?? {};
        const sourcePayments = source.payment_methods ?? {};
        const bucket = (value: unknown): PaymentMethodBucket => {
          const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return {
            count: Number(item.count) || 0,
            percentage: Number(item.percentage) || 0,
          };
        };
        setData({
          total_revenue: Number(source.total_revenue) || 0,
          collected_revenue: Number(source.collected_revenue) || 0,
          total_orders: Number(source.total_orders) || 0,
          live_orders: Number(source.live_orders) || 0,
          online_orders: Number(source.online_orders) || 0,
          conversion_rate: Number(source.conversion_rate) || 0,
          rts_rate: Number(source.rts_rate) || 0,
          rts_base: Number(source.rts_base) || 0,
          cod_percentage: Number(source.cod_percentage) || 0,
          transfer_percentage: Number(source.transfer_percentage) || 0,
          qris_percentage: Number(source.qris_percentage) || 0,
          payment_methods: {
            total: Number(sourcePayments.total) || 0,
            cod: bucket(sourcePayments.cod),
            manual_transfer: bucket(sourcePayments.manual_transfer),
            virtual_account: bucket(sourcePayments.virtual_account),
            qris: bucket(sourcePayments.qris),
            unknown_count: Number(sourcePayments.unknown_count) || 0,
          },
          period: {
            start_date: typeof source.period?.start_date === "string" ? source.period.start_date : null,
            end_date: typeof source.period?.end_date === "string" ? source.period.end_date : null,
            timezone: String(source.period?.timezone || "Asia/Jakarta"),
            basis: String(source.period?.basis || "order_created_at"),
            interval: source.period?.interval === "hour" ? "hour" : "day",
          },
          trends: Array.isArray(source.trends) ? source.trends : [],
          funnel: {
            leads: Number(source.funnel?.leads) || 0,
            orders: Number(source.funnel?.orders) || 0,
            handed_over: Number(source.funnel?.handed_over) || 0,
            delivered: Number(source.funnel?.delivered) || 0,
            returned: Number(source.funnel?.returned) || 0,
          },
          previous: source.previous && typeof source.previous === "object"
            ? {
                start_date: String(source.previous.start_date || ""),
                end_date: String(source.previous.end_date || ""),
                partial: Boolean(source.previous.partial),
                total_revenue: Number(source.previous.total_revenue) || 0,
                live_orders: Number(source.previous.live_orders) || 0,
                conversion_rate: Number(source.previous.conversion_rate) || 0,
                online_orders: Number(source.previous.online_orders) || 0,
                rts_rate: Number(source.previous.rts_rate) || 0,
                rts_base: Number(source.previous.rts_base) || 0,
              }
            : null,
        });
        // The Analitik menu's own rankings, over the same days. Dated periods
        // only: the Analitik endpoints refuse "all time". Not awaited: the
        // cards paint first, and a failure here hides this card only rather
        // than reading as the dashboard's own error.
        if (showInsights && start && end) {
          const query = `date_filter=custom&date_start=${start}&date_end=${end}`;
          const read = async (path: string) => {
            const response = await fetch(`/api/admin/insights/${path}?${query}`, { headers: { Accept: "application/json" } });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !Array.isArray(body?.data?.rows)) throw new Error(body?.error || "Peringkat gagal dimuat.");
            return body.data.rows as Array<Record<string, unknown>>;
          };
          void Promise.all([read("products"), read("landing")])
            .then(([products, pages]) => {
              if (sequence !== requestSequence.current) return;
              setRankings({
                products: products.slice(0, 5).map((row) => ({ label: String(row.label ?? ""), revenue: Number(row.revenue) || 0, units: Number(row.units) || 0 })),
                pages: pages
                  .filter((row) => row.kind !== "none")
                  .slice(0, 5)
                  .map((row) => ({ label: String(row.label ?? ""), revenue: Number(row.revenue) || 0, orders: Number(row.orders) || 0 })),
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
        setError(
          reason instanceof Error
            ? reason.message
            : "Ringkasan analitik gagal dimuat.",
        );
      } finally {
        if (sequence !== requestSequence.current) return;
        if (showLoading) setLoading(false);
        else setRefreshing(false);
      }
    },
    [showInsights],
  );

  // Open work is not tied to the report's period; it reloads with the refresh button.
  const loadAttention = useCallback(async () => {
    if (!showAttention) return;
    setAttentionError("");
    try {
      const response = await fetch("/api/admin/orders/attention", { headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || "Daftar tindakan gagal dimuat.");
      setAttention({ items: Array.isArray(body.data?.items) ? body.data.items : [], capped: Boolean(body.data?.capped) });
    } catch (reason) {
      setAttentionError(reason instanceof Error ? reason.message : "Daftar tindakan gagal dimuat.");
    }
  }, [showAttention]);

  useEffect(() => {
    void loadAnalytics(dateSelection, true);
  }, [loadAnalytics, dateSelection]);

  useEffect(() => {
    void loadAttention();
  }, [loadAttention]);

  if (loading) return <LoadingState />;
  if (error && !data) {
    return (
      <section
        className="rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center"
        role="alert"
      >
        <h2 className="text-base font-semibold text-rose-950">
          Analitik tidak dapat dimuat
        </h2>
        <p className="mt-1.5 text-xs text-rose-700">{error}</p>
        <Button
          onClick={() => void loadAnalytics(dateSelection, true)}
          size="lg" className="mt-4"
        >
          Coba lagi
        </Button>
      </section>
    );
  }
  if (!data) return null;

  const metrics = [
    {
      label: "Omset",
      value: currency(data.total_revenue),
      // Not "pendapatan": this is order value still in play, before payment.
      // Cancelled orders and failed payments are already excluded.
      // "Diterima" read as nothing on a COD store until parcels arrive; it is
      // the money already paid, net of shipping and the COD fee.
      note: `Nilai ${data.live_orders.toLocaleString("id-ID")} order aktif · sudah dibayar ${currency(data.collected_revenue)}`,
      delta: <Delta current={data.total_revenue} previous={data.previous?.total_revenue} kind="percent" />,
      icon: BadgeDollarSign,
      tone: "text-emerald-700",
      iconTone: "bg-blue-50 text-blue-700",
    },
    {
      label: "Pesanan",
      // The big number is orders still in play, consistent with Omset above
      // it. What came in and then dropped out is the note, not the headline.
      value: data.live_orders.toLocaleString("id-ID"),
      note:
        data.total_orders === data.live_orders
          ? "Order aktif pada periode ini"
          : `Dari ${data.total_orders.toLocaleString("id-ID")} masuk · ${(data.total_orders - data.live_orders).toLocaleString("id-ID")} batal/gagal/retur`,
      delta: <Delta current={data.live_orders} previous={data.previous?.live_orders} kind="percent" />,
      icon: PackageCheck,
      tone: "text-slate-950",
      iconTone: "bg-blue-50 text-blue-700",
    },
    {
      label: "Pembayaran online lunas",
      value: percentage(data.conversion_rate),
      // COD is paid on delivery and is excluded from the base on purpose.
      note: `Dari ${data.online_orders.toLocaleString("id-ID")} order non-COD`,
      delta: data.online_orders > 0 && (data.previous?.online_orders ?? 0) > 0
        ? <Delta current={data.conversion_rate} previous={data.previous?.conversion_rate} kind="points" />
        : null,
      icon: CircleCheckBig,
      tone: "text-slate-950",
      iconTone: "bg-blue-50 text-blue-700",
    },
    {
      label: "Retur (RTS)",
      value: percentage(data.rts_rate),
      note:
        data.rts_base > 0
          ? `Dari ${data.rts_base.toLocaleString("id-ID")} kiriman selesai`
          : "Belum ada kiriman yang selesai",
      delta: data.rts_base > 0 && (data.previous?.rts_base ?? 0) > 0
        ? <Delta current={data.rts_rate} previous={data.previous?.rts_rate} kind="points" invert />
        : null,
      icon: RotateCcw,
      tone: data.rts_rate > 10 ? "text-rose-700" : "text-slate-950",
      iconTone:
        data.rts_rate > 10
          ? "bg-rose-50 text-rose-700"
          : "bg-slate-100 text-slate-600",
    },
  ];

  const payments = [
    {
      name: "COD",
      ...data.payment_methods.cod,
      bar: "bg-blue-600",
      detail: "Bayar saat barang diterima",
    },
    {
      name: "Transfer bank manual",
      ...data.payment_methods.manual_transfer,
      bar: "bg-emerald-600",
      detail: "Langsung ke rekening seller · tanpa rekonsiliasi AutoLaris",
    },
    {
      name: "Virtual Account",
      ...data.payment_methods.virtual_account,
      bar: "bg-violet-600",
      detail: "Pembayaran dan rekonsiliasi AutoLaris",
    },
    {
      name: "QRIS",
      ...data.payment_methods.qris,
      bar: "bg-slate-500",
      detail: "Pembayaran dan rekonsiliasi AutoLaris",
    },
  ];

  const periodLabel = data.period.start_date && data.period.end_date
    ? `${data.period.start_date.split("-").reverse().join("/")}–${data.period.end_date.split("-").reverse().join("/")} · WIB`
    : "Semua pesanan checkout · WIB";


  const toneClass: Record<AttentionItem["tone"], string> = {
    info: "text-blue-700",
    warn: "text-amber-700",
    bad: "text-rose-700",
  };
  const openItems = attention?.items.filter((item) => item.count > 0) ?? [];
  const doneItems = attention?.items.filter((item) => item.count === 0) ?? [];

  // The funnel: leads still open, orders placed, handed to Mengantar, received.
  // Each step's share is of the orders placed, the step a store controls from
  // there on; RTS is of the parcels that reached an outcome, like the card.
  const funnel = data.funnel;
  const share = (value: number, base: number) => (base > 0 ? percentage((value / base) * 100) : "–");
  // A step links only where its list can show the same rows: the order list
  // filters by the same Jakarta days. The lead and shipping lists cannot be
  // narrowed to this period, so those steps are figures, not links.
  const periodQuery = data.period.start_date && data.period.end_date
    ? `date_filter=custom&date_start=${data.period.start_date}&date_end=${data.period.end_date}`
    : "";
  const funnelSteps: Array<{ label: string; value: number; note: string; href?: string }> = [
    { label: "Lead belum checkout", value: funnel.leads, note: "Pesanan tertinggal di periode ini" },
    { label: "Order masuk", value: funnel.orders, note: funnel.leads + funnel.orders > 0 ? `${share(funnel.orders, funnel.leads + funnel.orders)} dari lead + order` : "Belum ada", href: `/admin/orders${periodQuery ? `?${periodQuery}` : ""}` },
    { label: "Diserahkan ke Mengantar", value: funnel.handed_over, note: `${share(funnel.handed_over, funnel.orders)} dari order` },
    { label: "Diterima pembeli", value: funnel.delivered, note: funnel.delivered + funnel.returned > 0 ? `${share(funnel.returned, funnel.delivered + funnel.returned)} retur dari kiriman selesai` : "Belum ada kiriman selesai" },
  ];

  return (
    <div className="space-y-4 md:space-y-5">
      {showAttention && (
        <Card aria-labelledby="attention-heading" className="border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle as="h3" id="attention-heading" className="text-sm font-semibold text-slate-950 md:text-base">
              Perlu tindakan
            </CardTitle>
            <CardDescription className="text-xs">
              Pekerjaan yang menunggu sekarang, semua periode. Angka sama dengan daftar yang dibuka.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            {attentionError ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-rose-700">
                {attentionError}
                <Button variant="outline" size="sm" onClick={() => void loadAttention()}>Coba lagi</Button>
              </div>
            ) : !attention ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Memuat daftar tindakan">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-lg" />)}
              </div>
            ) : openItems.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                <CircleCheck className="size-4 shrink-0" aria-hidden="true" /> Semua beres. Tidak ada order yang menunggu tindakan.
              </p>
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {openItems.map((item) => (
                    <li key={item.key}>
                      <a
                        href={item.href}
                        className="group flex h-full items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{item.label}</span>
                          <span className="mt-0.5 block text-xs leading-4 text-slate-500">{item.hint}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className={`text-xl font-semibold tabular-nums ${toneClass[item.tone]}`}>
                            {item.count.toLocaleString("id-ID")}{attention.capped && item.count > 0 && CAPPED_KEYS.has(item.key) ? "+" : ""}
                          </span>
                          <ArrowRight className="size-4 text-slate-300 transition-colors group-hover:text-slate-500" aria-hidden="true" />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
                {doneItems.length > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    <CircleCheck className="mr-1 inline size-3.5 text-emerald-600" aria-hidden="true" />
                    Beres: {doneItems.map((item) => item.label).join(" · ")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <CalendarDays className="size-[18px]" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium text-slate-900">Periode laporan</p>
            <p className="text-xs text-slate-500">
              Semua metrik mengikuti periode ini; dibuka pada bulan berjalan (WIB).
            </p>
            {data.previous && (
              <p className="text-xs text-slate-500">
                ▲▼ dibanding {data.previous.start_date.split("-").reverse().join("/")}–{data.previous.end_date.split("-").reverse().join("/")}
                {data.previous.partial ? " sampai jam yang sama." : " (panjang sama)."}
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <AdminDateRangeFilter
            value={dateSelection}
            onChange={setDateSelection}
            disabled={loading || refreshing}
            hiddenPresets={DASHBOARD_HIDDEN_PRESETS}
            maxCustomRangeDays={DASHBOARD_MAX_RANGE_DAYS}
            className="min-w-0 flex-1 sm:w-64"
          />
          <Button
            variant="secondary"
            size="default"
            onClick={() => {
              void loadAnalytics(dateSelection);
              void loadAttention();
            }}
            disabled={refreshing}
            aria-label="Perbarui data dashboard"
            aria-busy={refreshing}
            className="w-10 shrink-0 border border-slate-200 bg-white px-0"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </section>


      {error && (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800"
          role="alert"
        >
          {error}{data ? " Data periode terakhir yang berhasil dimuat tetap ditampilkan." : ""}
        </div>
      )}

      <section
        className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4"
        aria-label="Ringkasan performa toko"
      >
        {metrics.map((metric) => (
          <Card key={metric.label} className="overflow-hidden border-slate-200 shadow-none transition-colors hover:border-slate-300">
            <CardContent className="p-3.5 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
                  {metric.label}
                </p>
                <span className={`hidden size-8 shrink-0 place-items-center rounded-xl sm:grid ${metric.iconTone}`}>
                  <metric.icon className="size-4" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className={`text-lg font-semibold tabular-nums tracking-tight sm:text-2xl ${metric.tone}`}>
                  {metric.value}
                </p>
                {metric.delta}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 sm:text-xs">
                {metric.note}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <Card aria-labelledby="trend-heading" className="min-w-0 border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle as="h3" id="trend-heading" className="text-sm font-semibold text-slate-950 md:text-base">
              Tren omset
            </CardTitle>
            <CardDescription className="text-xs">
              Nilai kotor berdasarkan waktu order dibuat.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-4 pt-5 sm:px-5">
            {data.trends.length === 0 ? (
              <div className="grid h-[280px] place-items-center rounded-xl bg-slate-50 text-center">
                <div>
                  <PackageCheck className="mx-auto size-6 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    Belum ada data periode ini
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Grafik terisi setelah order tercatat.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[240px] w-full sm:h-[280px]">
                <ChartContainer
                  config={{
                    revenue: {
                      label: "Omset",
                      color: "var(--admin-accent)",
                    },
                  }}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.trends}
                      margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="#e2e8f0"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => {
                          if (value.includes(":"))
                            return value.split(" ")[1].substring(0, 5);
                          const [year, month, day] = String(value).slice(0, 10).split("-");
                          return year && month && day ? `${Number(day)}/${Number(month)}` : value;
                        }}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        dy={10}
                      />
                      <YAxis
                        // Recharts defaults the axis to 60px, sized for the old
                        // "Rp1jt" ticks; "Rp1,4jt" and "Rp700rb" clipped to
                        // "p700rb" at that width. Widened, not narrowed.
                        width={72}
                        tickFormatter={(value) => compactRupiah(Number(value))}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                      />
                      <ChartTooltip
                        cursor={{ fill: "rgba(148,163,184,0.06)" }}
                        content={<ChartTooltipContent />}
                      />
                      <Bar
                        dataKey="revenue"
                        fill="var(--color-revenue)"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={38}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card aria-labelledby="payment-mix-heading" className="border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle as="h3" id="payment-mix-heading" className="text-sm font-semibold text-slate-950 md:text-base">
              Metode pembayaran
            </CardTitle>
            <CardDescription className="text-xs">
              Pesanan dibuat, {periodLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {data.payment_methods.total === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
                <CreditCard className="mx-auto size-5 text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-slate-800">Belum ada pesanan selesai checkout pada periode ini.</p>
              </div>
            ) : payments.map((item) => (
              <div key={item.name}>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-800">
                      {item.name}
                    </p>
                    <p className="mt-0.5 text-xs leading-4 text-slate-500">
                      {item.detail}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
                    {item.count.toLocaleString("id-ID")} pesanan · {percentage(item.percentage)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100/90 ring-1 ring-slate-900/5">
                  <div
                    className={`h-full rounded-full ${item.bar}`}
                    style={{
                      width: `${Math.max(0, Math.min(100, item.percentage))}%`,
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
            {data.payment_methods.unknown_count > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                {data.payment_methods.unknown_count.toLocaleString("id-ID")} pesanan memakai metode pembayaran legacy yang belum dipetakan.
              </p>
            )}
            {showPaymentsLink && (
              <a href="/admin/payments" className={buttonVariants({ variant: "outline", className: "w-full" })}>
                Kelola payment
              </a>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${showInsights && rankings ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
        <Card aria-labelledby="funnel-heading" className="min-w-0 border-slate-200 shadow-none">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle as="h3" id="funnel-heading" className="text-sm font-semibold text-slate-950 md:text-base">
              Corong penjualan
            </CardTitle>
            <CardDescription className="text-xs">
              Dari lead sampai paket diterima, {periodLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent className="@container p-4">
            {/* Four across only when the card is wide enough to read them. */}
            <ol className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
              {funnelSteps.map((step, index) => (
                <li key={step.label}>
                  {(() => {
                    const body = (
                      <>
                        <span className="text-xs font-medium text-slate-500">
                          {index + 1}. {step.label}
                        </span>
                        <span className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{step.value.toLocaleString("id-ID")}</span>
                        <span className="mt-0.5 text-xs leading-4 text-slate-500">{step.note}</span>
                      </>
                    );
                    const frame = "flex h-full flex-col rounded-lg border border-slate-200 px-3 py-2.5";
                    return step.href ? (
                      <a href={step.href} className={`${frame} transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}>{body}</a>
                    ) : (
                      <div className={frame}>{body}</div>
                    );
                  })()}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {showInsights && rankings && (
          <Card aria-labelledby="top-heading" className="min-w-0 border-slate-200 shadow-none">
            <CardHeader className="border-b border-slate-100 pb-4">
              <CardTitle as="h3" id="top-heading" className="text-sm font-semibold text-slate-950 md:text-base">
                Teratas periode ini
              </CardTitle>
              <CardDescription className="text-xs">Menurut omset order aktif, {periodLabel}.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-2">
              {[
                { title: "Produk", rows: rankings.products, href: "/admin/analytics/products", unit: (row: RankingRow) => `${(row.units ?? 0).toLocaleString("id-ID")} unit` },
                { title: "Landing page", rows: rankings.pages, href: "/admin/analytics/landing", unit: (row: RankingRow) => `${(row.orders ?? 0).toLocaleString("id-ID")} order` },
              ].map((list) => (
                <div key={list.title} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{list.title}</p>
                    <a href={list.href} className="text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">Lihat semua</a>
                  </div>
                  {list.rows.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">Belum ada data di periode ini.</p>
                  ) : (
                    <ol className="mt-2 space-y-1.5">
                      {list.rows.map((row, index) => (
                        <li key={`${row.label}-${index}`} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-slate-800" title={row.label}>
                            <span className="mr-1.5 tabular-nums text-slate-400">{index + 1}</span>{row.label}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-semibold tabular-nums text-slate-950">{compactRupiah(row.revenue)}</span>
                            <span className="block text-xs text-slate-500">{list.unit(row)}</span>
                          </span>
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
